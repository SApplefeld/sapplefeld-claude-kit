# Branch Hygiene

Status: In Progress
Commit Model: Review-Only
Created: 2026-06-23

## Goal

Local branches and worktrees from finished Branch-and-PR efforts stop piling up. A SessionStart nudge surfaces the ones whose PRs have merged, and an on-demand reaper skill sweeps the clearly-safe set automatically (its work integrated and the worktree clean), reporting what it removed with an undo and listing anything unmerged or dirty for Scott to decide. Teardown is decoupled from the session that made the branch, because in Branch-and-PR the merge happens on the platform after the session ends.

## Approach

Root cause: `finishing-work` tears down only for Commit-and-Push, and for Branch-and-PR only "on your merge" within the session. In a strict-PR shop the merge happens on the platform, outside the session, so that trigger never fires; and the branch cannot be torn down in-session anyway, since it holds the unmerged PR. So cleanup must be a later, decoupled reaper keyed on the merge having actually happened.

Two pieces, both fail-open:

- A reaper skill (`branch-hygiene`), invoked on demand. `git fetch --prune`, then compute the safe set by the integration signal: a non-protected local branch is reapable if its upstream is gone after the prune (the platform deleted the remote branch on merge, a target-agnostic signal that its PR landed, whether into `develop` or `main`) **or** its tip is an ancestor of an integration branch that exists (`origin/develop`, else `origin/main` or `origin/master`), verified with `git merge-base --is-ancestor`. Protected, never reaped: `develop`, `main`, `master`, the current branch, and the default branch. Worktrees under `.claude/worktrees/` on a reapable branch with a clean tree come too. Auto-remove the safe set (`git worktree remove` without `--force`, then delete the branch), reporting each with its restore command (the commits are already in the integration branch, so `git branch <name> <sha>` brings it back). Anything unmerged, dirty, or a worktree outside `.claude/worktrees/` is listed, never auto-touched.

- A SessionStart nudge in a new `hooks/branch-reaper-nudge.js`, registered as a second SessionStart entry so the resume-critical `session-start.js` is left untouched. A cheap, local, fail-open check (no network fetch) counts local branches that are ancestors of the local `origin/main` ref and worktrees under `.claude/worktrees/`, and if any look reapable emits a "Reminder, not a blocker" line naming the count and the `branch-hygiene` skill. Times out fast; any error exits 0 with no output.

In NEO a feature branch lands via a PR into `develop` (and `develop` reaches `main` later, behind a full test run), so `develop` is the integration target, not `main`. NEO uses regular merges, never squash, so a landed feature branch's tip is always an ancestor of `develop`, and the ancestry signal alone detects it reliably with no dependency on any repo setting. The upstream-gone signal is kept as a bonus that also sweeps branches whose remote was deleted on merge. Enabling "auto-delete head branch on merge" in the repo settings is therefore optional here, a remote-cleanliness nicety rather than a requirement.

The `.claude/worktrees/` path is Claude Code's own convention (the kit does not create worktrees; this was observed in the NEO session), so the reaper auto-sweeps only worktrees there and merely reports any reapable worktree elsewhere, which may be one Scott created by hand.

## Sections of Work

### 1. branch-hygiene reaper skill
Model: fable
New skill. On invocation: identify the integration branch (`origin/develop` if present, else `origin/main`/`origin/master`) and the protected set (`develop`, `main`, `master`, the current branch, the default branch); `git fetch --prune`; compute the safe set (non-protected local branches whose upstream is gone after the prune, or whose tip is an ancestor of the integration branch; worktrees under `.claude/worktrees/` on those branches with a clean status); auto-remove the safe set (worktree remove without `--force`; branch delete, gated on a verified-integrated check so an unmerged branch is never force-deleted); report each removal with its restore command; list unmerged or dirty branches and worktrees, and any worktree outside `.claude/worktrees/`, without touching them.
Acceptance: a branch landed into `develop` (or whose remote was deleted on merge) and its clean worktree are removed and reported with undo; an unmerged branch is listed, not removed; `develop`, `main`, `master`, and the current branch are never touched; a dirty worktree is listed, not removed; a worktree outside `.claude/worktrees/` is reported, not removed; a non-repo or git failure is reported, not fatal.

### 2. SessionStart reaper nudge
Model: fable
New `hooks/branch-reaper-nudge.js`, registered as a second SessionStart entry (matcher `startup|resume`). A cheap, local, fail-open check: count non-protected local branches whose upstream is already marked gone or whose tip is an ancestor of the local `origin/develop` (else `origin/main`) ref (no network fetch), plus worktrees under `.claude/worktrees/`; if any look reapable, emit a "Reminder, not a blocker" `additionalContext` line naming the count and the `branch-hygiene` skill. Times out fast; any error exits 0 silently. Does not modify `session-start.js`.
Acceptance: with reapable branches present the hook emits a reminder; with none it is silent; any git failure or timeout exits 0 with no output.

### 3. Verification
Model: fable
`node --check` both hooks/scripts. Against a git fixture with a merged branch, an unmerged branch, a clean worktree on a merged branch, and a dirty worktree: the reaper removes the safe ones and lists the rest; the nudge detects and reminds; both fail open on a non-repo and on malformed input. `hooks.json` parses with the second SessionStart entry.
Acceptance: every fixture behaves; both fail open on bad input; `hooks.json` is valid.

## Out of Scope
- Reaping unmerged or abandoned branches automatically. They may hold unsalvaged work; the reaper only lists them.
- Auto-removing worktrees outside `.claude/worktrees/` (Scott's own manual worktrees); those are reported.
- The platform auto-delete-on-merge setting itself (a one-time repo-settings change Scott makes).
- Commit-and-Push teardown, which `finishing-work` already handles in-session.

## Open Questions
- The `.claude/worktrees/` convention is inferred from the NEO transcript and Claude Code's behavior, not documented in the kit. Confirm it during build; if worktrees land elsewhere, widen the auto-sweep scope or keep them in the report-only set.

## Related
Follows from the Branch-and-PR teardown gap in `finishing-work` and `executing-work`. Same SessionStart-nudge-plus-skill shape as the docs lifecycle work, a different domain.

## Chapters

### Chapter 1 - 2026-06-23
Completed: Section 1, the branch-hygiene reaper skill.
Implemented By: main session (fable).
Decisions / Surprises: Built as a prose runbook (the kit's idiom; the agent runs the git, as it already does for worktree teardown in `finishing-work`) rather than a bundled script. Tightened the auto-delete trigger versus the spec, on safety grounds: the only auto-delete condition is membership in `git branch --merged <integration-ref>` (verified merged), so `git branch -D` is always safe. "Upstream gone" was demoted from an auto-delete trigger to a report-only category, since a gone-but-not-merged branch could be squash-merged elsewhere or abandoned. Integration ref resolves to `origin/develop`, else `origin/main`/`origin/master`. Protects `develop`/`main`/`master`/current/default by name; worktrees auto-removed only under `.claude/worktrees/`, clean, without `--force`.
Review Findings: verified in Chapter 3.
Next: Section 2.
Commit Model: Review-Only.

### Chapter 2 - 2026-06-23
Completed: Section 2, the SessionStart nudge.
Implemented By: main session (fable).
Decisions / Surprises: New `branch-reaper-nudge.js` as a second SessionStart entry, leaving the resume-critical `session-start.js` untouched. Cheap and fail-open: resolves the integration ref from cached refs (no network fetch), counts `git branch --merged` minus protected, and reminds via a "Reminder, not a blocker" line. Times out at 4s; any error exits 0 silently.
Next: Section 3.
Commit Model: Review-Only.

### Chapter 3 - 2026-06-23
Completed: Section 3, verification, plus the folded-in docs-curator remit fix.
Implemented By: main session (fable).
Decisions / Surprises: Against a git fixture (faked `origin/develop` via `update-ref`): the nudge counts only the verified-merged, non-protected branch; the reaper's `--merged` set drops `develop`/`main`; a clean managed worktree and a verified-merged branch are removable; and the safety paths hold (unmerged `git branch -d` refused, dirty `git worktree remove` refused). `hooks.json` confirmed valid with both SessionStart entries via authoritative read. Folded in at Scott's request (a docs-alignment fix, sibling to pr-docs-gate, not branch work): broadened `docs-curator`'s "Update the living docs" step from `architecture.md` plus feature docs to every about-the-solution doc in `docs/` root that exists (security model, structure, siblings), updating the parts the effort affects and flagging drift in untouched ones. That addresses the architecture/security/structure drift Scott observed.
Next: Scott reviews the diff and pushes to origin.
Commit Model: Review-Only.
