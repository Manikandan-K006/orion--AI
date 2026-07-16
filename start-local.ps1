Write-Host "=== MZ Orator Local Launcher ===" -ForegroundColor Cyan

# Kill old processes
Get-Process -Name python -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

Write-Host "[1/2] Starting backend on http://localhost:8000 ..." -ForegroundColor Yellow
$p1 = Start-Process -PassThru powershell -WindowStyle Normal -ArgumentList "-NoExit -Command cd '$PSScriptRoot\backend'; .\venv\Scripts\Activate; python -m uvicorn main:app --port 8000"

Start-Sleep -Seconds 8

Write-Host "[2/2] Starting frontend on http://localhost:3000 ..." -ForegroundColor Yellow
$p2 = Start-Process -PassThru powershell -WindowStyle Normal -ArgumentList "-NoExit -Command cd '$PSScriptRoot\frontend'; npm run dev"

Start-Sleep -Seconds 5
Write-Host "`n=== BOTH SERVERS STARTING ===" -ForegroundColor Green
Write-Host "Open http://localhost:3000 in your browser" -ForegroundColor Green
Write-Host "Close both PowerShell windows to stop the servers." -ForegroundColor Gray
