"""孕程记 - Contraction Pydantic Schema。"""

from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field


class ContractionStart(BaseModel):
    """记录一次宫缩请求。"""
    action: str = Field(description="start, end 或 manual")
    start_time: Optional[datetime] = Field(default=None, description="手动输入的开始时间（manual 模式必填）")
    end_time: Optional[datetime] = Field(default=None, description="手动输入的结束时间（manual 模式必填）")


class ContractionSessionCreate(BaseModel):
    """创建宫缩计时会话请求。"""
    pregnancy_id: str = Field(description="孕期ID")


class ContractionSessionUpdate(BaseModel):
    """结束宫缩计时会话请求。"""
    notes: Optional[str] = None


class ContractionResponse(BaseModel):
    """单次宫缩响应。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    session_id: str
    start_time: datetime
    end_time: Optional[datetime] = None
    duration: Optional[float] = None
    interval_from_prev: Optional[float] = None


class ContractionSessionResponse(BaseModel):
    """宫缩计时会话响应。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    pregnancy_id: str
    session_date: date
    start_time: datetime
    end_time: Optional[datetime] = None
    total_count: int
    avg_duration: Optional[float] = None
    avg_interval: Optional[float] = None
    alert_triggered: int
    notes: Optional[str] = None
    contractions: List[ContractionResponse] = Field(default_factory=list)


class ContractionAnalysisResponse(BaseModel):
    """5-1-1 分析结果响应。"""
    model_config = ConfigDict(from_attributes=True)
    session_id: str
    total_count: int = Field(description="总宫缩次数")
    avg_duration: float = Field(description="平均持续时间(秒)")
    avg_interval: float = Field(description="平均间隔(秒)")
    last_hour_count: int = Field(description="最近1小时宫缩次数")
    is_511_met: bool = Field(description="是否满足5-1-1法则")
    recommendation: str = Field(description="建议信息")
