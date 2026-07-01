"""ASGI entrypoint: `uvicorn btx_platform.asgi:app`.

Builds the app from environment-driven settings. With no env set it runs on a
local SQLite file and an in-memory queue, so `uvicorn btx_platform.asgi:app`
boots with zero infra for smoke-testing the receiver. Set BTX_DATABASE_URL
(Postgres) + wire the Celery queue for production.
"""
from btx_platform.api import create_app

app = create_app()
