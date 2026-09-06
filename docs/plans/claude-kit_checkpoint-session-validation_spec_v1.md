# Checkpoint session validation

Status: In Progress
Author: SCOTT-CLAUDE Expert seat, from the operator's ruling over the relay, 2026-09-01
Commit Model: Commit-and-Push

## Related

Extends the chapter-checkpoint machinery shipped by
`../archive/claude-kit_compaction-deferral-signal_spec_v1.md` and follows the
precedent set by `../archive/claude-kit_durable-boundary_spec_v1.md`, which
moved the role-seat boundary markers to one file per session so two seats on
one checkout cannot unmake each other's declarations. This plan brings the
chapter checkpoint under the same discipline.

## What this is about

The chapter checkpoint (`.kit/compact-checkpoint.json`, the `open`/`clear`
verb pair of `kit-compact-checkpoint.js`) is leash-scoped rather than
caller-scoped: where a goal is armed with a bound session, `open` adopts that
bound session as the checkpoint's owner whatever session invoked it
(`plugins/claude-kit/hooks/kit-compact-checkpoint.js:156-157`, the
`owner = bound !== null ? bound : ...` resolution). On a checkout shared by
multiple sessions, which is this fleet's normal state, that means:

- A bystander session's `open` declares a chapter boundary on the
  leash-holder's behalf. The compaction gate then admits an auto-compaction
  the leash-holder never blessed, which can land mid-chapter, at exactly the
  point the gate exists to protect.
- A bystander session's `clear` unmakes a boundary the leash-holder
  legitimately declared, deferring its compaction until the safety valve
  fires near the context limit, the worst landing point.

This happened live on 2026-09-01: the expert seat ran `open` intending to
bank its own unleashed session's state and instead wrote a checkpoint bound
to the sibling worker's leash; the mis-open was caught by reading the written
record and cleared within a minute, with no deferral episode in flight, so
nothing was harmed. The hazard is accident, not adversary: a session
following its own skill's instructions writes into another session's
compaction timing with no refusal anywhere in the path.

The operator ruled (relay, 2026-09-01): the checkpoint carries a session id
that is validated at the acting moment, so a checkpoint affects only the
session it belongs to.

A second observation, routed here by the 2026-09-02 kaizen pass from the
NEO-CLAUDE inbox (note of 2026-08-31, reported and not reproduced here): a
chapter checkpoint opened at a clean point closed again within minutes with no
compaction landing, the gate's status reading no-checkpoint and its last
decision deny-boundary with reason no-checkpoint, so the deferral nudge
repeated and the run re-opened the checkpoint in a loop. On that machine several
sessions shared the checkout, which is the shape this plan's bystander `clear`
produces; the implementer confirms or refutes that reading against the gate
journal before treating it as this plan's instance, and records the answer
either way, since a loop with a different cause is a separate defect.

## Decisions

- Decided 2026-09-01 (operator, relay): checkpoints validate a session id, so
  a session that is not the one a checkpoint blesses can neither open nor
  spend it.
- Decided 2026-09-01 (expert, at spec): validation lands at the write door
  (`open` and `clear` refuse a caller that is not the session the checkpoint
  blesses) with a belt-and-braces read-side check at the gate (the record
  gains the opener's id and the gate honors it only where that id matches the
  session being compacted). The write-door check is what prevents the
  accident; the read-side check is what catches a record an older CLI or a
  hand edit produced.
- Decided 2026-09-01 (expert, at spec): no override flag on `open`. The
  operator path for releasing a held session already exists (`consent`, which
  takes `--session <id>`), so an override on `open` would duplicate it with a
  second spelling.
- Decided 2026-09-01 (expert, at spec): caller identity comes from the same
  channel the CLI's other session-scoped verbs already use
  (`callerSessionId()` / `usableSessionId`), and the check is
  mistake-prevention, not a security boundary: the id is self-reported
  environment, and the threat model is a session following instructions in
  the wrong seat, not a forger.

## Sections of Work

### 1. Open and clear validate the caller; the gate validates the record

Model: opus

`plugins/claude-kit/hooks/kit-compact-checkpoint.js`:

- `open` refuses, with nothing written, when the calling session is not the
  session the checkpoint would bless (the goal's bound session where a
  binding exists; the current owner-resolution logic otherwise stands, and
  what changes is that a caller who is neither is refused with words naming
  why rather than granted the bound session's slot). The refusal names the
  situation in plain words: this checkpoint belongs to the leashed session,
  and a bystander's boundary is declared with the `boundary` verb, which is
  already per-session.
- `clear` takes the same rule: a caller that is not the blessed session is
  refused and the existing checkpoint stands.
- A caller whose session id cannot be resolved at all (an operator's bare
  shell) is refused with a message naming `consent` as the operator's
  release path. This is a declared default, not a settled fork: if
  implementation surfaces a real operator need for an unattended open, that
  is a NEEDS_CONTEXT, not a silent widening.
- The checkpoint record gains an `openedBy` field carrying the opener's
  session id.

The gate side (wherever the chapter checkpoint is read at PreCompact,
`kit-compact-lib.js` or the gate hook): a chapter checkpoint is honored only
where its `openedBy` matches the session being compacted; a mismatched or
absent `openedBy` is journaled under its own reason value and the checkpoint
is otherwise ignored. The role-boundary markers and the consent marker are
untouched: they are already session-scoped by their own machinery.

Files in scope: `plugins/claude-kit/hooks/kit-compact-checkpoint.js`,
`plugins/claude-kit/hooks/kit-compact-lib.js` (only if the gate-side read
lives there; the implementer confirms the reading site before editing),
`test/kit-compact-gate.test.js`, and whichever existing test file pins the
checkpoint CLI's verbs.

Tests, both directions: the bound session's own `open` succeeds and the gate
honors the checkpoint; a bystander `open` is refused with nothing written; a
bystander `clear` is refused with the existing checkpoint intact and
byte-unchanged; the gate ignores a fixture checkpoint whose `openedBy`
mismatches the compacting session, journaled under the new reason value; an
`open` with no resolvable caller id is refused naming `consent`. Existing
leashed-path tests stay green with the caller id supplied.

Build: touches `plugins/claude-kit/hooks/`, so the build stamp refresh runs
before the section's gate (operator-tier memory).

## Out of scope

- The role-boundary markers and the `consent` verb: already session-scoped.
- The gate's safety valve and its context ceiling: unchanged.
- Any change to when the leashed session opens a checkpoint (the section
  loop's step 8 and the interim ritual): this plan changes who may, not when.

## Rollout

Ships with the plugin: `claude plugin update` plus session restarts, the
standing fleet-update act.

## Chapters

### Interim board 1 - 2026-09-06
Section 1 stage: implemented by implementer-opus (DONE_WITH_CONCERNS: six fixtures in three out-of-scope test files needed the new field; folded by the orchestrator together with three size-budget cap raises), verified on the targeted lane (six test files: 619 tests, 618 pass, 1 fail, exit 1, the one red the size ratchet before the cap raise; ratchet alone afterwards 78 of 78, exit 0; worktree at HEAD 0faeb51 with the section edits unstaged, 2026-09-06 about 09:40), reviewed once (adversarial CHANGES_REQUIRED 0/4/9, blind CHANGES_REQUIRED 0/4/4, security CONCERNS 0/2/6, all three at opus effort max through the Workflow route), and now in its fix round.
Live dispatch: one implementer-opus running the fix brief at `.kit/verify/s1-fix-brief.md`, which carries the thirteen adopted findings F1 to F13 (bystander open over an existing unbound-goal record; the status adoption promise; clear's misdirected consent and boundary --cancel pointers; unbound-goal clear locking out a resuming run on a stale record and asserting a record that is not there; unreadable-read clear; adoption normalising an unstorable opener; a required opener at the write door with the queue advance passing it; the file header's overclaim; the gate's BOUNDARY_NOTE third cause; a stale comment; the compare-before-delete residual stated; the guard-7 fixture; the older-kit fixture case). Refuted: the adversarial Major that the folded fixtures had no green (the six-file lane above covers them). Not adopted: whole-phrase refusal pins (local precedent); the hard refusal of open on an unresolvable caller stands as the spec's recorded decision, with the leashed-session residual to be named in the Chapter.
Docs: docs/architecture.md (two passages) and docs/security-model.md (invariant, leg count, accepted-risk paragraph) corrected by the main session to the four-leg predicate and the caller rule; unstaged, folded into the section's files; the security lens rated the drift Major.
Gate baseline for the fix round: the six-file lane above, plus the peer session's reported whole gate over this worktree at 3190 tests, 3180 pass, 1 fail, 9 skipped, exit 1 (the standing memory-session red), reported by KIT: Expert and not run by this session.
Tree: peer session KIT: Expert committed 0faeb51 and 1d1d9fd on this checkout during the section (its own files only) and holds nothing staged; this session's unstaged set is the two hooks, four test files, the size budget, the two docs and this plan doc.
Next: adjudicate the fix report, second review round (the fix delta reaches an allow/deny hook, so a round is owed), close gate, Chapter 1, commit and push, finishing-work.

### Interim board 2 - 2026-09-06
Section 1 stage: two fix rounds landed (round 1: F1 to F13; round 2: G1 to G12, the arming session's claim now outranking a bystander's record in the shared guard, illegible and oversized files demoted to nobody's boundary, the gate note sending the operator to consent rather than open, with a pin the orchestrator folded), each verified on the orchestrator's own targeted lane (six files 627/627/0 exit 0 after round 1; seven files with hook-canary 684/684/0 exit 0 after round 2; gate test plus ratchet 400/400 exit 0 after the pin fold; worktree at HEAD ada58b9 with the section unstaged, 2026-09-06 about 11:45). Round 2 verdicts: adversarial CHANGES_REQUIRED 0/3/6, blind CHANGES_REQUIRED 1/3/5 (the Critical adjudicated Major: bounded to one deferral until the claim binds, fixed as G1), security CONCERNS 0/1/4, all at opus effort max via Workflow.
Live dispatch: review round 3 (adversarial, blind, security at opus max) over the round 2 fix delta, brief at .kit/verify/s1-r3-brief.md, owed because that delta reshaped the guard itself.
Docs: docs/architecture.md clear passage names the nobody's-boundary carve-out; docs/security-model.md:548 corrected to the probed subagent-shell fact; both CRLF, verified by byte count.
Not adopted from round 2: the hard refusal of open on an unresolvable caller (spec decision); usableSessionId's charset for the caller (spec channel); the executing-work no-op sentence (still true); the lstat-under-binding refusal wording (noted).
Tree: the eleven-file unstaged set is this session's; nothing staged; peer KIT: Expert holds nothing dirty.
Next: adjudicate round 3, fixes if any, spec-matches-reality (Files in scope widened to the eleven files; clear's refusal names no consent pointer), memq unstamped, Chapter 1, whole gate, commit and push, checkpoint, finishing-work.
