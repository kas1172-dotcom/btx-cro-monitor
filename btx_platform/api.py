"""FastAPI application — the always-on ingress.

The webhook route is deliberately thin: read raw bytes, look up the connection,
delegate to the ingest service, map errors to status codes, return fast. All
collaborators (settings, session factory, queue) hang off ``app.state`` so tests
inject SQLite + an in-memory queue and production injects Postgres + Celery.
"""
from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from btx_platform import models
from btx_platform.config import Settings, get_settings
from btx_platform.db import init_db, make_engine, make_session_factory
from btx_platform.engine_config import config_history, latest_config, put_config, seed_engine_configs
from btx_platform.hubspot import HubSpotClient, HubSpotError, hubspot_payload
from btx_platform.ingest import IngestError, ingest
from btx_platform.llm import LlmProviderError, call_anthropic
from btx_platform.pipeline import PipelineConfigError, PipelineRateLimit, list_runs, trigger_pipeline
from btx_platform.queue import InMemoryQueue, JobQueue
from btx_platform.schemas import (
    CalendarEventRequest,
    CrmTaskRequest,
    EmailSendRequest,
    EngineConfigPut,
    EngineConfigResponse,
    IngestAccepted,
    LlmProxyRequest,
    PipelineRunResponse,
)

logger = logging.getLogger(__name__)
CRM_CACHE_TTL_SECONDS = 300


def create_app(
    *,
    settings: Settings | None = None,
    session_factory: sessionmaker | None = None,
    queue: JobQueue | None = None,
) -> FastAPI:
    settings = settings or get_settings()

    if session_factory is None:
        engine = make_engine(settings.database_url)
        init_db(engine)                       # dev/test; prod uses Alembic
        session_factory = make_session_factory(engine)

    app = FastAPI(title="BTX Engine — Integration Platform", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["authorization", "content-type", "x-idempotency-key", settings.signature_header],
    )
    app.state.settings = settings
    app.state.session_factory = session_factory
    app.state.queue = queue if queue is not None else InMemoryQueue()
    app.state.crm_cache = {}
    seed_engine_configs(session_factory)

    @app.middleware("http")
    async def require_bearer_auth(request: Request, call_next):
        if request.url.path == "/health" or request.method == "OPTIONS":
            return await call_next(request)
        if not settings.backend_auth_token:
            return JSONResponse({"code": "auth_not_configured", "detail": "BTX_BACKEND_AUTH_TOKEN is required."}, status_code=503)
        expected = f"Bearer {settings.backend_auth_token}"
        if request.headers.get("authorization") != expected:
            return JSONResponse({"code": "unauthorized", "detail": "Missing or invalid bearer token."}, status_code=401)
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
        return {
            "status": "ok",
            "env": settings.env,
            "version": app.version,
            "db": db_ok,
            "live": bool(settings.hubspot_access_token),
            "llm": bool(settings.anthropic_api_key),
            "auth": bool(settings.backend_auth_token),
        }

    def not_configured(service: str) -> JSONResponse:
        return JSONResponse(
            {
                "code": "not_configured",
                "detail": f"{service} is not configured. Static demo mode remains available in the frontend.",
            },
            status_code=501,
        )

    def cached_hubspot_response(kind: str) -> Response:
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
    def crm_accounts() -> Response:
        return cached_hubspot_response("accounts")

    @app.get("/crm/deals")
    def crm_deals() -> Response:
        return cached_hubspot_response("deals")

    @app.get("/crm/contacts")
    def crm_contacts() -> Response:
        return cached_hubspot_response("contacts")

    @app.post("/crm/task")
    def create_crm_task(payload: CrmTaskRequest) -> Response:
        if not settings.hubspot_access_token:
            return not_configured("HubSpot task creation")
        return JSONResponse({"status": "accepted", "record_url": None, "title": payload.title})

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
    def get_engine_config(name: str) -> Response:
        session = session_factory()
        try:
            row = latest_config(session, name)
            if row is None:
                return JSONResponse({"code": "not_found", "detail": f"No config named {name}."}, status_code=404)
            return JSONResponse(config_response(row))
        finally:
            session.close()

    @app.put("/engine-config/{name}")
    def update_engine_config(name: str, payload: EngineConfigPut) -> Response:
        session = session_factory()
        try:
            row = put_config(session, name, payload.document, payload.change_note)
            logger.info("mutation.engine_config", extra={"config_name": name, "version": row.version})
            return JSONResponse(config_response(row))
        except KeyError as exc:
            return JSONResponse({"code": "not_found", "detail": str(exc)}, status_code=404)
        except ValidationError as exc:
            return JSONResponse({"code": "validation_error", "detail": exc.errors()}, status_code=422)
        finally:
            session.close()

    @app.get("/engine-config/{name}/history")
    def get_engine_config_history(name: str) -> Response:
        session = session_factory()
        try:
            rows = config_history(session, name)
            return JSONResponse({"records": [config_response(row) for row in rows]})
        finally:
            session.close()

    @app.post("/pipeline/run")
    def run_pipeline_now() -> Response:
        session = session_factory()
        try:
            row = trigger_pipeline(session, settings)
            logger.info("mutation.pipeline_run", extra={"run_id": row.id, "mechanism": row.mechanism, "status": row.status})
            return JSONResponse(run_response(row))
        except PipelineRateLimit as exc:
            return JSONResponse({"code": "rate_limited", "detail": str(exc)}, status_code=429)
        except PipelineConfigError as exc:
            return JSONResponse({"code": "pipeline_config_error", "detail": str(exc)}, status_code=422)
        finally:
            session.close()

    @app.get("/pipeline/runs")
    def get_pipeline_runs() -> Response:
        session = session_factory()
        try:
            return JSONResponse({"records": [run_response(row) for row in list_runs(session)]})
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
