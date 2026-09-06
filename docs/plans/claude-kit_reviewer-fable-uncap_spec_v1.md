# Run every per-section reviewer at Fable with effort set by lens, and retire the Opus cap

Status: In Progress
Commit Model: Commit-and-Push
Disjoint: yes
Created: 2026-09-05

## Goal

Every per-section reviewer dispatch runs at Fable whatever tier wrote the section, with effort set by how far the lens has to read outside the diff: the code pair and the document pair at `low`, the security reviewer at `medium`, and the finishing reviews unchanged at `high`. The rule that bumped a reviewer one tier above the writer and capped the bump at Opus is gone, together with the Opus `max` row it was folded into, and the `max` compensation survives only for the case it was built for: a Fable gate this environment could not run. The reviewer agents' frontmatter carries the per-section effort so the common dispatch rides the Agent tool with no effort override, and the finishing pass takes the Workflow route to reach `high`. When this is done the rule reads in one place with no tier arithmetic in it, every restatement of it in the kit agrees, and the open reviewer-tiering experiment in `docs/backlog.md` carries the change as its next dated amendment with a pre-change baseline recorded in this plan's Chapter 1.

## Dispatch Authorization

Authorized 2026-09-05 by the operator at the keyboard of the KIT: Expert session, who chose the three effort levels by name (Fable Low for the section pairs, Fable Medium for the security reviewer, Fable High for finishing) and asked that the Expert seat run the change directly in the shared checkout rather than queue it. The Expert seat authored this spec after that instruction and executes it unleashed, since the checkout's goal state is another session's live leash and a bare arm here would replace that queue.

## Approach

**The rule today.** `plugins/claude-kit/skills/executing-work/SKILL.md` step 3 runs each per-section reviewer one tier above the section's writer tier, capped at Opus: haiku at sonnet, sonnet at opus, opus at opus, fable at fable, with the security reviewer never at Fable per section. Its effort table sends a Fable reviewer to `high`, an Opus reviewer one tier above its writer to `xhigh`, and an Opus reviewer with no headroom to `max`, that last row covering three cases at once: the capped review, the security reviewer over a fable-tier section, and an Opus standing in for a Fable gate that could not run. The cap arrived in commit e181897 on 2026-08-19, and its message states the reason: per-section reviewers were to stop drawing on the Fable allotment for sections written at Opus or below. The `max` row predates it (the reviewer-effort-compensation plan of 2026-08-11) and was built for unavailability alone; the cap change re-grounded that row on a "headroom" argument so the capped path could share it.

**Why now.** The cap's premise was the Fable allotment under Fable 5.0 pricing. On Fable 5.1 the operator has run a Fable Low orchestrator for a working day without visibly moving the usage bars, which is the operator's reported reading and the basis of this decision. The other half of the argument is where the kit's tokens actually go: review rounds are the place plan runs spin, four rounds on one section being the current worst case on the write-time-neighbours plan, and a stronger reviewer that is more complete on its first pass is expected to cost less in total than a capped one that finds the same defects a round at a time. That expectation is the experiment this plan opens, and the backlog item is where it is judged.

**The rule wanted.** Every per-section reviewer dispatch, code pair, document pair and security reviewer alike, runs at `fable`. Effort follows the lens: the adversarial reviewer, the blind reviewer, the blind reader and the prose reviewer at `low`, the security reviewer at `medium`, both being those agents' own frontmatter defaults after this plan, so a per-section round rides the Agent tool with the `fable` model override on a below-fable session and no override at all on a Fable-led one. The finishing reviews stay at `fable` and `high`, which is no longer any reviewer's frontmatter default, so finishing-work's default path moves to `Workflow`'s `agent()` with all three template fields named; where that route is unavailable in a session, the bare fallback is the Agent tool at `fable` carrying the frontmatter effort, recorded as a lower-effort finishing pass rather than a compensation. The consultant is untouched: `high` in its frontmatter, Fable by rule, Opus at `max` when Fable could not run.

**Effort, argued.** One question generates the levels: how far outside the diff must the lens read to earn its findings? The blind lenses read the diff or the document alone by design, and the adversarial reviewer reads the section against its spec; both are bounded by the section, so `low`. The security reviewer chases boundaries the diff only touches, callers, configuration, the shell and the network edge, so it takes `medium`. The finishing pass reads the whole changeset for cross-section cohesion, so it keeps `high`. The operator named these three levels. The one known trait of Fable 5.1 at `low` is a reluctance to make tool calls, and the Expert seat's own recommendation was `medium` for every sighted lens on that ground; the operator chose `low` for the adversarial reviewer with the backlog experiment as the check, and the review-round counts in the Chapter Metrics of later plans are what will show whether that trait costs findings.

**Compensation, narrowed back.** The `max` row returns to its 2026-08-11 ground: an Opus reviewer standing in for a Fable gate that finishing-work's unavailability rule confirmed could not run here, at `max` through Workflow, whatever effort the Fable dispatch would have carried. The "headroom" ground the cap change added to the compensation-notch paragraph goes with the cap, since no per-section reviewer sits at or below its writer's tier any more. The implementer half of that paragraph is unchanged: an implementer never takes the notch.

**What it costs, argued.** Every section's reviewers move onto Fable, where before only fable-tier sections' pairs did. Across the 138 sections in this repo's archive as counted by the cap plan, 45 opus-tier, 26 sonnet-tier, 2 inline and 1 haiku section would have moved; the compensating claim is that `low` on Fable 5.1 prices below Opus `max`, which is the operator's reading and not measured here. If the usage bars move faster than the operator accepts, the revert is one commit restoring the tier-up rule, and the operator has named that exit in advance.

**What stays fixed.** `consult/SKILL.md`; finishing-work's unavailability rule and its compensating route; the doctrine's standing-dispatch bullet, whose Workflow purpose (a read-only agent at an effort the Agent tool cannot set) is exactly what the finishing pass now uses; the reviewer agents' bodies and tool lists; the security-reviewer's finishing coverage.

**Close condition.** `docs/backlog.md` carries the open experiment "effort dials and reviewer tiering in flight", whose stated close is to judge the levels on Chapter Metrics. This plan adds a dated amendment to that item naming the new levels and pointing at this plan's Chapter 1 for the post-cap baseline it is judged against. No second experiment opens.

**Revert.** One commit restores the step 3 sentences, the table, the five frontmatter lines, finishing-work's default path, the brainstorming enumeration, the architecture clause and the ownership-map row. No runtime state, no migration. A running session reads skills and agents from its frozen plugin view, so neither this change nor its revert reaches a live worker until `claude plugin update` and a restart.

## Sections of Work

### 1. Reword the rule, re-pin the frontmatter, and bring every restatement into agreement
Model: fable
Locus: inline

Load the `writing-skills` skill before editing: this is a rule-parameter change to behavior-shaping skills, so let that skill decide whether a behavior test is needed (none is expected, no test pins the cap sentence or the table) and record its call in the Chapter. Reviewers for this section run under whatever rule this session's frozen plugin view carries, which is the pre-change rule with the cached agents at `high`; say so in the Chapter.

**Baseline first, before any file is edited.** Dispatch a scout (executing-work owns the scout banding and return contract) to build one table from the Chapter Metrics lines of the kit plans archived since 2026-08-19 in `docs/archive/` (the date the cap shipped): plan, section, writer tier, reviewer tier, review rounds, surviving Criticals. Metrics lines are free-form; a cell the record does not state is left blank rather than inferred. Record the table in Chapter 1 as the post-cap baseline the backlog experiment judges the new levels against.

Then, in `plugins/claude-kit/skills/executing-work/SKILL.md` step 3: replace the bold tier-up sentence and the sentences that depend on it (the security exception, the inline-section tier, the untiered-section rule, the escalated-tier cap, the fable-tier pairs' override remark) with the rule wanted, keeping the unavailability sentence and its pointer at finishing-work; replace the reviewer-effort table and its generator paragraph with a table of the three per-section levels plus the finishing level (finishing-work's, referenced) and the compensation row, each naming its route (Agent tool at frontmatter default, or Workflow); update the "Dispatching a reviewer above its frontmatter default" lead so it names the finishing pass and the compensation as the two dispatches that take the route; rewrite the compensation-notch paragraph's "headroom" ground back to the unavailability ground; and drop the word "capped" from the document-pair sentence. In the tier-escalation bullet, keep the implementer clause and remove the reference to the cap applying after an escalation.

In `plugins/claude-kit/agents/`: set `effort: low` on adversarial-reviewer, blind-reviewer, blind-reader and prose-reviewer, and `effort: medium` on security-reviewer. No other frontmatter or body line changes.

In `plugins/claude-kit/skills/finishing-work/SKILL.md`: the paragraph stating that `high` is the reviewers' own frontmatter effort and needs no override becomes the Workflow route at `fable` and `high` with the bare fallback named; step 3's "otherwise fable at `high`" gains the route; the compensating paragraph is unchanged.

In `plugins/claude-kit/skills/brainstorming/SKILL.md`: the expected-Fable-surface enumeration names every per-section reviewer dispatch whatever the writer tier, in place of the capped-bump clause.

In `plugins/claude-kit/skills/operating-instructions/references/ownership-map.md`: the review-roster row names the reviewer model rule rather than the tier-up rule.

In `docs/architecture.md`: the one clause describing the tier-up rule and its cap becomes the rule wanted, and finishing-work's "two states" sentence stays true as written.

In `docs/backlog.md`: append a dated amendment to the open experiment item naming the new levels, the reason, and this plan's Chapter 1 as the baseline.

Files in scope: `plugins/claude-kit/skills/executing-work/SKILL.md`, `plugins/claude-kit/skills/finishing-work/SKILL.md`, `plugins/claude-kit/skills/brainstorming/SKILL.md`, `plugins/claude-kit/skills/operating-instructions/references/ownership-map.md`, `plugins/claude-kit/agents/adversarial-reviewer.md`, `plugins/claude-kit/agents/blind-reviewer.md`, `plugins/claude-kit/agents/blind-reader.md`, `plugins/claude-kit/agents/prose-reviewer.md`, `plugins/claude-kit/agents/security-reviewer.md`, `docs/architecture.md`, `docs/backlog.md`.

Acceptance: a grep of the plugin and `docs/*.md` for `one tier up`, `past opus`, `opus at opus`, `xhigh`, `no tier headroom` and `capped` (in the reviewer sense) returns only this plan and the archive; the five frontmatter lines read as specified; the targeted lane (`test/doctrine-parity.test.js`, `test/output-style-parity.test.js`, `test/size-ratchet.test.js`, `test/readonly-agent-guard.test.js`, run single-file) is green against the baseline recorded before the edit; and no edited skill grows past its size-budget cap.

## Out of Scope

- Any change to the consultant's tier or effort, or to the unavailability rule's triggers.
- The implementer tiers, the tier-escalation ladder, and the implementer effort pins.
- Measuring the outcome: the backlog experiment owns the judgement, on later plans' Chapter Metrics.
- Installing the change on this machine (`claude plugin update`) and restarting the worker: operator actions, listed under Operator Verification.

## Assumptions

- Fable 5.1 at `low` prices below Opus at `max` for a review dispatch: the operator's reported reading, unmeasured here, and the revert is named above if it proves wrong.
- The Agent tool honors an agent's frontmatter `effort` when dispatched with a `model` override, so a per-section round on a below-fable session needs no Workflow: the same mechanism finishing-work relied on for `high` before this plan.
- This session's own reviews of this section run under its frozen plugin view, so they do not exercise the new levels; the first exercise is the worker's next section after a plugin update and restart.
- The spec is executed unleashed in the shared checkout under the commit-freeze protocol with the KIT: Worker session, since the checkout's goal state is that worker's live queue.

## Operator Verification

- Run `claude plugin update`, then restart the KIT: Worker session so its plugin view carries the new rule; until then its reviews run under the cap.
- Watch the Fable usage bars over the next few worker sections; the revert is one commit if they move faster than accepted.

## Open Questions

None at authoring.

## Related

- `docs/archive/claude-kit_reviewer-tier-cap_spec_v1.md`: the 2026-08-19 plan this reverses, whose Chapter 1 holds the pre-cap baseline.
- `docs/archive/claude-kit_reviewer-effort-compensation_spec_v1.md`: the 2026-08-11 plan that built the `max` compensation row this plan narrows back to its original ground.
- `docs/backlog.md` "Open experiment: effort dials and reviewer tiering in flight": the measurement home.

## Chapters
