@echo off
setlocal
cd /d "%~dp0"
title LAN Office - 局域网多人协同办公

rem ---- 若项目自带绿色版 Node.js，优先使用（setup.bat 下载的） ----
if exist "runtime\node\node.exe" set "PATH=%~dp0runtime\node;%PATH%"

rem ---- 检查 Node.js ----
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [错误] 未检测到 Node.js。
  echo  请先运行 setup.bat 自动安装（推荐），
  echo  或手动安装 Node.js 18 或更高版本: https://nodejs.org/zh-cn
  echo.
  pause
  exit /b 1
)

node -e "if(parseInt(process.versions.node.split('.')[0])<18)process.exit(1)"
if errorlevel 1 (
  echo.
  echo  [错误] Node.js 版本过低，需要 18 或更高版本。当前版本：
  node -v
  echo.
  pause
  exit /b 1
)

rem ---- 首次运行安装依赖 ----
if not exist node_modules (
  echo.
  echo  首次运行，正在安装依赖，请稍候（约 1-2 分钟）...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  [错误] 依赖安装失败，请先运行 setup.bat 或检查网络后重试。
    echo.
    pause
    exit /b 1
  )
)

echo.
echo  正在启动 LAN Office ...
chcp 65001 >nul
node server\index.js
chcp 936 >nul

echo.
echo  服务已退出。
pause
