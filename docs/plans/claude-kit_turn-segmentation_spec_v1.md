# Compact-Session Turn Segmentation: Bounded Summarization Plans for Autonomous Runs

Status: In Progress
Commit Model: Commit-and-Push
Run Mode: chain
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
- **Budget.** A named constant, `SEGMENT_TOKEN_BUDGET = 20_000` estimated tokens (chars/4 heuristic over row content), placed alongside the calibrated thresholds. Segment size does not affect summarizer input (the summarizer resumes the full analysis copy); it sets summary granularity: one summary of at most ~200 words per ~20k tokens of stretch. This is the tunable knob if S4 shows summaries too coarse or too fine.
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

Wire the splitter into `createPlan` (`compact.ts:105`), applied to `summarizedTurns` only, after slicing. Confirm and, where needed, adapt: `buildCompactedRows` emits one summary row per segment followed by that segment's tool-block rows; a summarizer-skipped segment degrades to verbatim via the existing per-entry path (`compact.ts:274`); segments after the first have empty `userRows` and the user-row copy loop is a clean no-op; `generateSummaries`' `nextTurn` anchor still comes from the first preserved real turn.

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

If summaries come back too coarse or too fine, tune `SEGMENT_TOKEN_BUDGET` (one axis per round) and note the final value in the Chapter.

### 5. Parse-failure response persistence
Model: sonnet

In `generateSummaries` (`compact.ts:131`), when `parseSummaries` throws, write the raw stdout to `~/.claude/magic-compact/debug/<source session id>-<ISO timestamp>.txt` before the error propagates, and append the file path to the thrown error's message so the CLI's `Compaction failed; source untouched: ...` line names it. Create the debug directory on demand. No rotation (failures are rare and files are small); no change to success paths.

Acceptance:
- A parse failure produces the debug file with the exact raw response and an error message naming the path.
- A successful parse writes nothing.

Tests: both directions - failure writes and names the file; success leaves no debug artifact.

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
