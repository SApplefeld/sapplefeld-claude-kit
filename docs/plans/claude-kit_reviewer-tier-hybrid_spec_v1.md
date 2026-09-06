# Run each per-section reviewer one tier above the writer with Fable as the ceiling, and a reviewer below Fable at high

Status: In Progress
Commit Model: Commit-and-Push
Disjoint: yes
Created: 2026-09-06

## Goal

Each per-section reviewer dispatch runs one tier above the section's writer tier, with Fable as the ceiling rather than Opus: a haiku section reviews at sonnet, sonnet at opus, opus at fable, fable at fable, the code pair, the document pair and the security reviewer alike. A Fable reviewer keeps the effort the reviewer-fable-uncap plan put in its frontmatter (`low` for the code and document pairs, `medium` for the security reviewer) and rides the Agent tool. A reviewer below Fable, Sonnet over a haiku section or Opus over a sonnet section, runs at `high` through the Workflow route, because a model below Fable earns its findings on effort. The finishing reviews stay at Fable and `high`, and the Opus `max` row stays what it is, compensation for a Fable gate this environment could not run. When this is done the rule reads in one place with one question deciding the route, every restatement in the kit agrees, and the open reviewer-tiering experiment in `docs/backlog.md` carries the change as its next dated amendment.

## Dispatch Authorization

Authorized 2026-09-06 by the operator at the keyboard of the KIT: Expert session, who chose the hybrid (one tier up, Fable the ceiling) over the flat Fable rule and over restoring the Opus cap, and chose `high` over `medium` for a reviewer below Fable, both from the Expert seat's argued recommendation, and asked that the Expert seat make the change directly in the shared checkout as it did the uncap. The Expert seat authored this spec after that instruction and executes it unleashed, since the checkout's goal state is another session's live leash and a bare arm here would replace that queue.

## Approach

**The rule today.** `plugins/claude-kit/skills/executing-work/SKILL.md` step 3 runs every per-section reviewer at Fable whatever tier wrote the section, with effort by lens from the reviewer agents' frontmatter (`low` for adversarial-reviewer, blind-reviewer, blind-reader and prose-reviewer, `medium` for security-reviewer), the finishing reviews at Fable and `high` through `Workflow`'s `agent()`, and Opus at `max` through the same route as compensation where a Fable gate could not run. That rule landed in commit e00d1e3 on 2026-09-05 and was finished at f1b77fc on 2026-09-06 (`docs/archive/claude-kit_reviewer-fable-uncap_spec_v1.md`). It has not yet reached the worker session: the installed kit trails the checkout and a running session's plugin view is frozen at its start, so every review round the operator has watched the usage bars under ran the rule before it, one tier up capped at Opus.

**Why now.** The operator's reading of the weekly Fable usage on 2026-09-06, taken under the capped rule, is a few percent ahead of the normal pace. The flat rule would add a Fable reviewer to every section the cap kept at Opus or below, and the operator judged that too far in the same direction. The operator keeps two of the flat rule's decisions: Opus-tier sections earn a Fable reviewer (the cap's "opus at opus" had a reviewer reading work built by its equal), and Fable per-section runs at the low efforts. What the hybrid takes back is the sonnet-tier and haiku-tier sections, which return to Opus and Sonnet reviewers.

**What it changes, in numbers.** The 217-row baseline in Chapter 2 of the uncap plan splits the closed sections by writer tier as opus 109, sonnet 48, fable 24, blank 36, haiku 0 (an awk count over the table's tier column). Under the hybrid the opus and fable rows keep the Fable reviewer at the frontmatter efforts, so the hybrid removes Fable from about a quarter of the tiered sections relative to the flat rule. Relative to the capped rule the operator measured under, it still adds Fable at `low` on the 109 opus-tier sections while dropping the 24 fable-tier sections' pairs from `high` to `low`; whether that nets above or below the measured pace is not measured here, which is why the Opus cap is named below as the next lever.

**The rule wanted.** Every per-section reviewer runs one tier up from the section's writer tier, Fable the ceiling: haiku at sonnet, sonnet at opus, opus at fable, fable at fable, the code pair, the document pair and the security reviewer alike, with no security exception (the security reviewer over an opus- or fable-tier section runs at Fable and `medium`). After a tier escalation the escalated tier is the writer tier. An inline section's writer tier is the session's own model, since that is what built it; an untiered section takes whatever tier built it. The tier rides as the model override on every dispatch in the round, and a Fable reviewer on a Fable-led session is the inherited default with no override.

**Effort and route, argued.** One question decides the route: is the reviewer Fable? A Fable reviewer runs at its frontmatter effort, `low` for the code and document pairs and `medium` for the security reviewer, through the Agent tool, unchanged from the uncap plan and for the reasons that plan argued (the blind and adversarial lenses are bounded by the section; the security lens chases the boundaries the diff only touches). A reviewer below Fable, whichever lens, runs at `high` through `Workflow`'s `agent()` on the Reviewer Dispatch template, because a frontmatter effort is one value per agent whatever model it runs as, so the only way to give Sonnet and Opus more effort than Fable without lifting Fable too is the route that sets effort per call. The operator chose `high` over `medium` on the Expert seat's recommendation: Opus and Sonnet usage is not the scarce budget, and the operator's reading is that the lower tiers are not as adept at low effort as Fable is. The finishing reviews stay at Fable and `high` through the same route, and where that route is unavailable the fallback is each row's own model at the agent's frontmatter effort through the Agent tool (sonnet or opus for a below-Fable reviewer and opus for a compensating dispatch by executing-work's own rule, fable for the finishing reviews by finishing-work's), recorded as reduced effort. The `max` row stays compensation for a gate that could not run at the tier the rule aimed it at, confirmed per finishing-work's unavailability rule, which now includes a per-section reviewer at sonnet ruled out; one at opus ruled out ends the round ungated per finishing-work's ladder, since this rule spends no Fable rescuing a cheap-tier writer's round. The `high` a below-Fable reviewer carries per-section is the rule's own level for that model and never climbs to `max`.

**What it costs.** A review round over a haiku- or sonnet-tier section takes the Workflow route, which is the same template and the same in-turn await finishing-work already uses, on roughly a quarter of sections by the baseline split. The reviewer charters do not change, so the agent-guard test's effort pins hold as they are.

**What stays fixed.** The five reviewer charters and their frontmatter; `consult/SKILL.md` (Fable at `high`, Opus at `max` when Fable could not run); finishing-work's unavailability rule (one example sentence narrowed), its ladder, its finishing route and its compensating route; the doctrine's standing-dispatch bullet, whose Workflow purpose (a read-only agent at an effort the Agent tool cannot set) is exactly what the below-Fable rows use; the implementer tiers and the tier-escalation ladder; the ownership-map row, which names "the reviewer-model rule and the effort table" without stating either.

**Close condition.** `docs/backlog.md` carries the open experiment "effort dials and reviewer tiering in flight". This plan appends a dated amendment naming the hybrid levels and the reason, and amends the operator-only install item of 2026-09-06 so one plugin update and one worker restart install both rules at once. No second experiment opens.

**Revert.** One commit restores executing-work's step 3 sentences and table, the brainstorming enumeration, the architecture clause and the root README's paragraph. The next lever if the bars keep climbing is the Opus cap (opus-tier sections back to an Opus reviewer at `high`), which is the same set of files. No runtime state, no migration. A running session reads skills from its frozen plugin view, so neither this change nor the uncap reaches the worker until `claude plugin update` and a restart.

## Sections of Work

### 1. Reword the rule, retable the efforts, and bring every restatement into agreement
Model: fable
Locus: inline

Load the `writing-skills` skill before editing: this is a rule-parameter change to behavior-shaping skills, so let that skill decide whether a behavior test is needed (none is expected, no test pins the rule sentence or the table) and record its call in the Chapter. Reviewers for this section run under whatever rule this session's frozen plugin view carries, which is the capped rule with the cached agents at `high`; say so in the Chapter.

In `plugins/claude-kit/skills/executing-work/SKILL.md` step 3: replace the bold flat-rule sentence and the sentences that depend on it (the "keys on nothing the writer did" clause, the Fable-led inherited-default remark, the "so the round rides the Agent tool" remark) with the rule wanted, the escalated-tier sentence, the inline and untiered rules, and one sentence sending effort and route to the table; keep the unavailability sentence and its pointer at finishing-work, and add after it the sentence that sends a below-Fable reviewer whose tier could not run to finishing-work's ladder as written (a reviewer at sonnet compensates through the `max` row; one at opus ends the round ungated, no Fable being spent to rescue a cheap-tier writer's round), judged one dispatch at a time. Replace the reviewer-effort table and its generator paragraph with five rows, each naming its route: the Fable code and document pairs at `low` (frontmatter, Agent tool), the Fable security reviewer at `medium` (frontmatter, Agent tool), a reviewer below Fable in any lens at `high` (Workflow), the finishing reviews at Fable and `high` (Workflow, finishing-work's to specify), and the compensation row widened to name a per-section reviewer at sonnet ruled out beside the Fable gate it was built for; the generator paragraph opens on the route question and then the lens question. Update the "Dispatching a reviewer above its frontmatter default" lead so it names the three dispatches that take the route: a per-section reviewer below Fable at `high`, the finishing reviews at `high`, and the compensating Opus at `max`. In the compensation-notch paragraph add the sentence that a below-Fable reviewer's per-section `high` is the rule's own level and not the notch. In the Chapter template, the Review Findings line opens with the round's reviewer model and route, so the finishing pass can tell a below-Fable round from a Fable one without deriving it. In the section-loop re-read paragraph at the top of the file, the closing example "the dispatch and never the fable override on its reviewers" becomes "the dispatch and never the reviewer tier bump". The word budget for this file is 21223 after the frontmatter strip and it holds 20828, so the rewrite has about 390 words of headroom.

In `plugins/claude-kit/skills/brainstorming/SKILL.md`: the expected-Fable-surface enumeration names the per-section reviewer dispatches over opus- and fable-tier sections (one tier up from the writer, Fable the ceiling) in place of "every per-section reviewer dispatch whatever tier wrote the section". This file holds 4171 words against a cap of 4185, so the replacement is at most fourteen words longer than what it replaces.

In `README.md`, the model-tiering paragraph: the judgment moment "every per-section review round" becomes the per-section review round over an opus- or fable-tier section, with the below-Fable reviewer at `high` named in the same sentence.

In `docs/architecture.md`: the clause naming the flat rule and the by-lens effort table becomes the hybrid rule and the two-question table; finishing-work's "two states" sentence stays true as written.

In `docs/backlog.md`: append a dated amendment to the open experiment item naming the hybrid levels, the reason and this plan; amend the 2026-09-06 install item so it names both rules.

`plugins/claude-kit/skills/finishing-work/SKILL.md` is read: its finishing route, bare fallback, ladder and compensating paragraph hold under the hybrid as written, and two sentences that carried the flat rule are folded in on review findings at net-zero words: the dedup instruction in its opening paragraph (a below-Fable round clears nothing for the finishing reviewers), step 3's scope sentence (the pass also owns the local read over sections whose round ran below Fable), and the inheriting-case example in its unavailability paragraph (every inheriting dispatch, `implementer-fable` included). `test/readonly-agent-guard.test.js` is read and confirmed unchanged: its pins are the frontmatter efforts, which do not move.

Files in scope: `plugins/claude-kit/skills/executing-work/SKILL.md`, `plugins/claude-kit/skills/brainstorming/SKILL.md`, `README.md`, `docs/architecture.md`, `docs/backlog.md`; folded during execution on review findings: `plugins/claude-kit/skills/finishing-work/SKILL.md` (two sentences that carried the flat rule); registered by the create path, not section work: `docs/README.md`, `docs/plans/README.md`.

Acceptance: a case-sensitive grep of `plugins/claude-kit/` and `docs/*.md` and `README.md` for `whatever tier wrote` and `every per-section reviewer at fable` returns nothing outside the backlog item's dated amendments, the two docs indexes' archive-chain sentences describing the uncap plan (history), and this plan; the executing-work table reads the five rows above; the five reviewer charters are byte-identical to HEAD; the targeted lane (`test/doctrine-parity.test.js`, `test/output-style-parity.test.js`, `test/size-ratchet.test.js`, `test/readonly-agent-guard.test.js`) is green at exit 0.

## Out of Scope

- The consultant's tier or effort, and the unavailability rule's triggers.
- The implementer tiers, the tier-escalation ladder, and the implementer effort pins.
- The reviewer charters: no frontmatter or body line changes.
- Measuring the outcome: the backlog experiment owns the judgement, on later plans' Chapter Metrics.
- Installing the change on this machine (`claude plugin update`) and restarting the worker: operator actions, listed under Operator Verification.

## Assumptions

- The Agent tool on this version carries a model override and no effort parameter, read from the tool schema this session holds, so the below-Fable rows need the Workflow route.
- `Workflow`'s `agent()` honors `effort` and `model` per call for an `agentType` the read-only guard governs: the mechanism finishing-work already relies on, not re-tested here.
- A Fable reviewer at `low` on an opus-tier section costs less of the allotment than Fable at `high` on a fable-tier section, and the net against the capped rule is unmeasured: the operator's reading, with the Opus cap named as the next lever.
- This session's own reviews of this section run under its frozen plugin view, so they do not exercise the new rule; the first exercise is the worker's next haiku- or sonnet-tier section after a plugin update and restart.
- The spec is executed unleashed in the shared checkout under the commit-freeze protocol with the KIT: Worker session, since the checkout's goal state is that worker's live queue.

## Operator Verification

- Run `claude plugin update`, then restart the KIT: Worker session so its plugin view carries this rule and the uncap's frontmatter efforts together; until then its reviews run under the cap.
- Watch the Fable usage bars over the next few worker sections; the next lever is the Opus cap, one commit over the same files.

## Open Questions

None at authoring.

## Related

- `docs/archive/claude-kit_reviewer-fable-uncap_spec_v1.md`: the 2026-09-05 plan this narrows, whose Chapter 2 holds the 217-row baseline this plan's numbers come from and whose frontmatter efforts this plan keeps.
- `docs/archive/claude-kit_reviewer-tier-cap_spec_v1.md`: the 2026-08-19 plan whose tier-up rule this plan restores with Fable in place of Opus as the ceiling.
- `docs/backlog.md` "Open experiment: effort dials and reviewer tiering in flight": the measurement home.
- `docs/plans/claude-kit_capacity-gate_spec_v1.md`: meters every fable-override dispatch; this plan makes the per-section rounds over opus- and fable-tier sections such dispatches on a below-fable session. The pointer runs one way because that plan is parked under another session's queue.

## Chapters
