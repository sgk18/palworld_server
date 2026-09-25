@echo off
title Palworld Server Power Manager
cls
:MENU
echo ========================================================
echo       PALWORLD AZURE DEDICATED SERVER CONTROLLER
echo ========================================================
echo.
echo   [1] Start Server (Power on Azure VM)
echo   [2] Turn Off Server (Save world & deallocate to stop billing)
echo   [3] Restart Server (Reboot VM & game container)
echo   [4] Check Server Status (Live API check)
echo   [5] Open Web Dashboard (http://localhost:5050)
echo   [6] Exit
echo.
echo ========================================================
set /p choice="Enter your choice [1-6]: "

if "%choice%"=="1" goto START_SERVER
if "%choice%"=="2" goto STOP_SERVER
if "%choice%"=="3" goto RESTART_SERVER
if "%choice%"=="4" goto STATUS_SERVER
if "%choice%"=="5" goto OPEN_DASHBOARD
if "%choice%"=="6" goto EXIT
echo Invalid choice, please try again.
pause
goto MENU

:START_SERVER
cls
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_server.ps1"
echo.
pause
goto MENU

:STOP_SERVER
cls
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop_server.ps1"
echo.
pause
goto MENU

:RESTART_SERVER
cls
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart_server.ps1"
echo.
pause
goto MENU

:STATUS_SERVER
cls
echo Querying server status...
node -e "const http = require('http'); http.get('http://localhost:5050/api/power', r => { let d=''; r.on('data', c=>d+=c); r.on('end', ()=>console.log(JSON.parse(d))); }).on('error', e=>console.log('Local dashboard server not running on port 5050. Run npm start or node server.js'));"
echo.
pause
goto MENU

:OPEN_DASHBOARD
start http://localhost:5050
goto MENU

:EXIT
exit
