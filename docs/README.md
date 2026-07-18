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

- `plans/claude-kit_turn-segmentation_spec_v1.md` - compact-engine segment splitter that bounds summarization plan entries, so autonomous (`/kit-goal` chain) transcripts with few mega-turns compact instead of failing the indexed-pair contract at every boundary. Extends the archived summarizer-robustness effort; adds parse-failure response persistence for field diagnosability.

Completed plans are in `archive/` (most recent: `claude-kit_goal-continuity_spec_v1.md`, the `/kit-goal` arming command and a deterministic Stop-hook leash that holds a plan run to completion across compaction and relay session swaps, with session-identity binding, the async-dispatch wait-is-not-a-stop rule, and name-based relay window targeting for remote and ConPTY hosts; before it, `claude-kit_relay-auto-refresh_spec_v1.md`, the 2026-07-16 self-healing relay watcher that refreshes its deployed copy at session start and via doctor -Fix, both guarded by the request.txt busy invariant).

## Archive

See `archive/` for completed plans and backlog snapshots.
