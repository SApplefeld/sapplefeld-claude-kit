# Doc Close-Out Discipline and the Current-State Record

Status: Complete
Commit Model: Review-Only
Created: 2026-06-28

## Goal

Two recurring failures share one root, and this effort fixes both with one principle. (1) Plan docs drift from reality: an effort ships but its plan doc stays `In Progress` with an "uncommitted" Chapter, because the doc's terminal state was made contingent on an event outside the agent's loop. (2) Inline code comments narrate the session, the change, and the effort instead of the code's current purpose. Both are the same disease: a record that describes the journey instead of the destination. The fix is one doctrine principle (records state the current/terminal reality, not the change) plus a mechanical rule that a plan doc reaches its terminal state in the same delivery as the code, decoupled from the commit itself.

## Background (the live example)

`claude-kit_doctrine-delivery_spec_v1` (now archived) shipped in commit `c800e05` on 2026-06-26 under a Review-Only commit model. The executing agent finished all sections, correctly did not commit, wrote a hand-off Chapter ending "left entirely uncommitted for Scott's review" with a "Remaining (Scott): review + commit" list, and stopped. Scott reviewed and committed later, out of the agent's loop. Nothing flipped the status to Complete or archived the plan. It sat stale from 2026-06-26 until closed out by hand on 2026-06-28. The "uncommitted" and "Remaining: commit" lines were change-state, anticipatory text that rotted the instant Scott committed.

## Approach

1. **One unified principle in the doctrine.** Records (code comments AND plan Chapters) state what is true now and why, for a reader who never saw the work happen. Not the session, the change, the prior version, the bug fixed, or the effort spent. The journey lives in git history and the commit message; the record states the destination.

2. **Decouple finalize-the-doc from commit-the-doc.** Finalizing a plan doc (flip to Complete, write the close-out Chapter, archive via curating-docs) is not a commit; it is writing the truth. The agent does it whenever it believes the work is delivered and the gates passed, regardless of commit model. Under Review-Only, the agent stages the closed-out doc together with the code so Scott's single review-commit lands both atomically. The resting state when the agent believes the work is done is terminal-and-staged, never In Progress or uncommitted. A Scott-requested change reopens it: new round, new Chapter.

3. **Reinforce where subagents and style live.** Cross-reference the comment rule from csharp-style and sql-style (one line, not a duplicate), and forward it in the implementer agent briefs, since subagents start blank.

4. **Lean on the existing backstop, do not add a fragile hook.** The fixed `stop-docs-hygiene` Complete-but-unarchived check is the net. A new "looks done but still In Progress" detector is explicitly out of scope unless the discipline proves insufficient; the 2026-06-28 README false-positive is the cautionary tale for adding more regex hooks.

## Sections of Work

### 1. Unified current-state rule in the doctrine
Model: fable
Add to `operating-instructions` a rule covering both code comments and plan Chapters. Draft wording:

> **Comment the current state, not the change.** A code comment documents what the code does now and why, for someone reading it cold who never saw the work happen. Never reference the session, the task, the prior version, the bug being fixed, or the effort spent. "Validate the token before use." not "Added validation to fix the login bug" or "Now we check the token per the new spec." Change-narrative belongs in the commit message or PR, not the code.

> **A plan doc reaches its terminal state in the same delivery as the code.** Finalizing the doc (flip to Complete, write the close-out Chapter, archive) is not a commit; it is writing the truth, so do it whenever the work is delivered and the gates passed, regardless of commit model. Under Review-Only, stage the closed-out doc with the code so one review-commit lands both. The resting state when you believe the work is done is terminal-and-staged, never In Progress or uncommitted. A change Scott requests reopens it: new round, new Chapter. A Chapter states current/terminal fact ("delivered in this changeset"), never an anticipatory note ("left uncommitted; Scott will commit") that rots the moment it is acted on.

Acceptance: both rules present in `operating-instructions`; no em dashes; reads coherently with the existing Style and execution-loop sections.

### 2. Finishing-work and executing-work mechanics
Model: fable
`finishing-work`: state that the doc reaches terminal state and is staged with the code as part of the close-out, including the Review-Only hand-off; add an "excuses that defeat it" table (the writing-skills pattern) for the deferral rationalizations ("I'll flip it after Scott commits", "Review-Only means leave it open"). `executing-work`: when a Review-Only effort's sections are done and gates pass, the doc is finalized-and-staged, not left open.
Acceptance: both skills carry the decoupled finalize-vs-commit rule and the Review-Only hand-off; the deferral excuses are named.

### 3. Cross-reference in style skills and implementer briefs
Model: fable
`csharp-style` and `sql-style`: one-line cross-ref to the doctrine comment rule (the existing "labels not narration" guidance stays; this adds the temporal axis). `implementer-opus` and `implementer-sonnet`: one line forwarding the current-state comment rule.
Acceptance: cross-refs present; no duplication of the full rule.

### 4. Baseline-test the behavior-shaping wording (writing-skills)
Model: opus
The wording is behavior-shaping and prior wording did not stick (Scott's own observation). Run the writing-skills RED/GREEN check on the two doctrine rules: RED that a fresh agent under Review-Only leaves the doc open or writes a change-state comment; GREEN that the new wording flips the doc and writes a current-state comment.
Acceptance: RED reproduced and GREEN confirmed for both rules, recorded in a Chapter.

## Out of Scope

- A new enforcement hook for "looks done but In Progress" (rely on the fixed backstop; revisit only if discipline fails).
- The Daren-harvest items (SQL EXECUTE-AS fix, adversarial-reviewer security bullet, crypto clause) - separate, tracked from tonight's comparison.
- Rewriting the existing csharp/sql "labels not narration" guidance (only adding a cross-ref).

## Open Questions

1. Resolved (decided 2026-06-28): two distinct bullets as drafted, the comment rule in the Style section and the doc-close-out rule in the execution loop. Scott's call.
2. Resolved (decided 2026-06-28): keep Section 4's baseline test. Scott judged it well worth the cost, since prior wording did not stick.

## Related

- `docs/archive/claude-kit_doctrine-delivery_spec_v1.md` - the effort whose stale doc is this spec's live example.
- The `csharp-style` and `sql-style` skills (existing comment guidance this extends).
- `writing-skills` (governs the behavior-shaping wording and Section 4).

## Chapters

### Chapter 1 - 2026-06-28
Completed: Section 1 - Unified current-state rule in the doctrine.
Implemented By: main session (fable tier).
Decisions / Surprises: Scott chose two distinct bullets, not merged, and to keep the Section 4 baseline test (decided 2026-06-28). The comment rule lives in operating-instructions Style; the doc-close-out rule lives in The execution loop, connected by "like a code comment" so the shared current-state spine reads across both sections.
Review Findings: per-section adversarial review deferred to the finishing pass; this is behavior-shaping text and the writing-skills baseline test (Section 4) is the real gate.
Next: Section 2 - finishing-work and executing-work mechanics.
Commit Model: Review-Only (staged at close).

### Chapter 2 - 2026-06-28
Completed: Section 2 - finishing-work and executing-work mechanics.
Implemented By: main session (fable tier).
Decisions / Surprises: finishing-work already prescribed flip-to-Complete plus archive (step 5) and Review-Only stage-then-stop (step 6); the machinery was right, the gap was the deferral. Added a "Finalizing the doc is not committing it" guard plus a three-row excuses-that-defeat-it table to step 5 (the writing-skills prohibition form for a known-rule-skipped-under-pressure failure). executing-work's close-out trigger now states the rule holds under Review-Only.
Review Findings: deferred to the finishing pass and the Section 4 baseline test.
Next: Section 3 - cross-reference in style skills and implementer briefs.
Commit Model: Review-Only (staged at close).

### Chapter 3 - 2026-06-28
Completed: Section 3 - cross-reference in style skills and implementer briefs.
Implemented By: main session (fable tier).
Decisions / Surprises: Added a "change-narrative comments" antipattern bullet to csharp-style and sql-style, each cross-referencing the doctrine's current-state rule (the existing "labels not narration" guidance kept; this adds the temporal axis). Forwarded the current-state comment rule into both implementer briefs' Process step 3, since implementers read the style skills but not the doctrine.
Review Findings: deferred to the finishing pass and the Section 4 baseline test.
Next: Section 4 - baseline-test the behavior-shaping wording.
Commit Model: Review-Only (staged at close).

### Chapter 4 - 2026-06-28
Completed: Section 4 - baseline-test the behavior-shaping wording (writing-skills RED/GREEN).
Implemented By: main session orchestrating 12 fresh general-purpose probes (opus tier).
Decisions / Surprises: Two rounds.
- Round 1 (single pressure, 2 reps per condition): RED did NOT reproduce either failure. Fresh agents wrote current-state comments ("// Validate the token before use...") and flipped Status to Complete unprompted. Per writing-skills, a non-reproducing RED means the test was too weak, not that the rule is moot.
- Round 2 (combined pressure): both failures reproduced and both GREENs fixed them.
  - Comment rule under MIMICRY (a file whose existing comments are all change-state): RED mimicked the habit ("// Added audit logging on cancel per the compliance ask from INC-4471."); GREEN overrode it ("// Cancels the order and records the cancellation in the audit log."). Validated.
  - Doc rule under DEFERRAL (write the closing line knowing you will not witness the commit): RED produced the anticipatory rot ("Remaining: ... awaiting Scott's review and commit"); GREEN used terminal framing ("delivered in this changeset; Staged for Scott's review"). Validated for its real target.
Honest limit: the doctrine-delivery failure had two parts, status left In Progress and anticipatory Chapter text. Fresh agents reliably flip to Complete on their own, so the doctrine bullet's value for the status-flip is low in isolation; its demonstrated value is suppressing the anticipatory-note rot under pressure. The full doctrine-delivery dynamic (the close-out deferred across a turn boundary while Scott commits out-of-loop) is multi-turn and beyond a one-shot probe, so the finishing-work anti-deferral guard (Section 2) is the load-bearing fix for that case, not the bullet alone.
Review Findings: the baseline test is the gate; the wording holds where a probe can test it. Whole-changeset adversarial review runs in finishing-work.
Next: finishing-work.
Commit Model: Review-Only (staged at close).

### Chapter 5 - close-out (2026-06-28, finishing-work)
Completed: finishing-work pass; effort complete, finalized, and staged for Scott's review-commit (Review-Only).
Effort summary: one principle, current-state-not-change-state, now governs both code comments and plan Chapters. operating-instructions carries two new bullets (the comment rule in Style, the doc-close-out rule in The execution loop). finishing-work decouples finalizing the doc from committing it, with an anti-deferral excuses table; executing-work echoes it. csharp-style and sql-style gain a change-narrative antipattern cross-referencing the doctrine; both implementer briefs forward the comment rule inline. Baseline-tested (Chapter 4): validated under mimicry and deferral pressure.
Review outcomes:
- QA: no build or test framework (markdown wording). The gate is the Section 4 baseline test plus the adversarial pass; acceptance criteria met.
- Security: N/A (no code surface; the separate stop-docs-hygiene hook fix was verified on its own and is out of this effort's scope).
- Adversarial (whole changeset): APPROVED_WITH_CONCERNS. One Minor fixed - the doc bullet mixed narrator ("I request" then a quoted "Scott will commit"); the quoted example is now voice-neutral ("left uncommitted, to be committed later"). No Critical or Major.
- Docs: this effort's deliverable IS skill and doctrine text, so no code-to-docs drift surface; a separate docs-curator pass was not warranted and the adversarial pass covered consistency.
Durable learning banked to memory: kit hook and skill edits are not live until the plugin is rebuilt or reinstalled (or committed, pushed, and /plugin update'd); the running copy is at CLAUDE_PLUGIN_ROOT, not the repo.
Staged for review: the seven skill and agent edits plus this plan (Complete, archived). Scott reviews git diff --staged and commits.
Commit Model: Review-Only.
