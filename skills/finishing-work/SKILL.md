---
name: finishing-work
description: Completion pass for a finished effort. Use when all sections of a plan in docs/plans/ are implemented, or Scott says wrap up, finish, close out, or hand off. Runs QA verification, security review, documentation curation with drift report, a final adversarial review, and closes the plan per its commit model.
---

# Finishing Work

An effort is not done when the last section compiles. It is done when behavior is verified, security is reviewed, documentation matches reality, and the plan doc is closed. Run these steps in order; steps 2–4 may be dispatched in parallel after step 1 passes.

## Steps

1. **QA verification.** Dispatch the `qa-verifier` agent with the spec path: full build, full test suite, and every acceptance criterion checked with evidence. Any FAIL: fix and re-run before proceeding. Do not rationalize a failing criterion as "close enough".

2. **Security review.** Dispatch the `security-reviewer` agent over the whole changeset (not just the last section). Critical findings block completion. Major findings: fix or present to Scott with the tradeoff.

3. **Final adversarial review.** Dispatch the `adversarial-reviewer` agent over the entire changeset against the spec. Per-section reviews catch local issues; this pass catches cross-section cohesion problems, leftover debris (dead code, stale TODOs, orphaned files), and spec items that fell through the cracks.

4. **Documentation curation.** Dispatch the `docs-curator` agent with the spec path. It updates the project's docs/ from the as-built code and returns a Drift Report. **Present every drift item to Scott for adjudication — never silently reconcile.** Drift is signal: either the docs were wrong, the spec was wrong, or the implementation diverged from his mental model. He decides which.

5. **Close the plan doc.** Set `Status: Complete`, append a final Chapter summarizing the effort, the review outcomes, and the drift adjudications.

6. **Apply the commit model:**
   - **Review-Only:** present a consolidated walkthrough — every changed file, what changed and why, organized by section, with a diff summary. Then stop; Scott reviews before anything is committed.
   - **Commit-and-Push:** final commit and push; report what was pushed.

7. **Bank the learnings.** Anything durable discovered during the effort — build quirks, conventions, gotchas, environmental facts — belongs in auto memory, not the plan doc. Save it now, while it is fresh.
