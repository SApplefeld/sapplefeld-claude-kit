# Post-install health check for the claude-kit plugin on this machine.
# Verifies core setup (execution policy, doctrine import, kaizen signpost, git
# hooks), the compact-session prerequisites (bun, the engine, the claude CLI,
# the ANTHROPIC_API_KEY hazard), and reports the optional resume relay's state.
#
# Run from the kit repo root (dev clone or marketplace clone):
#   .\doctor.ps1          Check only; prints PASS/WARN/FAIL with remediations.
#   .\doctor.ps1 -Fix     Also applies the safe durable repairs: execution
#                         policy to RemoteSigned when scripts are blocked, bun
#                         appended to the user PATH when installed but
#                         unresolvable, setup.ps1 when the signpost or git
#                         hooks are missing.
#
# If scripts are blocked entirely, use the wrapper:  doctor.cmd [-Fix]
# Exit code: 0 when nothing FAILs (warnings allowed), 1 otherwise.

param([switch]$Fix)

$script:failCount = 0
$script:warnCount = 0

function Report {
    param([string]$Status, [string]$Name, [string[]]$Detail = @())
    $colors = @{ PASS = "Green"; WARN = "Yellow"; FAIL = "Red"; INFO = "Gray"; FIXED = "Cyan" }
    Write-Host ("[{0,-5}] {1}" -f $Status, $Name) -ForegroundColor $colors[$Status]
    foreach ($line in $Detail) { Write-Host "        $line" }
    if ($Status -eq "FAIL") { $script:failCount++ }
    if ($Status -eq "WARN") { $script:warnCount++ }
}

$kitRoot = $PSScriptRoot
$claudeDir = Join-Path $env:USERPROFILE ".claude"
$engineDir = Join-Path $kitRoot "plugins\claude-kit\skills\compact-session\engine"
$relaySourceDir = Join-Path $kitRoot "plugins\claude-kit\skills\compact-session\relay"

if (-not (Test-Path (Join-Path $kitRoot "plugins\claude-kit\.claude-plugin\plugin.json"))) {
    Report "FAIL" "Kit repo root" @("Run this from the claude-kit repo root (plugins\claude-kit\.claude-plugin\plugin.json not found beside the script).")
    exit 1
}

Write-Host "claude-kit doctor ($kitRoot)" -ForegroundColor White
Write-Host ""

# --- Execution policy. A Restricted or AllSigned effective policy blocks every
# --- .ps1 in the kit (setup, doctor itself without the .cmd wrapper, the relay
# --- arm script). RemoteSigned is sufficient; Unrestricted is broader than the
# --- kit needs. The Process scope is excluded from the computation: doctor.cmd
# --- launches with -ExecutionPolicy Bypass, and including it would make the
# --- check report Bypass on a machine where a plain .ps1 is still blocked.
$effectivePolicy = "Restricted"
foreach ($scope in @("LocalMachine", "CurrentUser", "UserPolicy", "MachinePolicy")) {
    $scopedPolicy = Get-ExecutionPolicy -Scope $scope
    if ($scopedPolicy -ne "Undefined") { $effectivePolicy = $scopedPolicy }
}
if ($effectivePolicy -in @("Restricted", "AllSigned")) {
    if ($Fix) {
        try {
            Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force -ErrorAction Stop
            Report "FIXED" "Execution policy" @("Was $effectivePolicy; set CurrentUser scope to RemoteSigned.")
        }
        catch {
            Report "FAIL" "Execution policy" @(
                "Effective policy is $effectivePolicy and the fix failed (likely Group Policy): $($_.Exception.Message)",
                "Manual: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned"
            )
        }
    }
    else {
        Report "FAIL" "Execution policy" @(
            "Effective policy is $effectivePolicy; the kit's .ps1 scripts will not run.",
            "Fix: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned   (or re-run doctor with -Fix)"
        )
    }
}
elseif ($effectivePolicy -in @("Unrestricted", "Bypass")) {
    Report "PASS" "Execution policy" @("$effectivePolicy (works, but broader than needed; RemoteSigned is sufficient for the kit).")
}
else {
    Report "PASS" "Execution policy" @("$effectivePolicy")
}

# --- Bun. The compact-session engine runs under bun. winget sometimes creates
# --- a Links shim and sometimes does not, so probe PATH, the Links shim, the
# --- winget Packages payload, and the official installer location in order.
function Resolve-Bun {
    $onPath = Get-Command bun -ErrorAction SilentlyContinue
    if ($onPath) { return @{ Path = $onPath.Source; OnPath = $true } }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\bun.exe"),
        (Join-Path $env:USERPROFILE ".bun\bin\bun.exe")
    )
    $packageRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    if (Test-Path $packageRoot) {
        Get-ChildItem -Path $packageRoot -Directory -Filter "Oven-sh.Bun*" -ErrorAction SilentlyContinue | ForEach-Object {
            Get-ChildItem -Path $_.FullName -Recurse -Filter "bun.exe" -ErrorAction SilentlyContinue | ForEach-Object {
                $candidates += $_.FullName
            }
        }
    }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { return @{ Path = $candidate; OnPath = $false } }
    }
    return $null
}

$bun = Resolve-Bun
if ($null -eq $bun) {
    Report "FAIL" "Bun" @(
        "Not found on PATH, the WinGet Links shim, the WinGet Packages dir, or ~\.bun.",
        "Install: winget install Oven-sh.Bun   then re-run doctor (with -Fix to wire PATH if needed)."
    )
}
elseif ($bun.OnPath) {
    $bunVersion = (& $bun.Path --version) 2>$null
    Report "PASS" "Bun" @("$($bun.Path) (v$bunVersion, on PATH)")
}
else {
    $bunDir = Split-Path $bun.Path -Parent
    if ($Fix) {
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($userPath -notlike "*$bunDir*") {
            [Environment]::SetEnvironmentVariable("Path", ($userPath.TrimEnd(";") + ";" + $bunDir), "User")
        }
        $env:Path = $env:Path.TrimEnd(";") + ";" + $bunDir
        Report "FIXED" "Bun" @("Found off PATH at $($bun.Path); appended $bunDir to the user PATH (new shells pick it up; this session updated too).")
    }
    else {
        Report "WARN" "Bun" @(
            "Installed at $($bun.Path) but not on PATH; the compact-session skill resolves 'bun' from PATH.",
            "Fix: append $bunDir to the user PATH   (or re-run doctor with -Fix)."
        )
    }
}

# --- Engine smoke run. An argless invocation loads and transpiles every engine
# --- module before failing with usage text, so exit 1 plus 'Usage:' proves bun
# --- actually executes the engine on this machine.
if ($null -ne $bun) {
    $engineCli = Join-Path $engineDir "compact-cli.ts"
    if (Test-Path $engineCli) {
        $smokeOutput = & cmd /c "`"$($bun.Path)`" `"$engineCli`" 2>&1"
        if ($LASTEXITCODE -eq 1 -and ($smokeOutput -join "`n") -match "Usage:") {
            Report "PASS" "Compact-session engine" @("compact-cli.ts loads and runs under bun (usage banner verified).")
        }
        else {
            Report "FAIL" "Compact-session engine" @(
                "Expected exit 1 with a usage banner; got exit $LASTEXITCODE.",
                ($smokeOutput | Select-Object -First 3)
            )
        }
    }
    else {
        Report "FAIL" "Compact-session engine" @("compact-cli.ts not found at $engineCli.")
    }
}
else {
    Report "INFO" "Compact-session engine" @("Skipped (bun unresolved).")
}

# --- claude CLI. The engine spawns 'claude' for the summarizer and requires a
# --- native executable: a .cmd shim would route transcript-derived argv
# --- through cmd.exe's parser, an injection surface.
$claudeCmd = Get-Command claude -ErrorAction SilentlyContinue
if ($null -eq $claudeCmd) {
    Report "FAIL" "claude CLI" @("'claude' does not resolve on PATH; the summarizer spawn and headless workers need it.")
}
elseif ($claudeCmd.Source -match "\.(cmd|bat)$") {
    Report "WARN" "claude CLI" @(
        "'claude' resolves to a cmd shim: $($claudeCmd.Source)",
        "The compact-session skill requires a native executable (injection surface via cmd.exe argv parsing).",
        "Install the native build: https://code.claude.com/docs (claude install) and ensure it wins on PATH."
    )
}
else {
    Report "PASS" "claude CLI" @("$($claudeCmd.Source)")
}

# --- ANTHROPIC_API_KEY. The engine scrubs it from the summarizer spawn, but a
# --- durable (User/Machine) value reaches every session and every headless
# --- 'claude -p' spawned by hand, flipping auth off the subscription login.
$apiKeyScopes = @()
if ($env:ANTHROPIC_API_KEY) { $apiKeyScopes += "process" }
if ([Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "User")) { $apiKeyScopes += "User" }
if ([Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "Machine")) { $apiKeyScopes += "Machine" }
if ($apiKeyScopes.Count -eq 0) {
    Report "PASS" "ANTHROPIC_API_KEY" @("Not set; headless claude spawns authenticate via the claude.ai login.")
}
else {
    Report "WARN" "ANTHROPIC_API_KEY" @(
        ("Set at scope: " + ($apiKeyScopes -join ", ") + "."),
        "The compaction engine scrubs it from its summarizer spawn, but hand-spawned headless workers",
        "('claude -p ...') inherit it and switch to API-key auth. Spawn those with the key scrubbed",
        "(Bash: env -u ANTHROPIC_API_KEY claude -p ...), or unset the durable value if it is not needed."
    )
}

# --- Doctrine import. The always-on doctrine loads via a one-line import in
# --- ~/.claude/CLAUDE.md; the doctrine-refresh hook maintains the imported file.
$claudeMd = Join-Path $claudeDir "CLAUDE.md"
$doctrineFile = Join-Path $claudeDir "claude-kit-doctrine.md"
$importPresent = (Test-Path $claudeMd) -and ((Get-Content $claudeMd -Raw -ErrorAction SilentlyContinue) -match "@claude-kit-doctrine\.md")
if ($importPresent -and (Test-Path $doctrineFile)) {
    Report "PASS" "Doctrine import" @("~/.claude/CLAUDE.md imports @claude-kit-doctrine.md and the doctrine file exists.")
}
elseif ($importPresent) {
    Report "WARN" "Doctrine import" @("Import line present but $doctrineFile does not exist yet; the doctrine-refresh hook writes it on the next Claude Code session with the plugin installed.")
}
else {
    Report "WARN" "Doctrine import" @("Add this line to $claudeMd so the doctrine loads always-on:  @claude-kit-doctrine.md")
}

# --- Kaizen signpost + git hooks (setup.ps1's job; -Fix runs it).
$signpost = Join-Path $claudeDir "claude-kit.local.json"
$hooksPath = $null
if (Get-Command git -ErrorAction SilentlyContinue) {
    $hooksPath = (& git -C $kitRoot config core.hooksPath) 2>$null
}
$setupGaps = @()
if (-not (Test-Path $signpost)) { $setupGaps += "kaizen signpost missing ($signpost)" }
if ($hooksPath -ne ".githooks") { $setupGaps += "core.hooksPath is '$hooksPath', not '.githooks' (pre-commit zip rebuild inactive)" }
$setupNeeded = $setupGaps.Count -gt 0
if ($setupNeeded -and $Fix) {
    & (Join-Path $kitRoot "setup.ps1")
    $setupNeeded = $false
    Report "FIXED" "Setup (signpost + git hooks)" @("Ran setup.ps1.")
}
if (-not $setupNeeded) {
    if (Test-Path $signpost) {
        $signpostData = $null
        try { $signpostData = Get-Content $signpost -Raw | ConvertFrom-Json } catch {}
        if ($null -ne $signpostData -and (Test-Path $signpostData.kitRepoPath)) {
            $note = "kitRepoPath: $($signpostData.kitRepoPath)"
            if ($signpostData.kitRepoPath -ne $kitRoot) { $note += "  (a different clone than this one; fine if that is the intended kaizen target)" }
            Report "PASS" "Kaizen signpost" @($note)
        }
        else {
            Report "WARN" "Kaizen signpost" @("$signpost exists but its kitRepoPath is unreadable or missing on disk; re-run setup.ps1 from the intended clone.")
        }
    }
}
else {
    Report "WARN" "Setup (signpost + git hooks)" ($setupGaps + @("Fix: .\setup.ps1   (or re-run doctor with -Fix)."))
}

# --- Resume relay (optional). Reports armed state; arming stays a deliberate
# --- act via the arm script, never an automatic fix.
$relayDir = Join-Path $env:LOCALAPPDATA "claude-kit\resume-relay"
$armScript = Join-Path $relaySourceDir "arm-resume-relay.ps1"
if (-not (Test-Path $relayDir)) {
    Report "INFO" "Resume relay" @("Not armed (optional; interactive compaction works without it). Arm: $armScript")
}
else {
    $relayIssues = @()
    if (-not (Test-Path (Join-Path $relayDir "resume-relay.ahk"))) { $relayIssues += "watcher copy missing (re-run $armScript)" }
    $shortcut = Join-Path ([Environment]::GetFolderPath("Startup")) "claude-resume-relay.lnk"
    if (-not (Test-Path $shortcut)) { $relayIssues += "Startup shortcut missing (re-run $armScript)" }
    $windowFile = Join-Path $relayDir "window.txt"
    if (-not (Test-Path $windowFile) -or [string]::IsNullOrWhiteSpace((Get-Content $windowFile -Raw -ErrorAction SilentlyContinue))) {
        $relayIssues += "window.txt not configured; the watcher is idle until it names the CLI window (then restart the watcher)"
    }
    $watcherRunning = $false
    Get-CimInstance Win32_Process -Filter "Name='AutoHotkey64.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*resume-relay.ahk*" } |
        ForEach-Object { $watcherRunning = $true }
    if (-not $watcherRunning) { $relayIssues += "watcher process not running (re-run $armScript or log off/on)" }

    if ($relayIssues.Count -eq 0) {
        Report "PASS" "Resume relay" @("Armed: watcher running, Startup shortcut present, window.txt configured.")
    }
    else {
        Report "WARN" "Resume relay" $relayIssues
    }
}

# --- Summary.
Write-Host ""
if ($script:failCount -gt 0) {
    Write-Host "$($script:failCount) check(s) FAILED, $($script:warnCount) warning(s)." -ForegroundColor Red
    exit 1
}
if ($script:warnCount -gt 0) {
    Write-Host "Healthy with $($script:warnCount) warning(s)." -ForegroundColor Yellow
    exit 0
}
Write-Host "All checks passed." -ForegroundColor Green
exit 0
