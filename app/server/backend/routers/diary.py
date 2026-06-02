"""孕程记 - 日记 API。"""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.diary import DiaryEntry
from backend.schemas.common import ApiResponse
from backend.schemas.diary import DiaryCreate, DiaryUpdate, DiaryResponse

router = APIRouter()


@router.post("/diaries", response_model=ApiResponse[DiaryResponse])
async def create_diary(data: DiaryCreate, db: AsyncSession = Depends(get_db)):
    """创建日记。"""
    diary = DiaryEntry(**data.model_dump())
    db.add(diary)
    await db.flush()
    await db.refresh(diary)
    return ApiResponse(data=DiaryResponse.model_validate(diary))


@router.get("/diaries", response_model=ApiResponse)
async def list_diaries(
    pregnancy_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """日记列表（分页+日期范围）。"""
    query = select(DiaryEntry).where(DiaryEntry.pregnancy_id == pregnancy_id)
    if start_date:
        query = query.where(DiaryEntry.entry_date >= start_date)
    if end_date:
        query = query.where(DiaryEntry.entry_date <= end_date)
    query = query.order_by(DiaryEntry.entry_date.desc())

    # SQL 层面分页
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.scalar(count_query) or 0
    offset = (page - 1) * page_size
    result = await db.execute(query.offset(offset).limit(page_size))
    items = result.scalars().all()

    return ApiResponse(data={
        "items": [DiaryResponse.model_validate(d) for d in items],
        "total": total, "page": page, "page_size": page_size,
    })


@router.get("/diaries/{diary_id}", response_model=ApiResponse[DiaryResponse])
async def get_diary(diary_id: str, db: AsyncSession = Depends(get_db)):
    """日记详情。"""
    diary = await db.get(DiaryEntry, diary_id)
    if not diary:
        return ApiResponse(code=1001, data=None, message="日记不存在")
    return ApiResponse(data=DiaryResponse.model_validate(diary))


@router.put("/diaries/{diary_id}", response_model=ApiResponse[DiaryResponse])
async def update_diary(diary_id: str, data: DiaryUpdate, db: AsyncSession = Depends(get_db)):
    """更新日记。"""
    diary = await db.get(DiaryEntry, diary_id)
    if not diary:
        return ApiResponse(code=1001, data=None, message="日记不存在")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(diary, key, value)
    await db.flush()
    await db.refresh(diary)
    return ApiResponse(data=DiaryResponse.model_validate(diary))


@router.delete("/diaries/{diary_id}", response_model=ApiResponse)
async def delete_diary(diary_id: str, db: AsyncSession = Depends(get_db)):
    """删除日记。"""
    diary = await db.get(DiaryEntry, diary_id)
    if not diary:
        return ApiResponse(code=1001, data=None, message="日记不存在")
    await db.delete(diary)
    return ApiResponse(message="删除成功")
