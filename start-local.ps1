$root = $PSScriptRoot
$pythonExe = "$root\..\.venv\Scripts\python.exe"

Write-Host "=== MZ Orator Local Launcher ===" -ForegroundColor Cyan

# Safe stop of processes on target ports (8000 and 3000)
Write-Host "Checking ports 8000 and 3000..." -ForegroundColor Gray
$port8000 = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
if ($port8000) {
    Write-Host "Stopping process on port 8000..." -ForegroundColor Yellow
    foreach ($p in $port8000) {
        Stop-Process -Id $p.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}
$port3000 = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($port3000) {
    Write-Host "Stopping process on port 3000..." -ForegroundColor Yellow
    foreach ($p in $port3000) {
        Stop-Process -Id $p.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Seconds 2

# Check and start MySQL
$mysqlPort = 3306
$isMysqlRunning = Get-NetTCPConnection -LocalPort $mysqlPort -ErrorAction SilentlyContinue
if (-not $isMysqlRunning) {
    Write-Host "Starting local MySQL database..." -ForegroundColor Yellow
    $appdata = $env:APPDATA
    $mysqlExe = "$appdata\Local\lightning-services\mysql-8.4.0\bin\win64\bin\mysqld.exe"
    $mysqlDataDir = "$root\database\data"
    if (Test-Path $mysqlExe) {
        Start-Process -FilePath $mysqlExe -ArgumentList "--datadir='$mysqlDataDir'", "--port=$mysqlPort" -WindowStyle Hidden
        Start-Sleep -Seconds 3
    } else {
        Write-Warning "Could not find MySQL executable at $mysqlExe"
    }
} else {
    Write-Host "MySQL database is already running." -ForegroundColor Green
}

Write-Host "[1/2] Starting backend on http://localhost:8000 ..." -ForegroundColor Yellow
$p1 = Start-Process -PassThru powershell -WindowStyle Normal -ArgumentList "-NoExit -Command cd '$root'; & '$pythonExe' -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"

Start-Sleep -Seconds 4

Write-Host "[2/2] Starting frontend on http://localhost:3000 ..." -ForegroundColor Yellow
$p2 = Start-Process -PassThru powershell -WindowStyle Normal -ArgumentList "-NoExit -Command cd '$root\frontend'; npm run dev"

Start-Sleep -Seconds 3
Write-Host "`n=== BOTH SERVERS STARTING ===" -ForegroundColor Green
Write-Host "Open http://localhost:3000 in your browser" -ForegroundColor Green
Write-Host "Close both PowerShell windows to stop the servers." -ForegroundColor Gray

