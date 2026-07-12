# Concurrency Safeguards: Liveness, Contract Invalidation, Commit Pathspec

- **Status:** Complete
- **Run Mode:** interactive
- **Commit Model:** Review-Only
- **Created:** 2026-07-12
- **Fable Spend:** Fable-led session; sections built inline in the main thread.
- **Origin:** 2026-07-12, from a field incident in another kit session: a controller read a quiet transcript as a stall, dispatched a second implementer into the same worktree, briefed the two agents contradictory contracts after a mid-flight decision change, and then a pathspec-less `git commit` swept the first agent's staged section into a "docs-only" commit that shipped red to origin. The controller's own post-mortem proposed the safeguards; this effort folds the accepted ones in.

## Adjudication of the proposals

- **Accepted: liveness.** The completion notification is the only authoritative signal; a transcript goes silent for the length of any long tool call. Encode: silence is not death; kill explicitly (TaskStop) before any replacement dispatch.
- **Accepted: contract invalidation.** A mid-flight contract change invalidates every agent executing the old contract: stop them first, then dispatch the correction. This is the missing second half of "lock the contract before you fan out."
- **Accepted: the pathspec trap.** `git commit` with no pathspec commits the entire index, not the caller's latest adds; with implementers staging as they finish, that silently ships another agent's half-done work. Encode the pre-read (`git diff --cached --name-only`) and explicit-pathspec discipline.
- **Initially rejected, revised same day: "brief implementers to leave changes unstaged."** The first adjudication rejected it on two grounds: staging as the deliberate Review-Only review surface, and a claim that unstaging would not have prevented the incident. Scott then established the staged-vs-unstaged review surface is not load-bearing for him (he reviews everything before committing), and the second ground was conceded wrong for the commit-sweep failure specifically: with the implementer's files unstaged, the pathspec-less commit would have taken only the deliberately added file. **Decided 2026-07-12: the contract flips.** Implementers leave work uncommitted and unstaged (an empty index by default makes the sweep mechanically impossible); the controller stages what it accepts, and the explicit `git add <paths>` after review is the scope check. This widens the change surface to the four implementer agent definitions and executing-work's diff-reading step.

## Sections of Work

### 1. Doctrine edits (operating-instructions, mirrored to home/claude-kit-doctrine.md) - tier: fable (inline)

- "Lock the contract before you fan out": add the invalidation rule (contract change → stop dependent in-flight agents before dispatching the correction).
- New standalone liveness bullet beside "Route around the harness": completion notification authoritative; silence during long tool calls is normal; observable replacement triggers (a decision change or a failed attempt), then the harness's task-stop tool (TaskStop on Claude Code) before any successor; never race a rival into the same files.
- "Stay in scope; commit only what the task touched": both git semantics (a pathspec-less commit takes the entire index; a pathspec commit takes worktree content, not the staged version), the `git diff --cached --name-only` pre-read, and the commit rules that follow from them.
- `home/claude-kit-doctrine.md` regenerated from the skill body (the repo's lockstep second copy; review caught it missing from the original file list).

### 2. executing-work, implementer agents - tier: fable (inline)

- Step 1: "Subagents neither commit nor stage" (the flipped contract with its date and reason) plus the controller's stage-read-commit discipline; new sub-bullet "A quiet agent is a working agent" (liveness plus kill-then-re-dispatch, at the point where the temptation occurs).
- Step 2: delegated work is read via `git diff` (arrives unstaged).
- All four `agents/implementer-*.md`: "Do not commit or stage," with the empty-index contract stated.

### 3. Close-out - tier: fable (inline)

Adversarial review over the changeset (prose-only; security review skipped: no code surface), Chapter, archive, indexes, staged.

## Related

- `claude-kit_operating-model_spec_v1.md` (archive sibling): the posture these safeguards protect (Opus-led orchestration with fan-out dispatch).

## Chapters

### Chapter 1: All sections, two review rounds (2026-07-12)

Delivered in this changeset. Commit model: Review-Only (staged; the prior efforts' staged set was committed by Scott before this effort, so this changeset stands alone).

- **Shipped:** the three safeguards in both doctrine mirrors and executing-work; the flipped staging contract (implementers leave work uncommitted and unstaged, controller stages what it accepts) across executing-work steps 1-2 and all four implementer agent definitions; `home/claude-kit-doctrine.md` regenerated byte-identical to the skill body under the refresh hook's exact strip semantics, which also healed the prior effort's operating-model bullet missing from that mirror.
- **Round 1 (CHANGES_REQUIRED), resolved:** the untouched lockstep doctrine copy (spec gap and implementation gap, both fixed and the mirror added to Section 1's file list); the pathspec remedy's git-semantics hole (a pathspec commit takes worktree content, not the staged version; all three sites now state both semantics and scope each commit form to its safe condition); TaskStop phrased with a generic fallback; the "genuinely must die" judgment word replaced with observable triggers. Spec-template drift (missing Created line, heading shape) partially fixed (Created added), remainder accepted as cosmetic.
- **Round 2 (APPROVED_WITH_CONCERNS), resolved:** one survivor of the old contract ("reads staged diffs" in the orchestrator-role line, executing-work) fixed to "reads implementer diffs". The round-2 sweep confirmed every remaining "stage" reference is controller-side and correct (finishing-work, brainstorming, the terminal-and-staged plan-doc rule, README), compact-session and hooks carry no staging assumptions, and the home mirror is byte-identical.
- **Decision record:** the unstaged-implementers proposal was first rejected, then adopted the same day on two new facts: Scott's statement that the staged-diff review surface is not load-bearing for him, and the concession that unstaging would have mechanically blocked the incident's commit sweep. The Adjudication section carries the full arc so it is not re-litigated.
- **Deferred with reason:** no mechanical commit-guard hook; the safe/unsafe split for a pathspec-less commit depends on intent (whether the index equals the target), which a hook cannot see. The prose rule plus the empty-index default is the fix; revisit only if a sweep recurs. Security review skipped: prose and agent-definition changes only, no code surface.
- **Kaizen candidate (Scott's nod pending):** `doctrine-refresh.js`'s `stripFrontmatter` cannot strip a CRLF blank line after the frontmatter fence, so the home mirror opens with one blank line and the hook's "drop one blank line" comment is not honored on CRLF files. Cosmetic; both copies converge, so lockstep holds.
