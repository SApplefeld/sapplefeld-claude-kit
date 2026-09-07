// Pin between the two git-invocation guards this repo carries: the Node
// hook side (plugins/claude-kit/hooks/kit-git-lib.js's gitChildEnv) and the
// PowerShell doctor side (plugins/claude-kit/doctor/install-memory-sync.ps1's
// Invoke-MemorySyncGit). Neither language can call the other's, so the two
// implementations are restated rather than shared, and nothing today would
// notice if one gained a key the other did not. This file is that notice.
//
// The comparison, extractGuardSets(jsPath, psPath), reads both files as
// text, extracts each guard's key set with its value's raw form, classifies
// each value as a literal or an expression, and throws an AssertionError
// naming every differing name on both sides when they disagree; it never
// truncates to the first difference. Taking the two paths as parameters is
// what lets the controls below run it against mkdtemp copies instead of
// only against the real files.
//
// GIT_CONFIG_VALUE_1 is pinned by shape rather than by literal value: both
// sides join a fresh GUID onto their own runtime's temp directory, and the
// two prefixes (kit-git-no-hooks- vs kit-memory-sync-no-hooks-) differ by
// design, so they are pinned to each end in "no-hooks-" rather than to each
// other. The PS side is accepted only when its hashtable entry is exactly
// the bare expression $inertHooks and the standalone $inertHooks assignment
// carries that shape, so a hashtable entry holding some other expression,
// or a literal, does not pass as the pinned shape by accident.
//
// The strip predicate ("does this guard remove every GIT_-prefixed name")
// is matched by shape after comment lines are stripped from the extracted
// block, so a copy of the literal moved into a comment does not read as the
// predicate still being live code. The two languages give the predicate
// different jobs relative to their own guard table, so the ordering check
// runs each side's own direction rather than one shared rule: the JS strip
// runs in a loop before any env.NAME assignment, so its match must precede
// the first one; the PS predicate is evaluated against $item.Name inside
// the loop that decides what to save before removal, and that loop reads
// $guard.Contains, so it runs after $guard is built, and its match must
// follow the $guard marker.
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

// Drops every line whose trimmed form opens with prefix, so a strip literal
// or a guard assignment quoted inside a comment does not read as live code.
function stripCommentLines(block, prefix) {
    return block.split(/\r?\n/).filter((line) => !line.trim().startsWith(prefix)).join('\n');
}

function detectEol(text) {
    return text.includes('\r\n') ? '\r\n' : '\n';
}

// Classifies a raw right-hand-side text: a single- or double-quoted string
// literal (the whole RHS, nothing else) gives a literal value; anything
// else, a variable reference or a call, is an expression carrying its raw
// text instead.
function classify(raw, quote) {
    const re = quote === "'" ? /^'([^']*)'$/ : /^"([^"]*)"$/;
    const m = re.exec(raw);
    return m ? { kind: 'literal', value: m[1] } : { kind: 'expression', raw };
}

// The JS side: every `env.NAME = <expr>;` assignment inside gitChildEnv,
// name-matched independently of what the value looks like, then classified.
function extractJs(text) {
    const block = bracedBlockAfter(text, 'function gitChildEnv()');
    const noComments = stripCommentLines(block, '//');

    const entries = {};
    const re = /env\.(\w+)\s*=\s*([^;]+);/g;
    let m;
    while ((m = re.exec(noComments))) entries[m[1]] = classify(m[2].trim(), "'");
    const names = Object.keys(entries);

    let value1 = null;
    const v1 = entries.GIT_CONFIG_VALUE_1;
    if (v1 && v1.kind === 'expression') {
        const shapeRe = /^path\.join\(os\.tmpdir\(\),\s*'([^']+)'\s*\+\s*crypto\.randomUUID\(\)\)$/;
        const shapeM = shapeRe.exec(v1.raw);
        if (shapeM) value1 = { prefix: shapeM[1] };
    }

    const stripRe = /\/\^GIT_\/i/;
    const stripMatch = stripRe.exec(noComments);
    const firstAssignMatch = /env\.\w+\s*=/.exec(noComments);
    const ordered = !!(stripMatch && firstAssignMatch && stripMatch.index < firstAssignMatch.index);

    return { names, entries, value1, hasStripLiteral: !!stripMatch, ordered };
}

// The PS side: every `"NAME" = <expr>` line inside the $guard hashtable
// literal only (not the whole function, so a same-shaped line elsewhere in
// the function cannot read as a guard member), name-matched independently
// of value shape and then classified. GIT_CONFIG_VALUE_1's expression is
// accepted only when the hashtable spells it as the bare $inertHooks
// reference and the standalone $inertHooks assignment carries the pinned
// temp-dir shape, so the two must agree rather than either alone.
function extractPs(text) {
    const funcBlock = bracedBlockAfter(text, 'function Invoke-MemorySyncGit');
    const noCommentsFunc = stripCommentLines(funcBlock, '#');
    const guardBlock = bracedBlockAfter(noCommentsFunc, '$guard = [ordered]@');

    const entries = {};
    const re = /"(\w+)"\s*=\s*([^\r\n]+)/g;
    let m;
    while ((m = re.exec(guardBlock))) entries[m[1]] = classify(m[2].trim(), '"');
    const names = Object.keys(entries);

    let value1 = null;
    const v1 = entries.GIT_CONFIG_VALUE_1;
    if (v1 && v1.kind === 'expression' && v1.raw === '$inertHooks') {
        const inertRe = /\$inertHooks\s*=\s*Join-Path\s*\(\[System\.IO\.Path\]::GetTempPath\(\)\)\s*\("([^"]+)"\s*\+\s*\[guid\]::NewGuid\(\)\.ToString\(\)\)/;
        const inertM = inertRe.exec(noCommentsFunc);
        if (inertM) value1 = { prefix: inertM[1] };
    }

    const stripRe = /-match\s+["']\^GIT_["']/;
    const stripMatch = stripRe.exec(noCommentsFunc);
    const guardMarkerIndex = noCommentsFunc.indexOf('$guard = [ordered]@');
    // $guard is built before the loop that reads -match "^GIT_" against it
    // (the loop uses $guard.Contains too), so this side's sane order is the
    // opposite of the JS side's: the match follows the marker.
    const ordered = !!(stripMatch && guardMarkerIndex >= 0 && stripMatch.index > guardMarkerIndex);

    return { names, entries, value1, hasStripLiteral: !!stripMatch, ordered };
}

// The pin. Reads both files, extracts each guard, and throws an
// AssertionError listing every differing name on both sides when they
// disagree. Returns the two extractions when they agree, so a caller can
// read the counts back.
function extractGuardSets(jsPath, psPath) {
    const js = extractJs(fs.readFileSync(jsPath, 'utf8'));
    const ps = extractPs(fs.readFileSync(psPath, 'utf8'));

    // A regex that silently matches nothing must never read as parity: each
    // side is known to carry at least seven guard names today (three
    // scalars, the prompt refusal, the exe-path pin and the config count,
    // plus two key/value pairs), so a reading under that floor on either
    // side means the extraction broke rather than that anything agrees.
    // This is a per-side floor rather than an equality check, because an
    // unequal count is itself the JS-only/PS-only defect the block below
    // exists to report, and asserting equality here would throw before that
    // report ever runs.
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
        const j = js.entries[name];
        const p = ps.entries[name];
        if (j.kind === 'literal' && p.kind === 'literal') {
            if (j.value !== p.value) {
                problems.push(name + ': JS=' + JSON.stringify(j.value) + ' PS=' + JSON.stringify(p.value));
            }
        } else if (j.kind !== p.kind) {
            const jDesc = j.kind === 'literal' ? JSON.stringify(j.value) : 'expression ' + JSON.stringify(j.raw);
            const pDesc = p.kind === 'literal' ? JSON.stringify(p.value) : 'expression ' + JSON.stringify(p.raw);
            problems.push(name + ': JS is ' + j.kind + ' (' + jDesc + '), PS is ' + p.kind + ' (' + pDesc + ')');
        } else if (j.raw !== p.raw) {
            problems.push(name + ': JS expression ' + JSON.stringify(j.raw) + ' PS expression ' + JSON.stringify(p.raw));
        }
    }

    if (jsSet.has('GIT_CONFIG_VALUE_1') && psSet.has('GIT_CONFIG_VALUE_1')) {
        const j = js.entries.GIT_CONFIG_VALUE_1;
        const p = ps.entries.GIT_CONFIG_VALUE_1;
        if (!js.value1) {
            const jDesc = j.kind === 'literal' ? JSON.stringify(j.value) : 'expression ' + JSON.stringify(j.raw);
            problems.push('GIT_CONFIG_VALUE_1: JS side is not the pinned os.tmpdir()+crypto.randomUUID() expression (' + jDesc + ')');
        }
        if (!ps.value1) {
            const pDesc = p.kind === 'literal' ? JSON.stringify(p.value) : 'expression ' + JSON.stringify(p.raw);
            problems.push('GIT_CONFIG_VALUE_1: PS side is not exactly $inertHooks bound to the pinned GetTempPath()+[guid]::NewGuid() expression (' + pDesc + ')');
        }
        if (js.value1 && !js.value1.prefix.endsWith('no-hooks-')) {
            problems.push('GIT_CONFIG_VALUE_1: JS prefix ' + JSON.stringify(js.value1.prefix) + ' does not end in "no-hooks-"');
        }
        if (ps.value1 && !ps.value1.prefix.endsWith('no-hooks-')) {
            problems.push('GIT_CONFIG_VALUE_1: PS prefix ' + JSON.stringify(ps.value1.prefix) + ' does not end in "no-hooks-"');
        }
    }

    if (!js.hasStripLiteral) problems.push('JS side: the /^GIT_/i strip literal was not found in gitChildEnv (outside comments)');
    else if (!js.ordered) problems.push('JS side: the /^GIT_/i strip literal does not precede the first env. assignment');

    if (!ps.hasStripLiteral) problems.push('PS side: the -match "^GIT_" strip predicate was not found in Invoke-MemorySyncGit (outside comments)');
    else if (!ps.ordered) problems.push('PS side: the -match "^GIT_" strip predicate does not follow the $guard marker');

    const jsKeyCount = js.names.filter((n) => /^GIT_CONFIG_KEY_\d+$/.test(n)).length;
    const jsCount = js.entries.GIT_CONFIG_COUNT;
    if (jsCount && jsCount.kind === 'literal' && Number(jsCount.value) !== jsKeyCount) {
        problems.push('JS side: GIT_CONFIG_COUNT=' + jsCount.value + ' does not match ' + jsKeyCount + ' GIT_CONFIG_KEY_<i> names');
    }
    const psKeyCount = ps.names.filter((n) => /^GIT_CONFIG_KEY_\d+$/.test(n)).length;
    const psCount = ps.entries.GIT_CONFIG_COUNT;
    if (psCount && psCount.kind === 'literal' && Number(psCount.value) !== psKeyCount) {
        problems.push('PS side: GIT_CONFIG_COUNT=' + psCount.value + ' does not match ' + psKeyCount + ' GIT_CONFIG_KEY_<i> names');
    }

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
        fn(jsCopy, psCopy);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('the Node and PowerShell git guards carry the same key set, values and strip predicate', () => {
    const result = extractGuardSets(JS_PATH, PS_PATH);
    assert.strictEqual(result.js.names.length, result.ps.names.length,
        'JS: ' + JSON.stringify(result.js.names) + ' PS: ' + JSON.stringify(result.ps.names));
    assert.ok(result.js.names.length >= 7, 'JS side: ' + JSON.stringify(result.js.names));
    assert.ok(result.ps.names.length >= 7, 'PS side: ' + JSON.stringify(result.ps.names));
});

// The control's first leg: run the comparison on untouched copies. It must
// pass, or the controls below (which assert it fails) would be proving
// nothing about the edit they make.
test('the pin passes on untouched copies of both files', () => {
    withCopies((jsCopy, psCopy) => {
        assert.doesNotThrow(() => extractGuardSets(jsCopy, psCopy));
    });
});

test('adding a literal-valued key to the JS copy only turns the pin red, naming the key as JS-only', () => {
    withCopies((jsCopy, psCopy) => {
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

// The name match must not depend on the value being a string literal: an
// expression-valued addition is just as JS-only as a literal-valued one.
test('adding an expression-valued key to the JS copy only turns the pin red, naming the key as JS-only', () => {
    withCopies((jsCopy, psCopy) => {
        const before = fs.readFileSync(jsCopy, 'utf8');
        const marker = "env.GIT_CONFIG_VALUE_1 = path.join(os.tmpdir(), 'kit-git-no-hooks-' + crypto.randomUUID());";
        assert.ok(before.includes(marker), 'insertion anchor not found in the JS copy');
        const after = before.replace(marker, marker + '\n    env.GIT_KIT_PARITY_PROBE = process.env.HOME;');
        fs.writeFileSync(jsCopy, after, 'utf8');

        assert.doesNotThrow(() => new Function(after), 'the edited JS copy no longer parses');

        assert.throws(() => extractGuardSets(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError
                && err.message.includes('GIT_KIT_PARITY_PROBE')
                && err.message.includes('JS-only names'),
            'expected the comparison to throw naming GIT_KIT_PARITY_PROBE as a JS-only name');
    });
});

// The mirror: the same key added to the PS copy only, inserted with the
// copy's own line ending rather than an assumed one.
test('adding a key to the PS copy only turns the pin red, naming the key as PS-only', () => {
    withCopies((jsCopy, psCopy) => {
        const before = fs.readFileSync(psCopy, 'utf8');
        const eol = detectEol(before);
        const marker = '"GIT_CONFIG_VALUE_1"                 = $inertHooks';
        const at = before.indexOf(marker);
        assert.ok(at >= 0, 'insertion anchor not found in the PS copy');
        const insertAt = at + marker.length;
        const after = before.slice(0, insertAt) + eol + '        "GIT_KIT_PARITY_PROBE" = "1"' + before.slice(insertAt);
        fs.writeFileSync(psCopy, after, 'utf8');

        assert.throws(() => extractGuardSets(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError
                && err.message.includes('GIT_KIT_PARITY_PROBE')
                && err.message.includes('PS-only names'),
            'expected the comparison to throw naming GIT_KIT_PARITY_PROBE as a PS-only name');

        // The inserted line is well-formed at a line boundary, matching the
        // copy's own line ending; pwsh is not run to prove it, per this
        // section's own bound.
        const lineEndRe = new RegExp('"GIT_KIT_PARITY_PROBE" = "1"' + (eol === '\r\n' ? '\r' : '') + '$', 'm');
        assert.ok(lineEndRe.test(after), 'the inserted line does not end with the copy\'s own line ending');
    });
});

// The value-drift control: same key on both sides, a differing literal.
test('drifting one literal value in the JS copy only turns the pin red, naming the key', () => {
    withCopies((jsCopy, psCopy) => {
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

// The GIT_CONFIG_VALUE_1 binding control: the hashtable entry stops being
// the bare $inertHooks reference, so the pinned shape is no longer bound to
// anything, even though the standalone $inertHooks assignment is untouched.
test('replacing the PS hashtable\'s $inertHooks reference with a literal turns the pin red, naming GIT_CONFIG_VALUE_1', () => {
    withCopies((jsCopy, psCopy) => {
        const before = fs.readFileSync(psCopy, 'utf8');
        const marker = '"GIT_CONFIG_VALUE_1"                 = $inertHooks';
        assert.ok(before.includes(marker), 'GIT_CONFIG_VALUE_1 hashtable entry not found in the PS copy');
        const after = before.replace(marker, '"GIT_CONFIG_VALUE_1"                 = "C:\\temp\\kit-hooks"');
        fs.writeFileSync(psCopy, after, 'utf8');

        assert.throws(() => extractGuardSets(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError && err.message.includes('GIT_CONFIG_VALUE_1'),
            'expected the comparison to throw naming GIT_CONFIG_VALUE_1');
    });
});

// The strip-predicate control: the literal moves into a comment and the
// loop that used it is deleted, so the guard no longer strips anything even
// though the text "/^GIT_/i" still appears in the file.
test('moving the JS strip literal into a comment and deleting the loop turns the pin red, naming the JS strip', () => {
    withCopies((jsCopy, psCopy) => {
        const before = fs.readFileSync(jsCopy, 'utf8');
        const eol = detectEol(before);
        const marker = '    for (const k of Object.keys(env)) {' + eol
            + '        if (/^GIT_/i.test(k)) delete env[k];' + eol
            + '    }' + eol;
        assert.ok(before.includes(marker), 'strip loop not found in the JS copy');
        const after = before.replace(marker, '    // /^GIT_/i' + eol);
        fs.writeFileSync(jsCopy, after, 'utf8');

        assert.doesNotThrow(() => new Function(after), 'the edited JS copy no longer parses');

        assert.throws(() => extractGuardSets(jsCopy, psCopy),
            (err) => err instanceof assert.AssertionError
                && err.message.includes('JS side')
                && err.message.includes('strip literal was not found'),
            'expected the comparison to throw naming the JS strip literal as absent');
    });
});
