// Pin between the two git-invocation guards this repo carries: the Node
// hook side (plugins/claude-kit/hooks/kit-git-lib.js's gitChildEnv) and the
// PowerShell doctor side (plugins/claude-kit/doctor/install-memory-sync.ps1's
// Invoke-MemorySyncGit). Neither language can call the other's, so the two
// implementations are restated rather than shared, and nothing today would
// notice if one gained a key the other did not. This file is that notice.
//
// The comparison, extractGuardSets(jsPath, psPath), reads both files as
// text, extracts each guard's key set and literal values with a bounded,
// brace-tracked regex, and throws an AssertionError naming every differing
// name on both sides when they disagree; it never truncates to the first
// difference. Taking the two paths as parameters is what lets the controls
// below run it against mkdtemp copies instead of only against the real
// files.
//
// GIT_CONFIG_VALUE_1 is pinned by shape rather than by literal value: both
// sides join a fresh GUID onto their own runtime's temp directory, and the
// two prefixes (kit-git-no-hooks- vs kit-memory-sync-no-hooks-) differ by
// design, so they are pinned to each end in "no-hooks-" rather than to each
// other.
//
// Node's built-in test runner, no framework. Every case owns its own
// mkdtemp directory (or none at all, for the read-only real-files case) and
// shares nothing with its neighbours.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = path.join(__dirname, '..');
const JS_PATH = path.join(REPO, 'plugins', 'claude-kit', 'hooks', 'kit-git-lib.js');
const PS_PATH = path.join(REPO, 'plugins', 'claude-kit', 'doctor', 'install-memory-sync.ps1');

// The braced block that opens at the first "{" after marker, tracked by
// depth rather than by a fixed line range, so a control's inserted line
// still resolves to the same block instead of an earlier stray "}".
function bracedBlockAfter(text, marker) {
    const at = text.indexOf(marker);
    assert.ok(at >= 0, 'marker not found in file: ' + marker);
    const openAt = text.indexOf('{', at);
    assert.ok(openAt >= 0, 'no opening brace after marker: ' + marker);
    let depth = 0;
    for (let i = openAt; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
            depth--;
            if (depth === 0) return text.slice(openAt, i + 1);
        }
    }
    throw new Error('unbalanced braces after marker: ' + marker);
}

// The JS side: `env.NAME = 'value';` lines inside gitChildEnv, plus the one
// name (GIT_CONFIG_VALUE_1) whose value is an expression rather than a
// string literal.
function extractJs(text) {
    const block = bracedBlockAfter(text, 'function gitChildEnv()');
    const values = {};
    const re = /env\.(\w+)\s*=\s*'([^']*)';/g;
    let m;
    while ((m = re.exec(block))) values[m[1]] = m[2];
    const names = Object.keys(values);

    const value1re = /env\.GIT_CONFIG_VALUE_1\s*=\s*path\.join\(os\.tmpdir\(\),\s*'([^']+)'\s*\+\s*crypto\.randomUUID\(\)\);/;
    const value1m = value1re.exec(block);
    let value1 = null;
    if (value1m) {
        names.push('GIT_CONFIG_VALUE_1');
        value1 = { prefix: value1m[1] };
    }

    return { names, values, value1, stripsGitPrefix: block.includes('/^GIT_/i') };
}

// The PS side: `"NAME" = "value"` and `"NAME" = $inertHooks` lines inside
// the $guard hashtable, and the $inertHooks assignment that carries the
// GIT_CONFIG_VALUE_1 shape. Both sit inside Invoke-MemorySyncGit's own
// block, which is the one this function extracts.
function extractPs(text) {
    const block = bracedBlockAfter(text, 'function Invoke-MemorySyncGit');
    const values = {};
    const names = [];
    const re = /"(\w+)"\s*=\s*("([^"]*)"|\$inertHooks)/g;
    let m;
    while ((m = re.exec(block))) {
        names.push(m[1]);
        if (m[3] !== undefined) values[m[1]] = m[3];
    }

    const inertRe = /\$inertHooks\s*=\s*Join-Path\s*\(\[System\.IO\.Path\]::GetTempPath\(\)\)\s*\("([^"]+)"\s*\+\s*\[guid\]::NewGuid\(\)\.ToString\(\)\)/;
    const inertM = inertRe.exec(block);
    let value1 = null;
    if (inertM && names.includes('GIT_CONFIG_VALUE_1')) value1 = { prefix: inertM[1] };

    return { names, values, value1, stripsGitPrefix: block.includes('-match "^GIT_"') };
}

// The pin. Reads both files, extracts each guard, and throws an
// AssertionError listing every differing name on both sides when they
// disagree. Returns the two extractions when they agree, so a caller can
// read the counts back.
function extractGuardSets(jsPath, psPath) {
    const js = extractJs(fs.readFileSync(jsPath, 'utf8'));
    const ps = extractPs(fs.readFileSync(psPath, 'utf8'));

    // A regex that silently matches nothing must never read as parity: both
    // sides are known to carry seven guard names (the prompt refusal, the
    // exe-path pin, the config count, two key/value pairs and the third
    // key), so fewer than that means the extraction broke, not that the
    // guards agree.
    assert.ok(js.names.length >= 7,
        'JS extraction found only ' + js.names.length + ' names, expected at least 7: ' + JSON.stringify(js.names));
    assert.ok(ps.names.length >= 7,
        'PS extraction found only ' + ps.names.length + ' names, expected at least 7: ' + JSON.stringify(ps.names));

    const problems = [];
    const jsSet = new Set(js.names);
    const psSet = new Set(ps.names);

    const onlyJs = js.names.filter((n) => !psSet.has(n));
    const onlyPs = ps.names.filter((n) => !jsSet.has(n));
    if (onlyJs.length) problems.push('JS-only names: ' + onlyJs.join(', '));
    if (onlyPs.length) problems.push('PS-only names: ' + onlyPs.join(', '));

    for (const name of js.names) {
        if (name === 'GIT_CONFIG_VALUE_1') continue;
        if (!psSet.has(name)) continue; // already reported as onlyJs above
        if (js.values[name] !== ps.values[name]) {
            problems.push(name + ': JS=' + JSON.stringify(js.values[name]) + ' PS=' + JSON.stringify(ps.values[name]));
        }
    }

    if (jsSet.has('GIT_CONFIG_VALUE_1') && psSet.has('GIT_CONFIG_VALUE_1')) {
        if (!js.value1) problems.push('GIT_CONFIG_VALUE_1: JS side does not reference os.tmpdir() and crypto.randomUUID()');
        if (!ps.value1) problems.push('GIT_CONFIG_VALUE_1: PS side does not reference GetTempPath() and [guid]::NewGuid()');
        if (js.value1 && !js.value1.prefix.endsWith('no-hooks-')) {
            problems.push('GIT_CONFIG_VALUE_1: JS prefix ' + JSON.stringify(js.value1.prefix) + ' does not end in "no-hooks-"');
        }
        if (ps.value1 && !ps.value1.prefix.endsWith('no-hooks-')) {
            problems.push('GIT_CONFIG_VALUE_1: PS prefix ' + JSON.stringify(ps.value1.prefix) + ' does not end in "no-hooks-"');
        }
    }

    if (!js.stripsGitPrefix) problems.push('JS side: the /^GIT_/i strip literal was not found in gitChildEnv');
    if (!ps.stripsGitPrefix) problems.push('PS side: the -match "^GIT_" strip predicate was not found in Invoke-MemorySyncGit');

    if (problems.length) {
        throw new assert.AssertionError({ message: 'guard parity broken:\n' + problems.join('\n') });
    }
    return { js, ps };
}

function withCopies(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitguard-parity-'));
    const jsCopy = path.join(dir, 'kit-git-lib.js');
    const psCopy = path.join(dir, 'install-memory-sync.ps1');
    fs.copyFileSync(JS_PATH, jsCopy);
    fs.copyFileSync(PS_PATH, psCopy);
    try {
        fn(dir, jsCopy, psCopy);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('the Node and PowerShell git guards carry the same key set, literal values and strip predicate', () => {
    const result = extractGuardSets(JS_PATH, PS_PATH);
    assert.strictEqual(result.js.names.length, 7, 'JS side: ' + JSON.stringify(result.js.names));
    assert.strictEqual(result.ps.names.length, 7, 'PS side: ' + JSON.stringify(result.ps.names));
});

// The control's first leg: run the comparison on untouched copies. It must
// pass, or the controls below (which assert it fails) would be proving
// nothing about the edit they make.
test('the pin passes on untouched copies of both files', () => {
    withCopies((dir, jsCopy, psCopy) => {
        assert.doesNotThrow(() => extractGuardSets(jsCopy, psCopy));
    });
});

test('adding a key to the JS copy only turns the pin red, naming the key as JS-only', () => {
    withCopies((dir, jsCopy, psCopy) => {
        const before = fs.readFileSync(jsCopy, 'utf8');
        const marker = "env.GIT_CONFIG_VALUE_1 = path.join(os.tmpdir(), 'kit-git-no-hooks-' + crypto.randomUUID());";
        assert.ok(before.includes(marker), 'insertion anchor not found in the JS copy');
        const after = before.replace(marker, marker + "\n    env.GIT_KIT_PARITY_PROBE = '1';");
        fs.writeFileSync(jsCopy, after, 'utf8');

        // The copy stays syntactically valid JS: a parse-only compile
        // (never executed) throws on a malformed insertion and nothing
        // else, so this proves the line landed well-formed without
        // spawning anything.
        assert.doesNotThrow(() => new Function(after), 'the edited JS copy no longer parses');

        assert.throws(() => extractGuardSets(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError
                && err.message.includes('GIT_KIT_PARITY_PROBE')
                && err.message.includes('JS-only names'),
            'expected the comparison to throw naming GIT_KIT_PARITY_PROBE as a JS-only name');
    });
});

// The mirror: the same key added to the PS copy only.
test('adding a key to the PS copy only turns the pin red, naming the key as PS-only', () => {
    withCopies((dir, jsCopy, psCopy) => {
        const before = fs.readFileSync(psCopy, 'utf8');
        const marker = '"GIT_CONFIG_VALUE_1"                 = $inertHooks';
        const at = before.indexOf(marker);
        assert.ok(at >= 0, 'insertion anchor not found in the PS copy');
        const insertAt = at + marker.length;
        const after = before.slice(0, insertAt) + '\n        "GIT_KIT_PARITY_PROBE" = "1"' + before.slice(insertAt);
        fs.writeFileSync(psCopy, after, 'utf8');

        assert.throws(() => extractGuardSets(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError
                && err.message.includes('GIT_KIT_PARITY_PROBE')
                && err.message.includes('PS-only names'),
            'expected the comparison to throw naming GIT_KIT_PARITY_PROBE as a PS-only name');

        // The copy stays a well-formed line at a line boundary (the file is
        // CRLF, matched here rather than assumed); pwsh is not run to prove
        // it, per this section's own bound.
        assert.ok(/^\s*"GIT_KIT_PARITY_PROBE" = "1"\r?$/m.test(after), 'the inserted line is not well-formed');
    });
});

// The value-drift control: same key on both sides, a differing literal.
test('drifting one literal value in the JS copy only turns the pin red, naming the key', () => {
    withCopies((dir, jsCopy, psCopy) => {
        const before = fs.readFileSync(jsCopy, 'utf8');
        const marker = "env.GIT_CONFIG_VALUE_0 = 'false';";
        assert.ok(before.includes(marker), 'GIT_CONFIG_VALUE_0 assignment not found in the JS copy');
        const after = before.replace(marker, "env.GIT_CONFIG_VALUE_0 = 'true';");
        fs.writeFileSync(jsCopy, after, 'utf8');

        assert.throws(() => extractGuardSets(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError
                && err.message.includes('GIT_CONFIG_VALUE_0')
                && err.message.includes('"true"')
                && err.message.includes('"false"'),
            'expected the comparison to throw naming GIT_CONFIG_VALUE_0 as differing');
    });
});
