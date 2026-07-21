# Relay Fallback-Plane Removal

Status: Complete
Commit Model: Commit-and-Push
Fable Spend: main-thread implementation in the diagnosing Fable session (Scott's standing call for focused kit work; approved 2026-07-21)

## Problem

The resume relay carries a second targeting plane nobody uses and everybody pays
for: when a request has no line-4 `ahk_id`, the watcher falls back to a window
expression from `window.txt` (default `ahk_exe WindowsTerminal.exe`). The plane
predates `capture-window.ps1`; since per-request capture landed, every real
request self-targets (ASR's `processed\` history is uniformly `ahk_id` requests),
and the plane's observable record is exclusively failures and recurring doctor
WARNs (ASR's `window.txt` still names a July 16 window title; every doctor run
since has flagged it).

The plane is also structurally unsound, not merely stale:

- Its only safe semantic is "a designated always-open idle claude REPL in the
  request's repo". Requests are machine-global across repos, so one hand-named
  window cannot satisfy that; a wrong window holding a plain shell would execute
  the typed prompt as commands.
- The hand-maintained title is the same staleness class as the captured hwnd the
  re-resolution work just fixed, with no capture to refresh it and no anchor to
  verify it.
- The sessions it claims to serve do not exist: chain-mode workers resume
  programmatically (no relay), and the windowless hosts (RDP, hidden ConPTY) are
  what capture path 2 already covers by the session's real name. A session whose
  capture fails entirely has no window anyone can safely type into.

## Design

Remove the plane; make its absence loud and honest.

1. **Watcher** (`resume-relay.ahk`): `FALLBACK_WINDOW` and the `window.txt` read
   are deleted. A request without line 4 fails with
   `no target window captured; resume manually with /resume <id>`, through the
   standard retry/archive flow like every other validation failure, so a 3-line
   request remains structurally parseable and lands in `failed\` with that
   reason. Header contract updated.
2. **Arm script** (`arm-resume-relay.ps1`): stops writing the default
   `window.txt`, deletes an existing one on any deploy (arm and -RefreshOnly
   both), and its summary text drops the target line. The relay-refresh
   SessionStart hook thereby cleans deployed machines automatically at the next
   plugin update; ASR's stale file dies without a manual step.
3. **Doctor** (`doctor.ps1`): the `Relay fallback target` check is removed
   outright (all report sites and the 3-line probe), along with the window.txt
   facts that fed it (`$windowConfigured`, `$fallbackExprDisplay`, the
   watcher-start-time snapshot-staleness machinery, the `$windowNote`). The
   attended-path probe and all durable-plane checks stay. A present-but-obsolete
   `window.txt` earns one informational line under `Resume relay` (ignored;
   deleted at next arm or refresh) so the transition is legible. The deletion
   rides the arm script's deploy paths exclusively; the doctor only reports,
   because a consent prompt to delete an inert file is ceremony, and the
   relay-refresh SessionStart hook already triggers a deploy on every armed
   machine at its next plugin update.
4. **Skills**: compact-session SKILL.md relay-mode text replaces both fallback
   references with the honest degradation (capture prints nothing: write no
   request, report the manual `/resume` line); capture-window.ps1 comments
   likewise; kit-doctor SKILL.md drops the `Relay fallback target` plane from
   its check roster.

Out of scope: any change to per-request targeting (line 4 + line-5 anchor,
just shipped), the doctor's attended-path probe, and the failed-request triage
flow. Backward compatibility: a 3-line request from an old writer is still
parsed and fails with a clear reason rather than being typed at a guessed
window; old watchers meeting new writers are unaffected (new writers always
carry line 4 or write nothing).

## Sections of Work

### S1: watcher + arm script + capture comments (main thread)
Gate: AHK v2 /validate exit 0; live-fire on this machine's armed watcher: a
3-line dryrun request fails with the new reason; a 4/5-line request behaves
exactly as the re-resolution matrix already proved.

### S2: doctor surgery (main thread)
Gate: doctor runs clean on this machine (no fallback check in output; obsolete
window.txt note when present; -NoProbe and blocked-probe paths emit no fallback
line).

### S3: skill prose + verification + close-out
Gate: no non-archive references to window.txt or the fallback plane outside the
transition note; reviews (adversarial + blind + security: the changeset touches
the keystroke-targeting code path, so the all-prose waiver does not apply);
Chapter; archive; commit-and-push.

## Chapters

### Chapter 1 - 2026-07-21
Completed: S1 (watcher + arm + capture), S2 (doctor surgery), S3 (prose, verification, reviews, close-out); delivered in this changeset
Implemented By: main session (fable)
Metrics: review rounds 1 (three parallel reviewers); NEEDS_CONTEXT 0; escalations 0; advisor off
Decisions / Surprises: the removal followed an adjudicated disagreement with an ASR doctor-session's "repoint window.txt" recommendation, overturned on evidence (its claim that the reaped failures were fallback-plane cases was false for the newest one, a captured-hwnd failure; the fallback's only safe semantic, a per-repo idle claude REPL behind one machine-global hand-named window, is unsatisfiable; the sessions it claims to serve resume programmatically or are covered by capture path 2). Verdicts: security CLEAR (4 Minor), blind APPROVED_WITH_CONCERNS (2 Major, 4 Minor), adversarial CHANGES_REQUIRED (3 Major, 3 Minor), heavily overlapping. All contract-text drift fixed (the writer prose and watcher header now say four or five lines with line 4 mandatory; a legacy 3-line shape parses but fails with the no-target reason). Spec deviation recorded and amended in place: the doctor only reports an obsolete window.txt and the deletion rides the arm script's deploy paths exclusively (a consent prompt to delete an inert file is ceremony; relay-refresh triggers the deploy on every armed machine at its next plugin update). Blind's silent-stall Major (a windowless session now leaves no failed\ breadcrumb) was accepted as observation and declined as machinery: a leashed run cannot stall silently (no relay handoff means the kit-goal Stop hook holds the session, which continues uncompacted per step 8), the windowless-unattended-interactive shape has no observed instance, and the residual is now named inside the existing "no context ceiling" backlog item rather than in a new marker channel. Also declined: short-circuiting deterministic validation failures straight to failed\ (retry parity with sibling validation failures is deliberate). "Fails fast" comments reworded to match the actual retry-then-archive behavior. Two backlog items retired with receipts (ASR relay armed and carrying production resumes 2026-07-18 through 07-21; engine-compact plus relay-resume exercised end to end by the same runs).
Review Findings: 5 distinct Majors and 8 Minors addressed or adjudicated as above; none open.
Compaction: check not run: bun present on this machine but not on PATH (doctor names the fix), engine cannot run from this session; relay armed (Test-Path True); action: none (interactive session, user-typed message within the current section).
Next: none (gate evidence: AHK /validate 0; doctor.ps1 and arm-resume-relay.ps1 parse 0 errors; node suite 121 pass / 0 fail unchanged; live-fire on this machine's armed watcher: 3-line dryrun logs the no-target reason with the manual /resume line, 4-line dead-hwnd logs the classic not-found, deploy deleted the machine's window.txt, and a real doctor run shows Resume relay PASS and Relay attended path INFO with no fallback line; deployed watcher restored to the installed payload after testing)
Commit Model: Commit-and-Push
