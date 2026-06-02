"""孕程记 - HabitCheckin 好习惯打卡模型。"""

import uuid
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, Date, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship

from backend.base import Base


class HabitCheckin(Base):
    """好习惯打卡记录，每天一条，items 为 JSON 数组存储已勾选项目。"""

    __tablename__ = "habit_checkin"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    pregnancy_id = Column(String, ForeignKey("pregnancy.id"), nullable=False, comment="外键→pregnancy")
    date = Column(Date, nullable=False, comment="打卡日期 YYYY-MM-DD")
    items = Column(Text, nullable=False, default="[]", comment="已勾选项目JSON数组，如[\"按时产检\",\"适度运动\"]")
    notes = Column(Text, nullable=True, comment="备注")
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    updated_at = Column(DateTime, nullable=False, default=datetime.now,
                        onupdate=datetime.now)

    # 关系
    pregnancy = relationship("Pregnancy", back_populates="habit_checkins")

    __table_args__ = (
        Index("idx_habit_pregnancy_date", "pregnancy_id", "date", unique=True),
    )

    def __repr__(self) -> str:
        return f"<HabitCheckin(id={self.id}, date={self.date})>"
