"""孕程记 - PregnancyPhoto 照片模型。"""

import uuid
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship

from backend.base import Base


class PregnancyPhoto(Base):
    """孕期照片表，支持孕妇照/B超照/成长相册/婴儿照/产检单。"""

    __tablename__ = "pregnancy_photo"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    pregnancy_id = Column(String, ForeignKey("pregnancy.id"), nullable=False, comment="外键→pregnancy")
    checkup_id = Column(String, ForeignKey("prenatal_checkup.id"), nullable=True,
                        comment="关联产检记录（可选）")
    photo_type = Column(String, nullable=False,
                        comment="belly/ultrasound/milestone/baby/checkup_report")
    gestational_week = Column(Integer, nullable=True, comment="孕周")
    gestational_day = Column(Integer, nullable=True, default=0, comment="孕天")
    milestone_type = Column(String, nullable=True, comment="里程碑类型（首次胎动等）")
    file_path = Column(String, nullable=False, comment="原图路径")
    thumbnail_path = Column(String, nullable=True, comment="缩略图路径")
    note = Column(Text, nullable=True, comment="照片备注")
    media_type = Column(String, nullable=True, default="photo", comment="媒体类型(photo/video)")
    created_at = Column(DateTime, nullable=False, default=datetime.now)

    # 关系
    pregnancy = relationship("Pregnancy", back_populates="photos")

    __table_args__ = (
        Index("idx_photo_pregnancy_type", "pregnancy_id", "photo_type", "gestational_week"),
    )

    def __repr__(self) -> str:
        return f"<PregnancyPhoto(id={self.id}, type={self.photo_type}, week={self.gestational_week})>"
