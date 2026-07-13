"""Alembic migration coverage (WP10-B).

Exercises the real alembic.ini / alembic/env.py against a throwaway SQLite
file (Alembic's offline/online modes both need a real file path, not
":memory:") to prove: the initial migration applies and matches the current
models exactly, upgrade/downgrade/upgrade round-trips cleanly, and
create_app refuses to serve in "prod" env against an unmigrated database.
"""
from __future__ import annotations

from pathlib import Path

import pytest

pytest.importorskip("alembic")
pytest.importorskip("fastapi")
pytest.importorskip("sqlalchemy")

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import inspect, text  # noqa: E402

from btx_platform.api import create_app  # noqa: E402
from btx_platform.config import Settings  # noqa: E402
from btx_platform.db import SchemaNotMigrated, assert_schema_current, make_engine  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]


def _alembic_config(db_path: Path) -> Config:
    config = Config(str(REPO_ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return config


def test_migration_applies_and_matches_current_models(tmp_path: Path):
    db_path = tmp_path / "migration_test.db"
    config = _alembic_config(db_path)

    command.upgrade(config, "head")

    engine = make_engine(f"sqlite:///{db_path}")
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    for expected in (
        "connections", "events", "idempotency_keys", "outbound_log", "dead_letters",
        "engine_configs", "canonical_accounts", "pipeline_runs", "work_items",
        "hubspot_task_audits", "deliverables", "alembic_version",
    ):
        assert expected in tables, f"migration did not create {expected}"

    work_item_columns = {c["name"] for c in inspector.get_columns("work_items")}
    assert "tenant_id" in work_item_columns  # WP10-A column present in the initial migration
    deliverable_columns = {c["name"] for c in inspector.get_columns("deliverables")}
    assert {"tenant_id", "canonical_account_id", "program_id", "trip_id", "document"} <= deliverable_columns


def test_migration_round_trips_upgrade_downgrade_upgrade(tmp_path: Path):
    db_path = tmp_path / "roundtrip_test.db"
    config = _alembic_config(db_path)

    command.upgrade(config, "head")
    engine = make_engine(f"sqlite:///{db_path}")
    tables_after_up = set(inspect(engine).get_table_names())
    assert "work_items" in tables_after_up

    command.downgrade(config, "base")
    tables_after_down = set(inspect(engine).get_table_names())
    assert "work_items" not in tables_after_down
    assert "alembic_version" in tables_after_down  # alembic keeps its own bookkeeping table

    command.upgrade(config, "head")
    tables_after_reup = set(inspect(engine).get_table_names())
    assert tables_after_reup == tables_after_up


def test_deliverables_migration_downgrade_one_step_removes_table(tmp_path: Path):
    db_path = tmp_path / "deliverables_roundtrip_test.db"
    config = _alembic_config(db_path)

    command.upgrade(config, "head")
    engine = make_engine(f"sqlite:///{db_path}")
    assert "deliverables" in set(inspect(engine).get_table_names())

    command.downgrade(config, "-1")
    engine = make_engine(f"sqlite:///{db_path}")
    tables_after_down_one = set(inspect(engine).get_table_names())
    assert "deliverables" not in tables_after_down_one
    assert "work_items" in tables_after_down_one

    command.upgrade(config, "head")
    engine = make_engine(f"sqlite:///{db_path}")
    assert "deliverables" in set(inspect(engine).get_table_names())


def test_assert_schema_current_passes_after_migration(tmp_path: Path):
    db_path = tmp_path / "current_test.db"
    command.upgrade(_alembic_config(db_path), "head")
    engine = make_engine(f"sqlite:///{db_path}")

    assert_schema_current(engine)  # does not raise


def test_assert_schema_current_rejects_unmigrated_database(tmp_path: Path):
    db_path = tmp_path / "empty_test.db"
    engine = make_engine(f"sqlite:///{db_path}")
    engine.connect().close()  # create the empty file, but run no migrations

    with pytest.raises(SchemaNotMigrated):
        assert_schema_current(engine)


def test_assert_schema_current_rejects_stale_revision(tmp_path: Path):
    db_path = tmp_path / "stale_test.db"
    command.upgrade(_alembic_config(db_path), "head")
    engine = make_engine(f"sqlite:///{db_path}")
    with engine.begin() as connection:
        connection.execute(text("UPDATE alembic_version SET version_num = 'not-a-real-revision'"))

    with pytest.raises(SchemaNotMigrated):
        assert_schema_current(engine)


def test_create_app_prod_env_refuses_unmigrated_database(tmp_path: Path):
    db_path = tmp_path / "prod_test.db"
    settings = Settings(env="prod", database_url=f"sqlite:///{db_path}")

    with pytest.raises(SchemaNotMigrated):
        create_app(settings=settings)


def test_create_app_prod_env_serves_after_migration(tmp_path: Path):
    db_path = tmp_path / "prod_ready_test.db"
    command.upgrade(_alembic_config(db_path), "head")
    settings = Settings(env="prod", database_url=f"sqlite:///{db_path}")

    app = create_app(settings=settings)  # does not raise

    assert app is not None
