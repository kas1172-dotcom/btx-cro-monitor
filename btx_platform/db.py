"""Database engine/session setup. SQLite-friendly for local/test, Postgres in
prod — the model layer is dialect-neutral (JSON columns, string PKs)."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


def make_engine(url: str) -> Engine:
    """Create an engine. For in-memory SQLite (tests) use a StaticPool so every
    connection shares one database; otherwise standard settings."""
    if url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
        if ":memory:" in url or url in ("sqlite://", "sqlite:///:memory:"):
            return create_engine(
                url, connect_args=connect_args, poolclass=StaticPool, future=True
            )
        return create_engine(url, connect_args=connect_args, future=True)
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    elif url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    return create_engine(url, pool_pre_ping=True, future=True)


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False, future=True)


def init_db(engine: Engine) -> None:
    """Create tables. Dev/test convenience; production uses Alembic migrations."""
    # Import models so they register on Base.metadata before create_all.
    from btx_platform import models  # noqa: F401

    Base.metadata.create_all(engine)
    _ensure_work_item_action_columns(engine)
    _ensure_hubspot_task_audit_columns(engine)
    _ensure_tenant_id_columns(engine)


def _ensure_work_item_action_columns(engine: Engine) -> None:
    """Add WP8 work-item execution columns for existing dev/prod databases.

    This is intentionally narrow and additive; it keeps first-run containers from
    failing when the table already exists but predates the HubSpot action loop.
    """
    inspector = inspect(engine)
    if "work_items" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("work_items")}
    columns = {
        "external_system": "VARCHAR(40)",
        "external_record_id": "VARCHAR(120)",
        "external_record_url": "TEXT",
        "execution_idempotency_key": "VARCHAR(256)",
        "execution_error": "TEXT",
    }
    with engine.begin() as connection:
        for name, ddl_type in columns.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE work_items ADD COLUMN {name} {ddl_type}"))


def _ensure_hubspot_task_audit_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "hubspot_task_audits" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("hubspot_task_audits")}
    if "idempotency_key" not in existing:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE hubspot_task_audits ADD COLUMN idempotency_key VARCHAR(256)"))


def _ensure_tenant_id_columns(engine: Engine) -> None:
    """Add the WP10-A tenant_id column for existing dev/prod databases.

    New installs get it from create_all(); this backfills pre-WP10 SQLite
    files so local dev doesn't need a fresh database.
    """
    from btx_platform.models import DEFAULT_TENANT_ID

    tables = ("connections", "engine_configs", "canonical_accounts", "pipeline_runs", "work_items", "hubspot_task_audits")
    inspector = inspect(engine)
    with engine.begin() as connection:
        for table in tables:
            if table not in inspector.get_table_names():
                continue
            existing = {column["name"] for column in inspector.get_columns(table)}
            if "tenant_id" in existing:
                continue
            connection.execute(text(f"ALTER TABLE {table} ADD COLUMN tenant_id VARCHAR(80)"))
            connection.execute(
                text(f"UPDATE {table} SET tenant_id = :tenant WHERE tenant_id IS NULL"),
                {"tenant": DEFAULT_TENANT_ID},
            )


@contextmanager
def session_scope(session_factory: sessionmaker[Session]) -> Iterator[Session]:
    """Transactional scope: commit on success, rollback on error, always close."""
    session = session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
