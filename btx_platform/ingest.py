"""Inbound ingest service — the heart of the webhook receiver.

Pure of HTTP so it is unit-testable directly: given a DB session, a queue, the
connection, and the raw request, it verifies → validates → dedupes → persists
the raw payload → enqueues, and reports the outcome. The FastAPI route is a thin
wrapper that maps :class:`IngestError` to status codes.

Ordering matters for the fast-ack guarantee: nothing here calls the destination
API. We persist + enqueue, then the route returns 200.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from btx_platform import models
from btx_platform.queue import JobQueue
from btx_platform.schemas import WebhookEnvelope
from btx_platform.security import verify_signature


class IngestError(Exception):
    """A client-facing ingest failure carrying an HTTP status + detail."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass
class IngestOutcome:
    event_id: str
    status: str
    duplicate: bool


def resolve_idempotency_key(env: WebhookEnvelope, header_key: str | None) -> str | None:
    """Precedence: explicit header → envelope.idempotency_key → external_id."""
    return header_key or env.idempotency_key or env.external_id


def ingest(
    session: Session,
    queue: JobQueue,
    connection: models.Connection,
    *,
    raw_body: bytes,
    signature: str | None,
    idempotency_header: str | None = None,
) -> IngestOutcome:
    if not connection.active:
        raise IngestError(403, "connection is disabled")

    # 1. Authenticate over the raw bytes, before any parsing.
    if connection.signing_secret:
        if not verify_signature(connection.signing_secret, raw_body, signature):
            raise IngestError(401, "invalid or missing signature")

    # 2. Parse + strictly validate the envelope.
    try:
        data = json.loads(raw_body)
    except (ValueError, UnicodeDecodeError):
        raise IngestError(400, "body is not valid JSON")
    try:
        env = WebhookEnvelope.model_validate(data)
    except ValidationError as exc:
        raise IngestError(422, f"payload failed validation: {exc.errors()}")

    # 3. Idempotency fast-path: a key we've already claimed → no-op, report dupe.
    key = resolve_idempotency_key(env, idempotency_header)
    if key:
        existing = session.get(models.IdempotencyKey, key)
        if existing is not None:
            return IngestOutcome(existing.event_id, models.STATUS_RECEIVED, True)

    # 4. Persist the raw payload + claim the idempotency key in one transaction.
    event = models.Event(
        connection_id=connection.id,
        idempotency_key=key,
        event_type=env.event_type,
        raw_body=raw_body.decode("utf-8", "replace"),
        payload=env.model_dump(),
        status=models.STATUS_RECEIVED,
    )
    session.add(event)
    session.flush()  # assigns event.id
    if key:
        session.add(models.IdempotencyKey(key=key, event_id=event.id))
    try:
        session.commit()
    except IntegrityError:
        # Concurrent delivery claimed the same key first → treat as duplicate.
        session.rollback()
        if key:
            existing = session.get(models.IdempotencyKey, key)
            if existing is not None:
                return IngestOutcome(existing.event_id, models.STATUS_RECEIVED, True)
        raise IngestError(409, "conflict persisting event")

    # 5. Hand off to the background worker (no destination call on this path).
    queue.enqueue_forward(event.id)
    return IngestOutcome(event.id, models.STATUS_RECEIVED, False)
