"""add tenant demonstration metadata

Revision ID: 4e12db9a6c10
Revises: 9f2b1c7d4e65
Create Date: 2026-07-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "4e12db9a6c10"
down_revision: Union[str, Sequence[str], None] = "9f2b1c7d4e65"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenants",
        sa.Column("id", sa.String(length=80), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("is_demonstration", sa.Boolean(), nullable=False),
        sa.Column("demo_reference_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("demo_metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_tenants_is_demonstration"), "tenants", ["is_demonstration"])
    op.create_index(op.f("ix_tenants_created_at"), "tenants", ["created_at"])
    op.create_index(op.f("ix_tenants_updated_at"), "tenants", ["updated_at"])
    op.execute(
        """
        INSERT INTO tenants (id, display_name, is_demonstration, demo_reference_date, demo_metadata, created_at, updated_at)
        VALUES (
            'btx-demo-command-cockpit',
            'BTX Demonstration Workspace',
            1,
            NULL,
            '{}',
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        )
        """
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_tenants_updated_at"), table_name="tenants")
    op.drop_index(op.f("ix_tenants_created_at"), table_name="tenants")
    op.drop_index(op.f("ix_tenants_is_demonstration"), table_name="tenants")
    op.drop_table("tenants")
