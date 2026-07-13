"""add deliverables

Revision ID: 9c5b1fbd2e4a
Revises: 8233aeb6057e
Create Date: 2026-07-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9c5b1fbd2e4a"
down_revision: Union[str, Sequence[str], None] = "8233aeb6057e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "deliverables",
        sa.Column("id", sa.String(length=120), nullable=False),
        sa.Column("tenant_id", sa.String(length=80), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("canonical_account_id", sa.String(length=80), nullable=True),
        sa.Column("entity_ids", sa.JSON(), nullable=True),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_deliverables_canonical_account_id"), "deliverables", ["canonical_account_id"], unique=False)
    op.create_index(op.f("ix_deliverables_created_at"), "deliverables", ["created_at"], unique=False)
    op.create_index(op.f("ix_deliverables_tenant_id"), "deliverables", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_deliverables_type"), "deliverables", ["type"], unique=False)
    op.create_index(op.f("ix_deliverables_updated_at"), "deliverables", ["updated_at"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_deliverables_updated_at"), table_name="deliverables")
    op.drop_index(op.f("ix_deliverables_type"), table_name="deliverables")
    op.drop_index(op.f("ix_deliverables_tenant_id"), table_name="deliverables")
    op.drop_index(op.f("ix_deliverables_created_at"), table_name="deliverables")
    op.drop_index(op.f("ix_deliverables_canonical_account_id"), table_name="deliverables")
    op.drop_table("deliverables")
