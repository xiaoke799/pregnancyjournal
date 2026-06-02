"""孕程记 - Checklist + ChecklistItem 清单模型。"""

import uuid
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from backend.base import Base


class Checklist(Base):
    """清单表，支持待产包/新生儿准备/产房待检三种类型。"""

    __tablename__ = "checklist"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    pregnancy_id = Column(String, ForeignKey("pregnancy.id"), nullable=False, comment="外键→pregnancy")
    type = Column(String, nullable=False,
                  comment="delivery_bag/newborn_prep/delivery_check")
    name = Column(String, nullable=False, comment="清单名称")
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    updated_at = Column(DateTime, nullable=False, default=datetime.now,
                        onupdate=datetime.now)

    # 关系
    pregnancy = relationship("Pregnancy", back_populates="checklists")
    items = relationship("ChecklistItem", back_populates="checklist", lazy="selectin",
                         cascade="all, delete-orphan", order_by="ChecklistItem.sort_order")

    def __repr__(self) -> str:
        return f"<Checklist(id={self.id}, type={self.type}, name={self.name})>"


class ChecklistItem(Base):
    """清单条目表。"""

    __tablename__ = "checklist_item"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    checklist_id = Column(String, ForeignKey("checklist.id"), nullable=False,
                          comment="外键→checklist")
    name = Column(String, nullable=False, comment="条目名称")
    description = Column(String, nullable=True, comment="物品用途描述")
    category = Column(String, nullable=True, comment="分类（如'妈妈用品'/'宝宝用品'）")
    is_checked = Column(Integer, nullable=False, default=0, comment="是否已勾选 0/1")
    is_custom = Column(Integer, nullable=False, default=0, comment="是否用户自定义 0/1")
    is_mandatory = Column(Integer, nullable=False, default=0, comment="是否必备物品 0/1")
    sort_order = Column(Integer, nullable=False, default=0, comment="排序序号")

    # 关系
    checklist = relationship("Checklist", back_populates="items")

    def __repr__(self) -> str:
        return f"<ChecklistItem(id={self.id}, name={self.name}, checked={self.is_checked})>"
