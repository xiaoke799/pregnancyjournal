# ============================================================
# 孕程记 v0.0.28 一键打包脚本（唯一打包入口）
# 流程：校验源码完整性 -> 安装生产依赖 -> 组装干净stage目录 -> fnpack打包 -> 解包验证
# 用法：在项目根目录（含本脚本的目录）执行：pwsh -File build.ps1
# ============================================================
$ErrorActionPreference = "Stop"
# 打包根目录：应用位于脚本目录（仓库根）；仍兼容旧的 pregnancyjournal/ 子目录布局
$PkgDir    = Join-Path $PSScriptRoot "pregnancyjournal"
if (-not (Test-Path (Join-Path $PkgDir "manifest"))) { $PkgDir = $PSScriptRoot }
$ServerDir = Join-Path $PkgDir "app\server\node"
$AppUi     = Join-Path $PkgDir "app\ui"
# 注：不再有 $RootUi（根 ui/ 是历史死重，既不进包也不是运行时目录；
# 运行时 STATIC_DIR = ${TRIM_APPDEST}/ui，来自 app.tgz:ui，即 app/ui）。
$Version   = "0.0.28"   # 版本号锁定，禁止改动
if ($PkgDir -eq $PSScriptRoot) { $Parent = $PSScriptRoot } else { $Parent = Split-Path $PkgDir -Parent }
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
foreach ($cfg in @((Join-Path $AppUi "config"))) {
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
# 说明：根 ui/ 并未被 fnpack 打进包（包外层仅 manifest/cmd/config/wizard/ICON/LICENSE/app.tgz），
# 故不再"删空根 ui 再整拷"——那一步纯属大批量无用删除，且会触发环境的批量删除护栏。
Write-Host "保留 $($keep.Count) 个依赖文件，清理 $removed 个冗余"

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
# 包外层：manifest/图标/LICENSE/cmd/config/wizard
foreach ($f in @("manifest","ICON.png","ICON_256.png","LICENSE")) {
    if (Test-Path (Join-Path $PkgDir $f)) { Copy-Item (Join-Path $PkgDir $f) $Stage -Force }
}
foreach ($d in @("cmd","config","wizard")) {
    Copy-Item (Join-Path $PkgDir $d) (Join-Path $Stage $d) -Recurse -Force
}
# app 载荷：显式只拷 cmd / server / ui
# （不再整拷 app 后再删 app\www —— app\www 有 1085 个文件，先拷再删会触发批量删除护栏）
New-Item -ItemType Directory (Join-Path $Stage "app") | Out-Null
foreach ($d in @("cmd","server","ui")) {
    Copy-Item (Join-Path $PkgDir "app\$d") (Join-Path $Stage "app\$d") -Recurse -Force
}
# 包根 ui（desktop_uidir 指向安装目录下的 ui，由 app.tgz 解出）直接取前端产物
Copy-Item $AppUi (Join-Path $Stage "ui") -Recurse -Force
# 排除后端运行时垃圾（数据库/日志/用户上传绝不能进包）
Remove-Item (Join-Path $Stage "app\server\node\data\*.db") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $Stage "app\server\node\data\logs") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $Stage "app\server\node\data\photos\*") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $Stage "app\server\node\data\uploads\*") -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "stage 目录已组装（已排除 app\www 与运行时数据）"

# ---------- Step 5: fnpack 打包 ----------
Step "5/6 fnpack 打包"
$fnpack = Join-Path $Parent "fnpack_tool.exe"
if (-not (Test-Path $fnpack)) { $fnpack = "fnpack_tool.exe" }
# 只清 fnpack 的中间产物 pregnancyjournal.fpk。
# 带版本号的成品保留到新一轮成功后再被 Move-Item -Force 覆盖 ——
# 这样万一本轮打包中途失败，上一版可用的 fpk 还在。
Get-ChildItem $Parent -Filter "pregnancyjournal.fpk" -File | Remove-Item -Force
Push-Location $Parent
& $fnpack build --directory $Stage
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "fnpack 打包失败" }
Pop-Location
$fpk = Get-Item (Join-Path $Parent "pregnancyjournal.fpk") -ErrorAction SilentlyContinue
if (-not $fpk) { throw "未找到输出 fpk" }
$finalPath = Join-Path $Parent "pregnancyjournal_v$Version.fpk"
Move-Item $fpk.FullName $finalPath -Force

# ---------- Step 6: 打包后解包验证 ----------
# 只读清单 + 仅抽取 2 个小文件；不做整包解压（整包解压会产生上万文件，删除时撞护栏）
Step "6/6 打包后解包验证"
$verify = Join-Path $env:TEMP "pregnancyjournal_verify_$Version"
if (Test-Path $verify) { Remove-Item $verify -Recurse -Force }
New-Item -ItemType Directory $verify | Out-Null
Copy-Item $finalPath "$verify\pkg.tar.gz"
$vErrors = @()
# 外层清单
$outer = @(& tar -tzf "$verify\pkg.tar.gz")
foreach ($f in @("manifest","cmd/main","LICENSE","config/privilege")) {
    if ($outer -notcontains $f) { $vErrors += "包外层缺少: $f" }
}
# 内层清单（只抽 app.tgz，不解压）
& tar -xzf "$verify\pkg.tar.gz" -C $verify app.tgz
if (-not (Test-Path (Join-Path $verify "app.tgz"))) { $vErrors += "包外缺少 app.tgz" }
$inner = @(& tar -tzf "$verify\app.tgz")
foreach ($f in @("server\node\server.js","server\node\websocket.js","server\node\data\recipes.json",
                 "server\node\data\food_safety_v3.json","server\node\node_modules\express\package.json",
                 "server\node\node_modules\sql.js\package.json")) {
    if ($inner -notcontains ($f -replace '\\','/')) { $vErrors += "包内缺少: $f" }
}
foreach ($r in $routeFiles) {
    if ($inner -notcontains "server/node/routes/$r.js") { $vErrors += "包内缺少路由: $r.js" }
}
$assetCount = @($inner | Where-Object { $_ -like "ui/assets/*" -and $_ -notlike "*/" }).Count
if ($assetCount -lt 30) { $vErrors += "前端 assets 仅 $assetCount 个文件，异常" }
# cmd/main 无BOM（只抽这一个文件）
& tar -xzf "$verify\pkg.tar.gz" -C $verify cmd/main
$mb = [System.IO.File]::ReadAllBytes((Join-Path $verify "cmd\main"))[0]
if ($mb -ne 0x23) { $vErrors += "cmd/main 含 BOM" }
# 包内不得含运行时数据库/日志
foreach ($bad in @($inner | Where-Object { $_ -like "server/node/data/*.db" -or $_ -like "server/node/data/logs/*" })) {
    $vErrors += "包内混入运行时数据: $bad"
}
Remove-Item $verify -Recurse -Force
if ($vErrors.Count -gt 0) { $vErrors | ForEach-Object { Write-Host "  [X] $_" -ForegroundColor Red }; throw "包内容验证失败" }

$sizeMB = [math]::Round((Get-Item $finalPath).Length / 1MB, 2)
Write-Host "`n✅ 打包并验证完成：pregnancyjournal_v$Version.fpk ($sizeMB MB)" -ForegroundColor Green
Write-Host "   路由 $($routeFiles.Count) 个 / 静态数据完整 / 前端 assets $assetCount 个 / node_modules 完整"
