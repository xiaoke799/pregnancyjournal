"""孕程记 - Reminder 提醒模型。"""

import uuid
from datetime import datetime

from sqlalchemy import Column, Integer, String, Date, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship

from backend.base import Base


class Reminder(Base):
    """提醒表，支持产检/用药/营养补充/自定义/记录关联提醒。

    通过 source_type + source_id 实现与产检、记录等模块的关联：
    - source_type='checkup_schedule' → 关联产检时间表项
    - source_type='checkup' → 关联实际产检记录
    - source_type='daily_record' → 关联每日记录
    - source_type=None → 纯自定义提醒
    """

    __tablename__ = "reminder"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    pregnancy_id = Column(String, ForeignKey("pregnancy.id"), nullable=False, comment="外键→pregnancy")
    reminder_type = Column(String, nullable=False,
                           comment="checkup/medication/supplement/exercise/record/custom")
    title = Column(String, nullable=False, comment="提醒标题")
    trigger_date = Column(Date, nullable=True, comment="触发日期 YYYY-MM-DD")
    trigger_time = Column(String, nullable=True, comment="触发时间 HH:MM")
    advance_days = Column(Integer, nullable=True, default=0, comment="提前几天提醒")
    repeat_rule = Column(String, nullable=False, default="once",
                         comment="once/daily/weekly/monthly")
    is_enabled = Column(Integer, nullable=False, default=1, comment="是否启用 0/1")
    is_triggered = Column(Integer, nullable=False, default=0, comment="是否已触发 0/1")

    # 来源关联字段（实现与记录/产检的联动）
    source_type = Column(String, nullable=True,
                         comment="来源类型: checkup_schedule/checkup/daily_record/None(手动创建)")
    source_id = Column(String, nullable=True,
                       comment="来源ID: 产检时间表项ID/产检ID/记录ID")

    created_at = Column(DateTime, nullable=False, default=datetime.now)
    updated_at = Column(DateTime, nullable=False, default=datetime.now,
                        onupdate=datetime.now)

    # 关系
    pregnancy = relationship("Pregnancy", back_populates="reminders")

    __table_args__ = (
        Index("idx_reminder_pregnancy_enabled", "pregnancy_id", "is_enabled", "trigger_date"),
        Index("idx_reminder_source", "source_type", "source_id"),
    )

    def __repr__(self) -> str:
        return f"<Reminder(id={self.id}, title={self.title}, type={self.reminder_type}, source={self.source_type})>"
