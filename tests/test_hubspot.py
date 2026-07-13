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
from btx_platform.hubspot import (  # noqa: E402
    HubSpotClient,
    HubSpotError,
    HubSpotObject,
    HubSpotOwner,
    HubSpotTaskAssociation,
    map_companies,
    map_contacts,
    map_deals,
)
from tests.auth_helpers import make_clerk_fixture  # noqa: E402

CLERK = make_clerk_fixture()


def _headers(**kwargs) -> dict[str, str]:
    return CLERK.headers(**kwargs)


class FakeHttpxClient:
    calls: list[tuple[str, str, dict]] = []
    responses: list[httpx.Response] = []

    def __init__(self, timeout: float):
        self.timeout = timeout

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return None

    def request(self, method: str, url: str, headers: dict, **kwargs):
        self.calls.append((method, url, kwargs))
        response = self.responses.pop(0)
        response.request = httpx.Request(method, url)
        return response


def test_hubspot_pagination_and_rate_limit(monkeypatch):
    sleeps: list[float] = []
    FakeHttpxClient.calls = []
    FakeHttpxClient.responses = [
        httpx.Response(429, headers={"retry-after": "0"}),
        httpx.Response(200, json={
            "results": [{"id": "1", "properties": {"name": "Acme"}}],
            "paging": {"next": {"link": "https://api.hubapi.com/page-2"}},
        }),
        httpx.Response(200, json={"results": [{"id": "2", "properties": {"name": "Bravo"}}]}),
    ]
    monkeypatch.setattr("btx_platform.hubspot.httpx.Client", FakeHttpxClient)

    client = HubSpotClient("token", sleep=sleeps.append)
    records = client.list_companies()

    assert [record.id for record in records] == ["1", "2"]
    assert sleeps == [0.0]
    assert FakeHttpxClient.calls[0][0] == "GET"
    assert "btx_aliases" in FakeHttpxClient.calls[1][2]["params"]["properties"]
    assert "btx_known_programs" in FakeHttpxClient.calls[1][2]["params"]["properties"]
    assert FakeHttpxClient.calls[2][1] == "https://api.hubapi.com/page-2"


def test_hubspot_association_batch_read(monkeypatch):
    FakeHttpxClient.calls = []
    FakeHttpxClient.responses = [
        httpx.Response(200, json={
            "results": [
                {"from": {"id": "10"}, "to": [{"toObjectId": "20"}, {"toObjectId": "21"}]},
                {"from": {"id": "11"}, "to": []},
            ],
        }),
    ]
    monkeypatch.setattr("btx_platform.hubspot.httpx.Client", FakeHttpxClient)

    associations = HubSpotClient("token").read_associations("companies", "contacts", ["10", "11"])

    assert associations == {"10": ["20", "21"], "11": []}
    assert FakeHttpxClient.calls[0][1].endswith("/crm/v4/associations/companies/contacts/batch/read")
    assert FakeHttpxClient.calls[0][2]["json"]["inputs"] == [{"id": "10"}, {"id": "11"}]


def test_hubspot_create_task_payload_includes_associations(monkeypatch):
    FakeHttpxClient.calls = []
    FakeHttpxClient.responses = [
        httpx.Response(200, json={"results": [{"category": "HUBSPOT_DEFINED", "label": None, "typeId": 192}]}),
        httpx.Response(200, json={"id": "9001"}),
    ]
    monkeypatch.setattr("btx_platform.hubspot.httpx.Client", FakeHttpxClient)

    result = HubSpotClient("token").create_task(
        subject="Follow up",
        body="Body text",
        timestamp="2026-07-15T12:00:00Z",
        associations=[HubSpotTaskAssociation("companies", "123")],
    )

    assert result["id"] == "9001"
    assert FakeHttpxClient.calls[0][1].endswith("/crm/v4/associations/tasks/companies/labels")
    method, url, kwargs = FakeHttpxClient.calls[1]
    assert method == "POST"
    assert url.endswith("/crm/v3/objects/tasks")
    assert kwargs["json"] == {
        "properties": {
            "hs_task_subject": "Follow up",
            "hs_task_body": "Body text",
            "hs_timestamp": "2026-07-15T12:00:00Z",
            "hs_task_status": "NOT_STARTED",
        },
        "associations": [{
            "to": {"id": "123"},
            "types": [{"associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 192}],
        }],
    }


def test_hubspot_batch_create_companies_and_contacts_payload(monkeypatch):
    FakeHttpxClient.calls = []
    FakeHttpxClient.responses = [
        httpx.Response(200, json={"results": [{"id": "company-1", "objectWriteTraceId": "row-1"}]}),
        httpx.Response(200, json={"results": [{"id": "contact-1", "objectWriteTraceId": "row-1"}]}),
    ]
    monkeypatch.setattr("btx_platform.hubspot.httpx.Client", FakeHttpxClient)

    client = HubSpotClient("token")
    company_result = client.create_companies_batch([
        {"objectWriteTraceId": "row-1", "properties": {"name": "Trinity Defense Components", "domain": "trinity.example"}},
    ])
    contact_result = client.create_contacts_batch([
        {"objectWriteTraceId": "row-1", "properties": {"email": "buyer@trinity.example", "firstname": "Riley"}},
    ])

    assert company_result["results"][0]["id"] == "company-1"
    assert contact_result["results"][0]["id"] == "contact-1"
    company_call = FakeHttpxClient.calls[0]
    contact_call = FakeHttpxClient.calls[1]
    assert company_call[0] == "POST"
    assert company_call[1].endswith("/crm/objects/2026-03/companies/batch/create")
    assert contact_call[1].endswith("/crm/objects/2026-03/contacts/batch/create")
    assert company_call[2]["json"] == {
        "inputs": [{
            "properties": {"name": "Trinity Defense Components", "domain": "trinity.example"},
            "objectWriteTraceId": "row-1",
        }],
    }


def test_hubspot_mappers_emit_frontend_shapes():
    owners = {"7": HubSpotOwner(id="7", name="Riley Owner", email="riley@example.com")}
    companies = map_companies(
        [HubSpotObject(id="1", properties={
            "name": "Acme Aero",
            "domain": "acme.example",
            "city": "Pittsburgh",
            "state": "PA",
            "hubspot_owner_id": "7",
            "btx_needs": "ITAR, precision machining",
            "btx_aliases": "Acme; Acme Aero Systems",
            "btx_facility_names": "Acme Pittsburgh",
            "btx_cage_code": "1ABC2",
            "btx_uei": "ABCDE12345",
            "btx_known_programs": "F-35; B-21",
            "btx_known_customers": "USAF; Navy",
        })],
        owners,
        {"1": ["2"]},
        {"1": ["3"]},
    )
    contacts = map_contacts(
        [HubSpotObject(id="2", properties={"firstname": "Ari", "lastname": "Lee", "jobtitle": "Buyer"})],
        owners,
        {"2": ["1"]},
    )
    deals = map_deals(
        [HubSpotObject(id="3", properties={"dealname": "F-35 Bracket", "amount": "125000", "closedate": "2026-09-01", "dealstage": "contractsent"})],
        owners,
        {"3": ["1"]},
    )

    assert companies[0]["id"] == "hubspot-company-1"
    assert companies[0]["canonical_account_id"] == "hubspot-company-1"
    assert companies[0]["hubspot_company_id"] == "1"
    assert companies[0]["domains"] == ["acme.example"]
    assert companies[0]["aliases"] == ["Acme", "Acme Aero Systems"]
    assert companies[0]["facility_names"] == ["Acme Pittsburgh"]
    assert companies[0]["cage_code"] == "1ABC2"
    assert companies[0]["uei"] == "ABCDE12345"
    assert companies[0]["known_programs"] == ["F-35", "B-21"]
    assert companies[0]["known_customers"] == ["USAF", "Navy"]
    assert companies[0]["location"]["city"] == "Pittsburgh"
    assert companies[0]["relationship"] == "customer"
    assert companies[0]["needs"] == ["ITAR", "precision machining"]
    assert companies[0]["contact_ids"] == ["hubspot-contact-2"]
    assert companies[0]["deal_ids"] == ["hubspot-deal-3"]
    assert companies[0]["data_provenance"] == "HubSpot"
    assert contacts[0]["company_id"] == "hubspot-company-1"
    assert contacts[0]["name"] == "Ari Lee"
    assert deals[0]["company_id"] == "hubspot-company-1"
    assert deals[0]["stage"] == "proposal"
    assert deals[0]["value"] == 125000


def test_crm_route_uses_five_minute_cache(monkeypatch, tmp_path: Path):
    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    settings = Settings(env="test", hubspot_access_token="hubspot-token")
    app = create_app(settings=settings, session_factory=sf, clerk_verifier=CLERK.verifier)
    client = TestClient(app)
    calls = 0

    def fake_payload(_client, kind):
        nonlocal calls
        calls += 1
        return {"data_provenance": "HubSpot", "records": [{"id": f"{kind}-{calls}"}]}

    monkeypatch.setattr("btx_platform.api.hubspot_payload", fake_payload)

    first = client.get("/crm/accounts", headers=_headers())
    second = client.get("/crm/accounts", headers=_headers())
    assert first.json()["records"] == [{"id": "accounts-1"}]
    assert second.json()["records"] == [{"id": "accounts-1"}]
    assert calls == 1

    app.state.crm_cache["accounts"] = (0.0, first.json())
    third = client.get("/crm/accounts", headers=_headers())
    assert third.json()["records"] == [{"id": "accounts-2"}]
    assert calls == 2


def test_crm_accounts_sync_canonical_account(monkeypatch, tmp_path: Path):
    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    settings = Settings(env="test", hubspot_access_token="hubspot-token")
    app = create_app(settings=settings, session_factory=sf, clerk_verifier=CLERK.verifier)
    client = TestClient(app)

    def fake_payload(_client, kind):
        assert kind == "accounts"
        return {
            "data_provenance": "HubSpot",
            "records": [{
                "id": "hubspot-company-10",
                "canonical_account_id": "hubspot-company-10",
                "hubspot_company_id": "10",
                "domains": ["boeing.com"],
                "aliases": ["Boeing"],
                "facility_names": ["Fort Worth"],
                "parent_id": None,
                "subsidiary_ids": ["hubspot-company-11"],
                "cage_code": "81205",
                "uei": "BOEINGUEI1",
                "known_programs": ["F-15EX"],
                "known_customers": ["USAF"],
            }],
        }

    monkeypatch.setattr("btx_platform.api.hubspot_payload", fake_payload)

    response = client.get("/crm/accounts", headers=_headers())

    assert response.status_code == 200
    with sf() as session:
        account = session.get(models.CanonicalAccount, "hubspot-company-10")
    assert account is not None
    assert account.hubspot_company_id == "10"
    assert account.domains == ["boeing.com"]
    assert account.aliases == ["Boeing"]
    assert account.known_programs == ["F-15EX"]


def test_crm_task_route_creates_hubspot_task_with_associations(monkeypatch, tmp_path: Path):
    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    settings = Settings(env="test", hubspot_access_token="hubspot-token")
    app = create_app(settings=settings, session_factory=sf, clerk_verifier=CLERK.verifier)
    client = TestClient(app)
    captured: dict = {}

    class FakeHubSpotClient:
        def __init__(self, token: str):
            captured["token"] = token

        def create_task(self, *, subject, body, timestamp, owner_id=None, idempotency_key=None, associations):
            captured["subject"] = subject
            captured["body"] = body
            captured["timestamp"] = timestamp
            captured["owner_id"] = owner_id
            captured["idempotency_key"] = idempotency_key
            captured["associations"] = list(associations)
            return {"id": "task-123"}

    monkeypatch.setattr("btx_platform.api.HubSpotClient", FakeHubSpotClient)

    response = client.post(
        "/crm/task",
        headers={**_headers(), "X-Idempotency-Key": "idem-direct-1"},
        json={
            "title": "Follow up: Meeting brief",
            "body": "Call procurement with the cited monitor signal.",
            "company_id": "hubspot-company-10",
            "contact_id": "hubspot-contact-20",
            "deal_id": "hubspot-deal-30",
        },
    )

    assert response.status_code == 200
    assert response.json()["id"] == "task-123"
    assert response.json()["record_url"] == "https://app.hubspot.com/tasks/task-123"
    assert captured["token"] == "hubspot-token"
    assert captured["subject"] == "Follow up: Meeting brief"
    assert captured["body"] == "Call procurement with the cited monitor signal."
    assert captured["timestamp"].endswith("Z")
    assert captured["idempotency_key"] == "idem-direct-1"
    assert [(item.object_type, item.object_id) for item in captured["associations"]] == [
        ("companies", "10"),
        ("contacts", "20"),
        ("deals", "30"),
    ]
    with sf() as session:
        audits = session.query(models.HubSpotTaskAudit).all()
    assert len(audits) == 1
    assert audits[0].subject == "Follow up: Meeting brief"
    assert audits[0].hubspot_task_id == "task-123"
    assert audits[0].idempotency_key == "idem-direct-1"
    assert audits[0].associations == {
        "records": [
            {"object_type": "companies", "object_id": "10"},
            {"object_type": "contacts", "object_id": "20"},
            {"object_type": "deals", "object_id": "30"},
        ],
    }


def test_crm_task_route_requires_hubspot_token(tmp_path: Path):
    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    settings = Settings(env="test", hubspot_access_token=None)
    app = create_app(settings=settings, session_factory=sf, clerk_verifier=CLERK.verifier)
    client = TestClient(app)

    response = client.post("/crm/task", headers=_headers(), json={"title": "Follow up"})

    assert response.status_code == 501
    assert response.json()["code"] == "not_configured"


def test_crm_task_route_maps_hubspot_errors_to_502(monkeypatch, tmp_path: Path):
    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    settings = Settings(env="test", hubspot_access_token="hubspot-token")
    app = create_app(settings=settings, session_factory=sf, clerk_verifier=CLERK.verifier)
    client = TestClient(app)

    class FakeHubSpotClient:
        def __init__(self, token: str):
            self.token = token

        def create_task(self, **_kwargs):
            raise HubSpotError(
                method="POST",
                url="https://api.hubapi.com/crm/v3/objects/tasks",
                status_code=400,
                body="bad association",
            )

    monkeypatch.setattr("btx_platform.api.HubSpotClient", FakeHubSpotClient)

    response = client.post("/crm/task", headers=_headers(), json={"title": "Follow up"})

    assert response.status_code == 502
    assert response.json()["code"] == "hubspot_error"
    assert "bad association" in response.json()["detail"]
    with sf() as session:
        assert session.query(models.HubSpotTaskAudit).count() == 0


def test_crm_import_prospects_batches_rows_and_reports_partial_failures(monkeypatch, tmp_path: Path):
    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    settings = Settings(env="test", hubspot_access_token="hubspot-token")
    app = create_app(settings=settings, session_factory=sf, clerk_verifier=CLERK.verifier)
    client = TestClient(app)
    captured: dict[str, list[dict]] = {}

    class FakeHubSpotClient:
        def __init__(self, token: str):
            assert token == "hubspot-token"

        def create_companies_batch(self, rows):
            captured["companies"] = rows
            return {
                "results": [{"id": "company-1", "objectWriteTraceId": "row-1"}],
                "errors": [{"message": "Duplicate domain", "context": {"objectWriteTraceId": ["row-2"]}}],
            }

        def create_contacts_batch(self, rows):
            captured["contacts"] = rows
            return {"errors": [{"message": "Invalid email", "objectWriteTraceId": "row-1"}]}

    monkeypatch.setattr("btx_platform.api.HubSpotClient", FakeHubSpotClient)

    response = client.post(
        "/crm/import/prospects",
        headers=_headers(),
        json={
            "rows": [
                {
                    "row_id": "row-1",
                    "company": {"companyName": "Trinity Defense Components", "domain": "trinity.example", "city": "Pittsburgh"},
                    "contact": {"contactName": "Ari Lee", "email": "bad-email", "title": "Buyer"},
                },
                {
                    "row_id": "row-2",
                    "company": {"companyName": "Duplicate Defense", "domain": "duplicate.example"},
                },
                {
                    "row_id": "row-3",
                    "company": {"city": "Pittsburgh"},
                },
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"] == {"succeeded": 0, "partial": 1, "failed": 2}
    rows = {row["row_id"]: row for row in payload["rows"]}
    assert rows["row-1"]["status"] == "partial"
    assert rows["row-1"]["company_id"] == "company-1"
    assert rows["row-1"]["contact_id"] is None
    assert "Invalid email" in rows["row-1"]["reason"]
    assert rows["row-2"]["status"] == "failed"
    assert rows["row-2"]["reason"] == "Duplicate domain"
    assert rows["row-3"]["status"] == "failed"
    assert rows["row-3"]["reason"] == "Missing required company name or domain."
    assert captured["companies"] == [
        {"objectWriteTraceId": "row-1", "properties": {"name": "Trinity Defense Components", "domain": "trinity.example", "city": "Pittsburgh"}},
        {"objectWriteTraceId": "row-2", "properties": {"name": "Duplicate Defense", "domain": "duplicate.example"}},
    ]
    assert captured["contacts"] == [
        {"objectWriteTraceId": "row-1", "properties": {"firstname": "Ari", "lastname": "Lee", "email": "bad-email", "jobtitle": "Buyer"}},
    ]


def test_crm_import_prospects_requires_hubspot_token(tmp_path: Path):
    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    settings = Settings(env="test", hubspot_access_token=None)
    app = create_app(settings=settings, session_factory=sf, clerk_verifier=CLERK.verifier)
    client = TestClient(app)

    response = client.post(
        "/crm/import/prospects",
        headers=_headers(),
        json={"rows": [{"row_id": "row-1", "company": {"companyName": "Acme"}}]},
    )

    assert response.status_code == 501
    assert response.json()["code"] == "not_configured"


def _create_proposed_work_item(client: TestClient, *, account_id: str = "hubspot-company-10") -> dict:
    response = client.post(
        "/work-items",
        headers=_headers(email="tester@example.com"),
        json={
            "type": "account_action",
            "canonical_account_id": account_id,
            "source_signal_ids": ["signal-1"],
            "owner": "owner-7",
            "priority": "high",
            "status": "proposed",
            "due_date": "2026-07-20T15:00:00Z",
            "recommended_action": "Call Acme about the verified contract signal",
            "generated_artifact_ref": "artifact-1",
            "approval_state": "pending",
        },
    )
    assert response.status_code == 201
    return response.json()


def test_work_item_hubspot_task_happy_path_verifies_and_audits(monkeypatch, tmp_path: Path):
    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    settings = Settings(env="test", hubspot_access_token="hubspot-token")
    app = create_app(settings=settings, session_factory=sf, clerk_verifier=CLERK.verifier)
    client = TestClient(app)
    created = _create_proposed_work_item(client)
    calls: list[tuple[str, dict]] = []

    class FakeHubSpotClient:
        def __init__(self, token: str):
            assert token == "hubspot-token"

        def create_task(self, **kwargs):
            calls.append(("create", kwargs))
            return {"id": "task-777"}

        def get_task(self, task_id: str):
            calls.append(("get", {"task_id": task_id}))
            return {
                "id": task_id,
                "properties": {
                    "hs_task_subject": "Call Acme about the verified contract signal",
                    "hs_task_body": calls[0][1]["body"],
                    "hs_task_status": "NOT_STARTED",
                },
            }

    monkeypatch.setattr("btx_platform.api.HubSpotClient", FakeHubSpotClient)

    response = client.post(
        f"/work-items/{created['id']}/execute/hubspot-task",
        headers={**_headers(email="sales-user@example.com"), "X-Idempotency-Key": "work-item-idem-1"},
        json={
            "confirmed": True,
            "relationship_record": {"match_method": "exact_domain", "confidence": 0.96},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "verified"
    assert payload["duplicate"] is False
    assert payload["hubspot_task"]["record_url"] == "https://app.hubspot.com/tasks/task-777"
    item = payload["work_item"]
    assert item["status"] == "done"
    assert item["approval_state"] == "approved"
    assert item["execution_state"] == "completed"
    assert item["external_system"] == "hubspot"
    assert item["external_record_id"] == "task-777"
    assert item["external_record_url"] == "https://app.hubspot.com/tasks/task-777"
    assert item["execution_idempotency_key"] == "work-item-idem-1"
    assert item["execution_error"] is None
    actions = [entry["action"] for entry in item["audit_history"]]
    assert actions == ["create", "hubspot_task_execute_started", "hubspot_task_execute_verified"]
    assert item["audit_history"][1]["after"]["hubspot_task_preview"]["owner"] == "owner-7"
    assert item["audit_history"][1]["after"]["hubspot_task_preview"]["due_at"].startswith("2026-07-20")
    assert item["audit_history"][1]["after"]["hubspot_task_preview"]["relationship_record"]["match_method"] == "exact_domain"
    assert calls[0][0] == "create"
    assert calls[0][1]["owner_id"] == "owner-7"
    assert calls[0][1]["idempotency_key"] == "work-item-idem-1"
    assert [(item.object_type, item.object_id) for item in calls[0][1]["associations"]] == [("companies", "10")]
    with sf() as session:
        audits = session.query(models.HubSpotTaskAudit).all()
    assert len(audits) == 1
    assert audits[0].hubspot_task_id == "task-777"
    assert audits[0].idempotency_key == "work-item-idem-1"


def test_work_item_hubspot_task_retry_is_idempotent(monkeypatch, tmp_path: Path):
    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    settings = Settings(env="test", hubspot_access_token="hubspot-token")
    app = create_app(settings=settings, session_factory=sf, clerk_verifier=CLERK.verifier)
    client = TestClient(app)
    created = _create_proposed_work_item(client)
    create_count = 0
    created_body = ""

    class FakeHubSpotClient:
        def __init__(self, _token: str):
            pass

        def create_task(self, **_kwargs):
            nonlocal create_count
            nonlocal created_body
            create_count += 1
            created_body = _kwargs["body"]
            return {"id": "task-888"}

        def get_task(self, task_id: str):
            return {
                "id": task_id,
                "properties": {
                    "hs_task_subject": "Call Acme about the verified contract signal",
                    "hs_task_body": created_body,
                },
            }

    monkeypatch.setattr("btx_platform.api.HubSpotClient", FakeHubSpotClient)
    headers = {**_headers(), "X-Idempotency-Key": "same-key"}
    first = client.post(f"/work-items/{created['id']}/execute/hubspot-task", headers=headers, json={"confirmed": True})
    second = client.post(f"/work-items/{created['id']}/execute/hubspot-task", headers=headers, json={"confirmed": True})

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["duplicate"] is True
    assert second.json()["hubspot_task"]["id"] == "task-888"
    assert create_count == 1


def test_work_item_hubspot_task_failure_leaves_not_done_with_error(monkeypatch, tmp_path: Path):
    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    settings = Settings(env="test", hubspot_access_token="hubspot-token")
    app = create_app(settings=settings, session_factory=sf, clerk_verifier=CLERK.verifier)
    client = TestClient(app)
    created = _create_proposed_work_item(client)

    class FakeHubSpotClient:
        def __init__(self, _token: str):
            pass

        def create_task(self, **_kwargs):
            return {"id": "task-999"}

        def get_task(self, task_id: str):
            return {"id": task_id, "properties": {"hs_task_subject": "Wrong", "hs_task_body": "Wrong"}}

    monkeypatch.setattr("btx_platform.api.HubSpotClient", FakeHubSpotClient)

    response = client.post(
        f"/work-items/{created['id']}/execute/hubspot-task",
        headers={**_headers(), "X-Idempotency-Key": "fail-key"},
        json={"confirmed": True},
    )

    assert response.status_code == 502
    assert response.json()["code"] == "hubspot_error"
    item = response.json()["work_item"]
    assert item["status"] == "proposed"
    assert item["execution_state"] == "failed"
    assert item["external_record_id"] is None
    assert "did not verify" in item["execution_error"]
    assert item["audit_history"][-1]["action"] == "hubspot_task_execute_failed"
    with sf() as session:
        assert session.query(models.HubSpotTaskAudit).count() == 0


def test_work_item_hubspot_task_requires_confirmation_and_config(tmp_path: Path):
    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    settings = Settings(env="test", hubspot_access_token=None)
    app = create_app(settings=settings, session_factory=sf, clerk_verifier=CLERK.verifier)
    client = TestClient(app)
    created = _create_proposed_work_item(client)

    missing_confirmation = client.post(
        f"/work-items/{created['id']}/execute/hubspot-task",
        headers=_headers(),
        json={"confirmed": False},
    )
    assert missing_confirmation.status_code == 422
    assert missing_confirmation.json()["code"] == "confirmation_required"

    not_configured = client.post(
        f"/work-items/{created['id']}/execute/hubspot-task",
        headers=_headers(),
        json={"confirmed": True},
    )
    assert not_configured.status_code == 501
    assert not_configured.json()["code"] == "not_configured"
