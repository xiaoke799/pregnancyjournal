$extract = "$env:TEMP\fpk_check"
Write-Host "=== 1. ui/config ==="
Get-Content "$extract\ui\config"

Write-Host "`n=== 2. cmd/main BOM ==="
$b = [System.IO.File]::ReadAllBytes("$extract\cmd\main")[0..2]
$hex = ($b | ForEach-Object { $_.ToString('X2') }) -join ' '
Write-Host "首字节: $hex"
if ($b[0] -eq 0x23) { Write-Host "OK 无BOM" } else { Write-Host "BAD 有BOM" }

Write-Host "`n=== 3. server.js ==="
$s = Get-Content "$extract\server\node\server.js" -Raw
$catchAll = $s.Contains("app.get('*'")
Write-Host "catch-all存在: $catchAll"
Write-Host "loadedRoutes: $($s.Contains('let loadedRoutes = 0'))"

Write-Host "`n=== 4. assets ==="
Write-Host "文件数: $((Get-ChildItem "$extract\ui\assets").Count)"

Write-Host "`n=== 5. node_modules ==="
Write-Host "express: $(Test-Path "$extract\server\node\node_modules\express")"
Write-Host "sql.js: $(Test-Path "$extract\server\node\node_modules\sql.js")"
Write-Host "ws: $(Test-Path "$extract\server\node\node_modules\ws")"

Write-Host "`n=== 6. 无运行时数据 ==="
Write-Host "data: $(Test-Path "$extract\data")"

Write-Host "`n=== 7. outer cmd/main ==="
$b2 = [System.IO.File]::ReadAllBytes("$extract\cmd\main")[0..2]
Write-Host "outer main 首字节: $(($b2 | ForEach-Object { $_.ToString('X2') }) -join ' ')"
