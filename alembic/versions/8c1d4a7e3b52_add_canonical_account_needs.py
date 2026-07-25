"""Add canonical_accounts.needs

The attractiveness scorer reads account needs for its capability-alignment
factor, which carries the heaviest weight in the family. The column was never
created, so getattr(account, "needs", None) returned None for every account in
every tenant and that factor could never contribute.

Revision ID: 8c1d4a7e3b52
Revises: 7b6aa9f4d2c1
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "8c1d4a7e3b52"
down_revision: Union[str, Sequence[str], None] = "7b6aa9f4d2c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("canonical_accounts", sa.Column("needs", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("canonical_accounts", "needs")
