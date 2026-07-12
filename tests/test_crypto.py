"""WP10-B credential encryption at rest: a connection's signing_secret is
stored encrypted, is unreadable without BTX_ENCRYPTION_KEY, and still
verifies real webhook signatures end-to-end through the ingest path."""
from __future__ import annotations

import json

import pytest

pytest.importorskip("cryptography")
pytest.importorskip("fastapi")
pytest.importorskip("sqlalchemy")

from fastapi.testclient import TestClient  # noqa: E402

from btx_platform import models  # noqa: E402
from btx_platform.api import create_app  # noqa: E402
from btx_platform.config import Settings  # noqa: E402
from btx_platform.crypto import (  # noqa: E402
    EncryptionNotConfigured,
    decrypt_if_encrypted,
    decrypt_value,
    encrypt_value,
    is_encrypted,
)
from btx_platform.db import init_db, make_engine, make_session_factory  # noqa: E402
from btx_platform.queue import InMemoryQueue  # noqa: E402
from btx_platform.security import compute_signature  # noqa: E402
from tests.auth_helpers import make_clerk_fixture  # noqa: E402

ENCRYPTION_KEY = "test-encryption-key-do-not-use-in-prod"
CLERK = make_clerk_fixture()


def test_encrypted_value_is_unreadable_without_the_key():
    plaintext = "hubspot-pat-abc123"
    stored = encrypt_value(plaintext, encryption_key=ENCRYPTION_KEY)

    assert is_encrypted(stored)
    assert plaintext not in stored  # unreadable at rest: ciphertext never contains the secret
    with pytest.raises(ValueError):
        decrypt_value(stored, encryption_key="wrong-key")


def test_encrypted_value_is_correct_in_use():
    plaintext = "hubspot-pat-abc123"
    stored = encrypt_value(plaintext, encryption_key=ENCRYPTION_KEY)

    assert decrypt_value(stored, encryption_key=ENCRYPTION_KEY) == plaintext


def test_encrypt_without_key_configured_raises():
    with pytest.raises(EncryptionNotConfigured):
        encrypt_value("secret", encryption_key=None)


def test_decrypt_if_encrypted_passes_through_legacy_plaintext():
    # A connection seeded before WP10-B (or a local dev DB) has a plain
    # signing_secret with no enc:v1: prefix — must keep working unchanged.
    assert decrypt_if_encrypted("plain-secret", encryption_key=ENCRYPTION_KEY) == "plain-secret"
    assert decrypt_if_encrypted(None, encryption_key=ENCRYPTION_KEY) is None


def test_webhook_signature_verifies_against_an_encrypted_signing_secret():
    """End-to-end: a Connection.signing_secret stored encrypted still
    authenticates a real webhook delivery through the ingest path."""
    plaintext_secret = "topsecret-signing-key"
    encrypted_secret = encrypt_value(plaintext_secret, encryption_key=ENCRYPTION_KEY)

    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    with sf() as session:
        session.add(models.Connection(id="encrypted-conn", name="Encrypted", signing_secret=encrypted_secret, active=True))
        session.commit()

    # Confirm the DB truly never holds the plaintext.
    with sf() as session:
        row = session.get(models.Connection, "encrypted-conn")
        assert plaintext_secret not in row.signing_secret
        assert is_encrypted(row.signing_secret)

    settings = Settings(env="test", encryption_key=ENCRYPTION_KEY)
    app = create_app(settings=settings, session_factory=sf, queue=InMemoryQueue(), clerk_verifier=CLERK.verifier)
    client = TestClient(app)

    body = {"event_type": "contact.created", "data": {"id": 1}, "external_id": "ext-enc-1"}
    raw = json.dumps(body).encode()
    signature = compute_signature(plaintext_secret, raw)  # sender signs with the real secret

    response = client.post(
        "/webhooks/encrypted-conn",
        content=raw,
        headers={"Content-Type": "application/json", "X-BTX-Signature": signature},
    )

    assert response.status_code == 200
    assert response.json()["duplicate"] is False


def test_webhook_signature_rejected_when_encryption_key_missing_at_verify_time():
    """If the deploy loses BTX_ENCRYPTION_KEY, encrypted secrets must fail
    closed (reject the webhook), never silently treat ciphertext as the
    literal secret."""
    encrypted_secret = encrypt_value("topsecret-signing-key", encryption_key=ENCRYPTION_KEY)

    engine = make_engine("sqlite://")
    init_db(engine)
    sf = make_session_factory(engine)
    with sf() as session:
        session.add(models.Connection(id="encrypted-conn", name="Encrypted", signing_secret=encrypted_secret, active=True))
        session.commit()

    settings = Settings(env="test", encryption_key=None)  # key missing
    app = create_app(settings=settings, session_factory=sf, queue=InMemoryQueue(), clerk_verifier=CLERK.verifier)
    client = TestClient(app)

    body = {"event_type": "contact.created", "data": {"id": 1}, "external_id": "ext-enc-2"}
    raw = json.dumps(body).encode()
    signature = compute_signature("topsecret-signing-key", raw)

    with pytest.raises(EncryptionNotConfigured):
        client.post(
            "/webhooks/encrypted-conn",
            content=raw,
            headers={"Content-Type": "application/json", "X-BTX-Signature": signature},
        )
