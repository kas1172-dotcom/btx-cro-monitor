"""The database log of record.

Every inbound payload is persisted (``Event``) before we ack, with an
idempotency guard against duplicates, a per-attempt outbound audit trail, and a
dead-letter table for poison jobs. Forwarding columns/tables are defined now so
the Phase 2 worker has its schema ready.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    JSON,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from btx_platform.db import Base

# Single-tenant today; every tenant-scoped row carries this so multi-tenant
# is a config change (real org ids from Clerk) rather than a schema change.
DEFAULT_TENANT_ID = "default"


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


# Event lifecycle states.
STATUS_RECEIVED = "received"
STATUS_PROCESSING = "processing"
STATUS_DONE = "done"
STATUS_FAILED = "failed"
STATUS_DEAD = "dead"


class Connection(Base):
    """A configured integration endpoint (an inbound source or outbound target).
    ``signing_secret`` verifies inbound webhooks (encrypt at rest in prod)."""
    __tablename__ = "connections"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(80), default=DEFAULT_TENANT_ID, index=True)
    name: Mapped[str] = mapped_column(String(200))
    direction: Mapped[str] = mapped_column(String(16), default="inbound")  # inbound|outbound
    signing_secret: Mapped[str | None] = mapped_column(String(256), nullable=True)
    destination_url: Mapped[str | None] = mapped_column(Text, nullable=True)  # outbound|forward target
    active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Event(Base):
    """Every raw inbound payload + its processing status (the audit core)."""
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    connection_id: Mapped[str] = mapped_column(String(64), ForeignKey("connections.id"), index=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(256), nullable=True)
    event_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    raw_body: Mapped[str] = mapped_column(Text)               # exact bytes received (as text)
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # parsed envelope
    status: Mapped[str] = mapped_column(String(16), default=STATUS_RECEIVED, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class IdempotencyKey(Base):
    """Dedupe guard: a key is claimed once. Unique PK makes a duplicate insert
    fail fast, so concurrent retries of the same delivery can't double-process."""
    __tablename__ = "idempotency_keys"

    key: Mapped[str] = mapped_column(String(256), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(32), ForeignKey("events.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class OutboundLog(Base):
    """One row per forward attempt to a destination (Phase 2)."""
    __tablename__ = "outbound_log"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    event_id: Mapped[str] = mapped_column(String(32), ForeignKey("events.id"), index=True)
    attempt_no: Mapped[int] = mapped_column(Integer)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DeadLetter(Base):
    """Poison jobs isolated after max attempts (Phase 2), kept for replay."""
    __tablename__ = "dead_letters"
    __table_args__ = (UniqueConstraint("event_id", name="uq_dead_event"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    event_id: Mapped[str] = mapped_column(String(32), ForeignKey("events.id"))
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    moved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    replayed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EngineConfig(Base):
    """Versioned JSON configuration edited from the frontend."""
    __tablename__ = "engine_configs"
    __table_args__ = (UniqueConstraint("tenant_id", "name", "version", name="uq_engine_config_version"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(80), default=DEFAULT_TENANT_ID, index=True)
    name: Mapped[str] = mapped_column(String(64), index=True)
    version: Mapped[int] = mapped_column(Integer)
    document: Mapped[dict] = mapped_column(JSON)
    change_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class CanonicalAccount(Base):
    """Stable tenant-scoped account identity.

    HubSpot company ids and public identifiers live as identifiers. They can
    point to a canonical account, but they are not the account's identity.
    """
    __tablename__ = "canonical_accounts"
    __table_args__ = (UniqueConstraint("tenant_id", "hubspot_company_id", name="uq_canonical_hubspot_company"),)

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(80), default=DEFAULT_TENANT_ID, index=True)
    legal_name: Mapped[str] = mapped_column(String(300), default="", index=True)
    display_name: Mapped[str] = mapped_column(String(300), default="", index=True)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    account_type: Mapped[str] = mapped_column(String(40), default="other", index=True)
    hubspot_company_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    domains: Mapped[list | None] = mapped_column(JSON, nullable=True)
    aliases: Mapped[list | None] = mapped_column(JSON, nullable=True)
    facility_names: Mapped[list | None] = mapped_column(JSON, nullable=True)
    parent_account_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    parent_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    subsidiary_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    cage_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    uei: Mapped[str | None] = mapped_column(String(32), nullable=True)
    public_recipient_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    known_programs: Mapped[list | None] = mapped_column(JSON, nullable=True)
    known_customers: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class AccountIdentifier(Base):
    """Tenant-aware external identifier attached to one canonical account."""
    __tablename__ = "account_identifiers"
    __table_args__ = (
        UniqueConstraint("tenant_id", "identifier_type", "normalized_value", name="uq_account_identifier_value"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(80), default=DEFAULT_TENANT_ID, index=True)
    canonical_account_id: Mapped[str] = mapped_column(String(80), ForeignKey("canonical_accounts.id"), index=True)
    identifier_type: Mapped[str] = mapped_column(String(40), index=True)
    normalized_value: Mapped[str] = mapped_column(String(300), index=True)
    original_value: Mapped[str] = mapped_column(String(300))
    source_classification: Mapped[str] = mapped_column(String(24), index=True)
    verified: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    verified_by_user_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, index=True)


class IntelligenceSignal(Base):
    """Durable normalized external signal with provenance preserved."""
    __tablename__ = "intelligence_signals"
    __table_args__ = (UniqueConstraint("tenant_id", "id", name="uq_intelligence_signal_tenant_id"),)

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(80), default=DEFAULT_TENANT_ID, index=True)
    title: Mapped[str] = mapped_column(String(500))
    summary: Mapped[str] = mapped_column(Text)
    analysis: Mapped[str | None] = mapped_column(Text, nullable=True)
    scope: Mapped[str] = mapped_column(String(32), default="market", index=True)
    event_type: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    event_type_status: Mapped[str] = mapped_column(String(32), default="unknown", index=True)
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    source_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    evidence_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    extraction_confidence: Mapped[float | None] = mapped_column(nullable=True)
    raw_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, index=True)


class SignalAccountRelationship(Base):
    """Durable candidate or confirmed relationship between a signal and account."""
    __tablename__ = "signal_account_relationships"
    __table_args__ = (
        UniqueConstraint("tenant_id", "signal_id", "canonical_account_id", "source_entity_name", name="uq_signal_account_candidate"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(80), default=DEFAULT_TENANT_ID, index=True)
    signal_id: Mapped[str] = mapped_column(String(120), ForeignKey("intelligence_signals.id"), index=True)
    canonical_account_id: Mapped[str] = mapped_column(String(80), ForeignKey("canonical_accounts.id"), index=True)
    source_entity_name: Mapped[str] = mapped_column(String(300))
    match_method: Mapped[str] = mapped_column(String(60), index=True)
    confidence: Mapped[float] = mapped_column(default=0.0)
    review_status: Mapped[str] = mapped_column(String(32), default="needs_review", index=True)
    creation_source: Mapped[str] = mapped_column(String(32), default="derived", index=True)
    evidence_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    confirmed_by_user_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_by_user_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_validated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, index=True)


class RelationshipAuditEvent(Base):
    __tablename__ = "relationship_audit_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(80), default=DEFAULT_TENANT_ID, index=True)
    relationship_id: Mapped[str] = mapped_column(String(32), ForeignKey("signal_account_relationships.id"), index=True)
    action: Mapped[str] = mapped_column(String(60), index=True)
    actor_user_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class ScoringConfigVersion(Base):
    __tablename__ = "scoring_config_versions"
    __table_args__ = (UniqueConstraint("tenant_id", "version", name="uq_scoring_config_version"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(80), default=DEFAULT_TENANT_ID, index=True)
    version: Mapped[str] = mapped_column(String(40), index=True)
    document: Mapped[dict] = mapped_column(JSON)
    created_by_user_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class ScoreSnapshot(Base):
    __tablename__ = "score_snapshots"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(80), default=DEFAULT_TENANT_ID, index=True)
    entity_type: Mapped[str] = mapped_column(String(40), index=True)
    entity_id: Mapped[str] = mapped_column(String(120), index=True)
    score_family: Mapped[str] = mapped_column(String(60), index=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    score: Mapped[float | None] = mapped_column(nullable=True)
    result: Mapped[dict] = mapped_column(JSON)
    configuration_version: Mapped[str] = mapped_column(String(40), index=True)
    source_data_version: Mapped[str] = mapped_column(String(120), index=True)
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class PipelineRun(Base):
    """Audit row for a manually triggered monitor-engine pipeline run."""
    __tablename__ = "pipeline_runs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(80), default=DEFAULT_TENANT_ID, index=True)
    triggered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    mechanism: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    item_counts: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    config_path: Mapped[str | None] = mapped_column(Text, nullable=True)


class Deliverable(Base):
    """Saved cockpit deliverable document."""
    __tablename__ = "deliverables"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(80), default=DEFAULT_TENANT_ID, index=True)
    type: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(300))
    canonical_account_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    program_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    trip_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    entity_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    document: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, index=True)


class WorkItem(Base):
    """Durable server-backed work loop item for cockpit action surfaces."""
    __tablename__ = "work_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(80), default=DEFAULT_TENANT_ID, index=True)
    type: Mapped[str] = mapped_column(String(40), index=True)
    canonical_account_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    related_signal_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    related_relationship_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    related_opportunity_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    program_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    score_snapshot_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    source_signal_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    supporting_evidence: Mapped[list | None] = mapped_column(JSON, nullable=True)
    missing_information: Mapped[list | None] = mapped_column(JSON, nullable=True)
    dedupe_key: Mapped[str | None] = mapped_column(String(256), nullable=True, index=True)
    owner: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    priority: Mapped[str] = mapped_column(String(32), default="normal", index=True)
    priority_status: Mapped[str] = mapped_column(String(32), default="available", index=True)
    status: Mapped[str] = mapped_column(String(32), default="detected", index=True)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    recommended_action: Mapped[str] = mapped_column(Text)
    generated_artifact_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    approval_state: Mapped[str] = mapped_column(String(32), default="not_required", index=True)
    execution_state: Mapped[str] = mapped_column(String(32), default="not_started", index=True)
    outcome: Mapped[str | None] = mapped_column(Text, nullable=True)
    outcome_category: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    dismissal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    follow_up_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    external_system: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    external_record_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    external_record_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    execution_idempotency_key: Mapped[str | None] = mapped_column(String(256), nullable=True, index=True)
    execution_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    audit_history: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, index=True)


class WorkItemNote(Base):
    """Durable note/finding trail attached to a work item."""
    __tablename__ = "work_item_notes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(80), default=DEFAULT_TENANT_ID, index=True)
    work_item_id: Mapped[str] = mapped_column(String(32), ForeignKey("work_items.id"), index=True)
    author_user_id: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    body: Mapped[str] = mapped_column(Text)
    note_type: Mapped[str] = mapped_column(String(32), default="general", index=True)
    evidence_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class HubSpotTaskAudit(Base):
    """Durable audit trail for task writes made from the cockpit."""
    __tablename__ = "hubspot_task_audits"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(80), default=DEFAULT_TENANT_ID, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    subject: Mapped[str] = mapped_column(String(300))
    hubspot_task_id: Mapped[str] = mapped_column(String(80), index=True)
    record_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(256), nullable=True, index=True)
    associations: Mapped[dict | None] = mapped_column(JSON, nullable=True)
