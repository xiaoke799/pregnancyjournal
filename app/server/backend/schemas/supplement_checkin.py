"""孕程记 - SupplementCheckin Pydantic Schema。"""

import json
from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field, field_validator


class SupplementCheckinCreate(BaseModel):
    """创建/更新营养补充打卡请求（按日期 upsert）。"""
    pregnancy_id: str = Field(description="孕期ID")
    checkin_date: date = Field(validation_alias="date", description="打卡日期 YYYY-MM-DD")
    items: List[str] = Field(default_factory=list, description="已勾选项目列表")
    notes: Optional[str] = Field(None, description="备注")

    @field_validator("items", mode="before")
    @classmethod
    def parse_items_json(cls, v):
        """兼容 JSON 字符串和列表输入。"""
        if isinstance(v, str):
            try:
                return json.loads(v)
            except (json.JSONDecodeError, TypeError):
                return []
        return v


class SupplementCheckinUpdate(BaseModel):
    """更新营养补充打卡请求。"""
    items: Optional[List[str]] = None
    notes: Optional[str] = None


class SupplementCheckinResponse(BaseModel):
    """营养补充打卡响应。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    pregnancy_id: str
    checkin_date: date = Field(validation_alias="date", serialization_alias="date")
    items: List[str]
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    @field_validator("items", mode="before")
    @classmethod
    def parse_items_json(cls, v):
        """从 JSON 字符串解析为列表。"""
        if isinstance(v, str):
            try:
                return json.loads(v)
            except (json.JSONDecodeError, TypeError):
                return []
        return v
