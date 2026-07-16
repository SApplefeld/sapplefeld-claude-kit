# Relay Auto-Refresh: the Watcher Stays Current Without a Manual Re-Arm

Status: Complete
Commit Model: Commit-and-Push (branch worktree-doctor-crlf-fix; lands on main via ff-merge)
Fable Spend: session-led implementation (sections too small to brief)
Created: 2026-07-16

## Goal

Every kit update strands the deployed relay watcher: the plugin payload's `resume-relay.ahk` moves forward, the copy in `%LOCALAPPDATA%\claude-kit\resume-relay` keeps running old code, and the only remedy is manually digging out `arm-resume-relay.ps1`. The doctor detects the drift (hash mismatch) but never repairs it, so the WARN recurs after every update.

This effort makes the deployed watcher self-healing, on the doctrine-refresh precedent: the initial arm stays a deliberate consented act (it installs AutoHotkey and writes a Startup shortcut), but keeping an already-armed relay current is silent kit-owned maintenance of that standing choice.

## Safety invariant

Re-arming kills the running watcher. Two hazards: a kill mid-typing leaves a half-typed `/resume` in a live terminal, and the watcher's typed-request memory (`handledContent`) is in-process, so a restart can re-type a request whose archive move failed. Both are guarded by one observable fact: `request.txt` exists for the entire life of a request, including during typing (it is archived only after the request settles). **No `request.txt` present means the watcher is provably idle and safe to restart.** Every automatic refresh path checks it and defers when present.

## Sections of Work

### 0. docs-write-guard recognizes background-session mains (decided 2026-07-16)

Found-work prerequisite: the guard blocked this effort's own spec write. A user-launched background job presents as the bare `claude` agent type, which the guard read as a dispatched subagent, so no background session could author a plan doc. Scott chose to widen the guard: bare `claude` (case-insensitive exact token, matching the guard's fail-open direction) is main-session-equivalent; namespaced and named agent types stay governed. Accepted tradeoff: a deliberately dispatched catch-all `claude` agent shares the type and also passes. `test/docs-write-guard.test.js` pins the access model per agent type.

### 1. Arm script refresh mode

`arm-resume-relay.ps1` gains `[switch]$RefreshOnly`: refresh the deployed copy of an already-armed relay, never perform first-time setup.

- Exits nonzero without side effects when the relay dir does not exist, the Startup shortcut is absent (a documented disarm that a refresh must never undo), or AutoHotkey v2 is missing (refresh never installs anything; exit 3).
- Exits nonzero without side effects when `request.txt` exists (busy; exit 2, logs a deferred line to `relay.log`), and re-checks it a second time after the CIM process enumeration, immediately before the kill loop, so the unguarded gap is the kill itself rather than the multi-second enumeration.
- Otherwise: rewrite the Startup shortcut (idempotent; keeps the AHK path current), stop the old watcher, copy the payload watcher, start the new one, log a refresh line to `relay.log`, exit 0. The deployed copy is written only after the kill and immediately before the start: the deployed-vs-payload hash is the drift signal for the hook and the doctor, so an interrupted run must leave the hash mismatched (retried next session start) instead of converged around a watcher that never restarted. Skips window.txt seeding (an armed relay owns its window.txt).
- Full-arm behavior (no switch) keeps its semantics; it shares the reordered kill-copy-start sequence.
- The closing "re-run after a kit update" hint updates to name the auto-refresh.

### 2. SessionStart auto-refresh hook

New `plugins/claude-kit/hooks/relay-refresh.js`, wired in hooks.json's SessionStart with matcher `startup|resume`. Fails open and silent, like doctrine-refresh. In order, it exits without action unless ALL hold:

- `process.platform === 'win32'`
- relay dir exists (the user armed it once; that is the standing consent)
- deployed `resume-relay.ahk` exists
- payload watcher at `CLAUDE_PLUGIN_ROOT/skills/compact-session/relay/resume-relay.ahk` exists (fallback: resolve relative to the hook file)
- SHA-256 of deployed differs from payload
- no `request.txt` pending (cheap pre-check; the script re-checks, and owns the guard)

The remaining refresh preconditions (Startup shortcut present, AutoHotkey installed) live in the script's `-RefreshOnly` guards alone, not duplicated in the hook: a declined spawn costs one bounded process once per kit update, and a second hand-copied list would drift.

Then it runs Windows PowerShell by absolute path (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`; an unqualified name resolves through a search path including the session cwd, which a hostile repo controls) with `-NoProfile -ExecutionPolicy Bypass -File <payload arm script> -RefreshOnly`, synchronously (`stdio: 'ignore'`, `windowsHide`, 30s timeout, outlasting a cold-WMI enumeration). Synchronous is forced by the environment, not preferred: the harness runs hooks in a kill-on-close job object that reaps the hook's direct children the moment the hook exits (the watcher itself survives, launched by `Start-Process` via the shell), and powershell.exe never executes under DETACHED_PROCESS, so no detachment escapes it. The wait (~0.5-3s measured) is paid only on the rare stale-and-idle case, once per kit update; the hash check lives in node so the common case costs no process spawn, and failures surface only in `relay.log`.

Timing note: a relay-resumed session fires SessionStart while the watcher is still mid-sequence (between the `/resume` Enter and the continue prompt). `request.txt` is still present in that window, so the busy guard covers exactly this case; the refresh happens on a later, idle session start.

### 3. Doctor -Fix repairs the stale watcher

The stale-watcher hash mismatch (already detected as a structural issue) routes to the same consent-gated re-arm flow the window.txt and watcher-not-running cases already use: under `-Fix`, when no `request.txt` is pending, `Get-Consent` then run the arm script's `-RefreshOnly` mode, re-hash, and report the flip. The script's exit code is read, and the non-success outcomes are named in the report (exit 2: a request arrived during the refresh; exit 3: not armed for refresh; a failed re-hash: the stale WARN is marked unverified) rather than falling through to the generic remediation. A pending request defers with the existing pattern (report, do not disturb). Runs before the round-trip probe so a refreshed watcher is what gets probed, and works under `-NoProbe` too.

### 4. Docs alignment

- kit-doctor SKILL.md: "the doctor only detects" relay line becomes: `-Fix` re-arms a stale, unconfigured, or dead relay (consent-gated, deferred while a request is pending); initial arming and the AHK install stay with `arm-resume-relay.ps1`; an armed relay also self-refreshes at session start.
- doctor.ps1 header comment and the relay section comment updated to match.
- compact-session SKILL.md relay-mode prose is already correct (preflight remains the point-of-use stale check) and is not touched.

## Verification

- `-RefreshOnly` live on this machine (its deployed watcher is genuinely stale): exit 0, deployed hash flips to payload hash, watcher process restarted, `relay.log` line present.
- Busy guard: with a synthetic `request.txt` present, `-RefreshOnly` exits 2 and the watcher PID is untouched.
- Hook: `node relay-refresh.js` with `CLAUDE_PLUGIN_ROOT` pointed at the worktree payload against an artificially staled deploy refreshes it; with matching hashes it spawns nothing.
- Doctor: check-mode run from a cache-shaped staging copy shows the stale WARN; `-Fix -Yes -NoProbe` from the same copy repairs it; re-run shows the flip.

## Related

- Builds on `claude-kit_resume-relay_spec_v1.md` (the original relay: watcher, arm script, request contract; sibling in the archive).

## Chapters

### Chapter 1 (2026-07-16): all sections delivered in one changeset

Commit model: Commit-and-Push on branch `worktree-doctor-crlf-fix` (lands on main via Scott's ff-merge; this session cannot push main).

**Shipped.** All five sections: the docs-write-guard widening for background-session mains plus its regression tests (`test/docs-write-guard.test.js`, the guard's first tests), `-RefreshOnly` in the arm script, the `relay-refresh.js` SessionStart hook with hooks.json wiring, the doctor `-Fix` stale-watcher repair with exit-code-aware reporting, and the docs alignment.

**The design surprise: fire-and-forget from a hook is impossible in this harness.** Empirically established, each with a discriminating test: powershell.exe never executes under DETACHED_PROCESS (a detached spawn writing a marker file produced nothing while a detached cmd.exe wrote its marker); a non-detached child of the hook process is reaped the instant the hook exits (identical spawn succeeded when the parent waited, produced nothing when the parent exited immediately) - the harness runs hook and tool processes in a kill-on-close job object. So the hook runs the refresh synchronously (30s cap; measured ~0.4-3.5s). The watcher itself survives because `Start-Process` launches it via the shell, outside the job: watcher PID 43308, started inside a tool call, was observed alive across many subsequent tool calls.

**Review round (adversarial + blind + security, all findings adjudicated).** Fixed: unqualified `powershell.exe` spawn (security Major, CWE-427: now absolute `%SystemRoot%` path); refresh sequence reordered to kill-then-copy-then-start so an interrupted run leaves the drift hash detectable instead of converging around a stale or dead watcher (blind Critical/Major + adversarial Major - the hash-convergence-as-success gap); missing-shortcut guard so a refresh never silently re-arms a documented disarm (blind Major); last-instant `request.txt` re-check after the slow CIM enumeration (blind Major, adversarial Minor); doctor reads the refresh exit code and names defer/refusal/unverified outcomes (both Minors); hook's duplicated AutoHotkey path list removed, script owns the guard (both Minors); guard regression tests (adversarial Major). Refuted with evidence: the blind Critical's claim that the restarted watcher dies with the hook's job object (the PID 43308 survival above). Accepted, recorded: the `claude`-type FleetView dispatch shares the guard allowance (spec Section 0); AHK path duplication between doctor and arm script predates this change; the residual kill-window between the CIM query and the kill loop is the kill loop itself.

**Verification (all live on the desktop).** Suite: 43 tests, 0 failing (baseline 33, +10 new, no regressions). Live: `-RefreshOnly` refreshes and restarts (exit 0, deployed hash flips to payload, relay.log lines); busy guard defers (exit 2, watcher PID untouched); disarm guard refuses (exit 3, shortcut absent leaves hash, watcher, and Startup folder untouched); hook end-to-end refreshes a staled deploy in ~434ms and no-ops in ~52ms when current; staged cache-shaped doctor `-Fix -Yes -NoProbe` repairs and reports "deployed watcher was stale; refreshed and restarted", exit 0.

**Machine state this session changed (beyond the repo):** the desktop's deployed watcher is now current with this branch's payload and was restarted several times during testing; the plugin cache copy of `docs-write-guard.js` at `39d7397ffede` carries the widened guard (mirrored to unblock this session's spec write; the next plugin update overwrites it with the committed version).

**Next.** None; effort closed. The hook wiring activates machine-wide when the plugin next updates from main.
