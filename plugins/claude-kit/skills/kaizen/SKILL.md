---
name: kaizen
description: "Use when running a kaizen pass on the kit: an explicit kaizen request, accepting an end-of-effort or session-start offer to reflect on captured friction, or applying a pending kaizen brief in the kit repo. Jotting a single friction note does not need this skill; the global capture rule covers that."
---

# Kaizen

Kaizen is the kit improving itself. Friction with the kit (a rule that was ambiguous, a step that fought the work, a capability you wished for) is captured cheaply while you work; a kaizen pass turns that captured friction into real improvements, authored well. It runs only when there is something to discuss. It is the kit's own writing-skills loop, pointed at the kit.

## The inbox lives in the kit repo

Notes and briefs live inside the kit's working clone, so git is the sync-and-combine mechanism across my machines. No separate aggregation step.

- `kaizen/notes-<machine>.md` is per-machine, append-only, one line per note: date, machine, repo, and the friction. Per-machine files mean three workstations can all push notes with zero merge conflicts. A `git pull` before a pass merges every machine's notes automatically.
- `kaizen/briefs/` holds one file per brief a reflect pass produces.

**Pending items** means any `kaizen/notes-*.md` has note lines, or `kaizen/briefs/` holds a file. That predicate gates every offer and the SessionStart nudge: nothing pending means no kaizen, by construction.

## Capturing (the cheap half)

Capture is manual, not an always-on posture: when you (or rarely I) notice the kit got in the way, propose a one-line note, and on my nod append it. You do not load this skill to capture; the global rule in CLAUDE.md carries the bar.

Capture happens while you are working in some other project, so the kit clone is elsewhere on disk. Find it via the machine-local signpost `~/.claude/claude-kit.local.json` (written by setup), which records `kitRepoPath`. Append the note to `<kitRepoPath>/kaizen/notes-<machine>.md`, where `<machine>` is the hostname. If the signpost is missing (setup has not run on this machine), fall back to `~/.claude-kaizen/notes-<machine>.md` and say so, so it gets folded in later.

**Worth a note (concrete kit friction):**
- a kit rule or skill instruction was ambiguous, contradicted the actual situation, or let you rationalize around it
- a workflow step fought the work or added cost without value
- you wished for a capability the kit does not have, or hit a gap
- a review or agent behaved in a way that suggests its prompt needs tuning

**Not worth a note:**
- "it went fine", or general praise
- a project-specific gotcha (that goes to auto memory, not here)
- a one-off mistake of your own that is not about the kit

Zero notes in a session is the normal, healthy case. A note you have to talk yourself into is noise; leave it out.

## The pass (the reflect half)

My weekly kit review is the pass. Run it when I ask, when I accept an end-of-effort or session-start offer, or when I sit down to a pending brief.

1. **Gather.** In the kit repo, `git pull` first so notes from every machine are merged, then read all `kaizen/notes-*.md` plus any friction from this session still in context, and ask me for mine. My half of the retro is the other half.
2. **Reflect and triage.** For each item, with me: is it real, and what is the smallest change that fixes it? Sort into:
   - **Apply now:** small and clear. Becomes a brief (or is fixed directly, since the pass already runs in the kit repo).
   - **Promote:** large enough to deserve its own design. Brainstorm it into a `docs/plans/` spec instead of a brief.
   - **Route elsewhere:** not actually about the kit. A project learning goes to auto memory; a project convention to that project's CLAUDE.md. It leaves the inbox either way.
3. **Write briefs and apply.** Write a brief for each apply-now item (format below), make the change per the writing-skills skill (baseline-test any behavior-shaping wording before trusting it), then clear the note lines you handled and archive applied briefs out of `kaizen/briefs/`. The kit repo is Commit-and-Push; a promoted spec follows its own recorded commit model.

## The brief format

A brief is a self-contained directive a fresh kit-repo session can execute without this session's context:

```
# Kaizen brief: <short title>
Friction: <what went wrong, one or two lines, the evidence>
Change: <what to change, which files or skills>
Acceptance: <how you know it is right, verifiable>
Discipline: follow writing-skills; baseline-test any behavior-shaping wording.
```

## Offering a pass

Never offer on an uneventful session. Offer only when the inbox has pending items, and only at a natural moment: finishing-work's close-out, or when I signal I am wrapping up. The offer is one dismissable line ("N kaizen items captured, want to run a pass?"). I can always start one explicitly. The SessionStart nudge (kit repo only) is the same predicate from the other end: it reminds you when you open claude-kit and items are waiting.
