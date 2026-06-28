---
name: executing-work
description: "Autonomous execution of an approved spec or plan from docs/plans/. Use when Scott says to proceed, implement, build, or continue an agreed plan, or when resuming a session that has an In Progress plan doc."
---

# Executing Work

The contract: once the spec is approved, proceed autonomously to completion. No per-step check-ins, no "shall I continue?", no gating individual edits. The spec is the agreement; execute it.

Interrupt Scott only for: a contradiction inside the spec, a decision the spec does not cover with material consequences, a destructive or irreversible action, or a systematic-debugging dead end (per that skill's stop-and-report rule). Everything else is yours to resolve and record.

## The completion contract

The spec is the goal. Once execution starts, run every remaining unblocked section to completion in this session. A section boundary is not a stopping point. A long-running gate is not a stopping point. Context pressure is not a stopping point. The only reason to stop mid-spec is a true blocker, and when you hit one you make it impossible to miss.

This is the rule that fails most often under the pressure of a long run, so it is stated as a hard prohibition, not a preference.

**Do not end your turn** to:

- report progress between sections ("§3 done, say the word and I'll start §4"). Close the section and start the next.
- wait on a build, test suite, or Live gate ("holding for the gate, ~2 min"). Wait on it in-turn: background it and poll a readiness signal (`until` on a marker or exit code), then continue when it returns.
- manage context ("pausing here rather than open §7 at the tail of a long run"). The Chapter plus the SessionStart resume hook make a fresh session lossless; starting one is Scott's call, never your reason to halt.

Rationalization table (the excuse, and why it is wrong):

| The excuse | Why it is wrong |
|---|---|
| "This is a clean boundary to pause at." | Clean boundaries are for resuming, not for stopping with work left. Continue. |
| "Holding for the gate." | A wait is not a stop. Poll the gate in-turn and continue. |
| "It is the tail of a long run, safer to stop." | The Chapter plus resume hook protect you. Context is Scott's call, not a stop condition. |
| "I'll let Scott confirm before continuing." | The approved spec is the confirmation. Continue unless a true blocker hits. |

Red flags that you are about to stop wrongly: "say the word and I'll continue", "holding for", "I paused here", "at the tail of", "ready to continue when you are". If you are about to write one of these with unblocked work remaining, do not. Keep going.

**Stop only for a true blocker, and make it loud.** The blocker set:

- an external dependency only Scott can satisfy (a GUI action like a Docker memory bump, a cloud resource that must be provisioned, a credential or secret you cannot reach),
- a contradiction inside the spec, or a material decision the spec does not cover,
- a destructive or irreversible action that needs his yes,
- a systematic-debugging dead end.

When you stop, lead the message with `BLOCKED: <exactly what you need from me>` so Scott sees it in seconds rather than discovering a silent halt hours later. A progress update is not a stop and must not be written as one. The `/goal` Stop hook is a backstop, not the mechanism; this contract is the mechanism.

**Handoff.** When execution begins inside a conversation that was just brainstorming, say so in one line ("Spec approved, switching to autonomous execution of all N sections") so Scott sees the mode change and can scope it down ("just §1") if he wants. He should never have to set an external goal to get full execution.

## Before starting (or resuming)

Read the plan doc in full, **including all Chapters**. The Chapters are the state: they record what is done, what surprised us, and the commit model in effect. After a compaction, this re-read is mandatory before touching any file.

**Branch check.** Nothing is committed to main or master without Scott's explicit permission. Commit-and-Push is that permission for its own repos; in a shared repo without it, treat the work as Branch-and-PR and note the substitution in the Chapter. If concurrency put you in a worktree on a feature branch, that is your workspace; integration and any teardown happen in finishing-work. Expect sibling sessions to touch the same repo, so own a disjoint set of files and never stage another session's work.

## Section loop

For each Section of Work, in order:

1. **Confirm the approach, then implement.** Before writing a section whose mechanism the spec assumed without reading the code, do a quick in-session read of the files it touches and confirm the planned approach holds. A spec written during brainstorming can be fictional about code nobody had open yet. This is a lightweight read, not a fan-out; if the real shape differs materially, adjust and note it in the Chapter (raise it to Scott only if it changes design intent). Then implement per the section's model tier:
   - **Tier `fable` (or no tier recorded):** implement in the main thread on whatever model is selected. Follow the csharp-style and sql-style skills and their precedence rule (a repo's mechanically-enforced contract wins first, then the skill). Surgical changes only.
   - **Tier `sonnet` / `opus`:** dispatch the matching `implementer-sonnet` / `implementer-opus` agent with a complete brief: spec path and section name, files in scope, acceptance criteria, whether the change earns a durable test and what it should lock down, the file paths of the style skills (the agent does not inherit skills, so paths are mandatory), and the build/test commands. The orchestrator stays lean: do not pre-read the files for it, do not re-implement its work, do not read its full diff unless adjudicating.
   - **Handle the implementer's status:** NEEDS_CONTEXT, answer from the spec or conversation context and re-dispatch at the same tier; escalate to Scott only if the question is material and uncovered. BLOCKED, fix the environment and re-dispatch. DONE_WITH_CONCERNS, read the concern, resolve a correctness or scope concern yourself or hand it to the reviewer as a question (never as a pre-rated finding), and record a bare observation in the Chapter.
   - **Tier escalation:** if a dispatched section fails review twice with Critical findings, or returns NEEDS_CONTEXT twice on the same question, take the section over in the main thread. Never re-dispatch a third time at the same tier, and never downgrade a tier mid-effort. Record the escalation in the Chapter, and if the kit's own under-specification caused it, jot a kaizen note. Repeated escalations mean the section was under-specified, a brainstorming lesson, not an implementer failure.
   - **Subagents stage, never commit.** Implementers leave their work as staged changes whatever the commit model. Commits happen only in the main session, after review.

2. **Verify with evidence.** The build must pass; run it yourself even when an implementer reported DONE, since trust-but-verify is one cheap command. Run targeted tests, and a claim of "done" or "passing" carries the command output that proves it. For delegated work, read the staged diff and spot-check the reported evidence rather than re-running everything (re-run anything that looks off). Settle the test question: if the behavior is worth locking against regression (a business rule, an edge case, a bug that could recur), leave a durable test and show it passing, watching it fail first where practical. If no test was warranted, say so and why. Use the temporary repro-script discipline from the global rules for debugging, not as the home for new behavior.

3. **Review.** Dispatch the `adversarial-reviewer` agent with the spec path, the base git ref (or list of changed files), and the name of the section under review. If the section touched input handling, authentication or authorization, SQL construction, secrets or configuration, or an external boundary, also dispatch the `security-reviewer` agent. Dispatch both in parallel when both apply. **Never pre-judge the review:** do not tell a reviewer what to flag, what to ignore, or how to rate a finding ("treat as Minor", "the plan chose this"). Pre-rating defeats the review; let the reviewer surface it and adjudicate per responding-to-review. For a genuinely trivial, self-contained section (a rename, a comment, a one-line change with no logic), the per-section review is optional, since finishing-work still covers it.

4. **Address findings.** Critical: must be fixed before the section closes. Major: fix, or record the justification for not fixing in the Chapter. Minor: note in the Chapter; fix only if trivial and in-scope. Weigh each finding per the responding-to-review skill before acting on it.

5. **Update the plan doc.** Mark the section complete. If the implementation deviated from the spec, update the spec section to match reality and flag the deviation in the Chapter; if the deviation changes design intent, raise it to Scott rather than silently rewriting the spec.

6. **Append a Chapter** (format below). If a Decision or Surprise traced to the kit itself fighting the work (an ambiguous rule, a contradictory step), also jot it to the kaizen inbox per the global capture rule.

7. **Apply the commit model** recorded in the spec header:
   - **Review-Only:** stage the section's changes (`git add`); never commit. Accumulate a running changed-files summary in the Chapter for the final walkthrough. `git diff --staged` is Scott's review surface.
   - **Branch-and-PR:** commit the section's code together with its Chapter (the plan doc update from step 6) to the feature branch, so the record rides with the change into the eventual merge. The PR happens in finishing-work. Pushing here is not merging: nothing is final until that merge.
   - **Commit-and-Push:** commit the section and push to origin. (If concurrency put you on a worktree branch, the merge to main and teardown happen in finishing-work, not here.)

Then continue to the next section. Do not stop here.

## Delegating to subagents

Tokens absorbed into the main context are re-billed on every later turn; a subagent's churn (file reads, build output, failed attempts) is paid once, and only its report comes back. The orchestrator stays the designer: it writes dispatch prompts, judges findings, reads staged diffs, and writes Chapters. Keep a task in the main session only when it is design-entangled (its shape is still being discovered in contact with the code), tiny (the prompt would cost more than the work), or session-state-dependent (an in-flight debugging chain).

**Write the dispatch prompt from the actual current code,** assuming a skilled engineer with zero context for this codebase: exact file paths, the signatures and types they will touch, which style skill to follow, what done looks like, whether the change earns a durable test, what NOT to touch, and how to verify. **Hand bulky inputs over as files,** not pasted inline: the spec, or a diff captured with `git diff > .kit/scratch/<name>.diff`. Any scratch file you stage for a subagent goes under `.kit/` (gitignored), never `docs/`. **A subagent's report comes back in its final message, not as a committed file.** The implementer's status protocol and the reviewers' findings lists are terse by design, so have each return its report inline and distill the durable outcome into the Chapter. A large review can still use the summary-plus-file pattern: return the verdict, the Critical/Major/Minor counts, and the top finding inline, and write the full findings to a file the orchestrator reads only when adjudicating. That file goes to `.kit/`, never `docs/`. The tell that you are repeating the old failure is a dispatch line like `write your full findings to docs/reviews/...` or `docs/plans/_impl_reports/...`: a report is a transient working artifact and the Chapter is the curated record, so route those to `.kit/` or take them inline. Parallelize only when tasks touch non-overlapping files; lock shared contracts first and assign disjoint files.

## Chapter format

Append to the `## Chapters` section of the plan doc:

```markdown
### Chapter N - YYYY-MM-DD
Completed: <section name>
Implemented By: <main session | implementer-sonnet | implementer-opus, plus any escalation>
Decisions / Surprises: <anything resolved or discovered; "none" is acceptable>
Review Findings: <Critical/Major addressed; Majors justified; Minors noted>
Next: <next section, or "finishing-work">
Commit Model: <Review-Only | Branch-and-PR | Commit-and-Push>
```

Chapters exist so that a compacted or fresh session can recover full working state from the plan doc alone. Write them for that reader.

## When all sections are complete

Invoke the finishing-work skill. Do not declare the effort done without it. This holds under Review-Only: finishing-work still flips the plan to Complete, archives it, and stages it with the code. Review-Only defers the commit to Scott, never the doc's finalization, so the plan is never left open for him to close.
