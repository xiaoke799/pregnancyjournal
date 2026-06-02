"""孕程记 - SQLAlchemy 声明式基类。

单独存放 Base，避免 database.py 与 models 之间的循环导入。
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """SQLAlchemy 声明式基类。"""
    pass
