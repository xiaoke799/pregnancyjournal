"""孕程记 - 通用响应格式 Schema。"""

from typing import Any, Generic, List, Optional, TypeVar
from pydantic import BaseModel, Field

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    """统一 API 响应格式。"""
    code: int = Field(default=0, description="状态码，0=成功")
    data: Optional[T] = Field(default=None, description="响应数据")
    message: str = Field(default="success", description="响应消息")


class PaginatedData(BaseModel, Generic[T]):
    """分页数据结构。"""
    items: List[T] = Field(default_factory=list, description="数据列表")
    total: int = Field(default=0, description="总条数")
    page: int = Field(default=1, description="当前页码")
    page_size: int = Field(default=20, description="每页条数")


class PaginatedResponse(BaseModel, Generic[T]):
    """分页 API 响应格式。"""
    code: int = Field(default=0, description="状态码")
    data: Optional[PaginatedData[T]] = Field(default=None, description="分页数据")
    message: str = Field(default="success", description="响应消息")
