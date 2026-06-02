"""孕程记 - Diary Pydantic Schema。"""

from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class DiaryCreate(BaseModel):
    """创建日记请求。"""
    pregnancy_id: str = Field(description="孕期ID")
    entry_date: date = Field(description="日记日期 YYYY-MM-DD")
    gestational_week: Optional[int] = Field(None, description="孕周")
    content: str = Field(description="日记内容（富文本HTML）")
    photo_ids: Optional[str] = Field(None, description="关联照片ID列表（JSON数组）")


class DiaryUpdate(BaseModel):
    """更新日记请求。"""
    content: Optional[str] = None
    photo_ids: Optional[str] = None


class DiaryResponse(BaseModel):
    """日记响应。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    pregnancy_id: str
    entry_date: date
    gestational_week: Optional[int] = None
    content: str
    photo_ids: Optional[str] = None
    created_at: datetime
    updated_at: datetime
