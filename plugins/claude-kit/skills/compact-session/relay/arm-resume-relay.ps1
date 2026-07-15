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

# window.txt names the AHK WinTitle the watcher types into. When absent or blank,
# seed a safe default so an armed relay is usable out of the box; a file with real
# content is a deliberate choice and is left untouched. The default is a
# process-only match, made safe by the watcher refusing to type whenever more than
# one Windows Terminal window matches. Written before the watcher (re)start below
# so the restarted watcher reads it (window.txt is read only at watcher startup).
$windowFile = Join-Path $relayDir "window.txt"
$windowConfigured = (Test-Path -LiteralPath $windowFile) -and -not [string]::IsNullOrWhiteSpace((Get-Content $windowFile -Raw -ErrorAction SilentlyContinue))
$windowDefaulted = $false
if (-not $windowConfigured) {
    [System.IO.File]::WriteAllText($windowFile, "ahk_exe WindowsTerminal.exe", (New-Object System.Text.UTF8Encoding($false)))
    $windowDefaulted = $true
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
Get-CimInstance Win32_Process -Filter "Name='AutoHotkey64.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*resume-relay.ahk*" } |
    ForEach-Object {
        # The process may exit between enumeration and stop; that is fine.
        try { Stop-Process -Id $_.ProcessId -Force -Confirm:$false -ErrorAction Stop } catch {}
    }
Start-Process -FilePath $ahkExe -ArgumentList ('"' + $scriptTarget + '"')

Write-Host "Resume relay armed."
Write-Host "  Watcher : $scriptTarget (running now, and at every logon via $shortcutPath)"
if ($windowDefaulted) {
    Write-Host "  Target  : window.txt was absent or blank; wrote the default 'ahk_exe WindowsTerminal.exe' to $windowFile."
    Write-Host "            This is a process-only match. The watcher refuses to type whenever more than one"
    Write-Host "            Windows Terminal window matches, so if a run does not resume, close the extra WT"
    Write-Host "            windows and it resumes. The Desktop app is never a valid target; it has no /resume command."
}
else {
    Write-Host "  Target  : $windowFile present; left untouched (holds the AHK WinTitle for the CLI window)."
    Write-Host "            window.txt is read at watcher startup; restart the watcher after changing it."
}
Write-Host "  Requests: $relayDir\request.txt (3-4 lines: uuid, transcript path, prompt, optional ahk_id target)"
Write-Host "  Log     : $relayDir\relay.log"
Write-Host "  Dry run : create $relayDir\dryrun.on to validate without typing"
Write-Host "  Disarm  : delete the Startup shortcut and exit the AutoHotkey tray icon"
Write-Host "Re-run this script after a kit update to refresh the watcher copy."
