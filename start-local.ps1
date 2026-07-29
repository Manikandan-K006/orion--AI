param(
    [switch]$NoFrontend,
    [switch]$NoBackend
)

$ErrorActionPreference = "Stop"
$ScriptRoot = $PSScriptRoot

# ────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────
function Write-Header {
    Clear-Host
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  SpeakSense AI - LAN Server" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

function Get-LanIPv4 {
    $adapters = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
        $_.InterfaceAlias -notlike "*Loopback*" -and
        $_.PrefixOrigin -ne "WellKnown" -and
        $_.AddressFamily -eq "IPv4"
    }
    $lan = $adapters | Where-Object { $_.PrefixLength -le 24 -and $_.PrefixLength -ge 16 } |
        Sort-Object PrefixLength -Descending |
        Select-Object -First 1
    if (-not $lan) { $lan = $adapters | Select-Object -First 1 }
    if (-not $lan) { throw "Could not determine LAN IPv4 address." }
    return $lan.IPAddress
}

function Test-PortInUse {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    return [bool]$conn
}

function Start-ProcessWindow {
    param([string]$Title, [string]$Command)
    $cmdText = "$host.UI.RawUI.WindowTitle = '$Title'; $Command"
    $bytes = [System.Text.Encoding]::Unicode.GetBytes($cmdText)
    $encoded = [System.Convert]::ToBase64String($bytes)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "powershell.exe"
    $psi.Arguments = "-NoExit -EncodedCommand $encoded"
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Normal
    $psi.UseShellExecute = $true
    $null = [System.Diagnostics.Process]::Start($psi)
}

# ────────────────────────────────────────────────────────────
# Validation
# ────────────────────────────────────────────────────────────
$FrontendDir = Join-Path $ScriptRoot "frontend"
$BackendDir  = Join-Path $ScriptRoot "backend"

if (-not (Test-Path $FrontendDir)) { throw "Frontend directory not found: $FrontendDir" }
if (-not (Test-Path $BackendDir))  { throw "Backend directory not found: $BackendDir" }

# Check npm
$npmPath = (Get-Command npm -ErrorAction SilentlyContinue).Source
if (-not $npmPath) { throw "npm is not installed or not in PATH." }

# Check Python / venv
$venvPython = Join-Path $BackendDir "venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    # Try system Python as fallback
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCmd) { throw "Python not found and venv missing at $venvPython." }
    $venvPython = $pythonCmd.Source
}

# Check uvicorn
$uvicornExe = Join-Path $BackendDir "venv\Scripts\uvicorn.exe"
if (-not (Test-Path $uvicornExe)) { throw "uvicorn not found at $uvicornExe. Run: pip install uvicorn" }

# ────────────────────────────────────────────────────────────
# Port checks
# ────────────────────────────────────────────────────────────
$port3001 = Test-PortInUse -Port 3001
$port8001 = Test-PortInUse -Port 8001

if ($port3001) { Write-Host "WARNING: Port 3001 is already in use." -ForegroundColor Yellow }
if ($port8001) { Write-Host "WARNING: Port 8001 is already in use." -ForegroundColor Yellow }
if ($port3001 -or $port8001) {
    Write-Host ""
    $answer = Read-Host "Port(s) occupied. Continue anyway? (y/N)"
    if ($answer -ne "y") { Write-Host "Aborted."; exit 1 }
}

# ────────────────────────────────────────────────────────────
# Detect LAN IP & display info
# ────────────────────────────────────────────────────────────
$lanIp = Get-LanIPv4

# Dynamically write backend API URL using detected LAN IP address
$envLocalFile = Join-Path $FrontendDir ".env.local"
$envProdFile  = Join-Path $FrontendDir ".env.production"
"NEXT_PUBLIC_API_URL=http://${lanIp}:8000" | Out-File -FilePath $envLocalFile -Encoding utf8 -Force
"NEXT_PUBLIC_API_URL=http://${lanIp}:8000" | Out-File -FilePath $envProdFile  -Encoding utf8 -Force

Write-Header
Write-Host "  Host PC:" -ForegroundColor Green
Write-Host "    http://localhost:3001" -ForegroundColor White
Write-Host ""
Write-Host "  Student devices:" -ForegroundColor Green
Write-Host "    http://$lanIp`:3001" -ForegroundColor White
Write-Host ""
Write-Host "  Backend:" -ForegroundColor Green
Write-Host "    http://$lanIp`:8001" -ForegroundColor White
Write-Host ""
Write-Host "  API Docs:" -ForegroundColor Green
Write-Host "    http://$lanIp`:8001/docs" -ForegroundColor White
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ────────────────────────────────────────────────────────────
# Start processes
# ────────────────────────────────────────────────────────────
$backendCommand = "& '$uvicornExe' backend.main:app --host 0.0.0.0 --port 8001"
$frontendCommand = "npm run dev"

if (-not $NoBackend) {
    Write-Host "Starting Backend..." -ForegroundColor Magenta
    Start-ProcessWindow -Title "SpeakSense Backend" -Command "cd '$ScriptRoot'; $backendCommand"
    Start-Sleep -Seconds 2
}

if (-not $NoFrontend) {
    Write-Host "Starting Frontend..." -ForegroundColor Magenta
    Start-ProcessWindow -Title "SpeakSense Frontend" -Command "cd '$FrontendDir'; $frontendCommand"
}

Write-Host ""
Write-Host "Done. Check the new terminal windows for startup logs." -ForegroundColor Green