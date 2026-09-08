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
// guards alone. The cmd-wrapper pins at the end of this file are source-text
// pins on purpose: what they assert is a property of the wrapper text itself,
// which is the artifact cmd.exe reads, and one of the two wrappers exists in
// the tree only as a string its generator returns.
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
const { gitOutput } = require(JS_PATH);

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

        // Windows environment names are case-insensitive, but a plain object
        // is not: { ...process.env, ...PLANTED } can leave two differently
        // cased keys for the same logical name (an ambient "Path" beside a
        // planted "PATH", say) sitting side by side in the object handed to
        // spawnSync, which is free to pass both through to the child's real
        // (case-insensitive, single-slot) environment block in either order.
        // Dropping any ambient key that matches a planted name, in any
        // casing, before adding the planted names back closes that
        // ambiguity: the child never sees two spellings of one name.
        const spawnEnv = { ...process.env };
        for (const name of Object.keys(PLANTED)) {
            const upper = name.toUpperCase();
            for (const k of Object.keys(spawnEnv)) {
                if (k.toUpperCase() === upper) delete spawnEnv[k];
            }
        }
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
// working-directory guard. cmd.exe resolves a bare command name against the
// current directory before PATH and reads
// NoDefaultCurrentDirectoryInExePath from its own environment, so a wrapper
// that launches a bare interpreter without setting it first lets whatever
// directory the caller is sitting in supply that interpreter. The wrappers
// are discovered from git rather than named, so a wrapper added later is
// covered by this pin rather than exempt from it; the generated memq.cmd is
// read from its generator, which is the only place its text exists in the
// tree.
// The guard is the assignment, not the spelling of the line that makes it:
// `@set X=1` and `set "X=1"` set the same variable, and a wrapper that chose
// the other form is guarded. Pinning one literal would red it while proving
// nothing about what the wrapper does.
const CMD_GUARD_RE = /^@?set\s+"?NoDefaultCurrentDirectoryInExePath=1"?\s*$/i;
const CMD_GUARD_CANONICAL = 'set "NoDefaultCurrentDirectoryInExePath=1"';

// cmd.exe builtins, which change the shell's own state and launch nothing. The
// list is what a wrapper may do before its guard is in place; anything else is
// a launch, so an unlisted builtin fails loud as a false launch rather than
// quietly admitting an unguarded one.
const CMD_BUILTIN_RE =
    /^(echo|rem|set|setlocal|endlocal|pushd|popd|cd|chdir|path|title|color|verify|exit|goto|shift)\b/i;

// A mutation of the shell the wrapper runs in, which for an interactive caller
// is that caller's own shell. An assignment and a directory change are the
// members setlocal scopes; `path` rewrites the caller's PATH and is the same
// class. The directory forms cmd.exe accepts with no space (`cd..`, `cd\`,
// `cd/d`) are matched on the separator rather than on whitespace, since a
// pattern requiring a space reads them as the operand-less display form.
const CMD_MUTATION_RE =
    /^(set\s+\S|cd(\s+\S|[.\\/])|chdir(\s+\S|[.\\/])|pushd\s+\S|path(\s+\S|;))/i;

// cmd.exe runs more than one command per line, so every predicate below reads a
// wrapper as the ordered list of command positions the shell executes rather
// than as a list of lines. `&`, `&&`, `|` and `||` separate positions, and
// `if <condition>`, `for ... do`, `else` and an opening parenthesis each sit
// ahead of one. A predicate anchored to a line's first token sees only the
// first position, which is not where the leaks live: `endlocal & set X=1` is
// the idiomatic way to push a value past a scope, and `if not defined X set
// X=1` is the ordinary way to write a default.
//
// A comment consumes its whole line, separators included: `rem hello & echo
// hi` and `:: hello & echo hi` both run nothing after the comment, so a `&` in
// a wrapper's English prose is data rather than a second command. Splitting
// those lines would report a prose ampersand as an unguarded launch.
function commandPositions(text) {
    const positions = [];
    text.split(/\r?\n/).forEach((raw) => {
        const line = raw.trim().replace(/^@+/, '');
        if (line === '' || /^::/.test(line) || /^:/.test(line) || /^rem\b/i.test(line)) { return; }
        for (const segment of splitOnSeparators(line)) {
            const command = stripIntroducers(segment);
            // A parenthesis closing a block is punctuation rather than a
            // command, and reading one as a launch would red every wrapper
            // that grew a multi-line if.
            if (command !== '' && !/^[()]+$/.test(command)) { positions.push(command); }
        }
    });
    return positions;
}

// Split on the separators cmd.exe reads outside double quotes. A quoted
// separator is data, so `set "X=a&b"` is one command rather than two.
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

// Peel the keywords that sit ahead of a command until what is left starts at
// one. The `if` condition forms are cmd.exe's own; an unrecognized condition
// stops the peel and leaves the segment reading as whatever it starts with,
// which classifies it as a launch rather than admitting it silently.
function stripIntroducers(segment) {
    let s = segment.trim().replace(/^@+/, '');
    for (let guard = 0; guard < 8; guard += 1) {
        const before = s;
        s = s.replace(/^\(\s*/, '');
        s = s.replace(/\s*\)+$/, '');
        s = s.replace(/^(else|do)\s+/i, '');
        s = s.replace(/^for\s+.*?\s+do\s+/i, '');
        s = s.replace(/^if\s+(not\s+)?(defined\s+\S+|exist\s+\S+|errorlevel\s+\d+|"[^"]*"\s*==\s*"[^"]*"|\S+\s*==\s*\S+)\s+/i, '');
        if (s === before) { break; }
    }
    return s.trim();
}

// The guard has to be in force at the first launch, which is more than sitting
// above it in the file: an endlocal that pops the scope the guard was set in
// discards the assignment, so a wrapper reading setlocal, guard, endlocal,
// launch has a guard line ahead of its launch and no guard at the launch.
function guardPrecedesLaunch(text) {
    let depth = 0;
    let guardDepth = null;
    for (const command of commandPositions(text)) {
        if (/^setlocal\b/i.test(command)) { depth += 1; continue; }
        if (/^endlocal\b/i.test(command)) {
            depth = Math.max(0, depth - 1);
            if (guardDepth !== null && depth < guardDepth) { guardDepth = null; }
            continue;
        }
        if (CMD_GUARD_RE.test(command)) { guardDepth = depth; continue; }
        if (!CMD_BUILTIN_RE.test(command)) { return guardDepth !== null; }
    }
    return guardDepth !== null;
}

// A batch file started from an interactive prompt runs inside the caller's own
// cmd.exe, so a `set` the wrapper never scopes outlives the call and changes
// how that shell resolves every later command. This is the property rather
// than the one variable: any wrapper that assigns anything scopes it with
// setlocal first, so a guard added later cannot reintroduce the leak that the
// working-directory guard itself introduced when it was first written.
// The mutations are the ones cmd.exe applies to the process the wrapper runs
// in, which for an interactive caller is that caller's own shell: an
// assignment, and a directory change, which setlocal also saves and its
// endlocal restores. setx is the member setlocal cannot scope at all, since it
// writes the registry rather than the process, so it fails outright rather
// than being asked for a preceding setlocal it would not benefit from.
function scopesEnvironment(text) {
    let depth = 0;
    for (const command of commandPositions(text)) {
        // setx writes the registry rather than the process, so no scope
        // reaches it and it fails wherever it appears.
        if (/^setx\b/i.test(command)) { return false; }
        if (/^setlocal\b/i.test(command)) { depth += 1; continue; }
        if (/^endlocal\b/i.test(command)) { depth = Math.max(0, depth - 1); continue; }
        // Every mutation is judged, not just the first: a wrapper that scopes
        // its opening assignment and leaks a later one passes a predicate that
        // stops at the first.
        if (CMD_MUTATION_RE.test(command) && depth === 0) { return false; }
    }
    return true;
}

// The wrapper text Get-MemqCmdWrapperText emits, reconstructed from the array
// literal it returns. The generated memq.cmd exists nowhere on disk in this
// tree, so the sweep above cannot reach it and this is its only coverage;
// reading the function's whole body instead would match the prose of the
// comments that explain the wrapper, which is how a pin on this file goes
// quiet while the emitted wrapper loses the very line the pin names.
function emittedMemqWrapperText(shimSource) {
    const fn = shimSource.slice(shimSource.indexOf('function Get-MemqCmdWrapperText'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    const open = body.indexOf('return (@(');
    assert.ok(open >= 0, 'the generator no longer returns an array literal, so this pin cannot read what it emits');
    const arr = body.slice(open, body.indexOf('-join', open));
    // The reconstruction reads single-quoted PowerShell literals. A
    // double-quoted element would be dropped from it silently, and a dropped
    // mutation line is exactly what the predicates below exist to catch, so
    // the shape is asserted rather than assumed.
    // The single-quoted elements are removed before the check, since a
    // double quote inside one is the wrapper's own text: the guard line is
    // spelled set "NoDefault...=1" and is a single-quoted literal carrying
    // two of them. What remains carrying a double quote is an element this
    // reconstruction cannot read.
    assert.ok(!arr.replace(/'(?:[^']|'')*'/g, '').includes('"'),
        'the generator now builds a wrapper line with a double-quoted literal, which this '
        + 'reconstruction does not read, so every predicate below would judge a wrapper missing '
        + 'that line: ' + arr);
    const elements = [...arr.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
    assert.ok(elements.length > 0, 'no emitted wrapper lines were recovered from the generator');
    // cmd.exe parses a batch file by CRLF lines, so the terminator the
    // generator joins with is part of what makes the emitted wrapper valid.
    // Reconstructing with a hardcoded CRLF while the generator moved to LF
    // would leave every predicate below green over text no installed wrapper
    // matches.
    assert.match(body.slice(open), /-join\s+"`r`n"/,
        'the generator no longer joins its wrapper lines with CRLF, so the installed memq.cmd is '
        + 'parsed by cmd.exe from a terminator it is not reliable on');
    return elements.join('\r\n');
}

test('every cmd wrapper the repo ships sets the working-directory guard before it launches anything', () => {
    // cmd.exe treats .bat and .cmd identically, so the sweep is over both:
    // discovering only .cmd would leave a .bat wrapper added later exempt
    // while this pin still reported a clean result.
    // quotePath=false stops git C-quoting a non-ASCII wrapper name, which would
    // reach readFileSync as a path that does not exist.
    const listed = gitOutput(REPO, ['-c', 'core.quotePath=false', 'ls-files', '--', '*.cmd', '*.bat']);
    assert.ok(listed !== null, 'the git call that discovers the wrappers did not succeed, so this pin swept nothing');
    const wrappers = listed.split('\n').map((s) => s.trim()).filter(Boolean);
    // The discovery itself is asserted: an empty list would pass the loop
    // below silently and report exactly like a swept clean result.
    assert.ok(wrappers.length > 0, 'no tracked .cmd or .bat wrapper was discovered, so this pin swept nothing');
    for (const rel of wrappers) {
        const text = fs.readFileSync(path.join(REPO, rel), 'utf8');
        assert.ok(guardPrecedesLaunch(text),
            rel + ' launches a command without setting ' + CMD_GUARD_CANONICAL + ' first, so the caller\'s '
            + 'working directory can supply the binary it names');
        assert.ok(scopesEnvironment(text),
            rel + ' assigns an environment variable without a preceding setlocal, so the assignment '
            + 'outlives the wrapper in the caller\'s own cmd.exe and changes how that shell resolves '
            + 'every later command');
    }
});

test('the generated memq.cmd wrapper carries the same guard', () => {
    const shim = fs.readFileSync(
        path.join(REPO, 'plugins', 'claude-kit', 'doctor', 'install-memq-shim.ps1'), 'utf8');
    // Judged on the wrapper it emits, through the same two predicates the
    // tracked wrappers face, so the generated wrapper cannot pass on the
    // strength of the prose that surrounds it.
    const emitted = emittedMemqWrapperText(shim);
    assert.ok(emitted.includes('node "%~dp0memq-shim.js"'),
        'the emitted wrapper no longer launches the shim, so this pin is reading the wrong text: ' + emitted);
    assert.ok(guardPrecedesLaunch(emitted),
        'Get-MemqCmdWrapperText emits a wrapper that launches bare node without ' + CMD_GUARD_CANONICAL
        + ' ahead of it, and that wrapper is installed onto PATH and invoked from arbitrary directories: '
        + emitted);
    // memq.cmd sits on PATH and is invoked constantly, so an unscoped set here
    // is the one that would be blamed on the shell rather than on memq.
    assert.ok(scopesEnvironment(emitted),
        'Get-MemqCmdWrapperText must emit setlocal ahead of its set, or the guard it writes outlives '
        + 'every memq call in the caller\'s shell: ' + emitted);
});

// The control for the pin above, on the defect it exists to catch: the same
// predicates run over the emitted text with the scoping line removed must red.
// A pin that reads the generator's body rather than its output passes this
// removal, because the comments explaining the wrapper name setlocal too.
test('the generated memq.cmd pin reds when the emitted wrapper loses its scoping', () => {
    const shim = fs.readFileSync(
        path.join(REPO, 'plugins', 'claude-kit', 'doctor', 'install-memq-shim.ps1'), 'utf8');
    const emitted = emittedMemqWrapperText(shim);
    const withoutScope = emitted.split(/\r?\n/).filter((l) => !/^@?setlocal\b/i.test(l)).join('\r\n');
    assert.notStrictEqual(withoutScope, emitted, 'control: the emitted wrapper carries no setlocal line to remove');
    assert.ok(!scopesEnvironment(withoutScope),
        'control: the emitted wrapper stripped of its setlocal must fail the scoping predicate');
    const withoutGuard = emitted.split(/\r?\n/).filter((l) => !CMD_GUARD_RE.test(l.trim())).join('\r\n');
    assert.notStrictEqual(withoutGuard, emitted, 'control: the emitted wrapper carries no guard line to remove');
    assert.ok(!guardPrecedesLaunch(withoutGuard),
        'control: the emitted wrapper stripped of its guard must fail the guard predicate');
});

// The control: the predicate speaks on a wrapper that lacks the guard, so a
// green above is coverage rather than a predicate that matches everything.
test('the cmd wrapper guard predicate reds on an unguarded wrapper', () => {
    assert.ok(!guardPrecedesLaunch('@echo off\r\nnode "%~dp0thing.js" %*\r\n'),
        'control: an unguarded wrapper must fail the predicate');
    assert.ok(!guardPrecedesLaunch('@echo off\r\nnode "%~dp0thing.js" %*\r\n' + CMD_GUARD_CANONICAL + '\r\n'),
        'control: a guard set after the launch must fail the predicate');
    assert.ok(guardPrecedesLaunch('@echo off\r\n' + CMD_GUARD_CANONICAL + '\r\nnode "%~dp0thing.js" %*\r\n'),
        'control: a guarded wrapper must pass the predicate');
    // The shape control, on a spelling withheld from the pattern's literals:
    // this form is matched on the assignment rather than on any string the
    // predicate was handed, so a green here is coverage rather than an echo.
    assert.ok(guardPrecedesLaunch('@echo off\r\n@set NoDefaultCurrentDirectoryInExePath=1\r\nnode "x.js"\r\n'),
        'control: the unquoted, @-prefixed spelling sets the same variable and must pass');
    // The wrappers are written setlocal-first, so a predicate that read
    // setlocal as a launch would red every correctly written wrapper while
    // reporting them as unguarded.
    assert.ok(guardPrecedesLaunch(
        '@echo off\r\nsetlocal\r\n' + CMD_GUARD_CANONICAL + '\r\nnode "%~dp0thing.js" %*\r\n'),
        'control: setlocal is a builtin rather than a launch, so a setlocal-scoped wrapper must pass');
    assert.ok(!guardPrecedesLaunch('@echo off\r\nsetlocal\r\nnode "%~dp0thing.js" %*\r\n'),
        'control: setlocal alone is not the guard, so the predicate must still red');
    // Shape controls on command positions the predicate's literals never name.
    // cmd.exe runs both halves of an ampersand line, confirmed on this box: a
    // wrapper reading `echo starting & node payload.js` launches node from the
    // second position, which a predicate reading the line's first token sees
    // as an echo.
    assert.ok(!guardPrecedesLaunch('@echo off\r\necho starting & node "x.js"\r\n' + CMD_GUARD_CANONICAL + '\r\n'),
        'control: a launch chained onto a builtin runs before a guard written below it and must red');
    assert.ok(guardPrecedesLaunch('@echo off\r\n' + CMD_GUARD_CANONICAL + '\r\necho starting & node "x.js"\r\n'),
        'control: the same chained launch under a guard set above it must pass');
    // An endlocal pops the scope the guard was set in, so the assignment is
    // gone by the time the launch resolves its interpreter, even though the
    // guard line sits above the launch line.
    assert.ok(!guardPrecedesLaunch(
        '@echo off\r\nsetlocal\r\n' + CMD_GUARD_CANONICAL + '\r\nendlocal\r\nnode "x.js"\r\n'),
        'control: a guard discarded by endlocal before the launch must red, though it precedes it');
    // A comment consumes its whole line, separators included, confirmed on this
    // box: nothing after the ampersand runs. Both wrappers carry paragraphs of
    // prose, so a predicate that split a rem line would report the next
    // ampersand an author writes as an unguarded launch.
    assert.ok(guardPrecedesLaunch(
        '@echo off\r\nrem weigh this & that\r\n' + CMD_GUARD_CANONICAL + '\r\nnode "x.js"\r\n'),
        'control: an ampersand inside comment prose is data rather than a second command');
    assert.ok(!guardPrecedesLaunch('@echo off\r\nrem weigh this & that\r\nnode "x.js"\r\n'),
        'control: comment prose does not supply a guard, so an unguarded wrapper still reds');
});

test('the environment-scoping predicate reds on a wrapper whose set outlives it', () => {
    assert.ok(!scopesEnvironment('@echo off\r\n' + CMD_GUARD_CANONICAL + '\r\nnode "x.js"\r\n'),
        'control: an unscoped set must fail, since it outlives the wrapper in the caller\'s shell');
    assert.ok(scopesEnvironment('@echo off\r\nsetlocal\r\n' + CMD_GUARD_CANONICAL + '\r\nnode "x.js"\r\n'),
        'control: a set preceded by setlocal must pass');
    assert.ok(!scopesEnvironment('@echo off\r\n' + CMD_GUARD_CANONICAL + '\r\nsetlocal\r\nnode "x.js"\r\n'),
        'control: a setlocal after the set scopes nothing and must fail');
    assert.ok(scopesEnvironment('@echo off\r\nnode "x.js"\r\n'),
        'control: a wrapper that assigns nothing has nothing to scope and must pass');
    // Class controls, each on a member withheld from the predicate's own
    // subject: the guard variable is never named in any of them, so a green
    // here is coverage of the mutation class rather than an echo of the one
    // variable this section happened to add.
    assert.ok(!scopesEnvironment('@echo off\r\nset OTHER_THING=2\r\nnode "x.js"\r\n'),
        'control: any unscoped assignment must fail, not only the guard\'s own variable');
    assert.ok(!scopesEnvironment('@echo off\r\nsetlocal\r\nsetx PERSISTED 1\r\nnode "x.js"\r\n'),
        'control: setx writes the registry, which setlocal does not scope, so it must fail even scoped');
    assert.ok(!scopesEnvironment('@echo off\r\nsetlocal\r\nendlocal\r\nset LEAKED=1\r\nnode "x.js"\r\n'),
        'control: an endlocal before the assignment ends the scope, so the assignment still leaks');
    assert.ok(!scopesEnvironment('@echo off\r\ncd "%~dp0"\r\nnode "x.js"\r\n'),
        'control: an unscoped cd changes the caller\'s own working directory and must fail');
    assert.ok(scopesEnvironment('@echo off\r\nsetlocal\r\ncd "%~dp0"\r\nnode "x.js"\r\n'),
        'control: setlocal saves and restores the working directory, so a scoped cd must pass');
    // Shape controls on members withheld from the predicate's own literals.
    // None names the guard variable and none is a first-token assignment, so a
    // green here is coverage of the mutation class rather than a rehearsal of
    // the one form this section happened to write.
    //
    // `endlocal & set X=1` is the idiomatic way to push a value past a scope,
    // measured on this box: the variable is defined in the caller after the
    // wrapper returns, where the same assignment under a live setlocal is not.
    assert.ok(!scopesEnvironment('@echo off\r\nsetlocal\r\nendlocal & set LEAKED=1\r\nnode "x.js"\r\n'),
        'control: an assignment chained onto endlocal runs outside the scope and must fail');
    assert.ok(!scopesEnvironment('@echo off\r\nif not defined THING set THING=1\r\nnode "x.js"\r\n'),
        'control: an assignment reached through a condition is still an assignment and must fail');
    assert.ok(!scopesEnvironment('@echo off\r\nfor /f %%i in (list.txt) do set THING=%%i\r\nnode "x.js"\r\n'),
        'control: an assignment reached through a loop body must fail');
    assert.ok(!scopesEnvironment('@echo off\r\npath C:\\tools\r\nnode "x.js"\r\n'),
        'control: path rewrites the caller\'s PATH, which is the same class as an unscoped set');
    assert.ok(!scopesEnvironment('@echo off\r\ncd..\r\nnode "x.js"\r\n'),
        'control: the space-less directory change cmd.exe accepts is still a directory change');
    // The mutation the predicate must judge is any of them rather than the
    // first: this wrapper scopes its opening assignment and leaks the one after
    // its endlocal.
    assert.ok(!scopesEnvironment('@echo off\r\nsetlocal\r\nset A=1\r\nendlocal\r\nset B=2\r\nnode "x.js"\r\n'),
        'control: a wrapper that scopes its first assignment and leaks a later one must fail');
    // The false-red direction, which a predicate anchored to the first setlocal
    // reports as a leak: this assignment is inside a live scope.
    assert.ok(scopesEnvironment('@echo off\r\nsetlocal\r\nendlocal\r\nsetlocal\r\nset A=1\r\nnode "x.js"\r\n'),
        'control: an assignment inside a reopened scope is scoped and must pass');
    assert.ok(scopesEnvironment('@echo off\r\nsetlocal\r\nset "A=x&y"\r\nnode "x.js"\r\n'),
        'control: a quoted ampersand is data rather than a command separator');
    // The block form, on both sides: an assignment inside a multi-line if is
    // reached the same as any other, and the parenthesis that closes the block
    // is punctuation rather than a command.
    assert.ok(!scopesEnvironment('@echo off\r\nif not defined A (\r\n  set A=1\r\n)\r\nnode "x.js"\r\n'),
        'control: an assignment inside an unscoped block still leaks and must fail');
    assert.ok(scopesEnvironment('@echo off\r\nsetlocal\r\nif not defined A (\r\n  set A=1\r\n)\r\nnode "x.js"\r\n'),
        'control: the same block under a live setlocal is scoped and must pass');
});

// cmd.exe parses a batch file by CRLF lines, which is why the generated
// wrapper is built CRLF-terminated. A tracked wrapper carries whatever the
// cloner's core.autocrlf produces unless an attribute fixes it, so without one
// a clone made with autocrlf=false, or a source archive, delivers LF-only
// batch files and the guard lines above are parsed by a parser that is not
// reliable on them. The attribute is what makes the delivered bytes the same
// everywhere, so it is pinned rather than assumed.
test('every tracked cmd wrapper is delivered CRLF by attribute rather than by the cloner\'s config', () => {
    // The attribute column reports the rule in force on this checkout, and a
    // machine-local .git/info/attributes supplies one just as well as a tracked
    // file does. What a clone receives is the tracked file, so it is read
    // directly rather than inferred from the column: without this the pin is
    // green on any box carrying an out-of-repo rule, which is the state the
    // test exists to tell apart from a repository that decided the matter.
    const attributes = fs.readFileSync(path.join(REPO, '.gitattributes'), 'utf8');
    assert.match(attributes, /^\*\.cmd\s+[^\n]*\btext\b[^\n]*\beol=crlf\b/m,
        'the tracked .gitattributes carries no eol=crlf rule for *.cmd, so what a clone receives is '
        + 'decided by that machine\'s core.autocrlf rather than by the repository');
    assert.match(attributes, /^\*\.bat\s+[^\n]*\btext\b[^\n]*\beol=crlf\b/m,
        'the tracked .gitattributes carries no eol=crlf rule for *.bat, so a .bat wrapper added later '
        + 'is delivered by that machine\'s core.autocrlf rather than by the repository');

    const listed = gitOutput(REPO, ['-c', 'core.quotePath=false', 'ls-files', '--eol', '--', '*.cmd', '*.bat']);
    assert.ok(listed !== null, 'the git call that reports the wrappers\' line endings did not succeed');
    const rows = listed.split('\n').map((s) => s.trim()).filter(Boolean);
    assert.ok(rows.length > 0, 'no tracked wrapper was discovered, so this pin swept nothing');
    for (const row of rows) {
        // `-text` beside eol=crlf leaves eol inert, so the attribute set is
        // read rather than searched: a row is only pinned where text is on.
        const attrs = (row.split('\t')[0].split('attr/')[1] || '').trim();
        assert.match(attrs, /(^|\s)text(\s|$)/,
            'this wrapper is not marked text, so eol=crlf beside it is inert and the delivered bytes '
            + 'are still whatever the cloner\'s core.autocrlf produces: ' + row);
        assert.match(attrs, /(^|\s)eol=crlf(\s|$)/,
            'this wrapper carries no eol=crlf attribute, so what a clone receives is decided by that '
            + 'machine\'s core.autocrlf rather than by the repository, and cmd.exe is not reliable '
            + 'parsing an LF-only batch file: ' + row);
    }
});
