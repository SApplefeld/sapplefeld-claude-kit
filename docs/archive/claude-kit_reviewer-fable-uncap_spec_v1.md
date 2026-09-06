# Run every per-section reviewer at Fable with effort set by lens, and retire the Opus cap

Status: Complete
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

Files in scope: `plugins/claude-kit/skills/executing-work/SKILL.md`, `plugins/claude-kit/skills/finishing-work/SKILL.md`, `plugins/claude-kit/skills/brainstorming/SKILL.md`, `plugins/claude-kit/skills/operating-instructions/references/ownership-map.md`, `plugins/claude-kit/agents/adversarial-reviewer.md`, `plugins/claude-kit/agents/blind-reviewer.md`, `plugins/claude-kit/agents/blind-reader.md`, `plugins/claude-kit/agents/prose-reviewer.md`, `plugins/claude-kit/agents/security-reviewer.md`, `docs/architecture.md`, `docs/backlog.md`; folded during execution on review findings: `README.md` (its model-tiering paragraph restates the rule) and `test/readonly-agent-guard.test.js` (its pin hard-coded `high` for every reviewer).

Acceptance: a grep of the plugin and `docs/*.md` for `one tier up`, `past opus`, `opus at opus`, `xhigh`, `no tier headroom` and `capped` (in the reviewer sense) returns only this plan, the archive, and the dated amendments of the backlog's reviewer-tiering item, which are append-only history; the five frontmatter lines read as specified; the targeted lane (`test/doctrine-parity.test.js`, `test/output-style-parity.test.js`, `test/size-ratchet.test.js`, `test/readonly-agent-guard.test.js`, run single-file) is green against the baseline recorded before the edit; and no edited skill grows past its size-budget cap.

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
- `docs/plans/claude-kit_capacity-gate_spec_v1.md`: meters every fable-override dispatch against the usage cache, and this plan makes every per-section review round on a below-fable session such a dispatch, so it is the largest change to that meter's traffic in the queue; the pointer runs one way because that plan is a parked plan under another session's queue and its header region is its approval fingerprint.

## Chapters

### Chapter 1 - 2026-09-05

Completed: 1. Reword the rule, re-pin the frontmatter, and bring every restatement into agreement

**Shipped.** The flat rule on every surface that carried the old one: executing-work step 3's rule sentence, its reviewer-effort table (four rows, each naming its route), the Workflow-route lead, the compensation-notch paragraph narrowed back to the unavailability ground, the section loop's re-read line at the top of the file, and the template rationale that named `xhigh`; finishing-work's finishing route (every finishing reviewer at `fable` and `high` through Workflow, the document lenses included, with the bare fallback named and its two losses recorded), its `.meta.json` caveat, and its bare-fallback paragraph; brainstorming's expected-Fable-surface enumeration; the ownership-map's review-roster row; `effort: low` on adversarial-reviewer, blind-reviewer, blind-reader and prose-reviewer and `effort: medium` on security-reviewer; docs/architecture.md's two carriers (the tier-up clause and the agents-directory effort enumeration); README.md's model-tiering paragraph, folded into scope on a review finding; the backlog experiment's dated amendment plus one new item; and `test/readonly-agent-guard.test.js`, whose pin hard-coded `high` for every reviewer and now carries the per-agent map, folded into scope when the targeted lane reddened on it. Reviewers for this section ran under this session's frozen plugin view, which is the pre-change rule with the cached agents at `high`; on a Fable-led session that is the inherited default, so no override rode either dispatch.

**Baseline, recorded before any edit.** A sonnet-band Explore scout tabulated every closed section in the 46 archived kit plans carrying a Chapter dated on or after 2026-08-19: 217 rows of plan, section, writer tier, reviewer tier, review rounds and surviving Criticals, blanks left where the record did not state a cell. The per-section table is scratch (`.kit/uncap-baseline-table.tsv`, gitignored); the aggregate by reviewer class is the baseline the backlog experiment judges the new levels against:

| reviewer class | sections with a round count | mean rounds | median | max | sections at 1 round | sections stating Criticals | surviving Criticals |
|---|---|---|---|---|---|---|---|
| fable | 9 | 1.11 | 1 | 2 | 8 | 6 | 0 |
| mixed fable and opus (fable pair, opus security) | 12 | 4.92 | 5 | 10 | 3 | 8 | 0 |
| opus at `max` (the capped review) | 92 | 2.36 | 1 | 15 | 49 | 71 | 2 |
| opus at `xhigh` (sonnet-written) | 22 | 1.41 | 1 | 8 | 19 | 9 | 0 |
| opus, effort unstated | 11 | 2.64 | 1 | 16 | 7 | 10 | 0 |
| no reviewer tier stated | 64 | 1.61 | 1 | 11 | 25 | 28 | 0 |

Seven rows carried no round count and are excluded from the means. Caveats the reader weighs: the classes differ in section difficulty as well as reviewer, so the gap between the fable and capped classes is a direction rather than a measurement; the scout did not extract `claude-kit_standing-grants_spec_v1.md`; and of three rows spot-checked against the archive by hand, one confirmed exactly (board-routing-and-homing section 2, fifteen rounds) and two returned inconclusive greps, so the table is the scout's reading with one confirmation rather than a verified census. The measurement the experiment wants is the same aggregate over the plans that close after this change installs.

**Decisions and surprises.** The writing-skills call: a rule-parameter change to a stated rule and its table, no new behavior form, so no red/green probe; the test that pins the values is the durable cover. Two size-ratchet reds along the way were this section's own prose over cap (finishing-work by 76 words, ownership-map by one) and were trimmed rather than budgeted, since `test/size-budget.json` was another session's in-flight edit; the test file sits at its line cap for the same reason, which is why the blind lens's third-copy finding became a backlog item rather than a fix. The plan's own first draft failed to land through a quoted heredoc on the Bash tool, the same shell-wrapper quoting that stranded the 42-hour Python process the operator killed earlier tonight; the Write tool landed it. The acceptance grep was amended in the spec: the backlog item's dated amendments are append-only history and keep the old words by design.

**Review findings addressed.** Adversarial lens (fable, `high`): seven Majors, all fixed: architecture.md's agents-directory enumeration still named `high` on five reviewers; finishing-work's prose-reviewer and blind-reader finishing dispatches silently dropped to `low`; the Workflow-route lead denied the per-section compensation path and the consultant; the section loop's re-read line still named a reviewer tier bump; the bare-fallback paragraph called an Opus-at-frontmatter dispatch "not a further drop" when the frontmatter is now `low`; README.md's tiering paragraph omitted the largest Fable entry point and kept "one notch"; the acceptance grep could not pass as written. Two Minors: the backlog pointer is anticipatory until archival (it archives in this delivery) and blind-reader.md's worktree endings were LF before this section touched it (unchanged). Blind lens (fable, `high`): three Majors overlapping the adversarial set (route lead, finishing document lenses, bare fallback), all fixed; five Minors: the "one case below fable" clause fixed, the `.meta.json` caveat fixed, the third-copy pin filed to the backlog, and two recorded without change: a finishing pass under an unavailable Workflow lands at frontmatter effort because no effort override exists without Workflow, which the text now records rather than compensates; and every per-section dispatch on a below-fable session now carries a fable override, so the round owes the first-turn reading per override dispatch, which executing-work's dispatch rule already states per dispatch. Tree bracket: the porcelain delta between dispatch and return was README.md and this spec (this session's own fix-round writes) plus four untracked grep spools at the repository root written by the baseline scout during its run, removed, with a kaizen note filed on the guard gap.

**Gate.** Targeted lane, single-file runs of `test/doctrine-parity.test.js`, `test/output-style-parity.test.js`, `test/size-ratchet.test.js`, `test/readonly-agent-guard.test.js`, unclaimed under the AI-OS: Worker's live heavy-process claim. Baseline on the untouched tree at 03:21Z: parity 0 failing, output-style 0, ratchet 1 failing (memory-system over cap, the worker's in-flight file), agent-guard 0. First run after the edit: parity 1 (the deferral pin line this section had removed), ratchet 1 (finishing-work over cap), agent-guard 1 (the `high` pin); all three this section's, fixed. Final run after the review fix round, read from each run's exit code: parity 0, output-style 0, ratchet 0, agent-guard 0, the ratchet's earlier worker red cleared by the worker's own cap raise in the same interval. No suite-wide claim is made; the targeted lane is the lane this step takes.

Commit model: Commit-and-Push; the section's files are delivered in this changeset, in a window the KIT: Worker session granted on the shared checkout.

Next: the finishing pass (QA verification of the acceptance criteria, the finishing adversarial review over the changeset's fix-round delta, close-out and archival).

### Chapter 2 - 2026-09-06 (finishing pass)

Completed: the whole-effort finishing pass. The plan's one section closed in Chapter 1 and was committed and pushed before this pass began, so this Chapter closes the plan rather than a section.

Base Ref: 3f375b62a33403ee5b1dd7f020dc0047525c0ab1, the parent of e00d1e3, the first commit that appended a Chapter to this plan. The changeset listing against it, compared one-directionally with the section's `Files in scope:` union, surfaced two expected classes and nothing else: `kaizen/notes-SCOTT-CLAUDE.md` (standing kaizen capture, named in Chapter 1) and five files of the KIT: Worker session's in-flight section, which landed as a3d8fbf mid-pass and is not this effort's. The three fix-round edits of this pass (`README.md`, `plugins/claude-kit/skills/finishing-work/SKILL.md`, `docs/backlog.md`) plus the curator's one edit (`docs/architecture.md`), the archival move and the two index files are delivered in this changeset.

Metrics: four dispatches, one per step, no round repeated, none stopped, wedged or re-dispatched; every dispatch inherited this session's Fable model with no override, and the two reviewers ran at the frozen plugin view's `high`, so this pass exercised the pre-change rule exactly as Chapter 1 did. Review findings addressed: 2 Majors and 4 Minors from the adversarial lens, 3 Minors from the security lens, 0 Criticals anywhere.

Decisions / Surprises: the security waiver did not apply, because the changeset carries a test file and five agent charters, and section 1 had run no per-section security review over those charters despite executing-work's configuration trigger; the finishing dispatch covered the same files and the miss is recorded here rather than repaired retroactively. The per-row baseline table the spec asked Chapter 1 to record was left in gitignored scratch with only the aggregate in the Chapter, a deviation the adversarial lens named; it is delivered below so the later session that judges the experiment can re-audit it. Both index files carry the archive as a rolling four-entry chain, and both chains omitted the board-routing-and-homing plan archived 2026-09-04, so the close-out re-derived both chains against the contents of `docs/archive/` rather than prepending one entry, which is the fix the backlog item of 2026-08-29 on index drift prescribed; that item is retired to the Q3 snapshot with receipts. The KIT: Worker's section commit landed in the shared checkout during this pass and moved HEAD under this session with no fetch, which is the shape the commit-freeze memory describes; this pass's window was granted by that session before staging.

Review Findings: QA verification (qa-verifier, sonnet pin) returned PASS on all four acceptance criteria against e00d1e3, with the four-file targeted lane at doctrine-parity 71, output-style-parity 11, size-ratchet 78, readonly-agent-guard 116 passing and 0 failing, each read at exit 0; no build exists for this repo; the whole suite was not run at that step because the worker held the heavy-process claim; the contention lane was not named in the brief and this repository defines none. Security review (security-reviewer, inherited Fable at the frozen view's `high`, Agent tool, over 3f375b6..e00d1e3 scoped to the non-prose files): CLEAR, no privilege moved and no guard loosened in code, with three Minors: the finishing route's read-only guard coverage is conditional on the Workflow `agentType` field and the security model does not say so, filed to the backlog because `docs/security-model.md` was the worker's in-flight file; the effort drop is a control-strength decision to be watched, so the backlog amendment now asks the experiment to count zero-tool-call rounds as their own class; and the third copy of the effort values, already on the backlog. Finishing adversarial review (adversarial-reviewer, inherited Fable at `high`, over 6812993..e00d1e3 with the fix-round delta named): APPROVED_WITH_CONCERNS. Fixed: `README.md` line 210's blind-reader sentence still described the old model ("that override rarely"), now scoped to the finishing-pass override; `council-member` dropped from that paragraph's reviewer parenthetical, since it takes neither override; finishing-work's compensation paragraph named only the two code lenses as the `agentType` to compensate while line 12 now routes the document lenses the same way, reworded at net zero words because the file sits at its cap; the per-row table below. Recorded without change: the backlog pointer at the archive path resolves with this delivery's move; Chapter 1's file-by-file account matches the diff, which the lens confirmed reading the record against the change rather than the text against the code. Post-fix lane, single-file runs read at exit 0: parity 71/0, output-style 11/0, ratchet 78/0, agent-guard 116/0.

Drift Adjudications: three items, every one `deviation`, so none stopped the run. D1: `docs/architecture.md` line 29 described the finishing floor's two states without naming the Workflow route, and a reader dispatching from that sentence alone would land at frontmatter effort; the curator added the route sentence, read in `git diff -- docs/` before this commit and kept as true to finishing-work line 12. D2: the security model's Workflow-gap paragraph does not say the finishing gate's default path now rests on the `agentType` field; the curator could not read the pre-change state (its charter grants no Bash), so this rides as an unverified pre-change claim, already carried by the backlog item above. D3: the backlog item of 2026-08-11 on confirming effort pins in the installed cache counted four agents and asked for an Agent-tool reviewer dispatch at frontmatter effort as a special observation; five reviewers now carry pins and that dispatch shape is every per-section round, so a dated amendment on the item says so. Hygiene: H2, a cross-reference gap with the capacity-gate plan, closed one way by the Related bullet above; H3, the index-chain drift, handled as described under Decisions.

Assumptions: none. Chapter 1 recorded no `Assumptions:` line, and this pass made none beyond the spec's own `## Assumptions` section.

Stamps: recorded at the close-out step of this pass; see the close-out status and `memq recent` for the digest.

Gate: the handoff whole gate, `node --test test/*.test.js` under this session's heavy-process claim (written 04:12:28Z, released 04:20:26Z), run after the last step that changed the tree and over the archived layout, because this pass's push lands on main, this kit's install surface with no CI between a commit and a plugin update: 3165 tests, 3155 passing, 1 failing, 9 skipped, exit 1 read from the run's own marker file, 479 s wall clock. No whole-gate baseline was taken on this lane in this session; the one red is `test/memory-session.test.js` "a pinned directory too long to name faithfully stands the session down", the standing red the project memory `suite-baseline-is-not-zero-fail` records for this box (its `D:\Temp` prefix keeps the fixture path under the 260-character guard), so the delta against that recorded baseline is zero and no red is this effort's. The contention lane did not run because this repository defines none (no `test/contention/`). The four-file targeted lane's last reading before this run, after the fix round, was parity 71, output-style 11, ratchet 78, agent-guard 116 passing and 0 failing, each at exit 0.

Operator Handoff: two items, neither holding this plan open, both also carried as a backlog handoff item. Run `claude plugin update` and restart the KIT: Worker session, since a running session reads skills and agents from its frozen plugin view and every review it runs until then is under the cap. Then watch the Fable usage bars over the next few worker sections; the revert is one commit restoring the section-1 files, and the backlog's open reviewer-tiering experiment is where the levels are judged.

Post-cap baseline, per row: the scout's 217-row extraction from the Chapter Metrics of the kit plans archived with a Chapter dated on or after 2026-08-19, as delivered to Chapter 1's aggregate, blanks where the record stated no cell, one row spot-checked exactly and two inconclusive, per Chapter 1.

| plan | section | writer tier | reviewer tier | review rounds | surviving Criticals |
|---|---|---|---|---|---|
| arm-time-binding | 1 | opus | opus (max) | 2 | 0 |
| arm-time-binding | 2 | fable | fable (high) | 2 | 0 |
| arm-time-binding | 3 | fable |  | 0 |  |
| blocked-escalation | 1 | fable | fable (adv/blind), opus (security) | 9 | 0 |
| blocked-escalation | 2 | fable | fable (adv/blind), opus (security) | 9 | 0 |
| blocked-escalation | 3 | inline (opus) | opus (max) | 1 | 0 |
| blocked-escalation | 4 | inline (opus) | opus (max) | 1 | 0 |
| blocked-escalation | 5 | inline (opus) | opus (max) | 1 | 0 |
| blocked-escalation | 6 | sonnet |  | 0 |  |
| board-routing-and-homing | 1 | opus | opus (max) | 4 | 0 |
| board-routing-and-homing | 2 | opus | opus (max) | 15 | 0 |
| board-routing-and-homing | 3 | sonnet | opus (xhigh) | 8 |  |
| board-routing-and-homing | 4 | sonnet | opus (max) | 9 | 0 |
| board-routing-and-homing | 5 | inline (opus) | opus (max) | 2 | 0 |
| board-routing-and-homing | 6 | inline (opus) | opus (max) | 4 | 0 |
| boundary-cadence-and-spec-scope | 1 | fable | fable (high) | 1 | 0 |
| boundary-cadence-and-spec-scope | 2 | opus | opus (max) | 1 | 0 |
| boundary-cadence-and-spec-scope | 3 | opus | opus (max) | 1 | 0 |
| boundary-cadence-and-spec-scope | 4 | inline (opus) | opus (max) | 1 | 0 |
| boundary-ritual-reinforcement | 1 | opus |  | 0 |  |
| boundary-ritual-reinforcement | 2 | fable | fable (high), opus (max, security) | 1 | 0 |
| boundary-ritual-reinforcement | 3 | sonnet | opus (xhigh) | 1 |  |
| boundary-ritual-reinforcement | 4 | sonnet | opus (xhigh) | 1 |  |
| boundary-ritual-reinforcement | 5 | sonnet | opus (xhigh) | 1 |  |
| boundary-ritual-reinforcement | 6 | inline (sonnet) |  | 0 |  |
| compact-boundaries | 1 | fable |  | 1 | 0 |
| compact-boundaries | 2 | opus | opus (max) | 1 | 0 |
| compact-boundaries | 3 | inline (opus) | opus (max) | 1 | 0 |
| compact-boundaries | 4 | inline (opus) |  | 0 |  |
| compaction-deferral-signal | 1 | opus | opus (max) | 3 | 0 |
| compaction-deferral-signal | 2 | opus | opus (max) | 3 | 0 |
| compaction-deferral-signal | 3 | opus | opus (max) | 3 | 0 |
| compaction-deferral-signal | 4 | inline (opus) | opus (max) | 1 | 0 |
| compaction-deferral-signal | 5 | opus |  | 0 |  |
| compaction-deferral-signal | 6 | opus | opus (max) | 7 | 0 |
| coordinator-and-roles | 1 | fable |  | 3 | 0 |
| coordinator-and-roles | 2 | fable |  | 3 | 0 |
| coordinator-and-roles | 3 | inline (opus) |  | 4 | 0 |
| coordinator-and-roles | 4 | sonnet | opus (xhigh) | 1 | 0 |
| coordinator-and-roles | 5 | inline (opus) |  | 1 |  |
| dispatch-authority | 1 | fable | fable | 1 | 0 |
| dispatch-authority | 2 | opus | opus (max) | 1 |  |
| dispatch-authority | 3 | opus | opus (max) | 1 |  |
| dispatch-authority | 4 | opus | opus (max) | 1 |  |
| dispatch-authority | 5 | inline (opus) |  | 1 |  |
| dormant-feature-removal | 1 | opus | opus (max) | 1 |  |
| dormant-feature-removal | 2 | opus | opus (max) | 1 | 0 |
| dormant-feature-removal | 3 | sonnet | opus (xhigh) | 1 |  |
| dormant-feature-removal | 4 | inline (sonnet) | opus (max) | 1 |  |
| durable-boundary | 1 | opus |  | 2 | 0 |
| durable-boundary | 2 | opus |  | 4 |  |
| durable-boundary | 3 | sonnet |  | 0 |  |
| durable-boundary | 4 | opus |  | 1 |  |
| durable-boundary | 5 | sonnet | opus | 1 |  |
| endpoint-dialect-key | 1 | opus | opus (max) | 2 | 0 |
| endpoint-dialect-key | 2 | inline (sonnet) | opus (max) | 3 | 0 |
| gate-cadence | 1 | sonnet |  | 1 | 0 |
| gate-cadence | 2 | opus |  | 1 | 0 |
| gate-cadence | 3 | inline (sonnet) |  | 1 |  |
| gate-cadence | 4 | opus |  | 1 | 0 |
| gate-cadence | 5 | opus |  | 1 | 0 |
| gate-cadence | 6 | opus |  | 1 | 0 |
| gate-cadence | 7 | opus |  | 1 | 0 |
| gating-definitions | 1 | inline (opus) | opus (max) | 2 |  |
| gating-definitions | 2 | opus | opus (max), fable | 10 |  |
| instruments-not-prose | 1 | opus |  | 3 | 0 |
| instruments-not-prose | 2 | opus |  | 3 | 0 |
| instruments-not-prose | 3 | opus | opus (max) | 1 | 0 |
| instruments-not-prose | 4 | sonnet |  | 3 | 0 |
| instruments-not-prose | 5 | sonnet |  | 2 | 0 |
| instruments-not-prose | 6 | sonnet |  | 3 | 0 |
| instruments-not-prose | 7 | sonnet |  | 5 |  |
| instruments-not-prose | 8 | sonnet |  | 4 |  |
| judge-partial-input | 1 | opus |  |  |  |
| judge-partial-input | 2 | opus |  |  |  |
| judge-partial-input | 3 | opus |  |  |  |
| judgment-sidecar | 1 | opus | opus (max) | 1 | 0 |
| judgment-sidecar | 2 | opus | opus (max) | 1 | 0 |
| judgment-sidecar | 3 | opus | opus (max) | 1 | 0 |
| judgment-sidecar | 4 | opus | opus (max) | 1 | 0 |
| judgment-sidecar | 5 | sonnet | opus (xhigh) | 1 | 0 |
| judgment-sidecar | 6 | opus | opus (max) | 2 | 0 |
| judgment-sidecar | 7 | sonnet |  |  |  |
| kaizen-batch-2 | 1 | fable | fable (high), opus (max, security) | 1 |  |
| kaizen-batch-2 | 2 | fable | fable (high), opus (max, security) | 1 |  |
| kaizen-batch-2 | 3 | opus | opus (max) | 1 | 0 |
| kaizen-batch-2 | 4 | fable | fable (high) | 1 |  |
| kaizen-batch-2 | 5 | sonnet | opus (xhigh) | 1 | 0 |
| kaizen-batch | 1 | fable |  | 1 | 0 |
| kaizen-batch | 2 | opus |  | 1 | 0 |
| kaizen-batch | 3 | fable |  | 1 | 0 |
| kaizen-batch | 4 | opus |  | 1 | 0 |
| kaizen-batch | 5 | opus | opus (max) | 4 | 0 |
| kaizen-batch | 6 | sonnet |  | 1 | 0 |
| kaizen-batch | 7 | opus |  | 1 | 0 |
| kaizen-batch | 8 | opus |  | 1 | 0 |
| kaizen-batch | 9 | inline (opus) |  | 8 | 0 |
| kaizen-batch | 10 | fable | fable (high) | 1 | 0 |
| memory-anchors-and-frontmatter-guard | 1 | opus | opus (max) | 4 | 0 |
| memory-anchors-and-frontmatter-guard | 2 | opus | opus (max) | 2 | 0 |
| memory-anchors-and-frontmatter-guard | 3 | opus | opus (max) | 4 | 0 |
| memory-anchors-and-frontmatter-guard | 4 | opus | opus (max), fable | 5 | 0 |
| memory-anchors-and-frontmatter-guard | 5 | opus | opus (max) | 2 | 0 |
| memory-anchors-and-frontmatter-guard | 6 | opus |  | 3 |  |
| memory-anchors-and-frontmatter-guard | 7 | opus |  | 2 | 0 |
| memory-read-side | 1 | opus |  |  |  |
| memory-read-side | 2 | opus | opus (max); escalated to fable | 7 | 0 |
| memory-read-side | 3 | opus | opus (max) |  | 0 |
| memory-recognition-reach | 1 | opus |  |  |  |
| memory-recognition-reach | 2 | opus | opus (max) | 2 | 0 |
| memory-recognition-reach | 3 | opus | opus (max) | 1 | 0 |
| memory-recognition-reach | 4 | inline (sonnet) | opus (max) | 2 | 0 |
| memory-recognition-reach | 5 | opus | opus (max) | 5 | 0 |
| memory-recognition-reach | 6 | opus | opus (max) | 2 | 0 |
| memory-recognition | 1 | opus | opus (max) | 2 | 0 |
| memory-recognition | 2 | opus | opus (max) | 1 | 0 |
| memory-recognition | 3 | sonnet | opus | 1 | 0 |
| memory-supersedes | 1 | opus | opus (max) | 1 | 0 |
| memory-supersedes | 2 | opus | opus (max) | 1 | 0 |
| memory-supersedes | 3 | inline (sonnet) | opus (max) | 1 | 0 |
| memq-network-cwd-resolver | 1 | sonnet |  | 0 |  |
| memq-network-cwd-resolver | 2 | sonnet | opus (xhigh) | 1 |  |
| memq-network-cwd-resolver | 3 | inline (sonnet) |  | 0 |  |
| memq-reads-the-harness-shape | 1 | opus | opus (max) | 2 | 0 |
| park-and-quiesce | 1 | opus |  | 1 |  |
| park-and-quiesce | 2 | sonnet |  | 0 |  |
| park-and-quiesce | 3 | opus |  | 5 |  |
| peer-sessions-skill | 1 | fable | fable | 1 | 0 |
| peer-sessions-skill | 2 | sonnet | opus (xhigh) | 1 | 0 |
| plan-lifecycle-and-diagnostics | 1 | sonnet |  | 1 |  |
| plan-lifecycle-and-diagnostics | 2 | opus | opus (max) | 1 | 0 |
| plan-lifecycle-and-diagnostics | 3 | opus | opus (max) | 1 | 0 |
| plan-lifecycle-and-diagnostics | 4 | sonnet | opus (max) | 2 |  |
| plan-lifecycle-and-diagnostics | 5 | opus | opus | 2 | 0 |
| plan-lifecycle-and-diagnostics | 6 | sonnet | opus | 1 | 0 |
| plan-lifecycle-and-diagnostics | 7 | sonnet |  | 1 | 0 |
| plan-lifecycle-and-diagnostics | 8 | opus | opus (max) | 3 | 0 |
| plan-lifecycle-and-diagnostics | 9 | sonnet |  | 2 | 0 |
| plan-lifecycle-and-diagnostics | 10 | sonnet | opus (xhigh) | 1 | 0 |
| plan-lifecycle-and-diagnostics | 11 | opus | opus (max) | 1 | 0 |
| plan-lifecycle-and-diagnostics | 12 | sonnet | opus (xhigh) | 1 | 0 |
| plan-lifecycle-and-diagnostics | 13 | opus | opus (max) | 1 | 0 |
| precedence-and-ownership | 1 | fable |  | 0 |  |
| precedence-and-ownership | 2 | fable |  | 0 |  |
| precedence-and-ownership | 3 | fable |  | 0 |  |
| precedence-and-ownership | 4 | fable |  | 0 |  |
| process-rule-repairs | 1 | inline (opus) | opus (max) | 1 |  |
| process-rule-repairs | 2 | inline (opus) | opus (max) | 5 | 0 |
| process-rule-repairs | 3 | inline (opus) | opus (max) | 3 | 0 |
| process-rule-repairs | 4 | inline (opus) | opus (max) | 5 | 0 |
| process-rule-repairs | 5 | inline (opus) | opus (max) | 2 | 0 |
| public-surface-hygiene | 1 | inline (sonnet) | opus (max) | 1 | 0 |
| recap | 1 | opus | opus (max); fable | 3 | 0 |
| recap | 2 | inline (opus) |  | 0 |  |
| review-and-record-discipline | 1 | opus | opus (xhigh) | 1 |  |
| review-and-record-discipline | 2 | sonnet | opus (xhigh) | 1 |  |
| review-and-record-discipline | 3 | opus | opus (max) | 1 |  |
| review-and-record-discipline | 4 | sonnet | opus (xhigh) | 1 |  |
| review-and-record-discipline | 5 | opus | opus (max) | 1 |  |
| review-and-record-discipline | 6 | opus | opus (max) | 1 |  |
| review-and-record-discipline | 7 | opus | opus (max) | 1 |  |
| review-and-record-discipline | 8 | opus | opus (max) | 1 |  |
| review-and-record-discipline | 9 | sonnet |  | 2 |  |
| review-and-record-discipline | 10 | sonnet | opus (xhigh) | 1 |  |
| review-and-record-discipline | 11 | opus |  | 2 |  |
| review-and-record-discipline | 12 | opus |  | 2 |  |
| review-and-record-discipline | 13 | sonnet | opus (max) | 3 |  |
| review-and-record-discipline | 14 | sonnet | opus (max) | 1 |  |
| review-and-record-discipline | 15 | opus | opus (max) | 4 |  |
| reviewer-tier-cap | 1 | inline (opus) | fable (high) | 1 | 0 |
| seat-infrastructure | 1 | opus | opus (max) | 1 |  |
| seat-infrastructure | 2 | opus | opus (max) | 4 |  |
| seat-infrastructure | 3 | fable | fable, opus (max, security) | 3 |  |
| seat-infrastructure | 4 | opus |  | 11 |  |
| seat-infrastructure | 5 | opus | fable | 1 |  |
| seat-infrastructure | 6 | sonnet | opus | 1 | 0 |
| seat-infrastructure | 7 | sonnet | opus | 1 | 0 |
| seat-infrastructure | 8 | inline (opus) | opus | 1 | 0 |
| seat-infrastructure | 9 | opus | opus | 2 | 0 |
| seat-infrastructure | 10 | opus | opus | 2 | 0 |
| shared-tier-authoring | 1 | opus | opus (max) | 2 | 0 |
| shared-tier-authoring | 2 | opus | opus | 16 | 0 |
| shared-tier-authoring | 3 | inline (sonnet) | opus (max) | 8 | 0 |
| sidecar-staleness-and-liveness | 1 | opus |  | 2 |  |
| sidecar-staleness-and-liveness | 2 | opus | opus/xhigh | 2 |  |
| sidecar-staleness-and-liveness | 3 | sonnet | opus/xhigh | 2 |  |
| standing-lines-and-honest-reports | 1 | opus | fable | 1 |  |
| standing-lines-and-honest-reports | 2 | opus | opus | 1 | 0 |
| standing-lines-and-honest-reports | 3 | sonnet | opus/xhigh | 1 | 0 |
| standing-lines-and-honest-reports | 4 | opus | opus (max) | 3 | 0 |
| standing-lines-and-honest-reports | 5 | inline (opus) | opus (max) | 1 | 0 |
| subtraction-bars | 1 | opus | opus (max) | 3 | 0 |
| subtraction-bars | 2 | sonnet | opus (xhigh) | 1 | 0 |
| subtraction-bars | 3 | opus | opus (max) | 1 | 0 |
| subtraction-bars | 4 | opus | opus (max) | 6 | 0 |
| subtraction-bars | 5 | sonnet | opus (max) | 3 | 0 |
| sync-state-writer-and-push-pair | 1 | sonnet | opus (xhigh) | 1 | 0 |
| sync-state-writer-and-push-pair | 2 | opus | opus (max) | 1 |  |
| sync-state-writer-and-push-pair | 3 | inline (sonnet) | opus (max) | 1 |  |
| testing-discipline | 1 | fable |  | 1 |  |
| testing-discipline | 2 | opus | opus (max) | 1 |  |
| testing-discipline | 3 | sonnet | opus (xhigh) | 1 |  |
| testing-discipline | 4 | opus | opus (max) | 3 | 0 |
| verification-artifacts | 1 | opus | opus; escalated to fable | 5 | 0 |
| verification-artifacts | 2 | opus |  | 1 | 0 |
| verification-artifacts | 3 | opus | opus (max) | 1 |  |
| verification-artifacts | 4 | opus | opus (max) | 12 | 2 |
| verification-artifacts | 5 | inline (sonnet) |  | 0 |  |
| verification-artifacts | 6 | inline (opus) | opus (max) | 5 | 0 |
| verification-artifacts | 7 | inline (opus) |  | 0 |  |
| worktree-goals | 1 | opus | opus (max) | 1 | 0 |
| worktree-goals | 2 | sonnet |  | 1 |  |
| worktree-goals | 3 | sonnet |  | 1 |  |
| worktree-goals | 4 | opus | opus (max) | 1 | 0 |
| worktree-store-and-autosync | 1 | opus | opus (max) | 1 | 0 |
| worktree-store-and-autosync | 2 | fable | fable, opus (max, security) | 5 | 0 |
| worktree-store-and-autosync | 3 | inline (opus) | opus (max) | 1 | 0 |

Next: none. This plan is Complete and archived.
Commit Model: Commit-and-Push; delivered in this changeset, in a window the KIT: Worker session granted on the shared checkout.
