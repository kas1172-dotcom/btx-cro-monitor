"""add work item lifecycle notes

Revision ID: 9f2b1c7d4e65
Revises: f4b7c6d8e901
Create Date: 2026-07-25 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9f2b1c7d4e65"
down_revision: Union[str, Sequence[str], None] = "f4b7c6d8e901"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("work_items") as batch:
        batch.add_column(sa.Column("priority_status", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("description", sa.Text(), nullable=True))
        batch.add_column(sa.Column("outcome_category", sa.String(length=80), nullable=True))
        batch.add_column(sa.Column("dismissal_reason", sa.Text(), nullable=True))
        batch.add_column(sa.Column("rejection_reason", sa.Text(), nullable=True))
    op.create_index(op.f("ix_work_items_priority_status"), "work_items", ["priority_status"])
    op.create_index(op.f("ix_work_items_outcome_category"), "work_items", ["outcome_category"])
    op.execute("UPDATE work_items SET status = 'detected' WHERE status = 'proposed'")
    op.execute("UPDATE work_items SET status = 'closed' WHERE status = 'done'")
    op.execute("UPDATE work_items SET execution_state = 'pending' WHERE execution_state IN ('queued', 'running')")
    op.execute("UPDATE work_items SET execution_state = 'verified' WHERE execution_state = 'completed'")
    op.execute("UPDATE work_items SET priority_status = 'available' WHERE priority_status IS NULL")

    op.create_table(
        "work_item_notes",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("tenant_id", sa.String(length=80), nullable=False),
        sa.Column("work_item_id", sa.String(length=32), nullable=False),
        sa.Column("author_user_id", sa.String(length=160), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("note_type", sa.String(length=32), nullable=False),
        sa.Column("evidence_ids", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["work_item_id"], ["work_items.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ["tenant_id", "work_item_id", "author_user_id", "note_type", "created_at"]:
        op.create_index(op.f(f"ix_work_item_notes_{column}"), "work_item_notes", [column])


def downgrade() -> None:
    for column in ["created_at", "note_type", "author_user_id", "work_item_id", "tenant_id"]:
        op.drop_index(op.f(f"ix_work_item_notes_{column}"), table_name="work_item_notes")
    op.drop_table("work_item_notes")
    op.drop_index(op.f("ix_work_items_outcome_category"), table_name="work_items")
    op.drop_index(op.f("ix_work_items_priority_status"), table_name="work_items")
    with op.batch_alter_table("work_items") as batch:
        batch.drop_column("rejection_reason")
        batch.drop_column("dismissal_reason")
        batch.drop_column("outcome_category")
        batch.drop_column("description")
        batch.drop_column("priority_status")
