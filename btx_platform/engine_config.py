from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from btx_platform import models
from btx_platform.schemas import (
    ClientProfileDocument,
    ScoringWeightsDocument,
    SourceRegistryDocument,
)

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[1]
SCORING_PATH = ROOT / "frontend/data/config/scoring-weights.v1.json"
CLIENT_CONFIG_PATH = ROOT / "clients/btx/config.json"

CONFIG_SCHEMAS: dict[str, type[BaseModel]] = {
    "scoring_weights": ScoringWeightsDocument,
    "source_registry": SourceRegistryDocument,
    "client_profile": ClientProfileDocument,
}


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _source_registry_from_client_config(config: dict[str, Any]) -> dict[str, Any]:
    sources: list[dict[str, Any]] = []
    for source in config.get("sources", []):
        if not isinstance(source, dict):
            continue
        sources.append({
            **source,
            "enabled": True,
            "notes": "",
            "config": dict(source),
        })
    return {"sources": sources}


def seed_engine_configs(session_factory: sessionmaker[Session], tenant_id: str = models.DEFAULT_TENANT_ID) -> None:
    with session_factory() as session:
        existing = {
            row[0] for row in session.execute(
                select(models.EngineConfig.name)
                .where(models.EngineConfig.tenant_id == tenant_id)
                .distinct()
            ).all()
        }
        client_config = _read_json(CLIENT_CONFIG_PATH)
        seeds = {
            "scoring_weights": _read_json(SCORING_PATH),
            "source_registry": _source_registry_from_client_config(client_config),
            "client_profile": client_config.get("profile", {}),
        }
        for name, document in seeds.items():
            if name in existing:
                continue
            validate_config_document(name, document)
            session.add(models.EngineConfig(
                tenant_id=tenant_id,
                name=name,
                version=1,
                document=document,
                change_note="Seeded from repository defaults.",
            ))
            logger.info("engine_config.seed", extra={"config_name": name, "tenant_id": tenant_id})
        session.commit()


def validate_config_document(name: str, document: dict[str, Any]) -> dict[str, Any]:
    schema = CONFIG_SCHEMAS.get(name)
    if schema is None:
        raise KeyError(f"unknown engine config {name}")
    return schema.model_validate(document).model_dump(mode="json")


def latest_config(session: Session, name: str, tenant_id: str = models.DEFAULT_TENANT_ID) -> models.EngineConfig | None:
    return session.execute(
        select(models.EngineConfig)
        .where(models.EngineConfig.name == name, models.EngineConfig.tenant_id == tenant_id)
        .order_by(models.EngineConfig.version.desc())
        .limit(1)
    ).scalar_one_or_none()


def config_history(
    session: Session, name: str, tenant_id: str = models.DEFAULT_TENANT_ID, limit: int = 20
) -> list[models.EngineConfig]:
    return list(session.execute(
        select(models.EngineConfig)
        .where(models.EngineConfig.name == name, models.EngineConfig.tenant_id == tenant_id)
        .order_by(models.EngineConfig.version.desc())
        .limit(limit)
    ).scalars())


def put_config(
    session: Session,
    name: str,
    document: dict[str, Any],
    change_note: str | None,
    tenant_id: str = models.DEFAULT_TENANT_ID,
) -> models.EngineConfig:
    validated = validate_config_document(name, document)
    latest = latest_config(session, name, tenant_id)
    next_version = (latest.version if latest else 0) + 1
    row = models.EngineConfig(
        tenant_id=tenant_id,
        name=name,
        version=next_version,
        document=validated,
        change_note=change_note,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    logger.info("engine_config.put", extra={"config_name": name, "version": next_version, "tenant_id": tenant_id})
    return row
