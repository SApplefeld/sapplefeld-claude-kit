# Goal Continuity: /kit-goal Arming and the Leash Across Session Swaps

Status: Approved
Commit Model: Commit-and-Push
Fable Spend: spec authored session-led; section tiers below
Created: 2026-07-16

## Goal

Native `/goal` enforcement and relay compaction now compose: the goal template's handoff carve-out (executing-work, The completion contract) lets the evaluator approve a boundary stop, so a relay-armed compaction ends the turn cleanly instead of racing the Stop hook. That wording fix shipped with this spec's changeset (executing-work goal template and step 8 branches, compact-session relay precondition).

Two gaps remain, and this effort closes them:

1. **The leash is discontinuous across the swap.** Goal state is session-scoped, so the compacted successor starts goalless. Until it is re-armed, the successor runs on the completion contract alone, exactly the "stopped after one big chapter" exposure `/goal` exists to prevent.
2. **Arming is manual boilerplate.** The canonical goal text must be composed and pasted per run. The target ergonomic: `/kit-goal docs/plans/<plan>.md` arms the run in one line.

## Facts (code.claude.com/docs/en/goal.md)

- `/goal` is a wrapper around a session-scoped prompt-based Stop hook. At each stop attempt, the condition plus the conversation go to the configured small model (Haiku default), which returns yes or no.
- Conditional clauses in the condition text are honored (bounding clauses such as "or stop after 20 turns" are documented).
- `/goal clear` clears the goal (aliases: stop, off, reset, none, cancel). Only the evaluator declares completion; the session cannot end its own goal.
- A goal carries over when resuming the same session. A compacted successor is a new session ID, so inheritance is not expected there; Section 1 confirms.
- A custom slash command cannot alias a built-in directly: command files expand to prompt text, they do not execute other commands. The two viable `/kit-goal` routes are the SlashCommand tool (if it can invoke `/goal`) and a kit-native mechanism that does not need `/goal` at all.

## The Section 3 fork (decided 2026-07-16: A, kit-native)

Scott chose fork A: a deterministic kit-owned implementation of the plan methodology, keeping native `/goal` in reserve for goals that are not plan-based. Fork B stands only as the fallback if A's Stop-hook UX fails live fire.

**A. Kit-native goal (recommended).** `/kit-goal <plan>` writes a project-scoped goal state file; a kit Stop hook enforces it deterministically: allow the stop when (a) the armed plan's Status is Complete or the plan is archived, (b) the last assistant message leads with `BLOCKED:`, or (c) a resume-relay request was written in the last few minutes; otherwise block with a reason naming the plan. Why it wins: the successor session inherits the leash structurally (same project, same hook), no typed keystrokes, arming is fully automatic, deterministic conditions cannot be sweet-talked, and it works wherever hooks run, Desktop included. Costs and open design points: it duplicates a native feature and the kit maintains it; the blast is project-wide, so the hook must scope to sessions actually working the armed plan (candidate predicate: the session transcript references the plan path); it must handle `stop_hook_active` without looping; and the clause-(c) window must tolerate the watcher archiving `request.txt` within its 10-second poll (accept a recent `processed\` entry, or a dedicated boundary marker).

**B. Watcher goal-line extension.** The relay request contract gains an optional goal line; after typing the resume, the watcher types `/goal <condition>` into the successor, then the continue prompt. Why it loses: it adds two typing stages to a keystroke path whose focus losses are already hard failures, it covers only the relay path (a crash or native auto-compaction still drops the leash), and arming stays manual. It remains the fallback if A's Stop-hook UX proves troublesome in live fire.

With A, the goal template's single owner moves to the `/kit-goal` command and executing-work's template block becomes a pointer to it, per the one-owner rule.

## Locked contract (as-built, decided 2026-07-16)

Fork A's mechanism is deterministic (no LLM evaluator). Sections 2, 3, and 5 all build to this shared contract:

- **Goal state file:** `<repo>/.kit/goal-state.json` (gitignored, project-scoped so the successor session inherits it via shared cwd). Schema: `{ "plan": "<repo-relative forward-slash plan path>", "condition": "<canonical condition text>", "armedAt": "<ISO-8601>" }`. Written atomically (tmp + rename).
- **Shared library:** `plugins/claude-kit/hooks/kit-goal-lib.js` (Node core only, CommonJS, never throws), the single owner of the canonical condition string (`composeCondition`), plus `readGoal` / `armGoal` / `clearGoal` / `planHead`. The lib, not the skill prose, is the single source of the condition text.
- **CLI entry:** `plugins/claude-kit/hooks/kit-goal.js` (`arm <plan>` | `clear` | `status`), invoked by the skill.
- **`/kit-goal` skill:** `plugins/claude-kit/skills/kit-goal/SKILL.md`, arming and clearing UX; executing-work's template block becomes a one-line pointer to it (the one-owner move).
- **Stop hook:** `plugins/claude-kit/hooks/kit-goal-stop.js`, wired in `hooks.json`. Fires on every Stop but is a strict no-op unless a goal is armed. Allow order: (0) `stop_hook_active` guard; (0b) no state file → allow; (0c) scoping predicate: the session's `transcript_path` must reference the armed plan path, else allow (an unrelated session in the same project is never leashed); (a) plan Status is Complete or the plan file is gone (archived) → auto-clear and allow; (b) last assistant message leads with `BLOCKED:` → allow; (c) a resume-relay handoff for this plan is recent (live `request.txt`, or newest `processed\*.txt`, mtime within the window AND its content references the armed plan) → allow; else block with a reason naming the plan. Any error → allow (never trap the session).
- **Clause-(c) window:** 5 minutes, tolerating the watcher's 10-second poll archiving `request.txt` to `processed\`. Tying the match to the plan path (not just recency) tightens it against a concurrent unrelated relay on the same machine. This leaves the compact-session relay write path untouched (no added boundary-marker step).
- **Session-start surfacing:** `session-start.js` emits "kit goal armed for &lt;plan&gt;" when a goal is armed, so no session is surprised by the hook.

Section-boundary reallocation from the brainstorm sketch: the `/kit-goal clear` UX lands in Section 2 (it owns the whole skill + CLI surface); Section 3 owns the hook's auto-clear-on-Complete. Clean disjoint file ownership: Section 2 = lib + CLI + skill + executing-work pointer; Section 3 = Stop hook + hooks.json + session-start.js.

## Sections of Work

### 1. Feasibility probe (supervised, goal-capable machine)
Model: fable (inline; interactive with Scott present)
One probe: whether a relayed compacted successor inherits an active native goal. Expected no (goal state is session-scoped); a yes means the kit hook is belt and braces rather than the sole leash across a swap, which changes Section 3's live-fire emphasis, not its design. The fork-B probes (SlashCommand reaching built-ins, AHK driving `/goal` through the slash menu) are dropped with fork B; revisit them only if fork A fails live fire.
Acceptance: the probe answered with observed evidence recorded in the Chapter.

### 2. /kit-goal arming command
Model: sonnet
A `/kit-goal <plan path>` command that validates the plan exists, composes the canonical goal condition from the template, and arms it by writing the kit-native goal state (fork A). Move template ownership here; executing-work points to it.
Acceptance: one command arms a run against a named plan with no hand-composed boilerplate; a missing or Complete plan is refused with the reason.

### 3. Continuity mechanism (fork A)
Model: opus
Goal state file, Stop hook in `plugins/claude-kit/hooks/` wired via `hooks.json`, the deterministic allow conditions above, `/kit-goal clear`, auto-clear on plan Complete, and session-start surfacing ("kit goal armed for <plan>") so no session is surprised by the hook.
Acceptance: with the mechanism armed, a mid-plan stop without (a), (b), or (c) is blocked with a reason; a clause-(c) boundary stop passes; a successor session in the same project is enforced with no re-arm step.

### 4. Live fire (supervised)
Model: fable (inline; Scott present)
A real plan, goal armed via `/kit-goal`, run to a genuine 200k-plus relay boundary: verify the boundary stop is approved, the relay swaps sessions, the successor is leashed from its first turn, and the run continues to the next section. This is also the GREEN validation for the Phase 1 skill wording, which currently stands on the observed 2026-07-16 incident and the documented evaluator behavior rather than a demonstrated pass.
Acceptance: one uninterrupted goal-armed run crossing at least one relay boundary with the leash provably continuous (a test stop attempt in the successor gets blocked).

### 5. Doctor and docs
Model: sonnet
kit-doctor probes for whatever Section 3 shipped (hook wired, state readable, stale-goal detection), plus README and index updates.
Acceptance: doctor reports the new surface green on a healthy install and names the failure on a broken one.

## Related

- `docs/archive/claude-kit_resume-relay_spec_v1.md`: the watcher this composes with.
- `docs/archive/claude-kit_compact-session_spec_v1.md` and `docs/archive/claude-kit_summarizer-robustness_spec_v1.md`: the compaction engine and its hardening.
- Phase 1 (goal template carve-out and relay precondition) shipped in this spec's changeset, in the executing-work and compact-session skills.

## Chapters

### Chapter 1 - 2026-07-16
Completed: 1. Feasibility probe (supervised, goal-capable machine)
Implemented By: main session (inline; fable-tier probe)
Metrics: 0 review rounds (investigation, no code); 0 NEEDS_CONTEXT; 0 escalations; advisor off (Opus-led session)
Decisions / Surprises: Native `/goal` state is a transcript attachment record, observed live in this session's own `.jsonl`: `{"type":"goal_status","met":false,"sentinel":true,"condition":"..."}`. No native goal state exists anywhere in `~/.claude` settings, `sessions/`, `session-env/`, or `tasks/` (grepped). The leash is bound to the session/transcript, not the project. A relayed compacted successor is a new session id with a new transcript built by the compact engine, which never carries the `goal_status` sentinel, so it starts goalless. Confirmed: the storage location (read the record directly). Inferred from that mechanism: non-inheritance across a swap. This matches the spec's expected "no" and settles the emphasis for Section 3: the kit hook is the sole structural leash across a swap, not belt-and-braces, so it must carry the whole continuity load. Direct live confirmation (arm native `/goal`, relay-compact, watch the successor come up goalless) folds into Section 4's live-fire. Also locked the shared as-built contract (new "Locked contract" section) before fanning out Sections 2/3, and confirmed: `.kit/` is gitignored (state-file home), the build packages only `plugins/claude-kit/` (a repo-level `test/` won't ship), plugin slash-commands auto-discover from `skills/<name>/SKILL.md` and invoke as `/kit-goal`, and Node v24 supports zero-dependency `node:test`.
Review Findings: none (no code produced this section)
Compaction: not run: Section 1 is investigation only, context light, and the native `/goal` on this build session governs the turn; no boundary compaction warranted.
Next: 2. /kit-goal arming command
Commit Model: Commit-and-Push

### Chapter 2 - 2026-07-16
Completed: 2. /kit-goal arming command
Implemented By: implementer-sonnet (kit-goal-lib.js, kit-goal.js CLI, tests) + main session (kit-goal/SKILL.md, executing-work pointer edit)
Metrics: 1 review round (adversarial + blind + security, all three ran); 0 NEEDS_CONTEXT; 0 escalations; advisor off (Opus-led session)
Decisions / Surprises: Split-commit sequencing (blind CRITICAL): the two enforcement-claiming prose files (kit-goal/SKILL.md, executing-work rewrite) describe the Section 3 Stop hook as live and wired, which it is not until Section 3 lands. To avoid a pushed history where the docs claim an enforcing hook that does not exist (a run that believes it is leashed but is not), only the inert substrate (lib + CLI + tests, which nothing yet reads) commits in this section; the prose lands atomically with Section 3's kit-goal-stop.js + hooks.json wiring. Section 2/3 boundary reallocation stands (clear UX in Section 2, auto-clear in Section 3). Build gotcha (durable, also saved to memory): `node --test test/` (bare directory) misbehaves on Node v24/Windows (`Cannot find module ...\test`); the working gate is the glob form `node --test test/*.test.js`.
Review Findings: MAJOR (adversarial): armGoal broke the lib's "never throws" contract (unwrapped mkdirSync/writeFileSync/renameSync) - FIXED (write trio wrapped, returns {ok:false, reason} on FS failure). Security MINOR: plan/condition written to goal-state.json unsanitized, a context-injection surface via a control-char plan filename - FIXED (normalizePlanArg rejects control chars). MINORs FIXED: unanchored Status regex misclassified a Complete plan whose body contains "in progress" (anchored to ^...im, regression test added); `rel.startsWith('..')` false-positive on a `..notes.md` name (tightened to real `..` segments); CLI now honors the documented clear aliases (stop/off/reset/none/cancel); composeCondition comment clarifies the stored condition is descriptive not the enforcement rule; re-arm idempotency test added. DECLINED with reason: planHead symlink/FIFO follow (POSIX-only, needs repo-write, returns no content, self-inflicted only). DEFERRED to Section 3: compact-session SKILL.md:53 still frames the relay precondition in native-/goal terms and should gain the kit-goal framing when the hook lands. OUT-OF-BAND note: the sibling hooks (session-start.js, stop-docs-hygiene.js) use the same unanchored plan-status regex; a latent pre-existing bug, left untouched for scope, worth a backlog fix. Tests: 15 pass, EXIT 0.
Compaction: not run: context moderate mid-effort, no section-boundary relay handoff pending; will assess at the Section 3 close.
Next: 3. Continuity mechanism (fork A)
Commit Model: Commit-and-Push
