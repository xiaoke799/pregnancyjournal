"""V2.0 新增字段和表 - DailyRecord 新增 13 个字段、PregnancyPhoto 新增 media_type、新建 app_config 表。

Revision ID: 002_v2_additions
Revises: 001_initial
Create Date: 2026-06-25
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "002_v2_additions"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """V2.0 数据库变更：新增 app_config 表，DailyRecord 新增 13 个字段，PregnancyPhoto 新增 media_type。"""

    # 1. 创建 app_config 表
    op.create_table(
        "app_config",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", sa.TEXT(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )

    # 2. DailyRecord 新增 13 个字段
    op.add_column("daily_record", sa.Column("blood_pressure_systolic", sa.String(), nullable=True))
    op.add_column("daily_record", sa.Column("blood_pressure_diastolic", sa.String(), nullable=True))
    op.add_column("daily_record", sa.Column("sleep_hours", sa.REAL(), nullable=True))
    op.add_column("daily_record", sa.Column("sleep_quality", sa.String(), nullable=True))
    op.add_column("daily_record", sa.Column("symptoms", sa.TEXT(), nullable=True))
    op.add_column("daily_record", sa.Column("exercise_type", sa.String(), nullable=True))
    op.add_column("daily_record", sa.Column("exercise_duration", sa.Integer(), nullable=True))
    op.add_column("daily_record", sa.Column("diet_note", sa.TEXT(), nullable=True))
    op.add_column("daily_record", sa.Column("medication", sa.TEXT(), nullable=True))
    op.add_column("daily_record", sa.Column("edema_level", sa.String(), nullable=True))
    op.add_column("daily_record", sa.Column("vaginal_discharge", sa.String(), nullable=True))
    op.add_column("daily_record", sa.Column("skin_condition", sa.String(), nullable=True))
    op.add_column("daily_record", sa.Column("urination_frequency", sa.String(), nullable=True))

    # 3. PregnancyPhoto 新增 media_type 字段
    op.add_column("pregnancy_photo", sa.Column("media_type", sa.String(), nullable=True, server_default="photo"))


def downgrade() -> None:
    """回滚 V2.0 变更。"""

    # 3. 删除 PregnancyPhoto 的 media_type 字段
    op.drop_column("pregnancy_photo", "media_type")

    # 2. 删除 DailyRecord 新增的 13 个字段
    op.drop_column("daily_record", "urination_frequency")
    op.drop_column("daily_record", "skin_condition")
    op.drop_column("daily_record", "vaginal_discharge")
    op.drop_column("daily_record", "edema_level")
    op.drop_column("daily_record", "medication")
    op.drop_column("daily_record", "diet_note")
    op.drop_column("daily_record", "exercise_duration")
    op.drop_column("daily_record", "exercise_type")
    op.drop_column("daily_record", "symptoms")
    op.drop_column("daily_record", "sleep_quality")
    op.drop_column("daily_record", "sleep_hours")
    op.drop_column("daily_record", "blood_pressure_diastolic")
    op.drop_column("daily_record", "blood_pressure_systolic")

    # 1. 删除 app_config 表
    op.drop_table("app_config")
