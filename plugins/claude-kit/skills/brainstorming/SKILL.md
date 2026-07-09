---
name: brainstorming
description: "Collaborative design conversation for any new feature, project, or non-trivial change. Use when I want to think through a problem before building. Phrases like 'let's think through', 'help me design', 'spec this out', 'how should we approach', or any substantial new effort without an existing spec."
---

# Brainstorming

Explore the problem space WITH me in conversation, then capture the agreement as a spec that the executing-work skill runs on. This is a conversation, not a gate. The value is the back-and-forth, feeling out all corners of the problem together. Never delegate the conversation itself to a subagent.

## Process

1. **Understand before proposing.** Read the relevant code first (use the built-in Explore subagent for broad reconnaissance so the main context stays lean). Never design against guessed signatures or imagined architecture.

2. **Scope check.** Before drilling into questions, gauge the size of the request. If it spans multiple independent subsystems (its own data, its own lifecycle, useful on its own), it is too big for one spec: name the pieces, how they relate, and the order to build them, then split into sub-project specs. Brainstorm the first through this process; each sub-project gets its own spec and its own execute and finish cycle. Decomposing first beats refining the details of something that should have been three specs.

3. **One question at a time.** Ask the question whose answer most changes the design. Wait for the answer before asking the next. Do not front-load a questionnaire.

4. **Feel out the corners.** Edge cases, failure modes, integration points, performance characteristics, who consumes the output, what happens on re-run (idempotency matters in this codebase), what already exists that solves a similar shape.

5. **Present options with tradeoffs** when a real decision exists. State a recommendation and the reason. Disagree openly with my framing when warranted; I want the arguments, not agreement. Hold the position under pushback and move on a new fact, not on tone. The answer is usually somewhere in the middle.

6. **Offer the design council at a hard fork.** When step 5 surfaces a genuinely hard or material decision with more than one defensible approach (an architecture or schema choice, build-vs-buy, a migration direction, a tradeoff that is expensive or awkward to undo), offer the `design-council` skill before settling it 1:1. Offering is cheap, running is not: the offer is one line and I decline in a word, while the run is token-intensive and slow. So err toward offering, and lower the bar to offer, never the bar to run. Make the offer in the turn you recognize the fork, not a later one you control: "offer it later if the fork is still open" is precisely how it never gets offered. Do not auto-run it: name the cost so I can authorize the spend, and if I decline, stay in the 1:1 conversation. The council returns a converged recommendation or a cleanly-stated unresolved fork; it informs my call, never replaces it or the conversation. I can invoke it directly at any time. This is offered, not default.

7. **Plan sketch before full spec.** Present a short sketch first: goal, approach, the sections of work. Cheap to redirect here; expensive after the full write-up. Iterate on the sketch until agreed.

8. **Write the spec** to `docs/plans/<project>_spec_v1.md` (increment the version if the name exists; never overwrite a prior version). Then invoke the `curating-docs` skill's create path: add the new plan to the `docs/README.md` index, and if it builds on or supersedes an existing plan, cross-reference both directions (a `## Related` section in the new plan, and a supersession note in the older plan's header). A plan no one can find from the index, that does not point at the work it extends, is half-written.

9. **Spec self-review.** Before handing the spec to executing-work, read it once with fresh eyes and fix inline: placeholders (TBD, TODO, "handle appropriately"), sections that contradict each other, requirements that could be read two ways (pick one, make it explicit), and scope that drifted past the goal. A defect caught here is a sentence to fix; the same defect found mid-execution is rework. Fix and move on; no re-review ceremony.

10. **Agree on the commit model** and record it in the spec header:
   - **Review-Only:** changes accumulate staged as sections complete, and `git diff --staged` is my review surface before anything is committed. Common for smaller changesets in big existing projects.
   - **Branch-and-PR:** work happens on a feature branch and finishing-work opens a pull request. The default for shared work or client repos (GitHub or Azure DevOps).
   - **Commit-and-Push:** "land it on main and leave no mess." Commit and push to origin as sections complete; if concurrency forced a worktree branch, finishing-work merges to main and tears it down. For personal or greenfield repos where I have said main is fine.

   Record the **Run Mode** in the same header pass. `chain` (the default) is the unattended posture: executing-work stands up the compact-session skill's chain mode - a thin supervisor plus a headless worker session that runs the section loop and is compacted at section boundaries - so the run outlives its context window with no `/resume` from me. `interactive` is the recorded override for a run I intend to watch and drive from my own session; record it when I say so. The compact-session skill's billing and advisor rules for headless spawns apply to every chain.

11. **Assign a model tier to each Section of Work.** Implementation cost scales with the model; quality is protected by spec precision plus strong-model review, not by using the strongest model for every keystroke. Tier picks the model; briefability picks the locus (dispatch versus main thread). Assign per section:
   - **haiku:** pure transcription: an exact sibling to clone with the section's substitutions, single-responsibility scope, and a self-surfacing gate (the build or an existing test fails loudly if the output is wrong). Renames and sweeps, config or DTO additions mirroring a named sibling, test data, pin-test count updates. The tier is only assignable when the section text can name both the sibling and the gate; a section that leaves either to be found, or contains any judgment call, is `sonnet`.
   - **sonnet:** mechanical or well-bounded: a clear contract, an existing sibling pattern to mimic, single-responsibility scope, low integration risk. New procs/services following an established shape, mappings, DTOs, tests, CRUD surfaces.
   - **opus:** moderate complexity: multi-file coordination, nuanced refactors, performance-sensitive logic, mild ambiguity within a clear design.
   - **fable:** needs the strongest model: novel logic, security-sensitive surfaces, cross-cutting architecture, subtle correctness. Dispatches to `implementer-fable` (which inherits the session model, or takes the explicit `fable` override from a below-fable session) like any other tier.
   - **fable (inline)** (main thread, no dispatch): a fable-tier section that cannot be briefed: the spec itself is likely to evolve in contact with the code, or the section is so small the brief would cost more than the work. Inline is the deliberate exception and the escalation ceiling, never the comfortable default: the main thread is the most expensive place to write code.

   A section only earns a cheap tier if its spec is precise enough that an implementer with no conversation context can build it from the section text alone; the same test one level up separates fable from fable (inline). Write to that standard or assign a higher tier. Tier assignments are planning-time recommendations; executing-work may upgrade a tier after a failed attempt, never downgrade mid-effort.

   A `fable` tier is also spend authorization: Fable bills per call to API credits, so name the expected Fable surface (fable-tier sections; the finishing reviews run at Fable by default) in the spec's `Fable Spend` header line at approval time. A `none (cost hold)` entry keeps the whole effort at the session model, with any tier downgrade flagged in the Chapter rather than applied silently. A Fable **advisor** is the standing default on every below-fable session (set once with `/advisor fable`, it persists in settings and reaches every dispatched implementer and headless worker), so the header does not name it - it is presumed, with each consultation re-reading the transcript at Fable rates. `none (cost hold)` is the explicit override: it keeps the effort at the session model AND turns the advisor off for the run.

## Spec format

```markdown
# <Title>

Status: In Progress
Commit Model: Review-Only | Branch-and-PR | Commit-and-Push
Run Mode: chain | interactive
Fable Spend: <expected Fable surface beyond the default advisor, e.g. "S2, finishing reviews"> | n/a (Fable-led session) | none (cost hold)
Created: YYYY-MM-DD

## Goal
One paragraph. What exists when this is done, and why it matters.

## Approach
The agreed design. Key decisions and the reasoning behind them, so future
sessions (and post-compaction recovery) understand intent, not just steps.

## Sections of Work
### 1. <Section name>
Model: haiku | sonnet | opus | fable | fable (inline)
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

A trivial fix or a small obvious change does not need a spec; just fix it under the global rules. If I ask to brainstorm something that turns out to be trivial, say so and offer to just do it.
