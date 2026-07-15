---
name: writing-skills
description: "Use when creating a skill for this kit, editing one, or deciding whether a wording change to a behavior-shaping skill will actually change behavior. Triggers: adding a new SKILL.md, reworking a skill's rules, a skill that reads well but agents ignore under pressure, or a kaizen change to the kit's own skills."
---

# Writing Skills

A skill is behavior-shaping prose, not documentation. One that reads well but does not change what an agent does under pressure is decoration. Treat a skill change like a code change: name the failure it fixes, pick the form that fixes that failure, and confirm it works before trusting it.

## When a skill earns its place

- **Create when:** the technique is non-obvious, recurs across efforts, and is general. A single project's convention is not a skill; it goes in that project's CLAUDE.md.
- **Do not create when:** it is a one-off, a restatement of standard practice, or something a hook or regex can enforce mechanically. Automate the mechanical ones; reserve skills for judgment.
- **The kit stays lean.** Every skill is paid for in every session's skill list. A new skill must beat the alternative of one more paragraph in an existing skill. When in doubt, fold it in rather than add a file.

## Anatomy

- One SKILL.md, in the kit's voice: direct, opinionated, anti-dogma, no em dashes. Add a reference file only when the body genuinely outgrows the size of the kit's other skills, and gate it the way csharp-style and sql-style do: the SKILL.md covers routine work and names the territories that need the reference.
- **Frontmatter: always quote the description.** An unquoted value containing a colon-space breaks the YAML silently and drops all skill metadata. `name` and `description` are the two that matter.
- Body: the principle, the rules that carry judgment, the antipatterns. Tables and lists for what gets scanned; prose for the why. A flowchart only for a decision where the agent might genuinely go wrong, never for linear steps.
- **One owner per rule.** Every rule has exactly one owning site; every other mention is a pointer or an operational residue at its point of action, never a restatement. A rule stated twice is two rules a week later: the 2026-07-14 stabilization audit found a dozen drifted copies, one in outright contradiction. When editing a rule, grep for its key phrases across the kit and fix the owner, not the nearest copy.

## The description states the trigger, not the workflow

The description is how a future session decides whether to load the skill. Write it as "Use when..." plus the symptoms that pull it in, and stop. Do not summarize the skill's process there: an agent that reads a process summary acts on the summary and skips the body, so a step the body insists on gets dropped.

A description that summarizes the workflow gets acted on in place of the body: a summary reading "code review between tasks" yields one review where the body specifies two.

## Match the form to the failure

Name the failure first, then pick the form that fixes it. The form that bulletproofs one failure backfires on another:

| The failure | The form that fixes it | The form that backfires |
|---|---|---|
| Knows the rule, skips it under pressure | Prohibition plus a rationalization table plus a red-flags list | Soft "prefer..." guidance |
| Complies, but the output is wrong-shaped (bloated, buried, restated) | A positive recipe: state what the output IS, its parts in order | A prohibition list ("don't restate", "never narrate") |
| Omits a required element from something it already produces | A structural slot: a REQUIRED field in the template it fills | Prose reminders near the template |
| Behavior should depend on a condition | A conditional on an observable predicate ("if the brief exists, reference it") | An unconditional rule plus exemption clauses |

Two rules govern any rule you write, not just the four forms above:

- **No nuance clauses.** "Don't X unless it matters" reopens the negotiation. Express a real exception as its own conditional on something observable.
- **Exemption clauses do not scope.** "This limit excludes code blocks" still suppresses code blocks. If part of the output must be exempt, restructure so the rule cannot reach it.

## Know it works before you trust it

A skill you wrote and never tested is a guess. The honest test is to watch an agent's behavior with and without the wording:

1. **RED:** give a fresh subagent a realistic task that tempts the failure, without the new guidance. Watch it fail; record the rationalization verbatim. If it does not fail, there is nothing to fix, so stop.
2. **GREEN:** add the minimal guidance addressing that specific failure. Re-run. The agent should now comply.
3. **REFACTOR:** if it finds a new loophole, add the counter and re-run until it holds. For discipline rules, combine pressures (time plus sunk cost plus authority); single pressures are weak tests.

Run several reps, since one sample lies, and read every flagged result yourself, since template echoes masquerade as both failures and successes. This is the standard for any change to behavior-shaping content, the kit's own skills included.

**Doctrine-adjacent rules have a contaminated RED.** A test subagent inherits the global CLAUDE.md, doctrine included, so a rule that restates or sharpens doctrine can show no RED failure: the agent already complies, fed by the inherited copy, and that contamination is production-faithful rather than a test defect. Absence of failure there is weak evidence, not proof the rule is dead weight. Judge such a rule on its distinct value instead: point-of-action encoding survives compaction and reaches contexts the doctrine does not (a headless worker mid-loop, a session whose doctrine was summarized away). If you ship a rule whose RED did not reproduce, record that it stands on that rationale, not on a demonstrated failure; a rule with neither a reproduced RED nor that rationale is the guidance-from-imagination antipattern, so leave it out.

## Antipatterns

- A narrative ("the time we fixed X") instead of a reusable technique.
- A description that summarizes the workflow.
- A prohibition aimed at a wrong-shaped-output problem (use a recipe).
- Guidance written from imagination instead of an observed failure.
- A new skill where one paragraph in an existing skill would have done.
