#!/usr/bin/env node
// PreToolUse guard: docs must be committed before the PR.
//
// In Branch-and-PR and Commit-and-Push efforts the documentation work (drift
// curation, plan archival, backlog prune, index refresh) must ship in the same
// PR as the code, not as a follow-up. Where neither author can release their own
// PR, a separate docs PR is a governance dead-end, so this blocks creating the
// PR while docs/ still has uncommitted changes. The finishing-work gate routes;
// this is the teeth.
//
// Fires on Bash. Acts only on a PR-creation command (gh pr create,
// az repos pr create). A chain that runs git commit ahead of the PR create
// (git commit ... && gh pr create) is allowed: the command commits the docs
// itself, so the pre-execution dirty check would false-positive on it.
// Distinct from docs-write-guard.js: that scopes to
// non-curator subagents writing docs/; this applies to anyone opening the PR.
//
// SAFETY: fails OPEN. Any error (no cwd, git missing, not a repo, timeout, parse
// failure) exits 0 (allow). It exits 2 (deny) only when it positively confirms a
// PR-creation command with uncommitted docs/ changes.

'use strict';

const fs = require('fs');
const { execSync } = require('child_process');

function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// Index of the first PR-creation command (gh pr create, az repos pr create) in
// the string, or -1 if none.
function prCreateIndex(cmd) {
    const c = String(cmd || '');
    const matches = [/\bgh\s+pr\s+create\b/i.exec(c), /\baz\s+repos\s+pr\s+create\b/i.exec(c)]
        .filter(Boolean)
        .map(m => m.index);
    return matches.length ? Math.min(...matches) : -1;
}

// True if a git commit appears before position `end` in the command string. A
// chain that commits ahead of the PR create (git commit ... && gh pr create)
// commits the docs itself, so the pre-execution dirty check would be a false
// positive; such chains are allowed. Fail-open tradeoff: a chained commit whose
// pathspec excludes docs/ also passes.
function commitsBefore(cmd, end) {
    const m = /\bgit\s+commit\b/i.exec(String(cmd || ''));
    return m !== null && m.index < end;
}

// True if docs/ has uncommitted or untracked changes vs HEAD; null if we cannot
// tell (git failed, not a repo), which the caller treats as allow (fail open).
function docsDirty(cwd) {
    try {
        const out = execSync('git status --porcelain -- docs', {
            cwd,
            timeout: 5000,
            stdio: ['ignore', 'pipe', 'ignore'],
            encoding: 'utf8'
        });
        return out.trim().length > 0;
    } catch {
        return null;
    }
}

function main() {
    let p = {};
    try { p = JSON.parse(readStdin() || '{}'); } catch { return; } // parse fail: allow

    const input = p.tool_input || p.toolInput || (p.tool && p.tool.input) || {};
    const cmd = input.command;
    if (!cmd) return;
    const prAt = prCreateIndex(cmd);
    if (prAt < 0) return; // not a PR-creation command: allow
    if (commitsBefore(cmd, prAt)) return; // chain commits before the PR create: allow

    const cwd = p.cwd || process.cwd();
    const dirty = docsDirty(cwd);
    if (dirty !== true) return; // clean, or could not determine: allow

    process.stderr.write(
        `Blocked: docs/ has uncommitted changes, so this PR would ship without them. The documentation ` +
        `work (curation, plan archival, backlog prune, index refresh) ships in the same PR as the code, ` +
        `never as a follow-up. Commit the docs work into the branch (the finishing-work close-out runs ` +
        `curating-docs), then open the PR.\n`
    );
    process.exit(2); // deny
}

try { main(); } catch { /* fail open */ }
process.exit(0);
