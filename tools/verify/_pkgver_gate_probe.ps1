# build.ps1「package.json / package-lock.json 版本号」闸门的**手工**反例探针
#
# 【为什么是手工、没进 run_all_suites】
# 判定逻辑本身（verify_pkg_versions.js）已作为 node 套件天天跑；本探针验的是**外面那层包装**：
# build.ps1 是否真的把 node 的非零退出码变成了闸门错误。这层只能用 PowerShell 跑，
# 而本机 PowerShell 无法被自动化驱动（工具 stdout 恒空、bash 调 powershell.exe 被安全策略拦）
# ⇒ 无法作为套件收进 run_all_suites。**发版前手工跑一次**，或改动 build.ps1 的 Step1 后跑。
#
# 用法（在仓库根目录）：
#   pwsh -File tools/verify/_pkgver_gate_probe.ps1
# 期望输出末尾三行均为「OK」：
#   场景1 真实仓库            -> 闸门无错（exit 0）
#   场景2 版本不同步(9.9.9)   -> 闸门拦下（exit 1）
#   场景3 脚本缺失            -> 闸门拦下（fail-closed，不静默跳过）
#
# ⚠️ 本探针**只复制文件到 %TEMP% 的临时目录**，不动仓库里任何文件；结束时会清理临时目录。

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# 仓库根 = 本脚本上两级（tools/verify/ -> 仓库根），不写死绝对路径
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not (Test-Path (Join-Path $repo "manifest"))) {
    Write-Host "[X] 找不到仓库根（由脚本位置推定：$repo）" -ForegroundColor Red
    exit 2
}

# 逐字复刻 build.ps1 Step1 里的那段闸门（只把 $PSScriptRoot 换成 $pkgRoot 以便指向假根）
function Invoke-PkgVerGate($pkgRoot) {
    $errors = @()
    $pkgVerChk = Join-Path $pkgRoot "tools\verify\verify_pkg_versions.js"
    if (-not (Test-Path $pkgVerChk)) {
        $errors += "缺少 tools\verify\verify_pkg_versions.js（package.json / lock 版本号闸门）"
    } elseif (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        $errors += "未找到 node，无法校验 package.json / package-lock.json 的版本号（fail-closed，不跳过）"
    } else {
        & node $pkgVerChk | Out-Null
        if ($LASTEXITCODE -ne 0) {
            $errors += "package.json / package-lock.json 的版本号与 manifest 不同步（见上方 node 输出）"
        }
    }
    return ,$errors
}

$fail = 0
function Check($name, $ok, $detail) {
    if ($ok) { Write-Host "  OK   $name" -ForegroundColor Green }
    else { Write-Host "  FAIL $name —— $detail" -ForegroundColor Red; $script:fail++ }
}

Write-Host "仓库根：$repo"

# ---------- 场景 1：真实仓库（应当无错）----------
$e1 = Invoke-PkgVerGate $repo
Check "场景1 真实仓库不被拦" ($e1.Count -eq 0) ("错误数=" + $e1.Count + " " + ($e1 -join '; '))

# ---------- 场景 2：版本没同步的仓库（必须拦下）----------
$tmp = Join-Path $env:TEMP ("pj-gate-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
try {
    foreach ($d in @("frontend", "app\server\node", "tools\verify")) {
        New-Item -ItemType Directory -Force -Path (Join-Path $tmp $d) | Out-Null
    }
    Copy-Item (Join-Path $repo "manifest") (Join-Path $tmp "manifest") -Force
    Copy-Item (Join-Path $repo "app\server\node\package.json") (Join-Path $tmp "app\server\node\package.json") -Force
    Copy-Item (Join-Path $repo "app\server\node\package-lock.json") (Join-Path $tmp "app\server\node\package-lock.json") -Force
    Copy-Item (Join-Path $repo "tools\verify\verify_pkg_versions.js") (Join-Path $tmp "tools\verify\verify_pkg_versions.js") -Force
    # 模拟「改了 manifest、忘了同步 frontend/package.json」
    $pj = Get-Content (Join-Path $repo "frontend\package.json") -Raw | ConvertFrom-Json
    $pj.version = "9.9.9"
    $pj | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $tmp "frontend\package.json") -Encoding UTF8

    $env:PJ_PKG_ROOT = $tmp
    Write-Host "  ---- node 子进程真实输出 ----"
    & node (Join-Path $tmp "tools\verify\verify_pkg_versions.js")
    $code = $LASTEXITCODE
    Remove-Item Env:\PJ_PKG_ROOT -ErrorAction SilentlyContinue
    $e2 = Invoke-PkgVerGate $tmp
    Check "场景2 版本不同步被拦下" (($code -eq 1) -and ($e2.Count -ge 1)) `
        ("node 退出码=" + $code + "（期望 1）、闸门错误数=" + $e2.Count + "（期望 >=1）")
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------- 场景 3：缺脚本（fail-closed，不许静默跳过）----------
$tmp3 = Join-Path $env:TEMP ("pj-gate-empty-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
try {
    New-Item -ItemType Directory -Force -Path $tmp3 | Out-Null
    $e3 = Invoke-PkgVerGate $tmp3
    Check "场景3 缺脚本不静默跳过（fail-closed）" ($e3.Count -ge 1) ("错误数=" + $e3.Count + "（期望 >=1）")
} finally {
    Remove-Item $tmp3 -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
if ($fail -gt 0) { Write-Host "版本号闸门探针：$fail 项失败" -ForegroundColor Red; exit 1 }
Write-Host "版本号闸门探针：3 场景全部符合预期" -ForegroundColor Green
exit 0
