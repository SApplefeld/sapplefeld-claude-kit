---
name: consult
description: "Convene one fresh-context judge (the consultant agent) to rule on a question this session cannot settle. Use mid-execution at the trigger floor - a second failed attempt at the same problem, any BLOCKED that turns on a decision, a debugging dead end, a weighty decision the spec does not cover - and when the operator asks to 'get a consult on X' or wants a 'second opinion on this problem'. The session that needs this rarely feels stuck; it feels almost done, so check the floor, not the feeling. Not a diff review (the adversarial and blind reviewers) and not design-time divergence (design-council)."
---

# The Consult

One read-only fresh judge, the `consultant` agent, ruling on one question a stuck session could not settle. The consultant never saw this session's transcript, and that blindness is the value: the framing reaches it as text rather than as its own reasoning, so it can test the frame where the session can only extend it. It rules rather than surveys, tests the querent's framing rather than ratifying it, and ends implementable. The kit uses no in-context advisor; the consult is its escalation instrument.

## The trigger floor

Stuck sessions do not feel stuck - they feel almost done. So the triggers are a counted floor, recognizable by a re-reader rather than dependent on felt difficulty, plus a general license on top:

- **(a) A second failed attempt at the same problem**, whatever its shape: an implementation round, a debugging hypothesis, a review round, a review seesaw (the second reversal of one passage's fix). Where executing-work's tier-escalation ladder already owns the moment, it governs: a second failed review round whose Criticals repeat a class is a tier problem rather than a framing one, and the consult is for the branch where no class repeats and the spec's own premise is the generator.
- **(b) Any BLOCKED that turns on a decision.** Consult first; only the preference, cost, or risk-appetite fork that survives goes to the operator, with the ruling attached. An external dependency only the operator can satisfy, and a destructive action waiting on their yes, are not decisions to rule on: those go straight up.
- **(c) A systematic-debugging dead end**, before the stop-and-report.
- **(d) The general license:** a decision that is hard to reverse or load-bearing, not covered by the spec, where you would otherwise be guessing.

The preference-versus-facts discriminator governs (b): a spec gap is the operator's to answer only where the answer turns on preference, cost, or risk appetite; where it turns on facts about the system it is rulable. A mixed question is ruled first, so what reaches the operator is the small real fork rather than the whole tangle.

## The brief

The brief carries:

- The decision, stated plainly. A consult arriving without a decision to rule on gets NEEDS_CONTEXT back, not a survey.
- The evidence. For a review-failure consult, the rounds' surviving findings; for a debugging consult, the hypothesis history.
- The repo paths worth reading.
- The querent's current lean, explicitly labeled as an instinct to test - the consultant checks it, never ratifies it.
- What an implementable answer would look like.

Bulky evidence goes to the gitignored `.kit/` scratch path and rides in the brief as a path, never pasted inline.

Writing the brief is itself part of the mechanism, not overhead: the briefing cost is what forces the problem outside the session's own reasoning loop.

## The model rule

Fable at `high`, the consultant agent's frontmatter default: a plain Agent-tool dispatch of `consultant` with the fable model override. Where this consult could not be run at the fable tier in this environment - confirmed per the unavailability rule the finishing-work skill owns, its triggers included - the stand-in is Opus at `max` through `Workflow`'s `agent()`, filling executing-work's Reviewer Dispatch template with all three fields named explicitly: `agentType` (`claude-kit:consultant`), `model`, and `effort`. That template owns why each field is required; a consult dispatch just fills it in. The doctrine's standing-dispatch bullet carries the operator's request for both routes, so convening a consult at the triggers is autonomous: no per-plan ask, no per-session ask.

The model choice is static, never dynamic: the consult fires at exactly the moment the session's judgment is compromised, so any rule that asks the stuck session to pick a tier correctly fails precisely when it is needed. And the consultant is gate-shaped, which is why it earns the compensation notch: a shallow ruling gets adopted and steers the section with nothing downstream re-asking the question.

## Adjudication

The consultant returns a RULING with its EVIDENCE and CONFIDENCE, plus an OPERATOR FORK when one survives. The ruling is a hypothesis until you check it against the real code. Adopt what holds; record in the Chapter both the ruling and what was discarded and why. When the ruling leaves a genuine preference fork, that fork goes to the operator as the BLOCKED, with the ruling attached.

## Consult versus its siblings

- **The consult** checks the frame: fresh context, a single seat, convenable mid-execution.
- **design-council** is multi-lens divergence at design time, with the operator present to adjudicate.
- **cold** is fresh judgment for when the operator's own preference contaminates the framing.
- **The reviewers** judge diffs, not questions.
