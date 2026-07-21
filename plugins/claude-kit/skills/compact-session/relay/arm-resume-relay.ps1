# Arms the resume relay on this machine: installs AutoHotkey v2 if absent,
# copies the watcher into the relay directory (the plugin cache path changes
# per kit version, so the Startup shortcut must not point into it), installs
# a Startup-folder shortcut, and starts the watcher now.
#
# -RefreshOnly: maintenance of an already-armed relay (the relay-refresh
# SessionStart hook and doctor -Fix call this). Refreshes the deployed watcher
# copy and restarts it, but never performs first-time setup: it installs
# nothing and exits without side effects when the relay was never armed or
# AutoHotkey is absent (exit 3), and defers whenever request.txt exists (exit
# 2), because the watcher holds a request from arrival through typing to
# archive, so a pending file means a restart could interrupt typing or drop
# the watcher's typed-request memory.
#
# Disarm: delete the Startup shortcut named claude-resume-relay.lnk, exit the
# AutoHotkey tray icon (or Stop-Process -Name AutoHotkey64), and optionally
# remove %LOCALAPPDATA%\claude-kit\resume-relay. Removing the relay directory
# also tells the compact-session skill the relay is no longer armed.

param([switch]$RefreshOnly)

$ErrorActionPreference = "Stop"

$relayDir = Join-Path $env:LOCALAPPDATA "claude-kit\resume-relay"
$scriptSource = Join-Path $PSScriptRoot "resume-relay.ahk"
$scriptTarget = Join-Path $relayDir "resume-relay.ahk"
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "claude-resume-relay.lnk"

# winget installs machine-wide or per-user depending on elevation; probe both.
function Find-AhkExe {
    $candidates = @(
        "C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe",
        (Join-Path $env:LOCALAPPDATA "Programs\AutoHotkey\v2\AutoHotkey64.exe")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

# Appends to the watcher's own log in its timestamp format, so refresh events
# and watcher events read as one stream. Best-effort: logging never fails a run.
function Write-RelayLog {
    param([string]$Message)
    try {
        Add-Content -Path (Join-Path $relayDir "relay.log") -Value ((Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " | " + $Message) -Encoding UTF8
    } catch {}
}

$ahkExe = Find-AhkExe

if ($RefreshOnly) {
    # Refresh is maintenance of a standing arm, never setup: a machine without
    # the relay dir was never armed, a missing Startup shortcut is a documented
    # disarm that a refresh must not undo, and a missing AHK is an install
    # decision that belongs to a deliberate full arm.
    if (-not (Test-Path $relayDir)) { exit 3 }
    if (-not (Test-Path -LiteralPath $shortcutPath)) { exit 3 }
    if (-not $ahkExe) { exit 3 }
    # A pending request means the watcher may be typing right now, or holding
    # in-process memory of a typed request awaiting archive; restarting would
    # risk a half-typed resume or a re-type. Defer; the next session start
    # retries. Re-checked below after the process enumeration, so the guarded
    # gap before the kill is the enumeration alone.
    if (Test-Path -LiteralPath (Join-Path $relayDir "request.txt")) {
        Write-RelayLog "refresh deferred: a request is pending"
        exit 2
    }
}
elseif (-not $ahkExe) {
    Write-Host "AutoHotkey v2 not found; installing via winget..."
    winget install --id AutoHotkey.AutoHotkey -e --accept-source-agreements --accept-package-agreements
    $ahkExe = Find-AhkExe
    if (-not $ahkExe) {
        throw "AutoHotkey install did not produce AutoHotkey64.exe in either known location; install manually and re-run."
    }
}

New-Item -ItemType Directory -Force -Path $relayDir | Out-Null

# window.txt is a retired artifact: the watcher targets exclusively per-request
# (line 4 ahk_id, line-5 name anchor) and has no fallback plane, so a leftover
# file from an older arm is inert. Delete it on any deploy so the doctor never
# has to explain an ignored file.
$windowFile = Join-Path $relayDir "window.txt"
if (Test-Path -LiteralPath $windowFile) {
    # Best-effort: a locked or read-only file must never break arming (the
    # leftover is inert either way), but a failed delete is logged so the
    # doctor's "deleted at the next arm or refresh" note is checkable.
    try { [System.IO.File]::Delete($windowFile) }
    catch { Write-RelayLog "could not delete obsolete window.txt: $($_.Exception.Message)" }
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $ahkExe
$shortcut.Arguments = '"' + $scriptTarget + '"'
$shortcut.WorkingDirectory = $relayDir
$shortcut.Description = "claude-kit resume relay watcher"
$shortcut.Save()

# Restart the watcher so the freshly copied script is the one running. CIM is
# used because Windows PowerShell 5.1 process objects expose no CommandLine
# property. This also catches a watcher launched from a different path (e.g.
# the plugin cache), which #SingleInstance Force alone would not replace.
$watchers = @(Get-CimInstance Win32_Process -Filter "Name='AutoHotkey64.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*resume-relay.ahk*" })

# Last-instant busy re-check: the CIM enumeration above is the one slow step
# between the entry guard and the kill, so re-checking here shrinks the
# unguarded gap to the kill loop itself. Killing a watcher that has begun
# typing both truncates the typed resume and drops the in-process memory that
# prevents a re-type.
if ($RefreshOnly -and $watchers.Count -gt 0 -and (Test-Path -LiteralPath (Join-Path $relayDir "request.txt"))) {
    Write-RelayLog "refresh deferred: a request arrived during the refresh"
    exit 2
}
foreach ($watcher in $watchers) {
    # The process may exit between enumeration and stop; that is fine.
    try { Stop-Process -Id $watcher.ProcessId -Force -Confirm:$false -ErrorAction Stop } catch {}
}

# The deployed copy is written only after the old watcher is down and
# immediately before the new one starts: the deployed-vs-payload hash is the
# drift signal for the relay-refresh hook and the doctor, so an interrupted
# run must leave the hash mismatched (retried at the next session start)
# rather than converged around a watcher that was never restarted.
Copy-Item $scriptSource $scriptTarget -Force
Start-Process -FilePath $ahkExe -ArgumentList ('"' + $scriptTarget + '"')

if ($RefreshOnly) {
    Write-RelayLog "watcher refreshed from kit payload and restarted"
    Write-Host "Resume relay watcher refreshed and restarted."
    exit 0
}

Write-Host "Resume relay armed."
Write-Host "  Watcher : $scriptTarget (running now, and at every logon via $shortcutPath)"
Write-Host "  Target  : per-request only (each request names its own window: ahk_id line, optional name anchor)."
Write-Host "  Requests: $relayDir\request.txt (4-5 lines: uuid, transcript path, prompt, ahk_id target, optional name anchor for fire-time re-resolution)"
Write-Host "  Log     : $relayDir\relay.log"
Write-Host "  Dry run : create $relayDir\dryrun.on to validate without typing"
Write-Host "  Disarm  : delete the Startup shortcut and exit the AutoHotkey tray icon"
Write-Host "After a kit update, an armed relay refreshes itself at the next Claude Code session start; re-run this script (or doctor -Fix) to refresh immediately."
