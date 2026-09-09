// Behavioural pin between the two git-invocation guards this repo carries:
// the Node hook side (plugins/claude-kit/hooks/kit-git-lib.js's
// gitChildEnv()) and the PowerShell doctor side
// (plugins/claude-kit/doctor/install-memory-sync.ps1's Invoke-MemorySyncGit).
// Neither language can call the other's, so the two implementations are
// restated rather than shared, and nothing today would notice if one gained
// a key, lost an ordering guarantee, or dropped a value the other did not.
//
// Both sides of that pair are run for real against the real code rather than
// the guards' source text being pattern-matched. That claim is about the git
// guards alone. The cmd-wrapper pins at the end of this file carry two claims
// on two mechanisms, because neither is honestly established by the other's
// evidence: a class claim, that every tracked .cmd and .bat git discovers is
// enrolled with a run recipe here and an unenrolled one reds rather than
// passing unswept; and a behaviour claim, that an enrolled wrapper is judged
// by running it under a real cmd.exe with a decoy of its interpreter planted
// in the calling directory. The generated memq.cmd is obtained by
// dot-sourcing its installer and calling the generator, so the bytes those
// pins read are the bytes the installer writes.
// The JS side calls gitChildEnv()
// directly with node's own require and reads the object it returns;
// gitRun's own use of that same object as its spawn's env
// (kit-git-lib.js:147) is not independently pinned here or elsewhere as a
// byte-identity check, it is only exercised behaviourally by
// test/kit-git-lib.test.js's planted-repository cases (whose passing
// depends on the guard's effect actually reaching a real git child through
// gitRun, without asserting the two objects are identical). The PS side is
// the one run against a real child here: a fake git (a .cmd that ignores
// its arguments and dumps its own environment via "set") is invoked once
// directly and once through Invoke-MemorySyncGit, so a comment quoting the
// strip literal, an unused regex, a guard key spelled outside the $guard
// table, a quote-style change, or two statements swapped in the wrong order
// all read here exactly as they would read to git itself.
//
// The comparison, compareGuardEnvironments(jsPath, psPath), captures each
// side's pre-guard and post-guard environment and computes the DELTA
// between them (names added, names changed, names removed), rather than
// filtering either environment to a fixed namespace first. A fixed
// /^GIT_/i filter cannot see a guard that starts setting a name outside
// that prefix; the delta can, because it is blind to prefix and only asks
// what the guard actually touched. compareGuardEnvironments throws an
// AssertionError listing every difference; it never truncates to the first
// one. Taking the two paths as parameters is what lets the controls below
// run it against mkdtemp copies instead of only against the real files.
//
// A block of environment variables ride into both calls, planted before the
// guard runs so their fate is part of the observed delta. They fall into
// three tables, PLANTED_NOISE, PLANTED_GUARD_OVERWRITE and
// PLANTED_SURVIVOR, each merged into PLANTED and each checked against the
// delta in its own way below, so a name's required fate always traces back
// to the table it is planted from rather than to a count restated in prose.
//
// PLANTED_NOISE names are never a guard name, so their survival would mean
// the strip missed them: they must show up as removed, on both sides, in
// either casing (the strip is case-insensitive).
//
// PLANTED_GUARD_OVERWRITE names are the guard's own key names
// (GIT_TERMINAL_PROMPT, GIT_CONFIG_COUNT, NoDefaultCurrentDirectoryInExePath,
// GIT_CONFIG_KEY_0, GIT_CONFIG_VALUE_0, GIT_CONFIG_KEY_1,
// GIT_CONFIG_VALUE_1), each planted with a value distinct from what the
// guard writes there, so their fate must be "changed to the guard's own
// literal value" rather than "added" (which would mean the plant leaked
// past the point the guard reads process state) or "removed" (which is
// what a broken strip-then-set order produces, since a pre-existing name
// the strip queues for removal outruns a set that ran before it). This file
// pins the literal value each name (all but GIT_CONFIG_VALUE_1) must change
// to as the parity contract itself, checked against both sides;
// test/kit-git-lib.test.js:266-270 separately pins five of the six on the
// JS side for its own purposes; NoDefaultCurrentDirectoryInExePath is
// pinned to its literal only here.
//
// PLANTED_SURVIVOR names are neither a guard name nor deliberate noise: no
// guard has any reason to touch them, so they must be absent from the delta
// entirely and still present with their planted value in both post-guard
// environments, catching an over-broad strip that takes down a name it
// was never meant to reach and a plant that never landed alike.
//
// GIT_CONFIG_VALUE_1 is pinned by shape rather than by literal value: both
// sides join a fresh GUID onto their own runtime's temp directory with a
// "no-hooks-" marker, and the two prefixes (kit-git-no-hooks- vs
// kit-memory-sync-no-hooks-) differ by design, so only the shape is
// compared. Per-call GUID freshness is pinned on the JS side alone, at
// test/kit-git-lib.test.js:273 (gitChildEnv() called twice in the same
// process and the two GIT_CONFIG_VALUE_1 results compared); this file does
// not re-pin freshness, since the two sides' prefixes already guarantee the
// values differ regardless of the GUID.
//
// GIT_CONFIG_COUNT is validated in both directions: for every i from 0 to
// COUNT-1, both GIT_CONFIG_KEY_i and GIT_CONFIG_VALUE_i must actually be
// present on that side (COUNT names an index nothing backs), and the set of
// indices actually present in GIT_CONFIG_KEY_<i> and in GIT_CONFIG_VALUE_<i>
// must each equal exactly {0..COUNT-1} (an extra index beyond COUNT's
// range, such as GIT_CONFIG_VALUE_2 with COUNT still 2, backs an index
// COUNT never named). Either direction alone would miss the other's defect:
// comparing sets by size alone would pass a wrong-but-equal-sized set of
// indices, and walking COUNT's own indices without the reverse check would
// miss an extra one COUNT never claims.
//
// Node's built-in test runner, no framework. The PowerShell-dependent cases
// spawn Windows PowerShell and are skipped off Windows, where the doctor
// does not run. Every case owns its own mkdtemp directory, cleaned up
// best-effort so a cleanup failure never masks a real assertion error, and
// shares nothing with its neighbours.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = path.join(__dirname, '..');
const JS_PATH = path.join(REPO, 'plugins', 'claude-kit', 'hooks', 'kit-git-lib.js');
const PS_PATH = path.join(REPO, 'plugins', 'claude-kit', 'doctor', 'install-memory-sync.ps1');
const isWin = process.platform === 'win32';

// The wrapper sweeps below ask git a question about this repository, which is
// the tree under audit, so they run through the kit's own git runner rather
// than a hand-built spawn. On Windows a bare command name resolves against the
// spawning process's working directory ahead of PATH, and the variable that
// suppresses that search is read from the spawning process rather than from the
// child, so a key placed in the child's environment does not reach it. The
// runner pins its own working directory outside the repository it is asked
// about and strips the GIT_* variables that would otherwise redirect the
// answer. It is the boundary every hook's git call already runs through, and
// reusing it is what keeps this file from being a second producer that
// reimplements the protections it can see and drops the ones it cannot.
const { gitRun, gitOutput } = require(JS_PATH);

// Single-quoted PowerShell literal, any embedded quote doubled.
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function detectEol(text) {
    return text.includes('\r\n') ? '\r\n' : '\n';
}

// Best-effort cleanup: leaving a temp dir behind never fails the test, and
// never replaces a real assertion error raised inside the same try block.
function rmDir(dir) {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        // Best-effort cleanup; leaving a temp dir behind never fails the test.
    }
}

// A child environment built from this process's own, with every ambient
// spelling of each named variable removed. Windows environment names are
// case-insensitive while a plain object is not, so { ...process.env } can hold
// two differently cased keys for one logical name (an ambient "Path" beside a
// "PATH", say) sitting side by side in the object handed to spawnSync, which is
// free to pass both through to the child's real (case-insensitive, single-slot)
// environment block in either order. Dropping every key that matches a named
// variable, in any casing, is what closes that ambiguity: the child never sees
// two spellings of one name, and never sees a name this call meant to withhold
// under a casing the caller did not think to type. Both spawn paths in this
// file build their child environment here rather than each deleting the
// spellings it can see, since the protection is a property of the spawn channel
// rather than of the caller that first needed it. process.env itself is never
// mutated: the copy is what is handed to the child.
function childEnvWithout(names) {
    const env = { ...process.env };
    const targets = new Set(names.map((n) => n.toUpperCase()));
    for (const k of Object.keys(env)) {
        if (targets.has(k.toUpperCase())) delete env[k];
    }
    return env;
}

// Noise: never a guard name, so its survival means the strip missed it.
// This is the single source PLANTED_NAMES_THAT_MUST_NOT_SURVIVE reads from,
// rather than a hand-typed name list that could drift out of step with it.
const PLANTED_NOISE = {
    GIT_KIT_PARITY_PLANTED: 'x',
    git_kit_parity_lower: 'y'
};
// Every name either guard sets, planted with a value distinct from what the
// guard must write there, so each reads as changed regardless of ambient
// state. GIT_CONFIG_VALUE_1 is here too (also expected to read as changed)
// even though its final value is shape-checked rather than compared to a
// literal, since the guard writes a fresh GUID-bearing path each call.
const PLANTED_GUARD_OVERWRITE = {
    GIT_TERMINAL_PROMPT: '1',
    GIT_CONFIG_COUNT: '9',
    NoDefaultCurrentDirectoryInExePath: '0',
    GIT_CONFIG_KEY_0: 'x',
    GIT_CONFIG_VALUE_0: 'x',
    GIT_CONFIG_KEY_1: 'x',
    GIT_CONFIG_VALUE_1: 'x'
};
// A name neither guard has any reason to touch. This is the single source
// the survivor check below reads from.
const PLANTED_SURVIVOR = {
    KIT_PARITY_SURVIVOR: 'keep'
};
const PLANTED = { ...PLANTED_NOISE, ...PLANTED_GUARD_OVERWRITE, ...PLANTED_SURVIVOR };
const PLANTED_NAMES_THAT_MUST_NOT_SURVIVE = Object.keys(PLANTED_NOISE);

// The literal value each planted guard name changes to, confirmed against
// plugins/claude-kit/hooks/kit-git-lib.js:100-116 and
// plugins/claude-kit/doctor/install-memory-sync.ps1:452-487. GIT_CONFIG_VALUE_1
// is not here: it is checked by shape further down (against its own
// planted-then-changed delta entry) rather than by comparing to a literal
// target, since its value is a fresh GUID-bearing path.
const EXPECTED_GUARD_CHANGE = {
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '2',
    NoDefaultCurrentDirectoryInExePath: '1',
    GIT_CONFIG_KEY_0: 'core.fsmonitor',
    GIT_CONFIG_VALUE_0: 'false',
    GIT_CONFIG_KEY_1: 'core.hooksPath'
};

// The literal table and the plant table are two hand-typed lists, so they
// are bound here: every planted guard name is in the literal table or is
// GIT_CONFIG_VALUE_1, and nothing else is, so a guard key added to one
// table and forgotten in the other fails at load rather than falling
// through to the generic cross-side comparison.
assert.deepStrictEqual(
    [...Object.keys(EXPECTED_GUARD_CHANGE), 'GIT_CONFIG_VALUE_1'].sort(),
    Object.keys(PLANTED_GUARD_OVERWRITE).sort(),
    'EXPECTED_GUARD_CHANGE plus GIT_CONFIG_VALUE_1 must name exactly the PLANTED_GUARD_OVERWRITE keys');

const GUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function hasNameCI(obj, name) {
    const upper = name.toUpperCase();
    return Object.keys(obj).some((k) => k.toUpperCase() === upper);
}

function getValueCI(obj, name) {
    const upper = name.toUpperCase();
    const key = Object.keys(obj).find((k) => k.toUpperCase() === upper);
    return key === undefined ? undefined : obj[key];
}

// The JS side: require the copy (kit-git-lib.js requires only node
// builtins, so a copy under a temp dir loads standalone), plant the PLANTED
// table on process.env, capture it as the pre-guard baseline, call the real
// gitChildEnv() for the post-guard result, and restore process.env in a
// finally whether the call threw or not. No casing cleanup is needed before
// planting here the way buildPsEnvMap needs it for its spawned child's env
// block: process.env on Windows holds one slot per name whatever its
// casing, so planting cannot leave two spellings of one name behind, and
// computeDelta keys every name by its upper-cased spelling, so the
// spelling pre enumerates and the spelling post enumerates are read as
// one delta entry.
function buildJsEnvMap(jsPath) {
    delete require.cache[require.resolve(jsPath)];
    const mod = require(jsPath);
    const previous = {};
    for (const k of Object.keys(PLANTED)) previous[k] = process.env[k];
    for (const k of Object.keys(PLANTED)) process.env[k] = PLANTED[k];
    const pre = { ...process.env };
    let post;
    try {
        post = mod.gitChildEnv();
    } finally {
        for (const k of Object.keys(PLANTED)) {
            if (previous[k] === undefined) delete process.env[k];
            else process.env[k] = previous[k];
        }
    }
    return { pre, post };
}

function parseEnvDump(lines) {
    const map = {};
    for (const line of lines) {
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        map[line.slice(0, eq)] = line.slice(eq + 1);
    }
    return map;
}

// The full path to Windows PowerShell. This has nothing to do with the
// guard, which never resolves a path for a spawned child itself (gitRun
// spawns the bare command "git" with the child's cwd set to __dirname); it
// is here so the probe's own interpreter is found by an explicit path
// rather than by a PATH lookup, removing PATH resolution as a variable in
// what this test measures. Falls back to the bare name only when
// SystemRoot is unset.
const POWERSHELL_EXE = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';

// The PS side: spawn PowerShell, dot-source the copy, and run a fake git (a
// .cmd that ignores its arguments and dumps its own environment via "set")
// twice: once directly, for the pre-guard baseline, and once through
// Invoke-MemorySyncGit, for the post-guard result. Both dumps are captured
// into a PowerShell variable, each item cast with [string]$_ (matching what
// Invoke-MemorySyncGit's own Output already does, at
// install-memory-sync.ps1:486), and every line this script writes, the
// marker lines included, goes through [Console]::Out.WriteLine, which
// writes the raw string straight to stdout and bypasses the console
// formatter Write-Output goes through; the formatter wraps a line at the
// host's console width, which cuts a long GIT_CONFIG_VALUE_1 dump line at a
// column narrower than a redirected stdout capture ever needs. Routing
// every line through the one writer also means there is no ordering
// assumption between two different output paths interleaving on the same
// stream. The two dumps share that one stdout stream, so each is wrapped in
// its own BEGIN/END marker line the parser cannot mistake for environment
// output (no real environment variable name is spelled KITPARITY_*).
// GetTempPath() rides along on its own marked line, read by the caller to
// check GIT_CONFIG_VALUE_1's shape against the runtime that produced it.
// [Console]::OutputEncoding is set to UTF8 up front so every line decodes
// alike.
function buildPsEnvMap(psPath) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitguard-ps-'));
    try {
        const fakeGit = path.join(dir, 'fake-git.cmd');
        fs.writeFileSync(fakeGit, '@echo off\r\nset\r\n', 'utf8');
        const storeRoot = path.join(dir, 'store');
        fs.mkdirSync(storeRoot);
        const script = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; '
            + '. ' + q(psPath) + '; '
            + '$tempPath = [System.IO.Path]::GetTempPath(); '
            + '[Console]::Out.WriteLine("KITPARITY_TEMPPATH=" + $tempPath); '
            + '$pre = & ' + q(fakeGit) + ' 2>&1; '
            + '[Console]::Out.WriteLine("KITPARITY_PRE_BEGIN"); '
            + 'foreach ($line in $pre) { [Console]::Out.WriteLine([string]$line) }; '
            + '[Console]::Out.WriteLine("KITPARITY_PRE_END"); '
            + '$result = Invoke-MemorySyncGit -StoreRoot ' + q(storeRoot)
            + ' -Arguments @("status") -GitExe ' + q(fakeGit) + '; '
            + '[Console]::Out.WriteLine("KITPARITY_POST_BEGIN"); '
            + 'foreach ($line in $result.Output) { [Console]::Out.WriteLine([string]$line) }; '
            + '[Console]::Out.WriteLine("KITPARITY_POST_END")';

        // Every planted name is dropped in every ambient casing before the
        // planted spelling is added back, so the child sees exactly one
        // spelling of each planted name and it is this test's own.
        const spawnEnv = childEnvWithout(Object.keys(PLANTED));
        Object.assign(spawnEnv, PLANTED);

        const res = spawnSync(POWERSHELL_EXE,
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
            { encoding: 'utf8', env: spawnEnv, timeout: 60000, maxBuffer: 16 * 1024 * 1024 });

        // Never put the raw environment dump in an assertion message: it can
        // run to dozens of lines, and a line count plus a bounded slice of
        // stderr is enough to diagnose a spawn failure without flooding the
        // test report.
        const stdout = res.stdout || '';
        const lines = stdout.split(/\r?\n/);
        const stderrLines = (res.stderr || '').split(/\r?\n/).filter((l) => l.length > 0);
        const stderrDetail = ' stdoutLines=' + lines.length
            + ' stderrFirst=' + JSON.stringify(stderrLines[0] || '')
            + ' stderrTail=' + JSON.stringify(stderrLines.slice(-5));
        assert.strictEqual(res.status, 0,
            res.error
                ? 'the PS probe spawn failed: ' + res.error.message + stderrDetail
                : 'the PS probe exited non-zero: status=' + res.status + stderrDetail);

        let tempPath = null;
        let mode = null;
        const preLines = [];
        const postLines = [];
        for (const line of lines) {
            if (line.startsWith('KITPARITY_TEMPPATH=')) {
                tempPath = line.slice('KITPARITY_TEMPPATH='.length);
                continue;
            }
            if (line === 'KITPARITY_PRE_BEGIN') { mode = 'pre'; continue; }
            if (line === 'KITPARITY_PRE_END') { mode = null; continue; }
            if (line === 'KITPARITY_POST_BEGIN') { mode = 'post'; continue; }
            if (line === 'KITPARITY_POST_END') { mode = null; continue; }
            if (mode === 'pre') preLines.push(line);
            else if (mode === 'post') postLines.push(line);
        }
        assert.ok(tempPath, 'the PS probe never printed its temp directory: stdoutLines=' + lines.length);

        return { pre: parseEnvDump(preLines), post: parseEnvDump(postLines), tempPath };
    } finally {
        rmDir(dir);
    }
}

// Every name touched between pre and post, keyed by upper-cased name
// (Windows environment names are case-insensitive) so a differently-cased
// spelling on either side still finds its peer. A name present on both
// sides with the same value is not touched and carries no entry.
function computeDelta(pre, post) {
    const preByUpper = new Map(Object.keys(pre).map((k) => [k.toUpperCase(), k]));
    const postByUpper = new Map(Object.keys(post).map((k) => [k.toUpperCase(), k]));
    const touched = new Map();
    for (const upper of postByUpper.keys()) {
        const postName = postByUpper.get(upper);
        if (!preByUpper.has(upper)) {
            touched.set(upper, { kind: 'added', name: postName, value: post[postName] });
        } else {
            const preName = preByUpper.get(upper);
            if (pre[preName] !== post[postName]) {
                touched.set(upper, { kind: 'changed', name: postName, from: pre[preName], to: post[postName] });
            }
        }
    }
    for (const upper of preByUpper.keys()) {
        if (!postByUpper.has(upper)) {
            touched.set(upper, { kind: 'removed', name: preByUpper.get(upper) });
        }
    }
    return touched;
}

function describeChange(info) {
    if (info.kind === 'added') return 'added=' + JSON.stringify(info.value);
    if (info.kind === 'changed') return 'changed to ' + JSON.stringify(info.to);
    return 'removed';
}

// value is expected to start with tempDir, contain "no-hooks-", and end in
// a GUID-shaped token. Returns null when the shape holds, or a message
// naming what failed.
function value1ShapeProblem(value, tempDir) {
    if (typeof value !== 'string') return 'is not a string: ' + JSON.stringify(value);
    if (!tempDir || !value.startsWith(tempDir)) {
        return 'does not start with the runtime temp directory ' + JSON.stringify(tempDir) + ': ' + JSON.stringify(value);
    }
    if (!value.includes('no-hooks-')) return 'does not contain "no-hooks-": ' + JSON.stringify(value);
    if (!GUID_RE.test(value)) return 'does not end in a GUID-shaped token: ' + JSON.stringify(value);
    return null;
}

// GIT_CONFIG_COUNT names how many GIT_CONFIG_KEY_<i>/GIT_CONFIG_VALUE_<i>
// pairs the guard set. Every index it names is checked for real, both the
// key and the value, rather than trusting a matching count of
// digit-suffixed names (which would pass even for the wrong indices).
function validateConfigIndices(post, sideLabel, problems) {
    const countName = Object.keys(post).find((k) => k.toUpperCase() === 'GIT_CONFIG_COUNT');
    if (!countName) return; // absence is reported elsewhere (the per-name and name-set checks)
    const n = Number(post[countName]);
    if (!Number.isInteger(n) || n < 0) {
        problems.push(sideLabel + ' side: GIT_CONFIG_COUNT is not a non-negative integer: ' + JSON.stringify(post[countName]));
        return;
    }
    for (let i = 0; i < n; i++) {
        if (!hasNameCI(post, 'GIT_CONFIG_KEY_' + i)) {
            problems.push(sideLabel + ' side: GIT_CONFIG_COUNT=' + n + ' names index ' + i + ' but GIT_CONFIG_KEY_' + i + ' is missing');
        }
        if (!hasNameCI(post, 'GIT_CONFIG_VALUE_' + i)) {
            problems.push(sideLabel + ' side: GIT_CONFIG_COUNT=' + n + ' names index ' + i + ' but GIT_CONFIG_VALUE_' + i + ' is missing');
        }
    }
    // The reverse direction: every GIT_CONFIG_KEY_<i> and GIT_CONFIG_VALUE_<i>
    // actually present must be one COUNT named, checked as sets rather than
    // as a bare count, so an extra index beyond COUNT's range (for example
    // GIT_CONFIG_VALUE_2 surviving while GIT_CONFIG_COUNT still reads 2) is
    // caught here even though the walk above never looks at index 2, and a
    // wrong-but-equal-sized set of indices (0 and 2 present when 0 and 1 are
    // named) cannot pass on a size match alone.
    const expected = new Set();
    for (let i = 0; i < n; i++) expected.add(i);
    const setsEqual = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
    const collectIndices = (re) => {
        const present = new Set();
        for (const k of Object.keys(post)) {
            const m = re.exec(k);
            if (m) present.add(Number(m[1]));
        }
        return present;
    };
    const presentKeyIndices = collectIndices(/^GIT_CONFIG_KEY_(\d+)$/i);
    const presentValueIndices = collectIndices(/^GIT_CONFIG_VALUE_(\d+)$/i);
    if (!setsEqual(presentKeyIndices, expected)) {
        problems.push(sideLabel + ' side: GIT_CONFIG_COUNT=' + n + ' but GIT_CONFIG_KEY_<i> indices present are {'
            + [...presentKeyIndices].sort((a, b) => a - b).join(', ') + '}, expected {0..' + (n - 1) + '}');
    }
    if (!setsEqual(presentValueIndices, expected)) {
        problems.push(sideLabel + ' side: GIT_CONFIG_COUNT=' + n + ' but GIT_CONFIG_VALUE_<i> indices present are {'
            + [...presentValueIndices].sort((a, b) => a - b).join(', ') + '}, expected {0..' + (n - 1) + '}');
    }
}

// The pin. Builds each side's pre/post environment from a real run of the
// real guard, computes each side's delta, and throws an AssertionError
// listing every difference when the two disagree.
function compareGuardEnvironments(jsPath, psPath) {
    const { pre: jsPre, post: jsPost } = buildJsEnvMap(jsPath);
    const { pre: psPre, post: psPost, tempPath: psTempDir } = buildPsEnvMap(psPath);
    const jsTempDir = os.tmpdir();

    const jsTouched = computeDelta(jsPre, jsPost);
    const psTouched = computeDelta(psPre, psPost);

    const problems = [];

    // The planted non-guard names never survive the strip, on either side,
    // in either casing: each must appear in the delta as kind 'removed',
    // not merely be absent from the post-guard environment, so a strip that
    // renames the plant rather than deleting it (leaving it 'changed' or
    // simply missing from the delta because it never moved) cannot pass.
    for (const name of PLANTED_NAMES_THAT_MUST_NOT_SURVIVE) {
        const upper = name.toUpperCase();
        const jInfo = jsTouched.get(upper);
        const pInfo = psTouched.get(upper);
        if (!jInfo || jInfo.kind !== 'removed') {
            problems.push('JS side: planted ' + name + ' was not removed: ' + JSON.stringify(jInfo || null));
        }
        if (!pInfo || pInfo.kind !== 'removed') {
            problems.push('PS side: planted ' + name + ' was not removed: ' + JSON.stringify(pInfo || null));
        }
    }

    // The survivor plant is neither a guard name nor deliberate noise, so it
    // must be absent from the delta entirely (no add, no change, no remove)
    // and it must actually be present, on both sides, still carrying its
    // planted value: absence from the delta alone would also describe a
    // plant that never landed in the pre-guard environment in the first
    // place, which proves nothing about the strip.
    for (const [name, plantedValue] of Object.entries(PLANTED_SURVIVOR)) {
        const upper = name.toUpperCase();
        if (jsTouched.has(upper)) problems.push('JS side: survivor ' + name + ' was touched: ' + JSON.stringify(jsTouched.get(upper)));
        if (psTouched.has(upper)) problems.push('PS side: survivor ' + name + ' was touched: ' + JSON.stringify(psTouched.get(upper)));
        const jVal = getValueCI(jsPost, name);
        const pVal = getValueCI(psPost, name);
        if (jVal !== plantedValue) {
            problems.push('JS side: survivor ' + name + ' is not present with its planted value ' + JSON.stringify(plantedValue) + ': ' + JSON.stringify(jVal));
        }
        if (pVal !== plantedValue) {
            problems.push('PS side: survivor ' + name + ' is not present with its planted value ' + JSON.stringify(plantedValue) + ': ' + JSON.stringify(pVal));
        }
    }

    // Every planted guard name (all but GIT_CONFIG_VALUE_1, checked by shape
    // further down) is proved by the delta rather than by an ambient
    // process that happened to already carry the guard's own value: each
    // must read as changed, from the planted value (proving the plant
    // actually reached the pre-guard environment) to the literal value the
    // guard is known to write, on both sides.
    for (const [name, expected] of Object.entries(EXPECTED_GUARD_CHANGE)) {
        const upper = name.toUpperCase();
        const plantedValue = PLANTED_GUARD_OVERWRITE[name];
        const jInfo = jsTouched.get(upper);
        const pInfo = psTouched.get(upper);
        if (!jInfo || jInfo.kind !== 'changed' || jInfo.from !== plantedValue || jInfo.to !== expected) {
            problems.push('JS side: ' + name + ' did not change from the planted value ' + JSON.stringify(plantedValue)
                + ' to ' + JSON.stringify(expected) + ': ' + JSON.stringify(jInfo || null));
        }
        if (!pInfo || pInfo.kind !== 'changed' || pInfo.from !== plantedValue || pInfo.to !== expected) {
            problems.push('PS side: ' + name + ' did not change from the planted value ' + JSON.stringify(plantedValue)
                + ' to ' + JSON.stringify(expected) + ': ' + JSON.stringify(pInfo || null));
        }
    }

    // The touched name sets, compared case-insensitively, original
    // spellings reported, capped so a broken probe that captures the box's
    // whole environment cannot dump every name into the failure message.
    const formatNameList = (names) => {
        const shown = names.slice(0, 10).join(', ');
        return names.length > 10 ? shown + ' (+' + (names.length - 10) + ' more)' : shown;
    };
    const onlyJs = [...jsTouched.keys()].filter((u) => !psTouched.has(u)).map((u) => jsTouched.get(u).name);
    const onlyPs = [...psTouched.keys()].filter((u) => !jsTouched.has(u)).map((u) => psTouched.get(u).name);
    if (onlyJs.length) problems.push('JS-only names: ' + formatNameList(onlyJs));
    if (onlyPs.length) problems.push('PS-only names: ' + formatNameList(onlyPs));

    // For every name touched on both sides: the kind of touch must agree
    // (added / changed / removed), and where it is a set (added or
    // changed), the resulting value must agree too, except
    // GIT_CONFIG_VALUE_1, which is shape-checked below rather than compared
    // by value.
    for (const upper of jsTouched.keys()) {
        if (!psTouched.has(upper)) continue; // already reported as onlyJs above
        const j = jsTouched.get(upper);
        const p = psTouched.get(upper);
        if (j.kind !== p.kind) {
            problems.push(j.name + ': JS ' + describeChange(j) + ', PS ' + describeChange(p));
            continue;
        }
        if (upper === 'GIT_CONFIG_VALUE_1') continue;
        if (j.kind === 'added' && j.value !== p.value) {
            problems.push(j.name + '/' + p.name + ': JS=' + JSON.stringify(j.value) + ' PS=' + JSON.stringify(p.value));
        } else if (j.kind === 'changed' && j.to !== p.to) {
            problems.push(j.name + '/' + p.name + ': JS=' + JSON.stringify(j.to) + ' PS=' + JSON.stringify(p.to));
        }
    }

    // GIT_CONFIG_VALUE_1: also planted (with 'x'), so also expected to read
    // as changed on both sides; the value it changed to is checked by shape
    // rather than by literal, since the guard writes a fresh GUID-bearing
    // path each call and the two runtimes' temp-dir prefixes differ by
    // design.
    const jValue1 = jsTouched.get('GIT_CONFIG_VALUE_1');
    const pValue1 = psTouched.get('GIT_CONFIG_VALUE_1');
    if (!jValue1 || jValue1.kind !== 'changed') {
        problems.push('JS side: GIT_CONFIG_VALUE_1 did not change: ' + JSON.stringify(jValue1 || null));
    } else {
        const jProblem = value1ShapeProblem(jValue1.to, jsTempDir);
        if (jProblem) problems.push('GIT_CONFIG_VALUE_1: JS value ' + jProblem);
    }
    if (!pValue1 || pValue1.kind !== 'changed') {
        problems.push('PS side: GIT_CONFIG_VALUE_1 did not change: ' + JSON.stringify(pValue1 || null));
    } else {
        const pProblem = value1ShapeProblem(pValue1.to, psTempDir);
        if (pProblem) problems.push('GIT_CONFIG_VALUE_1: PS value ' + pProblem);
    }

    validateConfigIndices(jsPost, 'JS', problems);
    validateConfigIndices(psPost, 'PS', problems);

    if (problems.length) {
        throw new assert.AssertionError({ message: 'guard parity broken:\n' + problems.join('\n') });
    }
}

function withCopies(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitguard-parity-'));
    const jsCopy = path.join(dir, 'kit-git-lib.js');
    const psCopy = path.join(dir, 'install-memory-sync.ps1');
    fs.copyFileSync(JS_PATH, jsCopy);
    fs.copyFileSync(PS_PATH, psCopy);
    try {
        fn(jsCopy, psCopy);
    } finally {
        rmDir(dir);
    }
}

// The per-name checks inside compareGuardEnvironments already throw a
// fully-detailed AssertionError on any disagreement; a passing call here is
// itself the full claim, so there is nothing left for this test to
// re-assert about the returned deltas.
test('the Node and PowerShell git guards hand git the same environment delta', { skip: !isWin }, () => {
    compareGuardEnvironments(JS_PATH, PS_PATH);
});

// The control's first leg: run the comparison on untouched copies. It must
// pass, or the controls below (which assert it fails) would be proving
// nothing about the edit they make.
test('the pin passes on untouched copies of both files', { skip: !isWin }, () => {
    withCopies((jsCopy, psCopy) => {
        assert.doesNotThrow(() => compareGuardEnvironments(jsCopy, psCopy));
    });
});

test('adding a GIT_-prefixed key to the JS copy only turns the pin red, naming the key as JS-only', { skip: !isWin }, () => {
    withCopies((jsCopy, psCopy) => {
        const before = fs.readFileSync(jsCopy, 'utf8');
        const eol = detectEol(before);
        const anchor = "env.GIT_CONFIG_VALUE_1 = path.join(os.tmpdir(), 'kit-git-no-hooks-' + crypto.randomUUID());";
        assert.ok(before.includes(anchor), 'insertion anchor not found in the JS copy');
        const after = before.replace(anchor, anchor + eol + "    env.GIT_KIT_PARITY_PROBE = '1';");
        fs.writeFileSync(jsCopy, after, 'utf8');

        assert.throws(() => compareGuardEnvironments(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError
                && err.message.includes('GIT_KIT_PARITY_PROBE')
                && err.message.includes('JS-only names'),
            'expected the comparison to throw naming GIT_KIT_PARITY_PROBE as a JS-only name');
    });
});

// A name outside the GIT_ prefix is invisible to a fixed /^GIT_/i filter,
// but not to a delta, which is blind to prefix and only asks what changed.
test('adding a non-GIT-prefixed key to the JS copy only turns the pin red, naming it as JS-only', { skip: !isWin }, () => {
    withCopies((jsCopy, psCopy) => {
        const before = fs.readFileSync(jsCopy, 'utf8');
        const eol = detectEol(before);
        const anchor = "env.GIT_CONFIG_VALUE_1 = path.join(os.tmpdir(), 'kit-git-no-hooks-' + crypto.randomUUID());";
        assert.ok(before.includes(anchor), 'insertion anchor not found in the JS copy');
        const after = before.replace(anchor, anchor + eol + "    env.KIT_PARITY_OTHER = '1';");
        fs.writeFileSync(jsCopy, after, 'utf8');

        assert.throws(() => compareGuardEnvironments(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError
                && err.message.includes('KIT_PARITY_OTHER')
                && err.message.includes('JS-only names'),
            'expected the comparison to throw naming KIT_PARITY_OTHER as a JS-only name');
    });
});

test('adding a key to the PS $guard table only turns the pin red, naming the key as PS-only', { skip: !isWin }, () => {
    withCopies((jsCopy, psCopy) => {
        const before = fs.readFileSync(psCopy, 'utf8');
        const eol = detectEol(before);
        const anchor = '"GIT_CONFIG_VALUE_1"                 = $inertHooks';
        const at = before.indexOf(anchor);
        assert.ok(at >= 0, 'insertion anchor not found in the PS copy');
        const insertAt = at + anchor.length;
        const after = before.slice(0, insertAt) + eol + '        "GIT_KIT_PARITY_PROBE" = "1"' + before.slice(insertAt);
        fs.writeFileSync(psCopy, after, 'utf8');

        assert.throws(() => compareGuardEnvironments(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError
                && err.message.includes('GIT_KIT_PARITY_PROBE')
                && err.message.includes('PS-only names'),
            'expected the comparison to throw naming GIT_KIT_PARITY_PROBE as a PS-only name');
    });
});

// The PS ordering hazard: swapping the Remove-Item and Set-Item loops means
// the guard's own values are set first and then removed by the Remove-Item
// pass (which runs against $saved, computed before either loop and, thanks
// to the planted GIT_CONFIG_COUNT, already naming that key). The guard ends
// up handing git no GIT_CONFIG_COUNT at all: present pre-guard (planted at
// '9'), absent post-guard, which the delta reads as removed rather than
// changed.
test('swapping the PS Remove-Item and Set-Item loops turns the pin red, naming GIT_CONFIG_COUNT as removed instead of changed', { skip: !isWin }, () => {
    withCopies((jsCopy, psCopy) => {
        const before = fs.readFileSync(psCopy, 'utf8');
        const eol = detectEol(before);
        const removeLine = '        foreach ($name in @($saved.Keys)) { Remove-Item -LiteralPath ("Env:\\" + $name) -ErrorAction SilentlyContinue }';
        const setLine = '        foreach ($name in @($guard.Keys)) { Set-Item -LiteralPath ("Env:\\" + $name) -Value $guard[$name] }';
        assert.ok(before.includes(removeLine), 'the Remove-Item loop was not found in the PS copy');
        assert.ok(before.includes(setLine), 'the Set-Item loop was not found in the PS copy');
        const anchor = removeLine + eol + setLine;
        assert.ok(before.includes(anchor), 'the two loops are not adjacent as expected in the PS copy');
        const after = before.replace(anchor, setLine + eol + removeLine);
        fs.writeFileSync(psCopy, after, 'utf8');

        assert.throws(() => compareGuardEnvironments(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError
                && /GIT_CONFIG_COUNT: JS changed to "2", PS removed/.test(err.message),
            'expected the comparison to throw naming GIT_CONFIG_COUNT as changed on JS but removed on PS, on one line');
    });
});

// The JS mirror of the same ordering hazard: moving the strip loop below
// the assignments means it deletes every GIT_-prefixed name the guard just
// set, along with the planted noise it was meant to remove. GIT_CONFIG_COUNT
// is present pre-guard (planted at '9') and absent post-guard, which the
// delta reads as removed rather than changed, on the JS side this time.
test('moving the JS strip loop below the assignments turns the pin red, naming GIT_CONFIG_COUNT as removed instead of changed', { skip: !isWin }, () => {
    withCopies((jsCopy, psCopy) => {
        const before = fs.readFileSync(jsCopy, 'utf8');
        const eol = detectEol(before);
        const stripLoop = '    for (const k of Object.keys(env)) {' + eol
            + '        if (/^GIT_/i.test(k)) delete env[k];' + eol
            + '    }' + eol;
        const returnLine = '    return env;' + eol;
        assert.ok(before.includes(stripLoop), 'the strip loop was not found in the JS copy');
        assert.ok(before.includes(returnLine), 'the return statement was not found in the JS copy');
        const withoutStrip = before.replace(stripLoop, '');
        assert.notStrictEqual(withoutStrip, before, 'removing the strip loop did not change the file');
        const after = withoutStrip.replace(returnLine, stripLoop + returnLine);
        fs.writeFileSync(jsCopy, after, 'utf8');

        assert.throws(() => compareGuardEnvironments(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError
                && /GIT_CONFIG_COUNT: JS removed, PS changed to "2"/.test(err.message),
            'expected the comparison to throw naming GIT_CONFIG_COUNT as removed on JS but changed on PS, on one line');
    });
});

// The strip-predicate deletion control: the loop that removes every
// GIT_-prefixed name is deleted outright, so the planted
// GIT_KIT_PARITY_PLANTED (which only that loop removes) rides straight
// through to git.
test('deleting the JS strip loop turns the pin red, naming GIT_KIT_PARITY_PLANTED as still present on the JS side', { skip: !isWin }, () => {
    withCopies((jsCopy, psCopy) => {
        const before = fs.readFileSync(jsCopy, 'utf8');
        const eol = detectEol(before);
        const anchor = '    for (const k of Object.keys(env)) {' + eol
            + '        if (/^GIT_/i.test(k)) delete env[k];' + eol
            + '    }' + eol;
        assert.ok(before.includes(anchor), 'the strip loop was not found in the JS copy');
        const after = before.replace(anchor, '');
        fs.writeFileSync(jsCopy, after, 'utf8');

        assert.throws(() => compareGuardEnvironments(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError
                && err.message.includes('JS side: planted GIT_KIT_PARITY_PLANTED was not removed'),
            'expected the comparison to throw naming GIT_KIT_PARITY_PLANTED as still present on the JS side');
    });
});

// The survivor control: widening the JS strip predicate from /^GIT_/i to
// /^(GIT_|KIT_)/i makes it delete KIT_PARITY_SURVIVOR along with every
// genuine GIT_ name, which the survivor check exists to catch: a plant no
// guard has any reason to touch must never turn up touched in the delta.
test('widening the JS strip predicate to catch KIT_ names turns the pin red, naming KIT_PARITY_SURVIVOR as touched on the JS side', { skip: !isWin }, () => {
    withCopies((jsCopy, psCopy) => {
        const before = fs.readFileSync(jsCopy, 'utf8');
        const eol = detectEol(before);
        const anchor = '    for (const k of Object.keys(env)) {' + eol
            + '        if (/^GIT_/i.test(k)) delete env[k];' + eol
            + '    }' + eol;
        assert.ok(before.includes(anchor), 'the strip loop was not found in the JS copy');
        const after = before.replace(anchor,
            '    for (const k of Object.keys(env)) {' + eol
            + '        if (/^(GIT_|KIT_)/i.test(k)) delete env[k];' + eol
            + '    }' + eol);
        fs.writeFileSync(jsCopy, after, 'utf8');

        assert.throws(() => compareGuardEnvironments(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError
                && err.message.includes('JS side: survivor KIT_PARITY_SURVIVOR was touched'),
            'expected the comparison to throw naming KIT_PARITY_SURVIVOR as touched on the JS side');
    });
});

// The PS mirror of the strip-predicate control: narrowing -match to
// -cmatch makes the saved-names scan case-sensitive, so the lowercase
// git_kit_parity_lower plant no longer matches "^GIT_" and is never queued
// for removal, riding straight through to git.
test('narrowing the PS saved-names match to case-sensitive turns the pin red, naming git_kit_parity_lower as not removed on the PS side', { skip: !isWin }, () => {
    withCopies((jsCopy, psCopy) => {
        const before = fs.readFileSync(psCopy, 'utf8');
        const anchor = '$item.Name -match "^GIT_"';
        assert.ok(before.includes(anchor), 'the saved-names match was not found in the PS copy');
        const after = before.replace(anchor, '$item.Name -cmatch "^GIT_"');
        fs.writeFileSync(psCopy, after, 'utf8');

        assert.throws(() => compareGuardEnvironments(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError
                && err.message.includes('PS side: planted git_kit_parity_lower was not removed'),
            'expected the comparison to throw naming git_kit_parity_lower as not removed on the PS side');
    });
});

// The value-drift control: same key on both sides, a differing literal.
test('changing a PS literal value turns the pin red, naming the key and both values', { skip: !isWin }, () => {
    withCopies((jsCopy, psCopy) => {
        const before = fs.readFileSync(psCopy, 'utf8');
        const anchor = '"GIT_CONFIG_VALUE_0"                 = "false"';
        assert.ok(before.includes(anchor), 'GIT_CONFIG_VALUE_0 entry not found in the PS copy');
        const after = before.replace(anchor, '"GIT_CONFIG_VALUE_0"                 = "true"');
        fs.writeFileSync(psCopy, after, 'utf8');

        assert.throws(() => compareGuardEnvironments(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError
                && err.message.includes('GIT_CONFIG_VALUE_0')
                && err.message.includes('"true"')
                && err.message.includes('"false"'),
            'expected the comparison to throw naming GIT_CONFIG_VALUE_0 as differing');
    });
});

// Every cmd wrapper this repo ships or generates carries the same
// working-directory guard: cmd.exe resolves a bare command name against the
// current directory before PATH, and reads NoDefaultCurrentDirectoryInExePath
// from its own environment, so a wrapper that launches a bare interpreter
// without setting it first lets whatever directory the caller is sitting in
// supply that interpreter.
//
// This pin carries two separate claims, split into two mechanisms because
// neither is honestly established by the other's evidence. The class claim,
// that a wrapper added later is covered rather than exempt, rests on
// fail-closed enrollment below: every tracked .cmd and .bat git discovers
// must be enrolled with a run recipe, and an unenrolled wrapper reds rather
// than passing unswept. The behaviour claim, that an enrolled wrapper is
// safe, rests on running it: a hand model of cmd.exe is a claim about the
// model, not about the wrapper, so each enrolled wrapper is instead run from
// a directory holding a decoy of the interpreter it launches, with the guard
// absent from the calling environment, and passes only when the launch
// happened, the decoy did not, and the environment and working directory
// after the call match a call-free baseline. A run covers the path it takes,
// so every enrolled wrapper is also held to a straight-line shape allowlist:
// a line outside that allowlist is refused rather than judged, so a wrapper
// that grows a branch reds until its recipe covers each path, rather than
// this pin silently running only the one path it happened to take.
//
// Off Windows, the behaviour half and the generated wrapper's text (which
// needs powershell.exe) skip by name below; enrollment, shape and the
// line-ending delivery pin at the end of this file are checked there.
//
// What no run here closes, stated rather than swept. The wrapper's own name
// still resolves from the caller's directory ahead of PATH, which is a property
// of how cmd.exe finds this file in the first place rather than of anything a
// launch line inside it can set. And the behaviour these runs establish is that
// of the path a wrapper takes with no arguments: every wrapper here ends its
// launch line with %*, and percent expansion happens before cmd.exe parses the
// line, so an argument can create command positions at runtime that neither the
// static allowlist nor an argument-free run reads.
const CMD_GUARD_RE = /^@?set\s+"?NoDefaultCurrentDirectoryInExePath=1"?\s*$/i;

// Recipes are keyed by repo-relative path for a tracked wrapper, matching
// what `git ls-files` reports, and by a synthetic key for the generated
// memq.cmd, which exists nowhere on disk in this tree and so cannot collide
// with anything git discovers.
const GENERATED_MEMQ_CMD_KEY = '<generated:memq.cmd>';
const WRAPPER_RECIPES = {
    'doctor.cmd': { launches: 'powershell', script: 'doctor.ps1' },
    'plugins/claude-kit/doctor/doctor.cmd': { launches: 'powershell', script: 'doctor.ps1' },
    [GENERATED_MEMQ_CMD_KEY]: { launches: 'node', script: 'memq-shim.js' }
};

const MEMQ_INSTALLER_PATH = path.join(REPO, 'plugins', 'claude-kit', 'doctor', 'install-memq-shim.ps1');

// The one pathspec both wrapper sweeps discover through, so enrollment and the
// line-ending pin cannot come to disagree about what a wrapper is. Git's
// pathspec matching is case-sensitive even on a core.ignorecase checkout, while
// cmd.exe runs Foo.CMD and foo.Bat exactly as it runs foo.cmd, so a plain
// '*.cmd' would leave an extension spelled in any other casing discovered by
// neither sweep: unenrolled, unrun and unswept, with both tests still green.
// The :(icase) magic prefix is what makes the discovered set the set cmd.exe
// would execute.
const WRAPPER_PATHSPEC = [':(icase)*.cmd', ':(icase)*.bat'];

// Compares what git discovers against what this file's recipe table names,
// in both directions, so it can be driven with plain arrays as its own
// control rather than only through a live git call. A discovered wrapper
// absent from recipeKeys is unenrolled: this pin refuses to sweep a wrapper
// it has never run. A recipe key absent from discovered is stale, which
// catches a rename or deletion the recipe table never followed. The
// generated wrapper's synthetic key is exempt from the stale check, since
// git never discovers it: nothing on disk in this tree carries that path.
function enrollmentGaps(discovered, recipeKeys) {
    const discoveredSet = new Set(discovered);
    const recipeSet = new Set(recipeKeys);
    const unenrolled = discovered.filter((rel) => !recipeSet.has(rel));
    const stale = recipeKeys.filter((key) => key !== GENERATED_MEMQ_CMD_KEY && !discoveredSet.has(key));
    return { unenrolled, stale };
}

// Split on the separators cmd.exe reads outside double quotes. Used only to
// count segments below: a launch line may carry none but its own. The model is
// a plain double-quote toggle, which is what cmd.exe does only for a line
// carrying no caret and an even number of quotes; a line outside that is
// refused by launchLineProblem before it reaches here rather than modelled.
function splitOnSeparators(line) {
    const segments = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') { quoted = !quoted; current += ch; continue; }
        if (!quoted && (ch === '&' || ch === '|')) {
            segments.push(current);
            current = '';
            if (line[i + 1] === ch) { i += 1; }
            continue;
        }
        current += ch;
    }
    segments.push(current);
    return segments;
}

// Why each refusal reason exists, since a control that reds on the wrong rule
// proves nothing about the rule it was written for:
//
// not-launch-token    the line's first whitespace-delimited token must be the
//                     recipe's launches token whole, not a token that merely
//                     starts with it. A word-boundary match accepts
//                     powershell.exe, which cmd.exe resolves without consulting
//                     PATHEXT, so no decoy named for the bare token is ever
//                     reached and the decoy leg goes vacuous while reading
//                     green.
// script-not-named    the script must be named through the wrapper-directory
//                     expansion, so the script the real interpreter runs is
//                     always this run's own stub rather than the real doctor.
// caret               cmd.exe reads ^ as an escape, so a caret can hide a quote
//                     and let a second command ride on a line that reads as
//                     one. No wrapper here needs a caret, so carrying one is
//                     refused outright rather than modelled.
// unbalanced-quotes   an odd number of double quotes leaves the rest of the
//                     line inside a quoted run for the segment counter and
//                     outside one for cmd.exe, which is the same second-command
//                     hole by another route.
// redirection         an unquoted < or > opens a file the run never observes.
// multiple-segments   an unquoted & or | carries a second command outright.
//
// The direction that is safe here is refusal: this is a fail-closed allowlist,
// so refusing a launch line that would in fact have been harmless reds loudly
// and gets read, while accepting one that would not have been passes silently.
const LAUNCH_NOT_TOKEN = 'not-launch-token';
const LAUNCH_SCRIPT_NOT_NAMED = 'script-not-named';
const LAUNCH_CARET = 'caret';
const LAUNCH_UNBALANCED_QUOTES = 'unbalanced-quotes';
const LAUNCH_REDIRECTION = 'redirection';
const LAUNCH_MULTIPLE_SEGMENTS = 'multiple-segments';

// The reason the recipe's one launch line is refused, or null when it is
// allowed. A reason code rather than a boolean, so a control can assert which
// rule refused its line: a control that reds because some other rule got there
// first says nothing about the rule it was written for.
function launchLineProblem(line, recipe) {
    const escaped = recipe.launches.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp('^' + escaped + '(\\s|$)', 'i').test(line)) return LAUNCH_NOT_TOKEN;
    if (!line.includes('"%~dp0' + recipe.script + '"')) return LAUNCH_SCRIPT_NOT_NAMED;
    if (line.includes('^')) return LAUNCH_CARET;
    if ((line.match(/"/g) || []).length % 2 !== 0) return LAUNCH_UNBALANCED_QUOTES;
    for (const segment of splitOnSeparators(line)) {
        const outsideQuotes = segment.replace(/"[^"]*"/g, '');
        if (/[<>]/.test(outsideQuotes)) return LAUNCH_REDIRECTION;
    }
    if (splitOnSeparators(line).length !== 1) return LAUNCH_MULTIPLE_SEGMENTS;
    return null;
}

function isLaunchLine(line, recipe) {
    return launchLineProblem(line, recipe) === null;
}

// Every line of an enrolled wrapper, trimmed and stripped of a leading @,
// must be one of a fixed set of shapes: empty, a rem comment (which consumes
// its own line, separators included, so anything after it is prose rather
// than a second command), `echo off`, `setlocal` exactly, the guard line, an
// `exit /b` with at most one trailing token, or the recipe's one launch
// line. Refusing anything else is what makes the run below judge the
// wrapper's only path rather than one traversal of several.
function isAllowedShapeLine(rawLine, recipe) {
    const line = rawLine.trim().replace(/^@+/, '');
    if (line === '') return true;
    if (/^rem\b/i.test(line)) return true;
    if (/^echo\s+off$/i.test(line)) return true;
    if (/^setlocal$/i.test(line)) return true;
    if (CMD_GUARD_RE.test(line)) return true;
    if (/^exit\s*\/b(\s+\S+)?$/i.test(line)) return true;
    return isLaunchLine(line, recipe);
}

// Every line outside the allowlist, named with its 1-based line number, so a
// wrapper that grows a branch reds naming exactly what it grew.
function shapeViolations(text, recipe) {
    const violations = [];
    text.split(/\r?\n/).forEach((rawLine, i) => {
        if (!isAllowedShapeLine(rawLine, recipe)) violations.push({ lineNumber: i + 1, line: rawLine });
    });
    return violations;
}

function describeViolations(violations) {
    return violations.map((v) => 'line ' + v.lineNumber + ': ' + JSON.stringify(v.line)).join('; ');
}

// Where the three lines that carry a wrapper's whole meaning sit, by 1-based
// line number. The allowlist above PERMITS a guard line and a launch line; it
// does not REQUIRE either, so on its own it reads a wrapper with the guard line
// deleted as perfectly in shape. This is what requires them, and it is text, so
// it holds on every platform rather than resting on the Windows-only run.
function wrapperStructure(text, recipe) {
    const guard = [];
    const launch = [];
    const setlocal = [];
    text.split(/\r?\n/).forEach((rawLine, i) => {
        const line = rawLine.trim().replace(/^@+/, '');
        if (CMD_GUARD_RE.test(line)) guard.push(i + 1);
        else if (isLaunchLine(line, recipe)) launch.push(i + 1);
        else if (/^setlocal$/i.test(line)) setlocal.push(i + 1);
    });
    return { guard, launch, setlocal };
}

// Sentinels this run's own instrumentation writes and reads. None collides
// with a real environment variable or with anything a wrapper's real script
// could print, so parsing never mistakes real output for the harness's own
// markers.
const PIN_LAUNCHED = '__KIT_PIN_LAUNCHED__';
const PIN_DECOY = '__KIT_PIN_DECOY__';
const PIN_ENV_BEGIN = '__KIT_PIN_ENV_BEGIN__';
const PIN_ENV_END = '__KIT_PIN_ENV_END__';
const PIN_CWD_BEGIN = '__KIT_PIN_CWD_BEGIN__';
const PIN_CWD_END = '__KIT_PIN_CWD_END__';
const PIN_END = '__KIT_PIN_END__';

// cmd.exe by absolute path, never a bare name: this run exists to observe what
// a bare interpreter name resolves to, so the harness's own interpreter must
// not depend on the same search it is measuring. There is no bare-name
// fallback, which would be resolved by exactly that search: an unset SystemRoot
// reds instead, which on the Windows-only path these runs take means the box is
// not in a state this instrument can measure anything in.
function cmdExePath() {
    assert.ok(process.env.SystemRoot,
        'SystemRoot is unset, so cmd.exe can only be reached by the same current-directory-then-PATH search this run exists to measure');
    return path.join(process.env.SystemRoot, 'System32', 'cmd.exe');
}

// The stub a recipe's script name resolves to, written beside wrapper.cmd so
// %~dp0<script> reaches it rather than the real doctor.ps1 or memq-shim.js.
// Its only job is proving it, and only it, ran.
function stubScriptText(scriptName) {
    if (scriptName.endsWith('.ps1')) return "Write-Output '" + PIN_LAUNCHED + "'\r\n";
    return "process.stdout.write('" + PIN_LAUNCHED + "');\n";
}

// The decoy: a batch file named for the recipe's launches token, sitting in
// the directory the wrapper is run from. cmd.exe resolves a bare command
// name against this directory before PATH unless the guard is in force, so
// this is what a wrapper's own guard has to keep from running.
function decoyScriptText() {
    return '@echo off\r\necho ' + PIN_DECOY + '\r\nexit /b 0\r\n';
}

// Runs one wrapper under a real cmd.exe from a directory holding a decoy of
// the interpreter it launches, with the guard variable absent from the
// calling environment: an inherited copy would silence the decoy and make
// the whole check vacuous, and the parent may carry it, since an MSYS2 shell
// such as Git Bash sets it (see the comment in kit-git-lib.js). wrapperPath
// is copied into place with copyFileSync so a CRLF wrapper's bytes survive
// untouched. The baseline is the identical trailing command with no wrapper
// call, so the environment and directory comparison is against a call-free
// run of the same command rather than an assumption about cmd.exe's own
// footprint.
//
// options.gateOnShape says which of the two kinds of wrapper this is, and it is
// required rather than defaulted, so every call site states which it is. An
// enrolled wrapper is gated: its shape is asserted BEFORE the spawn, so a
// wrapper carrying a line outside the allowlist is refused rather than run and
// judged on whichever of its several paths this one traversal happened to take.
// A control wrapper is ungated, since a control exists to make one leg speak
// and reaches that leg through a line the allowlist refuses by design.
//
// What the run establishes, exactly: the behaviour of the path the wrapper
// takes with no arguments. Every wrapper here ends its launch line with %*, and
// percent expansion happens before cmd.exe parses the line, so an argument can
// create command positions at runtime that neither this argument-free run nor
// the static allowlist reads. That path is stated, not swept.
function runWrapper(wrapperSourcePath, recipe, options) {
    assert.ok(options && typeof options.gateOnShape === 'boolean',
        'runWrapper must be told whether the shape gate applies, since an ungated run of an enrolled wrapper judges one path of several');
    if (options.gateOnShape) {
        const violations = shapeViolations(fs.readFileSync(wrapperSourcePath, 'utf8'), recipe);
        assert.deepStrictEqual(violations, [],
            wrapperSourcePath + ' carries a line outside its recipe\'s allowlist, so this run would cover one of several paths and is refused '
            + 'rather than taken: ' + describeViolations(violations));
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-pin-run-'));
    try {
        const workDir = path.join(root, 'work');
        const cwdDir = path.join(root, 'cwd');
        fs.mkdirSync(workDir);
        fs.mkdirSync(cwdDir);

        const wrapperPath = path.join(workDir, 'wrapper.cmd');
        fs.copyFileSync(wrapperSourcePath, wrapperPath);
        fs.writeFileSync(path.join(workDir, recipe.script), stubScriptText(recipe.script), 'utf8');
        fs.writeFileSync(path.join(cwdDir, recipe.launches + '.cmd'), decoyScriptText(), 'utf8');

        // The guard variable is withheld from the child in every casing.
        // Windows environment names are case-insensitive, so an ambient copy
        // spelled any other way would close cmd.exe's current-directory search
        // on its own, silence every decoy, and leave each wrapper's !decoyRan
        // reading green on evidence the caller supplied rather than on the
        // wrapper's own guard. The parent may well carry it: an MSYS2 shell
        // such as Git Bash sets it (see the comment in kit-git-lib.js).
        const env = childEnvWithout(['NoDefaultCurrentDirectoryInExePath']);

        const tail = 'echo ' + PIN_ENV_BEGIN + ' & set & echo ' + PIN_ENV_END
            + ' & echo ' + PIN_CWD_BEGIN + ' & cd & echo ' + PIN_CWD_END
            + ' & echo ' + PIN_END;

        function spawnOnce(withCall) {
            const cmdLine = withCall ? ('"' + wrapperPath + '" & ' + tail) : tail;
            return spawnSync(cmdExePath(), ['/d', '/c', cmdLine], {
                encoding: 'utf8',
                cwd: cwdDir,
                env,
                windowsVerbatimArguments: true,
                timeout: 60000,
                maxBuffer: 16 * 1024 * 1024
            });
        }

        const baseline = spawnOnce(false);
        const withCall = spawnOnce(true);

        function readMarked(stdout, beginMark, endMark) {
            const start = stdout.indexOf(beginMark);
            const stop = stdout.indexOf(endMark);
            if (start < 0 || stop < start) return [];
            return stdout.slice(start + beginMark.length, stop)
                .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        }

        function readSide(res, label) {
            // Never put the raw environment dump in an assertion message:
            // it can run to dozens of lines, and the status plus a bounded
            // slice of stderr is enough to diagnose a spawn failure.
            assert.strictEqual(res.status, 0,
                label + ': the run harness itself failed under cmd.exe: status=' + res.status
                + ' error=' + (res.error ? res.error.message : 'none')
                + ' stderrFirst=' + JSON.stringify((res.stderr || '').split(/\r?\n/)[0] || ''));
            const stdout = res.stdout || '';
            return {
                ended: stdout.includes(PIN_END),
                launched: stdout.includes(PIN_LAUNCHED),
                decoyRan: stdout.includes(PIN_DECOY),
                env: parseEnvDump(readMarked(stdout, PIN_ENV_BEGIN, PIN_ENV_END)),
                cwd: readMarked(stdout, PIN_CWD_BEGIN, PIN_CWD_END).join('\n')
            };
        }

        const base = readSide(baseline, 'baseline');
        const call = readSide(withCall, 'call');

        return {
            ended: call.ended,
            launched: call.launched,
            decoyRan: call.decoyRan,
            envDelta: computeDelta(base.env, call.env),
            cwdChanged: base.cwd !== call.cwd
        };
    } finally {
        rmDir(root);
    }
}

// The five properties an enrolled wrapper's run is judged on together: a
// decoy that ran means the guard was not in force at the moment cmd.exe
// resolved the interpreter, which a guard line merely sitting above the
// launch does not prove, and a non-empty envDelta or a changed working
// directory means something outlived the call in the caller's own shell.
function assertRunIsSafe(label, recipe, result) {
    assert.ok(result.ended, label + ': the outer command line never reached its end sentinel, so the call did not complete as observed');
    assert.ok(result.launched,
        label + ': ' + recipe.script + ' never printed its launch sentinel, so nothing here credits the guard with stopping the decoy');
    assert.ok(!result.decoyRan,
        label + ': the decoy ' + recipe.launches + '.cmd ran from the calling directory, so cmd.exe resolved the bare interpreter name '
        + 'against that directory instead of the guard closing the search');
    assert.ok(result.envDelta.size === 0,
        label + ': the environment changed between the call-free baseline and the call, naming '
        + [...result.envDelta.values()].slice(0, 10).map((v) => v.name).join(', ')
        + (result.envDelta.size > 10 ? ' (+' + (result.envDelta.size - 10) + ' more)' : '')
        + ', so something outlived the wrapper in the caller\'s own shell');
    assert.ok(!result.cwdChanged, label + ': the working directory changed between the call-free baseline and the call, so the wrapper moved the caller\'s own shell');
}

function withSyntheticWrapper(text, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-pin-synth-'));
    try {
        const p = path.join(dir, 'synthetic.cmd');
        fs.writeFileSync(p, text, 'utf8');
        fn(p);
    } finally {
        rmDir(dir);
    }
}

// The text Get-MemqCmdWrapperText actually emits, read by dot-sourcing the
// installer and calling the function rather than re-parsing its source, so
// the text under test is what the installer writes rather than a second
// hand parse of the generator. The readback writer is the installer's own,
// UTF8Encoding($false) (install-memq-shim.ps1:150), so the bytes read here are
// the bytes the installer writes: a narrower encoding would replace any
// non-ASCII byte the generator emits with a question mark before the shape and
// run legs ever saw it. Asserts CRLF on those real bytes, since cmd.exe parses
// a batch file by CRLF lines.
function withGeneratedMemqCmdFile(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-pin-gen-'));
    try {
        const outFile = path.join(dir, 'memq.cmd');
        const script = '. ' + q(MEMQ_INSTALLER_PATH) + '; '
            + '$t = Get-MemqCmdWrapperText; '
            + '[System.IO.File]::WriteAllText(' + q(outFile) + ', $t, (New-Object System.Text.UTF8Encoding($false)))';
        const res = spawnSync(POWERSHELL_EXE,
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
            { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
        assert.strictEqual(res.status, 0,
            'the installer dot-source failed to emit memq.cmd: status=' + res.status
            + ' stderrFirst=' + JSON.stringify((res.stderr || '').split(/\r?\n/)[0] || ''));
        const bytes = fs.readFileSync(outFile);
        const text = bytes.toString('utf8');
        assert.ok(bytes.includes(0x0d) && bytes.includes(0x0a),
            'the emitted memq.cmd carries no CR-LF pair, so cmd.exe is not reliable parsing it: ' + JSON.stringify(text));
        assert.ok(!/(?<!\r)\n/.test(text),
            'the emitted memq.cmd carries a bare LF, which cmd.exe does not reliably parse: ' + JSON.stringify(text));
        fn(outFile);
    } finally {
        rmDir(dir);
    }
}

test('enrollmentGaps flags an unenrolled discovery and a stale recipe independently, in each direction', () => {
    const clean = enrollmentGaps(['a.cmd', 'b.cmd'], ['a.cmd', 'b.cmd']);
    assert.deepStrictEqual(clean.unenrolled, [], 'control: a discovery set equal to the recipe set names no unenrolled gap');
    assert.deepStrictEqual(clean.stale, [], 'control: a discovery set equal to the recipe set names no stale recipe');

    const gap = enrollmentGaps(['a.cmd', 'b.cmd', 'c.cmd'], ['a.cmd', 'b.cmd']);
    assert.deepStrictEqual(gap.unenrolled, ['c.cmd'], 'control: a discovered wrapper absent from the recipe table must be named as unenrolled');

    const staleGap = enrollmentGaps(['a.cmd'], ['a.cmd', 'z.cmd']);
    assert.deepStrictEqual(staleGap.stale, ['z.cmd'], 'control: a recipe naming a path git no longer discovers must be named as stale');
});

// enrollmentGaps is driven above on plain arrays, which says nothing about what
// the discovery predicate ahead of it actually reaches. This drives the real
// pathspec against a throwaway repository holding two wrappers spelled in
// casings the pathspec's own literals never name, so what is measured is reach
// rather than the plumbing: the lowercase-only pathspec these literals read as
// finds neither, which is what makes finding both evidence of anything.
test('the wrapper discovery pathspec finds a wrapper whose extension casing its own literals do not name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-pin-discovery-'));
    try {
        fs.writeFileSync(path.join(dir, 'Foo.CMD'), '@echo off\r\n', 'utf8');
        fs.writeFileSync(path.join(dir, 'bar.Bat'), '@echo off\r\n', 'utf8');
        // gitRun returns a result object for any git that ran to completion,
        // whatever its exit code, so the exit code is what says the setup
        // worked: a failed init followed by a failed add leaves an empty
        // listing, which reads exactly like a discovery predicate that misses.
        const init = gitRun(dir, ['init']);
        assert.ok(init && init.status === 0,
            'the control repository could not be initialised (' + JSON.stringify(init) + '), so this control measured nothing');
        const add = gitRun(dir, ['add', '-A']);
        assert.ok(add && add.status === 0,
            'the control wrappers could not be staged (' + JSON.stringify(add) + '), so this control measured nothing');

        const listed = gitOutput(dir, ['-c', 'core.quotePath=false', 'ls-files', '--'].concat(WRAPPER_PATHSPEC));
        assert.ok(listed !== null, 'the git call that discovers the wrappers did not succeed, so this control measured nothing');
        const found = listed.split('\n').map((s) => s.trim()).filter(Boolean).sort();
        assert.deepStrictEqual(found, ['Foo.CMD', 'bar.Bat'],
            'the discovery pathspec misses a wrapper whose extension is spelled in another casing, which cmd.exe executes all the same, '
            + 'so such a wrapper would be unenrolled, unrun and unswept with every test here still green: ' + JSON.stringify(found));

        const caseSensitive = gitOutput(dir, ['-c', 'core.quotePath=false', 'ls-files', '--', '*.cmd', '*.bat']);
        assert.ok(caseSensitive !== null, 'the case-sensitive git call did not succeed, so the half of this control that shows the reach is real measured nothing');
        assert.deepStrictEqual(caseSensitive.split('\n').map((s) => s.trim()).filter(Boolean), [],
            'git pathspec matching is case-insensitive on this checkout, so the :(icase) prefix carries no weight here and this control '
            + 'does not show what the reach costs');
    } finally {
        rmDir(dir);
    }
});

test('every tracked cmd/bat wrapper is enrolled with a run recipe, and no recipe names a stale path', () => {
    const listed = gitOutput(REPO, ['-c', 'core.quotePath=false', 'ls-files', '--'].concat(WRAPPER_PATHSPEC));
    assert.ok(listed !== null, 'the git call that discovers the wrappers did not succeed, so this pin swept nothing');
    const discovered = listed.split('\n').map((s) => s.trim()).filter(Boolean);
    assert.ok(discovered.length > 0, 'no tracked .cmd or .bat wrapper was discovered, so this pin swept nothing');
    const { unenrolled, stale } = enrollmentGaps(discovered, Object.keys(WRAPPER_RECIPES));
    assert.deepStrictEqual(unenrolled, [],
        'a tracked wrapper git discovered carries no run recipe here, so this pin would sweep it as though it did not exist: ' + unenrolled.join(', '));
    assert.deepStrictEqual(stale, [],
        'a recipe here names a path git no longer tracks, which may mean a rename escaped this pin: ' + stale.join(', '));
});

test('every tracked cmd/bat wrapper is a straight line in its recipe\'s allowlisted shape', () => {
    for (const [rel, recipe] of Object.entries(WRAPPER_RECIPES)) {
        if (rel === GENERATED_MEMQ_CMD_KEY) continue;
        const text = fs.readFileSync(path.join(REPO, rel), 'utf8');
        const violations = shapeViolations(text, recipe);
        assert.deepStrictEqual(violations, [],
            rel + ' carries a line outside its recipe\'s allowlist, so the run below would cover only one of several paths: ' + describeViolations(violations));
    }
});

// The allowlist permits the guard line without requiring it, and the run that
// would notice a missing guard is Windows-only. This is text, so it runs
// everywhere: off Windows it is the whole of what holds a wrapper to carrying a
// scoped guard ahead of its launch.
function assertWrapperStructure(label, text, recipe) {
    const { guard, launch, setlocal } = wrapperStructure(text, recipe);
    assert.strictEqual(guard.length, 1,
        label + ' carries ' + guard.length + ' guard lines rather than one, so either nothing sets '
        + 'NoDefaultCurrentDirectoryInExePath before the launch and the bare interpreter name resolves from the caller\'s directory, '
        + 'or the setting is spelled more than once and this pin cannot say which one the launch runs under');
    assert.strictEqual(launch.length, 1,
        label + ' carries ' + launch.length + ' launch lines rather than one, so a run of it covers one launch of several');
    assert.ok(setlocal.length >= 1 && setlocal[0] < guard[0],
        label + ' sets the guard at line ' + guard[0] + ' with no setlocal above it (setlocal lines: '
        + JSON.stringify(setlocal) + '), so the setting outlives the call and changes how every later command '
        + 'the caller types resolves, for the life of that shell');
    assert.ok(guard[0] < launch[0],
        label + ' sets the guard at line ' + guard[0] + ' after its launch at line ' + launch[0]
        + ', so cmd.exe resolves the interpreter name before anything closes the current-directory search');
}

test('every tracked cmd/bat wrapper carries exactly one scoped guard ahead of exactly one launch', () => {
    for (const [rel, recipe] of Object.entries(WRAPPER_RECIPES)) {
        if (rel === GENERATED_MEMQ_CMD_KEY) continue;
        assertWrapperStructure(rel, fs.readFileSync(path.join(REPO, rel), 'utf8'), recipe);
    }
});

// The structure predicate's own control, on a shape withheld from every literal
// it reads: a wrapper in perfectly allowlisted shape whose guard line is simply
// absent. The allowlist accepts it, which is the gap this predicate closes.
test('the structure check refuses an allowlisted wrapper whose guard line is absent', () => {
    const recipe = WRAPPER_RECIPES['doctor.cmd'];
    const unguarded = '@echo off\r\nsetlocal\r\npowershell -NoProfile -File "%~dp0doctor.ps1" %*\r\nexit /b %ERRORLEVEL%\r\n';
    assert.deepStrictEqual(shapeViolations(unguarded, recipe), [],
        'control: this wrapper must be inside the shape allowlist, or it is not showing that the allowlist alone lets a guard go missing');
    assert.throws(() => assertWrapperStructure('control', unguarded, recipe),
        (err) => err instanceof assert.AssertionError && /carries 0 guard lines rather than one/.test(err.message),
        'control: a wrapper the allowlist accepts with no guard line at all must be refused here, naming the missing guard');
});

test('the shape allowlist refuses every line withheld from its own literals, naming the line', () => {
    const recipe = WRAPPER_RECIPES['doctor.cmd'];
    const cases = [
        ['a case-insensitive if comparison with a set body', 'if /i "a"=="a" set LEAK=1'],
        ['the space-less arithmetic set form', 'set/a LEAK=5'],
        ['a closing-paren else opener', ') else ('],
        ['an echo chained by an ampersand to a rem', 'echo hi & rem note'],
        ['a goto to a label', 'goto :end'],
        ['a call of another wrapper', 'call other.cmd'],
        ['a second set line', 'set OTHER=1']
    ];
    for (const [name, line] of cases) {
        assert.ok(!isAllowedShapeLine(line, recipe),
            'the allowlist must refuse ' + name + ', naming the line ' + JSON.stringify(line) + ', or an enrolled wrapper could grow it unnoticed');
    }
});

// An allowlist refuses everything outside its list by construction, so a
// refusal-side control says nothing about its reach: every case above would red
// identically under a predicate that refused every line ever put to it. These
// run the other way, over lines the launch rule ACCEPTS unless it is tight, and
// each names the rule that must do the refusing, because a control that reds
// because a different rule got there first proves nothing about the rule it was
// written for.
test('the launch rule refuses an accepted-shaped line by the rule that must refuse it', () => {
    const recipe = WRAPPER_RECIPES['doctor.cmd'];
    const cases = [
        ['an extension-bearing interpreter spelling',
            'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0doctor.ps1" %*',
            LAUNCH_NOT_TOKEN,
            'cmd.exe runs powershell.exe without consulting PATHEXT, so a decoy named for the bare token can never be reached and the '
            + 'decoy leg of every run below would read green while measuring nothing'],
        ['a hyphen-suffixed interpreter spelling',
            'powershell-preview -NoProfile -File "%~dp0doctor.ps1" %*',
            LAUNCH_NOT_TOKEN,
            'a different interpreter is launched than the one this recipe plants a decoy for'],
        ['a caret-escaped quote carrying a second command',
            'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0doctor.ps1" ^" & echo PWNED',
            LAUNCH_CARET,
            'cmd.exe reads the caret as an escape and runs the second command, which changes neither the environment nor the working '
            + 'directory, so no assertion in the run below would see it'],
        ['an odd double-quote count carrying a second command',
            'powershell -NoProfile -File "%~dp0doctor.ps1" " & echo PWNED',
            LAUNCH_UNBALANCED_QUOTES,
            'the segment counter reads the rest of the line as quoted and cmd.exe does not, so a second command rides on a line counted as one'],
        ['an unquoted redirection',
            'powershell -NoProfile -File "%~dp0doctor.ps1" > out.txt',
            LAUNCH_REDIRECTION,
            'the launch writes a file the run never observes'],
        ['an unquoted ampersand carrying a second command',
            'powershell -NoProfile -File "%~dp0doctor.ps1" & echo second',
            LAUNCH_MULTIPLE_SEGMENTS,
            'a second command runs on the launch line']
    ];
    for (const [name, line, expectedReason, consequence] of cases) {
        const reason = launchLineProblem(line, recipe);
        assert.strictEqual(reason, expectedReason,
            'the launch rule must refuse ' + name + ' by the ' + expectedReason + ' rule (it answered ' + JSON.stringify(reason)
            + '): otherwise ' + consequence);
        assert.ok(!isAllowedShapeLine(line, recipe),
            'the shape allowlist must refuse ' + name + ' outright: otherwise ' + consequence);
    }

    // The other half of the same instrument: the real launch line each tracked
    // wrapper carries is still accepted, so the tightening above is a rule
    // about spelling rather than a predicate that has stopped saying yes.
    assert.strictEqual(launchLineProblem('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0doctor.ps1" %*', recipe), null,
        'the launch rule refuses the spelling the tracked wrappers actually carry, so it has been tightened past the shape it exists to admit');
});

// The violation record's own numbering, which the shape test's messages name
// and nothing else exercises: isAllowedShapeLine alone says only yes or no.
test('shapeViolations names the offending line by its 1-based number', () => {
    const recipe = WRAPPER_RECIPES['doctor.cmd'];
    const text = '@echo off\r\nsetlocal\r\ngoto :end\r\nexit /b 0\r\n';
    const violations = shapeViolations(text, recipe);
    assert.deepStrictEqual(violations, [{ lineNumber: 3, line: 'goto :end' }],
        'the violation must name the third line by number, or a wrapper that grows a branch reds without saying where');
    assert.strictEqual(describeViolations(violations), 'line 3: "goto :end"',
        'the failure message must carry the line number and the line itself, or a reader cannot find what the wrapper grew');
});

test('the generated memq.cmd text is a straight line in its recipe\'s allowlisted shape', { skip: !isWin }, () => {
    withGeneratedMemqCmdFile((outFile) => {
        const text = fs.readFileSync(outFile, 'utf8');
        const recipe = WRAPPER_RECIPES[GENERATED_MEMQ_CMD_KEY];
        const violations = shapeViolations(text, recipe);
        assert.deepStrictEqual(violations, [],
            'Get-MemqCmdWrapperText emits a line outside its recipe\'s allowlist, so the run below would cover only one of several paths: ' + describeViolations(violations));
        assertWrapperStructure('the generated memq.cmd', text, recipe);
    });
});

test('every tracked cmd/bat wrapper passes all five run assertions under cmd.exe with a decoy of its interpreter planted in the calling directory', { skip: !isWin }, () => {
    for (const [rel, recipe] of Object.entries(WRAPPER_RECIPES)) {
        if (rel === GENERATED_MEMQ_CMD_KEY) continue;
        const result = runWrapper(path.join(REPO, rel), recipe, { gateOnShape: true });
        assertRunIsSafe(rel, recipe, result);
    }
});

test('the generated memq.cmd text passes all five run assertions under cmd.exe with a decoy of its interpreter planted in the calling directory', { skip: !isWin }, () => {
    withGeneratedMemqCmdFile((outFile) => {
        const recipe = WRAPPER_RECIPES[GENERATED_MEMQ_CMD_KEY];
        const result = runWrapper(outFile, recipe, { gateOnShape: true });
        assertRunIsSafe('the generated memq.cmd', recipe, result);
    });
});

// The decoy leg's own control: without it, !decoyRan on a real wrapper is
// silence rather than evidence, since a decoy that never runs on anything
// proves nothing about the guard.
test('an unguarded straight-line wrapper lets the decoy run', { skip: !isWin }, () => {
    withSyntheticWrapper('@echo off\r\npowershell -File "%~dp0doctor.ps1"\r\n', (p) => {
        const result = runWrapper(p, { launches: 'powershell', script: 'doctor.ps1' }, { gateOnShape: false });
        assert.ok(result.decoyRan, 'control: with no guard at all, the decoy must run');
    });
});

// The same leg for the other recipe. Every other decoy control here plants a
// powershell decoy, so nothing else shows a node decoy ever runs: without this,
// the generated memq.cmd's !decoyRan would read exactly the same whether its
// guard held or its decoy was simply inert.
test('an unguarded straight-line node wrapper lets the node decoy run', { skip: !isWin }, () => {
    withSyntheticWrapper('@echo off\r\nnode "%~dp0memq-shim.js"\r\n', (p) => {
        const result = runWrapper(p, { launches: 'node', script: 'memq-shim.js' }, { gateOnShape: false });
        assert.ok(result.decoyRan, 'control: with no guard at all, the node decoy must run, or the generated wrapper\'s decoy leg is measuring nothing');
    });
});

// The shape gate's own control, on a wrapper carrying a line the allowlist
// refuses. The gate reds before mkdtemp and before either spawn, so an enrolled
// wrapper that grew a branch is refused rather than run and judged on whichever
// of its paths this one traversal happened to take.
test('the shape gate refuses a gated wrapper carrying a line outside the allowlist rather than running it', { skip: !isWin }, () => {
    withSyntheticWrapper(
        '@echo off\r\nsetlocal\r\nset "NoDefaultCurrentDirectoryInExePath=1"\r\ngoto :end\r\npowershell -File "%~dp0doctor.ps1"\r\n',
        (p) => {
            assert.throws(() => runWrapper(p, { launches: 'powershell', script: 'doctor.ps1' }, { gateOnShape: true }),
                (err) => err instanceof assert.AssertionError && /line 4: "goto :end"/.test(err.message),
                'control: a gated wrapper carrying a branch must be refused by the shape gate, naming the line, rather than run down one of its paths');
        });
});

test('a guard set with no setlocal leaks the guard variable into the caller\'s shell', { skip: !isWin }, () => {
    withSyntheticWrapper('@echo off\r\nset "NoDefaultCurrentDirectoryInExePath=1"\r\npowershell -File "%~dp0doctor.ps1"\r\n', (p) => {
        const result = runWrapper(p, { launches: 'powershell', script: 'doctor.ps1' }, { gateOnShape: false });
        assert.ok(!result.decoyRan, 'control: the guard was in force at the launch, so the decoy must not have run');
        assert.ok(result.launched, 'control: the real script must have run under the guard');
        assert.ok(result.envDelta.has('NODEFAULTCURRENTDIRECTORYINEXEPATH'),
            'control: an unscoped guard must outlive the call, naming the guard variable');
    });
});

test('a guard discarded by endlocal before a plain set leaks the set into the caller\'s shell', { skip: !isWin }, () => {
    withSyntheticWrapper(
        '@echo off\r\nsetlocal\r\nset "NoDefaultCurrentDirectoryInExePath=1"\r\nendlocal & set KIT_PIN_LEAK=1\r\npowershell -File "%~dp0doctor.ps1"\r\n',
        (p) => {
            const result = runWrapper(p, { launches: 'powershell', script: 'doctor.ps1' }, { gateOnShape: false });
            assert.ok(result.envDelta.has('KIT_PIN_LEAK'), 'control: a set chained onto endlocal runs outside the scope and must leak, naming KIT_PIN_LEAK');
        });
});

test('a guard discarded by endlocal before a case-insensitive if-set leaks the assignment into the caller\'s shell', { skip: !isWin }, () => {
    withSyntheticWrapper(
        '@echo off\r\nsetlocal\r\nset "NoDefaultCurrentDirectoryInExePath=1"\r\nendlocal & if /i "a"=="a" set KIT_PIN_LEAK=1\r\npowershell -File "%~dp0doctor.ps1"\r\n',
        (p) => {
            const result = runWrapper(p, { launches: 'powershell', script: 'doctor.ps1' }, { gateOnShape: false });
            assert.ok(result.envDelta.has('KIT_PIN_LEAK'),
                'control: an assignment reached through a case-insensitive if, chained onto endlocal, runs outside the scope and must leak, naming KIT_PIN_LEAK');
        });
});

test('a guard discarded by endlocal before the space-less arithmetic set form leaks the assignment into the caller\'s shell', { skip: !isWin }, () => {
    withSyntheticWrapper(
        '@echo off\r\nsetlocal\r\nset "NoDefaultCurrentDirectoryInExePath=1"\r\nendlocal & set/a KIT_PIN_LEAK=5\r\npowershell -File "%~dp0doctor.ps1"\r\n',
        (p) => {
            const result = runWrapper(p, { launches: 'powershell', script: 'doctor.ps1' }, { gateOnShape: false });
            assert.ok(result.envDelta.has('KIT_PIN_LEAK'),
                'control: the space-less arithmetic set form, chained onto endlocal, runs outside the scope and must leak, naming KIT_PIN_LEAK');
        });
});

test('a guard set, then discarded by endlocal, before the launch lets the decoy run', { skip: !isWin }, () => {
    withSyntheticWrapper(
        '@echo off\r\nsetlocal\r\nset "NoDefaultCurrentDirectoryInExePath=1"\r\nendlocal\r\npowershell -File "%~dp0doctor.ps1"\r\n',
        (p) => {
            const result = runWrapper(p, { launches: 'powershell', script: 'doctor.ps1' }, { gateOnShape: false });
            assert.ok(result.decoyRan, 'control: the guard was discarded by endlocal before the launch, so the decoy must run');
        });
});

test('an unscoped directory change reaches the caller, and the same change under setlocal does not', { skip: !isWin }, () => {
    withSyntheticWrapper(
        '@echo off\r\nset "NoDefaultCurrentDirectoryInExePath=1"\r\ncd "%~dp0"\r\npowershell -File "%~dp0doctor.ps1"\r\n',
        (p) => {
            const result = runWrapper(p, { launches: 'powershell', script: 'doctor.ps1' }, { gateOnShape: false });
            assert.ok(result.cwdChanged, 'control: an unscoped cd must change the caller\'s own working directory');
        });
    withSyntheticWrapper(
        '@echo off\r\nsetlocal\r\nset "NoDefaultCurrentDirectoryInExePath=1"\r\ncd "%~dp0"\r\npowershell -File "%~dp0doctor.ps1"\r\n',
        (p) => {
            const result = runWrapper(p, { launches: 'powershell', script: 'doctor.ps1' }, { gateOnShape: false });
            assert.ok(!result.cwdChanged, 'control: setlocal saves and restores the working directory, so a scoped cd must not change it');
        });
});

test('the real emitted memq.cmd wrapper, stripped of its scoping line, leaks the guard variable into the caller\'s shell', { skip: !isWin }, () => {
    withGeneratedMemqCmdFile((outFile) => {
        const text = fs.readFileSync(outFile, 'utf8');
        const withoutSetlocal = text.split(/\r?\n/).filter((l) => !/^@?setlocal\b/i.test(l)).join('\r\n');
        assert.notStrictEqual(withoutSetlocal, text, 'control: the emitted wrapper carries no setlocal line to remove');
        withSyntheticWrapper(withoutSetlocal, (p) => {
            const recipe = WRAPPER_RECIPES[GENERATED_MEMQ_CMD_KEY];
            const result = runWrapper(p, recipe, { gateOnShape: false });
            assert.ok(result.envDelta.has('NODEFAULTCURRENTDIRECTORYINEXEPATH'),
                'control: the emitted wrapper stripped of its setlocal must leak the guard variable into the caller\'s shell');
        });
    });
});

// The eol pin's two surfaces (the tracked .gitattributes text, and the
// attribute column git ls-files --eol reports) go through this one token
// predicate, so the two cannot silently disagree about what counts as
// CRLF-by-attribute the way a file-level word-boundary match and a
// whole-token column match once did. Tokenized on whitespace so `-text` and
// `text=auto` are refused by not being the whole token `text`, rather than
// matched as a substring or a word-boundary of it.
function attributesGrantCrlfText(attrString) {
    const tokens = attrString.trim().split(/\s+/).filter(Boolean);
    return tokens.includes('text') && tokens.includes('eol=crlf');
}

test('the eol token predicate rejects -text and text=auto and accepts only the whole tokens text and eol=crlf', () => {
    assert.ok(!attributesGrantCrlfText('-text eol=crlf'), 'control: -text must not satisfy the predicate');
    assert.ok(!attributesGrantCrlfText('text=auto eol=crlf'), 'control: text=auto must not satisfy the predicate');
    assert.ok(attributesGrantCrlfText('text eol=crlf'), 'control: the whole tokens text and eol=crlf must satisfy the predicate');
});

// cmd.exe parses a batch file by CRLF lines, which is why the generated
// wrapper is built CRLF-terminated. A tracked wrapper carries whatever the
// cloner's core.autocrlf produces unless an attribute fixes it, so without
// one a clone made with autocrlf=false, or a source archive, delivers
// LF-only batch files and the guard lines above are parsed by a parser that
// is not reliable on them. The attribute is what makes the delivered bytes
// the same everywhere, so it is pinned rather than assumed.
test('every tracked cmd wrapper is delivered CRLF by attribute rather than by the cloner\'s config', () => {
    // The attribute column reports the rule in force on this checkout, and
    // a machine-local .git/info/attributes supplies one just as well as a
    // tracked file does. What a clone receives is the tracked file, so it is
    // read directly rather than inferred from the column.
    const attributes = fs.readFileSync(path.join(REPO, '.gitattributes'), 'utf8');
    const cmdRule = attributes.match(/^\*\.cmd\s+(.+)$/m);
    assert.ok(cmdRule && attributesGrantCrlfText(cmdRule[1]),
        'the tracked .gitattributes carries no eol=crlf text rule for *.cmd, so what a clone receives is decided by that machine\'s '
        + 'core.autocrlf rather than by the repository');
    const batRule = attributes.match(/^\*\.bat\s+(.+)$/m);
    assert.ok(batRule && attributesGrantCrlfText(batRule[1]),
        'the tracked .gitattributes carries no eol=crlf text rule for *.bat, so a .bat wrapper added later is delivered by that machine\'s '
        + 'core.autocrlf rather than by the repository');

    const listed = gitOutput(REPO, ['-c', 'core.quotePath=false', 'ls-files', '--eol', '--'].concat(WRAPPER_PATHSPEC));
    assert.ok(listed !== null, 'the git call that reports the wrappers\' line endings did not succeed');
    const rows = listed.split('\n').map((s) => s.trim()).filter(Boolean);
    assert.ok(rows.length > 0, 'no tracked wrapper was discovered, so this pin swept nothing');
    for (const row of rows) {
        const attrs = (row.split('\t')[0].split('attr/')[1] || '').trim();
        assert.ok(attributesGrantCrlfText(attrs),
            'this wrapper is not delivered as CRLF text by attribute (attrs=' + JSON.stringify(attrs) + '), so what a clone receives is decided '
            + 'by that machine\'s core.autocrlf rather than by the repository, and cmd.exe is not reliable parsing an LF-only batch file: ' + row);
    }
});
