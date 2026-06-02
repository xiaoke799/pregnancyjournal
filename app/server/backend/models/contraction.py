"""孕程记 - ContractionSession + Contraction 宫缩模型。"""

import uuid
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, Float, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from backend.base import Base


class ContractionSession(Base):
    """宫缩记录会话表，记录一次宫缩计时的完整会话。"""

    __tablename__ = "contraction_session"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    pregnancy_id = Column(String, ForeignKey("pregnancy.id"), nullable=False, comment="外键→pregnancy")
    session_date = Column(Date, nullable=False, comment="会话日期 YYYY-MM-DD")
    start_time = Column(DateTime, nullable=False, comment="会话开始时间")
    end_time = Column(DateTime, nullable=True, comment="会话结束时间")
    total_count = Column(Integer, nullable=False, default=0, comment="宫缩总次数")
    avg_duration = Column(Float, nullable=True, comment="平均持续时间(秒)")
    avg_interval = Column(Float, nullable=True, comment="平均间隔(秒)")
    alert_triggered = Column(Integer, nullable=False, default=0, comment="是否触发5-1-1预警 0/1")
    notes = Column(Text, nullable=True, comment="备注")
    created_at = Column(DateTime, nullable=False, default=datetime.now)

    # 关系
    pregnancy = relationship("Pregnancy", back_populates="contraction_sessions")
    contractions = relationship("Contraction", back_populates="session", lazy="selectin",
                                cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<ContractionSession(id={self.id}, count={self.total_count})>"


class Contraction(Base):
    """单次宫缩记录表。"""

    __tablename__ = "contraction"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("contraction_session.id"), nullable=False,
                        comment="外键→contraction_session")
    start_time = Column(DateTime, nullable=False, comment="宫缩开始时间")
    end_time = Column(DateTime, nullable=True, comment="宫缩结束时间")
    duration = Column(Float, nullable=True, comment="持续时间(秒)")
    interval_from_prev = Column(Float, nullable=True, comment="距上次宫缩间隔(秒)")

    # 关系
    session = relationship("ContractionSession", back_populates="contractions")

    def __repr__(self) -> str:
        return f"<Contraction(id={self.id}, duration={self.duration})>"
