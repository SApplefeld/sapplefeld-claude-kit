// Behavioural pin between the two git-invocation guards this repo carries:
// the Node hook side (plugins/claude-kit/hooks/kit-git-lib.js's
// gitChildEnv()) and the PowerShell doctor side
// (plugins/claude-kit/doctor/install-memory-sync.ps1's Invoke-MemorySyncGit).
// Neither language can call the other's, so the two implementations are
// restated rather than shared, and nothing today would notice if one gained
// a key, lost an ordering guarantee, or dropped a value the other did not.
//
// Both sides are run for real against the real code rather than the guards'
// source text being pattern-matched. The JS side calls gitChildEnv()
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
// guard writes there, so their fate must be "changed away from the planted
// value" rather than "added" (which would mean the plant leaked past the
// point the guard reads process state) or "removed" (which is what a broken
// strip-then-set order produces, since a pre-existing name the strip queues
// for removal outruns a set that ran before it). The literal value each
// name changes to is pinned once, at test/kit-git-lib.test.js and
// test/memory-sync-git-guard.test.js; this file checks only that each side
// moved away from its planted value and that the two sides' resulting
// values agree with each other, in the per-touched-name comparison below.
//
// PLANTED_SURVIVOR names are neither a guard name nor deliberate noise: no
// guard has any reason to touch them, so they must be absent from the delta
// entirely, catching an over-broad strip that takes down a name it was
// never meant to reach.
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

// Every planted guard name except GIT_CONFIG_VALUE_1, which is checked by
// shape further down (against its own planted-then-changed delta entry)
// rather than by comparing to a literal target, since its value is a fresh
// GUID-bearing path.
const GUARD_NAMES_TO_CHECK = Object.keys(PLANTED_GUARD_OVERWRITE)
    .filter((name) => name.toUpperCase() !== 'GIT_CONFIG_VALUE_1');

const GUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function hasNameCI(obj, name) {
    const upper = name.toUpperCase();
    return Object.keys(obj).some((k) => k.toUpperCase() === upper);
}

// The JS side: require the copy (kit-git-lib.js requires only node
// builtins, so a copy under a temp dir loads standalone), plant the PLANTED
// table on process.env, capture it as the pre-guard baseline, call the real
// gitChildEnv() for the post-guard result, and restore process.env in a
// finally whether the call threw or not. No casing cleanup is needed before
// planting: unlike a spawned child's env block, Node's own process.env is
// already case-insensitive on Windows (setting a name in one casing and
// reading it back in another returns the same value, and Object.keys
// reports only the one spelling that was set), so a plant can never leave
// two differently-cased entries behind here the way it could in a spawned
// child's env.
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
// install-memory-sync.ps1:486), and re-emitted line by line through
// [Console]::Out.WriteLine, which writes the raw string straight to stdout
// and bypasses the console formatter Write-Output goes through; the
// formatter wraps a line at the host's console width, which cut a long
// GIT_CONFIG_VALUE_1 dump line at a column narrower than a redirected
// stdout capture ever needs. The two dumps share one stdout stream, so each
// is wrapped in its own BEGIN/END marker line the parser cannot mistake for
// environment output (no real environment variable name is spelled
// KITPARITY_*); the markers themselves stay on Write-Output, since they are
// short literals a formatter has no reason to wrap. GetTempPath() rides
// along on its own marked line, read by the caller to check
// GIT_CONFIG_VALUE_1's shape against the runtime that produced it.
// [Console]::OutputEncoding is set to UTF8 up front so every line written
// through either path decodes alike.
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
            + 'Write-Output ("KITPARITY_TEMPPATH=" + $tempPath); '
            + '$pre = & ' + q(fakeGit) + ' 2>&1; '
            + 'Write-Output "KITPARITY_PRE_BEGIN"; '
            + 'foreach ($line in $pre) { [Console]::Out.WriteLine([string]$line) }; '
            + 'Write-Output "KITPARITY_PRE_END"; '
            + '$result = Invoke-MemorySyncGit -StoreRoot ' + q(storeRoot)
            + ' -Arguments @("status") -GitExe ' + q(fakeGit) + '; '
            + 'Write-Output "KITPARITY_POST_BEGIN"; '
            + 'foreach ($line in $result.Output) { [Console]::Out.WriteLine([string]$line) }; '
            + 'Write-Output "KITPARITY_POST_END"';

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
    // must be absent from the delta entirely: no add, no change, no remove.
    // Its presence in either delta means an over-broad strip took down a
    // name it was never meant to reach.
    for (const name of Object.keys(PLANTED_SURVIVOR)) {
        const upper = name.toUpperCase();
        if (jsTouched.has(upper)) problems.push('JS side: survivor ' + name + ' was touched: ' + JSON.stringify(jsTouched.get(upper)));
        if (psTouched.has(upper)) problems.push('PS side: survivor ' + name + ' was touched: ' + JSON.stringify(psTouched.get(upper)));
    }

    // Every planted guard name (all but GIT_CONFIG_VALUE_1, checked by shape
    // further down) is proved by the delta rather than by an ambient
    // process that happened to already carry the guard's own value: each is
    // planted with a value the guard must overwrite, so each must read as
    // changed away from that planted value on both sides. The value each
    // side changed to is not re-pinned here against a literal (that literal
    // is pinned once, at test/kit-git-lib.test.js and
    // test/memory-sync-git-guard.test.js); cross-side agreement on the
    // resulting value is enforced by the per-touched-name loop below.
    for (const name of GUARD_NAMES_TO_CHECK) {
        const upper = name.toUpperCase();
        const plantedValue = PLANTED_GUARD_OVERWRITE[name];
        const jInfo = jsTouched.get(upper);
        const pInfo = psTouched.get(upper);
        if (!jInfo || jInfo.kind !== 'changed' || jInfo.to === plantedValue) {
            problems.push('JS side: ' + name + ' did not change away from the planted value ' + JSON.stringify(plantedValue) + ': ' + JSON.stringify(jInfo || null));
        }
        if (!pInfo || pInfo.kind !== 'changed' || pInfo.to === plantedValue) {
            problems.push('PS side: ' + name + ' did not change away from the planted value ' + JSON.stringify(plantedValue) + ': ' + JSON.stringify(pInfo || null));
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
    return { jsTouched, psTouched, jsTempDir, psTempDir };
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

// The floor and per-name checks inside compareGuardEnvironments already
// throw a fully-detailed AssertionError on any disagreement; a passing call
// here is itself the full claim, so there is nothing left for this test to
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
