@echo off
:: ============================================================
:: SpeakSense AI - Firewall Fix (Run as Administrator)
:: ============================================================
echo.
echo  SpeakSense AI - Opening Firewall Ports...
echo  ==========================================
echo.

:: Check if running as Admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Please right-click this file and choose
    echo         "Run as administrator"
    echo.
    pause
    exit /b 1
)

:: Remove old rules silently
netsh advfirewall firewall delete rule name="SpeakSense Frontend 3000" >nul 2>&1
netsh advfirewall firewall delete rule name="SpeakSense Backend 8000"  >nul 2>&1

:: Add inbound allow rules
netsh advfirewall firewall add rule name="SpeakSense Frontend 3000" dir=in action=allow protocol=TCP localport=3000
netsh advfirewall firewall add rule name="SpeakSense Backend 8000"  dir=in action=allow protocol=TCP localport=8000

echo.
echo  SUCCESS! Both ports are now open.
echo.
echo  Students can now open in their browser:
echo.

:: Get Wi-Fi IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr "10\."') do (
    set LAN_IP=%%a
)
set LAN_IP=%LAN_IP: =%

if "%LAN_IP%"=="" (
    echo    http://YOUR-IP:3000
) else (
    echo    http://%LAN_IP%:3000
)

echo.
echo  (Make sure they are on the same WiFi network)
echo.
pause
