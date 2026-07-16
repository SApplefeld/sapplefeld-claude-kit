// Tests for plugins/claude-kit/hooks/kit-goal-stop.js (the goal-leash Stop hook).
//
// Node's built-in test runner, no framework (Node v24). The hook is spawned as a
// real child process, fed a Stop payload on stdin, and asserted on by its stdout:
// a block emits {"decision":"block", reason}; an allow emits nothing. Each case
// builds a fresh temp cwd (with its own .kit/goal-state.json and a fake JSONL
// transcript) and a fresh temp LOCALAPPDATA so the win32 relay-dir probe is
// exercised hermetically. All temp state is cleaned up in a finally block.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOK = path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'kit-goal-stop.js');
const { armGoal } = require('../plugins/claude-kit/hooks/kit-goal-lib.js');

function makeDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmDir(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

function writeFile(full, contents) {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf8');
}

// Build a JSONL transcript from an array of assistant text turns. Each turn
// becomes one assistant line with a single text content block; a user line
// that names the plan is prepended so the scoping predicate can match on it.
function writeTranscript(full, planRel, assistantTexts) {
    const lines = [];
    lines.push(JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Work ' + planRel + ' to completion.' }
    }));
    for (const t of assistantTexts) {
        lines.push(JSON.stringify({
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'text', text: t }] }
        }));
    }
    writeFile(full, lines.join('\n') + '\n');
}

// Run the hook with the given payload and a chosen LOCALAPPDATA. Returns the
// spawnSync result (stdout, stderr, status).
function runHook(payload, localAppData) {
    const env = { ...process.env };
    if (localAppData !== undefined) env.LOCALAPPDATA = localAppData;
    return spawnSync(process.execPath, [HOOK], {
        input: JSON.stringify(payload),
        env,
        encoding: 'utf8'
    });
}

// Arm a goal in a fresh repo with an In-Progress plan, and lay down a transcript
// that references the plan. Returns { repo, planRel, transcript, local }.
function armedRepo(assistantTexts, planStatus) {
    const repo = makeDir('kit-goal-stop-repo-');
    const local = makeDir('kit-goal-stop-local-');
    const planRel = 'docs/plans/example.md';
    const planFull = path.join(repo, planRel);
    // Arm against an In-Progress plan (armGoal refuses a Complete one), then
    // rewrite the plan header to the requested status so the hook's clause-(a)
    // check sees the intended live state.
    writeFile(planFull, 'Status: In Progress\n\nbody\n');
    const armed = armGoal(repo, planRel);
    assert.strictEqual(armed.ok, true, 'test setup: goal should arm');
    if (planStatus && planStatus !== 'Status: In Progress') {
        writeFile(planFull, planStatus + '\n\nbody\n');
    }
    const transcript = path.join(repo, 'transcript.jsonl');
    writeTranscript(transcript, planRel, assistantTexts || ['Working on it.']);
    return { repo, planRel, transcript, local };
}

test('no goal armed: empty stdout (allow)', () => {
    const repo = makeDir('kit-goal-stop-repo-');
    const local = makeDir('kit-goal-stop-local-');
    try {
        const transcript = path.join(repo, 'transcript.jsonl');
        writeTranscript(transcript, 'docs/plans/example.md', ['Working.']);
        const res = runHook({ cwd: repo, transcript_path: transcript }, local);
        assert.strictEqual(res.stdout, '');
        assert.strictEqual(res.status, 0);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('goal armed, transcript names plan, In Progress, no BLOCKED, no relay: block', () => {
    const { repo, planRel, transcript, local } = armedRepo(['Making progress.']);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript }, local);
        assert.strictEqual(res.status, 0);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block');
        assert.ok(out.reason.includes(path.basename(planRel)), 'reason names the plan basename');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('goal armed but transcript does NOT name the plan: empty stdout (scoping allow)', () => {
    const { repo, local } = armedRepo(['Making progress.']);
    try {
        const other = path.join(repo, 'unrelated.jsonl');
        writeFile(other, JSON.stringify({
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'text', text: 'Different work entirely.' }] }
        }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: other }, local);
        assert.strictEqual(res.stdout, '');
        assert.strictEqual(res.status, 0);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('goal armed, plan Status: Complete: empty stdout AND goal auto-cleared', () => {
    const { repo, transcript, local } = armedRepo(['Done all sections.'], 'Status: Complete');
    try {
        assert.ok(fs.existsSync(path.join(repo, '.kit', 'goal-state.json')), 'setup: goal armed');
        const res = runHook({ cwd: repo, transcript_path: transcript }, local);
        assert.strictEqual(res.stdout, '');
        assert.strictEqual(res.status, 0);
        assert.ok(!fs.existsSync(path.join(repo, '.kit', 'goal-state.json')), 'goal auto-cleared on Complete');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('goal armed, plan file deleted (archived): empty stdout AND goal auto-cleared', () => {
    const { repo, planRel, transcript, local } = armedRepo(['Still going.']);
    try {
        fs.rmSync(path.join(repo, planRel));
        const res = runHook({ cwd: repo, transcript_path: transcript }, local);
        assert.strictEqual(res.stdout, '');
        assert.strictEqual(res.status, 0);
        assert.ok(!fs.existsSync(path.join(repo, '.kit', 'goal-state.json')), 'goal auto-cleared when plan is gone');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('goal armed, last assistant turn leads with BLOCKED: empty stdout (allow); only the last turn counts', () => {
    // An earlier turn without BLOCKED proves the scan reads the LAST assistant
    // turn, not the first match.
    const { repo, transcript, local } = armedRepo([
        'Investigating the failure.',
        'BLOCKED: this needs a decision only Scott can make.'
    ]);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript }, local);
        assert.strictEqual(res.stdout, '');
        assert.strictEqual(res.status, 0);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('goal armed, an EARLIER turn had BLOCKED but the last did not: block (only the last counts)', () => {
    const { repo, transcript, local } = armedRepo([
        'BLOCKED: was blocked earlier.',
        'Now unblocked and back to work.'
    ]);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript }, local);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('goal armed, fresh relay request.txt naming the plan: empty stdout (allow)', { skip: process.platform !== 'win32' ? 'win32-only relay probe' : false }, () => {
    const { repo, planRel, transcript, local } = armedRepo(['Compacting at the boundary.']);
    try {
        const relayDir = path.join(local, 'claude-kit', 'resume-relay');
        writeFile(path.join(relayDir, 'request.txt'),
            'uuid-1234\nC:/x/uuid-1234.jsonl\nResume ' + planRel + ' from the next section.\n');
        const res = runHook({ cwd: repo, transcript_path: transcript }, local);
        assert.strictEqual(res.stdout, '');
        assert.strictEqual(res.status, 0);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('goal armed, fresh processed\\<stamp>-done.txt naming the plan, no request.txt: empty stdout (allow)', { skip: process.platform !== 'win32' ? 'win32-only relay probe' : false }, () => {
    const { repo, planRel, transcript, local } = armedRepo(['Swapped sessions.']);
    try {
        const processedDir = path.join(local, 'claude-kit', 'resume-relay', 'processed');
        writeFile(path.join(processedDir, '20260716-101500-done.txt'),
            'uuid-9999\nC:/x/uuid-9999.jsonl\nResume ' + planRel + ' at section 4.\n');
        const res = runHook({ cwd: repo, transcript_path: transcript }, local);
        assert.strictEqual(res.stdout, '');
        assert.strictEqual(res.status, 0);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a fresh request.txt for a DIFFERENT plan does not mask our own fresh processed handoff: allow', { skip: process.platform !== 'win32' ? 'win32-only relay probe' : false }, () => {
    // request.txt is a machine-global single queue: a concurrent relay for another
    // plan must not short-circuit past our own just-archived handoff.
    const { repo, planRel, transcript, local } = armedRepo(['Handing off at the boundary.']);
    try {
        const relayDir = path.join(local, 'claude-kit', 'resume-relay');
        writeFile(path.join(relayDir, 'request.txt'),
            'uuid-other\nC:/x/uuid-other.jsonl\nResume docs/plans/other-plan.md now.\n');
        writeFile(path.join(relayDir, 'processed', '20260716-120000-done.txt'),
            'uuid-ours\nC:/x/uuid-ours.jsonl\nResume ' + planRel + ' at section 4.\n');
        const res = runHook({ cwd: repo, transcript_path: transcript }, local);
        assert.strictEqual(res.stdout, '', 'our archived handoff must be found even when request.txt names another plan');
        assert.strictEqual(res.status, 0);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('goal armed, a stale processed entry naming the plan does NOT allow: block', { skip: process.platform !== 'win32' ? 'win32-only relay probe' : false }, () => {
    const { repo, planRel, transcript, local } = armedRepo(['Working, but the last handoff was ages ago.']);
    try {
        const processedDir = path.join(local, 'claude-kit', 'resume-relay', 'processed');
        const stale = path.join(processedDir, '20200101-000000-done.txt');
        writeFile(stale, 'uuid-old\nC:/x/uuid-old.jsonl\nResume ' + planRel + ' long ago.\n');
        // Backdate the mtime well outside the 5-minute window.
        const old = new Date(Date.now() - 60 * 60 * 1000);
        fs.utimesSync(stale, old, old);
        const res = runHook({ cwd: repo, transcript_path: transcript }, local);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'a stale relay entry must not unleash the session');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('self-injection: plan named only in a hook attachment or tool_result does NOT leash: allow', () => {
    // The scoping guard's worst case: session-start surfacing injects the armed
    // plan path into EVERY session's transcript as a hook_additional_context
    // attachment. An unrelated session whose genuine user/assistant text never
    // names the plan must not be leashed by that self-injection (or by a
    // tool_result that merely echoes the path).
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'unrelated-session.jsonl');
        // The real SessionStart injection is a top-level type:"attachment" with
        // the plan path nested in attachment.stdout (attachment.type
        // "hook_success"); mirror that shape so the fixture pins the real carrier.
        const lines = [
            JSON.stringify({ type: 'user', message: { role: 'user', content: 'Fix the CSS on the login page.' } }),
            JSON.stringify({ type: 'attachment', attachment: { type: 'hook_success', stdout: 'A kit goal is armed for ' + planRel + ' in this project.' } }),
            JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'grep hit: ' + planRel }] } }),
            JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'The login CSS is fixed.' }] } })
        ];
        writeFile(tx, lines.join('\n') + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx }, local);
        assert.strictEqual(res.stdout, '', 'an unrelated session must not be leashed by the self-injected plan name');
        assert.strictEqual(res.status, 0);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('scoping matches the full plan path, not just the basename: a same-name file in another dir does not leash', () => {
    const { repo, local } = armedRepo(['unused']); // goal armed for docs/plans/example.md
    try {
        const tx = path.join(repo, 'other-example.jsonl');
        // Genuine user/assistant text names docs/ARCHIVE/example.md (same basename,
        // different dir) but never the armed docs/plans/example.md.
        const lines = [
            JSON.stringify({ type: 'user', message: { role: 'user', content: 'Review docs/archive/example.md for me.' } }),
            JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Reviewed docs/archive/example.md; looks fine.' }] } })
        ];
        writeFile(tx, lines.join('\n') + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx }, local);
        assert.strictEqual(res.stdout, '', 'a same-basename file in another directory must not leash the session');
        assert.strictEqual(res.status, 0);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a sidechain (sub-agent) BLOCKED turn does not count; the last main-thread turn decides: block', () => {
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'sidechain.jsonl');
        const lines = [
            JSON.stringify({ type: 'user', message: { role: 'user', content: 'Work ' + planRel + ' to completion.' } }),
            JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Dispatching a reviewer.' }] } }),
            JSON.stringify({ type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'BLOCKED: the sub-agent is blocked.' }] } })
        ];
        writeFile(tx, lines.join('\n') + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx }, local);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'a sidechain BLOCKED must not release the main-thread leash');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('stop_hook_active true: empty stdout (allow, no re-block loop)', () => {
    const { repo, transcript, local } = armedRepo(['Making progress.']);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, stop_hook_active: true }, local);
        assert.strictEqual(res.stdout, '');
        assert.strictEqual(res.status, 0);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('malformed stdin: empty stdout, exit 0 (never throws)', () => {
    const res = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
    assert.strictEqual(res.stdout, '');
    assert.strictEqual(res.status, 0);
});

test('goal armed but transcript path absent: empty stdout (cannot scope, so allow)', () => {
    const { repo, local } = armedRepo(['Working.']);
    try {
        const res = runHook({ cwd: repo }, local);
        assert.strictEqual(res.stdout, '');
        assert.strictEqual(res.status, 0);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});
