# Compact-Session Turn Segmentation: Bounded Summarization Plans for Autonomous Runs

Status: In Progress
Commit Model: Commit-and-Push
Run Mode: interactive (recorded override, decided 2026-07-18; see Chapter 1)
Fable Spend: S1 (implementer-fable), finishing reviews
Created: 2026-07-18

## Goal

The compact engine produces bounded, multi-pair summarization plans on autonomous transcripts, so a spec-with-Neo, then Opus, then `/kit-goal` run can compact at every section boundary instead of running uncompacted to the context ceiling. Today an unattended run's transcript collapses into a handful of mega-turns, the planner hands the summarizer a degenerate one-pair template, and the summarizer breaks the indexed-pair contract; compaction then fails at every boundary. The fail-safe holds (source untouched), but the run loses compaction entirely, which is exactly the workflow this kit is converging on.

## Root cause (confirmed by replay, 2026-07-18)

Reproduced against the failing session's real transcript (`NEO: Opus Work`, `12d49445`, 884 active rows) by replaying the engine's own planning code:

- `buildAssistantTurns` (`engine/transcript.ts:114`) opens a turn only at a human user row: `type === "user" && !isToolResultRow && isMeta !== true` (`transcript.ts:280`). The autonomous run had 203 user rows but only 8 human ones, yielding **3 turns** (one of 321 rows, one of 557).
- With the default `--keep 1`, `createPlan` produced prefix=1 (a prior compaction's `magicCompact` row), summarized=1, preserved=1, so `expectedCount = 1`, matching the field error `Summary index 2 is outside the 1 requested turns` exactly.
- The template (`buildXmlTemplate`, `engine/compact.ts:562`) therefore contained a single indexed pair; `parseSummaries` tolerates one extra trailing index and hard-throws at index >= 2 (`compact.ts:653`). The summarizer, asked for one ~200-word summary of a 321-row turn, emitted its own multi-pair numbering (inferred; the raw response is unrecoverable because the analysis copy is unlinked in a `finally`, `compact.ts:204`). Deterministic shape means an identical failure at all 11 attempts.

The strict over-range throw is load-bearing (an invented index cannot be anchor-verified) and stays. The defect is planner-side: entries of `summarizedTurns` are unbounded.

## Approach

A pure segment splitter applied to `summarizedTurns` inside `createPlan`, after the keep/prefix slices are computed on real (human-bounded) turns. Every downstream mechanism (indexed pairs, anchor cross-check, per-entry verbatim degradation, the more-than-half ceiling, the emission loop in `buildCompactedRows`) is keyed on "entries of `summarizedTurns`", so redefining an entry as a bounded segment heals the pipeline without parser changes and restores the multi-pair template regime verified at scale on 2026-07-15.

Key decisions:

- **Split point invariants.** A cut lands only before an assistant row that starts a new step; a `tool_use` is never separated from its `tool_result`; every segment contains at least one assistant row (the emission path requires `firstAssistant`, `compact.ts:293`); a single row exceeding the budget forms its own segment, never split internally.
- **Budget.** A named constant, `SEGMENT_TOKEN_BUDGET = 20_000` estimated tokens (chars/4 heuristic over each row's model-visible content), colocated with the splitter in `transcript.ts`. Segment size does not affect summarizer input (the summarizer resumes the full analysis copy); it sets summary granularity: one summary of at most ~200 words per ~20k tokens of stretch. This is the tunable knob if S4 shows summaries too coarse or too fine.

- **The budget has a hard floor, because segment count drives prompt argv length.** The summarizer prompt is passed as an argv element to `Bun.spawn` (`compact.ts:158`), and the template carries one indexed pair (~420 chars, dominated by the 300-char anchor) per segment. A ~925k-token transcript at a 20k budget yields ~46 pairs, roughly 22KB of argv, against the Win32 `CreateProcessW` ceiling of 32,767 characters. Halving the budget doubles the pair count and exceeds that ceiling, and the failure surfaces only as an opaque nonzero exit through `sanitizeSpawnOutput`. So S4 tunes the budget **downward only to about 15k** on Windows. Tuning below that requires first moving the prompt from argv to the spawn's stdin, which removes the ceiling entirely (and independently retires the unenforced "`claude` must resolve to a native executable" precondition documented at `compact.ts:154-157`). That move is out of scope here; it is the recorded escape hatch if S4 finds summaries genuinely need finer granularity.
- **Synthetic anchors.** Continuation segments have no user rows, and a blank anchor would trip the echo cross-check. Each continuation segment carries a deterministic anchor: `(continuation N) ` plus a snippet derived from the segment's first assistant text block (fallback: its tool names, e.g. `(tool activity: Bash, Read)`), run through the same normalization/truncation as `getUserPromptText` (whitespace-collapse, angle-bracket strip, 300 chars). The prefix guarantees anchor uniqueness by construction; the 2026-07-15 effort showed degenerate anchors are how summaries silently merge.
- **Keep semantics unchanged.** `--keep N` still counts real human-bounded turns; splitting happens only within the already-selected `summarizedTurns`. Prefix and preserved turns are never segmented.
- **Template wording.** The prompt gains one rule explaining segment pairs (a long stretch may be split; each indexed pair covers the slice anchored by its snippet; `(continuation N)` anchors mark split points and must be echoed like any anchor). Prompt wording is behavior-shaping for the summarizer model; S4's live run is its baseline test (writing-skills discipline).
- **Diagnosability.** On a `parseSummaries` throw, the raw summarizer response is persisted to a debug file before the error propagates, so the next field failure is evidence, not inference. (The field failure's raw responses were deleted by the `finally` unlink, which is why part of the mechanism above is inferred.)
- **No retry loops** (2026-07-15 wild evidence: retries got worse). `prune.ts`, `omission.ts`, `retrieve.ts` stay vendored-verbatim.

## Sections of Work

### 1. Segment splitter and anchor override
Model: fable

A pure function (new `engine/segment.ts` or colocated in `transcript.ts`, implementer's call) that maps `Turn[]` to segment pseudo-turns honoring the invariants above, plus the `Turn` type extension for an anchor override that `getUserPromptText` (`compact.ts:603`) honors. No wiring into `createPlan` yet (S2). Unit tests over synthetic row fixtures.

Acceptance:
- A turn under budget passes through unchanged (identity, not a copy with drift).
- An oversized turn splits at step boundaries only; reassembling segment rows in order reproduces the original turn's rows exactly (no loss, no reorder, no duplication).
- No segment separates a `tool_use` from its `tool_result`; every segment has at least one assistant row; a single oversized row becomes its own segment.
- Continuation anchors are deterministic (same input, same anchors), unique within the turn, and normalized like `getUserPromptText` output.

Tests: lock the invariants in both directions - a fixture that must split and one that must not; a tool_use/tool_result pair straddling the budget line stays together even when that overshoots the budget; determinism asserted by double-run equality. The expensive failure is a silent row drop or reorder, so the reassembly check is the non-negotiable test.

### 2. Plan integration and emission guarantees
Model: opus

Wire the splitter into `createPlan` (`compact.ts:105`), applied to `summarizedTurns` only, after slicing. The ordering is load-bearing, not stylistic: `createPlan` slices `turns` by **count** for both `--keep N` and `compactionStartIndex`, so splitting before the slice would silently redefine `--keep N` from "keep N turns" to "keep N segments" and change the preserved tail. Two further confirmations before wiring: the first assistant row of a segment is emitted twice by design (once as the summary row at `compact.ts:298`, once as a tool-block-only row by the loop at `compact.ts:309`, since `turn.userRows` is empty for continuation segments and cannot exclude it), which is how a step-opening `tool_use` survives summarization, and this goes from rare to routine for continuation segments because such a segment opens on a step boundary by construction. Confirm and, where needed, adapt: `buildCompactedRows` emits one summary row per segment followed by that segment's tool-block rows; a summarizer-skipped segment degrades to verbatim via the existing per-entry path (`compact.ts:274`); segments after the first have empty `userRows` and the user-row copy loop is a clean no-op; `generateSummaries`' `nextTurn` anchor still comes from the first preserved real turn.

Acceptance:
- A synthetic fixture reproducing the field shape (3 human turns, one oversized, keep 1) plans to `expectedCount > 1` with bounded segments instead of 1 mega-entry.
- A compacted transcript built from a segmented plan has every original tool row present exactly once, parent-chained, in order.
- Skipped-segment verbatim degradation round-trips (unit test with a summaries map missing one segment index).

Tests: at minimum, lock the per-segment verbatim degradation and the tool-row completeness of the emitted transcript; the risk is a segment boundary corrupting the parent-uuid chain, which would surface only at resume time.

### 3. Template wording and parse-path regression tests
Model: opus

The one added template rule (segment pairs and `(continuation N)` anchors) in `buildCompactionPrompt`/`buildXmlTemplate`, and a synthetic mega-turn fixture (small, constructed; the 3.2MB real transcript never enters the repo) exercising the full plan-to-template-to-parse path with a mocked summarizer response.

Acceptance:
- The degenerate autonomous shape (1 human turn to summarize, many rows) renders a template with N indexed pairs and per-segment anchors.
- `parseSummaries` is unchanged; existing parser tests pass with zero edits (parser-side diff is empty).
- A mocked compliant response maps summaries to the right segments; a mocked response that skips one segment degrades that segment verbatim.

### 4. Live-fire verification
Model: opus

End-to-end against the real failing transcript. Copy `C:\Shared\Transcripts\D--Neuro-Evolution-Operations\12d49445-fd35-4d1f-b9e1-c7a26795966c.jsonl` into a throwaway project dir under `~/.claude/projects/` (cwd rules per `compact-cli.ts:60-71`).

Protocol:
1. **Red baseline:** run the pre-fix engine (the commit before S1 landed, via a temporary `git worktree`; do not rely on the installed plugin cache, whose version depends on when plugins were last updated) with `compact-cli --force` against the copy; it must fail with the exact `Summary index N is outside the M requested turns` error. This proves the harness exercises the failing path.
2. **Green:** run the repo engine (post-fix) the same way; it must produce a compacted destination, with segment summary rows present and the ledger entry written.
3. **Coherence check:** open the compacted transcript and confirm the summarized stretch reads as ordered segment summaries with tool rows intact; resume the destination session headlessly (`claude -p --resume <destination id>` with a trivial prompt) to confirm the CLI accepts it.

Billing: each live run spends one sonnet summarizer call (subscription-billed, `DEFAULT_SUMMARIZER_MODEL = claude-sonnet-5`); expect 2-4 calls total. Cleanup: remove the throwaway project dir, its `~/.claude/magic-compact/` cache entries, any analysis-copy transcripts, and the temporary worktree; name the cleanup in the Chapter.

If summaries come back too coarse or too fine, tune `SEGMENT_TOKEN_BUDGET` (one axis per round) and note the final value in the Chapter. Downward tuning stops at about 15k: below that the template's per-segment pairs push the summarizer prompt past the Win32 argv ceiling (see the budget-floor decision above). Capture the rendered template's character count alongside the coherence check so the headroom is measured rather than assumed.

### 5. Parse-failure response persistence
Model: sonnet

In `generateSummaries` (`compact.ts:131`), when `parseSummaries` throws, write the raw stdout to `~/.claude/magic-compact/debug/<source session id>-<ISO timestamp>.txt` before the error propagates, and append the file path to the thrown error's message so the CLI's `Compaction failed; source untouched: ...` line names it. Create the debug directory on demand. No rotation (failures are rare and files are small); no change to success paths.

Acceptance:
- A parse failure produces the debug file with the exact raw response and an error message naming the path.
- A successful parse writes nothing.

Tests: both directions - failure writes and names the file; success leaves no debug artifact.

## Standing Brief Amendments

Folded into every later dispatch brief for this effort.

- **When writing a helper that reads transcript row content, name the existing sibling readers and require handling every content shape they handle.** `message.content` is a string on some rows and a block array on others, and attachment rows carry their payload outside `message` entirely. The engine's existing readers are `getUserText` (`compact.ts`, handles the string form) and `pruneTranscriptRow` (`prune.ts`, same). A generic "mirror the sibling's breadth" instruction is not enough: S1 produced two separate shape gaps, one where a sibling existed and was not consulted, and one where no sibling existed at all and only reading a real transcript surfaced it.

- **A new heuristic that measures transcript rows gets checked against a real transcript before it is trusted.** S1's token estimator scored attachment rows at zero; only inspecting actual `.jsonl` rows (up to 14,555 chars each) revealed it. Reading the code cannot surface an omitted row shape.

## Out of Scope

- Parser changes: the indexed-pair contract, over-range throw, sparse fallback, and anchor cross-check are untouched (S3 asserts a zero parser diff).
- The `expectedCount === 1` merge leniency (option B from the diagnosis): rejected in favor of this fix; segmentation makes the one-pair template unreachable for oversized turns.
- Retry loops on summarizer failure.
- CLI flag surface (`--segment-budget` and similar): the budget is a constant.
- `prune.ts`, `omission.ts`, `retrieve.ts`: vendored-verbatim.
- `buildAssistantTurns` turn-boundary semantics: human-bounded turns remain the unit of `--keep` and of prefix/preserved handling.

## Open Questions

- `SEGMENT_TOKEN_BUDGET` final value: 20k is the starting point; S4 calibrates. Owner: executing session, with Scott on a material change.

## Related

- Extends `docs/archive/claude-kit_summarizer-robustness_spec_v1.md` (2026-07-15): that effort fixed the interactive degeneracy (byte-identical anchors merging summaries) with indexed pairs and the anchor cross-check; this one fixes the autonomous degeneracy (too few turns) by bounding plan entries. Same contract, opposite corner.
- Engine origin and architecture: `docs/archive/claude-kit_compact-session_spec_v1.md`.
- Thresholds and ROI calibration: `docs/archive/claude-kit_compaction-tuning_spec_v1.md`.
- The workflow this serves: `docs/archive/claude-kit_goal-continuity_spec_v1.md` (`/kit-goal` runs).

## Chapters

(Appended by executing-work as sections complete.)

### Chapter 1 - 2026-07-18
Completed: 1. Segment splitter and anchor override
Implemented By: implementer-fable (build round, then a consolidated review-fix round); main session (attachment-row budget fix, inline under the too-small rule)
Metrics: 1 review round (adversarial + blind + security, all three dispatched together); 0 NEEDS_CONTEXT; 0 escalations; advisor off (Opus-led session)
Decisions / Surprises: **Run Mode substituted, chain to interactive** (Scott's call at the section-loop entry, recorded in the header). Chain's only benefit at a boundary is compaction, and this plan's own diagnosis is that autonomous transcripts fail to compact until S2 wires the splitter in, so chain would have spawned headless workers for no compaction gain while removing Scott from the S4 calibration call. **Splitter colocated in `transcript.ts`**, not a new `segment.ts`: it needs the module-private `isToolResultRow` and `getMessageId`, and a second copy of the tool-result predicate is exactly the drift that produces silent row misclassification. **Anchor numbering is plan-global, not per-turn.** The spec's "unique within the turn" was satisfiable literally while leaving the real property broken: `parseSummaries` receives one flat anchor array spanning all of `summarizedTurns` (`compact.ts:203`) and `anchorsAgree` compares 40 characters, so two oversized turns each emitting `(continuation 1) <same repetitive assistant opener>` would verify against each other and defeat the renumber-and-drop guard the 2026-07-15 effort exists to provide. `splitOversizedTurns` now runs one counter across its whole input list, which is exactly the collision domain. **Tool-pair cohesion is enforced, not assumed:** the first implementation rested on an argument about active-chain row ordering; `buildStepChunks` now tracks unresolved `tool_use` ids and refuses a cut while any is pending, so the invariant holds regardless of ordering. **New constraint discovered, recorded against S4:** segment count drives summarizer prompt argv length, and a ~925k-token transcript at a 20k budget renders ~22KB against the 32,767-char Win32 ceiling, so the budget floor is ~15k and tuning below it requires moving the prompt to stdin first (new "budget has a hard floor" decision). **Real-transcript check caught what code reading could not:** `estimateRowTokens` scored attachment rows at zero because they carry their payload outside `message`; measured attachment rows in live transcripts run to 14,555 chars (~3.6k estimated tokens), so a stretch of them would have overrun the budget unmeasured. Fixed inline with a watched-red test. Both shape gaps became Standing Brief Amendments.
Review Findings: Blind's sole Critical (`splitOversizedTurns` has no production call site) **rejected**: correct as an observation, wrong as a defect, since S1 was scoped to the splitter and tests with wiring deferred to S2. Its embedded warning about `--keep N` count-slicing was kept and written into S2. Six Majors fixed: plan-global anchor numbering; `continuationSnippet` returning empty or ignoring string-form `message.content`; asserted-not-enforced tool-pair cohesion; and the test-coverage gaps that let all three pass green (`anchorsAgree` exported so tests assert the real predicate rather than raw slice inequality). Security's trust-class Major (assistant text and tool names now reach the prompt argv, where previously only human user rows did) accepted with mitigation: the snippet is capped at 400 chars, and the reviewer independently confirmed the XML-injection guarantee genuinely holds (the `[<>]` strip runs before the 300-char slice, so truncation cannot reconstitute a partial tag). Minors fixed: token estimate measuring envelope fields, double serialization, `anchorOverride` dropped from segment 0, spread-arg `RangeError` risk, O(n squared) tool-name accumulation, and two tests that could not fail. Minor declined: moving `SEGMENT_TOKEN_BUDGET` to `compact-cli.ts` alongside the other calibrated thresholds, which would invert the import direction; it stays with its consumer and the spec's Budget decision now says so.
Verification: gate re-run by the controller, not taken on report. Baseline 24 pass / 0 fail at `3c94671`; final **40 pass / 0 fail**, +16 tests, zero regressions. Every fix carries a watched red: the implementer ran seven mutation checks (per-turn numbering, string-content handling, empty-snippet fallback, unresolved-tool_use guard, missing-id fallback, packing order, and an injected `Math.random()` against the determinism test) and the controller ran an eighth for the attachment fix, each failing only its target test before restore. `parse-summaries.test.ts` unedited; `parseSummaries` byte-unchanged, so S3's zero-parser-diff assertion remains reachable.
Compaction: 168,180 context tokens at close; relay armed; check `skip` (below the 200,000 trigger: "compaction is allowed but not yet worth interrupting for"); action none.
Next: 2. Plan integration and emission guarantees
Commit Model: Commit-and-Push
