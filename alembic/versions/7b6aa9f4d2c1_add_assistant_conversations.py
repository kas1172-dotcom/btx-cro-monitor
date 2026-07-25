"""add assistant conversations

Revision ID: 7b6aa9f4d2c1
Revises: 4e12db9a6c10
Create Date: 2026-07-25 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7b6aa9f4d2c1"
down_revision: Union[str, Sequence[str], None] = "4e12db9a6c10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "assistant_conversations",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("tenant_id", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_by_user_id", sa.String(length=160), nullable=True),
        sa.Column("context", sa.JSON(), nullable=True),
        sa.Column("related_account_id", sa.String(length=80), nullable=True),
        sa.Column("related_program_id", sa.String(length=120), nullable=True),
        sa.Column("related_work_item_id", sa.String(length=32), nullable=True),
        sa.Column("related_signal_id", sa.String(length=120), nullable=True),
        sa.Column("related_deliverable_id", sa.String(length=32), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in [
        "tenant_id",
        "status",
        "created_by_user_id",
        "related_account_id",
        "related_program_id",
        "related_work_item_id",
        "related_signal_id",
        "related_deliverable_id",
        "archived_at",
        "created_at",
        "updated_at",
    ]:
        op.create_index(op.f(f"ix_assistant_conversations_{column}"), "assistant_conversations", [column])

    op.create_table(
        "assistant_messages",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("tenant_id", sa.String(length=80), nullable=False),
        sa.Column("conversation_id", sa.String(length=32), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("tool_activity", sa.JSON(), nullable=True),
        sa.Column("citations", sa.JSON(), nullable=True),
        sa.Column("related_records", sa.JSON(), nullable=True),
        sa.Column("action_draft", sa.JSON(), nullable=True),
        sa.Column("deliverable_draft", sa.JSON(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["assistant_conversations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ["tenant_id", "conversation_id", "role", "status", "created_at"]:
        op.create_index(op.f(f"ix_assistant_messages_{column}"), "assistant_messages", [column])


def downgrade() -> None:
    for column in ["created_at", "status", "role", "conversation_id", "tenant_id"]:
        op.drop_index(op.f(f"ix_assistant_messages_{column}"), table_name="assistant_messages")
    op.drop_table("assistant_messages")
    for column in [
        "updated_at",
        "created_at",
        "archived_at",
        "related_deliverable_id",
        "related_signal_id",
        "related_work_item_id",
        "related_program_id",
        "related_account_id",
        "created_by_user_id",
        "status",
        "tenant_id",
    ]:
        op.drop_index(op.f(f"ix_assistant_conversations_{column}"), table_name="assistant_conversations")
    op.drop_table("assistant_conversations")
