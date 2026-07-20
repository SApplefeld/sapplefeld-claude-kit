# Active Plans

This folder holds active plans only: specs that are open or in progress. A plan is the single source of truth for one effort's intent and state, and a fresh or post-compaction session resumes from it.

## Rules

- A plan lives here while it is being worked. When it reaches `Status: Complete` or is abandoned, it moves to `../archive/` in the same close-out that finished it. The `curating-docs` skill does the move with `git mv` so history is preserved.
- Naming follows the kit convention: `<project>_<content-type>_v<n>.md` (for example `claude-kit_docs-lifecycle_spec_v1.md`). Increment the version rather than overwriting a prior one.
- The `Status` header drives the lifecycle. `session-start.js` scans this folder: `In Progress` plans are surfaced for resume, and `Complete` plans still sitting here are flagged as unarchived.
- When a plan relates to or supersedes another, cross-reference it in a `## Related` section so the library stays navigable.

## Current

None currently active.

Completed plans are in `../archive/` (most recent: `claude-kit_compaction-tripwire_spec_v1.md`).
