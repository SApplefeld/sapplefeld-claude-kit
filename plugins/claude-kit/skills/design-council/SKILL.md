---
name: design-council
description: "Convene a read-only, multi-lens design council to pressure-test competing approaches at a genuine architecture fork. Offered by the brainstorming skill when a decision is material and hard to reverse - architecture, schema/data-model, build-vs-buy, a migration direction - and directly invocable when I ask to 'convene the council', 'pressure-test this approach', or 'get multiple angles on this design' before building. Not for reviewing written code (use adversarial-reviewer) or non-code judgment calls (use cold)."
---

# Design Council

Structured, evidence-grounded convergence for a design fork. Several lenses take independent positions, then argue them through a neutral facilitator until each disagreement is either resolved with evidence or handed to me as a clean choice. The point is to add design-stage adversariality - the kit reviews implementations from five angles and approaches from one - without replacing the conversation with me or my decision.

The failure mode this is built against is **false convergence**: models are agreeable by default and will "agree" by capitulation if you let them. Every rule below exists to keep genuine disagreement visible until evidence - not politeness - settles it.

## Roles

- **Orchestrator** - the main session running this skill. Holds my context and intent. Frames the fork, dispatches agents, carries text between rounds, and presents the result to me. The orchestrator does not judge convergence and is not a council member.
- **Council members** - read-only `council-member` agents, one per lens. Research the real repo/data, take positions, engage each other across rounds. They start blank: the brief carries the lens and everything they need.
- **Facilitator** - one read-only `design-facilitator` agent, neutral. After each round it maps agreement vs. live disagreement, names the crux of each dispute, classifies convergence as evidence-resolved or capitulation, and decides another round / converged / deadlock. Separate from the orchestrator by design, so my design partner never declares the debate settled.

## 0. Opt-in check

This skill runs agents and spends tokens. Before dispatching anything, confirm I opted in - via the brainstorming offer or a direct request. If invoked cold, restate the fork and the roster and get my go first. Never auto-run.

## 1. Frame (orchestrator + me)

State the decision as an **outcome** (what is true when it is done) plus the 2–N candidate approaches on the table. Outcome framing widens the debate - "profile reads return under 50ms and don't hit the DB when cached" makes the council weigh caching against query optimization; "add a Redis cache" pre-commits the argument. Pick the lens roster (default three): performance, maintainability/architecture, risk-security (reads `docs/security-model.md` if present). Swap a lens to fit the fork - a data-model lens on a schema decision, an opposite-approach steelman when one option is the obvious favorite. Name the cost to me (seats × round cap) and proceed on my yes.

## 2. Round 1 - blind independent positions

Dispatch each member separately and in parallel. Each brief contains, verbatim (members inherit nothing): the outcome, the candidate approaches, that member's lens, the repo paths/data worth reading, and the read-only constraint. Members must not see each other's briefs or outputs this round - blindness is what puts genuine divergence on the record before anyone anchors. Each returns a position grounded in evidence it actually read (file:line, schema, real data), plus its strongest objection to each alternative.

## 3. Facilitator pass

Hand the facilitator all member positions. It returns: the map of agreement, the live disagreements (attributed), the crux of each (the factual or value question that would settle it), and a status - CONVERGED, ANOTHER_ROUND (with a specific targeted question per member), or DEADLOCK. Convergence after one round is rare and suspect; treat an instant CONVERGED as a prompt to check it wasn't just three correlated models agreeing.

## 4. Cross-examination rounds (until the facilitator stops)

For each ANOTHER_ROUND, re-dispatch the named members. A re-dispatched member is a fresh agent handed the full transcript - for a stateless model that is identical to "the same expert continuing," so nothing is lost. Each cross-exam brief carries: the member's own prior position, the other positions, and the facilitator's targeted question for it. Each member must engage the strongest objection aimed at it - concede, rebut with evidence, or revise - and report what it conceded versus held. Then run another facilitator pass. Stop on CONVERGED or DEADLOCK, or when the round cap (default three) is hit.

## 5. Deliver to me

Present the facilitator's synthesis: the converged recommendation (if any) with the evidence and trade-offs behind it, and - prominently, never buried - any unresolved fork, framed as my decision with the options and what each optimizes for. If the council deadlocked or hit the cap, say so and show the standing positions; do not paper over it. I decide; record the decision and its rationale in the plan doc per the kit. The council informs the call; it never makes it.

## False-convergence defenses (hard requirements)

1. Round 1 is blind - divergence captured before cross-talk.
2. The facilitator is a separate neutral seat, never the orchestrator or a member.
3. The facilitator classifies each resolved point as evidence-resolved or capitulation; a member that caved without citing why is flagged as soft convergence, not accepted as agreement.
4. Genuine value trade-offs escalate to me - never auto-resolved.
5. The round cap bounds agreeable drift; hitting it without real convergence returns "unresolved - standing positions follow," not a forced consensus.
6. Every load-bearing claim cites evidence the member actually read. Ungrounded assertions carry no weight - a finding is a hypothesis until confirmed.

## Cost envelope

Default three seats, three cross-examination rounds maximum; members are read-only. Offered only at genuine forks, and the offer names the cost so I authorize the spend. I can cut the roster, cap rounds, or decline at any point.

## Provenance

The blind-then-converge protocol is adapted from the *Converge* concept in DheerG/swarms (MIT). No code was copied; the mechanism is re-expressed in this kit's idioms - read-only subagent dispatch, doer≠reviewer separation, evidence-grounded claims, and a plan-doc decision record - and runs on stable Claude Code without the experimental agent-teams harness.
