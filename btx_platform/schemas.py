"""Inbound boundary schemas (Pydantic).

Strict runtime validation of the webhook envelope before anything is processed.
The envelope is intentionally generic for Phase 1; per-connector body schemas
(validated against the connector's mapping) arrive in Phase 3.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class WebhookEnvelope(BaseModel):
    """The common shape every inbound delivery must carry.

    extra fields are rejected so malformed/unexpected payloads fail fast (422)
    rather than being silently stored and forwarded.
    """
    model_config = ConfigDict(extra="forbid")

    event_type: str = Field(min_length=1, max_length=120)
    data: dict = Field(description="the source record/payload to forward")
    external_id: str | None = Field(
        default=None, max_length=256,
        description="stable id from the source; used for idempotency/dedupe",
    )
    idempotency_key: str | None = Field(default=None, max_length=256)


class IngestAccepted(BaseModel):
    """Response body for an accepted (or duplicate) delivery."""
    event_id: str
    status: str
    duplicate: bool = False
