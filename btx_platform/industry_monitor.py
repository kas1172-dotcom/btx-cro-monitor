"""Copyright-safe projection of monitor-engine artifacts for the CRO cockpit."""
from __future__ import annotations

import hashlib
import html
import ipaddress
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRACKING_PARAMETERS = {
    "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "source",
}
PROMPT_INJECTION_PATTERNS = (
    "ignore previous instructions",
    "ignore all instructions",
    "reveal system prompt",
    "reveal secrets",
    "execute this command",
)
MAX_SUMMARY_LENGTH = 600


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def safe_public_url(value: str) -> str:
    """Return a normalized public HTTP(S) URL or raise without fetching it."""
    parsed = urlsplit(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Source URL must be a public HTTP(S) URL.")
    host = parsed.hostname.rstrip(".").lower()
    if host in {"localhost", "localhost.localdomain"} or host.endswith((".local", ".internal")):
        raise ValueError("Private source URLs are not allowed.")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address and not address.is_global:
        raise ValueError("Private source URLs are not allowed.")
    parameters = [
        (key, item)
        for key, item in parse_qsl(parsed.query, keep_blank_values=True)
        if not key.lower().startswith("utm_") and key.lower() not in TRACKING_PARAMETERS
    ]
    path = re.sub(r"/{2,}", "/", parsed.path or "/")
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), path.rstrip("/") or "/", urlencode(parameters), ""))


def sanitize_external_text(value: Any, *, limit: int = MAX_SUMMARY_LENGTH) -> str:
    """Remove markup/instructions and retain a short, normalized factual excerpt."""
    text = str(value or "")
    text = re.sub(r"(?is)<(script|style|iframe|object).*?>.*?</\1>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html.unescape(text)
    for phrase in PROMPT_INJECTION_PATTERNS:
        text = re.sub(re.escape(phrase), "[external instruction removed]", text, flags=re.IGNORECASE)
    text = re.sub(r"(?i)\b(authorization|api[_-]?key|access[_-]?token|token)\s*[:=]\s*\S+", r"\1=[redacted]", text)
    text = re.sub(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [redacted]", text)
    text = " ".join(text.split())
    return text[:limit].rstrip()


def content_fingerprint(publisher: str, headline: str, publication_date: str | None) -> str:
    material = "|".join([
        sanitize_external_text(publisher).casefold(),
        sanitize_external_text(headline).casefold(),
        (publication_date or "")[:10],
    ])
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _source_type(value: str) -> str:
    return {
        "json_api": "official_api",
        "rss": "rss",
        "html_list": "public_web",
    }.get(value, "public_web")


def source_registry_projection(
    registry: dict[str, Any],
    *,
    source_health: dict[str, Any] | None,
    schedule: str,
    run_at: str | None,
) -> list[dict[str, Any]]:
    health_map = source_health or {}
    result: list[dict[str, Any]] = []
    for raw in registry.get("sources", []):
        if not isinstance(raw, dict):
            continue
        config = raw.get("config") if isinstance(raw.get("config"), dict) else raw
        source_id = str(raw.get("id") or config.get("id") or "")
        url = str(raw.get("url") or config.get("url") or "")
        try:
            public_url = safe_public_url(url)
            domain = urlsplit(public_url).hostname or ""
        except ValueError:
            public_url, domain = "", ""
        health = health_map.get(source_id) if isinstance(health_map.get(source_id), dict) else {}
        error = sanitize_external_text(health.get("error"), limit=220) or None
        enabled = bool(raw.get("enabled", True))
        mode = "disabled" if not enabled else "live"
        result.append({
            "id": source_id,
            "name": sanitize_external_text(raw.get("name") or config.get("name") or source_id, limit=160),
            "publisher": sanitize_external_text(raw.get("name") or config.get("name") or source_id, limit=160),
            "domain": domain,
            "publicUrl": public_url,
            "sourceType": _source_type(str(raw.get("type") or config.get("type") or "")),
            "collectionMode": mode,
            "schedule": schedule,
            "markets": [],
            "entities": [],
            "programs": [],
            "capabilities": [],
            "lastAttemptAt": run_at,
            "lastSuccessAt": run_at if enabled and not error else None,
            "lastFailureAt": run_at if error else None,
            "freshnessSlaHours": 168,
            "health": "disabled" if not enabled else "failed" if error else "healthy",
            "safeResultStatus": "disabled" if not enabled else "failed" if error else "success",
            "recordsDiscovered": int(health.get("items_collected") or 0),
            "recordsAccepted": int(health.get("items_collected") or 0),
            "duplicatesRejected": 0,
            "recordsRejectedIrrelevant": 0,
            "parsingFailures": int(health.get("date_parse_failures") or 0),
            "sanitizedError": error,
        })
    return result


def industry_update(item: dict[str, Any], *, run_id: str, retrieved_at: str) -> dict[str, Any] | None:
    try:
        url = safe_public_url(str(item.get("url") or ""))
    except ValueError:
        return None
    headline = sanitize_external_text(item.get("title"), limit=300)
    if not headline:
        return None
    source_id = str(item.get("source_id") or "unknown")
    editions = item.get("per_edition") if isinstance(item.get("per_edition"), dict) else {}
    analyses = [value for value in editions.values() if isinstance(value, dict)]
    best = max(analyses, key=lambda value: int(value.get("relevance_score") or 0), default={})
    summary = sanitize_external_text(
        best.get("so_what")
        or (item.get("deep_analysis") or {}).get("sections", {}).get("executive_summary")
        or headline
    )
    reasons = [
        sanitize_external_text(best.get("so_what"), limit=320),
        sanitize_external_text(best.get("now_what"), limit=320),
    ]
    reasons = [reason for reason in reasons if reason]
    entities = [
        {"name": sanitize_external_text(entity.get("name"), limit=120), "type": sanitize_external_text(entity.get("type"), limit=60)}
        for entity in item.get("entities", [])
        if isinstance(entity, dict) and entity.get("name")
    ]
    categories = [sanitize_external_text(value, limit=80) for value in best.get("categories", []) if value]
    variants: list[dict[str, str]] = []
    for value in item.get("also_covered_by", []):
        if not isinstance(value, dict) or not value.get("url"):
            continue
        try:
            variant_url = safe_public_url(str(value.get("url")))
        except ValueError:
            continue
        variants.append({
            "publisher": sanitize_external_text(value.get("source_id"), limit=120),
            "headline": sanitize_external_text(value.get("title"), limit=300),
            "url": variant_url,
        })
    publication_date = _iso(item.get("published_at"))
    return {
        "id": f"monitor-{item.get('item_id')}",
        "canonicalUrl": url,
        "sourceId": source_id,
        "publisher": source_id.replace("-", " ").title(),
        "headline": headline,
        "normalizedSummary": summary,
        "eventDate": publication_date,
        "publicationDate": publication_date,
        "retrievedAt": _iso(item.get("collected_at")) or retrieved_at,
        "contentFingerprint": content_fingerprint(source_id, headline, publication_date),
        "entities": entities,
        "programs": [entity for entity in entities if "program" in entity["type"].casefold()],
        "markets": categories,
        "capabilityTags": categories,
        "relationshipState": "market_only",
        "evidenceClass": "public_source",
        "relevanceScore": int(best.get("relevance_score") or item.get("importance_score") or 0),
        "relevanceReasons": reasons or ["Recent public-source context matched the configured BTX monitor rubric."],
        "reviewStatus": "new",
        "runId": run_id,
        "sourceVariants": variants,
    }


def monitor_snapshot(
    artifact: dict[str, Any] | None,
    registry: dict[str, Any],
    *,
    stale_after_hours: int,
    now: datetime | None = None,
) -> dict[str, Any]:
    current = now or datetime.now(UTC)
    cadence = registry.get("cadence") if isinstance(registry.get("cadence"), dict) else {}
    schedule = str(cadence.get("cron") or "configured externally")
    if not artifact:
        return {
            "state": "never_run",
            "ingestionMode": "failed",
            "status": "Monitor has not run",
            "run": None,
            "sources": source_registry_projection(registry, source_health=None, schedule=schedule, run_at=None),
            "updates": [],
        }
    meta = artifact.get("meta") if isinstance(artifact.get("meta"), dict) else {}
    run_at = _iso(meta.get("run_at"))
    run_id = str(meta.get("run_id") or "unknown")
    try:
        run_time = datetime.fromisoformat(str(run_at).replace("Z", "+00:00"))
        if run_time.tzinfo is None:
            run_time = run_time.replace(tzinfo=UTC)
        age_hours = max(0, (current - run_time).total_seconds() / 3600)
    except (TypeError, ValueError):
        age_hours = float("inf")
    sources = source_registry_projection(
        registry,
        source_health=artifact.get("source_health"),
        schedule=schedule,
        run_at=run_at,
    )
    updates = [
        update
        for item in artifact.get("items", [])
        if isinstance(item, dict)
        for update in [industry_update(item, run_id=run_id, retrieved_at=run_at or current.isoformat())]
        if update
    ]
    publisher_by_id = {source["id"]: source["publisher"] for source in sources}
    for update in updates:
        update["publisher"] = publisher_by_id.get(update["sourceId"], update["publisher"])
    failed = sum(1 for source in sources if source["health"] == "failed")
    stale = age_hours > stale_after_hours
    checked = sum(1 for source in sources if source["collectionMode"] != "disabled")
    all_failed = checked > 0 and failed == checked
    state = "stale" if stale else "failed" if all_failed else "partial_failure" if failed else "complete"
    ingestion_mode = "stored_snapshot" if stale else "failed" if all_failed else "live"
    counts = {
        "sourcesChecked": sum(1 for source in sources if source["collectionMode"] != "disabled"),
        "newRecords": len((artifact.get("whats_new") or {}).get("new_tier_1", []))
        + len((artifact.get("whats_new") or {}).get("new_tier_2", [])),
        "unchangedRecords": max(0, len(updates) - len((artifact.get("whats_new") or {}).get("new_tier_1", [])) - len((artifact.get("whats_new") or {}).get("new_tier_2", []))),
        "duplicatesRejected": sum(len(update["sourceVariants"]) for update in updates),
        "irrelevantRecordsRejected": max(0, int(meta.get("items_collected") or 0) - int(meta.get("items_after_prefilter") or 0)),
        "failedSources": failed,
    }
    return {
        "state": state,
        "ingestionMode": ingestion_mode,
        "status": "Latest data is stale" if stale else "All sources failed" if all_failed else "Some sources failed" if failed else "Collection completed",
        "run": {
            "id": run_id,
            "startedAt": run_at,
            "completedAt": run_at,
            "durationMs": None,
            "version": str(meta.get("engine_version") or "unknown"),
            "lastAttemptAt": run_at,
            "lastSuccessfulAt": None if all_failed else run_at,
            "expectedNextRun": None,
            "latestRetrievedAt": max((update["retrievedAt"] for update in updates), default=None),
            "counts": counts,
        },
        "sources": sources,
        "updates": sorted(updates, key=lambda update: (update["relevanceScore"], update["retrievedAt"]), reverse=True),
    }


def load_artifact(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        import json
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None
