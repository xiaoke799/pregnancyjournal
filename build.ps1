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
$Version   = "0.0.30"   # 发版同步：必须与 manifest 的 version 一致（唯一真源=manifest）
if ($PkgDir -eq $PSScriptRoot) { $Parent = $PSScriptRoot } else { $Parent = Split-Path $PkgDir -Parent }
$Stage     = Join-Path $env:TEMP "pregnancyjournal_stage_$Version"

function Step($msg) { Write-Host "`n========== $msg ==========" -ForegroundColor Cyan }

# ---------- Step 1: 源码完整性校验 ----------
Step "1/6 源码完整性校验"
$errors = @()
# 后端静态数据（食谱/食品安全/产检表/待产清单）
foreach ($f in @("recipes.json","food_safety_v3.json","checkup_schedule.json",
                 "checkup_subitem_aliases.json",
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
# 包根图标（fnOS 约定的 ICON.png / ICON_256.png）。仓库里的实际文件名是大写 .PNG，
# 大小写不敏感匹配，避免"文件名大小写不一致时静默跳过"。
foreach ($f in @("ICON.png","ICON_256.png")) {
    $hit = Get-ChildItem $PkgDir -File | Where-Object { $_.Name -ieq $f } | Select-Object -First 1
    if (-not $hit) { $errors += "缺少包图标: $f" }
}
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
# 版本号一致性：manifest 是唯一真源，build.ps1 的 $Version 必须与它相同；
# 且前端产物必须真的带上了这个版本号（由 vite.config.ts 的 define 从 manifest 注入）。
# 曾因前端没注入、main.ts 兜底写死 '0.0.27'，导致 v0.0.28 的包在日志里谎报 v0.0.27。
$manifestVer = [regex]::Match([System.IO.File]::ReadAllText((Join-Path $PkgDir "manifest")),
                              '(?m)^\s*version\s*=\s*([0-9][0-9.]*)').Groups[1].Value
if ($manifestVer -ne $Version) { $errors += "manifest 版本($manifestVer) 与脚本 `$Version($Version) 不一致" }
$entryJs = [regex]::Match($html, '/assets/(index-[A-Za-z0-9._-]+\.js)').Groups[1].Value
if (-not $entryJs) {
    $errors += "index.html 未引用 index-*.js 入口"
} elseif (-not ([System.IO.File]::ReadAllText((Join-Path $AppUi "assets\$entryJs"))).Contains($manifestVer)) {
    $errors += "前端产物未注入版本号 $manifestVer（先在 frontend 执行 npm run build 再打包）"
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
# ⚠️ 用「移动到隔离目录」而不是 Remove-Item：
# ① 这是**构建产物**，误删顶多重编一次，但直接删会触发部分环境的删除护栏（fail-closed 直接中断打包）；
# ② 移走后仍可回收，出问题能对照。隔离目录在 .workbuddy 下（已 gitignored）。
$assetsTrash = $null
Get-ChildItem $assetsDir -File | ForEach-Object {
    if (-not $keep.Contains($_.Name)) {
        if (-not $assetsTrash) {
            $assetsTrash = Join-Path $PkgDir ".workbuddy\trash-ui-assets-$(Get-Date -Format yyyyMMdd-HHmmss)"
            New-Item -ItemType Directory -Force -Path $assetsTrash | Out-Null
        }
        Move-Item $_.FullName -Destination (Join-Path $assetsTrash $_.Name) -Force
        $removed++
    }
}
if ($assetsTrash) { Write-Host "冗余文件已移入隔离目录（未删除，可自行清理）: $assetsTrash" -ForegroundColor DarkGray }
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

# ---------- Step 3: 规范 cmd 脚本编码（无BOM、LF）+ 同步 app/cmd ----------
Step "3/6 规范 cmd 脚本编码（无BOM、LF）并同步 app/cmd"
$RootCmd = Join-Path $PkgDir "cmd"
$AppCmd  = Join-Path $PkgDir "app\cmd"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
Get-ChildItem $RootCmd -File | ForEach-Object {
    $text = [System.IO.File]::ReadAllText($_.FullName).Replace("`r`n", "`n")
    [System.IO.File]::WriteAllText($_.FullName, $text, $utf8NoBom)
    # 仓库里有两份同名脚本：根 cmd/ 是 fnOS 真正执行的那份（打包进 fpk 外层，
    # 安装后位于 /var/apps/{appname}/cmd/）；app/cmd 是被解到 ${TRIM_APPDEST}/cmd 的副本。
    # 历史坑：upgrade_init 只改了根 cmd/，app/cmd 还停在 4 行桩脚本 —— 一旦有人改错副本，
    # 修复会静默失效且毫无报错。故以根 cmd/ 为唯一真源，打包时强制同步。
    if (Test-Path $AppCmd) { Copy-Item $_.FullName (Join-Path $AppCmd $_.Name) -Force }
}
$rootNames = @(Get-ChildItem $RootCmd -File | Select-Object -ExpandProperty Name | Sort-Object)
$appNames  = @(Get-ChildItem $AppCmd  -File | Select-Object -ExpandProperty Name | Sort-Object)
if (Compare-Object $rootNames $appNames) { throw "cmd/ 与 app/cmd/ 文件清单不一致，请手工对齐" }
Write-Host "cmd 脚本已规范，并同步到 app/cmd（$($rootNames.Count) 个，两份一致）"

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
# photos / uploads 是可写数据目录（运行时在 ${TRIM_PKGVAR}/data 下），不该出现在只读资源区。
# 连目录本身一起删：只清内容会留下空目录，空目录也会作为条目进包。
Remove-Item (Join-Path $Stage "app\server\node\data\photos") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $Stage "app\server\node\data\uploads") -Recurse -Force -ErrorAction SilentlyContinue
# data/ 目录里的一次性开发脚本（build-food-safety.js / fix-json.js）：仅本机建库用过，
# 运行时从不 require，会随 app\server 整目录进包占体积 —— 显式排除。
Remove-Item (Join-Path $Stage "app\server\node\data\*.js") -Force -ErrorAction SilentlyContinue
Write-Host "stage 目录已组装（已排除 app\www、运行时数据与开发脚本）"

# ---------- Step 5: fnpack 打包 ----------
Step "5/6 fnpack 打包"
$fnpack = Join-Path $Parent "fnpack_tool.exe"
if (-not (Test-Path $fnpack)) { $fnpack = "fnpack_tool.exe" }
# 只清 fnpack 的中间产物 pregnancyjournal.fpk。
# 带版本号的成品保留到新一轮成功后再被 Move-Item -Force 覆盖 ——
# 这样万一本轮打包中途失败，上一版可用的 fpk 还在。
# ⚠️ 不要写 `Get-ChildItem ... -File | Remove-Item`：中间产物不存在时管道为空，
# Remove-Item 会以「缺少路径」报错；且本机 Remove-Item 一律先尝试送回收站、失败即中断打包。
# 这里也统一改成「存在就移入隔离目录」。
$intermediate = Join-Path $Parent "pregnancyjournal.fpk"
if (Test-Path $intermediate) {
    $fpkTrash = Join-Path $PkgDir ".workbuddy\trash-build-$(Get-Date -Format yyyyMMdd-HHmmss)"
    New-Item -ItemType Directory -Force -Path $fpkTrash | Out-Null
    Move-Item $intermediate -Destination (Join-Path $fpkTrash "pregnancyjournal.fpk") -Force
}
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
# 外层清单（`-notcontains` 是大小写不敏感的，故 ICON.png 能匹配包里的 ICON.PNG）
$outer = @(& tar -tzf "$verify\pkg.tar.gz")
foreach ($f in @("manifest","ICON.png","ICON_256.png","cmd/main","LICENSE","config/privilege")) {
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
# 包内不得含可写数据目录（photos/uploads 属于 ${TRIM_PKGVAR}，不是随包只读资源）
foreach ($bad in @($inner | Where-Object { $_ -like "server/node/data/photos*" -or $_ -like "server/node/data/uploads*" })) {
    $vErrors += "包内混入可写数据目录: $bad"
}
# 包内不得含 data/ 下的一次性开发脚本
foreach ($bad in @($inner | Where-Object { $_ -like "server/node/data/*.js" })) {
    $vErrors += "包内混入开发脚本: $bad"
}
# 升级前抢救脚本必须在【两层】都在位且内容一致：
#   外层 cmd/        -> fnOS 实际执行的那份（/var/apps/{appname}/cmd/）
#   app.tgz 内 cmd/  -> 解到 ${TRIM_APPDEST}/cmd 的副本（历史上曾落后，必须一起校验）
if ($outer -notcontains "cmd/upgrade_init") { $vErrors += "包外层缺少: cmd/upgrade_init" }
if ($inner -notcontains "cmd/upgrade_init") { $vErrors += "app.tgz 内缺少: cmd/upgrade_init" }
foreach ($layer in @(
        @{ Name = "外层"; Archive = "$verify\pkg.tar.gz" },
        @{ Name = "app.tgz"; Archive = "$verify\app.tgz" })) {
    $sub = Join-Path $verify ("x" + ($layer.Name -replace '[^A-Za-z0-9]', ''))
    New-Item -ItemType Directory $sub -Force | Out-Null
    & tar -xzf $layer.Archive -C $sub cmd/upgrade_init
    $uPath = Join-Path $sub "cmd\upgrade_init"
    if (-not (Test-Path $uPath)) { $vErrors += "$($layer.Name) cmd/upgrade_init 抽取失败"; continue }
    if ([System.IO.File]::ReadAllBytes($uPath)[0] -ne 0x23) { $vErrors += "$($layer.Name) cmd/upgrade_init 含 BOM" }
    $uText = [System.IO.File]::ReadAllText($uPath)
    if ($uText -notmatch "LEGACY=" -or $uText -notmatch "cp -an") {
        $vErrors += "$($layer.Name) cmd/upgrade_init 缺少数据抢救逻辑"
    }
}
Remove-Item $verify -Recurse -Force
if ($vErrors.Count -gt 0) { $vErrors | ForEach-Object { Write-Host "  [X] $_" -ForegroundColor Red }; throw "包内容验证失败" }

$sizeMB = [math]::Round((Get-Item $finalPath).Length / 1MB, 2)
Write-Host "`n✅ 打包并验证完成：pregnancyjournal_v$Version.fpk ($sizeMB MB)" -ForegroundColor Green
Write-Host "   路由 $($routeFiles.Count) 个 / 静态数据完整 / 前端 assets $assetCount 个 / node_modules 完整"
