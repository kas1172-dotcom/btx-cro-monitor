"""Health status helpers shared by the API and tests."""
from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from btx_platform.config import Settings


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def monitor_artifact_health(settings: Settings, *, now: datetime | None = None) -> dict[str, Any]:
    current = (now or datetime.now(UTC)).astimezone(UTC)
    run_output_path = Path(settings.pipeline_output_dir) / "run_output.json"
    if not run_output_path.exists():
        return {
            "status": "missing",
            "configured_path": str(run_output_path),
            "stale": True,
            "detail": "Monitor artifact run_output.json is missing.",
        }
    try:
        payload = json.loads(run_output_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return {
            "status": "invalid",
            "configured_path": str(run_output_path),
            "stale": True,
            "detail": str(exc),
        }
    run_at = parse_iso_datetime(payload.get("meta", {}).get("run_at") if isinstance(payload, dict) else None)
    if run_at is None:
        return {
            "status": "invalid",
            "configured_path": str(run_output_path),
            "stale": True,
            "detail": "Monitor artifact missing meta.run_at.",
        }
    age_seconds = max(0.0, (current - run_at).total_seconds())
    stale_after_seconds = settings.monitor_stale_after_days * 24 * 60 * 60
    stale = age_seconds > stale_after_seconds
    return {
        "status": "stale" if stale else "ok",
        "configured_path": str(run_output_path),
        "run_at": run_at.isoformat().replace("+00:00", "Z"),
        "age_hours": round(age_seconds / 3600, 2),
        "stale": stale,
        "stale_after_days": settings.monitor_stale_after_days,
        "detail": "Monitor artifact is stale." if stale else "Monitor artifact is fresh.",
    }


def integration_status(name: str, configured: bool) -> dict[str, Any]:
    return {
        "name": name,
        "configured": configured,
        "status": "ok" if configured else "not_configured",
        "detail": f"{name} is configured." if configured else f"{name} credentials are not configured.",
    }


def platform_health(settings: Settings, *, db_ok: bool, now: datetime | None = None) -> dict[str, Any]:
    monitor = monitor_artifact_health(settings, now=now)
    integrations = {
        "hubspot": integration_status("HubSpot", bool(settings.hubspot_access_token)),
        "llm": integration_status("LLM", bool(settings.anthropic_api_key)),
    }
    degraded = (
        not db_ok
        or monitor["status"] != "ok"
        or any(item["status"] != "ok" for item in integrations.values())
    )
    return {
        "status": "degraded" if degraded else "ok",
        "generated_at": (now or datetime.now(UTC)).astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "db": {"status": "ok" if db_ok else "failed"},
        "monitor": monitor,
        "integrations": integrations,
    }
