"""Port contract suites. Future real adapters must run these same assertions."""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from btx_platform.config import Settings
from btx_platform.integrations.flows import (
    WorkItemExecutionError,
    attach_account_intelligence,
    create_order_from_work_item,
    create_quote_from_work_item,
    enrich_account,
    read_capacity,
)
from btx_platform.integrations.models import (
    AccountIntelligence,
    CanonicalContact,
    CanonicalOrder,
    CanonicalQuote,
    CapacitySnapshot,
    CapacityWindow,
    IntelligenceObservation,
    OrderLine,
    QuoteLine,
    RelationshipObservation,
    RequestContext,
)
from btx_platform.integrations.ports import (
    AccountIntelligencePort,
    ContactRegistryPort,
    OperationsPort,
    QuotePublisherPort,
)
from btx_platform.integrations.registry import (
    AdapterRegistry,
    IntegrationConfigurationError,
    RealAdapterFactories,
    build_adapter_registry,
)
from btx_platform.integrations.stubs import (
    StubAccountIntelligenceAdapter,
    StubContactRegistryAdapter,
    StubOperationsAdapter,
    StubQuotePublisherAdapter,
)

NOW = datetime(2026, 8, 5, 12, tzinfo=UTC)
CONTEXT = RequestContext(tenant_id="tenant-a", actor_user_id="user-a", correlation_id="request-a")


def _contact() -> CanonicalContact:
    return CanonicalContact(
        contact_id="contact-a",
        account_id="account-a",
        full_name="Alex Buyer",
        job_title="Director",
        email="ALEX@EXAMPLE.COM",
        observed_at=NOW,
        confidence=0.9,
    )


def _intelligence() -> AccountIntelligence:
    return AccountIntelligence(
        account_id="account-a",
        relationships=[RelationshipObservation(
            subject="account-a",
            relationship="supplies",
            object="program-a",
            classification="unconfirmed_relationship",
            confidence=0.7,
            evidence_refs=["evidence-a"],
        )],
        observations=[IntelligenceObservation(
            observation_id="intel-a",
            title="Program activity",
            summary="Activity requires review.",
            classification="inference",
            confidence=0.6,
        )],
        retrieved_at=NOW,
    )


def _quote() -> CanonicalQuote:
    return CanonicalQuote(
        quote_id="quote-a",
        account_id="account-a",
        currency="USD",
        lines=[QuoteLine(
            line_id="line-a",
            description="Precision component",
            quantity=Decimal("2"),
            unit_of_measure="each",
            unit_price=Decimal("125.00"),
        )],
        valid_until=date(2026, 9, 5),
        created_at=NOW,
    )


def _order() -> CanonicalOrder:
    return CanonicalOrder(
        order_id="order-a",
        account_id="account-a",
        lines=[OrderLine(
            line_id="line-a",
            description="Precision component",
            quantity=Decimal("2"),
            unit_of_measure="each",
            required_by=date(2026, 9, 5),
        )],
        requested_at=NOW,
    )


def _capacity() -> CapacitySnapshot:
    return CapacitySnapshot(
        snapshot_id="capacity-a",
        observed_at=NOW,
        windows=[CapacityWindow(
            facility_id="facility-a",
            capability="precision machining",
            starts_on=date(2026, 8, 5),
            ends_on=date(2026, 8, 12),
            available_quantity=Decimal("16"),
            unit_of_measure="hours",
            status="available",
        )],
    )


def _approved_work_item(system: str | None = None):
    return SimpleNamespace(
        id="work-a",
        tenant_id="tenant-a",
        status="approved",
        approval_state="approved",
        execution_state="not_started",
        external_system=system,
        external_record_id=None,
        execution_idempotency_key=None,
        execution_error=None,
        audit_history=[],
        updated_at=NOW,
    )


def assert_contact_registry_contract(port: ContactRegistryPort) -> None:
    assert isinstance(port, ContactRegistryPort)
    result = port.find_contacts(account_id="account-a", context=CONTEXT)
    assert all(isinstance(contact, CanonicalContact) for contact in result)
    assert all(contact.account_id == "account-a" for contact in result)


def assert_intelligence_contract(port: AccountIntelligencePort) -> None:
    assert isinstance(port, AccountIntelligencePort)
    result = port.get_account_intelligence(account_id="account-a", context=CONTEXT, as_of=NOW)
    assert isinstance(result, AccountIntelligence)
    assert result.account_id == "account-a"


def assert_quote_publisher_contract(port: QuotePublisherPort) -> None:
    assert isinstance(port, QuotePublisherPort)
    from btx_platform.integrations.models import ApprovedWorkItemExecution
    execution = ApprovedWorkItemExecution(
        tenant_id="tenant-a", actor_user_id="user-a", work_item_id="work-a", idempotency_key="idem-a"
    )
    first = port.create_quote(quote=_quote(), execution=execution)
    second = port.create_quote(quote=_quote(), execution=execution)
    assert first == second
    assert first.idempotency_key == "idem-a"


def assert_operations_contract(port: OperationsPort) -> None:
    assert isinstance(port, OperationsPort)
    snapshot = port.get_capacity(context=CONTEXT, as_of=NOW)
    assert isinstance(snapshot, CapacitySnapshot)
    from btx_platform.integrations.models import ApprovedWorkItemExecution
    execution = ApprovedWorkItemExecution(
        tenant_id="tenant-a", actor_user_id="user-a", work_item_id="work-a", idempotency_key="idem-a"
    )
    first = port.create_order(order=_order(), execution=execution)
    second = port.create_order(order=_order(), execution=execution)
    assert first == second


def test_stub_adapters_pass_port_contracts():
    assert_contact_registry_contract(StubContactRegistryAdapter([_contact()]))
    assert_intelligence_contract(StubAccountIntelligenceAdapter([_intelligence()]))
    assert_quote_publisher_contract(StubQuotePublisherAdapter())
    assert_operations_contract(StubOperationsAdapter([_capacity()]))


def test_registry_defaults_every_port_to_safe_stub():
    registry = build_adapter_registry(Settings(env="test"))
    assert isinstance(registry.contact_registry(), StubContactRegistryAdapter)
    assert isinstance(registry.account_intelligence(), StubAccountIntelligenceAdapter)
    assert isinstance(registry.quote_publisher(), StubQuotePublisherAdapter)
    assert isinstance(registry.operations(), StubOperationsAdapter)


def test_enabled_port_requires_only_its_own_real_adapter():
    contact = StubContactRegistryAdapter([_contact()])
    registry = build_adapter_registry(
        Settings(env="test", contact_registry_enabled=True),
        real=RealAdapterFactories(contact_registry=lambda _settings: contact),
    )
    assert registry.contact_registry() is contact
    assert isinstance(registry.account_intelligence(), StubAccountIntelligenceAdapter)
    with pytest.raises(IntegrationConfigurationError, match="PRISM"):
        build_adapter_registry(Settings(env="test", prism_enabled=True))


def test_write_port_cannot_be_enabled_while_global_writes_are_off():
    with pytest.raises(IntegrationConfigurationError, match="BTX_EXTERNAL_WRITES_ENABLED"):
        build_adapter_registry(
            Settings(env="test", paperless_parts_enabled=True),
            real=RealAdapterFactories(quote_publisher=lambda _settings: StubQuotePublisherAdapter()),
        )


def test_erp_capacity_can_be_enabled_while_order_write_remains_globally_gated():
    operations = StubOperationsAdapter([_capacity()])
    registry = build_adapter_registry(
        Settings(env="test", erp_mes_enabled=True),
        real=RealAdapterFactories(operations=lambda _settings: operations),
    )
    assert registry.operations().get_capacity(context=CONTEXT).windows
    work_item = _approved_work_item("erp_mes")
    with pytest.raises(IntegrationConfigurationError, match="BTX_EXTERNAL_WRITES_ENABLED"):
        create_order_from_work_item(
            registry, order=_order(), work_item=work_item, context=CONTEXT, idempotency_key="order-idem"
        )
    assert work_item.execution_state == "failed"


def test_example_read_flows_run_through_ports():
    registry = AdapterRegistry(
        StubContactRegistryAdapter([_contact()]),
        StubAccountIntelligenceAdapter([_intelligence()]),
        StubQuotePublisherAdapter(),
        StubOperationsAdapter([_capacity()]),
    )
    assert enrich_account(registry, account_id="account-a", context=CONTEXT)[0].email == "alex@example.com"
    assert attach_account_intelligence(registry, account_id="account-a", context=CONTEXT).observations
    assert read_capacity(registry, context=CONTEXT).windows[0].facility_id == "facility-a"


def test_example_write_flows_require_work_item_and_append_audit():
    registry = build_adapter_registry(Settings(env="test"))
    quote_work = _approved_work_item("paperless_parts")
    quote_ref = create_quote_from_work_item(
        registry, quote=_quote(), work_item=quote_work, context=CONTEXT, idempotency_key="quote-idem"
    )
    assert quote_ref.status == "recorded"
    assert quote_work.status == "executed"
    assert [entry["action"] for entry in quote_work.audit_history] == [
        "integration_execution_started", "integration_execution_succeeded"
    ]

    order_work = _approved_work_item("erp_mes")
    order_ref = create_order_from_work_item(
        registry, order=_order(), work_item=order_work, context=CONTEXT, idempotency_key="order-idem"
    )
    assert order_ref.status == "recorded"
    assert order_work.external_record_id == "stub-order-order-a"


def test_write_flow_rejects_unapproved_or_cross_tenant_work():
    registry = build_adapter_registry(Settings(env="test"))
    unapproved = _approved_work_item()
    unapproved.approval_state = "pending"
    with pytest.raises(WorkItemExecutionError, match="approved"):
        create_quote_from_work_item(
            registry, quote=_quote(), work_item=unapproved, context=CONTEXT, idempotency_key="idem"
        )
    cross_tenant = _approved_work_item()
    cross_tenant.tenant_id = "tenant-b"
    with pytest.raises(WorkItemExecutionError, match="authenticated tenant"):
        create_order_from_work_item(
            registry, order=_order(), work_item=cross_tenant, context=CONTEXT, idempotency_key="idem"
        )


def test_canonical_models_reject_unknown_fields_and_invalid_dates():
    with pytest.raises(ValidationError, match="Extra inputs"):
        CanonicalContact(**{**_contact().model_dump(), "vendor_field": "no"})
    with pytest.raises(ValidationError, match="valid_until"):
        CanonicalQuote(**{**_quote().model_dump(), "valid_until": date(2026, 8, 4)})
    with pytest.raises(ValidationError, match="required_by"):
        CanonicalOrder(**{
            **_order().model_dump(),
            "lines": [{**_order().lines[0].model_dump(), "required_by": date(2026, 8, 4)}],
        })
    with pytest.raises(ValidationError, match="timezone-aware"):
        CapacitySnapshot(snapshot_id="bad", observed_at=datetime(2026, 8, 5))
