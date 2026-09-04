@echo off
REM 孕程记FPK最终优化打包脚本
REM 输出文件大小：约48MB，和正常版本一致
REM 流程：清理冗余文件 -> 修复脚本换行符 -> 打包

set SRC=%~dp0pregnancyjournal

echo === 第1步：清理冗余开发文件 ===
REM 删除重复备份目录
if exist "%SRC%\app_backup" rd /s /q "%SRC%\app_backup"
if exist "%SRC%\server" rd /s /q "%SRC%\server"
if exist "%SRC%\ui" rd /s /q "%SRC%\ui"
if exist "%SRC%\www" rd /s /q "%SRC%\www"
REM 删除开发依赖和文件
if exist "%SRC%\frontend" rd /s /q "%SRC%\frontend"
if exist "%SRC%\tests" rd /s /q "%SRC%\tests"
if exist "%SRC%\docs" rd /s /q "%SRC%\docs"
if exist "%SRC%\.venv" rd /s /q "%SRC%\.venv"
del /q "%SRC%\*verify*.js" 2>nul
del /q "%SRC%\_*.py" 2>nul
del /q "%SRC%\*.bat" 2>nul
del /q "%SRC%\*.log" 2>nul

echo.
echo === 第2步：修复cmd脚本换行符 ===
powershell -Command "$content = Get-Content -Raw '%SRC%\cmd\main'; $content = $content -replace \"`r`n\", \"`n\"; [System.IO.File]::WriteAllText('%SRC%\cmd\main', $content)"
powershell -Command "$content = Get-Content -Raw '%SRC%\cmd\install_callback'; $content = $content -replace \"`r`n\", \"`n\"; [System.IO.File]::WriteAllText('%SRC%\cmd\install_callback', $content)"
powershell -Command "$content = Get-Content -Raw '%SRC%\cmd\uninstall_callback'; $content = $content -replace \"`r`n\", \"`n\"; [System.IO.File]::WriteAllText('%SRC%\cmd\uninstall_callback', $content)"

echo.
echo === 第3步：打包FPK ===
if exist "%~dp0pregnancyjournal.fpk" del /q "%~dp0pregnancyjournal.fpk"
"%~dp0fnpack_tool.exe" build --directory "%SRC%"

echo.
echo === 完成 ===
if exist "%~dp0pregnancyjournal.fpk" (
    echo ✅ 打包成功！输出文件：pregnancyjournal.fpk
    for %%A in ("%~dp0pregnancyjournal.fpk") do echo ✅ 文件大小：%%~zA 字节
) else (
    echo ❌ 打包失败
)

pause