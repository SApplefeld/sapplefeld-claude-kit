#!/usr/bin/env node
// SessionStart hook: branch-hygiene nudge.
//
// Counts local branches that look reapable (verified merged into the integration
// branch: origin/develop, else origin/main, else origin/master) and reminds Scott
// to run the branch-hygiene skill. Read-only and fail-open: it never deletes
// anything, uses only cached refs (no network fetch), times out fast, and any
// error exits 0 with no output. Kept separate from session-start.js so the
// resume-critical hook is untouched.

'use strict';

const fs = require('fs');
const { execSync } = require('child_process');

function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function git(cwd, args) {
    return execSync('git ' + args, {
        cwd,
        timeout: 4000,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8'
    });
}

function refExists(cwd, ref) {
    try { git(cwd, `rev-parse --verify --quiet ${ref}`); return true; } catch { return false; }
}

function main() {
    let p = {};
    try { p = JSON.parse(readStdin() || '{}'); } catch { return; }
    const cwd = p.cwd || process.cwd();

    // Integration ref: develop preferred, then main, then master.
    let integ = null;
    for (const r of ['refs/remotes/origin/develop', 'refs/remotes/origin/main', 'refs/remotes/origin/master']) {
        if (refExists(cwd, r)) { integ = r.replace('refs/remotes/', ''); break; }
    }
    if (!integ) return; // no integration ref / not a repo: silent

    const protectedNames = new Set(['develop', 'main', 'master']);
    try { protectedNames.add(git(cwd, 'rev-parse --abbrev-ref HEAD').trim()); } catch { /* ignore */ }

    let count = 0;
    try {
        count = git(cwd, `branch --merged ${integ}`)
            .split('\n')
            .map((l) => l.replace('*', '').trim())
            .filter(Boolean)
            .filter((b) => !protectedNames.has(b))
            .length;
    } catch { return; } // cannot compute: stay silent

    if (count === 0) return;

    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: `Branch hygiene: ${count} local branch(es) are merged into ${integ} and look reapable (along with any worktrees on them). Run the branch-hygiene skill to sweep the verified-merged ones; it leaves anything unmerged or dirty for you. Reminder, not a blocker.`
        }
    }));
}

try { main(); } catch { /* never break a session over a hook */ }
process.exit(0);
