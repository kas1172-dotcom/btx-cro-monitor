"""Runtime configuration. All values come from the environment (prefix BTX_) or
an optional .env file - never hardcoded. See .env.example for the full list."""
from __future__ import annotations

from functools import lru_cache

from pydantic import AliasChoices, Field, model_validator
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
    deployment_mode: str = "development"  # development | demo | production
    tenant_id: str = "local"
    source_type: str = "repository_seed"
    data_provenance: str = "Repository-backed local data"
    deployed_revision: str = "unknown"
    expected_repository_revision: str = "779198f"
    external_writes_enabled: bool = False
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
    ask_online_enabled: bool = False
    ask_web_search_enabled: bool = True
    ask_default_source_mode: str = "automatic"
    ask_model: str = "claude-haiku-4-5-20251001"
    ask_web_max_uses: int = 3
    ask_max_tool_turns: int = 2
    ask_timeout_ms: int = 60_000
    ask_max_output_tokens: int = 2_048
    ask_daily_search_budget: int = 100
    hubspot_access_token: str | None = None
    hubspot_environment: str = "none"
    hubspot_allow_production_writes: bool = False
    # Optional integration seams. Disabled systems resolve to safe stub adapters.
    contact_registry_enabled: bool = False
    contact_registry_base_url: str | None = None
    contact_registry_auth_secret: str | None = None
    contact_registry_auth_scopes: str | None = None
    contact_registry_timeout_seconds: float = 10.0
    prism_enabled: bool = False
    prism_base_url: str | None = None
    prism_auth_secret: str | None = None
    prism_auth_scopes: str | None = None
    prism_timeout_seconds: float = 10.0
    paperless_parts_enabled: bool = False
    paperless_parts_base_url: str | None = None
    paperless_parts_auth_secret: str | None = None
    paperless_parts_auth_scopes: str | None = None
    paperless_parts_timeout_seconds: float = 10.0
    erp_mes_enabled: bool = False
    erp_mes_base_url: str | None = None
    erp_mes_auth_secret: str | None = None
    erp_mes_auth_scopes: str | None = None
    erp_mes_timeout_seconds: float = 10.0
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
    monitor_stale_after_days: int = 10
    event_retention_days: int = 90
    audit_retention_days: int = 365

    @model_validator(mode="after")
    def validate_environment_truth(self) -> "Settings":
        mode = self.deployment_mode.strip().lower()
        if self.env.strip().lower() == "prod" and mode == "development":
            mode = "production"
        if mode not in {"development", "demo", "production"}:
            raise ValueError("BTX_DEPLOYMENT_MODE must be development, demo, or production.")
        self.deployment_mode = mode
        if mode == "production":
            secret = (self.clerk_secret_key or "").lower()
            issuer = (self.clerk_issuer or "").lower()
            if secret.startswith("sk_test_") or ".accounts.dev" in issuer:
                raise ValueError("Production rejects Clerk development credentials.")
        if mode == "demo":
            self.external_writes_enabled = False
        return self

    @property
    def cors_origins(self) -> list[str]:
        raw = self.frontend_origins or self.frontend_origin
        return [item.strip() for item in raw.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
