"""BTX Engine — Integration platform (backend service).

The reliable data-integration backend for the BTX Revenue Cockpit. Kept in
its own package so the static `monitor_engine` stays backend-free; this layer is
the deployment service that adds webhooks, a queue, a database, and (later) the
news→strategy→email delivery loop.

Phase 1 (this slice): a hardened webhook receiver — HMAC signature verification,
strict Pydantic validation, idempotent raw-payload persistence, enqueue, and a
fast 200. Forwarding/retries/DLQ are Phase 2.
"""
__all__ = ["__version__"]
__version__ = "0.1.0"
