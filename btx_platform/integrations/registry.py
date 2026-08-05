"""Independent feature-flag resolution for optional integration adapters."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Sequence

from btx_platform.config import Settings
from btx_platform.integrations.ports import (
    AccountIntelligencePort,
    ContactRegistryPort,
    OperationsPort,
    QuotePublisherPort,
)
from btx_platform.integrations.models import (
    ApprovedWorkItemExecution,
    CanonicalOrder,
    CapacitySnapshot,
    ExternalReference,
    RequestContext,
)
from btx_platform.integrations.stubs import (
    StubAccountIntelligenceAdapter,
    StubContactRegistryAdapter,
    StubOperationsAdapter,
    StubQuotePublisherAdapter,
)


class IntegrationConfigurationError(RuntimeError):
    """A feature was enabled before its real adapter/configuration was ready."""


@dataclass(frozen=True)
class RealAdapterFactories:
    contact_registry: Callable[[Settings], ContactRegistryPort] | None = None
    account_intelligence: Callable[[Settings], AccountIntelligencePort] | None = None
    quote_publisher: Callable[[Settings], QuotePublisherPort] | None = None
    operations: Callable[[Settings], OperationsPort] | None = None


@dataclass(frozen=True)
class AdapterRegistry:
    _contact_registry: ContactRegistryPort
    _account_intelligence: AccountIntelligencePort
    _quote_publisher: QuotePublisherPort
    _operations: OperationsPort

    def contact_registry(self) -> ContactRegistryPort:
        return self._contact_registry

    def account_intelligence(self) -> AccountIntelligencePort:
        return self._account_intelligence

    def quote_publisher(self) -> QuotePublisherPort:
        return self._quote_publisher

    def operations(self) -> OperationsPort:
        return self._operations


def build_adapter_registry(
    settings: Settings,
    *,
    real: RealAdapterFactories | None = None,
    stubs: AdapterRegistry | None = None,
) -> AdapterRegistry:
    """Resolve each port independently; disabled integrations always use stubs."""
    factories = real or RealAdapterFactories()
    safe = stubs or AdapterRegistry(
        StubContactRegistryAdapter(),
        StubAccountIntelligenceAdapter(),
        StubQuotePublisherAdapter(),
        StubOperationsAdapter(),
    )
    return AdapterRegistry(
        _resolve("contact registry", settings.contact_registry_enabled, factories.contact_registry, settings, safe.contact_registry()),
        _resolve("PRISM", settings.prism_enabled, factories.account_intelligence, settings, safe.account_intelligence()),
        _resolve_write("Paperless Parts", settings.paperless_parts_enabled, factories.quote_publisher, settings, safe.quote_publisher()),
        _resolve_operations(settings, factories.operations, safe.operations()),
    )


def _resolve(name: str, enabled: bool, factory: Callable[[Settings], object] | None, settings: Settings, stub: object):
    if not enabled:
        return stub
    if factory is None:
        raise IntegrationConfigurationError(f"{name} is enabled but its real adapter is not installed")
    return factory(settings)


def _resolve_write(name: str, enabled: bool, factory: Callable[[Settings], object] | None, settings: Settings, stub: object):
    if enabled and not settings.external_writes_enabled:
        raise IntegrationConfigurationError(f"{name} requires BTX_EXTERNAL_WRITES_ENABLED=true")
    return _resolve(name, enabled, factory, settings, stub)


def _resolve_operations(settings: Settings, factory: Callable[[Settings], object] | None, stub: object):
    if not settings.erp_mes_enabled:
        return stub
    if factory is None:
        raise IntegrationConfigurationError("ERP/MES is enabled but its real adapter is not installed")
    adapter = factory(settings)
    return _WriteGatedOperations(adapter, writes_enabled=settings.external_writes_enabled)


class _WriteGatedOperations:
    """Allow capacity reads while retaining the global gate on real order writes."""

    def __init__(self, adapter: OperationsPort, *, writes_enabled: bool):
        self._adapter = adapter
        self._writes_enabled = writes_enabled

    def get_capacity(
        self,
        *,
        context: RequestContext,
        as_of: datetime | None = None,
        facility_ids: Sequence[str] = (),
    ) -> CapacitySnapshot:
        return self._adapter.get_capacity(context=context, as_of=as_of, facility_ids=facility_ids)

    def create_order(
        self, *, order: CanonicalOrder, execution: ApprovedWorkItemExecution
    ) -> ExternalReference:
        if not self._writes_enabled:
            raise IntegrationConfigurationError("ERP/MES order writes require BTX_EXTERNAL_WRITES_ENABLED=true")
        return self._adapter.create_order(order=order, execution=execution)
