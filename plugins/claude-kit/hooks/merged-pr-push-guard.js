#!/usr/bin/env node
// PreToolUse guard: never push to a branch whose PR has already merged.
//
// In Branch-and-PR, once the PR merges the feature branch is frozen: further
// pushes strand off the integration branch with no signal, and the kit's own
// rituals keep writing records (Chapters, decisions, the register) late. This
// blocks a push to a branch with a MERGED pull request and tells the agent to
// open a doc PR against the integration branch instead. Pushed is not merged.
//
// SAFETY: fails OPEN. It blocks only when it positively confirms a MERGED PR for
// the target branch via the host CLI. Anything else (not a push, an integration
// branch, no CLI, not authenticated, no PR, query error, timeout, parse failure)
// exits 0 (allow). A guard that cannot tell never blocks.

'use strict';

const fs = require('fs');
const { execSync } = require('child_process');

function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function sh(cmd, cwd, timeout) {
    return execSync(cmd, {
        cwd,
        timeout: timeout || 8000,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
        env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' })
    });
}

// The branch a `git push` targets, or null if this is not a push to guard.
// Detects `git push` only at a command-segment start (so a quoted mention in an
// echo is ignored).
function targetBranch(cmd, cwd) {
    const c = String(cmd || '');
    if (!/(?:^|&&|;|\|)\s*git\s+push\b/.test(c)) return null;
    const after = c.replace(/^[\s\S]*?\bgit\s+push\b/, '').trim();
    // A branch deletion (git push --delete / -d, or a `:branch` / `+:branch` refspec)
    // removes a merged branch: correct cleanup, the inverse of stranding. Never guard it.
    if (/(?:^|\s)(?:--delete|-d)\b/.test(after)) return null;
    const toks = after.split(/\s+/).filter((t) => t && !t.startsWith('-'));
    // toks[0] = remote (if present), toks[1] = refspec (if present).
    let ref = toks.length >= 2 ? toks[1] : null;
    let branch = null;
    if (ref) {
        if (ref.includes(':')) {
            const parts = ref.split(':');
            if (parts[0] === '' || parts[0] === '+') return null; // :dst or +:dst = deletion
            ref = parts[parts.length - 1]; // src:dst -> dst
        }
        branch = ref;
    }
    if (!branch || branch === 'HEAD') {
        try { branch = sh('git rev-parse --abbrev-ref HEAD', cwd, 3000).trim(); } catch { return null; }
    }
    return branch || null;
}

// MERGED | OPEN | UNKNOWN, by asking the host. UNKNOWN on any failure (fail-open).
function prState(branch, cwd) {
    let host = '';
    try { host = sh('git remote get-url origin', cwd, 3000).trim(); } catch { return 'UNKNOWN'; }
    try {
        if (/github\.com/i.test(host)) {
            const s = sh(`gh pr view ${branch} --json state -q .state`, cwd).trim().toUpperCase();
            if (s === 'MERGED') return 'MERGED';
            return s ? 'OPEN' : 'UNKNOWN';
        }
        if (/dev\.azure\.com|visualstudio\.com/i.test(host)) {
            const out = sh(`az repos pr list --source-branch refs/heads/${branch} --status completed -o tsv`, cwd).trim();
            return out ? 'MERGED' : 'OPEN';
        }
    } catch {
        return 'UNKNOWN';
    }
    return 'UNKNOWN';
}

function main() {
    let p = {};
    try { p = JSON.parse(readStdin() || '{}'); } catch { return; }
    const cwd = p.cwd || process.cwd();
    const input = p.tool_input || p.toolInput || (p.tool && p.tool.input) || {};

    const branch = targetBranch(input.command, cwd);
    if (!branch) return;                                   // not a guarded push
    if (/^(develop|main|master)$/i.test(branch)) return;   // integration branches

    if (prState(branch, cwd) !== 'MERGED') return;         // open / unknown: allow

    process.stderr.write(
        `Blocked: the PR for branch "${branch}" has already merged, so this push would strand off the ` +
        `integration branch. The branch is frozen (pushed is not merged). Put any post-merge record in a ` +
        `new doc PR against the integration branch instead of pushing here.\n`
    );
    process.exit(2);
}

try { main(); } catch { /* fail open */ }
process.exit(0);
