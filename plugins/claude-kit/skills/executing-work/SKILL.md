---
name: executing-work
description: "Autonomous execution of an approved spec or plan from docs/plans/. Use when I say to proceed, implement, build, or continue an agreed plan, or when resuming a session that has an In Progress plan doc."
---

# Executing Work

The contract: once the spec is approved, proceed autonomously to completion. No per-step check-ins, no "should you continue?", no gating individual edits. The spec is the agreement; execute it.

Interrupt me only for: a contradiction inside the spec, a decision the spec does not cover with material consequences, a destructive or irreversible action, or a systematic-debugging dead end (per that skill's stop-and-report rule). Everything else is yours to resolve and record.

## The completion contract

The spec is the goal. Once execution starts, run every remaining unblocked section to completion in this session. A section boundary is not a stopping point. A long-running gate is not a stopping point. Context pressure is not a stopping point. The only reason to stop mid-spec is a true blocker, and when you hit one you make it impossible to miss.

For an externally-driven worker (the Run Mode check's stand-down), the directed section is the whole goal: finishing that one section and stopping is completion under this contract, never an early stop, because the engine verifies the section and spawns the next worker itself.

This is the rule that fails most often under the pressure of a long run, so it is stated as a hard prohibition, not a preference.

**Do not end your turn** to:

- report progress between sections ("§3 done, say the word and start §4"). Close the section and start the next.
- wait on a build, test suite, or Live gate ("holding for the gate, ~2 min"). Wait on it in-turn: background it and poll a readiness signal (`until` on a marker or exit code), then continue when it returns.
- manage context ("pausing here rather than open §7 at the tail of a long run"). The Chapter plus the SessionStart resume hook make a fresh session lossless; starting one is my call, never your reason to halt.
- await a dispatched subagent ("holding while the implementer builds §3.1b"). A background agent (`run_in_background: true`, the Agent-tool default) ends your turn to await its completion notification, and under an armed leash that turn-end is a stop the hook blocks and re-bills your whole context on. A wait is not a stop here either: keep the turn alive. Dispatch a single critical-path implementer synchronously (`run_in_background: false`) so its whole run is one in-turn call; for a genuine parallel fan-out, poll the agents' output files in-turn with an `until` loop exactly as you would a build gate. Never end the turn on a completion notification while a leash is armed, and never clear the leash to escape the block: that abandons the very continuity it exists to hold.

Rationalization table (the excuse, and why it is wrong):

| The excuse | Why it is wrong |
|---|---|
| "This is a clean boundary to pause at." | Clean boundaries are for resuming, not for stopping with work left. Continue. |
| "Holding for the gate." | A wait is not a stop. Poll the gate in-turn and continue. |
| "It is the tail of a long run, safer to stop." | The Chapter plus resume hook protect you. Context is my call, not a stop condition. |
| "Let me confirm before continuing." | The approved spec is the confirmation. Continue unless a true blocker hits. |
| "I'll end the turn to await the dispatched agent's notification." | Awaiting is a wait, and a wait is not a stop. Foreground the dispatch (`run_in_background: false`) or poll it in-turn; do not end the turn, and do not clear the leash to get out of the block. |

Red flags that you are about to stop wrongly: "say the word and continue", "holding for", "paused here", "at the tail of", "ready to continue when you are", "holding while the agent builds", "awaiting the notification". If you are about to write one of these with unblocked work remaining, do not. Keep going.

**Stop only for a true blocker, and make it loud.** The blocker set:

- an external dependency only I can satisfy (a GUI action like a Docker memory bump, a cloud resource that must be provisioned, a credential or secret you cannot reach),
- a contradiction inside the spec, or a material decision the spec does not cover,
- a destructive or irreversible action that needs my yes,
- a systematic-debugging dead end.

When you stop, lead the message with `BLOCKED: <exactly what you need from me>` so I see it in seconds rather than discovering a silent halt hours later. A progress update is not a stop and must not be written as one. The `/goal` Stop hook is a backstop, not the mechanism; this contract is the mechanism.

**The goal template.** A plan run's completion leash is armed in one line with `/kit-goal docs/plans/<plan>.md`. The kit-goal skill owns the canonical condition and enforces it with a deterministic kit Stop hook; the condition is met when (a) every section is complete and closed out, (b) you are BLOCKED on a decision only I can make and have documented what you need from me and how I can provide it, or (c) you have just compacted at a section boundary and written the resume-relay request for this plan, handing off to a successor session.

Clause (c) is what lets step 8's relay path end the turn under the leash: the kit hook approves the boundary stop when the handoff for this plan was just written (a manually typed native `/goal` carrying the same clause is instead approved by its LLM evaluator reading the conversation, so state the compaction result and the request write plainly in the closing message either way). Unlike native `/goal`, whose state is bound to the session transcript and lost when a compaction mints a new session id, the kit hook's state lives in the project (`.kit/`), so a relayed successor inherits the leash with no re-arm step. That continuity is the whole point: the old session-scoped gap, where a successor ran unleashed until re-armed, is now closed.

**Handoff.** When execution begins inside a conversation that was just brainstorming, say so in one line ("Spec approved, switching to autonomous execution of all N sections") so I see the mode change and can scope it down ("just §1") if I want. I should never have to set an external goal to get full execution.

## Before starting (or resuming)

Read the plan doc in full, **including all Chapters**. The Chapters are the state: they record what is done, what surprised us, and the commit model in effect. After a compaction, this re-read is mandatory before touching any file.

**Run Mode check.** An externally-driven worker has no mode to pick: when the driving directive states that an external engine owns continuation by spawning a fresh worker per section (Spine's Dispatch pump is one), or the environment carries `KIT_EXTERNAL_ENGINE` (the marker such an engine sets at spawn), the engine is the supervisor and this session is its worker. Run the in-session loop for the directed section only: never stand up chain mode, never compact this session, never write a relay request; step 8's stand-down line is the only compaction record. For every other session: a `Run Mode: chain` header stands up the compact-session skill's chain mode (the supervisor/worker pair per that skill) before the section loop. A spec with no Run Mode header follows attendance: on an autonomous resume with no one watching, chain; when I am present and driving, interactive. When present-and-driving is not determinable, ask. The **worker runs this skill** - it orchestrates, dispatches implementers, and writes Chapters exactly as an interactive session would; it does not absorb implementation inline just because it is headless. `Run Mode: interactive` is the recorded override that keeps the whole loop in the session I am watching; honor it exactly, and never quietly go headless past it. If the chain prerequisites are unavailable (the compact-session skill's engine or a working headless `claude` spawn), fall back to the in-session loop and note the substitution in the Chapter rather than stalling the run.

**Branch check.** Nothing is committed to main or master without my explicit permission. Commit-and-Push is that permission for its own repos; in a shared repo without it, treat the work as Branch-and-PR and note the substitution in the Chapter. If concurrency put you in a worktree on a feature branch, that is your workspace; integration and any teardown happen in finishing-work. Expect sibling sessions to touch the same repo, so own a disjoint set of files and never stage another session's work.

## Section loop

For each Section of Work, in order:

1. **Confirm the approach, then implement.** Before writing a section whose mechanism the spec assumed without reading the code, do a quick in-session read of the files it touches and confirm the planned approach holds. A spec written during brainstorming can be fictional about code nobody had open yet. This is a lightweight read, not a fan-out; if the real shape differs materially, adjust and note it in the Chapter (raise it to me only if it changes design intent). Then implement per the section's model tier:
   - **A section that writes under `docs/` goes to the main thread regardless of the tier it carries.** The docs-write-guard denies any non-curator subagent a write into `docs/`, so a dispatched implementer is blocked mid-section; doc authoring is also design-entangled (voice, structure, cross-references). An implementer may still draft the prose and return it in its final message for the main thread to place, but the `docs/` write itself is always the main thread's. (This is a routing override, not a tier change: record the section's tier as `inline` in the spec so the override is visible up front.)
   - **Tier `haiku` / `sonnet` / `opus` / `fable`:** dispatch the matching `implementer-haiku` / `implementer-sonnet` / `implementer-opus` / `implementer-fable` agent with a complete brief built from the Dispatch Brief template:

     ```
     Dispatch Brief (all REQUIRED unless marked):
     - Spec path + section name
     - Files in scope
     - Acceptance criteria (verifiable)
     - Tests: the section's Tests: line verbatim when the spec has one (a floor:
       extend with what implementation reveals, never shrink, flag amendments);
       else the test-worthiness call and what a test should lock
     - Sibling pattern to mirror, when one exists: name it AND require mirrored
       failure-mode breadth (catch scope, regex generality)
     - Pin tests + new expected values, when the section changes a counted
       cross-cutting set
     - Standing Brief Amendments: every entry from the plan doc's block, when one exists
     - Every load-bearing technical assertion you make marked confirmed or
       inferred: a confirmed one names its evidence (file:line, the command you
       ran), an inferred one says so and says to verify it before relying on it.
       An unmarked assertion reads as settled fact and gets obeyed instead of
       checked, which is how a wrong premise in a brief becomes a wrong
       implementation that passes its own gate
     - Workaround bar: a workaround needing a paragraph to justify means fix the
       code or escalate
     - Style-skill file paths (agents inherit no skills)
     - Build + test commands
     - [haiku only] The exact sibling to clone and the self-surfacing gate command;
       if either cannot be named, dispatch at sonnet
     - [below-fable session, fable tier] The explicit fable model override; the
       spec's tier assignment is the spend authorization
     ```

     Every dispatch includes every REQUIRED field, and the conditional fields when their condition holds. A spec that predates the `Fable Spend` header changes nothing: the tier assignments still authorize, and you add the header line the first time you touch the spec. The orchestrator stays lean: do not pre-read the files for it, do not re-implement its work, do not read its full diff unless adjudicating.
   - **Tier `fable (inline)` (or no tier recorded):** implement in the main thread. Inline is for sections the plan marked unbriefable (a spec likely to evolve in contact with the code) or too small to be worth a brief; if an untiered section is clearly briefable, dispatch it at the tier it would have earned. Follow the csharp-style and sql-style skills, honoring each style skill's precedence rule. Surgical changes only.
   - **Handle the implementer's status:** NEEDS_CONTEXT, answer from the spec or conversation context and re-dispatch at the same tier; escalate to me only if the question is material and uncovered. BLOCKED, fix the environment and re-dispatch. DONE_WITH_CONCERNS, read the concern, resolve a correctness or scope concern yourself or hand it to the adversarial-reviewer as a question (never as a pre-rated finding, and never to the blind-reviewer, whose input contract excludes intent), and record a bare observation in the Chapter.
   - **Tier escalation:** a `haiku`-tier section gets one round, not two: a review with Critical findings, or a second NEEDS_CONTEXT, re-dispatches at `implementer-sonnet` immediately with the failure evidence in the brief - a Critical from a transcription section means it was mis-banded, and review rounds cost more than the tier delta saved. From `sonnet` up: if a dispatched section fails review twice with Critical findings (a review round is the full set of reviewers dispatched for the section, security included when it ran, and a round fails when any of them returns a Critical that survives adjudication), or returns NEEDS_CONTEXT twice on the same question, escalate, and carry the failure evidence forward: the failed attempt's report and the review findings ride in the escalated brief so the next tier does not rediscover them. In a Fable-led session, take the section over in the main thread. In a session on a lower model: a section tiered below fable gets one re-dispatch to `implementer-fable` with the `fable` model override (the failure earns the spend), and moves to the main thread only if that attempt also fails; a section already tiered fable has exhausted its tier after the second failed review, so raise the stall to me or hand it to a Fable-led session rather than downgrading it into a lower-model main thread. Under a recorded `Fable Spend: none (cost hold)`, stay at the session model and raise the stall to me instead. Never re-dispatch a third time at the same tier, and never downgrade a tier mid-effort. Record the escalation in the Chapter, and if the kit's own under-specification caused it, jot a kaizen note. Repeated escalations mean the section was under-specified, a brainstorming lesson, not an implementer failure.
   - **Subagents neither commit nor stage.** Implementers leave their work as unstaged edits whatever the commit model (an empty index by default means a pathspec-less commit mechanically cannot sweep a half-finished section into an unrelated commit). The controller stages what it accepts - the explicit `git add <paths>` after review is the scope check - and before every commit reads `git diff --cached --name-only` and commits without a pathspec only when that list is exactly the target; the doctrine's Scope and safety rule owns the two git pathspec semantics that make this the safe order. Commits happen only in the main session, after review.
   - **A quiet agent is a working agent.** The transcript goes silent for the full length of any long tool call; the completion notification is the only liveness signal. Under an armed completion leash, do not end your turn to await that notification: the completion contract's wait-is-not-a-stop rule covers dispatch too, so run the critical-path implementer synchronously (`run_in_background: false`) or poll its output in-turn. Never dispatch a second implementer at the same files on a suspicion of stalling - if an agent must be replaced, TaskStop it first. The same stop-first rule applies when a decision changes a brief mid-flight: an in-flight agent faithfully executing the old contract is invalidated by the new one, so kill it and re-dispatch with the corrected brief rather than briefing the change around it.

2. **Verify with evidence.** The build must pass; run it yourself even when an implementer reported DONE, since trust-but-verify is one cheap command. Run targeted tests, and a claim of "done" or "passing" carries the command output that proves it. For delegated work, read the implementer's diff (`git diff` - their work arrives unstaged) and spot-check the reported evidence rather than re-running everything (re-run anything that looks off). Settle the test question: if the behavior is worth locking against regression (a business rule, an edge case, a bug that could recur), leave a durable test and show it passing, watching it fail first where practical. If no test was warranted, say so and why. Use the temporary repro-script discipline from the global rules for debugging, not as the home for new behavior.

3. **Review.** Dispatch two reviewers in parallel: the `adversarial-reviewer` agent with the spec path, the base git ref (or list of changed files), and the name of the section under review; and the `blind-reviewer` agent with the base git ref (or changed-file list) only - never the spec path, the plan, or the section name, and with any docs/ paths omitted from the changed-file list (the plan doc's and the doc indexes' own hunks are the intent story arriving through the diff), because reviewing without the intent story is that lens. If the section touched input handling, authentication or authorization, SQL construction, secrets or configuration, or an external boundary, also dispatch the `security-reviewer` agent alongside them. **Never pre-judge the review:** do not tell a reviewer what to flag, what to ignore, or how to rate a finding ("treat as Minor", "the plan chose this"). Pre-rating defeats the review; let each reviewer surface it and adjudicate per responding-to-review. For a genuinely trivial, self-contained section (a rename, a comment, a one-line change with no logic), the per-section reviews are optional as a pair, since finishing-work still covers it.

4. **Address findings.** Critical: must be fixed before the section closes. Major: fix, or record the justification for not fixing in the Chapter. Minor: note in the Chapter; fix only if trivial and in-scope. Weigh each finding per the responding-to-review skill before acting on it. **The recurrence rule:** when a review surfaces a finding of the same class an earlier section's review already surfaced (same defect pattern, different site), do not just fix the new instance: amend the standing dispatch-brief content - a `Standing Brief Amendments` block in the plan doc that step 1 folds into every later dispatch brief - so every later section's implementer inherits the guard, and record the amendment in the Chapter. Two instances of a finding class means the workflow is generating the bug; fix the generator, not only the output.

5. **Update the plan doc.** Mark the section complete. If the implementation deviated from the spec, update the spec section to match reality and flag the deviation in the Chapter; if the deviation changes design intent, raise it to me rather than silently rewriting the spec.

6. **Append a Chapter** (format below). If a Decision or Surprise traced to the kit itself fighting the work (an ambiguous rule, a contradictory step), also jot it to the kaizen inbox per the global capture rule.

7. **Apply the commit model** recorded in the spec header:
   - **Review-Only:** stage the section's changes (`git add`); never commit. Accumulate a running changed-files summary in the Chapter for the final walkthrough. `git diff --staged` is my review surface.
   - **Branch-and-PR:** commit the section's code together with its Chapter (the plan doc update from step 6) to the feature branch, so the record rides with the change into the eventual merge. The PR happens in finishing-work. Pushing here is not merging: nothing is final until that merge.
   - **Commit-and-Push:** commit the section and push to origin. (If concurrency put you on a worktree branch, the merge to main and teardown happen in finishing-work, not here.)

8. **Compaction point (compact-session skill).** An externally-driven worker (the Run Mode check's stand-down) skips this step's observations and fork: the engine owns continuation, and the Chapter's Compaction line records `check not run: external engine owns continuation (fresh worker per section)`. For every other session, the section close (Chapter written, gate green, plan doc current) is the canonical moment to compact, because the plan doc already holds everything a summary could soften. Every close runs the same two observations first - before any judgment about the session's mode, before the Compaction line is written - and the line quotes their literal outputs, so a close that skipped them is visibly incomplete:
   - **Probe the relay.** The relay is armed when the directory `%LOCALAPPDATA%\claude-kit\resume-relay\` exists (PowerShell: `Test-Path "$env:LOCALAPPDATA\claude-kit\resume-relay"`). The compact-session skill owns what an armed relay does; this probe only answers armed or absent. Never conclude "unrelayed" without running it: the probe is one command, and a wrong "absent" silently forfeits every compaction for the rest of the run, each forfeited boundary re-billing 3-5x the post-compaction floor on every later call.
   - **Run the engine check.** The compact-session skill's `--check` against the session transcript; read its `recommendation`. The decision is the engine's, not a reflex (compacting below its minimum measurably costs more than it saves).

   The observations' outputs are the only admissible inputs to the fork below. "The session is interactive / actively driven" is a conclusion about which fork arm applies, never a reason to skip the observations - and it holds only while I am actually present: a session is actively driven only if a message I typed (not a task notification, not hook feedback, not a subagent report) arrived within the current section. A run that last heard from me hours ago is unattended no matter how it started. Re-run both observations at every close; a Compaction line that inherits the previous Chapter's rationale instead of quoting fresh outputs turns one skipped close into the template for every later boundary, silently forfeiting the rest of the run.

   Then act on the pair:
   - Check says `skip`: continue to the next section; a skipped boundary costs nothing.
   - Check says `compact`, chain mode (per the Run Mode check): compact the worker session and resume the compacted successor for the next section.
   - Check says `compact`, interactive, relay armed, and the active completion leash approves a clause-(c) boundary stop (a `/kit-goal` leash approves it deterministically once the relay handoff for this plan is written; a manually typed native `/goal` carrying the handoff carve-out is approved by its evaluator reading the conversation; and no active leash at all is likewise fine): compact and write the relay request per the compact-session skill's relay mode, state plainly in the closing message that the compaction and the request write satisfy the handoff clause, and end the turn. That IS a valid way to end the turn mid-plan: the workstation performs the resume, the relayed continue prompt starts the next section in the compacted session, and the contract is carried across the boundary by the plan doc, not broken.
   - Check says `compact`, interactive, relay armed, but the active leash will not approve the boundary stop (a native `/goal` typed without the handoff carve-out): continue uncompacted, exactly as if the relay were absent. The relay's clean-turn precondition (compact-session, relay mode) cannot be met under a leash that will not approve the boundary stop; do not write a request. Record `deferred: goal blocks the turn` in the Compaction line.
   - Check says `compact`, interactive, relay absent: continue uncompacted. Compacting the live session needs my typed `/resume`, and halting for it violates the completion contract; offer the compaction line when the turn genuinely ends (a true-blocker stop, effort close, or my request).

Then continue to the next section. Do not stop here.

## The advisor

A `fable` advisor is the standing default on every below-fable session: set once with `/advisor fable`, it persists in settings and gives the session - and every below-fable model it dispatches - a quick Fable check at decision points, with no spec line needed to authorize it. It composes with the tier system rather than replacing it: the advisor shares the session's conversation (and its blind spots), so it is for orchestration judgment - adjudicating a DONE_WITH_CONCERNS, weighing an escalation, a recurring error - never a substitute for the fresh-context reviewers, whose value is exactly that they never saw the session's reasoning. `Fable Spend: none (cost hold)` is the explicit override: run with the advisor off.

Three properties to plan around, on v2.1.205: the advisor is **session-wide and inherited by every dispatched subagent** - there is no per-agent override; a subagent whose pinned model outranks the advisor **silently drops it** (no error); and the setting **persists in settings and reaches headless spawns**, which is what makes the default self-sustaining - chain-mode workers carry it too. Each consultation re-reads the transcript at the advisor's rates, uncached. On a Fable-led session the pairing rule leaves only Fable itself as advisor, so the default buys spend rather than a stronger perspective there; the advisor earns its keep on below-fable sessions.

## Delegating to subagents

Tokens absorbed into the main context are re-billed on every later turn; a subagent's churn (file reads, build output, failed attempts) is paid once, and only its report comes back. The orchestrator stays the designer: it writes dispatch prompts, judges findings, reads implementer diffs, and writes Chapters. Keep a task in the main session only when it is design-entangled (its shape is still being discovered in contact with the code), tiny (the prompt would cost more than the work), or session-state-dependent (an in-flight debugging chain).

**Write the dispatch prompt from the actual current code,** assuming a skilled engineer with zero context for this codebase: exact file paths, the signatures and types they will touch, which style skill to follow, what done looks like, whether the change earns a durable test, what NOT to touch, and how to verify. **Hand bulky inputs over as files,** not pasted inline: the spec, or a diff captured with `git diff > .kit/scratch/<name>.diff` (gitignored, never `docs/`). **A subagent's report comes back in its final message, not as a committed file.** The implementer's status protocol and the reviewers' findings lists are terse by design, so have each return its report inline and distill the durable outcome into the Chapter. A large review can still use the summary-plus-file pattern: return the verdict, the Critical/Major/Minor counts, and the top finding inline, and write the full findings to a file the orchestrator reads only when adjudicating. The tell that you are repeating the old failure is a dispatch line like `write your full findings to docs/reviews/...` or `docs/plans/_impl_reports/...`: a report is a transient working artifact and the Chapter is the curated record, so route those to `.kit/` or take them inline. The same discipline applies to read-only scouts: a recon dispatch states its return contract in the prompt per the doctrine's scout return contract, so the report lands lean by construction. Parallelize only when tasks touch non-overlapping files; lock shared contracts first and assign disjoint files.

## Chapter format

Append to the `## Chapters` section of the plan doc:

```markdown
### Chapter N - YYYY-MM-DD
Completed: <section name>
Implemented By: <main session | implementer-haiku | implementer-sonnet | implementer-opus | implementer-fable, plus any escalation>
Metrics: <review rounds; NEEDS_CONTEXT count; escalations; advisor <model | off>>
Decisions / Surprises: <anything resolved or discovered; "none" is acceptable>
Review Findings: <Critical/Major addressed; Majors justified; Minors noted>
Compaction: <contextTokens number from --check> tokens; relay <armed|absent, the probe's result>; check <compact|skip|not run: reason>; action <compacted|relayed|deferred|none, with reason>
Next: <next section, or "finishing-work">
Commit Model: <Review-Only | Branch-and-PR | Commit-and-Push>
```

Chapters exist so that a compacted or fresh session can recover full working state from the plan doc alone. Write them for that reader. The Metrics line doubles as the data feed for the kit's open experiments (the tier-band and advisor questions in `docs/backlog.md`), so record it even when every count is zero. The Compaction line is step 8's audit trail: it proves the boundary observations ran, so every slot quotes a literal output (the token number from `--check`, the probe's armed/absent, the recommendation), and a `not run` there carries its reason. A line without the number and the check result is a skipped close - narrative fillers like "context heavy" do not satisfy it, and the context-tripwire hook flags such a line mechanically when it is written with the Edit or Write tools. An externally-driven worker's line is the step-8 stand-down record instead, `check not run: external engine owns continuation (fresh worker per section)`, and fills no other slot.

## When all sections are complete

Invoke the finishing-work skill. Do not declare the effort done without it. This holds under Review-Only: finishing-work still flips the plan to Complete, archives it, and stages it with the code. Review-Only defers the commit to me, never the doc's finalization, so the plan is never left open for me to close.
