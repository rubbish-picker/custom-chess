# 一键启动国际象棋游戏服务器和两个客户端

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Starting Custom Chess Game..." -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan

# 启动服务器
Write-Host "`n[1/3] Starting Server..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\server'; Write-Host 'Server Terminal' -ForegroundColor Green; node index.js"
Start-Sleep -Seconds 2

$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
