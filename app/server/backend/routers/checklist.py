"""孕程记 - 清单 API。"""

import json
import uuid
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.checklist import Checklist, ChecklistItem
from backend.schemas.common import ApiResponse
from backend.schemas.checklist import (
    ChecklistItemCreate, ChecklistItemUpdate, ChecklistItemResponse, ChecklistResponse,
)
from backend.config import settings

router = APIRouter()

# 默认清单配置：四种类型及其对应的数据文件和显示名称
_DEFAULT_CHECKLISTS = [
    {"type": "delivery_bag", "name": "待产包清单", "file": "default_checklist_delivery.json"},
    {"type": "newborn_prep", "name": "新生儿准备清单", "file": "default_checklist_newborn.json"},
    {"type": "delivery_check", "name": "产房待检清单", "file": "default_checklist_delivery_check.json"},
    {"type": "confinement", "name": "月子物品清单", "file": "default_checklist_confinement.json"},
]


async def _ensure_default_checklists(pregnancy_id: str, db: AsyncSession) -> List[Checklist]:
    """确保存在默认清单，如果不存在则自动创建。"""
    result = await db.execute(
        select(Checklist).where(Checklist.pregnancy_id == pregnancy_id)
    )
    existing = result.scalars().all()

    if len(existing) > 0:
        return existing

    created_lists = []
    for cfg in _DEFAULT_CHECKLISTS:
        checklist = Checklist(
            id=str(uuid.uuid4()),
            pregnancy_id=pregnancy_id,
            type=cfg["type"],
            name=cfg["name"],
        )
        db.add(checklist)
        await db.flush()

        filepath = Path(settings.DATA_DIR) / cfg["file"]
        if filepath.exists():
            with open(filepath, "r", encoding="utf-8") as f:
                default_data = json.load(f)

            sort_order = 0
            for cat in default_data.get("categories", []):
                category_name = cat.get("category", "")
                for item_data in cat.get("items", []):
                    if isinstance(item_data, str):
                        item_name = item_data
                        item_desc = None
                        item_mandatory = 0
                    else:
                        item_name = item_data.get("name", "")
                        item_desc = item_data.get("description")
                        item_mandatory = 1 if item_data.get("mandatory", False) else 0
                    item = ChecklistItem(
                        id=str(uuid.uuid4()),
                        checklist_id=checklist.id,
                        name=item_name,
                        description=item_desc,
                        category=category_name,
                        is_checked=0,
                        is_custom=0,
                        is_mandatory=item_mandatory,
                        sort_order=sort_order,
                    )
                    db.add(item)
                    sort_order += 1

        created_lists.append(checklist)

    await db.flush()
    return created_lists


@router.get("/checklists/progress", response_model=ApiResponse)
async def get_checklist_progress(pregnancy_id: str, db: AsyncSession = Depends(get_db)):
    """获取清单完成进度汇总。"""
    result = await db.execute(
        select(Checklist).where(Checklist.pregnancy_id == pregnancy_id)
    )
    checklists = result.scalars().all()

    total_items = 0
    checked_items = 0
    checklist_details = []

    for cl in checklists:
        result = await db.execute(
            select(ChecklistItem).where(ChecklistItem.checklist_id == cl.id)
        )
        items = result.scalars().all()
        cl_total = len(items)
        cl_checked = sum(1 for i in items if i.is_checked == 1)
        total_items += cl_total
        checked_items += cl_checked
        checklist_details.append({
            "id": cl.id,
            "name": cl.name,
            "type": cl.type,
            "total": cl_total,
            "checked": cl_checked,
            "percentage": round(cl_checked / cl_total * 100) if cl_total > 0 else 0,
        })

    return ApiResponse(data={
        "total": total_items,
        "checked": checked_items,
        "percentage": round(checked_items / total_items * 100) if total_items > 0 else 0,
        "checklists": checklist_details,
    })


@router.get("/checklists", response_model=ApiResponse[List[ChecklistResponse]])
async def list_checklists(pregnancy_id: str, db: AsyncSession = Depends(get_db)):
    """清单列表（自动初始化默认清单）。"""
    checklists = await _ensure_default_checklists(pregnancy_id, db)
    return ApiResponse(data=[ChecklistResponse.model_validate(c) for c in checklists])


@router.get("/checklists/{checklist_id}", response_model=ApiResponse[ChecklistResponse])
async def get_checklist(checklist_id: str, db: AsyncSession = Depends(get_db)):
    """清单详情（含条目）。"""
    checklist = await db.get(Checklist, checklist_id)
    if not checklist:
        return ApiResponse(code=1001, data=None, message="清单不存在")
    return ApiResponse(data=ChecklistResponse.model_validate(checklist))


@router.put("/checklists/{checklist_id}", response_model=ApiResponse[ChecklistResponse])
async def update_checklist(checklist_id: str, name: str = None, db: AsyncSession = Depends(get_db)):
    """更新清单。"""
    checklist = await db.get(Checklist, checklist_id)
    if not checklist:
        return ApiResponse(code=1001, data=None, message="清单不存在")
    if name:
        checklist.name = name
    await db.flush()
    await db.refresh(checklist)
    return ApiResponse(data=ChecklistResponse.model_validate(checklist))


@router.post("/checklists/{checklist_id}/items", response_model=ApiResponse[ChecklistItemResponse])
async def add_checklist_item(checklist_id: str, data: ChecklistItemCreate, db: AsyncSession = Depends(get_db)):
    """添加清单条目。"""
    # 获取当前最大排序号
    result = await db.execute(
        select(ChecklistItem).where(ChecklistItem.checklist_id == checklist_id).order_by(ChecklistItem.sort_order.desc())
    )
    last_item = result.scalars().first()
    sort_order = (last_item.sort_order + 1) if last_item else 0

    item = ChecklistItem(
        checklist_id=checklist_id,
        name=data.name,
        description=data.description,
        category=data.category,
        is_custom=data.is_custom,
        is_mandatory=data.is_mandatory,
        sort_order=sort_order,
    )
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return ApiResponse(data=ChecklistItemResponse.model_validate(item))


@router.put("/checklists/items/{item_id}", response_model=ApiResponse[ChecklistItemResponse])
async def update_checklist_item(item_id: str, data: ChecklistItemUpdate, db: AsyncSession = Depends(get_db)):
    """更新条目（勾选/改名）。"""
    item = await db.get(ChecklistItem, item_id)
    if not item:
        return ApiResponse(code=1001, data=None, message="条目不存在")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await db.flush()
    await db.refresh(item)
    return ApiResponse(data=ChecklistItemResponse.model_validate(item))


@router.delete("/checklists/items/{item_id}", response_model=ApiResponse)
async def delete_checklist_item(item_id: str, db: AsyncSession = Depends(get_db)):
    """删除条目。"""
    item = await db.get(ChecklistItem, item_id)
    if not item:
        return ApiResponse(code=1001, data=None, message="条目不存在")
    await db.delete(item)
    return ApiResponse(message="删除成功")


@router.post("/checklists/{checklist_id}/init-default", response_model=ApiResponse[ChecklistResponse])
async def init_default_checklist(checklist_id: str, db: AsyncSession = Depends(get_db)):
    """初始化默认清单。"""
    checklist = await db.get(Checklist, checklist_id)
    if not checklist:
        return ApiResponse(code=1001, data=None, message="清单不存在")

    # 根据类型加载默认数据
    type_to_file = {
        "delivery_bag": "default_checklist_delivery.json",
        "newborn_prep": "default_checklist_newborn.json",
        "delivery_check": "default_checklist_delivery_check.json",
        "confinement": "default_checklist_confinement.json",
    }

    filename = type_to_file.get(checklist.type)
    if not filename:
        return ApiResponse(code=1002, data=None, message="不支持的清单类型")

    filepath = Path(settings.DATA_DIR) / filename
    if not filepath.exists():
        return ApiResponse(code=2002, data=None, message="默认数据文件不存在")

    with open(filepath, "r", encoding="utf-8") as f:
        default_data = json.load(f)

    # 清空现有条目
    result = await db.execute(select(ChecklistItem).where(ChecklistItem.checklist_id == checklist_id))
    for item in result.scalars().all():
        await db.delete(item)

    # 插入默认条目
    sort_order = 0
    categories = default_data.get("categories", [])
    for cat in categories:
        category_name = cat.get("category", "")
        for item_data in cat.get("items", []):
            if isinstance(item_data, str):
                item_name = item_data
                item_desc = None
                item_mandatory = 0
            else:
                item_name = item_data.get("name", "")
                item_desc = item_data.get("description")
                item_mandatory = 1 if item_data.get("mandatory", False) else 0
            item = ChecklistItem(
                id=str(uuid.uuid4()),
                checklist_id=checklist_id,
                name=item_name,
                description=item_desc,
                category=category_name,
                is_checked=0,
                is_custom=0,
                is_mandatory=item_mandatory,
                sort_order=sort_order,
            )
            db.add(item)
            sort_order += 1

    await db.flush()
    await db.refresh(checklist)
    return ApiResponse(data=ChecklistResponse.model_validate(checklist))
