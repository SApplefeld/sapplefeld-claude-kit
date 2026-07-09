# Dev-clone setup for the claude-kit repo: record the kaizen signpost and wire git
# hooks. Run from the repo root: .\setup.ps1
#
# The operating doctrine ships via the plugin now (the operating-instructions
# skill), so setup no longer installs a user-level CLAUDE.md. On Claude Code the
# doctrine-refresh hook maintains ~/.claude/claude-kit-doctrine.md and your
# ~/.claude/CLAUDE.md imports it with one line (see the Next hints).

# Resolve Paths.
$targetDir = Join-Path $env:USERPROFILE ".claude"
$pluginMarker = Join-Path $PSScriptRoot "plugins\claude-kit\.claude-plugin\plugin.json"

# Validate this is the kit repo (so the signpost's kitRepoPath is meaningful).
if (-not (Test-Path -LiteralPath $pluginMarker)) {
    Write-Error "Not the claude-kit repo root (plugins\claude-kit\.claude-plugin\plugin.json missing). Run from the repo root."
    exit 1
}

# Ensure Target Directory.
if (-not (Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir | Out-Null
}

# Record the kaizen signpost: where this machine's kit clone lives, so kaizen
# capture (the kaizen skill) can find the clone from any project. Machine-local,
# never committed. Write UTF-8 without BOM so Node/JSON readers do not choke.
$signpost = Join-Path $targetDir "claude-kit.local.json"
$data = [ordered]@{ kitRepoPath = $PSScriptRoot; machine = $env:COMPUTERNAME }
$json = $data | ConvertTo-Json
[System.IO.File]::WriteAllText($signpost, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Recorded kaizen signpost at $signpost"

# Wire Git Hooks. Points this clone at .githooks so the pre-commit hook rebuilds
# plugins/claude-kit.zip whenever a commit changes the plugin sources.
if (Get-Command git -ErrorAction SilentlyContinue) {
    & git -C $PSScriptRoot config core.hooksPath .githooks
    Write-Host "Configured git core.hooksPath -> .githooks"
}
else {
    Write-Warning "git not found; skipped hook wiring. Run later: git config core.hooksPath .githooks"
}

Write-Host "Next:"
Write-Host "  1. Install the plugin:  /plugin marketplace add <your-github-username>/claude-kit ; /plugin install claude-kit@applefeld"
Write-Host "  2. (Claude Code, once per machine) add to ~/.claude/CLAUDE.md so the doctrine loads always-on:  @claude-kit-doctrine.md"
Write-Host "  3. (Cowork/Chat, once per account) add to your account preferences:  Before any non-trivial task, consult the operating-instructions skill."
Write-Host "  4. Verify the machine end to end:  .\doctor.ps1   (doctor.cmd while scripts are policy-blocked; -Fix applies the safe repairs)"
