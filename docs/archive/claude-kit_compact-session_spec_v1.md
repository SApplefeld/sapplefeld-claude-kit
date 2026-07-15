# Compact Session: Low-Loss Compaction and the Continuation Chain

Status: Complete
Commit Model: Review-Only
Fable Spend: session-led (effort designed and built in a Fable session; no additional per-section Fable dispatch)
Created: 2026-07-07

## Goal

Long autonomous runs accumulate context that has no good moment to clear. Native compaction flattens history into one lossy blob at a moment the harness picks. This effort gives the kit a deliberate, low-loss alternative: a compaction engine Claude invokes at section boundaries, producing a new session whose transcript keeps user messages verbatim, replaces each assistant turn with a per-turn summary, preserves the tool-call skeleton, and moves bulky tool I/O to a retrievable local cache. On top of the engine, the continuation-chain pattern lets an autonomous effort keep running across compactions with no human resume: the supervisor session compacts a worker session and resumes the compacted worker headlessly for the next section.

## Provenance and license

The engine is adapted from `aerovato/magic-compact` (commit `fd92b2d`, MIT-less as of 2026-07-07). Upstream issues filed from this effort: [#5](https://github.com/aerovato/magic-compact/issues/5) (resume-by-path bug, fabricated-summary failure mode) and [#6](https://github.com/aerovato/magic-compact/issues/6) (license request). Until upstream declares terms, the vendored engine is private-use only: it ships inside this private kit, is never published or redistributed, and `engine/ATTRIBUTION.md` records the source and the delta. If upstream adds a permissive license, the restriction lifts; if upstream declines, the engine gets a clean-room rewrite from the public behavior spec before any distribution.

## Evidence base (verified 2026-07-07, CLI 2.1.197, Windows 11, Bun 1.3.14)

- `claude -p --resume <sessionId>` continues a session headlessly, appends to its transcript, runs hooks and the full agentic loop. Confirmed by live test.
- `--resume <transcript path>` does NOT resolve a session on this CLI version; the summarizer then fabricates summaries that pass validation. This is the upstream bug; the vendored engine resumes by session ID. Confirmed by live test.
- A compacted destination session resumes headlessly with context intact (three cross-compaction recall questions answered correctly, $0.07 at Haiku). Confirmed by live test.
- Headless `claude -p` inherits the default model, which resolved to Fable (API-billed). Every headless spawn in this design therefore pins `--model` explicitly. Confirmed by live test (two unpinned runs billed roughly $3-6).
- A Stop hook can extend a headless turn past its intended output; the summarizer spawn therefore disables hooks. Confirmed by live test (Stop hook drove 12 extra turns).

## Design decisions

- **Runtime: Bun.** The engine is proven TypeScript running under Bun, now installed. Porting to Node buys nothing today. Bun becomes a documented prerequisite of this one capability; the skill checks for it and degrades with a clear message.
- **Summarizer spawn: pinned model, hooks off, timeout.** Default `claude-sonnet-5` (quality summaries, plan-covered), `--settings '{"disableAllHooks":true}'`, 240s process timeout. Model overridable per invocation.
- **Omission retrieval: no MCP server.** Upstream ships a stdio MCP server for `read_omitted_content`. The kit version replaces it with `engine/retrieve.ts` (a CLI over the same cache) and rewrites the omission and boundary notices to name the exact retrieval command with the engine's absolute path embedded at compaction time. One less moving part; works in any session with Bash.
- **Worker permission profile: inherit user settings.** Headless workers run with the user's existing allowlists; no `bypassPermissions` default. A denied tool in a headless worker fails visibly and the supervisor surfaces it. Revisit only on demonstrated friction, as a deliberate decision.
- **Two usage modes, one engine.** Interactive mode: compact the session Scott is watching, hand him the one-line `/resume <id>`. Chain mode: compact a worker session and headless-resume the result; no human step.
- **Source session is never modified** (upstream copy-on-write model preserved), except the upstream `[UNCOMPACTED]` title relabel, which is kept because it keeps the resume picker honest.

## Sections of Work

### 1. Vendored engine
Model: fable (in-flight debugging chain from the validation session; main-thread per doctrine)
Vendor the patched engine into `plugins/claude-kit/skills/compact-session/engine/`: `compact.ts`, `transcript.ts`, `prune.ts`, `omission.ts`, plus new `compact-cli.ts` (argument-driven entry: `--transcript <path> [--keep N] [--summarizer-model <id>]`, JSON result on stdout) and new `retrieve.ts` (Content ID to original content). Deltas from upstream, each present: resume by session ID; pinned summarizer model + disabled hooks + spawn timeout; MCP server dropped; notices rewritten to name the retrieval command; `ATTRIBUTION.md` recording source commit and delta. No hook.ts, no mcp.ts, no .mcp.json.
Acceptance: end-to-end gate on the real fixture transcript (a copy placed in the live project directory): compaction succeeds; destination transcript has boundary row, verbatim user rows, summary rows marked `magicCompact.summary`, pruned tool rows; omission cache written; `retrieve.ts` round-trips a Content ID; a pinned-model headless resume of the destination answers a cross-compaction context question; fixture, destination, and cache cleaned up afterward.

### 2. compact-session skill
Model: fable (behavior-shaping prose)
`plugins/claude-kit/skills/compact-session/SKILL.md`: when to compact (section boundary after the Chapter is written and gates are green; never mid-debugging-chain), how to locate the current transcript (session id embedded in the scratchpad path), how to invoke the engine, the two modes (interactive handoff vs worker chain), the hard cost rule (every headless `claude` spawn pins `--model`; summarizer default sonnet), the retrieval contract for omitted content, and failure handling (engine failure leaves the source untouched; report and continue uncompacted).
Acceptance: skill reads coherently, first person where the kit's skills are, no em dashes, states the Bun prerequisite and the exact invocation, and the catalog description triggers on "compact the session", "compaction point", "continuation chain".

### 3. Continuation-chain doctrine
Model: fable (behavior-shaping prose)
Add to `executing-work` a section-boundary compaction step: at each section close in a long run, offer (interactive mode) or perform (chain mode, when the run is already worker-based) compaction, with the plan doc as the recovery spine either way. Update the kit `README.md` STRUCTURE block with the new skill line. Keep the edit surgical; `executing-work`'s completion contract is untouched.
Acceptance: executing-work names the compaction point without weakening the do-not-stop rules; README structure lists compact-session; no other doctrine files touched.

### 4. Finishing pass
Model: fable (finishing reviews default to Fable; session is Fable-led)
Adversarial review and security review over the changeset (the engine writes to `~/.claude/projects`, spawns processes, and handles transcript data, so the security review is not optional), QA per Section 1's gate re-run, docs curation (index the plan, cross-reference, backlog prune), close-out Chapter, flip to Complete, archive via curating-docs, stage everything for review.
Acceptance: reviews returned and adjudicated in the Chapter; gate re-run green; plan archived and staged with the code per Review-Only.

## Related

- Upstream: https://github.com/aerovato/magic-compact (issues #5, #6 filed from this effort)
- Doctrine hooks: `executing-work` (section loop), `operating-instructions` (orchestration and cost rules)
- `../archive/claude-kit_fable-metering_spec_v1.md`: the cost/model-tier rules that this effort's hard pin---model rule for headless spawns builds on
- `claude-kit_summarizer-robustness_spec_v1.md` (archive sibling, 2026-07-15): replaced this engine's summarizer contract (indexed template pairs, anchor cross-check, sparse fallback, 600s timeout) after the first-line anchor scheme failed on real orchestrator transcripts

## Chapters

### Chapter 1 - 2026-07-07
Completed: Section 1, vendored engine
Implemented By: main session (in-flight chain from the validation session, per the spec's tier note)
Decisions / Surprises: upstream `command.ts` was dropped rather than vendored (it only parses hook input, which the CLI replaces); spec text amended to match. `Bun.spawn`'s `timeout` option carries the 240s summarizer guard. The acceptance gate ran live: fixture compacted (95 rows, 1 boundary, 2 summary rows, notices name `retrieve.ts`, no MCP reference), `retrieve.ts` round-tripped `cd052a31b82c:omitted-001`, and a pinned Haiku headless resume of the destination answered an in-fixture recall question correctly. Fidelity note: Haiku summaries preserved substance but softened framing (an "answers hedged" case was traced to the summary wording, not to lost content); production default stays sonnet. Gate artifacts (fixture session, destination, cache) deleted after the run.
Review Findings: per-section review deliberately folded into the finishing review; all three sections landed as one contiguous changeset in one session.
Next: Section 2
Commit Model: Review-Only

### Chapter 2 - 2026-07-07
Completed: Section 2, compact-session skill
Implemented By: main session
Decisions / Surprises: the skill hard-codes the two live-tested cost/safety rules (pin `--model` on every headless spawn; hooks off for the summarizer, on for workers) and adds a no-interactive-attach rule for workers mid-turn, which the validation session showed matters (two writers on one transcript). Housekeeping section names the omission cache's sensitivity and the `[UNCOMPACTED]` reaping.
Review Findings: folded into finishing review.
Next: Section 3
Commit Model: Review-Only

### Chapter 3 - 2026-07-07
Completed: Section 3, continuation-chain doctrine
Implemented By: main session
Decisions / Surprises: the compaction point landed as step 8 of the executing-work section loop rather than a freestanding section, and it explicitly subordinates itself to the completion contract: chain mode compacts between sections, interactive mode offers compaction only at a genuine turn end (blocker, close, or request), so the contract's do-not-stop rules are untouched. README intro sentence and STRUCTURE block updated.
Review Findings: folded into finishing review.
Next: Section 4, finishing pass
Commit Model: Review-Only

### Chapter 4 - 2026-07-08
Completed: Section 4, finishing pass; effort Complete
Implemented By: main session; QA, security, adversarial, and docs-curation dispatched as parallel fresh-context agents
Decisions / Surprises:
- QA verdict was FAIL as instructed, and correctly so: the Haiku summarizer reproducibly breaks the XML output contract at real transcript scale (3/3 distinct failures on a ~380-row fixture) while Sonnet succeeds. Adjudicated as validation of the sonnet default, not an engine defect; SKILL.md now forbids Haiku as summarizer. Every failure left the source untouched, proving the containment design under real failure.
- The final gate then reproduced the same failure shape at sonnet-5 ("Expected 7 summaries, received 8"), which root-caused to an upstream design weakness: models append one unrequested summary for the template's trailing next-turn user anchor, and count-only validation rejects the otherwise-correct response. Fixed in the vendored engine (template marks the trailing user as not-to-be-summarized; parsing pairs user/assistant blocks positionally and takes exactly the first N), watched red then green on the same fixture. Upstream-worthy improvement, not yet reported upstream.
- Adversarial Major 1 (dangling tool_use on mid-turn self-compaction) verified resolved empirically: a fixture cut mid-tool-call compacted at production defaults and the destination resumed cleanly; the CLI repairs unanswered tool_use blocks. Major 2 (same-project cwd requirement, silent wrong-session summarization risk) fixed with a hard fail-fast guard in compact-cli.ts, negative-tested (exit 1 from a foreign cwd).
- Security Major (summarizer spawn had hooks off but full tool surface over untrusted transcript content) fixed by denying the tool surface in the spawn settings; summarization needs no tools. Minors landed as SKILL.md integrity rules (retrieve.ts path pinning, summary-laundering caution), housekeeping additions (cache reaping with [UNCOMPACTED] sessions, orphaned-analysis-copy note), a stdin-directive rule for chain-mode spawns, a native-exe prerequisite, and a documented accepted limitation in ATTRIBUTION.md (omission-cache suffix matching, single-user machine).
- Bun.spawn timeout semantics verified generically (timed-out child exits 143, which the engine's nonzero-exit check catches).
- --keep now defaults to 1 (protect the in-flight turn); an explicit --keep 0 remains available for cleanly ended sessions.
- During QA's headless context check, the resumed compacted session autonomously dispatched its own reviewer subagents to continue the finishing-pass work it saw in-flight. Debris cleaned; instructive confirmation that a resumed compacted session is a live agent, which the skill's chain-mode rules already treat it as.
- Chapter 1 claimed the spec was amended for the command.ts drop but the Section 1 text had not actually been edited; the adversarial review caught the contradiction and the spec text is now amended for real.
Review Findings: QA FAIL adjudicated and resolved (summarizer reliability, fixed + re-gated green); security 1 Major fixed, 6 Minors fixed or accepted-as-documented; adversarial 2 Majors fixed (one by verification, one by guard), 5 Minors fixed or verified; docs-curation drift D1 (command.ts drop) deviation, reconciled.
Drift adjudication: D1 deviation only; no mistakes. Docs indexes refreshed by the curator and again at archive time.
Cost note: reviews and finishing ran in the Fable-led session per the spec's Fable Spend header; gate summarizer calls ran at sonnet-5/haiku, resume checks at haiku (about $0.25 total across checks). Separately, two unpinned exploratory runs early in the session (before this plan existed) billed roughly $3-6 of Fable API credits; the pin---model rule this effort hard-codes is the direct lesson.
Next: none; archived via curating-docs in this close-out. Delivered in this changeset, staged for review under Review-Only.
Commit Model: Review-Only
