@echo off
chcp 65001 >nul
echo ==================================
echo Starting Custom Chess Game...
echo ==================================
echo.

echo [1/3] Starting Server...
start "Chess Server" cmd /k "cd /d %~dp0server && echo Server Terminal && node index.js"
timeout /t 2 /nobreak >nul

echo [2/3] Starting Client 1...
start "Chess Client 1" cmd /k "cd /d %~dp0client && echo Client 1 Terminal && npm run dev -- --port 5173 --strictPort"
timeout /t 3 /nobreak >nul

echo [3/3] Starting Client 2...
start "Chess Client 2" cmd /k "cd /d %~dp0client && echo Client 2 Terminal && npm run dev -- --port 5174 --strictPort"
timeout /t 3 /nobreak >nul

echo.
echo ==================================
echo All services started!
echo ==================================
echo.
echo Server: http://localhost:3001
echo Client 1: http://localhost:5173
echo Client 2: http://localhost:5174
echo.
echo If a port is in use, close old dev terminals (npm run dev) first.
echo.
echo Tip: Use the same Room ID in both clients to play together!
echo.
pause
