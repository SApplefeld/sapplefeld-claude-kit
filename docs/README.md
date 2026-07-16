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

- `plans/claude-kit_goal-continuity_spec_v1.md` (In Progress): `/kit-goal` arming and goal-leash continuity across relay session swaps. Sections 1-3 and 5 shipped; Section 4 (live-fire) is a supervised step.

Completed plans are in `archive/` (most recent: `claude-kit_relay-auto-refresh_spec_v1.md`, the 2026-07-16 self-healing relay watcher - an armed relay now refreshes its deployed watcher at session start after a kit update and doctor -Fix repairs it on demand, both guarded by the request.txt busy invariant, plus the docs-write-guard widening that lets background-session mains author plan docs; before it, `claude-kit_summarizer-robustness_spec_v1.md`, the 2026-07-15 compaction fix - the summarizer's degenerate first-line anchors made orchestrator-session compactions fail on a count mismatch, resolved with indexed template pairs, an echoed-anchor cross-check, a sparse preserve-verbatim fallback, and a 600s summarizer timeout, live-verified on the 933k-token transcript that failed in the wild, plus the relay window.txt default, the watcher's single-window typing guard, and kit-doctor's dryrun resume round-trip probe).

## Archive

See `archive/` for completed plans and backlog snapshots.
