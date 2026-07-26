"""add tenant demonstration metadata

Revision ID: 4e12db9a6c10
Revises: 9f2b1c7d4e65
Create Date: 2026-07-25 12:00:00.000000

"""
from datetime import UTC, datetime
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
    # Insert through SQLAlchemy rather than raw SQL. The literal 1 for
    # is_demonstration is accepted by SQLite but rejected by Postgres, which
    # will not coerce integer to boolean, so the raw form failed on deploy while
    # passing every SQLite-backed test.
    now = datetime.now(UTC).replace(tzinfo=None)
    op.bulk_insert(
        sa.table(
            "tenants",
            sa.column("id", sa.String()),
            sa.column("display_name", sa.String()),
            sa.column("is_demonstration", sa.Boolean()),
            sa.column("demo_reference_date", sa.DateTime()),
            sa.column("demo_metadata", sa.JSON()),
            sa.column("created_at", sa.DateTime()),
            sa.column("updated_at", sa.DateTime()),
        ),
        [{
            "id": "btx-demo-command-cockpit",
            "display_name": "BTX Demonstration Workspace",
            "is_demonstration": True,
            "demo_reference_date": None,
            "demo_metadata": {},
            "created_at": now,
            "updated_at": now,
        }],
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_tenants_updated_at"), table_name="tenants")
    op.drop_index(op.f("ix_tenants_created_at"), table_name="tenants")
    op.drop_index(op.f("ix_tenants_is_demonstration"), table_name="tenants")
    op.drop_table("tenants")
