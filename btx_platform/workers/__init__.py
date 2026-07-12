"""Celery worker process (WP10-B). Run with:

    celery -A btx_platform.workers.celery_app worker --loglevel=info

Separate from the API process; connects to the same Postgres/Redis via
BTX_DATABASE_URL / BTX_REDIS_URL.
"""
from __future__ import annotations

from celery import Celery

from btx_platform.config import get_settings


def make_celery_app() -> Celery:
    settings = get_settings()
    app = Celery("btx_platform", broker=settings.redis_url, backend=settings.redis_url)
    app.conf.update(
        task_serializer="json",
        accept_content=["json"],
        result_serializer="json",
        task_default_queue="btx_platform",
        # Task-level retry/backoff comes from forward_event's own decorator
        # (bounded by settings.max_attempts), not Celery's unlimited default.
        task_acks_late=True,
        worker_prefetch_multiplier=1,
    )
    from btx_platform.workers.forward import register_forward_task

    register_forward_task(app)
    return app


celery_app = make_celery_app()
