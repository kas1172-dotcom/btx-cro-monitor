"""Runtime configuration. All values come from the environment (prefix BTX_) or
an optional .env file — never hardcoded. See .env.example for the full list."""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="BTX_", env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    env: str = "dev"
    # SQLite by default so the service runs with zero infra locally; Postgres in prod.
    database_url: str = "sqlite:///./btx_platform.db"
    redis_url: str = "redis://localhost:6379/0"

    # Reliability knobs (Phase 2 forwarder honors these).
    max_attempts: int = 5
    retry_backoff_base: float = 2.0
    retry_backoff_max: float = 600.0

    # Inbound request hardening.
    max_body_bytes: int = 1_048_576          # reject payloads larger than 1 MiB
    signature_header: str = "X-BTX-Signature"
    idempotency_header: str = "X-Idempotency-Key"


@lru_cache
def get_settings() -> Settings:
    return Settings()
