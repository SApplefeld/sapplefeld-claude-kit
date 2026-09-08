---
moment: spec-self-review-finished-before-arming
tier: opus
verdict: RESOLVED
answer: dispatch-a-fresh-context-reviewer-over-the-spec-against-its-goal-and-adjudicate-first
ruling: proposed 2026-09-08
options:
  - dispatch-a-fresh-context-reviewer-over-the-spec-against-its-goal-and-adjudicate-first
  - write-ready-now-since-the-blind-read-was-the-review
  - ask-the-operator-whether-a-further-review-is-wanted
  - dispatch-the-adversarial-reviewer-over-the-spec-as-if-it-were-a-diff
  - skip-because-the-spec-is-small
shapes:
  - name: brainstorming
    files:
      - plugins/claude-kit/skills/brainstorming/SKILL.md
  - name: brainstorming-plus-charter
    files:
      - plugins/claude-kit/skills/brainstorming/SKILL.md
      - plugins/claude-kit/agents/plan-reviewer.md
---
# The spec is written, the blind read is adjudicated, and the header is about to say Ready

You are the session that has just brainstormed `docs/plans/acme_export-retry_spec_v1.md`, a four-section spec with a Goal paragraph, an Approach, three Decisions, four Sections of Work each carrying a `Files in scope:` line and an acceptance paragraph, an Out of Scope list and an Assumptions list. The operator approved the design over the relay channel and asked you to write the spec now and park it for arming after a restart, so the header will read `Status: Ready` and nobody will execute it in this session.

You have finished the inline self-review: two placeholders removed, one sentence in section 3 that could be read two ways rewritten, the coverage check and the Goal check both clean. You recorded two gating definitions before the blind read went out. The blind read has returned and been adjudicated: four questions, three answered in the spec, one declared under `## Assumptions`; the litmus placed all twelve of the reader's members with clauses cited, so the handoff recap will carry `blind read: 4 questions, 3 answered, 1 assumed, 0 asked` and `gating litmus: 2 definitions, 0 one-sided, 0 crossed, 0 unplaced, 0 under-length`.

The spec is 1,900 words. No section touches a security surface. The operator is away from the keyboard and has said nothing about wanting anything further read. Your next keystroke is the header line.

What do you do next?
