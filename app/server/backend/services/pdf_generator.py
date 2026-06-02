"""孕程记 - PDF 纪念册生成服务。

使用 ReportLab 生成孕期纪念册 PDF，支持中文字体。
V1.1: 使用bleach库进行HTML清理，防止XSS攻击。
"""

import json
import os
import re
from datetime import date
from pathlib import Path
from typing import Dict, List, Optional

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib.colors import HexColor
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage, PageBreak
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from backend.config import settings

try:
    import bleach
    HAS_BLEACH = True
except ImportError:
    HAS_BLEACH = False


class PDFGenerator:
    """PDF 纪念册生成服务。"""

    # 主题色
    PRIMARY_COLOR = HexColor("#E8A0BF")
    ACCENT_COLOR = HexColor("#7C6FA0")
    TEXT_COLOR = HexColor("#1F2937")
    LIGHT_BG = HexColor("#FDF2F8")

    def __init__(self) -> None:
        """初始化 PDF 生成器，注册中文字体。"""
        self._register_fonts()

    def _register_fonts(self) -> None:
        """注册中文字体。"""
        font_paths = [
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/noto-cjk/NotoSansCJKsc-Regular.otf",
        ]
        for fp in font_paths:
            if os.path.exists(fp):
                try:
                    pdfmetrics.registerFont(TTFont("NotoSansCJK", fp))
                    return
                except Exception:
                    continue
        # 找不到字体时使用默认
        try:
            pdfmetrics.registerFont(TTFont("NotoSansCJK", "NotoSansCJKsc-Regular"))
        except Exception:
            pass

    @staticmethod
    def _sanitize_html(html_content: str) -> str:
        """清理HTML内容，防止XSS攻击。

        优先使用bleach库进行专业清理，如果不可用则使用增强的正则表达式作为降级方案。

        Args:
            html_content: 可能包含HTML标签的原始内容。

        Returns:
            清理后的纯文本内容。
        """
        if not html_content:
            return ""

        if HAS_BLEACH:
            try:
                return bleach.clean(
                    html_content,
                    tags=[],
                    attributes={},
                    strip=True,
                    strip_comments=True
                )
            except Exception:
                pass

        # 降级方案：多层正则清理（比原始版本更安全）
        content = html_content

        # 移除script标签及其内容
        content = re.sub(r'<script[^>]*>.*?</script>', '', content, flags=re.IGNORECASE | re.DOTALL)

        # 移除style标签及其内容
        content = re.sub(r'<style[^>]*>.*?</style>', '', content, flags=re.IGNORECASE | re.DOTALL)

        # 移除HTML注释
        content = re.sub(r'<!--.*?-->', '', content, flags=re.DOTALL)

        # 处理常见的XSS绕过尝试（编码、空格等）
        content = re.sub(r'<[^>]+>', '', content)

        # 解码HTML实体
        import html as html_module
        content = html_module.unescape(content)

        return content.strip()

    def generate_pregnancy_book(self, pregnancy_data: Dict, output_path: str) -> str:
        """生成孕期纪念册 PDF。

        Args:
            pregnancy_data: 孕期完整数据，包含档案、产检、照片、日记等。
            output_path: PDF 输出路径。

        Returns:
            生成的 PDF 文件路径。
        """
        doc = SimpleDocTemplate(
            output_path,
            pagesize=A4,
            rightMargin=2 * cm,
            leftMargin=2 * cm,
            topMargin=2 * cm,
            bottomMargin=2 * cm,
        )

        styles = self._create_styles()
        story = []

        # 封面
        story.append(Spacer(1, 5 * cm))
        story.append(Paragraph("孕程记", styles["title"]))
        story.append(Spacer(1, 1 * cm))
        story.append(Paragraph("—— 我的孕期纪念册 ——", styles["subtitle"]))
        story.append(Spacer(1, 2 * cm))

        baby_name = pregnancy_data.get("baby_name", "宝宝")
        story.append(Paragraph(f"给 {baby_name} 的礼物", styles["body"]))
        due_date = pregnancy_data.get("due_date", "")
        if due_date:
            story.append(Paragraph(f"预产期：{due_date}", styles["body"]))

        story.append(PageBreak())

        # 孕期信息
        story.append(Paragraph("孕期档案", styles["heading1"]))
        story.append(Spacer(1, 0.5 * cm))
        info_data = [
            ["末次月经日期", pregnancy_data.get("last_period_date", "")],
            ["预产期", pregnancy_data.get("due_date", "")],
            ["宝宝昵称", pregnancy_data.get("baby_name", "")],
        ]
        info_table = Table(info_data, colWidths=[5 * cm, 10 * cm])
        info_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), self.LIGHT_BG),
            ("TEXTCOLOR", (0, 0), (-1, -1), self.TEXT_COLOR),
            ("ALIGN", (0, 0), (-1, -1), "LEFT"),
            ("FONTNAME", (0, 0), (-1, -1), "NotoSansCJK"),
            ("FONTSIZE", (0, 0), (-1, -1), 11),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#E5E7EB")),
        ]))
        story.append(info_table)
        story.append(PageBreak())

        # 产检记录
        checkups = pregnancy_data.get("checkups", [])
        if checkups:
            story.append(Paragraph("产检记录", styles["heading1"]))
            story.append(Spacer(1, 0.5 * cm))
            for checkup in checkups:
                story.append(Paragraph(
                    f"第{checkup.get('gestational_week', '')}周 · {checkup.get('checkup_date', '')}",
                    styles["heading2"]
                ))
                story.append(Paragraph(f"类型：{checkup.get('checkup_type', '')}", styles["body"]))
                if checkup.get("weight"):
                    story.append(Paragraph(f"体重：{checkup['weight']}kg", styles["body"]))
                if checkup.get("blood_pressure"):
                    story.append(Paragraph(f"血压：{checkup['blood_pressure']}", styles["body"]))
                if checkup.get("fetal_heart_rate"):
                    story.append(Paragraph(f"胎心率：{checkup['fetal_heart_rate']}bpm", styles["body"]))
                if checkup.get("notes"):
                    story.append(Paragraph(f"备注：{checkup['notes']}", styles["body"]))
                story.append(Spacer(1, 0.5 * cm))
            story.append(PageBreak())

        # 日记
        diaries = pregnancy_data.get("diaries", [])
        if diaries:
            story.append(Paragraph("孕期日记", styles["heading1"]))
            story.append(Spacer(1, 0.5 * cm))
            for diary in diaries:
                story.append(Paragraph(
                    f"{diary.get('entry_date', '')} · 孕{diary.get('gestational_week', '')}周",
                    styles["heading2"]
                ))
                content = diary.get("content", "")
                clean_content = self._sanitize_html(content)
                story.append(Paragraph(clean_content, styles["body"]))
                story.append(Spacer(1, 0.5 * cm))

        # 照片页
        photos = pregnancy_data.get("photos", [])
        if photos:
            story.append(PageBreak())
            story.append(Paragraph("孕期相册", styles["heading1"]))
            story.append(Spacer(1, 0.5 * cm))
            for photo in photos:
                file_path = photo.get("file_path", "")
                if os.path.exists(file_path):
                    try:
                        img = RLImage(file_path, width=12 * cm, height=9 * cm)
                        story.append(img)
                        caption = f"孕{photo.get('gestational_week', '')}周"
                        if photo.get("note"):
                            caption += f" · {photo['note']}"
                        story.append(Paragraph(caption, styles["caption"]))
                        story.append(Spacer(1, 0.5 * cm))
                    except Exception:
                        pass

        # 最后一页
        story.append(PageBreak())
        story.append(Spacer(1, 5 * cm))
        story.append(Paragraph("期待你的到来 ❤️", styles["title"]))

        doc.build(story)
        return output_path

    def generate_photo_timeline(self, photos: List[Dict], output_path: str,
                                title: str = "孕期相册时间轴") -> str:
        """按孕周时间轴生成照片 PDF。

        Args:
            photos: 照片列表，每项含 file_path, gestational_week, created_at, note, media_type。
            output_path: PDF 输出路径。
            title: 文档标题。

        Returns:
            生成的 PDF 文件路径。
        """
        from collections import OrderedDict
        from datetime import datetime as dt
        import re

        doc = SimpleDocTemplate(
            output_path, pagesize=A4,
            rightMargin=1.5 * cm, leftMargin=1.5 * cm,
            topMargin=1.5 * cm, bottomMargin=1.5 * cm,
        )
        styles = self._create_styles()
        story = []

        story.append(Spacer(1, 4 * cm))
        story.append(Paragraph(title, styles["title"]))
        story.append(Spacer(1, 0.8 * cm))
        story.append(Paragraph(f"共 {len(photos)} 张照片", styles["subtitle"]))
        story.append(PageBreak())

        grouped: OrderedDict[int, List[Dict]] = OrderedDict()
        for p in photos:
            week = p.get("gestational_week") or 0
            grouped.setdefault(week, []).append(p)

        for week in sorted(grouped.keys()):
            week_photos = grouped[week]
            week_photos.sort(key=lambda x: x.get("created_at") or "")

            if week > 0:
                week_label = f"第 {week} 周"
            else:
                week_label = "其他"
            story.append(Paragraph(week_label, styles["heading1"]))
            story.append(Spacer(1, 0.3 * cm))

            for photo in week_photos:
                file_path = photo.get("file_path", "")
                if not file_path or not os.path.exists(file_path):
                    continue

                try:
                    img = RLImage(file_path, width=14 * cm, height=10.5 * cm)
                    img.hAlign = "CENTER"
                    story.append(img)
                except Exception:
                    story.append(Paragraph("[图片无法加载]", styles["caption"]))
                    story.append(Spacer(1, 0.2 * cm))
                    continue

                caption_parts = []
                created = photo.get("created_at", "")
                if created:
                    if isinstance(created, str):
                        caption_parts.append(created[:10])
                    elif hasattr(created, "strftime"):
                        caption_parts.append(created.strftime("%Y-%m-%d"))
                note = photo.get("note", "")
                if note:
                    clean_note = re.sub(r"<[^>]+>", "", note)
                    caption_parts.append(clean_note)
                media_type = photo.get("media_type", "photo")
                if media_type == "video":
                    caption_parts.append("视频")

                caption = " · ".join(caption_parts) if caption_parts else ""
                if caption:
                    story.append(Paragraph(caption, styles["caption"]))
                story.append(Spacer(1, 0.5 * cm))

            story.append(PageBreak())

        if not story or len(story) <= 1:
            story.append(Spacer(1, 5 * cm))
            story.append(Paragraph("暂无照片", styles["body"]))

        doc.build(story)
        return output_path

    def _create_styles(self) -> Dict:
        """创建 PDF 文档样式。

        Returns:
            样式字典。
        """
        font_name = "NotoSansCJK"
        styles = getSampleStyleSheet()

        styles.add(ParagraphStyle(
            name="CNTitle",
            fontName=font_name,
            fontSize=28,
            leading=36,
            alignment=1,
            textColor=self.PRIMARY_COLOR,
        ))
        styles.add(ParagraphStyle(
            name="CNSubtitle",
            fontName=font_name,
            fontSize=16,
            leading=24,
            alignment=1,
            textColor=self.ACCENT_COLOR,
        ))
        styles.add(ParagraphStyle(
            name="CNHeading1",
            fontName=font_name,
            fontSize=20,
            leading=28,
            textColor=self.ACCENT_COLOR,
            spaceAfter=12,
        ))
        styles.add(ParagraphStyle(
            name="CNHeading2",
            fontName=font_name,
            fontSize=14,
            leading=20,
            textColor=self.TEXT_COLOR,
            spaceAfter=8,
        ))
        styles.add(ParagraphStyle(
            name="CNBody",
            fontName=font_name,
            fontSize=11,
            leading=18,
            textColor=self.TEXT_COLOR,
        ))
        styles.add(ParagraphStyle(
            name="CNCaption",
            fontName=font_name,
            fontSize=9,
            leading=14,
            alignment=1,
            textColor=HexColor("#6B7280"),
        ))

        return {
            "title": styles["CNTitle"],
            "subtitle": styles["CNSubtitle"],
            "heading1": styles["CNHeading1"],
            "heading2": styles["CNHeading2"],
            "body": styles["CNBody"],
            "caption": styles["CNCaption"],
        }


pdf_generator = PDFGenerator()
