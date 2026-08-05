# Integration Seams

The cockpit owns the contracts in this document. Core/application code uses
canonical BTX models and ports only. Vendor names, endpoints, payloads, and
authentication details remain inside future adapters.

All feature flags default to `false`. Disabled systems resolve to safe in-memory
stubs and make no network calls. Clerk continues to authenticate every request;
adapters receive tenant and actor context, never a Clerk token.

## Shared rules

- Canonical schemas are Pydantic v2 models with `schema_version="1.0"` and
  unknown fields forbidden.
- The registry is `btx_platform/integrations/registry.py`. Core code obtains
  ports from it and never constructs adapters directly.
- Quote and order writes require `ApprovedWorkItemExecution`, which the example
  flows issue only for an approved, tenant-owned work item. Started, succeeded,
  and failed attempts update work-item execution state and audit history.
- Adapter idempotency keys are derived from the work item. A retry must not
  create a second external record.
- `BTX_EXTERNAL_WRITES_ENABLED` is an additional global gate for real writes.
- Secrets are backend-only Fly.io secrets and GitHub Actions secrets. Never use
  `VITE_*`, committed `.env` values, logs, canonical payloads, or audit metadata.

## Market Mapping / contact registry

| Contract | Location/value |
|---|---|
| Port | `ContactRegistryPort.find_contacts` in `btx_platform/integrations/ports.py` |
| Canonical model | `CanonicalContact` in `btx_platform/integrations/models.py` |
| Stub | `StubContactRegistryAdapter` in `btx_platform/integrations/stubs.py` |
| Flag | `BTX_CONTACT_REGISTRY_ENABLED` |
| Config | `BTX_CONTACT_REGISTRY_BASE_URL`, `BTX_CONTACT_REGISTRY_AUTH_SECRET`, `BTX_CONTACT_REGISTRY_AUTH_SCOPES`, `BTX_CONTACT_REGISTRY_TIMEOUT_SECONDS` |
| Example flow | `enrich_account` in `btx_platform/integrations/flows.py` |

Exact endpoint, credential format, scopes, pagination, and vendor response
shape are **BLOCKED-ON-SPEC**.

When the spec arrives:

1. Implement `RealContactRegistryAdapter(ContactRegistryPort)` in its own module.
2. Implement vendor-to-`CanonicalContact` mapping at the marked translation boundary.
3. Configure the base URL, timeout, and documented read-only scopes.
4. Store `BTX_CONTACT_REGISTRY_AUTH_SECRET` in Fly.io/GitHub Actions.
5. Register its factory in `RealAdapterFactories.contact_registry`.
6. Run `assert_contact_registry_contract` against the real sandbox adapter.
7. Set `BTX_CONTACT_REGISTRY_ENABLED=true` for the intended environment.

## PRISM

| Contract | Location/value |
|---|---|
| Port | `AccountIntelligencePort.get_account_intelligence` |
| Canonical models | `AccountIntelligence`, `RelationshipObservation`, `IntelligenceObservation` |
| Stub | `StubAccountIntelligenceAdapter` |
| Flag | `BTX_PRISM_ENABLED` |
| Config | `BTX_PRISM_BASE_URL`, `BTX_PRISM_AUTH_SECRET`, `BTX_PRISM_AUTH_SCOPES`, `BTX_PRISM_TIMEOUT_SECONDS` |
| Example flow | `attach_account_intelligence` |

Exact endpoint, credential format, scopes, provenance fields, and relationship
shape are **BLOCKED-ON-SPEC**.

When the spec arrives:

1. Implement `RealPrismAdapter(AccountIntelligencePort)` in its own module.
2. Map PRISM records to canonical observations at the marked translation boundary.
3. Preserve provenance and keep returned relationships unconfirmed until existing review logic confirms them.
4. Configure the base URL, timeout, and least-privilege read scopes.
5. Store `BTX_PRISM_AUTH_SECRET` in Fly.io/GitHub Actions.
6. Register `RealAdapterFactories.account_intelligence`.
7. Run `assert_intelligence_contract` against the sandbox adapter.
8. Set `BTX_PRISM_ENABLED=true` independently.

## Paperless Parts

| Contract | Location/value |
|---|---|
| Port | `QuotePublisherPort.create_quote` |
| Canonical models | `CanonicalQuote`, `QuoteLine` |
| Stub | `StubQuotePublisherAdapter` |
| Flag | `BTX_PAPERLESS_PARTS_ENABLED` |
| Config | `BTX_PAPERLESS_PARTS_BASE_URL`, `BTX_PAPERLESS_PARTS_AUTH_SECRET`, `BTX_PAPERLESS_PARTS_AUTH_SCOPES`, `BTX_PAPERLESS_PARTS_TIMEOUT_SECONDS` |
| Example flow | `create_quote_from_work_item` |

Exact endpoints, credential format, scopes, request fields, response fields,
and read-back verification semantics are **BLOCKED-ON-SPEC**.

When the spec arrives:

1. Implement `RealPaperlessPartsAdapter(QuotePublisherPort)`.
2. Map `CanonicalQuote` to the vendor request only at the marked translation boundary.
3. Implement destination idempotency and minimum read-back verification.
4. Configure base URL, timeout, quote-create scope, and verification-read scope.
5. Store `BTX_PAPERLESS_PARTS_AUTH_SECRET` in Fly.io/GitHub Actions.
6. Register `RealAdapterFactories.quote_publisher`.
7. Run `assert_quote_publisher_contract` plus sandbox lifecycle/audit tests.
8. Set `BTX_EXTERNAL_WRITES_ENABLED=true` and then `BTX_PAPERLESS_PARTS_ENABLED=true` only in the approved environment.

## ERP/MES

| Contract | Location/value |
|---|---|
| Port | `OperationsPort.get_capacity` and `OperationsPort.create_order` |
| Canonical models | `CapacitySnapshot`, `CapacityWindow`, `CanonicalOrder`, `OrderLine` |
| Stub | `StubOperationsAdapter` |
| Flag | `BTX_ERP_MES_ENABLED` |
| Config | `BTX_ERP_MES_BASE_URL`, `BTX_ERP_MES_AUTH_SECRET`, `BTX_ERP_MES_AUTH_SCOPES`, `BTX_ERP_MES_TIMEOUT_SECONDS` |
| Example flows | `read_capacity`, `create_order_from_work_item` |

Exact endpoints, credential format, scopes, units, capacity semantics, order
shape, and verification semantics are **BLOCKED-ON-SPEC**. An empty capacity
snapshot means no data; it never means zero capacity.

When the spec arrives:

1. Implement `RealOperationsAdapter(OperationsPort)`.
2. Map vendor capacity to `CapacitySnapshot` and `CanonicalOrder` to the vendor order request at the marked boundaries.
3. Normalize vendor units explicitly and preserve source timestamps/references.
4. Implement order idempotency and minimum read-back verification.
5. Configure base URL, timeout, capacity-read, order-create, and order-read scopes.
6. Store `BTX_ERP_MES_AUTH_SECRET` in Fly.io/GitHub Actions.
7. Register `RealAdapterFactories.operations`.
8. Run `assert_operations_contract` plus sandbox lifecycle/audit tests.
9. Set `BTX_EXTERNAL_WRITES_ENABLED=true` if order writes are allowed, then set `BTX_ERP_MES_ENABLED=true`.
