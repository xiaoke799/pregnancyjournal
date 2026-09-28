#!/bin/bash
# 本地仿真：验证 cmd/upgrade_init 的数据抢救逻辑
# 不碰真实系统，全部在 tools/verify/.tmp/upgrade-sim 下进行
set -u

# 本脚本所在目录（tools/verify），仓库根 = 往上两级
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

BASE="$HERE/.tmp/upgrade-sim"
SCRIPT="$REPO/cmd/upgrade_init"

rm -rf "$BASE"
APPDEST="$BASE/appdest"
PKGVAR="$BASE/pkgvar"

# ---- 构造「旧安装目录」里的用户数据 ----
mkdir -p "$APPDEST/server/node/data/photos"
mkdir -p "$APPDEST/server/node/data/backups"
mkdir -p "$APPDEST/server/node/data/uploads"
mkdir -p "$APPDEST/server/node/data/thumbnails"
echo "photo-A"      > "$APPDEST/server/node/data/photos/a.jpg"
echo "photo-B"      > "$APPDEST/server/node/data/photos/b.jpg"
echo "backup-1"     > "$APPDEST/server/node/data/backups/bk1.tar"
echo "upload-tmp"   > "$APPDEST/server/node/data/uploads/tmp.bin"
echo "thumb-1"      > "$APPDEST/server/node/data/thumbnails/t1.jpg"
echo '{"corp":"x"}' > "$APPDEST/server/node/data/wecom.json"
echo '{"last":"x"}' > "$APPDEST/server/node/data/daily_push_state.json"
echo '{"d":"x"}'    > "$APPDEST/server/node/data/schedule_dates.json"
echo "ASSET"        > "$APPDEST/server/node/data/recipes.json"
echo "STALE-DB"     > "$APPDEST/server/node/data/pregnancyjournal.db"
echo "logline"      > "$APPDEST/server/node/data/app.log"
echo "devscript"    > "$APPDEST/server/node/data/fix-json.js"

# ---- 构造「持久目录」里已有的数据（用于验证不被覆盖） ----
mkdir -p "$PKGVAR/data/photos"
echo "LIVE-DB"          > "$PKGVAR/data/pregnancyjournal.db"
echo "photo-EXISTING"   > "$PKGVAR/data/photos/a.jpg"
echo '{"corp":"KEEP"}'  > "$PKGVAR/data/wecom.json"

echo "=== 运行 upgrade_init ==="
TRIM_APPDEST="$APPDEST" TRIM_PKGVAR="$PKGVAR" TRIM_OLD_APPVER="0.0.27" \
TRIM_USERNAME="tester" TRIM_TEMP_LOGFILE="$BASE/upgrade.log" \
bash "$SCRIPT"
echo "exit=$?"

echo
echo "=== 抢救结果 ==="
find "$PKGVAR/data" -type f | sed "s#^$PKGVAR/data/##" | sort

echo
echo "=== 断言 ==="
fail=0
chk() { if [ "$2" = "$3" ]; then echo "  [OK]   $1"; else echo "  [FAIL] $1  期望=$3 实际=$2"; fail=1; fi; }
get() { cat "$PKGVAR/data/$1" 2>/dev/null || echo "<不存在>"; }

chk "photos/a.jpg 保留原有内容（不被旧文件覆盖）" "$(get photos/a.jpg)" "photo-EXISTING"
chk "photos/b.jpg 被抢救进来"                     "$(get photos/b.jpg)" "photo-B"
chk "backups/bk1.tar 被抢救进来"                  "$(get backups/bk1.tar)" "backup-1"
chk "thumbnails/t1.jpg 被抢救进来"                "$(get thumbnails/t1.jpg)" "thumb-1"
chk "uploads/tmp.bin 被抢救进来"                  "$(get uploads/tmp.bin)" "upload-tmp"
chk "wecom.json 保留原有内容（不被覆盖）"         "$(get wecom.json)" '{"corp":"KEEP"}'
chk "daily_push_state.json 被抢救进来"            "$(get daily_push_state.json)" '{"last":"x"}'
chk "schedule_dates.json 被抢救进来"              "$(get schedule_dates.json)" '{"d":"x"}'
chk "数据库未被旧库覆盖"                          "$(get pregnancyjournal.db)" "LIVE-DB"
chk "陈旧数据库未被搬入"                          "$([ -e "$PKGVAR/data/photos/../pregnancyjournal.db" ] && echo yes)" "yes"
chk "app.log 未被搬入"                            "$([ -e "$PKGVAR/data/app.log" ] && echo yes || echo no)" "no"
chk "fix-json.js 未被搬入"                        "$([ -e "$PKGVAR/data/fix-json.js" ] && echo yes || echo no)" "no"
chk "随包知识库 recipes.json 未被搬入"            "$([ -e "$PKGVAR/data/recipes.json" ] && echo yes || echo no)" "no"
chk "源文件仍然存在（只复制不删除）"              "$([ -e "$APPDEST/server/node/data/photos/a.jpg" ] && echo yes)" "yes"

echo
echo "=== 幂等性：再跑一次 ==="
TRIM_APPDEST="$APPDEST" TRIM_PKGVAR="$PKGVAR" TRIM_OLD_APPVER="0.0.27" \
TRIM_USERNAME="tester" TRIM_TEMP_LOGFILE="$BASE/upgrade2.log" \
bash "$SCRIPT"
echo "exit=$?"
chk "二次运行后 photos/a.jpg 仍为原有内容" "$(get photos/a.jpg)" "photo-EXISTING"

echo
echo "=== 日志 ==="
cat "$BASE/upgrade.log"

if [ "$fail" = "0" ]; then echo; echo "全部通过"; else echo; echo "有失败项"; fi
exit $fail
