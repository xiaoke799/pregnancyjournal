"""孕程记 - 数据库连接与会话管理模块。

使用 SQLAlchemy 2.0 异步引擎 + aiosqlite 驱动。
Base 从 base.py 导入，避免与 models 循环依赖。
"""

import logging

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from backend.base import Base
from backend.config import settings

logger = logging.getLogger(__name__)


# 异步引擎（SQLite 性能优化配置）
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    # SQLite 是单文件数据库，不需要连接池
    # 使用 StaticPool 或 NullPool 避免不必要的连接管理开销
    pool_size=1,
    max_overflow=0,
    pool_recycle=1800,
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_connection, _connection_record):
    """Set SQLite PRAGMAs for maximum performance with WAL mode.

    关键优化项：
    - journal_mode=WAL: 并发读写支持，读不阻塞写
    - synchronous=NORMAL: 放松 fsync 频率（WAL模式下足够安全），写入速度提升 3-5 倍
    - busy_timeout=5000: 锁等待超时 5 秒
    - cache_size=-64000: 缓存 64MB（负值表示 KB）
    - mmap_size=268435456: 内存映射 256MB，大幅加速大表查询
    - temp_store=MEMORY: 临时表放内存
    - foreign_keys=ON: 外键约束
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("PRAGMA synchronous=NORMAL;")
    cursor.execute("PRAGMA busy_timeout=5000;")
    cursor.execute("PRAGMA cache_size=-64000;")
    cursor.execute("PRAGMA mmap_size=268435456;")
    cursor.execute("PRAGMA temp_store=MEMORY;")
    cursor.execute("PRAGMA foreign_keys=ON;")
    cursor.close()

# 异步会话工厂
async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncSession:
    """获取异步数据库会话的依赖注入函数。

    正常结束时自动提交；抛出异常时自动回滚。

    Yields:
        AsyncSession: 数据库会话实例。
    """
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db() -> None:
    """初始化数据库，创建所有表。

    先导入所有模型确保 Base.metadata 已注册全部表定义，
    再调用 create_all 创建表。
    """
    # 导入所有模型以注册表定义到 Base.metadata
    import backend.models  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db() -> None:
    """关闭数据库引擎连接池。"""
    await engine.dispose()
