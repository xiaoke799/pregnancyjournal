"""孕程记 - Checklist Pydantic Schema。"""

from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field


class ChecklistItemCreate(BaseModel):
    """添加清单条目请求。"""
    name: str = Field(description="条目名称")
    description: Optional[str] = Field(None, description="物品用途描述")
    category: Optional[str] = Field(None, description="分类")
    is_custom: int = Field(default=1, description="是否用户自定义")
    is_mandatory: int = Field(default=0, description="是否必备物品")


class ChecklistItemUpdate(BaseModel):
    """更新清单条目请求。"""
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    is_checked: Optional[int] = None
    is_mandatory: Optional[int] = None
    sort_order: Optional[int] = None


class ChecklistItemResponse(BaseModel):
    """清单条目响应。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    checklist_id: str
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    is_checked: int
    is_custom: int
    is_mandatory: int
    sort_order: int


class ChecklistResponse(BaseModel):
    """清单响应。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    pregnancy_id: str
    type: str
    name: str
    created_at: str
    updated_at: str
    items: List[ChecklistItemResponse] = Field(default_factory=list)
