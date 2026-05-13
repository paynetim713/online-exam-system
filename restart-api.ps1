$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$apiLog = Join-Path $root 'api-dev.log'
$apiErr = Join-Path $root 'api-dev.err.log'

# Kill any process on port 8000
$procs = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue |
  Where-Object { $_.State -eq 'Listen' } |
  Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $procs) {
  Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  Write-Output "Killed old backend process (PID $procId)"
}

Start-Sleep -Seconds 1

# Start fresh backend
Start-Process -FilePath py `
  -ArgumentList '-3.12','-X','utf8','-m','uvicorn','main:app','--host','127.0.0.1','--port','8000' `
  -WorkingDirectory $root `
  -RedirectStandardOutput $apiLog `
  -RedirectStandardError $apiErr | Out-Null

Start-Sleep -Seconds 2
Write-Output 'Backend restarted: http://127.0.0.1:8000/api/health'
try {
  $health = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/health' -UseBasicParsing -TimeoutSec 3
  Write-Output "Backend health check: $($health.StatusCode)"
} catch {
  Write-Output 'Backend health check failed. Open api-dev.err.log for details.'
}
