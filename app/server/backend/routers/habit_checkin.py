"""孕程记 - 好习惯打卡 API。"""

import json
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.habit_checkin import HabitCheckin
from backend.schemas.common import ApiResponse
from backend.schemas.habit_checkin import HabitCheckinCreate, HabitCheckinUpdate, HabitCheckinResponse

router = APIRouter()


@router.post("/habit-checkins", response_model=ApiResponse[HabitCheckinResponse])
async def create_or_update_habit_checkin(data: HabitCheckinCreate, db: AsyncSession = Depends(get_db)):
    """创建/更新好习惯打卡（按日期 upsert）。"""
    result = await db.execute(
        select(HabitCheckin).where(
            HabitCheckin.pregnancy_id == data.pregnancy_id,
            HabitCheckin.date == data.checkin_date,
        )
    )
    existing = result.scalar_one_or_none()

    items_json = json.dumps(data.items, ensure_ascii=False)

    if existing:
        update_data = data.model_dump(exclude_unset=True, exclude={"pregnancy_id", "checkin_date", "items"})
        existing.items = items_json
        for key, value in update_data.items():
            if value is not None:
                setattr(existing, key, value)
        await db.flush()
        return ApiResponse(data=HabitCheckinResponse.model_validate(existing))

    record = HabitCheckin(
        pregnancy_id=data.pregnancy_id,
        date=data.checkin_date,
        items=items_json,
        notes=data.notes,
    )
    db.add(record)
    await db.flush()
    return ApiResponse(data=HabitCheckinResponse.model_validate(record))


@router.get("/habit-checkins", response_model=ApiResponse)
async def list_habit_checkins(
    pregnancy_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """好习惯打卡列表（分页+日期范围筛选）。"""
    query = select(HabitCheckin).where(HabitCheckin.pregnancy_id == pregnancy_id)
    if start_date:
        query = query.where(HabitCheckin.date >= start_date)
    if end_date:
        query = query.where(HabitCheckin.date <= end_date)
    query = query.order_by(HabitCheckin.date.desc())

    # SQL 层面分页
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.scalar(count_query) or 0
    offset = (page - 1) * page_size
    result = await db.execute(query.offset(offset).limit(page_size))
    records = result.scalars().all()

    return ApiResponse(data={
        "items": [HabitCheckinResponse.model_validate(r) for r in records],
        "total": total, "page": page, "page_size": page_size,
    })


@router.get("/habit-checkins/by-date/{date}", response_model=ApiResponse[HabitCheckinResponse])
async def get_habit_checkin_by_date(
    date: str,
    pregnancy_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """获取指定日期的好习惯打卡。"""
    result = await db.execute(
        select(HabitCheckin).where(
            HabitCheckin.pregnancy_id == pregnancy_id,
            HabitCheckin.date == date,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        return ApiResponse(code=1001, data=None, message="该日期无打卡记录")
    return ApiResponse(data=HabitCheckinResponse.model_validate(record))


@router.get("/habit-checkins/{checkin_id}", response_model=ApiResponse[HabitCheckinResponse])
async def get_habit_checkin(checkin_id: str, db: AsyncSession = Depends(get_db)):
    """好习惯打卡详情。"""
    record = await db.get(HabitCheckin, checkin_id)
    if not record:
        return ApiResponse(code=1001, data=None, message="记录不存在")
    return ApiResponse(data=HabitCheckinResponse.model_validate(record))


@router.put("/habit-checkins/{checkin_id}", response_model=ApiResponse[HabitCheckinResponse])
async def update_habit_checkin(checkin_id: str, data: HabitCheckinUpdate, db: AsyncSession = Depends(get_db)):
    """更新好习惯打卡。"""
    record = await db.get(HabitCheckin, checkin_id)
    if not record:
        return ApiResponse(code=1001, data=None, message="记录不存在")
    if data.items is not None:
        record.items = json.dumps(data.items, ensure_ascii=False)
    if data.notes is not None:
        record.notes = data.notes
    await db.flush()
    return ApiResponse(data=HabitCheckinResponse.model_validate(record))


@router.delete("/habit-checkins/{checkin_id}", response_model=ApiResponse)
async def delete_habit_checkin(checkin_id: str, db: AsyncSession = Depends(get_db)):
    """删除好习惯打卡。"""
    record = await db.get(HabitCheckin, checkin_id)
    if not record:
        return ApiResponse(code=1001, data=None, message="记录不存在")
    await db.delete(record)
    return ApiResponse(message="删除成功")
