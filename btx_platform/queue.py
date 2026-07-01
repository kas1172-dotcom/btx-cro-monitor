"""Job queue abstraction.

The ingest path depends only on the ``JobQueue`` protocol, so the receiver is
testable with an in-memory queue and production swaps in the Celery/Redis
implementation without touching the route. (Celery wiring lands in Phase 2.)
"""
from __future__ import annotations

from typing import Protocol


class JobQueue(Protocol):
    def enqueue_forward(self, event_id: str) -> None:
        """Schedule background forwarding of a stored event to its destination."""
        ...


class InMemoryQueue:
    """Test/dev queue: records enqueued event ids, runs nothing."""

    def __init__(self) -> None:
        self.jobs: list[str] = []

    def enqueue_forward(self, event_id: str) -> None:
        self.jobs.append(event_id)


class CeleryQueue:
    """Production queue backed by Celery. Imported lazily so the API process does
    not require Celery to be installed for Phase 1. Wired up in Phase 2."""

    def __init__(self, celery_app: object) -> None:
        self._app = celery_app

    def enqueue_forward(self, event_id: str) -> None:  # pragma: no cover - Phase 2
        self._app.send_task("btx_platform.workers.forward.forward_event", args=[event_id])
