"""Phase 1 webhook receiver tests: signature, validation, dedupe, raw-store,
fast 200, enqueue. SQLite in-memory + in-memory queue — no Postgres/Redis.

Skips cleanly when backend deps (fastapi/sqlalchemy) aren't installed, mirroring
the node frontend smoke tests."""
from __future__ import annotations

import json

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("sqlalchemy")

from fastapi.testclient import TestClient  # noqa: E402

from btx_platform import models  # noqa: E402
from btx_platform.api import create_app  # noqa: E402
from btx_platform.config import Settings  # noqa: E402
from btx_platform.db import init_db, make_engine, make_session_factory  # noqa: E402
from btx_platform.ingest import resolve_idempotency_key  # noqa: E402
from btx_platform.queue import InMemoryQueue  # noqa: E402
from btx_platform.schemas import WebhookEnvelope  # noqa: E402
from btx_platform.security import compute_signature, verify_signature  # noqa: E402
from tests.auth_helpers import make_clerk_fixture  # noqa: E402

SECRET = "topsecret"
CLERK = make_clerk_fixture()
VALID = {"event_type": "contact.created", "data": {"id": 1, "name": "ACME"}, "external_id": "ext-1"}


def _build(settings: Settings | None = None):
    engine = make_engine("sqlite://")          # shared in-memory (StaticPool)
    init_db(engine)
    sf = make_session_factory(engine)
    with sf() as s:
        s.add(models.Connection(id="appA", name="App A", signing_secret=SECRET, active=True))
        s.add(models.Connection(id="nosig", name="Open", signing_secret=None, active=True))
        s.add(models.Connection(id="off", name="Disabled", signing_secret=None, active=False))
        s.commit()
    queue = InMemoryQueue()
    app = create_app(
        settings=settings or Settings(env="test"),
        session_factory=sf,
        queue=queue,
        clerk_verifier=CLERK.verifier,
    )
    return TestClient(app), sf, queue


def _signed(body: dict, secret: str = SECRET) -> tuple[bytes, str]:
    raw = json.dumps(body).encode()
    return raw, compute_signature(secret, raw)


def _post(client, conn, raw, sig=None, idem=None):
    # Webhooks authenticate with the connection's own HMAC signature, not a
    # Clerk session — they're machine-to-machine, not a signed-in user.
    headers = {"Content-Type": "application/json"}
    if sig is not None:
        headers["X-BTX-Signature"] = sig
    if idem is not None:
        headers["X-Idempotency-Key"] = idem
    return client.post(f"/webhooks/{conn}", content=raw, headers=headers)


# ─── unit: security + idempotency ───────────────────────────────────────────

def test_signature_roundtrip():
    body = b'{"a":1}'
    sig = compute_signature(SECRET, body)
    assert verify_signature(SECRET, body, sig)
    assert verify_signature(SECRET, body, sig.removeprefix("sha256="))  # bare hex ok
    assert not verify_signature(SECRET, body, None)
    assert not verify_signature(SECRET, body, "sha256=deadbeef")
    assert not verify_signature("wrong", body, sig)


def test_idempotency_key_precedence():
    env = WebhookEnvelope(event_type="x", data={}, external_id="ext", idempotency_key="env")
    assert resolve_idempotency_key(env, "hdr") == "hdr"          # header wins
    assert resolve_idempotency_key(env, None) == "env"           # then envelope
    env2 = WebhookEnvelope(event_type="x", data={}, external_id="ext")
    assert resolve_idempotency_key(env2, None) == "ext"          # then external_id


# ─── happy path ─────────────────────────────────────────────────────────────

def test_valid_signed_payload_accepted_and_enqueued():
    client, sf, queue = _build()
    raw, sig = _signed(VALID)
    r = _post(client, "appA", raw, sig)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "received" and body["duplicate"] is False
    # persisted exactly + enqueued exactly once
    with sf() as s:
        ev = s.get(models.Event, body["event_id"])
        assert ev is not None
        assert ev.raw_body == raw.decode()        # raw payload stored verbatim
        assert ev.event_type == "contact.created"
        assert ev.status == "received"
    assert queue.jobs == [body["event_id"]]


def test_health():
    client, _sf, _q = _build()
    body = client.get("/health").json()
    assert body["status"] in ("ok", "degraded")
    assert body["db"] is True
    assert body["monitor"]["status"] in ("ok", "stale", "missing", "invalid")
    assert "hubspot" in body["integrations"] and "llm" in body["integrations"]


def test_webhooks_exempt_from_clerk_auth_but_other_routes_are_not():
    """Webhooks authenticate via per-connection HMAC (a machine caller), not a
    Clerk session. Confirm that exemption is scoped to /webhooks/* only — a
    genuine user-facing route with no Authorization header still 401s."""
    client, _sf, _q = _build()
    raw, sig = _signed(VALID)
    assert _post(client, "appA", raw, sig).status_code == 200  # no Clerk token needed
    assert client.get("/work-items").status_code == 401        # but this route still requires one


# ─── auth ───────────────────────────────────────────────────────────────────

def test_bad_signature_rejected_nothing_stored():
    client, sf, queue = _build()
    raw, _ = _signed(VALID)
    r = _post(client, "appA", raw, "sha256=bad")
    assert r.status_code == 401
    with sf() as s:
        assert s.query(models.Event).count() == 0
    assert queue.jobs == []


def test_missing_signature_rejected():
    client, _sf, _q = _build()
    raw, _ = _signed(VALID)
    assert _post(client, "appA", raw, None).status_code == 401


def test_open_connection_accepts_unsigned():
    client, _sf, queue = _build()
    raw = json.dumps(VALID).encode()
    r = _post(client, "nosig", raw)               # no secret configured → no sig required
    assert r.status_code == 200
    assert len(queue.jobs) == 1


def test_disabled_connection_forbidden():
    client, _sf, _q = _build()
    raw = json.dumps(VALID).encode()
    assert _post(client, "off", raw).status_code == 403


def test_unknown_connection_404():
    client, _sf, _q = _build()
    raw, sig = _signed(VALID)
    assert _post(client, "ghost", raw, sig).status_code == 404


# ─── validation ─────────────────────────────────────────────────────────────

def test_invalid_json_400():
    client, _sf, queue = _build()
    raw = b"not-json{"
    r = _post(client, "appA", raw, compute_signature(SECRET, raw))
    assert r.status_code == 400
    assert queue.jobs == []


def test_schema_violation_422():
    client, _sf, queue = _build()
    bad = {"data": {"x": 1}}                       # missing event_type
    raw, sig = _signed(bad)
    assert _post(client, "appA", raw, sig).status_code == 422
    extra = {"event_type": "x", "data": {}, "surprise": 1}   # extra field forbidden
    raw2, sig2 = _signed(extra)
    assert _post(client, "appA", raw2, sig2).status_code == 422
    assert queue.jobs == []


def test_payload_too_large_413():
    client, _sf, _q = _build(settings=Settings(env="test", max_body_bytes=10))
    raw, sig = _signed(VALID)
    assert _post(client, "appA", raw, sig).status_code == 413


# ─── idempotency / no duplicates ────────────────────────────────────────────

def test_duplicate_delivery_deduped():
    client, sf, queue = _build()
    raw, sig = _signed(VALID)                      # external_id "ext-1" drives dedupe
    first = _post(client, "appA", raw, sig).json()
    second = _post(client, "appA", raw, sig).json()
    assert first["duplicate"] is False
    assert second["duplicate"] is True
    assert first["event_id"] == second["event_id"]
    with sf() as s:
        assert s.query(models.Event).count() == 1  # stored once
    assert queue.jobs == [first["event_id"]]        # enqueued once
