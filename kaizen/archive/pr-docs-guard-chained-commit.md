# Kaizen brief: pr-docs-guard false positive on chained commit + pr create

Friction: `git commit -F msg && git push && gh pr create` was blocked in a NEO session because the PreToolUse check runs before the command executes, so the docs changes the command itself commits still read as uncommitted. Forces splitting commit and pr-create into separate Bash calls; the block message scolds the agent for the flow it is already doing.

Change: in `plugins/claude-kit/hooks/pr-docs-guard.js`, allow the command when a `git commit` appears earlier in the command string than the PR-create match (compare match indices). `gh pr create && git commit` still blocks; a PR title/body mentioning "git commit" sits after the pr-create match and does not spoof the allow. Accepted residual hole (fail-open posture): a chained commit that excludes docs via pathspec now passes.

Acceptance: stdin-fixture runs against a scratch git repo with dirty docs/: chained `git commit ... && gh pr create` exits 0; bare `gh pr create` exits 2; `gh pr create && git commit` exits 2; clean docs/ always exits 0.

Discipline: follow writing-skills; baseline-test any behavior-shaping wording.
