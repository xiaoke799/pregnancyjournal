# ============================================================
# 孕程记 v0.0.27 一键打包脚本（唯一打包入口，禁止手动操作打包目录）
# 流程：清理前端冗余 -> 同步ui -> 安装生产依赖 -> 校验 -> fnpack打包 -> 验证
# 用法：powershell -File D:\pregnancy-journal\build.ps1
# ============================================================
$ErrorActionPreference = "Stop"
# 打包根目录 = 本脚本所在目录（即仓库根目录）
$PkgDir      = $PSScriptRoot
$ServerDir   = Join-Path $PkgDir "app\server\node"
$AppUi       = Join-Path $PkgDir "app\ui"
$RootUi      = Join-Path $PkgDir "ui"
$Workspace   = $PkgDir
$Version     = "0.0.27"   # 版本号锁定，禁止改动

function Step($msg) { Write-Host "`n========== $msg ==========" -ForegroundColor Cyan }

# ---------- Step 1: 清理前端 assets 冗余 ----------
Step "1/7 清理前端 assets 冗余文件"
$indexHtml = Join-Path $AppUi "index.html"
if (-not (Test-Path $indexHtml)) { throw "缺少 $indexHtml" }
$html = [System.IO.File]::ReadAllText($indexHtml)

# 从 index.html 提取入口 js/css
$entries = [regex]::Matches($html, '/assets/([A-Za-z0-9._-]+\.(?:js|css))') |
           ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
if (-not $entries) { throw "index.html 中未找到任何入口资源" }

# 遍历依赖图，计算真正被引用的文件
$assetsDir = Join-Path $AppUi "assets"
$keep = New-Object System.Collections.Generic.HashSet[string]
$queue = [System.Collections.Queue]::new()
foreach ($e in $entries) { $queue.Enqueue($e) }
while ($queue.Count -gt 0) {
    $f = $queue.Dequeue()
    if (-not $keep.Add($f)) { continue }
    $p = Join-Path $assetsDir $f
    if (-not (Test-Path $p)) { continue }
    $c = [System.IO.File]::ReadAllText($p)
    $refs = [regex]::Matches($c, '[\./"]([A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,12}\.(?:js|css))["'']')
    foreach ($r in $refs) {
        $n = $r.Groups[1].Value
        if (Test-Path (Join-Path $assetsDir $n)) { $queue.Enqueue($n) }
    }
}

# 删除 assets 中不在依赖集合内的文件
$removed = 0
Get-ChildItem $assetsDir -File | ForEach-Object {
    if (-not $keep.Contains($_.Name)) { Remove-Item $_.FullName -Force; $removed++ }
}
Write-Host "保留 $($keep.Count) 个依赖文件，清理 $removed 个冗余文件"

# ---------- Step 2: 同步 app/ui -> 根 ui ----------
Step "2/7 同步 app/ui 到根 ui（desktop_uidir）"
if (Test-Path $RootUi) { Remove-Item $RootUi -Recurse -Force }
Copy-Item $AppUi $RootUi -Recurse
Write-Host "根 ui 已重建（含 images、config、index.html）"

# ---------- Step 3: 安装后端生产依赖 ----------
Step "3/7 安装后端生产依赖（node_modules 保留进包）"
Push-Location $ServerDir
if (-not (Test-Path (Join-Path $ServerDir "node_modules\express"))) {
    npm install --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm install 失败" }
} else {
    Write-Host "node_modules 已存在且完整，跳过安装"
}
Pop-Location

# ---------- Step 4: 规范 cmd 脚本编码（无BOM + LF） ----------
Step "4/7 规范 cmd 脚本编码（无BOM、LF换行）"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
Get-ChildItem (Join-Path $PkgDir "cmd") -File | ForEach-Object {
    $text = [System.IO.File]::ReadAllText($_.FullName).Replace("`r`n", "`n")
    [System.IO.File]::WriteAllText($_.FullName, $text, $utf8NoBom)
}
# 同步到 app/cmd
Copy-Item (Join-Path $PkgDir "cmd\*") (Join-Path $PkgDir "app\cmd\") -Recurse -Force
Write-Host "cmd 脚本编码已规范并同步到 app/cmd"

# ---------- Step 5: 打包前校验 ----------
Step "5/7 打包前校验"
$errors = @()

# 5.1 manifest 版本必须是 0.0.27
$manifest = Get-Content (Join-Path $PkgDir "manifest") -Raw
if ($manifest -notmatch "version\s*=\s*0\.0\.27") { $errors += "manifest 版本不是 0.0.27" }

# 5.2 ui/config 必须是统一网关配置
foreach ($cfg in @((Join-Path $RootUi "config"), (Join-Path $AppUi "config"))) {
    $c = Get-Content $cfg -Raw
    if ($c -notmatch 'gatewaySocket.*app\.sock') { $errors += "$cfg 缺少 gatewaySocket" }
    if ($c -notmatch 'gatewayPrefix.*/app/pregnancyjournal') { $errors += "$cfg 缺少 gatewayPrefix" }
    if ($c -match '"port"') { $errors += "$cfg 仍残留 port 配置" }
}

# 5.3 server.js 关键修复必须在位
$serverJs = Get-Content (Join-Path $ServerDir "server.js") -Raw
if ($serverJs -notmatch "app\.get\('\*'") { $errors += "server.js 缺少 catch-all 路由" }

# 5.4 cmd/main 必须无BOM
$mainBytes = [System.IO.File]::ReadAllBytes((Join-Path $PkgDir "cmd\main"))
if ($mainBytes[0] -eq 0xEF -and $mainBytes[1] -eq 0xBB) { $errors += "cmd/main 含 BOM" }

# 5.5 必要文件齐全
foreach ($f in @("manifest","ICON.PNG","ICON_256.PNG","LICENSE","config\privilege","config\resource","cmd\main","app\cmd\main")) {
    if (-not (Test-Path (Join-Path $PkgDir $f))) { $errors += "缺少必要文件: $f" }
}

# 5.6 不允许存在的垃圾目录
foreach ($d in @("data","www","app\www","app\data")) {
    if (Test-Path (Join-Path $PkgDir $d)) { $errors += "存在不应打包的目录: $d（请手动确认后删除）" }
}

if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Host "  [X] $_" -ForegroundColor Red }
    throw "校验未通过，终止打包"
}
Write-Host "  全部校验通过" -ForegroundColor Green

# ---------- Step 6: fnpack 打包 ----------
Step "6/7 fnpack 打包"
$fnpack = Join-Path (Split-Path $PkgDir -Parent) "fnpack_tool.exe"
if (-not (Test-Path $fnpack)) { $fnpack = "fnpack_tool.exe" }  # 回退到PATH查找
Get-ChildItem (Split-Path $PkgDir -Parent) -Filter "*.fpk" -File | Remove-Item -Force
Push-Location (Split-Path $PkgDir -Parent)
& $fnpack build --directory $PkgDir
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "fnpack 打包失败" }
Pop-Location

$fpk = Get-Item (Join-Path (Split-Path $PkgDir -Parent) "pregnancyjournal.fpk") -ErrorAction SilentlyContinue
if (-not $fpk) { throw "未找到输出 fpk" }
$finalPath = Join-Path $Workspace "pregnancyjournal_v$Version.fpk"
Move-Item $fpk.FullName $finalPath -Force

# ---------- Step 7: 打包后验证 ----------
Step "7/7 打包后验证"
$sizeMB = [math]::Round((Get-Item $finalPath).Length / 1MB, 2)
Write-Host "输出: $finalPath"
Write-Host "体积: $sizeMB MB"
if ($sizeMB -gt 60) { Write-Host "警告：体积超过60MB，请检查是否混入冗余文件" -ForegroundColor Yellow }

Write-Host "`n✅ 打包完成：pregnancyjournal_v$Version.fpk ($sizeMB MB)" -ForegroundColor Green
