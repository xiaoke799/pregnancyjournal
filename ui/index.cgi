#!/bin/bash

# 孕程记 CGI 入口脚本
# 将所有请求转发到本地 Node.js 服务 (端口 3867)

PORT="${TRIM_SERVICE_PORT:-3867}"
BASE_URL="http://127.0.0.1:${PORT}"

# 从 REQUEST_URI 提取 index.cgi 后面的路径
URI_NO_QUERY="${REQUEST_URI%%\?*}"
QUERY_STRING="${REQUEST_URI##*\?}"

# 默认路径
REL_PATH="/"

# 用 index.cgi 作为切割点，取后面的部分
case "$URI_NO_QUERY" in
    *index.cgi*)
        REL_PATH="${URI_NO_QUERY#*index.cgi}"
        ;;
esac

# 如果为空或只有 /，默认 /
if [ -z "$REL_PATH" ] || [ "$REL_PATH" = "/" ]; then
    REL_PATH="/"
fi

# 构建目标 URL
TARGET_URL="${BASE_URL}${REL_PATH}"
if [ -n "$QUERY_STRING" ] && [ "$QUERY_STRING" != "$REQUEST_URI" ]; then
    TARGET_URL="${TARGET_URL}?${QUERY_STRING}"
fi

# 转发请求到 Node.js 服务
exec curl -sS \
    --max-time 30 \
    -H "Host: 127.0.0.1:${PORT}" \
    -H "X-Forwarded-For: ${REMOTE_ADDR:-127.0.0.1}" \
    -H "X-Forwarded-Proto: ${HTTPS:-http}" \
    -H "X-Real-IP: ${REMOTE_ADDR:-127.0.0.1}" \
    "${TARGET_URL}"
