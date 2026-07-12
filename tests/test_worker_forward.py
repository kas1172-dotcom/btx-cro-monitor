"""WP10-B forwarder coverage: a job runs and delivers, retries on failure,
then dead-letters after max_attempts. Exercises forward_event_sync directly
(no broker needed) — the Celery task registered in workers/forward.py is a
thin wrapper that calls the same function, proven by test_celery_task_wiring.
"""
from __future__ import annotations

import pytest

pytest.importorskip("celery")
pytest.importorskip("sqlalchemy")

from btx_platform import models  # noqa: E402
from btx_platform.config import Settings  # noqa: E402
from btx_platform.db import init_db, make_engine, make_session_factory  # noqa: E402
from btx_platform.queue import CeleryQueue  # noqa: E402
from btx_platform.workers.forward import forward_event_sync  # noqa: E402


def _build(**settings_overrides):
    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    settings = Settings(env="test", max_attempts=3, **settings_overrides)
    return sf, settings


def _seed_event(sf, *, destination_url: str | None = "https://destination.example/hook") -> str:
    with sf() as session:
        session.add(models.Connection(id="conn-1", name="Test", destination_url=destination_url, active=True))
        event = models.Event(
            connection_id="conn-1",
            raw_body='{"event_type": "x", "data": {}}',
            status=models.STATUS_RECEIVED,
        )
        session.add(event)
        session.commit()
        return event.id


def test_forward_delivers_successfully_and_logs_attempt():
    sf, settings = _build()
    event_id = _seed_event(sf)

    def fake_post(destination, body):
        assert destination == "https://destination.example/hook"
        return 200, "ok"

    outcome = forward_event_sync(sf, event_id, settings=settings, http_post=fake_post)

    assert outcome == "done"
    with sf() as session:
        event = session.get(models.Event, event_id)
        assert event.status == models.STATUS_DONE
        assert event.attempts == 1
        logs = session.query(models.OutboundLog).filter_by(event_id=event_id).all()
        assert len(logs) == 1
        assert logs[0].http_status == 200


def test_forward_without_destination_marks_done_with_no_attempt():
    sf, settings = _build()
    event_id = _seed_event(sf, destination_url=None)

    outcome = forward_event_sync(sf, event_id, settings=settings, http_post=lambda *_: (200, "unused"))

    assert outcome == "done"
    with sf() as session:
        event = session.get(models.Event, event_id)
        assert event.attempts == 0  # never actually called out


def test_forward_retries_on_failure_below_max_attempts():
    sf, settings = _build()
    event_id = _seed_event(sf)

    outcome = forward_event_sync(sf, event_id, settings=settings, http_post=lambda *_: (500, "server error"))

    assert outcome == "failed"
    with sf() as session:
        event = session.get(models.Event, event_id)
        assert event.status == models.STATUS_FAILED
        assert event.attempts == 1
        assert "500" in event.error or "server error" in event.error


def test_forward_dead_letters_after_max_attempts():
    sf, settings = _build()
    event_id = _seed_event(sf)

    for _ in range(settings.max_attempts):
        outcome = forward_event_sync(sf, event_id, settings=settings, http_post=lambda *_: (500, "still down"))

    assert outcome == "dead"
    with sf() as session:
        event = session.get(models.Event, event_id)
        assert event.status == models.STATUS_DEAD
        assert event.attempts == settings.max_attempts
        dead_letter = session.query(models.DeadLetter).filter_by(event_id=event_id).one()
        assert "still down" in dead_letter.last_error
        logs = session.query(models.OutboundLog).filter_by(event_id=event_id).all()
        assert len(logs) == settings.max_attempts  # every attempt logged


def test_forward_network_exception_is_treated_as_failure_not_a_crash():
    sf, settings = _build()
    event_id = _seed_event(sf)

    def raising_post(destination, body):
        raise ConnectionError("connection refused")

    outcome = forward_event_sync(sf, event_id, settings=settings, http_post=raising_post)

    assert outcome == "failed"
    with sf() as session:
        event = session.get(models.Event, event_id)
        assert "connection refused" in event.error


def test_forward_missing_event_is_a_no_op():
    sf, settings = _build()

    outcome = forward_event_sync(sf, "does-not-exist", settings=settings, http_post=lambda *_: (200, "ok"))

    assert outcome == "failed"


def test_celery_task_wiring_dispatches_by_name():
    """CeleryQueue.enqueue_forward must call the exact task name
    workers/forward.py registers — this is the wiring seam ingest.py depends
    on; a typo here would silently drop every forwarded event in prod."""
    calls = []

    class FakeCeleryApp:
        def send_task(self, name, args):
            calls.append((name, args))

    CeleryQueue(FakeCeleryApp()).enqueue_forward("evt-123")

    assert calls == [("btx_platform.workers.forward.forward_event", ["evt-123"])]


def test_celery_app_registers_forward_task_under_expected_name():
    from btx_platform.workers import celery_app

    assert "btx_platform.workers.forward.forward_event" in celery_app.tasks
