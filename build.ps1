# ============================================================
# 孕程记 一键打包脚本（唯一打包入口）
# 流程：校验源码完整性 -> 安装生产依赖 -> 组装干净stage目录 -> fnpack打包 -> 解包验证
# 用法：在项目根目录（含本脚本的目录）执行：pwsh -File build.ps1
# 发布闸门（2026-09-30 上线前检查 #6 补）：
#   - 工作区脏（有未提交改动）拒绝打包，-AllowDirty 放行；
#   - 同名版本 fpk 已存在拒绝覆盖，-Force 放行。
# ============================================================
param([switch]$AllowDirty, [switch]$Force)
$ErrorActionPreference = "Stop"
# 打包根目录：应用位于脚本目录（仓库根）；仍兼容旧的 pregnancyjournal/ 子目录布局
$PkgDir    = Join-Path $PSScriptRoot "pregnancyjournal"
if (-not (Test-Path (Join-Path $PkgDir "manifest"))) { $PkgDir = $PSScriptRoot }
$ServerDir = Join-Path $PkgDir "app\server\node"
$AppUi     = Join-Path $PkgDir "app\ui"
# 注：不再有 $RootUi（根 ui/ 是历史死重，既不进包也不是运行时目录；
# 运行时 STATIC_DIR = ${TRIM_APPDEST}/ui，来自 app.tgz:ui，即 app/ui）。
$Version   = "0.0.33"   # 发版同步：必须与 manifest 的 version 一致（唯一真源=manifest）
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
$manifestText = [System.IO.File]::ReadAllText((Join-Path $PkgDir "manifest"))
$manifestVer = [regex]::Match($manifestText, '(?m)^\s*version\s*=\s*([0-9][0-9.]*)').Groups[1].Value
if ($manifestVer -ne $Version) { $errors += "manifest 版本($manifestVer) 与脚本 `$Version($Version) 不一致" }
# sub_version 也要一起校验：①与 version 相同；②必须是 3 段式。
# 历史坑：v0.0.30 首发包把 sub_version 写成 4 段式 0.0.30.0（上架无效），
# 而当时只校验了 version，这道漏网之鱼直到发布后才被发现。
$manifestSub = [regex]::Match($manifestText, '(?m)^\s*sub_version\s*=\s*([0-9][0-9.]*)').Groups[1].Value
if ($manifestSub -ne $Version) { $errors += "manifest sub_version($manifestSub) 与 `$Version($Version) 不一致" }
if (($manifestSub -split '\.').Count -ne 3) { $errors += "manifest sub_version($manifestSub) 必须是 3 段式（如 0.0.31）" }
# changelog 必须与本版同步：版本号改了但说明还停在上版的话，
# 用户在应用中心看到的「更新说明」会是上一版的内容。
if ($manifestText -notmatch [regex]::Escape("V$Version")) { $errors += "manifest changelog 未包含 V$Version（说明还停在上一个版本）" }
# README 是发版需同步的**第 5 处**：徽章与下载文件名都对外可见。
# 历史坑：v0.0.31 发布后 README 仍写着 0.0.28 / 14.6MB（落后 3 个版本），
# 因为这道校验只覆盖了 manifest/config.js/build.ps1/CHANGELOG，README 在网外。
$readmePath = Join-Path $PkgDir "README.md"
if (Test-Path $readmePath) {
    $readmeText = [System.IO.File]::ReadAllText($readmePath)
    if ($readmeText -notmatch [regex]::Escape("version-$Version-green.svg")) {
        $errors += "README.md 版本徽章未同步（应含 version-$Version-green.svg）"
    }
    if ($readmeText -notmatch [regex]::Escape("pregnancyjournal_v$Version.fpk")) {
        $errors += "README.md 下载文件名未同步（应含 pregnancyjournal_v$Version.fpk）"
    }
} else {
    $errors += "缺少 README.md"
}
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
# config.js 的 APP_VERSION（用户可见：启动日志、PDF 导出页脚）必须与 manifest 一致。
# 上面 71 行注释早就声称覆盖 config.js/CHANGELOG，但代码从未真正读取过这两个文件 —— 补上。
$configJsPath = Join-Path $ServerDir "config.js"
if (Test-Path $configJsPath) {
    $configVer = [regex]::Match((Get-Content $configJsPath -Raw), "APP_VERSION:\s*'([0-9][0-9.]*)'").Groups[1].Value
    if ($configVer -ne $Version) { $errors += "config.js APP_VERSION($configVer) 与 `$Version($Version) 不一致" }
} else { $errors += "缺少 config.js" }
# CHANGELOG.md 必须记录了本版（manifest changelog 面向应用中心，仓库内面向开源用户）
$changelogPath = Join-Path $PkgDir "CHANGELOG.md"
if (Test-Path $changelogPath) {
    if ((Get-Content $changelogPath -Raw) -notmatch [regex]::Escape("[$Version]")) {
        $errors += "CHANGELOG.md 未记录 [$Version]（说明还停在上一个版本）"
    }
} else { $errors += "缺少 CHANGELOG.md" }
# 前端产物新鲜度：app/ui 被 gitignore，脏树检查看不见它 —— 必须直接比 mtime。
# 源码比产物新 ⇒ 产物是旧的，打出去就是「新号旧货」（本次 0.0.32 污染事故同款）。
$FrontendSrc = Join-Path $PkgDir "frontend\src"
if ((Test-Path $FrontendSrc) -and (Test-Path $indexHtml)) {
    $srcNewest = Get-ChildItem $FrontendSrc -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $uiStamp   = (Get-Item $indexHtml).LastWriteTime
    if ($srcNewest -and $srcNewest.LastWriteTime -gt $uiStamp) {
        $errors += "前端源码($($srcNewest.Name) @ $($srcNewest.LastWriteTime)) 比构建产物(@ $uiStamp) 新：先在 frontend 执行 npm run build 再打包"
    }
}
# 脏树闸门：未提交改动一旦打进包，就可能以未 bump 的版本号覆盖已发布产物。
if (-not $AllowDirty -and (Test-Path (Join-Path $PkgDir ".git"))) {
    Push-Location $PkgDir
    try {
        $dirty = & git status --porcelain
        if ($LASTEXITCODE -eq 0 -and $dirty) {
            $n = ($dirty | Measure-Object).Count
            $errors += "工作区有 $n 项未提交改动，禁止打包（先提交；确认无风险可加 -AllowDirty 放行）"
        }
    } finally { Pop-Location }
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
    # ⚠️ 字符类里**必须允许 `.`**：Vite 对被两个以上 chunk 共享的 `.vue` 组件会产出
    #    `Foo.vue_vue_type_script_setup_true_lang-<hash>.js` 这种**文件名带点**的 chunk。
    #    旧的 `[A-Za-z0-9_-]+` 匹配不到 ⇒ 它被当成冗余移出包 ⇒ 运行时 404、页面白屏。
    #    2026-09-30 实测：QuickLogDialog 被 DashboardView / RecordView 共享，正是这种形态，
    #    且因为 `$assetCount -lt 30` 之类的数量断言够不着，Step6 一路"验证通过"。
    $refs = [regex]::Matches($c, '[\./"]([A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,12}\.(?:js|css))["'']')
    foreach ($r in $refs) {
        $n = $r.Groups[1].Value
        if (Test-Path (Join-Path $assetsDir $n)) { $queue.Enqueue($n) }
    }
}
$removed = 0
# ⚠️ 用「移动到隔离目录」而不是 Remove-Item：
# ① 这是**构建产物**，误删顶多重编一次，但直接删会触发部分环境的删除护栏（fail-closed 直接中断打包）；
# ② 移走后仍可回收，出问题能对照。隔离目录在仓库根的 .trash/ 下（已 gitignored）。
# ⚠️ 搬之前先做 **fail-closed 自检**：待搬的文件若仍被「剩下的产物」或 index.html 引用，
#    说明上面的依赖图漏了它（正则写窄 / Vite 换了命名），搬走就等于发出一个白屏包。
#    这种情况必须**当场中断打包**，而不是靠 Step6 的数量断言兜底（它够不着）。
$assetsTrash = $null
$toRemove = @(Get-ChildItem $assetsDir -File | Where-Object { -not $keep.Contains($_.Name) })
if ($toRemove.Count -gt 0) {
    $scanFiles = @(Get-ChildItem $assetsDir -File | Where-Object { $keep.Contains($_.Name) } | ForEach-Object { $_.FullName })
    $scanFiles += $indexHtml
    $misjudged = @()
    foreach ($f in $toRemove) {
        foreach ($s in $scanFiles) {
            if ([System.IO.File]::ReadAllText($s).Contains($f.Name)) {
                $misjudged += "$($f.Name)  ← 仍被 $([System.IO.Path]::GetFileName($s)) 引用"
                break
            }
        }
    }
    if ($misjudged.Count -gt 0) {
        throw ("冗余清理误判（搬走这些文件会让页面白屏，已中止打包）：`n  " + ($misjudged -join "`n  ") +
               "`n  ⇒ 请修 Step 1.5 的依赖图正则，不要靠 -Force 硬过。")
    }
    $assetsTrash = Join-Path $PkgDir ".trash\ui-assets-$(Get-Date -Format yyyyMMdd-HHmmss)"
    New-Item -ItemType Directory -Force -Path $assetsTrash | Out-Null
    foreach ($f in $toRemove) {
        Move-Item $f.FullName -Destination (Join-Path $assetsTrash $f.Name) -Force
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

# sql.js 的 dist 里塞了同一份 SQLite 的多种构建变体（约 19MB）：
# 调试版（*-debug）、浏览器版（*-browser）、Web Worker 版（worker.*）、asm.js 版。
# 运行时只加载 dist/sql-wasm.js + dist/sql-wasm.wasm 两个文件（约 0.7MB），
# 其余永远不会被执行，却跟着整个 node_modules 进包。这里只保留这三个：
#   sql-wasm.js / sql-wasm.wasm（真正在用的）
#   sql-asm.js（无 WebAssembly 环境下的纯 JS 兜底，留着保险）
$sqlDist = Join-Path $Stage "app\server\node\node_modules\sql.js\dist"
if (Test-Path $sqlDist) {
    $keepSql = @('sql-wasm.js', 'sql-wasm.wasm', 'sql-asm.js')
    $before  = (Get-ChildItem $sqlDist -File | Measure-Object -Property Length -Sum).Sum
    Get-ChildItem $sqlDist -File | Where-Object { $keepSql -notcontains $_.Name } | ForEach-Object {
        Remove-Item $_.FullName -Force
    }
    $after = (Get-ChildItem $sqlDist -File | Measure-Object -Property Length -Sum).Sum
    $saved = [math]::Round(($before - $after) / 1MB, 1)
    Write-Host ("sql.js 冗余变体已剔除：{0} MB → {1} MB（省 {2} MB）" -f `
        [math]::Round($before / 1MB, 1), [math]::Round($after / 1MB, 1), $saved) -ForegroundColor DarkGray
}

# source map（*.map）：只有排查压缩后代码时才用得上，运行时从不加载。
# 后端依赖里带了 200 多个，合计约 7 MB，纯属占体积。
# （test/ example/ docs 这类目录合计不到 1 MB，收益太小不值得动，保持 node_modules 原样。）
$mapFiles = Get-ChildItem (Join-Path $Stage "app\server\node\node_modules") -Recurse -File -Filter *.map -ErrorAction SilentlyContinue
if ($mapFiles) {
    $mapSaved = [math]::Round((($mapFiles | Measure-Object -Property Length -Sum).Sum) / 1MB, 1)
    $mapFiles | ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
    Write-Host ("已剔除 source map {0} 个（省 {1} MB）" -f $mapFiles.Count, $mapSaved) -ForegroundColor DarkGray
}
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
    $fpkTrash = Join-Path $PkgDir ".trash\build-$(Get-Date -Format yyyyMMdd-HHmmss)"
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
# 同名版本拒绝覆盖：防止「版本号没 bump + 重打包」把已发布产物悄悄换成另一份内容。
# 开发期反复调包属正常，确认要覆盖时显式加 -Force。
if ((Test-Path $finalPath) -and -not $Force) {
    throw "已存在 $finalPath —— 同名版本拒绝覆盖。要重打包请加 -Force；要发新版请先同步 5 处版本号。"
}
Move-Item $fpk.FullName $finalPath -Force

# ---------- Step 5.5: 补包内脚本的执行权限 ----------
# Windows 版 fnpack 打出的 tar 里所有条目都是 0666（没有执行位），而飞牛要求 cmd/ 下
# 的生命周期脚本是 755。设备上实测能跑，说明系统会补，但那属于依赖对方兜底 ——
# 一旦不补，表现就是"安装/启动毫无征兆地失败"，极难排查。这里只改权限头字节，不动内容。
Step "5.5/6 修正包内脚本权限（cmd/* 与 ui/index.cgi -> 0755）"
$modeFix = Join-Path $PkgDir "fix_fpk_modes.js"
$nodeExe = Get-Command node -ErrorAction SilentlyContinue
if ((-not $nodeExe) -or (-not (Test-Path $modeFix))) {
    Write-Host "  [!] 跳过（缺少 node 或 fix_fpk_modes.js）；包内脚本将依赖系统补权限" -ForegroundColor Yellow
} else {
    & node $modeFix $finalPath
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [!] 权限修正未成功（脚本保证不动原包，包仍可用，但需依赖系统补权限）" -ForegroundColor Yellow
    }
}

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
# ⚠️ 数量断言**够不着"少一个 chunk"** —— 2026-09-30 实测过一版包：
#    Step1.5 的依赖图漏判（文件名带点的共享 chunk），移走一个仍被静态 import 的文件，
#    assets 从 50 变 49，这里 49 -lt 30 = false ⇒ 一路"验证通过"，装上去就是白屏。
#    所以 Step6 必须做**逐一比对 + 引用闭合**，不能只看数量。
$pkgAssets = @($inner | Where-Object { $_ -like "ui/assets/*" -and $_ -notlike "*/" } |
               ForEach-Object { $_.Substring("ui/assets/".Length) })
$localAssets = @(Get-ChildItem $assetsDir -File | ForEach-Object { $_.Name })
$missA = @($localAssets | Where-Object { $pkgAssets -notcontains $_ })
$extraA = @($pkgAssets | Where-Object { $localAssets -notcontains $_ })
if ($missA.Count -gt 0) { $vErrors += "包内 ui/assets 缺少: $($missA -join '、')" }
if ($extraA.Count -gt 0) { $vErrors += "包内 ui/assets 多出未预期文件: $($extraA -join '、')" }
# 引用闭合：从 index.html 出发遍历，每个被引用的 chunk 都必须真实存在。
# ⚠️ 前导字符类含 `/`（跨 chunk 写作 "./Foo-<hash>.js"）；名字里允许 `.`（共享 .vue 组件）。
$uiHtmlPath = Join-Path $AppUi "index.html"
$seenAssets = New-Object System.Collections.Generic.HashSet[string]
$aq = [System.Collections.Queue]::new()
foreach ($m in [regex]::Matches([System.IO.File]::ReadAllText($uiHtmlPath), '/assets/([A-Za-z0-9._-]+\.(?:js|css))')) {
    $aq.Enqueue($m.Groups[1].Value)
}
$dangling = @()
while ($aq.Count -gt 0) {
    $f = $aq.Dequeue()
    if (-not $seenAssets.Add($f)) { continue }
    $fp = Join-Path $assetsDir $f
    if (-not (Test-Path $fp)) { $dangling += $f; continue }
    $fc = [System.IO.File]::ReadAllText($fp)
    foreach ($m in [regex]::Matches($fc, '[./"]([A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,12}\.(?:js|css))["'']')) {
        if (Test-Path (Join-Path $assetsDir $m.Groups[1].Value)) { $aq.Enqueue($m.Groups[1].Value) }
    }
}
if ($dangling.Count -gt 0) { $vErrors += "前端存在悬空引用（运行时会 404）: $($dangling -join '、')" }
if ($seenAssets.Count -ne $localAssets.Count) {
    $vErrors += "前端引用闭合不上：从 index.html 只能走到 $($seenAssets.Count) / $($localAssets.Count) 个产物"
}
# cmd/main 无BOM（只抽这一个文件）
& tar -xzf "$verify\pkg.tar.gz" -C $verify cmd/main
$mb = [System.IO.File]::ReadAllBytes((Join-Path $verify "cmd\main"))[0]
if ($mb -ne 0x23) { $vErrors += "cmd/main 含 BOM" }
# cmd/main 在包内必须带执行位（Step 5.5 修正过；tar -tvzf 的输出形如 "-rwxr-xr-x"）
$modeLine = @(& tar -tvzf "$verify\pkg.tar.gz" cmd/main) | Select-Object -First 1
if ($modeLine -notmatch '^-rwx') { $vErrors += "cmd/main 在包内没有执行位: $modeLine" }
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
