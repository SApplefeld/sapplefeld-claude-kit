#!/usr/bin/env node
// The scenario-probe runner: it reads the frozen probe set under test/probes/,
// snapshots each probe's context shape into a scratch directory, hands the
// snapshot to a cold reader at the probe's tier, and diffs the reader's verdict
// against the answer the operator ruled. The exit code is the number of
// mismatches on probes whose ruling the operator has settled, capped at 100, so
// a run is a gate reading rather than a blocker. A mismatch on a probe still
// carrying a proposed ruling is reported and never counted: the ruling is the
// thing that would have to be true for the disagreement to mean the corpus
// moved, and until the operator rules it, the probe's answer is a proposal. A
// shape a probe marks `designed-mismatch` is the other uncounted case: it is
// built to expose a narrow context's own defect, so its disagreement is the
// reading it exists to take, and its agreement is the finding instead.
//
// The no-intent-story bar governs every prompt this file composes. The reader
// receives the scenario and the shape's files and nothing else: no statement of
// what the documents were meant to say, no earlier reading, no expected answer,
// no word that the reading is a test of a change. A reader handed the intent
// confirms the intent, and the instrument is then measuring itself. That is why
// the template is fixed on disk, why the probe's ruled answer never enters the
// prompt, and why the only closed list the reader sees is the probe's own
// options, in the probe file's own order.
//
// Isolation of the reader is the other half. The reader runs with tools
// disabled, so every byte it holds about the corpus is a byte this runner put
// in the prompt; with the setting sources emptied and a minimal system prompt
// in place of the CLI's own, which is what keeps this machine's CLAUDE.md,
// output style, hooks and plugin instructions out of it; from a fresh empty
// working directory under the OS temp directory, whose ancestor chain the run
// walks and reports, since a CLAUDE.md above the temp root would be discovered
// from there like any other; and with a scratch CLAUDE_CONFIG_DIR holding a
// copy of the credentials and nothing else, which keeps the reader off the
// operator's own settings and session state. isolation-control.mjs beside this
// file is what those claims are measured by, rung by rung.
//
// The scratch directory holding that credential copy lives under the OS temp
// directory at mode 0700 rather than inside the run directory: the run
// directory is the evidence artifact a reader of the report opens, and a
// short-lived copy of a live OAuth token has no business sitting in it. The
// copy is removed when the run ends, when the process is interrupted, and by
// the stale sweep at the next run's start.
//
// Zero dependencies, ESM, no shell anywhere: git and the reader CLI are spawned
// with argument arrays, matching the git boundary in
// plugins/claude-kit/hooks/kit-git-lib.js (gitRun). That guard's spawn working
// directory is its own hooks directory, which sits outside the repository it
// asks about; this file sits inside the repository it reads, so it spawns git
// from the directory the resolved git binary itself lives in. The containment
// judgment on every file read out of the worktree or the home directory is that
// boundary's own guard, containedRealPath from
// plugins/claude-kit/hooks/kit-read-lib.js, called rather than restated.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { listProbeFiles, parseProbeFile, RULING_STATES, PLUGIN_PREFIX, HOME_ENTRY, SLUG, TIERS } from './probe-file.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
export const PROBES_DIR = path.join(REPO_ROOT, 'test', 'probes');
export const TEMPLATE_PATH = path.join(HERE, 'template.md');
export const RUNS_DIR = path.join(REPO_ROOT, '.kit', 'probe-runs');

// A reader gets five minutes. A slower reply is recorded as an ERROR pair
// rather than stalling a run whose whole point is to be cheap to repeat.
export const READER_TIMEOUT_MS = 300000;
export const MAX_EXIT = 100;
export const MAX_REPLY_BYTES = 8 * 1024 * 1024;

const KNOWN_FLAGS = ['--before', '--only', '--shape', '--claude', '--home', '--dry-run'];

// ---------------------------------------------------------- the read guard

const requireFromHere = createRequire(import.meta.url);
let containedRealPath = null;

// The containment rule for a path this runner is about to read: the real path
// when it still lies inside rootDir once every link on both sides is resolved,
// and null when it does not. The guard is the hooks' own, loaded on first use
// so that the pure functions here stay importable in a tree that carries no
// plugin directory.
function containedPath(rootDir, filePath) {
    if (containedRealPath === null) {
        const lib = path.join(REPO_ROOT, 'plugins', 'claude-kit', 'hooks', 'kit-read-lib.js');
        containedRealPath = requireFromHere(lib).containedRealPath;
    }
    return containedRealPath(rootDir, filePath);
}

// ---------------------------------------------------------------- arguments

// Parse the CLI. Every refusal names the rule that refused it, because the
// caller is a human at a terminal and "invalid arguments" sends them to read
// this file.
export function parseArgs(argv) {
    const out = { before: null, only: null, shape: null, claude: null, home: null, dryRun: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--dry-run') { out.dryRun = true; continue; }
        if (!KNOWN_FLAGS.includes(arg)) {
            throw new Error('unknown flag ' + JSON.stringify(arg) + ': this runner takes only ' + KNOWN_FLAGS.join(', '));
        }
        const value = argv[i + 1];
        i += 1;
        if (value === undefined) throw new Error(arg + ' takes a value and none followed it');
        // A flag standing where a value belongs is a value the caller left out,
        // and swallowing it would run the whole set under a silently dropped
        // narrowing flag.
        if (KNOWN_FLAGS.includes(value)) {
            throw new Error(arg + ' takes a value and the next word is the flag ' + JSON.stringify(value) + ': the value is missing');
        }
        if (value === '') {
            const why = arg === '--before' ? 'an empty --before would read the worktree while the caller believes a ref ran'
                : arg === '--shape' ? 'an empty --shape narrows nothing'
                : arg === '--only' ? 'an empty --only names no moment'
                : 'the flag takes a value';
            throw new Error(arg + ' was given an empty value: ' + why);
        }
        if (arg === '--before') {
            if (value.startsWith('-')) {
                throw new Error('--before value ' + JSON.stringify(value) + ' starts with a dash: a git ref is never dash-leading, and passing one on would let git read it as an option');
            }
            out.before = value;
        } else if (arg === '--only') {
            out.only = value.split(',').map((s) => s.trim()).filter((s) => s !== '');
            if (out.only.length === 0) throw new Error('--only was given no moment names');
        } else if (arg === '--shape') {
            out.shape = value;
        } else if (arg === '--home') {
            out.home = value;
        } else {
            out.claude = value;
        }
    }
    return out;
}

// The reader CLI this run drives: the flag wins over the environment variable,
// and the plain name resolved on PATH is the fallback.
export function resolveClaudeBin(args, env) {
    if (args && args.claude) return args.claude;
    const fromEnv = (env || {}).PROBE_CLAUDE_BIN;
    if (fromEnv) return fromEnv;
    return 'claude';
}

// The directory a `home/<name>` shape entry is read from and the credentials
// are copied from: the flag, then PROBE_HOME_DIR, then this machine's own
// ~/.claude. The flag and the variable exist so a caller (the suite above all)
// can point the whole run at a fixture home and touch nothing of the
// operator's.
export function resolveHomeDir(args, env) {
    if (args && args.home) return path.resolve(args.home);
    const fromEnv = (env || {}).PROBE_HOME_DIR;
    if (fromEnv) return path.resolve(fromEnv);
    return path.join(os.homedir(), '.claude');
}

// The filename spellings PATH can offer for the reader binary, in the order the
// platform itself would try them. The CLI is a native executable, so a bare name
// plus the Windows executable suffix is the whole list: a .cmd or .bat shim
// cannot be spawned without a shell, and this file spawns none. On Windows the
// suffixed spelling comes first, because that is the one the platform runs for a
// bare name, and a suffixless file sitting beside it is data rather than the
// program a caller naming `git` or `claude` meant.
const READER_BIN_SUFFIXES = process.platform === 'win32' ? ['.exe', ''] : [''];

// The reader binary as an absolute path to a file that exists, resolved before
// any pair is recorded. A name that resolves to nothing aborts the run with the
// reason, rather than turning every pair into an ERROR row that reads like a
// corpus-wide regression.
export function resolveReaderBinary(bin, env) {
    const candidates = [];
    if (path.isAbsolute(bin) || bin.includes('/') || bin.includes('\\')) {
        for (const suffix of READER_BIN_SUFFIXES) candidates.push(path.resolve(bin + suffix));
    } else {
        const environment = env || {};
        const pathVar = environment.PATH || environment.Path || '';
        for (const dir of pathVar.split(path.delimiter)) {
            if (!dir) continue;
            for (const suffix of READER_BIN_SUFFIXES) candidates.push(path.resolve(dir, bin + suffix));
        }
    }
    for (const candidate of candidates) {
        let isFile = false;
        try { isFile = fs.statSync(candidate).isFile(); } catch { /* not this one */ }
        if (isFile) return candidate;
    }
    throw new Error('the reader ' + JSON.stringify(bin) + ' resolves to no file'
        + (candidates.length === 1 ? ' at ' + candidates[0] : ' on PATH')
        + ': name it with --claude <path> or PROBE_CLAUDE_BIN');
}

// ---------------------------------------------------------------------- git

// The git binary as an absolute path, resolved once and reused for every call
// of a run. A bare name is resolved by the platform at each spawn against a
// search order this file does not own, and on Windows that order reaches the
// spawn's working directory first, so a resolved absolute path is what makes the
// binary the run spawns the one the resolution named.
let gitBinary = null;

export function resolveGitBinary(env) {
    if (gitBinary !== null) return gitBinary;
    try {
        gitBinary = resolveReaderBinary('git', env || process.env);
    } catch {
        throw new Error('git resolves to no file on the PATH this run holds, and reading a --before ref spawns it');
    }
    return gitBinary;
}

// Run git with an argument array and no shell, against repoDir. The GIT_* scrub,
// the terminal-prompt suppression and the timeout follow the boundary guard in
// plugins/claude-kit/hooks/kit-git-lib.js, and the repository is named with `-C`
// rather than entered. The spawn runs from the directory holding the resolved
// git binary: that guard runs from its own hooks directory, which is outside the
// repository it asks about, and this file is inside the repository it reads, so
// the binary's own directory is what stands in as a working directory the
// inspected tree does not write to. The difference from that guard is that this
// caller needs raw bytes and git's own stderr, which it drops.
export function gitBytes(repoDir, args, options) {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
        if (/^GIT_/i.test(key)) delete env[key];
    }
    env.GIT_TERMINAL_PROMPT = '0';
    env.NoDefaultCurrentDirectoryInExePath = '1';
    const binary = resolveGitBinary(env);
    const res = spawnSync(binary, ['-C', repoDir].concat(args), {
        cwd: path.dirname(binary),
        timeout: (options && options.timeoutMs) || 30000,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env
    });
    if (!res || res.error || res.signal) {
        const why = (res && res.error && res.error.message) || (res && res.signal) || 'git did not run';
        return { status: null, stdout: Buffer.alloc(0), stderr: String(why) };
    }
    return { status: res.status, stdout: res.stdout, stderr: res.stderr.toString('utf8') };
}

// A ref is usable only when git itself resolves it to a commit. The check is
// `rev-parse --verify --quiet <ref>^{commit}`, which is exact: it refuses a ref
// that does not exist and a tag object naming no commit, and it never falls
// back to reading the value as a path. The commit it prints is what every later
// read names, so a branch that moves mid-run cannot make two pairs read two
// different trees.
export function verifyRef(repoDir, ref, runner) {
    const git = runner || gitBytes;
    const res = git(repoDir, ['rev-parse', '--verify', '--quiet', ref + '^{commit}']);
    if (res.status !== 0) {
        throw new Error('--before value ' + JSON.stringify(ref) + ' is not a commit in this repository: git rev-parse --verify --quiet ' + ref + '^{commit} exited ' + res.status);
    }
    return res.stdout.toString('utf8').trim();
}

// ------------------------------------------------------------ file sourcing

// Line endings are normalised to LF on the way in. On a checkout with
// core.autocrlf on, the worktree holds CRLF and the blob `git show` prints
// holds LF, so the same unchanged file read the two ways differs in every line
// ending. A before-and-after pair has to differ only where the corpus changed,
// and a reader has no use for the difference either way.
export function normaliseEol(bytes) {
    if (bytes.includes(0)) return bytes;
    const text = bytes.toString('utf8');
    return text.includes('\r\n') ? Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8') : bytes;
}

// The two things git says when a path is simply not in the tree named. Any
// other failure (a timeout, a crash, a corrupt object) is a fault in the run
// rather than a fact about the tree, and recording it as an absence would hand
// the reader an empty document set and call the reading a result.
const GIT_PATH_ABSENT = /does not exist in|exists on disk, but not in/;

export function isPathAbsentAtRef(res) {
    return res.status === 128 && GIT_PATH_ABSENT.test(String(res.stderr || ''));
}

// The entry modes `git ls-tree` prints. A shape file is a regular file, blob
// mode with or without the executable bit; a link is the mode the ref mode
// refuses, since the bytes behind it are a path rather than corpus text. Any
// other mode is refused by name rather than read, so a mode this list does not
// know stops the run instead of reaching the reader as a document.
export const GIT_LINK_MODE = '120000';
export const GIT_FILE_MODES = ['100644', '100755'];

// A shape file path as a probe file is allowed to spell it: under the plugin
// root or `home/<name>.md`, forward slashes, and no segment that navigates. The
// judgment runs in both modes and before anything touches git or the filesystem,
// because each mode has its own way of honouring a navigating path. `git show
// <commit>:<path>` neither refuses a `..` segment nor reads the file the caller
// named: it resolves the argument as something else and exits 0 with content.
// And the scratch copy is written at a path joined from the same string, which
// normalises its way out of the run directory, where an absent file written as
// an empty buffer truncates whatever it lands on.
//
// The two roots are the parser's own, imported rather than restated. A probe
// file reaching this runner has been through the parser, but `runProbes` takes
// probes as objects and a caller composing them itself is the shape a library
// entry point has to be safe under: with the navigation rule alone,
// `home/.credentials.json`, `.git/config` and `.env` are all spellings that
// navigate nowhere, and each of them is a secret or a repository internal copied
// into a prompt and handed to a reader.
export function refuseUnsafeShapePath(relPath) {
    const raw = String(relPath === null || relPath === undefined ? '' : relPath);
    const refuse = (why) => {
        throw new Error('shape file ' + raw + ' is refused: ' + why + '. A shape file path sits under '
            + PLUGIN_PREFIX + ' or names a home/<name>.md file under ~/.claude,'
            + ' written with forward slashes and no segment that navigates');
    };
    if (raw === '') refuse('it is empty');
    if (raw.includes('\\')) refuse('it carries a backslash');
    if (path.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) refuse('it is an absolute path');
    for (const segment of raw.split('/')) {
        if (segment === '') refuse('it carries an empty segment');
        if (segment === '.' || segment === '..') refuse('it carries a ' + JSON.stringify(segment) + ' segment');
    }
    if (raw.startsWith('home/')) {
        if (!HOME_ENTRY.test(raw)) {
            refuse('a home/ entry names one markdown file directly under ~/.claude');
        }
        return raw;
    }
    if (!raw.startsWith(PLUGIN_PREFIX)) {
        refuse('it sits outside ' + PLUGIN_PREFIX);
    }
    return raw;
}

// The three fields of a probe that leave this runner for somewhere they have to
// be safe, checked where `runProbes` receives them rather than only where the
// parser produces them: `moment` and a shape's `name` are joined into the run
// directory as directory components, and `tier` is handed to the reader as its
// `--model` argument. A run started from the CLI reads probes through the
// parser, which holds all three already; a library caller composing its own
// probes never passes it, and the file-path allowlist is re-applied at the read
// boundary for that same reason. The two vocabularies are the parser's own,
// imported rather than restated.
export function refuseUnsafeProbeFields(probe) {
    const moment = String(probe && probe.moment === undefined ? '' : probe.moment);
    if (!SLUG.test(moment)) {
        throw new Error('probe moment ' + JSON.stringify(moment) + ' is refused: a moment is a lower-case hyphenated'
            + ' slug, and it becomes a directory component of the run directory');
    }
    if (!TIERS.includes(probe.tier)) {
        throw new Error('the tier ' + JSON.stringify(probe.tier) + ' in probe ' + moment + ' is refused: a tier is one of '
            + TIERS.join(', ') + ', and it is handed to the reader as its model');
    }
    for (const shape of probe.shapes || []) {
        const name = String(shape && shape.name === undefined ? '' : shape.name);
        if (!SLUG.test(name)) {
            throw new Error('shape name ' + JSON.stringify(name) + ' in probe ' + moment + ' is refused: a shape name'
                + ' is a lower-case hyphenated slug, and it becomes a directory component of the run directory');
        }
    }
}

// Whether a file path lies inside a root by the names alone, asked before the
// filesystem is asked anything at all. A path that escapes is refused whether or
// not its target exists, and no probe of the escaping path is made to find out.
// The root itself is not inside it: the question is only ever asked about a file
// to read, and the separator the check appends is also what keeps a sibling
// directory whose name merely starts with the root's out.
export function withinRoot(rootDir, absPath) {
    const root = path.resolve(rootDir);
    const target = path.resolve(absPath);
    return target.startsWith(root + path.sep);
}

// Where a shape file's copy is written inside the run directory. The path
// judgment above refuses every spelling that could escape; this asks the same
// question of the resolved path about to be written, because the write is what
// reaches outside the run directory and an absent file is written as an empty
// buffer.
export function shapeCopyPath(shapeDir, relPath) {
    const root = path.resolve(shapeDir);
    const dest = path.resolve(shapeDir, relPath);
    if (dest === root || !dest.startsWith(root + path.sep)) {
        throw new Error('shape file ' + relPath + ' is refused: its copy would be written to ' + dest
            + ', which is not under the run directory ' + root);
    }
    return dest;
}

// A file read out of a directory the runner is allowed to read, judged in the
// order the judgments are safe to make: containment by the names first, then
// existence, then what the entry actually is. Reading existence first books an
// escaping path whose target is missing as an ordinary absence row and lets the
// run carry on, and the existence probe itself reaches outside the root to
// answer. A path that is there but reaches its target through a link, or names a
// directory rather than a file, is refused by name: a shape file is corpus text,
// and a shape that can name any file on the machine is a reader handed whatever
// the path points at.
function readContained(absPath, rootDir, relPath, source) {
    if (!withinRoot(rootDir, absPath)) {
        throw new Error('shape file ' + relPath + ' is refused: ' + absPath + ' is not under ' + rootDir);
    }
    let stat = null;
    try {
        stat = fs.lstatSync(absPath);
    } catch (err) {
        // The two errors that mean the tree simply does not carry the path: it
        // is not there, and a component of it is a file rather than a directory.
        // Every other failure is a fault in the run rather than a fact about the
        // tree, exactly as a git failure that is not an absent path is under
        // --before, and recording a permission refusal or an unreadable name as
        // an absence would hand the reader a document set short of a file and
        // call the reading a result.
        const code = err && err.code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') {
            throw new Error('reading ' + relPath + ' from ' + rootDir + ' failed ('
                + (code || 'unknown') + '): ' + String(err && err.message ? err.message : err));
        }
        return { source, absent: true, bytes: Buffer.alloc(0) };
    }
    if (stat.isSymbolicLink()) {
        throw new Error('shape file ' + relPath + ' is refused: ' + absPath + ' is a link, and a shape file is read as the corpus text it names rather than through a link');
    }
    if (stat.isDirectory()) {
        throw new Error('shape file ' + relPath + ' is refused: ' + absPath + ' is a directory, and a shape names the files a reader is handed rather than the directories they sit in');
    }
    if (containedPath(rootDir, absPath) === null) {
        throw new Error('shape file ' + relPath + ' is refused: ' + absPath + ' does not resolve inside ' + rootDir);
    }
    return { source, absent: false, bytes: normaliseEol(fs.readFileSync(absPath)) };
}

// Where one shape file's bytes come from. `home/<name>` is a file under
// ~/.claude, which has no git ref, so it is read live in both modes and marked
// live in the report. Everything else is repo-relative: the worktree by
// default, and `git show <commit>:<path>` under --before.
//
// Under --before two questions are asked about the object before its bytes are
// taken. `git cat-file -t` names a directory as the tree it is, and `git show`
// on a tree prints a directory listing, which would otherwise reach the reader
// as the file's corpus text. `git ls-tree` names the entry's mode, and a link
// committed to the tree is a blob whose bytes are its target path, which
// `cat-file -t` calls a blob like any other: without the mode read, a link the
// worktree mode refuses by name would reach the reader at a ref as a one-line
// document naming a path on somebody's machine.
export function readShapeFile(relPath, ctx) {
    refuseUnsafeShapePath(relPath);
    if (relPath.startsWith('home/')) {
        const abs = path.join(ctx.homeDir, relPath.slice('home/'.length));
        return readContained(abs, ctx.homeDir, relPath, 'live');
    }
    if (ctx.before) {
        const git = ctx.git || gitBytes;
        const spec = ctx.before + ':' + relPath;
        const typed = git(ctx.repoRoot, ['cat-file', '-t', spec]);
        if (typed.status !== 0) {
            if (isPathAbsentAtRef(typed)) return { source: 'ref', absent: true, bytes: Buffer.alloc(0) };
            throw new Error('reading ' + relPath + ' at ' + ctx.before + ' failed: git cat-file -t exited '
                + typed.status + ': ' + String(typed.stderr || '').trim().slice(0, 300));
        }
        const kind = typed.stdout.toString('utf8').trim();
        if (kind !== 'blob') {
            throw new Error('shape file ' + relPath + ' is refused: at ' + ctx.before + ' it names a '
                + JSON.stringify(kind) + ' rather than a file');
        }
        const listed = git(ctx.repoRoot, ['ls-tree', ctx.before, '--', relPath]);
        if (listed.status !== 0) {
            throw new Error('reading ' + relPath + ' at ' + ctx.before + ' failed: git ls-tree exited '
                + listed.status + ': ' + String(listed.stderr || '').trim().slice(0, 300));
        }
        const mode = listed.stdout.toString('utf8').trim().split(/\s+/)[0];
        if (mode === GIT_LINK_MODE) {
            throw new Error('shape file ' + relPath + ' is refused: at ' + ctx.before + ' it is a link, and a shape'
                + ' file is read as the corpus text it names rather than through a link');
        }
        if (!GIT_FILE_MODES.includes(mode)) {
            throw new Error('shape file ' + relPath + ' is refused: at ' + ctx.before + ' git ls-tree names its mode '
                + JSON.stringify(mode) + ', and a shape file is a regular file in the tree');
        }
        const res = git(ctx.repoRoot, ['show', spec]);
        if (res.status !== 0) {
            if (isPathAbsentAtRef(res)) return { source: 'ref', absent: true, bytes: Buffer.alloc(0) };
            throw new Error('reading ' + relPath + ' at ' + ctx.before + ' failed: git show exited '
                + res.status + ': ' + String(res.stderr || '').trim().slice(0, 300));
        }
        return { source: 'ref', absent: false, bytes: normaliseEol(res.stdout) };
    }
    const abs = path.join(ctx.repoRoot, relPath);
    return readContained(abs, ctx.repoRoot, relPath, 'worktree');
}

// ------------------------------------------------------------------- prompt

// The template with its HTML comments removed: the header block states the
// no-intent-story bar to whoever edits the template, and the reader has no use
// for it.
export function stripComments(text) {
    return text.replace(/<!--[\s\S]*?-->\n?/g, '');
}

const PLACEHOLDERS = /\{\{(SCENARIO|FILE_LIST|OPTIONS|DOCUMENTS)\}\}/g;

// The four placeholders are filled in one pass over the template, through a
// function replacer.
//
// One pass, because a scenario or a document that carries a placeholder literal
// would otherwise be walked by the passes that follow it and have its own text
// substituted in place of the template's. A function replacer, because a string
// replacement reads `$&`, `$'`, `` $` `` and `$$` in the replacement as
// substitution patterns, and the corpus under test is prose about shell and git
// syntax carrying all four, so a string replacement hands the reader a document
// with a passage of itself spliced in.
export function composePrompt(template, probe, files) {
    const documents = files.map((f) => {
        const header = f.absent
            ? '===== FILE: ' + f.path + ' (this file does not exist in the set) ====='
            : '===== FILE: ' + f.path + ' =====';
        return header + '\n' + (f.absent ? '' : f.text) + '\n';
    }).join('\n');
    const values = {
        SCENARIO: () => probe.scenario.trim(),
        FILE_LIST: () => files.map((f) => f.path).join(', '),
        OPTIONS: () => probe.options.map((o) => '- ' + o).join('\n'),
        DOCUMENTS: () => documents
    };
    return stripComments(template).replace(PLACEHOLDERS, (whole, name) => values[name]());
}

// --------------------------------------------------------------- reply parse

const VERDICT_TOKENS = ['RESOLVED', 'CONTESTED', 'SILENT'];

// An ANSWER line as the closed list spells it. Readers wrap the value in
// backticks or quotes about as often as they do not, and the wrapping is
// presentation rather than a different answer.
//
// Wrapping is the whole of it. Trailing punctuation is left where it is, so
// `send-without-asking.` is a mismatch against `send-without-asking`: an option
// is a closed-list token the template asks for verbatim, and a reader that
// wrote a sentence instead answered in prose. Stripping the period would make
// the instrument quietly accept a reply that did not follow the contract, which
// is the reading the contract exists to distinguish.
export function normaliseAnswer(value) {
    let out = String(value === null || value === undefined ? '' : value).trim();
    for (;;) {
        const stripped = out.replace(/^[`'"‘“]+/, '').replace(/[`'"’”]+$/, '').trim();
        if (stripped === out) return out;
        out = stripped;
    }
}

// The three contract lines out of a reply. The last VERDICT line wins, and the
// answer is the last ANSWER line after it: a reader that quotes the instruction
// back before answering writes both tokens more than once, and the block it
// ended on is its answer. Taking the last ANSWER anywhere in the reply would
// pair a verdict from the closing block with an answer from a rehearsal above
// it, which is a reading neither block gave.
export function parseReply(text) {
    const lines = String(text || '').split(/\r?\n/);
    let verdict = null;
    let answer = null;
    const cites = [];
    for (const line of lines) {
        const trimmed = line.trim().replace(/^[*\-\s]*/, '').replace(/\*\*/g, '');
        const v = /^VERDICT:\s*(.+)$/i.exec(trimmed);
        if (v) {
            const token = v[1].trim().toUpperCase().split(/\s+/)[0].replace(/[^A-Z]/g, '');
            if (VERDICT_TOKENS.includes(token)) {
                verdict = token;
                answer = null;
            }
            continue;
        }
        const a = /^ANSWER:\s*(.+)$/i.exec(trimmed);
        if (a) { answer = normaliseAnswer(a[1]); continue; }
        const c = /^CITES:\s*(.+)$/i.exec(trimmed);
        if (c) {
            const rest = c[1].trim();
            const split = /^([^:]+):\s*(.*)$/.exec(rest);
            cites.push(split ? { path: split[1].trim(), passage: split[2].trim() } : { path: null, passage: rest });
        }
    }
    return { verdict, answer, cites, unparsed: verdict === null };
}

// Match is the verdict token equal and the answer equal, both trimmed and
// case-insensitive. Anything else is a mismatch, and a reply with no verdict
// line is the mismatch recorded as UNPARSED.
export function diffReading(probe, parsed) {
    if (parsed.unparsed) return { status: 'UNPARSED', match: false };
    const sameVerdict = parsed.verdict === String(probe.verdict).trim().toUpperCase();
    const sameAnswer = normaliseAnswer(parsed.answer).toLowerCase() === String(probe.answer).trim().toLowerCase();
    const match = sameVerdict && sameAnswer;
    return { status: match ? 'match' : 'mismatch', match };
}

// The ruling state a mismatch has to carry to reach the exit code. The states a
// probe file may carry are the parser's own list, imported rather than restated;
// a set whose vocabulary loses this member stops the runner here rather than
// leaving it counting against a token no probe can carry.
export const COUNTED_RULING_STATE = 'ruled';
if (!RULING_STATES.includes(COUNTED_RULING_STATE)) {
    throw new Error('the probe file parser knows the ruling states ' + RULING_STATES.join(', ')
        + ', and this runner counts mismatches on ' + COUNTED_RULING_STATE + ', which is not among them');
}

function rulingState(pair) {
    return pair && pair.ruling ? pair.ruling.state : null;
}

// The reading's status once the shape it was taken under is known. A shape
// carrying a `designed-mismatch` slug is one built to expose a narrow context's
// own defect, and a probe's answer is one answer across all of its shapes, so
// that shape reads against the answer by design: the disagreement is reported as
// `designed` and counted apart from both mismatch counts, since a ruled probe
// whose designed shape reddened the exit code on every run forever would be a
// gate nobody could ever clear.
//
// The agreement is the news there. A designed shape whose reader now agrees with
// the answer is a red that stopped being red, which is either the defect fixed or
// the shape no longer reaching the moment, so it is reported as `designed-agreed`
// and counted like any other mismatch under the probe's ruling state.
//
// A reply with no verdict line is neither: it is the absence of a reading rather
// than a reading that disagreed, so it stays UNPARSED whatever the shape was
// built for.
export function designedStatus(status, designedMismatch) {
    if (!designedMismatch) return status;
    if (status === 'mismatch') return 'designed';
    if (status === 'match') return 'designed-agreed';
    return status;
}

const MISMATCH_STATUSES = ['mismatch', 'UNPARSED', 'designed-agreed'];

function isMismatch(pair) {
    return MISMATCH_STATUSES.includes(pair.status);
}

// A mismatch is a reading that disagreed with the ruling. An ERROR is the
// absence of a reading, which is a fault in the run rather than a fact about
// the corpus, so the two are counted apart: folding them together makes an
// expired token read as the corpus moving under every probe at once. A dry run
// invokes no reader, so its pairs are neither.
//
// A probe whose ruling is still proposed is the third case. Its answer is a
// proposal the operator has not settled, so a reader disagreeing with it is a
// reading worth reporting and worth nothing as a gate: it is counted apart from
// the ruled mismatches and never reaches the exit code.
export function countMismatches(pairs) {
    return pairs.filter((p) => isMismatch(p) && rulingState(p) === COUNTED_RULING_STATE).length;
}

export function countProposedMismatches(pairs) {
    return pairs.filter((p) => isMismatch(p) && rulingState(p) !== COUNTED_RULING_STATE).length;
}

export function countErrors(pairs) {
    return pairs.filter((p) => p.status === 'ERROR').length;
}

export function countDesigned(pairs) {
    return pairs.filter((p) => p.status === 'designed').length;
}

// The other half of the designed pair of counts: a shape built to read against
// the answer that agreed with it instead. It rides in the report beside
// `designed` rather than only in a warning sentence, so a reader of report.json
// can read the finding as a number like every other count there.
export function countDesignedAgreed(pairs) {
    return pairs.filter((p) => p.status === 'designed-agreed').length;
}

// The exit code is the ruled-mismatch count capped at 100, which is the contract
// the probe set, the README and section 3's hook-ins are written against.
// Errors and proposed-ruling mismatches ride beside it in the summary, the
// report and a WARNING line rather than in the code, so a caller reading the
// number reads the one thing it has always meant.
export function exitCodeFor(pairs) {
    return Math.min(countMismatches(pairs), MAX_EXIT);
}

// ------------------------------------------------------------------ reports

// A markdown table cell: the pipe is the column separator, and a cited passage
// or a reader's own words carry pipes, so an unescaped one silently shifts
// every column after it.
function cell(value) {
    return String(value === null || value === undefined ? '' : value).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

// Where a file in a shape came from, or why it is not there. A `home/` entry is
// read live in both modes, so an absent one is absent from the home directory
// now rather than at the ref the rest of the shape was read from.
function describeSource(file, before) {
    if (!file.absent) return file.source;
    if (file.source === 'live') return 'absent in the home directory';
    return 'absent at ' + (before || 'the worktree');
}

export function renderReportMarkdown(report) {
    const lines = [];
    // The count the report carries, since it is the run's own reading of its
    // pairs and the rest of this line is read from the report the same way. A
    // report built by hand rather than by a run carries no such field, and the
    // count over its pairs is the same number.
    const designedAgreed = typeof report.designedAgreed === 'number'
        ? report.designedAgreed
        : countDesignedAgreed(report.pairs);
    lines.push('# Probe run ' + report.stamp);
    lines.push('');
    lines.push('- Tree read: ' + (report.before ? 'git ref ' + report.before + ' (' + report.beforeCommit + ')' : 'worktree'));
    lines.push('- Reader: ' + (report.dryRun ? 'not invoked (--dry-run)' : report.claudeBin));
    lines.push('- Isolation: ' + report.isolation);
    lines.push('- Pairs: ' + report.pairs.length + ', mismatches: ' + report.mismatches
        + ' (' + report.proposedMismatches + ' on proposed rulings, ' + report.designed + ' designed, '
        + designedAgreed + ' designed-agreed), errors: '
        + report.errors + ', exit code: ' + report.exitCode);
    if (report.errors > 0) {
        lines.push('- WARNING: ' + report.errors + ' pair' + (report.errors === 1 ? '' : 's')
            + ' produced no reading at all. The exit code counts mismatches only, so it reports nothing about those pairs.');
    }
    if (report.proposedMismatches > 0) {
        lines.push('- WARNING: ' + report.proposedMismatches + ' pair'
            + (report.proposedMismatches === 1 ? '' : 's') + ' disagreed with a ruling the operator has not settled.'
            + ' Those readings are outside the exit code, and each one is either a ruling to revisit or a corpus to fix.');
    }
    if (designedAgreed > 0) {
        lines.push('- WARNING: ' + designedAgreed + ' pair' + (designedAgreed === 1 ? '' : 's')
            + ' on a shape built to read against the answer agreed with it instead, and each one is counted'
            + ' with the mismatches: either the defect the shape exposes is fixed, or the shape no longer reaches'
            + ' the moment and the marker on it is stale.');
    }
    const refreshFailures = report.pairs.filter((p) => p.credentialRefreshError).length;
    if (refreshFailures > 0) {
        lines.push('- WARNING: the credential copy could not be refreshed before ' + refreshFailures + ' pair'
            + (refreshFailures === 1 ? '' : 's') + ', which read against the copy taken earlier in the run.'
            + ' A reading taken after the source token rotated fails as an error rather than answering.');
    }
    lines.push('');
    lines.push('| moment | shape | tier | ruling | ruled | read | status | cost | seconds |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const p of report.pairs) {
        lines.push('| ' + [
            p.moment,
            p.shape,
            p.tier,
            p.ruling.state + ' ' + p.ruling.date,
            p.expected.verdict + ' / ' + p.expected.answer,
            p.observed.verdict === null ? '-' : p.observed.verdict + ' / ' + (p.observed.answer || '-'),
            p.status,
            p.costUsd === null ? '-' : '$' + p.costUsd.toFixed(4),
            p.durationMs === null ? '-' : (p.durationMs / 1000).toFixed(1)
        ].map(cell).join(' | ') + ' |');
    }
    for (const p of report.pairs) {
        lines.push('');
        lines.push('## ' + p.moment + ' / ' + p.shape + ': ' + p.status);
        lines.push('');
        lines.push('- Ruled: ' + p.expected.verdict + ' / ' + p.expected.answer + ' (' + p.ruling.state + ' ' + p.ruling.date + ')');
        lines.push('- Read: ' + (p.observed.verdict === null ? 'no VERDICT line' : p.observed.verdict + ' / ' + (p.observed.answer || 'no ANSWER line')));
        if (p.designedMismatch) lines.push('- Designed to read against the answer: ' + p.designedMismatch);
        if (p.error) lines.push('- Error: ' + p.error);
        if (p.credentialRefreshError) lines.push('- Credential refresh: ' + p.credentialRefreshError);
        lines.push('- Prompt: ' + p.promptPath);
        if (p.rawReplyPath) lines.push('- Raw reply: ' + p.rawReplyPath);
        lines.push('- Files: ' + p.files.map((f) => f.path + ' (' + describeSource(f, report.before) + ')').join(', '));
        if (p.cites.length > 0) {
            lines.push('- Cites:');
            for (const c of p.cites) lines.push('  - ' + (c.path ? c.path + ': ' : '') + c.passage);
        }
    }
    lines.push('');
    return lines.join('\n');
}

// ------------------------------------------------------------------- reader

// The system prompt the reader runs under. Displacing the CLI's own is most of
// what makes the reader cold: with the CLI's default prompt and setting sources
// in place, a reader asked what instructions it holds names this machine's
// CLAUDE.md, output style, hook context and plugin instructions, which speak
// about tools, tone and task handling in the same register the corpus under
// test speaks in. This line says only that the message is the task. What
// survives it is the CLI's own identity preamble, which the flag prepends to
// rather than replaces, and a system-reminder block carrying the operator's
// email address and the date; neither instructs anything about the corpus.
export const READER_SYSTEM_PROMPT = 'You read the documents in the message you are given and answer exactly what it asks.';

export function readerArgs(model) {
    return [
        '-p',
        '--model', model,
        '--tools', '',
        '--setting-sources', '',
        '--system-prompt', READER_SYSTEM_PROMPT,
        '--output-format', 'json'
    ];
}

// The child environment. CLAUDE_CONFIG_DIR points the reader at the scratch
// config directory, and every other CLAUDE variable is dropped: this process
// runs inside a session whose id, messaging socket and entrypoint sit in the
// environment, and a child CLI reading those is a child joined to a session it
// has no part in. ANTHROPIC_* goes the same way, so the reader authenticates and
// bills through the copied credentials rather than through an API key or a base
// URL the parent shell carried. The scrub follows gitChildEnv in
// plugins/claude-kit/hooks/kit-git-lib.js, which drops GIT_* for the same reason.
//
// What the scrub deliberately leaves is the machine's network plumbing:
// HTTP_PROXY, HTTPS_PROXY, NO_PROXY, NODE_EXTRA_CA_CERTS and SSL_CERT_FILE are
// inherited, because a box that reaches the API only through a proxy or only
// with a local certificate authority is a box where a reader stripped of them
// cannot connect at all. They route and authenticate the transport rather than
// naming the account the reading is billed to, so the credential the reader uses
// is still the copied one.
export function readerEnv(env, configDir) {
    const out = { ...env };
    for (const key of Object.keys(out)) {
        if (/^CLAUDE/i.test(key) || /^ANTHROPIC/i.test(key)) delete out[key];
    }
    delete out.AI_AGENT;
    if (configDir) out.CLAUDE_CONFIG_DIR = configDir;
    return out;
}

// What to spawn for a given reader binary. The CLI itself is a native
// executable, so it is spawned directly with an argument array and no shell. A
// path ending in .js or .mjs is run with this Node instead, which is how a
// wrapper standing in for the CLI is driven: Node cannot spawn a script
// directly on Windows, and routing one through a shell is the injection path
// this file exists without.
export function readerCommand(bin) {
    if (/\.m?js$/i.test(bin)) return { cmd: process.execPath, prefix: [bin] };
    return { cmd: bin, prefix: [] };
}

// The exit status Windows gives a console program the user interrupted:
// STATUS_CONTROL_C_EXIT, 0xC000013A. There is no signal on that platform, so
// the status is the only place the interruption shows.
export const WIN32_CONTROL_C_EXIT = 3221225786;

// Whether a finished child was interrupted rather than having failed on its own.
// Ctrl+C at the terminal reaches the whole process group, so the reader is torn
// down before this process's own handler can run: on a platform with signals the
// child carries the signal that killed it, and on Windows it carries the
// control-C status instead.
//
// A spawn that reports an error of its own is never an interruption, because
// that error is this runner's own kill: spawnSync kills the child and sets
// `error` when the timeout expires (ETIMEDOUT) and when the reply passes
// maxBuffer (ENOBUFS), and each of those comes back carrying the signal the kill
// sent rather than an exit status. Reading either as the caller's Ctrl+C stops
// a whole paid run on one oversized reply, which is a pair to record as an
// ERROR and carry on from. A real interruption reaches the child from outside
// this process and leaves `error` unset.
export function isInterruptedTermination(res, platform) {
    if (!res) return false;
    if (res.error) return false;
    if (res.signal) return true;
    return (platform || process.platform) === 'win32' && res.status === WIN32_CONTROL_C_EXIT;
}

// The reader invocation. The prompt goes in on stdin rather than in an
// argument, because a shape's files run to hundreds of kilobytes and a command
// line does not. The child holds no tools, an empty setting-source list and a
// scratch config directory, so what it reads is the prompt and nothing else.
//
// A result marked `interrupted` is the caller's Ctrl+C rather than a reader
// that failed, and the pair loop stops the run on it: the loop is synchronous,
// so this process's own signal handler cannot run until every pair has been
// paid for.
export function invokeReader(bin, model, prompt, options) {
    const opts = options || {};
    const env = readerEnv(process.env, opts.configDir);
    const command = readerCommand(bin);
    const started = Date.now();
    // The argument set is the cold one unless the caller names another, which
    // only the isolation control does: its least-isolated rung has to be able
    // to reach the machine's own instructions, or its silence proves nothing.
    const res = spawnSync(command.cmd, command.prefix.concat(opts.args || readerArgs(model)), {
        cwd: opts.cwd || os.tmpdir(),
        input: prompt,
        timeout: opts.timeoutMs || READER_TIMEOUT_MS,
        maxBuffer: MAX_REPLY_BYTES,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        encoding: 'utf8',
        env
    });
    const durationMs = Date.now() - started;
    const interrupted = isInterruptedTermination(res, opts.platform);
    if (!res || res.error || res.signal) {
        const why = (res && res.error && res.error.message) || (res && res.signal) || 'unknown';
        return {
            ok: false, interrupted, text: '', raw: (res && res.stdout) || '', costUsd: null, durationMs,
            error: (interrupted ? 'the reader was interrupted: ' : 'reader did not complete: ') + String(why)
        };
    }
    // The payload is parsed before the exit code is judged, because a nonzero
    // exit can still carry JSON on stdout whose `result` holds the reason the
    // reader failed, and a report saying only that the reader exited nonzero
    // sends its own reader to the raw reply to find out why. Where nothing
    // parses, stderr is the reason instead.
    let payload = null;
    try { payload = JSON.parse(res.stdout); } catch { payload = null; }
    if (res.status !== 0) {
        const said = payload && typeof payload.result === 'string' ? payload.result : String(res.stderr || '').trim();
        return {
            ok: false, interrupted, text: '', raw: res.stdout || '', costUsd: null, durationMs,
            error: (interrupted ? 'the reader was interrupted: it exited with the control-C status ' : 'reader exited ')
                + res.status + (said === '' ? '' : ': ' + said.slice(0, 500))
        };
    }
    if (payload === null) {
        return { ok: false, text: '', raw: res.stdout, costUsd: null, durationMs, error: 'reader output was not the JSON that --output-format json promises' };
    }
    const text = typeof payload.result === 'string' ? payload.result : '';
    const cost = typeof payload.total_cost_usd === 'number' ? payload.total_cost_usd : null;
    const reported = typeof payload.duration_ms === 'number' ? payload.duration_ms : durationMs;
    if (payload.is_error) {
        return { ok: false, text, raw: res.stdout, costUsd: cost, durationMs: reported, error: 'reader reported an error result' };
    }
    return { ok: true, text, raw: res.stdout, costUsd: cost, durationMs: reported };
}

// ------------------------------------------------------- the reader scratch

export const SCRATCH_PREFIX = 'probe-reader-config-';

// The removal retries: on Windows a directory the child CLI has just exited from
// is held open for a moment longer by the platform, and a single attempt returns
// EPERM and leaves the copy where it is.
const REMOVE_OPTIONS = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };

// How old a scratch directory has to be before the sweep treats it as the
// leavings of a killed run. A full set at three shapes a probe can hold a reader
// for hours, and a live run touches its own scratch root at every credential
// refresh, which is once per pair, so a running sibling stays inside the window
// however long it runs and only an abandoned directory ages out of it.
export const STALE_SCRATCH_MS = 6 * 60 * 60 * 1000;

// The scratch directories left by runs that died before their own cleanup ran.
// Only this runner's own prefix under the temp root is touched, and a directory
// that cannot be read or removed (another user's, or one that vanished under
// the sweep) is left where it is. The entry is read with lstat, so a link
// planted at a name under the prefix is judged as the link it is rather than as
// whatever it points at.
export function sweepStaleReaderScratch(now, tmpRoot) {
    const root = tmpRoot || os.tmpdir();
    const when = now || Date.now();
    let names = [];
    try { names = fs.readdirSync(root); } catch { return []; }
    const swept = [];
    for (const name of names) {
        if (!name.startsWith(SCRATCH_PREFIX)) continue;
        const dir = path.join(root, name);
        try {
            const stat = fs.lstatSync(dir);
            if (!stat.isDirectory()) continue;
            if (when - stat.mtimeMs < STALE_SCRATCH_MS) continue;
            fs.rmSync(dir, REMOVE_OPTIONS);
            swept.push(dir);
        } catch { /* not ours to remove, or already gone */ }
    }
    return swept;
}

// The live scratch directories of this process, removed on the way out of a
// run and on an interrupt. A run killed at the terminal is the ordinary case
// (a reader takes minutes and the caller changes their mind), and the copy it
// holds is a live credential.
const liveScratch = new Set();
let signalHandlersInstalled = false;

// The signal path takes the same guard the finally path does, so a copy that
// survives the attempt is named on stderr and stays in the set for the exit
// handler's retry rather than being dropped in silence.
function removeLiveScratch() {
    for (const dir of [...liveScratch]) removeReaderScratch(dir);
}

// The conventional codes for a process a signal ended: 128 plus the signal
// number, which is what a shell reports for one.
export const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };

// The code a signal handler leaves the process with. The signals reach this
// process while the pair loop is synchronous, so the handler runs only once the
// loop has unwound and the run has already chosen a code: Ctrl+C at the terminal
// tears down the reader, the loop stops on that pair and the top-level handler
// sets 101, and the handler firing afterwards would otherwise replace the code
// the run reported with its own. So a code already chosen wins, and the signal's
// own code is for a signal that arrived before the run chose anything. Zero is
// not a choice worth carrying: a killed run reporting success reads as a run
// that finished.
export function interruptExitCode(signal, pendingExitCode) {
    if (typeof pendingExitCode === 'number' && pendingExitCode !== 0) return pendingExitCode;
    return SIGNAL_EXIT_CODES[signal] || SIGNAL_EXIT_CODES.SIGTERM;
}

function installScratchSignalHandlers() {
    if (signalHandlersInstalled) return;
    signalHandlersInstalled = true;
    // Every way out of the process, not only the two signals: a throw the run
    // does not catch, an explicit exit, and a main that simply returns all end
    // here, and each of them would otherwise leave a live credential on disk
    // until the next run's sweep reaches it.
    process.on('exit', removeLiveScratch);
    for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
        process.on(signal, () => {
            removeLiveScratch();
            process.exit(interruptExitCode(signal, process.exitCode));
        });
    }
}

// The scratch the reader runs against: a config directory holding a copy of the
// credentials and nothing else, and an empty working directory beside it. Both
// live under the OS temp directory at mode 0700, outside the run directory the
// report points at.
//
// The empty working directory is the other half of the config directory's job.
// The CLI discovers a CLAUDE.md from the directory it is spawned in and every
// directory above it, so a reader spawned in the repository would read the
// repository's own instructions whatever its config directory said.
export function makeReaderScratch(homeDir, tmpRoot) {
    const root = fs.mkdtempSync(path.join(tmpRoot || os.tmpdir(), SCRATCH_PREFIX));
    try { fs.chmodSync(root, 0o700); } catch { /* a platform without POSIX modes */ }
    const configDir = path.join(root, 'config');
    const cwd = path.join(root, 'cwd');
    fs.mkdirSync(configDir, { mode: 0o700 });
    fs.mkdirSync(cwd, { mode: 0o700 });
    try {
        copyCredentials(configDir, homeDir, root);
    } catch (err) {
        fs.rmSync(root, REMOVE_OPTIONS);
        throw new Error(String(err && err.message ? err.message : err)
            + ': no reader in this run could authenticate, so the run stops here rather than recording an error against every pair');
    }
    liveScratch.add(root);
    installScratchSignalHandlers();
    return { root, configDir, cwd };
}

// The credential copy is what the removal is for, so a directory that will not
// go costs the copy rather than the run: on Windows the working directory a
// just-exited child held resists removal for longer than the retries allow, and
// throwing there fails a run that has already finished reading. The copy is
// unlinked on its own, the failure is named on stderr, and the empty directory
// is left to the next run's sweep.
// The root leaves the live set only once it is actually gone, so a removal that
// failed is retried by the exit handler on the way out of the process: dropping
// it here on the way in would make the one case the retry exists for the one
// case nothing retries.
export function removeReaderScratch(root) {
    try {
        fs.rmSync(root, REMOVE_OPTIONS);
        liveScratch.delete(root);
        return true;
    } catch (err) {
        let copyRemoved = false;
        try {
            fs.rmSync(path.join(root, 'config'), REMOVE_OPTIONS);
            copyRemoved = true;
        } catch { /* reported below */ }
        process.stderr.write('the reader scratch ' + root + ' could not be removed ('
            + (err && err.code ? err.code : 'unknown') + '): '
            + (copyRemoved
                ? 'its config directory and the credential copy in it are gone, and the empty directory is left to the next run\'s sweep'
                : 'THE CREDENTIAL COPY IS STILL THERE, and it is removed by hand or by the next run\'s sweep') + '\n');
        return false;
    }
}

// The credentials are refreshed before every reader invocation. The token in
// them is rotated in ~/.claude while a run is in flight, and a run over a large
// shape takes minutes per reader, so a copy taken once at the top goes stale
// mid-run and the readers after that point fail to authenticate.
//
// A copy that fails throws, which is what the first copy needs: without it no
// reader in the run can authenticate and every pair becomes an ERROR row, which
// reads like the whole corpus moving at once when what happened is one
// unreadable file. A refresh mid-run is the other case and its caller catches:
// the copy already in the scratch is a working credential until its token
// rotates, so one unreadable read of a file another process is rewriting costs a
// row on the report rather than the rest of a paid run.
//
// Newer wins, both ways. The reader holds the same OAuth credential this process
// does, and a rotation the reader performs is written into the scratch copy, so
// a refresh that copied the source over it unconditionally would put the stale
// token back and cost the readings after it. The copy is therefore rewritten
// only when the source is at least as new as it: a source newer than the copy is
// the ordinary rotation and it copies, a copy newer than the source is a
// rotation the reader made and it stays.
//
// A link at either name refuses the copy outright. The mtimes are read with
// lstat, so a link is seen as the link it is: a link at the source carries a
// link mtime that never advances, which pins the real source out of every later
// refresh, and a link at the destination is a name a naive write would follow to
// wherever it leads. Neither is a state this runner created, so it names the
// link and stops rather than working through it. The write itself lands on a
// sibling temp name and is renamed over the destination, which replaces the name
// rather than following it, so the refusal is a report of a state rather than
// the only thing standing between a live token and an arbitrary path.
//
// `liveDir` is the scratch root the copy keeps alive, touched at each call and
// named by the caller that owns it, since a caller-supplied config directory's
// parent is nobody's to write to. Overwriting the credentials file in place
// changes the mtime of neither the root nor the config directory holding it, and
// a refresh that keeps the newer copy writes nothing at all, so without the touch
// a run longer than the staleness window presents to the next run's sweep exactly
// as an abandoned directory does.
//
// The return value says which of the two happened: true when the source was
// copied, false when the newer copy already in the scratch was kept.
export function copyCredentials(configDir, homeDir, liveDir) {
    const source = path.join(homeDir, '.credentials.json');
    const dest = path.join(configDir, '.credentials.json');
    const touchLiveDir = () => {
        if (!liveDir) return;
        const now = new Date();
        try { fs.utimesSync(liveDir, now, now); } catch { /* the scratch root is gone or not ours */ }
    };
    let sourceStat;
    try {
        sourceStat = fs.lstatSync(source);
    } catch (err) {
        throw new Error('the reader credentials at ' + source + ' could not be read ('
            + (err && err.code ? err.code : 'unknown') + ')');
    }
    if (sourceStat.isSymbolicLink()) {
        throw new Error('the reader credentials at ' + source + ' are a link, and the credentials are read as the file'
            + ' they are rather than through a link: a link\'s own mtime never advances, so the file behind it would be'
            + ' held out of every refresh this run makes');
    }
    let destStat = null;
    try { destStat = fs.lstatSync(dest); } catch { /* no copy in the scratch yet */ }
    if (destStat && destStat.isSymbolicLink()) {
        throw new Error('the credential copy at ' + dest + ' is a link, and a live OAuth token is written to the file'
            + ' the scratch holds rather than through a link to wherever it leads');
    }
    if (destStat && destStat.mtimeMs > sourceStat.mtimeMs) {
        touchLiveDir();
        return false;
    }
    let bytes;
    try {
        bytes = fs.readFileSync(source);
    } catch (err) {
        throw new Error('the reader credentials at ' + source + ' could not be read ('
            + (err && err.code ? err.code : 'unknown') + ')');
    }
    // The bytes go to a sibling name in the same directory and are renamed over
    // the destination. The lstat above judged what sat at the destination name,
    // and a write through that name judges nothing: between the two, the name
    // can become a link to somewhere else, and the write would follow it and put
    // a live OAuth token wherever it led. A rename replaces the name itself
    // whatever is at it, so the token lands in the scratch or nowhere.
    //
    // The temp name and the cleanup follow atomicTmpPath and its writers in
    // plugins/claude-kit/hooks/kit-compact-lib.js, which that file does not
    // export: the name is unpredictable and the create is exclusive, so a name
    // an attacker could guess cannot aim this writer's own unlink at a file of
    // their choosing, and the unlink runs only where this call's own create
    // returned.
    const temp = dest + '.tmp.' + process.pid + '.' + crypto.randomBytes(6).toString('hex');
    let created = false;
    let fd = null;
    try {
        fd = fs.openSync(temp, 'wx', 0o600);
        created = true;
        fs.writeFileSync(fd, bytes);
        fs.closeSync(fd);
        fd = null;
        try { fs.chmodSync(temp, 0o600); } catch { /* a platform without POSIX modes */ }
        fs.renameSync(temp, dest);
    } catch (err) {
        if (fd !== null) { try { fs.closeSync(fd); } catch { /* already gone */ } }
        if (created) { try { fs.unlinkSync(temp); } catch { /* nothing left to remove */ } }
        throw new Error('the reader credentials could not be put in place at ' + dest + ' ('
            + (err && err.code ? err.code : 'unknown') + ')');
    }
    touchLiveDir();
    return true;
}

export function utcStamp(now) {
    return (now || new Date()).toISOString().replace(/[:.]/g, '-');
}

// The one line a run prints on stdout, and the line the executing-work Chapter
// template quotes: the pair count, the mismatches that reach the exit code, the
// mismatches on rulings the operator has not settled, the error count, the exit
// code, the tiers the run actually read at, and the report. The run directory is
// named repo-relative with forward slashes so the line reads the same on either
// platform and pastes into a Chapter unchanged; a run directory outside the
// repository is named in full, since a relative path out of the tree is no more
// use to a reader than the absolute one.
//
// A run that died mid-set prints the same line over the pairs it read, naming
// report.json, which is written after every pair, and marking itself partial:
// the alternative is silence, and a caller cannot tell a crashed run from one
// that never started.
export function summaryLine(report, repoRoot, options) {
    const partial = Boolean(options && options.partial);
    const tiers = [];
    for (const pair of report.pairs) {
        if (!tiers.includes(pair.tier)) tiers.push(pair.tier);
    }
    const reportPath = path.join(report.runDir, partial ? 'report.json' : 'report.md');
    const relative = path.relative(repoRoot || REPO_ROOT, reportPath);
    const named = (relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : reportPath)
        .split(path.sep).join('/');
    return 'probe-corpus: ' + report.pairs.length + ' pairs, ' + report.mismatches + ' mismatches ('
        + report.proposedMismatches + ' on proposed rulings, ' + report.designed + ' designed), '
        + report.errors + ' errors, exit ' + report.exitCode + ', tier ' + (tiers.join(',') || 'none')
        + ', report ' + named + (partial ? ' (partial)' : '');
}

// The isolation sentence the report carries, built from what this run actually
// did rather than from a description written once and left to drift.
export function isolationLine(state) {
    if (state.dryRun) return 'no reader invoked (--dry-run)';
    const parts = [
        'tools disabled',
        'empty setting sources',
        'a minimal system prompt',
        'a child environment with every CLAUDE and ANTHROPIC variable dropped'
    ];
    // The scratch root's own parent, named from the run rather than as the OS
    // temp directory: that is where `makeReaderScratch` puts it by default and
    // where it puts it under a caller-supplied temp root is the caller's, so a
    // fixed phrase there is a claim about a location this run may never have
    // used. Where the root is not known the clause is dropped rather than
    // guessed.
    const scratchParent = state.scratchRoot ? path.dirname(state.scratchRoot) : null;
    if (state.scratchConfig) {
        parts.push('a scratch CLAUDE_CONFIG_DIR' + (scratchParent ? ' under ' + scratchParent : '')
            + ' holding a copy of the credentials and nothing else');
    } else if (state.configDir) {
        parts.push('the caller-supplied CLAUDE_CONFIG_DIR ' + state.configDir);
    } else {
        parts.push('no CLAUDE_CONFIG_DIR set, so the reader used this machine\'s own configuration');
    }
    // The ancestor chain rides on both branches. What the CLI discovers is a
    // property of the directory the reader was spawned in, whichever directory
    // that was, so a line that reported the walk only for the run's own scratch
    // would go silent on exactly the case where the working directory is a
    // caller's and the chain above it is unknown.
    const above = state.ancestorClaudeMd || [];
    const chain = above.length > 0
        ? 'a CLAUDE.md above it at ' + above.join(' and ') + ', which the reader discovered from there'
        : 'no CLAUDE.md in it or in any directory above it';
    if (state.emptyCwd) {
        parts.push('and an empty working directory' + (scratchParent ? ' under ' + scratchParent : '') + ', with ' + chain);
    } else {
        parts.push('and the working directory ' + (state.cwd || 'the OS temp directory') + ', with ' + chain);
    }
    return parts.join(', ');
}

// Every CLAUDE.md at or above a directory, which is what the CLI discovers from
// a working directory. The reader's is a fresh empty directory under the OS temp
// directory, and whether anything above the temp root carries a CLAUDE.md is a
// property of the box rather than of this runner, so a run walks the chain and
// reports what it found rather than asserting what it hopes.
export function ancestorClaudeMd(dir) {
    const found = [];
    let current = path.resolve(dir);
    for (;;) {
        const candidate = path.join(current, 'CLAUDE.md');
        try {
            if (fs.statSync(candidate).isFile()) found.push(candidate);
        } catch { /* nothing at this rung */ }
        const parent = path.dirname(current);
        if (parent === current) return found;
        current = parent;
    }
}

// --------------------------------------------------------------------- run

// One run over already-parsed probes. Every shape is materialised in memory
// first and as a whole: a file refused by the containment guard stops the run
// before the run directory exists, so a mistyped or escaping path costs nothing
// and leaves no half-written evidence artifact. A file that is simply not there
// is handed to the reader as an absence in both modes, since a shape naming a
// file the tree does not carry is exactly what a before-and-after pair is there
// to measure, and a probe whose shape reaches a file this checkout has not
// written yet still has a reading to give.
export async function runProbes(probes, options) {
    const opts = options || {};
    const repoRoot = opts.repoRoot || REPO_ROOT;
    const homeDir = opts.homeDir || path.join(os.homedir(), '.claude');
    const stamp = opts.stamp || utcStamp();
    const runDir = opts.runDir || path.join(repoRoot, '.kit', 'probe-runs', stamp);
    const template = opts.template || fs.readFileSync(opts.templatePath || TEMPLATE_PATH, 'utf8');
    const before = opts.before || null;
    const git = opts.git || gitBytes;
    const invoke = opts.invoke || invokeReader;
    const claudeBin = opts.claudeBin || 'claude';
    // A caller supplying its own invoker spawns no CLI, and the scratch below is
    // built for one that does: it copies this machine's live credentials out of
    // `~/.claude` so a real reader can authenticate from them. Building it for an
    // invoker that will never present them writes a live token to disk for
    // nothing, so such a caller names where the reading runs from: `configDir`
    // (a directory of its own, or `false` for no config directory at all) or
    // `homeDir` (a fixture home to copy from), which is what every case in the
    // suite passes. A dry run invokes nothing and builds no scratch.
    if (opts.invoke && !opts.dryRun && !opts.homeDir && !opts.configDir && opts.configDir !== false) {
        throw new Error('runProbes was given an invoke of its own and neither configDir nor homeDir,'
            + ' so the reader scratch would hold a copy of the credentials in ' + homeDir
            + ' for an invoker that spawns no reader: pass configDir (a directory, or false for none)'
            + ' or homeDir');
    }
    // The git binary is resolved before the first ref read, so a run that cannot
    // reach git says so once and by name rather than once per file.
    if (before && git === gitBytes) resolveGitBinary(opts.env);
    const beforeCommit = before ? verifyRef(repoRoot, before, git) : null;

    for (const probe of probes) refuseUnsafeProbeFields(probe);

    if (opts.only) {
        const unmatched = opts.only.filter((moment) => !probes.some((p) => p.moment === moment));
        if (unmatched.length > 0) {
            throw new Error('--only named ' + unmatched.map((m) => JSON.stringify(m)).join(', ')
                + ' and the probe set carries no such moment');
        }
    }

    const selected = [];
    for (const probe of probes) {
        if (opts.only && !opts.only.includes(probe.moment)) continue;
        for (const shape of probe.shapes) {
            if (opts.shape && shape.name !== opts.shape) continue;
            selected.push({ probe, shape });
        }
    }
    // A moment the caller named that survived the moment check and then lost
    // every one of its shapes to `--shape` is a selection the caller did not
    // get: the run would read the other moments and report a corpus the caller
    // never asked about, which is the same fault a misspelled moment is.
    if (opts.only) {
        const contributing = new Set(selected.map((pair) => pair.probe.moment));
        const empty = opts.only.filter((moment) => !contributing.has(moment));
        if (empty.length > 0) {
            throw new Error('--only named ' + empty.map((m) => JSON.stringify(m)).join(', ')
                + ' and no shape of ' + (empty.length === 1 ? 'it is' : 'them is') + ' named '
                + JSON.stringify(opts.shape) + ', so the moment contributed no pair to this run');
        }
    }
    if (selected.length === 0) {
        throw new Error('no probe and shape pair matched the selection: only=' + JSON.stringify(opts.only) + ' shape=' + JSON.stringify(opts.shape));
    }

    // Every read first, then the run directory. The reader binary is resolved
    // in the same breath, so a run that cannot reach its reader says so before
    // it writes anything. A caller that supplies its own invoker is spawning
    // nothing, so its binary name is left as it was handed over.
    const prepared = [];
    for (const { probe, shape } of selected) {
        const files = [];
        for (const relPath of shape.files) {
            const read = readShapeFile(relPath, { repoRoot, homeDir, before: beforeCommit, git });
            files.push({ path: relPath, source: read.source, absent: read.absent, bytes: read.bytes });
        }
        prepared.push({ probe, shape, files });
    }
    const readerBin = (!opts.dryRun && !opts.invoke) ? resolveReaderBinary(claudeBin, opts.env || process.env) : claudeBin;

    fs.mkdirSync(runDir, { recursive: true });
    for (const item of prepared) {
        item.shapeDir = path.join(runDir, 'shapes', item.probe.moment, item.shape.name);
        const files = [];
        for (const file of item.files) {
            const dest = shapeCopyPath(item.shapeDir, file.path);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, file.bytes);
            files.push({ ...file, copy: dest, text: file.bytes.toString('utf8') });
        }
        item.files = files;
        item.prompt = composePrompt(template, item.probe, files);
        item.promptPath = path.join(item.shapeDir, 'prompt.txt');
        fs.writeFileSync(item.promptPath, item.prompt, 'utf8');
    }

    let scratch = null;
    let configDir = null;
    if (!opts.dryRun && opts.configDir !== false) {
        if (opts.configDir) {
            configDir = opts.configDir;
        } else {
            scratch = makeReaderScratch(homeDir, opts.tmpRoot);
            configDir = scratch.configDir;
        }
    }
    // The working directory the readers are spawned in, named here rather than
    // left to the spawn's own default: a caller that supplies its own config
    // directory gets no scratch, and a null here would spawn the reader in the
    // OS temp directory while the ancestor walk below skipped it, so the
    // isolation line would report a chain nobody walked.
    const readerCwd = opts.readerCwd || (scratch ? scratch.cwd : os.tmpdir());
    // Walked once, before the first reader: the chain above the reader's working
    // directory is what the CLI discovers a CLAUDE.md from, and it is a property
    // of this box rather than of the runner, so the isolation line reports what
    // is there instead of asserting that nothing is.
    const cwdAncestors = opts.dryRun ? [] : ancestorClaudeMd(readerCwd);

    const pairs = [];
    const buildReport = () => ({
        stamp,
        runDir,
        before,
        beforeCommit,
        dryRun: Boolean(opts.dryRun),
        claudeBin: readerBin,
        isolation: isolationLine({
            dryRun: Boolean(opts.dryRun),
            scratchConfig: Boolean(scratch),
            scratchRoot: scratch ? scratch.root : null,
            configDir,
            emptyCwd: Boolean(scratch) && readerCwd === scratch.cwd,
            cwd: readerCwd,
            ancestorClaudeMd: cwdAncestors
        }),
        pairs,
        mismatches: countMismatches(pairs),
        proposedMismatches: countProposedMismatches(pairs),
        designed: countDesigned(pairs),
        designedAgreed: countDesignedAgreed(pairs),
        errors: countErrors(pairs),
        exitCode: exitCodeFor(pairs)
    });
    const reportJsonPath = path.join(runDir, 'report.json');
    // The report is rewritten after every pair, so a run that throws in the
    // middle still leaves the readings it did take on disk.
    const writeJson = () => fs.writeFileSync(reportJsonPath, JSON.stringify(buildReport(), null, 2), 'utf8');
    writeJson();

    try {
        for (const item of prepared) {
            const { probe, shape } = item;
            const base = {
                moment: probe.moment,
                shape: shape.name,
                tier: probe.tier,
                ruling: probe.ruling,
                designedMismatch: shape.designedMismatch || null,
                expected: { verdict: probe.verdict, answer: probe.answer },
                files: item.files.map((f) => ({ path: f.path, source: f.source, absent: f.absent, copy: f.copy })),
                promptPath: item.promptPath,
                rawReplyPath: null,
                cites: [],
                costUsd: null,
                durationMs: null,
                error: null,
                credentialRefreshError: null
            };
            if (opts.dryRun) {
                pairs.push({ ...base, observed: { verdict: null, answer: null }, status: 'dry-run' });
                writeJson();
                continue;
            }
            // The refresh keeps the last copy that worked. The source file is
            // rewritten by another process as its token rotates, so a read of it
            // can fail transiently, and abandoning a paid run part way through
            // over one failed read costs more than reading against a copy that
            // is one refresh old: a copy whose token has actually rotated fails
            // that pair as an ERROR, which the report already carries.
            if (scratch) {
                try {
                    copyCredentials(configDir, homeDir, scratch.root);
                } catch (err) {
                    base.credentialRefreshError = String(err && err.message ? err.message : err)
                        + ': this pair read against the copy already in the scratch';
                }
            }
            const result = invoke(readerBin, probe.tier, item.prompt, {
                configDir,
                timeoutMs: opts.timeoutMs,
                cwd: readerCwd
            });
            const rawReplyPath = path.join(item.shapeDir, 'reply.txt');
            fs.writeFileSync(rawReplyPath, String(result.raw === undefined ? result.text : result.raw), 'utf8');
            if (!result.ok) {
                pairs.push({
                    ...base, rawReplyPath, observed: { verdict: null, answer: null }, status: 'ERROR',
                    error: result.error, costUsd: result.costUsd, durationMs: result.durationMs
                });
                writeJson();
                // An interrupted reader stops the run here. This loop is
                // synchronous, so a Ctrl+C at the terminal reaches the reader
                // and then waits on the loop: the process's own signal handler
                // cannot run until the last pair has been read, and every pair
                // after this one is a reader the caller has already asked not to
                // pay for. The pairs already read are on disk, and the caller
                // gets the partial summary line over them.
                if (result.interrupted) {
                    const stop = new Error('the run was interrupted before ' + probe.moment + ' / ' + shape.name
                        + ' could be read (' + result.error + '), so no further reader was spawned');
                    stop.interrupted = true;
                    stop.partialReport = buildReport();
                    throw stop;
                }
                continue;
            }
            const parsed = parseReply(result.text);
            const diff = diffReading(probe, parsed);
            pairs.push({
                ...base,
                rawReplyPath,
                observed: { verdict: parsed.verdict, answer: parsed.answer },
                cites: parsed.cites,
                status: designedStatus(diff.status, base.designedMismatch),
                costUsd: result.costUsd,
                durationMs: result.durationMs
            });
            writeJson();
        }
    } catch (err) {
        // The readings taken before the failure ride out on the error itself, so
        // the caller can print a summary line over them: report.json holds them
        // already, and a run that dies silently is indistinguishable from one
        // that never started.
        if (err && typeof err === 'object' && !err.partialReport) err.partialReport = buildReport();
        throw err;
    } finally {
        // Only a directory this run created is removed: a caller-supplied
        // config directory is the caller's.
        if (scratch && !opts.keepConfigDir) removeReaderScratch(scratch.root);
    }

    const report = buildReport();
    fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(path.join(runDir, 'report.md'), renderReportMarkdown(report), 'utf8');
    return report;
}

export async function main(argv, env) {
    const environment = env || process.env;
    const args = parseArgs(argv);
    const probes = listProbeFiles(PROBES_DIR).map((p) => parseProbeFile(fs.readFileSync(p, 'utf8'), { path: p }));
    if (probes.length === 0) throw new Error('no probe files under ' + PROBES_DIR);
    sweepStaleReaderScratch();
    let report;
    try {
        report = await runProbes(probes, {
            before: args.before,
            only: args.only,
            shape: args.shape,
            dryRun: args.dryRun,
            homeDir: resolveHomeDir(args, environment),
            env: environment,
            claudeBin: resolveClaudeBin(args, environment)
        });
    } catch (err) {
        // A run that died with pairs already read still prints its summary, over
        // those pairs and marked partial, so a caller can tell a crashed run
        // from one that never ran. The error itself goes on stderr above it,
        // where the top-level handler writes it.
        if (err && err.partialReport) {
            process.stdout.write(summaryLine(err.partialReport, REPO_ROOT, { partial: true }) + '\n');
        }
        throw err;
    }
    // The warnings go to stderr, above the summary line, so stdout carries the
    // summary and nothing else for a caller quoting it.
    if (report.errors > 0) {
        process.stderr.write('WARNING: ' + report.errors + ' pair' + (report.errors === 1 ? '' : 's')
            + ' produced no reading at all, and the exit code counts mismatches only. Read the errors in '
            + path.join(report.runDir, 'report.md') + ' before treating this run as a reading of the corpus.\n');
    }
    const refreshFailures = report.pairs.filter((p) => p.credentialRefreshError).length;
    if (refreshFailures > 0) {
        process.stderr.write('WARNING: the credential copy could not be refreshed before ' + refreshFailures
            + ' pair' + (refreshFailures === 1 ? '' : 's') + ', which read against an earlier copy. Read those rows in '
            + path.join(report.runDir, 'report.md') + '.\n');
    }
    process.stdout.write(summaryLine(report, REPO_ROOT) + '\n');
    return report.exitCode;
}

// Whether this file is the program rather than a module under import. Both sides
// are real paths: a checkout reached through a link, or a launcher naming this
// file through one, spells the same file two ways, and comparing the spellings
// leaves the CLI silently doing nothing.
function realPathOrResolved(filePath) {
    try {
        return fs.realpathSync(filePath);
    } catch {
        return path.resolve(filePath);
    }
}

const invokedDirectly = process.argv[1]
    && realPathOrResolved(process.argv[1]) === realPathOrResolved(fileURLToPath(import.meta.url));
if (invokedDirectly) {
    main(process.argv.slice(2), process.env).then((code) => {
        process.exitCode = code;
    }).catch((err) => {
        process.stderr.write(String(err && err.message ? err.message : err) + '\n');
        process.exitCode = 101;
    });
}
