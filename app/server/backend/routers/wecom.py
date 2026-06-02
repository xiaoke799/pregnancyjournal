"""孕程记 - 企业微信群机器人 Webhook API。

极简设计：只需一个 Webhook URL，无需 CorpID/Secret/access_token。
"""

import json
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.services.wecom import wecom_service
from backend.config import settings
from backend.schemas.common import ApiResponse

router = APIRouter()


# ============ Schema ============

class WebhookConfigRequest(BaseModel):
    """Webhook 配置请求。"""
    webhook_url: str


class SendTestRequest(BaseModel):
    """测试发送请求（预留，当前不需要参数）。"""
    pass


# ============ API 端点 ============

@router.get("/wecom/status", response_model=ApiResponse)
async def get_wecom_status():
    """获取群机器人配置状态。"""
    status = await wecom_service.test_connection() if wecom_service.is_configured else {
        "success": False,
        "message": "未配置",
        "configured": False,
    }
    return ApiResponse(data={
        "configured": wecom_service.is_configured,
        "status": status,
    })


@router.post("/wecom/config", response_model=ApiResponse)
async def save_wecom_config(data: WebhookConfigRequest):
    """保存群机器人 Webhook URL。

    URL 格式示例:
      https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=693a91f6-7xxx-4bc4-97a0-0ec2sifa5aaa
    """
    url = data.webhook_url.strip()

    if not url:
        raise HTTPException(status_code=400, detail="Webhook URL 不能为空")

    # 保存
    wecom_service.save_webhook_url(url)

    # 立即测试
    status = await wecom_service.test_connection()

    if status["success"]:
        return ApiResponse(
            message="✅ 配置保存成功！测试消息已发送到群聊",
            data=status,
        )
    else:
        return ApiResponse(
            code=1002,
            message=f"⚠️ 配置已保存但测试失败：{status['message']}",
            data=status,
        )


@router.get("/wecom/config", response_model=ApiResponse)
async def get_wecom_config():
    """获取当前配置（脱敏显示）。"""
    if not wecom_service.is_configured:
        return ApiResponse(data={"configured": False, "webhook_url": ""})

    url = wecom_service._webhook_url or ""
    # 脱敏：只显示前缀和 key 的前 8 位
    if "?key=" in url:
        masked = url.split("?key=")[0] + "?key=" + url.split("?key=")[1][:8] + "***"
    else:
        masked = url[:30] + "..."

    return ApiResponse(data={
        "configured": True,
        "webhook_url": masked,
    })


@router.post("/wecom/send-test", response_model=ApiResponse)
async def send_test_message():
    """发送测试消息到群聊。"""
    if not wecom_service.is_configured:
        return ApiResponse(code=1001, message="请先配置群机器人 Webhook URL")

    status = await wecom_service.test_connection()
    if status["success"]:
        return ApiResponse(message=status.get("message", "测试消息已发送 ✅"))
    else:
        return ApiResponse(
            code=1001,
            message=status.get("message", "发送失败"),
            data=status.get("error"),
        )


@router.post("/wecom/send-checkup-reminder", response_model=ApiResponse)
async def send_checkup_reminder_api(
    checkup_name: str,
    gestational_week: int,
    checkup_date: str,
    items: Optional[str] = None,
):
    """手动触发产检提醒推送。

    可用于：
    - 测试产检提醒效果
    - 从其他模块调用（如 Dashboard 事件流）
    """
    if not wecom_service.is_configured:
        return ApiResponse(code=1001, message="未配置群机器人")

    item_list = json.loads(items) if items else None

    result = await wecom_service.send_checkup_reminder(
        checkup_name=checkup_name,
        gestational_week=gestational_week,
        checkup_date=checkup_date,
        items=item_list,
    )

    if result.get("errcode") == 0:
        return ApiResponse(message="产检提醒已推送到群聊 ✅")
    else:
        return ApiResponse(
            code=1001,
            message=f"发送失败: {result.get('errmsg', '未知错误')}",
        )
