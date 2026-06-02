"""孕程记 - Web Push 推送通知 API。

提供浏览器推送通知的订阅管理、发送和测试功能。
基于 VAPID (Voluntary Application Server Identification) 协议。
"""

import json
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

try:
    from pywebpush import webpush, WebPushException
    HAS_PYWEBPUSH = True
except ImportError:
    HAS_PYWEBPUSH = False
    webpush = None
    WebPushException = None

from backend.database import get_db
from backend.models.push_subscription import PushSubscription
from backend.config import settings
from backend.schemas.common import ApiResponse

router = APIRouter()


# ============ Schema ============

class PushSubscribeRequest(BaseModel):
    """订阅请求。"""
    pregnancy_id: str
    endpoint: str
    keys: dict  # { p256dh: "...", auth: "..." }
    user_agent: Optional[str] = None


class PushSendRequest(BaseModel):
    """发送推送请求。"""
    pregnancy_id: str
    title: str
    body: str
    icon: Optional[str] = None
    badge: Optional[str] = None
    tag: Optional[str] = None
    data: Optional[dict] = None
    url: Optional[str] = None


class VapidPublicKeyResponse(BaseModel):
    """VAPID 公钥响应。"""
    public_key: str


# ============ VAPID 密钥管理 ============

def _get_or_generate_vapid_keys() -> tuple[str, str]:
    """获取或生成 VAPID 密钥对。

    首次调用时自动生成密钥并保存到文件，后续从文件读取。
    返回 (public_key, private_key)。
    """
    if settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY:
        return settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY

    key_file = settings.VAPID_KEYS_FILE
    os.makedirs(os.path.dirname(key_file), exist_ok=True)

    if os.path.exists(key_file):
        with open(key_file, "r") as f:
            keys = json.load(f)
        return keys["public_key"], keys["private_key"]

    # 自动生成新的 VAPID 密钥对
    from cryptography.hazmat.primitives.asymmetric.ec import generate_private_key, SECP256R1
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat, NoEncryption, PrivateFormat

    private_key = generate_private_key(SECP256R1())
    private_bytes = private_key.private_bytes(
        encoding=Encoding.DER,
        format=PrivateFormat.PKCS8,
        encryption_algorithm=NoEncryption(),
    )
    public_bytes = private_key.public_key().public_bytes(
        encoding=Encoding.X962,
        format=PublicFormat.UncompressedPoint,
    )

    import base64
    vapid_private_key = base64.urlsafe_b64encode(private_bytes).rstrip(b'=').decode('ascii')
    vapid_public_key = base64.urlsafe_b64encode(public_bytes).rstrip(b'=').decode('ascii')

    keys = {
        "public_key": vapid_public_key,
        "private_key": vapid_private_key,
    }

    with open(key_file, "w") as f:
        json.dump(keys, f)

    print(f"🔑 已生成新的 VAPID 密钥对，保存到 {key_file}")
    return vapid_public_key, vapid_private_key


def _get_vapid_claims() -> dict:
    """构建 VAPID claims（用于验证发送者身份）。"""
    return {
        "sub": f"mailto:pregnancy-journal@localhost",
        "aud": "https://push.services.mozilla.com",
        "exp": int(__import__("time").time()) + 12 * 60 * 60,  # 12 小时有效期
    }


# ============ API 端点 ============

@router.get("/push/vapid-public-key", response_model=ApiResponse[VapidPublicKeyResponse])
async def get_vapid_public_key():
    """获取 VAPID 公钥（前端用于订阅时使用）。"""
    public_key, _ = _get_or_generate_vapid_keys()
    return ApiResponse(data={"public_key": public_key})


@router.post("/push/subscribe", response_model=ApiResponse)
async def subscribe_push(data: PushSubscribeRequest, db: AsyncSession = Depends(get_db)):
    """注册/更新推送订阅。

    前端调用 navigator.serviceWorker.register() 后获取 subscription，
    然后调用此接口将订阅信息保存到服务器。
    """
    endpoint = data.endpoint
    p256dh = data.keys.get("p256dh", "")
    auth = data.keys.get("auth", "")

    if not all([endpoint, p256dh, auth]):
        raise HTTPException(status_code=400, detail="缺少必要的订阅信息")

    # 检查是否已存在相同 endpoint 的订阅
    result = await db.execute(
        select(PushSubscription).where(PushSubscription.endpoint == endpoint)
    )
    existing = result.scalar_one_or_none()

    if existing:
        # 更新已有订阅
        existing.p256dh_key = p256dh
        existing.auth_key = auth
        existing.user_agent = data.user_agent
        existing.is_active = True
        await db.flush()
        return ApiResponse(message="订阅已更新")

    # 创建新订阅
    from uuid import uuid4
    sub = PushSubscription(
        id=str(uuid4()),
        pregnancy_id=data.pregnancy_id,
        endpoint=endpoint,
        p256dh_key=p256dh,
        auth_key=auth,
        user_agent=data.user_agent,
        is_active=True,
    )
    db.add(sub)
    await db.flush()

    return ApiResponse(message="订阅成功")


@router.post("/push/unsubscribe", response_model=ApiResponse)
async def unsubscribe_push(endpoint: str, db: AsyncSession = Depends(get_db)):
    """取消推送订阅（标记为不活跃）。"""
    result = await db.execute(
        select(PushSubscription).where(PushSubscription.endpoint == endpoint)
    )
    sub = result.scalar_one_or_none()

    if sub:
        sub.is_active = False
        await db.flush()

    return ApiResponse(message="已取消订阅")


@router.post("/push/send", response_model=ApiResponse)
async def send_push_notification(data: PushSendRequest, db: AsyncSession = Depends(get_db)):
    """向指定孕期用户发送推送通知。

    可用于：
    - 产检提醒（提前 N 天）
    - 重要事件通知
    - 测试推送是否正常工作
    """
    if not settings.PUSH_ENABLED:
        return ApiResponse(code=1003, message="推送功能已禁用")

    # 查找该用户的所有活跃订阅
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.pregnancy_id == data.pregnancy_id,
            PushSubscription.is_active == True,
        )
    )
    subscriptions = result.scalars().all()

    if not subscriptions:
        return ApiResponse(code=1002, message="没有找到活跃的推送订阅")

    _, private_key = _get_or_generate_vapid_keys()
    claims = _get_vapid_claims()

    payload = json.dumps({
        "title": data.title,
        "body": data.body,
        "icon": data.icon or "/favicon.png",
        "badge": data.badge or "/favicon.png",
        "tag": data.tag or "default",
        "data": data.data or {},
        "url": data.url or "/",
    }, ensure_ascii=False)

    success_count = 0
    fail_count = 0

    for sub in subscriptions:
        try:
            subscription_info = {
                "endpoint": sub.endpoint,
                "keys": {
                    "p256dh": sub.p256dh_key,
                    "auth": sub.auth_key,
                },
            }

            webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_claims=claims,
                vapid_private_key=private_key,
                ttl=settings.PUSH_TTL,
                urgency=settings.PUSH_URGENCY,
            )

            success_count += 1

            # 更新最后使用时间
            from datetime import datetime
            sub.last_used_at = datetime.now()

        except WebPushException as e:
            print(f"❌ 推送失败 ({sub.endpoint[:50]}...): {e}")
            fail_count += 1

            # 如果是 410 Gone，说明订阅已失效，标记为不活跃
            if e.response and e.response.status_code == 410:
                sub.is_active = False

        except Exception as e:
            print(f"⚠️ 推送异常: {e}")
            fail_count += 1

    await db.flush()

    return ApiResponse(data={
        "success": success_count,
        "failed": fail_count,
        "total": len(subscriptions),
    })


@router.post("/push/test", response_model=ApiResponse)
async def test_push(pregnancy_id: str, db: AsyncSession = Depends(get_db)):
    """发送测试推送（用于调试推送功能是否正常）。"""
    send_data = PushSendRequest(
        pregnancy_id=pregnancy_id,
        title="🧪 孕程记 - 推送测试",
        body="这是一条测试消息！如果您收到此消息，说明推送功能正常工作 ✅",
        tag="test",
        url="/settings",
    )

    result = await send_push_notification(send_data, db)
    return result
