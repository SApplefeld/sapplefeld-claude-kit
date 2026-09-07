// The kit's size ratchet: tests for plugins/claude-kit/scripts/kit-size.js and
// the gate over test/size-budget.json.
//
// Node's built-in test runner, no framework. Two subjects sit here rather than
// one. The ratchet itself is the gate: every tracked file under the script's six
// measured roots is measured against its committed cap, so growth past a cap is a
// red rather than a thing somebody notices at an audit. Those roots are the
// skills, agents and output-styles directories under plugins/claude-kit/, the
// markdown files directly under home/, test/probes/, and test/; a tracked file
// outside them is unmeasured and this gate says nothing about it. The script's failure
// reasons are the second subject, and each is driven separately, because a gate
// that can only report "something failed" cannot tell a file over its cap from a
// file the classifier never reached, and those two want opposite fixes.
//
// The expensive failure here is a ratchet that greens on a file it never
// classified: the caps would all pass while an unmeasured corpus grew beside
// them. Its control is the coverage diff, driven two ways. The classifier takes
// its path list as a parameter, so a synthetic list can carry a path shaped like
// nothing the classifier's patterns name and the diff is watched catching it;
// and a fixture repository plants such a file for real, under git, so the
// end-to-end path is proven rather than only the pure function. Neither control
// is a path the patterns already spell: each is matched on its shape, under a
// measured root, which is what makes an empty result over the real tree evidence
// of coverage rather than evidence that the instrument runs.
//
// Two things that control cannot reach, and no case below claims it does. A
// curated root nobody added to the script's root list: a path under no root is
// outside the tool's subject entirely, so a new curated directory ships unmeasured
// with this file green. And an untracked file a measured shape does reach that no
// cap names: it is in neither the measured set, which is tracked files, nor the
// pending set, which is budget keys, so `check` greens on it and only `report`
// names it. The second is deliberate rather than a hole waiting to be closed. A cap
// for content nobody has committed is a figure with no subject, and a gate that
// red on one would red on another session's untracked file in a shared checkout.
//
// A root prefix differing only in case takes the script's second control, the
// pathspec cross-check, because the first one cannot see it end to end: git's
// pathspec matching is case-sensitive, so the tracked-path listing never returns
// such a path and the classifier never sees it. Two cases cover that pair. One
// drives the classifier over an injected list to say what it does with a
// case-variant path; the other plants one in a real index and watches the
// cross-check red on it, with a correctly-cased sibling planted the same way as
// the control.
//
// The reds are each paired with the same state minus the defect, so a red proves
// the injected defect fired rather than proving the fixture always fails.
//
// A real tracked file cannot be planted in this checkout to drive the
// unclassified case: a shared worktree may hold another session's uncommitted
// work, so every case that needs a mutated tree gets its own repository under the
// system temp directory instead. That repository is built once per process and
// copied per case: the build is three git spawns, and paying it per case bought
// nothing, since what each case needs is a tree it may mutate rather than a fresh
// history.

'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'plugins', 'claude-kit', 'scripts', 'kit-size.js');
const BUDGET = path.join(REPO, 'test', 'size-budget.json');
const kit = require(SCRIPT);
// The shared git runner, required here for the one case whose subject is its
// output ceiling: the report's HEAD read is designed around that ceiling, so the
// ceiling's own semantic is pinned rather than assumed.
const { gitOutput, gitChildEnv, MAX_OUTPUT_BYTES } = require(path.join(REPO, 'plugins', 'claude-kit', 'hooks', 'kit-git-lib.js'));

// A directory holding no git configuration and no exclusions file, built once per
// process. It is where every git invocation in this file, spawned or in-process,
// looks for a HOME: the default excludes path resolves from XDG_CONFIG_HOME or
// HOME, and global configuration resolves from HOME too, so an excludes file or a
// global config on this machine reaches nothing here.
//
// One residue, and it is not reachable through the environment. System
// configuration is read whatever this directory holds: the shared runner
// hooks/kit-git-lib.js strips every GIT_* key from the child it spawns, so
// GIT_CONFIG_SYSTEM survives neither the in-process `kit.*` readings nor a spawned
// script's own git children, and the direct fixture spawns are the only class it
// reaches. So a core.excludesFile set in system configuration reaches the readings
// under test, and no environment lever this file can set changes that. What that
// would move is which paths git calls untracked, which decides a pending cap from
// a stale one; the three metrics themselves are line-ending and configuration
// insensitive.
let isolationDir = null;

function isolationHome() {
    if (isolationDir === null) isolationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-home-'));
    return isolationDir;
}

// The environment every git invocation this file makes runs under. The base is the
// runner's own child environment, hooks/kit-git-lib.js's exported gitChildEnv,
// rather than a hand-built copy of what that runner does: the strip of every GIT_*
// key, the terminal-prompt refusal and the bare-command-name defence are that
// channel's properties, and mirrored here they drift the day the runner gains a
// fourth. What is added on top is what a fixture needs and the runner has no
// opinion about: an identity, so a case's history does not depend on the operator's
// git identity, and the four keys that decide where git looks for configuration and
// for a global excludes file.
//
// One helper owns the whole redirect, including the three home keys, because the
// two spawn sites here are not alike in what they need and were not alike in what
// they got: suppressing global and system config does not reach the default
// excludes path, which git resolves from $XDG_CONFIG_HOME/git/ignore falling back
// to $HOME/.config/git/ignore, so a fixture build reading this machine's excludes
// file has `git add -A` silently drop an ignored path and `git add <paths>` exit 1
// on one. The runner strips every GIT_* key from the child it builds, so those
// three are what survives that strip and the only lever that reaches a spawned
// script's own git children.
//
// The two config files are named inside the isolation home at both call sites
// rather than inside the directory under measurement. The shared temp root is
// world-writable on POSIX, so a fixed name there is one another local user can
// pre-create; the isolation home is mkdtemp'd, which the fixture repository also
// is, and naming the files there keeps the safe property off what any one case
// happens to write into the tree it is measuring.
//
// `homeDir` is the case-owned override, for the one case whose subject is what an
// excludes file in that home does to a reading: it plants one, so it may not share
// the process-wide directory.
function gitEnv(homeDir) {
    const home = homeDir || isolationHome();
    const env = gitChildEnv();
    env.GIT_AUTHOR_NAME = 'kit fixture';
    env.GIT_AUTHOR_EMAIL = 'fixture@example.invalid';
    env.GIT_COMMITTER_NAME = 'kit fixture';
    env.GIT_COMMITTER_EMAIL = 'fixture@example.invalid';
    env.GIT_CONFIG_GLOBAL = path.join(home, 'absent.gitconfig');
    env.GIT_CONFIG_SYSTEM = path.join(home, 'absent.gitconfig');
    env.HOME = home;
    env.USERPROFILE = home;
    env.XDG_CONFIG_HOME = path.join(home, 'xdg');
    return env;
}

// This process's own environment takes the same redirect, because a third class of
// git invocation runs neither through gitTry nor through the spawned script: every
// in-process `kit.*` call runs git through hooks/kit-git-lib.js, which builds its
// child from process.env, and `untrackedPaths` is what decides a pending cap from a
// stale one. Left alone, those readings would answer about this machine's global
// excludes file while the spawned readings beside them answered about an empty home.
process.env.HOME = isolationHome();
process.env.USERPROFILE = process.env.HOME;
process.env.XDG_CONFIG_HOME = path.join(process.env.HOME, 'xdg');

// The environment the script under test runs under, which is the same one, since
// gitEnv owns the whole redirect.
function scriptEnv(homeDir) {
    return gitEnv(homeDir);
}

// The repository is named with `-C` and the spawn's working directory is this
// test directory, never the fixture: on Windows a bare command name resolves
// against the spawn's working directory before PATH, so a fixture-rooted spawn
// would run a `git.exe` sitting in the fixture. test/kit-git-lib.test.js pins
// that property of the platform rather than assuming it, and hooks/kit-git-lib.js
// is the runner built around it.
//
// The timeout is the property the shared runner would have given this call: a
// fixture git that wedges on a lock or a prompt would otherwise hang the whole
// gate with nothing to end it, and every call here is a local read or a local
// commit over a handful of files, so the bound sits far above any of them.
const FIXTURE_GIT_TIMEOUT_MS = 60000;

function gitTry(dir, args) {
    return spawnSync('git', ['-C', dir].concat(args), {
        cwd: __dirname,
        encoding: 'utf8',
        env: gitEnv(),
        timeout: FIXTURE_GIT_TIMEOUT_MS
    });
}

function git(dir, args) {
    const res = gitTry(dir, args);
    assert.strictEqual(res.status, 0, 'git ' + args.join(' ') + ': ' + (res.stderr || res.error));
    return res.stdout.trim();
}

function write(dir, relPath, text) {
    const full = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text, 'utf8');
}

function rmDir(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

// The fixture's own skill file, four words of body under a two-line
// frontmatter, named here because two cases write it: the one that plants a word
// over cap and the restore that follows it.
const ALPHA_SKILL = '---\nname: alpha\n---\n\nalpha body words here.\n';

// A repository shaped like this kit: one file under each measured root, and one
// test file, all committed. Built once per process, because the build is three git
// spawns and every case wants the same history; each case then gets its own copy
// to mutate, which is what a case actually needs.
let templateDir = null;

function fixtureTemplate() {
    if (templateDir !== null) return templateDir;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-template-'));
    git(dir, ['init', '-q', '.']);
    write(dir, 'plugins/claude-kit/skills/alpha/SKILL.md', ALPHA_SKILL);
    write(dir, 'plugins/claude-kit/skills/alpha/references/notes.md', 'notes for alpha.\n');
    write(dir, 'plugins/claude-kit/agents/reviewer.md', 'reviewer charter text.\n');
    write(dir, 'plugins/claude-kit/output-styles/kit.md', 'output style text.\n');
    write(dir, 'home/claude-kit-doctrine.md', 'doctrine text here.\n');
    write(dir, 'test/one.test.js', "test('a', () => {});\n    it('b', () => {});\n");
    write(dir, 'README.md', 'outside every measured root.\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'fixture']);
    templateDir = dir;
    return dir;
}

// A case's own copy of the template, history included: every path inside a git
// directory is relative to it, so a copied repository is a repository.
function makeFixtureRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-'));
    fs.cpSync(fixtureTemplate(), dir, { recursive: true });
    return dir;
}

// The same repository one level inside a directory of its own, for a case that has
// to plant a file beside the repository rather than in it. The parent is
// mkdtemp'd and the sibling goes inside that, because a fixed name directly in the
// system temp directory is one another local user can pre-create as a symlink on
// POSIX, and a plain write then follows the link and truncates whatever it points
// at. That is the rule this file's header states, applied here as well as to the
// fixture git configs.
function makeNestedFixtureRepo() {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-nested-'));
    const dir = path.join(parent, 'repo');
    fs.cpSync(fixtureTemplate(), dir, { recursive: true });
    return { parent, dir };
}

after(() => {
    if (templateDir !== null) rmDir(templateDir);
    if (isolationDir !== null) rmDir(isolationDir);
});

// The script under test, spawned. The repository is named in `args` by every
// caller that means to read one: there is no directory parameter here to imply
// otherwise, since a helper holding a directory it never passes on would let a
// call omitting --repo read this checkout, and an init call omitting it would try
// to write this repository's own budget.
//
// The environment is the isolated one and the timeout is the bound gitTry carries,
// for the same two reasons: the script's git children read a global configuration
// and a global excludes file unless HOME is pointed elsewhere, and an unbounded
// node spawn wedged on one of those children would hang the whole gate with
// nothing to end it. `homeDir` names a case-owned isolation directory, for a case
// that plants an excludes file and so cannot share the process-wide one.
function runScript(args, homeDir) {
    const res = spawnSync(process.execPath, [SCRIPT].concat(args), {
        cwd: os.tmpdir(),
        encoding: 'utf8',
        env: scriptEnv(homeDir),
        timeout: FIXTURE_GIT_TIMEOUT_MS
    });
    assert.strictEqual(res.error, undefined, 'kit-size.js did not run: ' + res.error);
    return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function reasonsFor(failures, relPath) {
    return failures.filter((f) => f.path === relPath).map((f) => f.reason);
}

// A word is a whitespace-separated token after the frontmatter is stripped, and
// a fenced block is content like any other: the prose bar is about what a reader
// pays for, and a worked example is paid for too.
test('a word count strips the frontmatter and counts fenced content', () => {
    const text = '---\nname: alpha\ndescription: "two words"\n---\n\nOne two three.\n\n```js\nconst a = 1;\n```\n';
    assert.strictEqual(kit.stripFrontmatter(text).trim(), 'One two three.\n\n```js\nconst a = 1;\n```'.trim());
    // Three prose words plus the fence lines: ``` , const, a, =, 1;, ```
    assert.strictEqual(kit.wordCount(text), 9);
});

// The control for the strip: a file with no frontmatter keeps its first line, so
// the strip cannot be silently eating content it was never meant to reach.
test('a file with no frontmatter keeps every word, and a later rule is not a frontmatter fence', () => {
    assert.strictEqual(kit.wordCount('One two three.\n'), 3);
    assert.strictEqual(kit.wordCount('# Title\n\n---\n\nafter the rule\n'), 6);
    assert.strictEqual(kit.wordCount(''), 0);
});

// The dangerous direction on a size gate is the silent under-count, and a file
// whose first line is a horizontal rule is the shape that produces one: the
// opening `---` looks like frontmatter and a later `---` looks like its close, so
// everything between them would leave the reading. What refuses it is the
// requirement that the block's FIRST line be a `key:` line, which is where the
// format puts a mapping key and where prose does not.
test('a file opening with a horizontal rule keeps the words a frontmatter strip would have eaten', () => {
    const rule = '---\n\nRule above.\n\n---\n\nBelow the rule.\n';
    assert.strictEqual(kit.stripFrontmatter(rule), rule, 'a block whose first line is not key-shaped is not frontmatter');
    // Every token in the file, the two rules included: nothing between them left
    // the reading. A strip that treated the first rule as frontmatter would
    // return 3, the count of the last line alone.
    assert.strictEqual(kit.wordCount(rule), 7);
    // Prose satisfies a "some line in the block is key-shaped" test, which is why
    // the test is on the first line: this document opens with a rule and carries an
    // ordinary labelled sentence, and every word of it stays in the reading.
    const prose = '---\n\nRule above.\n\nNote: this reads like a key and is a sentence.\n\n---\n\nBelow the rule.\n';
    assert.strictEqual(kit.stripFrontmatter(prose), prose);
    assert.strictEqual(kit.wordCount(prose), 17);
    // The control, withheld from that shape by one line: the same file with a
    // YAML key as the block's first line IS frontmatter, and the strip reaches it.
    // Without this half the assertions above would pass on a strip that had
    // stopped working altogether.
    const real = '---\ntitle: t\n---\n\nBelow the rule.\n';
    assert.strictEqual(kit.stripFrontmatter(real), '\nBelow the rule.\n');
    assert.strictEqual(kit.wordCount(real), 3);
    // A list item or a folded value below the first key is frontmatter the strip
    // still reaches, which is what keeps the test on the first line rather than on
    // every line.
    const listed = '---\nname: alpha\ntags:\n  - one\n  - two\n---\n\nBelow.\n';
    assert.strictEqual(kit.stripFrontmatter(listed), '\nBelow.\n');
});

test('a line count counts newline-terminated lines and any final unterminated one', () => {
    assert.strictEqual(kit.lineCount('a\nb\n'), 2);
    assert.strictEqual(kit.lineCount('a\nb'), 2);
    assert.strictEqual(kit.lineCount('a\r\nb\r\n'), 2);
    assert.strictEqual(kit.lineCount(''), 0);
});

// A test is a call site opening a line after nothing but spaces and tabs, so a
// nested case counts and an identifier merely ending in the name does not.
test('a test count reads line-opening test and it call sites, nested ones included', () => {
    const src = [
        "test('top', () => {});",
        'describe(\'group\', () => {',
        "    it('nested', () => {});",
        "\ttest('tabbed', () => {});",
        '});',
        "const x = test('not a call site at line start', 1);",
        "subtest('not this either', () => {});",
        "// test('commented out but still a line-opening call site is out of reach of a comment check', () => {});"
    ].join('\n');
    // The top-level call, the nested one, and the tab-indented one. The three
    // below them are a call in the middle of an expression, an identifier merely
    // ending in the name, and a commented-out call whose line opens with the
    // comment marker.
    assert.strictEqual(kit.testCount(src), 3);
});

// Each measured shape lands in its root's metric. The list is a parameter, so
// this case says what the classifier does with paths rather than what this
// checkout happens to hold.
test('the classifier gives each measured shape its root metric', () => {
    const { entries, unclassified, excluded } = kit.classify([
        'plugins/claude-kit/skills/alpha/SKILL.md',
        'plugins/claude-kit/skills/alpha/references/notes.md',
        'plugins/claude-kit/agents/reviewer.md',
        'plugins/claude-kit/output-styles/kit.md',
        'home/claude-kit-doctrine.md',
        // Every markdown file directly under home/ is measured, not the doctrine
        // copy alone: home/ carries what lands in the user's home directory, and a
        // root naming one file is a root the coverage control cannot police, since
        // a sibling beside that file would sit under no root at all and reach no
        // reading.
        'home/CLAUDE.md',
        // test/probes/ sits ahead of test/ in ROOTS because classify takes the
        // first root that holds a path and test/probes/ nests under test/ on
        // disk; the frozen probe scenarios are curated prose measured in words,
        // not the line-counted test code the root beneath them holds.
        'test/probes/scenario.md',
        'test/one.test.js',
        'test/size-budget.json',
        'README.md',
        'docs/plans/whatever.md'
    ]);
    assert.deepStrictEqual(entries.map((e) => e.metric), ['words', 'words', 'words', 'words', 'words', 'words', 'words', 'lines']);
    assert.deepStrictEqual(unclassified, []);
    assert.deepStrictEqual(excluded, ['test/size-budget.json']);
    // A path outside every measured root is not this tool's subject, so it is
    // neither measured nor a failure.
    assert.ok(!entries.some((e) => e.path === 'README.md'));
});

// The coverage control, driven on shape. None of these paths is spelled by any
// pattern in the script: each is a file shaped like something a future edit
// might add under a measured root, and each must land unclassified rather than
// being quietly skipped.
test('a tracked file under a measured root that matches no shape lands unclassified', () => {
    const withheld = [
        'plugins/claude-kit/skills/alpha/references/deep/nested.md',
        'plugins/claude-kit/skills/alpha/CHANGELOG.md',
        'plugins/claude-kit/skills/loose.md',
        'plugins/claude-kit/agents/shared/common.md',
        'plugins/claude-kit/output-styles/notes.txt',
        // Under the home/ root too, where the shape is a markdown file directly
        // inside it: a nested file and a non-markdown one are both held by the root
        // and measured by nothing, which is the state that must red.
        'home/nested/deep.md',
        'home/settings.json',
        // Under test/probes/ too, where the shape is a markdown file directly
        // inside it: a nested file and a non-markdown one are both held by the
        // root and measured by nothing, which is the state that must red.
        'test/probes/nested/deep.md',
        'test/probes/notes.txt',
        'test/helpers/fixture-builder.js',
        'test/one.js'
    ];
    const { entries, unclassified } = kit.classify(withheld);
    assert.deepStrictEqual(entries, []);
    assert.deepStrictEqual(unclassified, withheld);
    const failures = kit.evaluate([], {}, unclassified);
    assert.deepStrictEqual(failures.map((f) => f.reason), withheld.map(() => kit.REASONS.UNCLASSIFIED));
    assert.deepStrictEqual(failures.map((f) => f.path), withheld);
});

// The probe root's coverage contract on its own, isolated from every other root:
// a shaped path lands as one words entry with nothing left over.
test('a test/probes/ markdown path classifies as one words entry with nothing unclassified', () => {
    const { entries, unclassified } = kit.classify(['test/probes/x.md']);
    assert.deepStrictEqual(entries, [{ path: 'test/probes/x.md', metric: 'words' }]);
    assert.deepStrictEqual(unclassified, []);
});

// The mirror: a non-markdown file under test/probes/ is held by the root and
// measured by no shape, so it reds as unclassified rather than being skipped as
// though it sat under no root at all.
test('a test/probes/ path that is not markdown lands unclassified', () => {
    const { entries, unclassified } = kit.classify(['test/probes/x.txt']);
    assert.deepStrictEqual(entries, []);
    assert.deepStrictEqual(unclassified, ['test/probes/x.txt']);
});

// A root prefix spelled in another case is still under the root, so the
// classifier lands it unclassified rather than skipping it as though it sat under
// no measured root at all. This case's subject is the classifier over a list, and
// the list is what makes it a claim about the classifier alone: git's pathspec
// matching is case-sensitive, so the tracked-path listing never hands the
// classifier such a path. The end-to-end reading of a case-variant path is the
// pathspec cross-check's, driven against a real index below. None of these
// spellings appears in any pattern in the script: each is matched on the shape of
// a case-variant prefix.
test('the classifier lands a path under a differently-cased root prefix unclassified rather than skipping it', () => {
    const withheld = [
        'Plugins/claude-kit/skills/alpha/SKILL.md',
        'plugins/Claude-Kit/agents/reviewer.md',
        'TEST/one.test.js'
    ];
    const { entries, unclassified } = kit.classify(withheld);
    assert.deepStrictEqual(entries, []);
    assert.deepStrictEqual(unclassified, withheld);
    // The control on the other side of the fold: rootHolds is what admits them,
    // and it admits the exact spelling too, so the case above is not passing
    // because the root test has stopped working.
    assert.ok(kit.rootHolds('test/', 'TEST/one.test.js'));
    assert.ok(kit.rootHolds('test/', 'test/one.test.js'));
    assert.ok(!kit.rootHolds('test/', 'docs/one.test.js'));
});

// A pending cap suppresses the stale-entry mirror for its key, so what may count
// as pending is narrow by design: git's own untracked list, and a shape the
// classifier would measure. Each key below satisfies neither and so stays stale.
// None is a path git prints: a directory, a traversal, a backslash spelling that
// a Windows filesystem answers to while git emits forward slashes, and the
// gitignored built doctrine copy, which sits under no measured root.
test('a budget key git does not report as an untracked measured file is stale, not pending', () => {
    const measured = [{ path: 'test/one.test.js', metric: 'lines', size: 10, tests: 1 }];
    const budget = {
        'test/one.test.js': 120,
        test: 40,
        '../claude-kit/README.md': 40,
        'test\\size-ratchet.test.js': 40,
        'plugins/claude-kit/claude-kit-doctrine.md': 40,
        'test/helpers/fixture-builder.js': 40,
        'test/genuinely-new.test.js': 40
    };
    // What git reports as untracked here: the last two keys and nothing else. The
    // helpers path is untracked and present, and still not pending, because no
    // shape would measure it once tracked, so its cap is stale now rather than
    // waiting on an add.
    const untracked = ['test/helpers/fixture-builder.js', 'test/genuinely-new.test.js'];
    assert.deepStrictEqual(kit.pendingEntries(budget, measured, untracked), ['test/genuinely-new.test.js']);
    const failures = kit.evaluate(measured, budget, [], kit.pendingEntries(budget, measured, untracked));
    assert.deepStrictEqual(failures.map((f) => f.reason + ' ' + f.path).sort(), [
        'stale-entry ../claude-kit/README.md',
        'stale-entry plugins/claude-kit/claude-kit-doctrine.md',
        'stale-entry test',
        'stale-entry test/helpers/fixture-builder.js',
        'stale-entry test\\size-ratchet.test.js'
    ]);
});

// The green half of the ratchet, and the control for every red below: a corpus
// exactly at its caps, with nothing unclassified and no cap left over, produces
// no failures at all.
test('the ratchet greens at cap', () => {
    const measured = [
        { path: 'plugins/claude-kit/skills/alpha/SKILL.md', metric: 'words', size: 400, tests: null },
        { path: 'test/one.test.js', metric: 'lines', size: 120, tests: 7 }
    ];
    const budget = { 'plugins/claude-kit/skills/alpha/SKILL.md': 400, 'test/one.test.js': 120 };
    assert.deepStrictEqual(kit.evaluate(measured, budget, []), []);
});

test('the ratchet reds on one word over cap, naming over-cap and the file', () => {
    const measured = [{ path: 'plugins/claude-kit/skills/alpha/SKILL.md', metric: 'words', size: 401, tests: null }];
    const budget = { 'plugins/claude-kit/skills/alpha/SKILL.md': 400 };
    const failures = kit.evaluate(measured, budget, []);
    assert.strictEqual(failures.length, 1);
    assert.strictEqual(failures[0].reason, kit.REASONS.OVER_CAP);
    assert.strictEqual(failures[0].path, 'plugins/claude-kit/skills/alpha/SKILL.md');
    assert.match(failures[0].detail, /401 words against a cap of 400/);
    // One line under cap is not a red: the ratchet holds the ceiling and never
    // pins the size, since the audits lower caps by cutting.
    assert.deepStrictEqual(kit.evaluate([{ path: 'test/one.test.js', metric: 'lines', size: 119, tests: 3 }], { 'test/one.test.js': 120 }, []), []);
});

// Sizes are read from worktree content, so a red can belong to an uncommitted
// edit any session on a shared checkout made, on a file the reader never touched.
// The failure text is where that gets attributed: it says the reading came from
// the worktree and says whether the path differs from HEAD, so a session seeing a
// red outside its own diff diagnoses it in one read rather than by re-deriving
// where the number came from.
test('an over-cap failure attributes the reading to worktree content and to the HEAD comparison', () => {
    const measured = [{ path: 'plugins/claude-kit/skills/alpha/SKILL.md', metric: 'words', size: 401, tests: null }];
    const budget = { 'plugins/claude-kit/skills/alpha/SKILL.md': 400 };
    // The comparison is asserted as the field it is, so the sentence beside it
    // stays free to improve. What the sentence owes is the attribution token, and
    // that is what is pinned of it.
    const differs = kit.evaluate(measured, budget, [], [], new Set(['plugins/claude-kit/skills/alpha/SKILL.md']));
    assert.strictEqual(differs[0].headComparison, 'differs');
    assert.match(differs[0].detail, /read from worktree content/);
    const matches = kit.evaluate(measured, budget, [], [], new Set(['test/other.test.js']));
    assert.strictEqual(matches[0].headComparison, 'matches');
    // No comparison taken is its own answer rather than a claim either way: a
    // caller that could not ask git must not have the failure imply it did.
    const unknown = kit.evaluate(measured, budget, [], []);
    assert.strictEqual(unknown[0].headComparison, 'not-taken');
    // Each of the three values is distinct, so a reader of the field can tell
    // them apart without reading any sentence.
    assert.strictEqual(new Set([differs[0].headComparison, matches[0].headComparison, unknown[0].headComparison]).size, 3);
});

// Both halves of the same defect in one reading: a measured file with no cap, and
// a cap with no measured file. The stale half needs no case of its own, since this
// assertion and the pending case below already fail on it from both directions.
test('a measured file with no budget entry reds as missing-entry, and the cap with no file reds as stale', () => {
    const measured = [{ path: 'test/two.test.js', metric: 'lines', size: 10, tests: 1 }];
    const failures = kit.evaluate(measured, { 'test/one.test.js': 120 }, []);
    assert.deepStrictEqual(reasonsFor(failures, 'test/two.test.js'), [kit.REASONS.MISSING_ENTRY]);
    assert.deepStrictEqual(reasonsFor(failures, 'test/one.test.js'), [kit.REASONS.STALE_ENTRY]);
    assert.strictEqual(failures.length, 2);
});

// The state between a missing entry and a stale one: a cap written beside a file
// git reports as untracked, which is how a new test file and its cap ride in one
// changeset. It is reported rather than failed, and the suppression reaches that
// key alone.
test('a cap whose file is untracked is pending, while a cap for an absent file stays stale', () => {
    const measured = [{ path: 'test/one.test.js', metric: 'lines', size: 10, tests: 1 }];
    const budget = { 'test/one.test.js': 120, 'test/new.test.js': 40, 'test/deleted.test.js': 90 };
    const failures = kit.evaluate(measured, budget, [], ['test/new.test.js']);
    assert.deepStrictEqual(failures.map((f) => f.reason), [kit.REASONS.STALE_ENTRY]);
    assert.strictEqual(failures[0].path, 'test/deleted.test.js');
    // Without the pending list both caps are stale, which is the control: the
    // suppression is what the pending list does and not something evaluate does
    // for every unmeasured key.
    assert.deepStrictEqual(kit.evaluate(measured, budget, []).map((f) => f.path), ['test/new.test.js', 'test/deleted.test.js']);
});

test('a cap that is not a number and a file the worktree does not hold each red on their own reason', () => {
    const budget = { 'test/one.test.js': 'lots' };
    const failures = kit.evaluate([{ path: 'test/one.test.js', metric: 'lines', size: 10, tests: 1 }], budget, []);
    assert.deepStrictEqual(failures.map((f) => f.reason), [kit.REASONS.INVALID_CAP]);
    // A tracked file the worktree cannot produce is unreadable, never a zero: a
    // zero passes every cap and reads as a file that shrank to nothing.
    const missing = kit.measure({ path: 'test/one.test.js', metric: 'lines' }, null);
    assert.strictEqual(missing.size, null);
    assert.deepStrictEqual(kit.evaluate([missing], { 'test/one.test.js': 120 }, []).map((f) => f.reason), [kit.REASONS.UNREADABLE]);
});

// The budget is data the gate cannot do without, so its absence is loud. An
// empty budget would pass every file, which is the one failure mode a size gate
// must not have. Each refusal below names its own rule, since a caller that only
// knows the load failed cannot tell a missing budget from a corrupt one.
test('an absent, malformed, oversized or duplicate-keyed budget throws rather than reading as an empty budget', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-budget-'));
    try {
        // Refused by the existence check, which runs before containment so the
        // commonest state, a project with no budget yet, reports as the missing
        // file it is rather than sending its reader after a symlink nobody
        // planted.
        assert.throws(() => kit.loadBudget(path.join(dir, 'absent.json')), /no size budget exists at/);
        assert.throws(() => kit.loadBudget(path.join(dir, 'absent.json'), dir), /no size budget exists at/);
        // The control on that order, withheld from the absent case by existing: a
        // path that is there and still yields no content is unreadable rather than
        // missing, which is the bounded reader's own refusal and a different
        // sentence.
        fs.mkdirSync(path.join(dir, 'directory.json'), { recursive: true });
        assert.throws(() => kit.loadBudget(path.join(dir, 'directory.json')), /unreadable/);
        // Refused by the JSON parse.
        fs.writeFileSync(path.join(dir, 'bad.json'), '{not json', 'utf8');
        assert.throws(() => kit.loadBudget(path.join(dir, 'bad.json')), /not valid JSON/);
        // Refused by the shape check: a budget is an object of path to cap.
        fs.writeFileSync(path.join(dir, 'array.json'), '[]', 'utf8');
        assert.throws(() => kit.loadBudget(path.join(dir, 'array.json')), /not an object/);
        // Refused by the empty-key check, on the same sentence absence takes: a
        // budget parsing to no caps at all reds every measured file on its own
        // missing entry, at the exit code reserved for a ratchet failure, where the
        // one fault is the data.
        fs.writeFileSync(path.join(dir, 'empty.json'), '{}\n', 'utf8');
        assert.throws(() => kit.loadBudget(path.join(dir, 'empty.json')), /holds no cap at all/);
        // The control, withheld from the empty object by one entry: a budget holding
        // one cap loads, so the refusal above is the empty key set speaking rather
        // than the check refusing every object.
        fs.writeFileSync(path.join(dir, 'single.json'), '{"test/one.test.js": 4}\n', 'utf8');
        assert.deepStrictEqual(kit.loadBudget(path.join(dir, 'single.json')), { 'test/one.test.js': 4 });
        // Refused by the byte ceiling. A budget read short would parse as a
        // shorter set of caps at best, and every cap it lost passes silently.
        fs.writeFileSync(path.join(dir, 'huge.json'), '{"a": 1, "_pad": "' + 'x'.repeat(kit.MAX_BUDGET_BYTES) + '"}\n', 'utf8');
        assert.throws(() => kit.loadBudget(path.join(dir, 'huge.json')), /past the .* ceiling/);
        // Refused by the duplicate-key scan. JSON.parse keeps the last value
        // silently, so the file a reviewer reads and the caps the gate uses
        // disagree while both parse and the gate greens.
        fs.writeFileSync(path.join(dir, 'twice.json'), '{\n    "test/one.test.js": 10,\n    "test/one.test.js": 9000\n}\n', 'utf8');
        assert.throws(() => kit.loadBudget(path.join(dir, 'twice.json')), /lists a path more than once/);
        // The control on that scan, withheld by one character: the same two keys
        // spelled differently are two entries and load normally, so the refusal
        // above is the repeat speaking rather than the scan refusing every budget.
        fs.writeFileSync(path.join(dir, 'once.json'), '{\n    "test/one.test.js": 10,\n    "test/two.test.js": 9000\n}\n', 'utf8');
        assert.deepStrictEqual(kit.loadBudget(path.join(dir, 'once.json')), { 'test/one.test.js': 10, 'test/two.test.js': 9000 });
        // Refused by the containment check, which binds only when a root is given:
        // the default budget path sits inside the repository under measurement, so a
        // path resolving outside it would source every cap in the gate from a file
        // that appeared in no diff. A path the operator named takes no root and is
        // allowed to sit anywhere, which is the same call one line down.
        fs.mkdirSync(path.join(dir, 'inner'), { recursive: true });
        assert.throws(() => kit.loadBudget(path.join(dir, 'once.json'), path.join(dir, 'inner')), /does not resolve inside/);
        assert.deepStrictEqual(Object.keys(kit.loadBudget(path.join(dir, 'once.json'), dir)), ['test/one.test.js', 'test/two.test.js']);
    } finally {
        rmDir(dir);
    }
});

// The containment on the default budget path, which is the path the CLI reads
// when no --budget is given and the one the gate itself reads. A budget reached
// through a link out of the checkout sources every cap in the gate from a file
// that appeared in no diff, so it is refused on both sides, the read and the
// write. The link is planted on the directory rather than on the budget file,
// because a directory junction needs no privilege on win32 while a file symlink
// does.
test('a default-path budget reached through a link out of the checkout is refused by both the read and the write', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-link-'));
    try {
        const repo = path.join(dir, 'repo');
        const outside = path.join(dir, 'outside');
        fs.mkdirSync(repo, { recursive: true });
        fs.mkdirSync(outside, { recursive: true });
        fs.writeFileSync(path.join(outside, 'size-budget.json'), kit.serializeBudget({ 'test/one.test.js': 40 }), 'utf8');
        fs.symlinkSync(outside, path.join(repo, 'test'), 'junction');
        const linked = path.join(repo, 'test', 'size-budget.json');
        assert.ok(fs.existsSync(linked), 'the linked path reaches the budget file, so the refusal below is containment and not absence');
        assert.throws(() => kit.loadBudget(linked, repo), /does not resolve inside/);
        const refusedInit = kit.initBudget(repo, linked, repo);
        assert.strictEqual(refusedInit.status, 'refused');
        assert.match(refusedInit.detail, /does not resolve inside/);

        // The control, withheld from the link by one indirection: the same bytes
        // at a real path in the same shape inside the repository are read, and
        // the write side gets past containment to its own next refusal. Without
        // this half both assertions above would pass on a check that refused
        // every default-path budget.
        const plain = path.join(dir, 'plain');
        fs.mkdirSync(path.join(plain, 'test'), { recursive: true });
        const real = path.join(plain, 'test', 'size-budget.json');
        fs.writeFileSync(real, kit.serializeBudget({ 'test/one.test.js': 40 }), 'utf8');
        assert.deepStrictEqual(kit.loadBudget(real, plain), { 'test/one.test.js': 40 });
        assert.match(kit.initBudget(plain, real, plain).detail, /a budget already exists/);
    } finally {
        rmDir(dir);
    }
});

// The duplicate scan reads keys from the text, since the parsed object cannot
// carry a repeat at all.
test('the budget key scan reads every key the text spells, repeats included', () => {
    assert.deepStrictEqual(kit.budgetKeysInText('{\n    "a": 1,\n    "b": 2,\n    "a": 3\n}\n'), ['a', 'b', 'a']);
    // An escaped character in a key survives the scan as the character it means,
    // so a repeat spelled two ways is still one key.
    assert.deepStrictEqual(kit.budgetKeysInText('{"a\\u002fb": 1, "a/b": 2}'), ['a/b', 'a/b']);
});

test('totals are per metric class, each against the sum of its own caps', () => {
    const measured = [
        { path: 'a/SKILL.md', metric: 'words', size: 100, tests: null },
        { path: 'b/SKILL.md', metric: 'words', size: 50, tests: null },
        { path: 'test/one.test.js', metric: 'lines', size: 200, tests: 9 },
        { path: 'test/two.test.js', metric: 'lines', size: 300, tests: 11 }
    ];
    const sums = kit.totals(measured, { 'a/SKILL.md': 120, 'b/SKILL.md': 50, 'test/one.test.js': 200, 'test/two.test.js': 400 });
    assert.deepStrictEqual(sums.words, { size: 150, cap: 170, files: 2, unreadable: 0 });
    assert.deepStrictEqual(sums.lines, { size: 500, cap: 600, files: 2, unreadable: 0 });
    assert.strictEqual(sums.tests, 20);
    // An unreadable file counts as a file and contributes no size while its cap
    // still stands in the cap total, so the count travels with the sums: without it
    // the totals read as a cut of exactly that file's cap.
    const withUnreadable = kit.totals(measured.concat([{ path: 'c/SKILL.md', metric: 'words', size: null, tests: null }]),
        { 'a/SKILL.md': 120, 'b/SKILL.md': 50, 'c/SKILL.md': 900, 'test/one.test.js': 200, 'test/two.test.js': 400 });
    assert.deepStrictEqual(withUnreadable.words, { size: 150, cap: 1070, files: 3, unreadable: 1 });
});

// The rendered text's shape is settled by its rows, which is why a clean tree yields
// the totals block by itself: a clean tree produces no rows. The subject line the
// verb prints above that block is main's rather than this function's, so it is not in
// the lines counted here.
test('the rendered report is the totals block alone when nothing changed, and one line per changed file otherwise', () => {
    const sums = { words: { size: 150, cap: 170, files: 2, unreadable: 0 }, lines: { size: 500, cap: 600, files: 2, unreadable: 0 }, tests: 20 };
    const bare = kit.renderReport([], sums, {});
    assert.deepStrictEqual(bare, [
        'words: 150 of cap 170 across 2 curated files',
        'test lines: 500 of cap 600 across 2 test files',
        'tests: 20'
    ]);
    const rows = [
        { path: 'a/SKILL.md', metric: 'words', size: 120, tests: null, headState: 'changed', headSize: 100, headTests: null },
        { path: 'test/one.test.js', metric: 'lines', size: 190, tests: 8, headState: 'changed', headSize: 200, headTests: 9 }
    ];
    const printed = kit.renderReport(rows, sums, { 'a/SKILL.md': 120, 'test/one.test.js': 200 });
    // The row's discriminating content is its path, its size and metric, its cap
    // and its signed delta, and those are what is pinned; the prose joining them is
    // free to improve.
    assert.match(printed[0], /^a\/SKILL\.md: 120 words.*cap 120.*\+20$/);
    assert.match(printed[1], /^test\/one\.test\.js: 190 lines.*cap 200.*-10.*tests 8.*-1$/);
    assert.strictEqual(printed.length, 5);
});

// A row with no size is its own state rather than a number. Rendered as one, the
// signed delta coerces the missing size to zero and prints the file's whole cap as
// a cut, at exit 0, into the output a Chapter quotes: the one direction a size
// reading must never fabricate. The states that produce it are ordinary, a tracked
// measured file gone from the worktree, one past the read ceiling, one resolving
// out of the checkout.
test('a tracked row with no size renders as unreadable with no delta, and the totals say so', () => {
    const sums = { words: { size: 0, cap: 10733, files: 1, unreadable: 1 }, lines: { size: 5, cap: 5, files: 1, unreadable: 0 }, tests: 1 };
    const printed = kit.renderReport([
        { path: 'home/claude-kit-doctrine.md', metric: 'words', size: null, tests: null, headState: 'changed', headSize: 10733, headTests: null }
    ], sums, { 'home/claude-kit-doctrine.md': 10733 });
    assert.match(printed[0], /^home\/claude-kit-doctrine\.md: worktree content unreadable/);
    assert.match(printed[0], /cap 10733/);
    // No signed number anywhere on the row, which is the whole point: neither the
    // fabricated cut nor a zero that reads as no change.
    assert.ok(!/[-+]\d/.test(printed[0]), 'the row carries no delta at all: ' + printed[0]);
    assert.match(printed[1], /^words: 0 of cap 10733 across 1 curated files.*1 of them unreadable/);
    // The control, withheld from the null by one field: the same row with a size
    // renders its delta, so the case above is the null state speaking rather than
    // the renderer having lost the delta.
    const withSize = kit.renderReport([
        { path: 'home/claude-kit-doctrine.md', metric: 'words', size: 10000, tests: null, headState: 'changed', headSize: 10733, headTests: null }
    ], sums, { 'home/claude-kit-doctrine.md': 10733 });
    assert.match(withSize[0], /-733$/);
});

// A changed file the classifier does not reach is named rather than dropped, on
// the same reasoning the code already applies to an unreadable HEAD blob: a
// dropped row reads exactly like a file that did not change, so a reader of the
// quoted report cannot tell an unmeasured changed file from an unchanged one.
test('the report names a changed file no measured shape reaches', () => {
    const sums = { words: { size: 0, cap: 0, files: 0, unreadable: 0 }, lines: { size: 5, cap: 5, files: 1, unreadable: 0 }, tests: 1 };
    const printed = kit.renderReport([
        { path: 'test/helpers/fixture-builder.js', metric: null, size: null, tests: null, headState: 'unmeasured', headSize: null, headTests: null }
    ], sums, {});
    assert.match(printed[0], /^test\/helpers\/fixture-builder\.js: changed.*matched by no measured shape/);
});

// A HEAD blob past the git runner's output ceiling is named rather than dropped,
// because an omitted file reads exactly like a file that did not change.
test('the report names a file whose HEAD size could not be read, and a file new since HEAD', () => {
    const sums = { words: { size: 0, cap: 0, files: 0, unreadable: 0 }, lines: { size: 5, cap: 5, files: 1, unreadable: 0 }, tests: 1 };
    const printed = kit.renderReport([
        { path: 'test/huge.test.js', metric: 'lines', size: 30000, tests: 700, headState: 'head-unreadable', headSize: null, headTests: null },
        { path: 'test/new.test.js', metric: 'lines', size: 12, tests: 2, headState: 'new', headSize: null, headTests: null }
    ], sums, { 'test/huge.test.js': 30000 });
    assert.match(printed[0], /^test\/huge\.test\.js: 30000 lines, cap 30000, HEAD size unreadable/);
    assert.match(printed[1], /^test\/new\.test\.js: 12 lines, no cap, new since HEAD$/);
});

// A git call that did not run at all is not a file that is new. Collapsed into
// 'new', a spawn error or a timeout kill would print a long-standing file's whole
// size as this section's growth, at exit 0, into the output a Chapter quotes.
test('a file whose HEAD state git could not answer for renders as unknown rather than as new', () => {
    const sums = { words: { size: 0, cap: 0, files: 0, unreadable: 0 }, lines: { size: 5, cap: 5, files: 1, unreadable: 0 }, tests: 1 };
    const printed = kit.renderReport([
        { path: 'test/one.test.js', metric: 'lines', size: 12, tests: 2, headState: 'head-unknown', headSize: null, headTests: null }
    ], sums, { 'test/one.test.js': 20 });
    assert.match(printed[0], /^test\/one\.test\.js: 12 lines.*cap 20.*HEAD state unknown/);
    assert.ok(!/[-+]\d/.test(printed[0]), 'a row whose HEAD state git could not answer for carries no delta: ' + printed[0]);
    // The control, withheld from that state by one field: the same row in the
    // 'new' state still reads as new, so the case above is not passing because
    // the renderer lost the new state altogether.
    const asNew = kit.renderReport([
        { path: 'test/one.test.js', metric: 'lines', size: 12, tests: 2, headState: 'new', headSize: null, headTests: null }
    ], sums, { 'test/one.test.js': 20 });
    assert.match(asNew[0], /new since HEAD$/);
});

// The totals are built from the classified corpus, which holds no untracked file,
// so the report names every untracked file under a measured root beside them, cap
// or no cap. Without this a Chapter quoting the report understates its own section
// by a whole file, and the uncapped case is the common one: a file a section adds
// is untracked and uncapped at exactly the moment the Chapter is written.
test('the report prints every untracked file under a measured root and names them beside the totals', () => {
    const sums = { words: { size: 10, cap: 10, files: 1, unreadable: 0 }, lines: { size: 5, cap: 5, files: 1, unreadable: 0 }, tests: 1 };
    const printed = kit.renderReport([], sums, { 'test/new.test.js': 40 }, [
        { path: 'test/new.test.js', metric: 'lines', size: 37, tests: 4 },
        { path: 'test/fresh.test.js', metric: 'lines', size: 12, tests: 2 },
        { path: 'test/helpers/fixture-builder.js', metric: null, size: null, tests: null }
    ]);
    assert.match(printed[0], /^test\/new\.test\.js: 37 lines.*cap 40.*untracked.*tests 4$/);
    // The uncapped one is named too, which is the half a cap-keyed report leaves
    // invisible.
    assert.match(printed[1], /^test\/fresh\.test\.js: 12 lines.*no cap.*untracked/);
    assert.match(printed[2], /^test\/helpers\/fixture-builder\.js: untracked.*matched by no measured shape/);
    assert.match(printed[6], /^excluded from those totals, untracked under a measured root: test\/new\.test\.js, test\/fresh\.test\.js, test\/helpers\/fixture-builder\.js$/);
    // With nothing untracked the report is exactly what it was: no row, and no
    // trailing line to read as an empty exclusion set.
    assert.strictEqual(kit.renderReport([], sums, {}, []).length, 3);
});

test('the budget serializes CRLF, matching every other file in this checkout, and reparses', () => {
    const text = kit.serializeBudget({ 'b.md': 2, 'a.md': 1 });
    // The control for that predicate, run first: the same JSON with lone-LF
    // endings, matched on the shape of a bare newline rather than on any string
    // the assertion below was handed, so an empty result over the real output is
    // the predicate working rather than a pattern that matches nothing at all.
    assert.ok(/[^\r]\n/.test(JSON.stringify({ 'b.md': 2 }, null, 4) + '\n'),
        'the bare-newline predicate speaks against LF content');
    assert.ok(!/[^\r]\n/.test(text), 'every newline is preceded by a carriage return');
    assert.deepStrictEqual(JSON.parse(text), { 'b.md': 2, 'a.md': 1 });
    assert.deepStrictEqual(Object.keys(kit.budgetFrom([
        { path: 'b.md', metric: 'words', size: 2, tests: null },
        { path: 'a.md', metric: 'words', size: 1, tests: null }
    ])), ['a.md', 'b.md']);
});

// The end-to-end path, over git rather than over an injected list: the same four
// failure reasons driven by a real tracked tree, each against a repository that
// greens before the defect is planted.
test('over a real repository the ratchet greens at its caps and reds on each planted defect', () => {
    const dir = makeFixtureRepo();
    try {
        const init = runScript(['init', '--repo', dir]);
        assert.strictEqual(init.status, 0, init.stderr);
        assert.match(init.stdout, /wrote 6 caps/);

        const clean = runScript(['check', '--repo', dir]);
        assert.strictEqual(clean.status, 0, clean.stdout + clean.stderr);

        // init refuses an existing budget: a re-init would raise every cap to
        // whatever the tree holds, which is the opposite of a ratchet.
        const again = runScript(['init', '--repo', dir]);
        assert.strictEqual(again.status, 2);
        assert.match(again.stderr, /a budget already exists/);

        // One word over cap.
        write(dir, 'plugins/claude-kit/skills/alpha/SKILL.md', '---\nname: alpha\n---\n\nalpha body words here more.\n');
        const over = runScript(['check', '--repo', dir]);
        assert.strictEqual(over.status, 1);
        assert.match(over.stdout, /^over-cap: plugins\/claude-kit\/skills\/alpha\/SKILL\.md: 5 words against a cap of 4/m);
        // The HEAD attribution is read as the field it is rather than as the
        // sentence it also prints: the same reading in process, where the failure
        // itself is in reach.
        const overFailures = kit.check(dir, path.join(dir, 'test', 'size-budget.json')).failures
            .filter((f) => f.path === 'plugins/claude-kit/skills/alpha/SKILL.md');
        assert.deepStrictEqual(overFailures.map((f) => f.reason), [kit.REASONS.OVER_CAP]);
        assert.strictEqual(overFailures[0].headComparison, 'differs');
        assert.strictEqual(overFailures[0].size, 5);
        assert.strictEqual(overFailures[0].cap, 4);
        write(dir, 'plugins/claude-kit/skills/alpha/SKILL.md', ALPHA_SKILL);
        assert.strictEqual(runScript(['check', '--repo', dir]).status, 0);

        // A new tracked test file with no cap.
        write(dir, 'test/two.test.js', "test('c', () => {});\n");
        git(dir, ['add', 'test/two.test.js']);
        const missing = runScript(['check', '--repo', dir]);
        assert.strictEqual(missing.status, 1);
        // The sentence names the budget the run actually read rather than the
        // default path, so a call given --budget sends its reader to the file whose
        // caps decided the verdict. It names it repo-relative where it resolves
        // inside the repository, because this line is quoted into a tracked plan doc
        // and an absolute checkout path carries the operator's user name into it.
        assert.match(missing.stdout, /^missing-entry: test\/two\.test\.js: no cap in test\/size-budget\.json/m);
        // No line but the subject line carries the checkout path, which is that line's
        // whole job: the reading names the repository it measured once, at the top, and
        // every path under that repository is spelled relative to it from there on.
        const missingRows = missing.stdout.split(/\r?\n/).filter((l) => l !== '' && !/^repository: /.test(l));
        assert.ok(missingRows.length > 0, missing.stdout);
        assert.ok(!missingRows.some((l) => l.includes(dir)), 'no row carries an absolute checkout path: ' + missing.stdout);
        // The control on that spelling, withheld from the relative form by sitting
        // outside the repository: a budget an operator names elsewhere has no
        // relative spelling that means anything, so it stays as it was given and the
        // sentence is still true about the file whose caps decided the verdict.
        // The file goes inside a directory of its own rather than straight into the
        // shared temp root: a derived name there is world-listable on POSIX from the
        // moment it exists, so another local user can pre-create it as a symlink and
        // the plain write below follows the link. That is the rule this file's header
        // states, applied here as it is at the two hardened sites.
        const elsewhereDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-outside-'));
        const elsewhere = path.join(elsewhereDir, 'size-budget.json');
        fs.writeFileSync(elsewhere, kit.serializeBudget({ 'test/one.test.js': 2 }), 'utf8');
        try {
            const named = runScript(['check', '--repo', dir, '--budget', elsewhere]);
            assert.strictEqual(named.status, 1, named.stdout + named.stderr);
            assert.ok(named.stdout.includes('no cap in ' + elsewhere.replace(/[^\x20-\x7E]/g, '')),
                'a budget outside the repository is named as it was given: ' + named.stdout);
        } finally {
            rmDir(elsewhereDir);
        }
        git(dir, ['rm', '-q', '-f', 'test/two.test.js']);

        // A tracked file under a measured root that no shape reaches. This is the
        // expensive failure's control on the real path: the classifier was never
        // told about a helpers directory, and the file is caught on its shape.
        write(dir, 'test/helpers/fixture-builder.js', 'module.exports = {};\n');
        git(dir, ['add', 'test/helpers/fixture-builder.js']);
        const blind = runScript(['check', '--repo', dir]);
        assert.strictEqual(blind.status, 1);
        assert.match(blind.stdout, /^unclassified: test\/helpers\/fixture-builder\.js: tracked under a measured root/m);
        git(dir, ['rm', '-q', '-f', 'test/helpers/fixture-builder.js']);

        // A cap for a file that no longer exists.
        git(dir, ['rm', '-q', '-f', 'plugins/claude-kit/agents/reviewer.md']);
        const stale = runScript(['check', '--repo', dir]);
        assert.strictEqual(stale.status, 1);
        assert.match(stale.stdout, /^stale-entry: plugins\/claude-kit\/agents\/reviewer\.md: a cap for a file/m);
    } finally {
        rmDir(dir);
    }
});

test('over a real repository the report prints totals only on a clean tree and a delta line after an edit', () => {
    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        const clean = runScript(['report', '--repo', dir]);
        assert.strictEqual(clean.status, 0, clean.stderr);
        const cleanLines = clean.stdout.split(/\r?\n/).filter((l) => l !== '');
        // The subject line, then totals only, which is what a clean tree means here: no
        // row, and the scope line saying nothing changed outside the measured roots
        // either. The subject is the repository the reading was taken against, so a
        // reading quoted into a record says which tree it is about.
        assert.strictEqual(cleanLines.length, 5);
        assert.strictEqual(cleanLines[0], 'repository: ' + path.basename(dir));
        assert.match(cleanLines[1], /^words: 16 of cap 16 across 5 /);
        assert.match(cleanLines[2], /^test lines: 2 of cap 2 across 1 /);
        assert.match(cleanLines[3], /^tests: 2$/);
        assert.match(cleanLines[4], /^changed paths under no measured root: none/);
        write(dir, 'home/claude-kit-doctrine.md', 'doctrine text here, with more words than before.\n');
        const dirty = runScript(['report', '--repo', dir]);
        assert.strictEqual(dirty.status, 0, dirty.stderr);
        assert.match(dirty.stdout, /^home\/claude-kit-doctrine\.md: 8 words, cap 3, \+5$/m);
    } finally {
        rmDir(dir);
    }
});

// The gate itself: this repository against its committed budget, over the six
// measured roots and no further. Every tracked file under one of those roots is
// classified or named on the exclusion list; a tracked file outside them is
// unmeasured, and no assertion here says otherwise. What that leaves uncovered is
// a curated root nobody added to the root list, which this check cannot see by
// construction, since a path under no root is not its subject.
test('this repository is inside its size budget, with every tracked file under a measured root classified', () => {
    assert.ok(fs.existsSync(BUDGET), 'the size budget is committed at test/size-budget.json');
    // The third argument is the containment root the CLI passes for the default
    // budget path, so the gate reads its caps under the same protection the
    // command line reads them under: a budget resolving outside this checkout is
    // refused rather than deciding every verdict here.
    const result = kit.check(REPO, BUDGET, REPO);
    assert.strictEqual(result.status, 'ok', result.failures ? result.failures.map((f) => f.reason + ': ' + f.path + ': ' + f.detail).join('\n') : result.detail);
    assert.deepStrictEqual(result.unclassified, []);
    // The exemption list is asserted directly, so growth in it reds here rather
    // than passing as one more path the classifier quietly skips. Re-applying the
    // producer's own test to its own output could not fail: `excluded` is built by
    // this list's `includes`, and classify skips an excluded path before it can be
    // measured.
    assert.deepStrictEqual(kit.EXCLUSIONS, ['test/size-budget.json'],
        'the exclusion list has grown, and every entry on it is a hole in the coverage control');
    for (const p of kit.EXCLUSIONS) {
        // Each exemption earns its place structurally: a root holds the path, so
        // it would reach the classifier, and no shape measures it, so without the
        // exemption it would be an unclassified failure rather than a measured
        // file. An entry failing either half is dead weight or a cap being hidden.
        assert.ok(kit.ROOTS.some((r) => kit.rootHolds(r.root, p)), 'an exempted path sits under a measured root: ' + p);
        assert.ok(!kit.ROOTS.some((r) => r.shapes.some((s) => s.test(p))), 'an exempted path matches no measured shape: ' + p);
    }
    // The classified corpus is what the caps cover, and what says it is the whole
    // corpus is a relation rather than a floor: every tracked path a root holds is
    // either measured here or named on the exclusion list, and nothing else. A
    // hardcoded floor would pass a corpus that had quietly lost files down to the
    // floor, which is the ordinary state in a deletion audit, and it would say
    // nothing about which files those were.
    const rootHeld = kit.allTrackedPaths(REPO).filter((p) => kit.ROOTS.some((r) => kit.rootHolds(r.root, p))).sort();
    assert.deepStrictEqual(rootHeld, result.measured.map((m) => m.path).concat(result.excluded).sort(),
        'every tracked path a root holds is measured or named on the exclusion list');
    assert.strictEqual(result.measured.filter((m) => m.size === null).length, 0);
    assert.ok(result.totals.words.size > 0 && result.totals.lines.size > 0 && result.totals.tests > 0);
    // The pathspec cross-check over this repository. The predicate is rootHolds'
    // case-folding root test applied to every path `git ls-files` prints with no
    // pathspec at all; the scope is the whole tracked tree; and what it matches
    // here is nothing, which is the report: no tracked path this tool claims as its
    // subject is missing from the filtered listing the classifier reads. The
    // instrument itself is watched speaking against a planted path below, in a
    // fixture, since this checkout is shared and no such path may be planted in it.
    // The listing the cross-check reads is the one the relation above already tied
    // to the measured corpus, so an empty listing cannot pass here silently: it
    // would have had to be empty there too, against a measured corpus the totals
    // below prove non-empty.
    assert.deepStrictEqual(result.blind, [],
        'every tracked path a root holds is in the pathspec-filtered listing too');
    assert.deepStrictEqual(kit.trackedPaths(REPO).filter((p) => kit.ROOTS.some((r) => kit.rootHolds(r.root, p))).sort(), rootHeld,
        'the filtered and unfiltered listings hold the same root-held paths');
    // The pending state is driven end to end against a fixture repository below,
    // where a real untracked file can be planted. Asserting its definition here
    // would only re-apply the producer's own predicate to the producer's output.
});

// The pending state end to end, over git rather than over an injected list: a
// real untracked file under a measured root, with a cap beside it, which is how a
// new test file and its budget entry ride in one changeset. The report is what a
// Chapter quotes, so it has to name the file too: the totals are built from the
// classified corpus, which holds no untracked file.
test('over a real repository an untracked capped file is pending, reported by check and named by report', () => {
    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        const budgetFile = path.join(dir, 'test', 'size-budget.json');
        const budget = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
        budget['test/new.test.js'] = 40;
        fs.writeFileSync(budgetFile, kit.serializeBudget(budget), 'utf8');
        write(dir, 'test/new.test.js', "test('c', () => {});\n");

        const pending = runScript(['check', '--repo', dir]);
        assert.strictEqual(pending.status, 0, pending.stdout + pending.stderr);
        assert.match(pending.stdout, /^pending: test\/new\.test\.js: a cap whose file git reports as untracked under a measured root/m);

        const shown = runScript(['report', '--repo', dir]);
        assert.strictEqual(shown.status, 0, shown.stderr);
        assert.match(shown.stdout, /^test\/new\.test\.js: 1 lines.*cap 40.*untracked.*tests 1$/m);
        assert.match(shown.stdout, /^excluded from those totals, untracked under a measured root:.*test\/new\.test\.js/m);

        // The narrowing, on the real path. A cap keyed on something git never
        // prints as an untracked measured file is stale rather than pending, so it
        // reds instead of sitting unmeasured and unreported forever: a directory
        // that exists, and an untracked file under a measured root that no shape
        // would measure once tracked.
        budget.test = 40;
        budget['test/helpers/fixture-builder.js'] = 40;
        fs.writeFileSync(budgetFile, kit.serializeBudget(budget), 'utf8');
        write(dir, 'test/helpers/fixture-builder.js', 'module.exports = {};\n');
        const stale = runScript(['check', '--repo', dir]);
        assert.strictEqual(stale.status, 1, stale.stdout + stale.stderr);
        assert.match(stale.stdout, /^stale-entry: test: a cap for a file the classifier no longer reaches/m);
        assert.match(stale.stdout, /^stale-entry: test\/helpers\/fixture-builder\.js: a cap for a file the classifier no longer reaches/m);
        // And the file that is genuinely pending is still pending in the same
        // run, so the narrowing above is the predicate at work rather than the
        // pending state having stopped working.
        assert.match(stale.stdout, /^pending: test\/new\.test\.js:/m);
    } finally {
        rmDir(dir);
    }
});

// The whole changed-files-only design of the HEAD read rests on this branch: the
// shared git runner caps one call's output at a mebibyte, and the largest test
// file in this repository sits above it. The branch is driven end to end here,
// against a committed blob past that ceiling, rather than through a hand-built
// row that would exercise the formatter alone and stay green through a wrong
// condition or a raised ceiling.
test('over a real repository a HEAD blob past the git runner ceiling arrives as head-unreadable', () => {
    const dir = makeFixtureRepo();
    try {
        // One line per iteration, so the file is a plausible test file rather
        // than one enormous line, and comfortably past the ceiling.
        const huge = "test('big', () => {});\n" + '// filler line to carry the bytes\n'.repeat(36000);
        assert.ok(Buffer.byteLength(huge, 'utf8') > MAX_OUTPUT_BYTES,
            'the fixture blob must exceed the runner ceiling or this case cannot reach the branch');
        write(dir, 'test/huge.test.js', huge);
        git(dir, ['add', 'test/huge.test.js']);
        git(dir, ['commit', '-q', '-m', 'huge']);
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);

        // The semantic the branch depends on: output past the ceiling reads as a
        // failure, never as truncated content. Truncated content would measure
        // short and print a fabricated delta at exit 0.
        assert.strictEqual(gitOutput(dir, ['show', 'HEAD:test/huge.test.js']), null);
        // The control, withheld from the ceiling by its size alone: a small blob
        // in the same repository through the same call comes back whole.
        assert.match(gitOutput(dir, ['show', 'HEAD:test/one.test.js']), /^test\('a'/);

        write(dir, 'test/huge.test.js', huge + '// one more line\n');
        const shown = runScript(['report', '--repo', dir]);
        assert.strictEqual(shown.status, 0, shown.stderr);
        assert.match(shown.stdout, /^test\/huge\.test\.js: 36002 lines.*cap 36001.*HEAD size unreadable/m);
        // The row state is read as the field it is, so the sentence stays free to
        // improve, and no delta rides on a row whose HEAD size never read.
        const hugeRow = kit.report(dir, path.join(dir, 'test', 'size-budget.json')).rows
            .filter((r) => r.path === 'test/huge.test.js');
        assert.deepStrictEqual(hugeRow.map((r) => r.headState), ['head-unreadable']);
        assert.strictEqual(hugeRow[0].headSize, null);
        // The control on the row state: a small changed file in the same run
        // reports a real delta, so the case above is the ceiling speaking rather
        // than every row having collapsed to unreadable.
        write(dir, 'home/claude-kit-doctrine.md', 'doctrine text here, with more words than before.\n');
        assert.match(runScript(['report', '--repo', dir]).stdout, /^home\/claude-kit-doctrine\.md: 8 words, cap 3, \+5$/m);
    } finally {
        rmDir(dir);
    }
});

// A gate whose whole job is to hold growth must never report success having
// tested no cap. Two readings produce exactly that, and each names itself in the
// refusal rather than exiting 1 as though a file had failed or 0 as though
// nothing had.
test('a reading that measured nothing, and one whose pending set covers the budget, each refuse with their own reason', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-empty-'));
    try {
        git(dir, ['init', '-q', '.']);
        write(dir, 'README.md', 'outside every measured root.\n');
        git(dir, ['add', '-A']);
        git(dir, ['commit', '-q', '-m', 'fixture']);
        write(dir, 'test/size-budget.json', kit.serializeBudget({ 'test/one.test.js': 40 }));
        const nothing = runScript(['check', '--repo', dir]);
        assert.strictEqual(nothing.status, 2, nothing.stdout + nothing.stderr);
        // The refusal states the blind count as well, at zero, so an empty tree and
        // a corpus hidden from the classifier are told apart off one line rather
        // than by running a second verb.
        assert.match(nothing.stderr, /the corpus is empty rather than hidden/);
        assert.match(nothing.stderr, /and no cap was tested\s*$/);
        // The same refusal on the other reading verb, which shares the collector:
        // an all-zero totals block reads as a section that grew nothing rather than
        // as a reading that never happened, and `report` is the verb a Chapter
        // quotes.
        const nothingReported = runScript(['report', '--repo', dir]);
        assert.strictEqual(nothingReported.status, 2, nothingReported.stdout + nothingReported.stderr);
        assert.match(nothingReported.stderr, /the corpus is empty rather than hidden/);
        assert.match(nothingReported.stderr, /and there is no reading to report\s*$/);
        assert.ok(!/of cap/.test(nothingReported.stdout), 'the refusal printed no totals at all: ' + nothingReported.stdout);

        // With one tracked measured file the corpus is no longer empty, so the
        // second refusal is the one that fires: every cap in the budget names an
        // untracked file, which suppresses the whole stale-entry mirror.
        write(dir, 'test/one.test.js', "test('a', () => {});\n");
        git(dir, ['add', 'test/one.test.js']);
        git(dir, ['commit', '-q', '-m', 'one']);
        write(dir, 'test/size-budget.json', kit.serializeBudget({ 'test/new.test.js': 40 }));
        write(dir, 'test/new.test.js', "test('b', () => {});\n");
        const allPending = runScript(['check', '--repo', dir]);
        assert.strictEqual(allPending.status, 2, allPending.stdout + allPending.stderr);
        assert.match(allPending.stderr, /every cap in the budget is pending/);
        // The branch returns before the pending files are measured, so no cap in this
        // reading is compared to anything: read as the fields it is rather than as the
        // sentence, since a reading that refuses carries no measurement at all.
        const allPendingRead = kit.check(dir, path.join(dir, 'test', 'size-budget.json'));
        assert.strictEqual(allPendingRead.status, 'unmeasured');
        assert.strictEqual(allPendingRead.pendingMeasured, undefined);
        assert.strictEqual(allPendingRead.failures, undefined);

        // The control: one real cap beside the pending one and the reading is a
        // reading again, so the refusals above are the two states speaking rather
        // than check having stopped producing a result at all.
        write(dir, 'test/size-budget.json', kit.serializeBudget({ 'test/new.test.js': 40, 'test/one.test.js': 40 }));
        assert.strictEqual(runScript(['check', '--repo', dir]).status, 0);
    } finally {
        rmDir(dir);
    }
});

// An unresolved merge is exactly when a whole-gate reading gets taken, and
// `git ls-files` prints a conflicted path once per stage. Undeduplicated, one
// file's lines would land in the totals two or three times and its failure would
// be emitted as many times.
test('a conflicted path is measured once rather than once per merge stage', () => {
    const dir = makeFixtureRepo();
    try {
        const base = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
        git(dir, ['checkout', '-q', '-b', 'sideline']);
        write(dir, 'home/claude-kit-doctrine.md', 'doctrine text from the sideline.\n');
        git(dir, ['commit', '-q', '-a', '-m', 'sideline']);
        git(dir, ['checkout', '-q', base]);
        write(dir, 'home/claude-kit-doctrine.md', 'doctrine text from the base branch.\n');
        git(dir, ['commit', '-q', '-a', '-m', 'base']);
        const merge = gitTry(dir, ['merge', 'sideline']);
        assert.notStrictEqual(merge.status, 0, 'the fixture merge must conflict for this case to have a subject');

        // The control: git really does print the path once per stage here, so the
        // assertion below is the dedupe working rather than a merge that left one
        // entry anyway.
        const stages = gitTry(dir, ['ls-files', '--', 'home/claude-kit-doctrine.md']).stdout
            .split(/\r?\n/).filter((l) => l !== '');
        assert.ok(stages.length > 1, 'the conflicted path is staged more than once: ' + stages.length);

        const tracked = kit.trackedPaths(dir).filter((p) => p === 'home/claude-kit-doctrine.md');
        assert.deepStrictEqual(tracked, ['home/claude-kit-doctrine.md']);
        const measured = kit.collect(dir).measured.filter((m) => m.path === 'home/claude-kit-doctrine.md');
        assert.strictEqual(measured.length, 1);
    } finally {
        rmDir(dir);
    }
});

// init takes its caps from worktree content, so an uncommitted edit anywhere in
// the corpus would be baked into a committed cap; where the edit is a net
// deletion the cap lands below HEAD and the gate then reds on a clean checkout.
test('init refuses a tree holding an uncommitted edit to a measured file, naming the paths', () => {
    const dir = makeFixtureRepo();
    try {
        write(dir, 'plugins/claude-kit/skills/alpha/SKILL.md', '---\nname: alpha\n---\n\nalpha.\n');
        const refused = runScript(['init', '--repo', dir]);
        assert.strictEqual(refused.status, 2, refused.stdout + refused.stderr);
        assert.match(refused.stderr, /measured files differ from HEAD, so a cap taken now would bake uncommitted content in: plugins\/claude-kit\/skills\/alpha\/SKILL\.md/);
        assert.ok(!fs.existsSync(path.join(dir, 'test', 'size-budget.json')), 'the refusal wrote no budget');
        // The control: the same call on the same tree once the edit is reverted
        // writes the budget, so the refusal is the dirty measured file speaking.
        write(dir, 'plugins/claude-kit/skills/alpha/SKILL.md', ALPHA_SKILL);
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
    } finally {
        rmDir(dir);
    }
});

// Nothing past the verb is ignored, because a call this tool half-understood
// would read this checkout while the operator believes they named another
// repository, and that figure gets quoted into a durable record with nothing in
// the output to say what it is about. Four refusals cover it: a flag with no
// value, a token that looks like a flag and is not one of the two, a flag given
// twice, and a second bare argument. Each names its own rule, since a reader who
// only knows the call was refused cannot tell a typo from a missing value.
test('a --repo or --budget with no value refuses rather than falling back to the default subject', () => {
    const bare = runScript(['check', '--repo']);
    assert.strictEqual(bare.status, 2);
    assert.match(bare.stderr, /--repo needs a value/);
    assert.match(bare.stderr, /usage: node kit-size\.js/);
    const swallowed = runScript(['check', '--repo', '--budget', BUDGET]);
    assert.strictEqual(swallowed.status, 2);
    assert.match(swallowed.stderr, /--repo needs a value/);
    const noBudget = runScript(['check', '--budget']);
    assert.strictEqual(noBudget.status, 2);
    assert.match(noBudget.stderr, /--budget needs a value/);
    // The `=` form is the likely operator spelling and names no flag this tool
    // takes, so it refuses rather than measuring the default repository.
    const joined = runScript(['check', '--repo=' + REPO]);
    assert.strictEqual(joined.status, 2);
    assert.match(joined.stderr, /--repo=.* is not a flag this tool takes/);
    // A misspelled flag, and a flag a newer caller passes to an older copy of this
    // script: same refusal, on its shape rather than on a list of known typos.
    const misspelled = runScript(['check', '--repoo', REPO]);
    assert.strictEqual(misspelled.status, 2);
    assert.match(misspelled.stderr, /--repoo is not a flag this tool takes/);
    // A second bare argument is refused too, since only one of them can be the
    // verb and the other is a subject the parser would otherwise drop.
    const twoVerbs = runScript(['check', 'report', '--repo', REPO]);
    assert.strictEqual(twoVerbs.status, 2);
    assert.match(twoVerbs.stderr, /report is a second bare argument/);
    // A flag given twice is refused rather than resolved to its last value: the
    // call names two subjects, one of them is read, and the output says nothing
    // about the other.
    const twiceRepo = runScript(['check', '--repo', REPO, '--repo', os.tmpdir()]);
    assert.strictEqual(twiceRepo.status, 2, twiceRepo.stdout + twiceRepo.stderr);
    assert.match(twiceRepo.stderr, /--repo is given more than once/);
    const twiceBudget = runScript(['check', '--budget', BUDGET, '--budget', BUDGET]);
    assert.strictEqual(twiceBudget.status, 2, twiceBudget.stdout + twiceBudget.stderr);
    assert.match(twiceBudget.stderr, /--budget is given more than once/);
    // The control: the same verb with both values present is a real reading, so
    // the refusals above are the bad arguments speaking rather than the parser
    // refusing everything.
    assert.deepStrictEqual(kit.parseArgs(['check', '--repo', 'D:/x', '--budget', 'b.json']),
        { verb: 'check', repo: 'D:/x', budget: 'b.json', invalid: null, invalidReason: null });
    assert.deepStrictEqual(kit.parseArgs(['check', '--repo=D:/x']),
        { verb: 'check', repo: null, budget: null, invalid: '--repo=D:/x', invalidReason: 'unknown-flag' });
    assert.deepStrictEqual(kit.parseArgs(['check', 'report']),
        { verb: 'check', repo: null, budget: null, invalid: 'report', invalidReason: 'extra-argument' });
    assert.deepStrictEqual(kit.parseArgs(['check', '--repo', 'D:/x', '--repo', 'D:/y']),
        { verb: 'check', repo: 'D:/x', budget: null, invalid: '--repo', invalidReason: 'repeated-flag' });
});

// The worktree read is a repository-supplied file read, so it runs through the
// shared bounded reader and a containment check rather than a plain readFileSync.
// Two of that boundary's properties are observable without privilege here; the
// FIFO refusal is not, since win32 has no path-named FIFO for a repository to
// plant, and the byte ceiling is pinned by its relation to the corpus instead.
test('a worktree read refuses a path outside the repository, a non-regular file, and never measures a partial read', () => {
    const nested = makeNestedFixtureRepo();
    const dir = nested.dir;
    const outside = path.join(nested.parent, 'outside.md');
    try {
        fs.writeFileSync(outside, 'outside text here\n', 'utf8');
        // The control first: a path inside the repository reads normally, so the
        // refusals below are the boundary and not a reader that returns null for
        // everything.
        assert.match(kit.readWorktree(dir, 'home/claude-kit-doctrine.md'), /^doctrine text here/);
        assert.strictEqual(kit.readWorktree(dir, path.join('..', path.basename(outside))), null,
            'a path resolving outside the repository is not measured as though it sat inside it');
        assert.strictEqual(kit.readWorktree(dir, 'test'), null, 'a directory is not a file to measure');
        assert.strictEqual(kit.readWorktree(dir, 'test/absent.test.js'), null);
        // The ceiling is a property of the reader rather than of any file here,
        // so what is pinned is that it sits above the corpus it has to read: a
        // ceiling below a real measured file would turn that file into an
        // unreadable failure rather than a size. The largest file is derived from
        // the classified corpus rather than named, since a file naming itself the
        // largest stays green while a newer, bigger one goes unchecked.
        const classified = kit.classify(kit.trackedPaths(REPO));
        const corpusEntries = classified.entries;
        const corpusBytes = corpusEntries.map((e) => {
            try {
                return fs.statSync(path.join(REPO, e.path)).size;
            } catch {
                return 0;
            }
        });
        // That the maximum was taken over the whole corpus is a relation rather
        // than a floor: every tracked path a root holds is one of these entries or
        // an exempted one, so a listing that had silently shrunk reds here instead
        // of passing a floor it still cleared. The exempted half comes from the same
        // classification rather than from the exclusion list, since an exempted path
        // git does not track is on that list and in no listing.
        assert.deepStrictEqual(kit.allTrackedPaths(REPO).filter((p) => kit.ROOTS.some((r) => kit.rootHolds(r.root, p))).sort(),
            corpusEntries.map((e) => e.path).concat(classified.excluded).sort(),
            'the maximum was taken over every tracked path a root holds, exemptions aside');
        assert.ok(kit.MAX_FILE_BYTES > Math.max(...corpusBytes),
            'the read ceiling sits above the largest file in this repository\'s measured corpus');
    } finally {
        rmDir(nested.parent);
    }
});

// The pathspec cross-check end to end. git's pathspec matching is case-sensitive,
// so a tracked path recorded under a differently cased root prefix never reaches
// the classifier and the unclassified reason cannot fire on it: the path is
// invisible to every reading derived from the filtered listing. The cross-check
// against an unfiltered `git ls-files` is what sees it. The planted path is
// withheld from every pattern in the script and matched on the shape of a
// case-variant prefix, and it is planted through the index rather than the
// worktree because this platform's filesystem is case-insensitive and would fold
// the two spellings into one directory.
test('over a real repository a tracked path under a differently-cased root prefix reds as pathspec-blind', () => {
    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        assert.strictEqual(runScript(['check', '--repo', dir]).status, 0);

        write(dir, 'blob-source.md', 'planted through the index.\n');
        const hash = git(dir, ['hash-object', '-w', 'blob-source.md']);
        git(dir, ['update-index', '--add', '--cacheinfo', '100644,' + hash + ',Plugins/claude-kit/agents/planted.md']);

        // The mechanism, so the red below is read for what it is: the unfiltered
        // listing holds the path and the pathspec-filtered one does not.
        assert.ok(kit.allTrackedPaths(dir).includes('Plugins/claude-kit/agents/planted.md'));
        assert.ok(!kit.trackedPaths(dir).includes('Plugins/claude-kit/agents/planted.md'),
            'git pathspec matching is case-sensitive, so the filtered listing does not return it');

        const blind = runScript(['check', '--repo', dir]);
        assert.strictEqual(blind.status, 1, blind.stdout + blind.stderr);
        assert.match(blind.stdout, /^pathspec-blind: Plugins\/claude-kit\/agents\/planted\.md: a root holds this tracked path/m);
        // And the report names it too, because the report is the output a Chapter
        // quotes: a path in no row, in no total and in no untracked line is
        // invisible in that record unless the reading says so.
        const blindReport = runScript(['report', '--repo', dir]);
        assert.strictEqual(blindReport.status, 0, blindReport.stderr);
        assert.match(blindReport.stdout, /^Plugins\/claude-kit\/agents\/planted\.md: a root holds this tracked path.*the totals below exclude it$/m);
        // And init refuses on it too, so a budget is never written over a corpus
        // holding a file no cap would cover.
        fs.rmSync(path.join(dir, 'test', 'size-budget.json'));
        const refusedInit = runScript(['init', '--repo', dir]);
        assert.strictEqual(refusedInit.status, 2);
        assert.match(refusedInit.stderr, /the pathspec listing does not return/);

        // The control, on the other side of the case fold: the same plant spelled
        // as the root is spelled IS returned by the filtered listing, so it reaches
        // the classifier and reds as a measured file with no cap instead. Without
        // this half the red above would pass on a cross-check that flagged every
        // planted path.
        git(dir, ['update-index', '--force-remove', 'Plugins/claude-kit/agents/planted.md']);
        write(dir, 'plugins/claude-kit/agents/planted.md', 'planted through the index.\n');
        git(dir, ['add', 'plugins/claude-kit/agents/planted.md']);
        git(dir, ['commit', '-q', '-m', 'planted']);
        assert.ok(kit.trackedPaths(dir).includes('plugins/claude-kit/agents/planted.md'));
        const cased = runScript(['init', '--repo', dir]);
        assert.strictEqual(cased.status, 0, cased.stdout + cased.stderr);
        const casedCheck = runScript(['check', '--repo', dir]);
        assert.strictEqual(casedCheck.status, 0, casedCheck.stdout + casedCheck.stderr);
        assert.ok(!/pathspec-blind/.test(casedCheck.stdout), 'the correctly-cased plant is not blind: ' + casedCheck.stdout);
    } finally {
        rmDir(dir);
    }
});

// The design's own named silent-green hazard, driven rather than asserted in prose:
// a git call that could not answer must never become a zero-size reading, because
// a zero passes every cap. Both reading verbs take it, and `report` needs it most,
// since its totals are what a Chapter quotes.
test('a repository git cannot read refuses both reading verbs rather than measuring nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-nongit-'));
    try {
        // Refused by the collector's git-failure status: `git ls-files` answered
        // nothing usable, so there is no corpus at all, let alone an empty one.
        const checked = runScript(['check', '--repo', dir]);
        assert.strictEqual(checked.status, 2, checked.stdout + checked.stderr);
        assert.match(checked.stderr, /git ls-files returned nothing usable/);
        assert.ok(!/of cap/.test(checked.stdout), 'no totals were printed: ' + checked.stdout);
        const reported = runScript(['report', '--repo', dir]);
        assert.strictEqual(reported.status, 2, reported.stdout + reported.stderr);
        assert.match(reported.stderr, /git ls-files returned nothing usable/);
        assert.ok(!/of cap/.test(reported.stdout), 'no totals were printed: ' + reported.stdout);

        // The control: the same directory once git can read it produces a reading,
        // so the refusals above are the missing repository speaking rather than the
        // tool refusing this path for some other reason.
        git(dir, ['init', '-q', '.']);
        write(dir, 'test/one.test.js', "test('a', () => {});\n");
        git(dir, ['add', '-A']);
        git(dir, ['commit', '-q', '-m', 'fixture']);
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        assert.strictEqual(runScript(['check', '--repo', dir]).status, 0);
        assert.strictEqual(runScript(['report', '--repo', dir]).status, 0);
    } finally {
        rmDir(dir);
    }
});

// The ordinary state behind the unreadable row: a tracked measured file removed
// from the worktree and not staged, which is what a session mid-delete has. The
// size is unknown there, and the one thing a size gate must never do is call it
// zero: `check` reds on it and `report` names it with no delta rather than
// printing the file's whole cap as this section's cut.
test('over a real repository a tracked measured file missing from the worktree is unreadable in both verbs', () => {
    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        fs.rmSync(path.join(dir, 'home', 'claude-kit-doctrine.md'));

        // Refused by the unreadable reason, which is what `measure` produces for
        // content the bounded reader would not hand over.
        const checked = runScript(['check', '--repo', dir]);
        assert.strictEqual(checked.status, 1, checked.stdout + checked.stderr);
        assert.match(checked.stdout, /^unreadable: home\/claude-kit-doctrine\.md: git tracks this file/m);

        const reported = runScript(['report', '--repo', dir]);
        assert.strictEqual(reported.status, 0, reported.stderr);
        const row = reported.stdout.split(/\r?\n/).filter((l) => l.startsWith('home/claude-kit-doctrine.md'));
        assert.strictEqual(row.length, 1, reported.stdout);
        assert.match(row[0], /unreadable/);
        assert.ok(!/[-+]\d/.test(row[0]), 'the row carries no delta at all: ' + row[0]);
        // And the totals say a file is missing from the size sum while its cap
        // still stands in the cap sum, so the shortfall cannot read as a cut.
        assert.match(reported.stdout, /^words: .*1 of them unreadable/m);
    } finally {
        rmDir(dir);
    }
});

// A deletion is the audits' own shape, so it is the state this reading meets
// most: both audits exist to remove files. A path the index has deleted differs
// from HEAD while `git ls-files` no longer prints it, so it reaches the report as
// a changed path with no measured entry, and the state it must not be given is
// the unmeasured one, whose sentence says the classifier reached the file and
// found no shape for it. HEAD still holds the blob, so the row carries the size
// that left and the negative delta.
test('over a real repository a deleted file is its own row, with the HEAD size and the negative delta', () => {
    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        git(dir, ['rm', '-q', '-f', 'test/one.test.js']);

        const reported = runScript(['report', '--repo', dir]);
        assert.strictEqual(reported.status, 0, reported.stderr);
        const row = reported.stdout.split(/\r?\n/).filter((l) => l.startsWith('test/one.test.js'));
        assert.strictEqual(row.length, 1, reported.stdout);
        assert.match(row[0], /^test\/one\.test\.js: deleted, cap 2, HEAD held 2 lines, -2/);
        assert.match(row[0], /tests at HEAD 2, -2$/);
        assert.ok(!/matched by no measured shape/.test(row[0]),
            'a deleted file is not reported as a file the classifier could not place: ' + row[0]);
        // The row state is read as the field it is, so the sentence beside it
        // stays free to improve.
        const deleted = kit.report(dir, path.join(dir, 'test', 'size-budget.json')).rows
            .filter((r) => r.path === 'test/one.test.js');
        assert.deepStrictEqual(deleted.map((r) => r.headState), ['deleted']);
        assert.strictEqual(deleted[0].headSize, 2);

        // The control, withheld from the deletion by being tracked: a tracked file
        // under a measured root that no shape reaches is still the unmeasured row
        // in the same run, so the deleted state above is the deletion speaking
        // rather than that row state having been retired.
        write(dir, 'test/helpers/fixture-builder.js', 'module.exports = {};\n');
        git(dir, ['add', 'test/helpers/fixture-builder.js']);
        const both = runScript(['report', '--repo', dir]);
        assert.strictEqual(both.status, 0, both.stderr);
        assert.match(both.stdout, /^test\/helpers\/fixture-builder\.js: changed.*matched by no measured shape/m);
        assert.match(both.stdout, /^test\/one\.test\.js: deleted/m);
    } finally {
        rmDir(dir);
    }
});

// A pending cap binds the file it names. The cap and the file ride in one
// changeset by design, so the file is untracked at exactly the moment the gate runs
// over the changeset that adds it, and a cap left uncompared there never binds
// anything: the file could pass its own cap by any amount at exit 0, which is the
// one failure a size gate must not have. What the untracked state suppresses is the
// stale-entry mirror for that key.
test('a pending cap is compared against its own file, and reds when the file is over it', () => {
    const measured = [{ path: 'test/one.test.js', metric: 'lines', size: 10, tests: 1 }];
    const budget = { 'test/one.test.js': 120, 'test/new.test.js': 40 };
    const pending = ['test/new.test.js'];
    const over = [{ path: 'test/new.test.js', metric: 'lines', size: 41, tests: 3 }];
    const failures = kit.evaluate(measured, budget, [], pending, null, { pendingMeasured: over });
    assert.deepStrictEqual(failures.map((f) => f.reason), [kit.REASONS.OVER_CAP]);
    assert.strictEqual(failures[0].path, 'test/new.test.js');
    assert.match(failures[0].detail, /41 lines against a cap of 40/);
    // The HEAD comparison for a pending file is its own value: no HEAD diff lists an
    // untracked path, so 'matches' would claim the file agrees with a blob HEAD does
    // not hold.
    assert.strictEqual(failures[0].headComparison, 'untracked');
    // The control, withheld from the red by one line: the same file at its cap is no
    // failure, so the red above is the comparison speaking rather than every pending
    // cap failing.
    const atCap = [{ path: 'test/new.test.js', metric: 'lines', size: 40, tests: 3 }];
    assert.deepStrictEqual(kit.evaluate(measured, budget, [], pending, null, { pendingMeasured: atCap }), []);
    // And a pending file the reader would not hand over is unreadable rather than a
    // zero, on its own sentence, since a zero passes every cap.
    const gone = [kit.measure({ path: 'test/new.test.js', metric: 'lines' }, null)];
    const unreadable = kit.evaluate(measured, budget, [], pending, null, { pendingMeasured: gone });
    assert.deepStrictEqual(unreadable.map((f) => f.reason), [kit.REASONS.UNREADABLE]);
    assert.match(unreadable[0].detail, /untracked and present/);
});

// The same end to end, which is where it bites: the gate's own newest file is
// untracked while its section is in flight, so this is the state every lane run
// over a section that adds a file takes.
test('over a real repository an untracked file over its own cap reds rather than passing as pending', () => {
    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        const budgetFile = path.join(dir, 'test', 'size-budget.json');
        const budget = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
        budget['test/new.test.js'] = 1;
        fs.writeFileSync(budgetFile, kit.serializeBudget(budget), 'utf8');
        write(dir, 'test/new.test.js', "test('c', () => {});\ntest('d', () => {});\n");

        const over = runScript(['check', '--repo', dir]);
        assert.strictEqual(over.status, 1, over.stdout + over.stderr);
        assert.match(over.stdout, /^over-cap: test\/new\.test\.js: 2 lines against a cap of 1/m);
        assert.match(over.stdout, /untracked, so HEAD holds no blob for it/);

        // The control, withheld from the red by one cap: the same file with a cap
        // that covers it is pending and green, so the red above is the cap comparison
        // rather than the tool refusing every untracked file.
        budget['test/new.test.js'] = 2;
        fs.writeFileSync(budgetFile, kit.serializeBudget(budget), 'utf8');
        const green = runScript(['check', '--repo', dir]);
        assert.strictEqual(green.status, 0, green.stdout + green.stderr);
        assert.match(green.stdout, /^pending: test\/new\.test\.js:.*2 lines$/m);
    } finally {
        rmDir(dir);
    }
});

// A tree whose root-held paths are all absent from the pathspec-filtered listing
// measures nothing, exactly like a tree with nothing in it, and the two want
// opposite responses: one is a corpus sitting in the index that no reading reached,
// the other is a project the roots do not describe. Reported as empty, the first
// sends its reader looking for files that are right there.
test('a corpus hidden from the pathspec listing refuses on its own reason rather than as an empty corpus', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-hidden-'));
    try {
        git(dir, ['init', '-q', '.']);
        write(dir, 'README.md', 'outside every measured root.\n');
        git(dir, ['add', '-A']);
        git(dir, ['commit', '-q', '-m', 'fixture']);
        // Planted through the index, because this platform's filesystem folds the two
        // spellings of the directory into one.
        write(dir, 'blob-source.md', 'planted through the index.\n');
        const hash = git(dir, ['hash-object', '-w', 'blob-source.md']);
        git(dir, ['update-index', '--add', '--cacheinfo', '100644,' + hash + ',TEST/one.test.js']);
        write(dir, 'test/size-budget.json', kit.serializeBudget({ 'test/one.test.js': 40 }));

        const hidden = runScript(['check', '--repo', dir]);
        assert.strictEqual(hidden.status, 2, hidden.stdout + hidden.stderr);
        assert.match(hidden.stderr, /1 tracked path a root holds was absent from the pathspec-filtered listing, so the corpus is hidden from the classifier rather than empty: TEST\/one\.test\.js/);
        const hiddenReport = runScript(['report', '--repo', dir]);
        assert.strictEqual(hiddenReport.status, 2, hiddenReport.stdout + hiddenReport.stderr);
        assert.match(hiddenReport.stderr, /hidden from the classifier rather than empty/);

        // The control, withheld from the hidden state by one spelling: the same plant
        // under the root as the root is spelled reaches the classifier, so the corpus
        // is measured and the refusal above is the cross-check speaking.
        git(dir, ['update-index', '--force-remove', 'TEST/one.test.js']);
        write(dir, 'test/one.test.js', "test('a', () => {});\n");
        git(dir, ['add', 'test/one.test.js']);
        git(dir, ['commit', '-q', '-m', 'one']);
        assert.strictEqual(runScript(['check', '--repo', dir]).status, 0);
    } finally {
        rmDir(dir);
    }
});

// The no-corpus refusal states the blind count even at zero, which is what parts an
// empty tree from a hidden corpus in one line. The function is driven directly here,
// since the two fixtures above cover one branch each and the wording of both is what
// a reader diagnoses from.
test('the no-corpus refusal names the blind count and carries the calling verb clause', () => {
    const empty = kit.unmeasuredRefusal({ measured: [], blind: [] }, 'no cap was tested');
    assert.strictEqual(empty.status, 'unmeasured');
    assert.match(empty.detail, /no tracked path a root holds was absent from the pathspec-filtered listing/);
    assert.match(empty.detail, /no cap was tested$/);
    const hidden = kit.unmeasuredRefusal({ measured: [], blind: ['TEST/one.test.js', 'Home/CLAUDE.md'] }, 'no cap was tested');
    assert.match(hidden.detail, /2 tracked paths a root holds were absent/);
    assert.match(kit.unmeasuredRefusal({ measured: [], blind: ['TEST/one.test.js'] }, 'x').detail, /1 tracked path a root holds was absent/);
    // A measurable corpus is no refusal at all, which is what lets both verbs share
    // one function without either inventing a fault.
    assert.strictEqual(kit.unmeasuredRefusal({ measured: [{ path: 'test/one.test.js' }], blind: [] }, 'no cap was tested'), null);
});

// The report's totals say how much of the changeset sits under no measured root,
// because a section whose whole delta is outside them (the hooks, the scripts
// directory, the doctor, the repository top level) otherwise renders as the subject
// line and totals block with no row between them that a clean tree renders, into a
// Chapter field named for the delta.
// Both an edit to a tracked file and a new untracked one count, since a HEAD diff
// never lists an untracked path and a section's new file is untracked at exactly the
// moment its Chapter is written.
test('the report says how many changed paths sit under no measured root', () => {
    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        // The control first, on a clean tree: none, which is what makes a non-zero
        // count below mean something.
        assert.match(runScript(['report', '--repo', dir]).stdout, /^changed paths under no measured root: none/m);

        write(dir, 'README.md', 'outside every measured root, and edited.\n');
        write(dir, 'newcomer.md', 'untracked and outside every measured root.\n');
        const shown = runScript(['report', '--repo', dir]);
        assert.strictEqual(shown.status, 0, shown.stderr);
        assert.match(shown.stdout, /^changed paths under no measured root: 2 \(1 differing from HEAD, 1 untracked\)/m);
        // Neither path is measured or named as a row: the count is scope rather than a
        // reading of files this tool holds no caps for.
        assert.ok(!/^README\.md/m.test(shown.stdout), 'no row names the unmeasured path: ' + shown.stdout);
        assert.ok(!/^newcomer\.md/m.test(shown.stdout), 'no row names the unmeasured path: ' + shown.stdout);
        assert.deepStrictEqual(kit.outsideRootCounts(dir), { changed: 1, untracked: 1, excluded: ['test/size-budget.json'] });
    } finally {
        rmDir(dir);
    }
});

// The totals block has one author. It printed twice from two copies once, and the
// copies had already drifted in the sentence about unreadable files, with only one of
// them under a test.
test('both reading verbs print the totals block from one source', () => {
    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        const budgetFile = path.join(dir, 'test', 'size-budget.json');
        const checked = runScript(['check', '--repo', dir]);
        assert.strictEqual(checked.status, 0, checked.stdout + checked.stderr);
        const expected = kit.renderTotals(kit.check(dir, budgetFile, dir).totals);
        const printed = checked.stdout.split(/\r?\n/).filter((l) => l !== '');
        assert.deepStrictEqual(printed.slice(-expected.length), expected);
        // The report's totals are the same lines from the same function with the scope
        // line after them, so the two verbs cannot drift apart.
        const reported = runScript(['report', '--repo', dir]).stdout.split(/\r?\n/).filter((l) => l !== '');
        assert.deepStrictEqual(reported.slice(-expected.length - 1, -1), expected);
    } finally {
        rmDir(dir);
    }
});

// A deleted row with no HEAD size has four reasons for it, and the audits this
// reading serves are deletion efforts, so it gets four sentences: a blob past the
// runner's output ceiling is a real deletion whose size cannot be printed, a git call
// that never ran is a reading nobody took, HEAD holding no blob is a file added and
// deleted in one changeset, and a path no shape reaches was never asked about. One
// sentence over all four reads as the first.
test('a deleted row says which HEAD state left it without a size', () => {
    const sums = { words: { size: 0, cap: 0, files: 0, unreadable: 0 }, lines: { size: 5, cap: 5, files: 1, unreadable: 0 }, tests: 1 };
    const row = (headBlobState) => kit.renderReport([
        { path: 'test/gone.test.js', metric: 'lines', size: null, tests: null, headState: 'deleted', headBlobState, headSize: null, headTests: null }
    ], sums, { 'test/gone.test.js': 40 })[0];
    assert.match(row('head-unreadable'), /past the git runner output ceiling/);
    assert.match(row('head-unknown'), /git did not answer for its HEAD state/);
    assert.match(row('new'), /added and deleted inside this changeset/);
    assert.match(row('absent'), /no measured shape reaches this path/);
    // The four are distinct, which is the point of carrying the state onto the row: a
    // reader tells them apart without a second reading.
    assert.strictEqual(new Set(['head-unreadable', 'head-unknown', 'new', 'absent'].map(row)).size, 4);
    // The control, withheld from all four by having a size: a deletion whose HEAD size
    // read prints the size and the negative delta, so the sentences above are the
    // missing size speaking rather than the row having lost its delta.
    const withSize = kit.renderReport([
        { path: 'test/gone.test.js', metric: 'lines', size: null, tests: null, headState: 'deleted', headBlobState: 'changed', headSize: 12, headTests: 3 }
    ], sums, { 'test/gone.test.js': 40 })[0];
    assert.match(withSize, /HEAD held 12 lines, -12/);
});

// The screen over a printed path is about the output's destination rather than a
// terminal: the report is pasted into a fenced block in a plan-doc Chapter whose
// heading lines are a machine contract. A newline would forge a second row there, a
// backtick run would close the fence and drop the rest of the row into the document
// as prose, and a line opening with a markdown heading would end the Chapters block
// for the plan parser. The paths below are matched on those shapes and appear in no
// pattern in the script.
test('a printed path cannot forge a row, close a fence, or open a markdown heading', () => {
    const sums = { words: { size: 0, cap: 0, files: 0, unreadable: 0 }, lines: { size: 5, cap: 5, files: 1, unreadable: 0 }, tests: 1 };
    const forged = kit.renderReport([
        { path: 'test/a.test.js\ntest/forged.test.js: 9000 lines, cap 1, +9000', metric: 'lines', size: 10, tests: 1, headState: 'new', headSize: null, headTests: null }
    ], sums, {});
    // One row and the totals, with no newline anywhere inside the row: the forged
    // second row cannot exist as a line of its own.
    assert.strictEqual(forged.length, 4);
    assert.ok(!forged.some((l) => l.includes('\n')), 'no rendered line carries a newline: ' + JSON.stringify(forged));
    assert.match(forged[0], /^test\/a\.test\.jstest\/forged\.test\.js/);
    // The control, withheld from the newline by one character: the same path without
    // it renders as one ordinary row, so the assertions above are the screen working
    // rather than the renderer dropping rows.
    const plain = kit.renderReport([
        { path: 'test/a.test.js', metric: 'lines', size: 10, tests: 1, headState: 'new', headSize: null, headTests: null }
    ], sums, {});
    assert.strictEqual(plain.length, 4);
    assert.match(plain[0], /^test\/a\.test\.js: 10 lines/);
    // A backtick run and a leading hash run go the same way, with the same path
    // carrying neither as the control.
    assert.strictEqual(kit.safePath('test/a`` `.test.js'), 'test/a .test.js');
    assert.strictEqual(kit.safePath('## test/a.test.js'), ' test/a.test.js');
    assert.strictEqual(kit.safePath('test/a.test.js'), 'test/a.test.js');
});

// The frontmatter strip has two ways to under-count and this is the second: a
// key-shaped block whose close is mangled has no close in the format's terms, and a
// scan running on to the next bare horizontal rule takes every word between them out
// of the reading. Under-count is the dangerous direction on a size gate, since it
// passes every cap.
test('a key-shaped frontmatter block with a mangled close is not frontmatter', () => {
    const mangled = '---\nname: alpha\n----\n\nBody words here.\n\n---\n\nMore body words.\n';
    // Nothing is stripped, so every token counts: a strip that ran to the later rule
    // would return the last line alone.
    assert.strictEqual(kit.stripFrontmatter(mangled), mangled, 'a block with no close in the format is not frontmatter');
    assert.strictEqual(kit.wordCount(mangled), 11);
    // The control, withheld from the mangled shape by one hyphen: the same block
    // closed properly IS frontmatter and the strip reaches it, so the assertion above
    // is the mangled close speaking rather than the strip having stopped.
    const closed = '---\nname: alpha\n---\n\nBody words here.\n\n---\n\nMore body words.\n';
    // Seven: the two frontmatter tokens left the reading and the body's own rule
    // stayed in it, which is the four-token difference from the mangled shape above.
    assert.strictEqual(kit.wordCount(closed), 7);
    assert.ok(!kit.stripFrontmatter(closed).includes('name: alpha'));
});

// Every assertion here over what git reports as untracked rests on a global excludes
// file, and which one any git invocation in this file reads is decided by HOME,
// USERPROFILE and XDG_CONFIG_HOME: the shared runner strips every GIT_* variable from
// the child it runs, so the usual lever cannot reach it. gitEnv sets all three for
// the spawn sites and this file sets them on its own process for the in-process
// readings, so both classes answer about an empty home. Planting an exclusion and
// watching the reading change is what shows those variables are the ones in force.
//
// The home this case plants in is its own, made and removed here, because it mutates
// what it points at: a case leaning on the shared directory would order this file's
// cases against each other and hide the dependence until the runner goes parallel.
test('a spawned script reads its git configuration from the home the environment names', () => {
    const dir = makeFixtureRepo();
    const caseHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-casehome-'));
    const xdgGit = path.join(caseHome, 'xdg', 'git');
    try {
        assert.strictEqual(runScript(['init', '--repo', dir], caseHome).status, 0);
        const budgetFile = path.join(dir, 'test', 'size-budget.json');
        const budget = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
        budget['test/new.test.js'] = 40;
        fs.writeFileSync(budgetFile, kit.serializeBudget(budget), 'utf8');
        write(dir, 'test/new.test.js', "test('c', () => {});\n");
        // The control first, with no excludes file in this case's home: git reports
        // the file as untracked, so its cap is pending.
        assert.match(runScript(['check', '--repo', dir], caseHome).stdout, /^pending: test\/new\.test\.js:/m);

        fs.mkdirSync(xdgGit, { recursive: true });
        fs.writeFileSync(path.join(xdgGit, 'ignore'), 'new.test.js\n', 'utf8');
        // With the exclusion in place the same file is ignored, so the cap is stale
        // rather than pending. Nothing else moved between the two runs, so the change
        // is that home being read.
        const ignored = runScript(['check', '--repo', dir], caseHome);
        assert.strictEqual(ignored.status, 1, ignored.stdout + ignored.stderr);
        assert.match(ignored.stdout, /^stale-entry: test\/new\.test\.js:/m);
        // And the process-wide isolation home is untouched by that plant: the same
        // reading through it is pending again, which is what makes this case's home
        // its own rather than a mutation every case after it inherits.
        assert.match(runScript(['check', '--repo', dir]).stdout, /^pending: test\/new\.test\.js:/m);
    } finally {
        rmDir(caseHome);
        rmDir(dir);
    }
});

// A verb refusal names the offending token, like every argument refusal beside it: a
// bare usage block says what the tool takes and never which token it would not take,
// and a typo and a forgotten verb are different mistakes.
test('an unknown verb and a missing verb each name what was wrong', () => {
    const unknown = runScript(['chekc', '--repo', REPO]);
    assert.strictEqual(unknown.status, 2);
    assert.match(unknown.stderr, /chekc is not a verb this tool takes; only check, report and init are/);
    assert.match(unknown.stderr, /usage: node kit-size\.js/);
    const none = runScript([]);
    assert.strictEqual(none.status, 2);
    assert.match(none.stderr, /no verb was given, and this tool takes one of check, report or init/);
    assert.match(none.stderr, /usage: node kit-size\.js/);
    // The control, withheld from both refusals by naming a verb: a real verb against a
    // real repository produces a reading, so the refusals above are the verb check
    // rather than the tool refusing every call.
    const real = runScript(['report', '--repo', REPO, '--budget', BUDGET]);
    assert.strictEqual(real.status, 0, real.stderr);
    assert.match(real.stdout, /of cap/);
});

// --repo names a repository top level, and nothing enforcing that is a wrong subject
// with no signal: git resolves this tool's relative pathspecs and its own output
// paths against the directory it is pointed at, so a subdirectory yields a corpus
// that is silently a subset, measured against budget keys matching none of its paths.
test('a --repo below the repository top level is refused rather than measured', () => {
    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        const below = runScript(['check', '--repo', path.join(dir, 'test')]);
        assert.strictEqual(below.status, 2, below.stdout + below.stderr);
        assert.match(below.stderr, /is not a repository top level/);
        assert.ok(!/of cap/.test(below.stdout), 'no totals were printed for the wrong subject: ' + below.stdout);
        // The control, withheld from the refusal by one directory level: the top level
        // itself reads normally, so the refusal is the level check rather than a tool
        // refusing every --repo.
        assert.strictEqual(runScript(['check', '--repo', dir]).status, 0);
        // git reports the same top level from inside the subdirectory, which is what
        // makes the refusal's own sentence legible.
        assert.ok(kit.samePath(kit.repoTopLevel(path.join(dir, 'test')), dir));
        // A directory that is no repository at all answers nothing here, which is what
        // leaves the collector's git failure as its own reason rather than this refusal
        // claiming a wrong level.
        assert.strictEqual(kit.repoTopLevel(path.join(os.tmpdir(), 'kit-size-absent-' + path.basename(dir))), null);
    } finally {
        rmDir(dir);
    }
});

// init writes, and a write is not a reading. The read side lets --budget name a file
// anywhere, because an operator reading a budget elsewhere gets the figure they asked
// for; an unbounded write creates a file anywhere on disk from a flag, and the caps in
// it are read back from outside the reviewed checkout one call later.
test('init refuses a --budget outside the repository under measurement', () => {
    const nested = makeNestedFixtureRepo();
    try {
        const outside = path.join(nested.parent, 'size-budget.json');
        const refused = runScript(['init', '--repo', nested.dir, '--budget', outside]);
        assert.strictEqual(refused.status, 2, refused.stdout + refused.stderr);
        assert.match(refused.stderr, /does not resolve inside/);
        assert.ok(!fs.existsSync(outside), 'the refusal wrote no file outside the repository');
        // The control, withheld from the refusal by its location: the same flag naming
        // a path inside the repository writes, so the refusal is containment rather
        // than --budget being refused outright.
        const inside = path.join(nested.dir, 'test', 'caps.json');
        const wrote = runScript(['init', '--repo', nested.dir, '--budget', inside]);
        assert.strictEqual(wrote.status, 0, wrote.stdout + wrote.stderr);
        assert.ok(fs.existsSync(inside));
    } finally {
        rmDir(nested.parent);
    }
});

// A target repository with no test/ directory yet is the commonest state a first init
// meets, and containment on a path that does not exist resolves to nothing, so
// checked first it reports as a link out of the checkout and sends its reader after a
// symlink nobody planted. The read side documents that order; the write side is where
// it was missing.
test('init parts a missing budget directory from one linked out of the checkout', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-nodir-'));
    try {
        git(dir, ['init', '-q', '.']);
        write(dir, 'home/claude-kit-doctrine.md', 'doctrine text here.\n');
        git(dir, ['add', '-A']);
        git(dir, ['commit', '-q', '-m', 'fixture']);
        assert.ok(!fs.existsSync(path.join(dir, 'test')), 'the fixture carries no test directory');

        const refused = runScript(['init', '--repo', dir]);
        assert.strictEqual(refused.status, 2, refused.stdout + refused.stderr);
        assert.match(refused.stderr, /names a directory that does not exist, so there is nowhere to write it/);
        assert.ok(!/does not resolve inside/.test(refused.stderr),
            'a missing directory is not reported as a link out of the checkout: ' + refused.stderr);
        // The control, withheld from the missing directory by creating it: the same
        // call once test/ exists writes the budget, so the refusal above is the absent
        // directory speaking.
        fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
    } finally {
        rmDir(dir);
    }
});

// A payload carrying scripts/ without hooks/ is a real state, and an unguarded
// require throws MODULE_NOT_FOUND at load, which exits 1: the code this tool reserves
// for a ratchet failure, so a broken payload would read as a corpus over its caps. A
// missing library is a run that could not produce a reading, which is exit 2.
test('a payload missing the hooks library refuses with a reading it could not take', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-payload-'));
    try {
        fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
        const lone = path.join(dir, 'scripts', 'kit-size.js');
        fs.copyFileSync(SCRIPT, lone);
        const spawn = (args) => spawnSync(process.execPath, [lone].concat(args), {
            cwd: os.tmpdir(),
            encoding: 'utf8',
            env: scriptEnv(),
            timeout: FIXTURE_GIT_TIMEOUT_MS
        });
        const refused = spawn(['check', '--repo', REPO, '--budget', BUDGET]);
        assert.strictEqual(refused.status, 2, refused.stdout + refused.stderr);
        assert.match(refused.stderr, /the require of .*did not return one/);
        assert.match(refused.stderr, /kit-git-lib/, 'the refusal names the module that would not load: ' + refused.stderr);
        assert.ok(!/of cap/.test(refused.stdout), 'no totals were printed: ' + refused.stdout);
        // The module surface takes the same refusal, and it is the surface that
        // matters here: the gate requires this script and calls its exports, so
        // without a guard at each function that reaches the library a hooks-less
        // payload fails with a TypeError from a null dereference rather than with the
        // reading it could not take.
        //
        // The closure is a predicate over the surface rather than a list of entry
        // points: the surface exports over forty names, and a list covers the sites
        // that happen to be on it while the sites nobody named are exactly the ones a
        // guard goes missing at. The predicate is every exported function whose own
        // source dereferences `libs`, matched on the shape of a dereference rather
        // than on the literal spelling `libs.`, since a bracket access or a
        // destructuring assignment is the same dereference and a pattern narrower
        // than its class goes quiet on it. The scope is the whole module surface.
        const DEREF = /\blibs\s*[.[]|=\s*libs\b/;
        const GUARD = /mustHaveLibs\s*\(/;
        // The control, run first, and withheld from the predicate's literals: three
        // functions built here that dereference in the three spellings and carry no
        // guard, matched on shape. They are never called, so the unbound name is a
        // source-level shape and nothing more. Without this half an empty unguarded
        // set below would be a pattern that matches nothing rather than a surface
        // that is covered.
        function controlDot() { return libs.gitOutput('x', []); }
        function controlBracket() { return libs['gitOutput']('x', []); }
        function controlDestructured() { const { gitOutput: g } = libs; return g; }
        function controlGuarded() { mustHaveLibs(); return libs.gitOutput('x', []); }
        for (const fn of [controlDot, controlBracket, controlDestructured, controlGuarded]) {
            assert.ok(DEREF.test(fn.toString()), 'the dereference predicate speaks against ' + fn.name);
        }
        assert.deepStrictEqual([controlDot, controlBracket, controlDestructured].filter((fn) => GUARD.test(fn.toString())), [],
            'an unguarded dereference is not read as guarded');
        assert.ok(GUARD.test(controlGuarded.toString()), 'the guard predicate speaks against a guarded dereference');

        const lonely = require(lone);
        const dereferencing = Object.keys(lonely)
            .filter((name) => typeof lonely[name] === 'function' && DEREF.test(lonely[name].toString()));
        const guarding = Object.keys(lonely)
            .filter((name) => typeof lonely[name] === 'function' && GUARD.test(lonely[name].toString()));
        // Both directions of one relation, derived on each side rather than counted: no
        // exported function dereferences without the guard, and none carries the guard
        // without dereferencing, so a guard that goes missing and a guard left behind
        // in a function that no longer reaches the library both red here.
        assert.deepStrictEqual(dereferencing.slice().sort(), guarding.slice().sort(),
            'the exported functions that dereference the hook libraries are exactly those that open with the guard');
        // What the predicate matched, stated rather than assumed: an empty unguarded set
        // means nothing if the set it was taken from is empty too.
        assert.ok(dereferencing.length > 0, 'the predicate reached the dereferencing surface');
        // And each of them refuses when called, which is what the guard is for. The
        // call takes no arguments, so a guard sitting anywhere but first would throw
        // something else and fail here.
        for (const name of dereferencing) {
            assert.throws(() => lonely[name](), /did not return one/,
                'a library-less entry point refuses rather than dereferencing null: ' + name);
        }
        // The three verbs are not in that class, since none dereferences the library
        // itself, and they are the entry points the gate calls: each reaches the class
        // one call down and carries the refusal out.
        for (const call of [
            () => lonely.check(REPO, BUDGET, REPO),
            () => lonely.report(REPO, BUDGET, REPO),
            () => lonely.initBudget(REPO, BUDGET, REPO)
        ]) {
            assert.throws(call, /did not return one/, 'a library-less verb refuses rather than dereferencing null');
        }
        // The control, withheld from the missing library by one directory: the same
        // copy beside a hooks directory runs, so the refusal is the absent payload
        // rather than a script that refuses wherever it sits.
        fs.cpSync(path.join(REPO, 'plugins', 'claude-kit', 'hooks'), path.join(dir, 'hooks'), { recursive: true });
        const ran = spawn(['report', '--repo', REPO, '--budget', BUDGET]);
        assert.strictEqual(ran.status, 0, ran.stdout + ran.stderr);
        assert.match(ran.stdout, /of cap/);
    } finally {
        rmDir(dir);
    }
});

// The home/ root end to end. The root is the directory rather than the doctrine copy
// alone, so the coverage control reaches everything under it: a file no shape
// measures reds instead of sitting outside every root, which is what a root naming
// one file leaves behind. The planted names appear in no pattern in the script and are
// matched on the shape of a nested file and a non-markdown one.
test('over a real repository a tracked file under home that no shape reaches reds unclassified', () => {
    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        // The control first: a second markdown file directly under home/ is measured,
        // so what reds below is the shape rather than the root.
        write(dir, 'home/CLAUDE.md', 'installed prose here.\n');
        git(dir, ['add', 'home/CLAUDE.md']);
        const missing = runScript(['check', '--repo', dir]);
        assert.strictEqual(missing.status, 1, missing.stdout + missing.stderr);
        assert.match(missing.stdout, /^missing-entry: home\/CLAUDE\.md: no cap in /m);
        git(dir, ['rm', '-q', '-f', 'home/CLAUDE.md']);

        write(dir, 'home/settings.json', '{}\n');
        write(dir, 'home/nested/deep.md', 'nested prose.\n');
        git(dir, ['add', 'home/settings.json', 'home/nested/deep.md']);
        const unclassified = runScript(['check', '--repo', dir]);
        assert.strictEqual(unclassified.status, 1, unclassified.stdout + unclassified.stderr);
        assert.match(unclassified.stdout, /^unclassified: home\/settings\.json: tracked under a measured root/m);
        assert.match(unclassified.stdout, /^unclassified: home\/nested\/deep\.md: tracked under a measured root/m);
    } finally {
        rmDir(dir);
    }
});

// A library that is present and will not load is not a payload missing one, and the
// refusal is worded around what the loader said for exactly that reason: reported as
// an absent library, a syntax error inside the hooks directory sends its reader
// looking for files that are sitting right there.
test('a hooks library that is present and will not load is named by what the loader said', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-broken-'));
    try {
        fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
        const lone = path.join(dir, 'scripts', 'kit-size.js');
        fs.copyFileSync(SCRIPT, lone);
        fs.cpSync(path.join(REPO, 'plugins', 'claude-kit', 'hooks'), path.join(dir, 'hooks'), { recursive: true });
        // The control first, with the library intact: the same copy in the same place
        // produces a reading, so the refusal below is the broken module speaking.
        const spawn = (args) => spawnSync(process.execPath, [lone].concat(args), {
            cwd: os.tmpdir(),
            encoding: 'utf8',
            env: scriptEnv(),
            timeout: FIXTURE_GIT_TIMEOUT_MS
        });
        const ran = spawn(['report', '--repo', REPO, '--budget', BUDGET]);
        assert.strictEqual(ran.status, 0, ran.stdout + ran.stderr);

        fs.writeFileSync(path.join(dir, 'hooks', 'kit-git-lib.js'), 'module.exports = {\n', 'utf8');
        const refused = spawn(['check', '--repo', REPO, '--budget', BUDGET]);
        assert.strictEqual(refused.status, 2, refused.stdout + refused.stderr);
        assert.match(refused.stderr, /did not return one/);
        // The loader's own words ride in the refusal, which is what tells this state
        // from an absent payload: the reader is told a module was there and would not
        // parse rather than told the payload does not carry one.
        assert.match(refused.stderr, /kit-git-lib/);
        assert.match(refused.stderr, /Unexpected|SyntaxError|Invalid/,
            'the refusal carries what the loader said: ' + refused.stderr);
        assert.ok(!/of cap/.test(refused.stdout), 'no totals were printed: ' + refused.stdout);
    } finally {
        rmDir(dir);
    }
});

// The scope line's own claim. A changed path on the named exclusion list is held by a
// measured root and reached by no shape, so it is in no row, in neither outside-root
// count, and in no total: with the trailing clause claiming every touched path was
// measured above, a changeset editing the budget was reported as a changeset touching
// nothing, which is exactly what a cap-raising audit is. The excluded term is what
// makes that silence legible, and the clause now prints only where both terms are
// empty.
test('the scope line gives a changed named-exclusion path its own term', () => {
    const sums = { words: { size: 1, cap: 1, files: 1, unreadable: 0 }, lines: { size: 1, cap: 1, files: 1, unreadable: 0 }, tests: 1 };
    // Both terms empty: the clause is earned and printed.
    const clean = kit.renderTotals(sums, { changed: 0, untracked: 0, excluded: [] });
    assert.match(clean[3], /so every path this changeset touches is measured above$/);
    // One excluded path in the changeset: it is named, and the clause is gone, since
    // that path is measured nowhere above.
    const withExcluded = kit.renderTotals(sums, { changed: 0, untracked: 0, excluded: ['test/size-budget.json'] });
    assert.match(withExcluded[3], /named-exclusion paths in the changeset: test\/size-budget\.json/);
    assert.ok(!/every path this changeset touches is measured above/.test(withExcluded[3]),
        'the clause does not ride beside a path nothing measured: ' + withExcluded[3]);
    // And the counts and the excluded list are separate terms rather than one number,
    // since a path outside every root and a path a root holds and no shape measures
    // are different findings about the reading's own reach.
    const both = kit.renderTotals(sums, { changed: 2, untracked: 1, excluded: ['test/size-budget.json'] });
    assert.match(both[3], /^changed paths under no measured root: 3 \(2 differing from HEAD, 1 untracked\).*; named-exclusion paths in the changeset: test\/size-budget\.json/);
});

// The same end to end, with the deleted case beside it. A deleted excluded path is in
// the HEAD diff and in no tracked listing, so the classifier's own excluded set no
// longer holds it: given the deleted branch's sentence it would read as a path no
// measured shape reaches, which is a fourth state's sentence on a fifth state. It gets
// no row at all, like every other excluded path, and the scope line is what names it.
test('over a real repository a changed or deleted named-exclusion path is named by the scope line and by no row', () => {
    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        git(dir, ['add', 'test/size-budget.json']);
        git(dir, ['commit', '-q', '-m', 'budget']);
        // The control first, with the budget committed and untouched: both terms are
        // empty and the closing clause prints, so what speaks below is the change to
        // that path rather than the term always naming it.
        const untouched = runScript(['report', '--repo', dir]);
        assert.strictEqual(untouched.status, 0, untouched.stderr);
        assert.match(untouched.stdout, /^changed paths under no measured root: none;.*so every path this changeset touches is measured above$/m);

        // An edited budget, which is what a cap raise is.
        const budgetFile = path.join(dir, 'test', 'size-budget.json');
        const budget = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
        budget['test/one.test.js'] = 900;
        fs.writeFileSync(budgetFile, kit.serializeBudget(budget), 'utf8');
        const edited = runScript(['report', '--repo', dir]);
        assert.strictEqual(edited.status, 0, edited.stderr);
        assert.match(edited.stdout, /^changed paths under no measured root: none;.*named-exclusion paths in the changeset: test\/size-budget\.json/m);
        assert.ok(!/^test\/size-budget\.json:/m.test(edited.stdout), 'the excluded path gets no row: ' + edited.stdout);
        assert.deepStrictEqual(kit.outsideRootCounts(dir).excluded, ['test/size-budget.json']);

        // And deleted. The rows are read in process, since the budget the verbs read
        // is the file being deleted: what is under test is the row list rather than a
        // cap.
        git(dir, ['rm', '-q', '-f', 'test/size-budget.json']);
        git(dir, ['rm', '-q', '-f', 'test/one.test.js']);
        const collected = kit.collect(dir);
        const read = kit.reportRows(dir, collected.measured, collected.excluded, collected.unclassified, kit.untrackedPaths(dir));
        assert.ok(!read.rows.some((r) => r.path === 'test/size-budget.json'),
            'a deleted excluded path gets no row at all: ' + JSON.stringify(read.rows));
        // The control, withheld from the exclusion list by being measured content: a
        // measured file deleted in the same changeset does get its deleted row, so the
        // absence above is the exclusion speaking rather than the deleted branch
        // having stopped producing rows.
        assert.deepStrictEqual(read.rows.filter((r) => r.path === 'test/one.test.js').map((r) => r.headState), ['deleted']);
        assert.deepStrictEqual(kit.outsideRootCounts(dir).excluded, ['test/size-budget.json']);
    } finally {
        rmDir(dir);
    }
});

// A path removed from the index and left on disk is one path that git reports twice,
// as deleted by the HEAD diff and as untracked by the listing. Counted in both it is
// two paths, and given the deleted row it carries HEAD's whole size as a negative
// delta: a cut that did not happen to a file that is still there, which is the one
// direction this reading must never fabricate.
test('over a real repository a path removed from the index and left in the worktree is counted once and given no cut', () => {
    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        // The control first, before the removal: no row for either path and neither
        // counted outside the roots.
        const before = runScript(['report', '--repo', dir]);
        assert.strictEqual(before.status, 0, before.stderr);
        assert.ok(!/^test\/one\.test\.js/m.test(before.stdout), before.stdout);
        assert.deepStrictEqual(kit.outsideRootCounts(dir), { changed: 0, untracked: 0, excluded: ['test/size-budget.json'] });

        git(dir, ['rm', '-q', '--cached', 'test/one.test.js']);
        git(dir, ['rm', '-q', '--cached', 'README.md']);
        assert.ok(fs.existsSync(path.join(dir, 'test', 'one.test.js')), 'the removal left the file on disk');

        const shown = runScript(['report', '--repo', dir]);
        assert.strictEqual(shown.status, 0, shown.stderr);
        const rows = shown.stdout.split(/\r?\n/).filter((l) => l.startsWith('test/one.test.js'));
        assert.strictEqual(rows.length, 2, shown.stdout);
        assert.match(rows[0], /^test\/one\.test\.js: removed from the index.*cap 2/);
        assert.ok(!/[-+]\d/.test(rows[0]), 'the row carries no delta at all: ' + rows[0]);
        // The second line is the untracked row, which is where the file's live size
        // belongs: the reading says what is there rather than inventing what left.
        assert.match(rows[1], /^test\/one\.test\.js: 2 lines, cap 2, untracked/);
        // The row state is read as the field it is, so the sentence stays free to
        // improve, and no HEAD size rides on it.
        const removed = kit.report(dir, path.join(dir, 'test', 'size-budget.json')).rows
            .filter((r) => r.path === 'test/one.test.js');
        assert.deepStrictEqual(removed.map((r) => r.headState), ['index-removed']);
        assert.strictEqual(removed[0].headSize, null);
        // README.md sits under no measured root and is now in both git listings, so it
        // is the half the scope count would have counted twice.
        assert.deepStrictEqual(kit.outsideRootCounts(dir), { changed: 0, untracked: 1, excluded: ['test/size-budget.json'] });
        assert.match(shown.stdout, /^changed paths under no measured root: 1 \(0 differing from HEAD, 1 untracked\)/m);
    } finally {
        rmDir(dir);
    }
});

// A rename is the shape rename detection hides: on by default it prints the
// destination alone, so the source reaches no listing this tool reads, no row, and no
// deletion, while the destination renders as new since HEAD carrying the file's whole
// size. That is a +N with no -N beside it at exit 0, in the output a Chapter quotes as
// its section's delta. `--no-renames` is what makes the pair two entries.
test('over a real repository a renamed measured file reports both sides rather than growth alone', () => {
    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        git(dir, ['mv', 'test/one.test.js', 'test/renamed.test.js']);

        // The mechanism, so the rows below are read for what they are: with detection
        // on the diff names the destination alone, and with it off it names both.
        const detected = gitTry(dir, ['diff', '--name-only', 'HEAD', '--']).stdout.split(/\r?\n/).filter((l) => l !== '');
        assert.deepStrictEqual(detected, ['test/renamed.test.js'],
            'rename detection prints the destination alone: ' + JSON.stringify(detected));
        assert.deepStrictEqual(kit.changedPaths(dir).sort(), ['test/one.test.js', 'test/renamed.test.js']);

        const shown = runScript(['report', '--repo', dir]);
        assert.strictEqual(shown.status, 0, shown.stderr);
        // The deletion the rename is, with its negative delta, beside the destination's
        // growth: the arithmetic comes out where a rename's own delta belongs.
        assert.match(shown.stdout, /^test\/one\.test\.js: deleted, cap 2, HEAD held 2 lines, -2/m);
        assert.match(shown.stdout, /^test\/renamed\.test\.js: 2 lines, no cap, new since HEAD$/m);
    } finally {
        rmDir(dir);
    }
});

// The scope reading's own arguments. Its sibling listing ends its options with `--`
// and this one did not, so a repository holding a path named HEAD made the argument
// ambiguous, git answered nothing, and the whole verb degraded on a file name.
test('a repository holding a path named HEAD does not make the scope reading ambiguous', () => {
    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        write(dir, 'HEAD', 'a worktree file that is also a revision name.\n');

        // The control, run first: without the separator git refuses the argument
        // outright, which is the state this reading used to be in.
        const ambiguous = gitTry(dir, ['diff', '--name-only', '--no-renames', '-z', 'HEAD']);
        assert.notStrictEqual(ambiguous.status, 0, 'the separator-less form is refused: ' + ambiguous.stdout);
        assert.match(ambiguous.stderr, /ambiguous argument/);

        // With it the reading answers, and the path is counted as the untracked path
        // outside every measured root that it is.
        assert.deepStrictEqual(kit.outsideRootCounts(dir), { changed: 0, untracked: 1, excluded: ['test/size-budget.json'] });
        const shown = runScript(['report', '--repo', dir]);
        assert.strictEqual(shown.status, 0, shown.stderr);
        assert.match(shown.stdout, /^changed paths under no measured root: 1 \(0 differing from HEAD, 1 untracked\)/m);
    } finally {
        rmDir(dir);
    }
});

// The scope counts are an addition to a reading whose rows and totals stand without
// them, so a git failure there costs that one line and says so. Refusing the verb
// instead would cost the whole reading a Chapter is about to record, over a count that
// is scope rather than measurement.
test('a scope reading git could not take degrades one line rather than the verb', () => {
    const sums = { words: { size: 1, cap: 1, files: 1, unreadable: 0 }, lines: { size: 1, cap: 1, files: 1, unreadable: 0 }, tests: 1 };
    const degraded = kit.renderTotals(sums, { unavailable: 'the unfiltered git listings returned nothing usable' });
    assert.strictEqual(degraded.length, 4);
    assert.match(degraded[3], /^changed paths under no measured root: unavailable, the unfiltered git listings returned nothing usable, so this reading says nothing about/);
    // The totals themselves are untouched, which is the point of degrading one line.
    assert.match(degraded[0], /^words: 1 of cap 1 across 1 curated files$/);

    // And end to end, against the git failure that actually produces it: the scope
    // listings are unfiltered, so a tree carrying enough untracked paths outside the
    // measured roots pushes that one call past the shared runner's output ceiling
    // while every filtered listing stays small. The file count is derived from the
    // ceiling rather than named, so a raised ceiling does not leave this case quietly
    // exercising nothing.
    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        // The control first: the scope line is a reading before the bulk lands.
        assert.match(runScript(['report', '--repo', dir]).stdout, /^changed paths under no measured root: none;/m);

        const bulk = path.join(dir, 'bulk');
        fs.mkdirSync(bulk, { recursive: true });
        const name = 'n'.repeat(200);
        let bytes = 0;
        let n = 0;
        while (bytes <= MAX_OUTPUT_BYTES + 4096) {
            const rel = 'bulk/' + name + String(n).padStart(6, '0');
            fs.writeFileSync(path.join(dir, rel), '', 'utf8');
            bytes += Buffer.byteLength(rel, 'utf8') + 1;
            n += 1;
        }
        // The mechanism, read directly: the unfiltered listing is past the ceiling and
        // so answers nothing, while the listing filtered to the measured roots is
        // small and answers normally.
        assert.strictEqual(kit.outsideRootCounts(dir), null);
        assert.ok(kit.untrackedPaths(dir).length < 10, 'the filtered listing is unaffected');

        const shown = runScript(['report', '--repo', dir]);
        assert.strictEqual(shown.status, 0, shown.stdout + shown.stderr);
        assert.match(shown.stdout, /^changed paths under no measured root: unavailable, the unfiltered git listings returned nothing usable/m);
        // The rest of the reading is whole: the totals printed and the verb did not
        // refuse.
        assert.match(shown.stdout, /^words: 16 of cap 16 across 5 /m);
        assert.match(shown.stdout, /^tests: 2$/m);
    } finally {
        rmDir(dir);
    }
});

// Every changed row costs up to two git spawns and nothing bounds how many paths a
// changeset holds, which was self-limiting while this tool measured one repository by
// hand and is not, now that a Chapter's Delta field has every leashed run invoke this
// verb over whatever its section touched. The bound is on the changed paths read, and
// the reading says it was bounded rather than printing a short list that reads as the
// whole one.
test('the report bounds its row list and says the reading was bounded', () => {
    const sums = { words: { size: 0, cap: 0, files: 0, unreadable: 0 }, lines: { size: 5, cap: 5, files: 1, unreadable: 0 }, tests: 1 };
    const notice = kit.renderReport([], sums, {}, [], [], null, 7);
    assert.match(notice[0], new RegExp('bounded at ' + kit.MAX_REPORT_ROWS + ' entries'));
    assert.match(notice[0], /7 further entries are not named$/);
    // The control, withheld by having nothing omitted: no notice at all, so an empty
    // line cannot read as a bound that fired.
    assert.strictEqual(kit.renderReport([], sums, {}, [], [], null, 0).length, 3);

    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        // One path past the bound, planted as tracked files no shape measures, which
        // cost no HEAD read: what is under test is the bound on the changed paths
        // rather than the cost of any one row.
        const planted = kit.MAX_REPORT_ROWS + 1;
        for (let i = 0; i < planted; i += 1) {
            write(dir, 'test/bulk-' + String(i).padStart(4, '0') + '.js', 'module.exports = {};\n');
        }
        // Only the planted files are staged, so the changed count is exactly the
        // number planted: staging the directory would sweep the untracked budget in
        // beside them and the omitted count would be about two paths rather than one.
        const paths = [];
        for (let i = 0; i < planted; i += 1) paths.push('test/bulk-' + String(i).padStart(4, '0') + '.js');
        git(dir, ['add', '--'].concat(paths));
        assert.strictEqual(kit.changedPaths(dir).length, planted, 'exactly the planted paths are changed');
        const shown = runScript(['report', '--repo', dir]);
        assert.strictEqual(shown.status, 0, shown.stdout + shown.stderr);
        const rows = shown.stdout.split(/\r?\n/).filter((l) => /^test\/bulk-/.test(l));
        assert.strictEqual(rows.length, kit.MAX_REPORT_ROWS, 'the row list stops at the bound');
        assert.match(shown.stdout, new RegExp('^the changed-path list is bounded at ' + kit.MAX_REPORT_ROWS
            + ' entries, and ' + (planted - kit.MAX_REPORT_ROWS) + ' further entry is not named$', 'm'));
        // The totals are still printed, so the bound cuts the row list rather than the
        // reading.
        assert.match(shown.stdout, /^tests: 2$/m);
    } finally {
        rmDir(dir);
    }
});

// A project whose measured files are all untracked has a corpus: a first commit not
// yet made, or the first file under a newly added root. Refused as an empty corpus,
// the reading claims an emptiness the tree does not have, and `report` would have
// named every one of those files.
test('a project whose only measured file is untracked has a corpus rather than an empty one', () => {
    // The refusal itself, driven directly: the untracked measured set counts toward
    // the corpus, and the blind reason still takes precedence over both.
    assert.strictEqual(kit.unmeasuredRefusal({ measured: [], blind: [] }, 'no cap was tested', ['test/one.test.js']), null);
    assert.match(kit.unmeasuredRefusal({ measured: [], blind: [] }, 'no cap was tested', []).detail,
        /no untracked file a measured shape reaches was found either/);
    assert.match(kit.unmeasuredRefusal({ measured: [], blind: ['TEST/one.test.js'] }, 'x', ['test/one.test.js']).detail,
        /hidden from the classifier rather than empty/);
    // The classifier decides which untracked paths count, so a path no shape reaches
    // is not a corpus.
    assert.deepStrictEqual(kit.untrackedMeasuredPaths(['test/one.test.js', 'test/helpers/x.js', 'test/size-budget.json', 'README.md']),
        ['test/one.test.js']);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-firstfile-'));
    try {
        git(dir, ['init', '-q', '.']);
        write(dir, 'README.md', 'outside every measured root.\n');
        git(dir, ['add', '-A']);
        git(dir, ['commit', '-q', '-m', 'fixture']);
        write(dir, 'test/size-budget.json', kit.serializeBudget({ 'test/one.test.js': 40 }));
        write(dir, 'test/one.test.js', "test('a', () => {});\n");

        // `report` produces a reading and names the file, where it used to refuse on a
        // corpus it called empty.
        const shown = runScript(['report', '--repo', dir]);
        assert.strictEqual(shown.status, 0, shown.stdout + shown.stderr);
        assert.match(shown.stdout, /^test\/one\.test\.js: 1 lines, cap 40, untracked so HEAD holds no blob/m);
        // `check` still refuses, and on the rule that is true of this tree: every cap
        // is pending, so nothing would catch a cap left behind by a deletion, while
        // each pending cap is compared to its own file.
        const checked = runScript(['check', '--repo', dir]);
        assert.strictEqual(checked.status, 2, checked.stdout + checked.stderr);
        assert.match(checked.stderr, /every cap in the budget is pending/);
        assert.ok(!/the corpus is empty rather than hidden/.test(checked.stderr),
            'a tree holding an untracked measured file is not reported as an empty corpus: ' + checked.stderr);

        // The control, withheld by one file: with the untracked measured file gone the
        // corpus really is empty and both verbs say so.
        fs.rmSync(path.join(dir, 'test', 'one.test.js'));
        assert.match(runScript(['report', '--repo', dir]).stderr, /the corpus is empty rather than hidden/);
        assert.match(runScript(['check', '--repo', dir]).stderr, /the corpus is empty rather than hidden/);
    } finally {
        rmDir(dir);
    }
});

// init takes the same no-corpus refusal both reading verbs take. Without it a project
// holding nothing under the six roots gets an empty budget written and a success
// reported, and every later run over that file refuses on a budget holding no cap.
test('init refuses a project holding nothing under the measured roots rather than writing an empty budget', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-nocorpus-'));
    try {
        git(dir, ['init', '-q', '.']);
        write(dir, 'README.md', 'outside every measured root.\n');
        write(dir, 'docs/plans/whatever.md', 'also outside every measured root.\n');
        git(dir, ['add', '-A']);
        git(dir, ['commit', '-q', '-m', 'fixture']);
        fs.mkdirSync(path.join(dir, 'test'), { recursive: true });

        const refused = runScript(['init', '--repo', dir]);
        assert.strictEqual(refused.status, 2, refused.stdout + refused.stderr);
        assert.match(refused.stderr, /measured no file at all under the measured roots.*there would be no cap to write/);
        assert.ok(!fs.existsSync(path.join(dir, 'test', 'size-budget.json')), 'the refusal wrote no budget');

        // The control, withheld from the refusal by one measured file: the same call
        // over a tree holding one writes the budget, so the refusal is the empty corpus
        // speaking rather than init refusing every project.
        write(dir, 'test/one.test.js', "test('a', () => {});\n");
        git(dir, ['add', 'test/one.test.js']);
        git(dir, ['commit', '-q', '-m', 'one']);
        const wrote = runScript(['init', '--repo', dir]);
        assert.strictEqual(wrote.status, 0, wrote.stdout + wrote.stderr);
        assert.match(wrote.stdout, /wrote 1 caps/);
    } finally {
        rmDir(dir);
    }
});

// A delta of zero is a number this reading has: a file whose size held while its test
// count moved, and a deleted empty file. Rendered bare, the zero reads as an absent
// field beside its signed neighbours, and a reader of a deletion audit's own reading
// cannot tell a size that held from a size nobody took.
test('a zero delta is signed like every other', () => {
    const sums = { words: { size: 0, cap: 0, files: 0, unreadable: 0 }, lines: { size: 5, cap: 5, files: 1, unreadable: 0 }, tests: 1 };
    const held = kit.renderReport([
        { path: 'test/one.test.js', metric: 'lines', size: 200, tests: 8, headState: 'changed', headSize: 200, headTests: 9 }
    ], sums, { 'test/one.test.js': 200 });
    assert.match(held[0], /^test\/one\.test\.js: 200 lines, cap 200, \+0; tests 8, -1$/);
    const empty = kit.renderReport([
        { path: 'test/gone.test.js', metric: 'lines', size: null, tests: null, headState: 'deleted', headBlobState: 'changed', headSize: 0, headTests: 0 }
    ], sums, { 'test/gone.test.js': 0 });
    assert.match(empty[0], /^test\/gone\.test\.js: deleted, cap 0,.*\+0; tests at HEAD 0, \+0$/);
    // The signs either side of zero are unchanged, so the rule is that a delta always
    // carries its sign rather than that zero is special.
    assert.match(kit.renderReport([
        { path: 'test/one.test.js', metric: 'lines', size: 201, tests: 8, headState: 'changed', headSize: 200, headTests: 8 }
    ], sums, {})[0], /\+1; tests 8, \+0$/);
});

// One helper owns the environment every git invocation in this file runs under, and
// the three home keys are the load-bearing half: git resolves its default excludes
// path from XDG_CONFIG_HOME or HOME, which suppressing global and system config does
// not touch, so a fixture build left on this machine's environment has `git add -A`
// silently drop an ignored path and `git add <paths>` exit 1 on one. The keys are
// asserted at the helper rather than at a list of call sites, since a site nobody
// named is exactly what a list misses.
test('one helper owns the git environment every invocation here runs under', () => {
    const probe = path.join(os.tmpdir(), 'kit-size-env-probe');
    const fixture = gitEnv();
    const script = scriptEnv();
    const home = isolationHome();
    for (const env of [fixture, script]) {
        assert.strictEqual(env.HOME, home);
        assert.strictEqual(env.USERPROFILE, home);
        assert.strictEqual(env.XDG_CONFIG_HOME, path.join(home, 'xdg'));
        // Inherited from the runner's own gitChildEnv rather than set here, and
        // asserted so the reuse cannot silently become a copy that drifted.
        assert.strictEqual(env.GIT_TERMINAL_PROMPT, gitChildEnv().GIT_TERMINAL_PROMPT);
        assert.strictEqual(env.NoDefaultCurrentDirectoryInExePath, gitChildEnv().NoDefaultCurrentDirectoryInExePath);
        // Both config files sit inside the isolation home at both call sites, never
        // inside a directory a case is measuring: the safe property is the mkdtemp'd
        // home rather than what any one case happens to write into its fixture.
        assert.strictEqual(env.GIT_CONFIG_GLOBAL, path.join(home, 'absent.gitconfig'));
        assert.strictEqual(env.GIT_CONFIG_SYSTEM, path.join(home, 'absent.gitconfig'));
        // Every GIT_* key the machine carried is gone, and what is left is this
        // helper's own set, matched on the shape of the prefix rather than on a list of
        // the variables a session might be carrying.
        const gitKeys = Object.keys(env).filter((k) => /^GIT_/i.test(k)).sort();
        assert.deepStrictEqual(gitKeys, ['GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_NAME', 'GIT_COMMITTER_EMAIL',
            'GIT_COMMITTER_NAME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_TERMINAL_PROMPT']);
    }
    // The named home is a case's own override, which is what keeps the one case that
    // plants an excludes file out of the shared directory.
    const owned = scriptEnv(probe);
    assert.strictEqual(owned.HOME, probe);
    assert.strictEqual(owned.XDG_CONFIG_HOME, path.join(probe, 'xdg'));
    // The config files follow that home rather than staying in the shared one, so an
    // overriding case is isolated in the same one place.
    assert.strictEqual(owned.GIT_CONFIG_GLOBAL, path.join(probe, 'absent.gitconfig'));
    // One residue this file cannot close, stated rather than implied by the keys
    // above: the shared runner strips every GIT_* key from the child it spawns, so
    // GIT_CONFIG_SYSTEM reaches the direct fixture spawns alone and system
    // configuration is read by every in-process reading here.
    assert.ok(!Object.prototype.hasOwnProperty.call(gitChildEnv(), 'GIT_CONFIG_SYSTEM'),
        'the runner strips the variable that would suppress system configuration');
    // And the in-process readings, which run git through the shared runner in this
    // process's own environment and reach no per-call env at all: the same redirect is
    // on process.env, so `untracked` means the same thing in both classes.
    assert.strictEqual(process.env.HOME, home);
    assert.strictEqual(process.env.USERPROFILE, home);
    assert.strictEqual(process.env.XDG_CONFIG_HOME, path.join(home, 'xdg'));
});

// The scope line's closing clause claims every path this changeset touches was
// measured above, and the counts beside it cannot see the rows: a reading can hold a
// changed path that nothing measured while both counts are zero. Three states reach
// it, all ordinary, and a fourth is a bounded list, whose unnamed members are
// measured nowhere in the output either.
test('the scope line does not claim every path was measured while a row names none', () => {
    const sums = { words: { size: 1, cap: 1, files: 1, unreadable: 0 }, lines: { size: 1, cap: 1, files: 1, unreadable: 0 }, tests: 1 };
    const scope = { changed: 0, untracked: 0, excluded: [] };
    const clause = /every path this changeset touches is measured above/;
    // The control first, and it is the row half rather than the count half: a changed
    // file whose size read, with both counts empty, earns the clause. Without this the
    // absences below would pass on a clause that had stopped printing at all.
    const measured = kit.renderReport([
        { path: 'test/one.test.js', metric: 'lines', size: 12, tests: 2, headState: 'changed', headSize: 10, headTests: 2 }
    ], sums, { 'test/one.test.js': 20 }, [], [], scope, 0);
    assert.ok(clause.test(measured[measured.length - 1]), measured.join('\n'));
    // A changed tracked path a root holds and no shape reaches.
    const unmeasured = kit.renderReport([
        { path: 'test/helpers/fixture-builder.js', metric: null, size: null, tests: null, headState: 'unmeasured', headSize: null, headTests: null }
    ], sums, {}, [], [], scope, 0);
    assert.ok(!clause.test(unmeasured.join('\n')), unmeasured.join('\n'));
    // A changed measured file whose worktree content the reader would not hand over.
    const unreadable = kit.renderReport([
        { path: 'test/one.test.js', metric: 'lines', size: null, tests: null, headState: 'worktree-unreadable', headSize: null, headTests: null }
    ], sums, { 'test/one.test.js': 20 }, [], [], scope, 0);
    assert.ok(!clause.test(unreadable.join('\n')), unreadable.join('\n'));
    // A changeset past the row bound, where the notice says how many paths are not
    // named: those paths are measured nowhere in this reading.
    const bounded = kit.renderReport([
        { path: 'test/one.test.js', metric: 'lines', size: 12, tests: 2, headState: 'changed', headSize: 10, headTests: 2 }
    ], sums, { 'test/one.test.js': 20 }, [], [], scope, 3);
    assert.ok(!clause.test(bounded.join('\n')), bounded.join('\n'));
    // And a deletion whose HEAD size never read, which is the same silence from the
    // other direction: the path is in the changeset and no size is printed for it.
    const goneUnread = kit.renderReport([
        { path: 'test/gone.test.js', metric: 'lines', size: null, tests: null, headState: 'deleted', headBlobState: 'head-unknown', headSize: null, headTests: null }
    ], sums, { 'test/gone.test.js': 20 }, [], [], scope, 0);
    assert.ok(!clause.test(goneUnread.join('\n')), goneUnread.join('\n'));
});

// The index-removed row promises the worktree size is named among the untracked
// files below, and that promise is only true where a shape reaches the path: git
// reports a path removed from the index and left on disk in both listings, and where
// no shape measures it the untracked line below names no size at all.
test('an index-removed row promises a worktree size only where one is named below', () => {
    const sums = { words: { size: 1, cap: 1, files: 1, unreadable: 0 }, lines: { size: 1, cap: 1, files: 1, unreadable: 0 }, tests: 1 };
    const row = { path: 'test/one.test.js', metric: null, size: null, tests: null, headState: 'index-removed', headSize: null, headTests: null };
    // The control first: with the untracked row carrying a size, the promise is kept
    // and printed.
    const named = kit.renderReport([row], sums, {}, [{ path: 'test/one.test.js', metric: 'lines', size: 2, tests: 1 }], [], null, 0);
    assert.match(named[0], /its worktree size is named among the untracked files below/);
    // And where no shape reaches the path, the untracked line below names no size, so
    // the row says that instead of promising one.
    const unnamed = kit.renderReport([row], sums, {}, [{ path: 'test/one.test.js', metric: null, size: null, tests: null }], [], null, 0);
    assert.ok(!/its worktree size is named among the untracked files below/.test(unnamed[0]), unnamed[0]);
    assert.match(unnamed[0], /no measured shape reaches it/);
});

// Every path this tool prints is spelled relative to the repository under
// measurement, and the screen sits at the write rather than in one sentence: the
// refusals and details are assembled in a dozen places, and a screen bound to one of
// them leaves its siblings carrying the operator's user name into a plan doc.
test('a printed sentence is spelled relative to the repository, wherever it was assembled', () => {
    const repo = process.platform === 'win32' ? 'D:\\checkout\\kit' : '/home/someone/kit';
    const inside = path.join(repo, 'test', 'size-budget.json');
    // Three sentence shapes this tool prints a path in: a refusal naming a path, an
    // error text quoting one, and a detail naming the repository itself.
    assert.strictEqual(kit.repoRelativeText(repo, 'no size budget exists at ' + inside),
        'no size budget exists at test/size-budget.json');
    assert.match(kit.repoRelativeText(repo, "EACCES: permission denied, open '" + inside + "'"),
        /open 'test\/size-budget\.json'$/);
    // The repository's own top level has no relative spelling and is left as it
    // stands, which is what the subject line prints.
    assert.strictEqual(kit.repoRelativeText(repo, 'git ls-files returned nothing usable for ' + repo),
        'git ls-files returned nothing usable for ' + repo);
    // A path outside the repository stays as it was given, since a relative spelling
    // of it means nothing.
    const outside = path.join(path.dirname(repo), 'elsewhere', 'size-budget.json');
    assert.ok(kit.repoRelativeText(repo, 'no size budget exists at ' + outside).includes(outside));
    // Git prints forward slashes while path.resolve prints the platform separator, so
    // both spellings of the root are respelled.
    assert.strictEqual(kit.repoRelativeText(repo, repo.split(path.sep).join('/') + '/test/one.test.js'), 'test/one.test.js');
    // The predicate that decides a path is inside is the sibling containment rule
    // rather than a two-dot prefix test: a first segment merely opening with two dots
    // resolves inside the repository and has an honest relative spelling.
    assert.strictEqual(kit.repoRelative(repo, path.join(repo, '..hidden', 'x.md')), '..hidden/x.md');
    // The control on that predicate, withheld from it by one directory level: a
    // sibling of the repository really is outside and stays as it was given.
    assert.strictEqual(kit.repoRelative(repo, path.join(repo, '..', 'sibling.md')), path.join(repo, '..', 'sibling.md'));
});

// The same screen end to end, at the boundary rather than in one sentence: a refusal
// assembled inside the budget read carries the path it resolved, and nothing in that
// function knows the repository it is about.
test('over a real repository a budget refusal names its path relative to the repository', () => {
    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        const absent = path.join(dir, 'nope', 'size-budget.json');
        const refused = runScript(['report', '--repo', dir, '--budget', absent]);
        assert.strictEqual(refused.status, 2, refused.stdout + refused.stderr);
        assert.match(refused.stderr, /no size budget exists at nope\/size-budget\.json/);
        assert.ok(!refused.stderr.includes(dir), 'the refusal carries no checkout path: ' + refused.stderr);
        // The control, withheld from the relative spelling by sitting outside the
        // repository: a budget an operator names elsewhere has no relative spelling that
        // means anything, so it stays as it was given.
        const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-elsewhere-'));
        try {
            const named = runScript(['report', '--repo', dir, '--budget', path.join(outsideDir, 'size-budget.json')]);
            assert.strictEqual(named.status, 2, named.stdout + named.stderr);
            assert.ok(named.stderr.includes(outsideDir), 'a budget outside the repository is named as it was given: ' + named.stderr);
        } finally {
            rmDir(outsideDir);
        }
    } finally {
        rmDir(dir);
    }
});

// Every list this reading prints is bounded, because nothing bounds how many paths a
// changeset holds, how many untracked files sit under a measured root, or how many
// tracked paths a pathspec listing missed, and this output is quoted whole into a
// plan-doc Chapter, where a list cut short and left silent reads as the whole list.
test('the untracked rows, the blind paths and the hidden-corpus refusal take the row bound', () => {
    const sums = { words: { size: 1, cap: 1, files: 1, unreadable: 0 }, lines: { size: 1, cap: 1, files: 1, unreadable: 0 }, tests: 1 };
    const many = (prefix, n) => Array.from({ length: n }, (_, i) => prefix + String(i).padStart(5, '0') + '.test.js');
    const untracked = many('test/u-', kit.MAX_REPORT_ROWS + 3).map((p) => ({ path: p, metric: 'lines', size: 1, tests: 1 }));
    const blind = many('TEST/b-', kit.MAX_REPORT_ROWS + 2);
    const printed = kit.renderReport([], sums, {}, untracked, blind, null, 0);
    assert.strictEqual(printed.filter((l) => /^test\/u-/.test(l)).length, kit.MAX_REPORT_ROWS, 'the untracked list stops at the bound');
    assert.strictEqual(printed.filter((l) => /^TEST\/b-/.test(l)).length, kit.MAX_REPORT_ROWS, 'the blind list stops at the bound');
    assert.ok(printed.some((l) => /^the untracked-path list is bounded/.test(l) && / 3 further entries are not named$/.test(l)), printed.join('\n'));
    assert.ok(printed.some((l) => /^the pathspec-blind path list is bounded/.test(l) && / 2 further entries are not named$/.test(l)), printed.join('\n'));
    // The trailing exclusion line names what the rows named and no more, so it cannot
    // read as a complete list beside a bounded one.
    const trailing = printed.filter((l) => /^excluded from those totals/.test(l));
    assert.strictEqual(trailing.length, 1);
    assert.strictEqual((trailing[0].match(/test[/]u-/g) || []).length, kit.MAX_REPORT_ROWS);
    // The control, withheld from the bound by length: a short list of each prints
    // whole and prints no notice, so the notices above are the bound speaking.
    const short = kit.renderReport([], sums, {}, untracked.slice(0, 2), blind.slice(0, 2), null, 0);
    assert.strictEqual(short.filter((l) => /list is bounded/.test(l)).length, 0, short.join('\n'));
    // The refusal shared by both reading verbs carries the same bound, on the same
    // sentence, while its count stays the whole count.
    const hidden = kit.unmeasuredRefusal({ measured: [], blind }, 'no cap was tested');
    assert.match(hidden.detail, new RegExp(blind.length + ' tracked paths a root holds were absent'));
    assert.strictEqual((hidden.detail.match(/TEST[/]b-/g) || []).length, kit.MAX_REPORT_ROWS);
    assert.match(hidden.detail, /the pathspec-blind path list is bounded at .* 2 further entries are not named$/);
    // The control: a refusal naming few paths names them all and adds no notice.
    const fewHidden = kit.unmeasuredRefusal({ measured: [], blind: blind.slice(0, 2) }, 'no cap was tested');
    assert.ok(!/list is bounded/.test(fewHidden.detail), fewHidden.detail);
    // And the bound is one helper rather than four, so the four lists cannot drift.
    assert.deepStrictEqual(kit.boundList(['a', 'b']), { shown: ['a', 'b'], omitted: 0 });
    assert.strictEqual(kit.boundList(many('test/x-', kit.MAX_REPORT_ROWS + 5)).omitted, 5);
});

// A reading says what it measured and, without this line, never which repository it
// measured. The default subject is derived from where the script sits, which under a
// marketplace install is that marketplace's own clone of this repository, so a call
// with no --repo there finds a budget and a corpus and prints a plausible green
// reading about a tree nobody asked about.
test('both reading verbs name the repository they measured on the reading first line', () => {
    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        for (const verb of ['check', 'report']) {
            const shown = runScript([verb, '--repo', dir]);
            assert.strictEqual(shown.status, 0, shown.stdout + shown.stderr);
            const lines = shown.stdout.split(/\r?\n/).filter((l) => l !== '');
            assert.strictEqual(lines[0], 'repository: ' + path.basename(dir), verb + ': ' + shown.stdout);
            // The directory name rather than the path: every line of this reading lands
            // in a fenced block inside a tracked plan doc, so no line of it carries the
            // layout the reading was taken from.
            assert.strictEqual(lines.filter((l) => l.includes(dir)).length, 0, verb + ': ' + shown.stdout);
        }
        // The default subject is this script's own checkout three levels up from its
        // directory, which is what makes the line worth printing: the reading names it
        // rather than leaving a reader to derive it.
        assert.ok(kit.samePath(kit.defaultRepoDir(), REPO));
    } finally {
        rmDir(dir);
    }
});

// A budget named directly at the repository top level is inside the repository, and
// the shared containment helper does not admit a path equal to its own root, so
// checked through it the write was refused with a sentence that was false about the
// path it named.
test('init admits a budget named at the repository top level and still refuses one outside', () => {
    const nested = makeNestedFixtureRepo();
    try {
        const atRoot = path.join(nested.dir, 'size-budget.json');
        const wrote = runScript(['init', '--repo', nested.dir, '--budget', atRoot]);
        assert.strictEqual(wrote.status, 0, wrote.stdout + wrote.stderr);
        assert.ok(fs.existsSync(atRoot), 'the budget was written at the repository top level');
        // The control, withheld from the admission by one directory level: the parent
        // of the repository is outside it and stays refused, so the admission above is
        // the root case rather than containment having stopped binding the write.
        const outside = path.join(nested.parent, 'size-budget.json');
        const refused = runScript(['init', '--repo', nested.dir, '--budget', outside]);
        assert.strictEqual(refused.status, 2, refused.stdout + refused.stderr);
        assert.match(refused.stderr, /does not resolve inside/);
        assert.ok(!fs.existsSync(outside), 'the refusal wrote no file outside the repository');
    } finally {
        rmDir(nested.parent);
    }
});

// The loader refusal is the one message assembled before the screen's own library is
// there to apply it, so it applies the destination's rules inline. The destination is
// a fenced block inside a plan-doc Chapter, where a backtick closes the fence early
// and drops the rest of the line into the document as prose, and the loader message
// carries a payload path this tool did not choose.
test('the loader refusal strips what the fenced destination cannot carry', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-fence-'));
    try {
        // The payload directory carries a fence-closing character in its own name,
        // which the loader message then quotes in its require stack: the name is
        // withheld from every pattern in the script and matched on that shape.
        const payload = path.join(dir, 'pay' + String.fromCharCode(96) + 'load', 'scripts');
        fs.mkdirSync(payload, { recursive: true });
        const lone = path.join(payload, 'kit-size.js');
        fs.copyFileSync(SCRIPT, lone);
        const refused = spawnSync(process.execPath, [lone, 'check', '--repo', REPO, '--budget', BUDGET], {
            cwd: os.tmpdir(),
            encoding: 'utf8',
            env: scriptEnv(),
            timeout: FIXTURE_GIT_TIMEOUT_MS
        });
        assert.strictEqual(refused.status, 2, refused.stdout + refused.stderr);
        assert.match(refused.stderr, /did not return one/);
        // The control, run against the state the strip is for: the path really does
        // carry the character, and the refusal does not.
        assert.ok(lone.includes(String.fromCharCode(96)), 'the payload path carries the character');
        assert.ok(!refused.stderr.includes(String.fromCharCode(96)), 'the refusal carries none: ' + refused.stderr);
    } finally {
        rmDir(dir);
    }
});

// A duplicate cap defeats a reviewer reading the budget while the file still parses
// and the gate still greens, so the refusal names every repeated path. The screen the
// message passes through caps its length, so applied to the whole sentence it named
// some of the repeats and cut the rest: the paths are screened one at a time and the
// sentence is assembled around them.
test('a duplicate-key refusal names every repeated path rather than a capped list of them', () => {
    const dir = makeFixtureRepo();
    try {
        const budgetFile = path.join(dir, 'test', 'caps.json');
        // Six repeats of long keys, well past the screen's own cap, so a sentence-wide
        // screen would cut the list mid-way.
        const keys = Array.from({ length: 6 }, (_, i) => 'test/' + 'long-name-'.repeat(6) + i + '.test.js');
        const body = keys.concat(keys).map((k) => '    "' + k + '": 4000').join(',\r\n');
        fs.writeFileSync(budgetFile, '{\r\n' + body + '\r\n}\r\n', 'utf8');
        const refused = runScript(['check', '--repo', dir, '--budget', budgetFile]);
        assert.strictEqual(refused.status, 2, refused.stdout + refused.stderr);
        assert.match(refused.stderr, /lists a path more than once/);
        for (const key of keys) {
            assert.ok(refused.stderr.includes(key), 'the refusal names ' + key + ': ' + refused.stderr);
        }
        // The control on the screen itself, which is what makes the assertion above a
        // reading of the assembly rather than of a raised cap: one sentence that long
        // is truncated where each path of it is not.
        assert.ok(kit.safePath(keys.join(', ')).includes('truncated'), 'the screen does cap a sentence that long');
        assert.ok(keys.every((k) => kit.safePath(k) === k), 'and caps no path of it');
    } finally {
        rmDir(dir);
    }
});

// Every line of a reading lands in a fenced block inside a tracked plan doc, which
// the Chapter's Delta field quotes, so the channel's rule is that no line of it
// carries a path rooted outside the repository under measurement: such a path
// carries the layout it was read from, and the operator's account name sits in that
// layout on the default one. The rule is over the channel rather than over any one
// line, so this case drives both verbs over a tree holding as many row states as it
// can and reads every line against the shape of an absolute path.
test('no line either reading verb prints carries a path rooted outside the repository', () => {
    const dir = makeFixtureRepo();
    try {
        assert.strictEqual(runScript(['init', '--repo', dir]).status, 0);
        // A tree holding many of the row producers at once: a measured file that grew,
        // a deletion, an untracked file a shape reaches, an untracked file no shape
        // reaches, a tracked file no shape reaches, an edited named-exclusion path, and
        // a changed path under no measured root.
        write(dir, 'home/claude-kit-doctrine.md', 'doctrine text here, with more words than before.\n');
        git(dir, ['rm', '-q', '-f', 'plugins/claude-kit/agents/reviewer.md']);
        write(dir, 'test/new.test.js', "test('c', () => {});\n");
        write(dir, 'test/helpers/fixture-builder.js', 'module.exports = {};\n');
        write(dir, 'test/tracked-helper.js', 'module.exports = {};\n');
        git(dir, ['add', 'test/tracked-helper.js']);
        const budgetFile = path.join(dir, 'test', 'size-budget.json');
        const budget = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
        budget['test/gone.test.js'] = 40;
        fs.writeFileSync(budgetFile, kit.serializeBudget(budget), 'utf8');
        write(dir, 'README.md', 'outside every measured root, and edited.\n');

        // The shape of an absolute path on this platform, rather than any literal this
        // case was handed: a drive letter and a separator on win32, a leading slash
        // elsewhere. The parent of the fixture is checked by name beside it, since that
        // is the directory whose spelling would carry the layout.
        const absolute = process.platform === 'win32' ? /[A-Za-z]:[\\/]/ : /(?:^|[\s'"(])\//;
        const parent = path.dirname(dir);
        const readings = {};
        for (const verb of ['check', 'report']) {
            const shown = runScript([verb, '--repo', dir]);
            const lines = shown.stdout.split(/\r?\n/).filter((l) => l !== '');
            readings[verb] = lines;
            assert.ok(lines.length > 4, verb + ' printed a reading: ' + shown.stdout);
            for (const line of lines) {
                assert.ok(!absolute.test(line), verb + ' printed an absolute path: ' + line);
                assert.ok(!line.includes(parent), verb + ' printed the checkout layout: ' + line);
                assert.ok(!line.includes(dir), verb + ' printed the checkout path: ' + line);
            }
        }
        // The reading still names its subject, which is what the rule has to leave
        // standing: a Delta figure with no subject says nothing about which tree it is
        // about.
        for (const verb of ['check', 'report']) {
            assert.strictEqual(readings[verb][0], 'repository: ' + path.basename(dir), verb + ': ' + readings[verb][0]);
        }
        // And the row states really did run, so the sweep above is over a reading rather
        // than over a clean tree's subject line and totals block.
        const report = readings.report.join('\n');
        assert.match(report, /^home\/claude-kit-doctrine\.md: 8 words/m);
        assert.match(report, /^plugins\/claude-kit\/agents\/reviewer\.md: deleted/m);
        assert.match(report, /^test\/new\.test\.js: 1 lines/m);
        assert.match(report, /^test\/helpers\/fixture-builder\.js: untracked/m);
        assert.match(report, /^test\/tracked-helper\.js: changed/m);
        assert.match(report, /named-exclusion paths in the changeset: test\/size-budget\.json/m);
        assert.match(report, /changed paths under no measured root: 1 /m);
        assert.match(readings.check.join('\n'), /^stale-entry: test\/gone\.test\.js/m);

        // The control, and it is a line this tool produced rather than one built here:
        // the wrong-level refusal names an absolute path, on stderr, which this rule
        // does not reach because nothing quotes a refusal into a document. Matched on
        // the same shape, it speaks, so an empty result above is the channel being
        // clean rather than the predicate matching nothing.
        const below = runScript(['check', '--repo', path.join(dir, 'test')]);
        assert.strictEqual(below.status, 2, below.stdout + below.stderr);
        assert.ok(absolute.test(below.stderr), 'the absolute-path shape speaks: ' + below.stderr);
        assert.ok(below.stderr.includes(parent), 'and the layout is what it matched: ' + below.stderr);
    } finally {
        rmDir(dir);
    }
});

// --- The OS account name in a path this tool prints ------------------------

// The fixture account name for the two cases below, chosen the way
// test/kit-output-channel.test.js chooses its own: a string that appears in no
// temp directory's own path on any box this suite runs on, since the operator's
// real account name sits inside os.tmpdir() on win32.
const ACCOUNT_NAME = 'zephyrina';

// A home directory whose LEAF is that name, so a path under it carries the name
// the channel has to take out.
function stageAccountHome() {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-home-'));
    const home = path.join(parent, ACCOUNT_NAME);
    fs.mkdirSync(home);
    return { parent, home };
}

test('a path outside the repository under measurement carries no OS account name', () => {
    // The rule that spells a path relative to the repository reaches only paths
    // INSIDE it, and the repository's own top level is not one of them: it is the
    // reading's subject. So a refusal naming the directory it could not read is
    // where an absolute, home-anchored path reaches this tool's stdout and
    // stderr, both of which a model reads, and which the `report` verb's output
    // is quoted from into a plan doc.
    const { parent, home } = stageAccountHome();
    try {
        const notRepo = path.join(home, 'not-a-repo');
        fs.mkdirSync(notRepo);
        const refused = runScript(['check', '--repo', notRepo, '--budget', BUDGET], home);
        assert.strictEqual(refused.status, 2, refused.stdout + refused.stderr);
        assert.match(refused.stderr, /returned nothing usable for/,
            'test setup: the refusal under test is the one this fixture stages: ' + refused.stderr);
        assert.ok(!new RegExp(ACCOUNT_NAME, 'i').test(refused.stderr + refused.stdout),
            'the OS account name must not reach a channel a model reads: ' + refused.stderr);
        assert.match(refused.stderr, /~/,
            'and the home directory is elided to the operator\'s own shorthand rather than the '
            + 'path being dropped: ' + refused.stderr);
    } finally {
        rmDir(parent);
    }
});

test('a hooks library that is absent is named without the loader\'s own paths', () => {
    // The one refusal composed before the renderer is bound, and here the
    // renderer is part of what did not load: the payload carries no hooks
    // directory at all. A loader message carries a `Require stack:` naming the
    // absolute path of this file, which is home-anchored on an installed plugin,
    // so with nothing able to elide it the message is withheld and what stands
    // is the specifier this file named and the error's code.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-size-payload-'));
    try {
        fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
        const lone = path.join(dir, 'scripts', 'kit-size.js');
        fs.copyFileSync(SCRIPT, lone);
        const refused = spawnSync(process.execPath, [lone, 'check', '--repo', REPO, '--budget', BUDGET], {
            cwd: os.tmpdir(),
            encoding: 'utf8',
            env: scriptEnv(),
            timeout: FIXTURE_GIT_TIMEOUT_MS
        });
        assert.strictEqual(refused.status, 2, refused.stdout + refused.stderr);
        assert.match(refused.stderr, /the require of .*did not return one/,
            'test setup: the refusal under test is the one this fixture stages: ' + refused.stderr);
        assert.match(refused.stderr, /kit-git-lib/,
            'and it still names the module that would not load: ' + refused.stderr);
        assert.match(refused.stderr, /\(MODULE_NOT_FOUND\)/,
            'with the error\'s code, an upper-case identifier that can carry no path: '
            + refused.stderr);
        assert.ok(!/Require stack/i.test(refused.stderr),
            'the loader\'s own trace must not reach the channel: ' + refused.stderr);
        assert.ok(!refused.stderr.includes(dir),
            'nor the absolute path of the payload this file was run from: ' + refused.stderr);
    } finally {
        rmDir(dir);
    }
});

test('a hooks library that is present and throws is named with its message elided', () => {
    // The other leg of the same refusal, and the one the renderer is bound on: a
    // hooks directory the payload does hold, whose channel library loads and
    // whose git library throws. So the loader's own words ride out, and they are
    // where a home-anchored path reaches this channel, since an error thrown at
    // module scope names the file it was thrown in.
    const { parent, home } = stageAccountHome();
    try {
        const dir = path.join(home, 'payload');
        fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
        fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', 'kit-size.js'));
        fs.cpSync(path.join(REPO, 'plugins', 'claude-kit', 'hooks'), path.join(dir, 'hooks'),
            { recursive: true });
        fs.writeFileSync(path.join(dir, 'hooks', 'kit-git-lib.js'),
            "throw Object.assign(new Error('the fixture refuses this library: ' + __filename),"
            + " { code: 'ERR_FIXTURE_REFUSED' });\n", 'utf8');
        const refused = spawnSync(process.execPath,
            [path.join(dir, 'scripts', 'kit-size.js'), 'check', '--repo', REPO, '--budget', BUDGET], {
                cwd: os.tmpdir(),
                encoding: 'utf8',
                env: scriptEnv(home),
                timeout: FIXTURE_GIT_TIMEOUT_MS
            });
        assert.strictEqual(refused.status, 2, refused.stdout + refused.stderr);
        assert.match(refused.stderr, /the require of .*did not return one/,
            'test setup: the refusal under test is the one this fixture stages: ' + refused.stderr);
        assert.match(refused.stderr, /\(ERR_FIXTURE_REFUSED\)/,
            'test setup: carrying the code the fixture threw: ' + refused.stderr);
        assert.match(refused.stderr, /the fixture refuses this library/,
            'test setup: and the loader\'s own message, which is the leg under test rather than '
            + 'the withheld one: ' + refused.stderr);
        assert.ok(!new RegExp(ACCOUNT_NAME, 'i').test(refused.stderr + refused.stdout),
            'the OS account name must not reach a channel a model reads: ' + refused.stderr);
        assert.match(refused.stderr, /~/,
            'and the path inside that message is elided to the operator\'s own shorthand rather '
            + 'than dropped: ' + refused.stderr);
        assert.ok(!/Require stack/i.test(refused.stderr),
            'no loader trace rides along: ' + refused.stderr);
    } finally {
        rmDir(parent);
    }
});

test('an argument this tool will not take is refused with the account name out of it', () => {
    // The argument refusals are composed before the repository is resolved, so
    // the rule that spells a path relative to it has nothing to answer against
    // yet: a caller who passed an absolute path where this tool takes no second
    // one gets that path printed back, home directory and all, into a channel a
    // model reads.
    const { parent, home } = stageAccountHome();
    try {
        const res = runScript(['check', path.join(home, 'a-second-argument.md')], home);
        assert.strictEqual(res.status, 2, res.stdout + res.stderr);
        assert.match(res.stderr, /is a second bare argument/,
            'test setup: the refusal under test is the one this call stages: ' + res.stderr);
        assert.ok(!new RegExp(ACCOUNT_NAME, 'i').test(res.stderr + res.stdout),
            'the OS account name must not reach a channel a model reads: ' + res.stderr);
        assert.match(res.stderr, /~/,
            'and the argument is still named, with the home directory elided rather than the '
            + 'path dropped: ' + res.stderr);
    } finally {
        rmDir(parent);
    }
});
