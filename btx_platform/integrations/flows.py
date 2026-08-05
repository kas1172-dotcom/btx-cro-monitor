"""Example application flows proving core code depends only on integration ports."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Sequence

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
from btx_platform.integrations.registry import AdapterRegistry


class WorkItemExecutionError(ValueError):
    pass


def enrich_account(registry: AdapterRegistry, *, account_id: str, context: RequestContext) -> list[CanonicalContact]:
    return registry.contact_registry().find_contacts(account_id=account_id, context=context)


def attach_account_intelligence(
    registry: AdapterRegistry, *, account_id: str, context: RequestContext, as_of: datetime | None = None
) -> AccountIntelligence:
    return registry.account_intelligence().get_account_intelligence(
        account_id=account_id, context=context, as_of=as_of
    )


def read_capacity(
    registry: AdapterRegistry,
    *,
    context: RequestContext,
    as_of: datetime | None = None,
    facility_ids: Sequence[str] = (),
) -> CapacitySnapshot:
    return registry.operations().get_capacity(context=context, as_of=as_of, facility_ids=facility_ids)


def create_quote_from_work_item(
    registry: AdapterRegistry,
    *,
    quote: CanonicalQuote,
    work_item: Any,
    context: RequestContext,
    idempotency_key: str,
) -> ExternalReference:
    execution = _begin_execution(work_item, context, idempotency_key, expected_system="paperless_parts")
    try:
        reference = registry.quote_publisher().create_quote(quote=quote, execution=execution)
    except Exception as exc:
        _fail_execution(work_item, context, exc)
        raise
    _complete_execution(work_item, context, reference)
    return reference


def create_order_from_work_item(
    registry: AdapterRegistry,
    *,
    order: CanonicalOrder,
    work_item: Any,
    context: RequestContext,
    idempotency_key: str,
) -> ExternalReference:
    execution = _begin_execution(work_item, context, idempotency_key, expected_system="erp_mes")
    try:
        reference = registry.operations().create_order(order=order, execution=execution)
    except Exception as exc:
        _fail_execution(work_item, context, exc)
        raise
    _complete_execution(work_item, context, reference)
    return reference


def _begin_execution(
    work_item: Any, context: RequestContext, idempotency_key: str, *, expected_system: str
) -> ApprovedWorkItemExecution:
    if work_item.tenant_id != context.tenant_id:
        raise WorkItemExecutionError("work item does not belong to the authenticated tenant")
    if work_item.approval_state != "approved" or work_item.status not in {"approved", "in_progress"}:
        raise WorkItemExecutionError("external writes require an approved work item")
    if work_item.external_system not in {None, expected_system}:
        raise WorkItemExecutionError(f"work item targets {work_item.external_system}, not {expected_system}")
    if work_item.external_record_id:
        if work_item.execution_idempotency_key == idempotency_key:
            return ApprovedWorkItemExecution(
                tenant_id=context.tenant_id,
                actor_user_id=context.actor_user_id,
                work_item_id=work_item.id,
                idempotency_key=idempotency_key,
            )
        raise WorkItemExecutionError("work item already has an external record")
    before = _work_snapshot(work_item)
    work_item.status = "in_progress"
    work_item.execution_state = "pending"
    work_item.external_system = expected_system
    work_item.execution_idempotency_key = idempotency_key
    work_item.execution_error = None
    work_item.updated_at = datetime.now(UTC)
    _audit(work_item, context, "integration_execution_started", before, _work_snapshot(work_item))
    return ApprovedWorkItemExecution(
        tenant_id=context.tenant_id,
        actor_user_id=context.actor_user_id,
        work_item_id=work_item.id,
        idempotency_key=idempotency_key,
    )


def _complete_execution(work_item: Any, context: RequestContext, reference: ExternalReference) -> None:
    before = _work_snapshot(work_item)
    work_item.status = "executed"
    work_item.execution_state = "executed"
    work_item.external_record_id = reference.reference_id
    work_item.execution_error = None
    work_item.updated_at = datetime.now(UTC)
    _audit(
        work_item,
        context,
        "integration_execution_succeeded",
        before,
        _work_snapshot(work_item),
        metadata={"system": reference.system, "reference_id": reference.reference_id},
    )


def _fail_execution(work_item: Any, context: RequestContext, exc: Exception) -> None:
    before = _work_snapshot(work_item)
    work_item.execution_state = "failed"
    work_item.execution_error = str(exc)
    work_item.updated_at = datetime.now(UTC)
    _audit(work_item, context, "integration_execution_failed", before, _work_snapshot(work_item))


def _work_snapshot(work_item: Any) -> dict[str, Any]:
    return {
        "status": work_item.status,
        "approval_state": work_item.approval_state,
        "execution_state": work_item.execution_state,
        "external_system": work_item.external_system,
        "external_record_id": work_item.external_record_id,
        "execution_idempotency_key": work_item.execution_idempotency_key,
        "execution_error": work_item.execution_error,
    }


def _audit(
    work_item: Any,
    context: RequestContext,
    action: str,
    before: dict[str, Any],
    after: dict[str, Any],
    *,
    metadata: dict[str, Any] | None = None,
) -> None:
    history = list(work_item.audit_history or [])
    history.append({
        "timestamp": datetime.now(UTC).isoformat(),
        "actor": context.actor_user_id,
        "actor_type": "user",
        "action": action,
        "event_type": action,
        "from_state": before["status"],
        "to_state": after["status"],
        "metadata": metadata or {},
        "before": before,
        "after": after,
    })
    work_item.audit_history = history
