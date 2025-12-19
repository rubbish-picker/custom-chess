# 一键启动国际象棋游戏服务器和两个客户端

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Starting Custom Chess Game..." -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan

# 启动服务器
Write-Host "`n[1/3] Starting Server..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\server'; Write-Host 'Server Terminal' -ForegroundColor Green; node index.js"
Start-Sleep -Seconds 2

# 启动第一个客户端
Write-Host "[2/3] Starting Client 1..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\client'; Write-Host 'Client 1 Terminal' -ForegroundColor Green; npm run dev -- --port 5173 --strictPort"
Start-Sleep -Seconds 3

# 启动第二个客户端（会自动使用下一个可用端口）
Write-Host "[3/3] Starting Client 2..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\client'; Write-Host 'Client 2 Terminal' -ForegroundColor Green; npm run dev -- --port 5174 --strictPort"
Start-Sleep -Seconds 3

Write-Host "`n==================================" -ForegroundColor Cyan
Write-Host "All services started!" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "`nServer: http://localhost:3001" -ForegroundColor White
Write-Host "Client 1: http://localhost:5173" -ForegroundColor White
Write-Host "Client 2: http://localhost:5174" -ForegroundColor White
Write-Host "`nIf a port is in use, close old dev terminals (npm run dev) first." -ForegroundColor Yellow
Write-Host "`nTip: Use the same Room ID in both clients to play together!" -ForegroundColor Yellow
Write-Host "`nPress any key to exit this window..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
