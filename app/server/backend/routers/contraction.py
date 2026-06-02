"""孕程记 - 宫缩计时 API。"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.contraction import ContractionSession, Contraction
from backend.schemas.common import ApiResponse
from backend.schemas.contraction import (
    ContractionSessionCreate, ContractionSessionUpdate, ContractionStart,
    ContractionSessionResponse, ContractionResponse, ContractionAnalysisResponse,
)
from backend.services.contraction_analyzer import contraction_analyzer

router = APIRouter()


@router.post("/contractions/sessions", response_model=ApiResponse[ContractionSessionResponse])
async def create_contraction_session(data: ContractionSessionCreate, db: AsyncSession = Depends(get_db)):
    """创建宫缩计时会话。"""
    now = datetime.now()
    session = ContractionSession(
        pregnancy_id=data.pregnancy_id,
        session_date=now.date(),
        start_time=now,
    )
    db.add(session)
    await db.flush()
    return ApiResponse(data=ContractionSessionResponse.model_validate(session))


@router.get("/contractions/sessions", response_model=ApiResponse[List[ContractionSessionResponse]])
async def list_contraction_sessions(
    pregnancy_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """会话列表。"""
    query = select(ContractionSession)
    if pregnancy_id:
        query = query.where(ContractionSession.pregnancy_id == pregnancy_id)
    query = query.order_by(ContractionSession.created_at.desc())
    result = await db.execute(query)
    sessions = result.scalars().all()
    return ApiResponse(data=[ContractionSessionResponse.model_validate(s) for s in sessions])


@router.get("/contractions/sessions/{session_id}", response_model=ApiResponse[ContractionSessionResponse])
async def get_contraction_session(session_id: str, db: AsyncSession = Depends(get_db)):
    """会话详情。"""
    session = await db.get(ContractionSession, session_id)
    if not session:
        return ApiResponse(code=1001, data=None, message="会话不存在")
    return ApiResponse(data=ContractionSessionResponse.model_validate(session))


@router.put("/contractions/sessions/{session_id}", response_model=ApiResponse[ContractionSessionResponse])
async def end_contraction_session(session_id: str, data: ContractionSessionUpdate, db: AsyncSession = Depends(get_db)):
    """结束宫缩计时会话。"""
    session = await db.get(ContractionSession, session_id)
    if not session:
        return ApiResponse(code=1001, data=None, message="会话不存在")

    session.end_time = datetime.now()
    if data.notes:
        session.notes = data.notes

    # 重新计算统计
    result = await db.execute(select(Contraction).where(Contraction.session_id == session_id))
    contractions = result.scalars().all()
    session.total_count = len(contractions)

    durations = [c.duration for c in contractions if c.duration]
    if durations:
        session.avg_duration = sum(durations) / len(durations)

    intervals = [c.interval_from_prev for c in contractions if c.interval_from_prev]
    if intervals:
        session.avg_interval = sum(intervals) / len(intervals)

    await db.flush()
    return ApiResponse(data=ContractionSessionResponse.model_validate(session))


@router.post("/contractions/sessions/{session_id}/contractions", response_model=ApiResponse[ContractionResponse])
async def record_contraction(session_id: str, data: ContractionStart, db: AsyncSession = Depends(get_db)):
    """记录一次宫缩（开始/结束/手动输入）。"""
    session = await db.get(ContractionSession, session_id)
    if not session:
        return ApiResponse(code=1001, data=None, message="会话不存在")

    now = datetime.now()

    if data.action == "start":
        # 查找上一个未结束的宫缩并自动结束
        result = await db.execute(
            select(Contraction).where(
                Contraction.session_id == session_id,
                Contraction.end_time.is_(None),
            )
        )
        unfinished = result.scalar_one_or_none()
        if unfinished:
            unfinished.end_time = now
            start = unfinished.start_time
            unfinished.duration = (now - start).total_seconds()

        # 创建新宫缩
        interval = None
        last_result = await db.execute(
            select(Contraction).where(Contraction.session_id == session_id).order_by(Contraction.start_time.desc())
        )
        last_contraction = last_result.scalars().first()
        if last_contraction and last_contraction.start_time:
            last_start = last_contraction.start_time
            interval = (now - last_start).total_seconds()

        contraction = Contraction(
            session_id=session_id,
            start_time=now,
            interval_from_prev=interval,
        )
        db.add(contraction)
        session.total_count += 1

    elif data.action == "end":
        result = await db.execute(
            select(Contraction).where(
                Contraction.session_id == session_id,
                Contraction.end_time.is_(None),
            )
        )
        contraction = result.scalar_one_or_none()
        if contraction:
            contraction.end_time = now
            start = contraction.start_time
            contraction.duration = (now - start).total_seconds()

    elif data.action == "manual":
        if not data.start_time or not data.end_time:
            return ApiResponse(code=1002, data=None, message="手动模式需要提供开始时间和结束时间")
        if data.end_time <= data.start_time:
            return ApiResponse(code=1003, data=None, message="结束时间必须晚于开始时间")

        interval = None
        last_result = await db.execute(
            select(Contraction).where(Contraction.session_id == session_id).order_by(Contraction.start_time.desc())
        )
        last_contraction = last_result.scalars().first()
        if last_contraction and last_contraction.start_time:
            interval = (data.start_time - last_contraction.start_time).total_seconds()

        contraction = Contraction(
            session_id=session_id,
            start_time=data.start_time,
            end_time=data.end_time,
            duration=(data.end_time - data.start_time).total_seconds(),
            interval_from_prev=interval,
        )
        db.add(contraction)
        session.total_count += 1

    else:
        return ApiResponse(code=1004, data=None, message=f"未知操作: {data.action}")

    await db.flush()
    if contraction is not None:
        return ApiResponse(data=ContractionResponse.model_validate(contraction))
    return ApiResponse(data=None, message="操作完成")


@router.get("/contractions/sessions/{session_id}/contractions", response_model=ApiResponse[List[ContractionResponse]])
async def list_contractions(session_id: str, db: AsyncSession = Depends(get_db)):
    """获取会话内宫缩列表。"""
    result = await db.execute(
        select(Contraction).where(Contraction.session_id == session_id).order_by(Contraction.start_time)
    )
    contractions = result.scalars().all()
    return ApiResponse(data=[ContractionResponse.model_validate(c) for c in contractions])


@router.get("/contractions/sessions/{session_id}/analysis", response_model=ApiResponse[ContractionAnalysisResponse])
async def analyze_contractions(session_id: str, db: AsyncSession = Depends(get_db)):
    """5-1-1 分析结果。"""
    result = await db.execute(
        select(Contraction).where(Contraction.session_id == session_id).order_by(Contraction.start_time)
    )
    contractions = result.scalars().all()
    contraction_data = [
        {
            "start_time": c.start_time,
            "end_time": c.end_time,
            "duration": c.duration,
            "interval_from_prev": c.interval_from_prev,
        }
        for c in contractions
    ]

    analysis = contraction_analyzer.analyze(contraction_data)
    return ApiResponse(data=ContractionAnalysisResponse(
        session_id=session_id,
        total_count=analysis["total_count"],
        avg_duration=analysis["avg_duration"],
        avg_interval=analysis["avg_interval"],
        last_hour_count=analysis["last_hour_count"],
        is_511_met=analysis["is_511_met"],
        recommendation=analysis["recommendation"],
    ))
