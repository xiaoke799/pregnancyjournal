"""初始数据库迁移 - 创建全部表。

Revision ID: 001_initial
Revises:
Create Date: 2026-06-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """创建全部数据表。"""
    op.create_table(
        "pregnancy",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("last_period_date", sa.String(), nullable=False),
        sa.Column("conception_date", sa.String(), nullable=True),
        sa.Column("due_date", sa.String(), nullable=False),
        sa.Column("is_active", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("baby_name", sa.String(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_pregnancy_active", "pregnancy", ["is_active"])

    op.create_table(
        "prenatal_checkup",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("pregnancy_id", sa.String(), nullable=False),
        sa.Column("checkup_date", sa.String(), nullable=False),
        sa.Column("gestational_week", sa.Integer(), nullable=False),
        sa.Column("gestational_day", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("checkup_type", sa.String(), nullable=False),
        sa.Column("weight", sa.REAL(), nullable=True),
        sa.Column("blood_pressure", sa.String(), nullable=True),
        sa.Column("fetal_heart_rate", sa.Integer(), nullable=True),
        sa.Column("fundal_height", sa.REAL(), nullable=True),
        sa.Column("notes", sa.TEXT(), nullable=True),
        sa.Column("is_completed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["pregnancy_id"], ["pregnancy.id"]),
    )
    op.create_index("idx_checkup_pregnancy_date", "prenatal_checkup", ["pregnancy_id", "checkup_date"])

    op.create_table(
        "checkup_photo",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("checkup_id", sa.String(), nullable=False),
        sa.Column("file_path", sa.String(), nullable=False),
        sa.Column("thumbnail_path", sa.String(), nullable=True),
        sa.Column("note", sa.TEXT(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["checkup_id"], ["prenatal_checkup.id"]),
    )

    op.create_table(
        "lab_result",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("checkup_id", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("item_name", sa.String(), nullable=False),
        sa.Column("value", sa.REAL(), nullable=False),
        sa.Column("unit", sa.String(), nullable=False),
        sa.Column("reference_min", sa.REAL(), nullable=True),
        sa.Column("reference_max", sa.REAL(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="normal"),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["checkup_id"], ["prenatal_checkup.id"]),
    )
    op.create_index("idx_lab_checkup_category", "lab_result", ["checkup_id", "category"])

    op.create_table(
        "daily_record",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("pregnancy_id", sa.String(), nullable=False),
        sa.Column("record_date", sa.String(), nullable=False),
        sa.Column("weight", sa.REAL(), nullable=True),
        sa.Column("fetal_heart_rate", sa.Integer(), nullable=True),
        sa.Column("body_temp", sa.REAL(), nullable=True),
        sa.Column("blood_glucose_fasting", sa.REAL(), nullable=True),
        sa.Column("blood_glucose_1h", sa.REAL(), nullable=True),
        sa.Column("blood_glucose_2h", sa.REAL(), nullable=True),
        sa.Column("mood", sa.Integer(), nullable=True),
        sa.Column("mood_note", sa.TEXT(), nullable=True),
        sa.Column("stool", sa.String(), nullable=True),
        sa.Column("note", sa.TEXT(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["pregnancy_id"], ["pregnancy.id"]),
    )
    op.create_index("idx_daily_pregnancy_date", "daily_record", ["pregnancy_id", "record_date"], unique=True)

    op.create_table(
        "fetal_movement_session",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("pregnancy_id", sa.String(), nullable=False),
        sa.Column("session_date", sa.String(), nullable=False),
        sa.Column("start_time", sa.String(), nullable=False),
        sa.Column("end_time", sa.String(), nullable=True),
        sa.Column("total_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.TEXT(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["pregnancy_id"], ["pregnancy.id"]),
    )

    op.create_table(
        "fetal_movement",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("timestamp", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["session_id"], ["fetal_movement_session.id"]),
    )

    op.create_table(
        "contraction_session",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("pregnancy_id", sa.String(), nullable=False),
        sa.Column("session_date", sa.String(), nullable=False),
        sa.Column("start_time", sa.String(), nullable=False),
        sa.Column("end_time", sa.String(), nullable=True),
        sa.Column("total_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("avg_duration", sa.REAL(), nullable=True),
        sa.Column("avg_interval", sa.REAL(), nullable=True),
        sa.Column("alert_triggered", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.TEXT(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["pregnancy_id"], ["pregnancy.id"]),
    )

    op.create_table(
        "contraction",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("start_time", sa.String(), nullable=False),
        sa.Column("end_time", sa.String(), nullable=True),
        sa.Column("duration", sa.REAL(), nullable=True),
        sa.Column("interval_from_prev", sa.REAL(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["session_id"], ["contraction_session.id"]),
    )

    op.create_table(
        "pregnancy_photo",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("pregnancy_id", sa.String(), nullable=False),
        sa.Column("checkup_id", sa.String(), nullable=True),
        sa.Column("photo_type", sa.String(), nullable=False),
        sa.Column("gestational_week", sa.Integer(), nullable=True),
        sa.Column("gestational_day", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("milestone_type", sa.String(), nullable=True),
        sa.Column("file_path", sa.String(), nullable=False),
        sa.Column("thumbnail_path", sa.String(), nullable=True),
        sa.Column("note", sa.TEXT(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["pregnancy_id"], ["pregnancy.id"]),
        sa.ForeignKeyConstraint(["checkup_id"], ["prenatal_checkup.id"]),
    )
    op.create_index("idx_photo_pregnancy_type", "pregnancy_photo", ["pregnancy_id", "photo_type", "gestational_week"])

    op.create_table(
        "diary_entry",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("pregnancy_id", sa.String(), nullable=False),
        sa.Column("entry_date", sa.String(), nullable=False),
        sa.Column("gestational_week", sa.Integer(), nullable=True),
        sa.Column("content", sa.TEXT(), nullable=False),
        sa.Column("photo_ids", sa.TEXT(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["pregnancy_id"], ["pregnancy.id"]),
    )
    op.create_index("idx_diary_pregnancy_date", "diary_entry", ["pregnancy_id", "entry_date"])

    op.create_table(
        "checklist",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("pregnancy_id", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["pregnancy_id"], ["pregnancy.id"]),
    )

    op.create_table(
        "checklist_item",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("checklist_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("is_checked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_custom", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["checklist_id"], ["checklist.id"]),
    )

    op.create_table(
        "reminder",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("pregnancy_id", sa.String(), nullable=False),
        sa.Column("reminder_type", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("trigger_date", sa.String(), nullable=True),
        sa.Column("trigger_time", sa.String(), nullable=True),
        sa.Column("advance_days", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("repeat_rule", sa.String(), nullable=False, server_default="once"),
        sa.Column("is_enabled", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_triggered", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["pregnancy_id"], ["pregnancy.id"]),
    )
    op.create_index("idx_reminder_pregnancy_enabled", "reminder", ["pregnancy_id", "is_enabled", "trigger_date"])


def downgrade() -> None:
    """删除全部数据表。"""
    op.drop_index("idx_reminder_pregnancy_enabled", table_name="reminder")
    op.drop_table("reminder")
    op.drop_table("checklist_item")
    op.drop_table("checklist")
    op.drop_index("idx_diary_pregnancy_date", table_name="diary_entry")
    op.drop_table("diary_entry")
    op.drop_index("idx_photo_pregnancy_type", table_name="pregnancy_photo")
    op.drop_table("pregnancy_photo")
    op.drop_table("contraction")
    op.drop_table("contraction_session")
    op.drop_table("fetal_movement")
    op.drop_table("fetal_movement_session")
    op.drop_index("idx_daily_pregnancy_date", table_name="daily_record")
    op.drop_table("daily_record")
    op.drop_index("idx_lab_checkup_category", table_name="lab_result")
    op.drop_table("lab_result")
    op.drop_table("checkup_photo")
    op.drop_index("idx_checkup_pregnancy_date", table_name="prenatal_checkup")
    op.drop_table("prenatal_checkup")
    op.drop_index("idx_pregnancy_active", table_name="pregnancy")
    op.drop_table("pregnancy")
