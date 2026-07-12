"""Retention purge job for platform events and work-item audit history."""
from __future__ import annotations

import argparse
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from btx_platform import models
from btx_platform.config import Settings, get_settings
from btx_platform.db import assert_schema_current, init_db, make_engine, make_session_factory


def _parse_audit_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def purge_expired_records(
    session: Session,
    *,
    event_retention_days: int,
    audit_retention_days: int,
    now: datetime | None = None,
    dry_run: bool = False,
) -> dict[str, int]:
    current = (now or datetime.now(UTC)).astimezone(UTC)
    event_cutoff = current - timedelta(days=event_retention_days)
    audit_cutoff = current - timedelta(days=audit_retention_days)
    expired_event_ids = list(session.scalars(select(models.Event.id).where(models.Event.received_at < event_cutoff)))
    summary = {
        "events": len(expired_event_ids),
        "idempotency_keys": 0,
        "outbound_logs": 0,
        "dead_letters": 0,
        "audit_entries": 0,
        "work_items_touched": 0,
    }
    if expired_event_ids:
        summary["idempotency_keys"] = session.query(models.IdempotencyKey).filter(models.IdempotencyKey.event_id.in_(expired_event_ids)).count()
        summary["outbound_logs"] = session.query(models.OutboundLog).filter(models.OutboundLog.event_id.in_(expired_event_ids)).count()
        summary["dead_letters"] = session.query(models.DeadLetter).filter(models.DeadLetter.event_id.in_(expired_event_ids)).count()
        if not dry_run:
            session.execute(delete(models.IdempotencyKey).where(models.IdempotencyKey.event_id.in_(expired_event_ids)))
            session.execute(delete(models.OutboundLog).where(models.OutboundLog.event_id.in_(expired_event_ids)))
            session.execute(delete(models.DeadLetter).where(models.DeadLetter.event_id.in_(expired_event_ids)))
            session.execute(delete(models.Event).where(models.Event.id.in_(expired_event_ids)))

    for row in session.scalars(select(models.WorkItem)):
        audit_history = row.audit_history or []
        kept = []
        removed = 0
        for entry in audit_history:
            timestamp = _parse_audit_timestamp(entry.get("timestamp") if isinstance(entry, dict) else None)
            if timestamp is None or timestamp >= audit_cutoff:
                kept.append(entry)
            else:
                removed += 1
        if removed:
            summary["audit_entries"] += removed
            summary["work_items_touched"] += 1
            if not dry_run:
                row.audit_history = kept

    if not dry_run:
        session.commit()
    return summary


def purge_with_settings(settings: Settings, *, dry_run: bool = False) -> dict[str, int]:
    engine = make_engine(settings.database_url)
    if settings.env == "prod":
        assert_schema_current(engine)  # same gate as create_app: never create_all() in prod
    else:
        init_db(engine)
    session_factory = make_session_factory(engine)
    with session_factory() as session:
        return purge_expired_records(
            session,
            event_retention_days=settings.event_retention_days,
            audit_retention_days=settings.audit_retention_days,
            dry_run=dry_run,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Purge expired BTX platform records.")
    parser.add_argument("--dry-run", action="store_true", help="Report counts without deleting records.")
    args = parser.parse_args()
    summary = purge_with_settings(get_settings(), dry_run=args.dry_run)
    print(summary)


if __name__ == "__main__":
    main()
