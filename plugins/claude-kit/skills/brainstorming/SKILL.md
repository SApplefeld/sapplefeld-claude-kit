---
name: brainstorming
description: Collaborative design conversation for any new feature, project, or non-trivial change. Use when Scott wants to think through a problem before building — phrases like "let's think through", "help me design", "spec this out", "how should we approach", or any substantial new effort without an existing spec. Produces a spec file in docs/plans/ with an agreed commit model. Skip for trivial fixes and small obvious changes.
---

# Brainstorming

Explore the problem space WITH Scott in conversation, then capture the agreement as a spec that the executing-work skill runs on. This is a conversation, not a gate — the value is the back-and-forth, feeling out all corners of the problem together. Never delegate the conversation itself to a subagent.

## Process

1. **Understand before proposing.** Read the relevant code first (use the built-in Explore subagent for broad reconnaissance so the main context stays lean). Never design against guessed signatures or imagined architecture.

2. **One question at a time.** Ask the question whose answer most changes the design. Wait for the answer before asking the next. Do not front-load a questionnaire.

3. **Feel out the corners.** Edge cases, failure modes, integration points, performance characteristics, who consumes the output, what happens on re-run (idempotency matters in this codebase), what already exists that solves a similar shape.

4. **Present options with tradeoffs** when a real decision exists. State a recommendation and the reason. Disagree openly with Scott's framing when warranted — he wants the arguments, not agreement. The answer is usually somewhere in the middle.

5. **Plan sketch before full spec.** Present a short sketch first: goal, approach, the sections of work. Cheap to redirect here; expensive after the full write-up. Iterate on the sketch until agreed.

6. **Write the spec** to `docs/plans/<project>_spec_v1.md` (increment the version if the name exists; never overwrite a prior version).

7. **Agree on the commit model** and record it in the spec header:
   - **Review-Only** — Scott reviews all changed code before anything is committed. Common for smaller changesets in big existing projects.
   - **Commit-and-Push** — commit and push to origin as sections complete. Common for greenfield projects where Claude authors most of the work.

8. **Assign a model tier to each Section of Work.** Implementation cost scales with the model; quality is protected by spec precision plus strong-model review, not by using the strongest model for every keystroke. Assign per section:
   - **sonnet** — mechanical or well-bounded: a clear contract, an existing sibling pattern to mimic, single-responsibility scope, low integration risk. New procs/services following an established shape, mappings, DTOs, tests, CRUD surfaces.
   - **opus** — moderate complexity: multi-file coordination, nuanced refactors, performance-sensitive logic, mild ambiguity within a clear design.
   - **fable** (main thread, no dispatch) — novel design, security-sensitive surfaces, cross-cutting architecture, or any section where the spec itself may evolve during implementation.

   A section only earns a cheap tier if its spec is precise enough that an implementer with no conversation context can build it from the section text alone — write to that standard or assign a higher tier. Tier assignments are planning-time recommendations; executing-work may upgrade a tier after a failed attempt, never downgrade mid-effort.

## Spec format

```markdown
# <Title>

Status: In Progress
Commit Model: Review-Only | Commit-and-Push
Created: YYYY-MM-DD

## Goal
One paragraph. What exists when this is done, and why it matters.

## Approach
The agreed design. Key decisions and the reasoning behind them, so future
sessions (and post-compaction recovery) understand intent, not just steps.

## Sections of Work
### 1. <Section name>
Model: sonnet | opus | fable
What gets built. Acceptance criteria as verifiable statements. Files in scope.
### 2. ...

## Out of Scope
Explicitly excluded items, so drift is detectable.

## Open Questions
Unresolved items and who owns the answer.

## Chapters
(Appended by executing-work as sections complete. Leave empty at creation.)
```

## When not to use

A trivial fix or a small obvious change does not need a spec — just fix it under the global rules. If Scott asks to brainstorm something that turns out to be trivial, say so and offer to just do it.
