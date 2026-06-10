---
name: executing-work
description: Autonomous execution of an approved spec or plan from docs/plans/. Use when Scott says to proceed, implement, build, or continue an agreed plan — or when resuming a session that has an In Progress plan doc. Works section by section with adversarial subagent review and Chapter checkpoints, without per-step permission seeking.
---

# Executing Work

The contract: once the spec is approved, proceed autonomously to completion. No per-step check-ins, no "shall I continue?", no gating individual edits. The spec is the agreement; execute it.

Interrupt Scott only for: a contradiction inside the spec, a decision the spec does not cover with material consequences, or destructive/irreversible actions. Everything else is yours to resolve and record.

## Before starting (or resuming)

Read the plan doc in full, **including all Chapters**. The Chapters are the state — they record what is done, what surprised us, and the commit model in effect. After a compaction, this re-read is mandatory before touching any file.

## Section loop

For each Section of Work, in order:

1. **Implement** per the spec. Follow the csharp-style and sql-style skills for all code. Surgical changes only — touch what the section requires.

2. **Verify.** Build must pass. Run targeted tests; if none cover the change, use the temporary repro-script discipline from the global rules.

3. **Review.** Dispatch the `adversarial-reviewer` agent with the spec path and the base git ref (or list of changed files). If the section touched input handling, authentication/authorization, SQL construction, secrets/configuration, or an external boundary, also dispatch the `security-reviewer` agent. Dispatch both in parallel when both apply.

4. **Address findings.** Critical: must be fixed before the section closes. Major: fix, or record the justification for not fixing in the Chapter. Minor: note in the Chapter; fix only if trivial and in-scope.

5. **Update the plan doc.** Mark the section complete. If the implementation deviated from the spec, update the spec section to match reality and flag the deviation in the Chapter — if the deviation changes design intent, raise it to Scott rather than silently rewriting the spec.

6. **Append a Chapter** (format below).

7. **Apply the commit model** recorded in the spec header:
   - **Commit-and-Push:** commit the section with a descriptive message and push to origin.
   - **Review-Only:** leave changes uncommitted; accumulate a running changed-files summary in the Chapter for the final walkthrough.

## Chapter format

Append to the `## Chapters` section of the plan doc:

```markdown
### Chapter N — YYYY-MM-DD
Completed: <section name>
Decisions / Surprises: <anything resolved or discovered; "none" is acceptable>
Review Findings: <Critical/Major addressed; Majors justified; Minors noted>
Next: <next section, or "finishing-work">
Commit Model: <Review-Only | Commit-and-Push>
```

Chapters exist so that a compacted or fresh session can recover full working state from the plan doc alone. Write them for that reader.

## When all sections are complete

Invoke the finishing-work skill. Do not declare the effort done without it.
