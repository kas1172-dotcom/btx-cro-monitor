"""Inbound boundary schemas (Pydantic).

Strict runtime validation of the webhook envelope before anything is processed.
The envelope is intentionally generic for Phase 1; per-connector body schemas
(validated against the connector's mapping) arrive in Phase 3.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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
    company_id: str | None = None
    contact_id: str | None = None
    deal_id: str | None = None
    deliverable_id: str | None = None
    title: str
    body: str | None = None
    evidence: str | None = None
    owner: str | None = None
    due_at: str | None = None


class HubSpotTaskExecuteRequest(BaseModel):
    confirmed: bool
    task_text: str | None = None
    body: str | None = None
    evidence: str | None = None
    relationship_record: dict | None = None
    company_id: str | None = None
    contact_id: str | None = None
    deal_id: str | None = None
    owner_id: str | None = None
    due_at: str | None = None


class HubSpotCompanySearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    limit: int = Field(default=10, ge=1, le=100)


class HubSpotListCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=250)
    list_type: Literal["company", "contact"]


class HubSpotListAddRecordsRequest(BaseModel):
    list_type: Literal["company", "contact"]
    record_ids: list[str] = Field(min_length=1, max_length=1000)


class HubSpotImportRow(BaseModel):
    row_id: str = Field(min_length=1, max_length=120)
    company: dict[str, str] = Field(default_factory=dict)
    contact: dict[str, str] | None = None


class HubSpotImportRequest(BaseModel):
    rows: list[HubSpotImportRow] = Field(min_length=1, max_length=100)


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


DeliverableType = Literal[
    "itinerary",
    "meeting_brief",
    "board_deck",
    "weekly_memo",
    "analysis_view",
    "outreach",
    "sales_pitch",
    "capabilities_assessment",
]
DeliverableConfidence = Literal["low", "medium", "high"]


class DeliverableCreate(BaseModel):
    type: DeliverableType
    title: str = Field(min_length=1)
    canonical_account_id: str | None = None
    program_id: str | None = None
    trip_id: str | None = None
    document: dict

    @model_validator(mode="after")
    def document_matches_summary(self):
        if self.document.get("type") and self.document.get("type") != self.type:
            raise ValueError("document.type must match type")
        if self.document.get("title") and self.document.get("title") != self.title:
            raise ValueError("document.title must match title")
        return self


class DeliverablePatch(BaseModel):
    type: DeliverableType | None = None
    title: str | None = Field(default=None, min_length=1)
    canonical_account_id: str | None = None
    program_id: str | None = None
    trip_id: str | None = None
    document: dict | None = None

    @model_validator(mode="after")
    def document_matches_summary(self):
        if self.document is None:
            return self
        if self.type is not None and self.document.get("type") and self.document.get("type") != self.type:
            raise ValueError("document.type must match type")
        if self.title is not None and self.document.get("title") and self.document.get("title") != self.title:
            raise ValueError("document.title must match title")
        return self


class DeliverableResponse(BaseModel):
    id: str
    type: str
    title: str
    canonical_account_id: str | None = None
    program_id: str | None = None
    trip_id: str | None = None
    document: dict
    created_at: str
    updated_at: str


WorkItemType = Literal[
    "account_action",
    "research_task",
    "customer_question",
    "capacity_check",
    "meeting_brief",
    "outreach_draft",
    "qualified_opportunity",
    "dismissed",
]
WorkItemStatus = Literal["proposed", "approved", "in_progress", "done", "dismissed"]
WorkItemPriority = Literal["low", "normal", "high", "urgent"]
ApprovalState = Literal["not_required", "pending", "approved", "rejected"]
ExecutionState = Literal["not_started", "queued", "running", "completed", "failed"]
WorkItemView = Literal["what_changed", "needs_attention", "prepared", "needs_approval", "outcomes"]


class WorkItemCreate(BaseModel):
    type: WorkItemType
    canonical_account_id: str | None = None
    source_signal_ids: list[str] = []
    owner: str | None = None
    priority: WorkItemPriority = "normal"
    status: WorkItemStatus = "proposed"
    due_date: str | None = None
    recommended_action: str = Field(min_length=1)
    generated_artifact_ref: str | None = None
    approval_state: ApprovalState = "not_required"
    execution_state: ExecutionState = "not_started"
    outcome: str | None = None
    follow_up_date: str | None = None

    @model_validator(mode="after")
    def dismissed_requires_reason(self):
        if (self.type == "dismissed" or self.status == "dismissed") and not (self.outcome or "").strip():
            raise ValueError("dismissed work items require an outcome/reason")
        return self


class WorkItemPatch(BaseModel):
    owner: str | None = None
    priority: WorkItemPriority | None = None
    status: WorkItemStatus | None = None
    due_date: str | None = None
    recommended_action: str | None = None
    generated_artifact_ref: str | None = None
    approval_state: ApprovalState | None = None
    execution_state: ExecutionState | None = None
    outcome: str | None = None
    follow_up_date: str | None = None

    @model_validator(mode="after")
    def dismissed_requires_reason(self):
        if self.status == "dismissed" and not (self.outcome or "").strip():
            raise ValueError("dismissed transitions require outcome/reason; use /dismiss")
        return self


class WorkItemDismiss(BaseModel):
    reason: str = Field(min_length=1)


class WorkItemResponse(BaseModel):
    id: str
    type: str
    canonical_account_id: str | None = None
    source_signal_ids: list[str]
    owner: str | None = None
    priority: str
    status: str
    due_date: str | None = None
    recommended_action: str
    generated_artifact_ref: str | None = None
    approval_state: str
    execution_state: str
    outcome: str | None = None
    follow_up_date: str | None = None
    external_system: str | None = None
    external_record_id: str | None = None
    external_record_url: str | None = None
    execution_idempotency_key: str | None = None
    execution_error: str | None = None
    audit_history: list[dict]
    created_at: str
    updated_at: str
