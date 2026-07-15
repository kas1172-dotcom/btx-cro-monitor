"""add entity_ids to deliverables

Revision ID: c3e8f5a2d914
Revises: a9a010e2152e
Create Date: 2026-07-15 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3e8f5a2d914'
down_revision: Union[str, Sequence[str], None] = 'a9a010e2152e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('deliverables', sa.Column('entity_ids', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('deliverables', 'entity_ids')
