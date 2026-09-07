// Tests for the shared output-channel renderer in
// plugins/claude-kit/hooks/kit-compact-lib.js: sanitizeForOutput, displayPath,
// scrub and homeElisionsKnown, the four exports every writer into a channel a
// model reads goes through.
//
// Node's built-in test runner, no framework (Node v24). The renderer's elision
// table is compiled once at module load from os.homedir(), so a case cannot
// move the home directory under a library this process already required: every
// rendering case runs in a CHILD node process with HOME and USERPROFILE both
// set to a fixture home (os.homedir() reads USERPROFILE on win32 and HOME
// elsewhere, so both are set and neither platform reads the operator's own).
// One child per fixture home carries every probe that home stages, rather than
// one child per assertion, since the process is the expensive part and the
// probes are pure.
//
// The two containment directions and the marking rules are also pinned
// end-to-end against the checkpoint CLI in test/kit-compact-gate.test.js. These
// ask the library exports directly, which is where the renderer now lives and
// what a second caller will reach for.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const LIB = path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'kit-compact-lib.js');
const CLI = path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'kit-compact-checkpoint.js');

// The fixture account name, deliberately a string that appears nowhere in a
// temp directory's own path on any box this suite runs on. The operator's real
// account name sits inside os.tmpdir() on win32, so a case asserting "the
// account name is absent from this rendering" against a common name like
// `admin` would read the machine's own path and fail for a reason that is not
// the renderer's.
const ACCOUNT = 'zephyrina';

const scratchRoots = [];

function makeDir(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    scratchRoots.push(dir);
    return dir;
}

process.on('exit', () => {
    for (const dir of scratchRoots) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
});

// The probes one fixture home stages, run in a child whose home directory IS
// that fixture. Each probe is [name, exported function, argument, max], with a
// null max calling the function with one argument so the default cap is the
// one under test. The child answers with a JSON object of name to rendering,
// and a probe that throws answers with its error text under the same name
// rather than taking the whole batch down, so a red names the probe that broke.
const CHILD = `
    const lib = require(process.env.PROBE_LIB);
    const out = {};
    for (const [name, fn, arg, max] of JSON.parse(process.env.PROBE_LIST)) {
        try {
            out[name] = max === null ? lib[fn](arg) : lib[fn](arg, max);
        } catch (err) {
            out[name] = 'PROBE THREW: ' + (err && err.message ? err.message : String(err));
        }
    }
    try {
        out['home known'] = lib.homeElisionsKnown();
    } catch (err) {
        out['home known'] = 'PROBE THREW: ' + (err && err.message ? err.message : String(err));
    }
    process.stdout.write(JSON.stringify(out));
`;

function render(home, probes) {
    const run = spawnSync(process.execPath, ['-e', CHILD], {
        env: {
            ...process.env,
            HOME: home,
            USERPROFILE: home,
            PROBE_LIB: LIB,
            PROBE_LIST: JSON.stringify(probes)
        },
        encoding: 'utf8'
    });
    assert.strictEqual(run.status, 0,
        'the probe child must exit clean, since every assertion below reads its stdout: '
        + run.stdout + run.stderr);
    return JSON.parse(run.stdout);
}

// A home directory and a sibling of it, both created on disk so the fixture is
// a real layout rather than a pair of strings.
function stageHome(name) {
    const parent = makeDir('kit-output-channel-');
    const home = path.join(parent, name);
    fs.mkdirSync(home, { recursive: true });
    return { parent, home };
}

// The home directory in the spelling a transcript directory carries it in:
// every non-alphanumeric character turned to a dash, which is
// sanitizeProjectPath's rule in scripts/memq.js and the reason the account name
// can sit in the middle of one path component.
function flattened(full) {
    return full.replace(/[^A-Za-z0-9]/g, '-');
}

test('renderer: a sibling whose name starts with the home directory keeps its own name', () => {
    // The over-elision direction. A text-prefix elision replaces the shared
    // characters and prints the remainder as a home-relative path, so home
    // <tmp>/zeph against <tmp>/zephyrina/repo/x renders as ~yrina/repo/x: a
    // path that is nowhere on disk, on a channel whose legs name files for an
    // operator to act on.
    const { parent, home } = stageHome('zeph');
    const sibling = path.join(parent, ACCOUNT, 'repo', 'x');
    const out = render(home, [['sibling', 'displayPath', sibling, null]]);

    assert.strictEqual(out['sibling'], sibling,
        'a directory beside the home directory renders unchanged, since none of it is under the '
        + 'home directory');
    assert.ok(!out['sibling'].includes('~'),
        'and no part of it is elided as though it were: ' + out['sibling']);
});

test('renderer: a home prefix differing only in letter case is elided on win32', {
    skip: process.platform !== 'win32'
        ? 'case-insensitive path containment is a win32 property; off it the two spellings are '
            + 'two different directories and rendering the path in full is correct'
        : false
}, () => {
    // The under-elision direction, and the one that costs what the guard
    // exists to prevent: on win32 a path differing from the home directory
    // only in case IS under it, so a prefix test on the text does not
    // recognize it and prints the OS account name raw into a channel a model
    // reads.
    const { parent, home } = stageHome('Zephyrina');
    const cased = path.join(parent, ACCOUNT, 'repo', 'x');
    assert.notStrictEqual(cased, path.join(home, 'repo', 'x'),
        'test setup: the case-flipped spelling must actually differ from the home directory');
    const out = render(home, [['cased', 'displayPath', cased, null]]);

    assert.strictEqual(out['cased'], '~' + path.sep + path.join('repo', 'x'),
        'the path is recognized as home-anchored and elided');
    assert.ok(!/zephyrina/i.test(out['cased']),
        'so no spelling of the account name reaches the channel: ' + out['cased']);
});

test('renderer: the flattened home spelling is elided mid-path, and only at a boundary', () => {
    // A session transcript is filed under a directory named by the whole
    // project path with each non-alphanumeric character turned to a dash, so
    // for a checkout under the home directory the account name sits INSIDE one
    // component, with another component in front of it. Eliding a leading
    // prefix cannot reach it there.
    const { parent, home } = stageHome(ACCOUNT);
    const middle = path.join(parent, 'projects', flattened(home), 'x.jsonl');
    const neighbour = flattened(home) + 'x';
    const out = render(home, [
        ['middle', 'scrub', middle, null],
        ['middle capped', 'sanitizeForOutput', middle, 400],
        ['neighbour', 'scrub', neighbour, null]
    ]);

    assert.ok(!out['middle'].includes(ACCOUNT),
        'the account name is absent from the rendered transcript path: ' + out['middle']);
    assert.ok(out['middle'].includes('flattened-home'),
        'and the flattened spelling is what stands in its place, which says for itself that the '
        + 'text was altered and what was taken out: ' + out['middle']);
    assert.strictEqual(out['middle capped'], out['middle'],
        'the capped renderer elides the same spelling, since it is the same elision under the cap');

    assert.strictEqual(out['neighbour'], neighbour,
        'a flattened name that continues with an alphanumeric is a different directory and keeps '
        + 'its own name, which is the boundary rule the leading-prefix bug reproduces');
});

test('renderer: a value is marked for what was discarded from it, and only for that', () => {
    // Both ways of DISCARDING text are marked, because both leave the reader
    // looking at something that is not the value: the cap takes the tail off,
    // and the strip deletes characters from the middle of an accented or CJK
    // name and leaves a plausible-looking shorter one. The home elision is the
    // third alteration and carries no mark, since `~` says for itself what was
    // taken out.
    const { home } = stageHome(ACCOUNT);
    const long = 'x'.repeat(200);
    // Longer than the cap by its home prefix alone, and by that prefix only:
    // the name is sized from the fixture home's own length so the raw text
    // lands just past the cap and the elided text is well inside it, whatever
    // this box's temp directory is named.
    const paddingLength = 121 - (home.length + 1);
    assert.ok(paddingLength > 0,
        'test setup: the fixture home must sit inside the cap, or no name can be sized to cross it '
        + 'by the prefix alone: ' + home.length + ' characters of home against a cap of 120');
    const padding = 'a'.repeat(paddingLength);
    const homed = path.join(home, padding);
    assert.ok(homed.length > 120 && padding.length + 2 <= 120,
        'test setup: the un-elided path must be past the cap and the elided one inside it, or '
        + 'the case pins nothing: ' + homed.length + ' raw, ' + (padding.length + 2) + ' elided');
    const out = render(home, [
        ['stripped', 'sanitizeForOutput', 'abécd', null],
        ['cut', 'sanitizeForOutput', long, null],
        ['both', 'sanitizeForOutput', 'aé' + long, null],
        ['elided', 'sanitizeForOutput', homed, null]
    ]);

    assert.strictEqual(out['stripped'], 'abcd [characters removed]',
        'a character deleted from the middle of a name is marked, since an unmarked one sends an '
        + 'operator after a file that is not on disk');
    assert.strictEqual(out['cut'], 'x'.repeat(120) + ' [cut to fit]',
        'a value past the cap is marked cut, and the mark rides after the cap rather than inside '
        + 'it, so the mark itself is never the thing that gets cut');
    assert.strictEqual(out['both'], 'a' + 'x'.repeat(119) + ' [characters removed; cut to fit]',
        'a value can take both marks, so the two are decided separately and read together');

    assert.strictEqual(out['elided'], '~' + path.sep + padding,
        'a value carried past the cap only by a home prefix the channel removes is elided whole');
    assert.ok(!out['elided'].includes('cut to fit'),
        'and is not marked cut, since the cut is decided on the text the reader will see rather '
        + 'than on the string before rendering: ' + out['elided']);
});

test('renderer: a relative path and the home directory itself render as themselves', () => {
    // A relative input is never elided, which is what keeps a repo-relative
    // plan path printing as itself: resolving it first would rewrite
    // docs/plans/x.md as a longer ~-anchored absolute path for a value that
    // carried no home prefix at all. The home directory itself is the one
    // reading where the account name would otherwise be the whole output.
    const { home } = stageHome(ACCOUNT);
    const relative = path.join('docs', 'plans', 'x.md');
    const out = render(home, [
        ['relative', 'displayPath', relative, null],
        ['home', 'displayPath', home, null]
    ]);

    assert.strictEqual(out['relative'], relative, 'a relative path renders as itself');
    assert.strictEqual(out['home'], '~', 'and the home directory renders as the tilde alone');
    assert.strictEqual(out['home known'], true,
        'the floor reads as standing, since this child has a knowable home directory');
});

test('renderer: a home spelling introduced by a separator is elided rather than refused', () => {
    // The leading boundary is a deny-list of what would make the text a
    // different name. A separator in front of the home spelling does not: a
    // win32 long-path prefix, a file URL and a doubled separator all introduce
    // the SAME directory, and refusing them prints the account name into a
    // channel a model reads, which is the expensive direction. What a leading
    // separator was refused for, a doubled-separator spelling of some other
    // path, costs an over-elision that names a path nowhere on disk, the cheap
    // one, and the alphanumeric refusal alone still kills the floating match
    // (/mnt/backup/home/admin, whose candidate is preceded by the p of backup).
    const { home } = stageHome(ACCOUNT);
    const forward = home.replace(/\\/g, '/');
    const out = render(home, [
        ['long-path prefix', 'scrub', '\\\\?\\' + home + '\\repo\\x', null],
        ['file url', 'scrub', 'file:///' + forward + '/repo/x', null],
        ['doubled separator', 'scrub', '/mnt/backup//' + forward + '/x', null],
        ['long-path prefix as a path', 'displayPath', '\\\\?\\' + home + '\\repo\\x', null],
        ['floating', 'scrub', '/mnt/backup' + forward + '/x', null]
    ]);
    for (const name of ['long-path prefix', 'file url', 'doubled separator', 'long-path prefix as a path']) {
        assert.ok(!out[name].includes(ACCOUNT),
            name + ': the account name is absent from the rendering: ' + out[name]);
        assert.ok(out[name].includes('~'),
            name + ': and the home directory is named in its elided form: ' + out[name]);
    }
    assert.ok(out.floating.includes(ACCOUNT) && !out.floating.includes('~'),
        'a home spelling preceded by an alphanumeric is some other path and keeps its name: '
        + out.floating);
});

// Every function name the source declares at the top level, extracted
// STRUCTURALLY rather than from a list of the names this file cares about: the
// pattern is handed the shape of a declaration and nothing else, so the control
// below can be drawn from a name it was never given.
function declaredFunctions(source) {
    const names = [];
    // A declaration at any indentation, in either spelling a copy could take: a
    // function statement, or a const, let or var bound to a function or arrow.
    const re = /^\s*(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>))/gm;
    let m;
    while ((m = re.exec(source)) !== null) names.push(m[1] || m[2]);
    return names;
}

// The renderer's parts, by the names they are declared under.
const RENDERER_PARTS = ['printableAscii', 'sanitizeForOutput', 'displayPath', 'homeElisions', 'scrub'];

// Every JavaScript source the plugin ships under its hooks and scripts
// directories, subdirectories included, which is the class a second copy of
// the renderer could appear in.
function pluginSources() {
    const roots = [
        path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks'),
        path.join(__dirname, '..', 'plugins', 'claude-kit', 'scripts')
    ];
    const files = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.js')) files.push(full);
        }
    };
    for (const root of roots) walk(root);
    return files;
}

test('renderer: it is defined in the shared library and in no other plugin source', () => {
    // One renderer with one home. A private copy is what the plan this section
    // belongs to is retiring: two spellings of the elision drift, and the one a
    // caller reaches for is then decided by which file it happens to sit next
    // to. The sweep is over every plugin source rather than the one CLI that
    // carried the copy, since the next copy would be written into whichever
    // channel is moved onto the renderer next.
    const libSrc = fs.readFileSync(LIB, 'utf8');
    const cliSrc = fs.readFileSync(CLI, 'utf8');
    const sources = pluginSources();
    assert.ok(sources.includes(LIB) && sources.includes(CLI),
        'test setup: the sweep must reach the library and the CLI, or it reads the wrong tree');

    const libDeclared = declaredFunctions(libSrc);
    const cliDeclared = declaredFunctions(cliSrc);
    // The extractor speaking on both files first, so neither reading below is
    // an empty list produced by a pattern that matched nothing at all.
    assert.ok(libDeclared.length > 50,
        'the library declares a great many functions, so an extractor returning almost none has '
        + 'failed rather than found a clean result: ' + libDeclared.length);
    assert.ok(cliDeclared.length > 20,
        'and so does the CLI: ' + cliDeclared.length);

    assert.deepStrictEqual(RENDERER_PARTS.filter((name) => !libDeclared.includes(name)), [],
        'every part of the renderer is declared in the shared library');
    const copies = [];
    for (const file of sources) {
        if (file === LIB) continue;
        const declared = declaredFunctions(fs.readFileSync(file, 'utf8'));
        for (const name of RENDERER_PARTS) {
            if (declared.includes(name)) copies.push(path.basename(file) + ':' + name);
        }
    }
    assert.deepStrictEqual(copies, [],
        'and none of them is declared in any other plugin source, each of which calls the library '
        + 'rather than carrying a second copy');

    const exported = require(LIB);
    for (const name of ['sanitizeForOutput', 'displayPath', 'scrub', 'homeElisionsKnown']) {
        assert.strictEqual(typeof exported[name], 'function',
            'and the library exports ' + name + ', which is how another channel reaches the '
            + 'renderer instead of spelling the elision again');
    }

    // The control, on a name WITHHELD from the extractor's own pattern: the
    // pattern is given the shape of a declaration rather than any of the names
    // in RENDERER_PARTS, so a variant carrying one is caught on the shape. A
    // silent detector and a clean file read alike from here, and this is what
    // tells the two apart.
    const scratch = makeDir('kit-output-channel-control-');
    const variant = cliSrc.replace('function usage() {',
        'function displayPath(p) { return p; }\n\nfunction usage() {');
    assert.notStrictEqual(variant, cliSrc, 'the control must differ from the source');
    const controlFile = path.join(scratch, 'private-copy-variant.js');
    fs.writeFileSync(controlFile, variant, 'utf8');
    assert.ok(declaredFunctions(fs.readFileSync(controlFile, 'utf8')).includes('displayPath'),
        'the detector speaks on a file that does carry a private copy, so its silence on the CLI '
        + 'is a reading rather than a broken pattern');
    // And on the other spelling a copy could take, indented and bound to an
    // arrow, so the sweep's silence covers the shape rather than one statement.
    const arrowVariant = cliSrc.replace('function usage() {',
        'function usage() {\n    const scrub = (text) => text;');
    assert.ok(declaredFunctions(arrowVariant).includes('scrub'),
        'the detector speaks on an indented arrow binding too');
});
