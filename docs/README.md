# Claude-Kit Docs

This directory is the working library and project history for the kit itself: the documents *about* the solution, the active plans, and the archived record of finished work. It is repo-level material, a sibling of `README.md`, `home/`, `kaizen/`, and `settings/`. It is not part of the installable plugin payload (`plugins/claude-kit/`), so nothing here loads or shows up when someone installs the plugin.

## Folder map

The library has three zones, and each zone has one job.

- **Root (`docs/`)** holds the stable documents about the solution and this index. Architecture, design rationale, and any security model live here. These describe what the kit *is*, not a single effort.
- **`plans/`** holds active plans only: specs that are open or in progress. A plan lives here while it is being worked. The moment it reaches `Status: Complete` or is abandoned, it moves to `archive/`. See `plans/README.md`.
- **`archive/`** holds finished and abandoned plans (their Chapters intact) and dated backlog snapshots. It is immutable history. Nothing here is live. See `archive/README.md`.

## Living documents

- **`backlog.md`** is the single living handoff and next-steps doc. It carries only active items. Completed items are pruned out to a dated snapshot in `archive/` so the doc never grows without bound.

## How the library is maintained

The `curating-docs` skill owns the mechanics: it archives a plan when it completes, prunes the backlog, cross-references related plans, and refreshes this index. `finishing-work` calls it at close-out, `brainstorming` calls it when a new plan is written, and it can be invoked directly to tidy or retrofit an existing tree.

## Active plans

- `plans/claude-kit_docs-lifecycle_spec_v1.md` - the docs library lifecycle effort that created this structure. In Progress, pending review.
- `plans/claude-kit_docs-write-guard_spec_v1.md` - deterministic PreToolUse guard plus Stop-scan backstop that enforces the docs/-is-curated invariant. In Progress, pending review.
- `plans/claude-kit_pr-docs-gate_spec_v1.md` - commits the docs work into the branch before the PR (Branch-and-PR / Commit-and-Push), with a benign-drift fast-path and a PreToolUse guard on PR creation. In Progress, pending review.
- `plans/claude-kit_branch-hygiene_spec_v1.md` - a reaper skill plus SessionStart nudge that sweep merged local branches and worktrees, decoupled from the session that made them. In Progress, pending review.

## Archive

See `archive/` for completed plans and backlog snapshots.
