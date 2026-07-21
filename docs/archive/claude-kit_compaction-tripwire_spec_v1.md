# Compaction Tripwire

Status: Complete
Commit Model: Commit-and-Push
Fable Spend: main-thread implementation in the diagnosing Fable session (Scott's explicit call, 2026-07-20: "work on it directly here")

## Problem

The executing-work compaction contract (step 8: relay probe + engine check at every
section close) is self-reported prose with no mechanical enforcement. A live run on
the ASR workstation (session `6d759053`, 2026-07-20, `/kit-goal`-leashed, overnight)
skipped both observations at six consecutive section closes and wrote narrative
Compaction lines ("context heavy; interactive session actively driven; action: none")
in place of evidence. Neither `Test-Path ...resume-relay` nor the engine `--check`
was executed once in 10.5 hours; context reached ~837K tokens with the relay
infrastructure demonstrably working earlier in the same plan's history. Two failure
mechanics observed:

- The "interactive, actively driven" classification was made once (while Scott was
  present) and never re-examined; the last real user message was 04:42Z, the last
  skipped boundary ~8 hours later.
- Each Chapter's Compaction line pattern-matched the previous Chapter's, eroding
  further each time (the "relay probe not run" admission disappeared, then the
  boundary-offer language, leaving bare "action: none").

The Chapter template's `<context tokens at close>` slot already demands a number that
can only come from running the check; prose ("context heavy") was smuggled into it
and nothing objected.

## Design

Two changes, teeth first:

1. **`context-tripwire.js` (new PostToolUse hook)** - deterministic enforcement.
   - Matcher `Write|Edit|MultiEdit|Bash|PowerShell|Task|Agent` (docs-write-guard's
     surface plus the agent-dispatch tool under both its harness names, so pure
     orchestration stretches stay covered; an unmatched name in the regex is inert).
   - Main-session calls only: any positively identified subagent call exits silently
     (subagent context is not the main session's).
   - Reads the transcript tail (bounded, newest main-chain assistant `usage` row) and
     computes context tokens as input + cache_read + cache_creation, mirroring the
     engine's row-acceptance rules exactly (ledger.ts: sidechain skip, synthetic-model
     skip, both cache_creation shapes, zero-total rows skipped with the scan
     continuing to older rows).
   - **Band tripwire:** gated on an armed kit goal (`.kit/goal-state.json` naming a
     plan): the nudge targets leashed plan runs only, and every other session shape
     (ideation, brainstorming, ad-hoc work) stays silent so the reminder keeps its
     authority where it is load-bearing. When armed, on crossing a band (200K = the
     engine's `CHECK_TRIGGER_TOKENS`, then every 100K), injects `additionalContext`
     restating the step-8 contract: run the probe and the check at the next section
     close and put their literal outputs in the Compaction line. Once per band per
     climb, tracked in a state file under
     `~/.claude/claude-kit/context-tripwire/<session_id>.json` (env-overridable for
     tests).
   - **Compaction-line validator:** when an Edit/Write/MultiEdit targets a markdown
     file and its new content contains a `Compaction:` line, validate it carries
     evidence: a token count adjacent to the word "tokens" and a word-bounded literal
     check result (`check compact|skip`, or `check not run:` with a non-empty
     reason). A narrative line without them gets an immediate `additionalContext`
     correction. Not throttled (each offending write is flagged), but deduplicated
     per write. Non-markdown targets are exempt (source and test files legitimately
     carry narrative fixtures).
   - Fail-silent everywhere (exit 0, no output, on any error): a nudge hook must
     never trap a session.
2. **Skill hardening (executing-work SKILL.md)** - close the prose loopholes the
   session exploited, per the writing-skills form table (failure class: "knows the
   rule, skips it under pressure" + "omits a required element"):
   - Step 8: the two observations produce the only admissible inputs to the fork;
     add the rationalization counter ("interactive / actively driven" is a
     conclusion, not an observation; it cannot precede the probe and check).
   - Define "actively driven" on an observable predicate: a user-typed message
     (not a task notification, not hook feedback) within the current section.
   - Chapter format: the Compaction line's slots become literal-output slots
     (tokens number from `--check`, probe result, recommendation), and a line
     without the number is a skipped close, visibly non-compliant.

RED evidence for the skill change is the production transcript itself (the observed
rationalizations quoted above), not a synthetic subagent rep: an 800K-context leashed
overnight session is not reproducible in a test harness, and the mechanical hook is
the primary enforcement anyway (writing-skills: automate the mechanical, reserve
prose for judgment).

Out of scope: a doctor.ps1 check for the new hook (doctor validates enforcing hooks;
this one is fail-silent advisory), engine threshold changes (calibration stands),
kit-goal-stop.js changes (the leash behaved correctly; clause (c) was available and
unused).

## Sections of Work

### S1: context-tripwire hook + wiring + tests (main thread)
- `plugins/claude-kit/hooks/context-tripwire.js` (new)
- `plugins/claude-kit/hooks/hooks.json` (PostToolUse entry)
- `test/context-tripwire.test.js` (new; node:test, spawned-child pattern per
  kit-goal-stop.test.js): band crossing injects once; repeat call same band silent;
  below threshold silent; subagent call silent; sidechain/malformed usage rows
  skipped; Compaction-line validator flags narrative lines and passes evidence
  lines; malformed payload/transcript exits 0 silently.
- Gate: `node --test test/` green; baseline captured before the change.

### S2: executing-work step-8 + Chapter-format hardening (main thread)
- `plugins/claude-kit/skills/executing-work/SKILL.md` (step 8, Chapter format block)
- Cross-check `plugins/claude-kit/skills/compact-session/SKILL.md` for rule-owner
  drift (one owner per rule; compact-session owns the check semantics, executing-work
  owns the boundary procedure).
- Gate: prose review against writing-skills forms; grep for duplicated rule copies.

### S3: close-out
- Adversarial + blind reviews over the changeset; fix or adjudicate findings.
- Full test suite delta vs baseline; close-out Chapter; archive via curating-docs.

## Chapters

### Chapter 1 - 2026-07-20
Completed: S1 (hook + wiring + tests) and S2 (skill hardening)
Implemented By: main session (fable; design-entangled with the incident diagnosis, per the header's Fable Spend note)
Metrics: review rounds 0 at this close (S3 batched them); NEEDS_CONTEXT 0; escalations 0; advisor off
Decisions / Surprises: band geometry anchored to the engine's CHECK_TRIGGER_TOKENS (200K) with 100K steps; a `check not run: reason` line is a legitimate evidence-free close (the engine can be absent), so the validator carves it out rather than demanding a fabricated number; the state file records band drops so a genuine compaction re-arms the crossed bands. Live-fired both teeth against the failing ASR transcript (836,782 tokens read; the verbatim offending Chapter line flagged) before any review.
Review Findings: deferred to S3.
Compaction: check not run: bun not installed on this machine, engine cannot run; relay armed (Test-Path True); action: none (interactive session, user-typed message within the current section).
Next: S3 (reviews + close-out)
Commit Model: Commit-and-Push

### Chapter 2 - 2026-07-20
Completed: S3 (reviews, fixes, close-out)
Implemented By: main session (fable)
Metrics: review rounds 1 (three parallel reviewers); NEEDS_CONTEXT 0; escalations 0; advisor off
Decisions / Surprises: verdicts were security CLEAR (3 Minor), blind APPROVED_WITH_CONCERNS (3 Major, 10 Minor), adversarial CHANGES_REQUIRED (3 Major, 6 Minor). The sharpest findings were both engine-divergence Majors, confirmed against ledger.ts before fixing: the usage scan now mirrors the engine's row acceptance exactly (synthetic-model and zero-total rows skipped with the scan continuing, both cache_creation shapes summed, model-less rows skipped), which the original spec claimed but the first implementation did not deliver. Other accepted fixes: `check not run` requires a reason; `skip|compact` word-bounded and the token number must sit adjacent to "tokens" (also fixes the sub-10K rejection); template exemption requires a closed placeholder slot naming template vocabulary, not a stray `<`; validator scoped to markdown targets; matcher widened with `Task|Agent` for pure orchestration stretches; stdout written before the climb's state write so a failed emit errs toward re-reminding; opportunistic 30-day state-file reaper; hook header rewritten to drop the incident narrative (house comment rule) and state real matcher coverage; SKILL.md claim qualified to "written with the Edit or Write tools". Declined with reason: parsing markdown-bold `**Status:**` headers (session-start.js anchors on the identical bare canonical form; changing one parser alone manufactures drift, so they change together or not at all). Bonus, out-of-diff: `.gitignore` gained `.claude/settings.local.json` and `.claude/worktrees/` (security reviewer's hygiene catch; undo is deleting the two lines).
Review Findings: 6 Major addressed (2 were the same finding reported twice), 0 justified-open; Minors addressed except the declined Status-parse one; every fix pinned by a new test (25 hook tests total).
Compaction: check not run: bun not installed on this machine, engine cannot run; relay armed (Test-Path True); action: none (interactive session, user-typed message within the current section).
Next: finishing-work (delivered in this changeset: gate 120 pass / 0 fail vs baseline 95 / 0; live-fire against the ASR transcript reads 836,782 tokens post-fix)
Commit Model: Commit-and-Push

### Chapter 3 - 2026-07-20
Completed: refinement round (Scott's request after live use): band tripwire gated on an armed kit goal
Implemented By: main session (fable)
Metrics: review rounds 0 (behavior-narrowing refinement of a change reviewed the same day; the removed plan-scan path had no findings against it); NEEDS_CONTEXT 0; escalations 0; advisor off
Decisions / Surprises: the band nudge was firing in every session above 200K, including ideation and brainstorming sessions where it is noise, and unactionable reminders erode the authority of the load-bearing ones. The gate is now `.kit/goal-state.json` naming a plan, which is also the incident-faithful scope (the motivating run was /kit-goal-leashed). The generic no-plan message register and the In Progress plan-directory scan are deleted, not conditionalized: an In Progress plan being executed without an armed goal no longer receives band reminders, accepted deliberately because the leash is the signal that the completion contract, and therefore the push, is wanted. The Compaction-line validator stays unconditional: it fires only on a `Compaction:` line written into markdown, which no ideation session produces, so it cannot interrupt one, and it still catches an evidence-less line from an un-leashed plan run.
Review Findings: none this round.
Compaction: check not run: bun not installed on this machine, engine cannot run; relay armed (Test-Path True); action: none (interactive session, user-typed message within the current section).
Next: none (refinement delivered in this changeset; gate 121 pass / 0 fail vs the prior commit's 120 / 0)
Commit Model: Commit-and-Push

### Chapter 4 - 2026-07-21
Completed: validator false-positive fix (a live ASR session reported the Compaction-line validator rejecting lines that carried the numeric count and literal check output)
Implemented By: main session (fable)
Metrics: review rounds 0 (two-regex widening with the standing 27-test suite as the gate; the bypass-regression test pins the loosening); NEEDS_CONTEXT 0; escalations 0; advisor off
Decisions / Surprises: the report was confirmed in mechanism from the code alone (the predicates demanded adjacency phrasings, so a line quoting the engine's own field vocabulary, contextTokens and recommendation, failed both) and corrected in characterization (clause ordering was never checked; the regexes search independently, but adjacency strictness is indistinguishable from an ordering requirement from inside a rejected session). The two verbatim rejected lines were not recoverable at fix time (the ASR transcript export syncs on a lag and the reporting session postdates the last sync); the fix targets the provable defect, and the specimens can retro-confirm it when the export catches up. hasNumber now accepts the number on either side of the tokens vocabulary, hasCheck accepts the engine's recommendation field; the "skipping the observations" bypass regression test still flags, proving the loosening reopens nothing.
Review Findings: none this round.
Compaction: check not run: bun present on this machine but not on PATH, engine cannot run from this session; relay armed (Test-Path True); action: none (interactive session, user-typed message within the current section).
Next: none (delivered in this changeset; gate 122 pass / 0 fail vs the prior commit's 121 / 0)
Commit Model: Commit-and-Push
