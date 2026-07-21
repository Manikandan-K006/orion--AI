$root = $PSScriptRoot
$pythonExe = "$root\backend\venv\Scripts\python.exe"

Write-Host "=== MZ Orator Local Launcher ===" -ForegroundColor Cyan
Write-Host "Checking ports 8001 and 3001..." -ForegroundColor Gray
$port8000 = Get-NetTCPConnection -LocalPort 8001 -ErrorAction SilentlyContinue
if ($port8000) { foreach ($p in $port8000) { Stop-Process -Id $p.OwningProcess -Force -ErrorAction SilentlyContinue } }
$port3000 = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue
if ($port3000) { foreach ($p in $port3000) { Stop-Process -Id $p.OwningProcess -Force -ErrorAction SilentlyContinue } }
Start-Sleep -Seconds 2

$mysqlPort = 3306
$isMysqlRunning = Get-NetTCPConnection -LocalPort $mysqlPort -ErrorAction SilentlyContinue
if (-not $isMysqlRunning) {
    Write-Host "Starting local MySQL database..." -ForegroundColor Yellow
    $mysqlExe = "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe"
    $mysqlDataDir = "$root\database\data"
    if (Test-Path $mysqlExe) {
        $args = @("--datadir=`"$mysqlDataDir`"", "--port=$mysqlPort")
        Start-Process -FilePath $mysqlExe -ArgumentList $args -WindowStyle Hidden
        Start-Sleep -Seconds 3
    }
}

Write-Host "[1/2] Starting backend..." -ForegroundColor Yellow
$p1 = Start-Process -FilePath $pythonExe -ArgumentList "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8001" -WindowStyle Hidden -PassThru -WorkingDirectory "$root"

Start-Sleep -Seconds 4

Write-Host "[2/2] Starting frontend..." -ForegroundColor Yellow
$p2 = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev", "--", "-p", "3001", "-H", "0.0.0.0" -WindowStyle Hidden -PassThru -WorkingDirectory "$root\frontend"

Write-Host "`n=== BOTH SERVERS STARTING ===" -ForegroundColor Green
