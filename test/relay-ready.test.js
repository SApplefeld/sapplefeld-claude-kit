// Tests for plugins/claude-kit/hooks/relay-ready.js (the resume-confirmation
// SessionStart hook).
//
// Node's built-in test runner, no framework. The hook is spawned as a real
// child process with KIT_RELAY_DIR pointed at a fresh temp dir, fed a
// SessionStart payload on stdin, and asserted on by the stamp files it
// leaves behind. The hook is silent by contract, so stdout is asserted empty
// throughout.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOK = path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'relay-ready.js');
const SESSION_ID = '2f5494be-1234-4abc-8def-0123456789ab';

function makeDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmDir(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

function runHook(relayDir, payload) {
    const result = spawnSync(process.execPath, [HOOK], {
        input: JSON.stringify(payload),
        env: { ...process.env, KIT_RELAY_DIR: relayDir },
        encoding: 'utf8'
    });
    assert.strictEqual(result.status, 0, 'the hook must always exit 0');
    assert.strictEqual(result.stdout, '', 'the hook is silent by contract');
    assert.strictEqual(result.stderr, '', 'silence covers stderr too');
    return result;
}

test('a resume on an armed machine stamps ready\\<session id>', () => {
    const relayDir = makeDir('relay-ready-');
    try {
        runHook(relayDir, { source: 'resume', session_id: SESSION_ID });
        const stamp = path.join(relayDir, 'ready', SESSION_ID);
        assert.ok(fs.existsSync(stamp), 'stamp file must exist');
    } finally {
        rmDir(relayDir);
    }
});

test('the sessionId payload field variant also stamps', () => {
    const relayDir = makeDir('relay-ready-');
    try {
        runHook(relayDir, { source: 'resume', sessionId: SESSION_ID });
        assert.ok(fs.existsSync(path.join(relayDir, 'ready', SESSION_ID)));
    } finally {
        rmDir(relayDir);
    }
});

test('a non-resume source never stamps', () => {
    const relayDir = makeDir('relay-ready-');
    try {
        for (const source of ['startup', 'compact', 'clear', '']) {
            runHook(relayDir, { source, session_id: SESSION_ID });
        }
        runHook(relayDir, { session_id: SESSION_ID });
        assert.ok(!fs.existsSync(path.join(relayDir, 'ready')), 'no ready dir, no stamps');
    } finally {
        rmDir(relayDir);
    }
});

test('a session id outside the UUID shape is refused as a filename', () => {
    const relayDir = makeDir('relay-ready-');
    try {
        for (const bad of ['..\\evil', '../evil', '..\\..\\evil', 'not-a-uuid', SESSION_ID + 'x', '', undefined]) {
            runHook(relayDir, { source: 'resume', session_id: bad });
        }
        assert.ok(!fs.existsSync(path.join(relayDir, 'ready')), 'nothing written for any malformed id');
        // A "..\evil" resolved from ready\ would land in the relay dir; one
        // level deeper lands beside it. Pin both escape depths.
        assert.ok(!fs.existsSync(path.join(relayDir, 'evil')), 'no traversal escape into the relay dir');
        assert.ok(!fs.existsSync(path.join(path.dirname(relayDir), 'evil')), 'no traversal escape past the relay dir');
    } finally {
        rmDir(relayDir);
    }
});

test('an uppercase UUID stamps under its lowercase name (deterministic stamp filenames)', () => {
    const relayDir = makeDir('relay-ready-');
    try {
        runHook(relayDir, { source: 'resume', session_id: SESSION_ID.toUpperCase() });
        assert.ok(fs.existsSync(path.join(relayDir, 'ready', SESSION_ID)));
    } finally {
        rmDir(relayDir);
    }
});

test('an unarmed machine (no relay dir) is never touched', () => {
    const parent = makeDir('relay-ready-');
    const relayDir = path.join(parent, 'resume-relay');
    try {
        runHook(relayDir, { source: 'resume', session_id: SESSION_ID });
        assert.ok(!fs.existsSync(relayDir), 'the hook never creates the relay plane');
    } finally {
        rmDir(parent);
    }
});

test('stale stamps are pruned on the next resume; fresh ones survive', () => {
    const relayDir = makeDir('relay-ready-');
    try {
        const readyDir = path.join(relayDir, 'ready');
        fs.mkdirSync(readyDir, { recursive: true });
        const staleStamp = path.join(readyDir, '00000000-0000-4000-8000-000000000000');
        const freshStamp = path.join(readyDir, '11111111-1111-4111-8111-111111111111');
        fs.writeFileSync(staleStamp, 'old\n');
        fs.writeFileSync(freshStamp, 'new\n');
        const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
        fs.utimesSync(staleStamp, old, old);

        runHook(relayDir, { source: 'resume', session_id: SESSION_ID });

        assert.ok(!fs.existsSync(staleStamp), 'a stamp older than 24h is reaped');
        assert.ok(fs.existsSync(freshStamp), 'a fresh stamp survives');
        assert.ok(fs.existsSync(path.join(readyDir, SESSION_ID)), 'the new stamp lands');
    } finally {
        rmDir(relayDir);
    }
});

test('a malformed payload exits 0 silently', () => {
    const relayDir = makeDir('relay-ready-');
    try {
        const result = spawnSync(process.execPath, [HOOK], {
            input: 'not json at all',
            env: { ...process.env, KIT_RELAY_DIR: relayDir },
            encoding: 'utf8'
        });
        assert.strictEqual(result.status, 0);
        assert.strictEqual(result.stdout, '');
        assert.ok(!fs.existsSync(path.join(relayDir, 'ready')));
    } finally {
        rmDir(relayDir);
    }
});
