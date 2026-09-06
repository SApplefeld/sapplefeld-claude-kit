#Requires -RunAsAdministrator
<#
Configures Microsoft Defender so it stops scanning the hot paths and processes of Claude
development work on a fleet VM. Idempotent: safe to run once at bring-up and again any time.

What it does:
  - Process exclusions for the executables dev work spawns constantly (node, claude, rg, git,
    bash, the PowerShell hosts, the Python and uv interpreters that sessions and the
    claude-swap watcher run on, and the .NET build and test family). A process exclusion skips
    scanning of files opened by that process wherever they live, so it needs no path list.
  - Path exclusions for the heavy small-file churn locations: the Claude home (plugin cache and
    memory store), the user temp directory, the npm cache, each repo root passed in, and the
    root of every ReFS (Dev Drive) volume found on the machine.
  - Caps scheduled-scan CPU at the given percentage (default 10).

What it deliberately does not do: disable Defender, touch real-time protection, or change
Tamper Protection. Exclusions plus the Dev Drive's own performance mode capture most of the
contention win while the rest of the volume keeps coverage.

Usage (elevated PowerShell, from the repo root):
  .\tools\set-defender-dev-exclusions.ps1
  .\tools\set-defender-dev-exclusions.ps1 -RepoRoots 'D:\','E:\work' -ScanCpuCap 15

The Defender service must be running to accept settings. If you have it temporarily disabled,
start it, run this, then decide whether you still need it off at all.
#>
[CmdletBinding()]
param(
    [string[]]$RepoRoots = @('D:\'),
    [ValidateRange(5, 50)]
    [int]$ScanCpuCap = 10
)

$ErrorActionPreference = 'Stop'

# Defender must be up to take settings; a disabled service makes Set-MpPreference fail obscurely.
$svc = Get-Service -Name WinDefend -ErrorAction SilentlyContinue
if (-not $svc -or $svc.Status -ne 'Running') {
    Write-Warning "The Defender service (WinDefend) is not running, so settings cannot be applied."
    Write-Warning "Start it (Start-Service WinDefend), re-run this script, then re-disable if you still want to."
    exit 1
}

# Processes whose file I/O Defender skips, wherever the files live.
$processes = @(
    'node.exe', 'claude.exe', 'rg.exe', 'git.exe', 'bash.exe', 'sh.exe',
    'pwsh.exe', 'powershell.exe',
    'python.exe', 'python3.exe', 'uv.exe',
    'dotnet.exe', 'testhost.exe', 'testhost.x86.exe', 'MSBuild.exe', 'VBCSCompiler.exe'
)

# Paths with heavy small-file churn.
$paths = [System.Collections.Generic.List[string]]::new()
$paths.Add((Join-Path $env:USERPROFILE '.claude'))
$paths.Add($env:TEMP)
if ($env:LOCALAPPDATA) { $paths.Add((Join-Path $env:LOCALAPPDATA 'npm-cache')) }
foreach ($root in $RepoRoots) { $paths.Add($root) }

# Every ReFS volume is a Dev Drive candidate on this fleet; exclude each root.
Get-Volume |
    Where-Object { $_.FileSystemType -eq 'ReFS' -and $_.DriveLetter } |
    ForEach-Object { $paths.Add("$($_.DriveLetter):\") }

# Add-MpPreference appends and treats an already-present entry as a no-op, which is what makes
# this script idempotent; Set-MpPreference is reserved for the scalar setting below.
foreach ($p in $processes) { Add-MpPreference -ExclusionProcess $p }
foreach ($p in ($paths | Select-Object -Unique)) { Add-MpPreference -ExclusionPath $p }

Set-MpPreference -ScanAvgCPULoadFactor $ScanCpuCap

# Report what is now in effect, read back from Defender rather than from this script's inputs.
$mp = Get-MpPreference
Write-Output "Defender dev exclusions in effect on $env:COMPUTERNAME"
Write-Output ("  Processes:    " + (($mp.ExclusionProcess | Sort-Object) -join ', '))
Write-Output ("  Paths:        " + (($mp.ExclusionPath | Sort-Object) -join ', '))
Write-Output ("  Scan CPU cap: $($mp.ScanAvgCPULoadFactor)%")
