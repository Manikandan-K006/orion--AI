 = 
 = "\backend\venv\Scripts\python.exe"

Write-Host "=== MZ Orator Local Launcher ===" -ForegroundColor Cyan
Write-Host "Checking ports 8000 and 3000..." -ForegroundColor Gray
 = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
if () { foreach ( in ) { Stop-Process -Id .OwningProcess -Force -ErrorAction SilentlyContinue } }
 = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if () { foreach ( in ) { Stop-Process -Id .OwningProcess -Force -ErrorAction SilentlyContinue } }
Start-Sleep -Seconds 2

 = 3306
 = Get-NetTCPConnection -LocalPort  -ErrorAction SilentlyContinue
if (-not ) {
    Write-Host "Starting local MySQL database..." -ForegroundColor Yellow
     = "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe"
     = "\database\data"
    if (Test-Path ) {
         = @("--datadir=""", "--port=")
        Start-Process -FilePath  -ArgumentList  -WindowStyle Hidden
        Start-Sleep -Seconds 3
    }
}

Write-Host "[1/2] Starting backend..." -ForegroundColor Yellow
 = Start-Process -FilePath  -ArgumentList "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000" -WindowStyle Hidden -PassThru -WorkingDirectory ""

Start-Sleep -Seconds 4

Write-Host "[2/2] Starting frontend..." -ForegroundColor Yellow
 = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" -WindowStyle Hidden -PassThru -WorkingDirectory "\frontend"

Write-Host "
=== BOTH SERVERS STARTING ===" -ForegroundColor Green
