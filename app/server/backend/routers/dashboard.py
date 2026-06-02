"""孕程记 - 首页概览 API。

整合产检计划、自定义提醒、记录关联为统一的重要事件流。
"""

import logging
from datetime import date, timedelta
from typing import Dict, Optional, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.pregnancy import Pregnancy
from backend.models.daily_record import DailyRecord
from backend.models.reminder import Reminder
from backend.models.checkup import PrenatalCheckup
from backend.models.checklist import Checklist, ChecklistItem
from backend.models.fetal_movement import FetalMovementSession
from backend.models.contraction import ContractionSession
from backend.services.gestational_calculator import calculate_gestational_age, get_trimester, days_until_due
from backend.schemas.common import ApiResponse

import json
from pathlib import Path
from backend.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/dashboard/events", response_model=ApiResponse)
async def get_dashboard_events(
    pregnancy_id: str,
    days: int = Query(default=14, description="未来天数"),
    db: AsyncSession = Depends(get_db),
):
    """获取统一的重要事件列表（产检计划 + 自定义提醒 + 记录关联）。

    返回按日期排序的统一事件流，前端无需分别请求多个 API。
    每个事件包含 source_type 标识来源，支持跳转到对应详情页。
    """
    today = date.today()
    future = today + timedelta(days=days)
    events: List[dict] = []

    # ========== 1. 自定义提醒 ==========
    result = await db.execute(
        select(Reminder).where(
            Reminder.pregnancy_id == pregnancy_id,
            Reminder.is_enabled == 1,
            Reminder.trigger_date >= today,
            Reminder.trigger_date <= future,
        ).order_by(Reminder.trigger_date, Reminder.trigger_time)
    )
    reminders = result.scalars().all()
    for r in reminders:
        events.append({
            "id": r.id,
            "event_type": "reminder",
            "source_type": r.source_type or "manual",
            "source_id": r.source_id,
            "title": r.title,
            "date": r.trigger_date.isoformat() if r.trigger_date else None,
            "time": r.trigger_time,
            "icon": _reminder_icon(r.reminder_type),
            "priority": _reminder_priority(r),
            "action_url": f"/reminders/{r.id}" if not r.source_type else None,
            "is_completed": r.is_triggered == 1,
        })

    # ========== 2. 产检时间表（未完成的自动转为事件） ==========
    try:
        schedule_filepath = Path(settings.DATA_DIR) / "checkup_schedule.json"
        if schedule_filepath.exists():
            with open(schedule_filepath, "r", encoding="utf-8") as f:
                schedule_data = json.load(f)

            # 获取当前孕周
            preg_result = await db.execute(select(Pregnancy).where(Pregnancy.id == pregnancy_id))
            pregnancy = preg_result.scalar_one_or_none()
            if pregnancy:
                lmp = pregnancy.last_period_date
                weeks, _, _ = calculate_gestational_age(lmp)

                # 获取已完成的产检周次
                completed_weeks: set = set()
                checkup_result = await db.execute(
                    select(PrenatalCheckup).where(
                        PrenatalCheckup.pregnancy_id == pregnancy_id,
                        PrenatalCheckup.is_completed == 1,
                    )
                )
                for c in checkup_result.scalars().all():
                    completed_weeks.add(c.gestational_week)

                for item in schedule_data:
                    week_start = item.get("week_start", 0)
                    week_end = item.get("week_end", 0)
                    item_id = item.get("id", "")

                    # 检查是否已完成
                    is_completed = any(w in completed_weeks for w in range(week_start, week_end + 1))
                    if is_completed:
                        continue

                    # 只显示未来 14 天内的
                    est_date = lmp + timedelta(weeks=week_start)
                    if est_date < today or est_date > future:
                        continue

                    days_until = (est_date - today).days
                    events.append({
                        "id": f"schedule_{item_id}",
                        "event_type": "checkup_schedule",
                        "source_type": "checkup_schedule",
                        "source_id": item_id,
                        "title": item.get("name", "产检"),
                        "subtitle": "、".join(item.get("items", [])[:3]),
                        "date": est_date.isoformat(),
                        "time": None,
                        "icon": "🏥",
                        "priority": "high" if days_until <= 7 else "normal",
                        "gestational_week": week_start,
                        "days_until": days_until,
                        "action_url": f"/checkups?highlight={item_id}",
                        "is_completed": False,
                        "schedule_items": item.get("items", []),
                    })
    except Exception as e:
        logger.warning("加载产检时间表失败: %s", e)

    # ========== 3. 记录异常提醒（血压/血糖超标时自动提示复测） ==========
    result = await db.execute(
        select(DailyRecord).where(
            DailyRecord.pregnancy_id == pregnancy_id,
            DailyRecord.record_date >= today - timedelta(days=3),
        ).order_by(DailyRecord.record_date.desc()).limit(5)
    )
    recent_records = result.scalars().all()

    for record in recent_records:
        alerts = []
        # 血压偏高 (>140/90)
        if record.blood_pressure_systolic and record.blood_pressure_diastolic:
            sys_val = float(record.blood_pressure_systolic)
            dia_val = float(record.blood_pressure_diastolic)
            if sys_val > 140 or dia_val > 90:
                alerts.append(f"血压 {record.blood_pressure_systolic}/{record.blood_pressure_diastolic} 偏高")

        # 血糖偏高
        for field_name, label, threshold in [
            ("blood_glucose_fasting", "空腹血糖", 6.1),
            ("blood_glucose_1h", "餐后1h血糖", 10.0),
            ("blood_glucose_2h", "餐后2h血糖", 8.5),
        ]:
            val = getattr(record, field_name, None)
            if val and val > threshold:
                alerts.append(f"{label} {val}mmol/L 偏高")

        if alerts and record.record_date < today:  # 非今天的记录才提醒复测
            events.append({
                "id": f"alert_{record.id}",
                "event_type": "record_alert",
                "source_type": "daily_record",
                "source_id": record.id,
                "title": "建议复测",
                "subtitle": "；".join(alerts),
                "date": (record.record_date + timedelta(days=1)).isoformat(),  # 建议次日复测
                "time": None,
                "icon": "⚠️",
                "priority": "high",
                "action_url": f"/records?date={record.record_date}",
                "is_completed": False,
                "alert_details": alerts,
            })

    # 按日期排序
    events.sort(key=lambda e: (e.get("date") or "9999-12-31", e.get("time") or ""))

    return ApiResponse(data={
        "events": events[:20],  # 最多返回 20 条
        "summary": {
            "total": len(events),
            "high_priority": sum(1 for e in events if e.get("priority") == "high"),
            "today": sum(1 for e in events if e.get("date") == today.isoformat()),
        }
    })


def _reminder_icon(reminder_type: str) -> str:
    """根据提醒类型返回图标。"""
    icons = {
        "checkup": "🏥",
        "medication": "💊",
        "supplement": "💊",
        "exercise": "🏃",
        "record": "📝",
        "custom": "📌",
    }
    return icons.get(reminder_type, "📌")


def _reminder_priority(r: Reminder) -> str:
    """根据提醒属性判断优先级。"""
    if r.reminder_type == "checkup":
        return "high"
    if r.trigger_date and (r.trigger_date - date.today()).days <= 3:
        return "high"
    return "normal"


@router.get("/dashboard", response_model=ApiResponse)
async def get_dashboard(pregnancy_id: str, db: AsyncSession = Depends(get_db)):
    """首页仪表盘数据（含基于孕周的推荐任务）。"""
    from datetime import date as date_type

    # 获取孕期
    pregnancy = await db.get(Pregnancy, pregnancy_id)
    if not pregnancy:
        return ApiResponse(code=1004, data=None, message="孕期不存在")

    # 孕周计算
    lmp = pregnancy.last_period_date
    weeks, days, total = calculate_gestational_age(lmp)
    due = pregnancy.due_date
    days_left = days_until_due(due)
    today = date_type.today()

    # 今日记录
    result = await db.execute(
        select(DailyRecord).where(
            DailyRecord.pregnancy_id == pregnancy_id,
            DailyRecord.record_date == today,
        )
    )
    today_record = result.scalar_one_or_none()
    has_today_record = today_record is not None

    # 今日胎动次数
    fm_result = await db.execute(
        select(func.coalesce(func.sum(FetalMovementSession.total_count), 0)).where(
            FetalMovementSession.pregnancy_id == pregnancy_id,
            FetalMovementSession.session_date == today,
        )
    )
    fetal_movement_count = fm_result.scalar() or 0

    # 宫缩是否进行中
    cs_result = await db.execute(
        select(ContractionSession).where(
            ContractionSession.pregnancy_id == pregnancy_id,
            ContractionSession.end_time.is_(None),
        ).limit(1)
    )
    contraction_active = cs_result.scalar_one_or_none() is not None

    # 即将到来的提醒（7天内）
    future = today + timedelta(days=7)
    result = await db.execute(
        select(Reminder).where(
            Reminder.pregnancy_id == pregnancy_id,
            Reminder.is_enabled == 1,
            Reminder.trigger_date >= today,
            Reminder.trigger_date <= future,
        ).order_by(Reminder.trigger_date).limit(5)
    )
    upcoming_reminders = result.scalars().all()

    # 即将到来的产检提醒（从 checkup_schedule 数据推算）
    upcoming_checkups: list = []
    try:
        schedule_filepath = Path(settings.DATA_DIR) / "checkup_schedule.json"
        if schedule_filepath.exists():
            with open(schedule_filepath, "r", encoding="utf-8") as f:
                schedule_data = json.load(f)
            for item in schedule_data:
                week_start = item.get("week_start", 0)
                if week_start > weeks and len(upcoming_checkups) < 5:
                    est_date = lmp + timedelta(weeks=week_start)
                    if est_date >= date.today():
                        days_until_checkup = (est_date - date.today()).days
                        upcoming_checkups.append({
                            "id": item.get("id", ""),
                            "name": item.get("name", ""),
                            "week_start": week_start,
                            "week_end": item.get("week_end", 0),
                            "items": item.get("items", []),
                            "estimated_date": est_date.isoformat(),
                            "days_until": days_until_checkup,
                        })
            upcoming_checkups.sort(key=lambda x: x["days_until"])
            upcoming_checkups = upcoming_checkups[:5]
    except Exception as e:
        logger.warning("加载即将到来的产检失败: %s", e)

    # 本周发育参考
    development = None
    dev_filepath = Path(settings.DATA_DIR) / "fetal_development.json"
    if dev_filepath.exists():
        with open(dev_filepath, "r", encoding="utf-8") as f:
            dev_data = json.load(f)
        for item in dev_data:
            if item["week"] == weeks:
                wg = item.get("weight_g", 0)
                weight_str = f"{wg / 1000:.1f}kg" if wg >= 1000 else f"{wg}g"
                development = {
                    "size": item.get("size_metaphor", ""),
                    "weight": weight_str,
                    "description": item.get("development", ""),
                    "tips": item.get("tips", ""),
                    "week": item.get("week"),
                    "length_cm": item.get("length_cm"),
                }
                break

    # 胎儿发育曲线（全周数据，供前端绘图）
    fetal_development_curve = []
    if dev_filepath.exists():
        with open(dev_filepath, "r", encoding="utf-8") as f:
            dev_all = json.load(f)
        for item in dev_all:
            fetal_development_curve.append({
                "week": item.get("week"),
                "weight_g": item.get("weight_g", 0),
                "length_cm": item.get("length_cm", 0),
                "size": item.get("size_metaphor", ""),
            })

    # 妈妈体重历史（用于体重趋势图）
    weight_result = await db.execute(
        select(DailyRecord.record_date, DailyRecord.weight).where(
            DailyRecord.pregnancy_id == pregnancy_id,
            DailyRecord.weight.isnot(None),
        ).order_by(DailyRecord.record_date).limit(50)
    )
    weight_history = [
        {"date": str(r.record_date), "weight": r.weight}
        for r in weight_result.all() if r.weight
    ]

    # 最近一次产检
    result = await db.execute(
        select(PrenatalCheckup).where(
            PrenatalCheckup.pregnancy_id == pregnancy_id,
        ).order_by(PrenatalCheckup.checkup_date.desc()).limit(1)
    )
    last_checkup = result.scalar_one_or_none()

    # 清单完成进度（含详细列表）
    checklist_progress = None
    result = await db.execute(
        select(Checklist).where(Checklist.pregnancy_id == pregnancy_id)
    )
    checklists = result.scalars().all()
    total_items = 0
    checked_items = 0
    checklist_details = []
    for cl in checklists:
        item_res = await db.execute(
            select(ChecklistItem).where(ChecklistItem.checklist_id == cl.id)
        )
        items = item_res.scalars().all()
        ct = len(items)
        cc = sum(1 for i in items if i.is_checked == 1)
        total_items += ct
        checked_items += cc
        cl_pct = round(cc / ct * 100) if ct > 0 else 0
        checklist_details.append({"id": cl.id, "name": cl.name, "type": getattr(cl, 'type', 'default'), "total": ct, "checked": cc, "percentage": cl_pct})
    if total_items > 0:
        checklist_progress = {
            "total": total_items,
            "checked": checked_items,
            "percentage": round(checked_items / total_items * 100),
            "checklists": checklist_details,
        }

    # 今日待办（含自定义待办）
    todo_result = await db.execute(
        select(Reminder).where(
            Reminder.pregnancy_id == pregnancy_id,
            Reminder.is_enabled == 1,
            Reminder.is_triggered == 0,
        )
    )
    all_reminders = todo_result.scalars().all()
    today_todos_list = [r for r in all_reminders if r.trigger_date and r.trigger_date.strftime("%Y-%m-%d") == today.isoformat()]
    today_todos = [
        {
            "id": r.id, "title": r.title, "trigger_date": r.trigger_date.isoformat() if r.trigger_date else None,
            "priority": _reminder_priority(r), "source_type": r.source_type or "manual",
        }
        for r in today_todos_list
    ] if today_todos_list else None

    # 基于孕周的推荐待办（产检/任务推荐）
    recommended_todos = []
    try:
        schedule_filepath = Path(settings.DATA_DIR) / "checkup_schedule.json"
        if schedule_filepath.exists():
            with open(schedule_filepath, "r", encoding="utf-8") as f:
                schedule_data = json.load(f)
            for item in schedule_data:
                week_start = item.get("week_start", 0)
                week_end = item.get("week_end", 0)
                if week_start >= weeks - 2 and week_start <= weeks + 4:
                    # 检查是否已完成
                    try:
                        completed_result = await db.execute(
                            select(PrenatalCheckup).where(
                                PrenatalCheckup.pregnancy_id == pregnancy_id,
                                PrenatalCheckup.gestational_week >= week_start,
                                PrenatalCheckup.gestational_week <= week_end,
                                PrenatalCheckup.is_completed == 1,
                            ).limit(1)
                        )
                        is_completed = completed_result.scalar_one_or_none()
                    except Exception as e:
                        logger.debug("查询产检完成状态失败: %s", e)
                        is_completed = False
                    
                    if not is_completed:
                        est_date = lmp + timedelta(weeks=week_start)
                        days_until = (est_date - today).days
                        recommended_todos.append({
                            "id": item.get("id", ""),
                            "name": item.get("name", "产检"),
                            "week_range": f"{week_start}-{week_end}" if week_end != week_start else str(week_start),
                            "is_mandatory": item.get("is_mandatory", True),
                            "type": "checkup",
                            "due_hint": f"约孕{week_start}周" if week_start else "",
                            "estimated_date": est_date.isoformat(),
                            "days_until": days_until,
                            "schedule_items": item.get("items", []),
                        })
            recommended_todos.sort(key=lambda x: x.get("days_until", 999))
            recommended_todos = recommended_todos[:5]
    except Exception as e:
        logger.warning("加载推荐待办失败: %s", e)

    # 判断当前阶段颜色
    stage_key = "early"
    if weeks < 13:
        stage_key = "early"
    elif weeks < 28:
        stage_key = "mid"
    else:
        stage_key = "late"

    return ApiResponse(data={
        "has_pregnancy": True,
        "has_today_record": has_today_record,
        "fetal_movement_count": fetal_movement_count,
        "contraction_active": contraction_active,
        "pregnancy": {
            "id": pregnancy.id,
            "due_date": pregnancy.due_date,
            "baby_name": pregnancy.baby_name,
            "last_period_date": pregnancy.last_period_date,
        },
        "gestational_age": {
            "weeks": weeks,
            "days": days,
            "total_days": total,
            "days_until_due": days_left,
            "trimester": get_trimester(weeks),
            "stage_key": stage_key,
        },
        "today_record": {
            "weight": today_record.weight,
            "mood": today_record.mood,
            "mood_note": today_record.mood_note,
            "note": today_record.note,
            "blood_pressure_systolic": today_record.blood_pressure_systolic,
            "blood_pressure_diastolic": today_record.blood_pressure_diastolic,
            "sleep_hours": today_record.sleep_hours,
            "sleep_quality": today_record.sleep_quality,
            "symptoms": today_record.symptoms,
            "exercise_type": today_record.exercise_type,
            "exercise_duration": today_record.exercise_duration,
            "diet_note": today_record.diet_note,
            "medication": today_record.medication,
            "fetal_heart_rate": today_record.fetal_heart_rate,
            "body_temperature": today_record.body_temperature,
            "blood_glucose_fasting": today_record.blood_glucose_fasting,
            "blood_glucose_1h": today_record.blood_glucose_1h,
            "blood_glucose_2h": today_record.blood_glucose_2h,
            "stool": today_record.stool,
            "edema_level": today_record.edema_level,
            "water_intake": today_record.water_intake,
            "fetal_movement_count": today_record.fetal_movement_count,
            "contraction_count": today_record.contraction_count,
            "record_date": str(today_record.record_date),
        } if today_record else None,
        "upcoming_reminders": [
            {
                "id": r.id,
                "title": r.title,
                "trigger_date": r.trigger_date,
                "trigger_time": r.trigger_time,
                "reminder_type": r.reminder_type,
            }
            for r in upcoming_reminders
        ],
        "upcoming_checkups": upcoming_checkups,
        "development": development,
        "fetal_development_curve": fetal_development_curve,
        "weight_history": weight_history,
        "last_checkup": {
            "checkup_date": last_checkup.checkup_date,
            "checkup_type": last_checkup.checkup_type,
            "gestational_week": last_checkup.gestational_week,
        } if last_checkup else None,
        "checklist_progress": checklist_progress,
        "today_todos": today_todos,
        "recommended_todos": recommended_todos,
    })
