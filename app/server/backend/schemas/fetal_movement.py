"""孕程记 - FetalMovement Pydantic Schema。"""

from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field


class FetalMovementSessionCreate(BaseModel):
    """创建胎动计数会话请求。"""
    pregnancy_id: str = Field(description="孕期ID")


class FetalMovementSessionUpdate(BaseModel):
    """结束胎动计数会话请求。"""
    notes: Optional[str] = None


class FetalMovementResponse(BaseModel):
    """单次胎动响应。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    session_id: str
    timestamp: datetime


class FetalMovementSessionResponse(BaseModel):
    """胎动计数会话响应。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    pregnancy_id: str
    session_date: date
    start_time: str
    end_time: Optional[str] = None
    total_count: int
    notes: Optional[str] = None
    created_at: datetime
    movements: List[FetalMovementResponse] = Field(default_factory=list)
