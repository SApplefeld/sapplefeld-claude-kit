// Tests for plugins/claude-kit/hooks/kit-goal-stop.js (the goal-leash Stop hook).
//
// Node's built-in test runner, no framework (Node v24). The hook is spawned as a
// real child process, fed a Stop payload on stdin, and asserted on by its stdout:
// a block emits {"decision":"block", reason}; an allow emits nothing. Each case
// builds a fresh temp cwd (with its own .kit/goal-state.json and a fake JSONL
// transcript) plus a second temp dir holding that case's event sink: pinning
// KIT_EVENTS_PATH inside it is the isolation, so no release a case fires
// appends to the real ~/.claude/kit-events.jsonl. KIT_EVENTS_PATH is honored
// only alongside KIT_EVENTS_PATH_ALLOW=1, so every spawn sets both; leaving
// the allow signal off would make the redirect inert and route every case's
// events into the real sink instead of the temp one. Every spawn also points
// LOCALAPPDATA at the temp root as belt-and-suspenders (the hook reads no
// LOCALAPPDATA path today; the pin costs nothing and guards a future one).
// All temp state is cleaned up in a finally block.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOK = path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'kit-goal-stop.js');
const { armGoal, appendGoal, bindSession, advanceGoal } = require('../plugins/claude-kit/hooks/kit-goal-lib.js');
// The compaction-checkpoint helpers pin the advance's checkpoint rewrite (the
// chapter-close ritual opens a checkpoint the advance would otherwise strand
// as wrong-plan at the plan boundary).
const { writeCheckpoint, readCheckpoint, checkpointPath } = require('../plugins/claude-kit/hooks/kit-compact-lib.js');

// The goal-event sink for a case, always inside a temp root that case cleans up,
// never the real ~/.claude/kit-events.jsonl that a release fired by any spawn
// would append to. Every spawn supplies its own root, so no sink is shared
// across cases and none outlives the case that wrote it; a missing root is a
// fixture error rather than a silent fall back to a shared path.
function eventsPath(root) {
    if (root === undefined) throw new Error('eventsPath requires a temp root');
    return path.join(root, 'kit-goal-stop-events.jsonl');
}

// The events a case's spawns emitted, newest last; an empty list when nothing
// was written.
function readEvents(root) {
    const sink = eventsPath(root);
    if (!fs.existsSync(sink)) return [];
    return fs.readFileSync(sink, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line));
}

// Drop the run-scoped variables from a child's environment. This suite runs
// inside fleet workers too, where the engine sets all three, and an inherited
// KIT_RUN_ID would attach a `run` field to every emitted event, breaking the
// exact-shape assertions the byte-identical cases make. Keys are matched
// case-insensitively, the same care memq.test.js's scrubRunEnv takes with a
// Windows environment block's key casing.
function scrubRunEnv(env) {
    for (const k of Object.keys(env)) {
        if (/^KIT_(RUN_ID|SPAWN_VECTOR|RUN_SECTION)$/i.test(k)) delete env[k];
    }
    return env;
}

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
// becomes one assistant line with a single text content block; a genuine
// arming-invocation user line (the plan path inside a <command-args> span) is
// prepended so the scoping predicate claims this session, matching the real
// shape the /kit-goal skill produces.
function writeTranscript(full, planRel, assistantTexts) {
    const lines = [];
    lines.push(JSON.stringify({
        type: 'user',
        message: {
            role: 'user',
            content: '<command-name>/kit-goal</command-name>\n            '
                + '<command-message>kit-goal</command-message>\n            '
                + '<command-args>' + planRel + '</command-args>'
        }
    }));
    for (const t of assistantTexts) {
        lines.push(JSON.stringify({
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'text', text: t }] }
        }));
    }
    writeFile(full, lines.join('\n') + '\n');
}

// Run the hook with the given payload, isolating it from real machine state:
// LOCALAPPDATA and the goal-event sink are pinned to the caller's temp root, so
// a case sees only the fixtures it builds and writes only inside them. Returns
// the spawnSync result (stdout, stderr, status). Clause-(b) retries are disabled
// by default so block-path tests stay fast and an ambient KIT_GOAL_STOP_RETRY_MS
// cannot warp the suite's timing; pass extraEnv to exercise a real schedule.
//
// The ambient copy is scrubbed before extraEnv is merged in, not after: a case
// that opts into a real KIT_RUN_ID (or the vector/section pair) via extraEnv
// must see it survive, or this suite could never host an end-to-end case for
// a field this section adds to the stream.
function runHook(payload, localAppData, extraEnv) {
    const env = {
        ...scrubRunEnv({ ...process.env }),
        KIT_GOAL_STOP_RETRY_MS: '0',
        KIT_EVENTS_PATH: eventsPath(localAppData),
        KIT_EVENTS_PATH_ALLOW: '1',
        ...(extraEnv || {})
    };
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

test('goal armed, transcript names plan, In Progress, no BLOCKED: block', () => {
    const { repo, planRel, transcript, local } = armedRepo(['Making progress.']);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript }, local);
        assert.strictEqual(res.status, 0);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block');
        assert.ok(out.reason.includes(path.basename(planRel)), 'reason names the plan basename');
        assert.ok(out.reason.includes('subagent dispatch and Workflows'),
            "an operator-armed goal carries that arming's request for subagent dispatch and "
            + 'Workflows, and the block reason restates it');
        assert.ok(out.reason.includes('kit-compact-checkpoint.js open'),
            'the standard hold reason names the boundary checkpoint command');
        assert.ok(out.reason.includes('holding auto-compaction offers and this turn is at a clean point'),
            'the standard hold names the interim-board case beside the Chapter case: a run whose '
            + 'review rounds close no section produces no Chapter, so a Chapter-only condition is '
            + 'silent for exactly the run the gate has been holding longest');
        assert.ok(out.reason.includes('where no section has closed, an interim board entry'),
            'and it names the entry that opens that boundary, not only the condition');
        assert.ok(out.reason.indexOf('run the memory sweep') < out.reason.indexOf('commit model'),
            'the boundary steps are named in executing-work\'s own order: the sweep and the '
            + 'Chapter precede honoring the commit model, since the commit carries the Chapter. '
            + 'A directive that put the commit first would have the section committed before its '
            + 'Chapter exists, leaving the Chapter dirty and outside its own commit');
        assert.ok(out.reason.indexOf('commit model') < out.reason.indexOf('kit-compact-checkpoint.js open'),
            'and the checkpoint opens last of all');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('unbound goal: the plan path in a LATER <command-args> span still claims (every span searched)', () => {
    // Pins the all-spans search in userCommandArgsInclude: an invocation can
    // carry more than one <command-args> span, and the plan path counts
    // wherever it rides. A first-span-only read would miss this claim, leave
    // the session unleashed, and pass every single-span case silently.
    const repo = makeDir('kit-goal-stop-repo-');
    const local = makeDir('kit-goal-stop-local-');
    try {
        const planRel = 'docs/plans/example.md';
        writeFile(path.join(repo, planRel), 'Status: In Progress\n\nbody\n');
        const armed = armGoal(repo, planRel);
        assert.strictEqual(armed.ok, true, 'test setup: goal should arm');
        const transcript = path.join(repo, 'transcript.jsonl');
        writeFile(transcript, [
            JSON.stringify({
                type: 'user',
                message: {
                    role: 'user',
                    content: '<command-name>/kit-goal</command-name>\n'
                        + '<command-message>kit-goal</command-message>\n'
                        + '<command-args>status</command-args>\n'
                        + '<command-args>' + planRel + '</command-args>'
                }
            }),
            JSON.stringify({
                type: 'assistant',
                message: { role: 'assistant', content: [{ type: 'text', text: 'Working on it.' }] }
            })
        ].join('\n') + '\n');
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'ses-claimer' }, local);
        assert.strictEqual(res.status, 0);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'the claim binds and the leash enforces');
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

test('an unusable plan path does not pre-empt a genuine BLOCKED: release', () => {
    // The release clauses run before the unusable path is reported. A run that
    // leads with a true blocker must release on that path exactly as it would
    // with a readable plan doc: holding it instead would trap an unattended run
    // against the harness's consecutive-block cap, with a reason offering only
    // remedies (restore the file, /kit-goal clear) that nobody is there to
    // perform.
    const { repo, planRel, transcript, local } = armedRepo([
        'BLOCKED: this needs a decision only Scott can make.'
    ]);
    try {
        fs.rmSync(path.join(repo, planRel));
        fs.mkdirSync(path.join(repo, planRel), { recursive: true });
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-b' }, local);
        assert.strictEqual(res.status, 0);
        assert.strictEqual(res.stdout, '', 'the blocker releases the stop, unusable plan path or not');
        // An empty stdout on its own is every early allow, the one that returns
        // before the release clauses are reached included, so it cannot tell a
        // clause-(b) release from the unusable path never being carried past the
        // absent branch at all. The event is what only clause (b) emits.
        const events = readEvents(local);
        assert.deepStrictEqual(events.map((e) => e.event), ['goal-blocked'],
            'clause (b) is what ran: ' + JSON.stringify(events));
        assert.strictEqual(events[0].plan, planRel, 'and it names the plan: ' + JSON.stringify(events[0]));
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('an unusable plan path does not pre-empt a WAITING: park either', () => {
    const { repo, planRel, transcript, local } = armedRepo([
        'WAITING: three reviewers are still running.'
    ]);
    try {
        fs.rmSync(path.join(repo, planRel));
        fs.mkdirSync(path.join(repo, planRel), { recursive: true });
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-w' }, local);
        assert.strictEqual(res.status, 0);
        assert.strictEqual(res.stdout, '', 'a parked session stays parked');
        assert.ok(fs.existsSync(path.join(repo, '.kit', 'goal-state.json')),
            'and the leash is still armed, which is what a park means');
        // A park emits nothing and writes nothing, so its allow is
        // indistinguishable from an unusable path that was never carried past
        // the absent branch. The control is the same repo with the park taken
        // away: the unusable path must then hold the stop and name itself. A
        // build that dropped the unusable-path feature allows both runs and this
        // second one goes red.
        writeTranscript(transcript, planRel, ['Still working through it.']);
        const control = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-w' }, local);
        assert.strictEqual(control.status, 0);
        assert.notStrictEqual(control.stdout, '', 'without the park the same path is held');
        assert.match(JSON.parse(control.stdout).reason, /does not hold a plan file any reader can resolve/);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('goal armed, a non-regular path at the plan file: the stop is held and named, never silently allowed', () => {
    // The kind check that keeps a FIFO from blocking this hook also refuses a
    // directory, a link and a junction, and planHead reports all of them the
    // way it reports an absent plan. fs.accessSync, which follows links and
    // succeeds on a directory, would answer "present" for exactly those paths,
    // and the branch would then take no action at all: every stop allowed, the
    // goal still armed, nothing reported anywhere. The two questions answer to
    // one lstat rule instead, and this case is what pins that.
    const { repo, planRel, transcript, local } = armedRepo(['Still going.']);
    try {
        fs.rmSync(path.join(repo, planRel));
        fs.mkdirSync(path.join(repo, planRel), { recursive: true });
        const res = runHook({ cwd: repo, transcript_path: transcript }, local);
        assert.strictEqual(res.status, 0);
        assert.notStrictEqual(res.stdout, '', 'a plan path that can never be read must not pass in silence');
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block');
        assert.match(out.reason, /does not hold a plan file/, out.reason);
        assert.ok(out.reason.includes(planRel), 'the reason names the path: ' + out.reason);
        assert.ok(fs.existsSync(path.join(repo, '.kit', 'goal-state.json')),
            'the leash stays armed: an unreadable kind is not an archived plan');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('goal armed, a directory-junction at the plan file is refused the same way a directory is', () => {
    // A junction is the link kind this box creates without privilege; a file
    // symlink needs one it lacks, so that kind stays unproven. libuv reports
    // both reparse tags as a link, so the junction drives the same branch.
    const { repo, planRel, transcript, local } = armedRepo(['Still going.']);
    try {
        const target = path.join(repo, 'link-target');
        fs.mkdirSync(target, { recursive: true });
        fs.rmSync(path.join(repo, planRel));
        fs.symlinkSync(target, path.join(repo, planRel), 'junction');
        const res = runHook({ cwd: repo, transcript_path: transcript }, local);
        assert.strictEqual(res.status, 0);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block');
        assert.match(out.reason, /does not hold a plan file/, out.reason);
        assert.ok(fs.existsSync(path.join(repo, '.kit', 'goal-state.json')), 'the leash stays armed');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

// The three transcript states that make the last turn unreadable, each paired
// with an unusable plan path. The release clauses read the transcript before
// the unusable path is reported, and that read throws on all three, so an
// uncaught throw would reach the hook's top-level catch and allow the stop:
// the leash would then permit every stop while still reporting itself armed,
// which is the one outcome the hold exists to prevent. On such a path no
// release clause can ever be evaluated and the plan can never reach Complete,
// so the hold is the only honest answer left.
// The binding is set directly rather than claimed from the transcript: the
// claim reads the transcript too, so an unbound goal with an unreadable one
// allows at that earlier point and never reaches the clauses under test. A
// bound session is also the live shape, since a leash enforcing at all has
// claimed its session at an earlier stop.
for (const variant of [
    { name: 'a transcript path naming a missing file', payload: (repo, tx) => ({ cwd: repo, transcript_path: tx + '.absent', session_id: 'sess-hold' }) },
    { name: 'a payload carrying no transcript_path at all', payload: (repo) => ({ cwd: repo, session_id: 'sess-hold' }) },
    { name: 'a transcript whose final line is a partial JSON entry', payload: (repo, tx) => ({ cwd: repo, transcript_path: tx, session_id: 'sess-hold' }), partial: true }
]) {
    test('an unusable plan path holds the stop when the transcript cannot be read: ' + variant.name, () => {
        const { repo, planRel, transcript, local } = armedRepo(['Still going.']);
        try {
            assert.strictEqual(bindSession(repo, 'sess-hold').ok, true, 'setup: the leash is bound');
            fs.rmSync(path.join(repo, planRel));
            fs.mkdirSync(path.join(repo, planRel), { recursive: true });
            if (variant.partial) {
                fs.appendFileSync(transcript,
                    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"te');
            }
            const res = runHook(variant.payload(repo, transcript), local);
            assert.strictEqual(res.status, 0);
            assert.notStrictEqual(res.stdout, '',
                'an unreadable transcript must not turn the hold into a silent allow');
            const out = JSON.parse(res.stdout);
            assert.strictEqual(out.decision, 'block');
            assert.match(out.reason, /does not hold a plan file/, out.reason);
            assert.ok(out.reason.includes(planRel), 'the reason names the path: ' + out.reason);
            assert.ok(fs.existsSync(path.join(repo, '.kit', 'goal-state.json')), 'the leash stays armed');
        } finally {
            rmDir(repo);
            rmDir(local);
        }
    });
}

test('an unreadable transcript on a usable plan path still allows the stop', () => {
    // The leg the hold must not break. A missing or half-written transcript on a
    // plan doc that reads fine is transient: the run can still make progress, and
    // the fail-open is what keeps a hook bug from trapping a session.
    const { repo, transcript, local } = armedRepo(['Still going.']);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript + '.absent' }, local);
        assert.strictEqual(res.status, 0);
        assert.strictEqual(res.stdout, '', 'a transient read failure allows, as it always has');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

// Make the plan path's lstat fail with a chosen code inside the spawned hook.
// Neither code this drives can be staged as a real fixture on this box: a
// regular file standing where a parent directory belongs reports ENOENT here
// rather than ENOTDIR (staged and observed), and a symlink cycle needs a
// privilege the suite must not require. The shim narrows to the plan path so
// every other lstat the hook takes, the goal state's included, is untouched.
function lstatFailingPreload(dir, code) {
    const shim = path.join(dir, 'lstat-' + code.toLowerCase() + '.js');
    writeFile(shim, [
        "'use strict';",
        "const fs = require('fs');",
        'const realLstatSync = fs.lstatSync;',
        'fs.lstatSync = function (target) {',
        "    if (String(target).replace(/\\\\/g, '/').endsWith('docs/plans/example.md')) {",
        "        const err = new Error('" + code + ": staged by the fixture, lstat');",
        "        err.code = '" + code + "';",
        '        throw err;',
        '    }',
        '    return realLstatSync.apply(fs, arguments);',
        '};'
    ].join('\n') + '\n');
    return '--require "' + shim.replace(/\\/g, '/') + '"';
}

// Report the plan path as a symlink over the ordinary regular file that is
// really there. A file symlink needs a privilege this box lacks (fs.symlinkSync
// returns EPERM), so this is what puts the link kind in front of the hook;
// realpathSync is left alone, so the link resolves for real, to a regular file
// inside the repo, which is what a linked plan doc looks like once resolved.
function linkReportingPreload(dir) {
    const shim = path.join(dir, 'report-link.js');
    writeFile(shim, [
        "'use strict';",
        "const fs = require('fs');",
        'const realLstatSync = fs.lstatSync;',
        'fs.lstatSync = function (target) {',
        '    const st = realLstatSync.apply(fs, arguments);',
        "    if (String(target).replace(/\\\\/g, '/').endsWith('docs/plans/example.md')) {",
        '        return {',
        '            size: st.size,',
        '            isFile: () => false,',
        '            isDirectory: () => false,',
        '            isSymbolicLink: () => true',
        '        };',
        '    }',
        '    return st;',
        '};'
    ].join('\n') + '\n');
    return '--require "' + shim.replace(/\\/g, '/') + '"';
}

test('a plan doc reached through a link inside the repo is read as a plan doc, not held', () => {
    // The kind check that refuses a directory or a FIFO must not refuse the one
    // non-regular kind that resolves to a readable plan doc. Refusing it leaves
    // the leash holding every stop over a plan the operator can open by hand,
    // until the harness's consecutive-block cap fires. The plan is Complete, so
    // reading it through the link is what releases the leash: an unread one
    // holds instead, which is the failure this pins.
    const { repo, transcript, local } = armedRepo(['Still going.'], 'Status: Complete');
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-link' }, local,
            { NODE_OPTIONS: linkReportingPreload(local) });
        assert.strictEqual(res.status, 0, 'exit 0: a nonzero exit would mean the preload itself failed to load');
        assert.strictEqual(res.stdout, '', 'the Complete plan releases the stop: ' + res.stdout);
        assert.ok(!fs.existsSync(path.join(repo, '.kit', 'goal-state.json')),
            'and the goal auto-cleared, which only a read of the linked plan can do');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

for (const code of ['ENOTDIR', 'ELOOP', 'ENAMETOOLONG']) {
    test('a plan path whose lstat fails ' + code + ' holds the stop rather than allowing it forever', () => {
        // All three codes are as permanent as a directory sitting at the path: a
        // regular file standing where a parent directory belongs (ENOTDIR), a
        // symlink cycle above the final component (ELOOP), and a path no
        // filesystem call will accept (ENAMETOOLONG). Nothing about waiting
        // turns any of them into a readable plan doc, so routing them to the
        // transient bucket is a leash that allows every stop while still
        // reporting itself armed.
        const { repo, planRel, transcript, local } = armedRepo(['Still going.']);
        try {
            assert.strictEqual(bindSession(repo, 'sess-kind').ok, true, 'setup: the leash is bound');
            const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-kind' }, local,
                { NODE_OPTIONS: lstatFailingPreload(local, code) });
            assert.strictEqual(res.status, 0, 'exit 0: a nonzero exit would mean the preload itself failed to load');
            assert.notStrictEqual(res.stdout, '', code + ' is determinate, so it must not pass in silence');
            const out = JSON.parse(res.stdout);
            assert.strictEqual(out.decision, 'block');
            assert.match(out.reason, /does not hold a plan file/, out.reason);
            assert.ok(out.reason.includes(planRel), 'the reason names the path: ' + out.reason);
            assert.ok(fs.existsSync(path.join(repo, '.kit', 'goal-state.json')), 'the leash stays armed');
        } finally {
            rmDir(repo);
            rmDir(local);
        }
    });
}

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

test('assistant text alone naming the plan does NOT leash: allow', () => {
    // The scoping predicate reads genuine USER-side command-args text only, so
    // an assistant echo of the plan path (e.g. quoting the session-start goal
    // surfacing back to the user) must never bind the leash.
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'assistant-echo.jsonl');
        const lines = [
            JSON.stringify({ type: 'user', message: { role: 'user', content: 'Help me with an unrelated task.' } }),
            JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'A kit goal is armed for ' + planRel + ' in this project.' }] } })
        ];
        writeFile(tx, lines.join('\n') + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'bystander-sess' }, local);
        assert.strictEqual(res.stdout, '', 'an assistant self-quote of the plan path must not leash the session');
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

function readBoundSession(repo) {
    return JSON.parse(fs.readFileSync(path.join(repo, '.kit', 'goal-state.json'), 'utf8')).boundSession;
}

test('unbound goal, a plain prose mention of the plan does NOT claim: allow, still unbound', () => {
    // A bystander that merely types or discusses the plan path in ordinary
    // prose (not as a slash-command argument) must not steal the binding: only
    // the genuine arming invocation (see the command-args test below) claims.
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'prose-mention.jsonl');
        writeFile(tx, JSON.stringify({
            type: 'user',
            message: { role: 'user', content: 'Please work ' + planRel + ' to completion.' }
        }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'sess-bystander' }, local);
        assert.strictEqual(res.stdout, '', 'a plain prose mention must not claim the binding');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('bound to another session: a plan-naming bystander is not leashed: allow', () => {
    // The transcript carries the arming invocation, so this also pins the order:
    // an existing binding gates before the command-args claim, and a session that
    // is not the bound one is allowed even when its text would otherwise claim.
    const { repo, transcript, local } = armedRepo(['Working hard, mentioning docs/plans/example.md often.']);
    try {
        assert.strictEqual(bindSession(repo, 'sess-owner').ok, true);
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-bystander' }, local);
        assert.strictEqual(res.stdout, '', 'only the bound session is leashed');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), 'sess-owner', 'the bystander does not steal the binding');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('bound to this session (case-insensitive): a non-BLOCKED turn still blocks (a case-sensitive compare would misread this as a bystander and allow)', () => {
    const { repo, transcript, local } = armedRepo(['Making progress.']);
    try {
        assert.strictEqual(bindSession(repo, 'sess-me').ok, true);
        // The stopping session_id differs only in case from the bound value. A
        // case-sensitive compare would fail to recognize it as the bound session,
        // fall through to "some other session", and allow (empty stdout) - the
        // same outcome a correct compare produces on a genuine BLOCKED lead, which
        // is why that shape cannot tell the two implementations apart. A non-
        // BLOCKED last turn can: only the correct case-insensitive match reaches
        // enforcement and blocks.
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'SESS-ME' }, local);
        assert.strictEqual(res.status, 0);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'the case-differing bound session is still enforced');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('the /kit-goal arming invocation (command-args) binds the leash and enforces', () => {
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'arming.jsonl');
        // Real slash-command invocation shape: a user entry whose string content
        // carries <command-name>/<command-args>; the plan path the user typed as
        // the argument is the deliberate arming signal.
        const invocation = '<command-name>/kit-goal</command-name>\n            '
            + '<command-message>kit-goal</command-message>\n            '
            + '<command-args>' + planRel + '</command-args>';
        writeFile(tx, JSON.stringify({ type: 'user', message: { role: 'user', content: invocation } }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'arming-sess' }, local);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'the arming invocation leashes and enforces');
        assert.strictEqual(readBoundSession(repo), 'arming-sess');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a non-kit-goal command (/graphify) carrying the plan path in its args does NOT claim: allow', () => {
    // /graphify legitimately takes a path argument; a plan path in ITS
    // command-args must not steal the binding from the arming session. Only a
    // kit-goal invocation's command-args counts as an arming claim.
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'graphify.jsonl');
        writeFile(tx, JSON.stringify({
            type: 'user', isSidechain: false,
            message: {
                role: 'user',
                content: '<command-message>graphify</command-message>\n'
                    + '<command-name>/graphify</command-name>\n'
                    + '<command-args>' + planRel + '</command-args>'
            }
        }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'graphify-sess' }, local);
        assert.strictEqual(res.stdout, '', 'a non-kit-goal command must not claim the binding');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('the real namespaced /kit-goal arming record (backtick-wrapped args) binds the leash', () => {
    const repo = makeDir('kit-goal-stop-repo-');
    const local = makeDir('kit-goal-stop-local-');
    const planRel = 'docs/plans/claude-kit_goal-continuity_spec_v1.md';
    try {
        writeFile(path.join(repo, planRel), 'Status: In Progress\n\nbody\n');
        assert.strictEqual(armGoal(repo, planRel).ok, true);
        const tx = path.join(repo, 'arming.jsonl');
        // Verbatim real arming record: namespaced command-name (/claude-kit:kit-goal),
        // no isMeta field, backtick-wrapped args value. The substring match tolerates
        // the backticks, and the command-name gate accepts the ':kit-goal' suffix.
        writeFile(tx, JSON.stringify({
            type: 'user', isSidechain: false,
            message: {
                role: 'user',
                content: '<command-message>claude-kit:kit-goal</command-message>\n'
                    + '<command-name>/claude-kit:kit-goal</command-name>\n'
                    + '<command-args>`' + planRel + '`</command-args>'
            }
        }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'arming-sess' }, local);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'the namespaced arming invocation leashes and enforces');
        assert.strictEqual(readBoundSession(repo), 'arming-sess');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a multi-line typed /kit-goal (no harness markup) binds the leash and enforces', () => {
    // The harness writes <command-name>/<command-args> markup only when the
    // command and its arguments share the message's first line; a multi-line
    // /kit-goal with one plan path per line lands as plain prose. The typed-
    // lead shape makes that user-typed arming claimable: the message's first
    // non-whitespace characters are the command token, and the plan path
    // rides after it.
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'typed-multiline.jsonl');
        const lines = [
            JSON.stringify({ type: 'user', message: { role: 'user', content: '/kit-goal\n' + planRel } }),
            JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Working on it.' }] } })
        ];
        writeFile(tx, lines.join('\n') + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'typed-arming-sess' }, local);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'the multi-line typed arming leashes and enforces');
        assert.strictEqual(readBoundSession(repo), 'typed-arming-sess');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a namespaced typed lead (/claude-kit:kit-goal <path>, no markup) binds the leash and enforces', () => {
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'typed-namespaced.jsonl');
        writeFile(tx, JSON.stringify({
            type: 'user',
            message: { role: 'user', content: '/claude-kit:kit-goal ' + planRel }
        }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'typed-ns-sess' }, local);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'the namespaced typed lead leashes and enforces');
        assert.strictEqual(readBoundSession(repo), 'typed-ns-sess');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('prose before the command token does NOT claim: allow, still unbound', () => {
    // The lead anchor is the anti-steal boundary: a message that quotes or
    // reports the command after prose is discussion, not arming, and the
    // harness's own single-line parsing would not have produced an invocation
    // record for it either.
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'prose-lead.jsonl');
        writeFile(tx, JSON.stringify({
            type: 'user',
            message: { role: 'user', content: 'Here is what I ran:\n/kit-goal ' + planRel }
        }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'prose-lead-sess' }, local);
        assert.strictEqual(res.stdout, '', 'a prose-led command mention must not claim the binding');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a code fence containing the command does NOT claim: allow, still unbound', () => {
    // A fenced command is quoted material: the message's first non-whitespace
    // character is the backtick, not the command token, so the lead anchor
    // refuses it.
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'fenced-lead.jsonl');
        writeFile(tx, JSON.stringify({
            type: 'user',
            message: { role: 'user', content: '```\n/kit-goal ' + planRel + '\n```' }
        }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'fenced-sess' }, local);
        assert.strictEqual(res.stdout, '', 'a code-fenced command must not claim the binding');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a lead naming /kit-goal-notes.md does NOT claim (token boundary): allow, still unbound', () => {
    // The lookahead after the command token is the boundary: a longer word
    // that merely starts with the token (a file reference, a hyphenated name)
    // is not the command.
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'token-boundary.jsonl');
        writeFile(tx, JSON.stringify({
            type: 'user',
            message: { role: 'user', content: '/kit-goal-notes.md ' + planRel }
        }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'boundary-sess' }, local);
        assert.strictEqual(res.stdout, '', 'a longer token starting with /kit-goal must not claim');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a tool-block entry whose text leads with the command does NOT claim: allow, still unbound', () => {
    // The whole-entry discard governs the typed-lead shape too: an entry
    // mixing tool output with a command-leading text block is one where
    // planted text could ride beside a real turn, so it never claims.
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'tool-block-lead.jsonl');
        writeFile(tx, JSON.stringify({
            type: 'user',
            message: {
                role: 'user',
                content: [
                    { type: 'tool_result', tool_use_id: 'x', content: 'file contents' },
                    { type: 'text', text: '/kit-goal ' + planRel }
                ]
            }
        }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'tool-lead-sess' }, local);
        assert.strictEqual(res.stdout, '', 'a tool-block entry must not claim, whatever its text leads with');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('an assistant entry leading with the command does NOT claim: allow, still unbound', () => {
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'assistant-lead.jsonl');
        const lines = [
            JSON.stringify({ type: 'user', message: { role: 'user', content: 'Help me with an unrelated task.' } }),
            JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '/kit-goal ' + planRel } ] } })
        ];
        writeFile(tx, lines.join('\n') + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'assistant-lead-sess' }, local);
        assert.strictEqual(res.stdout, '', 'an assistant turn leading with the command must not self-leash');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a lead-token arming of ANOTHER plan mentioning the armed path after a blank line does NOT claim', () => {
    // The needle counts only inside the argument block, which a blank line
    // ends: a bystander genuinely arming plan B whose message body then
    // mentions armed plan A must not steal A's binding.
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'blank-line-boundary.jsonl');
        writeFile(tx, JSON.stringify({
            type: 'user',
            message: { role: 'user', content: '/kit-goal docs/plans/other.md\n\nAlso relevant: ' + planRel }
        }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'blank-line-sess' }, local);
        assert.strictEqual(res.stdout, '', 'a mention behind a blank line must not claim the binding');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a lead-token arming of ANOTHER plan with the armed path only inside a trailing code fence does NOT claim', () => {
    // A fence line ends the argument block: quoted material after the typed
    // path list must never supply the needle.
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'fence-boundary.jsonl');
        writeFile(tx, JSON.stringify({
            type: 'user',
            message: { role: 'user', content: '/kit-goal docs/plans/other.md\n```\n' + planRel + '\n```' }
        }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'fence-boundary-sess' }, local);
        assert.strictEqual(res.stdout, '', 'a fenced mention after the path list must not claim the binding');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a lead-token message with the armed path only in a tag-opening line does NOT claim', () => {
    // A line whose first non-whitespace character is '<' ends the argument
    // block: injected tag-shaped material (an appended attachment-style text
    // block arrives '\n'-joined onto the typed text) must never supply the
    // needle.
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'tag-boundary.jsonl');
        writeFile(tx, JSON.stringify({
            type: 'user',
            message: { role: 'user', content: '/kit-goal docs/plans/other.md\n<attachment>' + planRel + '</attachment>' }
        }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'tag-boundary-sess' }, local);
        assert.strictEqual(res.stdout, '', 'a tag-line mention after the path list must not claim the binding');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a literal backslash lead (\\kit-goal <path>) does NOT claim: the token gets no separator tolerance', () => {
    // The lead anchor runs on the UN-normalized text: separator normalization
    // exists for path comparison, and a '\\kit-goal' lead is not a command the
    // harness would ever execute, so it must not normalize into one.
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'backslash-lead.jsonl');
        writeFile(tx, JSON.stringify({
            type: 'user',
            message: { role: 'user', content: '\\kit-goal ' + planRel }
        }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'backslash-sess' }, local);
        assert.strictEqual(res.stdout, '', 'a backslash lead must not claim the binding');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('an upper-case typed lead (/KIT-GOAL <path>) DOES claim: the token match is case-insensitive', () => {
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'upper-case-lead.jsonl');
        writeFile(tx, JSON.stringify({
            type: 'user',
            message: { role: 'user', content: '/KIT-GOAL ' + planRel }
        }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'upper-sess' }, local);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'a case-variant typed lead leashes and enforces');
        assert.strictEqual(readBoundSession(repo), 'upper-sess');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a multi-segment namespaced lead (/a:b:kit-goal <path>) DOES claim, agreeing with the markup suffix rule', () => {
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'multi-segment-lead.jsonl');
        writeFile(tx, JSON.stringify({
            type: 'user',
            message: { role: 'user', content: '/a:b:kit-goal ' + planRel }
        }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'multi-ns-sess' }, local);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'a multi-segment namespaced lead leashes and enforces');
        assert.strictEqual(readBoundSession(repo), 'multi-ns-sess');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('typed text after a stripped local-command block that leads with the token DOES claim (strip runs before the anchor)', () => {
    // Text outside the local-command wrappers is treated as typed, by design:
    // the strip removes the CLI's own echo, and what survives leads the
    // message, so a contiguous token-plus-path there is arming intent.
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'strip-then-anchor.jsonl');
        writeFile(tx, JSON.stringify({
            type: 'user',
            message: {
                role: 'user',
                content: '<local-command-stdout>kit goal armed for docs/plans/other.md</local-command-stdout>'
                    + '/kit-goal ' + planRel
            }
        }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'strip-anchor-sess' }, local);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'the typed lead after the stripped block leashes and enforces');
        assert.strictEqual(readBoundSession(repo), 'strip-anchor-sess');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a local-command-stdout echoing the plan path does NOT bind (a /kit-goal status check in a bystander)', () => {
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'status.jsonl');
        // Real /kit-goal status flow: the user types `status` (no plan path in the
        // args), and the CLI echoes the armed plan path back inside a
        // <local-command-stdout> block. That echo is the CLI's own output, not
        // user-typed text, so a bystander that merely checked status must not bind.
        const lines = [
            JSON.stringify({ type: 'user', message: { role: 'user', content: 'Look at the login page.' } }),
            JSON.stringify({ type: 'user', message: { role: 'user', content: '<command-name>/kit-goal</command-name>\n            <command-args>status</command-args>' } }),
            JSON.stringify({ type: 'user', message: { role: 'user', content: '<local-command-stdout>kit goal armed for ' + planRel + ' (armed 2026-07-16T00:00:00.000Z; unbound)</local-command-stdout>' } })
        ];
        writeFile(tx, lines.join('\n') + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'bystander' }, local);
        assert.strictEqual(res.stdout, '', 'a status echo of the plan path must not leash a bystander');
        assert.strictEqual(res.status, 0);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

// Synthetic session ids of the harness's own shape, which is what the arming
// identity a state records is held to.
const ARM_SESSION = '3b9c1d20-7a41-4e6d-8f25-11c0de4a7b90';
const OTHER_SESSION = '5d2e88a4-0c13-4f77-9ab6-62f0aa31c5de';

// Arm a goal whose bind could not be corroborated: an id of the right shape
// with no transcript resolving for it. The goal is unbound and records that id
// as the session that ran the arm, which is the state a run arming a plan for
// itself lands in when its own transcript file is not resolvable at the arm.
function unboundArmedRepo(armingId) {
    const repo = makeDir('kit-goal-stop-repo-');
    const local = makeDir('kit-goal-stop-local-');
    const planRel = 'docs/plans/example.md';
    writeFile(path.join(repo, planRel), 'Status: In Progress\n\nbody\n');
    const armed = armGoal(repo, planRel, { sessionId: armingId, transcriptPath: null });
    assert.strictEqual(armed.ok, true, 'test setup: goal should arm');
    assert.strictEqual(armed.boundSession, null, 'test setup: the goal should arm unbound');
    return { repo, planRel, local };
}

// A transcript carrying only the given entries, with none of the arming-command
// markup writeTranscript prepends: the cases below isolate the claim route that
// reads no transcript text at all, so any text that could claim on its own would
// make them pass for the wrong reason.
function writeBareTranscript(full, entries) {
    writeFile(full, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function assistantEntry(text) {
    return { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } };
}

test('unbound goal recording this session as the one that armed it: it claims and is leashed', () => {
    // The arming session's own id is the claim, so a run that armed a plan for
    // itself and typed no command holds the leash it armed. Its transcript
    // carries no arming markup, so nothing here could claim by the typed route.
    const { repo, local } = unboundArmedRepo(ARM_SESSION);
    try {
        const tx = path.join(repo, 'self-armed.jsonl');
        writeBareTranscript(tx, [assistantEntry('Working the section.')]);
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: ARM_SESSION }, local);
        assert.strictEqual(res.status, 0);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'the arming session is leashed at its own first stop');
        assert.strictEqual(readBoundSession(repo), ARM_SESSION, 'and the claim records the binding');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('the claim at a stop adopts an ownerless checkpoint, and leaves another session\'s alone', () => {
    // A boundary declared before anything held the leash records no owner. The
    // claim adopts it, so the next auto-compaction offer reads a checkpoint
    // whose owner is the session the leash now belongs to; a record already
    // naming a session is another run's and is never rewritten.
    const { repo, planRel, local } = unboundArmedRepo(ARM_SESSION);
    try {
        const tx = path.join(repo, 'self-armed.jsonl');
        writeBareTranscript(tx, [assistantEntry('Working the section.')]);
        assert.strictEqual(writeCheckpoint(repo, planRel, null, false, ARM_SESSION).ok, true, 'test setup: checkpoint should write');
        runHook({ cwd: repo, transcript_path: tx, session_id: ARM_SESSION }, local);
        assert.strictEqual(readBoundSession(repo), ARM_SESSION, 'the stop claimed the binding');
        assert.strictEqual(readCheckpoint(repo).boundSession, ARM_SESSION,
            'and the boundary it banked while unbound is now its own');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a claim at a stop leaves a checkpoint belonging to another session alone', () => {
    // The control for the adoption above: wrong-session is the leg that keeps a
    // crashed run's orphan from opening the gate for the run that resumes its
    // plan, and a claim must not spend it.
    const { repo, planRel, local } = unboundArmedRepo(ARM_SESSION);
    try {
        const tx = path.join(repo, 'self-armed.jsonl');
        writeBareTranscript(tx, [assistantEntry('Working the section.')]);
        assert.strictEqual(writeCheckpoint(repo, planRel, OTHER_SESSION, false, OTHER_SESSION).ok, true,
            'test setup: checkpoint should write');
        runHook({ cwd: repo, transcript_path: tx, session_id: ARM_SESSION }, local);
        assert.strictEqual(readBoundSession(repo), ARM_SESSION, 'the stop claimed the binding');
        assert.strictEqual(readCheckpoint(repo).boundSession, OTHER_SESSION,
            'the other session keeps its record');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('unbound goal recording another session: a bystander naming the plan does NOT claim', () => {
    const { repo, planRel, local } = unboundArmedRepo(ARM_SESSION);
    try {
        const tx = path.join(repo, 'prose-mention.jsonl');
        writeBareTranscript(tx, [
            { type: 'user', message: { role: 'user', content: 'Please work ' + planRel + ' to completion.' } },
            assistantEntry('Reading the plan.')
        ]);
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: OTHER_SESSION }, local);
        assert.strictEqual(res.stdout, '', 'a session that is neither the arming one nor a typed claim is allowed');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a bystander whose transcript names the recorded arming id does NOT claim', () => {
    // The forgery control on this route: the evidence is the session's own id
    // rather than anything in a transcript, so a session whose command output
    // names the recorded arming id, in the shape most likely to be mistaken for
    // evidence, still stops as a bystander.
    const { repo, planRel, local } = unboundArmedRepo(ARM_SESSION);
    try {
        const tx = path.join(repo, 'echoed-arm.jsonl');
        writeBareTranscript(tx, [
            {
                type: 'user',
                message: {
                    role: 'user',
                    content: '<local-command-stdout>kit goal armed for ' + planRel
                        + ' (unbound; arming session ' + ARM_SESSION + ')</local-command-stdout>'
                }
            },
            assistantEntry('That is what the state says.')
        ]);
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: OTHER_SESSION }, local);
        assert.strictEqual(res.stdout, '', 'echoed text naming the arming id must not claim');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a payload session id that is not session-id shaped claims nothing against a shaped arming session', () => {
    // The state side is intact here: a properly shaped arming id the normalizer
    // passes through untouched. What is malformed is the payload's own session
    // id, which arrives as hook JSON this process does not control. The compare
    // runs through String() and a trim, so a padded copy of the recorded id
    // equals it; the shape test on the payload id is the only thing that refuses
    // it, and a claim on it would write the padded value as the binding.
    const { repo, local } = unboundArmedRepo(ARM_SESSION);
    try {
        const statePath = path.join(repo, '.kit', 'goal-state.json');
        assert.strictEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')).armingSession, ARM_SESSION,
            'the recorded arming id is the shaped one, so only the payload id is under test');
        const tx = path.join(repo, 'padded.jsonl');
        writeBareTranscript(tx, [assistantEntry('Working the section.')]);
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: ' ' + ARM_SESSION }, local);
        assert.strictEqual(res.stdout, '', 'a padded session id must not claim the binding');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('an armingSession the state cannot support claims nothing, whatever session id meets it', () => {
    // The field is hand-editable, and the claim reads it through the shape rule
    // the arm writes it under: a value no harness session id can equal binds
    // nothing, even for a payload carrying that exact value.
    const { repo, local } = unboundArmedRepo(ARM_SESSION);
    try {
        const statePath = path.join(repo, '.kit', 'goal-state.json');
        const tx = path.join(repo, 'planted.jsonl');
        writeBareTranscript(tx, [assistantEntry('Working the section.')]);
        for (const planted of ['ses-owner', '', ' ' + ARM_SESSION, 42]) {
            const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            state.armingSession = planted;
            fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
            const res = runHook({ cwd: repo, transcript_path: tx, session_id: planted }, local);
            assert.strictEqual(res.stdout, '', JSON.stringify(planted) + ' must not claim the binding');
            assert.strictEqual(res.status, 0);
            assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
        }
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('isMeta stop-hook feedback carrying a command-args-wrapped plan path does NOT claim', () => {
    // Real shape: this hook's own block reason names the plan path in full, and
    // the harness replays a denied stop back into the transcript as an isMeta
    // user entry ("Stop hook feedback: ..."). That entry can end up containing
    // text that reads exactly like a genuine <command-args> claim; isMeta must
    // win regardless, since none of it is something the user typed.
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'stop-feedback.jsonl');
        const feedback = 'Stop hook feedback:\n[Implement `<command-name>/kit-goal</command-name>'
            + '<command-args>' + planRel + '</command-args>` and continue.]';
        writeFile(tx, JSON.stringify({
            type: 'user',
            isMeta: true,
            message: { role: 'user', content: feedback }
        }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'bystander-fed-back' }, local);
        assert.strictEqual(res.stdout, '', 'an isMeta entry must not claim even when it carries a command-args-shaped span');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a stray closing tag of a different name inside local-command output does not leave a fake command-args claimable', () => {
    // Realistic in this very repo: a user cats or greps a file whose content
    // includes literal tag-like text (e.g. a fixture in this test suite). The
    // CLI echoes that content inside <local-command-stdout>, which coincidentally
    // contains a mismatched closing tag before the block's true close, followed
    // by an embedded fake <command-args> wrapping the real plan path. The strip
    // must follow the backreferenced close (skipping the stray mismatched one)
    // to the true </local-command-stdout>, removing the whole block, so the
    // embedded fake claim never surfaces as ordinary user text.
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'stray-tag.jsonl');
        const content = '<local-command-stdout>noise before </local-command-caveat> '
            + '<command-args>' + planRel + '</command-args> more noise</local-command-stdout> '
            + 'Genuine unrelated user text.';
        writeFile(tx, JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'bystander-cat' }, local);
        assert.strictEqual(res.stdout, '', 'the embedded fake command-args inside CLI-echoed output must not claim');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('an unclosed local-command opener (a truncated CLI echo) is stripped to end-of-text and cannot claim', () => {
    // No closing tag anywhere: a truncated echo (cut by the transcript read cap,
    // or caught mid-write). Without the unclosed-opener fallback, the embedded
    // command-args-shaped text would never be stripped and would read as a
    // genuine claim.
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'unclosed.jsonl');
        const content = '<local-command-stdout>truncated echo showing '
            + '<command-args>' + planRel + '</command-args> partial output cut off';
        writeFile(tx, JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'bystander-trunc' }, local);
        assert.strictEqual(res.stdout, '', 'an unclosed opener\'s content must not claim');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('an embedded same-name close tag inside CLI output cannot expose a following fake kit-goal claim', () => {
    // The one strip failure mode that errs toward CLAIMING: echoed stdout (e.g. a
    // catted transcript) embeds a literal </local-command-stdout>, then a fake
    // kit-goal command-name plus command-args naming the plan, before the block's
    // true close. A lazy strip would stop at the embedded close and leave the fake
    // claim exposed; the greedy strip runs to the LAST same-name close, removing
    // the whole block so nothing between the opener and its final close survives.
    const { repo, planRel, local } = armedRepo(['unused']);
    try {
        const tx = path.join(repo, 'embedded-close.jsonl');
        const content = '<local-command-stdout>cat transcript: </local-command-stdout>'
            + '<command-name>/kit-goal</command-name><command-args>' + planRel + '</command-args>'
            + ' end of cat</local-command-stdout> Genuine unrelated text.';
        writeFile(tx, JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
        const res = runHook({ cwd: repo, transcript_path: tx, session_id: 'bystander-cat' }, local);
        assert.strictEqual(res.stdout, '', 'an embedded close tag must not expose a following fake command-args claim');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), null, 'the goal stays unbound');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

// Spawn the hook with writeRefusingPreload (defined below, beside its other
// user) in place, so the atomic write bindSession attempts fails inside the
// child. That preload refuses by path prefix, which is what this case needs:
// the temp name carries a random suffix (see atomicTmpPath in kit-goal-lib.js,
// whose point is that the name cannot be guessed from outside the writing
// process), so no parent can occupy the exact path its child is about to
// create. The refusal is installed before the hook module runs, so it is
// deterministic rather than timing-dependent.
function runHookForcingBindWriteFailure(repo, payload, extraEnv) {
    const env = {
        ...scrubRunEnv({ ...process.env }),
        KIT_GOAL_STOP_RETRY_MS: '0',
        KIT_EVENTS_PATH: eventsPath(repo),
        KIT_EVENTS_PATH_ALLOW: '1',
        NODE_OPTIONS: writeRefusingPreload(repo),
        ...(extraEnv || {})
    };
    const child = spawn(process.execPath, [HOOK], { env });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    const closed = new Promise((resolve) => child.on('close', (status) => resolve(status)));
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
    return closed.then((status) => ({ stdout, status }));
}

test('a bind write failure still enforces that stop (fail-open on persistence, not enforcement)', async () => {
    const { repo, transcript, local } = armedRepo(['Making progress.']);
    try {
        // The goal-state.json itself is still readable (unbound), so the session
        // resolves via the arming-invocation claim and must still be enforced.
        const res = await runHookForcingBindWriteFailure(
            repo, { cwd: repo, transcript_path: transcript, session_id: 'sess-x' });
        assert.strictEqual(res.status, 0, 'exit 0: a nonzero exit would mean the preload itself failed to load');
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'enforcement proceeds even when the bind write fails');
        assert.strictEqual(readBoundSession(repo), null, 'the failed bind did not persist');
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
            JSON.stringify({ type: 'user', message: { role: 'user', content: '<command-name>/kit-goal</command-name><command-args>' + planRel + '</command-args>' } }),
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

test('stop_hook_active true: still blocks (the leash re-evaluates every stop attempt)', () => {
    // The harness's own consecutive-block cap (CLAUDE_CODE_STOP_HOOK_BLOCK_CAP)
    // is the loop backstop; the hook itself must keep holding inside a stop
    // continuation, or the leash is one-shot per turn.
    const { repo, transcript, local } = armedRepo(['Making progress.']);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, stop_hook_active: true }, local);
        assert.strictEqual(res.status, 0);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'a stop-hook continuation must not release the leash');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a mid-append partial final line makes the last turn indeterminate: allow', () => {
    // The harness appends the turn's final entries (assistant text, stop-time
    // metadata) around the same moment the Stop hook runs. A read that lands
    // mid-append sees a truncated JSON fragment as the last line; the last turn
    // is then indeterminate and the stop must be allowed, not answered from the
    // previous turn's text. The file is far below the 1MB tail cap, so this
    // exercises the mid-write guard, not the cap-truncation guard.
    const { repo, transcript, local } = armedRepo(['Making progress.']);
    try {
        fs.appendFileSync(transcript,
            '{"type":"assistant","message":{"role":"assistant","content":[{"type":"te');
        const res = runHook({ cwd: repo, transcript_path: transcript }, local);
        assert.strictEqual(res.stdout, '', 'a mid-write tail must be indeterminate (allow), not read as the prior turn');
        assert.strictEqual(res.status, 0);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('clause (b) tolerates the stop-time flush race: a BLOCKED entry landing just after the stop still allows', async () => {
    // Live-observed race: the hook can evaluate before the harness's append of
    // the final assistant text entry is readable, so a genuine 'BLOCKED:' exit
    // was answered from the previous turn and blocked. The hook re-reads after
    // a short delay; an entry that lands inside that window must be honored.
    // Probabilistic pin: if child spawn plus first read ever exceeds the 250ms
    // append delay, the first read already sees the entry and the retry path is
    // not exercised that run; the test can green vacuously on a slow machine
    // but can never falsely fail (any ordering yields an allow).
    const { repo, transcript, local } = armedRepo(['Working; about to surface a blocker.']);
    try {
        const env = scrubRunEnv({
            ...process.env,
            KIT_GOAL_STOP_RETRY_MS: '900',
            KIT_EVENTS_PATH: eventsPath(local),
            KIT_EVENTS_PATH_ALLOW: '1'
        });
        const child = spawn(process.execPath, [HOOK], { env });
        let stdout = '';
        child.stdout.on('data', (d) => { stdout += d; });
        const closed = new Promise((resolve) => child.on('close', resolve));
        child.stdin.write(JSON.stringify({ cwd: repo, transcript_path: transcript }));
        child.stdin.end();
        // Land the BLOCKED entry after the hook's first read, inside its retry window.
        await new Promise((resolve) => setTimeout(resolve, 250));
        fs.appendFileSync(transcript, JSON.stringify({
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'text', text: 'BLOCKED: needs a supervised step.' }] }
        }) + '\n');
        await closed;
        assert.strictEqual(stdout, '', 'the late-landing BLOCKED entry must be seen by the clause-(b) re-read');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a partial final line that completes into a non-BLOCKED entry inside the retry window: block', async () => {
    // The other half of the mid-append guard: a partial tail is retried, not
    // allowed on first sighting, so when the in-flight append resolves to an
    // ordinary (non-BLOCKED) turn inside the window, the leash correctly holds.
    const { repo, transcript, local } = armedRepo(['Making progress.']);
    try {
        const full = JSON.stringify({
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'text', text: 'Just progress, not a blocker.' }] }
        });
        fs.appendFileSync(transcript, full.slice(0, 40));
        const env = scrubRunEnv({
            ...process.env,
            KIT_GOAL_STOP_RETRY_MS: '900',
            KIT_EVENTS_PATH: eventsPath(local),
            KIT_EVENTS_PATH_ALLOW: '1'
        });
        const child = spawn(process.execPath, [HOOK], { env });
        let stdout = '';
        child.stdout.on('data', (d) => { stdout += d; });
        const closed = new Promise((resolve) => child.on('close', resolve));
        child.stdin.write(JSON.stringify({ cwd: repo, transcript_path: transcript }));
        child.stdin.end();
        // Complete the in-flight entry inside the hook's retry window.
        await new Promise((resolve) => setTimeout(resolve, 250));
        fs.appendFileSync(transcript, full.slice(40) + '\n');
        await closed;
        const out = JSON.parse(stdout);
        assert.strictEqual(out.decision, 'block', 'a partial tail resolving to a non-BLOCKED turn must still block');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('KIT_GOAL_STOP_RETRY_MS parsing fails open and never throws: 0, garbage, and mixed junk all still block promptly', () => {
    // The env boundary of the retry schedule: a disable ('0'), pure garbage, and
    // a mixed junk list must all degrade to "no retries" (or sane clamped
    // delays), never to a throw, which the top-level catch would turn into a
    // silent allow on every leashed stop.
    const { repo, transcript, local } = armedRepo(['Making progress.']);
    try {
        for (const raw of ['0', 'garbage', '-5,abc']) {
            const res = runHook({ cwd: repo, transcript_path: transcript }, local,
                { KIT_GOAL_STOP_RETRY_MS: raw });
            assert.strictEqual(res.status, 0, `retry env '${raw}' must not crash the hook`);
            const out = JSON.parse(res.stdout);
            assert.strictEqual(out.decision, 'block', `retry env '${raw}' must still block`);
        }
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('malformed stdin: empty stdout, exit 0 (never throws)', () => {
    // This payload never resolves a project, so it cannot reach an emit; the
    // sink is still pinned into a temp root of this case's own, so the spawn
    // has no path to the real event stream at all.
    const local = makeDir('kit-goal-stop-local-');
    try {
        const env = scrubRunEnv({ ...process.env, KIT_EVENTS_PATH: eventsPath(local), KIT_EVENTS_PATH_ALLOW: '1' });
        const res = spawnSync(process.execPath, [HOOK], { input: 'not json', env, encoding: 'utf8' });
        assert.strictEqual(res.stdout, '');
        assert.strictEqual(res.status, 0);
    } finally {
        rmDir(local);
    }
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

test('release event: a Complete plan emits exactly one goal-complete/plan-complete line with the full schema', () => {
    const { repo, planRel, transcript, local } = armedRepo(['Done all sections.'], 'Status: Complete');
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-releaser' }, local);
        assert.strictEqual(res.stdout, '');
        const events = readEvents(local);
        assert.strictEqual(events.length, 1, 'a release emits exactly one event');
        const ev = events[0];
        assert.deepStrictEqual(Object.keys(ev), ['ts', 'event', 'project', 'plan', 'session', 'detail']);
        assert.strictEqual(ev.event, 'goal-complete');
        assert.strictEqual(ev.project, repo, 'project is the absolute project path from the payload');
        assert.strictEqual(ev.plan, planRel, 'plan is the repo-relative plan path');
        assert.strictEqual(ev.session, 'sess-releaser');
        assert.strictEqual(ev.detail, 'plan-complete');
        assert.ok(!Number.isNaN(Date.parse(ev.ts)));
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('release event: a real KIT_RUN_ID reaches the stream through the actual producer, in the fleet configuration the field exists for', () => {
    // The field's only other coverage is in-process against kit-goal-lib.js
    // directly (kit-goal-lib.test.js); this exercises it through the real
    // Stop-hook release path, spawned, the shape a fleet worker actually
    // produces. extraEnv survives scrubRunEnv here because runHook scrubs the
    // ambient copy before merging extraEnv in, not after.
    const { repo, planRel, transcript, local } = armedRepo(['Done all sections.'], 'Status: Complete');
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-releaser' }, local,
            { KIT_RUN_ID: 'fleet-run-1' });
        assert.strictEqual(res.stdout, '');
        const events = readEvents(local);
        assert.strictEqual(events.length, 1);
        const ev = events[0];
        assert.deepStrictEqual(Object.keys(ev), ['ts', 'event', 'project', 'plan', 'session', 'detail', 'run']);
        assert.strictEqual(ev.run, 'fleet-run-1');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('release event: an archived plan (file gone) emits goal-complete with detail plan-archived', () => {
    const { repo, planRel, transcript, local } = armedRepo(['Still going.']);
    try {
        fs.rmSync(path.join(repo, planRel));
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-archiver' }, local);
        assert.strictEqual(res.stdout, '');
        const events = readEvents(local);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].event, 'goal-complete');
        assert.strictEqual(events[0].detail, 'plan-archived', 'the archived release is distinguishable from a Complete one');
        assert.strictEqual(events[0].plan, planRel);
        assert.strictEqual(events[0].session, 'sess-archiver');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('release event: a BLOCKED lead emits goal-blocked and carries no detail', () => {
    const { repo, planRel, transcript, local } = armedRepo([
        'Investigating the failure.',
        'BLOCKED: this needs a decision only Scott can make.'
    ]);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-blocked' }, local);
        assert.strictEqual(res.stdout, '');
        const events = readEvents(local);
        assert.strictEqual(events.length, 1);
        assert.deepStrictEqual(Object.keys(events[0]), ['ts', 'event', 'project', 'plan', 'session']);
        assert.strictEqual(events[0].event, 'goal-blocked');
        assert.strictEqual(events[0].plan, planRel);
        assert.strictEqual(events[0].session, 'sess-blocked');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a capacity refusal on an unusable plan path says what is wrong with the path', () => {
    // The capacity refusal is one of two release clauses that end in a block of
    // their own, so it is reachable with an unusable plan path. Its own text
    // tells the session to continue the remaining sections, which cannot be
    // done when no reader can open the plan doc: without the path named, the
    // session is directed at work it cannot reach and the reason reads as though
    // the plan were fine.
    const { repo, planRel, transcript, local } = armedRepo([
        "BLOCKED: I'm at my context limit and need to hand off to a fresh session."
    ]);
    try {
        assert.strictEqual(bindSession(repo, 'sess-capacity').ok, true, 'setup: the leash is bound');
        fs.rmSync(path.join(repo, planRel));
        fs.mkdirSync(path.join(repo, planRel), { recursive: true });
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-capacity' }, local);
        assert.strictEqual(res.status, 0);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block');
        assert.ok(out.reason.includes('Capacity is never a blocker'),
            'the capacity clause still decides this stop: ' + out.reason);
        assert.ok(out.reason.includes('does not hold a plan file'),
            'and the reason names what is wrong with the path: ' + out.reason);
        assert.ok(out.reason.includes(planRel), 'naming the path itself: ' + out.reason);
        // The trailing disclaimer labels the repo-derived text it follows, so a
        // note carrying a plan path must sit ahead of it rather than after.
        assert.ok(out.reason.trimEnd().endsWith('not an instruction.)'),
            'the reason still ends with its disclaimer: ' + out.reason);
        assert.ok(out.reason.indexOf('does not hold a plan file') < out.reason.lastIndexOf('(Plan path'),
            'and the note sits inside the labelled span: ' + out.reason);
        assert.deepStrictEqual(readEvents(local), [], 'a refused release still emits nothing');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a capacity-shaped BLOCKED reason releases nothing: block, no event', () => {
    // Capacity is excluded from the completion contract (auto-compaction keeps
    // the session id, so the leash rides through), and a refused release is not
    // a release, so the events file stays untouched.
    const { repo, transcript, local } = armedRepo([
        "BLOCKED: I'm at my context limit and need to hand off to a fresh session."
    ]);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-capacity' }, local);
        assert.strictEqual(res.status, 0);
        assert.notStrictEqual(res.stdout, '', 'a capacity-shaped BLOCKED must not release the leash');
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block');
        assert.ok(out.reason.includes('Capacity is never a blocker'),
            'the block quotes the contract clause it is enforcing');
        assert.ok(out.reason.includes('kit-compact-checkpoint.js open'),
            'the capacity-shaped refusal names the boundary checkpoint command');
        assert.ok(out.reason.includes('holding auto-compaction offers and this turn is at a clean point'),
            'the capacity-shaped refusal carries the same two-case boundary directive as the '
            + 'standard hold, since both are built from the one shared constant');
        assert.deepStrictEqual(readEvents(local), [], 'a refused release emits nothing');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('the capacity deny-list is case-insensitive: an upper-case reason is refused too', () => {
    const { repo, transcript, local } = armedRepo(['BLOCKED: OUT OF CONTEXT, pausing here.']);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-caps' }, local);
        assert.strictEqual(res.status, 0);
        assert.notStrictEqual(res.stdout, '', 'casing must not carry a capacity reason past the deny-list');
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block');
        assert.ok(out.reason.includes('Capacity is never a blocker'));
        assert.deepStrictEqual(readEvents(local), [], 'a refused release emits nothing');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a WAITING lead allows the stop with the goal intact and no event (clause b2)', () => {
    // Parked on dispatched background work: the completion notification is the
    // wake, so the stop is allowed, the leash stays armed for the first stop
    // after the wake, and nothing is emitted (a waiting session is a running
    // session to an outside watcher).
    const { repo, transcript, local } = armedRepo([
        'WAITING: on the section 2 implementer and its reviewer pair, dispatched in the background.'
    ]);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-waiting' }, local);
        assert.strictEqual(res.stdout, '');
        assert.strictEqual(res.status, 0);
        assert.ok(fs.existsSync(path.join(repo, '.kit', 'goal-state.json')),
            'a waiting stop must NOT clear the goal: the leash re-enters enforcement after the wake');
        assert.deepStrictEqual(readEvents(local), [], 'waiting is not a release and emits nothing');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a WAITING line mid-message does not release: block (the literal leading prefix rule)', () => {
    const { repo, transcript, local } = armedRepo([
        'Section 2 is dispatched.\nWAITING: on the background implementers.'
    ]);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-waiting-mid' }, local);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('an EARLIER WAITING turn with a non-lead last turn: block (only the last counts)', () => {
    // The wake after a waiting stop lands new turns; the leash must re-enter
    // enforcement from the post-wake turn, not keep honoring the stale WAITING.
    const { repo, transcript, local } = armedRepo([
        'WAITING: on the background reviewers.',
        'Reviewers are back; folding in their findings.'
    ]);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-waiting-stale' }, local);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a capacity-shaped WAITING reason is refused: block naming WAITING, no event', () => {
    // Without this, WAITING becomes the escape hatch the clause-(b) capacity
    // refusal exists to close: the same deny-list judges both prefixes.
    const { repo, transcript, local } = armedRepo([
        'WAITING: for a fresh session to pick this up, my context is nearly full.'
    ]);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-waiting-cap' }, local);
        assert.strictEqual(res.status, 0);
        assert.notStrictEqual(res.stdout, '', 'a capacity-shaped WAITING must not release the leash');
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block');
        assert.ok(out.reason.includes('the WAITING line gives'),
            'the refusal names the prefix it is refusing');
        assert.ok(out.reason.includes('Capacity is never a blocker'));
        assert.deepStrictEqual(readEvents(local), [], 'a refused release emits nothing');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('only the first line is judged: a genuine blocker mentioning context further down still releases', () => {
    // The deny-list reads the stated reason, which is the first line. A body
    // that happens to mention context pressure is commentary, not the reason,
    // so a real decision blocker below it must still release.
    const { repo, planRel, transcript, local } = armedRepo([
        'BLOCKED: need your call on the migration direction: A or B.\n'
        + 'For what it is worth I am also running low on context, but the decision is the blocker.'
    ]);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-decision' }, local);
        assert.strictEqual(res.status, 0);
        assert.strictEqual(res.stdout, '', 'a body mention of capacity must not trip the deny-list');
        const events = readEvents(local);
        assert.strictEqual(events.length, 1, 'the release emits exactly one event');
        assert.strictEqual(events[0].event, 'goal-blocked');
        assert.strictEqual(events[0].plan, planRel);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a session token, not a session handoff: "the new session token" still releases', () => {
    // The word pair "new session" inside a domain noun phrase is not a capacity
    // reason, so the deny-list requires a direction word (in/to/from) ahead of it.
    const { repo, planRel, transcript, local } = armedRepo([
        'BLOCKED: the new session token for staging expired, need you to re-auth.'
    ]);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-token' }, local);
        assert.strictEqual(res.status, 0);
        assert.strictEqual(res.stdout, '', 'a domain "new session token" must not read as a capacity reason');
        const events = readEvents(local);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].event, 'goal-blocked');
        assert.strictEqual(events[0].plan, planRel);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a domain handoff with no session or context talk still releases', () => {
    // "handoff" alone names a real decision here (who owns a deployment), which
    // is why the ambiguous tier needs a pairing word before it denies.
    const { repo, transcript, local } = armedRepo([
        'BLOCKED: choose the deployment handoff owner: platform or app team?'
    ]);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-owner-call' }, local);
        assert.strictEqual(res.status, 0);
        assert.strictEqual(res.stdout, '', 'an unpaired handoff must not read as a capacity reason');
        const events = readEvents(local);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].event, 'goal-blocked');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a copula-free capacity claim ("context exhausted") is refused', () => {
    const { repo, transcript, local } = armedRepo(['BLOCKED: context exhausted, handing this off.']);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-exhausted' }, local);
        assert.strictEqual(res.status, 0);
        assert.notStrictEqual(res.stdout, '', 'a capacity claim without a copula must still be refused');
        assert.ok(JSON.parse(res.stdout).reason.includes('Capacity is never a blocker'));
        assert.deepStrictEqual(readEvents(local), [], 'a refused release emits nothing');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a handoff aimed at a fresh session is refused', () => {
    const { repo, transcript, local } = armedRepo([
        'BLOCKED: need to hand this off to a fresh session to finish the plan.'
    ]);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-handoff' }, local);
        assert.strictEqual(res.status, 0);
        assert.notStrictEqual(res.stdout, '', 'a session-directed handoff must be refused');
        assert.ok(JSON.parse(res.stdout).reason.includes('Capacity is never a blocker'));
        assert.deepStrictEqual(readEvents(local), [], 'a refused release emits nothing');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('bystander allows emit nothing (another session holds the leash; an unbound prose mention)', () => {
    // The expensive failure this pins: an emit placed before the scoping gate
    // would turn every stop in every kit repo into an event, so the watcher sees
    // a stream of releases that never happened.
    const { repo, planRel, transcript, local } = armedRepo(['Working on docs/plans/example.md.']);
    try {
        assert.strictEqual(bindSession(repo, 'sess-owner').ok, true);
        let res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-bystander' }, local);
        assert.strictEqual(res.stdout, '', 'setup: the bystander is allowed, not leashed');
        assert.deepStrictEqual(readEvents(local), [], 'an other-session bystander emits nothing');

        const { repo: repo2, local: local2 } = armedRepo(['unused']);
        try {
            const tx = path.join(repo2, 'prose-mention.jsonl');
            writeFile(tx, JSON.stringify({
                type: 'user',
                message: { role: 'user', content: 'Please work ' + planRel + ' to completion.' }
            }) + '\n');
            res = runHook({ cwd: repo2, transcript_path: tx, session_id: 'sess-prose' }, local2);
            assert.strictEqual(res.stdout, '', 'setup: the prose mention does not claim the unbound goal');
            assert.deepStrictEqual(readEvents(local2), [], 'an unbound-goal bystander emits nothing');
        } finally {
            rmDir(repo2);
            rmDir(local2);
        }
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('the enforcement block emits nothing: only a release is an event', () => {
    const { repo, transcript, local } = armedRepo(['Making progress.']);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-held' }, local);
        assert.strictEqual(JSON.parse(res.stdout).decision, 'block', 'setup: the leash is holding');
        assert.deepStrictEqual(readEvents(local), [], 'a held stop is not a release');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('an unwritable event sink leaves the release decision, output, and auto-clear unchanged', () => {
    // A directory occupying the sink path makes the emit fail. The emit is
    // observability hung off the release, never part of it: the stop still
    // allows, prints nothing, exits 0, and the goal is still cleared.
    const { repo, transcript, local } = armedRepo(['Done all sections.'], 'Status: Complete');
    try {
        const sink = path.join(local, 'unwritable-sink');
        fs.mkdirSync(sink, { recursive: true });
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-releaser' }, local,
            { KIT_EVENTS_PATH: sink });
        assert.strictEqual(res.stdout, '', 'a failed emit does not alter the allow');
        assert.strictEqual(res.status, 0);
        assert.ok(!fs.existsSync(path.join(repo, '.kit', 'goal-state.json')),
            'the goal is still auto-cleared when the emit fails');
        assert.ok(fs.statSync(sink).isDirectory(), 'the obstruction is left as it was');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

// Make the goal-state delete fail inside the spawned hook: a preload module
// patches fs.unlinkSync to refuse that one path, standing in for a delete the OS
// declines (a permission or a lock), which no portable fixture can stage here.
// Returns the NODE_OPTIONS value that loads it. Node parses NODE_OPTIONS with
// backslash as an escape character, so the preload path is passed forward-
// slashed; a backslashed path fails to resolve and the child dies before the
// hook runs.
function unlinkRefusingPreload(dir) {
    const shim = path.join(dir, 'refuse-unlink.js');
    writeFile(shim, [
        "'use strict';",
        "const fs = require('fs');",
        'const realUnlinkSync = fs.unlinkSync;',
        'fs.unlinkSync = function (target) {',
        "    if (String(target).endsWith('goal-state.json')) {",
        "        const err = new Error('EPERM: the fixture refuses this delete');",
        "        err.code = 'EPERM';",
        '        throw err;',
        '    }',
        '    return realUnlinkSync.apply(fs, arguments);',
        '};'
    ].join('\n') + '\n');
    return '--require "' + shim.replace(/\\/g, '/') + '"';
}

test('a Complete plan whose clear fails emits nothing: the stop still allows, but no release is reported', () => {
    // A goal that could not be cleared is still armed, so it was not released.
    // Emitting anyway would report a release that did not happen, and would do
    // it again at every later stop for as long as the delete keeps failing.
    const { repo, transcript, local } = armedRepo(['Done all sections.'], 'Status: Complete');
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-releaser' }, local,
            { NODE_OPTIONS: unlinkRefusingPreload(local) });
        assert.strictEqual(res.status, 0, 'exit 0: a nonzero exit would mean the preload itself failed to load');
        assert.strictEqual(res.stdout, '', 'the stop is still allowed');
        assert.ok(fs.existsSync(path.join(repo, '.kit', 'goal-state.json')),
            'the clear genuinely failed, so the leash is still armed');
        assert.deepStrictEqual(readEvents(local), [], 'a release that did not happen is not reported');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('an archived plan whose clear fails emits nothing (the same gate on the other goal-complete)', () => {
    const { repo, planRel, transcript, local } = armedRepo(['Still going.']);
    try {
        fs.rmSync(path.join(repo, planRel));
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-archiver' }, local,
            { NODE_OPTIONS: unlinkRefusingPreload(local) });
        assert.strictEqual(res.status, 0, 'exit 0: a nonzero exit would mean the preload itself failed to load');
        assert.strictEqual(res.stdout, '', 'the stop is still allowed');
        assert.ok(fs.existsSync(path.join(repo, '.kit', 'goal-state.json')),
            'the clear genuinely failed, so the leash is still armed');
        assert.deepStrictEqual(readEvents(local), [], 'a release that did not happen is not reported');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

// Make the goal-state file look already gone to the spawned hook: a preload
// patches fs.unlinkSync to report ENOENT for that one path, which is what a stop
// sees when a concurrent stop removed the file a moment earlier. The refusal
// sits at the delete rather than at a presence check because that is where the
// real race lands: the file is there when the clear judges its kind and gone by
// the time the delete runs, and no portable fixture can time the real thing. The
// NODE_OPTIONS shape matches unlinkRefusingPreload's: forward-slashed, because
// Node reads a backslash in NODE_OPTIONS as an escape character.
function alreadyClearedPreload(dir) {
    const shim = path.join(dir, 'already-cleared.js');
    writeFile(shim, [
        "'use strict';",
        "const fs = require('fs');",
        'const realUnlinkSync = fs.unlinkSync;',
        'fs.unlinkSync = function (target) {',
        "    if (String(target).endsWith('goal-state.json')) {",
        "        const err = new Error('ENOENT: no such file or directory, unlink');",
        "        err.code = 'ENOENT';",
        '        throw err;',
        '    }',
        '    return realUnlinkSync.apply(fs, arguments);',
        '};'
    ].join('\n') + '\n');
    return '--require "' + shim.replace(/\\/g, '/') + '"';
}

test('a Complete plan whose goal another stop already cleared emits nothing (the release is exactly-once)', () => {
    // The emit belongs to the stop that actually removed the goal state. A racer
    // whose clear finds nothing left to remove has released nothing, and the stop
    // that did remove it has already reported the release, so a second report
    // would double-count one release.
    const { repo, transcript, local } = armedRepo(['Done all sections.'], 'Status: Complete');
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-racer' }, local,
            { NODE_OPTIONS: alreadyClearedPreload(local) });
        assert.strictEqual(res.status, 0, 'exit 0: a nonzero exit would mean the preload itself failed to load');
        assert.strictEqual(res.stdout, '', 'the stop is still allowed');
        assert.deepStrictEqual(readEvents(local), [],
            'only the stop that removed the goal reports the release');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

// An armed queue: two In-Progress plans armed in one invocation, plus a
// transcript whose arming span carries BOTH paths (the real shape of a typed
// /kit-goal p1 p2), so the claim matches whichever plan is current. planStatuses
// rewrites each plan's header after arming, since armGoal refuses a Complete
// plan at arm time. Returns { repo, plans, transcript, local }.
function armedQueueRepo(assistantTexts, planStatuses) {
    const repo = makeDir('kit-goal-stop-repo-');
    const local = makeDir('kit-goal-stop-local-');
    const plans = ['docs/plans/first.md', 'docs/plans/second.md'];
    for (const p of plans) writeFile(path.join(repo, p), 'Status: In Progress\n\nbody\n');
    const armed = armGoal(repo, plans);
    assert.strictEqual(armed.ok, true, 'test setup: the queue should arm');
    (planStatuses || []).forEach((status, i) => {
        if (status) writeFile(path.join(repo, plans[i]), status + '\n\nbody\n');
    });
    const transcript = path.join(repo, 'transcript.jsonl');
    writeTranscript(transcript, plans.join(' '), assistantTexts || ['Working on it.']);
    return { repo, plans, transcript, local };
}

function readState(repo) {
    return JSON.parse(fs.readFileSync(path.join(repo, '.kit', 'goal-state.json'), 'utf8'));
}

test('queue, current plan Complete with a plan remaining: advance, one goal-complete, and a block naming the next plan', () => {
    const { repo, plans, transcript, local } = armedQueueRepo(['Section 4 is closed out.'],
        ['Status: Complete']);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-queue' }, local);
        assert.strictEqual(res.status, 0);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'a finished plan mid-queue holds the session, it does not release it');
        assert.ok(out.reason.includes(plans[0]), 'the reason names the finished plan');
        assert.ok(out.reason.includes('the current plan is now ' + plans[1]),
            'the reason names the plan now current');
        assert.ok(out.reason.includes('executing-work'), 'the reason instructs the continuation');
        assert.ok(!out.reason.includes('test whether it actually blocks'),
            'the judge-the-blocker clause rides only where a blocker was recorded');
        assert.ok(out.reason.includes('kit-compact-checkpoint.js open'),
            'the queue-advance reason carries boundary guidance: the advance itself only rewrites '
            + 'an already-matching checkpoint, so a plan that never opened one advances with none');
        assert.ok(out.reason.includes(plans[0] + "'s commit model was honored"),
            'the boundary guidance names the just-finished plan, not the one now current');
        assert.ok(!out.reason.includes('holding auto-compaction offers and this turn is at a clean point'),
            'the advance asks its own narrower question and does NOT take the shared boundary '
            + 'directive: without this pin, interpolating BOUNDARY_DIRECTIVE here would leave the '
            + 'suite green and the comment claiming the advance declines it would have no control');

        const state = readState(repo);
        assert.strictEqual(state.plan, plans[1], 'plan moves to the next in the queue');
        assert.strictEqual(state.queueIndex, 1);
        assert.deepStrictEqual(state.queue, plans, 'the armed queue itself is unchanged');
        assert.strictEqual(state.history.length, 1);
        assert.strictEqual(state.history[0].plan, plans[0]);
        assert.strictEqual(state.history[0].outcome, 'complete');
        assert.strictEqual(state.boundSession, 'sess-queue', 'one binding rides the whole queue');
        assert.ok(state.condition.includes(plans[1]), 'the condition is recomposed for the new current plan');

        const events = readEvents(local);
        assert.strictEqual(events.length, 1, 'the advance emits exactly one event');
        assert.strictEqual(events[0].event, 'goal-complete');
        assert.strictEqual(events[0].plan, plans[0], 'the event names the plan that finished');
        assert.strictEqual(events[0].detail, 'plan-complete');

        // The next stop is an ordinary held stop on the new current plan: the
        // advance emitted once, not once per stop.
        const again = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-queue' }, local);
        assert.strictEqual(JSON.parse(again.stdout).decision, 'block');
        assert.ok(JSON.parse(again.stdout).reason.includes(plans[1]));
        assert.strictEqual(readEvents(local).length, 1, 'a later stop on the new plan emits nothing more');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a two-plan queue runs to release: plan 1 advances and holds, plan 2 clears and allows, one goal-complete each', () => {
    const { repo, plans, transcript, local } = armedQueueRepo(['Both plans are closed out.'],
        ['Status: Complete', 'Status: Complete']);
    try {
        const first = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-queue' }, local);
        assert.strictEqual(JSON.parse(first.stdout).decision, 'block', 'plan 1 finishing does not release the session');
        assert.ok(fs.existsSync(path.join(repo, '.kit', 'goal-state.json')), 'the leash is still armed mid-queue');

        const last = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-queue' }, local);
        assert.strictEqual(last.stdout, '', 'the last plan of the queue releases the session');
        assert.strictEqual(last.status, 0);
        assert.ok(!fs.existsSync(path.join(repo, '.kit', 'goal-state.json')),
            'the last plan clears the goal, as a single-plan arming does');

        const events = readEvents(local);
        assert.strictEqual(events.length, 2, 'one goal-complete per finished plan');
        assert.deepStrictEqual(events.map((e) => e.plan), plans, 'in queue order');
        assert.deepStrictEqual(events.map((e) => e.detail), ['plan-complete', 'plan-complete']);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('queue, an archived current plan with a plan remaining: advance and block, with detail plan-archived', () => {
    const { repo, plans, transcript, local } = armedQueueRepo(['Moved it to the archive.']);
    try {
        fs.rmSync(path.join(repo, plans[0]));
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-archiver' }, local);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block');
        assert.ok(out.reason.includes('the current plan is now ' + plans[1]));
        assert.strictEqual(readState(repo).plan, plans[1]);
        assert.strictEqual(readState(repo).history[0].outcome, 'archived');
        const events = readEvents(local);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].detail, 'plan-archived');
        assert.strictEqual(events[0].plan, plans[0]);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('queue, a mid-queue BLOCKED: records the blocker, emits goal-blocked, advances, and blocks', () => {
    const blocker = 'BLOCKED: the migration direction is yours to call, A or B.';
    const { repo, plans, transcript, local } = armedQueueRepo([
        'Working the section.',
        blocker + '\nThe rest of the plan is ready to go once you pick.'
    ]);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-blocked' }, local);
        assert.strictEqual(res.status, 0);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'a blocker mid-queue moves to the next plan, it does not release');
        assert.ok(out.reason.includes("The recorded blocker for " + plans[0] + " was: '" + blocker + "'."),
            'the reason names the recorded blocker, quoted and terminated: the note is transcript '
            + 'text with no guaranteed sentence end, and an unmarked splice would dissolve the '
            + 'boundary between repo data and the instruction that follows');
        assert.ok(out.reason.includes('the current plan is now ' + plans[1]));
        // A cross-cutting blocker ("I need your AWS credentials") is true of
        // every plan in the queue, and each restatement is a genuinely new
        // entry the idempotency key cannot slow, so the advance reason must
        // tell the session to judge the recorded blocker against the new plan
        // before restating it.
        assert.ok(out.reason.includes('test whether it actually blocks ' + plans[1]),
            'the reason instructs judging the blocker against the new plan');

        const state = readState(repo);
        assert.strictEqual(state.plan, plans[1]);
        assert.strictEqual(state.queueIndex, 1);
        assert.strictEqual(state.history.length, 1);
        assert.strictEqual(state.history[0].outcome, 'blocked');
        assert.strictEqual(state.history[0].note, blocker,
            'the first line of the block message is recorded for the final summary');

        const events = readEvents(local);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].event, 'goal-blocked');
        assert.strictEqual(events[0].plan, plans[0]);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('queue, a BLOCKED on the LAST plan: allow without clearing (the release is unchanged)', () => {
    const { repo, plans, transcript, local } = armedQueueRepo([
        'BLOCKED: this one needs a decision only Scott can make.'
    ]);
    try {
        assert.strictEqual(advanceGoal(repo, { outcome: 'complete' }).advanced, true,
            'test setup: the leash is on the last plan');
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-last-blocked' }, local);
        assert.strictEqual(res.stdout, '', 'the last plan of the queue releases on a blocker');
        assert.strictEqual(res.status, 0);
        assert.ok(fs.existsSync(path.join(repo, '.kit', 'goal-state.json')),
            'a blocked release does not clear the goal, at any queue position');
        assert.strictEqual(readState(repo).plan, plans[1], 'the leash does not move past the last plan');
        const events = readEvents(local);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].event, 'goal-blocked');
        assert.strictEqual(events[0].plan, plans[1]);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a capacity-shaped BLOCKED is refused at EVERY queue position: block, no event, no advance', () => {
    // The refusal runs before the advance, so capacity can never buy a queue
    // position: without this pin, "I am out of context" would advance the leash
    // past an unfinished plan on every stop until the queue ran out.
    for (const position of [0, 1]) {
        const { repo, transcript, local } = armedQueueRepo([
            "BLOCKED: I'm at my context limit and need to hand off to a fresh session."
        ]);
        try {
            if (position === 1) {
                assert.strictEqual(advanceGoal(repo, { outcome: 'complete' }).advanced, true,
                    'test setup: the leash is on the last plan');
            }
            const before = readState(repo);
            const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-cap' }, local);
            assert.strictEqual(res.status, 0);
            const out = JSON.parse(res.stdout);
            assert.strictEqual(out.decision, 'block', `position ${position}: capacity must not release`);
            assert.ok(out.reason.includes('Capacity is never a blocker'),
                `position ${position}: the refusal quotes the contract clause`);
            const after = readState(repo);
            assert.strictEqual(after.plan, before.plan, `position ${position}: the leash did not advance`);
            assert.strictEqual(after.queueIndex, before.queueIndex);
            assert.deepStrictEqual(after.history, before.history,
                `position ${position}: a refused release records nothing`);
            assert.deepStrictEqual(readEvents(local), [], `position ${position}: a refused release emits nothing`);
        } finally {
            rmDir(repo);
            rmDir(local);
        }
    }
});

test('a WAITING lead allows with the state untouched at EVERY queue position', () => {
    for (const position of [0, 1]) {
        const { repo, transcript, local } = armedQueueRepo([
            'WAITING: on the dispatched section implementers.'
        ]);
        try {
            if (position === 1) {
                assert.strictEqual(advanceGoal(repo, { outcome: 'complete' }).advanced, true,
                    'test setup: the leash is on the last plan');
            }
            const before = readState(repo);
            const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-waiting' }, local);
            assert.strictEqual(res.stdout, '', `position ${position}: a waiting stop is allowed`);
            assert.strictEqual(res.status, 0);
            const after = readState(repo);
            assert.strictEqual(after.plan, before.plan, `position ${position}: waiting never advances the leash`);
            assert.strictEqual(after.queueIndex, before.queueIndex);
            assert.deepStrictEqual(after.history, before.history);
            assert.deepStrictEqual(readEvents(local), [], `position ${position}: waiting is not a release`);
        } finally {
            rmDir(repo);
            rmDir(local);
        }
    }
});

test('a bystander session never advances the queue: allow, state untouched, no event', () => {
    const { repo, plans, transcript, local } = armedQueueRepo(['Done all sections.'], ['Status: Complete']);
    try {
        assert.strictEqual(bindSession(repo, 'sess-owner').ok, true);
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-bystander' }, local);
        assert.strictEqual(res.stdout, '', 'only the bound session advances the queue');
        assert.strictEqual(res.status, 0);
        const state = readState(repo);
        assert.strictEqual(state.plan, plans[0], 'the bystander did not move the leash');
        assert.strictEqual(state.queueIndex, 0);
        assert.deepStrictEqual(state.history, []);
        assert.strictEqual(state.boundSession, 'sess-owner');
        assert.deepStrictEqual(readEvents(local), [], 'a bystander emits nothing');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a legacy single-plan state (no queue fields) still clears and allows on Complete', () => {
    // The compatibility gate for a state file written before the queue existed:
    // readGoal normalizes it to a queue of one, so its Complete plan is the last
    // plan and releases exactly as it always has.
    const repo = makeDir('kit-goal-stop-repo-');
    const local = makeDir('kit-goal-stop-local-');
    const planRel = 'docs/plans/legacy.md';
    try {
        writeFile(path.join(repo, planRel), 'Status: Complete\n\nbody\n');
        writeFile(path.join(repo, '.kit', 'goal-state.json'), JSON.stringify({
            plan: planRel,
            condition: 'Work ' + planRel + ' to completion using executing-work.',
            armedAt: '2026-08-01T00:00:00.000Z',
            boundSession: 'sess-legacy'
        }, null, 2) + '\n');
        const transcript = path.join(repo, 'transcript.jsonl');
        writeTranscript(transcript, planRel, ['Done all sections.']);
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-legacy' }, local);
        assert.strictEqual(res.stdout, '', 'a legacy state releases on Complete');
        assert.strictEqual(res.status, 0);
        assert.ok(!fs.existsSync(path.join(repo, '.kit', 'goal-state.json')), 'the goal is cleared');
        const events = readEvents(local);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].detail, 'plan-complete');
        assert.strictEqual(events[0].plan, planRel);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('the arming claim records the binding session AND its transcript path', () => {
    // boundTranscript is written at claim time and read by another session as a
    // liveness hint, so the claim must carry the payload's transcript_path.
    const { repo, transcript, local } = armedQueueRepo(['Working on it.']);
    try {
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-claimer' }, local);
        assert.strictEqual(JSON.parse(res.stdout).decision, 'block', 'setup: the claim leashes the session');
        const state = readState(repo);
        assert.strictEqual(state.boundSession, 'sess-claimer');
        assert.strictEqual(state.boundTranscript, transcript, 'the claim records the transcript path');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

// Make the goal-state write fail inside the spawned hook: a preload patches
// fs.openSync to refuse the atomic write's tmp file, standing in for a write the
// OS declines (a permission, a full disk), which no portable fixture can stage
// here. The open is the syscall that sees the path, since the writer creates by
// path and then writes to the descriptor. The NODE_OPTIONS shape matches the
// other preloads': forward-slashed, because Node reads a backslash in
// NODE_OPTIONS as an escape.
function writeRefusingPreload(dir) {
    const shim = path.join(dir, 'refuse-state-write.js');
    writeFile(shim, [
        "'use strict';",
        "const fs = require('fs');",
        '// The atomic write opens its temp file by path and then writes to the',
        '// descriptor, so the path is visible at the open and not at the write.',
        '// Refusing the open is what stands in for a write the OS declines. A',
        '// writer that went back to writing by path would need the same refusal on',
        '// fs.writeFileSync.',
        'const realOpenSync = fs.openSync;',
        'fs.openSync = function (target) {',
        "    if (String(target).includes('goal-state.json.tmp')) {",
        "        const err = new Error('EPERM: the fixture refuses this write');",
        "        err.code = 'EPERM';",
        '        throw err;',
        '    }',
        '    return realOpenSync.apply(fs, arguments);',
        '};'
    ].join('\n') + '\n');
    return '--require "' + shim.replace(/\\/g, '/') + '"';
}

test('a failed advance write re-blocks rather than releasing, and the next stop retries it', () => {
    // The failure that must never happen: a write hiccup releasing the session
    // mid-queue. The stop is held with the advance reason regardless, nothing is
    // reported as finished, and the same clause runs again at the next stop.
    const { repo, plans, transcript, local } = armedQueueRepo(['Done all sections.'], ['Status: Complete']);
    try {
        assert.strictEqual(bindSession(repo, 'sess-queue').ok, true,
            'setup: bound already, so the refused write is the advance, not the bind');
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-queue' }, local,
            { NODE_OPTIONS: writeRefusingPreload(local) });
        assert.strictEqual(res.status, 0, 'exit 0: a nonzero exit would mean the preload itself failed to load');
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'a failed advance must not release the session');
        // The reason must not assert a state change that did not land: the
        // state file and the compaction gate both still name the finished
        // plan, so the session must not be told the current plan already
        // moved.
        assert.ok(out.reason.includes('could not be recorded'), 'the reason says the advance did not land');
        assert.ok(!out.reason.includes('the leash has advanced'), 'the reason claims no advance');
        assert.ok(!out.reason.includes('the current plan is now'), 'the reason claims no new current plan');
        assert.ok(out.reason.includes('The plan after ' + plans[0] + ' in the armed queue is ' + plans[1]),
            'the reason still names where the retry will land');
        const state = readState(repo);
        assert.strictEqual(state.plan, plans[0], 'the write genuinely failed, so the leash has not moved');
        assert.deepStrictEqual(state.history, []);
        assert.deepStrictEqual(readEvents(local), [],
            'an advance that did not happen reports no finished plan');

        // The plan is still Complete, so the next stop runs the same clause and
        // the write lands: no release was lost.
        const retry = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-queue' }, local);
        assert.strictEqual(JSON.parse(retry.stdout).decision, 'block');
        assert.strictEqual(readState(repo).plan, plans[1], 'the retry advances the leash');
        const events = readEvents(local);
        assert.strictEqual(events.length, 1, 'the finished plan is reported once, on the write that landed');
        assert.strictEqual(events[0].plan, plans[0]);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a spent lead on an unusable plan path says what is wrong with the path', () => {
    // The other release clause that ends in a block: a spent lead holds with a
    // reason telling the session to read the current plan in full. Once the
    // advance has moved the leash onto a path no reader can open, that
    // direction cannot be followed, so the reason has to say so.
    const repo = makeDir('kit-goal-stop-repo-');
    const local = makeDir('kit-goal-stop-local-');
    const plans = ['docs/plans/first.md', 'docs/plans/second.md'];
    try {
        for (const p of plans) writeFile(path.join(repo, p), 'Status: In Progress\n\nbody\n');
        assert.strictEqual(armGoal(repo, plans).ok, true, 'test setup: the queue should arm');
        const transcript = path.join(repo, 'transcript.jsonl');
        writeFile(transcript, [
            JSON.stringify({
                type: 'user',
                message: {
                    role: 'user',
                    content: '<command-name>/kit-goal</command-name>\n'
                        + '<command-args>' + plans.join(' ') + '</command-args>'
                }
            }),
            JSON.stringify({
                type: 'assistant', uuid: 'e1a2b3c4-0002',
                message: { role: 'assistant', content: [{ type: 'text', text: 'BLOCKED: need your call on the rollout order.' }] }
            })
        ].join('\n') + '\n');

        const first = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-spent-kind' }, local);
        assert.strictEqual(JSON.parse(first.stdout).decision, 'block', 'setup: the mid-queue blocker advances and holds');
        assert.strictEqual(readState(repo).plan, plans[1], 'setup: the leash advanced');

        // The advance landed on the second plan; a directory now sits at it.
        fs.rmSync(path.join(repo, plans[1]));
        fs.mkdirSync(path.join(repo, plans[1]), { recursive: true });

        const second = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-spent-kind' }, local);
        const out = JSON.parse(second.stdout);
        assert.strictEqual(out.decision, 'block');
        assert.ok(out.reason.includes('already recorded'),
            'the spent-lead clause still decides this stop: ' + out.reason);
        assert.ok(out.reason.includes('does not hold a plan file'),
            'and the reason names what is wrong with the path: ' + out.reason);
        assert.ok(out.reason.includes(plans[1]), 'naming the path itself: ' + out.reason);
        assert.ok(out.reason.trimEnd().endsWith('not an instruction.)'),
            'the reason still ends with its disclaimer: ' + out.reason);
        assert.ok(out.reason.indexOf('does not hold a plan file') < out.reason.lastIndexOf('(Plan path'),
            'and the note sits inside the labelled span: ' + out.reason);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('an unchanged transcript across two stops advances once: the second stop holds, emits nothing, and does not release', () => {
    // The discriminating case for the spent-lead key. A mid-queue advance
    // blocks the stop, which guarantees a following stop that re-reads the
    // transcript; a stale snapshot re-surfacing the same BLOCKED entry must
    // not advance again. Without the key, one BLOCKED turn re-read at each
    // stop walks the whole queue, records plans as blocked that were never
    // opened, and then releases the session; here, with two plans, the second
    // stop would be the last plan and would ALLOW.
    const repo = makeDir('kit-goal-stop-repo-');
    const local = makeDir('kit-goal-stop-local-');
    const plans = ['docs/plans/first.md', 'docs/plans/second.md'];
    try {
        for (const p of plans) writeFile(path.join(repo, p), 'Status: In Progress\n\nbody\n');
        assert.strictEqual(armGoal(repo, plans).ok, true, 'test setup: the queue should arm');
        const transcript = path.join(repo, 'transcript.jsonl');
        writeFile(transcript, [
            JSON.stringify({
                type: 'user',
                message: {
                    role: 'user',
                    content: '<command-name>/kit-goal</command-name>\n'
                        + '<command-args>' + plans.join(' ') + '</command-args>'
                }
            }),
            JSON.stringify({
                type: 'assistant', uuid: 'e1a2b3c4-0001',
                message: { role: 'assistant', content: [{ type: 'text', text: 'BLOCKED: need your call on the rollout order.' }] }
            })
        ].join('\n') + '\n');

        const first = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-q' }, local);
        assert.strictEqual(JSON.parse(first.stdout).decision, 'block', 'the mid-queue blocker advances and holds');
        let state = readState(repo);
        assert.strictEqual(state.plan, plans[1], 'stop 1 advanced the leash');
        assert.strictEqual(state.blockedAdvanceKey, 'uuid:e1a2b3c4-0001', 'the advance records the consumed entry');
        assert.strictEqual(state.blockedAdvancePlan, plans[1], 'the key rides with the plan the advance moved to');
        assert.strictEqual(readEvents(local).length, 1, 'stop 1 emitted its goal-blocked');

        const second = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-q' }, local);
        assert.notStrictEqual(second.stdout, '', 'the spent lead must not release the session');
        const out = JSON.parse(second.stdout);
        assert.strictEqual(out.decision, 'block');
        assert.ok(out.reason.includes(plans[1]), 'the hold names the current plan');
        assert.ok(!out.reason.includes('has advanced'), 'the second stop claims no advance');
        // The spent hold is its own reason, not the generic enforcement
        // block: that block's text would deny a BLOCKED lead that provably
        // exists, and its 'surface a true blocker' offer invites a fresh
        // BLOCKED entry whose new identity is not spent and would advance the
        // queue again, one stop later. The dedicated reason states the
        // blocker as already recorded, names it, and never invites a
        // restatement.
        assert.ok(out.reason.includes('already recorded'), 'the spent hold says the blocker is recorded');
        assert.ok(out.reason.includes('need your call on the rollout order'),
            'the spent hold names the recorded blocker');
        assert.ok(out.reason.includes('the current plan is now ' + plans[1]),
            'the spent hold names the plan now current');
        assert.ok(!out.reason.includes('did not lead with'),
            'the generic not-complete clause is absent: on this path the message DID lead with BLOCKED');
        assert.ok(!out.reason.includes('surface a true blocker'),
            'no invitation to restate the blocker');
        assert.ok(!out.reason.includes("leading 'BLOCKED:'"),
            'no instruction whose compliance would regenerate the advance');
        assert.ok(!out.reason.includes('kit-compact-checkpoint.js open'),
            'the spent hold carries no boundary guidance: the advance that produced this key '
            + 'already delivered it, and no new work has happened since (the lead is provably stale)');
        assert.ok(!out.reason.includes('holding auto-compaction offers and this turn is at a clean point'),
            'and the interim-board case is withheld with it: both halves come from the one '
            + 'shared directive, so neither can leak onto this path without the other');
        state = readState(repo);
        assert.strictEqual(state.plan, plans[1], 'the leash did not move again');
        assert.strictEqual(state.history.length, 1, 'no second outcome was recorded');
        assert.strictEqual(readEvents(local).length, 1, 'the spent lead emitted nothing');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

// A plan doc carrying a Dispatch Authorization section, which is what a plan
// armed by a run for itself ordinarily carries. Nothing gates the arm on it:
// the section is the authorization record, and who armed the plan is the
// separate fact these reasons state.
function writeAuthorizedPlan(repo, rel) {
    writeFile(path.join(repo, rel), 'Status: In Progress\n\n## Dispatch Authorization\n\n'
        + 'Authorized 2026-08-29 by the operator for any session holding this plan.\n\nbody\n');
}

// The three block reasons that state what the armed goal requests, produced
// under one arming: the ordinary hold, the queue advance, and the spent-lead
// hold. They are built together because the clause is one rule with three
// sites, and a rule applied at one site and not its siblings is the defect
// this file's own enumeration comment guards against.
function armingClauseReasons(authority) {
    const repo = makeDir('kit-goal-stop-repo-');
    const local = makeDir('kit-goal-stop-local-');
    try {
        const plans = ['docs/plans/first.md', 'docs/plans/second.md'];
        for (const p of plans) {
            if (authority === 'self') writeAuthorizedPlan(repo, p);
            else writeFile(path.join(repo, p), 'Status: In Progress\n\nbody\n');
        }
        const transcript = path.join(repo, 'transcript.jsonl');

        // The ordinary hold: an In-Progress plan and a turn that leads with
        // neither 'BLOCKED:' nor 'WAITING:'.
        assert.strictEqual(armGoal(repo, plans[0], null, authority).ok, true, 'test setup: the arm should land');
        writeTranscript(transcript, plans[0], ['Working on it.']);
        const ordinary = JSON.parse(runHook(
            { cwd: repo, transcript_path: transcript, session_id: 'sess-ordinary' }, local).stdout).reason;

        // The queue advance: a Complete current plan with a plan behind it.
        assert.strictEqual(armGoal(repo, plans, null, authority).ok, true, 'test setup: the queue should arm');
        const firstBody = fs.readFileSync(path.join(repo, plans[0]), 'utf8');
        writeFile(path.join(repo, plans[0]), firstBody.replace('Status: In Progress', 'Status: Complete'));
        writeTranscript(transcript, plans.join(' '), ['Section 1 is closed out.']);
        const advance = JSON.parse(runHook(
            { cwd: repo, transcript_path: transcript, session_id: 'sess-advance' }, local).stdout).reason;

        // The spent-lead hold: the stop that re-reads the very entry the
        // advance before it consumed, which advances nothing and holds with
        // its own reason.
        writeFile(path.join(repo, plans[0]), firstBody);
        assert.strictEqual(armGoal(repo, plans, null, authority).ok, true, 'test setup: the queue should re-arm');
        writeTranscript(transcript, plans.join(' '), ['BLOCKED: need your call on the rollout order.']);
        const payload = { cwd: repo, transcript_path: transcript, session_id: 'sess-spent' };
        assert.strictEqual(JSON.parse(runHook(payload, local).stdout).decision, 'block',
            'test setup: the mid-queue blocker advances and holds');
        const spent = JSON.parse(runHook(payload, local).stdout).reason;
        assert.ok(spent.includes('already recorded'), 'test setup: the second stop is the spent-lead hold');
        return { ordinary, advance, spent };
    } finally {
        rmDir(repo);
        rmDir(local);
    }
}

// Every hold reason states the arming the goal state records for the plan it is
// about, at all three sites. A goal the operator typed carries that arming's
// request for subagent dispatch and Workflows, in the clause that licenses the
// parallelize instruction beside it. A goal armed by an invocation the run made
// for itself has no typed request to carry, so the attribution rides at the head
// of the reason, beside the plan it identifies, and the parallelize instruction
// stands unqualified: that license rests on the doctrine's standing request
// rather than on the arming, and an attribution sitting in that clause's place
// would read as withdrawing it. The two directions are each other's control, so
// neither can pass on the other's fixture.
test('every hold reason states the arming the goal state records', () => {
    const typed = armingClauseReasons('operator');
    const selfArmed = armingClauseReasons('self');
    const TYPED = "(the armed goal carries the user's request for subagent dispatch and Workflows on this run";
    const SELF = 'armed by an invocation a run made for itself rather than one Scott typed';

    assert.ok(typed.ordinary.includes(TYPED + ', to reduce wall-clock time)'),
        'the ordinary hold names the typed request');
    assert.ok(typed.advance.includes(TYPED + ')'), 'the queue advance names the typed request');
    assert.ok(typed.spent.includes(TYPED + ')'), 'the spent-lead hold names the typed request');
    for (const site of ['ordinary', 'advance', 'spent']) {
        assert.ok(!typed[site].includes(SELF),
            'the ' + site + ' reason claims no self-arming for a goal the operator typed');
    }

    for (const site of ['ordinary', 'advance', 'spent']) {
        const reason = selfArmed[site];
        assert.ok(!reason.includes("the user's request for subagent dispatch"),
            'the ' + site + ' reason asserts no request Scott typed under a self-arming');
        assert.ok(reason.includes(SELF),
            'the ' + site + ' reason names the arming the state records');
        assert.ok(!/dispatch authorization/i.test(reason),
            'and claims nothing about what authorized the plan, which the arming '
            + 'invocation never told this state');
        assert.ok(reason.includes('the kit-goal skill states what such an arming carries'),
            'the ' + site + ' reason points at the skill that owns the conditions');
        assert.ok(reason.includes('parallelizing what can run simultaneously'),
            'the ' + site + ' reason still instructs the run to parallelize');
        assert.ok(!reason.includes('simultaneously ('),
            'and the attribution is not in the clause that qualifies that instruction, where it '
            + 'would read as the license being withdrawn');
    }
    assert.ok(selfArmed.ordinary.startsWith('A kit goal is armed for docs/plans/first.md (' + SELF),
        'the attribution rides with the goal identification the reason opens on');
});

// One queue, two armings, and the reason states the arming of the plan it is
// about rather than the one the queue was started with. The advance is the
// discriminating site: it composes for the plan the leash moves TO, so a
// reading taken from the finished plan would state the wrong authority exactly
// where the run reads its instruction for the next plan.
test('a queue holding both armings states each plan\'s own at the advance', () => {
    for (const order of [['operator', 'self'], ['self', 'operator']]) {
        const repo = makeDir('kit-goal-stop-repo-');
        const local = makeDir('kit-goal-stop-local-');
        try {
            const plans = ['docs/plans/first.md', 'docs/plans/second.md'];
            plans.forEach((p, i) => {
                if (order[i] === 'self') writeAuthorizedPlan(repo, p);
                else writeFile(path.join(repo, p), 'Status: In Progress\n\nbody\n');
            });
            assert.strictEqual(armGoal(repo, plans[0], null, order[0]).ok, true, 'test setup: arm');
            assert.strictEqual(appendGoal(repo, [plans[1]], order[1]).ok, true, 'test setup: append');

            const body = fs.readFileSync(path.join(repo, plans[0]), 'utf8');
            writeFile(path.join(repo, plans[0]), body.replace('Status: In Progress', 'Status: Complete'));
            const transcript = path.join(repo, 'transcript.jsonl');
            writeTranscript(transcript, plans.join(' '), ['Section 1 is closed out.']);
            const reason = JSON.parse(runHook(
                { cwd: repo, transcript_path: transcript, session_id: 'sess-mixed' }, local).stdout).reason;

            const self = 'armed by an invocation a run made for itself rather than one Scott typed';
            if (order[1] === 'self') {
                assert.ok(reason.includes(self),
                    'the advance states the self-arming of the plan it moves to');
                assert.ok(!reason.includes("the user's request for subagent dispatch"),
                    'and not the typed arming of the plan it just finished');
            } else {
                assert.ok(reason.includes("the user's request for subagent dispatch"),
                    'the advance states the typed arming of the plan it moves to');
                assert.ok(!reason.includes(self), 'and not the self-arming of the plan it just finished');
            }
        } finally {
            rmDir(repo);
            rmDir(local);
        }
    }
});

test('two genuinely different BLOCKED turns advance twice: the key is the entry uuid, not the text', () => {
    // Identical text under two uuids is two real blockers (a session can hit
    // the same wording twice); a text-keyed dedupe would wrongly hold the
    // second, which is why the uuid is preferred when the entry carries one.
    const repo = makeDir('kit-goal-stop-repo-');
    const local = makeDir('kit-goal-stop-local-');
    const plans = ['docs/plans/p1.md', 'docs/plans/p2.md', 'docs/plans/p3.md'];
    const sameText = 'BLOCKED: the same decision, stated the same way.';
    try {
        for (const p of plans) writeFile(path.join(repo, p), 'Status: In Progress\n\nbody\n');
        assert.strictEqual(armGoal(repo, plans).ok, true, 'test setup: the queue should arm');
        const transcript = path.join(repo, 'transcript.jsonl');
        writeFile(transcript, [
            JSON.stringify({
                type: 'user',
                message: {
                    role: 'user',
                    content: '<command-name>/kit-goal</command-name>\n'
                        + '<command-args>' + plans.join(' ') + '</command-args>'
                }
            }),
            JSON.stringify({
                type: 'assistant', uuid: 'u-0001',
                message: { role: 'assistant', content: [{ type: 'text', text: sameText }] }
            })
        ].join('\n') + '\n');

        const first = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-q' }, local);
        assert.strictEqual(JSON.parse(first.stdout).decision, 'block');
        assert.strictEqual(readState(repo).plan, plans[1], 'the first blocker advanced');

        fs.appendFileSync(transcript, JSON.stringify({
            type: 'assistant', uuid: 'u-0002',
            message: { role: 'assistant', content: [{ type: 'text', text: sameText }] }
        }) + '\n');
        const second = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-q' }, local);
        assert.strictEqual(JSON.parse(second.stdout).decision, 'block');
        const state = readState(repo);
        assert.strictEqual(state.plan, plans[2], 'a new entry with the same text still advances');
        assert.strictEqual(state.history.length, 2);
        assert.deepStrictEqual(state.history.map((h) => h.outcome), ['blocked', 'blocked']);
        assert.strictEqual(state.blockedAdvanceKey, 'uuid:u-0002', 'the key follows the newest consumed entry');
        assert.strictEqual(readEvents(local).length, 2, 'each real blocker emitted its own goal-blocked');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a uuid-less transcript falls back to a text key: a repeat holds, a genuinely new blocker still releases', () => {
    // armedQueueRepo's transcript carries no uuids, so the key is the text
    // digest: the repeat direction must still refuse, and a different BLOCKED
    // text must still count as new (here on the last plan, releasing as the
    // pre-queue contract always did).
    const { repo, plans, transcript, local } = armedQueueRepo(['BLOCKED: pick the storage engine, A or B.']);
    try {
        const first = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-q' }, local);
        assert.strictEqual(JSON.parse(first.stdout).decision, 'block', 'the mid-queue blocker advances and holds');
        let state = readState(repo);
        assert.strictEqual(state.plan, plans[1]);
        assert.ok(typeof state.blockedAdvanceKey === 'string' && state.blockedAdvanceKey.startsWith('text:'),
            'a uuid-less entry keys on its text digest');
        assert.strictEqual(readEvents(local).length, 1);

        const repeat = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-q' }, local);
        assert.strictEqual(JSON.parse(repeat.stdout).decision, 'block', 'the spent lead holds instead of releasing');
        state = readState(repo);
        assert.strictEqual(state.plan, plans[1], 'the leash did not move');
        assert.strictEqual(state.history.length, 1);
        assert.strictEqual(readEvents(local).length, 1, 'the repeat emitted nothing');

        fs.appendFileSync(transcript, JSON.stringify({
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'text', text: 'BLOCKED: now a different question entirely.' }] }
        }) + '\n');
        const third = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-q' }, local);
        assert.strictEqual(third.stdout, '', 'a genuinely new blocker on the last plan releases as before');
        assert.ok(fs.existsSync(path.join(repo, '.kit', 'goal-state.json')),
            'a blocked release does not clear the goal');
        assert.strictEqual(readEvents(local).length, 2, 'the new blocker emitted its own goal-blocked');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

// Make the spawned hook see a different goal state on its second read: a
// preload wraps fs.readFileSync so the first goal-state read (main()'s
// snapshot) is real and every later one (advanceGoal's re-read) returns the
// given state, which is what the hook sees when a CLI re-arm lands inside its
// clause retry sleep. The NODE_OPTIONS shape matches the other preloads':
// forward-slashed, because Node reads a backslash in NODE_OPTIONS as an escape.
function goalSwapPreload(dir, swappedState) {
    const shim = path.join(dir, 'swap-goal-read.js');
    writeFile(shim, [
        "'use strict';",
        "const fs = require('fs');",
        'const real = fs.readFileSync;',
        'let reads = 0;',
        'fs.readFileSync = function (target) {',
        "    if (String(target).endsWith('goal-state.json')) {",
        '        reads++;',
        '        if (reads >= 2) return ' + JSON.stringify(JSON.stringify(swappedState)) + ';',
        '    }',
        '    return real.apply(fs, arguments);',
        '};'
    ].join('\n') + '\n');
    return '--require "' + shim.replace(/\\/g, '/') + '"';
}

test('an advance whose state was re-armed underneath it is refused: re-block, no write, no event', () => {
    // The CLI is a writer the session binding does not exclude: a /kit-goal
    // re-arm or clear can land between the snapshot main() decided on and
    // advanceGoal's own re-read. The advance carries the snapshot's plan and
    // the lib refuses on a mismatch, so the hook re-blocks and the re-armed
    // state is left exactly as its writer intended.
    const { repo, plans, transcript, local } = armedQueueRepo(['Done all sections.'], ['Status: Complete']);
    try {
        assert.strictEqual(bindSession(repo, 'sess-queue').ok, true);
        const swapped = {
            plan: 'docs/plans/x.md', condition: 'c', armedAt: '2026-08-16T00:00:00.000Z',
            boundSession: 'sess-queue', boundTranscript: null,
            queue: ['docs/plans/x.md', 'docs/plans/y.md'], queueIndex: 0, history: []
        };
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-queue' }, local,
            { NODE_OPTIONS: goalSwapPreload(local, swapped) });
        assert.strictEqual(res.status, 0, 'exit 0: a nonzero exit would mean the preload itself failed to load');
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'the refused advance re-blocks rather than releasing');
        assert.ok(out.reason.includes('could not be recorded'), 'the reason claims no advance');
        const state = readState(repo);
        assert.strictEqual(state.plan, plans[0], 'the on-disk state was not advanced from a snapshot its writer never made');
        assert.deepStrictEqual(state.history, []);
        assert.deepStrictEqual(readEvents(local), [], 'no goal-complete is reported for an advance that did not land');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a re-arm that put the SAME plan back at the head is refused by the advance (the armedAt compare)', () => {
    // The crash-recovery spelling /kit-goal <currentPlan> <newTail> passes a
    // plan-only compare-and-swap: the fresh queue's head is the very plan the
    // stop decided from. Advancing it would record the fresh arm's plan 1
    // finished without it ever running and carry the arm's null binding
    // forward. The arming timestamp is what tells the two states apart, so
    // the advance is refused, the stop re-blocks, and the fresh arm is left
    // exactly as its writer intended.
    const { repo, plans, transcript, local } = armedQueueRepo(['Done all sections.'], ['Status: Complete']);
    try {
        assert.strictEqual(bindSession(repo, 'sess-queue').ok, true);
        const rearmed = {
            plan: plans[0], condition: 'c', armedAt: '2000-01-01T00:00:00.000Z',
            boundSession: null, boundTranscript: null,
            queue: [plans[0], 'docs/plans/fresh-tail.md'], queueIndex: 0, history: []
        };
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-queue' }, local,
            { NODE_OPTIONS: goalSwapPreload(local, rearmed) });
        assert.strictEqual(res.status, 0, 'exit 0: a nonzero exit would mean the preload itself failed to load');
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'the refused advance re-blocks rather than releasing');
        assert.ok(out.reason.includes('could not be recorded'), 'the reason claims no advance');
        const state = readState(repo);
        assert.strictEqual(state.plan, plans[0], 'the freshly armed queue was not advanced');
        assert.deepStrictEqual(state.history, [], 'no plan was recorded finished off the stale snapshot');
        assert.deepStrictEqual(readEvents(local), [], 'no goal-complete for an advance that did not land');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('the advanced reason names the plan the state actually moved to, not the snapshot\'s prediction', () => {
    // A writer that lands in a way the compare-and-swap does not catch (here:
    // the same plan and armedAt but an edited tail) leaves the snapshot's
    // next-plan prediction stale while the advance itself re-reads and moves
    // to the authoritative next. The reason must name where the state
    // actually went, or the session is directed into a plan that is not the
    // state's current one.
    const { repo, plans, transcript, local } = armedQueueRepo(['Done all sections.'], ['Status: Complete']);
    try {
        assert.strictEqual(bindSession(repo, 'sess-queue').ok, true);
        const real = readState(repo);
        const edited = { ...real, queue: [plans[0], 'docs/plans/edited-tail.md'] };
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-queue' }, local,
            { NODE_OPTIONS: goalSwapPreload(local, edited) });
        assert.strictEqual(res.status, 0, 'exit 0: a nonzero exit would mean the preload itself failed to load');
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block');
        assert.ok(out.reason.includes('the current plan is now docs/plans/edited-tail.md'),
            'the reason names the plan the advance actually recorded');
        assert.ok(!out.reason.includes(plans[1]),
            'the stale snapshot prediction is not what the session is directed into');
        assert.strictEqual(readState(repo).plan, 'docs/plans/edited-tail.md',
            'setup check: the advance really did move to the edited tail');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a clause-(a) advance between two reads of the same BLOCKED entry does not resurrect it: the stale re-read holds', () => {
    // The three-stop shape that reopens the consumed-blocker defect if the
    // key is deleted rather than retired by position: a BLOCKED entry E
    // advances plan 1 and records its key; plan 2 turns Complete out of band,
    // so the next stop's clause-(a) advance runs without reading the
    // transcript at all; the stop after that re-reads the transcript and can
    // surface E again (the stale-snapshot race the retry schedule narrows but
    // cannot close). Were the clause-(a) advance to delete the key, E would
    // emit a second goal-blocked off a blocker the queue already consumed
    // and, plan 3 being last, RELEASE the session; the retained pair holds it
    // instead, because plan 2, the key's recording plan, is still the
    // immediately previous queue position.
    const repo = makeDir('kit-goal-stop-repo-');
    const local = makeDir('kit-goal-stop-local-');
    const plans = ['docs/plans/p1.md', 'docs/plans/p2.md', 'docs/plans/p3.md'];
    try {
        for (const p of plans) writeFile(path.join(repo, p), 'Status: In Progress\n\nbody\n');
        assert.strictEqual(armGoal(repo, plans).ok, true, 'test setup: the queue should arm');
        const transcript = path.join(repo, 'transcript.jsonl');
        writeFile(transcript, [
            JSON.stringify({
                type: 'user',
                message: {
                    role: 'user',
                    content: '<command-name>/kit-goal</command-name>\n'
                        + '<command-args>' + plans.join(' ') + '</command-args>'
                }
            }),
            JSON.stringify({
                type: 'assistant', uuid: 'u-key-1',
                message: { role: 'assistant', content: [{ type: 'text', text: 'BLOCKED: pick the schema owner.' }] }
            })
        ].join('\n') + '\n');

        const first = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-q' }, local);
        assert.strictEqual(JSON.parse(first.stdout).decision, 'block');
        assert.strictEqual(readState(repo).blockedAdvanceKey, 'uuid:u-key-1', 'setup: the blocked advance wrote its key');
        assert.strictEqual(readState(repo).blockedAdvancePlan, plans[1], 'setup: the key rides with the plan it advanced to');

        // Plan 2 turns Complete with the transcript deliberately NOT
        // extended: entry E stays its newest assistant turn, which is exactly
        // what a stale re-read surfaces at the third stop.
        writeFile(path.join(repo, plans[1]), 'Status: Complete\n\nbody\n');
        const second = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-q' }, local);
        assert.strictEqual(JSON.parse(second.stdout).decision, 'block', 'the Complete advance holds as usual');
        let state = readState(repo);
        assert.strictEqual(state.plan, plans[2], 'the clause-(a) advance landed');
        assert.strictEqual(state.blockedAdvanceKey, 'uuid:u-key-1', 'the keyless advance leaves the key standing');
        assert.strictEqual(state.blockedAdvancePlan, plans[1], 'the recording plan is now the immediately previous position');
        assert.strictEqual(readEvents(local).length, 2, 'setup: one goal-blocked, one goal-complete so far');

        const third = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-q' }, local);
        assert.notStrictEqual(third.stdout, '', 'the stale re-read of E must not release the session');
        const out = JSON.parse(third.stdout);
        assert.strictEqual(out.decision, 'block');
        assert.ok(out.reason.includes('already recorded'), 'the spent hold says the blocker is recorded');
        assert.ok(out.reason.includes('pick the schema owner'),
            'the spent hold names the blocker E recorded, read past the intervening note-less entry');
        state = readState(repo);
        assert.strictEqual(state.plan, plans[2], 'the leash did not move again');
        assert.strictEqual(state.history.length, 2, 'no third outcome was recorded');
        assert.strictEqual(readEvents(local).length, 2, 'the spent lead emitted nothing');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('the spent key retires by position: past its neighbourhood, a matching text digest is judged as new', () => {
    // The direction that bounds the collision surface: a text-digest key in a
    // uuid-less transcript matches any later identically worded blocker, so a
    // key honored forever would hold a genuinely new cross-cutting blocker
    // ("I need the staging credentials") for the rest of the queue. Once the
    // recording plan is neither current nor immediately previous, a matching
    // identity is far more plausibly a new lead than a three-stop-stale read,
    // so it advances or releases as usual (here, on the last plan: the
    // pre-queue allow, with its goal-blocked emitted).
    const repo = makeDir('kit-goal-stop-repo-');
    const local = makeDir('kit-goal-stop-local-');
    const plans = ['docs/plans/p1.md', 'docs/plans/p2.md', 'docs/plans/p3.md', 'docs/plans/p4.md'];
    const sameText = 'BLOCKED: I need the staging credentials.';
    try {
        for (const p of plans) writeFile(path.join(repo, p), 'Status: In Progress\n\nbody\n');
        assert.strictEqual(armGoal(repo, plans).ok, true, 'test setup: the queue should arm');
        const digestKey = 'text:' + crypto.createHash('sha256').update(sameText).digest('hex');
        assert.strictEqual(advanceGoal(repo, { outcome: 'blocked', note: sameText, leadKey: digestKey }).advanced, true);
        assert.strictEqual(advanceGoal(repo, { outcome: 'complete' }).advanced, true);
        assert.strictEqual(advanceGoal(repo, { outcome: 'complete' }).advanced, true);
        assert.strictEqual(bindSession(repo, 'sess-q').ok, true);
        const state = readState(repo);
        assert.strictEqual(state.plan, plans[3], 'setup: the leash is on the last plan');
        assert.strictEqual(state.blockedAdvancePlan, plans[1], 'setup: the recording plan is two positions back');

        const transcript = path.join(repo, 'transcript.jsonl');
        writeFile(transcript, [
            JSON.stringify({
                type: 'user',
                message: {
                    role: 'user',
                    content: '<command-name>/kit-goal</command-name>\n'
                        + '<command-args>' + plans.join(' ') + '</command-args>'
                }
            }),
            JSON.stringify({
                type: 'assistant',
                message: { role: 'assistant', content: [{ type: 'text', text: sameText }] }
            })
        ].join('\n') + '\n');
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-q' }, local);
        assert.strictEqual(res.stdout, '', 'a retired key no longer holds: the last-plan blocker releases');
        assert.strictEqual(res.status, 0);
        const events = readEvents(local);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].event, 'goal-blocked');
        assert.strictEqual(events[0].plan, plans[3]);
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a bare key with no recording plan (a state file from before the plan rode with it) still holds a matching lead', () => {
    // Backward compatibility stated as a direction: with no recorded plan,
    // position cannot be judged, and the cheap wrong answer is an advance off
    // an already-consumed entry, so the bare key is honored wherever it
    // matches, failing toward holding.
    const repo = makeDir('kit-goal-stop-repo-');
    const local = makeDir('kit-goal-stop-local-');
    const plans = ['docs/plans/first.md', 'docs/plans/second.md'];
    try {
        for (const p of plans) writeFile(path.join(repo, p), 'Status: In Progress\n\nbody\n');
        writeFile(path.join(repo, '.kit', 'goal-state.json'), JSON.stringify({
            plan: plans[1],
            condition: 'Work ' + plans[1] + ' to completion using executing-work.',
            armedAt: '2026-08-16T00:00:00.000Z',
            boundSession: 'sess-q', boundTranscript: null,
            queue: plans, queueIndex: 1,
            history: [{ plan: plans[0], outcome: 'blocked', at: '2026-08-16T00:00:00.000Z', note: 'BLOCKED: need the deploy key.' }],
            blockedAdvanceKey: 'uuid:legacy-1'
        }, null, 2) + '\n');
        const transcript = path.join(repo, 'transcript.jsonl');
        writeFile(transcript, [
            JSON.stringify({
                type: 'user',
                message: {
                    role: 'user',
                    content: '<command-name>/kit-goal</command-name>\n'
                        + '<command-args>' + plans.join(' ') + '</command-args>'
                }
            }),
            JSON.stringify({
                type: 'assistant', uuid: 'legacy-1',
                message: { role: 'assistant', content: [{ type: 'text', text: 'BLOCKED: need the deploy key.' }] }
            })
        ].join('\n') + '\n');
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-q' }, local);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'the bare legacy key still holds the spent lead');
        assert.ok(out.reason.includes('already recorded'));
        assert.strictEqual(readState(repo).plan, plans[1], 'the leash did not move');
        assert.deepStrictEqual(readEvents(local), [], 'the spent lead emitted nothing');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a failed mid-queue BLOCKED advance re-blocks and names the unrecorded blocker, quoted and terminated', () => {
    // The not-advanced branch splices the same transcript-sourced note into
    // its reason as the advanced branch does, so it answers to the same
    // boundary rule: the note carries no guaranteed sentence end, and the
    // quotes plus the period keep the repo data separable from the
    // instruction that follows it.
    const blocker = 'BLOCKED: the rollout order is yours to call';
    const { repo, plans, transcript, local } = armedQueueRepo([blocker]);
    try {
        assert.strictEqual(bindSession(repo, 'sess-q').ok, true,
            'setup: bound already, so the refused write is the advance, not the bind');
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-q' }, local,
            { NODE_OPTIONS: writeRefusingPreload(local) });
        assert.strictEqual(res.status, 0, 'exit 0: a nonzero exit would mean the preload itself failed to load');
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'a failed advance must not release the session');
        assert.ok(out.reason.includes('could not be recorded'), 'the reason says the advance did not land');
        assert.ok(out.reason.includes("The blocker to record for " + plans[0] + " is: '" + blocker + "'."),
            'the unrecorded note is quoted and terminated');
        assert.strictEqual(readState(repo).plan, plans[0], 'the write genuinely failed, so the leash has not moved');
        assert.strictEqual(readEvents(local).length, 1, 'the blocked stop still emitted its goal-blocked');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

// A preload that records any fs.openSync whose target names the probe needle,
// by creating a marker file through the un-patched open: proves a path was
// never OPENED, which is the hazard (a traversal target outside the repo, or
// a FIFO whose open blocks), where asserting on the hook's silence alone
// would not. The NODE_OPTIONS shape matches the other preloads': forward-
// slashed, because Node reads a backslash in NODE_OPTIONS as an escape.
function openSpyPreload(dir, needle, marker) {
    const shim = path.join(dir, 'open-spy.js');
    writeFile(shim, [
        "'use strict';",
        "const fs = require('fs');",
        'const real = fs.openSync;',
        'fs.openSync = function (target) {',
        '    if (String(target).includes(' + JSON.stringify(needle) + ')) {',
        '        const fd = real(' + JSON.stringify(marker) + ", 'w');",
        '        fs.closeSync(fd);',
        '    }',
        '    return real.apply(fs, arguments);',
        '};'
    ].join('\n') + '\n');
    return '--require "' + shim.replace(/\\/g, '/') + '"';
}

test('a goal state whose plan traverses out of the repo is never opened by the Stop hook: allow', () => {
    // readGoal re-validates the plan as a path, so a hand-edited traversal
    // value reads as no armed goal: the hook allows on its hot path and the
    // outside target (which on POSIX could be a FIFO whose open would wedge
    // the stop) is never handed to planHead.
    const repo = makeDir('kit-goal-stop-repo-');
    const local = makeDir('kit-goal-stop-local-');
    const probe = 'kit-goal-outside-probe.md';
    const marker = path.join(local, 'opened-outside.marker');
    try {
        writeFile(path.join(repo, '.kit', 'goal-state.json'), JSON.stringify({
            plan: '../../' + probe, condition: 'c', armedAt: '2026-08-16T00:00:00.000Z',
            boundSession: 'sess-x', boundTranscript: null,
            queue: ['../../' + probe], queueIndex: 0, history: []
        }, null, 2) + '\n');
        const transcript = path.join(repo, 'transcript.jsonl');
        writeTranscript(transcript, '../../' + probe, ['Working.']);
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-x' }, local,
            { NODE_OPTIONS: openSpyPreload(local, probe, marker) });
        assert.strictEqual(res.status, 0);
        assert.strictEqual(res.stdout, '', 'a malformed state enforces nothing');
        assert.ok(!fs.existsSync(marker), 'the traversal plan was never opened');
        assert.deepStrictEqual(readEvents(local), [], 'nothing is emitted off a malformed state');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a queue advance rewrites a matching open compaction checkpoint to the new current plan', () => {
    // The chapter-close ritual opens a checkpoint immediately after every
    // Chapter, the plan's final one included, and the compaction gate rejects
    // a checkpoint whose plan differs from the goal's current plan. Without
    // the rewrite, "close final chapter -> open checkpoint -> flip Complete
    // -> stop" strands the just-opened checkpoint as wrong-plan at the
    // largest boundary in the run.
    const { repo, plans, transcript, local } = armedQueueRepo(['Closed the final chapter.'], ['Status: Complete']);
    try {
        assert.strictEqual(bindSession(repo, 'sess-queue').ok, true);
        assert.strictEqual(writeCheckpoint(repo, plans[0], 'sess-queue', false, 'sess-queue').ok, true);
        const res = runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-queue' }, local);
        assert.strictEqual(JSON.parse(res.stdout).decision, 'block', 'setup: the advance held the stop');
        assert.strictEqual(readState(repo).plan, plans[1], 'setup: the advance landed');
        const cp = readCheckpoint(repo);
        assert.strictEqual(cp.plan, plans[1], 'the open checkpoint follows the advance');
        assert.strictEqual(cp.boundSession, 'sess-queue');
        assert.strictEqual(cp.openedBy, 'sess-queue',
            'and names the bound session as its opener, which is what the gate\'s wrong-opener leg'
                + ' holds it to: a record whose opener is not the compacting session is refused');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

// An open deferral episode owned by the given session, written into the gate's
// state file: the live hold the advance re-derives its pending-offer flag from.
// The newest denial is a minute old, so the episode is open; sinceMsAgo dates
// when the hold began, which must predate any record it vouches for.
function holdOffersFor(repo, session, sinceMsAgo) {
    const now = Date.now();
    const minuteAgo = new Date(now - 60 * 1000).toISOString();
    writeFile(path.join(repo, '.kit', 'compact-gate.json'), JSON.stringify({
        lastDecision: null,
        episode: {
            session,
            since: new Date(now - (sinceMsAgo === undefined ? 60 * 1000 : sinceMsAgo)).toISOString(),
            denials: 3,
            lastDeniedAt: minuteAgo,
            nudgedAt: null
        },
        lastAllow: null
    }, null, 2) + '\n');
}

test('the queue advance re-derives the pending-offer flag from the live gate state', () => {
    // The rewrite re-dates openedAt, so copying a stored true would renew the
    // long age bound at every advance: a queue of N plans could carry one
    // never-consumed boundary for N days, and a day-stale checkpoint could
    // follow an advance onto a NEW plan where only a ten-minute-old one could
    // before. Asking the same question `open` asks, at the moment of the
    // advance, makes the renewal conditional on a hold genuinely standing.
    //
    // Each case is the stored flag against the live state, including the
    // absent-key shape an older kit wrote. The stored value never decides.
    const cases = [
        { stored: true, hold: null, expected: false, what: 'a stored hold that no longer stands is dropped' },
        { stored: false, hold: 'sess-queue', expected: true, what: 'a live hold is picked up' },
        { stored: undefined, hold: 'sess-queue', expected: true, what: 'an older three-field record is read live' },
        { stored: undefined, hold: null, expected: false, what: 'and stays false with no hold' },
        { stored: true, hold: 'sess-other', expected: false, what: 'another session\'s hold does not count' }
    ];
    for (const c of cases) {
        const { repo, plans, transcript, local } = armedQueueRepo(['Closed the final chapter.'], ['Status: Complete']);
        try {
            assert.strictEqual(bindSession(repo, 'sess-queue').ok, true);
            if (c.stored === undefined) {
                // The pre-flag shape, hand-written: no pendingOffer key.
                writeFile(checkpointPath(repo), JSON.stringify({
                    plan: plans[0], boundSession: 'sess-queue', openedBy: 'sess-queue', openedAt: new Date().toISOString()
                }) + '\n');
                assert.ok(!('pendingOffer' in readCheckpoint(repo)), 'setup: the key is absent');
            } else {
                assert.strictEqual(writeCheckpoint(repo, plans[0], 'sess-queue', c.stored, 'sess-queue').ok, true);
                assert.strictEqual(readCheckpoint(repo).pendingOffer, c.stored, 'setup: the flag is on disk');
            }
            if (c.hold) holdOffersFor(repo, c.hold);
            runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-queue' }, local);
            assert.strictEqual(readState(repo).plan, plans[1], 'setup: the advance landed');
            const cp = readCheckpoint(repo);
            assert.strictEqual(cp.plan, plans[1], 'the checkpoint followed the advance: ' + c.what);
            assert.strictEqual(cp.pendingOffer, c.expected, c.what);
        } finally {
            rmDir(repo);
            rmDir(local);
        }
    }
});

test('an advance on the claim path uses the binding it just took, not the stale snapshot', () => {
    // The goal is read once at the top of the hook, and the claim path binds
    // this session to it a few lines later. Everything below reads the binding
    // from that snapshot: the checkpoint match rule compares the goal's bound
    // session against the record's, and the advance scopes its deferral-episode
    // question to it. Leaving the snapshot unrefreshed answers both with null
    // on the one path where this session has just claimed the goal, so a
    // checkpoint the run legitimately owns reads wrong-session and the largest
    // boundary in the run strands. The PreCompact gate refreshes at the same
    // point after its own bind.
    //
    // No bindSession here: the transcript's arming invocation is what claims
    // it, which is the whole point of the fixture.
    const { repo, plans, transcript, local } = armedQueueRepo(['Closed the final chapter.'], ['Status: Complete']);
    try {
        assert.strictEqual(readState(repo).boundSession, null, 'setup: the goal starts unbound');
        assert.strictEqual(writeCheckpoint(repo, plans[0], 'sess-queue', false, 'sess-queue').ok, true);
        runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-queue' }, local);
        assert.strictEqual(readState(repo).boundSession, 'sess-queue', 'setup: the claim bound the goal');
        assert.strictEqual(readState(repo).plan, plans[1], 'setup: the advance landed');
        assert.strictEqual(readCheckpoint(repo).plan, plans[1],
            'the checkpoint follows the advance on the path that just claimed the binding');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('a checkpoint only the long bound keeps alive still follows the advance', () => {
    // What the fourth argument to the match rule buys, and the only shape that
    // exercises it: every other advance case writes a checkpoint seconds old,
    // which matches on the ten-minute leg whatever is passed. The real sequence
    // is a chapter close, `open` under a hold, a 70-minute dispatch, the plan
    // flipped Complete, and the stop. Without the argument this checkpoint
    // reads expired at the advance, is not rewritten, and the largest boundary
    // in the run strands as wrong-plan.
    const { repo, plans, transcript, local } = armedQueueRepo(['Closed the final chapter.'], ['Status: Complete']);
    try {
        assert.strictEqual(bindSession(repo, 'sess-queue').ok, true);
        const openedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        writeFile(checkpointPath(repo), JSON.stringify({
            plan: plans[0], boundSession: 'sess-queue', openedBy: 'sess-queue', openedAt, pendingOffer: true
        }) + '\n');
        // The hold predates the record, which is what makes it corroborating.
        holdOffersFor(repo, 'sess-queue', 61 * 60 * 1000);
        runHook({ cwd: repo, transcript_path: transcript, session_id: 'sess-queue' }, local);
        assert.strictEqual(readState(repo).plan, plans[1], 'setup: the advance landed');
        const cp = readCheckpoint(repo);
        assert.strictEqual(cp.plan, plans[1], 'an hour-old corroborated checkpoint follows the advance');
        assert.strictEqual(cp.pendingOffer, true, 'and the hold still standing is recorded');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});

test('the advance leaves a non-matching checkpoint alone and creates none when none is open', () => {
    // Only a checkpoint the match rule already honors against the pre-advance
    // goal (same plan, same bound session, fresh) follows the advance: an
    // orphan from another session stays as it is (wrong-session, the status
    // quo), and an absent checkpoint stays absent.
    const orphan = armedQueueRepo(['Done all sections.'], ['Status: Complete']);
    try {
        assert.strictEqual(bindSession(orphan.repo, 'sess-queue').ok, true);
        assert.strictEqual(writeCheckpoint(orphan.repo, orphan.plans[0], 'sess-other', false, 'sess-other').ok, true);
        runHook({ cwd: orphan.repo, transcript_path: orphan.transcript, session_id: 'sess-queue' }, orphan.local);
        assert.strictEqual(readState(orphan.repo).plan, orphan.plans[1], 'setup: the advance landed');
        const cp = readCheckpoint(orphan.repo);
        assert.strictEqual(cp.plan, orphan.plans[0], 'an orphan checkpoint is not rewritten');
        assert.strictEqual(cp.boundSession, 'sess-other');
    } finally {
        rmDir(orphan.repo);
        rmDir(orphan.local);
    }

    const none = armedQueueRepo(['Done all sections.'], ['Status: Complete']);
    try {
        assert.strictEqual(bindSession(none.repo, 'sess-queue').ok, true);
        runHook({ cwd: none.repo, transcript_path: none.transcript, session_id: 'sess-queue' }, none.local);
        assert.strictEqual(readState(none.repo).plan, none.plans[1], 'setup: the advance landed');
        assert.ok(!fs.existsSync(checkpointPath(none.repo)), 'no checkpoint is minted by the advance');
    } finally {
        rmDir(none.repo);
        rmDir(none.local);
    }
});

test('bound goal, Stop payload missing session_id entirely: empty stdout (the documented fail-open release)', () => {
    // Pins the shape loudly: if the harness ever stops sending session_id, a
    // bound goal must not silently start enforcing (or silently stop enforcing)
    // by accident. sameSessionId treats a missing id as "no match", so this
    // resolves as a bystander and allows.
    const { repo, transcript, local } = armedRepo(['Making progress.']);
    try {
        assert.strictEqual(bindSession(repo, 'sess-owner').ok, true);
        const res = runHook({ cwd: repo, transcript_path: transcript }, local);
        assert.strictEqual(res.stdout, '', 'a Stop payload with no session_id at all is treated as a bystander: allow');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(readBoundSession(repo), 'sess-owner', 'the existing binding is untouched');
    } finally {
        rmDir(repo);
        rmDir(local);
    }
});
