"""孕程记 - 孕期档案 API。"""

from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.pregnancy import Pregnancy
from backend.schemas.common import ApiResponse
from backend.schemas.pregnancy import (
    PregnancyCreate, PregnancyUpdate, PregnancyResponse, GestationalAgeResponse,
)
from backend.services.gestational_calculator import (
    calculate_due_date_from_lmp, calculate_due_date_from_conception,
    calculate_lmp_from_due_date, calculate_gestational_age, get_trimester, days_until_due,
)

router = APIRouter()


@router.post("/pregnancies", response_model=ApiResponse[PregnancyResponse])
async def create_pregnancy(data: PregnancyCreate, db: AsyncSession = Depends(get_db)):
    """创建孕期档案。"""
    # 计算预产期
    lmp_date = None
    due_date_val = None

    if data.last_period_date:
        lmp_date = data.last_period_date
        due_date_val = calculate_due_date_from_lmp(lmp_date)
    elif data.conception_date:
        conception = data.conception_date
        due_date_val = calculate_due_date_from_conception(conception)
        lmp_date = conception - timedelta(days=14)
    elif data.due_date:
        due_date_val = data.due_date
        lmp_date = calculate_lmp_from_due_date(due_date_val)
    else:
        raise HTTPException(status_code=400, detail="必须提供末次月经日期、受精日期或预产期")

    pregnancy = Pregnancy(
        last_period_date=lmp_date,
        conception_date=data.conception_date,
        due_date=due_date_val,
        is_active=1,
        baby_name=data.baby_name,
    )
    db.add(pregnancy)
    await db.flush()
    await db.refresh(pregnancy)

    return ApiResponse(data=PregnancyResponse.model_validate(pregnancy))


@router.get("/pregnancies", response_model=ApiResponse[List[PregnancyResponse]])
async def list_pregnancies(db: AsyncSession = Depends(get_db)):
    """获取孕期列表。"""
    result = await db.execute(select(Pregnancy).order_by(Pregnancy.created_at.desc()))
    pregnancies = result.scalars().all()
    return ApiResponse(data=[PregnancyResponse.model_validate(p) for p in pregnancies])


@router.get("/pregnancies/active", response_model=ApiResponse[PregnancyResponse])
async def get_active_pregnancy(db: AsyncSession = Depends(get_db)):
    """获取当前活跃孕期。"""
    result = await db.execute(select(Pregnancy).where(Pregnancy.is_active == 1))
    pregnancy = result.scalar_one_or_none()
    if not pregnancy:
        return ApiResponse(code=1001, data=None, message="暂无活跃孕期")
    return ApiResponse(data=PregnancyResponse.model_validate(pregnancy))


@router.get("/pregnancies/active/gestational-age", response_model=ApiResponse[GestationalAgeResponse])
async def get_gestational_age(db: AsyncSession = Depends(get_db)):
    """获取当前孕周信息。"""
    result = await db.execute(select(Pregnancy).where(Pregnancy.is_active == 1))
    pregnancy = result.scalar_one_or_none()
    if not pregnancy:
        return ApiResponse(code=1001, data=None, message="暂无活跃孕期")

    lmp = pregnancy.last_period_date
    weeks, days, total = calculate_gestational_age(lmp)
    due = pregnancy.due_date
    days_left = days_until_due(due)

    return ApiResponse(data=GestationalAgeResponse(
        weeks=weeks, days=days, total_days=total,
        due_date=pregnancy.due_date, days_until_due=days_left,
        trimester=get_trimester(weeks),
    ))


@router.get("/pregnancies/{pregnancy_id}", response_model=ApiResponse[PregnancyResponse])
async def get_pregnancy(pregnancy_id: str, db: AsyncSession = Depends(get_db)):
    """获取孕期详情。"""
    pregnancy = await db.get(Pregnancy, pregnancy_id)
    if not pregnancy:
        return ApiResponse(code=1001, data=None, message="孕期档案不存在")
    return ApiResponse(data=PregnancyResponse.model_validate(pregnancy))


@router.put("/pregnancies/{pregnancy_id}", response_model=ApiResponse[PregnancyResponse])
async def update_pregnancy(pregnancy_id: str, data: PregnancyUpdate, db: AsyncSession = Depends(get_db)):
    """更新孕期信息。"""
    pregnancy = await db.get(Pregnancy, pregnancy_id)
    if not pregnancy:
        return ApiResponse(code=1001, data=None, message="孕期档案不存在")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(pregnancy, key, value)

    # 如果修改了末次月经日期，重新计算预产期
    if data.last_period_date is not None:
        lmp = data.last_period_date
        pregnancy.due_date = calculate_due_date_from_lmp(lmp)

    # 如果直接修改了预产期，反推末次月经日期
    if data.due_date is not None and data.last_period_date is None:
        pregnancy.last_period_date = calculate_lmp_from_due_date(data.due_date)

    await db.flush()
    await db.refresh(pregnancy)
    return ApiResponse(data=PregnancyResponse.model_validate(pregnancy))


@router.put("/pregnancies/{pregnancy_id}/activate", response_model=ApiResponse[PregnancyResponse])
async def activate_pregnancy(pregnancy_id: str, db: AsyncSession = Depends(get_db)):
    """设为当前活跃孕期。"""
    from sqlalchemy import update
    # 原子操作：先取消所有活跃
    await db.execute(update(Pregnancy).values(is_active=0))

    pregnancy = await db.get(Pregnancy, pregnancy_id)
    if not pregnancy:
        await db.rollback()
        return ApiResponse(code=1001, data=None, message="孕期档案不存在")

    pregnancy.is_active = 1
    await db.flush()
    await db.refresh(pregnancy)
    return ApiResponse(data=PregnancyResponse.model_validate(pregnancy))
