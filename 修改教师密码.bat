@echo off
setlocal
cd /d "%~dp0"
title 修改教师管理密码

rem ---- 若项目自带绿色版 Node.js，优先使用 ----
if exist "runtime\node\node.exe" set "PATH=%~dp0runtime\node;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo  [错误] 未检测到 Node.js，请先双击 setup.bat 安装环境。
  pause
  exit /b 1
)

echo  ==============================
echo    修改教师管理密码
echo  ==============================
echo.
chcp 65001 >nul
node scripts\change-teacher-password.js
chcp 936 >nul
echo.
pause
