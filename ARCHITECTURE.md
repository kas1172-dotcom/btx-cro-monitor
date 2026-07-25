# BTX Backend-Canonical Architecture

The canonical product is the React cockpit plus FastAPI backend. The Python monitor engine remains a data producer, not a UI renderer.

## Product Boundary

```text
frontend/      React cockpit: the user-facing CRO product
btx_platform/  FastAPI backend: auth boundary, CRM/LLM/pipeline/settings/workflow APIs
monitor_engine/ Python monitor: public-source collection, scoring, enrichment, JSON output
clients/btx/   BTX configuration and committed JSON artifacts
```

Retired:

```text
Python-generated index.html
Python-generated map.html
Static-site service worker
tooling/build_pages.py static dashboard copier
```

## Runtime Model

```text
Defense / industry sources
        ↓
monitor_engine collectors, prefilter, scorer, enrichment
        ↓
run_output.json + archive.json + map_targets.json
        ↓
GitHub Pages /btx/*.json
        ↓
React cockpit
        ↕
FastAPI backend on Fly.io
        ↕
HubSpot, LLM provider, GitHub Actions pipeline, settings persistence
```

The monitor engine may run locally or in GitHub Actions. The cockpit fetches or bundles monitor artifacts through adapters. The backend owns live authenticated integrations and write actions.

## Data-Contract Invariant

The monitor engine must continue to produce valid JSON artifacts:

```text
run_output.json
archive.json
map_targets.json
```

Required smoke:

```bash
python3 -m monitor_engine --config clients/btx/config.json --output /tmp/btxout --archive /tmp/btxout/archive.json --skip-analysis
python3 -c "from monitor_engine.models import RunOutput; from pathlib import Path; RunOutput.model_validate_json(Path('/tmp/btxout/run_output.json').read_text()); print('OK')"
python3 -m monitor_engine.targets --config clients/btx/config.json --output /tmp/btxmap
```

`index.html`, `map.html`, and `sw.js` are no longer part of the engine contract.

## Frontend

The frontend is the decision interface. It is responsible for:

- dashboard and rail navigation,
- account dossiers,
- monitor signal presentation,
- map/prospecting views,
- deliverables,
- persistent Ask conversations,
- provenance labels,
- workflow buttons that call backend routes where live actions exist.

Frontend components should consume normalized adapter methods, not raw source-specific shapes.

## Backend

The backend is the live product boundary. It is responsible for:

- health and CORS,
- bearer-protected routes,
- HubSpot CRM reads,
- HubSpot task creation,
- LLM proxying,
- engine configuration persistence,
- pipeline dispatch/history,
- future authenticated integrations and workflow audit.

The backend should not hardcode demo behavior for production routes. If a live integration is missing, routes should return typed `not_configured` or provider errors.

## Monitor Engine

The monitor engine is responsible for:

- collecting configured public/API/RSS/HTML sources,
- applying keyword prefilters,
- running LLM analysis when configured,
- grouping related stories,
- applying feedback,
- enriching extracted entities,
- building the entity graph,
- updating the rolling archive,
- writing JSON artifacts.

It is not responsible for rendering the product UI.

## Runtime Data Path

The production cockpit has one adapter path: authenticated frontend calls to backend APIs. The backend is responsible for CRM reads, monitor artifact reads, persisted work items, persisted work-item lifecycle commands, durable notes, persisted deliverables, persistent Ask conversations, and source-health disclosure.

## Ask

Ask is the single production assistant identity. It stores tenant-scoped conversations and messages in the backend, retrieves only internal records, returns citations for supported claims, and creates only preview drafts until the user confirms through the normal work-item or deliverable APIs. Details live in `docs/ASSISTANT_ARCHITECTURE.md`.

## Presentation Layer

The frontend owns shared presentation view models only. `frontend/src/app/evidence.ts` derives drawer-ready evidence packages from existing signals, score snapshots, work items, deliverable provenance, and Ask citations. `frontend/src/app/timeline.ts` derives meaningful business timeline events from existing signals, relationships, score snapshots, work audit history, notes, and outcomes. Neither module creates a new authoritative evidence store or scoring path.

Focus mode and Briefing mode are URL query states such as `/accounts/:id?view=focus` and `/accounts/:id?view=briefing`. They reuse the same backend world snapshot, permissions, and record routes.

Demo JSON under `frontend/data/demo/btx/` is test scaffolding only. It must not be selected by a production Vite flag or used as a runtime fallback when a backend source is missing.

## Demonstration Tenant

The deterministic demo workspace is a backend tenant, not a frontend mode. The tenant row `btx-demo-command-cockpit` is marked by `tenants.is_demonstration = true`; reset tooling refuses all normal tenants. Seeded accounts, signals, relationships, score snapshots, work items, notes, deliverables, and Ask conversations use the normal database tables. World records load through `/world-snapshot`; assistant records load through `/assistant/conversations`.

Public intelligence in the seed retains source metadata. Internal BTX CRM/workflow context is illustrative and classified as simulated. Resetting the demo tenant does not call HubSpot or mutate external systems.

## Provenance

The backend must label data-bearing UI with provenance:

- HubSpot: live CRM records,
- Monitor: public monitor artifacts,
- Unavailable: systems that are not connected yet, such as ERP, MES, capacity, and production schedule.

Deliverables should not blend real and unavailable facts. Missing values should remain missing and show a clear source-health state.

## Deployment

GitHub Actions are manual-dispatch by default.

- `Monitor Pipeline` writes JSON artifacts back to `clients/btx/artifacts/`.
- `Deploy Pages` publishes the cockpit under `/cockpit/` and selected JSON artifacts under `/btx/`.
- Fly.io hosts `btx_platform`.

The Pages build does not bake any shared backend bearer token. Clerk session tokens are attached to backend requests in the browser and validated by the backend per request.

## Architecture Rules

1. The React cockpit and FastAPI backend are the canonical product.
2. The monitor engine produces JSON data, not product HTML.
3. Keep `run_output.json`, `archive.json`, and `map_targets.json` valid.
4. Do not change engine scoring, collectors, enrichment, or backend behavior during declutter work unless explicitly required.
5. Keep demo mode as dev/test scaffolding until live coverage is complete.
6. Prefer adapter implementations over source-specific UI coupling.
7. Preserve provenance whenever real and fallback data coexist.
8. Do not commit local env files, virtualenvs, frontend build output, local DBs, or caches.
