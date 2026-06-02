"""checklist_item 表新增 description 和 is_mandatory 字段。

Revision ID: 006_checklist_item_fields
Revises: 005_custom_checkup_items
Create Date: 2026-06-26
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "006_checklist_item_fields"
down_revision: Union[str, None] = "005_custom_checkup_items"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """checklist_item 表新增 description 和 is_mandatory 字段。"""
    op.add_column("checklist_item", sa.Column("description", sa.String(), nullable=True))
    op.add_column("checklist_item", sa.Column("is_mandatory", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    """回滚 checklist_item 新增字段。"""
    op.drop_column("checklist_item", "is_mandatory")
    op.drop_column("checklist_item", "description")
