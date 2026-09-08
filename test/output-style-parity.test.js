// The Kit output style, plugins/claude-kit/output-styles/kit.md, carries the
// doctrine's communication core inside a marked region so the register rides
// the system prompt as well as CLAUDE.md. That region is a copy, and a copy
// drifts, so every element in it is pinned here against both doctrine copies:
// plugins/claude-kit/skills/operating-instructions/SKILL.md (the source) and
// home/claude-kit-doctrine.md (the mirror). Sync direction is skill to mirror
// to style core; the doctrine copies carry no markers, so the elements are
// located in them by bullet lead.
//
// The frontmatter pins are load-bearing beyond tidiness. With
// keep-coding-instructions absent or false, the style silently removes Claude
// Code's built-in software-engineering instructions from every kit session;
// force-for-plugin is what activates the style wherever the plugin is enabled.
//
// Frontmatter is read by a line scan rather than a YAML parser: the pinned keys
// are flat scalars and a scan keeps the test dependency-free. Values split on
// the first colon only, because the description value contains one of its own.
//
// The frontmatter strip for the skill body has the same semantics as
// test/doctrine-parity.test.js (drop a leading '---'-fenced block and one blank
// line after it), and line endings are normalized to \n with trailing newlines
// trimmed to exactly one before comparing, so a CRLF/LF checkout difference can
// never fail a parity the content holds. Everything else is byte-exact.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SKILL = path.join(__dirname, '..', 'plugins', 'claude-kit', 'skills',
    'operating-instructions', 'SKILL.md');
const MIRROR = path.join(__dirname, '..', 'home', 'claude-kit-doctrine.md');
const STYLE = path.join(__dirname, '..', 'plugins', 'claude-kit', 'output-styles',
    'kit.md');

const BEGIN = 'KIT-REGISTER-CORE:BEGIN';
const END = 'KIT-REGISTER-CORE:END';

// The core's eight bullets, in the order the style's region must carry them.
// Each is a single physical line in the doctrine, so the lead identifies it.
const CORE_LEADS = [
    '- **Skip the preamble.**',
    '- **Disagree up front.**',
    '- **No false certainty, no flattery.**',
    '- **Teach the why; treat design as a dialog.**',
    '- **Plain prose, never mannered prose.**',
    '- **Write every decision ask to the client-briefing register.**',
    '- **Narrate the cadence, and close with the state.**',
    '- **Close with the board when plans are pending, and never assume I remember a plan.**',
];

const SEND_HEADER = '## Before you send';

// The complete set of keys the style's frontmatter declares.
const PINNED_KEYS = [
    'name',
    'description',
    'keep-coding-instructions',
    'force-for-plugin',
];

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

function skillBody() {
    return normalize(stripFrontmatter(stripBom(fs.readFileSync(SKILL, 'utf8'))));
}

function mirrorBody() {
    return normalize(fs.readFileSync(MIRROR, 'utf8'));
}

function styleText() {
    return normalize(fs.readFileSync(STYLE, 'utf8'));
}

function frontmatterLines() {
    const lines = styleText().split('\n');
    assert.strictEqual((lines[0] || '').trim(), '---',
        'the style file must open with a YAML frontmatter fence');
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    assert.ok(end > 0, 'the style file\'s frontmatter block is unterminated');
    return lines.slice(1, end);
}

// The one line declaring a key, matched on 'key: ' with the space: 'key:true'
// is a plain scalar YAML reads as a different key entirely, so it must not
// satisfy a pin. Exactly one line may declare a key, because YAML is
// last-key-wins and a first-match read would accept a true followed by a false.
function frontmatterLine(key) {
    const hits = frontmatterLines().filter((l) => l.startsWith(key + ': '));
    assert.strictEqual(hits.length, 1,
        `expected exactly one '${key}: ' line in the style's frontmatter`);
    return hits[0];
}

// The raw scalar as written, quotes and all. The split is on the first colon so
// a value carrying its own colon survives intact.
function frontmatterRawValue(key) {
    const line = frontmatterLine(key);
    return line.slice(line.indexOf(':') + 1).trim();
}

// The scalar with a matched pair of surrounding quotes removed. The
// backreference pairs the quotes, so a value opened and closed with different
// quote characters keeps them and fails its pin.
function frontmatterValue(key) {
    return frontmatterRawValue(key).replace(/^(["'])(.*)\1$/, '$2');
}

// The lines strictly between the marker pair, with the marker pair itself
// pinned to exactly one occurrence each.
function coreRegionLines() {
    const lines = styleText().split('\n');
    const begins = lines.reduce((acc, l, i) => (l.includes(BEGIN) ? acc.concat(i) : acc), []);
    const ends = lines.reduce((acc, l, i) => (l.includes(END) ? acc.concat(i) : acc), []);
    assert.strictEqual(begins.length, 1,
        'expected exactly one KIT-REGISTER-CORE:BEGIN marker in the style file');
    assert.strictEqual(ends.length, 1,
        'expected exactly one KIT-REGISTER-CORE:END marker in the style file');
    assert.ok(begins[0] < ends[0], 'the core BEGIN marker must precede the END marker');
    return lines.slice(begins[0] + 1, ends[0]);
}

// The whole tail of a body from its '## Before you send' header, normalized so
// the doctrine's end-of-file and the style's end-of-region compare cleanly.
function sendSegment(lines, label) {
    const at = lines.reduce((acc, l, i) => (l === SEND_HEADER ? acc.concat(i) : acc), []);
    assert.strictEqual(at.length, 1,
        `expected exactly one '${SEND_HEADER}' header in ${label}`);
    return normalize(lines.slice(at[0]).join('\n'));
}

// This frontmatter is harness contract, read when the system prompt is
// assembled, not documentation. With keep-coding-instructions false or absent
// the style strips Claude Code's built-in coding instructions from the session;
// force-for-plugin is what activates this style over the user's own outputStyle
// setting. Both are pinned to the exact bare token true, raw and unquoted: a
// truthy value is not true, and a quoted "true" is a string, not the boolean,
// to a type-strict frontmatter reader.
test('the style file carries the frontmatter pins the harness reads', () => {
    const declared = frontmatterLines().map((l) => l.slice(0, l.indexOf(':')).trim());
    assert.deepStrictEqual(declared.slice().sort(), PINNED_KEYS.slice().sort(),
        'the style\'s frontmatter must declare the four pinned keys and nothing '
        + 'else; an unpinned key is unreviewed harness input');

    assert.strictEqual(frontmatterRawValue('name'), 'Kit',
        'the style\'s name must be exactly the bare token Kit');

    const rawDescription = frontmatterRawValue('description');
    assert.ok(rawDescription.length >= 2
        && rawDescription.startsWith('"') && rawDescription.endsWith('"'),
        'the description must be double-quoted; its own colon-space makes an '
        + 'unquoted value break the entire frontmatter block as YAML');
    assert.ok(frontmatterValue('description').length > 0,
        'the style must carry a non-empty description');

    assert.strictEqual(frontmatterRawValue('keep-coding-instructions'), 'true',
        'keep-coding-instructions must be exactly the bare token true; absent, '
        + 'false, or quoted strips Claude Code\'s built-in coding instructions '
        + 'from every kit session under a type-strict reader');
    assert.strictEqual(frontmatterRawValue('force-for-plugin'), 'true',
        'force-for-plugin must be exactly the bare token true so the style '
        + 'activates wherever the kit plugin is enabled');
});

test('the style body carries exactly one core-region marker pair', () => {
    const region = coreRegionLines();
    assert.ok(region.some((l) => l.trim() !== ''),
        'the core region between the markers is empty');
});

for (const lead of CORE_LEADS) {
    test(`core bullet is present once per copy and identical: ${lead}`, () => {
        const inSkill = skillBody().split('\n').filter((l) => l.startsWith(lead));
        const inMirror = mirrorBody().split('\n').filter((l) => l.startsWith(lead));
        const inStyle = coreRegionLines().filter((l) => l.startsWith(lead));
        assert.strictEqual(inSkill.length, 1,
            'expected exactly one such bullet in the skill body');
        assert.strictEqual(inMirror.length, 1,
            'expected exactly one such bullet in the doctrine mirror');
        assert.strictEqual(inStyle.length, 1,
            'expected exactly one such bullet in the style\'s core region');
        assert.strictEqual(inMirror[0], inSkill[0],
            'the doctrine mirror has drifted from the skill on this bullet');
        assert.strictEqual(inStyle[0], inSkill[0],
            'the style\'s core region has drifted from the skill on this bullet; '
            + 'the skill is the source, so sync the style to it');
    });
}

test('the Before-you-send segment is identical in all three copies', () => {
    const fromSkill = sendSegment(skillBody().split('\n'), 'the skill body');
    const fromMirror = sendSegment(mirrorBody().split('\n'), 'the doctrine mirror');
    const fromStyle = sendSegment(coreRegionLines(), 'the style\'s core region');
    assert.strictEqual(fromMirror, fromSkill,
        'the doctrine mirror\'s Before-you-send section has drifted from the skill');
    assert.strictEqual(fromStyle, fromSkill,
        'the style\'s Before-you-send section has drifted from the skill; the '
        + 'skill is the source, so sync the style to it. This comparison runs '
        + 'from the header to end of body, which rides on Before you send being '
        + 'the doctrine\'s last section: a section appended after it in the '
        + 'doctrine fails here, and the fix is a deliberate call on where the '
        + 'core\'s boundary now sits, not a widening of this segment');
});

// Whole-element parity would still pass with an extra paraphrased paragraph
// sitting in the region, so the region's contents are pinned as a closed set:
// the seven bullets in order, then the Before-you-send section, then nothing
// but blank lines.
test('the core region holds the seven bullets then Before you send, in order and nothing else', () => {
    const region = coreRegionLines();
    const headerAt = region.indexOf(SEND_HEADER);
    assert.ok(headerAt >= 0,
        `the core region carries no '${SEND_HEADER}' section`);
    const head = region.slice(0, headerAt);

    let previous = -1;
    for (const lead of CORE_LEADS) {
        const at = head.findIndex((l) => l.startsWith(lead));
        assert.ok(at >= 0,
            `the core bullet is missing from the region, or sits after the `
            + `Before-you-send section: ${lead}`);
        assert.ok(at > previous,
            `the core bullets are out of spec order at: ${lead}`);
        previous = at;
    }

    const leftover = head.filter((l) => l.trim() !== ''
        && !CORE_LEADS.some((lead) => l.startsWith(lead)));
    assert.deepStrictEqual(leftover, [],
        'the core region carries content that is neither a core bullet nor part '
        + 'of the Before-you-send section');
});
