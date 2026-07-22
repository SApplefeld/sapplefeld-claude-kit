# Relay Resume Confirmation

Status: Complete
Commit Model: Commit-and-Push
Fable Spend: Fable-led session (Scott's explicit /model Fable), inline implementation; small surface, no dispatch

## Related

- Builds on `claude-kit_resume-relay_spec_v1.md` (the watcher and its typing sequence) and `claude-kit_relay-auto-refresh_spec_v1.md` (whose timing note establishes that a relay-resumed session's SessionStart fires mid-sequence, the fact this design rides on).
- Sibling contract work: `claude-kit_relay-reresolution_spec_v1.md` and `claude-kit_relay-fallback-removal_spec_v1.md` (window targeting; untouched here).

## Problem

The resume-relay watcher types `/resume <uuid>`, sleeps a fixed `SESSION_LOAD_MS` (6000ms), and types the continue prompt. Nothing confirms the resume completed. When the session load outruns the sleep, the prompt lands in the still-loaded original session, which continues at full context and silently re-bills every subsequent call. Observed live by Scott on 2026-07-21 during an otherwise-healthy relayed compaction.

## Design

Replace the timer with a resume confirmation the resumed session emits itself:

- **New SessionStart hook `relay-ready.js`** (matcher `resume` only): on an armed machine (relay directory exists), stamp `%LOCALAPPDATA%\claude-kit\resume-relay\ready\<session_id>`. Fail-open and silent like every kit hook; UUID-shape whitelist before the id becomes a filename; prunes stamps older than 24h (manual resumes stamp too and nothing consumes those).
- **Watcher (`resume-relay.ahk`)**: before typing `/resume`, delete any stale `ready\<sessionId>` stamp (consume-before-send, so the releasing stamp is provably younger than the keystroke). After the `/resume` Enter, poll for the stamp (500ms interval, 60s timeout) instead of sleeping 6s; on the stamp, consume it, log the measured wait, settle `READY_SETTLE_MS` (1500ms, the tunable knob for input readiness), re-verify focus, and type the prompt. On timeout, hard-fail with the prompt unsent.

Timing feasibility is established by the kit's own record: a relay-resumed session fires SessionStart between the `/resume` Enter and the continue prompt (`docs/archive/claude-kit_relay-auto-refresh_spec_v1.md`, timing note; `relay-refresh.js` header), which is exactly the window the stamp must land in.

### Decisions

- **Fail closed on timeout (decided 2026-07-21).** A prompt typed without confirmation is the exact bug: it can re-animate the original full-context session silently. A hard fail with the prompt unsent is loud twice over (the request lands in `failed\`, and the session-start relay-failure nudge surfaces it), and the resumed-but-promptless session costs nothing while it waits. The alternative (type anyway after the timeout) re-imports the failure mode in the case the gate exists for.
- **Stamp file over window-title watching (decided 2026-07-21).** A title transition from `[UNCOMPACTED] <name>` to the clean name needs no new hook, but the watcher's own re-resolution logic acknowledges a clean title can legitimately exist at fire time, so the title cannot discriminate resumed-from-not-yet-resumed in every case. The stamp is deterministic and names the exact session.
- **Session-scoped stamp, documented rather than mechanized (decided 2026-07-22, from review).** Any resume of the session id confirms the gate, including a human typing the manual `/resume` fallback in another terminal during the wait, so the gate proves the session loaded somewhere, not that this window finished loading. Both reviewers rated it no-regression versus the unconditional timer; a request-scoped nonce would require the hook to know the request, which it cannot cleanly. Mitigation is procedural and already the documented recovery: a timed-out request is finished by hand-typing the continue prompt, never by writing a second request.
- **Accepted transition risk.** A session process started before this kit update has no `relay-ready` hook registered; if it relays a boundary against the refreshed watcher, the stamp never arrives and the request hard-fails with the resume done but the prompt unsent (recoverable, loud, self-healing as old processes end). Strictly better than the race being fixed.

## Sections of Work

### 1. relay-ready hook

`plugins/claude-kit/hooks/relay-ready.js` as designed, plus the `hooks.json` SessionStart entry (matcher `resume`). `KIT_RELAY_DIR` env override for tests (lifts the win32 gate), on the `KIT_TRIPWIRE_STATE_DIR` precedent.

### 2. Watcher gate

`resume-relay.ahk`: constants (`READY_DIR`, `READY_POLL_MS`, `READY_TIMEOUT_MS`, `READY_SETTLE_MS` replacing `SESSION_LOAD_MS`), pre-clear, `WaitForResumeReady`, hard-fail disposition, header-comment updates. Deployment to the armed copy rides the existing `relay-refresh.js` hash check; no doctor change (the dryrun probe path returns before typing and is untouched).

### 3. Tests and docs

`test/relay-ready.test.js` on the node:test spawn-the-hook pattern (stamp written on resume; non-resume source ignored; malformed session id refused; unarmed machine untouched; old stamps pruned). Docs: `docs/architecture.md` SessionStart hook list; compact-session `SKILL.md` relay-mode paragraph (one sentence on the confirmation gate and its failure disposition).

## Acceptance

- `node --test test/` green including the new file (baseline captured before edits).
- Watcher syntax-checks under AutoHotkey v2 if available; otherwise flagged as unverified in the close-out.
- Live acceptance is the next real relayed boundary: `relay.log` shows `resume confirmed after <n>ms` between the resume and the typed prompt. Not observable in-session; named in the close-out as Scott's check.

## Chapters

### Chapter 1: All sections, reviewed and delivered (2026-07-22)

All three sections shipped in this changeset: `relay-ready.js` plus its `hooks.json` entry (matcher `resume`), the watcher gate in `resume-relay.ahk` (verified pre-clear, `WaitForResumeReady`, fail-closed timeout), and tests plus the two doc surfaces (`docs/architecture.md` SessionStart list, compact-session `SKILL.md` relay paragraph).

Gates: `node --test "test/*.test.js"` baseline 122 pass / 0 fail before edits, 130 pass / 0 fail after (the 8 additions are `test/relay-ready.test.js`); the bare `node --test test/` form does not work on Node v24, the glob form is the gate. Watcher syntax: AutoHotkey v2 `/validate` on a scratchpad copy, exit 0, with the validator proven discriminating (an injected syntax error exits 2).

Review round (adversarial + blind, both APPROVED_WITH_CONCERNS): both independently found the same Major, the pre-clear `try FileDelete` swallowing a failed delete so a surviving stale stamp would release the prompt at ~0ms and reproduce the original bug; fixed with a verified delete that soft-fails (retryable, typing not yet begun) when the stamp survives. Also fixed from review: the wait loop's last existence check landing one poll interval short of the advertised timeout; a silent failed consume (now logged); the traversal test asserting one directory level too shallow (now pins both escape depths, with a `..\..\evil` input added); a false test-name rationale about watcher case-sensitivity; a missing stderr-silence assert. Documented rather than mechanized, per the Decisions entry: the session-scoped stamp edge. Discarded: nothing; every finding was actioned or recorded as a decision.

Confirmed versus inferred at delivery: the SessionStart-fires-mid-sequence timing is confirmed by the kit's own record (`docs/archive/claude-kit_relay-auto-refresh_spec_v1.md`, timing note); that the resume payload's `session_id` equals the typed destination UUID is inferred-consistent (kit-goal-stop's live-proven destination-id rebinding relies on the same identity) and is pinned by the live acceptance check below.

Remaining, Scott's check: the next real relayed boundary should show `resume confirmed after <n>ms` in `relay.log` between the resume and the typed prompt; a hard failure naming a missing confirmation instead means the resumed process predated the hook registration (expected once per stale process during transition) or the id-preservation inference is wrong (report back, that reopens the design). Deployment of the watcher to the armed copy rides the existing relay-refresh hash check at the next idle session start; the hook itself is live on the next plugin republish + session start.
