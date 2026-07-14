"""HubSpot CRM read client and BTX frontend-shape mappers."""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Callable, Iterable, Literal

import httpx

SOURCE_NAME = "HubSpot"
BASE_URL = "https://api.hubapi.com"
TIMEOUT_SECONDS = 10.0

ObjectType = Literal["companies", "contacts", "deals"]
AssociationType = Literal["companies", "contacts", "deals"]
TaskAssociationType = Literal["companies", "contacts", "deals"]
ListObjectType = Literal["company", "contact"]

LIST_OBJECT_TYPE_IDS: dict[ListObjectType, str] = {
    "contact": "0-1",
    "company": "0-2",
}


class HubSpotError(RuntimeError):
    def __init__(self, *, method: str, url: str, status_code: int, body: str):
        super().__init__(f"HubSpot {method} {url} failed {status_code}: {body}")
        self.method = method
        self.url = url
        self.status_code = status_code
        self.body = body


@dataclass(frozen=True)
class HubSpotObject:
    id: str
    properties: dict[str, Any]


@dataclass(frozen=True)
class HubSpotOwner:
    id: str
    name: str
    email: str | None = None


@dataclass(frozen=True)
class HubSpotTaskAssociation:
    object_type: TaskAssociationType
    object_id: str


class HubSpotClient:
    def __init__(
        self,
        access_token: str,
        *,
        base_url: str = BASE_URL,
        timeout: float = TIMEOUT_SECONDS,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.access_token = access_token
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.sleep = sleep

    def _headers(self) -> dict[str, str]:
        return {"authorization": f"Bearer {self.access_token}"}

    def _request(self, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
        attempts = 0
        while True:
            attempts += 1
            with httpx.Client(timeout=self.timeout) as client:
                response = client.request(method, url, headers=self._headers(), **kwargs)
            if response.status_code != 429:
                break
            if attempts >= 3:
                break
            retry_after = response.headers.get("retry-after")
            try:
                delay = float(retry_after) if retry_after else 1.0
            except ValueError:
                delay = 1.0
            self.sleep(max(delay, 0.0))

        if not response.is_success:
            raise HubSpotError(method=method, url=url, status_code=response.status_code, body=response.text)
        if not response.text:
            return {}
        return response.json()

    def _get(self, path_or_url: str, *, params: dict[str, Any] | None = None) -> dict[str, Any]:
        url = path_or_url if path_or_url.startswith("https://") else f"{self.base_url}{path_or_url}"
        return self._request("GET", url, params=params)

    def _post(self, path: str, *, json: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"{self.base_url}{path}", json=json)

    def _put(self, path: str, *, json: Any) -> dict[str, Any]:
        return self._request("PUT", f"{self.base_url}{path}", json=json)

    def _batch_create(self, object_type: Literal["companies", "contacts"], rows: list[dict[str, Any]]) -> dict[str, Any]:
        return self._post(
            f"/crm/objects/2026-03/{object_type}/batch/create",
            json={
                "inputs": [
                    {
                        "properties": row.get("properties") or {},
                        "objectWriteTraceId": row.get("objectWriteTraceId") or row.get("trace_id"),
                    }
                    for row in rows
                ],
            },
        )

    def create_companies_batch(self, rows: list[dict[str, Any]]) -> dict[str, Any]:
        return self._batch_create("companies", rows)

    def create_contacts_batch(self, rows: list[dict[str, Any]]) -> dict[str, Any]:
        return self._batch_create("contacts", rows)

    def list_objects(self, object_type: ObjectType, properties: Iterable[str]) -> list[HubSpotObject]:
        records: list[HubSpotObject] = []
        next_url: str | None = None
        after: str | None = None
        params: dict[str, Any] | None = {
            "limit": 100,
            "properties": ",".join(properties),
            "archived": "false",
        }

        while True:
            if after and params is not None:
                params["after"] = after
            payload = self._get(next_url or f"/crm/v3/objects/{object_type}", params=params)
            records.extend(
                HubSpotObject(id=str(item["id"]), properties=item.get("properties") or {})
                for item in payload.get("results", [])
            )
            next_page = (payload.get("paging") or {}).get("next") or {}
            next_url = next_page.get("link")
            after = next_page.get("after")
            if not next_url and not after:
                return records
            if next_url:
                params = None

    def list_companies(self) -> list[HubSpotObject]:
        return self.list_objects(
            "companies",
            [
                "name",
                "domain",
                "website",
                "city",
                "state",
                "address",
                "zip",
                "country",
                "description",
                "industry",
                "hubspot_owner_id",
                "btx_needs",
                "btx_aliases",
                "btx_facility_names",
                "btx_parent_id",
                "btx_subsidiary_ids",
                "btx_cage_code",
                "btx_uei",
                "btx_known_programs",
                "btx_known_customers",
            ],
        )

    def list_contacts(self) -> list[HubSpotObject]:
        return self.list_objects(
            "contacts",
            ["firstname", "lastname", "email", "jobtitle", "phone", "associatedcompanyid", "hubspot_owner_id"],
        )

    def list_deals(self) -> list[HubSpotObject]:
        return self.list_objects(
            "deals",
            ["dealname", "amount", "closedate", "dealstage", "pipeline", "hubspot_owner_id", "btx_external_id"],
        )

    def list_owners(self) -> list[HubSpotOwner]:
        owners: list[HubSpotOwner] = []
        next_url: str | None = None
        after: str | None = None
        params: dict[str, Any] | None = {"limit": 100, "archived": "false"}
        while True:
            if after and params is not None:
                params["after"] = after
            payload = self._get(next_url or "/crm/v3/owners", params=params)
            for item in payload.get("results", []):
                first = item.get("firstName") or ""
                last = item.get("lastName") or ""
                name = f"{first} {last}".strip() or item.get("email") or str(item.get("id"))
                owners.append(HubSpotOwner(id=str(item.get("id")), name=name, email=item.get("email")))
            next_page = (payload.get("paging") or {}).get("next") or {}
            next_url = next_page.get("link")
            after = next_page.get("after")
            if not next_url and not after:
                return owners
            if next_url:
                params = None

    def read_associations(
        self,
        from_object_type: AssociationType,
        to_object_type: AssociationType,
        from_ids: Iterable[str],
    ) -> dict[str, list[str]]:
        result: dict[str, list[str]] = {}
        ids = [str(item) for item in from_ids]
        for index in range(0, len(ids), 1000):
            chunk = ids[index:index + 1000]
            if not chunk:
                continue
            payload = self._post(
                f"/crm/v4/associations/{from_object_type}/{to_object_type}/batch/read",
                json={"inputs": [{"id": item} for item in chunk]},
            )
            for row in payload.get("results", []):
                from_id = str((row.get("from") or {}).get("id"))
                result[from_id] = [str(item.get("toObjectId")) for item in row.get("to", []) if item.get("toObjectId") is not None]
        return result

    def default_association_type_id(self, from_object_type: str, to_object_type: str) -> int:
        payload = self._get(f"/crm/v4/associations/{from_object_type}/{to_object_type}/labels")
        for item in payload.get("results", []):
            if item.get("category") == "HUBSPOT_DEFINED" and item.get("label") is None:
                return int(item["typeId"])
        for item in payload.get("results", []):
            if item.get("category") == "HUBSPOT_DEFINED":
                return int(item["typeId"])
        raise HubSpotError(
            method="GET",
            url=f"{self.base_url}/crm/v4/associations/{from_object_type}/{to_object_type}/labels",
            status_code=502,
            body=f"No default HubSpot association type for {from_object_type}->{to_object_type}",
        )

    def create_task(
        self,
        *,
        subject: str,
        body: str,
        timestamp: str,
        owner_id: str | None = None,
        idempotency_key: str | None = None,
        associations: Iterable[HubSpotTaskAssociation] = (),
    ) -> dict[str, Any]:
        association_inputs = []
        for association in associations:
            type_id = self.default_association_type_id("tasks", association.object_type)
            association_inputs.append({
                "to": {"id": association.object_id},
                "types": [{
                    "associationCategory": "HUBSPOT_DEFINED",
                    "associationTypeId": type_id,
                }],
            })
        payload: dict[str, Any] = {
            "properties": {
                "hs_task_subject": subject,
                "hs_task_body": body,
                "hs_timestamp": timestamp,
                "hs_task_status": "NOT_STARTED",
            },
        }
        if owner_id:
            payload["properties"]["hubspot_owner_id"] = owner_id
        if idempotency_key:
            payload["properties"]["hs_task_body"] = f"{body}\n\nBTX idempotency key: {idempotency_key}".strip()
        if association_inputs:
            payload["associations"] = association_inputs
        return self._post("/crm/v3/objects/tasks", json=payload)

    def get_task(self, task_id: str) -> dict[str, Any]:
        return self._get(
            f"/crm/v3/objects/tasks/{task_id}",
            params={"properties": "hs_task_subject,hs_task_body,hs_timestamp,hs_task_status,hubspot_owner_id"},
        )

    def search_companies(self, query: str, *, limit: int = 10) -> list[HubSpotObject]:
        payload = self._post(
            "/crm/objects/2026-03/companies/search",
            json={
                "query": query,
                "limit": max(1, min(limit, 100)),
                "properties": [
                    "name",
                    "domain",
                    "website",
                    "city",
                    "state",
                    "address",
                    "zip",
                    "country",
                    "description",
                    "industry",
                    "hubspot_owner_id",
                    "btx_needs",
                    "btx_aliases",
                    "btx_facility_names",
                    "btx_parent_id",
                    "btx_subsidiary_ids",
                    "btx_cage_code",
                    "btx_uei",
                    "btx_known_programs",
                    "btx_known_customers",
                ],
            },
        )
        return [
            HubSpotObject(id=str(item["id"]), properties=item.get("properties") or {})
            for item in payload.get("results", [])
        ]

    def create_list(self, name: str, list_type: ListObjectType) -> str:
        payload = self._post(
            "/crm/lists/2026-03",
            json={
                "name": name,
                "objectTypeId": LIST_OBJECT_TYPE_IDS[list_type],
                "processingType": "MANUAL",
            },
        )
        list_id = payload.get("listId") or payload.get("id")
        if not list_id:
            raise HubSpotError(
                method="POST",
                url=f"{self.base_url}/crm/lists/2026-03",
                status_code=502,
                body="HubSpot returned no listId",
            )
        return str(list_id)

    def get_list(self, list_id: str) -> dict[str, Any]:
        return self._get(f"/crm/lists/2026-03/{list_id}")

    def add_records_to_list(self, list_id: str, record_ids: list[str]) -> dict[str, Any]:
        return self._put(f"/crm/lists/2026-03/{list_id}/memberships/add", json=[str(item) for item in record_ids])

    def get_list_memberships(self, list_id: str) -> list[str]:
        payload = self._get(f"/crm/lists/2026-03/{list_id}/memberships")
        return [str(item.get("recordId")) for item in payload.get("results", []) if item.get("recordId") is not None]


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _number(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _iso_date(value: Any) -> str:
    text = _clean(value)
    if not text:
        return (datetime.now(UTC) + timedelta(days=90)).date().isoformat()
    return text[:10]


def _owner_name(owner_id: Any, owners: dict[str, HubSpotOwner]) -> str | None:
    if owner_id is None:
        return None
    owner = owners.get(str(owner_id))
    return owner.name if owner else None


def _needs(properties: dict[str, Any]) -> list[str]:
    raw = _clean(properties.get("btx_needs")) or _clean(properties.get("industry")) or _clean(properties.get("description"))
    if not raw:
        return []
    return [item.strip() for item in raw.replace(";", ",").split(",") if item.strip()][:8]


def _list_property(value: Any) -> list[str]:
    raw = _clean(value)
    if not raw:
        return []
    return [item.strip() for item in raw.replace(";", ",").replace("|", ",").split(",") if item.strip()]


def _company_domains(properties: dict[str, Any]) -> list[str]:
    domains = []
    for key in ("domain", "website"):
        value = _clean(properties.get(key))
        if not value:
            continue
        domain = value.removeprefix("https://").removeprefix("http://").removeprefix("www.").split("/")[0]
        if domain:
            domains.append(domain.lower())
    return list(dict.fromkeys(domains))


def _stage(value: Any) -> str:
    text = (_clean(value) or "").lower()
    if "closedwon" in text or text == "won" or "won" in text:
        return "won"
    if "closedlost" in text or text == "lost" or "lost" in text:
        return "lost"
    if "contract" in text or "proposal" in text or "presentation" in text:
        return "proposal"
    if "qualified" in text or "decision" in text:
        return "qualified"
    return "prospecting"


def map_companies(
    companies: list[HubSpotObject],
    owners: dict[str, HubSpotOwner],
    contact_associations: dict[str, list[str]],
    deal_associations: dict[str, list[str]],
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for company in companies:
        props = company.properties
        name = _clean(props.get("name")) or _clean(props.get("domain")) or f"HubSpot Company {company.id}"
        deal_ids = deal_associations.get(company.id, [])
        account_status = "active_pipeline" if deal_ids else "target_prospect"
        canonical_id = f"hubspot-company-{company.id}"
        records.append({
            "id": canonical_id,
            "canonical_account_id": canonical_id,
            "hubspot_id": company.id,
            "hubspot_company_id": company.id,
            "name": name,
            "relationship": "customer" if deal_ids else "target",
            "account_status": account_status,
            "business_motion": "grow_existing_business" if deal_ids else "prospect_new_business",
            "location": {
                "city": _clean(props.get("city")) or "Unknown",
                "lat": 0,
                "lon": 0,
                "address": _clean(props.get("address")),
                "state": _clean(props.get("state")),
                "postal_code": _clean(props.get("zip")),
                "country": _clean(props.get("country")) or "USA",
            },
            "website_url": _clean(props.get("website")) or (f"https://{props.get('domain')}" if _clean(props.get("domain")) else None),
            "source_url": f"https://app.hubspot.com/contacts/company/{company.id}",
            "needs": _needs(props),
            "domains": _company_domains(props),
            "aliases": _list_property(props.get("btx_aliases")),
            "facility_names": _list_property(props.get("btx_facility_names")),
            "parent_id": _clean(props.get("btx_parent_id")),
            "subsidiary_ids": _list_property(props.get("btx_subsidiary_ids")),
            "cage_code": _clean(props.get("btx_cage_code")),
            "uei": _clean(props.get("btx_uei")),
            "known_programs": _list_property(props.get("btx_known_programs")),
            "known_customers": _list_property(props.get("btx_known_customers")),
            "contact_ids": [f"hubspot-contact-{item}" for item in contact_associations.get(company.id, [])],
            "deal_ids": [f"hubspot-deal-{item}" for item in deal_ids],
            "owner": _owner_name(props.get("hubspot_owner_id"), owners),
            "data_provenance": SOURCE_NAME,
            "source_type": "crm",
            "source_name": SOURCE_NAME,
            "source_mode": "live",
        })
    return records


def map_contacts(
    contacts: list[HubSpotObject],
    owners: dict[str, HubSpotOwner],
    company_associations: dict[str, list[str]],
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for contact in contacts:
        props = contact.properties
        first = _clean(props.get("firstname")) or ""
        last = _clean(props.get("lastname")) or ""
        email = _clean(props.get("email"))
        name = f"{first} {last}".strip() or email or f"HubSpot Contact {contact.id}"
        company_id = (company_associations.get(contact.id) or [_clean(props.get("associatedcompanyid")) or "unknown"])[0]
        records.append({
            "id": f"hubspot-contact-{contact.id}",
            "hubspot_id": contact.id,
            "company_id": f"hubspot-company-{company_id}",
            "name": name,
            "title": _clean(props.get("jobtitle")) or "Contact",
            "email": email,
            "phone": _clean(props.get("phone")),
            "owner": _owner_name(props.get("hubspot_owner_id"), owners),
            "data_provenance": SOURCE_NAME,
            "source_type": "crm",
            "source_name": SOURCE_NAME,
            "source_mode": "live",
        })
    return records


def map_deals(
    deals: list[HubSpotObject],
    owners: dict[str, HubSpotOwner],
    company_associations: dict[str, list[str]],
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for deal in deals:
        props = deal.properties
        company_id = (company_associations.get(deal.id) or ["unknown"])[0]
        stage = _stage(props.get("dealstage"))
        records.append({
            "id": f"hubspot-deal-{deal.id}",
            "hubspot_id": deal.id,
            "company_id": f"hubspot-company-{company_id}",
            "name": _clean(props.get("dealname")) or f"HubSpot Deal {deal.id}",
            "account_status": "active_pipeline" if stage not in {"won", "lost"} else "past_customer",
            "business_motion": "grow_existing_business" if stage != "lost" else "manage_current_business",
            "value": _number(props.get("amount")),
            "stage": stage,
            "source_url": f"https://app.hubspot.com/contacts/deal/{deal.id}",
            "close_date": _iso_date(props.get("closedate")),
            "owner": _owner_name(props.get("hubspot_owner_id"), owners),
            "pipeline": _clean(props.get("pipeline")),
            "data_provenance": SOURCE_NAME,
            "source_type": "crm",
            "source_name": SOURCE_NAME,
            "source_mode": "live",
        })
    return records


def hubspot_payload(client: HubSpotClient, kind: Literal["accounts", "contacts", "deals"]) -> dict[str, Any]:
    owners = {owner.id: owner for owner in client.list_owners()}
    if kind == "accounts":
        companies = client.list_companies()
        company_ids = [company.id for company in companies]
        return {
            "data_provenance": SOURCE_NAME,
            "records": map_companies(
                companies,
                owners,
                client.read_associations("companies", "contacts", company_ids),
                client.read_associations("companies", "deals", company_ids),
            ),
        }
    if kind == "contacts":
        contacts = client.list_contacts()
        return {
            "data_provenance": SOURCE_NAME,
            "records": map_contacts(
                contacts,
                owners,
                client.read_associations("contacts", "companies", [contact.id for contact in contacts]),
            ),
        }
    deals = client.list_deals()
    return {
        "data_provenance": SOURCE_NAME,
        "records": map_deals(
            deals,
            owners,
            client.read_associations("deals", "companies", [deal.id for deal in deals]),
        ),
    }
