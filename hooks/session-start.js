#!/usr/bin/env node
// SessionStart hook: compaction/startup recovery.
// Scans docs/plans/ for in-progress plan docs and injects an instruction to
// re-read them (including Chapters) before any work proceeds. Fires on
// startup, resume, and — critically — after compaction.
// Cross-platform: Node core modules only, no dependencies. Never blocks:
// any failure exits 0 with no output.

'use strict';

const fs = require('fs');
const path = require('path');

// Read Hook Input from stdin.
function readStdin() {
    try {
        return fs.readFileSync(0, 'utf8');
    } catch {
        return '';
    }
}

function main() {
    // Parse Hook Payload.
    let payload = {};
    try {
        payload = JSON.parse(readStdin() || '{}');
    } catch {
        // Malformed payload — proceed with defaults.
    }

    const cwd = payload.cwd || process.cwd();
    const source = payload.source || 'startup';
    const plansDir = path.join(cwd, 'docs', 'plans');

    // Find In-Progress Plan Docs.
    const activePlans = [];
    try {
        const entries = fs.readdirSync(plansDir).filter((f) => f.toLowerCase().endsWith('.md'));
        for (const file of entries) {
            try {
                // Only the header matters; read the first 2KB.
                const fd = fs.openSync(path.join(plansDir, file), 'r');
                const buf = Buffer.alloc(2048);
                const bytes = fs.readSync(fd, buf, 0, 2048, 0);
                fs.closeSync(fd);
                const head = buf.toString('utf8', 0, bytes);
                if (/status:\s*in\s*progress/i.test(head)) {
                    const model = /commit model:\s*(.+)/i.exec(head);
                    activePlans.push({ file, model: model ? model[1].trim() : 'unknown' });
                }
            } catch {
                // Unreadable file — skip it.
            }
        }
    } catch {
        // No docs/plans directory — nothing to recover.
    }

    // Emit Additional Context.
    if (activePlans.length === 0) return;

    const lines = activePlans.map(
        (p) => `- docs/plans/${p.file} (Commit Model: ${p.model})`
    );
    const reason = source === 'compact'
        ? 'Context was just compacted.'
        : 'Session is starting.';
    const context = [
        `${reason} This project has in-progress plan doc(s):`,
        ...lines,
        'Before doing ANY work: read the plan doc(s) in full, including all Chapters — they are the authoritative record of completed sections, decisions, and the commit model in effect. Resume from the Next entry of the latest Chapter. Follow the executing-work skill.'
    ].join('\n');

    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: context
        }
    }));
}

try {
    main();
} catch {
    // Never break a session over a hook.
}
process.exit(0);
