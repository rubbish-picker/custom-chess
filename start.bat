@echo off
chcp 65001 >nul
echo ==================================
echo Starting Custom Chess Client...
echo ==================================
echo.

echo [1/1] Starting Client...
start "Chess Client" cmd /k "cd /d %~dp0client && echo Client Terminal && npm run dev -- --port 5173 --strictPort"
timeout /t 2 /nobreak >nul

echo.
echo ==================================
echo Client started!
echo ==================================
echo Client: http://localhost:5173
echo.
pause
