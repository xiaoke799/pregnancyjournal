#!/bin/bash
# 孕程记 - 统一网关模式（Unix Socket 代理）
# 将 CGI 请求转发到 Unix Socket 上的 Node.js 服务

SOCKET_PATH="${TRIM_APPDEST}/app.sock"

# 后端冷启动期间 socket 还没生成，最多等 30 × 0.5s = 15 秒。
# 可用环境变量覆盖（排障时设大一点观察）。
MAX_WAIT_TRIES="${PJ_CGI_MAX_WAIT_TRIES:-30}"

# ⚠️ 这里曾经有一段兜底：socket 不存在时回退到 http://127.0.0.1:${PORT}（3867）。
# 但 server.js 只监听 unix socket，**3867 从来没有任何进程监听**，那个回退必然失败：
# curl 连接被拒绝，把英文报错 "upstream connect failed..." 当成响应体返回
# ⇒ 浏览器收到的不是 HTML ⇒ 页面白屏，网关还会把这句报错弹成一个提示闪一下。
# 现在改为：先等 socket 出现；真等不到就返回一张中文提示页，不再回退到死端口。
wait_for_socket() {
    local i=0
    while [ ! -S "$SOCKET_PATH" ] && [ "$i" -lt "$MAX_WAIT_TRIES" ]; do
        sleep 0.5
        i=$((i + 1))
    done
    [ -S "$SOCKET_PATH" ]
}

# 等不到后端时给人看的提示页（不再把 curl 的英文原文甩给用户）
serve_unavailable() {
    printf 'Content-Type: text/html; charset=utf-8\r\n'
    printf 'Status: 503 Service Unavailable\r\n'
    printf '\r\n'
    printf '%s' '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>孕程记</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fdf7fa;font-family:sans-serif"><div style="max-width:320px;padding:28px 24px;background:#fff;border:1px solid #f1ebf2;border-radius:20px;text-align:center;box-shadow:0 8px 30px rgba(31,23,48,.08)"><div style="font-size:17px;font-weight:600;color:#1f1730">孕程记正在启动</div><div style="margin-top:10px;font-size:13px;color:#5c5275;line-height:1.7">后端服务还没就绪，请稍等几秒后刷新页面。<br>若长时间停留在此页面，请检查应用是否已正常启动。</div></div></body></html>'
    exit 0
}

# socket 已存在 → 直接走；不存在 → 等一会儿，等到了照常转发
if [ ! -S "$SOCKET_PATH" ]; then
    wait_for_socket || serve_unavailable
fi
CURL_OPTS="--unix-socket $SOCKET_PATH"
BASE_URL="http://localhost"

# 从 REQUEST_URI 提取路径
URI_NO_QUERY="${REQUEST_URI%%\?*}"
REL_PATH="/"
case "$URI_NO_QUERY" in
    *index.cgi*) REL_PATH="${URI_NO_QUERY#*index.cgi}" ;;
esac
[ -z "$REL_PATH" ] || [ "$REL_PATH" = "/" ] && REL_PATH="/"

# Query 字符串
QUERY_STRING="${REQUEST_URI##*\?}"
TARGET_URL="${BASE_URL}${REL_PATH}"
[ -n "$QUERY_STRING" ] && [ "$QUERY_STRING" != "$REQUEST_URI" ] && TARGET_URL="${TARGET_URL}?${QUERY_STRING}"

# ---- 请求体转发 ----
# ⚠️ 原来只转发了 Content-Type / Content-Length 两个**头**，却没转发 body 本身。
#    CGI 会把 POST/PUT/PATCH 的请求体写到标准输入；不转发时后端会照 header 里声明的
#    长度一直等 body，表现为「写操作全部卡住/失败」（记体重、传照片、保存设置…）。
#    现在用 --data-binary @- 让 curl 把 stdin 原样读走，长度交给 curl 自己算
#    （不再手动传 Content-Length，避免 header 与真实 body 不一致）。
#    注：统一网关模式（gatewaySocket）下请求直连 Unix Socket，本文件不在关键路径；
#    这里是给走 CGI 入口的场景兜底，两条路都必须是通的。
CURL_BODY_OPTS=""
if [ -n "${CONTENT_LENGTH:-}" ] && [ "${CONTENT_LENGTH}" -gt 0 ] 2>/dev/null; then
    CURL_BODY_OPTS="--data-binary @-"
fi

# 转发请求（含网关认证头）
exec curl -sS \
    $CURL_OPTS \
    --max-time 60 \
    -X "${REQUEST_METHOD:-GET}" \
    -H "Host: localhost" \
    -H "X-Real-IP: ${REMOTE_ADDR:-127.0.0.1}" \
    -H "X-Forwarded-For: ${REMOTE_ADDR:-127.0.0.1}" \
    ${HTTP_X_TRIM_USERID:+-H "X-Trim-Userid: $HTTP_X_TRIM_USERID"} \
    ${HTTP_X_TRIM_ISADMIN:+-H "X-Trim-Isadmin: $HTTP_X_TRIM_ISADMIN"} \
    ${HTTP_X_TRIM_USERNAME:+-H "X-Trim-Username: $HTTP_X_TRIM_USERNAME"} \
    ${CONTENT_TYPE:+-H "Content-Type: $CONTENT_TYPE"} \
    $CURL_BODY_OPTS \
    "${TARGET_URL}"
