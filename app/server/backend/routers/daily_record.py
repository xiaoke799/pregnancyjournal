"""孕程记 - 每日记录 API。"""

import logging
import os
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.daily_record import DailyRecord
from backend.schemas.common import ApiResponse
from backend.schemas.daily_record import DailyRecordCreate, DailyRecordUpdate, DailyRecordResponse
from backend.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()


# ========== 日记图片上传 ==========

# 日记图片存储目录
DIARY_IMAGES_DIR = os.path.join(settings.PHOTOS_DIR, "diary")

# 允许的上传类型前缀
ALLOWED_DIARY_UPLOAD_PREFIXES = ("image/", "video/")
# 最大上传大小 500MB
MAX_DIARY_UPLOAD_SIZE = 500 * 1024 * 1024

# 允许的文件扩展名白名单（用于双重验证）
ALLOWED_EXTENSIONS = {
    # 图片格式
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg",
    # 视频格式
    ".mp4", ".webm", ".mov", ".avi", ".mkv"
}


@router.post("/daily-records/diary-image", response_model=ApiResponse)
async def upload_diary_image(file: UploadFile = File(...)):
    """上传日记中的图片，返回图片 URL。

    图片保存到 PHOTOS_DIR/diary/ 子目录。
    返回格式：{url: "/api/v1/daily-records/diary/{filename}"}
    """
    # 验证文件类型（双重验证：content_type + 扩展名）
    ct = file.content_type or ""
    if not any(ct.startswith(p) for p in ALLOWED_DIARY_UPLOAD_PREFIXES):
        return ApiResponse(code=1004, data=None, message="不支持的文件格式，支持所有图片和视频格式")

    # 验证文件扩展名
    safe_filename = os.path.basename(file.filename or "upload.bin")
    ext = os.path.splitext(safe_filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return ApiResponse(code=1004, data=None, message=f"不支持的文件扩展名: {ext}，允许的扩展名: {', '.join(ALLOWED_EXTENSIONS)}")

    # 读取文件内容
    content = await file.read()

    # 验证文件大小（500MB）
    size_mb = MAX_DIARY_UPLOAD_SIZE // (1024 * 1024)
    if len(content) > MAX_DIARY_UPLOAD_SIZE:
        return ApiResponse(code=1004, data=None, message=f"文件大小不能超过 {size_mb}MB")

    # 生成文件名（使用 basename 防止路径遍历）
    safe_filename = os.path.basename(file.filename or "upload.bin")
    ext = os.path.splitext(safe_filename)[1].lower().lstrip(".") or "bin"
    filename = f"{uuid.uuid4()}.{ext}"

    # 确保目录存在
    os.makedirs(DIARY_IMAGES_DIR, exist_ok=True)

    # 保存文件
    file_path = os.path.join(DIARY_IMAGES_DIR, filename)
    with open(file_path, "wb") as f:
        f.write(content)

    # 返回访问 URL
    url = f"/api/v1/daily-records/diary/{filename}"
    return ApiResponse(data={"url": url})


@router.get("/daily-records/diary/{filename}")
async def get_diary_image(filename: str):
    """提供日记图片的静态文件服务。"""
    file_path = os.path.join(DIARY_IMAGES_DIR, filename)
    if not os.path.exists(file_path):
        return ApiResponse(code=1001, data=None, message="图片不存在")

    # 安全检查：防止路径遍历
    real_path = os.path.realpath(file_path)
    real_dir = os.path.realpath(DIARY_IMAGES_DIR)
    if not real_path.startswith(real_dir):
        return ApiResponse(code=1003, data=None, message="非法路径")

    return FileResponse(file_path)


# ========== 每日记录 CRUD ==========

@router.post("/daily-records", response_model=ApiResponse[DailyRecordResponse])
async def create_or_update_daily_record(data: DailyRecordCreate, db: AsyncSession = Depends(get_db)):
    """创建/更新每日记录（按日期 upsert）。

    优化：使用 expire_on_commit=False 配置，flush 后无需 refresh 即可访问对象属性，
    省去一次额外的 SELECT 查询。
    """
    result = await db.execute(
        select(DailyRecord).where(
            DailyRecord.pregnancy_id == data.pregnancy_id,
            DailyRecord.record_date == data.record_date,
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        update_data = data.model_dump(exclude_unset=True, exclude={"pregnancy_id", "record_date"})
        for key, value in update_data.items():
            if value is not None:
                setattr(existing, key, value)
        await db.flush()
        return ApiResponse(data=DailyRecordResponse.model_validate(existing))

    record = DailyRecord(**data.model_dump())
    db.add(record)
    await db.flush()
    return ApiResponse(data=DailyRecordResponse.model_validate(record))


@router.get("/daily-records", response_model=ApiResponse)
async def list_daily_records(
    pregnancy_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """每日记录列表（分页+日期范围筛选）。"""
    query = select(DailyRecord).where(DailyRecord.pregnancy_id == pregnancy_id)
    if start_date:
        query = query.where(DailyRecord.record_date >= start_date)
    if end_date:
        query = query.where(DailyRecord.record_date <= end_date)
    query = query.order_by(DailyRecord.record_date.desc())

    # SQL 层面分页
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.scalar(count_query) or 0
    offset = (page - 1) * page_size
    result = await db.execute(query.offset(offset).limit(page_size))
    items = result.scalars().all()

    return ApiResponse(data={
        "items": [DailyRecordResponse.model_validate(r) for r in items],
        "total": total, "page": page, "page_size": page_size,
    })


@router.get("/daily-records/{record_date}", response_model=ApiResponse[DailyRecordResponse])
async def get_daily_record_by_date(
    record_date: str,
    pregnancy_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """获取指定日期记录。"""
    result = await db.execute(
        select(DailyRecord).where(
            DailyRecord.pregnancy_id == pregnancy_id,
            DailyRecord.record_date == record_date,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        return ApiResponse(code=1001, data=None, message="该日期无记录")
    return ApiResponse(data=DailyRecordResponse.model_validate(record))


@router.put("/daily-records/{record_id}", response_model=ApiResponse[DailyRecordResponse])
async def update_daily_record(record_id: str, data: DailyRecordUpdate, db: AsyncSession = Depends(get_db)):
    """更新每日记录（优化：省去不必要的 refresh）。"""
    record = await db.get(DailyRecord, record_id)
    if not record:
        return ApiResponse(code=1001, data=None, message="记录不存在")
    for key, value in data.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(record, key, value)
    await db.flush()
    return ApiResponse(data=DailyRecordResponse.model_validate(record))


@router.delete("/daily-records/{record_id}", response_model=ApiResponse)
async def delete_daily_record(record_id: str, db: AsyncSession = Depends(get_db)):
    """删除每日记录。"""
    record = await db.get(DailyRecord, record_id)
    if not record:
        return ApiResponse(code=1001, data=None, message="记录不存在")
    await db.delete(record)
    return ApiResponse(message="删除成功")
