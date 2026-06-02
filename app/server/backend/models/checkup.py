"""孕程记 - PrenatalCheckup + CheckupPhoto + CustomCheckup + CheckupReport 产检模型。"""

import uuid
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, Float, Date, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship

from backend.base import Base


class PrenatalCheckup(Base):
    """产检记录表，记录每次产检的详细信息。"""

    __tablename__ = "prenatal_checkup"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    pregnancy_id = Column(String, ForeignKey("pregnancy.id"), nullable=False, comment="外键→pregnancy")
    checkup_date = Column(Date, nullable=False, comment="产检日期 YYYY-MM-DD")
    gestational_week = Column(Integer, nullable=False, comment="产检时孕周")
    gestational_day = Column(Integer, nullable=False, default=0, comment="产检时孕天")
    checkup_type = Column(String, nullable=False, comment="检查类型（NT/大排畸/OGTT等）")
    weight = Column(Float, nullable=True, comment="体重(kg)")
    blood_pressure = Column(String, nullable=True, comment="血压（如 120/80）")
    fetal_heart_rate = Column(Integer, nullable=True, comment="胎心率(bpm)")
    fundal_height = Column(Float, nullable=True, comment="宫高(cm)")
    abdominal_circumference = Column(Float, nullable=True, comment="腹围(cm)")
    hospital = Column(String, nullable=True, comment="检查医院")
    notes = Column(Text, nullable=True, comment="备注")
    is_completed = Column(Integer, nullable=False, default=0, comment="是否已完成产检 0/1")
    is_recommended = Column(Integer, nullable=False, default=0, comment="是否为推荐标准产检 0/1")
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    updated_at = Column(DateTime, nullable=False, default=datetime.now,
                        onupdate=datetime.now)

    # 关系
    pregnancy = relationship("Pregnancy", back_populates="checkups")
    photos = relationship("CheckupPhoto", back_populates="checkup", lazy="selectin",
                          cascade="all, delete-orphan")
    lab_results = relationship("LabResult", back_populates="checkup", lazy="selectin",
                               cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_checkup_pregnancy_date", "pregnancy_id", "checkup_date"),
    )

    def __repr__(self) -> str:
        return f"<PrenatalCheckup(id={self.id}, date={self.checkup_date}, type={self.checkup_type})>"


class CheckupPhoto(Base):
    """产检照片表，关联到产检记录。"""

    __tablename__ = "checkup_photo"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    checkup_id = Column(String, ForeignKey("prenatal_checkup.id"), nullable=False,
                        comment="外键→prenatal_checkup")
    file_path = Column(String, nullable=False, comment="原图路径")
    thumbnail_path = Column(String, nullable=True, comment="缩略图路径")
    note = Column(Text, nullable=True, comment="照片备注")
    created_at = Column(DateTime, nullable=False, default=datetime.now)

    # 关系
    checkup = relationship("PrenatalCheckup", back_populates="photos")

    def __repr__(self) -> str:
        return f"<CheckupPhoto(id={self.id}, checkup_id={self.checkup_id})>"


class CustomCheckup(Base):
    """自定义产检表，支持用户自行添加产检项目。"""

    __tablename__ = "custom_checkup"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    pregnancy_id = Column(String, ForeignKey("pregnancy.id"), nullable=False, index=True, comment="孕期ID")
    name = Column(String, nullable=False, comment="检查名称，如 '额外B超'")
    items = Column(Text, nullable=True, comment="检查子项JSON数组，如 [\"B超\",\"血常规\"]")
    checkup_date = Column(Date, nullable=True, comment="计划检查日期")
    notes = Column(Text, nullable=True, comment="备注")
    is_completed = Column(Integer, default=0, comment="是否已完成 0/1")
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    pregnancy = relationship("Pregnancy", back_populates="custom_checkups")

    __table_args__ = (
        Index("idx_custom_checkup_pregnancy", "pregnancy_id"),
    )

    def __repr__(self) -> str:
        return f"<CustomCheckup(id={self.id}, name={self.name}, date={self.checkup_date})>"


class CheckupReport(Base):
    """产检报告附件表，支持上传图片和 PDF 文件。"""

    __tablename__ = "checkup_report"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    checkup_id = Column(String, nullable=False, index=True, comment="关联的产检ID（标准或自定义）")
    checkup_type = Column(String, default="standard", comment="产检类型: standard / custom")
    filename = Column(String, nullable=False, comment="原始文件名")
    file_path = Column(String, nullable=False, comment="存储路径")
    file_type = Column(String, nullable=False, comment="文件类型: image / pdf")
    file_size = Column(Integer, default=0, comment="文件大小(字节)")
    report_category = Column(String, default="other", comment="报告分类: b超/血检/尿检/其他")
    sub_item = Column(String, nullable=True, comment="关联的具体检查子项名称")
    created_at = Column(DateTime, default=datetime.now)

    __table_args__ = (
        Index("idx_checkup_report_checkup", "checkup_id", "checkup_type"),
    )

    def __repr__(self) -> str:
        return f"<CheckupReport(id={self.id}, filename={self.filename}, type={self.checkup_type})>"
