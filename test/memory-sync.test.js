// Tests for the memory store's sync repo: plugins/claude-kit/doctor/
// install-memory-sync.ps1, the "Memory sync" section of doctor.ps1, and the
// silent sync runner plugins/claude-kit/doctor/sync-store.ps1 (its cases sit
// at the end of this file).
//
// Node's built-in test runner, no framework, no install (Node v24). Every
// case builds its own fake store root under a short temp directory and passes
// it explicitly, so nothing here reads or writes the real ~/.claude, which
// holds .credentials.json, settings.json, history.jsonl, and every session
// transcript. process.env is spread, never rebuilt, so children keep the
// Windows `Path` key. The cases spawn Windows PowerShell and are skipped
// off Windows, where the doctor itself does not run.
//
// The allowlist is the only barrier between syncing memories and publishing
// credentials, so the suite locks both of its directions. Negative space:
// each sensitive root file and a sampled session transcript proven ignored by
// check-ignore, nothing outside the memory tiers reachable by an add, no
// non-memory path tracked (a tracked file bypasses gitignore entirely, so a
// forced add would be invisible to the other two probes), and no non-memory
// path in committed history (a blob stays reachable after its path is
// untracked, so the first three probes can all read clean over a committed
// credential). Positive space: the planted memory files of every tier, live
// and archived, across two project stores, proven to be exactly what the repo
// tracks and what a fresh add stages, because an over-excluding allowlist
// stages nothing and would read as a clean pass against the negative probes
// alone.
//
// Nothing here runs the real doctor with -Fix: its execution-policy and user
// PATH repairs reach user-scope machine state that a USERPROFILE redirect does
// not cover. The doctor is exercised in check mode, which writes nothing, and
// the repair itself is exercised through Install-MemorySyncRepo against a
// sandbox store root.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = path.join(__dirname, '..');
const PLUGIN_ROOT = path.join(REPO, 'plugins', 'claude-kit');
const INSTALLER = path.join(PLUGIN_ROOT, 'doctor', 'install-memory-sync.ps1');
const DOCTOR = path.join(PLUGIN_ROOT, 'doctor', 'doctor.ps1');
const isWin = process.platform === 'win32';

const PROJECT_A = 'D--fake-project-alpha';
const PROJECT_B = 'D--fake-project-beta';
// The coordinator tier is one directory per machine, so every path under it
// carries a machine name. The fixture's own directory is named from the
// running box's hostname, the same reading the PowerShell side makes
// (Get-MemorySyncMachineName is [System.Net.Dns]::GetHostName(), which is what
// os.hostname() returns here), because the sync channel stages this machine's
// directory alone: a fixture naming its own directory with a constant would
// exercise the foreign path in every case that means to exercise the own one.
const MACHINE = os.hostname();
// A second machine's directory, tracked and never written by this box, which
// is the state every synced store holds for each of its peers.
const FOREIGN_MACHINE = 'FAKE-BOX-01';

// Single-quoted PowerShell literal, any embedded quote doubled.
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function pwsh(script, extraEnv) {
    return spawnSync('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { encoding: 'utf8', env: { ...process.env, ...(extraEnv || {}) } });
}

function write(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
}

// A fake ~/.claude: the sensitive root files and a session transcript that
// must never sync, a non-memory sibling inside a project directory (the only
// thing that exercises the projects/<store>/* exclusion), and memory files in
// every tier the allowlist admits. memory-operator/ is absent by default,
// which is the real state of a store before that tier exists.
function makeStore(options) {
    const opts = options || {};
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memsync-'));
    const store = path.join(home, '.claude');
    write(path.join(store, '.credentials.json'), '{"token":"secret"}\n');
    write(path.join(store, 'settings.json'), '{"model":"opus"}\n');
    write(path.join(store, 'history.jsonl'), '{"display":"a prompt"}\n');
    write(path.join(store, 'projects', PROJECT_A, 'a1b2c3d4-session.jsonl'), '{"type":"user"}\n');
    write(path.join(store, 'projects', PROJECT_A, 'todos', 'todo.json'), '[]\n');
    write(path.join(store, 'shell-snapshots', 'snapshot.sh'), 'export SECRET=1\n');
    // The embedder install and its derived search index: root-level, like the
    // other sensitive paths above, and excluded by the same `/*` rule rather
    // than by any rule naming them specifically. Planted several levels deep
    // (kit-embedder/node_modules/@huggingface/transformers/...), which is
    // where git's directory-exclusion semantics are actually exercised, not
    // just the top-level name. Neither path is added to `allowed` below, so
    // every existing positive-space assertion in this file (trackedPaths and
    // historyPaths compared against `allowed`) already proves both stay out,
    // with no new assertion required beyond this fixture existing.
    write(path.join(store, 'kit-embedder', 'node_modules', '@huggingface', 'transformers', 'package.json'),
        '{"name":"@huggingface/transformers","version":"9.9.9"}\n');
    write(path.join(store, 'kit-embedder', 'node_modules', '@huggingface', 'transformers',
        '.cache', 'Xenova', 'all-MiniLM-L6-v2', 'onnx', 'model_quantized.onnx'), 'not a real model\n');
    write(path.join(store, 'memory-index.jsonl'), '{"store":"a","tier":"type","name":"b"}\n');

    // What memq writes, per root. The project tier holds the whole set:
    // memory bodies and both indexes as .md, the outcome journal, the usage
    // sidecar, and the decay pass's extension-less completion stamp. The
    // run-scoped pending tier sits two levels below it and rides the same
    // re-include. The shared tiers hold .md and the usage sidecar alone,
    // which is the only memq output written into them, so a journal or a
    // stamp planted there below is negative space rather than a memory file.
    const allowed = [
        '.gitattributes',
        '.gitignore',
        'memory-types/archive/retired-type.md',
        'memory-types/tag-registry.md',
        'projects/' + PROJECT_A + '/memory/MEMORY.md',
        'projects/' + PROJECT_A + '/memory/outcomes.jsonl',
        'projects/' + PROJECT_A + '/memory/usage.jsonl',
        'projects/' + PROJECT_A + '/memory/decay-stamp',
        'projects/' + PROJECT_A + '/memory/archive/old-fact.md',
        'projects/' + PROJECT_A + '/memory/pending/run-fact.md',
        'projects/' + PROJECT_A + '/memory/a-fact.md',
        'projects/' + PROJECT_B + '/memory/MEMORY.md'
    ];
    // Distinct bodies throughout: git stores content once and names an object
    // by a single path, so two byte-identical files would leave the second
    // path out of the object walk the history probe reads.
    write(path.join(store, 'memory-types', 'tag-registry.md'), '# tags\n');
    write(path.join(store, 'memory-types', 'archive', 'retired-type.md'), '# retired\n');
    write(path.join(store, 'projects', PROJECT_A, 'memory', 'MEMORY.md'), '# Memory Index\n\n- alpha\n');
    write(path.join(store, 'projects', PROJECT_A, 'memory', 'a-fact.md'), '# a fact\n');
    write(path.join(store, 'projects', PROJECT_A, 'memory', 'outcomes.jsonl'), '{"key":"k"}\n');
    write(path.join(store, 'projects', PROJECT_A, 'memory', 'usage.jsonl'), '{"name":"a-fact"}\n');
    write(path.join(store, 'projects', PROJECT_A, 'memory', 'decay-stamp'), 'project decay pass\n');
    write(path.join(store, 'projects', PROJECT_A, 'memory', 'archive', 'old-fact.md'), '# old\n');
    write(path.join(store, 'projects', PROJECT_A, 'memory', 'pending', 'run-fact.md'), '# run\n');
    write(path.join(store, 'projects', PROJECT_B, 'memory', 'MEMORY.md'), '# Memory Index\n\n- beta\n');

    // Transient per-machine state inside allowed directories: locks, the
    // rename a stale-lock break leaves behind, the single-generation backup,
    // and a rewrite temporary. The last two names are the ones an exclusion
    // pattern list misses, which is why the re-include is by file form.
    write(path.join(store, 'projects', PROJECT_A, 'memory', 'decay.lock'), 'lock 2\n');
    write(path.join(store, 'projects', PROJECT_A, 'memory', 'decay.lock.stale.1234'), 'lock 3\n');
    write(path.join(store, 'projects', PROJECT_A, 'memory', 'a-fact.md.bak'), '# a fact, one rewrite ago\n');
    write(path.join(store, 'projects', PROJECT_A, 'memory', 'a-fact.md.tmp.4242'), '# a fact, mid rewrite\n');
    write(path.join(store, 'projects', PROJECT_A, 'memory', 'scratch.json'), '{}\n');
    // A .jsonl no memq surface writes. The tier's re-include names the two
    // sidecar filenames memq owns, so this one is negative space: it is what a
    // re-include written by extension would carry to every machine.
    write(path.join(store, 'projects', PROJECT_A, 'memory', 'stray.jsonl'), '{"from":"another tool"}\n');
    write(path.join(store, 'memory-types', 'store.lock'), 'lock 1\n');
    write(path.join(store, 'memory-types', 'notes.txt'), 'notes\n');
    // The two forms the project tier holds and a shared tier does not: memq's
    // journal writers and its decay stamp both resolve through the project
    // memory directory, so neither name has a writer under this root and
    // neither is re-included here.
    write(path.join(store, 'memory-types', 'outcomes.jsonl'), '{"key":"type-k"}\n');
    write(path.join(store, 'memory-types', 'decay-stamp'), 'type tier stamp\n');

    if (opts.operatorTier) {
        write(path.join(store, 'memory-operator', 'MEMORY.md'), '# Memory Index\n\n- operator\n');
        write(path.join(store, 'memory-operator', 'operator-fact.md'), '# operator\n');
        write(path.join(store, 'memory-operator', 'archive', 'retired-operator.md'), '# retired operator fact\n');
        write(path.join(store, 'memory-operator', 'usage.jsonl'), '{"name":"operator-fact"}\n');
        write(path.join(store, 'memory-operator', 'store.lock'), 'lock 4\n');
        write(path.join(store, 'memory-operator', 'store.lock.stale.99'), 'lock 5\n');
        // The same two forms this shared tier holds no writer for.
        write(path.join(store, 'memory-operator', 'outcomes.jsonl'), '{"key":"operator-k"}\n');
        write(path.join(store, 'memory-operator', 'decay-stamp'), 'operator tier stamp\n');
        allowed.push('memory-operator/MEMORY.md',
            'memory-operator/archive/retired-operator.md',
            'memory-operator/usage.jsonl',
            'memory-operator/operator-fact.md');
    }

    if (opts.coordinator) {
        const dir = path.join(store, 'coordinator', MACHINE);
        write(path.join(dir, 'board.md'), '# board\n');
        write(path.join(dir, 'admin-requests.md'), '# requests\n');
        // Two registry entries, which is what exercises the nested directory:
        // one file per session, the shape the directory contract defines.
        write(path.join(dir, 'registry', 'session-a.md'), '# session a\n');
        write(path.join(dir, 'registry', 'session-b.md'), '# session b\n');
        write(path.join(dir, 'claims', 'heavy-process.md'), '# claim\n');
        // A journal shaped like what a tool with no relationship to the store
        // writes under this tier, in the kit's own per-project scratch
        // directory: the compaction gate's log. No writer puts one here today,
        // kitScratchDir in plugins/claude-kit/hooks/kit-compact-lib.js sending
        // a store-backed project directory to a home-anchored path outside the
        // store, and the fixture is about the form the re-include must refuse
        // rather than about that writer. Nothing in the directory contract
        // names it, so it is negative space rather than an allowed path, and
        // it is planted several levels deep because that is where a re-include
        // written by extension would reach it.
        write(path.join(dir, '.kit', 'compact-gate.jsonl'), '{"event":"offer"}\n');
        // The same transient forms the memory tiers hold, plus a name no
        // allowed form describes and the memq stamp this tier never carries.
        write(path.join(dir, 'board.lock'), 'lock 6\n');
        write(path.join(dir, 'board.md.bak'), '# board, one rewrite ago\n');
        write(path.join(dir, 'board.md.tmp.77'), '# board, mid rewrite\n');
        write(path.join(dir, 'notes.txt'), 'coordinator notes\n');
        write(path.join(dir, 'decay-stamp'), 'a stamp no writer of this root produces\n');
        const p = 'coordinator/' + MACHINE + '/';
        // The claim file the fixture wrote above is deliberately absent here:
        // the claims directory is machine-local mutual-exclusion state the
        // allowlist refuses, so the on-disk file is the carve-out's negative
        // control rather than an expected tracked path.
        allowed.push(p + 'board.md', p + 'admin-requests.md',
            p + 'registry/session-a.md', p + 'registry/session-b.md');
    }
    return { home, store, allowed: allowed.sort() };
}

function rmDir(dir) {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        // Best-effort cleanup; leaving a temp dir behind never fails the test.
    }
}

// Get-MemorySyncStatus's answer as JSON. Arrays are re-wrapped because a
// one-element PowerShell array converts to a scalar otherwise.
function statusOf(store) {
    const script = '. ' + q(INSTALLER) + '; '
        + '$s = Get-MemorySyncStatus -StoreRoot ' + q(store) + '; '
        + 'foreach ($k in @("Probed","NotIgnored","Unexpected","Tracked","HistoryPaths","Notes")) { $s[$k] = @($s[$k]) }; '
        + '$s | ConvertTo-Json -Compress -Depth 4 | Write-Output';
    const res = pwsh(script);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    return JSON.parse(res.stdout);
}

function installRepo(store) {
    const script = '. ' + q(INSTALLER) + '; '
        + '$r = Install-MemorySyncRepo -StoreRoot ' + q(store) + '; '
        + '$r.Notes | Write-Output; if (-not $r.Ok) { exit 1 }';
    return pwsh(script);
}

// The installer's whole result, notes and reason code alike. One refusal
// carries a fixed Reason (a staged write into another machine's coordinator
// directory) that the sync runner records in place of its generic transient,
// so a case asserting only that a refusal happened would pass just as well
// against a refusal recorded under the wrong code.
function installRepoResult(store) {
    const script = '. ' + q(INSTALLER) + '; '
        + '$r = Install-MemorySyncRepo -StoreRoot ' + q(store) + '; '
        + '@{ Ok = [bool]$r.Ok; Reason = [string]$r.Reason; Notes = @($r.Notes) } '
        + '| ConvertTo-Json -Compress -Depth 4 | Write-Output';
    const res = pwsh(script);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    return JSON.parse(res.stdout);
}

function git(store, args) {
    return spawnSync('git', ['-C', store].concat(args), { encoding: 'utf8', env: { ...process.env } });
}

// core.quotePath=false so a path holding non-ASCII bytes reads as itself
// rather than octal-escaped inside double quotes, matching what the index
// probe asks git for.
function trackedPaths(store) {
    const res = git(store, ['-c', 'core.quotePath=false', 'ls-files']);
    assert.strictEqual(res.status, 0, res.stderr);
    return res.stdout.split(/\r?\n/).filter((l) => l.trim() !== '').sort();
}

// What `git add -A` would stage right now, as repo-relative paths.
function dryRunPaths(store) {
    const res = git(store, ['add', '-A', '--dry-run']);
    assert.strictEqual(res.status, 0, res.stderr);
    return res.stdout.split(/\r?\n/)
        .map((l) => (l.match(/^\s*\w+\s+'(.+)'\s*$/) || [])[1])
        .filter(Boolean)
        .sort();
}

// 0 ignored, 1 not ignored, anything else git failing to answer.
function isIgnored(store, rel) {
    const res = git(store, ['check-ignore', '-q', '--no-index', '--', rel]);
    assert.ok(res.status === 0 || res.status === 1, 'check-ignore errored: ' + res.stderr);
    return res.status === 0;
}

// The ignore-file pattern git resolves a path by, from `check-ignore -v`, or
// null where no pattern matches. This is what lets a refusal name the rule
// that produces it rather than only that it happened: a path refused by the
// tier's blanket exclusion and a path refused by a transient pattern read
// identically through isIgnored alone, so a case can sit untested behind an
// earlier rule while its pin stays green.
function ignoreRule(store, rel) {
    const res = git(store, ['check-ignore', '-v', '--no-index', '--', rel]);
    assert.ok(res.status === 0 || res.status === 1, 'check-ignore errored: ' + res.stderr);
    if (res.status === 1) return null;
    const line = res.stdout.split(/\r?\n/).find((l) => l.trim() !== '') || '';
    return (line.match(/^[^:]*:\d+:(\S*)\s/) || [])[1];
}

// Every blob path reachable from any ref, which is the surface no amount of
// untracking clears. The blob filter drops the tree entry rev-list otherwise
// emits for each directory.
function historyPaths(store) {
    const res = git(store, ['rev-list', '--objects', '--branches', '--tags', '--filter=object:type=blob']);
    assert.strictEqual(res.status, 0, res.stderr);
    return [...new Set(res.stdout.split(/\r?\n/)
        .map((l) => l.trimEnd())
        .map((l) => (l.indexOf(' ') < 0 ? '' : l.slice(l.indexOf(' ') + 1).trim()))
        .filter(Boolean))].sort();
}

// The merge driver git resolves for a path, from `check-attr merge -- <path>`.
function mergeAttr(store, rel) {
    const res = git(store, ['check-attr', 'merge', '--', rel]);
    assert.strictEqual(res.status, 0, res.stderr);
    return (res.stdout.trim().match(/:\s*merge:\s*(\S+)$/) || [])[1];
}

// The doctor's own -Fix gate, evaluated against a given status. The two
// assignments are lifted out of doctor.ps1 by the PowerShell parser and run as
// written, because reaching them through the script itself would mean invoking
// a real `doctor.ps1 -Fix`, whose execution-policy and user-PATH repairs touch
// user-scope machine state no USERPROFILE redirect covers.
function doctorFixGate(statusFields) {
    const fields = Object.entries(statusFields)
        .map(([k, v]) => k + ' = ' + (typeof v === 'boolean' ? (v ? '$true' : '$false') : q(v)))
        .join('; ');
    const script = '$errs = $null; $tokens = $null; '
        + '$ast = [System.Management.Automation.Language.Parser]::ParseFile(' + q(DOCTOR)
        + ', [ref]$tokens, [ref]$errs); '
        + '$stmts = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] '
        + "-and ($n.Left.Extent.Text -eq '$syncAdoptable' -or $n.Left.Extent.Text -eq '$syncNeedsWork') }, $true)); "
        + 'if ($stmts.Count -ne 2) { Write-Output ("expected 2 gate assignments, found " + $stmts.Count); exit 1 }; '
        + '$syncStatus = @{ ' + fields + ' }; $syncForeign = @(); '
        + 'foreach ($s in $stmts) { Invoke-Expression $s.Extent.Text }; '
        + '@{ Adoptable = [bool]$syncAdoptable; NeedsWork = [bool]$syncNeedsWork } | ConvertTo-Json -Compress';
    const res = pwsh(script);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    return JSON.parse(res.stdout);
}

// Lifts $syncAdoptable, $syncNeedsWork, and $syncQuestion (the consent
// prompt's own text) as AST nodes and runs all three against a stubbed
// $syncStatus, the same technique doctorFixGate uses for the first two. This
// is what proves the prompt matches the state without ever running a real
// -Fix: real doctor.ps1 code, not a paraphrase of its three-way branch, so a
// rewrite that adds a fourth state or reorders the branches is caught here.
function doctorFixQuestion(statusFields) {
    const fields = Object.entries(statusFields)
        .map(([k, v]) => k + ' = ' + (typeof v === 'boolean' ? (v ? '$true' : '$false') : q(v)))
        .join('; ');
    const script = '$errs = $null; $tokens = $null; '
        + '$ast = [System.Management.Automation.Language.Parser]::ParseFile(' + q(DOCTOR)
        + ', [ref]$tokens, [ref]$errs); '
        + '$stmts = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] '
        + "-and ($n.Left.Extent.Text -eq '$syncAdoptable' -or $n.Left.Extent.Text -eq '$syncNeedsWork' -or $n.Left.Extent.Text -eq '$syncQuestion') }, $true)); "
        + 'if ($stmts.Count -ne 3) { Write-Output ("expected 3 gate/question assignments, found " + $stmts.Count); exit 1 }; '
        + '$claudeDir = "C:\\stub-claude-dir-for-test"; '
        + '$syncStatus = @{ ' + fields + ' }; $syncForeign = @(); '
        + 'foreach ($s in $stmts) { Invoke-Expression $s.Extent.Text }; '
        + '@{ Adoptable = [bool]$syncAdoptable; NeedsWork = [bool]$syncNeedsWork; Question = [string]$syncQuestion } | ConvertTo-Json -Compress';
    const res = pwsh(script);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    return JSON.parse(res.stdout);
}

function ownMarker(store) {
    const res = git(store, ['config', '--local', '--get', 'claudekit.memorysync']);
    return res.status === 0 ? res.stdout.trim() : null;
}

test('before -Fix the store is reported as not a repo, with no probe read as a pass', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        const status = statusOf(fake.store);
        assert.strictEqual(status.IsRepo, false);
        assert.strictEqual(status.IgnoreState, 'Missing');
        assert.strictEqual(status.AttrState, 'Missing');
        // The probes need a repo to run in, so the pre-fix state must report
        // them as not run rather than as an empty, clean answer.
        assert.strictEqual(status.ProbesRan, false);
        assert.deepStrictEqual(status.NotIgnored, []);
        assert.deepStrictEqual(status.Unexpected, []);
        assert.deepStrictEqual(status.Tracked, []);
        assert.deepStrictEqual(status.HistoryPaths, []);
    } finally {
        rmDir(fake.home);
    }
});

test('-Fix initializes the repo and tracks exactly the memory tiers, operator tier absent', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        const res = installRepo(fake.store);
        assert.strictEqual(res.status, 0, res.stdout + res.stderr);
        // Positive space: every planted memory file, in both project stores,
        // live and archived, plus the type tier. An over-excluding allowlist
        // would track fewer and still pass every negative probe below.
        assert.deepStrictEqual(trackedPaths(fake.store), fake.allowed);
        // The absent operator tier is an empty tier, not a failure.
        assert.ok(!fs.existsSync(path.join(fake.store, 'memory-operator')));
        const status = statusOf(fake.store);
        assert.strictEqual(status.IsRepo, true);
        assert.strictEqual(status.IgnoreState, 'Canonical');
        assert.strictEqual(status.AttrState, 'Canonical');
        assert.strictEqual(status.ProbesRan, true);
        assert.deepStrictEqual(status.NotIgnored, []);
        assert.deepStrictEqual(status.Unexpected, []);
        assert.deepStrictEqual(status.Tracked, []);
        // A clean repository's history probe is empty, and it read something:
        // the commit just made holds exactly the allowlisted paths.
        assert.deepStrictEqual(status.HistoryPaths, []);
        assert.deepStrictEqual(historyPaths(fake.store), fake.allowed);
        assert.deepStrictEqual(status.Notes, []);
        // The repository carries the ownership marker, which is what keeps it
        // repairable independently of any file in the worktree.
        assert.strictEqual(ownMarker(fake.store), 'true');
        // Four sensitive paths probed: the three root files and a sampled
        // session transcript from a real project directory.
        assert.strictEqual(status.Probed.length, 4);
        assert.ok(status.Probed.some((p) => p.startsWith('projects/' + PROJECT_A + '/')), status.Probed.join(','));
    } finally {
        rmDir(fake.home);
    }
});

test('the operator tier syncs when it exists', { skip: !isWin }, () => {
    const fake = makeStore({ operatorTier: true });
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        assert.deepStrictEqual(trackedPaths(fake.store), fake.allowed);
        assert.ok(isIgnored(fake.store, 'memory-operator/store.lock'));
    } finally {
        rmDir(fake.home);
    }
});

test('the sensitive root files and a session transcript are ignored, and an add reaches nothing outside the tiers', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        for (const rel of ['.credentials.json', 'settings.json', 'history.jsonl',
            'projects/' + PROJECT_A + '/a1b2c3d4-session.jsonl',
            'projects/' + PROJECT_A + '/todos/todo.json',
            'shell-snapshots/snapshot.sh',
            'memory-index.jsonl',
            'kit-embedder/node_modules/@huggingface/transformers/package.json',
            'kit-embedder/node_modules/@huggingface/transformers/.cache/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx']) {
            assert.ok(isIgnored(fake.store, rel), rel + ' must be ignored');
        }
        // Both directions of the dry run at once: newly planted memory files
        // in every tier are staged, and newly planted sensitive files are not.
        write(path.join(fake.store, '.credentials.json.new'), 'secret\n');
        write(path.join(fake.store, 'projects', PROJECT_A, 'another-session.jsonl'), '{}\n');
        write(path.join(fake.store, 'projects', PROJECT_A, 'memory', 'fresh.md'), '# fresh\n');
        write(path.join(fake.store, 'memory-types', 'fresh-type.md'), '# fresh\n');
        write(path.join(fake.store, 'memory-operator', 'fresh-operator.md'), '# fresh\n');
        assert.deepStrictEqual(dryRunPaths(fake.store), [
            'memory-operator/fresh-operator.md',
            'memory-types/fresh-type.md',
            'projects/' + PROJECT_A + '/memory/fresh.md'
        ]);
    } finally {
        rmDir(fake.home);
    }
});

test('inside an allowed directory only the memory file forms sync, everything else stays out', { skip: !isWin }, () => {
    const fake = makeStore({ operatorTier: true });
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        // The re-include is positive (.md, the two memq sidecar names,
        // decay-stamp), so a name no exclusion pattern describes is still out.
        // decay.lock.stale.<pid> is the one a stale-lock break leaves behind,
        // and it matches none of *.lock, *.bak, or *.tmp.*. stray.jsonl is the
        // extension-form case: it carries a form the tier holds and a name no
        // memq surface writes, so only a re-include naming the sidecars
        // refuses it.
        for (const rel of ['projects/' + PROJECT_A + '/memory/decay.lock',
            'projects/' + PROJECT_A + '/memory/decay.lock.stale.1234',
            'projects/' + PROJECT_A + '/memory/a-fact.md.bak',
            'projects/' + PROJECT_A + '/memory/a-fact.md.tmp.4242',
            'projects/' + PROJECT_A + '/memory/scratch.json',
            'projects/' + PROJECT_A + '/memory/stray.jsonl',
            'memory-types/store.lock',
            'memory-types/notes.txt',
            'memory-operator/store.lock.stale.99']) {
            assert.ok(isIgnored(fake.store, rel), rel + ' must be ignored');
        }
        // And the forms memq does write are in, including the extension-less
        // decay stamp, whose exclusion would fail a clean machine's tracked
        // probe with no remedy but untracking a file the store needs.
        const tracked = trackedPaths(fake.store);
        assert.deepStrictEqual(tracked, fake.allowed);
        assert.ok(tracked.includes('projects/' + PROJECT_A + '/memory/decay-stamp'), tracked.join(','));
        assert.ok(!isIgnored(fake.store, 'projects/' + PROJECT_A + '/memory/decay-stamp'));
    } finally {
        rmDir(fake.home);
    }
});

test('the ignore file and the path predicate answer alike on transient-shaped names', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        // foo.tmp.md carries an allowed extension and a transient shape. Git
        // resolves it by last match, so it is excluded; a predicate that
        // stopped at the allowed form would call it admitted and never flag it
        // once force-added. The directory cases are the same rule one level
        // up: the trailing patterns match any path component, and git cannot
        // re-include anything beneath a directory it has excluded, so a
        // predicate reading the leaf alone is more permissive than git and the
        // probes built on it would miss a real staged path.
        //
        // The refused cases do not all resolve by the same rule, and the split
        // is named here rather than left to be assumed. Seven carry a leaf the
        // tier admits, foo.tmp.md and the sidecar name usage.jsonl among them,
        // so the leaf-form check passes them and the transient axis is the
        // only rule left that can refuse them. Two do not: notes.bak and
        // foo.lock match none of *.md, outcomes.jsonl, usage.jsonl or
        // decay-stamp, so the predicate refuses them at the leaf-form check
        // and never reaches the per-segment loop, while git refuses them by
        // **/*.bak and **/*.lock. What that pair pins is that the two surfaces
        // reach the same answer by different rules, not that the transient
        // axis ran.
        const cases = [
            ['projects/' + PROJECT_A + '/memory/foo.tmp.md', false],
            ['projects/' + PROJECT_A + '/memory/notes.bak', false],
            ['memory-types/foo.tmp.md', false],
            ['memory-operator/foo.lock', false],
            ['projects/' + PROJECT_A + '/memory/notes.bak/inner.md', false],
            ['projects/' + PROJECT_A + '/memory/x.tmp.d/inner.md', false],
            ['projects/' + PROJECT_A + '/memory/held.lock/usage.jsonl', false],
            ['memory-types/archive.bak/retired.md', false],
            ['memory-operator/scratch.tmp.1/fact.md', false],
            ['projects/' + PROJECT_A + '/memory/a-fact.md', true],
            ['projects/' + PROJECT_A + '/memory/archive/old-fact.md', true],
            ['projects/' + PROJECT_A + '/memory/outcomes.jsonl', true],
            ['projects/' + PROJECT_A + '/memory/decay-stamp', true]
        ];
        const script = '. ' + q(INSTALLER) + '; '
            + '@(' + cases.map(([rel]) => '(Test-MemorySyncPathAllowed -RelativePath ' + q(rel) + ')').join(', ')
            + ') | ConvertTo-Json -Compress';
        const res = pwsh(script);
        assert.strictEqual(res.status, 0, res.stdout + res.stderr);
        assert.deepStrictEqual(JSON.parse(res.stdout), cases.map(([, allowed]) => allowed));
        // And git, asked the same question, agrees on every one of them.
        for (const [rel, allowed] of cases) {
            assert.strictEqual(isIgnored(fake.store, rel), !allowed, rel + ' must agree with the predicate');
        }
    } finally {
        rmDir(fake.home);
    }
});

test('the coordinator tier syncs when it exists, and its per-machine transient state stays home', { skip: !isWin }, () => {
    const fake = makeStore({ coordinator: true });
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        // Positive space: every planted coordinator file is tracked, nested
        // registry directory included. The tier admits .md and nothing else,
        // the one form its directory contract writes, so a journal, a stamp,
        // or any other form stays out even though its directory is
        // re-included.
        assert.deepStrictEqual(trackedPaths(fake.store), fake.allowed);
        const p = 'coordinator/' + MACHINE + '/';
        for (const rel of [p + 'board.lock', p + 'board.md.bak', p + 'board.md.tmp.77', p + 'notes.txt']) {
            assert.ok(isIgnored(fake.store, rel), rel + ' must be ignored');
        }
        // The status reader over the committed tier, which is the surface the
        // doctor reports on: its probes read the index and the object graph
        // through the same predicate, so a predicate that disagreed with the
        // ignore file on a coordinator path would report those paths as
        // Tracked or in HistoryPaths and turn every doctor run on a machine
        // holding this tier into a permanent FAIL.
        const status = statusOf(fake.store);
        assert.strictEqual(status.ProbesRan, true);
        assert.deepStrictEqual(status.NotIgnored, []);
        assert.deepStrictEqual(status.Unexpected, []);
        assert.deepStrictEqual(status.Tracked, []);
        assert.deepStrictEqual(status.HistoryPaths, []);
        assert.deepStrictEqual(status.Notes, []);
        // And the commit just made holds the coordinator files themselves, so
        // the empty probes above are the clean kind rather than the kind an
        // over-excluding allowlist produces.
        assert.deepStrictEqual(historyPaths(fake.store), fake.allowed);

        // A file written after the repo exists is staged by the same rules.
        write(path.join(fake.store, 'coordinator', MACHINE, 'fresh.md'), '# fresh\n');
        write(path.join(fake.store, 'coordinator', MACHINE, 'fresh.lock'), '1234\n');
        assert.deepStrictEqual(dryRunPaths(fake.store), [p + 'fresh.md']);
    } finally {
        rmDir(fake.home);
    }
});

test('the ignore file and the path predicate answer alike on coordinator paths', { skip: !isWin }, () => {
    const fake = makeStore({ coordinator: true });
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        // The re-include names the coordinator directory itself, so a path
        // whose first segment merely starts with the word, a sibling
        // directory, a root-level file, and a coordinator directory nested
        // inside a project store are all outside it and stay excluded. Those
        // are the shapes a widened rule admits by accident, and git and the
        // predicate have to refuse them alike, since the sync's inbound screen
        // trusts the predicate for an incoming tree the ignore file never sees.
        const p = 'coordinator/' + MACHINE + '/';
        const cases = [
            [p + 'board.md', true],
            [p + 'admin-requests.md', true],
            [p + 'registry/session-a.md', true],
            // The claim file is machine-local mutual-exclusion state: a
            // synced claim resurrects a lock its holder released, so the
            // claims directory is refused despite carrying the tier's one
            // admitted form. The dedicated carve-out test below owns the
            // depth cases and the rule attribution.
            [p + 'claims/heavy-process.md', false],
            ['coordinator/board.md', true],
            [p + 'board.lock', false],
            [p + 'board.md.bak', false],
            [p + 'board.md.tmp.77', false],
            // The admitted form carrying a transient shape in leaf position.
            // The three names above are refused earlier, by the leaf-form
            // check, so without a case like these two the trailing exclusions
            // are untested against a leaf under this tier. Both carry .md, the
            // one form this tier admits, which is what leaves the transient
            // axis as the only rule that can refuse them. The directory cases
            // further down (held.lock, old.bak, x.tmp.1) carry an admitted
            // .md leaf too and reach the same loop one segment up.
            [p + 'board.tmp.md', false],
            [p + 'registry/session-a.tmp.md', false],
            [p + 'notes.txt', false],
            [p + 'held.lock/board.md', false],
            [p + 'old.bak/board.md', false],
            [p + 'x.tmp.1/board.md', false],
            ['coordinator.md', false],
            ['coordinatorx/board.md', false],
            ['coordinator-old/board.md', false],
            ['projects/' + PROJECT_A + '/coordinator/board.md', false]
        ];
        const script = '. ' + q(INSTALLER) + '; '
            + '@(' + cases.map(([rel]) => '(Test-MemorySyncPathAllowed -RelativePath ' + q(rel) + ')').join(', ')
            + ') | ConvertTo-Json -Compress';
        const res = pwsh(script);
        assert.strictEqual(res.status, 0, res.stdout + res.stderr);
        assert.deepStrictEqual(JSON.parse(res.stdout), cases.map(([, allowed]) => allowed));
        for (const [rel, allowed] of cases) {
            assert.strictEqual(isIgnored(fake.store, rel), !allowed, rel + ' must agree with the predicate');
        }
    } finally {
        rmDir(fake.home);
    }
});

// The predicate's answer for a list of paths, one PowerShell run for the lot.
// A one-element array unrolls in the pipeline and converts to a scalar, so the
// answer is re-wrapped the same way statusOf re-wraps its own, and a case list
// of one reads like any other rather than throwing on index 0.
function predicateAnswers(rels) {
    const script = '. ' + q(INSTALLER) + '; '
        + '@(' + rels.map((rel) => '(Test-MemorySyncPathAllowed -RelativePath ' + q(rel) + ')').join(', ')
        + ') | ConvertTo-Json -Compress';
    const res = pwsh(script);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    const parsed = JSON.parse(res.stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
}

// Both surfaces asked about one path, with the refusing rule named. A control
// path establishes which rule the refusal comes from: the control differs from
// the refused path in its leaf name alone, so its admission proves the root
// re-includes and the transient axis both pass and leaves the allowed-leaf
// check as the only rule left to produce the refusal.
function assertRefusedByLeafForm(store, cases, tierRule, controlRule) {
    const rels = cases.flatMap(([refused, control]) => [refused, control]);
    const answers = predicateAnswers(rels);
    cases.forEach(([refused, control], i) => {
        assert.strictEqual(answers[i * 2], false, refused + ' must be refused by the predicate');
        assert.strictEqual(answers[i * 2 + 1], true, control + ' is the control for '
            + refused + ' and must be admitted, or the refusal is unattributed');
        assert.strictEqual(isIgnored(store, refused), true, refused + ' must be ignored');
        assert.strictEqual(isIgnored(store, control), false, control + ' must not be ignored');
        assert.strictEqual(ignoreRule(store, refused), tierRule, refused
            + ' must be refused by the root exclusion ' + tierRule + ', no re-include '
            + 'matching after it; a different rule means the case proves a different axis');
        assert.strictEqual(ignoreRule(store, control), controlRule, control
            + ' must be admitted by ' + controlRule + ', the root re-include naming the '
            + 'one form that differs between it and ' + refused);
    });
}

test('the coordinator tier admits the .md forms its directory contract defines and no other form', { skip: !isWin }, () => {
    const fake = makeStore({ coordinator: true });
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        const p = 'coordinator/' + MACHINE + '/';
        // Three of the four file forms the directory contract names, each a
        // .md, at the depths the contract puts them. The fourth, the claim
        // file, is contract-defined and deliberately not synced: the claims
        // carve-out test below owns it.
        const contractForms = [p + 'board.md', p + 'admin-requests.md',
            p + 'registry/session-a.md'];
        assert.deepStrictEqual(predicateAnswers(contractForms), contractForms.map(() => true));
        for (const rel of contractForms) {
            assert.strictEqual(isIgnored(fake.store, rel), false, rel + ' must be admitted');
        }
        // Forms this tier's contract names no writer for. The subject is the
        // class rather than any one tool: a re-include written by extension
        // admits whatever writes that extension anywhere under the tier, and
        // a directory the kit itself creates under a session's project path is
        // exactly where an unrelated tool's state lands. compact-gate.jsonl is
        // the shape that class takes, the compaction gate's own log. No writer
        // reaches this path today, because kitScratchDir in plugins/claude-kit
        // /hooks/kit-compact-lib.js resolves a store-backed project directory
        // to a home-anchored path outside the store rather than to <cwd>/.kit.
        // The re-include refuses the form whether or not a writer is currently
        // pointed at it. decay-stamp is memq's completion stamp, and this tier
        // carries no memq output.
        assertRefusedByLeafForm(fake.store, [
            [p + '.kit/compact-gate.jsonl', p + '.kit/compact-gate.md'],
            [p + 'board-events.jsonl', p + 'board-events.md'],
            [p + 'registry/session-a.jsonl', p + 'registry/session-a.md'],
            [p + 'decay-stamp', p + 'decay-stamp.md']
        ], '/coordinator/**', '!/coordinator/**/*.md');
        // The transient axis under this tier, attributed rather than assumed.
        // Both names carry .md, the one form the tier admits, so the leaf-form
        // check passes them and the trailing exclusion is the only rule left
        // that can refuse them. Naming the rule is what keeps this axis from
        // reading as covered while an earlier check does all the refusing.
        const transient = [p + 'board.tmp.md', p + 'registry/session-a.tmp.md'];
        assert.deepStrictEqual(predicateAnswers(transient), transient.map(() => false));
        for (const rel of transient) {
            assert.strictEqual(isIgnored(fake.store, rel), true, rel + ' must be ignored');
            assert.strictEqual(ignoreRule(fake.store, rel), '**/*.tmp.*', rel
                + ' must be refused by the trailing transient exclusion rather than by the '
                + 'leaf-form check, or this tier has no transient coverage at all');
        }
        // The fixture plants the journal and the stamp on disk, so the two
        // surfaces that read a real worktree answer about them too. The
        // tracked set is asserted exactly rather than by a predicate over its
        // members, which an empty set would satisfy for free.
        assert.deepStrictEqual(trackedPaths(fake.store), fake.allowed);
        // And a .jsonl written after the install is not staged by a fresh add,
        // while a .md beside it is. The journal's name is new to this repo, so
        // the assertion turns on the narrowed re-include and reddens when it
        // is reverted; a form no root ever admitted, or a path already
        // committed above, would pass either way and prove nothing.
        write(path.join(fake.store, 'coordinator', MACHINE, '.kit', 'compact-gate-2.jsonl'), '{"event":"deferral"}\n');
        write(path.join(fake.store, 'coordinator', MACHINE, 'fresh-note.md'), '# a note written after the install\n');
        assert.deepStrictEqual(dryRunPaths(fake.store), [p + 'fresh-note.md']);
    } finally {
        rmDir(fake.home);
    }
});

test('each memory root admits the forms memq writes into it and refuses the rest', { skip: !isWin }, () => {
    const fake = makeStore({ operatorTier: true });
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        const mem = 'projects/' + PROJECT_A + '/memory';
        // One case per form each root actually holds, which is not the same
        // set for all three. The project tier holds memq's whole output: both
        // sidecars, the decay stamp, and them again at the two depths the
        // re-include has to keep reaching, the archive directory and the
        // run-scoped pending tier, whose usage sidecar memq reads back inside
        // a run and whose loss would cost a crashed run its own stamps. The
        // two shared tiers hold the usage sidecar and nothing else of memq's,
        // because the journal's writers and the decay stamp's both resolve
        // through the project memory directory.
        const owned = [mem + '/outcomes.jsonl', mem + '/usage.jsonl', mem + '/decay-stamp',
            mem + '/archive/outcomes.jsonl', mem + '/archive/decay-stamp',
            mem + '/pending/run-7/usage.jsonl',
            'memory-types/usage.jsonl', 'memory-types/archive/usage.jsonl',
            'memory-operator/usage.jsonl', 'memory-operator/archive/usage.jsonl'];
        assert.deepStrictEqual(predicateAnswers(owned), owned.map(() => true));
        for (const rel of owned) {
            assert.strictEqual(isIgnored(fake.store, rel), false, rel + ' must be admitted');
        }
        // A .jsonl no memq surface writes, at the same depths. memory-index
        // .jsonl is the near miss worth naming: memory-index.js writes that
        // name at the store root, which /* excludes and nothing re-includes,
        // so a copy of it inside a tier is a foreign file like any other.
        assertRefusedByLeafForm(fake.store, [
            [mem + '/stray.jsonl', mem + '/stray.md'],
            [mem + '/memory-index.jsonl', mem + '/memory-index.md'],
            [mem + '/pending/run-7/stray.jsonl', mem + '/pending/run-7/stray.md']
        ], '/projects/*/memory/**', '!/projects/*/memory/**/*.md');
        assertRefusedByLeafForm(fake.store, [
            ['memory-types/stray.jsonl', 'memory-types/stray.md'],
            // The two forms the project tier holds and this one does not.
            // decay-stamp takes a .md control, having no extension to vary.
            ['memory-types/decay-stamp', 'memory-types/decay-stamp.md'],
            ['memory-types/archive/decay-stamp', 'memory-types/archive/decay-stamp.md']
        ], '/memory-types/**', '!/memory-types/**/*.md');
        assertRefusedByLeafForm(fake.store, [
            ['memory-operator/stray.jsonl', 'memory-operator/stray.md'],
            ['memory-operator/decay-stamp', 'memory-operator/decay-stamp.md'],
            ['memory-operator/archive/decay-stamp', 'memory-operator/archive/decay-stamp.md']
        ], '/memory-operator/**', '!/memory-operator/**/*.md');
        // The journal, refused on both shared tiers against the sharpest
        // control there is: the sidecar the same root does admit, in the same
        // directory and the same .jsonl form. Its admission leaves the leaf
        // NAME as the only thing that differs, so the refusal cannot be read
        // as being about the extension, the directory, or the root.
        assertRefusedByLeafForm(fake.store, [
            ['memory-types/outcomes.jsonl', 'memory-types/usage.jsonl'],
            ['memory-types/archive/outcomes.jsonl', 'memory-types/archive/usage.jsonl']
        ], '/memory-types/**', '!/memory-types/**/usage.jsonl');
        assertRefusedByLeafForm(fake.store, [
            ['memory-operator/outcomes.jsonl', 'memory-operator/usage.jsonl'],
            ['memory-operator/archive/outcomes.jsonl', 'memory-operator/archive/usage.jsonl']
        ], '/memory-operator/**', '!/memory-operator/**/usage.jsonl');
    } finally {
        rmDir(fake.home);
    }
});

test('the root list, the generated allowlist, and the per-root leaf sets cannot drift apart', { skip: !isWin }, () => {
    // Three surfaces are written from the roots: the ignore text writes a
    // block per root from a literal prefix, the predicate branches on a
    // literal per root, and the attributes text iterates the prefix list. The
    // first two are pinned against each other in doctrine-parity.test.js; this
    // is the third, because a root added to the generator and not to the list
    // would silently cost that tier its union merge, which nothing else here
    // would notice.
    const script = '. ' + q(INSTALLER) + '; '
        + '$listed = @(Get-MemorySyncAdmittedRootPrefixes); '
        + '$generated = @(((Get-MemorySyncIgnoreText) -split "`n") '
        + '| Where-Object { $_ -match \'^!(.+)/\\*\\*/$\' } '
        + '| ForEach-Object { $Matches[1] }); '
        + '@{ Listed = $listed; Generated = $generated } | ConvertTo-Json -Compress';
    const res = pwsh(script);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    const roots = JSON.parse(res.stdout);
    assert.ok(roots.Listed.length >= 4, JSON.stringify(roots));
    assert.deepStrictEqual([...roots.Generated].sort(), [...roots.Listed].sort(),
        'the roots the ignore text re-includes and the roots Get-MemorySyncAdmittedRootPrefixes '
        + 'names are no longer the same set, so a root exists whose merge attributes are not derived');

    // And the leaf function refuses a root it has no arm for, rather than
    // handing back another root's forms. Watched speaking rather than assumed:
    // the case is a prefix no arm names, and the assertion is on the message.
    const bad = pwsh('. ' + q(INSTALLER) + '; '
        + 'try { Get-MemorySyncAllowedLeafPatterns -RootPrefix \'/coordinator-new\' } '
        + 'catch { Write-Output $_.Exception.Message }');
    assert.strictEqual(bad.status, 0, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /no leaf set is defined for the root '\/coordinator-new'/,
        'an unnamed root must throw rather than fall through to another root\'s forms: ' + bad.stdout);
});

test('a memory file whose name carries an accent is an ordinary tracked file, not a leak', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        // git prints such a path octal-escaped inside double quotes unless
        // told otherwise, and that rendering matches no allowlist rule. Read
        // naively it turns an ordinary memory file into a permanent FAIL whose
        // printed remedy names a literal that does not exist.
        write(path.join(fake.store, 'memory-types', 'café-notes.md'), '# cafe\n');
        assert.strictEqual(installRepo(fake.store).status, 0);
        const raw = git(fake.store, ['ls-files']);
        assert.match(raw.stdout, /"memory-types\/caf\\303\\251-notes\.md"/,
            'if git no longer quotes this path, the case proves nothing:\n' + raw.stdout);

        const status = statusOf(fake.store);
        assert.strictEqual(status.ProbesRan, true, status.Notes.join('\n'));
        assert.deepStrictEqual(status.Tracked, []);
        assert.deepStrictEqual(status.HistoryPaths, []);
        assert.deepStrictEqual(status.Unexpected, []);
        assert.ok(trackedPaths(fake.store).includes('memory-types/café-notes.md'));

        // And a second -Fix still commits, rather than refusing forever on a
        // path the index gate cannot read.
        write(path.join(fake.store, 'memory-types', 'another.md'), '# another\n');
        const again = installRepo(fake.store);
        assert.strictEqual(again.status, 0, again.stdout + again.stderr);
        assert.match(again.stdout, /Committed 1 pending change\(s\) admitted by the allowlist/);
    } finally {
        rmDir(fake.home);
    }
});

test('a probe that could not answer is named in the FAIL report, never read as a clean index', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        // A drifted allowlist plus a repository git cannot fully read. The
        // FAIL is about the drift, and an empty leak list beneath it would
        // otherwise say "nothing is tracked" when nothing was read.
        const ignorePath = path.join(fake.store, '.gitignore');
        fs.writeFileSync(ignorePath, fs.readFileSync(ignorePath, 'utf8').replace('\n/*\n', '\n'), 'utf8');
        // A ref pointing at an object that is not there. rev-list --all
        // refuses to walk it, so the history probe alone cannot answer while
        // the other three still do.
        write(path.join(fake.store, '.git', 'refs', 'heads', 'bogus'),
            '0000000000000000000000000000000000000000\n');

        const status = statusOf(fake.store);
        assert.strictEqual(status.ProbesRan, false, JSON.stringify(status));
        assert.ok(status.Notes.length > 0);
        // Three of the four probes answered; the history probe is the one the
        // bad ref stops. A bare "unproven" would not say how much was checked.
        assert.strictEqual(status.ProbesAttempted, 4);
        assert.strictEqual(status.ProbesAnswered, 3);

        const line = doctorSyncLine(fake.home);
        assert.strictEqual(line.status, 'FAIL', line.detail);
        assert.match(line.detail, /differs from the allowlist/, line.detail);
        assert.match(line.detail, /Only 3 of 4 direct probes could answer/, line.detail);
        assert.match(line.detail, /negative is unproven/, line.detail);
    } finally {
        rmDir(fake.home);
    }
});

test('an unanswerable probe over a canonical allowlist is a failure, not a warning', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        // Everything on disk reads right and the repository is the doctor's
        // own; only the probes cannot answer. A warning here exits 0 under a
        // "Healthy with N warning(s)" summary, which is the wrong thing to
        // tell an operator deciding whether the store is safe to push.
        write(path.join(fake.store, '.git', 'refs', 'heads', 'bogus'),
            '0000000000000000000000000000000000000000\n');
        const status = statusOf(fake.store);
        assert.strictEqual(status.IgnoreState, 'Canonical');
        assert.strictEqual(status.AttrState, 'Canonical');
        assert.strictEqual(status.ProbesRan, false);
        assert.deepStrictEqual(status.Tracked, []);

        const line = doctorSyncLine(fake.home);
        assert.strictEqual(line.status, 'FAIL', line.detail);
        assert.match(line.detail, /Only 3 of 4 direct probes could answer/, line.detail);
        assert.ok(!/every probe that ran came back clean/.test(line.detail), line.detail);
    } finally {
        rmDir(fake.home);
    }
});

test('the journals merge as line unions in every tier, live and archived', { skip: !isWin }, () => {
    const fake = makeStore({ operatorTier: true });
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        // Two machines that both appended since the last sync hold no
        // conflicting edit, only two sets of new lines, so the attribute is
        // what keeps a routine append from becoming a merge conflict. Every
        // path here is one the allowlist admits: check-attr answers about a
        // path whether or not it can ever sync, so a pin naming a refused name
        // would assert merge semantics for a file that never reaches a merge.
        for (const rel of ['projects/' + PROJECT_A + '/memory/outcomes.jsonl',
            'projects/' + PROJECT_A + '/memory/usage.jsonl',
            'projects/' + PROJECT_A + '/memory/archive/outcomes.jsonl',
            'projects/' + PROJECT_A + '/memory/pending/run-7/usage.jsonl',
            'memory-types/usage.jsonl',
            'memory-types/archive/usage.jsonl',
            'memory-operator/usage.jsonl',
            'memory-operator/archive/usage.jsonl']) {
            assert.strictEqual(mergeAttr(fake.store, rel), 'union', rel + ' must merge as a union');
            assert.strictEqual(isIgnored(fake.store, rel), false, rel
                + ' must be a path the allowlist admits, or the union rule covers a file that never syncs');
        }
        // And a root carries a union rule only for a .jsonl it admits, the
        // attributes text being derived from the same per-root leaf sets. The
        // coordinator root admits no .jsonl at all, and the two shared tiers
        // admit the usage sidecar and not the journal, so neither name below
        // has a rule: an absence by construction rather than an omission.
        for (const rel of ['coordinator/' + MACHINE + '/board-events.jsonl',
            'memory-types/outcomes.jsonl',
            'memory-operator/outcomes.jsonl']) {
            assert.notStrictEqual(mergeAttr(fake.store, rel), 'union',
                rel + ' is not a path its root admits, so no merge rule may name it');
        }
        // A memory body is prose, where a union merge would interleave two
        // rewrites into nonsense, so it takes git's default.
        assert.notStrictEqual(mergeAttr(fake.store, 'projects/' + PROJECT_A + '/memory/a-fact.md'), 'union');
        // The tier index is the exception among the .md forms: append-only by
        // shape, one line per record at the tail, so it unions exactly as the
        // journals do, live and archived, in every tier that carries one.
        for (const rel of ['projects/' + PROJECT_A + '/memory/MEMORY.md',
            'memory-types/MEMORY.md',
            'memory-types/archive/MEMORY.md',
            'memory-operator/MEMORY.md']) {
            assert.strictEqual(mergeAttr(fake.store, rel), 'union', rel + ' must merge as a union');
        }
        // And the index rule is derived from the tiers that carry a memq
        // index (the ones admitting usage.jsonl), so the coordinator tier,
        // which has no index, gains no rule from it.
        assert.notStrictEqual(mergeAttr(fake.store, 'coordinator/' + MACHINE + '/MEMORY.md'), 'union');
    } finally {
        rmDir(fake.home);
    }
});

test('the tier index survives a two-sided append as a union, and conflicts without the rule', { skip: !isWin }, () => {
    const fake = makeStore({ operatorTier: true });
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        const rel = 'memory-operator/MEMORY.md';
        const abs = path.join(fake.store, 'memory-operator', 'MEMORY.md');
        write(abs, '# Operator memory\n- [base](base.md) - the shared tail both sides append after\n');
        assert.strictEqual(git(fake.store, ['add', '--', rel]).status, 0);
        assert.strictEqual(git(fake.store, ['commit', '-q', '-m', 'base']).status, 0);
        const base = git(fake.store, ['rev-parse', 'HEAD']).stdout.trim();

        // Machine A adds two records; machine B, from the same base, adds
        // three different ones. Both append to the same tail, which is the
        // exact shape that wedged a real store: disjoint added lines that
        // git's default merge reads as a content conflict.
        fs.appendFileSync(abs, '- [alpha](alpha.md) - side A, first\n- [beta](beta.md) - side A, second\n');
        assert.strictEqual(git(fake.store, ['commit', '-q', '-a', '-m', 'side A']).status, 0);
        const sideA = git(fake.store, ['rev-parse', 'HEAD']).stdout.trim();
        assert.strictEqual(git(fake.store, ['checkout', '-q', '-b', 'side-b', base]).status, 0);
        fs.appendFileSync(abs, '- [gamma](gamma.md) - side B, first\n- [delta](delta.md) - side B, second\n- [epsilon](epsilon.md) - side B, third\n');
        assert.strictEqual(git(fake.store, ['commit', '-q', '-a', '-m', 'side B']).status, 0);

        // Red first: with the index rules stripped from the attributes file
        // (committed, so the merge reads the tampered version and the tree
        // stays clean), the same merge must conflict, or the rule is not
        // what the green direction proves.
        const attrPath = path.join(fake.store, '.gitattributes');
        const canonical = fs.readFileSync(attrPath, 'utf8');
        fs.writeFileSync(attrPath,
            canonical.split('\n').filter((l) => !l.includes('MEMORY.md')).join('\n'), 'utf8');
        assert.strictEqual(git(fake.store, ['commit', '-q', '-a', '-m', 'strip index rules']).status, 0);
        const red = git(fake.store, ['merge', '--no-edit', sideA]);
        assert.notStrictEqual(red.status, 0,
            'a two-sided append must conflict without the union rule, or this test proves nothing:\n'
            + red.stdout + red.stderr);
        assert.strictEqual(git(fake.store, ['merge', '--abort']).status, 0);

        // Green: canonical attributes restored, the identical merge is clean
        // and every added line survives exactly once.
        fs.writeFileSync(attrPath, canonical, 'utf8');
        assert.strictEqual(git(fake.store, ['commit', '-q', '-a', '-m', 'restore attributes']).status, 0);
        const green = git(fake.store, ['merge', '--no-edit', sideA]);
        assert.strictEqual(green.status, 0, green.stdout + green.stderr);
        const merged = fs.readFileSync(abs, 'utf8');
        for (const name of ['base', 'alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
            const count = (merged.match(new RegExp('\\[' + name + '\\]', 'g')) || []).length;
            assert.strictEqual(count, 1, name + ' must survive exactly once:\n' + merged);
        }
    } finally {
        rmDir(fake.home);
    }
});

test('the claims directory is machine-local: refused by the predicate, excluded by the allowlist, at any depth', { skip: !isWin }, () => {
    const fake = makeStore({ coordinator: true });
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        const p = 'coordinator/' + MACHINE + '/';
        // The control differs from the refused path in one directory segment
        // alone: same root, same depth, same .md leaf. Its admission proves
        // the root re-include, the leaf form, and the transient axis all
        // pass, which leaves the claims exclusion as the only rule that can
        // produce the refusal; without it the silence would have two causes.
        const cases = [
            [p + 'claims/heavy-process.md', false],
            [p + 'registry/heavy-process.md', true],
            // Depth is the pattern's own claim (** in the exclusion), so a
            // claims directory anywhere under the tier stays home.
            [p + 'claims/archive/old-claim.md', false],
            ['coordinator/claims/heavy-process.md', false]
        ];
        assert.deepStrictEqual(predicateAnswers(cases.map(([rel]) => rel)),
            cases.map(([, allowed]) => allowed));
        for (const [rel, allowed] of cases) {
            assert.strictEqual(isIgnored(fake.store, rel), !allowed, rel + ' must agree with the predicate');
        }
        // The refusing rule is the claims exclusion itself, named, so this
        // does not read as covered while an earlier axis does the refusing.
        assert.strictEqual(ignoreRule(fake.store, p + 'claims/heavy-process.md'),
            '/coordinator/**/claims/');
        // And the fixture's live claim file, present on disk through the
        // install's own commit, stayed home.
        assert.ok(!trackedPaths(fake.store).includes(p + 'claims/heavy-process.md'),
            'the install swept the claim file into the commit');
    } finally {
        rmDir(fake.home);
    }
});

test('a tampered allowlist line is drift in either direction, and -Fix restores it', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        const ignorePath = path.join(fake.store, '.gitignore');
        const canonical = fs.readFileSync(ignorePath, 'utf8');

        // Weakened: the root exclusion dropped, which puts .credentials.json
        // back in reach of an add. The status must call it drift whether or
        // not the probes still happen to pass.
        fs.writeFileSync(ignorePath, canonical.replace('\n/*\n', '\n'), 'utf8');
        const weakened = statusOf(fake.store);
        assert.strictEqual(weakened.IgnoreState, 'Drift');
        assert.ok(isIgnored(fake.store, '.credentials.json') === false,
            'the weakened allowlist is expected to expose the credential file; if not, this case proves nothing');

        // Tightened past usefulness: the project tier re-include dropped, so
        // the repo would silently stop syncing project memories.
        fs.writeFileSync(ignorePath, canonical.replace('!/projects/*/memory/**/*.md\n', ''), 'utf8');
        assert.strictEqual(statusOf(fake.store).IgnoreState, 'Drift');

        // The same for the attributes file, whose union merge is what keeps a
        // two-machine append from becoming a conflict.
        const attrPath = path.join(fake.store, '.gitattributes');
        const attrCanonical = fs.readFileSync(attrPath, 'utf8');
        fs.writeFileSync(attrPath, attrCanonical.replace('merge=union', 'merge=ours'), 'utf8');
        assert.strictEqual(statusOf(fake.store).AttrState, 'Drift');

        // Nothing was staged while the allowlist was weakened: the drifted
        // state is reported, never committed under.
        assert.deepStrictEqual(trackedPaths(fake.store), fake.allowed);
        assert.deepStrictEqual(historyPaths(fake.store), fake.allowed);

        // A check that says "re-run with -Fix" has to be reachable by -Fix.
        assert.strictEqual(installRepo(fake.store).status, 0);
        const repaired = statusOf(fake.store);
        assert.strictEqual(repaired.IgnoreState, 'Canonical');
        assert.strictEqual(repaired.AttrState, 'Canonical');
        assert.strictEqual(fs.readFileSync(ignorePath, 'utf8'), canonical);
        assert.strictEqual(fs.readFileSync(attrPath, 'utf8'), attrCanonical);
        // The repair staged and committed the memory tiers and nothing else,
        // which is the assertion a weakened allowlist would have broken.
        assert.deepStrictEqual(trackedPaths(fake.store), fake.allowed);
        assert.deepStrictEqual(historyPaths(fake.store), fake.allowed);
        assert.deepStrictEqual(repaired.Tracked, []);
        assert.deepStrictEqual(repaired.HistoryPaths, []);
    } finally {
        rmDir(fake.home);
    }
});

test('a foreign gitignore on a store root that is not yet a repo blocks the whole initialization', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        // The dangerous shape: no .git, so the repository is created, and a
        // .gitignore the doctor may not rewrite, so the rules governing an add
        // would be somebody else's. Under those rules `git add -A` reaches the
        // credentials, the settings, the prompt history, and every session
        // transcript.
        const ignorePath = path.join(fake.store, '.gitignore');
        const foreign = '# my own rules\n*.log\n';
        fs.writeFileSync(ignorePath, foreign, 'utf8');
        assert.strictEqual(statusOf(fake.store).IgnoreState, 'Foreign');

        const res = installRepo(fake.store);
        assert.notStrictEqual(res.status, 0, 'the repair must refuse:\n' + res.stdout + res.stderr);
        assert.match(res.stdout, /was not written by the doctor/);
        assert.match(res.stdout, /does not hold the canonical allowlist/);
        assert.match(res.stdout, /Nothing was staged or committed/);

        assert.strictEqual(fs.readFileSync(ignorePath, 'utf8'), foreign,
            'a file the doctor did not author is never rewritten');
        assert.strictEqual(statusOf(fake.store).IgnoreState, 'Foreign');
        // Nothing reached the index and nothing reached a commit. The refusal
        // is additive-only, so the .git the run created is left in place.
        assert.deepStrictEqual(trackedPaths(fake.store), []);
        assert.notStrictEqual(git(fake.store, ['rev-parse', 'HEAD']).status, 0);
        assert.deepStrictEqual(historyPaths(fake.store), []);

        // And the doctor offers no repair for this state, because the repair
        // it would describe is one the installer refuses to perform.
        const line = doctorSyncLine(fake.home);
        assert.strictEqual(line.status, 'FAIL', line.detail);
        assert.match(line.detail, /the doctor did not write/);
        assert.ok(!/-Fix/.test(line.detail), 'no repair may be promised that -Fix will not perform');
    } finally {
        rmDir(fake.home);
    }
});

test('a foreign gitignore in the doctor own repo still blocks the commit, and the report keeps naming the leaks', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        // The allowlist replaced wholesale after the fact, with a credential
        // forced into the index under the new rules. Every leak probe has
        // something to say here, and this is the state in which they matter.
        fs.writeFileSync(path.join(fake.store, '.gitignore'), '# my own rules\n*.log\n', 'utf8');
        assert.strictEqual(git(fake.store, ['add', '-f', '.credentials.json']).status, 0);

        const res = installRepo(fake.store);
        assert.notStrictEqual(res.status, 0, res.stdout + res.stderr);
        assert.match(res.stdout, /does not hold the canonical allowlist/);
        assert.strictEqual(git(fake.store, ['rev-list', '--count', 'HEAD']).stdout.trim(), '1',
            'the refusal makes no commit');

        const line = doctorSyncLine(fake.home);
        assert.strictEqual(line.status, 'FAIL', line.detail);
        assert.match(line.detail, /the doctor did not write/);
        // The foreign-file report is the state where the allowlist is least
        // trustworthy, so suppressing the probes there is what turns a staged
        // secret into a silent one.
        assert.match(line.detail, /Already tracked: \.credentials\.json/, line.detail);
        assert.match(line.detail, /An add would stage: /, line.detail);
        assert.match(line.detail, /git rm --cached/, line.detail);
    } finally {
        rmDir(fake.home);
    }
});

test('a credential that reached a commit is caught by the history probe after it is untracked', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        assert.strictEqual(git(fake.store, ['add', '-f', '.credentials.json']).status, 0);
        assert.strictEqual(git(fake.store, ['commit', '--quiet', '-m', 'forced']).status, 0);
        // The printed remediation for a tracked leak, followed exactly. It
        // clears the index and the worktree probes, and leaves the blob in
        // history where a push would still publish it.
        assert.strictEqual(git(fake.store, ['rm', '--cached', '--quiet', '.credentials.json']).status, 0);
        assert.strictEqual(git(fake.store, ['commit', '--quiet', '-m', 'untracked']).status, 0);

        const status = statusOf(fake.store);
        assert.strictEqual(status.ProbesRan, true, status.Notes.join('\n'));
        assert.deepStrictEqual(status.NotIgnored, []);
        assert.deepStrictEqual(status.Unexpected, []);
        assert.deepStrictEqual(status.Tracked, []);
        assert.deepStrictEqual(status.HistoryPaths, ['.credentials.json']);

        const line = doctorSyncLine(fake.home);
        assert.strictEqual(line.status, 'FAIL', line.detail);
        assert.match(line.detail, /In committed history: \.credentials\.json/, line.detail);
        // Untracking is not the remedy here, and saying so is the difference
        // between a leak closed and a leak believed closed.
        assert.match(line.detail, /rewrite the history/, line.detail);
        assert.match(line.detail, /rotate every credential/, line.detail);
    } finally {
        rmDir(fake.home);
    }
});

test('a credential introduced only in a merge resolution is caught by the history probe', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        const run = (args) => assert.strictEqual(git(fake.store, args).status, 0, args.join(' '));
        run(['checkout', '--quiet', '-b', 'side']);
        write(path.join(fake.store, 'memory-types', 'side.md'), '# side\n');
        run(['add', '-A']);
        run(['commit', '--quiet', '-m', 'side']);
        run(['checkout', '--quiet', '-']);
        write(path.join(fake.store, 'memory-types', 'main.md'), '# main\n');
        run(['add', '-A']);
        run(['commit', '--quiet', '-m', 'main']);
        // An evil merge: the blob enters during the resolution, so it belongs
        // to no parent's tree and is named by no per-commit diff. git log
        // lists no file names for a merge commit at all under its default
        // --diff-merges=off, which is why the probe walks objects instead.
        git(fake.store, ['merge', '--no-commit', '--no-ff', 'side']);
        write(path.join(fake.store, 'evil-credential.json'), '{"token":"secret"}\n');
        run(['add', '-f', 'evil-credential.json']);
        run(['commit', '--quiet', '-m', 'merge']);
        // The control: the surface the weaker probe reads does not hold it.
        const viaLog = git(fake.store, ['log', '--all', '--name-only', '--pretty=format:']);
        assert.strictEqual(viaLog.status, 0, viaLog.stderr);
        assert.ok(!/evil-credential\.json/.test(viaLog.stdout),
            'if the log surface does list it, this case proves nothing');
        assert.ok(historyPaths(fake.store).includes('evil-credential.json'));

        const status = statusOf(fake.store);
        assert.strictEqual(status.ProbesRan, true, status.Notes.join('\n'));
        assert.deepStrictEqual(status.HistoryPaths, ['evil-credential.json']);
        const line = doctorSyncLine(fake.home);
        assert.strictEqual(line.status, 'FAIL', line.detail);
        assert.match(line.detail, /In committed history: evil-credential\.json/, line.detail);
    } finally {
        rmDir(fake.home);
    }
});

test('a disallowed path already in the index blocks the next repair commit', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        // Tracked and unmodified, so it appears in ls-files and in no staged
        // diff. A commit would carry it forward untouched.
        assert.strictEqual(git(fake.store, ['add', '-f', '.credentials.json']).status, 0);
        assert.strictEqual(git(fake.store, ['commit', '--quiet', '-m', 'forced']).status, 0);
        const head = git(fake.store, ['rev-parse', 'HEAD']).stdout.trim();
        // A real change alongside it, so the repair has something it would
        // otherwise commit and the refusal is the reason nothing lands.
        write(path.join(fake.store, 'memory-types', 'new-type.md'), '# new\n');

        const res = installRepo(fake.store);
        assert.notStrictEqual(res.status, 0, res.stdout + res.stderr);
        assert.match(res.stdout, /the allowlist does not admit/);
        assert.match(res.stdout, /\.credentials\.json/);
        assert.strictEqual(git(fake.store, ['rev-list', '--count', head + '..HEAD']).stdout.trim(), '0',
            'no commit is made over a disallowed index');
        // The refusal removes nothing: untracking somebody's file is the
        // operator's call, not the doctor's.
        assert.ok(trackedPaths(fake.store).includes('.credentials.json'));
    } finally {
        rmDir(fake.home);
    }
});

test('a nested gitignore that re-includes a transcript is caught by the dry-run probe', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        // git reads a .gitignore in every directory it traverses, and rules
        // there are applied after the root's, so a file placed inside a
        // traversed project directory can re-include what the root excluded.
        // The root allowlist is therefore not by itself a structural bar; the
        // probes are what close it, and they answer on the positive rule
        // rather than on the ignore rules, so the re-included path is flagged
        // and the index gate refuses to commit it.
        write(path.join(fake.store, 'projects', PROJECT_A, '.gitignore'), '!*.jsonl\n');
        const reIncluded = 'projects/' + PROJECT_A + '/a1b2c3d4-session.jsonl';
        assert.ok(dryRunPaths(fake.store).includes(reIncluded),
            'if git no longer honors the nested file, this case proves nothing');

        const status = statusOf(fake.store);
        assert.ok(status.Unexpected.includes(reIncluded), JSON.stringify(status.Unexpected));
        const line = doctorSyncLine(fake.home);
        assert.strictEqual(line.status, 'FAIL', line.detail);
        assert.match(line.detail, /An add would stage: projects/, line.detail);

        // And a repair refuses rather than committing the transcript.
        const res = installRepo(fake.store);
        assert.notStrictEqual(res.status, 0, res.stdout + res.stderr);
        assert.match(res.stdout, /the allowlist does not admit/);
        assert.ok(!trackedPaths(fake.store).includes(reIncluded));
    } finally {
        rmDir(fake.home);
    }
});

test('a post-add refusal leaves the index exactly as the add found it', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        const before = trackedPaths(fake.store);
        // A path only an add would pull in: allowed by the nested rules git
        // reads, refused by the positive predicate the gate applies. The gate
        // catches it after the add, which is the path that would otherwise
        // leave a transcript staged in a repository about to gain a remote.
        write(path.join(fake.store, 'projects', PROJECT_A, '.gitignore'), '!*.jsonl\n');
        const res = installRepo(fake.store);
        assert.notStrictEqual(res.status, 0, res.stdout + res.stderr);
        assert.match(res.stdout, /the allowlist does not admit/);
        assert.match(res.stdout, /returned to what it held before/);
        assert.deepStrictEqual(trackedPaths(fake.store), before,
            'the refusal must not leave the add staged');
        // Additive: the restore touches the index alone, never the worktree.
        assert.ok(fs.existsSync(path.join(fake.store, 'projects', PROJECT_A, 'a1b2c3d4-session.jsonl')));
        assert.ok(fs.existsSync(path.join(fake.store, 'projects', PROJECT_A, '.gitignore')));
    } finally {
        rmDir(fake.home);
    }
});

test('a fresh init that refuses after the add leaves no path staged', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        // No prior index at all, so the pre-add tree is the empty tree. The
        // unborn case must restore to nothing rather than fail into a note.
        write(path.join(fake.store, 'projects', PROJECT_A, '.gitignore'), '!*.jsonl\n');
        const res = installRepo(fake.store);
        assert.notStrictEqual(res.status, 0, res.stdout + res.stderr);
        assert.match(res.stdout, /the allowlist does not admit/);
        assert.match(res.stdout, /returned to what it held before/);
        assert.deepStrictEqual(trackedPaths(fake.store), []);
        assert.notStrictEqual(git(fake.store, ['rev-parse', 'HEAD']).status, 0);
        assert.ok(fs.existsSync(path.join(fake.store, '.credentials.json')));
    } finally {
        rmDir(fake.home);
    }
});

test('the ownership marker survives the deletion of the allowlist file', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        // A repository recognized only by its .gitignore becomes a stranger
        // the moment that file is deleted, with no repair reachable for the
        // one state that most needs one.
        fs.rmSync(path.join(fake.store, '.gitignore'));
        const status = statusOf(fake.store);
        assert.strictEqual(status.IsRepo, true);
        assert.strictEqual(status.IgnoreState, 'Missing');
        assert.strictEqual(status.IsOwnRepo, true);

        const line = doctorSyncLine(fake.home);
        assert.strictEqual(line.status, 'FAIL', line.detail);
        assert.match(line.detail, /\.gitignore is missing/);
        assert.match(line.detail, /-Fix/);
        // With no allowlist on disk at all, an add reaches the credentials,
        // the settings, the prompt history, and every transcript. Naming the
        // gap without naming what it exposes is the report a reader trusts.
        assert.match(line.detail, /An add would stage: /, line.detail);

        // The promise the FAIL text makes has to be one -Fix keeps, so the
        // doctor's own gate is evaluated for this exact state rather than
        // inferred from the repair succeeding when called directly.
        // Every repairable state of both managed files, because the promise
        // the class makes is that a FAIL naming -Fix is a state -Fix acts on.
        for (const fields of [
            { IsRepo: true, IsOwnRepo: true, IgnoreState: 'Missing', AttrState: 'Canonical' },
            { IsRepo: true, IsOwnRepo: true, IgnoreState: 'Drift', AttrState: 'Canonical' },
            { IsRepo: true, IsOwnRepo: true, IgnoreState: 'Canonical', AttrState: 'Missing' },
            { IsRepo: true, IsOwnRepo: true, IgnoreState: 'Canonical', AttrState: 'Drift' },
            { IsRepo: false, IsOwnRepo: false, IgnoreState: 'Missing', AttrState: 'Missing' }
        ]) {
            const gate = doctorFixGate(fields);
            assert.strictEqual(gate.Adoptable, true, JSON.stringify(fields));
            assert.strictEqual(gate.NeedsWork, true,
                'a -Fix run must prompt for this state, not skip it: ' + JSON.stringify(fields));
        }
        // And the settled state asks for nothing, so a -Fix on a healthy store
        // does not prompt to repair what is already right.
        const settled = doctorFixGate({
            IsRepo: true, IsOwnRepo: true, IgnoreState: 'Canonical', AttrState: 'Canonical'
        });
        assert.strictEqual(settled.NeedsWork, false);

        assert.strictEqual(installRepo(fake.store).status, 0);
        assert.strictEqual(statusOf(fake.store).IgnoreState, 'Canonical');
    } finally {
        rmDir(fake.home);
    }
});

test('a repository the doctor did not create is left alone entirely', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        // An operator versioning their dotfiles at the store root, with work
        // already staged. Writing an allowlist and committing here would put
        // their staged file, and the memory tiers, in a commit they never
        // asked for and possibly push it to their own remote.
        assert.strictEqual(git(fake.store, ['init', '--quiet']).status, 0);
        assert.strictEqual(git(fake.store, ['remote', 'add', 'origin', 'https://example.invalid/dotfiles.git']).status, 0);
        assert.strictEqual(git(fake.store, ['add', 'settings.json']).status, 0);

        const status = statusOf(fake.store);
        assert.strictEqual(status.IsRepo, true);
        assert.strictEqual(status.IsOwnRepo, false);

        const res = installRepo(fake.store);
        assert.strictEqual(res.status, 0, res.stdout + res.stderr);
        assert.match(res.stdout, /did not create/);
        assert.match(res.stdout, /Nothing was written, staged, or committed/);
        assert.ok(!fs.existsSync(path.join(fake.store, '.gitignore')));
        assert.ok(!fs.existsSync(path.join(fake.store, '.gitattributes')));
        // No commit was made at all, so there is still no HEAD.
        assert.notStrictEqual(git(fake.store, ['rev-parse', 'HEAD']).status, 0);
        assert.deepStrictEqual(trackedPaths(fake.store), ['settings.json']);

        const line = doctorSyncLine(fake.home);
        assert.strictEqual(line.status, 'FAIL', line.detail);
        assert.match(line.detail, /did not create/);
        assert.ok(!/-Fix/.test(line.detail), 'no repair may be promised that -Fix will not perform');
    } finally {
        rmDir(fake.home);
    }
});

test('a CRLF checkout of the managed files is canonical, not drift', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        // What a clone with core.autocrlf=true has on disk. A machine in that
        // configuration must not read as drift on every doctor run, and -Fix
        // must not fight its checkout.
        for (const name of ['.gitignore', '.gitattributes']) {
            const file = path.join(fake.store, name);
            fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'), 'utf8');
        }
        const status = statusOf(fake.store);
        assert.strictEqual(status.IgnoreState, 'Canonical');
        assert.strictEqual(status.AttrState, 'Canonical');
        assert.strictEqual(status.IsOwnRepo, true);
    } finally {
        rmDir(fake.home);
    }
});

test('a force-added credential file is caught by the tracked-path probe', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        // gitignore does not apply to a tracked file, so this escapes both
        // check-ignore and the dry-run add. Only the index answers it.
        assert.strictEqual(git(fake.store, ['add', '-f', '.credentials.json']).status, 0);
        assert.strictEqual(git(fake.store, ['commit', '--quiet', '-m', 'forced']).status, 0);
        assert.ok(isIgnored(fake.store, '.credentials.json'), 'the ignore rule is untouched, which is the point');
        assert.deepStrictEqual(dryRunPaths(fake.store), []);
        const status = statusOf(fake.store);
        assert.deepStrictEqual(status.Tracked, ['.credentials.json']);
    } finally {
        rmDir(fake.home);
    }
});

test('a second -Fix is a no-op that neither re-commits nor changes what is tracked', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        // A clean canonical repo reads as not dirty, which is what keeps
        // -Fix's new pending-change clause from prompting on a healthy store
        // that has nothing to commit.
        const cleanStatus = statusOf(fake.store);
        assert.strictEqual(cleanStatus.Dirty, false, JSON.stringify(cleanStatus));
        assert.strictEqual(cleanStatus.DirtyCount, 0, JSON.stringify(cleanStatus));
        const before = trackedPaths(fake.store);
        const head = git(fake.store, ['rev-parse', 'HEAD']).stdout.trim();
        const again = installRepo(fake.store);
        assert.strictEqual(again.status, 0, again.stdout + again.stderr);
        assert.match(again.stdout, /Nothing to commit/);
        assert.deepStrictEqual(trackedPaths(fake.store), before);
        assert.strictEqual(git(fake.store, ['rev-parse', 'HEAD']).stdout.trim(), head);
    } finally {
        rmDir(fake.home);
    }
});

// The steady-state hole was in doctor.ps1's own decision of when to call
// Install-MemorySyncRepo at all (locked separately below, by lifting
// $syncNeedsWork itself): a repository already canonical on both managed
// files never used to reach it, so -Fix committed nothing beyond the heal
// that made it canonical, and every memory a session wrote afterward stayed
// local. This case locks the other half, Get-MemorySyncStatus's new Dirty
// field and Install-MemorySyncRepo's commit path itself: once reached, the
// commit runs through the same gates a drift repair takes (the pre-add and
// post-add index checks against the allowlist), and the status the caller
// would gate on reads correctly.
test('a canonical repo with a pending memory-tier change reads as dirty, and -Fix commits it through the same gates', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        const head = git(fake.store, ['rev-parse', 'HEAD']).stdout.trim();
        write(path.join(fake.store, 'memory-types', 'pending-fact.md'), '# pending\n');

        const status = statusOf(fake.store);
        assert.strictEqual(status.IgnoreState, 'Canonical');
        assert.strictEqual(status.AttrState, 'Canonical');
        assert.strictEqual(status.Dirty, true, JSON.stringify(status));
        assert.strictEqual(status.DirtyCount, 1, JSON.stringify(status));

        const res = installRepo(fake.store);
        assert.strictEqual(res.status, 0, res.stdout + res.stderr);
        assert.match(res.stdout, /Committed 1 pending change\(s\) admitted by the allowlist/);
        assert.ok(!/Wrote \.git|Restored the canonical/.test(res.stdout),
            'no managed file was rewritten; only a pending memory was committed:\n' + res.stdout);

        assert.notStrictEqual(git(fake.store, ['rev-parse', 'HEAD']).stdout.trim(), head, 'a new commit was made');
        const tracked = trackedPaths(fake.store);
        assert.ok(tracked.includes('memory-types/pending-fact.md'), tracked.join(','));
        assert.deepStrictEqual(historyPaths(fake.store), fake.allowed.concat(['memory-types/pending-fact.md']).sort(),
            'the new commit went through the same history probe every other commit here does');
    } finally {
        rmDir(fake.home);
    }
});

// A disallowed path blocks a pending-change commit exactly as it blocks a
// drift-repair commit: the same pre-add and post-add gates run regardless of
// why Install-MemorySyncRepo was reached, so a leak already in the index is
// caught here too, and nothing is committed over it.
test('a disallowed tracked path still blocks a pending-change-only commit', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        assert.strictEqual(git(fake.store, ['add', '-f', '.credentials.json']).status, 0);
        assert.strictEqual(git(fake.store, ['commit', '--quiet', '-m', 'forced']).status, 0);
        const head = git(fake.store, ['rev-parse', 'HEAD']).stdout.trim();
        // A real change alongside the leak, so the commit has something it
        // would otherwise take.
        write(path.join(fake.store, 'memory-types', 'new-type.md'), '# new\n');

        const res = installRepo(fake.store);
        assert.notStrictEqual(res.status, 0, res.stdout + res.stderr);
        assert.match(res.stdout, /the allowlist does not admit/);
        assert.strictEqual(git(fake.store, ['rev-parse', 'HEAD']).stdout.trim(), head,
            'no commit is made over a disallowed index, whether reached by drift or by a pending change');
    } finally {
        rmDir(fake.home);
    }
});

// The neighbouring state the fix must not touch: drift repair and a pending
// memory-tier commit compose in one -Fix run rather than the dirty path
// silently taking over. Both facts ride in the same notes list.
test('a drifted repo still repairs the allowlist and commits both the repair and any pending change', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        const ignorePath = path.join(fake.store, '.gitignore');
        const canonical = fs.readFileSync(ignorePath, 'utf8');
        fs.writeFileSync(ignorePath, canonical.replace('\n/*\n', '\n'), 'utf8');
        write(path.join(fake.store, 'memory-types', 'pending-fact.md'), '# pending\n');

        assert.strictEqual(statusOf(fake.store).IgnoreState, 'Drift');

        const res = installRepo(fake.store);
        assert.strictEqual(res.status, 0, res.stdout + res.stderr);
        assert.match(res.stdout, /Restored the canonical \.gitignore/);
        assert.match(res.stdout, /Committed 1 pending change\(s\) admitted by the allowlist/);

        const repaired = statusOf(fake.store);
        assert.strictEqual(repaired.IgnoreState, 'Canonical');
        assert.ok(trackedPaths(fake.store).includes('memory-types/pending-fact.md'));
    } finally {
        rmDir(fake.home);
    }
});

// The other neighbouring state: a foreign repository (one the doctor did not
// create) is still refused outright even when it holds uncommitted changes,
// because Dirty can only ever be true and $syncAdoptable simultaneously false
// there is exactly the state $syncAdoptable's own foreign-file check exists
// to catch; the fix's new clause never overrides it.
test('a foreign repository with uncommitted changes is still refused, never committed into', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(git(fake.store, ['init', '--quiet']).status, 0);
        fs.writeFileSync(path.join(fake.store, '.gitignore'), '# my own rules\n*.log\n', 'utf8');
        assert.strictEqual(git(fake.store, ['add', 'settings.json']).status, 0);

        const status = statusOf(fake.store);
        assert.strictEqual(status.IsRepo, true);
        assert.strictEqual(status.IsOwnRepo, false);

        const res = installRepo(fake.store);
        assert.strictEqual(res.status, 0, res.stdout + res.stderr);
        assert.match(res.stdout, /did not create/);
        assert.match(res.stdout, /Nothing was written, staged, or committed/);
        assert.notStrictEqual(git(fake.store, ['rev-parse', 'HEAD']).status, 0, 'no commit was ever made');
    } finally {
        rmDir(fake.home);
    }
});

// The consent prompt itself, real doctor.ps1 code lifted and run against a
// stubbed status for every combination: it must never describe a repair that
// is not happening (Section 1's original finding, mirrored onto the new
// branch), it must name every part of the store the commit it authorizes
// actually carries, and it must offer nothing at all when there is genuinely
// nothing to do. The naming half is a consent property rather than a wording
// preference: the allowlist admits the memory tiers and the coordinator
// directory, so a prompt naming only the tiers asks the operator to approve
// less than -Fix commits, and less than the sync runner's later push publishes.
test('the consent prompt names exactly the action -Fix is about to take, for every combination', { skip: !isWin }, () => {
    // Not a repo at all: init plus one commit.
    let g = doctorFixQuestion({ IsRepo: false, IsOwnRepo: false, IgnoreState: 'Missing', AttrState: 'Missing', Dirty: false, DirtyCount: 0 });
    assert.strictEqual(g.NeedsWork, true);
    assert.match(g.Question, /Initialize .* as the memory-sync git repository/);
    assert.match(g.Question, /memory tiers and the coordinator directory/);

    // A repo whose allowlist drifted: restore plus commit, regardless of Dirty.
    for (const dirty of [false, true]) {
        g = doctorFixQuestion({ IsRepo: true, IsOwnRepo: true, IgnoreState: 'Drift', AttrState: 'Canonical', Dirty: dirty, DirtyCount: dirty ? 2 : 0 });
        assert.strictEqual(g.NeedsWork, true);
        assert.match(g.Question, /Restore the canonical memory-sync allowlist/, JSON.stringify({ dirty, g }));
        assert.match(g.Question, /memory tiers and the coordinator directory/, JSON.stringify({ dirty, g }));
        assert.ok(!/pending change/.test(g.Question), 'a drift repair must not be described as a plain commit');
    }

    // A canonical repo, clean: nothing to do, and the prompt is never reached
    // in practice since NeedsWork is false (doctor.ps1 never calls Get-Consent
    // in that state), but the gate itself is the property this line checks.
    g = doctorFixQuestion({ IsRepo: true, IsOwnRepo: true, IgnoreState: 'Canonical', AttrState: 'Canonical', Dirty: false, DirtyCount: 0 });
    assert.strictEqual(g.NeedsWork, false);

    // A canonical repo, dirty: the new case. The prompt must name a commit of
    // pending changes, never a repair, and it must carry the real count.
    g = doctorFixQuestion({ IsRepo: true, IsOwnRepo: true, IgnoreState: 'Canonical', AttrState: 'Canonical', Dirty: true, DirtyCount: 3 });
    assert.strictEqual(g.NeedsWork, true);
    assert.match(g.Question, /Commit 3 pending change\(s\) to the memory tiers and the coordinator directory/);
    assert.ok(!/Restore the canonical|Initialize/.test(g.Question),
        'a pending-change commit must not be described as a repair or a fresh init:\n' + g.Question);

    // A foreign file: never adoptable, so NeedsWork is false regardless of
    // Dirty, and no prompt question is ever built for this state in practice.
    g = doctorFixGate({ IsRepo: true, IsOwnRepo: false, IgnoreState: 'Foreign', AttrState: 'Canonical' });
    assert.strictEqual(g.Adoptable, false);
    assert.strictEqual(g.NeedsWork, false);
});

// Check mode (no -Fix) against a redirected store root: the report names
// uncommitted memory-tier changes when they exist, and says nothing extra
// when the repo is clean, so an operator can tell whether their memories are
// actually committed without running -Fix first. A freshly installed store has
// no remote yet, so the section reads WARN here on that count alone; what this
// case pins is the uncommitted-changes detail, which rides either status.
test('check mode names uncommitted changes in the report, and says nothing extra when clean', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);

        const clean = doctorSyncLine(fake.home);
        assert.strictEqual(clean.status, 'WARN', clean.detail);
        assert.ok(!/uncommitted change/.test(clean.detail), 'a clean repo must not claim uncommitted work:\n' + clean.detail);

        write(path.join(fake.store, 'memory-types', 'pending-fact.md'), '# pending\n');
        const dirty = doctorSyncLine(fake.home);
        assert.strictEqual(dirty.status, 'WARN', dirty.detail);
        assert.match(dirty.detail, /1 uncommitted change\(s\) under the allowlist, not yet committed/);
        assert.match(dirty.detail, /re-run doctor with -Fix/);

        // And check mode changed nothing: the new file is still untracked,
        // and HEAD has not moved.
        assert.ok(!trackedPaths(fake.store).includes('memory-types/pending-fact.md'));
    } finally {
        rmDir(fake.home);
    }
});

test('the store root is mandatory: no call can default to the real home directory', { skip: !isWin }, () => {
    // A missing -StoreRoot is a parameter error under a non-interactive host,
    // never a silent fall back to ~/.claude, which is what keeps a forgotten
    // redirect from running git init over the operator's credentials.
    for (const fn of ['Get-MemorySyncStatus', 'Install-MemorySyncRepo']) {
        const res = spawnSync('powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
                '. ' + q(INSTALLER) + '; ' + fn],
            { encoding: 'utf8', env: { ...process.env } });
        assert.notStrictEqual(res.status, 0, fn + ' must not run without -StoreRoot');
    }
    // And no default is written anywhere in the file's code, comments aside.
    const code = fs.readFileSync(INSTALLER, 'utf8').split(/\r?\n/)
        .filter((l) => !/^\s*#/.test(l)).join('\n');
    assert.ok(!/USERPROFILE|\$HOME|HomeDirectory|\$env:HOME/.test(code),
        'the installer must resolve no path of its own');
});

// The doctor itself, against a redirected home directory. Check mode writes
// nothing (every write in doctor.ps1 sits under -Fix), and the run is
// asserted on its own section's line rather than on the exit code, because
// other sections legitimately fail against a fake home.
function doctorSyncLine(home, extraEnv) {
    const res = pwsh('& ' + q(DOCTOR), { USERPROFILE: home, ...(extraEnv || {}) });
    const lines = res.stdout.split(/\r?\n/);
    const header = /^\[\w+\s*\] .+$/;
    const at = lines.findIndex((l) => /^\[\w+\s*\] Memory sync$/.test(l.trim()));
    assert.notStrictEqual(at, -1, 'no Memory sync section in the doctor output:\n' + res.stdout + res.stderr);
    // The slice ends at the next section header. Running to the end of the
    // output would fold the following sections' detail lines into this one's,
    // and a negative assertion would then range over text that varies with
    // machine state and that this section never printed.
    const rest = lines.slice(at + 1);
    const until = rest.findIndex((l) => header.test(l.trim()));
    return {
        status: lines[at].trim().match(/^\[(\w+)/)[1],
        detail: (until < 0 ? rest : rest.slice(0, until)).filter((l) => l.startsWith('        ')).join('\n')
    };
}

test('the doctor reports the sync section in both states against a redirected store root', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        const absent = doctorSyncLine(fake.home);
        assert.strictEqual(absent.status, 'WARN', absent.detail);
        assert.match(absent.detail, /not a git repository/);
        assert.match(absent.detail, /-Fix/);
        // The remedy line names what the repair would commit, on the same
        // consent ground as the -Fix prompts: the allowlist admits the memory
        // tiers and the coordinator directory, so a line naming only the
        // tiers understates what a -Fix on this store publishes.
        assert.match(absent.detail, /memory tiers and the coordinator directory/);

        assert.strictEqual(installRepo(fake.store).status, 0);
        // A canonical allowlist with no remote is not a pass: every leak probe
        // reads clean on a store that replicates nowhere, which is the one
        // state where a green section is actively misleading.
        const present = doctorSyncLine(fake.home);
        assert.strictEqual(present.status, 'WARN', present.detail);
        assert.match(present.detail, /4 sensitive path\(s\) proven ignored/);
        assert.match(present.detail, /replicates nowhere/);
        assert.match(present.detail, /remote add origin/);

        // Drift is a failure, never a warning: a mangled ignore file is how
        // sync becomes credential exfiltration.
        const ignorePath = path.join(fake.store, '.gitignore');
        fs.writeFileSync(ignorePath,
            fs.readFileSync(ignorePath, 'utf8').replace('\n/*\n', '\n'), 'utf8');
        const drifted = doctorSyncLine(fake.home);
        assert.strictEqual(drifted.status, 'FAIL', drifted.detail);
        assert.match(drifted.detail, /differs from the allowlist/);
    } finally {
        rmDir(fake.home);
    }
});

// The -Fix report branches, reached by extracting the doctor's memory-sync
// section and driving it directly. The whole doctor cannot serve here: under
// -Fix its embedder section installs software, which a test must never do. The
// extraction mirrors the goal-state section harness in doctor-goal-state.test.js,
// and the installer is dot-sourced rather than stubbed, so the commit the
// section reports on is a real one.
// $prelude is PowerShell run after the installer is dot-sourced and before the
// section, which is where a case shadows one of the installer's readings for a
// state no fixture can produce (a hostname that reads blank). $fix is the
// section's own -Fix switch, false for the check-mode branches, which are the
// ones a store that is not a repository yet lands on.
function doctorSyncSectionReports(store, prelude, fix) {
    const outFile = path.join(os.tmpdir(), 'memsync-fix-' + process.pid + '-' + Date.now()
        + '-' + Math.random().toString(36).slice(2) + '.json');
    const script = [
        '$src = [System.IO.File]::ReadAllText(' + q(DOCTOR) + ')',
        '$startMarker = "# --- Memory sync. The memory store is"',
        '$endMarker = "# --- Embedder (semantic memory search)."',
        '$start = $src.IndexOf($startMarker)',
        'if ($start -lt 0) { throw "memory sync start marker not found in doctor.ps1" }',
        '$end = $src.IndexOf($endMarker, $start)',
        'if ($end -lt 0) { throw "memory sync end marker not found after the section" }',
        '$section = $src.Substring($start, $end - $start)',
        '. ' + q(INSTALLER),
        ...(prelude || []),
        '$script:Reports = @()',
        'function Get-SanitizedLine { param($Value, $MaxLength = 120) return [string]$Value }',
        'function Report { param([string]$Status, [string]$Name, [string[]]$Detail = @())',
        '    $script:Reports += @{ Status = $Status; Name = $Name; Detail = ($Detail -join "`n") } }',
        'function Get-Consent { param($Question) return $true }',
        '$claudeDir = ' + q(store),
        '$Fix = $' + (fix === false ? 'false' : 'true'),
        'Invoke-Expression $section',
        '$__json = @{ Reports = @($script:Reports) } | ConvertTo-Json -Compress -Depth 6',
        '[System.IO.File]::WriteAllText(' + q(outFile) + ', $__json, (New-Object System.Text.UTF8Encoding($false)))'
    ].join('\n');
    const res = pwsh(script);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    const parsed = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    fs.rmSync(outFile, { force: true });
    assert.ok(Array.isArray(parsed.Reports), 'Reports must be an array: ' + res.stdout);
    return parsed.Reports.filter((r) => r.Name === 'Memory sync');
}

// The -Fix half of that harness, which is what most cases here drive.
function doctorSyncFixReports(store, prelude) {
    return doctorSyncSectionReports(store, prelude, true);
}

// The machine name reads blank on every branch or on none, and the reports it
// has to reach are the ones an operator actually lands on. Two of those sit
// outside the check-mode tail that carries the remedy by default: the -Fix
// refusal, whose whole cause is the blank name, and the report for a store
// that is not a repository yet, whose only advice is the -Fix the installer
// then refuses. Both pin the reading the operator has to repair rather than
// the sentence around it.
const BLANK_MACHINE_SHADOW = ['function Get-MemorySyncMachineName { return "" }'];

test('the -Fix refusal names the blank machine name that caused it', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        // A pending change, which is what opens the -Fix consent gate on an
        // already-canonical store and so routes this run through the
        // installer rather than through the check-mode branches.
        write(path.join(fake.store, 'memory-types', 'a-new-note.md'), '# a fact this run wrote\n');

        const reports = doctorSyncFixReports(fake.store, BLANK_MACHINE_SHADOW);
        assert.strictEqual(reports.length, 1, JSON.stringify(reports));
        assert.strictEqual(reports[0].Status, 'FAIL', reports[0].Detail);
        assert.match(reports[0].Detail, /GetHostName\(\)/,
            'the refusal hands over the reading to repair: ' + reports[0].Detail);
    } finally {
        rmDir(fake.home);
    }
});

test('the not-a-repository report names a blank machine name beside its -Fix recipe', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        const reports = doctorSyncSectionReports(fake.store, BLANK_MACHINE_SHADOW, false);
        assert.strictEqual(reports.length, 1, JSON.stringify(reports));
        // The branch identity: this is the store-is-not-a-repository report,
        // and it still warns rather than failing, since a store with no repo
        // syncs nothing either way.
        assert.strictEqual(reports[0].Status, 'WARN', reports[0].Detail);
        assert.ok(reports[0].Detail.includes(fake.store), reports[0].Detail);
        assert.match(reports[0].Detail, /GetHostName\(\)/,
            'and the -Fix it recommends is one the installer refuses until the name resolves: '
            + reports[0].Detail);
    } finally {
        rmDir(fake.home);
    }
});

// A commit reported beside an "origin:" line and a "Destination:" line reads as
// published, so the FIXED block names the push's own status and hands over the
// command. That pairing is safe in exactly one report and nowhere else: every
// other branch reachable here is a WARN or a FAIL, and the leak FAIL is one the
// operator reaches while a non-memory blob sits in committed history, where a
// ready-made push command is the precise act the leak probes exist to prevent.
// The two halves are pinned together because the risk is that a later edit moves
// the lines back up into the shared prefix, where they print on every branch.
test('the manual-push recipe rides the FIXED report only, never a report that says stop', { skip: !isWin }, () => {
    const ident = ['-c', 'user.email=probe@example.com', '-c', 'user.name=probe'];

    const healthy = makeStore();
    try {
        assert.strictEqual(installRepo(healthy.store).status, 0);
        const { branch } = attachRemote(healthy);
        assert.strictEqual(git(healthy.store, ['push', '-q', '-u', 'origin', branch]).status, 0);
        write(path.join(healthy.store, 'memory-types', 'new-note.md'), '# new\n');

        const fixed = doctorSyncFixReports(healthy.store);
        assert.strictEqual(fixed.length, 1, JSON.stringify(fixed));
        assert.strictEqual(fixed[0].Status, 'FIXED', fixed[0].Detail);
        assert.match(fixed[0].Detail, /Destination: /);
        // This half is also the negative assertion's control: it proves both
        // patterns below can match a report at all, so the absence they assert
        // in the leak case is the fix working rather than a pattern that never
        // matched anything.
        assert.match(fixed[0].Detail, /Committed, not pushed/);
        assert.match(fixed[0].Detail, /Manual push: git -C /);
    } finally {
        rmDir(healthy.home);
    }

    const leaking = makeStore();
    try {
        assert.strictEqual(installRepo(leaking.store).status, 0);
        const { branch } = attachRemote(leaking);
        assert.strictEqual(git(leaking.store, ['push', '-q', '-u', 'origin', branch]).status, 0);
        // A non-memory blob in committed history with an index that reads
        // clean. This state is reachable rather than contrived: the -Fix
        // consent gate fires on Dirty and never consults the leak probes, so
        // the commit succeeds, and the re-read the doctor performs after it
        // lands in the leak branch.
        assert.strictEqual(git(leaking.store, ['add', '-f', 'settings.json']).status, 0);
        assert.strictEqual(git(leaking.store, ident.concat(['commit', '-q', '-m', 'leak'])).status, 0);
        assert.strictEqual(git(leaking.store, ['rm', '--cached', '-q', 'settings.json']).status, 0);
        assert.strictEqual(git(leaking.store, ident.concat(['commit', '-q', '-m', 'untrack'])).status, 0);
        write(path.join(leaking.store, 'memory-types', 'new-note.md'), '# new\n');

        const failed = doctorSyncFixReports(leaking.store);
        assert.strictEqual(failed.length, 1, JSON.stringify(failed));
        assert.strictEqual(failed[0].Status, 'FAIL', failed[0].Detail);
        // Pin the branch before asserting what it lacks: without this the two
        // absences below would pass just as well on some other FAIL, and the
        // case would stop covering the report it was written for.
        assert.match(failed[0].Detail, /puts non-memory paths in reach of a push/);
        assert.doesNotMatch(failed[0].Detail, /Manual push: git -C /);
        assert.doesNotMatch(failed[0].Detail, /Committed, not pushed/);
    } finally {
        rmDir(leaking.home);
    }
});

// Give an installed store an origin it can actually push to. A bare repo on
// disk is a real remote for every read this check makes (they are all local
// refs), so the case needs no network and no credentials. It lives under the
// fake home so the existing cleanup reaps it.
function attachRemote(fake) {
    const bare = path.join(fake.home, 'origin.git');
    assert.strictEqual(spawnSync('git', ['init', '--bare', '-q', bare],
        { encoding: 'utf8', env: { ...process.env } }).status, 0);
    assert.strictEqual(git(fake.store, ['remote', 'add', 'origin', bare]).status, 0);
    const head = git(fake.store, ['rev-parse', '--abbrev-ref', 'HEAD']);
    assert.strictEqual(head.status, 0, head.stderr);
    return { bare, branch: head.stdout.trim() };
}

// The destination half of the section. The allowlist proves what the store may
// publish; these cases prove there is somewhere for it to go. Every one of them
// sits on a canonical allowlist with all four leak probes clean, which is the
// point: before this check, each of these states reported PASS.
test('a store that syncs nowhere is reported, however clean its allowlist', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        const { bare, branch } = attachRemote(fake);

        // A remote with no upstream on the branch: push and pull in the
        // close-out have nothing to resolve, so this one blocks.
        const noUpstream = doctorSyncLine(fake.home);
        assert.strictEqual(noUpstream.status, 'FAIL', noUpstream.detail);
        assert.match(noUpstream.detail, /tracks no upstream/);
        assert.match(noUpstream.detail, new RegExp('Branch ' + branch));

        // Wired up properly: one branch on origin, tracked by this machine.
        assert.strictEqual(git(fake.store, ['push', '-q', '-u', 'origin', branch]).status, 0);
        const healthy = doctorSyncLine(fake.home);
        assert.strictEqual(healthy.status, 'PASS', healthy.detail);
        assert.match(healthy.detail, /Destination: /);
        assert.match(healthy.detail, new RegExp(branch + ' tracks origin/' + branch));
        assert.match(healthy.detail, /the only branch on origin/);

        // Another machine pushes its store under a different branch name. Both
        // machines' pushes and pulls keep succeeding and neither ever sees the
        // other, which is the silent failure this check exists for.
        assert.strictEqual(git(fake.store, ['push', '-q', 'origin', branch + ':other-machine']).status, 0);
        assert.strictEqual(git(fake.store, ['fetch', '-q', 'origin']).status, 0);
        const divergent = doctorSyncLine(fake.home);
        assert.strictEqual(divergent.status, 'WARN', divergent.detail);
        assert.match(divergent.detail, /origin also carries origin\/other-machine/);
        assert.match(divergent.detail, /never reaches this store/);
        // refs/remotes/origin/HEAD shortens to the bare remote name, which is
        // not a branch: counting it would report a divergence on every store
        // that has one.
        assert.ok(!/carries origin,|carries origin$/m.test(divergent.detail),
            'the remote-HEAD ref must not be counted as a branch:\n' + divergent.detail);

        // Upstream resolution reads the remote-tracking ref, so losing that ref
        // (a pruned or never-fetched origin) drops the branch back to tracking
        // nothing rather than to a store that merely cannot see the other side.
        // That ordering is why the report can only reach its sole-branch claim
        // with at least one branch actually observed.
        assert.strictEqual(git(fake.store, ['update-ref', '-d', 'refs/remotes/origin/other-machine']).status, 0);
        assert.strictEqual(git(fake.store, ['update-ref', '-d', 'refs/remotes/origin/' + branch]).status, 0);
        const pruned = doctorSyncLine(fake.home);
        assert.strictEqual(pruned.status, 'FAIL', pruned.detail);
        assert.match(pruned.detail, /tracks no upstream/);
        assert.ok(!/only branch on origin/.test(pruned.detail),
            'a sole-branch claim must never be made from zero observations:\n' + pruned.detail);

        // A detached HEAD commits to no branch at all.
        assert.strictEqual(git(fake.store, ['fetch', '-q', 'origin']).status, 0);
        assert.strictEqual(git(fake.store, ['checkout', '-q', '--detach', 'HEAD']).status, 0);
        const detached = doctorSyncLine(fake.home);
        assert.strictEqual(detached.status, 'FAIL', detached.detail);
        assert.match(detached.detail, /HEAD is detached/);

        assert.ok(fs.existsSync(bare));
    } finally {
        rmDir(fake.home);
    }
});

// The name pair the sync runner's push rests on. sync-store.ps1 pushes with a
// bare `git push`, and push.default simple, git's default since 2.0, refuses
// one whose local branch name differs from its upstream's. Every other
// destination read passes in that state: the branch exists, tracks a real
// branch on origin, and origin carries only that branch, so the section reads
// as a healthy destination while the automated push exits nonzero every run.
//
// push.default comes from config, so these cases pin git's global file out of
// the doctor's run: what the machine running the suite happens to set must not
// decide what the check reports.
//
// The pin runs through HOME rather than through GIT_CONFIG_GLOBAL, because
// every git call the doctor's memory-sync section makes goes through
// Invoke-MemorySyncGit, which removes every GIT_* name from the environment
// before it runs git. A
// GIT_CONFIG_GLOBAL handed in here would be gone by then, and the case would
// read the machine's real global config while looking isolated. HOME survives
// that strip, and Git for Windows reads it ahead of both HOMEDRIVE/HOMEPATH
// and USERPROFILE, so pointing it at the fake home (which carries no
// .gitconfig) is an empty global file. The other two names need no redirect,
// since git never consults them while HOME is set. XDG_CONFIG_HOME is the
// other global-scope source git reads, and it is not GIT_-prefixed, so it
// survives the strip and is redirected under the same home.
//
// The system file is not pinned out and cannot be through this funnel, which
// strips GIT_CONFIG_SYSTEM and GIT_CONFIG_NOSYSTEM with the rest: a
// push.default written into the machine's system gitconfig would still reach
// these cases.
function isolatedGitConfig(fake) {
    return { HOME: fake.home, USERPROFILE: fake.home, XDG_CONFIG_HOME: path.join(fake.home, 'xdg') };
}

// A store tracking origin under a branch name that no longer matches its own.
// `git branch -m` carries the branch's tracking config with it, so the
// upstream stays origin/<original>, which is the state a machine lands in when
// one side of the pair is renamed and the other is not.
function mismatchedStore(fake) {
    assert.strictEqual(installRepo(fake.store).status, 0);
    const upstream = attachRemote(fake).branch;
    assert.strictEqual(git(fake.store, ['push', '-q', '-u', 'origin', upstream]).status, 0);
    const local = upstream === 'master' ? 'main' : 'master';
    assert.strictEqual(git(fake.store, ['branch', '-m', upstream, local]).status, 0);
    return { local, upstream };
}

test('push.default simple blocks a branch whose name differs from its upstream, and names the rename', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        const { local, upstream } = mismatchedStore(fake);
        assert.strictEqual(git(fake.store, ['config', 'push.default', 'simple']).status, 0);

        const line = doctorSyncLine(fake.home, isolatedGitConfig(fake));
        assert.strictEqual(line.status, 'FAIL', line.detail);
        assert.match(line.detail, /push\.default simple/);
        assert.match(line.detail, new RegExp('git branch -m ' + local + ' ' + upstream));
    } finally {
        rmDir(fake.home);
    }
});

test('a matching branch name pair is no finding under push.default simple', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        const { branch } = attachRemote(fake);
        assert.strictEqual(git(fake.store, ['push', '-q', '-u', 'origin', branch]).status, 0);
        assert.strictEqual(git(fake.store, ['config', 'push.default', 'simple']).status, 0);

        const line = doctorSyncLine(fake.home, isolatedGitConfig(fake));
        assert.strictEqual(line.status, 'PASS', line.detail);
        assert.ok(!/branch -m/.test(line.detail),
            'a matching pair must not be told to rename anything:\n' + line.detail);
    } finally {
        rmDir(fake.home);
    }
});

test('push.default upstream accepts a differing name pair, so it is no finding', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        mismatchedStore(fake);
        assert.strictEqual(git(fake.store, ['config', 'push.default', 'upstream']).status, 0);

        const line = doctorSyncLine(fake.home, isolatedGitConfig(fake));
        assert.strictEqual(line.status, 'PASS', line.detail);
        assert.ok(!/branch -m/.test(line.detail),
            'a push this configuration accepts must not be reported as blocked:\n' + line.detail);
    } finally {
        rmDir(fake.home);
    }
});

test('push.default tracking is the deprecated alias for upstream and is read as one', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        mismatchedStore(fake);
        assert.strictEqual(git(fake.store, ['config', 'push.default', 'tracking']).status, 0);

        const line = doctorSyncLine(fake.home, isolatedGitConfig(fake));
        assert.strictEqual(line.status, 'PASS', line.detail);
        assert.ok(!/branch -m/.test(line.detail),
            'the alias must reach the same arm as upstream, not the malformed-value one:\n' + line.detail);
    } finally {
        rmDir(fake.home);
    }
});

test('push.default current publishes a differing name pair where nobody reads it, which advises rather than blocks', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        mismatchedStore(fake);
        assert.strictEqual(git(fake.store, ['config', 'push.default', 'current']).status, 0);

        // The push succeeds under this setting and lands on a branch named
        // after the local one, so the memories are published, just not where
        // the other machines pull from. Nothing is dead, so nothing fails.
        const line = doctorSyncLine(fake.home, isolatedGitConfig(fake));
        assert.notStrictEqual(line.status, 'FAIL', line.detail);
        assert.strictEqual(line.status, 'WARN', line.detail);
        assert.match(line.detail, /push\.default current publishes to the branch on origin named after the local branch/);
    } finally {
        rmDir(fake.home);
    }
});

test('an unset push.default is read as simple, so a differing name pair still blocks', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        const { local, upstream } = mismatchedStore(fake);
        assert.notStrictEqual(git(fake.store, ['config', '--local', '--get', 'push.default']).status, 0,
            'this case rests on the value being unset in the store');

        const line = doctorSyncLine(fake.home, isolatedGitConfig(fake));
        assert.strictEqual(line.status, 'FAIL', line.detail);
        assert.match(line.detail, new RegExp('git branch -m ' + local + ' ' + upstream));
    } finally {
        rmDir(fake.home);
    }
});

// A pair whose two names differ only in case. git compares the local branch
// against the raw branch.<name>.merge ref byte for byte, so it refuses this
// push exactly as it refuses `master` against `origin/main`, while a
// case-insensitive comparison calls the pair a match and reports a healthy
// destination for a store whose every automated push exits 128. The rename
// runs through a third name because refs in a Windows checkout are
// case-insensitive and a direct `git branch -m main Main` fails.
function caseMismatchedStore(fake) {
    assert.strictEqual(installRepo(fake.store).status, 0);
    const upstream = attachRemote(fake).branch;
    assert.strictEqual(git(fake.store, ['push', '-q', '-u', 'origin', upstream]).status, 0);
    const local = upstream[0].toUpperCase() + upstream.slice(1);
    assert.notStrictEqual(local, upstream);
    assert.strictEqual(git(fake.store, ['branch', '-m', upstream, 'case-pivot']).status, 0);
    assert.strictEqual(git(fake.store, ['branch', '-m', 'case-pivot', local]).status, 0);
    // The pair still resolves as a tracking pair: this case is about the
    // comparison, not about an upstream that went missing in the rename.
    assert.strictEqual(git(fake.store, ['config', '--get', 'branch.' + local + '.merge']).stdout.trim(),
        'refs/heads/' + upstream);
    return { local, upstream };
}

test('a name pair differing only in case blocks, because git compares the two refs byte for byte', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        const { local, upstream } = caseMismatchedStore(fake);
        assert.strictEqual(git(fake.store, ['config', 'push.default', 'simple']).status, 0);
        // The remote is a bare repo on disk, so this asks git itself, offline,
        // and pins the check against the refusal rather than against a claim
        // about it.
        assert.notStrictEqual(git(fake.store, ['push', '--dry-run']).status, 0,
            'this case rests on git refusing the push');

        const line = doctorSyncLine(fake.home, isolatedGitConfig(fake));
        assert.strictEqual(line.status, 'FAIL', line.detail);
        assert.match(line.detail, /push\.default simple/);
        assert.match(line.detail, new RegExp('git branch -m ' + local + ' ' + upstream));
    } finally {
        rmDir(fake.home);
    }
});

test('push.default matching reports the pair that pushes nothing and still exits successfully', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        const { local, upstream } = mismatchedStore(fake);
        assert.strictEqual(git(fake.store, ['config', 'push.default', 'matching']).status, 0);

        const line = doctorSyncLine(fake.home, isolatedGitConfig(fake));
        assert.strictEqual(line.status, 'FAIL', line.detail);
        // Scoped to the tracked branch on purpose: where origin also carries a
        // branch named after the local one, matching does publish there, and
        // the finding is still correct because the branch this store pulls
        // from stays dead.
        assert.match(line.detail, /exits successfully while publishing nothing to the branch this store pulls from/);
        assert.match(line.detail, new RegExp('git branch -m ' + local + ' ' + upstream));
    } finally {
        rmDir(fake.home);
    }
});

test('push.default nothing blocks even a matched name pair, because no bare push works under it', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        const { branch } = attachRemote(fake);
        assert.strictEqual(git(fake.store, ['push', '-q', '-u', 'origin', branch]).status, 0);
        assert.strictEqual(git(fake.store, ['config', 'push.default', 'nothing']).status, 0);

        const line = doctorSyncLine(fake.home, isolatedGitConfig(fake));
        assert.strictEqual(line.status, 'FAIL', line.detail);
        assert.match(line.detail, /push\.default is set to nothing/);
        assert.ok(!/branch -m/.test(line.detail),
            'the names match, so nothing here is a rename:\n' + line.detail);
    } finally {
        rmDir(fake.home);
    }
});

test('a push.default git does not recognize is never reported as a healthy store', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        const { branch } = attachRemote(fake);
        assert.strictEqual(git(fake.store, ['push', '-q', '-u', 'origin', branch]).status, 0);
        // git parses the value byte-exactly, so `Simple` is malformed and a
        // matched name pair under it is still a store that cannot push.
        assert.strictEqual(git(fake.store, ['config', 'push.default', 'Simple']).status, 0);
        assert.notStrictEqual(git(fake.store, ['push', '--dry-run']).status, 0,
            'this case rests on git rejecting the value');
        // The rejection is not confined to push: every command but `git config
        // --get` dies on the malformed key, so the store's leak probes cannot
        // answer either, and the report says so before it says anything about
        // the destination. That ordering is the point of the assertion below:
        // an unproven security negative outranks a destination finding.
        assert.notStrictEqual(git(fake.store, ['ls-files']).status, 0);

        const line = doctorSyncLine(fake.home, isolatedGitConfig(fake));
        assert.strictEqual(line.status, 'FAIL', line.detail);
        assert.match(line.detail, /the negative is unproven/);
        assert.match(line.detail, /malformed value for push\.default: Simple/);
        assert.ok(!/Destination: /.test(line.detail),
            'a store whose git refuses to run must not read as a healthy destination:\n' + line.detail);
    } finally {
        rmDir(fake.home);
    }
});

test('a branch.<name>.merge carrying the short form of the ref is reported, never read as a match', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        const { branch } = attachRemote(fake);
        assert.strictEqual(git(fake.store, ['push', '-q', '-u', 'origin', branch]).status, 0);
        // git compares refs/heads/<branch> against this value as configured, so
        // the documented short form is a refusal even though the two names are
        // the same. It also stops @{u} resolving, which is what the report
        // names.
        assert.strictEqual(git(fake.store, ['config', 'branch.' + branch + '.merge', branch]).status, 0);
        assert.strictEqual(git(fake.store, ['config', 'push.default', 'simple']).status, 0);
        assert.notStrictEqual(git(fake.store, ['push', '--dry-run']).status, 0,
            'this case rests on git refusing the push');

        const line = doctorSyncLine(fake.home, isolatedGitConfig(fake));
        assert.strictEqual(line.status, 'FAIL', line.detail);
        assert.ok(!/Destination: /.test(line.detail),
            'a push git refuses must not read as a healthy destination:\n' + line.detail);
        assert.ok(!/branch -m/.test(line.detail),
            'a merge ref outside refs/heads/ names no branch to rename to:\n' + line.detail);
    } finally {
        rmDir(fake.home);
    }
});

// The generic remedy on the failing branch of the report tells the operator to
// push HEAD with -u. That repairs a detached HEAD and a branch tracking
// nothing; against a branch whose upstream is already correct it creates a
// second branch on origin and repoints the upstream at it, which is the silent
// divergence the advisory check reports.
test('the push-with-upstream remedy is printed for a missing upstream and withheld from a name pair', { skip: !isWin }, () => {
    const generic = /put HEAD on the sync branch/;
    const mismatched = makeStore();
    try {
        const { local, upstream } = mismatchedStore(mismatched);
        assert.strictEqual(git(mismatched.store, ['config', 'push.default', 'simple']).status, 0);
        const named = doctorSyncLine(mismatched.home, isolatedGitConfig(mismatched));
        assert.strictEqual(named.status, 'FAIL', named.detail);
        assert.match(named.detail, new RegExp('git branch -m ' + local + ' ' + upstream));
        assert.ok(!generic.test(named.detail),
            'a branch with a correct upstream must not be told to push a new one:\n' + named.detail);
    } finally {
        rmDir(mismatched.home);
    }

    const bare = makeStore();
    try {
        assert.strictEqual(installRepo(bare.store).status, 0);
        attachRemote(bare);
        const noUpstream = doctorSyncLine(bare.home, isolatedGitConfig(bare));
        assert.strictEqual(noUpstream.status, 'FAIL', noUpstream.detail);
        assert.match(noUpstream.detail, /tracks no upstream/);
        assert.match(noUpstream.detail, generic);
    } finally {
        rmDir(bare.home);
    }

    // The third state the remedy repairs. An upstream on some other remote
    // leaves origin with no branch to reach, so pushing HEAD to origin with
    // -u is the right repair and the finding carries no remedy of its own.
    const foreign = makeStore();
    try {
        assert.strictEqual(installRepo(foreign.store).status, 0);
        const { branch } = attachRemote(foreign);
        const other = path.join(foreign.home, 'backup.git');
        assert.strictEqual(spawnSync('git', ['init', '--bare', '-q', other],
            { encoding: 'utf8', env: { ...process.env } }).status, 0);
        assert.strictEqual(git(foreign.store, ['remote', 'add', 'backup', other]).status, 0);
        assert.strictEqual(git(foreign.store, ['push', '-q', '-u', 'backup', branch]).status, 0);

        const offOrigin = doctorSyncLine(foreign.home, isolatedGitConfig(foreign));
        assert.strictEqual(offOrigin.status, 'FAIL', offOrigin.detail);
        assert.match(offOrigin.detail, /which is not the origin reported above/);
        assert.match(offOrigin.detail, generic);
    } finally {
        rmDir(foreign.home);
    }
});

test('a branch name carrying a shell metacharacter is reported without a pasteable command', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        const upstream = attachRemote(fake).branch;
        assert.strictEqual(git(fake.store, ['push', '-q', '-u', 'origin', upstream]).status, 0);
        // git permits `;` in a branch name, and the report's sanitizer promises
        // printable ASCII, which is the character set a shell reads its
        // metacharacters from. A remedy composed from this name would run calc
        // out of the operator's paste buffer.
        assert.strictEqual(git(fake.store, ['branch', '-m', upstream, 'sync;calc']).status, 0);
        assert.strictEqual(git(fake.store, ['config', 'push.default', 'simple']).status, 0);

        const line = doctorSyncLine(fake.home, isolatedGitConfig(fake));
        assert.strictEqual(line.status, 'FAIL', line.detail);
        assert.match(line.detail, /push\.default simple/);
        assert.ok(!/branch -m/.test(line.detail),
            'no command may be composed from a name carrying a metacharacter:\n' + line.detail);
        assert.match(line.detail, new RegExp('rename the local branch sync;calc to ' + upstream));
        assert.match(line.detail, /no runnable command is printed here/);
    } finally {
        rmDir(fake.home);
    }
});

test('an option-shaped branch name is reported without a pasteable command', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(installRepo(fake.store).status, 0);
        const upstream = attachRemote(fake).branch;
        assert.strictEqual(git(fake.store, ['push', '-q', '-u', 'origin', upstream]).status, 0);

        // A name git's own porcelain refuses (`git branch -m -- <old> -f` is
        // rejected as an invalid branch name, `--` included), so the state is
        // built through plumbing, which is also how a store reaches it: a
        // hostile origin publishing refs/remotes/origin/-f, or a direct ref
        // write. The name is printable ASCII with no metacharacter in it, so
        // the charset gate alone admits it, and a remedy composed from it
        // reads `git branch -m -f <upstream>`, which git parses as a forced
        // rename that clobbers an existing ref rather than the rename the
        // report advertised.
        assert.strictEqual(git(fake.store, ['update-ref', 'refs/heads/-f', 'HEAD']).status, 0);
        assert.strictEqual(git(fake.store, ['symbolic-ref', 'HEAD', 'refs/heads/-f']).status, 0);
        assert.strictEqual(git(fake.store, ['config', 'branch.-f.remote', 'origin']).status, 0);
        assert.strictEqual(git(fake.store, ['config', 'branch.-f.merge', 'refs/heads/' + upstream]).status, 0);
        assert.strictEqual(git(fake.store, ['config', 'push.default', 'simple']).status, 0);

        const line = doctorSyncLine(fake.home, isolatedGitConfig(fake));
        assert.strictEqual(line.status, 'FAIL', line.detail);
        assert.match(line.detail, /push\.default simple/);
        assert.ok(!/branch -m/.test(line.detail),
            'no command may be composed from a name git would read as an option:\n' + line.detail);
        assert.match(line.detail, /no runnable command is printed here/);
    } finally {
        rmDir(fake.home);
    }
});

test('the store is initialized only behind a consent gate that declines on a redirected stdin', { skip: !isWin }, () => {
    // The doctor itself is never run with -Fix here: its execution-policy and
    // user-PATH repairs are gated on -Fix alone and reach user-scope machine
    // state a USERPROFILE redirect does not cover. The gate is exercised
    // instead by parsing Get-Consent out of doctor.ps1 and calling it, and the
    // wiring by proving the sync install has no other way in.
    const script = '$errs = $null; $tokens = $null; '
        + '$ast = [System.Management.Automation.Language.Parser]::ParseFile(' + q(DOCTOR)
        + ', [ref]$tokens, [ref]$errs); '
        + '$fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq "Get-Consent" }, $true); '
        + 'if ($null -eq $fn) { Write-Output "no Get-Consent in doctor.ps1"; exit 1 }; '
        + '$Fix = $true; $Yes = $false; '
        + 'Invoke-Expression $fn.Extent.Text; '
        + 'if (Get-Consent "Initialize the store?") { Write-Output "consented"; exit 1 }; '
        + 'Write-Output "declined"';
    const res = spawnSync('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { encoding: 'utf8', input: '', env: { ...process.env } });
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /declined/);

    const doctorSrc = fs.readFileSync(DOCTOR, 'utf8').split(/\r?\n/);
    const callsAt = doctorSrc.map((l, i) => (/Install-MemorySyncRepo\s+-StoreRoot/.test(l) ? i : -1)).filter((i) => i >= 0);
    assert.strictEqual(callsAt.length, 1, 'the installer has exactly one call site in the doctor');
    const gate = doctorSrc.slice(Math.max(0, callsAt[0] - 3), callsAt[0]).join('\n');
    assert.match(gate, /if \(Get-Consent /, 'the installer runs only inside a consent gate:\n' + gate);

    // The consent prompt is offered only where the repair can run. A foreign
    // managed file is refused by the installer, so a prompt in that state
    // would ask the operator to authorize a repair that cannot happen. This
    // is checked in source because the prompt itself only appears under -Fix.
    const adoptable = doctorSrc.filter((l) => /\$syncAdoptable\s*=/.test(l));
    assert.strictEqual(adoptable.length, 1, 'the doctor decides adoptability in one place');
    assert.match(adoptable[0], /\$syncForeign\.Count -eq 0/, adoptable[0]);
});

test('install-memory-sync.ps1 parses cleanly', { skip: !isWin }, () => {
    const script = '$errs = $null; $tokens = $null; '
        + '[System.Management.Automation.Language.Parser]::ParseFile(' + q(INSTALLER)
        + ', [ref]$tokens, [ref]$errs) | Out-Null; '
        + 'if ($errs.Count -gt 0) { $errs | Write-Output; exit 1 }';
    const res = pwsh(script);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
});

// The silent sync runner, doctor/sync-store.ps1. The SessionStart hook spawns
// it detached whenever the store is pending; these cases run it directly, in
// the foreground, against sandbox store roots. Its whole contract is: exit 0
// always, print nothing ever, mutate nothing unless the doctor's full safety
// bar holds (re-derived per run through Get-MemorySyncStatus), commit through
// Install-MemorySyncRepo's own gated path, pull --rebase then push only where
// an upstream is configured, and record every outcome to
// <store>/kit-sync-state.json as fixed enum codes.

const SYNC = path.join(PLUGIN_ROOT, 'doctor', 'sync-store.ps1');

function runSync(store) {
    return spawnSync('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SYNC, '-StoreRoot', store],
        { encoding: 'utf8', env: { ...process.env } });
}

// Exit 0 with both streams empty: the runner is spawned detached with its
// streams ignored, so anything it printed would reach nobody, and the state
// file is its whole report.
function assertSilentSync(res) {
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.strictEqual(res.stdout, '', 'the sync runner never writes stdout');
    assert.strictEqual(res.stderr, '', 'the sync runner never writes stderr');
}

function statePath(store) {
    return path.join(store, 'kit-sync-state.json');
}

function readState(store) {
    return JSON.parse(fs.readFileSync(statePath(store), 'utf8'));
}

function headOf(store) {
    const res = git(store, ['rev-parse', 'HEAD']);
    assert.strictEqual(res.status, 0, res.stderr);
    return res.stdout.trim();
}

// A fake store initialized as the doctor's own canonical sync repo, with a
// local commit identity so no case leans on the machine's global git config.
// The ownership key is set before Install-MemorySyncRepo runs so the repo
// takes the recognized-own path rather than the fresh-init one, which is the
// only way to get the identity config in before the first commit.
function makeOwnStore(options) {
    const fake = makeStore(options);
    assert.strictEqual(git(fake.store, ['init', '--quiet', '-b', 'main']).status, 0);
    assert.strictEqual(git(fake.store, ['config', '--local', 'user.email', 'sync-test@example.com']).status, 0);
    assert.strictEqual(git(fake.store, ['config', '--local', 'user.name', 'sync-test']).status, 0);
    assert.strictEqual(git(fake.store, ['config', '--local', 'claudekit.memorysync', 'true']).status, 0);
    const res = installRepo(fake.store);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    return fake;
}

// A bare repo under the fake home as origin, with the store's main pushed and
// tracking it: a real remote for every git operation here, no network needed.
// The bare side's HEAD is set to main at init, so a clone of it checks out
// the pushed branch rather than an unborn machine-default one.
function attachBareOrigin(fake) {
    const bare = path.join(fake.home, 'origin.git');
    assert.strictEqual(spawnSync('git', ['init', '--bare', '--quiet', '-b', 'main', bare],
        { encoding: 'utf8', env: { ...process.env } }).status, 0);
    assert.strictEqual(git(fake.store, ['remote', 'add', 'origin', bare]).status, 0);
    assert.strictEqual(git(fake.store, ['push', '--quiet', '-u', 'origin', 'main']).status, 0);
    return bare;
}

// A working clone of the bare origin, standing in for another machine's
// store, with its own local commit identity.
function cloneOf(fake, bare) {
    const clone = path.join(fake.home, 'other-machine');
    assert.strictEqual(spawnSync('git', ['clone', '--quiet', bare, clone],
        { encoding: 'utf8', env: { ...process.env } }).status, 0);
    assert.strictEqual(git(clone, ['config', '--local', 'user.email', 'other@example.com']).status, 0);
    assert.strictEqual(git(clone, ['config', '--local', 'user.name', 'other']).status, 0);
    return clone;
}

test('sync-store: a dirty canonical store with no remote commits locally, prints nothing, and records ok', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        const head = headOf(fake.store);
        write(path.join(fake.store, 'memory-types', 'pending-fact.md'), '# pending\n');

        assertSilentSync(runSync(fake.store));

        assert.notStrictEqual(headOf(fake.store), head, 'the pending change was committed');
        assert.ok(trackedPaths(fake.store).includes('memory-types/pending-fact.md'));
        const state = readState(fake.store);
        assert.strictEqual(state.lastResult, 'ok');
        assert.strictEqual(state.reason, '');
        assert.notStrictEqual(state.lastOk, '', 'success stamps lastOk');
        assert.strictEqual(state.firstFailSince, '', 'success clears the failure streak');
        assert.ok(!fs.existsSync(path.join(fake.store, 'kit-sync.lock')), 'the lock is removed on exit');
    } finally {
        rmDir(fake.home);
    }
});

test('sync-store: an ahead store pushes to its configured upstream, verified on the bare side', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        const bare = attachBareOrigin(fake);
        write(path.join(fake.store, 'memory-types', 'local-fact.md'), '# local\n');
        assert.strictEqual(git(fake.store, ['add', 'memory-types/local-fact.md']).status, 0);
        assert.strictEqual(git(fake.store, ['commit', '--quiet', '-m', 'local work']).status, 0);
        const head = headOf(fake.store);

        assertSilentSync(runSync(fake.store));

        const bareHead = spawnSync('git', ['-C', bare, 'rev-parse', 'main'],
            { encoding: 'utf8', env: { ...process.env } });
        assert.strictEqual(bareHead.status, 0, bareHead.stderr);
        assert.strictEqual(bareHead.stdout.trim(), head, 'the push landed on the bare origin');
        assert.strictEqual(readState(fake.store).lastResult, 'ok');
    } finally {
        rmDir(fake.home);
    }
});

// The pull-unreachability pin: nothing else in the system ever fetches, so
// the runner's own fetch is what discovers a remote that moved on. The
// fixture deliberately leaves the tracking ref stale (no manual fetch): a
// runner that reads behind from the stale ref sees zero, merges nothing, and
// its push is rejected non-fast-forward forever, which is the live-store
// failure this case reproduces.
test('sync-store: a behind store discovers the remote advance with its own fetch and converges', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        const bare = attachBareOrigin(fake);
        const clone = cloneOf(fake, bare);
        write(path.join(clone, 'memory-types', 'from-other-machine.md'), '# other\n');
        assert.strictEqual(git(clone, ['add', 'memory-types/from-other-machine.md']).status, 0);
        assert.strictEqual(git(clone, ['commit', '--quiet', '-m', 'other machine work']).status, 0);
        assert.strictEqual(git(clone, ['push', '--quiet', 'origin', 'main']).status, 0);
        const bareHead = spawnSync('git', ['-C', bare, 'rev-parse', 'main'],
            { encoding: 'utf8', env: { ...process.env } });
        assert.strictEqual(bareHead.status, 0, bareHead.stderr);
        const advanced = bareHead.stdout.trim();
        const staleRef = git(fake.store, ['rev-parse', 'refs/remotes/origin/main']);
        assert.strictEqual(staleRef.status, 0, staleRef.stderr);
        assert.notStrictEqual(staleRef.stdout.trim(), advanced,
            'the tracking ref is stale before the run; a converging runner proves it fetched');

        assertSilentSync(runSync(fake.store));

        assert.strictEqual(headOf(fake.store), advanced, 'both sides converge');
        assert.ok(fs.existsSync(path.join(fake.store, 'memory-types', 'from-other-machine.md')),
            'the other machine\'s memory landed in the worktree');
        assert.strictEqual(readState(fake.store).lastResult, 'ok');
    } finally {
        rmDir(fake.home);
    }
});

// The inbound half of the allowlist. The store root is ~/.claude, where
// settings.json, CLAUDE.md, and the kit's own hooks live gitignored, so a
// fetched commit naming one of those paths would clobber live configuration
// the moment a merge checks it out. Incoming content must pass the same
// positive path rule outbound content does, before the working tree is
// touched.
test('sync-store: an incoming disallowed path gates as inbound-leak, with no merge and no push', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        const bare = attachBareOrigin(fake);
        const clone = cloneOf(fake, bare);
        write(path.join(clone, 'settings.json'), '{"model":"attacker"}\n');
        assert.strictEqual(git(clone, ['add', '-f', 'settings.json']).status, 0);
        assert.strictEqual(git(clone, ['commit', '--quiet', '-m', 'planted config']).status, 0);
        assert.strictEqual(git(clone, ['push', '--quiet', 'origin', 'main']).status, 0);
        const head = headOf(fake.store);

        assertSilentSync(runSync(fake.store));

        const state = readState(fake.store);
        assert.strictEqual(state.lastResult, 'gate');
        assert.strictEqual(state.reason, 'inbound-leak');
        assert.strictEqual(headOf(fake.store), head, 'nothing was merged');
        assert.strictEqual(fs.readFileSync(path.join(fake.store, 'settings.json'), 'utf8'),
            '{"model":"opus"}\n', 'the live settings file is untouched');
        assert.ok(!fs.existsSync(path.join(fake.store, '.git', 'rebase-merge')));
        assert.ok(!fs.existsSync(path.join(fake.store, '.git', 'rebase-apply')));
        const porcelain = git(fake.store, ['status', '--porcelain']);
        assert.strictEqual(porcelain.stdout.trim(), '', 'the working tree is untouched');
        // The fetched tracking ref is left in place on a refusal: deleting it
        // would make the store read converged and silently stop syncing while
        // the recorded gate line vanished. It stays so the gate is visible and
        // the next run re-screens the same disallowed tip.
        assert.strictEqual(git(fake.store, ['rev-parse', '--verify', 'refs/remotes/origin/main']).status, 0,
            'the fetched tracking ref is left in place so the gate stays visible');
    } finally {
        rmDir(fake.home);
    }
});

// The rename/duplicate-blob bypass a blob-OBJECT screen misses: an incoming
// commit that places a blob HEAD already has at a disallowed path introduces
// no new blob object, so `rev-list --objects --filter=object:type=blob` emits
// nothing for it and an object screen waves it through; the path screen
// (ls-tree over the incoming tree) names the destination and refuses it. The
// exploit this pins: `git mv` an allowlisted memory file onto settings.json on
// another machine, whose next sync would otherwise rebase attacker content
// over the live, hook-defining settings.json in the store root.
test('sync-store: an incoming rename onto a disallowed path gates as inbound-leak, though it introduces no new blob', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        const bare = attachBareOrigin(fake);
        // Seed an allowlisted file, committed and pushed, so its blob exists in
        // HEAD and on the origin: the rename below then carries a blob already
        // known here, which is exactly what an object screen cannot see.
        write(path.join(fake.store, 'memory-types', 'seed.md'), '# a known blob\n');
        assert.strictEqual(git(fake.store, ['add', 'memory-types/seed.md']).status, 0);
        assert.strictEqual(git(fake.store, ['commit', '--quiet', '-m', 'seed a known blob']).status, 0);
        assert.strictEqual(git(fake.store, ['push', '--quiet', 'origin', 'main']).status, 0);
        const head = headOf(fake.store);

        // Another machine renames that same blob onto settings.json: a new path
        // for a known blob, no new blob object introduced.
        const clone = cloneOf(fake, bare);
        assert.strictEqual(git(clone, ['mv', 'memory-types/seed.md', 'settings.json']).status, 0);
        assert.strictEqual(git(clone, ['commit', '--quiet', '-m', 'rename a known blob onto config']).status, 0);
        assert.strictEqual(git(clone, ['push', '--quiet', 'origin', 'main']).status, 0);

        assertSilentSync(runSync(fake.store));

        const state = readState(fake.store);
        assert.strictEqual(state.lastResult, 'gate');
        assert.strictEqual(state.reason, 'inbound-leak',
            'the path screen caught a disallowed destination an object screen would have missed');
        assert.strictEqual(headOf(fake.store), head, 'nothing was merged');
        assert.strictEqual(fs.readFileSync(path.join(fake.store, 'settings.json'), 'utf8'),
            '{"model":"opus"}\n', 'the live, gitignored settings file was never clobbered');
        assert.ok(!fs.existsSync(path.join(fake.store, '.git', 'rebase-merge')));
        assert.ok(!fs.existsSync(path.join(fake.store, '.git', 'rebase-apply')));
        assert.strictEqual(git(fake.store, ['status', '--porcelain']).stdout.trim(), '',
            'the working tree is untouched');
    } finally {
        rmDir(fake.home);
    }
});

// A tree entry has two security-relevant axes, mode and path, and the screen
// must check both: a symlink (mode 120000) at an allowlisted memory PATH would
// be materialized by the rebase, and a later kit read through it would emit a
// credential file's contents into the session's trusted context. The entry is
// planted via plumbing (update-index --cacheinfo) so the test needs no OS
// symlink support: the blob's content is the link target.
test('sync-store: an incoming symlink at an allowed path gates as inbound-leak', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        const bare = attachBareOrigin(fake);
        const head = headOf(fake.store);
        const clone = cloneOf(fake, bare);
        const target = '../../../../.credentials.json';
        const hashed = spawnSync('git', ['-C', clone, 'hash-object', '-w', '--stdin'],
            { input: target, encoding: 'utf8', env: { ...process.env } });
        assert.strictEqual(hashed.status, 0, hashed.stderr);
        const sha = hashed.stdout.trim();
        assert.strictEqual(git(clone, ['update-index', '--add', '--cacheinfo',
            '120000,' + sha + ',memory-types/link.md']).status, 0);
        assert.strictEqual(git(clone, ['commit', '--quiet', '-m', 'plant a symlink at an allowed path']).status, 0);
        assert.strictEqual(git(clone, ['push', '--quiet', 'origin', 'main']).status, 0);

        assertSilentSync(runSync(fake.store));

        const state = readState(fake.store);
        assert.strictEqual(state.lastResult, 'gate');
        assert.strictEqual(state.reason, 'inbound-leak', 'a symlink at an allowed path is a leak, not admitted');
        assert.strictEqual(headOf(fake.store), head, 'nothing was merged');
        assert.ok(!fs.existsSync(path.join(fake.store, '.git', 'rebase-merge')));
        assert.strictEqual(git(fake.store, ['rev-parse', '--verify', 'refs/remotes/origin/main']).status, 0,
            'the fetched tracking ref is left in place so the recorded gate stays visible');
    } finally {
        rmDir(fake.home);
    }
});

// The same screen over the coordinator tier, the allowlist's second admitted
// root. The mode check runs before the path check and reads no path at all, so
// this holds by construction rather than by a rule of its own; what the case
// pins is that the tier gained no exemption when the allowlist widened, since
// a coordinator path is one a seat writes directly and a symlink planted there
// would be materialized by the rebase exactly as one at a memory path is.
test('sync-store: an incoming symlink at an allowed coordinator path gates as inbound-leak', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        const bare = attachBareOrigin(fake);
        const head = headOf(fake.store);
        const clone = cloneOf(fake, bare);
        const target = '../../../../.credentials.json';
        const hashed = spawnSync('git', ['-C', clone, 'hash-object', '-w', '--stdin'],
            { input: target, encoding: 'utf8', env: { ...process.env } });
        assert.strictEqual(hashed.status, 0, hashed.stderr);
        const sha = hashed.stdout.trim();
        assert.strictEqual(git(clone, ['update-index', '--add', '--cacheinfo',
            '120000,' + sha + ',coordinator/' + MACHINE + '/board.md']).status, 0);
        assert.strictEqual(git(clone, ['commit', '--quiet', '-m', 'plant a symlink at a coordinator path']).status, 0);
        assert.strictEqual(git(clone, ['push', '--quiet', 'origin', 'main']).status, 0);

        assertSilentSync(runSync(fake.store));

        const state = readState(fake.store);
        assert.strictEqual(state.lastResult, 'gate');
        assert.strictEqual(state.reason, 'inbound-leak', 'a symlink at a coordinator path is a leak, not admitted');
        assert.strictEqual(headOf(fake.store), head, 'nothing was merged');
        assert.ok(!fs.existsSync(path.join(fake.store, '.git', 'rebase-merge')));
    } finally {
        rmDir(fake.home);
    }
});

// The machine axis, the sync channel's second rule over the coordinator tier.
// The allowlist says which paths may cross; this says whose. The tier is one
// directory per machine under a single-writer contract, so this store stages
// its own directory alone and refuses an upstream commit that writes into it.
//
// Every case below sits on a fixture holding both halves: this box's own
// coordinator directory, named from the running hostname exactly as the
// PowerShell side reads it, and a second machine's directory tracked beside it
// and never modified here, which is the state a synced store holds for each of
// its peers. That second directory is what an axis read over the whole index
// (`git ls-files`) rather than over the staged paths would call foreign on
// every run, wedging the commit on a store that did nothing wrong.

// Another machine's coordinator directory, tracked in the store and committed
// outside the installer's gated path, which is how it arrives in the real
// store: replicated in by a rebase, never staged here. It is left unmodified
// by every case that does not name it.
function plantForeignCoordinator(fake) {
    const rel = 'coordinator/' + FOREIGN_MACHINE + '/';
    write(path.join(fake.store, 'coordinator', FOREIGN_MACHINE, 'board.md'), '# the other machine\'s board\n');
    write(path.join(fake.store, 'coordinator', FOREIGN_MACHINE, 'registry', 'session-z.md'), '# the other machine\'s session\n');
    assert.strictEqual(git(fake.store, ['add', rel + 'board.md', rel + 'registry/session-z.md']).status, 0);
    assert.strictEqual(git(fake.store, ['commit', '--quiet', '-m', 'a peer machine\'s coordinator directory']).status, 0);
    return [rel + 'board.md', rel + 'registry/session-z.md'];
}

test('a staged change under another machine\'s coordinator directory refuses the commit and restores the index', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        const foreignPaths = plantForeignCoordinator(fake);
        const head = headOf(fake.store);
        const foreignBoard = path.join(fake.store, 'coordinator', FOREIGN_MACHINE, 'board.md');
        write(foreignBoard, '# a write this machine has no business making\n');
        // A change under this machine's own directory in the same run, so the
        // refusal is proven to be about the foreign path rather than about any
        // coordinator write at all.
        write(path.join(fake.store, 'coordinator', MACHINE, 'board.md'), '# this machine\'s own board, updated\n');

        const result = installRepoResult(fake.store);

        assert.strictEqual(result.Ok, false, 'the commit is refused');
        assert.strictEqual(result.Reason, 'outbound-foreign-write',
            'the refusal carries its own code, not the generic commit failure');
        const notes = result.Notes.join('\n');
        assert.match(notes, /foreign coordinator directory/, 'the notes say what was refused');
        assert.ok(notes.includes(FOREIGN_MACHINE), 'and name the machine segment the staged path carries');
        assert.ok(notes.includes('coordinator/' + FOREIGN_MACHINE + '/board.md'), 'and the path itself');
        assert.strictEqual(headOf(fake.store), head, 'nothing was committed');
        const stagedAfter = git(fake.store, ['diff', '--cached', '--name-only']);
        assert.strictEqual(stagedAfter.status, 0, stagedAfter.stderr);
        assert.strictEqual(stagedAfter.stdout.trim(), '',
            'the index was returned to the tree it held before the add');
        // The peer directory stays tracked, and its unmodified file is neither
        // untracked nor counted as an offender: the axis reads the staged
        // paths, so a tracked, unmodified peer file is invisible to it.
        const tracked = trackedPaths(fake.store);
        for (const rel of foreignPaths) {
            assert.ok(tracked.includes(rel), rel + ' is still tracked after the refusal');
        }
        assert.ok(!notes.includes('session-z.md'),
            'the peer directory\'s unmodified file is not among the offenders');
        assert.strictEqual(fs.readFileSync(foreignBoard, 'utf8'),
            '# a write this machine has no business making\n',
            'no file on disk was touched by the refusal');
    } finally {
        rmDir(fake.home);
    }
});

test('a change under this machine\'s own coordinator directory commits, beside a tracked peer directory', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        const foreignPaths = plantForeignCoordinator(fake);
        const head = headOf(fake.store);
        write(path.join(fake.store, 'coordinator', MACHINE, 'board.md'), '# this machine\'s own board, updated\n');

        const result = installRepoResult(fake.store);

        assert.strictEqual(result.Ok, true, result.Notes.join('\n'));
        assert.strictEqual(result.Reason, '', 'a clean commit carries no reason code');
        assert.notStrictEqual(headOf(fake.store), head, 'the own-directory change was committed');
        const committed = git(fake.store, ['show', '--name-only', '--format=', 'HEAD']);
        assert.strictEqual(committed.status, 0, committed.stderr);
        assert.strictEqual(committed.stdout.trim(), 'coordinator/' + MACHINE + '/board.md',
            'exactly the own-directory path rode the commit');
        const tracked = trackedPaths(fake.store);
        for (const rel of foreignPaths) {
            assert.ok(tracked.includes(rel), rel + ' is still tracked and untouched');
        }
    } finally {
        rmDir(fake.home);
    }
});

// The tier root, which no machine owns. A .md sitting directly under
// coordinator/ carries no machine segment, so it is outside the machine axis
// and the allowlist alone decides it, exactly as before this axis existed. The
// axis must not reach it: the outbound refusal restores the whole index and
// refuses the whole commit, so treating an unowned path as foreign would stop
// this store syncing anything at all until somebody found and removed the file.
test('a staged file at the coordinator tier root carries no machine segment, so it commits', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        plantForeignCoordinator(fake);
        const head = headOf(fake.store);
        write(path.join(fake.store, 'coordinator', 'tier-note.md'), '# a file no machine directory holds\n');

        const result = installRepoResult(fake.store);

        assert.strictEqual(result.Ok, true, result.Notes.join('\n'));
        assert.strictEqual(result.Reason, '', 'a path with no machine segment is not a foreign write');
        assert.notStrictEqual(headOf(fake.store), head, 'the commit was made');
        const committed = git(fake.store, ['show', '--name-only', '--format=', 'HEAD']);
        assert.strictEqual(committed.status, 0, committed.stderr);
        assert.strictEqual(committed.stdout.trim(), 'coordinator/tier-note.md',
            'and it carries the tier-root file');
        // The rule that admitted it, named rather than inferred from the
        // commit: the allowlist's own predicate, which is the only rule left
        // once the machine axis does not reach the path.
        assert.deepStrictEqual(predicateAnswers(['coordinator/tier-note.md']), [true],
            'the allowlist predicate is what admits it');
    } finally {
        rmDir(fake.home);
    }
});

// A staged deletion is a write: removing another machine's board is exactly
// the loss the single-writer contract exists to prevent, and a staged list
// filtered to paths that still exist on disk would wave it through.
test('a staged deletion under another machine\'s coordinator directory refuses the commit', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        const foreignPaths = plantForeignCoordinator(fake);
        const head = headOf(fake.store);
        fs.unlinkSync(path.join(fake.store, 'coordinator', FOREIGN_MACHINE, 'board.md'));

        const result = installRepoResult(fake.store);

        assert.strictEqual(result.Ok, false, 'a deletion of a peer\'s file is refused like any other write');
        assert.strictEqual(result.Reason, 'outbound-foreign-write');
        assert.strictEqual(headOf(fake.store), head, 'nothing was committed');
        assert.ok(trackedPaths(fake.store).includes(foreignPaths[0]),
            'the deleted path is still tracked: the index went back to what it held');
    } finally {
        rmDir(fake.home);
    }
});

// A move is the shape a staged-path read loses. Git pairs a deletion with a
// similar-content addition into one rename entry, and --name-only renders that
// entry as its destination alone, so a peer's board moved into this machine's
// own directory would read as a single own path while the commit carried the
// peer's file away. The read asks for the two halves so the deletion is there
// to refuse.
test('a staged move of a peer\'s coordinator file into this machine\'s directory is refused as the deletion it is', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        const foreignPaths = plantForeignCoordinator(fake);
        const head = headOf(fake.store);
        fs.renameSync(path.join(fake.store, 'coordinator', FOREIGN_MACHINE, 'board.md'),
            path.join(fake.store, 'coordinator', MACHINE, 'board-from-the-peer.md'));

        const result = installRepoResult(fake.store);

        assert.strictEqual(result.Ok, false, 'the move deletes the peer\'s file, so the commit is refused');
        assert.strictEqual(result.Reason, 'outbound-foreign-write');
        const notes = result.Notes.join('\n');
        assert.ok(notes.includes('coordinator/' + FOREIGN_MACHINE + '/board.md'),
            'the deleted source path is named, not only the destination a rename entry carries');
        assert.strictEqual(headOf(fake.store), head, 'nothing was committed');
        assert.ok(trackedPaths(fake.store).includes(foreignPaths[0]),
            'the peer\'s file is still tracked: the index went back to what it held');
        // The fixture is genuinely rename-shaped, named rather than assumed:
        // staging the same move and reading it back with git's own detection on
        // returns the destination by itself, which is the reading the refusal
        // above has to see past. diff.renames is set on this invocation rather
        // than left to the box, so what the control proves is a property of the
        // fixture and not of the machine's git config.
        assert.strictEqual(git(fake.store, ['add', '-A']).status, 0);
        const detected = git(fake.store, ['-c', 'diff.renames=true', 'diff', '--cached', '--name-only']);
        assert.strictEqual(detected.status, 0, detected.stderr);
        assert.deepStrictEqual(detected.stdout.split(/\r?\n/).filter((l) => l.trim() !== ''),
            ['coordinator/' + MACHINE + '/board-from-the-peer.md'],
            'git pairs the two halves into one entry and names the destination alone');
    } finally {
        rmDir(fake.home);
    }
});

// The two refusals the machine axis reaches before it can classify anything:
// a staged path the check cannot decode, and a machine name that reads blank.
// Neither is about a foreign write, and both land after the add, so both owe
// the index the same restore every other post-add refusal makes. A refusal
// that returned early would leave the add's staging behind in a repository the
// operator may be about to give a remote.
test('a staged path the check cannot read refuses the commit and restores the index', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        // A path holding a tab, which git quotes whatever core.quotePath says.
        // It is planted through the index, committed, then dropped from the
        // index alone: HEAD carries it and the index does not, so the two
        // whole-index gates read a clean list and the staged diff against HEAD
        // is where the undecodable path surfaces. core.protectNTFS=false is
        // what lets the plumbing write such a path on this filesystem at all.
        const odd = 'coordinator/' + MACHINE + '/we\tird.md';
        const blob = git(fake.store, ['hash-object', '-w', 'coordinator/' + MACHINE + '/board.md']);
        assert.strictEqual(blob.status, 0, blob.stderr);
        assert.strictEqual(git(fake.store, ['-c', 'core.protectNTFS=false', 'update-index', '--add',
            '--cacheinfo', '100644,' + blob.stdout.trim() + ',' + odd]).status, 0);
        assert.strictEqual(git(fake.store, ['commit', '--quiet', '-m', 'a path this check cannot read']).status, 0);
        assert.strictEqual(git(fake.store, ['-c', 'core.protectNTFS=false', 'update-index', '--force-remove', odd]).status, 0);
        const head = headOf(fake.store);
        // Something for the add to stage, so the restore has work to undo.
        write(path.join(fake.store, 'coordinator', MACHINE, 'board.md'), '# this machine\'s own board, updated\n');

        const result = installRepoResult(fake.store);

        assert.strictEqual(result.Ok, false, 'a staged path this check cannot classify refuses the commit');
        // The path git could not render is the token the note is identified by:
        // the prose around it is curated operator text under no identity
        // contract, and the note's job is to hand the operator the path.
        const quoted = '"coordinator/' + MACHINE + '/we\\tird.md"';
        const at = result.Notes.findIndex((n) => n.includes(quoted));
        assert.notStrictEqual(at, -1,
            'the note carries the undecodable staged path as git rendered it: ' + JSON.stringify(result.Notes));
        // And the restore note is the element after it rather than text merged
        // into it, which is the shape a comma-bound concatenation destroys.
        assert.strictEqual(at, result.Notes.length - 2,
            'the refusal and the restore that follows it are two notes, not one');
        assert.strictEqual(headOf(fake.store), head, 'nothing was committed');
        const stagedAfter = git(fake.store, ['-c', 'core.quotePath=false', 'diff', '--cached', '--name-only']);
        assert.strictEqual(stagedAfter.status, 0, stagedAfter.stderr);
        const stagedPaths = stagedAfter.stdout.split(/\r?\n/).filter((l) => l.trim() !== '');
        assert.strictEqual(stagedPaths.length, 1,
            'the index holds only what it held before the add, which is the dropped path');
        assert.ok(!stagedPaths.join(',').includes('board.md'),
            'the board change the add staged is out of the index again');
    } finally {
        rmDir(fake.home);
    }
});

test('a machine name that reads blank refuses the commit and restores the index', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        const head = headOf(fake.store);
        write(path.join(fake.store, 'coordinator', MACHINE, 'board.md'), '# this machine\'s own board, updated\n');
        // The one reading of the machine name, shadowed for this call: nothing
        // in a fixture can make a real hostname read blank, and the refusal it
        // guards is the one that fires on a box where it does.
        const script = '. ' + q(INSTALLER) + '; '
            + 'function Get-MemorySyncMachineName { return "" }; '
            + '$r = Install-MemorySyncRepo -StoreRoot ' + q(fake.store) + '; '
            + '@{ Ok = [bool]$r.Ok; Notes = @($r.Notes) } | ConvertTo-Json -Compress -Depth 4 | Write-Output';
        const res = pwsh(script);
        assert.strictEqual(res.status, 0, res.stdout + res.stderr);
        const result = JSON.parse(res.stdout);

        assert.strictEqual(result.Ok, false, 'no machine name means no staged coordinator path can be classified');
        // This refusal carries no reason code and names no path, so it has no
        // token to pin: what is asserted is the shape, two notes where the
        // second is the restore, and the index state they describe. A count is
        // the whole guard here, since a concatenation left unparenthesized in
        // the notes literal would merge the pair into one element.
        assert.strictEqual(result.Notes.length, 2,
            'the refusal and the restore reach the caller as two notes: ' + JSON.stringify(result.Notes));
        assert.strictEqual(headOf(fake.store), head, 'nothing was committed');
        assert.strictEqual(git(fake.store, ['diff', '--cached', '--name-only']).stdout.trim(), '',
            'nothing the add staged is left in the index');
    } finally {
        rmDir(fake.home);
    }
});

// One property every post-add refusal's notes share, and the one easiest to
// lose: they reach the caller as separate elements. PowerShell binds the comma
// in an array literal tighter than the + that builds an element, so a
// concatenated element left unparenthesized takes the elements after it as its
// right operand and the whole literal collapses to one string. That reads
// almost right in a joined dump, and the doctor's -Fix failure branch then
// sanitizes each note to 200 characters, which cuts the merged string and drops
// the restore sentence off its tail: the operator is told the read failed and
// never told the index was put back.
//
// This is the one refusal whose git call no fixture state can make fail (git
// answers `diff --cached` on any repository that has an index), so the failure
// is planted by shadowing Invoke-MemorySyncGit for that one argument list and
// passing everything else through to the real function.
test('a failed staged-path read reports the failure and the restore as two notes', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        const head = headOf(fake.store);
        write(path.join(fake.store, 'coordinator', MACHINE, 'board.md'), '# this machine\'s own board, updated\n');
        // A token of this test's own making, so the note carrying git's output
        // is identified by data rather than by the sentence wrapped around it.
        const planted = 'kit-test-staged-read-refused';
        const script = '. ' + q(INSTALLER) + '; '
            + '$script:RealGit = ${function:Invoke-MemorySyncGit}; '
            + 'function Invoke-MemorySyncGit { param([Parameter(Mandatory = $true)][string]$StoreRoot, '
            + '[Parameter(Mandatory = $true)][string[]]$Arguments, [string]$GitExe = "git") '
            + 'if ($Arguments -contains "--cached") { return @{ Code = 1; Output = @("fatal: ' + planted + '") } } '
            + 'return & $script:RealGit -StoreRoot $StoreRoot -Arguments $Arguments -GitExe $GitExe }; '
            + '$r = Install-MemorySyncRepo -StoreRoot ' + q(fake.store) + '; '
            + '@{ Ok = [bool]$r.Ok; Notes = @($r.Notes) } | ConvertTo-Json -Compress -Depth 4 | Write-Output';
        const res = pwsh(script);
        assert.strictEqual(res.status, 0, res.stdout + res.stderr);
        const result = JSON.parse(res.stdout);

        assert.strictEqual(result.Ok, false, 'a staged read that failed leaves the commit unmade');
        const at = result.Notes.findIndex((n) => n.includes(planted));
        assert.notStrictEqual(at, -1,
            'the note carries git\'s own output for the read that failed: ' + JSON.stringify(result.Notes));
        assert.strictEqual(at, result.Notes.length - 2,
            'exactly one note follows it, the restore, rather than being merged into it: '
            + JSON.stringify(result.Notes));
        assert.strictEqual(headOf(fake.store), head, 'nothing was committed');
        assert.strictEqual(git(fake.store, ['diff', '--cached', '--name-only']).stdout.trim(), '',
            'and the restore the second note describes really ran: the index is back to what it held');
    } finally {
        rmDir(fake.home);
    }
});

// The saved tree that restore reads back is written by `git write-tree`, whose
// output arrives through Invoke-MemorySyncGit with stdout and stderr merged:
// git noise is the first line and the tree id is the last. The two tests below
// drive the refusal that returns through the restore closure (a staged foreign
// coordinator write) with the write-tree call alone shadowed, everything else
// passed through to the real function, and count the read-tree calls the run
// makes, which is the only reading that says whether a restore was attempted
// at all.
function installRepoUnderShadowedWriteTree(store, writeTreeBody) {
    const script = '. ' + q(INSTALLER) + '; '
        + '$script:RealGit = ${function:Invoke-MemorySyncGit}; $script:ReadTrees = 0; '
        + 'function Invoke-MemorySyncGit { param([Parameter(Mandatory = $true)][string]$StoreRoot, '
        + '[Parameter(Mandatory = $true)][string[]]$Arguments, [string]$GitExe = "git") '
        + 'if ($Arguments -contains "read-tree") { $script:ReadTrees = $script:ReadTrees + 1 } '
        + 'if ($Arguments -contains "write-tree") { ' + writeTreeBody + ' } '
        + 'return & $script:RealGit -StoreRoot $StoreRoot -Arguments $Arguments -GitExe $GitExe }; '
        + '$r = Install-MemorySyncRepo -StoreRoot ' + q(store) + '; '
        + '@{ Ok = [bool]$r.Ok; Reason = [string]$r.Reason; Notes = @($r.Notes); '
        + 'ReadTrees = [int]$script:ReadTrees } | ConvertTo-Json -Compress -Depth 4 | Write-Output';
    const res = pwsh(script);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    return JSON.parse(res.stdout);
}

// A warning ahead of a real tree id is the shape a merged stream produces on
// any box whose git has something to say (a stale index extension, an
// autocrlf notice), and it must not cost the store its restore: the id is
// still there, on the last line.
test('a write-tree whose output opens with a warning still restores the index', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        plantForeignCoordinator(fake);
        const head = headOf(fake.store);
        write(path.join(fake.store, 'coordinator', FOREIGN_MACHINE, 'board.md'),
            '# a write this machine has no business making\n');

        const result = installRepoUnderShadowedWriteTree(fake.store,
            '$real = & $script:RealGit -StoreRoot $StoreRoot -Arguments $Arguments -GitExe $GitExe; '
            + 'return @{ Code = $real.Code; Output = @("warning: kit-test-write-tree-noise") + $real.Output }');

        assert.strictEqual(result.Ok, false, 'the foreign staged path is still refused');
        assert.strictEqual(result.Reason, 'outbound-foreign-write');
        assert.strictEqual(result.ReadTrees, 1, 'the restore was attempted: ' + JSON.stringify(result.Notes));
        // The token the failing branch appends is git's own command name, not
        // the sentence around it, so a rewording of either restore sentence
        // leaves this reading alone.
        assert.ok(!result.Notes.join('\n').includes('git read-tree:'),
            'and it succeeded, so no note carries read-tree\'s failure: ' + JSON.stringify(result.Notes));
        assert.strictEqual(git(fake.store, ['diff', '--cached', '--name-only']).stdout.trim(), '',
            'the index really went back to the tree it held before the add');
        assert.strictEqual(headOf(fake.store), head, 'nothing was committed');
    } finally {
        rmDir(fake.home);
    }
});

// And where no line of that output is an object id at all, there is no tree to
// go back to. The refusal stands, the staging stays where the report says it
// stays, and nothing that is not an object id reaches read-tree as an
// argument.
test('a write-tree carrying no object id attempts no read-tree and leaves the staging it reports', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        plantForeignCoordinator(fake);
        const head = headOf(fake.store);
        write(path.join(fake.store, 'coordinator', FOREIGN_MACHINE, 'board.md'),
            '# a write this machine has no business making\n');

        const result = installRepoUnderShadowedWriteTree(fake.store,
            'return @{ Code = 0; Output = @("warning: kit-test-write-tree-noise", "not-an-object-id") }');

        assert.strictEqual(result.Ok, false, 'the foreign staged path is still refused');
        assert.strictEqual(result.Reason, 'outbound-foreign-write');
        assert.strictEqual(result.ReadTrees, 0,
            'no restore was attempted, so no unvalidated value reached read-tree: '
            + JSON.stringify(result.Notes));
        assert.ok(!result.Notes.join('\n').includes('git read-tree:'),
            'and no note quotes a read-tree failure: ' + JSON.stringify(result.Notes));
        // What the notes say the index holds is what it holds: the staging the
        // add made is still there, unreverted, which is the honest half of the
        // fail-closed reading.
        assert.strictEqual(git(fake.store, ['diff', '--cached', '--name-only']).stdout.trim(),
            'coordinator/' + FOREIGN_MACHINE + '/board.md',
            'the staging the refusal could not take back is still in the index');
        assert.strictEqual(headOf(fake.store), head, 'nothing was committed');
    } finally {
        rmDir(fake.home);
    }
});

// The runner's own record of that refusal. Every other installer refusal is a
// transient the next run may clear; this one is a standing condition, so it is
// recorded as a gate under its own code, which is what makes the session-start
// line name the direction instead of reading as a failed commit.
test('sync-store: a staged foreign coordinator write gates as outbound-foreign-write, not commit-failed', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        plantForeignCoordinator(fake);
        const head = headOf(fake.store);
        write(path.join(fake.store, 'coordinator', FOREIGN_MACHINE, 'board.md'), '# a write from the wrong machine\n');

        assertSilentSync(runSync(fake.store));

        const state = readState(fake.store);
        assert.strictEqual(state.lastResult, 'gate');
        assert.strictEqual(state.reason, 'outbound-foreign-write');
        assert.strictEqual(headOf(fake.store), head, 'a gate mutates nothing: no commit');
    } finally {
        rmDir(fake.home);
    }
});

// The inbound half. The allowlist screen reads the whole incoming tree, which
// holds every machine's coordinator directory on every sync, so it cannot see
// that a commit rewrites THIS machine's board; only the difference between the
// merge base and the incoming commit says that. A cold successor seat resumes
// the whole machine from that board, so the intake stands down rather than
// rebasing a write this machine never made.
test('sync-store: an upstream commit writing this machine\'s own coordinator directory gates as inbound-foreign-write', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        plantForeignCoordinator(fake);
        const bare = attachBareOrigin(fake);
        const clone = cloneOf(fake, bare);
        write(path.join(clone, 'coordinator', MACHINE, 'board.md'), '# a board rewritten by another machine\n');
        assert.strictEqual(git(clone, ['add', '-A']).status, 0);
        assert.strictEqual(git(clone, ['commit', '--quiet', '-m', 'rewrite this machine\'s board']).status, 0);
        assert.strictEqual(git(clone, ['push', '--quiet', 'origin', 'main']).status, 0);
        const head = headOf(fake.store);

        assertSilentSync(runSync(fake.store));

        const state = readState(fake.store);
        assert.strictEqual(state.lastResult, 'gate');
        assert.strictEqual(state.reason, 'inbound-foreign-write');
        assert.strictEqual(headOf(fake.store), head, 'the tree is left at the pre-sync commit');
        assert.strictEqual(fs.readFileSync(path.join(fake.store, 'coordinator', MACHINE, 'board.md'), 'utf8'),
            '# board\n', 'this machine\'s own board is untouched');
        assert.ok(!fs.existsSync(path.join(fake.store, '.git', 'rebase-merge')));
        assert.ok(!fs.existsSync(path.join(fake.store, '.git', 'rebase-apply')));
        assert.strictEqual(git(fake.store, ['status', '--porcelain']).stdout.trim(), '',
            'the working tree is untouched');
        // Left fetched, exactly as the leak refusal leaves it: the doctor reads
        // that tip to name the commit and the paths, and deleting it would make
        // the store read converged while the gate vanished.
        assert.strictEqual(git(fake.store, ['rev-parse', '--verify', 'refs/remotes/origin/main']).status, 0,
            'the fetched tip is left in place');
    } finally {
        rmDir(fake.home);
    }
});

// The same rename shape inbound, where what a missed source path costs is this
// machine's board itself: an upstream commit moving coordinator/<this machine>
// /board.md anywhere else deletes the board, and a rename entry names only
// where it went, so the refusal turns on reading the move as its two halves.
test('sync-store: an upstream commit that moves this machine\'s board out gates as inbound-foreign-write', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        plantForeignCoordinator(fake);
        const bare = attachBareOrigin(fake);
        const clone = cloneOf(fake, bare);
        assert.strictEqual(git(clone, ['mv', 'coordinator/' + MACHINE + '/board.md',
            'coordinator/' + FOREIGN_MACHINE + '/board-taken-from-its-owner.md']).status, 0);
        assert.strictEqual(git(clone, ['commit', '--quiet', '-m', 'move this machine\'s board into another directory']).status, 0);
        assert.strictEqual(git(clone, ['push', '--quiet', 'origin', 'main']).status, 0);
        const head = headOf(fake.store);

        assertSilentSync(runSync(fake.store));

        const state = readState(fake.store);
        assert.strictEqual(state.lastResult, 'gate');
        assert.strictEqual(state.reason, 'inbound-foreign-write');
        assert.strictEqual(headOf(fake.store), head, 'the tree is left at the pre-sync commit');
        assert.ok(fs.existsSync(path.join(fake.store, 'coordinator', MACHINE, 'board.md')),
            'this machine\'s board is still on disk, which is what the rebase would have removed');
        // The move is rename-shaped to git, named rather than assumed: the same
        // diff read with detection on returns the destination alone, and this
        // machine's own path appears nowhere in it. diff.renames is set on this
        // invocation rather than left to the box, so what the control proves is
        // a property of the fixture and not of the machine's git config.
        const detected = git(fake.store, ['-c', 'diff.renames=true', 'diff', '--name-only', '--diff-filter=ACDMRT', head, 'refs/remotes/origin/main']);
        assert.strictEqual(detected.status, 0, detected.stderr);
        assert.deepStrictEqual(detected.stdout.split(/\r?\n/).filter((l) => l.trim() !== ''),
            ['coordinator/' + FOREIGN_MACHINE + '/board-taken-from-its-owner.md'],
            'git pairs the two halves into one entry and names the destination alone');
    } finally {
        rmDir(fake.home);
    }
});

test('sync-store: an upstream commit writing another machine\'s coordinator directory rebases as before', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        plantForeignCoordinator(fake);
        const bare = attachBareOrigin(fake);
        const clone = cloneOf(fake, bare);
        write(path.join(clone, 'coordinator', FOREIGN_MACHINE, 'board.md'), '# the peer machine\'s own board, updated\n');
        assert.strictEqual(git(clone, ['add', '-A']).status, 0);
        assert.strictEqual(git(clone, ['commit', '--quiet', '-m', 'the peer machine writes its own board']).status, 0);
        assert.strictEqual(git(clone, ['push', '--quiet', 'origin', 'main']).status, 0);
        const advanced = git(clone, ['rev-parse', 'HEAD']).stdout.trim();

        assertSilentSync(runSync(fake.store));

        assert.strictEqual(readState(fake.store).lastResult, 'ok',
            'a peer writing its own directory is ordinary replication');
        assert.strictEqual(headOf(fake.store), advanced, 'both sides converge');
        // Read through a line-ending normalization: the rebase checks the file
        // out, so a machine whose git converts on checkout writes CRLF, which
        // says nothing about whether the peer's content landed.
        assert.strictEqual(fs.readFileSync(
            path.join(fake.store, 'coordinator', FOREIGN_MACHINE, 'board.md'), 'utf8').replace(/\r\n/g, '\n'),
            '# the peer machine\'s own board, updated\n', 'the peer\'s write landed');
    } finally {
        rmDir(fake.home);
    }
});

// Ordering, pinned: the claims directory is machine-local mutual-exclusion
// state the allowlist refuses outright, and that whole-tree screen runs before
// the machine axis, so an incoming claim under this machine's own directory is
// an inbound-leak and never an inbound-foreign-write. The case above is the
// discriminator: the same directory, a non-claims path, does reach the machine
// axis, so a leak reason here names the allowlist screen as the refuser rather
// than the axis arriving first.
test('sync-store: an incoming claim under this machine\'s own directory is refused by the allowlist screen first', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        const bare = attachBareOrigin(fake);
        const clone = cloneOf(fake, bare);
        write(path.join(clone, 'coordinator', MACHINE, 'claims', 'heavy-process.md'), '# a claim from elsewhere\n');
        assert.strictEqual(git(clone, ['add', '-f',
            'coordinator/' + MACHINE + '/claims/heavy-process.md']).status, 0);
        assert.strictEqual(git(clone, ['commit', '--quiet', '-m', 'plant a claim']).status, 0);
        assert.strictEqual(git(clone, ['push', '--quiet', 'origin', 'main']).status, 0);
        const head = headOf(fake.store);

        assertSilentSync(runSync(fake.store));

        const state = readState(fake.store);
        assert.strictEqual(state.lastResult, 'gate');
        assert.strictEqual(state.reason, 'inbound-leak',
            'the allowlist screen refuses a claims path before the machine axis reads the diff');
        assert.strictEqual(headOf(fake.store), head, 'nothing was merged');
    } finally {
        rmDir(fake.home);
    }
});

// The shared read both the runner and the doctor use, driven directly: the
// runner refuses on it and the doctor names the paths from it, so a divergence
// between the two would be a refusal the report cannot explain. The unproven
// answer is the case neither caller can produce on a healthy store and both
// must handle: a merge base that does not exist is not a clean read.
test('the inbound machine-axis read names own-directory paths only, and is unproven without a merge base', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        plantForeignCoordinator(fake);
        const base = headOf(fake.store);
        write(path.join(fake.store, 'coordinator', MACHINE, 'board.md'), '# rewritten\n');
        write(path.join(fake.store, 'coordinator', FOREIGN_MACHINE, 'board.md'), '# peer rewritten\n');
        write(path.join(fake.store, 'memory-types', 'tag-registry.md'), '# tags, rewritten\n');
        assert.strictEqual(git(fake.store, ['add', '-A']).status, 0);
        assert.strictEqual(git(fake.store, ['commit', '--quiet', '-m', 'three writes']).status, 0);
        const tip = headOf(fake.store);
        assert.strictEqual(git(fake.store, ['reset', '--quiet', '--hard', base]).status, 0);

        const read = (ref) => {
            const script = '. ' + q(INSTALLER) + '; '
                + '$r = Get-MemorySyncInboundForeignPaths -StoreRoot ' + q(fake.store)
                + ' -Ref ' + q(ref) + ' -Machine ' + q(MACHINE) + '; '
                + '@{ Ok = [bool]$r.Ok; Paths = @($r.Paths) } | ConvertTo-Json -Compress -Depth 4 | Write-Output';
            const res = pwsh(script);
            assert.strictEqual(res.status, 0, res.stdout + res.stderr);
            return JSON.parse(res.stdout);
        };

        const answer = read(tip);
        assert.strictEqual(answer.Ok, true);
        assert.deepStrictEqual(answer.Paths, ['coordinator/' + MACHINE + '/board.md'],
            'the peer\'s directory and the memory tier are another machine\'s business and this store\'s own, in that order');

        // An orphan commit shares no history with HEAD, so `git merge-base`
        // exits nonzero and there is no diff to read. That is unproven, which
        // the runner retries silently, never a clean pass.
        assert.strictEqual(git(fake.store, ['checkout', '--quiet', '--orphan', 'unrelated']).status, 0);
        write(path.join(fake.store, 'memory-types', 'tag-registry.md'), '# an unrelated history\n');
        assert.strictEqual(git(fake.store, ['add', 'memory-types/tag-registry.md']).status, 0);
        assert.strictEqual(git(fake.store, ['commit', '--quiet', '-m', 'unrelated']).status, 0);
        const orphan = headOf(fake.store);
        assert.strictEqual(git(fake.store, ['checkout', '--quiet', 'main']).status, 0);

        const unproven = read(orphan);
        assert.strictEqual(unproven.Ok, false, 'no merge base is unproven, not an empty clean answer');
        assert.deepStrictEqual(unproven.Paths, []);
    } finally {
        rmDir(fake.home);
    }
});

// The two runtimes' machine spellings, pinned against each other. Every
// machine-axis case above assumes os.hostname() and Get-MemorySyncMachineName
// read the same string; this is the one case that checks that assumption
// rather than building on it, so a platform where the two readings diverge
// fails here instead of quietly syncing every one of its own files as
// foreign.
// The condition is the platform and nothing else. The doctor's installer runs
// on Windows alone, so off Windows there is no reading to compare rather than
// a host that might be installed elsewhere; this reads process.platform and
// never probes for a binary.
const OFF_WINDOWS_REASON = isWin ? false
    : 'the doctor\'s installer is Windows-only, so off Windows there is no PowerShell reading of Get-MemorySyncMachineName to compare against';

// Every fixture in this file builds a real directory from MACHINE, and the
// machine axis compares that same segment, so a hostname that does not name one
// directory would be exercising something other than the axis. The property
// checked is exactly that, a non-empty name that traverses nowhere, rather than
// a character class: the axis compares with -ieq and the filesystem stores the
// name whatever alphabet it is written in, so a non-ASCII hostname works and a
// class-shaped assertion would red a healthy box for no defect. The value is
// steerable rather than fixed: on Windows, setting `_CLUSTER_NETWORK_NAME_`
// changes what both runtimes report here, which is a property of the platform
// call each of them makes rather than of either runtime reading that variable
// itself. Gated with the siblings: off Windows
// every case it guards is skipped, and an ungated check there would be the only
// one running, reporting on the host rather than on the kit. Its skip carries
// its own reason rather than the parity test's, since this case takes no
// PowerShell reading and so is not skipped for want of one.
const OFF_WINDOWS_GUARD_REASON = isWin ? false
    : 'the machine axis and every fixture this guard protects run on Windows alone, so off Windows this would report on the host rather than on the kit';

test('this machine\'s name names one directory rather than a traversal',
    { skip: OFF_WINDOWS_GUARD_REASON }, () => {
        assert.ok(MACHINE.length > 0,
            'os.hostname() returned an empty string, so every coordinator path this file builds collapses a segment');
        assert.ok(!/[\\/:]/.test(MACHINE),
            'os.hostname() returned ' + JSON.stringify(MACHINE) + ', which carries a separator or a drive colon, '
            + 'so it spans more than the single machine segment the axis compares');
        assert.notStrictEqual(MACHINE, '.',
            'a hostname of "." would resolve to the coordinator tier root rather than to a machine directory');
        assert.notStrictEqual(MACHINE, '..',
            'a hostname of ".." would resolve to the store root above the coordinator tier, escaping the tier the axis governs');
    });

test('the PowerShell and Node readings of this machine\'s name agree byte-exact',
    { skip: OFF_WINDOWS_REASON }, () => {
        // The reading travels through a temp file rather than stdout, the same
        // route test/doctor-encoding.test.js takes. Windows PowerShell 5.1
        // writes a redirected stdout in the OEM code page while this harness
        // decodes UTF-8, so a non-ASCII hostname would differ here through the
        // pipe rather than through any disagreement between the two runtimes.
        // Setting [Console]::OutputEncoding is the tempting fix and is worse:
        // it changes the console's own code page, which outlives this process
        // and every later one attached to that console, and it can throw where
        // no console is attached. UTF8Encoding($false) writes no BOM, so the
        // comparison below stays byte-exact rather than passing on a preamble
        // a trim would have hidden.
        // mkdtempSync rather than a composed name in the shared temp root:
        // WriteAllText follows an existing file or link instead of creating
        // exclusively, so a predictable name is one a same-box actor can win.
        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-sync-machine-'));
        try {
            const outFile = path.join(outDir, 'machine.txt');
            const script = '. ' + q(INSTALLER) + '; '
                + '[System.IO.File]::WriteAllText(' + q(outFile) + ', (Get-MemorySyncMachineName), '
                + '(New-Object System.Text.UTF8Encoding($false)))';
            const res = pwsh(script);
            assert.strictEqual(res.status, 0, res.stdout + res.stderr);
            // Checked before the read so a run that exited 0 without writing
            // reports what PowerShell said, rather than dying on a bare ENOENT
            // that discards the only diagnostic there is.
            assert.ok(fs.existsSync(outFile),
                'the reading was never written despite a zero exit: ' + res.stdout + res.stderr);
            const reading = fs.readFileSync(outFile, 'utf8');
            assert.ok(reading.length > 0,
                'Get-MemorySyncMachineName wrote nothing, which is a dead reading rather than a disagreement between the two runtimes');
            assert.strictEqual(reading, MACHINE,
                'Get-MemorySyncMachineName and os.hostname() must read the same string, since the machine axis '
                + 'compares one runtime\'s reading against the other\'s directory name');
        } finally {
            try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* best effort */ }
        }
    });

// Every letter of the machine name with its case flipped. NTFS folds case, so
// this string names the same directory on disk as MACHINE while failing an
// ordinary string comparison against it: a write to the variant spelling lands
// in this machine's own directory, which is why the axis compares the machine
// segment case-insensitively rather than byte-exact. A hostname with no cased
// ASCII letter has no distinct variant, and the two cases below skip rather
// than compare a string to itself.
function flipAsciiCase(name) {
    let flipped = '';
    for (const ch of name) {
        if (ch >= 'a' && ch <= 'z') { flipped += ch.toUpperCase(); }
        else if (ch >= 'A' && ch <= 'Z') { flipped += ch.toLowerCase(); }
        else { flipped += ch; }
    }
    return flipped;
}
const CASE_VARIANT = flipAsciiCase(MACHINE);
const NO_CASE_VARIANT_REASON = (CASE_VARIANT === MACHINE)
    ? 'the running hostname (' + MACHINE + ') carries no cased ASCII letter, so no case variant of it exists to plant'
    : false;

// The case-variant path is committed straight into HEAD through the index,
// via update-index and a plain commit, and never written to the working
// tree: this box's filesystem folds case, so a real file at this spelling
// would land inside the coordinator/<MACHINE>/ directory the fixture already
// tracks on disk, corrupting both. Left unwritten, git reads the tracked path
// as a deletion once it is committed, which is itself a staged write the
// machine axis has to classify, exactly as a peer's deleted file is
// elsewhere in this file.
function plantCaseVariantCoordinatorPath(store, rel, content) {
    const hashed = spawnSync('git', ['-C', store, 'hash-object', '-w', '--stdin'],
        { input: content, encoding: 'utf8', env: { ...process.env } });
    assert.strictEqual(hashed.status, 0, hashed.stderr);
    const sha = hashed.stdout.trim();
    assert.strictEqual(git(store, ['update-index', '--add', '--cacheinfo', '100644,' + sha + ',' + rel]).status, 0);
    // Control: the index holds exactly the variant path this call planted,
    // under no other spelling, before anything else runs over it.
    // core.quotePath=false because this read C-quotes a non-ASCII path exactly
    // as ls-files does, and --no-renames because the default collapses a
    // rename into its destination alone, which would hide a second staged path
    // from a control whose whole assertion is that there is only one.
    const staged = git(store, ['-c', 'core.quotePath=false', 'diff', '--cached', '--no-renames', '--name-only']);
    assert.strictEqual(staged.status, 0, staged.stderr);
    assert.strictEqual(staged.stdout.trim(), rel,
        'the planted path is staged exactly as given, and nothing else is staged alongside it');
    assert.strictEqual(git(store, ['commit', '--quiet', '-m', 'plant a case-variant coordinator path through the index']).status, 0);
    assert.ok(!fs.existsSync(path.join(store, rel)), 'the variant path was never realized on disk');
}

// Only a deletion is reachable here, and the title says so rather than
// implying the axis was exercised over an addition too: a case-folding
// filesystem cannot hold the variant spelling beside the real directory, so
// the only construction that survives the installer's own add is a path
// committed through the index with no file on disk, which git then stages as a
// deletion. A staged deletion is a write the axis classifies, and nothing in
// the installer filters the staged list to paths that still exist.
test('a staged deletion under a case variant of this machine\'s own directory is staged as its own outbound',
    { skip: OFF_WINDOWS_REASON || NO_CASE_VARIANT_REASON }, () => {
        assert.notStrictEqual(CASE_VARIANT, MACHINE, 'control: the variant differs from the machine name');
        assert.strictEqual(CASE_VARIANT.toLowerCase(), MACHINE.toLowerCase(),
            'control: the variant differs from the machine name only by case');

        const fake = makeOwnStore({ coordinator: true });
        try {
            const foreignPaths = plantForeignCoordinator(fake);
            const variantPath = 'coordinator/' + CASE_VARIANT + '/case-variant.md';
            plantCaseVariantCoordinatorPath(fake.store, variantPath, '# a case variant of this machine\'s own directory\n');
            assert.strictEqual(git(fake.store, ['status', '--porcelain']).stdout.trim(), 'D ' + variantPath,
                'the missing variant file reads as an unstaged deletion before the installer runs');
            const head = headOf(fake.store);

            const result = installRepoResult(fake.store);

            assert.strictEqual(result.Ok, true, result.Notes.join('\n'));
            assert.strictEqual(result.Reason, '',
                'the run carries no refusal code, where a machine segment read as foreign would carry outbound-foreign-write');
            assert.notStrictEqual(headOf(fake.store), head, 'the deletion under the variant path was committed');
            // The spelling the axis actually read. Without this, a commit that
            // somehow carried the real directory's path would satisfy every
            // assertion around it, and the case fold would go unexercised.
            const committed = git(fake.store, ['-c', 'core.quotePath=false', 'show', '--no-renames', '--name-only', '--format=', 'HEAD']);
            assert.strictEqual(committed.status, 0, committed.stderr);
            assert.strictEqual(committed.stdout.trim(), variantPath,
                'exactly the case-variant path rode the commit, under the variant spelling rather than the real directory\'s');
            assert.ok(!trackedPaths(fake.store).includes(variantPath),
                'the variant path is no longer tracked, since its deletion committed');
            // The peer directory is untouched throughout: the axis reached the
            // case variant and not the genuinely foreign directory beside it.
            for (const rel of foreignPaths) {
                assert.ok(trackedPaths(fake.store).includes(rel), rel + ' is still tracked and untouched');
            }
        } finally {
            rmDir(fake.home);
        }
    });

test('an upstream commit under a case variant of this machine\'s own directory gates as inbound-foreign-write',
    { skip: OFF_WINDOWS_REASON || NO_CASE_VARIANT_REASON }, () => {
        assert.notStrictEqual(CASE_VARIANT, MACHINE, 'control: the variant differs from the machine name');
        assert.strictEqual(CASE_VARIANT.toLowerCase(), MACHINE.toLowerCase(),
            'control: the variant differs from the machine name only by case');

        const fake = makeOwnStore({ coordinator: true });
        try {
            const foreignPaths = plantForeignCoordinator(fake);
            const bare = attachBareOrigin(fake);
            const clone = cloneOf(fake, bare);
            const variantPath = 'coordinator/' + CASE_VARIANT + '/case-variant.md';
            plantCaseVariantCoordinatorPath(clone, variantPath,
                '# an upstream write under a case variant of this machine\'s directory\n');
            assert.strictEqual(git(clone, ['push', '--quiet', 'origin', 'main']).status, 0);
            const head = headOf(fake.store);

            assertSilentSync(runSync(fake.store));

            const state = readState(fake.store);
            assert.strictEqual(state.lastResult, 'gate');
            assert.strictEqual(state.reason, 'inbound-foreign-write',
                'a case variant of this machine\'s own directory refuses inbound as a write to it, rather than '
                + 'being read as some other machine\'s file');
            assert.strictEqual(headOf(fake.store), head, 'the tree is left at the pre-sync commit');
            // No rebase is left in progress. This says nothing about whether
            // one ran, since the runner aborts a conflicted rebase and an abort
            // removes both directories too (sync-store.ps1, the rebase failure
            // branch); what carries the refused-before-the-rebase claim is the
            // reason code asserted above, which a conflict would have recorded
            // as pull-conflict instead.
            assert.ok(!fs.existsSync(path.join(fake.store, '.git', 'rebase-merge')),
                'no rebase is left in progress, so the repository is not parked mid-operation');
            assert.ok(!fs.existsSync(path.join(fake.store, '.git', 'rebase-apply')),
                'no rebase is left in progress under the apply backend either');
            // fs.existsSync on this filesystem answers a case-variant path the
            // same as the real one, so what proves the gate stopped before
            // checkout is that the real directory carries no new file: the
            // rebase this refusal never runs is the only step that could have
            // written case-variant.md, under either spelling.
            assert.ok(!fs.existsSync(path.join(fake.store, 'coordinator', MACHINE, 'case-variant.md')),
                'no file from the refused commit reached this machine\'s real directory on disk');
            assert.strictEqual(git(fake.store, ['status', '--porcelain']).stdout.trim(), '',
                'the working tree is untouched');
            assert.strictEqual(git(fake.store, ['rev-parse', '--verify', 'refs/remotes/origin/main']).status, 0,
                'the fetched tip is left in place');
            for (const rel of foreignPaths) {
                assert.ok(trackedPaths(fake.store).includes(rel), rel + ' is still tracked and untouched');
            }
        } finally {
            rmDir(fake.home);
        }
    });

// The doctor's half of the same finding. The runner's only output channel is
// the state file, which carries the reason code alone, so the operator who has
// to repair the remote learns which commit and which paths from the doctor's
// report over the tip the refusal left fetched. The function is lifted out of
// doctor.ps1 by the PowerShell parser and run as written, the technique
// doctorFixGate uses, because a real -Fix run touches user-scope machine state
// and a check run cannot be pointed at a sandbox store from here.
test('the doctor names the offending paths and the commit for a fetched write into this machine\'s own directory', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        const bare = attachBareOrigin(fake);
        const clone = cloneOf(fake, bare);
        write(path.join(clone, 'coordinator', MACHINE, 'board.md'), '# a board rewritten by another machine\n');
        assert.strictEqual(git(clone, ['add', '-A']).status, 0);
        assert.strictEqual(git(clone, ['commit', '--quiet', '-m', 'rewrite this machine\'s board']).status, 0);
        assert.strictEqual(git(clone, ['push', '--quiet', 'origin', 'main']).status, 0);
        const pushed = git(clone, ['rev-parse', 'HEAD']).stdout.trim();
        // The state the runner's refusal leaves behind: the tip fetched, HEAD
        // where it was.
        assert.strictEqual(git(fake.store, ['fetch', '--quiet']).status, 0);

        const script = '. ' + q(INSTALLER) + '; $errs = $null; $tokens = $null; '
            + '$ast = [System.Management.Automation.Language.Parser]::ParseFile(' + q(DOCTOR)
            + ', [ref]$tokens, [ref]$errs); '
            + '$fns = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] '
            + "-and ($n.Name -eq 'Get-SanitizedLine' -or $n.Name -eq 'Get-MemorySyncInboundOwnLines') }, $true)); "
            + 'if ($fns.Count -ne 2) { Write-Output ("expected 2 functions, found " + $fns.Count); exit 1 }; '
            + 'foreach ($f in $fns) { Invoke-Expression $f.Extent.Text }; '
            + '$s = Get-MemorySyncStatus -StoreRoot ' + q(fake.store) + '; '
            + 'Get-MemorySyncInboundOwnLines $s | Write-Output';
        const res = pwsh(script);
        assert.strictEqual(res.status, 0, res.stdout + res.stderr);
        const lines = res.stdout.trim();

        // Every token asserted here is data the store itself carries: the sha,
        // the path, the upstream the commit arrived on, and how many paths it
        // writes. The prose around them is curated operator text under no
        // identity contract, so pinning its wording would red on any rewrite of
        // the remedy it states.
        //
        // They are asserted on one line rather than across the block, which is
        // what keeps the case about this block: the fixture attaches origin/main
        // as the upstream, so a report naming it anywhere would satisfy a
        // whole-block match, while the line carrying the sha, the count and the
        // path together is this finding's own shape.
        // Every line carrying the sha is a candidate, and the one asserted on is
        // the one carrying this finding's whole shape. Taking the first match
        // instead binds to any earlier line that happens to quote the same sha
        // (an installer note quoting git, an unproven note) and then fails
        // against the wrong subject.
        const carrying = lines.split(/\r?\n/).filter((l) => l.includes(pushed));
        assert.ok(carrying.length > 0, 'the report names the fetched commit the operator has to repair: ' + lines);
        const named = carrying.find((l) => l.includes('coordinator/' + MACHINE + '/board.md')) || carrying[0];
        assert.ok(named.includes('coordinator/' + MACHINE + '/board.md'), 'and the path it writes: ' + named);
        assert.ok(named.includes('origin/main'), 'and the upstream that commit came in on: ' + named);
        assert.match(named, /\b1 path\(s\)/, 'and how many of this machine\'s paths it writes: ' + named);
    } finally {
        rmDir(fake.home);
    }
});

// The same function over a store whose upstream writes nothing into this
// machine's directory: the healthy case, which must add no line at all, since
// every peer machine's coordinator directory rides every sync and a report
// naming those would fire on every synced store forever.
test('the doctor adds no inbound line for an upstream that writes another machine\'s directory', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        plantForeignCoordinator(fake);
        const bare = attachBareOrigin(fake);
        const clone = cloneOf(fake, bare);
        write(path.join(clone, 'coordinator', FOREIGN_MACHINE, 'board.md'), '# the peer machine\'s own board, updated\n');
        assert.strictEqual(git(clone, ['add', '-A']).status, 0);
        assert.strictEqual(git(clone, ['commit', '--quiet', '-m', 'the peer writes its own board']).status, 0);
        assert.strictEqual(git(clone, ['push', '--quiet', 'origin', 'main']).status, 0);
        assert.strictEqual(git(fake.store, ['fetch', '--quiet']).status, 0);

        const script = '. ' + q(INSTALLER) + '; $errs = $null; $tokens = $null; '
            + '$ast = [System.Management.Automation.Language.Parser]::ParseFile(' + q(DOCTOR)
            + ', [ref]$tokens, [ref]$errs); '
            + '$fns = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] '
            + "-and ($n.Name -eq 'Get-SanitizedLine' -or $n.Name -eq 'Get-MemorySyncInboundOwnLines') }, $true)); "
            + 'foreach ($f in $fns) { Invoke-Expression $f.Extent.Text }; '
            + '$s = Get-MemorySyncStatus -StoreRoot ' + q(fake.store) + '; '
            + 'Get-MemorySyncInboundOwnLines $s | Write-Output';
        const res = pwsh(script);
        assert.strictEqual(res.status, 0, res.stdout + res.stderr);
        assert.strictEqual(res.stdout.trim(), '', 'a peer writing its own directory is no finding here');
    } finally {
        rmDir(fake.home);
    }
});

// A machine name that reads blank stops both directions of the sync: the
// installer refuses every commit and the runner refuses every intake, and the
// runner records that as a failed commit one run and an unproven read the next,
// neither of which names the cause. The doctor is the only surface that can
// name it, and naming it is not enough on its own. This section prints its
// detail under a summary line the operator reads as the verdict, and the
// reports at its healthy end go on to hand over a push recipe, so the finding
// has to move the verdict rather than ride beneath one that says the store is
// fine.
//
// The section is driven whole rather than one function at a time, because the
// verdict is the assertion. The control is the same fixture with the box's real
// hostname, which passes: it is what makes the FAIL below the shadow's doing
// rather than some other unhappiness in the fixture, and it witnesses the
// Destination line, the first of the three absence assertions, by matching it
// positively. It witnesses neither of the other two, since the control is a
// PASS that commits nothing and those two lines belong to the FIXED report.
// Their live witness is the manual-push test above, which asserts both
// 'Committed, not pushed' and 'Manual push: git -C ' positively against a
// FIXED report over a store with a pending change.
test('a machine name that reads blank fails the doctor\'s sync section instead of riding under a pass', { skip: !isWin }, () => {
    const fake = makeOwnStore({ coordinator: true });
    try {
        attachBareOrigin(fake);

        const healthy = doctorSyncFixReports(fake.store);
        assert.strictEqual(healthy.length, 1, JSON.stringify(healthy));
        assert.strictEqual(healthy[0].Status, 'PASS', healthy[0].Detail);
        assert.match(healthy[0].Detail, /Destination: /, 'the control reaches the healthy end of the section');

        const blank = doctorSyncFixReports(fake.store, ['function Get-MemorySyncMachineName { return "" }']);
        assert.strictEqual(blank.length, 1, JSON.stringify(blank));
        assert.strictEqual(blank[0].Status, 'FAIL', blank[0].Detail);
        // The reading that came back blank, which is the token the finding
        // rests on and the one thing the operator has to repair. The sentence
        // around it is curated operator text under no identity contract.
        assert.match(blank[0].Detail, /GetHostName\(\)/, blank[0].Detail);
        // And nothing from the healthy end of the section rides with it: a
        // store that commits nothing must not be handed a push recipe or told
        // where it publishes.
        assert.doesNotMatch(blank[0].Detail, /Destination: /);
        assert.doesNotMatch(blank[0].Detail, /Manual push: git -C /);
        assert.doesNotMatch(blank[0].Detail, /Committed, not pushed/);
    } finally {
        rmDir(fake.home);
    }
});

// A path with fringe whitespace trims to an allowed path but git materializes
// the untrimmed one, so a screen that trimmed its input would validate a
// different string than lands on disk. Planted via plumbing (cacheinfo admits
// arbitrary path bytes) with a leading space; the screen must refuse it.
test('sync-store: an incoming path with fringe whitespace gates as inbound-leak', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        const bare = attachBareOrigin(fake);
        const head = headOf(fake.store);
        const clone = cloneOf(fake, bare);
        const hashed = spawnSync('git', ['-C', clone, 'hash-object', '-w', '--stdin'],
            { input: 'a fact\n', encoding: 'utf8', env: { ...process.env } });
        assert.strictEqual(hashed.status, 0, hashed.stderr);
        const sha = hashed.stdout.trim();
        assert.strictEqual(git(clone, ['update-index', '--add', '--cacheinfo',
            '100644,' + sha + ', memory-types/leading-space.md']).status, 0);
        assert.strictEqual(git(clone, ['commit', '--quiet', '-m', 'plant a fringe-whitespace path']).status, 0);
        assert.strictEqual(git(clone, ['push', '--quiet', 'origin', 'main']).status, 0);

        assertSilentSync(runSync(fake.store));

        const state = readState(fake.store);
        assert.strictEqual(state.lastResult, 'gate');
        assert.strictEqual(state.reason, 'inbound-leak',
            'a fringe-whitespace path is refused, not trimmed and admitted');
        assert.strictEqual(headOf(fake.store), head, 'nothing was merged');
    } finally {
        rmDir(fake.home);
    }
});

// A paused merge (or cherry-pick/revert) leaves HEAD attached but conflict
// markers in the worktree; the detached gate does not catch it. Committing
// here would `git add -A` the markers and conclude the merge, baking
// `<<<<<<<` into a memory file and pushing it fleet-wide. The run must defer.
test('sync-store: a paused merge conflict in the store defers rather than committing its markers', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        write(path.join(fake.store, 'memory-types', 'x.md'), '# base\n');
        assert.strictEqual(git(fake.store, ['add', 'memory-types/x.md']).status, 0);
        assert.strictEqual(git(fake.store, ['commit', '--quiet', '-m', 'base']).status, 0);
        assert.strictEqual(git(fake.store, ['checkout', '--quiet', '-b', 'other']).status, 0);
        write(path.join(fake.store, 'memory-types', 'x.md'), '# other machine\n');
        assert.strictEqual(git(fake.store, ['commit', '--quiet', '-am', 'other']).status, 0);
        assert.strictEqual(git(fake.store, ['checkout', '--quiet', 'main']).status, 0);
        write(path.join(fake.store, 'memory-types', 'x.md'), '# this machine\n');
        assert.strictEqual(git(fake.store, ['commit', '--quiet', '-am', 'mine']).status, 0);
        const head = headOf(fake.store);
        const merge = git(fake.store, ['merge', '--no-edit', 'other']);
        assert.notStrictEqual(merge.status, 0, 'the merge really did conflict');
        assert.ok(fs.existsSync(path.join(fake.store, '.git', 'MERGE_HEAD')), 'a merge is paused');

        assertSilentSync(runSync(fake.store));

        const state = readState(fake.store);
        assert.strictEqual(state.lastResult, 'transient');
        assert.strictEqual(state.reason, 'unproven');
        assert.strictEqual(headOf(fake.store), head, 'the conflicted merge was not concluded into a commit');
        assert.ok(fs.existsSync(path.join(fake.store, '.git', 'MERGE_HEAD')),
            'the paused merge is left exactly as found for the operator');
        assert.ok(fs.readFileSync(path.join(fake.store, 'memory-types', 'x.md'), 'utf8').includes('<<<<<<<'),
            'the conflict markers were never committed away');
    } finally {
        rmDir(fake.home);
    }
});

// A paused rebase detaches HEAD, so without the in-progress deferral it would
// take the loud 'detached' gate; the deferral (which runs before the gate)
// records the quiet transient instead and leaves the rebase for the operator.
test('sync-store: a paused rebase in the store defers as transient, not the detached gate', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        write(path.join(fake.store, 'memory-types', 'x.md'), '# base\n');
        assert.strictEqual(git(fake.store, ['add', 'memory-types/x.md']).status, 0);
        assert.strictEqual(git(fake.store, ['commit', '--quiet', '-m', 'base']).status, 0);
        assert.strictEqual(git(fake.store, ['checkout', '--quiet', '-b', 'other']).status, 0);
        write(path.join(fake.store, 'memory-types', 'x.md'), '# other machine\n');
        assert.strictEqual(git(fake.store, ['commit', '--quiet', '-am', 'other']).status, 0);
        assert.strictEqual(git(fake.store, ['checkout', '--quiet', 'main']).status, 0);
        write(path.join(fake.store, 'memory-types', 'x.md'), '# this machine\n');
        assert.strictEqual(git(fake.store, ['commit', '--quiet', '-am', 'mine']).status, 0);
        const rebase = git(fake.store, ['rebase', 'other']);
        assert.notStrictEqual(rebase.status, 0, 'the rebase really did conflict and pause');
        const paused = fs.existsSync(path.join(fake.store, '.git', 'rebase-merge')) ||
            fs.existsSync(path.join(fake.store, '.git', 'rebase-apply'));
        assert.ok(paused, 'a rebase is paused');

        assertSilentSync(runSync(fake.store));

        const state = readState(fake.store);
        assert.strictEqual(state.lastResult, 'transient');
        assert.strictEqual(state.reason, 'unproven', 'the in-progress deferral pre-empts the detached gate');
        const stillPaused = fs.existsSync(path.join(fake.store, '.git', 'rebase-merge')) ||
            fs.existsSync(path.join(fake.store, '.git', 'rebase-apply'));
        assert.ok(stillPaused, 'the paused rebase is left exactly as found for the operator');
    } finally {
        rmDir(fake.home);
    }
});

test('sync-store: a tracked disallowed path gates as leaks, with no commit, no push, and the index untouched', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        const bare = attachBareOrigin(fake);
        const head = headOf(fake.store);
        assert.strictEqual(git(fake.store, ['add', '-f', '.credentials.json']).status, 0);
        write(path.join(fake.store, 'memory-types', 'pending-fact.md'), '# pending\n');

        assertSilentSync(runSync(fake.store));

        const state = readState(fake.store);
        assert.strictEqual(state.lastResult, 'gate');
        assert.strictEqual(state.reason, 'leaks');
        assert.strictEqual(headOf(fake.store), head, 'a gate mutates nothing: no commit');
        assert.ok(trackedPaths(fake.store).includes('.credentials.json'),
            'the index is exactly as found; unstaging is the operator\'s call');
        assert.ok(!trackedPaths(fake.store).includes('memory-types/pending-fact.md'),
            'nothing new reached the index either');
        const bareHead = spawnSync('git', ['-C', bare, 'rev-parse', 'main'],
            { encoding: 'utf8', env: { ...process.env } });
        assert.strictEqual(bareHead.stdout.trim(), head, 'no push over a gate');
    } finally {
        rmDir(fake.home);
    }
});

// A foreign repository gets no state file at all, not a gate record: a
// non-owned repo at the store root (an operator's dotfiles repo) has no
// allowlist ignoring kit-sync-state.json, so writing one would dirty their
// worktree forever, keep the hook pending forever, and make the loud line
// permanent with a doctor -Fix that cannot clear it.
test('sync-store: a repository without the ownership key gates as foreign, with nothing written at all', { skip: !isWin }, () => {
    const fake = makeStore();
    try {
        assert.strictEqual(git(fake.store, ['init', '--quiet', '-b', 'main']).status, 0);

        assertSilentSync(runSync(fake.store));

        assert.ok(!fs.existsSync(statePath(fake.store)),
            'a foreign gate writes no state file into somebody else\'s worktree');
        assert.ok(!fs.existsSync(path.join(fake.store, 'kit-sync.lock')), 'and leaves no lock');
        assert.ok(!fs.existsSync(path.join(fake.store, '.gitignore')), 'no managed file was written');
        assert.ok(!fs.existsSync(path.join(fake.store, '.gitattributes')));
        assert.deepStrictEqual(trackedPaths(fake.store), [], 'nothing reached the index');
        assert.notStrictEqual(git(fake.store, ['rev-parse', 'HEAD']).status, 0, 'no commit was ever made');
    } finally {
        rmDir(fake.home);
    }
});

test('sync-store: a detached HEAD gates as detached and commits nothing', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        assert.strictEqual(git(fake.store, ['checkout', '--quiet', '--detach', 'HEAD']).status, 0);
        const head = headOf(fake.store);
        write(path.join(fake.store, 'memory-types', 'pending-fact.md'), '# pending\n');

        assertSilentSync(runSync(fake.store));

        const state = readState(fake.store);
        assert.strictEqual(state.lastResult, 'gate');
        assert.strictEqual(state.reason, 'detached');
        assert.strictEqual(headOf(fake.store), head, 'no commit onto a detached HEAD');
        assert.ok(!trackedPaths(fake.store).includes('memory-types/pending-fact.md'));
    } finally {
        rmDir(fake.home);
    }
});

// The fail-closed side of the same gate: a HEAD the status read could not
// resolve at all (here, a symbolic ref to a branch that does not exist) must
// gate rather than pass as not-detached, because a commit against it would
// land on whatever that ref turns out to be.
test('sync-store: an unreadable HEAD fails closed as detached, and commits nothing', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        const mainSha = git(fake.store, ['rev-parse', 'refs/heads/main']).stdout.trim();
        assert.strictEqual(git(fake.store, ['symbolic-ref', 'HEAD', 'refs/heads/nowhere']).status, 0);
        write(path.join(fake.store, 'memory-types', 'pending-fact.md'), '# pending\n');

        assertSilentSync(runSync(fake.store));

        const state = readState(fake.store);
        assert.strictEqual(state.lastResult, 'gate');
        assert.strictEqual(state.reason, 'detached');
        assert.strictEqual(git(fake.store, ['rev-parse', 'refs/heads/main']).stdout.trim(), mainSha,
            'the real branch did not move');
        assert.notStrictEqual(git(fake.store, ['rev-parse', 'refs/heads/nowhere']).status, 0,
            'no commit materialized the dangling branch');
    } finally {
        rmDir(fake.home);
    }
});

test('sync-store: a genuinely conflicting divergence aborts the rebase, records pull-conflict, and pushes nothing', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        const bare = attachBareOrigin(fake);
        const clone = cloneOf(fake, bare);
        // Both machines rewrite the same line of the same memory body (.md
        // takes git's default merge, unlike the union-merged journals), so
        // the rebase must conflict rather than auto-resolve.
        const rel = path.join('projects', PROJECT_A, 'memory', 'a-fact.md');
        write(path.join(clone, rel), '# the other machine\'s rewrite\n');
        assert.strictEqual(git(clone, ['add', '-A']).status, 0);
        assert.strictEqual(git(clone, ['commit', '--quiet', '-m', 'other rewrite']).status, 0);
        assert.strictEqual(git(clone, ['push', '--quiet', 'origin', 'main']).status, 0);
        write(path.join(fake.store, rel), '# this machine\'s rewrite\n');
        assert.strictEqual(git(fake.store, ['add', '-A']).status, 0);
        assert.strictEqual(git(fake.store, ['commit', '--quiet', '-m', 'local rewrite']).status, 0);
        // No manual fetch: the runner's own fetch is what discovers the
        // divergence this case conflicts on.
        const localHead = headOf(fake.store);
        const bareHeadBefore = spawnSync('git', ['-C', bare, 'rev-parse', 'main'],
            { encoding: 'utf8', env: { ...process.env } }).stdout.trim();

        assertSilentSync(runSync(fake.store));

        const state = readState(fake.store);
        assert.strictEqual(state.lastResult, 'transient');
        assert.strictEqual(state.reason, 'pull-conflict');
        assert.notStrictEqual(state.firstFailSince, '', 'the failure streak starts here');
        assert.ok(!fs.existsSync(path.join(fake.store, '.git', 'rebase-merge')),
            'the rebase was aborted, not left in progress');
        assert.ok(!fs.existsSync(path.join(fake.store, '.git', 'rebase-apply')));
        assert.strictEqual(headOf(fake.store), localHead, 'the abort restored the local tip');
        const porcelain = git(fake.store, ['status', '--porcelain']);
        assert.strictEqual(porcelain.stdout.trim(), '', 'the worktree is clean after the abort');
        const bareHeadAfter = spawnSync('git', ['-C', bare, 'rev-parse', 'main'],
            { encoding: 'utf8', env: { ...process.env } }).stdout.trim();
        assert.strictEqual(bareHeadAfter, bareHeadBefore, 'nothing was pushed over a conflict');

        // A second failing run preserves the streak's start rather than
        // resetting it, which is what the hook's seven-day nudge counts from.
        assertSilentSync(runSync(fake.store));
        assert.strictEqual(readState(fake.store).firstFailSince, state.firstFailSince,
            'firstFailSince marks the streak\'s start, not the latest attempt');
    } finally {
        rmDir(fake.home);
    }
});

// Write-SyncState's second write to an existing state file goes through
// File.Replace rather than File.Move. A single-write test cannot exercise
// that branch at all, so this drives two runs with different outcomes and
// reads back a field only the second run's write could set.
test('sync-store: a second run\'s state write actually lands, not just the first', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        assert.strictEqual(git(fake.store, ['checkout', '--quiet', '--detach', 'HEAD']).status, 0);
        write(path.join(fake.store, 'memory-types', 'pending-fact.md'), '# pending\n');

        assertSilentSync(runSync(fake.store));

        const first = readState(fake.store);
        assert.strictEqual(first.lastResult, 'gate');
        assert.strictEqual(first.reason, 'detached');

        assert.strictEqual(git(fake.store, ['checkout', '--quiet', 'main']).status, 0);

        assertSilentSync(runSync(fake.store));

        const second = readState(fake.store);
        assert.strictEqual(second.lastResult, 'ok',
            'only the second write could ever record ok here; a dropped write leaves the first run\'s gate');
        assert.strictEqual(second.reason, '',
            'only the second write could ever clear the reason left by the first run');
        assert.notStrictEqual(second.lastAttempt, first.lastAttempt,
            'lastAttempt moves on every write, so a frozen one is the dropped-write tell');
    } finally {
        rmDir(fake.home);
    }
});

// The seven-day nudge in hooks/memory-session.js reads lastResult and
// firstFailSince; lastOk is Write-SyncState's own success stamp. Both
// streak fields are set by the first write (no prior state), so a case
// proving the runner clears a failure streak on a later success must
// itself write twice: once to establish the streak, once to clear it.
test('sync-store: a run reaching the success path after a failure stamps lastOk and clears firstFailSince', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        assert.strictEqual(git(fake.store, ['checkout', '--quiet', '--detach', 'HEAD']).status, 0);
        write(path.join(fake.store, 'memory-types', 'pending-fact.md'), '# pending\n');

        assertSilentSync(runSync(fake.store));

        const first = readState(fake.store);
        assert.strictEqual(first.lastResult, 'gate');
        assert.ok(Number.isFinite(Date.parse(first.firstFailSince)),
            'the gate starts the failure streak with a parseable instant');

        assert.strictEqual(git(fake.store, ['checkout', '--quiet', 'main']).status, 0);

        assertSilentSync(runSync(fake.store));

        const second = readState(fake.store);
        assert.strictEqual(second.lastResult, 'ok');
        assert.ok(Number.isFinite(Date.parse(second.lastOk)),
            'success stamps lastOk with a parseable instant');
        assert.strictEqual(second.firstFailSince, '', 'success clears the failure streak the first run started');
    } finally {
        rmDir(fake.home);
    }
});

test('sync-store: a fresh lock exits fast with git untouched, the lock kept, and no state written', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        const head = headOf(fake.store);
        write(path.join(fake.store, 'memory-types', 'pending-fact.md'), '# pending\n');
        const lock = path.join(fake.store, 'kit-sync.lock');
        fs.writeFileSync(lock, '', 'utf8');

        assertSilentSync(runSync(fake.store));

        assert.ok(fs.existsSync(lock), 'a fresh lock belongs to the run that made it, never deleted here');
        assert.ok(!fs.existsSync(statePath(fake.store)),
            'a concurrent run in progress is not a failure, so no state is recorded');
        assert.strictEqual(headOf(fake.store), head, 'no commit was made');
        assert.ok(!trackedPaths(fake.store).includes('memory-types/pending-fact.md'));
    } finally {
        rmDir(fake.home);
    }
});

test('sync-store: a lock older than fifteen minutes is stale and replaced, and the sync proceeds', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        write(path.join(fake.store, 'memory-types', 'pending-fact.md'), '# pending\n');
        const lock = path.join(fake.store, 'kit-sync.lock');
        fs.writeFileSync(lock, '', 'utf8');
        const past = new Date(Date.now() - 20 * 60 * 1000);
        fs.utimesSync(lock, past, past);

        assertSilentSync(runSync(fake.store));

        assert.strictEqual(readState(fake.store).lastResult, 'ok');
        assert.ok(trackedPaths(fake.store).includes('memory-types/pending-fact.md'),
            'the crashed run\'s leavings did not block the sync');
        assert.ok(!fs.existsSync(lock), 'the replacing run removed its own lock on exit');
        assert.deepStrictEqual(fs.readdirSync(fake.store).filter((n) => n.startsWith('kit-sync.lock.stale')),
            [], 'the takeover rename leaves no remnant behind');
    } finally {
        rmDir(fake.home);
    }
});

// The lock names its owner (pid, then an ISO start time), so staleness is a
// fact about the owning process rather than only about file age: a dead
// owner's lock is taken over at once, a live owner's fresh lock is respected.
test('sync-store: a lock naming a dead process is taken over at once', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        write(path.join(fake.store, 'memory-types', 'pending-fact.md'), '# pending\n');
        // A process that has provably exited: spawnSync waits for it, so its
        // pid names nothing by the time the runner checks.
        const dead = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8', env: { ...process.env } });
        assert.strictEqual(dead.status, 0);
        fs.writeFileSync(path.join(fake.store, 'kit-sync.lock'),
            dead.pid + '\n' + new Date().toISOString() + '\n', 'utf8');

        assertSilentSync(runSync(fake.store));

        assert.strictEqual(readState(fake.store).lastResult, 'ok');
        assert.ok(trackedPaths(fake.store).includes('memory-types/pending-fact.md'),
            'the dead owner\'s fresh lock did not block the sync');
        assert.ok(!fs.existsSync(path.join(fake.store, 'kit-sync.lock')));
    } finally {
        rmDir(fake.home);
    }
});

test('sync-store: a fresh lock naming a live process is respected', { skip: !isWin }, () => {
    const fake = makeOwnStore();
    try {
        const head = headOf(fake.store);
        write(path.join(fake.store, 'memory-types', 'pending-fact.md'), '# pending\n');
        // This test process is the live owner.
        const lock = path.join(fake.store, 'kit-sync.lock');
        fs.writeFileSync(lock, process.pid + '\n' + new Date().toISOString() + '\n', 'utf8');

        assertSilentSync(runSync(fake.store));

        assert.ok(fs.existsSync(lock), 'the live owner\'s lock is never deleted by a rival');
        assert.strictEqual(fs.readFileSync(lock, 'utf8').split('\n')[0], String(process.pid),
            'and never rewritten either');
        assert.ok(!fs.existsSync(statePath(fake.store)), 'a run in progress is not a failure: no state');
        assert.strictEqual(headOf(fake.store), head, 'no commit was made');
    } finally {
        rmDir(fake.home);
    }
});

test('sync-store: the store root is mandatory, and the script parses cleanly', { skip: !isWin }, () => {
    // The same no-default rule the installer's own test pins: a forgotten
    // argument is a loud parameter error, never a silent run against the
    // operator's real ~/.claude.
    const res = spawnSync('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SYNC],
        { encoding: 'utf8', env: { ...process.env } });
    assert.notStrictEqual(res.status, 0, 'sync-store.ps1 must not run without -StoreRoot');
    const code = fs.readFileSync(SYNC, 'utf8').split(/\r?\n/)
        .filter((l) => !/^\s*#/.test(l)).join('\n');
    assert.ok(!/USERPROFILE|\$HOME|HomeDirectory|\$env:HOME/.test(code),
        'the sync runner must resolve no store path of its own');

    const script = '$errs = $null; $tokens = $null; '
        + '[System.Management.Automation.Language.Parser]::ParseFile(' + q(SYNC)
        + ', [ref]$tokens, [ref]$errs) | Out-Null; '
        + 'if ($errs.Count -gt 0) { $errs | Write-Output; exit 1 }';
    const parsed = pwsh(script);
    assert.strictEqual(parsed.status, 0, parsed.stdout + parsed.stderr);
});
