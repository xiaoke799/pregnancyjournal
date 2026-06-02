"""孕程记 - 照片/视频处理服务。

使用 Pillow 生成照片缩略图，使用 ffmpeg 截取视频第一帧作为缩略图。
如果 ffmpeg 不可用，视频缩略图使用默认占位图。
"""

import os
import subprocess
import uuid
from pathlib import Path
from typing import Optional, Tuple

from PIL import Image, ImageDraw

from backend.config import settings


class PhotoProcessor:
    """照片/视频处理服务，负责缩略图生成和存储路径管理。"""

    def __init__(self) -> None:
        """初始化照片处理器。"""
        self.photos_dir = Path(settings.PHOTOS_DIR)
        self.thumbnails_dir = Path(settings.THUMBNAILS_DIR)
        self.media_dir = Path(settings.MEDIA_DIR)
        self.thumbnail_width = settings.THUMBNAIL_WIDTH
        self.thumbnail_quality = settings.THUMBNAIL_QUALITY

    def generate_file_path(self, photo_type: str, gestational_week: Optional[int], ext: str = "jpg") -> str:
        """生成照片存储路径。

        格式: {PHOTOS_DIR}/{photo_type}/{gestational_week}w/{uuid}.{ext}

        Args:
            photo_type: 照片类型。
            gestational_week: 孕周。
            ext: 文件扩展名。

        Returns:
            完整存储路径。
        """
        week_str = f"{gestational_week or 0}w"
        dir_path = self.photos_dir / photo_type / week_str
        dir_path.mkdir(parents=True, exist_ok=True)
        filename = f"{uuid.uuid4()}.{ext}"
        return str(dir_path / filename)

    def generate_video_file_path(self, photo_type: str, gestational_week: Optional[int], ext: str = "mp4") -> str:
        """生成视频存储路径。

        格式: {MEDIA_DIR}/{photo_type}/{gestational_week}w/{uuid}.{ext}

        Args:
            photo_type: 照片类型。
            gestational_week: 孕周。
            ext: 文件扩展名。

        Returns:
            完整存储路径。
        """
        week_str = f"{gestational_week or 0}w"
        dir_path = self.media_dir / photo_type / week_str
        dir_path.mkdir(parents=True, exist_ok=True)
        filename = f"{uuid.uuid4()}.{ext}"
        return str(dir_path / filename)

    def generate_thumbnail_path(self, photo_type: str, gestational_week: Optional[int], filename: str) -> str:
        """生成缩略图存储路径。

        Args:
            photo_type: 照片类型。
            gestational_week: 孕周。
            filename: 原图文件名。

        Returns:
            缩略图完整路径。
        """
        week_str = f"{gestational_week or 0}w"
        dir_path = self.thumbnails_dir / photo_type / week_str
        dir_path.mkdir(parents=True, exist_ok=True)
        name, _ = os.path.splitext(filename)
        return str(dir_path / f"{name}_thumb.jpg")

    async def create_thumbnail(self, source_path: str, thumbnail_path: str) -> str:
        """生成照片缩略图。

        将原图缩放到指定宽度，保持宽高比，保存为 JPEG 格式。

        Args:
            source_path: 原图路径。
            thumbnail_path: 缩略图保存路径。

        Returns:
            缩略图路径。
        """
        with Image.open(source_path) as img:
            # 保持宽高比缩放
            ratio = self.thumbnail_width / img.width
            new_height = int(img.height * ratio)
            img_resized = img.resize((self.thumbnail_width, new_height), Image.LANCZOS)

            # 转换为 RGB（去除 RGBA 的 alpha 通道）
            if img_resized.mode in ("RGBA", "P"):
                img_resized = img_resized.convert("RGB")

            # 确保目录存在
            os.makedirs(os.path.dirname(thumbnail_path), exist_ok=True)

            img_resized.save(thumbnail_path, "JPEG", quality=self.thumbnail_quality)

        return thumbnail_path

    async def create_video_thumbnail(self, video_path: str, thumbnail_path: str) -> str:
        """生成视频缩略图。

        尝试使用 ffmpeg 截取视频第一帧。如果 ffmpeg 不可用，则生成一个默认占位图。

        Args:
            video_path: 视频文件路径。
            thumbnail_path: 缩略图保存路径。

        Returns:
            缩略图路径。
        """
        os.makedirs(os.path.dirname(thumbnail_path), exist_ok=True)

        # 尝试使用 ffmpeg 截取第一帧
        try:
            result = subprocess.run(
                [
                    "ffmpeg", "-i", video_path,
                    "-ss", "00:00:01",
                    "-frames:v", "1",
                    "-q:v", "2",
                    "-y",
                    thumbnail_path,
                ],
                capture_output=True,
                timeout=30,
            )
            if result.returncode == 0 and os.path.exists(thumbnail_path):
                # 缩放到标准缩略图大小
                try:
                    with Image.open(thumbnail_path) as img:
                        ratio = self.thumbnail_width / img.width
                        new_height = int(img.height * ratio)
                        img_resized = img.resize((self.thumbnail_width, new_height), Image.LANCZOS)
                        if img_resized.mode in ("RGBA", "P"):
                            img_resized = img_resized.convert("RGB")
                        img_resized.save(thumbnail_path, "JPEG", quality=self.thumbnail_quality)
                except Exception:
                    pass  # 保持 ffmpeg 原始输出
                return thumbnail_path
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            pass  # ffmpeg 不可用

        # 降级：生成默认占位图
        self._create_default_video_thumbnail(thumbnail_path)
        return thumbnail_path

    def _create_default_video_thumbnail(self, thumbnail_path: str) -> None:
        """生成默认视频占位缩略图。

        使用 Pillow 创建一个带有播放图标的灰色占位图。

        Args:
            thumbnail_path: 缩略图保存路径。
        """
        width = self.thumbnail_width
        height = int(self.thumbnail_width * 3 / 4)  # 4:3 比例

        # 创建灰色背景
        img = Image.new("RGB", (width, height), color=(230, 230, 235))
        draw = ImageDraw.Draw(img)

        # 画播放三角形
        cx, cy = width // 2, height // 2
        triangle_size = min(width, height) // 5
        points = [
            (cx - triangle_size // 2, cy - triangle_size),
            (cx - triangle_size // 2, cy + triangle_size),
            (cx + triangle_size, cy),
        ]
        draw.polygon(points, fill=(255, 255, 255, 200))

        # 画圆形背景
        circle_radius = int(triangle_size * 1.3)
        overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay)
        overlay_draw.ellipse(
            [cx - circle_radius, cy - circle_radius, cx + circle_radius, cy + circle_radius],
            fill=(0, 0, 0, 60),
        )
        img_rgba = img.convert("RGBA")
        img_rgba = Image.alpha_composite(img_rgba, overlay)

        # 添加"视频"文字
        text_y = cy + circle_radius + 10
        try:
            overlay_draw.text((cx, text_y), "视频", fill=(120, 120, 130), anchor="mt")
        except Exception:
            pass

        final = img_rgba.convert("RGB")
        final.save(thumbnail_path, "JPEG", quality=self.thumbnail_quality)

    def delete_photo_files(self, file_path: str, thumbnail_path: Optional[str] = None) -> None:
        """删除照片/视频文件和缩略图。

        Args:
            file_path: 原图/视频路径。
            thumbnail_path: 缩略图路径。
        """
        if os.path.exists(file_path):
            os.remove(file_path)
        if thumbnail_path and os.path.exists(thumbnail_path):
            os.remove(thumbnail_path)

    @staticmethod
    def get_image_extension(filename: str) -> str:
        """从文件名获取图片/视频扩展名。

        Args:
            filename: 文件名。

        Returns:
            小写扩展名（不含点号）。
        """
        return Path(filename).suffix.lower().lstrip(".")


photo_processor = PhotoProcessor()
