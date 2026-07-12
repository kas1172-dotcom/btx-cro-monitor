"""Shared Clerk-auth test scaffolding.

Backend tests never call the real Clerk service. Instead we generate a local
RSA keypair, mint RS256 session JWTs with it directly (mirroring exactly what
Clerk issues: sub/email/role/org_id/exp claims), and hand ``create_app`` a
``ClerkVerifier`` whose ``jwks_provider`` returns a ``PyJWKClient`` pointed at
that local key instead of the network. This exercises the real verification
code path (signature check, issuer check, expiry) without any network call.
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt import PyJWKClient

from btx_platform.auth import ClerkVerifier

ISSUER = "https://test.clerk.accounts.dev"
KEY_ID = "test-key-1"


@dataclass
class ClerkTestFixture:
    verifier: ClerkVerifier
    _private_key: rsa.RSAPrivateKey

    def token(
        self,
        *,
        user_id: str = "user_test",
        email: str = "analyst@example.com",
        role: str = "analyst",
        tenant_id: str = "default",
        expires_in: float = 3600,
        session_id: str | None = None,
    ) -> str:
        now = time.time()
        claims = {
            "sub": user_id,
            "email": email,
            "role": role,
            "org_id": tenant_id,
            "sid": session_id or f"sess_{uuid.uuid4().hex[:12]}",
            "iat": now,
            "exp": now + expires_in,
            "iss": ISSUER,
        }
        return jwt.encode(
            claims,
            self._private_key,
            algorithm="RS256",
            headers={"kid": KEY_ID},
        )

    def headers(self, **kwargs) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token(**kwargs)}"}


class _StaticJWKClient(PyJWKClient):
    """A PyJWKClient that serves one fixed key instead of hitting a URL."""

    def __init__(self, private_key: rsa.RSAPrivateKey) -> None:
        self._signing_key = jwt.PyJWK.from_json(
            self._to_jwk_json(private_key), algorithm="RS256"
        )

    @staticmethod
    def _to_jwk_json(private_key: rsa.RSAPrivateKey) -> str:
        import base64
        import json

        public_numbers = private_key.public_key().public_numbers()

        def b64url(value: int) -> str:
            raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
            return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")

        return json.dumps({
            "kty": "RSA",
            "kid": KEY_ID,
            "use": "sig",
            "alg": "RS256",
            "n": b64url(public_numbers.n),
            "e": b64url(public_numbers.e),
        })

    def get_signing_key_from_jwt(self, token: str):  # noqa: D401 - matches base signature
        return self._signing_key


def make_clerk_fixture(*, audience: str | None = None) -> ClerkTestFixture:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    static_client = _StaticJWKClient(private_key)
    verifier = ClerkVerifier(
        issuer=ISSUER,
        audience=audience,
        jwks_provider=lambda issuer: static_client,
    )
    return ClerkTestFixture(verifier=verifier, _private_key=private_key)
