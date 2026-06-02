"""孕程记 - 产检记录 API（含自定义产检、报告上传）。"""

import json
import os
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import FileResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.checkup import PrenatalCheckup, CheckupPhoto, CustomCheckup, CheckupReport
from backend.schemas.common import ApiResponse
from backend.schemas.checkup import (
    CheckupCreate, CheckupUpdate, CheckupResponse, CheckupPhotoResponse,
    CustomCheckupCreate, CustomCheckupUpdate, CustomCheckupResponse,
    CheckupReportResponse,
)
from backend.services.photo_processor import photo_processor
from backend.config import settings

router = APIRouter()

# 产检记录允许更新的字段白名单（防止恶意修改id、created_at等关键字段）
CHECKUP_ALLOWED_UPDATE_FIELDS = {
    "weight", "blood_pressure", "fetal_heart_rate", "fundal_height",
    "abdominal_circumference", "checkup_type", "notes",
    "is_completed", "doctor_name", "hospital"
}

# 报告存储目录
REPORTS_DIR = os.path.join(settings.PHOTOS_DIR, "checkup_reports")

# 图片文件头 magic numbers
IMAGE_MAGIC_BYTES = {
    b'\xff\xd8\xff': 'jpeg',
    b'\x89PNG\r\n\x1a\n': 'png',
    b'GIF87a': 'gif',
    b'GIF89a': 'gif',
    b'RIFF': 'webp',  # WebP: RIFF....WEBP
    b'\x00\x00\x01\x00': 'ico',
}


def _is_valid_image(content: bytes) -> bool:
    """验证文件内容是否为有效图片格式。
    
    通过检查文件头（magic number）来判断真实的文件类型，
    防止恶意文件伪装扩展名上传。
    
    Args:
        content: 文件内容字节。
        
    Returns:
        是否为有效的图片格式。
    """
    if len(content) < 8:
        return False
    
    for magic, fmt in IMAGE_MAGIC_BYTES.items():
        if content.startswith(magic):
            if fmt == 'webp':
                return len(content) > 12 and content[8:12] == b'WEBP'
            return True
    
    return False


def _is_valid_pdf(content: bytes) -> bool:
    """验证文件内容是否为有效的PDF格式。
    
    Args:
        content: 文件内容字节。
        
    Returns:
        是否为有效的PDF格式。
    """
    return content.startswith(b'%PDF') and len(content) > 5

# ──────────────── 标准产检 CRUD ────────────────


@router.post("/checkups", response_model=ApiResponse[CheckupResponse])
async def create_checkup(data: CheckupCreate, db: AsyncSession = Depends(get_db)):
    """创建产检记录。"""
    checkup = PrenatalCheckup(**data.model_dump())
    db.add(checkup)
    await db.flush()
    await db.refresh(checkup)
    return ApiResponse(data=CheckupResponse.model_validate(checkup))


@router.get("/checkups", response_model=ApiResponse)
async def list_checkups(
    pregnancy_id: str,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """产检记录列表（分页）。"""
    query = select(PrenatalCheckup).where(PrenatalCheckup.pregnancy_id == pregnancy_id).order_by(PrenatalCheckup.checkup_date.desc())

    # SQL 层面分页
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.scalar(count_query) or 0
    offset = (page - 1) * page_size
    result = await db.execute(query.offset(offset).limit(page_size))
    items = result.scalars().all()

    return ApiResponse(data={
        "items": [CheckupResponse.model_validate(c) for c in items],
        "total": total, "page": page, "page_size": page_size,
    })


@router.get("/checkups/{checkup_id}", response_model=ApiResponse[CheckupResponse])
async def get_checkup(checkup_id: str, db: AsyncSession = Depends(get_db)):
    """产检记录详情。"""
    checkup = await db.get(PrenatalCheckup, checkup_id)
    if not checkup:
        return ApiResponse(code=1001, data=None, message="产检记录不存在")
    return ApiResponse(data=CheckupResponse.model_validate(checkup))


@router.put("/checkups/{checkup_id}", response_model=ApiResponse[CheckupResponse])
async def update_checkup(checkup_id: str, data: CheckupUpdate, db: AsyncSession = Depends(get_db)):
    """更新产检记录。"""
    checkup = await db.get(PrenatalCheckup, checkup_id)
    if not checkup:
        return ApiResponse(code=1001, data=None, message="产检记录不存在")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key in CHECKUP_ALLOWED_UPDATE_FIELDS:
            setattr(checkup, key, value)
    await db.flush()
    await db.refresh(checkup)
    return ApiResponse(data=CheckupResponse.model_validate(checkup))


@router.delete("/checkups/{checkup_id}", response_model=ApiResponse)
async def delete_checkup(checkup_id: str, db: AsyncSession = Depends(get_db)):
    """删除产检记录。"""
    checkup = await db.get(PrenatalCheckup, checkup_id)
    if not checkup:
        return ApiResponse(code=1001, data=None, message="产检记录不存在")
    # 删除关联报告文件
    report_result = await db.execute(
        select(CheckupReport).where(
            CheckupReport.checkup_id == checkup_id, CheckupReport.checkup_type == "standard"
        )
    )
    for report in report_result.scalars().all():
        _delete_report_file(report.file_path)
        await db.delete(report)
    await db.delete(checkup)
    return ApiResponse(message="删除成功")


@router.post("/checkups/{checkup_id}/photos", response_model=ApiResponse[CheckupPhotoResponse])
async def upload_checkup_photo(
    checkup_id: str,
    file: UploadFile = File(...),
    note: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """上传产检照片。"""
    checkup = await db.get(PrenatalCheckup, checkup_id)
    if not checkup:
        return ApiResponse(code=1001, data=None, message="产检记录不存在")

    # 安全检查1：验证文件大小（在读取内容之前）
    content_length = file.headers.get("content-length")
    if content_length and int(content_length) > settings.MAX_UPLOAD_SIZE:
        return ApiResponse(code=1004, data=None, message="文件大小超过限制")

    # 安全检查2：验证文件类型白名单
    allowed_extensions = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    original_filename = file.filename or "image.jpg"
    safe_filename = os.path.basename(original_filename)
    ext = Path(safe_filename).suffix.lower()
    
    if ext not in allowed_extensions:
        return ApiResponse(code=1005, data=None, message="不支持的图片格式，仅支持 JPG/PNG/WebP/GIF")

    # 安全检查3：生成安全的存储路径（使用UUID，避免路径遍历）
    file_path = photo_processor.generate_file_path("checkup_report", checkup.gestational_week, ext.lstrip("."))

    # 验证生成的路径在允许的目录内
    real_path = os.path.realpath(file_path)
    photos_dir_real = os.path.realpath(settings.PHOTOS_DIR)
    if not real_path.startswith(photos_dir_real):
        return ApiResponse(code=1003, data=None, message="非法的文件路径")

    # 读取并验证文件内容
    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        return ApiResponse(code=1004, data=None, message="文件大小超过限制")

    # 安全检查4：验证图片文件头（magic number）
    if not _is_valid_image(content):
        return ApiResponse(code=1005, data=None, message="文件内容不是有效的图片格式")

    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "wb") as f:
        f.write(content)

    # 生成缩略图
    filename = os.path.basename(file_path)
    thumb_path = photo_processor.generate_thumbnail_path("checkup_report", checkup.gestational_week, filename)
    await photo_processor.create_thumbnail(file_path, thumb_path)

    photo = CheckupPhoto(
        checkup_id=checkup_id,
        file_path=file_path,
        thumbnail_path=thumb_path,
        note=note,
    )
    db.add(photo)
    await db.flush()
    await db.refresh(photo)
    return ApiResponse(data=CheckupPhotoResponse.model_validate(photo))


@router.get("/checkups/{checkup_id}/photos", response_model=ApiResponse[List[CheckupPhotoResponse]])
async def list_checkup_photos(checkup_id: str, db: AsyncSession = Depends(get_db)):
    """获取产检照片列表。"""
    result = await db.execute(select(CheckupPhoto).where(CheckupPhoto.checkup_id == checkup_id))
    photos = result.scalars().all()
    return ApiResponse(data=[CheckupPhotoResponse.model_validate(p) for p in photos])


@router.delete("/checkups/photos/{photo_id}", response_model=ApiResponse)
async def delete_checkup_photo(photo_id: str, db: AsyncSession = Depends(get_db)):
    """删除产检照片。"""
    photo = await db.get(CheckupPhoto, photo_id)
    if not photo:
        return ApiResponse(code=1001, data=None, message="照片不存在")
    photo_processor.delete_photo_files(photo.file_path, photo.thumbnail_path)
    await db.delete(photo)
    return ApiResponse(message="删除成功")


# ──────────────── 自定义产检 CRUD ────────────────


@router.post("/checkups/custom", response_model=ApiResponse[CustomCheckupResponse])
async def create_custom_checkup(data: CustomCheckupCreate, db: AsyncSession = Depends(get_db)):
    """创建自定义产检项目。"""
    payload = data.model_dump()
    items_list = payload.pop("items", None)
    checkup = CustomCheckup(**payload)
    if items_list is not None:
        checkup.items = json.dumps(items_list, ensure_ascii=False)
    db.add(checkup)
    await db.flush()
    await db.refresh(checkup)
    resp = CustomCheckupResponse(
        id=checkup.id, pregnancy_id=checkup.pregnancy_id, name=checkup.name,
        checkup_date=checkup.checkup_date, notes=checkup.notes,
        is_completed=checkup.is_completed, created_at=checkup.created_at, updated_at=checkup.updated_at,
        items=items_list,
    )
    return ApiResponse(data=resp)


@router.get("/checkups/custom", response_model=ApiResponse[List[CustomCheckupResponse]])
async def list_custom_checkups(
    pregnancy_id: str = Query(..., description="孕期ID"),
    db: AsyncSession = Depends(get_db),
):
    """获取自定义产检列表。"""
    result = await db.execute(
        select(CustomCheckup)
        .where(CustomCheckup.pregnancy_id == pregnancy_id)
        .order_by(CustomCheckup.checkup_date.asc().nulls_last(), CustomCheckup.created_at.desc())
    )
    items = result.scalars().all()
    responses = []
    for c in items:
        resp = CustomCheckupResponse(
            id=c.id, pregnancy_id=c.pregnancy_id, name=c.name,
            checkup_date=c.checkup_date, notes=c.notes,
            is_completed=c.is_completed, created_at=c.created_at, updated_at=c.updated_at,
            items=json.loads(c.items) if c.items else None,
        )
        responses.append(resp)
    return ApiResponse(data=responses)


@router.put("/checkups/custom/{custom_id}", response_model=ApiResponse[CustomCheckupResponse])
async def update_custom_checkup(
    custom_id: str,
    data: CustomCheckupUpdate,
    db: AsyncSession = Depends(get_db),
):
    """更新自定义产检。"""
    checkup = await db.get(CustomCheckup, custom_id)
    if not checkup:
        return ApiResponse(code=1001, data=None, message="自定义产检不存在")
    payload = data.model_dump(exclude_unset=True)
    items_list = payload.pop("items", None)
    if items_list is not None:
        checkup.items = json.dumps(items_list, ensure_ascii=False)
    for key, value in payload.items():
        setattr(checkup, key, value)
    await db.flush()
    await db.refresh(checkup)
    parsed_items = json.loads(checkup.items) if checkup.items else None
    resp = CustomCheckupResponse(
        id=checkup.id, pregnancy_id=checkup.pregnancy_id, name=checkup.name,
        checkup_date=checkup.checkup_date, notes=checkup.notes,
        is_completed=checkup.is_completed, created_at=checkup.created_at, updated_at=checkup.updated_at,
        items=parsed_items,
    )
    return ApiResponse(data=resp)


@router.delete("/checkups/custom/{custom_id}", response_model=ApiResponse)
async def delete_custom_checkup(custom_id: str, db: AsyncSession = Depends(get_db)):
    """删除自定义产检。"""
    checkup = await db.get(CustomCheckup, custom_id)
    if not checkup:
        return ApiResponse(code=1001, data=None, message="自定义产检不存在")
    # 删除关联报告文件
    report_result = await db.execute(
        select(CheckupReport).where(
            CheckupReport.checkup_id == custom_id, CheckupReport.checkup_type == "custom"
        )
    )
    for report in report_result.scalars().all():
        _delete_report_file(report.file_path)
        await db.delete(report)
    await db.delete(checkup)
    return ApiResponse(message="删除成功")


@router.put("/checkups/custom/{custom_id}/complete", response_model=ApiResponse[CustomCheckupResponse])
async def mark_custom_checkup_complete(custom_id: str, db: AsyncSession = Depends(get_db)):
    """标记自定义产检为已完成。"""
    checkup = await db.get(CustomCheckup, custom_id)
    if not checkup:
        return ApiResponse(code=1001, data=None, message="自定义产检不存在")
    checkup.is_completed = 1
    await db.flush()
    await db.refresh(checkup)
    return ApiResponse(data=CustomCheckupResponse.model_validate(checkup))


# ──────────────── 产检报告附件 ────────────────

ALLOWED_REPORT_TYPES = {
    "image/jpeg": "image",
    "image/png": "image",
    "image/webp": "image",
    "image/heic": "image",
    "application/pdf": "pdf",
}
MAX_REPORT_SIZE = 20 * 1024 * 1024  # 20MB


def _delete_report_file(file_path: str) -> None:
    """安全删除报告文件。"""
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
        except OSError:
            pass


def _get_report_file_path(checkup_id: str, original_filename: str) -> str:
    """生成报告存储路径。"""
    os.makedirs(REPORTS_DIR, exist_ok=True)
    ext = os.path.splitext(original_filename)[1].lower() or ".bin"
    filename = f"{uuid.uuid4()}{ext}"
    return os.path.join(REPORTS_DIR, filename)


@router.post("/checkups/{checkup_id}/reports", response_model=ApiResponse[CheckupReportResponse])
async def upload_checkup_report(
    checkup_id: str,
    file: UploadFile = File(...),
    checkup_type: str = Form(default="standard", description="standard 或 custom"),
    report_category: str = Form(default="other", description="报告分类: b超/血检/尿检/其他"),
    sub_item: Optional[str] = Form(default=None, description="关联的具体检查子项名称"),
    db: AsyncSession = Depends(get_db),
):
    """上传产检报告附件（图片/PDF）。"""
    # 安全检查1：验证文件大小（在读取内容之前）
    content_length = file.headers.get("content-length")
    if content_length and int(content_length) > MAX_REPORT_SIZE:
        return ApiResponse(code=1004, data=None, message="文件大小超过20MB限制")

    # 安全检查2：验证文件类型白名单
    content_type = file.content_type or ""
    if content_type not in ALLOWED_REPORT_TYPES:
        return ApiResponse(code=1005, data=None, message="不支持的文件类型，仅支持图片(JPG/PNG/WebP)和PDF")

    file_type = ALLOWED_REPORT_TYPES[content_type]

    # 验证分类
    valid_categories = ["b超", "血检", "尿检", "血压", "血糖", "胎心", "其他"]
    if report_category not in valid_categories:
        report_category = "其他"

    # 读取内容
    content = await file.read()
    file_size = len(content)
    if file_size > MAX_REPORT_SIZE:
        return ApiResponse(code=1004, data=None, message="文件大小超过20MB限制")

    # 安全检查3：验证文件内容（magic number）
    if file_type == "pdf":
        if not _is_valid_pdf(content):
            return ApiResponse(code=1005, data=None, message="文件内容不是有效的PDF格式")
    else:
        if not _is_valid_image(content):
            return ApiResponse(code=1005, data=None, message="文件内容不是有效的图片格式")

    # 安全检查4：生成安全的存储路径（防止路径遍历）
    filename = os.path.basename(file.filename or f"report.{file_type}")
    file_path = _get_report_file_path(checkup_id, filename)

    # 验证路径安全性
    real_path = os.path.realpath(file_path)
    reports_dir_real = os.path.realpath(REPORTS_DIR)
    if not real_path.startswith(reports_dir_real):
        return ApiResponse(code=1003, data=None, message="非法的文件路径")

    # 保存文件
    with open(file_path, "wb") as f:
        f.write(content)

    report = CheckupReport(
        checkup_id=checkup_id,
        checkup_type=checkup_type,
        filename=filename,
        file_path=file_path,
        file_type=file_type,
        file_size=file_size,
        report_category=report_category,
        sub_item=sub_item,
    )
    db.add(report)
    await db.flush()
    await db.refresh(report)
    return ApiResponse(data=CheckupReportResponse.model_validate(report))


@router.get("/checkups/{checkup_id}/reports", response_model=ApiResponse[List[CheckupReportResponse]])
async def list_checkup_reports(
    checkup_id: str,
    checkup_type: str = Query(default="standard", description="standard 或 custom"),
    db: AsyncSession = Depends(get_db),
):
    """获取产检报告列表。"""
    result = await db.execute(
        select(CheckupReport)
        .where(
            CheckupReport.checkup_id == checkup_id,
            CheckupReport.checkup_type == checkup_type,
        )
        .order_by(CheckupReport.created_at.desc())
    )
    reports = result.scalars().all()
    return ApiResponse(data=[CheckupReportResponse.model_validate(r) for r in reports])


@router.get("/checkups/reports/{report_id}/download")
async def download_checkup_report(report_id: str, db: AsyncSession = Depends(get_db)):
    """下载产检报告文件。"""
    report = await db.get(CheckupReport, report_id)
    if not report:
        return ApiResponse(code=1001, data=None, message="报告不存在")
    if not os.path.exists(report.file_path):
        return ApiResponse(code=1002, data=None, message="报告文件不存在")

    media_type_map = {
        "image": "image/jpeg",
        "pdf": "application/pdf",
    }
    media_type = media_type_map.get(report.file_type, "application/octet-stream")
    return FileResponse(
        path=report.file_path,
        filename=report.filename,
        media_type=media_type,
    )


@router.delete("/checkups/reports/{report_id}", response_model=ApiResponse)
async def delete_checkup_report(report_id: str, db: AsyncSession = Depends(get_db)):
    """删除产检报告。"""
    report = await db.get(CheckupReport, report_id)
    if not report:
        return ApiResponse(code=1001, data=None, message="报告不存在")
    _delete_report_file(report.file_path)
    await db.delete(report)
    return ApiResponse(message="删除成功")


# ──────────────── NAS 文件浏览 ────────────────

import mimetypes

NAS_BROWSE_WHITELIST = [
    "/vol1",
    "/vol2",
    "/vol3",
    "/home",
    "/share",
]


def _is_safe_nas_path(path: str) -> bool:
    """验证路径是否在允许的 NAS 目录下。"""
    real_path = os.path.realpath(path) if os.path.exists(path) else os.path.abspath(path)
    for allowed in NAS_BROWSE_WHITELIST:
        allowed_real = os.path.realpath(allowed) if os.path.exists(allowed) else allowed
        if real_path.startswith(allowed_real):
            return True
    return False


@router.get("/files/browse", response_model=ApiResponse)
async def browse_nas_files(
    path: str = Query(default="/", description="浏览路径"),
):
    """浏览 NAS 文件系统目录（受白名单限制）。"""
    # 默认路径
    if path == "/":
        # 返回根目录下的关键挂载点
        entries = []
        for p in NAS_BROWSE_WHITELIST:
            if os.path.exists(p):
                try:
                    st = os.stat(p)
                    entries.append({
                        "name": os.path.basename(p) or p,
                        "path": p,
                        "type": "dir",
                        "size": 0,
                        "mtime": int(st.st_mtime),
                    })
                except OSError:
                    pass
        return ApiResponse(data={"path": "/", "entries": entries})

    # 安全检查
    if not _is_safe_nas_path(path):
        return ApiResponse(code=1003, data=None, message="禁止访问此目录")

    if not os.path.exists(path):
        return ApiResponse(code=1001, data=None, message="路径不存在")

    if not os.path.isdir(path):
        return ApiResponse(code=1002, data=None, message="不是一个目录")

    try:
        entries = []
        dirs = []
        files = []
        for name in sorted(os.listdir(path)):
            if name.startswith('.'):
                continue  # 隐藏文件
            full_path = os.path.join(path, name)
            try:
                st = os.stat(full_path)
                is_dir = os.path.isdir(full_path)
                entry = {
                    "name": name,
                    "path": full_path,
                    "type": "dir" if is_dir else "file",
                    "size": st.st_size if not is_dir else 0,
                    "mtime": int(st.st_mtime),
                }
                if is_dir:
                    dirs.append(entry)
                else:
                    # 只显示图片和 PDF
                    ext = os.path.splitext(name)[1].lower()
                    if ext in ('.jpg', '.jpeg', '.png', '.webp', '.pdf', '.heic'):
                        files.append(entry)
            except OSError:
                pass

        return ApiResponse(data={
            "path": path,
            "parent": os.path.dirname(path) if path != "/" else None,
            "entries": dirs + files,
        })
    except PermissionError:
        return ApiResponse(code=1004, data=None, message="没有权限访问此目录")


@router.post("/checkups/{checkup_id}/reports/from-nas", response_model=ApiResponse[CheckupReportResponse])
async def upload_report_from_nas(
    checkup_id: str,
    checkup_type: str = Form(default="standard"),
    report_category: str = Form(default="其他"),
    nas_path: str = Form(..., description="NAS 上的文件路径"),
    sub_item: Optional[str] = Form(default=None, description="关联的具体检查子项名称"),
    db: AsyncSession = Depends(get_db),
):
    """从 NAS 文件系统复制文件作为产检报告。"""
    # 安全检查
    if not _is_safe_nas_path(nas_path):
        return ApiResponse(code=1003, data=None, message="禁止访问此文件")

    if not os.path.exists(nas_path) or not os.path.isfile(nas_path):
        return ApiResponse(code=1001, data=None, message="文件不存在")

    # 检查文件类型
    ext = os.path.splitext(nas_path)[1].lower()
    if ext in ('.jpg', '.jpeg', '.png', '.webp', '.heic'):
        file_type = "image"
    elif ext == '.pdf':
        file_type = "pdf"
    else:
        return ApiResponse(code=1005, data=None, message="不支持的文件类型，仅支持图片和PDF")

    file_size = os.path.getsize(nas_path)
    if file_size > MAX_REPORT_SIZE:
        return ApiResponse(code=1004, data=None, message="文件大小超过20MB限制")

    # 复制文件
    filename = os.path.basename(nas_path)
    dest_path = _get_report_file_path(checkup_id, filename)
    try:
        with open(nas_path, "rb") as src, open(dest_path, "wb") as dst:
            while True:
                chunk = src.read(1024 * 1024)  # 1MB buffer
                if not chunk:
                    break
                dst.write(chunk)
    except OSError as e:
        return ApiResponse(code=1006, data=None, message=f"复制文件失败: {str(e)}")

    # 验证分类
    valid_categories = ["b超", "血检", "尿检", "血压", "血糖", "胎心", "其他"]
    if report_category not in valid_categories:
        report_category = "其他"

    report = CheckupReport(
        checkup_id=checkup_id,
        checkup_type=checkup_type,
        filename=filename,
        file_path=dest_path,
        file_type=file_type,
        file_size=file_size,
        report_category=report_category,
        sub_item=sub_item,
    )
    db.add(report)
    await db.flush()
    await db.refresh(report)
    return ApiResponse(data=CheckupReportResponse.model_validate(report))


# ──────────────── 产检时间表日期管理 ────────────────

import json as _json
import asyncio
_schedule_dates_lock = asyncio.Lock()
_schedule_dates_file = os.path.join(settings.DATA_DIR, "schedule_dates.json")


def _load_schedule_dates() -> dict:
    """从文件加载产检日期数据。"""
    try:
        if os.path.exists(_schedule_dates_file):
            with open(_schedule_dates_file, "r", encoding="utf-8") as f:
                return _json.load(f)
    except Exception:
        pass
    return {}


def _save_schedule_dates(data: dict) -> None:
    """保存产检日期数据到文件。"""
    try:
        os.makedirs(os.path.dirname(_schedule_dates_file), exist_ok=True)
        with open(_schedule_dates_file, "w", encoding="utf-8") as f:
            _json.dump(data, f, ensure_ascii=False)
    except Exception:
        pass


@router.get("/checkup-schedule/{pregnancy_id}/dates", response_model=ApiResponse)
async def get_schedule_dates(pregnancy_id: str):
    """获取产检时间表的用户自定义日期。"""
    with _schedule_dates_lock:
        data = _load_schedule_dates()
    prefix = f"{pregnancy_id}:"
    dates = {}
    for key, value in data.items():
        if key.startswith(prefix):
            schedule_id = key[len(prefix):]
            dates[schedule_id] = value
    return ApiResponse(data=dates)


@router.put("/checkup-schedule/{pregnancy_id}/dates/{schedule_id}", response_model=ApiResponse)
async def set_schedule_date(
    pregnancy_id: str,
    schedule_id: str,
    date_str: str = Form(..., description="日期 YYYY-MM-DD"),
):
    """设置产检时间表项的日期（持久化到JSON文件）。"""
    async with _schedule_dates_lock:
        data = _load_schedule_dates()
        data[f"{pregnancy_id}:{schedule_id}"] = date_str
        _save_schedule_dates(data)
    return ApiResponse(message="设置成功")
