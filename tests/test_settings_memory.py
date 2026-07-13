from __future__ import annotations

from pathlib import Path

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("sqlalchemy")

from fastapi.testclient import TestClient  # noqa: E402

from btx_platform.api import create_app  # noqa: E402
from btx_platform.config import Settings  # noqa: E402
from btx_platform.db import init_db, make_engine, make_session_factory  # noqa: E402
from tests.auth_helpers import make_clerk_fixture  # noqa: E402

CLERK = make_clerk_fixture()


def _headers(**kwargs) -> dict[str, str]:
    return CLERK.headers(**kwargs)


def _build(tmp_path: Path):
    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    settings = Settings(env="test", pipeline_generated_dir=str(tmp_path / "generated"))
    app = create_app(settings=settings, session_factory=sf, clerk_verifier=CLERK.verifier)
    return TestClient(app), sf


def _deliverable_payload(deliverable_id: str = "deliv-1") -> dict:
    return {
        "id": deliverable_id,
        "type": "meeting_brief",
        "title": "Trinity meeting brief",
        "canonical_account_id": "hubspot-company-1",
        "document": {
            "id": deliverable_id,
            "type": "meeting_brief",
            "title": "Trinity meeting brief",
            "createdAt": "2026-07-13T12:00:00Z",
            "brainArea": "customer",
            "entityIds": ["hubspot-company-1"],
            "sections": [],
            "sources": [],
            "confidence": "high",
        },
    }


def test_deliverable_templates_seed_patch_and_viewer_permissions(tmp_path: Path):
    client, _sf = _build(tmp_path)

    listed = client.get("/deliverable-templates", headers=_headers(role="viewer"))
    assert listed.status_code == 200
    records = listed.json()["records"]
    assert len(records) == 8
    assert [row["agent_id"] for row in records][:2] == ["weekly_memo", "meeting_brief"]

    viewer_patch = client.patch(
        "/deliverable-templates/meeting_brief",
        headers=_headers(role="viewer"),
        json={"enabled": False},
    )
    assert viewer_patch.status_code == 403

    patched = client.patch(
        "/deliverable-templates/meeting_brief",
        headers=_headers(role="analyst"),
        json={"enabled": False, "order": 99, "prompt_override": "Use the CRO's preferred brief rubric."},
    )
    assert patched.status_code == 200
    assert patched.json()["enabled"] is False
    assert patched.json()["order"] == 99
    assert patched.json()["prompt_override"] == "Use the CRO's preferred brief rubric."


def test_integration_request_create_list_and_status(tmp_path: Path):
    client, _sf = _build(tmp_path)

    created = client.post(
        "/integration-requests",
        headers=_headers(),
        json={"requester_name": "Kapil", "integration_name": "NetSuite", "notes": "Pull backlog and capacity."},
    )
    assert created.status_code == 201
    body = created.json()
    assert body["status"] == "pending"
    assert body["integration_name"] == "NetSuite"

    listed = client.get("/integration-requests", headers=_headers())
    assert listed.status_code == 200
    assert listed.json()["records"][0]["id"] == body["id"]

    patched = client.patch(f"/integration-requests/{body['id']}", headers=_headers(), json={"status": "reviewed"})
    assert patched.status_code == 200
    assert patched.json()["status"] == "reviewed"


def test_deliverables_crud_filters_and_tenant_isolation(tmp_path: Path):
    client, _sf = _build(tmp_path)
    tenant_a = _headers(tenant_id="tenant-a")
    tenant_b = _headers(tenant_id="tenant-b")

    created = client.post("/deliverables", headers=tenant_a, json=_deliverable_payload())
    assert created.status_code == 201
    assert created.json()["canonical_account_id"] == "hubspot-company-1"

    filtered = client.get("/deliverables?account=hubspot-company-1&type=meeting_brief", headers=tenant_a)
    assert filtered.status_code == 200
    assert [row["id"] for row in filtered.json()["records"]] == ["deliv-1"]

    tenant_b_list = client.get("/deliverables", headers=tenant_b)
    assert tenant_b_list.status_code == 200
    assert tenant_b_list.json()["records"] == []

    tenant_b_get = client.get("/deliverables/deliv-1", headers=tenant_b)
    assert tenant_b_get.status_code == 404

    patched = client.patch(
        "/deliverables/deliv-1",
        headers=tenant_a,
        json={"title": "Updated brief", "document": {**created.json()["document"], "title": "Updated brief"}},
    )
    assert patched.status_code == 200
    assert patched.json()["title"] == "Updated brief"
    assert patched.json()["document"]["title"] == "Updated brief"


def test_viewer_can_read_but_not_mutate_deliverables_and_requests(tmp_path: Path):
    client, _sf = _build(tmp_path)
    viewer = _headers(role="viewer")

    assert client.get("/deliverables", headers=viewer).status_code == 200
    assert client.get("/integration-requests", headers=viewer).status_code == 200
    assert client.post("/deliverables", headers=viewer, json=_deliverable_payload()).status_code == 403
    assert client.post(
        "/integration-requests",
        headers=viewer,
        json={"requester_name": "Viewer", "integration_name": "Slack"},
    ).status_code == 403
