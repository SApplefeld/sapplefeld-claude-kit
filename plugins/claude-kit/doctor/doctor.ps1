# Health check and setup for the claude-kit plugin on this machine.
#
# Ships inside the plugin payload so every machine with the plugin installed
# has the current doctor, clone or not. The repo root keeps thin forwarders
# (doctor.ps1 / doctor.cmd) for the dev-clone habit.
#
# Verifies core setup (execution policy, doctrine import and freshness, kaizen
# signpost, git hooks on a clone), the compact-session prerequisites (bun, the
# engine including its --check layer, the claude CLI shape and login, the
# ANTHROPIC_API_KEY hazard), and the optional resume relay including the
# AutoHotkey v2 dependency.
#
#   .\doctor.ps1              Check only; prints PASS/WARN/FAIL with remediations.
#   .\doctor.ps1 -Fix         Also applies the safe durable repairs (execution
#                             policy, bun PATH wiring, signpost + git hooks on a
#                             clone) and offers consented installs (bun via
#                             winget).
#   .\doctor.ps1 -Fix -Yes    Answers yes to every install prompt (unattended).
#   .\doctor.ps1 -NoProbe     Skips the two state-writing probes: the CLI login
#                             probe (spends a model call, needs the network) and
#                             the resume-relay round-trip (writes a synthetic
#                             marker-protected request through the live watcher).
#
# If scripts are blocked entirely, use the wrapper beside this file:
#   doctor.cmd [-Fix] [-Yes] [-NoProbe]
# Exit code: 0 when nothing FAILs (warnings allowed), 1 otherwise.

param([switch]$Fix, [switch]$Yes, [switch]$NoProbe)

# Windows PowerShell 5.1 inherits PSModulePath from whatever parent launched it.
# A pwsh 7+ parent (the Claude Code harness, a pwsh terminal) puts its own
# module directories first, and those shadow 5.1's built-in modules: cmdlet
# autoload then finds the pwsh edition of Microsoft.PowerShell.Security and
# fails to load it ("command was found in the module ... but the module could
# not be loaded"), taking Get-ExecutionPolicy down with it. Reset this process's
# PSModulePath to the 5.1 default set; the change dies with the process.
# [Environment]::GetFolderPath follows a OneDrive-redirected Documents folder.
if ($PSVersionTable.PSVersion.Major -le 5) {
    $env:PSModulePath = @(
        (Join-Path ([Environment]::GetFolderPath("MyDocuments")) "WindowsPowerShell\Modules"),
        (Join-Path $env:ProgramFiles "WindowsPowerShell\Modules"),
        (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\Modules")
    ) -join ";"
}

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

# Consent gate for anything that installs software. Only ever true under -Fix;
# -Yes pre-answers for unattended runs; a non-interactive host that cannot
# prompt declines rather than stalling.
function Get-Consent {
    param([string]$Question)
    if (-not $Fix) { return $false }
    if ($Yes) { return $true }
    try {
        $answer = Read-Host "$Question [y/N]"
        if ([string]::IsNullOrWhiteSpace($answer)) {
            Write-Host "        (no answer; declining the install. A redirected stdin cannot answer prompts; use -Fix -Yes to consent unattended.)"
            return $false
        }
        return $answer -match '^[Yy]'
    }
    catch {
        Write-Host "        (non-interactive host; skipping the prompt. Use -Fix -Yes to consent unattended.)"
        return $false
    }
}

# --- Locate the payload and, when present, the surrounding repo clone. Dev-only
# --- checks (kaizen signpost writing, git hook wiring) apply only to a clone;
# --- an installed plugin cache must never register itself as the kaizen target.
$pluginRoot = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $pluginRoot ".claude-plugin\plugin.json"))) {
    Report "FAIL" "Plugin payload root" @("Expected .claude-plugin\plugin.json one level above this script; the doctor must live at <plugin>\doctor\doctor.ps1.")
    exit 1
}
$claudeDir = Join-Path $env:USERPROFILE ".claude"
$engineDir = Join-Path $pluginRoot "skills\compact-session\engine"
$relaySourceDir = Join-Path $pluginRoot "skills\compact-session\relay"

# A payload anywhere under ~/.claude is always an installed cache, never the
# dev clone: /plugin marketplace add clones the whole repo (with .git) under
# ~/.claude/plugins/marketplaces/, so a structural check alone misclassifies
# exactly the copy every install-only machine runs.
$repoRoot = Split-Path (Split-Path $pluginRoot -Parent) -Parent
$isClone = (Split-Path $pluginRoot -Leaf) -eq "claude-kit" -and
           (Split-Path (Split-Path $pluginRoot -Parent) -Leaf) -eq "plugins" -and
           (Test-Path (Join-Path $repoRoot ".git")) -and
           -not $pluginRoot.StartsWith($claudeDir, [System.StringComparison]::OrdinalIgnoreCase)

if ($isClone) {
    Write-Host "claude-kit doctor (repo clone: $repoRoot)" -ForegroundColor White
}
else {
    Write-Host "claude-kit doctor (installed plugin: $pluginRoot)" -ForegroundColor White
}
Write-Host ""

# --- Execution policy. A Restricted or AllSigned effective policy blocks every
# --- .ps1 in the kit (the doctor itself without the .cmd wrapper, the relay
# --- arm script). RemoteSigned is sufficient; Unrestricted is broader than the
# --- kit needs. The Process scope is excluded from the computation: doctor.cmd
# --- launches with -ExecutionPolicy Bypass, and including it would make the
# --- check report Bypass on a machine where a plain .ps1 is still blocked.
$effectivePolicy = $null
$policyProbeError = $null
foreach ($scope in @("LocalMachine", "CurrentUser", "UserPolicy", "MachinePolicy")) {
    try { $scopedPolicy = Get-ExecutionPolicy -Scope $scope -ErrorAction Stop }
    catch {
        if (-not $policyProbeError) { $policyProbeError = $_.Exception.Message }
        continue
    }
    # Store the string form: Get-ExecutionPolicy returns an enum whose
    # Unrestricted member is value 0, so keeping the enum would make every
    # later truthiness check (-not $effectivePolicy) silently discard it.
    if ($null -ne $scopedPolicy -and "$scopedPolicy" -ne "Undefined") { $effectivePolicy = "$scopedPolicy" }
}
if (-not $effectivePolicy -and $policyProbeError) {
    # Every scope query failed, so the true policy is unknown: report that,
    # never a fabricated value. The .cmd entry points still work regardless
    # (they launch with -ExecutionPolicy Bypass); plain .ps1 launches may not.
    Report "WARN" "Execution policy" @(
        "Could not query the policy: $policyProbeError",
        "doctor.cmd and the relay arm path still run (Bypass at launch); a plain .ps1 launch is unverified on this machine."
    )
}
elseif (-not $effectivePolicy) {
    # All scopes genuinely Undefined: the OS default (Restricted on client
    # Windows) is in effect, and the FAIL branch below says so.
    $effectivePolicy = "Restricted"
}
if (-not $effectivePolicy) {
    # WARN path above already reported; skip the policy branches.
}
elseif ($effectivePolicy -in @("Restricted", "AllSigned")) {
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
# --- Under -Fix, a missing bun offers a consented winget install.
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

function Add-BunToUserPath {
    param([string]$BunPath)
    $bunDir = Split-Path $BunPath -Parent
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($null -eq $userPath) { $userPath = "" }
    if ($userPath -notlike "*$bunDir*") {
        [Environment]::SetEnvironmentVariable("Path", ($userPath.TrimEnd(";") + ";" + $bunDir), "User")
    }
    $env:Path = $env:Path.TrimEnd(";") + ";" + $bunDir
    return $bunDir
}

$bun = Resolve-Bun
if ($null -eq $bun) {
    if ((Get-Command winget -ErrorAction SilentlyContinue) -and (Get-Consent "Bun is not installed. Install it now via winget (Oven-sh.Bun)?")) {
        winget install --id Oven-sh.Bun -e --source winget --accept-source-agreements --accept-package-agreements
        $wingetExit = $LASTEXITCODE
        $bun = Resolve-Bun
        if ($null -ne $bun) {
            if (-not $bun.OnPath) { Add-BunToUserPath -BunPath $bun.Path | Out-Null; $bun = @{ Path = $bun.Path; OnPath = $true } }
            Report "FIXED" "Bun" @("Installed via winget: $($bun.Path) (PATH wired durably).")
        }
        elseif ($wingetExit -ne 0) {
            Report "FAIL" "Bun" @("winget install exited $wingetExit (cancelled or failed); bun remains missing.")
        }
        else {
            Report "FAIL" "Bun" @("winget reported success but bun.exe was not found in any known location; install manually and re-run.")
        }
    }
    elseif (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Report "FAIL" "Bun" @(
            "Not found, and winget is unavailable on this host to install it.",
            "Install manually: https://bun.sh   then re-run doctor."
        )
    }
    else {
        Report "FAIL" "Bun" @(
            "Not found on PATH, the WinGet Links shim, the WinGet Packages dir, or ~\.bun.",
            "Install: winget install Oven-sh.Bun   (or re-run doctor with -Fix to be prompted, -Fix -Yes unattended)."
        )
    }
}
elseif ($bun.OnPath) {
    $bunVersion = (& $bun.Path --version) 2>$null
    Report "PASS" "Bun" @("$($bun.Path) (v$bunVersion, on PATH)")
}
else {
    if ($Fix) {
        $bunDir = Add-BunToUserPath -BunPath $bun.Path
        Report "FIXED" "Bun" @("Found off PATH at $($bun.Path); appended $bunDir to the user PATH (new shells pick it up; this session updated too).")
    }
    else {
        Report "WARN" "Bun" @(
            "Installed at $($bun.Path) but not on PATH; the compact-session skill resolves 'bun' from PATH.",
            "Fix: append $(Split-Path $bun.Path -Parent) to the user PATH   (or re-run doctor with -Fix)."
        )
    }
}

# --- Engine smoke runs. An argless invocation loads and transpiles every engine
# --- module before failing with usage text, so exit 1 plus 'Usage:' proves bun
# --- executes the engine. The --check probe then exercises the tuning layer
# --- (ledger.ts, threshold logic) against a crafted one-row transcript.
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

        $checkTranscript = Join-Path $env:TEMP "claude-kit-doctor-check.jsonl"
        $checkRow = '{"type":"assistant","uuid":"a1","parentUuid":null,"sessionId":"00000000-0000-0000-0000-000000000000","timestamp":"2026-01-01T00:00:00.000Z","message":{"id":"m1","role":"assistant","model":"claude-haiku-4-5","content":[{"type":"text","text":"probe"}],"usage":{"input_tokens":100,"cache_read_input_tokens":1000,"output_tokens":5}}}'
        try {
            [System.IO.File]::WriteAllText($checkTranscript, $checkRow + "`n", (New-Object System.Text.UTF8Encoding($false)))
            $checkOutput = & cmd /c "`"$($bun.Path)`" `"$engineCli`" --check --transcript `"$checkTranscript`" 2>&1"
            if ($LASTEXITCODE -eq 0 -and ($checkOutput -join "`n") -match '"status":"check"') {
                Report "PASS" "Engine --check layer" @("Threshold check returns a verdict (compaction trigger/guard/ledger layer operational).")
            }
            else {
                Report "FAIL" "Engine --check layer" @(
                    "Expected exit 0 with check JSON; got exit $LASTEXITCODE.",
                    ($checkOutput | Select-Object -First 3)
                )
            }
        }
        finally {
            Remove-Item $checkTranscript -Force -ErrorAction SilentlyContinue
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

# --- CLI login probe. The compaction summarizer and chain-mode workers need
# --- the CLI's own login (claude /login); the Desktop app authenticates through
# --- its host and leaves the CLI logged out, and a credentials file on disk is
# --- not evidence (observed 2026-07-10: file present, CLI not logged in), so
# --- the only honest check is a live probe. Runs with ANTHROPIC_API_KEY
# --- scrubbed (the summarizer's auth path), from a scratch cwd whose session
# --- debris is deleted afterward. Costs one Haiku call; -NoProbe skips.
if ($NoProbe) {
    Report "INFO" "claude CLI login" @("Probe skipped (-NoProbe).")
}
elseif ($null -eq $claudeCmd) {
    Report "INFO" "claude CLI login" @("Skipped (claude unresolved).")
}
else {
    $probeDir = Join-Path $env:TEMP "claude-kit-doctor-probe"
    $savedApiKey = $env:ANTHROPIC_API_KEY
    try {
        New-Item -ItemType Directory -Force -Path $probeDir | Out-Null
        if ($null -ne $savedApiKey) { Remove-Item env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue }
        # The spawn runs inside a job so a network stall cannot hang the whole
        # doctor; the job process inherits the already-scrubbed environment.
        $probeJob = Start-Job -ScriptBlock {
            param($ClaudeExe, $ProbeDir)
            $output = & cmd /c "cd /d `"$ProbeDir`" && `"$ClaudeExe`" -p --model claude-haiku-4-5 `"Reply with exactly: OK`" < NUL 2>&1"
            [pscustomobject]@{ Output = @($output); ExitCode = $LASTEXITCODE }
        } -ArgumentList $claudeCmd.Source, $probeDir
        if (Wait-Job $probeJob -Timeout 120) {
            $probeResult = Receive-Job $probeJob
            Remove-Job $probeJob -Force -ErrorAction SilentlyContinue
            $probeExit = $probeResult.ExitCode
            $probeOutput = @($probeResult.Output)
            $probeText = $probeOutput -join "`n"
            if ($probeExit -eq 0) {
                Report "PASS" "claude CLI login" @("Headless spawn authenticated (summarizer and chain-mode workers can run here).")
            }
            elseif ($probeText -match "Not logged in") {
                Report "WARN" "claude CLI login" @(
                    "The CLI is not logged in, so the compaction summarizer and headless workers cannot run on this machine.",
                    "(Interactive Desktop/CLI sessions are unaffected.) Fix, one time, in any terminal:  claude /login"
                )
            }
            else {
                Report "WARN" "claude CLI login" @(
                    "Probe failed with exit $probeExit (not the known not-logged-in signature):",
                    ($probeOutput | Select-Object -First 2)
                )
            }
        }
        else {
            Stop-Job $probeJob -ErrorAction SilentlyContinue
            Remove-Job $probeJob -Force -ErrorAction SilentlyContinue
            Report "WARN" "claude CLI login" @(
                "Probe timed out after 120s (network stall or a hung spawn); login state unknown.",
                "Re-run later, or skip this check with -NoProbe."
            )
        }
    }
    finally {
        if ($null -ne $savedApiKey) { $env:ANTHROPIC_API_KEY = $savedApiKey }
        $probeProjectDir = Join-Path $claudeDir ("projects\" + ($probeDir -replace "[^A-Za-z0-9]", "-"))
        Remove-Item $probeProjectDir -Recurse -Force -ErrorAction SilentlyContinue
        # The just-exited spawn's cwd handle can outlive it by a beat and block
        # the directory delete; retry briefly rather than leaving debris.
        foreach ($attempt in 1..3) {
            Remove-Item $probeDir -Recurse -Force -ErrorAction SilentlyContinue
            if (-not (Test-Path $probeDir)) { break }
            Start-Sleep -Milliseconds 500
        }
    }
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

# --- Doctrine import and freshness. The always-on doctrine loads via a one-line
# --- import in ~/.claude/CLAUDE.md; the doctrine-refresh SessionStart hook owns
# --- the sync (it rewrites the file from the installed plugin whenever it
# --- drifts). The freshness check verifies the sync actually happened against
# --- this payload's skill body, using the hook's own frontmatter-strip
# --- semantics, newline-normalized so line endings never false-alarm.
function Get-DoctrineBody {
    param([string]$SkillFile)
    $raw = [System.IO.File]::ReadAllText($SkillFile)
    if ($raw.Length -gt 0 -and $raw[0] -eq [char]0xFEFF) { $raw = $raw.Substring(1) }
    $lines = $raw -split "`n"
    if (($lines[0]).Trim() -ne "---") { return $raw }
    $end = -1
    for ($i = 1; $i -lt $lines.Count; $i++) {
        if (($lines[$i]).Trim() -eq "---") { $end = $i; break }
    }
    if ($end -eq -1) { return $raw }
    $body = ($lines[($end + 1)..($lines.Count - 1)] -join "`n")
    return $body -replace "^`r?`n", ""
}

$claudeMd = Join-Path $claudeDir "CLAUDE.md"
$doctrineFile = Join-Path $claudeDir "claude-kit-doctrine.md"
$doctrineSkill = Join-Path $pluginRoot "skills\operating-instructions\SKILL.md"
$importPresent = (Test-Path $claudeMd) -and ((Get-Content $claudeMd -Raw -ErrorAction SilentlyContinue) -match "@claude-kit-doctrine\.md")
if (-not $importPresent) {
    Report "WARN" "Doctrine import" @("Add this line to $claudeMd so the doctrine loads always-on:  @claude-kit-doctrine.md")
}
elseif (-not (Test-Path $doctrineFile)) {
    Report "WARN" "Doctrine import" @("Import line present but $doctrineFile does not exist yet; the doctrine-refresh hook writes it on the next Claude Code session with the plugin installed.")
}
elseif (Test-Path $doctrineSkill) {
    $expected = (Get-DoctrineBody -SkillFile $doctrineSkill) -replace "`r`n", "`n"
    $installed = ([System.IO.File]::ReadAllText($doctrineFile)) -replace "`r`n", "`n"
    if ($expected.TrimEnd("`n") -eq $installed.TrimEnd("`n")) {
        Report "PASS" "Doctrine import" @("Imported, and the installed copy matches this payload's operating-instructions skill.")
    }
    else {
        Report "WARN" "Doctrine import" @(
            "Imported, but $doctrineFile differs from this payload's skill body.",
            "If the plugin here is current, any Claude Code session refreshes it (the doctrine-refresh hook owns the sync);",
            "if this doctor ran from an outdated clone, update the clone instead."
        )
    }
}
else {
    Report "WARN" "Doctrine import" @("operating-instructions skill not found at $doctrineSkill; cannot verify freshness.")
}

# --- Kaizen signpost + git hooks. Dev-clone concerns: the signpost tells kaizen
# --- capture where this machine's kit clone lives, and hooksPath activates the
# --- pre-commit zip rebuild. From an installed plugin cache, nothing is written
# --- (a cache must never become the kaizen target); an existing signpost is
# --- validated, an absent one is fine for install-only machines.
$signpost = Join-Path $claudeDir "claude-kit.local.json"
if ($isClone) {
    $hooksPath = $null
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $hooksPath = (& git -C $repoRoot config core.hooksPath) 2>$null
    }
    $signpostData = $null
    if (Test-Path $signpost) {
        try { $signpostData = Get-Content $signpost -Raw | ConvertFrom-Json } catch {}
    }
    $signpostValid = ($null -ne $signpostData) -and $signpostData.kitRepoPath -and (Test-Path $signpostData.kitRepoPath)
    $needSignpost = -not $signpostValid
    $needHooks = ($hooksPath -ne ".githooks")
    if ($Fix -and ($needSignpost -or $needHooks)) {
        $fixedNotes = @()
        if ($needSignpost) {
            if (-not (Test-Path $claudeDir)) {
                New-Item -ItemType Directory -Path $claudeDir | Out-Null
            }
            $newSignpost = [ordered]@{ kitRepoPath = $repoRoot; machine = $env:COMPUTERNAME }
            [System.IO.File]::WriteAllText($signpost, ($newSignpost | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
            $fixedNotes += "Wrote $signpost (kitRepoPath -> $repoRoot)."
        }
        elseif ($signpostData.kitRepoPath -ne $repoRoot) {
            # A valid signpost aimed at another clone is a deliberate choice;
            # never silently retarget kaizen capture.
            $fixedNotes += "Left the existing signpost untouched (kitRepoPath: $($signpostData.kitRepoPath)); delete it and re-run -Fix here to retarget."
        }
        if ($needHooks) {
            if (Get-Command git -ErrorAction SilentlyContinue) {
                & git -C $repoRoot config core.hooksPath .githooks
                $fixedNotes += "Set core.hooksPath -> .githooks."
            }
            else {
                $fixedNotes += "git unavailable; core.hooksPath not set."
            }
        }
        Report "FIXED" "Setup (signpost + git hooks)" $fixedNotes
    }
    elseif ($needSignpost -or $needHooks) {
        $setupGaps = @()
        if ($needSignpost) { $setupGaps += "kaizen signpost missing or invalid ($signpost)" }
        if ($needHooks) { $setupGaps += "core.hooksPath is '$hooksPath', not '.githooks' (pre-commit zip rebuild inactive)" }
        Report "WARN" "Setup (signpost + git hooks)" ($setupGaps + @("Fix: re-run doctor with -Fix."))
    }
    else {
        $note = "kitRepoPath: $($signpostData.kitRepoPath)"
        if ($signpostData.kitRepoPath -ne $repoRoot) { $note += "  (a different clone than this one; fine if that is the intended kaizen target)" }
        Report "PASS" "Kaizen signpost" @($note)
    }
}
else {
    if (Test-Path $signpost) {
        $signpostData = $null
        try { $signpostData = Get-Content $signpost -Raw | ConvertFrom-Json } catch {}
        if ($null -ne $signpostData -and (Test-Path $signpostData.kitRepoPath)) {
            Report "PASS" "Kaizen signpost" @("kitRepoPath: $($signpostData.kitRepoPath) (registered clone found on disk).")
        }
        else {
            Report "WARN" "Kaizen signpost" @("$signpost exists but its kitRepoPath is unreadable or missing on disk; re-run doctor -Fix from the intended clone.")
        }
    }
    else {
        Report "INFO" "Kaizen signpost" @("No kit clone registered on this machine (kaizen capture targets a dev clone; fine for install-only machines).")
    }
}

# --- Resume relay (optional). Reports armed state and the AutoHotkey v2
# --- dependency, and runs a dry-run round-trip probe through the watcher (-NoProbe
# --- skips the state-writing probe and does structural detection only). Arming and
# --- the AHK install stay a deliberate act via the arm script: under -Fix the
# --- doctor re-arms only after an explicit consent prompt, and never while a real
# --- request is pending (arming restarts the watcher, which drops its in-flight
# --- request memory).
$relayDir = Join-Path $env:LOCALAPPDATA "claude-kit\resume-relay"
$armScript = Join-Path $relaySourceDir "arm-resume-relay.ps1"
$ahkPaths = @(
    (Join-Path $env:ProgramFiles "AutoHotkey\v2\AutoHotkey64.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\AutoHotkey\v2\AutoHotkey64.exe")
)
$ahkPath = $null
foreach ($candidate in $ahkPaths) {
    if (Test-Path -LiteralPath $candidate) { $ahkPath = $candidate; break }
}
if (-not (Test-Path $relayDir)) {
    $ahkNote = "AutoHotkey v2 not installed (the arm script installs it via winget)."
    if ($null -ne $ahkPath) { $ahkNote = "AutoHotkey v2 present at $ahkPath." }
    Report "INFO" "Resume relay" @("Not armed (optional; interactive compaction works without it). $ahkNote", "Arm: $armScript")
}
else {
    $watcherCopy = Join-Path $relayDir "resume-relay.ahk"
    $shortcut = Join-Path ([Environment]::GetFolderPath("Startup")) "claude-resume-relay.lnk"
    $windowFile = Join-Path $relayDir "window.txt"
    $requestFile = Join-Path $relayDir "request.txt"
    $dryrunFlag = Join-Path $relayDir "dryrun.on"
    $logFile = Join-Path $relayDir "relay.log"

    # Structural gaps that do not themselves abort the round-trip. Any present
    # keeps the overall result at WARN even when the probe otherwise succeeds.
    $structuralIssues = @()
    if ($null -eq $ahkPath) { $structuralIssues += "AutoHotkey v2 not found at either known install path; re-run $armScript (it installs AHK via winget)" }
    if (-not (Test-Path $shortcut)) { $structuralIssues += "Startup shortcut missing (re-run $armScript)" }
    # Stale watcher: a kit update refreshes this plugin's watcher but not the
    # deployed copy the running process was started from, so the machine keeps
    # running old code with no signal. A hash mismatch is that gap.
    $sourceWatcher = Join-Path $relaySourceDir "resume-relay.ahk"
    if ((Test-Path $watcherCopy) -and (Test-Path $sourceWatcher)) {
        try {
            if ((Get-FileHash -LiteralPath $watcherCopy -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $sourceWatcher -Algorithm SHA256).Hash) {
                $structuralIssues += "deployed watcher differs from this plugin's resume-relay.ahk (a kit update since the last arm leaves the old watcher running); re-run $armScript to refresh it"
            }
        } catch {}
    }

    $status = $null
    $detail = @()

    if (-not (Test-Path $watcherCopy)) {
        # Watcher script absent: no round-trip is possible; report and stop.
        $status = "WARN"
        $detail = @("watcher copy missing (re-run $armScript)")
    }
    elseif ($NoProbe) {
        # Structural detection only. The round-trip probe writes relay state
        # (a synthetic marker-protected request), which -NoProbe opts out of.
        $issues = @()
        $windowConfigured = (Test-Path $windowFile) -and -not [string]::IsNullOrWhiteSpace((Get-Content $windowFile -Raw -ErrorAction SilentlyContinue))
        if (-not $windowConfigured) { $issues += "window.txt not configured; the watcher is idle until it names the CLI window (then restart the watcher)" }
        if (Test-Path $dryrunFlag) { $issues += "dryrun.on present ($dryrunFlag); real resume requests are archived as dry-runs and never typed, so the relay is a silent no-op until it is removed" }
        $watcherRunning = $false
        Get-CimInstance Win32_Process -Filter "Name='AutoHotkey64.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -like "*resume-relay.ahk*" } |
            ForEach-Object { $watcherRunning = $true }
        if (-not $watcherRunning) { $issues += "watcher process not running (re-run $armScript or log off/on)" }
        if ($issues.Count -eq 0) {
            $status = "PASS"
            $detail = @("Armed: watcher running, Startup shortcut present, window.txt configured (round-trip skipped by -NoProbe).")
        }
        else {
            $status = "WARN"
            $detail = $issues
        }
    }
    else {
        $windowConfigured = (Test-Path $windowFile) -and -not [string]::IsNullOrWhiteSpace((Get-Content $windowFile -Raw -ErrorAction SilentlyContinue))
        if (-not $windowConfigured -and $Fix) {
            # Re-arming restarts the watcher, so never do it while a real request
            # is pending (a mid-typing kill loses the watcher's handled-request
            # memory). Consent-gated like every other install/repair action.
            if (Test-Path $requestFile) {
                # Leave $windowConfigured false: the pending-request WARN below
                # reports the real gap without disturbing the watcher.
            }
            elseif (Get-Consent "window.txt is not configured. Re-arm the resume relay now (writes the default window.txt and restarts the watcher)?") {
                try { & powershell -NoProfile -ExecutionPolicy Bypass -File $armScript } catch {}
                $windowConfigured = (Test-Path $windowFile) -and -not [string]::IsNullOrWhiteSpace((Get-Content $windowFile -Raw -ErrorAction SilentlyContinue))
            }
        }

        if (-not $windowConfigured) {
            $status = "WARN"
            $detail = @("window.txt not configured; the watcher is idle until it names the CLI window (then restart the watcher)")
        }
        elseif (Test-Path $dryrunFlag) {
            # A pre-existing dry-run flag disarms the relay: every real resume
            # request is archived as a dry-run and never typed. Report it and do
            # not probe (probing would add and remove our own flag around it).
            $status = "WARN"
            $detail = @("dryrun.on present ($dryrunFlag); real resume requests are archived as dry-runs and never typed, so the relay is a silent no-op until it is removed.")
        }
        elseif (Test-Path $requestFile) {
            # A real request is pending; never clobber or race it with a probe.
            $pendingId = ""
            try { $pendingId = (((Get-Content $requestFile -Raw -ErrorAction SilentlyContinue) -split "`n")[0]).Trim() } catch {}
            $status = "WARN"
            $detail = @("a request is already pending in the relay (session '$pendingId'); skipped the round-trip probe so a real resume is not clobbered.")
        }
        else {
            # Round-trip probe: drive a synthetic dry-run request through the
            # running watcher and confirm it logs the resume it would have typed.
            $probeGuid = [guid]::NewGuid().ToString()
            $tempTranscript = Join-Path $env:TEMP ($probeGuid + ".jsonl")
            # The [doctor-dryrun] prompt prefix is the containment: the watcher
            # validates and logs a marked request but never types it. The marker
            # travels inside the request, so no ambient flag lifetime has to
            # outlive an unsynchronized watcher poll (the flag-based protocol
            # lost that race on 2026-07-15 and typed a probe into a live
            # session; concurrent doctor runs also shared one flag).
            $requestBody = $probeGuid + "`n" + $tempTranscript + "`n" + "[doctor-dryrun] doctor resume-relay probe"
            $probeWroteRequest = $false
            $probeSucceeded = $false
            $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
            try {
                $watcherRunning = $false
                Get-CimInstance Win32_Process -Filter "Name='AutoHotkey64.exe'" -ErrorAction SilentlyContinue |
                    Where-Object { $_.CommandLine -like "*resume-relay.ahk*" } |
                    ForEach-Object { $watcherRunning = $true }
                if (-not $watcherRunning -and $Fix -and (Get-Consent "The resume relay watcher is not running. Start it now (re-arm)?")) {
                    try { & powershell -NoProfile -ExecutionPolicy Bypass -File $armScript } catch {}
                    Start-Sleep -Seconds 2
                    Get-CimInstance Win32_Process -Filter "Name='AutoHotkey64.exe'" -ErrorAction SilentlyContinue |
                        Where-Object { $_.CommandLine -like "*resume-relay.ahk*" } |
                        ForEach-Object { $watcherRunning = $true }
                }

                if (-not $watcherRunning) {
                    $status = "WARN"
                    $detail = @("watcher process not running (re-run $armScript or log off/on); round-trip not probed.")
                }
                else {
                    # Compatibility gate: the deployed watcher must understand the
                    # [doctor-dryrun] marker, or the probe request would be typed
                    # for real. Probing an older watcher is refused, never risked.
                    $deployedAhk = Join-Path $relayDir "resume-relay.ahk"
                    $deployedText = ""
                    try { $deployedText = [System.IO.File]::ReadAllText($deployedAhk) } catch {}
                    if (-not $deployedText.Contains("[doctor-dryrun]")) {
                        $status = "WARN"
                        $detail = @("deployed watcher predates the [doctor-dryrun] marker; probing it could type into the terminal, so the round-trip was not probed. Re-arm to update: $armScript")
                    }
                    else {
                        # The watcher validates the transcript by existence and by
                        # a filename matching '<guid>.jsonl'.
                        [System.IO.File]::WriteAllText($tempTranscript, "", $utf8NoBom)

                        # Atomic create-if-absent: if a real request landed between
                        # the earlier check and now, CreateNew throws and the probe
                        # skips rather than overwriting it.
                        $fs = $null
                        $collision = $false
                        try {
                            $fs = [System.IO.File]::Open($requestFile, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
                            $bytes = $utf8NoBom.GetBytes($requestBody)
                            $fs.Write($bytes, 0, $bytes.Length)
                        }
                        catch [System.IO.IOException] {
                            $collision = $true
                        }
                        finally {
                            if ($null -ne $fs) { $fs.Dispose() }
                        }

                        if ($collision) {
                            $status = "WARN"
                            $detail = @("a real request landed during the probe; skipped the round-trip so it is not clobbered.")
                        }
                        else {
                            $probeWroteRequest = $true
                            # Watcher polls every 10s; allow up to 30s for its
                            # dry-run log line naming this GUID.
                            $marker = "DRYRUN: would resume " + [regex]::Escape($probeGuid)
                            $deadline = (Get-Date).AddSeconds(30)
                            while ((Get-Date) -lt $deadline -and -not $probeSucceeded) {
                                Start-Sleep -Seconds 2
                                $logText = ""
                                try { $logText = Get-Content $logFile -Raw -ErrorAction SilentlyContinue } catch {}
                                if ($null -ne $logText -and $logText -match $marker) { $probeSucceeded = $true }
                            }

                            if ($probeSucceeded) {
                                $status = "PASS"
                                $detail = @("resume relay round-trip verified (dryrun)")
                            }
                            else {
                                $status = "WARN"
                                $detail = @(
                                    "round-trip not confirmed within 30s; the watcher may predate the current window.txt, or no matching Windows Terminal window is open (or more than one matches, which the watcher refuses).",
                                    "The watcher reads window.txt only at startup: restart it (re-run $armScript) after changing the file.",
                                    "The probe request is marker-protected ([doctor-dryrun]); an unconfirmed round-trip means it was not processed, never that it was typed.",
                                    "Check the watcher log ($logFile) and window.txt ($windowFile)."
                                )
                            }
                        }
                    }
                }
            }
            catch {
                $status = "WARN"
                $detail = @("round-trip probe errored: $($_.Exception.Message)")
            }
            finally {
                # Teardown removes only what the probe created: the temp
                # transcript and its own request (content-checked so a real
                # request that just landed is never deleted). The probe writes
                # no ambient state: its dry-run containment is the in-request
                # marker, so there is no flag lifetime to sequence and nothing
                # here races the watcher. dryrun.on is never touched (it is the
                # user's disarm-all switch; a pre-existing one WARN-skips the
                # probe before this point).
                Remove-Item $tempTranscript -Force -ErrorAction SilentlyContinue
                if (Test-Path $requestFile) {
                    $curRequest = ""
                    try { $curRequest = [System.IO.File]::ReadAllText($requestFile) } catch {}
                    if ($curRequest -eq $requestBody) { Remove-Item $requestFile -Force -ErrorAction SilentlyContinue }
                }
                # Remove only the probe's own archive entries (content carries the
                # probe GUID); any other archived request belongs to the user.
                foreach ($sub in @("processed", "failed")) {
                    $subDir = Join-Path $relayDir $sub
                    if (Test-Path $subDir) {
                        Get-ChildItem -Path $subDir -File -ErrorAction SilentlyContinue | ForEach-Object {
                            $archived = ""
                            try { $archived = [System.IO.File]::ReadAllText($_.FullName) } catch {}
                            if ($archived -match [regex]::Escape($probeGuid)) { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
                        }
                    }
                }
            }
        }
    }

    # Structural gaps downgrade a passing probe and are appended to the detail.
    if ($structuralIssues.Count -gt 0) {
        if ($status -eq "PASS") { $status = "WARN" }
        $detail = $detail + $structuralIssues
    }
    Report $status "Resume relay" $detail

    # Failed relay requests: unattended runs that never auto-resumed. The
    # requesting session cannot observe its own relay outcome, so surfacing the
    # graveyard here (and in the SessionStart hook) is how a silent stall
    # becomes visible. Read-only, so it runs even under -NoProbe; the round-trip
    # probe's teardown has already reaped its own entries by GUID.
    $failedDir = Join-Path $relayDir "failed"
    if (Test-Path $failedDir) {
        $failedEntries = @(Get-ChildItem -Path $failedDir -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
        if ($failedEntries.Count -gt 0) {
            $newest = $failedEntries[0]
            $newestId = ""
            try { $newestId = (((Get-Content $newest.FullName -Raw -ErrorAction SilentlyContinue) -split "`n")[0]).Trim() } catch {}
            Report "WARN" "Resume relay failures" @(
                "$($failedEntries.Count) failed request(s) in $failedDir; each is an unattended run that never auto-resumed.",
                "Newest: session '$newestId' at $($newest.LastWriteTime).",
                "Resume a stalled run manually: claude --resume <session-id>  in its repo. Reap $failedDir once handled."
            )
        }
    }
}

# --- Kit goal continuity. Fork A's deterministic Stop-hook leash needs
# --- kit-goal-stop.js present and wired into hooks.json's Stop array, or the
# --- leash silently never fires; the lib it depends on must load cleanly
# --- under node; and a clone can be left holding a stale armed goal (the plan
# --- went Complete or was archived without an intervening Stop event to
# --- trigger the hook's own auto-clear), which would leash every session in
# --- that repo against a plan nobody is finishing.
function Get-SanitizedRepoString {
    param([string]$Value)
    # Repo-controlled strings (a plan path from goal-state.json) are stripped
    # to printable ASCII and length-capped before reaching this trusted output
    # channel, matching kit-goal.js's own sanitize() convention.
    $clean = [string]$Value -replace '[^\x20-\x7E]', ''
    if ($clean.Length -gt 120) { $clean = $clean.Substring(0, 120) }
    return $clean
}

$kitGoalStopHook = Join-Path $pluginRoot "hooks\kit-goal-stop.js"
$hooksJsonPath = Join-Path $pluginRoot "hooks\hooks.json"
$hookFileExists = Test-Path -LiteralPath $kitGoalStopHook
$hookWired = $false
$hooksJsonError = $null
if (Test-Path -LiteralPath $hooksJsonPath) {
    try {
        $hooksJsonData = Get-Content $hooksJsonPath -Raw | ConvertFrom-Json
        foreach ($entry in @($hooksJsonData.hooks.Stop)) {
            foreach ($h in @($entry.hooks)) {
                if ($h.command -match "kit-goal-stop\.js") { $hookWired = $true }
            }
        }
    }
    catch {
        $hooksJsonError = $_.Exception.Message
    }
}
if ($hookFileExists -and $hookWired) {
    Report "PASS" "Kit goal hook" @("kit-goal-stop.js present and wired in hooks.json's Stop array.")
}
else {
    $gaps = @()
    if (-not $hookFileExists) { $gaps += "kit-goal-stop.js not found at $kitGoalStopHook" }
    if (-not $hookWired) {
        if (-not (Test-Path -LiteralPath $hooksJsonPath)) { $gaps += "hooks.json not found at $hooksJsonPath" }
        elseif ($hooksJsonError) { $gaps += "hooks.json unparseable: $hooksJsonError" }
        else { $gaps += "hooks.json's Stop array does not reference kit-goal-stop.js" }
    }
    Report "FAIL" "Kit goal hook" ($gaps + @("The kit-native goal leash (fork A) cannot enforce a run without this wiring."))
}

# Load-check the enforcing hook itself, not just its dependency: kit-goal-stop.js
# require()s kit-goal-lib.js, so one probe covers both, and a syntax error or bad
# require in the hook is caught here rather than silently failing at the next
# Stop (leaving the leash dead while every other check reads green). node is
# load-bearing for the entire hook layer (every hook is a 'node ...' command), so
# its absence is a FAIL, not a skip.
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCmd) {
    Report "FAIL" "Kit goal hook loads" @(
        "node is not on PATH, so kit-goal-stop.js (and every kit hook, all of which are 'node ...' commands) cannot run.",
        "Install Node.js and ensure 'node' resolves on PATH."
    )
}
elseif (-not $hookFileExists) {
    Report "INFO" "Kit goal hook loads" @("Skipped (kit-goal-stop.js absent; the Kit goal hook check above already FAILs on that).")
}
else {
    # The hook guards its main() behind require.main, so require() has no side
    # effect. The path is passed as argv, never interpolated into the -e source,
    # so a plugin path containing an apostrophe cannot break the require() string.
    $hookOutput = & $nodeCmd.Source -e "require(process.argv[1])" $kitGoalStopHook 2>&1
    if ($LASTEXITCODE -eq 0) {
        Report "PASS" "Kit goal hook loads" @("kit-goal-stop.js and its kit-goal-lib.js dependency load cleanly under node.")
    }
    else {
        Report "FAIL" "Kit goal hook loads" @("require('kit-goal-stop.js') failed (exit $LASTEXITCODE):", ($hookOutput | Select-Object -First 3))
    }
}

if ($isClone) {
    $goalStatePath = Join-Path $repoRoot ".kit\goal-state.json"
    if (-not (Test-Path -LiteralPath $goalStatePath)) {
        Report "INFO" "Kit goal state" @("No kit goal armed in this clone.")
    }
    else {
        $goalState = $null
        try { $goalState = Get-Content $goalStatePath -Raw | ConvertFrom-Json } catch {}
        if ($null -eq $goalState -or -not $goalState.plan) {
            Report "WARN" "Kit goal state" @("$goalStatePath exists but is unparseable or missing a 'plan' field; a stuck goal may be leashing sessions with no readable state.")
        }
        else {
            # Mirrors kit-goal-lib.js's planHead: an anchored, line-start Status
            # match so body prose containing "in progress" or "complete" cannot
            # misclassify the plan.
            $planSafe = Get-SanitizedRepoString $goalState.plan
            $planRaw = [string]$goalState.plan
            if ($planRaw -match '(^|[\\/])\.\.([\\/]|$)') {
                # armGoal never writes a traversing path, so a plan containing a
                # '..' segment means a hand-edited or corrupt state file; do not
                # follow it out of the repo to read an arbitrary file.
                Report "WARN" "Kit goal state" @("$goalStatePath names a plan path containing '..' ($planSafe); refusing to inspect it. Clear the goal (/kit-goal clear) if it is stale.")
            }
            else {
                $planFull = Join-Path $repoRoot $planRaw
                $planExists = Test-Path -LiteralPath $planFull
                $planStatus = "unknown"
                if ($planExists) {
                    try {
                        $head = Get-Content -LiteralPath $planFull -Raw -ErrorAction Stop
                        if ($head.Length -gt 2048) { $head = $head.Substring(0, 2048) }
                        $inProgress = $head -match "(?im)^status:\s*in\s*progress"
                        $complete = ($head -match "(?im)^status:\s*complete") -and -not $inProgress
                        if ($complete) { $planStatus = "complete" }
                        elseif ($inProgress) { $planStatus = "in progress" }
                    }
                    catch {}
                }
                if (-not $planExists -or $planStatus -eq "complete") {
                    Report "WARN" "Kit goal state" @(
                        "A kit goal is armed for $planSafe but that plan is Complete or archived.",
                        "Clear it (node `"$pluginRoot\hooks\kit-goal.js`" clear, or /kit-goal clear) or it will leash this repo's sessions."
                    )
                }
                else {
                    Report "PASS" "Kit goal state" @("Armed for $planSafe (active).")
                }
            }
        }
    }
}
else {
    Report "INFO" "Kit goal state" @("Skipped (installed plugin cache, not a repo clone; no specific repo to inspect).")
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
