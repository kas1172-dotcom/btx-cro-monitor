from __future__ import annotations

from pathlib import Path

import httpx
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("sqlalchemy")

from fastapi.testclient import TestClient  # noqa: E402

from btx_platform.api import create_app  # noqa: E402
from btx_platform.config import Settings  # noqa: E402
from btx_platform.db import init_db, make_engine, make_session_factory  # noqa: E402
from btx_platform.hubspot import (  # noqa: E402
    HubSpotClient,
    HubSpotObject,
    HubSpotOwner,
    map_companies,
    map_contacts,
    map_deals,
)

AUTH = "hubspot-test-token"


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {AUTH}"}


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
    settings = Settings(env="test", backend_auth_token=AUTH, hubspot_access_token="hubspot-token")
    app = create_app(settings=settings, session_factory=sf)
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
