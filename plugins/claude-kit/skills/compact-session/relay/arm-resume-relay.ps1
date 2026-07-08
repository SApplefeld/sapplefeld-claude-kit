# Arms the resume relay on this machine: installs AutoHotkey v2 if absent,
# copies the watcher into the relay directory (the plugin cache path changes
# per kit version, so the Startup shortcut must not point into it), installs
# a Startup-folder shortcut, and starts the watcher now.
#
# Disarm: delete the Startup shortcut named claude-resume-relay.lnk, exit the
# AutoHotkey tray icon (or Stop-Process -Name AutoHotkey64), and optionally
# remove %LOCALAPPDATA%\claude-kit\resume-relay. Removing the relay directory
# also tells the compact-session skill the relay is no longer armed.

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

$ahkExe = Find-AhkExe
if (-not $ahkExe) {
    Write-Host "AutoHotkey v2 not found; installing via winget..."
    winget install --id AutoHotkey.AutoHotkey -e --accept-source-agreements --accept-package-agreements
    $ahkExe = Find-AhkExe
    if (-not $ahkExe) {
        throw "AutoHotkey install did not produce AutoHotkey64.exe in either known location; install manually and re-run."
    }
}

New-Item -ItemType Directory -Force -Path $relayDir | Out-Null
Copy-Item $scriptSource $scriptTarget -Force

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
Get-CimInstance Win32_Process -Filter "Name='AutoHotkey64.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*resume-relay.ahk*" } |
    ForEach-Object {
        # The process may exit between enumeration and stop; that is fine.
        try { Stop-Process -Id $_.ProcessId -Force -Confirm:$false -ErrorAction Stop } catch {}
    }
Start-Process -FilePath $ahkExe -ArgumentList ('"' + $scriptTarget + '"')

Write-Host "Resume relay armed (but idle until window.txt is configured)."
Write-Host "  Watcher : $scriptTarget (running now, and at every logon via $shortcutPath)"
Write-Host "  Target  : REQUIRED - write an AHK WinTitle expression for the Claude Code CLI window"
Write-Host "            to $relayDir\window.txt (e.g. 'claude ahk_exe WindowsTerminal.exe')."
Write-Host "            The Desktop app is not a valid target; it has no /resume command."
Write-Host "            window.txt is read at watcher startup; restart the watcher after changing it."
Write-Host "  Requests: $relayDir\request.txt (3 lines: uuid, transcript path, prompt)"
Write-Host "  Log     : $relayDir\relay.log"
Write-Host "  Dry run : create $relayDir\dryrun.on to validate without typing"
Write-Host "  Disarm  : delete the Startup shortcut and exit the AutoHotkey tray icon"
Write-Host "Re-run this script after a kit update to refresh the watcher copy."
