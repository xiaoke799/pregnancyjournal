#!/bin/bash

APPNAME="pregnancy-journal"
LOG_FILE="/var/lib/fnos/data/packages/${APPNAME}/info.log"
PID_FILE="/var/lib/fnos/data/packages/${APPNAME}/app.pid"
UPDATE_LOG_FILE="/var/lib/fnos/data/packages/${APPNAME}/update.log"
UPDATE_PID_FILE="/var/lib/fnos/data/packages/${APPNAME}/update.pid"
NODE_BIN="/var/apps/nodejs_v22/target/bin"

GITHUB_REPO="xiaoke799/pregnancy-journal"
GITEE_REPO="xiaoke799/pregnancy-journal"

mkdir -p "$(dirname "${LOG_FILE}")"

check_process() {
    local pid=$1
    if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
        return 0
    else
        return 1
    fi
}

get_status() {
    local running=false
    local pid=""
    local version="0.0.4"
    local start_at="null"

    if [ -f "${PID_FILE}" ]; then
        pid=$(head -n 1 "${PID_FILE}" | tr -d '[:space:]')
        if check_process "${pid}"; then
            running=true
            if command -v stat &>/dev/null; then
                start_at=$(stat -c %Y "${PID_FILE}" 2>/dev/null || echo "null")
            fi
        else
            rm -f "${PID_FILE}"
            pid=""
        fi
    fi

    echo "Content-Type: application/json"
    echo ""
    echo "{\"success\":true,\"running\":${running},\"pid\":\"${pid}\",\"startAt\":${start_at},\"version\":\"${version}\"}"
}

status() { get_status; }

start_service() {
    if [ "$REQUEST_METHOD" != "POST" ]; then
        echo "Content-Type: application/json"
        echo ""
        echo "{\"success\":false,\"message\":\"仅支持 POST 请求\"}"
        exit 0
    fi

    if [ -f "${PID_FILE}" ]; then
        local pid=$(head -n 1 "${PID_FILE}" | tr -d '[:space:]')
        if check_process "${pid}"; then
            echo "Content-Type: application/json"
            echo ""
            echo "{\"success\":true,\"message\":\"孕程记已在运行\"}"
            exit 0
        else
            rm -f "${PID_FILE}"
        fi
    fi

    export PATH="${NODE_BIN}:${PATH}"
    local cmd="cd /var/apps/${APPNAME}/target/server/node && DATABASE_PATH=/var/lib/fnos/data/packages/${APPNAME}/pregnancy-journal.db DATA_DIR=/vol1/shares/${APPNAME}/data PHOTOS_DIR=/vol1/shares/${APPNAME}/photos STATIC_DIR=/var/apps/${APPNAME}/target/app/ui TRIM_SERVICE_PORT=21039 APP_MODE=fnos node server.js"
    nohup bash -c "${cmd}" >> "${LOG_FILE}" 2>&1 &
    echo $! > "${PID_FILE}"

    sleep 2
    if check_process "$(cat "${PID_FILE}" 2>/dev/null)"; then
        echo "Content-Type: application/json"
        echo ""
        echo "{\"success\":true,\"message\":\"孕程记启动成功\"}"
    else
        echo "Content-Type: application/json"
        echo ""
        echo "{\"success\":false,\"message\":\"启动失败，请查看日志\"}"
    fi
}

stop_service() {
    if [ "$REQUEST_METHOD" != "POST" ]; then
        echo "Content-Type: application/json"
        echo ""
        echo "{\"success\":false,\"message\":\"仅支持 POST 请求\"}"
        exit 0
    fi

    if [ -f "${PID_FILE}" ]; then
        local pid=$(head -n 1 "${PID_FILE}" | tr -d '[:space:]')
        if check_process "${pid}"; then
            kill -TERM "${pid}"
            local count=0
            while check_process "${pid}" && [ $count -lt 10 ]; do
                sleep 1
                count=$((count + 1))
            done
            if check_process "${pid}"; then
                kill -KILL "${pid}"
                sleep 1
            fi
            rm -f "${PID_FILE}"
            echo "Content-Type: application/json"
            echo ""
            echo "{\"success\":true,\"message\":\"孕程记已停止\"}"
        else
            rm -f "${PID_FILE}"
            echo "Content-Type: application/json"
            echo ""
            echo "{\"success\":true,\"message\":\"孕程记未在运行\"}"
        fi
    else
        echo "Content-Type: application/json"
        echo ""
        echo "{\"success\":true,\"message\":\"孕程记未在运行\"}"
    fi
}

get_update_status() {
    local updating=false
    if [ -f "${UPDATE_PID_FILE}" ]; then
        local upid=$(head -n 1 "${UPDATE_PID_FILE}" | tr -d '[:space:]')
        if check_process "${upid}"; then
            updating=true
        else
            rm -f "${UPDATE_PID_FILE}"
        fi
    fi
    echo "Content-Type: application/json"
    echo ""
    echo "{\"success\":true,\"updating\":${updating}}"
}

check_update() {
    local latest_version=""
    local source=""
    local download_url=""

    local api_response=$(curl -s --connect-timeout 10 --max-time 15 "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" 2>/dev/null)
    if [ -n "${api_response}" ]; then
        latest_version=$(echo "${api_response}" | grep -o '"tag_name":"[^"]*"' | head -1 | sed 's/"tag_name":"//;s/"//')
        download_url=$(echo "${api_response}" | grep -o '"browser_download_url":"[^"]*\.fpk"' | head -1 | sed 's/"browser_download_url":"//;s/"//')
        source="github"
    fi

    if [ -z "${latest_version}" ]; then
        api_response=$(curl -s --connect-timeout 10 --max-time 15 "https://gitee.com/api/v5/repos/${GITEE_REPO}/releases/latest" 2>/dev/null)
        if [ -n "${api_response}" ]; then
            latest_version=$(echo "${api_response}" | grep -o '"tag_name":"[^"]*"' | head -1 | sed 's/"tag_name":"//;s/"//')
            download_url=$(echo "${api_response}" | grep -o '"browser_download_url":"[^"]*\.fpk"' | head -1 | sed 's/"browser_download_url":"//;s/"//')
            source="gitee"
        fi
    fi

    local has_update="false"
    local current="0.0.4"
    if [ -n "${latest_version}" ] && [ "${latest_version}" != "${current}" ]; then
        has_update="true"
    fi

    echo "Content-Type: application/json"
    echo ""
    echo "{\"success\":true,\"has_update\":${has_update},\"current_version\":\"${current}\",\"latest_version\":\"${latest_version:-未知}\",\"source\":\"${source}\",\"download_url\":\"${download_url}\"}"
}

do_update() {
    if [ "$REQUEST_METHOD" != "POST" ]; then
        echo "Content-Type: application/json"
        echo ""
        echo "{\"success\":false,\"message\":\"仅支持 POST 请求\"}"
        exit 0
    fi

    if [ -f "${UPDATE_PID_FILE}" ]; then
        local upid=$(head -n 1 "${UPDATE_PID_FILE}" | tr -d '[:space:]')
        if check_process "${upid}"; then
            echo "Content-Type: application/json"
            echo ""
            echo "{\"success\":false,\"message\":\"更新正在进行中\"}"
            exit 0
        fi
    fi

    local mirror=""
    if echo "$QUERY_STRING$REQUEST_URI" | grep -q "mirror="; then
        mirror=$(echo "$QUERY_STRING$REQUEST_URI" | sed 's/.*mirror=\([^&]*\).*/\1/')
    fi

    > "${UPDATE_LOG_FILE}"

    nohup bash -c "
        echo '=== 孕程记更新开始 ===' >> ${UPDATE_LOG_FILE}
        echo '时间: \$(date)' >> ${UPDATE_LOG_FILE}
        echo '' >> ${UPDATE_LOG_FILE}

        echo '[1/3] 下载最新版本...' >> ${UPDATE_LOG_FILE}
        DOWNLOAD_DIR=\"/tmp/pregnancy-journal-update\"
        rm -rf \${DOWNLOAD_DIR}
        mkdir -p \${DOWNLOAD_DIR}

        GITHUB_REPO=\"${GITHUB_REPO}\"
        GITEE_REPO=\"${GITEE_REPO}\"

        LATEST_URL=\$(curl -s --connect-timeout 10 \"https://api.github.com/repos/\${GITHUB_REPO}/releases/latest\" | grep -o '\"browser_download_url\":\"[^\"]*\\.fpk\"' | head -1 | sed 's/\"browser_download_url\":\"//;s/\"//')
        SOURCE=\"github\"

        if [ -z \"\${LATEST_URL}\" ]; then
            LATEST_URL=\$(curl -s --connect-timeout 10 \"https://gitee.com/api/v5/repos/\${GITEE_REPO}/releases/latest\" | grep -o '\"browser_download_url\":\"[^\"]*\\.fpk\"' | head -1 | sed 's/\"browser_download_url\":\"//;s/\"//')
            SOURCE=\"gitee\"
        fi

        if [ -z \"\${LATEST_URL}\" ]; then
            echo '❌ 无法获取更新地址' >> ${UPDATE_LOG_FILE}
            rm -f ${UPDATE_PID_FILE}
            exit 1
        fi

        echo \"下载源: \${SOURCE}\" >> ${UPDATE_LOG_FILE}
        echo \"URL: \${LATEST_URL}\" >> ${UPDATE_LOG_FILE}

        curl -L --connect-timeout 30 --max-time 300 -o \"\${DOWNLOAD_DIR}/update.fpk\" \"\${LATEST_URL}\" 2>> ${UPDATE_LOG_FILE}
        if [ \$? -ne 0 ]; then
            echo '❌ 下载失败' >> ${UPDATE_LOG_FILE}
            rm -f ${UPDATE_PID_FILE}
            exit 1
        fi
        echo '✅ 下载完成' >> ${UPDATE_LOG_FILE}

        echo '' >> ${UPDATE_LOG_FILE}
        echo '[2/3] 停止服务...' >> ${UPDATE_LOG_FILE}
        if [ -f \"${PID_FILE}\" ]; then
            PID=\$(cat \"${PID_FILE}\" | tr -d '[:space:]')
            if kill -0 \"\${PID}\" 2>/dev/null; then
                kill -TERM \"\${PID}\"
                sleep 3
                kill -0 \"\${PID}\" 2>/dev/null && kill -KILL \"\${PID}\"
            fi
            rm -f \"${PID_FILE}\"
        fi
        echo '✅ 服务已停止' >> ${UPDATE_LOG_FILE}

        echo '' >> ${UPDATE_LOG_FILE}
        echo '[3/3] 请手动安装更新包...' >> ${UPDATE_LOG_FILE}
        echo \"下载的文件: \${DOWNLOAD_DIR}/update.fpk\" >> ${UPDATE_LOG_FILE}
        echo '更新包已下载到服务器，请在飞牛应用中心手动安装' >> ${UPDATE_LOG_FILE}
        echo '' >> ${UPDATE_LOG_FILE}
        echo '=== 更新完成 ===' >> ${UPDATE_LOG_FILE}

        rm -f ${UPDATE_PID_FILE}
    " &
    echo $! > "${UPDATE_PID_FILE}"

    sleep 1
    echo "Content-Type: application/json"
    echo ""
    echo "{\"success\":true,\"message\":\"更新已开始，请查看日志\"}"
}

get_update_logs() {
    local output=""
    if [ -f "${UPDATE_LOG_FILE}" ]; then
        output=$(tail -200 "${UPDATE_LOG_FILE}" | sed 's/\\/\\\\/g; s/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
    fi
    echo "Content-Type: application/json"
    echo ""
    echo "{\"success\":true,\"logs\":\"${output}\"}"
}

get_logs() {
    local output=""
    if [ -f "${LOG_FILE}" ]; then
        output=$(tail -100 "${LOG_FILE}" | sed 's/\\/\\\\/g; s/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
    fi
    echo "Content-Type: application/json"
    echo ""
    echo "{\"success\":true,\"logs\":\"${output}\"}"
}

clear_logs() {
    if [ "$REQUEST_METHOD" != "POST" ]; then
        echo "Content-Type: application/json"
        echo ""
        echo "{\"success\":false,\"message\":\"仅支持 POST 请求\"}"
        exit 0
    fi
    > "${LOG_FILE}"
    > "${UPDATE_LOG_FILE}"
    echo "Content-Type: application/json"
    echo ""
    echo "{\"success\":true,\"message\":\"日志已清空\"}"
}

action=""

if [ -n "$QUERY_STRING" ]; then
    case "$QUERY_STRING" in
        *action=status*) action="status" ;;
        *action=start*) action="start" ;;
        *action=stop*) action="stop" ;;
        *action=check_update*) action="check_update" ;;
        *action=update*) action="do_update" ;;
        *action=update_status*) action="update_status" ;;
        *action=update_logs*) action="update_logs" ;;
        *action=logs*) action="logs" ;;
        *action=clear_logs*) action="clear_logs" ;;
    esac
fi

if [ -z "$action" ] && [ -n "$REQUEST_URI" ]; then
    case "$REQUEST_URI" in
        *action=status*) action="status" ;;
        *action=start*) action="start" ;;
        *action=stop*) action="stop" ;;
        *action=check_update*) action="check_update" ;;
        *action=update*) action="do_update" ;;
        *action=update_status*) action="update_status" ;;
        *action=update_logs*) action="update_logs" ;;
        *action=logs*) action="logs" ;;
        *action=clear_logs*) action="clear_logs" ;;
    esac
fi

case "$action" in
    status) status ;;
    start) start_service ;;
    stop) stop_service ;;
    check_update) check_update ;;
    do_update) do_update ;;
    update_status) get_update_status ;;
    update_logs) get_update_logs ;;
    logs) get_logs ;;
    clear_logs) clear_logs ;;
    *)
        echo "Content-Type: application/json"
        echo ""
        echo "{\"success\":false,\"message\":\"无效的操作\"}"
        ;;
esac
