# Pre-flight for a resume-relay request: confirms the watcher can plausibly
# fire before the requesting session blinds itself by ending its turn. The
# session cannot both stay alive to watch the outcome and free its window for
# the resume, so the outcome is unobservable after the fact; this check moves
# the observation before the write, while the session can still report.
#
# Prints "OK" and exits 0 when the relay is armed, the watcher is running, and
# the deployed watcher matches this plugin's resume-relay.ahk. Otherwise prints
# a one-line reason and exits 1, so the caller reports that reason with the
# manual /resume line instead of relaying into a void.

$ErrorActionPreference = "Stop"

$relayDir = Join-Path $env:LOCALAPPDATA "claude-kit\resume-relay"
if (-not (Test-Path $relayDir)) { "not armed: $relayDir absent"; exit 1 }

$deployed = Join-Path $relayDir "resume-relay.ahk"
if (-not (Test-Path $deployed)) { "watcher copy missing; re-arm with relay/arm-resume-relay.ps1"; exit 1 }

$running = $false
Get-CimInstance Win32_Process -Filter "Name='AutoHotkey64.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*resume-relay.ahk*" } |
    ForEach-Object { $running = $true }
if (-not $running) { "watcher process not running; re-arm or log off/on"; exit 1 }

# A kit update refreshes this plugin's watcher but not the deployed copy the
# running process was started from; a hash mismatch means the watcher is stale.
$source = Join-Path $PSScriptRoot "resume-relay.ahk"
if (Test-Path $source) {
    try {
        $deployedHash = (Get-FileHash -LiteralPath $deployed -Algorithm SHA256).Hash
        $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
        if ($deployedHash -ne $sourceHash) {
            "watcher is stale (differs from this plugin's resume-relay.ahk); re-arm to refresh it"
            exit 1
        }
    } catch {}
}

"OK"
exit 0
