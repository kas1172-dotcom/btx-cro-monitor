"""Inbound boundary schemas (Pydantic).

Strict runtime validation of the webhook envelope before anything is processed.
The envelope is intentionally generic for Phase 1; per-connector body schemas
(validated against the connector's mapping) arrive in Phase 3.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


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


class LlmMessage(BaseModel):
    role: str
    content: str


class LlmProxyRequest(BaseModel):
    model: str | None = None
    system: str
    messages: list[LlmMessage]


class LlmProxyResponse(BaseModel):
    text: str


class IntegrationError(BaseModel):
    code: str
    detail: str


class CrmTaskRequest(BaseModel):
    account_id: str | None = None
    title: str
    evidence: str | None = None
    owner: str | None = None


class EmailSendRequest(BaseModel):
    to: str
    subject: str
    body: str


class CalendarEventRequest(BaseModel):
    title: str
    starts_at: str
    ends_at: str
    attendees: list[str] = []


class WeightRow(BaseModel):
    risk: int | float | None = None
    opportunity: int | float | None = None
    capacityRisk: int | float | None = None
    competitivePressure: int | float | None = None


class LensRule(BaseModel):
    relationship: str
    source: str
    target: str
    factor: float


class ScoringWeightsDocument(BaseModel):
    version: str
    min_confidence: float = Field(ge=0, le=1)
    dimension_cap: int | float = Field(gt=0)
    repeat_decay: float = Field(ge=0, le=1)
    weights: dict[str, WeightRow]
    alert_thresholds: dict[str, int | float]
    categories: dict[str, str]
    lens_rules: list[LensRule]


class SourceRegistryItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=1)
    type: Literal["rss", "json_api", "html_list"]
    name: str = Field(min_length=1)
    url: str = Field(min_length=1)
    enabled: bool = True
    notes: str = ""
    config: dict | None = None


class SourceRegistryDocument(BaseModel):
    sources: list[SourceRegistryItem]

    @field_validator("sources")
    @classmethod
    def unique_source_ids(cls, value: list[SourceRegistryItem]) -> list[SourceRegistryItem]:
        ids = [item.id for item in value]
        if len(ids) != len(set(ids)):
            raise ValueError("source ids must be unique")
        return value


class ClientProfileDocument(BaseModel):
    model_config = ConfigDict(extra="allow")

    capabilities: list[str] = []
    certifications: list[str] = []
    industries_served: list[str] = []
    customer_types: list[str] = []
    geographic_focus: list[str] = []
    strategic_goals: list[str] = []
    risks: list[str] = []
    named_entities: dict = {}


class EngineConfigPut(BaseModel):
    document: dict
    change_note: str | None = Field(default=None, max_length=500)


class EngineConfigResponse(BaseModel):
    name: str
    version: int
    document: dict
    change_note: str | None = None
    updated_at: str


class PipelineRunResponse(BaseModel):
    id: str
    triggered_at: str
    mechanism: str
    status: str
    completed_at: str | None = None
    item_counts: dict | None = None
    detail: str | None = None
    config_path: str | None = None
