#!/usr/bin/env python3
"""Persistently invalidate deliverables created before semantic grounding."""
from __future__ import annotations

import argparse
from datetime import UTC, datetime

from btx_platform import models
from btx_platform.config import get_settings
from btx_platform.db import make_engine, make_session_factory

CONFIRMATION = "INVALIDATE_Q2_2026_REVENUE_REVIEW"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tenant-id", help="Tenant to inspect or mutate. Required with --confirm.")
    parser.add_argument("--confirm", action="store_true", help="Persist invalidation; default is dry-run.")
    parser.add_argument("--confirm-text", help=f"Required with --confirm: {CONFIRMATION}")
    args = parser.parse_args()
    if args.confirm and args.confirm_text != CONFIRMATION:
        parser.error(f"--confirm requires --confirm-text {CONFIRMATION!r}")
    if args.confirm and not args.tenant_id:
        parser.error("--confirm requires --tenant-id so live invalidation is tenant-scoped")
    sf = make_session_factory(make_engine(get_settings().database_url))
    with sf() as session:
        query = session.query(models.Deliverable).filter(models.Deliverable.title.ilike("Q2 2026 Revenue Review"))
        if args.tenant_id:
            query = query.filter(models.Deliverable.tenant_id == args.tenant_id)
        rows = query.all()
        print(f"affected_deliverables={len(rows)}")
        for row in rows:
            print(f"{row.tenant_id}\t{row.id}\t{row.title}")
            if args.confirm:
                document = dict(row.document or {})
                document.update({
                    "invalidatedAt": datetime.now(UTC).isoformat(),
                    "invalidationReason": "Invalidated by typed metric-state migration; regenerate from current sources.",
                    "quality": {"valid": False, "errors": ["Regeneration required under semantic grounding contract."]},
                })
                row.document = document
                row.updated_at = datetime.now(UTC)
        if args.confirm:
            session.commit()
            print("invalidation_committed=true")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
