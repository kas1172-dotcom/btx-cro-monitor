"""Webhook signature verification.

Inbound webhooks are authenticated with an HMAC-SHA256 of the *raw* request body
keyed by the connection's signing secret. Verification is constant-time and runs
before any parsing, so an unsigned/forged payload is rejected without touching
the body.
"""
from __future__ import annotations

import hashlib
import hmac

_PREFIX = "sha256="


def compute_signature(secret: str, body: bytes) -> str:
    """The expected header value for *body* under *secret* (``sha256=<hex>``)."""
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return _PREFIX + digest


def verify_signature(secret: str, body: bytes, provided: str | None) -> bool:
    """True iff *provided* matches the HMAC of *body*. Accepts the value with or
    without the ``sha256=`` prefix. Constant-time; never raises."""
    if not provided:
        return False
    expected = compute_signature(secret, body)
    candidate = provided if provided.startswith(_PREFIX) else _PREFIX + provided
    return hmac.compare_digest(expected, candidate)
