// Tests for the scenario probe corpus under test/probes/ and its parser at
// tools/probe-corpus/probe-file.mjs.
//
// Two subjects, one file. The corpus tests walk every probe in the tree and pin
// what a run depends on and the parser cannot see: the moment matches the
// filename, the option list sits inside the bound test/probes/README.md states,
// and every file the shapes name is really there, because a shape naming a file
// that moved composes a prompt with a hole in it and the run reports a mismatch
// that is about the probe rather than about the corpus it was meant to measure.
// What the parser already refuses is pinned once against a fixture below rather
// than a second time against every probe. The parser tests drive one malformed
// fixture per rejection rule, asserting on the thrown message, since a parser
// that accepts a half-written probe drops a ruling out of a run whose exit code
// is a count of mismatches.
//
// Node's built-in runner, no framework, no install. The parser is an ES module
// and this file is CommonJS, which Node 24 loads through require() directly.
// Fixtures are strings for the parser cases and a temp directory for the
// listing cases, so nothing here writes into the tree it measures.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    parseProbeFile,
    listProbeFiles,
    VERDICTS,
    TIERS,
    RULING_STATES,
    PLUGIN_PREFIX,
    HOME_ENTRY
} = require('../tools/probe-corpus/probe-file.mjs');

// The shared git runner, which fixes the child's working directory away from
// the repository under question and strips every GIT_* variable out of the
// child environment. The one call below passes a fixed argument array with
// nothing from a probe file in it.
const { gitOutput } = require('../plugins/claude-kit/hooks/kit-git-lib.js');

const REPO = path.join(__dirname, '..');
const PROBES_DIR = path.join(__dirname, 'probes');
const HOME_ROOT = path.join(os.homedir(), '.claude');

// Wider than the shared runner's 4 s default, on the reading test/doctrine-
// parity.test.js states at its own figure: a question about a whole repository
// outlasts the per-file question a hook asks, on a box whose one heavy-process
// slot a suite shares with whatever else holds it.
const GIT_TIMEOUT_MS = 20000;

// Every path the git index carries, in the spelling the index carries it in.
// A repo entry is pinned against this listing rather than against the file
// system because this box's file system is case-insensitive and `git show
// <ref>:<path>` is not: an entry spelled `output-styles/KIT.md` opens fine
// here and resolves to nothing under the runner's `--before` mode. A git that
// could not answer is recorded and asserted, since a pin nobody took is no
// evidence about a path.
let trackedError = null;
let trackedPaths = new Set();
{
    const out = gitOutput(REPO, ['ls-files', '-z'], { timeoutMs: GIT_TIMEOUT_MS });
    if (out === null) {
        trackedError = new Error('`git ls-files -z` returned nothing usable for ' + REPO);
    } else {
        trackedPaths = new Set(out.split('\0').filter((name) => name !== ''));
    }
}

// The moments the precedence plan's pilot read, which the runner's acceptance
// reproduces against snapshots of that plan's before-and-after trees. This is a
// corpus-membership pin rather than a count: the reproduction has nothing to run
// if one of the three is renamed or dropped, and a count would stay green
// through either.
const PILOT_MOMENTS = [
    'commit-and-push-at-section-close',
    'branch-and-pr-pull-request-at-section-close',
    'seat-asked-to-push-the-memory-store'
];

// The listing runs at module load because every per-probe test below is
// generated from it, and its failure is captured rather than thrown: a throw
// here aborts the file before Node's runner has registered a single test, which
// reports as an empty run rather than as a corpus that could not be read.
let listingError = null;
let listed = [];
try {
    listed = listProbeFiles(PROBES_DIR);
} catch (err) {
    listingError = err;
}
const probeFiles = listed;

// One parse per file for the whole run, so a corpus test reads the same probe
// the parse test did and neither pays for the other's read.
const parseCache = new Map();
function probeOf(file) {
    if (!parseCache.has(file)) {
        const text = fs.readFileSync(file, 'utf8');
        parseCache.set(file, parseProbeFile(text, { path: path.relative(REPO, file).replace(/\\/g, '/') }));
    }
    return parseCache.get(file);
}

// Where a shape's file entry resolves, and whether it is one of the `home/`
// entries that live under ~/.claude with no copy in this tree.
function resolveEntry(relPath) {
    if (relPath.startsWith('home/')) {
        return { abs: path.join(HOME_ROOT, relPath.slice('home/'.length)), home: true };
    }
    return { abs: path.join(REPO, relPath), home: false };
}

// The kind of the file an entry resolves to, or null where nothing is there.
function statOf(abs) {
    try {
        return fs.statSync(abs);
    } catch {
        return null;
    }
}

// Every file entry in `probe` that a run could not hand a reader, and every
// `home/` entry that is absent on this box. Two rules decide a repo entry: it
// resolves to a regular file, which a directory entry fails (the parser reads no
// file system, so `plugins/claude-kit/skills` is a path it passes), and the git
// index carries it in that spelling, which an untracked file and a mis-cased
// entry both fail and which is asked only where the listing was taken. The home
// absence is the only permitted one: a home file has no git ref behind it and a
// box that never installed one is not a broken probe, so it is reported with its
// reason rather than counted missing.
function shapeFileReadings(probe) {
    const missing = [];
    const skipped = [];
    for (const shape of probe.shapes) {
        for (const relPath of shape.files) {
            const { abs, home } = resolveEntry(relPath);
            const stat = statOf(abs);
            if (stat === null) {
                if (home) {
                    skipped.push({ shape: shape.name, file: relPath, reason: 'absent under ' + HOME_ROOT + ' on this box' });
                } else {
                    missing.push({ shape: shape.name, file: relPath, reason: 'absent from the worktree' });
                }
                continue;
            }
            if (!stat.isFile()) {
                missing.push({ shape: shape.name, file: relPath, reason: 'present but not a regular file' });
                continue;
            }
            if (home) continue;
            // A git that could not answer leaves no listing to judge membership
            // against, and an empty set would report every entry in the corpus as
            // untracked. The absent listing is its own assertion below, which is
            // the one that reports it.
            if (trackedError !== null) continue;
            if (!trackedPaths.has(relPath)) {
                missing.push({
                    shape: shape.name,
                    file: relPath,
                    reason: 'present in the worktree and not listed by `git ls-files`: either it is untracked (not yet'
                        + ' `git add`ed) or it is spelled in a case the git index does not carry'
                });
            }
        }
    }
    return { missing, skipped };
}

test('the probe corpus lists and is not empty', () => {
    assert.strictEqual(listingError, null,
        'listProbeFiles refused ' + PROBES_DIR + ': ' + (listingError && listingError.message));
    assert.ok(probeFiles.length > 0, 'listProbeFiles found no probe under ' + PROBES_DIR);
});

test('the corpus README is not read as a probe', () => {
    assert.ok(fs.existsSync(path.join(PROBES_DIR, 'README.md')), 'test/probes/README.md is missing');
    assert.deepStrictEqual(probeFiles.filter((f) => path.basename(f) === 'README.md'), []);
});

test('every probe carries a distinct moment', () => {
    const byMoment = new Map();
    for (const file of probeFiles) {
        const moment = probeOf(file).moment;
        const first = byMoment.get(moment);
        assert.ok(first === undefined, 'moment ' + moment + ' is claimed by both ' + first + ' and ' + path.basename(file));
        byMoment.set(moment, path.basename(file));
    }
    assert.strictEqual(byMoment.size, probeFiles.length);
});

test('the pilot moments section 2 reproduces are in the corpus', () => {
    const moments = probeFiles.map((file) => probeOf(file).moment);
    for (const moment of PILOT_MOMENTS) {
        assert.ok(moments.includes(moment), 'the corpus has no probe for the pilot moment ' + moment);
    }
});

for (const file of probeFiles) {
    const name = path.basename(file);

    test('probe ' + name + ' parses and its moment is its filename', () => {
        const probe = probeOf(file);
        assert.strictEqual(probe.moment, name.replace(/\.md$/, ''), 'the moment slug must equal the file basename');
    });

    test('probe ' + name + ' offers a closed list of four to six answers', () => {
        const probe = probeOf(file);
        assert.ok(probe.options.length >= 4 && probe.options.length <= 6,
            'the option list holds ' + probe.options.length + ' answers, outside the four to six a probe offers');
    });

    test('probe ' + name + ' names shape files that exist', () => {
        const probe = probeOf(file);
        const { missing, skipped } = shapeFileReadings(probe);
        assert.deepStrictEqual(missing, [],
            'the predicate is statSync(...).isFile() plus membership in `git ls-files` over every file entry of'
            + ' every shape in ' + name + ', resolved against ' + REPO
            + ' and, for a home/ entry, isFile alone under ' + HOME_ROOT);
        for (const entry of skipped) {
            assert.ok(entry.reason, 'a skipped home/ entry carries no reason');
        }
    });
}

test('the git listing the shape pin reads was taken', () => {
    assert.strictEqual(trackedError, null,
        'the shape-file pin falls back on nothing when git cannot answer: ' + (trackedError && trackedError.message));
    assert.ok(trackedPaths.size > 0, '`git ls-files -z` listed no path under ' + REPO);
});

// Three controls, each an instance the predicate's own literals never name: a
// path that is not there, a real directory (which the parser passes, since it
// reads no file system, and which existsSync would have called present), and a
// real file spelled in a case the git index does not carry (which this box's
// case-insensitive file system also calls present, and `git show <ref>:<path>`
// does not).
// Of the three, only the mis-cased one rests on the `git ls-files` listing: the
// absent and the directory instance are answered by `statSync` alone, so they
// are asserted whatever git could do, and the skip covers the one control that
// has nothing to run against.
test('the shape-file predicate speaks when a file is absent, is a directory, or is mis-cased', (t) => {
    const probe = {
        shapes: [
            { name: 'present', files: ['plugins/claude-kit/output-styles/kit.md'] },
            { name: 'absent', files: ['plugins/claude-kit/skills/' + 'no-such-skill-' + process.pid + '/SKILL.md'] },
            { name: 'directory', files: ['plugins/claude-kit/output-styles'] }
        ]
    };
    const { missing, skipped } = shapeFileReadings(probe);
    assert.deepStrictEqual(missing.map((entry) => entry.shape), ['absent', 'directory'],
        'a control instance went unreported: ' + JSON.stringify(missing));
    assert.match(missing[0].reason, /absent from the worktree/);
    assert.match(missing[1].reason, /not a regular file/);
    assert.deepStrictEqual(skipped, []);

    if (trackedError !== null) {
        t.skip('the mis-cased control rests on the `git ls-files` listing, which this run could not take');
        return;
    }
    const cased = shapeFileReadings({
        shapes: [{ name: 'mis-cased', files: ['plugins/claude-kit/output-styles/KIT.md'] }]
    });
    assert.deepStrictEqual(cased.missing.map((entry) => entry.shape), ['mis-cased'],
        'the mis-cased control went unreported: ' + JSON.stringify(cased.missing));
    assert.match(cased.missing[0].reason, /`git ls-files`|absent from the worktree/,
        'a mis-cased entry reads as untracked on a case-insensitive file system and as absent on a case-sensitive one');
    assert.deepStrictEqual(cased.skipped, []);
});

test('an absent home/ entry is reported as a skip with its reason, not as a missing file', () => {
    const probe = { shapes: [{ name: 'home-only', files: ['home/no-such-home-file-' + process.pid + '.md'] }] };
    const { missing, skipped } = shapeFileReadings(probe);
    assert.deepStrictEqual(missing, []);
    assert.strictEqual(skipped.length, 1);
    assert.match(skipped[0].reason, /absent under /);
});

// The fixture the parser cases start from. Each case mutates one thing, so the
// rule under test is the only reason its fixture can be refused. Its file
// entries sit under the plugin root because that is one of the two roots a
// shape may name; they need not exist, since this module reads no filesystem
// for `files`.
const FILE_A = 'plugins/claude-kit/one.md';
const FILE_B = 'plugins/claude-kit/two.md';

const BASE = [
    '---',
    'moment: a-moment',
    'tier: sonnet',
    'verdict: RESOLVED',
    'answer: first-answer',
    'ruling: proposed 2026-09-06',
    'options:',
    '  - first-answer',
    '  - second-answer',
    'shapes:',
    '  - name: full',
    '    files:',
    '      - ' + FILE_A,
    '      - ' + FILE_B,
    '  - name: narrow',
    '    files:',
    '      - ' + FILE_A,
    '---',
    '# A moment',
    '',
    'You are a session. What do you do?',
    ''
].join('\n');

function withLine(from, to) {
    assert.ok(BASE.includes(from), 'the fixture no longer carries ' + JSON.stringify(from));
    return BASE.replace(from, to);
}

function refusal(text) {
    let thrown = null;
    try {
        parseProbeFile(text, { path: 'probe.md' });
    } catch (err) {
        thrown = err;
    }
    assert.ok(thrown, 'the parser accepted a fixture it must refuse');
    assert.match(thrown.message, /^probe\.md:\d+: /, 'the refusal names neither the path nor a line: ' + thrown.message);
    return thrown.message;
}

test('the base fixture parses into the whole probe', () => {
    const probe = parseProbeFile(BASE, { path: 'probe.md' });
    assert.strictEqual(probe.moment, 'a-moment');
    assert.strictEqual(probe.tier, 'sonnet');
    assert.strictEqual(probe.verdict, 'RESOLVED');
    assert.strictEqual(probe.answer, 'first-answer');
    assert.deepStrictEqual(probe.ruling, { state: 'proposed', date: '2026-09-06' });
    assert.deepStrictEqual(probe.options, ['first-answer', 'second-answer']);
    assert.deepStrictEqual(probe.shapes, [
        { name: 'full', designedMismatch: null, files: [FILE_A, FILE_B] },
        { name: 'narrow', designedMismatch: null, files: [FILE_A] }
    ]);
    assert.strictEqual(probe.scenario, '# A moment\n\nYou are a session. What do you do?\n');
});

test('a ruled probe carries the ruled state', () => {
    const probe = parseProbeFile(withLine('ruling: proposed 2026-09-06', 'ruling: ruled 2026-09-07'), { path: 'probe.md' });
    assert.deepStrictEqual(probe.ruling, { state: 'ruled', date: '2026-09-07' });
});

test('a whole-line comment, a CRLF line ending and a byte order mark are read, not refused', () => {
    const commented = withLine('tier: sonnet', '# only an orchestrator meets this one\ntier: opus');
    assert.strictEqual(parseProbeFile(commented, { path: 'probe.md' }).tier, 'opus');
    const indented = withLine('  - name: full', '    # the whole governing set\n  - name: full');
    assert.strictEqual(parseProbeFile(indented, { path: 'probe.md' }).shapes[0].name, 'full');
    const crlf = '\ufeff' + BASE.split('\n').join('\r\n');
    const probe = parseProbeFile(crlf, { path: 'probe.md' });
    assert.strictEqual(probe.moment, 'a-moment');
    assert.deepStrictEqual(probe.shapes[0].files, [FILE_A, FILE_B]);
});

test('a file with no opening fence is refused', () => {
    assert.match(refusal('moment: a-moment\n' + BASE), /must open with a `---` frontmatter fence/);
});

test('a file with no closing fence is refused', () => {
    const noClose = BASE.split('\n').filter((line, i) => !(i === 17 && line === '---')).join('\n');
    assert.match(refusal(noClose), /no closing `---` fence/);
});

test('an unknown top-level key is refused', () => {
    assert.match(refusal(withLine('tier: sonnet', 'tier: sonnet\nowner: executing-work')), /unknown top-level key "owner"/);
});

test('a duplicate top-level key is refused', () => {
    assert.match(refusal(withLine('tier: sonnet', 'tier: sonnet\ntier: opus')), /duplicate top-level key "tier"/);
});

test('a scalar with no value is refused', () => {
    assert.match(refusal(withLine('moment: a-moment', 'moment:')), /key "moment" has an empty value/);
});

test('a list key carrying a value on its own line is refused', () => {
    assert.match(refusal(withLine('options:', 'options: first-answer')), /key "options" is a list/);
});

test('a moment that is not a slug is refused', () => {
    assert.match(refusal(withLine('moment: a-moment', 'moment: A Moment')), /`moment` must be a lower-case hyphenated slug/);
});

test('a tier outside sonnet and opus is refused', () => {
    assert.match(refusal(withLine('tier: sonnet', 'tier: haiku')), /`tier` must be one of sonnet, opus/);
});

test('a verdict outside the three tokens is refused, at the verdict line', () => {
    const message = refusal(withLine('verdict: RESOLVED', 'verdict: MAYBE'));
    assert.match(message, /`verdict` must be one of RESOLVED, CONTESTED, SILENT/);
    assert.match(message, /^probe\.md:4: /, 'the refusal names a line other than the verdict line: ' + message);
});

test('a malformed ruling is refused', () => {
    assert.match(refusal(withLine('ruling: proposed 2026-09-06', 'ruling: proposed 6 September 2026')), /`ruling` must read/);
    assert.match(refusal(withLine('ruling: proposed 2026-09-06', 'ruling: 2026-09-06')), /`ruling` must read/);
    assert.match(refusal(withLine('ruling: proposed 2026-09-06', 'ruling: adopted 2026-09-06')), /`ruling` must read/);
});

test('a ruling date that does not exist is refused', () => {
    assert.match(refusal(withLine('ruling: proposed 2026-09-06', 'ruling: proposed 2026-02-30')), /a date that does not exist/);
});

test('an answer outside the options is refused', () => {
    assert.match(refusal(withLine('answer: first-answer', 'answer: third-answer')), /is not one of the options/);
});

test('a single option is refused', () => {
    assert.match(refusal(withLine('  - second-answer\n', '')), /must offer at least two answers/);
});

test('an option repeated is refused', () => {
    assert.match(refusal(withLine('  - second-answer', '  - first-answer')), /duplicate option "first-answer"/);
});

// The runner unwraps backticks and quotes off a reply's ANSWER line and lowers
// its case before comparing, so an option carrying any of that punctuation is an
// option a reply cannot be told apart from its neighbour on. The slug bar is
// where that collapse is refused, one side of the match rather than both.
test('an option that is not a slug is refused, including a backticked or mis-cased one', () => {
    for (const entry of ['`second-answer`', '"second-answer"', 'First-Answer', 'second answer', 'second_answer']) {
        assert.match(refusal(withLine('  - second-answer', '  - ' + entry)),
            /an option must be a lower-case hyphenated slug/,
            'the option ' + entry + ' was not refused by the slug rule');
    }
});

// Trailing whitespace on a fence line is invisible in every editor. Read
// strictly, the opening one would make a file with no frontmatter at all and the
// closing one would run the frontmatter into the scenario body, so a fence is
// the three dashes and whatever an editor left after them.
test('a fence carrying trailing whitespace is a fence', () => {
    const opening = BASE.replace(/^---/, '--- ');
    assert.strictEqual(parseProbeFile(opening, { path: 'probe.md' }).moment, 'a-moment');
    const closing = BASE.replace('\n---\n# A moment', '\n---\t\n# A moment');
    assert.ok(closing !== BASE, 'the fixture no longer carries the closing fence this case rewrites');
    const probe = parseProbeFile(closing, { path: 'probe.md' });
    assert.strictEqual(probe.scenario, '# A moment\n\nYou are a session. What do you do?\n');
    // The control: three dashes with something other than whitespace after them
    // is not a fence, and the file opening with one has no frontmatter.
    assert.match(refusal(BASE.replace(/^---/, '--- x')), /must open with a `---` frontmatter fence/);
});

// The one optional key a shape mapping carries: it names why that shape reads
// against the probe's answer, and the runner keeps its disagreement out of the
// exit code. It belongs to a shape, so it is refused everywhere else.
test('a shape carries an optional designed-mismatch slug and nothing else does', () => {
    const marked = parseProbeFile(
        withLine('  - name: narrow', '  - name: narrow\n    designed-mismatch: the-copy-drops-the-exception'),
        { path: 'probe.md' }
    );
    assert.deepStrictEqual(marked.shapes, [
        { name: 'full', designedMismatch: null, files: [FILE_A, FILE_B] },
        { name: 'narrow', designedMismatch: 'the-copy-drops-the-exception', files: [FILE_A] }
    ]);
    assert.match(refusal(withLine('  - name: narrow', '  - name: narrow\n    designed-mismatch: Not A Slug')),
        /`designed-mismatch` must be a lower-case hyphenated slug/);
    assert.match(refusal(withLine('  - name: narrow', '  - name: narrow\n    designed-mismatch:')),
        /`designed-mismatch` must be a lower-case hyphenated slug/);
    assert.match(refusal(withLine('  - name: narrow',
        '  - name: narrow\n    designed-mismatch: one-reason\n    designed-mismatch: another-reason')),
    /a second `designed-mismatch:` in shape "narrow"/);
    // Outside a shape mapping it is not a key at all: at the top level it is
    // unknown, and inside the option list it is not a list entry.
    assert.match(refusal(withLine('tier: sonnet', 'tier: sonnet\ndesigned-mismatch: the-copy-drops-the-exception')),
        /unknown top-level key "designed-mismatch"/);
    assert.match(refusal(withLine('  - second-answer', '  - second-answer\n  designed-mismatch: the-copy-drops-the-exception')),
        /expected a list entry of the form `- value`/);
});

// The key binds to a shape by position rather than by indentation, so a key
// written anywhere after a shape's files marks that shape from below: at the end
// of its own file list, or on the line before the next `- name:`, where it reads
// to an author as a key of the shape that follows and to the parser as one of
// the shape that came before. Both are refused, so the marker either sits in its
// shape's opening or is not a marker at all.
test('a designed-mismatch key sits between a shape\'s name and its files, and nowhere else', () => {
    const afterItsOwnFiles = withLine('  - name: narrow\n    files:\n      - ' + FILE_A,
        '  - name: narrow\n    files:\n      - ' + FILE_A + '\n    designed-mismatch: read-from-below');
    assert.match(refusal(afterItsOwnFiles),
        /`designed-mismatch:` after the `files:` list of shape "narrow" has begun/);
    const aboveTheNextShape = withLine('  - name: narrow', '  designed-mismatch: read-from-below\n  - name: narrow');
    assert.match(refusal(aboveTheNextShape),
        /`designed-mismatch:` after the `files:` list of shape "full" has begun/);
    // The control: the same key in the opening of the same shape is accepted,
    // so the refusals above are about where it sits and not about the key.
    const inTheOpening = parseProbeFile(
        withLine('  - name: narrow', '  - name: narrow\n    designed-mismatch: read-from-below'),
        { path: 'probe.md' }
    );
    assert.strictEqual(inTheOpening.shapes[1].designedMismatch, 'read-from-below');
});

test('a probe with one shape is refused', () => {
    const oneShape = withLine('  - name: narrow\n    files:\n      - ' + FILE_A + '\n', '');
    assert.match(refusal(oneShape), /at least two shapes, got 1/);
});

test('a shape with no files is refused', () => {
    assert.match(refusal(withLine('  - name: narrow\n    files:\n      - ' + FILE_A, '  - name: narrow')), /names no files/);
});

test('a duplicate shape name is refused', () => {
    assert.match(refusal(withLine('  - name: narrow', '  - name: full')), /duplicate shape name "full"/);
});

test('a shape name that is not a slug is refused, because it becomes a directory component', () => {
    assert.match(refusal(withLine('  - name: narrow', '  - name: ../narrow')), /shape name must be a lower-case hyphenated slug/);
});

test('a file entry reaching out of the tree is refused', () => {
    assert.match(refusal(withLine('      - ' + FILE_B, '      - ../../etc/passwd')), /may not reach out of the tree with `\.\.`/);
    assert.match(refusal(withLine('      - ' + FILE_B, '      - /etc/passwd')), /must be a repo-relative path in forward slashes/);
    assert.match(refusal(withLine('      - ' + FILE_B, '      - C:\\\\Windows\\\\win.ini')), /must be a repo-relative path in forward slashes/);
});

test('a file entry naming a directory is refused', () => {
    assert.match(refusal(withLine('      - ' + FILE_B, '      - plugins/claude-kit/skills/')), /names a file rather than a directory/);
});

// The allowlist, driven from the far side: each of these is a path a run would
// otherwise copy into a cold reader's prompt out of the real tree or the real
// home directory. `..`, an absolute path and a backslash are already refused
// above, and every entry here passes all three, which is what the two roots are
// for.
test('a file entry outside the plugin root and the home markdown files is refused', () => {
    for (const entry of ['.git/config', '.env', 'docs/plans/acme_search-index_spec_v1.md', 'tools/probe-corpus/run.mjs']) {
        assert.match(refusal(withLine('      - ' + FILE_B, '      - ' + entry)),
            /a file entry sits under "plugins\/claude-kit\/" or names a `home\/<name>\.md` file under ~\/\.claude/,
            'the entry ' + entry + ' was not refused by the two-roots rule');
    }
});

test('a home/ entry that is not one markdown file directly under ~/.claude is refused', () => {
    for (const entry of ['home/.credentials.json', 'home/projects/x.md', 'home/settings.json']) {
        assert.match(refusal(withLine('      - ' + FILE_B, '      - ' + entry)),
            /a `home\/` entry names one markdown file directly under ~\/\.claude/,
            'the entry ' + entry + ' was not refused by the home/ rule');
    }
});

test('a bare `home/` is refused by the directory rule, ahead of the home/ rule', () => {
    assert.match(refusal(withLine('      - ' + FILE_B, '      - home/')),
        /names a file rather than a directory/);
});

// A path spelled two ways is one file, and a shape that names it under both
// spellings passes the duplicate-entry rule, which compares the entries as
// strings.
test('a file entry carrying a `.` or an empty path segment is refused', () => {
    for (const entry of [
        'plugins/claude-kit/./skills/role/SKILL.md',
        'plugins/claude-kit//skills/role/SKILL.md',
        'home/./CLAUDE.md',
        './plugins/claude-kit/one.md'
    ]) {
        assert.match(refusal(withLine('      - ' + FILE_B, '      - ' + entry)),
            /carries no `\.` or empty path segment/,
            'the entry ' + entry + ' was not refused by the segment rule');
    }
});

test('the two roots a shape may name still parse', () => {
    const probe = parseProbeFile(
        withLine('      - ' + FILE_B, '      - plugins/claude-kit/skills/role/SKILL.md\n      - home/CLAUDE.md'),
        { path: 'probe.md' }
    );
    assert.deepStrictEqual(probe.shapes[0].files, [
        FILE_A,
        'plugins/claude-kit/skills/role/SKILL.md',
        'home/CLAUDE.md'
    ]);
});

test('a file entry repeated inside one shape is refused', () => {
    assert.match(refusal(withLine('      - ' + FILE_B, '      - ' + FILE_A)), /names "plugins\/claude-kit\/one\.md" twice/);
});

test('a `#` inside a list entry is refused rather than truncated', () => {
    assert.match(refusal(withLine('  - second-answer', '  - second-answer   # the runner matches the whole slug')),
        /a list entry carries no trailing `#` comment/);
    assert.match(refusal(withLine('      - ' + FILE_B, '      - ' + FILE_B + '   # the narrow shape drops this one')),
        /a list entry carries no trailing `#` comment/);
});

// A scalar takes the same rule as a list entry, and for the same reason. Read as
// a comment, `answer: first-answer #2` is the value `first-answer`, which is in
// the options and passes every rule after it, so the probe runs against an
// answer nobody wrote.
test('a `#` on a top-level scalar is refused rather than truncated', () => {
    for (const line of [
        'answer: first-answer #2',
        'moment: a-moment # the moment this probe covers',
        'ruling: proposed 2026-09-06   # awaiting the operator',
        'verdict: RESOLVED\t# one action'
    ]) {
        const key = line.slice(0, line.indexOf(':'));
        assert.match(refusal(withLine(BASE.split('\n').find((l) => l.startsWith(key + ':')), line)),
            /a top-level value carries no trailing `#` comment/,
            'the line ' + JSON.stringify(line) + ' was not refused by the scalar comment rule');
    }
});

test('a missing required key is refused', () => {
    assert.match(refusal(withLine('answer: first-answer\n', '')), /missing required key "answer"/);
});

test('an empty scenario body is refused', () => {
    assert.match(refusal(BASE.split('\n').slice(0, 18).join('\n') + '\n'), /the scenario body is empty/);
});

test('an indented line outside any list is refused', () => {
    assert.match(refusal(withLine('tier: sonnet', 'tier: sonnet\n  - stray')), /indented line outside any list/);
});

test('a shape file entry before any files list is refused', () => {
    assert.match(refusal(withLine('  - name: full\n    files:\n', '  - name: full\n')), /a file entry outside a shape's `files:` list/);
});

test('a files list before any shape is refused', () => {
    assert.match(refusal(withLine('shapes:\n  - name: full', 'shapes:\n    files:\n  - name: full')), /`files:` before any `- name:` shape entry/);
});

test('a second files list in one shape is refused', () => {
    assert.match(refusal(withLine('    files:\n      - ' + FILE_A + '\n      - ' + FILE_B, '    files:\n    files:\n      - ' + FILE_A)), /a second `files:` list in one shape/);
});

test('a list entry with no space after the dash is refused', () => {
    assert.match(refusal(withLine('  - second-answer', '  -second-answer')), /expected a list entry of the form `- value`/);
});

test('an unrecognized line inside shapes is refused', () => {
    assert.match(refusal(withLine('    files:\n      - ' + FILE_A + '\n      - ' + FILE_B, '    tier: sonnet\n    files:\n      - ' + FILE_A)), /expected `- name: <slug>`, `designed-mismatch: <slug>`, `files:`, or `- <path>`/);
});

test('a top-level line that is not a key is refused', () => {
    assert.match(refusal(withLine('tier: sonnet', 'tier sonnet')), /expected a top-level `key: value`/);
});

test('content that is not text is refused', () => {
    assert.match(refusal(Buffer.from(BASE)), /probe file content is not text/);
});

test('listProbeFiles returns sorted absolute paths and reads only regular markdown files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-list-'));
    try {
        fs.writeFileSync(path.join(dir, 'zulu.md'), BASE, 'utf8');
        fs.writeFileSync(path.join(dir, 'alpha.md'), BASE, 'utf8');
        fs.writeFileSync(path.join(dir, 'README.md'), '# not a probe\n', 'utf8');
        fs.writeFileSync(path.join(dir, 'notes.txt'), 'not markdown\n', 'utf8');
        fs.mkdirSync(path.join(dir, 'nested.md'));
        const found = listProbeFiles(dir);
        assert.deepStrictEqual(found, [path.resolve(dir, 'alpha.md'), path.resolve(dir, 'zulu.md')]);
        assert.ok(found.every((p) => path.isAbsolute(p)));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// Untested here, and named rather than left silent: the bounded-listing refusal,
// which fires only on a probes directory past the shared reader's scan cap.
// Standing one up means creating thousands of files under a temp directory,
// which costs more wall clock than the refusal is worth; the two readings that
// reach it in practice, an absent path and a path that is not a directory, are
// pinned below, and an unreadable directory now reports its own errno from the
// open rather than arriving here as `bounded`.
test('listProbeFiles refuses a directory that is not there', () => {
    const absent = path.join(os.tmpdir(), 'probe-list-absent-' + process.pid);
    assert.throws(() => listProbeFiles(absent), /no such probe directory/);
});

test('listProbeFiles refuses a path that is a file rather than a directory', () => {
    const file = path.join(os.tmpdir(), 'probe-list-file-' + process.pid + '.md');
    fs.writeFileSync(file, BASE, 'utf8');
    try {
        assert.throws(() => listProbeFiles(file), /the probe path is not a directory/);
    } finally {
        fs.rmSync(file, { force: true });
    }
});

// The three closed sets are the parser's public vocabulary: the runner matches a
// reply's verdict against VERDICTS, dispatches at a tier from TIERS, and reports
// a ruling state from RULING_STATES, so their values are a contract rather than
// an implementation detail.
test('the parser exports the three closed sets whole', () => {
    assert.deepStrictEqual(VERDICTS, ['RESOLVED', 'CONTESTED', 'SILENT']);
    assert.deepStrictEqual(TIERS, ['sonnet', 'opus']);
    assert.deepStrictEqual(RULING_STATES, ['proposed', 'ruled']);
});

// The two roots are exported for the same reason the closed sets are: the runner
// decides where a shape's file entry resolves, and a root spelled a second time
// there is a second allowlist that can drift from the one the parser enforces.
test('the parser exports the two roots a shape may name', () => {
    assert.strictEqual(PLUGIN_PREFIX, 'plugins/claude-kit/');
    assert.ok(HOME_ENTRY instanceof RegExp, 'HOME_ENTRY is not a regular expression');
    assert.ok(HOME_ENTRY.test('home/CLAUDE.md'), 'HOME_ENTRY refuses a markdown file directly under ~/.claude');
    assert.ok(!HOME_ENTRY.test('home/projects/x.md'), 'HOME_ENTRY admits a path below ~/.claude');
    assert.ok(!HOME_ENTRY.test('home/settings.json'), 'HOME_ENTRY admits a file that is not markdown');
});

test('listProbeFiles does not read a symbolic link as a probe', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-link-'));
    try {
        const real = path.join(dir, 'real.md');
        fs.writeFileSync(real, BASE, 'utf8');
        try {
            fs.symlinkSync(real, path.join(dir, 'linked.md'));
        } catch (err) {
            t.skip('this box does not permit creating a symbolic link: ' + err.code);
            return;
        }
        assert.deepStrictEqual(listProbeFiles(dir), [path.resolve(dir, 'real.md')]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
