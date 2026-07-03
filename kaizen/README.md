# Kaizen inbox

The kit's self-improvement backlog. Captured friction with the kit becomes notes here; a kaizen pass turns notes into briefs and briefs into real improvements. The `kaizen` skill owns the workflow; this directory is just its storage.

## Structure

- `notes-<machine>.md` is per-machine, append-only, one line per note: date, machine, repo, and the friction. Per-machine files mean every workstation can push notes with no merge conflicts. A `git pull` before a pass merges them all.
- `notes-seed.md` holds the initial backlog from the 2026-06-17 session mining (the findings this port did not already address).
- `briefs/` holds one file per brief a reflect pass produces.
- `archive/` holds applied briefs, moved out of `briefs/` in the same commit that applied them, so the pending predicate stays clean.

Notes and briefs are tracked and pushed by git: that is the sync. The machine-local pointer that tells capture where this clone lives is the signpost at `~/.claude/claude-kit.local.json`, written by setup, and is never committed.

## Pending predicate

There are pending items when any `notes-*.md` has note lines or `briefs/` holds a file. That predicate gates the SessionStart nudge and the finishing-work offer. Empty inbox means kaizen stays silent.
