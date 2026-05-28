# Goal: Automatically check for and install PowerShell updates on startup
# Runs on system startup, but limits updates to once every 2 days to avoid excessive restarts

$logFile = "$env:APPDATA\UpdatePowerShell.log"

# Throttle checks: only run if 2+ days have passed since last successful update
# This prevents frequent update attempts on systems that restart often
if (Test-Path $logFile) {
    $lastRun = Get-Item $logFile | Select-Object -ExpandProperty LastWriteTime
    $daysSinceLastRun = (Get-Date) - $lastRun
    if ($daysSinceLastRun.Days -lt 2) {
        Write-Host "Last update was $([math]::Floor($daysSinceLastRun.TotalHours)) hours ago. Skipping (needs 2 days)."
        exit 0
    }
}

# Fetch latest PowerShell release from GitHub API
Write-Host "Checking for latest PowerShell version..."
try {
    $latestTag = (Invoke-RestMethod "https://api.github.com/repos/PowerShell/PowerShell/releases/latest").tag_name
    $latestVersion = $latestTag.TrimStart("v")
    Write-Host "Latest version: $latestVersion"
} catch {
    Write-Error "Failed to fetch latest version: $_"
    exit 1
}

# Build download URL and temp file path for the MSI installer
$msiUrl = "https://github.com/PowerShell/PowerShell/releases/download/$latestTag/PowerShell-$latestVersion-win-x64.msi"
$msiPath = "$env:TEMP\PowerShell-$latestVersion-win-x64.msi"

# Download the installer
Write-Host "Downloading PowerShell $latestVersion..."
try {
    Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath
    Write-Host "Download complete"
} catch {
    Write-Error "Failed to download MSI: $_"
    exit 1
}

# Run the MSI installer with /passive flag (shows progress, no prompts)
# Requires admin privileges to execute
Write-Host "Installing PowerShell..."
$proc = Start-Process msiexec -ArgumentList "/i `"$msiPath`" /passive" -Wait -PassThru
if ($proc.ExitCode -eq 0) {
    Write-Host "Installation successful!"
    # Clean up: remove downloaded MSI and update log file timestamp
    Remove-Item $msiPath -Force
    Set-Content $logFile "" -Force
} else {
    Write-Error "Installation failed with exit code: $($proc.ExitCode)"
}
