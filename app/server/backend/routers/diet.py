"""孕程记 - 饮食 API（食谱推荐 + 食物安全）。"""

import json
import os
import random
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import get_db
from backend.schemas.common import ApiResponse
from backend.schemas.diet import RecipeSchema, FoodSafetyCategorySchema, FoodSafetyItemSchema

router = APIRouter()

# 数据缓存
_recipes_cache: Optional[List[dict]] = None
_food_safety_cache: Optional[dict] = None


def _load_recipes() -> List[dict]:
    """加载食谱数据（带缓存）。"""
    global _recipes_cache
    if _recipes_cache is None:
        filepath = os.path.join(settings.DATA_DIR, "recipes.json")
        if os.path.exists(filepath):
            with open(filepath, "r", encoding="utf-8") as f:
                _recipes_cache = json.load(f)
        else:
            _recipes_cache = []
    return _recipes_cache


def _convert_safety_to_by_stage(safety: str) -> dict:
    """将 v3 单值 safety 转换为 safety_by_stage 多阶段对象。

    转换规则（基于孕期营养学常识）:
    - safe:     全阶段安全
    - caution:  备孕/哺乳安全，早中晚谨慎
    - avoid:    备孕谨慎，早期不安全，中晚哺乳谨慎
    - limit:    全阶段限制
    """
    _MAPPING = {
        "safe": {
            "preparing": "safe",
            "early": "safe",
            "mid": "safe",
            "late": "safe",
            "nursing": "safe",
        },
        "caution": {
            "preparing": "safe",
            "early": "caution",
            "mid": "caution",
            "late": "caution",
            "nursing": "safe",
        },
        "avoid": {
            "preparing": "caution",
            "early": "unsafe",
            "mid": "caution",
            "late": "caution",
            "nursing": "caution",
        },
        "limit": {
            "preparing": "limit",
            "early": "limit",
            "mid": "limit",
            "late": "limit",
            "nursing": "limit",
        },
    }
    return _MAPPING.get(safety, _MAPPING["caution"])


def _load_food_safety() -> dict:
    """加载食物安全数据（带缓存 + v3→标准格式转换）。"""
    global _food_safety_cache
    if _food_safety_cache is None:
        filepath = os.path.join(settings.DATA_DIR, "food_safety_v3.json")
        if os.path.exists(filepath):
            with open(filepath, "r", encoding="utf-8") as f:
                raw = json.load(f)
            converted = {"categories": []}
            for cat in raw.get("categories", []):
                new_items = []
                for item in cat.get("items", []):
                    sbs = item.get("safety_by_stage")
                    if not sbs:
                        safety_val = item.get("safety", "caution")
                        sbs = _convert_safety_to_by_stage(safety_val)
                    new_item = {
                        "name": item.get("name", ""),
                        "safety_by_stage": sbs,
                        "note": item.get("note", ""),
                        "image": item.get("image"),
                    }
                    new_items.append(new_item)
                converted["categories"].append({
                    "name": cat.get("name", ""),
                    "icon": cat.get("icon", ""),
                    "items": new_items,
                })
            _food_safety_cache = converted
        else:
            _food_safety_cache = {"categories": []}
    return _food_safety_cache


def _week_to_stage(week: int) -> str:
    """根据孕周判断阶段。

    基于《中国孕前和孕期保健指南》（2023版）：
    - 孕早期：≤13+6周（即≤13周）
    - 孕中期：14-27+6周（即14-27周）
    - 孕晚期：≥28周
    """
    if week < 14:
        return "early"
    elif week < 28:
        return "mid"
    else:
        return "late"


@router.get("/diet/recipes", response_model=ApiResponse[List[RecipeSchema]])
async def get_recipes(
    week: int = Query(default=20, ge=0, le=42, description="孕周"),
    all: bool = Query(default=False, description="是否返回全量食谱（不过滤）"),
):
    """根据孕周获取推荐食谱。all=true 时返回全量。"""
    recipes = _load_recipes()
    if all:
        return ApiResponse(data=recipes)
    stage = _week_to_stage(week)
    matched = []
    for r in recipes:
        suitable_weeks = r.get("suitable_weeks", [0, 42])
        if len(suitable_weeks) >= 2:
            if week < suitable_weeks[0] or week > suitable_weeks[1]:
                continue
        suitable_stage = r.get("suitable_stage", [])
        if stage not in suitable_stage:
            continue
        matched.append(r)
    return ApiResponse(data=matched)


@router.post("/diet/spin", response_model=ApiResponse[RecipeSchema])
async def spin_recipe(
    week: int = Query(default=20, ge=0, le=42, description="孕周"),
):
    """随机推荐一道食谱（转盘功能）。"""
    recipes = _load_recipes()
    stage = _week_to_stage(week)
    matched = []
    for r in recipes:
        suitable_weeks = r.get("suitable_weeks", [0, 42])
        if len(suitable_weeks) >= 2:
            if week < suitable_weeks[0] or week > suitable_weeks[1]:
                continue
        suitable_stage = r.get("suitable_stage", [])
        if stage not in suitable_stage:
            continue
        matched.append(r)
    if not matched:
        return ApiResponse(code=1001, data=None, message="没有匹配的食谱")
    chosen = random.choice(matched)
    return ApiResponse(data=chosen)


@router.get("/diet/food-safety", response_model=ApiResponse[List[FoodSafetyCategorySchema]])
async def get_food_safety(
    category: Optional[str] = Query(None, description="分类名称筛选"),
):
    """获取食物安全数据。"""
    data = _load_food_safety()
    categories = data.get("categories", [])
    if category:
        categories = [c for c in categories if c.get("name") == category]
    return ApiResponse(data=categories)


@router.get("/diet/food-safety/search", response_model=ApiResponse[List[FoodSafetyItemSchema]])
async def search_food(
    keyword: str = Query(..., min_length=1, description="搜索关键词"),
):
    """搜索食物安全信息。"""
    data = _load_food_safety()
    results: List[dict] = []
    for cat in data.get("categories", []):
        for item in cat.get("items", []):
            if keyword in item.get("name", "") or keyword in item.get("note", ""):
                results.append(item)
    return ApiResponse(data=results)
