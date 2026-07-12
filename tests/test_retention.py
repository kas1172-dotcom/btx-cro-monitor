"""WP10-C retention purge coverage: only expired events/audit entries are
removed; anything inside the retention window survives; dry-run reports
without deleting."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

pytest.importorskip("sqlalchemy")

from btx_platform import models  # noqa: E402
from btx_platform.config import Settings  # noqa: E402
from btx_platform.db import init_db, make_engine, make_session_factory  # noqa: E402
from btx_platform.retention import purge_expired_records, purge_with_settings  # noqa: E402


def _build():
    engine = make_engine("sqlite://")
    init_db(engine)
    return make_session_factory(engine)


def _seed_event(sf, *, received_at: datetime, event_id: str) -> None:
    with sf() as session:
        if session.get(models.Connection, "conn-1") is None:
            session.add(models.Connection(id="conn-1", name="Test", active=True))
        session.add(models.Event(id=event_id, connection_id="conn-1", raw_body="{}", received_at=received_at))
        session.commit()


def test_purge_removes_only_expired_events():
    sf = _build()
    now = datetime.now(UTC)
    _seed_event(sf, received_at=now - timedelta(days=100), event_id="old-event")
    _seed_event(sf, received_at=now - timedelta(days=10), event_id="recent-event")

    with sf() as session:
        summary = purge_expired_records(session, event_retention_days=90, audit_retention_days=365, now=now)

    assert summary["events"] == 1
    with sf() as session:
        assert session.get(models.Event, "old-event") is None
        assert session.get(models.Event, "recent-event") is not None


def test_purge_cascades_related_event_rows():
    sf = _build()
    now = datetime.now(UTC)
    _seed_event(sf, received_at=now - timedelta(days=200), event_id="old-event")
    with sf() as session:
        session.add(models.IdempotencyKey(key="idem-1", event_id="old-event"))
        session.add(models.OutboundLog(event_id="old-event", attempt_no=1, http_status=500))
        session.add(models.DeadLetter(event_id="old-event", last_error="boom"))
        session.commit()

    with sf() as session:
        summary = purge_expired_records(session, event_retention_days=90, audit_retention_days=365, now=now)

    assert summary == {
        "events": 1, "idempotency_keys": 1, "outbound_logs": 1, "dead_letters": 1,
        "audit_entries": 0, "work_items_touched": 0,
    }
    with sf() as session:
        assert session.query(models.IdempotencyKey).count() == 0
        assert session.query(models.OutboundLog).count() == 0
        assert session.query(models.DeadLetter).count() == 0


def test_purge_trims_old_audit_entries_but_keeps_recent_ones():
    sf = _build()
    now = datetime.now(UTC)
    old_ts = (now - timedelta(days=400)).isoformat()
    recent_ts = (now - timedelta(days=1)).isoformat()
    with sf() as session:
        session.add(models.WorkItem(
            id="wi-1", type="research_task", recommended_action="Do a thing",
            audit_history=[
                {"timestamp": old_ts, "actor": "a", "action": "create", "before": None, "after": {}},
                {"timestamp": recent_ts, "actor": "b", "action": "patch", "before": {}, "after": {}},
            ],
        ))
        session.commit()

    with sf() as session:
        summary = purge_expired_records(session, event_retention_days=90, audit_retention_days=365, now=now)

    assert summary["audit_entries"] == 1
    assert summary["work_items_touched"] == 1
    with sf() as session:
        row = session.get(models.WorkItem, "wi-1")
        assert len(row.audit_history) == 1
        assert row.audit_history[0]["action"] == "patch"


def test_dry_run_reports_without_deleting():
    sf = _build()
    now = datetime.now(UTC)
    _seed_event(sf, received_at=now - timedelta(days=200), event_id="old-event")

    with sf() as session:
        summary = purge_expired_records(session, event_retention_days=90, audit_retention_days=365, now=now, dry_run=True)

    assert summary["events"] == 1
    with sf() as session:
        assert session.get(models.Event, "old-event") is not None  # still there


def test_purge_with_settings_uses_configured_retention_windows(tmp_path):
    db_path = tmp_path / "retention_test.db"
    settings = Settings(env="test", database_url=f"sqlite:///{db_path}", event_retention_days=1, audit_retention_days=1)
    engine = make_engine(settings.database_url)
    init_db(engine)
    sf = make_session_factory(engine)
    _seed_event(sf, received_at=datetime.now(UTC) - timedelta(days=5), event_id="stale-event")

    summary = purge_with_settings(settings)

    assert summary["events"] == 1
