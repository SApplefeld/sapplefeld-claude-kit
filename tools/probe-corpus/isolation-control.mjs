#!/usr/bin/env node
// The reader isolation control. It asks a reader, through the runner's own
// invocation path, to name every instruction source it holds beyond the
// prompt, and prints the reply whole. A reader in the shape the probe set needs
// names none.
//
// The control is what makes the runner's isolation claim checkable rather than
// asserted. Four variants stand on a ladder from no configuration to this
// machine's own, and the answer is expected to change along it: a check whose
// acceptance is an empty answer proves nothing until the same question, put to
// an instance withheld from it, comes back full.
//
//   --variant bare        The runner's argument set against an empty scratch
//                         config directory with no credentials in it. The
//                         reader has nothing to authenticate with, which is why
//                         the runner copies the credentials at all: this box
//                         authenticates by OAuth and the CLI's own --bare mode
//                         takes an API key only.
//   --variant production  The runner's shape: a scratch config directory
//                         holding a copy of the credentials and nothing else,
//                         tools disabled, empty setting sources, a minimal
//                         system prompt, and an empty working directory.
//   --variant real-config The runner's own argument set against the operator's
//                         real ~/.claude, from an empty working directory. It
//                         is the rung that attributes the isolation: production
//                         and this one differ in the config directory alone, so
//                         what this reader holds beyond the prompt is what the
//                         scratch config directory removes, and what neither
//                         holds is the flags' doing.
//   --variant inherit     The least isolated call this machine can make: the
//                         real ~/.claude, the CLI's own system prompt and
//                         setting sources, and the repository as the working
//                         directory. This is the withheld instance, and what
//                         the silence of the rungs above is worth is measured
//                         against what this one says.
//
// Usage: node tools/probe-corpus/isolation-control.mjs [--variant bare|production|real-config|inherit]
//
// Every rung is invoked through the runner's own invokeReader, so the child
// environment scrub (every CLAUDE and ANTHROPIC variable dropped) applies on all
// four, the inherit rung included: what varies along the ladder is the argument
// set, the config directory and the working directory.
//
// The `inherit` and `real-config` variants spend a real reader invocation
// against the operator's own configuration directory and copy no credentials
// anywhere. The `inherit` rung is a live hooked session in this checkout: the
// kit's SessionStart and Stop hooks run for it and its transcript lands under
// the real home, so run it with no goal armed here. The other two build their scratch under the OS temp directory and
// remove it on the way out.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { invokeReader, makeReaderScratch, removeReaderScratch, resolveReaderBinary, SCRATCH_PREFIX } from './run.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The argument set the inherit rung runs under: the CLI's own system prompt and
// its own setting sources, so a CLAUDE.md, an output style, a hook or a plugin
// on this machine reaches the reader if anything can.
const INHERIT_ARGS = ['-p', '--model', 'sonnet', '--output-format', 'json'];

const PROMPT = [
    'List every instruction source you are holding right now other than this message.',
    'That means: sections of a system prompt, project or user instruction files such as',
    'a CLAUDE.md, an output style, hook or plugin text, and any standing directive.',
    'For each one, name it and quote its first ten words verbatim.',
    'If you hold none beyond this message, reply with exactly this line and nothing else:',
    'NONE BEYOND THIS MESSAGE'
].join('\n');

const VARIANTS = ['bare', 'production', 'real-config', 'inherit'];

function parseVariant(argv) {
    if (argv.length === 0) return 'production';
    if (argv[0] !== '--variant') {
        throw new Error('unknown argument ' + JSON.stringify(argv[0]) + ': this control takes --variant ' + VARIANTS.join('|'));
    }
    const value = argv[1];
    if (!VARIANTS.includes(value)) {
        throw new Error('--variant takes one of ' + VARIANTS.join(', ') + ' and was given ' + JSON.stringify(value));
    }
    return value;
}

const variant = parseVariant(process.argv.slice(2));
const homeDir = process.env.PROBE_HOME_DIR ? path.resolve(process.env.PROBE_HOME_DIR) : path.join(os.homedir(), '.claude');
const bin = resolveReaderBinary(process.env.PROBE_CLAUDE_BIN || 'claude', process.env);

let scratch = null;
let configDir = homeDir;
let cwd = variant === 'inherit' ? REPO_ROOT : os.tmpdir();
if (variant === 'production') {
    scratch = makeReaderScratch(homeDir);
    configDir = scratch.configDir;
    cwd = scratch.cwd;
} else if (variant === 'bare') {
    // The runner's own prefix, so the next run's stale sweep reaches whatever a
    // killed control leaves behind.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), SCRATCH_PREFIX));
    configDir = path.join(root, 'config');
    cwd = path.join(root, 'cwd');
    fs.mkdirSync(configDir, { mode: 0o700 });
    fs.mkdirSync(cwd, { mode: 0o700 });
    scratch = { root, configDir, cwd };
} else if (variant === 'real-config') {
    // The operator's own config directory, reached with the runner's flags from
    // an empty working directory. Nothing is copied and nothing under the home
    // directory is written.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), SCRATCH_PREFIX));
    cwd = path.join(root, 'cwd');
    fs.mkdirSync(cwd, { mode: 0o700 });
    scratch = { root, configDir, cwd };
}

const started = Date.now();
try {
    const result = invokeReader(bin, 'sonnet', PROMPT, {
        configDir,
        cwd,
        args: variant === 'inherit' ? INHERIT_ARGS : undefined
    });
    process.stdout.write('variant: ' + variant + '\n');
    process.stdout.write('reader: ' + bin + '\n');
    process.stdout.write('configDir: ' + configDir + '\n');
    process.stdout.write('cwd: ' + cwd + '\n');
    process.stdout.write('ok: ' + result.ok + '\n');
    process.stdout.write('error: ' + (result.error || 'none') + '\n');
    process.stdout.write('cost: ' + result.costUsd + '\n');
    process.stdout.write('wall_ms: ' + (Date.now() - started) + '\n');
    process.stdout.write('---- reply ----\n' + result.text + '\n---- end ----\n');
} finally {
    if (scratch) removeReaderScratch(scratch.root);
}
