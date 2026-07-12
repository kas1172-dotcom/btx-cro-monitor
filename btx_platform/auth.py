"""Clerk session authentication, RBAC, and tenant scoping.

Every request (other than PUBLIC_PATHS) must carry ``Authorization: Bearer
<clerk-session-jwt>``. The token is verified against Clerk's JWKS (RS256) —
signature, expiry, issuer — and its claims become ``request.state.auth``.
There is no shared secret anymore: each user gets their own signed session.

Tests never call Clerk. ``ClerkVerifier`` takes a ``jwks_provider`` callable
so a test can inject a local RSA keypair + matching JWKS and mint tokens with
``jwt.encode`` directly, exercising the exact verification path production
uses (see tests/test_platform_auth.py).
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable

import jwt
from jwt import PyJWKClient

DEFAULT_TENANT_ID = "default"

# Role hierarchy: index = privilege level. A route that requires "analyst" is
# satisfied by analyst, cro, or admin.
ROLE_ORDER = ["viewer", "analyst", "cro", "admin"]


class AuthError(Exception):
    def __init__(self, detail: str, *, status_code: int = 401, code: str = "unauthorized"):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code
        self.code = code


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    email: str | None
    role: str
    tenant_id: str
    session_id: str | None
    expires_at: float

    def has_role(self, minimum: str) -> bool:
        try:
            return ROLE_ORDER.index(self.role) >= ROLE_ORDER.index(minimum)
        except ValueError:
            return False


def _role_from_claims(claims: dict) -> str:
    # Clerk custom JWT templates commonly expose app-specific claims either at
    # the top level or nested under "public_metadata" / "metadata". Accept the
    # common shapes rather than assuming one exact template configuration.
    candidate = (
        claims.get("role")
        or claims.get("public_metadata", {}).get("role")
        or claims.get("metadata", {}).get("role")
        or claims.get("org_role")
    )
    if isinstance(candidate, str):
        normalized = candidate.removeprefix("org:").lower()
        if normalized in ROLE_ORDER:
            return normalized
    return "viewer"  # fail closed: unknown/missing role gets the least privilege


def _tenant_from_claims(claims: dict) -> str:
    org_id = claims.get("org_id") or claims.get("tenant_id")
    return org_id if isinstance(org_id, str) and org_id else DEFAULT_TENANT_ID


class ClerkVerifier:
    """Verifies Clerk session JWTs against the tenant's JWKS.

    ``jwks_provider`` defaults to fetching+caching Clerk's real JWKS via
    ``PyJWKClient`` (keyed by the issuer URL derived from the publishable/
    secret key's instance). Tests override it with a static local JWKS.
    """

    def __init__(
        self,
        *,
        issuer: str,
        audience: str | None = None,
        leeway_seconds: int = 5,
        jwks_provider: Callable[[str], "PyJWKClient"] | None = None,
    ) -> None:
        self._issuer = issuer.rstrip("/")
        self._audience = audience
        self._leeway = leeway_seconds
        self._jwks_provider = jwks_provider or self._default_jwks_provider
        self._jwks_client_cache: dict[str, PyJWKClient] = {}

    def _default_jwks_provider(self, issuer: str) -> PyJWKClient:
        cached = self._jwks_client_cache.get(issuer)
        if cached is not None:
            return cached
        client = PyJWKClient(f"{issuer}/.well-known/jwks.json")
        self._jwks_client_cache[issuer] = client
        return client

    def verify(self, token: str) -> AuthContext:
        try:
            signing_key = self._jwks_provider(self._issuer).get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                issuer=self._issuer,
                audience=self._audience,
                leeway=self._leeway,
                options={"verify_aud": self._audience is not None},
            )
        except jwt.ExpiredSignatureError as exc:
            raise AuthError("Session token expired.", code="session_expired") from exc
        except jwt.PyJWTError as exc:
            raise AuthError(f"Invalid session token: {exc}") from exc

        user_id = claims.get("sub")
        if not user_id:
            raise AuthError("Session token missing subject.")

        return AuthContext(
            user_id=user_id,
            email=claims.get("email") or claims.get("email_address"),
            role=_role_from_claims(claims),
            tenant_id=_tenant_from_claims(claims),
            session_id=claims.get("sid"),
            expires_at=float(claims.get("exp", time.time())),
        )


def bearer_token(authorization_header: str | None) -> str | None:
    if not authorization_header:
        return None
    parts = authorization_header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None
