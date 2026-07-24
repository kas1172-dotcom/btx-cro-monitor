"""add canonical relationship scores

Revision ID: f4b7c6d8e901
Revises: c3e8f5a2d914
Create Date: 2026-07-24 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f4b7c6d8e901"
down_revision: Union[str, Sequence[str], None] = "c3e8f5a2d914"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("canonical_accounts") as batch:
        batch.add_column(sa.Column("legal_name", sa.String(length=300), nullable=True))
        batch.add_column(sa.Column("display_name", sa.String(length=300), nullable=True))
        batch.add_column(sa.Column("domain", sa.String(length=255), nullable=True))
        batch.add_column(sa.Column("account_type", sa.String(length=40), nullable=True))
        batch.add_column(sa.Column("parent_account_id", sa.String(length=80), nullable=True))
        batch.add_column(sa.Column("public_recipient_ids", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("created_at", sa.DateTime(timezone=True), nullable=True))
        batch.alter_column("hubspot_company_id", existing_type=sa.String(length=80), nullable=True)
    op.create_index(op.f("ix_canonical_accounts_legal_name"), "canonical_accounts", ["legal_name"])
    op.create_index(op.f("ix_canonical_accounts_display_name"), "canonical_accounts", ["display_name"])
    op.create_index(op.f("ix_canonical_accounts_domain"), "canonical_accounts", ["domain"])
    op.create_index(op.f("ix_canonical_accounts_account_type"), "canonical_accounts", ["account_type"])
    op.create_index(op.f("ix_canonical_accounts_parent_account_id"), "canonical_accounts", ["parent_account_id"])
    op.create_index(op.f("ix_canonical_accounts_created_at"), "canonical_accounts", ["created_at"])

    op.create_table(
        "account_identifiers",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("tenant_id", sa.String(length=80), nullable=False),
        sa.Column("canonical_account_id", sa.String(length=80), nullable=False),
        sa.Column("identifier_type", sa.String(length=40), nullable=False),
        sa.Column("normalized_value", sa.String(length=300), nullable=False),
        sa.Column("original_value", sa.String(length=300), nullable=False),
        sa.Column("source_classification", sa.String(length=24), nullable=False),
        sa.Column("verified", sa.Boolean(), nullable=False),
        sa.Column("verified_by_user_id", sa.String(length=160), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["canonical_account_id"], ["canonical_accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "identifier_type", "normalized_value", name="uq_account_identifier_value"),
    )
    op.create_index(op.f("ix_account_identifiers_tenant_id"), "account_identifiers", ["tenant_id"])
    op.create_index(op.f("ix_account_identifiers_canonical_account_id"), "account_identifiers", ["canonical_account_id"])
    op.create_index(op.f("ix_account_identifiers_identifier_type"), "account_identifiers", ["identifier_type"])
    op.create_index(op.f("ix_account_identifiers_normalized_value"), "account_identifiers", ["normalized_value"])
    op.create_index(op.f("ix_account_identifiers_source_classification"), "account_identifiers", ["source_classification"])
    op.create_index(op.f("ix_account_identifiers_verified"), "account_identifiers", ["verified"])
    op.create_index(op.f("ix_account_identifiers_created_at"), "account_identifiers", ["created_at"])
    op.create_index(op.f("ix_account_identifiers_updated_at"), "account_identifiers", ["updated_at"])

    op.create_table(
        "intelligence_signals",
        sa.Column("id", sa.String(length=120), nullable=False),
        sa.Column("tenant_id", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("analysis", sa.Text(), nullable=True),
        sa.Column("scope", sa.String(length=32), nullable=False),
        sa.Column("event_type", sa.String(length=120), nullable=True),
        sa.Column("event_type_status", sa.String(length=32), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source_ids", sa.JSON(), nullable=True),
        sa.Column("evidence_ids", sa.JSON(), nullable=True),
        sa.Column("extraction_confidence", sa.Float(), nullable=True),
        sa.Column("raw_payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "id", name="uq_intelligence_signal_tenant_id"),
    )
    for column in ["tenant_id", "scope", "event_type", "event_type_status", "occurred_at", "published_at", "retrieved_at", "created_at", "updated_at"]:
        op.create_index(op.f(f"ix_intelligence_signals_{column}"), "intelligence_signals", [column])

    op.create_table(
        "signal_account_relationships",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("tenant_id", sa.String(length=80), nullable=False),
        sa.Column("signal_id", sa.String(length=120), nullable=False),
        sa.Column("canonical_account_id", sa.String(length=80), nullable=False),
        sa.Column("source_entity_name", sa.String(length=300), nullable=False),
        sa.Column("match_method", sa.String(length=60), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("review_status", sa.String(length=32), nullable=False),
        sa.Column("creation_source", sa.String(length=32), nullable=False),
        sa.Column("evidence_ids", sa.JSON(), nullable=True),
        sa.Column("confirmed_by_user_id", sa.String(length=160), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_by_user_id", sa.String(length=160), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("last_validated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["canonical_account_id"], ["canonical_accounts.id"]),
        sa.ForeignKeyConstraint(["signal_id"], ["intelligence_signals.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "signal_id", "canonical_account_id", "source_entity_name", name="uq_signal_account_candidate"),
    )
    for column in ["tenant_id", "signal_id", "canonical_account_id", "match_method", "review_status", "creation_source", "last_validated_at", "created_at", "updated_at"]:
        op.create_index(op.f(f"ix_signal_account_relationships_{column}"), "signal_account_relationships", [column])

    op.create_table(
        "relationship_audit_events",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("tenant_id", sa.String(length=80), nullable=False),
        sa.Column("relationship_id", sa.String(length=32), nullable=False),
        sa.Column("action", sa.String(length=60), nullable=False),
        sa.Column("actor_user_id", sa.String(length=160), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("before", sa.JSON(), nullable=True),
        sa.Column("after", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["relationship_id"], ["signal_account_relationships.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ["tenant_id", "relationship_id", "action", "created_at"]:
        op.create_index(op.f(f"ix_relationship_audit_events_{column}"), "relationship_audit_events", [column])

    op.create_table(
        "scoring_config_versions",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("tenant_id", sa.String(length=80), nullable=False),
        sa.Column("version", sa.String(length=40), nullable=False),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("created_by_user_id", sa.String(length=160), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "version", name="uq_scoring_config_version"),
    )
    for column in ["tenant_id", "version", "created_at"]:
        op.create_index(op.f(f"ix_scoring_config_versions_{column}"), "scoring_config_versions", [column])

    op.create_table(
        "score_snapshots",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("tenant_id", sa.String(length=80), nullable=False),
        sa.Column("entity_type", sa.String(length=40), nullable=False),
        sa.Column("entity_id", sa.String(length=120), nullable=False),
        sa.Column("score_family", sa.String(length=60), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("configuration_version", sa.String(length=40), nullable=False),
        sa.Column("source_data_version", sa.String(length=120), nullable=False),
        sa.Column("calculated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ["tenant_id", "entity_type", "entity_id", "score_family", "status", "configuration_version", "source_data_version", "calculated_at"]:
        op.create_index(op.f(f"ix_score_snapshots_{column}"), "score_snapshots", [column])

    with op.batch_alter_table("work_items") as batch:
        batch.add_column(sa.Column("related_signal_id", sa.String(length=120), nullable=True))
        batch.add_column(sa.Column("related_relationship_id", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("related_opportunity_id", sa.String(length=120), nullable=True))
        batch.add_column(sa.Column("program_id", sa.String(length=120), nullable=True))
        batch.add_column(sa.Column("score_snapshot_ids", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("supporting_evidence", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("missing_information", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("dedupe_key", sa.String(length=256), nullable=True))
    for column in ["related_signal_id", "related_relationship_id", "related_opportunity_id", "program_id", "dedupe_key"]:
        op.create_index(op.f(f"ix_work_items_{column}"), "work_items", [column])


def downgrade() -> None:
    for column in ["related_signal_id", "related_relationship_id", "related_opportunity_id", "program_id", "dedupe_key"]:
        op.drop_index(op.f(f"ix_work_items_{column}"), table_name="work_items")
    with op.batch_alter_table("work_items") as batch:
        batch.drop_column("dedupe_key")
        batch.drop_column("missing_information")
        batch.drop_column("supporting_evidence")
        batch.drop_column("score_snapshot_ids")
        batch.drop_column("program_id")
        batch.drop_column("related_opportunity_id")
        batch.drop_column("related_relationship_id")
        batch.drop_column("related_signal_id")

    op.drop_table("score_snapshots")
    op.drop_table("scoring_config_versions")
    op.drop_table("relationship_audit_events")
    op.drop_table("signal_account_relationships")
    op.drop_table("intelligence_signals")
    op.drop_table("account_identifiers")

    for column in ["created_at", "parent_account_id", "account_type", "domain", "display_name", "legal_name"]:
        op.drop_index(op.f(f"ix_canonical_accounts_{column}"), table_name="canonical_accounts")
    with op.batch_alter_table("canonical_accounts") as batch:
        batch.alter_column("hubspot_company_id", existing_type=sa.String(length=80), nullable=False)
        batch.drop_column("created_at")
        batch.drop_column("public_recipient_ids")
        batch.drop_column("parent_account_id")
        batch.drop_column("account_type")
        batch.drop_column("domain")
        batch.drop_column("display_name")
        batch.drop_column("legal_name")
