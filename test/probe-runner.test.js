// Tests for tools/probe-corpus/run.mjs, the scenario-probe runner.
//
// Node's built-in test runner, no framework. The runner is ESM and this suite
// is CommonJS like its neighbours, so the module is loaded with a dynamic
// import inside each case.
//
// Two layers. The pure functions (argument parsing, reply parsing, the diff
// against the ruling, the exit code, the report shaping) are asserted directly.
// The end-to-end cases build a whole disposable repository under a fresh temp
// directory: a copy of the runner and its template at the layout the runner
// resolves its paths from, a minimal parser module standing in for the probe
// file parser so the case pins the runner rather than the parser, probe
// fixtures, and a fake reader CLI that answers from a canned script. Nothing
// here ever spawns the real reader: a suite that called it would cost money and
// return a different answer every run.
//
// Every case owns its temp directory and opens no port, so the file is
// parallel-safe by construction.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const RUNNER = path.join(__dirname, '..', 'tools', 'probe-corpus', 'run.mjs');
const TEMPLATE = path.join(__dirname, '..', 'tools', 'probe-corpus', 'template.md');
const HOOKS = path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks');

// A shape file path names a file under the plugin root or one markdown file in
// the home directory, and the runner enforces that allowlist at the read
// boundary the way the parser enforces it at the file. The disposable
// repositories here therefore carry their corpus under the plugin root: a
// fixture spelled any other way is refused before it is read, which is the
// property the allowlist cases below assert directly.
const CORPUS = 'plugins/claude-kit/corpus/';
const CORPUS_SEGMENTS = ['plugins', 'claude-kit', 'corpus'];

function loadRunner() {
    return import(pathToFileURL(RUNNER).href);
}

function probe(overrides) {
    return Object.assign({
        moment: 'commit-and-push-at-section-close',
        tier: 'sonnet',
        verdict: 'RESOLVED',
        answer: 'commit-and-push',
        ruling: { state: 'ruled', date: '2026-09-06' },
        options: ['commit-and-push', 'commit-only', 'ask-first'],
        shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }, { name: 'narrow', files: [CORPUS + 'b.md'] }],
        scenario: 'A section is green and the plan header names Commit-and-Push. What happens now?'
    }, overrides || {});
}

// ------------------------------------------------------------- arg parsing

test('parseArgs takes the documented flags and defaults the rest', async () => {
    const { parseArgs } = await loadRunner();
    assert.deepStrictEqual(parseArgs([]), { before: null, only: null, shape: null, claude: null, home: null, dryRun: false });
    const args = parseArgs(['--before', 'abc123', '--only', 'one, two', '--shape', 'full', '--claude', 'C:/bin/claude.exe', '--home', '/tmp/home', '--dry-run']);
    assert.strictEqual(args.before, 'abc123');
    assert.deepStrictEqual(args.only, ['one', 'two']);
    assert.strictEqual(args.shape, 'full');
    assert.strictEqual(args.claude, 'C:/bin/claude.exe');
    assert.strictEqual(args.home, '/tmp/home');
    assert.strictEqual(args.dryRun, true);
});

test('parseArgs refuses a flag standing where a value belongs', async () => {
    const { parseArgs } = await loadRunner();
    assert.throws(() => parseArgs(['--only', '--dry-run']), /the value is missing/);
    assert.throws(() => parseArgs(['--shape', '--before', 'HEAD']), /the value is missing/);
});

// The home directory decides which .credentials.json is copied and where a
// `home/` shape entry is read from, so a run pointed at a fixture home touches
// nothing of the operator's.
test('the home directory comes from the flag, then the environment, then this machine', async () => {
    const { resolveHomeDir } = await loadRunner();
    assert.strictEqual(resolveHomeDir({ home: '/flag/home' }, { PROBE_HOME_DIR: '/env/home' }), path.resolve('/flag/home'));
    assert.strictEqual(resolveHomeDir({ home: null }, { PROBE_HOME_DIR: '/env/home' }), path.resolve('/env/home'));
    assert.ok(resolveHomeDir({ home: null }, {}).endsWith('.claude'));
});

// A reader binary that resolves to nothing has to stop the run at the top: left
// unresolved it turns every pair into an ERROR row, which reads like the whole
// corpus moving at once.
test('the reader binary is resolved to a file before any pair runs, and a name that is not there is refused', async () => {
    const { resolveReaderBinary } = await loadRunner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-bin-'));
    try {
        const named = path.join(dir, 'stand-in-reader.mjs');
        fs.writeFileSync(named, '// a stand-in\n', 'utf8');
        assert.strictEqual(resolveReaderBinary(named, {}), path.resolve(named));
        // A bare name is resolved on the PATH the caller hands over.
        assert.strictEqual(resolveReaderBinary('stand-in-reader.mjs', { PATH: dir }), path.resolve(named));
        assert.throws(() => resolveReaderBinary('no-such-reader-binary', { PATH: dir }), /resolves to no file/);
        assert.throws(() => resolveReaderBinary(path.join(dir, 'absent'), {}), /resolves to no file/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('parseArgs refuses an unknown flag and names it', async () => {
    const { parseArgs } = await loadRunner();
    assert.throws(() => parseArgs(['--parallel']), /unknown flag "--parallel"/);
});

test('parseArgs refuses a dash-leading --before value and says why', async () => {
    const { parseArgs } = await loadRunner();
    assert.throws(() => parseArgs(['--before', '--upload-pack=evil']), /starts with a dash/);
});

test('parseArgs refuses an empty --before, --shape or --only by name, with a reason about that flag', async () => {
    const { parseArgs } = await loadRunner();
    assert.throws(() => parseArgs(['--before', '']), /--before was given an empty value: an empty --before/);
    assert.throws(() => parseArgs(['--shape', '']), /--shape was given an empty value: an empty --shape/);
    assert.throws(() => parseArgs(['--only', '']), /--only was given an empty value: an empty --only/);
    assert.equal(parseArgs(['--shape', 'full']).shape, 'full');
});

test('parseArgs refuses a value flag with nothing after it', async () => {
    const { parseArgs } = await loadRunner();
    assert.throws(() => parseArgs(['--before']), /takes a value and none followed it/);
});

test('resolveClaudeBin prefers the flag over the environment variable', async () => {
    const { resolveClaudeBin } = await loadRunner();
    assert.strictEqual(resolveClaudeBin({ claude: '/flag/claude' }, { PROBE_CLAUDE_BIN: '/env/claude' }), '/flag/claude');
    assert.strictEqual(resolveClaudeBin({ claude: null }, { PROBE_CLAUDE_BIN: '/env/claude' }), '/env/claude');
    assert.strictEqual(resolveClaudeBin({ claude: null }, {}), 'claude');
});

test('a ref git does not resolve to a commit is refused before any reader runs', async () => {
    const { verifyRef } = await loadRunner();
    const calls = [];
    const fake = (dir, args) => {
        calls.push(args);
        return { status: 1, stdout: Buffer.alloc(0), stderr: '' };
    };
    assert.throws(() => verifyRef('/repo', 'nope', fake), /is not a commit in this repository/);
    assert.deepStrictEqual(calls[0], ['rev-parse', '--verify', '--quiet', 'nope^{commit}']);
});

// --------------------------------------------------------- reader isolation

// The isolation is what makes a reading a reading of the shape rather than of
// this machine, so the argument set and the child environment are pinned here:
// dropping one of these silently would leave every later run green and no
// longer cold.
test('the reader is invoked cold: no tools, no setting sources, a minimal system prompt', async () => {
    const { readerArgs, READER_SYSTEM_PROMPT } = await loadRunner();
    const args = readerArgs('sonnet');
    assert.deepStrictEqual(args, [
        '-p', '--model', 'sonnet', '--tools', '', '--setting-sources', '',
        '--system-prompt', READER_SYSTEM_PROMPT, '--output-format', 'json'
    ]);
});

test('the child environment keeps the scratch config directory and drops the session it was spawned from', async () => {
    const { readerEnv } = await loadRunner();
    const env = readerEnv({
        PATH: '/usr/bin',
        CLAUDE_CODE_SESSION_ID: 'ses-1',
        CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/sock',
        CLAUDECODE: '1',
        ANTHROPIC_API_KEY: 'sk-parent',
        ANTHROPIC_BASE_URL: 'https://proxy.invalid',
        AI_AGENT: '1',
        // The network plumbing the scrub leaves deliberately: a box that reaches
        // the API only through a proxy or only with a local certificate
        // authority is a box where a reader stripped of these cannot connect at
        // all. They route and authenticate the transport rather than naming the
        // account the reading is billed to.
        HTTP_PROXY: 'http://proxy.invalid:8080',
        HTTPS_PROXY: 'http://proxy.invalid:8443',
        NO_PROXY: 'localhost,127.0.0.1',
        NODE_EXTRA_CA_CERTS: '/etc/ssl/local-ca.pem',
        SSL_CERT_FILE: '/etc/ssl/cert.pem'
    }, '/scratch/config');
    assert.deepStrictEqual(env, {
        PATH: '/usr/bin',
        CLAUDE_CONFIG_DIR: '/scratch/config',
        HTTP_PROXY: 'http://proxy.invalid:8080',
        HTTPS_PROXY: 'http://proxy.invalid:8443',
        NO_PROXY: 'localhost,127.0.0.1',
        NODE_EXTRA_CA_CERTS: '/etc/ssl/local-ca.pem',
        SSL_CERT_FILE: '/etc/ssl/cert.pem'
    });
});

test('a reader path ending in .mjs is run with this Node rather than spawned as a program', async () => {
    const { readerCommand } = await loadRunner();
    assert.deepStrictEqual(readerCommand('/tmp/fake-claude.mjs'), { cmd: process.execPath, prefix: ['/tmp/fake-claude.mjs'] });
    assert.deepStrictEqual(readerCommand('C:/bin/claude.exe'), { cmd: 'C:/bin/claude.exe', prefix: [] });
});

test('a reader that fails carries the reason it printed into the error, not an empty string', async () => {
    const { invokeReader } = await loadRunner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-fail-'));
    try {
        const fake = path.join(dir, 'failing-claude.mjs');
        fs.writeFileSync(fake, [
            "import fs from 'node:fs';",
            "fs.readFileSync(0, 'utf8');",
            "process.stdout.write(JSON.stringify({ is_error: true, result: 'Failed to authenticate: OAuth session expired' }));",
            'process.exit(1);'
        ].join('\n'), 'utf8');
        const result = invokeReader(fake, 'sonnet', 'anything', {});
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.error, 'reader exited 1: Failed to authenticate: OAuth session expired');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// Ctrl+C at the terminal reaches the reader, not this process: the pair loop is
// synchronous, so the runner's own signal handler cannot run until the last pair
// has been paid for. The interruption is therefore read off the child's
// termination, and the terminations that are not interruptions are the ones this
// runner produced itself: spawnSync kills the child and reports an error of its
// own for the timeout it was given (ETIMEDOUT) and for a reply past maxBuffer
// (ENOBUFS), and on this platform each of those comes back carrying SIGTERM. One
// oversized reply read as the caller's Ctrl+C would stop the whole paid run.
test('an interrupted reader is told apart from a timeout and from a reader that failed', async () => {
    const { isInterruptedTermination, WIN32_CONTROL_C_EXIT } = await loadRunner();
    assert.strictEqual(WIN32_CONTROL_C_EXIT, 3221225786, 'STATUS_CONTROL_C_EXIT, 0xC000013A');
    assert.strictEqual(isInterruptedTermination({ status: null, signal: 'SIGINT' }, 'linux'), true);
    assert.strictEqual(isInterruptedTermination({ status: null, signal: 'SIGKILL' }, 'win32'), true);
    assert.strictEqual(isInterruptedTermination(
        { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } }, 'linux'), false,
    'the timeout this runner sent is not the caller interrupting it');
    assert.strictEqual(isInterruptedTermination(
        { status: null, signal: 'SIGTERM', error: { code: 'ENOBUFS' } }, 'linux'), false,
    'the kill a reply past the reply cap earns is this runner\'s own, not the caller interrupting it');
    assert.strictEqual(isInterruptedTermination(
        { status: WIN32_CONTROL_C_EXIT, signal: 'SIGTERM', error: { code: 'ENOBUFS' } }, 'win32'), false,
    'a spawn error is this runner\'s own kill whatever status or signal rides with it');
    assert.strictEqual(isInterruptedTermination({ status: WIN32_CONTROL_C_EXIT, signal: null }, 'win32'), true);
    assert.strictEqual(isInterruptedTermination({ status: WIN32_CONTROL_C_EXIT, signal: null }, 'linux'), false,
        'the status is the interruption only where the platform has no signal to carry it');
    assert.strictEqual(isInterruptedTermination({ status: 1, signal: null }, 'win32'), false);
    assert.strictEqual(isInterruptedTermination({ status: 0, signal: null }, 'win32'), false);
    assert.strictEqual(isInterruptedTermination(undefined, 'win32'), false);
});

// The same reading taken off a real child rather than off a shaped object, by
// whichever way this platform ends an interrupted process: the control-C exit
// status on Windows, and the signal itself where the platform has signals and
// masks an exit code to eight bits.
test('a reader that ended the way an interrupted one does is reported as interrupted', async () => {
    const { invokeReader } = await loadRunner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-interrupt-'));
    try {
        const fake = path.join(dir, 'interrupted-claude.mjs');
        fs.writeFileSync(fake, [
            "import fs from 'node:fs';",
            "fs.readFileSync(0, 'utf8');",
            process.platform === 'win32'
                ? 'process.exit(3221225786);'
                : "process.kill(process.pid, 'SIGINT');\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);"
        ].join('\n'), 'utf8');
        const result = invokeReader(fake, 'sonnet', 'anything', {});
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.interrupted, true);
        assert.match(result.error, /the reader was interrupted/);
        // The control: an ordinary nonzero exit from the same shape of child is
        // a reader that failed, and the run carries on from those.
        const failing = path.join(dir, 'failing-claude.mjs');
        fs.writeFileSync(failing, [
            "import fs from 'node:fs';",
            "fs.readFileSync(0, 'utf8');",
            'process.exit(2);'
        ].join('\n'), 'utf8');
        const ordinary = invokeReader(failing, 'sonnet', 'anything', {});
        assert.strictEqual(ordinary.ok, false);
        assert.strictEqual(ordinary.interrupted, false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// What the SIGINT and SIGTERM handlers leave the process with. They remove the
// credential copy and then exit, and they cannot run until the synchronous pair
// loop has unwound, by which time the interrupted-reader path has already set
// 101 through the top-level catch: a handler exiting 130 regardless would
// replace the code the run reported with one of its own.
test('a signal handler carries out the exit code the run already chose', async () => {
    const { interruptExitCode, SIGNAL_EXIT_CODES } = await loadRunner();
    assert.deepStrictEqual(SIGNAL_EXIT_CODES, { SIGINT: 130, SIGTERM: 143 }, '128 plus the signal number');
    assert.strictEqual(interruptExitCode('SIGINT', 101), 101, 'the interrupted run reports 101, not 130');
    assert.strictEqual(interruptExitCode('SIGTERM', 3), 3, 'a finished run reports its mismatch count');
    // Nothing chosen yet: the signal is the whole story.
    assert.strictEqual(interruptExitCode('SIGINT', undefined), 130);
    assert.strictEqual(interruptExitCode('SIGTERM', undefined), 143);
    // A zero is not a choice worth carrying out of a killed process: a run that
    // was stopped reporting success reads as a run that finished.
    assert.strictEqual(interruptExitCode('SIGINT', 0), 130);
});

test('the reader credentials are copied into the scratch config directory and nothing else is', async () => {
    const { makeReaderScratch, removeReaderScratch, copyCredentials } = await loadRunner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-creds-'));
    try {
        const home = path.join(dir, 'home');
        const tmpRoot = path.join(dir, 'tmp');
        fs.mkdirSync(home);
        fs.mkdirSync(tmpRoot);
        fs.writeFileSync(path.join(home, '.credentials.json'), '{"token":"first"}');
        fs.writeFileSync(path.join(home, 'CLAUDE.md'), 'operator instructions');
        fs.mkdirSync(path.join(home, 'plugins'));
        const scratch = makeReaderScratch(home, tmpRoot);
        assert.deepStrictEqual(fs.readdirSync(scratch.configDir), ['.credentials.json']);
        // The working directory the reader is spawned in is empty, so no
        // CLAUDE.md above it is discovered, and neither it nor the credentials
        // sit inside the run directory the report points at.
        assert.deepStrictEqual(fs.readdirSync(scratch.cwd), []);
        assert.strictEqual(path.dirname(scratch.root), tmpRoot);
        fs.writeFileSync(path.join(home, '.credentials.json'), '{"token":"rotated"}');
        assert.strictEqual(copyCredentials(scratch.configDir, home), true);
        assert.strictEqual(fs.readFileSync(path.join(scratch.configDir, '.credentials.json'), 'utf8'), '{"token":"rotated"}');
        // The bytes land on a temp name and are renamed over the destination, so
        // the write never follows whatever the destination name has become. The
        // temp goes with the rename: what is left is the copy and nothing else.
        assert.deepStrictEqual(fs.readdirSync(scratch.configDir), ['.credentials.json']);
        removeReaderScratch(scratch.root);
        assert.strictEqual(fs.existsSync(scratch.root), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// A credential copy that fails silently makes every reader in the run fail to
// authenticate, and a run of ERROR rows reads like the corpus moving under
// every probe at once. The failure is the run's, so it stops the run.
test('a credentials copy that cannot read its source throws rather than leaving a run to fail pair by pair', async () => {
    const { copyCredentials, makeReaderScratch } = await loadRunner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-creds-fail-'));
    try {
        const home = path.join(dir, 'home');
        fs.mkdirSync(home);
        assert.throws(() => copyCredentials(dir, home), /could not be read/);
        assert.throws(() => makeReaderScratch(home, dir), /could not be read/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// The reader holds the same OAuth credential this process does, so a rotation
// the reader performs lands in the scratch copy and a refresh that copied the
// source over it unconditionally would put the stale token back. Newer wins,
// both ways.
test('a credential refresh keeps whichever of the source and the copy is newer', async () => {
    const { makeReaderScratch, copyCredentials } = await loadRunner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-newer-'));
    try {
        const home = path.join(dir, 'home');
        const tmpRoot = path.join(dir, 'tmp');
        fs.mkdirSync(home);
        fs.mkdirSync(tmpRoot);
        const source = path.join(home, '.credentials.json');
        fs.writeFileSync(source, '{"token":"first"}');
        const scratch = makeReaderScratch(home, tmpRoot);
        const copy = path.join(scratch.configDir, '.credentials.json');
        const at = (secondsAgo) => new Date(Date.now() - secondsAgo * 1000);

        // The source is newer: the ordinary rotation in ~/.claude, which copies.
        fs.writeFileSync(source, '{"token":"rotated-in-the-home-directory"}');
        fs.utimesSync(copy, at(120), at(120));
        fs.utimesSync(source, at(60), at(60));
        assert.strictEqual(copyCredentials(scratch.configDir, home, scratch.root), true);
        assert.strictEqual(fs.readFileSync(copy, 'utf8'), '{"token":"rotated-in-the-home-directory"}');

        // The copy is newer: the reader rotated the token and wrote it into the
        // scratch, and copying the source over it would hand every reader after
        // this one a token that is no longer live.
        fs.writeFileSync(copy, '{"token":"rotated-by-the-reader"}');
        fs.utimesSync(source, at(120), at(120));
        fs.utimesSync(copy, at(60), at(60));
        assert.strictEqual(copyCredentials(scratch.configDir, home, scratch.root), false);
        assert.strictEqual(fs.readFileSync(copy, 'utf8'), '{"token":"rotated-by-the-reader"}');
        // The scratch root is touched either way, so a refresh that wrote
        // nothing still keeps the directory out of the next run's sweep.
        assert.ok(fs.statSync(scratch.root).mtimeMs > Date.now() - 60000);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// The copy is compared by lstat and then read and written through the two names,
// so a link at either name is a file the run never meant to touch: at the source
// a link's own mtime never advances and newer-wins would hold the real file out
// of every refresh, and at the destination the write puts a live OAuth token
// wherever the link leads. Creating a link needs the privilege, so on a box that
// refuses it the case says so rather than passing quietly.
test('a link at either end of the credential copy refuses it by name', async (t) => {
    const { copyCredentials } = await loadRunner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-cred-link-'));
    try {
        const home = path.join(dir, 'home');
        const config = path.join(dir, 'config');
        const elsewhere = path.join(dir, 'elsewhere');
        fs.mkdirSync(home);
        fs.mkdirSync(config);
        fs.mkdirSync(elsewhere);
        fs.writeFileSync(path.join(elsewhere, 'real-credentials.json'), '{"token":"the real one"}');
        fs.writeFileSync(path.join(elsewhere, 'somebody-elses-file.json'), '{"token":"not ours to write"}');
        try {
            fs.symlinkSync(path.join(elsewhere, 'real-credentials.json'), path.join(home, '.credentials.json'), 'file');
        } catch (err) {
            t.skip('this box does not permit creating a symlink: ' + (err && err.code));
            return;
        }
        assert.throws(() => copyCredentials(config, home), /at .*\.credentials\.json are a link/);

        // The destination half, with a real file at the source so the refusal
        // can only be the link the scratch carries.
        const realHome = path.join(dir, 'real-home');
        fs.mkdirSync(realHome);
        fs.writeFileSync(path.join(realHome, '.credentials.json'), '{"token":"first"}');
        fs.symlinkSync(path.join(elsewhere, 'somebody-elses-file.json'), path.join(config, '.credentials.json'), 'file');
        assert.throws(() => copyCredentials(config, realHome), /copy at .*\.credentials\.json is a link/);
        assert.strictEqual(fs.readFileSync(path.join(elsewhere, 'somebody-elses-file.json'), 'utf8'),
            '{"token":"not ours to write"}', 'the file the link led to was never written');

        // The control: the same call with a real file at both ends copies.
        fs.unlinkSync(path.join(config, '.credentials.json'));
        assert.strictEqual(copyCredentials(config, realHome), true);
        assert.strictEqual(fs.readFileSync(path.join(config, '.credentials.json'), 'utf8'), '{"token":"first"}');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// The scratch holds a live credential, so a run killed at the terminal leaves
// one behind and the next run sweeps it. Only this runner's own prefix is
// touched, and only past the staleness window.
test('the stale sweep removes this runner\'s abandoned scratch and leaves everything else', async () => {
    const { sweepStaleReaderScratch, SCRATCH_PREFIX, STALE_SCRATCH_MS } = await loadRunner();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-sweep-'));
    try {
        const stale = path.join(tmpRoot, SCRATCH_PREFIX + 'stale');
        const fresh = path.join(tmpRoot, SCRATCH_PREFIX + 'fresh');
        const foreign = path.join(tmpRoot, 'someone-elses-directory');
        for (const dir of [stale, fresh, foreign]) fs.mkdirSync(dir);
        fs.writeFileSync(path.join(stale, '.credentials.json'), '{"token":"abandoned"}');
        const old = Date.now() - STALE_SCRATCH_MS - 60000;
        fs.utimesSync(stale, new Date(old), new Date(old));
        const swept = sweepStaleReaderScratch(Date.now(), tmpRoot);
        assert.deepStrictEqual(swept, [stale]);
        assert.strictEqual(fs.existsSync(stale), false);
        assert.strictEqual(fs.existsSync(fresh), true, 'a scratch inside the window is left alone');
        assert.strictEqual(fs.existsSync(foreign), true, 'a directory that is not this runner\'s is left alone');
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

// The sweep reads a directory's age from its mtime, and overwriting the
// credentials file in place changes the mtime of neither the root nor the
// config directory holding it. Without the touch, a run longer than the
// staleness window presents to the next run's sweep exactly as an abandoned
// directory does, and the sweep takes the credential out from under a live
// reader.
test('a refreshed credential copy keeps its scratch out of the next run\'s sweep', async () => {
    const { makeReaderScratch, copyCredentials, sweepStaleReaderScratch, STALE_SCRATCH_MS } = await loadRunner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-touch-'));
    try {
        const home = path.join(dir, 'home');
        const tmpRoot = path.join(dir, 'tmp');
        fs.mkdirSync(home);
        fs.mkdirSync(tmpRoot);
        fs.writeFileSync(path.join(home, '.credentials.json'), '{"token":"first"}');
        const scratch = makeReaderScratch(home, tmpRoot);
        // Age the whole scratch past the window, as a run that has been reading
        // for longer than the window would be.
        const old = Date.now() - STALE_SCRATCH_MS - 60000;
        for (const target of [scratch.configDir, scratch.root]) fs.utimesSync(target, new Date(old), new Date(old));
        assert.ok(fs.statSync(scratch.root).mtimeMs < Date.now() - STALE_SCRATCH_MS, 'the scratch reads as stale');
        // The control: with no refresh, the sweep takes it.
        assert.deepStrictEqual(sweepStaleReaderScratch(Date.now(), tmpRoot), [scratch.root]);
        assert.strictEqual(fs.existsSync(scratch.root), false);

        const live = makeReaderScratch(home, tmpRoot);
        for (const target of [live.configDir, live.root]) fs.utimesSync(target, new Date(old), new Date(old));
        copyCredentials(live.configDir, home, live.root);
        assert.ok(fs.statSync(live.root).mtimeMs > Date.now() - STALE_SCRATCH_MS, 'the refresh advanced the root');
        assert.deepStrictEqual(sweepStaleReaderScratch(Date.now(), tmpRoot), [], 'a refreshed scratch survives the sweep');
        assert.strictEqual(fs.existsSync(live.root), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// The scratch holds a live credential, so every way out of the process removes
// it: the two signals, and the exit itself, which is the one a throw the run
// does not catch and an ordinary return both come out of.
test('a scratch goes with the process that made it, even when the process just exits', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-exit-'));
    try {
        const home = path.join(dir, 'home');
        const tmpRoot = path.join(dir, 'tmp');
        fs.mkdirSync(home);
        fs.mkdirSync(tmpRoot);
        fs.writeFileSync(path.join(home, '.credentials.json'), '{"token":"first"}');
        const script = path.join(dir, 'exit-without-cleanup.mjs');
        fs.writeFileSync(script, [
            "import fs from 'node:fs';",
            "import { makeReaderScratch } from " + JSON.stringify(pathToFileURL(RUNNER).href) + ';',
            'const scratch = makeReaderScratch(' + JSON.stringify(home) + ', ' + JSON.stringify(tmpRoot) + ');',
            'fs.writeFileSync(process.argv[2], scratch.root, "utf8");',
            'process.exit(0);'
        ].join('\n'), 'utf8');
        const marker = path.join(dir, 'scratch-root.txt');
        const res = spawnSync(process.execPath, [script, marker], { encoding: 'utf8' });
        assert.strictEqual(res.status, 0, res.stderr);
        const root = fs.readFileSync(marker, 'utf8').trim();
        assert.ok(root.length > 0 && root.startsWith(tmpRoot), 'the child made its scratch under the fixture temp root');
        assert.strictEqual(fs.existsSync(root), false, 'the credential copy did not outlive the process');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// A removal that failed leaves the scratch in the live set, so the exit handler
// tries again on the way out of the process. Dropping it from the set on the way
// into the removal would make the one case the retry exists for the one case
// nothing retries, which is the case that leaves a live credential on disk. The
// child holds its own scratch root as its working directory, which no platform
// will delete out from under a running process, and steps out of it before it
// exits so the retry has something it can do.
test('a scratch whose removal failed is removed again when the process exits', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-retry-'));
    try {
        const home = path.join(dir, 'home');
        const tmpRoot = path.join(dir, 'tmp');
        fs.mkdirSync(home);
        fs.mkdirSync(tmpRoot);
        fs.writeFileSync(path.join(home, '.credentials.json'), '{"token":"first"}');
        const script = path.join(dir, 'held-open.mjs');
        fs.writeFileSync(script, [
            "import fs from 'node:fs';",
            "import os from 'node:os';",
            'import { makeReaderScratch, removeReaderScratch } from ' + JSON.stringify(pathToFileURL(RUNNER).href) + ';',
            'const scratch = makeReaderScratch(' + JSON.stringify(home) + ', ' + JSON.stringify(tmpRoot) + ');',
            'process.chdir(scratch.root);',
            'const removed = removeReaderScratch(scratch.root);',
            'const stillThere = fs.existsSync(scratch.root);',
            'const copyGone = !fs.existsSync(scratch.configDir);',
            'process.chdir(os.tmpdir());',
            'fs.writeFileSync(process.argv[2], [scratch.root, removed, stillThere, copyGone].join(String.fromCharCode(10)), "utf8");'
        ].join('\n'), 'utf8');
        const marker = path.join(dir, 'scratch-root.txt');
        const res = spawnSync(process.execPath, [script, marker], { encoding: 'utf8' });
        assert.strictEqual(res.status, 0, res.stderr);
        const [root, removed, stillThere, copyGone] = fs.readFileSync(marker, 'utf8').split('\n');
        assert.ok(root.startsWith(tmpRoot), 'the child made its scratch under the fixture temp root');
        if (removed === 'true') {
            // A platform that deletes a directory a live process is sitting in
            // cannot produce the failure this case is about, and the retry has
            // nothing to do there.
            t.skip('this platform removed the scratch its own process was sitting in, so the failed removal this case '
                + 'rests on is not producible here');
            return;
        }
        assert.strictEqual(stillThere, 'true', 'the first removal left the scratch where it was');
        assert.strictEqual(copyGone, 'true', 'and took the credential copy out of it on its own');
        assert.strictEqual(fs.existsSync(root), false, 'the exit handler removed what the first attempt could not');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// --- the OS account name in what this runner prints ----------------------

// The fixture account name for the two cases below, chosen the way
// test/kit-output-channel.test.js chooses its own: a string that appears in no
// temp directory's own path on any box this suite runs on. The operator's real
// account name sits inside os.tmpdir() on win32, so a case asserting "the
// account name is absent from this line" against a common name would read the
// machine's own path and fail for a reason that is not the runner's.
const RUNNER_ACCOUNT = 'zephyrina';

// A fixture home directory whose LEAF is that account name, with the scratch
// root inside it, so the line under test carries a path the elision has to
// reach. The child gets the home directory under both spellings, since
// os.homedir() reads USERPROFILE on win32 and HOME everywhere else.
function accountHome(dir) {
    const home = path.join(dir, RUNNER_ACCOUNT);
    fs.mkdirSync(home);
    fs.mkdirSync(path.join(home, 'src'));
    fs.writeFileSync(path.join(home, 'src', '.credentials.json'), '{"token":"first"}');
    return home;
}

// The failed-removal warning is the runner's loudest line: it says a live
// credential copy is still on disk. It names the scratch directory, which is
// under the OS temp directory, itself under the home directory on an ordinary
// Windows box, and this runner's stderr is read by a model that was told to run
// it. The child holds its own scratch as its working directory, which is what
// makes the removal fail, the same fixture the retry case above uses.
test('the failed-removal warning carries no OS account name', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-elide-'));
    try {
        const home = accountHome(dir);
        const tmpRoot = path.join(home, 'tmp');
        fs.mkdirSync(tmpRoot);
        const script = path.join(dir, 'held-open-elide.mjs');
        fs.writeFileSync(script, [
            "import os from 'node:os';",
            'import { makeReaderScratch, removeReaderScratch } from '
                + JSON.stringify(pathToFileURL(RUNNER).href) + ';',
            'const scratch = makeReaderScratch(' + JSON.stringify(path.join(home, 'src'))
                + ', ' + JSON.stringify(tmpRoot) + ');',
            'process.chdir(scratch.root);',
            'const removed = removeReaderScratch(scratch.root);',
            'process.chdir(os.tmpdir());',
            'process.stdout.write(String(removed));'
        ].join('\n'), 'utf8');
        const res = spawnSync(process.execPath, [script], {
            encoding: 'utf8',
            env: { ...process.env, HOME: home, USERPROFILE: home }
        });
        assert.strictEqual(res.status, 0, res.stderr);
        if (res.stdout === 'true') {
            t.skip('this platform removed the scratch its own process was sitting in, so the failed '
                + 'removal this case rests on is not producible here');
            return;
        }
        assert.match(res.stderr, /the reader scratch/,
            'test setup: the warning under test is the one this fixture stages: ' + res.stderr);
        assert.ok(!new RegExp(RUNNER_ACCOUNT, 'i').test(res.stderr),
            'the OS account name must not reach a channel a model reads: ' + res.stderr);
        assert.ok(res.stderr.includes('~'),
            'and the home directory is elided to the operator\'s own shorthand rather than the '
            + 'line being dropped: ' + res.stderr);
        assert.match(res.stderr, /CREDENTIAL COPY IS STILL THERE|credential copy in it are gone/,
            'while the warning itself, which is what says a live credential is on disk, stands: '
            + res.stderr);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// And the other direction of that binding: a tree whose plugin directory does
// not carry the renderer has nothing to load, which is the state this suite's
// own harness was in before it copied the library. The lines still print,
// because the loudest of them names a live credential copy still on disk. What
// says the elision is off is one note on stderr at the moment the binding
// failed, not a clause on every line: the note is about this run rather than
// about any one line, and a copy of it per line would be the only thing a long
// report is made of.
//
// A tree carrying no renderer and a renderer that will not load are two states,
// so the note names which one it met.
function stageRendererlessTree(libSource) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-nolib-'));
    const runner = path.join(dir, 'tools', 'probe-corpus', 'run.mjs');
    fs.mkdirSync(path.dirname(runner), { recursive: true });
    fs.mkdirSync(path.join(dir, 'plugins', 'claude-kit', 'hooks'), { recursive: true });
    fs.copyFileSync(RUNNER, runner);
    fs.copyFileSync(path.join(__dirname, '..', 'tools', 'probe-corpus', 'probe-file.mjs'),
        path.join(path.dirname(runner), 'probe-file.mjs'));
    // Everything the runner and the parser load, except the renderer.
    for (const lib of ['kit-read-lib.js', 'kit-goal-lib.js']) {
        fs.copyFileSync(path.join(HOOKS, lib),
            path.join(dir, 'plugins', 'claude-kit', 'hooks', lib));
    }
    if (libSource !== null) {
        fs.writeFileSync(path.join(dir, 'plugins', 'claude-kit', 'hooks', 'kit-compact-lib.js'),
            libSource, 'utf8');
    }
    // Two lines through the binding, because the note is said once per run and
    // one call cannot tell that from once per line.
    const script = path.join(dir, 'no-lib.mjs');
    fs.writeFileSync(script, [
        'import { elided } from ' + JSON.stringify(pathToFileURL(runner).href) + ';',
        "process.stdout.write(elided('a line naming ' + process.argv[2]) + '\\n');",
        "process.stdout.write(elided('a second line naming ' + process.argv[2]) + '\\n');"
    ].join('\n'), 'utf8');
    return { dir, script };
}

test('with no renderer in the tree, the runner says so once and leaves the lines alone', async () => {
    const { dir, script } = stageRendererlessTree(null);
    try {
        const res = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.strictEqual(res.stdout, 'a line naming ' + dir + '\n'
            + 'a second line naming ' + dir + '\n',
            'the lines themselves are neither withheld nor annotated, since the loudest of them '
            + 'names a live credential copy still on disk: ' + res.stdout);
        assert.strictEqual(res.stderr.split('\n').filter((l) => l.includes('unelided')).length, 1,
            'and the note that says the elision did not run is said once for the run: '
            + res.stderr);
        assert.match(res.stderr, /is not in this tree/,
            'naming the state it met, which here is a tree that carries no renderer at all: '
            + res.stderr);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a renderer that will not load is named as that, not as a missing one', async () => {
    // The other state: the file is where it belongs and throws on load, which
    // sends an operator to a repair rather than to an install.
    const { dir, script } = stageRendererlessTree(
        "throw Object.assign(new Error('fixture refusal'), { code: 'ERR_FIXTURE_REFUSED' });\n");
    try {
        const res = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.ok(res.stdout.startsWith('a line naming ' + dir),
            'the lines still print: ' + res.stdout);
        assert.match(res.stderr, /would not load \(ERR_FIXTURE_REFUSED\)/,
            'and the note names the failure\'s kind by its code, an identifier that can carry no '
            + 'path, while the message itself stays out of a channel with no renderer to elide '
            + 'it: ' + res.stderr);
        assert.ok(!res.stderr.includes('fixture refusal'),
            'the error text itself is not printed: ' + res.stderr);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// The runner sits inside the repository it reads, and a bare name is resolved by
// the platform at each spawn against a search order this file does not own. The
// binary is resolved once, to a file, exactly as the reader binary is.
test('git is resolved to an absolute file before a ref is read', async () => {
    const { resolveGitBinary } = await loadRunner();
    const bin = resolveGitBinary(process.env);
    assert.ok(path.isAbsolute(bin), 'git resolved to an absolute path: ' + bin);
    assert.ok(fs.statSync(bin).isFile(), 'and to a file that exists');
    assert.strictEqual(resolveGitBinary(process.env), bin, 'the resolution is made once and reused');
});

// ------------------------------------------------------------ reply parsing

test('parseReply reads the three contract lines out of a reply tail', async () => {
    const { parseReply } = await loadRunner();
    const parsed = parseReply([
        'Some reasoning about the passages.',
        '',
        'VERDICT: RESOLVED',
        'ANSWER: commit-and-push',
        'CITES: skills/executing-work/SKILL.md: the section closes with a push',
        'CITES: home/CLAUDE.md: commit and push are the default'
    ].join('\n'));
    assert.strictEqual(parsed.verdict, 'RESOLVED');
    assert.strictEqual(parsed.answer, 'commit-and-push');
    assert.strictEqual(parsed.unparsed, false);
    assert.deepStrictEqual(parsed.cites[0], { path: 'skills/executing-work/SKILL.md', passage: 'the section closes with a push' });
    assert.strictEqual(parsed.cites.length, 2);
});

test('parseReply takes the last verdict when a reader restates the instruction', async () => {
    const { parseReply } = await loadRunner();
    const parsed = parseReply('VERDICT: SILENT is what I would write if nothing reached it\nVERDICT: CONTESTED\nANSWER: OTHER: the documents name no owner');
    assert.strictEqual(parsed.verdict, 'CONTESTED');
    assert.strictEqual(parsed.answer, 'OTHER: the documents name no owner');
});

// The answer belongs to the verdict it was written under. A reader that
// rehearses a reading and then settles on another writes both blocks, and
// pairing the closing verdict with an answer from the rehearsal above it records
// a reading neither block gave.
test('the answer is the last one after the last verdict, not the last one anywhere', async () => {
    const { parseReply } = await loadRunner();
    const parsed = parseReply([
        'First pass, which I then reconsidered:',
        'VERDICT: RESOLVED',
        'ANSWER: commit-and-push',
        'On reflection the passages fork:',
        'VERDICT: CONTESTED',
        'ANSWER: unowned-declare-a-reading-and-report-the-gap',
        'CITES: a.md: the two passages direct different actions'
    ].join('\n'));
    assert.strictEqual(parsed.verdict, 'CONTESTED');
    assert.strictEqual(parsed.answer, 'unowned-declare-a-reading-and-report-the-gap');
    // A closing verdict with no answer under it is an answer the reply never
    // gave, rather than the one from the block above.
    const dangling = parseReply('VERDICT: RESOLVED\nANSWER: commit-and-push\nVERDICT: SILENT');
    assert.strictEqual(dangling.verdict, 'SILENT');
    assert.strictEqual(dangling.answer, null);
});

// The boundary the rule above draws, stated as its own contract: an ANSWER line
// is the reading only when it sits after the last VERDICT line. A reply that
// answers first and rules afterwards has no answer under its verdict, and the
// pair is a mismatch rather than a reading assembled from two blocks. The
// template asks for the two lines in that order, so this is the shape a reply
// that departs from the template is read as.
test('an ANSWER written above the last VERDICT is not the reading', async () => {
    const { parseReply, diffReading } = await loadRunner();
    const answerFirst = parseReply([
        'ANSWER: commit-and-push',
        'VERDICT: RESOLVED',
        'CITES: a.md: commit and push are the default'
    ].join('\n'));
    assert.strictEqual(answerFirst.verdict, 'RESOLVED');
    assert.strictEqual(answerFirst.answer, null, 'the answer above the verdict is not carried down to it');
    assert.strictEqual(answerFirst.unparsed, false, 'the verdict line was read');
    assert.strictEqual(diffReading(probe(), answerFirst).status, 'mismatch');
    assert.strictEqual(answerFirst.cites.length, 1, 'the citations are read wherever they sit');
    // The control: the same two lines in the template's own order are a match.
    const inOrder = parseReply('VERDICT: RESOLVED\nANSWER: commit-and-push');
    assert.strictEqual(diffReading(probe(), inOrder).status, 'match');
});

// A CONTESTED reader whose reading is that no surface owns the moment picks the
// value in the closed list that says so, where the list offers one. The template
// asks for that, and the diff has to accept it as the ruled answer it is.
test('a contested reading of an unowned moment matches the list\'s own no-owner value', async () => {
    const { parseReply, diffReading } = await loadRunner();
    const unowned = probe({
        verdict: 'CONTESTED',
        answer: 'unowned-declare-a-reading-and-report-the-gap',
        options: ['branch-and-pr', 'unowned-declare-a-reading-and-report-the-gap']
    });
    const named = parseReply('VERDICT: CONTESTED\nANSWER: unowned-declare-a-reading-and-report-the-gap');
    assert.strictEqual(diffReading(unowned, named).status, 'match');
    const other = parseReply('VERDICT: CONTESTED\nANSWER: OTHER: the set names no owner');
    assert.strictEqual(diffReading(unowned, other).status, 'mismatch',
        'OTHER is a different answer from the value the list offers');
});

test('parseReply reads a bulleted and bolded tail', async () => {
    const { parseReply } = await loadRunner();
    const parsed = parseReply('- **VERDICT:** SILENT\n- **ANSWER:** do-nothing\n- CITES: a.md: nothing reaches the moment');
    assert.strictEqual(parsed.verdict, 'SILENT');
    assert.strictEqual(parsed.answer, 'do-nothing');
});

// A reader writes the value it was given back in the presentation it prefers,
// and a backticked or quoted answer is the same answer.
test('an answer wrapped in backticks or quotes reads as the value the closed list spells', async () => {
    const { parseReply, diffReading } = await loadRunner();
    const backticked = parseReply('VERDICT: RESOLVED\nANSWER: `commit-and-push`');
    assert.strictEqual(backticked.answer, 'commit-and-push');
    assert.strictEqual(diffReading(probe(), backticked).status, 'match');
    assert.strictEqual(parseReply('VERDICT: SILENT\nANSWER: "do-nothing"').answer, 'do-nothing');
    assert.strictEqual(parseReply("VERDICT: SILENT\nANSWER: 'do-nothing'").answer, 'do-nothing');
    assert.strictEqual(parseReply('VERDICT: CONTESTED\nANSWER: OTHER: the set names no owner').answer,
        'OTHER: the set names no owner', 'a value with no wrapping is untouched');
});

// Wrapping is the whole of what unwrapping removes. Trailing punctuation stays,
// so an answer written as a sentence is the mismatch it is: the option list is a
// closed set of tokens the template asks for verbatim, and an instrument that
// quietly accepted prose would stop distinguishing the reading the contract
// exists to distinguish.
test('trailing punctuation on an answer is a mismatch rather than something to strip', async () => {
    const { parseReply, diffReading, normaliseAnswer } = await loadRunner();
    assert.strictEqual(normaliseAnswer('send-without-asking.'), 'send-without-asking.');
    const withStop = parseReply('VERDICT: RESOLVED\nANSWER: commit-and-push.');
    assert.strictEqual(withStop.answer, 'commit-and-push.');
    assert.strictEqual(diffReading(probe(), withStop).status, 'mismatch');
    // The control: the same reply without the stop is the match, so the
    // mismatch above is the punctuation and nothing else.
    assert.strictEqual(diffReading(probe(), parseReply('VERDICT: RESOLVED\nANSWER: commit-and-push')).status, 'match');
    // And the wrapping around a punctuated answer still comes off, leaving the
    // punctuation where it was.
    assert.strictEqual(normaliseAnswer('`commit-and-push.`'), 'commit-and-push.');
});

test('a reply with no verdict line is unparsed', async () => {
    const { parseReply, diffReading } = await loadRunner();
    const parsed = parseReply('I think the documents probably mean the section should be pushed.');
    assert.strictEqual(parsed.unparsed, true);
    assert.strictEqual(diffReading(probe(), parsed).status, 'UNPARSED');
});

// -------------------------------------------------------------- the diff

test('a match needs the verdict token and the answer both, case and space aside', async () => {
    const { diffReading } = await loadRunner();
    const p = probe();
    assert.strictEqual(diffReading(p, { verdict: 'RESOLVED', answer: '  Commit-And-Push ', cites: [], unparsed: false }).status, 'match');
    assert.strictEqual(diffReading(p, { verdict: 'CONTESTED', answer: 'commit-and-push', cites: [], unparsed: false }).status, 'mismatch');
    assert.strictEqual(diffReading(p, { verdict: 'RESOLVED', answer: 'ask-first', cites: [], unparsed: false }).status, 'mismatch');
    assert.strictEqual(diffReading(p, { verdict: 'RESOLVED', answer: null, cites: [], unparsed: false }).status, 'mismatch');
});

// A mismatch is a reading that disagreed with the ruling; an ERROR is the
// absence of a reading. Counting them together made an expired token read as
// the whole corpus moving at once, so the two counts are separate and only the
// mismatches reach the exit code.
test('the exit code is the mismatch count, capped, errors are counted apart, and a dry run exits zero', async () => {
    const { countMismatches, countErrors, exitCodeFor, MAX_EXIT } = await loadRunner();
    const ruled = { state: 'ruled', date: '2026-09-06' };
    const pairs = [
        { status: 'match', ruling: ruled }, { status: 'mismatch', ruling: ruled },
        { status: 'UNPARSED', ruling: ruled }, { status: 'ERROR', ruling: ruled }, { status: 'dry-run', ruling: ruled }
    ];
    assert.strictEqual(countMismatches(pairs), 2);
    assert.strictEqual(countErrors(pairs), 1);
    assert.strictEqual(exitCodeFor(pairs), 2);
    assert.strictEqual(exitCodeFor([{ status: 'ERROR', ruling: ruled }, { status: 'ERROR', ruling: ruled }]), 0,
        'errors never enter the exit code');
    assert.strictEqual(exitCodeFor(new Array(250).fill({ status: 'mismatch', ruling: ruled })), MAX_EXIT);
    assert.strictEqual(exitCodeFor([{ status: 'dry-run', ruling: ruled }, { status: 'dry-run', ruling: ruled }]), 0);
});

// A probe whose ruling the operator has not settled carries a proposal, so a
// reader disagreeing with it is a reading to look at rather than a gate reading:
// it is counted on its own and never reaches the exit code.
test('a mismatch on a proposed ruling is counted apart and never reaches the exit code', async () => {
    const { countMismatches, countProposedMismatches, exitCodeFor, COUNTED_RULING_STATE } = await loadRunner();
    const pairs = [
        { status: 'mismatch', ruling: { state: 'ruled', date: '2026-09-06' } },
        { status: 'mismatch', ruling: { state: 'proposed', date: '2026-09-06' } },
        { status: 'UNPARSED', ruling: { state: 'proposed', date: '2026-09-06' } },
        { status: 'match', ruling: { state: 'proposed', date: '2026-09-06' } },
        { status: 'mismatch', ruling: null }
    ];
    assert.strictEqual(COUNTED_RULING_STATE, 'ruled');
    assert.strictEqual(countMismatches(pairs), 1);
    assert.strictEqual(countProposedMismatches(pairs), 3, 'an unknown ruling state counts as unruled, not as ruled');
    assert.strictEqual(exitCodeFor(pairs), 1);
});

// A shape marked `designed-mismatch` is built to expose a narrow context's own
// defect, and a probe's answer is one answer across all of its shapes, so the
// disagreement there is the reading the shape exists to take. Counting it would
// redden a ruled probe's exit code on every run forever. The agreement is the
// finding instead, so it is counted like any other mismatch.
test('a designed disagreement is counted apart and its agreement is counted as a mismatch', async () => {
    const { designedStatus, countMismatches, countProposedMismatches, countDesigned, countDesignedAgreed, exitCodeFor } = await loadRunner();
    assert.strictEqual(designedStatus('mismatch', 'output-style-copy-lacks-the-exception'), 'designed');
    assert.strictEqual(designedStatus('match', 'output-style-copy-lacks-the-exception'), 'designed-agreed');
    // A reply with no verdict line is the absence of a reading rather than a
    // reading that disagreed, so the marker does not absorb it.
    assert.strictEqual(designedStatus('UNPARSED', 'output-style-copy-lacks-the-exception'), 'UNPARSED');
    assert.strictEqual(designedStatus('ERROR', 'output-style-copy-lacks-the-exception'), 'ERROR');
    // The control: an unmarked shape's statuses pass through untouched.
    for (const status of ['match', 'mismatch', 'UNPARSED', 'ERROR', 'dry-run']) {
        assert.strictEqual(designedStatus(status, null), status);
    }

    const ruled = { state: 'ruled', date: '2026-09-06' };
    const proposed = { state: 'proposed', date: '2026-09-06' };
    const pairs = [
        { status: 'designed', ruling: ruled },
        { status: 'designed', ruling: proposed },
        { status: 'designed-agreed', ruling: ruled },
        { status: 'designed-agreed', ruling: proposed },
        { status: 'UNPARSED', ruling: ruled }
    ];
    assert.strictEqual(countDesigned(pairs), 2);
    assert.strictEqual(countDesignedAgreed(pairs), 2, 'the finding rides in the report as a count of its own');
    assert.strictEqual(countMismatches(pairs), 2, 'the ruled designed-agreed pair and the ruled UNPARSED one');
    assert.strictEqual(countProposedMismatches(pairs), 1, 'the proposed designed-agreed pair');
    assert.strictEqual(exitCodeFor(pairs), 2);
});

// ------------------------------------------------------- prompt composition

test('the prompt carries the scenario, the file list, the options and the documents, and no template comment', async () => {
    const { composePrompt } = await loadRunner();
    const template = fs.readFileSync(TEMPLATE, 'utf8');
    const prompt = composePrompt(template, probe(), [
        { path: 'corpus/a.md', text: 'the alpha passage', absent: false },
        { path: 'home/CLAUDE.md', text: 'the home passage', absent: false }
    ]);
    assert.ok(prompt.includes('A section is green'), 'scenario is substituted');
    assert.ok(prompt.includes('corpus/a.md, home/CLAUDE.md'), 'the file list is substituted');
    assert.ok(prompt.includes('- commit-and-push'), 'the closed option list is substituted');
    assert.ok(prompt.includes('===== FILE: corpus/a.md =====\nthe alpha passage'), 'each document is headed by its path');
    assert.ok(!prompt.includes('<!--'), 'the template header comment is stripped');
    assert.ok(!prompt.includes('{{'), 'no placeholder is left behind');
});

// The no-intent-story bar, pinned structurally rather than against a literal
// the composer happens to write today: the ruling's own fields carry sentinels,
// and neither may appear anywhere in the prompt. The control is the second
// half, where the same sentinels are put in the option list, which the reader
// is meant to see: it speaks, so the silence in the first half is coverage
// rather than a predicate that cannot match.
test('nothing derived from the ruling reaches the reader', async () => {
    const { composePrompt } = await loadRunner();
    const template = fs.readFileSync(TEMPLATE, 'utf8');
    const files = [{ path: 'corpus/a.md', text: 'the alpha passage', absent: false }];
    const ruled = composePrompt(template, probe({ verdict: 'ZZVERDICTSENTINEL', answer: 'zz-answer-sentinel' }), files);
    assert.ok(!ruled.includes('ZZVERDICTSENTINEL'), 'the ruled verdict is absent from the prompt');
    assert.ok(!ruled.includes('zz-answer-sentinel'), 'the ruled answer is absent from the prompt');
    const leaked = composePrompt(template, probe({ options: ['ZZVERDICTSENTINEL', 'zz-answer-sentinel'] }), files);
    assert.ok(leaked.includes('ZZVERDICTSENTINEL') && leaked.includes('zz-answer-sentinel'),
        'the same predicate finds those strings when the prompt does carry them');
});

// String.replace reads `$&`, `$'`, '$`' and `$$` in a string replacement as
// substitution patterns. The corpus under test is prose about shell and git
// syntax and carries all four, so a string replacement hands the reader a
// document with a passage of itself spliced into it.
test('a document carrying dollar substitution patterns reaches the reader verbatim', async () => {
    const { composePrompt } = await loadRunner();
    const template = fs.readFileSync(TEMPLATE, 'utf8');
    const body = "read $? after a probe, never $& or $' or the $` form, and $$ is the pid";
    const scenario = "The session wrote `echo $? > run.exit` and the log holds $& already.";
    const prompt = composePrompt(template, probe({ scenario, options: ["quote-$'-safely", 'do-nothing'] }), [
        { path: 'corpus/a.md', text: body, absent: false }
    ]);
    assert.ok(prompt.includes(body), 'the document reaches the reader byte for byte');
    assert.ok(prompt.includes(scenario), 'the scenario reaches the reader byte for byte');
    assert.ok(prompt.includes("- quote-$'-safely"), 'an option carrying a pattern survives too');
    // A `$'` read as a pattern splices the text following the match back in,
    // and `$&` splices the placeholder itself, so the prompt's own landmarks
    // would appear twice.
    const situations = prompt.split('===== SITUATION =====').length - 1;
    assert.strictEqual(situations, 1, 'no section of the template was spliced in twice');
    assert.ok(!prompt.includes('{{'), 'no placeholder was written back into the prompt');
});

// The template is filled in one pass. Filling it placeholder by placeholder
// walks each substituted value again, so a scenario or a document carrying a
// placeholder literal has its own text substituted in place of the template's.
test('a document carrying a placeholder literal is not substituted in place of the template', async () => {
    const { composePrompt } = await loadRunner();
    const template = fs.readFileSync(TEMPLATE, 'utf8');
    const body = 'The runner fills {{DOCUMENTS}} and {{OPTIONS}} from the shape.';
    const prompt = composePrompt(template, probe({ scenario: 'A file quotes {{FILE_LIST}} in its prose.' }), [
        { path: 'corpus/a.md', text: body, absent: false }
    ]);
    assert.ok(prompt.includes(body), 'the document reaches the reader with its placeholder literals intact');
    assert.ok(prompt.includes('A file quotes {{FILE_LIST}} in its prose.'));
    assert.strictEqual(prompt.split('- commit-and-push').length - 1, 1, 'the option list was written exactly once');
    assert.strictEqual(prompt.split('===== FILE: corpus/a.md =====').length - 1, 1, 'the document was written exactly once');
});

test('an absent file is handed to the reader as an absence rather than as empty content', async () => {
    const { composePrompt } = await loadRunner();
    const prompt = composePrompt(fs.readFileSync(TEMPLATE, 'utf8'), probe(), [
        { path: 'corpus/gone.md', text: '', absent: true }
    ]);
    assert.ok(prompt.includes('===== FILE: corpus/gone.md (this file does not exist in the set) ====='));
});

// ---------------------------------------------------------- report shaping

test('the report names each pair, its ruling, what was read and where the reply is', async () => {
    const { renderReportMarkdown } = await loadRunner();
    const md = renderReportMarkdown({
        stamp: '2026-09-06T22-00-00-000Z',
        before: 'abc123',
        beforeCommit: 'abc123def',
        dryRun: false,
        claudeBin: 'claude',
        isolation: 'tools disabled',
        mismatches: 1,
        proposedMismatches: 0,
        designed: 0,
        errors: 0,
        exitCode: 1,
        pairs: [{
            moment: 'm', shape: 'full', tier: 'sonnet',
            ruling: { state: 'ruled', date: '2026-09-06' },
            expected: { verdict: 'RESOLVED', answer: 'commit-and-push' },
            observed: { verdict: 'CONTESTED', answer: 'OTHER: nobody' },
            status: 'mismatch',
            files: [
                { path: 'corpus/a.md', source: 'ref', absent: false },
                { path: 'corpus/gone.md', source: 'ref', absent: true },
                { path: 'home/CLAUDE.md', source: 'live', absent: true }
            ],
            cites: [{ path: 'corpus/a.md', passage: 'the alpha passage' }],
            promptPath: '/run/prompt.txt', rawReplyPath: '/run/reply.txt',
            costUsd: 0.0123, durationMs: 4500, error: null
        }]
    });
    assert.ok(md.includes('git ref abc123 (abc123def)'));
    assert.ok(md.includes('RESOLVED / commit-and-push | CONTESTED / OTHER: nobody | mismatch | $0.0123 | 4.5'));
    assert.ok(md.includes('corpus/gone.md (absent at abc123)'));
    // A home file is read live in both modes, so an absent one is absent from
    // the home directory now rather than at the ref the rest was read from.
    assert.ok(md.includes('home/CLAUDE.md (absent in the home directory)'));
    assert.ok(md.includes('/run/reply.txt'));
    assert.ok(md.includes('corpus/a.md: the alpha passage'));
    assert.ok(md.includes('ruled 2026-09-06'), 'the row carries the ruling state the exit code answers to');
});

// A reader's answer is its own words, and a pipe in one shifts every column
// after it in a markdown table.
test('a pipe in a cell is escaped rather than opening a column', async () => {
    const { renderReportMarkdown } = await loadRunner();
    const md = renderReportMarkdown({
        stamp: 's', before: null, beforeCommit: null, dryRun: false, claudeBin: 'claude',
        isolation: 'tools disabled', mismatches: 1, proposedMismatches: 0, designed: 0, errors: 1, exitCode: 1,
        pairs: [{
            moment: 'm', shape: 'full', tier: 'sonnet',
            ruling: { state: 'ruled', date: '2026-09-06' },
            expected: { verdict: 'RESOLVED', answer: 'commit-and-push' },
            observed: { verdict: 'CONTESTED', answer: 'OTHER: git show | head is the reading' },
            status: 'mismatch', files: [{ path: 'a.md', source: 'worktree', absent: false }],
            cites: [], promptPath: '/p', rawReplyPath: null, costUsd: null, durationMs: null, error: null
        }]
    });
    const row = md.split('\n').find((l) => l.startsWith('| m |'));
    assert.strictEqual(row.split(' | ').length, 9, 'the row still holds nine columns');
    assert.ok(row.includes('git show \\| head'));
    assert.ok(md.includes('- Pairs: 1, mismatches: 1 (0 on proposed rulings, 0 designed, 0 designed-agreed), errors: 1, exit code: 1'));
    assert.ok(md.includes('- WARNING: 1 pair produced no reading at all.'));
});

// The two readings the exit code says nothing about each carry their own
// warning, so a report that exits zero cannot be read as a clean corpus without
// meeting them.
test('a proposed-ruling mismatch and a failed credential refresh each warn in the report', async () => {
    const { renderReportMarkdown } = await loadRunner();
    const md = renderReportMarkdown({
        stamp: 's', before: null, beforeCommit: null, dryRun: false, claudeBin: 'claude',
        isolation: 'tools disabled', mismatches: 0, proposedMismatches: 1, designed: 0, errors: 0, exitCode: 0,
        pairs: [{
            moment: 'm', shape: 'full', tier: 'sonnet',
            ruling: { state: 'proposed', date: '2026-09-06' },
            expected: { verdict: 'RESOLVED', answer: 'commit-and-push' },
            observed: { verdict: 'CONTESTED', answer: 'ask-first' },
            status: 'mismatch', files: [{ path: 'a.md', source: 'worktree', absent: false }],
            cites: [], promptPath: '/p', rawReplyPath: null, costUsd: null, durationMs: null, error: null,
            credentialRefreshError: 'the reader credentials at /home/.credentials.json could not be read (EBUSY): this pair read against the copy already in the scratch'
        }]
    });
    assert.ok(md.includes('- Pairs: 1, mismatches: 0 (1 on proposed rulings, 0 designed, 0 designed-agreed), errors: 0, exit code: 0'));
    assert.ok(md.includes('- WARNING: 1 pair disagreed with a ruling the operator has not settled.'));
    assert.ok(md.includes('- WARNING: the credential copy could not be refreshed before 1 pair'));
    assert.ok(md.includes('- Credential refresh: the reader credentials at /home/.credentials.json could not be read (EBUSY)'));
});

// The counts on the Pairs line are the run's own reading of its pairs, carried
// in the report and read back from it, so the markdown and `report.json` cannot
// say two different things about the same run. A designed shape whose reader
// agreed with the answer is the finding the marker exists to surface, so it
// stands on that line beside the designed count rather than only in a warning.
test('the markdown Pairs line carries the designed-agreed count out of the report', async () => {
    const { renderReportMarkdown } = await loadRunner();
    const pair = (status) => ({
        moment: 'm', shape: 'narrow', tier: 'sonnet',
        ruling: { state: 'ruled', date: '2026-09-06' },
        designedMismatch: 'the-narrow-set-drops-the-exception',
        expected: { verdict: 'RESOLVED', answer: 'commit-and-push' },
        observed: { verdict: 'RESOLVED', answer: 'commit-and-push' },
        status, files: [{ path: 'a.md', source: 'worktree', absent: false }],
        cites: [], promptPath: '/p', rawReplyPath: null, costUsd: null, durationMs: null, error: null
    });
    const base = {
        stamp: 's', before: null, beforeCommit: null, dryRun: false, claudeBin: 'claude',
        isolation: 'tools disabled', mismatches: 1, proposedMismatches: 0, designed: 0, errors: 0, exitCode: 1
    };
    // The field wins over a recount, which is what says the line is read from
    // the report: the count over these pairs is one.
    const fromReport = renderReportMarkdown({ ...base, designedAgreed: 2, pairs: [pair('designed-agreed')] });
    assert.ok(fromReport.includes('- Pairs: 1, mismatches: 1 (0 on proposed rulings, 0 designed, 2 designed-agreed), errors: 0, exit code: 1'),
        fromReport.split('\n')[5]);
    assert.ok(fromReport.includes('- WARNING: 2 pairs on a shape built to read against the answer agreed with it instead'));
    // A report built by hand rather than by a run carries no such field, and the
    // count over its pairs is the same number.
    const counted = renderReportMarkdown({ ...base, pairs: [pair('designed-agreed')] });
    assert.ok(counted.includes('- Pairs: 1, mismatches: 1 (0 on proposed rulings, 0 designed, 1 designed-agreed), errors: 0, exit code: 1'),
        counted.split('\n')[5]);
});

// The isolation line is a claim a reader of the report acts on, so it is built
// from what the run did rather than written once and left to drift.
test('the isolation line names the shape the run actually used', async () => {
    const { isolationLine } = await loadRunner();
    assert.strictEqual(isolationLine({ dryRun: true }), 'no reader invoked (--dry-run)');
    // The scratch root's parent is named from what the run did. Where the run
    // put its scratch is `makeReaderScratch`'s caller's to say, so a fixed
    // phrase there is a claim about a directory the run may never have used.
    const scratchRoot = path.join('/fixture-tmp', 'probe-reader-config-abc');
    const scratch = isolationLine({
        scratchConfig: true, scratchRoot, configDir: path.join(scratchRoot, 'config'),
        emptyCwd: true, ancestorClaudeMd: []
    });
    assert.ok(scratch.includes('a scratch CLAUDE_CONFIG_DIR under ' + path.dirname(scratchRoot)
        + ' holding a copy of the credentials'), scratch);
    assert.ok(scratch.includes('an empty working directory under ' + path.dirname(scratchRoot)), scratch);
    assert.ok(!scratch.includes('the OS temp directory'),
        'the line names the directory the run used rather than the one it usually uses: ' + scratch);
    assert.ok(scratch.includes('every CLAUDE and ANTHROPIC variable dropped'));
    // What is above the reader's working directory is a property of the box, so
    // the line reports the chain the run walked rather than asserting it is bare.
    assert.ok(scratch.includes('no CLAUDE.md in it or in any directory above it'));
    const above = isolationLine({
        scratchConfig: true, scratchRoot, configDir: path.join(scratchRoot, 'config'),
        emptyCwd: true, ancestorClaudeMd: ['/tmp/CLAUDE.md']
    });
    assert.ok(above.includes('a CLAUDE.md above it at /tmp/CLAUDE.md, which the reader discovered from there'));
    const inherited = isolationLine({ scratchConfig: false, configDir: null, emptyCwd: false, cwd: '/somewhere' });
    assert.ok(inherited.includes('no CLAUDE_CONFIG_DIR set'), 'a run that pointed at nothing says so');
    assert.ok(inherited.includes('/somewhere'));
    // The chain rides on the other branch too. A working directory the caller
    // named is exactly the case where what sits above it is unknown, so a line
    // that reported the walk only for the run's own scratch would go silent
    // where the claim is worth the most.
    assert.ok(inherited.includes('no CLAUDE.md in it or in any directory above it'),
        'a caller-supplied working directory carries the walk too: ' + inherited);
    const callerCwd = isolationLine({
        scratchConfig: false, configDir: '/caller/config', emptyCwd: false, cwd: '/somewhere',
        ancestorClaudeMd: ['/somewhere/CLAUDE.md']
    });
    assert.ok(callerCwd.includes('the working directory /somewhere, with a CLAUDE.md above it at /somewhere/CLAUDE.md'),
        'the line names the chain it walked: ' + callerCwd);
});

// What the CLI discovers from a working directory is every CLAUDE.md at or above
// it, and what sits above the OS temp directory is a property of the box. The
// run walks the chain so the isolation line reports it.
test('the ancestor walk names every CLAUDE.md at or above the reader\'s working directory', async () => {
    const { ancestorClaudeMd } = await loadRunner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-ancestors-'));
    try {
        const deep = path.join(dir, 'one', 'two', 'cwd');
        fs.mkdirSync(deep, { recursive: true });
        assert.deepStrictEqual(ancestorClaudeMd(deep).filter((p) => p.startsWith(dir)), [],
            'a bare chain names nothing');
        fs.writeFileSync(path.join(dir, 'one', 'CLAUDE.md'), 'instructions a cold reader must not hold');
        fs.writeFileSync(path.join(deep, 'CLAUDE.md'), 'and one in the directory itself');
        assert.deepStrictEqual(ancestorClaudeMd(deep).filter((p) => p.startsWith(dir)), [
            path.join(deep, 'CLAUDE.md'),
            path.join(dir, 'one', 'CLAUDE.md')
        ], 'the walk names them from the directory outwards');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// The line a Chapter quotes, pinned on its shape rather than on a run.
test('the summary line names the counts, the tiers and the report, repo-relative', async () => {
    const { summaryLine } = await loadRunner();
    const runDir = path.join('/repo', '.kit', 'probe-runs', '2026-09-06T22-00-00-000Z');
    const report = {
        pairs: [{ tier: 'sonnet' }, { tier: 'opus' }, { tier: 'sonnet' }],
        mismatches: 1, proposedMismatches: 2, designed: 1, errors: 2, exitCode: 1, runDir
    };
    assert.strictEqual(summaryLine(report, path.resolve('/repo')),
        'probe-corpus: 3 pairs, 1 mismatches (2 on proposed rulings, 1 designed), 2 errors, exit 1, tier sonnet,opus,'
        + ' report .kit/probe-runs/2026-09-06T22-00-00-000Z/report.md');
    // A run that died mid-set names report.json, which is written after every
    // pair, and says it is partial: report.md is written only at the end.
    assert.strictEqual(summaryLine(report, path.resolve('/repo'), { partial: true }),
        'probe-corpus: 3 pairs, 1 mismatches (2 on proposed rulings, 1 designed), 2 errors, exit 1, tier sonnet,opus,'
        + ' report .kit/probe-runs/2026-09-06T22-00-00-000Z/report.json (partial)');
    const outside = summaryLine({
        pairs: [{ tier: 'sonnet' }], mismatches: 0, proposedMismatches: 0, designed: 0, errors: 0, exitCode: 0,
        runDir: path.resolve('/elsewhere/run')
    }, path.resolve('/repo'));
    assert.ok(outside.includes('report ' + path.resolve('/elsewhere/run/report.md').split(path.sep).join('/')),
        'a run directory outside the repository is named in full');
});

// ---------------------------------------------------------- file sourcing

// A git stand-in for a --before read, which makes three calls: `cat-file -t` for
// the object's type, `ls-tree` for the entry's mode, and `show` for its bytes. A
// case that names no type or mode answer gets the ordinary blob at a regular
// file's mode, which is what every corpus file in the tree is.
function fakeGit(answers) {
    return (repoDir, args) => {
        const which = args[0] === 'cat-file' ? 'type' : (args[0] === 'ls-tree' ? 'mode' : 'show');
        const answer = answers[which];
        if (answer) return answer;
        if (which === 'type') return { status: 0, stdout: Buffer.from('blob\n', 'utf8'), stderr: '' };
        if (which === 'mode') {
            return { status: 0, stdout: Buffer.from('100644 blob 0123456789abcdef\t' + args[3] + '\n', 'utf8'), stderr: '' };
        }
        throw new Error('this case named no ' + which + ' answer for git ' + args.join(' '));
    };
}

const GIT_ABSENT = { status: 128, stdout: Buffer.alloc(0), stderr: "fatal: path 'corpus/a.md' does not exist in 'abc123'" };

// On this checkout core.autocrlf is on, so the worktree holds CRLF where the
// blob git prints holds LF. Without the normalisation a before-and-after pair
// over an unchanged file differs in every line, which is the whole reading.
test('a worktree read and a ref read of the same content land on the same bytes', async () => {
    const { readShapeFile, normaliseEol } = await loadRunner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-eol-'));
    try {
        fs.mkdirSync(path.join(dir, ...CORPUS_SEGMENTS), { recursive: true });
        fs.writeFileSync(path.join(dir, ...CORPUS_SEGMENTS, 'a.md'), '---\r\nname: Kit\r\n');
        const worktree = readShapeFile(CORPUS + 'a.md', { repoRoot: dir, homeDir: dir });
        const fromRef = readShapeFile(CORPUS + 'a.md', {
            repoRoot: dir, homeDir: dir, before: 'HEAD',
            git: fakeGit({ show: { status: 0, stdout: Buffer.from('---\nname: Kit\n', 'utf8'), stderr: '' } })
        });
        assert.ok(worktree.bytes.equals(fromRef.bytes), 'the two reads agree byte for byte');
        assert.strictEqual(worktree.bytes.toString('utf8'), '---\nname: Kit\n');
        // Bytes that are not text are handed through untouched.
        const binary = Buffer.from([0x00, 0x0d, 0x0a]);
        assert.ok(normaliseEol(binary).equals(binary));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a file the tree does not carry is an absence in either mode, and a home file is read live', async () => {
    const { readShapeFile } = await loadRunner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-source-'));
    try {
        const missingFromWorktree = readShapeFile(CORPUS + 'a.md', { repoRoot: dir, homeDir: dir });
        assert.deepStrictEqual(
            { source: missingFromWorktree.source, absent: missingFromWorktree.absent },
            { source: 'worktree', absent: true });
        const missingAtRef = readShapeFile(CORPUS + 'a.md', {
            repoRoot: dir, homeDir: dir, before: 'abc123',
            git: fakeGit({ type: GIT_ABSENT })
        });
        assert.deepStrictEqual({ source: missingAtRef.source, absent: missingAtRef.absent }, { source: 'ref', absent: true });
        const untrackedAtRef = readShapeFile(CORPUS + 'a.md', {
            repoRoot: dir, homeDir: dir, before: 'abc123',
            git: fakeGit({ type: { status: 128, stdout: Buffer.alloc(0), stderr: "fatal: path 'corpus/a.md' exists on disk, but not in 'abc123'" } })
        });
        assert.strictEqual(untrackedAtRef.absent, true);
        fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'home content');
        const live = readShapeFile('home/CLAUDE.md', { repoRoot: dir, homeDir: dir, before: 'abc123' });
        assert.strictEqual(live.source, 'live', 'a home file is read live even under --before');
        assert.strictEqual(live.bytes.toString('utf8'), 'home content');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// A nonzero git status is not the same fact as an absent path. Reading every
// failure as an absence hands the reader an empty document set and calls the
// reading a result, so only the two things git says about a path that is not in
// the tree count as one.
test('a git failure that is not an absent path stops the run instead of becoming an absence', async () => {
    const { readShapeFile, isPathAbsentAtRef } = await loadRunner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-git-fail-'));
    try {
        assert.throws(() => readShapeFile(CORPUS + 'a.md', {
            repoRoot: dir, homeDir: dir, before: 'abc123',
            git: fakeGit({ type: { status: null, stdout: Buffer.alloc(0), stderr: 'SIGTERM' } })
        }), /git cat-file -t exited null: SIGTERM/);
        assert.throws(() => readShapeFile(CORPUS + 'a.md', {
            repoRoot: dir, homeDir: dir, before: 'abc123',
            git: fakeGit({ show: { status: 128, stdout: Buffer.alloc(0), stderr: 'fatal: unable to read object: loose object file is corrupt' } })
        }), /git show exited 128/);
        assert.strictEqual(isPathAbsentAtRef({ status: 129, stderr: 'does not exist in' }), false,
            'the absence rule takes git\'s own 128 and nothing else');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// A shape file names corpus text. A path that navigates out of the tree it is
// read against is refused rather than read, in both modes and before either git
// or the filesystem is asked anything, because a shape that can name any file on
// the machine is a reader handed whatever the path points at, and the scratch
// copy of an absent file is an empty buffer written at the same joined path.
test('a shape file path that navigates is refused in the worktree and at a ref alike', async () => {
    const { readShapeFile, refuseUnsafeShapePath } = await loadRunner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-contain-'));
    try {
        const repoRoot = path.join(dir, 'repo');
        fs.mkdirSync(path.join(repoRoot, ...CORPUS_SEGMENTS), { recursive: true });
        fs.writeFileSync(path.join(dir, 'outside.md'), 'a file the corpus has no business reading');
        fs.writeFileSync(path.join(repoRoot, ...CORPUS_SEGMENTS, 'a.md'), 'the alpha passage');
        assert.throws(
            () => readShapeFile(CORPUS + '../../outside.md', { repoRoot, homeDir: repoRoot }),
            /is refused: it carries a "\.\." segment/);
        assert.throws(
            () => readShapeFile('home/../outside.md', { repoRoot, homeDir: repoRoot }),
            /is refused: it carries a "\.\." segment/);
        // The same refusal under --before, where git resolves such a path
        // without reading the file the caller named and exits zero. No git call
        // is made at all: the stand-in throws if one reaches it.
        assert.throws(() => readShapeFile(CORPUS + '../../outside.md', {
            repoRoot, homeDir: repoRoot, before: 'abc123',
            git: () => { throw new Error('git was spawned for a path that should never have reached it'); }
        }), /is refused: it carries a "\.\." segment/);
        // A path whose target does not exist escapes just as far, and the
        // refusal comes before anything asks the filesystem whether it is there.
        assert.throws(
            () => readShapeFile(CORPUS + '../../nowhere.md', { repoRoot, homeDir: repoRoot }),
            /is refused: it carries a "\.\." segment/);
        for (const spelling of ['', CORPUS + '/a.md', 'corpus\\a.md', './corpus/a.md', path.resolve(dir, 'outside.md')]) {
            assert.throws(() => refuseUnsafeShapePath(spelling), /is refused/, JSON.stringify(spelling) + ' is refused');
        }
        // The control: the same guard on a path that does lie inside reads it.
        assert.strictEqual(refuseUnsafeShapePath(CORPUS + 'a.md'), CORPUS + 'a.md');
        const inside = readShapeFile(CORPUS + 'a.md', { repoRoot, homeDir: repoRoot });
        assert.strictEqual(inside.bytes.toString('utf8'), 'the alpha passage');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// The containment judgment inside the read is lexical and taken before the
// filesystem is asked anything: a path that escapes its root is refused whether
// or not its target exists, where an existence probe taken first would book the
// missing one as an ordinary absence row and reach outside the root to say so.
test('containment is judged on the names, with nothing on disk to judge', async () => {
    const { withinRoot } = await loadRunner();
    const root = path.resolve(path.join(os.tmpdir(), 'probe-no-such-root-' + process.pid));
    assert.strictEqual(fs.existsSync(root), false, 'nothing under this root exists');
    assert.strictEqual(withinRoot(root, path.join(root, ...CORPUS_SEGMENTS, 'a.md')), true);
    assert.strictEqual(withinRoot(root, path.join(root, '..', 'outside.md')), false);
    assert.strictEqual(withinRoot(root, path.resolve(root + '-sibling', 'a.md')), false,
        'a sibling whose name starts with the root is outside it');
    assert.strictEqual(withinRoot(root, root), false, 'the root itself is not a file in it');
});

// A shape entry naming a directory is refused by name in both modes. In the
// worktree the read would throw EISDIR out of the prepare loop; at a ref
// `git show` prints the directory listing, which would reach the reader as the
// file's corpus text.
test('a shape entry naming a directory is refused in either mode', async () => {
    const { readShapeFile } = await loadRunner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-dir-'));
    try {
        fs.mkdirSync(path.join(dir, ...CORPUS_SEGMENTS), { recursive: true });
        fs.writeFileSync(path.join(dir, ...CORPUS_SEGMENTS, 'a.md'), 'the alpha passage');
        assert.throws(() => readShapeFile(CORPUS.slice(0, -1), { repoRoot: dir, homeDir: dir }),
            /is refused: .* is a directory/);
        assert.throws(() => readShapeFile(CORPUS.slice(0, -1), {
            repoRoot: dir, homeDir: dir, before: 'abc123',
            git: fakeGit({ type: { status: 0, stdout: Buffer.from('tree\n', 'utf8'), stderr: '' } })
        }), /is refused: at abc123 it names a "tree" rather than a file/);
        // The control: the same two reads of a file in that directory work.
        assert.strictEqual(readShapeFile(CORPUS + 'a.md', { repoRoot: dir, homeDir: dir }).bytes.toString('utf8'),
            'the alpha passage');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// The scratch copy is the other half of the path rule: it is written at a path
// joined from the same string the shape spelled, inside the run directory, and
// an absent file is written as an empty buffer, so a join that normalises out of
// the run directory truncates whatever it lands on.
test('a shape copy that would be written outside the run directory is refused', async () => {
    const { shapeCopyPath } = await loadRunner();
    const shapeDir = path.resolve(path.join(os.tmpdir(), 'probe-run', 'shapes', 'moment', 'full'));
    assert.strictEqual(shapeCopyPath(shapeDir, 'corpus/a.md'), path.join(shapeDir, 'corpus', 'a.md'));
    assert.throws(() => shapeCopyPath(shapeDir, '../../../../outside.md'), /is not under the run directory/);
    assert.throws(() => shapeCopyPath(shapeDir, path.resolve(os.tmpdir(), 'outside.md')), /is not under the run directory/);
});

// The link case of the same rule, which needs the privilege to create one: on a
// box that refuses it the case says so rather than passing quietly.
test('a shape file reached through a link is refused', async (t) => {
    const { readShapeFile } = await loadRunner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-link-'));
    try {
        const repoRoot = path.join(dir, 'repo');
        fs.mkdirSync(path.join(repoRoot, ...CORPUS_SEGMENTS), { recursive: true });
        fs.writeFileSync(path.join(dir, 'outside.md'), 'a file the corpus has no business reading');
        try {
            fs.symlinkSync(path.join(dir, 'outside.md'), path.join(repoRoot, ...CORPUS_SEGMENTS, 'link.md'), 'file');
        } catch (err) {
            t.skip('this box does not permit creating a symlink: ' + (err && err.code));
            return;
        }
        assert.throws(() => readShapeFile(CORPUS + 'link.md', { repoRoot, homeDir: repoRoot }), /is a link/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// The ref half of the same refusal, which needs its own read: a link committed
// to a tree is a blob whose bytes are its target path, so `git cat-file -t`
// calls it a blob like any other and `git show` prints the path as though it
// were the document. The mode `git ls-tree` names is what tells them apart.
test('a link at the ref is refused by its mode rather than read as its target path', async () => {
    const { readShapeFile } = await loadRunner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-ref-link-'));
    try {
        const linked = CORPUS + 'link.md';
        // No `show` answer is named, so a stand-in asked for the bytes throws
        // its own error rather than this one: the refusal comes before the read.
        assert.throws(() => readShapeFile(linked, {
            repoRoot: dir, homeDir: dir, before: 'abc123',
            git: fakeGit({ mode: { status: 0, stdout: Buffer.from('120000 blob 0123456789abcdef\t' + linked + '\n', 'utf8'), stderr: '' } })
        }), /is refused: at abc123 it is a link/);
        // A mode the tree can carry and a shape file cannot be: a submodule's
        // gitlink, refused by name rather than read.
        assert.throws(() => readShapeFile(linked, {
            repoRoot: dir, homeDir: dir, before: 'abc123',
            git: fakeGit({ mode: { status: 0, stdout: Buffer.from('160000 commit 0123456789abcdef\t' + linked + '\n', 'utf8'), stderr: '' } })
        }), /git ls-tree names its mode "160000"/);
        // A failed mode read is a fault in the run rather than a fact about the
        // tree, so it stops the run instead of becoming a reading.
        assert.throws(() => readShapeFile(linked, {
            repoRoot: dir, homeDir: dir, before: 'abc123',
            git: fakeGit({ mode: { status: 128, stdout: Buffer.alloc(0), stderr: 'fatal: not a tree object' } })
        }), /git ls-tree exited 128/);
        // The control: the same read at a regular file's mode returns the bytes.
        const read = readShapeFile(linked, {
            repoRoot: dir, homeDir: dir, before: 'abc123',
            git: fakeGit({ show: { status: 0, stdout: Buffer.from('the alpha passage', 'utf8'), stderr: '' } })
        });
        assert.strictEqual(read.bytes.toString('utf8'), 'the alpha passage');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// The allowlist the parser enforces on a probe file, enforced again at the read
// boundary. `runProbes` takes probes as objects, so a library caller composing
// its own shapes reaches this guard and never the parser's, and the navigation
// rule alone admits every one of these spellings: none of them navigates
// anywhere, and each names a secret or a repository internal that would be
// copied into a prompt and handed to a reader.
test('a shape file outside the two allowed roots is refused, in both modes', async () => {
    const { refuseUnsafeShapePath, readShapeFile } = await loadRunner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-allowlist-'));
    try {
        for (const spelling of [
            'home/.credentials.json', '.git/config', '.env', 'test/probes/commit-and-push.md',
            'home/plugins/config.json', 'plugins/other-plugin/SKILL.md'
        ]) {
            assert.throws(() => refuseUnsafeShapePath(spelling), /is refused/,
                JSON.stringify(spelling) + ' is refused');
        }
        // The control: the two roots the allowlist admits pass the same guard.
        assert.strictEqual(refuseUnsafeShapePath(CORPUS + 'a.md'), CORPUS + 'a.md');
        assert.strictEqual(refuseUnsafeShapePath('home/CLAUDE.md'), 'home/CLAUDE.md');

        // The refusal comes before the read in both modes, with the file sitting
        // right there in the home directory the run was pointed at.
        fs.writeFileSync(path.join(dir, '.credentials.json'), '{"token":"fixture-home-only"}', 'utf8');
        assert.throws(() => readShapeFile('home/.credentials.json', { repoRoot: dir, homeDir: dir }),
            /is refused: a home\/ entry names one markdown file/);
        assert.throws(() => readShapeFile('.git/config', {
            repoRoot: dir, homeDir: dir, before: 'abc123',
            git: () => { throw new Error('git was spawned for a path that should never have reached it'); }
        }), /is refused: it sits outside plugins\/claude-kit\//);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ------------------------------------------------------------ end to end

// A minimal stand-in for the probe file parser the runner imports. It reads the
// fixture frontmatter this suite writes and nothing wider, so an end-to-end
// case fails on the runner rather than on the parser's own validation.
const PARSER_STUB = `
import fs from 'node:fs';
import path from 'node:path';
export const VERDICTS = ['RESOLVED', 'CONTESTED', 'SILENT'];
export const RULING_STATES = ['proposed', 'ruled'];
export const PLUGIN_PREFIX = 'plugins/claude-kit/';
export const HOME_ENTRY = /^home\\/[A-Za-z0-9._-]+\\.md$/;
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const TIERS = ['sonnet', 'opus'];
export function listProbeFiles(dir) {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => path.join(dir, f));
}
export function parseProbeFile(text) {
    const parts = text.split('---\\n');
    const front = parts[1];
    const scenario = parts.slice(2).join('---\\n');
    const out = { options: [], shapes: [] };
    let list = null;
    let shape = null;
    for (const line of front.split('\\n')) {
        if (line.trim() === '') continue;
        const top = /^([a-z]+):\\s*(.*)$/.exec(line);
        if (top) {
            list = top[1];
            if (top[2] !== '') {
                if (top[1] === 'ruling') {
                    const bits = top[2].split(' ');
                    out.ruling = { state: bits[0], date: bits[1] };
                } else { out[top[1]] = top[2]; }
            }
            continue;
        }
        if (list === 'options') { out.options.push(line.replace(/^\\s*-\\s*/, '')); continue; }
        if (list === 'shapes') {
            const named = /^\\s*-\\s*name:\\s*(.+)$/.exec(line);
            if (named) { shape = { name: named[1].trim(), designedMismatch: null, files: [] }; out.shapes.push(shape); continue; }
            const designed = /^\\s*designed-mismatch:\\s*(\\S+)$/.exec(line);
            if (designed && shape) { shape.designedMismatch = designed[1]; continue; }
            const file = /^\\s*-\\s*(\\S+)$/.exec(line);
            if (file && shape) shape.files.push(file[1]);
        }
    }
    out.scenario = scenario;
    return out;
}
`;

// The stub stands in for the parser's reading of a probe file, not for the
// vocabularies the runner imports from it: `PLUGIN_PREFIX` and `HOME_ENTRY` are
// the two roots a shape file may name, and `SLUG` and `TIERS` are what the
// runner holds a moment, a shape name and a tier to at its library entry. A stub
// carrying its own literals would leave every end-to-end case below green
// against a vocabulary the real parser no longer exports. They are compared as
// values rather than as text.
test('the parser stub carries the same path roots, ruling states, verdicts, slug and tiers the real parser exports', async () => {
    const real = require('../tools/probe-corpus/probe-file.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-stub-'));
    try {
        const stubPath = path.join(dir, 'probe-file.mjs');
        fs.writeFileSync(stubPath, PARSER_STUB, 'utf8');
        const stub = await import(pathToFileURL(stubPath).href);
        assert.strictEqual(stub.PLUGIN_PREFIX, real.PLUGIN_PREFIX);
        assert.strictEqual(stub.HOME_ENTRY.source, real.HOME_ENTRY.source);
        assert.strictEqual(stub.HOME_ENTRY.flags, real.HOME_ENTRY.flags);
        assert.deepStrictEqual(stub.RULING_STATES, real.RULING_STATES);
        assert.deepStrictEqual(stub.VERDICTS, real.VERDICTS);
        assert.strictEqual(stub.SLUG.source, real.SLUG.source);
        assert.strictEqual(stub.SLUG.flags, real.SLUG.flags);
        assert.deepStrictEqual(stub.TIERS, real.TIERS);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// The fake reader: it reads the prompt on stdin and answers from a script of
// marker-to-reply pairs, in the JSON shape --output-format json produces. It
// also records what it was handed (the config directory, everything in it, the
// credentials it found there and its working directory), which is how a case
// proves the runner never pointed a reader at the operator's own home.
const FAKE_CLI = `
import fs from 'node:fs';
import path from 'node:path';
const prompt = fs.readFileSync(0, 'utf8');
const script = JSON.parse(fs.readFileSync(process.env.FAKE_SCRIPT, 'utf8'));
const configDir = process.env.CLAUDE_CONFIG_DIR || '';
let credentials = null;
let entries = [];
try { credentials = fs.readFileSync(path.join(configDir, '.credentials.json'), 'utf8'); } catch { credentials = null; }
try { entries = fs.readdirSync(configDir); } catch { entries = []; }
fs.appendFileSync(process.env.FAKE_OBSERVED, JSON.stringify({
    configDir, entries, credentials, cwd: process.cwd()
}) + '\\n');
// A run dying part way through a set, which FAKE_BLOCK_REPLY produces: from the
// named call on, a directory is planted where the runner is about to write the
// reply, so the write throws where a reader host going away would.
const calls = fs.readFileSync(process.env.FAKE_OBSERVED, 'utf8').split('\\n').filter((l) => l !== '').length;
if (process.env.FAKE_BLOCK_REPLY && calls >= Number(process.env.FAKE_BLOCK_REPLY)) {
    const runsDir = path.join(path.dirname(process.env.FAKE_OBSERVED), '.kit', 'probe-runs');
    const stamps = fs.readdirSync(runsDir).sort();
    const shapesDir = path.join(runsDir, stamps[stamps.length - 1], 'shapes');
    for (const moment of fs.readdirSync(shapesDir)) {
        for (const shape of fs.readdirSync(path.join(shapesDir, moment))) {
            const reply = path.join(shapesDir, moment, shape, 'reply.txt');
            if (!fs.existsSync(reply)) fs.mkdirSync(reply);
        }
    }
}
// A reply past the runner's reply cap, which FAKE_OVERSIZED_AT produces on that
// one call: the child writes more than maxBuffer, so spawnSync stops it and
// reports ENOBUFS. That kill is the runner's own and the pair is an ERROR the
// run carries on from.
if (process.env.FAKE_OVERSIZED_AT && calls === Number(process.env.FAKE_OVERSIZED_AT)) {
    const chunk = 'x'.repeat(1024 * 1024);
    for (let i = 0; i < 12; i += 1) process.stdout.write(chunk);
    process.exit(0);
}
// The caller's Ctrl+C, which FAKE_INTERRUPT_AT produces: from the named call on,
// the reader dies the way an interrupted one does, by the signal on a platform
// that has them and with the control-C exit status on Windows, which has none.
if (process.env.FAKE_INTERRUPT_AT && calls >= Number(process.env.FAKE_INTERRUPT_AT)) {
    if (process.platform === 'win32') process.exit(3221225786);
    process.kill(process.pid, 'SIGINT');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
}
let reply = script.default;
for (const entry of script.rules) {
    if (prompt.includes(entry.marker)) { reply = entry.reply; break; }
}
process.stdout.write(JSON.stringify({
    type: 'result', is_error: false, result: reply, total_cost_usd: 0.0125, duration_ms: 2500
}));
`;

function probeFixture(spec) {
    const shapes = spec.shapes.map((s) => '  - name: ' + s.name
        + (s.designedMismatch ? '\n    designed-mismatch: ' + s.designedMismatch : '')
        + '\n' + s.files.map((f) => '      - ' + f).join('\n')).join('\n');
    return [
        '---',
        'moment: ' + spec.moment,
        'tier: sonnet',
        'verdict: ' + spec.verdict,
        'answer: ' + spec.answer,
        'ruling: ' + (spec.ruling || 'ruled') + ' 2026-09-06',
        'options:',
        ...spec.options.map((o) => '  - ' + o),
        'shapes:',
        shapes,
        '---',
        spec.scenario
    ].join('\n') + '\n';
}

// The credentials a harness reader authenticates from. It is a fixture value
// and nothing else: every end-to-end case runs under `--home <root>/home`, so a
// reader that came back holding this string read the fixture home the case
// built and not the operator's.
const FIXTURE_CREDENTIALS = '{"token":"fixture-home-only"}';

// A disposable repository: the runner and its template at the layout the runner
// resolves REPO_ROOT from, the parser stand-in beside them, the read guard the
// runner calls, a corpus, probe fixtures, a fixture home and a fake reader.
function makeHarness(fixtures, corpus) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-e2e-'));
    fs.mkdirSync(path.join(root, 'tools', 'probe-corpus'), { recursive: true });
    fs.mkdirSync(path.join(root, 'test', 'probes'), { recursive: true });
    fs.mkdirSync(path.join(root, ...CORPUS_SEGMENTS), { recursive: true });
    fs.mkdirSync(path.join(root, 'plugins', 'claude-kit', 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(root, 'home'), { recursive: true });
    fs.copyFileSync(RUNNER, path.join(root, 'tools', 'probe-corpus', 'run.mjs'));
    fs.copyFileSync(TEMPLATE, path.join(root, 'tools', 'probe-corpus', 'template.md'));
    // The two libraries the runner loads out of its own repository root, and
    // the library each is written against: the containment guard for every path
    // it reads, and the channel renderer that takes the OS account name out of
    // the lines it prints.
    for (const lib of ['kit-read-lib.js', 'kit-goal-lib.js', 'kit-compact-lib.js']) {
        fs.copyFileSync(path.join(HOOKS, lib), path.join(root, 'plugins', 'claude-kit', 'hooks', lib));
    }
    fs.writeFileSync(path.join(root, 'tools', 'probe-corpus', 'probe-file.mjs'), PARSER_STUB, 'utf8');
    fs.writeFileSync(path.join(root, 'fake-claude.mjs'), FAKE_CLI, 'utf8');
    // A fixture home carrying the one file the runner may copy out of a home
    // directory, beside the files it must not.
    fs.writeFileSync(path.join(root, 'home', '.credentials.json'), FIXTURE_CREDENTIALS, 'utf8');
    fs.writeFileSync(path.join(root, 'home', 'CLAUDE.md'), 'the home instructions a cold reader must not hold', 'utf8');
    fs.mkdirSync(path.join(root, 'home', 'plugins'), { recursive: true });
    for (const [name, text] of Object.entries(corpus)) fs.writeFileSync(path.join(root, ...CORPUS_SEGMENTS, name), text, 'utf8');
    for (const spec of fixtures) fs.writeFileSync(path.join(root, 'test', 'probes', spec.moment + '.md'), probeFixture(spec), 'utf8');
    return root;
}

function runHarness(root, args, script, extraEnv) {
    const scriptPath = path.join(root, 'reply-script.json');
    const observedPath = path.join(root, 'observed.jsonl');
    fs.writeFileSync(scriptPath, JSON.stringify(script), 'utf8');
    fs.writeFileSync(observedPath, '', 'utf8');
    const res = spawnSync(process.execPath, [
        path.join(root, 'tools', 'probe-corpus', 'run.mjs'),
        '--claude', path.join(root, 'fake-claude.mjs'),
        '--home', path.join(root, 'home')
    ].concat(args), {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, FAKE_SCRIPT: scriptPath, FAKE_OBSERVED: observedPath, ...(extraEnv || {}) }
    });
    const runsDir = path.join(root, '.kit', 'probe-runs');
    const stamps = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort() : [];
    const runDir = stamps.length > 0 ? path.join(runsDir, stamps[stamps.length - 1]) : null;
    const report = runDir && fs.existsSync(path.join(runDir, 'report.json'))
        ? JSON.parse(fs.readFileSync(path.join(runDir, 'report.json'), 'utf8'))
        : null;
    const observed = fs.readFileSync(observedPath, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l));
    return { status: res.status, stdout: res.stdout, stderr: res.stderr, runDir, report, observed };
}

const MATCHING_REPLY = 'The documents settle it.\n\nVERDICT: RESOLVED\nANSWER: commit-and-push\nCITES: corpus/a.md: commit and push are the default';

test('an end-to-end run matches a ruled probe, exits zero and writes both reports', async () => {
    const root = makeHarness([{
        moment: 'green-moment', verdict: 'RESOLVED', answer: 'commit-and-push',
        options: ['commit-and-push', 'ask-first'],
        shapes: [{ name: 'full', files: [CORPUS + 'a.md', CORPUS + 'b.md'] }, { name: 'narrow', files: [CORPUS + 'a.md'] }],
        scenario: 'A section is green under a Commit-and-Push header.'
    }], { 'a.md': 'commit and push are the default', 'b.md': 'the section closes with a push' });
    try {
        const run = runHarness(root, [], { default: MATCHING_REPLY, rules: [] });
        assert.strictEqual(run.status, 0, run.stderr);
        assert.strictEqual(run.report.pairs.length, 2);
        assert.deepStrictEqual(run.report.pairs.map((p) => p.status), ['match', 'match']);
        assert.strictEqual(run.report.mismatches, 0);
        assert.ok(fs.existsSync(path.join(run.runDir, 'report.md')));
        assert.ok(fs.readFileSync(path.join(run.runDir, 'report.md'), 'utf8').includes('green-moment'));
        // The shape copies and the whole raw reply are on disk, re-locatable by content.
        const copied = fs.readFileSync(path.join(run.runDir, 'shapes', 'green-moment', 'full', ...CORPUS_SEGMENTS, 'a.md'), 'utf8');
        assert.strictEqual(copied, 'commit and push are the default');
        assert.ok(fs.readFileSync(path.join(run.runDir, 'shapes', 'green-moment', 'full', 'reply.txt'), 'utf8').includes('commit-and-push'));
        assert.strictEqual(run.report.pairs[0].costUsd, 0.0125);
        assert.strictEqual(run.report.errors, 0);

        // The reader authenticated from a scratch config directory holding a
        // copy of the fixture home's credentials and nothing else, from an
        // empty working directory, and that scratch is gone now. The
        // credentials value is the predicate that proves the run read the
        // fixture home rather than this machine's: nothing else on the box
        // carries it.
        assert.strictEqual(run.observed.length, 2, 'the fake reader ran once per pair');
        for (const seen of run.observed) {
            assert.strictEqual(seen.credentials, FIXTURE_CREDENTIALS);
            assert.deepStrictEqual(seen.entries, ['.credentials.json']);
            assert.ok(!seen.configDir.startsWith(run.runDir), 'the credential copy is not inside the evidence artifact');
            // The isolation line names the directory this run actually put its
            // scratch under, which is the scratch root's own parent.
            assert.ok(run.report.isolation.includes('a scratch CLAUDE_CONFIG_DIR under '
                + path.dirname(path.dirname(seen.configDir))), run.report.isolation);
            assert.strictEqual(fs.existsSync(seen.configDir), false, 'the scratch is removed when the run ends');
            assert.deepStrictEqual(fs.existsSync(seen.cwd), false, 'the reader\'s working directory goes with it');
        }

        // The one stdout line a Chapter quotes.
        assert.strictEqual(run.stdout.trim().split('\n').length, 1, 'stdout carries the summary line and nothing else');
        assert.match(run.stdout.trim(), /^probe-corpus: 2 pairs, 0 mismatches \(0 on proposed rulings, 0 designed\), 0 errors, exit 0, tier sonnet, report \.kit\/probe-runs\/[^/]+\/report\.md$/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a ruling the reader contradicts is a mismatch row and a nonzero exit', async () => {
    const root = makeHarness([{
        moment: 'broken-ruling', verdict: 'RESOLVED', answer: 'ask-first',
        options: ['commit-and-push', 'ask-first'],
        shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }],
        scenario: 'A section is green under a Commit-and-Push header.'
    }], { 'a.md': 'commit and push are the default' });
    try {
        const run = runHarness(root, [], { default: MATCHING_REPLY, rules: [] });
        assert.strictEqual(run.status, 1, run.stderr);
        assert.strictEqual(run.report.pairs[0].status, 'mismatch');
        assert.strictEqual(run.report.pairs[0].expected.answer, 'ask-first');
        assert.strictEqual(run.report.pairs[0].observed.answer, 'commit-and-push');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a reply with no verdict line is recorded UNPARSED and counts as a mismatch', async () => {
    const root = makeHarness([{
        moment: 'unparsed-reply', verdict: 'RESOLVED', answer: 'commit-and-push',
        options: ['commit-and-push', 'ask-first'],
        shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }],
        scenario: 'A section is green under a Commit-and-Push header.'
    }], { 'a.md': 'commit and push are the default' });
    try {
        const run = runHarness(root, [], { default: 'I would probably push, but the documents are long.', rules: [] });
        assert.strictEqual(run.status, 1, run.stderr);
        assert.strictEqual(run.report.pairs[0].status, 'UNPARSED');
        assert.strictEqual(run.report.pairs[0].observed.verdict, null);
        assert.ok(fs.readFileSync(run.report.pairs[0].rawReplyPath, 'utf8').includes('the documents are long'));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a reader that fails is an ERROR pair the run records and carries on from', async () => {
    const { runProbes } = await loadRunner();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-error-'));
    try {
        fs.mkdirSync(path.join(root, ...CORPUS_SEGMENTS), { recursive: true });
        fs.writeFileSync(path.join(root, ...CORPUS_SEGMENTS, 'a.md'), 'alpha');
        fs.writeFileSync(path.join(root, ...CORPUS_SEGMENTS, 'b.md'), 'beta');
        let call = 0;
        const report = await runProbes([probe()], {
            repoRoot: root,
            runDir: path.join(root, 'run'),
            templatePath: TEMPLATE,
            configDir: false,
            invoke: () => {
                call += 1;
                return call === 1
                    ? { ok: false, text: '', raw: '', costUsd: null, durationMs: 12, error: 'reader exited 1: auth failed' }
                    : { ok: true, text: MATCHING_REPLY, raw: MATCHING_REPLY, costUsd: 0.01, durationMs: 20 };
            }
        });
        assert.deepStrictEqual(report.pairs.map((p) => p.status), ['ERROR', 'match']);
        assert.strictEqual(report.pairs[0].error, 'reader exited 1: auth failed');
        assert.strictEqual(report.errors, 1);
        assert.strictEqual(report.mismatches, 0);
        assert.strictEqual(report.exitCode, 0, 'an error is the absence of a reading, not a reading that disagreed');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// A caller that supplies its own config directory gets no scratch and so no
// scratch working directory, and the reader is spawned in the OS temp directory
// whether or not the run names it. The run names it, so the ancestor walk covers
// the directory the reader actually ran in and the isolation line reports the
// chain that was there rather than passing over it in silence.
test('a run with a caller-supplied config directory names the working directory its readers ran in', async () => {
    const { runProbes } = await loadRunner();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-cwd-'));
    try {
        fs.mkdirSync(path.join(root, ...CORPUS_SEGMENTS), { recursive: true });
        fs.writeFileSync(path.join(root, ...CORPUS_SEGMENTS, 'a.md'), 'alpha');
        fs.writeFileSync(path.join(root, ...CORPUS_SEGMENTS, 'b.md'), 'beta');
        const seen = [];
        const report = await runProbes([probe()], {
            repoRoot: root,
            runDir: path.join(root, 'run'),
            templatePath: TEMPLATE,
            configDir: path.join(root, 'caller-config'),
            invoke: (bin, tier, prompt, opts) => {
                seen.push(opts.cwd);
                return { ok: true, text: MATCHING_REPLY, raw: MATCHING_REPLY, costUsd: 0.01, durationMs: 20 };
            }
        });
        assert.deepStrictEqual(seen, [os.tmpdir(), os.tmpdir()], 'every reader was spawned in the OS temp directory');
        assert.ok(report.isolation.includes('the working directory ' + os.tmpdir()),
            'the isolation line names it: ' + report.isolation);
        assert.ok(report.isolation.includes(path.join(root, 'caller-config')));
        assert.ok(report.isolation.includes('no CLAUDE.md in it or in any directory above it')
            || report.isolation.includes('a CLAUDE.md above it at'),
            'the run reports the chain it walked either way: ' + report.isolation);

        // A working directory the caller names is where a CLAUDE.md above the
        // reader is most likely to be there, so the line names what the walk
        // found rather than passing over it. The file is planted in this case's
        // own temp directory rather than in the shared temp root the default
        // working directory sits under.
        const readerCwd = path.join(root, 'reader-cwd');
        fs.mkdirSync(readerCwd);
        fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'instructions a cold reader must not hold');
        const walked = await runProbes([probe()], {
            repoRoot: root,
            runDir: path.join(root, 'run-2'),
            templatePath: TEMPLATE,
            configDir: path.join(root, 'caller-config'),
            readerCwd,
            invoke: () => ({ ok: true, text: MATCHING_REPLY, raw: MATCHING_REPLY, costUsd: 0.01, durationMs: 20 })
        });
        assert.ok(walked.isolation.includes('the working directory ' + readerCwd),
            'the isolation line names the directory the readers ran in: ' + walked.isolation);
        assert.ok(walked.isolation.includes('a CLAUDE.md above it at ' + path.join(root, 'CLAUDE.md')),
            'the isolation line names the CLAUDE.md above it: ' + walked.isolation);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// A caller supplying its own invoker spawns no CLI, and the scratch the runner
// builds for a real reader holds a copy of the credentials in the home directory
// so the reader can authenticate from them. Built for an invoker, that copy is a
// live token written to disk for a reader that never runs, and the default home
// directory is the operator's own.
test('an invoker supplied with neither a config directory nor a home directory is refused', async () => {
    const { runProbes } = await loadRunner();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-invoke-'));
    try {
        fs.mkdirSync(path.join(root, ...CORPUS_SEGMENTS), { recursive: true });
        fs.writeFileSync(path.join(root, ...CORPUS_SEGMENTS, 'a.md'), 'alpha');
        fs.writeFileSync(path.join(root, ...CORPUS_SEGMENTS, 'b.md'), 'beta');
        const home = path.join(root, 'home');
        fs.mkdirSync(home);
        fs.writeFileSync(path.join(home, '.credentials.json'), FIXTURE_CREDENTIALS, 'utf8');
        let invoked = 0;
        const invoke = () => { invoked += 1; return { ok: true, text: MATCHING_REPLY, raw: MATCHING_REPLY, costUsd: 0, durationMs: 1 }; };
        const options = (extra) => Object.assign({
            repoRoot: root, runDir: path.join(root, 'run'), templatePath: TEMPLATE, invoke
        }, extra || {});

        await assert.rejects(() => runProbes([probe()], options()), /neither configDir nor homeDir/);
        assert.strictEqual(invoked, 0, 'the refusal lands before any pair runs');
        assert.strictEqual(fs.existsSync(path.join(root, 'run')), false, 'and before the run directory exists');

        // Each of the three ways to name where the reading runs from is taken,
        // and they are what every other case in this file passes.
        const noConfig = await runProbes([probe()], options({ runDir: path.join(root, 'run-none'), configDir: false }));
        assert.deepStrictEqual(noConfig.pairs.map((p) => p.status), ['match', 'match']);
        const ownConfig = await runProbes([probe()], options({ runDir: path.join(root, 'run-own'), configDir: path.join(root, 'caller-config') }));
        assert.deepStrictEqual(ownConfig.pairs.map((p) => p.status), ['match', 'match']);
        const fixtureHome = await runProbes([probe()], options({ runDir: path.join(root, 'run-home'), homeDir: home }));
        assert.deepStrictEqual(fixtureHome.pairs.map((p) => p.status), ['match', 'match']);
        assert.strictEqual(invoked, 6);
        // A dry run builds no scratch and invokes nothing, so it needs neither.
        const dry = await runProbes([probe()], options({ runDir: path.join(root, 'run-dry'), dryRun: true }));
        assert.deepStrictEqual(dry.pairs.map((p) => p.status), ['dry-run', 'dry-run']);
        assert.strictEqual(invoked, 6, 'a dry run spawns nothing');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// The same marker read off a probe file by the parser and carried through a whole
// run, rather than handed to `runProbes` as an object: the key is frontmatter, so
// a run reads it from the file or the marker is not real.
test('a probe file marking a shape carries the marker through the run and out of the exit code', async () => {
    const slug = 'the-narrow-set-drops-the-exception';
    const root = makeHarness([{
        moment: 'marked-moment', verdict: 'RESOLVED', answer: 'commit-and-push',
        options: ['commit-and-push', 'ask-first'],
        shapes: [
            { name: 'full', files: [CORPUS + 'a.md'] },
            { name: 'narrow', designedMismatch: slug, files: [CORPUS + 'b.md'] }
        ],
        scenario: 'A section is green under a Commit-and-Push header.'
    }], { 'a.md': 'commit and push are the default', 'b.md': 'the copy that dropped the exception' });
    try {
        const run = runHarness(root, [], {
            default: MATCHING_REPLY,
            rules: [{ marker: 'the copy that dropped the exception', reply: 'VERDICT: RESOLVED\nANSWER: ask-first\nCITES: b.md: it stops short' }]
        });
        assert.strictEqual(run.status, 0, 'a designed disagreement never reddens the exit code: ' + run.stderr);
        assert.deepStrictEqual(run.report.pairs.map((p) => p.status), ['match', 'designed']);
        assert.strictEqual(run.report.pairs[1].designedMismatch, slug);
        assert.strictEqual(run.report.designed, 1);
        assert.strictEqual(run.report.mismatches, 0);
        assert.match(run.stdout.trim(), /^probe-corpus: 2 pairs, 0 mismatches \(0 on proposed rulings, 1 designed\), 0 errors, exit 0, /);
        // The reader was handed the shape's files and never the marker on them.
        const prompt = fs.readFileSync(path.join(run.runDir, 'shapes', 'marked-moment', 'narrow', 'prompt.txt'), 'utf8');
        assert.ok(prompt.includes('the copy that dropped the exception'), 'the control: the shape\'s file is in the prompt');
        assert.ok(!prompt.includes('designed-mismatch'));
        assert.ok(!prompt.includes(slug));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// The whole of the designed-mismatch marker as a run sees it: the shape it sits
// on reads against the answer without reddening the exit code, the agreement that
// would mean the designed red is gone is counted like any other mismatch, and
// nothing about the marker reaches the reader, whose prompt is the scenario, the
// option list and the shape's files.
test('a designed-mismatch shape reports apart, stays out of the exit code and never reaches the prompt', async () => {
    const { runProbes, summaryLine } = await loadRunner();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-designed-'));
    const slug = 'output-style-copy-lacks-the-exception';
    const disagreeing = 'VERDICT: RESOLVED\nANSWER: ask-first\nCITES: ' + CORPUS + 'b.md: the narrow set stops short';
    try {
        fs.mkdirSync(path.join(root, ...CORPUS_SEGMENTS), { recursive: true });
        fs.writeFileSync(path.join(root, ...CORPUS_SEGMENTS, 'a.md'), 'commit and push are the default');
        fs.writeFileSync(path.join(root, ...CORPUS_SEGMENTS, 'b.md'), 'the copy that dropped the exception');
        const marked = probe({
            shapes: [
                { name: 'full', designedMismatch: null, files: [CORPUS + 'a.md'] },
                { name: 'narrow', designedMismatch: slug, files: [CORPUS + 'b.md'] }
            ]
        });
        const prompts = [];
        const answer = (reply) => (bin, tier, prompt) => {
            prompts.push(prompt);
            return { ok: true, text: reply(prompt), raw: reply(prompt), costUsd: null, durationMs: 5 };
        };

        const red = await runProbes([marked], {
            repoRoot: root, runDir: path.join(root, 'run-designed'), templatePath: TEMPLATE, configDir: false,
            invoke: answer((prompt) => (prompt.includes('the copy that dropped the exception') ? disagreeing : MATCHING_REPLY))
        });
        assert.deepStrictEqual(red.pairs.map((p) => p.status), ['match', 'designed']);
        assert.strictEqual(red.pairs[1].designedMismatch, slug);
        assert.strictEqual(red.designed, 1);
        assert.strictEqual(red.mismatches, 0);
        assert.strictEqual(red.proposedMismatches, 0);
        assert.strictEqual(red.exitCode, 0, 'a designed disagreement never reddens the exit code');
        assert.ok(summaryLine(red, root).includes('0 mismatches (0 on proposed rulings, 1 designed)'),
            'the summary line carries the designed count: ' + summaryLine(red, root));
        const redMarkdown = fs.readFileSync(path.join(root, 'run-designed', 'report.md'), 'utf8');
        assert.ok(redMarkdown.includes('- Pairs: 2, mismatches: 0 (0 on proposed rulings, 1 designed, 0 designed-agreed), errors: 0, exit code: 0'));
        assert.ok(redMarkdown.includes('## commit-and-push-at-section-close / narrow: designed'));
        assert.ok(redMarkdown.includes('- Designed to read against the answer: ' + slug));

        // The prompt is composed of the scenario, the options and the files, so
        // neither the key nor its value is in anything the reader holds. A reader
        // told which reading is expected confirms it.
        assert.strictEqual(prompts.length, 2);
        for (const prompt of prompts) {
            assert.ok(!prompt.includes('designed-mismatch'), 'the key reached the reader');
            assert.ok(!prompt.includes(slug), 'the slug reached the reader');
        }
        // The control: what the prompt does carry, from the same probe.
        assert.ok(prompts[1].includes(marked.scenario.trim()));
        assert.ok(prompts[1].includes('the copy that dropped the exception'));

        // The agreement is the finding: a red that stopped being red counts.
        const agreed = await runProbes([marked], {
            repoRoot: root, runDir: path.join(root, 'run-agreed'), templatePath: TEMPLATE, configDir: false,
            invoke: answer(() => MATCHING_REPLY)
        });
        assert.deepStrictEqual(agreed.pairs.map((p) => p.status), ['match', 'designed-agreed']);
        assert.strictEqual(agreed.designed, 0);
        assert.strictEqual(agreed.designedAgreed, 1, 'the finding is a count in the report, not only a warning sentence');
        assert.strictEqual(red.designedAgreed, 0, 'the control: the run whose designed shape disagreed carries none');
        assert.strictEqual(agreed.mismatches, 1);
        assert.strictEqual(agreed.exitCode, 1);
        assert.strictEqual(
            JSON.parse(fs.readFileSync(path.join(root, 'run-agreed', 'report.json'), 'utf8')).designedAgreed, 1,
            'and it is on disk beside `designed`');
        const agreedMarkdown = fs.readFileSync(path.join(root, 'run-agreed', 'report.md'), 'utf8');
        assert.ok(agreedMarkdown.includes('- WARNING: 1 pair on a shape built to read against the answer agreed with it'));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a dry run composes every prompt, invokes no reader and exits zero', async () => {
    const root = makeHarness([{
        moment: 'dry-moment', verdict: 'RESOLVED', answer: 'commit-and-push',
        options: ['commit-and-push', 'ask-first'],
        shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }, { name: 'narrow', files: [CORPUS + 'a.md'] }],
        scenario: 'A section is green under a Commit-and-Push header.'
    }], { 'a.md': 'commit and push are the default' });
    try {
        const run = runHarness(root, ['--dry-run'], { default: MATCHING_REPLY, rules: [] });
        assert.strictEqual(run.status, 0, run.stderr);
        assert.deepStrictEqual(run.report.pairs.map((p) => p.status), ['dry-run', 'dry-run']);
        assert.ok(fs.readFileSync(run.report.pairs[0].promptPath, 'utf8').includes('commit and push are the default'));
        assert.strictEqual(fs.existsSync(path.join(run.runDir, 'shapes', 'dry-moment', 'full', 'reply.txt')), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('--only and --shape narrow the run to the named pair', async () => {
    const root = makeHarness([
        {
            moment: 'first-moment', verdict: 'RESOLVED', answer: 'commit-and-push',
            options: ['commit-and-push', 'ask-first'],
            shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }, { name: 'narrow', files: [CORPUS + 'a.md'] }],
            scenario: 'One.'
        },
        {
            moment: 'second-moment', verdict: 'RESOLVED', answer: 'commit-and-push',
            options: ['commit-and-push', 'ask-first'],
            shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }, { name: 'narrow', files: [CORPUS + 'a.md'] }],
            scenario: 'Two.'
        }
    ], { 'a.md': 'commit and push are the default' });
    try {
        const run = runHarness(root, ['--only', 'second-moment', '--shape', 'narrow'], { default: MATCHING_REPLY, rules: [] });
        assert.strictEqual(run.status, 0, run.stderr);
        assert.strictEqual(run.report.pairs.length, 1);
        assert.strictEqual(run.report.pairs[0].moment, 'second-moment');
        assert.strictEqual(run.report.pairs[0].shape, 'narrow');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// A shape naming a file this tree does not carry still has a reading to give,
// and it is the same reading a `--before` run gives: the reader is told the
// file is not in the set. A probe whose narrow shape reaches a file the
// checkout has not written yet is the case that wants it.
test('a shape file missing from the worktree is an absence row rather than a stopped run', async () => {
    const root = makeHarness([{
        moment: 'missing-file', verdict: 'RESOLVED', answer: 'commit-and-push',
        options: ['commit-and-push', 'ask-first'],
        shapes: [{ name: 'full', files: [CORPUS + 'nowhere.md', CORPUS + 'a.md'] }, { name: 'narrow', files: [CORPUS + 'a.md'] }],
        scenario: 'One.'
    }], { 'a.md': 'commit and push are the default' });
    try {
        const run = runHarness(root, [], { default: MATCHING_REPLY, rules: [] });
        assert.strictEqual(run.status, 0, run.stderr);
        const absent = run.report.pairs[0].files.find((f) => f.path === CORPUS + 'nowhere.md');
        assert.deepStrictEqual({ source: absent.source, absent: absent.absent }, { source: 'worktree', absent: true });
        assert.ok(fs.readFileSync(run.report.pairs[0].promptPath, 'utf8')
            .includes(CORPUS + 'nowhere.md (this file does not exist in the set)'));
        assert.ok(fs.readFileSync(path.join(run.runDir, 'report.md'), 'utf8')
            .includes(CORPUS + 'nowhere.md (absent at the worktree)'));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// A path that escapes the tree is the other half of the same rule, and it is a
// refusal rather than an absence: the run stops, before the run directory
// exists, so no evidence artifact is left claiming a reading.
test('a shape file that escapes the repository stops the run and writes no report', async () => {
    const { runProbes } = await loadRunner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-escape-'));
    try {
        const repoRoot = path.join(dir, 'repo');
        const runDir = path.join(dir, 'run');
        fs.mkdirSync(path.join(repoRoot, ...CORPUS_SEGMENTS), { recursive: true });
        fs.writeFileSync(path.join(repoRoot, ...CORPUS_SEGMENTS, 'a.md'), 'alpha');
        fs.writeFileSync(path.join(dir, 'outside.md'), 'a file the corpus has no business reading');
        let invoked = 0;
        await assert.rejects(() => runProbes([probe({
            shapes: [
                { name: 'full', files: [CORPUS + 'a.md'] },
                { name: 'escaping', files: [CORPUS + '../../../../outside.md'] }
            ]
        })], {
            repoRoot,
            runDir,
            templatePath: TEMPLATE,
            configDir: false,
            invoke: () => { invoked += 1; return { ok: true, text: MATCHING_REPLY, raw: MATCHING_REPLY, costUsd: 0, durationMs: 1 }; }
        }), /outside\.md is refused: it carries a "\.\." segment/);
        assert.strictEqual(invoked, 0, 'no reader was invoked');
        assert.strictEqual(fs.existsSync(runDir), false, 'no evidence artifact is left claiming a reading');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// The exit code counts mismatches; an error is the absence of a reading and
// rides in its own count, in the report and in a loud warning, so a run that
// could not authenticate never reads as a green corpus.
test('a run whose reader fails exits zero, says so on stderr and counts the errors apart', async () => {
    const root = makeHarness([{
        moment: 'error-moment', verdict: 'RESOLVED', answer: 'commit-and-push',
        options: ['commit-and-push', 'ask-first'],
        shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }, { name: 'narrow', files: [CORPUS + 'a.md'] }],
        scenario: 'One.'
    }], { 'a.md': 'commit and push are the default' });
    try {
        // The fake reader answers with the JSON the CLI writes when it cannot
        // authenticate: a nonzero exit carrying the reason.
        fs.writeFileSync(path.join(root, 'fake-claude.mjs'), [
            "import fs from 'node:fs';",
            "fs.readFileSync(0, 'utf8');",
            "process.stdout.write(JSON.stringify({ is_error: true, result: 'Failed to authenticate: OAuth session expired' }));",
            'process.exit(1);'
        ].join('\n'), 'utf8');
        const run = runHarness(root, [], { default: MATCHING_REPLY, rules: [] });
        assert.strictEqual(run.status, 0, 'errors never enter the exit code');
        assert.strictEqual(run.report.errors, 2);
        assert.strictEqual(run.report.mismatches, 0);
        assert.deepStrictEqual(run.report.pairs.map((p) => p.status), ['ERROR', 'ERROR']);
        assert.match(run.stderr, /WARNING: 2 pairs produced no reading at all/);
        assert.match(run.stdout.trim(), /^probe-corpus: 2 pairs, 0 mismatches \(0 on proposed rulings, 0 designed\), 2 errors, exit 0, tier sonnet, report /);
        const md = fs.readFileSync(path.join(run.runDir, 'report.md'), 'utf8');
        assert.ok(md.includes('errors: 2'), 'the report carries the error count in its own field');
        assert.ok(md.includes('- WARNING: 2 pairs produced no reading at all.'));
        assert.ok(md.includes('OAuth session expired'), 'the reason the reader gave is in the report');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// A run that throws part way through still leaves the readings it took: the
// report is rewritten after every pair rather than once at the end.
test('the report on disk holds the pairs already read when a run dies mid-set', async () => {
    const { runProbes } = await loadRunner();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-partial-'));
    try {
        fs.mkdirSync(path.join(root, ...CORPUS_SEGMENTS), { recursive: true });
        fs.writeFileSync(path.join(root, ...CORPUS_SEGMENTS, 'a.md'), 'alpha');
        fs.writeFileSync(path.join(root, ...CORPUS_SEGMENTS, 'b.md'), 'beta');
        const runDir = path.join(root, 'run');
        let call = 0;
        await assert.rejects(() => runProbes([probe()], {
            repoRoot: root,
            runDir,
            templatePath: TEMPLATE,
            configDir: false,
            invoke: () => {
                call += 1;
                if (call === 1) return { ok: true, text: MATCHING_REPLY, raw: MATCHING_REPLY, costUsd: 0.01, durationMs: 20 };
                throw new Error('the reader host went away');
            }
        }), /the reader host went away/);
        const partial = JSON.parse(fs.readFileSync(path.join(runDir, 'report.json'), 'utf8'));
        assert.strictEqual(partial.pairs.length, 1);
        assert.strictEqual(partial.pairs[0].status, 'match');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// A file the worktree does not carry is an absence; a file it will not let this
// process read is a fault in the run. Reading every lstat failure as an absence
// hands the reader a document set short of a file and calls the reading a result,
// which is the same fault a git failure read as an absence would be under
// --before.
test('a worktree read fails the run on anything but the tree not carrying the path', async () => {
    const { runProbes, readShapeFile } = await loadRunner();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-lstat-'));
    try {
        fs.mkdirSync(path.join(root, ...CORPUS_SEGMENTS), { recursive: true });
        fs.writeFileSync(path.join(root, ...CORPUS_SEGMENTS, 'a.md'), 'alpha');
        const ctx = { repoRoot: root, homeDir: path.join(root, 'home'), before: null };

        // Absence, both of its shapes: nothing at the name, and a name reached
        // through a file the platform will not walk into.
        assert.strictEqual(readShapeFile(CORPUS + 'nowhere.md', ctx).absent, true);
        assert.strictEqual(readShapeFile(CORPUS + 'a.md/inner.md', ctx).absent, true,
            'a path under a regular file is the tree not carrying it (ENOTDIR, or ENOENT where the platform says so)');

        // A name the platform refuses to stat at all, which is neither of those:
        // the run stops and says which read failed and why. A path carrying a
        // NUL is the instance every platform refuses; a permission refusal
        // (EACCES) and a symlink loop (ELOOP) reach this same branch by the same
        // rule, and producing either here would mean writing an access control
        // list or a loop this suite has no business leaving on the box.
        const unreadable = CORPUS + 'a\u0000b.md';
        assert.throws(() => readShapeFile(unreadable, ctx), /reading .* failed \(/);
        let invoked = 0;
        await assert.rejects(() => runProbes([probe({
            shapes: [
                { name: 'full', files: [CORPUS + 'a.md'] },
                { name: 'narrow', files: [unreadable] }
            ]
        })], {
            repoRoot: root,
            runDir: path.join(root, 'run'),
            templatePath: TEMPLATE,
            configDir: false,
            invoke: () => { invoked += 1; return { ok: true, text: MATCHING_REPLY, raw: MATCHING_REPLY, costUsd: null, durationMs: 1 }; }
        }), /reading .* failed \(/);
        assert.strictEqual(invoked, 0, 'the run stops before any reader is paid for');
        assert.strictEqual(fs.existsSync(path.join(root, 'run')), false, 'and before the run directory exists');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// A moment named on the command line that no probe carries is a typo, and a
// run that quietly reads the rest of the set reports a green corpus the caller
// never asked about.
test('--only naming a moment the set does not carry is refused by name', async () => {
    const root = makeHarness([{
        moment: 'first-moment', verdict: 'RESOLVED', answer: 'commit-and-push',
        options: ['commit-and-push', 'ask-first'],
        shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }, { name: 'narrow', files: [CORPUS + 'a.md'] }],
        scenario: 'One.'
    }], { 'a.md': 'commit and push are the default' });
    try {
        const run = runHarness(root, ['--only', 'first-moment,no-such-moment'], { default: MATCHING_REPLY, rules: [] });
        assert.strictEqual(run.status, 101, run.stdout);
        assert.match(run.stderr, /--only named "no-such-moment" and the probe set carries no such moment/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// The other way a named moment can go missing from a run: it is in the set, and
// `--shape` takes every one of its shapes. The run would read the other moments
// and report on a corpus the caller never asked about, which is what the
// misspelled moment above is refused for.
test('--only naming a moment that --shape leaves with no pair is refused by name', async () => {
    const root = makeHarness([
        {
            moment: 'first-moment', verdict: 'RESOLVED', answer: 'commit-and-push',
            options: ['commit-and-push', 'ask-first'],
            shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }, { name: 'narrow', files: [CORPUS + 'a.md'] }],
            scenario: 'One.'
        },
        {
            moment: 'second-moment', verdict: 'RESOLVED', answer: 'commit-and-push',
            options: ['commit-and-push', 'ask-first'],
            shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }, { name: 'other', files: [CORPUS + 'a.md'] }],
            scenario: 'Two.'
        }
    ], { 'a.md': 'commit and push are the default' });
    try {
        const run = runHarness(root, ['--only', 'first-moment,second-moment', '--shape', 'narrow'],
            { default: MATCHING_REPLY, rules: [] });
        assert.strictEqual(run.status, 101, run.stdout);
        assert.match(run.stderr, /--only named "second-moment" and no shape of it is named "narrow"/);
        assert.strictEqual(run.observed.length, 0, 'no reader was paid for');
        // The control: the same selection over a shape both moments carry runs.
        const both = runHarness(root, ['--only', 'first-moment,second-moment', '--shape', 'full'],
            { default: MATCHING_REPLY, rules: [] });
        assert.strictEqual(both.status, 0, both.stderr);
        assert.strictEqual(both.report.pairs.length, 2);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// `runProbes` takes probes as objects, so a library caller composing its own
// never passes the parser that holds a moment and a shape name to a slug and a
// tier to the two the reader accepts. Each of the three reaches somewhere it has
// to be safe: the first two are joined into the run directory as directory
// components, and the tier is handed to the reader as its model.
test('a moment, a shape name and a tier are held to the parser\'s own vocabularies at the library entry', async () => {
    const { runProbes, refuseUnsafeProbeFields } = await loadRunner();
    const escaping = { moment: '../../..', tier: 'sonnet', shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }] };
    assert.throws(() => refuseUnsafeProbeFields(escaping), /probe moment "\.\.\/\.\.\/\.\." is refused/);
    assert.throws(() => refuseUnsafeProbeFields({ moment: 'a-moment', tier: 'opus', shapes: [{ name: '../../..', files: [] }] }),
        /shape name "\.\.\/\.\.\/\.\." in probe a-moment is refused/);
    assert.throws(() => refuseUnsafeProbeFields({ moment: 'a-moment', tier: 'opus --dangerously-skip-permissions', shapes: [] }),
        /the tier "opus --dangerously-skip-permissions" in probe a-moment is refused/);
    // The control: the probe every other case here is built from passes.
    assert.doesNotThrow(() => refuseUnsafeProbeFields(probe()));

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-fields-'));
    try {
        fs.mkdirSync(path.join(root, ...CORPUS_SEGMENTS), { recursive: true });
        fs.writeFileSync(path.join(root, ...CORPUS_SEGMENTS, 'a.md'), 'alpha');
        await assert.rejects(() => runProbes([probe({ moment: '../../..' })], {
            repoRoot: root, runDir: path.join(root, 'run'), templatePath: TEMPLATE, configDir: false,
            invoke: () => { throw new Error('a reader was spawned for a refused probe'); }
        }), /probe moment "\.\.\/\.\.\/\.\." is refused/);
        assert.strictEqual(fs.existsSync(path.join(root, 'run')), false, 'nothing was written under the run directory');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// The same refusal on a probe that came off disk through a parser that does not
// hold the field itself, which is the shape the CLI runs under when the probe
// file is not the one this repository's parser wrote.
test('a probe file whose moment navigates is refused by name before any reader runs', async () => {
    const root = makeHarness([{
        moment: 'first-moment', verdict: 'RESOLVED', answer: 'commit-and-push',
        options: ['commit-and-push', 'ask-first'],
        shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }, { name: 'narrow', files: [CORPUS + 'a.md'] }],
        scenario: 'One.'
    }], { 'a.md': 'commit and push are the default' });
    try {
        fs.writeFileSync(path.join(root, 'test', 'probes', 'escaping.md'), probeFixture({
            moment: '../../..', verdict: 'RESOLVED', answer: 'commit-and-push',
            options: ['commit-and-push', 'ask-first'],
            shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }, { name: 'narrow', files: [CORPUS + 'a.md'] }],
            scenario: 'Two.'
        }), 'utf8');
        const run = runHarness(root, [], { default: MATCHING_REPLY, rules: [] });
        assert.strictEqual(run.status, 101, run.stdout);
        assert.match(run.stderr, /probe moment "\.\.\/\.\.\/\.\." is refused/);
        assert.strictEqual(run.observed.length, 0, 'no reader ran, the good probe in the set included');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// The exit code is a gate reading, and a probe whose ruling the operator has not
// settled has no gate reading to give: its disagreement is reported on the
// summary line, in the report and in a warning, and stays out of the code.
test('a mismatch on a proposed ruling is reported and a mismatch on a ruled one is counted', async () => {
    const root = makeHarness([
        {
            moment: 'ruled-moment', ruling: 'ruled', verdict: 'RESOLVED', answer: 'ask-first',
            options: ['commit-and-push', 'ask-first'],
            shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }],
            scenario: 'One.'
        },
        {
            moment: 'proposed-moment', ruling: 'proposed', verdict: 'RESOLVED', answer: 'ask-first',
            options: ['commit-and-push', 'ask-first'],
            shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }],
            scenario: 'Two.'
        }
    ], { 'a.md': 'commit and push are the default' });
    try {
        const run = runHarness(root, [], { default: MATCHING_REPLY, rules: [] });
        assert.strictEqual(run.status, 1, run.stderr);
        assert.deepStrictEqual(run.report.pairs.map((p) => p.status), ['mismatch', 'mismatch']);
        assert.strictEqual(run.report.mismatches, 1);
        assert.strictEqual(run.report.proposedMismatches, 1);
        assert.strictEqual(run.report.exitCode, 1);
        const states = run.report.pairs.map((p) => p.moment + ': ' + p.ruling.state);
        assert.deepStrictEqual(states.sort(), ['proposed-moment: proposed', 'ruled-moment: ruled'],
            'every row carries the ruling state its counting rests on');
        assert.match(run.stdout.trim(), /^probe-corpus: 2 pairs, 1 mismatches \(1 on proposed rulings, 0 designed\), 0 errors, exit 1, /);
        const md = fs.readFileSync(path.join(run.runDir, 'report.md'), 'utf8');
        assert.ok(md.includes('- Pairs: 2, mismatches: 1 (1 on proposed rulings, 0 designed, 0 designed-agreed), errors: 0, exit code: 1'));
        assert.ok(md.includes('- WARNING: 1 pair disagreed with a ruling the operator has not settled.'));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// A run that dies part way through has readings on disk and no report.md, and a
// caller that sees nothing on stdout cannot tell it from a run that never
// started. The summary line prints over the pairs it read, naming report.json
// and marked partial.
test('a run that dies mid-set still prints its summary over the pairs it read', async () => {
    const root = makeHarness([{
        moment: 'dying-moment', verdict: 'RESOLVED', answer: 'commit-and-push',
        options: ['commit-and-push', 'ask-first'],
        shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }, { name: 'narrow', files: [CORPUS + 'a.md'] }],
        scenario: 'One.'
    }], { 'a.md': 'commit and push are the default' });
    try {
        const run = runHarness(root, [], { default: MATCHING_REPLY, rules: [] }, { FAKE_BLOCK_REPLY: '2' });
        assert.strictEqual(run.status, 101, run.stdout + run.stderr);
        assert.strictEqual(run.report.pairs.length, 1, 'the reading taken before the failure is on disk');
        assert.strictEqual(run.report.pairs[0].status, 'match');
        assert.strictEqual(fs.existsSync(path.join(run.runDir, 'report.md')), false, 'no report.md is written');
        assert.match(run.stdout.trim(),
            /^probe-corpus: 1 pairs, 0 mismatches \(0 on proposed rulings, 0 designed\), 0 errors, exit 0, tier sonnet, report \.kit\/probe-runs\/[^/]+\/report\.json \(partial\)$/);
        assert.ok(run.stderr.trim().length > 0, 'the failure itself is on stderr');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// The caller's Ctrl+C reaches the reader while the pair loop holds the process,
// so a run that read the interruption only through its own signal handler would
// spawn every remaining reader before the handler could run. The run stops at the
// pair it reached instead.
test('an interrupted reader stops the run, and the pairs after it are never spawned', async () => {
    const root = makeHarness([{
        moment: 'interrupted-moment', verdict: 'RESOLVED', answer: 'commit-and-push',
        options: ['commit-and-push', 'ask-first'],
        shapes: [
            { name: 'full', files: [CORPUS + 'a.md'] },
            { name: 'narrow', files: [CORPUS + 'a.md'] },
            { name: 'narrower', files: [CORPUS + 'a.md'] }
        ],
        scenario: 'One.'
    }], { 'a.md': 'commit and push are the default' });
    try {
        const run = runHarness(root, [], { default: MATCHING_REPLY, rules: [] }, { FAKE_INTERRUPT_AT: '2' });
        assert.strictEqual(run.status, 101, run.stdout + run.stderr);
        assert.strictEqual(run.observed.length, 2, 'the reader after the interrupted one was never spawned');
        assert.deepStrictEqual(run.report.pairs.map((p) => p.status), ['match', 'ERROR']);
        assert.match(run.report.pairs[1].error, /the reader was interrupted/);
        assert.match(run.stderr, /the run was interrupted before interrupted-moment \/ narrow could be read/);
        assert.match(run.stdout.trim(),
            /^probe-corpus: 2 pairs, 0 mismatches \(0 on proposed rulings, 0 designed\), 1 errors, exit 0, tier sonnet, report \.kit\/probe-runs\/[^/]+\/report\.json \(partial\)$/);
        assert.strictEqual(fs.existsSync(path.join(run.runDir, 'report.md')), false, 'no report.md is written');
        // The credential copy went with the run, interruption or not.
        assert.strictEqual(fs.existsSync(run.observed[0].configDir), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// The other side of that reading, through the same spawn: a reader whose reply
// passes the reply cap is killed by this runner, and spawnSync reports the kill
// as an ENOBUFS error carrying a signal. A run that read a signal alone as the
// caller's Ctrl+C would stop the whole paid set on one talkative reader, so the
// oversized pair is an ERROR like any other and every pair after it still runs.
test('a reply past the reply cap is one ERROR pair and the run reads the rest of the set', async () => {
    const root = makeHarness([{
        moment: 'oversized-moment', verdict: 'RESOLVED', answer: 'commit-and-push',
        options: ['commit-and-push', 'ask-first'],
        shapes: [
            { name: 'full', files: [CORPUS + 'a.md'] },
            { name: 'narrow', files: [CORPUS + 'a.md'] }
        ],
        scenario: 'One.'
    }], { 'a.md': 'commit and push are the default' });
    try {
        const run = runHarness(root, [], { default: MATCHING_REPLY, rules: [] }, { FAKE_OVERSIZED_AT: '1' });
        assert.strictEqual(run.observed.length, 2, 'the reader after the oversized one was spawned');
        assert.deepStrictEqual(run.report.pairs.map((p) => p.status), ['ERROR', 'match']);
        assert.match(run.report.pairs[0].error, /reader did not complete/);
        assert.doesNotMatch(run.report.pairs[0].error, /interrupted/,
            'the kill was this runner\'s own, so the run never read it as the caller stopping it');
        assert.strictEqual(run.report.errors, 1);
        assert.strictEqual(run.status, 0, 'an error is the absence of a reading, not a mismatch: ' + run.stderr);
        assert.ok(fs.existsSync(path.join(run.runDir, 'report.md')), 'the run finished the set and wrote report.md');
        assert.match(run.stdout.trim(),
            /^probe-corpus: 2 pairs, 0 mismatches \(0 on proposed rulings, 0 designed\), 1 errors, exit 0, tier sonnet, report \.kit\/probe-runs\/[^/]+\/report\.md$/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function git(root, args) {
    const res = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.strictEqual(res.status, 0, 'git ' + args.join(' ') + ': ' + res.stderr);
    return res.stdout;
}

test('--before reads the ref, reproduces a tracked file byte for byte and records a path the ref does not carry', async () => {
    const root = makeHarness([{
        moment: 'ref-moment', verdict: 'RESOLVED', answer: 'commit-and-push',
        options: ['commit-and-push', 'ask-first'],
        shapes: [{ name: 'full', files: [CORPUS + 'a.md', CORPUS + 'later.md'] }],
        scenario: 'One.'
    }], { 'a.md': 'commit and push are the default\n' });
    try {
        git(root, ['init', '--quiet']);
        git(root, ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'add', CORPUS + 'a.md']);
        git(root, ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '--quiet', '-m', 'corpus']);
        // A file the worktree carries and the committed tree does not.
        fs.writeFileSync(path.join(root, ...CORPUS_SEGMENTS, 'later.md'), 'a passage added after the commit\n');

        const worktreeRun = runHarness(root, [], { default: MATCHING_REPLY, rules: [] });
        assert.strictEqual(worktreeRun.status, 0, worktreeRun.stderr);
        const beforeRun = runHarness(root, ['--before', 'HEAD'], { default: MATCHING_REPLY, rules: [] });
        assert.strictEqual(beforeRun.status, 0, beforeRun.stderr);

        const fromWorktree = fs.readFileSync(path.join(worktreeRun.runDir, 'shapes', 'ref-moment', 'full', ...CORPUS_SEGMENTS, 'a.md'));
        const fromRef = fs.readFileSync(path.join(beforeRun.runDir, 'shapes', 'ref-moment', 'full', ...CORPUS_SEGMENTS, 'a.md'));
        assert.ok(fromWorktree.equals(fromRef), 'the ref copy of a tracked file equals the worktree copy byte for byte');

        const worktreeLater = worktreeRun.report.pairs[0].files.find((f) => f.path === CORPUS + 'later.md');
        const refLater = beforeRun.report.pairs[0].files.find((f) => f.path === CORPUS + 'later.md');
        assert.deepStrictEqual({ source: worktreeLater.source, absent: worktreeLater.absent }, { source: 'worktree', absent: false });
        assert.deepStrictEqual({ source: refLater.source, absent: refLater.absent }, { source: 'ref', absent: true });
        assert.ok(fs.readFileSync(beforeRun.report.pairs[0].promptPath, 'utf8').includes(CORPUS + 'later.md (this file does not exist in the set)'));
        assert.ok(fs.readFileSync(path.join(beforeRun.runDir, 'report.md'), 'utf8').includes(CORPUS + 'later.md (absent at HEAD)'));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// The allowlist at the read boundary, through a whole run: neither spelling
// navigates anywhere, so nothing but the two allowed roots keeps a shape from
// naming the operator's credentials or the repository's own git configuration
// and handing either to a reader as corpus text.
test('a shape naming a credentials file or a repository internal stops the run before either is read', async () => {
    for (const [moment, entry] of [['home-credentials', 'home/.credentials.json'], ['git-config', '.git/config']]) {
        const root = makeHarness([{
            moment, verdict: 'RESOLVED', answer: 'commit-and-push',
            options: ['commit-and-push', 'ask-first'],
            shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }, { name: 'reaching', files: [entry] }],
            scenario: 'One.'
        }], { 'a.md': 'commit and push are the default' });
        try {
            fs.mkdirSync(path.join(root, '.git'), { recursive: true });
            fs.writeFileSync(path.join(root, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n', 'utf8');
            const run = runHarness(root, [], { default: MATCHING_REPLY, rules: [] });
            assert.strictEqual(run.status, 101, run.stdout);
            assert.ok(run.stderr.includes('shape file ' + entry + ' is refused'), run.stderr);
            assert.strictEqual(fs.existsSync(path.join(root, '.kit', 'probe-runs')), false,
                'no evidence artifact is left claiming a reading');
            assert.strictEqual(run.observed.length, 0, 'no reader was invoked');
            assert.strictEqual(fs.readFileSync(path.join(root, 'home', '.credentials.json'), 'utf8'),
                FIXTURE_CREDENTIALS, 'the credentials file is where it was, unread by any reader');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    }
});

// Under --before the escaping path never reaches git, which resolves such an
// argument without reading the file the shape named and exits zero, and never
// reaches the scratch write, whose join normalises out of the run directory and
// writes an empty buffer over whatever is there.
test('a shape path that navigates stops a --before run before git or the run directory', async () => {
    // The file the escaping path aims at lives in this case's own directory
    // rather than at a fixed name in the shared temp root, where a concurrent
    // run of this same case would be writing and deleting the same file.
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-outside-'));
    const outsideFile = path.join(outsideRoot, 'outside-probe-guard.md');
    const OUTSIDE_TEXT = 'a file the corpus has no business reading';
    fs.writeFileSync(outsideFile, OUTSIDE_TEXT, 'utf8');
    // Out of the corpus directory, out of the plugin root, out of the repository
    // and into the sibling directory beside it.
    const escaping = CORPUS + '../../../../' + path.basename(outsideRoot) + '/outside-probe-guard.md';
    const root = makeHarness([{
        moment: 'escaping-moment', verdict: 'RESOLVED', answer: 'commit-and-push',
        options: ['commit-and-push', 'ask-first'],
        shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }, { name: 'escaping', files: [escaping] }],
        scenario: 'One.'
    }], { 'a.md': 'commit and push are the default\n' });
    try {
        assert.strictEqual(path.resolve(root, escaping), path.resolve(outsideFile),
            'the escaping path names the file outside the repository');
        git(root, ['init', '--quiet']);
        git(root, ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'add', CORPUS + 'a.md']);
        git(root, ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '--quiet', '-m', 'corpus']);
        for (const args of [[], ['--before', 'HEAD']]) {
            const run = runHarness(root, args, { default: MATCHING_REPLY, rules: [] });
            assert.strictEqual(run.status, 101, run.stdout);
            assert.ok(run.stderr.includes(escaping + ' is refused: it carries a ".." segment'), run.stderr);
            assert.strictEqual(fs.existsSync(path.join(root, '.kit', 'probe-runs')), false,
                'no evidence artifact is left claiming a reading');
            assert.strictEqual(run.observed.length, 0, 'no reader was invoked');
        }
        assert.strictEqual(fs.readFileSync(outsideFile, 'utf8'), OUTSIDE_TEXT,
            'the file outside the run directory is untouched');
    } finally {
        fs.rmSync(outsideRoot, { recursive: true, force: true });
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// The credential source is rewritten by another process as its token rotates, so
// a read of it can fail transiently. Abandoning a paid run part way through over
// one failed read costs more than reading against a copy one refresh old: the
// copy stays, the pair says so, and a copy whose token has actually rotated
// fails that pair as an ERROR the report already carries.
test('a credential refresh that fails mid-run keeps the copy and records it on the pair', async () => {
    const { runProbes } = await loadRunner();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-refresh-'));
    try {
        fs.mkdirSync(path.join(root, ...CORPUS_SEGMENTS), { recursive: true });
        fs.writeFileSync(path.join(root, ...CORPUS_SEGMENTS, 'a.md'), 'alpha');
        fs.writeFileSync(path.join(root, ...CORPUS_SEGMENTS, 'b.md'), 'beta');
        const home = path.join(root, 'home');
        const tmpRoot = path.join(root, 'tmp');
        fs.mkdirSync(home);
        fs.mkdirSync(tmpRoot);
        fs.writeFileSync(path.join(home, '.credentials.json'), '{"token":"fixture-home-only"}');
        const seen = [];
        const report = await runProbes([probe()], {
            repoRoot: root,
            runDir: path.join(root, 'run'),
            templatePath: TEMPLATE,
            homeDir: home,
            tmpRoot,
            invoke: (bin, tier, prompt, opts) => {
                seen.push(fs.readFileSync(path.join(opts.configDir, '.credentials.json'), 'utf8'));
                // The source goes away between the two pairs, as a rotation
                // rewriting it in place can for the moment of a read.
                fs.rmSync(path.join(home, '.credentials.json'), { force: true });
                return { ok: true, text: MATCHING_REPLY, raw: MATCHING_REPLY, costUsd: 0.01, durationMs: 20 };
            }
        });
        assert.deepStrictEqual(report.pairs.map((p) => p.status), ['match', 'match'], 'the run finished');
        assert.strictEqual(report.pairs[0].credentialRefreshError, null);
        assert.match(report.pairs[1].credentialRefreshError, /could not be read/);
        assert.match(report.pairs[1].credentialRefreshError, /read against the copy already in the scratch/);
        assert.deepStrictEqual(seen, ['{"token":"fixture-home-only"}', '{"token":"fixture-home-only"}'],
            'the second reader authenticated from the copy the first one used');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// The first copy is the other case: with no credential at all no reader in the
// run can authenticate, and a run of ERROR rows reads like the corpus moving
// under every probe at once, so that failure stops the run.
test('a run whose first credential copy fails stops before any pair', async () => {
    const { runProbes } = await loadRunner();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-nocreds-'));
    try {
        fs.mkdirSync(path.join(root, ...CORPUS_SEGMENTS), { recursive: true });
        fs.writeFileSync(path.join(root, ...CORPUS_SEGMENTS, 'a.md'), 'alpha');
        fs.writeFileSync(path.join(root, ...CORPUS_SEGMENTS, 'b.md'), 'beta');
        const home = path.join(root, 'home');
        const tmpRoot = path.join(root, 'tmp');
        fs.mkdirSync(home);
        fs.mkdirSync(tmpRoot);
        let invoked = 0;
        await assert.rejects(() => runProbes([probe()], {
            repoRoot: root,
            runDir: path.join(root, 'run'),
            templatePath: TEMPLATE,
            homeDir: home,
            tmpRoot,
            invoke: () => { invoked += 1; return { ok: true, text: MATCHING_REPLY, raw: MATCHING_REPLY, costUsd: 0, durationMs: 1 }; }
        }), /no reader in this run could authenticate/);
        assert.strictEqual(invoked, 0);
        assert.deepStrictEqual(fs.readdirSync(tmpRoot), [], 'the half-made scratch is removed');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a --before ref this repository does not carry is refused by name', async () => {
    const root = makeHarness([{
        moment: 'ref-moment', verdict: 'RESOLVED', answer: 'commit-and-push',
        options: ['commit-and-push', 'ask-first'],
        shapes: [{ name: 'full', files: [CORPUS + 'a.md'] }],
        scenario: 'One.'
    }], { 'a.md': 'commit and push are the default\n' });
    try {
        git(root, ['init', '--quiet']);
        git(root, ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'add', CORPUS + 'a.md']);
        git(root, ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '--quiet', '-m', 'corpus']);
        const run = runHarness(root, ['--before', 'no-such-ref'], { default: MATCHING_REPLY, rules: [] });
        assert.strictEqual(run.status, 101, run.stderr);
        assert.match(run.stderr, /"no-such-ref" is not a commit in this repository/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
