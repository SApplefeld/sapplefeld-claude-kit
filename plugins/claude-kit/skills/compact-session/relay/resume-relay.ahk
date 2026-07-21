#Requires AutoHotkey v2.0
#SingleInstance Force
Persistent

; Resume relay: watches for a request file written by a compact-session
; boundary and types "/resume <id>" plus the continue prompt into the Claude
; desktop window, so an unattended run continues without a human at the keys.
;
; Request contract (request.txt, four or five UTF-8 lines; a legacy 3-line
; shape still parses but always fails with the no-target reason):
;   line 1: session UUID
;   line 2: absolute transcript path (filename must be "<uuid>.jsonl")
;   line 3: single-line continue prompt
;   line 4: target window as "ahk_id <hwnd>", the requesting session's own
;           window. Mandatory: there is no fallback plane, so a request
;           without it fails through the standard retry/archive flow and the
;           manual /resume line the writer reports is the recovery
;   line 5: optional window-title anchor (the session name), accepted only when
;           line 4 is present. A captured hwnd is minutes old by typing time and
;           window churn in that gap (a tab dragged out to a new window) leaves
;           it dead, or worse, alive but showing a different session. With an
;           anchor present the watcher verifies at fire time that the target
;           window's title still carries it (ordinal match, as the capture's
;           own matcher), and a dead or stale hwnd is re-resolved by name:
;           exactly one visible WindowsTerminal.exe window whose title contains
;           the anchor and not "[UNCOMPACTED]". Zero or several matches fail
;           the request exactly as a bare not-found does. An unfit anchor
;           (wrong length, control characters, no alphanumerics, the generic
;           "Claude Code") is dropped with a log line and the request proceeds
;           on its hwnd alone: a cosmetic line-5 defect must never strand a
;           request whose line 4 still names a live, correct window.
;
; A "dryrun.on" flag file in the relay directory validates and logs without
; focusing or typing. The only text ever sent to the window is the fixed
; "/resume " prefix, the UUID (validated by shape), and the prompt as literal
; text via SendText; request content is never executed as commands.
;
; Failure disposition: validation and pre-typing failures retry up to
; MAX_ATTEMPTS polls, then the request moves to failed\. Once typing has
; begun, a lost window is a hard failure straight to failed\ (a retry would
; re-type "/resume" into the already-resumed session). A request that was
; typed but could not be archived is remembered by content and re-archived,
; never re-typed.

RELAY_DIR := EnvGet("LOCALAPPDATA") "\claude-kit\resume-relay"
REQUEST_FILE := RELAY_DIR "\request.txt"
LOG_FILE := RELAY_DIR "\relay.log"
PROCESSED_DIR := RELAY_DIR "\processed"
FAILED_DIR := RELAY_DIR "\failed"
DRYRUN_FLAG := RELAY_DIR "\dryrun.on"
; A request whose prompt line starts with this token is a diagnostic probe:
; validate and log it, never type it. The marker rides inside the request, so
; the decision is atomic with the read; ambient flag state (dryrun.on) cannot
; express per-request intent and its lifetime races the poll (a doctor probe
; escaped containment exactly that way on 2026-07-15 and typed into a live
; session).
DRYRUN_MARKER := "[doctor-dryrun]"

; Each request names the exact window to type into (line 4, an "ahk_id <hwnd>"
; expression the requesting session captured for its own terminal), so
; concurrent sessions in separate windows each resume into their own. There is
; no fallback plane: a request without line 4 fails like any validation error
; (retried, then archived to failed\), because no window a hand-maintained
; expression could name is safe to type into (requests are machine-global
; across repos, and a wrong window holding a shell would execute the typed
; prompt), and the honest degradation is the manual /resume line the
; relay-mode flow reports at every boundary anyway. The Desktop app is never a
; valid target: the /resume slash command does not exist there.
POLL_INTERVAL_MS := 10000
MAX_ATTEMPTS := 3
UUID_PATTERN := "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"

; Settle delays around the typing sequence. SESSION_LOAD_MS is the tunable
; knob if the live-fire test shows the resumed session needs longer to load
; before the continue prompt lands.
MENU_SETTLE_MS := 800
SESSION_LOAD_MS := 6000

DirCreate(PROCESSED_DIR)
DirCreate(FAILED_DIR)

; Attempt tracking is keyed to the request's content so a new request never
; inherits a dead request's failure count. handledContent/handledDir remember
; a request that was already typed (or hard-failed) but whose archive move
; failed, so it is re-archived on later polls instead of re-typed.
attemptCount := 0
attemptKey := ""
handledContent := ""
handledDir := ""
handledTag := ""

; Self-heal a dry-run flag orphaned by a doctor probe that was killed mid-run.
; The probe stamps its flag "doctor-probe <ISO-8601 local timestamp>"; such a
; flag older than 10 minutes is stale and removed so it cannot silently disarm
; the relay. A user-created flag (any other content) is never touched.
if FileExist(DRYRUN_FLAG) {
    probeFlag := ""
    try probeFlag := Trim(FileRead(DRYRUN_FLAG, "UTF-8"), " `t`r`n")
    if (SubStr(probeFlag, 1, 12) = "doctor-probe") {
        stamp := RegExReplace(SubStr(probeFlag, 13), "[^0-9]", "")
        if (StrLen(stamp) >= 14 && DateDiff(A_Now, SubStr(stamp, 1, 14), "Minutes") >= 10) {
            try {
                FileDelete(DRYRUN_FLAG)
                Log("self-heal: removed stale doctor-probe dryrun.on")
            }
        }
    }
}

; Window matching (WinGetList, WinGetTitle, ResolveByName's enumeration) sees
; visible windows only. That is AHK's default, pinned here so the visibility
; filter is a stated invariant of the keystroke-targeting logic rather than an
; inherited setting.
DetectHiddenWindows(false)

Log("watcher started, polling every " POLL_INTERVAL_MS // 1000 "s")
SetTimer(Poll, POLL_INTERVAL_MS)

Poll() {
    ; The live typing sequence can outlast the poll interval; never re-enter.
    static busy := false
    if busy
        return
    busy := true
    try {
        ProcessRequest()
    } finally {
        busy := false
    }
}

ProcessRequest() {
    global attemptCount, attemptKey, handledContent, handledDir, handledTag
    if !FileExist(REQUEST_FILE)
        return

    try {
        raw := FileRead(REQUEST_FILE, "UTF-8")
    } catch as err {
        Log("ERROR reading request: " err.Message)
        return
    }

    if (handledContent != "" && raw = handledContent) {
        Log("re-archiving previously handled request")
        Archive(handledDir, handledTag)
        return
    }

    if (raw != attemptKey) {
        attemptKey := raw
        attemptCount := 0
    }

    lines := StrSplit(Trim(raw, " `t`r`n"), "`n")
    if (lines.Length < 3 || lines.Length > 5) {
        Fail("request must be 3 to 5 lines, got " lines.Length)
        return
    }

    sessionId := Trim(lines[1], " `t`r")
    ; Normalize separators: SplitPath only splits on backslashes, and request
    ; writers on this machine produce forward-slash paths from Unix-style
    ; shells (a valid request can be rejected for exactly this).
    transcriptPath := StrReplace(Trim(lines[2], " `t`r"), "/", "\")
    prompt := Trim(lines[3], " `t`r")

    if !RegExMatch(sessionId, "i)" UUID_PATTERN) {
        Fail("invalid session id shape: " sessionId)
        return
    }
    if !FileExist(transcriptPath) {
        Fail("transcript not found: " transcriptPath)
        return
    }
    SplitPath(transcriptPath, &transcriptName)
    if (transcriptName != sessionId ".jsonl") {
        Fail("transcript filename does not match session id: " transcriptName)
        return
    }
    if prompt = "" {
        Fail("empty continue prompt")
        return
    }
    ; Line 4 is the requesting session's own captured window ("ahk_id <hwnd>"),
    ; so concurrent sessions each resume into their own window. Only that exact
    ; shape is accepted: the sole producer is capture-window.ps1, so anything
    ; else is a malformed request, not a free-form WinTitle to trust at the
    ; keyboard. A request without line 4 fails through the standard retry and
    ; archive flow (there is no fallback window); the writer's reported manual
    ; /resume line is the recovery.
    ; Line 5 (the name anchor) is only accepted riding on a line-4 request, and
    ; its own shape is validated before it can steer anything: 4..120 chars
    ; trimmed, no control characters, and never the "[UNCOMPACTED]" tag (that
    ; marks the stale transcript, so a name carrying it could only match the
    ; wrong window).
    nameAnchor := ""
    if (lines.Length < 4) {
        Fail("no target window captured (request has no ahk_id line); resume manually with /resume " sessionId)
        return
    }
    requestedTarget := Trim(lines[4], " `t`r")
    if !RegExMatch(requestedTarget, "^ahk_id \d+$") {
        Fail("malformed target window on line 4: " requestedTarget)
        return
    }
    target := requestedTarget
    if (lines.Length = 5) {
        candidate := Trim(lines[5], " `t`r")
        ; An unfit anchor is dropped, never fatal: line 4 still names a
        ; checkable window, and a request that would relay fine on its hwnd
        ; must not three-strike to failed\ over a cosmetic line-5 defect.
        ; Dropped means no fire-time verification and no re-resolution. Fit:
        ; trimmed length 4..120, no control characters (C0, DEL, C1), at
        ; least one alphanumeric, never the "[UNCOMPACTED]" tag, and never
        ; the generic "Claude Code" (capture's own matcher refuses to match
        ; on it, so honoring it here could only select a wrong window).
        if (StrLen(candidate) >= 4 && StrLen(candidate) <= 120
            && !RegExMatch(candidate, "[\x00-\x1F\x7F-\x9F]")
            && RegExMatch(candidate, "[A-Za-z0-9]")
            && !InStr(candidate, "[UNCOMPACTED]", true)
            && candidate != "Claude Code") {
            nameAnchor := candidate
        } else {
            Log("dropping unfit name anchor on line 5; proceeding on the hwnd alone")
        }
    }
    ; The target must resolve to exactly one window: an ahk_id names one window
    ; (or none, if it has since closed), and typing anywhere else would deliver
    ; the resume to the wrong session, so refuse and let the retry flow surface
    ; it. The anchor is a fire-time check on the captured hwnd, both directions:
    ; window churn in the capture-to-typing gap (a tab dragged out to a new
    ; window) can leave the handle dead, or alive but showing a different
    ; session (the drag source survives when other tabs remain), so a live
    ; hwnd whose title no longer carries the anchor is treated exactly like a
    ; vanished one. Either way the anchor drives one re-resolution repeating
    ; the capture's own match (visible WindowsTerminal.exe windows, ordinal
    ; title-contains, never the "[UNCOMPACTED]" tag), rebinding only on
    ; exactly one hit; zero or several fall through to the same Fail/retry
    ; path as a bare not-found, with the match count logged for triage.
    matchedWindows := WinGetList(target)
    staleReason := ""
    if (nameAnchor != "" && matchedWindows.Length = 1) {
        liveTitle := ""
        try liveTitle := WinGetTitle("ahk_id " matchedWindows[1])
        if (!InStr(liveTitle, nameAnchor, true) || InStr(liveTitle, "[UNCOMPACTED]", true)) {
            staleReason := "hwnd alive but its title no longer carries the anchor"
            matchedWindows := []
        }
    }
    if (matchedWindows.Length = 0 && nameAnchor != "") {
        matchCount := 0
        resolved := ResolveByName(nameAnchor, &matchCount)
        if (resolved != 0) {
            Log("re-resolved " target " (" (staleReason != "" ? staleReason : "window gone") ") by name to ahk_id " resolved)
            target := "ahk_id " resolved
            matchedWindows := WinGetList(target)
        } else {
            Fail("target window unusable: " target " (" (staleReason != "" ? staleReason : "not found") "); name re-resolution matched " matchCount " windows")
            return
        }
    }
    if (matchedWindows.Length = 0) {
        Fail("target window not found: " target)
        return
    }
    if (matchedWindows.Length != 1) {
        Fail("target window expression matches " matchedWindows.Length " windows; refusing to type")
        return
    }

    if (FileExist(DRYRUN_FLAG) || InStr(prompt, DRYRUN_MARKER) = 1) {
        Log("DRYRUN: would resume " sessionId " and send prompt (" StrLen(prompt) " chars)")
        MarkHandled(raw, PROCESSED_DIR, "dryrun")
        Archive(PROCESSED_DIR, "dryrun")
        return
    }

    Log("resuming " sessionId " at " target)
    if !EnsureActive(target) {
        Fail("Claude window did not activate")
        return
    }

    SendText("/resume " sessionId)
    ; Typing has begun: from here every keystroke group re-verifies focus and
    ; a lost window is a hard failure, never a retry.
    Sleep(MENU_SETTLE_MS)
    if !EnsureActive(target) {
        HardFail(raw, "focus lost after typing /resume; run /resume " sessionId " manually")
        return
    }
    Send("{Enter}")
    Sleep(SESSION_LOAD_MS)
    if !EnsureActive(target) {
        HardFail(raw, "focus lost before continue prompt; session " sessionId " resumed but prompt not sent")
        return
    }
    SendText(prompt)
    Sleep(500)
    if !EnsureActive(target) {
        HardFail(raw, "focus lost before final Enter; prompt typed but not submitted")
        return
    }
    Send("{Enter}")

    Log("typed resume + prompt for " sessionId)
    MarkHandled(raw, PROCESSED_DIR, "done")
    Archive(PROCESSED_DIR, "done")
}

EnsureActive(target) {
    if WinActive(target)
        return true
    if !WinExist(target)
        return false
    WinActivate(target)
    return WinWaitActive(target, , 5) != 0
}

; Fire-time re-resolution of a dead or stale captured hwnd: the hwnd of the
; one visible WindowsTerminal.exe window whose title contains the name anchor
; and does not carry the "[UNCOMPACTED]" tag, or 0 when zero or several match
; (the caller fails rather than guesses; typing into a maybe-window is never
; acceptable). matchCount reports how many matched, so a failed relay's log
; distinguishes window-gone from name-ambiguous. Both InStr calls are ordinal
; case-sensitive to mirror capture-window.ps1's .NET Contains, so capture and
; re-resolution agree on what "this session's window" means.
ResolveByName(nameAnchor, &matchCount) {
    matchCount := 0
    hit := 0
    for hwnd in WinGetList("ahk_exe WindowsTerminal.exe") {
        title := ""
        try title := WinGetTitle("ahk_id " hwnd)
        if (title = "" || !InStr(title, nameAnchor, true) || InStr(title, "[UNCOMPACTED]", true))
            continue
        matchCount += 1
        hit := hwnd
    }
    return (matchCount = 1) ? hit : 0
}

Fail(reason) {
    global attemptCount
    attemptCount += 1
    Log("attempt " attemptCount "/" MAX_ATTEMPTS " failed: " reason)
    if attemptCount >= MAX_ATTEMPTS {
        Archive(FAILED_DIR, "failed")
        ResetAttempts()
    }
}

HardFail(raw, reason) {
    Log("HARD FAILURE: " reason)
    MarkHandled(raw, FAILED_DIR, "hardfail")
    Archive(FAILED_DIR, "hardfail")
}

MarkHandled(raw, targetDir, tag) {
    global handledContent, handledDir, handledTag
    handledContent := raw
    handledDir := targetDir
    handledTag := tag
    ResetAttempts()
}

ResetAttempts() {
    global attemptCount, attemptKey
    attemptCount := 0
    attemptKey := ""
}

Archive(targetDir, tag) {
    stamp := FormatTime(, "yyyyMMdd-HHmmss")
    try {
        FileMove(REQUEST_FILE, targetDir "\" stamp "-" tag ".txt", 1)
        Log("request archived to " targetDir "\" stamp "-" tag ".txt")
    } catch as err {
        Log("ERROR archiving request (" err.Message "); deleting instead")
        try {
            FileDelete(REQUEST_FILE)
            Log("request deleted")
        } catch as err2 {
            ; Both moves failed (likely a transient lock). The handled-content
            ; memory guarantees later polls re-archive rather than re-type.
            Log("ERROR deleting request: " err2.Message)
        }
    }
}

Log(message) {
    try FileAppend(FormatTime(, "yyyy-MM-dd HH:mm:ss") " | " message "`n", LOG_FILE, "UTF-8")
}
