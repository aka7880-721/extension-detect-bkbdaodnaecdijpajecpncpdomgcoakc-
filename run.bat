@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "HOST=127.0.0.1"
set "BASE_PORT=3000"
set "MAX_PORT=3010"
set "PORTABLE_PY=%~dp0.runtime\python\python.exe"

echo.
echo  eID Extension Detector
echo  1. Click the Chrome window to test
echo  2. Double-click run.bat
echo.

call :find_port
if errorlevel 1 goto :failed

if not exist "var" mkdir "var"
if exist "var\result.json" del /f /q "var\result.json" >nul 2>&1
powershell -NoProfile -Command "[IO.File]::WriteAllText('var/run-id.txt', [guid]::NewGuid().ToString('n'))"

call :start_server
goto :eof

:start_server
where py >nul 2>&1 && (
  echo http://%HOST%:!PORT!/ — keep open
  py "%~dp0server\serve.py" --bind %HOST% --port !PORT!
  goto :eof
)
where python >nul 2>&1 && (
  python "%~dp0server\serve.py" --bind %HOST% --port !PORT!
  goto :eof
)
if exist "%PORTABLE_PY%" (
  "%PORTABLE_PY%" "%~dp0server\serve.py" --bind %HOST% --port !PORT!
  goto :eof
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\setup-python.ps1"
if exist "%PORTABLE_PY%" (
  "%PORTABLE_PY%" "%~dp0server\serve.py" --bind %HOST% --port !PORT!
  goto :eof
)
echo ERROR: Python required.
pause
exit /b 1

:find_port
set "PORT="
for /L %%P in (%BASE_PORT%,1,%MAX_PORT%) do (
  powershell -NoProfile -Command "$l=New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Parse('%HOST%'), %%P); try { $l.Start(); $l.Stop(); exit 0 } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 set "PORT=%%P" & exit /b 0
)
echo ERROR: No free port %BASE_PORT%-%MAX_PORT%.
exit /b 1

:failed
pause
exit /b 1
