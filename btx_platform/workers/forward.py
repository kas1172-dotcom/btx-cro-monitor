"""The Phase-2 forwarder: deliver a stored Event to its Connection's
destination, with retries/backoff, and dead-letter it after max_attempts.

Kept import-light at module scope (no Celery decorator side effects beyond
registration) so btx_platform.workers.forward_event_sync is independently
unit-testable without a running broker — the Celery task is a thin wrapper
around it.
"""
from __future__ import annotations

import logging

import httpx
from sqlalchemy.orm import sessionmaker

from btx_platform import models
from btx_platform.config import Settings, get_settings
from btx_platform.db import make_engine, make_session_factory

logger = logging.getLogger(__name__)


class ForwardError(Exception):
    """Raised when a forward attempt fails; callers decide retry vs dead-letter."""


def forward_event_sync(
    session_factory: sessionmaker,
    event_id: str,
    *,
    settings: Settings | None = None,
    http_post=None,
) -> str:
    """Attempt one forward of *event_id*. Returns the resulting status
    ("done", "failed", or "dead"). Records an OutboundLog row for every
    attempt and moves the event to DeadLetter once attempts >= max_attempts.

    `http_post` is injectable for tests; defaults to a real httpx POST.
    """
    settings = settings or get_settings()
    http_post = http_post or _default_http_post

    with session_factory() as session:
        event = session.get(models.Event, event_id)
        if event is None:
            logger.warning("forward.event_missing", extra={"event_id": event_id})
            return "failed"

        connection = session.get(models.Connection, event.connection_id)
        destination = connection.destination_url if connection else None
        if not destination:
            # No destination configured — nothing to forward to. Not a
            # failure: plenty of connections are inbound-only sinks.
            event.status = models.STATUS_DONE
            session.commit()
            return "done"

        event.attempts += 1
        attempt_no = event.attempts
        event.status = models.STATUS_PROCESSING
        session.commit()

        try:
            status_code, response_body = http_post(destination, event.raw_body)
            ok = 200 <= status_code < 300
        except Exception as exc:  # noqa: BLE001 - network errors of any shape
            status_code, response_body, ok = None, str(exc), False

        session.add(models.OutboundLog(
            event_id=event.id,
            attempt_no=attempt_no,
            http_status=status_code,
            response=str(response_body)[:4000] if response_body is not None else None,
        ))

        if ok:
            event.status = models.STATUS_DONE
            event.error = None
            session.commit()
            logger.info("forward.delivered", extra={"event_id": event_id, "attempt": attempt_no})
            return "done"

        event.error = str(response_body)[:2000] if response_body else f"http {status_code}"
        if attempt_no >= settings.max_attempts:
            event.status = models.STATUS_DEAD
            session.add(models.DeadLetter(event_id=event.id, last_error=event.error))
            session.commit()
            logger.warning("forward.dead_lettered", extra={"event_id": event_id, "attempts": attempt_no})
            return "dead"

        event.status = models.STATUS_FAILED
        session.commit()
        logger.info("forward.retry_scheduled", extra={"event_id": event_id, "attempt": attempt_no})
        return "failed"


def _default_http_post(destination: str, raw_body: str) -> tuple[int, str]:
    response = httpx.post(destination, content=raw_body.encode("utf-8"), timeout=30.0)
    return response.status_code, response.text


def _backoff_seconds(attempt: int, settings: Settings) -> float:
    delay = settings.retry_backoff_base ** max(attempt, 1)
    return min(delay, settings.retry_backoff_max)


def register_forward_task(celery_app) -> None:
    """Registers the Celery task on *celery_app*. Split from module import so
    tests can call forward_event_sync directly without a Celery app, and so
    btx_platform.workers can import this module without a circular import
    (this module never imports the workers package back)."""

    @celery_app.task(name="btx_platform.workers.forward.forward_event", bind=True)
    def forward_event(self, event_id: str) -> str:  # noqa: ANN001 - Celery bind arg
        settings = get_settings()
        engine = make_engine(settings.database_url)
        session_factory = make_session_factory(engine)
        outcome = forward_event_sync(session_factory, event_id, settings=settings)
        if outcome == "failed":
            attempts = self.request.retries + 1
            raise self.retry(countdown=_backoff_seconds(attempts, settings), max_retries=settings.max_attempts)
        return outcome

    return forward_event
