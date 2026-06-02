"""孕程记 - LabResult 检查指标模型。"""

import uuid
from datetime import datetime

from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship

from backend.base import Base


class LabResult(Base):
    """检查指标表，记录各项检查的详细数值及标准范围比对结果。"""

    __tablename__ = "lab_result"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    checkup_id = Column(String, ForeignKey("prenatal_checkup.id"), nullable=False,
                        comment="外键→prenatal_checkup")
    category = Column(String, nullable=False,
                      comment="blood_routine/urine_routine/ultrasound/hcg_progesterone/glucose")
    item_name = Column(String, nullable=False, comment="指标名称（如'血红蛋白'/'双顶径'）")
    value = Column(Float, nullable=False, comment="数值")
    unit = Column(String, nullable=False, comment="单位")
    reference_min = Column(Float, nullable=True, comment="标准下限")
    reference_max = Column(Float, nullable=True, comment="标准上限")
    status = Column(String, nullable=False, default="normal", comment="low/normal/high")
    created_at = Column(DateTime, nullable=False, default=datetime.now)

    # 关系
    checkup = relationship("PrenatalCheckup", back_populates="lab_results")

    __table_args__ = (
        Index("idx_lab_checkup_category", "checkup_id", "category"),
    )

    def __repr__(self) -> str:
        return f"<LabResult(id={self.id}, name={self.item_name}, status={self.status})>"
