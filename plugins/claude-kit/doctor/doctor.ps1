# Health check and setup for the claude-kit plugin on this machine.
#
# Ships inside the plugin payload so every machine with the plugin installed
# has the current doctor, clone or not. The repo root keeps thin forwarders
# (doctor.ps1 / doctor.cmd) for the dev-clone habit.
#
# Verifies core setup (execution policy, doctrine import and freshness, kaizen
# signpost, git hooks on a clone), the ANTHROPIC_API_KEY hazard, the hook layer
# (goal-leash wiring and load, hook-canary wiring, the memq shim), the memory
# store's sync repo and its allowlist, the embedder behind semantic memory
# search, the .kit/ state directory's exposure, and the auto-compaction window.
#
#   .\doctor.ps1              Check only; prints PASS/WARN/FAIL with remediations.
#   .\doctor.ps1 -Fix         Also applies the safe durable repairs (execution
#                             policy, the memq shim into ~\.claude\bin,
#                             the memory store's sync repo and allowlist,
#                             signpost + git hooks on a clone, and the
#                             autoCompactWindow value written into user
#                             settings.json, behind its own consent prompt).
#                             It deletes nothing.
#   .\doctor.ps1 -Fix -Yes    Pre-answers the consent prompts -Fix already
#                             requested, for unattended runs. It authorizes
#                             nothing by itself.
# If scripts are blocked entirely, use the wrapper beside this file:
#   doctor.cmd [-Fix] [-Yes]
# Exit code: 0 when nothing FAILs (warnings allowed), 1 otherwise.

# An unrecognised switch must be a hard error, not a silent extra argument:
# a simple param block binds one into $args and runs anyway, so a flag this
# script no longer accepts would report a clean run having done nothing.
[CmdletBinding()]
param([switch]$Fix, [switch]$Yes)

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

# Consent gate for an action that changes this machine: installing software, or
# writing a value into user settings. Only ever true under -Fix; -Yes pre-answers
# for unattended runs (it consents to what -Fix already asked for, it never asks
# for more); a non-interactive host that cannot prompt declines rather than
# stalling.
#
# -Interactive withholds the -Yes shortcut for the one class of action -Yes must
# not cover: replacing a value the operator chose, as opposed to supplying one
# that is missing or repairing state the kit itself owns. That class is not
# idempotent against intent. An unattended run cannot tell a deliberate setting
# from a stale one, so it would revert the deliberate one, and would do it again
# after every retune of the constant it compares against. Such an action asks for
# more than the flags did, so it waits for a person.
function Get-Consent {
    param([string]$Question, [switch]$Interactive)
    if (-not $Fix) { return $false }
    if ($Yes -and -not $Interactive) { return $true }
    # The unattended remedy is real advice for an ordinary prompt and false
    # advice for an -Interactive one, where -Yes is exactly what does not apply.
    $unattendedNote = if ($Interactive) { "this one needs a person, since it replaces a value you chose" } else { "add -Yes to consent unattended" }
    try {
        $answer = Read-Host "$Question [y/N]"
        if ([string]::IsNullOrWhiteSpace($answer)) {
            Write-Host "        (no answer; declining. A redirected stdin cannot answer prompts; $unattendedNote.)"
            return $false
        }
        return $answer -match '^[Yy]'
    }
    catch {
        Write-Host "        (non-interactive host; skipping the prompt. $unattendedNote.)"
        return $false
    }
}

function Get-SanitizedLine {
    param([string]$Value, [int]$MaxLength = 120)
    # Strings this script did not author (a plan path from goal-state.json) are
    # stripped to printable ASCII and length-bounded before reaching this trusted
    # output channel, so a hostile file cannot smuggle escape sequences past a
    # reader's eyes or emit unbounded output. It does not make the text safe to
    # obey: bounded printable ASCII still carries a sentence, so treat what it
    # returns as data. Matches kit-goal.js's own sanitize() convention, with the
    # cap per channel because a truncated string is only acceptable where nothing
    # compares it. Truncation is always visible: a silently cut line would let two
    # values that share a prefix print identically, and a reader comparing what is
    # printed would read them as equal.
    $clean = [string]$Value -replace '[^\x20-\x7E]', ''
    if ($clean.Length -gt $MaxLength) {
        $dropped = $clean.Length - $MaxLength
        $clean = $clean.Substring(0, $MaxLength) + "... [+" + $dropped + " more chars]"
    }
    return $clean
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

# Shim install, integrity, and PATH-membership helpers, beside this script.
# Dot-sourced here rather than at the check, because Add-ToUserPath below
# uses the PATH predicate it defines.
. (Join-Path $PSScriptRoot "install-memq-shim.ps1")

# Memory-sync allowlist, state, and initialization helpers, beside this
# script. It resolves no paths of its own: this script is the only caller that
# knows the real store root, and passes it in.
. (Join-Path $PSScriptRoot "install-memory-sync.ps1")

# Embedder probe, install, and index-health helpers, beside this script. It
# resolves no paths of its own either: this script is the only caller that
# knows the real embedder root and store root, and passes both in.
. (Join-Path $PSScriptRoot "install-embedder.ps1")

# Auto-compaction-window writer for user settings.json, beside this script.
# It resolves no paths of its own: this script passes the settings path in,
# and the test suite passes a sandbox path.
. (Join-Path $PSScriptRoot "install-compact-window.ps1")

# Append a directory to the durable user PATH, and to this process's PATH so
# the current run sees it too. Every kit PATH repair goes through this one
# function.
#
# The registry value is read and written raw. [Environment]::GetEnvironment-
# Variable expands a REG_EXPAND_SZ Path, and SetEnvironmentVariable under
# Windows PowerShell writes back as REG_SZ, so a read-modify-write through
# that API permanently flattens entries such as %USERPROFILE%\bin into
# today's values. Reading with DoNotExpandEnvironmentNames and writing with
# the value's own kind keeps them intact. Membership is the exact per-entry
# compare from Test-UserPathContains, so a directory is never judged present
# because another entry contains its name as a substring, and the separator is
# added only between entries, so an empty Path never gains a leading ';' (an
# empty PATH entry means the current directory, which is a resolution hazard).
# Returns $true when the durable value now lists the directory. A failure is
# reported by the caller rather than thrown: a PATH edit that cannot be made
# is one finding, never a reason to abandon the rest of the health check.
function Add-ToUserPath {
    param([Parameter(Mandatory = $true)][string]$Directory)
    $durable = $false
    $key = $null
    try {
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
        if ($null -ne $key) {
            $raw = ""
            $existing = $key.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
            if ($null -ne $existing) { $raw = [string]$existing }
            # Keep the value's own kind; a Path that does not exist yet is
            # created as ExpandString, which is what Windows itself uses.
            $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
            try {
                $existingKind = $key.GetValueKind("Path")
                if ($existingKind -eq [Microsoft.Win32.RegistryValueKind]::String -or
                    $existingKind -eq [Microsoft.Win32.RegistryValueKind]::ExpandString) {
                    $kind = $existingKind
                }
            }
            catch { <# no existing value: the ExpandString default stands #> }
            if (Test-UserPathContains -RawPath $raw -Directory $Directory) { $durable = $true }
            else {
                $trimmed = $raw.TrimEnd(";")
                $updated = if ($trimmed -eq "") { $Directory } else { $trimmed + ";" + $Directory }
                $key.SetValue("Path", $updated, $kind)
                $durable = $true
            }
        }
    }
    catch { $durable = $false }
    finally { if ($null -ne $key) { $key.Close() } }
    # This process too, so the rest of the run sees the directory.
    if (-not (Test-UserPathContains -RawPath $env:Path -Directory $Directory)) {
        $env:Path = if ($env:Path.TrimEnd(";") -eq "") { $Directory } else { $env:Path.TrimEnd(";") + ";" + $Directory }
    }
    return $durable
}

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
# --- .ps1 in the kit (the doctor itself, whenever it is launched without the
# --- .cmd wrapper). RemoteSigned is sufficient; Unrestricted is broader than the
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
        "doctor.cmd still runs (Bypass at launch); a plain .ps1 launch is unverified on this machine."
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

# --- ANTHROPIC_API_KEY. A durable (User/Machine) value reaches every Claude Code
# --- session on this machine, flipping auth off the subscription login and onto
# --- API billing, silently: nothing in the session announces the switch.
$apiKeyScopes = @()
if ($env:ANTHROPIC_API_KEY) { $apiKeyScopes += "process" }
if ([Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "User")) { $apiKeyScopes += "User" }
if ([Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "Machine")) { $apiKeyScopes += "Machine" }
if ($apiKeyScopes.Count -eq 0) {
    Report "PASS" "ANTHROPIC_API_KEY" @("Not set; sessions authenticate via the claude.ai login.")
}
else {
    # Only a User or Machine value reaches sessions this shell did not start; a
    # process-scope value came from whatever launched this shell and dies with it.
    $apiKeyDurable = @($apiKeyScopes | Where-Object { $_ -ne "process" })
    $apiKeyDetail = @(("Set at scope: " + ($apiKeyScopes -join ", ") + "."))
    if ($apiKeyDurable.Count -gt 0) {
        $apiKeyDetail += @(
            "Every session started on this machine inherits it and switches to API-key auth, silently.",
            "Unset the durable value if it is not needed, or scrub it per command",
            "(Bash: env -u ANTHROPIC_API_KEY claude ...)."
        )
    }
    else {
        $apiKeyDetail += @(
            "Process scope only: this shell and its children switch to API-key auth, and sessions started",
            "elsewhere on this machine keep the claude.ai login. Whatever launched this shell exported it;",
            "scrub it per command if a session started from here should not use API-key auth",
            "(Bash: env -u ANTHROPIC_API_KEY claude ...)."
        )
    }
    Report "WARN" "ANTHROPIC_API_KEY" $apiKeyDetail
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
$importPresent = (Test-Path $claudeMd) -and ((Get-Content $claudeMd -Raw -Encoding UTF8 -ErrorAction SilentlyContinue) -match "@claude-kit-doctrine\.md")
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
# --- validated, an absent one is fine for install-only machines. The signpost
# --- may already carry operator-set keys this fix path does not own
# --- (compactNudgeFloor among them), so a rewrite merges into the parsed
# --- object rather than replacing it wholesale; only a signpost that is
# --- absent, or whose contents do not parse as a JSON object, falls back to
# --- the plain two-key template, since a merge has nothing to merge into
# --- either way. The rewrite goes to a sibling temp file that is renamed into
# --- place: a rename replaces the directory entry, so no link of any kind
# --- standing at the signpost path is ever written through, and an
# --- interrupted run cannot leave a truncated signpost. A link found there is
# --- reported and the write skipped, so an operator who pointed this path at
# --- a dotfiles repo hears about it rather than finding a real file where
# --- their link was.
$signpost = Join-Path $claudeDir "claude-kit.local.json"
$signpostItem = Get-Item -LiteralPath $signpost -Force -ErrorAction SilentlyContinue
$signpostIsSymlink = ($null -ne $signpostItem) -and (($signpostItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
if ($isClone) {
    $hooksPath = $null
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $hooksPath = (& git -C $repoRoot config core.hooksPath) 2>$null
    }
    $signpostData = $null
    if (Test-Path $signpost) {
        try { $signpostData = Get-Content $signpost -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
    }
    $signpostValid = ($null -ne $signpostData) -and $signpostData.kitRepoPath -and (Test-Path $signpostData.kitRepoPath)
    $needSignpost = -not $signpostValid
    $needHooks = ($hooksPath -ne ".githooks")
    if ($Fix -and ($needSignpost -or $needHooks)) {
        $fixedNotes = @()
        $refusedNotes = @()
        if ($needSignpost) {
            if ($signpostIsSymlink) {
                # A link at the signpost path is reported and left alone
                # rather than replaced. The rename below would replace it
                # safely, which is the point: an operator who deliberately
                # linked this path out of a dotfiles repo would lose the link
                # silently, so the write is skipped and named instead. The
                # note rides its own WARN rather than the FIXED list, since
                # nothing was written and a planted link is worth a colour.
                $refusedNotes += "Refused to write ${signpost}: it is a link. Remove it and re-run doctor -Fix so the signpost is written as a real file."
            }
            else {
                if (-not (Test-Path $claudeDir)) {
                    New-Item -ItemType Directory -Path $claudeDir | Out-Null
                }
                # $signpostData already holds the parsed object whenever the
                # signpost parsed to one (including the case reached here: it
                # parses fine but its kitRepoPath no longer resolves), so
                # merging is just overwriting the two owned keys on that same
                # object. JSON that parses to an array or a scalar is not a
                # thing to merge into - its PSObject.Properties are .NET
                # adapter members such as Count and SyncRoot, which would land
                # in the operator's config as keys - so it takes the same
                # two-key template as an absent or unparseable signpost.
                if ($signpostData -is [System.Management.Automation.PSCustomObject]) {
                    $newSignpost = [ordered]@{}
                    foreach ($prop in $signpostData.PSObject.Properties) { $newSignpost[$prop.Name] = $prop.Value }
                    $newSignpost['kitRepoPath'] = $repoRoot
                    $newSignpost['machine'] = $env:COMPUTERNAME
                }
                else {
                    $newSignpost = [ordered]@{ kitRepoPath = $repoRoot; machine = $env:COMPUTERNAME }
                }
                # -Depth 100 because the default of 2 renders anything deeper
                # as a PowerShell ToString() of the object, unrecoverably, and
                # the operator keys being preserved here are exactly what that
                # would corrupt. The write lands on a sibling temp file and is
                # renamed over the signpost: Move-Item -Force replaces the
                # directory entry, so a hard link at the signpost path keeps
                # its other name intact. (The .NET Core three-argument
                # File::Move overload with overwrite does not exist in the
                # Windows PowerShell 5.1 that doctor.cmd launches.)
                $signpostTmp = "$signpost.tmp"
                [System.IO.File]::WriteAllText($signpostTmp, ($newSignpost | ConvertTo-Json -Depth 100), (New-Object System.Text.UTF8Encoding($false)))
                Move-Item -LiteralPath $signpostTmp -Destination $signpost -Force
                $fixedNotes += "Wrote $signpost (kitRepoPath -> $repoRoot)."
            }
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
        if ($refusedNotes.Count -gt 0) { Report "WARN" "Setup (signpost)" $refusedNotes }
        if ($fixedNotes.Count -gt 0) { Report "FIXED" "Setup (signpost + git hooks)" $fixedNotes }
    }
    elseif ($needSignpost -or $needHooks) {
        $setupGaps = @()
        # Naming the link as the blocker is what keeps this branch from
        # sending the operator round a loop it cannot leave: -Fix refuses the
        # link too, so "re-run with -Fix" alone is advice that cannot work.
        if ($needSignpost -and $signpostIsSymlink) { $setupGaps += "kaizen signpost path is a link ($signpost); the fix path refuses to write through it" }
        elseif ($needSignpost) { $setupGaps += "kaizen signpost missing or invalid ($signpost)" }
        if ($needHooks) { $setupGaps += "core.hooksPath is '$hooksPath', not '.githooks' (pre-commit zip rebuild inactive)" }
        $fixAdvice = if ($needSignpost -and $signpostIsSymlink) { "Fix: remove the link at $signpost, then re-run doctor with -Fix." } else { "Fix: re-run doctor with -Fix." }
        Report "WARN" "Setup (signpost + git hooks)" ($setupGaps + @($fixAdvice))
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
        try { $signpostData = Get-Content $signpost -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
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

# --- Kit goal continuity. The deterministic Stop-hook leash needs
# --- kit-goal-stop.js present and wired into hooks.json's Stop array, or the
# --- leash silently never fires; the lib it depends on must load cleanly
# --- under node; and a clone can be left holding a stale armed goal (the plan
# --- went Complete or was archived without an intervening Stop event to
# --- trigger the hook's own auto-clear), which would leash every session in
# --- that repo against a plan nobody is finishing.
$kitGoalStopHook = Join-Path $pluginRoot "hooks\kit-goal-stop.js"
$hooksJsonPath = Join-Path $pluginRoot "hooks\hooks.json"
$hookFileExists = Test-Path -LiteralPath $kitGoalStopHook
$hookWired = $false
$hooksJsonError = $null
if (Test-Path -LiteralPath $hooksJsonPath) {
    try {
        $hooksJsonData = Get-Content -LiteralPath $hooksJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
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
    Report "FAIL" "Kit goal hook" ($gaps + @("The kit-native goal leash cannot enforce a run without this wiring."))
}

# --- Hook canary. The SessionStart-hook canary probes the plugin cache to catch
# --- broken hooks at session start; it needs hook-canary.js present and wired
# --- into hooks.json's SessionStart array, or the cache breaks silently and every
# --- session runs without the canary guard.
$hookCanaryHook = Join-Path $pluginRoot "hooks\hook-canary.js"
$canaryHooksJsonPath = Join-Path $pluginRoot "hooks\hooks.json"
$canaryHookFileExists = Test-Path -LiteralPath $hookCanaryHook
$canaryWired = $false
$canaryHooksJsonError = $null
if (Test-Path -LiteralPath $canaryHooksJsonPath) {
    try {
        $canaryHooksJsonData = Get-Content -LiteralPath $canaryHooksJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($entry in @($canaryHooksJsonData.hooks.SessionStart)) {
            foreach ($h in @($entry.hooks)) {
                if ($h.command -match "hook-canary\.js") { $canaryWired = $true }
            }
        }
    }
    catch {
        $canaryHooksJsonError = $_.Exception.Message
    }
}
if ($canaryHookFileExists -and $canaryWired) {
    Report "PASS" "Hook canary" @("hook-canary.js present and wired in hooks.json's SessionStart array.")
}
else {
    $gaps = @()
    if (-not $canaryHookFileExists) { $gaps += "hook-canary.js not found at $hookCanaryHook" }
    if (-not $canaryWired) {
        if (-not (Test-Path -LiteralPath $canaryHooksJsonPath)) { $gaps += "hooks.json not found at $canaryHooksJsonPath" }
        elseif ($canaryHooksJsonError) { $gaps += "hooks.json unparseable: $canaryHooksJsonError" }
        else { $gaps += "hooks.json's SessionStart array does not reference hook-canary.js" }
    }
    Report "FAIL" "Hook canary" ($gaps + @("The cache canary probe cannot run without this wiring."))
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

# --- memq shim. The kit memory store's CLI (memq) ships inside the plugin
# --- payload, and the payload's cache path changes with every release, so
# --- nothing durable may point at it. The shim installed at ~\.claude\bin
# --- re-resolves the installed payload at each invocation, which is what lets
# --- a kit update land without touching the shim; only a first install or a
# --- moved ~\.claude needs -Fix. install-memq-shim.ps1 (dot-sourced near the
# --- top of this script) owns the file layout, the integrity comparison, and
# --- the name-resolution reading, so the repo test suite exercises the same
# --- functions against redirected directories.
# ---
# --- Under -Fix the install always runs when anything is missing OR differs
# --- from this payload's copy: the copy is idempotent, and a check that
# --- prints "re-run with -Fix" while -Fix cannot reach the repair is a
# --- promise the code does not keep. Integrity is a content comparison
# --- (hash for the resolver, exact text for the wrappers), because a smoke
# --- run only proves that something ran, and anything that took the shim's
# --- place would pass it.
if ($null -eq $nodeCmd) {
    Report "INFO" "memq shim" @("Skipped (node unresolved; the hook check above already FAILs on that, and the shim runs under node).")
}
else {
    $memqShim = Get-MemqShimStatus -PluginRoot $pluginRoot -ClaudeDir $claudeDir -NodeExe $nodeCmd.Source
    $memqBinDir = $memqShim.BinDir
    $memqFixNotes = @()
    $memqReported = $false

    if ($Fix -and ($memqShim.Missing.Count -gt 0 -or $memqShim.Stale.Count -gt 0)) {
        $memqInstall = Install-MemqShim -PluginRoot $pluginRoot -ClaudeDir $claudeDir
        if (-not $memqInstall.Ok) {
            Report "FAIL" "memq shim" $memqInstall.Notes
            $memqReported = $true
        }
        else {
            $memqFixNotes += $memqInstall.Notes
            # Re-read after writing: the report describes the state on disk
            # now, never the state that prompted the repair.
            $memqShim = Get-MemqShimStatus -PluginRoot $pluginRoot -ClaudeDir $claudeDir -NodeExe $nodeCmd.Source
        }
    }

    if (-not $memqReported) {
        $memqGaps = @()
        if ($memqShim.Missing.Count -gt 0) {
            $memqGaps += ("Missing at ${memqBinDir}: " + ($memqShim.Missing -join ", ") + ".")
        }
        if ($memqShim.Stale.Count -gt 0) {
            $memqGaps += ("Differs from this payload's copy at ${memqBinDir}: " + ($memqShim.Stale -join ", ") + ".")
        }

        if ($memqGaps.Count -gt 0) {
            Report "FAIL" "memq shim" ($memqGaps + @(
                "The memory-system skill's memq commands cannot be trusted to run this payload's memq.",
                "Fix: re-run doctor with -Fix (reinstalls the shim files and wires PATH)."
            ))
        }
        elseif ($memqShim.NoPayload) {
            # No installed plugin to resolve: a clone-only machine, where no
            # -Fix can help because the shim runs the installed payload by
            # design. A warning with the real remediation, never a FAIL that
            # nothing on this machine can clear.
            Report "WARN" "memq shim" @(
                "Installed at $memqBinDir, but no claude-kit plugin payload is installed under ~\.claude\plugins for it to run.",
                "Install the plugin (/plugin marketplace add, then install claude-kit); the shim picks it up with no doctor re-run."
            )
        }
        elseif (-not $memqShim.Resolves) {
            Report "FAIL" "memq shim" @(
                "Installed at $memqBinDir, but running it did not reach memq's usage banner, so the shim or the payload it found is damaged.",
                (Get-SanitizedLine ("Shim output: " + $memqShim.Detail) 200),
                "Fix: re-run doctor with -Fix (reinstalls the shim files from this payload)."
            )
        }
        elseif ($null -ne $memqShim.ShadowedBy) {
            # Another memq wins name resolution, so typing `memq` does not run
            # the kit's. PATH is appended to, so an earlier entry always wins
            # and no -Fix here can outrank it: the path is named instead.
            Report "FAIL" "memq shim" ($memqFixNotes + @(
                "The shim is installed and healthy at $memqBinDir, but the name 'memq' resolves elsewhere:",
                ("  " + (Get-SanitizedLine $memqShim.ShadowedBy 200)),
                "That file runs instead of the kit's shim. Remove it, or order its directory after $memqBinDir on PATH."
            ))
        }
        elseif (-not $memqShim.OnPath) {
            # PATH is wired only once the shim is known healthy, so a broken
            # install never leaves PATH pointing at a non-functional memq.
            if ($Fix) {
                if (Add-ToUserPath -Directory $memqBinDir) {
                    Report "FIXED" "memq shim" ($memqFixNotes + @(
                        "Appended $memqBinDir to the user PATH (new shells resolve 'memq'; this session updated too)."
                    ))
                }
                else {
                    Report "WARN" "memq shim" ($memqFixNotes + @(
                        "The shim is installed and healthy at $memqBinDir, but the durable user PATH could not be written.",
                        "Add $memqBinDir to your user PATH by hand, or new shells will not resolve 'memq'."
                    ))
                }
            }
            else {
                Report "WARN" "memq shim" @(
                    "Installed and resolving at $memqBinDir, but that directory is not on PATH, so 'memq' will not resolve in a shell.",
                    "Fix: append $memqBinDir to the user PATH   (or re-run doctor with -Fix)."
                )
            }
        }
        elseif ($memqFixNotes.Count -gt 0) {
            Report "FIXED" "memq shim" ($memqFixNotes + @(
                "$memqBinDir is on PATH, and the shim resolves the installed payload at each invocation."
            ))
        }
        else {
            Report "PASS" "memq shim" @("$memqBinDir is on PATH, and the shim matches this payload and resolves it at each invocation.")
        }
    }
}

# --- Memory sync. The memory store is ~\.claude itself, which also holds
# --- .credentials.json, settings.json, history.jsonl, and every session
# --- transcript, so the sync repo carries an allowlist that excludes
# --- everything and re-includes only the memory tiers and the coordinator
# --- directory. That allowlist is the entire barrier between syncing
# --- memories and publishing credentials, which is why this check
# --- re-derives it on every run and proves the
# --- negative directly (check-ignore on the sensitive files, a dry-run add,
# --- the tracked-file list, and committed history) rather than trusting a file
# --- that merely looks right. Any drift is a FAIL, never a warning. Every leak
# --- probe is printed in every state the section can report, because the
# --- states where the allowlist is least trustworthy are exactly the ones
# --- where a staged or committed secret most needs naming.
# ---
# --- install-memory-sync.ps1 (dot-sourced near the top of this script) owns
# --- the canonical text, the state reading, and the initialization, so the
# --- repo test suite exercises the same functions against a redirected store
# --- root. -Fix is additive: it initializes the repo, writes the two managed
# --- files, and commits what the allowlist admits. It never replaces a .git
# --- it did not create, and never rewrites a .gitignore or .gitattributes
# --- that does not carry the doctor's marker line.

# The leak probes as report lines, plus what to do about them, plus what to say
# when a probe could not answer. Every branch of the section below prints all
# three, because a report that names a broken allowlist without naming what is
# already staged or committed under it reads as reassurance, and a report whose
# leak list is empty because a probe errored reads as a clean index.
function Get-MemorySyncReportLines {
    param($Status)
    $leaks = @()
    foreach ($probe in $Status.NotIgnored) { $leaks += ("Not ignored: " + (Get-SanitizedLine $probe 200)) }
    foreach ($path in ($Status.Unexpected | Select-Object -First 5)) { $leaks += ("An add would stage: " + (Get-SanitizedLine $path 200)) }
    if ($Status.Unexpected.Count -gt 5) { $leaks += ("... and $($Status.Unexpected.Count - 5) more path(s) an add would stage.") }
    foreach ($path in ($Status.Tracked | Select-Object -First 5)) { $leaks += ("Already tracked: " + (Get-SanitizedLine $path 200)) }
    if ($Status.Tracked.Count -gt 5) { $leaks += ("... and $($Status.Tracked.Count - 5) more tracked path(s).") }
    foreach ($path in ($Status.HistoryPaths | Select-Object -First 5)) { $leaks += ("In committed history: " + (Get-SanitizedLine $path 200)) }
    if ($Status.HistoryPaths.Count -gt 5) { $leaks += ("... and $($Status.HistoryPaths.Count - 5) more path(s) in committed history.") }

    # A path in history is its own remedy: untracking leaves the blob
    # reachable, so only a rewrite removes it, and anything secret it held is
    # spent.
    $fixes = @("Untrack what should not be there (git rm --cached) and re-run this check; the doctor removes nothing.")
    if ($Status.HistoryPaths.Count -gt 0) {
        $fixes += "A path already committed stays reachable after git rm --cached: rewrite the history (or start the repository over) and rotate every credential that ever appeared in it."
    }

    # A probe that did not answer is the difference between a clean index and
    # an unread one, and the two are indistinguishable from an empty result
    # set, so the count says how much of the negative was actually proven.
    $unproven = @()
    if ($Status.IsRepo -and -not $Status.ProbesRan) {
        $unproven += ("Only " + $Status.ProbesAnswered + " of " + $Status.ProbesAttempted +
            " direct probes could answer, so the lines above are not a full account of what this repository holds and the negative is unproven.")
        $unproven += @($Status.Notes | ForEach-Object { Get-SanitizedLine $_ 200 })
    }
    # Outside a repository there is no probe to run and no index to read, so
    # any note is what the status has to say about the store root itself.
    $context = @()
    if (-not $Status.IsRepo) { $context += @($Status.Notes | ForEach-Object { Get-SanitizedLine $_ 200 }) }
    return @{ Leaks = $leaks; Fixes = $fixes; Unproven = $unproven; Context = $context }
}

# Whether a push from this store would reach the branch another machine's pull
# reads. Split by what an operator choice can explain: a detached HEAD, a
# branch tracking nothing, an upstream on some other remote, and a push.default
# that refuses this pair of branch names or refuses to push at all are broken in
# ways nobody opts into, so they block. A second branch on origin is the
# reported silent case, but a backup or an abandoned branch explains it too, so
# it is named rather than failed on: a check that exits 1 over a stale ref
# teaches the operator to stop reading this section.
function Get-MemorySyncDestinationLines {
    param($Status)
    $blocking = @()
    $advisory = @()

    if ($Status.Detached) {
        $blocking += "HEAD is detached, so commits here belong to no branch and a push sends nothing."
    }
    elseif ($Status.Branch -ne "" -and $Status.Upstream -eq "") {
        $blocking += ("Branch " + (Get-SanitizedLine $Status.Branch 200) +
            " tracks no upstream, so the close-out's pull and push have no destination.")
    }
    elseif ($Status.Upstream -ne "" -and -not $Status.Upstream.StartsWith("origin/")) {
        $blocking += ("Branch " + (Get-SanitizedLine $Status.Branch 200) + " tracks " +
            (Get-SanitizedLine $Status.Upstream 200) + ", which is not the origin reported above.")
    }

    # A branch that tracks a real branch on origin and still cannot publish to
    # it. The sync runner's push leg is a bare `git push`, so what happens to
    # this store's memories is push.default's to decide, and every check above
    # reads clean in each of the states below.
    #
    # git compares the raw branch.<name>.merge value against refs/heads/<local
    # branch> byte for byte, so the comparison is ordinal over the raw ref: a
    # case-only difference and a short form (`merge = main`) are both refusals
    # a normalized or case-insensitive comparison would call a match.
    $mergeRef = [string]$Status.UpstreamMergeRef
    $pairMismatch = ($Status.Branch -ne "" -and $mergeRef -ne "" -and
        -not [string]::Equals("refs/heads/" + $Status.Branch, $mergeRef, [System.StringComparison]::Ordinal))

    # The rename remedy is printed as a runnable command only where pasting it
    # is safe. Get-SanitizedLine guarantees printable ASCII, which is the
    # character set shell metacharacters live in, and git accepts `;`, `&&`,
    # `|`, `$()` and quotes in a branch name, so both names must also be within
    # a charset that carries none of them and must survive the sanitizer
    # unchanged, truncation marker included. Each name must also open on an
    # alphanumeric: a leading `-` carries no shell meaning at all, but git
    # reads it as an option, so a branch named `-f` composes
    # `git branch -m -f <upstream>`, a forced rename that clobbers an existing
    # ref rather than the rename this line advertises. A merge ref outside
    # refs/heads/ names no branch to rename to at all. Where any of that fails
    # the finding is still reported, in prose: refusing to print a command is
    # the answer, not quoting it.
    $renameSafe = ($pairMismatch -and
        $mergeRef.StartsWith("refs/heads/", [System.StringComparison]::Ordinal) -and
        $Status.Branch -match '^[A-Za-z0-9][A-Za-z0-9._/-]*$' -and
        $Status.UpstreamBranch -match '^[A-Za-z0-9][A-Za-z0-9._/-]*$' -and
        (Get-SanitizedLine $Status.Branch 200) -eq $Status.Branch -and
        (Get-SanitizedLine $Status.UpstreamBranch 200) -eq $Status.UpstreamBranch)
    $renameFix = @()
    if ($renameSafe) {
        $renameFix += ("Fix: rename the local branch to match its upstream (git branch -m " +
            (Get-SanitizedLine $Status.Branch 200) + " " + (Get-SanitizedLine $Status.UpstreamBranch 200) +
            ") in the store root.")
    }
    elseif ($pairMismatch) {
        $renameFix += ("Fix: rename the local branch " + (Get-SanitizedLine $Status.Branch 200) + " to " +
            (Get-SanitizedLine $Status.UpstreamBranch 200) +
            " in the store root. These branch names carry characters that make a pasted command unsafe, so no runnable command is printed here.")
    }

    # The value is matched case-sensitively because git parses it that way and
    # errors on anything it does not recognize, `Simple` included.
    $pushDefault = [string]$Status.PushDefault
    $setPushDefaultFix = "Fix: set push.default to simple in the store root (git config push.default simple)."
    if ($pushDefault -ceq "upstream" -or $pushDefault -ceq "tracking") {
        # The push follows the upstream ref whatever the two names are, so a
        # differing pair costs nothing and is not a finding.
    }
    elseif ($pushDefault -ceq "simple") {
        if ($pairMismatch) {
            # Fatal on every run, while every check above it reads clean.
            $blocking += ("Branch " + (Get-SanitizedLine $Status.Branch 200) + " tracks " +
                (Get-SanitizedLine $Status.Upstream 200) +
                ", and push.default simple refuses a push whose branch names differ, so the store's automated push fails on every run.")
            $blocking += $renameFix
        }
    }
    elseif ($pushDefault -ceq "matching") {
        if ($pairMismatch) {
            # The quietest of the set: matching updates only branches carrying
            # the same name on both ends, so a differing pair matches nothing
            # and the runner records a success for a push that published
            # nothing.
            $blocking += ("Branch " + (Get-SanitizedLine $Status.Branch 200) + " tracks " +
                (Get-SanitizedLine $Status.Upstream 200) +
                ", and push.default matching updates only branches that carry the same name on both ends, so the store's automated push exits successfully while publishing nothing to the branch this store pulls from.")
            $blocking += $renameFix
        }
    }
    elseif ($pushDefault -ceq "nothing") {
        # Names are irrelevant here: a bare push under this setting errors out
        # for want of a refspec, matched pair or not.
        $blocking += "push.default is set to nothing, so a bare push errors out for want of a refspec and the store's automated push fails on every run, whatever the branch names are."
        $blocking += $setPushDefaultFix
    }
    elseif ($pushDefault -ceq "current") {
        if ($pairMismatch) {
            # The push succeeds, and lands on a branch named after the local
            # one rather than on the upstream this store pulls from. Advisory
            # rather than blocking: the memories are published, just where no
            # other machine reads them.
            $advisory += ("Branch " + (Get-SanitizedLine $Status.Branch 200) + " tracks " +
                (Get-SanitizedLine $Status.Upstream 200) +
                ", and push.default current publishes to the branch on origin named after the local branch, so this store's memories land somewhere the other machines never pull from.")
            $advisory += $renameFix
        }
    }
    else {
        $blocking += ("push.default is set to " + (Get-SanitizedLine $pushDefault 200) +
            ", which git does not recognize, so it refuses every push in this store as a malformed config value.")
        $blocking += $setPushDefaultFix
    }

    $others = @($Status.RemoteBranches | Where-Object { $_ -ne $Status.Upstream })
    if ($Status.Upstream -ne "" -and $others.Count -gt 0) {
        $advisory += ("This machine tracks " + (Get-SanitizedLine $Status.Upstream 200) + ", and origin also carries " +
            (($others | Select-Object -First 5 | ForEach-Object { Get-SanitizedLine $_ 200 }) -join ", ") +
            ". A machine pushing to one of those never reaches this store, and neither side reports an error.")
        $advisory += "That reads local refs as of the last fetch; this check makes no network call."
    }
    return @{ Blocking = $blocking; Advisory = $advisory }
}

# The paths a fetched upstream commit writes into this machine's own
# coordinator directory, as report lines. The sync runner refuses such an
# intake and records the reason code alone, its only output channel being the
# state file, so this is where the operator who has to repair the remote learns
# WHICH commit and WHICH paths: the runner leaves the fetched tip in place for
# exactly that reason. The read is the runner's own
# (Get-MemorySyncInboundForeignPaths), so the report cannot name a different
# set than the refusal acted on.
#
# No ahead/behind count is read first: the diff runs from the merge base of
# HEAD and the fetched tip, which is the tip itself when the upstream is not
# ahead, so an in-sync or ahead-only store produces an empty diff by
# construction and no lines here. Every string comes out of the store, so each
# is sanitized like the installer's notes are.
#
# The classification is by path alone, so the pushing machine may be this one:
# a commit this machine published, met by a local HEAD that has since moved
# back (a reset during a repair, a store restored from backup or a snapshot, a
# re-clone of an older state), reads exactly like a peer writing in. The remote
# is correct in that case and the store is behind it, so the lines name both
# repairs and leave the operator, who knows which state the box is in, to pick.
function Get-MemorySyncInboundOwnLines {
    param([Parameter(Mandatory = $true)][hashtable]$Status)
    if (-not $Status.IsRepo -or -not $Status.IsOwnRepo -or $Status.Upstream -eq "") { return @() }
    $revUp = Invoke-MemorySyncGit -StoreRoot $Status.StoreRoot -Arguments @("rev-parse", "--verify", "@{upstream}")
    $upstreamSha = if ($revUp.Output.Count -gt 0) { ([string]$revUp.Output[-1]).Trim() } else { "" }
    if ($revUp.Code -ne 0 -or $upstreamSha -cnotmatch $script:MemorySyncObjectIdPattern) { return @() }
    $machine = ""
    try { $machine = [string](Get-MemorySyncMachineName) } catch { $machine = "" }
    $found = Get-MemorySyncInboundForeignPaths -StoreRoot $Status.StoreRoot -Ref $upstreamSha -Machine $machine
    if (-not $found.Ok -or @($found.Paths).Count -eq 0) { return @() }
    $paths = @($found.Paths)
    $named = (($paths | Select-Object -First 5 | ForEach-Object { Get-SanitizedLine $_ 200 }) -join ", ")
    if ($paths.Count -gt 5) { $named += " (and " + ($paths.Count - 5) + " more)" }
    return @(
        ("The fetched commit " + (Get-SanitizedLine $upstreamSha 200) + " on " + (Get-SanitizedLine $Status.Upstream 200) +
            " writes " + $paths.Count + " path(s) inside this machine's own coordinator directory, which only this machine writes: " + $named),
        ("The sync refuses that intake rather than rebasing it, so the store stays gated until one of two repairs is made, " +
            "and which one depends on where those paths were written."),
        ("If another machine wrote them, the correction is made on that machine by hand with git (commit the undo and push it directly): " +
            "its own sync gate refuses to stage a write under this machine's coordinator directory, so the kit's channel cannot carry the fix."),
        ("If this machine pushed them itself and its HEAD has since moved back (a reset, a restore from a backup or a snapshot, a re-clone of an older state), " +
            "the remote is correct and the repair is local: bring HEAD back up to the upstream rather than changing the remote.")
    )
}

# The report a machine name that reads blank earns, and the state it describes.
# Neither direction of the sync can tell this machine's coordinator directory
# from another's without the name, so the installer refuses every commit and the
# runner refuses every intake, and the two states the runner can record (a
# failed commit and an unproven read) name none of that.
#
# These lines carry a verdict rather than riding as detail. A store that commits
# nothing and rebases nothing is a store not syncing at all, and the reports
# below print detail under a summary line the operator reads as the verdict, so
# a line saying so under a PASS would be the failure with a caption on it. The
# reading is the installer's own (Get-MemorySyncMachineName), and it needs no
# repository state, so it answers on a store with no upstream and no remote at
# all: a blank name stops the sync whether or not the branch tracks anything.
function Get-MemorySyncMachineNameLines {
    $machine = ""
    try { $machine = [string](Get-MemorySyncMachineName) } catch { $machine = "" }
    if ($machine.Trim() -ne "") { return @() }
    return @(
        ("This machine's own name reads blank, so the sync can tell neither a staged nor an incoming coordinator path " +
            "from another machine's: nothing is committed and nothing is rebased until the machine name resolves."),
        "Fix: give this machine a host name the system resolves (the sync reads [System.Net.Dns]::GetHostName()), then re-run this check."
    )
}

$syncStatus = Get-MemorySyncStatus -StoreRoot $claudeDir
$syncFixNotes = @()
$syncReported = $false

if (-not $syncStatus.GitAvailable) {
    Report "WARN" "Memory sync" @(
        "git is not on PATH, so the memory store's sync repo cannot be checked or initialized.",
        "Install git and re-run the doctor; every other check above is unaffected."
    )
}
else {
    $syncForeign = @()
    if ($syncStatus.IgnoreState -eq "Foreign") { $syncForeign += ".gitignore" }
    if ($syncStatus.AttrState -eq "Foreign") { $syncForeign += ".gitattributes" }
    # A repository at the store root that the doctor did not create is nobody
    # else's to write in, and a managed file the doctor did not write is left
    # as found, which means the installer's canonical-allowlist gate refuses to
    # stage anything there. Neither case is offered a -Fix, because the repair
    # the prompt describes is one the installer will not perform.
    $syncAdoptable = ((-not $syncStatus.IsRepo) -or $syncStatus.IsOwnRepo) -and ($syncForeign.Count -eq 0)
    # Every repairable state of both managed files, so a check that prints
    # "re-run with -Fix" is one -Fix actually acts on. A missing file counts:
    # a repo recognized by its config marker with no .gitignore on disk has no
    # rules at all, which is the state most in need of the repair.
    #
    # The last clause is what closes the steady-state hole: a repository
    # already canonical on both managed files never used to reach
    # Install-MemorySyncRepo at all, so -Fix committed nothing beyond the
    # first heal that made it canonical, and every memory a session wrote
    # afterward stayed local until the next drift. Dirty is true only inside
    # an owned repo (Get-MemorySyncStatus leaves it false outside one), so
    # this clause cannot fire for a repo $syncAdoptable would refuse anyway.
    $syncNeedsWork = $syncAdoptable -and ((-not $syncStatus.IsRepo) -or
        $syncStatus.IgnoreState -eq "Missing" -or $syncStatus.IgnoreState -eq "Drift" -or
        $syncStatus.AttrState -eq "Missing" -or $syncStatus.AttrState -eq "Drift" -or
        $syncStatus.Dirty)

    if ($Fix -and $syncNeedsWork) {
        # Three shapes, not two: the prompt must never describe a repair that
        # is not happening, so a canonical repo that only needs its pending
        # changes committed asks about exactly that, never about restoring an
        # allowlist that is already right.
        #
        # Every shape names both parts of the store the commit carries. The
        # allowlist admits the memory tiers and the coordinator directory, so
        # a prompt naming only the tiers asks consent for less than the commit,
        # and the sync runner's later push that carries it, actually publish.
        $syncQuestion = if (-not $syncStatus.IsRepo) {
            "Initialize $claudeDir as the memory-sync git repository (allowlist plus one commit of the memory tiers and the coordinator directory)?"
        }
        elseif ($syncStatus.IgnoreState -ne "Canonical" -or $syncStatus.AttrState -ne "Canonical") {
            "Restore the canonical memory-sync allowlist in $claudeDir and commit the memory tiers and the coordinator directory?"
        }
        else {
            "Commit $($syncStatus.DirtyCount) pending change(s) to the memory tiers and the coordinator directory in $claudeDir through the gated allowlist?"
        }
        if (Get-Consent $syncQuestion) {
            $syncInstall = Install-MemorySyncRepo -StoreRoot $claudeDir
            # The installer's notes name paths and quote git's output, both of
            # which come from the store rather than from this script, so they
            # are sanitized like every other store-derived string before
            # reaching a report a human reads to make a security decision.
            if (-not $syncInstall.Ok) {
                # Re-read before reporting: a refusal can follow an init or an
                # add, so the repository the operator is being told about is
                # the one on disk now, not the one the attempt started from.
                $syncStatus = Get-MemorySyncStatus -StoreRoot $claudeDir
                $syncFailed = Get-MemorySyncReportLines $syncStatus
                # A blank machine name is why the installer refuses every
                # commit, so the remedy rides this refusal too. The reading is
                # the installer's own and needs no repository state, and the
                # function is called here rather than reading the tail variable
                # the check-mode branches share, which is assigned further down
                # and past this return path.
                Report "FAIL" "Memory sync" (@($syncInstall.Notes | ForEach-Object { Get-SanitizedLine $_ 200 }) +
                    $syncFailed.Leaks +
                    $(if ($syncFailed.Leaks.Count -gt 0) { $syncFailed.Fixes } else { @() }) +
                    $syncFailed.Unproven + $syncFailed.Context + (Get-MemorySyncMachineNameLines) +
                    (Get-MemorySyncInboundOwnLines $syncStatus))
                $syncReported = $true
            }
            else {
                $syncFixNotes += $syncInstall.Notes
                # Re-read after writing: the report describes the state on disk
                # now, never the state that prompted the repair.
                $syncStatus = Get-MemorySyncStatus -StoreRoot $claudeDir
                $syncForeign = @()
                if ($syncStatus.IgnoreState -eq "Foreign") { $syncForeign += ".gitignore" }
                if ($syncStatus.AttrState -eq "Foreign") { $syncForeign += ".gitattributes" }
            }
        }
    }

    if (-not $syncReported) {
        $syncGaps = @()
        foreach ($pair in @(@(".gitignore", $syncStatus.IgnoreState), @(".gitattributes", $syncStatus.AttrState))) {
            if ($pair[1] -eq "Drift") { $syncGaps += "$($pair[0]) differs from the allowlist this doctor derives." }
            if ($pair[1] -eq "Missing" -and $syncStatus.IsRepo) { $syncGaps += "$($pair[0]) is missing." }
        }
        $syncReport = Get-MemorySyncReportLines $syncStatus
        $syncLeaks = $syncReport.Leaks
        # The leak fixes ride wherever the leaks do, and the unproven lines
        # ride everywhere, because an empty leak list means nothing when a
        # probe could not answer.
        # An upstream commit writing this machine's own coordinator directory is
        # a finding about the remote rather than about this store's allowlist,
        # so it rides every branch below as a named path and changes no
        # verdict: the store's own state is exactly what the branch says it is,
        # and what the operator gains here is the commit and the paths the
        # runner's reason code alone cannot carry. An in-sync store produces no
        # lines, so nothing changes for a healthy report.
        $syncInboundOwn = Get-MemorySyncInboundOwnLines $syncStatus
        # A blank machine name is the other finding this section carries, and
        # unlike the inbound lines it sets a verdict: it rides the tail here so
        # the FAIL branches below name it beside their own finding, and it has
        # its own branch further down for the store that is otherwise healthy.
        # A box whose name resolves produces no lines either way.
        $syncMachineBlank = Get-MemorySyncMachineNameLines
        $syncTail = $(if ($syncLeaks.Count -gt 0) { $syncReport.Fixes } else { @() }) + $syncReport.Unproven +
            $syncInboundOwn + $syncMachineBlank
        # Notes from the installer quote paths and git output, so they carry
        # the same sanitization every other store-derived string does.
        $syncFixLines = @($syncFixNotes | ForEach-Object { Get-SanitizedLine $_ 200 })

        if ($syncForeign.Count -gt 0) {
            # Someone else's file: rewriting it would destroy their rules, so
            # the doctor names it and stops. No -Fix is offered here, because
            # none is going to run. The leak probes are printed all the same:
            # this is a state in which the rules are unknown, which is when
            # what an add would stage and what is already committed matter
            # most.
            Report "FAIL" "Memory sync" ($syncFixLines + @(
                ("$claudeDir holds a " + ($syncForeign -join " and a ") + " the doctor did not write, so the memory-sync allowlist cannot be trusted."),
                "The store root holds .credentials.json, settings.json, history.jsonl, and every session transcript.",
                "Review that file by hand; move it aside to let the doctor write the canonical allowlist."
            ) + $syncLeaks + $syncTail)
        }
        elseif ($syncStatus.IsRepo -and -not $syncStatus.IsOwnRepo) {
            # A repository here that carries no doctor-written allowlist was
            # created by someone else (an operator versioning their dotfiles at
            # the store root). Writing an allowlist and committing into it
            # would put the memory tiers and the coordinator directory, and
            # whatever that repo had staged, in a commit and possibly a push
            # nobody asked for.
            Report "FAIL" "Memory sync" ($syncFixLines + @(
                "$claudeDir is already a git repository the doctor did not create, and it carries no memory-sync allowlist.",
                "The store root holds .credentials.json, settings.json, history.jsonl, and every session transcript, all of which that repository can stage.",
                "Review it by hand; the doctor writes nothing into a repository it did not create."
            ) + $syncLeaks + $syncTail)
        }
        elseif (-not $syncStatus.IsRepo) {
            # The machine lines ride here because this branch's only advice is
            # to re-run with -Fix, and a blank machine name is exactly what the
            # installer that recipe invokes refuses on, so without them the
            # operator is sent to a repair that cannot run. The reading needs
            # no repository state, which is what lets it answer on a store root
            # that is not a repository at all.
            Report "WARN" "Memory sync" (@(
                "$claudeDir is not a git repository, so the memory store does not sync across machines.",
                "Fix: re-run doctor with -Fix (initializes the repo with the gated allowlist and commits the memory tiers and the coordinator directory)."
            ) + $syncReport.Context + $syncMachineBlank)
        }
        elseif ($syncGaps.Count -gt 0) {
            # A missing or drifted allowlist is the other state in which the
            # rules cannot be trusted, so the leak probes are printed here for
            # the same reason they are printed above: what an add would reach
            # and what is already staged or committed is the whole question.
            Report "FAIL" "Memory sync" ($syncFixLines + $syncGaps + @(
                "Until it matches, an add in $claudeDir can stage credentials, settings, and session transcripts.",
                "Fix: re-run doctor with -Fix (restores the canonical allowlist)."
            ) + $syncLeaks + $syncTail)
        }
        elseif ($syncLeaks.Count -gt 0) {
            Report "FAIL" "Memory sync" ($syncFixLines + $syncLeaks + @(
                "The allowlist reads as expected, but the repository state above puts non-memory paths in reach of a push."
            ) + $syncTail)
        }
        elseif (-not $syncStatus.ProbesRan) {
            # A probe that could not run proves nothing, and this is the report
            # the operator reads before giving the store a remote, so an
            # unanswerable probe is a failure rather than a warning: a warning
            # exits 0 under a "healthy" summary line.
            # The inbound lines and a blank machine name ride here too: an
            # unanswerable probe is about the allowlist, an upstream writing
            # this machine's own coordinator directory is about the remote, and
            # a name that reads blank is about the box, so an operator hitting
            # more than one needs each of them. The first is read from the
            # repo's refs and HEAD and the second from the machine, neither of
            # which the leak probes' failure disturbs.
            Report "FAIL" "Memory sync" (@(
                "The allowlist matches on disk, but what this repository would actually publish is unverified."
            ) + $syncReport.Unproven + $syncInboundOwn + $syncMachineBlank)
        }
        elseif ($syncMachineBlank.Count -gt 0) {
            # Everything about the allowlist reads clean, and the store still
            # syncs nothing in either direction, so this is the last branch that
            # can hold a finding before the healthy reports begin. It fails
            # rather than warns for the reason the unproven branch above does: a
            # warning exits 0 under a summary line, and the reports below this
            # one end by handing the operator a push recipe for a store that
            # cannot commit.
            Report "FAIL" "Memory sync" ($syncFixLines + $syncMachineBlank + $syncInboundOwn)
        }
        else {
            $syncDetail = @(
                ("Allowlist canonical; " + $syncStatus.Probed.Count + " sensitive path(s) proven ignored, an add would stage memory paths only, and no non-memory blob is reachable in committed history.")
            )
            if ($syncStatus.Remote -ne "") { $syncDetail += ("origin: " + (Get-SanitizedLine $syncStatus.Remote 200)) }
            # The branches below carry $syncDetail rather than $syncTail, so the
            # inbound lines join it here to reach them; an in-sync store adds
            # nothing.
            $syncDetail += $syncInboundOwn
            # Reached either from a plain check (no -Fix) or from a -Fix run
            # whose commit succeeded and cleared the worktree: $syncStatus was
            # re-read after that commit, so Dirty is already false there and
            # this line adds nothing beside the FIXED notes above it. A check
            # that stayed silent about pending, uncommitted memories would
            # tell an operator the store is fine while it holds unsynced work;
            # check mode cannot commit them, but it can say they are there.
            if ($syncStatus.Dirty) {
                # The count leads with a string, never bare: "$int + ' text'"
                # asks PowerShell to add an integer to a string and throws,
                # where "'' + $int + ' text'" concatenates as intended.
                $syncDetail += ("" + $syncStatus.DirtyCount + " uncommitted change(s) under the allowlist, not yet committed. Fix: re-run doctor with -Fix (commits them through the gated allowlist).")
            }
            # The allowlist is sound from here down, so nothing below is a leak.
            # What is left to prove is that the store publishes somewhere: every
            # probe above can read clean on a store that syncs nowhere, which is
            # a passing report on a memory tier no other machine will ever see.
            $syncDest = Get-MemorySyncDestinationLines $syncStatus

            if ($syncStatus.Remote -eq "") {
                Report "WARN" "Memory sync" ($syncFixLines + $syncDetail + @(
                    "No origin remote, so the store is versioned locally and replicates nowhere: nothing this machine records leaves it, and nothing another machine records arrives.",
                    "Fix: add the private remote (git -C `"$claudeDir`" remote add origin <url>) and push the branch with -u."
                ))
            }
            elseif ($syncDest.Blocking.Count -gt 0) {
                # The remedy below repairs the three findings that leave this
                # store without a usable destination on origin: a HEAD on no
                # branch, a branch tracking nothing, and a branch tracking some
                # remote other than origin. It is withheld from every other
                # finding, which carries its own remedy, because running
                # `push -u origin <branch>` against a branch whose upstream on
                # origin is already correct creates a second branch there and
                # repoints the upstream at it, which is exactly the silent
                # cross-machine divergence the advisory check above reports.
                $syncDestFix = @()
                if ($syncStatus.Detached -or $syncStatus.Upstream -eq "" -or
                    -not $syncStatus.Upstream.StartsWith("origin/")) {
                    $syncDestFix += "Fix: put HEAD on the sync branch and give it an upstream (git -C `"$claudeDir`" push -u origin <branch>)."
                }
                Report "FAIL" "Memory sync" ($syncFixLines + $syncDetail + $syncDest.Blocking + $syncDest.Advisory + $syncDestFix)
            }
            elseif (-not $syncStatus.DestinationRead) {
                Report "WARN" "Memory sync" ($syncFixLines + $syncDetail + @(
                    "The branch this store would push to could not be read, so whether it reaches any other machine is unverified."
                ))
            }
            elseif ($syncDest.Advisory.Count -gt 0) {
                Report "WARN" "Memory sync" ($syncFixLines + $syncDetail + $syncDest.Advisory)
            }
            elseif (-not $syncStatus.RemoteBranchesRead -or $syncStatus.RemoteBranches.Count -eq 0) {
                # The sole-branch claim below rests on having read origin's
                # branches. An unreadable or empty set is not evidence of one
                # branch, and saying so from zero observations is the same
                # mistake as reading an empty leak probe as a clean index.
                Report "WARN" "Memory sync" ($syncFixLines + $syncDetail + @(
                    ("Branch " + (Get-SanitizedLine $syncStatus.Branch 200) + " tracks " +
                        (Get-SanitizedLine $syncStatus.Upstream 200) + ", but no remote-tracking branch for origin could be read here, so whether this store shares a branch with the other machines is unverified."),
                    "Fix: run git -C `"$claudeDir`" fetch origin, then re-run this check."
                ))
            }
            else {
                $syncDetail += ("Destination: " + (Get-SanitizedLine $syncStatus.Branch 200) + " tracks " +
                    (Get-SanitizedLine $syncStatus.Upstream 200) + ", the only branch on origin.")
                if ($syncFixLines.Count -gt 0) {
                    # The commit's other half, stated rather than left to
                    # inference: this block reports a commit directly beside an
                    # "origin:" line and a "Destination:" line naming the branch
                    # this store tracks, and a commit reported beside a
                    # destination with nothing said about publication reads as
                    # published. The push lives in the sync runner alone
                    # (sync-store.ps1), so a -Fix run's outcome is local, and
                    # both carriers of the commit are named.
                    #
                    # This is the only branch that may carry the recipe, and the
                    # reason is the whole point of the report it sits in. Every
                    # other branch reachable from here is a FAIL or a WARN,
                    # including the FAIL raised because a non-memory blob is
                    # reachable in committed history, where handing the operator
                    # a push command would hand them the exact act the leak
                    # probes exist to stop. Only here has the store proven both
                    # that it publishes nothing it should not and that it has a
                    # destination to publish to, so only here is a push the
                    # right next step. $claudeDir is the doctor's own derived
                    # path rather than a store-supplied string, so it embeds
                    # raw like the other Fix lines in this section: sanitizing
                    # it would silently strip a non-ASCII profile name out of a
                    # command the operator is meant to copy.
                    Report "FIXED" "Memory sync" ($syncFixLines + $syncDetail + @(
                        "Committed, not pushed: the commit is local until something carries it, either the background sync runner at the next session start or the manual push below.",
                        "Manual push: git -C `"$claudeDir`" pull --rebase, then git -C `"$claudeDir`" push."
                    ))
                }
                else { Report "PASS" "Memory sync" $syncDetail }
            }
        }
    }
}

# --- Embedder (semantic memory search). memq find's semantic channel needs an
# --- in-process embedding stack that ships outside the plugin payload (the kit
# --- core stays dependency-free), so this section reports whether it is
# --- installed, installs it under -Fix, and reports the derived index's health
# --- without ever sweeping or writing it: the index rebuilds itself, and a
# --- doctor that touched it while reporting on it would have changed the thing
# --- it was reporting.
# ---
# --- install-embedder.ps1 (dot-sourced near the top of this script) owns the
# --- probe, the install, and the index-health reading, so the repo test suite
# --- exercises the same functions against a redirected embedder root and store
# --- root. probeEmbedder's three states get three different reports: 'absent'
# --- is nothing installed yet, 'unusable' is a broken or incomplete install (a
# --- repair, never mistaken for a fresh install), and 'ready' is a working
# --- semantic channel. Absence is a WARN, not a FAIL: memq find degrades to its
# --- lexical channel with a loud line, so a machine without the stack is a
# --- working install with a named gap, the same reading every other optional
# --- capability in this doctor gets.
# "kit-embedder" mirrors memory-index.js's EMBEDDER_DIR constant and
# memq.js's OPERATOR_DIR-style literal duplication: PowerShell cannot import a
# CommonJS constant, so the two sides of this contract are pinned by comment
# rather than by a shared definition, the same way $script:EmbedderConsentSizeMB
# in install-embedder.ps1 is a measured figure rather than a computed one.
$embedderRoot = Join-Path $claudeDir "kit-embedder"
$embedderScript = Join-Path $pluginRoot "scripts\memory-index.js"

if ($null -eq $nodeCmd) {
    Report "INFO" "Embedder (semantic search)" @("Skipped (node unresolved; the hook check above already FAILs on that, and the embedder probe runs under node).")
}
elseif (-not (Test-Path -LiteralPath $embedderScript)) {
    Report "FAIL" "Embedder (semantic search)" @("memory-index.js not found at $embedderScript; this plugin payload is incomplete.")
}
else {
    $embedProbe = Get-EmbedderProbe -MemoryIndexPath $embedderScript -EmbedderRoot $embedderRoot -NodeExe $nodeCmd.Source
    $embedFixNotes = @()
    $embedReported = $false

    # Gated on 'absent' or 'unusable' specifically, never on "not ready":
    # 'probe-failed' (the module present but unloadable, an incomplete plugin
    # payload) also reads not-ready, and offering a fresh install there would
    # promise a multi-hundred-megabyte download that cannot fix a payload
    # problem, ending in FAIL regardless. 'probe-failed' takes its own report
    # in the switch below instead, and never reaches a consent prompt.
    if ($Fix -and ($embedProbe.status -eq 'absent' -or $embedProbe.status -eq 'unusable')) {
        if ($null -eq (Get-Command npm -ErrorAction SilentlyContinue)) {
            # The consent prompt must not promise a repair the installer will
            # refuse to perform: Install-Embedder itself checks for npm and
            # returns Ok=false without ever prompting, so this mirrors that
            # refusal before a prompt is even offered, the same shape the
            # memq shim's "no payload to run" WARN takes. No prompt is shown,
            # and this rides as an extra note on the ordinary absent/unusable
            # report below rather than replacing it, so the index-health lines
            # every other state gets still print here too.
            $embedFixNotes = @(
                "npm is not on PATH, so the embedding stack cannot be installed.",
                "Install Node.js (which ships npm) and re-run doctor -Fix."
            )
        }
        else {
            $embedQuestion = if ($embedProbe.status -eq 'unusable') {
                "Repair the local embedding stack at $embedderRoot (re-downloads the missing model files; the full install is about $($script:EmbedderConsentSizeMB) MB on disk)?"
            }
            else {
                "Install the local embedding stack into $embedderRoot (about $($script:EmbedderConsentSizeMB) MB on disk; enables memq find's semantic channel)?"
            }
            if (Get-Consent $embedQuestion) {
                $embedInstall = Install-Embedder -PluginRoot $pluginRoot -EmbedderRoot $embedderRoot -NodeExe $nodeCmd.Source
                # Re-probe either way: the report below must describe the
                # install as it actually stands after this attempt, never as
                # the attempt hoped it would.
                $embedProbe = Get-EmbedderProbe -MemoryIndexPath $embedderScript -EmbedderRoot $embedderRoot -NodeExe $nodeCmd.Source
                $embedInstallNotes = @($embedInstall.Notes | ForEach-Object { Get-SanitizedLine $_ 300 })
                if (-not $embedInstall.Ok) {
                    Report "FAIL" "Embedder (semantic search)" ($embedInstallNotes + @(
                        "Semantic channel inactive; memq find serves lexical results only, with a loud absence line naming the remedy.",
                        "The install directory is left in place for diagnosis; the doctor deletes nothing."
                    ))
                    $embedReported = $true
                }
                else {
                    $embedFixNotes = $embedInstallNotes
                }
            }
        }
    }

    if (-not $embedReported) {
        $embedIndexHealth = Get-EmbedderIndexHealth -MemoryIndexPath $embedderScript -EmbedderRoot $embedderRoot -StoreRoot $claudeDir -NodeExe $nodeCmd.Source
        $embedIndexLines = @((Get-EmbedderIndexHealthLines -IndexHealth $embedIndexHealth -Probe $embedProbe) | ForEach-Object { Get-SanitizedLine $_ 300 })

        switch ($embedProbe.status) {
            'ready' {
                # packageVersion comes from a package.json this doctor did not
                # author, the same as every other foreign string reaching this
                # report, so it takes the same sanitize pass before printing.
                $embedDetail = @(
                    ("Installed: $($embedProbe.packageName)@$(Get-SanitizedLine ([string]$embedProbe.packageVersion) 40), model $($embedProbe.model) ($($embedProbe.dtype)) at $($embedProbe.packageDir)."),
                    "Semantic channel active; memq find blends lexical and semantic results."
                ) + $embedIndexLines
                if ($embedFixNotes.Count -gt 0) { Report "FIXED" "Embedder (semantic search)" ($embedFixNotes + $embedDetail) }
                else { Report "PASS" "Embedder (semantic search)" $embedDetail }
            }
            'unusable' {
                Report "WARN" "Embedder (semantic search)" ($embedFixNotes + @(
                    ("Installed but not usable: " + (Get-SanitizedLine ([string]$embedProbe.detail) 300)),
                    "This is a repair, not a fresh install.",
                    ("Fix: " + $embedProbe.remedy),
                    "Semantic channel inactive; memq find serves lexical results only, with a loud absence line naming the remedy."
                ) + $embedIndexLines)
            }
            'absent' {
                Report "WARN" "Embedder (semantic search)" ($embedFixNotes + @(
                    "Not installed; memq find serves lexical results only, with a loud absence line naming the remedy.",
                    ("Fix: " + $embedProbe.remedy + "  (about $($script:EmbedderConsentSizeMB) MB on disk)")
                ) + $embedIndexLines)
            }
            default {
                # 'probe-failed': the child node process itself could not
                # answer, an incomplete plugin payload rather than an
                # ordinary absent-or-broken install. Named as its own state so
                # it is never mistaken for either.
                Report "FAIL" "Embedder (semantic search)" (@(
                    "Could not probe the embedder install: " + (Get-SanitizedLine ([string]$embedProbe.detail) 300)
                ) + $embedIndexLines)
            }
        }
    }
}

# --- Nothing may be inserted between the embedder section above and the
# --- `if ($isClone) {` line below. test/embedder-install.test.js runs real
# --- doctor code by extracting the text between the embedder section's own
# --- marker comment and the next `if ($isClone) {`, then asserting on the
# --- reports that region emits, so a check placed in this gap silently joins
# --- that extracted section and fails those cases with a report count they
# --- never asked for. The goal state block below is itself extracted the
# --- same way, from that `if ($isClone) {` line to the `# --- .kit/
# --- exposure.` marker below it, by test/doctor-goal-state.test.js, so a
# --- check placed inside that range joins its extracted section too. Add
# --- new checks after the `# --- .kit/ exposure.` marker instead.

if ($isClone) {
    $goalStatePath = Join-Path $repoRoot ".kit\goal-state.json"
    if (-not (Test-Path -LiteralPath $goalStatePath)) {
        Report "INFO" "Kit goal state" @("No kit goal armed in this clone.")
    }
    else {
        $goalState = $null
        try { $goalState = Get-Content $goalStatePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
        if ($null -eq $goalState -or -not $goalState.plan) {
            Report "WARN" "Kit goal state" @("$goalStatePath exists but is unparseable or missing a 'plan' field; a stuck goal may be leashing sessions with no readable state.")
        }
        else {
            # Mirrors kit-goal-lib.js's planHead: an anchored, line-start Status
            # match so body prose containing "in progress" or "complete" cannot
            # misclassify the plan.
            $planSafe = Get-SanitizedLine $goalState.plan
            $planRaw = [string]$goalState.plan

            # Queue context, read defensively. kit-goal-lib.js's readGoal
            # normalizes every read so that queue[queueIndex] is always plan,
            # but the doctor reads the raw file and a hand edit is exactly the
            # case it exists to catch, so a queue that disagrees with plan is
            # discarded in favour of the legacy single-plan reading rather than
            # trusted. A pre-queue state file has no queue at all and takes the
            # same path, which is what keeps this check working on both shapes.
            $queue = @()
            foreach ($q in @($goalState.queue)) {
                if ($q -is [string] -and $q.Length -gt 0) { $queue += [string]$q }
            }
            $queueIndex = 0
            if ($goalState.queueIndex -is [int] -or $goalState.queueIndex -is [long] -or $goalState.queueIndex -is [double]) {
                $queueIndex = [int]$goalState.queueIndex
            }
            if ($queue.Count -eq 0 -or $queueIndex -lt 0 -or $queueIndex -ge $queue.Count -or $queue[$queueIndex] -ne $planRaw) {
                $queue = @($planRaw)
                $queueIndex = 0
            }
            $remainingCount = $queue.Count - $queueIndex - 1
            $queueLines = @()
            if ($queue.Count -gt 1) {
                $queueLines += "Plan $($queueIndex + 1) of $($queue.Count) in the armed queue."
                if ($remainingCount -gt 0) {
                    $shown = $queue[($queueIndex + 1)..($queue.Count - 1)]
                    $tail = ""
                    if ($shown.Count -gt 5) {
                        $tail = ", and $($shown.Count - 5) more"
                        $shown = $shown[0..4]
                    }
                    $queueLines += "Remaining after it: " + (($shown | ForEach-Object { Get-SanitizedLine $_ }) -join ", ") + $tail
                }
            }

            if ($planRaw -match '(^|[\\/])\.\.([\\/]|$)') {
                # armGoal never writes a traversing path, so a plan containing a
                # '..' segment means a hand-edited or corrupt state file; do not
                # follow it out of the repo to read an arbitrary file.
                Report "WARN" "Kit goal state" @("$goalStatePath names a plan path containing '..' ($planSafe); refusing to inspect it. Clear the goal (/kit-goal clear) if it is stale.")
            }
            else {
                # Who armed this plan. The lookup is ordinal on the outer
                # field name, the entry name and the value, because
                # PowerShell's member indexer ($goalState.armedBy) resolves a
                # field name case-insensitively, and -ceq, despite its name,
                # is case-sensitive but culture-sensitive rather than
                # ordinal: it answers true for two strings that differ only
                # by a collation-ignorable character (a soft hyphen, for
                # one). The JavaScript readers this mirrors
                # (kit-goal-lib.js's normalizeArmedBy and planArmedBy) use
                # hasOwnProperty and ===, which are ordinal, so every
                # comparison below uses [string]::Equals(..., Ordinal)
                # instead of -eq/-ceq, and the outer field is found by
                # enumerating PSObject.Properties rather than read through
                # the indexer. An entry present but not the exact string
                # 'self' and an entry absent both behave as the operator's
                # arming everywhere it matters; only the emitted sentence
                # distinguishes the two, since a state predating the field
                # and a hand edit both leave no entry to find.
                #
                # This is attribution only: who ran the arm invocation. It is
                # not the plan's authorization, which is a separate field the
                # `status` command already renders; nothing here should be read
                # as saying whether the plan doc authorizes this leash.
                $armedByFound = $false
                $armedBySelf = $false
                if ($goalState.PSObject -and $goalState.PSObject.Properties) {
                    $armedByMap = $null
                    foreach ($outerProp in $goalState.PSObject.Properties) {
                        if ([string]::Equals($outerProp.Name, 'armedBy', [System.StringComparison]::Ordinal)) {
                            $armedByMap = $outerProp.Value
                            break
                        }
                    }
                    if ($armedByMap -is [System.Management.Automation.PSCustomObject]) {
                        foreach ($prop in $armedByMap.PSObject.Properties) {
                            if ([string]::Equals($prop.Name, $planRaw, [System.StringComparison]::Ordinal)) {
                                $armedByFound = $true
                                if ($prop.Value -is [string] -and [string]::Equals([string]$prop.Value, 'self', [System.StringComparison]::Ordinal)) {
                                    $armedBySelf = $true
                                }
                                break
                            }
                        }
                    }
                }
                $armedByLine = if ($armedBySelf) {
                    "Arming of ${planSafe}: recorded as a run's own arming (armedBy: self), not typed by the operator."
                }
                elseif ($armedByFound) {
                    "Arming of ${planSafe}: recorded as the operator's arming (armedBy: operator)."
                }
                else {
                    "Arming of ${planSafe}: nothing recorded, which reads as the operator's arming. A state predating the field and a hand edit both read this way."
                }

                $planFull = Join-Path $repoRoot $planRaw
                $planExists = Test-Path -LiteralPath $planFull
                $planStatus = "unknown"
                if ($planExists) {
                    try {
                        $head = Get-Content -LiteralPath $planFull -Raw -Encoding UTF8 -ErrorAction Stop
                        if ($head.Length -gt 2048) { $head = $head.Substring(0, 2048) }
                        $inProgress = $head -match "(?im)^status:[^\S\r\n]*in[^\S\r\n]*progress"
                        $complete = ($head -match "(?im)^status:[^\S\r\n]*complete") -and -not $inProgress
                        if ($complete) { $planStatus = "complete" }
                        elseif ($inProgress) { $planStatus = "in progress" }
                    }
                    catch {}
                }
                if (-not $planExists -or $planStatus -eq "complete") {
                    if ($remainingCount -gt 0) {
                        # A stalled advance, not a stale goal. The Stop hook
                        # advances a finished plan at the bound session's next
                        # stop, so a terminal current plan with the queue still
                        # holding work means no stop has happened since it
                        # finished: either the run is mid-turn, or it died
                        # before its next stop and the queue needs re-arming
                        # with the remainder.
                        #
                        # A re-arm from here records the operator's arming
                        # regardless of who currently holds the goal, so when
                        # the current arming reads self the sentence above
                        # would silently flip if the operator followed the
                        # re-arm instruction without knowing that; the extra
                        # line is added only in that case, since the operator
                        # case has no attribution to flip.
                        $reArmNote = @()
                        if ($armedBySelf) {
                            $reArmNote = @("Re-arming records the arming of whoever runs it, so a re-arm from here would record the operator's.")
                        }
                        Report "WARN" "Kit goal state" ($queueLines + @(
                            "The current plan $planSafe is Complete or archived, but $remainingCount plan(s) remain in the queue.",
                            "The Stop hook advances at the bound session's next stop, so this is normal mid-turn and a stalled advance otherwise.",
                            "If the bound run has died, re-arm with the remaining plans (/kit-goal <plan paths>), which resets the binding."
                        ) + $reArmNote + @($armedByLine))
                    }
                    else {
                        Report "WARN" "Kit goal state" ($queueLines + @(
                            "A kit goal is armed for $planSafe but that plan is Complete or archived.",
                            "Clear it (node `"$pluginRoot\hooks\kit-goal.js`" clear, or /kit-goal clear) or it will leash this repo's sessions.",
                            $armedByLine
                        ))
                    }
                }
                else {
                    Report "PASS" "Kit goal state" (@("Armed for $planSafe (active).") + $queueLines + @($armedByLine))
                }
            }
        }
    }
}
else {
    Report "INFO" "Kit goal state" @("Skipped (installed plugin cache, not a repo clone; no specific repo to inspect).")
}

# --- .kit/ exposure. The kit's project-local state lives in .kit/, and every
# --- file it holds is machine-local by intent: goal-state.json carries plan
# --- paths that every armed session's SessionStart notice reads back into its
# --- context, compact-gate.json carries the gate's newest verdict,
# --- compact-gate.jsonl carries a session id and a timeline of the run's work,
# --- one line per decision, compact-hold-nudge.json carries a session id per
# --- held session with its own throttle stamp, and
# --- compact-role-boundary.<session>.json carries a session id in the FILE NAME
# --- itself, one file per session, so a listing, a backup or a git ls-files
# --- discloses every id that has banked here without opening anything. The
# --- posture that keeps all of it safe is the directory staying out of git,
# --- which is a property of the consuming repository rather than one the kit
# --- can impose, so this checks the whole directory instead of assuming it or
# --- naming one file. It sits deliberately outside the $isClone gate above:
# --- $repoRoot is derived from where this script lives, so it only ever names
# --- the kit's own checkout, whose .gitignore already covers .kit/, while the
# --- exposure exists in whatever project a goal was armed in. The inspected
# --- project is the directory the doctor was launched from: this state is
# --- project-local, so the operator runs the doctor from the project.
$kitStateDir = (Get-Location).Path
$kitStatePath = Join-Path $kitStateDir ".kit"
if (-not (Test-Path -LiteralPath $kitStatePath)) {
    Report "INFO" "Kit state directory exposure" @("No .kit directory in $kitStateDir; nothing to expose.")
}
elseif (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    # Reported rather than skipped silently, so an absent check cannot read as
    # a passing one.
    Report "INFO" "Kit state directory exposure" @("Skipped (git is not on PATH, so tracked and ignored status cannot be read).")
}
else {
    & git -C $kitStateDir rev-parse --is-inside-work-tree 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Report "PASS" "Kit state directory exposure" @("$kitStateDir is not a git working tree, so .kit/ cannot be committed from here.")
    }
    else {
        # Order matters: git stops reporting a path as ignored once it is
        # tracked, so the tracked case must be tested first or it renders as
        # merely unignored and understates the damage. A repository can also
        # ignore .kit/ and still track a file inside it (git add -f), so the
        # two readings are taken over the same directory rather than one
        # standing in for the other.
        $kitTracked = @(& git -C $kitStateDir ls-files -- ".kit")
        & git -C $kitStateDir check-ignore -q -- ".kit"
        $kitIgnored = ($LASTEXITCODE -eq 0)
        if ($kitTracked.Count -gt 0) {
            Report "WARN" "Kit state directory exposure" (@(
                "$($kitTracked.Count) path(s) under $kitStatePath are tracked by git, so their contents are in this repo's history and reach every clone:"
            ) + ($kitTracked | ForEach-Object { "  " + (Get-SanitizedLine $_ 200) }) + @(
                "Fix: git rm --cached each path above, then add .kit/ to this repo's .gitignore."
            ))
        }
        elseif (-not $kitIgnored) {
            Report "WARN" "Kit state directory exposure" @(
                "$kitStatePath is neither tracked nor ignored, so the next 'git add -A' commits it and this repo's kit state reaches every clone.",
                "Fix: add .kit/ to this repo's .gitignore."
            )
        }
        else {
            Report "PASS" "Kit state directory exposure" @("$kitStatePath is gitignored, so this repo's kit state stays on this machine.")
        }
    }
}

# --- Auto-compaction window. The boundary-gated compaction feature needs the
# --- harness to OFFER a compaction early enough that the gate has something to
# --- schedule: the gate can only defer an offer, never raise one. That offer
# --- point is set by autoCompactWindow in user settings.json.
#
# The effective trigger is the configured window minus a reserve (measured,
# not documented: a configured 100,000 fires near 64,000 and a configured
# 150,000 fires near 116,400). The recommended window is sized against the
# roughly 1,000,000-token window the models running leashed plan sessions
# carry, and against where a real run actually sits: context reaches about
# 100,000 once tools and a plan doc have loaded, chapters rarely close below
# 200,000, and quality holds until roughly 400,000. So the trigger belongs
# well above the setup floor and below the point where deferring starts to
# cost something, which puts it near 250,000 with a long runway below the
# gate's safety valve for a chapter to close. Every displayed number is
# derived from $recommendedWindow and $autoCompactReserve rather than
# restated, so changing one value cannot strand the prose beside it.
#
# A window set too HIGH is one quiet failure: above the model's real context
# window the trigger is never reached, no compaction is ever offered, and the
# whole feature is inert while looking installed. A window set too LOW is the
# other, and it is worse than doing nothing: it compacts during setup and then
# repeatedly, throwing away context a run has not finished using.
$recommendedWindow = 285000
$autoCompactReserve = 35000
$recommendedTrigger = $recommendedWindow - $autoCompactReserve
# The minimum usable band between the trigger and the valve ceiling. A band
# thinner than a couple of large turns is inert in practice, with the valve
# ending deferral almost as soon as the harness starts offering, so it is
# warned on rather than only the zero-or-negative case. Sized against turns on
# a real orchestration run (a wide git diff, a big plan-doc read, a subagent
# report), which run far larger than the small-window probe's 20,000.
$minUsableBand = 50000
# The documented floor of autoCompactWindow's accepted range. Below it the
# harness may clamp or ignore the value, so the real trigger is unknown and a
# derived trigger number would be fiction; the check reports that state
# instead of assessing it.
$windowFloor = 100000
$settingsPath = Join-Path $claudeDir "settings.json"
# The valve ceiling is read out of the hook rather than restated here, so the
# doctor and the gate cannot drift apart. An unreadable constant costs only
# the trigger-versus-ceiling sub-checks, and that skip is reported below
# rather than silent: a silent skip is indistinguishable from a healthy
# result.
$valveCeiling = $null
try {
    $gateSource = Get-Content -LiteralPath (Join-Path $pluginRoot "hooks\kit-compact-gate.js") -Raw -Encoding UTF8 -ErrorAction Stop
    if ($gateSource -match 'SAFETY_CEILING_TOKENS\s*=\s*(\d+)') { $valveCeiling = [int]$Matches[1] }
}
catch {}
if ($null -eq $valveCeiling) {
    Report "INFO" "Auto-compaction window" @("Skipped sub-check: the gate's SAFETY_CEILING_TOKENS could not be read from hooks\kit-compact-gate.js, so the trigger-versus-ceiling comparisons are skipped this run.")
}

$configuredWindow = $null
$configuredWindowRaw = $null
$settingsReadable = $false
if (Test-Path -LiteralPath $settingsPath) {
    # Windows PowerShell 5.1's default Get-Content decoding mis-decodes a
    # BOM-less UTF-8 file with the ANSI codepage, so the encoding is explicit
    # here. -ErrorAction Stop turns a locked or unreadable file into a
    # terminating error the catch below can see (ConvertFrom-Json alone is
    # non-terminating), and $settingsReadable gates on an actual parsed
    # object rather than on the pipeline merely finishing, so a read that
    # silently produced nothing is not reported as readable.
    try {
        $settingsObj = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json
        $settingsReadable = ($null -ne $settingsObj)
    }
    catch {}
    if ($settingsReadable -and $settingsObj.PSObject.Properties.Name -contains "autoCompactWindow") {
        # A present value that does not cast is a different state from an
        # absent one: the user set SOMETHING, so it is reported as what it is
        # (and never overwritten by -Fix), rather than misreported as "not
        # set" and replaced.
        $rawWindowValue = $settingsObj.autoCompactWindow
        try { $configuredWindow = [int]$rawWindowValue }
        catch { $configuredWindowRaw = "$rawWindowValue" }
    }
}

# The default-trigger judgment both no-window branches share: with no window
# configured, the harness's per-model default trigger sits near the top of
# the model window, which is above the gate's absolute safety ceiling, so the
# valve allows every compaction and the gate defers nothing until a window is
# configured.
$noWindowJudgment = @()
if ($null -ne $valveCeiling) {
    # Stated as expectation rather than measurement: the per-model default
    # trigger sits near the top of the window by design, which on a large-window
    # model puts it above the ceiling, but that has not been measured on the
    # window plan sessions actually run.
    $noWindowJudgment = @("The default trigger sits near the top of the model window, which on a large-window model is expected to be above the gate's safety ceiling of $valveCeiling, leaving the valve to allow every compaction and the gate to defer nothing until a window is configured.")
}

if (-not (Test-Path -LiteralPath $settingsPath)) {
    Report "INFO" "Auto-compaction window" (@("No user settings.json at $settingsPath, so no window is configured and the harness uses its per-model default.") + $noWindowJudgment)
}
elseif (-not $settingsReadable) {
    Report "WARN" "Auto-compaction window" @("$settingsPath could not be parsed, so the configured window cannot be read.")
}
elseif ($null -ne $configuredWindowRaw) {
    Report "WARN" "Auto-compaction window" @(
        "autoCompactWindow is set to '" + (Get-SanitizedLine $configuredWindowRaw) + "', which is not a usable number, so the trigger cannot be assessed and the harness behavior is undefined.",
        "Set it by hand to $recommendedWindow, or remove it to fall back to the per-model default."
    )
}
elseif ($null -eq $configuredWindow) {
    $detail = @(
        "No autoCompactWindow is set, so the harness compacts at its per-model default trigger, near the top of the context window."
    ) + $noWindowJudgment + @(
        "Recommended: $recommendedWindow (offers a compaction near $recommendedTrigger consumed on the ~1,000,000-token window plan sessions run)."
    )
    if ($Fix -and (Get-Consent "Set autoCompactWindow to $recommendedWindow in $settingsPath?")) {
        $result = Set-AutoCompactWindow -Path $settingsPath -Value $recommendedWindow
        if ($result.ok) {
            Report "FIXED" "Auto-compaction window" @("Set autoCompactWindow to $recommendedWindow.", "Restart Claude Code for it to take effect.")
            if ($result.backupLeftover) {
                # The leftover is a plaintext copy of settings.json, which can
                # carry an env block and apiKeyHelper, so it is named rather
                # than silently left behind.
                Report "INFO" "Auto-compaction window" @("The pre-write backup could not be removed and remains at " + (Get-SanitizedLine $result.backupLeftover 200) + "; it holds a plaintext copy of settings.json, so delete it when convenient.")
            }
        }
        else {
            # The reason can carry file-derived text (key names, exception
            # messages), so it is sanitized before this trusted channel.
            Report "WARN" "Auto-compaction window" @("Could not set it: " + (Get-SanitizedLine $result.reason 200) + ".", "Add it by hand instead: `"autoCompactWindow`": $recommendedWindow")
        }
    }
    else {
        Report "INFO" "Auto-compaction window" $detail
    }
}
elseif ($configuredWindow -lt $windowFloor) {
    # Below the documented floor nothing derived from the value can be
    # trusted, so no trigger arithmetic is shown: the honest report is that
    # the behavior is unknown, not a clamped-to-zero number and a PASS.
    Report "WARN" "Auto-compaction window" @(
        "autoCompactWindow is $configuredWindow, below the documented floor of $windowFloor, so the harness may clamp or ignore it and the real trigger is unknown.",
        "Set it to $recommendedWindow (the documented range starts at $windowFloor)."
    )
}
else {
    $trigger = $configuredWindow - $autoCompactReserve
    # Display guard only: the floor branch above already refuses any window
    # small enough to derive a negative trigger, so this clamp is unreachable
    # belt-and-braces against the two constants drifting.
    $displayTrigger = [Math]::Max(0, $trigger)
    $detail = @("autoCompactWindow is $configuredWindow, so a compaction is offered near $displayTrigger consumed (the trigger runs about $autoCompactReserve below the configured window).")
    # The one direction of the gate that is not fail-open: the valve is an
    # absolute token count assuming the model window plan sessions run on, and
    # the PreCompact payload carries no model field to derive the real one. A
    # trigger at or above the ceiling makes the feature inert outright, and a
    # band thinner than a couple of large turns ($minUsableBand) is inert in
    # practice, so both warn rather than only the zero-or-negative case.
    if ($null -ne $valveCeiling -and ($valveCeiling - $trigger) -lt $minUsableBand) {
        Report "WARN" "Auto-compaction window" ($detail + @(
            "That trigger leaves less than $minUsableBand tokens of deferral band below the gate's safety ceiling of $valveCeiling, so the valve ends deferral as soon as, or before, the harness starts offering.",
            "Lower it to $recommendedWindow to restore a usable band between the trigger and the ceiling."
        ))
    }
    elseif ($configuredWindow -ne $recommendedWindow) {
        # A usable window that is not the recommended one is stale rather than
        # broken: its trigger is real, and it either cleared the thin-band check
        # above or that check was skipped for an unreadable ceiling. INFO rather
        # than WARN for that reason, so a machine that is merely un-migrated does
        # not report yellow, and the thin-band case above takes precedence when
        # both apply. Without this branch the recommendation could never reach a
        # machine that already has a value, since every other branch here answers
        # only an absent, unparseable, or below-floor one.
        $mismatchDetail = $detail + @(
            "The recommended window is $recommendedWindow, which offers a compaction near $recommendedTrigger consumed."
        )
        # The band comparison is directional and depends on a ceiling that may
        # not have been readable, so it is claimed only where it is true. Moving
        # DOWN to the recommendation widens the band; moving up to it narrows
        # one that was already wider, which is still the recommended trade but
        # not for this reason, so no reason is offered there rather than a
        # false one.
        if ($null -ne $valveCeiling -and $configuredWindow -gt $recommendedWindow) {
            $mismatchDetail += "That also widens the deferral band below the gate's safety ceiling of $valveCeiling, from $($valveCeiling - $trigger) tokens to $($valveCeiling - $recommendedTrigger)."
        }
        # Replacing a value the operator chose is a wider act than filling in an
        # absent one, so it takes an interactive yes and is withheld from -Yes:
        # an unattended run cannot tell a deliberate window from a stale one,
        # and would revert the deliberate one on every run after every retune of
        # $recommendedWindow. The prompt names both values rather than only the
        # target, so the answer is given against the actual change.
        if ($Fix -and (Get-Consent "Change autoCompactWindow from $configuredWindow to $recommendedWindow in $settingsPath?" -Interactive)) {
            $result = Set-AutoCompactWindow -Path $settingsPath -Value $recommendedWindow
            if ($result.ok) {
                Report "FIXED" "Auto-compaction window" @("Changed autoCompactWindow from $configuredWindow to $recommendedWindow.", "Restart Claude Code for it to take effect.")
                if ($result.backupLeftover) {
                    Report "INFO" "Auto-compaction window" @("The pre-write backup could not be removed and remains at " + (Get-SanitizedLine $result.backupLeftover 200) + "; it holds a plaintext copy of settings.json, so delete it when convenient.")
                }
            }
            else {
                # The failure reasons name the pre-write backup's full path, and
                # that backup holds a plaintext copy of settings.json, so this
                # line is allowed more room than the usual report: truncating the
                # one channel that says where a secrets-adjacent copy was left is
                # the wrong economy.
                Report "WARN" "Auto-compaction window" @("Could not change it: " + (Get-SanitizedLine $result.reason 400) + ".", "Set it by hand instead: `"autoCompactWindow`": $recommendedWindow")
            }
        }
        else {
            # The remedy differs by why consent was not given, and naming the
            # flag already supplied would send the operator back through a
            # prompt they just declined.
            $remedy = if ($Fix) {
                "Set it by hand in $settingsPath, or re-run and answer yes at the prompt (this change is withheld from -Yes because it replaces a value you chose)."
            } else {
                "Re-run the doctor with -Fix to change it, which asks before writing, or set it by hand in $settingsPath."
            }
            Report "INFO" "Auto-compaction window" ($mismatchDetail + @($remedy))
        }
    }
    else {
        Report "PASS" "Auto-compaction window" $detail
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
