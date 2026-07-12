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
from btx_platform.ratelimit import RateLimiter  # noqa: E402
from tests.auth_helpers import make_clerk_fixture  # noqa: E402

CLERK = make_clerk_fixture()


def _headers(**kwargs) -> dict[str, str]:
    return CLERK.headers(**kwargs)


def _build(tmp_path: Path, *, rate_limiter: RateLimiter | None = None, **overrides):
    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    values = {
        "env": "test",
        "anthropic_api_key": "anthropic-test-key",
        "pipeline_generated_dir": str(tmp_path / "generated"),
        "pipeline_output_dir": str(tmp_path / "artifacts"),
        "pipeline_min_interval_seconds": 0,
        **overrides,
    }
    settings = Settings(**values)
    app = create_app(settings=settings, session_factory=sf, clerk_verifier=CLERK.verifier, rate_limiter=rate_limiter)
    return TestClient(app), sf, settings


def test_auth_rejects_protected_routes(tmp_path: Path):
    client, _sf, _settings = _build(tmp_path)
    assert client.get("/engine-config/scoring_weights").status_code == 401


def test_auth_rejects_expired_session(tmp_path: Path):
    client, _sf, _settings = _build(tmp_path)
    headers = CLERK.headers(expires_in=-10)
    response = client.get("/engine-config/scoring_weights", headers=headers)
    assert response.status_code == 401
    assert response.json()["code"] == "session_expired"


def test_viewer_role_cannot_mutate(tmp_path: Path):
    client, _sf, _settings = _build(tmp_path)
    headers = CLERK.headers(role="viewer")
    # Reading is fine for a viewer...
    assert client.get("/engine-config/scoring_weights", headers=headers).status_code == 200
    # ...mutating is not.
    document = client.get("/engine-config/scoring_weights", headers=headers).json()["document"]
    response = client.put(
        "/engine-config/scoring_weights",
        json={"document": document, "change_note": "viewer attempt"},
        headers=headers,
    )
    assert response.status_code == 403
    assert response.json()["code"] == "forbidden"


def test_tenant_cannot_read_another_tenants_work_items(tmp_path: Path):
    client, _sf, _settings = _build(tmp_path)
    tenant_a = CLERK.headers(tenant_id="tenant-a")
    tenant_b = CLERK.headers(tenant_id="tenant-b")

    created = client.post(
        "/work-items",
        headers=tenant_a,
        json={"type": "research_task", "recommended_action": "Research a signal."},
    )
    assert created.status_code == 201
    item_id = created.json()["id"]

    # Tenant B's list never contains tenant A's item.
    listed = client.get("/work-items", headers=tenant_b).json()["records"]
    assert item_id not in {item["id"] for item in listed}

    # Tenant B can't reach it directly either — same 404 as a truly-missing id.
    patched = client.patch(f"/work-items/{item_id}", headers=tenant_b, json={"owner": "intruder"})
    assert patched.status_code == 404

    # Tenant A still can.
    own = client.get("/work-items", headers=tenant_a).json()["records"]
    assert item_id in {item["id"] for item in own}


def test_per_user_rate_limit_blocks_excess_mutations(tmp_path: Path):
    limiter = RateLimiter(max_requests=2, window_seconds=60)
    client, _sf, _settings = _build(tmp_path, rate_limiter=limiter)
    headers = CLERK.headers(user_id="user-rate-limited")
    payload = {"type": "research_task", "recommended_action": "Research a signal."}

    first = client.post("/work-items", headers=headers, json=payload)
    second = client.post("/work-items", headers=headers, json=payload)
    third = client.post("/work-items", headers=headers, json=payload)

    assert first.status_code == 201
    assert second.status_code == 201
    assert third.status_code == 429
    assert third.json()["code"] == "rate_limited"

    # Reads are never rate-limited (only mutating methods hit the limiter).
    assert client.get("/work-items", headers=headers).status_code == 200

    # A different user has their own bucket and is unaffected.
    other = CLERK.headers(user_id="another-user")
    assert client.post("/work-items", headers=other, json=payload).status_code == 201


def test_latest_artifacts_public_and_reads_pipeline_output(tmp_path: Path):
    output_dir = tmp_path / "artifacts"
    output_dir.mkdir()
    (output_dir / "run_output.json").write_text(
        '{"meta":{"run_at":"2026-07-11T12:00:00Z"},"items":[]}',
        encoding="utf-8",
    )
    (output_dir / "archive.json").write_text('{"runs":[{"run_id":"r1"}],"pinned":[]}', encoding="utf-8")
    client, _sf, _settings = _build(tmp_path, pipeline_output_dir=str(output_dir))

    response = client.get("/artifacts/latest")

    assert response.status_code == 200
    body = response.json()
    assert body["data_provenance"] == "Monitor"
    assert body["run_output"]["meta"]["run_at"] == "2026-07-11T12:00:00Z"
    assert body["archive"]["runs"][0]["run_id"] == "r1"


def test_auth_rejects_malformed_bearer_token(tmp_path: Path):
    client, _sf, _settings = _build(tmp_path)

    response = client.get("/engine-config/scoring_weights", headers={"Authorization": "Bearer not-a-jwt"})

    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


def test_auth_not_configured_when_no_clerk_issuer(tmp_path: Path):
    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    settings = Settings(
        env="test",
        anthropic_api_key="anthropic-test-key",
        pipeline_generated_dir=str(tmp_path / "generated"),
        pipeline_output_dir=str(tmp_path / "artifacts"),
        pipeline_min_interval_seconds=0,
    )
    app = create_app(settings=settings, session_factory=sf)  # no clerk_verifier injected, no clerk_issuer
    client = TestClient(app)

    response = client.get("/engine-config/scoring_weights", headers=_headers())

    assert response.status_code == 503
    assert response.json()["code"] == "auth_not_configured"


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


def test_work_item_full_lifecycle_and_audit(tmp_path: Path):
    client, _sf, _settings = _build(tmp_path)

    created = client.post(
        "/work-items",
        headers=_headers(email="analyst@example.com"),
        json={
            "type": "account_action",
            "canonical_account_id": "acct-1",
            "source_signal_ids": ["sig-1"],
            "owner": "Riley",
            "priority": "high",
            "due_date": "2026-07-15T12:00:00Z",
            "recommended_action": "Call the account about the linked signal.",
            "approval_state": "pending",
        },
    )
    assert created.status_code == 201
    body = created.json()
    assert body["status"] == "proposed"
    assert body["audit_history"][0]["action"] == "create"
    assert body["audit_history"][0]["actor"] == "analyst@example.com"
    item_id = body["id"]

    approved = client.patch(
        f"/work-items/{item_id}",
        headers=_headers(email="manager@example.com"),
        json={"status": "approved", "approval_state": "approved"},
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"

    started = client.patch(
        f"/work-items/{item_id}",
        headers=_headers(),
        json={"status": "in_progress", "owner": "Morgan"},
    )
    assert started.status_code == 200
    assert started.json()["owner"] == "Morgan"

    done = client.patch(
        f"/work-items/{item_id}",
        headers=_headers(email="morgan@example.com"),
        json={"status": "done", "execution_state": "completed", "outcome": "Customer meeting booked."},
    )
    assert done.status_code == 200
    final = done.json()
    assert final["status"] == "done"
    assert final["outcome"] == "Customer meeting booked."
    assert [entry["action"] for entry in final["audit_history"]] == ["create", "patch", "patch", "patch"]
    assert final["audit_history"][-1]["before"]["status"] == "in_progress"
    assert final["audit_history"][-1]["after"]["status"] == "done"


def test_work_item_dismiss_requires_reason_and_records_it(tmp_path: Path):
    client, _sf, _settings = _build(tmp_path)
    created = client.post(
        "/work-items",
        headers=_headers(),
        json={"type": "research_task", "recommended_action": "Research a signal."},
    )
    item_id = created.json()["id"]

    missing = client.post(f"/work-items/{item_id}/dismiss", headers=_headers(), json={"reason": ""})
    assert missing.status_code == 422

    dismissed = client.post(
        f"/work-items/{item_id}/dismiss",
        headers=_headers(email="reviewer@example.com"),
        json={"reason": "Not relevant to this account."},
    )
    assert dismissed.status_code == 200
    body = dismissed.json()
    assert body["status"] == "dismissed"
    assert body["outcome"] == "Not relevant to this account."
    assert body["audit_history"][-1]["action"] == "dismiss"
    assert body["audit_history"][-1]["actor"] == "reviewer@example.com"

    invalid = client.post(
        "/work-items",
        headers=_headers(),
        json={"type": "dismissed", "status": "dismissed", "recommended_action": "Dismiss without reason."},
    )
    assert invalid.status_code == 422


def test_work_item_filters_and_derived_views(tmp_path: Path):
    client, _sf, _settings = _build(tmp_path)

    def create(payload):
        response = client.post("/work-items", headers=_headers(), json=payload)
        assert response.status_code == 201
        return response.json()

    attention = create({
        "type": "capacity_check",
        "canonical_account_id": "acct-1",
        "owner": "Riley",
        "priority": "urgent",
        "due_date": "2026-07-13T09:00:00Z",
        "recommended_action": "Check capacity before quoting.",
    })
    prepared = create({
        "type": "meeting_brief",
        "canonical_account_id": "acct-2",
        "owner": "Morgan",
        "priority": "normal",
        "generated_artifact_ref": "brief://acct-2/1",
        "recommended_action": "Review generated meeting brief.",
    })
    approval = create({
        "type": "outreach_draft",
        "canonical_account_id": "acct-2",
        "owner": "Morgan",
        "priority": "low",
        "approval_state": "pending",
        "recommended_action": "Approve outreach draft.",
    })
    outcome = create({
        "type": "customer_question",
        "canonical_account_id": "acct-3",
        "owner": "Riley",
        "priority": "normal",
        "recommended_action": "Answer customer question.",
    })
    client.patch(f"/work-items/{outcome['id']}", headers=_headers(), json={"status": "approved"})
    client.patch(f"/work-items/{outcome['id']}", headers=_headers(), json={"status": "in_progress"})
    client.patch(f"/work-items/{outcome['id']}", headers=_headers(), json={"status": "done", "outcome": "Answered."})

    by_account = client.get("/work-items?account=acct-2", headers=_headers()).json()["records"]
    assert {item["id"] for item in by_account} == {prepared["id"], approval["id"]}

    by_owner = client.get("/work-items?owner=Riley", headers=_headers()).json()["records"]
    assert {item["id"] for item in by_owner} == {attention["id"], outcome["id"]}

    needs_attention = client.get("/work-items?view=needs_attention", headers=_headers()).json()["records"]
    assert {item["id"] for item in needs_attention} == {attention["id"]}

    prepared_view = client.get("/work-items?view=prepared", headers=_headers()).json()["records"]
    assert {item["id"] for item in prepared_view} == {prepared["id"]}

    approval_view = client.get("/work-items?view=needs_approval", headers=_headers()).json()["records"]
    assert {item["id"] for item in approval_view} == {approval["id"]}

    outcomes = client.get("/work-items?view=outcomes", headers=_headers()).json()["records"]
    assert {item["id"] for item in outcomes} == {outcome["id"]}
