#!/usr/bin/env node
// SessionStart hook: keep an armed resume relay's deployed watcher current.
//
// A kit update moves the plugin payload's resume-relay.ahk forward while the
// deployed copy in %LOCALAPPDATA%\claude-kit\resume-relay keeps running old
// code, with no signal beyond a doctor WARN. On the doctrine-refresh
// precedent, refreshing an already-armed relay is silent kit-owned
// maintenance of the user's standing arm decision: this hook detects the
// drift and delegates the repair to arm-resume-relay.ps1 -RefreshOnly (the
// single owner of deploy mechanics). First-time arming, and the AutoHotkey
// install, stay a deliberate act via that script; this hook never installs
// anything and never touches an unarmed machine.
//
// The refresh restarts the watcher, which is only safe while it is provably
// idle: the watcher holds request.txt from arrival through typing to archive,
// so a pending file defers the refresh to a later session start. That guard
// also covers the relay-resumed session itself, whose SessionStart fires
// while the watcher is still mid-sequence. The script re-checks the guard;
// the pre-check here just avoids a doomed spawn.
//
// SAFETY: fails OPEN and silent. Any missing path, hash-read error, or spawn
// failure -> exit 0, no output. The refresh runs synchronously with a hard
// timeout: a fire-and-forget child of a hook dies with the hook process (the
// harness runs hooks in a kill-on-close job object, which reaps children on
// exit), and powershell.exe never executes at all under DETACHED_PROCESS, so
// detachment cannot escape that. The wait is bounded and rare: it is paid
// only when a kit update has actually staled an armed, idle relay; the common
// path exits at the hash compare with no process spawned.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function fileHash(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// The current payload's relay directory. CLAUDE_PLUGIN_ROOT is the installed
// plugin the harness resolved; the fallback covers a bare-node invocation.
function payloadRelayDir() {
    const rel = path.join('skills', 'compact-session', 'relay');
    const candidates = [];
    if (process.env.CLAUDE_PLUGIN_ROOT) candidates.push(path.join(process.env.CLAUDE_PLUGIN_ROOT, rel));
    candidates.push(path.join(__dirname, '..', rel));
    for (const dir of candidates) {
        try { if (fs.statSync(path.join(dir, 'resume-relay.ahk')).isFile()) return dir; } catch { /* try next */ }
    }
    return null;
}

function main() {
    try { fs.readFileSync(0, 'utf8'); } catch { /* payload unused */ }

    if (process.platform !== 'win32') return;         // the relay is Windows-only
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return;

    const relayDir = path.join(localAppData, 'claude-kit', 'resume-relay');
    const deployed = path.join(relayDir, 'resume-relay.ahk');
    if (!fs.existsSync(deployed)) return;              // never armed: not this hook's business

    const sourceDir = payloadRelayDir();
    if (!sourceDir) return;
    const source = path.join(sourceDir, 'resume-relay.ahk');
    const armScript = path.join(sourceDir, 'arm-resume-relay.ps1');
    if (!fs.existsSync(armScript)) return;

    try { if (fileHash(deployed) === fileHash(source)) return; } catch { return; }

    // Busy pre-check; the arm script re-checks and owns the guard semantics.
    // Every other refresh precondition (Startup shortcut present, AutoHotkey
    // installed) lives in the script's -RefreshOnly guards alone: duplicating
    // them here would be a second hand-copy that drifts, and a declined spawn
    // costs one bounded process once per kit update.
    if (fs.existsSync(path.join(relayDir, 'request.txt'))) return;

    // Absolute path: an unqualified 'powershell.exe' resolves through a search
    // path that includes the session's cwd, which a hostile repo controls
    // (CWE-427); Windows PowerShell's location is fixed on every Windows.
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows',
        'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (!fs.existsSync(powershell)) return;

    // The timeout outlasts a cold-WMI process enumeration (the script's one
    // slow step); the script orders its deploy write after that, so even a
    // timeout kill leaves the drift hash detectable and a later session
    // retries.
    try {
        spawnSync(powershell,
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', armScript, '-RefreshOnly'],
            { stdio: 'ignore', windowsHide: true, timeout: 30000 }
        );
    } catch { /* fail open */ }
}

try { main(); } catch { /* never break a session over a hook */ }
process.exit(0);
