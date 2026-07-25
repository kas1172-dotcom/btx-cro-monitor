from __future__ import annotations

from pathlib import Path

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("sqlalchemy")

from fastapi.testclient import TestClient  # noqa: E402

from btx_platform import models  # noqa: E402
from btx_platform.api import create_app  # noqa: E402
from btx_platform.config import Settings  # noqa: E402
from btx_platform.db import init_db, make_engine, make_session_factory  # noqa: E402
from btx_platform.demo.definitions import DEMO_TENANT_ID  # noqa: E402
from btx_platform.demo.reset import DemoResetError, reset_demo_tenant  # noqa: E402
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
        hubspot_access_token=None,
    )
    app = create_app(settings=settings, session_factory=sf, clerk_verifier=CLERK.verifier)
    return TestClient(app), sf


def _counts(sf, tenant_id: str = DEMO_TENANT_ID) -> dict[str, int]:
    with sf() as session:
        return {
            "accounts": session.query(models.CanonicalAccount).filter(models.CanonicalAccount.tenant_id == tenant_id).count(),
            "signals": session.query(models.IntelligenceSignal).filter(models.IntelligenceSignal.tenant_id == tenant_id).count(),
            "relationships": session.query(models.SignalAccountRelationship).filter(models.SignalAccountRelationship.tenant_id == tenant_id).count(),
            "work_items": session.query(models.WorkItem).filter(models.WorkItem.tenant_id == tenant_id).count(),
            "deliverables": session.query(models.Deliverable).filter(models.Deliverable.tenant_id == tenant_id).count(),
            "notes": session.query(models.WorkItemNote).filter(models.WorkItemNote.tenant_id == tenant_id).count(),
        }


def _fingerprint(sf) -> dict:
    with sf() as session:
        return {
            "accounts": [row.id for row in session.query(models.CanonicalAccount).filter(models.CanonicalAccount.tenant_id == DEMO_TENANT_ID).order_by(models.CanonicalAccount.id).all()],
            "signals": [row.id for row in session.query(models.IntelligenceSignal).filter(models.IntelligenceSignal.tenant_id == DEMO_TENANT_ID).order_by(models.IntelligenceSignal.id).all()],
            "relationships": [(row.id, row.review_status) for row in session.query(models.SignalAccountRelationship).filter(models.SignalAccountRelationship.tenant_id == DEMO_TENANT_ID).order_by(models.SignalAccountRelationship.id).all()],
            "work": [(row.id, row.status, row.approval_state, row.execution_state, row.dedupe_key) for row in session.query(models.WorkItem).filter(models.WorkItem.tenant_id == DEMO_TENANT_ID).order_by(models.WorkItem.id).all()],
            "deliverables": [row.id for row in session.query(models.Deliverable).filter(models.Deliverable.tenant_id == DEMO_TENANT_ID).order_by(models.Deliverable.id).all()],
        }


def test_reset_requires_explicit_tenant(tmp_path: Path):
    _client, sf = _build(tmp_path)
    with pytest.raises(DemoResetError, match="explicit"):
        reset_demo_tenant(sf, None)


def test_reset_rejects_unknown_and_non_demo_tenants(tmp_path: Path):
    _client, sf = _build(tmp_path)
    with pytest.raises(DemoResetError, match="not found"):
        reset_demo_tenant(sf, "unknown-tenant")
    with sf() as session:
        session.add(models.Tenant(id="normal-tenant", display_name="Normal Tenant", is_demonstration=False, demo_metadata={}))
        session.commit()
    with pytest.raises(DemoResetError, match="not marked"):
        reset_demo_tenant(sf, "normal-tenant")


def test_dry_run_and_verify_only_do_not_mutate(tmp_path: Path):
    _client, sf = _build(tmp_path)
    before = _counts(sf)
    dry = reset_demo_tenant(sf, DEMO_TENANT_ID, dry_run=True)
    assert dry.dry_run
    assert _counts(sf) == before

    reset_demo_tenant(sf, DEMO_TENANT_ID)
    after_reset = _fingerprint(sf)
    verify = reset_demo_tenant(sf, DEMO_TENANT_ID, verify_only=True)
    assert verify.verify_only
    assert _fingerprint(sf) == after_reset


def test_reset_is_deterministic_idempotent_and_tenant_isolated(tmp_path: Path):
    _client, sf = _build(tmp_path)
    with sf() as session:
        session.add(models.Tenant(id="other-tenant", display_name="Other", is_demonstration=False, demo_metadata={}))
        session.add(models.CanonicalAccount(id="other-acct", tenant_id="other-tenant", legal_name="Other Account", display_name="Other Account"))
        session.commit()

    first = reset_demo_tenant(sf, DEMO_TENANT_ID)
    first_fingerprint = _fingerprint(sf)
    second = reset_demo_tenant(sf, DEMO_TENANT_ID)

    assert first.accounts == 3
    assert first.signals == 3
    assert first.relationships == 2
    assert first.work_items == 6
    assert second.as_dict() == {**first.as_dict(), "message": second.message}
    assert _fingerprint(sf) == first_fingerprint
    assert _counts(sf, "other-tenant")["accounts"] == 1


def test_reset_rolls_back_on_failure(tmp_path: Path):
    _client, sf = _build(tmp_path)
    reset_demo_tenant(sf, DEMO_TENANT_ID)
    before = _fingerprint(sf)

    with pytest.raises(DemoResetError, match="Injected failure"):
        reset_demo_tenant(sf, DEMO_TENANT_ID, fail_stage="after_delete")

    assert _fingerprint(sf) == before


def test_demo_world_snapshot_loads_expected_story(tmp_path: Path):
    client, sf = _build(tmp_path)
    reset_demo_tenant(sf, DEMO_TENANT_ID)

    body = client.get("/world-snapshot", headers=_headers(tenant_id=DEMO_TENANT_ID, role="cro")).json()

    assert body["tenant"]["isDemonstration"] is True
    assert body["tenant"]["demoNotice"] == "Public intelligence is sourced. Internal BTX records are illustrative."
    assert len(body["accounts"]) == 3
    assert len(body["programs"]) == 2
    assert len(body["signals"]) == 3
    assert any(signal["scope"] == "specific_account" for signal in body["signals"])
    assert any(signal["scope"] == "market" for signal in body["signals"])
    # The demo is exactly two journeys: Lockheed as customer, nLIGHT as prospect.
    account_status = {account["id"]: account["account_status"] for account in body["accounts"]}
    assert account_status["demo-acct-lockheed"] == "current_customer"
    assert account_status["demo-acct-nlight"] == "target_prospect"
    # The prospect journey must name what it is missing rather than fill the gaps in.
    nlight_research = next(item for item in body["workItems"] if item["id"] == "demo-wi-research-nlight")
    assert len(nlight_research["missing_information"]) == 4
    # A scored customer next to an honestly unscored prospect is the demo's point.
    attractiveness = {row["entityId"]: row for row in body["scores"]["accountAttractiveness"]}
    lockheed = attractiveness["demo-acct-lockheed"]
    assert lockheed["status"] == "available"
    assert isinstance(lockheed["score"], (int, float))
    assert lockheed["result"]["dataCompleteness"] >= 0.60
    contributing = [f for f in lockheed["result"]["positiveFactors"] if f["contribution"] is not None]
    assert len(contributing) >= 4
    nlight = attractiveness["demo-acct-nlight"]
    assert nlight["status"] == "insufficient_data"
    assert nlight["score"] is None
    assert body["relationshipReview"]["records"][0]["id"] == "demo-rel-nlight-review"
    assert any(item["approval_state"] == "pending" for item in body["workItems"])
    assert any(item["execution_state"] == "verified" and item["external_system"] == "hubspot-demo" for item in body["workItems"])
    assert any(item["status"] == "verified" and not item["outcome"] for item in body["workItems"])
    assert any(item["outcome_category"] == "learning" for item in body["workItems"])
    assert body["deliverables"][0]["id"] == "demo-deliv-lockheed-brief"
    assert body["deliverables"][0]["title"] == "Executive Account and Meeting Brief - Lockheed Martin Corporation"
    detail = client.get("/deliverables/demo-deliv-lockheed-brief", headers=_headers(tenant_id=DEMO_TENANT_ID, role="cro")).json()
    headings = {section["heading"] for section in detail["document"]["sections"]}
    assert {"Cover", "Executive Summary", "Decision Summary", "Sources And Data Notes"} <= headings
    assert {row["availability"] for row in body["sourceHealth"]} >= {"simulated", "stale", "not_configured"}


def test_demo_world_snapshot_does_not_mutate_seeded_workspace(tmp_path: Path):
    client, sf = _build(tmp_path)
    reset_demo_tenant(sf, DEMO_TENANT_ID)
    before = _fingerprint(sf)

    body = client.get("/world-snapshot", headers=_headers(tenant_id=DEMO_TENANT_ID, role="cro")).json()

    assert len(body["accounts"]) == 3
    assert len(body["signals"]) == 3
    assert len(body["workItems"]) == 6
    assert all(
        row["sourceDataVersion"].startswith(f"{DEMO_TENANT_ID}:demo-reset:")
        for row in body["scoreHistory"]["records"]
    )
    reset_demo_tenant(sf, DEMO_TENANT_ID, verify_only=True)
    assert _fingerprint(sf) == before


def test_normal_tenant_has_no_demo_notice(tmp_path: Path):
    client, _sf = _build(tmp_path)

    body = client.get("/world-snapshot", headers=_headers(tenant_id="normal-tenant")).json()

    assert body["tenant"]["isDemonstration"] is False
    assert body["tenant"]["demoNotice"] is None
