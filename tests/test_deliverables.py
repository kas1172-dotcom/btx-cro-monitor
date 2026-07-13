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
    settings = Settings(
        env="test",
        anthropic_api_key="anthropic-test-key",
        pipeline_generated_dir=str(tmp_path / "generated"),
        pipeline_output_dir=str(tmp_path / "artifacts"),
        pipeline_min_interval_seconds=0,
    )
    app = create_app(settings=settings, session_factory=sf, clerk_verifier=CLERK.verifier)
    return TestClient(app)


def _deliverable_payload(title: str = "Trinity Defense meeting brief") -> dict:
    return {
        "type": "meeting_brief",
        "title": title,
        "canonical_account_id": "hubspot-company-332413222630",
        "program_id": "f-35",
        "trip_id": None,
        "document": {
            "id": "frontend-deliv-1",
            "type": "meeting_brief",
            "title": title,
            "createdAt": "2026-07-13T12:00:00Z",
            "brainArea": "accounts",
            "entityIds": ["hubspot-company-332413222630"],
            "sections": [
                {
                    "id": "summary",
                    "heading": "Summary",
                    "blocks": [{"kind": "text", "text": "Relationship-backed brief body."}],
                }
            ],
            "sources": [{"source": "HubSpot", "records": ["332413222630"], "reason": "Canonical account source."}],
            "confidence": "high",
            "actions": [],
        },
    }


def test_deliverable_crud_lifecycle(tmp_path: Path):
    client = _build(tmp_path)
    headers = _headers()

    created = client.post("/deliverables", headers=headers, json=_deliverable_payload())
    assert created.status_code == 201
    created_body = created.json()
    deliverable_id = created_body["id"]
    assert len(deliverable_id) == 32
    assert created_body["canonical_account_id"] == "hubspot-company-332413222630"
    assert created_body["program_id"] == "f-35"
    assert created_body["document"]["sections"][0]["heading"] == "Summary"

    listed = client.get("/deliverables?account=hubspot-company-332413222630&type=meeting_brief", headers=headers)
    assert listed.status_code == 200
    assert [record["id"] for record in listed.json()["records"]] == [deliverable_id]

    fetched = client.get(f"/deliverables/{deliverable_id}", headers=headers)
    assert fetched.status_code == 200
    assert fetched.json()["title"] == "Trinity Defense meeting brief"

    patched_document = fetched.json()["document"]
    patched_document["title"] = "Updated Trinity brief"
    patched_document["sections"].append({
        "id": "next-step",
        "heading": "Next step",
        "blocks": [{"kind": "text", "text": "Confirm 5-axis capacity fit."}],
    })
    patched = client.patch(
        f"/deliverables/{deliverable_id}",
        headers=headers,
        json={
            "title": "Updated Trinity brief",
            "canonical_account_id": "hubspot-company-332413222630",
            "program_id": "ngad",
            "trip_id": "trip-2026-07",
            "document": patched_document,
        },
    )
    assert patched.status_code == 200
    assert patched.json()["title"] == "Updated Trinity brief"
    assert patched.json()["program_id"] == "ngad"
    assert patched.json()["trip_id"] == "trip-2026-07"

    refetched = client.get(f"/deliverables/{deliverable_id}", headers=headers)
    assert refetched.status_code == 200
    assert refetched.json()["document"]["sections"][1]["heading"] == "Next step"
    assert refetched.json()["updated_at"] >= refetched.json()["created_at"]


def test_tenant_cannot_read_or_patch_another_tenants_deliverable(tmp_path: Path):
    client = _build(tmp_path)
    tenant_a = _headers(tenant_id="tenant-a")
    tenant_b = _headers(tenant_id="tenant-b")

    created = client.post("/deliverables", headers=tenant_a, json=_deliverable_payload())
    assert created.status_code == 201
    deliverable_id = created.json()["id"]

    assert client.get(f"/deliverables/{deliverable_id}", headers=tenant_b).status_code == 404
    assert client.patch(f"/deliverables/{deliverable_id}", headers=tenant_b, json={"title": "Nope"}).status_code == 404
    assert client.get("/deliverables", headers=tenant_b).json()["records"] == []


def test_viewer_role_can_read_but_not_mutate_deliverables(tmp_path: Path):
    client = _build(tmp_path)
    analyst = _headers(role="analyst")
    viewer = _headers(role="viewer")

    created = client.post("/deliverables", headers=analyst, json=_deliverable_payload())
    assert created.status_code == 201
    deliverable_id = created.json()["id"]

    assert client.get("/deliverables", headers=viewer).status_code == 200
    assert client.get(f"/deliverables/{deliverable_id}", headers=viewer).status_code == 200
    assert client.post("/deliverables", headers=viewer, json=_deliverable_payload()).status_code == 403
    assert client.patch(f"/deliverables/{deliverable_id}", headers=viewer, json={"title": "Viewer edit"}).status_code == 403
