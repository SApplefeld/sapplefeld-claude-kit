---
name: systematic-debugging
description: "Root-cause debugging discipline. Use whenever investigating a bug, failure, unexpected behavior, failing test, or production incident - BEFORE proposing any fix. Triggers include 'bug', 'broken', 'failing', 'why is this happening', error reports, and especially any situation where a previous fix attempt did not work. Skip only for trivial fixes where the cause is directly visible."
---

# Systematic Debugging

The iron rule: **no fix without a reproduced, understood root cause.** Proposing a fix before establishing the cause is guessing, and a guess that happens to make the symptom disappear is the most expensive outcome - the defect survives, hidden. This is the one workflow where gating is deliberate.

## Phase 1 - Reproduce

Get a reliable reproduction before anything else. Use the temporary repro-script discipline from the global rules: a minimal script or test that demonstrates the failure on demand. If the failure cannot be reproduced, the job is evidence-gathering (logging, narrowing inputs, environment comparison) - not fixing. "I can't reproduce it but this change should help" is not a debugging outcome.

## Phase 2 - Investigate

Build the evidence before forming opinions:

- **Read the actual error.** The whole message, the whole stack, the relevant log lines, not the summary of it. Check the project's server-side error log or audit table for the server-side view; the C# exception and the SQL error are often different facts.
- **Check what changed.** git log/diff around the onset; deployment history. Most bugs are regressions from a recent, findable change.
- **Trace the data flow backward** from the symptom to the first place reality diverges from expectation. Dispatch the Explore subagent for unfamiliar territory rather than guessing at structure.
- **SQL-specific checks** (this stack's recurring root causes):
  - Deployment drift: does the deployed object match source? (shell-then-ALTER means a missed deployment leaves a stale proc silently in place - compare `sys.sql_modules` against the file).
  - Security context: is a trigger or nested call running as the caller instead of the impersonated user? `WITH EXECUTE AS` boundaries are a classic invisible cause.
  - Actual data: query it. The bug is often a data shape nobody believed existed (NULLs, duplicates, empty strings vs NULL).
  - Isolation level: READ UNCOMMITTED procs can return mid-transaction state; confirm the proc's declared level matches its use.

## Phase 3 - Hypothesize and test

One hypothesis at a time, stated explicitly: "X causes Y because Z." Then the smallest possible test that can falsify it - a query, a log line, a one-variable change. Never bundle changes; if two things changed and the symptom moved, you learned nothing. Evidence first, code second.

## Phase 4 - Fix the root cause

Fix the cause, not the symptom. Then: verify the repro now passes, run the surrounding tests to confirm nothing else moved, delete the repro script (unless told to keep it), and bank any durable learning to auto memory (the gotcha, not the incident). If the work was part of a planned effort, record the finding in the plan doc's Chapter.

## The escalation rule

**Two failed fixes mean the mental model is wrong - stop.** Do not attempt fix number three from the same understanding. Instead: list every assumption in play, verify each against evidence, and widen the frame - the bug may be in the design, the spec, the deployment, or the data rather than the code under suspicion. If the root cause implicates a design decision, surface it to me with the evidence rather than quietly patching around it.

## When not to use

A directly visible cause with a trivial fix (typo, missing using, obvious null guard) does not need the ceremony - fix it under the global rules. The tell that you DO need this skill is the second attempt: if fix one didn't work, you are now debugging, whether you admit it or not.
