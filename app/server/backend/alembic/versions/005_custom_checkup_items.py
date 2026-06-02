"""自定义产检表新增 items 字段 - custom_checkup 添加检查子项JSON数组。

Revision ID: 005_custom_checkup_items
Revises: 004_checkup_report_sub_item
Create Date: 2026-06-26
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "005_custom_checkup_items"
down_revision: Union[str, None] = "004_checkup_report_sub_item"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """custom_checkup 表新增 items 字段。"""
    op.add_column("custom_checkup", sa.Column("items", sa.Text(), nullable=True))


def downgrade() -> None:
    """回滚 custom_checkup 新增字段。"""
    op.drop_column("custom_checkup", "items")
