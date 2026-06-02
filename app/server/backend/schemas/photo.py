"""孕程记 - Photo Pydantic Schema。"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class PhotoCreate(BaseModel):
    """上传照片请求（multipart，此 Schema 仅用于元数据）。"""
    pregnancy_id: str = Field(description="孕期ID")
    photo_type: str = Field(description="belly/ultrasound/milestone/baby/checkup_report")
    gestational_week: Optional[int] = Field(None, description="孕周")
    gestational_day: Optional[int] = Field(default=0, description="孕天")
    milestone_type: Optional[str] = Field(None, description="里程碑类型")
    checkup_id: Optional[str] = Field(None, description="关联产检记录ID")
    note: Optional[str] = Field(None, description="照片备注")
    media_type: Optional[str] = Field(default="photo", description="媒体类型(photo/video)")


class PhotoUpdate(BaseModel):
    """更新照片信息请求。"""
    note: Optional[str] = None
    gestational_week: Optional[int] = None
    gestational_day: Optional[int] = None
    milestone_type: Optional[str] = None
    media_type: Optional[str] = None


class PhotoResponse(BaseModel):
    """照片响应。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    pregnancy_id: str
    checkup_id: Optional[str] = None
    photo_type: str
    gestational_week: Optional[int] = None
    gestational_day: Optional[int] = None
    milestone_type: Optional[str] = None
    file_path: str
    thumbnail_path: Optional[str] = None
    note: Optional[str] = None
    media_type: Optional[str] = "photo"
    created_at: datetime
