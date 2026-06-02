"""孕程记 - Reminder Pydantic Schema。"""

from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class ReminderCreate(BaseModel):
    """创建提醒请求。"""
    pregnancy_id: str = Field(description="孕期ID")
    reminder_type: str = Field(description="checkup/medication/supplement/exercise/record/custom")
    title: str = Field(description="提醒标题")
    trigger_date: Optional[date] = Field(None, description="触发日期 YYYY-MM-DD")
    trigger_time: Optional[str] = Field(None, description="触发时间 HH:MM")
    advance_days: Optional[int] = Field(default=0, description="提前几天提醒")
    repeat_rule: str = Field(default="once", description="once/daily/weekly/monthly")
    source_type: Optional[str] = Field(None, description="来源类型: checkup_schedule/checkup/daily_record")
    source_id: Optional[str] = Field(None, description="来源ID")


class ReminderUpdate(BaseModel):
    """更新提醒请求。"""
    title: Optional[str] = None
    trigger_date: Optional[date] = None
    trigger_time: Optional[str] = None
    advance_days: Optional[int] = None
    repeat_rule: Optional[str] = None
    is_enabled: Optional[int] = None
    is_triggered: Optional[int] = None
    is_completed: Optional[int] = None


class ReminderResponse(BaseModel):
    """提醒响应（含来源关联信息）。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    pregnancy_id: str
    reminder_type: str
    title: str
    trigger_date: Optional[date] = None
    trigger_time: Optional[str] = None
    advance_days: Optional[int] = None
    repeat_rule: str
    is_enabled: int
    is_triggered: int
    source_type: Optional[str] = None
    source_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
