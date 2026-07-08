# Resume Relay: Unattended /resume for Compacted Sessions

Status: Complete
Commit Model: Review-Only
Fable Spend: session-led (small effort, built in the Fable session that designed it)
Created: 2026-07-08

## Goal

Compact-session's interactive mode keeps long runs on subscription billing, but its one human step (typing `/resume <id>` after a boundary compaction) stalls unattended runs. This effort arms the workstation to perform that step itself: at a compaction boundary, the session writes a request file; a resident AutoHotkey watcher validates it and types `/resume <id>` plus the continue prompt into the Claude desktop window. Chosen over process-launch relay (`claude --resume <id>` in a new terminal) deliberately: typing into the existing window keeps the session inside the desktop app, which is what the phone remote-control surface mirrors. Decided 2026-07-08.

## Environment facts (verified 2026-07-08)

- Claude desktop app: process `claude.exe`, main window title `Claude`. The VM is session-dedicated with a minimal window population, which is what makes keystroke relay acceptable.
- AutoHotkey not yet installed; winget package `AutoHotkey.AutoHotkey` (v2). Installing it is part of Section 2's arm step; rollback is `winget uninstall AutoHotkey.AutoHotkey`.

## Design

- **Handshake:** the session (Claude, at a compact-session boundary) writes `%LOCALAPPDATA%\claude-kit\resume-relay\request.txt`, exactly three UTF-8 lines: the session UUID, the absolute transcript path, and a single-line continue prompt. Plain lines instead of JSON because AutoHotkey v2 has no native JSON parser and both sides of the contract are authored here; no escaping surface at all. The watcher polls every 10 seconds. The request is written as the turn's final action, so the target window is idle when the relay fires.
- **Validation before any keystroke:** sessionId matches the UUID shape; `transcriptPath` exists on disk and its filename matches the sessionId; the target window exists (`Claude` + `ahk_exe claude.exe`). Any failure logs and leaves the request for retry; three failed attempts move it to `failed\`.
- **Typing sequence:** activate window, wait active, `SendText "/resume <id>"`, Enter, settle delay for session load, `SendText <prompt>`, Enter. Every action appends to `relay.log`. Successful requests archive to `processed\<timestamp>-<tag>.txt`. Once typing has begun, a lost window is a hard failure straight to `failed\` (a retry would re-type `/resume` into the already-resumed session), and a request that was typed but could not be archived is remembered by content and re-archived, never re-typed.
- **Armed = the relay directory exists.** The compact-session skill checks for it: armed writes the request file (manual `/resume` line still reported as fallback); not armed keeps today's manual handoff. Disarm by removing the startup shortcut.
- **Known-unknown for live fire:** whether Enter after a typed `/resume <uuid>` executes the command directly or interacts with the slash-autocomplete menu. The live-fire test tunes this one axis (settle delays, possible menu dismissal).
- **Security posture:** the request directory is user-profile-local; the watcher never executes request content as commands (the only Send payloads are the fixed `/resume ` prefix, the validated UUID, and the prompt text typed as literal text); all actions logged. Anything that can write the request file can start a session turn, which on this single-user VM is the accepted trust boundary.

## Sections of Work

### 1. Relay watcher and arm script
Model: fable (inline; small, design-entangled with the live environment)
`plugins/claude-kit/skills/compact-session/relay/resume-relay.ahk` (AHK v2 watcher per the design) and `relay/arm-resume-relay.ps1` (installs AutoHotkey via winget if absent, creates the relay directory tree, installs a Startup-folder shortcut running the watcher, prints disarm instructions). A flag file `dryrun.on` in the relay directory makes the watcher do everything except focus and type, for validation without keystrokes. The arm script copies the watcher into the relay directory and points the Startup shortcut at the copy, because the plugin cache path changes per kit version; re-arming refreshes the copy after a kit update.
Acceptance: dry-run cycle proves the pipeline (request written, validated, logged, archived) without touching the window; invalid requests (bad uuid, missing transcript) go to `failed\` after three attempts with log evidence.

### 2. Skill integration
Model: fable (behavior-shaping prose)
compact-session SKILL.md: a Relay mode paragraph in the interactive-mode section: after a successful boundary compaction, if the relay directory exists, write `request.txt` (three-line schema above, single-line prompt naming the plan doc) and end the turn reporting the relay handoff plus the manual fallback line. Executing-work step 8's interactive no-op rule gets one clause: with the relay armed, the compaction point is not a stop, because the relay performs the resume.
Acceptance: skill wording consistent with the completion contract; no em dashes; the request schema in the skill matches the watcher's validation exactly.

### 3. Live fire (supervised, CLI environment)
Model: fable (inline)
On the mini-sandbox terminal running Claude Code CLI, with Scott present: arm, write `window.txt` with the terminal's WinTitle expression, compact a scratch session, watch the relay type the resume into the CLI, verify the CLI lands in the compacted session and the continue prompt starts a turn, then tune the failing axis if any (delays, slash-menu handling, window expression). Verify phone visibility of the post-relay session state.
The Desktop app is NOT a viable target (attempted 2026-07-08): it has no `/resume` command, its session registry does not include transcript files directly, and its `send_message` session tool requires per-message user confirmation, so no unattended Desktop resume path exists. The watcher now requires an explicit `window.txt` target and refuses to type otherwise.
Acceptance: one full unattended cycle (request file to running next turn) observed end to end in the CLI; the tuning knob and its file recorded in the Chapter.

## Related

- `../archive/claude-kit_compact-session_spec_v1.md`: the engine and modes this relay completes; its billing-contingency note is the reason interactive mode is the mode worth automating.

## Chapters

### Chapter 1 - 2026-07-08
Completed: Section 1, relay watcher and arm script
Implemented By: main session
Decisions / Surprises: request format finalized as three plain UTF-8 lines (no JSON; AutoHotkey v2 has no native parser and both sides are kit-authored). Dry-run switched from a config.json to a `dryrun.on` flag file. winget installed AutoHotkey per-user (`%LOCALAPPDATA%\Programs\AutoHotkey\v2\`), not Program Files; the arm script probes both locations. AutoHotkey v2 installed on this machine as part of the build (rollback: `winget uninstall AutoHotkey.AutoHotkey`). Dry-run gate ran live and green: valid request validated/logged/archived to `processed\`; bad-uuid and missing-transcript requests each moved to `failed\` after exactly 3 attempts with per-attempt log lines. Test watcher stopped and the relay directory removed afterward, so the machine reads unarmed until the supervised live fire.
Review Findings: combined review dispatched over Sections 1-2 together (small changeset, one session).
Next: Section 2
Commit Model: Review-Only

### Chapter 2 - 2026-07-08
Completed: Section 2, skill integration
Implemented By: main session
Decisions / Surprises: relay mode landed as a third mode paragraph in compact-session (armed = relay directory exists; request written as the turn's final action; manual line always reported as fallback; failed relay degrades exactly to manual mode). The executing-work step-8 exception states that with the relay armed, a boundary compaction plus relay request is a valid mid-plan turn end because the relayed prompt continues the plan, keeping the completion contract intact via the plan doc.
Review Findings: combined adversarial review over Sections 1-2 returned 1 Critical, 4 Majors, 9 Minors; all fixed except one accepted Minor. Critical (unguarded 6-second focus gap then a false "done" archive): fixed with focus re-verification before every keystroke group and a hard-fail-to-failed path once typing has begun, never a retry. Majors: spec's `request.json` drift corrected to `request.txt`; archive-failure re-typing loop closed with a delete fallback plus handled-content memory that re-archives instead of re-typing; attempt counting keyed to request content so a new request never inherits a dead one's failures; the arm script's process filter moved to CIM because Windows PowerShell 5.1 exposes no CommandLine property (the original filter was silently dead code). Minors fixed: exact filename match via SplitPath, window-existence check moved ahead of the dry-run branch, timer reentrancy guard, atomic request write (tmp then mv) in the skill, spec archive-name drift, empty-catch comment, and the "final action" wording softened to match streaming reality. Accepted Minor: default substring title matching, per the spec's dedicated-VM risk posture; pinning with SetTitleMatchMode 3 is a live-fire knob if ambiguity appears. Dry-run gate re-run green against the rewritten watcher (valid request processed; malformed request to failed after exactly 3 attempts).
Next: Section 3, supervised live fire (requires Scott present)
Commit Model: Review-Only

### Chapter 3 (partial) - 2026-07-08
Completed: live-fire attempt in the Desktop environment; environment findings folded into design. Section 3 remains open for the CLI sandbox.
Implemented By: main session, live with Scott
Decisions / Surprises:
- The Claude Desktop app has no `/resume` command ("/resume isn't available in this environment", typed live by Scott). Desktop session switching is UI-native only, so the typing relay is a CLI-only mechanism. The production target (mini-sandbox terminal running the CLI) is unaffected.
- Desktop's session tools are not an alternative: `list_sessions` does not see transcript files (a full session copy in the projects directory was invisible), and `send_message` requires per-message user confirmation by design, so no unattended Desktop resume path exists at all.
- The relay's fail-safes passed an unplanned real-world test: the first live request carried an unexpanded shell variable in its transcript path (orchestrator's write bug), and the watcher rejected it three times to `failed\` without typing a single key.
- Design hardened accordingly: the window target is now an explicit `window.txt` (AHK WinTitle expression, read at watcher startup) with NO default; unconfigured, the watcher refuses to type and fails requests with a clear log line. Arm script and SKILL.md updated; the compact-session interactive mode now carries the CLI-only caveat, with the `claude --resume <id>` CLI line as the Desktop-hosted alternative.
- Relay disarmed on this machine (shortcut removed, watcher stopped, relay directory deleted) until it is armed against the CLI sandbox terminal with a real `window.txt`.
- Dry-run gate re-run green after the changes: unconfigured target refused 3x to `failed\`; configured target processed a valid request through the dry-run path.
Review Findings: none this round (environment findings, not code review).
Next: Section 3 live fire on the CLI sandbox terminal; then finishing pass.
Commit Model: Review-Only

### Chapter 4 - 2026-07-08
Completed: Section 3, live fire on the CLI sandbox terminal; effort Complete
Implemented By: main session, live with Scott (who armed the watcher, deployed the patched copy, and drove the firing between turns)
Decisions / Surprises:
- Full unattended cycle observed end to end and self-evidencing: the relay validated the request, focused the Windows Terminal, typed `/resume 2f5494be-...`, the CLI switched into that session, the typed continue prompt landed there, and the model replied exactly RELAYED. The close-out Chapters of this very plan are being written inside the relay-resumed session; transcript timestamps confirm the resumed transcript is the one growing.
- In-session `/resume <id>` in the CLI switches sessions cleanly, so the relay works against a terminal showing an active session, which is the exact production shape (a run ends its turn after compacting, then the relay moves the terminal into the compacted successor).
- Default timings needed no tuning: MENU_SETTLE_MS 800 and SESSION_LOAD_MS 6000 carried the sequence (log span resuming-to-typed was 8 seconds), and Enter after the typed `/resume <uuid>` executed the command directly with no slash-menu interference.
- The fail-safes went 3 for 3 across the effort's live attempts, each against a real malformed request (an unexpanded shell variable twice, a forward-slash path once), each refused with logged attempts and zero keystrokes. The content-keyed attempt counter also proved out live: a malformed request was overwritten mid-failure-cycle and the corrected request succeeded on its next poll with a fresh count.
- The forward-slash rejection led to a tolerance patch (separator normalization before the filename check), deployed and validated in the successful firing, whose request carried a forward-slash path.
- Finishing-pass judgment call: the Section 1-2 adversarial review already scrutinized this changeset's security surface (wrong-window typing, request-content injection, trust boundary), so no separate security pass was manufactured for ~250 lines of reviewed script; recorded here as the deliberate call.
- Resting state: the relay is ARMED on the sandbox VM (watcher running, Startup shortcut installed, window.txt targeting `ahk_exe WindowsTerminal.exe`). Known sharp edge, accepted for a dedicated VM: that expression matches any Windows Terminal window, so multiple open terminals would make the target ambiguous; pinning by title is the knob if that day comes.
Review Findings: Sections 1-2 review previously adjudicated (Chapter 2 update); no new findings this round.
Next: none; archived via curating-docs in this close-out. Delivered in this changeset, staged for review under Review-Only.
Commit Model: Review-Only
