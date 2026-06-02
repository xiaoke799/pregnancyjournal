"""孕程记 - Checkup Pydantic Schema。"""

from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field


# ──────────────── 标准产检 ────────────────

class CheckupCreate(BaseModel):
    """创建产检记录请求。"""
    pregnancy_id: str = Field(description="孕期ID")
    checkup_date: date = Field(description="产检日期 YYYY-MM-DD")
    gestational_week: int = Field(description="产检时孕周")
    gestational_day: int = Field(default=0, description="产检时孕天")
    checkup_type: str = Field(description="检查类型")
    weight: Optional[float] = Field(None, description="体重(kg)")
    blood_pressure: Optional[str] = Field(None, description="血压")
    fetal_heart_rate: Optional[int] = Field(None, description="胎心率(bpm)")
    fundal_height: Optional[float] = Field(None, description="宫高(cm)")
    abdominal_circumference: Optional[float] = Field(None, description="腹围(cm)")
    hospital: Optional[str] = Field(None, description="检查医院")
    notes: Optional[str] = Field(None, description="备注")
    is_completed: int = Field(default=0, description="是否已完成")
    is_recommended: int = Field(default=0, description="是否为推荐标准产检")


class CheckupUpdate(BaseModel):
    """更新产检记录请求。"""
    checkup_date: Optional[date] = None
    gestational_week: Optional[int] = None
    gestational_day: Optional[int] = None
    checkup_type: Optional[str] = None
    weight: Optional[float] = None
    blood_pressure: Optional[str] = None
    fetal_heart_rate: Optional[int] = None
    fundal_height: Optional[float] = None
    abdominal_circumference: Optional[float] = None
    hospital: Optional[str] = None
    notes: Optional[str] = None
    is_completed: Optional[int] = None
    is_recommended: Optional[int] = None


class CheckupPhotoResponse(BaseModel):
    """产检照片响应。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    checkup_id: str
    file_path: str
    thumbnail_path: Optional[str] = None
    note: Optional[str] = None
    created_at: datetime


class CheckupResponse(BaseModel):
    """产检记录响应。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    pregnancy_id: str
    checkup_date: date
    gestational_week: int
    gestational_day: int
    checkup_type: str
    weight: Optional[float] = None
    blood_pressure: Optional[str] = None
    fetal_heart_rate: Optional[int] = None
    fundal_height: Optional[float] = None
    abdominal_circumference: Optional[float] = None
    hospital: Optional[str] = None
    notes: Optional[str] = None
    is_completed: int
    is_recommended: int = 0
    created_at: datetime
    updated_at: datetime
    photos: List[CheckupPhotoResponse] = Field(default_factory=list)


# ──────────────── 自定义产检 ────────────────

class CustomCheckupCreate(BaseModel):
    """创建自定义产检请求。"""
    pregnancy_id: str = Field(description="孕期ID")
    name: str = Field(description="检查名称，如 '额外B超'")
    items: Optional[List[str]] = Field(None, description="检查子项列表，如 [\"B超\",\"血常规\"]")
    checkup_date: Optional[date] = Field(None, description="计划检查日期")
    notes: Optional[str] = Field(None, description="备注")


class CustomCheckupUpdate(BaseModel):
    """更新自定义产检请求。"""
    name: Optional[str] = Field(None, description="检查名称")
    items: Optional[List[str]] = Field(None, description="检查子项列表")
    checkup_date: Optional[date] = Field(None, description="计划检查日期")
    notes: Optional[str] = Field(None, description="备注")
    is_completed: Optional[int] = Field(None, description="是否已完成")


class CustomCheckupResponse(BaseModel):
    """自定义产检响应。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    pregnancy_id: str
    name: str
    items: Optional[List[str]] = None
    checkup_date: Optional[date] = None
    notes: Optional[str] = None
    is_completed: int = 0
    created_at: datetime
    updated_at: datetime


# ──────────────── 产检报告附件 ────────────────

class CheckupReportResponse(BaseModel):
    """产检报告附件响应。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    checkup_id: str
    checkup_type: str
    filename: str
    file_path: str
    file_type: str
    file_size: int
    report_category: str = "other"
    sub_item: Optional[str] = None
    created_at: datetime
