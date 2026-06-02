"""孕程记 - DailyRecord Pydantic Schema。"""

from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class DailyRecordCreate(BaseModel):
    """创建/更新每日记录请求（按日期 upsert）。"""
    pregnancy_id: str = Field(description="孕期ID")
    record_date: date = Field(description="记录日期 YYYY-MM-DD")
    weight: Optional[float] = Field(None, description="体重(kg)")
    fetal_heart_rate: Optional[int] = Field(None, description="胎心率(bpm)")
    body_temperature: Optional[float] = Field(None, description="体温(°C)")
    blood_glucose_fasting: Optional[float] = Field(None, description="空腹血糖")
    blood_glucose_1h: Optional[float] = Field(None, description="餐后1h血糖")
    blood_glucose_2h: Optional[float] = Field(None, description="餐后2h血糖")
    mood: Optional[int] = Field(None, ge=1, le=5, description="心情(1-5)")
    mood_note: Optional[str] = Field(None, description="心情文字")
    stool: Optional[str] = Field(None, description="constipation/normal/diarrhea")
    note: Optional[str] = Field(None, description="当日备注")
    # V2.0 新增字段
    blood_pressure_systolic: Optional[str] = Field(None, description="收缩压(mmHg)")
    blood_pressure_diastolic: Optional[str] = Field(None, description="舒张压(mmHg)")
    sleep_hours: Optional[float] = Field(None, description="睡眠时长(小时)")
    sleep_quality: Optional[str] = Field(None, description="睡眠质量(good/fair/poor)")
    symptoms: Optional[str] = Field(None, description="症状列表(JSON数组)")
    exercise_type: Optional[str] = Field(None, description="运动类型")
    exercise_duration: Optional[int] = Field(None, description="运动时长(分钟)")
    diet_note: Optional[str] = Field(None, description="饮食备注")
    medication: Optional[str] = Field(None, description="用药记录(JSON数组)")
    edema_level: Optional[str] = Field(None, description="水肿程度(none/mild/moderate/severe)")
    vaginal_discharge: Optional[str] = Field(None, description="分泌物状况")
    skin_condition: Optional[str] = Field(None, description="皮肤状况")
    urination_frequency: Optional[str] = Field(None, description="尿频程度(normal/increased/frequent)")
    # V3.0 新增字段
    hcg_value: Optional[float] = Field(None, description="HCG值")
    uric_acid: Optional[float] = Field(None, description="尿酸")
    supplement_record: Optional[str] = Field(None, description="营养补充记录(JSON)")
    intimacy_note: Optional[str] = Field(None, description="同房备注")
    plan_text: Optional[str] = Field(None, description="计划内容")
    plan_date: Optional[date] = Field(None, description="计划日期")
    water_intake: Optional[int] = Field(None, description="饮水量(ml)")
    stool_record: Optional[str] = Field(None, description="排便详情(JSON)")
    contraction_count: Optional[int] = Field(None, description="宫缩次数")
    contraction_interval: Optional[int] = Field(None, description="宫缩间隔")
    fetal_movement_count: Optional[int] = Field(None, description="胎动次数")
    fetal_movement_duration: Optional[int] = Field(None, description="胎动时长")


class DailyRecordUpdate(BaseModel):
    """更新每日记录请求。"""
    weight: Optional[float] = None
    fetal_heart_rate: Optional[int] = None
    body_temperature: Optional[float] = None
    blood_glucose_fasting: Optional[float] = None
    blood_glucose_1h: Optional[float] = None
    blood_glucose_2h: Optional[float] = None
    mood: Optional[int] = None
    mood_note: Optional[str] = None
    stool: Optional[str] = None
    note: Optional[str] = None
    # V2.0 新增字段
    blood_pressure_systolic: Optional[str] = None
    blood_pressure_diastolic: Optional[str] = None
    sleep_hours: Optional[float] = None
    sleep_quality: Optional[str] = None
    symptoms: Optional[str] = None
    exercise_type: Optional[str] = None
    exercise_duration: Optional[int] = None
    diet_note: Optional[str] = None
    medication: Optional[str] = None
    edema_level: Optional[str] = None
    vaginal_discharge: Optional[str] = None
    skin_condition: Optional[str] = None
    urination_frequency: Optional[str] = None
    # V3.0
    hcg_value: Optional[float] = None
    uric_acid: Optional[float] = None
    supplement_record: Optional[str] = None
    intimacy_note: Optional[str] = None
    plan_text: Optional[str] = None
    plan_date: Optional[date] = None
    water_intake: Optional[int] = None
    stool_record: Optional[str] = None
    contraction_count: Optional[int] = None
    contraction_interval: Optional[int] = None
    fetal_movement_count: Optional[int] = None
    fetal_movement_duration: Optional[int] = None


class DailyRecordResponse(BaseModel):
    """每日记录响应。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    pregnancy_id: str
    record_date: date
    weight: Optional[float] = None
    fetal_heart_rate: Optional[int] = None
    body_temperature: Optional[float] = None
    blood_glucose_fasting: Optional[float] = None
    blood_glucose_1h: Optional[float] = None
    blood_glucose_2h: Optional[float] = None
    mood: Optional[int] = None
    mood_note: Optional[str] = None
    stool: Optional[str] = None
    note: Optional[str] = None
    # V2.0 新增字段
    blood_pressure_systolic: Optional[str] = None
    blood_pressure_diastolic: Optional[str] = None
    sleep_hours: Optional[float] = None
    sleep_quality: Optional[str] = None
    symptoms: Optional[str] = None
    exercise_type: Optional[str] = None
    exercise_duration: Optional[int] = None
    diet_note: Optional[str] = None
    medication: Optional[str] = None
    edema_level: Optional[str] = None
    vaginal_discharge: Optional[str] = None
    skin_condition: Optional[str] = None
    urination_frequency: Optional[str] = None
    # V3.0
    hcg_value: Optional[float] = None
    uric_acid: Optional[float] = None
    supplement_record: Optional[str] = None
    intimacy_note: Optional[str] = None
    plan_text: Optional[str] = None
    plan_date: Optional[date] = None
    water_intake: Optional[int] = None
    stool_record: Optional[str] = None
    contraction_count: Optional[int] = None
    contraction_interval: Optional[int] = None
    fetal_movement_count: Optional[int] = None
    fetal_movement_duration: Optional[int] = None
    created_at: datetime
    updated_at: datetime
