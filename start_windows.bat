@echo off
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js/npm is required. Install Node.js 18 or newer, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules call npm install
call npm run dev
pause

