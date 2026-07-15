'use strict';
// Regression harness for the blocking PreToolUse guards. Each guard is spawned as
// a child process (node <guard-path>) with a JSON payload piped to stdin; the test
// asserts the exit code (0 allow / 2 deny) and, for denies, that stderr carries the
// guard's "Blocked:" message. The payload mirrors the real hook shape:
//   { tool_name, tool_input: { command | file_path }, cwd, agent_type? }
// The guards never read tool_name, so command cases are exercised under both Bash
// and PowerShell tool names to pin payload parity across the two shells.
//
// Run: node --test tools/hook-tests/guards.test.js
//
// All git repos and shims live under os.tmpdir() and are removed after each suite;
// the harness never touches the real repo's git state.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { spawnSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOKS = path.resolve(__dirname, '..', '..', 'plugins', 'claude-kit', 'hooks');
const DOCS_GUARD = path.join(HOOKS, 'docs-write-guard.js');
const MERGED_GUARD = path.join(HOOKS, 'merged-pr-push-guard.js');
const PR_DOCS_GUARD = path.join(HOOKS, 'pr-docs-guard.js');

// Spawn a guard with `payload` (object -> JSON, or a raw string for the
// malformed-stdin case) on stdin. Returns { code, stdout, stderr }.
function runGuard(guardPath, payload, opts) {
    const options = opts || {};
    const stdin = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const res = spawnSync(process.execPath, [guardPath], {
        input: stdin,
        cwd: options.cwd,
        env: options.env || process.env,
        encoding: 'utf8',
        timeout: 20000
    });
    return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function mkTmp(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmrf(dir) {
    // Windows keeps read-only handles on .git pack files briefly after use, so
    // retry rather than strand the temp dir.
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* best effort */ }
}

// Initialize a real (throwaway) git repo with one commit and an optional origin.
function initGitRepo(dir, remoteUrl) {
    const opts = { cwd: dir, stdio: 'ignore' };
    execSync('git init -q', opts);
    execSync('git config user.email t@example.com', opts);
    execSync('git config user.name tester', opts);
    execSync('git config commit.gpgsign false', opts);
    fs.writeFileSync(path.join(dir, 'README.md'), 'seed\n');
    execSync('git add README.md', opts);
    execSync('git commit -qm init', opts);
    if (remoteUrl) execSync('git remote add origin ' + remoteUrl, opts);
}

// A recorder shim for the host CLI (gh/az): appends its args to a log file and
// prints `output` (empty by default) to stdout. Presence of the log proves the
// guard reached the host query; the printed line drives the guard's parse (gh
// needs "MERGED"; az treats any non-empty tsv row as a completed PR).
function makeRecorder(dir, output) {
    const recFile = path.join(dir, 'invoked.log');
    const out = output || '';
    if (process.platform === 'win32') {
        let body = '@echo off\r\n>>"' + recFile + '" echo %*\r\n';
        if (out) body += 'echo ' + out + '\r\n';
        fs.writeFileSync(path.join(dir, 'gh.cmd'), body);
        fs.writeFileSync(path.join(dir, 'az.cmd'), body);
    } else {
        let body = '#!/bin/sh\necho "$@" >> "' + recFile + '"\n';
        if (out) body += 'echo "' + out + '"\n';
        for (const name of ['gh', 'az']) {
            const f = path.join(dir, name);
            fs.writeFileSync(f, body);
            fs.chmodSync(f, 0o755);
        }
    }
    return recFile;
}

// A child env whose PATH is prepended with `dir`, matching the host's own PATH key
// casing (Windows uses "Path"), so the recorder shim resolves ahead of the real CLI.
function envWithPath(dir) {
    const e = Object.assign({}, process.env);
    const key = Object.keys(e).find((k) => k.toLowerCase() === 'path') || 'PATH';
    e[key] = dir + path.delimiter + (e[key] || '');
    return e;
}

// ---------------------------------------------------------------------------
// docs-write-guard
// ---------------------------------------------------------------------------

describe('docs-write-guard', () => {
    const SUBAGENT = 'general-purpose';

    function docsPayload(fields) {
        const toolInput = {};
        if (fields.file_path) toolInput.file_path = fields.file_path;
        if (fields.command) toolInput.command = fields.command;
        const p = { tool_name: fields.tool_name, tool_input: toolInput, cwd: os.tmpdir() };
        if (fields.agent_type) p.agent_type = fields.agent_type;
        return p;
    }

    // Command heuristic, exercised under both tool names. deny = expect exit 2.
    const commandCases = [
        { name: 'bash redirect into docs/', cmd: 'echo hi > docs/x.txt', deny: true },
        { name: 'Set-Content positional docs\\', cmd: "'hi' | Set-Content docs\\x.txt", deny: true },
        { name: 'Out-File -FilePath docs/', cmd: "'hi' | Out-File -FilePath docs/x.txt", deny: true },
        { name: 'Add-Content -Path docs\\', cmd: 'Add-Content -Path docs\\a.md -Value hi', deny: true },
        { name: 'Tee-Object -FilePath docs/', cmd: 'Tee-Object -FilePath docs/log.txt', deny: true },
        // Path reached across intervening parameters, and colon-joined -FilePath.
        { name: 'Out-File -Append docs/', cmd: 'Out-File -Append docs/x.md', deny: true },
        { name: 'Out-File -Encoding utf8 docs/', cmd: 'Out-File -Encoding utf8 docs/x.md', deny: true },
        { name: 'Set-Content -Value hi -Path docs/', cmd: 'Set-Content -Value hi -Path docs/x.md', deny: true },
        { name: 'Out-File -FilePath:docs/ (colon)', cmd: 'Out-File -FilePath:docs/x.md', deny: true },
        { name: 'Set-Content into .kit/', cmd: "'hi' | Set-Content .kit\\x.txt", deny: false },
        { name: 'Set-Content into mydocs/', cmd: 'Set-Content mydocs\\x.txt', deny: false },
        // Embedded cmdlet name (set-Content inside Reset-Content) is not a write.
        { name: 'Reset-Content docs/ (embedded name)', cmd: 'Reset-Content docs/x.md', deny: false }
    ];

    for (const c of commandCases) {
        for (const tool of ['Bash', 'PowerShell']) {
            test((c.deny ? 'deny' : 'allow') + ' ' + c.name + ' [' + tool + ']', () => {
                const r = runGuard(DOCS_GUARD, docsPayload({
                    tool_name: tool,
                    agent_type: SUBAGENT,
                    command: c.cmd
                }));
                if (c.deny) {
                    assert.strictEqual(r.code, 2, 'expected deny; stderr=' + r.stderr);
                    assert.match(r.stderr, /Blocked:/);
                } else {
                    assert.strictEqual(r.code, 0, 'expected allow; stderr=' + r.stderr);
                }
            });
        }
    }

    test('deny subagent Write into docs/', () => {
        const r = runGuard(DOCS_GUARD, docsPayload({
            tool_name: 'Write', agent_type: SUBAGENT, file_path: 'docs/x.md'
        }));
        assert.strictEqual(r.code, 2, r.stderr);
        assert.match(r.stderr, /Blocked:/);
    });

    test('allow main-session Write into docs/ (no agent_type)', () => {
        const r = runGuard(DOCS_GUARD, docsPayload({
            tool_name: 'Write', file_path: 'docs/x.md'
        }));
        assert.strictEqual(r.code, 0, r.stderr);
    });

    test('allow docs-curator Write into docs/', () => {
        const r = runGuard(DOCS_GUARD, docsPayload({
            tool_name: 'Write', agent_type: 'claude-kit:docs-curator', file_path: 'docs/x.md'
        }));
        assert.strictEqual(r.code, 0, r.stderr);
    });

    test('allow on malformed stdin (fail-open)', () => {
        const r = runGuard(DOCS_GUARD, 'not-json{');
        assert.strictEqual(r.code, 0, r.stderr);
    });

    // The command heuristics must stay linear-time: a ~1MB adversarial command that
    // never contains a docs/ path should return promptly (no catastrophic
    // backtracking), and allow. Wall time includes node startup; the bound is loose
    // and only trips on a runaway regex, which would take many seconds or time out.
    test('command heuristic stays fast on adversarial input (ReDoS sanity)', () => {
        const bomb = 'Set-Content -x ' + 'a/'.repeat(500000);
        const start = Date.now();
        const r = runGuard(DOCS_GUARD, docsPayload({
            tool_name: 'PowerShell', agent_type: SUBAGENT, command: bomb
        }));
        const elapsed = Date.now() - start;
        assert.strictEqual(r.code, 0, 'adversarial input has no docs/ path; expected allow');
        assert.ok(elapsed < 5000, 'heuristic took ' + elapsed + 'ms; expected < 5000ms');
    });
});

// ---------------------------------------------------------------------------
// merged-pr-push-guard
// ---------------------------------------------------------------------------

describe('merged-pr-push-guard', () => {
    let repo, recDir, recFile, env;

    before(() => {
        repo = mkTmp('mpr-repo-');
        initGitRepo(repo, 'https://github.com/example/repo.git');
        recDir = mkTmp('mpr-rec-');
        recFile = makeRecorder(recDir);
        env = envWithPath(recDir);
    });

    after(() => {
        rmrf(repo);
        rmrf(recDir);
    });

    beforeEach(() => {
        try { fs.unlinkSync(recFile); } catch { /* absent is fine */ }
    });

    // Each command yields the named branch after the guard's own parsing; the
    // allowlist must reject it before any host query fires.
    const injectionCases = [
        { name: 'feat/x;calc.exe', cmd: 'git push origin feat/x;calc.exe' },
        { name: '$(whoami)', cmd: 'git push origin $(whoami)' },
        { name: '`whoami`', cmd: 'git push origin `whoami`' },
        { name: '--upload-pack=x', cmd: 'git push origin HEAD:--upload-pack=x' }
    ];

    for (const c of injectionCases) {
        for (const tool of ['Bash', 'PowerShell']) {
            test('injection branch ' + c.name + ' exits 0 without host call [' + tool + ']', () => {
                const r = runGuard(MERGED_GUARD, {
                    tool_name: tool, tool_input: { command: c.cmd }, cwd: repo
                }, { cwd: repo, env });
                assert.strictEqual(r.code, 0, r.stderr);
                assert.ok(!fs.existsSync(recFile), 'host CLI recorder must be untouched');
            });
        }
    }

    test('valid branch reaches the host query', () => {
        const r = runGuard(MERGED_GUARD, {
            tool_name: 'Bash', tool_input: { command: 'git push origin feature/valid-1.0' }, cwd: repo
        }, { cwd: repo, env });
        // Empty shim output -> UNKNOWN -> allow (exit 0), but the host WAS reached.
        assert.strictEqual(r.code, 0, r.stderr);
        assert.ok(fs.existsSync(recFile), 'valid branch should reach the host CLI');
    });

    test('branch deletion exits 0 without host call', () => {
        const r = runGuard(MERGED_GUARD, {
            tool_name: 'Bash', tool_input: { command: 'git push --delete origin somebranch' }, cwd: repo
        }, { cwd: repo, env });
        assert.strictEqual(r.code, 0, r.stderr);
        assert.ok(!fs.existsSync(recFile), 'deletion must not reach the host CLI');
    });

    test('non-push command exits 0 without host call', () => {
        const r = runGuard(MERGED_GUARD, {
            tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: repo
        }, { cwd: repo, env });
        assert.strictEqual(r.code, 0, r.stderr);
        assert.ok(!fs.existsSync(recFile), 'non-push must not reach the host CLI');
    });

    test('integration branch (main) allowed with no host query', () => {
        const r = runGuard(MERGED_GUARD, {
            tool_name: 'Bash', tool_input: { command: 'git push origin main' }, cwd: repo
        }, { cwd: repo, env });
        assert.strictEqual(r.code, 0, r.stderr);
        assert.ok(!fs.existsSync(recFile), 'integration branch must not reach the host CLI');
    });

    test('quoted branch "feat/x" reaches the host query (FIX 3)', () => {
        const r = runGuard(MERGED_GUARD, {
            tool_name: 'Bash', tool_input: { command: 'git push origin "feat/x"' }, cwd: repo
        }, { cwd: repo, env });
        assert.strictEqual(r.code, 0, r.stderr);
        assert.ok(fs.existsSync(recFile), 'quoted valid branch should reach the host CLI');
    });

    test('force-delete refspec +:dst is treated as deletion (no host call)', () => {
        const r = runGuard(MERGED_GUARD, {
            tool_name: 'Bash', tool_input: { command: 'git push origin +:feat/gone' }, cwd: repo
        }, { cwd: repo, env });
        assert.strictEqual(r.code, 0, r.stderr);
        assert.ok(!fs.existsSync(recFile), 'deletion must not reach the host CLI');
    });
});

// ---------------------------------------------------------------------------
// merged-pr-push-guard: deny path (needs a host that reports a merged PR)
// ---------------------------------------------------------------------------

describe('merged-pr-push-guard (deny path)', () => {
    // Run the guard against a throwaway repo whose origin is `remoteUrl`, with a
    // gh/az shim that prints `shimOut`. Captures whether the host CLI was invoked
    // before cleanup, and returns { r, recorded }.
    function runWithHost(remoteUrl, shimOut, command, setup) {
        const repo = mkTmp('mpr-deny-repo-');
        const shimDir = mkTmp('mpr-deny-shim-');
        try {
            initGitRepo(repo, remoteUrl);
            if (setup) setup(repo);
            const recFile = makeRecorder(shimDir, shimOut);
            const env = envWithPath(shimDir);
            const r = runGuard(MERGED_GUARD, {
                tool_name: 'Bash', tool_input: { command }, cwd: repo
            }, { cwd: repo, env });
            return { r, recorded: fs.existsSync(recFile) };
        } finally {
            rmrf(repo);
            rmrf(shimDir);
        }
    }

    test('MERGED github PR blocks the push', () => {
        const { r } = runWithHost(
            'https://github.com/example/repo.git', 'MERGED', 'git push origin feature/valid-1.0'
        );
        assert.strictEqual(r.code, 2, r.stderr);
        assert.match(r.stderr, /Blocked:/);
    });

    test('completed Azure DevOps PR blocks the push', () => {
        // az emits a non-empty tsv row for a completed PR; any non-empty output qualifies.
        const { r } = runWithHost(
            'https://dev.azure.com/org/proj/_git/repo', 'MERGED', 'git push origin feature/valid-1.0'
        );
        assert.strictEqual(r.code, 2, r.stderr);
        assert.match(r.stderr, /Blocked:/);
    });

    test('force refspec +feat/x with a MERGED PR blocks (FIX 1 + FIX 3)', () => {
        const { r } = runWithHost(
            'https://github.com/example/repo.git', 'MERGED', 'git push origin +feat/x'
        );
        assert.strictEqual(r.code, 2, r.stderr);
        assert.match(r.stderr, /Blocked:/);
    });

    test('bare git push resolves HEAD and flows through the allowlist to the host', () => {
        const { r, recorded } = runWithHost(
            'https://github.com/example/repo.git', '', 'git push',
            (repo) => execSync('git checkout -q -b feature/head-branch', { cwd: repo, stdio: 'ignore' })
        );
        // Empty shim output -> UNKNOWN -> allow, but the resolved HEAD branch reached the host.
        assert.strictEqual(r.code, 0, r.stderr);
        assert.ok(recorded, 'resolved HEAD branch should reach the host CLI');
    });
});

// ---------------------------------------------------------------------------
// pr-docs-guard (smoke pins; not modified by this section)
// ---------------------------------------------------------------------------

describe('pr-docs-guard (smoke)', () => {
    test('dirty docs/ + gh pr create -> deny', () => {
        const repo = mkTmp('prd-dirty-');
        try {
            initGitRepo(repo, 'https://github.com/example/repo.git');
            fs.mkdirSync(path.join(repo, 'docs'));
            fs.writeFileSync(path.join(repo, 'docs', 'plan.md'), 'uncommitted\n');
            const r = runGuard(PR_DOCS_GUARD, {
                tool_name: 'Bash', tool_input: { command: 'gh pr create --fill' }, cwd: repo
            }, { cwd: repo });
            assert.strictEqual(r.code, 2, r.stderr);
            assert.match(r.stderr, /Blocked:/);
        } finally {
            rmrf(repo);
        }
    });

    test('clean docs/ + gh pr create -> allow', () => {
        const repo = mkTmp('prd-clean-');
        try {
            initGitRepo(repo, 'https://github.com/example/repo.git');
            const r = runGuard(PR_DOCS_GUARD, {
                tool_name: 'Bash', tool_input: { command: 'gh pr create --fill' }, cwd: repo
            }, { cwd: repo });
            assert.strictEqual(r.code, 0, r.stderr);
        } finally {
            rmrf(repo);
        }
    });
});
