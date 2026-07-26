from __future__ import annotations

from pathlib import Path

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("sqlalchemy")

from fastapi.testclient import TestClient  # noqa: E402

from btx_platform.api import create_app  # noqa: E402
from btx_platform.config import Settings  # noqa: E402
from btx_platform.db import init_db, make_engine, make_session_factory  # noqa: E402
from btx_platform.demo.definitions import DEMO_DISPLAY_NAME, DEMO_TENANT_ID  # noqa: E402
from btx_platform.demo.reset import create_demo_tenant_marker, reset_demo_tenant  # noqa: E402
from tests.auth_helpers import make_clerk_fixture  # noqa: E402

CLERK = make_clerk_fixture()


def _headers(**kwargs) -> dict[str, str]:
    return CLERK.headers(**kwargs)


def _build(tmp_path: Path):
    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    with sf() as session:
        create_demo_tenant_marker(session, DEMO_TENANT_ID, display_name=DEMO_DISPLAY_NAME)
        session.commit()
    reset_demo_tenant(sf, DEMO_TENANT_ID)
    settings = Settings(
        env="test",
        anthropic_api_key="anthropic-test-key",
        pipeline_generated_dir=str(tmp_path / "generated"),
        pipeline_output_dir=str(tmp_path / "artifacts"),
        pipeline_min_interval_seconds=0,
    )
    app = create_app(settings=settings, session_factory=sf, clerk_verifier=CLERK.verifier)
    return TestClient(app)


def test_viewer_can_ask_and_messages_persist_chronologically(tmp_path: Path):
    client = _build(tmp_path)
    viewer = _headers(role="viewer", tenant_id=DEMO_TENANT_ID)

    response = client.post(
        "/assistant/ask",
        headers=viewer,
        json={"message": "What should we do about Lockheed?", "context": {"account_id": "demo-acct-lockheed"}},
    )
    assert response.status_code == 200
    body = response.json()
    conversation_id = body["conversation"]["id"]
    assert body["assistant_message"]["role"] == "assistant"
    assert "Based on internal records" in body["assistant_message"]["content"]
    assert "Live capacity" in body["assistant_message"]["content"]
    assert body["assistant_message"]["citations"]
    assert not body["assistant_message"].get("reasoning")

    fetched = client.get(f"/assistant/conversations/{conversation_id}", headers=viewer)
    assert fetched.status_code == 200
    messages = fetched.json()["messages"]
    assert [message["role"] for message in messages] == ["user", "assistant"]
    assert messages[0]["content"] == "What should we do about Lockheed?"


def test_conversation_list_search_rename_archive_restore_and_tenant_scope(tmp_path: Path):
    client = _build(tmp_path)
    analyst = _headers(role="analyst", tenant_id=DEMO_TENANT_ID)
    other_tenant = _headers(role="analyst", tenant_id="tenant-other")

    listed = client.get("/assistant/conversations", headers=analyst)
    assert listed.status_code == 200
    assert any(row["id"] == "demo-assist-lockheed" for row in listed.json()["records"])
    assert all(row["status"] == "active" for row in listed.json()["records"])

    searched = client.get("/assistant/conversations?q=Lockheed", headers=analyst)
    assert [row["id"] for row in searched.json()["records"]] == ["demo-assist-lockheed"]

    renamed = client.patch(
        "/assistant/conversations/demo-assist-lockheed",
        headers=analyst,
        json={"title": "Ask: Lockheed demo prep"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "Ask: Lockheed demo prep"

    archived = client.patch(
        "/assistant/conversations/demo-assist-lockheed",
        headers=analyst,
        json={"status": "archived"},
    )
    assert archived.status_code == 200
    assert archived.json()["archived_at"]
    active = client.get("/assistant/conversations", headers=analyst).json()["records"]
    assert "demo-assist-lockheed" not in [row["id"] for row in active]

    blocked = client.post(
        "/assistant/conversations/demo-assist-lockheed/messages",
        headers=analyst,
        json={"message": "Retry the archived thread"},
    )
    assert blocked.status_code == 409

    restored = client.patch(
        "/assistant/conversations/demo-assist-lockheed",
        headers=analyst,
        json={"status": "active"},
    )
    assert restored.status_code == 200
    assert restored.json()["archived_at"] is None
    assert client.get("/assistant/conversations/demo-assist-lockheed", headers=other_tenant).status_code == 404


def test_grounding_citations_and_draft_previews_use_existing_systems(tmp_path: Path):
    client = _build(tmp_path)
    analyst = _headers(role="analyst", tenant_id=DEMO_TENANT_ID)

    response = client.post(
        "/assistant/ask",
        headers=analyst,
        json={"message": "Prepare executive account and meeting brief, then draft a follow up task.", "context": {"account_id": "demo-acct-lockheed"}},
    )
    assert response.status_code == 200
    assistant = response.json()["assistant_message"]
    citation_types = {citation["source_type"] for citation in assistant["citations"]}
    classifications = {citation["claim_classification"] for citation in assistant["citations"]}
    assert {"account", "signal", "score", "work_item"} <= citation_types
    assert "derived" in classifications
    assert "fact" in classifications
    assert assistant["action_draft"]["requires_confirmation"] is True
    assert assistant["action_draft"]["create_via"] == "POST /work-items"
    assert assistant["deliverable_draft"]["requires_confirmation"] is True
    assert assistant["deliverable_draft"]["create_via"] == "POST /deliverables"

    work_payload = assistant["action_draft"]["payload"]
    created_work = client.post("/work-items", headers=analyst, json=work_payload)
    assert created_work.status_code == 201
    assert created_work.json()["canonical_account_id"] == "demo-acct-lockheed"
    assert created_work.json()["audit_history"][0]["action"] == "create"

    deliverable_payload = assistant["deliverable_draft"]["payload"]
    created_deliverable = client.post("/deliverables", headers=analyst, json=deliverable_payload)
    assert created_deliverable.status_code == 201
    assert created_deliverable.json()["canonical_account_id"] == "demo-acct-lockheed"


def test_demo_reset_restores_seeded_assistant_records_idempotently(tmp_path: Path):
    client = _build(tmp_path)
    analyst = _headers(role="analyst", tenant_id=DEMO_TENANT_ID)

    first = client.get("/assistant/conversations?status=all", headers=analyst).json()["records"]
    second_reset_client = _build(tmp_path)
    second = second_reset_client.get("/assistant/conversations?status=all", headers=analyst).json()["records"]
    assert len(first) == len(second) == 2
    seeded = second_reset_client.get("/assistant/conversations/demo-assist-lockheed", headers=analyst).json()
    assert seeded["messages"][1]["citations"]
    assert all("reasoning" not in message for message in seeded["messages"])


def test_workspace_change_and_data_basis_intents_are_distinct_and_do_not_inherit_account(tmp_path: Path):
    client = _build(tmp_path)
    viewer = _headers(role="viewer", tenant_id=DEMO_TENANT_ID)

    changes = client.post(
        "/assistant/ask",
        headers=viewer,
        json={"message": "What changed today?", "context": {"account_id": "demo-acct-pulse-space"}},
    ).json()["assistant_message"]
    basis = client.post(
        "/assistant/ask",
        headers=viewer,
        json={"message": "Is this information live or simulated?", "context": {"account_id": "demo-acct-pulse-space"}},
    ).json()["assistant_message"]

    assert changes["content"].startswith("Today has")
    assert "Scope: workspace" in changes["content"]
    assert basis["content"].startswith("This workspace contains a mix")
    assert "simulated demonstration records" in basis["content"]
    assert changes["content"] != basis["content"]
    assert changes["metadata"]["scope"] == basis["metadata"]["scope"] == "workspace"
    assert changes["metadata"]["engine_mode"] == basis["metadata"]["engine_mode"] == "rules_based_fallback"


def test_assistant_citations_are_unique_by_source_type_and_record_id(tmp_path: Path):
    client = _build(tmp_path)
    viewer = _headers(role="viewer", tenant_id=DEMO_TENANT_ID)

    response = client.post(
        "/assistant/ask",
        headers=viewer,
        json={"message": "What changed today?"},
    )

    citations = response.json()["assistant_message"]["citations"]
    stable_ids = [(item["source_type"], item["record_id"]) for item in citations]
    assert len(stable_ids) == len(set(stable_ids))
