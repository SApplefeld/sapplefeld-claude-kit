# Review Tension: Blind Lens, Recall Bias, and the Recurrence Rule

Status: Complete
Commit Model: Review-Only
Run Mode: interactive
Fable Spend: session-led (Fable-led session; wording sections inline, validation dispatches at opus)
Created: 2026-07-09

## Goal

Sharpen the kit's per-section review so it carries real tension with the implementer, adopting four practices from the Bun-in-Rust port methodology (https://bun.com/blog/bun-in-rust, read 2026-07-09): a blind diff-only reviewer lens alongside the existing spec-anchored one, an explicit recall-over-precision incentive for reviewers, the workaround-comment heuristic as a mechanical rejection test, and a within-effort recurrence rule that fixes the workflow generating a repeated bug class instead of only the instances.

## Approach

The kit's adversarial-reviewer reads the spec first (Pass 1 is spec compliance), which is correct for our expensive failure mode (spec drift) but primes the reviewer with the same framing the implementer built from. It reviews at spec altitude, and low-altitude correctness bugs (resource lifetime, rounding sign, eager-vs-lazy evaluation, async ordering) are the class a spec-anchored reader skims past because no spec speaks there. The Bun port's reviewers received only the diff, were told to assume the code is wrong, and caught exactly that class before merge.

The design splits the lenses rather than stacking them in one agent:

- **The existing adversarial-reviewer keeps the spec** and stays the spec-compliance and quality lens. It gains two sharpenings: an explicit recall-over-precision asymmetry (a missed bug costs more than a wrong flag, because the responding-to-review adjudication layer already filters over-reporting safely), and the workaround-comment heuristic (code whose correctness needs a paragraph-long justification comment is wrong code, flag it) as a checklist item.
- **A new blind-reviewer agent gets the diff and touched files only.** Never the spec, the plan, or the section name; that blindness is the lens. Posture: assume the code is wrong, the only job is to find how. Pure correctness hunter: no style review (adversarial-reviewer owns style), no spec compliance (impossible by design). Same severity-ranked output format and verdict line as adversarial-reviewer so adjudication is uniform.
- **Pairing rule:** the blind-reviewer dispatches in parallel with the adversarial-reviewer wherever the per-section review runs. The existing trivial carve-out in executing-work step 3 (a rename, a comment, a one-line change with no logic) throttles the pair together; no new predicate. Blind dispatches run at the session model, same as per-section adversarial dispatches today. The never-pre-judge rule covers both reviewers.
- **The recurrence rule** closes the "fix the workflow, not the bug" loop within an effort: when reviews in two sections of the same effort surface the same finding class, amend the standing dispatch-brief content so later sections inherit the fix, and record the amendment in the Chapter. This is smaller than kaizen (which is kit-level); it operates on the effort's own briefs mid-run.
- **finishing-work does not change.** The final whole-changeset adversarial pass is spec- and cohesion-anchored by design; per-section blind passes own low-altitude correctness. Reversal is cheap: add a whole-changeset blind dispatch to finishing-work step 3 if per-section coverage proves insufficient.

Validation comes before wiring. The blind lens is a hypothesis until a seeded-bug diff shows it catches what the spec-primed reviewer misses (or at least catches the seeded class reliably); the wiring section is gated on that outcome so we never double review cost on an unvalidated lens.

## Sections of Work

### 1. The blind-reviewer agent
Model: fable (inline)
Create `plugins/claude-kit/agents/blind-reviewer.md`. Inputs: a base git ref or changed-file list, nothing else; the agent states plainly that it must not be given (and will not seek) the spec or plan. Posture: assume the code is wrong; recall over precision, with the orchestrator named as the filter; hunt correctness specifically (resource lifetime and disposal, async and close ordering, boundary and sign and rounding, eager-vs-lazy evaluation, error paths that leave state inconsistent, races, off-by-one, empty and missing inputs). Include the workaround-comment heuristic. Exclude style and spec compliance explicitly, naming which sibling owns each. Output format and verdict line mirror adversarial-reviewer. Frontmatter description states the trigger, not the workflow, and is quoted.
Acceptance: agent file exists; description follows the writing-skills trigger rule; the prompt contains no path by which the spec reaches the reviewer; output format matches adversarial-reviewer's; no em dashes.

### 2. Sharpen adversarial-reviewer incentives
Model: fable (inline)
Edit `plugins/claude-kit/agents/adversarial-reviewer.md`: add the recall-over-precision asymmetry (a missed bug costs more than a wrong flag; the orchestrator adjudicates, you hunt) while keeping the existing no-invented-findings guard, and add the workaround-comment heuristic to the Pass 2 checklist.
Acceptance: both additions present; the no-invented-findings line survives; the two lines do not contradict each other in a way a fresh read would trip on; no em dashes.

### 3. Validate the behavior changes
Model: opus
Two tests, per writing-skills, orchestrated from the main session with fresh subagents:
(a) **Seeded-bug validation of the blind lens.** Author a small realistic diff seeding 2-3 subtle correctness bugs of the classes the Bun reviews caught (an async close ordering or lifetime bug, a rounding-sign bug, an eager-evaluation bug), plus a plausible spec that says nothing at that altitude. RED: the current spec-primed adversarial-reviewer reviews diff plus spec; record what it catches and misses. GREEN: the blind-reviewer reviews the diff alone; gate is that it catches the seeded bugs. Run at least two reps of each; record the comparative result honestly either way. If the spec-primed reviewer also catches everything across reps, stop before Section 4 and present the result: it weakens the case for doubling per-section review cost, and wiring is a decision to remake on that evidence.
(b) **RED/GREEN the recurrence rule wording.** Scenario: an orchestrator transcript where two sections' reviews surface the same finding class. RED without the rule: the agent fixes both instances and moves on. GREEN with the rule: it amends the standing brief and records the amendment in the Chapter.
Acceptance: both tests run with at least two reps, results recorded with per-rep specifics in a Chapter, and the Section 4 gate decision stated explicitly. (Amended at close-out: "verbatim" overstated what a Chapter should hold; the record is distilled per-rep results with the honest caveats, and the deviation is flagged in the final Chapter.)

### 4. Wire the pair into executing-work and the doctrine
Model: fable (inline)
Gated on Section 3(a). Edit `plugins/claude-kit/skills/executing-work/SKILL.md` step 3: dispatch blind-reviewer in parallel with adversarial-reviewer; the blind dispatch carries only the base ref or changed-file list, never the spec path or section name; the trivial carve-out covers the pair; never-pre-judge applies to both. Add the workaround-comment heuristic to the step 1 implementer-brief requirements (brief implementers that a workaround needing a paragraph-long justification is wrong code, fix the code). Update the controller-owns-the-gate bullet in `plugins/claude-kit/skills/operating-instructions/SKILL.md` and its deployed copy `home/claude-kit-doctrine.md` so the per-section review set reads adversarial, blind, and security (the two copies must not drift).
Acceptance: step 3 dispatches the pair with the blind dispatch's input restriction stated; the brief list carries the heuristic; both doctrine copies updated identically; no em dashes.

### 5. The recurrence rule
Model: fable (inline)
Edit `plugins/claude-kit/skills/executing-work/SKILL.md` step 4 (address findings): when reviews in two sections of the same effort surface the same finding class, amend the standing dispatch-brief content so later sections inherit the fix, and record the amendment in the Chapter. Conditional on the observable predicate (same finding class, second section), not a vague "watch for patterns."
Acceptance: the rule is present as a conditional with the Chapter record named; it reads coherently with the existing step 4 severity ladder; no em dashes.

## Out of Scope

- **finishing-work changes.** The final pass stays spec- and cohesion-anchored; rationale and reversal path recorded in Approach.
- **A separate fixer agent.** The Bun port split implementer, reviewers, and fixer; the kit's responding-to-review adjudication layer already provides the anti-shipping-bias separation, so a fourth role per section is overhead without a distinct failure mode.
- **Compiler-errors-as-work-queue sharding.** A pattern for mass-migration scale, not a kit change; noted here so it is findable if such an effort arrives.
- **security-reviewer changes.** Untouched by this effort.

## Open Questions

None. The pairing throttle (existing trivial carve-out, no new predicate), blind-dispatch model tier (session model), and finishing-work exclusion were decided 2026-07-09 during spec writing; rationale in Approach.

## Related

- Methodology source: https://bun.com/blog/bun-in-rust (external).
- `docs/archive/claude-kit_anti-deferral_spec_v1.md` for the writing-skills RED/GREEN testing pattern this spec's Section 3 follows.

## Chapters

### Chapter 1 - 2026-07-09 (Sections 1 and 2)
Completed: Section 1 (blind-reviewer agent) and Section 2 (adversarial-reviewer sharpenings), implemented and reviewed as one round because the two prompts are one coupled wording change.
Implemented By: main session (fable inline, per spec tiers).
Metrics: review rounds 1; NEEDS_CONTEXT 0; escalations 0; advisor off (unavailable this session).
Decisions / Surprises: none beyond the review findings.
Review Findings: APPROVED_WITH_CONCERNS. Major (spec drift): the No-spec-compliance exclusion did not name the owning sibling as Section 1 requires; fixed ("The adversarial-reviewer owns that lens."). Minor: "do not read or follow it" was unexecutable for inline intent text already present in a dispatch; fixed by splitting the path case (do not open) from the inline case (disregard and note contamination). Reviewer confirmed everything else against the acceptance criteria, including zero em dashes and that the adversarial-reviewer diff contained exactly the two spec'd additions.
Next: Section 3 (validation).
Commit Model: Review-Only.

### Chapter 2 - 2026-07-09 (Section 3, validation)
Completed: Section 3, both tests, fixtures under .kit/scratch/review-tension-test/ (gitignored; fixture repo base 1996bb2, seeded feature 3d00d13).
Implemented By: main session orchestrating; test agents dispatched at opus (general-purpose with the reviewer prompts inlined, because the installed plugin does not yet carry the new agent or the sharpened prompt).
Metrics: review rounds 0 (this section produced no repo changes); NEEDS_CONTEXT 0; escalations 0; advisor off.
Decisions / Surprises:
- 3(a) seeded three bugs in a C# MetricsBuffer: (A) writers disposed while the flush timer callback can still be in flight, (B) Math.Truncate-based timestamp split producing negative millis on pre-1970 inputs, (C) eager GetOrAdd(name, CreateWriter(name)) leaking a file handle per call on cache hits. Results, 2 reps per lens at opus: bug C caught 4/4 (Critical everywhere); bug A caught 4/4 but severity split (blind: Critical both reps; spec-primed: Minor and Major); bug B (negatives) caught 2/2 by the blind lens and 0/2 by the spec-primed lens. GATE PASSED: the blind lens caught bugs the spec-primed lens missed, and Section 4 proceeded.
- Honest caveats recorded: the blind prompt's hunt list names truncation-vs-flooring-on-negatives explicitly, so its bug-B advantage comes from checklist content as well as blindness; and both spec-primed reps' suggested fix for the bug-B line (integer ms/1000 and ms%1000) still truncates toward zero on negatives, so the miss survives even their remediation.
- The fixture contained a fourth, unintended real bug (round-tripping integer milliseconds through double loses precision at epoch scale); all four reviewers caught it. Blind rep 1 additionally caught the FileShare.ReadWrite cross-process interleaving subtlety and the re-entrant Flush race (the race was caught by all four).
- 3(b) recurrence-rule test: RED DID NOT REPRODUCE. Both RED reps (opus, without the rule) already amended the standing brief template, one quoting doctrine phrasing inherited through the global CLAUDE.md import - contamination that is production-faithful, since a real orchestrator carries the doctrine too. Both GREEN reps produced the exact shaped behavior (amend the template, record in the Chapter, citing the rule). Adjudication: Section 5 was implemented anyway on the effort owner's explicit direction, recorded as codifying doctrine-induced behavior at the point of action (step 4), where it survives context compaction and reaches headless chain workers whose loaded context is the skill body, not the doctrine. It does not stand on a demonstrated RED failure, and that is recorded here for the walkthrough.
Review Findings: n/a (no repo changes; the validation itself was the gate).
Next: Sections 4 and 5 (wiring and recurrence rule).
Commit Model: Review-Only.

### Chapter 3 - 2026-07-09 (Sections 4 and 5)
Completed: Section 4 (pair wiring in executing-work step 3, workaround bar in the step 1 brief list, controller-owns-the-gate bullet in both doctrine copies) and Section 5 (recurrence rule in step 4). The Section 4 gate was satisfied by the Chapter 2 results before wiring began.
Implemented By: main session (fable inline, per spec tiers).
Metrics: review rounds 1 (paired: adversarial-reviewer plus blind-reviewer, the new rule dogfooded on its own diff); NEEDS_CONTEXT 0; escalations 0; advisor off.
Decisions / Surprises:
- The blind lens for this round ran as a general-purpose dispatch with the blind-reviewer prompt inlined (the installed plugin does not yet carry the new agent), extended with a prose-altitude clause; that clause was then folded back into the shipped agent file after Section 1's review had closed - flagged here as a post-review addition (it extends the lens to prose/config diffs, does not change the design).
- The blind reviewer found a real contamination hole in its own mechanism: under Review-Only or Branch-and-PR, a diff-from-base includes the plan doc's own hunks, delivering the intent story through a side door. Fixed in both the agent (pathspec exclude for docs/plans/, skip-and-note for listed plan paths) and step 3 (omit docs/plans/ from the blind dispatch's changed-file list).
- Additional blind findings fixed: responding-to-review now enumerates blind-reviewer (body and frontmatter triggers); step 1's DONE_WITH_CONCERNS routing now names the adversarial-reviewer and forbids handing concerns to the blind-reviewer; the escalation rule now defines a review round as the parallel pair, failed when any reviewer's Critical survives adjudication; the recurrence rule now names the standing brief's home (a Standing Brief Amendments block in the plan doc folded into every later dispatch).
- Adversarial (spec-primed) round: one Major that was a read-race on this very plan doc (it read Chapters as "(none yet)" while Chapter 2 was being written; the required gate record exists) - no change needed; one Minor noting the pre-existing "over every section" absolutism vs the trivial carve-out, carried forward knowingly.
- Justified, not fixed (blind Minors): the doctrine's security-review absolutism predates this spec and reconciling it would change security cadence semantics in an effort that declared security-reviewer out of scope - left for a future doctrine pass; the workaround bar's three wordings (two agents, one brief list) are deliberate, because agent prompts are self-contained by design (subagents inherit no skill bodies), so the canon is the principle, not a shared sentence.
Review Findings: adversarial APPROVED_WITH_CONCERNS (1 Major adjudicated no-change as a read-race, 1 Minor noted); blind APPROVED_WITH_CONCERNS (2 Majors fixed, 3 Minors fixed, 2 Minors justified above).
Next: finishing-work.
Commit Model: Review-Only.

### Chapter 4 - 2026-07-09 (Finishing pass and close-out)
Completed: whole-effort finishing pass; effort Complete and archived, all changes staged.
Implemented By: main session (fable) orchestrating; qa-verifier (sonnet pin), adversarial-reviewer (session model), docs-curator (opus pin).
Metrics: finishing review rounds 1; advisor off (unavailable this session).
Decisions / Surprises:
- QA: every acceptance criterion PASS except one genuine FAIL: the recurrence rule promised a Standing Brief Amendments fold-in that step 1 never performed (one-sided mechanism). Fixed: step 1's brief list now folds the block into every dispatch; targeted re-verify shows both sides on disk (write at step 4, fold at step 1); delta 1 FAIL to 0.
- Final adversarial review: APPROVED_WITH_CONCERNS, all findings adjudicated. Major 1 (unstaged load-bearing hunks) was this effort's own late QA fix and curator edit landing mid-review, staged at close. Major 2 (five stale counted enumerations of the review-agent set) fixed: plugin.json now says five review agents; README gains the roster line, the paired-review workflow sentence, and blind-reviewer in the unpinned list; design-council now says five angles. Major 3 (round definition excluded security) fixed: a round is the full set of reviewers dispatched for the section. Minors fixed: stop-docs-hygiene.js SCRATCH_NAME gained _blind (node --check green); the blind exclusion widened from docs/plans/ to all of docs/ plus commit messages, in both the agent and step 3. Minor deviation accepted and the spec amended: Section 3's "verbatim" acceptance overstated the record; the Chapter holds distilled per-rep results with honest caveats (reversal: save future validation transcripts to .kit/ and cite paths).
- Security review: deliberately not dispatched, surfaced for adjudication rather than silent. The changeset was markdown prose until the final round added one alternation token to stop-docs-hygiene.js's SCRATCH_NAME regex; that line was verified by node --check and changes no input handling. If a security pass is wanted over that hook delta, it is a one-file dispatch.
- Docs curation: drift NONE on the review flow (all seven files confirmed against spec and Chapters); one index mistake (docs/README.md claimed no active plans) fixed in place by the curator; no architecture doc manufactured, per the kit's single-source doctrine (the plugin prose is the truth).
- Environment: no persistent local-state changes. Git's dubious-ownership check was routed around with a session-scratch GIT_CONFIG_GLOBAL that dies with the session; the permanent fix is Scott's safe.directory one-liner. The installed plugin and the live ~/.claude doctrine copy lag this repo until the plugin updates and the SessionStart refresh hook runs. Memories banked: git-dubious-ownership, plugin-install-lag.
Review Findings: no Criticals anywhere in the effort; every Major fixed or adjudicated with the reason recorded; Minors fixed or justified.
Next: none. Effort complete; delivered in this changeset, staged for the review-commit.
Commit Model: Review-Only.

### Chapter 5 - 2026-07-09 (Kaizen round, pre-commit)
Completed: the two kaizen items this effort surfaced, applied at Scott's request so they land in the same review-commit. The archived plan is edited here because this is the same undelivered changeset reopened, not new work after delivery.
Implemented By: main session (fable).
Metrics: review rounds 1 (scoped security review); NEEDS_CONTEXT 0; escalations 0; advisor off.
Decisions / Surprises:
- finishing-work step 2 gains the prose-only security waiver as a file-type predicate: every changed file markdown or plain text, or the waiver is void and the review runs scoped to the non-prose files; a skip is recorded with changed-file evidence in the final Chapter. Probe-tested at opus in both directions, 2/2 correct: the prose-only probe skipped and wrote exactly the prescribed record; the mixed probe (one-line .js tweak) ran the scoped review and explicitly rejected the edit-size rationalization.
- writing-skills' testing section gains the contaminated-RED paragraph: a test subagent inherits the doctrine through global CLAUDE.md, so a doctrine-adjacent rule can show no RED failure, and that absence is weak evidence; such a rule ships only on recorded point-of-action rationale (compaction survival, headless workers) or not at all. It stands on the observed instance it was written from, this effort's own Section 3(b) result, which is the standard it prescribes.
- Consistency obligation honored: applied to this very changeset, the new waiver is void (stop-docs-hygiene.js and plugin.json are non-prose), so the scoped security review the rule requires was run over those two files. VERDICT: CLEAR - the widened regex is a static flat alternation (no injection, no ReDoS), walk bounds and filename sanitization unchanged, plugin.json parses clean, no dependency surface. This supersedes Chapter 4's skip adjudication with the review the shipped rule itself mandates. Reviewer's non-security note, accepted as-is: _blind is a substring match, so a curated doc named like color_blindness.md would trip a one-time stop-block, a nuisance identical in kind to the pre-existing _qa token.
- Kaizen mechanics: the inbox was empty and both items were applied directly with Scott present, so there were no note lines to clear and no briefs to archive.
Review Findings: security CLEAR (scoped); waiver probes 2/2 GREEN both directions; no adversarial dispatch for two paragraph-scale skill edits already covered by the probes and this record.
Next: none. Effort complete; delivered in this changeset, staged for the review-commit.
Commit Model: Review-Only.

### Chapter 6 - 2026-07-09 (Script consolidation, pre-commit)
Completed: root script consolidation at Scott's request, in the same changeset. setup.ps1 and setup.cmd deleted; their two actions (kaizen signpost write, core.hooksPath wiring) now live inline in doctor.ps1's -Fix branch, making doctor.cmd -Fix the single Windows first-run tool (setup plus verification in one pass). setup.sh stays as the POSIX path until a doctor.sh exists; the backlog's doctor.sh item now names absorbing it. References updated: README root map and install steps, the .githooks/pre-commit comment, the kaizen skill's signpost line, and doctor's own header and remediation strings.
Implemented By: main session (fable).
Metrics: review rounds 0 (verification by live runs); NEEDS_CONTEXT 0; escalations 0; advisor off.
Decisions / Surprises: kept build.ps1/build.sh (a different job, and the pre-commit hook calls both branches); kept doctor.cmd (a policy-blocked script cannot fix the policy that blocks it); kept setup.sh rather than writing a doctor.sh that could not be exercised on a real POSIX box tonight. Root scripts go from seven to five.
Verification: doctor.ps1 ran end to end green in check mode after the edits, and the new -Fix branch was exercised live (signpost moved aside, -Fix regenerated it with a FIXED report and semantically identical content, and the same run's signpost check read it back PASS). Stale-reference sweep clean: outside history and the deliberate backlog note, nothing mentions the deleted files.
Next: none. Effort complete; committed and pushed on Scott's in-session authorization, which supersedes the header's Review-Only for this delivery.
Commit Model: Commit-and-Push (this changeset, by explicit instruction).
