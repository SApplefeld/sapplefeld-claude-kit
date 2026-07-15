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
- finishing-work step 7: the consolidate-memory offer becomes availability-gated, verbatim: "when the effort wrote or corrected any memory and a `consolidate-memory` skill is present in the session's skill catalog, offer a pass in one line; when the skill is absent, fold the same hygiene (merge duplicates, fix stale facts, prune the index) into the memory edits you already made and say nothing." (The parenthetical was restored during execution: the original verbatim dropped the hygiene definition, leaving the fallback's "same hygiene" dangling with no antecedent, which both Section 2 reviewers flagged. Intent unchanged.)
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

### Chapter 2 - 2026-07-15
Completed: Section 2 - Dangling and stale references
Implemented By: implementer-sonnet (main session applied one review-driven fix)
Metrics: 1 review round (adversarial + blind, both fresh-context); 0 NEEDS_CONTEXT; 0 escalations; advisor off (plugin not installed)
Decisions / Surprises: `/goal` verified real (built-in Claude Code command wrapping a session-scoped prompt-based Stop hook), so the existing present-tense clause was kept unchanged (keep-and-name-accurately branch). Only executing-work:60 tied "kaizen inbox" to the Sonnet experiment; the other three kaizen-inbox mentions are legitimate capture references and were left. The two "global CLAUDE.md" pointers were in responding-to-review and kaizen (kaizen's phrased "the global rule in CLAUDE.md"); both repointed to "the kit doctrine (imported via `~/.claude/CLAUDE.md`)", which is factually the import mechanism (home/CLAUDE.md does `@claude-kit-doctrine.md`).
Review Findings: Major (both reviewers) finishing-work:39 - the verbatim availability-gated replacement dropped the "(merges duplicates, fixes stale facts, prunes the index)" definition, leaving the fallback's "fold the same hygiene" with no antecedent; since no `consolidate-memory` skill ships in the repo, the fallback is the branch that executes, so this was an unexecutable instruction. FIXED: restored the definition inline as a parenthetical (kit style, no em dash); spec §2 text updated to match, intent unchanged. Minor (adversarial): writing-skills used double quotes around "code review between tasks" where the spec's verbatim block showed single quotes - KEPT double quotes (the file's own convention and the original text use double quotes for inline quotes; the single quotes were an artifact of the spec nesting the sentence inside a double-quoted block). Minor (adversarial): kaizen frontmatter still says "the global capture rule" - left as-is (a rule-name, not a file pointer; outside §2's directed scope). Minor (blind): writing-skills:54 still says "the global CLAUDE.md, doctrine included" - left as-is (an inheritance-mechanics description, not a doctrine pointer; §2 was scoped to two files). Minor (adversarial): the residual "The predicate gates the offer" sentence is now slightly imprecise with two predicates - left, negligible.
Preserve-contract checks: no "kaizen inbox" remains on the Sonnet-experiment line (only step 6's legit capture mention); no "global CLAUDE.md"/"global rule in CLAUDE.md" in responding-to-review or kaizen; finishing-work no longer carries an unconditional consolidate-memory offer (now availability-gated and self-contained); writing-skills "live specimen" gone with no dangling references to it anywhere in the tree.
Next: Section 3 - Hook defects: PowerShell coverage and the drifted resume nudge. CARRY FORWARD to Section 6: consider normalizing writing-skills:54 "global CLAUDE.md, doctrine included" and other kit-wide "global rules"/"global CLAUDE.md" phrasings for consistency (out of §2's directed scope).
Commit Model: Commit-and-Push (commit now; push at finishing-work per Scott)

### Chapter 3 - 2026-07-15
Completed: Section 3 - Hook defects: PowerShell coverage and the drifted resume nudge
Implemented By: implementer-opus (main session applied one review-driven accuracy fix)
Metrics: 1 review round (adversarial + blind + security, all fresh-context); 0 NEEDS_CONTEXT; 0 escalations; advisor off (plugin not installed). Guard test: 18/18 pass.
Decisions / Surprises: Confirmed by reading all three guards that NONE reads the tool name (they read only `tool_input.command`/`file_path`), so the hooks.json matcher is the sole lever and there was no internal tool-name check to extend. The change is therefore: add `PowerShell` to the three PreToolUse matchers (docs-write-guard, pr-docs-guard, merged-pr-push-guard); guard JS logic untouched; all guards remain fail-open. session-start.js's injected tier sentence was shrunk to defer to executing-work's routing rules (this also discharges Section 4's tier-band "session-start.js defers to executing-work" collapse, so Section 4 does not touch session-start.js). Guard fixtures live in `.kit/scratch/guards.test.js` (gitignored, not shipped: build.sh zips everything under plugins/claude-kit/, so a committed test there would bloat the plugin); they are re-run as the Section 7 finishing gate. A permanent committed hook-test harness is a possible follow-up for Scott (standing regression cover), deliberately not added here per Out of Scope "no new capability".
Review Findings: Blind MINOR claimed `PowerShell` is not a real Claude Code tool (making the matchers inert) - DISMISSED with evidence: claude-code-guide confirmed against the official tools reference that `PowerShell` is a real, distinct tool ("Executes PowerShell commands natively"; auto-enabled on Windows without Git Bash, opt-in elsewhere via CLAUDE_CODE_USE_POWERSHELL_TOOL=1), so the matcher additions provide real coverage. Adversarial MINOR: session-start.js misattributed the fable-override authorization to the "Fable Spend header" - FIXED to "its tier assignment authorizes and the Fable Spend header makes visible", matching executing-work's precise wording. Security: CLEAR (a pre-existing `${branch}` shell-interpolation in merged-pr-push-guard was noted as out of scope and not made more reachable by the matcher change; carried as a future-hardening candidate).
Preserve-contract checks: hooks.json parses; the three matchers now contain PowerShell; guards fail-open and JS unchanged (git diff --stat: only hooks.json 6 lines + session-start.js 2 lines); node --check on session-start.js passes; rendered session-start output contains the new routing sentence and haiku fix, old "sonnet/opus/fable sections are dispatched" text gone.
RESIDUAL VERIFICATION (name the claim I'd most expect wrong): the guards read `tool_input.command`; the PowerShell tool's exact PreToolUse input field name is NOT in accessible docs and could not be observed in this Linux sandbox (no PowerShell tool active). It is strongly inferred to be `tool_input.command` (parallel to Bash, per claude-code-guide). If the real PowerShell payload uses a different field, the guards fire-but-fail-open (no wrong behavior, just silent no-coverage - the exact expensive failure §3 names). Scott (or any Windows session with the PowerShell tool enabled) should confirm one real PowerShell PreToolUse payload shape. The spec anticipated this ("verify against the real payload shape before assuming"); it is a runtime check only a PowerShell-enabled host can do.
Next: Section 4 - Single-owner collapses.
Commit Model: Commit-and-Push (commit now; push at finishing-work per Scott)

### Chapter 4 - 2026-07-15
Completed: Section 4 - Single-owner collapses (all 12 clusters)
Implemented By: implementer-opus (main session added one review-driven pointer)
Metrics: 1 review round (adversarial + blind, both fresh-context, opus); 0 NEEDS_CONTEXT; 0 escalations; advisor off (plugin not installed). Doctrine reduced 1156 bytes net (37830 -> 36674 source), exceeding the ~900 target.
Decisions / Surprises: Dispatched to implementer-opus via a detailed cluster-by-cluster brief (`.kit/scratch/section4-brief.md`) that pre-resolved the spec seams so the implementer stayed a faithful executor. Resolved seams: (a) the style-precedence cluster names "implementers" but §4's file scope excludes the implementer agent files, so §4 shrank only executing-work's restatement and the implementer-agent precedence residue is carried to §5 (which legitimately edits those files); (b) the pin-test-set operational-residue shrink in executing-work lives inside step 1's run-on brief-contents sentence that §5 replaces wholesale, so it was left for §5 to avoid collision. This section also DISCHARGES Chapter 1's carry-forward: compact-session and brainstorming Run Mode restatements now defer to executing-work's attendance model (compact-session chain-mode entry "executing-work enters chain per its Run Mode check"; brainstorming "resolved by attendance at execution time"), and the §1 residual is closed. session-start.js was NOT touched (its tier collapse was done in §3).
Review Findings: Adversarial APPROVED (all 12 preserve-contracts verified against owner sites; mirror faithful; no em dashes; no newly-introduced journey phrasing - the two date-stamped phrases on modified lines are pre-existing and are §6's worklist; all pointers resolve to targets that own the rule). Blind APPROVED_WITH_CONCERNS: one MINOR - the D3 frozen-branch bullet dropped the strand-check verify command without a pointer (other collapses all point to their owner). ADDRESSED: added a minimal pointer "finishing-work and branch-hygiene own the strand-check that catches one"; mirror regenerated IDENTICAL. Implementer's three DONE_WITH_CONCERNS judgment calls (E1 restatement count, E2 pin-test deferral to §5, C3 skip-economics scope) were all reviewed as sound and preserve their contracts.
Preserve-contract checks (all green, verified by both reviewers and re-run): tier-band (locus rule in doctrine + brainstorming step 11 owns bands + haiku sibling/gate at brainstorming and implementer-haiku); Fable Spend (header rule + never-silent in doctrine; consequences at finishing-work:12, brainstorming:59, executing-work escalation); advisor (executing-work "The advisor" owns; compact-session cost-hold-verify BINDING survives); Run Mode (header-less autonomous resume still chains); curating-docs (plans-leave-on-Complete always-on); kill-first (both bullets name it, liveness owns mechanics); verbatim twins (subagents-never-stage + controller stage-read-commit residue in executing-work); frozen-branch (pre-merge-records discipline always-on, strand-check owned by finishing-work/branch-hygiene); .kit-not-docs (one statement + observed-RED tell); compact-session internal (200k/150k thresholds unchanged, Housekeeping owns ledger, kit-doctor owns Bun probing); compaction-trigger vs completion-contract (executing-work step 8 owns carve-out, two acknowledging clauses added). Mirror byte-identical (IDENTICAL, 36301 bytes); em dashes clean across all 5 files.
Next: Section 5 - Dispatch-brief template and implementer re-pin. CARRY INTO §5: also shrink the four implementer agents' style-precedence re-definition to "honor each style skill's precedence rule" (the §4 style-precedence cluster named implementers but they are out of §4's file scope; §5 edits those files).
Commit Model: Commit-and-Push (commit now; push at finishing-work per Scott)
