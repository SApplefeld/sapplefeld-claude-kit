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

### 2. The section loop names the refusals its two checkpoint steps can meet

Model: opus
Locus: inline

`plugins/claude-kit/skills/executing-work/SKILL.md`, step 0 and step 8, describe
`clear` as a no-op when nothing is open and `open` as a no-op refusal when no
goal is armed, and say step 0 clears a leftover checkpoint regardless. After
section 1 both verbs also refuse at exit 1 to a caller that is not the session
the checkpoint blesses, and to every caller over a goal state that is present
but cannot be read or a checkpoint path holding something other than a regular
file. The case a run actually meets is a run resumed under a new session id
against a goal still bound to the dead one: both steps exit 1 until the goal is
re-armed, which rebinds it, and that remedy lives today only in the CLI's
stderr.

- Step 0 gains one clause: the clear refuses, at exit 1, over a record that is
  another session's boundary or over a state it cannot read, naming the remedy
  (re-arm the goal where the run resumed under a new session id; move aside by
  hand what is not a checkpoint file), and the no-op reading stays for the
  absent path.
- Step 8 gains one clause: the open refuses the same way to a caller the
  checkpoint would not bless, with the same re-arm remedy, and the
  "regardless" claim is narrowed to a record the calling session may clear.
- Both clauses state current fact and never the change; no em or en dashes.
- `test/size-budget.json`: raise the skill's word cap to its new count.

Files in scope: `plugins/claude-kit/skills/executing-work/SKILL.md`,
`test/size-budget.json`.

Tests: `node --test test/size-ratchet.test.js test/doctrine-parity.test.js`
(the ratchet reads the raised cap; parity confirms the skill carries no
doctrine-mirrored block this edit could desynchronize). No new test: the
edit is prose in a skill with no behavior of its own.

Acceptance: each step carries its clause; a reader of step 0 or step 8 who
meets exit 1 on a resumed run finds the re-arm remedy in the step itself;
the size-ratchet lane is green at the raised cap.

Appended under executing-work's out-of-scope route while section 1 was in
review: two section 1 reviewers named the skill as describing behavior the
section changed, the file sits outside section 1's directory so the fold
predicate fails, and the surface serves this plan's goal.

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
### Interim board 3 - 2026-09-06
Section 1 stage: three fix rounds landed (round 3: H1 to H10, the shared guard now refusing both verbs over a goal state that is present but unreadable rather than reading it as absent, illegible and oversized files and same-plan records with a foreign or missing opener demoted to nobody's boundary under a bound goal, open consulting the binding directly before the record leg, the unbound open's success line no longer promising the next compaction, the gate note naming the goal CLI's status as the id's source, adoption verifying the opener, a source-parse pin tying the match rule's reason codes to GATE_REASONS), verified on the orchestrator's own seven-file lane 689/689/0 exit 0 read from the run's marker (baseline before the round 684/684/0; the five added are the round's tests; worktree at HEAD 2c50e51 with the section unstaged, 2026-09-06 about 12:17). Round 3 verdicts: adversarial CHANGES_REQUIRED 0/2/4, blind CHANGES_REQUIRED 0/4/3, security CONCERNS 0/0/6, all at opus effort max via Workflow; the adversarial reviewer confirmed from its own dispatched shell that a subagent carries the dispatching session's id.
Live dispatch: review round 4 (adversarial, blind, security at opus max) over the round 3 fix delta, brief at .kit/verify/s1-r4-brief.md, owed because that delta reshaped the guard's leg order and open's binding check.
Docs: docs/architecture.md clear passage names the arming leg, conditions the nobody's-boundary list on the binding, and names the unreadable-goal refusal; docs/security-model.md accepted-risk paragraph names the record's reach over the CLI's write door; both CRLF, verified by byte count.
Not adopted from round 3: the hard refusal of open on an unresolvable caller (spec decision, third time raised); the NEO loop question goes to the Chapter as unverifiable from the journal held here.
Tree: the eleven-file unstaged set is this session's; nothing staged; peer KIT: Expert holds nothing dirty.
Next: adjudicate round 4, fixes if any (a further round only where a fix reaches the guard again), spec-matches-reality (Files in scope widened to the eleven files; clear's refusal names no consent pointer; the no-id clear carve-out; the unreadable-goal refusal), memq unstamped, Chapter 1, whole gate under claim, commit and push, checkpoint, finishing-work.
### Interim board 4 - 2026-09-06
Section 1 stage: four fix rounds landed (round 4: I1 to I10, the 'kind' reading at the checkpoint path now refusing every caller on both verbs before the binding is consulted, the header and the gate's GOAL_CLI comment corrected to the rule as it stands, the unreadable-goal refusal printing a phrase per kind, the reason-vocabulary pin reaching the match rule's terminal return and the gate hook's own literals, the record leg answering nobody's boundary for a record whose owner is not its opener, the held-offer and goal-leg messages carrying their conditions, and sessionHoldsLeash's contract paragraph in kit-goal-lib.js naming the checkpoint CLI's write verbs as a caller, which widens Files in scope to twelve files by one comment paragraph), verified on the orchestrator's own eight-file lane 849/849/0 exit 0 read from the run's marker (baseline before the round 689/689/0 on seven files plus 159/159/0 on kit-goal-lib; the one added is the round's test; worktree at HEAD df7c326 with the section unstaged, 2026-09-06 about 13:20). The implementer repaired two fixtures that had staged a directory at the checkpoint path to reach a refused write (now staged as an EPERM on the temp file, mirroring the unlink sibling); accepted as a test-floor extension. Round 4 verdicts: adversarial CHANGES_REQUIRED 0/2/7, blind CHANGES_REQUIRED 0/2/6, security CONCERNS 0/0/4, all at opus effort max via Workflow.
Live dispatch: review round 5 (adversarial, blind, security at opus max) over the round 4 fix delta, brief at .kit/verify/s1-r5-brief.md, owed because that delta touched the guard's kind and record legs.
Docs: docs/architecture.md clear passage also names the refusal over a checkpoint path holding something other than a regular file; CRLF verified by byte count.
Not adopted from round 4: the hard refusal of open on an unresolvable caller (spec decision, fourth time raised); holding the caller id to the binding's UUID shape (premise false: normalizeState shapes armingSession only, kit-goal-lib.js:277, and the suite's non-UUID fixtures bind green); the upgrade-time note on pre-update records (bounded, documented, to the Chapter). Carried to the close gate: the adversarial reviewer named seven further test files whose subjects include a changed file (doctrine-parity, memq-grant, seat-stop, memory-sync, kit-goal-lib, doctor-encoding, memory-session); kit-goal-lib ran in the lane and the rest run beside the whole gate before the push.
Tree: the twelve-file unstaged set is this session's; nothing staged; peer KIT: Expert holds nothing dirty.
Next: adjudicate round 5, fixes if any (a further round only where a fix reaches the guard again), spec-matches-reality (Files in scope widened to the twelve files; clear's refusal names no consent pointer; the no-id clear carve-out; the unreadable-goal and kind refusals), memq unstamped, Chapter 1, whole gate under claim, commit and push, checkpoint, finishing-work.
### Interim board 5 - 2026-09-06
Section 1 stage: five fix rounds landed (round 5: J1 to J9, the bound branch answering nobody's boundary for a record whose recorded owner is not the binding, the checkpoint-path refusal and the status verb printing a phrase per reading instead of a raw token or a false no-goal, the 'file' goal phrase covering a state file the normalizer rejects, the record leg answering nobody where the opener is null, the third boundary-note cause pinned, two test comments restated as present fact, the no-open pin made a regex over the printed CLI path with a speaking control, the file header pointing at the guard as the owner of the nobody's-boundary enumeration), verified on the implementer's eight-file lane 853/853/0 exit 0 read from .kit/verify/s1-fix5-lane.exit (baseline before the round 849/849/0; the four added are the round's tests; worktree at HEAD 1ac8f3e with the section unstaged, 2026-09-06 about 13:55; red-first probe exit 1 with four of five new tests red against the pre-edit hook, restored byte-identical). Round 5 verdicts: adversarial CHANGES_REQUIRED 0/2/9, blind CHANGES_REQUIRED 0/2/4, security CLEAR 0/0/3, all at opus effort max via Workflow (first-turn reading claude-opus-5 on every transcript, 0 synthetic). Both Majors were curated-doc drift and are fixed: docs/architecture.md's boundary-note paragraph now describes the note as shipped (three no-longer-honored causes, the status / goal-CLI status / consent --session chain, no open remedy and why), its clear passage's nobody's list carries the ownerless, owner-not-opener and bound-owner states, and its refusal sentence splits the non-regular-file refusal from the transient readings; docs/security-model.md's invariant paragraph names the two composed CLI paths and its accepted-risk paragraph names the manual recovery a planted non-regular file requires; both CRLF by byte count, no dashes.
Live dispatch: review round 6 (adversarial, blind, security at opus max) over the round 5 fix delta, brief at .kit/verify/s1-r6-brief.md, owed because J1 and J7 touched the guard.
Scope change: section 2 appended above Out of scope (executing-work SKILL.md step 0 and step 8 wording naming the caller-scope refusals and the re-arm remedy, plus its size cap; inline, prose only), named on the relay at the moment of the append; two round 5 reviewers named the file, which sits outside section 1's directory, so the fold predicate failed.
Not adopted from round 5: an age test in the bound branch (a run resumed under a new session id is a bystander until re-arm by design, and the refusal names that remedy; the blind reviewer's Major); a fallback from an unresolvable caller to the binding (spec decision, fifth time raised; the blind reviewer's second Major, whose premise the round 5 security reviewer answered by confirming CLAUDE_CODE_SESSION_ID from its own dispatched shell); the interactive note's '" boundary' pin spelling (adjacent, unadopted, named by the implementer).
Surprise: the checkpoint opened at the interim board 4 commit was no longer on disk when the gate's seventh held offer was reported (status: no compact checkpoint open, last decision deny-boundary no-checkpoint); the installed kit (ab815dceddca) is what this session runs, not the worktree, and nothing this session ran clears a checkpoint outside temp fixtures; unexplained, recorded for the Chapter.
Tree: the twelve-file unstaged set plus the plan doc is this session's; nothing staged; peer KIT: Expert holds nothing dirty.
Next: adjudicate round 6, fixes if any (a further round only where a fix reaches the guard again), spec-matches-reality on section 1 (Files in scope the twelve files; clear's refusal names no consent pointer; the no-id clear carve-out; the unreadable-goal and kind refusals; the owner leg under a binding), memq unstamped, Chapter 1, then section 2 inline, whole gate under claim, commit and push, checkpoint, finishing-work.
