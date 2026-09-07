// The probe file format: one file per governed moment under test/probes/, read
// by the probe runner and by test/probe-set.test.js.
//
// A probe file is YAML-subset frontmatter between `---` fences, then the
// scenario body verbatim as a cold reader receives it. The subset is
// hand-written here because this repository carries no dependencies and a full
// YAML parser is far more surface than five keys need: top-level `key: value`
// scalars, an `options:` list of `- value`, and a `shapes:` list of mappings,
// each `- name: <name>` followed, where the shape is built to read against the
// probe's answer, by an optional `designed-mismatch: <slug>` naming the reason,
// and then by an indented `files:` list. Anything else is
// refused with the file's path and the offending line, because a probe silently
// half-read is a ruling silently dropped from a run whose exit code is a count
// of mismatches.
//
// Three guards live here rather than in the runner, all because this is the one
// place every reader of the format passes through. A shape name becomes a
// directory component when a run copies the shape's files into scratch, so the
// name is held to a slug. An option is compared against a reply's answer after
// that answer is unwrapped of backticks and quotes, trimmed and lower-cased, so
// an option is held to a slug too: two options that differ only in the
// punctuation that unwrapping removes are one answer at match time and two
// answers in the list a reader picks from. A file entry becomes a path joined
// against a tree root, so an absolute path, a backslash, a parent-directory
// segment and a `.` or empty segment are refused, and what survives that is held
// to the two roots a shape may name:
// the plugin root in this repo, and one markdown file directly under ~/.claude.
// Existence of a file entry is not checked here: this module reads no
// filesystem for `files`, and each consumer validates existence against the tree
// it actually reads.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// The directory listing is the kit's shared bounded reader rather than a
// readdirSync of this module's own, so a probes directory that has grown past
// the scan cap reports that it was bounded instead of returning a short list
// that reads exactly like a small corpus.
const require_ = createRequire(import.meta.url);
const { listBoundedNames, DIR_SCAN_MAX_ENTRIES } = require_('../../plugins/claude-kit/hooks/kit-read-lib.js');

export const VERDICTS = ['RESOLVED', 'CONTESTED', 'SILENT'];

// The tiers a probe may run at, per the plan's tier decision: sonnet by default,
// opus for a moment only an orchestrator meets.
export const TIERS = ['sonnet', 'opus'];

// The rulings a probe may carry: a proposal awaiting the operator, or the
// operator's ruling. The set is closed; a third state would be a probe whose
// expected answer nobody has stood behind.
export const RULING_STATES = ['proposed', 'ruled'];

const SCALAR_KEYS = ['moment', 'tier', 'verdict', 'answer', 'ruling'];
const LIST_KEYS = ['options', 'shapes'];
const KNOWN_KEYS = SCALAR_KEYS.concat(LIST_KEYS);

// A slug: lower-case words joined by single hyphens. It is what a moment, a
// shape name and an option may be: it makes the first two safe as a filename
// and as a directory component, and it holds the third to a spelling that
// survives the unwrapping a reply's answer passes through.
//
// Exported because a consumer that takes probes as objects rather than as files
// applies the same rule at its own entry point: a moment and a shape name each
// become a directory component in a run's scratch copy, and a caller composing
// its own probe never passes this parser. A second spelling of the rule is a
// second rule.
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// A file entry: repo-relative, forward slashes, no drive letter, no parent
// segment. `home/<name>` is the one prefix that names a file outside the repo,
// and it takes the same grammar.
const FILE_ENTRY = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/;

// The two roots a shape may name, and nothing else. A probe hands a cold reader
// the governing corpus, which lives under the plugin root in this repo and, for
// the files the reader would meet from the home directory, directly under
// ~/.claude. The allowlist is here rather than in a consumer because every
// consumer of a shape copies these paths out of a real tree: an entry naming
// `.env`, `.git/config` or anything under `home/` other than one markdown file
// would put a secret or a repository internal into a prompt, and a grammar that
// only refuses `..` and absolute paths admits all of them.
// Exported because a consumer that copies a shape's files out of a real tree
// decides where an entry resolves from the same two roots, and a second
// spelling of either is a second allowlist.
export const PLUGIN_PREFIX = 'plugins/claude-kit/';
const HOME_PREFIX = 'home/';
export const HOME_ENTRY = /^home\/[A-Za-z0-9._-]+\.md$/;

const RULING = new RegExp('^(' + RULING_STATES.join('|') + ') (\\d{4})-(\\d{2})-(\\d{2})$');

// The name in the probes directory that is documentation about the set rather
// than a member of it. Excluded by name so a reader of the directory sees why
// it is not a probe, where a pattern narrower than `*.md` would hide the
// question.
const NOT_A_PROBE = ['README.md'];

// Every probe file under `dir`, sorted by name, as absolute paths. Symbolic
// links and subdirectories are not probes: the listing matches regular files
// alone, so a link planted at a probe name cannot become a probe whose files a
// run copies out of the tree.
export function listProbeFiles(dir) {
    // The directory's own kind first, so an absent path, a path that is a file,
    // and a path the process may not read each say which of the three it is.
    // The bounded reader below cannot tell them apart: every one of them yields
    // an empty list, which reads exactly like a directory holding no probe.
    let stat = null;
    try {
        stat = fs.statSync(dir);
    } catch (err) {
        if (err && err.code === 'ENOENT') throw new Error(dir + ': no such probe directory');
        throw new Error(dir + ': the probe directory could not be read (' + ((err && err.code) || 'unknown') + ')');
    }
    if (!stat.isDirectory()) {
        throw new Error(dir + ': the probe path is not a directory');
    }
    // The open, on its own, before the bounded read. The shared reader answers a
    // failed open with `bounded`, which is also how it reports a directory too
    // large to scan, so a permission fault would otherwise be reported as a
    // corpus too big to list. Opened and closed here, its errno is the message.
    try {
        fs.opendirSync(dir).closeSync();
    } catch (err) {
        throw new Error(dir + ': the probe directory could not be opened (' + ((err && err.code) || 'unknown') + ')');
    }
    const { names, bounded } = listBoundedNames(
        dir,
        DIR_SCAN_MAX_ENTRIES,
        (entry) => entry.isFile() && entry.name.endsWith('.md') && !NOT_A_PROBE.includes(entry.name)
    );
    if (bounded) {
        throw new Error(dir + ': the probe directory listing was bounded, so this is not the whole set');
    }
    return names.slice().sort().map((name) => path.resolve(dir, name));
}

// One probe file's frontmatter and scenario, or a throw naming the path, the
// line, and the rule that refused it. There is no partial return: a file that
// breaks any rule yields no probe at all.
export function parseProbeFile(text, options = {}) {
    const where = options.path || '<unknown>';
    const fail = (lineNo, message) => {
        throw new Error(where + ':' + lineNo + ': ' + message);
    };
    if (typeof text !== 'string') fail(1, 'probe file content is not text');

    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const lines = body.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
    // A fence is the three dashes and whatever whitespace an editor left after
    // them: trailing space on a fence line is invisible in every editor and
    // would otherwise make the file open with no frontmatter at all, or run the
    // frontmatter on into the scenario body.
    const isFence = (line) => typeof line === 'string' && line.trimEnd() === '---';
    if (!isFence(lines[0])) fail(1, 'the file must open with a `---` frontmatter fence');

    let fenceEnd = -1;
    for (let i = 1; i < lines.length; i += 1) {
        if (isFence(lines[i])) { fenceEnd = i; break; }
    }
    if (fenceEnd === -1) fail(lines.length, 'the frontmatter has no closing `---` fence');

    const parsed = parseFrontmatter(lines.slice(1, fenceEnd), fail);
    const scenario = lines.slice(fenceEnd + 1).join('\n').replace(/^\n+/, '');
    if (scenario.trim() === '') fail(fenceEnd + 1, 'the scenario body is empty');

    return validate(parsed, scenario, fenceEnd + 1, fail);
}

// The frontmatter lines, one pass, carrying each value's own line number so a
// rule broken by a value is reported where the value sits rather than at the
// fence.
function parseFrontmatter(fmLines, fail) {
    const scalars = {};
    const seen = new Map();
    const optionEntries = [];
    const shapes = [];
    let listKey = null;
    let shape = null;
    let inFiles = false;

    for (let i = 0; i < fmLines.length; i += 1) {
        const lineNo = i + 2;
        const original = fmLines[i];
        if (original.trim() === '' || original.trimStart().startsWith('#')) continue;
        const indent = original.length - original.trimStart().length;
        const trimmed = original.trim();

        // A `#` after whitespace is refused on every value-carrying line rather
        // than read as a comment. Every value here is matched whole against
        // something else later: an option against a reply's answer, a file entry
        // against a path on disk, a scalar against a closed vocabulary or, for
        // `answer`, against the option list. Dropping the tail of one turns a
        // typo into a value that looks right and matches something other than
        // what was written. A comment on its own line, at any indent, is read as
        // a comment and skipped above.
        if (/\s+#/.test(original)) {
            fail(lineNo, indent > 0
                ? 'a list entry carries no trailing `#` comment, because the whole entry is the value: '
                    + JSON.stringify(trimmed)
                : 'a top-level value carries no trailing `#` comment, because the whole of it is the value and '
                    + 'dropping the tail leaves one that matches something other than what was written: '
                    + JSON.stringify(trimmed));
        }

        if (indent === 0) {
            const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(trimmed);
            if (!match) fail(lineNo, 'expected a top-level `key: value`, got ' + JSON.stringify(trimmed));
            const key = match[1];
            const value = match[2].trim();
            if (!KNOWN_KEYS.includes(key)) {
                fail(lineNo, 'unknown top-level key ' + JSON.stringify(key) + '; the keys are ' + KNOWN_KEYS.join(', '));
            }
            if (seen.has(key)) fail(lineNo, 'duplicate top-level key ' + JSON.stringify(key) + ', first seen at line ' + seen.get(key));
            seen.set(key, lineNo);
            if (LIST_KEYS.includes(key)) {
                if (value !== '') fail(lineNo, 'key ' + JSON.stringify(key) + ' is a list, so its own line carries no value');
                listKey = key;
                shape = null;
                inFiles = false;
            } else {
                if (value === '') fail(lineNo, 'key ' + JSON.stringify(key) + ' has an empty value');
                scalars[key] = { value, line: lineNo };
                listKey = null;
            }
            continue;
        }

        if (listKey === null) fail(lineNo, 'indented line outside any list: ' + JSON.stringify(trimmed));

        if (listKey === 'options') {
            const item = listItem(trimmed, lineNo, fail);
            optionEntries.push({ value: item, line: lineNo });
            continue;
        }

        if (trimmed.startsWith('-')) {
            const item = listItem(trimmed, lineNo, fail);
            const named = /^name:\s*(.*)$/.exec(item);
            if (named) {
                const name = named[1].trim();
                if (name === '') fail(lineNo, 'a shape entry has an empty `name`');
                shape = { name, files: [], designedMismatch: null, line: lineNo };
                shapes.push(shape);
                inFiles = false;
                continue;
            }
            if (!shape || !inFiles) fail(lineNo, 'a file entry outside a shape\'s `files:` list: ' + JSON.stringify(item));
            shape.files.push({ value: item, line: lineNo });
            continue;
        }

        if (trimmed === 'files:') {
            if (!shape) fail(lineNo, '`files:` before any `- name:` shape entry');
            if (inFiles) fail(lineNo, 'a second `files:` list in one shape');
            inFiles = true;
            continue;
        }

        // The one optional key a shape mapping carries. It names why this shape's
        // reading is expected to disagree with the probe's answer, and it belongs
        // to a shape rather than to the probe, so it is read here and nowhere
        // else: at the top level the key is unknown, and inside `options:` the
        // line is not a list entry.
        //
        // Its place in the mapping is the shape's own opening, between `- name:`
        // and `files:`. Indentation is not what binds it to a shape here, so a
        // key written after a shape's file list would attach to that shape from
        // below, wherever it sits and whatever it was written under: read after
        // the files begin it is refused, and the marker either sits in its
        // shape's opening or is not a marker at all.
        const designed = /^designed-mismatch:\s*(.*)$/.exec(trimmed);
        if (designed) {
            if (!shape) fail(lineNo, '`designed-mismatch:` before any `- name:` shape entry');
            if (inFiles) {
                fail(lineNo, '`designed-mismatch:` after the `files:` list of shape ' + JSON.stringify(shape.name)
                    + ' has begun; the key sits between a shape\'s `- name:` line and its `files:`, since read from'
                    + ' below it marks whichever shape was parsed last rather than the one it was written under');
            }
            if (shape.designedMismatch) {
                fail(lineNo, 'a second `designed-mismatch:` in shape ' + JSON.stringify(shape.name)
                    + ', first seen at line ' + shape.designedMismatch.line);
            }
            shape.designedMismatch = { value: designed[1].trim(), line: lineNo };
            continue;
        }

        fail(lineNo, 'expected `- name: <slug>`, `designed-mismatch: <slug>`, `files:`, or `- <path>` inside `shapes:`, got '
            + JSON.stringify(trimmed));
    }

    return { scalars, seen, optionEntries, shapes };
}

function listItem(trimmed, lineNo, fail) {
    const match = /^-\s+(.+)$/.exec(trimmed);
    if (!match) fail(lineNo, 'expected a list entry of the form `- value`, got ' + JSON.stringify(trimmed));
    return match[1].trim();
}

// Every rule that is about a value rather than about the shape of a line. Each
// one names itself in the message, so a refusal says which rule refused it.
function validate(parsed, scenario, fenceLine, fail) {
    const { scalars, seen, optionEntries, shapes } = parsed;
    for (const key of KNOWN_KEYS) {
        if (!seen.has(key)) fail(fenceLine, 'missing required key ' + JSON.stringify(key));
    }

    const moment = scalars.moment;
    if (!SLUG.test(moment.value)) {
        fail(moment.line, '`moment` must be a lower-case hyphenated slug, got ' + JSON.stringify(moment.value));
    }
    const tier = scalars.tier;
    if (!TIERS.includes(tier.value)) {
        fail(tier.line, '`tier` must be one of ' + TIERS.join(', ') + ', got ' + JSON.stringify(tier.value));
    }
    const verdict = scalars.verdict;
    if (!VERDICTS.includes(verdict.value)) {
        fail(verdict.line, '`verdict` must be one of ' + VERDICTS.join(', ') + ', got ' + JSON.stringify(verdict.value));
    }
    const ruling = parseRuling(scalars.ruling, fail);

    const options = optionEntries.map((entry) => entry.value);
    if (options.length < 2) {
        fail(seen.get('options'), '`options` must offer at least two answers, got ' + options.length);
    }
    // The slug rule runs first, so the duplicate check below compares the values
    // as written: a slug is already lower case, and two options that differ only
    // in case are two spellings neither of which is a slug.
    const optionLines = new Map();
    for (const entry of optionEntries) {
        if (!SLUG.test(entry.value)) {
            fail(entry.line, 'an option must be a lower-case hyphenated slug, got ' + JSON.stringify(entry.value)
                + '; a reply\'s answer is unwrapped of backticks and quotes, trimmed and lower-cased before it is '
                + 'compared, so an option carrying any of that punctuation is an answer no reply can be told apart from');
        }
        if (optionLines.has(entry.value)) {
            fail(entry.line, 'duplicate option ' + JSON.stringify(entry.value) + ', first seen at line ' + optionLines.get(entry.value)
                + '; the closed list is what a reader picks from, and one answer offered twice is one answer');
        }
        optionLines.set(entry.value, entry.line);
    }
    const answer = scalars.answer;
    if (!options.includes(answer.value)) {
        fail(answer.line, '`answer` ' + JSON.stringify(answer.value) + ' is not one of the options: ' + options.join(', '));
    }

    if (shapes.length < 2) {
        fail(seen.get('shapes'), 'a probe runs under at least two shapes, got ' + shapes.length);
    }
    const names = new Map();
    for (const entry of shapes) {
        if (!SLUG.test(entry.name)) {
            fail(entry.line, 'a shape name must be a lower-case hyphenated slug, got ' + JSON.stringify(entry.name)
                + '; the name becomes a directory component in a run\'s scratch copy');
        }
        if (names.has(entry.name)) {
            fail(entry.line, 'duplicate shape name ' + JSON.stringify(entry.name) + ', first seen at line ' + names.get(entry.name));
        }
        names.set(entry.name, entry.line);
        if (entry.designedMismatch && !SLUG.test(entry.designedMismatch.value)) {
            fail(entry.designedMismatch.line, '`designed-mismatch` must be a lower-case hyphenated slug naming the'
                + ' reason this shape reads against the probe\'s answer, got ' + JSON.stringify(entry.designedMismatch.value));
        }
        if (entry.files.length === 0) fail(entry.line, 'shape ' + JSON.stringify(entry.name) + ' names no files');
        const files = new Map();
        for (const file of entry.files) {
            checkFileEntry(file, fail);
            if (files.has(file.value)) {
                fail(file.line, 'shape ' + JSON.stringify(entry.name) + ' names ' + JSON.stringify(file.value)
                    + ' twice, first at line ' + files.get(file.value)
                    + '; a shape is the file set a reader receives, and a file handed over twice is one file');
            }
            files.set(file.value, file.line);
        }
    }

    return {
        moment: moment.value,
        tier: tier.value,
        verdict: verdict.value,
        answer: answer.value,
        ruling,
        options,
        shapes: shapes.map((entry) => ({
            name: entry.name,
            designedMismatch: entry.designedMismatch ? entry.designedMismatch.value : null,
            files: entry.files.map((file) => file.value)
        })),
        scenario
    };
}

function parseRuling(entry, fail) {
    const match = RULING.exec(entry.value);
    if (!match) {
        fail(entry.line, '`ruling` must read `proposed YYYY-MM-DD` or `ruled YYYY-MM-DD`, got ' + JSON.stringify(entry.value));
    }
    const [, state, year, month, day] = match;
    const date = year + '-' + month + '-' + day;
    const asDate = new Date(date + 'T00:00:00Z');
    if (Number.isNaN(asDate.getTime()) || asDate.toISOString().slice(0, 10) !== date) {
        fail(entry.line, '`ruling` carries a date that does not exist: ' + JSON.stringify(date));
    }
    return { state, date };
}

function checkFileEntry(file, fail) {
    const value = file.value;
    if (!FILE_ENTRY.test(value)) {
        fail(file.line, 'a file entry must be a repo-relative path in forward slashes, got ' + JSON.stringify(value));
    }
    if (value.split('/').includes('..')) {
        fail(file.line, 'a file entry may not reach out of the tree with `..`: ' + JSON.stringify(value));
    }
    if (value.endsWith('/')) {
        fail(file.line, 'a file entry names a file rather than a directory: ' + JSON.stringify(value));
    }
    // One spelling per path. A `.` segment and an empty segment both resolve to
    // the same file as the plain spelling, so admitting either lets one file
    // enter a shape twice under two spellings, which the duplicate-entry rule
    // below compares as strings and would pass.
    const segments = value.split('/');
    if (segments.includes('.') || segments.includes('')) {
        fail(file.line, 'a file entry carries no `.` or empty path segment, since a path spelled two ways '
            + 'is one file a shape can name twice: ' + JSON.stringify(value));
    }
    if (value.startsWith(HOME_PREFIX)) {
        if (!HOME_ENTRY.test(value)) {
            fail(file.line, 'a `home/` entry names one markdown file directly under ~/.claude, as `home/<name>.md`, got '
                + JSON.stringify(value));
        }
        return;
    }
    if (!value.startsWith(PLUGIN_PREFIX)) {
        fail(file.line, 'a file entry sits under ' + JSON.stringify(PLUGIN_PREFIX)
            + ' or names a `home/<name>.md` file under ~/.claude, got ' + JSON.stringify(value));
    }
}
