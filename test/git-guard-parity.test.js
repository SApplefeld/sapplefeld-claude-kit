// Behavioural pin between the two git-invocation guards this repo carries:
// the Node hook side (plugins/claude-kit/hooks/kit-git-lib.js's
// gitChildEnv()) and the PowerShell doctor side
// (plugins/claude-kit/doctor/install-memory-sync.ps1's Invoke-MemorySyncGit).
// Neither language can call the other's, so the two implementations are
// restated rather than shared, and nothing today would notice if one gained
// a key, lost an ordering guarantee, or dropped a value the other did not.
//
// Both runtimes are run for real against the real code, rather than the
// guards' source text being pattern-matched: the JS side loads
// gitChildEnv() with node's own require and calls it, and the PS side
// spawns powershell.exe, dot-sources the installer, and calls
// Invoke-MemorySyncGit against a fake git that prints the environment it
// was actually handed. That is what makes the pin behavioural: a block
// comment quoting the strip literal, an unused regex, a guard key spelled
// outside the $guard table, a quote-style change, or two statements swapped
// in the wrong order all read here exactly as they would read to a real
// git child, because a real git child (stood in for by the fake) is what
// each side is run against.
//
// The comparison, compareGuardEnvironments(jsPath, psPath), builds each
// side's map of every environment name matching /^GIT_/i plus
// NoDefaultCurrentDirectoryInExePath, and throws an AssertionError listing
// every difference; it never truncates to the first one. Taking the two
// paths as parameters is what lets the controls below run it against
// mkdtemp copies instead of only against the real files.
//
// GIT_CONFIG_VALUE_1 is pinned by shape rather than by literal value: both
// sides join a fresh GUID onto their own runtime's temp directory with a
// "no-hooks-" marker in the name, and the two prefixes (kit-git-no-hooks-
// vs kit-memory-sync-no-hooks-) differ by design, so the values are pinned
// to that shape and to differing from each other rather than to one
// another. GIT_CONFIG_COUNT is pinned to equal the number of
// GIT_CONFIG_KEY_<i> names actually present on each side, not to today's
// literal "2", so a future third pin added to both sides stays green.
//
// Three planted environment variables ride into both calls:
// GIT_KIT_PARITY_PLANTED (uppercase) and git_kit_parity_lower (lowercase)
// prove the strip is case-insensitive on both sides by their absence from
// the result, and GIT_CONFIG_COUNT=9 (a name the guard also sets) proves
// the guard's own value wins over a pre-existing conflicting one, which is
// exactly the shape of defect a swapped strip-then-set order produces.
//
// Node's built-in test runner, no framework. The PowerShell-dependent cases
// spawn Windows PowerShell and are skipped off Windows, where the doctor
// does not run. Every case owns its own mkdtemp directory and shares
// nothing with its neighbours.

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

// The three variables planted into both calls' environment before each
// guard runs. GIT_CONFIG_COUNT is one of the guard's own key names, planted
// with a value the guard must overwrite; the other two are never guard
// names, so their survival would mean the strip missed them.
const PLANTED = { GIT_KIT_PARITY_PLANTED: 'x', git_kit_parity_lower: 'y', GIT_CONFIG_COUNT: '9' };
const PLANTED_NAMES_THAT_MUST_NOT_SURVIVE = ['GIT_KIT_PARITY_PLANTED', 'GIT_KIT_PARITY_LOWER'];

const GUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function hasNameCI(map, name) {
    const upper = name.toUpperCase();
    return Object.keys(map).some((k) => k.toUpperCase() === upper);
}

function filterGuardNames(obj) {
    const map = {};
    for (const k of Object.keys(obj)) {
        if (/^GIT_/i.test(k) || k === 'NoDefaultCurrentDirectoryInExePath') map[k] = obj[k];
    }
    return map;
}

// The JS side: require the copy (kit-git-lib.js requires only node
// builtins, so a copy under a temp dir loads standalone), plant the three
// variables on process.env, call the real gitChildEnv(), and restore
// process.env in a finally whether the call threw or not.
function buildJsEnvMap(jsPath) {
    delete require.cache[require.resolve(jsPath)];
    const mod = require(jsPath);
    const previous = {};
    for (const k of Object.keys(PLANTED)) previous[k] = process.env[k];
    for (const k of Object.keys(PLANTED)) process.env[k] = PLANTED[k];
    let result;
    try {
        result = mod.gitChildEnv();
    } finally {
        for (const k of Object.keys(PLANTED)) {
            if (previous[k] === undefined) delete process.env[k];
            else process.env[k] = previous[k];
        }
    }
    return filterGuardNames(result);
}

// The PS side: spawn powershell.exe, dot-source the copy, and call
// Invoke-MemorySyncGit against a fake git (a .cmd that ignores its
// arguments and prints "set", the child's whole environment) so the
// returned Output lines are literally what a real git child would have
// seen. GetTempPath() rides along on its own output line, read by the
// caller to check GIT_CONFIG_VALUE_1's shape against the runtime that
// produced it.
function buildPsEnvMap(psPath) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitguard-ps-'));
    try {
        const fakeGit = path.join(dir, 'fake-git.cmd');
        fs.writeFileSync(fakeGit, '@echo off\r\nset\r\n', 'utf8');
        const storeRoot = path.join(dir, 'store');
        fs.mkdirSync(storeRoot);
        const script = '. ' + q(psPath) + '; '
            + '$result = Invoke-MemorySyncGit -StoreRoot ' + q(storeRoot)
            + ' -Arguments @("status") -GitExe ' + q(fakeGit) + '; '
            + '$tempPath = [System.IO.Path]::GetTempPath(); '
            + 'Write-Output ("KITPARITY_TEMPPATH=" + $tempPath); '
            + 'foreach ($line in $result.Output) { Write-Output $line }';
        const res = spawnSync('powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
            { encoding: 'utf8', env: { ...process.env, ...PLANTED } });
        assert.strictEqual(res.status, 0, 'the PS probe spawn failed: ' + res.stdout + res.stderr);

        const lines = res.stdout.split(/\r?\n/);
        let tempPath = null;
        const raw = {};
        for (const line of lines) {
            if (line.startsWith('KITPARITY_TEMPPATH=')) {
                tempPath = line.slice('KITPARITY_TEMPPATH='.length);
                continue;
            }
            const eq = line.indexOf('=');
            if (eq < 0) continue;
            raw[line.slice(0, eq)] = line.slice(eq + 1);
        }
        assert.ok(tempPath, 'the PS probe never printed its temp directory: ' + JSON.stringify(res.stdout));
        return { map: filterGuardNames(raw), tempPath };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
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

// The pin. Builds each side's environment map from a real run of the real
// guard, and throws an AssertionError listing every difference when the two
// disagree. Returns the two maps when they agree, so a caller can read the
// values back.
function compareGuardEnvironments(jsPath, psPath) {
    const js = buildJsEnvMap(jsPath);
    const { map: ps, tempPath: psTempDir } = buildPsEnvMap(psPath);
    const jsTempDir = os.tmpdir();

    const problems = [];

    // A guard that stripped nothing, or a probe that captured nothing, must
    // never read as parity: each side is known to carry at least seven
    // names today (three scalars and two key/value pairs), so a reading
    // under that floor on either side means either the guard broke or the
    // probe did, never that the two sides agree by both losing the same
    // name.
    if (Object.keys(js).length < 7 || Object.keys(ps).length < 7) {
        problems.push('extraction floor: JS carries ' + Object.keys(js).length + ' names, PS carries '
            + Object.keys(ps).length + ' (both expected at least 7): either the guard broke, or a name was '
            + 'retired on both sides and this floor needs updating. JS: ' + JSON.stringify(js) + ' PS: ' + JSON.stringify(ps));
    }

    // The planted names never survive the strip, on either side, in either
    // casing.
    for (const name of PLANTED_NAMES_THAT_MUST_NOT_SURVIVE) {
        if (hasNameCI(js, name)) problems.push('JS side: planted ' + name + ' survived the strip: ' + JSON.stringify(js));
        if (hasNameCI(ps, name)) problems.push('PS side: planted ' + name + ' survived the strip: ' + JSON.stringify(ps));
    }

    if (!hasNameCI(js, 'NoDefaultCurrentDirectoryInExePath')) problems.push('JS side: missing NoDefaultCurrentDirectoryInExePath');
    if (!hasNameCI(ps, 'NoDefaultCurrentDirectoryInExePath')) problems.push('PS side: missing NoDefaultCurrentDirectoryInExePath');

    // The name sets, compared case-insensitively (Windows environment names
    // are case-insensitive), original spellings reported.
    const jsByUpper = new Map(Object.keys(js).map((k) => [k.toUpperCase(), k]));
    const psByUpper = new Map(Object.keys(ps).map((k) => [k.toUpperCase(), k]));
    const onlyJs = [...jsByUpper.keys()].filter((u) => !psByUpper.has(u)).map((u) => jsByUpper.get(u));
    const onlyPs = [...psByUpper.keys()].filter((u) => !jsByUpper.has(u)).map((u) => psByUpper.get(u));
    if (onlyJs.length) problems.push('JS-only names: ' + onlyJs.join(', '));
    if (onlyPs.length) problems.push('PS-only names: ' + onlyPs.join(', '));

    // Every value equal except GIT_CONFIG_VALUE_1, matched by upper-cased
    // name so a differently-cased spelling on one side still finds its peer.
    for (const upper of jsByUpper.keys()) {
        if (upper === 'GIT_CONFIG_VALUE_1') continue;
        if (!psByUpper.has(upper)) continue; // already reported as onlyJs above
        const jName = jsByUpper.get(upper);
        const pName = psByUpper.get(upper);
        if (js[jName] !== ps[pName]) {
            problems.push(jName + '/' + pName + ': JS=' + JSON.stringify(js[jName]) + ' PS=' + JSON.stringify(ps[pName]));
        }
    }

    // GIT_CONFIG_VALUE_1: shape rather than literal value, and the two must
    // differ from each other (a fresh GUID per call).
    if (jsByUpper.has('GIT_CONFIG_VALUE_1') && psByUpper.has('GIT_CONFIG_VALUE_1')) {
        const jVal = js[jsByUpper.get('GIT_CONFIG_VALUE_1')];
        const pVal = ps[psByUpper.get('GIT_CONFIG_VALUE_1')];
        const jProblem = value1ShapeProblem(jVal, jsTempDir);
        const pProblem = value1ShapeProblem(pVal, psTempDir);
        if (jProblem) problems.push('GIT_CONFIG_VALUE_1: JS value ' + jProblem);
        if (pProblem) problems.push('GIT_CONFIG_VALUE_1: PS value ' + pProblem);
        if (!jProblem && !pProblem && jVal === pVal) {
            problems.push('GIT_CONFIG_VALUE_1: JS and PS produced the identical value ' + JSON.stringify(jVal)
                + ', which a fresh GUID per call should never produce');
        }
    }

    // GIT_CONFIG_COUNT is pinned to the relationship (equal to the number of
    // GIT_CONFIG_KEY_<i> names actually present), not to today's literal
    // value, so a third pin added identically to both sides stays green.
    const jsKeyCount = Object.keys(js).filter((k) => /^GIT_CONFIG_KEY_\d+$/i.test(k)).length;
    if (jsByUpper.has('GIT_CONFIG_COUNT')) {
        const jsCount = js[jsByUpper.get('GIT_CONFIG_COUNT')];
        if (Number(jsCount) !== jsKeyCount) {
            problems.push('JS side: GIT_CONFIG_COUNT=' + jsCount + ' does not match ' + jsKeyCount + ' GIT_CONFIG_KEY_<i> names');
        }
    }
    const psKeyCount = Object.keys(ps).filter((k) => /^GIT_CONFIG_KEY_\d+$/i.test(k)).length;
    if (psByUpper.has('GIT_CONFIG_COUNT')) {
        const psCount = ps[psByUpper.get('GIT_CONFIG_COUNT')];
        if (Number(psCount) !== psKeyCount) {
            problems.push('PS side: GIT_CONFIG_COUNT=' + psCount + ' does not match ' + psKeyCount + ' GIT_CONFIG_KEY_<i> names');
        }
    }

    if (problems.length) {
        throw new assert.AssertionError({ message: 'guard parity broken:\n' + problems.join('\n') });
    }
    return { js, ps, jsTempDir, psTempDir };
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
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('the Node and PowerShell git guards hand git the same environment', { skip: !isWin }, () => {
    const result = compareGuardEnvironments(JS_PATH, PS_PATH);
    assert.ok(Object.keys(result.js).length >= 7, 'JS side: ' + JSON.stringify(result.js));
    assert.ok(Object.keys(result.ps).length >= 7, 'PS side: ' + JSON.stringify(result.ps));
});

// The control's first leg: run the comparison on untouched copies. It must
// pass, or the controls below (which assert it fails) would be proving
// nothing about the edit they make.
test('the pin passes on untouched copies of both files', { skip: !isWin }, () => {
    withCopies((jsCopy, psCopy) => {
        assert.doesNotThrow(() => compareGuardEnvironments(jsCopy, psCopy));
    });
});

test('adding a key to the JS copy only turns the pin red, naming the key as JS-only', { skip: !isWin }, () => {
    withCopies((jsCopy, psCopy) => {
        const before = fs.readFileSync(jsCopy, 'utf8');
        const anchor = "env.GIT_CONFIG_VALUE_1 = path.join(os.tmpdir(), 'kit-git-no-hooks-' + crypto.randomUUID());";
        assert.ok(before.includes(anchor), 'insertion anchor not found in the JS copy');
        const after = before.replace(anchor, anchor + "\n    env.GIT_KIT_PARITY_PROBE = '1';");
        fs.writeFileSync(jsCopy, after, 'utf8');

        assert.throws(() => compareGuardEnvironments(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError
                && err.message.includes('GIT_KIT_PARITY_PROBE')
                && err.message.includes('JS-only names'),
            'expected the comparison to throw naming GIT_KIT_PARITY_PROBE as a JS-only name');
    });
});

test('adding a key to the PS $guard table only turns the pin red, naming the key as PS-only', { skip: !isWin }, () => {
    withCopies((jsCopy, psCopy) => {
        const before = fs.readFileSync(psCopy, 'utf8');
        const anchor = '"GIT_CONFIG_VALUE_1"                 = $inertHooks';
        const at = before.indexOf(anchor);
        assert.ok(at >= 0, 'insertion anchor not found in the PS copy');
        const insertAt = at + anchor.length;
        const after = before.slice(0, insertAt) + '\r\n        "GIT_KIT_PARITY_PROBE" = "1"' + before.slice(insertAt);
        fs.writeFileSync(psCopy, after, 'utf8');

        assert.throws(() => compareGuardEnvironments(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError
                && err.message.includes('GIT_KIT_PARITY_PROBE')
                && err.message.includes('PS-only names'),
            'expected the comparison to throw naming GIT_KIT_PARITY_PROBE as a PS-only name');
    });
});

// The ordering hazard: swapping the Remove-Item and Set-Item loops means the
// guard's own values are set first and then removed by the Remove-Item pass
// (which runs against $saved, computed before either loop and, thanks to
// the planted GIT_CONFIG_COUNT, containing that name). The guard ends up
// handing git no GIT_CONFIG_COUNT at all.
test('swapping the PS Remove-Item and Set-Item loops turns the pin red, naming a GIT_CONFIG name', { skip: !isWin }, () => {
    withCopies((jsCopy, psCopy) => {
        const before = fs.readFileSync(psCopy, 'utf8');
        const removeLine = '        foreach ($name in @($saved.Keys)) { Remove-Item -LiteralPath ("Env:\\" + $name) -ErrorAction SilentlyContinue }';
        const setLine = '        foreach ($name in @($guard.Keys)) { Set-Item -LiteralPath ("Env:\\" + $name) -Value $guard[$name] }';
        assert.ok(before.includes(removeLine), 'the Remove-Item loop was not found in the PS copy');
        assert.ok(before.includes(setLine), 'the Set-Item loop was not found in the PS copy');
        const anchor = removeLine + '\r\n' + setLine;
        assert.ok(before.includes(anchor), 'the two loops are not adjacent as expected in the PS copy');
        const after = before.replace(anchor, setLine + '\r\n' + removeLine);
        fs.writeFileSync(psCopy, after, 'utf8');

        assert.throws(() => compareGuardEnvironments(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError && /GIT_CONFIG/.test(err.message),
            'expected the comparison to throw naming a GIT_CONFIG name');
    });
});

// The strip-predicate control: the loop that deletes every GIT_-prefixed
// name is deleted outright, so the planted GIT_KIT_PARITY_PLANTED (which
// only that loop removes) rides straight through to git.
test('deleting the JS strip loop turns the pin red, naming GIT_KIT_PARITY_PLANTED as still present on the JS side', { skip: !isWin }, () => {
    withCopies((jsCopy, psCopy) => {
        const before = fs.readFileSync(jsCopy, 'utf8');
        const anchor = '    for (const k of Object.keys(env)) {\r\n'
            + '        if (/^GIT_/i.test(k)) delete env[k];\r\n'
            + '    }\r\n';
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
