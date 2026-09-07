// Tests for plugins/claude-kit/hooks/memq-grant.js (the fleet memq grant).
//
// Node's built-in test runner, no framework (Node v24). The hook is spawned as
// a real child process, fed a PreToolUse payload on stdin, and asserted on by
// its stdout: a grant is one JSON allow decision, everything else is empty
// stdout with exit 0 (no decision, fall through to the normal permission
// flow). The hook never denies, so there is no exit-2 direction to pin.
//
// The expensive failure is a silent over-grant, so every hostile probe asserts
// that stdout carries no decision at all, not merely that the process exited 0.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'memq-grant.js');
const PLUGIN_ROOT = path.join(__dirname, '..', 'plugins', 'claude-kit');
const MEMQ = path.join(PLUGIN_ROOT, 'scripts', 'memq.js');
const MEMQ_FWD = MEMQ.split(path.sep).join('/');
const WIN = process.platform === 'win32';

// The PATH key must be found case-insensitively and mutated in place: on
// Windows the real key is usually `Path`, and adding a second `PATH` key to a
// plain-object env hands the child an ambiguous block.
function pathKey(env) {
    return Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
}

// A spread copy of process.env keeps the platform's real PATH key intact; the
// fleet variables are scrubbed so a suite run inside a fleet worker (where the
// parent environment carries them) cannot flip the no-signal cases, and the
// three variables the hook refuses on are scrubbed so ambient tooling state
// cannot flip the grant cases. Nothing else is scrubbed, so a case that wants
// an embedder root in the environment sets one and sees what any machine
// carrying one sees. The interpreter's own directory is prepended to PATH so
// the hook's interpreter pin resolves `node` to the node running this suite on
// any host.
function baseEnv(extra) {
    const env = { ...process.env };
    for (const k of Object.keys(env)) {
        if (/^KIT_(?:MEMORY_ROOT|MEMORY_ROOT_ALLOW_DATA|RUN_ID|SPAWN_VECTOR|RUN_SECTION)$/i.test(k)
            || /^(?:NODE_OPTIONS|NODE_PATH|NODE_REPL_EXTERNAL_MODULE)$/i.test(k)) {
            delete env[k];
        }
    }
    const key = pathKey(env);
    env[key] = path.dirname(process.execPath) + path.delimiter + (env[key] || '');
    return Object.assign(env, extra || {});
}

// The fleet-store signal pair. The hook checks presence and the literal '1',
// never the path itself, so the value need not exist on disk.
const FLEET = {
    KIT_MEMORY_ROOT: path.join(os.tmpdir(), 'memq-grant-test-store'),
    KIT_MEMORY_ROOT_ALLOW_DATA: '1',
};

function runHook(command, opts) {
    const o = opts || {};
    const payload = { tool_name: 'tool_name' in o ? o.tool_name : 'Bash', tool_input: { command } };
    if (o.cwd) payload.cwd = o.cwd;
    if (o.noCommand) delete payload.tool_input.command;
    const env = o.envObject || baseEnv('env' in o ? o.env : FLEET);
    return spawnSync(process.execPath, [HOOK], {
        input: JSON.stringify(payload),
        encoding: 'utf8',
        env,
    });
}

function assertGrant(res, label) {
    assert.strictEqual(res.status, 0, label + ': exit 0');
    let parsed;
    try {
        parsed = JSON.parse(res.stdout);
    } catch {
        assert.fail(label + ': stdout is not one JSON decision: ' + JSON.stringify(res.stdout));
    }
    assert.deepStrictEqual(Object.keys(parsed), ['hookSpecificOutput'], label);
    assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'PreToolUse', label);
    assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, 'allow', label);
    assert.ok(typeof parsed.hookSpecificOutput.permissionDecisionReason === 'string'
        && parsed.hookSpecificOutput.permissionDecisionReason.length > 0, label + ': reason present');
}

function assertNoDecision(res, label) {
    assert.strictEqual(res.status, 0, label + ': exit 0 (the hook never denies)');
    assert.strictEqual(res.stdout, '', label + ': no decision on stdout');
}

// --- the one allowed shape -------------------------------------------------

test('the exact invocation is granted under both signals (quoted native path)', () => {
    assertGrant(runHook('node "' + MEMQ + '" recall'), 'quoted native path');
});

test('forward-slash spelling of the same path is granted, quoted or bare', () => {
    assertGrant(runHook('node "' + MEMQ_FWD + '" recall'), 'quoted forward slashes');
    assertGrant(runHook('node ' + MEMQ_FWD + ' recall'), 'bare forward slashes');
});

test('a writing invocation with quoted arguments is granted', () => {
    assertGrant(runHook('node "' + MEMQ + '" log build-quirk pass "stale stamp bites"'),
        'memq log with a quoted summary');
});

test('a quoted argument may carry a # (bash comments start only at an unquoted word)', () => {
    assertGrant(runHook('node "' + MEMQ + '" log k pass "fix #12"'), 'quoted hash in a summary');
});

test('space and tab whitespace around the allowed shape still grants', () => {
    assertGrant(runHook('  node   "' + MEMQ + '"\trecall  '), 'leading, doubled, tab, trailing');
});

test('a traversal that lands back on the real script is the real script', () => {
    const spelled = MEMQ_FWD.replace('scripts/memq.js', 'scripts/../scripts/memq.js');
    assertGrant(runHook('node "' + spelled + '" recall'), 'resolution decides, not spelling');
});

test('arguments after the script path are memq argv, not node flags', () => {
    // node passes everything past the script path to the script, so a
    // flag-shaped argument here reaches memq (which validates its own input),
    // never node itself. In the verb position it is a word the allowlist has
    // never heard of, so it withholds the grant, and past the verb it is
    // ordinary argv that the screen leaves alone.
    assertNoDecision(runHook('node "' + MEMQ + '" --eval whatever'),
        'a flag-shaped word where the verb goes');
    assertGrant(runHook('node "' + MEMQ + '" recall --eval whatever'),
        'a flag-shaped argument after a granted verb');
});

if (WIN) {
    test('a different-case spelling of the same path grants (Windows folds case)', () => {
        assertGrant(runHook('node "' + MEMQ.toUpperCase() + '" recall'), 'uppercase spelling');
    });

    test('mixed separators inside a quoted path grant', () => {
        const mixed = MEMQ.replace(path.sep, '/'); // first separator forward, rest native
        assertGrant(runHook('node "' + mixed + '" recall'), 'mixed separators');
    });

    test('the Git-Bash drive spelling gets no grant, because the runtime rewrites it at exec', () => {
        // /d/... is what pwd prints inside the Bash tool, and it is not a
        // spelling this hook can positively resolve. The MSYS runtime rewrites
        // an argument in that shape when it execs the child, so what the child
        // actually receives depends on MSYS_NO_PATHCONV and MSYS2_ARG_CONV_EXCL
        // in the shell running the command: with the conversion on, the child
        // gets the drive-letter path, and with it off the child gets the
        // literal /d/... and resolves it under the current drive, at a path
        // nothing in the kit owns. A hook that converted the spelling itself
        // would resolve the real script and grant either way, which is one file
        // judged and another executed. Those variables cannot be screened out
        // of the question either, since the Bash tool's shell keeps state
        // across calls and an earlier call can export one into the shell a
        // later granted command runs in, where this hook cannot see it.
        const msys = '/' + MEMQ[0].toLowerCase() + MEMQ_FWD.slice(2);
        assertNoDecision(runHook('node ' + msys + ' recall'), 'MSYS /d/ spelling');
        assertNoDecision(runHook('node "' + msys + '" recall'), 'MSYS /d/ spelling, quoted');
        // The drive-letter spellings of the same file are unaffected, which is
        // what keeps the refusal a narrowing rather than a break.
        assertGrant(runHook('node "' + MEMQ + '" recall'), 'the native spelling still grants');
        assertGrant(runHook('node "' + MEMQ_FWD + '" recall'),
            'the forward-slash drive spelling still grants');
    });
}

// --- tilde expansion -------------------------------------------------------

test('a word beginning with a tilde gets no grant, wherever it sits', () => {
    // Tilde expansion substitutes the caller's own HOME into the word before
    // the child runs, so a word this hook reads as ~ reaches memq as whatever
    // HOME holds. With HOME=delete-type, this is a delete verb in a command
    // whose every screen here has already passed. The property that matters is
    // the content of the word, not the count of them.
    assertNoDecision(runHook('node "' + MEMQ + '" ~ webapp fact --confirm-shared'),
        'a tilde in the verb position');
    assertNoDecision(runHook('node "' + MEMQ + '" add-operator fact words ~ "a body"'),
        'a tilde in a flag position');
    assertNoDecision(runHook('node "' + MEMQ + '" ~/scripts/memq.js recall'),
        'a tilde leading a path');
    assertNoDecision(runHook('node ~ recall'), 'a tilde as the script path itself');
});

test('a tilde bash reads as literal still grants: later in a word, or quoted', () => {
    // Bash expands a tilde only as a word's first character and only
    // unquoted. Later in a word it is a literal, and admitting it is what
    // keeps the splitter's word equal to the shell's: refusing one would
    // withhold the grant over a word nothing rewrites. The traversal segment
    // here carries the tilde mid-word and resolves away, so the path still
    // names the real script.
    const spelled = MEMQ_FWD.replace('scripts/memq.js', 'scripts/a~b/../memq.js');
    assertGrant(runHook('node "' + spelled + '" recall'), 'a mid-word tilde in the path');
    assertGrant(runHook('node "' + MEMQ + '" log a~b pass "an argument carrying one"'),
        'a mid-word tilde in an argument');

    // Quoted, it is free text wherever it sits, and ~/.claude is the phrase
    // the kit's own prose reaches for most: a record whose description or
    // body names the store root is ordinary subject matter, not a path the
    // shell will rewrite.
    assertGrant(runHook('node "' + MEMQ + '" add-operator note "~/.claude is the store root"'),
        'a quoted leading tilde in a description');
    assertGrant(runHook('node "' + MEMQ
        + '" add-operator note words --body "~ is where the store lives"'),
        'a quoted bare tilde in a body');

    // One word shape bash does expand later in the word: an assignment-shaped
    // one, after its = and after each : within it (FOO=~ reaches the child as
    // FOO=/home/you). It grants, and the reason it can is positional: such a
    // word begins with an identifier character and keeps everything before
    // the tilde, so it can become neither a screened token, which are matched
    // whole, nor the script path, which is matched by path equality.
    assertGrant(runHook('node "' + MEMQ + '" log FOO=~ pass "an assignment-shaped argument"'),
        'an assignment-shaped tilde');
});

// --- control bytes ---------------------------------------------------------

test('a control byte anywhere in the command gets no grant', () => {
    // Bash strips NUL from a command line outright, so a word this hook reads
    // as delete-type\0 reaches the child as delete-type and every screen here
    // has answered about a word the child never saw. What each of the other
    // controls does between a shell and this splitter is unspecified rather
    // than agreed, which is the same divergence one step less certain.
    for (const [label, byte] of [['NUL', '\u0000'], ['SOH', '\u0001'], ['ESC', '\u001b'],
        ['DEL', '\u007f'], ['CR', '\r'], ['LF', '\n']]) {
        assertNoDecision(runHook('node "' + MEMQ + '" delete-operator' + byte + ' fact'),
            label + ' inside a word');
        assertNoDecision(runHook('node "' + MEMQ + '" recall' + byte),
            label + ' trailing an otherwise granted command');
    }
    // Tab is the exception: bash splits words on it and so does the splitter,
    // so it is a separator rather than a divergence.
    assertGrant(runHook('node "' + MEMQ + '"\trecall'), 'a tab between words');
});

// --- the destructive verbs -------------------------------------------------

test('the two delete verbs get no grant, in the otherwise granted shape', () => {
    // A delete removes a shared-tier record outright and keeps no copy, so it
    // is not something to run prompt-free with no operator in the loop. memq
    // refuses it under the store signals too, so this is the second lock. It
    // is silence rather than a deny, which leaves the ordinary permission flow
    // to ask wherever there is someone to ask; on the unattended vector this
    // grant serves there is not, so what the screen costs is the command.
    assertNoDecision(runHook('node "' + MEMQ + '" delete-type webapp fact --confirm-shared'),
        'delete-type');
    assertNoDecision(runHook('node "' + MEMQ + '" delete-operator fact --confirm-shared'),
        'delete-operator');
    assertNoDecision(runHook('node "' + MEMQ + '" delete-operator fact'),
        'delete-operator without its consent flag is refused the grant just the same');
});

test('a verb the grant does not name gets no grant, whether or not memq has it', () => {
    // The screen is an allowlist, so the question it asks is whether the verb
    // is one this grant covers, not whether it is one of a few named refusals.
    // A verb memq gains later, or a word that is no verb at all, therefore
    // arrives withheld rather than allowed by default: until this list learns
    // it, the command falls to the ordinary permission flow, which on the
    // unattended vector this grant serves has nobody in it, so the verb is lost
    // there rather than prompted for.
    for (const verb of ['sync-store', 'export', 'exec', 'md', '--recall', '']) {
        assertNoDecision(runHook('node "' + MEMQ + '" ' + verb),
            'an unlisted verb: ' + JSON.stringify(verb));
    }
    // The list's other direction: every verb it names still grants in the
    // otherwise allowed shape, so the allowlist is not quietly costing a
    // fleet worker something it is meant to cover.
    for (const verb of ['log', 'get', 'recall', 'recent', 'unstamped', 'touch',
        'add-type', 'add-operator', 'decay-scan', 'decay-prune', 'decay-done']) {
        assertGrant(runHook('node "' + MEMQ + '" ' + verb), 'a listed verb: ' + verb);
    }
});

test('find gets no grant, and an embedder root beside it withholds nothing else', () => {
    // find loads code out of a directory the command line does not name: it
    // requires scripts/memory-index.js, which requires an embedder package
    // under KIT_EMBEDDER_ROOT and runs it in process. The two authoring verbs
    // reach that same require through their neighbours check, so find is not
    // alone in reaching it; what makes find the one the hook withholds is that
    // its ranking is its whole output, where the check is a convenience an
    // authoring verb stands down. The verb is what the hook withholds rather
    // than the variable, because the directory cannot be screened for: embedderRoot() falls back under os.homedir(), and HOME is
    // set on every machine, so refusing on the presence of what selects that
    // directory would refuse every command there is.
    const planted = { KIT_EMBEDDER_ROOT: path.join(os.tmpdir(), 'planted-embedder'),
        KIT_EMBEDDER_ROOT_ALLOW_CODE: '1' };
    assertNoDecision(runHook('node "' + MEMQ + '" find a term'), 'find in a clean environment');
    assertNoDecision(runHook('node "' + MEMQ + '" find a term', { env: { ...FLEET, ...planted } }),
        'find under a planted embedder root');
    // The other half: an embedder root in the environment costs no other
    // command its grant. What keeps the granted write off that directory is not
    // an absence of reach, add-operator's neighbours check reaching the same
    // require, but the check's own stand-down, which skips on the presence of
    // KIT_EMBEDDER_ROOT or KIT_MEMORY_ROOT and so on exactly what this case
    // plants. A refusal on those variables would have taken the reads and
    // writes a fleet worker runs on every machine that has an embedder
    // installed.
    assertGrant(runHook('node "' + MEMQ + '" recall', { env: { ...FLEET, ...planted } }),
        'recall under a planted embedder root');
    assertGrant(runHook('node "' + MEMQ + '" add-operator fact "words" --body "a body"',
        { env: { ...FLEET, ...planted } }), 'a write under a planted embedder root');
});

test('anchor gets no grant, in the shape that grants its neighbours', () => {
    // Anchoring rewrites a record of the project tier in place, at a name the
    // command line gives it, and what the line it writes claims is which
    // files the memory is still true of. A worker could re-anchor a record
    // onto whatever the tree holds now and every drift surface would then
    // report that memory as verified when nobody read it. memq has no second
    // refusal for the verb, since it is the operator's own, so this screen is
    // the only one.
    assertNoDecision(runHook('node "' + MEMQ + '" anchor fact src/a.js'), 'anchor with a path');
    assertNoDecision(runHook('node "' + MEMQ + '" anchor fact'),
        'anchor short of its arity is refused the grant just the same');
    // The control the deny rests on: the same harness, the same command
    // shape, a verb the allowlist does name. Without it a fixture broken in
    // any of the ways this file tests elsewhere would produce the same
    // silence and read as the screen doing its job.
    assertGrant(runHook('node "' + MEMQ + '" touch fact --applied'),
        'a listed verb of the same shape, taking a name and a word after it');
    assertGrant(runHook('node "' + MEMQ + '" get fact'), 'the read of the record anchor writes');
});

test('triggers gets no grant, in the shape that grants its neighbours', () => {
    // The verb rewrites a record of the project tier in place, at a name the
    // command line gives it, and the line it writes is what decides when that
    // memory is put in front of a session. A worker could aim a record's
    // recognition wherever it liked with nobody in the loop, so the grant
    // does not cover it, exactly as it does not cover anchor. memq has no
    // second refusal for the verb, so this screen is the only one.
    assertNoDecision(runHook('node "' + MEMQ + '" triggers fact cmd:git stash'),
        'triggers with an entry');
    assertNoDecision(runHook('node "' + MEMQ + '" triggers fact'),
        'triggers short of its arity is refused the grant just the same');
    // The two spellings this verb gained after the screen was written. The
    // replace is withheld by the allowlist entry alone, which reads the verb
    // word and never the flags, so it exercises no flag logic here; the
    // attached type spelling now meets the flag screen as well, so it is
    // withheld twice over and either screen alone would answer. Both are
    // pinned because the security model names the change that would break the
    // verb-word leg: a parser that later admits a flag ahead of the subcommand
    // shifts the verb out of the position this screen reads, and a replace is
    // the shape whose escape costs the most, since it removes a record's
    // triggers: line outright on a tier every synced machine reads.
    assertNoDecision(runHook('node "' + MEMQ + '" triggers fact --replace --operator --confirm-shared'),
        'a shared-tier replace, which erases a declaration rather than aiming one, is withheld with the rest of the verb');
    assertNoDecision(runHook('node "' + MEMQ + '" triggers fact cmd:git stash --type=webapp'),
        'the attached-value type spelling is withheld too, the screen reading the verb word rather than the flag');
    // The control the deny rests on: the same harness, the same command
    // shape, a verb the allowlist does name. Without it a fixture broken in
    // any of the ways this file tests elsewhere would produce the same
    // silence and read as the screen doing its job.
    assertGrant(runHook('node "' + MEMQ + '" touch fact --applied'),
        'a listed verb of the same shape, taking a name and a word after it');
    assertGrant(runHook('node "' + MEMQ + '" get fact'), 'the read of the record triggers writes');
});

test('--rollup gets no grant, while the archive flags and a bare prune keep theirs', () => {
    // The rollup replaces every expired journal group with one tally line and
    // drops the prose of each entry in it. Nothing in the store keeps that
    // text: the .bak beside the file holds one generation and never syncs, so
    // the loss is as final as a delete, which is what a prompt-free allow with
    // no operator in the loop does not cover. memq has no second refusal for
    // it, so this screen is the only one.
    assertNoDecision(runHook('node "' + MEMQ + '" decay-prune --rollup'), 'the rollup alone');
    assertNoDecision(runHook('node "' + MEMQ + '" decay-prune --rollup --archive fact'),
        'the rollup beside an archive flag');
    assertNoDecision(runHook('node "' + MEMQ + '" decay-prune --rollup=1'),
        'the attached-value spelling, which the CLI answers as an unknown option');
    // What stays granted: retirement keeps the record readable by name, and a
    // prune that names no work is an argument error the CLI answers.
    assertGrant(runHook('node "' + MEMQ + '" decay-prune --archive fact'),
        'an archive flag');
    assertGrant(runHook('node "' + MEMQ + '" decay-prune --archive-operator fact'
        + ' --confirm-shared'), 'a shared retirement, which keeps the record');
    assertGrant(runHook('node "' + MEMQ + '" decay-prune'), 'a bare prune');
    // A flag that merely starts the same is not the screened one.
    assertGrant(runHook('node "' + MEMQ + '" decay-prune --rollupwards fact'),
        'a longer flag the screen must not swallow');
});

test('--drop-malformed gets no grant of its own, not only through the --rollup it rides', () => {
    // The flag deletes sidecar lines behind one .bak generation. The CLI
    // couples it to --rollup, which the hook screens above, so no granted
    // command reaches it today; the screen pinned here is the hook's own
    // lock on the delete, the one that still withholds it if that coupling
    // is ever loosened in the CLI for ergonomics. The verb layer is an
    // allowlist and the flag layer a denylist, so a destructive flag left
    // off the denylist would arrive granted the day the coupling moved.
    assertNoDecision(runHook('node "' + MEMQ + '" decay-prune --rollup --drop-malformed'),
        'the documented spelling, which the --rollup screen also withholds');
    assertNoDecision(runHook('node "' + MEMQ + '" decay-prune --drop-malformed'),
        'the flag alone, today a CLI argument error, screened here regardless');
    assertNoDecision(runHook('node "' + MEMQ + '" decay-prune --drop-malformed=1'),
        'the attached-value spelling, which the CLI answers as an unknown option');
    // A flag that merely starts the same is not the screened one, and the
    // bare prune keeps its grant beside the new screen.
    assertGrant(runHook('node "' + MEMQ + '" decay-prune --drop-malformedish fact'),
        'a longer flag the screen must not swallow');
    assertGrant(runHook('node "' + MEMQ + '" decay-prune --archive fact'),
        'an archive flag is untouched by the widened screen');
});

test('an --update carrying a body gets no grant through either body channel', () => {
    // A body repair replaces a shared-tier record whole and keeps the text it
    // replaces only in a local .bak, which the store's sync never carries.
    assertNoDecision(runHook('node "' + MEMQ
        + '" add-operator fact "words" --update --body "new body" --confirm-shared'),
        'operator repair through --body');
    assertNoDecision(runHook('node "' + MEMQ
        + '" add-type webapp fact "words" --update --body-file "/tmp/b.txt" --confirm-shared'),
        'type repair through --body-file');
    assertNoDecision(runHook('node "' + MEMQ
        + '" add-operator fact "words" --body "new body" --update'),
        'the order of the two flags does not matter');
});

test('a spelling bash would expand into more words than these gets no grant', () => {
    // Brace expansion and pathname expansion both run after this hook has read
    // the command line and before the child sees its argv, so a word read here
    // as one literal can reach memq as two. Both of these are the screened
    // shapes wearing a spelling the screen alone would pass:
    // {delete-type,--confirm-shared} is two words to bash, and --{update,body}
    // is two more.
    assertNoDecision(runHook('node "' + MEMQ
        + '" {delete-type,--confirm-shared} webapp fact'), 'a braced delete verb');
    assertNoDecision(runHook('node "' + MEMQ
        + '" add-operator fact words --{update,body} "new body" --confirm-shared'),
        'a braced flag pair');
    // Pathname expansion reaches the same way, and the argument it rewrites
    // is chosen by what happens to be on the disk.
    assertNoDecision(runHook('node "' + MEMQ + '" add-operator fact words --body *'),
        'a glob argument');
    // A word beginning with ~ is refused on its own rule below: it is one
    // word, and its content is whatever the caller set HOME to.
    assertNoDecision(runHook('node "' + MEMQ + '" recall ~'), 'a bare tilde word');
});

test('--supersedes gets no grant on either write verb, while the write itself keeps one', () => {
    // A pointer demotes a record in the semantic channel and labels it on
    // every surface that reads the name, and nothing bounds which record it
    // may name: the gate that writes it never asks whether the target is
    // pinned. Every other demotion this grant admits does stop there, the
    // archive flags included, so a worker with no operator in the loop could
    // read the pinned population off the granted decay-scan and demote in one
    // further command exactly the records the pin exempted. memq refuses the
    // flag under the store signals for the same reason; this screen is the
    // second lock.
    assertNoDecision(runHook('node "' + MEMQ
        + '" add-type webapp fact words --supersedes older'), 'a type-tier pointer');
    assertNoDecision(runHook('node "' + MEMQ
        + '" add-operator fact words --supersedes older'), 'the operator twin');
    assertNoDecision(runHook('node "' + MEMQ
        + '" add-operator fact words --supersedes=older'),
        'the attached-value spelling, which the CLI answers as an unknown option');
    // What stays granted is the write: a record still lands from a fleet
    // worker, carrying every field but the pointer.
    assertGrant(runHook('node "' + MEMQ + '" add-operator fact "words" --tag gotcha'),
        'an ordinary create');
    assertGrant(runHook('node "' + MEMQ + '" add-operator fact "words" --machine BOX'),
        'a machine scope, which claims nothing about a second record');
    // A flag that merely starts the same is not the screened one.
    assertGrant(runHook('node "' + MEMQ + '" add-operator fact words --supersedeswise x'),
        'a longer flag the screen must not swallow');
});

test('--trigger gets no grant on either write verb, while the write itself keeps one', () => {
    // The flag writes at a record's birth the same `triggers:` line the
    // `triggers` verb splices in afterwards, and that line decides when a
    // memory is put in front of a session. The verb is off GRANTED_VERBS for
    // exactly that reach, so leaving the flag unscreened would hand the
    // capability back through a verb the grant does cover, and on the operator
    // tier the reach is every project on the box and every machine the store
    // syncs to. memq refuses the flag under the store signals too; this screen
    // is the second lock, and it is the one that holds in the divergence case
    // where the two processes read their environment differently.
    assertNoDecision(runHook('node "' + MEMQ
        + '" add-type webapp fact words --trigger skill:memory-system'),
        'a type-tier declaration');
    assertNoDecision(runHook('node "' + MEMQ
        + '" add-operator fact words --trigger skill:memory-system'), 'the operator twin');
    assertNoDecision(runHook('node "' + MEMQ
        + '" add-operator fact words --trigger=skill:memory-system'),
        'the attached-value spelling, which the CLI answers as an unknown option');
    // Repeatable, so a second entry must not be the way past the screen.
    assertNoDecision(runHook('node "' + MEMQ
        + '" add-operator fact words --tag gotcha --trigger tool:Bash --trigger agent:explore'),
        'a repeated flag among other granted ones');
    // What stays granted is the write: a record still lands from a fleet
    // worker, carrying every field but the recognition line.
    assertGrant(runHook('node "' + MEMQ + '" add-operator fact "words" --tag gotcha'),
        'an ordinary create');
    assertGrant(runHook('node "' + MEMQ + '" add-type webapp fact "words"'),
        'the type-tier create');
    // A flag that merely starts the same is not the screened one.
    assertGrant(runHook('node "' + MEMQ + '" add-operator fact words --triggerwise x'),
        'a longer flag the screen must not swallow');
});

test('--type=<type> gets no grant on the read verbs, while the bare flag keeps its grant', () => {
    // The attached spelling names any type tier the store holds; the bare flag
    // resolves the one the calling project's own index declares, which is that
    // project's own opt-in. `get` and `touch` are granted verbs, so on this
    // vector a worker runs them with nobody in the loop: without this screen
    // `get --type=<x>` reads an arbitrary type tier's body into an unattended
    // model's context and stamps that tier's read clock, and
    // `touch --applied --type=<x>` writes an applied stamp the decay pass reads
    // as a sign of life. Both verbs refuse the spelling under those same
    // signals, so this screen is the second lock rather than the only one, and
    // it is the half that binds where the hook and the child read their
    // environments differently.
    assertNoDecision(runHook('node "' + MEMQ + '" get fact --type=webapp'),
        'a read of a tier the calling project never declared');
    assertNoDecision(runHook('node "' + MEMQ + '" touch fact --applied --type=webapp'),
        'an applied stamp in that same tier');
    assertNoDecision(runHook('node "' + MEMQ + '" get fact --type='),
        'the attached spelling carrying no value, which is a whole word here');
    // What stays granted is the flag itself, which is the whole of what makes
    // this a screen on the naming of a foreign tier rather than on the flag.
    assertGrant(runHook('node "' + MEMQ + '" get fact --type'),
        'the project\'s own declared type, read');
    assertGrant(runHook('node "' + MEMQ + '" touch fact --applied --type'),
        'the project\'s own declared type, stamped');
    assertGrant(runHook('node "' + MEMQ + '" get fact --operator'),
        'the operator tier, which every project reads unconditionally');
    // A longer flag that merely starts the same is not this one.
    assertGrant(runHook('node "' + MEMQ + '" get fact --typewise=webapp'),
        'a longer flag the screen must not swallow');
});

test('--body-file gets no grant anywhere, not only beside --update', () => {
    // It reads a path the caller names into the store, and under a signal
    // divergence that store is the operator's own, which syncs to a private
    // remote. memq refuses the flag under the store signals for that reason;
    // the create path is the same read one command earlier.
    assertNoDecision(runHook('node "' + MEMQ
        + '" add-type webapp fact words --body-file /etc/hosts'), 'a create reading a file');
    assertNoDecision(runHook('node "' + MEMQ
        + '" add-operator fact words --body-file /etc/hosts'), 'the operator twin');
});

test('the writes a fleet worker needs are still granted', () => {
    // The screen names three commands, not a class: an ordinary add, a
    // description-only --update, and every read stay inside the grant.
    assertGrant(runHook('node "' + MEMQ + '" add-operator fact "words" --body "a body"'),
        'creating a record');
    assertGrant(runHook('node "' + MEMQ + '" add-operator fact "words" --update'),
        'a description-only update');
    assertGrant(runHook('node "' + MEMQ + '" decay-prune --archive-operator fact'
        + ' --confirm-shared'), 'retirement, which keeps the record');
});

// --- the environment gate --------------------------------------------------

test('the exact invocation with no signals, or half the pair, gets no grant', () => {
    const cmd = 'node "' + MEMQ + '" recall';
    assertNoDecision(runHook(cmd, { env: null }), 'neither signal');
    assertNoDecision(runHook(cmd, { env: { KIT_MEMORY_ROOT: FLEET.KIT_MEMORY_ROOT } }),
        'root without the allow signal');
    assertNoDecision(runHook(cmd, { env: { KIT_MEMORY_ROOT_ALLOW_DATA: '1' } }),
        'allow signal without the root');
    assertNoDecision(runHook(cmd, {
        env: { KIT_MEMORY_ROOT: FLEET.KIT_MEMORY_ROOT, KIT_MEMORY_ROOT_ALLOW_DATA: 'true' },
    }), 'allow signal must be the literal 1');
});

// --- the interpreter pin ---------------------------------------------------

test('a variable that selects code for the child gets no grant', () => {
    // Each of these makes the child load or resolve code the command line
    // never names, and all three are node's own. The kit's embedder root is
    // not among them and has its own case below: the verb that would load an
    // embedder is withheld outright, which is what bounds that directory.
    const cmd = 'node "' + MEMQ + '" recall';
    for (const [name, value] of [
        ['NODE_OPTIONS', '--require ' + MEMQ_FWD],
        ['NODE_PATH', path.join(os.tmpdir(), 'planted-modules')],
        ['NODE_REPL_EXTERNAL_MODULE', MEMQ_FWD],
    ]) {
        const extra = { ...FLEET };
        extra[name] = value;
        assertNoDecision(runHook(cmd, { env: extra }), name + ' set');
    }
    // Positive control: the same invocation with the same env minus the
    // code-selecting variable grants, so the refusals above tested the
    // variable and not a broken fixture.
    assertGrant(runHook(cmd), 'positive control after the code-selection refusals');
});

test('a PATH-planted node ahead of the real interpreter gets no grant', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memq-grant-node-'));
    try {
        const cmd = 'node "' + MEMQ + '" recall';
        const plants = WIN ? ['node', 'node.exe', 'node.cmd'] : ['node'];
        for (const name of plants) {
            fs.writeFileSync(path.join(dir, name), 'planted\n', 'utf8');
            const env = baseEnv(FLEET);
            const key = pathKey(env);
            env[key] = dir + path.delimiter + env[key];
            assertNoDecision(runHook(cmd, { envObject: env }), 'planted ' + name);
            fs.rmSync(path.join(dir, name));
        }
        // Positive control: the same extra directory on PATH but empty, so the
        // refusals above came from the plant and not the extra PATH entry.
        const env = baseEnv(FLEET);
        const key = pathKey(env);
        env[key] = dir + path.delimiter + env[key];
        assertGrant(runHook(cmd, { envObject: env }), 'empty extra PATH entry still grants');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('an empty PATH, or one holding no node, gets no grant (unidentifiable interpreter)', () => {
    // A deleted PATH is not probeable through spawnSync on Windows: libuv
    // re-injects the required variables (PATH among them) from the parent
    // when they are absent, so the empty string is the strongest deliverable
    // form of "no PATH".
    const cmd = 'node "' + MEMQ + '" recall';
    const empty = baseEnv(FLEET);
    empty[pathKey(empty)] = '';
    assertNoDecision(runHook(cmd, { envObject: empty }), 'empty PATH');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memq-grant-nonode-'));
    try {
        const bare = baseEnv(FLEET);
        bare[pathKey(bare)] = dir;
        assertNoDecision(runHook(cmd, { envObject: bare }), 'PATH with no node anywhere');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// --- the hostile inventory -------------------------------------------------

test('each banned metacharacter refuses the grant, after the path and inside quotes', () => {
    // The executors: one of these turns one command into two, or composes the
    // text of one, and $ and ` do it inside double quotes as well, so the ban
    // does not ask which span they sit in.
    for (const ch of [';', '&', '|', '<', '>', '`', '$', '(', ')', '\n', '\r']) {
        const name = JSON.stringify(ch);
        assertNoDecision(runHook('node "' + MEMQ + '" recall ' + ch + ' echo pwned'),
            name + ' after the script path');
        assertNoDecision(runHook('node "' + MEMQ + '" log k pass "a' + ch + 'b"'),
            name + ' inside a quoted argument');
    }
});

test('an expansion character refuses the grant unquoted, and is ordinary text quoted', () => {
    // Bash rewrites these into a different list of words than the hook read,
    // which is how a screened shape reaches memq wearing an unscreened
    // spelling. It performs neither expansion inside quotes, so a quoted one
    // is free text: a summary about a test glob, a description carrying a
    // bracketed note. Withholding the grant from those would withhold it from
    // ordinary writing, on a vector with no operator present to approve the
    // fall-through.
    for (const ch of ['{', '}', '*', '?', '[', ']']) {
        const name = JSON.stringify(ch);
        assertNoDecision(runHook('node "' + MEMQ + '" recall ' + ch), name + ' unquoted');
        assertGrant(runHook('node "' + MEMQ + '" log k pass "a' + ch + 'b"'),
            name + ' inside a quoted argument');
    }
    assertGrant(runHook('node "' + MEMQ
        + '" log build.gate pass "node --test test/*.test.js is green"'),
        'a summary naming a test glob');
    assertGrant(runHook('node "' + MEMQ + '" add-operator fact "words [note] on it"'),
        'a description carrying a bracketed note');
});

test('whitespace bash does not split on refuses the grant anywhere', () => {
    // NBSP, VT, FF, and the Unicode separators are single-word content to bash
    // and would be separators to a naive splitter; the hook bans them outright.
    for (const ch of ['\u00A0', '\u000B', '\u000C', '\u2028', '\u2029', '\u3000']) {
        const name = 'U+' + ch.codePointAt(0).toString(16).toUpperCase();
        assertNoDecision(runHook('node' + ch + '"' + MEMQ + '" recall'), name + ' after node');
        assertNoDecision(runHook('node "' + MEMQ + '"' + ch + 'recall'), name + ' after the path');
    }
});

test('a second command after the script path has no metacharacter-free spelling', () => {
    assertNoDecision(runHook('node "' + MEMQ + '" recall; node evil.js'), 'semicolon chain');
    assertNoDecision(runHook('node "' + MEMQ + '" recall && rm -rf .'), 'and chain');
    assertNoDecision(runHook('node "' + MEMQ + '" recall\nnode evil.js'), 'newline chain');
});

test('an unquoted comment tail refuses the grant (bash and the splitter disagree past #)', () => {
    assertNoDecision(runHook('node "' + MEMQ + '" recall # innocent tail'), 'comment tail');
    assertNoDecision(runHook('node "' + MEMQ + '" recall #tail'), 'comment tail, no space');
});

test('node -e and inline evaluation get no grant', () => {
    assertNoDecision(runHook('node -e evil'), 'node -e');
    assertNoDecision(runHook('node --eval evil'), 'node --eval');
    assertNoDecision(runHook('node -e "require(\'child_process\')"'), 'node -e with code');
});

test('a node flag before the script path gets no grant', () => {
    // The highest-value near-miss: --require ahead of the script would run
    // attacker code inside a genuine memq invocation if the first-argument
    // check ever regressed to "the target appears among the words".
    assertNoDecision(runHook('node --require evil.js "' + MEMQ + '" recall'), '--require first');
    assertNoDecision(runHook('node -r evil.js "' + MEMQ + '" recall'), '-r first');
    assertNoDecision(runHook('node --inspect "' + MEMQ + '" recall'), '--inspect first');
});

test('node with no argument at all gets no grant', () => {
    assertNoDecision(runHook('node'), 'bare node');
    assertNoDecision(runHook('  node  '), 'bare node with whitespace');
});

test('npx gets no grant, even aimed at the real script', () => {
    assertNoDecision(runHook('npx memq recall'), 'npx by name');
    assertNoDecision(runHook('npx "' + MEMQ + '" recall'), 'npx at the real path');
});

test('only the bare executable name node is granted', () => {
    assertNoDecision(runHook('node.exe "' + MEMQ + '" recall'), 'node.exe');
    assertNoDecision(runHook('"C:/other/node.exe" "' + MEMQ + '" recall'), 'another node, absolute');
    assertNoDecision(runHook('/usr/bin/node "' + MEMQ + '" recall'), 'another node, unix path');
    assertNoDecision(runHook('NODE "' + MEMQ + '" recall'), 'uppercase executable name');
    assertNoDecision(runHook('X=1 node "' + MEMQ + '" recall'), 'env assignment ahead of node');
});

test('a relative spelling gets no grant, with or without a payload cwd', () => {
    // The Bash tool's shell keeps a working directory across calls that
    // nothing pins to the payload cwd, so a relative target is unresolvable
    // even when it would land on the real script from the claimed cwd.
    const rel = 'node scripts/memq.js recall';
    assertNoDecision(runHook(rel, { cwd: PLUGIN_ROOT }), 'relative against the plugin root');
    assertNoDecision(runHook(rel), 'relative with no cwd');
    assertNoDecision(runHook('node ./scripts/memq.js recall', { cwd: PLUGIN_ROOT }), 'dot-relative');
});

test('a lookalike or same-named script at another path gets no grant', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memq-grant-'));
    try {
        const fake = path.join(dir, 'scripts', 'memq.js').split(path.sep).join('/');
        assertNoDecision(runHook('node "' + fake + '" recall'), 'same name, different root');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    assertNoDecision(runHook('node "' + MEMQ_FWD + '.bak" recall'), 'suffix lookalike');
    assertNoDecision(runHook('node "' + MEMQ_FWD + 'x" recall'), 'prefix-of-real trick');
});

test('a traversal reaching another script gets no grant', () => {
    const other = MEMQ_FWD.replace('scripts/memq.js', 'scripts/../hooks/memq-grant.js');
    assertNoDecision(runHook('node "' + other + '" recall'), 'traversal to a sibling hook');
});

test('unicode and percent-encoded lookalikes of the path get no grant', () => {
    assertNoDecision(runHook('node "' + MEMQ_FWD.replace(/memq\.js$/, 'mem\uFF51.js') + '" recall'),
        'full-width q');
    const encoded = MEMQ_FWD.replace('scripts/memq.js', 'scripts/%2e%2e/scripts/memq.js');
    assertNoDecision(runHook('node "' + encoded + '" recall'), 'literal %2e%2e segment');
});

if (WIN) {
    test('a rootless or drive-relative spelling gets no grant on Windows', () => {
        // A rootless slash path resolves against this process's current drive
        // but Git-Bash maps it under its own installation root: two different
        // files, so it cannot be positively resolved.
        assertNoDecision(runHook('node ' + MEMQ_FWD.slice(2) + ' recall'), 'rootless slash path');
        assertNoDecision(runHook('node ' + MEMQ_FWD.replace(':/', ':') + ' recall'),
            'drive-relative path');
    });

    test('a junction landing on the real script from another path gets no grant', (t) => {
        // Path equality is textual after normalization: a link that points at
        // the real file still spells a different path, and refusing it is the
        // narrow direction.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memq-grant-'));
        try {
            try {
                fs.symlinkSync(path.join(PLUGIN_ROOT, 'scripts'), path.join(dir, 'link'), 'junction');
            } catch {
                t.skip('junction creation denied on this host: the link-spelling refusal was not exercised');
                return;
            }
            const viaLink = path.join(dir, 'link', 'memq.js').split(path.sep).join('/');
            assertNoDecision(runHook('node "' + viaLink + '" recall'), 'junction spelling');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
}

test('quote-parity tricks get no grant', () => {
    assertNoDecision(runHook('node "' + MEMQ + '" log k pass "unterminated'), 'odd quote count');
    assertNoDecision(runHook('node \\"' + MEMQ_FWD + '\\" recall'), 'backslash-escaped quotes');
    assertNoDecision(runHook('node "' + MEMQ + '" pass ""a" b & c""'),
        'parity flip aimed at a cmd.exe-style reparse (carries &)');
});

test('an unquoted backslash spelling gets no grant (the shell would eat it)', () => {
    if (!WIN) return; // the spelling only arises for native Windows paths
    assertNoDecision(runHook('node ' + MEMQ + ' recall'), 'bare backslash path');
});

test('another tool name, a missing command, and a broken payload get no grant', () => {
    assertNoDecision(runHook('node "' + MEMQ + '" recall', { tool_name: 'PowerShell' }),
        'PowerShell payload');
    assertNoDecision(runHook('node "' + MEMQ + '" recall', { tool_name: undefined }),
        'no tool name at all');
    assertNoDecision(runHook('', {}), 'empty command');
    assertNoDecision(runHook('x', { noCommand: true }), 'missing command field');
    const res = spawnSync(process.execPath, [HOOK], {
        input: 'not json', encoding: 'utf8', env: baseEnv(FLEET),
    });
    assertNoDecision(res, 'unparseable payload');
});

// --- the coupling between the screen and the CLI it screens ----------------

// The hook screens argv positionally and by whole word: the subcommand is
// w[2], the word right after the script path, and a screened flag is matched
// by screensFlag, which takes the flag as a whole word or the flag followed
// by '='. Both rest on properties of memq's own parser, and each side is
// otherwise tested against its own literals, which is how a mismatch between
// them stays invisible. These drive the real CLI.
function runMemq(args) {
    return spawnSync(process.execPath, [MEMQ].concat(args), {
        encoding: 'utf8',
        env: { ...process.env, KIT_MEMORY_ROOT: path.join(os.tmpdir(), 'memq-grant-coupling'),
            KIT_MEMORY_ROOT_ALLOW_DATA: '1' },
    });
}

test('memq loads code out of a directory only where find and the granted blocks that stand'
    + ' down first reach it', () => {
    // The reason find is left off the grant's verb list is that its path loads
    // code from a directory the command line does not name. That claim is about
    // memq's source, so it is checked against the source rather than restated:
    // every code load past the built-ins at the top of the file is listed below by
    // the function it sits in, and a load anywhere else, or one of these moving
    // under another verb, reds here rather than silently widening what a
    // prompt-free allow can load.
    //
    // The granted roots among them reach it only with the signals off. The
    // authoring verbs print a neighbours block before a write and the decay scan
    // prints a neighbour-pairs block after its drift block, both reading the same
    // index, so the load is inside verbs the fleet grant does allow; what keeps
    // the grant's reasoning intact is that each block's first act under those
    // signals is to stand down, so a granted invocation loads no embedder at all.
    // That ordering is asserted below, because it is the whole of what
    // distinguishes those reaches from the one the grant withholds find for.
    //
    // Four named exceptions ride in the same contiguous top-of-file block as
    // the node built-ins, each a fixed, kit-shipped sibling under hooks/:
    // kit-network-lib.js for the network-share predicate (Standing Amendment
    // 2), re-exported under memq's own name below; kit-goal-lib.js for the
    // session-id grammar the store's transcript lookup tests a value against;
    // kit-read-lib.js for the bounded directory listing that lookup walks the
    // projects root with; and kit-compact-lib.js for sanitizeForOutput, scrub
    // and scrubAfterStrip, the parts of the one renderer that takes the OS
    // account name out of what memq prints, its stdout being read by a model:
    // one value rendered at a cap this file passes, a whole composed line, and
    // that same line on a second pass after a strip has deleted from it. None is a
    // load from a directory the command line names, the property this test
    // polices, so each is pinned by its exact spelling rather than by the
    // generic built-in pattern: a relative require of anything else at this
    // position, or one of these moving, reds here exactly as a second dynamic
    // load would.
    const src = fs.readFileSync(MEMQ, 'utf8').split(/\r?\n/);
    const isCode = (line) => !/^\s*(\/\/|\*)/.test(line);
    const enclosing = (lineNo) => {
        for (let i = lineNo - 1; i >= 0; i--) {
            const m = src[i].match(/^(?:async )?function (\w+)/);
            if (m) return m[1];
        }
        return null;
    };
    // The boundary is the fixed load block itself, so every line after it is
    // scanned: taking the first function declaration instead would leave the
    // constants and the top-level statements between the two unread, and a
    // load placed there runs on every invocation of every verb.
    //
    // That block is in two parts. The four siblings sit inside a guard rather
    // than beside the built-ins, since a require that throws on the CLI leg
    // would print the runtime's own require stack, whose every module path is
    // home-anchored on an installed plugin. So each is an assignment into a
    // binding declared above the try, and what is pinned is that shape: the
    // built-in lines are contiguous among themselves, the four sibling lines
    // are contiguous among themselves in this order, and between the two blocks
    // stands the guard's own `let` and `try` and no other code.
    const SIBLING_LIB_LINES = [
        '({ namesNetworkShare } = require(\'../hooks/kit-network-lib.js\'));',
        '({ isSessionIdShaped } = require(\'../hooks/kit-goal-lib.js\'));',
        '({ listBoundedNames, DIR_SCAN_MAX_ENTRIES } = require(\'../hooks/kit-read-lib.js\'));',
        '({ sanitizeForOutput, scrub, scrubAfterStrip, homeElisionsKnown } = '
            + 'require(\'../hooks/kit-compact-lib.js\'));'
    ];
    const builtin = /^const \w+ = require\('[a-z_]+'\);$/;
    const builtins = [];
    const siblings = [];
    src.forEach((line, i) => {
        const trimmed = line.trim();
        if (builtin.test(trimmed)) builtins.push(i + 1);
        if (SIBLING_LIB_LINES.includes(trimmed)) siblings.push(i + 1);
    });
    assert.ok(builtins.length > 0, 'memq.js requires node built-ins at the top of the file');
    assert.deepStrictEqual(builtins, builtins.map((_, k) => builtins[0] + k),
        'the built-in requires are one contiguous block: ' + JSON.stringify(builtins));
    assert.deepStrictEqual(
        siblings.map((n) => src[n - 1].trim()), SIBLING_LIB_LINES,
        'the four named hooks/ sibling exceptions are present, once each, in this order: '
            + JSON.stringify(siblings));
    assert.deepStrictEqual(siblings, siblings.map((_, k) => siblings[0] + k),
        'and they are one contiguous block of their own: ' + JSON.stringify(siblings));
    const between = src.slice(builtins[builtins.length - 1], siblings[0] - 1)
        .filter((line) => line.trim() !== '' && isCode(line))
        .map((line) => line.trim());
    assert.ok(siblings[0] > builtins[builtins.length - 1]
        && between.every((line) => /^let\b.*;$/.test(line) || line === 'try {'),
        'and it opens where the built-ins end, with nothing between the two but the guard\'s '
            + 'own declarations: ' + JSON.stringify(between));
    const lastBuiltin = siblings[siblings.length - 1];
    // Every way a line of source can bring in code the command line does not
    // name, not require alone: a dynamic import, an indirect require built
    // through createRequire, and the two string-to-code constructors.
    const loads = new RegExp([
        '\\brequire\\s*\\(', '\\bimport\\s*\\(', '\\beval\\s*\\(',
        'new\\s+Function\\b', '\\bcreateRequire\\b'
    ].join('|'));
    const dynamic = [];
    src.forEach((line, i) => {
        if (loads.test(line) && isCode(line) && i + 1 > lastBuiltin) {
            dynamic.push({ line: i + 1, text: line.trim() });
        }
    });
    // Each load, by the module it names and the function it sits in, listed
    // whole rather than counted: find answers from several channels, each loading
    // its own optional stack (the embedder's index, the model endpoint's client,
    // and the relevance prompt that client posts), and the decay scan's pairs
    // block reads the same index the semantic channel does, as does the authoring
    // verbs' neighbours block, which composes its query through it. A load anywhere else,
    // or one of these moving to another function, reds here.
    assert.deepStrictEqual(
        dynamic.map((d) => ({ module: d.text.replace(/^.*require\('([^']+)'\).*$/, '$1'), in: enclosing(d.line) })),
        [
            { module: './memory-index.js', in: 'semanticChannel' },
            { module: './prompts/relevance-v1.js', in: 'relevancePrompt' },
            { module: './kit-endpoint-lib.js', in: 'judgedChannel' },
            { module: './memory-index.js', in: 'neighbourPairsBlock' },
            { module: './memory-index.js', in: 'neighbourBlock' }
        ],
        'the code loads past the built-in block, and where each one sits: '
            + JSON.stringify(dynamic));

    // And the property those loads are policed for: no verb outside the roots
    // ROOTS names can reach one. Asked as the transitive closure of callers
    // rather than one function's direct callers, because a load now sits three
    // functions deep and a one-level check would go quiet the moment a helper
    // picked up a second caller under another verb. The closure's dispatch
    // functions are the roots ROOTS names and no others, which is the claim the grant's
    // verb list rests on.
    const callersOf = (name) => {
        const found = new Set();
        const pattern = new RegExp('\\b' + name + '\\s*\\(');
        src.forEach((line, i) => {
            if (!pattern.test(line) || !isCode(line)) return;
            const where = enclosing(i + 1);
            if (where !== null && where !== name) found.add(where);
        });
        return found;
    };
    // The accepted dispatch roots: main reaches each of these by name and the
    // walk stops at them rather than climbing into main. That stop is what
    // gives main's presence in the finished set its meaning, since main calls
    // every verb and would otherwise be in the closure of any load at all. With
    // the stops in place, main appears only when a load is reachable from main
    // by some path that is not through one of these, which is the failure
    // this test exists to catch. Widening this list is how another verb's
    // reach would be admitted, so it is spelled here and nowhere else.
    const ROOTS = ['cmdFind', 'cmdAddType', 'cmdAddOperator', 'cmdDecayScan'];
    const closure = new Set(dynamic.map((d) => enclosing(d.line)));
    for (const name of closure) {
        if (ROOTS.includes(name)) continue;
        for (const caller of callersOf(name)) closure.add(caller);
    }
    // The whole closure, compared against the set named here rather than
    // filtered first. A filter is the wrong instrument for this question: any
    // predicate narrow enough to describe the expected members also describes
    // away the members that signal the defect. main carries no cmd prefix and a
    // load written as a top-level statement encloses to null, so both are
    // dropped by a name-shaped filter and neither can be dropped by a
    // comparison against the whole set.
    // judgedHitLine is deliberately not in this set. It renders one line per
    // judged hit, and the loop that calls it runs outside the channel's
    // try/catch, so a module load reached from there is a throw on a path that
    // promises it cannot throw. The clause budget it once loaded the prompt
    // module for is resolved inside the guard and passed in instead, and its
    // reappearance here is that regression.
    assert.deepStrictEqual([...closure].sort(), [
        'cmdAddOperator',
        'cmdAddType',
        'cmdDecayScan',
        'cmdFind',
        'judgedCandidates',
        'judgedChannel',
        'neighbourBlock',
        'neighbourPairsBlock',
        'parseJudgedAnswer',
        'printNeighbourBlock',
        'printNeighbourPairsBlock',
        'relevancePrompt',
        'semanticChannel'
    ], 'every function that can reach a code load belongs to find, to the neighbours '
        + 'block, or to the decay scan\'s pairs block, and the only dispatch roots among '
        + 'them are the ones named: ' + JSON.stringify([...closure]));

    // The ordering the granted roots' reach rests on: inside each block that can
    // reach the load, the store-signal stand-down answers before the call that
    // loads the embedder, so an invocation carrying either signal returns without
    // a load. Read off the source for the reason the loads above are: the claim
    // is about what a granted command line can make this file do, and a check
    // that ran after the load would satisfy every behavioural assertion about the
    // printed line while loading exactly the code the grant's reasoning says it
    // does not.
    //
    // Both blocks read the condition from one predicate, so the pin is in two
    // parts: the predicate holds the two variable reads, and each block calls it
    // ahead of its own load. Naming the predicate is what keeps the second part
    // honest, since a block that called something else would fail the call
    // assertion rather than pass on a read that happens elsewhere.
    const bodyOf = (declaration) => {
        const start = src.findIndex((l) => declaration.test(l));
        assert.ok(start !== -1, 'the function is declared in this file: ' + declaration);
        let end = src.length;
        for (let i = start + 1; i < src.length; i++) {
            if (src[i] === '}') { end = i; break; }
        }
        return { start, lines: src.slice(start, end) };
    };
    const STAND_DOWN = 'pinnedRootStandDown';
    const predicate = bodyOf(new RegExp('^function ' + STAND_DOWN + '\\(')).lines;
    for (const variable of ['KIT_MEMORY_ROOT', 'KIT_EMBEDDER_ROOT']) {
        // The variable whole, with no identifier character after it. A substring
        // match on KIT_MEMORY_ROOT also matches a read of
        // KIT_MEMORY_ROOT_ALLOW_DATA, which is a different question (the honored
        // pair) and could sit anywhere in the predicate, so the pin would be
        // reading a line it was not asked about and could pass or fail on it.
        const reads = new RegExp('process\\.env\\.' + variable + '(?![0-9A-Za-z_$])');
        assert.ok(predicate.some((l) => reads.test(l) && isCode(l)),
            STAND_DOWN + ' reads ' + variable + ': ' + JSON.stringify(predicate));
    }
    // Each block, with every line in it that reaches the load, because they are
    // different lines and only some of them reach the embedder. Requiring the index
    // module loads no embedder: the module's own top level is node built-ins and
    // this file. What reaches the stack is the call that makes it search or sweep,
    // so each such line is named per block and the ordering below is asserted for
    // every line that matches rather than for the first one found, which is how a
    // load moved above the stand-down while its sibling stayed below would
    // otherwise pass unread. The `mi.` pattern is the structural one over the
    // class: every reach into the index module goes through that binding, whatever
    // the member, so a new member called above the stand-down reds here without
    // anyone adding a pattern for it.
    for (const [declaration, loads] of [
        [/^async function neighbourBlock\(/,
            [/require\('\.\/memory-index\.js'\)/, /semanticChannel\(/, /\bmi\./]],
        [/^async function neighbourPairsBlock\(/,
            [/require\('\.\/memory-index\.js'\)/, /mi\.sweep\(/, /\bmi\./]]
    ]) {
        const block = bodyOf(declaration);
        const reaching = [];
        for (const load of loads) {
            const found = block.lines
                .map((text, at) => ({ text, at }))
                .filter((line) => load.test(line.text) && isCode(line.text));
            assert.ok(found.length > 0,
                'the block reaches the load through ' + load + ': '
                    + JSON.stringify(block.lines));
            for (const line of found) reaching.push(line);
        }
        const standDownAt = block.lines.findIndex((l) =>
            new RegExp('\\b' + STAND_DOWN + '\\s*\\(').test(l) && isCode(l));
        assert.ok(standDownAt !== -1,
            'the block asks ' + STAND_DOWN + ': ' + JSON.stringify(block.lines));
        for (const line of reaching) {
            assert.ok(standDownAt < line.at,
                'the stand-down answers before every line that reaches the load:'
                    + ' asked at line ' + (block.start + standDownAt + 1)
                    + ', reached at line ' + (block.start + line.at + 1) + ': '
                    + line.text.trim());
        }
        // The earliest of them is what the gate below has to sit in front of: a
        // return placed after it would leave the block loading under a pinned
        // root however the later lines are ordered.
        const callAt = Math.min(...reaching.map((line) => line.at));
        // The call above is not the pin: a block that asked the predicate and
        // threw the answer away would satisfy an ordering assertion while loading
        // exactly the code the stand-down withholds. So what is pinned is the
        // gate. The answer is bound to a name and tested within two lines of the
        // call, and a bare return leaves the function between that test and the
        // load, which is the only shape that keeps the load unreached under a
        // pinned root.
        const bound = new RegExp('^\\s*const (\\w+) = ' + STAND_DOWN + '\\(\\);\\s*$')
            .exec(block.lines[standDownAt]);
        assert.ok(bound !== null,
            'the stand-down\'s answer is bound to a name: ' + block.lines[standDownAt]);
        const tested = new RegExp('^\\s*if \\(' + bound[1] + ' !== null\\)');
        const testAt = block.lines.findIndex((l, i) => i > standDownAt
            && i <= standDownAt + 2 && tested.test(l) && isCode(l));
        assert.ok(testAt !== -1,
            'and is tested within two lines of the call: '
                + JSON.stringify(block.lines.slice(standDownAt, standDownAt + 3)));
        const returnAt = block.lines.findIndex((l, i) => i > testAt && i < callAt
            && /^\s*return;\s*$/.test(l) && isCode(l));
        assert.ok(returnAt !== -1,
            'and that test returns before the load: tested at line '
                + (block.start + testAt + 1) + ', load at line '
                + (block.start + callAt + 1) + ', with no return between them');
    }
});

// Every load site in a module, as { line, text, module, in }, with `module`
// null where the specifier does not pin its target in the source. Two shapes
// pin it: a single-quoted literal, and a path.join anchored on __dirname
// whose remaining arguments are all single-quoted literals, which names a
// fixed kit-shipped path exactly as a relative literal does and is rendered
// here with a `__dirname/` prefix so the two shapes stay distinguishable. A
// computed specifier of any other shape is the one that could name a
// directory a command line gave it, so it is reported as null rather than
// skipped: a scan that only recognized pinned shapes would go quiet on
// exactly the case it exists to catch.
function loadSites(source) {
    const src = source.split(/\r?\n/);
    const isCode = (line) => !/^\s*(\/\/|\*)/.test(line);
    const enclosing = (lineNo) => {
        for (let i = lineNo - 1; i >= 0; i--) {
            const m = src[i].match(/^(?:async )?function (\w+)/);
            if (m) return m[1];
        }
        return null;
    };
    const loads = new RegExp([
        '\\brequire\\s*\\(', '\\bimport\\s*\\(', '\\beval\\s*\\(',
        'new\\s+Function\\b', '\\bcreateRequire\\b'
    ].join('|'));
    const sites = [];
    src.forEach((line, i) => {
        if (!loads.test(line) || !isCode(line)) return;
        const literal = line.match(/require\('([^']+)'\)/);
        const joined = line.match(/require\(path\.join\(__dirname((?:,\s*'[^']*')+)\)\)/);
        let module = null;
        if (literal) {
            module = literal[1];
        } else if (joined) {
            module = '__dirname/' + [...joined[1].matchAll(/'([^']*)'/g)].map((m) => m[1]).join('/');
        }
        sites.push({
            line: i + 1,
            text: line.trim(),
            module,
            in: enclosing(i + 1)
        });
    });
    return sites;
}

test('the sibling libraries memq loads, walked to closure, bring in nothing a command line could name', () => {
    // The property this file polices is that no code memq runs loads a module
    // out of a directory the command line names. The test above reads memq's
    // own source, and memq's allowlisted top-of-file requires put more
    // modules inside that property: whatever they load, memq loads, and that
    // reach is transitive, so the scanned set is the closure of those loads
    // rather than memq's direct siblings alone. kit-goal-lib.js loads
    // kit-compact-lib.js, which is why it is scanned here too; the closure
    // assertion below is what keeps a future relative load from quietly
    // sitting outside the scanned set.
    //
    // Each load is pinned by the module it names and the function it sits in,
    // and a specifier of neither pinned shape is reported with a null module,
    // which is the shape that could ever carry a command line's directory. A
    // new entry in any of these files, or one of these moving, reds here.
    const siblings = {
        'kit-network-lib.js': [],
        'kit-goal-lib.js': [
            { module: 'fs', in: null },
            { module: 'path', in: null },
            { module: 'os', in: null },
            { module: 'crypto', in: null },
            { module: './kit-compact-lib.js', in: 'armingSessionClaims' },
            { module: './kit-compact-lib.js', in: 'sessionHoldsLeash' },
            { module: '../scripts/memq.js', in: 'runIdField' }
        ],
        'kit-read-lib.js': [
            { module: 'fs', in: null },
            { module: './kit-goal-lib.js', in: null }
        ],
        'kit-compact-lib.js': [
            { module: 'fs', in: null },
            { module: 'os', in: null },
            { module: 'path', in: null },
            { module: 'crypto', in: null },
            { module: './kit-goal-lib.js', in: null },
            { module: './kit-read-lib.js', in: null },
            { module: '__dirname/../scripts/memq.js', in: 'sessionTranscriptPath' }
        ]
    };
    const allSites = [];
    for (const [name, expected] of Object.entries(siblings)) {
        const file = path.join(PLUGIN_ROOT, 'hooks', name);
        const sites = loadSites(fs.readFileSync(file, 'utf8'));
        assert.deepStrictEqual(sites.map((s) => ({ module: s.module, in: s.in })), expected,
            name + ' loads: ' + JSON.stringify(sites));
        for (const site of sites) {
            assert.notStrictEqual(site.module, null,
                name + ':' + site.line + ' names its module with something other than a '
                    + 'pinned shape, which is how a command line\'s directory gets loaded: '
                    + site.text);
            allSites.push({ file: name, ...site });
        }
    }

    // The closure is closed: every non-builtin module any scanned file loads
    // is itself a scanned file or memq, whose own loads the test above reads.
    // Without this, a scanned sibling gaining a require of a new module would
    // leave that module's loads outside the property while every pin above
    // stays green.
    const scanned = new Set(Object.keys(siblings));
    for (const site of allSites) {
        if (!/[\\/]/.test(site.module)) continue;   // a node builtin
        const target = site.module.replace(/^__dirname\//, '').split('/').pop();
        assert.ok(scanned.has(target) || target === 'memq.js',
            site.file + ':' + site.line + ' loads ' + site.module
                + ', which is neither a scanned sibling nor memq itself, so its own '
                + 'loads sit outside this closure');
    }

    // The withheld controls, matched on shape rather than named by any
    // literal above. A module that builds its specifier from its own
    // arguments is reported as the null-module shape the loop refuses, and a
    // path.join that is not anchored on __dirname alone is that same shape,
    // while the __dirname-and-literals form resolves. Run against source
    // rather than a file so the instrument is exercised on loads none of the
    // scanned files contains.
    const planted = loadSites([
        "'use strict';",
        "const fs = require('fs');",
        'function loadWhateverYouWereGiven(dir) {',
        '    return require(dir + \'/index.js\');',
        '}',
        'function loadBesideYourself() {',
        "    return require(path.join(__dirname, 'lib', 'thing.js'));",
        '}',
        'function loadWhereverYouStand(dir) {',
        "    return require(path.join(dir, 'thing.js'));",
        '}'
    ].join('\n'));
    assert.deepStrictEqual(planted.map((s) => ({ module: s.module, in: s.in })), [
        { module: 'fs', in: null },
        { module: null, in: 'loadWhateverYouWereGiven' },
        { module: '__dirname/lib/thing.js', in: 'loadBesideYourself' },
        { module: null, in: 'loadWhereverYouStand' }
    ], 'the scan pins the fixed shapes and reports the computed ones: ' + JSON.stringify(planted));
});

test('the granted verbs are memq\'s own dispatch minus the five withheld', () => {
    // The list in the hook mirrors memq's subcommands by hand, and each side is
    // otherwise tested only against its own literal, so a verb renamed in the
    // CLI leaves both suites green while a fleet worker's command silently
    // stops being granted and nobody is watching that session to notice. Both
    // sides are read from source here, so the mirror is checked rather than
    // restated: every verb memq dispatches is either granted or one of the
    // five this grant withholds by name, and every granted verb is a verb
    // memq dispatches.
    const dispatched = new Set();
    for (const m of fs.readFileSync(MEMQ, 'utf8').matchAll(/\bcmd === '([^']+)'/g)) {
        dispatched.add(m[1]);
    }
    assert.ok(dispatched.size > 5, 'memq dispatches by comparing the first argument: '
        + JSON.stringify([...dispatched]));

    const hookSrc = fs.readFileSync(HOOK, 'utf8');
    const listed = hookSrc.match(/const GRANTED_VERBS = new Set\(\[([\s\S]*?)\]\)/);
    assert.ok(listed, 'the hook declares its verb list as a Set literal');
    const granted = new Set([...listed[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));

    // The five the grant withholds, each for a reason stated in the hook: the
    // deletes remove a shared-tier record outright, find loads an embedder
    // out of a directory the command line does not name, anchor rewrites a
    // project-tier record in place, and triggers rewrites a record of any
    // tier that same way, at a name the command line gives them.
    const withheld = ['delete-type', 'delete-operator', 'find', 'anchor', 'triggers'];
    assert.deepStrictEqual([...granted].sort(),
        [...dispatched].filter((v) => !withheld.includes(v)).sort(),
        'the granted verbs are exactly memq\'s dispatch minus ' + withheld.join(', '));
    for (const verb of withheld) {
        assert.ok(dispatched.has(verb), verb + ' is still a verb memq dispatches');
        assert.ok(!granted.has(verb), verb + ' is still withheld');
    }
});

test('memq takes its subcommand from the first argument, which is where the screen looks', () => {
    // A global flag ahead of the verb would put the verb somewhere the screen
    // does not read. memq has no such flag: the first argument is the
    // subcommand, whatever it looks like.
    for (const leading of ['--json', '-v', '--type']) {
        const res = runMemq([leading, 'delete-operator', 'fact', '--confirm-shared']);
        assert.strictEqual(res.status, 1, leading + ': ' + res.stdout);
        assert.match(res.stderr, /unknown subcommand/,
            leading + ' is read as the command, not as a flag before one: ' + res.stderr);
    }
});

test('an attached-value flag is refused by both layers, each on its own account', () => {
    // Two independent refusals of one spelling, pinned together because
    // neither is evidence for the other. memq answers --flag=value with an
    // unknown-option usage error rather than reading the file or replacing a
    // body, and the hook withholds the grant from the same words without
    // consulting what the CLI would do with them. Either one alone would
    // stop the command; what the pair buys is that a parser change on one
    // side cannot quietly make the other side's silence load-bearing.
    for (const spelling of ['--body-file=/etc/hosts', '--body=a body', '--update=1',
        '--trigger=skill:memory-system']) {
        const res = runMemq(['add-operator', 'fact', 'words', spelling]);
        assert.strictEqual(res.status, 1, spelling + ': ' + res.stdout);
        assert.match(res.stderr, /unknown option/, spelling + ': ' + res.stderr);
    }
    assertNoDecision(runHook('node "' + MEMQ + '" add-operator fact words --body-file=/etc/hosts'),
        'an attached-value body file');
    assertNoDecision(runHook('node "' + MEMQ
        + '" add-operator fact words --update=1 --body=a body'),
        'an attached-value repair carrying a body');
    assertNoDecision(runHook('node "' + MEMQ
        + '" add-operator fact words --update --body=a body'),
        'one flag attached and one not, which is a shell word away from either');

    // The '=' is part of the match, so a screen reaches its own spellings and
    // no further: --body does not screen --body-file (that flag has its own
    // screen), and neither screens a longer flag that merely starts the same.
    assertGrant(runHook('node "' + MEMQ + '" add-operator fact words --body "a body"'),
        'a body alone is still granted, which is what the repair screen needs');
    assertGrant(runHook('node "' + MEMQ
        + '" add-operator fact words --update --bodyguard x'),
        'a longer flag that merely starts with a screened one is not that flag');
});
