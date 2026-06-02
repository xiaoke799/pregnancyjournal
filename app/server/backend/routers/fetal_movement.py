"""孕程记 - 胎动计数 API。"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.fetal_movement import FetalMovementSession, FetalMovement
from backend.schemas.common import ApiResponse
from backend.schemas.fetal_movement import (
    FetalMovementSessionCreate, FetalMovementSessionUpdate,
    FetalMovementSessionResponse, FetalMovementResponse,
)

router = APIRouter()


@router.post("/fetal-movements/sessions", response_model=ApiResponse[FetalMovementSessionResponse])
async def create_fetal_movement_session(data: FetalMovementSessionCreate, db: AsyncSession = Depends(get_db)):
    """创建胎动计数会话。"""
    now = datetime.now()
    session = FetalMovementSession(
        pregnancy_id=data.pregnancy_id,
        session_date=now.date(),
        start_time=now.strftime("%H:%M:%S"),
    )
    db.add(session)
    await db.flush()
    return ApiResponse(data=FetalMovementSessionResponse.model_validate(session))


@router.get("/fetal-movements/sessions", response_model=ApiResponse[List[FetalMovementSessionResponse]])
async def list_fetal_movement_sessions(
    pregnancy_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """会话列表。"""
    query = select(FetalMovementSession)
    if pregnancy_id:
        query = query.where(FetalMovementSession.pregnancy_id == pregnancy_id)
    query = query.order_by(FetalMovementSession.created_at.desc())
    result = await db.execute(query)
    sessions = result.scalars().all()
    return ApiResponse(data=[FetalMovementSessionResponse.model_validate(s) for s in sessions])


@router.get("/fetal-movements/sessions/{session_id}", response_model=ApiResponse[FetalMovementSessionResponse])
async def get_fetal_movement_session(session_id: str, db: AsyncSession = Depends(get_db)):
    """会话详情。"""
    session = await db.get(FetalMovementSession, session_id)
    if not session:
        return ApiResponse(code=1001, data=None, message="会话不存在")
    return ApiResponse(data=FetalMovementSessionResponse.model_validate(session))


@router.put("/fetal-movements/sessions/{session_id}", response_model=ApiResponse[FetalMovementSessionResponse])
async def end_fetal_movement_session(session_id: str, data: FetalMovementSessionUpdate, db: AsyncSession = Depends(get_db)):
    """结束胎动计数会话。"""
    session = await db.get(FetalMovementSession, session_id)
    if not session:
        return ApiResponse(code=1001, data=None, message="会话不存在")

    session.end_time = datetime.now().strftime("%H:%M:%S")
    if data.notes:
        session.notes = data.notes

    # 计算总次数
    result = await db.execute(select(FetalMovement).where(FetalMovement.session_id == session_id))
    movements = result.scalars().all()
    session.total_count = len(movements)

    await db.flush()
    return ApiResponse(data=FetalMovementSessionResponse.model_validate(session))


@router.post("/fetal-movements/sessions/{session_id}/kicks", response_model=ApiResponse[FetalMovementResponse])
async def record_fetal_movement(session_id: str, db: AsyncSession = Depends(get_db)):
    """记录一次胎动。"""
    session = await db.get(FetalMovementSession, session_id)
    if not session:
        return ApiResponse(code=1001, data=None, message="会话不存在")

    movement = FetalMovement(
        session_id=session_id,
        timestamp=datetime.now(),
    )
    db.add(movement)
    session.total_count += 1
    await db.flush()
    return ApiResponse(data=FetalMovementResponse.model_validate(movement))


@router.get("/fetal-movements/sessions/{session_id}/kicks", response_model=ApiResponse[List[FetalMovementResponse]])
async def list_fetal_movements(session_id: str, db: AsyncSession = Depends(get_db)):
    """获取会话内胎动列表。"""
    result = await db.execute(
        select(FetalMovement).where(FetalMovement.session_id == session_id).order_by(FetalMovement.timestamp)
    )
    movements = result.scalars().all()
    return ApiResponse(data=[FetalMovementResponse.model_validate(m) for m in movements])
