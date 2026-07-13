"""add deliverables templates integration requests

Revision ID: 9c9a23a2f4e8
Revises: 8233aeb6057e
Create Date: 2026-07-13 00:00:00.000000

"""
from typing import Sequence, Union
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision: str = "9c9a23a2f4e8"
down_revision: Union[str, Sequence[str], None] = "8233aeb6057e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DEFAULT_TEMPLATES = [
    ("weekly_memo", "Weekly memo", 10),
    ("meeting_brief", "Meeting brief", 20),
    ("itinerary", "Trip itinerary", 30),
    ("board_deck", "Board deck", 40),
    ("outreach", "Outreach draft", 50),
    ("analysis_annotation", "Analysis annotation", 60),
    ("sales_pitch", "Sales pitch", 70),
    ("capabilities_assessment", "Capabilities assessment", 80),
]


def upgrade() -> None:
    op.create_table(
        "deliverables",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("tenant_id", sa.String(length=80), nullable=False),
        sa.Column("type", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("canonical_account_id", sa.String(length=80), nullable=True),
        sa.Column("program_id", sa.String(length=80), nullable=True),
        sa.Column("trip_id", sa.String(length=80), nullable=True),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_deliverables_tenant_id"), "deliverables", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_deliverables_type"), "deliverables", ["type"], unique=False)
    op.create_index(op.f("ix_deliverables_canonical_account_id"), "deliverables", ["canonical_account_id"], unique=False)
    op.create_index(op.f("ix_deliverables_program_id"), "deliverables", ["program_id"], unique=False)
    op.create_index(op.f("ix_deliverables_trip_id"), "deliverables", ["trip_id"], unique=False)
    op.create_index(op.f("ix_deliverables_created_at"), "deliverables", ["created_at"], unique=False)
    op.create_index(op.f("ix_deliverables_updated_at"), "deliverables", ["updated_at"], unique=False)

    op.create_table(
        "deliverable_templates",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("tenant_id", sa.String(length=80), nullable=False),
        sa.Column("agent_id", sa.String(length=80), nullable=False),
        sa.Column("label", sa.String(length=160), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("prompt_override", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "agent_id", name="uq_deliverable_template_agent"),
    )
    op.create_index(op.f("ix_deliverable_templates_tenant_id"), "deliverable_templates", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_deliverable_templates_agent_id"), "deliverable_templates", ["agent_id"], unique=False)
    op.create_index(op.f("ix_deliverable_templates_enabled"), "deliverable_templates", ["enabled"], unique=False)
    op.create_index(op.f("ix_deliverable_templates_sort_order"), "deliverable_templates", ["sort_order"], unique=False)
    op.create_index(op.f("ix_deliverable_templates_updated_at"), "deliverable_templates", ["updated_at"], unique=False)

    op.create_table(
        "integration_requests",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("tenant_id", sa.String(length=80), nullable=False),
        sa.Column("requester_name", sa.String(length=160), nullable=False),
        sa.Column("integration_name", sa.String(length=160), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_integration_requests_tenant_id"), "integration_requests", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_integration_requests_integration_name"), "integration_requests", ["integration_name"], unique=False)
    op.create_index(op.f("ix_integration_requests_status"), "integration_requests", ["status"], unique=False)
    op.create_index(op.f("ix_integration_requests_created_at"), "integration_requests", ["created_at"], unique=False)
    op.create_index(op.f("ix_integration_requests_updated_at"), "integration_requests", ["updated_at"], unique=False)

    templates = sa.table(
        "deliverable_templates",
        sa.column("id", sa.String),
        sa.column("tenant_id", sa.String),
        sa.column("agent_id", sa.String),
        sa.column("label", sa.String),
        sa.column("enabled", sa.Boolean),
        sa.column("sort_order", sa.Integer),
        sa.column("prompt_override", sa.Text),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    now = datetime.now(timezone.utc)
    op.bulk_insert(
        templates,
        [
            {
                "id": f"seed_{agent_id}",
                "tenant_id": "default",
                "agent_id": agent_id,
                "label": label,
                "enabled": True,
                "sort_order": order,
                "prompt_override": None,
                "updated_at": now,
            }
            for agent_id, label, order in DEFAULT_TEMPLATES
        ],
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_integration_requests_updated_at"), table_name="integration_requests")
    op.drop_index(op.f("ix_integration_requests_created_at"), table_name="integration_requests")
    op.drop_index(op.f("ix_integration_requests_status"), table_name="integration_requests")
    op.drop_index(op.f("ix_integration_requests_integration_name"), table_name="integration_requests")
    op.drop_index(op.f("ix_integration_requests_tenant_id"), table_name="integration_requests")
    op.drop_table("integration_requests")

    op.drop_index(op.f("ix_deliverable_templates_updated_at"), table_name="deliverable_templates")
    op.drop_index(op.f("ix_deliverable_templates_sort_order"), table_name="deliverable_templates")
    op.drop_index(op.f("ix_deliverable_templates_enabled"), table_name="deliverable_templates")
    op.drop_index(op.f("ix_deliverable_templates_agent_id"), table_name="deliverable_templates")
    op.drop_index(op.f("ix_deliverable_templates_tenant_id"), table_name="deliverable_templates")
    op.drop_table("deliverable_templates")

    op.drop_index(op.f("ix_deliverables_updated_at"), table_name="deliverables")
    op.drop_index(op.f("ix_deliverables_created_at"), table_name="deliverables")
    op.drop_index(op.f("ix_deliverables_trip_id"), table_name="deliverables")
    op.drop_index(op.f("ix_deliverables_program_id"), table_name="deliverables")
    op.drop_index(op.f("ix_deliverables_canonical_account_id"), table_name="deliverables")
    op.drop_index(op.f("ix_deliverables_type"), table_name="deliverables")
    op.drop_index(op.f("ix_deliverables_tenant_id"), table_name="deliverables")
    op.drop_table("deliverables")
