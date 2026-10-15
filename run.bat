@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "BASE_PORT=3000"
set "MAX_PORT=3010"
set "HOST=127.0.0.1"
set "PORTABLE_PY=%~dp0.runtime\python\python.exe"

echo.
echo  eID Chrome Extension detector
echo  Folder: %CD%
echo.
echo  Keep this window open while testing. Close it or press Ctrl+C to stop.
echo.

call :find_port
if errorlevel 1 goto :failed

echo Open in Chrome: http://%HOST%:!PORT!/
echo.

call :open_browser_delayed

where py >nul 2>&1
if not errorlevel 1 (
  echo Starting server: py -m http.server !PORT! --bind %HOST%
  py -m http.server !PORT! --bind %HOST%
  if not errorlevel 1 goto :eof
  echo py failed on port !PORT!.
)

where python >nul 2>&1
if not errorlevel 1 (
  echo Starting server: python -m http.server !PORT! --bind %HOST%
  python -m http.server !PORT! --bind %HOST%
  if not errorlevel 1 goto :eof
  echo python failed on port !PORT!.
)

if exist "%PORTABLE_PY%" (
  echo Starting server: portable Python on %HOST%:!PORT!
  "%PORTABLE_PY%" -m http.server !PORT! --bind %HOST%
  if not errorlevel 1 goto :eof
  echo Portable Python failed on port !PORT!.
)

if not exist "%PORTABLE_PY%" (
  echo Setting up portable Python one time into .runtime\python ...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-python.ps1"
  if exist "%PORTABLE_PY%" (
    "%PORTABLE_PY%" -m http.server !PORT! --bind %HOST%
    if not errorlevel 1 goto :eof
  )
)

echo Using PowerShell web server on %HOST% ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port !PORT! -MaxPort !MAX_PORT! -HostAddress %HOST%
if errorlevel 1 goto :failed
goto :eof

:find_port
set "PORT="
for /L %%P in (%BASE_PORT%,1,%MAX_PORT%) do (
  powershell -NoProfile -Command "$l=New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Parse('%HOST%'), %%P); try { $l.Start(); $l.Stop(); exit 0 } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 (
    set "PORT=%%P"
    echo Using port %%P on %HOST%
    exit /b 0
  )
)
echo ERROR: No free port between %BASE_PORT% and %MAX_PORT% on %HOST%.
exit /b 1

:open_browser_delayed
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://%HOST%:!PORT!/"
exit /b 0

:failed
echo.
echo Server could not start. Common causes:
echo   - Port %BASE_PORT%-%MAX_PORT% blocked or in use
echo   - Antivirus blocking Python
echo   - No internet for first-time portable Python download
echo.
pause
exit /b 1
