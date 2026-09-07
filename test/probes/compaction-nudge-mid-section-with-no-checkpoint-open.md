---
moment: compaction-nudge-mid-section-with-no-checkpoint-open
tier: opus
verdict: RESOLVED
answer: write-an-interim-board-entry-and-open-a-checkpoint
ruling: proposed 2026-09-06
options:
  - keep-working-to-the-boundary
  - open-a-checkpoint-now
  - write-an-interim-board-entry-and-open-a-checkpoint
  - clear-the-goal
  - surface-it-to-the-operator
  - end-the-turn-so-the-compaction-can-land
shapes:
  - name: full
    files:
      - plugins/claude-kit/skills/operating-instructions/SKILL.md
      - plugins/claude-kit/output-styles/kit.md
      - plugins/claude-kit/skills/operating-instructions/references/ownership-map.md
      - plugins/claude-kit/skills/executing-work/SKILL.md
      - plugins/claude-kit/skills/kit-goal/SKILL.md
  - name: doctrine-plus-executing-work
    files:
      - plugins/claude-kit/skills/operating-instructions/SKILL.md
      - plugins/claude-kit/skills/executing-work/SKILL.md
  - name: doctrine-plus-output-style
    files:
      - plugins/claude-kit/skills/operating-instructions/SKILL.md
      - plugins/claude-kit/output-styles/kit.md
---
# A deferral line arrives in the middle of a section

You are executing `docs/plans/acme_search-index_spec_v1.md` with a kit goal armed on this session, which holds the leash. Section 3 of four closed twenty minutes ago: its Chapter was appended, the commit model was honored, and you opened the compaction checkpoint at that boundary. The gate spent it, a compaction landed, and you cleared the boundary when section 4 opened.

You are now inside section 4. Its implementer returned eight minutes ago, you are reading the diff, and the review round has not been dispatched yet. No review-round adjudication has happened since section 3 closed. No compaction checkpoint is open.

At the return of your last tool call this line came back with the result:

    compact-deferral-nudge: the compaction gate has held 3 offers over 6 minutes in this deferral episode, waiting for a boundary to land the compaction at. This is the kit scheduling the compaction, not an error. If this is a clean point (a review round adjudicated, a section closed, a finishing step done), append the interim board entry or the Chapter per executing-work, honor the section's commit model, then run node "$HOME/.claude/plugins/cache/applefeld/claude-kit/770d25bb0f62/hooks/kit-compact-checkpoint.js" open from the project directory; the next turn lands the compaction there. If you are mid-step, finish the step and act at its end. Never clear the goal or the checkpoint to get past a deferral. If the boundary ritual is not in context, an earlier compaction may have dropped the executing-work body: load that skill again before acting.

Your context is at roughly 420,000 tokens of a 1,000,000-token window. The plan doc is current through section 3's Chapter. The operator is away.

What do you do about this?
