"""Unit coverage for btx_platform.auth: role hierarchy, tenant default,
rate limiting — independent of the full FastAPI app (see
test_platform_tier1.py for the end-to-end unauth/viewer/tenant-isolation
route tests)."""
from __future__ import annotations

import pytest

pytest.importorskip("jwt")

from btx_platform.auth import AuthError, bearer_token  # noqa: E402
from btx_platform.ratelimit import RateLimiter  # noqa: E402
from tests.auth_helpers import make_clerk_fixture  # noqa: E402


def test_bearer_token_parses_valid_header():
    assert bearer_token("Bearer abc.def.ghi") == "abc.def.ghi"


def test_bearer_token_rejects_malformed_headers():
    assert bearer_token(None) is None
    assert bearer_token("") is None
    assert bearer_token("abc.def.ghi") is None          # missing scheme
    assert bearer_token("Basic abc.def.ghi") is None    # wrong scheme
    assert bearer_token("Bearer ") is None               # empty token


def test_role_hierarchy_ordering():
    fixture = make_clerk_fixture()
    viewer = fixture.verifier.verify(fixture.token(role="viewer"))
    analyst = fixture.verifier.verify(fixture.token(role="analyst"))
    admin = fixture.verifier.verify(fixture.token(role="admin"))

    assert viewer.has_role("viewer") and not viewer.has_role("analyst")
    assert analyst.has_role("viewer") and analyst.has_role("analyst") and not analyst.has_role("admin")
    assert admin.has_role("viewer") and admin.has_role("analyst") and admin.has_role("cro") and admin.has_role("admin")


def test_unknown_role_claim_fails_closed_to_viewer():
    fixture = make_clerk_fixture()
    ctx = fixture.verifier.verify(fixture.token(role="superuser"))
    assert ctx.role == "viewer"


def test_missing_org_id_defaults_to_default_tenant():
    fixture = make_clerk_fixture()
    ctx = fixture.verifier.verify(fixture.token(tenant_id=""))
    assert ctx.tenant_id == "default"


def test_verify_rejects_tampered_signature():
    fixture = make_clerk_fixture()
    token = fixture.token()
    tampered = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
    with pytest.raises(AuthError):
        fixture.verifier.verify(tampered)


def test_rate_limiter_blocks_after_max_requests():
    limiter = RateLimiter(max_requests=3, window_seconds=60)
    now = 1000.0
    assert limiter.allow("user-1", now=now) is True
    assert limiter.allow("user-1", now=now) is True
    assert limiter.allow("user-1", now=now) is True
    assert limiter.allow("user-1", now=now) is False   # 4th request in the window


def test_rate_limiter_is_per_key():
    limiter = RateLimiter(max_requests=1, window_seconds=60)
    now = 1000.0
    assert limiter.allow("user-1", now=now) is True
    assert limiter.allow("user-2", now=now) is True  # different user, own bucket


def test_rate_limiter_window_slides():
    limiter = RateLimiter(max_requests=1, window_seconds=60)
    assert limiter.allow("user-1", now=1000.0) is True
    assert limiter.allow("user-1", now=1030.0) is False  # still within window
    assert limiter.allow("user-1", now=1061.0) is True   # window has slid past
