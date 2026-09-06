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
- `clear` takes the same rule over a record that is somebody's boundary: a
  caller that is not the blessed session is refused and the existing
  checkpoint stands. Over an absent path it stays the exit-0 no-op the
  section loop runs before it knows whether a boundary is open, and over a
  record that is nobody's boundary it asks no caller id and removes it,
  since there is no scope there to protect.
- Which session a checkpoint blesses is one rule both verbs read
  (`blessedCheckpointSession`), in this order: a goal state that is present
  but cannot be read refuses both verbs, since whether any session holds
  the leash is then unknown (`open` asks before it looks at the path, and
  `clear` asks only over a path that holds something, an absent path staying
  its no-op); something other than a regular file at the
  checkpoint path refuses both verbs for every caller, saying what is there
  and leaving it in place; a path the filesystem would not read is the
  bound session's where the goal is bound and refused to all where it is
  not; an illegible or oversized file, another plan's record, a record met
  with no goal armed, a record naming no opener, a record whose recorded
  owner is not its own opener, and, under a bound goal, a record whose
  opener or owner is not the bound session are nobody's boundary; otherwise
  the bound session where the goal is bound, else the session that armed
  the goal where the caller is that session, else the opener of the record
  on disk.
- A caller whose session id cannot be resolved at all (an operator's bare
  shell) is refused at `open` with a message naming `consent` as the
  operator's release path, carrying that consent is the operator's verb
  and never a session's own judgment. `clear` asks for a caller id only
  over a record that is somebody's boundary, so a bare shell's clear over
  nothing, or over a record that is nobody's, still succeeds. This is a
  declared default, not a settled fork: if implementation surfaces a real
  operator need for an unattended open, that is a NEEDS_CONTEXT, not a
  silent widening.
- The checkpoint record gains an `openedBy` field carrying the opener's
  session id.

The gate side (wherever the chapter checkpoint is read at PreCompact,
`kit-compact-lib.js` or the gate hook): a chapter checkpoint is honored only
where its `openedBy` matches the session being compacted; a mismatched or
absent `openedBy` is journaled under its own reason value and the checkpoint
is otherwise ignored. The role-boundary markers and the consent marker are
untouched: they are already session-scoped by their own machinery.

Files in scope: `plugins/claude-kit/hooks/kit-compact-checkpoint.js`,
`plugins/claude-kit/hooks/kit-compact-lib.js` (the gate-side read lives
there), `plugins/claude-kit/hooks/kit-compact-gate.js` (the boundary deny
note, which names the goal CLI's status as the bound session id's source
and offers no `open`), `plugins/claude-kit/hooks/kit-goal-stop.js` (the
queue-advance rewrite passes an explicit opener),
`plugins/claude-kit/hooks/kit-goal-lib.js` (one comment paragraph naming
the checkpoint CLI's write verbs as a caller of `sessionHoldsLeash`),
`test/kit-compact-gate.test.js`, `test/compact-deferral-nudge.test.js`,
`test/kit-goal-stop.test.js`, `test/kit-goal-worktree.test.js` (fixtures
supply the opener and the caller id), `test/size-budget.json`,
`docs/architecture.md` (the checkpoint CLI and boundary-note passages) and
`docs/security-model.md` (the invariant and accepted-risk paragraphs).

Tests, both directions: the bound session's own `open` succeeds and the gate
honors the checkpoint; a bystander `open` is refused with nothing written; a
bystander `clear` is refused with the existing checkpoint intact and
byte-unchanged; the gate ignores a fixture checkpoint whose `openedBy`
mismatches the compacting session, journaled under the new reason value; an
`open` with no resolvable caller id is refused naming `consent`; both verbs
refuse over a present-but-unreadable goal state and over a non-regular file
at the checkpoint path, with nothing written and the file left in place;
`status` names an unreadable goal state rather than an absent one; the
reason vocabulary the gate and the match rule emit is pinned to the
exported `GATE_REASONS`. Existing leashed-path tests stay green with the
caller id supplied.

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
### Interim board 6 - 2026-09-06
Section 1 stage: six fix rounds landed. Round 6 (K1 to K6): both write verbs' bound-goal refusals carry the spec's boundary-verb pointer and a conditioned re-arm clause (a run resumed under a new session id whose bound predecessor is gone re-arms, which rebinds; arming replaces the whole queue, so any other session leaves the goal alone), the goal predicate treats a non-object state file (0, false, an empty string) as unanswered rather than as no goal armed, the header names the goal library's own kinds and scopes the guard to the two write verbs, the no-open pin's claim is narrowed to the invocation shape it reads with a class-shaped second leg over every verb the note invokes after a script path, and the no-caller refusal at open no longer prints a runnable consent form. Verified on the implementer's eight-file lane 854/854/0 exit 0 read from .kit/verify/s1-fix6-lane.exit (baseline before the round 853/853/0; the one added is the K2 test; worktree at HEAD 99ff18b with the section unstaged, 2026-09-06 about 14:30; red-first probe exit 1 against the reverted predicate, restored byte-identical by cmp). Two implementer deviations, both accepted on the code read: the brief's word-boundary open leg over the boundary note cannot pass because the note itself says 'rather than open', so a class-shaped leg over invocation sites stands in; the record-leg refusal test carries a controlled negative pin on the single-sourced pointer constant rather than the positive pins the brief named, since that leg gains neither the pointer nor the clause.
Round 7 verdicts (opus effort max via Workflow, first-turn reading claude-opus-5 on every transcript, 0 synthetic; the Workflow ran two agents at a time, so the security reviewer started when the blind one finished): adversarial APPROVED_WITH_CONCERNS 0/0/6, blind APPROVED_WITH_CONCERNS 0/0/3, security CONCERNS 0/0/3. No Critical and no Major. Adopted for a round 7 fix (brief at .kit/verify/s1-fix7-brief.md): single-source the two K1 sentences duplicated across open and clear and pin their identity once; treat a state file holding an array, or an object carrying a binding with no usable plan string, as unanswered (the withheld control, an object with neither plan nor binding, still reads as no goal armed); drop 'kind' from the opaque-readings list its only consumer can never see; correct the header line claiming only a settled-absent goal state reads as no goal armed; say 're-arm the goal with its whole queue' in both verbs; say in the non-regular-file refusal that no verb here removes what is there; assert the queue advance's opener on read-back in test/kit-goal-stop.test.js; state the PreCompact-stderr channel claim in the gate's comment as a harness dependency. Adopted for the orchestrator (docs): qualify the spec's first guard leg with 'over a path that holds something'; add to docs/security-model.md a clause naming the induced-act class a refusal line can carry and the conditioning as its control; mark the stderr-channel claim in docs/architecture.md as a harness dependency.
Not adopted from round 7: letting the leash holder's open write through a symlink or FIFO at the checkpoint path (the blind reviewer's lost self-heal; fail-closed by design, the accepted-risk paragraph names the manual recovery, and the refusal will now say no verb removes it); closing the no-open pin's reach axis by pinning the note's single permitted open mention (the residual is declared instead: both legs key on a verb immediately after a .js path, so a note phrased 'status, then open one' or a script path without a .js extension would pass them; recorded as unproven rather than clean).
Dispatch defect of this session's own: the round 7 blind reviewer's prompt named which line ranges held the newest edits, which is diff-describing framing its charter forbids; the reviewer recorded the contamination, disregarded the focus direction and reviewed the whole delta, and two of its three findings fell outside the named ranges. Round 8's blind prompt carries the base ref and file list only.
Stamps: memq unstamped --since 9h lists 0 project-tier and 4 operator-tier records read and not applied (cut-before-the-pass-that-needs-the-room, coordinator-carries-kaizen-notes, a-drifted-convention-costs-only-the-outsider, function-hooks-prototype-ships-behind-a-flag); none shaped this section's work, all four reached through trigger matches on skills this session loaded, so none is stamped.
Tree: the twelve-file unstaged set plus the plan doc is this session's; nothing staged; peer KIT: Expert holds nothing dirty; the tree was byte-identical across round 7 by git status capture.
Next: round 7 fixes (implementer-opus, brief at .kit/verify/s1-fix7-brief.md), docs fixes inline, round 8 over the round 7 fix delta alone (owed because the goal predicate feeds the guard's first leg), Chapter 1, then section 2 inline, whole gate under claim, commit and push, checkpoint, finishing-work.
### Chapter 1 - 2026-09-06
Completed: section 1, Open and clear validate the caller; the gate validates the record.
Implemented By: implementer-opus (eight dispatches: the section build plus seven fix rounds), reviewed by the adversarial, blind and security reviewers at opus effort max through Workflow in every round, first-turn reading claude-opus-5 on every transcript with 0 synthetic.
Commit model: Commit-and-Push, honored in this changeset (the section's thirteen files and the plan doc land in one commit on main, pushed).
What shipped: the checkpoint record carries an opener (openedBy), written by the checkpoint CLI's open from the calling session's own id and by the queue advance from the binding; the gate honors a checkpoint only where the opener equals the compacting session (wrong-opener, in the exported GATE_REASONS vocabulary, refused before the age legs); the CLI's two write verbs consult one guard, blessedCheckpointSession, whose leg order the spec now states (goal state present but unreadable refuses both verbs; something other than a regular file at the checkpoint path refuses every caller and no verb removes it; a transient read failure is the bound session's under a binding and refused to all where unbound; an illegible or oversized file, another plan's record, a record met with no goal armed, a record naming no opener, a record whose owner is not its opener, and, under a binding, a record whose opener or owner is not the bound session are nobody's boundary; otherwise the bound session, else the arming session where the caller is it, else the record's opener); open refuses a bare shell naming consent as the operator's verb without printing its runnable form, and refuses a bound-goal bystander with the boundary-verb pointer and a conditioned re-arm remedy (a run resumed under a new session id whose bound predecessor is gone re-arms the goal with its whole queue, which rebinds it; any other session leaves the goal alone), both sentences single-sourced as module constants both verbs emit; clear mirrors those refusals over a record that is somebody's boundary, stays the exit-0 no-op over an absent path, and removes a record that is nobody's without asking for a caller id; the goal predicate treats a state file holding a non-object, an array, or an object carrying a binding with no usable plan as unreadable rather than as no goal armed; status names an unreadable goal state rather than an absent one; the gate's boundary deny note names three no-longer-honored causes and the operator's release chain (goal CLI status for the bound id, then consent for that session) with no open remedy; the deferral nudge and the queue advance pass the opener through. Documentation: docs/architecture.md's checkpoint CLI and boundary-note passages describe the verbs and the note as shipped, with the PreCompact-stderr audience marked as an observed harness property; docs/security-model.md's invariant names the four checkpoint legs, its checkpoint-file accepted risk names the manual recovery a planted non-regular file requires and the refusal line's induced-act conditioning as its only control, and a new accepted-risk paragraph records the deny note's audience premise as a review trigger; the executing-work skill's step 0 and step 8 name the caller-scope refusals and the re-arm remedy (section 2).
Decisions / Surprises: eight review rounds on one section, because five of the seven fix rounds reached the guard's legs or its refusal wording and each such fix owed another round; the plan's own acceptance clauses rather than a tally closed it, round 8 finding no Critical or Major on the adversarial and security passes. The checkpoints opened at interim boards 4 and 6 vanished with no compaction landing in this context; the gate's own log (.kit/compact-gate.jsonl) shows allow-checkpoint decisions under this session's id at 18:40Z and 19:43Z while this context never compacted, which fits a dispatched subagent's own auto-compaction arriving under the parent's session id and spending the leash holder's checkpoint (inferred from the log; the PreCompact payload's transcript path at those allows would confirm it, and the log does not record it); captured to the kaizen inbox as a gate defect (the gate reads no agent key off the PreCompact payload and the checkpoint discipline has no subagent leg), the note appended to kaizen/notes-SCOTT-CLAUDE.md and left uncommitted because that file carries a peer's uncommitted lines. The round 7 blind reviewer's prompt named line ranges, a diff-describing framing its charter forbids; the reviewer recorded the contamination and reviewed the whole delta, and round 8's blind prompt carried the base ref and file list only. The Workflow runs two agents at a time, so the security reviewer of each round started when the blind one finished. Section 2 was appended under the out-of-scope route while section 1 was in review (two round 5 reviewers named the skill), relayed at the append. The implementer's L2 resolution (an object carrying a boundSession that is not undefined or null, with no usable plan, refuses) stands: no kit writer produces that shape, confirmed by the round 8 adversarial and security reviewers against every writeState call site.
Review findings addressed: round 1 to 4 built and hardened the mechanism (opener field, wrong-opener gate leg, the shared guard and its leg order, GATE_REASONS pinned by source parse); round 5 J1 to J9 (bound branch owner test, phrase map for unreadable and lstat readings, the file phrase covering a normalizer-rejected state, status consulting the goal reading, the third boundary-note cause pinned, two comments restated as present fact, the record leg answering nobody where the opener is null, the no-open pin as a regex over the printed CLI path, the header pointing at the guard); round 6 K1 to K6 (boundary-verb pointer and conditioned re-arm at both verbs, the non-object goal predicate, header kinds and write-verb scope, the no-open pin's narrowed claim with a class-shaped leg over invoked verbs, the consent bound without a runnable form); round 7 L1 to L8 (both remedies single-sourced, the array and binding-without-plan shapes, the dead kind member dropped, header no-goal readings, whole-queue re-arm wording, no-verb-removes-it in the kind refusal, the queue advance's opener asserted on read-back, the stderr-channel claim stated as a harness dependency in the gate and two sibling hook comments); round 8 M1 to M5 (the identity pin bounded on the statement with a semicolon-inside-quotes control, the refuseUnreadableCheckpoint doc block placed above its function, the status comment restated, three duplicated re-arm legs retired from the clear test in favor of the identity pin, the two test phrase maps derived from the hook's source with count-parity controls); the doctrine-parity lane run over the two curated docs at 71/71/0 exit 0; three docs fixes of the orchestrator's per round. Not adopted, with the evidence: an age test in the bound branch (a resumed run is a bystander until re-arm by design; the refusal names the remedy); a fallback from an unresolvable caller to the binding, the blind reviewer's Critical in round 8 (the spec's declared default, raised every round; the Bash tool this session runs the CLI from does export CLAUDE_CODE_SESSION_ID, and every open this session ran from it succeeded); the claim that a dispatched subagent's shell carries an id of its own (the value every dispatched reviewer read from its own shell, 5eaa530f-6d41-4723-ac54-e4c54d15361f, is this session's, beside CLAUDE_CODE_CHILD_SESSION=1); letting the leash holder's open write through a symlink or FIFO at the checkpoint path (fail-closed by design, the accepted-risk paragraph names the manual recovery, and the refusal now says no verb removes it); adoptCheckpoint carrying a foreign opener verbatim (by design: under the binding such a record is nobody's boundary and the leash holder's next open replaces it, while the gate refuses it at wrong-opener meanwhile); the claim that an object with no plan and no binding lets open write a record (false: cmdOpen's no-goal leg refuses before any write); an arming-route exception for transient readings under an unbound goal; the transcript-text claim route in sessionHoldsLeash (a stated limitation of the goal library, self-healing at the next claim); closing the no-open pin's reach axis, declared unproven instead (both legs key on a verb immediately after a .js path, so a note phrased 'status, then open one' or a script path without that extension would pass them). Test retirement: three assertions retired inside one test (the clear test's duplicated re-arm fragments), no test retired, four added across the fix rounds since board 5 (K2 shape, L2 shape, L1 identity, M1/M5 instrument controls).
Assumptions: the harness sets CLAUDE_CODE_SESSION_ID in the Bash tool's environment and a dispatched subagent's shell inherits the dispatching session's id (confirmed from three reviewers' shells in three rounds, one harness version); PreCompact stderr reaches the operator's terminal and never the model (observed, now documented as a review trigger); the executing-work skill's word cap raise to 21381 is section 2's own step.
Stamps: memq unstamped --since 9h at board 6 listed 0 project-tier and 4 operator-tier records read and not applied; none shaped the work and none is stamped. Two records read at this boundary through sidecar pointers, skill-amendments-collide-with-neighbours (bears on section 2's review, whose reviewer reads the whole file) and size-ratchet-counts-words-after-the-frontmatter-strip (the cap figure above is kit-size's own count): neither stamped, each a read rather than a decision this section turned on.
Gate: section-close lane `node --test test/kit-compact-gate.test.js test/compact-deferral-nudge.test.js test/kit-goal-stop.test.js test/kit-goal-worktree.test.js test/chapter-boundary-nudge.test.js test/size-ratchet.test.js test/hook-canary.test.js test/kit-goal-lib.test.js test/doctrine-parity.test.js` 928 tests, 928 pass, 0 fail, exit 0, exit read from .kit/verify/s1-close-lane.exit (baseline on the eight-file lane before the section 845/845/0 at board 4's record; the round 8 implementer's kit-compact-gate.js file alone 336/336/0). Whole gate `node --test test/*.test.js` 3219 tests, 3209 pass, 1 fail, 9 skipped, exit 1, the one red being test/memory-session.test.js's 'a pinned directory too long to name faithfully stands the session down', the box-permanent case the suite-baseline memory records, so no regression against that baseline, exit read from .kit/verify/s1-whole-gate.exit, run under a heavy-process claim before the push since main is the install surface, read against the suite-baseline memory (test/memory-session.test.js's pinned-directory case is red on this box on every run and is not a regression). Build stamp refreshed before the lanes (build.ps1 exit 0).
Next: section 2 closes in this same changeset (Chapter 2 below); then finishing-work for the plan.

### Chapter 2 - 2026-09-06
Completed: section 2, The section loop names the refusals its two checkpoint steps can meet.
Implemented By: inline (main thread), prose only.
Commit model: Commit-and-Push, honored in this changeset with section 1.
What shipped: plugins/claude-kit/skills/executing-work/SKILL.md step 0 gains the clause naming the two refusals the clear can meet (another session's boundary; a state it cannot read, a present-but-unreadable goal or a non-regular file at the path) with the remedy for each (re-arm with the whole queue on a resumption under a new session id; move aside by hand what is not a checkpoint file), the no-op reading kept for the absent path; step 8 gains the clause naming the open's refusal to a caller the checkpoint would not bless with the same remedy, states that the CLI writes the calling session's id from its own environment so it runs from the session's shell, and narrows the regardless claim to a record the calling session may clear; test/size-budget.json raises the skill's word cap from 21223 to 21381, the file's kit-size count.
Decisions / Surprises: no review dispatched for this section, its deliverable being two clauses of skill prose with no behavior; the round 5 reviewers who named the skill are the reviewers of record for the need, and the finishing reviews read the skill delta with the rest of the changeset. The clauses state current fact and never the change.
Gate: `node --test test/size-ratchet.test.js test/doctrine-parity.test.js` ran inside the section-close lane above (the ratchet reads the raised cap; parity confirms the skill carries no doctrine-mirrored block this edit could desynchronize), 928 tests, 928 pass, 0 fail, exit 0 for the whole lane.
Next: finishing-work for the plan (QA verification, security and adversarial finishing reviews at fable high, docs curation, memory, kaizen offer, archive).
