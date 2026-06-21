# Docs Library Lifecycle

Status: In Progress
Commit Model: Review-Only
Created: 2026-06-19

## Goal

The kit treats every project's `docs/` folder as a curated library and working backlog, and it maintains that state on its own rather than relying on memory. When an effort finishes, the completed plan is archived, the backlog is pruned, related plans are cross-referenced, and the index is refreshed, every time, through the close-out path the kit already runs. The problem this fixes: plans were closed in place, so `docs/plans/` accumulated finished work and the library drifted into an attic.

## Approach

The fix extends the close-out path that already exists rather than adding a parallel system. A single new skill, `curating-docs`, owns the lifecycle mechanics; `finishing-work`, `brainstorming`, and an explicit retrofit invocation all call into it. A convention in `home/CLAUDE.md` defines the taxonomy so the behavior is legible even when the skill is not loaded. A deterministic backstop is added to the existing `session-start.js` hook, reusing its proven, injection-hardened additionalContext channel, so the nudge is non-blocking and consistent with the kaizen reminder already there.

Two append disciplines are kept deliberately separate. A plan's Chapters are append-only history and travel with the plan into `archive/`. The project backlog (`docs/backlog.md`) is pruned-live: completed items move to a dated snapshot in `archive/`, so the living doc never grows without bound. Conflating the two is what produces the endless-append problem.

Taxonomy: `docs/` root holds the stable about-the-solution docs and the README index; `docs/plans/` holds active plans only; `docs/archive/` holds finished or abandoned plans (Chapters intact) and dated backlog snapshots.

## Sections of Work

### 1. Library taxonomy and scaffold
Model: fable
Create the root `docs/` library (README index, `backlog.md`, `plans/README.md`, `archive/README.md`) and add a convention bullet to `home/CLAUDE.md` codifying the three zones, the two append disciplines, archive-on-complete, and the backlog-prune rule.
Acceptance: the scaffold exists at repo root, outside the plugin payload; `home/CLAUDE.md` describes the lifecycle in the kit's voice with no em dashes.

### 2. curating-docs skill
Model: fable
New `SKILL.md` plus `references/templates.md`. Covers archive-on-complete (git mv, history preserved), backlog-prune (dated quarterly snapshot), cross-reference on create and close, index-refresh, and a retrofit mode (read-only proposal first, apply on approval). Retrofit is folded in as a mode, not a separate skill, per the kit's stays-lean rule.
Acceptance: description is quoted and trigger-focused; body carries the mechanics; templates are referenced, not inlined into every caller.

### 3. finishing-work archival wiring
Model: fable
Rework the close step so that on `Status: Complete` it invokes `curating-docs` to move the plan to `archive/`, refresh the index, prune the backlog, and act on any cross-ref gaps `docs-curator` flagged.
Acceptance: the close step no longer leaves a completed plan in `docs/plans/`.

### 4. brainstorming register and cross-ref wiring
Model: fable
Extend the spec-write step so a new plan is registered in the index and backlog and links related or superseded plans.
Acceptance: writing a new spec also updates the index and sets up cross-references.

### 5. docs-curator drift flags
Model: fable
Add two report items to the agent: plan-to-plan cross-reference gaps, and any `Status: Complete` plan still in `docs/plans/`. Keep its write-only-under-docs charter; it flags, the main session moves and links.
Acceptance: the Drift Report format includes the two new flags without expanding the agent's write scope.

### 6. session-start.js backstop
Model: fable
Add a third predicate block counting `Status: Complete` plans still in `docs/plans/`, emitted as a non-blocking reminder modeled on the kaizen nudge. Silent when the count is zero.
Acceptance: clean repo emits nothing new; a repo with a completed-but-unarchived plan emits a reminder; the hook still exits 0 on any failure.

### 7. Verification
Model: fable
Run `session-start.js` against three fixtures (clean, in-progress, complete-unarchived), validate the emitted JSON, lint the JS, and check skill frontmatter YAML. Review every diff.
Acceptance: the hook behaves correctly on all three fixtures and the JSON parses.

### 8. Same-session Stop hook (follow-on, added 2026-06-19)
Model: fable
A `Stop` hook (`stop-docs-hygiene.js`) that, when a `Status: Complete` plan still sits in `docs/plans/` at turn end, blocks once with a reason to run `curating-docs` now, in the session that finished the work, rather than waiting for the next SessionStart nudge. Gated on the same rare predicate as the SessionStart backstop, so it is silent on every normal turn. Honors `stop_hook_active` to block at most once, and exits 0 on any failure so it can never trap the session. Registered under the `Stop` event in `hooks.json`.
Acceptance: no completed-unarchived plan emits nothing (the turn ends normally); one present emits `{"decision":"block","reason":...}`; a payload with `stop_hook_active: true` emits nothing.

### 9. Subagent report hygiene (follow-on, added 2026-06-19)
Model: fable
Day-of-use feedback: subagent reports were landing in `docs/plans/_impl_reports/` and getting committed, bloating the curated library and history. Root cause: `executing-work` told the orchestrator to have each subagent write its full report to a named file but named no location, so the orchestrator improvised a path under `docs/plans/`, and the repo had no `.gitignore`. Fix: reports return inline and are distilled into the Chapter, `docs/` is reserved for curated content, and bulky handoffs go to a gitignored `.kit/` scratch path. Changes: `executing-work` dispatch guidance, two `home/CLAUDE.md` rules, and a repo `.gitignore`.
Acceptance: no kit instruction tells a subagent to write a report into `docs/`; `.kit/` is gitignored; `docs/` scope is documented as curated-only.

## Out of Scope

- Auto-generating `architecture.md` for the kit itself. `docs-curator` already owns code-to-docs drift; this effort is about the library lifecycle, not content.

## Open Questions

None outstanding. The three design forks (separate index vs combined backlog, enforcement strength, retrofit) were decided with Scott on 2026-06-19: separate index and backlog, quiet SessionStart nudge, retrofit folded into curating-docs.

## Chapters

### Chapter 1 - 2026-06-19
Completed: all sections (1-7) in one main-thread pass.
Implemented By: main session (fable).
Decisions / Surprises: Folded the retrofit into `curating-docs` as a mode rather than shipping a separate `docs-tidy` skill, per the kit's stays-lean rule. Confirmed archival must run in the main session, not `docs-curator`: the curator is barred from touching plan docs, and a move counts as touching one, so it only flags and the main session moves. Surprise: the bash sandbox mount served a stale, truncated cache of `session-start.js` (a file that existed at session start) that never received the file-tool edits, while newly created files synced cleanly. Verified the hook logic via a sandbox copy instead (parses clean; correct output on clean, active, and complete fixtures) and confirmed the real file intact through the file tool.
Review Findings: No subagent reviews dispatched; this is a low-blast docs and skills changeset plus one hook edit. Verification covered: `node --check` on the authored logic, three hook fixtures, an em-dash scan, and a frontmatter YAML check.
Next: Scott reviews and commits. Status stays In Progress until he accepts. Running `finishing-work` (or the next SessionStart nudge) then archives this plan into `docs/archive/`, exercising the new lifecycle live.
Commit Model: Review-Only.

### Chapter 2 - 2026-06-19
Completed: Section 8, the same-session Stop hook.
Implemented By: main session (fable).
Decisions / Surprises: Scott opted into the Stop variant, so it moved from Out of Scope to Section 8. Confirmed the Claude Code Stop-hook contract with the claude-code-guide agent before writing: block via `{"decision":"block","reason":...}`, allow by exit 0 with no output, loop-guard on `stop_hook_active`. Kept the predicate scan duplicated in the new hook rather than refactoring the resume-critical `session-start.js` to share a helper: the blast radius of touching the resume hook outweighs the DRY win for a ten-line scan. Logged a backlog item to extract a shared helper if the predicate ever grows.
Review Findings: Verification covered node --check on the hook, three Stop fixtures (silent, block, loop-guard), and a hooks.json parse check.
Next: same as Chapter 1. Scott reviews and commits.
Commit Model: Review-Only.

### Chapter 3 - 2026-06-19
Completed: Section 9, subagent report hygiene.
Implemented By: main session (fable).
Decisions / Surprises: Surfaced by Scott after a day of real use. Chose inline-return-plus-Chapter over relocating reports to retained scratch, per Scott: the durable record comes from the main session. Kept a gitignored `.kit/` escape hatch for genuinely bulky handoffs. Did not edit the per-agent files: grep confirmed no agent specifies a report path, so the dispatch guidance in `executing-work` is the root fix, and the reviewers already return findings inline by charter. Scott declined cleanup of reports already committed in his main project, so that is his to run.
Review Findings: Verification: grep confirming no kit instruction routes a subagent report into `docs/`, a `.gitignore` content check, and an em-dash scan.
Next: Scott reviews and commits. Backlog follow-up: a RED/GREEN baseline-test of the new `executing-work` wording using Scott's exported transcript as the RED case.
Commit Model: Review-Only.

### Chapter 4 - 2026-06-19
Completed: Section 9 refinement after reviewing the exported RED transcript.
Implemented By: main session (fable).
Decisions / Surprises: Scott exported the NEO close-out session. Confirmed the root cause: the orchestrator, following executing-work's report-to-file instruction, improvised two docs/ locations: `docs/reviews/_rev_sp4_s<n>_<lens>.md` for reviewer findings and `docs/plans/_impl_reports/sp<n>_qa.md` for QA reports, then committed and pushed them. The reviewer and implementer agents themselves are clean (reviewers already return verdict, counts, and top finding inline by charter; no agent file names a path), so the dispatch guidance in executing-work is the only lever, as expected. Sharpened the executing-work wording with a red-flag naming the exact observed phrasing, and clarified that the summary-plus-file economy pattern is fine as long as the file lands in `.kit/`, not docs/.
Review Findings: Verification: file-tool read confirms the refined wording; em-dash scan.
Next: Scott reviews and commits. A full RED/GREEN baseline-test of orchestrator dispatch behavior remains a backlog item (the RED phrasing is now recorded there).
Commit Model: Review-Only.
