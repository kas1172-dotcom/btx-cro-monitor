"""Safe in-memory adapters used while real integration specifications are absent."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Sequence

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


class StubContactRegistryAdapter:
    def __init__(self, contacts: Sequence[CanonicalContact] = ()):
        self._contacts = list(contacts)

    def find_contacts(self, *, account_id: str, context: RequestContext) -> list[CanonicalContact]:
        return [contact for contact in self._contacts if contact.account_id == account_id]


class StubAccountIntelligenceAdapter:
    def __init__(self, documents: Sequence[AccountIntelligence] = ()):
        self._documents = {document.account_id: document for document in documents}

    def get_account_intelligence(
        self, *, account_id: str, context: RequestContext, as_of: datetime | None = None
    ) -> AccountIntelligence:
        return self._documents.get(account_id) or AccountIntelligence(
            account_id=account_id,
            retrieved_at=as_of or datetime.now(UTC),
        )


class StubQuotePublisherAdapter:
    def __init__(self) -> None:
        self.recorded: dict[str, tuple[CanonicalQuote, ExternalReference]] = {}

    def create_quote(
        self, *, quote: CanonicalQuote, execution: ApprovedWorkItemExecution
    ) -> ExternalReference:
        existing = self.recorded.get(execution.idempotency_key)
        if existing is not None:
            return existing[1]
        reference = ExternalReference(
            system="paperless_parts",
            reference_id=f"stub-quote-{quote.quote_id}",
            idempotency_key=execution.idempotency_key,
            status="recorded",
        )
        self.recorded[execution.idempotency_key] = (quote, reference)
        return reference


class StubOperationsAdapter:
    def __init__(self, snapshots: Sequence[CapacitySnapshot] = ()) -> None:
        self._snapshots = list(snapshots)
        self.recorded_orders: dict[str, tuple[CanonicalOrder, ExternalReference]] = {}

    def get_capacity(
        self,
        *,
        context: RequestContext,
        as_of: datetime | None = None,
        facility_ids: Sequence[str] = (),
    ) -> CapacitySnapshot:
        if self._snapshots:
            snapshot = self._snapshots[-1]
            if facility_ids:
                selected = set(facility_ids)
                return snapshot.model_copy(
                    update={"windows": [window for window in snapshot.windows if window.facility_id in selected]}
                )
            return snapshot
        return CapacitySnapshot(
            snapshot_id="stub-empty-capacity",
            observed_at=as_of or datetime.now(UTC),
        )

    def create_order(
        self, *, order: CanonicalOrder, execution: ApprovedWorkItemExecution
    ) -> ExternalReference:
        existing = self.recorded_orders.get(execution.idempotency_key)
        if existing is not None:
            return existing[1]
        reference = ExternalReference(
            system="erp_mes",
            reference_id=f"stub-order-{order.order_id}",
            idempotency_key=execution.idempotency_key,
            status="recorded",
        )
        self.recorded_orders[execution.idempotency_key] = (order, reference)
        return reference


# Real adapters will own these translations; stubs deliberately never call them.
def _contact_vendor_to_canonical(payload: object) -> CanonicalContact:
    # TODO(BLOCKED-ON-SPEC): map the contact registry response to CanonicalContact.
    raise NotImplementedError("BLOCKED-ON-SPEC: contact registry response shape")


def _prism_vendor_to_canonical(payload: object) -> AccountIntelligence:
    # TODO(BLOCKED-ON-SPEC): map PRISM intelligence to AccountIntelligence.
    raise NotImplementedError("BLOCKED-ON-SPEC: PRISM response shape")


def _quote_canonical_to_vendor(quote: CanonicalQuote) -> object:
    # TODO(BLOCKED-ON-SPEC): map CanonicalQuote to the Paperless Parts request.
    raise NotImplementedError("BLOCKED-ON-SPEC: Paperless Parts request shape")


def _capacity_vendor_to_canonical(payload: object) -> CapacitySnapshot:
    # TODO(BLOCKED-ON-SPEC): map ERP/MES capacity data to CapacitySnapshot.
    raise NotImplementedError("BLOCKED-ON-SPEC: ERP/MES capacity response shape")


def _order_canonical_to_vendor(order: CanonicalOrder) -> object:
    # TODO(BLOCKED-ON-SPEC): map CanonicalOrder to the ERP/MES request.
    raise NotImplementedError("BLOCKED-ON-SPEC: ERP/MES order request shape")
