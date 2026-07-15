# Kit Stabilization: Contradictions, Dangling References, Single-Owner Collapse

Status: In Progress
Commit Model: Review-Only
Run Mode: interactive
Fable Spend: finishing reviews (default); no fable-tier sections
Created: 2026-07-14

## Goal

The kit's behavior-shaping surface (doctrine, skills, agents, hooks) is internally consistent, every rule has exactly one owning site with pointers elsewhere, no reference names a thing that does not exist, the guard hooks cover PowerShell, and the prose complies with the kit's own writing standards. Grounded in the 2026-07-14 three-pass audit (two fresh-context reviewers plus the orchestrator's read); this spec is the adjudicated result. When this is done, the kit is stable for the foreseeable future and the drift generator (rules duplicated across layers) is closed by an authoring rule.

## Approach

Fix in dependency order: live contradictions first (they steer sessions divergently today), then dangling references and hook defects, then the single-owner collapses, then the conformance sweep, then the generator rule. Every collapse carries a preserve-contract: the behavioral effect that must still hold, checkable by grep or read, so review verifies behavior did not change. The doctrine mirror (`home/claude-kit-doctrine.md`) is regenerated from the operating-instructions skill body after every section that touches it, using the doctrine-refresh strip semantics, and verified byte-identical (the regeneration script pattern lives in the kit history; ten lines of Node). Where this spec provides replacement text verbatim, use it verbatim; where it provides a directive plus preserve-contract, the wording is the implementer's within the named constraints.

General constraints for every section: no em dashes anywhere; comments and skill prose state current state, never the journey; frontmatter descriptions stay quoted and trigger-only; a section that touches operating-instructions regenerates and verifies the mirror as part of its own gate.

## Sections of Work

### 1. Resolve the three live contradictions
Model: sonnet
Files: `plugins/claude-kit/skills/operating-instructions/SKILL.md`, `plugins/claude-kit/skills/executing-work/SKILL.md`, `home/claude-kit-doctrine.md` (regenerated).

Replacement texts, verbatim:

(a) Doctrine, "The controller owns the gate" bullet: replace the clause mandating reviews "over every section" so the sentence reads: "Dispatch the per-section reviews per the executing-work skill's roster (adversarial plus blind by default, security when the section touches a risk surface, the trivial-section skip where it applies), launched before the slow suites so they use the idle time and their fixes fold into a single gate run." The rest of the bullet (fail-dangerous hunting, expectations about raw findings) is untouched.

(b) executing-work, Run Mode check: replace the sentence "Chain is the standard posture: a `Run Mode: chain` header - or a spec with no Run Mode header at all - stands up the compact-session skill's chain mode (the supervisor/worker pair per that skill) before the section loop" with: "A `Run Mode: chain` header stands up the compact-session skill's chain mode (the supervisor/worker pair per that skill) before the section loop. A spec with no Run Mode header follows attendance: on an autonomous resume with no one watching, chain; when I am present and driving, interactive. When present-and-driving is not determinable, ask." The worker-runs-this-skill sentence and the rest of the paragraph are untouched.

(c) Doctrine, "Finish deliberately" bullet: replace "present every drift item to me for adjudication rather than silently reconciling it; mark each deliberate spec deviation in the affected doc with its trade-off and reversal cost" with: "route drift per the finishing-work skill: a likely-mistake stops for my call, a deliberate deviation rides in the Chapter and PR record with its trade-off and reversal cost, and nothing is ever silently reconciled." finishing-work step 4 already carries the full protocol and is the owner; do not edit it.

Tests: the old absolutes are gone (grep "over every section" and "present every drift item" return nothing in skills/ and home/); mirror byte-identical after regeneration; executing-work still sends a header-less autonomous resume to chain (the sentence states it).

### 2. Dangling and stale references
Model: sonnet
Files: `plugins/claude-kit/skills/writing-skills/SKILL.md`, `plugins/claude-kit/skills/executing-work/SKILL.md`, `plugins/claude-kit/skills/finishing-work/SKILL.md`, `plugins/claude-kit/skills/responding-to-review/SKILL.md`, `plugins/claude-kit/skills/kaizen/SKILL.md`.

- writing-skills: delete the "live specimen" paragraph's claim about executing-work's current description; keep the rule and the observed-failure evidence in this verbatim form: "A description that summarizes the workflow gets acted on in place of the body: a summary reading 'code review between tasks' yields one review where the body specifies two."
- executing-work: the Sonnet-experiment clause points at `docs/backlog.md`, not the kaizen inbox. The `/goal` Stop-hook sentence: verify whether a harness-level goal/stop mechanism exists on current Claude Code (consult the claude-code-guide agent); if yes, name it accurately in present tense; if no, delete the clause and keep "this contract is the mechanism."
- finishing-work step 7: the consolidate-memory offer becomes availability-gated, verbatim: "when the effort wrote or corrected any memory and a `consolidate-memory` skill is present in the session's skill catalog, offer a pass in one line; when the skill is absent, fold the same hygiene into the memory edits you already made and say nothing."
- responding-to-review and kaizen: replace "the global CLAUDE.md" pointers with "the kit doctrine (imported via `~/.claude/CLAUDE.md`)".

Tests: grep confirms no remaining reference to "kaizen inbox" for the Sonnet experiment, no unconditional consolidate-memory offer, no "global CLAUDE.md" phrasing in the two skills.

### 3. Hook defects: PowerShell coverage and the drifted resume nudge
Model: opus
Files: `plugins/claude-kit/hooks/hooks.json`, `plugins/claude-kit/hooks/docs-write-guard.js`, `plugins/claude-kit/hooks/pr-docs-guard.js`, `plugins/claude-kit/hooks/merged-pr-push-guard.js`, `plugins/claude-kit/hooks/session-start.js`.

- Extend the three guards to PowerShell: add `PowerShell` to the relevant matchers in hooks.json, then read each guard and extend any internal tool-name check so a PowerShell payload takes the same path as Bash (both tools deliver the command string in `tool_input.command`; verify against the real payload shape before assuming, and keep every guard fail-open on unrecognized shapes exactly as they are today).
- session-start.js: re-pin the injected tier-routing sentence to executing-work's current rules: the tier list includes haiku; untiered briefable sections dispatch at the tier they would have earned rather than defaulting to the main thread. Prefer shrinking the injected sentence to defer to executing-work (per the collapse in section 4) over restating more.

Tests: at minimum, lock both directions per guard: a simulated PowerShell `gh pr create` payload with dirty docs/ is blocked and a clean one passes (pr-docs-guard); a simulated PowerShell push to a merged branch is blocked and an unmerged push passes (merged-pr-push-guard); a subagent-attributed PowerShell write into docs/ is denied and a main-session write passes (docs-write-guard). Bash-path behavior is pinned unchanged by running the same fixtures through the Bash tool name. The silent failure is the expensive one: a guard that never fires looks identical to a guard that passed.

### 4. Single-owner collapses
Model: opus
Files: `plugins/claude-kit/skills/operating-instructions/SKILL.md` (and mirror), `plugins/claude-kit/skills/brainstorming/SKILL.md`, `plugins/claude-kit/skills/executing-work/SKILL.md`, `plugins/claude-kit/skills/compact-session/SKILL.md`, `plugins/claude-kit/hooks/session-start.js` (tier sentence, with section 3).

Apply the audit's single-owner assignments. For each cluster: the named owner keeps the full rule; every other site shrinks to its operational residue or a pointer. Preserve-contracts are binding.

| Cluster | Owner | Others shrink to | Preserve |
|---|---|---|---|
| Tier-band definitions | brainstorming step 11 | doctrine keeps locus rule only; executing-work keeps escalation ladder; session-start.js defers to executing-work | haiku's sibling+gate requirement still stated at brainstorming and in the haiku agent; escalation ladder intact |
| Fable Spend consequences | each point-of-action skill | doctrine keeps header rule + never-silent principle, delegates the enumeration | every consequence still stated at its own moment |
| Advisor facts | executing-work "The advisor" | brainstorming keeps header semantics only; compact-session keeps chain-operational rule (verify off under cost hold) | the cost-hold-verify step survives in compact-session |
| Run Mode posture | executing-work (entry), compact-session (mechanics), brainstorming (header choice) | doctrine keeps one-line posture; metering contingency lives in compact-session only | header-less autonomous resume still chains |
| curating-docs restatement in doctrine | curating-docs | doctrine bullet to ~one third: invariants (Complete leaves plans/ same close-out; backlog pruned-live; scratch to .kit/) plus pointer | the plans-leave-on-Complete invariant stays always-on |
| Kill-first mechanics (doctrine x2) | liveness bullet owns mechanics | contract-change bullet keeps its trigger, points at stop-first | both triggers still name kill-first |
| Verbatim twins (pin-test set, scout return contract, pathspec semantics) | doctrine | executing-work keeps operational residue only | subagents-never-stage and controller stage-read-commit survive in executing-work |
| Frozen-branch cluster | doctrine keeps pre-merge-records discipline; finishing-work owns strand-check command; branch-hygiene owns recovery | others drop the repeated verify command | the pre-merge records rule stays always-on |
| .kit/-not-docs/ triple statement in executing-work | one statement + the dispatch-line tell | delete the two restatements | the observed-RED tell survives |
| compact-session internal (ledger list x2, skip-economics x3, WinGet paths) | Housekeeping owns ledger list; compact-session owns skip economics; kit-doctor owns Bun probing | pointers | the 200k/150k thresholds and check-gating unchanged |
| Style-precedence restatements (x5 redundant) | doctrine + each style skill | implementers and executing-work say "honor each style skill's precedence rule" without re-defining it | mechanically-enforced contract still wins, stated in the style skills |
| Compaction trigger vs completion contract | executing-work step 8 owns the interactive carve-out | compact-session's "When to compact" and interactive mode gain one clause acknowledging it (mid-plan attended without relay: defer to the turn's true end) | the 200k trigger and relay exception unchanged |

Tests: after each cluster, the preserve-contract is checked by grep or read and recorded in the Chapter; the doctrine body's character count is reported before and after (target: 900+ always-on tokens removed); mirror regenerated and byte-identical.

### 5. Dispatch-brief template and implementer re-pin
Model: opus
Files: `plugins/claude-kit/skills/executing-work/SKILL.md`, `plugins/claude-kit/agents/implementer-{haiku,sonnet,opus,fable}.md`.

Replace the run-on brief-contents sentence in step 1 with this template, verbatim, followed by one sentence stating that every dispatch includes every REQUIRED field and the conditional fields when their condition holds:

```
Dispatch Brief (all REQUIRED unless marked):
- Spec path + section name
- Files in scope
- Acceptance criteria (verifiable)
- Tests: the section's Tests: line verbatim when the spec has one (a floor:
  extend with what implementation reveals, never shrink, flag amendments);
  else the test-worthiness call and what a test should lock
- Sibling pattern to mirror, when one exists: name it AND require mirrored
  failure-mode breadth (catch scope, regex generality)
- Pin tests + new expected values, when the section changes a counted
  cross-cutting set
- Standing Brief Amendments: every entry from the plan doc's block, when one exists
- Workaround bar: a workaround needing a paragraph to justify means fix the
  code or escalate
- Style-skill file paths (agents inherit no skills)
- Build + test commands
- [haiku only] The exact sibling to clone and the self-surfacing gate command;
  if either cannot be named, dispatch at sonnet
- [below-fable session, fable tier] The explicit fable model override; the
  spec's tier assignment is the spend authorization
```

Then re-pin the four implementer agents' "The dispatching session provides:" lists to these field names exactly (a writer/reader cross-component pin), preserving each agent's tier-specific variants (haiku's transcriber framing stays; opus/fable's coordination clause stays). Keep executing-work's surrounding judgment prose (orchestrator-stays-lean, handling statuses, escalation) outside the template.

Tests: the four agents' lists and the template agree field-for-field (read all five in one pass and diff by eye or script); no required element from the old sentence is absent from the template (checklist in the Chapter against the old text).

### 6. Writing-standards conformance sweep
Model: sonnet
Files: all `plugins/claude-kit/skills/*/SKILL.md`, `plugins/claude-kit/agents/adversarial-reviewer.md`, `plugins/claude-kit/agents/security-reviewer.md`.

- Journey phrasing: recast every discovery-event passage as a present-tense property, keeping load-bearing numbers and dropping dates/narrative. The audit's list is the worklist (executing-work: decided-2026-07-12 parenthetical, verified-on-v2.1.205 lead-in, starved-the-experiment clause; compact-session: six passages; doctrine: transcript-study lead-in, recent-first-round-Majors, field-notes framing; scott-writing-style: derivation-story framing). Version-bound facts take the form "on v2.1.205, X"; provenance stays in the archived specs and backlog that already hold it.
- adversarial-reviewer: replace "Style violations are Minor unless they damage maintainability" with an observable conditional (e.g., "Style violations are Minor; rate a violation higher only when it changes behavior or hides a defect").
- security-reviewer description: align with finishing-work's prose waiver ("always over the full changeset during finishing-work, except the all-prose changeset waiver finishing-work defines").
- cold and design-council descriptions: trim the workflow-summary tails to trigger-only; quote all unquoted frontmatter descriptions (cold, design-council, systematic-debugging).
- executing-work Chapter template: add implementer-haiku to the Implemented By enum.
- Doctrine finishing-pass ordering sentence: align with finishing-work's parallel dispatch ("QA verification first, then the finishing reviews and docs curation, which may run in parallel"). Escalation-ceiling sentence: qualify per executing-work ("the escalation ceiling for sections tiered below fable; a fable-tier stall is raised, not absorbed").

Tests: grep for the banned shapes across skills/ and agents/ returns clean: `decided 20`, `verified live`, `observed live`, `verified on v` at line starts of narrative (manual read for false positives), `unless they damage`; all frontmatter descriptions are quoted (yaml parse or eyeball); mirror regenerated.

### 7. The authoring rule, close-out
Model: sonnet
Files: `plugins/claude-kit/skills/writing-skills/SKILL.md`, then finishing pass.

Add to writing-skills' Anatomy section, verbatim: "**One owner per rule.** Every rule has exactly one owning site; every other mention is a pointer or an operational residue at its point of action, never a restatement. A rule stated twice is two rules a week later: the 2026-07-14 stabilization audit found a dozen drifted copies, one in outright contradiction. When editing a rule, grep for its key phrases across the kit and fix the owner, not the nearest copy."

Then the standard finishing pass per finishing-work: qa-verifier n/a for prose but section 3's hook fixtures re-run as the gate; security review (changeset includes hook JS, so the prose waiver does not apply); final adversarial review at Fable; docs curation; Chapter; archive via curating-docs; backlog updates (retire the audit-superseded items if any); close-out.

Tests: the finishing reviews return no Critical; the archive/index/backlog reflect the effort; every section's preserve-contract checks are recorded in Chapters.

## Out of Scope

- `home/CLAUDE.md` / `~/.claude/CLAUDE.md` graphify pointer to a skill absent on this machine: user-level file, Scott's call, flagged for him separately.
- The doctrine-refresh CRLF blank-line cosmetic (kaizen candidate, pending nod).
- Build-time generation of the implementer agents from one template: declined for now; section 5's cross-pin plus an authoring comment naming the canonical sibling is the lighter fix. Revisit only if the four files drift again.
- Any new capability. This effort only reconciles and reduces.

## Open Questions

- Section 2's `/goal` verification outcome decides delete-vs-rename; the section carries both branches. RESOLVED 2026-07-15 (claude-code-guide): `/goal` is a real built-in Claude Code command (a session-scoped prompt-based Stop hook), so Section 2 takes the keep-and-name-accurately branch, not delete.

## Related

- `claude-kit_operating-model_spec_v1.md` (archive): the posture this effort's execution follows (Opus-led, Fable finishing reviews).
- `claude-kit_concurrency-safeguards_spec_v1.md`, `claude-kit_compaction-tuning_spec_v1.md` (archive): sources of several rules this effort assigns owners to.

## Chapters

### Chapter 1 - 2026-07-15
Completed: Section 1 - Resolve the three live contradictions
Implemented By: implementer-sonnet (main session applied one review-driven inline fix)
Metrics: 1 review round (adversarial + blind, both fresh-context); 0 NEEDS_CONTEXT; 0 escalations; advisor off (kit plugin not installed in this cloud workspace, so `/advisor` is unavailable; recorded per session)
Decisions / Surprises: Commit model treated as Commit-and-Push for this run per Scott (recorded header is Review-Only, which assumed a local session); push deferred to finishing-work. Scott authorized removing the doctrine mirror's legacy leading blank line (was Out of Scope, "pending nod"); the regeneration now matches doctrine-refresh.js strip semantics exactly, so the mirror lost one leading byte. `/goal` Open Question resolved to keep-and-name-accurately (it is a real built-in). Both reviewers flagged that edit (b) leaves sibling Run Mode restatements stale in compact-session and brainstorming; these are Section 4's "Run Mode posture" owner-collapse cluster and are carried forward as known residuals (see Next).
Review Findings: Critical (adversarial) executing-work:81 stale self-reference "(the standard posture per the Run Mode check)" introduced by edit (b) - FIXED inline to "(per the Run Mode check)". Major/Critical (both reviewers) compact-session:54 and brainstorming:35 Run Mode restatements - DEFERRED to Section 4 (their designated owner-collapse), recorded here. Minor: whether an attendance-inferred `interactive` is backfilled into the header (verbatim spec text; the "ask" fallback covers the undeterminable case - noted, no change). Noted (pre-existing, not a §1 regression): doctrine's "trade-off and reversal cost" phrase in the drift-routing clause is richer than finishing-work step 4's "record and surface for awareness"; spec declared finishing-work the owner and said not to edit it, so left as-is for Scott's call if he wants them aligned.
Preserve-contract checks: `grep "over every section"` and `grep "present every drift item"` return nothing in skills/ and home/ (clean); mirror byte-identical after regeneration (`node .kit/scratch/regen-doctrine.js check` -> IDENTICAL, 37457 bytes); header-less spec still routes an autonomous unwatched resume to chain (executing-work:50 "on an autonomous resume with no one watching, chain").
Next: Section 2 - Dangling and stale references. CARRY FORWARD to Section 4: reconcile compact-session/SKILL.md:54 and brainstorming/SKILL.md:35 Run Mode restatements to defer to executing-work's attendance model (preserve-contract: header-less autonomous resume still chains).
Commit Model: Commit-and-Push (commit now; push at finishing-work per Scott)
