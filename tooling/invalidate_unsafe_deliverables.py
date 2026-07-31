#!/usr/bin/env python3
"""Persistently invalidate deliverables created before semantic grounding."""
from __future__ import annotations

import argparse
from datetime import UTC, datetime

from btx_platform import models
from btx_platform.config import get_settings
from btx_platform.db import make_engine, make_session_factory


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm", action="store_true", help="Persist invalidation; default is dry-run.")
    args = parser.parse_args()
    sf = make_session_factory(make_engine(get_settings().database_url))
    with sf() as session:
        rows = session.query(models.Deliverable).filter(models.Deliverable.title.ilike("Q2 2026 Revenue Review")).all()
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
