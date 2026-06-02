"""孕程记 - LabResult Pydantic Schema。"""

from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field


class LabResultCreate(BaseModel):
    """录入检查指标请求。"""
    checkup_id: str = Field(description="产检记录ID")
    category: str = Field(description="blood_routine/urine_routine/ultrasound/hcg_progesterone/glucose")
    item_name: str = Field(description="指标名称")
    value: float = Field(description="数值")
    unit: str = Field(description="单位")
    reference_min: Optional[float] = Field(None, description="标准下限")
    reference_max: Optional[float] = Field(None, description="标准上限")
    status: str = Field(default="normal", description="low/normal/high")


class LabResultUpdate(BaseModel):
    """更新指标请求。"""
    value: Optional[float] = None
    unit: Optional[str] = None
    reference_min: Optional[float] = None
    reference_max: Optional[float] = None
    status: Optional[str] = None


class LabResultResponse(BaseModel):
    """检查指标响应。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    checkup_id: str
    category: str
    item_name: str
    value: float
    unit: str
    reference_min: Optional[float] = None
    reference_max: Optional[float] = None
    status: str
    created_at: datetime


class LabResultTrendPoint(BaseModel):
    """指标趋势数据点。"""
    gestational_week: int
    value: float
    checkup_date: date
    reference_min: Optional[float] = None
    reference_max: Optional[float] = None


class LabResultTrendResponse(BaseModel):
    """指标趋势响应。"""
    model_config = ConfigDict(from_attributes=True)
    category: str
    item_name: str
    unit: str
    points: List[LabResultTrendPoint] = Field(default_factory=list)
