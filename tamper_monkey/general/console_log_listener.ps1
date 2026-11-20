# Receives log batches POSTed by console_log_forwarder.user.js and appends them,
# timestamped, to console-forward.log next to this script. Stop with Ctrl+C.
param([int]$Port = 8766)

$logFile = Join-Path $PSScriptRoot 'console-forward.log'
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Listening on http://localhost:$Port/, writing to $logFile"

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $reader = [System.IO.StreamReader]::new($ctx.Request.InputStream, [System.Text.Encoding]::UTF8)
        $body = $reader.ReadToEnd()
        $reader.Dispose()
        $stamp = Get-Date -Format 'HH:mm:ss.fff'
        $lines = foreach ($l in ($body -split "`n")) { if ($l -match '^\s{6}') { $l } else { "$stamp $l" } }
        Add-Content -Path $logFile -Value $lines -Encoding utf8
        $ctx.Response.StatusCode = 204
        $ctx.Response.Close()
    }
}
finally {
    $listener.Stop()
}
