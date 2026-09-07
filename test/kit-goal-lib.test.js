// Unit tests for plugins/claude-kit/hooks/kit-goal-lib.js.
//
// Node's built-in test runner, no framework, no install (Node v24). Each test
// builds a fresh temp directory under os.tmpdir() as a fake repo cwd, writes
// whatever plan fixture it needs, runs the lib against it, and cleans up in a
// finally block regardless of pass/fail. The event-stream cases additionally
// point KIT_EVENTS_PATH inside that temp dir, alongside KIT_EVENTS_PATH_ALLOW=1
// (the override is honored only with that signal set), and restore both
// variables afterward, so no in-process case falls back to and appends at the
// real ~/.claude/kit-events.jsonl. The gate and the ungated-fallback direction
// are pinned in spawned children instead (see gateSpawnEnv below), because the
// once-per-process stderr-note flag lives at module scope and a second
// in-process case would see it already tripped.

'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    goalPath,
    readGoal,
    armGoal,
    appendGoal,
    advanceGoal,
    bindSession,
    clearGoal,
    composeCondition,
    planHead,
    planStatusReadings,
    classifyPlanStatus,
    emitGoalEvent,
    lastActivePhrase,
    safeForAuthorization,
    queuePosition,
    sessionHoldsLeash
} = require('../plugins/claude-kit/hooks/kit-goal-lib.js');

const CLI = path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'kit-goal.js');

// Scrub the run-scoped variables for the file's whole run. This suite runs
// inside fleet workers too, where the engine sets KIT_RUN_ID, and an inherited
// value would attach a `run` field to every event the in-process schema tests
// below emit, breaking their exact Object.keys assertions. CLAUDE_CODE_SESSION_ID
// is scrubbed for the same reason one step further on: the suite runs inside a
// Claude Code session shell, which sets it, and the CLI binds an arm to that
// value, so an inherited one would bind every spawned arm the cases below
// expect unbound. The cases that need it set pass it explicitly in the child's
// environment. Restored once at the end so a later test file in the same
// process (there is none today, but node's runner can share a process across
// files) sees the ambient value it started with.
const priorRunEnv = {
    KIT_RUN_ID: process.env.KIT_RUN_ID,
    KIT_SPAWN_VECTOR: process.env.KIT_SPAWN_VECTOR,
    KIT_RUN_SECTION: process.env.KIT_RUN_SECTION,
    CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID
};
delete process.env.KIT_RUN_ID;
delete process.env.KIT_SPAWN_VECTOR;
delete process.env.KIT_RUN_SECTION;
delete process.env.CLAUDE_CODE_SESSION_ID;
after(() => {
    for (const key of Object.keys(priorRunEnv)) {
        if (priorRunEnv[key] === undefined) delete process.env[key];
        else process.env[key] = priorRunEnv[key];
    }
});

// Fresh temp dir per test, acting as a fake repo root.
function makeRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-goal-test-'));
    return dir;
}

function rmRepo(dir) {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        // Best-effort cleanup; leaving a temp dir behind never fails the test.
    }
}

function writePlan(repo, relPath, contents) {
    const full = path.join(repo, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf8');
}

// The names of any atomic-write temp files left behind in the repo's .kit/, or
// null when the directory could not be read at all. The tmp name carries a
// random suffix, so no test can name the file it expects to be absent; what a
// test can still assert is that the directory holds none of them, which is the
// property that matters (an orphan accumulating in .kit/). The null is what
// keeps "no leftovers" apart from "could not look": every caller compares
// against [], so a directory that cannot be read fails the assertion instead of
// reading as clean.
function tmpLeftovers(repo) {
    const prefix = path.basename(goalPath(repo)) + '.tmp.';
    try {
        return fs.readdirSync(path.dirname(goalPath(repo))).filter((name) => name.startsWith(prefix));
    } catch {
        return null;
    }
}

// The temp path writeState will use for its next write in this process, made
// predictable by pinning crypto.randomBytes for the duration of fn. The
// production name is deliberately unguessable, which is exactly what puts the
// exclusive-create flag's behavior out of a test's reach; pinning the one source
// of that unpredictability is what lets a case pre-plant something at the path
// the write is about to create. The library and this file share the one crypto
// module object, so the patch reaches the library's call.
function withPinnedTmpPath(repo, fn) {
    const crypto = require('crypto');
    const realRandomBytes = crypto.randomBytes;
    const suffix = 'aabbccddeeff';
    crypto.randomBytes = () => Buffer.from(suffix, 'hex');
    try {
        return fn(goalPath(repo) + '.tmp.' + process.pid + '.' + suffix);
    } finally {
        crypto.randomBytes = realRandomBytes;
    }
}

test('armGoal success writes goal-state.json with the exact schema', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n\nsome content\n');
        const result = armGoal(repo, 'docs/plans/foo.md');
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.plan, 'docs/plans/foo.md');

        const state = readGoal(repo);
        assert.ok(state, 'goal state should be readable after arming');
        assert.deepStrictEqual(Object.keys(state).sort(),
            ['armedAt', 'armedBy', 'armingSession', 'authorizations', 'boundSession', 'boundTranscript',
                'condition', 'history', 'plan', 'queue', 'queueIndex']);
        assert.strictEqual(state.plan, 'docs/plans/foo.md');
        assert.strictEqual(state.boundSession, null, 'an arm carrying no bind is unbound');
        assert.strictEqual(state.boundTranscript, null,
            'with no bind to corroborate, the transcript is recorded at claim time instead');
        assert.deepStrictEqual(state.queue, ['docs/plans/foo.md'], 'one plan is a queue of one');
        assert.strictEqual(state.queueIndex, 0);
        assert.deepStrictEqual(state.history, []);
        // Spread into a plain object to compare the entries: the map itself
        // carries no prototype, which deepStrictEqual counts as a difference
        // from a literal, and the absent prototype has its own case below.
        assert.deepStrictEqual({ ...state.authorizations }, { 'docs/plans/foo.md': null },
            'a plan carrying no Dispatch Authorization section records the none marker, one entry per armed plan');
        assert.ok(!state.plan.includes('\\'), 'plan path must be forward-slash');
        // The stored condition is whatever composeCondition produces, so the
        // clause text is pinned in one place (its own test) rather than twice.
        assert.strictEqual(state.condition, composeCondition('docs/plans/foo.md'));
        assert.ok(!Number.isNaN(Date.parse(state.armedAt)), 'armedAt should be a valid ISO timestamp');
    } finally {
        rmRepo(repo);
    }
});

test('armGoal writes atomically: no leftover temp file after success', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        const result = armGoal(repo, 'docs/plans/foo.md');
        assert.strictEqual(result.ok, true);
        assert.ok(fs.existsSync(goalPath(repo)));
        // The tmp name is unpredictable by design, so the check reads the
        // directory rather than naming the file it expects to be gone.
        assert.deepStrictEqual(tmpLeftovers(repo), []);
    } finally {
        rmRepo(repo);
    }
});

test('armGoal rejects a missing plan file', () => {
    const repo = makeRepo();
    try {
        const result = armGoal(repo, 'docs/plans/does-not-exist.md');
        assert.strictEqual(result.ok, false);
        assert.match(result.reason, /not found/i);
        assert.ok(!fs.existsSync(goalPath(repo)), 'no state file should be written on rejection');
    } finally {
        rmRepo(repo);
    }
});

test('armGoal names an unusable plan path rather than calling it missing', () => {
    const repo = makeRepo();
    try {
        // planHead answers the same 'no' for an absent path and for one holding
        // something no reader can open, so the arm has to ask the kind question
        // itself. 'plan not found' about a path that plainly exists sends the
        // operator looking for a file that is right where they left it.
        fs.mkdirSync(path.join(repo, 'docs', 'plans', 'foo.md'), { recursive: true });
        const result = armGoal(repo, 'docs/plans/foo.md');
        assert.strictEqual(result.ok, false, 'a directory is not a plan doc');
        assert.ok(/does not hold a plan file/.test(result.reason),
            'the reason names what is wrong: ' + result.reason);
        assert.ok(!/not found/.test(result.reason),
            'and does not claim the path is missing: ' + result.reason);
        assert.ok(result.reason.includes('docs/plans/foo.md'),
            'and names the path: ' + result.reason);

        // The absent case keeps its own wording, which is the leg this must not
        // break.
        const missing = armGoal(repo, 'docs/plans/absent.md');
        assert.strictEqual(missing.ok, false);
        assert.ok(/plan not found/.test(missing.reason), missing.reason);
    } finally {
        rmRepo(repo);
    }
});

test('armGoal tells a locked plan doc apart from one that is missing or is not a plan file', () => {
    // The third leg of the same question. An antivirus or an indexer holding an
    // ordinary plan doc makes the lstat fail without saying anything about the
    // path's kind, and reporting that as 'does not hold a plan file' sends the
    // operator to fix a file that is perfectly fine and readable a second later.
    const repo = makeRepo();
    const realLstatSync = fs.lstatSync;
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        const full = path.join(repo, 'docs', 'plans', 'foo.md');
        fs.lstatSync = function (target) {
            if (String(target) === full) {
                const err = new Error('EBUSY: resource busy or locked, lstat');
                err.code = 'EBUSY';
                throw err;
            }
            return realLstatSync.apply(fs, arguments);
        };
        const result = armGoal(repo, 'docs/plans/foo.md');
        fs.lstatSync = realLstatSync;
        assert.strictEqual(result.ok, false, 'a plan doc that cannot be read is not armed');
        assert.ok(/could not be read right now/.test(result.reason),
            'the refusal names the transient state: ' + result.reason);
        assert.ok(!/does not hold a plan file/.test(result.reason),
            'and does not blame the path kind: ' + result.reason);
        assert.ok(!/not found/.test(result.reason),
            'nor call a file that is right there missing: ' + result.reason);
    } finally {
        fs.lstatSync = realLstatSync;
        rmRepo(repo);
    }
});

for (const code of ['ENOTDIR', 'ENAMETOOLONG']) {
    test('armGoal reports a ' + code + ' plan path as determinate, not as something to retry', () => {
        // The other two legs of one classification. A regular file standing
        // where a parent directory belongs (ENOTDIR) and a path no filesystem
        // call accepts (ENAMETOOLONG) are as settled as a directory sitting at
        // the path: no lock produces either and waiting resolves neither, so
        // telling the operator to try again names a condition that never lifts.
        const repo = makeRepo();
        const realLstatSync = fs.lstatSync;
        try {
            writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
            const full = path.join(repo, 'docs', 'plans', 'foo.md');
            fs.lstatSync = function (target) {
                if (String(target) === full) {
                    const err = new Error(code + ': staged by the fixture, lstat');
                    err.code = code;
                    throw err;
                }
                return realLstatSync.apply(fs, arguments);
            };
            const result = armGoal(repo, 'docs/plans/foo.md');
            fs.lstatSync = realLstatSync;
            assert.strictEqual(result.ok, false, code + ' is not armable');
            assert.ok(/does not hold a plan file/.test(result.reason),
                'the refusal names the determinate state: ' + result.reason);
            assert.ok(!/could not be read right now/.test(result.reason),
                'and does not invite a retry that can never work: ' + result.reason);
        } finally {
            fs.lstatSync = realLstatSync;
            rmRepo(repo);
        }
    });
}

// Stage a symlink at an existing regular file's path by making lstat report one
// over it. fs.symlinkSync refuses a file link on this box with EPERM (a
// junction, the directory case, is creatable and is staged for real below), so
// this is what puts the link kind in front of the readers. realpathSync is left
// real unless a case shims it: over an ordinary file it resolves to that file,
// which is what a link to an in-repo plan doc looks like once resolved.
// Returns the restore function.
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

// Point a staged link's resolution somewhere else: at another real path, or at a
// throw for a link that dangles. Returns the restore function.
function resolveLinkTo(full, resolved) {
    const realRealpathSync = fs.realpathSync;
    fs.realpathSync = function (target) {
        if (String(target) === full) {
            if (resolved === null) {
                const err = new Error('ENOENT: staged by the fixture, realpath');
                err.code = 'ENOENT';
                throw err;
            }
            return resolved;
        }
        return realRealpathSync.apply(fs, arguments);
    };
    return () => { fs.realpathSync = realRealpathSync; };
}

test('a plan doc reached through a link inside the repo arms and reads its Status', () => {
    // The one non-regular kind that is genuinely readable. Refusing it leaves a
    // checkout that links a plan doc unable to arm at all, and a goal already
    // armed over such a path holding every stop for the life of the run.
    const repo = makeRepo();
    let restore = () => {};
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n\nbody\n');
        const full = path.join(repo, 'docs', 'plans', 'foo.md');
        restore = reportAsLink(full);
        const head = planHead(repo, 'docs/plans/foo.md');
        const armed = armGoal(repo, 'docs/plans/foo.md');
        restore();
        assert.deepStrictEqual(head, { exists: true, status: 'in progress' },
            'the linked plan doc is read, Status header included');
        assert.strictEqual(armed.ok, true, 'and it arms: ' + armed.reason);
    } finally {
        restore();
        rmRepo(repo);
    }
});

test('a plan-path link resolving outside the repo is refused', () => {
    // The containment rule normalizePlanArg applies to a plan argument, applied
    // to what the link actually resolves to. The target is a real, readable,
    // regular file, so containment is the only thing refusing it: without that
    // leg the case would arm.
    const repo = makeRepo();
    const outside = makeRepo();
    let restoreLstat = () => {};
    let restoreReal = () => {};
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        writePlan(outside, 'elsewhere.md', 'Status: In Progress\n');
        const full = path.join(repo, 'docs', 'plans', 'foo.md');
        restoreLstat = reportAsLink(full);
        restoreReal = resolveLinkTo(full, path.join(outside, 'elsewhere.md'));
        const head = planHead(repo, 'docs/plans/foo.md');
        const armed = armGoal(repo, 'docs/plans/foo.md');
        restoreLstat();
        restoreReal();
        assert.strictEqual(head.exists, false, 'a link out of the repo is not a plan doc');
        assert.strictEqual(armed.ok, false, 'and it does not arm');
        assert.ok(/does not hold a plan file/.test(armed.reason), armed.reason);
    } finally {
        restoreLstat();
        restoreReal();
        rmRepo(repo);
        rmRepo(outside);
    }
});

test('a plan-path link that dangles is refused', () => {
    const repo = makeRepo();
    let restoreLstat = () => {};
    let restoreReal = () => {};
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        const full = path.join(repo, 'docs', 'plans', 'foo.md');
        restoreLstat = reportAsLink(full);
        restoreReal = resolveLinkTo(full, null);
        const head = planHead(repo, 'docs/plans/foo.md');
        const armed = armGoal(repo, 'docs/plans/foo.md');
        restoreLstat();
        restoreReal();
        assert.strictEqual(head.exists, false, 'a link resolving to nothing is not a plan doc');
        assert.strictEqual(armed.ok, false, 'and it does not arm');
        assert.ok(/does not hold a plan file/.test(armed.reason), armed.reason);
    } finally {
        restoreLstat();
        restoreReal();
        rmRepo(repo);
    }
});

test('a directory junction at the plan path is still refused', () => {
    // The kinds the refusal was written for keep it. A junction is the link kind
    // this box creates without privilege, so this one is staged for real rather
    // than reported; it resolves to a directory, which no reader can open as a
    // plan doc.
    const repo = makeRepo();
    try {
        const target = path.join(repo, 'link-target');
        fs.mkdirSync(target, { recursive: true });
        fs.mkdirSync(path.join(repo, 'docs', 'plans'), { recursive: true });
        fs.symlinkSync(target, path.join(repo, 'docs', 'plans', 'foo.md'), 'junction');
        assert.strictEqual(planHead(repo, 'docs/plans/foo.md').exists, false,
            'a junction resolves to a directory, which is not a plan doc');
        const armed = armGoal(repo, 'docs/plans/foo.md');
        assert.strictEqual(armed.ok, false, 'and it does not arm');
        assert.ok(/does not hold a plan file/.test(armed.reason), armed.reason);
    } finally {
        rmRepo(repo);
    }
});

test('clearGoal treats a goal-state path that can never resolve as nothing armed', () => {
    // The same three-way classification armGoal takes, at the writer's own
    // question. A determinate errno means nothing is at the path and nothing can
    // be, so there is no release to report and no lock to wait out; only an
    // unknown answer (a lock, a permission) is a failed clear, because that is
    // the one where the file may be sitting there still.
    const repo = makeRepo();
    const realLstatSync = fs.lstatSync;
    try {
        fs.lstatSync = function (target) {
            if (String(target).endsWith('goal-state.json')) {
                const err = new Error('ENOTDIR: staged by the fixture, lstat');
                err.code = 'ENOTDIR';
                throw err;
            }
            return realLstatSync.apply(fs, arguments);
        };
        const result = clearGoal(repo);
        fs.lstatSync = realLstatSync;
        assert.deepStrictEqual(result, { ok: true, cleared: false },
            'nothing is armed, and nothing failed');
    } finally {
        fs.lstatSync = realLstatSync;
        rmRepo(repo);
    }
});

test('the goal CLI names an oversized goal-state file instead of reporting plain absence', () => {
    // Every reader refuses a state file past the bound, so status and clear both
    // report no goal armed over one. Saying only that describes a file that is
    // sitting right there, that a hand wrote, as absence.
    const repo = makeRepo();
    try {
        fs.mkdirSync(path.dirname(goalPath(repo)), { recursive: true });
        fs.writeFileSync(goalPath(repo), JSON.stringify({ pad: 'x'.repeat(70 * 1024) }), 'utf8');
        const res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(res.status, 0);
        assert.ok(res.stdout.includes('no kit goal armed'), res.stdout);
        assert.ok(res.stdout.includes('past the 65536-byte bound'),
            'status names the bound the file is past: ' + res.stdout);
    } finally {
        rmRepo(repo);
    }
});

test('the goal CLI names a non-goal file at the goal-state path instead of reporting plain absence', () => {
    // clear and status both answer 'nothing armed' for a path no reader reads as
    // a goal, which is right about the leash and silent about the thing sitting
    // there that a later arm will fail on with a raw rename errno. A junction is
    // the link kind this box creates without privilege; a file symlink needs one
    // it lacks, so that kind stays unproven.
    const repo = makeRepo();
    try {
        const target = path.join(repo, 'link-target');
        fs.mkdirSync(target, { recursive: true });
        fs.mkdirSync(path.dirname(goalPath(repo)), { recursive: true });
        fs.symlinkSync(target, goalPath(repo), 'junction');

        const status = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(status.status, 0);
        assert.ok(status.stdout.includes('no kit goal armed'), status.stdout);
        assert.ok(status.stdout.includes('is at .kit/goal-state.json'),
            'status names what is at the path: ' + status.stdout);

        const cleared = spawnSync(process.execPath, [CLI, 'clear'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(cleared.status, 0);
        assert.ok(cleared.stdout.includes('no kit goal was armed'), cleared.stdout);
        assert.ok(cleared.stdout.includes('moved aside by hand'),
            'and clear names a remedy that works: ' + cleared.stdout);
        assert.ok(fs.lstatSync(goalPath(repo)).isSymbolicLink(), 'neither command touched it');
    } finally {
        rmRepo(repo);
    }
});

test('the goal CLI does not claim the leash is armed when a failed clear could not prove it', () => {
    // The lstat leg fires with existence unproven, and while a lock stands every
    // reader treats the leash as absent, so it is not enforcing either. The
    // conservative half is the exit code and the refusal to report a release;
    // asserting that the goal is still armed is a certainty this leg does not
    // have.
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        assert.strictEqual(armGoal(repo, 'docs/plans/foo.md').ok, true, 'setup: a real goal state');
        const shim = path.join(repo, 'lock-goal-state.js');
        fs.writeFileSync(shim, [
            "'use strict';",
            "const fs = require('fs');",
            'const realLstatSync = fs.lstatSync;',
            'fs.lstatSync = function (target) {',
            "    if (String(target).endsWith('goal-state.json')) {",
            "        const err = new Error('EBUSY: resource busy or locked, lstat');",
            "        err.code = 'EBUSY';",
            '        throw err;',
            '    }',
            '    return realLstatSync.apply(fs, arguments);',
            '};'
        ].join('\n') + '\n', 'utf8');
        const res = spawnSync(process.execPath, [CLI, 'clear'], {
            cwd: repo,
            encoding: 'utf8',
            env: { ...process.env, NODE_OPTIONS: '--require "' + shim.replace(/\\/g, '/') + '"' }
        });
        assert.strictEqual(res.status, 1, 'a clear that released nothing exits nonzero');
        assert.ok(res.stderr.includes('could not clear'), res.stderr);
        assert.ok(res.stderr.includes('nothing was released'),
            'the message states what is known: ' + res.stderr);
        assert.ok(!res.stderr.includes('still armed'),
            'and not what it could not check: ' + res.stderr);
        assert.ok(fs.existsSync(goalPath(repo)), 'the file is untouched');
    } finally {
        rmRepo(repo);
    }
});

test('armGoal rejects a plan whose header is Status: Complete', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/done.md', 'Status: Complete\n\nfinished\n');
        const result = armGoal(repo, 'docs/plans/done.md');
        assert.strictEqual(result.ok, false);
        assert.match(result.reason, /Complete/);
        assert.ok(!fs.existsSync(goalPath(repo)), 'no state file should be written on rejection');
    } finally {
        rmRepo(repo);
    }
});

test('armGoal accepts a plan whose header is Status: In Progress', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/wip.md', 'Status: In Progress\n\nworking\n');
        const result = armGoal(repo, 'docs/plans/wip.md');
        assert.strictEqual(result.ok, true);
        assert.ok(fs.existsSync(goalPath(repo)));
    } finally {
        rmRepo(repo);
    }
});

test('armGoal rejects a relative path that escapes the repo', () => {
    const repo = makeRepo();
    try {
        const result = armGoal(repo, '../outside.md');
        assert.strictEqual(result.ok, false);
        assert.match(result.reason, /outside the repo/i);
        assert.ok(!fs.existsSync(goalPath(repo)));
    } finally {
        rmRepo(repo);
    }
});

test('armGoal rejects an absolute path outside the repo', () => {
    const repo = makeRepo();
    const other = makeRepo();
    try {
        writePlan(other, 'plan.md', 'Status: In Progress\n');
        const result = armGoal(repo, path.join(other, 'plan.md'));
        assert.strictEqual(result.ok, false);
        assert.match(result.reason, /outside the repo/i);
        assert.ok(!fs.existsSync(goalPath(repo)));
    } finally {
        rmRepo(repo);
        rmRepo(other);
    }
});

test('armGoal accepts an absolute path under cwd and re-relativizes it', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/abs.md', 'Status: In Progress\n');
        const absPath = path.join(repo, 'docs', 'plans', 'abs.md');
        const result = armGoal(repo, absPath);
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.plan, 'docs/plans/abs.md');
        const state = readGoal(repo);
        assert.strictEqual(state.plan, 'docs/plans/abs.md');
    } finally {
        rmRepo(repo);
    }
});

test('readGoal returns null when absent, the object when present, null on corrupt JSON', () => {
    const repo = makeRepo();
    try {
        assert.strictEqual(readGoal(repo), null);

        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        armGoal(repo, 'docs/plans/foo.md');
        const state = readGoal(repo);
        assert.ok(state);
        assert.strictEqual(state.plan, 'docs/plans/foo.md');

        fs.writeFileSync(goalPath(repo), '{ not valid json', 'utf8');
        assert.strictEqual(readGoal(repo), null);
    } finally {
        rmRepo(repo);
    }
});

test('clearGoal removes the file and is a no-op when absent', () => {
    const repo = makeRepo();
    try {
        assert.deepStrictEqual(clearGoal(repo), { ok: true, cleared: false });

        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        armGoal(repo, 'docs/plans/foo.md');
        assert.ok(fs.existsSync(goalPath(repo)));

        assert.deepStrictEqual(clearGoal(repo), { ok: true, cleared: true });
        assert.ok(!fs.existsSync(goalPath(repo)));

        assert.deepStrictEqual(clearGoal(repo), { ok: true, cleared: false });
    } finally {
        rmRepo(repo);
    }
});

test('clearGoal reports a failed delete as ok:false, never as "nothing was armed"', () => {
    // A delete the OS declines (a permission, a lock) on a goal state that is
    // really there. The caller must be able to distinguish "still armed and
    // enforcing" from "nothing to clear". The refusal is staged on the syscall
    // because no portable fixture makes a real one here, and because the kind of
    // thing at the path is now a separate question (see the case below).
    const repo = makeRepo();
    const realUnlinkSync = fs.unlinkSync;
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        assert.strictEqual(armGoal(repo, 'docs/plans/foo.md').ok, true, 'setup: a real goal state');
        fs.unlinkSync = function () {
            const err = new Error('EPERM: operation not permitted, unlink');
            err.code = 'EPERM';
            throw err;
        };
        const result = clearGoal(repo);
        fs.unlinkSync = realUnlinkSync;
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.cleared, false);
        assert.ok(result.reason && result.reason.includes('could not clear'));
        assert.ok(fs.existsSync(goalPath(repo)), 'and the goal is still armed');
    } finally {
        fs.unlinkSync = realUnlinkSync;
        rmRepo(repo);
    }
});

test('a close that fails after a good write is a failed write, not a silent success', () => {
    // The close is where an OS reports a write it deferred: a network volume, a
    // quota. Swallowing it unconditionally publishes the rename over a file
    // whose bytes may never have landed, and returns ok:true, so the CLI prints
    // 'kit goal armed' over a torn state every reader will then read as truth.
    // Only a close reached with an error already in flight is swallowed, which
    // the case below pins.
    const repo = makeRepo();
    const realCloseSync = fs.closeSync;
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        let closed = 0;
        fs.closeSync = function (fd) {
            closed += 1;
            realCloseSync.call(fs, fd);
            const err = new Error('EIO: i/o error, close');
            err.code = 'EIO';
            throw err;
        };
        const result = armGoal(repo, 'docs/plans/foo.md');
        fs.closeSync = realCloseSync;
        assert.ok(closed > 0, 'setup: the write reached its close');
        assert.strictEqual(result.ok, false, 'a write whose close failed is not a write that succeeded');
        assert.ok(/EIO/.test(result.reason), 'and the reason names it: ' + result.reason);
        assert.ok(!fs.existsSync(goalPath(repo)), 'nothing is published');
        assert.deepStrictEqual(tmpLeftovers(repo), [], 'and the temp is cleaned up');
    } finally {
        fs.closeSync = realCloseSync;
        rmRepo(repo);
    }
});

test('a write failure survives a close that throws on the way out', () => {
    // The close sits in a finally that runs while the write's error is in
    // flight. Unguarded, a throwing close replaces that error, so the caller is
    // told the descriptor could not be closed rather than that the disk is full,
    // and the cause is gone from the reason the operator reads.
    const repo = makeRepo();
    const realWriteFileSync = fs.writeFileSync;
    const realCloseSync = fs.closeSync;
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        fs.writeFileSync = function (target) {
            if (typeof target === 'number') {
                const err = new Error('ENOSPC: no space left on device, write');
                err.code = 'ENOSPC';
                throw err;
            }
            return realWriteFileSync.apply(fs, arguments);
        };
        fs.closeSync = function () {
            const err = new Error('EIO: i/o error, close');
            err.code = 'EIO';
            throw err;
        };
        const result = armGoal(repo, 'docs/plans/foo.md');
        fs.writeFileSync = realWriteFileSync;
        fs.closeSync = realCloseSync;
        assert.strictEqual(result.ok, false);
        assert.ok(/ENOSPC/.test(result.reason),
            'the reason names the failure that caused this: ' + result.reason);
        assert.ok(!/EIO/.test(result.reason),
            'and not the close that ran on the way out: ' + result.reason);
    } finally {
        fs.writeFileSync = realWriteFileSync;
        fs.closeSync = realCloseSync;
        rmRepo(repo);
    }
});

test('clearGoal reports a locked goal state as a failed clear, never as nothing armed', () => {
    // An lstat that fails for a reason other than ENOENT means the file is
    // there and its kind could not be read: on this platform an antivirus or an
    // indexer holding it reports EACCES or EBUSY. Answering 'nothing armed'
    // there makes the CLI print that no goal was armed and exit 0 while the
    // leash is still on disk, still armed, and still blocking every stop once
    // the lock lifts. The refusal is staged on the syscall because no portable
    // fixture makes a real one here.
    const repo = makeRepo();
    const realLstatSync = fs.lstatSync;
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        assert.strictEqual(armGoal(repo, 'docs/plans/foo.md').ok, true, 'setup: a real goal state');
        fs.lstatSync = function (target) {
            if (String(target) === goalPath(repo)) {
                const err = new Error('EACCES: permission denied, lstat');
                err.code = 'EACCES';
                throw err;
            }
            return realLstatSync.apply(fs, arguments);
        };
        const result = clearGoal(repo);
        fs.lstatSync = realLstatSync;
        assert.strictEqual(result.ok, false, 'a leash that could not be read is not a leash released');
        assert.strictEqual(result.cleared, false);
        assert.ok(result.reason && result.reason.includes('could not clear'), result.reason);
        assert.ok(fs.existsSync(goalPath(repo)), 'the file is still there');
        assert.ok(readGoal(repo) && readGoal(repo).plan === 'docs/plans/foo.md',
            'and every reader still reads it as armed');
    } finally {
        fs.lstatSync = realLstatSync;
        rmRepo(repo);
    }
});

test('clearGoal removes a zero-length goal state and reports it cleared', () => {
    // A zero-byte goal-state.json is a regular file: no reader can parse it, and
    // treating it as nothing armed leaves a file the CLI can never remove.
    const repo = makeRepo();
    try {
        fs.mkdirSync(path.dirname(goalPath(repo)), { recursive: true });
        fs.writeFileSync(goalPath(repo), '', 'utf8');
        const result = clearGoal(repo);
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.cleared, true, 'a file was removed, so the clear says so');
        assert.ok(!fs.existsSync(goalPath(repo)), 'and the file is gone');
    } finally {
        rmRepo(repo);
    }
});

test('a sweep passes over a link parked at a temp name rather than following or removing it', () => {
    // The sweep reclaims abandoned temp files by age, and everything it removes
    // it removes by path. A junction planted at a temp name is not an abandoned
    // write: unlinking it would delete a link the repository put there, and
    // following it would reach whatever it points at. The kind guard is what
    // stops both, and only the age gate was covered before.
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        const target = path.join(repo, 'link-target');
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, 'kept.txt'), 'kept\n', 'utf8');
        fs.mkdirSync(path.dirname(goalPath(repo)), { recursive: true });
        // A directory junction, the link kind this box creates without privilege;
        // a file symlink needs one it lacks, so that kind stays unproven here.
        const parked = goalPath(repo) + '.tmp.999999.deadbeefcafe';
        fs.symlinkSync(target, parked, 'junction');
        const old = Date.now() - 60 * 60 * 1000;
        fs.lutimesSync(parked, new Date(old), new Date(old));

        assert.strictEqual(armGoal(repo, 'docs/plans/foo.md').ok, true, 'the write sweeps as it goes');
        assert.ok(fs.lstatSync(parked).isSymbolicLink(), 'the parked link survives the sweep');
        assert.ok(fs.existsSync(path.join(target, 'kept.txt')), 'and what it points at is untouched');
    } finally {
        rmRepo(repo);
    }
});

test('clearGoal judges the goal-state path by the same kind rule every reader uses', () => {
    const repo = makeRepo();
    try {
        // fs.existsSync follows a link, so a clear built on it would report "kit
        // goal cleared" for a path readGoal reads as no goal at all. Both answer
        // "nothing armed" now, and the path is left as it was: there is no
        // release to report, and what sits there is not this function's to
        // delete.
        const target = path.join(repo, 'link-target');
        fs.mkdirSync(target, { recursive: true });
        fs.mkdirSync(path.dirname(goalPath(repo)), { recursive: true });
        fs.symlinkSync(target, goalPath(repo), 'junction');
        assert.strictEqual(readGoal(repo), null, 'setup: every reader sees no armed goal');

        const result = clearGoal(repo);
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.cleared, false, 'nothing was armed, so nothing was released');
        assert.ok(fs.lstatSync(goalPath(repo)).isSymbolicLink(), 'and the planted path is left where it is');
    } finally {
        rmRepo(repo);
    }
});

test('planHead classifies complete, in progress, unknown, and missing', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'complete.md', 'Status: Complete\n');
        assert.deepStrictEqual(planHead(repo, 'complete.md'), { exists: true, status: 'complete' });

        writePlan(repo, 'in-progress.md', 'Status: In Progress\n');
        assert.deepStrictEqual(planHead(repo, 'in-progress.md'), { exists: true, status: 'in progress' });

        writePlan(repo, 'unknown.md', 'Status: Approved\n');
        assert.deepStrictEqual(planHead(repo, 'unknown.md'), { exists: true, status: 'unknown' });

        const missing = planHead(repo, 'no-such-file.md');
        assert.strictEqual(missing.exists, false);
    } finally {
        rmRepo(repo);
    }
});

test('planHead does not classify a "Status:" header whose value sits on the next line', () => {
    const repo = makeRepo();
    try {
        // The value must sit on the header's own line: horizontal-whitespace-only
        // separation never crosses a newline. A bare "Status:" line above a line
        // beginning "complete" is 'unknown', not 'complete'; misclassifying it as
        // complete would auto-clear and silently kill an armed leash.
        writePlan(repo, 'docs/plans/split.md', '# Plan\nStatus:\ncomplete the migration next.\n');
        assert.deepStrictEqual(planHead(repo, 'docs/plans/split.md'), { exists: true, status: 'unknown' });
    } finally {
        rmRepo(repo);
    }
});

test('planHead classifies a header behind a UTF-8 BOM (PowerShell Set-Content writes one)', () => {
    const repo = makeRepo();
    try {
        // A leading BOM would push the ^ anchor off the header; it is stripped so
        // the classification still sees "Status: In Progress".
        const bom = String.fromCharCode(0xFEFF);
        writePlan(repo, 'docs/plans/bom.md', bom + 'Status: In Progress\n\nbody\n');
        assert.deepStrictEqual(planHead(repo, 'docs/plans/bom.md'), { exists: true, status: 'in progress' });
    } finally {
        rmRepo(repo);
    }
});

// Ready is the value for a plan that is authored and deliberately parked before
// any run starts. It classifies as its own token rather than falling through to
// 'unknown' so the recovery inventory can list such a plan without offering it
// the resume directive an In Progress plan gets.
test('classifyPlanStatus reads Ready as the whole value or the value plus a parenthetical', () => {
    assert.strictEqual(classifyPlanStatus('# Plan\n\nStatus: Ready\n'), 'ready');
    assert.strictEqual(classifyPlanStatus('# Plan\n\nstatus:   ready\n'), 'ready');
    assert.strictEqual(classifyPlanStatus('# Plan\n\nStatus: Ready (parked pending the design round)\n'), 'ready',
        'a parenthetical qualifies the value rather than replacing it');
    assert.strictEqual(classifyPlanStatus('Status: Ready\r\n'), 'ready',
        'a CRLF header reads the same as an LF one');
    assert.strictEqual(classifyPlanStatus('# Plan\n\nStatus: Ready'), 'ready',
        'a head window cut at the header still reads the value');

    // Ready is the one leg that is not a bare prefix match, because this word
    // has ordinary continuations that reverse what it claims. Every surface
    // that reads 'ready' asserts the plan is written and not started, which is
    // false of all three of these, and a plan they classified as parked would
    // draw no unarchived nag either, so it would sit unreported indefinitely.
    assert.strictEqual(classifyPlanStatus('Status: Ready for review\n'), 'unknown');
    assert.strictEqual(classifyPlanStatus('Status: Ready to merge\n'), 'unknown');
    assert.strictEqual(classifyPlanStatus('Status: Ready to archive\n'), 'unknown');

    // The three existing readings are untouched by the addition.
    assert.strictEqual(classifyPlanStatus('Status: Complete\n'), 'complete');
    assert.strictEqual(classifyPlanStatus('Status: Complete (archived)\n'), 'complete');
    assert.strictEqual(classifyPlanStatus('Status: In Progress\n'), 'in progress');
    assert.strictEqual(classifyPlanStatus('Status: Parked\n'), 'unknown');

    // The same anchoring the other legs take: the value must sit on the
    // header's own line, and the word in body prose is not a header.
    assert.strictEqual(classifyPlanStatus('Status:\nready once the review lands\n'), 'unknown');
    assert.strictEqual(classifyPlanStatus('Status: In Progress\n\n## Chapters\nReady for review.\n'), 'in progress');

    // A doc carrying a started value as well as Ready is a plan someone began:
    // the started reading wins, so a run in flight is never reported as parked.
    assert.strictEqual(classifyPlanStatus('Status: In Progress\nStatus: Ready\n'), 'in progress');
    assert.strictEqual(classifyPlanStatus('Status: Ready\nStatus: Complete\n'), 'complete');
});

// Pin, not a red: planReadsTerminal compares the whole value to 'complete', so
// a Ready header is non-terminal under the frozen contract however the loose
// classifier names it. The two readings stay apart here because a terminal
// reading of Ready would let a reporting surface count a plan nobody has
// started as finished work.
test('a Ready plan reads non-terminal under the frozen contract', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/parked.md', '# P\n\nStatus: Ready\n\n## Sections of Work\n');
        const readings = planStatusReadings(repo, 'docs/plans/parked.md');
        assert.strictEqual(readings.terminal, false, 'a parked plan is not a finished plan');
        assert.strictEqual(readings.status, 'ready');

        writePlan(repo, 'docs/plans/parked.md',
            '# P\n\nStatus: Ready (parked pending the design round)\n\n## Sections of Work\n');
        assert.strictEqual(planStatusReadings(repo, 'docs/plans/parked.md').terminal, false);
    } finally {
        rmRepo(repo);
    }
});

// A parked plan is a plan that may still be armed: Ready is a pre-arm value,
// and the only status arming refuses is complete.
test('armGoal accepts a plan whose header is Status: Ready', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/parked.md', '# P\n\nStatus: Ready\n\n## Sections of Work\n');
        assert.strictEqual(armGoal(repo, 'docs/plans/parked.md').ok, true);
        assert.strictEqual(readGoal(repo).plan, 'docs/plans/parked.md');
    } finally {
        rmRepo(repo);
    }
});

// Pins the canonical condition text exactly. composeCondition is the single
// source of that text and nothing parses it, so the only thing keeping it
// honest is this literal: a clause the Stop hook does not actually enforce
// would otherwise reach goal-state.json, and a human reading it would be
// promised a release that never comes. An exact compare is free here because
// the function is pure and deterministic, and it catches a reworded or
// re-added clause that an absence check on '(c)' would sail past.
test('composeCondition embeds the plan path, the parallelization request, and exactly clauses (a) and (b) plus the waiting pause', () => {
    assert.strictEqual(
        composeCondition('docs/plans/example.md'),
        'Work docs/plans/example.md to completion using executing-work. Arming is '
        + "Scott's request for this run: reduce wall-clock time by parallelizing "
        + 'work that can run simultaneously, via subagent dispatch and via '
        + 'Workflows. Met when (a) every section is complete and closed out, or '
        + '(b) you are BLOCKED on a decision only Scott can make and have said so. '
        + 'Capacity is never a blocker: auto-compaction rides through with the '
        + 'leash intact. Waiting on dispatched background work is a pause, not a '
        + "stop: lead with 'WAITING:' and what you await; the leash stays armed "
        + 'and the completion notification resumes the run.'
    );
});

// Pins the self-armed condition text exactly, with the operator-armed text
// above as its control: the two armings the kit sanctions carry different
// authority, and this text is the standing statement of why the run is held,
// written for whoever opens goal-state.json. The self spelling states one fact,
// what the arming invocation declared itself to be, and names no request of
// Scott's and no plan's authorization, neither of which the CLI can establish.
// An exact compare is free for the same reason the operator-armed pin above
// takes one: the function is pure, and nothing parses the text, so a literal is
// what keeps it honest.
test("composeCondition records a self-arming as this run's own, naming no request of Scott's", () => {
    const selfArmed = composeCondition('docs/plans/example.md', null, null, 'self');
    assert.strictEqual(
        selfArmed,
        'Work docs/plans/example.md to completion using executing-work. Arming is '
        + "recorded as this run's own rather than as a request Scott typed, as the "
        + 'arming invocation declared it. The kit-goal skill states what an arming '
        + 'carries; read it there rather than from this text. '
        + 'Met when (a) every section is complete and closed out, or '
        + '(b) you are BLOCKED on a decision only Scott can make and have said so. '
        + 'Capacity is never a blocker: auto-compaction rides through with the '
        + 'leash intact. Waiting on dispatched background work is a pause, not a '
        + "stop: lead with 'WAITING:' and what you await; the leash stays armed "
        + 'and the completion notification resumes the run.'
    );
    // The control, on the same fixture: the operator-armed spelling carries the
    // typed request, and neither spelling can pass on the other's assertion.
    const typed = composeCondition('docs/plans/example.md');
    assert.match(typed, /Scott's request for this run/);
    assert.doesNotMatch(selfArmed, /Scott's request for this run/);
    assert.doesNotMatch(selfArmed, /parallelizing/);
    // Nor does it claim anything about the plan's own authorization, which is a
    // separate fact with its own field: this text is composed from a caller's
    // declaration, and no plan doc was consulted to write it.
    assert.doesNotMatch(selfArmed, /authorization/i);
    // The vocabulary is two values, resolved before the text is composed: a
    // stored map entry through planArmedBy, a caller's argument through
    // armGoal, which refuses anything else rather than repairing it (its own
    // case below). An absent argument is the operator's arming, which is what a
    // state written before the map records for every plan in it.
    assert.strictEqual(composeCondition('docs/plans/example.md', null, null, 'operator'), typed);
    // The queue context is a property of the queue, not of the arming, so a
    // self-armed queue states what is still to come exactly as an operator's does.
    const queue = ['docs/plans/a.md', 'docs/plans/b.md'];
    assert.strictEqual(
        composeCondition('docs/plans/a.md', queue, 0, 'self')
            .slice(composeCondition('docs/plans/a.md', null, null, 'self').length),
        composeCondition('docs/plans/a.md', queue, 0).slice(composeCondition('docs/plans/a.md').length)
    );
});

// A plan doc carrying a Dispatch Authorization section. Nothing gates an arm
// on it: the arm records the sentence the scan read out of the doc, under
// authorizations, and records who ran the invocation separately, under
// armedBy. This fixture is what a test uses when it wants the first of those
// two to be a sentence rather than null.
function authorizedPlan(repo, rel) {
    writePlan(repo, rel, 'Status: In Progress\n\n## Dispatch Authorization\n\n'
        + 'Authorized 2026-08-29 by the operator for any session holding this plan.\n');
}

// The arming is a property of each plan's own invocation rather than of the
// queue, so it is recorded per plan: one queue can hold a plan the operator
// typed an arming for and a plan a run armed for itself, and each is worked
// under the condition its own arming composes.
test('armGoal records the arming per plan, and every recompose follows the plan it is about', () => {
    const repo = makeRepo();
    try {
        authorizedPlan(repo, 'docs/plans/a.md');
        authorizedPlan(repo, 'docs/plans/b.md');
        writePlan(repo, 'docs/plans/c.md', 'Status: In Progress\n');

        assert.strictEqual(armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md'], null, 'self').ok, true);
        let state = readGoal(repo);
        assert.deepStrictEqual({ ...state.armedBy },
            { 'docs/plans/a.md': 'self', 'docs/plans/b.md': 'self' },
            'every plan the invocation armed records that invocation\'s arming');
        assert.strictEqual(state.condition, composeCondition('docs/plans/a.md', state.queue, 0, 'self'));

        // An operator's append onto a self-armed queue: the appended plan records
        // the append's own arming and the queued plans keep theirs.
        assert.strictEqual(appendGoal(repo, ['docs/plans/c.md']).ok, true);
        state = readGoal(repo);
        assert.deepStrictEqual({ ...state.armedBy },
            { 'docs/plans/a.md': 'self', 'docs/plans/b.md': 'self', 'docs/plans/c.md': 'operator' });
        assert.strictEqual(state.condition, composeCondition('docs/plans/a.md', state.queue, 0, 'self'),
            'an append does not move the current plan, so its condition is the one it had');

        assert.strictEqual(advanceGoal(repo, { outcome: 'complete' }).ok, true);
        state = readGoal(repo);
        assert.strictEqual(state.condition, composeCondition('docs/plans/b.md', state.queue, 1, 'self'));
        assert.strictEqual(advanceGoal(repo, { outcome: 'complete' }).ok, true);
        state = readGoal(repo);
        assert.strictEqual(state.plan, 'docs/plans/c.md');
        assert.strictEqual(state.condition, composeCondition('docs/plans/c.md', state.queue, 2),
            'the leash advances onto a typed-armed plan and states that arming');
        assert.match(state.condition, /Scott's request for this run/);
    } finally {
        rmRepo(repo);
    }
});

// The mirror case, and each is the other's control: a self-armed append onto a
// queue the operator typed. The queue's own plans are untouched by it, and the
// leash states the self-arming only once it reaches the plan armed that way.
test('a self-armed append onto an operator-armed queue leaves the queue\'s own arming alone', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        authorizedPlan(repo, 'docs/plans/inbound.md');

        assert.strictEqual(armGoal(repo, 'docs/plans/a.md').ok, true);
        const appended = appendGoal(repo, ['docs/plans/inbound.md'], 'self');
        assert.strictEqual(appended.ok, true, appended.reason);
        assert.strictEqual(appended.arming, 'self',
            'the caller learns what the append recorded without restating the rule');

        let state = readGoal(repo);
        assert.deepStrictEqual({ ...state.armedBy },
            { 'docs/plans/a.md': 'operator', 'docs/plans/inbound.md': 'self' });
        assert.strictEqual(state.condition, composeCondition('docs/plans/a.md', state.queue, 0),
            'the plan in flight keeps the arming it was armed under');
        assert.match(state.condition, /Scott's request for this run/);

        assert.strictEqual(advanceGoal(repo, { outcome: 'complete' }).ok, true);
        state = readGoal(repo);
        assert.strictEqual(state.plan, 'docs/plans/inbound.md');
        assert.strictEqual(state.condition,
            composeCondition('docs/plans/inbound.md', state.queue, 1, 'self'));
        assert.doesNotMatch(state.condition, /Scott's request for this run/);
    } finally {
        rmRepo(repo);
    }
});

// Who armed a plan and what authorizes that plan are two facts, so a self-arming
// over a plan recording no authorization arms and reports it rather than
// refusing. The directed path is why: an unleashed run arming an inbound plan
// must name its own in-flight plan in the same invocation, and that plan carries
// no section of its own, so a refusal would leave the path with no correct
// spelling. Both plans record what is true of them, and the plan with a section
// is the control that keeps the list from being every plan the arm named.
test('a self-arming over a plan recording no authorization arms it and reports the plan', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/bare.md', 'Status: In Progress\n');
        authorizedPlan(repo, 'docs/plans/authorized.md');

        const armed = armGoal(repo, ['docs/plans/authorized.md', 'docs/plans/bare.md'], null, 'self');
        assert.strictEqual(armed.ok, true);
        assert.deepStrictEqual(armed.unauthorized, ['docs/plans/bare.md'],
            'the plan with a section to read is not in the list');
        const state = readGoal(repo);
        assert.deepStrictEqual({ ...state.armedBy },
            { 'docs/plans/authorized.md': 'self', 'docs/plans/bare.md': 'self' },
            'both plans record the arming this invocation declared');
        assert.strictEqual(state.authorizations['docs/plans/bare.md'], null,
            'and the plan doc that records nothing still records nothing');

        // The control: the same two plans, the operator's arming, and no plan is
        // reported at all, so the list follows the arming rather than the docs.
        const typed = armGoal(repo, ['docs/plans/authorized.md', 'docs/plans/bare.md']);
        assert.strictEqual(typed.ok, true);
        assert.deepStrictEqual(typed.unauthorized, []);

        // The append answers the same way over the plans it adds.
        assert.strictEqual(armGoal(repo, 'docs/plans/authorized.md', null, 'self').ok, true);
        const appended = appendGoal(repo, ['docs/plans/bare.md'], 'self');
        assert.strictEqual(appended.ok, true);
        assert.deepStrictEqual(appended.unauthorized, ['docs/plans/bare.md']);
        assert.deepStrictEqual(readGoal(repo).queue, ['docs/plans/authorized.md', 'docs/plans/bare.md']);
    } finally {
        rmRepo(repo);
    }
});

// An armedBy argument is a live claim from a caller, not a stored value, so an
// unrecognized one refuses rather than repairing to 'operator': a repaired typo
// would record an arming nobody made, which is the harm the field exists to
// prevent. 'operator' and an absent argument are the control. The list holds the
// near misses a caller reaches for, spellings that read like the field's own
// vocabulary without being it, since those are the values a lenient repair
// would swallow most quietly.
test('an unrecognized armedBy argument refuses the arm and the append, writing nothing', () => {
    const repo = makeRepo();
    try {
        authorizedPlan(repo, 'docs/plans/a.md');
        authorizedPlan(repo, 'docs/plans/b.md');

        for (const bogus of ['granted', 'grant', 'Self', 'SELF', true, 1, {}]) {
            const refused = armGoal(repo, 'docs/plans/a.md', null, bogus);
            assert.strictEqual(refused.ok, false, 'refuses ' + String(bogus));
            assert.match(refused.reason, /armedBy must be self or operator/);
        }
        assert.strictEqual(readGoal(repo), null, 'no refused arm wrote a state');

        // A value with no primitive conversion at all. The refusal names its type
        // rather than quoting it, because quoting means String(), which throws on
        // exactly these values, and every exported function of this module answers
        // rather than throws.
        for (const opaque of [Object.create(null), { toString: null }]) {
            const refused = armGoal(repo, 'docs/plans/a.md', null, opaque);
            assert.strictEqual(refused.ok, false);
            assert.match(refused.reason,
                /armedBy must be self or operator: an unprintable object/);
        }
        assert.strictEqual(readGoal(repo), null, 'and neither wrote one');

        assert.strictEqual(armGoal(repo, 'docs/plans/a.md', null, 'operator').ok, true);
        assert.strictEqual(readGoal(repo).armedBy['docs/plans/a.md'], 'operator');
        assert.strictEqual(armGoal(repo, 'docs/plans/a.md').ok, true, 'and an absent argument is the same arming');
        assert.strictEqual(readGoal(repo).armedBy['docs/plans/a.md'], 'operator');

        const appendRefused = appendGoal(repo, ['docs/plans/b.md'], 'Self');
        assert.strictEqual(appendRefused.ok, false);
        assert.match(appendRefused.reason, /armedBy must be self or operator/);
        assert.deepStrictEqual(readGoal(repo).queue, ['docs/plans/a.md']);
    } finally {
        rmRepo(repo);
    }
});

// The map answers to the repair every other normalized field gets, and the
// direction of the repair is what matters: a damaged file can lose a recorded
// self-arming, and can never invent one.
test('readGoal repairs the armedBy map: unknown values and absent entries read as the operator arming', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        writePlan(repo, 'docs/plans/b.md', 'Status: In Progress\n');
        assert.strictEqual(armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md']).ok, true);

        const raw = JSON.parse(fs.readFileSync(goalPath(repo), 'utf8'));
        raw.armedBy = {
            'docs/plans/a.md': 'self',
            'docs/plans/b.md': 'SELF',
            'docs/plans/never-armed.md': 'self'
        };
        fs.writeFileSync(goalPath(repo), JSON.stringify(raw, null, 2) + '\n', 'utf8');

        const state = readGoal(repo);
        assert.deepStrictEqual({ ...state.armedBy },
            { 'docs/plans/a.md': 'self', 'docs/plans/b.md': 'operator' },
            "an exact 'self' is honored, an unrecognized value reads as the operator's arming, "
            + 'and a key naming no queued plan is dropped rather than carried');
        assert.strictEqual(Object.getPrototypeOf(state.armedBy), null,
            'the map carries no prototype, so a plan path of toString cannot answer from Object.prototype');

        // A map that is not an object at all, and a state carrying none, both
        // read as the typed arming for every plan the queue holds.
        raw.armedBy = ['self'];
        fs.writeFileSync(goalPath(repo), JSON.stringify(raw, null, 2) + '\n', 'utf8');
        assert.deepStrictEqual({ ...readGoal(repo).armedBy },
            { 'docs/plans/a.md': 'operator', 'docs/plans/b.md': 'operator' });
        delete raw.armedBy;
        fs.writeFileSync(goalPath(repo), JSON.stringify(raw, null, 2) + '\n', 'utf8');
        assert.deepStrictEqual({ ...readGoal(repo).armedBy },
            { 'docs/plans/a.md': 'operator', 'docs/plans/b.md': 'operator' });
    } finally {
        rmRepo(repo);
    }
});

test('armGoal re-arms idempotently over an existing goal state', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/first.md', 'Status: In Progress\n');
        writePlan(repo, 'docs/plans/second.md', 'Status: In Progress\n');

        assert.strictEqual(armGoal(repo, 'docs/plans/first.md').ok, true);
        assert.strictEqual(readGoal(repo).plan, 'docs/plans/first.md');

        // Re-arming replaces the prior state in place (rename over an existing
        // destination), leaving no stale .tmp and the newest plan recorded.
        assert.strictEqual(armGoal(repo, 'docs/plans/second.md').ok, true);
        assert.strictEqual(readGoal(repo).plan, 'docs/plans/second.md');
        assert.deepStrictEqual(tmpLeftovers(repo), [], 'no stale tmp survives a re-arm');
    } finally {
        rmRepo(repo);
    }
});

test('planHead anchors Status: body prose that mentions in progress does not misclassify a Complete plan', () => {
    const repo = makeRepo();
    try {
        // A Complete plan whose Chapter body contains the phrase "in progress".
        // Anchored matching keeps this classified complete (and thus refused for
        // arming); an unanchored substring scan would misread it as in progress.
        writePlan(repo, 'docs/plans/tricky.md',
            'Status: Complete\n\n## Chapters\nSection 3 was in progress before it finished.\n');
        assert.deepStrictEqual(planHead(repo, 'docs/plans/tricky.md'), { exists: true, status: 'complete' });

        const result = armGoal(repo, 'docs/plans/tricky.md');
        assert.strictEqual(result.ok, false);
        assert.match(result.reason, /Complete/);
        assert.ok(!fs.existsSync(goalPath(repo)));
    } finally {
        rmRepo(repo);
    }
});

test('bindSession binds an armed goal, and re-arming resets the binding to null', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        assert.strictEqual(armGoal(repo, 'docs/plans/foo.md').ok, true);
        assert.strictEqual(readGoal(repo).boundSession, null, 'an arm carrying no bind is unbound');

        assert.strictEqual(bindSession(repo, 'sess-1').ok, true);
        assert.strictEqual(readGoal(repo).boundSession, 'sess-1');
        assert.deepStrictEqual(tmpLeftovers(repo), [], 'no leftover tmp after an atomic bind');

        // Re-arming without a usable bind (the crash-recovery rebind
        // opportunity) resets the binding so the successor session can claim
        // it fresh at its own first stop.
        assert.strictEqual(armGoal(repo, 'docs/plans/foo.md').ok, true);
        assert.strictEqual(readGoal(repo).boundSession, null, 're-arm resets the binding');
    } finally {
        rmRepo(repo);
    }
});

test('bindSession returns ok:false without writing when no goal is armed', () => {
    const repo = makeRepo();
    try {
        const result = bindSession(repo, 'sess-1');
        assert.strictEqual(result.ok, false);
        assert.ok(!fs.existsSync(goalPath(repo)), 'no state file is created by a bind on an unarmed repo');
    } finally {
        rmRepo(repo);
    }
});

test('bindSession rejects an unusable session id and never throws', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        armGoal(repo, 'docs/plans/foo.md');
        // A newline in a session id would smuggle text into goal-state.json, which
        // the hooks surface into context; reject it, staying unbound.
        assert.strictEqual(bindSession(repo, 'sess\n1').ok, false);
        assert.strictEqual(bindSession(repo, '').ok, false);
        assert.strictEqual(readGoal(repo).boundSession, null);
    } finally {
        rmRepo(repo);
    }
});

test('bindSession reports a failed write as ok:false and leaves the prior binding intact', () => {
    // A directory occupying the tmp path the next write will take (pinned here,
    // since the production name carries a random suffix) makes the atomic write
    // fail, standing in for any filesystem failure. The caller (the hook) still
    // enforces the stop; the binding just does not persist until a later stop.
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        armGoal(repo, 'docs/plans/foo.md');
        withPinnedTmpPath(repo, (tmp) => {
            fs.mkdirSync(tmp, { recursive: true });
            const result = bindSession(repo, 'sess-1');
            assert.strictEqual(result.ok, false);
            assert.ok(result.reason && result.reason.includes('could not write'));
            assert.strictEqual(readGoal(repo).boundSession, null, 'the prior binding is unchanged by a failed write');
        });
    } finally {
        rmRepo(repo);
    }
});

test('bindSession rejects an oversized session id and never throws', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        armGoal(repo, 'docs/plans/foo.md');
        // A session id padded to kilobytes (whatever produced it) must be
        // refused outright rather than written into the state file, which would
        // deaden the leash until re-arm.
        const result = bindSession(repo, 'x'.repeat(129));
        assert.strictEqual(result.ok, false);
        assert.strictEqual(bindSession(repo, 'x'.repeat(128)).ok, true, 'exactly the cap is still accepted');
        assert.strictEqual(readGoal(repo).boundSession, 'x'.repeat(128));
    } finally {
        rmRepo(repo);
    }
});

test('CLI status reports the binding: unbound after arm, bound after bindSession', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        armGoal(repo, 'docs/plans/foo.md');

        let res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(res.status, 0);
        assert.match(res.stdout, /armed for docs\/plans\/foo\.md/);
        assert.match(res.stdout, /unbound/);

        bindSession(repo, 'sess-42');
        res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(res.status, 0);
        assert.match(res.stdout, /bound to session sess-42/);
    } finally {
        rmRepo(repo);
    }
});

// A goal-state file in the pre-queue shape: plan, condition, armedAt, and
// boundSession only. Every reader goes through readGoal's normalizer, so this
// fixture is how the suite proves a state file written before the queue
// existed still reads and advances correctly.
function writeLegacyState(repo, planRel, boundSession) {
    fs.mkdirSync(path.dirname(goalPath(repo)), { recursive: true });
    fs.writeFileSync(goalPath(repo), JSON.stringify({
        plan: planRel,
        condition: composeCondition(planRel),
        armedAt: new Date().toISOString(),
        boundSession: boundSession === undefined ? null : boundSession
    }, null, 2) + '\n', 'utf8');
}

test('armGoal arms an ordered queue from several plans, with the first as the current plan', () => {
    const repo = makeRepo();
    try {
        for (const name of ['a', 'b', 'c']) {
            writePlan(repo, 'docs/plans/' + name + '.md', 'Status: In Progress\n');
        }
        const result = armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md', 'docs/plans/c.md']);
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.plan, 'docs/plans/a.md', 'the first plan is the current one');
        assert.deepStrictEqual(result.queue, ['docs/plans/a.md', 'docs/plans/b.md', 'docs/plans/c.md']);

        const state = readGoal(repo);
        // plan and boundSession keep their pre-queue meanings (current plan,
        // leash holder): the compaction gate reads exactly that pair and
        // must keep working against a queued state.
        assert.strictEqual(state.plan, 'docs/plans/a.md');
        assert.strictEqual(state.boundSession, null);
        assert.deepStrictEqual(state.queue, ['docs/plans/a.md', 'docs/plans/b.md', 'docs/plans/c.md']);
        assert.strictEqual(state.queueIndex, 0);
        assert.deepStrictEqual(state.history, []);
        assert.strictEqual(state.condition, composeCondition('docs/plans/a.md', state.queue, 0));
        assert.match(state.condition, /docs\/plans\/b\.md, docs\/plans\/c\.md/, 'the condition names what is still to come');
    } finally {
        rmRepo(repo);
    }
});

test('a one-plan arm and a legacy state read back identically through the normalizer', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/solo.md', 'Status: In Progress\n');
        assert.strictEqual(armGoal(repo, 'docs/plans/solo.md').ok, true);
        const armed = readGoal(repo);

        // The pre-queue shape carries none of the new fields; the normalizer
        // supplies them, so a legacy file is a queue of one and every reader
        // downstream sees the same object an arm would have produced.
        writeLegacyState(repo, 'docs/plans/solo.md');
        const legacy = readGoal(repo);
        for (const key of ['plan', 'boundSession', 'boundTranscript', 'armingSession', 'queue', 'queueIndex',
            'history', 'condition', 'armedBy']) {
            assert.deepStrictEqual(legacy[key], armed[key], key + ' reads identically');
        }
    } finally {
        rmRepo(repo);
    }
});

test('readGoal normalizes a queue that disagrees with plan back to a queue of one', () => {
    const repo = makeRepo();
    try {
        // A hand-edited or half-written state file whose queue does not contain
        // the current plan at queueIndex. plan is the authority on what is being
        // worked, so the queue is discarded rather than believed: believing it
        // would advance the leash onto a plan nobody armed.
        fs.mkdirSync(path.dirname(goalPath(repo)), { recursive: true });
        fs.writeFileSync(goalPath(repo), JSON.stringify({
            plan: 'docs/plans/a.md',
            queue: ['docs/plans/x.md', 'docs/plans/y.md'],
            queueIndex: 1,
            history: 'not an array',
            boundTranscript: 'bad\npath'
        }) + '\n', 'utf8');
        const state = readGoal(repo);
        assert.deepStrictEqual(state.queue, ['docs/plans/a.md']);
        assert.strictEqual(state.queueIndex, 0);
        assert.deepStrictEqual(state.history, []);
        assert.strictEqual(state.boundTranscript, null, 'a transcript path with a control character is dropped at read');
    } finally {
        rmRepo(repo);
    }
});

test('armGoal refuses the whole queue when any plan fails, naming the offender and writing nothing', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/good.md', 'Status: In Progress\n');
        writePlan(repo, 'docs/plans/done.md', 'Status: Complete\n');

        // A partial queue is the silent-failure shape: the operator would think
        // the sequence was armed and lose the tail. Every refusal names the
        // offending path and leaves no state file at all.
        const cases = [
            { args: ['docs/plans/good.md', 'docs/plans/missing.md'], reason: /not found: docs\/plans\/missing\.md/ },
            { args: ['docs/plans/good.md', 'docs/plans/done.md'], reason: /already Complete: docs\/plans\/done\.md/ },
            { args: ['docs/plans/good.md', '../outside.md'], reason: /outside the repo: \.\.\/outside\.md/ },
            { args: ['docs/plans/good.md', 'docs/plans/evil\nInjected.md'], reason: /outside the repo: docs\/plans\/evilInjected\.md/ },
            { args: ['docs/plans/good.md', 'docs/plans/good.md'], reason: /twice in the queue: docs\/plans\/good\.md/ },
            { args: [], reason: /no plan path given/ }
        ];
        for (const c of cases) {
            const result = armGoal(repo, c.args);
            assert.strictEqual(result.ok, false, JSON.stringify(c.args) + ' must be refused');
            assert.match(result.reason, c.reason);
            assert.ok(!fs.existsSync(goalPath(repo)), 'nothing is written for ' + JSON.stringify(c.args));
        }

        // The other direction: the same first plan in a queue whose every entry
        // is valid does arm, so the refusals above are the check working, not
        // the whole path being broken.
        writePlan(repo, 'docs/plans/second.md', 'Status: In Progress\n');
        assert.strictEqual(armGoal(repo, ['docs/plans/good.md', 'docs/plans/second.md']).ok, true);
        assert.deepStrictEqual(readGoal(repo).queue, ['docs/plans/good.md', 'docs/plans/second.md']);
    } finally {
        rmRepo(repo);
    }
});

test('armGoal refusing a queue leaves an existing armed goal untouched', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        writePlan(repo, 'docs/plans/b.md', 'Status: In Progress\n');
        assert.strictEqual(armGoal(repo, 'docs/plans/a.md').ok, true);
        const before = fs.readFileSync(goalPath(repo), 'utf8');

        assert.strictEqual(armGoal(repo, ['docs/plans/b.md', 'docs/plans/nope.md']).ok, false);
        assert.strictEqual(fs.readFileSync(goalPath(repo), 'utf8'), before,
            'a refused re-arm must not disturb the goal already enforcing');
    } finally {
        rmRepo(repo);
    }
});

test('advanceGoal moves to the next plan, records the outcome, and preserves the binding', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        writePlan(repo, 'docs/plans/b.md', 'Status: In Progress\n');
        assert.strictEqual(armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md']).ok, true);
        assert.strictEqual(bindSession(repo, 'sess-1', '/tmp/transcript.jsonl').ok, true);
        const armedAt = readGoal(repo).armedAt;

        const result = advanceGoal(repo, { outcome: 'complete' });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.advanced, true);
        assert.strictEqual(result.finished, 'docs/plans/a.md');
        assert.strictEqual(result.plan, 'docs/plans/b.md');

        const state = readGoal(repo);
        assert.strictEqual(state.plan, 'docs/plans/b.md', 'plan is the new current plan');
        assert.strictEqual(state.queueIndex, 1);
        assert.deepStrictEqual(state.queue, ['docs/plans/a.md', 'docs/plans/b.md']);
        assert.strictEqual(state.condition, composeCondition('docs/plans/b.md', state.queue, 1),
            'the condition is recomposed for the new current plan');
        // One binding rides the whole queue: the session that claimed the arming
        // stays leashed across every plan without re-arming.
        assert.strictEqual(state.boundSession, 'sess-1');
        assert.strictEqual(state.boundTranscript, '/tmp/transcript.jsonl');
        assert.strictEqual(state.armedAt, armedAt, 'the arming time is the queue\'s, not the plan\'s');
        assert.strictEqual(state.history.length, 1);
        assert.strictEqual(state.history[0].plan, 'docs/plans/a.md');
        assert.strictEqual(state.history[0].outcome, 'complete');
        assert.ok(!Number.isNaN(Date.parse(state.history[0].at)));
        assert.ok(!('note' in state.history[0]), 'no note is recorded when none was given');
        assert.deepStrictEqual(tmpLeftovers(repo), [], 'the advance is one atomic rewrite');
    } finally {
        rmRepo(repo);
    }
});

test('advanceGoal records a blocked outcome with its sanitized note', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        writePlan(repo, 'docs/plans/b.md', 'Status: In Progress\n');
        armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md']);
        // The note originates in transcript text, so it is normalized to short
        // printable ASCII before it reaches a file the hooks surface into the
        // model's context.
        const result = advanceGoal(repo, { outcome: 'blocked', note: 'need a decision\n' + 'x'.repeat(200) });
        assert.strictEqual(result.advanced, true);
        const entry = readGoal(repo).history[0];
        assert.strictEqual(entry.outcome, 'blocked');
        assert.strictEqual(entry.note, 'need a decision' + 'x'.repeat(105));
        assert.strictEqual(entry.note.length, 120);
    } finally {
        rmRepo(repo);
    }
});

test('advanceGoal on the last plan reports no advance and writes nothing', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        writePlan(repo, 'docs/plans/b.md', 'Status: In Progress\n');
        armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md']);
        advanceGoal(repo, { outcome: 'complete' });
        const before = fs.readFileSync(goalPath(repo), 'utf8');

        const result = advanceGoal(repo, { outcome: 'complete' });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.advanced, false, 'the last plan has nowhere to advance to');
        assert.strictEqual(result.finished, 'docs/plans/b.md');
        assert.strictEqual(fs.readFileSync(goalPath(repo), 'utf8'), before,
            'the caller releases the goal; the advance leaves the state as it was');
    } finally {
        rmRepo(repo);
    }
});

test('advanceGoal on a legacy single-plan state reports no advance without touching the file', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/solo.md', 'Status: In Progress\n');
        writeLegacyState(repo, 'docs/plans/solo.md', 'sess-1');
        const before = fs.readFileSync(goalPath(repo), 'utf8');

        const result = advanceGoal(repo, { outcome: 'complete' });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.advanced, false, 'a pre-queue state is a queue of one and releases as it always did');
        assert.strictEqual(result.finished, 'docs/plans/solo.md');
        assert.strictEqual(fs.readFileSync(goalPath(repo), 'utf8'), before);
    } finally {
        rmRepo(repo);
    }
});

test('advanceGoal refuses an unusable outcome, an unarmed repo, and a failed write', () => {
    const repo = makeRepo();
    try {
        assert.strictEqual(advanceGoal(repo, { outcome: 'complete' }).ok, false, 'nothing is armed');
        assert.ok(!fs.existsSync(goalPath(repo)));

        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        writePlan(repo, 'docs/plans/b.md', 'Status: In Progress\n');
        armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md']);
        assert.strictEqual(advanceGoal(repo, { outcome: 'finished' }).ok, false, 'an unknown outcome is refused');
        assert.strictEqual(advanceGoal(repo).ok, false, 'a missing outcome is refused');
        assert.strictEqual(readGoal(repo).plan, 'docs/plans/a.md', 'a refused advance leaves the leash where it was');

        // A directory occupying the tmp path the next write will take (pinned
        // here, since the production name carries a random suffix) makes the
        // atomic write fail. The hook re-runs the same terminal clause at its
        // next stop, so a failed advance must report failure rather than pass
        // for a release.
        withPinnedTmpPath(repo, (tmp) => {
            fs.mkdirSync(tmp, { recursive: true });
            const result = advanceGoal(repo, { outcome: 'complete' });
            assert.strictEqual(result.ok, false);
            assert.ok(result.reason.includes('could not write'));
            assert.strictEqual(readGoal(repo).plan, 'docs/plans/a.md',
                'the leash stays on the finished plan for the retry');
        });
    } finally {
        rmRepo(repo);
    }
});

test('bindSession records a usable transcript path and drops an unusable one without failing the bind', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        armGoal(repo, 'docs/plans/foo.md');

        assert.strictEqual(bindSession(repo, 'sess-1', '/home/u/.claude/projects/p/t.jsonl').ok, true);
        assert.strictEqual(readGoal(repo).boundTranscript, '/home/u/.claude/projects/p/t.jsonl');

        // Binding the session is the load-bearing half: an absent, oversized, or
        // control-character-carrying transcript path never costs the leash. The
        // path travels with the binding, so it is cleared rather than left
        // pointing at the previous holder's transcript.
        for (const bad of [undefined, '', 'x'.repeat(513), '/tmp/a\nInjected.jsonl', 42]) {
            assert.strictEqual(bindSession(repo, 'sess-2', bad).ok, true, JSON.stringify(bad) + ' must not fail the bind');
            const state = readGoal(repo);
            assert.strictEqual(state.boundSession, 'sess-2');
            assert.strictEqual(state.boundTranscript, null);
        }
        assert.strictEqual(bindSession(repo, 'sess-3', 'x'.repeat(512)).ok, true, 'exactly the cap is accepted');
        assert.strictEqual(readGoal(repo).boundTranscript, 'x'.repeat(512));
    } finally {
        rmRepo(repo);
    }
});

test('composeCondition adds the queue context only while plans remain', () => {
    const queue = ['docs/plans/a.md', 'docs/plans/b.md', 'docs/plans/c.md'];
    const first = composeCondition('docs/plans/a.md', queue, 0);
    assert.ok(first.startsWith(composeCondition('docs/plans/a.md')), 'the solo text is the stem');
    assert.strictEqual(
        first.slice(composeCondition('docs/plans/a.md').length),
        ' This plan is 1 of 3 in an armed queue; still to come after it: '
        + 'docs/plans/b.md, docs/plans/c.md. Each plan runs to Complete or a recorded '
        + "'BLOCKED:' before the next begins, and the leash advances to the next "
        + 'plan on its own: no re-arming, and the run continues in this session.'
    );
    assert.match(composeCondition('docs/plans/b.md', queue, 1), /2 of 3.*docs\/plans\/c\.md/);
    // The last plan of a queue has nothing after it, so its condition is exactly
    // a solo arming's: what it promises is what the hook then does (release).
    assert.strictEqual(composeCondition('docs/plans/c.md', queue, 2), composeCondition('docs/plans/c.md'));
});

test('CLI arm accepts several plan paths and names the queue', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        writePlan(repo, 'docs/plans/b.md', 'Status: In Progress\n');

        const res = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/a.md', 'docs/plans/b.md'],
            { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /armed for docs\/plans\/a\.md \(1 of 2; then docs\/plans\/b\.md\)/);
        assert.deepStrictEqual(readGoal(repo).queue, ['docs/plans/a.md', 'docs/plans/b.md']);

        // One bad path refuses the whole arm at the CLI too, naming the offender
        // on stderr with a non-zero exit.
        const bad = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/a.md', 'docs/plans/gone.md'],
            { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(bad.status, 1);
        assert.match(bad.stderr, /not found: docs\/plans\/gone\.md/);

        const none = spawnSync(process.execPath, [CLI, 'arm'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(none.status, 1);
        assert.match(none.stderr, /usage: kit-goal\.js arm \[--append\] \[--self-armed\] <planPath>\.\.\./);
    } finally {
        rmRepo(repo);
    }
});

// The CLI is the one surface that knows which arming is running it: the
// invocation is identical whether the operator typed it or a run arming an
// inbound plan spawned it, so the flag is how the second one says so. It rides
// on the bare form and on an append alike, because a run handed a plan mid-run
// arms it into the queue it is already working.
test('CLI arm --self-armed records the self-arming, on the bare form and on an append', () => {
    const repo = makeRepo();
    try {
        authorizedPlan(repo, 'docs/plans/a.md');
        authorizedPlan(repo, 'docs/plans/b.md');

        const res = spawnSync(process.execPath, [CLI, 'arm', '--self-armed', 'docs/plans/a.md'],
            { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /recorded as this run's own arming/);
        let state = readGoal(repo);
        assert.strictEqual(state.armedBy['docs/plans/a.md'], 'self');
        assert.strictEqual(state.condition, composeCondition('docs/plans/a.md', state.queue, 0, 'self'));

        // The append form takes the flag too, and it reaches the appended plan
        // alone: this is the spelling a run already under a leash uses for an
        // inbound plan it armed itself, which is the path the flag exists for.
        const appended = spawnSync(process.execPath, [CLI, 'arm', '--append', '--self-armed', 'docs/plans/b.md'],
            { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(appended.status, 0, appended.stderr);
        assert.match(appended.stdout, /recorded as this run's own arming/);
        state = readGoal(repo);
        assert.deepStrictEqual({ ...state.armedBy },
            { 'docs/plans/a.md': 'self', 'docs/plans/b.md': 'self' });

        // The control, on the same fixture: neither form says anything about the
        // arming without the flag, and the state records the operator's.
        const typed = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/a.md'],
            { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(typed.status, 0, typed.stderr);
        assert.strictEqual(readGoal(repo).armedBy['docs/plans/a.md'], 'operator');
        assert.doesNotMatch(typed.stdout, /own arming/);
        const typedAppend = spawnSync(process.execPath, [CLI, 'arm', '--append', 'docs/plans/b.md'],
            { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(typedAppend.status, 0, typedAppend.stderr);
        assert.strictEqual(readGoal(repo).armedBy['docs/plans/b.md'], 'operator');
        assert.doesNotMatch(typedAppend.stdout, /own arming/);
    } finally {
        rmRepo(repo);
    }
});

// The warning a self-armed plan recording no authorization earns, at the CLI: it
// names the plan on stderr, the arm lands, and the exit code stays 0, so a
// session that mis-placed its authorization section learns which plan while the directed
// path (which names an in-flight plan that legitimately carries no section) still
// works. The operator's arming over the same plan is the control: the warning
// follows what the arming declared, not what the doc records.
test('CLI arm --self-armed warns for a plan recording no authorization, and still arms', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/bare.md', 'Status: In Progress\n');

        const warned = spawnSync(process.execPath, [CLI, 'arm', '--self-armed', 'docs/plans/bare.md'],
            { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(warned.status, 0, warned.stderr);
        assert.match(warned.stderr, /docs\/plans\/bare\.md/);
        assert.match(warned.stderr, /the scan read no Dispatch Authorization out of these plan docs/);
        assert.strictEqual(readGoal(repo).armedBy['docs/plans/bare.md'], 'self',
            'the arm landed and recorded the arming it was given');

        // The control: the same plan, the same CLI, without the flag.
        const typed = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/bare.md'],
            { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(typed.status, 0, typed.stderr);
        assert.doesNotMatch(typed.stderr, /Dispatch Authorization/);
        assert.strictEqual(readGoal(repo).armedBy['docs/plans/bare.md'], 'operator');

        // A queue long enough to outrun the line caps the list and says by how
        // much, rather than printing paths until the terminal wraps. Every path
        // this line names goes through the 120-character cut, which leaves no
        // mark of its own, so the count is where a reader learns anything was
        // left out at all.
        const many = [];
        for (let i = 0; i < 7; i++) {
            const rel = 'docs/plans/bare' + i + '.md';
            writePlan(repo, rel, 'Status: In Progress\n');
            many.push(rel);
        }
        const capped = spawnSync(process.execPath, [CLI, 'arm', '--self-armed', ...many],
            { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(capped.status, 0, capped.stderr);
        assert.match(capped.stderr, /docs\/plans\/bare4\.md, and 2 more/);
        assert.doesNotMatch(capped.stderr, /docs\/plans\/bare5\.md/);
    } finally {
        rmRepo(repo);
    }
});

// status is the inspection path an operator and a coordinator seat are directed
// to, so the arming each queued plan records is rendered there beside the
// authorization sentence read from its doc: two facts, printed as two. Both
// armings print, because a line that appeared only for a self-arming would read
// the same as one this surface did not render.
test('CLI status reports the arming recorded for each queued plan', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/typed.md', 'Status: In Progress\n');
        authorizedPlan(repo, 'docs/plans/authorized.md');
        assert.strictEqual(armGoal(repo, 'docs/plans/typed.md').ok, true);
        assert.strictEqual(appendGoal(repo, ['docs/plans/authorized.md'], 'self').ok, true);

        const res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(res.status, 0, res.stderr);
        // The queue entry lines are the subject. The header names the current
        // plan as well, so the lookup takes only the lines the queue block
        // indents, which is where the per-plan arming is rendered.
        const entries = res.stdout.split('\n').filter((l) => l.startsWith('  '));
        const typedLine = entries.find((l) => l.includes('docs/plans/typed.md'));
        const authorizedLine = entries.find((l) => l.includes('docs/plans/authorized.md'));
        assert.match(typedLine, /armed: typed by the operator/);
        assert.match(authorizedLine, /armed: recorded as this run's own arming/);
    } finally {
        rmRepo(repo);
    }
});

test('CLI arm refuses an unknown leading-dash token, naming it and the CLI version, before it reaches armGoal', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');

        // The build stamp under the plugin root is the version the message
        // names, and a root directory named for no build at all does not
        // displace it: the stamp is read from a root spelled `claude-kit`,
        // which is what both a dev checkout and a marketplace clone spell.
        const stamped = makeRepo();
        writePlan(stamped, path.join('claude-kit', '.claude-plugin', 'build-info.json'),
            JSON.stringify({ name: 'claude-kit', hash: 'ab12cd3' }));
        const bogus = spawnSync(process.execPath, [CLI, 'arm', '--bogus'], {
            cwd: repo, encoding: 'utf8',
            env: { ...process.env, CLAUDE_PLUGIN_ROOT: path.join(stamped, 'claude-kit') }
        });
        assert.strictEqual(bogus.status, 1);
        assert.match(bogus.stderr, /--bogus/);
        assert.match(bogus.stderr, /version ab12cd3\b/);
        assert.doesNotMatch(bogus.stderr, /plan not found/);
        rmRepo(stamped);

        // With no stamp to read, the root's own directory name stands in only
        // where it is sha-shaped, which is what the installed cache layout
        // spells.
        const versioned = spawnSync(process.execPath, [CLI, 'arm', '--bogus'], {
            cwd: repo, encoding: 'utf8',
            env: { ...process.env, CLAUDE_PLUGIN_ROOT: path.join(os.tmpdir(), '5edb4483fd03') }
        });
        assert.strictEqual(versioned.status, 1);
        assert.match(versioned.stderr, /version 5edb4483fd03\b/);

        // And a root that is neither stamped nor sha-shaped yields the explicit
        // marker: a directory name is not a build identity, so the message that
        // exists to say which build is running never presents one as a version.
        const bare = makeRepo();
        fs.mkdirSync(path.join(bare, 'claude-kit'));
        const unstamped = spawnSync(process.execPath, [CLI, 'arm', '--bogus'], {
            cwd: repo, encoding: 'utf8',
            env: { ...process.env, CLAUDE_PLUGIN_ROOT: path.join(bare, 'claude-kit') }
        });
        rmRepo(bare);
        assert.strictEqual(unstamped.status, 1);
        assert.match(unstamped.stderr, /version unknown\b/);
        assert.doesNotMatch(unstamped.stderr, /version claude-kit/);

        // A real plan path, no bogus flag involved, still arms: the refusal
        // targets only an unrecognized leading-dash token.
        const control = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/a.md'], {
            cwd: repo, encoding: 'utf8'
        });
        assert.strictEqual(control.status, 0, control.stderr);
    } finally {
        rmRepo(repo);
    }
});

test('CLI status renders the queue, the per-plan heads, the history, and the liveness hint', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        writePlan(repo, 'docs/plans/b.md', 'Status: Approved\n');
        armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md']);

        // Unbound, nothing finished yet: the current plan is marked and both
        // plans carry their own Status head.
        let res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /armed for docs\/plans\/a\.md/);
        assert.match(res.stdout, /unbound/);
        assert.match(res.stdout, /queue: plan 1 of 2/);
        assert.match(res.stdout, /> docs\/plans\/a\.md \[in progress\]/);
        assert.match(res.stdout, /docs\/plans\/b\.md \[unknown\]/);
        assert.doesNotMatch(res.stdout, /finished:/, 'nothing has finished yet');

        // Bound, one plan finished: the binding names the session, the liveness
        // hint comes from the bound transcript's mtime, and the recorded outcome
        // is reported.
        const transcript = path.join(repo, 'transcript.jsonl');
        fs.writeFileSync(transcript, '{}\n', 'utf8');
        bindSession(repo, 'sess-42', transcript);
        advanceGoal(repo, { outcome: 'complete' });
        res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /bound to session sess-42, last active less than a minute ago/);
        assert.match(res.stdout, /queue: plan 2 of 2/);
        assert.match(res.stdout, /> docs\/plans\/b\.md \[unknown\]/);
        assert.match(res.stdout, /finished:\n {2}docs\/plans\/a\.md complete at /);

        // An unreadable transcript path costs the hint, not the report.
        fs.rmSync(transcript);
        res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /bound to session sess-42\)/);
        assert.doesNotMatch(res.stdout, /last active/);
    } finally {
        rmRepo(repo);
    }
});

test('CLI status renders a legacy single-plan state as a queue of one', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/solo.md', 'Status: In Progress\n');
        writeLegacyState(repo, 'docs/plans/solo.md', 'sess-9');
        const res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /armed for docs\/plans\/solo\.md/);
        assert.match(res.stdout, /bound to session sess-9/);
        assert.match(res.stdout, /queue: plan 1 of 1/);
        assert.doesNotMatch(res.stdout, /last active/, 'a legacy state records no transcript, so there is no hint');
    } finally {
        rmRepo(repo);
    }
});

// This is what makes 'run the goal CLI instead of reading the state file'
// a disclosure control rather than just a rerouted read: the raw state file
// carries the bound transcript's absolute path, under the user profile, and
// status must print the blocker note without printing it. Nothing else
// enforces that property, so a later change to status's rendering could
// start leaking the path while the skill kept telling a coordinator seat to
// rely on this command for exactly the guarantee that had just gone quiet.
test('CLI status prints the blocked note but never the bound transcript path', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        writePlan(repo, 'docs/plans/b.md', 'Status: In Progress\n');
        armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md']);

        const transcript = path.join(repo, 'transcript-should-not-leak.jsonl');
        fs.writeFileSync(transcript, '{}\n', 'utf8');
        bindSession(repo, 'sess-1', transcript);

        const note = 'waiting on the operator to pick a database vendor';
        advanceGoal(repo, { outcome: 'blocked', note });

        const res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(res.status, 0, res.stderr);

        // The control is what the command puts in front of the seat, which is
        // both streams rather than stdout alone: the CLI writes advisory notes
        // to stderr, and a path leaking there reaches a brief exactly as one on
        // stdout would.
        const shown = res.stdout + '\n' + res.stderr;

        // Prove the absence check below can actually see a leak before
        // trusting it passing: run the same shape of check against a copy
        // of the real output with the path spliced in, and require it to
        // fail. A check that never goes red here would pass for the wrong
        // reason against the real command too.
        const leaking = shown + '\n' + transcript;
        assert.throws(() => assert.strictEqual(leaking.includes(transcript), false),
            'the transcript-absence check must be able to fail, or it proves nothing');

        assert.ok(res.stdout.includes(note), 'the blocked note is what the seat reads status for: ' + res.stdout);
        assert.strictEqual(shown.includes(transcript), false,
            'the bound transcript path must never reach this output: ' + shown);
    } finally {
        rmRepo(repo);
    }
});

// Run a case with the event sink redirected into its own temp dir, restoring
// KIT_EVENTS_PATH and KIT_EVENTS_PATH_ALLOW (including their absence)
// afterward so one case cannot leak the redirect into the next, and cleaning
// the dir regardless of pass/fail. The allow signal rides alongside the path:
// without it the override is inert and every case below would fall back to
// (and append at) the real ~/.claude/kit-events.jsonl.
function withEventSink(fn) {
    const dir = makeRepo();
    const priorPath = process.env.KIT_EVENTS_PATH;
    const priorAllow = process.env.KIT_EVENTS_PATH_ALLOW;
    process.env.KIT_EVENTS_PATH = path.join(dir, 'kit-events.jsonl');
    process.env.KIT_EVENTS_PATH_ALLOW = '1';
    try {
        fn(process.env.KIT_EVENTS_PATH);
    } finally {
        if (priorPath === undefined) delete process.env.KIT_EVENTS_PATH;
        else process.env.KIT_EVENTS_PATH = priorPath;
        if (priorAllow === undefined) delete process.env.KIT_EVENTS_PATH_ALLOW;
        else process.env.KIT_EVENTS_PATH_ALLOW = priorAllow;
        rmRepo(dir);
    }
}

function readEventLines(sink) {
    return fs.readFileSync(sink, 'utf8').split('\n').filter((line) => line.trim() !== '');
}

test('emitGoalEvent appends one line per call carrying the documented schema', () => {
    withEventSink((sink) => {
        emitGoalEvent({
            event: 'goal-complete', project: 'D:/repo', plan: 'docs/plans/foo.md',
            session: 'sess-1', detail: 'plan-complete'
        });
        let lines = readEventLines(sink);
        assert.strictEqual(lines.length, 1, 'one call appends exactly one line');
        const complete = JSON.parse(lines[0]);
        assert.deepStrictEqual(Object.keys(complete), ['ts', 'event', 'project', 'plan', 'session', 'detail']);
        assert.strictEqual(complete.event, 'goal-complete');
        assert.strictEqual(complete.project, 'D:/repo');
        assert.strictEqual(complete.plan, 'docs/plans/foo.md');
        assert.strictEqual(complete.session, 'sess-1');
        assert.strictEqual(complete.detail, 'plan-complete');
        assert.match(complete.ts, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, 'ts is an ISO 8601 instant');
        assert.ok(!Number.isNaN(Date.parse(complete.ts)));

        // No detail on a blocked event, and a caller with no session id records
        // null rather than dropping the key: the consumer reads a stable shape.
        emitGoalEvent({ event: 'goal-blocked', project: 'D:/repo', plan: 'docs/plans/foo.md' });
        lines = readEventLines(sink);
        assert.strictEqual(lines.length, 2, 'the second call appends rather than replacing');
        const blocked = JSON.parse(lines[1]);
        assert.deepStrictEqual(Object.keys(blocked), ['ts', 'event', 'project', 'plan', 'session']);
        assert.strictEqual(blocked.event, 'goal-blocked');
        assert.strictEqual(blocked.session, null);
    });
});

test('emitGoalEvent rotates only past 1 MB, and a rotation replaces the prior .old', () => {
    withEventSink((sink) => {
        const MB = 1024 * 1024;
        // Exactly 1 MB is not "exceeds 1 MB": the append lands in place, keeping
        // the boundary off the rotation side.
        const filler = 'a'.repeat(MB - 1) + '\n';
        fs.writeFileSync(sink, filler, 'utf8');
        assert.strictEqual(fs.statSync(sink).size, MB, 'setup: the sink sits exactly on the threshold');
        emitGoalEvent({ event: 'goal-blocked', project: 'D:/repo', plan: 'docs/plans/foo.md' });
        assert.ok(!fs.existsSync(sink + '.old'), 'a sink of exactly 1 MB is not rotated');
        const grown = fs.readFileSync(sink, 'utf8');
        assert.ok(grown.startsWith(filler), 'the existing content is kept');
        const appended = readEventLines(sink);
        assert.strictEqual(appended.length, 2, 'the event is appended below the existing content');
        assert.strictEqual(JSON.parse(appended[1]).event, 'goal-blocked');

        // The sink now exceeds 1 MB, so the next emit rotates it away and starts
        // fresh: the stream stays bounded instead of growing without limit.
        emitGoalEvent({ event: 'goal-complete', project: 'D:/repo', plan: 'docs/plans/foo.md', detail: 'plan-complete' });
        assert.ok(fs.existsSync(sink + '.old'), 'a sink past 1 MB is rotated');
        assert.strictEqual(fs.readFileSync(sink + '.old', 'utf8'), grown, 'the rotated file holds the prior stream');
        const fresh = readEventLines(sink);
        assert.strictEqual(fresh.length, 1, 'the fresh sink holds only the newest event');
        assert.strictEqual(JSON.parse(fresh[0]).detail, 'plan-complete');

        // A second rotation overwrites the previous .old rather than failing on
        // an occupied destination and losing the append.
        fs.writeFileSync(sink, 'b'.repeat(MB + 1), 'utf8');
        emitGoalEvent({ event: 'goal-blocked', project: 'D:/repo', plan: 'docs/plans/bar.md' });
        assert.strictEqual(fs.readFileSync(sink + '.old', 'utf8'), 'b'.repeat(MB + 1), 'the prior .old is replaced');
        const second = readEventLines(sink);
        assert.strictEqual(second.length, 1);
        assert.strictEqual(JSON.parse(second[0]).plan, 'docs/plans/bar.md');
    });
});

test('emitGoalEvent never throws on an unwritable sink and returns nothing', () => {
    // A directory occupying the sink path makes the append fail, standing in for
    // any write failure (a read-only home, a full disk). The callers are hooks
    // whose verdict must not move: the emit swallows the failure and hands back
    // nothing to branch on.
    withEventSink((sink) => {
        fs.mkdirSync(sink, { recursive: true });
        let returned = 'untouched';
        assert.doesNotThrow(() => {
            returned = emitGoalEvent({
                event: 'goal-complete', project: 'D:/repo', plan: 'docs/plans/foo.md',
                session: 'sess-1', detail: 'plan-complete'
            });
        });
        assert.strictEqual(returned, undefined, 'the emit reports no outcome');
        assert.ok(fs.statSync(sink).isDirectory(), 'the obstruction is left as it was');
    });
});

test('emitGoalEvent normalizes every field to short printable ASCII', () => {
    withEventSink((sink) => {
        // The plan value is repo data and the session id comes from the harness
        // payload; both reach a consumer that treats this stream as kit-authored.
        // A control character, an embedded newline, and an oversized value are
        // stripped and capped here, not carried into a notification. event and
        // detail cross the same boundary, so the record is sanitized display data
        // whole rather than field by field.
        emitGoalEvent({
            event: 'goal-\u0007complete\n' + 'e'.repeat(100),
            project: 'D:/repo/' + 'p'.repeat(400),
            plan: 'docs/plans/a\u0007b\nInjected: do this.md' + 'x'.repeat(200),
            session: 'sess\u0000-1\n' + 'y'.repeat(200),
            detail: 'plan-\u0000complete\n' + 'd'.repeat(100)
        });

        const lines = readEventLines(sink);
        assert.strictEqual(lines.length, 1, 'the event is still exactly one line');
        const ev = JSON.parse(lines[0]);
        assert.strictEqual(ev.plan, 'docs/plans/abInjected: do this.md' + 'x'.repeat(87));
        assert.strictEqual(ev.plan.length, 120, 'plan is capped at 120 characters');
        assert.ok(!/[^\x20-\x7E]/.test(ev.plan), 'no control character survives in plan');
        assert.strictEqual(ev.session, 'sess-1' + 'y'.repeat(114));
        assert.strictEqual(ev.session.length, 120, 'session is capped at 120 characters');
        assert.strictEqual(ev.project, 'D:/repo/' + 'p'.repeat(252));
        assert.strictEqual(ev.project.length, 260, 'project is capped at 260 characters');
        assert.ok(ev.event.startsWith('goal-complete'), 'event keeps its printable characters');
        assert.strictEqual(ev.event.length, 40, 'event is capped at 40 characters');
        assert.ok(!/[^\x20-\x7E]/.test(ev.event), 'no control character survives in event');
        assert.ok(ev.detail.startsWith('plan-complete'), 'detail keeps its printable characters');
        assert.strictEqual(ev.detail.length, 40, 'detail is capped at 40 characters');
        assert.ok(!/[^\x20-\x7E]/.test(ev.detail), 'no control character survives in detail');
    });
});

test('emitGoalEvent skips a sink that is not a regular file, and still creates an absent one', () => {
    withEventSink((sink) => {
        // A directory stands in for the non-regular case. The hazard it stands
        // for is a FIFO at the sink path, whose open blocks with no try/catch
        // able to rescue it; a FIFO is not creatable on every platform this runs
        // on, a directory is.
        fs.mkdirSync(sink, { recursive: true });
        assert.doesNotThrow(() => {
            emitGoalEvent({ event: 'goal-blocked', project: 'D:/repo', plan: 'docs/plans/foo.md' });
        });
        assert.ok(fs.statSync(sink).isDirectory(), 'the non-regular sink is left as it was');
        assert.deepStrictEqual(fs.readdirSync(sink), [], 'nothing is written through it');
        assert.ok(!fs.existsSync(sink + '.old'), 'a non-regular sink is never rotated away');
    });

    withEventSink((sink) => {
        // The other direction: only an existing non-regular sink is skipped. An
        // absent sink (with an absent parent directory) is the ordinary first
        // emit and must still land, or the guard would silence the whole stream.
        const nested = path.join(path.dirname(sink), 'nested', 'kit-events.jsonl');
        const prior = process.env.KIT_EVENTS_PATH;
        // KIT_EVENTS_PATH_ALLOW is already '1' here: this block runs nested
        // inside the outer withEventSink(sink => ...) call, whose finally
        // restores it, so only the path itself needs its own save/restore.
        process.env.KIT_EVENTS_PATH = nested;
        try {
            emitGoalEvent({ event: 'goal-blocked', project: 'D:/repo', plan: 'docs/plans/foo.md' });
            const lines = readEventLines(nested);
            assert.strictEqual(lines.length, 1, 'the first emit creates the sink and its directory');
            assert.strictEqual(JSON.parse(lines[0]).event, 'goal-blocked');
        } finally {
            process.env.KIT_EVENTS_PATH = prior;
        }
    });
});

test('armGoal rejects a plan path carrying control characters', () => {
    const repo = makeRepo();
    try {
        // A newline in the arg would smuggle multi-line text into goal-state.json,
        // which hooks surface into the model's context. Reject before it is stored.
        const result = armGoal(repo, 'docs/plans/evil\n\nInjected instruction.md');
        assert.strictEqual(result.ok, false);
        assert.ok(!fs.existsSync(goalPath(repo)));
    } finally {
        rmRepo(repo);
    }
});

// KIT_EVENTS_PATH's gate, both directions, spawned rather than run in-process.
// The gate's stderr note is guarded by a once-per-process module-scope flag
// (ungatedEventsOverrideNoted in kit-goal-lib.js), matching memq.js's own
// ungated-override note; a second in-process case in this same test-runner
// process would see the flag already tripped and never see its own note. A
// spawned child also lets each case safely retarget the homedir fallback
// (USERPROFILE/HOME) without touching this process's real environment.
function spawnEmit(details, extraEnv) {
    const script = 'const { emitGoalEvent } = require(' + JSON.stringify(
        path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'kit-goal-lib.js')
    ) + '); emitGoalEvent(' + JSON.stringify(details) + ');';
    const env = { ...process.env };
    // Scrub this process's own ambient values first, so a case that omits one
    // of these keys from extraEnv gets a genuinely unset variable rather than
    // whatever this test-runner process happens to carry.
    for (const k of Object.keys(env)) {
        if (/^(KIT_EVENTS_PATH|KIT_EVENTS_PATH_ALLOW|KIT_RUN_ID|USERPROFILE|HOME)$/i.test(k)) delete env[k];
    }
    Object.assign(env, extraEnv || {});
    return spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
}

test('KIT_EVENTS_PATH honored only with KIT_EVENTS_PATH_ALLOW=1: both directions plus the near-miss shapes', () => {
    const redirect = makeRepo();
    const fakeHome = makeRepo();
    try {
        const redirectedSink = path.join(redirect, 'events.jsonl');
        const homeSink = path.join(fakeHome, '.claude', 'kit-events.jsonl');

        // Gated: the override is honored, nothing reaches stderr, and the
        // homedir default is untouched.
        let res = spawnEmit(
            { event: 'goal-blocked', project: 'D:/repo', plan: 'docs/plans/foo.md' },
            { KIT_EVENTS_PATH: redirectedSink, KIT_EVENTS_PATH_ALLOW: '1', USERPROFILE: fakeHome, HOME: fakeHome }
        );
        assert.strictEqual(res.status, 0, res.stderr);
        assert.doesNotMatch(res.stderr, /ignoring KIT_EVENTS_PATH/, 'a gated override emits no note');
        assert.ok(fs.existsSync(redirectedSink), 'the gated override is honored');
        assert.ok(!fs.existsSync(homeSink), 'the homedir default is untouched when the override is honored');

        // Ungated: the override is ignored loudly, and the event still lands at
        // the homedir default rather than silently vanishing or leaking through
        // to the requested path.
        fs.rmSync(redirect, { recursive: true, force: true });
        fs.mkdirSync(redirect, { recursive: true });
        res = spawnEmit(
            { event: 'goal-blocked', project: 'D:/repo', plan: 'docs/plans/foo.md' },
            { KIT_EVENTS_PATH: redirectedSink, USERPROFILE: fakeHome, HOME: fakeHome }
        );
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stderr, /ignoring KIT_EVENTS_PATH/, 'an ungated override notes it on stderr');
        assert.ok(!fs.existsSync(redirectedSink), 'an ungated override must not be honored');
        assert.ok(fs.existsSync(homeSink), 'the event still lands at the homedir default');
        fs.rmSync(homeSink);

        // The allow signal set to anything other than the literal '1' is the
        // same as unset, matching how the other kit gates treat their signal.
        res = spawnEmit(
            { event: 'goal-blocked', project: 'D:/repo', plan: 'docs/plans/foo.md' },
            { KIT_EVENTS_PATH: redirectedSink, KIT_EVENTS_PATH_ALLOW: 'true', USERPROFILE: fakeHome, HOME: fakeHome }
        );
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stderr, /ignoring KIT_EVENTS_PATH/);
        assert.ok(!fs.existsSync(redirectedSink), 'a non-"1" allow value must not honor the override');
        assert.ok(fs.existsSync(homeSink));
        fs.rmSync(homeSink);

        // The allow signal set with no path at all: nothing to honor, so no
        // note and no change from today's unset-override behavior.
        res = spawnEmit(
            { event: 'goal-blocked', project: 'D:/repo', plan: 'docs/plans/foo.md' },
            { KIT_EVENTS_PATH_ALLOW: '1', USERPROFILE: fakeHome, HOME: fakeHome }
        );
        assert.strictEqual(res.status, 0, res.stderr);
        assert.doesNotMatch(res.stderr, /ignoring KIT_EVENTS_PATH/, 'an allow signal with no path is inert, not a note');
        assert.ok(fs.existsSync(homeSink), 'the event lands at the homedir default as if nothing were set');
    } finally {
        rmRepo(redirect);
        rmRepo(fakeHome);
    }
});

test('advanceGoal with expectedPlan is a compare-and-swap: a mismatch refuses without writing', () => {
    const repo = makeRepo();
    try {
        for (const n of ['a', 'b', 'c']) writePlan(repo, 'docs/plans/' + n + '.md', 'Status: In Progress\n');
        armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md', 'docs/plans/c.md']);
        const before = fs.readFileSync(goalPath(repo), 'utf8');

        // The caller decided to advance from a snapshot, and a CLI re-arm or
        // clear can land between that snapshot and this function's own
        // re-read: a state whose current plan is no longer the expected one
        // is refused rather than advanced over.
        const refused = advanceGoal(repo, { outcome: 'complete', expectedPlan: 'docs/plans/zzz.md' });
        assert.strictEqual(refused.ok, false);
        assert.match(refused.reason, /no longer/);
        assert.strictEqual(fs.readFileSync(goalPath(repo), 'utf8'), before, 'a refused advance writes nothing');

        const advanced = advanceGoal(repo, { outcome: 'complete', expectedPlan: 'docs/plans/a.md' });
        assert.strictEqual(advanced.ok, true);
        assert.strictEqual(advanced.advanced, true);
        assert.strictEqual(readGoal(repo).plan, 'docs/plans/b.md', 'a matching expectation advances as before');
    } finally {
        rmRepo(repo);
    }
});

test('advanceGoal stores a usable leadKey as blockedAdvanceKey and drops an unusable one', () => {
    const repo = makeRepo();
    try {
        for (const n of ['a', 'b', 'c']) writePlan(repo, 'docs/plans/' + n + '.md', 'Status: In Progress\n');
        armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md', 'docs/plans/c.md']);
        assert.strictEqual(readGoal(repo).blockedAdvanceKey, undefined, 'no key before any blocked advance');

        assert.strictEqual(advanceGoal(repo, { outcome: 'blocked', note: 'n', leadKey: 'uuid:abc-123' }).advanced, true);
        assert.strictEqual(readGoal(repo).blockedAdvanceKey, 'uuid:abc-123');
        assert.strictEqual(readGoal(repo).blockedAdvancePlan, 'docs/plans/b.md',
            'the key rides with the plan the advance moved to');

        // An unusable key (a control character, an oversized value) is
        // dropped rather than stored: the field lands in a file the hooks
        // read back, so it answers to the same printable-and-capped bar as
        // every stored field. The prior pair stays, which errs toward holding
        // a lead that was in fact consumed.
        assert.strictEqual(advanceGoal(repo, { outcome: 'blocked', leadKey: 'bad\u0007key' }).advanced, true);
        assert.strictEqual(readGoal(repo).blockedAdvanceKey, 'uuid:abc-123', 'a control-character key is not stored');
        assert.strictEqual(readGoal(repo).blockedAdvancePlan, 'docs/plans/b.md',
            'the prior recording plan stays with the prior key');
    } finally {
        rmRepo(repo);
    }
});

test('advanceGoal with expectedArmedAt refuses a state re-armed under the same current plan', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        writePlan(repo, 'docs/plans/b.md', 'Status: In Progress\n');
        armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md']);
        const armedAt = readGoal(repo).armedAt;
        const before = fs.readFileSync(goalPath(repo), 'utf8');

        // A re-arm that puts the SAME plan back at the head (/kit-goal
        // <currentPlan> <newTail>, the ordinary crash-recovery spelling)
        // passes a plan-only compare; the arming timestamp is what tells the
        // fresh queue from the snapshot the caller decided on, so a stale
        // expectedArmedAt refuses without writing.
        const refused = advanceGoal(repo, {
            outcome: 'complete', expectedPlan: 'docs/plans/a.md',
            expectedArmedAt: '2000-01-01T00:00:00.000Z'
        });
        assert.strictEqual(refused.ok, false);
        assert.match(refused.reason, /re-armed/);
        assert.strictEqual(fs.readFileSync(goalPath(repo), 'utf8'), before, 'a refused advance writes nothing');

        // The other direction: the armedAt the caller actually read advances.
        const advanced = advanceGoal(repo, {
            outcome: 'complete', expectedPlan: 'docs/plans/a.md', expectedArmedAt: armedAt
        });
        assert.strictEqual(advanced.ok, true);
        assert.strictEqual(advanced.advanced, true);
        assert.strictEqual(readGoal(repo).plan, 'docs/plans/b.md');
    } finally {
        rmRepo(repo);
    }
});

test('advanceGoal on a state whose plan is not a string refuses instead of throwing', () => {
    const repo = makeRepo();
    try {
        // A hand-edited non-string plan returns from the normalizer without
        // the queue fields it otherwise guarantees; a truthiness guard would
        // dereference the absent queue and break the never-throws contract.
        fs.mkdirSync(path.dirname(goalPath(repo)), { recursive: true });
        fs.writeFileSync(goalPath(repo), '{"plan": 123}', 'utf8');
        let result;
        assert.doesNotThrow(() => { result = advanceGoal(repo, { outcome: 'complete' }); });
        assert.strictEqual(result.ok, false);
        assert.match(result.reason, /no goal is armed/);
    } finally {
        rmRepo(repo);
    }
});

test('a clause-(a)-shaped advance (no leadKey) leaves the standing key and its recording plan in place', () => {
    const repo = makeRepo();
    try {
        for (const n of ['a', 'b', 'c']) writePlan(repo, 'docs/plans/' + n + '.md', 'Status: In Progress\n');
        armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md', 'docs/plans/c.md']);
        assert.strictEqual(advanceGoal(repo, { outcome: 'blocked', note: 'n', leadKey: 'uuid:k-1' }).advanced, true);
        assert.strictEqual(readGoal(repo).blockedAdvanceKey, 'uuid:k-1', 'setup: the blocked advance wrote its key');

        // Deleting the key here is what a keyless advance must NOT do: the
        // consumed entry can re-surface at a later stop's stale transcript
        // read, and a deleted key would let it advance the queue again. The
        // pair retires by position instead (the Stop hook honors it only
        // while the recording plan is the current or the immediately previous
        // queue position), so leaving it standing costs nothing.
        assert.strictEqual(advanceGoal(repo, { outcome: 'complete' }).advanced, true);
        assert.strictEqual(readGoal(repo).blockedAdvanceKey, 'uuid:k-1', 'the keyless advance leaves the key standing');
        assert.strictEqual(readGoal(repo).blockedAdvancePlan, 'docs/plans/b.md', 'and leaves its recording plan');
    } finally {
        rmRepo(repo);
    }
});

test('readGoal refuses a plan path that escapes the repo and drops an escaping queue entry', () => {
    const repo = makeRepo();
    try {
        // The plan and every queue entry are re-validated as paths at read:
        // planHead joins them onto cwd and opens the result, so a traversal
        // or absolute value written by hand must never reach a reader. A bad
        // plan makes the whole state malformed (null: no reader sees an armed
        // goal); a bad queue entry collapses the queue to [plan].
        const base = {
            condition: 'c', armedAt: '2026-08-16T00:00:00.000Z',
            boundSession: null, boundTranscript: null, queueIndex: 0, history: []
        };
        fs.mkdirSync(path.dirname(goalPath(repo)), { recursive: true });
        for (const badPlan of ['../outside.md', path.join(os.tmpdir(), 'outside.md')]) {
            fs.writeFileSync(goalPath(repo), JSON.stringify(
                { ...base, plan: badPlan, queue: [badPlan] }) + '\n', 'utf8');
            assert.strictEqual(readGoal(repo), null, JSON.stringify(badPlan) + ' must read as malformed');
        }

        fs.writeFileSync(goalPath(repo), JSON.stringify(
            { ...base, plan: 'docs/plans/ok.md', queue: ['docs/plans/ok.md', '../outside.md'] }) + '\n', 'utf8');
        const state = readGoal(repo);
        assert.deepStrictEqual(state.queue, ['docs/plans/ok.md'], 'the escaping entry is dropped with its queue');
        assert.strictEqual(state.queueIndex, 0);
    } finally {
        rmRepo(repo);
    }
});

test('writeState unlinks its tmp file when the rename fails', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        // A directory occupying the goal-state path makes the rename fail
        // after the tmp write succeeded; the tmp must not be left behind in
        // .kit/, matching writeCheckpoint's discipline in kit-compact-lib.js.
        fs.mkdirSync(goalPath(repo), { recursive: true });
        const result = armGoal(repo, 'docs/plans/foo.md');
        assert.strictEqual(result.ok, false);
        assert.ok(result.reason.includes('could not write'));
        assert.deepStrictEqual(tmpLeftovers(repo), [], 'no orphan tmp after a failed rename');
    } finally {
        rmRepo(repo);
    }
});

test('a UNC/network-shaped transcript path is dropped at bind and nulled at read', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        armGoal(repo, 'docs/plans/foo.md');
        // The stored path is fs.stat'ed synchronously at every SessionStart
        // and by the status report, and a stat on an unreachable network
        // share blocks for the SMB timeout; a shape the harness never
        // produces for a transcript is dropped, costing only the hint.
        for (const unc of ['\\\\srv\\share\\t.jsonl', '//srv/share/t.jsonl']) {
            assert.strictEqual(bindSession(repo, 'sess-1', unc).ok, true, 'the bind itself still succeeds');
            assert.strictEqual(readGoal(repo).boundTranscript, null, JSON.stringify(unc) + ' must not be stored');
        }
        // A state file already carrying one (hand-written) reads back null
        // through the normalizer, so no consumer ever stats it.
        const state = JSON.parse(fs.readFileSync(goalPath(repo), 'utf8'));
        state.boundTranscript = '\\\\srv\\share\\t.jsonl';
        fs.writeFileSync(goalPath(repo), JSON.stringify(state) + '\n', 'utf8');
        assert.strictEqual(readGoal(repo).boundTranscript, null);
    } finally {
        rmRepo(repo);
    }
});

test('lastActivePhrase is the one liveness wording: minutes, the hour crossover at 60, null on any failure', () => {
    const repo = makeRepo();
    try {
        const file = path.join(repo, 't.jsonl');
        const ageMinutes = (m) => {
            fs.writeFileSync(file, '{}\n', 'utf8');
            const when = new Date(Date.now() - m * 60000);
            fs.utimesSync(file, when, when);
            return lastActivePhrase(file);
        };
        assert.strictEqual(ageMinutes(0), 'less than a minute ago');
        assert.strictEqual(ageMinutes(1), 'about 1 minute ago');
        assert.strictEqual(ageMinutes(7), 'about 7 minutes ago');
        // The crossover sits at 60 minutes with Math.floor, so the phrase
        // errs toward reading recent, away from re-arming over a live sibling.
        assert.strictEqual(ageMinutes(90), 'about 1 hour ago');
        assert.strictEqual(ageMinutes(200), 'about 3 hours ago');
        assert.strictEqual(lastActivePhrase(path.join(repo, 'absent.jsonl')), null);
        assert.strictEqual(lastActivePhrase(undefined), null);
        assert.strictEqual(lastActivePhrase('//srv/share/t.jsonl'), null, 'a network-shaped path is never statted');
    } finally {
        rmRepo(repo);
    }
});

test('CLI status renders the shared liveness phrase, hours crossover included', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        armGoal(repo, 'docs/plans/foo.md');
        const transcript = path.join(repo, 'transcript.jsonl');
        fs.writeFileSync(transcript, '{}\n', 'utf8');
        const when = new Date(Date.now() - 90 * 60000);
        fs.utimesSync(transcript, when, when);
        bindSession(repo, 'sess-42', transcript);
        // 90 minutes renders as about 1 hour through the one shared helper;
        // a second wording here would let the CLI and the SessionStart
        // notice answer the same mtime differently.
        const res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /bound to session sess-42, last active about 1 hour ago/);
    } finally {
        rmRepo(repo);
    }
});

test('CLI status treats a plan-less or malformed state file as no armed goal instead of crashing', () => {
    const repo = makeRepo();
    try {
        // Each shape parses as JSON but normalizes to no usable plan; the
        // lib's contract is that a hiccup degrades to a default result, so
        // status reports no armed goal at exit 0 rather than dying on a
        // dereference with a stack trace.
        for (const raw of ['{}', '[]', '123', '{"plan":""}']) {
            fs.mkdirSync(path.dirname(goalPath(repo)), { recursive: true });
            fs.writeFileSync(goalPath(repo), raw, 'utf8');
            const res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
            assert.strictEqual(res.status, 0, raw + ' must not crash status: ' + res.stderr);
            assert.match(res.stdout, /no kit goal armed/, raw + ' reads as no armed goal');
            assert.strictEqual(res.stderr, '', raw + ' writes no error');
        }
    } finally {
        rmRepo(repo);
    }
});

test('armGoal refuses two casings of one plan path where the filesystem is case-insensitive',
    { skip: process.platform !== 'win32' }, () => {
        const repo = makeRepo();
        try {
            writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
            // On win32 both casings name one file: a queue holding both would
            // advance past the plan once and stall on the repeat, the exact
            // shape the duplicate refusal exists to stop.
            const result = armGoal(repo, ['docs/plans/a.md', 'docs/plans/A.md']);
            assert.strictEqual(result.ok, false);
            assert.match(result.reason, /twice in the queue/);
            assert.ok(!fs.existsSync(goalPath(repo)));
        } finally {
            rmRepo(repo);
        }
    });

test('CLI status caps a long queue and a long history at five entries each, with counted remainders', () => {
    const repo = makeRepo();
    try {
        const plans = [];
        for (let i = 1; i <= 9; i++) {
            plans.push(`docs/plans/p${i}.md`);
            writePlan(repo, `docs/plans/p${i}.md`, 'Status: In Progress\n');
        }
        assert.strictEqual(armGoal(repo, plans).ok, true);

        // Fresh arm: five entries render from the current position, the rest
        // are a count. The skill echoes this stdout into the session, so an
        // oversized state file must not become an unbounded context flood or
        // one file open per entry.
        let res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /queue: plan 1 of 9/);
        assert.match(res.stdout, /> docs\/plans\/p1\.md/);
        assert.match(res.stdout, /docs\/plans\/p5\.md/);
        assert.doesNotMatch(res.stdout, /p6\.md/, 'the sixth entry is behind the cap');
        assert.match(res.stdout, /\.\.\. and 4 more/);

        // Mid-queue with a long history: the queue window follows the current
        // position, and the history shows its five most recent outcomes with
        // the earlier ones counted.
        for (let i = 0; i < 6; i++) {
            assert.strictEqual(advanceGoal(repo, { outcome: 'complete' }).advanced, true);
        }
        res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /queue: plan 7 of 9/);
        assert.match(res.stdout, /> docs\/plans\/p7\.md/);
        assert.doesNotMatch(res.stdout, /\.\.\. and \d+ more/, 'nothing remains past the window');
        assert.match(res.stdout, /finished:/);
        assert.match(res.stdout, /\.\.\. 1 earlier omitted/);
        assert.match(res.stdout, /docs\/plans\/p2\.md complete at /);
        assert.match(res.stdout, /docs\/plans\/p6\.md complete at /);
        assert.doesNotMatch(res.stdout, /p1\.md complete/, 'the oldest outcome sits behind the count');
    } finally {
        rmRepo(repo);
    }
});

// A preload that records any fs.openSync whose target names the probe needle,
// by creating a marker file through the un-patched open. Spawned alongside the
// CLI it proves a path was never OPENED, which is the actual hazard (a
// traversal target outside the repo, or a FIFO whose open blocks), where
// asserting on stdout alone would only prove it was not printed.
function openSpyPreload(dir, needle, marker) {
    const shim = path.join(dir, 'open-spy.js');
    fs.writeFileSync(shim, [
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
    ].join('\n') + '\n', 'utf8');
    return '--require "' + shim.replace(/\\/g, '/') + '"';
}

test('CLI status never opens a plan or queue entry that traverses out of the repo', () => {
    const repo = makeRepo();
    const probe = 'kit-goal-outside-probe.md';
    const marker = path.join(repo, 'opened-outside.marker');
    try {
        const base = {
            condition: 'c', armedAt: '2026-08-16T00:00:00.000Z',
            boundSession: null, boundTranscript: null, queueIndex: 0, history: []
        };
        const env = { ...process.env, NODE_OPTIONS: openSpyPreload(repo, probe, marker) };

        // A traversal plan makes the whole state malformed at read, so status
        // reports no armed goal and the path is never handed to planHead.
        fs.mkdirSync(path.dirname(goalPath(repo)), { recursive: true });
        fs.writeFileSync(goalPath(repo), JSON.stringify(
            { ...base, plan: '../../' + probe, queue: ['../../' + probe] }) + '\n', 'utf8');
        let res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8', env });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /no kit goal armed/);
        assert.ok(!fs.existsSync(marker), 'the traversal plan was never opened');

        // A traversal queue entry collapses the queue to the (valid) current
        // plan, so only that plan is opened.
        writePlan(repo, 'docs/plans/ok.md', 'Status: In Progress\n');
        fs.writeFileSync(goalPath(repo), JSON.stringify(
            { ...base, plan: 'docs/plans/ok.md', queue: ['docs/plans/ok.md', '../../' + probe] }) + '\n', 'utf8');
        res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8', env });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /> docs\/plans\/ok\.md \[in progress\]/);
        assert.doesNotMatch(res.stdout, /outside-probe/);
        assert.ok(!fs.existsSync(marker), 'the traversal queue entry was never opened');
    } finally {
        rmRepo(repo);
    }
});

// A harness-shaped session id (the arm-time bind's gate accepts exactly this
// shape) and a second one for the rebind direction.
const SID = '5f3a91c2-7d40-4b18-9e26-0ac4185d7b63';
const SID2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// The state file as written, not as normalized at read. normalizeState nulls
// an invalid boundTranscript on every read, so a case pinning that a bad path
// was never stored has to look at the raw bytes: through readGoal it would
// pass identically whether armGoal dropped the value or wrote it verbatim.
function rawState(repo) {
    return JSON.parse(fs.readFileSync(goalPath(repo), 'utf8'));
}

test('armGoal binds the arming session when the session id and its transcript arrive together', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        const transcript = path.join(repo, 'sessions', SID + '.jsonl');
        const result = armGoal(repo, 'docs/plans/foo.md', { sessionId: SID, transcriptPath: transcript });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.boundSession, SID, 'the caller learns what was bound without restating the gate');

        // The binding rides in the arm's own single write, so it is on disk
        // the moment the arm returns: an in-session arm holds the leash
        // without waiting for a claim point. Both fields land together, so a
        // bound goal is never left without the transcript its liveness hint
        // reads from.
        const raw = rawState(repo);
        assert.strictEqual(raw.boundSession, SID);
        assert.strictEqual(raw.boundTranscript, transcript);
        assert.strictEqual(readGoal(repo).boundSession, SID);
        assert.deepStrictEqual(Object.keys(readGoal(repo)).sort(),
            ['armedAt', 'armedBy', 'armingSession', 'authorizations', 'boundSession', 'boundTranscript',
                'condition', 'history', 'plan', 'queue', 'queueIndex'],
            'the state shape is unchanged by the bind');
        assert.deepStrictEqual(tmpLeftovers(repo), [], 'the bound arm is one atomic write');

        // Uppercase is the same shape: the gate is case-insensitive, and the
        // value is stored exactly as given so it compares against the session
        // id the hook payloads carry.
        assert.strictEqual(armGoal(repo, 'docs/plans/foo.md',
            { sessionId: SID.toUpperCase(), transcriptPath: transcript }).boundSession, SID.toUpperCase());
        assert.strictEqual(rawState(repo).boundSession, SID.toUpperCase());

        // A transcript path at exactly validTranscript's cap still binds: the
        // second key answers to that one shared rule, not to a stricter local
        // one.
        assert.strictEqual(armGoal(repo, 'docs/plans/foo.md',
            { sessionId: SID, transcriptPath: 'x'.repeat(512) }).boundSession, SID);
        assert.strictEqual(rawState(repo).boundTranscript, 'x'.repeat(512));
    } finally {
        rmRepo(repo);
    }
});

test('a session id with no usable transcript arms unbound: the bind takes both keys or neither', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        // The shape of an id cannot authenticate it, and an arm-time bind to
        // the wrong session is unrecoverable: both claim points act only on an
        // unbound goal, so the real run would stay a bystander for the goal's
        // whole life while the arm reported success. The transcript found on
        // this machine is the corroboration, so a shaped id with no usable
        // path arms unbound rather than leashing the goal to a session that
        // will never stop. Absent, oversized, control-character-carrying,
        // network-shaped, and wrong-typed paths all fail validTranscript, the
        // same bar bindSession and the read normalizer apply.
        for (const bad of [undefined, null, '', 'x'.repeat(513), '/tmp/a\nInjected.jsonl',
            '\\\\srv\\share\\t.jsonl', '//srv/share/t.jsonl', 42]) {
            const result = armGoal(repo, 'docs/plans/foo.md', { sessionId: SID, transcriptPath: bad });
            assert.strictEqual(result.ok, true, JSON.stringify(bad) + ' must not fail the arm');
            assert.strictEqual(result.boundSession, null, JSON.stringify(bad) + ' must arm unbound');
            const raw = rawState(repo);
            assert.strictEqual(raw.boundSession, null, JSON.stringify(bad) + ' must write no binding');
            assert.strictEqual(raw.boundTranscript, null, JSON.stringify(bad) + ' must not be stored');
        }
    } finally {
        rmRepo(repo);
    }
});

test('armGoal arms unbound for any session id that is not UUID-shaped, and never fails over it', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        const transcript = path.join(repo, 't.jsonl');
        // The other key, tested against a transcript path that is itself
        // perfectly usable, so only the id's shape decides. Anything off the
        // exact shape falls back to an unbound arm rather than to a refusal:
        // the arm still succeeds and the stop and compaction-offer claim
        // points bind it. The transcript never rides an unbound arm, which
        // would leave a hint pointing at a session that holds nothing.
        const cases = [
            [undefined, 'no bind argument at all'],
            [{}, 'a bind carrying no session id'],
            [{ sessionId: undefined }, 'an absent value (the variable is unset)'],
            [{ sessionId: '' }, 'an empty value'],
            [{ sessionId: 'sess-1' }, 'a value of another shape entirely'],
            [{ sessionId: SID.slice(0, -1) }, 'a UUID one character short'],
            [{ sessionId: SID + 'a' }, 'a UUID with a trailing character'],
            [{ sessionId: ' ' + SID }, 'a UUID with leading whitespace'],
            [{ sessionId: SID + '\n' }, 'a UUID with a trailing newline'],
            [{ sessionId: '{' + SID + '}', }, 'a brace-wrapped UUID'],
            [{ sessionId: SID.replace(/-/g, '') }, 'a UUID with its hyphens stripped'],
            [{ sessionId: '2f4e97f8-5b7f-425e-8b33-076013d2487g' }, 'a non-hex character'],
            [{ sessionId: 42 }, 'a number'],
            [{ sessionId: { toString: () => SID } }, 'an object that stringifies to a UUID'],
            [{ sessionId: [SID] }, 'an array holding a UUID'],
            [{ sessionId: '../../evil' }, 'a value carrying a path separator']
        ];
        for (const [bind, why] of cases) {
            const withTranscript = bind === undefined ? undefined : { ...bind, transcriptPath: transcript };
            const result = armGoal(repo, 'docs/plans/foo.md', withTranscript);
            assert.strictEqual(result.ok, true, why + ' must still arm');
            assert.strictEqual(result.boundSession, null, why + ' must arm unbound');
            const raw = rawState(repo);
            assert.strictEqual(raw.boundSession, null, why + ' must write no binding');
            assert.strictEqual(raw.boundTranscript, null, why + ' must write no transcript');
        }
    } finally {
        rmRepo(repo);
    }
});

test('an arm that cannot corroborate its transcript records the arming session and stays unbound', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        // The identity half of the bind survives the transcript half failing.
        // The state is unbound, which is what every claim point answers to,
        // and it carries the id of the session that ran the arm, which is the
        // evidence the Stop hook and the PreCompact gate claim an unbound goal
        // on when no user-typed arming command exists to read.
        const result = armGoal(repo, 'docs/plans/foo.md', { sessionId: SID, transcriptPath: null });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.boundSession, null, 'the uncorroborated id binds nothing');
        assert.strictEqual(result.armingSession, SID, 'the caller learns what arming identity was recorded');

        const raw = rawState(repo);
        assert.strictEqual(raw.armingSession, SID, 'the arming identity is on disk');
        assert.strictEqual(raw.boundSession, null, 'and it is not a binding');
        assert.strictEqual(raw.boundTranscript, null, 'the pair rule is intact: neither half is written');
        assert.strictEqual(readGoal(repo).armingSession, SID, 'and it survives the read normalizer');
    } finally {
        rmRepo(repo);
    }
});

test('an arm that binds records the arming session beside the binding', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        const transcript = path.join(repo, 't.jsonl');
        const result = armGoal(repo, 'docs/plans/foo.md', { sessionId: SID, transcriptPath: transcript });
        assert.strictEqual(result.armingSession, SID, 'the field answers who armed, bound or not');
        const raw = rawState(repo);
        assert.strictEqual(raw.armingSession, SID);
        assert.strictEqual(raw.boundSession, SID, 'the binding is the separate answer to who holds the leash');
    } finally {
        rmRepo(repo);
    }
});

test('an arm with no session id of the harness shape records no arming session', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        const transcript = path.join(repo, 't.jsonl');
        // An identity is recorded from a shaped id or not at all: the field is
        // read back through the same shape rule, so a value no session's own
        // id can equal is worth nothing to a claim point and is not stored.
        const cases = [
            [undefined, 'no bind argument at all'],
            [{}, 'a bind carrying no session id'],
            [{ sessionId: '' }, 'an empty value'],
            [{ sessionId: 'sess-1' }, 'a value of another shape entirely'],
            [{ sessionId: ' ' + SID }, 'a UUID with leading whitespace'],
            [{ sessionId: 42 }, 'a number'],
            [{ sessionId: { toString: () => SID } }, 'an object that stringifies to a UUID'],
            [{ sessionId: [SID] }, 'an array holding a UUID']
        ];
        for (const [bind, why] of cases) {
            const withTranscript = bind === undefined ? undefined : { ...bind, transcriptPath: transcript };
            const result = armGoal(repo, 'docs/plans/foo.md', withTranscript);
            assert.strictEqual(result.ok, true, why + ' must still arm');
            assert.strictEqual(result.armingSession, null, why + ' records no arming identity');
            assert.strictEqual(rawState(repo).armingSession, null, why + ' writes none');
        }
    } finally {
        rmRepo(repo);
    }
});

test('sessionHoldsLeash answers for the binding where there is one and for the arming id where there is not', () => {
    // The read-only spelling of the question the two claim points decide: a
    // binding is the whole answer wherever one exists, compared the way every
    // other surface compares session ids (harness UUIDs surface in mixed case);
    // and only where there is none does the recorded arming id answer, which is
    // the route by which a run that armed a plan for itself holds its own leash
    // before any claim point has written the binding down.
    const armed = { plan: 'docs/plans/foo.md', boundSession: null, armingSession: SID };
    assert.strictEqual(sessionHoldsLeash(armed, SID), true, 'the recorded arming session holds it');
    assert.strictEqual(sessionHoldsLeash(armed, SID.toUpperCase()), true, 'compared case-insensitively');
    assert.strictEqual(sessionHoldsLeash(armed, ' ' + SID), false, 'a padded payload id claims nothing');
    assert.strictEqual(sessionHoldsLeash(armed, 'ses-other'), false, 'nobody else does');

    const bound = { plan: 'docs/plans/foo.md', boundSession: 'ses-holder', armingSession: SID };
    assert.strictEqual(sessionHoldsLeash(bound, 'SES-HOLDER'), true, 'the bound session holds it');
    assert.strictEqual(sessionHoldsLeash(bound, SID), false,
        'and the arming id is a route to an unbound leash, never a second holder of a bound one');

    // A binding no reader can support is nobody's: the claim points refuse to
    // claim over it, so no surface tells a session it holds what they would not
    // give it.
    const damaged = { plan: 'docs/plans/foo.md', boundSession: 42, armingSession: SID };
    assert.strictEqual(sessionHoldsLeash(damaged, SID), false, 'an unsupportable binding holds for nobody');
    assert.strictEqual(sessionHoldsLeash({ boundSession: null, armingSession: SID }, SID), false,
        'and no armed plan means no leash to hold');
});

test('readGoal repairs an armingSession the state file cannot support, and passes a shaped one through', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        assert.strictEqual(armGoal(repo, 'docs/plans/foo.md').ok, true);
        const base = rawState(repo);
        // The field is hand-editable like every other one in this file, and a
        // claim point reads it, so the read normalizer holds it to the shape
        // rule rather than trusting what is on disk.
        for (const [planted, why] of [
            [undefined, 'a state predating the field'],
            ['', 'an empty string'],
            ['sess-owner', 'a value of another shape'],
            [SID + '\n', 'a shaped value with a trailing newline'],
            [42, 'a number'],
            [{ id: SID }, 'an object'],
            [[SID], 'an array holding a UUID']
        ]) {
            const state = { ...base };
            if (planted === undefined) delete state.armingSession;
            else state.armingSession = planted;
            fs.writeFileSync(goalPath(repo), JSON.stringify(state, null, 2) + '\n', 'utf8');
            assert.strictEqual(readGoal(repo).armingSession, null, why + ' records no arming identity');
        }

        const good = { ...base, armingSession: SID.toUpperCase() };
        fs.writeFileSync(goalPath(repo), JSON.stringify(good, null, 2) + '\n', 'utf8');
        assert.strictEqual(readGoal(repo).armingSession, SID.toUpperCase(),
            'a shaped value reads back verbatim, so the case-insensitive compare at the claim points decides');
    } finally {
        rmRepo(repo);
    }
});

test('every writer that rewrites the state leaves the recorded arming session where the arm put it', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/one.md', 'Status: In Progress\n');
        writePlan(repo, 'docs/plans/two.md', 'Status: In Progress\n');
        assert.strictEqual(armGoal(repo, 'docs/plans/one.md',
            { sessionId: SID, transcriptPath: null }).ok, true);

        // Only armGoal composes the field; every other writer rebuilds the whole
        // state it read, so the field rides through. That is a property each of
        // them has to keep: the field is an unbound goal's only claim route, and
        // a writer that dropped it would strand the run holding the leash.
        assert.strictEqual(appendGoal(repo, 'docs/plans/two.md').ok, true);
        let state = readGoal(repo);
        assert.strictEqual(state.armingSession, SID, 'an append rewrites the state around the field');
        assert.strictEqual(state.boundSession, null, 'and the goal is still unbound');

        assert.strictEqual(advanceGoal(repo, { outcome: 'complete' }).advanced, true);
        state = readGoal(repo);
        assert.strictEqual(state.plan, 'docs/plans/two.md', 'the leash moved to the next plan');
        assert.strictEqual(state.armingSession, SID, 'an advance rewrites the state around the field');
        assert.strictEqual(state.boundSession, null, 'and an advance binds nothing');

        // A claim is the one write that reads the field and then rewrites the
        // state, so the two fields stand side by side afterwards: boundSession
        // says who holds the leash and armingSession still says who armed it.
        assert.strictEqual(bindSession(repo, SID2, null).ok, true);
        state = readGoal(repo);
        assert.strictEqual(state.boundSession, SID2, 'the bind records the holder');
        assert.strictEqual(state.armingSession, SID, 'a bind rewrites the state around the field');
    } finally {
        rmRepo(repo);
    }
});

test('CLI status tells the two unbound states apart by whether an arming session is recorded', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');

        // The two unbound states are claimable by different things, and the
        // arm's one-shot line saying which one this is does not outlive the
        // arming session, so the status report is where the difference is read
        // afterwards.
        armGoal(repo, 'docs/plans/foo.md');
        let res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(res.status, 0);
        assert.match(res.stdout, /unbound, no arming session recorded/);

        armGoal(repo, 'docs/plans/foo.md', { sessionId: SID, transcriptPath: null });
        assert.strictEqual(readGoal(repo).boundSession, null, 'still unbound: the transcript half failed');
        res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(res.status, 0);
        assert.match(res.stdout, /unbound, arming session recorded/);

        // A recorded value the normalizer refuses reads as the state holding no
        // arming identity, which is what every claim point answers to as well.
        const state = JSON.parse(fs.readFileSync(goalPath(repo), 'utf8'));
        state.armingSession = ' ' + SID;
        fs.writeFileSync(goalPath(repo), JSON.stringify(state, null, 2) + '\n', 'utf8');
        res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(res.status, 0);
        assert.match(res.stdout, /unbound, no arming session recorded/);
    } finally {
        rmRepo(repo);
    }
});

test('a re-arm replaces the previous binding, and an unbound re-arm clears it', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        const transcript = path.join(repo, 't.jsonl');
        assert.strictEqual(armGoal(repo, 'docs/plans/foo.md',
            { sessionId: SID, transcriptPath: transcript }).ok, true);
        assert.strictEqual(readGoal(repo).boundSession, SID);

        // A successor session re-arming takes the leash outright: the whole
        // state is rewritten, so nothing of the previous holder survives.
        const transcript2 = path.join(repo, 't2.jsonl');
        assert.strictEqual(armGoal(repo, 'docs/plans/foo.md',
            { sessionId: SID2, transcriptPath: transcript2 }).boundSession, SID2);
        let state = readGoal(repo);
        assert.strictEqual(state.boundSession, SID2);
        assert.strictEqual(state.boundTranscript, transcript2, 'the successor\'s own transcript replaces it');

        // And a re-arm with no usable bind returns the goal to unclaimed,
        // which is the crash-recovery rebind opportunity.
        assert.strictEqual(armGoal(repo, 'docs/plans/foo.md').boundSession, null);
        state = readGoal(repo);
        assert.strictEqual(state.boundSession, null);
        assert.strictEqual(state.boundTranscript, null);
    } finally {
        rmRepo(repo);
    }
});

// A child environment for a spawned CLI arm. This process's own values for the
// binding variable and the two the homedir resolves from are scrubbed first, so
// a case that omits one gets a genuinely unset variable rather than whatever
// the test-runner process carries; extra then sets exactly what the case is
// about. Matches spawnEmit's env handling above.
function armEnv(extra) {
    const env = { ...process.env };
    for (const k of Object.keys(env)) {
        if (/^(CLAUDE_CODE_SESSION_ID|USERPROFILE|HOME)$/i.test(k)) delete env[k];
    }
    return Object.assign(env, extra || {});
}

test('CLI arm binds the arming session from the environment and says so', () => {
    const repo = makeRepo();
    const fakeHome = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        writePlan(repo, 'docs/plans/b.md', 'Status: In Progress\n');
        // The arming session's transcript, where the harness keeps it. Its
        // presence is the second key the bind requires.
        const transcript = path.join(fakeHome, '.claude', 'projects', 'D--repo', SID + '.jsonl');
        fs.mkdirSync(path.dirname(transcript), { recursive: true });
        fs.writeFileSync(transcript, '{}\n', 'utf8');

        // The arm runs inside the arming session's shell, so the harness
        // variable plus the transcript it names are the whole input to the
        // binding, and the output states which way it went: an
        // armed-but-unbound goal is otherwise silent.
        let res = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/a.md'], {
            cwd: repo, encoding: 'utf8',
            env: armEnv({ CLAUDE_CODE_SESSION_ID: SID, USERPROFILE: fakeHome, HOME: fakeHome })
        });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /armed for docs\/plans\/a\.md \(bound to this session\)/);
        assert.strictEqual(res.stdout.trim().split('\n').length, 1, 'the binding rides on the one output line');
        assert.strictEqual(readGoal(repo).boundSession, SID);
        assert.strictEqual(readGoal(repo).boundTranscript, transcript,
            'a bound goal always carries the transcript that corroborated it');

        // The binding parenthetical follows the queue one on the same line.
        res = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/a.md', 'docs/plans/b.md'], {
            cwd: repo, encoding: 'utf8',
            env: armEnv({ CLAUDE_CODE_SESSION_ID: SID, USERPROFILE: fakeHome, HOME: fakeHome })
        });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout,
            /armed for docs\/plans\/a\.md \(1 of 2; then docs\/plans\/b\.md\) \(bound to this session\)/);
    } finally {
        rmRepo(repo);
        rmRepo(fakeHome);
    }
});

test('CLI arm reports an unbound arm and names the fallback claim points', () => {
    const repo = makeRepo();
    const fakeHome = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        // No transcript exists anywhere under this home, so even a
        // perfectly-shaped id is uncorroborated here. The variable is
        // undocumented and can vanish or change shape upstream, and a shaped
        // value can still be stale or planted, which is why each of these arms
        // unbound rather than failing, and why the output names what will bind
        // it instead.
        //
        // What the report says then depends on which half failed, because the
        // two states are claimable by different things. A shaped id is recorded
        // as the arming session, so the session holding that id claims at its
        // next stop or compaction offer. A value of no usable shape records no
        // identity at all, and the only route left is a session whose transcript
        // carries the plan path typed as a command argument.
        //
        // Which of the two was reported is read from one short token rather than
        // from the sentence, so the wording stays free to improve: the typed
        // route is named only where it is the one route left, and the machine-
        // read field asserted below is what that report is about.
        const TYPED_ROUTE = /typed as a kit-goal command argument/;
        const unbound = [
            [{}, 'the variable unset', null],
            [{ CLAUDE_CODE_SESSION_ID: '' }, 'an empty value', null],
            [{ CLAUDE_CODE_SESSION_ID: 'not-a-uuid' }, 'a value of another shape', null],
            [{ CLAUDE_CODE_SESSION_ID: SID.slice(0, -1) }, 'a UUID one character short', null],
            [{ CLAUDE_CODE_SESSION_ID: SID }, 'a UUID naming no transcript on this machine', SID],
            [{ CLAUDE_CODE_SESSION_ID: '../../evil' }, 'a value carrying a path separator', null]
        ];
        for (const [extra, why, recorded] of unbound) {
            const res = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/a.md'], {
                cwd: repo, encoding: 'utf8',
                env: armEnv({ ...extra, USERPROFILE: fakeHome, HOME: fakeHome })
            });
            assert.strictEqual(res.status, 0, why + ': ' + res.stderr);
            assert.match(res.stdout, /armed for docs\/plans\/a\.md \(unbound/,
                why + ' must arm unbound and say so');
            assert.strictEqual(TYPED_ROUTE.test(res.stdout), recorded === null,
                why + ' must name the typed route exactly when it is the only one left');
            const raw = rawState(repo);
            assert.strictEqual(raw.boundSession, null, why + ' must write no binding');
            assert.strictEqual(raw.boundTranscript, null, why + ' must write no transcript');
            assert.strictEqual(raw.armingSession, recorded, why + ' records exactly this arming identity');
        }
    } finally {
        rmRepo(repo);
        rmRepo(fakeHome);
    }
});

// A preload that records any directory listing whose target names the needle,
// by creating a marker file. The counterpart of openSpyPreload above: it
// proves a directory was never LISTED, where asserting on stdout alone would
// only prove the result was not used. Both listing doors are patched, because
// the transcript lookup delegates to memq's bounded scan, which lists through
// fs.opendirSync, while other surfaces list through fs.readdirSync; a spy on
// one door reads a walk through the other as silence.
function readdirSpyPreload(dir, needle, marker) {
    const shim = path.join(dir, 'readdir-spy.js');
    fs.writeFileSync(shim, [
        "'use strict';",
        "const fs = require('fs');",
        'const mark = (target) => {',
        '    if (String(target).includes(' + JSON.stringify(needle) + ')) {',
        '        fs.writeFileSync(' + JSON.stringify(marker) + ", 'x');",
        '    }',
        '};',
        'const realReaddir = fs.readdirSync;',
        'fs.readdirSync = function (target) {',
        '    mark(target);',
        '    return realReaddir.apply(fs, arguments);',
        '};',
        'const realOpendir = fs.opendirSync;',
        'fs.opendirSync = function (target) {',
        '    mark(target);',
        '    return realOpendir.apply(fs, arguments);',
        '};'
    ].join('\n') + '\n', 'utf8');
    return '--require "' + shim.replace(/\\/g, '/') + '"';
}

test('CLI arm tests the session id shape before it touches the filesystem', () => {
    const repo = makeRepo();
    const fakeHome = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        const marker = path.join(repo, 'listed-projects.marker');
        const projects = path.join(fakeHome, '.claude', 'projects');
        fs.mkdirSync(path.join(projects, 'D--real'), { recursive: true });
        fs.writeFileSync(path.join(projects, 'D--real', SID + '.jsonl'), '{}\n', 'utf8');
        const preload = readdirSpyPreload(repo, 'projects', marker);
        const spawn = (sessionId) => spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/a.md'], {
            cwd: repo, encoding: 'utf8',
            env: armEnv({
                CLAUDE_CODE_SESSION_ID: sessionId, USERPROFILE: fakeHome, HOME: fakeHome,
                NODE_OPTIONS: preload
            })
        });

        // Arbitrary environment content never drives a directory scan: the
        // shape decides first, so a refused value costs nothing at all.
        for (const junk of ['not-a-uuid', '../../evil', 'x'.repeat(400)]) {
            const res = spawn(junk);
            assert.strictEqual(res.status, 0, junk + ': ' + res.stderr);
            assert.ok(!fs.existsSync(marker), JSON.stringify(junk) + ' must not list the projects tree');
        }

        // The other direction: a shaped id does list it, so the assertions
        // above are the ordering working rather than a spy that never fires.
        const res = spawn(SID);
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /\(bound to this session\)/);
        assert.ok(fs.existsSync(marker), 'a shaped id is looked up');
    } finally {
        rmRepo(repo);
        rmRepo(fakeHome);
    }
});

test('CLI arm records the arming session\'s transcript when one exists under the harness projects tree', () => {
    const repo = makeRepo();
    const fakeHome = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        // The harness names each project directory by munging the project
        // path, so the CLI scans the directories for the one holding
        // <sessionId>.jsonl rather than reproducing the munging. A decoy
        // directory sitting ahead of the real one proves the scan, not a
        // guessed path, is what finds it.
        const projects = path.join(fakeHome, '.claude', 'projects');
        fs.mkdirSync(path.join(projects, 'D--decoy'), { recursive: true });
        fs.mkdirSync(path.join(projects, 'D--real'), { recursive: true });
        const transcript = path.join(projects, 'D--real', SID + '.jsonl');
        fs.writeFileSync(transcript, '{}\n', 'utf8');

        let res = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/a.md'], {
            cwd: repo, encoding: 'utf8',
            env: armEnv({ CLAUDE_CODE_SESSION_ID: SID, USERPROFILE: fakeHome, HOME: fakeHome })
        });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /\(bound to this session\)/);
        assert.strictEqual(readGoal(repo).boundTranscript, transcript);

        // The status report then renders the liveness hint from that file,
        // which is the whole reason the path is recorded.
        res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, new RegExp('bound to session ' + SID + ', last active less than a minute ago'));

        // A different session id, with no transcript of its own under that
        // tree, arms unbound: the lookup is the corroboration, so nothing
        // found means nothing bound, and the previous holder's binding is
        // replaced rather than inherited.
        res = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/a.md'], {
            cwd: repo, encoding: 'utf8',
            env: armEnv({ CLAUDE_CODE_SESSION_ID: SID2, USERPROFILE: fakeHome, HOME: fakeHome })
        });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /\(unbound/);
        assert.strictEqual(readGoal(repo).boundSession, null);
        assert.strictEqual(readGoal(repo).boundTranscript, null);
        assert.strictEqual(readGoal(repo).armingSession, SID2,
            'the shaped id is recorded, so that session claims at its own first stop');

        // And an unreadable projects tree (here, a file where the directory
        // would be) arms unbound silently rather than failing the arm: the
        // claim points still bind the goal at the run's first stop.
        const brokenHome = makeRepo();
        try {
            fs.mkdirSync(path.join(brokenHome, '.claude'), { recursive: true });
            fs.writeFileSync(path.join(brokenHome, '.claude', 'projects'), 'not a directory\n', 'utf8');
            res = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/a.md'], {
                cwd: repo, encoding: 'utf8',
                env: armEnv({ CLAUDE_CODE_SESSION_ID: SID, USERPROFILE: brokenHome, HOME: brokenHome })
            });
            assert.strictEqual(res.status, 0, res.stderr);
            assert.match(res.stdout, /\(unbound/);
            assert.strictEqual(res.stderr, '', 'a failed transcript lookup is silent');
            assert.strictEqual(readGoal(repo).boundSession, null);
            assert.strictEqual(readGoal(repo).boundTranscript, null);
            assert.strictEqual(readGoal(repo).armingSession, SID,
                'the shaped id is recorded even where the projects tree cannot be listed');
        } finally {
            rmRepo(brokenHome);
        }
    } finally {
        rmRepo(repo);
        rmRepo(fakeHome);
    }
});

test('CLI arm treats a session id two project directories hold as uncorroborated', () => {
    // The lookup delegates to memq's shared transcript scan, whose ambiguity
    // rule is that two matches are not an answer: a session resumed from a
    // different directory is filed twice, and taking the first would let
    // readdir order decide which transcript corroborates the binding. So the
    // arm lands unbound, with the shaped id recorded for the claim points,
    // exactly as an id with no transcript at all does.
    const repo = makeRepo();
    const fakeHome = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        const projects = path.join(fakeHome, '.claude', 'projects');
        for (const seg of ['D--one', 'D--two']) {
            fs.mkdirSync(path.join(projects, seg), { recursive: true });
            fs.writeFileSync(path.join(projects, seg, SID + '.jsonl'), '{}\n', 'utf8');
        }
        const res = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/a.md'], {
            cwd: repo, encoding: 'utf8',
            env: armEnv({ CLAUDE_CODE_SESSION_ID: SID, USERPROFILE: fakeHome, HOME: fakeHome })
        });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /\(unbound/, 'two filings arm unbound');
        assert.strictEqual(readGoal(repo).boundSession, null);
        assert.strictEqual(readGoal(repo).boundTranscript, null);
        assert.strictEqual(readGoal(repo).armingSession, SID,
            'the shaped id is still recorded for the claim points');

        // The withheld control, matched on shape: removing one filing makes
        // the same id corroborate, so the unbound arm above is the ambiguity
        // refusing rather than a scan that never found either.
        fs.rmSync(path.join(projects, 'D--two', SID + '.jsonl'));
        const single = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/a.md'], {
            cwd: repo, encoding: 'utf8',
            env: armEnv({ CLAUDE_CODE_SESSION_ID: SID, USERPROFILE: fakeHome, HOME: fakeHome })
        });
        assert.strictEqual(single.status, 0, single.stderr);
        assert.match(single.stdout, /\(bound to this session\)/);
        assert.strictEqual(readGoal(repo).boundTranscript,
            path.join(projects, 'D--one', SID + '.jsonl'));
    } finally {
        rmRepo(repo);
        rmRepo(fakeHome);
    }
});

test('CLI arm refuses a bad plan path unchanged, whether or not a session id is present', () => {
    const repo = makeRepo();
    const fakeHome = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        // The binding is not a second failure mode: a refusal reads exactly as
        // it did before, names the offender, writes no state, and never
        // mentions a binding that did not happen.
        const res = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/a.md', 'docs/plans/gone.md'], {
            cwd: repo, encoding: 'utf8',
            env: armEnv({ CLAUDE_CODE_SESSION_ID: SID, USERPROFILE: fakeHome, HOME: fakeHome })
        });
        assert.strictEqual(res.status, 1);
        assert.match(res.stderr, /not found: docs\/plans\/gone\.md/);
        assert.doesNotMatch(res.stdout, /bound/);
        assert.ok(!fs.existsSync(goalPath(repo)), 'a refused arm writes no state, bind or no bind');
    } finally {
        rmRepo(repo);
        rmRepo(fakeHome);
    }
});

test('emitGoalEvent adds a run field only for a KIT_RUN_ID that memq\'s isRunId itself would accept', () => {
    // run is gated on memq's own isRunId rather than on raw truthiness, so the
    // two producers that answer to a run id (this event stream, and memq's
    // pending-tier routing) cannot disagree about what one looks like. Every
    // case memq would refuse is pinned here as a refusal too: a value that is
    // truthy but carries no charset-legal id (Unicode, a control character), a
    // well-formed-looking value isRunId still refuses by name (a dots-only
    // name), and a value over memq's own 40-character cap.
    withEventSink((sink) => {
        const prior = process.env.KIT_RUN_ID;
        const setAndEmit = (value, detail) => {
            if (value === undefined) delete process.env.KIT_RUN_ID;
            else process.env.KIT_RUN_ID = value;
            emitGoalEvent(Object.assign({ event: 'goal-blocked', project: 'D:/repo', plan: 'docs/plans/foo.md' },
                detail ? { detail } : {}));
            const lines = readEventLines(sink);
            return JSON.parse(lines[lines.length - 1]);
        };
        const assertNoRun = (value, why) => {
            const ev = setAndEmit(value);
            assert.strictEqual(Object.keys(ev).includes('run'), false, why);
        };
        try {
            assertNoRun(undefined, 'no run key at all when KIT_RUN_ID is unset');
            // An empty string reads as unset, matching memq's isRunId (an
            // interpolation that resolved to nothing is not a run).
            assertNoRun('', 'an empty KIT_RUN_ID is treated as unset');
            // Truthy but no charset-legal run id survives: isRunId's grammar is
            // ASCII word characters, dot, and hyphen only, so this refuses
            // before eventField ever gets a chance to normalize it away and
            // ship run:"". This is the adversarial reviewer's own probe.
            assertNoRun('\u65e5\u672c', 'a value with no charset-legal id (here, non-ASCII) must not ship run:""');
            // A control character alone is the blind reviewer's version of the
            // same defect.
            assertNoRun('\u0007', 'a value that normalizes to nothing must not ship run:""');
            // Dots-only names are a path token or a name Win32 collapses, never
            // a run: isRunId refuses them by name even though '.' is inside
            // its own charset, so this is the "well-formed-looking" refusal.
            assertNoRun('..', 'a dots-only id looks well-formed but must still be refused, matching memq');
            // Over memq's RUN_ID_CAP: two distinct over-long ids must not alias
            // onto one run value in the stream, so this is refused outright
            // rather than truncated.
            assertNoRun('x'.repeat(41), 'an id past memq\'s 40-character cap must be refused, not truncated');

            const withRun = setAndEmit('r1', 'plan-complete');
            assert.deepStrictEqual(Object.keys(withRun), ['ts', 'event', 'project', 'plan', 'session', 'detail', 'run'],
                'run rides after detail, present exactly when KIT_RUN_ID names a well-formed id');
            assert.strictEqual(withRun.run, 'r1');

            // Exactly at memq's cap is still accepted (the cap is inclusive).
            const atCap = setAndEmit('x'.repeat(40));
            assert.strictEqual(atCap.run, 'x'.repeat(40), 'an id at exactly the 40-character cap is accepted');
        } finally {
            if (prior === undefined) delete process.env.KIT_RUN_ID;
            else process.env.KIT_RUN_ID = prior;
        }
    });
});

// Count the calls fs.readFileSync takes for the duration of fn, which is what
// discriminates a path refused before the open from one whose open merely
// happened to fail. The blocking hazard readGoal's preamble exists to close is
// a read that never returns, so "did not open it" is the property under test,
// not "returned null": a directory returns null through the catch either way.
function countingReads(fn) {
    const realReadFileSync = fs.readFileSync;
    let reads = 0;
    fs.readFileSync = function (...args) {
        reads += 1;
        return realReadFileSync.apply(fs, args);
    };
    try {
        return fn(() => reads);
    } finally {
        fs.readFileSync = realReadFileSync;
    }
}

test('readGoal refuses a non-regular goal-state path without opening it', () => {
    // A directory at the path is the kind this box can stage. The kinds that
    // carry the real hazard, a FIFO and a file symlink, cannot be created here
    // (Windows has no mkfifo, and fs.symlinkSync returns EPERM without
    // privilege), so they are unproven rather than covered; all three fail the
    // same isFile() leg, which is what this exercises.
    const repo = makeRepo();
    try {
        fs.mkdirSync(goalPath(repo), { recursive: true });
        countingReads((reads) => {
            assert.strictEqual(readGoal(repo), null, 'a non-regular goal-state path reads as absent');
            assert.strictEqual(reads(), 0, 'the path is refused before the open a FIFO would block inside');
        });
    } finally {
        rmRepo(repo);
    }
});

test('readGoal refuses a link planted at the goal-state path without following it', () => {
    const repo = makeRepo();
    try {
        const target = path.join(repo, 'link-target');
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, 'kept.txt'), 'kept\n', 'utf8');
        fs.mkdirSync(path.dirname(goalPath(repo)), { recursive: true });
        // A directory junction is the link kind this box creates without
        // privilege; a file symlink needs one, so that kind stays unproven.
        // The lstat judges either as a link rather than as its target.
        fs.symlinkSync(target, goalPath(repo), 'junction');
        countingReads((reads) => {
            assert.strictEqual(readGoal(repo), null, 'a link at the goal-state path reads as absent');
            assert.strictEqual(reads(), 0, 'the link is refused before the open, so it is never followed');
        });
        assert.ok(fs.existsSync(path.join(target, 'kept.txt')), 'the link target is untouched');
    } finally {
        rmRepo(repo);
    }
});

test('readGoal refuses an oversized goal-state file and still reads a large one under the cap', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        const base = {
            plan: 'docs/plans/foo.md', condition: 'c', armedAt: '2026-08-16T00:00:00.000Z',
            boundSession: null, boundTranscript: null,
            queue: ['docs/plans/foo.md'], queueIndex: 0, history: []
        };
        const write = (padBytes) => {
            fs.mkdirSync(path.dirname(goalPath(repo)), { recursive: true });
            fs.writeFileSync(goalPath(repo),
                JSON.stringify({ ...base, pad: 'x'.repeat(padBytes) }) + '\n', 'utf8');
        };

        // Valid JSON either way, so the cap is the only thing that can refuse
        // it: a reader with no cap parses both and hands back a state.
        write(64 * 1024);
        assert.ok(fs.statSync(goalPath(repo)).size > 64 * 1024, 'setup: the file is past the cap');
        assert.strictEqual(readGoal(repo), null, 'a goal-state file past the cap reads as absent');

        write(1024);
        const state = readGoal(repo);
        assert.ok(state, 'a state well under the cap still reads');
        assert.strictEqual(state.plan, 'docs/plans/foo.md');
    } finally {
        rmRepo(repo);
    }
});

test('a valid goal state still round-trips through writeState and readGoal', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        writePlan(repo, 'docs/plans/b.md', 'Status: In Progress\n');
        const armed = armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md'],
            { sessionId: SID, transcriptPath: path.join(repo, 'transcript.jsonl') });
        assert.strictEqual(armed.ok, true);
        const state = readGoal(repo);
        assert.strictEqual(state.plan, 'docs/plans/a.md');
        assert.deepStrictEqual(state.queue, ['docs/plans/a.md', 'docs/plans/b.md']);
        assert.strictEqual(state.boundSession, SID, 'the exclusive-create write stores the binding unchanged');
        assert.deepStrictEqual(tmpLeftovers(repo), [], 'and leaves no temp file behind');
    } finally {
        rmRepo(repo);
    }
});

test('writeState refuses a file pre-planted at its temp path instead of writing through it', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        fs.mkdirSync(path.dirname(goalPath(repo)), { recursive: true });
        withPinnedTmpPath(repo, (tmp) => {
            fs.writeFileSync(tmp, 'planted\n', 'utf8');
            const result = armGoal(repo, 'docs/plans/foo.md');
            // Without the exclusive-create flag this write would overwrite the
            // planted path and rename it into place, arming successfully; with
            // it the create fails and the arm is refused.
            assert.strictEqual(result.ok, false, 'an occupied temp path fails the create');
            assert.deepStrictEqual(Object.keys(result), ['ok', 'reason'], 'the refusal shape is unchanged');
            assert.ok(result.reason.startsWith('could not write goal state: '),
                'the reason keeps its prefix: ' + result.reason);
            assert.ok(!fs.existsSync(goalPath(repo)), 'and nothing lands at the goal-state path');
            // The cleanup deletes the tmp path on a failure, but an EEXIST says
            // this process did not create that file, so it must survive: a
            // delete on this leg would be an aimed delete of someone else's
            // file at a path this process merely guessed at.
            assert.ok(fs.existsSync(tmp), 'a file this process did not create is left where it was');
            assert.strictEqual(fs.readFileSync(tmp, 'utf8'), 'planted\n', 'and is left as it was');
        });
    } finally {
        rmRepo(repo);
    }
});

// Count the opens fs.openSync takes for the duration of fn, the openSync twin of
// countingReads above: planHead opens rather than reads, and the property under
// test is that a refused path is never opened at all.
function countingOpens(fn) {
    const realOpenSync = fs.openSync;
    let opens = 0;
    fs.openSync = function (...args) {
        opens += 1;
        return realOpenSync.apply(fs, args);
    };
    try {
        return fn(() => opens);
    } finally {
        fs.openSync = realOpenSync;
    }
}

test('planHead refuses a non-regular plan path without opening it', () => {
    const repo = makeRepo();
    try {
        // The plan path comes from the goal-state file and is only ever
        // re-validated as a PATH (inside the repo, no control characters),
        // never as a kind, so a FIFO at a well-formed in-repo plan path passes
        // every check above this one and blocks a POSIX open until a writer
        // appears, with the Stop hook holding a stop. A directory and a
        // junction are the kinds this box can stage; all three fail the same
        // isFile() branch.
        fs.mkdirSync(path.join(repo, 'docs', 'plans', 'adir.md'), { recursive: true });
        const linkTarget = path.join(repo, 'link-target');
        fs.mkdirSync(linkTarget, { recursive: true });
        fs.symlinkSync(linkTarget, path.join(repo, 'docs', 'plans', 'alink.md'), 'junction');
        countingOpens((opens) => {
            for (const rel of ['docs/plans/adir.md', 'docs/plans/alink.md']) {
                assert.deepStrictEqual(planHead(repo, rel), { exists: false, status: 'unknown' },
                    rel + ' reads as an unopenable plan');
            }
            assert.strictEqual(opens(), 0, 'neither path is opened, which is what a FIFO would block inside');
        });

        // The ordinary path still opens and classifies.
        writePlan(repo, 'docs/plans/real.md', 'Status: In Progress\n');
        assert.deepStrictEqual(planHead(repo, 'docs/plans/real.md'), { exists: true, status: 'in progress' });
    } finally {
        rmRepo(repo);
    }
});

test('armGoal refuses a queue whose own advances would outgrow the goal state file', () => {
    const repo = makeRepo();
    try {
        // Each advance appends a history record, so a queue armed just under the
        // writer's bound would cross it while running: the write would refuse
        // deterministically and the Stop hook would block at every stop with an
        // advance it can never record, which no retry clears. The room every
        // record this queue can produce is reserved at arm time instead, where a
        // person is present to read the refusal.
        const name = (i) => 'docs/plans/p' + String(i).padStart(4, '0') + 'x'.repeat(70) + '.md';
        const many = [];
        for (let i = 0; i < 200; i += 1) {
            writePlan(repo, name(i), 'Status: In Progress\n');
            many.push(name(i));
        }

        const small = armGoal(repo, many.slice(0, 40));
        assert.strictEqual(small.ok, true, 'a queue whose whole life fits is armed');
        assert.ok(fs.statSync(goalPath(repo)).size < 64 * 1024, 'setup: that state is under the cap');
        assert.ok(readGoal(repo), 'and it reads back');

        // 200 of these paths arm to well under the cap and would cross it only
        // through their own advances, so this case answers to the reserved
        // headroom and not to the writer's plain size refusal.
        const big = armGoal(repo, many);
        assert.strictEqual(big.ok, false, 'a queue that cannot finish inside the bound is refused');
        assert.deepStrictEqual(Object.keys(big), ['ok', 'reason'], 'the refusal shape is unchanged');
        assert.ok(/queue is too long: 200 plans/.test(big.reason),
            'the refusal names the queue rather than a byte count: ' + big.reason);
        assert.ok(!/could not write goal state/.test(big.reason),
            'and it is the arm-time reservation refusing, not the write: ' + big.reason);
        assert.strictEqual(readGoal(repo).queue.length, 40, 'the refused arm left the armed state untouched');
        assert.deepStrictEqual(tmpLeftovers(repo), [], 'and wrote no tmp at all');
    } finally {
        rmRepo(repo);
    }
});

test('a rename reporting EEXIST still removes the tmp this process created', () => {
    const repo = makeRepo();
    const realRenameSync = fs.renameSync;
    try {
        // POSIX rename() reports EEXIST or ENOTEMPTY when the destination is a
        // non-empty directory, and the catch below the write spans both the
        // exclusive create and the rename. A cleanup gated on the error code
        // rather than on who made the file would read that EEXIST as "the file
        // was already there", skip the unlink, and orphan a full copy of the
        // goal state, boundSession and boundTranscript included, under a new
        // random name on every retry. This box reports EPERM for that rename
        // (confirmed by staging one), so the code is what is staged here rather
        // than the directory that would produce it elsewhere.
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        fs.renameSync = function () {
            const err = new Error('EEXIST: file already exists, rename');
            err.code = 'EEXIST';
            throw err;
        };
        const result = armGoal(repo, 'docs/plans/foo.md');
        assert.strictEqual(result.ok, false, 'the failed rename is reported');
        assert.ok(result.reason.startsWith('could not write goal state: '), result.reason);
        fs.renameSync = realRenameSync;
        assert.deepStrictEqual(tmpLeftovers(repo), [],
            'the tmp this process created is removed whatever code the failure carried');
    } finally {
        fs.renameSync = realRenameSync;
        rmRepo(repo);
    }
});

test('a write that fails after the create leaves no temp file behind', () => {
    const repo = makeRepo();
    const realWriteFileSync = fs.writeFileSync;
    try {
        // The unlink is gated on a flag that has to mean "this process created
        // the file". A create and a write spelled as one call cannot set that
        // flag between them, so a failure part-way through the write leg
        // (ENOSPC, EDQUOT, EIO) skips the cleanup and strands a partial copy of
        // the goal state, boundSession and boundTranscript included, under a
        // name no later run can recognize. Staged both ways here: a write given
        // an fd fails outright, and a write given a path creates the file first
        // and then fails, which is the shape a single-call spelling takes.
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        fs.writeFileSync = function (target, data, options) {
            if (typeof target === 'string' && /goal-state\.json\.tmp\./.test(target)) {
                realWriteFileSync.call(fs, target, '', options);
            }
            const err = new Error('ENOSPC: no space left on device, write');
            err.code = 'ENOSPC';
            throw err;
        };
        const result = armGoal(repo, 'docs/plans/foo.md');
        fs.writeFileSync = realWriteFileSync;
        assert.strictEqual(result.ok, false, 'the failed write is reported');
        assert.ok(result.reason.startsWith('could not write goal state: '), result.reason);
        assert.ok(!fs.existsSync(goalPath(repo)), 'nothing lands at the goal-state path');
        assert.deepStrictEqual(tmpLeftovers(repo), [],
            'and the file the create made is removed rather than orphaned');
    } finally {
        fs.writeFileSync = realWriteFileSync;
        rmRepo(repo);
    }
});

test('a write sweeps temp files a killed writer abandoned, and leaves fresh ones alone', () => {
    const repo = makeRepo();
    try {
        // Cleanup inside writeState covers every failure it can catch. A process
        // killed between the create and the rename catches nothing, and the
        // random suffix means no later run can recognize that file by name, so
        // age is the only signal left. A fresh one belongs to a writer that may
        // still be mid-write, so it stays.
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        fs.mkdirSync(path.dirname(goalPath(repo)), { recursive: true });
        const stale = goalPath(repo) + '.tmp.999999.deadbeefcafe';
        const fresh = goalPath(repo) + '.tmp.999998.cafedeadbeef';
        fs.writeFileSync(stale, 'abandoned\n', 'utf8');
        fs.writeFileSync(fresh, 'in flight\n', 'utf8');
        const old = Date.now() - 30 * 60 * 1000;
        fs.utimesSync(stale, new Date(old), new Date(old));

        assert.strictEqual(armGoal(repo, 'docs/plans/foo.md').ok, true);
        assert.deepStrictEqual(tmpLeftovers(repo), [path.basename(fresh)],
            'the aged orphan is reclaimed and the recent one is left where it is');
    } finally {
        rmRepo(repo);
    }
});

test('a queue armed at the reservation edge runs every advance without a refusal', () => {
    const repo = makeRepo();
    try {
        // The reservation's whole claim is that a state which arms can also
        // finish. This drives the largest queue that arms all the way to its
        // last plan, with every growing field at its worst case: a bind writing
        // a full-length session id and transcript, and every advance recording a
        // blocked outcome whose note and lead key are all quote characters, each
        // of which JSON-escapes to two bytes. A single refusal anywhere in here
        // is the permanent trap the guard exists to prevent, since the Stop hook
        // retries that same write at every stop.
        const name = (i) => 'docs/plans/p' + String(i).padStart(4, '0') + 'x'.repeat(70) + '.md';
        const many = [];
        for (let i = 0; i < 200; i += 1) {
            writePlan(repo, name(i), 'Status: In Progress\n');
            many.push(name(i));
        }

        // Binary search for the edge rather than hardcoding it, so the case
        // still sits on the boundary if the reservation is ever re-tuned.
        let fits = 1;
        let over = many.length + 1;
        while (over - fits > 1) {
            const mid = Math.floor((fits + over) / 2);
            if (armGoal(repo, many.slice(0, mid)).ok) fits = mid;
            else over = mid;
        }
        assert.ok(fits > 1 && fits < many.length, 'setup: the edge is inside the fixture: ' + fits);
        assert.strictEqual(armGoal(repo, many.slice(0, fits)).ok, true, 'the edge queue arms');

        assert.strictEqual(bindSession(repo, '"'.repeat(128), 'C:/' + '"'.repeat(509)).ok, true,
            'a bind writes its two fields onto the edge state');

        for (let step = 1; step < fits; step += 1) {
            const advanced = advanceGoal(repo, {
                outcome: 'blocked', note: '"'.repeat(120), leadKey: '"'.repeat(128)
            });
            assert.strictEqual(advanced.ok, true, 'advance ' + step + ' of ' + (fits - 1)
                + ' must not be refused: ' + (advanced.reason || ''));
            assert.strictEqual(advanced.advanced, true, 'and it moves the leash');
        }

        const state = readGoal(repo);
        assert.ok(state, 'the finished state is still inside the reader cap');
        assert.strictEqual(state.plan, many[fits - 1], 'the leash reached the last plan of the queue');
        assert.strictEqual(state.history.length, fits - 1, 'with one record per advance');
        assert.ok(fs.statSync(goalPath(repo)).size <= 64 * 1024,
            'peak size ' + fs.statSync(goalPath(repo)).size + ' bytes stayed inside the bound');
    } finally {
        rmRepo(repo);
    }
});

test('writeState refuses to produce a state past the cap its readers enforce', () => {
    const repo = makeRepo();
    try {
        // A hand-written state (a repository can carry one) sized just inside
        // the reader's cap, so the binding a stop adds is what crosses it.
        // Without the same bound at the write the file would land, the CLI would
        // report the goal armed, and every reader would then answer "no goal
        // armed" with no error anywhere in between, which is what a bound
        // enforced on one side only produces.
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        const base = {
            plan: 'docs/plans/foo.md', condition: 'c', armedAt: '2026-08-16T00:00:00.000Z',
            boundSession: null, boundTranscript: null,
            queue: ['docs/plans/foo.md'], queueIndex: 0, history: []
        };
        const pad = 64 * 1024 - Buffer.byteLength(JSON.stringify({ ...base, pad: '' }, null, 2) + '\n', 'utf8') - 200;
        fs.mkdirSync(path.dirname(goalPath(repo)), { recursive: true });
        fs.writeFileSync(goalPath(repo), JSON.stringify({ ...base, pad: 'x'.repeat(pad) }, null, 2) + '\n', 'utf8');
        const before = fs.readFileSync(goalPath(repo), 'utf8');
        assert.ok(readGoal(repo), 'setup: the state is still inside the reader cap');

        const result = bindSession(repo, 'x'.repeat(128), 'C:/' + 'y'.repeat(500) + '.jsonl');
        assert.strictEqual(result.ok, false, 'the binding would cross the cap, so the write is refused');
        assert.deepStrictEqual(Object.keys(result), ['ok', 'reason'], 'the refusal shape is unchanged');
        assert.ok(result.reason.startsWith('could not write goal state: '),
            'the reason keeps its prefix: ' + result.reason);
        assert.ok(/past the 65536-byte bound/.test(result.reason), 'and names the bound: ' + result.reason);
        assert.strictEqual(fs.readFileSync(goalPath(repo), 'utf8'), before, 'the file on disk is untouched');
        assert.deepStrictEqual(tmpLeftovers(repo), [], 'and no tmp was written');
    } finally {
        rmRepo(repo);
    }
});

test('writeState refuses a link pre-planted at its temp path rather than following it', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        fs.mkdirSync(path.dirname(goalPath(repo)), { recursive: true });
        const target = path.join(repo, 'link-target');
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, 'kept.txt'), 'kept\n', 'utf8');
        withPinnedTmpPath(repo, (tmp) => {
            // A directory junction, the link kind this box creates without
            // privilege; a file symlink needs one it lacks. There is no lstat
            // on the write path, so what refuses this is the exclusive-create
            // flag alone, and the error code is what tells the two refusals
            // apart: EEXIST is the flag declining an occupied path, where a
            // write with no flag reaches the open and fails EISDIR on the
            // directory behind the junction.
            fs.symlinkSync(target, tmp, 'junction');
            const result = armGoal(repo, 'docs/plans/foo.md');
            assert.strictEqual(result.ok, false, 'an occupied temp path fails the create');
            assert.ok(result.reason.startsWith('could not write goal state: '),
                'the reason keeps its prefix: ' + result.reason);
            assert.ok(result.reason.includes('EEXIST'),
                'the flag refused it, rather than the open failing on the link target: ' + result.reason);
            assert.ok(!fs.existsSync(goalPath(repo)), 'and nothing lands at the goal-state path');
            assert.ok(fs.existsSync(path.join(target, 'kept.txt')), 'the link target is untouched');
        });
    } finally {
        rmRepo(repo);
    }
});

// The append direction of the queue's two spellings. Its whole point is that
// nothing already armed moves: an append that re-derived the binding would hand
// the leash to whoever happened to run the CLI, and one that moved armedAt would
// make every in-flight advance's compare-and-swap refuse.
test('appendGoal grows the queue under the existing binding, leaving the current plan and the history alone', () => {
    const repo = makeRepo();
    try {
        for (const name of ['a', 'b', 'c']) {
            writePlan(repo, 'docs/plans/' + name + '.md', 'Status: In Progress\n');
        }
        assert.strictEqual(armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md']).ok, true);
        assert.strictEqual(bindSession(repo, SID, path.join(repo, 'transcript.jsonl')).ok, true);
        const before = readGoal(repo);

        const result = appendGoal(repo, ['docs/plans/c.md']);
        assert.strictEqual(result.ok, true, result.reason);
        assert.deepStrictEqual(result.appended, ['docs/plans/c.md']);
        assert.deepStrictEqual(result.queue, ['docs/plans/a.md', 'docs/plans/b.md', 'docs/plans/c.md']);

        const after = readGoal(repo);
        assert.deepStrictEqual(after.queue, ['docs/plans/a.md', 'docs/plans/b.md', 'docs/plans/c.md'],
            'an append never drops a queue entry');
        assert.strictEqual(after.plan, before.plan, 'the current plan does not move');
        assert.strictEqual(after.queueIndex, before.queueIndex);
        assert.strictEqual(after.boundSession, before.boundSession, 'the binding is preserved, never re-derived');
        assert.strictEqual(after.boundTranscript, before.boundTranscript);
        assert.strictEqual(after.armedAt, before.armedAt,
            'armedAt is the advance compare-and-swap key, so an append must leave it standing');
        assert.deepStrictEqual(after.history, before.history);
        assert.strictEqual(after.condition, composeCondition(after.plan, after.queue, after.queueIndex));
        assert.match(after.condition, /docs\/plans\/c\.md/, 'the condition names the appended plan');
        assert.deepStrictEqual(tmpLeftovers(repo), []);
    } finally {
        rmRepo(repo);
    }
});

// A duplicate would make the leash advance past the plan once and stall on the
// repeat, which is what armGoal refuses a repeated path for; the append form
// answers to the same rule, against the standing queue as well as against its
// own arguments, and refuses the whole invocation rather than landing the good
// half of it.
test('appendGoal refuses a duplicate atomically, naming it and leaving the queue unchanged', () => {
    const repo = makeRepo();
    try {
        for (const name of ['a', 'b', 'c', 'd']) {
            writePlan(repo, 'docs/plans/' + name + '.md', 'Status: In Progress\n');
        }
        assert.strictEqual(armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md']).ok, true);

        const already = appendGoal(repo, ['docs/plans/c.md', 'docs/plans/b.md']);
        assert.strictEqual(already.ok, false);
        assert.match(already.reason, /docs\/plans\/b\.md/, 'the duplicate is named: ' + already.reason);
        assert.deepStrictEqual(readGoal(repo).queue, ['docs/plans/a.md', 'docs/plans/b.md'],
            'the whole invocation is refused, so the good path never lands either');

        const twice = appendGoal(repo, ['docs/plans/d.md', 'docs/plans/d.md']);
        assert.strictEqual(twice.ok, false);
        assert.match(twice.reason, /docs\/plans\/d\.md/);
        assert.deepStrictEqual(readGoal(repo).queue, ['docs/plans/a.md', 'docs/plans/b.md']);

        // A plan the leash has already finished is still in the queue, and
        // appending it would set the run up to walk it a second time.
        assert.strictEqual(advanceGoal(repo, { outcome: 'complete' }).advanced, true);
        const finished = appendGoal(repo, ['docs/plans/a.md']);
        assert.strictEqual(finished.ok, false);
        assert.match(finished.reason, /docs\/plans\/a\.md/);

        // Nothing above left a half-written state: the good paths still append.
        const good = appendGoal(repo, ['docs/plans/c.md', 'docs/plans/d.md']);
        assert.strictEqual(good.ok, true, good.reason);
        assert.deepStrictEqual(readGoal(repo).queue,
            ['docs/plans/a.md', 'docs/plans/b.md', 'docs/plans/c.md', 'docs/plans/d.md']);
        assert.deepStrictEqual(tmpLeftovers(repo), []);
    } finally {
        rmRepo(repo);
    }
});

// A state file sitting at its path that no reader makes a goal of is not an
// unarmed repo, and the refusal separates the two because the way forward
// differs. The bare arm replaces whatever queue is on disk, and armGoal's
// dropped-plan warning is read from the same file this one cannot read, so a
// refusal naming the bare arm here points at a silent replacement of a leash
// that may be live.
test('appendGoal over a goal state no reader makes a goal of names no arming command', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        const state = goalPath(repo);
        fs.mkdirSync(path.dirname(state), { recursive: true });
        fs.writeFileSync(state, '{not json at all', 'utf8');

        const refused = appendGoal(repo, ['docs/plans/a.md']);
        assert.strictEqual(refused.ok, false);
        assert.match(refused.reason, /could not be read as a goal state/, refused.reason);
        assert.doesNotMatch(refused.reason, /--append is the first arming/,
            'the bare form is not offered over a file this reader cannot see into: ' + refused.reason);
        assert.doesNotMatch(refused.reason, /no goal is armed/,
            'and nothing here reads as a settled unarmed repo: ' + refused.reason);
        // The same cross-surface cap the unarmed reason answers to: kit-goal.js
        // prints every reason through a sanitizer that cuts at 120 characters
        // with no truncation mark.
        assert.ok(refused.reason.length <= 120,
            'the reason fits the CLI\'s 120-character print cap: ' + refused.reason.length);
        assert.strictEqual(fs.readFileSync(state, 'utf8'), '{not json at all',
            'and the refusal left the file exactly as it found it');

        // The second reading that reaches this refusal over a path with
        // something at it: valid JSON carrying a queue and a history and no
        // plan. normalizeState returns such an object unchanged, so readGoal
        // answers a truthy state that is still no goal, and the guard is the
        // path's own emptiness rather than the shape of what readGoal returned.
        // A bare arm named here would replace the queue on disk.
        const notAGoal = JSON.stringify({
            queue: ['docs/plans/a.md'],
            queueIndex: 0,
            history: [{ plan: 'docs/plans/a.md', outcome: 'done' }]
        });
        fs.writeFileSync(state, notAGoal, 'utf8');
        const planless = appendGoal(repo, ['docs/plans/a.md']);
        assert.strictEqual(planless.ok, false);
        assert.match(planless.reason, /could not be read as a goal state/, planless.reason);
        assert.doesNotMatch(planless.reason, /--append is the first arming/,
            'the bare form is not offered over a queue it would replace: ' + planless.reason);
        assert.doesNotMatch(planless.reason, /no goal is armed/, planless.reason);
        assert.strictEqual(fs.readFileSync(state, 'utf8'), notAGoal,
            'and the refusal left that file exactly as it found it too');
    } finally {
        rmRepo(repo);
    }
});

// The arm-time refusals reach the append form too, since a queue entry that
// cannot be read as a plan doc is the same problem wherever it entered the
// queue, and the whole invocation is refused for one bad path exactly as an arm
// is.
test('appendGoal refuses an unarmed repo, a missing plan, a Complete plan, and an escaping path', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        writePlan(repo, 'docs/plans/done.md', 'Status: Complete\n');
        writePlan(repo, 'docs/plans/b.md', 'Status: In Progress\n');

        const unarmed = appendGoal(repo, ['docs/plans/a.md']);
        assert.strictEqual(unarmed.ok, false);
        assert.match(unarmed.reason, /no goal is armed/);
        // The refusal carries the way forward as well as the problem: an append
        // with nothing armed is the state a first arming starts from, and the
        // caller that reached for --append there needs the bare form named.
        assert.match(unarmed.reason, /arm without --append is the first arming/,
            'the refusal points at the bare form: ' + unarmed.reason);
        // The bare form records the arming it is, so the refusal names the flag
        // a run arming a plan it traced a grant for needs there: a rescue naming
        // the command alone steers exactly that run to the spelling that records
        // the wrong arming.
        assert.match(unarmed.reason, /--self-armed rides on it/,
            'and at the flag the bare form takes: ' + unarmed.reason);
        // A cross-surface pin: kit-goal.js prints this reason through a
        // sanitizer that cuts at 120 characters with no truncation mark, so a
        // reason past the cap loses its pointer on the one surface an operator
        // reads it from.
        assert.ok(unarmed.reason.length <= 120,
            'the reason fits the CLI\'s 120-character print cap: ' + unarmed.reason.length);
        assert.ok(!fs.existsSync(goalPath(repo)), 'an append never arms a goal of its own');

        assert.strictEqual(armGoal(repo, 'docs/plans/a.md').ok, true);
        const armedAt = readGoal(repo).armedAt;

        for (const [args, pattern] of [
            [['docs/plans/gone.md'], /not found: docs\/plans\/gone\.md/],
            [['docs/plans/b.md', 'docs/plans/done.md'], /already Complete: docs\/plans\/done\.md/],
            [['../outside.md'], /invalid or outside the repo/],
            [[], /no plan path given/]
        ]) {
            const refused = appendGoal(repo, args);
            assert.strictEqual(refused.ok, false, 'refused: ' + JSON.stringify(args));
            assert.match(refused.reason, pattern);
            const state = readGoal(repo);
            assert.deepStrictEqual(state.queue, ['docs/plans/a.md'], 'the queue is untouched by a refusal');
            assert.strictEqual(state.armedAt, armedAt);
        }
        assert.deepStrictEqual(tmpLeftovers(repo), []);
    } finally {
        rmRepo(repo);
    }
});

// The replace direction, both ways round. A bare arm still replaces the queue
// (that is the compatible behavior), so the only thing standing between an
// operator and a silently unarmed plan is this warning naming what left the
// queue; and a warning that fired when nothing was dropped would train them to
// ignore it.
test('CLI arm warns naming exactly the plans a replace drops, and says nothing when it drops none', () => {
    const repo = makeRepo();
    try {
        for (const name of ['a', 'b', 'c', 'd']) {
            writePlan(repo, 'docs/plans/' + name + '.md', 'Status: In Progress\n');
        }

        const first = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/a.md', 'docs/plans/b.md', 'docs/plans/c.md'],
            { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(first.status, 0, first.stderr);
        assert.strictEqual(first.stderr, '', 'nothing was armed before, so nothing was dropped');

        const replaced = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/a.md', 'docs/plans/d.md'],
            { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(replaced.status, 0, replaced.stderr);
        assert.match(replaced.stderr, /docs\/plans\/b\.md/, 'names a dropped plan: ' + replaced.stderr);
        assert.match(replaced.stderr, /docs\/plans\/c\.md/, 'names the other one: ' + replaced.stderr);
        assert.ok(!replaced.stderr.includes('docs/plans/a.md'),
            'a plan the new queue still carries was not dropped: ' + replaced.stderr);
        assert.ok(!replaced.stderr.includes('docs/plans/d.md'), replaced.stderr);
        assert.deepStrictEqual(readGoal(repo).queue, ['docs/plans/a.md', 'docs/plans/d.md'],
            'the replace itself is unchanged: it is a warning, never a refusal');

        const same = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/d.md', 'docs/plans/a.md'],
            { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(same.status, 0, same.stderr);
        assert.strictEqual(same.stderr, '', 'a re-arm naming the same plans drops none of them');

        // A plan the leash already finished is behind the current position and
        // is not dropped by a re-arm: it left the queue by being completed.
        assert.strictEqual(advanceGoal(repo, { outcome: 'complete' }).advanced, true);
        const past = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/a.md'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(past.status, 0, past.stderr);
        assert.strictEqual(past.stderr, '', 'a finished plan is not a dropped one: ' + past.stderr);
    } finally {
        rmRepo(repo);
    }
});

// The provenance field is derived from the artifact, never asserted by the
// caller: there is no flag that writes it. It is the audit trail the status
// report and the doctor can surface, and it authenticates nothing.
test('an arm records each plan\'s Dispatch Authorization sentence, and an append records the ones it adds', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n\n'
            + '## Dispatch Authorization\n\n'
            + 'Authorized by the operator, 2026-08-25. Any session holding this plan may arm it.\n\n'
            + '## Goal\n\nsomething else entirely.\n');
        writePlan(repo, 'docs/plans/b.md', 'Status: In Progress\n\n## Goal\n\nno authorization here.\n');
        writePlan(repo, 'docs/plans/c.md', 'Status: In Progress\n\n'
            + '## Dispatch Authorization\n\nAuthorized in the c session.\n');

        assert.strictEqual(armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md']).ok, true);
        assert.deepStrictEqual({ ...readGoal(repo).authorizations }, {
            'docs/plans/a.md': 'Authorized by the operator, 2026-08-25.',
            'docs/plans/b.md': null
        }, 'the first sentence verbatim, or the none marker');

        assert.strictEqual(appendGoal(repo, ['docs/plans/c.md']).ok, true);
        assert.deepStrictEqual({ ...readGoal(repo).authorizations }, {
            'docs/plans/a.md': 'Authorized by the operator, 2026-08-25.',
            'docs/plans/b.md': null,
            'docs/plans/c.md': 'Authorized in the c session.'
        }, 'an append records the plans it adds and disturbs no standing entry');
    } finally {
        rmRepo(repo);
    }
});

// The sentence is untrusted file content on its way into a state file several
// surfaces print, so it is held to a printable-ASCII cap rather than stored as
// written. The cap is proved in both directions on purpose: a cap low enough to
// cut the sentences plans actually carry would store half a claim about who
// authorized arming, which reads as whole and cannot be judged, so the
// survives-intact case is as load-bearing as the truncation case.
test('a recorded authorization sentence is screened to printable ASCII and capped', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n\n'
            + '## Dispatch Authorization\n\n'
            + 'Authorized \x07by \x1B[31mthe\n operator ' + 'x'.repeat(400) + '. Second sentence.\n');
        writePlan(repo, 'docs/plans/empty.md',
            'Status: In Progress\n\n## Dispatch Authorization\n\n## Goal\n\nnothing under the heading.\n');

        assert.strictEqual(armGoal(repo, ['docs/plans/a.md', 'docs/plans/empty.md']).ok, true);
        const recorded = readGoal(repo).authorizations['docs/plans/a.md'];
        assert.strictEqual(recorded.length, 320, 'capped: ' + recorded);
        assert.ok(!/[^\x20-\x7E]/.test(recorded), 'printable ASCII only: ' + JSON.stringify(recorded));
        assert.ok(recorded.startsWith('Authorized by [31mthe operator '), JSON.stringify(recorded));
        assert.ok(recorded.endsWith(' ...[truncated]'),
            'the cut is marked, so what was stored does not read as the whole claim: ' + recorded);
        // The stored value is screened again on every read, so the round trip
        // through the state file is where the screen's idempotency actually has
        // to hold: a mark the next read cut off would be a silent truncation one
        // read later.
        assert.strictEqual(readGoal(repo).authorizations['docs/plans/a.md'], recorded,
            'a second read of the same file records the same marked value');
        assert.strictEqual(readGoal(repo).authorizations['docs/plans/empty.md'], null,
            'a heading with no sentence under it records as none rather than as an empty quote');
    } finally {
        rmRepo(repo);
    }
});

// The control for the cap above, written from the real sentence rather than an
// invented one: the first plan to carry a Dispatch Authorization section quotes
// the operator's own words and runs to 268 characters. A cap that cuts this is
// the defect, so this pins the length the field has to hold.
test('a real-length authorization sentence is recorded whole, not truncated', () => {
    const repo = makeRepo();
    try {
        const real = 'Authorized by the operator, 2026-08-25, in the main kit session '
            + '("build a spec out of the backlog items to tackle this scenario, and then '
            + 'queue that up for the Opus KIT: Shared Messages session to run when '
            + 'complete, exactly as my standing authorization should grant").';
        // A length this case depends on, stated so a reworded fixture that no
        // longer exercises the cap fails here rather than passing quietly. It
        // pins this literal, not the plan doc it was copied from.
        assert.strictEqual(real.length, 268, 'this fixture is written to be 268 characters long');

        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n\n'
            + '## Dispatch Authorization\n\n' + real + ' A second sentence follows.\n');

        assert.strictEqual(armGoal(repo, ['docs/plans/a.md']).ok, true);
        assert.strictEqual(readGoal(repo).authorizations['docs/plans/a.md'], real,
            'the whole sentence is stored: a claim cut mid-clause reads as whole and cannot be judged');

        // The status report is where a reader actually judges the claim, so the
        // render answers to the same rule the store does. A value held whole and
        // printed cut is the same defect one step later: what reaches the reader
        // is half a claim presented as the whole recorded one.
        const status = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(status.status, 0, status.stderr);
        assert.ok(status.stdout.includes('(authorization: ' + real + ')'),
            'the whole sentence reaches the report: ' + status.stdout);
    } finally {
        rmRepo(repo);
    }
});

// The sentence is quoted from a plan doc, so it carries whatever an author
// wrote into it, an absolute home-anchored path included, and this report is
// echoed into a session's context by the /kit-goal skill. The store-side screen
// is a printable-ASCII rule and a cap and elides nothing, so the OS account name
// inside such a path reaches that channel unless the print goes through the
// channel's own renderer. It runs at the authorization cap rather than the
// renderer's default of 120, which is the cap the sentence is stored under and
// what keeps a claim from being printed cut.
test('the status report elides a home directory named inside an authorization sentence', () => {
    const repo = makeRepo();
    // A fixture account name that appears nowhere else in this run's output, so
    // an assertion that it is absent reads the renderer rather than the box's
    // own temp path.
    const account = 'zephyrina';
    const home = path.join(repo, 'fixture-home', account);
    try {
        fs.mkdirSync(path.join(home, 'work', 'threads'), { recursive: true });
        const sentence = 'Authorized by the operator on the thread rooted at '
            + path.join(home, 'work', 'threads') + ' and queued from there.';
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n\n'
            + '## Dispatch Authorization\n\n' + sentence + '\n');

        assert.strictEqual(armGoal(repo, ['docs/plans/a.md']).ok, true);
        assert.strictEqual(readGoal(repo).authorizations['docs/plans/a.md'], sentence,
            'test setup: the whole sentence is stored, the absolute path in it included');

        // The child's home directory is the fixture, since the elision table is
        // compiled once from os.homedir() at library load.
        const status = spawnSync(process.execPath, [CLI, 'status'], {
            cwd: repo,
            encoding: 'utf8',
            env: { ...process.env, HOME: home, USERPROFILE: home }
        });
        assert.strictEqual(status.status, 0, status.stderr);
        assert.ok(!status.stdout.includes(account),
            'the account name is absent from the report: ' + status.stdout);
        assert.ok(status.stdout.includes('(authorization: Authorized by the operator on the thread '
            + 'rooted at ~' + path.sep + path.join('work', 'threads') + ' and queued from there.)'),
            'and the sentence still reaches the reader whole, with the home directory under the '
            + 'shorthand the operator reads it by: ' + status.stdout);
    } finally {
        rmRepo(repo);
    }
});

// The map is keyed by untrusted, hand-editable strings and then read by key, so
// it is built without a prototype and read as own keys only. A plain object
// answers a key it never recorded with whatever Object.prototype carries under
// that name, and the status report prints what it is handed: a plan path of
// 'toString' with no entry of its own would render a native function as the
// authorization that plan recorded, which is a fabricated provenance claim.
test('a hand-edited authorizations map cannot forge an entry through the prototype', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'toString', 'Status: In Progress\n');
        fs.mkdirSync(path.join(repo, '.kit'), { recursive: true });
        // Written as text rather than through an object literal: a literal
        // '__proto__' key is the prototype syntax and never becomes an own
        // property, where JSON.parse of the same text does create one, which is
        // the shape a hand-edited state file actually arrives in.
        fs.writeFileSync(goalPath(repo), '{\n'
            + '  "plan": "toString",\n'
            + '  "condition": "x",\n'
            + '  "armedAt": "' + new Date().toISOString() + '",\n'
            + '  "boundSession": null,\n'
            + '  "boundTranscript": null,\n'
            + '  "queue": ["toString"],\n'
            + '  "queueIndex": 0,\n'
            + '  "history": [],\n'
            + '  "authorizations": {\n'
            + '    "docs/plans/gone.md": "Authorized by nobody.",\n'
            + '    "__proto__": "Authorized by nobody."\n'
            + '  }\n'
            + '}\n', 'utf8');

        const state = readGoal(repo);
        assert.strictEqual(Object.getPrototypeOf(state.authorizations), null,
            'the map carries no prototype, so no key can be answered by an inherited value');
        assert.deepStrictEqual(Object.keys(state.authorizations), [],
            'a key that is not a queued plan is pruned rather than propagated');

        const status = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(status.status, 0, status.stderr);
        assert.match(status.stdout, /authorization: none recorded/,
            'a plan with no recorded authorization reports none: ' + status.stdout);
    } finally {
        rmRepo(repo);
    }
});

// An append is a read-modify-write over a file a leashed session's Stop hook
// writes too, so it verifies the state it decided from is still the state on
// disk. Without that check the append writes back its own pre-advance snapshot
// and the advance is undone: the leash walks back to the finished plan and the
// record of finishing it is gone.
test('appendGoal refuses an append whose state moved under it, leaving the advance standing', () => {
    const repo = makeRepo();
    const realOpen = fs.openSync;
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n');
        writePlan(repo, 'docs/plans/b.md', 'Status: In Progress\n');
        writePlan(repo, 'docs/plans/c.md', 'Status: In Progress\n');
        assert.strictEqual(armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md']).ok, true);

        // The concurrent advance lands where a real one would: after the append
        // has read the state, while it is still opening the plan doc it was
        // asked to add.
        let advanced = false;
        fs.openSync = (target, ...rest) => {
            if (!advanced && String(target).endsWith('c.md')) {
                advanced = true;
                assert.strictEqual(advanceGoal(repo, { outcome: 'complete' }).advanced, true);
            }
            return realOpen(target, ...rest);
        };
        const result = appendGoal(repo, ['docs/plans/c.md']);
        fs.openSync = realOpen;

        assert.strictEqual(advanced, true, 'the concurrent advance ran');
        assert.strictEqual(result.ok, false, 'the append refuses rather than writing a stale snapshot');
        assert.match(result.reason, /goal state changed/);
        // The CLI prints a refusal through a 120-character screen sized for a
        // path, so a longer reason reaches the operator cut mid-sentence and
        // loses the tail that says what to do about it.
        assert.ok(result.reason.length <= 120,
            'the refusal survives that screen whole: ' + result.reason.length + ' characters');
        const state = readGoal(repo);
        assert.strictEqual(state.plan, 'docs/plans/b.md', 'the advance still stands');
        assert.strictEqual(state.queueIndex, 1);
        assert.deepStrictEqual(state.queue, ['docs/plans/a.md', 'docs/plans/b.md'],
            'nothing was appended');
        assert.strictEqual(state.history.length, 1, 'the advance record survives');
    } finally {
        fs.openSync = realOpen;
        rmRepo(repo);
    }
});

// The heading match is structural, not merely lexical: a plan doc that shows
// the format rather than asserting it records nothing. Both legs are provenance
// failures of the same kind, a grant the plan never made being read back as one
// it did.
test('a Dispatch Authorization heading inside a fence or below the sections of work records nothing', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/fenced.md', 'Status: In Progress\n\n## Goal\n\n'
            + 'A plan doc showing the format:\n\n'
            + '```markdown\n## Dispatch Authorization\n\nAuthorized by nobody at all.\n```\n');
        writePlan(repo, 'docs/plans/late.md', 'Status: In Progress\n\n## Sections of Work\n\n'
            + '### Section 1\n\nWork.\n\n## Dispatch Authorization\n\nAuthorized by nobody at all.\n');

        assert.strictEqual(armGoal(repo, ['docs/plans/fenced.md', 'docs/plans/late.md']).ok, true);
        const recorded = readGoal(repo).authorizations;
        assert.strictEqual(recorded['docs/plans/fenced.md'], null,
            'an illustration inside a fenced block is not a claim');
        assert.strictEqual(recorded['docs/plans/late.md'], null,
            'the section is front matter: a heading below the sections of work is not it');
    } finally {
        rmRepo(repo);
    }
});

// The body terminator and the heading matcher answer the same question about
// the same syntax, so they agree about a heading written with no space after
// its hashes. Where they disagreed, the section body ran on into the next
// section and its first sentence was recorded as this plan's authorization.
test('a next heading written with no space after its hashes still ends the section body', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n\n'
            + '## Dispatch Authorization\n\n##Goal\n\nShip the thing by Friday.\n');

        assert.strictEqual(armGoal(repo, ['docs/plans/a.md']).ok, true);
        assert.strictEqual(readGoal(repo).authorizations['docs/plans/a.md'], null,
            'the empty section records none rather than quoting the next section');
    } finally {
        rmRepo(repo);
    }
});

test('CLI arm --append extends the queue, reports it, and reads back through status', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/a.md', 'Status: In Progress\n\n'
            + '## Dispatch Authorization\n\nAuthorized by the operator, 2026-08-25.\n');
        writePlan(repo, 'docs/plans/b.md', 'Status: In Progress\n');

        const armed = spawnSync(process.execPath, [CLI, 'arm', 'docs/plans/a.md'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(armed.status, 0, armed.stderr);

        const appended = spawnSync(process.execPath, [CLI, 'arm', '--append', 'docs/plans/b.md'],
            { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(appended.status, 0, appended.stderr);
        assert.match(appended.stdout, /docs\/plans\/b\.md/);
        assert.strictEqual(appended.stderr, '', 'an append drops nothing, so it warns about nothing');
        assert.deepStrictEqual(readGoal(repo).queue, ['docs/plans/a.md', 'docs/plans/b.md']);

        const status = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(status.status, 0, status.stderr);
        assert.match(status.stdout, /authorization: Authorized by the operator, 2026-08-25\./,
            'status reads the recorded provenance back: ' + status.stdout);
        assert.match(status.stdout, /authorization: none recorded/, status.stdout);

        // An append with no goal armed is refused rather than arming one.
        const clear = spawnSync(process.execPath, [CLI, 'clear'], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(clear.status, 0, clear.stderr);
        const orphan = spawnSync(process.execPath, [CLI, 'arm', '--append', 'docs/plans/b.md'],
            { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(orphan.status, 1);
        assert.match(orphan.stderr, /no goal is armed/);
        // The whole reason reaches the operator through the CLI's print path,
        // pointer included: this is the surface a session that loaded neither
        // skill meets, so the way forward has to survive the printing.
        assert.match(orphan.stderr, /arm without --append is the first arming/, orphan.stderr);
        assert.ok(!fs.existsSync(goalPath(repo)), 'nothing was armed by the refusal');
    } finally {
        rmRepo(repo);
    }
});

// An append and a bind are two writers over one file, and each one's read is
// separated from its write by real work: the append opens a plan doc per path it
// was given, and the bind is driven from a Stop hook that reached it through its
// own reads. Whichever lands second must not carry the other's field back to
// what it was, which is what writing a whole stale snapshot does. Both
// directions are driven in the order the race produces rather than by threading:
// the foreign write fires from inside a filesystem call the function under test
// makes between its own read and its own write.
test('appendGoal preserves a bind that landed while it was validating', () => {
    const repo = makeRepo();
    const realOpen = fs.openSync;
    const transcript = path.join(repo, 'transcript.jsonl');
    try {
        for (const name of ['a', 'b', 'c']) {
            writePlan(repo, 'docs/plans/' + name + '.md', 'Status: In Progress\n');
        }
        assert.strictEqual(armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md']).ok, true);
        assert.strictEqual(readGoal(repo).boundSession, null, 'the arm carried no bind');

        // The claim lands where a real one would: the goal was armed unbound and
        // the leashed session's first stop claims it while the append is still
        // opening the plan doc it was asked to add.
        let bound = false;
        fs.openSync = (target, ...rest) => {
            if (!bound && String(target).endsWith('c.md')) {
                bound = true;
                assert.strictEqual(bindSession(repo, SID, transcript).ok, true);
            }
            return realOpen(target, ...rest);
        };
        const result = appendGoal(repo, ['docs/plans/c.md']);
        fs.openSync = realOpen;

        assert.strictEqual(bound, true, 'the concurrent bind ran');
        assert.strictEqual(result.ok, true, result.reason);
        const state = readGoal(repo);
        assert.strictEqual(state.boundSession, SID,
            'the bind stands: an append writing its own snapshot back unbinds the leash, and the next '
            + 'session to stop, a bystander included, claims it');
        assert.strictEqual(state.boundTranscript, transcript);
        assert.deepStrictEqual(state.queue, ['docs/plans/a.md', 'docs/plans/b.md', 'docs/plans/c.md'],
            'and the append itself still landed');
        assert.strictEqual(state.condition, composeCondition(state.plan, state.queue, state.queueIndex));
        assert.ok(Object.prototype.hasOwnProperty.call(state.authorizations, 'docs/plans/c.md'),
            'including the appended plan\'s authorization entry');
        assert.deepStrictEqual(tmpLeftovers(repo), []);
    } finally {
        fs.openSync = realOpen;
        rmRepo(repo);
    }
});

test('bindSession preserves an append that landed after it read the state', () => {
    const repo = makeRepo();
    const realReadFile = fs.readFileSync;
    const transcript = path.join(repo, 'transcript.jsonl');
    try {
        for (const name of ['a', 'b', 'c']) {
            writePlan(repo, 'docs/plans/' + name + '.md', 'Status: In Progress\n');
        }
        assert.strictEqual(armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md']).ok, true);

        // The append lands where an operator's really does: after the bind has
        // read the state it is deciding from, which is the read the state file
        // is parsed out of.
        let appended = false;
        fs.readFileSync = (target, ...rest) => {
            const body = realReadFile(target, ...rest);
            if (!appended && String(target).endsWith('goal-state.json')) {
                appended = true;
                assert.strictEqual(appendGoal(repo, ['docs/plans/c.md']).ok, true);
            }
            return body;
        };
        const result = bindSession(repo, SID, transcript);
        fs.readFileSync = realReadFile;

        assert.strictEqual(appended, true, 'the concurrent append ran');
        assert.strictEqual(result.ok, true, result.reason);
        const state = readGoal(repo);
        assert.deepStrictEqual(state.queue, ['docs/plans/a.md', 'docs/plans/b.md', 'docs/plans/c.md'],
            'the appended plan stands: a bind writing its own snapshot back drops an armed plan silently');
        assert.match(state.condition, /docs\/plans\/c\.md/, 'and the condition still names it');
        assert.ok(Object.prototype.hasOwnProperty.call(state.authorizations, 'docs/plans/c.md'));
        assert.strictEqual(state.boundSession, SID, 'and the bind itself still landed');
        assert.strictEqual(state.boundTranscript, transcript);
        assert.deepStrictEqual(tmpLeftovers(repo), []);
    } finally {
        fs.readFileSync = realReadFile;
        rmRepo(repo);
    }
});

// A cut sentence reads as a whole one, which is the hazard the cap's own
// derivation names, so the cut is marked where a reader sees it. The screen is
// re-applied to the stored value on every read, so a marked value has to survive
// a second screening unchanged: a marker the next read cuts off turns a marked
// truncation back into a silent one.
test('an authorization past the cap is marked as cut, and the mark survives a re-screen', () => {
    const once = safeForAuthorization('A'.repeat(400));
    assert.strictEqual(once.length, 320, 'the cap is the whole value, marker included: ' + once.length);
    assert.ok(once.endsWith(' ...[truncated]'), 'the cut is visible: ' + JSON.stringify(once.slice(-20)));
    assert.strictEqual(safeForAuthorization(once), once, 'screening the stored value again changes nothing');

    const short = safeForAuthorization('Authorized by the operator.');
    assert.strictEqual(short, 'Authorized by the operator.', 'a value inside the cap is untouched');
});

// The scan reads a bounded head of the plan doc, so a section whose heading sits
// inside that window can still have its first sentence run past it. Recording
// what the buffer happened to hold stores a fragment as the plan's whole claim,
// and both the security model and the kit-goal skill state that a section past
// the window records as none rather than as a partial sentence.
test('an authorization sentence straddling the scan window records as none', () => {
    const repo = makeRepo();
    try {
        // AUTHORIZATION_SCAN_MAX_BYTES in kit-goal-lib.js, restated here because
        // it is not exported. The fixture asserts its own geometry below rather
        // than trusting the arithmetic.
        const scan = 16 * 1024;
        const heading = '## Dispatch Authorization\n\n';
        const opening = 'Authorized by the operator in a sentence whose terminator sits well past '
            + 'the end of the scan window, ' + 'and on it runs, '.repeat(20);
        const pad = 'Status: In Progress\n\n' + 'x'.repeat(scan - 200) + '\n\n';

        const straddle = pad + heading + opening + 'so it ends here.\n';
        const bodyAt = straddle.indexOf(heading) + heading.length;
        assert.ok(straddle.indexOf(heading) < scan, 'the heading sits inside the scan window');
        assert.ok(bodyAt < scan, 'and so does the start of its body');
        assert.ok(straddle.indexOf('.', bodyAt) > scan, 'while the sentence terminator falls beyond it');
        writePlan(repo, 'docs/plans/straddle.md', straddle);

        // The control: the same geometry with the terminator brought inside the
        // window, so a null above is the straddle and not a fixture the scan
        // could no longer find.
        const inside = pad + heading + 'Authorized by the operator. ' + opening + 'and it ends here.\n';
        assert.ok(inside.indexOf('.', inside.indexOf(heading)) < scan);
        writePlan(repo, 'docs/plans/inside.md', inside);

        // A body with no terminator at all inside a plan doc the scan read whole
        // is the section's own single line rather than a fragment, so it records.
        writePlan(repo, 'docs/plans/short.md',
            'Status: In Progress\n\n## Dispatch Authorization\n\nAuthorized by the operator\n');

        assert.strictEqual(armGoal(repo, ['docs/plans/straddle.md', 'docs/plans/inside.md',
            'docs/plans/short.md']).ok, true);
        const recorded = readGoal(repo).authorizations;
        assert.strictEqual(recorded['docs/plans/straddle.md'], null,
            'a sentence the scan could not see the end of is no claim: ' + recorded['docs/plans/straddle.md']);
        assert.strictEqual(recorded['docs/plans/inside.md'], 'Authorized by the operator.');
        assert.strictEqual(recorded['docs/plans/short.md'], 'Authorized by the operator');
    } finally {
        rmRepo(repo);
    }
});

// The truncation flag answers one question, whether the scanned head is a
// PREFIX of the doc, and a doc measuring exactly the scan window is the input
// that separates the readings of it. Every byte of such a doc is in hand, so a
// closing sentence carrying no terminator is the section's own line and
// records; a flag keyed on the read having filled its buffer would call the
// same head a fragment and record none, discarding a grant the plan really
// made. The doc one byte longer is the control, where the head genuinely is a
// prefix and the same tail records nothing.
//
// The flag's other leg, a read returning fewer bytes than a file no larger
// than the window holds, cannot be staged from here: a regular file does not
// return a short read on demand. This case is what pins the reading the two
// legs share.
test('a plan doc measuring exactly the scan window is read whole, not as a fragment', () => {
    const repo = makeRepo();
    try {
        const scan = 16 * 1024;
        const tail = '\n\n## Dispatch Authorization\n\nAuthorized by the operator with no terminator';
        const head = 'Status: In Progress\n\n';
        const exact = head + 'x'.repeat(scan - head.length - tail.length) + tail;
        assert.strictEqual(Buffer.byteLength(exact, 'utf8'), scan,
            'the fixture is exactly the scan window, which is the geometry under test');
        writePlan(repo, 'docs/plans/exact.md', exact);

        // One byte more, and the same tail is a prefix the scan cannot see the
        // end of, so it records nothing.
        writePlan(repo, 'docs/plans/over.md', head + 'x'.repeat(scan - head.length - tail.length + 1) + tail);

        assert.strictEqual(armGoal(repo, ['docs/plans/exact.md', 'docs/plans/over.md']).ok, true);
        const recorded = readGoal(repo).authorizations;
        assert.strictEqual(recorded['docs/plans/exact.md'],
            'Authorized by the operator with no terminator',
            'the whole file was in hand, so its last line is the section speaking');
        assert.strictEqual(recorded['docs/plans/over.md'], null,
            'while a doc the scan could not reach the end of records no claim');
    } finally {
        rmRepo(repo);
    }
});

// What makes a body a fragment is that nobody saw its end, and a following
// heading is exactly the evidence that somebody did: the section ended inside
// the window, so what it holds is the whole of it whatever its punctuation. A
// plan doc past the scan window is otherwise ordinary, and refusing every
// terminator-less section in one would drop a grant the plan really made.
test('a terminator-less section closed by a heading inside the window still records', () => {
    const repo = makeRepo();
    try {
        // AUTHORIZATION_SCAN_MAX_BYTES in kit-goal-lib.js, restated because it
        // is not exported.
        const scan = 16 * 1024;
        const heading = '## Dispatch Authorization\n\n';
        const line = 'Authorized by the operator with no full stop\n\n';
        const doc = 'Status: In Progress\n\n' + 'x'.repeat(scan - 400) + '\n\n'
            + heading + line + '## Goal\n\n' + 'y'.repeat(2000) + '\n';

        const bodyAt = doc.indexOf(heading) + heading.length;
        assert.ok(doc.indexOf(heading) < scan, 'the heading sits inside the scan window');
        assert.ok(doc.indexOf('## Goal') < scan, 'and so does the heading that closes its body');
        assert.strictEqual(doc.slice(bodyAt, doc.indexOf('## Goal')).search(/[.!?](\s|$)/), -1,
            'the body carries no sentence terminator');
        assert.ok(Buffer.byteLength(doc, 'utf8') > scan, 'while the doc itself runs past the window');
        writePlan(repo, 'docs/plans/closed.md', doc);

        assert.strictEqual(armGoal(repo, ['docs/plans/closed.md']).ok, true);
        assert.strictEqual(readGoal(repo).authorizations['docs/plans/closed.md'],
            'Authorized by the operator with no full stop',
            'the section ended inside the window, so its line is the whole claim rather than a fragment');
    } finally {
        rmRepo(repo);
    }
});

// ---------------------------------------------------------------------------
// Queue position read from the plan docs themselves (queuePosition, and the
// CLI status line built on it). The stored index moves only at a clean stop of
// the bound session, so every case here is a state the world has moved past
// and the file has not.
// ---------------------------------------------------------------------------

// A queue of two In-Progress plans, the shape each case below bends one joint
// of. The docs carry a heading as well as a Status row, because the strict
// reading of that row is scoped to the text above the first heading.
function armTwoPlans(repo) {
    writePlan(repo, 'docs/plans/a.md', '# A\n\nStatus: In Progress\n\n## Sections of Work\n');
    writePlan(repo, 'docs/plans/b.md', '# B\n\nStatus: In Progress\n\n## Sections of Work\n');
    assert.strictEqual(armGoal(repo, ['docs/plans/a.md', 'docs/plans/b.md']).ok, true);
}

// The move a close-out makes: the doc's Status row is flipped to Complete and
// the doc is filed under docs/archive/. Both halves matter, because the archive
// leg reads the filed copy's own header rather than treating its presence as
// evidence.
function closeOutIntoArchive(repo, name) {
    writePlan(repo, 'docs/plans/' + name, '# ' + name + '\n\nStatus: Complete\n\n## Chapters\n');
    fs.mkdirSync(path.join(repo, 'docs', 'archive'), { recursive: true });
    fs.renameSync(path.join(repo, 'docs', 'plans', name), path.join(repo, 'docs', 'archive', name));
}

function statusStdout(repo) {
    const res = spawnSync(process.execPath, [CLI, 'status'], { cwd: repo, encoding: 'utf8' });
    assert.strictEqual(res.status, 0, res.stderr);
    return res.stdout;
}

// The position's reported fields with its record of the paths the walk read
// set aside, for the cases below that pin every field at once. That record
// (consulted) holds absolute fixture paths, so folding it into these compares
// would make each of them restate the temp directory it built; the pairs in it
// are asserted on their own, where they are the subject rather than noise.
function positionFields(cwd, state) {
    const { consulted, ...fields } = queuePosition(cwd, state);
    assert.ok(Array.isArray(consulted), 'every answer carries a record of what the walk read');
    return fields;
}

test('a plan archived with no stop to advance the leash still reports the truthful queue position', () => {
    const repo = makeRepo();
    try {
        armTwoPlans(repo);
        // The live defect shape: the first plan finished and was filed in
        // docs/archive/, and the stop that would have advanced the leash never
        // came (the bound session died at its close-out), so the stored index
        // still names plan 1 with nothing in the system to repair it.
        closeOutIntoArchive(repo, 'a.md');
        assert.strictEqual(readGoal(repo).queueIndex, 0, 'the stored index is untouched by the move');

        const out = statusStdout(repo);
        assert.match(out, /queue: plan 2 of 2, docs\/plans\/b\.md/,
            'the position line names the plan at the position it reports');
        assert.doesNotMatch(out, /queue: plan 1 of 2/);
        assert.match(out, /the stored position still says plan 1, docs\/plans\/a\.md/,
            'the gap is named rather than quietly replaced, and both plans are named');
        assert.match(out, /the leash advances one plan per stop of the bound session until it catches up/);
        assert.match(out, /that is the stored current plan/,
            'the header says which of the two plans it is naming');
        assert.match(out, /> docs\/plans\/b\.md/, 'the rendered window follows the reported position');
    } finally {
        rmRepo(repo);
    }
});

test('a queued plan left in place but marked Status: Complete reports as finished', () => {
    const repo = makeRepo();
    try {
        armTwoPlans(repo);
        writePlan(repo, 'docs/plans/a.md', '# A\n\nStatus: Complete\n\n## Chapters\n');
        const out = statusStdout(repo);
        assert.match(out, /queue: plan 2 of 2/);
        assert.match(out, /the stored position still says plan 1/);
    } finally {
        rmRepo(repo);
    }
});

// Pin, not a red: the position walk reads the frozen contract, under which
// Ready is not Complete and so finishes nothing, whatever name the loose
// classifier gives the value. The walk counts entries finished with no author
// in the loop, which is why it holds to the strict reading. The per-entry
// token beside it is the loose reading, so it prints the value the classifier
// read.
test('a queued plan flipped to Status: Ready leaves the position alone', () => {
    const repo = makeRepo();
    try {
        armTwoPlans(repo);
        writePlan(repo, 'docs/plans/a.md', '# A\n\nStatus: Ready\n\n## Sections of Work\n');
        const out = statusStdout(repo);
        assert.match(out, /queue: plan 1 of 2/, 'a parked plan is not a finished plan');
        assert.doesNotMatch(out, /stored position/);
        assert.match(out, /> docs\/plans\/a\.md \[ready\]/,
            'the queue rendering prints the value the classifier read');
    } finally {
        rmRepo(repo);
    }
});

test('a Status row the frozen contract does not read as terminal leaves the position alone', () => {
    const repo = makeRepo();
    try {
        armTwoPlans(repo);
        // 'Complete (archived)' is the contract's own named trap: trailing text
        // makes a claim about where the doc was filed, not that the work is
        // done, and the curating-docs contract says in as many words that it
        // does not terminate.
        writePlan(repo, 'docs/plans/a.md', '# A\n\nStatus: Complete (archived)\n\n## Chapters\n');
        let out = statusStdout(repo);
        assert.match(out, /queue: plan 1 of 2/, "'Complete (archived)' is not a finished plan");
        assert.doesNotMatch(out, /stored position/);

        // Only the first Status row above the first heading answers for the
        // document, so a row quoted inside a Chapter cannot finish a plan.
        writePlan(repo, 'docs/plans/a.md', '# A\n\nStatus: In Progress\n\n## Chapters\n\nStatus: Complete\n');
        out = statusStdout(repo);
        assert.match(out, /queue: plan 1 of 2/, 'a Status row below the first heading is body text');
        assert.doesNotMatch(out, /stored position/);
    } finally {
        rmRepo(repo);
    }
});

test('an archived copy does not finish a plan whose doc still stands in docs/plans/', () => {
    const repo = makeRepo();
    try {
        armTwoPlans(repo);
        // Both directories hold a copy, which is a close-out half done rather
        // than a plan finished: the archived move counts only where nothing is
        // left at the plans path.
        writePlan(repo, 'docs/archive/a.md', '# A\n\nStatus: Complete\n');
        const out = statusStdout(repo);
        assert.match(out, /queue: plan 1 of 2/);
        assert.doesNotMatch(out, /stored position/);
    } finally {
        rmRepo(repo);
    }
});

test('a healthy queue reports the stored position and says nothing about it', () => {
    const repo = makeRepo();
    try {
        armTwoPlans(repo);
        const out = statusStdout(repo);
        assert.match(out, /queue: plan 1 of 2/);
        assert.doesNotMatch(out, /stored position/, 'nothing to correct is nothing to say');
        assert.doesNotMatch(out, /unresolvable/);
        assert.deepStrictEqual(positionFields(repo, readGoal(repo)), {
            index: 0, stored: 0, healed: 0, positional: true,
            unresolvable: false, cause: null, finished: false
        });
    } finally {
        rmRepo(repo);
    }
});

test('a queue entry in neither plan directory is reported as unresolvable, keeping its position', () => {
    const repo = makeRepo();
    try {
        armTwoPlans(repo);
        fs.rmSync(path.join(repo, 'docs', 'plans', 'a.md'));
        const out = statusStdout(repo);
        assert.match(out, /queue: plan 1 of 2/, 'the entry keeps its position');
        assert.doesNotMatch(out, /queue: plan 2 of 2/, 'an unreadable entry is never skipped past');
        assert.match(out,
            /unresolvable: the doc for this plan is in neither docs\/plans\/ nor docs\/archive\//);
    } finally {
        rmRepo(repo);
    }
});

test('a plan path holding something that is not a plan doc is not read as archived', () => {
    const repo = makeRepo();
    try {
        armTwoPlans(repo);
        // A directory at the plan path is a kind no read can settle, which is
        // neither evidence of a finished plan nor evidence of a missing one.
        // Reading it as either is how a transient or unusable path becomes a
        // silent advance past live work.
        fs.rmSync(path.join(repo, 'docs', 'plans', 'a.md'));
        fs.mkdirSync(path.join(repo, 'docs', 'plans', 'a.md'));
        const out = statusStdout(repo);
        assert.match(out, /queue: plan 1 of 2/);
        assert.doesNotMatch(out, /stored position/);
        assert.doesNotMatch(out, /unresolvable/, 'something is there, so nothing is unresolvable');
    } finally {
        rmRepo(repo);
    }
});

test('the position walk never moves behind the stored index', () => {
    const repo = makeRepo();
    try {
        armTwoPlans(repo);
        // A blocked advance leaves an unfinished plan behind the leash on
        // purpose, and re-opening it here would report a position the operator
        // already decided to move past.
        assert.strictEqual(advanceGoal(repo, { outcome: 'blocked' }).advanced, true);
        assert.strictEqual(readGoal(repo).queueIndex, 1);
        assert.deepStrictEqual(positionFields(repo, readGoal(repo)), {
            index: 1, stored: 1, healed: 0, positional: true,
            unresolvable: false, cause: null, finished: false
        }, 'the walk reads forward from the stored index, never behind it');
        assert.match(statusStdout(repo), /queue: plan 2 of 2/);
    } finally {
        rmRepo(repo);
    }
});

test('a doc filed in the archive without reading terminal does not finish its queue entry', () => {
    const repo = makeRepo();
    try {
        armTwoPlans(repo);
        // The failure the archive leg's own bar exists to catch: the plan doc
        // was DELETED rather than filed, and a same-named doc from an earlier
        // effort already sits in docs/archive/. Presence under that name is not
        // evidence about this plan, so nothing here may move the position past
        // work that is still live.
        writePlan(repo, 'docs/archive/a.md', '# A\n\nStatus: In Progress\n\n## Chapters\n');
        fs.rmSync(path.join(repo, 'docs', 'plans', 'a.md'));

        assert.deepStrictEqual(positionFields(repo, readGoal(repo)), {
            index: 0, stored: 0, healed: 0, positional: true,
            unresolvable: false, cause: null, finished: false
        }, 'a non-terminal archived copy is no record of a finished plan');
        const out = statusStdout(repo);
        assert.match(out, /queue: plan 1 of 2, docs\/plans\/a\.md/);
        assert.doesNotMatch(out, /queue: plan 2 of 2/);
        assert.doesNotMatch(out, /stored position/);

        // The control that keeps the assertions above from passing because the
        // archive leg stopped working altogether: flip the filed copy's own
        // Status row to a terminal one and the position moves.
        writePlan(repo, 'docs/archive/a.md', '# A\n\nStatus: Complete\n\n## Chapters\n');
        assert.strictEqual(queuePosition(repo, readGoal(repo)).index, 1,
            'a terminal archived copy does finish the entry');
    } finally {
        rmRepo(repo);
    }
});

test('a Status row below the first heading cannot finish a plan carrying no header row', () => {
    const repo = makeRepo();
    try {
        armTwoPlans(repo);
        // The case the heading slice is the only guard against. With no Status
        // row in the front matter at all, the first-match rule has nothing to
        // find above the first '##' and would otherwise walk on into the body
        // and read a quoted Chapter row as the document's own header.
        writePlan(repo, 'docs/plans/a.md', '# A\n\n## Chapters\n\nStatus: Complete\n');
        assert.strictEqual(queuePosition(repo, readGoal(repo)).index, 0,
            'a Status row below the first heading is body text, not the header');

        // The control: the same row moved above the first heading does finish
        // the plan, so the assertion above cannot pass because the reader stopped
        // seeing Status rows at all.
        writePlan(repo, 'docs/plans/a.md', '# A\n\nStatus: Complete\n\n## Chapters\n');
        assert.strictEqual(queuePosition(repo, readGoal(repo)).index, 1);
    } finally {
        rmRepo(repo);
    }
});

test('a queue entry that does not round-trip the plan-path normalizer is unresolvable', () => {
    const repo = makeRepo();
    try {
        armTwoPlans(repo);
        // Driven directly rather than through the CLI, because no readGoal path
        // can produce this state: normalizeState collapses a queue carrying an
        // entry that fails the round-trip. The guard is here so the walk is safe
        // on its own terms whatever hands it a state, and what it must never do
        // is stat and open a path outside the repository.
        const traversing = 'docs/plans/../../../../evil.md';
        const state = {
            plan: traversing,
            queue: [traversing, 'docs/plans/b.md'],
            queueIndex: 0
        };
        assert.deepStrictEqual(positionFields(repo, state), {
            index: 0, stored: 0, healed: 0, positional: true,
            unresolvable: true, cause: 'unreadable-path', finished: false
        }, 'an entry that escapes the repo is resolved against no tree and never skipped past');
        assert.deepStrictEqual(queuePosition(repo, state).consulted, [],
            'a path refused before any tree is asked leaves nothing on the record of what was read');
    } finally {
        rmRepo(repo);
    }
});

test('an entry armed from outside docs/plans/ is unresolvable without naming the archive', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'notes/side.md', '# S\n\nStatus: In Progress\n\n## Sections of Work\n');
        writePlan(repo, 'docs/plans/b.md', '# B\n\nStatus: In Progress\n\n## Sections of Work\n');
        assert.strictEqual(armGoal(repo, ['notes/side.md', 'docs/plans/b.md']).ok, true);
        fs.rmSync(path.join(repo, 'notes', 'side.md'));

        const position = queuePosition(repo, readGoal(repo));
        assert.strictEqual(position.unresolvable, true);
        assert.strictEqual(position.cause, 'unarchivable',
            'there is no archive location for a plan armed from outside docs/plans/');
        const out = statusStdout(repo);
        assert.match(out, /the plan is not armed from docs\/plans\/, so there is no archive location/);
        assert.doesNotMatch(out, /is in neither docs\/plans\/ nor docs\/archive\//,
            'the message must not name two directories the doc was never in');
    } finally {
        rmRepo(repo);
    }
});

test('a queue whose every entry reads finished says the next stop releases the leash', () => {
    const repo = makeRepo();
    try {
        armTwoPlans(repo);
        closeOutIntoArchive(repo, 'a.md');
        closeOutIntoArchive(repo, 'b.md');

        const position = queuePosition(repo, readGoal(repo));
        assert.strictEqual(position.index, 1, 'the walk pins at the last entry');
        assert.strictEqual(position.finished, true,
            'the entry AT the reported position reads finished too');
        const out = statusStdout(repo);
        assert.match(out, /queue: plan 2 of 2/);
        assert.match(out, /every plan in the queue reads Complete or is archived, this one included/);
        assert.match(out, /next stop releases the leash rather than advancing it/);
    } finally {
        rmRepo(repo);
    }
});

test('a queue longer than the position walk\'s scan bound reports where the evidence ran out', () => {
    const repo = makeRepo();
    try {
        // Eighteen entries, every one of them finished, against a bound of
        // sixteen. The walk reads sixteen and reports the seventeenth, which it
        // never evaluated: that is the earliest position the evidence leaves
        // open, and it carries no unresolvable label and no finished flag,
        // because nothing was read about it either way.
        const names = [];
        for (let i = 0; i < 18; i++) names.push('p' + i + '.md');
        for (const name of names) {
            writePlan(repo, 'docs/plans/' + name, '# ' + name + '\n\nStatus: In Progress\n\n## Sections\n');
        }
        assert.strictEqual(armGoal(repo, names.map((n) => 'docs/plans/' + n)).ok, true);
        for (const name of names) closeOutIntoArchive(repo, name);

        assert.deepStrictEqual(positionFields(repo, readGoal(repo)), {
            index: 16, stored: 0, healed: 16, positional: true,
            unresolvable: false, cause: null, finished: false
        });
        assert.match(statusStdout(repo), /queue: plan 17 of 18, docs\/plans\/p16\.md/);
    } finally {
        rmRepo(repo);
    }
});

test('the position walk reports the plan docs it read, one for a healthy queue', () => {
    const repo = makeRepo();
    try {
        armTwoPlans(repo);
        // The record a caching surface acts on: the armed plan stands live at
        // its own plans path in the only tree there is, so the walk opens that
        // one file and stops. Anything wider than this pair is a position a
        // key over that one file cannot keep fresh.
        assert.deepStrictEqual(queuePosition(repo, readGoal(repo)).consulted,
            [{ root: repo, rel: 'docs/plans/a.md' }]);
    } finally {
        rmRepo(repo);
    }
});

test('the position walk reports the archived copy and the entry it advanced onto', () => {
    const repo = makeRepo();
    try {
        armTwoPlans(repo);
        closeOutIntoArchive(repo, 'a.md');
        const position = queuePosition(repo, readGoal(repo));
        assert.strictEqual(position.index, 1, 'setup: the finished first entry is walked past');
        // Both files the walk actually opened past the armed plan's own path
        // are on the record, in the order it opened them: the archived copy
        // that settled the first entry, and the second entry's own doc. Neither
        // is in any key built from the armed plan alone, which is the whole
        // reason the record exists.
        assert.deepStrictEqual(position.consulted, [
            { root: repo, rel: 'docs/plans/a.md' },
            { root: repo, rel: 'docs/archive/a.md' },
            { root: repo, rel: 'docs/plans/b.md' }
        ]);
    } finally {
        rmRepo(repo);
    }
});

test('the two Status readings of one queued plan are labelled where they disagree', () => {
    const repo = makeRepo();
    try {
        armTwoPlans(repo);
        // 'Complete (archived)' is complete to the leash and not terminal to the
        // frozen contract, so the position line and the entry's own token
        // genuinely disagree. Unlabelled, one screen carries two readings with
        // nothing to tell a reader which line used which.
        writePlan(repo, 'docs/plans/a.md', '# A\n\nStatus: Complete (archived)\n\n## Chapters\n');
        let out = statusStdout(repo);
        assert.match(out, /queue: plan 1 of 2, docs\/plans\/a\.md/);
        assert.match(out, /> docs\/plans\/a\.md \[complete\]/);
        assert.match(out, /complete to the leash and current to this report/);

        // No disagreement, no note: the line means something when it appears.
        writePlan(repo, 'docs/plans/a.md', '# A\n\nStatus: In Progress\n\n## Chapters\n');
        out = statusStdout(repo);
        assert.doesNotMatch(out, /complete to the leash and current to this report/);
    } finally {
        rmRepo(repo);
    }
});
