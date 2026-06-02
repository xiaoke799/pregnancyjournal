"""孕程记 - 应用配置 API。"""

import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import get_db
from backend.models.app_config import AppConfig
from backend.models.pregnancy import Pregnancy
from backend.schemas.common import ApiResponse
from backend.schemas.app_config import (
    AppConfigCreate,
    AppConfigUpdate,
    AppConfigResponse,
    SetupWizardData,
)

router = APIRouter()


@router.get("/app-config/setup_status", response_model=ApiResponse)
async def get_setup_status(db: AsyncSession = Depends(get_db)):
    """检查是否已完成初始设置，返回阶段和存储目录。"""
    result = await db.execute(
        select(AppConfig).where(AppConfig.key == "setup_completed")
    )
    setup_flag = result.scalar_one_or_none()
    is_complete = setup_flag is not None and setup_flag.value == "true"

    stage = ""
    storage_dir = ""

    if is_complete:
        result = await db.execute(
            select(AppConfig).where(AppConfig.key == "current_stage")
        )
        stage_flag = result.scalar_one_or_none()
        if stage_flag:
            try:
                stage = json.loads(stage_flag.value).get("stage", "")
            except (json.JSONDecodeError, TypeError):
                pass

        result = await db.execute(
            select(AppConfig).where(AppConfig.key == "storage_dir")
        )
        dir_flag = result.scalar_one_or_none()
        if dir_flag:
            try:
                storage_dir = json.loads(dir_flag.value).get("dir", "")
            except (json.JSONDecodeError, TypeError):
                pass

    return ApiResponse(data={
        "is_setup_complete": is_complete,
        "stage": stage,
        "storage_dir": storage_dir,
    })


@router.get("/app-config/paths", response_model=ApiResponse)
async def get_available_paths():
    """获取可用的存储路径列表（从 TRIM_DATA_SHARE_PATHS 环境变量读取）。"""
    paths: List[dict] = []
    raw = settings.TRIM_DATA_SHARE_PATHS
    if raw:
        for p in raw.split(":"):
            p = p.strip()
            if p:
                paths.append({
                    "path": p,
                    "label": Path(p).name or p,
                    "exists": Path(p).exists() if p else False,
                })
    if not paths:
        default_path = os.path.join(os.path.expanduser("~"), "pregnancy-journal-data")
        paths.append({
            "path": default_path,
            "label": "默认存储目录",
            "exists": Path(default_path).exists(),
        })
    return ApiResponse(data=paths)


@router.get("/app-config/storage_dir", response_model=ApiResponse)
async def get_storage_dir(db: AsyncSession = Depends(get_db)):
    """获取当前存储目录。"""
    result = await db.execute(
        select(AppConfig).where(AppConfig.key == "storage_dir")
    )
    flag = result.scalar_one_or_none()
    if not flag:
        return ApiResponse(code=1001, data=None, message="未配置存储目录")
    try:
        storage_dir = json.loads(flag.value).get("dir", "")
    except (json.JSONDecodeError, TypeError):
        storage_dir = ""
    return ApiResponse(data={"storage_dir": storage_dir})


@router.get("/app-config", response_model=ApiResponse[List[AppConfigResponse]])
async def list_configs(db: AsyncSession = Depends(get_db)):
    """获取全部应用配置。"""
    result = await db.execute(select(AppConfig))
    configs = result.scalars().all()
    return ApiResponse(data=[AppConfigResponse.model_validate(c) for c in configs])


@router.get("/app-config/{key}", response_model=ApiResponse[AppConfigResponse])
async def get_config(key: str, db: AsyncSession = Depends(get_db)):
    """根据键获取应用配置。"""
    result = await db.execute(select(AppConfig).where(AppConfig.key == key))
    config = result.scalar_one_or_none()
    if not config:
        return ApiResponse(code=1001, data=None, message=f"配置项 '{key}' 不存在")
    return ApiResponse(data=AppConfigResponse.model_validate(config))


@router.post("/app-config", response_model=ApiResponse[AppConfigResponse])
async def set_config(data: AppConfigCreate, db: AsyncSession = Depends(get_db)):
    """设置应用配置（存在则更新，不存在则创建）。"""
    now = datetime.now()
    result = await db.execute(select(AppConfig).where(AppConfig.key == data.key))
    config = result.scalar_one_or_none()
    if config:
        config.value = data.value
        config.description = data.description or config.description
        config.updated_at = now
        await db.flush()
        await db.refresh(config)
    else:
        config = AppConfig(
            id=str(uuid.uuid4()),
            key=data.key,
            value=data.value,
            description=data.description,
            updated_at=now,
        )
        db.add(config)
        await db.flush()
        await db.refresh(config)
    return ApiResponse(data=AppConfigResponse.model_validate(config))


@router.post("/app-config/setup", response_model=ApiResponse)
async def setup_wizard(data: SetupWizardData, db: AsyncSession = Depends(get_db)):
    """设置向导（可多次调用，仅更新存储目录/阶段）。"""
    now = datetime.now()

    # 检查是否已完成初始设置
    result = await db.execute(
        select(AppConfig).where(AppConfig.key == "setup_completed")
    )
    setup_flag = result.scalar_one_or_none()
    is_complete = setup_flag is not None and setup_flag.value == "true"

    # 如果传入 storage_dir，验证并创建目录
    if data.storage_dir:
        storage_path = Path(data.storage_dir)
        try:
            storage_path.mkdir(parents=True, exist_ok=True)
            # 创建子目录
            for sub in ["photos", "thumbnails", "media", "backups"]:
                (storage_path / sub).mkdir(parents=True, exist_ok=True)
        except OSError as e:
            return ApiResponse(code=1003, data=None, message=f"无法创建存储目录: {str(e)}")

        # 更新/创建存储目录配置
        result = await db.execute(
            select(AppConfig).where(AppConfig.key == "storage_dir")
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.value = json.dumps({"dir": data.storage_dir})
            existing.updated_at = now
        else:
            db.add(AppConfig(
                id=str(uuid.uuid4()),
                key="storage_dir",
                value=json.dumps({"dir": data.storage_dir}),
                description="存储目录",
                updated_at=now,
            ))

    # 如果传入 stage，更新阶段
    if data.stage:
        result = await db.execute(
            select(AppConfig).where(AppConfig.key == "current_stage")
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.value = json.dumps({"stage": data.stage})
            existing.updated_at = now
        else:
            db.add(AppConfig(
                id=str(uuid.uuid4()),
                key="current_stage",
                value=json.dumps({"stage": data.stage}),
                description="当前孕期阶段",
                updated_at=now,
            ))

    # 如果有预产期信息，创建孕期档案
    if data.due_date and data.last_period_date:
        existing = await db.execute(
            select(Pregnancy).where(Pregnancy.is_active == 1)
        )
        active_pregnancy = existing.scalar_one_or_none()
        if not active_pregnancy:
            pregnancy = Pregnancy(
                id=str(uuid.uuid4()),
                last_period_date=data.last_period_date,
                due_date=data.due_date,
                baby_name=data.baby_name or "",
                is_active=1,
            )
            db.add(pregnancy)

    # 标记设置已完成
    if not is_complete:
        db.add(AppConfig(
            id=str(uuid.uuid4()),
            key="setup_completed",
            value="true",
            description="是否已完成初始设置",
            updated_at=now,
        ))

    await db.flush()
    return ApiResponse(message="设置已保存" if is_complete else "初始设置完成")

@router.post("/app-config/check-path", response_model=ApiResponse)
async def check_path(data: dict):
    """检测路径是否可读写（仅限配置的存储目录）。"""
    path_str = data.get("path", "")
    if not path_str:
        return ApiResponse(code=1004, data=None, message="请输入路径")
    real_path = os.path.realpath(path_str)
    allowed_bases = [
        os.path.realpath(settings.PHOTOS_DIR),
        os.path.realpath(settings.THUMBNAILS_DIR),
        os.path.realpath(settings.BACKUPS_DIR),
        os.path.realpath(settings.MEDIA_DIR),
    ]
    is_allowed = any(real_path.startswith(b + os.sep) or real_path == b for b in allowed_bases)
    if not is_allowed:
        return ApiResponse(code=1003, data=None, message="仅支持检测应用存储目录")
    try:
        p = Path(real_path)
        if p.exists():
            if os.access(str(p), os.R_OK | os.W_OK):
                return ApiResponse(data={"writable": True, "exists": True, "message": "路径可读写"})
            else:
                return ApiResponse(code=1003, data={"writable": False, "exists": True}, message="路径无读写权限，请检查权限设置")
        else:
            parent = p.parent
            if parent.exists() and os.access(str(parent), os.W_OK):
                return ApiResponse(data={"writable": True, "exists": False, "message": "父目录可写，将自动创建子目录"})
            else:
                return ApiResponse(code=1003, data={"writable": False, "exists": False}, message=f"无法创建目录，请确认父目录存在且有写入权限")
    except Exception:
        return ApiResponse(code=2003, data=None, message="路径检测失败")
