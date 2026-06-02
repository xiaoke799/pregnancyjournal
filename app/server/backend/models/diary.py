"""孕程记 - DiaryEntry 日记模型。"""

import uuid
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, Date, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship

from backend.base import Base


class DiaryEntry(Base):
    """日记表，记录准妈妈的文字+图片日记。"""

    __tablename__ = "diary_entry"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    pregnancy_id = Column(String, ForeignKey("pregnancy.id"), nullable=False, comment="外键→pregnancy")
    entry_date = Column(Date, nullable=False, comment="日记日期 YYYY-MM-DD")
    gestational_week = Column(Integer, nullable=True, comment="孕周")
    content = Column(Text, nullable=False, comment="日记内容（富文本HTML）")
    photo_ids = Column(Text, nullable=True, comment="关联照片ID列表（JSON数组）")
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    updated_at = Column(DateTime, nullable=False, default=datetime.now,
                        onupdate=datetime.now)

    # 关系
    pregnancy = relationship("Pregnancy", back_populates="diaries")

    __table_args__ = (
        Index("idx_diary_pregnancy_date", "pregnancy_id", "entry_date"),
    )

    def __repr__(self) -> str:
        return f"<DiaryEntry(id={self.id}, date={self.entry_date})>"
