"""FastAPI application — the always-on ingress.

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
from btx_platform.hubspot import HubSpotClient, HubSpotError, HubSpotTaskAssociation, hubspot_payload
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
    HubSpotTaskExecuteRequest,
    IngestAccepted,
    LlmProxyRequest,
    PipelineRunResponse,
    WorkItemCreate,
    WorkItemDismiss,
    WorkItemPatch,
    WorkItemResponse,
)

logger = logging.getLogger(__name__)
CRM_CACHE_TTL_SECONDS = 300
PUBLIC_PATHS = {"/health", "/artifacts/latest"}
# Mutating routes require at least "analyst"; a viewer can read but not write.
MUTATING_ROUTE_MIN_ROLE = "analyst"
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# /webhooks/* is authenticated by its own per-connection HMAC signature, not
# a Clerk session (the caller is a machine, not a signed-in user).
WEBHOOK_PATH_PREFIX = "/webhooks/"
WORK_ITEM_TRANSITIONS = {
    "proposed": {"approved", "dismissed"},
    "approved": {"in_progress", "dismissed"},
    "in_progress": {"done", "dismissed"},
    "done": set(),
    "dismissed": set(),
}


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
    never as a way to spoof identity — the auth middleware already rejected
    any request without a verified session before a route handler runs.
    """
    auth: AuthContext | None = getattr(request.state, "auth", None)
    if auth is None:
        return "system"
    return auth.email or auth.user_id


def _tenant_id(request: Request) -> str:
    auth: AuthContext | None = getattr(request.state, "auth", None)
    return auth.tenant_id if auth is not None else models.DEFAULT_TENANT_ID


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


def _work_item_snapshot(row: models.WorkItem) -> dict:
    return {
        "id": row.id,
        "type": row.type,
        "canonical_account_id": row.canonical_account_id,
        "source_signal_ids": row.source_signal_ids or [],
        "owner": row.owner,
        "priority": row.priority,
        "status": row.status,
        "due_date": row.due_date.isoformat() if row.due_date else None,
        "recommended_action": row.recommended_action,
        "generated_artifact_ref": row.generated_artifact_ref,
        "approval_state": row.approval_state,
        "execution_state": row.execution_state,
        "outcome": row.outcome,
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


def _work_item_response(row: models.WorkItem) -> dict:
    return WorkItemResponse(**_work_item_snapshot(row)).model_dump()


def _append_work_item_audit(row: models.WorkItem, *, action: str, actor: str, before: dict | None, after: dict | None) -> None:
    audit = list(row.audit_history or [])
    audit.append({
        "timestamp": datetime.now(UTC).isoformat(),
        "actor": actor,
        "action": action,
        "before": before,
        "after": after,
    })
    row.audit_history = audit


def _validate_work_item_transition(current: str, next_status: str) -> None:
    if next_status == current:
        return
    if next_status not in WORK_ITEM_TRANSITIONS.get(current, set()):
        raise ValueError(f"invalid status transition {current} -> {next_status}")


def _hubspot_task_record_url(task_id: str) -> str:
    return f"https://app.hubspot.com/tasks/{task_id}"


def _get_tenant_work_item(session, item_id: str, tenant_id: str) -> models.WorkItem | None:
    """Fetch a work item scoped to *tenant_id*.

    A row that exists but belongs to a different tenant returns None, the same
    as a missing row — the caller can't distinguish "not found" from "not
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
            # Prod must never fall back to create_all() — that would drift
            # from what alembic/versions/ tracks. Deploy runs
            # `alembic upgrade head` before the new code serves traffic.
            assert_schema_current(engine)
        else:
            init_db(engine)                   # dev/test convenience
        session_factory = make_session_factory(engine)

    app = FastAPI(title="BTX Engine — Integration Platform", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "OPTIONS"],
        allow_headers=["authorization", "content-type", "x-idempotency-key", settings.signature_header],
    )
    app.state.settings = settings
    app.state.session_factory = session_factory
    app.state.queue = queue if queue is not None else _default_queue(settings)
    app.state.crm_cache = {}
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

    def not_configured(service: str) -> JSONResponse:
        return JSONResponse(
            {
                "code": "not_configured",
                "detail": f"{service} is not configured. Static demo mode remains available in the frontend.",
            },
            status_code=501,
        )

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

    @app.post("/crm/task")
    def create_crm_task(payload: CrmTaskRequest, request: Request) -> Response:
        if not settings.hubspot_access_token:
            return not_configured("HubSpot task creation")
        body = payload.body or payload.evidence or ""
        associations = _task_associations(payload)
        idempotency_key = request.headers.get(settings.idempotency_header)
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
        return JSONResponse({
            "status": "created",
            "id": task_id,
            "record_url": record_url,
            "title": payload.title,
        })

    @app.post("/work-items/{item_id}/execute/hubspot-task")
    def execute_work_item_hubspot_task(item_id: str, payload: HubSpotTaskExecuteRequest, request: Request) -> Response:
        if not payload.confirmed:
            return JSONResponse({"code": "confirmation_required", "detail": "Explicit confirmation is required before writing to HubSpot."}, status_code=422)
        if not settings.hubspot_access_token:
            return not_configured("HubSpot task creation")

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
                        "work_item": _work_item_response(row),
                        "hubspot_task": {
                            "id": row.external_record_id,
                            "record_url": row.external_record_url,
                        },
                    })
                return JSONResponse({
                    "code": "already_executed",
                    "detail": "This work item already has a verified HubSpot task. Use the original idempotency key to retry safely.",
                    "work_item": _work_item_response(row),
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
            row.execution_state = "running"
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
                row.outcome = str(exc)
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
                return JSONResponse({"code": "hubspot_error", "detail": str(exc), "work_item": _work_item_response(row)}, status_code=502)

            record_url = _hubspot_task_record_url(task_id)
            before_success = _work_item_snapshot(row)
            row.status = "done"
            row.execution_state = "completed"
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
                "work_item": _work_item_response(row),
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
            if account:
                query = query.filter(models.Deliverable.canonical_account_id == account)
            if type:
                query = query.filter(models.Deliverable.type == type)
            rows = query.order_by(models.Deliverable.updated_at.desc(), models.Deliverable.created_at.desc()).all()
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
            row = models.WorkItem(
                tenant_id=_tenant_id(request),
                type=payload.type,
                canonical_account_id=payload.canonical_account_id,
                source_signal_ids=payload.source_signal_ids,
                owner=payload.owner,
                priority=payload.priority,
                status=payload.status,
                due_date=due_date,
                recommended_action=payload.recommended_action,
                generated_artifact_ref=payload.generated_artifact_ref,
                approval_state=payload.approval_state,
                execution_state=payload.execution_state,
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
            return JSONResponse(_work_item_response(row), status_code=201)
        finally:
            session.close()

    @app.get("/work-items")
    def list_work_items(
        request: Request,
        account: str | None = None,
        status: str | None = None,
        owner: str | None = None,
        due_from: str | None = None,
        due_to: str | None = None,
        view: str | None = None,
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
                query = query.filter(models.WorkItem.status == status)
            if owner:
                query = query.filter(models.WorkItem.owner == owner)
            if due_from_dt:
                query = query.filter(models.WorkItem.due_date >= due_from_dt)
            if due_to_dt:
                query = query.filter(models.WorkItem.due_date <= due_to_dt)
            now = datetime.now(UTC)
            if view == "needs_attention":
                query = query.filter(
                    models.WorkItem.status.notin_(["done", "dismissed"]),
                    (models.WorkItem.priority.in_(["high", "urgent"])) | (models.WorkItem.due_date < now),
                )
            elif view == "prepared":
                query = query.filter(models.WorkItem.generated_artifact_ref.is_not(None))
            elif view == "needs_approval":
                query = query.filter(models.WorkItem.approval_state == "pending")
            elif view == "outcomes":
                query = query.filter(models.WorkItem.status.in_(["done", "dismissed"]))
            elif view == "what_changed":
                query = query.filter(models.WorkItem.updated_at >= now - timedelta(days=7))
            elif view is not None:
                return JSONResponse({"code": "validation_error", "detail": f"Unknown work item view {view}."}, status_code=422)
            rows = query.order_by(models.WorkItem.updated_at.desc(), models.WorkItem.created_at.desc()).all()
            return JSONResponse({"records": [_work_item_response(row) for row in rows]})
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
                if "status" in fields and payload.status is not None:
                    _validate_work_item_transition(row.status, payload.status)
                    row.status = payload.status
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
            if "generated_artifact_ref" in fields:
                row.generated_artifact_ref = payload.generated_artifact_ref
            if "approval_state" in fields and payload.approval_state is not None:
                row.approval_state = payload.approval_state
            if "execution_state" in fields and payload.execution_state is not None:
                row.execution_state = payload.execution_state
            if "outcome" in fields:
                row.outcome = payload.outcome
            row.updated_at = datetime.now(UTC)
            after = _work_item_snapshot(row)
            _append_work_item_audit(row, action="patch", actor=_actor(request), before=before, after=after)
            session.commit()
            session.refresh(row)
            return JSONResponse(_work_item_response(row))
        finally:
            session.close()

    @app.post("/work-items/{item_id}/dismiss")
    def dismiss_work_item(item_id: str, payload: WorkItemDismiss, request: Request) -> Response:
        session = session_factory()
        try:
            row = _get_tenant_work_item(session, item_id, _tenant_id(request))
            if row is None:
                return JSONResponse({"code": "not_found", "detail": f"No work item {item_id}."}, status_code=404)
            try:
                _validate_work_item_transition(row.status, "dismissed")
            except ValueError as exc:
                return JSONResponse({"code": "validation_error", "detail": str(exc)}, status_code=422)
            before = _work_item_snapshot(row)
            row.status = "dismissed"
            row.outcome = payload.reason
            row.execution_state = "completed"
            row.updated_at = datetime.now(UTC)
            after = _work_item_snapshot(row)
            _append_work_item_audit(row, action="dismiss", actor=_actor(request), before=before, after=after)
            session.commit()
            session.refresh(row)
            return JSONResponse(_work_item_response(row))
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
