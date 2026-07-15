# Compaction Tuning: Trigger, Guard, and Ledger

- **Status:** Complete
- **Run Mode:** interactive
- **Commit Model:** Review-Only
- **Fable Spend:** Fable-led session; sections built inline in the main thread.
- **Decided:** 2026-07-10, from the transcript-corpus ROI analysis (below).

## Why

A measurement pass over 55 sessions / 6,295 deduplicated API calls (transcripts from the NEO and Eleos machines, analyzed 2026-07-10) found:

- 92% of all estimated spend was billed on calls carrying >150k context. The most expensive sessions coasted at 500-560k average context on the 1M window with no compaction of any kind.
- Every production compaction fired at 500-650k context, hundreds of calls too late. Each big event still returned roughly 3-5x its cost (measured deltas 480-590k, 95-133 post-compaction calls).
- Post-compaction floors measured 50-57k. Compactions with small deltas were break-even to negative: one Eleos chain event compacted at 171k and the first post-compaction call was already back at 198k.

Conclusion: compaction pays when the delta is large and work continues; it burns when fired small or late. The skill needs a numeric trigger, a skip guard, and a ledger so the thresholds stay tunable against real data.

## Thresholds (the tunable knobs)

Both constants live at the top of `plugins/claude-kit/skills/compact-session/engine/compact-cli.ts`:

- `CHECK_TRIGGER_TOKENS = 200_000`: at or above this, `--check` recommends compacting. Rationale: on the 1M window there is no harness pressure before ~1M, and every call above 200k is 3-5x floor cost; 200k also clears the 5-minute-gap cache-rewrite cliff (a cold re-write at 650k costs ~11x one at 57k).
- `MIN_COMPACTION_CONTEXT_TOKENS = 150_000`: below this, a compaction run exits 2 without spawning the summarizer. Rationale: observed floor 50-57k plus the ~100k minimum delta that separated paying events from break-even ones. Overrides: `--min-context <tokens>` per run, `--force` to bypass entirely.

"Few calls remain" (the other half of the skip decision) is not machine-checkable; it stays prose in the skills: savings accrue only from calls that follow, so a boundary that ends the run does not earn a compaction.

## Sections of Work

### 1. Engine: check mode, skip guard, ledger - tier: fable (inline)

Files: `engine/compact-cli.ts` (kit-owned), new `engine/ledger.ts` (kit-owned), `engine/ATTRIBUTION.md` (file list and delta notes). `transcript.ts`, `prune.ts`, `omission.ts` stay untouched. `compact.ts` takes one deliberate delta beyond the original plan (deviation, adjudicated in Chapter 1): a failed summarizer spawn surfaces its stdout tail, sanitized and capped, when stderr is empty. Rationale: the live-fire on 2026-07-10 failed with an empty reason because the CLI reports "Not logged in" on stdout; an engine whose failures are mute cannot be tuned. Reversal cost: delete `sanitizeSpawnOutput` and restore the stderr-only message.

- `engine/ledger.ts` exports:
  - `readLastMainChainUsage(transcriptPath)`: last non-sidechain assistant row with real billed usage (skips synthetic-model rows); returns `{ contextTokens, model, timestamp }` or null. Context = input + cache_read + cache_creation tokens.
  - `appendLedgerEntry(entry)`: appends one JSON line to `~/.claude/magic-compact/ledger.jsonl`.
- `compact-cli.ts`:
  - `--check`: prints JSON `{ status: "check", contextTokens, model, measuredAt, trigger, minContext, recommendation: "compact" | "skip", reason }`, exits 0 (a transcript with no billed usage rows exits 1: nothing to measure). Runs before the cwd guard (no summarizer is spawned, so project-scoped resolution is not in play).
  - Skip guard: before creating the destination, read last main-chain usage; if below the minimum, exit 2 with the reason on stderr (same contract as the existing nothing-to-compact exit). `--force` bypasses; `--min-context <tokens>` overrides the constant.
  - Ledger write on success, best-effort (a ledger failure warns on stderr, never fails the compaction): `{ timestamp, sourceSessionId, destinationSessionId, project, contextBeforeTokens, model, keepTurns, sourceTranscriptBytes, destinationTranscriptBytes, durationMs }`. `contextBeforeTokens` and `model` are null when unmeasured (a `--force` run on a transcript with no billed rows), never a sentinel a reader could mistake for data. Context-after is not knowable at write time; analysis joins the destination transcript's first new usage row.

Acceptance: low-context transcript exits 2 with reason; `--force` proceeds past the guard; `--check` reports correct context on a real transcript (cross-checked against the transcript's last usage row by hand); a real compaction appends exactly one well-formed ledger line.

### 2. Skill updates - tier: fable (inline)

- `compact-session/SKILL.md`: "When to compact" gains the numeric trigger (200k) and the guard semantics (engine skips below 150k; savings come only from calls that follow, so a run-ending boundary earns no compaction). "Invocation" documents `--check`, the new exit-2 reason, and the flags. "Housekeeping" documents the ledger (metadata only, no conversation content; it is the tuning feed for these thresholds).
- `executing-work/SKILL.md` step 8: the compaction point becomes check-gated: run `--check` at the section close and compact on a "compact" recommendation, instead of compacting every section boundary unconditionally (the observed generator of break-even micro-compactions in the Eleos chains).

Per writing-skills: conditionals on an observable predicate (the check's JSON), no nuance clauses.

Acceptance: both skills state the trigger and guard as conditionals on the check output; descriptions unchanged (triggers, not workflow).

### 3. Verification - tier: fable (inline)

Crafted-transcript guard tests both directions, `--check` on real transcripts, one live-fire compaction of a superseded kit-repo session (2f5494be, a4efcfde, or c189bc78 from 2026-07-08) run from this repo so cwd/project resolution is real, ledger line inspected field by field. Live-fire side effects to name at close-out: source session relabeled `[UNCOMPACTED]`, one new destination session, one ledger line, Sonnet summarizer spend.

## Related

- `claude-kit_compact-session_spec_v1.md` (archive sibling): the effort that vendored the engine this one tunes.
- `claude-kit_resume-relay_spec_v1.md` (archive sibling): the unattended `/resume` these thresholds gate.
- `claude-kit_summarizer-robustness_spec_v1.md` (archive sibling, 2026-07-15): fixed the summarizer contract these thresholds feed into; the thresholds themselves are unchanged by it.

## Chapters

### Chapter 1: Engine (2026-07-10)

Shipped in this changeset: `engine/ledger.ts` (new), `--check` / skip guard / ledger wiring in `engine/compact-cli.ts`, the `compact.ts` error-surfacing delta, `ATTRIBUTION.md` updates. Commit model: Review-Only (all changes staged, nothing committed).

- **Deviation (adjudicated):** `compact.ts` was spec'd untouched but took one delta. The first live-fire failed with an empty error because the CLI reports "Not logged in" on stdout and upstream surfaces stderr only. Fixed to surface whichever stream carries the reason, sanitized (control sequences stripped, 500-char cap on both streams, per security review). Spec section 1 amended; recorded in `ATTRIBUTION.md`.
- **Surprise:** this workstation's CLI has no standalone login (Desktop local agent mode authenticates through the host), so the summarizer cannot run here. `--check` and the guard need no login and are unaffected. Added as a SKILL.md prerequisite.
- **Evidence:** `--check` on a real 3MB transcript returned 450,511 tokens, matching an independent Node reading of the same usage row exactly, and works cwd-free on a foreign project's transcript. Guard: 41,150-token crafted transcript exits 2 with the skip reason; `--force` proceeds past the guard. End-to-end with a stub summarizer (compiled stand-in `claude.exe` emitting a valid summary block): compaction succeeds, destination transcript carries boundary notice and summary row, ledger line correct field by field (context 41,150; matching session IDs; byte sizes; duration). Full matrix re-run green after review fixes.
- **Unverified on this machine:** real-summarizer-plus-ledger in one run (blocked by CLI login). The summarizer spawn path itself is unchanged by this effort and was live-fire verified 2026-07-08. First real compaction on a logged-in machine (ASR or the sandbox VM) confirms it end to end; the ledger line is the receipt to check.

### Chapter 2: Skills (2026-07-10)

Shipped in this changeset: `compact-session/SKILL.md` (numeric trigger and guard in "When to compact", `--check` and flags in "Invocation", check-gated chain-mode steps 2-3, ledger in "Housekeeping", CLI-login prerequisite) and `executing-work/SKILL.md` step 8 (check-gated compaction point, interactive offer also check-gated). Frontmatter descriptions untouched per writing-skills. The rule that matters most (no sub-150k compaction) is enforced mechanically by the engine, so a session that skims the prose still cannot burn a micro-compaction without `--force`.

### Chapter 3: Verification, reviews, close-out (2026-07-10)

- Adversarial review: APPROVED_WITH_CONCERNS. The one Major (spec-vs-tree drift on `compact.ts`) adjudicated as a recorded deviation (Chapter 1). Minors fixed: `runCheck` comment and SKILL.md now state the no-usage-rows exit-1 branch; ledger fields `contextBeforeTokens`/`model` are null when unmeasured instead of 0/"unknown" sentinels; unused `ledgerPath()` export deleted; spec em dashes replaced; `measuredAt` added to the spec's check JSON shape. Accepted as-is: whole-file transcript read in `readLastMainChainUsage` (matches the engine's existing pattern; revisit only if check latency shows).
- Security review: CLEAR, three Minors. Fixed: control-sequence stripping and caps on spawn output in errors; model string validated against `^[A-Za-z0-9._:-]{1,64}$` with null fallback. Accepted risk, on record: `--check` reads any path the operator names (single-user local tool; the cwd guard is a correctness gate, not a security boundary).
- Test residue cleaned: stub-run ledger lines and omission caches deleted (`~/.claude/magic-compact` left empty), three session files from failed auth probes removed from the kit project dir. The engine's own failure paths cleaned up after themselves in every observed failure (analysis copies unlinked, destinations deleted).
- Thresholds live at the top of `engine/compact-cli.ts` (`CHECK_TRIGGER_TOKENS = 200_000`, `MIN_COMPACTION_CONTEXT_TOKENS = 150_000`); the ledger at `~/.claude/magic-compact/ledger.jsonl` is the evidence feed for retuning them.
