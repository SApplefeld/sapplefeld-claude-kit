// Tests for the goal family in a linked git worktree: goalPath in
// plugins/claude-kit/hooks/kit-goal-lib.js resolves .kit/goal-state.json
// against the working tree itself, so a session working in a worktree holds
// that tree's own leash and the main checkout's leash is untouched by it. The
// checkpoint CLI, the PreCompact gate and the Stop hook inherit the resolution
// through the lib.
//
// The subject split is pinned here over shared fixtures: memq.js files a
// worktree's memories under the main checkout, because a memory is about the
// repository, while a leash is about an execution stream and git makes a
// working tree the unit of one. The two answers are asserted side by side over
// one set of fixtures so the pair cannot drift into agreeing again.
//
// Node's built-in test runner, no framework (Node v24). Worktree fixtures are
// synthesized (a .git pointer file plus the administrative pair git maintains)
// so a test can bend one joint at a time, mirroring the memq suite's builder;
// the acceptance case that runs `git worktree add` for real is skipped where
// no git binary is on PATH, and everything it proves structurally is also
// pinned by the synthesized cases. No two fixture names differ only by case:
// NTFS collapses those into one file.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const GOAL_CLI = path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'kit-goal.js');
const CHECKPOINT_CLI = path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'kit-compact-checkpoint.js');
const GATE = path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'kit-compact-gate.js');
const STOP_HOOK = path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'kit-goal-stop.js');

const {
    goalPath, readGoal, armGoal, bindSession, clearGoal
} = require('../plugins/claude-kit/hooks/kit-goal-lib.js');
const {
    checkpointPath, writeCheckpoint, recordEpisodeNudge
} = require('../plugins/claude-kit/hooks/kit-compact-lib.js');
const memq = require('../plugins/claude-kit/scripts/memq.js');

// The session id fixtures bind the goal to; gate payloads default to it so the
// leash-holder path is the baseline, matching the gate suite's own fixtures.
const SESSION = 'ses-11112222-aaaa-bbbb-cccc-333344445555';

// The two deny notes, duplicated from the gate as pins: which note fires is
// what tells a boundary deny (the leash holder's own gate) from an interactive
// one (a session no goal covers), and the guard cases below turn on exactly
// that difference.
const DENY_NOTE = 'kit-compact-gate: auto-compaction deferred to the next chapter close or interim board entry';
const INTERACTIVE_NOTE = 'kit-compact-gate: auto-compaction deferred to the context safety ceiling';

// Worktree fixtures are built under the canonical spelling of the temp root
// rather than under os.tmpdir() directly. This machine's TEMP is an 8.3 short
// path, and an accepted main root is folded to the volume's own spelling on
// win32, so fixtures built from the short form would resolve to a path no
// assertion here could write down twice.
const WORKTREE_TMP = process.platform === 'win32'
    ? fs.realpathSync.native(os.tmpdir())
    : os.tmpdir();

function rmDir(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

function writeFile(full, contents) {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf8');
}

// A main checkout plus a worktree wired to it, mirroring the memq suite's
// builder because the two resolvers read the same on-disk shape. Options bend
// one joint each: `name` is the worktrees/<name> segment, `kind` the directory
// under `.git` (`modules` is the submodule shape), `pointer` the path written
// into the worktree's `.git` file with `relative` writing that same target as
// a forward-slash relative path instead, `backPointer` the content of the
// back-pointer file with null leaving that file absent, and `commondir: null`
// leaving out the file git keeps beside every worktree's administrative
// directory.
function makeWorktree(options) {
    const opts = options || {};
    const main = fs.mkdtempSync(path.join(WORKTREE_TMP, 'kit-goal-main-'));
    const tree = fs.mkdtempSync(path.join(WORKTREE_TMP, 'kit-goal-tree-'));
    const gitdir = path.join(main, '.git', opts.kind || 'worktrees', opts.name || 'wt');
    fs.mkdirSync(gitdir, { recursive: true });
    if (opts.commondir !== null) {
        fs.writeFileSync(path.join(gitdir, 'commondir'), '../..\n', 'utf8');
    }
    if (opts.backPointer !== null) {
        const back = opts.backPointer === undefined ? path.join(tree, '.git') : opts.backPointer;
        fs.writeFileSync(path.join(gitdir, 'gitdir'), back + '\n', 'utf8');
    }
    const pointer = opts.relative
        ? path.relative(tree, gitdir).split(path.sep).join('/')
        : (opts.pointer === undefined ? gitdir : opts.pointer);
    fs.writeFileSync(path.join(tree, '.git'), 'gitdir: ' + pointer + '\n', 'utf8');
    return { main, tree, gitdir, pointer };
}

function rmWorktree(w) {
    rmDir(w.main);
    rmDir(w.tree);
}

// A bare repository's worktree: the gitdir names <bare>/repo.git/worktrees/wt,
// so the segment above `worktrees` is not a `.git` directory and the shape
// check refuses it. There is no main checkout to resolve to, which is exactly
// what the refusal says.
function makeBareWorktree() {
    const bare = fs.mkdtempSync(path.join(WORKTREE_TMP, 'kit-goal-bare-'));
    const tree = fs.mkdtempSync(path.join(WORKTREE_TMP, 'kit-goal-baretree-'));
    const gitdir = path.join(bare, 'repo.git', 'worktrees', 'wt');
    fs.mkdirSync(gitdir, { recursive: true });
    fs.writeFileSync(path.join(gitdir, 'commondir'), '../..\n', 'utf8');
    fs.writeFileSync(path.join(gitdir, 'gitdir'), path.join(tree, '.git') + '\n', 'utf8');
    fs.writeFileSync(path.join(tree, '.git'), 'gitdir: ' + gitdir + '\n', 'utf8');
    return { bare, tree, gitdir };
}

// The root the goal family resolved for a working directory, read back out of
// goalPath's answer rather than through a dedicated export: <root>/.kit/
// goal-state.json is the whole contract, so the path is the observable.
function goalRootOf(cwd) {
    return path.dirname(path.dirname(goalPath(cwd)));
}

// Drop the external-engine and caller-session variables from a child's
// environment, for the gate suite's reasons: this suite runs inside fleet
// workers and live sessions, where both are ambient and would flip verdicts.
function childEnv(extra) {
    const env = { ...process.env, ...(extra || {}) };
    for (const k of Object.keys(env)) {
        if (/^KIT_EXTERNAL_ENGINE$/i.test(k) || /^CLAUDE_CODE_SESSION_ID$/i.test(k)) delete env[k];
    }
    return env;
}

function ownGoalPath(cwd) {
    return path.join(cwd, '.kit', 'goal-state.json');
}

function runGoalCli(args, cwd) {
    return spawnSync(process.execPath, [GOAL_CLI, ...args], { cwd, encoding: 'utf8', env: childEnv() });
}

function runCheckpointCli(args, cwd, session) {
    const env = childEnv();
    if (session !== undefined) env.CLAUDE_CODE_SESSION_ID = session;
    return spawnSync(process.execPath, [CHECKPOINT_CLI, ...args], { cwd, encoding: 'utf8', env });
}

function runGate(payload) {
    return spawnSync(process.execPath, [GATE], {
        input: JSON.stringify(payload), encoding: 'utf8', env: childEnv()
    });
}

// A PreCompact payload in the live shape, defaulting to the leash holder's own
// below-ceiling state against the given fixtures.
function gatePayload(cwd, transcript) {
    return {
        session_id: SESSION,
        transcript_path: transcript,
        cwd,
        prompt_id: 'prompt-1',
        hook_event_name: 'PreCompact',
        trigger: 'auto',
        custom_instructions: null
    };
}

// A JSONL transcript whose newest main-thread assistant row sums to a
// below-ceiling token count, the gate suite's own fixture shape.
function writeUsageTranscript(full, consumed) {
    const lines = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'keep going' } }),
        JSON.stringify({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'Working.' }],
                usage: {
                    input_tokens: consumed - 1000,
                    cache_creation_input_tokens: 600,
                    cache_read_input_tokens: 400
                }
            }
        }),
        JSON.stringify({ type: 'system', subtype: 'turn-metadata' })
    ];
    writeFile(full, lines.join('\n') + '\n');
}

const PLAN_REL = 'docs/plans/example.md';

function writePlanDoc(root) {
    writeFile(path.join(root, PLAN_REL), 'Status: In Progress\n\nbody\n');
}

// A Stop-hook transcript: the arming user line (the plan path inside a
// <command-args> span, which is what claims an unbound goal for the stopping
// session) followed by the given assistant turns, matching the stop suite's
// own fixture shape.
function writeStopTranscript(full, planRel, assistantTexts) {
    const lines = [JSON.stringify({
        type: 'user',
        message: {
            role: 'user',
            content: '<command-name>/kit-goal</command-name>\n'
                + '<command-message>kit-goal</command-message>\n'
                + '<command-args>' + planRel + '</command-args>'
        }
    })];
    for (const t of assistantTexts) {
        lines.push(JSON.stringify({
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'text', text: t }] }
        }));
    }
    writeFile(full, lines.join('\n') + '\n');
}

// Run the goal-leash Stop hook against a cwd as the bound session, with
// clause-(b) retries off and the goal-event sink pinned inside the caller's
// temp root so no release a case fires appends to the real
// ~/.claude/kit-events.jsonl. The fixtures bind the goal to SESSION at arm
// time, because a queue that advances needs the binding to outlive the first
// plan: the transcript's arming claim names only the plan it armed.
function runStopHook(cwd, transcript, eventsRoot) {
    return spawnSync(process.execPath, [STOP_HOOK], {
        input: JSON.stringify({ cwd, transcript_path: transcript, session_id: SESSION }),
        encoding: 'utf8',
        env: childEnv({
            KIT_GOAL_STOP_RETRY_MS: '0',
            KIT_EVENTS_PATH: path.join(eventsRoot, 'events.jsonl'),
            KIT_EVENTS_PATH_ALLOW: '1'
        })
    });
}

function readStopEvents(eventsRoot) {
    const sink = path.join(eventsRoot, 'events.jsonl');
    if (!fs.existsSync(sink)) return [];
    return fs.readFileSync(sink, 'utf8').split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line));
}

// ---------------------------------------------------------------------------
// Resolution: a worktree's reads and writes land in the worktree itself.
// ---------------------------------------------------------------------------

test('a worktree resolves goal state against its own working tree', () => {
    const w = makeWorktree();
    try {
        assert.strictEqual(goalPath(w.tree), ownGoalPath(w.tree),
            'goal state resolves to the working tree\'s own .kit');
        // The main checkout of the same repository is a separate execution
        // stream with a leash of its own, so a goal armed there is not this
        // tree's goal and this tree reads no goal at all.
        writePlanDoc(w.main);
        assert.strictEqual(armGoal(w.main, PLAN_REL).ok, true, 'setup: arm in the main checkout');
        assert.strictEqual(readGoal(w.tree), null,
            'the main checkout\'s leash does not reach the worktree');
        const seen = readGoal(w.main);
        assert.ok(seen && seen.plan === PLAN_REL, 'and it still stands where it was armed');
    } finally {
        rmWorktree(w);
    }
});

test('goal-state writes from a worktree land in its own .kit, a clear releases there, '
    + 'and the main checkout is untouched throughout', () => {
    const w = makeWorktree();
    try {
        writePlanDoc(w.tree);
        writePlanDoc(w.main);
        const armed = armGoal(w.tree, PLAN_REL);
        assert.strictEqual(armed.ok, true, 'arming from the worktree succeeds: ' + JSON.stringify(armed));
        assert.ok(fs.existsSync(ownGoalPath(w.tree)),
            'the state file lands in the worktree\'s own .kit');
        assert.ok(!fs.existsSync(ownGoalPath(w.main)),
            'and nothing is written to the main checkout\'s .kit');
        const bound = bindSession(w.tree, SESSION);
        assert.strictEqual(bound.ok, true, 'binding from the worktree succeeds');
        const seen = readGoal(w.tree);
        assert.ok(seen && seen.boundSession === SESSION, 'the worktree reads the binding it wrote');
        assert.strictEqual(readGoal(w.main), null, 'the main checkout still holds no leash');
        const cleared = clearGoal(w.tree);
        assert.deepStrictEqual({ ok: cleared.ok, cleared: cleared.cleared }, { ok: true, cleared: true });
        assert.ok(!fs.existsSync(ownGoalPath(w.tree)), 'the clear released the worktree\'s own file');
    } finally {
        rmWorktree(w);
    }
});

test('two leashes in one repository stand side by side, each read only from its own tree', () => {
    const w = makeWorktree();
    const OTHER_REL = 'docs/plans/other.md';
    try {
        // The state the old repository-wide resolution could not represent and
        // the reason this one exists: a worktree seat and a main-checkout seat
        // running different plans at the same time.
        writePlanDoc(w.main);
        writeFile(path.join(w.tree, OTHER_REL), 'Status: In Progress\n\nbody\n');
        assert.strictEqual(armGoal(w.main, PLAN_REL).ok, true, 'setup: arm in the main checkout');
        assert.strictEqual(armGoal(w.tree, OTHER_REL).ok, true, 'setup: arm in the worktree');
        assert.strictEqual(readGoal(w.main).plan, PLAN_REL, 'the main checkout holds its own plan');
        assert.strictEqual(readGoal(w.tree).plan, OTHER_REL, 'the worktree holds its own plan');
    } finally {
        rmWorktree(w);
    }
});

// ---------------------------------------------------------------------------
// The subject-split pin: over one set of fixtures, the goal family answers
// with the working tree while memq answers with the main checkout the tree
// hangs off. The split is what the two subjects require (a leash names an
// execution stream, a memory names the repository), and it is asserted here
// rather than in either suite alone because each side tested against its own
// literal is how the pair could quietly drift back into one answer.
// ---------------------------------------------------------------------------

test('goal state resolves to the working tree while memq files under the main checkout '
    + '(the subject-split pin)', () => {
    const plain = fs.mkdtempSync(path.join(WORKTREE_TMP, 'kit-goal-pin-plain-'));
    fs.mkdirSync(path.join(plain, '.git'), { recursive: true });
    const held = makeWorktree({ name: 'pin' });
    const bare = makeBareWorktree();
    const sub = makeWorktree({ kind: 'modules', name: 'pinsub' });
    const relative = makeWorktree({ name: 'pinrel', relative: true });
    const noBackPointer = makeWorktree({ name: 'pinbp', backPointer: null });
    const noCommondir = makeWorktree({ name: 'pincd', commondir: null });
    // The refused shapes are pinned beside the benign ones, because the guards
    // are where memq's resolver can move while every ordinary fixture stays
    // green: a start-anchored pointer grammar, the pointer read cap, the
    // pointer path cap, the two-way handshake, and (on win32) the
    // network-shape screen. A change that drops one of them must fail here.
    const notPointer = makeWorktree({ name: 'pinnp' });
    fs.writeFileSync(path.join(notPointer.tree, '.git'),
        'notes to self\ngitdir: ' + notPointer.gitdir + '\n', 'utf8');
    const overReadCap = makeWorktree({ name: 'pinrc' });
    fs.writeFileSync(path.join(overReadCap.tree, '.git'),
        ' '.repeat(65536) + 'gitdir: ' + overReadCap.gitdir + '\n', 'utf8');
    const overPathCap = makeWorktree({
        name: 'pinpc',
        pointer: path.join(WORKTREE_TMP, 'p'.repeat(2100), '.git', 'worktrees', 'wt')
    });
    const unc = process.platform === 'win32'
        ? makeWorktree({ pointer: '//evil.invalid/share/.git/worktrees/w' })
        : null;
    try {
        // memq's side is pinned by value, not only by difference: a store
        // resolver broken to answer the tree would otherwise read as the
        // split this test is about.
        assert.strictEqual(memq.worktreeMainRoot(held.tree), held.main,
            'memq files a worktree\'s memories under the main checkout');
        assert.strictEqual(memq.worktreeMainRoot(relative.tree), relative.main,
            'including a pointer git spelled relative, with forward slashes');
        const rows = [
            ['ordinary checkout', plain, false],
            ['worktree whose handshake holds', held.tree, true],
            ['worktree with a relative pointer', relative.tree, true],
            ['worktree with no back-pointer file', noBackPointer.tree, false],
            ['worktree with no commondir file', noCommondir.tree, false],
            ['bare-repo worktree', bare.tree, false],
            ['submodule', sub.tree, false],
            ['non-pointer .git file', notPointer.tree, false],
            ['pointer past the read cap', overReadCap.tree, false],
            ['pointer past the path cap', overPathCap.tree, false]
        ];
        if (unc) rows.push(['UNC-spelled pointer', unc.tree, false]);
        for (const [label, cwd, resolves] of rows) {
            // The goal side answers the working directory for every shape
            // alike, benign and refused: no pointer on disk moves where a
            // leash lives.
            assert.strictEqual(goalRootOf(cwd), cwd,
                'goal state left the working tree over the ' + label + ' fixture');
            // memq's own answer is asserted in both directions, since a
            // resolver that answered null everywhere would satisfy a
            // difference test while resolving nothing at all.
            assert.strictEqual(memq.worktreeMainRoot(cwd) !== null, resolves,
                'memq resolved the ' + label + ' fixture the wrong way');
        }
    } finally {
        rmDir(plain);
        rmWorktree(held);
        rmWorktree(relative);
        rmWorktree(noBackPointer);
        rmWorktree(noCommondir);
        rmDir(bare.bare);
        rmDir(bare.tree);
        rmWorktree(sub);
        rmWorktree(notPointer);
        rmWorktree(overReadCap);
        rmWorktree(overPathCap);
        if (unc) rmWorktree(unc);
    }
});

// ---------------------------------------------------------------------------
// The consumers: the checkpoint CLI and the gate inherit the resolution, so a
// leash armed in a worktree binds and gates in that worktree, and the gate's
// matching semantics do not widen with it.
// ---------------------------------------------------------------------------

// Whether a real git binary is on PATH. The acceptance case runs `git worktree
// add` for real so the fixture is git's own wiring rather than this suite's
// reading of it; on a machine with no git the synthesized cases still pin the
// shape, and the skip is visible in the runner's output rather than silent.
const GIT_ON_PATH = (() => {
    try { return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0; } catch { return false; }
})();

function git(args, cwd) {
    return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

test('acceptance: a real `git worktree add` worktree holds a leash of its own', {
    skip: GIT_ON_PATH ? false : 'git is not on PATH'
}, () => {
    const main = fs.mkdtempSync(path.join(WORKTREE_TMP, 'kit-goal-real-main-'));
    const treeParent = fs.mkdtempSync(path.join(WORKTREE_TMP, 'kit-goal-real-tree-'));
    const tree = path.join(treeParent, 'wt');
    try {
        assert.strictEqual(git(['init', '-q'], main).status, 0, 'setup: git init');
        writePlanDoc(main);
        assert.strictEqual(git(['add', '.'], main).status, 0, 'setup: git add');
        const committed = git(['-c', 'user.email=kit@test.invalid', '-c', 'user.name=kit',
            'commit', '-q', '-m', 'plan'], main);
        assert.strictEqual(committed.status, 0, 'setup: git commit: ' + committed.stderr);
        const added = git(['worktree', 'add', '--detach', '-q', tree], main);
        assert.strictEqual(added.status, 0, 'setup: git worktree add: ' + added.stderr);

        const armed = armGoal(tree, PLAN_REL);
        assert.strictEqual(armed.ok, true, 'setup: goal should arm in the worktree');

        // Acceptance 1: the checkpoint CLI honours the worktree's own leash.
        const opened = runCheckpointCli(['open'], tree, SESSION);
        assert.strictEqual(opened.status, 0, 'open succeeds from the worktree; stderr: ' + opened.stderr);
        assert.ok(opened.stdout.includes(PLAN_REL), 'output names the plan: ' + opened.stdout);
        const cp = JSON.parse(fs.readFileSync(checkpointPath(tree), 'utf8'));
        assert.strictEqual(cp.plan, PLAN_REL, 'the checkpoint records the armed plan');

        // Acceptance 2: status reports the leash in the tree that holds it,
        // and reports none in the checkout that does not.
        const here = runGoalCli(['status'], tree);
        assert.strictEqual(here.status, 0, 'status succeeds in the worktree; stderr: ' + here.stderr);
        assert.ok(here.stdout.includes('kit goal armed for ' + PLAN_REL),
            'status reports the armed goal from the worktree: ' + here.stdout);
        const there = runGoalCli(['status'], main);
        assert.strictEqual(there.status, 0, 'status succeeds in the main checkout; stderr: ' + there.stderr);
        assert.ok(!there.stdout.includes('kit goal armed for'),
            'the main checkout reports no leash of its own: ' + there.stdout);

        // Acceptance 3: state writes from the worktree land in its own .kit,
        // and the main checkout's .kit is never written.
        const bound = bindSession(tree, SESSION);
        assert.strictEqual(bound.ok, true, 'binding from the worktree succeeds');
        const seen = readGoal(tree);
        assert.ok(seen && seen.boundSession === SESSION,
            'the worktree reads the binding it wrote');
        assert.ok(!fs.existsSync(ownGoalPath(main)),
            'no goal-state file is minted in the main checkout');
    } finally {
        rmDir(main);
        rmDir(treeParent);
    }
});

test('a bare-repo worktree still refuses checkpoint open with the self-explaining lines', () => {
    const b = makeBareWorktree();
    try {
        const res = runCheckpointCli(['open'], b.tree);
        assert.strictEqual(res.status, 1, 'open refuses; stdout: ' + res.stdout);
        assert.ok(res.stderr.includes('no kit goal is armed'), 'refusal states the reason: ' + res.stderr);
        assert.ok(res.stderr.includes('another checkout'), 'the hint names the other-checkout case: ' + res.stderr);
        assert.ok(res.stderr.includes('arm where you run'), 'and says what to do about it: ' + res.stderr);
        assert.ok(!fs.existsSync(checkpointPath(b.tree)), 'nothing written');
    } finally {
        rmDir(b.bare);
        rmDir(b.tree);
    }
});

test('gate: the worktree\'s own leash gates it, and matching semantics do not widen with it', () => {
    const w = makeWorktree();
    try {
        writePlanDoc(w.tree);
        assert.strictEqual(armGoal(w.tree, PLAN_REL).ok, true, 'setup: arm in the worktree');
        assert.strictEqual(bindSession(w.tree, SESSION).ok, true, 'setup: bind the leash holder');
        const transcript = path.join(w.tree, 'transcript.jsonl');
        writeUsageTranscript(transcript, 50000);

        // The leash holder compacting in the worktree with no checkpoint takes
        // the boundary deny, not the interactive one: the gate found the
        // worktree's own armed goal.
        const noCp = runGate(gatePayload(w.tree, transcript));
        assert.strictEqual(noCp.status, 2, 'deny with no checkpoint; stderr: ' + noCp.stderr);
        assert.ok(noCp.stderr.includes(DENY_NOTE), 'the boundary note fires: ' + noCp.stderr);
        assert.ok(!noCp.stderr.includes(INTERACTIVE_NOTE), 'not the interactive one: ' + noCp.stderr);

        // A matching checkpoint in the worktree's own .kit releases it: this
        // is the control that proves the two deny cases below fail on the
        // mismatch and not on state the gate never found.
        assert.strictEqual(writeCheckpoint(w.tree, PLAN_REL, SESSION, false, SESSION).ok, true, 'setup: checkpoint');
        const matched = runGate(gatePayload(w.tree, transcript));
        assert.strictEqual(matched.status, 0, 'matching checkpoint allows; stderr: ' + matched.stderr);
        assert.ok(!fs.existsSync(checkpointPath(w.tree)), 'the allow consumed the checkpoint');

        // Guard direction: where state is found changed; what matches did not.
        assert.strictEqual(writeCheckpoint(w.tree, 'docs/plans/some-prior-run.md', SESSION, false, SESSION).ok, true);
        const wrongPlan = runGate(gatePayload(w.tree, transcript));
        assert.strictEqual(wrongPlan.status, 2, 'a checkpoint for another plan still denies');
        assert.ok(wrongPlan.stderr.includes(DENY_NOTE), 'as a boundary deny: ' + wrongPlan.stderr);
        assert.ok(fs.existsSync(checkpointPath(w.tree)), 'and is not consumed');
        fs.rmSync(checkpointPath(w.tree));

        assert.strictEqual(writeCheckpoint(w.tree, PLAN_REL, 'ses-99998888-aaaa-bbbb-cccc-000011112222', false, 'ses-99998888-aaaa-bbbb-cccc-000011112222').ok, true);
        const wrongSession = runGate(gatePayload(w.tree, transcript));
        assert.strictEqual(wrongSession.status, 2, 'a checkpoint for another session still denies');
        assert.ok(wrongSession.stderr.includes(DENY_NOTE), 'as a boundary deny: ' + wrongSession.stderr);
        assert.ok(fs.existsSync(checkpointPath(w.tree)), 'and is not consumed');
    } finally {
        rmWorktree(w);
    }
});

test('gate: a worktree deny leaves its decision record and its nudge stamp in that tree', () => {
    // The deferral record and the nudge interval live in the session's own
    // tree, beside the goal state the deny was decided from. Without the
    // record the run this deny belongs to would take every later deny
    // unrecorded, and the nudge that prompts the checkpoint open could never
    // stamp its interval, so it would never speak.
    const w = makeWorktree();
    try {
        writePlanDoc(w.tree);
        assert.strictEqual(armGoal(w.tree, PLAN_REL).ok, true, 'setup: arm in the worktree');
        assert.strictEqual(bindSession(w.tree, SESSION).ok, true, 'setup: bind the leash holder');
        const transcript = path.join(w.tree, 'transcript.jsonl');
        writeUsageTranscript(transcript, 50000);

        const denied = runGate(gatePayload(w.tree, transcript));
        assert.strictEqual(denied.status, 2, 'boundary deny; stderr: ' + denied.stderr);
        assert.ok(denied.stderr.includes(DENY_NOTE), 'the boundary note fires: ' + denied.stderr);

        const statePath = path.join(w.tree, '.kit', 'compact-gate.json');
        assert.ok(fs.existsSync(statePath),
            'the deny left its decision record in the worktree\'s own .kit');
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        assert.strictEqual(state.lastDecision && state.lastDecision.verdict, 'deny-boundary',
            'the recorded decision is the boundary deny: ' + JSON.stringify(state.lastDecision));

        const stamped = recordEpisodeNudge(w.tree, SESSION, Date.now(), 'Bash');
        assert.strictEqual(stamped, true,
            'the nudge stamps its interval on the episode the deny opened');
    } finally {
        rmWorktree(w);
    }
});

// ---------------------------------------------------------------------------
// The Stop hook: the leash and the plan docs it reads are the same tree's, so
// a worktree run advances and releases on that tree's own reading.
// ---------------------------------------------------------------------------

test('stop: an archived plan advances mid-queue and releases on the last plan', () => {
    const w = makeWorktree();
    const eventsRoot = fs.mkdtempSync(path.join(WORKTREE_TMP, 'kit-goal-stopev-'));
    const PLAN2_REL = 'docs/plans/second.md';
    try {
        // Both plan docs live on the worktree's branch, where the leash lives
        // too, so deleting one is the ordinary archive shape and must keep
        // advancing and releasing exactly as it does in a plain checkout.
        writePlanDoc(w.tree);
        writeFile(path.join(w.tree, PLAN2_REL), 'Status: In Progress\n\nbody\n');
        assert.strictEqual(armGoal(w.tree, [PLAN_REL, PLAN2_REL]).ok, true,
            'setup: arm the two-plan queue from the worktree');
        assert.strictEqual(bindSession(w.tree, SESSION).ok, true, 'setup: bind the leash holder');
        const transcript = path.join(w.tree, 'transcript.jsonl');
        writeStopTranscript(transcript, PLAN_REL, ['Working on it.']);

        fs.rmSync(path.join(w.tree, PLAN_REL));
        const advanced = runStopHook(w.tree, transcript, eventsRoot);
        assert.strictEqual(advanced.status, 0, advanced.stderr);
        const held = JSON.parse(advanced.stdout);
        assert.strictEqual(held.decision, 'block', 'the mid-queue advance holds the stop');
        assert.ok(held.reason.includes(PLAN2_REL), 'the reason names the next plan: ' + held.reason);
        const mid = readGoal(w.tree);
        assert.ok(mid && mid.plan === PLAN2_REL, 'the leash advanced to the second plan');
        assert.strictEqual(mid.history[0] && mid.history[0].outcome, 'archived');

        fs.rmSync(path.join(w.tree, PLAN2_REL));
        const releasedRun = runStopHook(w.tree, transcript, eventsRoot);
        assert.strictEqual(releasedRun.status, 0, releasedRun.stderr);
        assert.strictEqual(releasedRun.stdout, '', 'the last plan releases the stop');
        assert.ok(!fs.existsSync(ownGoalPath(w.tree)), 'the release cleared the worktree\'s state');
        const events = readStopEvents(eventsRoot);
        assert.strictEqual(events.length, 2, 'one event per finished plan: ' + JSON.stringify(events));
        assert.ok(events.every((e) => e.detail === 'plan-archived'),
            'both are archive releases: ' + JSON.stringify(events));
    } finally {
        rmWorktree(w);
        rmDir(eventsRoot);
    }
});

test('stop: a blocked declaration with the pointer and the walk agreeing attributes to that plan '
    + 'and advances off it', () => {
    const w = makeWorktree();
    const eventsRoot = fs.mkdtempSync(path.join(WORKTREE_TMP, 'kit-goal-stopev-'));
    const PLAN2_REL = 'docs/plans/second.md';
    try {
        // Nothing is archived, both plans read In Progress, so the position
        // walk settles on the same first plan the stored pointer names.
        // Attribution and enforcement then have one plan between them.
        writePlanDoc(w.tree);
        writeFile(path.join(w.tree, PLAN2_REL), 'Status: In Progress\n\nbody\n');
        assert.strictEqual(armGoal(w.tree, [PLAN_REL, PLAN2_REL]).ok, true,
            'setup: arm the two-plan queue');
        assert.strictEqual(bindSession(w.tree, SESSION).ok, true, 'setup: bind the leash holder');

        const transcript = path.join(w.tree, 'transcript.jsonl');
        writeStopTranscript(transcript, PLAN_REL, ['BLOCKED: need your call on the rollout order.']);

        const res = runStopHook(w.tree, transcript, eventsRoot);
        assert.strictEqual(res.status, 0, res.stderr);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.decision, 'block', 'the blocker holds the stop');

        const events = readStopEvents(eventsRoot);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].event, 'goal-blocked');
        assert.strictEqual(events[0].plan, PLAN_REL,
            'the event names the plan both readings agree on: ' + JSON.stringify(events[0]));

        const state = readGoal(w.tree);
        assert.strictEqual(state.plan, PLAN2_REL, 'the leash advanced exactly one plan');
        assert.strictEqual(state.history[0].outcome, 'blocked');
        assert.strictEqual(state.history[0].plan, PLAN_REL,
            'and the history record files the outcome under that same plan');
        assert.ok(out.reason.includes(PLAN_REL + ' finished (blocked)'),
            'the reason names the plan the leash moved off: ' + out.reason);
        assert.ok(out.reason.includes('the current plan is now ' + PLAN2_REL),
            'and names the plan it moved to: ' + out.reason);
    } finally {
        rmWorktree(w);
        rmDir(eventsRoot);
    }
});
// ---------------------------------------------------------------------------
// Queue position in a worktree. The leash and the plan docs are the same
// tree's, so the reported position is that tree's own reading and a sibling
// checkout's copies of the same plans say nothing about it.
// ---------------------------------------------------------------------------

const QUEUE_A = 'docs/plans/qa.md';
const QUEUE_B = 'docs/plans/qb.md';

function writeQueuePlans(root) {
    writeFile(path.join(root, QUEUE_A), '# A\n\nStatus: In Progress\n\n## Sections of Work\n');
    writeFile(path.join(root, QUEUE_B), '# B\n\nStatus: In Progress\n\n## Sections of Work\n');
}

// The move a close-out makes: the doc's Status row is flipped to Complete and
// the doc is filed under that tree's docs/archive/. Both halves matter,
// because the archive leg reads the filed copy's own header rather than
// treating its presence as evidence.
function archiveIn(root, rel) {
    writeFile(path.join(root, rel), '# A\n\nStatus: Complete\n\n## Chapters\n');
    fs.mkdirSync(path.join(root, 'docs', 'archive'), { recursive: true });
    fs.renameSync(path.join(root, rel), path.join(root, 'docs', 'archive', path.basename(rel)));
}

test('the reported position follows this tree\'s own plan docs, whatever a sibling checkout holds', () => {
    const w = makeWorktree();
    try {
        writeQueuePlans(w.main);
        writeQueuePlans(w.tree);
        assert.strictEqual(armGoal(w.tree, [QUEUE_A, QUEUE_B]).ok, true,
            'setup: the queue arms in the worktree');

        // Nothing is finished anywhere yet, so the position sits on the first
        // entry: the control that keeps the move below from passing for the
        // wrong reason.
        let res = runGoalCli(['status'], w.tree);
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /queue: plan 1 of 2/, 'setup: the walk starts at the first plan: ' + res.stdout);

        // The main checkout files its copy of the first plan while this tree
        // still holds a live one. That is a sibling execution stream's move,
        // and this tree's reported position must not follow it.
        archiveIn(w.main, QUEUE_A);
        res = runGoalCli(['status'], w.tree);
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /queue: plan 1 of 2/,
            'a sibling checkout\'s archive moves nothing here: ' + res.stdout);
        assert.doesNotMatch(res.stdout, /queue: plan 2 of 2/);

        // This tree closes the entry out and files it, and the position moves
        // on that reading alone.
        archiveIn(w.tree, QUEUE_A);
        res = runGoalCli(['status'], w.tree);
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /queue: plan 2 of 2/,
            'this tree\'s own archive moves the position: ' + res.stdout);
        assert.match(res.stdout, /the stored position still says plan 1/);
    } finally {
        rmWorktree(w);
    }
});
