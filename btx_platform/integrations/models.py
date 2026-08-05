"""Versioned canonical models crossing optional integration boundaries."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class CanonicalModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    schema_version: Literal["1.0"] = "1.0"


class RequestContext(CanonicalModel):
    tenant_id: str = Field(min_length=1)
    actor_user_id: str = Field(min_length=1)
    correlation_id: str = Field(min_length=1)


class ApprovedWorkItemExecution(CanonicalModel):
    tenant_id: str = Field(min_length=1)
    actor_user_id: str = Field(min_length=1)
    work_item_id: str = Field(min_length=1)
    idempotency_key: str = Field(min_length=1, max_length=256)


class ExternalReference(CanonicalModel):
    system: Literal["paperless_parts", "erp_mes"]
    reference_id: str = Field(min_length=1)
    idempotency_key: str = Field(min_length=1, max_length=256)
    status: Literal["recorded", "submitted", "accepted"]


class CanonicalContact(CanonicalModel):
    contact_id: str = Field(min_length=1)
    account_id: str = Field(min_length=1)
    full_name: str = Field(min_length=1)
    given_name: str | None = None
    family_name: str | None = None
    job_title: str | None = None
    department: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    source_reference: str | None = None
    observed_at: datetime
    confidence: float = Field(ge=0, le=1)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("email must contain a local and domain part")
        return normalized

    @model_validator(mode="after")
    def validate_contact(self) -> "CanonicalContact":
        if not any((self.email, self.phone, self.job_title)):
            raise ValueError("contact requires an email, phone, or job title")
        _require_aware(self.observed_at, "observed_at")
        return self


IntelligenceClassification = Literal[
    "fact", "inference", "unconfirmed_relationship", "missing_information"
]


class RelationshipObservation(CanonicalModel):
    subject: str = Field(min_length=1)
    relationship: str = Field(min_length=1)
    object: str = Field(min_length=1)
    classification: IntelligenceClassification
    confidence: float = Field(ge=0, le=1)
    evidence_refs: list[str] = Field(default_factory=list)

    @field_validator("evidence_refs")
    @classmethod
    def unique_evidence(cls, value: list[str]) -> list[str]:
        return _deduplicate(value)


class IntelligenceObservation(CanonicalModel):
    observation_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    classification: IntelligenceClassification
    confidence: float = Field(ge=0, le=1)
    occurred_at: datetime | None = None
    evidence_refs: list[str] = Field(default_factory=list)

    @field_validator("occurred_at")
    @classmethod
    def aware_occurred_at(cls, value: datetime | None) -> datetime | None:
        if value is not None:
            _require_aware(value, "occurred_at")
        return value

    @field_validator("evidence_refs")
    @classmethod
    def unique_evidence(cls, value: list[str]) -> list[str]:
        return _deduplicate(value)


class AccountIntelligence(CanonicalModel):
    account_id: str = Field(min_length=1)
    relationships: list[RelationshipObservation] = Field(default_factory=list)
    observations: list[IntelligenceObservation] = Field(default_factory=list)
    retrieved_at: datetime
    source_references: list[str] = Field(default_factory=list)

    @field_validator("retrieved_at")
    @classmethod
    def aware_retrieved_at(cls, value: datetime) -> datetime:
        _require_aware(value, "retrieved_at")
        return value

    @field_validator("source_references")
    @classmethod
    def unique_sources(cls, value: list[str]) -> list[str]:
        return _deduplicate(value)


class QuoteLine(CanonicalModel):
    line_id: str = Field(min_length=1)
    description: str = Field(min_length=1)
    quantity: Decimal = Field(gt=0)
    unit_of_measure: str = Field(min_length=1)
    unit_price: Decimal = Field(ge=0)
    part_reference: str | None = None
    requested_delivery_date: date | None = None


class CanonicalQuote(CanonicalModel):
    quote_id: str = Field(min_length=1)
    account_id: str = Field(min_length=1)
    opportunity_id: str | None = None
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    lines: list[QuoteLine] = Field(min_length=1)
    valid_until: date | None = None
    notes: str | None = None
    created_at: datetime

    @model_validator(mode="after")
    def validate_quote(self) -> "CanonicalQuote":
        _require_aware(self.created_at, "created_at")
        _require_unique([line.line_id for line in self.lines], "quote line_id")
        if self.valid_until is not None and self.valid_until < self.created_at.date():
            raise ValueError("valid_until cannot precede created_at")
        return self


class OrderLine(CanonicalModel):
    line_id: str = Field(min_length=1)
    description: str = Field(min_length=1)
    quantity: Decimal = Field(gt=0)
    unit_of_measure: str = Field(min_length=1)
    part_reference: str | None = None
    required_by: date | None = None


class CanonicalOrder(CanonicalModel):
    order_id: str = Field(min_length=1)
    account_id: str = Field(min_length=1)
    quote_id: str | None = None
    facility_id: str | None = None
    lines: list[OrderLine] = Field(min_length=1)
    requested_at: datetime
    notes: str | None = None

    @model_validator(mode="after")
    def validate_order(self) -> "CanonicalOrder":
        _require_aware(self.requested_at, "requested_at")
        _require_unique([line.line_id for line in self.lines], "order line_id")
        if any(line.required_by is not None and line.required_by < self.requested_at.date() for line in self.lines):
            raise ValueError("required_by cannot precede requested_at")
        return self


CapacityStatus = Literal["available", "constrained", "unavailable", "unknown"]


class CapacityWindow(CanonicalModel):
    facility_id: str = Field(min_length=1)
    capability: str = Field(min_length=1)
    starts_on: date
    ends_on: date
    available_quantity: Decimal = Field(ge=0)
    unit_of_measure: str = Field(min_length=1)
    status: CapacityStatus

    @model_validator(mode="after")
    def validate_window(self) -> "CapacityWindow":
        if self.ends_on < self.starts_on:
            raise ValueError("ends_on cannot precede starts_on")
        return self


class CapacitySnapshot(CanonicalModel):
    snapshot_id: str = Field(min_length=1)
    observed_at: datetime
    windows: list[CapacityWindow] = Field(default_factory=list)
    source_references: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_snapshot(self) -> "CapacitySnapshot":
        _require_aware(self.observed_at, "observed_at")
        keys = [(w.facility_id, w.capability, w.starts_on, w.ends_on) for w in self.windows]
        _require_unique(keys, "capacity window")
        self.source_references = _deduplicate(self.source_references)
        return self


def _require_aware(value: datetime, field: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field} must be timezone-aware")


def _require_unique(values: list[object], field: str) -> None:
    if len(values) != len(set(values)):
        raise ValueError(f"{field} values must be unique")


def _deduplicate(values: list[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))
