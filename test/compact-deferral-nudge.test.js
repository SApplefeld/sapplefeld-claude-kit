// Tests for plugins/claude-kit/hooks/compact-deferral-nudge.js (the
// PostToolUse deferral nudge).
//
// Node's built-in test runner, no framework (Node v24). The hook is spawned as
// a real child process, fed a PostToolUse payload on stdin, and asserted on by
// its EXIT CODE (always 0; the hook never exits 2) and its EXACT stdout: the
// fire path must emit exactly the nested hookSpecificOutput JSON form (a
// top-level additionalContext key is inert on this harness and is pinned
// absent below), and every silent path must emit the empty string, because a
// weaker "no reminder substring" check would pass on a crashed hook.
//
// Each case builds a fresh temp repo with its own .kit/goal-state.json via
// armGoal/bindSession and its own .kit/compact-gate.json holding a staged
// deferral episode, so no case touches the real repo's live state. The baseline
// fixture is the full FIRE state, aged so that only the guard a case negates
// can decide its outcome: the episode's lastDeniedAt sits seconds ago (well
// inside the four-hour idle bound), its since sits 45 minutes ago, nudgedAt is
// absent, and no checkpoint file exists. A silent case that staged the wrong
// ages would pass on a guard other than the one it names, which is
// indistinguishable from passing for the right reason.
//
// KIT_EXTERNAL_ENGINE is scrubbed from every child environment by default (this
// suite runs inside fleet workers too, where the marker is ambient and would
// flip every fire case into a silent stand-down); the one case that exercises
// the marker opts back in explicitly. All temp state is cleaned up in finally
// blocks.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOK = path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'compact-deferral-nudge.js');
const {
    armGoal, bindSession, goalPath, GOAL_STATE_MAX_BYTES
} = require('../plugins/claude-kit/hooks/kit-goal-lib.js');
const {
    buildReminder, buildHoldReminder, nudgeFloor,
    NUDGE_INTERVAL_MS, NUDGE_FLOOR_DEFAULT, namesNetworkShare
} = require('../plugins/claude-kit/hooks/compact-deferral-nudge.js');

// The session id the fixtures bind the goal to; payloads default to it so the
// full fire state is the baseline and each silent case negates exactly one
// guard.
const SESSION = 'ses-11112222-aaaa-bbbb-cccc-333344445555';
const OTHER_SESSION = 'ses-99998888-ffff-eeee-dddd-777766665555';
const PLAN_REL = 'docs/plans/x_spec_v1.md';

// The staged episode's figures, which the fire cases read back out of the
// emitted reminder.
const DENIALS = 7;
const EPISODE_MINUTES = 45;

// Every spawned hook runs against a fixture home, pinned inside runHook rather
// than at the call sites so it is structural. The hold path reads the
// machine-local signpost (~/.claude/claude-kit.local.json) for its floor, and an
// unpinned spawn would read this machine's own settings file, which would make
// the floor cases depend on live state and would read a real operator's file to
// decide a test. The directory starts empty, which is the absent-signpost
// reading and therefore the default floor.
const FIXTURE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-deferral-nudge-home-'));
process.on('exit', () => {
    try { fs.rmSync(FIXTURE_HOME, { recursive: true, force: true }); } catch { /* best effort */ }
});

const SIGNPOST = path.join(FIXTURE_HOME, '.claude', 'claude-kit.local.json');

// Write, or with undefined remove, the machine-local signpost in the fixture
// home. Raw text rather than an object, so the unparseable readings can be
// staged as themselves.
function writeSignpost(text) {
    fs.mkdirSync(path.dirname(SIGNPOST), { recursive: true });
    if (text === undefined) {
        try { fs.rmSync(SIGNPOST, { force: true }); } catch { /* best effort */ }
        return;
    }
    fs.writeFileSync(SIGNPOST, text, 'utf8');
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

function iso(msAgo) {
    return new Date(Date.now() - msAgo).toISOString();
}

// Drop the external-engine marker from a child's environment, matched
// case-insensitively (Windows environment blocks preserve arbitrary key
// casing). Without this scrub, running the suite under a fleet worker would
// turn every fire case into a stand-down silence.
function scrubEngineEnv(env) {
    for (const k of Object.keys(env)) {
        if (/^KIT_EXTERNAL_ENGINE$/i.test(k)) delete env[k];
    }
    return env;
}

// childCwd sets the spawned hook's own working directory, which matters for
// exactly one case: the hook must read the project the PAYLOAD names and never
// fall back to wherever it happens to be running.
function runHook(payload, extraEnv, childCwd) {
    const env = {
        ...scrubEngineEnv({ ...process.env }),
        HOME: FIXTURE_HOME,
        USERPROFILE: FIXTURE_HOME,
        ...(extraEnv || {})
    };
    return spawnSync(process.execPath, [HOOK], {
        input: typeof payload === 'string' ? payload : JSON.stringify(payload),
        env,
        cwd: childCwd || process.cwd(),
        encoding: 'utf8'
    });
}

function gateStateFile(repo) {
    return path.join(repo, '.kit', 'compact-gate.json');
}

function checkpointFile(repo) {
    return path.join(repo, '.kit', 'compact-checkpoint.json');
}

function readGateStateFile(repo) {
    return JSON.parse(fs.readFileSync(gateStateFile(repo), 'utf8'));
}

// The gate state file's bytes, or null when it is absent.
function stateBytes(repo) {
    try { return fs.readFileSync(gateStateFile(repo), 'utf8'); } catch { return null; }
}

// A silent run wrote nothing. This is a separate assertion from silence and
// neither implies the other: nudgedAt is the interval's only cross-process
// carrier, so a stamp landing on a path that then stays quiet consumes a fresh
// 30 minutes on every covered tool return and the nudge never speaks again for
// that episode, with an empty stdout at every step.
function assertNoStateWrite(repo, before, label) {
    assert.strictEqual(stateBytes(repo), before, label + ': the state file must be byte-identical');
}

function gateLogFile(repo) {
    return path.join(repo, '.kit', 'compact-gate.jsonl');
}

// Every whole line of the gate journal, parsed. Absent file reads as no lines.
function readGateLog(repo) {
    let raw;
    try { raw = fs.readFileSync(gateLogFile(repo), 'utf8'); } catch { return []; }
    return raw.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
}

// An open deferral episode: denied seconds ago (far inside the four-hour idle
// bound), opened 45 minutes ago, never nudged. Overrides negate one field.
function openEpisode(overrides) {
    return {
        session: SESSION,
        since: iso(EPISODE_MINUTES * 60 * 1000 + 5000),
        denials: DENIALS,
        lastDeniedAt: iso(20 * 1000),
        nudgedAt: null,
        ...overrides
    };
}

// The boundary deny the fire baseline's state carries as its last decision,
// which is the decision class a leashed run's hold is made of.
function boundaryDecision() {
    return {
        at: iso(20 * 1000),
        verdict: 'deny-boundary',
        reason: 'no-checkpoint',
        consumed: 300000,
        checkpoint: null,
        session: SESSION
    };
}

// Write the gate state file directly, which is the shape recordGateDecision
// leaves behind: a last decision, an episode, and a last allow. The decision
// defaults to the boundary deny above; the hold cases pass an interactive one,
// which is the record the hold path reads and the one class that opens no
// episode.
function writeGateState(repo, episode, decision) {
    const record = decision === undefined ? boundaryDecision() : decision;
    writeFile(gateStateFile(repo), JSON.stringify({
        lastDecision: record,
        episode,
        lastAllow: null,
        // A hold lives in the per-session list rather than in the shared
        // decision slot, so an interactive deny is staged in both, exactly as
        // the gate's own writer leaves it.
        interactiveHolds: (record && record.verdict === 'deny-interactive' && record.session)
            ? [record]
            : []
    }, null, 2) + '\n');
}

// A fresh temp repo with the plan armed, bound to SESSION, and a deferral
// episode open: the full fire state.
function makeRepo(opts) {
    const o = opts || {};
    const repo = makeDir('compact-deferral-nudge-repo-');
    writeFile(path.join(repo, PLAN_REL), 'Status: In Progress\n\nbody\n');
    const armed = armGoal(repo, PLAN_REL);
    assert.strictEqual(armed.ok, true, 'test setup: goal should arm');
    if (!o.unbound) {
        // Guard 5 asks one question, whether this payload's session is the
        // bound one, so the binding is all the fixture stages.
        const bound = bindSession(repo, o.session || SESSION);
        assert.strictEqual(bound.ok, true, 'test setup: goal should bind');
    }
    if (!o.noEpisode) writeGateState(repo, openEpisode(o.episode));
    return repo;
}

// The baseline fire payload: a main-thread Bash result in the armed project,
// from the bound session. Each case overrides exactly what it negates.
function firePayload(repo, overrides) {
    return {
        session_id: SESSION,
        cwd: repo,
        tool_name: 'Bash',
        tool_input: { command: 'node --test test/x.test.js' },
        ...overrides
    };
}

function assertSilent(res, label) {
    assert.strictEqual(res.status, 0, label + ': exit code must be 0');
    assert.strictEqual(res.stdout, '', label + ': stdout must be empty');
    assert.strictEqual(res.stderr, '', label + ': stderr must be empty');
}

function assertFires(res, label) {
    assert.strictEqual(res.status, 0, label + ': exit code must be 0');
    assert.strictEqual(res.stderr, '', label + ': stderr must be empty');
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(res.stdout); }, label + ': stdout must be valid JSON');
    assert.deepStrictEqual(Object.keys(parsed), ['hookSpecificOutput'],
        label + ': the top level must carry hookSpecificOutput and nothing else');
    assert.deepStrictEqual(Object.keys(parsed.hookSpecificOutput).sort(),
        ['additionalContext', 'hookEventName'],
        label + ': hookSpecificOutput must carry exactly the event name and the context');
    assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'PostToolUse', label + ': the event name');
    return parsed.hookSpecificOutput.additionalContext;
}

test('fires on a covered tool return while an episode is open', () => {
    const repo = makeRepo();
    try {
        const context = assertFires(runHook(firePayload(repo)), 'open episode');
        // The phrase and the tool, not the whole reminder: the command clause
        // renders out of this checkout's own installed path, and a checkout
        // under a path outside SAFE_CLI_PATH (a hash, an ampersand, a comma,
        // any non-ASCII) legitimately drops that clause. Asserting it here
        // would red this case for a reason other than the one it names. The
        // clause is pinned both directions, against fixed paths, by the
        // grammar case below.
        assert.ok(context.includes('held 7 offers over 45 minutes'),
            'the emitted context must carry the phrase built from the staged episode:\n' + context);
        assert.ok(context.includes('kit-compact-checkpoint.js'),
            'the emitted context must name the tool that opens the boundary:\n' + context);
        assert.ok(context.startsWith('compact-deferral-nudge: the compaction gate has '),
            'the emitted context must be this hook\'s reminder:\n' + context);
    } finally {
        rmDir(repo);
    }
});

test('fires on every covered tool name', () => {
    const repo = makeRepo();
    try {
        for (const tool of ['Agent', 'TaskOutput', 'Bash', 'PowerShell']) {
            // Each fire stamps the episode, so the interval is reset between
            // tools; otherwise every tool after the first would read as silent
            // for the wrong reason.
            writeGateState(repo, openEpisode());
            assertFires(runHook(firePayload(repo, { tool_name: tool })), 'tool ' + tool);
        }
    } finally {
        rmDir(repo);
    }
});

test('the emitted context carries the two integers out of state and no other state value', () => {
    const repo = makeRepo();
    try {
        const context = assertFires(runHook(firePayload(repo)), 'two integers');
        assert.ok(context.includes('held ' + DENIALS + ' offers over ' + EPISODE_MINUTES + ' minutes'),
            'the reminder must carry the count of held offers and the episode age:\n' + context);
        assert.ok(!context.includes(SESSION), 'no session id may reach the reminder');
        assert.ok(!context.includes(repo), 'no project path may reach the reminder');
        assert.ok(!context.includes('compact-gate.json'), 'no state path may reach the reminder');
        assert.ok(!context.includes('deny-boundary'), 'no recorded verdict may reach the reminder');
    } finally {
        rmDir(repo);
    }
});

test('no top-level additionalContext key is ever present in the emitted object', () => {
    // The top-level key is inert on this harness: the harness parses the
    // payload and discards it, so its presence would read as working while
    // reaching nothing. This is the pin against a "compatibility" regression.
    const repo = makeRepo();
    try {
        const parsed = JSON.parse(runHook(firePayload(repo)).stdout);
        assert.strictEqual('additionalContext' in parsed, false,
            'a top-level additionalContext key must never be emitted');
    } finally {
        rmDir(repo);
    }
});

test('the reminder carries its pinned fragments', () => {
    // Hardcoded literals, deliberately not read from the hook, so a silent
    // reword of the reminder fails the suite and becomes a double-edit.
    const repo = makeRepo();
    try {
        const context = assertFires(runHook(firePayload(repo)), 'pinned fragments');
        assert.ok(context.startsWith('compact-deferral-nudge:'), 'the reminder must name the hook that spoke');
        assert.ok(context.includes('the compaction gate has held'), 'the reminder must state the hold');
        assert.ok(context.includes('not an error'),
            'the reminder must say the deferral is the mechanism rather than a fault');
        assert.ok(context.includes('interim board entry or the Chapter'),
            'the reminder must name both boundary shapes');
        assert.ok(context.includes('commit model'), 'the reminder must order the commit model before the open');
        // The tool, not the rendered command: the runnable clause is composed
        // from this checkout's own __dirname and is legitimately dropped when
        // that path falls outside SAFE_CLI_PATH, which would red this case for
        // a reason other than the one it names. The clause is pinned both
        // directions, against fixed paths, by the grammar case below.
        assert.ok(context.includes('kit-compact-checkpoint.js'),
            'the reminder must name the checkpoint command:\n' + context);
        assert.ok(context.includes('Never clear the goal or the checkpoint'),
            'the reminder must forbid clearing the goal or the checkpoint to get past a deferral');
        assert.ok(context.includes('executing-work'),
            'the reminder must route a session whose skill body was dropped back to executing-work');
        assert.ok(context.includes('mid-step'), 'the reminder must say what to do mid-step');
    } finally {
        rmDir(repo);
    }
});

test('silent when no deferral episode is open', () => {
    // Guard 6, staged two ways: no state file at all, and a state file whose
    // episode is null. Everything else is the fire baseline.
    const repo = makeRepo({ noEpisode: true });
    try {
        assertSilent(runHook(firePayload(repo)), 'no gate state file');
        assert.strictEqual(stateBytes(repo), null, 'a hook that says nothing creates no state file');
        writeGateState(repo, null);
        const before = stateBytes(repo);
        assertSilent(runHook(firePayload(repo)), 'state file with no episode');
        assertNoStateWrite(repo, before, 'no episode to stamp');
    } finally {
        rmDir(repo);
    }
});

test('silent when the open episode belongs to another session', () => {
    // Guard 6 asks its question for THIS binding (checkpointOwner's answer),
    // not for any open episode: a bystander session's hold must never fire this
    // run's nudge. The episode is otherwise fully open and in date.
    const repo = makeRepo({ episode: { session: OTHER_SESSION } });
    try {
        const before = stateBytes(repo);
        assertSilent(runHook(firePayload(repo)), 'episode owned elsewhere');
        assertNoStateWrite(repo, before, 'a bystander hold is not this run\'s to stamp');
    } finally {
        rmDir(repo);
    }
});

test('silent when a matching checkpoint is already open', () => {
    // Guard 7. The boundary is already declared, so the next turn lands the
    // compaction there and the directive would be false. The checkpoint is
    // written by the library's own writer, so it carries a real openedAt of
    // now and matches on the ten-minute leg with no corroboration needed; the
    // episode behind it stays fully open, so only guard 7 can decide here.
    const repo = makeRepo();
    try {
        const { writeCheckpoint } = require('../plugins/claude-kit/hooks/kit-compact-lib.js');
        const written = writeCheckpoint(repo, PLAN_REL, SESSION, false, SESSION);
        assert.strictEqual(written.ok, true, 'test setup: the checkpoint should write');
        const before = stateBytes(repo);
        assertSilent(runHook(firePayload(repo)), 'matching checkpoint open');
        assertNoStateWrite(repo, before, 'a boundary already declared consumes no interval');
    } finally {
        rmDir(repo);
    }
});

test('fires when the checkpoint on disk no longer matches', () => {
    // The control for guard 7: a checkpoint file exists but is expired (30
    // minutes old, no pending-offer flag, so the ten-minute leg applies), so
    // the boundary it declared is no longer honored and the hold is real. A
    // guard that stood down on the mere presence of a file would go silent
    // here, which is the exact case the operator most needs the nudge for.
    //
    // The opener is the bound session, so the record reaches the age leg this
    // case is named for: the match rule refuses a record with no opener before it
    // looks at the age at all, which would fire the nudge for the wrong reason.
    const repo = makeRepo();
    try {
        writeFile(checkpointFile(repo), JSON.stringify({
            plan: PLAN_REL,
            boundSession: SESSION,
            openedBy: SESSION,
            openedAt: iso(30 * 60 * 1000),
            pendingOffer: false
        }, null, 2) + '\n');
        assertFires(runHook(firePayload(repo)), 'expired checkpoint');
    } finally {
        rmDir(repo);
    }
});

test('silent when the payload carries agent_id, even with the correct bound session id', () => {
    // Guard 3, on the real-world subagent shape: its payload carries the PARENT
    // session's own session_id, so guard 5 passes and only the agent keys stand
    // it down. A mismatched session id here would pass for the wrong reason and
    // leave guard 3 unproven. This hook fires on Bash, which every dispatched
    // agent runs constantly, so the guard carries far more traffic here than in
    // the chapter-boundary sibling.
    //
    // The agent_id here is SYNTHETIC, standing in for the real identifier a
    // harvested payload of this shape carries: the privacy gate redacts a real
    // agent id from a fixture at the freezing step, and asks for the
    // substitution to be stated in the case's own note. The sweep behind that
    // statement ran on three predicates, the literal value, the structural
    // pattern `agent_id: [0-9a-f]{16,}`, and a bare 17-hex-token shape, over
    // tracked files, with a positive control on a synthetic 17-hex value
    // withheld from the literal list and matched on shape, which spoke.
    const repo = makeRepo();
    try {
        assertSilent(runHook(firePayload(repo, { agent_id: 'agent-11112222aaaabbbb' })),
            'subagent payload (agent_id, parent session id)');
    } finally {
        rmDir(repo);
    }
});

test('silent when the payload carries any agent-type spelling alone', () => {
    // The four spellings the sibling subagent detectors defend
    // (readonly-agent-guard.js, docs-write-guard.js): the repo's evidence that
    // the key name varies across harness versions, and guard 3 is the only
    // stand-down a subagent gets, so every spelling must stand it down.
    const repo = makeRepo();
    try {
        for (const key of ['agent_type', 'agentType', 'subagent_type', 'subagentType']) {
            assertSilent(runHook(firePayload(repo, { [key]: 'general-purpose' })),
                'subagent payload (' + key + ')');
        }
    } finally {
        rmDir(repo);
    }
});

test('silent when the goal is bound to another session', () => {
    // Guard 5, which reads the binding before the episode is read at all, so
    // it is what decides here under either staging. The episode is staged for
    // the session the goal is bound to (the only session that can produce a
    // boundary deny) so that guard 6 is not a second reason for the same
    // silence: with the episode staged for the payload's session instead, this
    // case would still pass with guard 5 deleted.
    // Guard 5 forks rather than stands down, so the silence is now the hold
    // path's, and it is the hold LIST that produces it rather than any test on a
    // record: this fixture's only decision is a boundary deny, which the gate
    // never records as a hold, so the list guard 5H reads is empty and there is
    // no hold to act on. What guard 5 still decides is that the episode path is
    // not taken, and it is still what this case discriminates: with the leash
    // test deleted, the episode staged for the goal's binding is open for that
    // same owner and the hook fires.
    const repo = makeRepo({ session: OTHER_SESSION, episode: { session: OTHER_SESSION } });
    try {
        assertSilent(runHook(firePayload(repo)), 'goal bound elsewhere');
    } finally {
        rmDir(repo);
    }
});

test('a camelCase sessionId payload is read the same as session_id', () => {
    // The gate and the goal-leash Stop hook both accept either spelling, so a
    // harness emitting camelCase would keep opening episodes this hook could
    // never speak about. Guard 5 reads both for that reason.
    const repo = makeRepo();
    try {
        const payload = firePayload(repo);
        delete payload.session_id;
        payload.sessionId = SESSION;
        assertFires(runHook(payload), 'camelCase session id');
    } finally {
        rmDir(repo);
    }
});

test('no EPISODE reminder for an unbound or unarmed goal', () => {
    // What this pins is the episode path's own silence, and the name says so
    // rather than claiming the unarmed case as coverage: in production an
    // unarmed project at or above the floor now FIRES the hold directive, and
    // these two cases stay silent only because neither fixture stages a hold
    // record at all. Each one's single decision is a boundary deny, which the
    // gate never records in the per-session hold list, so guard 5H finds that
    // list empty and the hold path has nothing to speak about. The hold path's
    // own cases are staged with an interactive deny, further down.
    const unbound = makeRepo({ unbound: true });
    try {
        assertSilent(runHook(firePayload(unbound)), 'unbound goal');
    } finally {
        rmDir(unbound);
    }
    const bare = makeDir('compact-deferral-nudge-repo-');
    try {
        writeGateState(bare, openEpisode());
        assertSilent(runHook(firePayload(bare)), 'no armed goal');
    } finally {
        rmDir(bare);
    }
});

// Synthetic session ids of the harness's own shape, which is what an arming
// identity recorded in the state is held to. SESSION above is deliberately of
// another shape, so no case can claim on that route by accident.
const ARM_SESSION = '3b9c1d20-7a41-4e6d-8f25-11c0de4a7b90';
const ARM_BYSTANDER = '5d2e88a4-0c13-4f77-9ab6-62f0aa31c5de';

// A repo whose goal is unbound and records the given id as the session that
// armed it, with a deferral episode open under the given owner: the state a run
// that armed a plan for itself sits in while the gate holds its offers and no
// claim point has been reached yet.
function selfArmedRepo(armingId, episodeOwner) {
    const repo = makeDir('compact-deferral-nudge-repo-');
    writeFile(path.join(repo, PLAN_REL), 'Status: In Progress\n\nbody\n');
    const armed = armGoal(repo, PLAN_REL, { sessionId: armingId, transcriptPath: null });
    assert.strictEqual(armed.ok, true, 'test setup: goal should arm');
    assert.strictEqual(armed.boundSession, null, 'test setup: the goal should arm unbound');
    writeGateState(repo, openEpisode({ session: episodeOwner }));
    return repo;
}

test('fires for the session an unbound goal records as the one that armed it', () => {
    // A run holding a claimable leash is spoken to about the hold it is under:
    // the goal reads unbound, and the denials holding this run are recorded
    // under the session id the state records as having armed it. The fixture
    // stages that pairing directly, which the hook's own header states the two
    // routes to (a claim whose bind write failed, and a re-arm landing unbound
    // beside a standing episode).
    const repo = selfArmedRepo(ARM_SESSION, ARM_SESSION);
    try {
        const context = assertFires(runHook(firePayload(repo, { session_id: ARM_SESSION })), 'arming session');
        assert.ok(context.includes('held 7 offers over 45 minutes'),
            'the emitted context must carry the phrase built from the staged episode:\n' + context);
    } finally {
        rmDir(repo);
    }
});

test('silent when the boundary this run banked before its claim is already open', () => {
    // The directive tells a run to bank a boundary and open a checkpoint. A run
    // holding a claimable leash has one open already: it carries no owner
    // because none was held when it opened, and the claim the next offer
    // carries adopts it and lands there. Emitting the directive against that
    // state asks for work that is done.
    const repo = selfArmedRepo(ARM_SESSION, ARM_SESSION);
    try {
        const { writeCheckpoint } = require('../plugins/claude-kit/hooks/kit-compact-lib.js');
        const written = writeCheckpoint(repo, PLAN_REL, null, false, ARM_SESSION);
        assert.strictEqual(written.ok, true, 'test setup: checkpoint should write');
        assertSilent(runHook(firePayload(repo, { session_id: ARM_SESSION })), 'boundary already banked');
    } finally {
        rmDir(repo);
    }
});

test('fires when the checkpoint banked in that window names another plan', () => {
    // The control for the case above: only this run's own boundary stands the
    // directive down, and a leftover from a prior plan is not it.
    const repo = selfArmedRepo(ARM_SESSION, ARM_SESSION);
    try {
        const { writeCheckpoint } = require('../plugins/claude-kit/hooks/kit-compact-lib.js');
        const written = writeCheckpoint(repo, 'docs/plans/some-prior-run.md', null, false, ARM_SESSION);
        assert.strictEqual(written.ok, true, 'test setup: checkpoint should write');
        assertFires(runHook(firePayload(repo, { session_id: ARM_SESSION })), 'another plan\'s checkpoint');
    } finally {
        rmDir(repo);
    }
});

test('silent for a session that is neither bound nor the recorded arming session', () => {
    // Guard 5 forks such a session to the hold path, where guard 5H refuses the
    // boundary deny this fixture's state carries. The hold cases below stage the
    // interactive deny that is the other half of that question.
    const repo = selfArmedRepo(ARM_SESSION, ARM_BYSTANDER);
    try {
        assertSilent(runHook(firePayload(repo, { session_id: ARM_BYSTANDER })), 'bystander session');
    } finally {
        rmDir(repo);
    }
});

test('silent for the arming session while the open episode belongs to another session', () => {
    // The episode question stays scoped to one id: holding a claimable leash
    // says nothing about whose offers are being held, and a hold belonging to
    // some other session is not this run's to be nudged about.
    const repo = selfArmedRepo(ARM_SESSION, ARM_BYSTANDER);
    try {
        assertSilent(runHook(firePayload(repo, { session_id: ARM_SESSION })), 'another session\'s hold');
    } finally {
        rmDir(repo);
    }
});

test('silent under KIT_EXTERNAL_ENGINE=1', () => {
    const repo = makeRepo();
    try {
        assertSilent(runHook(firePayload(repo), { KIT_EXTERNAL_ENGINE: '1' }), 'external engine marker');
    } finally {
        rmDir(repo);
    }
});

test('silent for a tool name this hook does not cover', () => {
    const repo = makeRepo();
    try {
        for (const tool of ['Read', 'Edit', 'Write', 'MultiEdit', '', undefined]) {
            assertSilent(runHook(firePayload(repo, { tool_name: tool })), 'uncovered tool ' + String(tool));
        }
    } finally {
        rmDir(repo);
    }
});

test('silent when cwd is missing or not a usable string', () => {
    // Guard 4. This hook reads only the project the payload names, because a
    // shell command's working directory is not this process's. The child is
    // spawned IN the armed repo, so a fallback to its own working directory
    // would fire: the silence has to come from the refusal rather than from
    // there being nothing to find.
    const repo = makeRepo();
    try {
        assertSilent(runHook(firePayload(repo, { cwd: undefined }), null, repo), 'missing cwd');
        assertSilent(runHook(firePayload(repo, { cwd: '' }), null, repo), 'empty cwd');
        assertSilent(runHook(firePayload(repo, { cwd: 42 }), null, repo), 'non-string cwd');
    } finally {
        rmDir(repo);
    }
});

test('the share predicate refuses both network forms and nothing else', () => {
    // The end-to-end case below can only prove the refusal where an SMB stack
    // exists: on a POSIX runner '//host/share' is an ordinary missing path and
    // the silence comes from an absent goal file instead. So the predicate the
    // guard calls is pinned directly here, on every runner, in both directions.
    assert.strictEqual(namesNetworkShare('//10.255.255.1/share'), true, 'the //server form');
    assert.strictEqual(namesNetworkShare('\\\\10.255.255.1\\share'), true, 'the UNC form');
    assert.strictEqual(namesNetworkShare('\\/host/share'), true, 'a mixed doubled separator');
    assert.strictEqual(namesNetworkShare('/home/user/repo'), false, 'a POSIX absolute path');
    assert.strictEqual(namesNetworkShare('D:/repo'), false, 'a Windows drive path');
    assert.strictEqual(namesNetworkShare('D:\\repo'), false, 'a Windows backslash path');
    assert.strictEqual(namesNetworkShare('repo/sub'), false, 'a relative path');
});

test('the share predicate fails closed on a non-string, refusing rather than answering clean', () => {
    // A non-string cwd names no path at all, so there is no text to run the
    // leading-separator check against; the predicate answers true for it
    // rather than false, because a caller that cannot walk this
    // value safely either is the one this predicate exists to protect, and
    // answering false here would tell that caller cwd was fine to open when
    // the truth is there was no cwd to judge. Line 486 above already proves
    // this end to end (a 42 payload cwd produces the hook's own silence); this
    // pins the predicate's own return value directly, for every shape a
    // caller could pass that is not a string.
    assert.strictEqual(namesNetworkShare(null), true, 'null');
    assert.strictEqual(namesNetworkShare(undefined), true, 'undefined');
    assert.strictEqual(namesNetworkShare(42), true, 'a number');
});

test('a cwd naming a network share stands down without touching it', () => {
    // An unreachable UNC share blocks a filesystem open for the SMB timeout,
    // and this hook runs after every shell command, so the goal read must never
    // reach one. On Windows the spawn timeout is the discriminator: without the
    // refusal the hook hangs on the share until killed, which fails the
    // exit-code and silence assertions. Elsewhere this case only pins the
    // outcome, and the predicate test above is the control.
    const res = spawnSync(process.execPath, [HOOK], {
        input: JSON.stringify(firePayload('//10.255.255.1/share')),
        env: scrubEngineEnv({ ...process.env }),
        encoding: 'utf8',
        timeout: 8000
    });
    assertSilent(res, 'UNC cwd');
});

test('exit 0 and silent on a malformed payload and on empty stdin', () => {
    assertSilent(runHook('this is not json {'), 'malformed payload');
    assertSilent(runHook(''), 'empty stdin');
});

test('the fire stamps nudgedAt into the state file and preserves every other field', () => {
    const repo = makeRepo();
    try {
        const before = readGateStateFile(repo);
        assertFires(runHook(firePayload(repo)), 'stamping fire');
        const after = readGateStateFile(repo);
        const stamped = Date.parse(after.episode.nudgedAt);
        assert.ok(Number.isFinite(stamped), 'nudgedAt must be written as a parseable timestamp');
        assert.ok(Math.abs(Date.now() - stamped) < 60 * 1000, 'nudgedAt must be stamped at the fire');
        assert.strictEqual(after.episode.since, before.episode.since,
            'since is preserved: it is what the reported age is measured from');
        assert.strictEqual(after.episode.denials, before.episode.denials, 'the denial count is preserved');
        assert.strictEqual(after.episode.lastDeniedAt, before.episode.lastDeniedAt,
            'lastDeniedAt is preserved: it is what the idle bound is measured from');
        assert.strictEqual(after.episode.session, before.episode.session, 'the owning session is preserved');
        assert.deepStrictEqual(after.lastDecision, before.lastDecision, 'the last decision is preserved');
        assert.deepStrictEqual(after.lastAllow, before.lastAllow, 'the last allow is preserved');
    } finally {
        rmDir(repo);
    }
});

test('a second call inside the interval is silent, and one past it fires', () => {
    const repo = makeRepo();
    try {
        assertFires(runHook(firePayload(repo)), 'first call');
        const before = stateBytes(repo);
        assertSilent(runHook(firePayload(repo)), 'second call inside the interval');
        assertNoStateWrite(repo, before, 'a call the interval refuses re-stamps nothing');

        // Age the stamp past the interval, leaving every other field alone, so
        // only guard 8 can decide the outcome.
        const state = readGateStateFile(repo);
        state.episode.nudgedAt = iso(NUDGE_INTERVAL_MS + 60 * 1000);
        writeFile(gateStateFile(repo), JSON.stringify(state, null, 2) + '\n');
        assertFires(runHook(firePayload(repo)), 'call past the interval');
    } finally {
        rmDir(repo);
    }
});

test('an unstamped, unparseable, or future-dated nudgedAt fires', () => {
    // The illegible readings all fire, which is the fail-open direction and is
    // self-healing: the stamp this fire writes replaces the illegible value.
    for (const nudgedAt of [null, 'not a date', iso(-60 * 60 * 1000)]) {
        const repo = makeRepo({ episode: { nudgedAt } });
        try {
            assertFires(runHook(firePayload(repo)), 'nudgedAt ' + String(nudgedAt));
        } finally {
            rmDir(repo);
        }
    }
});

test('silent when the episode has gone idle past the gate bound', () => {
    // gateEpisodeOpen retires an episode whose newest denial has aged past four
    // hours, and guard 6 takes that answer rather than re-deriving openness.
    // Both timestamps age together, so the fixture is a state the gate could
    // actually have written: an episode denied before it opened would exercise
    // the same bound while staging something no writer produces.
    const repo = makeRepo({
        episode: {
            since: iso(5 * 60 * 60 * 1000 + 5 * 60 * 1000),
            lastDeniedAt: iso(5 * 60 * 60 * 1000)
        }
    });
    try {
        assertSilent(runHook(firePayload(repo)), 'idle episode');
    } finally {
        rmDir(repo);
    }
});

// Make a kit library require fail inside the spawned hook: a preload module
// refuses to load that one module, standing in for the damaged or incomplete
// plugin cache the hook's deferred requires exist for. Node parses NODE_OPTIONS
// with backslash as an escape character, so the preload path is passed
// forward-slashed; a backslashed path fails to resolve and the child dies
// before the hook runs.
function requireRefusingPreload(dir, moduleFile) {
    const shim = path.join(dir, 'refuse-require-' + moduleFile);
    fs.writeFileSync(shim, [
        "'use strict';",
        "const Module = require('module');",
        'const realLoad = Module._load;',
        'Module._load = function (request) {',
        "    if (String(request).endsWith('" + moduleFile + "')) {",
        "        throw new Error('the fixture refuses this require');",
        '    }',
        '    return realLoad.apply(Module, arguments);',
        '};'
    ].join('\n') + '\n', 'utf8');
    return '--require "' + shim.replace(/\\/g, '/') + '"';
}

test('a kit library that will not load leaves the hook silent rather than throwing', () => {
    // The requires are deferred into the guard that uses them precisely so a
    // damaged installed cache degrades to the pre-hook status quo. A throw here
    // would end a hook that runs after every shell command non-zero.
    const repo = makeRepo();
    try {
        for (const lib of ['kit-compact-lib.js', 'kit-goal-lib.js']) {
            assertSilent(runHook(firePayload(repo), {
                NODE_OPTIONS: requireRefusingPreload(repo, lib)
            }), 'damaged ' + lib);
        }
    } finally {
        rmDir(repo);
    }
});

test('a require failure for kit-network-lib.js refuses the call rather than answering clean', () => {
    // Guard 4's require failure answers true (refuse), not false: false is
    // the checked-and-clean value, and a damaged cache that cannot even
    // supply this small module is not evidence the working directory is
    // safe to open. The discriminator is this repo's fixture, the full FIRE
    // state (every later guard passes on its own): the fail-open direction
    // this guards against would let guard 4 pass through and the hook would
    // FIRE here; the fail-closed fix keeps it silent, exactly like the two
    // libraries above whose own failure silences the hook for a different
    // reason (the feature cannot run at all without them).
    const repo = makeRepo();
    try {
        assertSilent(runHook(firePayload(repo), {
            NODE_OPTIONS: requireRefusingPreload(repo, 'kit-network-lib.js')
        }), 'damaged kit-network-lib.js');
    } finally {
        rmDir(repo);
    }
});

test('silent when a CORROBORATED pending checkpoint is open', () => {
    // Guard 7's fourth argument, which is the section's primary scenario rather
    // than an edge: a boundary declared while the gate was already holding
    // offers, then a long tool call. The record claims pendingOffer, the
    // episode that vouches for it predates it (since 45 minutes ago, openedAt
    // 20 minutes ago), and the corroborated long bound is what keeps it
    // matching. Drop the fourth argument from the checkpointMatches call and
    // the ten-minute leg expires this record, so the hook fires and tells the
    // model to re-declare a boundary it already declared.
    const repo = makeRepo();
    try {
        writeFile(checkpointFile(repo), JSON.stringify({
            plan: PLAN_REL,
            boundSession: SESSION,
            openedBy: SESSION,
            openedAt: iso(20 * 60 * 1000),
            pendingOffer: true
        }, null, 2) + '\n');
        assertSilent(runHook(firePayload(repo)), 'corroborated pending checkpoint');
    } finally {
        rmDir(repo);
    }
});

test('the corroboration argument is what decides that case, both directions', () => {
    // The library-level control for the case above, so it cannot pass by the
    // pendingOffer flag alone: the same 20-minute-old record matches with
    // corroboration and expires without it.
    const repo = makeRepo();
    try {
        writeFile(checkpointFile(repo), JSON.stringify({
            plan: PLAN_REL,
            boundSession: SESSION,
            openedBy: SESSION,
            openedAt: iso(20 * 60 * 1000),
            pendingOffer: true
        }, null, 2) + '\n');
        const lib = require('../plugins/claude-kit/hooks/kit-compact-lib.js');
        const { readGoal } = require('../plugins/claude-kit/hooks/kit-goal-lib.js');
        const now = Date.now();
        const cp = lib.readCheckpoint(repo);
        const goal = readGoal(repo);
        const state = lib.readGateState(repo);
        assert.strictEqual(lib.pendingOfferCorroborated(cp, state, now, SESSION), true,
            'the staged episode predates the record and vouches for it');
        assert.deepStrictEqual(lib.checkpointMatches(cp, goal, now, true), { ok: true, reason: null },
            'with corroboration the record still matches at 20 minutes');
        assert.deepStrictEqual(lib.checkpointMatches(cp, goal, now, undefined),
            { ok: false, reason: 'expired' },
            'without the fourth argument the ten-minute leg expires it, and the hook would fire');
    } finally {
        rmDir(repo);
    }
});

test('a falsy agent-identity key does not stand the hook down', () => {
    // Guard 3 reads truthiness, not key presence, matching the two sibling
    // detectors. A harness version that put a null or empty agent_id on a
    // MAIN-session payload would otherwise kill the feature outright on every
    // call, with every hand-built test payload still green.
    const repo = makeRepo();
    try {
        for (const value of [null, '', 0, false]) {
            writeGateState(repo, openEpisode());
            assertFires(runHook(firePayload(repo, { agent_id: value })),
                'falsy agent_id ' + JSON.stringify(value));
        }
    } finally {
        rmDir(repo);
    }
});

test('the payload transcript is not consulted at all', () => {
    // A payload naming a transcript other than the bound one still fires. The
    // two values come from different producers (the goal CLI composes its own
    // path; a claim-point bind stores the harness's verbatim value), so any
    // spelling difference between them would be a permanent total stand-down
    // with nothing in any status surface. Guard 3 is the subagent stand-down.
    const repo = makeRepo();
    try {
        assertFires(runHook(firePayload(repo, {
            transcript_path: 'C:/Users/x/.claude/projects/p/other.jsonl'
        })), 'a foreign transcript path is no opinion');
    } finally {
        rmDir(repo);
    }
});

test('a nudge that fires leaves exactly one record in the gate journal', () => {
    // The journal is what an operator reads to tell a nudge that never fired
    // from one that fired five times and was ignored. The record is
    // distinguishable from a decision by shape: it carries event where a
    // decision carries verdict.
    const repo = makeRepo();
    try {
        assertFires(runHook(firePayload(repo)), 'open episode');
        const lines = readGateLog(repo);
        assert.strictEqual(lines.length, 1, 'one fire, one line: ' + JSON.stringify(lines));
        assert.deepStrictEqual(Object.keys(lines[0]).sort(), ['at', 'event', 'session', 'tool'],
            'the record carries the time, the event, the session and the tool, and nothing else');
        assert.strictEqual(lines[0].event, 'nudge', 'the shape that separates it from a decision');
        assert.strictEqual(lines[0].session, SESSION, 'the session the hold belongs to');
        assert.strictEqual(lines[0].tool, 'Bash',
            'the triggering tool, which is what makes a run whose nudges are all Bash readable');
        assert.ok(Number.isFinite(Date.parse(lines[0].at)), 'the time must parse');

        assertSilent(runHook(firePayload(repo)), 'the interval engages');
        assert.strictEqual(readGateLog(repo).length, 1,
            'a nudge the interval refuses writes no line either');
    } finally {
        rmDir(repo);
    }
});

test('a nudge whose journal line cannot be written still nudges and still stamps', () => {
    // The journal line is appended after the stamp and outside the stamp's
    // preconditions, so the log's writability is not one of them. Borrowing the
    // recorder's full precondition set would turn a locked or read-only log
    // into a dead interval, and the nudge would then repeat after every covered
    // tool return for the life of the episode: a flood into a context already
    // past the compaction trigger. A directory at the log path is the staging,
    // because it fails the same regular-file leg a lock does.
    const repo = makeRepo();
    try {
        fs.mkdirSync(path.join(repo, '.kit', 'compact-gate.jsonl'));
        assertFires(runHook(firePayload(repo)), 'unwritable log');
        const after = readGateStateFile(repo);
        assert.ok(Number.isFinite(Date.parse(after.episode.nudgedAt)),
            'the stamp must still land when only the log is unusable');
        assertSilent(runHook(firePayload(repo)), 'the interval engages on the very next call');
    } finally {
        rmDir(repo);
    }
});

test('silent when the stamp cannot land', (t) => {
    // The rate limit is the emission's precondition: nudgedAt is the only
    // cross-process carrier guard 8 has, so a hook that emitted without it
    // would emit after every covered tool return with no limit at all. Silence
    // is the pre-hook status quo and is the direction to fail in.
    const repo = makeRepo();
    try {
        fs.chmodSync(gateStateFile(repo), 0o444);
        let writable = true;
        try { fs.accessSync(gateStateFile(repo), fs.constants.W_OK); } catch { writable = false; }
        if (writable) {
            // A principal that ignores the read-only bit: the case cannot be
            // staged here, and a green run would prove nothing.
            t.skip('cannot stage an unwritable state file as this user');
            return;
        }
        assertSilent(runHook(firePayload(repo)), 'unwritable state file');
        assert.strictEqual(readGateStateFile(repo).episode.nudgedAt, null,
            'nothing was written, which is why nothing was said');
    } finally {
        try { fs.chmodSync(gateStateFile(repo), 0o666); } catch { /* best effort */ }
        rmDir(repo);
    }
});

test('the runnable command clause is dropped when the installed path fails the grammar', () => {
    // The reminder lands in the model's context, and double quotes do not
    // neutralize $(...) or backticks, both legal in a POSIX directory name. The
    // repo gates a composed runnable command rather than resting on provenance
    // (the doctor's branch-rename remedy), so a path outside the grammar costs
    // the command clause and nothing else.
    const phrase = 'held 7 offers over 45 minutes';
    const safe = buildReminder(phrase, 'D:/kit/plugins/claude-kit/hooks/kit-compact-checkpoint.js');
    assert.ok(safe.includes('run node "D:/kit/plugins/claude-kit/hooks/kit-compact-checkpoint.js" open'),
        'a conventional install path still renders the runnable command');

    for (const hostile of [
        'D:/kit/$(calc)/hooks/kit-compact-checkpoint.js',
        'D:/kit/`calc`/hooks/kit-compact-checkpoint.js',
        'D:/kit/a";calc;"/hooks/kit-compact-checkpoint.js',
        'D:/kit/a\ncalc/hooks/kit-compact-checkpoint.js'
    ]) {
        const guarded = buildReminder(phrase, hostile);
        assert.ok(!guarded.includes('calc'), 'no part of a refused path may reach the context:\n' + guarded);
        assert.ok(!guarded.includes('run node "'), 'a refused path renders no runnable command');
        assert.ok(guarded.includes('kit-compact-checkpoint.js'),
            'the rest of the reminder still names the tool to run');
        assert.ok(guarded.includes('held 7 offers over 45 minutes'), 'the hold is still reported');
    }
});

// Source-inspection pin, on the pattern 'one frontmatter key regex, and every
// field call site goes through the shared reader' in test/memq.test.js
// already uses: a behavioral test only proves these callers currently agree,
// not that a later edit cannot reintroduce a second spelling. The canonical
// definition lives in hooks/kit-network-lib.js, a module of a few lines
// holding namesNetworkShare and nothing else (Standing Amendment 2, folded
// from Section 7's own review: scripts/memq.js is 11,880 lines and a hot
// hook path such as this file's guard 4 cannot afford to pay its parse cost
// just to answer this one question, measured at 8.7-11.4ms warm). memq.js
// requires that module (a named exception to its own dynamic-load surface,
// pinned separately by test/memq-grant.test.js as a fixed kit-shipped
// sibling rather than a load from a directory the command line names) and
// re-exports the predicate under its own name, so hooks/memory-session.js
// and hooks/memory-frontmatter-guard.js, which already hold memq for other
// reasons, keep calling memq.namesNetworkShare unchanged. This file and
// hooks/chapter-boundary-nudge.js, which do not otherwise need memq, require
// hooks/kit-network-lib.js directly instead; this file's own namesNetworkShare
// is a delegating wrapper, legitimate re-export rather than a second spelling
// of the rule. hooks/kit-goal-lib.js carries its own independent copy of the
// underlying leading-separator test for a different subject, a stored
// transcript path rather than a working directory, so it is a ruled
// exclusion (Section 7's spec) rather than a gap this pin should close.
test('namesNetworkShare is spelled once, in kit-network-lib.js, and every other '
    + 'Section 7 file calls it rather than re-deriving the answer', () => {
    const NETWORK_LIB = path.join(
        __dirname, '..', 'plugins', 'claude-kit', 'hooks', 'kit-network-lib.js');
    const OTHER_FILES = {
        'scripts/memq.js':
            path.join(__dirname, '..', 'plugins', 'claude-kit', 'scripts', 'memq.js'),
        'hooks/compact-deferral-nudge.js': HOOK,
        'hooks/chapter-boundary-nudge.js':
            path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'chapter-boundary-nudge.js'),
        'hooks/memory-session.js':
            path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'memory-session.js'),
        'hooks/memory-frontmatter-guard.js':
            path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'memory-frontmatter-guard.js')
    };
    const sources = {
        'hooks/kit-network-lib.js': fs.readFileSync(NETWORK_LIB, 'utf8')
    };
    for (const [label, file] of Object.entries(OTHER_FILES)) {
        sources[label] = fs.readFileSync(file, 'utf8');
    }

    // The predicate's own body, spelled once, in kit-network-lib.js alone. A
    // RegExp literal rather than a string so this pin cannot be defeated by
    // rewrapping the same characters in different quotes; JS source carries
    // this exact substring wherever the leading-separator test is inlined
    // rather than delegated.
    const bodySpelling = /\[\\\\\/\]\{2\}\/\.test\(/;
    const spelledIn = Object.entries(sources).filter(([, src]) => bodySpelling.test(src)).map(([l]) => l);
    assert.deepStrictEqual(spelledIn, ['hooks/kit-network-lib.js'],
        'the leading-separator test must be spelled in exactly hooks/kit-network-lib.js among '
        + 'the files this section touches, got: ' + JSON.stringify(spelledIn));

    // memq.js requires the module at the top of the file and re-exports it
    // under its own name, never re-testing the leading separators itself.
    assert.match(sources['scripts/memq.js'],
        /const \{ namesNetworkShare \} = require\('\.\.\/hooks\/kit-network-lib\.js'\);/,
        'scripts/memq.js must require kit-network-lib.js rather than re-deriving the answer');

    // memory-session.js and memory-frontmatter-guard.js call it through the
    // memq module they already hold, never as a bare local call: a bare call
    // in either file would mean a local function of the same name shadowing
    // the shared one.
    for (const label of ['hooks/memory-session.js', 'hooks/memory-frontmatter-guard.js']) {
        assert.match(sources[label], /memq\.namesNetworkShare\(/,
            label + ' must call memq.namesNetworkShare through the memq module it already holds');
    }

    // This file and chapter-boundary-nudge.js require kit-network-lib.js
    // directly for the answer rather than answering the question themselves:
    // their own namesNetworkShare declarations (this file's a named wrapper,
    // chapter-boundary-nudge.js's a destructured local) are legitimate
    // re-export/re-binding rather than a second spelling of the rule.
    assert.match(sources['hooks/compact-deferral-nudge.js'],
        /require\('\.\/kit-network-lib\.js'\)\.namesNetworkShare\(cwd\)/,
        'compact-deferral-nudge.js must delegate to kit-network-lib.js\'s export rather than '
        + 're-deriving it');
    assert.match(sources['hooks/chapter-boundary-nudge.js'],
        /\(\{ namesNetworkShare \} = require\('\.\/kit-network-lib\.js'\)\)/,
        'chapter-boundary-nudge.js must delegate to kit-network-lib.js\'s export rather than '
        + 're-deriving it');
});

// ---------------------------------------------------------------------------
// The hold path: a session holding no leash in this project, held on the gate's
// interactive leg. Its denials open no episode at all (nextGateState leaves the
// slot untouched for a deny-interactive), so the fixtures below stage the hold
// in the gate state's PER-SESSION HOLD LIST, which is where guard 5H reads it
// (interactiveHolds, through interactiveHoldOpen), and leave the episode slot to
// whichever session actually holds the leash. The same record is staged in the
// shared newest-decision slot beside it, because that is exactly how the gate's
// own writer leaves the two after an interactive deny; nothing on this path
// reads it from there, which the two-seat case below is what proves.
// ---------------------------------------------------------------------------

// The interactive deny that holds a session, dated seconds ago and carrying a
// consumed reading above the default floor: the full hold-fire state. Each case
// overrides exactly the field it negates.
function interactiveDecision(overrides) {
    return {
        at: iso(20 * 1000),
        verdict: 'deny-interactive',
        reason: 'bystander',
        consumed: NUDGE_FLOOR_DEFAULT + 7000,
        checkpoint: null,
        session: SESSION,
        ...overrides
    };
}

// A project whose goal is armed and bound to ANOTHER session, with that
// session's own deferral episode open, and whose last decision is this session's
// interactive deny: the bystander shape, which is a role seat's ordinary state
// on a shared checkout.
function bystanderRepo(decisionOverrides) {
    const repo = makeRepo({ session: OTHER_SESSION, episode: { session: OTHER_SESSION } });
    writeGateState(repo, openEpisode({ session: OTHER_SESSION }), interactiveDecision(decisionOverrides));
    return repo;
}

// A project with nothing armed at all, whose last decision is this session's
// interactive deny: the no-goal shape, which is the coordinator seat's.
function unarmedHoldRepo(decisionOverrides) {
    const repo = makeDir('compact-deferral-nudge-repo-');
    writeGateState(repo, null, interactiveDecision({ reason: 'no-goal', ...decisionOverrides }));
    return repo;
}

// A project holding TWO sessions at once, which is the shared checkout's
// ordinary state: each carries its own hold record, and the newest decision is
// whichever seat took an offer last.
function twoHoldRepo(newest, older) {
    const repo = makeDir('compact-deferral-nudge-repo-');
    const first = interactiveDecision({ reason: 'no-goal', session: newest });
    const second = interactiveDecision({ reason: 'no-goal', session: older, at: iso(40 * 1000) });
    writeFile(gateStateFile(repo), JSON.stringify({
        lastDecision: first,
        episode: null,
        lastAllow: null,
        interactiveHolds: [first, second]
    }, null, 2) + '\n');
    return repo;
}

function holdStampFile(repo) {
    return require('../plugins/claude-kit/hooks/kit-compact-lib.js').holdNudgePath(repo);
}

function readHoldStamps(repo) {
    try { return JSON.parse(fs.readFileSync(holdStampFile(repo), 'utf8')).holds; } catch { return null; }
}

// Every fragment the hold directive must carry, checked in one place because
// several cases fire it. The runnable clause is pinned by tool name only, for
// the reason the episode cases give: it renders out of this checkout's own
// installed path, and a checkout under a path outside SAFE_CLI_PATH legitimately
// drops it. The clause is pinned both directions, against fixed paths, by the
// grammar case at the end.
function assertHoldDirective(context, label) {
    assert.ok(context.startsWith('compact-deferral-nudge:'), label + ': the hook must name itself');
    assert.ok(context.includes('holds no kit goal leash'),
        label + ': the directive must state why this session has no boundary to land at:\n' + context);
    assert.ok(context.includes('kit-compact-checkpoint.js'),
        label + ': the directive must name the boundary command:\n' + context);
    // The verb ON the command clause, in whichever of the two forms rendered.
    // A bare search for the word cannot fail: the reminder's own prose says
    // "no chapter boundary for the gate to land them at" whatever the clause
    // does, so it would report a dropped verb as a present one.
    assert.ok(/kit-compact-checkpoint\.js" boundary(?![A-Za-z])/.test(context)
        || context.includes('kit-compact-checkpoint.js with the boundary argument'),
        label + ': the directive must name the verb on the command clause itself:\n' + context);
    assert.ok(context.includes('worktree edits') && context.includes('on disk')
        && context.includes('messages you owe'),
        label + ': the directive must put the three durability facts:\n' + context);
    assert.ok(context.includes('lapses the moment new work arrives'),
        label + ': the directive must say the declaration covers this moment only');
}

test('a held bystander session at or above the floor receives the boundary directive', () => {
    const repo = bystanderRepo();
    try {
        const context = assertFires(runHook(firePayload(repo)), 'bystander hold');
        assertHoldDirective(context, 'bystander hold');
        assert.ok(!context.includes(SESSION), 'no session id may reach the directive');
        assert.ok(!context.includes(repo), 'no project path may reach the directive');
        assert.ok(!context.includes(String(NUDGE_FLOOR_DEFAULT + 7000)),
            'the consumed reading decides whether the directive speaks and is never rendered');
        // The leash holder's episode belongs to another session and this
        // directive is not about it: the stamp lands in the hold file instead.
        assert.strictEqual(readGateStateFile(repo).episode.nudgedAt, null,
            'a bystander nudge must not stamp the leash holder\'s episode');
        assert.strictEqual(readHoldStamps(repo).length, 1, 'one stamp, for this session');
        assert.strictEqual(readHoldStamps(repo)[0].session, SESSION, 'the stamp names the held session');
    } finally {
        rmDir(repo);
    }
});

test('a held session in a project with nothing armed receives the same directive', () => {
    // The no-goal shape, which is the second denial path the plan names: a seat
    // whose project has no kit goal at all is held on the same leg and has the
    // same single release.
    const repo = unarmedHoldRepo();
    try {
        assertHoldDirective(assertFires(runHook(firePayload(repo)), 'no-goal hold'), 'no-goal hold');
    } finally {
        rmDir(repo);
    }
});

test('the same hold below the floor is silent and stamps nothing', () => {
    // Guard 6H, and only guard 6H: the record is otherwise the full hold-fire
    // state, one token under the default floor.
    const repo = bystanderRepo({ consumed: NUDGE_FLOOR_DEFAULT - 1 });
    try {
        const before = stateBytes(repo);
        assertSilent(runHook(firePayload(repo)), 'below the floor');
        assertNoStateWrite(repo, before, 'a hold below the floor writes nothing');
        assert.strictEqual(readHoldStamps(repo), null, 'and stamps no hold clock');
    } finally {
        rmDir(repo);
    }
});

test('a hold whose consumed reading is absent or illegible is below every floor', () => {
    // The figure is the only evidence the hook has that the hold is near the
    // ceiling. The library's own rebuild leaves null for every unusable value,
    // so these stage what a reader would actually meet.
    for (const consumed of [null, undefined, 'lots', -1]) {
        const repo = bystanderRepo({ consumed });
        try {
            assertSilent(runHook(firePayload(repo)), 'consumed ' + String(consumed));
        } finally {
            rmDir(repo);
        }
    }
});

// Make the shared network predicate answer true for the project's scratch
// directory and for nothing else, which is the one shape no fixture on a local
// box can stage: the resolver sends a project directory under ~/.claude to a
// home-anchored path, so a genuinely UNC scratch directory needs a UNC home,
// and a project directory under a UNC home is itself UNC and never gets past
// the cwd screen. The substitution puts the resolver's answer on the refusing
// side while cwd stays clean, which is exactly the discrimination between
// screening cwd and screening what the resolver returns.
function scratchShareReportingPreload(dir) {
    const lib = path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'kit-network-lib.js');
    const shim = path.join(dir, 'report-scratch-share.js');
    fs.writeFileSync(shim, [
        "'use strict';",
        'const netlib = require(' + JSON.stringify(lib.replace(/\\/g, '/')) + ');',
        'const real = netlib.namesNetworkShare;',
        'netlib.namesNetworkShare = function (p) {',
        "    if (typeof p === 'string' && p.includes('.kit')) return true;",
        '    return real.apply(null, arguments);',
        '};'
    ].join('\n') + '\n', 'utf8');
    return '--require "' + shim.replace(/\\/g, '/') + '"';
}

test('a scratch directory on a network share stands the hook down, though cwd is clean', () => {
    // The screen is owed to the reads rather than to the working directory. A
    // coordinator seat's project directory lies under ~/.claude, so its gate
    // state and hold stamps resolve to a home-anchored path, and every one of
    // those files is opened synchronously after a covered tool return. An
    // unreachable share blocks that open for the SMB timeout, which is the one
    // failure this hook must never cause, and the cwd screen cannot see it.
    const repo = bystanderRepo();
    try {
        const before = stateBytes(repo);
        assertSilent(runHook(firePayload(repo), {
            NODE_OPTIONS: scratchShareReportingPreload(repo)
        }), 'a scratch directory on a share');
        assertNoStateWrite(repo, before, 'a refused scratch directory writes nothing');
        assert.strictEqual(readHoldStamps(repo), null, 'and stamps nothing');
        // The control: the same fixture with the predicate answering for itself
        // fires, so the silence above is the screen rather than a broken hold.
        assertHoldDirective(assertFires(runHook(firePayload(repo)), 'the control'), 'the control');
    } finally {
        rmDir(repo);
    }
});

test('the floor is read from the machine-local signpost, both directions', () => {
    // A reading that is below the default and above a signposted floor, so the
    // same fixture answers both ways and only the signpost decides. Without the
    // read the first case fires, and the control below cannot.
    const repo = bystanderRepo({ consumed: 150000 });
    try {
        assertSilent(runHook(firePayload(repo)), 'no signpost: the default floor holds');
        writeSignpost(JSON.stringify({ kitRepoPath: 'D:/kit', compactNudgeFloor: 100000 }));
        assertHoldDirective(assertFires(runHook(firePayload(repo)), 'signposted floor'), 'signposted floor');
    } finally {
        writeSignpost(undefined);
        rmDir(repo);
    }
});

test('every unusable signpost reading means the default floor', () => {
    // The hook runs after every covered tool return, so this reader must be
    // total: a throw here is a hook that dies constantly. The value is read in
    // process, with the home redirected the way os.homedir() follows it, so each
    // reading is asserted as its own return rather than through a silence that
    // several guards could have produced.
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = FIXTURE_HOME;
    process.env.USERPROFILE = FIXTURE_HOME;
    try {
        writeSignpost(undefined);
        assert.strictEqual(nudgeFloor(), NUDGE_FLOOR_DEFAULT, 'an absent signpost');
        for (const text of [
            '',
            'not json {',
            'null',
            '[]',
            '"a string"',
            '{}',
            '{"kitRepoPath":"D:/kit"}',
            '{"compactNudgeFloor":"290000"}',
            '{"compactNudgeFloor":null}',
            '{"compactNudgeFloor":true}',
            '{"compactNudgeFloor":-1}',
            '{"compactNudgeFloor":1e999}',
            '{"compactNudgeFloor":{"value":1}}'
        ]) {
            writeSignpost(text);
            assert.strictEqual(nudgeFloor(), NUDGE_FLOOR_DEFAULT,
                'unusable signpost reading: ' + JSON.stringify(text));
        }
        // A directory at the signpost path: not a regular file, so it is refused
        // by kind rather than opened.
        writeSignpost(undefined);
        fs.mkdirSync(SIGNPOST);
        try {
            assert.strictEqual(nudgeFloor(), NUDGE_FLOOR_DEFAULT, 'a directory at the signpost path');
        } finally {
            fs.rmSync(SIGNPOST, { recursive: true, force: true });
        }
        // The control: the instrument speaks when the key is usable, so the
        // defaults above are refusals rather than a reader that always returns
        // the default. Zero is a usable floor and is deliberately included, since
        // it is the value a reader testing truthiness would drop.
        for (const value of [100000, 0, 285001]) {
            writeSignpost(JSON.stringify({ compactNudgeFloor: value }));
            assert.strictEqual(nudgeFloor(), value, 'a usable floor of ' + value);
        }
    } finally {
        writeSignpost(undefined);
        if (saved.HOME === undefined) delete process.env.HOME; else process.env.HOME = saved.HOME;
        if (saved.USERPROFILE === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = saved.USERPROFILE;
    }
});

// Report one path as a symlink over the ordinary regular file that is really
// there, which is what puts the link kind in front of a reader on this box:
// fs.symlinkSync refuses a file link here with EPERM, so a real one cannot be
// planted (kit-goal-lib.test.js's reportAsLink states the same constraint for
// the goal state). Every other path answers from the real lstat, so nothing but
// the subject is disturbed. Returns the restore function.
function reportAsLink(full) {
    const realLstatSync = fs.lstatSync;
    fs.lstatSync = function (target) {
        const st = realLstatSync.apply(fs, arguments);
        if (String(target) === full) {
            return {
                size: st.size,
                isFile: () => false,
                isDirectory: () => false,
                isSymbolicLink: () => true
            };
        }
        return st;
    };
    return () => { fs.lstatSync = realLstatSync; };
}

test('a link at the signpost path is refused, so the floor falls back to the default', {
    skip: process.platform !== 'win32' ? 'the lstat the shim stages is consulted on win32 alone' : false
}, () => {
    // The signpost is read through kit-read-lib's shared bounded reader, which
    // follows a link at the final component by design; this read opts into the
    // refusal, so a link planted at the path cannot redirect the floor to a file
    // outside ~/.claude, and a link into a dead network mount cannot stall a
    // hook that runs after every covered tool return.
    //
    // win32 only, because the INSTRUMENT is: the reader consults lstat for this
    // question only where the platform has no O_NOFOLLOW, and everywhere else
    // the refusal rides the open, where a shimmed lstat is never asked and the
    // real file answers. The other leg is covered where it can be staged with a
    // real link, in test/kit-read-lib.test.js against the reader itself.
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = FIXTURE_HOME;
    process.env.USERPROFILE = FIXTURE_HOME;
    const LINKED_FLOOR = 100000;
    try {
        writeSignpost(JSON.stringify({ compactNudgeFloor: LINKED_FLOOR }));
        // The control comes first and is the same file, unlinked: the refusal
        // below is about the link rather than about a reader that always
        // answers the default.
        assert.strictEqual(nudgeFloor(), LINKED_FLOOR,
            'the control: an ordinary signpost carrying a floor is read');
        const restore = reportAsLink(SIGNPOST);
        try {
            assert.strictEqual(nudgeFloor(), NUDGE_FLOOR_DEFAULT,
                'a link at the signpost path must be refused, not followed');
        } finally {
            restore();
        }
        // And the refusal is not sticky: the same file reads again once it is
        // no longer a link.
        assert.strictEqual(nudgeFloor(), LINKED_FLOOR, 'the reader is unchanged for a regular file');
    } finally {
        writeSignpost(undefined);
        if (saved.HOME === undefined) delete process.env.HOME; else process.env.HOME = saved.HOME;
        if (saved.USERPROFILE === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = saved.USERPROFILE;
    }
});

test('each held session\'s directive fires on its own hold, whichever seat decided last', () => {
    // The shared checkout this whole path exists for holds several seats at
    // once, and every gate process writes the one newest-decision slot, so the
    // seats alternate in it. The hold is per session and the directive is
    // decided by the seat's own record: here each of two held sessions fires
    // while the other's decision is the newest one in the project.
    const repo = twoHoldRepo(OTHER_SESSION, SESSION);
    try {
        assertHoldDirective(
            assertFires(runHook(firePayload(repo)), 'the older hold'), 'the older hold');
        assertHoldDirective(
            assertFires(runHook(firePayload(repo, { session_id: OTHER_SESSION })), 'the newest hold'),
            'the newest hold');
        const stamps = readHoldStamps(repo);
        assert.strictEqual(stamps.length, 2, 'each seat was spoken to once: ' + JSON.stringify(stamps));
        assert.deepStrictEqual(stamps.map((e) => e.session).sort(), [OTHER_SESSION, SESSION].sort(),
            'and the stamps name the two held sessions');
    } finally {
        rmDir(repo);
    }
});

test('silent when the hold record belongs to another session', () => {
    // Guard 5H's session test. A second seat's hold sits in the same list as
    // this one's, and one session must never act on another's.
    const repo = bystanderRepo({ session: OTHER_SESSION });
    try {
        assertSilent(runHook(firePayload(repo)), 'another session\'s hold');
        assert.strictEqual(readHoldStamps(repo), null, 'and nothing is stamped for either');
    } finally {
        rmDir(repo);
    }
});

test('silent when the hold record is not an interactive deny of a hands-on kind', () => {
    // Guard 5H's verdict and reason tests. A boundary deny is the leash holder's
    // own class and is answered by the episode path; an allow is not a hold at
    // all; and an interactive verdict carrying some other reason is not one of
    // the two hands-on shapes.
    //
    // Each record is staged INTO the hold list rather than through the fixture's
    // own writer, which stages a record there only when it is already a
    // session-bearing interactive deny. Staged that way the verdict cases never
    // reach the guard at all: the list is empty, the silence is the fixture's,
    // and the case passes with guard 5H's verdict test deleted. The gate itself
    // never writes those records into that list, so what this stages is the
    // hand-edited state file the rebuilders exist for, which is what puts the
    // guard on the path. The control below is the same staging with a record the
    // guard must accept, so the four refusals are the guard's rather than a list
    // nothing could ever read out of.
    const stageHold = (overrides) => {
        const repo = makeRepo({ session: OTHER_SESSION, episode: { session: OTHER_SESSION } });
        const record = interactiveDecision(overrides);
        writeFile(gateStateFile(repo), JSON.stringify({
            lastDecision: record, episode: openEpisode({ session: OTHER_SESSION }),
            lastAllow: null, interactiveHolds: [record]
        }, null, 2) + '\n');
        return repo;
    };
    // Each pair leaves exactly one of the two tests standing, so neither can
    // pass on the other's account: the first three carry a hands-on reason with
    // a verdict the guard must refuse, and the last two carry the verdict with a
    // reason it must refuse. The ordinary shapes the gate really writes
    // (deny-boundary/no-checkpoint, allow/valve) are refused twice over and
    // would let either test be deleted unnoticed.
    for (const overrides of [
        { verdict: 'deny-boundary', reason: 'bystander' },
        { verdict: 'allow', reason: 'bystander' },
        { verdict: 'allow', reason: 'no-goal' },
        { verdict: 'deny-boundary', reason: 'no-checkpoint' },
        { verdict: 'allow', reason: 'valve' },
        { verdict: 'allow', reason: 'role-boundary' },
        { verdict: 'deny-interactive', reason: 'automation' },
        { verdict: 'deny-interactive', reason: null }
    ]) {
        const repo = stageHold(overrides);
        try {
            assertSilent(runHook(firePayload(repo)), JSON.stringify(overrides));
            assert.strictEqual(readHoldStamps(repo), null,
                'nothing is stamped for a record the guard refuses: ' + JSON.stringify(overrides));
        } finally {
            rmDir(repo);
        }
    }
    // The control: the same staging, with the one verdict and reason pair the
    // guard admits, fires. Without it the five refusals above would pass equally
    // for a staging the hook can never read.
    const repo = stageHold({ verdict: 'deny-interactive', reason: 'bystander' });
    try {
        assertHoldDirective(assertFires(runHook(firePayload(repo)), 'the staged control'),
            'the staged control');
    } finally {
        rmDir(repo);
    }
});

test('silent when the hold record has aged past the gate idle bound or is future-dated', () => {
    // Guard 5H's two timestamp bounds, the same pair gateEpisodeOpen holds an
    // episode's newest denial to. Past the trigger the harness re-offers every
    // assistant turn, so a decision older than the bound is a finished hold.
    for (const at of [iso(5 * 60 * 60 * 1000), iso(-10 * 60 * 1000), 'not a date', null]) {
        const repo = bystanderRepo({ at });
        try {
            assertSilent(runHook(firePayload(repo)), 'hold dated ' + String(at));
        } finally {
            rmDir(repo);
        }
    }
});

test('the common stand-downs apply to the hold path unchanged', () => {
    // Guards 1 to 4 are common to both paths. Guard 3 is the load-bearing one
    // here and is the only stand-down a subagent gets: its payload carries the
    // PARENT session's id, so the hold record names it and guard 5H would pass.
    // Every dispatched agent runs Bash constantly, and a directive to declare a
    // boundary spent inside an agent is spent on a context that cannot declare
    // one.
    const repo = bystanderRepo();
    try {
        assertSilent(runHook(firePayload(repo, { agent_id: 'agent-11112222aaaabbbb' })), 'agent_id');
        for (const key of ['agent_type', 'agentType', 'subagent_type', 'subagentType']) {
            assertSilent(runHook(firePayload(repo, { [key]: 'general-purpose' })), key);
        }
        assertSilent(runHook(firePayload(repo), { KIT_EXTERNAL_ENGINE: '1' }), 'external engine');
        assertSilent(runHook(firePayload(repo, { tool_name: 'Read' })), 'uncovered tool');
        assertSilent(runHook(firePayload(repo, { cwd: 42 }), null, repo), 'unusable cwd');
        assert.strictEqual(readHoldStamps(repo), null, 'no stand-down consumed the interval');
    } finally {
        rmDir(repo);
    }
});

test('a camelCase sessionId is read the same on the hold path', () => {
    const repo = bystanderRepo();
    try {
        const payload = firePayload(repo);
        delete payload.session_id;
        payload.sessionId = SESSION;
        assertHoldDirective(assertFires(runHook(payload), 'camelCase'), 'camelCase');
    } finally {
        rmDir(repo);
    }
});

test('a second hold directive inside the interval is silent, and one past it fires', () => {
    // Guard 7H, over the hold path's own stamp file. The gate state carries no
    // stamp for this path, so the interval has to survive on that file alone.
    const repo = bystanderRepo();
    try {
        assertFires(runHook(firePayload(repo)), 'first call');
        const stamped = readHoldStamps(repo);
        assert.strictEqual(stamped.length, 1, 'one stamp');
        assert.ok(Math.abs(Date.now() - Date.parse(stamped[0].nudgedAt)) < 60 * 1000,
            'the stamp is written at the fire');
        assertSilent(runHook(firePayload(repo)), 'second call inside the interval');

        // Age the stamp past the interval and nothing else.
        writeFile(holdStampFile(repo), JSON.stringify({
            holds: [{ session: SESSION, nudgedAt: iso(NUDGE_INTERVAL_MS + 60 * 1000) }]
        }, null, 2) + '\n');
        assertFires(runHook(firePayload(repo)), 'call past the interval');
    } finally {
        rmDir(repo);
    }
});

test('an illegible hold stamp fires and is replaced by the fire\'s own', () => {
    // The fail-open direction, self-healing exactly as guard 8's is: the stamp
    // is written through an atomic rename, so the fire replaces the unusable
    // file wholesale and the interval takes hold from the next return onward.
    for (const text of ['not json {', '{}', '{"holds":[]}', '{"holds":[{"session":"' + SESSION + '"}]}']) {
        const repo = bystanderRepo();
        try {
            writeFile(holdStampFile(repo), text);
            assertFires(runHook(firePayload(repo)), 'illegible stamp ' + text);
            assertSilent(runHook(firePayload(repo)), 'the interval engages on the next call');
        } finally {
            rmDir(repo);
        }
    }
});

test('two held sessions in one project keep their own intervals', () => {
    // The stamp file holds one entry per session, which is what keeps the
    // interval from collapsing on a shared checkout. With a single slot each
    // session would read the other's stamp, find no entry of its own, and fire
    // after every covered tool return: the unbounded repeat the hook's header
    // calls worse than silence.
    const repo = unarmedHoldRepo();
    try {
        assertFires(runHook(firePayload(repo)), 'first session');
        writeGateState(repo, null, interactiveDecision({ reason: 'no-goal', session: ARM_BYSTANDER }));
        assertFires(runHook(firePayload(repo, { session_id: ARM_BYSTANDER })), 'second session');
        const stamps = readHoldStamps(repo);
        assert.strictEqual(stamps.length, 2, 'both stamps are kept: ' + JSON.stringify(stamps));
        assertSilent(runHook(firePayload(repo, { session_id: ARM_BYSTANDER })),
            'the second session is now inside its interval');
        writeGateState(repo, null, interactiveDecision({ reason: 'no-goal' }));
        assertSilent(runHook(firePayload(repo)),
            'and the first session\'s own stamp survived the second session\'s fire');
    } finally {
        rmDir(repo);
    }
});

test('a hold directive that fires leaves one journal line, distinguishable from an episode nudge', () => {
    // Two nudges share this journal and an operator reads a different question
    // out of each, so the event value names which one spoke.
    const repo = bystanderRepo();
    try {
        assertFires(runHook(firePayload(repo)), 'hold directive');
        const lines = readGateLog(repo);
        assert.strictEqual(lines.length, 1, 'one fire, one line: ' + JSON.stringify(lines));
        assert.deepStrictEqual(Object.keys(lines[0]).sort(), ['at', 'event', 'session', 'tool'],
            'the record carries the time, the event, the session and the tool, and nothing else');
        assert.strictEqual(lines[0].event, 'nudge-hold', 'the event names which nudge spoke');
        assert.strictEqual(lines[0].session, SESSION, 'the session the hold belongs to');
        assert.strictEqual(lines[0].tool, 'Bash', 'the triggering tool');
    } finally {
        rmDir(repo);
    }
});

test('silent when the hold stamp cannot land', () => {
    // The rate limit is the emission's precondition on this path too: the stamp
    // is the only cross-process carrier the hold interval has, so a directive
    // emitted without it would repeat after every covered tool return.
    const repo = bystanderRepo();
    try {
        fs.mkdirSync(holdStampFile(repo));
        assertSilent(runHook(firePayload(repo)), 'a directory at the stamp path');
    } finally {
        rmDir(repo);
    }
});

test('neither directive orders the other session\'s ritual', () => {
    // The two are for two different sessions and neither one's steps are
    // available to the other: a bystander has no Chapter to append and no
    // checkpoint to open, and a leashed run's release is the checkpoint rather
    // than the role-boundary marker.
    const cli = 'D:/kit/plugins/claude-kit/hooks/kit-compact-checkpoint.js';
    const hold = buildHoldReminder(cli);
    const episode = buildReminder('held 7 offers over 45 minutes', cli);
    assert.ok(!hold.includes('Chapter'), 'the hold directive must not order a Chapter');
    assert.ok(!hold.includes('interim board'), 'the hold directive must not order a board entry');
    assert.ok(!hold.includes('" open'), 'the hold directive must not order the open verb');
    assert.ok(!episode.includes('" boundary'), 'the episode reminder must not order the boundary verb');
});

test('the hold directive\'s runnable clause is dropped when the installed path fails the grammar', () => {
    // The same gate the episode reminder's clause is held to, for the same
    // reason: this text lands in the model's context as a line to run, and
    // double quotes neutralize neither $(...) nor backticks.
    const safe = buildHoldReminder('D:/kit/plugins/claude-kit/hooks/kit-compact-checkpoint.js');
    assert.ok(safe.includes('run node "D:/kit/plugins/claude-kit/hooks/kit-compact-checkpoint.js" boundary'),
        'a conventional install path still renders the runnable command');

    for (const hostile of [
        'D:/kit/$(calc)/hooks/kit-compact-checkpoint.js',
        'D:/kit/`calc`/hooks/kit-compact-checkpoint.js',
        'D:/kit/a";calc;"/hooks/kit-compact-checkpoint.js',
        'D:/kit/a\ncalc/hooks/kit-compact-checkpoint.js'
    ]) {
        const guarded = buildHoldReminder(hostile);
        assert.ok(!guarded.includes('calc'), 'no part of a refused path may reach the context:\n' + guarded);
        assert.ok(!guarded.includes('run node "'), 'a refused path renders no runnable command');
        assert.ok(guarded.includes('kit-compact-checkpoint.js'),
            'the rest of the directive still names the tool to run');
        assert.ok(guarded.includes('boundary argument'), 'and the verb to give it');
    }
});

// Run a builder with the home directory redirected the way os.homedir() follows
// it, so the command clause is composed against a home this case is staging
// rather than against the operator's own. In-process, the way the signpost
// reader's own cases redirect it.
function underHome(home, run) {
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    try { return run(); } finally {
        process.env.HOME = saved.HOME;
        process.env.USERPROFILE = saved.USERPROFILE;
    }
}

// The installed layout as a real kit has it: the plugin cache under the home
// directory, which is where every installed kit resolves __dirname to and where
// the account name is.
function installedCli(home) {
    return path.join(home, '.claude', 'plugins', 'cache', 'applefeld', 'claude-kit',
        '5d451b258e75', 'hooks', 'kit-compact-checkpoint.js').split('\\').join('/');
}

test('neither directive carries the account name of an installed kit into the context', () => {
    // Both texts land in the model's context, and an installed kit lives under
    // ~/.claude/plugins/cache/, so the composed command is home-anchored on every
    // machine the kit is installed on rather than dogfooded in. The path grammar
    // is a metacharacter screen and admits an account name in full, so it is not
    // the guard for this: the checkpoint CLI this command names holds its own
    // output to an elision, and this is a second producer on the same channel.
    //
    // The replacement is $HOME rather than ~ because the clause promises a line
    // to run: the composed line reaches the directory os.homedir() names in
    // either shell a seat has in front of it, while a quoted tilde is expanded
    // by neither.
    const home = path.join(FIXTURE_HOME, 'kit-r9-account');
    const cli = installedCli(home);
    const both = underHome(home, () => [
        buildHoldReminder(cli),
        buildReminder('held 7 offers over 45 minutes', cli)
    ]);
    for (const [i, context] of both.entries()) {
        const which = i === 0 ? 'the hold directive' : 'the episode reminder';
        assert.ok(!context.includes('kit-r9-account'),
            which + ' must not carry the account name: ' + context);
        // Both spellings, and the second is the one that can fail: the command
        // clause renders every separator as a forward slash, so on win32 the
        // backslashed spelling of the home directory is absent from this text
        // whether or not anything was elided, and that assertion alone reads as
        // a second observation while being none.
        for (const spelling of [home, home.split('\\').join('/')]) {
            assert.ok(!context.includes(spelling),
                which + ' must not carry the home prefix in any form: ' + context);
        }
        assert.ok(context.includes('run node "$HOME/.claude/plugins/cache/applefeld/claude-kit/'
            + '5d451b258e75/hooks/kit-compact-checkpoint.js"'),
            which + ' still renders a runnable command, home-relative: ' + context);
    }
});

test('a checkout outside the home directory renders its command unchanged', () => {
    // The other direction, and the one that says the elision is bounded rather
    // than a rewrite of every path: a dogfooded checkout is not under the home
    // directory, carries no account name, and is named as itself.
    const cli = 'D:/kit/plugins/claude-kit/hooks/kit-compact-checkpoint.js';
    const context = underHome(path.join(FIXTURE_HOME, 'kit-r9-account'),
        () => buildHoldReminder(cli));
    assert.ok(context.includes('run node "' + cli + '" boundary'),
        'a checkout outside the home directory is named in full: ' + context);
});

test('a shell with no knowable home directory renders no command at all', () => {
    // "This path is not under the home directory" and "no home directory is
    // knowable" are the same answer from a reader that only asks whether the
    // relative path escapes, and they are opposite news here: on the second the
    // elision cannot be performed, so an absolute path would be printed into the
    // model's context unelided. The clause is dropped instead and the prose
    // fallback carries the instruction, which costs the reader a lookup and
    // costs nobody an account name.
    //
    // os.homedir() is patched rather than the environment stripped, because on
    // win32 the runtime asks the OS once USERPROFILE and HOME are gone, so no
    // environment alone can stage this reading.
    const home = path.join(FIXTURE_HOME, 'kit-r9-account');
    const driver = path.join(FIXTURE_HOME, 'kit-r9-homeless-driver.js');
    writeFile(driver, [
        "'use strict';",
        "const os = require('os');",
        "os.homedir = function () { return ''; };",
        'const hook = require(' + JSON.stringify(HOOK.replace(/\\/g, '/')) + ');',
        'process.stdout.write(hook.buildHoldReminder(process.argv[2]));'
    ].join('\n') + '\n');
    const res = spawnSync(process.execPath, [driver, installedCli(home)], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, 'the driver runs: ' + res.stderr);
    assert.ok(!res.stdout.includes('run node "'),
        'no runnable command is composed with no home to elide against: ' + res.stdout);
    assert.ok(!res.stdout.includes('kit-r9-account'),
        'and no account name reaches the context: ' + res.stdout);
    assert.ok(res.stdout.includes('kit-compact-checkpoint.js with the boundary argument'),
        'the prose fallback still names the tool and the verb: ' + res.stdout);
});

test('a hold exactly AT the floor fires: the guard is at-or-above, not above', () => {
    // The suite otherwise pins floor-minus-one silent and floor-plus-seven-
    // thousand firing, which a slip from < to <= passes untouched. This case is
    // the boundary itself, and it is the only one that discriminates.
    const repo = bystanderRepo({ consumed: NUDGE_FLOOR_DEFAULT });
    try {
        assertHoldDirective(assertFires(runHook(firePayload(repo)), 'at the floor'), 'at the floor');
    } finally {
        rmDir(repo);
    }
});

test('a spent stamp is never what an eviction drops: a live hold keeps its interval', () => {
    // The stamp list is capped, and eviction by count alone is not a bounded
    // degradation: the entry dropped is another LIVE session's, which then fires
    // on its next covered tool return and evicts a third, so past the cap every
    // seat is re-nudged every few fires instead of every interval. The age rule
    // is what makes an eviction safe, and this stages the shape that
    // discriminates: the cap's worth of SPENT stamps standing in front of one
    // live stamp, and a further session firing into it.
    const repo = unarmedHoldRepo();
    try {
        // Seven stamps older than the interval, then this session's own, fresh.
        // Newest first, which is the order the writer leaves.
        const spent = [];
        for (let i = 0; i < 7; i += 1) {
            spent.push({ session: 'ses-spent-' + i, nudgedAt: iso(2 * NUDGE_INTERVAL_MS + i * 1000) });
        }
        writeFile(holdStampFile(repo), JSON.stringify({
            holds: [...spent, { session: SESSION, nudgedAt: iso(60 * 1000) }]
        }, null, 2) + '\n');

        // A ninth session fires, which is the write that applies the cap.
        writeGateState(repo, null, interactiveDecision({ reason: 'no-goal', session: ARM_BYSTANDER }));
        assertFires(runHook(firePayload(repo, { session_id: ARM_BYSTANDER })), 'the other session fires');

        // This session was nudged a minute ago, so guard 7H must still hold it
        // silent. Without the age rule its stamp is the entry the cap dropped.
        writeGateState(repo, null, interactiveDecision({ reason: 'no-goal' }));
        assertSilent(runHook(firePayload(repo)), 'the live stamp survived the eviction');

        const stamps = readHoldStamps(repo);
        assert.ok(stamps.some((e) => e.session === SESSION),
            'the live stamp is still on disk: ' + JSON.stringify(stamps));
        assert.ok(!stamps.some((e) => /^ses-spent-/.test(e.session)),
            'and the spent ones are gone rather than holding slots: ' + JSON.stringify(stamps));
    } finally {
        rmDir(repo);
    }
});

test('the hold stamp list is aged by the same interval the nudge speaks on', () => {
    // A cross-surface pin, because the two constants live in two files and
    // cannot import each other: the hook requires the library, so the reverse
    // require would be a cycle. The direction is one-sided. A TTL shorter than
    // the nudge's interval would drop stamps that are still throttling a session
    // and hand back the eviction collapse the case above pins; a longer one only
    // keeps spent entries around.
    const { HOLD_NUDGE_TTL_MS } = require('../plugins/claude-kit/hooks/kit-compact-lib.js');
    assert.ok(HOLD_NUDGE_TTL_MS >= NUDGE_INTERVAL_MS,
        'the library must not age a stamp out before the nudge would speak again: TTL '
        + HOLD_NUDGE_TTL_MS + ' vs interval ' + NUDGE_INTERVAL_MS);
});

test('silent on the hold path when the armed goal carries no binding', () => {
    // An unbound goal is claimable by whichever session's arming text names it,
    // read out of a transcript this hook never opens, so a session in front of
    // one may be the leash holder unrecognizably. Telling it that it holds no
    // leash and pointing it at the role-boundary marker would be false twice
    // over: the claim it is about to make routes it to the gate's boundary leg,
    // which never reads that marker, so the declaration would be spent on
    // nothing. The fixture is otherwise the full hold-fire state, with an
    // interactive deny naming this session at a consumed reading above the
    // floor, so the fork's own stand-down is the only thing that can decide it.
    const repo = makeRepo({ unbound: true });
    try {
        writeGateState(repo, null, interactiveDecision());
        assertSilent(runHook(firePayload(repo)), 'armed but unbound');
        assert.strictEqual(readHoldStamps(repo), null, 'and nothing is stamped');
    } finally {
        rmDir(repo);
    }
});

test('the control: the same hold in a project whose goal IS bound still fires', () => {
    // Without this the case above passes for a fork that stood every hold down.
    // The one field that differs is the binding.
    const repo = bystanderRepo();
    try {
        assertHoldDirective(assertFires(runHook(firePayload(repo)), 'bound elsewhere'), 'bound elsewhere');
    } finally {
        rmDir(repo);
    }
});

// The readings of the goal state, pinned apart. readGoal answers null both for a
// state no surface in the kit can act on and for one that is there and could not
// be read, so a fork branching on that null alone speaks the hold directive on an
// uncertain reading: at a session that may hold the leash, about a marker the
// gate's boundary leg never reads, spending the declaration on nothing and
// displacing the chapter checkpoint it should have opened. The discriminator is
// the KIND at the path (goalPathKind, against the hook's own settled list), and
// each reading gets its own case because silence and speech are what separate
// them. Absence is one settled reading rather than the only one, which is why
// the oversized case below is a fire and not a silence.
test('the hold directive is spoken where the goal state is genuinely ABSENT', () => {
    // Reading one: nothing at the path at all, which is the unarmed project the
    // no-goal shape serves. The absence is asserted rather than assumed, so this
    // case cannot pass by staging one of the other two readings by accident.
    const repo = unarmedHoldRepo();
    try {
        assert.ok(!fs.existsSync(goalPath(repo)), 'test setup: nothing is at the goal-state path');
        assertHoldDirective(assertFires(runHook(firePayload(repo)), 'absent'), 'absent');
    } finally {
        rmDir(repo);
    }
});

test('the hold directive is spoken where the goal state is there and OVERSIZED', () => {
    // A settled reading that is not an absence: a regular file past the cap every
    // reader of that file enforces. No surface in the kit reads it, this hook and
    // the gate that recorded the deny in front of the session included, so no
    // session can be recognized as holding a leash through it and none can open a
    // chapter checkpoint instead; and nothing about the file resolves with time.
    // A stand-down keyed on absence alone leaves this session permanently silent
    // while the gate is actively holding it, which is the failure this case is
    // here for rather than the uncertain reading below.
    const repo = unarmedHoldRepo();
    try {
        writeFile(goalPath(repo), JSON.stringify({ pad: 'x'.repeat(GOAL_STATE_MAX_BYTES) }));
        assert.ok(fs.statSync(goalPath(repo)).size > GOAL_STATE_MAX_BYTES,
            'test setup: the state file must really be past the cap every reader applies');
        assertHoldDirective(assertFires(runHook(firePayload(repo)), 'oversized'), 'oversized');
    } finally {
        rmDir(repo);
    }
});

test('silent where the goal state is there and cannot be read', () => {
    // Reading two, in the two shapes a transient produces: a file whose bytes
    // are not the state (a torn write, a lock reported as garbage) and a kind
    // that is not a regular file at all. Both leave readGoal answering null with
    // something sitting at the path, and the uncertain reading takes the silent
    // direction: the session in front of it may be the one holding the leash.
    // The fixture is otherwise the full hold-fire state, so nothing but the
    // goal-state reading can decide either case.
    for (const stage of [
        ['illegible bytes', (target) => writeFile(target, '{ not json at all')],
        ['a kind that is not a regular file', (target) => fs.mkdirSync(target, { recursive: true })]
    ]) {
        const repo = unarmedHoldRepo();
        try {
            stage[1](goalPath(repo));
            assertSilent(runHook(firePayload(repo)), stage[0]);
            assert.strictEqual(readHoldStamps(repo), null, stage[0] + ': and nothing is stamped');
        } finally {
            rmDir(repo);
        }
    }
});

test('the control: a goal state that reads fine decides on its own contents', () => {
    // Reading three, both ways, so the silence above is the unreadable state's
    // and not a stand-down over every project that has a goal state at all: a
    // state bound to another session fires the hold directive, and the same
    // state armed and unbound stands the fork down.
    const bound = bystanderRepo();
    try {
        assert.ok(fs.existsSync(goalPath(bound)), 'test setup: the state is there and legible');
        assertHoldDirective(assertFires(runHook(firePayload(bound)), 'legible, bound elsewhere'),
            'legible, bound elsewhere');
    } finally {
        rmDir(bound);
    }
    const unbound = makeRepo({ unbound: true });
    try {
        writeGateState(unbound, null, interactiveDecision());
        assertSilent(runHook(firePayload(unbound)), 'legible, unbound');
    } finally {
        rmDir(unbound);
    }
});

// Source-inspection pins, on the pattern the namesNetworkShare case above
// already uses: a behavioural test proves what the callers do today, not that a
// later edit cannot reintroduce the shape the pin exists to forbid.
const COMPACT_LIB_SRC = path.join(
    __dirname, '..', 'plugins', 'claude-kit', 'hooks', 'kit-compact-lib.js');
const GATE_SRC = path.join(
    __dirname, '..', 'plugins', 'claude-kit', 'hooks', 'kit-compact-gate.js');

// The library's own reader of the hold-stamp file, extracted from the source so
// the pin below speaks about that function rather than about the whole file. It
// is the result-returning reader that opens the file; readHoldNudges is a
// wrapper over it that drops the certainty flag for the read-only callers.
function readHoldNudgesSource() {
    const src = fs.readFileSync(COMPACT_LIB_SRC, 'utf8');
    const m = src.match(/\nfunction readHoldNudgesResult\([\s\S]*?\r?\n\}\r?\n/);
    assert.ok(m, 'the hold-stamp reader must still be a function this can extract by name');
    return m[0];
}

test('the hold-stamp read goes through the shared bounded reader', () => {
    // The hook runs this read after every covered tool return and must never
    // block, so the file's kind and size are settled on the descriptor the read
    // consumes rather than on its name: judging a name and then opening it
    // leaves a window a local process can swap the path inside, and a FIFO
    // planted in that window blocks the open forever. The guard is a property of
    // the channel rather than of the caller that first needed it, and it cannot
    // be exercised behaviourally on win32, which has no path-named FIFO, so what
    // holds the shape here is this pin over the reader's own source.
    //
    // The link refusal is the one property that reader gives only on request,
    // since it follows a link at the final component unless a caller opts in,
    // and this caller takes BOTH halves of it. The lstat is what keeps a link
    // distinguishable from an unreadable file: the option refuses with the same
    // null every other refusal answers with, and this reader's reasons drive
    // different repairs. The option is what closes the window between that lstat
    // and the open, which the lstat alone only narrows. What this forbids is the
    // kind coming back to the name: the lstat leg answers isSymbolicLink and
    // nothing else, and the size is never taken off it. The behavioural side of
    // the refusal is pinned in test/kit-compact-gate.test.js against a shimmed
    // lstat, and the reader's own two platform legs in test/kit-read-lib.test.js.
    const fn = readHoldNudgesSource();
    assert.match(fn, /readFileBounded\(target, HOLD_NUDGE_MAX_BYTES, \{ refuseLink: true \}\)/,
        'the read must go through the shared reader at the hold-stamp ceiling, asking for the refusal');
    assert.match(fn, /st\.isSymbolicLink\(\)/,
        'and must refuse a link at the final component before opening:\n' + fn);
    assert.ok(!/readFileSync/.test(fn),
        'nothing here may open the path a second time by name:\n' + fn);
    assert.ok(!/regularFileSize|isFile\(\)|\.size/.test(fn),
        'and the kind and the size must not be settled on the name before the open:\n' + fn);
});

test('the journal\'s event field is held to a closed vocabulary, as its sibling reason is', () => {
    // The field reaches the CLI's status report and an operator's terminal,
    // channels a model reads, and gateText bounds only the charset and the
    // length. Both callers pass a literal today, so this is drift prevention:
    // what it forbids is a third caller widening the field by passing a value
    // through, which is exactly what GATE_REASONS forbids for a decision's
    // reason one function away.
    const src = fs.readFileSync(COMPACT_LIB_SRC, 'utf8');
    assert.match(src, /const NUDGE_EVENTS = \['nudge', 'nudge-hold'\];/,
        'the vocabulary must be spelled as a closed list');
    assert.match(src, /event: NUDGE_EVENTS\.includes\(event\) \? event : 'nudge',/,
        'and the record must be built by checking membership against it');
    assert.ok(!/event: gateText\(event\)/.test(src),
        'a caller-supplied event must not reach the record through gateText alone');
});

// The reason literals the gate writes on its interactive deny, read out of the
// gate's own source: every string in the statement that carries the verdict,
// less the verdict itself. Extracting from the statement rather than matching a
// list of names is what lets this speak about a reason nobody here named.
function gateInteractiveReasons(source) {
    const stmts = source.match(/decide\(\{[^{}]*verdict: 'deny-interactive'[^{}]*\}\)/g) || [];
    const reasons = new Set();
    for (const stmt of stmts) {
        for (const m of stmt.matchAll(/'([^']*)'/g)) {
            if (m[1] !== 'deny-interactive') reasons.add(m[1]);
        }
    }
    return [...reasons].sort();
}

test('the hold reasons the library filters on are the ones the gate writes', () => {
    // A writer and a reader filtering on the same pair, spelled in two files: the
    // gate composes the reason on its interactive deny, and the library's
    // interactiveHoldOpen admits a record only when the reason is in its own
    // list. Each side tested against its own literal is how a third reason added
    // at the gate kills the directive with both suites green.
    const { INTERACTIVE_HOLD_REASONS } =
        require('../plugins/claude-kit/hooks/kit-compact-lib.js');
    const written = gateInteractiveReasons(fs.readFileSync(GATE_SRC, 'utf8'));
    assert.ok(written.length > 0,
        'the gate must still compose its interactive deny reason from literals this can read; '
        + 'a reason built elsewhere needs this pin re-pointed rather than deleted');
    assert.deepStrictEqual(written, [...INTERACTIVE_HOLD_REASONS].sort(),
        'every reason the gate writes on an interactive deny must be one the hold path admits');

    // The control, on a synthetic statement of the same shape carrying a reason
    // no literal in this file names to the extractor: it is found by the shape
    // of the statement, so a third reason added at the gate would be too.
    assert.deepStrictEqual(
        gateInteractiveReasons(
            "    return decide({ verdict: 'deny-interactive', reason: pick ? 'quarantined' : 'no-goal',"
            + ' consumed });'),
        ['no-goal', 'quarantined'],
        'the extractor reads the statement rather than a list of known names');
});
