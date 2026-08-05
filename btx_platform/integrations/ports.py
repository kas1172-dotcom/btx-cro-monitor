"""Domain-owned ports for optional external systems."""
from __future__ import annotations

from datetime import datetime
from typing import Protocol, Sequence, runtime_checkable

from btx_platform.integrations.models import (
    AccountIntelligence,
    ApprovedWorkItemExecution,
    CanonicalContact,
    CanonicalOrder,
    CanonicalQuote,
    CapacitySnapshot,
    ExternalReference,
    RequestContext,
)


@runtime_checkable
class ContactRegistryPort(Protocol):
    def find_contacts(self, *, account_id: str, context: RequestContext) -> list[CanonicalContact]:
        """Return validated, deduplicated contacts for one tenant-scoped BTX account.

        Disabled or unavailable registries return an empty list.
        """


@runtime_checkable
class AccountIntelligencePort(Protocol):
    def get_account_intelligence(
        self, *, account_id: str, context: RequestContext, as_of: datetime | None = None
    ) -> AccountIntelligence:
        """Return provenance-preserving observations for one canonical account.

        The port must not promote unconfirmed relationships to confirmed facts.
        Disabled or unavailable sources return an empty intelligence document.
        """


@runtime_checkable
class QuotePublisherPort(Protocol):
    def create_quote(
        self, *, quote: CanonicalQuote, execution: ApprovedWorkItemExecution
    ) -> ExternalReference:
        """Create or record one quote idempotently under approved work-item execution.

        Repeating an idempotency key must return the same reference without a
        second write.
        """


@runtime_checkable
class OperationsPort(Protocol):
    def get_capacity(
        self,
        *,
        context: RequestContext,
        as_of: datetime | None = None,
        facility_ids: Sequence[str] = (),
    ) -> CapacitySnapshot:
        """Return a point-in-time capacity view without fabricating missing availability."""

    def create_order(
        self, *, order: CanonicalOrder, execution: ApprovedWorkItemExecution
    ) -> ExternalReference:
        """Create or record one order idempotently under approved work-item execution.

        Repeating an idempotency key must return the same reference without a
        second write.
        """
