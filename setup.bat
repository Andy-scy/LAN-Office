@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title LAN Office 环境安装向导

echo.
echo  ============================================================
echo    LAN Office 环境安装向导（第一次使用前运行一次即可）
echo    本向导负责: Node.js 运行时 + ONLYOFFICE 编辑引擎
echo  ============================================================
echo.

rem ---------- 0. 系统要求 ----------
echo %PROCESSOR_ARCHITECTURE% | findstr /i "64" >nul
if errorlevel 1 (
  echo  [错误] 仅支持 64 位 Windows。
  pause
  exit /b 1
)

set "NODE_VER=22.14.0"
set "NODE_EXE="
set "NPM_CMD=npm"

rem ---------- 1. Node.js ----------
if exist "runtime\node\node.exe" (
  echo  [1/3] 已找到项目内置的 Node.js（绿色版） √
  goto node_ready
)

where node >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%p in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%p"
  echo  [1/3] 已检测到系统安装的 Node.js √
  goto node_ready
)

echo  [1/3] 未检测到 Node.js，开始自动下载官方绿色版（约 35MB，无需管理员权限）...
if not exist downloads mkdir downloads
set "ZIP=downloads\node-v%NODE_VER%-win-x64.zip"
set "URL=https://nodejs.org/dist/v%NODE_VER%/node-v%NODE_VER%-win-x64.zip"

curl -L -C - --ssl-no-revoke --retry 3 -o "%ZIP%" "%URL%"
if errorlevel 1 goto node_dl_fail
if not exist "%ZIP%" goto node_dl_fail

echo        正在校验文件完整性（SHA256）...
set "WANTHASH="
set "GOTHASH="
curl -L -C - --ssl-no-revoke --retry 3 -s -o downloads\SHASUMS256.txt "https://nodejs.org/dist/v%NODE_VER%/SHASUMS256.txt"
for /f "tokens=1" %%a in ('findstr /i /c:"node-v%NODE_VER%-win-x64.zip" downloads\SHASUMS256.txt 2^>nul') do if not defined WANTHASH set "WANTHASH=%%a"
if not defined WANTHASH echo        (无法获取校验清单，跳过校验)
if defined WANTHASH (
  for /f "skip=1 delims=" %%h in ('certutil -hashfile "%ZIP%" SHA256 2^>nul') do if not defined GOTHASH set "GOTHASH=%%h"
)
if defined WANTHASH if defined GOTHASH (
  if /i not "%GOTHASH%"=="%WANTHASH%" (
    echo  [错误] 下载文件校验失败（可能下载损坏），已删除。请重新运行 setup.bat。
    del /q "%ZIP%"
    pause
    exit /b 1
  )
  echo        校验通过 √
)

if not exist runtime mkdir runtime
echo        正在解压...
tar -xf "%ZIP%" -C runtime
if not exist "runtime\node-v%NODE_VER%-win-x64\node.exe" (
  powershell -NoProfile -Command "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath 'runtime' -Force"
)
if not exist "runtime\node-v%NODE_VER%-win-x64\node.exe" (
  echo  [错误] 解压失败，请确认系统为 Windows 10 1803 以上版本后重试。
  pause
  exit /b 1
)
if exist "runtime\node" rmdir /s /q "runtime\node"
ren "runtime\node-v%NODE_VER%-win-x64" node
if not exist "runtime\node\node.exe" (
  echo  [错误] 解压结果异常，请重新运行 setup.bat。
  pause
  exit /b 1
)
del /q "%ZIP%" 2>nul
echo        Node.js 绿色版已就绪（runtime\node）√
goto node_ready

:node_dl_fail
echo  [错误] Node.js 下载失败，请检查网络后重新运行 setup.bat。
echo         也可手动安装 Node.js 18 以上版本: https://nodejs.org/zh-cn
pause
exit /b 1

:node_ready
if exist "runtime\node\node.exe" set "PATH=%~dp0runtime\node;%PATH%"
if exist "runtime\node\npm.cmd" set "NPM_CMD=%~dp0runtime\node\npm.cmd"

rem ---------- 2. 项目依赖 ----------
if exist node_modules (
  echo  [2/3] 项目依赖已就绪 √
) else (
  echo  [2/3] 正在安装项目依赖（约 1-2 分钟）...
  call "%NPM_CMD%" install --no-audit --no-fund
  if errorlevel 1 (
    echo  [错误] 依赖安装失败，请检查网络后重新运行 setup.bat。
    pause
    exit /b 1
  )
  echo        依赖安装完成 √
)

rem ---------- 3. ONLYOFFICE 编辑引擎 ----------
call :check_ds
if defined DS_PORT (
  echo  [3/3] 编辑引擎 ONLYOFFICE Document Server 已检测到 √（端口 %DS_PORT%）
  goto env_done
)

echo  [3/3] 未检测到编辑引擎 ONLYOFFICE Docs（在线编辑 Office 必需）。
echo        说明：安装器约 1GB，安装后约占 2-3GB 磁盘、建议 4GB 内存；
echo        安装过程需要你在安装界面点几下"下一步"并允许管理员权限。
echo.
choice /c YN /m "        现在自动下载并启动官方安装器吗？ [Y=好 / N=稍后自己装]"
if errorlevel 2 goto ds_skip

echo        正在获取最新官方安装器地址...
set "OO_URL="
for /f "tokens=1" %%u in ('"%NODE_EXE%" "%~dp0scripts\ds-installer-url.js" 2^>nul') do set "OO_URL=%%u"
if not defined OO_URL set "OO_URL=https://github.com/ONLYOFFICE/DocumentServer/releases/download/v9.4.0/onlyoffice-documentserver.exe"

if not exist downloads mkdir downloads
rem 查找本机已有的安装器：优先 BAT 所在根目录，其次 downloads 目录
set "OO_EXE="
if exist "%~dp0onlyoffice-documentserver.exe" set "OO_EXE=%~dp0onlyoffice-documentserver.exe"
if not defined OO_EXE if exist "%~dp0downloads\onlyoffice-documentserver.exe" set "OO_EXE=%~dp0downloads\onlyoffice-documentserver.exe"
set "OOSIZE="
if defined OO_EXE for %%s in ("%OO_EXE%") do set "OOSIZE=%%~zs"
if defined OOSIZE goto ds_check_size
echo        本地没有安装器，开始联网下载 ONLYOFFICE 官方安装器（约 1GB，视网速需几分钟到几十分钟）...
goto ds_do_dl
:ds_check_size
if %OOSIZE% GTR 900000000 (
  echo        检测到本机已有完整安装器，跳过下载。
  goto ds_launch
)
echo        检测到未下载完的安装器，继续断点续传...
:ds_do_dl
if not defined OO_EXE set "OO_EXE=downloads\onlyoffice-documentserver.exe"
curl -L -C - --ssl-no-revoke --retry 5 --retry-delay 5 -o "%OO_EXE%" "%OO_URL%"
if errorlevel 1 goto ds_dl_fail
if not exist "%OO_EXE%" goto ds_dl_fail

:ds_launch
echo        正在启动安装器...
start "" "%OO_EXE%"
echo.
echo        ----------------------------------------------
echo        安装器已弹出，请在安装窗口里：
echo          1. 勾选同意协议，点 Install（安装）
echo          2. Windows 弹出蓝色提示问"是否允许"，点"是"
echo          3. 装完点 Finish（完成）即可
echo        ----------------------------------------------
echo        本向导每 15 秒自动检测一次安装进度，最长等待 40 分钟。
echo        （不想等了可直接关掉本窗口，装完后双击 start.bat 一样能用）
set /a TRIES=0
:waitloop
ping -n 16 127.0.0.1 >nul
call :check_ds
if defined DS_PORT goto ds_done
set /a TRIES+=1
if %TRIES% geq 160 goto ds_timeout
echo        ...等待安装完成（第 %TRIES% 次检测）
goto waitloop

:ds_done
echo        检测到编辑引擎已就绪（端口 %DS_PORT%）√
goto env_done

:ds_timeout
echo        等待超时。没关系：装好后直接双击 start.bat 即可正常使用。
goto env_done

:ds_dl_fail
echo  [错误] 安装器下载失败。可以手动下载安装：
echo         https://www.onlyoffice.com/download-docs.aspx
echo         （选 Community Edition 的 Windows 版；装完双击 start.bat 即可）
goto env_done

:ds_skip
echo        已跳过。想装的时候再运行一次 setup.bat，或按 README 手动安装。

:env_done
echo.
echo  ============================================================
echo    环境检查完成！以后每天使用只需双击 start.bat。
echo  ============================================================
echo.
choice /c YN /m "  是否现在启动 LAN Office？ [Y=启动 / N=退出]"
if errorlevel 2 goto end_ok
echo.
echo  正在启动，按 Ctrl+C 可停止...
chcp 65001 >nul
"%NODE_EXE%" server\index.js
chcp 936 >nul
goto end_ok

rem ---------- 子过程：探测本机编辑引擎 ----------
:check_ds
set "DS_PORT="
for /f "tokens=1" %%p in ('"%NODE_EXE%" "%~dp0scripts\probe-ds.js" 2^>nul') do set "DS_PORT=%%p"
exit /b

:end_ok
echo.
pause
