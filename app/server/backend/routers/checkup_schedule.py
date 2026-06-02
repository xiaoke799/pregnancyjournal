"""孕程记 - 产检时间表 API。"""

import json
import os
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import get_db
from backend.models.pregnancy import Pregnancy
from backend.schemas.common import ApiResponse

router = APIRouter()

# 数据缓存
_schedule_cache: Optional[List[dict]] = None


def _load_schedule() -> List[dict]:
    """加载产检时间表数据（带缓存）。"""
    global _schedule_cache
    if _schedule_cache is None:
        filepath = os.path.join(settings.DATA_DIR, "checkup_schedule.json")
        if os.path.exists(filepath):
            with open(filepath, "r", encoding="utf-8") as f:
                _schedule_cache = json.load(f)
        else:
            _schedule_cache = []
    return _schedule_cache


@router.get("/checkup-schedule", response_model=ApiResponse)
async def get_checkup_schedule(
    pregnancy_id: Optional[str] = Query(None, description="孕期ID，用于标记完成状态"),
    db: AsyncSession = Depends(get_db),
):
    """获取产检时间表。

    返回标准产检时间表，如果提供 pregnancy_id 则附加完成状态。
    """
    schedule = _load_schedule()

    # 如果有孕期ID，查询已完成的产检并标记
    completed_weeks: set = set()
    if pregnancy_id:
        result = await db.execute(
            select(Pregnancy).where(Pregnancy.id == pregnancy_id)
        )
        pregnancy = result.scalar_one_or_none()
        if pregnancy:
            # 从已有产检记录中获取已完成的孕周
            from backend.models.checkup import PrenatalCheckup
            checkup_result = await db.execute(
                select(PrenatalCheckup).where(
                    PrenatalCheckup.pregnancy_id == pregnancy_id,
                    PrenatalCheckup.is_completed == 1,
                )
            )
            completed_checkups = checkup_result.scalars().all()
            for c in completed_checkups:
                completed_weeks.add(c.gestational_week)

    # 为每个时间节点附加完成状态和推荐标记
    for item in schedule:
        week_start = item.get("week_start", 0)
        week_end = item.get("week_end", 0)
        # 如果孕周范围中有任何一个周在已完成集合中，则标记为已完成
        item["is_completed"] = any(w in completed_weeks for w in range(week_start, week_end + 1))
        # 标准产检项目均为推荐项目
        item["is_recommended"] = True

    return ApiResponse(data=schedule)


@router.put("/checkup-schedule/{item_id}/complete", response_model=ApiResponse)
async def mark_checkup_completed(
    item_id: str,
    pregnancy_id: str = Query(..., description="孕期ID"),
    db: AsyncSession = Depends(get_db),
):
    """标记产检时间表项为已完成。

    在产检记录表中创建一条已完成的记录。
    """
    schedule = _load_schedule()
    target_item = None
    for item in schedule:
        if item.get("id") == item_id:
            target_item = item
            break

    if not target_item:
        return ApiResponse(code=1001, data=None, message="产检项目不存在")

    now = datetime.now()
    # 创建一条已完成的产检记录，标记为推荐
    from backend.models.checkup import PrenatalCheckup
    checkup = PrenatalCheckup(
        id=str(uuid.uuid4()),
        pregnancy_id=pregnancy_id,
        checkup_date=now.date(),
        gestational_week=target_item.get("week_start", 0),
        gestational_day=0,
        checkup_type=target_item.get("name", "常规产检"),
        is_completed=1,
        is_recommended=1,
        notes=f"从产检时间表标记完成: {', '.join(target_item.get('items', []))}",
    )
    db.add(checkup)
    await db.flush()

    return ApiResponse(message="已标记完成")
