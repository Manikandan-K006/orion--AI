@echo off
:: Check for permissions
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"

:: If error flag set, we do not have admin.
if '%errorlevel%' NEQ '0' (
    echo Requesting administrative privileges...
    goto UACPrompt
) else ( goto gotAdmin )

:UACPrompt
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "cmd.exe", "/c """%~s0"""", "", "runas", 1 >> "%temp%\getadmin.vbs"

    "%temp%\getadmin.vbs"
    del "%temp%\getadmin.vbs"
    exit /B

:gotAdmin
    pushd "%CD%"
    CD /D "%~dp0"

    echo ============================================================
    echo  SpeakSense AI - Auto-Elevated Firewall Port Opener
    echo ============================================================
    echo.
    echo  Opening incoming port 3000 (Frontend)...
    netsh advfirewall firewall delete rule name="SpeakSense Frontend 3000" >nul 2>&1
    netsh advfirewall firewall add rule name="SpeakSense Frontend 3000" dir=in action=allow protocol=TCP localport=3000
    
    echo  Opening incoming port 8000 (Backend)...
    netsh advfirewall firewall delete rule name="SpeakSense Backend 8000" >nul 2>&1
    netsh advfirewall firewall add rule name="SpeakSense Backend 8000" dir=in action=allow protocol=TCP localport=8000
    
    echo.
    echo ============================================================
    echo  SUCCESS! Ports 3000 and 8000 are now open to other devices.
    echo ============================================================
    echo.
    echo  Students on the same WiFi can now open:
    echo  http://10.201.160.229:3000
    echo.
    pause
