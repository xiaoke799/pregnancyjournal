"""孕程记 - Diet 饮食 Pydantic Schema。"""

from typing import List, Optional
from pydantic import BaseModel, Field


class RecipeSchema(BaseModel):
    """食谱数据结构。"""
    id: str = Field(description="食谱ID")
    name: str = Field(description="菜名")
    category: str = Field(description="分类（荤菜/素菜/汤品/主食/甜品/饮品）")
    suitable_weeks: List[int] = Field(description="适用孕周范围 [起始周, 结束周]")
    suitable_stage: List[str] = Field(description="适用阶段(preparing/early/mid/late/nursing)")
    ingredients: List[str] = Field(description="食材列表")
    nutrition: str = Field(description="营养价值说明")
    image: Optional[str] = Field(None, description="图片路径")
    description: str = Field(description="描述")


class FoodSafetyItemSchema(BaseModel):
    """食物安全条目。"""
    name: str = Field(description="食物名称")
    safety_by_stage: dict = Field(description="各阶段安全标识(preparing/early/mid/late/nursing)")
    note: str = Field(description="说明")
    image: Optional[str] = Field(None, description="图片路径")


class FoodSafetyCategorySchema(BaseModel):
    """食物安全分类。"""
    name: str = Field(description="分类名称")
    icon: str = Field(description="分类图标")
    items: List[FoodSafetyItemSchema] = Field(description="食物列表")
