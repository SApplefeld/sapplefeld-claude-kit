// Tests for plugins/claude-kit/hooks/kit-git-lib.js, the shared git runner every
// kit hook's git calls run through.
//
// Node's built-in test runner, no framework. The subject is the two properties
// that make a git spawn safe to point at a directory nobody has read, and the
// failure discipline the callers depend on. Both properties are driven
// observably rather than read off the source: a repository that plants an
// executable named git is answered by the real git, and a parent environment
// whose GIT_DIR names another repository is answered about the repository the
// call named. Each is paired with a control that shows the planted binary and
// the ambient variable DO redirect a spawn that lacks the property, since an
// absence check with nothing to catch reads exactly like a passing one.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const LIB = path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'kit-git-lib.js');
const HOOKS_DIR = path.dirname(LIB);
const { gitRun, gitOutput, gitChildEnv } = require(LIB);

// The environment the fixture's own git commands run under: this machine's,
// with every GIT_* variable dropped and an identity and config of the fixture's
// own, so a case's history does not depend on the operator's git identity or on
// whatever the session running the suite carries. The config files are named
// inside the case's own temp directory rather than in the shared temp root,
// which is world-writable on POSIX: a fixed name there is one another local user
// can pre-create, and every fixture command would then run under a config
// somebody else wrote.
function gitEnv(dir) {
    const env = { ...process.env };
    for (const k of Object.keys(env)) {
        if (/^GIT_/i.test(k)) delete env[k];
    }
    env.GIT_AUTHOR_NAME = 'kit fixture';
    env.GIT_AUTHOR_EMAIL = 'fixture@example.invalid';
    env.GIT_COMMITTER_NAME = 'kit fixture';
    env.GIT_COMMITTER_EMAIL = 'fixture@example.invalid';
    env.GIT_CONFIG_GLOBAL = path.join(dir, 'absent.gitconfig');
    env.GIT_CONFIG_SYSTEM = path.join(dir, 'absent.gitconfig');
    return env;
}

function git(dir, args) {
    const res = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: gitEnv(dir) });
    assert.strictEqual(res.status, 0, 'git ' + args.join(' ') + ': ' + (res.stderr || res.error));
    return res.stdout.trim();
}

function makeDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmDir(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

// A repository that reports on being read: core.fsmonitor and core.hooksPath
// both point at scripts that append a line to a marker file kept outside the
// repository. git runs the fsmonitor command on a status and the pre-commit
// hook on a commit, so the two keys cover a read-shaped call and a write-shaped
// one. The marker path is baked into each script rather than passed through the
// environment, because the environment is exactly what the runner rewrites.
function plantRepo() {
    const dir = makeDir('kit-git-lib-planted-');
    const repo = path.join(dir, 'planted');
    const marker = path.join(dir, 'marker.txt');
    const sh = marker.replace(/\\/g, '/');
    fs.mkdirSync(repo, { recursive: true });
    git(repo, ['init', '-q', '.']);
    git(repo, ['config', 'user.email', 'planted@example.invalid']);
    git(repo, ['config', 'user.name', 'planted']);
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'a\n', 'utf8');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'seed']);
    fs.writeFileSync(path.join(repo, 'fsmonitor.sh'),
        '#!/bin/sh\nprintf \'fsmonitor\\n\' >> "' + sh + '"\nprintf \'/\\0\'\n', 'utf8');
    fs.mkdirSync(path.join(repo, 'planted-hooks'));
    fs.writeFileSync(path.join(repo, 'planted-hooks', 'pre-commit'),
        '#!/bin/sh\nprintf \'hookspath\\n\' >> "' + sh + '"\nexit 0\n', 'utf8');
    // Off Windows git runs only an executable hook and the fsmonitor exec
    // needs the bit too, or the control leg below reds for the wrong reason.
    if (process.platform !== 'win32') {
        fs.chmodSync(path.join(repo, 'fsmonitor.sh'), 0o755);
        fs.chmodSync(path.join(repo, 'planted-hooks', 'pre-commit'), 0o755);
    }
    // Set last, so the fixture's own commands above do not fire them.
    git(repo, ['config', 'core.fsmonitor', repo.replace(/\\/g, '/') + '/fsmonitor.sh']);
    git(repo, ['config', 'core.hooksPath', repo.replace(/\\/g, '/') + '/planted-hooks']);
    return { dir, repo, marker };
}

function markerLines(marker) {
    if (!fs.existsSync(marker)) return [];
    return fs.readFileSync(marker, 'utf8').split(/\r?\n/).filter((l) => l.length > 0);
}

// A repository with one commit, returning its directory and that commit's sha.
function makeRepo(prefix) {
    const dir = makeDir(prefix || 'kit-git-lib-repo-');
    git(dir, ['init', '-q', '.']);
    // The seed names the directory, so two fixtures built in the same second
    // are two commits: identical content under a fixed identity and timestamp
    // hashes to one sha, and a case comparing the two would compare nothing.
    fs.writeFileSync(path.join(dir, 'seed.txt'), dir + '\n', 'utf8');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'seed']);
    return { dir, sha: git(dir, ['rev-parse', 'HEAD']) };
}

// The repository a call names is the repository git answers about, which is
// what `-C <repoDir>` buys: the runner's own working directory is elsewhere, so
// without it every call would answer about the hooks directory instead.
test('the repository named in the call is the one git answers about', () => {
    const one = makeRepo();
    const two = makeRepo();
    try {
        assert.strictEqual(gitOutput(one.dir, ['rev-parse', 'HEAD']).trim(), one.sha);
        assert.strictEqual(gitOutput(two.dir, ['rev-parse', 'HEAD']).trim(), two.sha);
        assert.notStrictEqual(one.sha, two.sha, 'two fixtures must not share a commit');
    } finally { rmDir(one.dir); rmDir(two.dir); }
});

// The spawn's working directory is the hooks directory and never the repository
// under inspection. On Windows a bare command name resolves against the spawn's
// working directory before the system PATH, so a repository holding a file
// named git.exe would otherwise run it, unattended, at session start.
test('an executable planted in the repository is not what runs', () => {
    const repo = makeRepo('kit-git-lib-plant-');
    try {
        const plant = path.join(repo.dir, process.platform === 'win32' ? 'git.exe' : 'git');
        fs.copyFileSync(process.execPath, plant);
        if (process.platform !== 'win32') fs.chmodSync(plant, 0o755);

        // A process carrying NoDefaultCurrentDirectoryInExePath is exempt from
        // the working-directory search, and the shell running this suite may
        // set it while a session started from a shortcut, PowerShell or Windows
        // Terminal does not. It is dropped here so the case runs in the
        // environment the hooks actually meet. The search reads it from the
        // spawning process's own environment, so dropping it in a child's would
        // change nothing.
        const suppressor = process.env.NoDefaultCurrentDirectoryInExePath;
        for (const k of Object.keys(process.env)) {
            if (/^NoDefaultCurrentDirectoryInExePath$/i.test(k)) delete process.env[k];
        }
        try {
            // The control: a spawn whose working directory IS the repository
            // runs the plant, which is node and says so. Windows alone searches
            // the working directory for a bare command name, so that is where
            // this control can speak; elsewhere it is inapplicable rather than
            // a pass.
            const control = spawnSync('git', ['-e', 'process.stdout.write("PLANT")'],
                { cwd: repo.dir, encoding: 'utf8' });
            if (process.platform === 'win32') {
                assert.strictEqual(control.stdout, 'PLANT',
                    'the planted binary was not reachable from a repository-rooted spawn, so the '
                    + 'assertion below would pass on a fixture that cannot fail');
            }

            // The runner, given the same repository, answers with the real
            // git's reading of it. Node would answer neither a sha nor an exit
            // 0 to this.
            assert.strictEqual(gitOutput(repo.dir, ['rev-parse', 'HEAD']).trim(), repo.sha);
        } finally {
            if (suppressor !== undefined) process.env.NoDefaultCurrentDirectoryInExePath = suppressor;
        }
    } finally { rmDir(repo.dir); }
});

// GIT_DIR in the ambient environment names the repository git reads, taking
// precedence over the -C the call passes. A session started from a repo-carried
// terminal profile carries whatever that repository set, so every GIT_* key is
// stripped from the child.
test('an ambient GIT_DIR cannot redirect a call at another repository', () => {
    const subject = makeRepo('kit-git-lib-subject-');
    const decoy = makeRepo('kit-git-lib-decoy-');
    const had = Object.prototype.hasOwnProperty.call(process.env, 'GIT_DIR');
    const previous = process.env.GIT_DIR;
    try {
        process.env.GIT_DIR = path.join(decoy.dir, '.git');

        // The control: the same variable does redirect a spawn that inherits it,
        // answering about the decoy while naming the subject.
        const control = spawnSync('git', ['-C', subject.dir, 'rev-parse', 'HEAD'],
            { cwd: HOOKS_DIR, encoding: 'utf8', env: { ...process.env } });
        assert.strictEqual(control.stdout.trim(), decoy.sha,
            'GIT_DIR did not redirect an unscrubbed spawn, so the assertion below '
            + 'would pass on a fixture that cannot fail');

        assert.strictEqual(gitOutput(subject.dir, ['rev-parse', 'HEAD']).trim(), subject.sha,
            'the call answered about the repository GIT_DIR named rather than the one it was given');
    } finally {
        if (had) process.env.GIT_DIR = previous; else delete process.env.GIT_DIR;
        rmDir(subject.dir);
        rmDir(decoy.dir);
    }
});

// core.fsmonitor and core.hooksPath are ordinary repo-local keys git honours on
// an ordinary read, so a status against a repository nobody has vetted runs that
// repository's code. The session-start hook asks exactly that of the store root
// before its ownership gate has decided the root is the kit's, so the runner
// pins both inert through git's environment-config channel, which beats
// repo-local config.
test('a planted repository cannot make a call through the runner run its own code', () => {
    const planted = plantRepo();
    try {
        // Direction one, the control: bare git, no pins. Both keys must speak
        // here, or their silence in direction two says nothing.
        const bareStatus = spawnSync('git', ['-C', planted.repo, 'status', '--porcelain'],
            { cwd: HOOKS_DIR, encoding: 'utf8', env: gitEnv(planted.dir) });
        assert.strictEqual(bareStatus.status, 0, bareStatus.stdout + bareStatus.stderr);
        assert.ok(markerLines(planted.marker).includes('fsmonitor'),
            'core.fsmonitor did not fire under bare git, so the fixture proves nothing: '
            + JSON.stringify(markerLines(planted.marker)));

        const bareCommit = spawnSync('git',
            ['-C', planted.repo, 'commit', '-q', '--allow-empty', '-m', 'bare'],
            { cwd: HOOKS_DIR, encoding: 'utf8', env: gitEnv(planted.dir) });
        assert.strictEqual(bareCommit.status, 0, bareCommit.stdout + bareCommit.stderr);
        assert.ok(markerLines(planted.marker).includes('hookspath'),
            'core.hooksPath did not fire under bare git, so the fixture proves nothing: '
            + JSON.stringify(markerLines(planted.marker)));

        // Direction two: the same two calls through the runner.
        fs.rmSync(planted.marker, { force: true });
        const status = gitRun(planted.repo, ['status', '--porcelain'], { timeoutMs: 20000 });
        assert.notStrictEqual(status, null, 'the guarded status did not run at all');
        assert.strictEqual(status.status, 0, 'guarded status: ' + JSON.stringify(status));
        const commit = gitRun(planted.repo, ['commit', '-q', '--allow-empty', '-m', 'guarded'],
            { timeoutMs: 20000 });
        assert.notStrictEqual(commit, null, 'the guarded commit did not run at all');
        assert.strictEqual(commit.status, 0, 'guarded commit: ' + JSON.stringify(commit));
        assert.deepStrictEqual(markerLines(planted.marker), [],
            'the planted repository ran its own code through the runner: '
            + JSON.stringify(markerLines(planted.marker)));
    } finally { rmDir(planted.dir); }
});

// The whole GIT_* family, not GIT_DIR alone: GIT_COMMON_DIR redirects even a
// --local config read, and GIT_CONFIG_GLOBAL and GIT_SSH_COMMAND hand git an
// attacker's config and an attacker's transport. The prompt refusal is set
// after the strip, so no call can block a session start on a credential prompt.
test('the child environment carries no GIT_ variable and refuses a terminal prompt', () => {
    const keys = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CONFIG_GLOBAL',
        'GIT_SSH_COMMAND', 'GIT_ASKPASS', 'git_lowercase_key'];
    const saved = new Map(keys.map((k) => [k, process.env[k]]));
    try {
        for (const k of keys) process.env[k] = 'planted';
        const env = gitChildEnv();
        // What survives is the guard's own set and nothing else: the prompt
        // refusal and the two config pins, matched against the full list rather
        // than against an exemption, so a key that arrives from anywhere else
        // reads as a failure.
        const left = Object.keys(env).filter((k) => /^GIT_/i.test(k)).sort();
        assert.deepStrictEqual(left, ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_KEY_1',
            'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_VALUE_1', 'GIT_TERMINAL_PROMPT'],
            'GIT_ keys reached the child environment: ' + left.join(', '));
        assert.ok(!Object.values(env).includes('planted'),
            'a planted value survived the strip under a name of its own');
        assert.strictEqual(env.GIT_TERMINAL_PROMPT, '0');
        assert.strictEqual(env.GIT_CONFIG_COUNT, '2');
        assert.strictEqual(env.GIT_CONFIG_KEY_0, 'core.fsmonitor');
        assert.strictEqual(env.GIT_CONFIG_VALUE_0, 'false');
        assert.strictEqual(env.GIT_CONFIG_KEY_1, 'core.hooksPath');
        assert.ok(!fs.existsSync(env.GIT_CONFIG_VALUE_1),
            'the hooks path pin names a directory nothing creates: ' + env.GIT_CONFIG_VALUE_1);
        assert.notStrictEqual(gitChildEnv().GIT_CONFIG_VALUE_1, env.GIT_CONFIG_VALUE_1,
            'the hooks path carries a fresh suffix per call, so nothing can pre-create it');
        assert.ok(env.PATH || env.Path, 'the rest of the environment is kept, PATH included');
    } finally {
        for (const [k, v] of saved) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
    }
});

// Every way a call can fail answers null, and none of them throws: a hook that
// took an exception here would break a session start it was only meant to
// inform.
test('a directory that is not a repository is silence rather than an error', () => {
    const dir = makeDir('kit-git-lib-bare-');
    try {
        assert.strictEqual(gitOutput(dir, ['rev-parse', 'HEAD']), null);
        assert.strictEqual(gitOutput(path.join(dir, 'no-such-directory'), ['rev-parse', 'HEAD']), null);
    } finally { rmDir(dir); }
});

test('a nonzero exit is null to gitOutput and a status to gitRun', () => {
    const repo = makeRepo();
    try {
        const args = ['rev-parse', '--verify', '--quiet', 'refs/heads/no-such-branch'];
        assert.strictEqual(gitOutput(repo.dir, args), null);
        // gitRun keeps the exit code, which is the answer itself to a caller
        // asking a question git spells in exit codes.
        const res = gitRun(repo.dir, args);
        assert.notStrictEqual(res, null, 'a git that ran is a result, whatever it exited with');
        assert.notStrictEqual(res.status, 0);
        assert.strictEqual(typeof res.stdout, 'string');
    } finally { rmDir(repo.dir); }
});

test('a run past its timeout is null', () => {
    const repo = makeRepo();
    try {
        assert.strictEqual(gitRun(repo.dir, ['rev-list', '--all', '--objects'], { timeoutMs: 1 }), null);
    } finally { rmDir(repo.dir); }
});

test('arguments are an array of strings or the call does not run', () => {
    const repo = makeRepo();
    try {
        // A command string is not a shell line here, and is refused rather than
        // split: nothing in this runner ever reaches a shell.
        assert.strictEqual(gitRun(repo.dir, 'rev-parse HEAD'), null);
        assert.strictEqual(gitRun(repo.dir, ['rev-parse', 7]), null);
        assert.strictEqual(gitRun('', ['rev-parse', 'HEAD']), null);
        assert.strictEqual(gitRun(null, ['rev-parse', 'HEAD']), null);
    } finally { rmDir(repo.dir); }
});

// A machine with no git at all is the plainest failure the runner has to
// survive, since the hooks calling it run on every session start. The child
// carries a PATH of one empty directory rather than no PATH at all: an absent
// PATH is refilled from the spawning process's own on Windows, which would
// leave the child looking at the very git this machine has.
test('a machine where git cannot be found answers null', () => {
    const repo = makeRepo();
    const empty = makeDir('kit-git-lib-nogit-');
    try {
        const script = 'const { gitOutput } = require(' + JSON.stringify(LIB) + ');'
            + 'process.stdout.write(String(gitOutput(process.argv[1], ["rev-parse", "HEAD"])));';
        const withoutGit = { ...process.env };
        for (const k of Object.keys(withoutGit)) {
            if (/^path$/i.test(k)) delete withoutGit[k];
        }
        withoutGit.PATH = empty;
        const gone = spawnSync(process.execPath, ['-e', script, repo.dir],
            { encoding: 'utf8', env: withoutGit });
        assert.strictEqual(gone.status, 0, 'the require itself must survive: ' + gone.stderr);
        assert.strictEqual(gone.stdout, 'null', gone.stderr);

        // The control: the identical child with a PATH finds git and answers.
        const found = spawnSync(process.execPath, ['-e', script, repo.dir],
            { encoding: 'utf8', env: { ...process.env } });
        assert.strictEqual(found.stdout.trim(), repo.sha, found.stderr);
    } finally { rmDir(repo.dir); rmDir(empty); }
});
