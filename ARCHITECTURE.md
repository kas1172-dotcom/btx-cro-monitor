# BTX Enterprise Brain Architecture

This repository currently contains three related systems that support the BTX Revenue Cockpit demo:

1. `monitor_engine/` and `clients/btx/`: a Python static intelligence monitor that ingests public or configured sources, scores relevance, and builds static artifacts.
2. `frontend/`: a React/Vite Enterprise Brain dashboard that presents account, signal, pipeline, and recommendation workflows to a CRO.
3. `btx_platform/`: an early FastAPI integration backend for future authenticated integrations, persistence, queues, and webhooks.

The current product posture is intentionally static. The demo should show a realistic operating model without requiring a paid server or live customer credentials before the workflow is validated.

## Intended Future Architecture

- Python monitor: ingestion and intelligence layer for public, configured, and agent-assisted source collection.
- React app: executive interface for account prioritization, recommendations, signal review, and guided selling workflows.
- FastAPI backend: future live integration and persistence layer for authenticated client APIs, background jobs, and durable state.

In production, the FastAPI backend can populate the same core adapter contract from Salesforce, HubSpot, ERP/capacity systems, email/calendar, SAM.gov, public news, and other APIs. The goal is for the scoring engine and primary UI flows to keep using the contract while the adapter implementation changes.

## Static Demo Data Flow

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

For this demo, the React app loads static JSON snapshots from `frontend/data/demo/btx/` through a data adapter. These snapshots are simulated where they represent customer-private systems such as CRM, contacts, opportunities, ERP/capacity, and pipeline. Public or monitor-produced artifacts should be labeled separately when used.

The important boundary is the adapter contract. Future API integrations should replace the adapter implementation, while keeping dashboard and scoring changes narrowly scoped to any genuinely new data needs.

## Adapter Modes

The frontend selects a data adapter with `VITE_DATA_MODE`, defaulting to `demo`.

- `demo`: loads static BTX demo snapshots from `frontend/data/demo/btx/`.
- `artifact`: reserved for a future static monitor artifact such as `/artifacts/brain_output.json`.
- `live`: reserved for authenticated API-backed integrations. It intentionally fails in this static demo until configured.

This keeps the future production path visible without building premature infrastructure.
