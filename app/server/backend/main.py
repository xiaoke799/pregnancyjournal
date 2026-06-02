"""孕程记 - FastAPI 应用入口。

挂载路由、CORS、静态文件服务，配置应用生命周期事件。
TCP 端口模式：直接监听 0.0.0.0:PORT，飞牛中继代理访问。
"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from backend.config import settings
from backend.database import close_db, init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理：启动时初始化数据库，关闭时释放资源。"""
    await init_db()
    yield
    await close_db()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="数据私有、功能纯粹的孕期管理应用",
    lifespan=lifespan,
)

# CORS 配置 — 仅在开发模式下启用（Vite dev server 端口不同）
if settings.APP_MODE == "dev":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# 飞牛网关认证中间件
from backend.middleware.auth import AuthMiddleware  # noqa: E402
app.add_middleware(AuthMiddleware)

# 注册路由
from backend.routers import (  # noqa: E402
    pregnancy,
    checkup,
    lab_result,
    daily_record,
    contraction,
    photo,
    diary,
    checklist,
    reminder,
    fetal_movement,
    reference,
    dashboard,
    export,
    habit_checkin,
    supplement_checkin,
    app_config,
    diet,
    checkup_schedule,
)

# 可选路由（依赖可能缺失的第三方包）
_optional_routers = []
for _name in ("web_push", "wecom"):
    try:
        _mod = __import__(f"backend.routers.{_name}", fromlist=["router"])
        _optional_routers.append((_name, _mod.router))
    except Exception:
        pass

app.include_router(pregnancy.router, prefix="/api/v1", tags=["孕期档案"])
app.include_router(checkup.router, prefix="/api/v1", tags=["产检记录"])
app.include_router(lab_result.router, prefix="/api/v1", tags=["检查指标"])
app.include_router(daily_record.router, prefix="/api/v1", tags=["每日记录"])
app.include_router(contraction.router, prefix="/api/v1", tags=["宫缩计时"])
app.include_router(photo.router, prefix="/api/v1", tags=["照片管理"])
app.include_router(diary.router, prefix="/api/v1", tags=["日记"])
app.include_router(checklist.router, prefix="/api/v1", tags=["清单"])
app.include_router(reminder.router, prefix="/api/v1", tags=["提醒"])
app.include_router(fetal_movement.router, prefix="/api/v1", tags=["胎动计数"])
app.include_router(reference.router, prefix="/api/v1", tags=["参考数据"])
app.include_router(dashboard.router, prefix="/api/v1", tags=["首页概览"])
app.include_router(export.router, prefix="/api/v1", tags=["数据导出"])
app.include_router(habit_checkin.router, prefix="/api/v1", tags=["好习惯打卡"])
app.include_router(supplement_checkin.router, prefix="/api/v1", tags=["营养补充打卡"])
app.include_router(app_config.router, prefix="/api/v1", tags=["应用配置"])
app.include_router(diet.router, prefix="/api/v1", tags=["饮食"])
app.include_router(checkup_schedule.router, prefix="/api/v1", tags=["产检时间表"])

for _tag_name, _router in _optional_routers:
    _tags = {"web_push": "推送通知", "wecom": "企业微信"}
    app.include_router(_router, prefix="/api/v1", tags=[_tags.get(_tag_name, _tag_name)])


# 健康检查端点
@app.get("/api/health", tags=["健康检查"])
async def health_check():
    """服务健康检查端点。"""
    return {"status": "ok", "version": settings.APP_VERSION}


# SPA 前端路由支持 — 所有非 API 请求返回 index.html
static_dir = Path(settings.STATIC_DIR)

if static_dir.exists():
    # 挂载静态资源（CSS/JS/图片等）
    app.mount("/assets", StaticFiles(directory=str(static_dir / "assets")), name="assets")

    # 尝试挂载其他静态子目录
    for subdir in static_dir.iterdir():
        if subdir.is_dir() and subdir.name != "assets":
            try:
                app.mount(
                    f"/{subdir.name}",
                    StaticFiles(directory=str(subdir)),
                    name=f"static-{subdir.name}",
                )
            except Exception:
                pass

    # SPA fallback：非 API 路径返回 index.html
    @app.get("/{path:path}", include_in_schema=False)
    async def serve_spa(request: Request, path: str):
        """SPA 前端路由 fallback。"""
        # 如果请求的是具体文件且存在，直接返回
        file_path = static_dir / path
        if path and file_path.is_file() and file_path.resolve().is_relative_to(static_dir.resolve()):
            return FileResponse(str(file_path))
        # 否则返回 index.html（让前端路由处理）
        index_path = static_dir / "index.html"
        if index_path.exists():
            return FileResponse(str(index_path))
        return HTMLResponse("<h1>孕程记</h1><p>前端未构建，请先执行 npm run build</p>", status_code=404)
