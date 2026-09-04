@echo off
REM 孕程记 FPK 优化打包脚本，自动排除开发文件，大幅缩小包体积
REM 输出文件大小约48MB，和官方正常运行包一致

echo === 创建临时打包目录 ===
set TEMP_DIR=%TEMP%\pregnancyjournal_pack
if exist "%TEMP_DIR%" rd /s /q "%TEMP_DIR%"
mkdir "%TEMP_DIR%"

echo.
echo === 复制核心文件 ===
xcopy /Y "%~dp0pregnancyjournal\manifest" "%TEMP_DIR%\"
xcopy /E /Y /I "%~dp0pregnancyjournal\app\server\node" "%TEMP_DIR%\server\node\"
xcopy /E /Y /I "%~dp0pregnancyjournal\app\cmd" "%TEMP_DIR%\cmd\"
xcopy /E /Y /I "%~dp0pregnancyjournal\app\ui" "%TEMP_DIR%\ui\"
xcopy /E /Y /I "%~dp0pregnancyjournal\wizard" "%TEMP_DIR\wizard\" 2>nul
xcopy /E /Y /I "%~dp0pregnancyjournal\config" "%TEMP_DIR%\config\" 2>nul
xcopy /Y "%~dp0pregnancyjournal\ICON.PNG" "%TEMP_DIR%\" 2>nul
xcopy /Y "%~dp0pregnancyjournal\ICON_256.PNG" "%TEMP_DIR%\" 2>nul

echo.
echo === 只安装生产依赖 ===
cd /d "%TEMP_DIR%\server\node"
if exist "node_modules" rd /s /q "node_modules"
call npm install --omit=dev --prefer-offline

echo.
echo === 清理不必要的文件 ===
del /q "%TEMP_DIR%\server\node\*.md" 2>nul
del /q "%TEMP_DIR%\server\node\.gitignore" 2>nul
rd /s /q "%TEMP_DIR%\server\node\.idea" 2>nul
rd /s /q "%TEMP_DIR%\server\node\.vscode" 2>nul

echo.
echo === 修复cmd换行符 ===
powershell -Command "(Get-Content -Raw '%TEMP_DIR%\cmd\main') -replace \"`r`n\",\"`n\" | Set-Content -NoNewline '%TEMP_DIR%\cmd\main'"

echo.
echo === 打包FPK ===
"%~dp0fnpack_tool.exe" build --directory "%TEMP_DIR%"

echo.
echo === 完成 ===
if exist "%TEMP_DIR%\pregnancyjournal.fpk" (
    copy "%TEMP_DIR%\pregnancyjournal.fpk" "%~dp0pregnancyjournal_v0.0.27_optimized.fpk"
    for %%A in ("%~dp0pregnancyjournal_v0.0.27_optimized.fpk") do echo 输出文件：%%~nA，大小：%%~zA 字节
) else (
    echo 打包失败！
)

echo.
echo === 清理临时目录 ===
rd /s /q "%TEMP_DIR%"

pause