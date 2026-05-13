$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$apiLog = Join-Path $root 'api-dev.log'
$apiErr = Join-Path $root 'api-dev.err.log'
$webLog = Join-Path $root 'vite-dev.log'
$webErr = Join-Path $root 'vite-dev.err.err'

# Kill existing processes on port 8000 and 5173
foreach ($port in @(8000, 5173)) {
  $procIds = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq 'Listen' } |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $procIds) {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
}

Start-Sleep -Seconds 1

# Start backend
"" | Out-File $apiLog -Encoding utf8
"" | Out-File $apiErr -Encoding utf8
Start-Process -FilePath py `
  -ArgumentList '-3.12','-X','utf8','-m','uvicorn','main:app','--host','127.0.0.1','--port','8000' `
  -WorkingDirectory $root `
  -RedirectStandardOutput $apiLog `
  -RedirectStandardError $apiErr | Out-Null

# Start frontend
"" | Out-File $webLog -Encoding utf8
Start-Process -FilePath cmd.exe `
  -ArgumentList '/c','npm run dev -- --host 127.0.0.1' `
  -WorkingDirectory $root `
  -RedirectStandardOutput $webLog `
  -RedirectStandardError $webErr | Out-Null

Start-Sleep -Seconds 3

Write-Output 'Local services started.'
Write-Output 'Frontend: http://127.0.0.1:5173/'
Write-Output 'Backend:  http://127.0.0.1:8000/api/health'
try {
  $health = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/health' -UseBasicParsing -TimeoutSec 3
  Write-Output "Backend health check: $($health.StatusCode)"
} catch {
  Write-Output 'Backend health check failed. Open api-dev.err.log for details.'
}
Write-Output ''
Write-Output 'Default admin account: admin01 / Admin@123'
