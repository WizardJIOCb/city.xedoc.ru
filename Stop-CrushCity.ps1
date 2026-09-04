$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot 'work\vite.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host 'No Crush City server PID recorded.'; exit }
$serverPid = [int](Get-Content -LiteralPath $pidFile)
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
$listener = Get-NetTCPConnection -LocalPort 5188 -State Listen -ErrorAction SilentlyContinue
if ($process -and $process.Name -eq 'node.exe' -and $process.CommandLine -match 'vite' -and $process.CommandLine -match '5188' -and $listener.OwningProcess -contains $serverPid) {
  Stop-Process -Id $serverPid
  Remove-Item -LiteralPath $pidFile
  Write-Host 'Crush City server stopped.'
} else { Write-Host 'The recorded process is not the Crush City server; no processes were stopped.' }
