from __future__ import annotations

from pathlib import Path

import httpx
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("sqlalchemy")

from fastapi.testclient import TestClient  # noqa: E402

from btx_platform import models  # noqa: E402
from btx_platform.api import create_app  # noqa: E402
from btx_platform.config import Settings  # noqa: E402
from btx_platform.db import init_db, make_engine, make_session_factory  # noqa: E402

AUTH = "tier1-token"


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {AUTH}"}


def _build(tmp_path: Path, **overrides):
    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    values = {
        "env": "test",
        "backend_auth_token": AUTH,
        "anthropic_api_key": "anthropic-test-key",
        "pipeline_generated_dir": str(tmp_path / "generated"),
        "pipeline_output_dir": str(tmp_path / "artifacts"),
        "pipeline_min_interval_seconds": 0,
        **overrides,
    }
    settings = Settings(**values)
    app = create_app(settings=settings, session_factory=sf)
    return TestClient(app), sf, settings


def test_auth_rejects_protected_routes(tmp_path: Path):
    client, _sf, _settings = _build(tmp_path)
    assert client.get("/engine-config/scoring_weights").status_code == 401


def test_auth_uses_constant_time_compare(monkeypatch, tmp_path: Path):
    calls: list[tuple[str, str]] = []

    def fake_compare(candidate: str, expected: str) -> bool:
        calls.append((candidate, expected))
        return False

    monkeypatch.setattr("btx_platform.api.hmac.compare_digest", fake_compare)
    client, _sf, _settings = _build(tmp_path)

    response = client.get("/engine-config/scoring_weights", headers={"Authorization": "Bearer wrong-token"})

    assert response.status_code == 401
    assert calls == [("Bearer wrong-token", f"Bearer {AUTH}")]


def test_llm_route_matches_proxy_contract(monkeypatch, tmp_path: Path):
    captured: dict = {}

    class FakeAsyncClient:
        def __init__(self, timeout):
            captured["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def post(self, url, headers, json):
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return httpx.Response(200, json={"content": [{"type": "text", "text": "routed answer"}]})

    monkeypatch.setattr("btx_platform.llm.httpx.AsyncClient", FakeAsyncClient)
    client, _sf, settings = _build(tmp_path)

    request = {
        "model": "claude-haiku-4-5-20251001",
        "system": "You are Chatpil.",
        "messages": [{"role": "user", "content": "What changed?"}],
    }
    response = client.post("/llm", json=request, headers=_headers())

    assert response.status_code == 200
    assert response.json() == {"text": "routed answer"}
    assert captured["url"] == settings.anthropic_base_url
    assert captured["headers"]["x-api-key"] == "anthropic-test-key"
    assert captured["json"]["model"] == request["model"]
    assert captured["json"]["system"] == request["system"]
    assert captured["json"]["messages"] == request["messages"]


def test_engine_config_put_validates_and_versions(tmp_path: Path):
    client, _sf, _settings = _build(tmp_path)

    first = client.get("/engine-config/scoring_weights", headers=_headers()).json()
    document = first["document"]
    document["min_confidence"] = 0.42

    saved = client.put(
        "/engine-config/scoring_weights",
        json={"document": document, "change_note": "test update"},
        headers=_headers(),
    )
    assert saved.status_code == 200
    assert saved.json()["version"] == first["version"] + 1
    assert saved.json()["document"]["min_confidence"] == 0.42

    bad = client.put(
        "/engine-config/scoring_weights",
        json={"document": {"version": "bad"}, "change_note": "invalid"},
        headers=_headers(),
    )
    assert bad.status_code == 422

    history = client.get("/engine-config/scoring_weights/history", headers=_headers()).json()
    assert [record["version"] for record in history["records"][:2]] == [2, 1]


def test_pipeline_trigger_subprocess_mocked(monkeypatch, tmp_path: Path):
    output_dir = tmp_path / "artifacts"

    class Completed:
        returncode = 0
        stdout = "ok"
        stderr = ""

    def fake_run(command, text, capture_output, timeout, check):
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "run_output.json").write_text(
            '{"meta":{"items_collected":3,"items_after_prefilter":2,"items_analyzed":1}}',
            encoding="utf-8",
        )
        return Completed()

    monkeypatch.setattr("btx_platform.pipeline.subprocess.run", fake_run)
    client, _sf, _settings = _build(tmp_path, pipeline_mechanism="subprocess", pipeline_output_dir=str(output_dir))

    response = client.post("/pipeline/run", headers=_headers())

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "completed"
    assert body["mechanism"] == "subprocess"
    assert body["item_counts"]["items_collected"] == 3
    assert Path(body["config_path"]).exists()


def test_pipeline_trigger_github_dispatch_mocked(monkeypatch, tmp_path: Path):
    captured: dict = {}

    class FakeResponse:
        status_code = 204
        text = ""

    class FakeClient:
        def __init__(self, timeout):
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return None

        def post(self, url, headers, json):
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return FakeResponse()

    monkeypatch.setattr("btx_platform.pipeline.httpx.Client", FakeClient)
    client, _sf, settings = _build(tmp_path, pipeline_mechanism="github", github_pat="gh-test")

    response = client.post("/pipeline/run", headers=_headers())

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "dispatched"
    assert body["mechanism"] == "github"
    assert captured["url"].endswith(f"/{settings.github_repo}/actions/workflows/{settings.github_workflow}/dispatches")
    assert captured["headers"]["authorization"] == "Bearer gh-test"
    assert captured["json"] == {"ref": settings.github_ref, "inputs": {"client": "btx"}}


def test_pipeline_rate_limit_refuses_recent_run(tmp_path: Path):
    client, sf, _settings = _build(tmp_path, pipeline_min_interval_seconds=600)
    with sf() as session:
        session.add(models.PipelineRun(mechanism="subprocess", status="completed"))
        session.commit()

    response = client.post("/pipeline/run", headers=_headers())

    assert response.status_code == 429
    assert response.json()["code"] == "rate_limited"
