#Requires AutoHotkey v2.0
#SingleInstance Force
Persistent

; Resume relay: watches for a request file written by a compact-session
; boundary and types "/resume <id>" plus the continue prompt into the Claude
; desktop window, so an unattended run continues without a human at the keys.
;
; Request contract (request.txt, three or four UTF-8 lines):
;   line 1: session UUID
;   line 2: absolute transcript path (filename must be "<uuid>.jsonl")
;   line 3: single-line continue prompt
;   line 4: optional target window as "ahk_id <hwnd>", the requesting session's
;           own window; absent means use the fallback window
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
; concurrent sessions in separate windows each resume into their own. A request
; without that line falls back to FALLBACK_WINDOW, read from window.txt at
; startup; when window.txt is absent or blank the fallback is a process-only
; match, which the exactly-one-window guard below keeps safe by refusing to
; type whenever more than one window matches. The Desktop app is never a valid
; target: the /resume slash command does not exist there.
FALLBACK_WINDOW := "ahk_exe WindowsTerminal.exe"
if FileExist(RELAY_DIR "\window.txt") {
    try {
        configuredWindow := Trim(FileRead(RELAY_DIR "\window.txt", "UTF-8"), " `t`r`n")
        if (configuredWindow != "")
            FALLBACK_WINDOW := configuredWindow
    }
}
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
    if (lines.Length != 3 && lines.Length != 4) {
        Fail("request must be 3 or 4 lines, got " lines.Length)
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
    ; Line 4, when present, is the requesting session's own captured window
    ; ("ahk_id <hwnd>") and takes precedence, so concurrent sessions each resume
    ; into their own window. Only that exact shape is accepted: the sole
    ; producer is capture-window.ps1, so anything else is a malformed request,
    ; not a free-form WinTitle to trust at the keyboard. A 3-line request uses
    ; the fallback window.
    target := FALLBACK_WINDOW
    if (lines.Length = 4) {
        requestedTarget := Trim(lines[4], " `t`r")
        if !RegExMatch(requestedTarget, "^ahk_id \d+$") {
            Fail("malformed target window on line 4: " requestedTarget)
            return
        }
        target := requestedTarget
    }
    if (target = "") {
        Fail("no target window: empty fallback and no per-request target")
        return
    }
    ; The target must resolve to exactly one window. A per-request ahk_id names
    ; one window (or none, if it has since closed); a process-only fallback can
    ; match several, and typing into whichever is active would deliver the
    ; resume to the wrong session, so refuse and let the retry flow surface it.
    matchedWindows := WinGetList(target)
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
