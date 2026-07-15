# Prints the AutoHotkey WinTitle expression that uniquely identifies the
# terminal window hosting the current session, for the resume relay to target.
#
# The session's console (inherited by this child process) resolves to its
# visible terminal window via the console window's root owner: under Windows
# Terminal that is the frame hosting this tab (distinct per window even though
# one process backs them all), and under a classic console it is the console
# window itself. Either way the HWND names one window, so concurrent sessions
# in separate windows each get their own relay target rather than sharing one
# process-wide match.
#
# Emits "ahk_id <hwnd>" on success. Emits nothing and exits 1 when there is no
# host window (a headless run), so the caller omits the target and the watcher
# falls back to its configured window.

$ErrorActionPreference = "Stop"

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class RelayWin {
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
}
'@

$GA_ROOTOWNER = 3
$console = [RelayWin]::GetConsoleWindow()
if ($console -eq [IntPtr]::Zero) { exit 1 }
$frame = [RelayWin]::GetAncestor($console, $GA_ROOTOWNER)
if ($frame -eq [IntPtr]::Zero) { exit 1 }
"ahk_id $([Int64]$frame)"
