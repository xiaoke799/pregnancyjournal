"""孕程记 - 提醒 API。"""

from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.reminder import Reminder
from backend.schemas.common import ApiResponse
from backend.schemas.reminder import ReminderCreate, ReminderUpdate, ReminderResponse

router = APIRouter()


@router.post("/reminders", response_model=ApiResponse[ReminderResponse])
async def create_reminder(data: ReminderCreate, db: AsyncSession = Depends(get_db)):
    """创建提醒。"""
    reminder = Reminder(**data.model_dump())
    db.add(reminder)
    await db.flush()
    return ApiResponse(data=ReminderResponse.model_validate(reminder))


@router.get("/reminders", response_model=ApiResponse[List[ReminderResponse]])
async def list_reminders(pregnancy_id: str, db: AsyncSession = Depends(get_db)):
    """提醒列表。"""
    result = await db.execute(
        select(Reminder).where(Reminder.pregnancy_id == pregnancy_id).order_by(Reminder.trigger_date)
    )
    reminders = result.scalars().all()
    return ApiResponse(data=[ReminderResponse.model_validate(r) for r in reminders])


@router.get("/reminders/upcoming", response_model=ApiResponse[List[ReminderResponse]])
async def get_upcoming_reminders(
    pregnancy_id: str,
    days: int = Query(default=7, description="未来几天内的提醒"),
    db: AsyncSession = Depends(get_db),
):
    """获取即将到来的提醒。"""
    today = date.today()
    future = today + timedelta(days=days)
    result = await db.execute(
        select(Reminder).where(
            Reminder.pregnancy_id == pregnancy_id,
            Reminder.is_enabled == 1,
            Reminder.trigger_date >= today,
            Reminder.trigger_date <= future,
        ).order_by(Reminder.trigger_date, Reminder.trigger_time)
    )
    reminders = result.scalars().all()
    return ApiResponse(data=[ReminderResponse.model_validate(r) for r in reminders])


@router.get("/reminders/{reminder_id}", response_model=ApiResponse[ReminderResponse])
async def get_reminder(reminder_id: str, db: AsyncSession = Depends(get_db)):
    """提醒详情。"""
    reminder = await db.get(Reminder, reminder_id)
    if not reminder:
        return ApiResponse(code=1001, data=None, message="提醒不存在")
    return ApiResponse(data=ReminderResponse.model_validate(reminder))


@router.put("/reminders/{reminder_id}", response_model=ApiResponse[ReminderResponse])
async def update_reminder(reminder_id: str, data: ReminderUpdate, db: AsyncSession = Depends(get_db)):
    """更新提醒。"""
    reminder = await db.get(Reminder, reminder_id)
    if not reminder:
        return ApiResponse(code=1001, data=None, message="提醒不存在")
    update_data = data.model_dump(exclude_unset=True)
    if 'is_completed' in update_data:
        update_data['is_triggered'] = update_data.pop('is_completed')
    allowed_fields = {"title", "reminder_type", "trigger_time", "repeat_rule", "is_enabled", "is_triggered", "notes"}
    for key, value in update_data.items():
        if key in allowed_fields:
            setattr(reminder, key, value)
    await db.flush()
    return ApiResponse(data=ReminderResponse.model_validate(reminder))


@router.delete("/reminders/{reminder_id}", response_model=ApiResponse)
async def delete_reminder(reminder_id: str, db: AsyncSession = Depends(get_db)):
    """删除提醒。"""
    reminder = await db.get(Reminder, reminder_id)
    if not reminder:
        return ApiResponse(code=1001, data=None, message="提醒不存在")
    await db.delete(reminder)
    return ApiResponse(message="删除成功")
