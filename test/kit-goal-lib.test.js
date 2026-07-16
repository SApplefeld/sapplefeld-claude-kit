// Unit tests for plugins/claude-kit/hooks/kit-goal-lib.js.
//
// Node's built-in test runner, no framework, no install (Node v24). Each test
// builds a fresh temp directory under os.tmpdir() as a fake repo cwd, writes
// whatever plan fixture it needs, runs the lib against it, and cleans up in a
// finally block regardless of pass/fail.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    goalPath,
    readGoal,
    armGoal,
    clearGoal,
    composeCondition,
    planHead
} = require('../plugins/claude-kit/hooks/kit-goal-lib.js');

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

test('armGoal success writes goal-state.json with the exact schema', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n\nsome content\n');
        const result = armGoal(repo, 'docs/plans/foo.md');
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.plan, 'docs/plans/foo.md');

        const state = readGoal(repo);
        assert.ok(state, 'goal state should be readable after arming');
        assert.deepStrictEqual(Object.keys(state).sort(), ['armedAt', 'condition', 'plan']);
        assert.strictEqual(state.plan, 'docs/plans/foo.md');
        assert.ok(!state.plan.includes('\\'), 'plan path must be forward-slash');
        assert.ok(state.condition.includes('docs/plans/foo.md'));
        assert.ok(state.condition.includes('(a)'));
        assert.ok(state.condition.includes('(b)'));
        assert.ok(state.condition.includes('(c)'));
        assert.ok(!Number.isNaN(Date.parse(state.armedAt)), 'armedAt should be a valid ISO timestamp');
    } finally {
        rmRepo(repo);
    }
});

test('armGoal writes atomically: no leftover .tmp file after success', () => {
    const repo = makeRepo();
    try {
        writePlan(repo, 'docs/plans/foo.md', 'Status: In Progress\n');
        const result = armGoal(repo, 'docs/plans/foo.md');
        assert.strictEqual(result.ok, true);
        assert.ok(fs.existsSync(goalPath(repo)));
        assert.ok(!fs.existsSync(goalPath(repo) + '.tmp'));
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
    // A directory occupying the goal-state path makes unlinkSync fail, standing
    // in for any delete failure (e.g. permissions). The caller must be able to
    // distinguish "still armed and enforcing" from "nothing to clear".
    const repo = makeRepo();
    try {
        fs.mkdirSync(goalPath(repo), { recursive: true });
        const result = clearGoal(repo);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.cleared, false);
        assert.ok(result.reason && result.reason.includes('could not clear'));
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

test('composeCondition embeds the plan path and clauses (a), (b), (c)', () => {
    const cond = composeCondition('docs/plans/example.md');
    assert.ok(cond.includes('docs/plans/example.md'));
    assert.ok(cond.includes('(a)'));
    assert.ok(cond.includes('(b)'));
    assert.ok(cond.includes('(c)'));
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
        assert.ok(!fs.existsSync(goalPath(repo) + '.tmp'));
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
