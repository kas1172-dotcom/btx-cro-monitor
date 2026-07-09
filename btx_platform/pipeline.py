from __future__ import annotations

import json
import logging
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from btx_platform import models
from btx_platform.config import Settings
from btx_platform.engine_config import CLIENT_CONFIG_PATH, latest_config

logger = logging.getLogger(__name__)


class PipelineRateLimit(Exception):
    pass


class PipelineConfigError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _recent_runs(session: Session) -> list[models.PipelineRun]:
    return list(session.execute(
        select(models.PipelineRun).order_by(models.PipelineRun.triggered_at.desc()).limit(20)
    ).scalars())


def assert_can_start(session: Session, settings: Settings) -> None:
    runs = _recent_runs(session)
    if any(run.status in {"queued", "running"} for run in runs):
        raise PipelineRateLimit("A pipeline run is already in progress.")
    if runs:
        last = runs[0]
        if last.triggered_at.tzinfo is None:
            last_time = last.triggered_at.replace(tzinfo=timezone.utc)
        else:
            last_time = last.triggered_at
        if _now() - last_time < timedelta(seconds=settings.pipeline_min_interval_seconds):
            raise PipelineRateLimit("A pipeline run was triggered less than 10 minutes ago.")


def _enabled_sources(registry: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for source in registry.get("sources", []):
        if not source.get("enabled", True):
            continue
        config = dict(source.get("config") or {})
        if not config:
            config = {k: v for k, v in source.items() if k not in {"enabled", "notes", "config"}}
        config.pop("enabled", None)
        config.pop("notes", None)
        out.append(config)
    return out


def export_monitor_config(session: Session, settings: Settings) -> tuple[Path, Path]:
    base = json.loads(CLIENT_CONFIG_PATH.read_text(encoding="utf-8"))
    source_registry = latest_config(session, "source_registry")
    client_profile = latest_config(session, "client_profile")
    scoring_weights = latest_config(session, "scoring_weights")
    if not source_registry or not client_profile or not scoring_weights:
        raise PipelineConfigError("Engine configuration has not been seeded.")

    base["sources"] = _enabled_sources(source_registry.document)
    base["profile"] = client_profile.document

    generated_dir = Path(settings.pipeline_generated_dir)
    generated_dir.mkdir(parents=True, exist_ok=True)
    config_path = generated_dir / "btx-monitor-config.json"
    scoring_path = generated_dir / "scoring-weights.json"
    config_path.write_text(json.dumps(base, indent=2), encoding="utf-8")
    scoring_path.write_text(json.dumps(scoring_weights.document, indent=2), encoding="utf-8")
    return config_path, scoring_path


def _parse_counts(output_dir: Path) -> dict[str, Any] | None:
    run_output = output_dir / "run_output.json"
    if not run_output.exists():
        return None
    try:
        meta = json.loads(run_output.read_text(encoding="utf-8")).get("meta", {})
    except (ValueError, OSError):
        return None
    return {
        "items_collected": meta.get("items_collected"),
        "items_after_prefilter": meta.get("items_after_prefilter"),
        "items_analyzed": meta.get("items_analyzed"),
    }


def run_subprocess(config_path: Path, settings: Settings) -> tuple[str, dict[str, Any] | None]:
    output_dir = Path(settings.pipeline_output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable,
        "-m",
        "monitor_engine",
        "--config",
        str(config_path),
        "--output",
        str(output_dir),
        "--archive",
        str(output_dir / "archive.json"),
    ]
    logger.info("pipeline.subprocess.start", extra={"command": " ".join(command)})
    completed = subprocess.run(
        command,
        text=True,
        capture_output=True,
        timeout=settings.pipeline_timeout_seconds,
        check=False,
    )
    detail = (completed.stdout + "\n" + completed.stderr).strip()
    if completed.returncode != 0:
        raise RuntimeError(detail or f"monitor_engine exited {completed.returncode}")
    return detail, _parse_counts(output_dir)


def dispatch_github(settings: Settings) -> str:
    if not settings.github_pat:
        raise PipelineConfigError("GITHUB_PAT is required for GitHub workflow dispatch.")
    url = f"https://api.github.com/repos/{settings.github_repo}/actions/workflows/{settings.github_workflow}/dispatches"
    payload = {"ref": settings.github_ref, "inputs": {"client": "btx"}}
    logger.info("pipeline.github.dispatch", extra={"repo": settings.github_repo, "workflow": settings.github_workflow})
    with httpx.Client(timeout=30.0) as client:
        response = client.post(
            url,
            headers={
                "authorization": f"Bearer {settings.github_pat}",
                "accept": "application/vnd.github+json",
                "x-github-api-version": "2022-11-28",
            },
            json=payload,
        )
    if response.status_code >= 300:
        raise RuntimeError(f"GitHub dispatch failed ({response.status_code}): {response.text}")
    return f"Dispatched {settings.github_workflow} on {settings.github_ref}."


def trigger_pipeline(session: Session, settings: Settings) -> models.PipelineRun:
    assert_can_start(session, settings)
    mechanism = settings.pipeline_mechanism.lower()
    if mechanism not in {"subprocess", "github"}:
        raise PipelineConfigError("BTX_PIPELINE_MECHANISM must be subprocess or github.")

    config_path, _scoring_path = export_monitor_config(session, settings)
    run = models.PipelineRun(
        mechanism=mechanism,
        status="running" if mechanism == "subprocess" else "queued",
        config_path=str(config_path),
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    try:
        if mechanism == "subprocess":
            detail, counts = run_subprocess(config_path, settings)
            run.status = "completed"
            run.item_counts = counts
            run.detail = detail[-4000:] if detail else "Completed."
            run.completed_at = _now()
        else:
            run.detail = dispatch_github(settings)
            run.status = "dispatched"
            run.completed_at = _now()
        session.commit()
    except Exception as exc:
        run.status = "failed"
        run.detail = str(exc)
        run.completed_at = _now()
        session.commit()
        logger.exception("pipeline.run.failed", extra={"run_id": run.id})
    session.refresh(run)
    logger.info("pipeline.run.finished", extra={"run_id": run.id, "status": run.status})
    return run


def list_runs(session: Session, limit: int = 20) -> list[models.PipelineRun]:
    return _recent_runs(session)[:limit]
