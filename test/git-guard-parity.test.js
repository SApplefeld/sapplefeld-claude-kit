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
// Three planted environment variables ride into both calls, present before
// the guard runs so their fate is part of the observed delta:
// GIT_KIT_PARITY_PLANTED (uppercase) and git_kit_parity_lower (lowercase)
// prove the strip is case-insensitive by their absence from the result
// (they must show up as removed, on both sides); GIT_CONFIG_COUNT=9 and
// NoDefaultCurrentDirectoryInExePath=0 are two of the guard's own key
// names, planted with the value the guard must overwrite, so their fate
// must be "changed to the guard's value" rather than "added" (which would
// mean the plant leaked past the point the guard reads process state) or
// "removed" (which is what a broken strip-then-set order produces, since a
// pre-existing name the strip queues for removal outruns a set that ran
// before it).
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
// GIT_CONFIG_COUNT is validated by walking its own claimed indices: for
// every i from 0 to COUNT-1, both GIT_CONFIG_KEY_i and GIT_CONFIG_VALUE_i
// must actually be present on that side. That is a stronger claim than
// counting digit-suffixed names, which would pass even if the indices the
// count named were not the ones actually present.
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

// The three variables planted into both calls' environment before each
// guard runs. GIT_CONFIG_COUNT and NoDefaultCurrentDirectoryInExePath are
// two of the guard's own key names, planted with a value the guard must
// overwrite; the other two are never guard names, so their survival would
// mean the strip missed them.
const PLANTED = {
    GIT_KIT_PARITY_PLANTED: 'x',
    git_kit_parity_lower: 'y',
    GIT_CONFIG_COUNT: '9',
    NoDefaultCurrentDirectoryInExePath: '0'
};
const PLANTED_NAMES_THAT_MUST_NOT_SURVIVE = ['GIT_KIT_PARITY_PLANTED', 'GIT_KIT_PARITY_LOWER'];

const GUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function hasNameCI(obj, name) {
    const upper = name.toUpperCase();
    return Object.keys(obj).some((k) => k.toUpperCase() === upper);
}

// The JS side: require the copy (kit-git-lib.js requires only node
// builtins, so a copy under a temp dir loads standalone), plant the four
// variables on process.env, capture it as the pre-guard baseline, call the
// real gitChildEnv() for the post-guard result, and restore process.env in
// a finally whether the call threw or not.
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

// The PS side: spawn powershell.exe, dot-source the copy, and run a fake
// git (a .cmd that ignores its arguments and dumps its own environment via
// "set") twice: once directly, for the pre-guard baseline, and once
// through Invoke-MemorySyncGit, for the post-guard result. The two dumps
// share one stdout stream, so each is wrapped in its own BEGIN/END marker
// line the parser cannot mistake for environment output (no real
// environment variable name is spelled KITPARITY_*). GetTempPath() rides
// along on its own marked line, read by the caller to check
// GIT_CONFIG_VALUE_1's shape against the runtime that produced it.
// [Console]::OutputEncoding is set to UTF8 up front so the cmd child's
// dump and PowerShell's own Write-Output lines decode alike.
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
            + 'Write-Output "KITPARITY_PRE_BEGIN"; '
            + '& ' + q(fakeGit) + '; '
            + 'Write-Output "KITPARITY_PRE_END"; '
            + '$result = Invoke-MemorySyncGit -StoreRoot ' + q(storeRoot)
            + ' -Arguments @("status") -GitExe ' + q(fakeGit) + '; '
            + 'Write-Output "KITPARITY_POST_BEGIN"; '
            + 'foreach ($line in $result.Output) { Write-Output $line }; '
            + 'Write-Output "KITPARITY_POST_END"';
        const res = spawnSync('powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
            { encoding: 'utf8', env: { ...process.env, ...PLANTED }, timeout: 60000, maxBuffer: 16 * 1024 * 1024 });

        // Never put the raw environment dump in an assertion message: it can
        // run to dozens of lines, and a line count plus the first line of
        // stderr is enough to diagnose a spawn failure without flooding the
        // test report.
        const stdout = res.stdout || '';
        const lines = stdout.split(/\r?\n/);
        assert.strictEqual(res.status, 0,
            'the PS probe spawn failed: error=' + (res.error ? res.error.message : 'none')
            + ' status=' + res.status + ' stdoutLines=' + lines.length
            + ' stderrFirst=' + JSON.stringify((res.stderr || '').split(/\r?\n/)[0] || ''));

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
    if (!countName) return; // absence is reported elsewhere (the floor and the name-set checks)
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
}

// The pin. Builds each side's pre/post environment from a real run of the
// real guard, computes each side's delta, and throws an AssertionError
// listing every difference when the two disagree. Returns the two deltas
// when they agree, so a caller can read them back.
function compareGuardEnvironments(jsPath, psPath) {
    const { pre: jsPre, post: jsPost } = buildJsEnvMap(jsPath);
    const { pre: psPre, post: psPost, tempPath: psTempDir } = buildPsEnvMap(psPath);
    const jsTempDir = os.tmpdir();

    const jsTouched = computeDelta(jsPre, jsPost);
    const psTouched = computeDelta(psPre, psPost);

    const problems = [];

    // A guard that touched nothing, or a probe that captured nothing, must
    // never read as parity: each side is known to set (add or change) at
    // least seven names today, so a reading under that floor on either side
    // means either the guard broke or the probe did, never that the two
    // sides agree by both losing the same name.
    const jsSetCount = [...jsTouched.values()].filter((t) => t.kind === 'added' || t.kind === 'changed').length;
    const psSetCount = [...psTouched.values()].filter((t) => t.kind === 'added' || t.kind === 'changed').length;
    if (jsSetCount < 7 || psSetCount < 7) {
        problems.push('extraction floor: JS sets ' + jsSetCount + ' names, PS sets ' + psSetCount + ' (both expected at '
            + 'least 7): either the guard broke, or a name was retired on both sides and this floor needs updating.');
    }

    // The planted non-guard names never survive the strip, on either side,
    // in either casing.
    for (const name of PLANTED_NAMES_THAT_MUST_NOT_SURVIVE) {
        if (hasNameCI(jsPost, name)) problems.push('JS side: planted ' + name + ' survived the strip');
        if (hasNameCI(psPost, name)) problems.push('PS side: planted ' + name + ' survived the strip');
    }

    // NoDefaultCurrentDirectoryInExePath is proved by the delta rather than
    // by an ambient process that happened to already carry the guard's own
    // value: planted at '0', it must read as changed to '1' on both sides.
    const jsNoDefault = jsTouched.get('NODEFAULTCURRENTDIRECTORYINEXEPATH');
    const psNoDefault = psTouched.get('NODEFAULTCURRENTDIRECTORYINEXEPATH');
    if (!jsNoDefault || jsNoDefault.kind !== 'changed' || jsNoDefault.to !== '1') {
        problems.push('JS side: NoDefaultCurrentDirectoryInExePath did not change to "1": ' + JSON.stringify(jsNoDefault || null));
    }
    if (!psNoDefault || psNoDefault.kind !== 'changed' || psNoDefault.to !== '1') {
        problems.push('PS side: NoDefaultCurrentDirectoryInExePath did not change to "1": ' + JSON.stringify(psNoDefault || null));
    }

    // The touched name sets, compared case-insensitively, original
    // spellings reported.
    const onlyJs = [...jsTouched.keys()].filter((u) => !psTouched.has(u)).map((u) => jsTouched.get(u).name);
    const onlyPs = [...psTouched.keys()].filter((u) => !jsTouched.has(u)).map((u) => psTouched.get(u).name);
    if (onlyJs.length) problems.push('JS-only names: ' + onlyJs.join(', '));
    if (onlyPs.length) problems.push('PS-only names: ' + onlyPs.join(', '));

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

    // GIT_CONFIG_VALUE_1: shape rather than literal value.
    if (jsTouched.has('GIT_CONFIG_VALUE_1') && psTouched.has('GIT_CONFIG_VALUE_1')) {
        const jInfo = jsTouched.get('GIT_CONFIG_VALUE_1');
        const pInfo = psTouched.get('GIT_CONFIG_VALUE_1');
        const jVal = jInfo.kind === 'added' ? jInfo.value : jInfo.to;
        const pVal = pInfo.kind === 'added' ? pInfo.value : pInfo.to;
        const jProblem = value1ShapeProblem(jVal, jsTempDir);
        const pProblem = value1ShapeProblem(pVal, psTempDir);
        if (jProblem) problems.push('GIT_CONFIG_VALUE_1: JS value ' + jProblem);
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

test('the Node and PowerShell git guards hand git the same environment delta', { skip: !isWin }, () => {
    const result = compareGuardEnvironments(JS_PATH, PS_PATH);
    const jsSetCount = [...result.jsTouched.values()].filter((t) => t.kind === 'added' || t.kind === 'changed').length;
    const psSetCount = [...result.psTouched.values()].filter((t) => t.kind === 'added' || t.kind === 'changed').length;
    assert.ok(jsSetCount >= 7, 'JS side set ' + jsSetCount + ' names');
    assert.ok(psSetCount >= 7, 'PS side set ' + psSetCount + ' names');
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

// The withheld member the old /^GIT_/i-filtered design could never see: a
// name outside that prefix is invisible to a filter but not to a delta,
// which is blind to prefix and only asks what changed.
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
                && err.message.includes('GIT_CONFIG_COUNT: JS changed to "2", PS removed'),
            'expected the comparison to throw naming GIT_CONFIG_COUNT as changed on JS but removed on PS');
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
                && err.message.includes('GIT_CONFIG_COUNT: JS removed, PS changed to "2"'),
            'expected the comparison to throw naming GIT_CONFIG_COUNT as removed on JS but changed on PS');
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
                && err.message.includes('JS side: planted GIT_KIT_PARITY_PLANTED survived the strip'),
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
