// Tests for plugins/claude-kit/hooks/context-tripwire.js (the compaction
// tripwire PostToolUse hook).
//
// Node's built-in test runner, no framework. The hook is spawned as a real
// child process, fed a PostToolUse payload on stdin, and asserted on by its
// stdout: a nudge emits {"hookSpecificOutput":{additionalContext}}; silence
// emits nothing. Each case builds a fresh temp state dir (KIT_TRIPWIRE_STATE_DIR)
// and, where needed, a fake JSONL transcript, all cleaned up in finally blocks.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOK = path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'context-tripwire.js');

function makeDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmDir(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

function writeFile(full, contents) {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf8');
}

// Build a JSONL transcript whose newest main-chain assistant entry bills the
// given context tokens (split across the three usage fields the way the
// harness does). Row acceptance mirrors the engine, so a fixture carries a
// real model id unless a test overrides it to exercise the synthetic-row
// skip. Extra entries let a test bury the row under noise.
function usageEntry(contextTokens, { sidechain = false, model = 'claude-opus-4-8', usage } = {}) {
    const cacheRead = Math.max(0, contextTokens - 1002);
    return JSON.stringify({
        type: 'assistant',
        isSidechain: sidechain,
        message: {
            role: 'assistant',
            model,
            content: [{ type: 'text', text: 'working' }],
            usage: usage !== undefined ? usage : {
                input_tokens: 2,
                cache_read_input_tokens: cacheRead,
                cache_creation_input_tokens: 1000,
                output_tokens: 50
            }
        }
    });
}

function writeTranscript(full, entries) {
    writeFile(full, entries.join('\n') + '\n');
}

// Spawn the hook with a payload and a hermetic state dir; return parsed
// stdout (null when silent). KIT_EXTERNAL_ENGINE is stripped so a suite run
// inside an external engine's worker cannot silence the band tests; a test
// exercising that gate passes it back via extraEnv.
function runHook(payload, stateDir, extraEnv) {
    const env = { ...process.env, KIT_TRIPWIRE_STATE_DIR: stateDir, ...extraEnv };
    if (!extraEnv || !('KIT_EXTERNAL_ENGINE' in extraEnv)) delete env.KIT_EXTERNAL_ENGINE;
    const res = spawnSync(process.execPath, [HOOK], {
        input: typeof payload === 'string' ? payload : JSON.stringify(payload),
        encoding: 'utf8',
        env
    });
    assert.strictEqual(res.status, 0, 'hook must always exit 0');
    const out = (res.stdout || '').trim();
    if (!out) return null;
    return JSON.parse(out);
}

function contextOf(result) {
    assert.ok(result && result.hookSpecificOutput, 'expected hookSpecificOutput');
    assert.strictEqual(result.hookSpecificOutput.hookEventName, 'PostToolUse');
    return result.hookSpecificOutput.additionalContext;
}

function basePayload(overrides) {
    return {
        session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        tool_name: 'Bash',
        tool_input: { command: 'echo ok' },
        ...overrides
    };
}

// Arm a kit goal in the fixture project: the band tripwire's gate. Band tests
// arm it so their assertions exercise the band logic, not the gate.
function armGoal(work) {
    writeFile(path.join(work, '.kit', 'goal-state.json'),
        JSON.stringify({ plan: 'docs/plans/x_spec_v1.md' }));
}

// ---------------------------------------------------------------------------
// Band tripwire.
// ---------------------------------------------------------------------------

test('below the first band: silent', () => {
    const work = makeDir('tripwire-');
    try {
        armGoal(work);
        const transcript = path.join(work, 't.jsonl');
        writeTranscript(transcript, [usageEntry(150000)]);
        const result = runHook(basePayload({ transcript_path: transcript, cwd: work }), path.join(work, 'state'));
        assert.strictEqual(result, null);
    } finally { rmDir(work); }
});

test('crossing the first band fires once, with the billed token count', () => {
    const work = makeDir('tripwire-');
    try {
        armGoal(work);
        const transcript = path.join(work, 't.jsonl');
        writeTranscript(transcript, [usageEntry(210000)]);
        const stateDir = path.join(work, 'state');
        const payload = basePayload({ transcript_path: transcript, cwd: work });

        const first = contextOf(runHook(payload, stateDir));
        assert.match(first, /Context tripwire/);
        assert.match(first, /210,000/);

        const second = runHook(payload, stateDir);
        assert.strictEqual(second, null, 'same band must not fire twice');
    } finally { rmDir(work); }
});

test('a higher band fires again after an earlier nudge', () => {
    const work = makeDir('tripwire-');
    try {
        armGoal(work);
        const transcript = path.join(work, 't.jsonl');
        const stateDir = path.join(work, 'state');
        const payload = basePayload({ transcript_path: transcript, cwd: work });

        writeTranscript(transcript, [usageEntry(210000)]);
        assert.ok(runHook(payload, stateDir));

        writeTranscript(transcript, [usageEntry(320000)]);
        const again = contextOf(runHook(payload, stateDir));
        assert.match(again, /320,000/);
    } finally { rmDir(work); }
});

test('a context drop re-arms the band for the next climb', () => {
    const work = makeDir('tripwire-');
    try {
        armGoal(work);
        const transcript = path.join(work, 't.jsonl');
        const stateDir = path.join(work, 'state');
        const payload = basePayload({ transcript_path: transcript, cwd: work });

        writeTranscript(transcript, [usageEntry(210000)]);
        assert.ok(runHook(payload, stateDir), 'first climb fires');

        writeTranscript(transcript, [usageEntry(60000)]);
        assert.strictEqual(runHook(payload, stateDir), null, 'the drop itself is silent');

        writeTranscript(transcript, [usageEntry(250000)]);
        assert.ok(runHook(payload, stateDir), 'the re-climb fires again');
    } finally { rmDir(work); }
});

test('no armed goal: silent even above the band', () => {
    const work = makeDir('tripwire-');
    try {
        const transcript = path.join(work, 't.jsonl');
        writeTranscript(transcript, [usageEntry(500000)]);
        const result = runHook(
            basePayload({ transcript_path: transcript, cwd: work }),
            path.join(work, 'state')
        );
        assert.strictEqual(result, null);
    } finally { rmDir(work); }
});

test('an armed kit goal fires the contract nudge', () => {
    const work = makeDir('tripwire-');
    try {
        armGoal(work);
        const transcript = path.join(work, 't.jsonl');
        writeTranscript(transcript, [usageEntry(210000)]);
        const msg = contextOf(runHook(
            basePayload({ transcript_path: transcript, cwd: work }),
            path.join(work, 'state')
        ));
        assert.match(msg, /step-8 observations/);
        assert.match(msg, /relay probe/);
        assert.match(msg, /a conclusion, not an observation/);
    } finally { rmDir(work); }
});

test('an In Progress plan doc without an armed goal does not fire the band nudge', () => {
    const work = makeDir('tripwire-');
    try {
        writeFile(path.join(work, 'docs', 'plans', 'y_spec_v1.md'),
            '# Y\n\nStatus: In Progress\nCommit Model: Review-Only\n');
        const transcript = path.join(work, 't.jsonl');
        writeTranscript(transcript, [usageEntry(210000)]);
        const result = runHook(
            basePayload({ transcript_path: transcript, cwd: work }),
            path.join(work, 'state')
        );
        assert.strictEqual(result, null);
    } finally { rmDir(work); }
});

test('the validator still fires with no armed goal', () => {
    const work = makeDir('tripwire-');
    try {
        const result = runHook(basePayload({
            cwd: work,
            tool_name: 'Edit',
            tool_input: {
                file_path: path.join(work, 'docs', 'plans', 'p.md'),
                old_string: 'x',
                new_string: 'Compaction: context heavy; action: none'
            }
        }), path.join(work, 'state'));
        assert.match(contextOf(result), /without its required evidence/);
    } finally { rmDir(work); }
});

test('KIT_EXTERNAL_ENGINE silences the band nudge that fires without it', () => {
    const work = makeDir('tripwire-');
    try {
        armGoal(work);
        const transcript = path.join(work, 't.jsonl');
        writeTranscript(transcript, [usageEntry(210000)]);
        const payload = basePayload({ transcript_path: transcript, cwd: work });

        const unmarked = runHook(payload, path.join(work, 'state-a'));
        assert.match(contextOf(unmarked), /Context tripwire/,
            'without the marker this fixture must fire, or the gated run proves nothing');

        const marked = runHook(payload, path.join(work, 'state-b'), { KIT_EXTERNAL_ENGINE: '1' });
        assert.strictEqual(marked, null, 'an external engine worker never gets the band nudge');
    } finally { rmDir(work); }
});

test('the validator stays active under KIT_EXTERNAL_ENGINE', () => {
    const work = makeDir('tripwire-');
    try {
        const transcript = path.join(work, 't.jsonl');
        writeTranscript(transcript, [usageEntry(50000)]);
        const edit = (line) => basePayload({
            transcript_path: transcript,
            cwd: work,
            tool_name: 'Edit',
            tool_input: {
                file_path: path.join(work, 'docs', 'plans', 'p.md'),
                old_string: 'x',
                new_string: line
            }
        });

        const standDown = runHook(
            edit('Compaction: check not run: external engine owns continuation (fresh worker per section)'),
            path.join(work, 'state'), { KIT_EXTERNAL_ENGINE: '1' });
        assert.strictEqual(standDown, null, 'the stand-down line is evidence-bearing');

        const narrative = runHook(
            edit('Compaction: context heavy; engine will handle it; action: none'),
            path.join(work, 'state'), { KIT_EXTERNAL_ENGINE: '1' });
        assert.match(contextOf(narrative), /without its required evidence/,
            'the marker gates the nudge, not the evidence rule');
    } finally { rmDir(work); }
});

test('a subagent call is silent even above the band', () => {
    const work = makeDir('tripwire-');
    try {
        armGoal(work);
        const transcript = path.join(work, 't.jsonl');
        writeTranscript(transcript, [usageEntry(500000)]);
        const result = runHook(
            basePayload({ transcript_path: transcript, cwd: work, agent_type: 'claude-kit:implementer-opus' }),
            path.join(work, 'state')
        );
        assert.strictEqual(result, null);
    } finally { rmDir(work); }
});

test('synthetic, zero-usage, and garbage rows are skipped to the older real row', () => {
    const work = makeDir('tripwire-');
    try {
        armGoal(work);
        const transcript = path.join(work, 't.jsonl');
        // Newest-first noise: a garbage line, an API-error stub (synthetic
        // model), and an all-zero usage row all sit atop the real billed row.
        writeTranscript(transcript, [
            usageEntry(310000),
            usageEntry(0, { usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }),
            usageEntry(900000, { model: '<synthetic>' }),
            '{"this is not valid json'
        ]);
        const msg = contextOf(runHook(basePayload({ transcript_path: transcript, cwd: work }), path.join(work, 'state')));
        assert.match(msg, /310,000/, 'the older real row bills the band, not the noise');
    } finally { rmDir(work); }
});

test('the nested cache_creation usage shape is counted', () => {
    const work = makeDir('tripwire-');
    try {
        armGoal(work);
        const transcript = path.join(work, 't.jsonl');
        writeTranscript(transcript, [usageEntry(0, {
            usage: {
                input_tokens: 2,
                cache_read_input_tokens: 100000,
                cache_creation: { ephemeral_5m_input_tokens: 100000, ephemeral_1h_input_tokens: 50000 }
            }
        })]);
        const msg = contextOf(runHook(basePayload({ transcript_path: transcript, cwd: work }), path.join(work, 'state')));
        assert.match(msg, /250,002/);
    } finally { rmDir(work); }
});

test('a partial drop re-arms only the vacated bands', () => {
    const work = makeDir('tripwire-');
    try {
        armGoal(work);
        const transcript = path.join(work, 't.jsonl');
        const stateDir = path.join(work, 'state');
        const payload = basePayload({ transcript_path: transcript, cwd: work });

        writeTranscript(transcript, [usageEntry(450000)]);
        assert.ok(runHook(payload, stateDir), 'the first climb fires');

        writeTranscript(transcript, [usageEntry(350000)]);
        assert.strictEqual(runHook(payload, stateDir), null, 'the drop itself is silent');

        writeTranscript(transcript, [usageEntry(460000)]);
        assert.ok(runHook(payload, stateDir), 'a re-climb over the vacated band fires again');
    } finally { rmDir(work); }
});

test('sidechain usage rows are skipped: only the main chain bills the band', () => {
    const work = makeDir('tripwire-');
    try {
        armGoal(work);
        const transcript = path.join(work, 't.jsonl');
        // Newest entry is a huge sidechain row; the main chain sits below band.
        writeTranscript(transcript, [
            usageEntry(120000),
            usageEntry(900000, { sidechain: true })
        ]);
        const result = runHook(basePayload({ transcript_path: transcript, cwd: work }), path.join(work, 'state'));
        assert.strictEqual(result, null);
    } finally { rmDir(work); }
});

test('missing transcript, missing session id, or garbage stdin: silent, exit 0', () => {
    const work = makeDir('tripwire-');
    try {
        armGoal(work);
        const stateDir = path.join(work, 'state');
        assert.strictEqual(runHook(basePayload({ cwd: work }), stateDir), null);
        assert.strictEqual(runHook({ tool_name: 'Bash', tool_input: {} }, stateDir), null);
        assert.strictEqual(runHook('this is not json', stateDir), null);
        assert.strictEqual(runHook(basePayload({
            transcript_path: path.join(work, 'no-such.jsonl'), cwd: work
        }), stateDir), null);
    } finally { rmDir(work); }
});

// ---------------------------------------------------------------------------
// Compaction-line validator.
// ---------------------------------------------------------------------------

// A small transcript below every band, so validator tests isolate tooth 2.
function quietTranscript(work) {
    const transcript = path.join(work, 't.jsonl');
    writeTranscript(transcript, [usageEntry(50000)]);
    return transcript;
}

test('a narrative Compaction line in an Edit is flagged', () => {
    const work = makeDir('tripwire-');
    try {
        const result = runHook(basePayload({
            transcript_path: quietTranscript(work),
            cwd: work,
            tool_name: 'Edit',
            tool_input: {
                file_path: path.join(work, 'docs', 'plans', 'p.md'),
                old_string: 'x',
                new_string: 'Compaction: context heavy; interactive session actively driven; action: none.\nNext: U9'
            }
        }), path.join(work, 'state'));
        const msg = contextOf(result);
        assert.match(msg, /without its required evidence/);
        assert.match(msg, /context heavy/);
    } finally { rmDir(work); }
});

test('an evidence-bearing Compaction line passes', () => {
    const work = makeDir('tripwire-');
    try {
        const result = runHook(basePayload({
            transcript_path: quietTranscript(work),
            cwd: work,
            tool_name: 'Edit',
            tool_input: {
                file_path: path.join(work, 'docs', 'plans', 'p.md'),
                old_string: 'x',
                new_string: 'Compaction: 230,468 context tokens at close; relay armed; check: compact; action: relayed'
            }
        }), path.join(work, 'state'));
        assert.strictEqual(result, null);
    } finally { rmDir(work); }
});

test('the Chapter template placeholder is exempt', () => {
    const work = makeDir('tripwire-');
    try {
        const result = runHook(basePayload({
            transcript_path: quietTranscript(work),
            cwd: work,
            tool_name: 'Write',
            tool_input: {
                file_path: path.join(work, 'SKILL.md'),
                content: 'Compaction: <context tokens at close; relay armed|absent; check compact|skip|not run: reason; action compacted|relayed|deferred|none>'
            }
        }), path.join(work, 'state'));
        assert.strictEqual(result, null);
    } finally { rmDir(work); }
});

test('a reasoned "check not run" line passes without a number', () => {
    const work = makeDir('tripwire-');
    try {
        const result = runHook(basePayload({
            transcript_path: quietTranscript(work),
            cwd: work,
            tool_name: 'Edit',
            tool_input: {
                file_path: path.join(work, 'docs', 'plans', 'p.md'),
                old_string: 'x',
                new_string: 'Compaction: check not run: engine unavailable on this machine (no bun); relay absent; action: none'
            }
        }), path.join(work, 'state'));
        assert.strictEqual(result, null);
    } finally { rmDir(work); }
});

test('a Write of a narrative Compaction line into markdown is flagged', () => {
    const work = makeDir('tripwire-');
    try {
        const result = runHook(basePayload({
            transcript_path: quietTranscript(work),
            cwd: work,
            tool_name: 'Write',
            tool_input: {
                file_path: path.join(work, 'docs', 'plans', 'p.md'),
                content: '### Chapter 9\nCompaction: context heavy; action: none\nNext: U10\n'
            }
        }), path.join(work, 'state'));
        assert.match(contextOf(result), /without its required evidence/);
    } finally { rmDir(work); }
});

test('a non-markdown target is not validated', () => {
    const work = makeDir('tripwire-');
    try {
        const result = runHook(basePayload({
            transcript_path: quietTranscript(work),
            cwd: work,
            tool_name: 'Edit',
            tool_input: {
                file_path: path.join(work, 'test', 'fixture.test.js'),
                old_string: 'x',
                new_string: "const bad = 'Compaction: context heavy; action: none';"
            }
        }), path.join(work, 'state'));
        assert.strictEqual(result, null);
    } finally { rmDir(work); }
});

test('a reasonless "check not run" is flagged', () => {
    const work = makeDir('tripwire-');
    try {
        const result = runHook(basePayload({
            transcript_path: quietTranscript(work),
            cwd: work,
            tool_name: 'Edit',
            tool_input: {
                file_path: path.join(work, 'docs', 'plans', 'p.md'),
                old_string: 'x',
                new_string: 'Compaction: check not run; session actively driven; action: none'
            }
        }), path.join(work, 'state'));
        assert.match(contextOf(result), /without its required evidence/);
    } finally { rmDir(work); }
});

test('the engine field vocabulary passes in both phrasing directions', () => {
    const work = makeDir('tripwire-');
    try {
        const cases = [
            'Compaction: contextTokens 412338 per --check; recommendation: compact; relay armed; action: relayed',
            'Compaction: tokens: 412,338; recommendation: skip; relay absent; action: none',
            'Compaction: 412,338 context tokens at close; check: compact; relay armed; action: relayed'
        ];
        for (const line of cases) {
            const result = runHook(basePayload({
                transcript_path: quietTranscript(work),
                cwd: work,
                tool_name: 'Edit',
                tool_input: { file_path: path.join(work, 'docs', 'plans', 'p.md'), old_string: 'x', new_string: line }
            }), path.join(work, 'state'));
            assert.strictEqual(result, null, 'should pass: ' + line);
        }
    } finally { rmDir(work); }
});

test('an unanchored "skipping" narrative with an incidental number is flagged', () => {
    const work = makeDir('tripwire-');
    try {
        const result = runHook(basePayload({
            transcript_path: quietTranscript(work),
            cwd: work,
            tool_name: 'Edit',
            tool_input: {
                file_path: path.join(work, 'docs', 'plans', 'p.md'),
                old_string: 'x',
                new_string: 'Compaction: check: skipping the observations, section 12345 is interactive; action: none'
            }
        }), path.join(work, 'state'));
        assert.match(contextOf(result), /without its required evidence/);
    } finally { rmDir(work); }
});

test('a stray angle bracket does not buy the template exemption', () => {
    const work = makeDir('tripwire-');
    try {
        const result = runHook(basePayload({
            transcript_path: quietTranscript(work),
            cwd: work,
            tool_name: 'Edit',
            tool_input: {
                file_path: path.join(work, 'docs', 'plans', 'p.md'),
                old_string: 'x',
                new_string: 'Compaction: context <300K by rough estimate; action: none'
            }
        }), path.join(work, 'state'));
        assert.match(contextOf(result), /without its required evidence/);
    } finally { rmDir(work); }
});

test('MultiEdit edits are each inspected', () => {
    const work = makeDir('tripwire-');
    try {
        const result = runHook(basePayload({
            transcript_path: quietTranscript(work),
            cwd: work,
            tool_name: 'MultiEdit',
            tool_input: {
                file_path: path.join(work, 'docs', 'plans', 'p.md'),
                edits: [
                    { old_string: 'a', new_string: 'harmless text' },
                    { old_string: 'b', new_string: 'Compaction: context heavy; action: none' }
                ]
            }
        }), path.join(work, 'state'));
        assert.match(contextOf(result), /without its required evidence/);
    } finally { rmDir(work); }
});

test('validator works without a transcript or session id in the payload', () => {
    const work = makeDir('tripwire-');
    try {
        const result = runHook({
            tool_name: 'Edit',
            tool_input: {
                file_path: path.join(work, 'p.md'),
                old_string: 'x',
                new_string: 'Compaction: context heavy; action: none'
            }
        }, path.join(work, 'state'));
        assert.match(contextOf(result), /without its required evidence/);
    } finally { rmDir(work); }
});

test('band nudge and validator can combine into one injection', () => {
    const work = makeDir('tripwire-');
    try {
        armGoal(work);
        const transcript = path.join(work, 't.jsonl');
        writeTranscript(transcript, [usageEntry(410000)]);
        const result = runHook(basePayload({
            transcript_path: transcript,
            cwd: work,
            tool_name: 'Edit',
            tool_input: {
                file_path: path.join(work, 'p.md'),
                old_string: 'x',
                new_string: 'Compaction: context heavy; action: none'
            }
        }), path.join(work, 'state'));
        const msg = contextOf(result);
        assert.match(msg, /without its required evidence/);
        assert.match(msg, /Context tripwire/);
        assert.match(msg, /410,000/);
    } finally { rmDir(work); }
});
