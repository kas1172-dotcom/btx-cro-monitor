"""Per-user sliding-window rate limiting for mutating routes.

In-memory and single-process: correct for the current one-instance deploy.
The Redis broker landing in WP10-B is the natural home for a shared counter
if the backend ever runs multiple instances; the ``RateLimiter`` interface
below is small enough to swap without touching call sites.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self, *, max_requests: int, window_seconds: float) -> None:
        self._max_requests = max_requests
        self._window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, *, now: float | None = None) -> bool:
        now = now if now is not None else time.monotonic()
        bucket = self._hits[key]
        cutoff = now - self._window_seconds
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= self._max_requests:
            return False
        bucket.append(now)
        return True
