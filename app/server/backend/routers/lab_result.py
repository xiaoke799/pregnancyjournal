"""孕程记 - 检查指标 API。"""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.lab_result import LabResult
from backend.models.checkup import PrenatalCheckup
from backend.schemas.common import ApiResponse
from backend.schemas.lab_result import (
    LabResultCreate, LabResultUpdate, LabResultResponse, LabResultTrendResponse, LabResultTrendPoint,
)
from backend.services.reference_range import reference_range_service

router = APIRouter()


@router.post("/lab-results", response_model=ApiResponse[LabResultResponse])
async def create_lab_result(data: LabResultCreate, db: AsyncSession = Depends(get_db)):
    """录入检查指标，自动比对标准范围。"""
    # 自动比对标准范围
    ref_min, ref_max = data.reference_min, data.reference_max
    if ref_min is None or ref_max is None:
        # 获取产检记录的孕周
        checkup = await db.get(PrenatalCheckup, data.checkup_id)
        gest_week = checkup.gestational_week if checkup else None
        ref_range = reference_range_service.get_reference_range(data.category, data.item_name, gest_week)
        if ref_range:
            if ref_min is None:
                ref_min = ref_range[0]
            if ref_max is None:
                ref_max = ref_range[1]

    # 自动判断状态
    status = reference_range_service.evaluate_status(data.value, ref_min, ref_max)

    lab_result = LabResult(
        checkup_id=data.checkup_id,
        category=data.category,
        item_name=data.item_name,
        value=data.value,
        unit=data.unit,
        reference_min=ref_min,
        reference_max=ref_max,
        status=status,
    )
    db.add(lab_result)
    await db.flush()
    await db.refresh(lab_result)
    return ApiResponse(data=LabResultResponse.model_validate(lab_result))


@router.get("/lab-results", response_model=ApiResponse[List[LabResultResponse]])
async def list_lab_results(
    checkup_id: Optional[str] = None,
    category: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """指标列表，按 checkup_id 或 category 筛选。"""
    query = select(LabResult)
    if checkup_id:
        query = query.where(LabResult.checkup_id == checkup_id)
    if category:
        query = query.where(LabResult.category == category)
    result = await db.execute(query.order_by(LabResult.created_at))
    results = result.scalars().all()
    return ApiResponse(data=[LabResultResponse.model_validate(r) for r in results])


@router.get("/lab-results/trend", response_model=ApiResponse[LabResultTrendResponse])
async def get_lab_result_trend(
    category: str = Query(...),
    item_name: str = Query(...),
    pregnancy_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """指标趋势（按 category + item_name）。"""
    query = (
        select(LabResult, PrenatalCheckup.gestational_week, PrenatalCheckup.checkup_date)
        .join(PrenatalCheckup, LabResult.checkup_id == PrenatalCheckup.id)
        .where(LabResult.category == category, LabResult.item_name == item_name)
        .where(PrenatalCheckup.pregnancy_id == pregnancy_id)
        .order_by(PrenatalCheckup.checkup_date)
    )
    result = await db.execute(query)
    rows = result.all()

    points = []
    unit = ""
    for row in rows:
        lab = row[0]
        unit = lab.unit
        points.append(LabResultTrendPoint(
            gestational_week=row[1],
            value=lab.value,
            checkup_date=row[2],
            reference_min=lab.reference_min,
            reference_max=lab.reference_max,
        ))

    return ApiResponse(data=LabResultTrendResponse(
        category=category, item_name=item_name, unit=unit, points=points,
    ))


@router.get("/lab-results/{lab_result_id}", response_model=ApiResponse[LabResultResponse])
async def get_lab_result(lab_result_id: str, db: AsyncSession = Depends(get_db)):
    """指标详情。"""
    lab = await db.get(LabResult, lab_result_id)
    if not lab:
        return ApiResponse(code=1001, data=None, message="指标不存在")
    return ApiResponse(data=LabResultResponse.model_validate(lab))


@router.put("/lab-results/{lab_result_id}", response_model=ApiResponse[LabResultResponse])
async def update_lab_result(lab_result_id: str, data: LabResultUpdate, db: AsyncSession = Depends(get_db)):
    """更新指标。"""
    lab = await db.get(LabResult, lab_result_id)
    if not lab:
        return ApiResponse(code=1001, data=None, message="指标不存在")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(lab, key, value)
    # 重新判断状态
    if data.value is not None:
        lab.status = reference_range_service.evaluate_status(lab.value, lab.reference_min, lab.reference_max)
    await db.flush()
    await db.refresh(lab)
    return ApiResponse(data=LabResultResponse.model_validate(lab))


@router.delete("/lab-results/{lab_result_id}", response_model=ApiResponse)
async def delete_lab_result(lab_result_id: str, db: AsyncSession = Depends(get_db)):
    """删除指标。"""
    lab = await db.get(LabResult, lab_result_id)
    if not lab:
        return ApiResponse(code=1001, data=None, message="指标不存在")
    await db.delete(lab)
    return ApiResponse(message="删除成功")
