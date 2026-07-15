#!/usr/bin/env node
// SessionStart hook: keep the Code-surface operating doctrine current, always-on.
//
// The doctrine is single-sourced as the operating-instructions skill (which rides
// plugin auto-update to every surface). On Claude Code we want it ALWAYS-ON, not
// on-demand, so this hook maintains a stable, kit-owned file that the user's
// ~/.claude/CLAUDE.md imports:
//
//   1. Read the installed skill's SKILL.md from CLAUDE_PLUGIN_ROOT, strip the YAML
//      frontmatter, and write the body to ~/.claude/claude-kit-doctrine.md whenever
//      it differs. Reading from CLAUDE_PLUGIN_ROOT each session means the current
//      (auto-updated) plugin is always the source, so the version-stamped cache path
//      never leaks into the import and the import line never goes stale.
//   2. If ~/.claude/CLAUDE.md does not import that file yet, OFFER (never silently
//      perform) to add the one-line `@claude-kit-doctrine.md` import. The doctrine
//      file is kit-owned and safe to overwrite silently; the user's personal
//      CLAUDE.md is not, so touching it stays consent-gated at the agent layer.
//
// SAFETY: fails OPEN and silent. Missing skill, unreadable/unwritable paths, an
// up-to-date file with the import already present, or any error -> exit 0, no output.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DOCTRINE_FILE = 'claude-kit-doctrine.md';     // kit-owned, lives in ~/.claude
const IMPORT_TOKEN = '@claude-kit-doctrine.md';      // the line ~/.claude/CLAUDE.md needs

function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// Locate the installed operating-instructions skill. Prefer the plugin root the
// host provides; fall back to this file's own location.
function skillPath() {
    const rel = path.join('skills', 'operating-instructions', 'SKILL.md');
    const candidates = [];
    if (process.env.CLAUDE_PLUGIN_ROOT) candidates.push(path.join(process.env.CLAUDE_PLUGIN_ROOT, rel));
    candidates.push(path.join(__dirname, '..', rel));
    for (const f of candidates) {
        try { if (fs.statSync(f).isFile()) return f; } catch { /* try next */ }
    }
    return null;
}

// Drop a leading YAML frontmatter block (--- ... ---) and one blank line after it.
function stripFrontmatter(text) {
    const lines = text.split('\n');
    if ((lines[0] || '').trim() !== '---') return text;
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') { end = i; break; }
    }
    if (end === -1) return text;                      // no closing fence: leave as-is
    return lines.slice(end + 1).join('\n').replace(/^\r?\n/, '');
}

function main() {
    try { JSON.parse(readStdin() || '{}'); } catch { /* payload unused; ignore */ }

    const sp = skillPath();
    if (!sp) return;                                  // skill not installed: silent

    let body;
    try { body = stripFrontmatter(fs.readFileSync(sp, 'utf8').replace(/^\uFEFF/, '')); }
    catch { return; }
    if (!body.trim()) return;                         // empty doctrine: nothing to do

    const claudeDir = path.join(os.homedir(), '.claude');
    const doctrinePath = path.join(claudeDir, DOCTRINE_FILE);

    // 1. Refresh the kit-owned doctrine file silently when it drifts.
    try {
        let current = null;
        try { current = fs.readFileSync(doctrinePath, 'utf8'); } catch { /* absent */ }
        if (current !== body) {
            fs.mkdirSync(claudeDir, { recursive: true });
            fs.writeFileSync(doctrinePath, body, 'utf8');
        }
    } catch { /* unwritable home: give up quietly, never block */ }

    // 2. Offer to wire the import if the user's CLAUDE.md does not have it.
    let userClaudeMd = null;
    try { userClaudeMd = fs.readFileSync(path.join(claudeDir, 'CLAUDE.md'), 'utf8'); } catch { /* absent */ }
    if (userClaudeMd !== null && userClaudeMd.includes(IMPORT_TOKEN)) return; // already wired: silent

    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext:
                `Kit doctrine not wired in: the operating doctrine is installed and auto-refreshed at ` +
                `~/.claude/${DOCTRINE_FILE}, but ~/.claude/CLAUDE.md does not import it, so it is not loading ` +
                `always-on here. Offer to add the single line "${IMPORT_TOKEN}" to ~/.claude/CLAUDE.md ` +
                `(creating the file if absent), and act ONLY on the user's explicit approval - it is their ` +
                `personal config. Once added, the doctrine loads always-on and stays current automatically. ` +
                `If the user declines, do not raise it again this session.`
        }
    }));
}

try { main(); } catch { /* never break a session over a hook */ }
process.exit(0);
