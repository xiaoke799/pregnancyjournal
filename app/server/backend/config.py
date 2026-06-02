"""孕程记 - 应用配置管理模块。

从环境变量读取数据库路径、照片目录等配置信息。
飞牛 Native 模式下，默认路径使用 TRIM_* 环境变量。
"""

import os


class Settings:
    """应用全局配置，从环境变量加载。"""

    # 飞牛环境变量（运行时由飞牛注入）
    TRIM_APPDEST: str = os.getenv("TRIM_APPDEST", "")
    TRIM_PKGVAR: str = os.getenv("TRIM_PKGVAR", "")
    TRIM_DATA_SHARE_PATHS: str = os.getenv("TRIM_DATA_SHARE_PATHS", "")
    TRIM_SERVICE_PORT: str = os.getenv("TRIM_SERVICE_PORT", "8680")

    # 运行模式: fnos / dev
    APP_MODE: str = os.getenv("APP_MODE", "dev")

    # 数据库配置 — 飞牛模式默认存到 TRIM_PKGVAR
    DATABASE_PATH: str = os.getenv(
        "DATABASE_PATH",
        os.path.join(TRIM_PKGVAR, "pregnancy-journal.db") if TRIM_PKGVAR
        else os.path.join(os.path.dirname(__file__), "..", "data", "pregnancy-journal.db"),
    )
    DATABASE_URL: str = ""

    # 文件存储配置 — 飞牛模式默认存到数据共享目录
    _data_share = TRIM_DATA_SHARE_PATHS.split(":")[0] if TRIM_DATA_SHARE_PATHS else ""
    PHOTOS_DIR: str = os.getenv(
        "PHOTOS_DIR",
        os.path.join(_data_share, "photos") if _data_share
        else os.path.join(os.path.dirname(__file__), "..", "data", "photos"),
    )
    THUMBNAILS_DIR: str = os.getenv(
        "THUMBNAILS_DIR",
        os.path.join(_data_share, "thumbnails") if _data_share
        else os.path.join(os.path.dirname(__file__), "..", "data", "thumbnails"),
    )
    BACKUPS_DIR: str = os.getenv(
        "BACKUPS_DIR",
        os.path.join(_data_share, "backups") if _data_share
        else os.path.join(os.path.dirname(__file__), "..", "data", "backups"),
    )
    # V2.0 新增：视频/媒体存储目录
    MEDIA_DIR: str = os.getenv(
        "MEDIA_DIR",
        os.path.join(_data_share, "media") if _data_share
        else os.path.join(os.path.dirname(__file__), "..", "data", "media"),
    )

    # 上传限制
    MAX_UPLOAD_SIZE: int = 200 * 1024 * 1024  # 200MB
    MAX_VIDEO_UPLOAD_SIZE: int = 2 * 1024 * 1024 * 1024  # 2GB
    ALLOWED_UPLOAD_TYPES: tuple[str, ...] = ("image/", "video/")

    # 缩略图配置
    THUMBNAIL_WIDTH: int = 300
    THUMBNAIL_QUALITY: int = 80

    # 应用配置
    APP_NAME: str = "孕程记"
    APP_VERSION: str = "0.0.1"
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"

    # 飞牛网关认证 Header
    HEADER_USER_ID: str = "X-Trim-Userid"
    HEADER_IS_ADMIN: str = "X-Trim-Isadmin"
    HEADER_USERNAME: str = "X-Trim-Username"

    # 数据目录（预置 JSON）
    DATA_DIR: str = os.getenv("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))

    # Unix Socket（飞牛网关模式）
    SOCKET_PATH: str = os.getenv(
        "SOCKET_PATH",
        os.path.join(TRIM_APPDEST, "pregnancy-journal.sock") if TRIM_APPDEST
        else "",
    )

    # 静态文件目录（前端构建产物）
    STATIC_DIR: str = os.getenv(
        "STATIC_DIR",
        os.path.join(TRIM_APPDEST, "www") if TRIM_APPDEST
        else os.path.join(os.path.dirname(__file__), "..", "static"),
    )

    # Web Push VAPID 配置（用于浏览器推送通知）
    # 首次启动时会自动生成并保存到 data/vapid_keys.json
    VAPID_PRIVATE_KEY: str = os.getenv("VAPID_PRIVATE_KEY", "")
    VAPID_PUBLIC_KEY: str = os.getenv("VAPID_PUBLIC_KEY", "")
    VAPID_KEYS_FILE: str = os.getenv(
        "VAPID_KEYS_FILE",
        os.path.join(DATA_DIR, "vapid_keys.json"),
    )

    # 推送通知配置
    PUSH_ENABLED: bool = True
    PUSH_TTL: int = 24 * 60 * 60  # 消息存活时间 24 小时
    PUSH_URGENCY: str = "normal"  # very-low / low / normal / high

    # 企业微信 (WeCom) 推送配置 - 群聊模式
    # 在 .env 或环境变量中配置，或在 data/wecom_config.json 中设置
    WECOM_CORP_ID: str = os.getenv("WECOM_CORP_ID", "")
    WECOM_CORP_SECRET: str = os.getenv("WECOM_CORP_SECRET", "")
    try:
        WECOM_AGENT_ID: int = int(os.getenv("WECOM_AGENT_ID", "0")) or 0
    except (ValueError, TypeError):
        WECOM_AGENT_ID: int = 0
    WECOM_DEFAULT_CHAT_ID: str = os.getenv("WECOM_DEFAULT_CHAT_ID", "")  # 默认推送的群聊ID
    WECOM_CONFIG_FILE: str = os.getenv(
        "WECOM_CONFIG_FILE",
        os.path.join(DATA_DIR, "wecom_config.json"),
    )
    WECOM_ENABLED: bool = True

    def __init__(self) -> None:
        """初始化配置，构建数据库 URL。"""
        self.DATABASE_URL = f"sqlite+aiosqlite:///{self.DATABASE_PATH}"


settings = Settings()
