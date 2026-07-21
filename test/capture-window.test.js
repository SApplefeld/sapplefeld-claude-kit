// Tests for the name-extraction seam of
// plugins/claude-kit/skills/compact-session/relay/capture-window.ps1.
//
// The Win32 window match and the console lookup are environment-dependent and
// validated live (Section 4). The session-name extraction is pure, fixture-
// testable logic and is load-bearing twice over: the name drives capture
// path 2's window match on console-less hosts, and it rides as the request's
// line-5 anchor, so a silent extraction failure leaves sessions with no
// capturable window and therefore no relay request at all.
// The script's `-NameOnly` switch prints the resolved name and exits before any
// window resolution, so this suite drives that seam over crafted JSONL.
//
// Windows-only (the script is PowerShell); skipped elsewhere.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CAP = path.join(__dirname, '..', 'plugins', 'claude-kit', 'skills',
    'compact-session', 'relay', 'capture-window.ps1');

const isWin = process.platform === 'win32';

// Resolve the session name the script extracts from a transcript built of the
// given JSONL lines. Returns the trimmed stdout ('' when no name resolves).
function extractName(lines) {
    const tmp = path.join(os.tmpdir(),
        `cap-win-${process.pid}-${Math.random().toString(36).slice(2)}.jsonl`);
    fs.writeFileSync(tmp, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
    try {
        const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', CAP, '-TranscriptPath', tmp, '-NameOnly'], { encoding: 'utf8' });
        if (r.error) throw r.error;
        return (r.stdout || '').trim();
    } finally {
        try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    }
}

const customTitle = (t) => ({ type: 'custom-title', customTitle: t, sessionId: 'x' });
const aiTitle = (t) => ({ type: 'ai-title', aiTitle: t, sessionId: 'x' });

test('extracts the custom-title', { skip: !isWin }, () => {
    assert.strictEqual(extractName([customTitle('KIT: No Compact / Stop')]), 'KIT: No Compact / Stop');
});

test('the LAST custom-title wins', { skip: !isWin }, () => {
    assert.strictEqual(extractName([customTitle('First'), customTitle('Second')]), 'Second');
});

test('falls back to ai-title when no custom-title exists', { skip: !isWin }, () => {
    assert.strictEqual(extractName([aiTitle('Auto Named')]), 'Auto Named');
});

test('custom-title takes precedence over ai-title (engine order)', { skip: !isWin }, () => {
    assert.strictEqual(extractName([aiTitle('AI'), customTitle('Real Name')]), 'Real Name');
});

test('decodes JSON escapes beyond quote/backslash (tab), so the match still fires', { skip: !isWin }, () => {
    // The old hand-rolled unescape handled only \" and \\; a title carrying a
    // tab (\t in JSON) was left encoded and the substring match against the
    // live window silently missed. ConvertFrom-Json decodes the full escape set.
    // (ASCII output only: non-ASCII round-trips fine in-process via String.Contains
    // but not through PowerShell's console-codepage stdout pipe this seam uses.)
    assert.strictEqual(extractName([customTitle('a\tb "q" \\ z')]), 'a\tb "q" \\ z');
});

test('a trailing [UNCOMPACTED] relabel is returned verbatim as the latest name', { skip: !isWin }, () => {
    // Post-relabel the extractor reports the tagged name; the window match then
    // excludes any [UNCOMPACTED] window, which is why capture must run first.
    assert.strictEqual(
        extractName([customTitle('MCP: Chapter 3'), customTitle('[UNCOMPACTED] MCP: Chapter 3')]),
        '[UNCOMPACTED] MCP: Chapter 3');
});

test('an unnamed session yields no name (capture exits 1; the caller writes no request)', { skip: !isWin }, () => {
    assert.strictEqual(extractName([{ type: 'user', message: { role: 'user', content: 'hi' } }]), '');
});

test('a huge non-title line is skipped, not parsed as a title', { skip: !isWin }, () => {
    const huge = { type: 'assistant', message: { role: 'assistant', content: 'x'.repeat(20000) + ' "custom-title" mentioned in prose' } };
    assert.strictEqual(extractName([customTitle('Real'), huge]), 'Real');
});
