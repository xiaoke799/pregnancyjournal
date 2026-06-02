"""产检表新增字段 - prenatal_checkup 添加 hospital、abdominal_circumference、is_recommended。

Revision ID: 003_checkup_fields
Revises: 002_v2_additions
Create Date: 2026-06-26
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "003_checkup_fields"
down_revision: Union[str, None] = "002_v2_additions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """prenatal_checkup 表新增 hospital、abdominal_circumference、is_recommended 字段。"""
    op.add_column("prenatal_checkup", sa.Column("hospital", sa.String(), nullable=True))
    op.add_column("prenatal_checkup", sa.Column("abdominal_circumference", sa.REAL(), nullable=True))
    op.add_column("prenatal_checkup", sa.Column("is_recommended", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    """回滚 prenatal_checkup 新增字段。"""
    op.drop_column("prenatal_checkup", "is_recommended")
    op.drop_column("prenatal_checkup", "abdominal_circumference")
    op.drop_column("prenatal_checkup", "hospital")
