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
Write-Host "Next: /plugin marketplace add <your-github-username>/claude-kit ; /plugin install claude-kit@applefeld (user scope)"
