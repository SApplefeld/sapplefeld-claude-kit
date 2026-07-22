#!/usr/bin/env node
// SessionStart hook (resume only): confirm a completed /resume to the
// resume-relay watcher.
//
// The watcher types "/resume <id>" into a terminal and must not type the
// continue prompt until that resume has actually completed: typed early, the
// prompt lands in the original full-context session, which then keeps
// running and silently re-bills its full context on every later call. No
// timer can distinguish a slow resume from a completed one, so the resumed
// session announces itself instead: this hook stamps ready\<session id> in
// the relay directory, and the watcher releases the continue prompt only on
// that stamp (resume-relay.ahk, WaitForResumeReady).
//
// Every resume on an armed machine stamps, not just relayed ones; the
// watcher matches by session id and unconsumed stamps are pruned here by
// age. The stamp is written only when the relay directory already exists
// (the machine is armed); this hook never creates the relay plane itself.
//
// SAFETY: fails open and silent. Any missing path, parse error, or write
// failure -> exit 0, no output. A skipped stamp degrades to the watcher's
// bounded wait timing out and hard-failing with the prompt unsent, which is
// loud (failed\ plus the session-start nudge) and never types into an
// unconfirmed window.

'use strict';

const fs = require('fs');
const path = require('path');

// Unconsumed stamps older than this are reaped on the next resume.
const STAMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// The session id becomes a filename; only this exact shape (the watcher's
// own request validator) is ever written.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The armed relay directory: %LOCALAPPDATA%\claude-kit\resume-relay.
// KIT_RELAY_DIR overrides for tests and lifts the win32 gate, on the
// KIT_TRIPWIRE_STATE_DIR precedent.
function relayDir() {
    if (process.env.KIT_RELAY_DIR) return process.env.KIT_RELAY_DIR;
    if (process.platform !== 'win32') return null;
    const base = process.env.LOCALAPPDATA;
    if (!base) return null;
    return path.join(base, 'claude-kit', 'resume-relay');
}

function main() {
    let payload = {};
    try {
        payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    } catch {
        return;
    }

    // The hooks.json matcher already gates on resume; re-check here so a
    // misconfigured matcher cannot turn startup or compact into a stamp.
    if ((payload.source || '') !== 'resume') return;

    const sessionId = String(payload.session_id || payload.sessionId || '').toLowerCase();
    if (!UUID_PATTERN.test(sessionId)) return;

    const base = relayDir();
    if (!base) return;
    try {
        if (!fs.statSync(base).isDirectory()) return;
    } catch {
        return;
    }

    const readyDir = path.join(base, 'ready');
    try {
        fs.mkdirSync(readyDir, { recursive: true });
    } catch {
        return;
    }

    // Bounded, best-effort prune; a failed reap never blocks the stamp that
    // matters.
    try {
        const cutoff = Date.now() - STAMP_MAX_AGE_MS;
        for (const name of fs.readdirSync(readyDir).slice(0, 200)) {
            try {
                const full = path.join(readyDir, name);
                if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
            } catch {
                // Locked or already gone: skip it.
            }
        }
    } catch {
        // Unreadable ready dir: the stamp write below still gets its chance.
    }

    // Stamp content is informational; the watcher checks existence only.
    try {
        fs.writeFileSync(path.join(readyDir, sessionId), new Date().toISOString() + '\n', 'utf8');
    } catch {
        // Fail open.
    }
}

try {
    main();
} catch {
    // Never break a session over a hook.
}
process.exit(0);
