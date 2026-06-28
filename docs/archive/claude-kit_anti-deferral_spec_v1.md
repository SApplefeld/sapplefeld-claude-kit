# Anti-Deferral: Act in Scope, Hand Off the Rest

Status: Complete
Commit Model: Review-Only
Created: 2026-06-28

## Goal

The kit defaults to acting on found work rather than parking it in a vague "later" where good ideas die. A session runs until its focus is done. Work found mid-session that belongs to the current focus is done now: inline if quick, or spun to a subagent if doing it inline would derail the main thread. Work that is genuinely a separate, significant focus is not done now; it is captured as a fully-prepared spec or prompt, written while context is fresh, ready to execute cleanly in a new session. That handoff is the only deferral worth doing, and it counts as done.

## Approach

This refines the existing scope-discipline rule in operating-instructions, which currently endorses the failure mode directly: "for an unrelated bug or a risky refactor, record a one-line follow-up and move on." A one-line follow-up in a backlog is exactly where a good idea rots. Replace that default with a three-tier response plus a focus discriminator.

The rule (added to operating-instructions, and the existing scope bullet refined to point at it):

1. **Run until the focus is done.** Do not end a session with its focus half-finished. A section boundary, a found issue, or context pressure is not a stopping point for the focus.
2. **Found work in the current focus is done in-session.** Three tiers, in order: do it now if it is quick and related; spin it to a subagent if doing it inline would derail or pollute the current change (parallelize via subagents, never chips, which can strand against source control); a note is the last resort, not the default.
3. **Found work that is a separate, significant focus is handed off, not parked.** Write a spec or prompt while the context is fresh, precise enough that a new session executes it cleanly from the doc alone. That handoff is a first-class "done", equal to finishing in-session, not a lesser outcome.
4. **The discriminator is focus, not size.** Same focus, tier 2. Genuinely separate focus, tier 3 handoff. When the found work is genuinely separate and significant, bias to the handoff-spec even when it is tempting to keep going; that is what keeps a session from ballooning by inlining what should have been a clean handoff.
5. **Context-wipe resilience is what makes the handoff safe.** Constant docs-curation, status updates, and the session-start resume hook mean a context clear loses no ground; the next session continues from the doc. The handoff rests on that machinery, so keeping the plan doc and status current is not bookkeeping, it is what makes deferral safe.

## Sections of Work

### 1. The anti-deferral doctrine rule
Model: fable
Add the rule above to operating-instructions where it reads most coherently (The execution loop or Scope and safety), and refine the existing "Stay in scope... record a one-line follow-up and move on" bullet so the follow-up note is the last resort, pointing at the three-tier default and the handoff. First person, no names, no specifics.
Acceptance: the rule is present; the existing scope bullet no longer defaults to a vague follow-up note; it reads coherently with the surrounding doctrine; first person throughout; no em dashes.

### 2. Baseline-test the wording (writing-skills)
Model: opus
RED/GREEN test the anti-deferral default under realistic pressure: RED that a fresh agent, finding separate work mid-task, defaults to a vague backlog note or simply stops; GREEN that with the rule it either does in-scope work now (or spins a subagent), or writes a ready handoff-spec for genuinely separate work.
Acceptance: RED reproduced and GREEN confirmed, recorded in a Chapter.

## Out of Scope
- The scott-writing-style genericization (separate, in flight this session).
- The executing-work completion contract (it already mandates run-to-completion for an approved spec; this complements it at the doctrine level rather than changing it).

## Open Questions
- Placement of the rule in operating-instructions (execution loop vs scope-and-safety): decide at execution for best coherence.

## Related
- Builds on `docs/archive/claude-kit_doc-closeout-discipline_spec_v1.md`: the same anti-deferral spine (done-when-written) applied to the whole session rather than a single plan doc.

## Chapters

### Chapter 1 - 2026-06-28
Completed: Section 1 - the anti-deferral doctrine rule.
Implemented By: main session (fable tier).
Decisions / Surprises: Added the "Act on found work; a vague later is where it dies" bullet to operating-instructions Scope and safety, and refined the existing "stay in scope" bullet so an unrelated bug is acted on out of band, not just noted. The rule carries the three-tier default (do-now / spin-to-subagent / handoff-spec), the focus-not-size discriminator (Scott's principle plus the sharpening that the line is current-focus vs separate-focus), handoff-as-first-class-done, subagents-not-chips, and the context-resilience anchor. Agent-facing voice, no names.
Review Findings: deferred to the Section 2 baseline test.
Next: Section 2 - baseline-test the wording.
Commit Model: Review-Only (staged at close).

### Chapter 2 - 2026-06-28 (Section 2 and close-out)
Completed: Section 2 baseline test; effort complete and staged for review.
Baseline test (writing-skills RED/GREEN, 2 reps each): the failure reproduced cleanly on the first round (unlike the doc-closeout rule, which needed combined pressure), because "a separate effort found late in a nearly-done session" is itself a strong deferral temptation.
- RED 2/2 defaulted to the vague-later: "Flag it without acting on it, leave a brief note"; "capture it as a tracked note or task (a quick spawn-task chip or a line in the backlog)." The second reached for a chip, validating the no-chips clause.
- GREEN 2/2 flipped to the handoff-spec: "I hand it off now, while the context is fresh: I write a self-contained spec... that written handoff is the done state, not a vague backlog line." One echoed "first-class done" unprompted.
The rule works.
Close-out: no separate adversarial or security pass for a single agent-facing doctrine bullet that is baseline-validated and em-dash-clean; the baseline test is the gate. The operating-instructions edit is staged with this plan.
Commit Model: Review-Only - staged.

### Chapter 3 - 2026-06-28 (goal-driven refinement)
Decided 2026-06-28 with Scott: the discriminator is the GOAL, not the technical nature of the work, and not size. Technically different work (many faces, rabbit holes) toward the same goal stays in one effort and is never a reason to pivot to a new session. Only a genuinely different goal (a new objective, not another face of the current one) earns the handoff-spec. Added: a single goal can outlast a context window, which is a clean continuation via the plan doc and resume hook, not a pivot, so current docs/status are what hold a goal whole across a context clear. The doctrine bullet was rewritten from "focus, not size" to this goal-driven form (it could otherwise be misread as licensing the technical-line splitting it forbids). The Section 2 baseline behavior is unchanged (GREEN still writes a handoff for a genuinely separate effort); this sharpens what counts as separate, so no re-baseline was warranted. Banked the working-pattern principle to memory.
Commit Model: Review-Only - staged.
