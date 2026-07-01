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
