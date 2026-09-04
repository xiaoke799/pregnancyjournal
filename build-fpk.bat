@echo off
REM 孕程记 FPK 打包脚本
REM 重要：必须用 fnpack_tool.exe 打包，不能用 tar 手动打包！
REM 手动打的 tar 包格式不符合 fnOS 系统要求 (code 10111)

echo === 修复 cmd/ 换行符（Windows CRLF → Linux LF） ===
powershell -Command "(Get-Content -Raw '%~dp0pregnancyjournal\cmd\main') -replace \"`r`n\",\"`n\" | Set-Content -NoNewline '%~dp0pregnancyjournal\cmd\main'"

echo === 构建前端 ===
cd /d "%~dp0pregnancyjournal\frontend"
call npm run build
if errorlevel 1 (
    echo 前端构建失败！
    pause
    exit /b 1
)

echo.
echo === 同步 www 目录 ===
xcopy /E /Y /I "%~dp0pregnancyjournal\app\ui\*" "%~dp0pregnancyjournal\app\www\"

echo.
echo === 同步 ui 目录（fnpack 打包入口） ===
xcopy /E /Y /I "%~dp0pregnancyjournal\app\ui\*" "%~dp0pregnancyjournal\ui\"

echo.
echo === 用 fnpack 打包 FPK ===
"%~dp0fnpack_tool.exe" build --directory "%~dp0pregnancyjournal"

echo.
echo === 完成 ===
if exist "%~dp0pregnancyjournal.fpk" (
    echo 输出文件: %~dp0pregnancyjournal.fpk
    for %%A in ("%~dp0pregnancyjournal.fpk") do echo 文件大小: %%~zA bytes
) else (
    echo 打包失败！未找到输出文件
)

pause
