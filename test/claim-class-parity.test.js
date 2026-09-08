// The behavior/claim class definition that gates the review loop's exit lives
// in plugins/claude-kit/skills/executing-work/SKILL.md, inside a numbered
// list item's continuation, between the KIT-CLAIM-CLASS markers. The two
// reviewer charters, plugins/claude-kit/agents/adversarial-reviewer.md and
// plugins/claude-kit/agents/blind-reviewer.md, each carry the same wording as
// a copy at column one, so a reviewer sees the class definition without
// reading the executing-work skill. A copy drifts, so it is pinned here
// against the owner.
//
// The owner's region sits inside a list item at that item's continuation
// indent; the charters' copies sit at column one. So the comparison dedents
// each region (stripping the common leading whitespace off its non-blank
// lines) before comparing, on top of the sibling normalizations this file
// clones from test/output-style-parity.test.js: a BOM strip, a frontmatter
// strip, and line-ending normalization. There are no frontmatter pins here;
// the frontmatter strip exists only to read each file's body consistently
// before locating the markers inside it.
//
// The frontmatter strip has the same semantics as test/doctrine-parity.test.js
// (drop a leading '---'-fenced block and one blank line after it), and line
// endings are normalized to \n with trailing newlines trimmed to exactly one
// before comparing, so a CRLF/LF checkout difference can never fail a parity
// the content holds. Everything else is byte-exact after the dedent, with two
// exclusions the dedent itself creates: an indent change that moves every
// line of one region together is invisible, since each region loses its own
// common indent, and a whitespace-only line compares as empty. A drift is
// reported against the copy whichever side moved, because the owner is the
// reference by definition.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SKILL_FILE = path.join(__dirname, '..', 'plugins', 'claude-kit', 'skills',
    'executing-work', 'SKILL.md');
const ADVERSARIAL_FILE = path.join(__dirname, '..', 'plugins', 'claude-kit', 'agents',
    'adversarial-reviewer.md');
const BLIND_FILE = path.join(__dirname, '..', 'plugins', 'claude-kit', 'agents',
    'blind-reviewer.md');

const SKILL_LABEL = 'plugins/claude-kit/skills/executing-work/SKILL.md';
const ADVERSARIAL_LABEL = 'plugins/claude-kit/agents/adversarial-reviewer.md';
const BLIND_LABEL = 'plugins/claude-kit/agents/blind-reviewer.md';

const BEGIN = 'KIT-CLAIM-CLASS:BEGIN';
const END = 'KIT-CLAIM-CLASS:END';

function stripFrontmatter(text) {
    const lines = text.split('\n');
    if ((lines[0] || '').trim() !== '---') return text;
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') { end = i; break; }
    }
    if (end === -1) return text;
    return lines.slice(end + 1).join('\n').replace(/^\r?\n/, '');
}

// A byte-order mark is dropped by code point rather than by a regex literal so
// no invisible character sits in this file's source.
function stripBom(text) {
    return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function normalize(text) {
    return stripBom(text).replace(/\r\n/g, '\n').replace(/\n*$/, '\n');
}

// The frontmatter-stripped, line-ending-normalized body a marker search runs
// against, beside the number of leading lines the strip removed, so a line
// number reported below is the file's own 1-based line as an editor shows it
// rather than a position inside the stripped body.
function bodyOf(file) {
    const whole = normalize(stripBom(fs.readFileSync(file, 'utf8')));
    const text = normalize(stripFrontmatter(whole));
    const offset = whole.split('\n').length - text.split('\n').length;
    return { text, offset };
}

// Strips the common leading whitespace from a region's non-blank lines, so a
// region living at a list item's continuation indent (the owner) compares
// equal to the same region living at column one (a charter copy). Blank
// lines are left blank rather than counted toward the common amount.
function dedent(lines) {
    const nonBlank = lines.filter((l) => l.trim() !== '');
    if (nonBlank.length === 0) return lines.slice();
    const common = nonBlank.reduce((min, l) => {
        const leading = l.match(/^[ \t]*/)[0].length;
        return Math.min(min, leading);
    }, Infinity);
    return lines.map((l) => (l.trim() === '' ? '' : l.slice(common)));
}

// The lines strictly between one BEGIN/END marker pair, dedented, with the
// marker pair itself pinned to exactly one occurrence each, BEGIN before
// END, and the region non-empty. Throws (via assert) naming the marker and
// the label on any violation, so a missing or duplicated marker fails loud
// rather than silently reading an empty or wrong region. offset is the count
// of lines removed ahead of text, added so firstLine is the file's own line.
function extractRegion(text, label, offset = 0) {
    const lines = text.split('\n');
    const begins = [];
    const ends = [];
    lines.forEach((l, i) => {
        if (l.includes(BEGIN)) begins.push(i);
        if (l.includes(END)) ends.push(i);
    });
    assert.strictEqual(begins.length, 1,
        `expected exactly one ${BEGIN} marker in ${label}`);
    assert.strictEqual(ends.length, 1,
        `expected exactly one ${END} marker in ${label}`);
    assert.ok(begins[0] < ends[0],
        `the ${BEGIN} marker must precede the ${END} marker in ${label}`);
    const region = lines.slice(begins[0] + 1, ends[0]);
    assert.ok(region.some((l) => l.trim() !== ''),
        `the class region between the markers is empty in ${label}`);
    return { lines: dedent(region), firstLine: begins[0] + 2 + offset };
}

// Pure comparison over already-read texts: locates each side's marked
// region, dedents it, and compares line by line. Returns null on parity, or
// the first differing line as { file, line, expected, actual }, where line
// is the copy file's own 1-based line number (copyOffset lines removed ahead
// of copyText, plus the marker's position, plus the index into the region).
// A region of different length differs at the first line one side has and
// the other lacks.
function compareRegions(sourceText, copyText, copyLabel, copyOffset = 0) {
    const source = extractRegion(sourceText, SKILL_LABEL);
    const copy = extractRegion(copyText, copyLabel, copyOffset);
    const length = Math.max(source.lines.length, copy.lines.length);
    for (let i = 0; i < length; i++) {
        const expected = source.lines[i];
        const actual = copy.lines[i];
        if (expected !== actual) {
            return {
                file: copyLabel,
                line: copy.firstLine + i,
                expected: expected === undefined
                    ? '(no line; the owner region ends here)' : expected,
                actual: actual === undefined
                    ? '(no line; this region ends here)' : actual,
            };
        }
    }
    return null;
}

test('the owner\'s class region carries exactly one marker pair and is non-empty', () => {
    extractRegion(bodyOf(SKILL_FILE).text, SKILL_LABEL);
});

test('the class region is byte-identical between the owner and the adversarial-reviewer charter', () => {
    const copy = bodyOf(ADVERSARIAL_FILE);
    const diff = compareRegions(bodyOf(SKILL_FILE).text, copy.text, ADVERSARIAL_LABEL, copy.offset);
    if (diff) {
        assert.fail(`${diff.file}:${diff.line} has drifted from the owner's class region\n`
            + `expected: ${diff.expected}\n`
            + `actual:   ${diff.actual}`);
    }
});

test('the class region is byte-identical between the owner and the blind-reviewer charter', () => {
    const copy = bodyOf(BLIND_FILE);
    const diff = compareRegions(bodyOf(SKILL_FILE).text, copy.text, BLIND_LABEL, copy.offset);
    if (diff) {
        assert.fail(`${diff.file}:${diff.line} has drifted from the owner's class region\n`
            + `expected: ${diff.expected}\n`
            + `actual:   ${diff.actual}`);
    }
});

// Control: withheld from the pin's own literals, once per copy. A word inside
// a real copy's region is altered in a temporary string buffer, never on disk,
// and the same compareRegions function the real pins use must report the
// drift at the copy's file label and the region's first line as the file
// numbers it. The expected line is counted in the raw file, unstripped and
// split on either line ending, so it shares no arithmetic with bodyOf or
// extractRegion: an off-by-one in the offset moves the reported line and not
// this expectation.
for (const [file, label] of [[ADVERSARIAL_FILE, ADVERSARIAL_LABEL], [BLIND_FILE, BLIND_LABEL]]) {
    test(`control: a word change inside a copy's region is caught at the expected file and line: ${label}`, () => {
        const source = bodyOf(SKILL_FILE).text;
        const copy = bodyOf(file);
        const lines = copy.text.split('\n');
        const beginIdx = lines.findIndex((l) => l.includes(BEGIN));
        assert.ok(beginIdx >= 0, 'test fixture assumption: the BEGIN marker must be present');
        const targetIdx = beginIdx + 1;
        assert.ok(lines[targetIdx] && lines[targetIdx].trim() !== '',
            'test fixture assumption: the region\'s first line must be non-blank');
        const mutated = lines[targetIdx].replace('behavior', 'BEHAVIOR-MUTATED');
        assert.notStrictEqual(mutated, lines[targetIdx],
            'test fixture assumption: the word "behavior" must appear on the region\'s first line');
        lines[targetIdx] = mutated;
        const mutatedCopy = lines.join('\n');

        const rawLines = stripBom(fs.readFileSync(file, 'utf8')).split(/\r?\n/);
        const rawBegin = rawLines.findIndex((l) => l.includes(BEGIN));
        assert.ok(rawBegin >= 0, 'test fixture assumption: the BEGIN marker must be present in the raw file');
        const expectedLine = rawBegin + 2;

        const diff = compareRegions(source, mutatedCopy, label, copy.offset);
        assert.ok(diff, 'a mutated word inside the region must be reported as a difference');
        assert.strictEqual(diff.file, label,
            'the reported difference must name the mutated copy\'s file');
        assert.strictEqual(diff.line, expectedLine,
            'the reported difference must name the region\'s first line as the raw file numbers it');
    });
}

// Control: withheld from the pin's own literals. Removing a copy's END
// marker in a temporary buffer must fail the marker pin naming the END
// marker and the file, through the same extractRegion function the real pin
// uses, not a re-typed check.
test('control: a missing END marker fails the marker pin naming the marker and the file', () => {
    const withoutEnd = bodyOf(BLIND_FILE).text.split('\n')
        .filter((l) => !l.includes(END))
        .join('\n');
    assert.throws(
        () => extractRegion(withoutEnd, BLIND_LABEL),
        (err) => err instanceof assert.AssertionError
            && err.message.includes(END)
            && err.message.includes(BLIND_LABEL),
        'removing the END marker must fail the marker pin naming the marker and the file'
    );
});
