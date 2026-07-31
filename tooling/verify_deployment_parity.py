#!/usr/bin/env python3
"""Fail when runtime truth, schema, or demo seed differs from deployed code."""
from __future__ import annotations

import argparse
import json
import ssl
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from btx_platform.config import get_settings
from btx_platform.db import assert_schema_current, make_engine, make_session_factory
from btx_platform.demo.reset import verify_demo_tenant
from btx_platform.environment import environment_contract


def tls_context() -> ssl.SSLContext:
    try:
        import certifi  # type: ignore[import-not-found]

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-url", help="Deployed API base URL; validates its /environment response.")
    parser.add_argument("--contract-only", action="store_true", help="Skip database schema and seed checks.")
    args = parser.parse_args()
    settings = get_settings()
    local = environment_contract(settings)
    contract = local
    if args.api_url:
        environment_url = f"{args.api_url.rstrip('/')}/environment"
        try:
            with urlopen(environment_url, timeout=15, context=tls_context()) as response:  # noqa: S310 - operator-supplied URL
                contract = json.load(response)
        except HTTPError as exc:
            if exc.code in {401, 403}:
                raise SystemExit(
                    f"{environment_url} returned {exc.code}. /environment must be public and non-secret; "
                    "deploy the current API revision before claiming environment parity."
                ) from exc
            raise SystemExit(f"{environment_url} returned HTTP {exc.code}: {exc.reason}") from exc
        except URLError as exc:
            raise SystemExit(f"{environment_url} could not be reached: {exc.reason}") from exc
    revision = contract["revision"]
    if not revision["matchesExpected"]:
        raise SystemExit(f"revision drift: deployed={revision['deployed']} expected={revision['expected']}")
    if contract["deploymentMode"] == "demo" and not contract["isDemonstration"]:
        raise SystemExit("demo deployment is not marked as demonstration")
    if contract["deploymentMode"] == "demo" and contract["externalWrites"]["capable"]:
        raise SystemExit("demo deployment reports external-write capability")
    if not args.contract_only:
        engine = make_engine(settings.database_url)
        assert_schema_current(engine)
        if contract["isDemonstration"]:
            with make_session_factory(engine)() as session:
                verify_demo_tenant(session, contract["tenant"]["id"])
    print(json.dumps({"status": "ok", "environment": contract}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
