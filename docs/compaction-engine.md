# Compaction Engine

The engine writes a new session whose transcript keeps my messages verbatim, replaces bounded slices of assistant work with summaries, preserves the tool-call skeleton, and moves bulky tool I/O to a local cache. It never modifies the source transcript, so a failed compaction costs the run nothing but the summarizer call. `compact-session/SKILL.md` is the operator's surface; this document is the mechanism behind it, for someone changing the engine rather than invoking it.

The code lives in `plugins/claude-kit/skills/compact-session/engine/`. Four files are the kit's own: `compact-cli.ts` (argument parsing, thresholds, exit codes, ledger), `compact.ts` (planning, the summarizer call, the prompt, the parser, emission), `transcript.ts` (reading, chaining, turn building, segmentation), and `ledger.ts` (usage reads and the append-only ledger). `prune.ts`, `omission.ts`, and `retrieve.ts` are vendored verbatim from upstream and stay untouched; see `ATTRIBUTION.md`.

## Data flow

One compaction run is a straight line. `compact-cli.ts` validates that cwd resolves to the transcript's project directory, reads the last main-chain usage row to apply the skip guard, then hands off to `compactTranscript`. That reads the source's active chain (`readActiveTranscriptRows`), builds a plan, spawns the summarizer against a throwaway copy of the source, parses the response into a sparse index-to-summary map, emits the destination rows, and writes them to a fresh session file. The CLI then relabels the source `[UNCOMPACTED]`, appends a ledger line, and prints the destination session id with its `/resume` command.

Every step before the write is non-destructive. The destination file and the omission cache are unlinked on any failure, and the only touch to the source is the best-effort `[UNCOMPACTED]` title append after success.

## The plan: three groups

`createPlan` splits the active chain into `prefixTurns`, `summarizedTurns`, and `preservedTurns`. Turns come from `buildAssistantTurns`, which opens a turn only at a human user row (`type === "user"`, not a tool result, not `isMeta`). `compactionStartIndex` is the index after the last turn containing a prior compaction's summary row, so previously compacted material is prefix and is never re-summarized.

Only `summarizedTurns` is subdivided. Prefix and preserved entries are copied whole, because neither is summarized and nothing needs to bound their span. The ordering is load-bearing: both the keep count and `compactionStartIndex` slice turns by count, so segmenting before the slice would silently redefine `--keep N` as "keep N segments" and move the boundary between summarized and preserved.

## Keep semantics and the segment fallback

`--keep N` counts real human-bounded turns, and defaults to 1. One transcript shape cannot express that at all: an autonomous run opens with a single human prompt and stays one turn for its entire length, so keeping one whole turn leaves nothing to summarize and the session can never compact. When the compactable turns number `N` or fewer, the keep count therefore falls back to segments, preserving the last `N` segments of the segmented compactable stretch and summarizing the rest.

The fallback condition (`compactable.length <= keepTurns`) holds exactly where counting turns already yields an empty summarized group, so no transcript that compacts by whole turns compacts differently. Two consequences a reader should expect. A compactable stretch that segments into fewer entries than `N` is preserved entirely and nothing is summarized, so a small session is not compacted pointlessly. And on the fallback path the preserved tail is the greedy remainder of the packing rather than a floored window, so at `--keep 1` an autonomous session carries at most one segment's worth of unmodified recent context past the boundary, and possibly less.

`--keep 0` cannot reach the fallback except on an empty compactable list, where both paths return the same empty groups. It summarizes everything.

## Segmentation

`splitOversizedTurns` (in `transcript.ts`) maps turns to bounded segment pseudo-turns. A turn whose estimated tokens are at or under `SEGMENT_TOKEN_BUDGET` (20,000) is returned as the same object, untouched. An oversized turn is packed greedily out of atomic step chunks, and concatenating the segments' rows in order reproduces the original turn's rows exactly.

The budget is a packing target, not a hard ceiling: a single chunk larger than the budget forms its own segment rather than being split internally. `estimateRowTokens` is a chars/4 heuristic over the row's model-visible content, which means a message's content blocks or, for attachment rows that carry no `message` at all, the attachment payload. Envelope fields are excluded so many-small-row turns are not inflated against few-large-row ones.

`buildStepChunks` opens a chunk at an assistant row starting a new assistant message, identified by a changed `message.id` (a missing id on either side counts as a change), or, when both ids are missing, by tool results having arrived since the previous assistant row. `findBlockedBoundaries` then refuses cuts: each `tool_result` pairs with the nearest preceding unanswered `tool_use` of the same id to form an index span, and every boundary inside a span is blocked, so a pair stays in one segment however many assistant messages separate it and whatever order the rows arrive in. A `tool_use` no span answers blocks exactly one boundary, the one immediately behind it, because a cut there would put the next segment's summary row directly after an unanswered `tool_use`, which resumes as an invalid message sequence.

## Continuation anchors

A continuation segment has no user rows, and the summarizer's response is verified by echoed anchor text, so each carries a synthetic anchor: `(continuation N) ` plus a snippet. The snippet is the segment's first nonempty assistant text, else the distinct tool names it invokes in first-seen order (`(tool activity: Bash, Read)`), else the segment's first row uuid. It is never empty, because a bare `(continuation N)` is a prefix of every other continuation anchor and would pass the parser's 40-character cross-check unconditionally.

`N` runs across the whole input list rather than per turn. The parser receives one flat anchor array spanning all of `summarizedTurns`, so per-turn numbering would let two turns' continuations verify against each other and defeat the renumber-and-drop guard. Anchors are derived before normalization is applied, capped at 400 characters, then run through `normalizeAnchorText` (whitespace collapse, angle-bracket strip, 300-character truncation), the same transform user-row anchors take. Template and cross-check therefore see the same value by construction.

The uuid fallback is reachable in practice: an assistant message carrying only a thinking block can land as a whole segment. On that branch the anchor satisfies the echo cross-check while naming nothing the summarizer can resolve, since a uuid appears nowhere in its view of the conversation.

## The summarizer call

`generateSummaries` copies the source transcript to a throwaway session, spawns `claude -p --resume <copy id>` pinned to `claude-sonnet-5` by default, and unlinks the copy in a `finally`. The spawn disables all hooks (a Stop hook can extend the turn past the XML output), denies every tool outright (the resumed transcript is untrusted content and summarization needs no tools), scrubs `ANTHROPIC_API_KEY` from the environment so the call bills to the subscription, and times out at 600 seconds. A machine whose only auth is an API key cannot summarize.

The prompt is passed as an argv element, which is why segment count has a ceiling: each segment costs one indexed pair of roughly 460 characters, and Windows `CreateProcessW` caps a command line at 32,767 characters. A rendered prompt measures 21,668 characters at 45 segments, 66% of that ceiling. Lowering `SEGMENT_TOKEN_BUDGET` raises segment count proportionally, so tuning below about 15k needs the prompt moved to the spawn's stdin first. Both known constraints push the budget upward, not downward.

The template renders one `<user index="N">` / `<assistant index="N">` pair per summarized entry plus a trailing unindexed `<user>` anchor from `preservedTurns[0]` marking where summarization stops. One prompt rule covers segment pairs: each indexed pair covers only the slice its own snippet anchors, and a snippet beginning `(continuation N)` is a segment marker to be echoed like any other snippet. The rule is written for every indexed pair rather than for continuation pairs alone, because the first segment of a split stretch anchors on a real human prompt and is indistinguishable from an unsplit turn's.

## Parsing and skips

`parseSummaries` is unchanged by segmentation and maps the response to a sparse index-to-summary map. Its contract: an index attribute alone cannot prove alignment, so each echoed `<user index="K">` snippet is cross-checked against the template's anchor for entry K. A complete set is positionally sound, so a mismatching echo there degrades that one entry to verbatim; a sparse set is accepted only when every present pair verifies, because a sparse set with a bad echo is indistinguishable from renumber-and-drop. A duplicate index, an index past the requested count, more than half the entries missing or degraded, or a sparse set with no verifiable anchors throws. One extra pair at exactly the requested count is ignored, since models routinely number the trailing anchor.

A skipped entry is preserved verbatim rather than failing the run, and the CLI warns on stderr naming the 1-based indices. The lost compression is permanent for those entries: a verbatim entry landing before this compaction's summary rows becomes prefix and is never re-summarized.

## Emission and the single-chain guarantee

`buildCompactedRows` writes a boundary row, then the prefix turns whole, then one summary row per summarized entry followed by that entry's tool-block rows, then the preserved turns whole. The entry's first assistant row is emitted twice by design, once as the summary row and again for its tool blocks, which is how a step-opening `tool_use` survives summarization; that is routine for continuation segments, which open on a step boundary by construction. Tool rows pass through `pruneTranscriptRow`, which moves bulky payloads into the omission cache at `~/.claude/magic-compact/<destination id>.json` behind a Content ID.

The emitted transcript is a linearization: every copied row chains to the row emitted before it, whatever branch topology the source carried. Parallel tool calls give sibling rows a shared parent, and reproducing that fork in the destination is unrecoverable, because `copyRow` stamps every emitted row with one identical timestamp and the reader's leaf selection breaks ties by strict timestamp comparison. It cannot choose between forked branches, so it drops the losing branch and everything downstream of it while the file still looks well-formed. Linearization costs nothing: `recoverParallelToolRows` degenerates to a no-op on a linear chain, rows sharing a `message.id` stay contiguous, and a later compaction rereads the linear chain normally.

`assertSingleParentChain` runs before the destination is written and throws on a null-parent violation, a duplicated uuid, or any row whose parent is not its predecessor. It is a regression tripwire rather than a guard against a reachable state: emission satisfies both properties by construction, so a future change that breaks either fails the compaction loudly and leaves the source untouched instead of shipping a destination that drops rows at resume time. It checks structure only; a structurally valid chain carrying the wrong rows still passes.

## Failure paths

Exit codes are the contract an agent acts on. Exit 0 with a JSON payload means success. Exit 2 means a policy skip, either the context minimum or nothing to compact, and the caller should continue uncompacted. Exit 1 is a real failure, with the reason on stderr behind `Compaction failed; source untouched:`. Untrusted spawn output reaching an error message is stripped of control sequences and capped at its last 500 characters.

A `parseSummaries` throw persists the raw response to `~/.claude/magic-compact/debug/<source session id>-<ISO timestamp>.txt` and folds the path into the propagated error, so a field failure leaves evidence instead of being destroyed by the analysis copy's cleanup. Colons in the timestamp become hyphens, because they are illegal in a Windows path segment. The capture is best effort by design and must never mask the error it is diagnosing: if the write fails for any reason, the original parse error propagates alone and no file exists. A non-`Error` throw carries no message to append to, so the path goes to stderr instead. A successful parse writes nothing.

## Operating it

Invocation, thresholds, the two resume modes, and the housekeeping surfaces are documented for the operator in `plugins/claude-kit/skills/compact-session/SKILL.md`. The engine-side facts a maintainer needs on top of that:

- **Tunable constants.** `CHECK_TRIGGER_TOKENS` (200,000) and `MIN_COMPACTION_CONTEXT_TOKENS` (150,000) sit at the top of `compact-cli.ts`. `SEGMENT_TOKEN_BUDGET` (20,000) sits with its consumer in `transcript.ts`, and it calibrates against two axes now: summary granularity, and the size of the verbatim window preserved on the segment-granular keep path.
- **The ledger** at `~/.claude/magic-compact/ledger.jsonl` is append-only metadata, one line per successful compaction, and is the tuning feed. A ledger write failure is a warning, never a failure.
- **Tests** live in `tools/engine-tests/` and run under `bun test tools/engine-tests/`. They write real entries under `~/.claude/magic-compact/` and reap them per test.
- **Cwd is enforced.** The summarizer resumes its analysis copy by session id and the CLI resolves ids against the current cwd's project directory, so a mismatch is a hard error rather than a warning: fuzzy resolution could otherwise summarize the wrong conversation. `--check` is exempt and spawns nothing.

## Known limits

- **The segment fallback is one-shot within a continuous session.** `compactionStartIndex` stays turn-granular, so the whole turn holding the new summary rows becomes prefix on the next pass. A session that keeps running past a boundary with no resume prompt cannot compact twice. Both target workflows deliver that human row (the relay types a continue prompt, chain mode pipes one through `-p`), so every `/kit-goal` boundary compacts. A segment-granular boundary is the real fix and is a larger change, since the compactable remainder of a turn has no user rows and needs its own anchor override.
- **Tool-pair cohesion holds within a turn only.** A human user row arriving between a `tool_use` and its `tool_result` splits them into adjacent plan entries, which predates segmentation and is unchanged by it.
- **An unanswered `tool_use` as a turn's last row** is still followed by the next plan entry's rows. Segmentation refuses to put a summary row behind an orphan inside a turn; it cannot control what the next entry contributes.
- **Preserved turns are never bounded.** An oversized turn in the preserved group is copied whole, over budget and all, because nothing summarizes it.
- **Usage fields are copied verbatim,** so a freshly resumed compacted session displays the source's token count until the first new API call writes a real usage row.

## History

- 2026-07-18: bounded segmentation of summarized plan entries, the segment-granular keep fallback, the template's segment-pair rule, linearized emission with `assertSingleParentChain`, and parse-failure response persistence (`docs/archive/claude-kit_turn-segmentation_spec_v1.md`).
- 2026-07-15: indexed template pairs, the anchor cross-check, the sparse fallback, and the 600s timeout (`docs/archive/claude-kit_summarizer-robustness_spec_v1.md`).
- 2026-07-10: the trigger and minimum-context thresholds (`docs/archive/claude-kit_compaction-tuning_spec_v1.md`).
- 2026-07-07: the engine's origin and architecture (`docs/archive/claude-kit_compact-session_spec_v1.md`).
