# Attribution

This engine is adapted from the `claude-code-plugin` package of
[aerovato/magic-compact](https://github.com/aerovato/magic-compact)
(author: kevinMEH), vendored at upstream commit `fd92b2d` on 2026-07-07.

Upstream is licensed BSD-3-Clause (LICENSE.md added 2026-07-08 in response to
[issue #6](https://github.com/aerovato/magic-compact/issues/6); Copyright (c)
2026, Kevin Liao @ Aerovato Research). The full upstream license text is
vendored beside this file as `UPSTREAM-LICENSE.md`, satisfying the
notice-retention condition for this source-form redistribution.

## Files

- `transcript.ts`, `prune.ts`, `omission.ts`: verbatim upstream copies.
- `compact.ts`: upstream with three deliberate changes, all in the summarizer
  spawn and the boundary notice:
  - resumes the analysis session by session ID instead of transcript path.
    Path-resume failed under the Claude Desktop Code-tab runtime (CLI
    2.1.197), producing fabricated summaries that pass validation; upstream
    reports path-resume works on the standalone CLI
    ([issue #5](https://github.com/aerovato/magic-compact/issues/5)).
    Resume-by-ID is the documented form and works in both environments;
  - pins the summarizer model (default `claude-sonnet-5`), disables hooks for
    the summarizer spawn, and applies a 240s process timeout;
  - the post-compaction boundary notice points at `retrieve.ts` via Bash
    instead of the upstream MCP `read_omitted_content` tool;
  - the summarizer's tool surface is denied via the spawn's settings
    (summarization needs no tools, and the transcript it reads is untrusted);
  - summary parsing pairs echoed `<user>` blocks with their following
    `<assistant>` blocks positionally instead of counting `<assistant>` blocks,
    and the prompt template marks the trailing next-turn `<user>` as
    not-to-be-summarized (models regularly append one unrequested summary for
    that anchor, which the upstream count-only check rejects);
  - a failed summarizer spawn surfaces its stdout tail when stderr is empty
    (the CLI reports "Not logged in" on stdout, which upstream's
    stderr-only message rendered as an empty reason); both streams are
    control-sequence-stripped and capped at 500 characters before they reach
    the error, because they derive from the untrusted transcript.
- `compact-cli.ts`, `retrieve.ts`, `ledger.ts`: new in this kit
  (agent-invokable CLI entry with threshold check/guard, cache retrieval, and
  compaction telemetry; upstream uses a UserPromptSubmit hook and an MCP
  server instead).

Known accepted limitation in the verbatim `omission.ts`: cache lookup resolves
a 12-character session-ID suffix by directory scan, so retrieval can serve any
local session's cache entries to a caller who knows a suffix. Accepted for a
single-user machine rather than forking the file; an exact-match rewrite is
the fix if this ever ships beyond one user.
- Upstream `hook.ts`, `mcp.ts`, `command.ts`, and `.mcp.json` are not vendored.
