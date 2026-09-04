# ============================================================
# 孕程记 v0.0.27 一键打包脚本（唯一打包入口）
# 流程：校验源码完整性 -> 安装生产依赖 -> 组装干净stage目录 -> fnpack打包 -> 解包验证
# 用法：在项目根目录（含本脚本的目录）执行：pwsh -File build.ps1
# ============================================================
$ErrorActionPreference = "Stop"
# 打包根目录：本地布局为脚本目录下的 pregnancyjournal/ 子目录
$PkgDir    = Join-Path $PSScriptRoot "pregnancyjournal"
if (-not (Test-Path (Join-Path $PkgDir "manifest"))) { $PkgDir = $PSScriptRoot }
$ServerDir = Join-Path $PkgDir "app\server\node"
$AppUi     = Join-Path $PkgDir "app\ui"
$RootUi    = Join-Path $PkgDir "ui"
$Version   = "0.0.27"   # 版本号锁定，禁止改动
$Parent    = Split-Path $PkgDir -Parent
$Stage     = Join-Path $env:TEMP "pregnancyjournal_stage_$Version"

function Step($msg) { Write-Host "`n========== $msg ==========" -ForegroundColor Cyan }

# ---------- Step 1: 源码完整性校验 ----------
Step "1/6 源码完整性校验"
$errors = @()
# 后端静态数据（食谱/食品安全/产检表/待产清单）
foreach ($f in @("recipes.json","food_safety_v3.json","checkup_schedule.json",
                 "default_checklist_hospital.json","default_checklist_confinement.json",
                 "default_checklist_delivery_room.json")) {
    if (-not (Test-Path (Join-Path $ServerDir "data\$f"))) { $errors += "缺少后端静态数据: data/$f" }
}
# server.js 声明的全部路由文件
$serverJs = Get-Content (Join-Path $ServerDir "server.js") -Raw
$routeFiles = [regex]::Matches($serverJs, "'\./routes/([a-z_-]+)'") | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
foreach ($r in $routeFiles) {
    if (-not (Test-Path (Join-Path $ServerDir "routes\$r.js"))) { $errors += "缺少路由文件: routes/$r.js" }
}
if (-not (Test-Path (Join-Path $ServerDir "websocket.js"))) { $errors += "缺少 websocket.js" }
if (-not (Test-Path (Join-Path $ServerDir "middleware\auth.js"))) { $errors += "缺少 middleware/auth.js" }
# 前端：index.html 入口与其引用的资产必须存在
$indexHtml = Join-Path $AppUi "index.html"
if (-not (Test-Path $indexHtml)) { $errors += "缺少前端 index.html" } else {
    $html = [System.IO.File]::ReadAllText($indexHtml)
    [regex]::Matches($html, '/assets/([A-Za-z0-9._-]+)') | ForEach-Object {
        if (-not (Test-Path (Join-Path $AppUi "assets\$($_.Groups[1].Value)"))) {
            $errors += "前端入口资源缺失: $($_.Groups[1].Value)"
        }
    }
}
# 关键修复在位
if ($serverJs -notmatch "app\.get\('\*'") { $errors += "server.js 缺少 catch-all 路由" }
foreach ($cfg in @((Join-Path $RootUi "config"), (Join-Path $AppUi "config"))) {
    $c = Get-Content $cfg -Raw
    if ($c -notmatch 'gatewaySocket.*app\.sock') { $errors += "$cfg 缺少统一网关配置" }
}
if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Host "  [X] $_" -ForegroundColor Red }; throw "源码完整性校验失败" }
Write-Host "  路由文件 $($routeFiles.Count) 个、静态数据、前端入口、网关配置 全部在位" -ForegroundColor Green

# ---------- Step 1.5: 清理前端 assets 冗余 ----------
Step "1.5/6 清理前端 assets 冗余文件"
$assetsDir = Join-Path $AppUi "assets"
$entries = [regex]::Matches((Get-Content $indexHtml -Raw), '/assets/([A-Za-z0-9._-]+\.(?:js|css))') |
           ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
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
$removed = 0
Get-ChildItem $assetsDir -File | ForEach-Object {
    if (-not $keep.Contains($_.Name)) { Remove-Item $_.FullName -Force; $removed++ }
}
# 同步到根 ui（desktop_uidir）
Remove-Item $RootUi -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item $AppUi $RootUi -Recurse -Force
Write-Host "保留 $($keep.Count) 个依赖文件，清理 $removed 个冗余；根 ui 已同步"

# ---------- Step 2: 安装生产依赖 ----------
Step "2/6 安装后端生产依赖"
Push-Location $ServerDir
if (-not (Test-Path (Join-Path $ServerDir "node_modules\express"))) {
    npm install --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm install 失败" }
} else { Write-Host "node_modules 已完整，跳过" }
Pop-Location

# ---------- Step 3: 规范 cmd 脚本编码 ----------
Step "3/6 规范 cmd 脚本编码（无BOM、LF）"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
Get-ChildItem (Join-Path $PkgDir "cmd") -File | ForEach-Object {
    $text = [System.IO.File]::ReadAllText($_.FullName).Replace("`r`n", "`n")
    [System.IO.File]::WriteAllText($_.FullName, $text, $utf8NoBom)
}
Write-Host "cmd 脚本已规范"

# ---------- Step 4: 组装干净 stage 目录 ----------
Step "4/6 组装干净 stage 目录"
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory $Stage | Out-Null
# 只拷贝打包必需项：manifest/图标/LICENSE/cmd/config/wizard/app/ui
foreach ($f in @("manifest","ICON.png","ICON_256.png","LICENSE")) {
    if (Test-Path (Join-Path $PkgDir $f)) { Copy-Item (Join-Path $PkgDir $f) $Stage -Force }
}
foreach ($d in @("cmd","config","wizard","app","ui")) {
    Copy-Item (Join-Path $PkgDir $d) (Join-Path $Stage $d) -Recurse -Force
}
# 排除 app 内的重复/垃圾目录（www是历史重复产物）
Remove-Item (Join-Path $Stage "app\www") -Recurse -Force -ErrorAction SilentlyContinue
# 排除后端运行时垃圾（数据库/日志绝不能进包）
Remove-Item (Join-Path $Stage "app\server\node\data\*.db") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $Stage "app\server\node\data\logs") -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "stage 目录已组装（仅含打包必需项）"

# ---------- Step 5: fnpack 打包 ----------
Step "5/6 fnpack 打包"
$fnpack = Join-Path $Parent "fnpack_tool.exe"
if (-not (Test-Path $fnpack)) { $fnpack = "fnpack_tool.exe" }
Get-ChildItem $Parent -Filter "*.fpk" -File | Remove-Item -Force
Push-Location $Parent
& $fnpack build --directory $Stage
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "fnpack 打包失败" }
Pop-Location
$fpk = Get-Item (Join-Path $Parent "pregnancyjournal.fpk") -ErrorAction SilentlyContinue
if (-not $fpk) { throw "未找到输出 fpk" }
$finalPath = Join-Path $Parent "pregnancyjournal_v$Version.fpk"
Move-Item $fpk.FullName $finalPath -Force

# ---------- Step 6: 打包后解包验证 ----------
Step "6/6 打包后解包验证"
$verify = Join-Path $env:TEMP "pregnancyjournal_verify"
if (Test-Path $verify) { Remove-Item $verify -Recurse -Force }
New-Item -ItemType Directory $verify | Out-Null
Copy-Item $finalPath "$verify\pkg.tar.gz"
tar -xzf "$verify\pkg.tar.gz" -C $verify
tar -xzf "$verify\app.tgz" -C $verify
$vErrors = @()
# 外层必须项
foreach ($f in @("manifest","cmd\main","LICENSE","config\privilege")) {
    if (-not (Test-Path (Join-Path $verify $f))) { $vErrors += "包外层缺少: $f" }
}
# app.tgz 内必须项（静态数据 + 路由 + 前端 + node_modules）
foreach ($f in @("server\node\server.js","server\node\websocket.js","server\node\data\recipes.json",
                 "server\node\data\food_safety_v3.json","server\node\node_modules\express\package.json",
                 "server\node\node_modules\sql.js\package.json")) {
    if (-not (Test-Path (Join-Path $verify $f))) { $vErrors += "包内缺少: $f" }
}
foreach ($r in $routeFiles) {
    if (-not (Test-Path (Join-Path $verify "server\node\routes\$r.js"))) { $vErrors += "包内缺少路由: $r.js" }
}
$assetCount = (Get-ChildItem (Join-Path $verify "ui\assets") -File -ErrorAction SilentlyContinue).Count
if ($assetCount -lt 30) { $vErrors += "前端 assets 仅 $assetCount 个文件，异常" }
# cmd/main 无BOM
$mb = [System.IO.File]::ReadAllBytes((Join-Path $verify "cmd\main"))[0]
if ($mb -ne 0x23) { $vErrors += "cmd/main 含 BOM" }
Remove-Item $verify -Recurse -Force
if ($vErrors.Count -gt 0) { $vErrors | ForEach-Object { Write-Host "  [X] $_" -ForegroundColor Red }; throw "包内容验证失败" }

$sizeMB = [math]::Round((Get-Item $finalPath).Length / 1MB, 2)
Write-Host "`n✅ 打包并验证完成：pregnancyjournal_v$Version.fpk ($sizeMB MB)" -ForegroundColor Green
Write-Host "   路由 $($routeFiles.Count) 个 / 静态数据完整 / 前端 assets $assetCount 个 / node_modules 完整"
