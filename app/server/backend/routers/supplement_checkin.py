"""孕程记 - 营养补充打卡 API。"""

import json
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.supplement_checkin import SupplementCheckin
from backend.schemas.common import ApiResponse
from backend.schemas.supplement_checkin import SupplementCheckinCreate, SupplementCheckinUpdate, SupplementCheckinResponse

router = APIRouter()


@router.post("/supplement-checkins", response_model=ApiResponse[SupplementCheckinResponse])
async def create_or_update_supplement_checkin(data: SupplementCheckinCreate, db: AsyncSession = Depends(get_db)):
    """创建/更新营养补充打卡（按日期 upsert）。"""
    result = await db.execute(
        select(SupplementCheckin).where(
            SupplementCheckin.pregnancy_id == data.pregnancy_id,
            SupplementCheckin.date == data.checkin_date,
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
        return ApiResponse(data=SupplementCheckinResponse.model_validate(existing))

    record = SupplementCheckin(
        pregnancy_id=data.pregnancy_id,
        date=data.checkin_date,
        items=items_json,
        notes=data.notes,
    )
    db.add(record)
    await db.flush()
    return ApiResponse(data=SupplementCheckinResponse.model_validate(record))


@router.get("/supplement-checkins", response_model=ApiResponse)
async def list_supplement_checkins(
    pregnancy_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """营养补充打卡列表（分页+日期范围筛选）。"""
    query = select(SupplementCheckin).where(SupplementCheckin.pregnancy_id == pregnancy_id)
    if start_date:
        query = query.where(SupplementCheckin.date >= start_date)
    if end_date:
        query = query.where(SupplementCheckin.date <= end_date)
    query = query.order_by(SupplementCheckin.date.desc())

    # SQL 层面分页
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.scalar(count_query) or 0
    offset = (page - 1) * page_size
    result = await db.execute(query.offset(offset).limit(page_size))
    records = result.scalars().all()

    return ApiResponse(data={
        "items": [SupplementCheckinResponse.model_validate(r) for r in records],
        "total": total, "page": page, "page_size": page_size,
    })


@router.get("/supplement-checkins/by-date/{date}", response_model=ApiResponse[SupplementCheckinResponse])
async def get_supplement_checkin_by_date(
    date: str,
    pregnancy_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """获取指定日期的营养补充打卡。"""
    result = await db.execute(
        select(SupplementCheckin).where(
            SupplementCheckin.pregnancy_id == pregnancy_id,
            SupplementCheckin.date == date,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        return ApiResponse(code=1001, data=None, message="该日期无打卡记录")
    return ApiResponse(data=SupplementCheckinResponse.model_validate(record))


@router.get("/supplement-checkins/{checkin_id}", response_model=ApiResponse[SupplementCheckinResponse])
async def get_supplement_checkin(checkin_id: str, db: AsyncSession = Depends(get_db)):
    """营养补充打卡详情。"""
    record = await db.get(SupplementCheckin, checkin_id)
    if not record:
        return ApiResponse(code=1001, data=None, message="记录不存在")
    return ApiResponse(data=SupplementCheckinResponse.model_validate(record))


@router.put("/supplement-checkins/{checkin_id}", response_model=ApiResponse[SupplementCheckinResponse])
async def update_supplement_checkin(checkin_id: str, data: SupplementCheckinUpdate, db: AsyncSession = Depends(get_db)):
    """更新营养补充打卡。"""
    record = await db.get(SupplementCheckin, checkin_id)
    if not record:
        return ApiResponse(code=1001, data=None, message="记录不存在")
    if data.items is not None:
        record.items = json.dumps(data.items, ensure_ascii=False)
    if data.notes is not None:
        record.notes = data.notes
    await db.flush()
    return ApiResponse(data=SupplementCheckinResponse.model_validate(record))


@router.delete("/supplement-checkins/{checkin_id}", response_model=ApiResponse)
async def delete_supplement_checkin(checkin_id: str, db: AsyncSession = Depends(get_db)):
    """删除营养补充打卡。"""
    record = await db.get(SupplementCheckin, checkin_id)
    if not record:
        return ApiResponse(code=1001, data=None, message="记录不存在")
    await db.delete(record)
    return ApiResponse(message="删除成功")
