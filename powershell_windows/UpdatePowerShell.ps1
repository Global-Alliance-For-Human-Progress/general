# Goal: Keep PowerShell 7 up to date via winget (the installed copy is the winget/MSIX one, no admin needed)
# Intended to run weekly from the "UpdatePowerShell" scheduled task (see Register-UpdatePowerShellTask.ps1)

$logFile = "$env:APPDATA\UpdatePowerShell.log"

function Write-Log($msg) {
    "$(Get-Date -Format 's') $msg" | Add-Content $logFile
    Write-Host $msg
}

Write-Log "Checking for PowerShell updates..."
$out = winget upgrade --id Microsoft.PowerShell --silent --accept-source-agreements --accept-package-agreements 2>&1 | Out-String
Write-Log $out.Trim()
exit $LASTEXITCODE
