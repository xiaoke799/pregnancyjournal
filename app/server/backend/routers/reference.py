"""孕程记 - 参考数据 API。"""

import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Query

from backend.config import settings
from backend.schemas.common import ApiResponse

router = APIRouter()


def _load_json(filename: str):
    """加载 JSON 数据文件。"""
    filepath = Path(settings.DATA_DIR) / filename
    if not filepath.exists():
        return None
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


@router.get("/reference/development/{week}", response_model=ApiResponse)
async def get_development_by_week(week: int):
    """获取指定孕周发育参考。"""
    data = _load_json("fetal_development.json")
    if not data:
        return ApiResponse(code=1001, data=None, message="数据文件不存在")
    for item in data:
        if item["week"] == week:
            return ApiResponse(data=item)
    return ApiResponse(code=1001, data=None, message=f"第{week}周数据不存在")


@router.get("/reference/development", response_model=ApiResponse)
async def get_all_development():
    """获取全部40周发育数据。"""
    data = _load_json("fetal_development.json")
    return ApiResponse(data=data)


@router.get("/reference/checkup-plan", response_model=ApiResponse)
async def get_checkup_plan():
    """获取标准产检时间表。"""
    data = _load_json("checkup_standards.json")
    return ApiResponse(data=data)


@router.get("/reference/checkup-items/{checkup_type}", response_model=ApiResponse)
async def get_checkup_knowledge(checkup_type: str):
    """获取产检项目说明。"""
    data = _load_json("checkup_items_knowledge.json")
    if not data:
        return ApiResponse(code=1001, data=None, message="数据文件不存在")
    for item in data:
        if item["type"] == checkup_type:
            return ApiResponse(data=item)
    return ApiResponse(data=data)


@router.get("/reference/ranges/{category}", response_model=ApiResponse)
async def get_reference_ranges(category: str):
    """获取指标标准范围。"""
    data = _load_json("reference_ranges.json")
    if not data:
        return ApiResponse(code=1001, data=None, message="数据文件不存在")
    category_data = data.get(category)
    if not category_data:
        return ApiResponse(code=1001, data=None, message=f"类别 {category} 不存在")
    return ApiResponse(data=category_data)


@router.get("/reference/iom-weight", response_model=ApiResponse)
async def get_iom_weight_standards():
    """获取 IOM 体重标准。"""
    data = _load_json("iom_weight_standards.json")
    return ApiResponse(data=data)


@router.get("/reference/food-safety", response_model=ApiResponse)
async def get_food_safety(keyword: Optional[str] = Query(None, description="搜索关键词")):
    """食材安全搜索/列表。"""
    data = _load_json("food_safety.json")
    if not data:
        return ApiResponse(code=1001, data=None, message="数据文件不存在")

    if not keyword:
        return ApiResponse(data=data)

    results = []
    for category in data.get("categories", []):
        for item in category.get("items", []):
            if keyword in item["name"]:
                results.append({**item, "category": category["name"]})

    return ApiResponse(data={"keyword": keyword, "results": results, "total": len(results)})
