"""孕程记 - Pregnancy Pydantic Schema。"""

from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class PregnancyCreate(BaseModel):
    """创建孕期档案请求。"""
    last_period_date: Optional[date] = Field(None, description="末次月经日期 YYYY-MM-DD")
    conception_date: Optional[date] = Field(None, description="受精日期 YYYY-MM-DD")
    due_date: Optional[date] = Field(None, description="预产期 YYYY-MM-DD（直接设置时）")
    baby_name: Optional[str] = Field(None, description="宝宝昵称")


class PregnancyUpdate(BaseModel):
    """更新孕期档案请求。"""
    last_period_date: Optional[date] = None
    conception_date: Optional[date] = None
    due_date: Optional[date] = None
    baby_name: Optional[str] = None
    is_active: Optional[int] = None


class PregnancyResponse(BaseModel):
    """孕期档案响应。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    last_period_date: date
    conception_date: Optional[date] = None
    due_date: date
    is_active: int
    baby_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class GestationalAgeResponse(BaseModel):
    """孕周信息响应。"""
    model_config = ConfigDict(from_attributes=True)
    weeks: int = Field(description="孕周")
    days: int = Field(description="孕天")
    total_days: int = Field(description="总天数")
    due_date: date = Field(description="预产期")
    days_until_due: int = Field(description="距预产期天数")
    trimester: str = Field(description="孕期阶段：孕早期/孕中期/孕晚期")
