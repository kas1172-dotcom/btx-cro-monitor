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
- Chatpil/assistant UX,
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

## Adapter Modes

`VITE_DATA_MODE` selects the frontend adapter:

- `hybrid`: intended production demo default. HubSpot CRM reads are real, monitor signals are real artifacts, non-integrated operating context uses labeled demo fallback. Monitor artifacts remain market/portfolio-level unless the interim fit guard links them strongly to an account; unlinked artifacts do not affect account scores.
- `live`: live backend-backed mode. It should surface backend issues clearly.
- `artifact`: monitor-artifact mode for signal consumption without live CRM.
- `demo`: deterministic dev/test scaffolding from `frontend/data/demo/btx/`.

Demo data remains load-bearing for local development, tests, and hybrid fallback until backend integrations cover those domains end to end.

## Provenance

Hybrid mode must label data-bearing UI with provenance:

- HubSpot: live CRM records,
- Monitor: public monitor artifacts,
- Demo: fallback operating context.

Deliverables should not blend real and demo facts without provenance disclosure.

## Deployment

GitHub Actions are manual-dispatch by default.

- `Monitor Pipeline` writes JSON artifacts back to `clients/btx/artifacts/`.
- `Deploy Pages` publishes the cockpit under `/cockpit/` and selected JSON artifacts under `/btx/`.
- Fly.io hosts `btx_platform`.

The Pages build does not bake any shared backend bearer token. Browser-safe backend auth is deferred to WP10; until then, protected backend routes may reject public cockpit calls.

## Architecture Rules

1. The React cockpit and FastAPI backend are the canonical product.
2. The monitor engine produces JSON data, not product HTML.
3. Keep `run_output.json`, `archive.json`, and `map_targets.json` valid.
4. Do not change engine scoring, collectors, enrichment, or backend behavior during declutter work unless explicitly required.
5. Keep demo mode as dev/test scaffolding until live coverage is complete.
6. Prefer adapter implementations over source-specific UI coupling.
7. Preserve provenance whenever real and fallback data coexist.
8. Do not commit local env files, virtualenvs, frontend build output, local DBs, or caches.
