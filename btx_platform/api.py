"""FastAPI application — the always-on ingress.

The webhook route is deliberately thin: read raw bytes, look up the connection,
delegate to the ingest service, map errors to status codes, return fast. All
collaborators (settings, session factory, queue) hang off ``app.state`` so tests
inject SQLite + an in-memory queue and production injects Postgres + Celery.
"""
from __future__ import annotations

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import sessionmaker

from btx_platform import models
from btx_platform.config import Settings, get_settings
from btx_platform.db import init_db, make_engine, make_session_factory
from btx_platform.ingest import IngestError, ingest
from btx_platform.queue import InMemoryQueue, JobQueue
from btx_platform.schemas import IngestAccepted


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
    app.state.settings = settings
    app.state.session_factory = session_factory
    app.state.queue = queue if queue is not None else InMemoryQueue()

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "env": settings.env}

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
