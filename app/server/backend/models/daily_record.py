"""孕程记 - DailyRecord 每日记录模型。"""

import uuid
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, Float, Date, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship

from backend.base import Base


class DailyRecord(Base):
    """每日记录聚合表，每天一条记录包含体重/胎心/体温/血糖/心情/便便等。"""

    __tablename__ = "daily_record"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    pregnancy_id = Column(String, ForeignKey("pregnancy.id"), nullable=False, comment="外键→pregnancy")
    record_date = Column(Date, nullable=False, comment="记录日期 YYYY-MM-DD")
    weight = Column(Float, nullable=True, comment="体重(kg)")
    fetal_heart_rate = Column(Integer, nullable=True, comment="胎心率(bpm)")
    body_temperature = Column(Float, nullable=True, comment="体温(°C)")
    blood_glucose_fasting = Column(Float, nullable=True, comment="空腹血糖")
    blood_glucose_1h = Column(Float, nullable=True, comment="餐后1h血糖")
    blood_glucose_2h = Column(Float, nullable=True, comment="餐后2h血糖")
    mood = Column(Integer, nullable=True, comment="心情(1-5)")
    mood_note = Column(Text, nullable=True, comment="心情文字")
    stool = Column(String, nullable=True, comment="constipation/normal/diarrhea")
    stool_record = Column(Text, nullable=True, comment="排便详情(JSON)")
    note = Column(Text, nullable=True, comment="当日备注")

    # V2.0 新增字段
    blood_pressure_systolic = Column(String, nullable=True, comment="收缩压(mmHg)")
    blood_pressure_diastolic = Column(String, nullable=True, comment="舒张压(mmHg)")
    sleep_hours = Column(Float, nullable=True, comment="睡眠时长(小时)")
    sleep_quality = Column(String, nullable=True, comment="睡眠质量(good/fair/poor)")
    symptoms = Column(Text, nullable=True, comment="症状列表(JSON数组)")
    exercise_type = Column(String, nullable=True, comment="运动类型")
    exercise_duration = Column(Integer, nullable=True, comment="运动时长(分钟)")
    diet_note = Column(Text, nullable=True, comment="饮食备注")
    medication = Column(Text, nullable=True, comment="用药记录(JSON数组)")
    edema_level = Column(String, nullable=True, comment="水肿程度(none/mild/moderate/severe)")
    vaginal_discharge = Column(String, nullable=True, comment="分泌物状况")
    skin_condition = Column(String, nullable=True, comment="皮肤状况")
    urination_frequency = Column(String, nullable=True, comment="尿频程度")

    # V3.0 新增字段
    hcg_value = Column(Float, nullable=True, comment="HCG值(mIU/mL)")
    uric_acid = Column(Float, nullable=True, comment="尿酸(μmol/L)")
    supplement_record = Column(Text, nullable=True, comment="营养补充记录(JSON)")
    intimacy_note = Column(Text, nullable=True, comment="同房备注")
    plan_text = Column(Text, nullable=True, comment="计划内容")
    plan_date = Column(Date, nullable=True, comment="计划日期")
    water_intake = Column(Integer, nullable=True, comment="饮水量(ml)")
    contraction_count = Column(Integer, nullable=True, comment="宫缩次数")
    contraction_interval = Column(Integer, nullable=True, comment="宫缩间隔(分钟)")
    fetal_movement_count = Column(Integer, nullable=True, comment="胎动次数")
    fetal_movement_duration = Column(Integer, nullable=True, comment="胎动计数时长(分钟)")

    created_at = Column(DateTime, nullable=False, default=datetime.now)
    updated_at = Column(DateTime, nullable=False, default=datetime.now,
                        onupdate=datetime.now)

    # 关系
    pregnancy = relationship("Pregnancy", back_populates="daily_records")

    __table_args__ = (
        Index("idx_daily_pregnancy_date", "pregnancy_id", "record_date", unique=True),
    )

    def __repr__(self) -> str:
        return f"<DailyRecord(id={self.id}, date={self.record_date})>"
