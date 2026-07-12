"""Request logging and optional error tracking."""
from __future__ import annotations

import contextvars
import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from btx_platform.config import Settings

_SENTRY_ENABLED = False

_request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("btx_request_id", default=None)


def new_request_id() -> str:
    return uuid.uuid4().hex


def set_request_id(value: str) -> None:
    _request_id_var.set(value)


def current_request_id() -> str | None:
    return _request_id_var.get()


class RequestIdLogFilter(logging.Filter):
    """Stamps every log record emitted during a request with its request id,
    so JsonLogFormatter's catch-all extra-attrs pass-through includes it."""

    def filter(self, record: logging.LogRecord) -> bool:
        request_id = current_request_id()
        if request_id is not None and not hasattr(record, "request_id"):
            record.request_id = request_id
        return True

_STANDARD_LOG_ATTRS = {
    "args",
    "asctime",
    "created",
    "exc_info",
    "exc_text",
    "filename",
    "funcName",
    "levelname",
    "levelno",
    "lineno",
    "module",
    "msecs",
    "message",
    "msg",
    "name",
    "pathname",
    "process",
    "processName",
    "relativeCreated",
    "stack_info",
    "thread",
    "threadName",
}


class JsonLogFormatter(logging.Formatter):
    """Format application logs as one JSON object per line."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _STANDARD_LOG_ATTRS and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, separators=(",", ":"))


def configure_observability(settings: Settings) -> None:
    """Install JSON logging and enable Sentry only when BTX_SENTRY_DSN is set."""

    global _SENTRY_ENABLED
    root = logging.getLogger()
    if not getattr(root, "_btx_json_logging", False):
        handler = logging.StreamHandler()
        handler.setFormatter(JsonLogFormatter())
        handler.addFilter(RequestIdLogFilter())
        root.handlers = [handler]
        root.setLevel(logging.INFO)
        setattr(root, "_btx_json_logging", True)

    if not settings.sentry_dsn:
        _SENTRY_ENABLED = False
        return
    try:
        import sentry_sdk  # type: ignore[import-not-found]
    except Exception:
        logging.getLogger(__name__).warning("sentry.unavailable")
        _SENTRY_ENABLED = False
        return
    sentry_sdk.init(dsn=settings.sentry_dsn, environment=settings.env)
    _SENTRY_ENABLED = True


def capture_exception(exc: BaseException) -> None:
    if not _SENTRY_ENABLED:
        return
    try:
        import sentry_sdk  # type: ignore[import-not-found]
    except Exception:
        return
    sentry_sdk.capture_exception(exc)
