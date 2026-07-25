"""FastAPI application - the always-on ingress.

The webhook route is deliberately thin: read raw bytes, look up the connection,
delegate to the ingest service, map errors to status codes, return fast. All
collaborators (settings, session factory, queue) hang off ``app.state`` so tests
inject SQLite + an in-memory queue and production injects Postgres + Celery.
"""
from __future__ import annotations

import logging
import json
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from btx_platform import models
from btx_platform.auth import AuthContext, AuthError, ClerkVerifier, bearer_token
from btx_platform.config import Settings, get_settings
from btx_platform.db import assert_schema_current, init_db, make_engine, make_session_factory
from btx_platform.engine_config import config_history, latest_config, put_config, seed_engine_configs
from btx_platform.health import platform_health
from btx_platform.observability import capture_exception, configure_observability, new_request_id, set_request_id
from btx_platform.hubspot import HubSpotClient, HubSpotError, HubSpotTaskAssociation, hubspot_payload, map_companies
from btx_platform.intelligence import (
    MINIMUM_RELATIONSHIP_CONFIDENCE,
    SCORING_CONFIG_VERSION,
    canonical_account_to_company,
    ensure_default_scoring_config,
    is_confirmed_account_signal,
    relationship_to_dict,
    remap_child_company_ids,
    resolve_signal_relationships,
    score_account,
    score_snapshot_summary,
    signal_to_dict,
    signal_confidence,
    persist_score_snapshot,
    upsert_canonical_accounts,
    validate_weight_config,
)
from btx_platform.ingest import IngestError, ingest
from btx_platform.llm import LlmProviderError, call_anthropic
from btx_platform.pipeline import PipelineConfigError, PipelineRateLimit, list_runs, trigger_pipeline
from btx_platform.queue import CeleryQueue, InMemoryQueue, JobQueue
from btx_platform.ratelimit import RateLimiter
from btx_platform.schemas import (
    CalendarEventRequest,
    CrmTaskRequest,
    DeliverableCreate,
    DeliverablePatch,
    DeliverableResponse,
    EmailSendRequest,
    EngineConfigPut,
    EngineConfigResponse,
    HubSpotCompanySearchRequest,
    HubSpotImportRequest,
    HubSpotListAddRecordsRequest,
    HubSpotListCreateRequest,
    HubSpotTaskExecuteRequest,
    IngestAccepted,
    LlmProxyRequest,
    PipelineRunResponse,
    WorkItemCreate,
    WorkItemDismiss,
    WorkItemNoteCreate,
    WorkItemPatch,
    WorkItemResponse,
    WorkItemTransitionRequest,
)

logger = logging.getLogger(__name__)
CRM_CACHE_TTL_SECONDS = 300
PUBLIC_PATHS = {"/health", "/artifacts/latest", "/operating-baseline"}
# Mutating routes require at least "analyst"; a viewer can read but not write.
MUTATING_ROUTE_MIN_ROLE = "analyst"
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# /webhooks/* is authenticated by its own per-connection HMAC signature, not
# a Clerk session (the caller is a machine, not a signed-in user).
WEBHOOK_PATH_PREFIX = "/webhooks/"
WORK_ITEM_TRANSITIONS: dict[str, dict[str, str]] = {
    "detected": {"triage": "triaged", "dismiss": "dismissed"},
    "triaged": {"prepare": "prepared", "dismiss": "dismissed"},
    "prepared": {"request_approval": "awaiting_approval", "start": "in_progress", "dismiss": "dismissed"},
    "awaiting_approval": {"approve": "approved", "reject": "prepared", "dismiss": "dismissed"},
    "approved": {"start": "in_progress", "dismiss": "dismissed"},
    "in_progress": {"mark_executed": "executed", "dismiss": "dismissed"},
    "executed": {"verify": "verified", "start": "in_progress"},
    "verified": {"record_outcome": "outcome_recorded", "close": "closed"},
    "outcome_recorded": {"close": "closed"},
    "dismissed": {"reopen": "triaged"},
    "closed": {"reopen": "triaged"},
}
LEGACY_STATUS_MAP = {"proposed": "detected", "done": "closed"}
LEGACY_EXECUTION_STATE_MAP = {"queued": "pending", "running": "pending", "completed": "verified"}
TERMINAL_WORK_ITEM_STATUSES = {"dismissed", "closed"}


def _three_business_days_from_now() -> str:
    current = datetime.now(UTC)
    remaining = 3
    while remaining:
        current += timedelta(days=1)
        if current.weekday() < 5:
            remaining -= 1
    return current.isoformat().replace("+00:00", "Z")


def _hubspot_id(value: str | None, prefix: str) -> str | None:
    if not value:
        return None
    return value.removeprefix(prefix)


def _task_associations(payload: CrmTaskRequest) -> list[HubSpotTaskAssociation]:
    company_id = _hubspot_id(payload.company_id or payload.account_id, "hubspot-company-")
    contact_id = _hubspot_id(payload.contact_id, "hubspot-contact-")
    deal_id = _hubspot_id(payload.deal_id, "hubspot-deal-")
    associations: list[HubSpotTaskAssociation] = []
    if company_id:
        associations.append(HubSpotTaskAssociation("companies", company_id))
    if contact_id:
        associations.append(HubSpotTaskAssociation("contacts", contact_id))
    if deal_id:
        associations.append(HubSpotTaskAssociation("deals", deal_id))
    return associations


def _task_associations_from_values(
    *,
    company_id: str | None,
    contact_id: str | None,
    deal_id: str | None,
) -> list[HubSpotTaskAssociation]:
    associations: list[HubSpotTaskAssociation] = []
    hubspot_company_id = _hubspot_id(company_id, "hubspot-company-")
    hubspot_contact_id = _hubspot_id(contact_id, "hubspot-contact-")
    hubspot_deal_id = _hubspot_id(deal_id, "hubspot-deal-")
    if hubspot_company_id:
        associations.append(HubSpotTaskAssociation("companies", hubspot_company_id))
    if hubspot_contact_id:
        associations.append(HubSpotTaskAssociation("contacts", hubspot_contact_id))
    if hubspot_deal_id:
        associations.append(HubSpotTaskAssociation("deals", hubspot_deal_id))
    return associations


def _actor(request: Request) -> str:
    """The authenticated Clerk user driving this mutation (audit trail identity).

    Falls back to "system" only for routes exempt from Clerk auth (webhooks),
    never as a way to spoof identity - the auth middleware already rejected
    any request without a verified session before a route handler runs.
    """
    auth: AuthContext | None = getattr(request.state, "auth", None)
    if auth is None:
        return "system"
    return auth.email or auth.user_id


def _auth_context(request: Request) -> AuthContext | None:
    return getattr(request.state, "auth", None)


def _role(request: Request) -> str:
    auth = _auth_context(request)
    return auth.role if auth is not None else "admin"


def _actor_user_id(request: Request) -> str | None:
    auth = _auth_context(request)
    return auth.user_id if auth is not None else None


def _tenant_id(request: Request) -> str:
    auth: AuthContext | None = getattr(request.state, "auth", None)
    return auth.tenant_id if auth is not None else models.DEFAULT_TENANT_ID


def _has_role(request: Request, minimum: str) -> bool:
    auth = _auth_context(request)
    return True if auth is None else auth.has_role(minimum)


def _forbidden(detail: str) -> JSONResponse:
    return JSONResponse({"code": "forbidden", "detail": detail}, status_code=403)


def _parse_datetime(value: str | None, field_name: str) -> datetime | None:
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field_name} must be an ISO-8601 date or datetime") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed


def _canonical_work_status(value: str | None) -> str:
    return LEGACY_STATUS_MAP.get(value or "detected", value or "detected")


def _canonical_execution_state(value: str | None) -> str:
    return LEGACY_EXECUTION_STATE_MAP.get(value or "not_started", value or "not_started")


def _notes_for_work_item(session, row: models.WorkItem) -> list[dict]:
    notes = (
        session.query(models.WorkItemNote)
        .filter(models.WorkItemNote.tenant_id == row.tenant_id, models.WorkItemNote.work_item_id == row.id)
        .order_by(models.WorkItemNote.created_at.asc())
        .all()
    )
    return [
        {
            "id": note.id,
            "work_item_id": note.work_item_id,
            "author_user_id": note.author_user_id,
            "body": note.body,
            "note_type": note.note_type,
            "evidence_ids": note.evidence_ids or [],
            "created_at": note.created_at.isoformat(),
        }
        for note in notes
    ]


def _allowed_work_item_actions(row: models.WorkItem, role: str) -> list[str]:
    status = _canonical_work_status(row.status)
    actions = set(WORK_ITEM_TRANSITIONS.get(status, {}).keys())
    if status == "prepared" and row.approval_state == "not_required":
        actions.add("start")
    if role not in {"cro", "admin"}:
        actions.discard("approve")
        actions.discard("reject")
        actions.discard("reopen")
    if role != "admin" and status == "approved":
        actions.discard("dismiss")
    if role == "viewer":
        return []
    if row.external_system and status == "executed" and not row.external_record_id:
        actions.discard("verify")
    return sorted(actions)


def _work_item_snapshot(row: models.WorkItem) -> dict:
    return {
        "id": row.id,
        "type": row.type,
        "canonical_account_id": row.canonical_account_id,
        "related_signal_id": row.related_signal_id,
        "related_relationship_id": row.related_relationship_id,
        "related_opportunity_id": row.related_opportunity_id,
        "program_id": row.program_id,
        "score_snapshot_ids": row.score_snapshot_ids or [],
        "source_signal_ids": row.source_signal_ids or [],
        "supporting_evidence": row.supporting_evidence or [],
        "missing_information": row.missing_information or [],
        "dedupe_key": row.dedupe_key,
        "owner": row.owner,
        "priority": row.priority,
        "priority_status": row.priority_status or "available",
        "status": _canonical_work_status(row.status),
        "due_date": row.due_date.isoformat() if row.due_date else None,
        "description": row.description,
        "recommended_action": row.recommended_action,
        "generated_artifact_ref": row.generated_artifact_ref,
        "approval_state": row.approval_state,
        "execution_state": _canonical_execution_state(row.execution_state),
        "outcome": row.outcome,
        "outcome_category": row.outcome_category,
        "dismissal_reason": row.dismissal_reason,
        "rejection_reason": row.rejection_reason,
        "follow_up_date": row.follow_up_date.isoformat() if row.follow_up_date else None,
        "external_system": row.external_system,
        "external_record_id": row.external_record_id,
        "external_record_url": row.external_record_url,
        "execution_idempotency_key": row.execution_idempotency_key,
        "execution_error": row.execution_error,
        "audit_history": row.audit_history or [],
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


def _work_item_response(row: models.WorkItem, *, role: str = "viewer", notes: list[dict] | None = None) -> dict:
    return WorkItemResponse(
        **_work_item_snapshot(row),
        allowed_actions=_allowed_work_item_actions(row, role),
        notes=notes or [],
    ).model_dump()


def _append_work_item_audit(
    row: models.WorkItem,
    *,
    action: str,
    actor: str,
    before: dict | None,
    after: dict | None,
    note: str | None = None,
    reason: str | None = None,
    metadata: dict | None = None,
) -> None:
    audit = list(row.audit_history or [])
    audit.append({
        "id": models._uuid(),
        "timestamp": datetime.now(UTC).isoformat(),
        "actor": actor,
        "actor_type": "system" if actor == "system" else "user",
        "action": action,
        "event_type": action,
        "from_state": before.get("status") if before else None,
        "to_state": after.get("status") if after else None,
        "note": note,
        "reason": reason,
        "metadata": metadata or {},
        "before": before,
        "after": after,
    })
    row.audit_history = audit


def _transition_error(row: models.WorkItem, action: str, role: str) -> dict:
    return {
        "code": "invalid_transition",
        "detail": f"Cannot apply action {action!r} from status {_canonical_work_status(row.status)!r}.",
        "current_status": _canonical_work_status(row.status),
        "allowed_actions": _allowed_work_item_actions(row, role),
    }


def _apply_work_item_transition(
    row: models.WorkItem,
    payload: WorkItemTransitionRequest,
    *,
    actor: str,
    actor_role: str,
) -> None:
    action = payload.action
    current = _canonical_work_status(row.status)
    if action in {"approve", "reject", "reopen"} and actor_role not in {"cro", "admin"}:
        raise PermissionError(f"Role '{actor_role}' cannot {action.replace('_', ' ')} work items.")
    if action == "dismiss" and not (payload.reason or "").strip():
        raise ValueError("Dismissal requires a reason.")
    if action == "reject" and not (payload.reason or "").strip():
        raise ValueError("Rejection requires a reason.")
    if action == "record_outcome" and not (payload.outcome or "").strip():
        raise ValueError("Recording an outcome requires an outcome.")
    if action == "verify" and row.external_system and not row.external_record_id:
        raise ValueError("External work cannot be verified until the external record has been verified.")

    next_status = WORK_ITEM_TRANSITIONS.get(current, {}).get(action)
    if next_status is None:
        raise LookupError(action)

    now = datetime.now(UTC)
    row.status = next_status
    if action == "request_approval":
        row.approval_state = "pending"
    elif action == "approve":
        row.approval_state = "approved"
    elif action == "reject":
        row.approval_state = "rejected"
        row.rejection_reason = payload.reason
    elif action == "start":
        row.execution_state = "pending"
    elif action == "mark_executed":
        row.execution_state = "executed"
    elif action == "verify":
        row.execution_state = "verified"
    elif action == "record_outcome":
        row.outcome = payload.outcome
        row.outcome_category = payload.outcome_category
        row.follow_up_date = _parse_datetime(payload.follow_up_date, "follow_up_date")
    elif action == "dismiss":
        row.dismissal_reason = payload.reason
        row.outcome = payload.reason
    elif action == "reopen":
        row.approval_state = "not_required"
        row.execution_state = "not_started"
        row.execution_error = None
        row.dismissal_reason = None
        row.rejection_reason = None
    row.updated_at = now


def _transition_event_type(action: str) -> str:
    return {
        "triage": "status_transition",
        "prepare": "status_transition",
        "request_approval": "approval_requested",
        "approve": "approved",
        "reject": "rejected",
        "start": "execution_started",
        "mark_executed": "execution_succeeded",
        "verify": "verification_succeeded",
        "record_outcome": "outcome_recorded",
        "dismiss": "dismissed",
        "close": "status_transition",
        "reopen": "reopened",
    }.get(action, "status_transition")


def _hubspot_task_record_url(task_id: str) -> str:
    return f"https://app.hubspot.com/tasks/{task_id}"


def _hubspot_list_record_url(list_id: str) -> str:
    return f"https://app.hubspot.com/lists/{list_id}"


def _hubspot_company_record_url(company_id: str) -> str:
    return f"https://app.hubspot.com/contacts/company/{company_id}"


def _hubspot_contact_record_url(contact_id: str) -> str:
    return f"https://app.hubspot.com/contacts/contact/{contact_id}"


def _hubspot_record_id(value: str, list_type: str) -> str:
    prefix = "hubspot-company-" if list_type == "company" else "hubspot-contact-"
    return value.removeprefix(prefix)


def _verified_list(created: dict, *, expected_id: str, expected_name: str) -> bool:
    list_id = created.get("listId") or created.get("id")
    name = created.get("name")
    return str(list_id) == expected_id and (name is None or str(name) == expected_name)


def _get_tenant_work_item(session, item_id: str, tenant_id: str) -> models.WorkItem | None:
    """Fetch a work item scoped to *tenant_id*.

    A row that exists but belongs to a different tenant returns None, the same
    as a missing row - the caller can't distinguish "not found" from "not
    yours," which is exactly the point (no cross-tenant existence leak).
    """
    row = session.get(models.WorkItem, item_id)
    if row is None or row.tenant_id != tenant_id:
        return None
    return row


def _deliverable_response(row: models.Deliverable) -> dict:
    return DeliverableResponse(
        id=row.id,
        type=row.type,
        title=row.title,
        canonical_account_id=row.canonical_account_id,
        program_id=row.program_id,
        trip_id=row.trip_id,
        entity_ids=row.entity_ids,
        document=row.document,
        created_at=row.created_at.isoformat(),
        updated_at=row.updated_at.isoformat(),
    ).model_dump()


def _get_tenant_deliverable(session, deliverable_id: str, tenant_id: str) -> models.Deliverable | None:
    """Fetch a deliverable scoped to *tenant_id* with the same non-disclosure
    behavior as work items."""
    row = session.get(models.Deliverable, deliverable_id)
    if row is None or row.tenant_id != tenant_id:
        return None
    return row


def _verified_task(task: dict, *, expected_subject: str, expected_body: str) -> bool:
    properties = task.get("properties") if isinstance(task.get("properties"), dict) else {}
    subject = properties.get("hs_task_subject") or task.get("hs_task_subject")
    body = properties.get("hs_task_body") or task.get("hs_task_body") or ""
    return bool(task.get("id")) and subject == expected_subject and expected_body in str(body)


def _nonempty_properties(values: dict[str, str]) -> dict[str, str]:
    return {key: str(value).strip() for key, value in values.items() if str(value).strip()}


def _hubspot_company_properties(values: dict[str, str]) -> dict[str, str]:
    props = _nonempty_properties(values)
    mapped = {
        "name": props.get("companyName") or props.get("name"),
        "domain": props.get("domain"),
        "website": props.get("website"),
        "phone": props.get("phone"),
        "city": props.get("city"),
        "state": props.get("state"),
        "country": props.get("country"),
    }
    return {key: value for key, value in mapped.items() if value}


def _hubspot_contact_properties(values: dict[str, str]) -> dict[str, str]:
    props = _nonempty_properties(values)
    first_name = props.get("firstName")
    last_name = props.get("lastName")
    contact_name = props.get("contactName")
    if contact_name and not (first_name or last_name):
        parts = contact_name.split()
        first_name = parts[0] if parts else None
        last_name = " ".join(parts[1:]) if len(parts) > 1 else None
    mapped = {
        "firstname": first_name,
        "lastname": last_name,
        "email": props.get("email"),
        "phone": props.get("phone"),
        "jobtitle": props.get("title"),
        "company": props.get("companyName"),
    }
    return {key: value for key, value in mapped.items() if value}


def _trace_id(item: dict) -> str | None:
    value = item.get("objectWriteTraceId") or item.get("traceId")
    if value:
        return str(value)
    context = item.get("context")
    if isinstance(context, dict):
        trace = context.get("objectWriteTraceId")
        if isinstance(trace, list):
            return str(trace[0]) if trace else None
        if trace:
            return str(trace)
    return None


def _batch_successes(payload: dict, fallback_trace_ids: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for index, item in enumerate(payload.get("results", [])):
        trace = _trace_id(item) or (fallback_trace_ids[index] if index < len(fallback_trace_ids) else None)
        if trace and item.get("id") is not None:
            result[trace] = str(item.get("id"))
    return result


def _batch_failures(payload: dict) -> dict[str, str]:
    result: dict[str, str] = {}
    for item in payload.get("errors", []) + payload.get("failures", []):
        trace = _trace_id(item)
        if trace:
            result[trace] = item.get("message") or item.get("error") or json.dumps(item, sort_keys=True)
    return result


def _sync_canonical_accounts(session_factory: sessionmaker, payload: dict, tenant_id: str = models.DEFAULT_TENANT_ID) -> None:
    records = payload.get("records")
    if not isinstance(records, list):
        return
    with session_factory() as session:
        for record in records:
            if not isinstance(record, dict):
                continue
            canonical_id = record.get("canonical_account_id")
            hubspot_company_id = record.get("hubspot_company_id") or record.get("hubspot_id")
            if not isinstance(canonical_id, str) or not canonical_id:
                continue
            if not isinstance(hubspot_company_id, str) or not hubspot_company_id:
                continue
            session.merge(models.CanonicalAccount(
                id=canonical_id,
                tenant_id=tenant_id,
                hubspot_company_id=hubspot_company_id,
                domains=record.get("domains") if isinstance(record.get("domains"), list) else [],
                aliases=record.get("aliases") if isinstance(record.get("aliases"), list) else [],
                facility_names=record.get("facility_names") if isinstance(record.get("facility_names"), list) else [],
                parent_id=record.get("parent_id") if isinstance(record.get("parent_id"), str) else None,
                subsidiary_ids=record.get("subsidiary_ids") if isinstance(record.get("subsidiary_ids"), list) else [],
                cage_code=record.get("cage_code") if isinstance(record.get("cage_code"), str) else None,
                uei=record.get("uei") if isinstance(record.get("uei"), str) else None,
                known_programs=record.get("known_programs") if isinstance(record.get("known_programs"), list) else [],
                known_customers=record.get("known_customers") if isinstance(record.get("known_customers"), list) else [],
            ))
        session.commit()


def _source_health(
    *,
    source_key: str,
    display_name: str,
    availability: str,
    record_count: int | None = None,
    last_successful_sync_at: str | None = None,
    last_attempt_at: str | None = None,
    freshness_threshold_minutes: int | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
) -> dict:
    now = datetime.now(UTC).isoformat()
    return {
        "sourceKey": source_key,
        "displayName": display_name,
        "availability": availability,
        "lastSuccessfulSyncAt": last_successful_sync_at,
        "lastAttemptAt": last_attempt_at or now,
        "freshnessThresholdMinutes": freshness_threshold_minutes,
        "recordCount": record_count,
        "errorCode": error_code,
        "errorMessage": error_message,
    }


def _artifact_event_type(item: dict) -> str:
    text_blob = " ".join(
        str(value)
        for value in [
            item.get("title"),
            item.get("raw_title"),
            item.get("confidence_note"),
            item.get("per_edition", {}).get("bd", {}).get("so_what") if isinstance(item.get("per_edition"), dict) else "",
            " ".join(item.get("per_edition", {}).get("bd", {}).get("categories", []))
            if isinstance(item.get("per_edition"), dict) and isinstance(item.get("per_edition", {}).get("bd", {}).get("categories"), list)
            else "",
        ]
        if value
    ).lower()
    if "funding" in text_blob or "capital raise" in text_blob or "valuation" in text_blob:
        return "funding_round"
    if "award" in text_blob or "contract" in text_blob:
        return "government_contract_award"
    if "supply chain" in text_blob or "supplier" in text_blob:
        return "supplier_delay"
    if "demand" in text_blob or "rfq" in text_blob or "rfp" in text_blob:
        return "demand_spike"
    return "unknown"


def _artifact_entities(item: dict) -> list[str]:
    raw = item.get("entities")
    if not isinstance(raw, list):
        return []
    names: list[str] = []
    for entry in raw:
        if isinstance(entry, dict) and isinstance(entry.get("name"), str) and entry["name"].strip():
            names.append(entry["name"].strip())
        elif isinstance(entry, str) and entry.strip():
            names.append(entry.strip())
    return list(dict.fromkeys(names))


def _artifact_signal(item: dict, run_at: str) -> dict | None:
    item_id = str(item.get("item_id") or "").strip()
    title = str(item.get("raw_title") or item.get("title") or "").strip()
    if not item_id or not title:
        return None
    per_edition = item.get("per_edition") if isinstance(item.get("per_edition"), dict) else {}
    bd = per_edition.get("bd") if isinstance(per_edition.get("bd"), dict) else {}
    relevance = bd.get("relevance_score") or item.get("importance_score") or 70
    try:
        confidence = max(0.0, min(float(relevance) / 100, 1.0))
    except (TypeError, ValueError):
        confidence = 0.7
    detected_at = str(item.get("published_at") or item.get("collected_at") or run_at)
    source_name = str(item.get("source_id") or "Monitor source")
    so_what = str(bd.get("so_what") or "").strip()
    now_what = str(bd.get("now_what") or "").strip()
    quote = so_what or title
    if now_what:
        quote = f"{quote} Action: {now_what}"
    url = str(item.get("url") or "").strip()
    return {
        "id": f"monitor-{item_id}",
        "event_type": _artifact_event_type(item),
        "entities": _artifact_entities(item) or [source_name],
        "subject_id": "__portfolio__",
        "scope": "market",
        "confidence": confidence,
        "source_quote": quote,
        "source_url": url or None,
        "document_url": url or None,
        "detected_at": detected_at,
        "artifact": {
            "item_id": item_id,
            "headline": title,
            "source_name": source_name,
            "source_date": detected_at,
            "run_at": run_at,
            "signal_type": _artifact_event_type(item),
            "relevance_score": relevance,
            "analysis_text": quote,
            "source_url": url or None,
            "dollar_figures": [],
            "affected_entities": _artifact_entities(item),
            "provenance": {"meta": {"run_at": run_at}, "item": item},
        },
    }


def _monitor_records(settings: Settings) -> tuple[list[dict], dict]:
    run_output_path = Path(settings.pipeline_output_dir) / "run_output.json"
    threshold = settings.monitor_stale_after_days * 24 * 60
    if not run_output_path.exists():
        return [], _source_health(
            source_key="monitor",
            display_name="Monitor pipeline",
            availability="unavailable",
            freshness_threshold_minutes=threshold,
            error_code="artifact_not_found",
            error_message=f"Missing monitor artifact: {run_output_path}",
        )
    try:
        run_output = json.loads(run_output_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [], _source_health(
            source_key="monitor",
            display_name="Monitor pipeline",
            availability="error",
            freshness_threshold_minutes=threshold,
            error_code="artifact_invalid",
            error_message=str(exc),
        )
    run_at = str(run_output.get("meta", {}).get("run_at") or datetime.now(UTC).isoformat())
    items = run_output.get("items") if isinstance(run_output.get("items"), list) else []
    signals = [signal for item in items if isinstance(item, dict) for signal in [_artifact_signal(item, run_at)] if signal]
    availability = "available"
    try:
        age = datetime.now(UTC) - datetime.fromisoformat(run_at.replace("Z", "+00:00"))
        if age.total_seconds() > threshold * 60:
            availability = "stale"
    except ValueError:
        availability = "error"
    return signals, _source_health(
        source_key="monitor",
        display_name="Monitor pipeline",
        availability=availability,
        record_count=len(signals),
        last_successful_sync_at=run_at if availability in {"available", "stale"} else None,
        freshness_threshold_minutes=threshold,
        error_code=None if availability != "error" else "invalid_run_timestamp",
        error_message=None if availability != "error" else f"Invalid monitor run timestamp: {run_at}",
    )


def _default_queue(settings: Settings) -> JobQueue:
    """InMemoryQueue for dev/test; a real Celery/Redis queue when configured.
    Imported lazily so the API process doesn't require Celery installed
    unless BTX_QUEUE_BACKEND=celery is actually set."""
    if settings.queue_backend != "celery":
        return InMemoryQueue()
    from btx_platform.workers import celery_app

    return CeleryQueue(celery_app)


def create_app(
    *,
    settings: Settings | None = None,
    session_factory: sessionmaker | None = None,
    queue: JobQueue | None = None,
    clerk_verifier: ClerkVerifier | None = None,
    rate_limiter: RateLimiter | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    configure_observability(settings)

    if session_factory is None:
        engine = make_engine(settings.database_url)
        if settings.env == "prod":
            # Prod must never fall back to create_all() - that would drift
            # from what alembic/versions/ tracks. Deploy runs
            # `alembic upgrade head` before the new code serves traffic.
            assert_schema_current(engine)
        else:
            init_db(engine)                   # dev/test convenience
        session_factory = make_session_factory(engine)

    app = FastAPI(title="BTX Engine - Integration Platform", version="0.1.0")
    app.state.settings = settings
    app.state.session_factory = session_factory
    app.state.queue = queue if queue is not None else _default_queue(settings)
    app.state.crm_cache = {}
    app.state.crm_list_idempotency = {}
    app.state.clerk_verifier = clerk_verifier or (
        ClerkVerifier(issuer=settings.clerk_issuer, audience=settings.clerk_audience)
        if settings.clerk_issuer
        else None
    )
    app.state.rate_limiter = rate_limiter or RateLimiter(
        max_requests=settings.rate_limit_max_requests,
        window_seconds=settings.rate_limit_window_seconds,
    )
    seed_engine_configs(session_factory)

    @app.middleware("http")
    async def assign_request_id(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or new_request_id()
        set_request_id(request_id)
        request.state.request_id = request_id
        try:
            response = await call_next(request)
        except Exception as exc:
            capture_exception(exc)
            raise
        response.headers["x-request-id"] = request_id
        return response

    @app.middleware("http")
    async def require_clerk_auth(request: Request, call_next):
        path = request.url.path
        if path in PUBLIC_PATHS or request.method == "OPTIONS" or path.startswith(WEBHOOK_PATH_PREFIX):
            return await call_next(request)

        verifier: ClerkVerifier | None = app.state.clerk_verifier
        if verifier is None:
            return JSONResponse(
                {"code": "auth_not_configured", "detail": "CLERK_SECRET_KEY / BTX_CLERK_ISSUER is required."},
                status_code=503,
            )
        token = bearer_token(request.headers.get("authorization"))
        if not token:
            return JSONResponse({"code": "unauthorized", "detail": "Missing bearer session token."}, status_code=401)
        try:
            auth = verifier.verify(token)
        except AuthError as exc:
            return JSONResponse({"code": exc.code, "detail": exc.detail}, status_code=exc.status_code)
        request.state.auth = auth

        if request.method in MUTATING_METHODS:
            if not auth.has_role(MUTATING_ROUTE_MIN_ROLE):
                return JSONResponse(
                    {"code": "forbidden", "detail": f"Role '{auth.role}' cannot perform this action."},
                    status_code=403,
                )
            limiter: RateLimiter = app.state.rate_limiter
            if not limiter.allow(auth.user_id):
                return JSONResponse(
                    {"code": "rate_limited", "detail": "Too many requests. Try again shortly."},
                    status_code=429,
                )

        return await call_next(request)

    # Add CORS after custom middleware so it wraps auth/observability responses,
    # including early 401/403 JSON responses returned before route handlers run.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "OPTIONS"],
        allow_headers=["authorization", "content-type", "x-idempotency-key", settings.signature_header],
    )

    @app.get("/health")
    def health() -> dict:
        db_ok = True
        try:
            with session_factory() as session:
                session.execute(text("select 1"))
        except Exception:
            logger.exception("health.db_failed")
            db_ok = False
        detail = platform_health(settings, db_ok=db_ok)
        # Keep the original flat fields (existing callers/tests depend on
        # these) while adding the richer WP10-C freshness/integration detail.
        return {
            "status": "ok" if detail["status"] == "ok" else detail["status"],
            "env": settings.env,
            "version": app.version,
            "db": db_ok,
            "live": bool(settings.hubspot_access_token),
            "llm": bool(settings.anthropic_api_key),
            "auth": app.state.clerk_verifier is not None,
            "monitor": detail["monitor"],
            "integrations": detail["integrations"],
            "generated_at": detail["generated_at"],
        }

    @app.get("/artifacts/latest")
    def latest_artifacts() -> Response:
        output_dir = Path(settings.pipeline_output_dir)
        run_output_path = output_dir / "run_output.json"
        archive_path = output_dir / "archive.json"
        if not run_output_path.exists():
            return JSONResponse(
                {"code": "artifact_not_found", "detail": f"Missing monitor artifact: {run_output_path}"},
                status_code=404,
            )
        try:
            run_output = json.loads(run_output_path.read_text(encoding="utf-8"))
            archive = json.loads(archive_path.read_text(encoding="utf-8")) if archive_path.exists() else {"runs": [], "pinned": []}
        except json.JSONDecodeError as exc:
            return JSONResponse({"code": "artifact_invalid", "detail": str(exc)}, status_code=500)
        return JSONResponse({
            "data_provenance": "Monitor",
            "artifact_path": str(run_output_path),
            "archive_path": str(archive_path),
            "run_output": run_output,
            "archive": archive,
        })

    @app.get("/operating-baseline")
    def operating_baseline() -> Response:
        return JSONResponse({
            "data_provenance": "Backend source health",
            "crm": [],
            "capacity": [],
            "pipeline": {"records": [], "summary": {}, "source_mode": "not_connected"},
            "integrations": [],
            "assumptions": {
                "summary": "ERP, MES, and production operating data are not connected.",
                "source_mode": "not_connected",
            },
            "facilities": [],
            "opportunities": [],
        })

    def not_configured(service: str) -> JSONResponse:
        return JSONResponse(
            {
                "code": "not_configured",
                "detail": f"{service} is not configured.",
            },
            status_code=501,
        )

    def source_health_payload() -> list[dict]:
        if settings.hubspot_access_token:
            hubspot_health = _source_health(
                source_key="hubspot",
                display_name="HubSpot CRM",
                availability="available",
                freshness_threshold_minutes=15,
            )
        else:
            hubspot_health = _source_health(
                source_key="hubspot",
                display_name="HubSpot CRM",
                availability="not_configured",
                record_count=0,
                freshness_threshold_minutes=15,
                error_code="not_configured",
                error_message="BTX_HUBSPOT_ACCESS_TOKEN is not configured.",
            )
        _signals, monitor_health = _monitor_records(settings)
        return [
            hubspot_health,
            monitor_health,
            _source_health(
                source_key="operating",
                display_name="ERP / MES operating data",
                availability="not_configured",
                record_count=0,
                freshness_threshold_minutes=60,
                error_code="not_configured",
                error_message="Operating data ingestion is not connected.",
            ),
        ]

    def world_payload(request: Request) -> dict:
        tenant_id = _tenant_id(request)
        generated_at = datetime.now(UTC).isoformat()
        source_health: list[dict] = []
        accounts: list[dict] = []
        contacts: list[dict] = []
        opportunities: list[dict] = []
        if settings.hubspot_access_token:
            try:
                client = HubSpotClient(settings.hubspot_access_token)
                account_payload = hubspot_payload(client, "accounts")
                contact_payload = hubspot_payload(client, "contacts")
                deal_payload = hubspot_payload(client, "deals")
                accounts = account_payload.get("records") if isinstance(account_payload.get("records"), list) else []
                contacts = contact_payload.get("records") if isinstance(contact_payload.get("records"), list) else []
                opportunities = deal_payload.get("records") if isinstance(deal_payload.get("records"), list) else []
                _sync_canonical_accounts(session_factory, {"records": accounts}, tenant_id)
                source_health.append(_source_health(
                    source_key="hubspot",
                    display_name="HubSpot CRM",
                    availability="available",
                    record_count=len(accounts) + len(contacts) + len(opportunities),
                    last_successful_sync_at=generated_at,
                    freshness_threshold_minutes=15,
                ))
            except HubSpotError as exc:
                logger.warning("hubspot.world_snapshot_failed", extra={"status_code": exc.status_code})
                source_health.append(_source_health(
                    source_key="hubspot",
                    display_name="HubSpot CRM",
                    availability="error",
                    record_count=0,
                    freshness_threshold_minutes=15,
                    error_code="hubspot_error",
                    error_message=str(exc),
                ))
        else:
            source_health.append(_source_health(
                source_key="hubspot",
                display_name="HubSpot CRM",
                availability="not_configured",
                record_count=0,
                freshness_threshold_minutes=15,
                error_code="not_configured",
                error_message="BTX_HUBSPOT_ACCESS_TOKEN is not configured.",
            ))

        signals, monitor_health = _monitor_records(settings)
        source_health.append(monitor_health)
        source_health.append(_source_health(
            source_key="operating",
            display_name="ERP / MES operating data",
            availability="not_configured",
            record_count=0,
            freshness_threshold_minutes=60,
            error_code="not_configured",
            error_message="Operating data ingestion is not connected.",
        ))

        session = session_factory()
        try:
            ensure_default_scoring_config(session, tenant_id, _actor(request))
            source_data_version = f"{tenant_id}:{generated_at}"
            id_map = upsert_canonical_accounts(session, accounts, tenant_id)
            if accounts:
                accounts = remap_source_records(accounts, id_map)
                contacts = remap_child_company_ids(contacts, id_map)
                opportunities = remap_child_company_ids(opportunities, id_map)
            else:
                accounts = [
                    canonical_account_to_company(row)
                    for row in session.query(models.CanonicalAccount)
                    .filter(models.CanonicalAccount.tenant_id == tenant_id)
                    .order_by(models.CanonicalAccount.display_name.asc(), models.CanonicalAccount.legal_name.asc())
                    .all()
                ]

            for signal in signals:
                resolve_signal_relationships(session, tenant_id=tenant_id, signal=signal)
            session.commit()

            relationship_rows = (
                session.query(models.SignalAccountRelationship)
                .filter(models.SignalAccountRelationship.tenant_id == tenant_id)
                .order_by(models.SignalAccountRelationship.updated_at.desc(), models.SignalAccountRelationship.created_at.desc())
                .all()
            )
            signal_rows = (
                session.query(models.IntelligenceSignal)
                .filter(models.IntelligenceSignal.tenant_id == tenant_id)
                .order_by(models.IntelligenceSignal.updated_at.desc(), models.IntelligenceSignal.created_at.desc())
                .all()
            )
            relationships_by_signal: dict[str, list[models.SignalAccountRelationship]] = {}
            for relationship in relationship_rows:
                relationships_by_signal.setdefault(relationship.signal_id, []).append(relationship)
            signals = []
            for row in signal_rows:
                payload = signal_to_dict(row)
                rels = relationships_by_signal.get(row.id, [])
                payload["relationships"] = [relationship_to_dict(rel) for rel in rels]
                if rels and any(is_confirmed_account_signal(row, rel, MINIMUM_RELATIONSHIP_CONFIDENCE) for rel in rels):
                    payload["scope"] = "specific_account"
                    payload["subject_id"] = sorted(rel.canonical_account_id for rel in rels if is_confirmed_account_signal(row, rel, MINIMUM_RELATIONSHIP_CONFIDENCE))[0]
                elif rels:
                    payload["scope"] = "unlinked"
                signals.append(payload)

            scores = {
                "accountAttractiveness": [],
                "signalConfidence": [],
                "pursuitPwin": [],
                "deliveryFeasibility": [],
                "relationshipHealth": [],
                "actionPriority": [],
            }
            account_rows = (
                session.query(models.CanonicalAccount)
                .filter(models.CanonicalAccount.tenant_id == tenant_id)
                .order_by(models.CanonicalAccount.display_name.asc(), models.CanonicalAccount.legal_name.asc())
                .all()
            )
            for account in account_rows:
                account_scores = score_account(session, tenant_id, account, source_data_version)
                for family, result in account_scores.items():
                    snapshot = persist_score_snapshot(
                        session,
                        tenant_id,
                        entity_type="account",
                        entity_id=account.id,
                        score_family=family,
                        result=result,
                    )
                    scores[family].append(score_snapshot_summary(snapshot))
            for signal_row in signal_rows:
                result = signal_confidence(signal_row, relationships_by_signal.get(signal_row.id, []), source_data_version)
                snapshot = persist_score_snapshot(
                    session,
                    tenant_id,
                    entity_type="signal",
                    entity_id=signal_row.id,
                    score_family="signalConfidence",
                    result=result,
                )
                scores["signalConfidence"].append(score_snapshot_summary(snapshot))
            session.commit()

            work_items = [
                _work_item_response(row, role=_role(request))
                for row in session.query(models.WorkItem)
                .filter(models.WorkItem.tenant_id == tenant_id)
                .order_by(models.WorkItem.updated_at.desc(), models.WorkItem.created_at.desc())
                .all()
            ]
            deliverables = [
                {
                    "id": row.id,
                    "type": row.type,
                    "title": row.title,
                    "canonical_account_id": row.canonical_account_id,
                    "program_id": row.program_id,
                    "created_at": row.created_at.isoformat(),
                    "updated_at": row.updated_at.isoformat(),
                }
                for row in session.query(models.Deliverable)
                .filter(models.Deliverable.tenant_id == tenant_id)
                .order_by(models.Deliverable.updated_at.desc(), models.Deliverable.created_at.desc())
                .all()
            ]
            score_history = [
                score_snapshot_summary(row)
                for row in session.query(models.ScoreSnapshot)
                .filter(models.ScoreSnapshot.tenant_id == tenant_id)
                .order_by(models.ScoreSnapshot.calculated_at.desc())
                .limit(50)
                .all()
            ]
            canonical_accounts = [canonical_account_to_company(row) for row in account_rows]
            account_identifiers = [
                {
                    "id": row.id,
                    "tenantId": row.tenant_id,
                    "canonicalAccountId": row.canonical_account_id,
                    "identifierType": row.identifier_type,
                    "normalizedValue": row.normalized_value,
                    "originalValue": row.original_value,
                    "sourceClassification": row.source_classification,
                    "verified": row.verified,
                    "verifiedByUserId": row.verified_by_user_id,
                    "verifiedAt": row.verified_at.isoformat() if row.verified_at else None,
                    "createdAt": row.created_at.isoformat(),
                    "updatedAt": row.updated_at.isoformat(),
                }
                for row in session.query(models.AccountIdentifier)
                .filter(models.AccountIdentifier.tenant_id == tenant_id)
                .order_by(models.AccountIdentifier.identifier_type.asc(), models.AccountIdentifier.normalized_value.asc())
                .all()
            ]
        finally:
            session.close()

        return {
            "tenant": {"id": tenant_id, "displayName": "BTX Precision"},
            "accounts": accounts,
            "canonicalAccounts": canonical_accounts,
            "accountIdentifiers": account_identifiers,
            "contacts": contacts,
            "opportunities": opportunities,
            "programs": [],
            "signals": signals,
            "signalRelationships": [relationship_to_dict(row) for row in relationship_rows],
            "relationshipReview": {
                "records": [relationship_to_dict(row) for row in relationship_rows if row.review_status == "needs_review"],
                "minimumRelationshipConfidence": MINIMUM_RELATIONSHIP_CONFIDENCE,
            },
            "facilities": [],
            "operatingFacts": [],
            "capacity": None,
            "scores": scores,
            "scoreHistory": {
                "records": score_history,
            },
            "scoringConfiguration": {
                "version": SCORING_CONFIG_VERSION,
                "minimumRelationshipConfidence": MINIMUM_RELATIONSHIP_CONFIDENCE,
            },
            "workItems": work_items,
            "deliverables": deliverables,
            "sourceHealth": source_health,
            "generatedAt": generated_at,
            "dataVersion": source_data_version,
        }

    @app.get("/source-health")
    def source_health(request: Request) -> Response:
        return JSONResponse({"records": source_health_payload()})

    @app.get("/world-snapshot")
    def world_snapshot(request: Request) -> Response:
        return JSONResponse(world_payload(request))

    @app.get("/signal-relationships/review")
    def relationship_review_queue(request: Request) -> Response:
        tenant_id = _tenant_id(request)
        session = session_factory()
        try:
            rows = (
                session.query(models.SignalAccountRelationship)
                .filter(
                    models.SignalAccountRelationship.tenant_id == tenant_id,
                    models.SignalAccountRelationship.review_status == "needs_review",
                )
                .order_by(models.SignalAccountRelationship.updated_at.desc(), models.SignalAccountRelationship.created_at.desc())
                .all()
            )
            return JSONResponse({"records": [relationship_to_dict(row) for row in rows]})
        finally:
            session.close()

    @app.patch("/signal-relationships/{relationship_id}")
    def patch_signal_relationship(relationship_id: str, payload: dict, request: Request) -> Response:
        action = str(payload.get("action") or "").strip()
        note = str(payload.get("note") or "").strip() or None
        if action not in {"confirm", "reject", "reopen", "mark_market", "mark_program"}:
            return JSONResponse({"code": "validation_error", "detail": "action must be confirm, reject, reopen, mark_market, or mark_program."}, status_code=422)
        tenant_id = _tenant_id(request)
        actor = _actor(request)
        session = session_factory()
        try:
            row = (
                session.query(models.SignalAccountRelationship)
                .filter(
                    models.SignalAccountRelationship.tenant_id == tenant_id,
                    models.SignalAccountRelationship.id == relationship_id,
                )
                .one_or_none()
            )
            if row is None:
                return JSONResponse({"code": "not_found", "detail": f"No relationship {relationship_id}."}, status_code=404)
            before = relationship_to_dict(row)
            signal = session.get(models.IntelligenceSignal, row.signal_id)
            if action == "confirm":
                if not row.evidence_ids:
                    return JSONResponse({"code": "validation_error", "detail": "Cannot confirm a relationship without evidence."}, status_code=422)
                row.review_status = "confirmed"
                row.match_method = "manual_confirmation" if row.match_method not in {"exact_public_identifier", "exact_uei", "exact_cage_code", "exact_hubspot_company_id", "exact_verified_domain", "exact_legal_name"} else row.match_method
                row.confidence = max(float(row.confidence or 0), MINIMUM_RELATIONSHIP_CONFIDENCE)
                row.confirmed_by_user_id = actor
                row.confirmed_at = datetime.now(UTC)
                row.rejected_by_user_id = None
                row.rejected_at = None
                row.rejection_reason = None
                if signal is not None:
                    raw = dict(signal.raw_payload or {})
                    raw["scope"] = "specific_account"
                    raw["subject_id"] = row.canonical_account_id
                    signal.scope = "specific_account"
                    signal.raw_payload = raw
                    signal.updated_at = datetime.now(UTC)
            elif action == "reject":
                row.review_status = "rejected"
                row.rejected_by_user_id = actor
                row.rejected_at = datetime.now(UTC)
                row.rejection_reason = note or "Rejected during relationship review."
            elif action == "reopen":
                row.review_status = "needs_review"
                row.rejected_by_user_id = None
                row.rejected_at = None
                row.rejection_reason = None
            else:
                row.review_status = "rejected"
                row.rejected_by_user_id = actor
                row.rejected_at = datetime.now(UTC)
                row.rejection_reason = f"Marked signal as {action.removeprefix('mark_')}-level."
                if signal is not None:
                    raw = dict(signal.raw_payload or {})
                    raw["scope"] = action.removeprefix("mark_")
                    raw["subject_id"] = "__portfolio__"
                    signal.scope = raw["scope"]
                    signal.raw_payload = raw
                    signal.updated_at = datetime.now(UTC)
            row.last_validated_at = datetime.now(UTC)
            row.updated_at = datetime.now(UTC)
            after = relationship_to_dict(row)
            session.add(models.RelationshipAuditEvent(
                tenant_id=tenant_id,
                relationship_id=row.id,
                action=action,
                actor_user_id=actor,
                note=note,
                before=before,
                after=after,
            ))
            if action in {"confirm", "reject", "mark_market", "mark_program"}:
                for item in (
                    session.query(models.WorkItem)
                    .filter(models.WorkItem.tenant_id == tenant_id, models.WorkItem.related_relationship_id == row.id)
                    .all()
                ):
                    if _canonical_work_status(item.status) not in {"dismissed", "closed"}:
                        before_item = _work_item_snapshot(item)
                        item.status = "closed"
                        item.execution_state = "verified"
                        item.outcome = f"Relationship review {action}."
                        item.updated_at = datetime.now(UTC)
                        _append_work_item_audit(item, action=f"relationship_{action}", actor=actor, before=before_item, after=_work_item_snapshot(item))
            session.commit()
            session.refresh(row)
            return JSONResponse(relationship_to_dict(row))
        finally:
            session.close()

    def cached_hubspot_response(kind: str, tenant_id: str) -> Response:
        if not settings.hubspot_access_token:
            return not_configured(f"HubSpot {kind}")
        now = time.monotonic()
        cache: dict[str, tuple[float, dict]] = app.state.crm_cache
        cached = cache.get(kind)
        if cached and cached[0] > now:
            return JSONResponse(cached[1])
        try:
            payload = hubspot_payload(HubSpotClient(settings.hubspot_access_token), kind)  # type: ignore[arg-type]
        except HubSpotError as exc:
            logger.warning("hubspot.read_failed", extra={"kind": kind, "status_code": exc.status_code})
            return JSONResponse({"code": "hubspot_error", "detail": str(exc)}, status_code=502)
        if kind == "accounts":
            _sync_canonical_accounts(session_factory, payload, tenant_id)
        cache[kind] = (now + CRM_CACHE_TTL_SECONDS, payload)
        return JSONResponse(payload)

    @app.post("/llm")
    async def llm_proxy(request: Request) -> Response:
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > settings.llm_max_body_bytes:
                    return JSONResponse({"code": "payload_too_large", "detail": "LLM request too large."}, status_code=413)
            except ValueError:
                return JSONResponse({"code": "invalid_request", "detail": "Invalid content-length."}, status_code=400)
        raw = await request.body()
        if len(raw) > settings.llm_max_body_bytes:
            return JSONResponse({"code": "payload_too_large", "detail": "LLM request too large."}, status_code=413)
        try:
            payload = LlmProxyRequest.model_validate_json(raw)
        except ValidationError as exc:
            return JSONResponse({"code": "invalid_request", "detail": exc.errors()}, status_code=422)
        try:
            text_out = await call_anthropic(payload, settings)
        except LlmProviderError as exc:
            return JSONResponse({"code": "llm_provider_error", "detail": exc.detail}, status_code=exc.status_code)
        return JSONResponse({"text": text_out})

    @app.get("/crm/accounts")
    def crm_accounts(request: Request) -> Response:
        return cached_hubspot_response("accounts", _tenant_id(request))

    @app.get("/crm/deals")
    def crm_deals(request: Request) -> Response:
        return cached_hubspot_response("deals", _tenant_id(request))

    @app.get("/crm/contacts")
    def crm_contacts(request: Request) -> Response:
        return cached_hubspot_response("contacts", _tenant_id(request))

    @app.post("/crm/company-search")
    def crm_company_search(payload: HubSpotCompanySearchRequest) -> Response:
        if not settings.hubspot_access_token:
            return not_configured("HubSpot company search")
        try:
            client = HubSpotClient(settings.hubspot_access_token)
            companies = client.search_companies(payload.query, limit=payload.limit)
            records = map_companies(companies, {}, {}, {})
        except HubSpotError as exc:
            logger.warning("hubspot.company_search_failed", extra={"status_code": exc.status_code})
            return JSONResponse({"code": "hubspot_error", "detail": str(exc)}, status_code=502)
        return JSONResponse({"data_provenance": "HubSpot", "records": records})

    @app.post("/crm/lists")
    def create_hubspot_list(payload: HubSpotListCreateRequest, request: Request) -> Response:
        if not settings.hubspot_access_token:
            return not_configured("HubSpot list creation")
        idempotency_key = request.headers.get(settings.idempotency_header)
        if idempotency_key:
            cached = app.state.crm_list_idempotency.get(("create", idempotency_key))
            if cached:
                return JSONResponse({**cached, "duplicate": True})
        try:
            client = HubSpotClient(settings.hubspot_access_token)
            list_id = client.create_list(payload.name, payload.list_type)
            verified = client.get_list(list_id)
            if not _verified_list(verified, expected_id=list_id, expected_name=payload.name):
                raise HubSpotError(method="GET", url=f"https://api.hubapi.com/crm/lists/2026-03/{list_id}", status_code=502, body="Created list did not verify with expected fields")
        except HubSpotError as exc:
            logger.warning("hubspot.list_create_failed", extra={"status_code": exc.status_code, "name": payload.name})
            return JSONResponse({"code": "hubspot_error", "detail": str(exc)}, status_code=502)
        body = {
            "status": "verified",
            "duplicate": False,
            "idempotency_key": idempotency_key,
            "list": {
                "id": list_id,
                "name": payload.name,
                "list_type": payload.list_type,
                "record_url": _hubspot_list_record_url(list_id),
                "verified": True,
            },
        }
        if idempotency_key:
            app.state.crm_list_idempotency[("create", idempotency_key)] = body
        return JSONResponse(body)

    @app.put("/crm/lists/{list_id}/records")
    def add_hubspot_list_records(list_id: str, payload: HubSpotListAddRecordsRequest, request: Request) -> Response:
        if not settings.hubspot_access_token:
            return not_configured("HubSpot list membership")
        idempotency_key = request.headers.get(settings.idempotency_header)
        normalized_ids = [_hubspot_record_id(item, payload.list_type) for item in payload.record_ids]
        try:
            client = HubSpotClient(settings.hubspot_access_token)
            client.add_records_to_list(list_id, normalized_ids)
            memberships = set(client.get_list_memberships(list_id))
            missing = [record_id for record_id in normalized_ids if record_id not in memberships]
            if missing:
                raise HubSpotError(method="GET", url=f"https://api.hubapi.com/crm/lists/2026-03/{list_id}/memberships", status_code=502, body=f"List membership readback missing records: {', '.join(missing)}")
        except HubSpotError as exc:
            logger.warning("hubspot.list_membership_failed", extra={"status_code": exc.status_code, "list_id": list_id})
            return JSONResponse({"code": "hubspot_error", "detail": str(exc)}, status_code=502)
        return JSONResponse({
            "status": "verified",
            "duplicate": False,
            "idempotency_key": idempotency_key,
            "list": {
                "id": list_id,
                "list_type": payload.list_type,
                "record_ids": normalized_ids,
                "record_url": _hubspot_list_record_url(list_id),
                "verified": True,
            },
        })

    @app.post("/crm/import/prospects")
    def import_prospects_to_hubspot(payload: HubSpotImportRequest, request: Request) -> Response:
        if not settings.hubspot_access_token:
            return not_configured("HubSpot prospect import")
        idempotency_key = request.headers.get(settings.idempotency_header)
        if idempotency_key:
            cached = app.state.crm_list_idempotency.get(("import_prospects", idempotency_key))
            if cached:
                return JSONResponse(cached)

        row_results: dict[str, dict] = {
            row.row_id: {"row_id": row.row_id, "status": "pending", "company_id": None, "contact_id": None, "company_record_url": None, "contact_record_url": None, "reason": None}
            for row in payload.rows
        }
        company_inputs: list[dict] = []
        contact_inputs: list[dict] = []
        for row in payload.rows:
            company_props = _hubspot_company_properties(row.company)
            if not (company_props.get("name") or company_props.get("domain")):
                row_results[row.row_id] = {
                    "row_id": row.row_id,
                    "status": "failed",
                    "company_id": None,
                    "contact_id": None,
                    "company_record_url": None,
                    "contact_record_url": None,
                    "reason": "Missing required company name or domain.",
                }
                continue
            company_inputs.append({"objectWriteTraceId": row.row_id, "properties": company_props})
            contact_props = _hubspot_contact_properties(row.contact or {})
            if contact_props:
                contact_inputs.append({"objectWriteTraceId": row.row_id, "properties": contact_props})

        client = HubSpotClient(settings.hubspot_access_token)
        try:
            company_payload = client.create_companies_batch(company_inputs) if company_inputs else {"results": []}
            company_successes = _batch_successes(company_payload, [item["objectWriteTraceId"] for item in company_inputs])
            company_failures = _batch_failures(company_payload)
        except HubSpotError as exc:
            logger.warning("hubspot.import_companies_failed", extra={"status_code": exc.status_code})
            for item in company_inputs:
                row_results[item["objectWriteTraceId"]] = {
                    **row_results[item["objectWriteTraceId"]],
                    "status": "failed",
                    "reason": str(exc),
                }
            company_successes = {}
            company_failures = {}

        for row_id, company_id in company_successes.items():
            row_results[row_id]["company_id"] = company_id
            row_results[row_id]["company_record_url"] = _hubspot_company_record_url(company_id)
            row_results[row_id]["status"] = "succeeded"
        for row_id, reason in company_failures.items():
            row_results[row_id]["status"] = "failed"
            row_results[row_id]["reason"] = reason
        for item in company_inputs:
            row_id = item["objectWriteTraceId"]
            if row_results[row_id]["status"] == "pending":
                row_results[row_id]["status"] = "failed"
                row_results[row_id]["reason"] = "HubSpot returned no result for this row."

        confirmed_contact_inputs = [item for item in contact_inputs if row_results[item["objectWriteTraceId"]]["status"] == "succeeded"]
        try:
            contact_payload = client.create_contacts_batch(confirmed_contact_inputs) if confirmed_contact_inputs else {"results": []}
            contact_successes = _batch_successes(contact_payload, [item["objectWriteTraceId"] for item in confirmed_contact_inputs])
            contact_failures = _batch_failures(contact_payload)
        except HubSpotError as exc:
            logger.warning("hubspot.import_contacts_failed", extra={"status_code": exc.status_code})
            contact_successes = {}
            contact_failures = {item["objectWriteTraceId"]: str(exc) for item in confirmed_contact_inputs}

        for row_id, contact_id in contact_successes.items():
            row_results[row_id]["contact_id"] = contact_id
            row_results[row_id]["contact_record_url"] = _hubspot_contact_record_url(contact_id)
        for row_id, reason in contact_failures.items():
            if row_results[row_id]["status"] == "succeeded":
                row_results[row_id]["status"] = "partial"
                row_results[row_id]["reason"] = f"Company created; contact failed: {reason}"

        rows = list(row_results.values())
        body = {
            "status": "completed",
            "summary": {
                "succeeded": sum(1 for row in rows if row["status"] == "succeeded"),
                "partial": sum(1 for row in rows if row["status"] == "partial"),
                "failed": sum(1 for row in rows if row["status"] == "failed"),
            },
            "rows": rows,
            "idempotency_key": idempotency_key,
        }
        if idempotency_key:
            app.state.crm_list_idempotency[("import_prospects", idempotency_key)] = body
        return JSONResponse(body)

    @app.post("/crm/task")
    def create_crm_task(payload: CrmTaskRequest, request: Request) -> Response:
        if not settings.hubspot_access_token:
            return not_configured("HubSpot task creation")
        body = payload.body or payload.evidence or ""
        associations = _task_associations(payload)
        idempotency_key = request.headers.get(settings.idempotency_header)
        if idempotency_key:
            cached = app.state.crm_list_idempotency.get(("crm_task", idempotency_key))
            if cached:
                return JSONResponse({**cached, "duplicate": True})
        try:
            result = HubSpotClient(settings.hubspot_access_token).create_task(
                subject=payload.title,
                body=body,
                timestamp=payload.due_at or _three_business_days_from_now(),
                owner_id=payload.owner,
                idempotency_key=idempotency_key,
                associations=associations,
            )
        except HubSpotError as exc:
            logger.warning("hubspot.task_failed", extra={"status_code": exc.status_code, "subject": payload.title})
            return JSONResponse({"code": "hubspot_error", "detail": str(exc)}, status_code=502)
        task_id = str(result.get("id"))
        record_url = f"https://app.hubspot.com/tasks/{task_id}"
        audit_associations = [association.__dict__ for association in associations]
        session = session_factory()
        try:
            session.add(models.HubSpotTaskAudit(
                tenant_id=_tenant_id(request),
                subject=payload.title,
                hubspot_task_id=task_id,
                record_url=record_url,
                idempotency_key=idempotency_key,
                associations={"records": audit_associations},
            ))
            session.commit()
        finally:
            session.close()
        logger.info(
            "hubspot.task_created",
            extra={
                "timestamp": datetime.now(UTC).isoformat(),
                "subject": payload.title,
                "task_id": task_id,
                "idempotency_key": idempotency_key,
                "associations": audit_associations,
            },
        )
        response_body = {
            "status": "created",
            "duplicate": False,
            "idempotency_key": idempotency_key,
            "id": task_id,
            "record_url": record_url,
            "title": payload.title,
        }
        if idempotency_key:
            app.state.crm_list_idempotency[("crm_task", idempotency_key)] = response_body
        return JSONResponse(response_body)

    @app.post("/work-items/{item_id}/preview/hubspot-task")
    def preview_work_item_hubspot_task(item_id: str, payload: dict | None, request: Request) -> Response:
        tenant_id = _tenant_id(request)
        session = session_factory()
        try:
            row = _get_tenant_work_item(session, item_id, tenant_id)
            if row is None:
                return JSONResponse({"code": "not_found", "detail": f"No work item {item_id}."}, status_code=404)
            values = payload or {}
            idempotency_key = request.headers.get(settings.idempotency_header) or f"work-item:{item_id}:hubspot-task"
            task_subject = str(values.get("task_text") or row.recommended_action).strip()
            evidence = str(values.get("evidence") or row.generated_artifact_ref or ", ".join(row.source_signal_ids or [])).strip()
            company_id = str(values.get("company_id") or row.canonical_account_id or "").strip() or None
            due_at = str(values.get("due_at") or (row.due_date.isoformat() if row.due_date else _three_business_days_from_now()))
            body = str(values.get("body") or "\n".join([task_subject, f"Evidence: {evidence}" if evidence else ""]).strip())
            associations = _task_associations_from_values(
                company_id=company_id,
                contact_id=values.get("contact_id") if isinstance(values.get("contact_id"), str) else None,
                deal_id=values.get("deal_id") if isinstance(values.get("deal_id"), str) else None,
            )
            return JSONResponse({
                "status": "preview",
                "integration_availability": "configured_unverified" if settings.hubspot_access_token else "not_configured",
                "can_execute": bool(settings.hubspot_access_token) and row.approval_state == "approved" and _has_role(request, "cro"),
                "work_item": _work_item_response(row, role=_role(request), notes=_notes_for_work_item(session, row)),
                "hubspot_task": {
                    "canonical_account_id": row.canonical_account_id,
                    "company_id": company_id,
                    "owner_id": values.get("owner_id") or row.owner,
                    "due_at": due_at,
                    "task_type": "TODO",
                    "subject": task_subject,
                    "body": body,
                    "supporting_evidence": row.supporting_evidence or [],
                    "source_signal_ids": row.source_signal_ids or [],
                    "related_work_item_id": row.id,
                    "idempotency_key": idempotency_key,
                    "associations": [association.__dict__ for association in associations],
                },
            })
        finally:
            session.close()

    @app.post("/work-items/{item_id}/execute/hubspot-task")
    def execute_work_item_hubspot_task(item_id: str, payload: HubSpotTaskExecuteRequest, request: Request) -> Response:
        if not payload.confirmed:
            return JSONResponse({"code": "confirmation_required", "detail": "Explicit confirmation is required before writing to HubSpot."}, status_code=422)
        if not settings.hubspot_access_token:
            return not_configured("HubSpot task creation")
        if not _has_role(request, "cro"):
            return _forbidden("Only CRO or admin users can execute approved HubSpot tasks.")

        idempotency_key = request.headers.get(settings.idempotency_header) or f"work-item:{item_id}:hubspot-task"
        actor = _actor(request)
        tenant_id = _tenant_id(request)
        session = session_factory()
        try:
            row = _get_tenant_work_item(session, item_id, tenant_id)
            if row is None:
                return JSONResponse({"code": "not_found", "detail": f"No work item {item_id}."}, status_code=404)

            if row.external_system == "hubspot" and row.external_record_id:
                if row.execution_idempotency_key == idempotency_key:
                    return JSONResponse({
                        "status": "verified",
                        "duplicate": True,
                        "idempotency_key": idempotency_key,
                        "work_item": _work_item_response(row, role=_role(request), notes=_notes_for_work_item(session, row)),
                        "hubspot_task": {
                            "id": row.external_record_id,
                            "record_url": row.external_record_url,
                        },
                    })
                return JSONResponse({
                    "code": "already_executed",
                    "detail": "This work item already has a verified HubSpot task. Use the original idempotency key to retry safely.",
                    "work_item": _work_item_response(row, role=_role(request), notes=_notes_for_work_item(session, row)),
                }, status_code=409)
            if row.approval_state != "approved" or _canonical_work_status(row.status) not in {"approved", "in_progress"}:
                return JSONResponse({
                    "code": "approval_required",
                    "detail": "HubSpot execution requires an approved work item.",
                    "work_item": _work_item_response(row, role=_role(request), notes=_notes_for_work_item(session, row)),
                }, status_code=409)

            task_subject = (payload.task_text or row.recommended_action).strip()
            evidence = payload.evidence or row.generated_artifact_ref or ""
            relationship_record = payload.relationship_record or {}
            evidence_lines = []
            if evidence:
                evidence_lines.append(f"Evidence: {evidence}")
            if row.source_signal_ids:
                evidence_lines.append(f"Source signals: {', '.join(row.source_signal_ids)}")
            if relationship_record:
                evidence_lines.append(f"Relationship record: {json.dumps(relationship_record, sort_keys=True)}")
            task_body = (payload.body or "\n".join([task_subject, *evidence_lines])).strip()
            company_id = payload.company_id or row.canonical_account_id
            owner_id = payload.owner_id or row.owner
            due_at = payload.due_at or (row.due_date.isoformat() if row.due_date else _three_business_days_from_now())
            associations = _task_associations_from_values(
                company_id=company_id,
                contact_id=payload.contact_id,
                deal_id=payload.deal_id,
            )
            audit_associations = [association.__dict__ for association in associations]
            before = _work_item_snapshot(row)
            row.approval_state = "approved"
            row.status = "in_progress"
            row.execution_state = "pending"
            row.execution_idempotency_key = idempotency_key
            row.execution_error = None
            row.updated_at = datetime.now(UTC)
            _append_work_item_audit(
                row,
                action="hubspot_task_execute_started",
                actor=actor,
                before=before,
                after={
                    **_work_item_snapshot(row),
                    "hubspot_task_preview": {
                        "account": company_id,
                        "owner": owner_id,
                        "due_at": due_at,
                        "task_text": task_subject,
                        "evidence": evidence,
                        "relationship_record": relationship_record,
                        "associations": audit_associations,
                        "idempotency_key": idempotency_key,
                    },
                },
            )
            session.commit()
            session.refresh(row)

            client = HubSpotClient(settings.hubspot_access_token)
            try:
                result = client.create_task(
                    subject=task_subject,
                    body=task_body,
                    timestamp=due_at,
                    owner_id=owner_id,
                    idempotency_key=idempotency_key,
                    associations=associations,
                )
                task_id = str(result.get("id"))
                if not task_id:
                    raise HubSpotError(method="POST", url="https://api.hubapi.com/crm/v3/objects/tasks", status_code=502, body="HubSpot returned no task id")
                verified = client.get_task(task_id)
                if not _verified_task(verified, expected_subject=task_subject, expected_body=task_body):
                    raise HubSpotError(method="GET", url=f"https://api.hubapi.com/crm/v3/objects/tasks/{task_id}", status_code=502, body="Created task did not verify with expected fields")
            except HubSpotError as exc:
                before_failure = _work_item_snapshot(row)
                row.execution_state = "failed"
                row.execution_error = str(exc)
                row.updated_at = datetime.now(UTC)
                _append_work_item_audit(
                    row,
                    action="hubspot_task_execute_failed",
                    actor=actor,
                    before=before_failure,
                    after=_work_item_snapshot(row),
                )
                session.commit()
                session.refresh(row)
                logger.warning("hubspot.work_item_task_failed", extra={"status_code": exc.status_code, "work_item_id": item_id})
                return JSONResponse({"code": "hubspot_error", "detail": str(exc), "work_item": _work_item_response(row, role=_role(request), notes=_notes_for_work_item(session, row))}, status_code=502)

            record_url = _hubspot_task_record_url(task_id)
            before_success = _work_item_snapshot(row)
            row.status = "verified"
            row.execution_state = "verified"
            row.outcome = f"Created and verified HubSpot task {task_id}."
            row.external_system = "hubspot"
            row.external_record_id = task_id
            row.external_record_url = record_url
            row.execution_error = None
            row.updated_at = datetime.now(UTC)
            _append_work_item_audit(
                row,
                action="hubspot_task_execute_verified",
                actor=actor,
                before=before_success,
                after={
                    **_work_item_snapshot(row),
                    "hubspot_task": {
                        "id": task_id,
                        "record_url": record_url,
                        "verified": True,
                        "properties": verified.get("properties", {}),
                    },
                },
            )
            session.add(models.HubSpotTaskAudit(
                tenant_id=tenant_id,
                subject=task_subject,
                hubspot_task_id=task_id,
                record_url=record_url,
                idempotency_key=idempotency_key,
                associations={"records": audit_associations},
            ))
            session.commit()
            session.refresh(row)
            logger.info("hubspot.work_item_task_verified", extra={"work_item_id": item_id, "task_id": task_id, "idempotency_key": idempotency_key})
            return JSONResponse({
                "status": "verified",
                "duplicate": False,
                "idempotency_key": idempotency_key,
                "work_item": _work_item_response(row, role=_role(request), notes=_notes_for_work_item(session, row)),
                "hubspot_task": {
                    "id": task_id,
                    "record_url": record_url,
                    "verified": True,
                },
            })
        finally:
            session.close()

    @app.post("/email/send")
    def send_email(payload: EmailSendRequest) -> Response:
        allowed = {email.strip().lower() for email in settings.gmail_allowlist.split(",") if email.strip()}
        if payload.to.lower() not in allowed:
            return JSONResponse(
                {"code": "recipient_not_allowed", "detail": "Email sends are restricted to the configured demo allowlist."},
                status_code=403,
            )
        return not_configured("Email send")

    @app.post("/calendar/event")
    def create_calendar_event(payload: CalendarEventRequest) -> Response:
        return not_configured("Calendar event creation")

    @app.post("/deliverables")
    def create_deliverable(payload: DeliverableCreate, request: Request) -> Response:
        session = session_factory()
        try:
            row = models.Deliverable(
                tenant_id=_tenant_id(request),
                type=payload.type,
                title=payload.title,
                canonical_account_id=payload.canonical_account_id,
                program_id=payload.program_id,
                trip_id=payload.trip_id,
                entity_ids=payload.entity_ids,
                document=payload.document,
            )
            session.add(row)
            session.commit()
            session.refresh(row)
            logger.info("mutation.deliverable_create", extra={"deliverable_id": row.id, "type": row.type})
            return JSONResponse(_deliverable_response(row), status_code=201)
        finally:
            session.close()

    @app.get("/deliverables")
    def list_deliverables(
        request: Request,
        account: str | None = None,
        type: str | None = None,
    ) -> Response:
        session = session_factory()
        try:
            query = session.query(models.Deliverable).filter(models.Deliverable.tenant_id == _tenant_id(request))
            if type:
                query = query.filter(models.Deliverable.type == type)
            rows = query.order_by(models.Deliverable.updated_at.desc(), models.Deliverable.created_at.desc()).all()
            if account:
                # entity_ids is a JSON list; membership is checked in Python for cross-dialect behavior.
                rows = [
                    row for row in rows
                    if row.canonical_account_id == account or (row.entity_ids and account in row.entity_ids)
                ]
            return JSONResponse({"records": [_deliverable_response(row) for row in rows]})
        finally:
            session.close()

    @app.get("/deliverables/{deliverable_id}")
    def get_deliverable(deliverable_id: str, request: Request) -> Response:
        session = session_factory()
        try:
            row = _get_tenant_deliverable(session, deliverable_id, _tenant_id(request))
            if row is None:
                return JSONResponse({"code": "not_found", "detail": f"No deliverable {deliverable_id}."}, status_code=404)
            return JSONResponse(_deliverable_response(row))
        finally:
            session.close()

    @app.patch("/deliverables/{deliverable_id}")
    def patch_deliverable(deliverable_id: str, payload: DeliverablePatch, request: Request) -> Response:
        session = session_factory()
        try:
            row = _get_tenant_deliverable(session, deliverable_id, _tenant_id(request))
            if row is None:
                return JSONResponse({"code": "not_found", "detail": f"No deliverable {deliverable_id}."}, status_code=404)
            fields = payload.model_fields_set
            if "type" in fields and payload.type is not None:
                row.type = payload.type
            if "title" in fields and payload.title is not None:
                row.title = payload.title
            if "canonical_account_id" in fields:
                row.canonical_account_id = payload.canonical_account_id
            if "program_id" in fields:
                row.program_id = payload.program_id
            if "trip_id" in fields:
                row.trip_id = payload.trip_id
            if "entity_ids" in fields:
                row.entity_ids = payload.entity_ids
            if "document" in fields and payload.document is not None:
                row.document = payload.document
            row.updated_at = datetime.now(UTC)
            session.commit()
            session.refresh(row)
            logger.info("mutation.deliverable_patch", extra={"deliverable_id": row.id})
            return JSONResponse(_deliverable_response(row))
        finally:
            session.close()

    @app.post("/work-items")
    def create_work_item(payload: WorkItemCreate, request: Request) -> Response:
        try:
            due_date = _parse_datetime(payload.due_date, "due_date")
            follow_up_date = _parse_datetime(payload.follow_up_date, "follow_up_date")
        except ValueError as exc:
            return JSONResponse({"code": "validation_error", "detail": str(exc)}, status_code=422)
        session = session_factory()
        try:
            tenant_id = _tenant_id(request)
            if payload.dedupe_key:
                existing = (
                    session.query(models.WorkItem)
                    .filter(
                        models.WorkItem.tenant_id == tenant_id,
                        models.WorkItem.dedupe_key == payload.dedupe_key,
                        models.WorkItem.status.notin_(list(TERMINAL_WORK_ITEM_STATUSES)),
                    )
                    .order_by(models.WorkItem.updated_at.desc())
                    .first()
                )
                if existing is not None:
                    return JSONResponse(_work_item_response(existing, role=_role(request), notes=_notes_for_work_item(session, existing)), status_code=200)
            row = models.WorkItem(
                tenant_id=tenant_id,
                type=payload.type,
                canonical_account_id=payload.canonical_account_id,
                related_signal_id=payload.related_signal_id,
                related_relationship_id=payload.related_relationship_id,
                related_opportunity_id=payload.related_opportunity_id,
                program_id=payload.program_id,
                score_snapshot_ids=payload.score_snapshot_ids,
                source_signal_ids=payload.source_signal_ids,
                supporting_evidence=payload.supporting_evidence,
                missing_information=payload.missing_information,
                dedupe_key=payload.dedupe_key,
                owner=payload.owner,
                priority=payload.priority,
                status=_canonical_work_status(payload.status),
                due_date=due_date,
                recommended_action=payload.recommended_action,
                generated_artifact_ref=payload.generated_artifact_ref,
                approval_state=payload.approval_state,
                execution_state=_canonical_execution_state(payload.execution_state),
                outcome=payload.outcome,
                follow_up_date=follow_up_date,
                audit_history=[],
            )
            session.add(row)
            session.flush()
            _append_work_item_audit(
                row,
                action="create",
                actor=_actor(request),
                before=None,
                after=_work_item_snapshot(row),
            )
            session.commit()
            session.refresh(row)
            return JSONResponse(_work_item_response(row, role=_role(request), notes=[]), status_code=201)
        finally:
            session.close()

    @app.get("/work-items/{item_id}")
    def get_work_item(item_id: str, request: Request) -> Response:
        session = session_factory()
        try:
            row = _get_tenant_work_item(session, item_id, _tenant_id(request))
            if row is None:
                return JSONResponse({"code": "not_found", "detail": f"No work item {item_id}."}, status_code=404)
            return JSONResponse(_work_item_response(row, role=_role(request), notes=_notes_for_work_item(session, row)))
        finally:
            session.close()

    @app.get("/work-items")
    def list_work_items(
        request: Request,
        account: str | None = None,
        status: str | None = None,
        type: str | None = None,
        owner: str | None = None,
        priority: str | None = None,
        approval: str | None = None,
        execution: str | None = None,
        overdue: bool | None = None,
        program: str | None = None,
        due_from: str | None = None,
        due_to: str | None = None,
        view: str | None = None,
        sort: str | None = None,
    ) -> Response:
        try:
            due_from_dt = _parse_datetime(due_from, "due_from")
            due_to_dt = _parse_datetime(due_to, "due_to")
        except ValueError as exc:
            return JSONResponse({"code": "validation_error", "detail": str(exc)}, status_code=422)
        session = session_factory()
        try:
            query = session.query(models.WorkItem).filter(models.WorkItem.tenant_id == _tenant_id(request))
            if account:
                query = query.filter(models.WorkItem.canonical_account_id == account)
            if status:
                query = query.filter(models.WorkItem.status == _canonical_work_status(status))
            if type:
                query = query.filter(models.WorkItem.type == type)
            if owner:
                query = query.filter(models.WorkItem.owner.is_(None) if owner == "unassigned" else models.WorkItem.owner == owner)
            if priority:
                query = query.filter(models.WorkItem.priority == priority)
            if approval:
                query = query.filter(models.WorkItem.approval_state == approval)
            if execution:
                query = query.filter(models.WorkItem.execution_state == execution)
            if program:
                query = query.filter(models.WorkItem.program_id == program)
            if due_from_dt:
                query = query.filter(models.WorkItem.due_date >= due_from_dt)
            if due_to_dt:
                query = query.filter(models.WorkItem.due_date <= due_to_dt)
            now = datetime.now(UTC)
            if overdue:
                query = query.filter(models.WorkItem.due_date < now, models.WorkItem.status.notin_(list(TERMINAL_WORK_ITEM_STATUSES)))
            if view == "needs_attention":
                query = query.filter(
                    models.WorkItem.status.notin_(list(TERMINAL_WORK_ITEM_STATUSES)),
                    (models.WorkItem.priority.in_(["high", "urgent"])) | (models.WorkItem.due_date < now),
                )
            elif view == "prepared":
                query = query.filter(models.WorkItem.generated_artifact_ref.is_not(None))
            elif view == "needs_approval":
                query = query.filter(models.WorkItem.approval_state == "pending")
            elif view == "outcomes":
                query = query.filter(models.WorkItem.status.in_(["verified", "outcome_recorded", "dismissed", "closed"]))
            elif view == "what_changed":
                query = query.filter(models.WorkItem.updated_at >= now - timedelta(days=7))
            elif view is not None:
                return JSONResponse({"code": "validation_error", "detail": f"Unknown work item view {view}."}, status_code=422)
            if sort == "priority":
                query = query.order_by(models.WorkItem.priority.desc(), models.WorkItem.updated_at.desc())
            elif sort == "due_date":
                query = query.order_by(models.WorkItem.due_date.asc().nullslast(), models.WorkItem.updated_at.desc())
            elif sort == "account":
                query = query.order_by(models.WorkItem.canonical_account_id.asc().nullslast(), models.WorkItem.updated_at.desc())
            else:
                query = query.order_by(models.WorkItem.updated_at.desc(), models.WorkItem.created_at.desc())
            rows = query.all()
            return JSONResponse({"records": [_work_item_response(row, role=_role(request)) for row in rows]})
        finally:
            session.close()

    @app.patch("/work-items/{item_id}")
    def patch_work_item(item_id: str, payload: WorkItemPatch, request: Request) -> Response:
        session = session_factory()
        try:
            row = _get_tenant_work_item(session, item_id, _tenant_id(request))
            if row is None:
                return JSONResponse({"code": "not_found", "detail": f"No work item {item_id}."}, status_code=404)
            before = _work_item_snapshot(row)
            fields = payload.model_fields_set
            try:
                if "due_date" in fields:
                    row.due_date = _parse_datetime(payload.due_date, "due_date")
                if "follow_up_date" in fields:
                    row.follow_up_date = _parse_datetime(payload.follow_up_date, "follow_up_date")
            except ValueError as exc:
                return JSONResponse({"code": "validation_error", "detail": str(exc)}, status_code=422)
            if "owner" in fields:
                row.owner = payload.owner
            if "priority" in fields and payload.priority is not None:
                row.priority = payload.priority
            if "recommended_action" in fields and payload.recommended_action is not None:
                row.recommended_action = payload.recommended_action
            if "description" in fields:
                row.description = payload.description
            if "generated_artifact_ref" in fields:
                row.generated_artifact_ref = payload.generated_artifact_ref
            row.updated_at = datetime.now(UTC)
            after = _work_item_snapshot(row)
            _append_work_item_audit(row, action="updated", actor=_actor(request), before=before, after=after)
            session.commit()
            session.refresh(row)
            return JSONResponse(_work_item_response(row, role=_role(request), notes=_notes_for_work_item(session, row)))
        finally:
            session.close()

    @app.post("/work-items/{item_id}/transition")
    def transition_work_item(item_id: str, payload: WorkItemTransitionRequest, request: Request) -> Response:
        session = session_factory()
        try:
            row = _get_tenant_work_item(session, item_id, _tenant_id(request))
            if row is None:
                return JSONResponse({"code": "not_found", "detail": f"No work item {item_id}."}, status_code=404)
            role = _role(request)
            before = _work_item_snapshot(row)
            try:
                _apply_work_item_transition(row, payload, actor=_actor(request), actor_role=role)
            except PermissionError as exc:
                return _forbidden(str(exc))
            except LookupError:
                return JSONResponse(_transition_error(row, payload.action, role), status_code=409)
            except ValueError as exc:
                return JSONResponse({"code": "validation_error", "detail": str(exc), "allowed_actions": _allowed_work_item_actions(row, role)}, status_code=422)
            after = _work_item_snapshot(row)
            _append_work_item_audit(
                row,
                action=_transition_event_type(payload.action),
                actor=_actor(request),
                before=before,
                after=after,
                note=payload.note,
                reason=payload.reason,
                metadata={"command": payload.action, "outcome_category": payload.outcome_category},
            )
            session.commit()
            session.refresh(row)
            return JSONResponse(_work_item_response(row, role=role, notes=_notes_for_work_item(session, row)))
        finally:
            session.close()

    @app.post("/work-items/{item_id}/notes")
    def add_work_item_note(item_id: str, payload: WorkItemNoteCreate, request: Request) -> Response:
        session = session_factory()
        try:
            row = _get_tenant_work_item(session, item_id, _tenant_id(request))
            if row is None:
                return JSONResponse({"code": "not_found", "detail": f"No work item {item_id}."}, status_code=404)
            note = models.WorkItemNote(
                tenant_id=row.tenant_id,
                work_item_id=row.id,
                author_user_id=_actor_user_id(request),
                body=payload.body,
                note_type=payload.note_type,
                evidence_ids=payload.evidence_ids,
            )
            before = _work_item_snapshot(row)
            row.updated_at = datetime.now(UTC)
            session.add(note)
            session.flush()
            _append_work_item_audit(
                row,
                action="note_added",
                actor=_actor(request),
                before=before,
                after=_work_item_snapshot(row),
                note=payload.body,
                metadata={"note_id": note.id, "note_type": payload.note_type, "evidence_ids": payload.evidence_ids},
            )
            session.commit()
            session.refresh(row)
            return JSONResponse(_work_item_response(row, role=_role(request), notes=_notes_for_work_item(session, row)), status_code=201)
        finally:
            session.close()

    @app.post("/work-items/{item_id}/dismiss")
    def dismiss_work_item(item_id: str, payload: WorkItemDismiss, request: Request) -> Response:
        session = session_factory()
        try:
            row = _get_tenant_work_item(session, item_id, _tenant_id(request))
            if row is None:
                return JSONResponse({"code": "not_found", "detail": f"No work item {item_id}."}, status_code=404)
            before = _work_item_snapshot(row)
            if "dismiss" not in _allowed_work_item_actions(row, _role(request)):
                return JSONResponse(_transition_error(row, "dismiss", _role(request)), status_code=409)
            row.status = "dismissed"
            row.outcome = payload.reason
            row.dismissal_reason = payload.reason
            row.updated_at = datetime.now(UTC)
            after = _work_item_snapshot(row)
            _append_work_item_audit(row, action="dismissed", actor=_actor(request), before=before, after=after, reason=payload.reason)
            session.commit()
            session.refresh(row)
            return JSONResponse(_work_item_response(row, role=_role(request), notes=_notes_for_work_item(session, row)))
        finally:
            session.close()

    def config_response(row: models.EngineConfig) -> dict:
        return EngineConfigResponse(
            name=row.name,
            version=row.version,
            document=row.document,
            change_note=row.change_note,
            updated_at=row.updated_at.isoformat(),
        ).model_dump()

    def run_response(row: models.PipelineRun) -> dict:
        return PipelineRunResponse(
            id=row.id,
            triggered_at=row.triggered_at.isoformat(),
            mechanism=row.mechanism,
            status=row.status,
            completed_at=row.completed_at.isoformat() if row.completed_at else None,
            item_counts=row.item_counts,
            detail=row.detail,
            config_path=row.config_path,
        ).model_dump()

    @app.get("/engine-config/{name}")
    def get_engine_config(name: str, request: Request) -> Response:
        session = session_factory()
        try:
            row = latest_config(session, name, _tenant_id(request))
            if row is None:
                return JSONResponse({"code": "not_found", "detail": f"No config named {name}."}, status_code=404)
            return JSONResponse(config_response(row))
        finally:
            session.close()

    @app.put("/engine-config/{name}")
    def update_engine_config(name: str, payload: EngineConfigPut, request: Request) -> Response:
        session = session_factory()
        try:
            row = put_config(session, name, payload.document, payload.change_note, _tenant_id(request))
            logger.info("mutation.engine_config", extra={"config_name": name, "version": row.version})
            return JSONResponse(config_response(row))
        except KeyError as exc:
            return JSONResponse({"code": "not_found", "detail": str(exc)}, status_code=404)
        except ValidationError as exc:
            return JSONResponse({"code": "validation_error", "detail": exc.errors()}, status_code=422)
        finally:
            session.close()

    @app.get("/engine-config/{name}/history")
    def get_engine_config_history(name: str, request: Request) -> Response:
        session = session_factory()
        try:
            rows = config_history(session, name, _tenant_id(request))
            return JSONResponse({"records": [config_response(row) for row in rows]})
        finally:
            session.close()

    @app.post("/pipeline/run")
    def run_pipeline_now(request: Request) -> Response:
        session = session_factory()
        try:
            row = trigger_pipeline(session, settings, _tenant_id(request))
            logger.info("mutation.pipeline_run", extra={"run_id": row.id, "mechanism": row.mechanism, "status": row.status})
            return JSONResponse(run_response(row))
        except PipelineRateLimit as exc:
            return JSONResponse({"code": "rate_limited", "detail": str(exc)}, status_code=429)
        except PipelineConfigError as exc:
            return JSONResponse({"code": "pipeline_config_error", "detail": str(exc)}, status_code=422)
        finally:
            session.close()

    @app.get("/pipeline/runs")
    def get_pipeline_runs(request: Request) -> Response:
        session = session_factory()
        try:
            return JSONResponse({"records": [run_response(row) for row in list_runs(session, _tenant_id(request))]})
        finally:
            session.close()

    @app.post("/webhooks/{connection_id}")
    async def receive_webhook(connection_id: str, request: Request) -> Response:
        raw_body = await request.body()
        if len(raw_body) > settings.max_body_bytes:
            return JSONResponse({"detail": "payload too large"}, status_code=413)

        signature = request.headers.get(settings.signature_header)
        idem = request.headers.get(settings.idempotency_header)

        session = session_factory()
        try:
            connection = session.get(models.Connection, connection_id)
            if connection is None:
                return JSONResponse({"detail": "unknown connection"}, status_code=404)
            try:
                outcome = ingest(
                    session, app.state.queue, connection,
                    raw_body=raw_body, signature=signature, idempotency_header=idem,
                    encryption_key=settings.encryption_key,
                )
            except IngestError as exc:
                return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
        finally:
            session.close()

        body = IngestAccepted(
            event_id=outcome.event_id, status=outcome.status, duplicate=outcome.duplicate
        )
        # 200 fast-path: persisted + enqueued, no downstream call made here.
        return JSONResponse(body.model_dump(), status_code=200)

    return app
