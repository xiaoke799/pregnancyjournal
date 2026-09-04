#!/bin/bash
# 孕程记 - 统一网关模式（Unix Socket 代理）
# 将 CGI 请求转发到 Unix Socket 上的 Node.js 服务

SOCKET_PATH="${TRIM_APPDEST}/app.sock"
PORT="${TRIM_SERVICE_PORT:-3867}"

# 确定目标：Unix Socket（网关模式）或 TCP（兼容模式）
if [ -S "$SOCKET_PATH" ]; then
    CURL_OPTS="--unix-socket $SOCKET_PATH"
    BASE_URL="http://localhost"
else
    CURL_OPTS=""
    BASE_URL="http://127.0.0.1:${PORT}"
fi

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
    ${CONTENT_LENGTH:+-H "Content-Length: $CONTENT_LENGTH"} \
    "${TARGET_URL}"
