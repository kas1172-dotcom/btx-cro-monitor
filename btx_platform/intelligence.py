"""Canonical account identity, signal relationships, and deterministic scores."""
from __future__ import annotations

import hashlib
import math
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from btx_platform import models

MINIMUM_RELATIONSHIP_CONFIDENCE = 0.80
SCORING_CONFIG_VERSION = "2026-07-24.1"
SOURCE_DATA_VERSION_PREFIX = "world-snapshot"

BTX_CAPABILITIES = {
    "precision machining",
    "5-axis cnc",
    "5-axis machining",
    "machining",
    "itar",
    "as9100",
    "build-to-print",
    "turning",
    "milling",
}

ACCOUNT_ATTRACTIVENESS_WEIGHTS = {
    "capability_alignment": 0.25,
    "addressable_work_package": 0.20,
    "program_award_momentum": 0.15,
    "repeat_production": 0.15,
    "strategic_relevance": 0.10,
    "supply_chain_accessibility": 0.10,
    "geographic_relevance": 0.05,
}

SIGNAL_CONFIDENCE_WEIGHTS = {
    "entity_match": 0.30,
    "source_authority": 0.20,
    "specificity": 0.20,
    "independent_corroboration": 0.10,
    "recency": 0.10,
    "novelty": 0.10,
}

PWIN_WEIGHTS = {
    "technical_fit": 0.15,
    "customer_access": 0.15,
    "competitive_position": 0.15,
    "past_performance": 0.10,
    "differentiation": 0.10,
    "requirements_maturity": 0.10,
    "pricing_credibility": 0.10,
    "compliance_readiness": 0.10,
    "capture_readiness": 0.05,
}

DELIVERY_WEIGHTS = {
    "machine_labor_capacity": 0.25,
    "schedule_feasibility": 0.20,
    "material_supplier_readiness": 0.15,
    "quality_certification_readiness": 0.15,
    "expected_gross_margin": 0.15,
    "execution_complexity": 0.10,
}

RELATIONSHIP_HEALTH_WEIGHTS = {
    "executive_relationship": 0.20,
    "functional_coverage": 0.20,
    "customer_sentiment": 0.15,
    "interaction_quality": 0.15,
    "champion_strength": 0.10,
    "historical_delivery": 0.10,
    "multi_threading": 0.10,
}

ACTION_PRIORITY_WEIGHTS = {
    "expected_gross_profit": 0.25,
    "pursuit_pwin": 0.25,
    "delivery_feasibility": 0.20,
    "strategic_account_value": 0.15,
    "urgency": 0.10,
    "evidence_confidence": 0.05,
}

SCORE_CONFIG = {
    "version": SCORING_CONFIG_VERSION,
    "minimumDataCompleteness": 0.60,
    "minimumRelationshipConfidence": MINIMUM_RELATIONSHIP_CONFIDENCE,
    "accountAttractiveness": ACCOUNT_ATTRACTIVENESS_WEIGHTS,
    "signalConfidence": SIGNAL_CONFIDENCE_WEIGHTS,
    "pursuitPwin": PWIN_WEIGHTS,
    "deliveryFeasibility": DELIVERY_WEIGHTS,
    "relationshipHealth": RELATIONSHIP_HEALTH_WEIGHTS,
    "actionPriority": ACTION_PRIORITY_WEIGHTS,
    "recencyDecay": {"halfLifeDays": 90, "floor": 0.2},
    "financialNormalization": {"method": "log10", "scale": 10_000_000},
    "hardGates": {
        "deliveryFeasibility": [
            "required_certification_missing",
            "no_capable_equipment",
            "impossible_schedule",
            "margin_below_floor",
            "regulatory_blocker",
            "mandatory_requirement_unmet",
        ],
    },
}

STRONG_MATCH_METHODS = {
    "exact_public_identifier",
    "exact_uei",
    "exact_cage_code",
    "exact_hubspot_company_id",
    "exact_verified_domain",
    "exact_legal_name",
    "manual_confirmation",
}

IDENTIFIER_TO_MATCH_METHOD = {
    "hubspot_company_id": "exact_hubspot_company_id",
    "domain": "exact_verified_domain",
    "legal_name": "exact_legal_name",
    "verified_alias": "verified_alias",
    "cage_code": "exact_cage_code",
    "uei": "exact_uei",
    "public_recipient_id": "exact_public_identifier",
}


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def normalize_identifier(identifier_type: str, value: str) -> str:
    text = value.strip().lower()
    if identifier_type == "domain":
        text = re.sub(r"^https?://", "", text).split("/")[0]
        text = text.removeprefix("www.")
    elif identifier_type in {"uei", "cage_code", "public_recipient_id", "hubspot_company_id"}:
        text = re.sub(r"[^a-z0-9]", "", text)
    else:
        text = re.sub(r"[^a-z0-9]+", " ", text).strip()
        text = re.sub(r"\b(inc|llc|ltd|corp|corporation|company|co)\b\.?", "", text).strip()
        text = re.sub(r"\s+", " ", text)
    return text


def canonical_account_id(tenant_id: str, *, legal_name: str, domain: str | None = None) -> str:
    basis = normalize_identifier("domain", domain) if domain else normalize_identifier("legal_name", legal_name)
    digest = hashlib.sha256(f"{tenant_id}:{basis}".encode("utf-8")).hexdigest()[:20]
    return f"acct-{digest}"


def _account_type(record: dict[str, Any]) -> str:
    status = str(record.get("account_status") or "").lower()
    relationship = str(record.get("relationship") or "").lower()
    if relationship == "customer" or status in {"current_customer", "active_pipeline", "past_customer"}:
        return "customer"
    if relationship == "supplier":
        return "supplier"
    if relationship == "competitor":
        return "competitor"
    if relationship == "target" or status in {"target_prospect", "new_logo"}:
        return "prospect"
    return "other"


def _upsert_identifier(
    session: Session,
    *,
    tenant_id: str,
    canonical_account_id: str,
    identifier_type: str,
    original_value: str | None,
    source_classification: str,
    verified: bool,
    actor: str | None = None,
) -> models.AccountIdentifier | None:
    if not original_value or not str(original_value).strip():
        return None
    normalized = normalize_identifier(identifier_type, str(original_value))
    if not normalized:
        return None
    existing = (
        session.query(models.AccountIdentifier)
        .filter(
            models.AccountIdentifier.tenant_id == tenant_id,
            models.AccountIdentifier.identifier_type == identifier_type,
            models.AccountIdentifier.normalized_value == normalized,
        )
        .one_or_none()
    )
    if existing:
        if existing.canonical_account_id == canonical_account_id:
            existing.original_value = str(original_value)
            existing.verified = existing.verified or verified
            if verified and not existing.verified_at:
                existing.verified_by_user_id = actor
                existing.verified_at = _now()
            existing.updated_at = _now()
            return existing
        return existing
    row = models.AccountIdentifier(
        tenant_id=tenant_id,
        canonical_account_id=canonical_account_id,
        identifier_type=identifier_type,
        normalized_value=normalized,
        original_value=str(original_value),
        source_classification=source_classification,
        verified=verified,
        verified_by_user_id=actor if verified else None,
        verified_at=_now() if verified else None,
    )
    session.add(row)
    return row


def _find_existing_account(session: Session, tenant_id: str, record: dict[str, Any]) -> models.CanonicalAccount | None:
    hubspot_company_id = record.get("hubspot_company_id") or record.get("hubspot_id")
    if hubspot_company_id:
        row = (
            session.query(models.CanonicalAccount)
            .filter(
                models.CanonicalAccount.tenant_id == tenant_id,
                models.CanonicalAccount.hubspot_company_id == str(hubspot_company_id),
            )
            .one_or_none()
        )
        if row:
            return row
    candidates: list[tuple[str, str]] = []
    domains = record.get("domains") if isinstance(record.get("domains"), list) else []
    for domain in domains:
        candidates.append(("domain", str(domain)))
    if record.get("domain"):
        candidates.append(("domain", str(record["domain"])))
    if record.get("name"):
        candidates.append(("legal_name", str(record["name"])))
    for identifier_type, value in candidates:
        normalized = normalize_identifier(identifier_type, value)
        identifier = (
            session.query(models.AccountIdentifier)
            .filter(
                models.AccountIdentifier.tenant_id == tenant_id,
                models.AccountIdentifier.identifier_type == identifier_type,
                models.AccountIdentifier.normalized_value == normalized,
                models.AccountIdentifier.verified.is_(True),
            )
            .one_or_none()
        )
        if identifier:
            return session.get(models.CanonicalAccount, identifier.canonical_account_id)
    return None


def upsert_canonical_accounts(session: Session, records: list[dict[str, Any]], tenant_id: str) -> dict[str, str]:
    """Upsert CRM account records and return source id to canonical id map."""
    id_map: dict[str, str] = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        name = str(record.get("name") or "").strip()
        if not name:
            continue
        domains = record.get("domains") if isinstance(record.get("domains"), list) else []
        domain = str(domains[0]).strip() if domains else None
        existing = _find_existing_account(session, tenant_id, record)
        account_id = existing.id if existing else canonical_account_id(tenant_id, legal_name=name, domain=domain)
        row = existing or models.CanonicalAccount(id=account_id, tenant_id=tenant_id)
        row.legal_name = row.legal_name or name
        row.display_name = name
        row.domain = domain
        row.account_type = _account_type(record)
        row.hubspot_company_id = record.get("hubspot_company_id") or record.get("hubspot_id") or row.hubspot_company_id
        row.domains = domains
        row.aliases = record.get("aliases") if isinstance(record.get("aliases"), list) else []
        row.facility_names = record.get("facility_names") if isinstance(record.get("facility_names"), list) else []
        row.parent_account_id = record.get("parent_account_id") if isinstance(record.get("parent_account_id"), str) else None
        row.parent_id = record.get("parent_id") if isinstance(record.get("parent_id"), str) else None
        row.subsidiary_ids = record.get("subsidiary_ids") if isinstance(record.get("subsidiary_ids"), list) else []
        row.cage_code = record.get("cage_code") if isinstance(record.get("cage_code"), str) else None
        row.uei = record.get("uei") if isinstance(record.get("uei"), str) else None
        row.public_recipient_ids = record.get("public_recipient_ids") if isinstance(record.get("public_recipient_ids"), list) else []
        row.known_programs = record.get("known_programs") if isinstance(record.get("known_programs"), list) else []
        row.known_customers = record.get("known_customers") if isinstance(record.get("known_customers"), list) else []
        row.updated_at = _now()
        session.merge(row)
        session.flush()

        source_ids = [
            record.get("id"),
            record.get("canonical_account_id"),
            record.get("hubspot_company_id"),
            record.get("hubspot_id"),
        ]
        for source_id in source_ids:
            if isinstance(source_id, str) and source_id:
                id_map[source_id] = account_id

        _upsert_identifier(session, tenant_id=tenant_id, canonical_account_id=account_id, identifier_type="legal_name", original_value=name, source_classification="crm", verified=True)
        if row.hubspot_company_id:
            _upsert_identifier(session, tenant_id=tenant_id, canonical_account_id=account_id, identifier_type="hubspot_company_id", original_value=row.hubspot_company_id, source_classification="crm", verified=True)
        for item in domains:
            _upsert_identifier(session, tenant_id=tenant_id, canonical_account_id=account_id, identifier_type="domain", original_value=str(item), source_classification="crm", verified=True)
        for item in row.aliases or []:
            _upsert_identifier(session, tenant_id=tenant_id, canonical_account_id=account_id, identifier_type="verified_alias", original_value=str(item), source_classification="crm", verified=False)
        if row.cage_code:
            _upsert_identifier(session, tenant_id=tenant_id, canonical_account_id=account_id, identifier_type="cage_code", original_value=row.cage_code, source_classification="crm", verified=True)
        if row.uei:
            _upsert_identifier(session, tenant_id=tenant_id, canonical_account_id=account_id, identifier_type="uei", original_value=row.uei, source_classification="crm", verified=True)
        for item in row.public_recipient_ids or []:
            _upsert_identifier(session, tenant_id=tenant_id, canonical_account_id=account_id, identifier_type="public_recipient_id", original_value=str(item), source_classification="public", verified=True)
    return id_map


def canonical_account_to_company(row: models.CanonicalAccount) -> dict:
    relationship = "customer" if row.account_type == "customer" else "target" if row.account_type in {"prospect", "prime_contractor"} else row.account_type
    return {
        "id": row.id,
        "canonical_account_id": row.id,
        "name": row.display_name or row.legal_name,
        "legalName": row.legal_name,
        "displayName": row.display_name or row.legal_name,
        "relationship": relationship if relationship in {"self", "customer", "supplier", "competitor", "target"} else "target",
        "account_status": "current_customer" if row.account_type == "customer" else "target_prospect",
        "business_motion": "grow_existing_business" if row.account_type == "customer" else "prospect_new_business",
        "location": {"city": "", "lat": None, "lon": None},
        "website_url": f"https://{row.domain}" if row.domain else None,
        "needs": [],
        "hubspot_company_id": row.hubspot_company_id,
        "domains": row.domains or ([row.domain] if row.domain else []),
        "aliases": row.aliases or [],
        "facility_names": row.facility_names or [],
        "parent_id": row.parent_account_id or row.parent_id,
        "subsidiary_ids": row.subsidiary_ids or [],
        "cage_code": row.cage_code,
        "uei": row.uei,
        "public_recipient_ids": row.public_recipient_ids or [],
        "known_programs": row.known_programs or [],
        "known_customers": row.known_customers or [],
    }


def remap_source_records(records: list[dict[str, Any]], id_map: dict[str, str], *, id_field: str = "id") -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for record in records:
        copy = dict(record)
        source_id = str(copy.get(id_field) or "")
        canonical_id = id_map.get(source_id) or id_map.get(str(copy.get("canonical_account_id") or ""))
        if canonical_id:
            copy["id"] = canonical_id
            copy["canonical_account_id"] = canonical_id
        result.append(copy)
    return result


def remap_child_company_ids(records: list[dict[str, Any]], id_map: dict[str, str]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for record in records:
        copy = dict(record)
        company_id = str(copy.get("company_id") or "")
        if company_id in id_map:
            copy["company_id"] = id_map[company_id]
        result.append(copy)
    return result


def persist_signal(session: Session, *, tenant_id: str, signal: dict[str, Any]) -> models.IntelligenceSignal:
    signal_id = str(signal["id"])
    row = session.get(models.IntelligenceSignal, signal_id)
    artifact = signal.get("artifact") if isinstance(signal.get("artifact"), dict) else {}
    event_type = signal.get("event_type")
    event_type_status = "classified" if event_type and event_type != "unknown" else "unknown"
    published_text = signal.get("detected_at")
    try:
        published = datetime.fromisoformat(str(published_text).replace("Z", "+00:00")) if published_text else None
    except ValueError:
        published = None
    if row is None:
        row = models.IntelligenceSignal(id=signal_id, tenant_id=tenant_id, title=str(artifact.get("headline") or signal.get("source_quote") or signal_id))
    row.title = str(artifact.get("headline") or signal.get("source_quote") or signal_id)
    row.summary = str(signal.get("source_quote") or row.title)
    row.analysis = artifact.get("analysis_text") if isinstance(artifact.get("analysis_text"), str) else None
    row.scope = str(signal.get("scope") or "market")
    row.event_type = str(event_type) if event_type and event_type != "unknown" else None
    row.event_type_status = event_type_status
    row.occurred_at = published
    row.published_at = published
    row.retrieved_at = _now()
    row.source_ids = [str(artifact.get("source_name") or "monitor")]
    row.evidence_ids = [signal_id]
    row.extraction_confidence = signal.get("confidence") if isinstance(signal.get("confidence"), (int, float)) else None
    row.raw_payload = signal
    row.updated_at = _now()
    session.add(row)
    return row


def _identifier_candidates(session: Session, tenant_id: str, entity_name: str) -> list[models.AccountIdentifier]:
    candidates: list[models.AccountIdentifier] = []
    normalized_by_type = {
        "legal_name": normalize_identifier("legal_name", entity_name),
        "verified_alias": normalize_identifier("verified_alias", entity_name),
        "domain": normalize_identifier("domain", entity_name) if "." in entity_name else "",
        "uei": normalize_identifier("uei", entity_name),
        "cage_code": normalize_identifier("cage_code", entity_name),
        "public_recipient_id": normalize_identifier("public_recipient_id", entity_name),
    }
    for identifier_type, normalized in normalized_by_type.items():
        if not normalized:
            continue
        candidates.extend(
            session.query(models.AccountIdentifier)
            .filter(
                models.AccountIdentifier.tenant_id == tenant_id,
                models.AccountIdentifier.identifier_type == identifier_type,
                models.AccountIdentifier.normalized_value == normalized,
            )
            .all()
        )
    return candidates


def _relationship_snapshot(row: models.SignalAccountRelationship) -> dict:
    return {
        "id": row.id,
        "tenantId": row.tenant_id,
        "signalId": row.signal_id,
        "canonicalAccountId": row.canonical_account_id,
        "sourceEntityName": row.source_entity_name,
        "matchMethod": row.match_method,
        "confidence": row.confidence,
        "reviewStatus": row.review_status,
        "creationSource": row.creation_source,
        "evidenceIds": row.evidence_ids or [],
        "confirmedByUserId": row.confirmed_by_user_id,
        "confirmedAt": _iso(row.confirmed_at),
        "rejectedByUserId": row.rejected_by_user_id,
        "rejectedAt": _iso(row.rejected_at),
        "rejectionReason": row.rejection_reason,
        "lastValidatedAt": _iso(row.last_validated_at),
        "createdAt": _iso(row.created_at),
        "updatedAt": _iso(row.updated_at),
    }


def relationship_to_dict(row: models.SignalAccountRelationship) -> dict:
    payload = _relationship_snapshot(row)
    payload.update({
        "signal_id": row.signal_id,
        "canonical_account_id": row.canonical_account_id,
        "source_entity_name": row.source_entity_name,
        "match_method": row.match_method,
        "review_status": row.review_status,
        "creation_source": row.creation_source,
        "evidence_ids": row.evidence_ids or [],
        "last_validated_at": _iso(row.last_validated_at),
    })
    return payload


def signal_to_dict(row: models.IntelligenceSignal) -> dict:
    payload = dict(row.raw_payload or {})
    payload.update({
        "id": row.id,
        "title": row.title,
        "summary": row.summary,
        "analysis": row.analysis,
        "scope": row.scope,
        "event_type": row.event_type or "unknown",
        "eventTypeStatus": row.event_type_status,
        "occurredAt": _iso(row.occurred_at),
        "publishedAt": _iso(row.published_at),
        "retrievedAt": _iso(row.retrieved_at),
        "sourceIds": row.source_ids or [],
        "evidenceIds": row.evidence_ids or [],
        "extractionConfidence": row.extraction_confidence,
        "createdAt": _iso(row.created_at),
        "updatedAt": _iso(row.updated_at),
    })
    return payload


def is_confirmed_account_signal(signal: dict[str, Any] | models.IntelligenceSignal, relationship: dict[str, Any] | models.SignalAccountRelationship, minimum_confidence: float = MINIMUM_RELATIONSHIP_CONFIDENCE) -> bool:
    signal_scope = signal.scope if isinstance(signal, models.IntelligenceSignal) else signal.get("scope")
    signal_id = signal.id if isinstance(signal, models.IntelligenceSignal) else signal.get("id")
    rel_signal_id = relationship.signal_id if isinstance(relationship, models.SignalAccountRelationship) else relationship.get("signalId") or relationship.get("signal_id")
    rel_status = relationship.review_status if isinstance(relationship, models.SignalAccountRelationship) else relationship.get("reviewStatus") or relationship.get("review_status")
    rel_confidence = relationship.confidence if isinstance(relationship, models.SignalAccountRelationship) else relationship.get("confidence")
    evidence_ids = relationship.evidence_ids if isinstance(relationship, models.SignalAccountRelationship) else relationship.get("evidenceIds") or relationship.get("evidence_ids")
    rel_account = relationship.canonical_account_id if isinstance(relationship, models.SignalAccountRelationship) else relationship.get("canonicalAccountId") or relationship.get("canonical_account_id")
    signal_account = signal.raw_payload.get("subject_id") if isinstance(signal, models.IntelligenceSignal) and isinstance(signal.raw_payload, dict) else (signal.get("subject_id") if isinstance(signal, dict) else rel_account)
    if isinstance(signal, models.IntelligenceSignal) and signal_scope == "specific_account" and signal_account in {None, "__portfolio__"}:
        signal_account = rel_account
    try:
        confidence = float(rel_confidence)
    except (TypeError, ValueError):
        confidence = 0.0
    return (
        signal_scope == "specific_account"
        and signal_id == rel_signal_id
        and rel_status == "confirmed"
        and confidence >= minimum_confidence
        and bool(evidence_ids)
        and rel_account == signal_account
    )


def resolve_signal_relationships(session: Session, *, tenant_id: str, signal: dict[str, Any]) -> list[models.SignalAccountRelationship]:
    persisted = persist_signal(session, tenant_id=tenant_id, signal=signal)
    relationships: list[models.SignalAccountRelationship] = []
    entities = signal.get("entities") if isinstance(signal.get("entities"), list) else []
    for entity in entities:
        entity_name = str(entity).strip()
        if not entity_name:
            continue
        candidates = _identifier_candidates(session, tenant_id, entity_name)
        if not candidates:
            continue
        account_ids = {candidate.canonical_account_id for candidate in candidates}
        if len(account_ids) != 1:
            method = "verified_alias"
            confidence = 0.55
            review_status = "needs_review"
        else:
            identifier = sorted(candidates, key=lambda item: item.identifier_type)[0]
            method = IDENTIFIER_TO_MATCH_METHOD.get(identifier.identifier_type, "verified_alias")
            confidence = 0.95 if method in STRONG_MATCH_METHODS and identifier.verified else 0.72
            review_status = "confirmed" if method in STRONG_MATCH_METHODS and confidence >= MINIMUM_RELATIONSHIP_CONFIDENCE else "needs_review"
        for account_id in sorted(account_ids):
            existing = (
                session.query(models.SignalAccountRelationship)
                .filter(
                    models.SignalAccountRelationship.tenant_id == tenant_id,
                    models.SignalAccountRelationship.signal_id == persisted.id,
                    models.SignalAccountRelationship.canonical_account_id == account_id,
                    models.SignalAccountRelationship.source_entity_name == entity_name,
                )
                .one_or_none()
            )
            row = existing or models.SignalAccountRelationship(
                tenant_id=tenant_id,
                signal_id=persisted.id,
                canonical_account_id=account_id,
                source_entity_name=entity_name,
            )
            row.match_method = method
            row.confidence = confidence
            row.review_status = row.review_status if existing and row.review_status in {"confirmed", "rejected"} else review_status
            row.creation_source = "public_data"
            row.evidence_ids = [persisted.id]
            row.last_validated_at = _now()
            row.updated_at = _now()
            if row.review_status == "confirmed" and not row.confirmed_at:
                row.confirmed_at = _now()
                row.confirmed_by_user_id = "system"
            session.add(row)
            session.flush()
            relationships.append(row)
            if not existing:
                session.add(models.RelationshipAuditEvent(
                    tenant_id=tenant_id,
                    relationship_id=row.id,
                    action="create_candidate",
                    actor_user_id="system",
                    after=_relationship_snapshot(row),
                ))
            if row.review_status == "needs_review":
                ensure_relationship_review_work_item(session, relationship=row)
    confirmed = [row for row in relationships if row.review_status == "confirmed"]
    if confirmed:
        persisted.scope = "specific_account"
        signal["scope"] = "specific_account"
        signal["subject_id"] = confirmed[0].canonical_account_id
        persisted.raw_payload = signal
    elif relationships:
        persisted.scope = "unlinked"
        signal["scope"] = "unlinked"
    session.add(persisted)
    return relationships


def ensure_relationship_review_work_item(session: Session, *, relationship: models.SignalAccountRelationship) -> models.WorkItem:
    dedupe_key = f"relationship_review:{relationship.tenant_id}:{relationship.id}"
    active_statuses = ["detected", "triaged", "prepared", "awaiting_approval", "approved", "in_progress", "proposed"]
    existing = (
        session.query(models.WorkItem)
        .filter(models.WorkItem.tenant_id == relationship.tenant_id, models.WorkItem.dedupe_key == dedupe_key, models.WorkItem.status.in_(active_statuses))
        .one_or_none()
    )
    if existing:
        return existing
    row = models.WorkItem(
        tenant_id=relationship.tenant_id,
        type="relationship_review",
        canonical_account_id=relationship.canonical_account_id,
        related_signal_id=relationship.signal_id,
        related_relationship_id=relationship.id,
        source_signal_ids=[relationship.signal_id],
        score_snapshot_ids=[],
        supporting_evidence=[{"relationship_id": relationship.id, "evidence_ids": relationship.evidence_ids or []}],
        missing_information=["Relationship requires human review before it can affect account scores."],
        dedupe_key=dedupe_key,
        owner=None,
        priority="normal",
        status="detected",
        recommended_action=f"Review signal-account match for {relationship.source_entity_name}.",
        approval_state="pending",
        execution_state="not_started",
        audit_history=[{"action": "created_from_relationship_review", "actor": "system", "timestamp": _now().isoformat(), "relationship_id": relationship.id}],
    )
    session.add(row)
    session.flush()
    return row


def _score_factor(key: str, label: str, raw: Any, normalized: float | None, weight: float, source_classification: str, explanation: str, *, evidence_ids: list[str] | None = None, source_record_ids: list[str] | None = None, direction: str = "positive") -> dict:
    contribution = None if normalized is None else round(normalized * weight * 100, 4)
    return {
        "key": key,
        "label": label,
        "rawValue": raw,
        "normalizedValue": None if normalized is None else round(normalized, 4),
        "weight": weight,
        "contribution": contribution,
        "direction": direction,
        "sourceClassification": source_classification,
        "sourceRecordIds": source_record_ids or [],
        "evidenceIds": evidence_ids or [],
        "explanation": explanation,
    }


def _score_result(*, factors: list[dict], missing: list[str], hard_gates: list[str] | None = None, configuration_version: str = SCORING_CONFIG_VERSION, source_data_version: str, minimum_completeness: float = 0.60, force_status: str | None = None) -> dict:
    hard_gates = hard_gates or []
    known_weight = sum(f["weight"] for f in factors if f["normalizedValue"] is not None)
    completeness = round(known_weight, 4)
    available = completeness >= minimum_completeness
    status = force_status or ("disqualified" if hard_gates else "available" if available else "insufficient_data")
    score = None
    if status in {"available", "provisional", "disqualified"}:
        contributions = [f["contribution"] for f in factors if f["contribution"] is not None]
        score = round(sum(contributions), 2) if contributions else None
    return {
        "score": score,
        "status": status,
        "dataCompleteness": completeness,
        "positiveFactors": [f for f in factors if f["direction"] == "positive"],
        "negativeFactors": [f for f in factors if f["direction"] == "negative"],
        "neutralFactors": [f for f in factors if f["direction"] == "neutral"],
        "missingInputs": missing,
        "hardGateFailures": hard_gates,
        "evidenceIds": sorted({evidence for factor in factors for evidence in factor["evidenceIds"]}),
        "configurationVersion": configuration_version,
        "sourceDataVersion": source_data_version,
        "calculatedAt": _now().isoformat(),
    }


def _capability_alignment(account: models.CanonicalAccount) -> float | None:
    needs = [normalize_identifier("legal_name", item) for item in (account.known_programs or []) + (account.known_customers or [])]
    aliases = [normalize_identifier("legal_name", item) for item in (account.aliases or [])]
    text = " ".join([account.legal_name, account.display_name, *(account.domains or []), *needs, *aliases]).lower()
    matches = [capability for capability in BTX_CAPABILITIES if capability in text]
    if not matches:
        return None
    return min(1.0, len(matches) / 4)


def _financial_signal_value(signals: list[models.IntelligenceSignal]) -> float | None:
    values: list[float] = []
    for signal in signals:
        payload = signal.raw_payload if isinstance(signal.raw_payload, dict) else {}
        value = payload.get("value")
        if isinstance(value, (int, float)) and value > 0:
            values.append(float(value))
        artifact = payload.get("artifact") if isinstance(payload.get("artifact"), dict) else {}
        for item in artifact.get("dollar_figures") or []:
            if isinstance(item, (int, float)) and item > 0:
                values.append(float(item))
    return max(values) if values else None


def _financial_normalized(value: float | None) -> float | None:
    if value is None or value <= 0:
        return None
    return min(1.0, math.log10(value + 1) / math.log10(SCORE_CONFIG["financialNormalization"]["scale"]))


def _recency_score(signals: list[models.IntelligenceSignal]) -> float | None:
    dates = [signal.published_at or signal.retrieved_at for signal in signals if signal.published_at or signal.retrieved_at]
    if not dates:
        return None
    age_days = max(0.0, (_now() - _aware(max(dates))).total_seconds() / 86400)
    half_life = SCORE_CONFIG["recencyDecay"]["halfLifeDays"]
    return max(SCORE_CONFIG["recencyDecay"]["floor"], 0.5 ** (age_days / half_life))


def _confirmed_signals_for_account(session: Session, tenant_id: str, account_id: str) -> list[models.IntelligenceSignal]:
    rows = (
        session.query(models.SignalAccountRelationship)
        .filter(
            models.SignalAccountRelationship.tenant_id == tenant_id,
            models.SignalAccountRelationship.canonical_account_id == account_id,
            models.SignalAccountRelationship.review_status == "confirmed",
            models.SignalAccountRelationship.confidence >= MINIMUM_RELATIONSHIP_CONFIDENCE,
        )
        .all()
    )
    signals: list[models.IntelligenceSignal] = []
    for relationship in rows:
        signal = session.get(models.IntelligenceSignal, relationship.signal_id)
        if signal and is_confirmed_account_signal(signal, relationship):
            signals.append(signal)
    return signals


def account_attractiveness(session: Session, tenant_id: str, account: models.CanonicalAccount, source_data_version: str) -> dict:
    signals = _confirmed_signals_for_account(session, tenant_id, account.id)
    evidence_ids = [signal.id for signal in signals]
    value = _financial_signal_value(signals)
    capability = _capability_alignment(account)
    momentum = _recency_score(signals)
    factors = [
        _score_factor("capability_alignment", "BTX capability alignment", bool(capability is not None), capability, 0.25, "derived", "Capability alignment is derived from verified account metadata and BTX capability tags.", evidence_ids=evidence_ids),
        _score_factor("addressable_work_package", "Addressable work-package potential", value, _financial_normalized(value), 0.20, "public", "Financial values use log normalization so large awards do not dominate the score.", evidence_ids=evidence_ids),
        _score_factor("program_award_momentum", "Program and award momentum", len(signals), momentum, 0.15, "public", "Momentum uses confirmed signal recency.", evidence_ids=evidence_ids),
        _score_factor("repeat_production", "Repeat-production potential and duration", None, None, 0.15, "public", "No durable repeat-production evidence is connected yet."),
        _score_factor("strategic_relevance", "Strategic market relevance", bool(signals), 0.7 if signals else None, 0.10, "derived", "Strategic relevance is derived only from confirmed account-specific signals.", evidence_ids=evidence_ids),
        _score_factor("supply_chain_accessibility", "Supply-chain accessibility", None, None, 0.10, "public", "Supplier accessibility is not connected."),
        _score_factor("geographic_relevance", "Geographic or logistics relevance", None, None, 0.05, "public", "Coordinates or verified facility locations are unavailable."),
    ]
    missing = [factor["label"] for factor in factors if factor["normalizedValue"] is None]
    return _score_result(factors=factors, missing=missing, source_data_version=source_data_version)


def signal_confidence(signal: models.IntelligenceSignal, relationships: list[models.SignalAccountRelationship], source_data_version: str) -> dict:
    best_relationship = sorted(relationships, key=lambda item: item.confidence, reverse=True)[0] if relationships else None
    source_name = (signal.source_ids or [""])[0]
    authority = 0.9 if any(term in source_name.lower() for term in ["sam", "federal", "dod", "congress", "gov"]) else 0.7 if source_name else None
    recency = _recency_score([signal])
    specificity = 1.0 if signal.scope == "specific_account" else 0.65 if signal.scope in {"program", "market"} else 0.3
    factors = [
        _score_factor("entity_match", "Entity-match confidence", best_relationship.confidence if best_relationship else None, best_relationship.confidence if best_relationship else None, 0.30, "derived", "Entity-match confidence is separate from extraction confidence.", evidence_ids=best_relationship.evidence_ids if best_relationship else []),
        _score_factor("source_authority", "Source authority", source_name or None, authority, 0.20, "public", "Official and primary sources receive higher authority."),
        _score_factor("specificity", "Account or program specificity", signal.scope, specificity, 0.20, "derived", "Specificity reflects whether the signal is market, program, or confirmed account scoped."),
        _score_factor("independent_corroboration", "Independent corroboration", None, None, 0.10, "public", "Independent corroboration is not connected."),
        _score_factor("recency", "Recency", _iso(signal.published_at), recency, 0.10, "public", "Recency uses configured half-life decay."),
        _score_factor("novelty", "Novelty", None, 0.7, 0.10, "derived", "Novelty defaults to moderate until duplicate grouping is connected."),
    ]
    missing = [factor["label"] for factor in factors if factor["normalizedValue"] is None]
    return _score_result(factors=factors, missing=missing, source_data_version=source_data_version)


def insufficient_score(family: str, missing: list[str], source_data_version: str) -> dict:
    weights = {
        "pursuitPwin": PWIN_WEIGHTS,
        "deliveryFeasibility": DELIVERY_WEIGHTS,
        "relationshipHealth": RELATIONSHIP_HEALTH_WEIGHTS,
        "actionPriority": ACTION_PRIORITY_WEIGHTS,
    }[family]
    factors = [
        _score_factor(key, key.replace("_", " ").title(), None, None, weight, "crm" if family in {"pursuitPwin", "relationshipHealth"} else "operational", "Required source is missing.")
        for key, weight in weights.items()
    ]
    return _score_result(factors=factors, missing=missing, source_data_version=source_data_version, minimum_completeness=1.0)


def score_account(session: Session, tenant_id: str, account: models.CanonicalAccount, source_data_version: str) -> dict:
    attractiveness = account_attractiveness(session, tenant_id, account, source_data_version)
    scores = {
        "accountAttractiveness": attractiveness,
        "pursuitPwin": insufficient_score("pursuitPwin", ["CRM engagement, pricing, competitive position, and capture readiness are not connected."], source_data_version),
        "deliveryFeasibility": insufficient_score("deliveryFeasibility", ["Operating capacity, schedule, margin, material readiness, and hard-gate inputs are not connected."], source_data_version),
        "relationshipHealth": insufficient_score("relationshipHealth", ["CRM relationship coverage, sentiment, interaction quality, and delivery history are not connected."], source_data_version),
        "actionPriority": insufficient_score("actionPriority", ["PWIN and Delivery Feasibility are required before Action Priority is available."], source_data_version),
    }
    return scores


def persist_score_snapshot(session: Session, tenant_id: str, *, entity_type: str, entity_id: str, score_family: str, result: dict) -> models.ScoreSnapshot:
    row = models.ScoreSnapshot(
        tenant_id=tenant_id,
        entity_type=entity_type,
        entity_id=entity_id,
        score_family=score_family,
        status=result["status"],
        score=result["score"],
        result=result,
        configuration_version=result["configurationVersion"],
        source_data_version=result["sourceDataVersion"],
        calculated_at=_now(),
    )
    session.add(row)
    session.flush()
    return row


def score_snapshot_summary(row: models.ScoreSnapshot) -> dict:
    return {
        "id": row.id,
        "entityType": row.entity_type,
        "entityId": row.entity_id,
        "scoreFamily": row.score_family,
        "status": row.status,
        "score": row.score,
        "result": row.result,
        "configurationVersion": row.configuration_version,
        "sourceDataVersion": row.source_data_version,
        "calculatedAt": _iso(row.calculated_at),
    }


def ensure_default_scoring_config(session: Session, tenant_id: str, actor: str | None = None) -> models.ScoringConfigVersion:
    row = (
        session.query(models.ScoringConfigVersion)
        .filter(models.ScoringConfigVersion.tenant_id == tenant_id, models.ScoringConfigVersion.version == SCORING_CONFIG_VERSION)
        .one_or_none()
    )
    if row:
        return row
    validate_weight_config(SCORE_CONFIG)
    row = models.ScoringConfigVersion(
        tenant_id=tenant_id,
        version=SCORING_CONFIG_VERSION,
        document=SCORE_CONFIG,
        created_by_user_id=actor,
    )
    session.add(row)
    session.flush()
    return row


def validate_weight_config(config: dict[str, Any]) -> None:
    for key in ["accountAttractiveness", "signalConfidence", "pursuitPwin", "deliveryFeasibility", "relationshipHealth", "actionPriority"]:
        group = config.get(key)
        if not isinstance(group, dict):
            raise ValueError(f"{key} must be a weight object")
        total = sum(float(value) for value in group.values())
        if abs(total - 1.0) > 0.0001:
            raise ValueError(f"{key} weights must sum to 1.0, got {total}")
