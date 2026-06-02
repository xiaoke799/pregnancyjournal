"""产检报告新增 sub_item 字段 - checkup_report 添加具体检查子项关联。

Revision ID: 004_checkup_report_sub_item
Revises: 003_checkup_fields
Create Date: 2026-06-26
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "004_checkup_report_sub_item"
down_revision: Union[str, None] = "003_checkup_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """checkup_report 表新增 sub_item 字段。"""
    op.add_column("checkup_report", sa.Column("sub_item", sa.String(), nullable=True))


def downgrade() -> None:
    """回滚 checkup_report 新增字段。"""
    op.drop_column("checkup_report", "sub_item")
