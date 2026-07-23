---
name: kit-goal
description: "Arm or clear a project-scoped completion leash for a plan run. Use when I type /kit-goal <plan path> to hold an autonomous run to completion across compaction and session swaps, /kit-goal clear to release it, or /kit-goal to see what is armed. The kit-native, deterministic alternative to native /goal for plan-based runs."
---

# Kit Goal

`/kit-goal docs/plans/<plan>.md` arms a plan run in one line: it writes a project-scoped goal state file, and a deterministic kit Stop hook holds the session to completion. Unlike native `/goal`, whose state is bound to the session transcript and lost the moment a compaction mints a new session id, this leash lives in the project (`.kit/goal-state.json`), so a relayed or freshly compacted successor in the same repo inherits it with no re-arm step.

This is the one-line arming the executing-work loop expects for a plan run. Native `/goal` remains for goals that are not plan-based.

## Arm

`/kit-goal <plan path>`, where the argument is a repo-relative plan path like `docs/plans/foo_spec_v1.md`. Run the CLI, which validates the plan and writes the state atomically:

```
node <plugin-root>/hooks/kit-goal.js arm <plan path>
```

The CLI lives at `hooks/kit-goal.js` under the plugin root; from this skill's base directory (`<plugin>/skills/kit-goal/`) that is `../../hooks/kit-goal.js`. Report the one-line result. The command refuses, with the reason, a plan that does not exist or is already `Status: Complete`; surface that reason and stop rather than retrying.

## Clear

`/kit-goal clear` (accept the aliases `stop`, `off`, `reset`, `none`, `cancel`) releases the leash:

```
node <plugin-root>/hooks/kit-goal.js clear
```

## Status

`/kit-goal` with no argument, or `/kit-goal status`, reports what is armed, including which session currently holds the leash (or that it is unbound):

```
node <plugin-root>/hooks/kit-goal.js status
```

## How the leash holds

The `kit-goal-stop.js` Stop hook (wired in the plugin's `hooks.json`) fires on every stop but is a strict no-op unless a goal is armed in the current project and the stopping session holds the leash. The leash binds to one session chain at a time: it arms unbound, and the session that armed it claims it at its first stop, the `/kit-goal` invocation's command arguments being the claim signal. Nothing else claims: plain prose mentions, the assistant's own text, injected context, tool output, and the CLI's echoed stdout never do, so arm from the session that should hold the leash. Once bound, no other session is leashed however often it mentions the plan, so a session spawned to discuss an armed plan is never yanked into working it, and two sessions can never both hold the same leash. A different session is recognized as the chain's successor only by identity: a relay handoff naming it as destination, or the compaction ledger's source-to-destination chain (which is how a manually resumed compaction successor inherits). Re-arming with `/kit-goal <plan path>` resets the binding; that is the recovery move when a bound session died without a handoff.

When the stopping session holds the leash, the hook allows the stop only when:

- (a) the plan's `Status` is `Complete`, or the plan file has moved to the archive (the run finished), in which case it also auto-clears the goal;
- (b) the last assistant message opens with `BLOCKED:` as its very first characters (a true blocker was surfaced). The match is the literal leading prefix: a `BLOCKED:` line mid-message, or one wrapped in bold or a heading, does not release; or
- (c) a section-boundary resume-relay handoff for this plan was just written (the compact-session relay path is handing off to a successor). The allow rebinds the leash to the handoff's destination session, so the successor is held from its first turn. The newest handoff naming the plan decides, and one whose destination is the stopping session itself does not count: the request that resumed a successor is not the successor's own license to stop, so a freshly resumed session stays leashed through the recency window.

Otherwise it blocks with a reason naming the plan, so a run cannot quietly stop with sections left. The conditions re-evaluate on every stop attempt, including inside a stop-hook continuation, so the leash holds until one is genuinely met; Claude Code's own consecutive-block cap (eight blocks without progress, `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`) is the loop backstop that releases a genuinely stuck session with a visible warning. Any error inside the hook allows the stop: the leash never traps a session. The canonical condition text is composed and owned by `hooks/kit-goal-lib.js` (`composeCondition`); this skill does not restate the literal, so the two cannot drift.
