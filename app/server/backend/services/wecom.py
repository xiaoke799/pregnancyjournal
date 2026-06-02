"""孕程记 - 企业微信群机器人推送服务（Webhook 模式）。

使用企业微信群机器人的 Webhook URL 直接发送消息，无需 access_token。
这是最简单的推送方式：建群 → 加机器人 → 复制 Webhook → 填入即可使用。

API 文档: https://developer.work.weixin.qq.com/document/path/99110

用法：
    from backend.services.wecom import wecom_service

    await wecom_service.send_text("hello world")
    await wecom_service.send_checkup_reminder("NT检查", 12, "2026-07-15")
"""

import json
import os
from typing import Optional

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

from backend.config import settings


class WeComWebhookService:
    """企业微信群机器人 Webhook 推送服务。

    极简设计：只需一个 Webhook URL，直接 POST 发消息。
    """

    def __init__(self):
        self._webhook_url: str = ""
        self._http_client: Optional[object] = None

    @property
    def available(self) -> bool:
        return HAS_HTTPX

    async def _get_http_client(self):
        if not HAS_HTTPX:
            raise RuntimeError("httpx 未安装，企业微信推送不可用")
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(timeout=15.0)
        return self._http_client

    async def close(self):
        if self._http_client and not self._http_client.is_closed:
            await self._http_client.aclose()
            self._http_client = None

    def load_webhook_url(self) -> str:
        """从配置文件或环境变量加载 Webhook URL。"""
        # 优先环境变量
        env_url = os.getenv("WECOM_WEBHOOK_URL", "")
        if env_url:
            self._webhook_url = env_url
            return env_url

        # 从配置文件读取
        config_file = settings.WECOM_CONFIG_FILE
        if os.path.exists(config_file):
            with open(config_file, "r", encoding="utf-8") as f:
                config = json.load(f)
            url = config.get("webhook_url", "")
            if url:
                self._webhook_url = url
                return url

        return ""

    def save_webhook_url(self, url: str) -> None:
        """保存 Webhook URL 到配置文件。"""
        self._webhook_url = url
        config_file = settings.WECOM_CONFIG_FILE
        os.makedirs(os.path.dirname(config_file), exist_ok=True)

        with open(config_file, "w", encoding="utf-8") as f:
            json.dump({"webhook_url": url}, f, ensure_ascii=False, indent=2)

    @property
    def is_configured(self) -> bool:
        """是否已配置。"""
        if self._webhook_url:
            return True
        return bool(self.load_webhook_url())

    # ========== 消息发送方法 ==========

    async def send_text(
        self,
        content: str,
        mentioned_list: Optional[list[str]] = None,
        mentioned_mobile_list: Optional[list[str]] = None,
    ) -> dict:
        """发送文本消息。

        Args:
            content: 文本内容 (最长 2048 字节)
            mentioned_list: @的用户 ID 列表，["@all"] 表示 @所有人
            mentioned_mobile_list: @的手机号列表

        Returns:
            {"errcode": 0, "errmsg": "ok"} 或错误信息
        """
        payload: dict = {
            "msgtype": "text",
            "text": {"content": content},
        }
        if mentioned_list:
            payload["text"]["mentioned_list"] = mentioned_list
        if mentioned_mobile_list:
            payload["text"]["mentioned_mobile_list"] = mentioned_mobile_list

        return await self._post(payload)

    async def send_markdown(self, content: str) -> dict:
        """发送 Markdown 格式消息（支持标题、加粗、链接、字体颜色等）。

        Args:
            content: Markdown 内容 (最长 4096 字节)
                支持语法: # 标题 **加粗** [链接](url) `代码` > 引用 <font color="info/warning/comment">颜色</font>

        Returns:
            API 响应结果
        """
        payload = {
            "msgtype": "markdown",
            "markdown": {"content": content},
        }
        return await self._post(payload)

    async def send_template_card(
        self,
        title: str,
        description: str,
        btn_text: str = "查看详情",
        btn_url: str = "",
        highlight_title: Optional[str] = None,
        highlight_desc: Optional[str] = None,
        quote_text: Optional[str] = None,
        extra_fields: Optional[list[dict]] = None,
    ) -> dict:
        """发送模板卡片消息（最适合产检提醒等正式通知）。

        Args:
            title: 主标题（建议 ≤ 26 字）
            description: 描述信息（建议 ≤ 30 字）
            btn_text: 按钮文字
            btn_url: 按钮跳转链接
            highlight_title: 关键数据标题（如 "孕12周"）
            highlight_desc: 关键数据描述（如 "距离产检还有3天"）
            quote_text: 引用文本（多行用 \\n 分隔）
            extra_fields: 额外的横向内容列表 [{"keyname": "...", "value": "..."}]

        Returns:
            API 响应结果
        """
        card: dict = {
            "card_type": "text_notice",
            "source": {
                "icon_url": "",
                "desc": "孕程记",
                "desc_color": 0,
            },
            "main_title": {
                "title": title,
                "desc": description,
            },
            "card_action": {
                "type": 1,
                "url": btn_url,
            },
        }

        # 关键数据高亮
        if highlight_title:
            card["emphasis_content"] = {
                "title": highlight_title,
                "desc": highlight_desc or "",
            }

        # 引用区域
        if quote_text:
            card["quote_area"] = {
                "type": 0,
                "title": "详情",
                "quote_text": quote_text,
            }

        # 额外字段
        if extra_fields:
            card["horizontal_content_list"] = extra_fields

        # 按钮
        if btn_text and btn_url:
            card["jump_list"] = [{
                "type": 1,
                "url": btn_url,
                "title": btn_text,
            }]

        payload = {
            "msgtype": "template_card",
            "template_card": card,
        }
        return await self._post(payload)

    # ========== 业务专用方法 ==========

    async def send_checkup_reminder(
        self,
        checkup_name: str,
        gestational_week: int,
        checkup_date: str,
        items: Optional[list[str]] = None,
    ) -> dict:
        """发送产检提醒（模板卡片格式）。

        示例效果：
        ┌─────────────────────────────┐
        │  孕程记                      │
        │  🏥 NT检查                  │
        │  孕12周 · 2026-07-15         │
        │                              │
        │  ┌──────────────────┐       │
        │  │ 孕12周           │       │
        │  │ 还有 3 天        │       │
        │  └──────────────────┘       │
        │                              │
        │  检查项目:                   │
        │  • B超                       │
        │  • 血常规                     │
        │  • 尿常规                     │
        │                              │
        │              [查看详情]      │
        └─────────────────────────────┘
        """
        from datetime import date
        days_left = (date.fromisoformat(checkup_date) - date.today()).days

        item_text = "\n".join([f"• {item}" for item in (items or [])]) if items else ""

        return await self.send_template_card(
            title=f"🏥 {checkup_name}",
            description=f"孕{gestational_week}周 · {checkup_date}",
            highlight_title=f"孕{gestational_week}周",
            highlight_desc=f"{'今天' if days_left <= 0 else f'还有 {days_left} 天'}",
            quote_text=item_text or "请按时前往医院进行检查",
            btn_text="查看产检时间表",
            btn_url="/checkup-schedule",
        )

    async def send_event_notification(
        self,
        event_type: str,
        event_title: str,
        event_body: str,
        event_url: str = "/",
    ) -> dict:
        """发送重要事件通知。"""
        icons = {
            "checkup": "🏥",
            "record_alert": "⚠️",
            "reminder": "📌",
            "custom": "💬",
        }
        icon = icons.get(event_type, "🔔")

        return await self.send_markdown(
            f"{icon} **{event_title}**\n\n{event_body}\n\n"
            f"[查看详情 →]({event_url})"
        )

    async def test_connection(self) -> dict:
        """测试 Webhook 是否可用。"""
        if not HAS_HTTPX:
            return {
                "success": False,
                "message": "httpx 未安装，企业微信推送不可用（请在 venv 中执行: pip install httpx）",
                "configured": False,
            }
        if not self.is_configured:
            return {
                "success": False,
                "message": "未配置群机器人 Webhook URL",
                "configured": False,
            }

        result = await self.send_text(
            content=(
                "🧪 **孕程记 - 推送测试成功！**\n\n"
                "如果您收到此消息，说明群机器人配置正确 ✅\n\n"
                "_后续产检提醒和重要事件将通过此群推送_"
            ),
            mentioned_list=["@all"],
        )

        if result.get("errcode") == 0:
            return {
                "success": True,
                "message": "测试消息已发送到群聊 ✅",
                "configured": True,
            }
        else:
            return {
                "success": False,
                "message": f"发送失败: {result.get('errmsg', '未知错误')}",
                "configured": True,
                "error": result,
            }

    # ========== 内部方法 ==========

    async def _post(self, payload: dict) -> dict:
        """POST 消息到 Webhook URL。"""
        if not self.is_configured:
            return {"errcode": -1, "errmsg": "未配置 Webhook URL"}

        try:
            client = await self._get_http_client()
            resp = await client.post(
                self._webhook_url,
                json=payload,
                headers={"Content-Type": "application/json"},
            )
            data = resp.json()

            if data.get("errcode") == 0:
                print(f"✅ 企业微信群机器人消息发送成功")
            else:
                print(f"❌ 企业微信群机器人发送失败: {data}")

            return data

        except Exception as e:
            print(f"❌ 企业微信群机器人请求异常: {e}")
            return {"errcode": -2, "errmsg": str(e)}


# 全局单例
wecom_service = WeComWebhookService()