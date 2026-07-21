# Relay Re-Resolution

Status: Complete
Commit Model: Commit-and-Push
Fable Spend: main-thread implementation in the diagnosing Fable session (Scott's standing call for focused kit work, reaffirmed 2026-07-20)

## Problem

The resume relay targets a window by captured hwnd (`ahk_id <n>`, request line 4),
captured at the section boundary BEFORE compaction. The compaction sits between
capture and the watcher's typing, so the handle is minutes old at fire time, and a
hwnd is a bare pointer: any window churn in that gap strands the relay. Observed
live (ASR, 2026-07-21 00:32-00:35 local): capture returned `ahk_id 1378556`,
Scott's tab-drag habit (the `+` button then dragging the tab out, which mints a new
top-level window and destroys the old one when its last tab leaves) recreated the
hosting window in the three-minute gap, and the relay failed three polls with
"target window not found: ahk_id 1378556" while the session's window sat alive
under a new handle. The soft-fail machinery worked as designed (request archived to
`failed\`, surfaced by the session-start nudge, manual resume lost only minutes),
but the failure was avoidable: the window was findable by title the whole time.

Virtual desktops were investigated and exonerated: cloaked windows remain fully
enumerable to Win32/AHK; only activation needs a desktop switch. The failure class
is handle churn, not visibility.

## Design

**Title re-resolution at fire time.** The moment of truth moves from capture time
to typing time, which collapses the race entirely and makes capture-ordering
changes unnecessary:

1. **Request contract v2 (backward compatible).** An optional fifth line carries
   the session's window-title anchor: the session name that
   `capture-window.ps1 -NameOnly` prints (the same name path 2 of the capture
   already matches on). 3- and 4-line requests remain valid and behave exactly as
   today; line 5 is only accepted on a 5-line request whose line 4 is ahk_id-shaped.
2. **Watcher verification and re-resolution.** With an anchor present, the
   captured hwnd is checked both directions at fire time. A hwnd that resolves to
   its window is verified: the window's title must still carry the anchor
   (ordinal match) and not `[UNCOMPACTED]`, because tab churn can leave the old
   window alive showing a different session (the drag source survives when other
   tabs remain). A dead hwnd, or a live-but-stale one, drives one re-resolution
   repeating the capture's own match: enumerate `ahk_exe WindowsTerminal.exe`
   windows, keep those whose title contains the anchor (ordinal, mirroring the
   capture's .NET `Contains`) and not `[UNCOMPACTED]`, and require exactly one.
   One match rebinds the target (logged); zero or several fall through to the
   Fail/retry path with the match count in the log for triage. Verification and
   re-resolution apply only before typing: once typing has begun, a lost window
   stays a hard failure (re-typing `/resume` into a re-resolved window would
   double-type). Window matching runs under an explicit
   `DetectHiddenWindows(false)` pin.
3. **Unfit anchors are dropped, never fatal.** The line-5 name steers which
   window receives keystrokes, so an unfit one (trimmed length outside 4..120,
   control characters C0/DEL/C1, no alphanumeric, the `[UNCOMPACTED]` tag, or
   the generic `Claude Code` that capture's own matcher refuses) is logged and
   dropped, and the request proceeds on its hwnd alone: a cosmetic line-5 defect
   must never strand a request whose line 4 names a live, correct window.
   Non-ASCII printable characters are allowed (session names may be Unicode);
   the spec's original printable-ASCII wording was deliberately relaxed to
   no-control-characters for that reason. The trust boundary is unchanged by
   design: writing `request.txt` already requires shell execution on the
   machine, so the anchor grants a hostile producer nothing it lacks; the guards
   (exactly-one, process filter, ordinal match, fitness checks) exist to prevent
   operational mistakes, not to sandbox a local adversary.
4. **Writers add the line.** The compact-session relay-mode flow captures the name
   alongside the hwnd (`capture-window.ps1 -NameOnly <source-transcript>`, before
   compaction for the same relabel reason as the hwnd capture) and writes it as
   line 5 when both are available. No line 4 means no line 5, and the writer
   omits an unfit name (empty, outside 4..120, or the generic `Claude Code`) as
   the first line of defense before the watcher's own drop. `-NameOnly` flattens
   embedded newlines to spaces at print time so a pathological session name
   cannot shift the request's line structure.

Out of scope: activation hardening (the "did not activate" flavor; the
all-desktops window pin is the documented user-side answer), hwnd-reuse collisions
(a recycled handle in the gap is undetectable at this layer and vanishingly rare),
Desktop-app support (unchanged: CLI-only), and any change to capture ordering
(re-resolution at fire time supersedes gap-narrowing).

Non-transcript consumers checked: `kit-goal-stop.js` reads line 1 and substring-
matches the plan path across the whole body (5-line request unaffected);
`session-start.js` only counts `failed\` entries; the doctor's dryrun probes write
3/4-line requests, which remain valid.

## Sections of Work

### S1: watcher contract v2 + re-resolution (main thread)
- `plugins/claude-kit/skills/compact-session/relay/resume-relay.ahk`: accept 5-line
  requests, validate line 5, re-resolve on not-found, log both outcomes; header
  contract updated.
- Gate: AHK v2 syntax check; local live-fire on this machine's armed watcher via
  the repo's `arm-resume-relay.ps1 -RefreshOnly`, using `[doctor-dryrun]` requests
  (the dryrun check sits after window resolution, so a dead-hwnd + real-name
  request exercises re-resolution end to end without typing).

### S2: writer + contract docs (main thread)
- `plugins/claude-kit/skills/compact-session/SKILL.md`: relay-mode flow writes the
  fifth line; request contract text updated; a one-line churn warning (moving a
  tab to a new window mints a new handle) beside the existing one-session-per-
  window rule.
- Gate: prose consistency grep (the contract is stated in the skill and the
  watcher header only).

### S3: verification + close-out
- Live-fire matrix on this machine: valid 5-line dryrun with dead hwnd + real name
  (re-resolves), dead hwnd + garbage name (fails), 4-line dead hwnd (fails as
  today), 4-line live hwnd (unchanged happy path).
- Adversarial + blind + security reviews (the change hands a free-form string
  partial control over which window receives keystrokes; security review is
  mandatory, not optional).
- Restore the deployed watcher to the committed payload state; Chapter; archive.

## Chapters

### Chapter 1 - 2026-07-21
Completed: S1 (watcher contract v2 + verification + re-resolution), S2 (writer flow + contract docs), S3 (live-fire verification, reviews, close-out); delivered in this changeset
Implemented By: main session (fable; keyboard-adjacent logic designed in contact with the live watcher, per the header's Fable Spend note)
Metrics: review rounds 1 (three parallel reviewers); NEEDS_CONTEXT 0; escalations 0; advisor off
Decisions / Surprises: root cause was confirmed from the ASR transcripts before design (relay.log captured in the failing session shows "target window not found: ahk_id 1378556" x3, with the predecessor's captures consistently returning the window that worked); Scott confirmed the churn source, a tab dragged out of an existing window. Verdicts: blind CHANGES_REQUIRED (3 Major), security CONCERNS (2 Major, 2 Minor), adversarial CHANGES_REQUIRED (4 Major, 2 Minor), with heavy overlap. The defining review outcome: the original design only re-resolved a DEAD hwnd, and the blind reviewer proved the worse case is a hwnd left alive showing a different session (a drag from a multi-tab window), so the anchor was upgraded from fallback to fire-time verification on every anchored request. Other accepted fixes: unfit anchors (length, control chars C0/DEL/C1, no alphanumeric, "[UNCOMPACTED]", generic "Claude Code") are dropped with a log line instead of failing a request whose hwnd is valid; both InStr calls are ordinal case-sensitive, mirroring capture's .NET Contains (the case-insensitive default was confirmed by live execution during review); ResolveByName reports its match count for triage; DetectHiddenWindows(false) is pinned explicitly; -NameOnly flattens embedded newlines so a pathological name cannot shift the request's line structure; the spec's printable-ASCII anchor wording was relaxed to no-control-characters so Unicode session names are not false-rejected, recorded as a deliberate deviation. Declined with reason: the security reviewer's anchor-shape/prefix redesign against a prompt-injected producer, because writing request.txt already requires shell execution on the machine, so steering typed keystrokes grants a hostile producer nothing it lacks; the guards target operational mistakes, and the trust-model paragraph now lives in the spec's Design section.
Review Findings: 6 distinct Majors addressed (several double-reported across reviewers); 4 Minors addressed; 1 Major-class redesign declined with the trust-model rationale above; Unicode-normalization availability note recorded, no action.
Compaction: check not run: bun not installed on this machine, engine cannot run; relay armed (Test-Path True); action: none (interactive session, user-typed message within the current section).
Next: none (gate evidence: AHK v2 /validate exit 0; node suite 121 pass / 0 fail, unchanged from the prior commit's baseline; live-fire matrix on this machine's armed watcher, all dryrun-marked: live hwnd + matching anchor proceeds, live hwnd + wrong anchor refused as stale with match count 0, dead hwnd + unfit anchor drops the anchor and fails classic, dead hwnd + matching anchor re-resolves and proceeds, 3-char anchor and garbage anchor and 4-line regression covered in the first round; deployed watcher restored to the installed payload after testing)
Commit Model: Commit-and-Push
