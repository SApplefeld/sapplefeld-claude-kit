# Install home/CLAUDE.md as the user-level CLAUDE.md, backing up any existing file.
# Run from the repo root: .\setup.ps1

# Resolve Paths.
$source = Join-Path $PSScriptRoot "home\CLAUDE.md"
$targetDir = Join-Path $env:USERPROFILE ".claude"
$target = Join-Path $targetDir "CLAUDE.md"

# Validate Source.
if (-not (Test-Path $source)) {
    Write-Error "home\CLAUDE.md not found next to setup.ps1. Run from the repo root."
    exit 1
}

# Ensure Target Directory.
if (-not (Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir | Out-Null
}

# Back Up Existing File.
if (Test-Path $target) {
    $backup = "$target.bak.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $target $backup
    Write-Host "Existing CLAUDE.md backed up to $backup"
}

# Install.
Copy-Item $source $target -Force
Write-Host "Installed $source -> $target"

# Record the kaizen signpost: where this machine's kit clone lives, so kaizen
# capture can find it from any project. Machine-local, never committed.
# Write UTF-8 without BOM so Node/JSON readers do not choke on a leading BOM.
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

Write-Host "Next: /plugin marketplace add <your-github-username>/claude-kit ; /plugin install claude-kit@applefeld (user scope)"
