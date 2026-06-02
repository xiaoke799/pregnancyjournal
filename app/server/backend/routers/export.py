"""孕程记 - 数据导出 API（PDF/备份恢复）。"""

import os
from typing import Optional

from fastapi import APIRouter, Depends, UploadFile, File, Query
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.config import settings
from backend.models.pregnancy import Pregnancy
from backend.models.checkup import PrenatalCheckup
from backend.models.diary import DiaryEntry
from backend.models.photo import PregnancyPhoto
from backend.schemas.common import ApiResponse
from backend.services.pdf_generator import pdf_generator
from backend.services.backup_service import backup_service

router = APIRouter()

# 内存中的 PDF 任务状态（简单实现）
_pdf_tasks: dict = {}


@router.post("/export/photo-timeline", response_model=ApiResponse)
async def export_photo_timeline(
    pregnancy_id: str,
    db: AsyncSession = Depends(get_db),
):
    """按孕周时间轴导出照片为 PDF。

    将该孕期的所有照片按孕周分组，每张照片占一页，
    生成精美的时间轴纪念册 PDF。
    """
    pregnancy = await db.get(Pregnancy, pregnancy_id)
    if not pregnancy:
        return ApiResponse(code=1001, data=None, message="孕期档案不存在")

    result = await db.execute(
        select(PregnancyPhoto)
        .where(PregnancyPhoto.pregnancy_id == pregnancy_id)
        .where(PregnancyPhoto.media_type == "photo")
        .order_by(PregnancyPhoto.gestational_week.asc(), PregnancyPhoto.created_at.asc())
    )
    photos = result.scalars().all()

    if not photos:
        return ApiResponse(code=1001, data=None, message="该孕期没有照片")

    title = "孕期相册时间轴"
    if pregnancy.baby_name:
        title = f"{pregnancy.baby_name}的孕期相册"

    photo_data = [
        {
            "file_path": p.file_path,
            "gestational_week": p.gestational_week,
            "created_at": p.created_at,
            "note": p.note,
            "media_type": p.media_type or "photo",
        }
        for p in photos
        if p.file_path and os.path.exists(p.file_path)
    ]

    output_path = os.path.join(
        settings.BACKUPS_DIR,
        f"photo_timeline_{pregnancy_id}.pdf",
    )
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    try:
        pdf_generator.generate_photo_timeline(photo_data, output_path, title=title)
    except Exception as e:
        return ApiResponse(code=2003, data=None, message=f"PDF生成失败")

    return ApiResponse(data={
        "download_url": f"/api/v1/export/photo-timeline/download?pregnancy_id={pregnancy_id}",
        "photo_count": len(photo_data),
    })


@router.get("/export/photo-timeline/download")
async def download_photo_timeline(
    pregnancy_id: str,
):
    """下载照片时间轴 PDF。"""
    path = os.path.join(
        settings.BACKUPS_DIR,
        f"photo_timeline_{pregnancy_id}.pdf",
    )
    if not os.path.exists(path):
        return ApiResponse(code=1001, data=None, message="PDF文件不存在，请先导出")
    return FileResponse(path, media_type="application/pdf", filename="孕期相册时间轴.pdf")


@router.post("/export/pdf", response_model=ApiResponse)
async def generate_pdf(pregnancy_id: str, db: AsyncSession = Depends(get_db)):
    """生成 PDF 纪念册（同步实现，返回下载信息）。"""
    pregnancy = await db.get(Pregnancy, pregnancy_id)
    if not pregnancy:
        return ApiResponse(code=1001, data=None, message="孕期档案不存在")

    # 收集数据
    result = await db.execute(select(PrenatalCheckup).where(PrenatalCheckup.pregnancy_id == pregnancy_id))
    checkups = result.scalars().all()

    result = await db.execute(select(DiaryEntry).where(DiaryEntry.pregnancy_id == pregnancy_id))
    diaries = result.scalars().all()

    result = await db.execute(select(PregnancyPhoto).where(PregnancyPhoto.pregnancy_id == pregnancy_id))
    photos = result.scalars().all()

    pregnancy_data = {
        "id": pregnancy.id,
        "last_period_date": pregnancy.last_period_date,
        "due_date": pregnancy.due_date,
        "baby_name": pregnancy.baby_name,
        "checkups": [
            {
                "checkup_date": c.checkup_date,
                "gestational_week": c.gestational_week,
                "checkup_type": c.checkup_type,
                "weight": c.weight,
                "blood_pressure": c.blood_pressure,
                "fetal_heart_rate": c.fetal_heart_rate,
                "notes": c.notes,
            }
            for c in checkups
        ],
        "diaries": [
            {
                "entry_date": d.entry_date,
                "gestational_week": d.gestational_week,
                "content": d.content,
            }
            for d in diaries
        ],
        "photos": [
            {
                "file_path": p.file_path,
                "gestational_week": p.gestational_week,
                "note": p.note,
            }
            for p in photos
        ],
    }

    # 生成 PDF
    output_path = os.path.join(
        os.getenv("BACKUPS_DIR", "/app/data/backups"),
        f"pregnancy_book_{pregnancy_id}.pdf",
    )
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    try:
        pdf_generator.generate_pregnancy_book(pregnancy_data, output_path)
    except Exception as e:
        return ApiResponse(code=2003, data=None, message=f"PDF生成失败：{str(e)}")

    task_id = f"pdf_{pregnancy_id}"
    _pdf_tasks[task_id] = {"status": "completed", "path": output_path}

    return ApiResponse(data={
        "task_id": task_id,
        "status": "completed",
        "download_url": f"/api/v1/export/pdf/{task_id}/download",
    })


@router.get("/export/pdf/{task_id}")
async def get_pdf_progress(task_id: str):
    """查询 PDF 生成进度。"""
    task = _pdf_tasks.get(task_id)
    if not task:
        return ApiResponse(code=1001, data=None, message="任务不存在")
    return ApiResponse(data=task)


@router.get("/export/pdf/{task_id}/download")
async def download_pdf(task_id: str):
    """下载 PDF。"""
    task = _pdf_tasks.get(task_id)
    if not task or task.get("status") != "completed":
        return ApiResponse(code=1001, data=None, message="PDF未生成完成")
    path = task["path"]
    if not os.path.exists(path):
        return ApiResponse(code=1001, data=None, message="PDF文件不存在")
    return FileResponse(path, media_type="application/pdf", filename="孕程记_纪念册.pdf")


@router.post("/export/backup", response_model=ApiResponse)
async def create_backup(
    target_dir: Optional[str] = Query(None, description="备份目标目录"),
):
    """创建数据备份到指定目录。"""
    if target_dir:
        real = os.path.realpath(target_dir)
        os.makedirs(real, exist_ok=True)
        import shutil
        db_path = settings.DATABASE_PATH
        if os.path.exists(db_path):
            shutil.copy2(db_path, os.path.join(real, "pregnancy-journal.db"))
        return ApiResponse(data={"message": "备份完成", "target": real})
    result = backup_service.create_backup()
    return ApiResponse(data=result)


@router.post("/export/import", response_model=ApiResponse)
async def import_backup(
    source_dir: str = Query(..., description="备份源目录"),
):
    """从指定目录导入恢复数据。"""
    real = os.path.realpath(source_dir)
    backups_base = os.path.realpath(settings.BACKUPS_DIR)
    if not real.startswith(backups_base + os.sep) and real != backups_base:
        return ApiResponse(code=1001, message="源目录不在允许的备份目录内")
    if not os.path.exists(real):
        return ApiResponse(code=1001, data=None, message="目录不存在")
    import shutil
    src_db = os.path.join(real, "pregnancy-journal.db")
    if os.path.exists(src_db):
        shutil.copy2(src_db, settings.DATABASE_PATH)
    return ApiResponse(data={"message": "数据恢复成功"})


@router.get("/export/backup/{backup_id}/download")
async def download_backup(backup_id: str):
    """下载备份文件。"""
    # 查找备份文件
    backups = backup_service.list_backups()
    for b in backups:
        if backup_id in b.get("filename", ""):
            return FileResponse(
                b["path"],
                media_type="application/gzip",
                filename=b["filename"],
            )
    return ApiResponse(code=1001, data=None, message="备份文件不存在")


@router.post("/export/restore", response_model=ApiResponse)
async def restore_backup(backup_path: str):
    """从备份恢复数据。"""
    # 验证 backup_path 在备份目录内，防止路径遍历
    real_path = os.path.realpath(backup_path)
    real_backups_dir = os.path.realpath(settings.BACKUPS_DIR)
    if not real_path.startswith(real_backups_dir + os.sep) and real_path != real_backups_dir:
        return ApiResponse(code=1003, data=None, message="无效的备份文件路径")
    if not os.path.exists(real_path):
        return ApiResponse(code=1001, data=None, message="备份文件不存在")
    result = backup_service.restore_backup(real_path)
    if result.get("success"):
        return ApiResponse(data=result)
    return ApiResponse(code=2001, data=result, message=result.get("message", "恢复失败"))
