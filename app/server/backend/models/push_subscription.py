"""孕程记 - PushSubscription 推送订阅模型。"""

import uuid
from datetime import datetime

from sqlalchemy import Column, String, Integer, DateTime, Index, Boolean, ForeignKey
from sqlalchemy.orm import relationship

from backend.base import Base


class PushSubscription(Base):
    """Web Push 订阅表。

    存储用户的浏览器推送订阅信息（endpoint + keys），
    用于向用户发送产检提醒、重要事件等通知。
    """

    __tablename__ = "push_subscription"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    pregnancy_id = Column(String, ForeignKey("pregnancy.id"), nullable=False, comment="关联的孕期ID")
    endpoint = Column(String, nullable=False, unique=True, comment="Push Service endpoint URL")
    p256dh_key = Column(String, nullable=False, comment="VAPID p256dh 公钥")
    auth_key = Column(String, nullable=False, comment="VAPID auth 密钥")
    user_agent = Column(String, nullable=True, comment="浏览器 User-Agent")
    is_active = Column(Boolean, nullable=False, default=True, comment="是否启用")
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    last_used_at = Column(DateTime, nullable=True, comment="最后使用时间")

    pregnancy = relationship("Pregnancy", back_populates="push_subscriptions")

    __table_args__ = (
        Index("idx_push_sub_pregnancy", "pregnancy_id", "is_active"),
        Index("idx_push_sub_endpoint", "endpoint"),
    )

    def __repr__(self) -> str:
        return f"<PushSubscription(id={self.id}, active={self.is_active})>"
