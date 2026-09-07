// Tests for the git child environment that plugins/claude-kit/doctor/
// install-memory-sync.ps1 builds inside Invoke-MemorySyncGit, the single
// funnel every git call in the memory store's sync path passes through.
//
// The subject is a behaviour no static reading establishes: whether a
// repository's own config can make a sync-path git call run that
// repository's code, and whether the funnel's scrub reaches the variables a
// caller's environment carries. So every case here is two-direction by
// construction, and the direction that must see the effect runs first: a
// marker that never appears for an unrelated reason would otherwise read as
// a pass.
//
// Node's built-in test runner, no framework. Each case owns a fresh temp
// directory under os.tmpdir() and removes it, opens no port, and shares
// nothing with its neighbours. The cases spawn Windows PowerShell and are
// skipped off Windows, where the doctor does not run.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = path.join(__dirname, '..');
const PLUGIN_ROOT = path.join(REPO, 'plugins', 'claude-kit');
const INSTALLER = path.join(PLUGIN_ROOT, 'doctor', 'install-memory-sync.ps1');
const isWin = process.platform === 'win32';

// Single-quoted PowerShell literal, any embedded quote doubled.
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function pwsh(script, extraEnv) {
    return spawnSync('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { encoding: 'utf8', env: { ...process.env, ...(extraEnv || {}) } });
}

function rmDir(dir) {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        // Best-effort cleanup; leaving a temp dir behind never fails the test.
    }
}

// A repository that reports on being read: core.fsmonitor and core.hooksPath
// both point at scripts that append a line to a marker file. git runs the
// fsmonitor command on a status and the pre-commit hook on a commit, so the
// two keys cover a read-shaped call and a write-shaped one. The marker path
// is baked into each script rather than passed through the environment,
// because the environment is exactly what the guard under test rewrites.
function plantRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitguard-'));
    const repo = path.join(dir, 'planted');
    const marker = path.join(dir, 'marker.txt').replace(/\\/g, '/');
    fs.mkdirSync(repo, { recursive: true });
    const git = (args) => {
        const res = spawnSync('git', ['-C', repo].concat(args), { encoding: 'utf8', env: { ...process.env } });
        assert.strictEqual(res.status, 0, args.join(' ') + ': ' + res.stdout + res.stderr);
        return res;
    };
    git(['init', '--quiet', '.']);
    git(['config', 'user.email', 'planted@example.invalid']);
    git(['config', 'user.name', 'planted']);
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'a\n');
    git(['add', 'tracked.txt']);
    git(['commit', '--quiet', '-m', 'init']);

    fs.writeFileSync(path.join(repo, 'fsmonitor.sh'),
        '#!/bin/sh\nprintf \'fsmonitor\\n\' >> "' + marker + '"\nprintf \'/\\0\'\n');
    fs.mkdirSync(path.join(repo, 'planted-hooks'));
    fs.writeFileSync(path.join(repo, 'planted-hooks', 'pre-commit'),
        '#!/bin/sh\nprintf \'hookspath\\n\' >> "' + marker + '"\nexit 0\n');
    git(['config', 'core.fsmonitor', repo.replace(/\\/g, '/') + '/fsmonitor.sh']);
    git(['config', 'core.hooksPath', repo.replace(/\\/g, '/') + '/planted-hooks']);
    return { dir, repo, marker: path.join(dir, 'marker.txt') };
}

function markerLines(marker) {
    if (!fs.existsSync(marker)) return [];
    return fs.readFileSync(marker, 'utf8').split(/\r?\n/).filter((l) => l.length > 0);
}

test('a planted repository\'s fsmonitor and hooksPath run under bare git and not through the funnel',
    { skip: !isWin }, () => {
        const planted = plantRepo();
        try {
            // Direction one, the control: bare git, no guard. Both keys must
            // speak here, or their silence in direction two says nothing.
            const bareStatus = spawnSync('git', ['-C', planted.repo, 'status', '--porcelain'],
                { encoding: 'utf8', env: { ...process.env } });
            assert.strictEqual(bareStatus.status, 0, bareStatus.stdout + bareStatus.stderr);
            assert.ok(markerLines(planted.marker).includes('fsmonitor'),
                'core.fsmonitor did not fire under bare git, so the fixture proves nothing: '
                + JSON.stringify(markerLines(planted.marker)));

            const bareCommit = spawnSync('git',
                ['-C', planted.repo, 'commit', '--quiet', '--allow-empty', '-m', 'bare'],
                { encoding: 'utf8', env: { ...process.env } });
            assert.strictEqual(bareCommit.status, 0, bareCommit.stdout + bareCommit.stderr);
            assert.ok(markerLines(planted.marker).includes('hookspath'),
                'core.hooksPath did not fire under bare git, so the fixture proves nothing: '
                + JSON.stringify(markerLines(planted.marker)));

            // Direction two: the same two calls through the funnel, whose
            // environment-config pins beat the repository's own config.
            fs.rmSync(planted.marker, { force: true });
            const script = '. ' + q(INSTALLER) + '; '
                + '$s = Invoke-MemorySyncGit -StoreRoot ' + q(planted.repo) + ' -Arguments @("status", "--porcelain"); '
                + '$c = Invoke-MemorySyncGit -StoreRoot ' + q(planted.repo)
                + ' -Arguments @("commit", "--quiet", "--allow-empty", "-m", "guarded"); '
                + '@{ Status = $s.Code; Commit = $c.Code; Output = @($s.Output) + @($c.Output) } '
                + '| ConvertTo-Json -Compress -Depth 4 | Write-Output';
            const res = pwsh(script);
            assert.strictEqual(res.status, 0, res.stdout + res.stderr);
            const out = JSON.parse(res.stdout);
            assert.strictEqual(out.Status, 0, 'guarded status failed: ' + JSON.stringify(out));
            assert.strictEqual(out.Commit, 0, 'guarded commit failed: ' + JSON.stringify(out));
            assert.deepStrictEqual(markerLines(planted.marker), [],
                'the planted repository executed its own code through the funnel: '
                + JSON.stringify(markerLines(planted.marker)));
        } finally {
            rmDir(planted.dir);
        }
    });

test('the funnel strips the caller\'s GIT_* variables, keeps the config files, and restores what it took',
    { skip: !isWin }, () => {
        const planted = plantRepo();
        try {
            // Two config sources, so the strip has a direction to fail in.
            // GIT_CONFIG_GLOBAL redirects git's global config file and is a
            // variable the guard removes rather than overwrites, which is
            // what makes its silence evidence about the strip itself: a
            // planted variable the guard happens to set anyway would read as
            // stripped whether the strip ran or not. The home-directory
            // config is the source the guard must leave alone, since
            // suppressing the config files is how a guard loses
            // safe.directory and turns into a dubious-ownership refusal.
            const injected = path.join(planted.dir, 'injected.gitconfig');
            fs.writeFileSync(injected, '[kitguard]\n\tprobe = planted-by-the-environment\n');
            const home = path.join(planted.dir, 'home');
            fs.mkdirSync(home, { recursive: true });
            fs.writeFileSync(path.join(home, '.gitconfig'), '[kitguard]\n\tglobal = kept\n');
            // GIT_TERMINAL_PROMPT carries a caller value the guard
            // overwrites, so the restore has something to get wrong.
            const callerEnv = {
                GIT_CONFIG_GLOBAL: injected,
                GIT_TERMINAL_PROMPT: 'caller-value',
                HOME: home,
                USERPROFILE: home
            };
            const names = ['GIT_CONFIG_GLOBAL', 'GIT_TERMINAL_PROMPT', 'GIT_CONFIG_COUNT',
                'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_KEY_1', 'GIT_CONFIG_VALUE_1',
                'NoDefaultCurrentDirectoryInExePath'];
            const readBack = '$seen = @{}; foreach ($n in @(' + names.map(q).join(', ') + ')) '
                + '{ $seen[$n] = [Environment]::GetEnvironmentVariable($n) }; ';
            const funnel = (key) => 'Invoke-MemorySyncGit -StoreRoot ' + q(planted.repo)
                + ' -Arguments @("config", "--get", ' + q(key) + ')';
            const script = '. ' + q(INSTALLER) + '; '
                // The control: bare git in this same environment, which must
                // read the injected file or the assertion below is vacuous.
                + '$bare = @(& git -C ' + q(planted.repo) + ' config --get kitguard.probe 2>&1 '
                + '| ForEach-Object { [string]$_ }); '
                + readBack + '$before = $seen; '
                + '$probe = ' + funnel('kitguard.probe') + '; '
                + '$global = ' + funnel('kitguard.global') + '; '
                + '$name = ' + funnel('user.name') + '; '
                + readBack + '$after = $seen; '
                + '@{ Bare = $bare; Probe = @($probe.Output); ProbeCode = $probe.Code; '
                + 'Global = @($global.Output); Name = @($name.Output); '
                + 'Before = $before; After = $after } '
                + '| ConvertTo-Json -Compress -Depth 4 | Write-Output';
            const res = pwsh(script, callerEnv);
            assert.strictEqual(res.status, 0, res.stdout + res.stderr);
            const out = JSON.parse(res.stdout);

            assert.deepStrictEqual(out.Bare, ['planted-by-the-environment'],
                'bare git did not read the injected config file, so the strip assertion below '
                + 'proves nothing: ' + JSON.stringify(out));
            assert.deepStrictEqual(out.Probe, [],
                'the caller\'s GIT_CONFIG_GLOBAL survived the strip: ' + JSON.stringify(out));
            assert.strictEqual(out.ProbeCode, 1,
                'a key no config source holds must read as absent: ' + JSON.stringify(out));
            // The pins are additive rather than a suppression, so both
            // ordinary config sources still answer.
            assert.deepStrictEqual(out.Global, ['kept'],
                'the guard suppressed the global config file, which is how safe.directory gets '
                + 'lost: ' + JSON.stringify(out));
            assert.deepStrictEqual(out.Name, ['planted'],
                'the guard lost the repository\'s own local config: ' + JSON.stringify(out));

            // The leak check, over every name the guard strips or sets: the
            // calling session's environment is what it was.
            assert.deepStrictEqual(out.After, out.Before,
                'the guard leaked into the calling session: ' + JSON.stringify(out));
            assert.strictEqual(out.After.GIT_TERMINAL_PROMPT, 'caller-value', JSON.stringify(out));
            assert.strictEqual(out.After.GIT_CONFIG_GLOBAL, injected, JSON.stringify(out));
            assert.strictEqual(out.After.GIT_CONFIG_COUNT, null, JSON.stringify(out));
        } finally {
            rmDir(planted.dir);
        }
    });
