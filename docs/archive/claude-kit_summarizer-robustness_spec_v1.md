# Compact-Session Summarizer Robustness: Indexed Pairs and Sparse Fallback

Status: Complete
Commit Model: Commit-and-Push (authorized by Scott at close-out)
Completed: 2026-07-15
Run Mode: interactive
Fable Spend: main-session implementation (Fable-led session); reviews at session model
Created: 2026-07-15

## Goal

The compaction engine's summarizer contract survives real orchestrator transcripts. Today it fails on them nearly every time with "Expected N summaries, received M user/assistant pairs", which breaks compact-session exactly where it matters most (large interactive sessions), leaving native lossy auto-compaction as the only relief at 1M tokens.

## Root cause (confirmed by live reproduction, 2026-07-15)

The summarizer prompt anchors each summarized turn by the first line of its user text (`getUserPromptText`, first line only, capped at 300 chars). In orchestrator sessions, most turn boundaries are background-task notifications whose first line is the constant string `<task-notification>` (the distinguishing task-id sits on line 2). In the wild-failing transcript (`eafbf6a9`, 925k context), 21 of 26 anchors are byte-identical. The model must echo one `<user>`/`<assistant>` pair per anchor, in order, in exact count; with degenerate anchors it merges or drops a few (live repro: 23 of 26; wild: 24, then 21 on retry). The engine's exact-count check then correctly refuses, because positional mapping with degenerate anchors cannot prove which summary belongs to which turn. Chain workers (distinctive human-authored prompts per turn) compacted 6-for-6 on 2026-07-10; interactive sessions fail. Evidence: `.kit/scratch/repro-anchors.json`, `repro-response.txt`, `repro-pairing.txt`; harness `.kit/scratch/summarizer-repro.ts`.

## Design (Option A, approved by Scott 2026-07-15)

Three coordinated changes, all in `plugins/claude-kit/skills/compact-session/engine/compact.ts`:

1. **Indexed pairs.** The template emits `<user index="N">` and `<assistant index="N">` per summarized turn (trailing next-turn anchor stays unindexed). The parser pairs by explicit index, making misalignment structurally impossible and echo trivially checkable. Prompt guidelines updated to require echoing the index attributes.
2. **Sparse fallback.** `parseSummaries` returns a sparse index-to-summary map. A turn whose summary is missing is preserved verbatim in the destination (same row-copy path as `preservedTurns`) with a stderr warning naming the skipped turn indices. Hard-fail remains when more than half the requested summaries are missing or any index duplicates or falls out of range (garbage-response defense). If the response contains no indexed pairs at all, fall back to the legacy positional pairing with the legacy exact-count requirement (a model that ignores attributes still works exactly as today).
3. **Distinguishable anchors.** `getUserPromptText` uses the first 300 chars of the whole user text, whitespace-normalized, instead of first-line-only, so task-ids and other line-2 content make anchors unique.

Out of scope: `prune.ts`/`omission.ts`/`retrieve.ts` stay vendored-verbatim; no CLI flag changes; no retry loops (wild evidence: retries got worse).

## Sections of Work

### 1. Engine fix, tests, live verification
Model: fable (inline; in-flight debugging chain, main thread implements)
Files: `plugins/claude-kit/skills/compact-session/engine/compact.ts`, `tools/engine-tests/parse-summaries.test.ts` (new), `plugins/claude-kit/skills/compact-session/SKILL.md` (only if it states the old contract).

Tests: `bun test tools/engine-tests/` green, covering: fully-indexed response; sparse response (3 of 26 missing) accepted with the missing indices reported; over-half-missing throws; duplicate index throws; out-of-range index throws; no `<summary>` block throws; unindexed legacy response accepted at exact count and rejected on mismatch; anchor builder produces distinct anchors for task-notification rows. Live gate: `bun compact-cli.ts --transcript <repro copy of eafbf6a9> --keep 1` succeeds end-to-end on the exact transcript that failed twice in the wild (destination transcript parses, contains summary rows and any preserved-verbatim turns, boundary row first). Parser exports: `parseSummaries` (and the anchor builder) become named exports for the test file.

### 2. Relay default and doctor resume round-trip check (added mid-effort per Scott)
Model: opus
Files: `plugins/claude-kit/skills/compact-session/relay/arm-resume-relay.ps1`, `plugins/claude-kit/skills/compact-session/relay/resume-relay.ahk` (added in the review round: the watcher enforces the safety the default removes), `plugins/claude-kit/doctor/doctor.ps1`, `plugins/claude-kit/skills/kit-doctor/SKILL.md` (only if it enumerates checks).

The resume relay is the last link in unattended interactive continuation (engine compacts, compact-session writes request.txt, the watcher types /resume), and it shipped requiring manual window.txt configuration. Changes: the arm script writes the default `ahk_exe WindowsTerminal.exe` when window.txt is absent (with the multiple-WT-windows caveat printed); kit-doctor gains a true round-trip probe using the watcher's dryrun.on flag (create flag, write a synthetic request, poll relay.log for the DRYRUN line, clean up), with the dryrun-before-request ordering as a hard safety invariant and every error path a WARN that leaves no request behind.

Tests: doctor.cmd on this machine reports the round-trip PASS with the armed relay; WARN with window.txt renamed away; file restored. PowerShell 5.1 compatible.

## Related

- `docs/backlog.md`: "Compaction engine defect: summarizer count mismatch" (this effort resolves it), "200k gate follow-up" (this defect was why the gate's one recommendation failed).
- `docs/archive/claude-kit_compaction-tuning_spec_v1.md`: thresholds this effort leaves untouched.

## Chapters

### Chapter 1 - 2026-07-15
Completed: Section 1 - Engine fix, tests, live verification
Implemented By: main session (Fable, in-flight debugging chain)
Metrics: 2 review rounds (round 1: adversarial APPROVED_WITH_CONCERNS 1 Major + 3 Minor, blind CHANGES_REQUIRED 2 Major + 3 Minor; round 2 fixes applied in-session, gate re-run); 0 NEEDS_CONTEXT; 0 escalations; advisor n/a (Fable-led session). Security review waived for this section: the changed surface is model-output parsing into transcript text (pre-existing trust path, output already sanitized and capped) and a timeout constant; the spawn stays argv-array with tools denied and hooks off. Unit gate: bun test 20/20 (was 13, +7 for review findings). Live gate: the wild-failing 933k-token transcript (`eafbf6a9`) compacted end-to-end TWICE (once pre-review-fixes, once on final code), 26/26 summaries both runs, destination 1604 rows / 1 boundary / 26 summary rows, 11.6MB to 2.3MB, ~249s.
Decisions / Surprises: (1) A SECOND defect surfaced during verification: `SUMMARIZER_TIMEOUT_MS` was 240s while this compaction measurably needs ~250s, so the engine timed out with an empty error reason ("Summary generation failed:"); raised to 600s with a timeout-aware error naming exit code and elapsed seconds. Tonight's first live failure was this timeout, not the count contract. (2) The indexed template + distinct anchors made the summarizer return complete sets in both live runs; the sparse preserve-verbatim fallback has therefore never executed live and is covered by a direct buildCompactedRows unit test instead. (3) `buildCompactedRows`, `parseSummaries`, `getUserPromptText`, and the `Plan` type became exports for testability.
Review Findings (adjudicated): blind Major 1 (trailing extra pair at index N hard-failed an otherwise-correct response) FIXED, tolerated and pinned; blind Major 2 (hybrid indexed-user/plain-assistant response fell through both parse paths) FIXED, attribute-tolerant positional fallback, pinned; adversarial Major (renumber-plus-drop stays in range and misattributes every summary, refuting the spec's "structurally impossible" claim) FIXED via echoed-anchor cross-check: sparse sets require every present pair's anchor to verify, complete sets verify where echoed, renumbered responses throw, pinned; adversarial Minor (anchor text is untrusted and whole-text anchors widen the tag-injection surface) FIXED, angle brackets stripped in the anchor builder, template and echo transform identically, pinned; both reviewers' Minor (0-based singular warning) FIXED, 1-based with the permanence consequence named; blind Minor (a skipped turn landing before this compaction's summary rows is never re-summarized later) ACCEPTED as documented behavior, named in the warning text, redesigning createPlan's boundary semantics judged out of scope; blind/adversarial Minor (sparse path untested) FIXED with the buildCompactedRows test.
Scope note: `compact-session/SKILL.md` line 45 updated (240s to 600s, plus scale note); the Haiku-summarizer sentence there was reframed to lead with summary quality, since the 2026-07-08 "3/3 distinct failures" evidence describes the pre-indexed contract and does not distinguish counting from structural failures (Scott's read that it was likely the same counting defect is plausible but unconfirmed from the archived record).
Preserve-contract checks: fail-safe containment intact (both wild-style failures tonight left the source untouched); legacy positional path byte-equivalent for attribute-free responses at exact count (pinned); `--check`/skip-guard thresholds untouched; prune/omission/retrieve vendored files untouched.
Next: Section 2 (relay default + doctor round-trip), dispatched.
Commit Model: Commit-and-Push (authorized at close-out)

### Chapter 2 - 2026-07-15
Completed: Section 2 - Relay default and doctor resume round-trip check. Effort COMPLETE.
Implemented By: implementer-opus (two rounds)
Metrics: 2 review rounds (round 1: adversarial CHANGES_REQUIRED 1 Critical 4 Major, blind CHANGES_REQUIRED 1 Critical 4 Major, heavily convergent; round 2: nine adjudicated fixes re-dispatched to the same implementer, controller verified each Critical fix in the diff and re-ran the live gate rather than dispatching a third review round); 0 NEEDS_CONTEXT; 0 escalations.
Decisions / Surprises: (1) The blind Critical challenged the seeded window.txt default itself (a process-only match can type into whichever WT window is active); resolved by moving the safety into the watcher: resume-relay.ahk now refuses to type unless WinGetList finds exactly one matching window, so the default is safe by construction and the arm-script guidance became "close extra WT windows and the relay resumes". File scope grew to include the .ahk for that guard plus a startup self-heal that removes a stale doctor-probe dryrun.on (>10 min) while never touching a user's own flag. (2) The round-1 -Fix auto-arm bypassed the doctor's own consent model (a brief error by the orchestrator, not the implementer); now Get-Consent-gated with a pending-request check before any re-arm. (3) Probe hygiene hardened: dryrun.on stamped "doctor-probe <timestamp>" and created (and re-verified) strictly before the request; request.txt written atomically with CreateNew (TOCTOU closed); teardown deletes only content-verified probe artifacts, request-before-flag, with a 12s poll-cycle wait on the timeout path so a watcher holding the request in memory still sees the flag; probe archives in processed\/failed\ are guid-matched and removed; a pre-existing dryrun.on now WARNs (relay functionally disarmed) instead of PASSing. (4) -NoProbe (pre-existing switch for the login probe) also opts out of the state-writing relay probe.
Gate evidence: doctor round-trip PASS live on the desktop (twice by the implementer, once by the controller); WARN direction with window.txt absent; zero-match refusal direction via a no-such-process window expression (watcher logged the refusal path, doctor WARNed with the restart-to-reload guidance, relay dir clean after); FIX 6 self-heal observed in the watcher log; relay dir final state clean (no request.txt, no dryrun.on, no probe archives); both .ps1 files pass the PS 5.1 tokenizer; the edited watcher survived five restarts (headless AHK compile-check unavailable; process longevity is the available syntax evidence).
Machine state changed on the desktop (named per doctrine): window.txt seeded with `ahk_exe WindowsTerminal.exe`; the relay watcher was restarted several times and now runs the FIXED resume-relay.ahk copied from the repo working tree (ahead of the plugin cache until this commit lands and arm re-runs); ~/.claude/magic-compact/ledger.jsonl now exists (two real compaction entries from Section 1's live gates); az CLI logged in to the asr-solutions tenant by Scott with the azure-devops extension installed (used for the separate ADO guard confirmation, recorded in the backlog Q3 snapshot).
Residual risks, named: the true multiple-window refusal branch was proxied by the zero-match test (same WinGetList count check; opening a second WT window headlessly is not possible); the fresh (<10 min) doctor-probe flag preserve case is code-verified only; the sparse preserve-verbatim path in Section 1 has never run live (unit-tested; a follow-up backlog note tracks it).
Next: finishing pass, archive, commit and push per Scott.
Commit Model: Commit-and-Push (authorized at close-out)
