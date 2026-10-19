@echo off
cd /d "%~dp0"
if not exist ".venv-waterwave\Scripts\python.exe" (
  py -3 -m venv .venv-waterwave
  if errorlevel 1 goto failed
)
".venv-waterwave\Scripts\python.exe" -c "import numpy, scipy, PIL, cv2" >nul 2>&1
if errorlevel 1 (
  ".venv-waterwave\Scripts\python.exe" -m pip install -r requirements-waterwave.txt
  if errorlevel 1 goto failed
)
".venv-waterwave\Scripts\python.exe" -m waterwave
if errorlevel 1 goto failed
exit /b 0
:failed
echo Setup or startup failed. Install Python 3.11+ and check the message above.
pause
exit /b 1
