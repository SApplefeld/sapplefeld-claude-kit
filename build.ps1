#Requires -Version 5.1
<#
    build.ps1 - Package the claude-kit plugin into an installable zip.

    Produces plugins/claude-kit.zip with the plugin folder (claude-kit/) at the
    archive root - the layout the Cowork/Chat "upload a plugin zip" flow expects.
    The archive is built deterministically (sorted entries, fixed timestamps) so
    repeated builds of unchanged sources yield byte-identical output and clean diffs.

    Canonical builder on Windows. Run from anywhere - paths resolve against the
    script location, not the current directory.
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Configuration.
$pluginName = 'claude-kit'
$sourceDir  = Join-Path $PSScriptRoot "plugins\$pluginName"
$zipPath    = Join-Path $PSScriptRoot "plugins\$pluginName.zip"

# Junk we never want inside the artifact regardless of platform.
$excludeNames = @('.DS_Store', 'Thumbs.db', 'desktop.ini')

# Zip timestamps cannot predate 1980; use the floor so builds are reproducible.
$fixedDate = [System.DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [System.TimeSpan]::Zero)

# Validate Source.
if (-not (Test-Path -LiteralPath $sourceDir)) {
    throw "Plugin source not found: $sourceDir"
}

# Load Compression Types.
Add-Type -AssemblyName System.IO.Compression | Out-Null

# Collect Files (deterministic order; hidden/dotfiles included, junk excluded).
$sourceFull = (Resolve-Path -LiteralPath $sourceDir).Path
$files = @(
    Get-ChildItem -LiteralPath $sourceFull -Recurse -File -Force |
        Where-Object { $excludeNames -notcontains $_.Name } |
        Sort-Object -Property FullName
)

if ($files.Count -eq 0) {
    throw "No files found under $sourceFull - nothing to package."
}

# Recreate Archive From Scratch.
if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

$stream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::CreateNew)
try {
    $archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $files) {
            # Entry path relative to the plugin folder, with claude-kit/ as the root.
            $relative  = $file.FullName.Substring($sourceFull.Length).TrimStart('\', '/').Replace('\', '/')
            $entryName = "$pluginName/$relative"

            $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = $fixedDate

            $entryStream = $entry.Open()
            try {
                $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
                $entryStream.Write($bytes, 0, $bytes.Length)
            }
            finally {
                $entryStream.Dispose()
            }
        }
    }
    finally {
        $archive.Dispose()
    }
}
finally {
    $stream.Dispose()
}

# Report.
$sizeKb = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1KB, 1)
Write-Host "Built $zipPath ($($files.Count) files, $sizeKb KB)"
