"""孕程记 - AppConfig 应用配置模型。"""

import uuid
from datetime import datetime

from sqlalchemy import Column, String, Text, DateTime

from backend.base import Base


class AppConfig(Base):
    """应用配置表，存储全局配置键值对。"""

    __tablename__ = "app_config"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    key = Column(String, nullable=False, unique=True, comment="配置键")
    value = Column(Text, nullable=False, comment="配置值（JSON字符串）")
    description = Column(String, nullable=True, comment="配置说明")
    updated_at = Column(DateTime, nullable=False, default=datetime.now,
                        onupdate=datetime.now)

    def __repr__(self) -> str:
        return f"<AppConfig(key={self.key})>"
