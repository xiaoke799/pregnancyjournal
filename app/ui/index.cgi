#!/bin/bash

APPNAME="pregnancy-journal"
BASE_PATH="/var/apps/${APPNAME}/target/www"
NODE_PORT="21039"
NODE_URL="http://127.0.0.1:${NODE_PORT}"

URI_NO_QUERY="${REQUEST_URI%%\?*}"
REL_PATH="/"
case "$URI_NO_QUERY" in
    *index.cgi*) REL_PATH="${URI_NO_QUERY#*index.cgi}" ;; esac
if [ -z "$REL_PATH" ] || [ "$REL_PATH" = "/" ]; then REL_PATH="/index.html"; fi

API_PROXY="/api/"
case "$REL_PATH" in
    ${API_PROXY}*)
        if [ "${REQUEST_METHOD}" = "POST" ]; then
            exec curl -s -S --max-time 30 \
                -X POST \
                -H "Content-Type: ${CONTENT_TYPE:-application/json}" \
                -H "x-user-id: ${HTTP_X_USER_ID:-}" \
                -H "x-username: ${HTTP_X_USERNAME:-}" \
                --data-binary @- \
                "${NODE_URL}${REL_PATH}${QUERY_STRING:+?${QUERY_STRING}}"
        else
            exec curl -s -S --max-time 30 \
                -G \
                -H "x-user-id: ${HTTP_X_USER_ID:-}" \
                -H "x-username: ${HTTP_X_USERNAME:-}" \
                "${NODE_URL}${REL_PATH}${QUERY_STRING:+?${QUERY_STRING}}"
        fi
        ;;
esac

TARGET_FILE="${BASE_PATH}${REL_PATH}"
if echo "$TARGET_FILE" | grep -q '\.\.'; then
    echo "Status: 400 Bad Request"
    echo "Content-Type: text/plain; charset=utf-8"
    echo ""
    echo "Bad Request"
    exit 0
fi
if [ ! -f "$TARGET_FILE" ]; then
    echo "Status: 404 Not Found"
    echo "Content-Type: text/plain; charset=utf-8"
    echo ""
    echo "404 Not Found: ${REL_PATH}"
    exit 0
fi
ext="${TARGET_FILE##*.}"
case "$ext" in
    html|htm) mime="text/html; charset=utf-8" ;;
    css) mime="text/css; charset=utf-8" ;;
    js) mime="application/javascript; charset=utf-8" ;;
    jpg|jpeg) mime="image/jpeg" ;;
    png) mime="image/png" ;;
    gif) mime="image/gif" ;;
    svg) mime="image/svg+xml" ;;
    ico) mime="image/x-icon" ;;
    json) mime="application/json; charset=utf-8" ;;
    txt|log|csv) mime="text/plain; charset=utf-8" ;;
    woff|woff2|ttf|eot) mime="font/*" ;;
    *) mime="application/octet-stream" ;;
esac
echo "Content-Type: $mime"
echo ""
cat "$TARGET_FILE"
