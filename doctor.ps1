# Thin forwarder. The doctor ships inside the plugin payload
# (plugins\claude-kit\doctor\doctor.ps1) so installed machines get it with
# every plugin update; this wrapper keeps the repo-root habit working.
# Usage: .\doctor.ps1 [-Fix] [-Yes] [-NoProbe]
$target = Join-Path $PSScriptRoot "plugins\claude-kit\doctor\doctor.ps1"
if (-not (Test-Path $target)) {
    Write-Host "Payload doctor not found at $target (partial checkout or moved file)." -ForegroundColor Red
    exit 1
}
& $target @args
exit $LASTEXITCODE
