# BTX Enterprise Brain Architecture

This repository supports the BTX Revenue Cockpit demo through three related systems:

1. `monitor_engine/` and `clients/btx/` — a Python-based static intelligence layer that can collect, normalize, score, and generate static artifacts from public, configured, or agent-assisted sources.
2. `frontend/` — a React/Vite executive dashboard that presents account health, signals, pipeline context, recommendations, map-based prospecting, and guided selling workflows to a CRO.
3. `btx_platform/` — an early FastAPI backend intended for future authenticated integrations, persistence, background jobs, queues, webhooks, and user-specific state.

The current product posture is intentionally static-first. The demo should show a realistic operating model without requiring paid infrastructure, live customer credentials, or a production backend before the workflow is validated with the user.

The core architectural principle is that the dashboard should consume a stable data adapter contract. Static demo data, monitor-generated artifacts, and future live API integrations should all populate that contract rather than forcing the frontend to depend directly on a specific data source.

---

## System Responsibilities

### Python Monitor

The Python monitor is the intelligence and artifact-generation layer.

It is responsible for:

* ingesting public or configured sources
* normalizing source data
* generating static intelligence artifacts
* scoring relevance where appropriate
* preserving source provenance
* producing JSON artifacts that can be consumed by the frontend

For the BTX demo, this layer may include BTX-specific client configuration under `clients/btx/`.

### React Frontend

The frontend is the executive decision interface.

It is responsible for:

* rendering the CRO dashboard
* presenting current-business and prospecting workflows
* displaying account, signal, pipeline, capacity, map, and recommendation views
* managing UI state and user interaction
* providing ChatPill with the active page, account, prospect, region, ranking, or signal context
* consuming data only through the shared data adapter interface

The frontend should not be tightly coupled to whether data came from demo snapshots, monitor artifacts, or live API integrations.

### FastAPI Backend

The FastAPI backend is reserved for the future live product.

It is intended to support:

* authenticated customer integrations
* API ingestion from CRM, ERP, production, contract, email, calendar, procurement, and market-intelligence systems
* persistence
* background jobs
* queues
* webhooks
* user-specific state
* durable workflow history

The backend should eventually populate the same core adapter contract used by the static demo. This allows the frontend and primary scoring/presentation flows to remain stable while the data implementation evolves.

---

## Intended Future Architecture

In production, the system can evolve toward the following model:

```text
External APIs / internal customer systems / public sources
        ↓
FastAPI integration backend and/or Python monitor
        ↓
Normalized adapter contract
        ↓
Validation, scoring, recommendations, and provenance
        ↓
React executive dashboard
```

Potential live sources may include:

* Salesforce
* HubSpot
* ERP or capacity systems
* contract systems
* production systems
* customer/order data
* email/calendar/call-note sources
* SAM.gov
* public news
* market and company intelligence APIs

The goal is for the scoring engine and primary UI flows to keep using the shared contract while the adapter implementation changes from static demo data to monitor artifacts or live integrations.

---

## Static Demo Data Flow

The demo currently uses static snapshots to simulate a realistic operating model:

```text
External/public data + simulated internal data
        ↓
Demo data snapshots
        ↓
DemoDataAdapter
        ↓
Shared DataAdapter interface
        ↓
Validation / scoring / recommendations
        ↓
Executive dashboard
```

The React app loads static JSON snapshots from:

```text
frontend/data/demo/btx/
```

These snapshots may simulate customer-private systems such as CRM, contacts, opportunities, ERP/capacity, contracts, pipeline, and account history.

Public or monitor-produced artifacts should be labeled separately from simulated private data. The product should preserve provenance wherever possible so the user can understand whether a signal came from demo data, public intelligence, monitor output, or a future live integration.

---

## Data Adapter Boundary

The data adapter contract is the most important architectural boundary in the product.

Frontend components should not directly depend on raw demo JSON, monitor artifacts, or backend API response shapes. Instead, they should consume normalized methods from a shared adapter interface, such as:

```text
getAccounts()
getOpportunities()
getSignals()
getRecommendations()
getCapacity()
getContracts()
getProspects()
getMapEntities()
```

Future API integrations should replace the adapter implementation, not force broad rewrites across dashboard components.

Dashboard and scoring changes should be narrowly scoped to genuinely new data needs. If a future source introduces new fields, those fields should be added intentionally to the shared contract rather than leaking source-specific shapes into UI components.

---

## Adapter Modes

The frontend selects a data adapter using `VITE_DATA_MODE`.

The default mode is `demo`.

### `demo`

Loads curated BTX demo snapshots from:

```text
frontend/data/demo/btx/
```

This mode is intended for the static demo experience. It may include simulated private operating data, such as accounts, opportunities, contracts, capacity, pipeline, and contacts.

### `artifact`

Reserved for static intelligence artifacts generated by the Python monitor, such as:

```text
/artifacts/brain_output.json
```

This mode is intended to prove that monitor-generated outputs can populate the same frontend contract without requiring a live backend.

### `live`

Reserved for authenticated API-backed integrations through the future FastAPI backend.

This mode should fail loudly and clearly in the static demo unless the required backend configuration is present. It should not silently fall back to demo data, because that would make it unclear whether the user is seeing simulated or live information.

---

## Provenance and Trust

Because this is a decision-support product, data provenance matters.

Where practical, records should preserve metadata such as:

* source type
* source name
* last refreshed timestamp
* confidence level
* supporting evidence
* whether the record is simulated, public, monitor-generated, or live integration data

This is especially important for rankings, signals, recommendations, and ChatPill explanations.

The CRO should be able to understand not only what the product recommends, but why it recommends it and what evidence supports the recommendation.

---

## Architecture Rules

1. The frontend should consume the shared adapter contract, not raw source-specific data shapes.
2. Demo data should remain deterministic and static unless explicitly changed.
3. Simulated private data and public/monitor-generated intelligence should be clearly distinguishable.
4. `live` mode should fail clearly when not configured.
5. Scoring and recommendation logic should be centralized or intentionally isolated, not scattered across unrelated UI components.
6. Future API integrations should replace adapter implementations rather than requiring broad dashboard rewrites.
7. The demo should stay static-first until the workflow is validated.
8. Avoid adding backend infrastructure before it is needed for a validated live use case.
9. Preserve a clear path from static demo data to artifact mode to live integrations.
10. Prioritize a product experience that is useful, explainable, and credible for a CRO.

