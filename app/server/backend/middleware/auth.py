"""孕程记 - 认证中间件。

TCP 端口模式下从 Cookie 提取用户 token，网关模式下从 Header 提取。
本地应用模式下默认允许所有请求（数据隔离由前端实现）。
V1.1: 增加基础安全机制 - IP白名单 + 简单token验证
"""

import logging
import os
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from backend.config import settings

logger = logging.getLogger(__name__)


class AuthMiddleware(BaseHTTPMiddleware):
    """认证中间件，支持网关 Header 和 Cookie token 两种模式。"""

    def __init__(self, app):
        super().__init__(app)
        self._allowed_ips = self._load_allowed_ips()
        self._local_token = os.getenv("LOCAL_AUTH_TOKEN", "")

    @staticmethod
    def _load_allowed_ips() -> set:
        """加载IP白名单（默认允许本地访问）。"""
        ips_str = os.getenv("ALLOWED_IPS", "127.0.0.1,::1,localhost")
        return {ip.strip() for ip in ips_str.split(",") if ip.strip()}

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """处理请求，提取用户信息存入 request.state。"""
        client_ip = request.client.host if request.client else "unknown"

        # 优先从网关 Header 提取（兼容统一网关模式）
        request.state.user_id = request.headers.get(settings.HEADER_USER_ID, "")
        request.state.is_admin = request.headers.get(settings.HEADER_IS_ADMIN, "false")
        request.state.username = request.headers.get(settings.HEADER_USERNAME, "")

        # TCP 端口模式：从 Cookie 提取 token
        if not request.state.user_id:
            token = request.cookies.get("fn_token", "")
            if token:
                if self._local_token and token != self._local_token:
                    logger.warning(f"Invalid token from IP: {client_ip}")
                    return JSONResponse(
                        status_code=401,
                        content={"code": 401, "message": "无效的访问令牌"}
                    )
                request.state.user_id = "local_user"
                request.state.username = "本地用户"

        # 白名单路径不需要认证
        white_list = ["/api/health", "/docs", "/openapi.json", "/redoc"]
        if any(request.url.path.startswith(p) for p in white_list):
            return await call_next(request)

        # 静态文件不需要认证
        if not request.url.path.startswith("/api/"):
            return await call_next(request)

        # 安全检查：V1.1 增加IP白名单验证
        if settings.APP_MODE == "dev" and client_ip not in self._allowed_ips:
            logger.warning(f"Blocked unauthorized access from IP: {client_ip}")
            return JSONResponse(
                status_code=403,
                content={"code": 403, "message": "访问被拒绝：IP不在白名单中"}
            )

        # 兜底：未认证请求赋予本地用户身份（保持向后兼容）
        if not request.state.user_id:
            request.state.user_id = "local_user"
            request.state.username = "本地用户"
            logger.debug(f"Granting local_user access to IP: {client_ip}")

        return await call_next(request)
