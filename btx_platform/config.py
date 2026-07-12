"""Runtime configuration. All values come from the environment (prefix BTX_) or
an optional .env file — never hardcoded. See .env.example for the full list."""
from __future__ import annotations

from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="BTX_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    env: str = "dev"
    # SQLite by default so the service runs with zero infra locally; Postgres in prod.
    database_url: str = Field(
        default="sqlite:///./btx_platform.db",
        validation_alias=AliasChoices("BTX_DATABASE_URL", "DATABASE_URL"),
    )
    redis_url: str = "redis://localhost:6379/0"

    # Reliability knobs (Phase 2 forwarder honors these).
    max_attempts: int = 5
    retry_backoff_base: float = 2.0
    retry_backoff_max: float = 600.0

    # Inbound request hardening.
    max_body_bytes: int = 1_048_576          # reject payloads larger than 1 MiB
    signature_header: str = "X-BTX-Signature"
    idempotency_header: str = "X-Idempotency-Key"
    frontend_origin: str = "http://localhost:5173"
    frontend_origins: str | None = None
    anthropic_api_key: str | None = None
    anthropic_base_url: str = "https://api.anthropic.com/v1/messages"
    anthropic_version: str = "2023-06-01"
    llm_timeout_seconds: float = 45.0
    llm_max_body_bytes: int = 524_288
    hubspot_access_token: str | None = None
    gmail_allowlist: str = ""
    pipeline_mechanism: str = "subprocess"
    pipeline_output_dir: str = "clients/btx/artifacts"
    pipeline_generated_dir: str = ".btx_platform/generated"
    pipeline_timeout_seconds: float = 900.0
    pipeline_min_interval_seconds: int = 600
    github_pat: str | None = None
    github_repo: str = "kas1172-dotcom/btx-cro-monitor"
    github_workflow: str = "monitor.yml"
    github_ref: str = "main"

    # Auth (WP10-A): Clerk validates the session; the backend only checks it.
    clerk_secret_key: str | None = None
    clerk_issuer: str | None = None  # e.g. https://<your-instance>.clerk.accounts.dev
    clerk_audience: str | None = None
    rate_limit_max_requests: int = 30
    rate_limit_window_seconds: float = 60.0

    # Persistence/jobs/crypto (WP10-B).
    encryption_key: str | None = None
    queue_backend: str = "memory"  # memory (dev/test) | celery (prod)

    # Observability, health, retention (WP10-C).
    sentry_dsn: str | None = None
    monitor_stale_after_days: int = 7
    event_retention_days: int = 90
    audit_retention_days: int = 365

    @property
    def cors_origins(self) -> list[str]:
        raw = self.frontend_origins or self.frontend_origin
        return [item.strip() for item in raw.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
