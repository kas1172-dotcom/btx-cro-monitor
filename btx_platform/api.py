"""FastAPI application — the always-on ingress.

The webhook route is deliberately thin: read raw bytes, look up the connection,
delegate to the ingest service, map errors to status codes, return fast. All
collaborators (settings, session factory, queue) hang off ``app.state`` so tests
inject SQLite + an in-memory queue and production injects Postgres + Celery.
"""
from __future__ import annotations

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import sessionmaker

from btx_platform import models
from btx_platform.config import Settings, get_settings
from btx_platform.db import init_db, make_engine, make_session_factory
from btx_platform.ingest import IngestError, ingest
from btx_platform.queue import InMemoryQueue, JobQueue
from btx_platform.schemas import (
    CalendarEventRequest,
    CrmTaskRequest,
    EmailSendRequest,
    IngestAccepted,
    LlmProxyRequest,
)


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
        allow_origins=[settings.frontend_origin],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )
    app.state.settings = settings
    app.state.session_factory = session_factory
    app.state.queue = queue if queue is not None else InMemoryQueue()

    @app.get("/health")
    def health() -> dict:
        return {
            "status": "ok",
            "env": settings.env,
            "live": bool(settings.hubspot_access_token),
            "llm": bool(settings.anthropic_api_key),
        }

    def not_configured(service: str) -> JSONResponse:
        return JSONResponse(
            {
                "code": "not_configured",
                "detail": f"{service} is not configured. Static demo mode remains available in the frontend.",
            },
            status_code=501,
        )

    @app.post("/llm")
    async def llm_proxy(payload: LlmProxyRequest) -> Response:
        if not settings.anthropic_api_key:
            return not_configured("LLM proxy")
        # Token custody belongs here, but this thin Phase 10 route deliberately
        # avoids adding provider SDKs. Wire the provider call once credentials and
        # deployment policy are available.
        return JSONResponse(
            {
                "code": "provider_not_wired",
                "detail": "LLM key is present, but provider wiring is intentionally deferred in this thin backend pass.",
                "messages": [m.model_dump() for m in payload.messages],
            },
            status_code=501,
        )

    @app.get("/crm/accounts")
    def crm_accounts() -> Response:
        if not settings.hubspot_access_token:
            return not_configured("HubSpot accounts")
        return JSONResponse({"records": []})

    @app.get("/crm/deals")
    def crm_deals() -> Response:
        if not settings.hubspot_access_token:
            return not_configured("HubSpot deals")
        return JSONResponse({"records": []})

    @app.get("/crm/contacts")
    def crm_contacts() -> Response:
        if not settings.hubspot_access_token:
            return not_configured("HubSpot contacts")
        return JSONResponse({"records": []})

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
