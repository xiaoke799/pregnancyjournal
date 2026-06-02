"""孕程记 - FetalMovementSession + FetalMovement 胎动模型。"""

import uuid
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from backend.base import Base


class FetalMovementSession(Base):
    """胎动计数会话表，记录一次胎动计时的完整会话。"""

    __tablename__ = "fetal_movement_session"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    pregnancy_id = Column(String, ForeignKey("pregnancy.id"), nullable=False, comment="外键→pregnancy")
    session_date = Column(Date, nullable=False, comment="会话日期 YYYY-MM-DD")
    start_time = Column(String, nullable=False, comment="开始时间 HH:MM:SS")
    end_time = Column(String, nullable=True, comment="结束时间 HH:MM:SS")
    total_count = Column(Integer, nullable=False, default=0, comment="胎动总次数")
    notes = Column(Text, nullable=True, comment="备注")
    created_at = Column(DateTime, nullable=False, default=datetime.now)

    # 关系
    pregnancy = relationship("Pregnancy", back_populates="fetal_movement_sessions")
    movements = relationship("FetalMovement", back_populates="session", lazy="selectin",
                             cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<FetalMovementSession(id={self.id}, count={self.total_count})>"


class FetalMovement(Base):
    """单次胎动记录表。"""

    __tablename__ = "fetal_movement"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("fetal_movement_session.id"), nullable=False,
                        comment="外键→fetal_movement_session")
    timestamp = Column(DateTime, nullable=False, comment="胎动时间")

    # 关系
    session = relationship("FetalMovementSession", back_populates="movements")

    def __repr__(self) -> str:
        return f"<FetalMovement(id={self.id}, timestamp={self.timestamp})>"
