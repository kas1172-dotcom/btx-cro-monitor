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


def _payload(deliverable_id: str = "deliv-test-1") -> dict:
    return {
        "id": deliverable_id,
        "type": "meeting_brief",
        "title": "Trinity Defense meeting brief",
        "canonical_account_id": "hubspot-company-332413222630",
        "entity_ids": ["hubspot-company-332413222630"],
        "document": {
            "id": deliverable_id,
            "type": "meeting_brief",
            "title": "Trinity Defense meeting brief",
            "createdAt": "2026-07-13T12:00:00Z",
            "brainArea": "workflow",
            "entityIds": ["hubspot-company-332413222630"],
            "sections": [{"id": "summary", "heading": "Summary", "blocks": [{"kind": "text", "text": "Brief body."}]}],
            "sources": [],
            "confidence": "medium",
            "actions": [],
        },
    }


def test_deliverables_create_list_get_and_patch(tmp_path: Path):
    client = _build(tmp_path)
    headers = _headers()

    created = client.post("/deliverables", headers=headers, json=_payload())
    assert created.status_code == 201
    assert created.json()["title"] == "Trinity Defense meeting brief"

    listed = client.get("/deliverables?account=hubspot-company-332413222630", headers=headers)
    assert listed.status_code == 200
    assert [record["id"] for record in listed.json()["records"]] == ["deliv-test-1"]

    detail = client.get("/deliverables/deliv-test-1", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["document"]["sections"][0]["heading"] == "Summary"

    patched_document = detail.json()["document"]
    patched_document["sections"].append({"id": "next", "heading": "Next step", "blocks": [{"kind": "text", "text": "Follow up."}]})
    patched = client.patch(
        "/deliverables/deliv-test-1",
        headers=headers,
        json={"title": "Updated brief", "document": patched_document, "entity_ids": ["hubspot-company-332413222630", "signal-1"]},
    )
    assert patched.status_code == 200
    assert patched.json()["title"] == "Updated brief"
    assert patched.json()["entity_ids"] == ["hubspot-company-332413222630", "signal-1"]
    assert patched.json()["document"]["sections"][1]["heading"] == "Next step"


def test_deliverables_are_tenant_scoped(tmp_path: Path):
    client = _build(tmp_path)
    tenant_a = _headers(tenant_id="tenant-a")
    tenant_b = _headers(tenant_id="tenant-b")

    created = client.post("/deliverables", headers=tenant_a, json=_payload())
    assert created.status_code == 201

    assert client.get("/deliverables/deliv-test-1", headers=tenant_b).status_code == 404
    assert client.patch("/deliverables/deliv-test-1", headers=tenant_b, json={"title": "Nope"}).status_code == 404
    assert client.get("/deliverables", headers=tenant_b).json()["records"] == []


def test_viewer_role_cannot_mutate_deliverables(tmp_path: Path):
    client = _build(tmp_path)
    viewer = _headers(role="viewer")

    assert client.get("/deliverables", headers=viewer).status_code == 200
    response = client.post("/deliverables", headers=viewer, json=_payload())

    assert response.status_code == 403
    assert response.json()["code"] == "forbidden"
