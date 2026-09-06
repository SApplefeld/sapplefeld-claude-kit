// Tests for plugins/claude-kit/scripts/memory-index.js.
//
// Node's built-in test runner, no framework, no install (Node v24). Every case
// that sweeps points the store root at a fresh temp directory through
// KIT_MEMORY_ROOT with KIT_MEMORY_ROOT_ALLOW_DATA=1, so no test reads or writes
// the real ~/.claude: an unredirected sweep would write its sidecar there,
// which is a change to shared machine state outside this repository.
//
// This suite drives the module in-process rather than spawning children the way
// the memq suite does, because the surface under test is a library with an
// async API and an injectable embedder rather than a CLI. Environment
// redirection is therefore this process's own: each case sets the store root,
// runs, and restores in a finally block, which is safe because the runner
// executes a file's top-level tests one at a time.
//
// Two embedders appear here. Most cases inject a stub, a deterministic hashed
// bag-of-words vector, so the sweep's transitions are exercised on every
// machine whether or not the optional embedding stack is installed and so the
// count of embed calls is observable. The cases that prove the real semantic
// channel load the actual stack and skip, naming the install path, when it is
// absent. Both kinds carry a known-answer control: a planted memory must rank
// first for its own text. Without that control an embedder returning zeros for
// everything would satisfy any "results came back" assertion, and a silently
// empty semantic channel reads as authoritative absence.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const memq = require('../plugins/claude-kit/scripts/memq.js');
const mi = require('../plugins/claude-kit/scripts/memory-index.js');

// Whether the optional embedding stack is installed where this run points.
// Read once, before any case rewrites the environment, so the skip reason names
// the location that was actually probed.
const REAL_PROBE = mi.probeEmbedder();
const REAL_SKIP = REAL_PROBE.status === 'ready'
    ? false
    : 'the local embedding stack is not installed at ' + REAL_PROBE.packageDir;

// A fresh store root per case. The name is short because a store root is joined
// with a project segment and a memory name on every path this module builds.
function makeRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mix-'));
}

function rmRoot(root) {
    try {
        fs.rmSync(root, { recursive: true, force: true });
    } catch {
        // Best-effort cleanup; a leftover temp directory never fails a test.
    }
}

// Run fn with the store root redirected, restoring the environment afterwards
// whatever fn does. The engine's spawn variables are cleared for the duration:
// this suite runs inside fleet workers too, where a pin would move the project
// tier off the segments these fixtures plant.
async function withStore(fn) {
    const root = makeRoot();
    const saved = {};
    const keys = ['KIT_MEMORY_ROOT', 'KIT_MEMORY_ROOT_ALLOW_DATA', 'KIT_MEMORY_PROJECT', 'KIT_RUN_ID'];
    for (const k of keys) saved[k] = process.env[k];
    process.env.KIT_MEMORY_ROOT = root;
    process.env.KIT_MEMORY_ROOT_ALLOW_DATA = '1';
    delete process.env.KIT_MEMORY_PROJECT;
    delete process.env.KIT_RUN_ID;
    try {
        return await fn(root);
    } finally {
        for (const k of keys) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
        rmRoot(root);
    }
}

// Run fn with the embedder root redirected under its own gate.
async function withEmbedderRoot(value, gated, fn) {
    const saved = {
        KIT_EMBEDDER_ROOT: process.env.KIT_EMBEDDER_ROOT,
        KIT_EMBEDDER_ROOT_ALLOW_CODE: process.env.KIT_EMBEDDER_ROOT_ALLOW_CODE
    };
    process.env.KIT_EMBEDDER_ROOT = value;
    if (gated) process.env.KIT_EMBEDDER_ROOT_ALLOW_CODE = '1';
    else delete process.env.KIT_EMBEDDER_ROOT_ALLOW_CODE;
    try {
        return await fn();
    } finally {
        for (const k of Object.keys(saved)) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    }
}

function write(file, body) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, 'utf8');
}

// Plant one memory in a named tier, using the module's own path derivation so a
// fixture can never disagree with the walk about where a tier lives.
function plant(store, tier, name, body) {
    const file = mi.recordPath(store, tier, name);
    write(file, body);
    return file;
}

// A store holding one memory in every tier the index must reach: two project
// stores (a search answers across the machine, not only for the current
// project), a type tier, the operator tier, and each of those three tiers'
// archives. The distractors are the things that look like memories and are not.
function plantEveryTier() {
    plant('D--proj-alpha', 'project', 'alpha-live', 'the alpha project keeps its build stamp fresh');
    plant('D--proj-alpha', 'project-archive', 'alpha-retired', 'the alpha project once used a nightly cron');
    plant('D--proj-beta', 'project', 'beta-live', 'the beta project pins its migrations by hash');
    plant('node-cli', 'type', 'type-live', 'node command line tools resolve their own payload path');
    plant('node-cli', 'type-archive', 'type-retired', 'node tools once shipped a bundled runtime');
    plant(memq.OPERATOR_LABEL, 'operator', 'operator-live', 'this operator has no github cli on any machine');
    plant(memq.OPERATOR_LABEL, 'operator-archive', 'operator-retired', 'this operator once kept tokens in a plain file');

    // Not memories: the tier index, a run-scoped pending write, and a file
    // whose name the store's own rule refuses.
    write(path.join(memq.projectMemoryDirFor('D--proj-alpha'), 'MEMORY.md'), '# Memory Index\n');
    write(path.join(memq.projectMemoryDirFor('D--proj-alpha'), 'pending', 'run-7', 'pending-note.md'),
        'an unadjudicated write from one engine run');
    write(path.join(memq.projectMemoryDirFor('D--proj-alpha'), 'notes.txt'), 'not a memory file');
}

const EVERY_TIER_KEYS = [
    'D--proj-alpha project alpha-live',
    'D--proj-beta project beta-live',
    'D--proj-alpha project-archive alpha-retired',
    'node-cli type type-live',
    'node-cli type-archive type-retired',
    'operator operator operator-live',
    'operator operator-archive operator-retired'
].sort();

function keysOf(records) {
    return records.map((r) => r.store + ' ' + r.tier + ' ' + r.name).sort();
}

// A deterministic stand-in for the real model: a hashed bag of words, L2
// normalized. It is a genuine vector space rather than a constant, so identical
// text scores 1 against itself and unrelated text scores lower, which is what
// lets the known-answer control fail loudly if the search or the index is
// broken. It records every text it is asked to embed, which is how the
// re-embedding cases assert that exactly one record was rebuilt.
const STUB_DIM = 64;

function bagVector(text) {
    const v = new Array(STUB_DIM).fill(0);
    const words = String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
    for (const w of words) {
        const h = crypto.createHash('sha1').update(w).digest();
        v[h[0] % STUB_DIM] += 1;
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm);
    return norm === 0 ? v : v.map((x) => x / norm);
}

function makeStub(options) {
    const opts = options || {};
    const calls = [];
    return {
        status: 'ready',
        available: true,
        identity: opts.identity || 'stub@1/bag-of-words/none',
        dim: STUB_DIM,
        calls,
        embed: async (texts) => {
            for (const t of texts) {
                calls.push(t);
                if (opts.failOn && t.includes(opts.failOn)) {
                    throw new Error('stub refuses this text');
                }
            }
            return texts.map(bagVector);
        }
    };
}

function readSidecarLines(root) {
    return fs.readFileSync(path.join(root, mi.SIDECAR_FILE), 'utf8')
        .split('\n')
        .filter((l) => l !== '');
}

function recordFor(records, name) {
    return records.find((r) => r.name === name) || null;
}

// A directory tree as a sorted list of "relative path @ mtime", the evidence
// that a sweep changed nothing under it.
function snapshot(dir) {
    const out = [];
    const walk = (d, rel) => {
        for (const name of fs.readdirSync(d).sort()) {
            const full = path.join(d, name);
            const st = fs.statSync(full);
            if (st.isDirectory()) walk(full, rel + name + '/');
            else out.push(rel + name + ' @ ' + st.mtimeMs + ' @ ' + st.size);
        }
    };
    walk(dir, '');
    return out;
}

test('the embedder probe reports a typed absence rather than throwing', async () => {
    const empty = makeRoot();
    try {
        await withEmbedderRoot(empty, true, async () => {
            const probe = mi.probeEmbedder();
            assert.strictEqual(probe.status, 'absent');
            assert.strictEqual(probe.available, false);
            assert.strictEqual(probe.identity, null);
            assert.strictEqual(probe.packageName, '@huggingface/transformers');
            assert.strictEqual(probe.model, 'Xenova/all-MiniLM-L6-v2');
            assert.strictEqual(probe.packageDir,
                path.join(empty, 'node_modules', '@huggingface', 'transformers'));
            // The remedy is what a degraded search surface prints, so its
            // presence is part of the contract, not decoration.
            assert.match(probe.remedy, /run the kit-doctor skill/);
            assert.match(probe.detail, /no @huggingface\/transformers at/);

            // The loading path answers the same absence, still without throwing
            // and without an embed function to call.
            const loadedResult = await mi.loadEmbedder();
            assert.strictEqual(loadedResult.status, 'absent');
            assert.strictEqual(loadedResult.available, false);
            assert.strictEqual(typeof loadedResult.embed, 'undefined');
        });
    } finally {
        rmRoot(empty);
    }
});

// An install directory holding the package manifest and no model files: the
// state an interrupted install or a disk cleanup leaves behind. The manifest is
// enough for the probe, which is the point of the case.
function makeModellessInstall() {
    const root = makeRoot();
    const pkg = path.join(root, 'node_modules', '@huggingface', 'transformers');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'),
        JSON.stringify({ name: '@huggingface/transformers', version: '4.2.0' }), 'utf8');
    return root;
}

test('an install whose model files are missing is unusable, not ready', async () => {
    const root = makeModellessInstall();
    try {
        await withEmbedderRoot(root, true, async () => {
            const probe = mi.probeEmbedder();
            // Not 'ready': a ready verdict here sends a query path into a
            // multi-megabyte download, or into a hang where there is no network,
            // with nothing in the result naming the cause.
            assert.strictEqual(probe.status, 'unusable');
            assert.strictEqual(probe.available, false);
            assert.strictEqual(probe.packageVersion, '4.2.0');
            assert.strictEqual(probe.modelCacheDir,
                path.join(root, 'node_modules', '@huggingface', 'transformers', '.cache'));
            assert.match(probe.detail, /model files are missing from/);
            for (const rel of mi.MODEL_FILES) {
                assert.ok(probe.detail.includes(rel), 'the detail names ' + rel);
            }
            assert.match(probe.remedy, /run the kit-doctor skill/);

            // The load path answers the same state without loading anything, so
            // the network is never reached from a query.
            const loadedResult = await mi.loadEmbedder();
            assert.strictEqual(loadedResult.status, 'unusable');
            assert.strictEqual(typeof loadedResult.embed, 'undefined');

            await withStore(async (storeRoot) => {
                plantEveryTier();
                const result = await mi.query('anything at all');
                assert.strictEqual(result.status, 'unusable');
                assert.deepStrictEqual(result.hits, []);
                assert.strictEqual(fs.existsSync(path.join(storeRoot, mi.SIDECAR_FILE)), false);
            });
        });
    } finally {
        rmRoot(root);
    }
});

test('a model that appears completes the install without a restart', async () => {
    const root = makeModellessInstall();
    try {
        await withEmbedderRoot(root, true, async () => {
            assert.strictEqual(mi.probeEmbedder().status, 'unusable');
            // Only a successful load is cached, so a repair performed while a
            // process is running is picked up by its next call rather than
            // waiting for the next invocation.
            const base = path.join(root, 'node_modules', '@huggingface', 'transformers',
                '.cache', 'Xenova', 'all-MiniLM-L6-v2');
            for (const rel of mi.MODEL_FILES) {
                fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
                fs.writeFileSync(path.join(base, rel), 'x', 'utf8');
            }
            assert.strictEqual(mi.probeEmbedder().status, 'ready');
            assert.deepStrictEqual(mi.missingModelFiles(), []);
        });
    } finally {
        rmRoot(root);
    }
});

test('an embedder root override without its code gate is ignored', async () => {
    const elsewhere = makeRoot();
    try {
        await withEmbedderRoot(elsewhere, false, async () => {
            assert.strictEqual(mi.embedderRoot(),
                path.join(os.homedir(), '.claude', mi.EMBEDDER_DIR));
        });
        // Gated, the same value is honored, so the test above is proving the
        // gate rather than an override that never worked.
        await withEmbedderRoot(elsewhere, true, async () => {
            assert.strictEqual(mi.embedderRoot(), elsewhere);
        });
    } finally {
        rmRoot(elsewhere);
    }
});

test('a sweep with the embedder absent returns the typed absence and writes no index', async () => {
    const empty = makeRoot();
    try {
        await withStore(async (root) => {
            plantEveryTier();
            await withEmbedderRoot(empty, true, async () => {
                const result = await mi.sweep();
                assert.strictEqual(result.status, 'absent');
                assert.strictEqual(result.embedder.available, false);
                assert.deepStrictEqual(result.records, []);
                assert.strictEqual(result.written, false);
                assert.strictEqual(fs.existsSync(path.join(root, mi.SIDECAR_FILE)), false);
            });
        });
    } finally {
        rmRoot(empty);
    }
});

test('the sidecar sits at the store root, outside every tier', async () => {
    await withStore(async (root) => {
        const p = mi.indexPath();
        assert.strictEqual(p, path.join(root, 'memory-index.jsonl'));
        // tierDirFor is the store's own answer to "which tier is this file in",
        // and it must be none: a sidecar inside a tier would be swept into the
        // memory-sync repository, which admits paths under the tiers only.
        assert.strictEqual(memq.tierDirFor(p), null);
    });
});

test('a cold sweep indexes every tier, both live and archived, across every store', async () => {
    await withStore(async (root) => {
        plantEveryTier();
        const stub = makeStub();
        const result = await mi.sweep({ embedder: stub });

        assert.strictEqual(result.status, 'ok');
        assert.strictEqual(result.rebuilt, true);
        assert.strictEqual(result.added, 7);
        assert.strictEqual(result.changed, 0);
        assert.strictEqual(result.removed, 0);
        assert.deepStrictEqual(result.failed, []);
        assert.deepStrictEqual(keysOf(result.records), EVERY_TIER_KEYS);

        // The index on disk is what the next sweep and every search read, so
        // the assertion is against the file, not only the return value.
        assert.strictEqual(result.written, true);
        const lines = readSidecarLines(root).map((l) => JSON.parse(l));
        assert.deepStrictEqual(keysOf(lines), EVERY_TIER_KEYS);
        for (const r of lines) {
            assert.strictEqual(r.model, stub.identity);
            assert.strictEqual(r.vector.length, STUB_DIM);
            assert.ok(r.mtime > 0);
            assert.match(r.hash, /^[0-9a-f]{64}$/);
            assert.deepStrictEqual(Object.keys(r).sort(),
                ['hash', 'model', 'mtime', 'name', 'store', 'tier', 'vector']);
        }

        // Known-answer control: a planted memory ranks first for its own text.
        // A degenerate embedder scoring everything alike would fail here rather
        // than passing as an empty-but-green result.
        const target = 'the beta project pins its migrations by hash';
        const [vector] = await stub.embed([target]);
        const hits = mi.search(vector, result.records, { limit: 3 });
        assert.strictEqual(hits[0].name, 'beta-live');
        assert.strictEqual(hits[0].tier, 'project');
        assert.strictEqual(hits[0].store, 'D--proj-beta');
        assert.ok(hits[0].score > hits[1].score);
        assert.strictEqual(hits[0].archived, false);
    });
});

test('the walk excludes the tier index, non-memory files, and the run-scoped pending tier', async () => {
    await withStore(async () => {
        plantEveryTier();
        const found = mi.walkStore();
        assert.deepStrictEqual(found.failed, []);
        assert.deepStrictEqual(found.unscanned, []);
        assert.deepStrictEqual(keysOf(found.records), EVERY_TIER_KEYS);
        for (const r of found.records) {
            assert.ok(!/pending/.test(r.file), 'no pending-tier file is indexed: ' + r.file);
        }
    });
});

test('a new memory is embedded on the next sweep and nothing else is', async () => {
    await withStore(async () => {
        plantEveryTier();
        const stub = makeStub();
        await mi.sweep({ embedder: stub });
        stub.calls.length = 0;

        plant('D--proj-beta', 'project', 'beta-new', 'the beta project rotates its signing key monthly');
        const result = await mi.sweep({ embedder: stub });

        assert.strictEqual(result.added, 1);
        assert.strictEqual(result.changed, 0);
        assert.strictEqual(result.removed, 0);
        assert.strictEqual(result.rebuilt, false);
        assert.strictEqual(result.unchanged, 7);
        assert.strictEqual(stub.calls.length, 1);
        assert.match(stub.calls[0], /rotates its signing key monthly/);
        assert.ok(recordFor(result.records, 'beta-new'));
    });
});

test('editing a memory re-embeds exactly that record', async () => {
    await withStore(async () => {
        plantEveryTier();
        const stub = makeStub();
        const before = await mi.sweep({ embedder: stub });
        const beforeAlpha = recordFor(before.records, 'alpha-live');
        const beforeBeta = recordFor(before.records, 'beta-live');
        stub.calls.length = 0;

        plant('D--proj-alpha', 'project', 'alpha-live', 'the alpha project now stamps builds from a hook');
        const after = await mi.sweep({ embedder: stub });

        assert.strictEqual(after.changed, 1);
        assert.strictEqual(after.added, 0);
        assert.strictEqual(after.removed, 0);
        assert.strictEqual(after.rebuilt, false);
        assert.strictEqual(stub.calls.length, 1);
        assert.match(stub.calls[0], /stamps builds from a hook/);

        const afterAlpha = recordFor(after.records, 'alpha-live');
        assert.notStrictEqual(afterAlpha.hash, beforeAlpha.hash);
        assert.notDeepStrictEqual(afterAlpha.vector, beforeAlpha.vector);
        // Every other record is carried through untouched, vector included.
        assert.deepStrictEqual(recordFor(after.records, 'beta-live'), beforeBeta);
    });
});

test('a timestamp that moves without the content changing re-embeds nothing and refreshes the record', async () => {
    await withStore(async () => {
        plantEveryTier();
        const stub = makeStub();
        const before = await mi.sweep({ embedder: stub });
        const beforeAlpha = recordFor(before.records, 'alpha-live');
        stub.calls.length = 0;

        // The mtime moves an hour forward with the bytes untouched, which is
        // what a checkout of the synced store does to every file it restores.
        const file = mi.recordPath('D--proj-alpha', 'project', 'alpha-live');
        const moved = new Date(Date.now() + 3600000);
        fs.utimesSync(file, moved, moved);

        const after = await mi.sweep({ embedder: stub });
        assert.strictEqual(after.changed, 0);
        assert.strictEqual(after.added, 0);
        assert.strictEqual(after.retimed, 1);
        assert.strictEqual(after.unchanged, 6);
        assert.strictEqual(stub.calls.length, 0);

        const afterAlpha = recordFor(after.records, 'alpha-live');
        assert.strictEqual(afterAlpha.hash, beforeAlpha.hash);
        assert.deepStrictEqual(afterAlpha.vector, beforeAlpha.vector);
        assert.notStrictEqual(afterAlpha.mtime, beforeAlpha.mtime);
        assert.strictEqual(afterAlpha.mtime, fs.statSync(file).mtimeMs);
    });
});

test('a deleted memory drops out of the index', async () => {
    await withStore(async (root) => {
        plantEveryTier();
        const stub = makeStub();
        await mi.sweep({ embedder: stub });
        stub.calls.length = 0;

        fs.unlinkSync(mi.recordPath('node-cli', 'type-archive', 'type-retired'));
        const result = await mi.sweep({ embedder: stub });

        assert.strictEqual(result.removed, 1);
        assert.strictEqual(result.added, 0);
        assert.strictEqual(result.changed, 0);
        assert.strictEqual(stub.calls.length, 0);
        assert.strictEqual(recordFor(result.records, 'type-retired'), null);
        assert.deepStrictEqual(keysOf(readSidecarLines(root).map((l) => JSON.parse(l))),
            EVERY_TIER_KEYS.filter((k) => k !== 'node-cli type-archive type-retired'));
    });
});

test('an index built by a different model is rebuilt whole', async () => {
    await withStore(async () => {
        plantEveryTier();
        const first = makeStub({ identity: 'stub@1/bag-of-words/none' });
        await mi.sweep({ embedder: first });

        const second = makeStub({ identity: 'stub@2/bag-of-words/none' });
        const result = await mi.sweep({ embedder: second });

        assert.strictEqual(result.rebuilt, true);
        assert.strictEqual(result.added, 7);
        assert.strictEqual(result.changed, 0);
        assert.strictEqual(result.unchanged, 0);
        assert.strictEqual(second.calls.length, 7);
        for (const r of result.records) assert.strictEqual(r.model, 'stub@2/bag-of-words/none');
    });
});

test('a corrupt index is a rebuild, not an error', async () => {
    await withStore(async (root) => {
        plantEveryTier();
        const stub = makeStub();
        await mi.sweep({ embedder: stub });

        const sidecar = path.join(root, mi.SIDECAR_FILE);
        const lines = readSidecarLines(root);
        // A truncated final line, which is what an interrupted write of an
        // unguarded index would leave behind.
        fs.writeFileSync(sidecar, lines.slice(0, 3).join('\n') + '\n' + lines[3].slice(0, 40), 'utf8');
        assert.strictEqual(mi.readIndex().status, 'corrupt');

        stub.calls.length = 0;
        const result = await mi.sweep({ embedder: stub });
        assert.strictEqual(result.rebuilt, true);
        assert.strictEqual(result.added, 7);
        assert.strictEqual(stub.calls.length, 7);
        assert.deepStrictEqual(keysOf(result.records), EVERY_TIER_KEYS);
    });
});

test('an index holding a well-formed line with a bad vector is a rebuild', async () => {
    await withStore(async (root) => {
        plantEveryTier();
        const stub = makeStub();
        await mi.sweep({ embedder: stub });

        const sidecar = path.join(root, mi.SIDECAR_FILE);
        const records = readSidecarLines(root).map((l) => JSON.parse(l));
        records[2].vector = [1, null, 3];
        fs.writeFileSync(sidecar, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

        const read = mi.readIndex();
        assert.strictEqual(read.status, 'corrupt');
        assert.deepStrictEqual(read.records, []);

        const result = await mi.sweep({ embedder: stub });
        assert.strictEqual(result.rebuilt, true);
        assert.deepStrictEqual(keysOf(result.records), EVERY_TIER_KEYS);
    });
});

test('a deleted index is rebuilt on the next sweep', async () => {
    await withStore(async (root) => {
        plantEveryTier();
        const stub = makeStub();
        const before = await mi.sweep({ embedder: stub });

        fs.unlinkSync(path.join(root, mi.SIDECAR_FILE));
        assert.strictEqual(mi.readIndex().status, 'absent');

        stub.calls.length = 0;
        const after = await mi.sweep({ embedder: stub });
        assert.strictEqual(after.rebuilt, true);
        assert.strictEqual(after.added, 7);
        assert.strictEqual(stub.calls.length, 7);
        assert.deepStrictEqual(keysOf(after.records), keysOf(before.records));

        // The rebuilt index answers the known-answer control exactly as the
        // first one did, which is what makes the rebuild a recovery rather than
        // a technically-present file.
        const [vector] = await stub.embed(['this operator has no github cli on any machine']);
        const hits = mi.search(vector, after.records, { limit: 2 });
        assert.strictEqual(hits[0].name, 'operator-live');
        assert.strictEqual(hits[0].tier, 'operator');
    });
});

test('a sweep writes only its own sidecar and never touches a memory file', async () => {
    await withStore(async (root) => {
        plantEveryTier();
        const tiers = [
            memq.projectMemoryDirFor('D--proj-alpha'),
            memq.projectMemoryDirFor('D--proj-beta'),
            memq.typesRootPath(),
            memq.operatorDirPath()
        ];
        const before = tiers.map(snapshot);
        const stub = makeStub();
        await mi.sweep({ embedder: stub });
        // A second sweep, since the write path a stale index takes differs from
        // the one a cold build takes.
        plant('D--proj-alpha', 'project', 'alpha-live', 'the alpha project edited its build stamp note');
        await mi.sweep({ embedder: stub });

        const after = tiers.map(snapshot);
        for (let i = 0; i < tiers.length; i++) {
            // Only the file this case edited by hand differs, and it differs by
            // the edit, so every memory the sweep saw is byte-for-byte as it
            // was.
            const diff = after[i].filter((line, j) => line !== before[i][j]);
            const expected = tiers[i] === memq.projectMemoryDirFor('D--proj-alpha') ? 1 : 0;
            assert.strictEqual(diff.length, expected, 'unexpected change under ' + tiers[i]
                + ': ' + JSON.stringify(diff));
            assert.strictEqual(after[i].length, before[i].length);
        }

        // At the store root, the sidecar is the only thing the sweep added, and
        // no rename temporary survives.
        const rootEntries = fs.readdirSync(root).sort();
        assert.deepStrictEqual(rootEntries,
            ['memory-index.jsonl', 'memory-operator', 'memory-types', 'projects']);
    });
});

test('a memory that cannot be read is reported and keeps its indexed vector', async () => {
    await withStore(async () => {
        plantEveryTier();
        const stub = makeStub();
        const before = await mi.sweep({ embedder: stub });
        const beforeType = recordFor(before.records, 'type-live');

        const blocked = mi.recordPath('node-cli', 'type', 'type-live');
        const real = fs.readFileSync;
        fs.readFileSync = function (file, ...rest) {
            if (typeof file === 'string' && path.resolve(file) === path.resolve(blocked)) {
                const err = new Error('EBUSY: file is locked');
                err.code = 'EBUSY';
                throw err;
            }
            return real.call(this, file, ...rest);
        };
        let result;
        try {
            result = await mi.sweep({ embedder: stub });
        } finally {
            fs.readFileSync = real;
        }

        assert.strictEqual(result.status, 'ok');
        assert.strictEqual(result.failed.length, 1);
        assert.strictEqual(result.failed[0].name, 'type-live');
        assert.strictEqual(result.failed[0].store, 'node-cli');
        assert.match(result.failed[0].reason, /cannot read the memory file/);
        // The record survives with the vector it already had: an unreadable
        // file is no evidence the memory changed or went away.
        assert.deepStrictEqual(recordFor(result.records, 'type-live'), beforeType);
        assert.deepStrictEqual(keysOf(result.records), EVERY_TIER_KEYS);
    });
});

test('an embedder that fails on one memory reports it and indexes the rest', async () => {
    await withStore(async () => {
        plantEveryTier();
        const stub = makeStub({ failOn: 'nightly cron' });
        const result = await mi.sweep({ embedder: stub });

        assert.strictEqual(result.status, 'ok');
        assert.strictEqual(result.failed.length, 1);
        assert.strictEqual(result.failed[0].name, 'alpha-retired');
        assert.strictEqual(result.failed[0].tier, 'project-archive');
        assert.match(result.failed[0].reason, /the embedder failed on this memory/);
        assert.deepStrictEqual(keysOf(result.records),
            EVERY_TIER_KEYS.filter((k) => k !== 'D--proj-alpha project-archive alpha-retired'));

        // The failure is transient from the index's point of view: the record
        // was never written, so the next sweep treats it as new.
        const healthy = makeStub();
        const again = await mi.sweep({ embedder: healthy });
        assert.deepStrictEqual(again.failed, []);
        assert.strictEqual(again.rebuilt, false);
        assert.strictEqual(again.added, 1);
        assert.strictEqual(again.unchanged, 6);
        assert.deepStrictEqual(keysOf(again.records), EVERY_TIER_KEYS);
    });
});

// Make one directory unreadable to the walk for the duration of fn. Windows
// leaves an ordinary directory readable whatever its permissions say, so the
// failure is injected at the filesystem call this process makes, which is the
// same call an EACCES would fail at.
async function withUnreadableDir(dir, fn) {
    const real = fs.readdirSync;
    fs.readdirSync = function (target, ...rest) {
        if (typeof target === 'string' && path.resolve(target) === path.resolve(dir)) {
            const err = new Error('EACCES: permission denied');
            err.code = 'EACCES';
            throw err;
        }
        return real.call(this, target, ...rest);
    };
    try {
        return await fn();
    } finally {
        fs.readdirSync = real;
    }
}

test('a projects root that cannot be scanned is reported and its records are carried, not pruned', async () => {
    await withStore(async () => {
        plantEveryTier();
        const stub = makeStub();
        const before = await mi.sweep({ embedder: stub });
        const beforeAlpha = recordFor(before.records, 'alpha-live');
        stub.calls.length = 0;

        const result = await withUnreadableDir(memq.projectsRootPath(),
            () => mi.sweep({ embedder: stub }));

        assert.strictEqual(result.failed.length, 1);
        assert.strictEqual(result.failed[0].tier, 'project');
        assert.strictEqual(result.failed[0].store, null);
        assert.match(result.failed[0].reason, /could not scan the projects root/);

        // A directory that could not be read is no evidence its memories went
        // away, so every project record is carried through untouched and none
        // is counted as removed. Pruning them would empty the semantic channel
        // for two whole stores over a transient permission error.
        assert.strictEqual(result.removed, 0);
        assert.strictEqual(result.carried, 3);
        assert.strictEqual(stub.calls.length, 0);
        assert.deepStrictEqual(keysOf(result.records), EVERY_TIER_KEYS);
        assert.deepStrictEqual(recordFor(result.records, 'alpha-live'), beforeAlpha);
    });
});

test('a type root that cannot be scanned is reported and its records are carried, not pruned', async () => {
    await withStore(async () => {
        plantEveryTier();
        const stub = makeStub();
        const before = await mi.sweep({ embedder: stub });
        const beforeType = recordFor(before.records, 'type-live');
        stub.calls.length = 0;

        const result = await withUnreadableDir(memq.typesRootPath(),
            () => mi.sweep({ embedder: stub }));

        assert.strictEqual(result.failed.length, 1);
        assert.strictEqual(result.failed[0].tier, 'type');
        assert.strictEqual(result.failed[0].store, null);
        assert.match(result.failed[0].reason, /could not scan the type root/);
        assert.strictEqual(result.removed, 0);
        assert.strictEqual(result.carried, 2);
        assert.deepStrictEqual(keysOf(result.records), EVERY_TIER_KEYS);
        assert.deepStrictEqual(recordFor(result.records, 'type-live'), beforeType);
    });
});

test('one tier archive that cannot be scanned costs only that archive', async () => {
    await withStore(async () => {
        plantEveryTier();
        const stub = makeStub();
        await mi.sweep({ embedder: stub });

        const archiveDir = path.join(memq.operatorDirPath(), memq.ARCHIVE_DIR);
        const result = await withUnreadableDir(archiveDir, () => mi.sweep({ embedder: stub }));

        assert.strictEqual(result.failed.length, 1);
        assert.strictEqual(result.failed[0].tier, 'operator-archive');
        assert.strictEqual(result.carried, 1);
        assert.strictEqual(result.removed, 0);
        // The live operator tier above it was read normally.
        assert.strictEqual(result.unchanged, 6);
        assert.deepStrictEqual(keysOf(result.records), EVERY_TIER_KEYS);
    });
});

test('a directory under projects that the store could not have written is skipped silently', async () => {
    await withStore(async () => {
        plantEveryTier();
        // A project directory name is derived from a working directory path by
        // replacing every character outside [A-Za-z0-9] with a hyphen, so a name
        // holding a space was written by something else. It is skipped rather
        // than indexed, because its name could not survive a round trip through
        // the index: a record carrying it would be refused by the reader on the
        // next sweep and rebuild the whole sidecar every time. The skip is
        // silent rather than reported for the same reason a missing projects
        // root is: a foreign directory is a permanent condition, and a warning
        // that can never be cleared is one an operator learns to ignore.
        write(path.join(memq.projectsRootPath(), 'bad name', 'memory', 'stray.md'),
            'a memory in a directory this store did not create');

        const result = await mi.sweep({ embedder: makeStub() });
        assert.deepStrictEqual(result.failed, []);
        assert.deepStrictEqual(keysOf(result.records), EVERY_TIER_KEYS);
        assert.strictEqual(recordFor(result.records, 'stray'), null);
    });
});

test('a store with no projects directory at all reports no failure', async () => {
    await withStore(async () => {
        // An operator-only store, the ordinary shape of a machine whose kit has
        // written operator facts and no project memory yet. Absence of the
        // directory is a store shape, not a scan failure, and reporting it would
        // put a permanent warning on a healthy store.
        plant(memq.OPERATOR_LABEL, 'operator', 'operator-live',
            'this operator has no github cli on any machine');
        assert.strictEqual(fs.existsSync(memq.projectsRootPath()), false);
        assert.strictEqual(fs.existsSync(memq.typesRootPath()), false);

        const result = await mi.sweep({ embedder: makeStub() });
        assert.deepStrictEqual(result.failed, []);
        assert.strictEqual(result.added, 1);
        assert.deepStrictEqual(keysOf(result.records), ['operator operator operator-live']);

        const walk = mi.walkStore();
        assert.deepStrictEqual(walk.failed, []);
        assert.deepStrictEqual(walk.unscanned, []);
    });
});

test('query answers the typed absence when the embedding stack is not installed', async () => {
    const empty = makeRoot();
    try {
        await withStore(async () => {
            plantEveryTier();
            await withEmbedderRoot(empty, true, async () => {
                const result = await mi.query('how does the beta project pin migrations');
                assert.strictEqual(result.status, 'absent');
                assert.deepStrictEqual(result.hits, []);
                assert.strictEqual(result.sweep, null);
                assert.match(result.embedder.remedy, /run the kit-doctor skill/);
            });
        });
    } finally {
        rmRoot(empty);
    }
});

test('query ranks the planted answer first', async () => {
    await withStore(async () => {
        plantEveryTier();
        const stub = makeStub();
        const result = await mi.query('this operator has no github cli on any machine',
            { embedder: stub, limit: 3 });
        assert.strictEqual(result.status, 'ok');
        assert.strictEqual(result.sweep.added, 7);
        assert.strictEqual(result.hits[0].name, 'operator-live');
        assert.ok(result.hits[0].score > result.hits[1].score);
    });
});

test('the installed embedding stack builds a real index over every tier and ranks its own text first',
    { skip: REAL_SKIP }, async () => {
        await withStore(async (root) => {
            plantEveryTier();
            const result = await mi.query('this operator has no github cli on any machine',
                { limit: 7 });

            assert.strictEqual(result.status, 'ok');
            assert.strictEqual(result.embedder.model, 'Xenova/all-MiniLM-L6-v2');
            assert.strictEqual(result.sweep.rebuilt, true);
            assert.strictEqual(result.sweep.added, 7);
            assert.deepStrictEqual(result.sweep.failed, []);
            assert.deepStrictEqual(keysOf(result.sweep.records), EVERY_TIER_KEYS);

            // The vectors are the real model's: 384 dimensions, stamped with the
            // installed package version so an upgrade rebuilds them.
            const lines = readSidecarLines(root).map((l) => JSON.parse(l));
            for (const r of lines) {
                assert.strictEqual(r.vector.length, 384);
                assert.strictEqual(r.model, result.embedder.identity);
                assert.match(r.model, /^@huggingface\/transformers@/);
            }

            // Known-answer control: the planted memory whose text is the query
            // ranks first. A model returning a constant vector would tie every
            // record and fail here.
            assert.strictEqual(result.hits[0].name, 'operator-live');
            assert.ok(result.hits[0].score > result.hits[1].score);
        });
    });

test('the installed embedding stack ranks a paraphrase above an unrelated memory',
    { skip: REAL_SKIP }, async () => {
        await withStore(async () => {
            // Three memories with no shared vocabulary between the query and any
            // of them, so a lexical channel would return nothing here.
            plant('D--proj-alpha', 'project', 'guard-secret',
                'the guard blocks a secret from being committed');
            plant('D--proj-alpha', 'project', 'yellow-fruit',
                'bananas are yellow fruit');
            plant(memq.OPERATOR_LABEL, 'operator', 'own-text',
                'the allowlist refuses a credential');

            const result = await mi.query('the allowlist refuses a credential', { limit: 3 });
            assert.strictEqual(result.status, 'ok');

            const rank = result.hits.map((h) => h.name);
            // Known-answer control first, then the ordering the semantic channel
            // exists for. Rankings rather than score thresholds: the absolute
            // similarities move with batching and model revisions, while the
            // order is the property being relied on.
            assert.deepStrictEqual(rank, ['own-text', 'guard-secret', 'yellow-fruit']);
        });
    });

test('the embedder probe agrees with the filesystem about whether the stack is installed', () => {
    // Always runs, in both the installed and the absent state. The filesystem is
    // read here independently of the probe, because the two real-model cases
    // below skip on the probe's word: a probe that misreported an installed
    // stack as absent would silently skip them everywhere while a test that
    // merely accepted either status stayed green.
    assert.strictEqual(REAL_PROBE.packageDir,
        path.join(mi.embedderRoot(), 'node_modules', '@huggingface', 'transformers'));

    const manifest = path.join(REAL_PROBE.packageDir, 'package.json');
    const packageOnDisk = fs.existsSync(manifest);
    const modelOnDisk = mi.MODEL_FILES.every((rel) => fs.existsSync(
        path.join(mi.modelCacheDir(), 'Xenova', 'all-MiniLM-L6-v2', rel)));

    if (!packageOnDisk) {
        assert.strictEqual(REAL_PROBE.status, 'absent');
        assert.strictEqual(REAL_SKIP, 'the local embedding stack is not installed at '
            + REAL_PROBE.packageDir);
    } else if (!modelOnDisk) {
        assert.strictEqual(REAL_PROBE.status, 'unusable');
        assert.ok(REAL_SKIP, 'the real-model cases skip while the model files are missing');
    } else {
        assert.strictEqual(REAL_PROBE.status, 'ready');
        assert.strictEqual(REAL_SKIP, false, 'the real-model cases run when the stack is installed');
        assert.match(REAL_PROBE.identity,
            /^@huggingface\/transformers@.+\/Xenova\/all-MiniLM-L6-v2\/q8$/);
    }
});

test('a vector the embedder cannot produce cleanly is reported, never written', async () => {
    await withStore(async (root) => {
        plantEveryTier();
        // A NaN component serializes as null, which the index reader refuses, so
        // writing one would make every later sweep read the whole sidecar as
        // corrupt and re-embed the entire store forever.
        const poisoned = makeStub();
        const clean = poisoned.embed;
        poisoned.embed = async (texts) => {
            const vectors = await clean(texts);
            return vectors.map((v, i) => (texts[i].includes('nightly cron')
                ? v.map((x, j) => (j === 0 ? NaN : x))
                : v));
        };
        const result = await mi.sweep({ embedder: poisoned });

        assert.strictEqual(result.failed.length, 1);
        assert.strictEqual(result.failed[0].name, 'alpha-retired');
        assert.match(result.failed[0].reason, /no usable vector/);
        assert.deepStrictEqual(keysOf(result.records),
            EVERY_TIER_KEYS.filter((k) => k !== 'D--proj-alpha project-archive alpha-retired'));

        // The sidecar it wrote is still a readable index, not a permanent
        // rebuild loop.
        assert.strictEqual(mi.readIndex().status, 'ok');
        assert.ok(!fs.readFileSync(path.join(root, mi.SIDECAR_FILE), 'utf8').includes('null'));
    });
});

test('a sidecar record whose store is a path token is refused', async () => {
    await withStore(async (root) => {
        plantEveryTier();
        await mi.sweep({ embedder: makeStub() });

        const records = readSidecarLines(root).map((l) => JSON.parse(l));
        records[0].store = '..';
        fs.writeFileSync(path.join(root, mi.SIDECAR_FILE),
            records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

        // The sidecar is the one input this module parses and then trusts, and
        // its store field is joined onto a path, so a traversal token makes the
        // whole file untrustworthy and the index is rebuilt from the store.
        assert.strictEqual(mi.readIndex().status, 'corrupt');
        assert.strictEqual(mi.recordPath('..', 'project', 'alpha-live'), null);
        // The operator tier has no per-store segment, so its records carry the
        // fixed label and nothing else round-trips there.
        assert.strictEqual(mi.recordPath('D--proj-alpha', 'operator', 'operator-live'), null);
        assert.strictEqual(mi.recordPath('operator', 'operator', 'operator-live'),
            path.join(memq.operatorDirPath(), 'operator-live.md'));
    });
});

test('cosine refuses to compare vectors of different widths', () => {
    // Two widths mean two models, whose dimensions carry unrelated meanings.
    // Scoring over the shared prefix would put a number on a non-answer and rank
    // by it.
    assert.strictEqual(mi.cosine([1, 0, 0], [1, 0]), 0);
    assert.strictEqual(mi.cosine([1, 0, 0], [1, 0, 0]), 1);
    assert.strictEqual(mi.cosine([0, 0, 0], [1, 0, 0]), 0);
    // A caller holding the model's own Float32Array is compared, not refused.
    assert.strictEqual(mi.cosine(Float32Array.from([1, 0, 0]), [1, 0, 0]), 1);
});

// ------------------------------------------------- cancelling the work -----
//
// The two callers outside `find` bound their wait on this module with a timer
// and abort a controller when it expires, so an abandoned sweep or query is an
// ordinary condition here rather than a bug: it answers a typed 'cancelled'
// status, keeps whatever vectors it had already paid for, and never throws. A
// pass that stops before the walk has nothing to keep. Each case below aborts at
// a point a real expiry can land and reads what stopped off the stub's own record
// of the calls it was asked to make, so nothing here is timed and nothing depends
// on the module's batch size.
//
// The failure these cases are shaped against is a signal check placed where no
// expiry reaches it: green on the shape with the hang left where it was. So the
// aborts land inside an embed call, which is where a timer fires against a real
// stack, rather than between two of this module's own statements.

// The stub, with the controller aborted as each embed call returns: the caller
// has walked away while the model was working, which is the shape of every real
// expiry here. `batches` is the texts of each call in order, so a case says how
// far the embedding got rather than how long it took.
function makeCancellingStub(controller) {
    const stub = makeStub();
    const batches = [];
    const embed = stub.embed;
    stub.batches = batches;
    stub.embed = async (texts) => {
        batches.push(texts.slice());
        const vectors = await embed(texts);
        controller.abort();
        return vectors;
    };
    return stub;
}

// Plant `count` memories in one project store, each with its own text, which is
// how a case reaches more records than one embed batch holds without naming the
// batch size the module keeps to itself. The name to body map it answers is what
// lets a case compose the exact text each record is embedded through.
function plantMany(count) {
    const words = ['signing', 'migrations', 'timeout', 'cache', 'lockfile', 'anchor'];
    const bodies = new Map();
    for (let i = 0; i < count; i++) {
        const name = 'fact-' + i;
        const body = 'the alpha project fact number ' + i + ' about '
            + words[i % words.length] + '\n';
        plant('D--proj-alpha', 'project', name, body);
        bodies.set(name, body);
    }
    return bodies;
}

test('a signal already aborted stops a sweep before the store walk, in the shape a caller'
    + ' already reads', async () => {
    await withStore(async (root) => {
        plantEveryTier();
        const controller = new AbortController();
        controller.abort();
        const stub = makeStub();
        const result = await mi.sweep({ embedder: stub, signal: controller.signal });

        assert.strictEqual(result.status, 'cancelled');
        // Nothing was embedded: the check sits ahead of the walk, which is the
        // only placement a stalled load can benefit from.
        assert.deepStrictEqual(stub.calls, []);
        assert.deepStrictEqual(result.records, []);
        assert.strictEqual(result.written, false);
        assert.strictEqual(fs.existsSync(path.join(root, mi.SIDECAR_FILE)), false);
        // The same key set a completed sweep carries, read off a completed sweep
        // of this same store, so the callers that print counts off this object
        // meet numbers rather than undefined.
        const completed = await mi.sweep({ embedder: makeStub() });
        assert.strictEqual(completed.status, 'ok');
        assert.deepStrictEqual(Object.keys(result).sort(), Object.keys(completed).sort());
    });
});

test('a cancellation landing between embed batches stops the remaining batches and keeps the'
    + ' vectors already paid for, which the next sweep resumes from', async () => {
    await withStore(async (root) => {
        // An index built and persisted first, so this case reads what a cancelled
        // sweep does to a real one rather than only what it writes from nothing.
        plantEveryTier();
        const first = await mi.sweep({ embedder: makeStub() });
        assert.strictEqual(first.written, true);

        // More records than one batch holds, so there is a second batch for the
        // abort to stop. The count is not the module's batch size and does not
        // need to be: what the case reads is that the embedding stopped after the
        // first call with texts still pending.
        const bodies = plantMany(40);
        const controller = new AbortController();
        const stub = makeCancellingStub(controller);
        const result = await mi.sweep({ embedder: stub, signal: controller.signal });

        assert.strictEqual(result.status, 'cancelled');
        assert.strictEqual(stub.batches.length, 1,
            'the embedding stopped at the first batch boundary: '
            + JSON.stringify(stub.batches.map((b) => b.length)));
        assert.ok(stub.batches[0].length < 40,
            'and it had not embedded every pending record: ' + stub.batches[0].length);

        // The names the one batch covered, and the ones still pending, read off
        // the texts the stub was handed rather than off any batch size.
        const embedded = [...bodies].filter(([name, body]) =>
            stub.batches[0].includes(mi.embedText(name, body)));
        const pending = [...bodies].filter(([name, body]) =>
            !stub.batches[0].includes(mi.embedText(name, body)));
        assert.ok(embedded.length > 0 && pending.length > 0,
            'the batch split the planted records: ' + embedded.length + ' embedded, '
            + pending.length + ' pending');

        // What the pass paid for is on disk: the prior index plus exactly the
        // records this pass embedded, and nothing standing in for the remainder.
        // A cancelled sweep that discarded these would leave every bounded caller
        // sweeping from empty forever, since the bound is what cancels it.
        assert.strictEqual(result.written, true);
        const onDisk = keysOf(readSidecarLines(root).map((l) => JSON.parse(l)));
        assert.deepStrictEqual(onDisk,
            EVERY_TIER_KEYS
                .concat(embedded.map(([name]) => 'D--proj-alpha project ' + name)).sort());
        for (const [name] of pending) {
            assert.ok(!onDisk.includes('D--proj-alpha project ' + name),
                'the pending remainder is absent from the index: ' + name);
        }

        // And the remainder is named in failed rather than left out of the
        // account: the counters above already counted these records, and a caller
        // decides a pass was partial from failed and the carried tiers, so a
        // cancelled pass silent about them would read as a complete one over an
        // index missing them.
        assert.deepStrictEqual(result.failed.map((f) => f.name).sort(),
            pending.map(([name]) => name).sort());
        for (const f of result.failed) {
            assert.strictEqual(f.store, 'D--proj-alpha');
            assert.strictEqual(f.tier, 'project');
            assert.strictEqual(f.reason,
                'the sweep was cancelled before this memory was embedded');
        }

        // And the remainder is what the next uncancelled sweep embeds: exactly
        // those texts, once each, which is the self-healing the failed records
        // already have.
        const resumed = makeStub();
        const second = await mi.sweep({ embedder: resumed });
        assert.strictEqual(second.status, 'ok');
        assert.deepStrictEqual(resumed.calls.slice().sort(),
            pending.map(([name, body]) => mi.embedText(name, body)).sort());
        assert.deepStrictEqual(keysOf(second.records),
            EVERY_TIER_KEYS
                .concat([...bodies.keys()].map((name) => 'D--proj-alpha project ' + name)).sort());
        assert.deepStrictEqual(second.failed, [],
            'and the cancelled pass names nothing once it is finished: '
                + JSON.stringify(second.failed));
    });
});

test('a cancellation landing between the per-item retries stops the rest of them', async () => {
    await withStore(async (root) => {
        plantMany(20);
        const controller = new AbortController();
        const batches = [];
        // A batch whose vectors this module will not write sends the sweep into
        // its per-item retry, which is the second loop a signal has to reach: a
        // check in the batch loop alone would leave a whole batch's worth of
        // single-text calls running for a caller who has gone.
        const stub = {
            status: 'ready',
            available: true,
            identity: 'stub@1/bag-of-words/none',
            dim: STUB_DIM,
            batches,
            embed: async (texts) => {
                batches.push(texts.slice());
                if (texts.length > 1) return texts.map(() => [1]);
                const vector = bagVector(texts[0]);
                controller.abort();
                return [vector];
            }
        };
        const result = await mi.sweep({ embedder: stub, signal: controller.signal });

        assert.strictEqual(result.status, 'cancelled');
        // The refused batch, then exactly one retry: the abort landed inside that
        // retry and the next item read it before calling the embedder.
        assert.strictEqual(batches.length, 2,
            'one refused batch and one retry: ' + JSON.stringify(batches.map((b) => b.length)));
        assert.strictEqual(batches[1].length, 1,
            'the retry embeds one text at a time: ' + JSON.stringify(batches.map((b) => b.length)));
        // The one retry that answered is kept, as in the batch case: the pass
        // writes what it embedded and leaves the rest to the next sweep.
        assert.strictEqual(result.written, true);
        assert.strictEqual(result.records.length, 1,
            'exactly the record the answered retry produced: ' + keysOf(result.records));
        assert.deepStrictEqual(keysOf(readSidecarLines(root).map((l) => JSON.parse(l))),
            keysOf(result.records));
    });
});

test('query answers the cancelled status rather than ranking, wherever the abort lands: ahead of'
    + ' the sweep, inside it, or ahead of the ranking', async () => {
        await withStore(async (root) => {
            plantEveryTier();
            // Aborted before the query is entered: the sweep is never reached,
            // which is what the null sweep says.
            const early = new AbortController();
            early.abort();
            const first = await mi.query('this operator has no github cli on any machine',
                { embedder: makeStub(), signal: early.signal });
            assert.strictEqual(first.status, 'cancelled');
            assert.deepStrictEqual(first.hits, []);
            assert.strictEqual(first.sweep, null);
            assert.ok(first.embedder.available, 'the embedder is still reported');
            assert.deepStrictEqual(Object.keys(first).sort(),
                ['embedder', 'hits', 'status', 'sweep']);
            assert.strictEqual(fs.existsSync(path.join(root, mi.SIDECAR_FILE)), false,
                'and a cancelled query persisted nothing');

            // Aborted inside the sweep's embedding, with more records planted than
            // one batch holds so the abort lands with records still pending: the
            // query carries the sweep that stopped and ranks nothing.
            const bodies = plantMany(40);
            const planted = EVERY_TIER_KEYS.length + bodies.size;
            const during = new AbortController();
            const stub = makeCancellingStub(during);
            const second = await mi.query('this operator has no github cli on any machine',
                { embedder: stub, signal: during.signal });
            assert.strictEqual(second.status, 'cancelled');
            assert.deepStrictEqual(second.hits, []);
            assert.strictEqual(second.sweep.status, 'cancelled');
            // The sweep keeps the vectors it paid for and accounts for the rest,
            // and the query still ranks nothing over them: a partial index is a
            // sound thing to persist and an unsound thing to answer a search from.
            assert.strictEqual(second.sweep.written, true);
            assert.ok(second.sweep.records.length > 0
                && second.sweep.records.length < planted,
            'the index is short of the store: ' + second.sweep.records.length
                + ' of ' + planted);
            assert.strictEqual(second.sweep.records.length + second.sweep.failed.length, planted,
                'every planted record is either indexed or named in failed: '
                    + second.sweep.records.length + ' + ' + second.sweep.failed.length);
            assert.ok(fs.existsSync(path.join(root, mi.SIDECAR_FILE)));

            // Aborted on the query's own embed, with nothing left to sweep: the
            // check ahead of the ranking is the only one left to read it, and the
            // completed sweep rides out with the cancelled status so a caller can
            // still say what the index knows.
            const finished = await mi.sweep({ embedder: makeStub() });
            assert.strictEqual(finished.status, 'ok');
            assert.strictEqual(finished.records.length, planted);
            const late = new AbortController();
            const lateStub = makeCancellingStub(late);
            const third = await mi.query('this operator has no github cli on any machine',
                { embedder: lateStub, signal: late.signal });
            assert.strictEqual(third.status, 'cancelled');
            assert.deepStrictEqual(third.hits, []);
            assert.strictEqual(third.sweep.status, 'ok',
                'the sweep ahead of it completed: ' + third.sweep.status);
            assert.strictEqual(third.sweep.records.length, planted);
            assert.deepStrictEqual(lateStub.batches.map((b) => b.length), [1],
                'the one embed the abort landed on is the query text: '
                    + JSON.stringify(lateStub.batches));
        });
    });

test('a signal that is never aborted changes nothing about the sweep, the hits or the'
    + ' persisted vectors', async () => {
    await withStore(async (root) => {
        plantEveryTier();
        const sidecar = path.join(root, mi.SIDECAR_FILE);
        const plain = await mi.query('this operator has no github cli on any machine',
            { embedder: makeStub(), limit: 3 });
        const bytes = fs.readFileSync(sidecar, 'utf8');

        // The control every case above rests on: the same query under a live
        // signal nobody aborts. A check reading a signal's presence rather than
        // its abort would fail here and pass everywhere else.
        const signal = new AbortController().signal;
        const guarded = await mi.query('this operator has no github cli on any machine',
            { embedder: makeStub(), limit: 3, signal });

        assert.strictEqual(guarded.status, 'ok');
        assert.deepStrictEqual(guarded.hits, plain.hits);
        assert.strictEqual(guarded.sweep.status, 'ok');
        assert.strictEqual(guarded.sweep.unchanged, 7);
        assert.strictEqual(guarded.sweep.written, true);
        assert.strictEqual(fs.readFileSync(sidecar, 'utf8'), bytes,
            'the sidecar is byte-identical under a signal that never fired');
    });
});

test('embedText is exported and is the composition every indexed record is embedded through',
    async () => {
        // The name's separators become words: a memory name is a fact-bearing
        // phrase in this store, so what the model reads is the phrase.
        assert.strictEqual(mi.embedText('a-fact_here', 'the body'), 'a fact here\n\nthe body');
        await withStore(async () => {
            const body = 'the beta project rotates its signing key monthly\n';
            plant('D--proj-beta', 'project', 'beta-live', body);
            const stub = makeStub();
            await mi.sweep({ embedder: stub });
            // The call site and the exported composition are one string, so a
            // caller composing a query through embedText composes it the way the
            // corpus it will be ranked against was composed.
            assert.deepStrictEqual(stub.calls, [mi.embedText('beta-live', body)]);
        });
    });
