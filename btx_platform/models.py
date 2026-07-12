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
    """Stable account identity derived from HubSpot company records.

    The HubSpot company id is the source-of-truth join key; enrichment columns
    are optional because most portals will not have BTX custom properties yet.
    """
    __tablename__ = "canonical_accounts"
    __table_args__ = (UniqueConstraint("tenant_id", "hubspot_company_id", name="uq_canonical_hubspot_company"),)

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(80), default=DEFAULT_TENANT_ID, index=True)
    hubspot_company_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    domains: Mapped[list | None] = mapped_column(JSON, nullable=True)
    aliases: Mapped[list | None] = mapped_column(JSON, nullable=True)
    facility_names: Mapped[list | None] = mapped_column(JSON, nullable=True)
    parent_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    subsidiary_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    cage_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    uei: Mapped[str | None] = mapped_column(String(32), nullable=True)
    known_programs: Mapped[list | None] = mapped_column(JSON, nullable=True)
    known_customers: Mapped[list | None] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


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


class WorkItem(Base):
    """Durable server-backed work loop item for cockpit action surfaces."""
    __tablename__ = "work_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(80), default=DEFAULT_TENANT_ID, index=True)
    type: Mapped[str] = mapped_column(String(40), index=True)
    canonical_account_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    source_signal_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    owner: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    priority: Mapped[str] = mapped_column(String(32), default="normal", index=True)
    status: Mapped[str] = mapped_column(String(32), default="proposed", index=True)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    recommended_action: Mapped[str] = mapped_column(Text)
    generated_artifact_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    approval_state: Mapped[str] = mapped_column(String(32), default="not_required", index=True)
    execution_state: Mapped[str] = mapped_column(String(32), default="not_started", index=True)
    outcome: Mapped[str | None] = mapped_column(Text, nullable=True)
    follow_up_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    external_system: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    external_record_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    external_record_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    execution_idempotency_key: Mapped[str | None] = mapped_column(String(256), nullable=True, index=True)
    execution_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    audit_history: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, index=True)


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
