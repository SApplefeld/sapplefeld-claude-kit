// Tests for plugins/claude-kit/scripts/memq-shim.js and its installer,
// plugins/claude-kit/doctor/install-memq-shim.ps1.
//
// Node's built-in test runner, no framework, no install (Node v24). Every
// case spawns the shim as a child process with KIT_PLUGINS_ROOT pointed at a
// temp stand-in for ~/.claude/plugins, so no test reads or writes the real
// home directory; process.env is spread, never rebuilt, so children keep the
// Windows `Path` key. The fake payloads carry a stub scripts/memq.js that
// prints its own location and argv and exits with FAKE_MEMQ_EXIT, which is
// how a case proves exactly which cache entry the shim chose and that stdio,
// argv, and the exit code pass through.
//
// The installer cases spawn Windows PowerShell and run Install-MemqShim
// against a redirected directory (never the real ~/.claude); they and the
// doctor parse check are skipped off Windows, where the doctor itself does
// not run.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = path.join(__dirname, '..');
const SHIM = path.join(REPO, 'plugins', 'claude-kit', 'scripts', 'memq-shim.js');
const PLUGIN_ROOT = path.join(REPO, 'plugins', 'claude-kit');
const INSTALLER = path.join(PLUGIN_ROOT, 'doctor', 'install-memq-shim.ps1');
const DOCTOR = path.join(PLUGIN_ROOT, 'doctor', 'doctor.ps1');
const isWin = process.platform === 'win32';

// The stub payload: prints where it was resolved from and what argv it got,
// which is how a case proves which cache entry ran. Under FAKE_MEMQ_BANNER it
// instead answers the way the real memq answers an argless run (usage on
// stderr, exit 1), which is the health signal Get-MemqShimStatus keys on; the
// status tests below pin that signal against the real memq.js as well, so the
// stub can never drift into asserting a contract memq does not have.
const FAKE_MEMQ = "if (process.env.FAKE_MEMQ_BANNER === '1') {\n"
    + "    process.stderr.write('usage: memq log <key> pass|fail \"<summary>\"\\n');\n"
    + "    process.exitCode = 1;\n"
    + "} else {\n"
    + "    console.log('FAKE-MEMQ ' + __dirname);\n"
    + "    console.log('ARGS ' + JSON.stringify(process.argv.slice(2)));\n"
    + "    process.exitCode = Number(process.env.FAKE_MEMQ_EXIT || 0);\n"
    + "}\n";

// Windows environment names are case-insensitive, but a spread of process.env
// copies whichever spelling the OS handed this process ('PATH' under Git
// Bash, 'Path' under PowerShell). Adding the other spelling leaves two PATH
// variables in the child's environment block and the child reads only one of
// them, so an override has to land under the parent's own key.
function withPath(env, value) {
    const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'Path';
    env[key] = value;
    return env;
}

function makePluginsRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'memq-shim-'));
}

function rmDir(dir) {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        // Best-effort cleanup; leaving a temp dir behind never fails the test.
    }
}

// A fake cache entry <root>/cache/<marketplace>/claude-kit/<version>, valid
// (carrying the stub memq.js) unless noScript asks for a half-removed one.
function addCacheEntry(root, marketplace, version, options) {
    const dir = path.join(root, 'cache', marketplace, 'claude-kit', version);
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    if (!(options && options.noScript)) {
        fs.writeFileSync(path.join(dir, 'scripts', 'memq.js'), FAKE_MEMQ, 'utf8');
    }
    return dir;
}

function setEntryMtime(dir, isoDate) {
    const t = new Date(isoDate);
    fs.utimesSync(dir, t, t);
}

function writeManifest(root, installPath, key) {
    const plugins = {};
    plugins[key || 'claude-kit@applefeld'] = [{ scope: 'user', installPath, version: 'x' }];
    fs.writeFileSync(path.join(root, 'installed_plugins.json'),
        JSON.stringify({ version: 2, plugins }) + '\n', 'utf8');
}

// Run a shim (the repo copy unless shimPath overrides) against a redirected
// plugins root. The redirect selects which code runs, so the shim honors it
// only alongside KIT_PLUGINS_ROOT_ALLOW_CODE=1; the suite is the intended
// consumer of both, and one case below drops the second signal deliberately.
function runShim(root, args, extra, shimPath) {
    return spawnSync(process.execPath, [shimPath || SHIM].concat(args || []), {
        encoding: 'utf8',
        env: {
            ...process.env,
            KIT_PLUGINS_ROOT: root,
            KIT_PLUGINS_ROOT_ALLOW_CODE: '1',
            ...(extra || {})
        }
    });
}

// The scripts directory of an entry, which is what the stub prints as its
// __dirname.
function scriptsDirOf(entryDir) {
    return path.join(entryDir, 'scripts');
}

test('resolves through the manifest installPath when it is valid', () => {
    const root = makePluginsRoot();
    try {
        const a = addCacheEntry(root, 'applefeld', 'aaaa');
        const b = addCacheEntry(root, 'applefeld', 'bbbb');
        setEntryMtime(a, '2026-01-01T00:00:00Z');
        setEntryMtime(b, '2026-06-01T00:00:00Z');
        // The manifest names the older entry: the harness's record of the
        // active install wins over a newer entry it has not activated.
        writeManifest(root, a);
        const res = runShim(root, ['find', 'x']);
        assert.strictEqual(res.status, 0, res.stderr);
        assert.ok(res.stdout.includes('FAKE-MEMQ ' + scriptsDirOf(a)), res.stdout);
        assert.ok(res.stdout.includes('ARGS ["find","x"]'), res.stdout);
    } finally {
        rmDir(root);
    }
});

test('survives a cache hash change without re-install: a stale manifest falls back to the scan', () => {
    const root = makePluginsRoot();
    try {
        const a = addCacheEntry(root, 'applefeld', 'aaaa');
        writeManifest(root, a);
        // Simulate a kit update replacing the cache entry: the directory the
        // manifest points at is gone, and only the new hash exists.
        const b = path.join(root, 'cache', 'applefeld', 'claude-kit', 'bbbb');
        fs.renameSync(a, b);
        const res = runShim(root, []);
        assert.strictEqual(res.status, 0, res.stderr);
        assert.ok(res.stdout.includes('FAKE-MEMQ ' + scriptsDirOf(b)), res.stdout);
    } finally {
        rmDir(root);
    }
});

test('the scan picks the newest valid entry and skips one without the memq script', () => {
    const root = makePluginsRoot();
    try {
        const older = addCacheEntry(root, 'applefeld', 'aaaa');
        const newer = addCacheEntry(root, 'applefeld', 'bbbb');
        const newestInvalid = addCacheEntry(root, 'applefeld', 'cccc', { noScript: true });
        setEntryMtime(older, '2026-01-01T00:00:00Z');
        setEntryMtime(newer, '2026-06-01T00:00:00Z');
        setEntryMtime(newestInvalid, '2026-07-01T00:00:00Z');
        const res = runShim(root, []);
        assert.strictEqual(res.status, 0, res.stderr);
        assert.ok(res.stdout.includes('FAKE-MEMQ ' + scriptsDirOf(newer)), res.stdout);
    } finally {
        rmDir(root);
    }
});

test('exits 1 with a note naming the fix when no payload is installed', () => {
    const root = makePluginsRoot();
    try {
        const res = runShim(root, ['find', 'x']);
        assert.strictEqual(res.status, 1);
        assert.match(res.stderr, /no installed claude-kit payload/);
        assert.match(res.stderr, /doctor/);
    } finally {
        rmDir(root);
    }
});

// --- What the two failure notes may carry --------------------------------
//
// This shim's stderr is read by a model: it is what runs when a session invokes
// memq. Both values its failure notes would naturally carry are home-anchored
// (the plugins directory under ~/.claude, and the payload inside it), and the
// renderer that takes the OS account name out of a path lives in the payload
// this file has just failed to find or to run, with the installed copy of this
// file sitting outside every payload. So the notes name no path at all, which
// is what these two cases hold.

test('the no-payload note names no path, since nothing here could elide one', () => {
    const root = makePluginsRoot();
    try {
        const res = runShim(root, ['find', 'x']);
        assert.strictEqual(res.status, 1);
        assert.match(res.stderr, /no installed claude-kit payload/,
            'test setup: the note under test is the one this fixture stages: ' + res.stderr);
        assert.ok(!res.stderr.includes(root),
            'the searched directory is withheld rather than printed: ' + res.stderr);
        assert.ok(!res.stderr.includes(path.basename(root)),
            'and no component of it rides out either: ' + res.stderr);
        assert.match(res.stderr, /withheld/,
            'while the note says the path is missing rather than leaving a reader to wonder: '
            + res.stderr);
        assert.match(res.stderr, /doctor/,
            'and the remedy still stands in its place: ' + res.stderr);
    } finally {
        rmDir(root);
    }
});

// A preload that makes the shim's own spawn fail the way a broken interpreter
// or a refused executable does: with an error object rather than an exit code.
// It runs before the shim loads, so the patch is in place before the shim's
// `const { spawnSync } = require('child_process')` captures the binding, and
// the message it fails with carries the payload path the way a real one does.
// Forward-slashed for NODE_OPTIONS, which parses a backslash as an escape.
function spawnRefusingPreload(dir) {
    const shimFile = path.join(dir, 'refuse-spawn.js');
    fs.writeFileSync(shimFile, [
        "'use strict';",
        "const cp = require('child_process');",
        'cp.spawnSync = function (file, args) {',
        "    const err = new Error('the fixture refuses to start ' + file + ' ' + args.join(' '));",
        "    err.code = 'ERR_FIXTURE_REFUSED';",
        '    return { error: err, status: null, signal: null, stdout: null, stderr: null };',
        '};'
    ].join('\n') + '\n', 'utf8');
    return '--require "' + shimFile.replace(/\\/g, '/') + '"';
}

test('a spawn this shim cannot start reports the code, and neither the payload path nor the message', () => {
    const root = makePluginsRoot();
    try {
        const entry = addCacheEntry(root, 'applefeld', 'aaaa');
        const res = runShim(root, ['find', 'x'],
            { NODE_OPTIONS: spawnRefusingPreload(root) });
        assert.strictEqual(res.status, 1, res.stderr);
        assert.match(res.stderr, /could not run the installed claude-kit payload/,
            'test setup: the spawn was refused, which is the leg under test: '
            + JSON.stringify(res.stderr));
        assert.ok(!res.stderr.includes(entry),
            'the payload path is withheld rather than printed: ' + res.stderr);
        assert.ok(!res.stderr.includes('refuses to start'),
            'and so is the error text, which names the file the spawn was refused on: '
            + res.stderr);
        assert.ok(res.stderr.includes('(ERR_FIXTURE_REFUSED)'),
            'while the error code, an identifier that can carry no path, names the kind of '
            + 'failure: ' + res.stderr);
        assert.match(res.stderr, /doctor/,
            'and the remedy is named: ' + res.stderr);
    } finally {
        rmDir(root);
    }
});

test('propagates the resolved memq exit code', () => {
    const root = makePluginsRoot();
    try {
        addCacheEntry(root, 'applefeld', 'aaaa');
        const res = runShim(root, [], { FAKE_MEMQ_EXIT: '42' });
        assert.strictEqual(res.status, 42, res.stderr);
    } finally {
        rmDir(root);
    }
});

test('KIT_PLUGINS_ROOT alone is ignored, loudly: it selects code, so it needs its second signal', () => {
    const root = makePluginsRoot();
    try {
        addCacheEntry(root, 'applefeld', 'aaaa');
        // The realistic vector is a committed repo file exporting shell env
        // (a .vscode terminal profile, devcontainer.json, .envrc), which can
        // set one variable that looks like configuration. Without the second
        // signal the override is refused and the real install is searched, so
        // the redirect never chooses which JavaScript runs.
        const res = runShim(root, [], { KIT_PLUGINS_ROOT_ALLOW_CODE: '' });
        assert.match(res.stderr, /ignoring KIT_PLUGINS_ROOT/);
        assert.ok(!res.stdout.includes('FAKE-MEMQ'),
            'the redirected payload must not run without the second signal');
        // A value other than exactly '1' is not the signal either.
        const almost = runShim(root, [], { KIT_PLUGINS_ROOT_ALLOW_CODE: 'true' });
        assert.match(almost.stderr, /ignoring KIT_PLUGINS_ROOT/);
        assert.ok(!almost.stdout.includes('FAKE-MEMQ'));
    } finally {
        rmDir(root);
    }
});

test('the scan pins the marketplace the manifest names', () => {
    const root = makePluginsRoot();
    try {
        // Two marketplaces each ship a directory named claude-kit. The
        // manifest says whose kit this machine runs, so a newer entry from
        // the other publisher must not win, even though its mtime is later
        // and the manifest's own installPath no longer exists.
        const mine = addCacheEntry(root, 'applefeld', 'aaaa');
        const theirs = addCacheEntry(root, 'someone-else', 'zzzz');
        setEntryMtime(mine, '2026-01-01T00:00:00Z');
        setEntryMtime(theirs, '2026-07-01T00:00:00Z');
        writeManifest(root, path.join(root, 'cache', 'applefeld', 'claude-kit', 'gone'));
        const res = runShim(root, []);
        assert.strictEqual(res.status, 0, res.stderr);
        assert.ok(res.stdout.includes('FAKE-MEMQ ' + scriptsDirOf(mine)), res.stdout);
        assert.ok(!res.stdout.includes(scriptsDirOf(theirs)), res.stdout);
    } finally {
        rmDir(root);
    }
});

test('with no manifest answer, a multi-marketplace scan names the ambiguity on stderr', () => {
    const root = makePluginsRoot();
    try {
        const a = addCacheEntry(root, 'applefeld', 'aaaa');
        const b = addCacheEntry(root, 'someone-else', 'bbbb');
        setEntryMtime(a, '2026-07-01T00:00:00Z');
        setEntryMtime(b, '2026-01-01T00:00:00Z');
        const res = runShim(root, []);
        assert.strictEqual(res.status, 0, res.stderr);
        assert.ok(res.stdout.includes('FAKE-MEMQ ' + scriptsDirOf(a)), res.stdout);
        assert.match(res.stderr, /2 marketplaces offer a claude-kit payload/);
    } finally {
        rmDir(root);
    }
});

// Run Install-MemqShim under Windows PowerShell against a redirected .claude
// directory. Single quotes around interpolated paths, with any embedded
// single quote doubled, keep PowerShell from interpreting them.
function runInstaller(claudeDir) {
    const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
    const script = '. ' + q(INSTALLER) + '; '
        + '$r = Install-MemqShim -PluginRoot ' + q(PLUGIN_ROOT) + ' -ClaudeDir ' + q(claudeDir) + '; '
        + '$r.Notes | Write-Output; if (-not $r.Ok) { exit 1 }';
    return spawnSync('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { encoding: 'utf8' });
}

test('Install-MemqShim lands the resolver and all three wrappers in a redirected directory', { skip: !isWin }, () => {
    const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memq-claude-'));
    const root = makePluginsRoot();
    try {
        const res = runInstaller(claudeDir);
        assert.strictEqual(res.status, 0, res.stdout + res.stderr);
        const binDir = path.join(claudeDir, 'bin');
        // The installed resolver is a byte-for-byte copy of the repo shim.
        assert.strictEqual(fs.readFileSync(path.join(binDir, 'memq-shim.js'), 'utf8'),
            fs.readFileSync(SHIM, 'utf8'));
        // Each wrapper delegates to the resolver beside it in its own shell's
        // terms: memq.ps1 splats $args onto node (no cmd.exe in the path),
        // memq.cmd is CRLF-terminated for cmd.exe, and the sh wrapper is
        // LF-only so its shebang line survives.
        const ps1 = fs.readFileSync(path.join(binDir, 'memq.ps1'), 'utf8');
        assert.ok(ps1.includes('$PSScriptRoot'), ps1);
        assert.ok(ps1.includes('@args'), 'memq.ps1 must splat its arguments, never rebuild a command line');
        assert.ok(!/cmd(\.exe)?\s/i.test(ps1), 'memq.ps1 must not route through cmd.exe');
        const cmd = fs.readFileSync(path.join(binDir, 'memq.cmd'), 'utf8');
        assert.ok(cmd.includes('%~dp0memq-shim.js'), cmd);
        assert.ok(cmd.includes('\r\n'), 'memq.cmd must be CRLF-terminated');
        const sh = fs.readFileSync(path.join(binDir, 'memq'), 'utf8');
        assert.ok(sh.startsWith('#!/bin/sh\n'), sh);
        assert.ok(!sh.includes('\r'), 'the sh wrapper must carry no CR bytes');
        // The installed copy resolves a payload end to end, against a
        // redirected plugins root, exactly like the repo copy.
        const entry = addCacheEntry(root, 'applefeld', 'aaaa');
        const run = runShim(root, ['get', 'k'], null, path.join(binDir, 'memq-shim.js'));
        assert.strictEqual(run.status, 0, run.stderr);
        assert.ok(run.stdout.includes('FAKE-MEMQ ' + scriptsDirOf(entry)), run.stdout);
        assert.ok(run.stdout.includes('ARGS ["get","k"]'), run.stdout);
    } finally {
        rmDir(claudeDir);
        rmDir(root);
    }
});

test('the installed memq.cmd wrapper runs end to end and propagates the exit code', { skip: !isWin }, () => {
    const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memq-claude-'));
    const root = makePluginsRoot();
    try {
        assert.strictEqual(runInstaller(claudeDir).status, 0);
        const entry = addCacheEntry(root, 'applefeld', 'aaaa');
        // The whole payload is wrapped in one more pair of quotes, because
        // cmd.exe /s strips the first and last quote of what follows /c: a
        // temp path holding a space (an account name with one) would
        // otherwise split and fail here for a reason unrelated to the shim.
        const wrapper = path.join(claudeDir, 'bin', 'memq.cmd');
        const res = spawnSync('cmd.exe',
            ['/d', '/s', '/c', '""' + wrapper + '" alpha"'], {
                encoding: 'utf8',
                windowsVerbatimArguments: true,
                env: {
                    ...process.env,
                    KIT_PLUGINS_ROOT: root,
                    KIT_PLUGINS_ROOT_ALLOW_CODE: '1',
                    FAKE_MEMQ_EXIT: '7'
                }
            });
        assert.strictEqual(res.status, 7, res.stdout + res.stderr);
        assert.ok(res.stdout.includes('FAKE-MEMQ ' + scriptsDirOf(entry)), res.stdout);
        assert.ok(res.stdout.includes('ARGS ["alpha"]'), res.stdout);
    } finally {
        rmDir(claudeDir);
        rmDir(root);
    }
});

// Run Get-MemqShimStatus against redirected directories and return its
// answer as JSON. PATH and the plugins root are supplied to the child, so the
// name-resolution and payload-resolution readings are both driven by the
// test rather than by this machine's real state.
function statusOf(claudeDir, options) {
    const opts = options || {};
    const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
    const args = '-PluginRoot ' + q(opts.pluginRoot || PLUGIN_ROOT) + ' -ClaudeDir ' + q(claudeDir)
        + ' -NodeExe ' + q(process.execPath)
        + (opts.userPath === undefined ? '' : ' -UserPath ' + q(opts.userPath));
    const script = '. ' + q(INSTALLER) + '; '
        + '$s = Get-MemqShimStatus ' + args + '; '
        + '$s.Missing = @($s.Missing); $s.Stale = @($s.Stale); '
        + '$s | ConvertTo-Json -Compress | Write-Output';
    const env = {
        ...process.env,
        KIT_PLUGINS_ROOT: opts.pluginsRoot || '',
        KIT_PLUGINS_ROOT_ALLOW_CODE: opts.pluginsRoot ? '1' : '',
        FAKE_MEMQ_BANNER: '1'
    };
    if (opts.path !== undefined) withPath(env, opts.path);
    const res = spawnSync('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { encoding: 'utf8', env });
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    return JSON.parse(res.stdout);
}

// Git Bash, when this machine has it. The sh wrapper is the path a Bash-tool
// invocation takes, and NTFS carries no POSIX execute bit, so whether a bare
// `memq` resolves there is a question only a real run answers.
const bashExe = (() => {
    if (!isWin) return 'bash';
    for (const p of [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe')]) {
        try { if (fs.statSync(p).isFile()) return p; } catch { /* try the next */ }
    }
    return null;
})();

test('a bare `memq` resolves and runs through the sh wrapper in Git Bash', { skip: !isWin || bashExe === null }, () => {
    const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memq-claude-'));
    const root = makePluginsRoot();
    try {
        assert.strictEqual(runInstaller(claudeDir).status, 0);
        const entry = addCacheEntry(root, 'applefeld', 'aaaa');
        const binDir = path.join(claudeDir, 'bin');
        // No chmod anywhere in the installer: MSYS2 infers the execute bit
        // from the '#!' opening on NTFS, so the wrapper is runnable as
        // written. This asserts the resulting behavior rather than the
        // inference, so a change in that inference fails here.
        const res = spawnSync(bashExe, ['-c', 'command -v memq && memq beta'], {
            encoding: 'utf8',
            env: withPath({
                ...process.env,
                KIT_PLUGINS_ROOT: root,
                KIT_PLUGINS_ROOT_ALLOW_CODE: '1'
            }, binDir + path.delimiter + process.env.PATH)
        });
        assert.strictEqual(res.status, 0, res.stdout + res.stderr);
        assert.ok(res.stdout.includes('FAKE-MEMQ ' + scriptsDirOf(entry)), res.stdout);
        assert.ok(res.stdout.includes('ARGS ["beta"]'), res.stdout);
    } finally {
        rmDir(claudeDir);
        rmDir(root);
    }
});

test('PowerShell resolves memq.ps1, and that is what keeps an argument from starting a second command', { skip: !isWin }, () => {
    // Long-form the temp dir: os.tmpdir() can answer in 8.3 short form
    // (LOCALA~1), while PowerShell reports resolved commands long-form, and
    // the assertions below compare the two as strings.
    const claudeDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'memq-claude-')));
    const root = makePluginsRoot();
    try {
        assert.strictEqual(runInstaller(claudeDir).status, 0);
        const entry = addCacheEntry(root, 'applefeld', 'aaaa');
        const binDir = path.join(claudeDir, 'bin');
        const env = () => withPath({
            ...process.env,
            KIT_PLUGINS_ROOT: root,
            KIT_PLUGINS_ROOT_ALLOW_CODE: '1'
        }, binDir + path.delimiter + process.env.PATH);
        const inPwsh = (script) => spawnSync('powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
            { encoding: 'utf8', env: env() });

        // PowerShell searches for .ps1 by its own rules, independently of
        // PATHEXT, and prefers it over the sibling .cmd.
        const resolved = inPwsh('(Get-Command memq -ErrorAction SilentlyContinue).Source');
        assert.strictEqual(resolved.stdout.trim(), path.join(binDir, 'memq.ps1'), resolved.stderr);

        // The discriminator is an exit code no wrapper and no payload can
        // produce: 77 appears only if cmd.exe parsed the argument, ended its
        // quoted region at the stray double quote, and ran `exit 77` as a
        // command of its own. Through memq.ps1 the same text is argv, so the
        // stub runs normally and exits 0. The trailing `exit $LASTEXITCODE`
        // is what carries the inner code out of the -Command script, so the
        // two branches are compared on the same signal.
        const payload = "memq 'broke out\" & exit 77 & rem '; exit $LASTEXITCODE";
        const viaPs1 = inPwsh(payload);
        assert.notStrictEqual(viaPs1.status, 77, 'an argument must not be able to start a second command');
        assert.strictEqual(viaPs1.status, 0, viaPs1.stdout + viaPs1.stderr);
        assert.ok(viaPs1.stdout.includes('FAKE-MEMQ ' + scriptsDirOf(entry)), viaPs1.stdout);

        // Exit codes still propagate through the PowerShell wrapper.
        const code = inPwsh('memq x; exit $LASTEXITCODE');
        assert.strictEqual(code.status, 0, code.stderr);
        const failing = spawnSync('powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'memq x; exit $LASTEXITCODE'],
            { encoding: 'utf8', env: withPath({ ...process.env, KIT_PLUGINS_ROOT: root,
                KIT_PLUGINS_ROOT_ALLOW_CODE: '1', FAKE_MEMQ_EXIT: '13' },
            binDir + path.delimiter + process.env.PATH) });
        assert.strictEqual(failing.status, 13, failing.stdout + failing.stderr);

        // The other direction, so the assertion above cannot pass for the
        // wrong reason: with memq.ps1 gone, PowerShell falls back to the .cmd
        // wrapper, whose only argument forwarding is %*, and the very same
        // payload does start a second command. That is the exposure memq.ps1
        // removes for PowerShell callers, and it remains open for callers
        // that reach the .cmd (cmd.exe, which does not resolve .ps1).
        fs.unlinkSync(path.join(binDir, 'memq.ps1'));
        const cmdControl = inPwsh('memq plain; exit $LASTEXITCODE');
        assert.strictEqual(cmdControl.status, 0,
            'the .cmd fallback must still work for an ordinary argument, or the 77 below proves nothing');
        const viaCmd = inPwsh(payload);
        assert.strictEqual(viaCmd.status, 77,
            'the .cmd fallback is expected to be the vulnerable path; if this changed, the .ps1 rationale needs revisiting');
    } finally {
        rmDir(claudeDir);
        rmDir(root);
    }
});

test('the health signal the status check keys on is the real memq argless contract', () => {
    // Get-MemqShimStatus calls a shim healthy on exit 1 plus "usage: memq".
    // That is the real CLI's argless answer, pinned here against the real
    // script, so the stub payload the other cases use cannot quietly become
    // the only thing that contract is checked against.
    const res = spawnSync(process.execPath,
        [path.join(PLUGIN_ROOT, 'scripts', 'memq.js')], { encoding: 'utf8' });
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /usage: memq/);
});

test('the status check reports a content-swapped shim as stale, which is what makes -Fix reach it', { skip: !isWin }, () => {
    const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memq-claude-'));
    const root = makePluginsRoot();
    try {
        assert.strictEqual(runInstaller(claudeDir).status, 0);
        addCacheEntry(root, 'applefeld', 'aaaa');
        const binDir = path.join(claudeDir, 'bin');
        const clean = statusOf(claudeDir, { pluginsRoot: root });
        assert.deepStrictEqual(clean.Missing, []);
        assert.deepStrictEqual(clean.Stale, []);
        assert.strictEqual(clean.Resolves, true);

        // All files are present and every one of them runs, so a smoke
        // test alone still reads healthy. Content is what catches it: a
        // resolver whose bytes are not this payload's, a wrapper edited
        // to call something else, and a launcher whose bytes drifted.
        fs.appendFileSync(path.join(binDir, 'memq-shim.js'), '\n// swapped\n');
        fs.writeFileSync(path.join(binDir, 'memq.cmd'),
            '@echo off\r\nnode "%~dp0other.js" %*\r\n', 'utf8');
        fs.writeFileSync(path.join(binDir, 'memq.ps1'),
            '& node (Join-Path $PSScriptRoot \'other.js\') @args\r\n', 'utf8');
        fs.appendFileSync(path.join(binDir, 'kit-statusline.js'), '\n// swapped\n');
        const swapped = statusOf(claudeDir, { pluginsRoot: root });
        assert.deepStrictEqual(swapped.Stale.sort(), ['kit-statusline.js', 'memq-shim.js', 'memq.cmd', 'memq.ps1']);
        assert.strictEqual(swapped.Resolves, true, 'the swapped copy still runs, which is the point');

        // A reinstall is the repair, and it is what -Fix now runs on a stale
        // install rather than only on a missing one.
        assert.strictEqual(runInstaller(claudeDir).status, 0);
        const repaired = statusOf(claudeDir, { pluginsRoot: root });
        assert.deepStrictEqual(repaired.Stale, []);
        assert.deepStrictEqual(repaired.Missing, []);
    } finally {
        rmDir(claudeDir);
        rmDir(root);
    }
});

test('a foreign memq winning name resolution is reported, never read as on-PATH', { skip: !isWin }, () => {
    // Long-form both temp dirs, for the same 8.3-vs-long reason as above:
    // OnPath and ShadowedBy come back from PowerShell spelled long-form.
    const claudeDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'memq-claude-')));
    const root = makePluginsRoot();
    const foreignDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'memq-foreign-')));
    try {
        assert.strictEqual(runInstaller(claudeDir).status, 0);
        addCacheEntry(root, 'applefeld', 'aaaa');
        const binDir = path.join(claudeDir, 'bin');

        // The kit's own directory resolves: healthy and on PATH.
        const own = statusOf(claudeDir, { pluginsRoot: root, path: binDir + ';' + process.env.Path });
        assert.strictEqual(own.OnPath, true);
        assert.strictEqual(own.ShadowedBy, null);

        // A memq planted in an earlier PATH entry (the shape a user-writable
        // directory such as WindowsApps has, since the durable PATH is only
        // ever appended to) must be named, not smoothed into a pass by the
        // fallback that merely checks the directory is listed somewhere.
        fs.writeFileSync(path.join(foreignDir, 'memq.cmd'), '@echo off\r\nexit /b 0\r\n', 'utf8');
        const shadowed = statusOf(claudeDir, {
            pluginsRoot: root,
            path: foreignDir + ';' + binDir + ';' + process.env.Path,
            userPath: binDir
        });
        assert.strictEqual(shadowed.OnPath, false, 'a shadowed shim is not on PATH in any useful sense');
        assert.strictEqual(shadowed.ShadowedBy, path.join(foreignDir, 'memq.cmd'));
    } finally {
        rmDir(claudeDir);
        rmDir(root);
        rmDir(foreignDir);
    }
});

test('a machine with no installed payload is diagnosed as no-payload, not as a damaged shim', { skip: !isWin }, () => {
    const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memq-claude-'));
    const emptyRoot = makePluginsRoot();
    try {
        assert.strictEqual(runInstaller(claudeDir).status, 0);
        // A clone-only machine: the shim is installed and intact, and there
        // is simply nothing installed for it to run. No -Fix can repair that,
        // so the two states have to be distinguishable from the status alone.
        const status = statusOf(claudeDir, { pluginsRoot: emptyRoot });
        assert.deepStrictEqual(status.Missing, []);
        assert.deepStrictEqual(status.Stale, []);
        assert.strictEqual(status.Resolves, false);
        assert.strictEqual(status.NoPayload, true);
    } finally {
        rmDir(claudeDir);
        rmDir(emptyRoot);
    }
});

test('the PATH membership predicate compares whole entries, not substrings', { skip: !isWin }, () => {
    const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
    const cases = [
        ['C:\\a\\bin;C:\\b', 'C:\\a\\bin', true],
        ['C:\\a\\bin2;C:\\b', 'C:\\a\\bin', false],
        ['C:\\a\\bin\\;C:\\b', 'C:\\a\\bin', true],
        ['C:\\A\\BIN', 'c:\\a\\bin', true],
        ['', 'C:\\a\\bin', false],
        ['%USERPROFILE%\\bin;C:\\a\\bin', 'C:\\a\\bin', true]
    ];
    const script = '. ' + q(INSTALLER) + '; '
        + cases.map(([raw, dir]) =>
            '(Test-UserPathContains -RawPath ' + q(raw) + ' -Directory ' + q(dir) + ')').join('; ');
    const res = spawnSync('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    const answers = res.stdout.trim().split(/\r?\n/).map((l) => l.trim() === 'True');
    assert.deepStrictEqual(answers, cases.map((c) => c[2]));
});

test('doctor.ps1 and install-memq-shim.ps1 parse cleanly', { skip: !isWin }, () => {
    const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
    const script = '$errs = $null; $tokens = $null; '
        + '[System.Management.Automation.Language.Parser]::ParseFile(' + q(DOCTOR)
        + ', [ref]$tokens, [ref]$errs) | Out-Null; '
        + 'if ($errs.Count -gt 0) { $errs | Write-Output; exit 1 } '
        + '[System.Management.Automation.Language.Parser]::ParseFile(' + q(INSTALLER)
        + ', [ref]$tokens, [ref]$errs) | Out-Null; '
        + 'if ($errs.Count -gt 0) { $errs | Write-Output; exit 1 }';
    const res = spawnSync('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
});
