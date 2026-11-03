# Receives log lines POSTed by youtube_music_background_keep_playing.js and appends them,
# timestamped, to ytm-fix.log next to this script. Stop with Ctrl+C.
param([int]$Port = 8765)

$logFile = Join-Path $PSScriptRoot 'ytm-fix.log'
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
        $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'), $body
        Add-Content -Path $logFile -Value $line -Encoding utf8
        $ctx.Response.StatusCode = 204
        $ctx.Response.Close()
    }
}
finally {
    $listener.Stop()
}
