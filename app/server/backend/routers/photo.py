"""孕程记 - 照片/视频管理 API。"""

import logging
import os
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.photo import PregnancyPhoto
from backend.schemas.common import ApiResponse
from backend.schemas.photo import PhotoCreate, PhotoUpdate, PhotoResponse
from backend.services.photo_processor import photo_processor
from backend.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

# 照片/视频允许更新的字段白名单（防止恶意修改id、created_at、file_path等关键字段）
PHOTO_ALLOWED_UPDATE_FIELDS = {
    "photo_type", "gestational_week", "gestational_day",
    "milestone_type", "note", "checkup_id"
}

VIDEO_EXTENSIONS = {
    "mp4", "webm", "mov", "avi", "ogg", "mkv", "flv", "wmv", "m4v",
    "3gp", "3g2", "mts", "m2ts", "ts", "vob", "rm", "rmvb", "asf",
}


def _is_video(filename: str, content_type: Optional[str] = None) -> bool:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in VIDEO_EXTENSIONS:
        return True
    if content_type and content_type.startswith("video/"):
        return True
    return False


@router.post("/photos", response_model=ApiResponse[PhotoResponse])
async def upload_photo(
    pregnancy_id: str = Form(...),
    photo_type: str = Form(...),
    gestational_week: Optional[int] = Form(None),
    gestational_day: Optional[int] = Form(0),
    milestone_type: Optional[str] = Form(None),
    checkup_id: Optional[str] = Form(None),
    note: Optional[str] = Form(None),
    media_type: Optional[str] = Form("photo"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """上传照片或视频。

    完整保留原文件，不做任何压缩或格式转换。
    仅生成单独的缩略图文件用于列表预览。
    图片限 200MB，视频限 2GB。
    """
    is_video = _is_video(file.filename or "", file.content_type)
    ext = photo_processor.get_image_extension(file.filename or "image.jpg")

    if is_video:
        file_path = photo_processor.generate_video_file_path(photo_type, gestational_week, ext)
    else:
        file_path = photo_processor.generate_file_path(photo_type, gestational_week, ext)
    os.makedirs(os.path.dirname(file_path), exist_ok=True)

    max_size = settings.MAX_VIDEO_UPLOAD_SIZE if is_video else settings.MAX_UPLOAD_SIZE
    size_mb = max_size // (1024 * 1024)
    written = 0
    try:
        with open(file_path, "wb") as out_f:
            while True:
                chunk = await file.read(65536)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_size:
                    out_f.close()
                    try:
                        os.remove(file_path)
                    except OSError:
                        pass
                    return ApiResponse(code=1004, data=None, message=f"文件大小超过{size_mb}MB限制")
                out_f.write(chunk)
    except Exception as e:
        logger.error(f"File upload failed: {str(e)}", exc_info=True)
        try:
            os.remove(file_path)
        except OSError:
            pass
        return ApiResponse(code=2003, data=None, message="文件保存失败，请稍后重试")

    thumb_path = ""
    if is_video:
        filename = os.path.basename(file_path)
        thumb_path = photo_processor.generate_thumbnail_path(photo_type, gestational_week, filename)
        await photo_processor.create_video_thumbnail(file_path, thumb_path)
        actual_media_type = "video"
    else:
        filename = os.path.basename(file_path)
        thumb_path = photo_processor.generate_thumbnail_path(photo_type, gestational_week, filename)
        await photo_processor.create_thumbnail(file_path, thumb_path)
        actual_media_type = "photo"

    photo = PregnancyPhoto(
        pregnancy_id=pregnancy_id,
        checkup_id=checkup_id,
        photo_type=photo_type,
        gestational_week=gestational_week,
        gestational_day=gestational_day or 0,
        milestone_type=milestone_type,
        file_path=file_path,
        thumbnail_path=thumb_path,
        note=note,
        media_type=actual_media_type,
    )
    db.add(photo)
    await db.flush()
    await db.refresh(photo)
    return ApiResponse(data=PhotoResponse.model_validate(photo))


@router.get("/photos", response_model=ApiResponse[List[PhotoResponse]])
async def list_photos(
    pregnancy_id: str,
    photo_type: Optional[str] = None,
    gestational_week: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
):
    """照片/视频列表（按 type/gestational_week 筛选，按时间倒序）。"""
    query = select(PregnancyPhoto).where(PregnancyPhoto.pregnancy_id == pregnancy_id)
    if photo_type:
        query = query.where(PregnancyPhoto.photo_type == photo_type)
    if gestational_week is not None:
        query = query.where(PregnancyPhoto.gestational_week == gestational_week)
    query = query.order_by(PregnancyPhoto.created_at.desc())
    result = await db.execute(query)
    photos = result.scalars().all()
    return ApiResponse(data=[PhotoResponse.model_validate(p) for p in photos])


@router.get("/photos/{photo_id}", response_model=ApiResponse[PhotoResponse])
async def get_photo(photo_id: str, db: AsyncSession = Depends(get_db)):
    """照片/视频详情。"""
    photo = await db.get(PregnancyPhoto, photo_id)
    if not photo:
        return ApiResponse(code=1001, data=None, message="照片不存在")
    return ApiResponse(data=PhotoResponse.model_validate(photo))


@router.put("/photos/{photo_id}", response_model=ApiResponse[PhotoResponse])
async def update_photo(photo_id: str, data: PhotoUpdate, db: AsyncSession = Depends(get_db)):
    """更新照片/视频信息。"""
    photo = await db.get(PregnancyPhoto, photo_id)
    if not photo:
        return ApiResponse(code=1001, data=None, message="照片不存在")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key in PHOTO_ALLOWED_UPDATE_FIELDS:
            setattr(photo, key, value)
    await db.flush()
    await db.refresh(photo)
    return ApiResponse(data=PhotoResponse.model_validate(photo))


@router.delete("/photos/{photo_id}", response_model=ApiResponse)
async def delete_photo(photo_id: str, db: AsyncSession = Depends(get_db)):
    """删除照片/视频。"""
    photo = await db.get(PregnancyPhoto, photo_id)
    if not photo:
        return ApiResponse(code=1001, data=None, message="照片不存在")
    photo_processor.delete_photo_files(photo.file_path, photo.thumbnail_path)
    await db.delete(photo)
    return ApiResponse(message="删除成功")


@router.get("/photos/{photo_id}/file")
async def get_photo_file(photo_id: str, db: AsyncSession = Depends(get_db)):
    """获取照片原图或视频文件。"""
    photo = await db.get(PregnancyPhoto, photo_id)
    if not photo or not os.path.exists(photo.file_path):
        return ApiResponse(code=1001, data=None, message="文件不存在")

    real_path = Path(photo.file_path).resolve()
    allowed_dir = Path(settings.PHOTOS_DIR).resolve()

    if not real_path.is_relative_to(allowed_dir):
        logger.warning(f"Path traversal attempt detected: {photo.file_path}")
        return ApiResponse(code=1003, data=None, message="非法文件路径")

    return FileResponse(str(real_path))


@router.get("/photos/{photo_id}/thumbnail")
async def get_photo_thumbnail(photo_id: str, db: AsyncSession = Depends(get_db)):
    """获取缩略图。"""
    photo = await db.get(PregnancyPhoto, photo_id)
    thumb_path = photo.thumbnail_path if photo else None
    if not thumb_path or not os.path.exists(thumb_path):
        if photo and os.path.exists(photo.file_path):
            real_path = Path(photo.file_path).resolve()
            allowed_dir = Path(settings.PHOTOS_DIR).resolve()
            if real_path.is_relative_to(allowed_dir):
                return FileResponse(str(real_path))
            return ApiResponse(code=1003, data=None, message="非法文件路径")
        return ApiResponse(code=1001, data=None, message="缩略图不存在")

    real_thumb_path = Path(thumb_path).resolve()
    allowed_thumb_dir = Path(settings.THUMBNAILS_DIR).resolve()
    if not real_thumb_path.is_relative_to(allowed_thumb_dir):
        logger.warning(f"Thumbnail path traversal attempt: {thumb_path}")
        return ApiResponse(code=1003, data=None, message="非法文件路径")

    return FileResponse(str(real_thumb_path))
