"""WP10-C coverage: the health endpoint flags a stale/missing monitor
integration, request ids flow through the response, and JSON logging /
Sentry configuration no-ops safely when unset (sentry-sdk isn't installed
in this environment, mirroring most deploys until BTX_SENTRY_DSN is set)."""
from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("sqlalchemy")

from fastapi.testclient import TestClient  # noqa: E402

from btx_platform.api import create_app  # noqa: E402
from btx_platform.config import Settings  # noqa: E402
from btx_platform.db import init_db, make_engine, make_session_factory  # noqa: E402
from btx_platform.health import monitor_artifact_health, platform_health  # noqa: E402
from btx_platform.observability import configure_observability  # noqa: E402
from tests.auth_helpers import make_clerk_fixture  # noqa: E402

CLERK = make_clerk_fixture()


def _build(tmp_path: Path, **overrides):
    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    settings = Settings(
        env="test",
        pipeline_output_dir=str(tmp_path / "artifacts"),
        pipeline_generated_dir=str(tmp_path / "generated"),
        **overrides,
    )
    app = create_app(settings=settings, session_factory=sf, clerk_verifier=CLERK.verifier)
    return TestClient(app), settings


def _write_artifact(tmp_path: Path, *, run_at: str) -> None:
    output_dir = tmp_path / "artifacts"
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "run_output.json").write_text(json.dumps({"meta": {"run_at": run_at}}), encoding="utf-8")


def test_health_reports_missing_monitor_artifact(tmp_path: Path):
    client, _settings = _build(tmp_path)

    body = client.get("/health").json()

    assert body["monitor"]["status"] == "missing"
    assert body["status"] == "degraded"


def test_health_reports_fresh_monitor_artifact(tmp_path: Path):
    _write_artifact(tmp_path, run_at=datetime.now(UTC).isoformat())
    client, _settings = _build(tmp_path)

    body = client.get("/health").json()

    assert body["monitor"]["status"] == "ok"


def test_health_flags_stale_monitor_artifact(tmp_path: Path):
    old_run = (datetime.now(UTC) - timedelta(days=10)).isoformat()
    _write_artifact(tmp_path, run_at=old_run)
    client, _settings = _build(tmp_path, monitor_stale_after_days=7)

    body = client.get("/health").json()

    assert body["monitor"]["status"] == "stale"
    assert body["status"] == "degraded"


def test_health_reports_integration_configuration():
    body = platform_health(Settings(env="test", hubspot_access_token=None, anthropic_api_key="key"), db_ok=True)

    assert body["integrations"]["hubspot"]["status"] == "not_configured"
    assert body["integrations"]["llm"]["status"] == "ok"


def test_monitor_artifact_health_handles_invalid_json(tmp_path: Path):
    output_dir = tmp_path / "artifacts"
    output_dir.mkdir()
    (output_dir / "run_output.json").write_text("not json{", encoding="utf-8")
    settings = Settings(env="test", pipeline_output_dir=str(output_dir))

    result = monitor_artifact_health(settings)

    assert result["status"] == "invalid"
    assert result["stale"] is True


def test_response_carries_a_request_id_header(tmp_path: Path):
    client, _settings = _build(tmp_path)

    response = client.get("/health")

    assert response.headers.get("x-request-id")


def test_request_id_is_echoed_back_when_client_supplies_one(tmp_path: Path):
    client, _settings = _build(tmp_path)

    response = client.get("/health", headers={"X-Request-Id": "client-supplied-id"})

    assert response.headers["x-request-id"] == "client-supplied-id"


def test_configure_observability_noops_without_sentry_dsn():
    from btx_platform import observability

    configure_observability(Settings(env="test", sentry_dsn=None))

    assert observability._SENTRY_ENABLED is False
    observability.capture_exception(RuntimeError("should be a no-op"))  # must not raise


def test_configure_observability_installs_json_log_handler():
    import logging

    configure_observability(Settings(env="test"))

    root = logging.getLogger()
    assert getattr(root, "_btx_json_logging", False) is True
    assert any(isinstance(h.formatter, type(root.handlers[0].formatter)) for h in root.handlers)
