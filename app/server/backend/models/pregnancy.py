"""孕程记 - Pregnancy 孕期档案模型。"""

import uuid
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, Date, DateTime, Index
from sqlalchemy.orm import relationship

from backend.base import Base


class Pregnancy(Base):
    """孕期档案表，记录每次怀孕的基本信息。

    同一时间只有一个活跃孕期 (is_active=1)，历史记录保留可随时切回。
    """

    __tablename__ = "pregnancy"

    # NOTE [PERFORMANCE]: 使用UUID字符串作为主键，便于分布式生成且语义清晰。
    # 对于SQLite单用户场景性能影响可忽略；若未来数据量超过10万条，
    # 可考虑改用自增整数ID并添加UUID作为业务字段以优化查询性能。
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    last_period_date = Column(Date, nullable=False, comment="末次月经日期 YYYY-MM-DD")
    conception_date = Column(Date, nullable=True, comment="受精日期 YYYY-MM-DD，可选")
    due_date = Column(Date, nullable=False, comment="预产期 YYYY-MM-DD，自动计算")
    is_active = Column(Integer, nullable=False, default=1, comment="是否当前活跃孕期 0/1")
    baby_name = Column(String, nullable=True, comment="宝宝昵称")
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    updated_at = Column(DateTime, nullable=False, default=datetime.now,
                        onupdate=datetime.now)

    # 关系
    checkups = relationship("PrenatalCheckup", back_populates="pregnancy", lazy="selectin",
                            cascade="all, delete-orphan")
    daily_records = relationship("DailyRecord", back_populates="pregnancy", lazy="selectin",
                                cascade="all, delete-orphan")
    contraction_sessions = relationship("ContractionSession", back_populates="pregnancy",
                                        lazy="selectin", cascade="all, delete-orphan")
    fetal_movement_sessions = relationship("FetalMovementSession", back_populates="pregnancy",
                                           lazy="selectin", cascade="all, delete-orphan")
    photos = relationship("PregnancyPhoto", back_populates="pregnancy", lazy="selectin",
                          cascade="all, delete-orphan")
    diaries = relationship("DiaryEntry", back_populates="pregnancy", lazy="selectin",
                           cascade="all, delete-orphan")
    checklists = relationship("Checklist", back_populates="pregnancy", lazy="selectin",
                              cascade="all, delete-orphan")
    reminders = relationship("Reminder", back_populates="pregnancy", lazy="selectin",
                             cascade="all, delete-orphan")
    habit_checkins = relationship("HabitCheckin", back_populates="pregnancy", lazy="selectin",
                                  cascade="all, delete-orphan")
    supplement_checkins = relationship("SupplementCheckin", back_populates="pregnancy", lazy="selectin",
                                       cascade="all, delete-orphan")
    custom_checkups = relationship("CustomCheckup", back_populates="pregnancy", lazy="selectin",
                                   cascade="all, delete-orphan")
    push_subscriptions = relationship("PushSubscription", back_populates="pregnancy", lazy="selectin",
                                      cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_pregnancy_active", "is_active", unique=True, sqlite_where="is_active = 1"),
    )

    def __repr__(self) -> str:
        return f"<Pregnancy(id={self.id}, due_date={self.due_date}, active={self.is_active})>"
