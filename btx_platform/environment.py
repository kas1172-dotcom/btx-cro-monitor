"""Canonical, non-secret deployment truth shared by diagnostics and the UI."""
from __future__ import annotations

from typing import Any

from btx_platform.config import Settings


def clerk_key_class(settings: Settings) -> str:
    key = settings.clerk_secret_key or ""
    if key.startswith("sk_live_"):
        return "live"
    if key.startswith("sk_test_"):
        return "development"
    return "unconfigured" if not key else "unknown"


def environment_contract(settings: Settings) -> dict[str, Any]:
    is_demo = settings.deployment_mode == "demo"
    writes = bool(
        settings.external_writes_enabled
        and settings.hubspot_access_token
        and settings.hubspot_environment in {"developer", "sandbox", "production"}
        and not is_demo
    )
    return {
        "deploymentMode": settings.deployment_mode,
        "isDemonstration": is_demo,
        "displayLabel": "Demonstration" if is_demo else settings.deployment_mode.capitalize(),
        "demoNotice": "Demonstration — internal records are illustrative" if is_demo else None,
        "tenant": {"id": settings.tenant_id},
        "auth": {
            "provider": "clerk",
            "keyClass": clerk_key_class(settings),
            "configured": bool(settings.clerk_secret_key or settings.clerk_issuer),
        },
        "source": {
            "type": settings.source_type,
            "dataProvenance": settings.data_provenance,
        },
        "externalWrites": {"capable": writes},
        "revision": {
            "deployed": settings.deployed_revision,
            "expected": settings.expected_repository_revision,
            "seed": "779198f",
            "matchesExpected": (
                settings.deployed_revision != "unknown"
                and settings.expected_repository_revision == "779198f"
            ),
        },
    }
