param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$port = 5188
$url = "http://127.0.0.1:$port/"
Set-Location -LiteralPath $project
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22.14 or newer from https://nodejs.org first.' }
if (-not (Test-Path -LiteralPath (Join-Path $project 'node_modules\vite\bin\vite.js'))) {
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
  if ($response.Content -notmatch 'CRUSH CITY') { throw "Port $port is used by a different application." }
} else {
  $work = Join-Path $project 'work'
  New-Item -ItemType Directory -Path $work -Force | Out-Null
  $nodePath = (Get-Command node).Source
  $server = Start-Process -FilePath $nodePath -ArgumentList @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', "$port", '--strictPort') -WorkingDirectory $project -WindowStyle Hidden -RedirectStandardOutput (Join-Path $work 'vite.stdout.log') -RedirectStandardError (Join-Path $work 'vite.stderr.log') -PassThru
  $server.Id | Set-Content -LiteralPath (Join-Path $work 'vite.pid')
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 250
    try { $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ready = $true; break } } catch { }
  }
  if (-not $ready) { throw "Server did not start. Check $work\vite.stderr.log" }
}
Write-Host "Crush City is ready: $url"
if (-not $NoBrowser) { Start-Process $url }
