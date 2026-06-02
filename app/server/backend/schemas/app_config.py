"""孕程记 - AppConfig Pydantic Schema。"""

from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class AppConfigCreate(BaseModel):
    """创建应用配置请求。"""
    key: str = Field(description="配置键")
    value: str = Field(description="配置值（JSON字符串）")
    description: Optional[str] = Field(None, description="配置说明")


class AppConfigUpdate(BaseModel):
    """更新应用配置请求。"""
    value: str = Field(description="配置值（JSON字符串）")
    description: Optional[str] = Field(None, description="配置说明")


class AppConfigResponse(BaseModel):
    """应用配置响应。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    key: str
    value: str
    description: Optional[str] = None
    updated_at: datetime


class SetupWizardData(BaseModel):
    """首次设置向导请求。"""
    storage_dir: Optional[str] = Field(default="", description="存储目录路径（默认使用系统路径）")
    stage: str = Field(description="当前阶段(preparing/early/mid/late/nursing)")
    due_date: Optional[date] = Field(None, description="预产期 YYYY-MM-DD")
    last_period_date: Optional[date] = Field(None, description="末次月经日期 YYYY-MM-DD")
    baby_name: Optional[str] = Field(None, description="宝宝昵称")
