// Shared library for the kit-native goal continuity mechanism.
//
// Goal state is a small project-scoped JSON file (.kit/goal-state.json,
// gitignored) that survives a session swap because it lives in the repo, not
// in any one session's transcript. This module is the single owner of the
// canonical condition text (composeCondition) and the read/write/clear
// operations on that file. Consumed by kit-goal.js (the CLI), the /kit-goal
// skill, and the Stop hook that enforces the armed goal.
//
// Node core modules only, CommonJS, zero dependencies. Every exported
// function that touches the filesystem or parses data is wrapped so it never
// throws; a filesystem hiccup degrades to a null/false/default result instead
// of trapping the caller (the CLI and, eventually, the Stop hook, must never
// crash a session over a goal-state read).

'use strict';

const fs = require('fs');
const path = require('path');

// Path to the goal-state file for a given repo root.
function goalPath(cwd) {
    return path.join(cwd, '.kit', 'goal-state.json');
}

// Read and parse the goal-state file. Returns the parsed object, or null if
// the file is absent, unreadable, or not valid JSON.
function readGoal(cwd) {
    try {
        const raw = fs.readFileSync(goalPath(cwd), 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

// Read the first 2KB of a plan file and classify its Status header.
// Returns { exists, status } where status is 'complete', 'in progress', or
// 'unknown'. exists is false when the file cannot be opened at all.
function planHead(cwd, planRel) {
    const full = path.join(cwd, planRel);
    let fd;
    try {
        fd = fs.openSync(full, 'r');
    } catch {
        return { exists: false, status: 'unknown' };
    }
    try {
        const buf = Buffer.alloc(2048);
        const bytes = fs.readSync(fd, buf, 0, 2048, 0);
        let head = buf.toString('utf8', 0, bytes);
        if (head.charCodeAt(0) === 0xFEFF) head = head.slice(1);
        // Classify from the Status header only: anchored to a line start (m flag)
        // so body prose cannot match, and the value must sit on the same line as
        // the header ([^\S\r\n]* is horizontal whitespace only, never a newline),
        // so a bare "Status:" line above a line beginning "Complete" or "in
        // progress" does not misclassify the plan. A leading UTF-8 BOM (PowerShell
        // Set-Content writes one) is stripped above so the anchor sees the header.
        // The Status header sits on its own line near the top by convention.
        const inProgress = /^status:[^\S\r\n]*in[^\S\r\n]*progress/im.test(head);
        const complete = /^status:[^\S\r\n]*complete/im.test(head) && !inProgress;
        let status = 'unknown';
        if (complete) status = 'complete';
        else if (inProgress) status = 'in progress';
        return { exists: true, status };
    } catch {
        return { exists: true, status: 'unknown' };
    } finally {
        try { fs.closeSync(fd); } catch { /* already closed or invalid */ }
    }
}

// The single source of the canonical goal condition text. planRel is the
// repo-relative forward-slash plan path already validated by armGoal. This
// text is descriptive: it is surfaced for a human reading goal-state.json. The
// deterministic Stop hook enforces via file, transcript, and relay signals, not
// by parsing this string, so its clause (a) wording need not mirror the hook's
// exact Complete-or-archived check.
function composeCondition(planRel) {
    return 'Work ' + planRel + ' to completion using executing-work. Met when '
        + '(a) every section is complete and closed out, (b) you are BLOCKED on '
        + 'a decision only Scott can make and have said so, or (c) you just '
        + 'compacted at a section boundary and wrote the resume-relay handoff '
        + 'for this plan.';
}

// Normalize a plan argument (relative or absolute) to a repo-relative,
// forward-slash path. Returns null if the argument carries control characters
// or the resolved path escapes cwd.
function normalizePlanArg(cwd, planArg) {
    // Reject any control character up front: the plan path is written into
    // goal-state.json, which the hooks surface back into the model's context, so
    // a path carrying newlines or control bytes could smuggle instructions into
    // a trusted channel. Windows filenames cannot hold these; this closes the
    // POSIX case and matches the sibling hooks' sanitize-before-trust rule.
    if (typeof planArg !== 'string' || /[\x00-\x1F]/.test(planArg)) {
        return null;
    }
    const abs = path.resolve(cwd, planArg);
    const rel = path.relative(cwd, abs);
    // Reject a path that resolves to cwd itself, escapes it via a real `..` path
    // segment (not merely a name beginning with two dots, e.g. `..notes.md`), or
    // lands on another drive (path.relative yields an absolute path when no
    // relative route exists).
    if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
        return null;
    }
    return rel.split(path.sep).join('/');
}

// Validate the plan argument, then write the goal-state file atomically
// (tmp file + rename). Returns { ok:true, plan } on success or
// { ok:false, reason } on any failure: a bad path, a missing or Complete plan,
// or an unexpected filesystem error, which is caught and reported rather than
// thrown. This keeps the whole exported surface non-throwing.
function armGoal(cwd, planArg) {
    const rel = normalizePlanArg(cwd, planArg);
    if (rel === null) {
        return { ok: false, reason: 'plan path is invalid or outside the repo' };
    }

    const head = planHead(cwd, rel);
    if (!head.exists) {
        return { ok: false, reason: 'plan not found: ' + rel };
    }
    if (head.status === 'complete') {
        return { ok: false, reason: 'plan is already Complete: ' + rel };
    }

    const gp = goalPath(cwd);
    const state = {
        plan: rel,
        condition: composeCondition(rel),
        armedAt: new Date().toISOString(),
        // Which session currently holds the leash, or null when unclaimed. A
        // fresh arm (including re-arming an already-armed goal after a crash)
        // starts unbound: the next stop that resolves to a leashed session
        // claims it, so re-arm is always a clean rebind opportunity.
        boundSession: null
    };
    try {
        fs.mkdirSync(path.dirname(gp), { recursive: true });
        // The tmp name carries this process's pid so two writers (e.g. a CLI
        // arm racing a Stop hook's bind) never collide on the same tmp path.
        const tmp = gp + '.tmp.' + process.pid;
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
        fs.renameSync(tmp, gp);
    } catch (err) {
        return { ok: false, reason: 'could not write goal state: ' + (err && err.message ? err.message : String(err)) };
    }

    return { ok: true, plan: rel };
}

// Bind (or rebind) the armed goal to a session id, recording which session
// holds the leash. Reads the current goal state, sets boundSession, and
// rewrites the file atomically (tmp + rename, matching armGoal). Returns
// { ok:true } on success, or { ok:false, reason } when no goal is armed, the
// session id is unusable, or the write fails. Never throws. The session id is
// written into goal-state.json, which the hooks surface into the model's
// context, so a control character (a newline could smuggle instructions) is
// rejected, matching normalizePlanArg's sanitize-before-store rule; a length
// cap likewise rejects an oversized value (the Stop hook can feed this a raw
// line read from a relay file, which a corrupt or hostile file could pad to
// kilobytes).
//
// Concurrency posture: this read-modify-write is not locked, so two stops
// resolving to different sessions at nearly the same moment are last-writer-
// wins; the loser simply reads the winner's binding at its own next stop and
// allows (a bystander, or a successor that reclaims via the genealogy ledger).
// A clear that lands between this function's read and its write can be
// resurrected by this write, recoverable by clearing again. Enforcement never
// depends on this write succeeding: a failed bind still leashes the current
// stop and is retried at the next one.
function bindSession(cwd, sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '' || sessionId.length > 128
        || /[\x00-\x1F]/.test(sessionId)) {
        return { ok: false, reason: 'session id is invalid' };
    }
    const state = readGoal(cwd);
    if (!state || !state.plan) {
        return { ok: false, reason: 'no goal is armed' };
    }
    state.boundSession = sessionId;
    const gp = goalPath(cwd);
    try {
        fs.mkdirSync(path.dirname(gp), { recursive: true });
        const tmp = gp + '.tmp.' + process.pid;
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
        fs.renameSync(tmp, gp);
    } catch (err) {
        return { ok: false, reason: 'could not write goal state: ' + (err && err.message ? err.message : String(err)) };
    }
    return { ok: true };
}

// Delete the goal-state file if present. Returns { ok:true, cleared:true } when
// a file was removed, { ok:true, cleared:false } when none was armed, and
// { ok:false, cleared:false, reason } when the file exists but the delete
// failed (e.g. permissions): the leash is still armed and the caller must not
// report it released. Never throws.
function clearGoal(cwd) {
    const gp = goalPath(cwd);
    try {
        if (!fs.existsSync(gp)) {
            return { ok: true, cleared: false };
        }
        fs.unlinkSync(gp);
        return { ok: true, cleared: true };
    } catch (err) {
        return {
            ok: false,
            cleared: false,
            reason: 'could not clear goal state: ' + (err && err.message ? err.message : String(err))
        };
    }
}

module.exports = { goalPath, readGoal, armGoal, bindSession, clearGoal, composeCondition, planHead };
