# Prints the AutoHotkey WinTitle expression ("ahk_id <hwnd>") that uniquely
# identifies the terminal window hosting the current session, for the resume
# relay to target. Exits 1 (emitting nothing) when no window can be resolved,
# so the caller omits the target and the watcher falls back to window.txt.
#
# Resolution order:
#   1. By console (primary, when it yields a VISIBLE window). The current
#      process's console resolves to its terminal window via the console
#      window's root owner. This is self-referential, so the window it names is
#      definitionally this session's own, never a coincidental match. It is
#      used whenever it produces a visible window (a hidden pseudo-console under
#      some ConPTY hosts is treated as absent).
#   2. By session name (fallback, for the hosts where the console lookup returns
#      nothing: Remote Desktop and some ConPTY nesting). Given the source
#      transcript path, read the session's name (its latest custom-title, or an
#      ai-title when no custom-title exists) and find the one visible Windows
#      Terminal window whose title carries that name. This is console-
#      independent (a top-down enumeration). It must run BEFORE the compaction
#      engine relabels the source transcript to "[UNCOMPACTED] <name>": at that
#      point the live window still shows only its clean name, and any dormant
#      same-named leftover carries the "[UNCOMPACTED]" tag, so excluding that
#      tag leaves the live window as the sole match. The match is a substring
#      test, tolerating the CLI's own live title decoration (a progress dot
#      during execution, a status icon at each stop) that no external write can
#      override. Zero or more than one match falls through rather than guessing.
#   3. Neither resolved: exit 1, and the watcher uses window.txt.
#
# The name path can name only a window this session does not own if this
# session has no console window AND its own terminal is not among the matches
# AND exactly one unrelated window matches; that residual is bounded by the
# exactly-one requirement here and the watcher's own exactly-one-window re-check
# before it types. Concurrent sessions in separate windows each resolve to their
# own window.
#
# -NameOnly prints the resolved session name and exits, for tests of the name
# extraction seam (which is pure and fixture-testable, unlike the Win32 match).

param(
    [string]$TranscriptPath = "",
    [switch]$NameOnly
)

$ErrorActionPreference = "Stop"

Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class RelayWin {
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")]   public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")]   public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")]   public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]   public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")]   public static extern bool IsWindowVisible(IntPtr hWnd);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    public class WinInfo { public long Hwnd; public string Title; }
    public static List<WinInfo> Terminals = new List<WinInfo>();
    public static void EnumTerminals() {
        Terminals.Clear();
        EnumWindows((h, l) => {
            if (!IsWindowVisible(h)) return true;
            uint pid; GetWindowThreadProcessId(h, out pid);
            try {
                var p = System.Diagnostics.Process.GetProcessById((int)pid);
                if (p.ProcessName.Equals("WindowsTerminal", StringComparison.OrdinalIgnoreCase)) {
                    var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
                    Terminals.Add(new WinInfo { Hwnd = (long)h, Title = sb.ToString() });
                }
            } catch { }
            return true;
        }, IntPtr.Zero);
    }
}
'@

# Read the session name: the latest custom-title, or an ai-title if the session
# has no custom-title, mirroring the engine's resolveSessionTitle precedence.
# Streamed line by line (not a fixed tail a long session can push the last
# title-write out of, and not the whole file into memory beyond one line at a
# time; a pathological newline-free transcript would buffer one line to EOF, but
# writing that file needs ownership of the session's own transcript). Shared
# read/write so it never locks out the harness still appending. Each candidate
# line is parsed with ConvertFrom-Json so every JSON escape decodes correctly.
function Get-SessionName([string]$path) {
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { return $null }
    $fs = $null; $sr = $null
    try {
        $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
        $lastCustom = $null; $lastAi = $null
        while ($null -ne ($line = $sr.ReadLine())) {
            # Title records are tiny; a huge line is a message, never a title.
            if ($line.Length -gt 8192) { continue }
            if (-not ($line.Contains('"custom-title"') -or $line.Contains('"ai-title"'))) { continue }
            try {
                $o = $line | ConvertFrom-Json
                if ($o.type -eq 'custom-title' -and $null -ne $o.customTitle) { $lastCustom = [string]$o.customTitle }
                elseif ($o.type -eq 'ai-title' -and $null -ne $o.aiTitle) { $lastAi = [string]$o.aiTitle }
            } catch { }
        }
        if ($null -ne $lastCustom) { return $lastCustom }
        return $lastAi
    } catch { return $null }
    finally {
        if ($sr) { $sr.Dispose() }
        if ($fs) { $fs.Dispose() }
    }
}

if ($NameOnly) {
    $n = Get-SessionName $TranscriptPath
    # Flattened to one line: the name rides as a single request line (the
    # watcher's line-5 anchor), and a raw embedded newline would shift the
    # request's line structure and fail the whole request.
    if ($null -ne $n) { ($n -replace "[\r\n]+", " ").Trim() }
    exit 0
}

# (1) By console (primary, when visible). Self-referential: this window is ours.
$console = [RelayWin]::GetConsoleWindow()
if ($console -ne [IntPtr]::Zero) {
    $frame = [RelayWin]::GetAncestor($console, 3)  # GA_ROOTOWNER
    if ($frame -ne [IntPtr]::Zero -and [RelayWin]::IsWindowVisible($frame)) {
        "ahk_id $([Int64]$frame)"
        exit 0
    }
}

# (2) By session name (fallback for a console-less host). A generic default
# title is no anchor, so it falls through.
$name = Get-SessionName $TranscriptPath
if ($name -and $name.Trim() -ne "" -and $name -ne "Claude Code") {
    [RelayWin]::EnumTerminals()
    $hits = @([RelayWin]::Terminals | Where-Object {
        $_.Title.Contains($name) -and -not $_.Title.Contains("[UNCOMPACTED]")
    })
    if ($hits.Count -eq 1) {
        "ahk_id $($hits[0].Hwnd)"
        exit 0
    }
}

# (3) Nothing resolved: the watcher falls back to window.txt.
exit 1
