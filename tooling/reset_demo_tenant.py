#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys

from btx_platform.config import get_settings
from btx_platform.db import init_db, make_engine, make_session_factory
from btx_platform.demo.reset import DemoResetError, reset_demo_tenant


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Reset or verify the BTX demonstration tenant.")
    parser.add_argument("--tenant", required=True, help="Explicit demonstration tenant id.")
    parser.add_argument("--dry-run", action="store_true", help="Validate target and report planned reset without mutating rows.")
    parser.add_argument("--verify-only", action="store_true", help="Verify an existing demo tenant without mutating rows.")
    args = parser.parse_args(argv)
    if args.dry_run and args.verify_only:
        parser.error("--dry-run and --verify-only are mutually exclusive.")

    settings = get_settings()
    engine = make_engine(settings.database_url)
    if settings.env != "prod":
        init_db(engine)
    session_factory = make_session_factory(engine)
    try:
        report = reset_demo_tenant(
            session_factory,
            args.tenant,
            dry_run=args.dry_run,
            verify_only=args.verify_only,
        )
    except DemoResetError as exc:
        print(json.dumps({"status": "refused", "detail": str(exc)}, indent=2, sort_keys=True), file=sys.stderr)
        return 2
    except Exception as exc:
        print(json.dumps({"status": "failed", "detail": str(exc)}, indent=2, sort_keys=True), file=sys.stderr)
        return 1

    print(json.dumps({"status": "ok", **report.as_dict()}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
