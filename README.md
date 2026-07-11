# BTX Revenue Cockpit

BTX Revenue Cockpit is a backend-canonical sales intelligence product for the BTX CRO. The canonical user experience is:

- `frontend/` — React/Vite cockpit deployed to GitHub Pages under `/cockpit/`.
- `btx_platform/` — FastAPI backend deployed to Fly.io for authenticated CRM, LLM proxy, pipeline control, settings, and write actions.
- `monitor_engine/` — Python monitor engine that collects public defense/industry sources and writes JSON artifacts consumed by the cockpit.

The retired Python-generated static HTML brief/map (`index.html`, `map.html`, `sw.js`) is no longer generated, published, or committed. The monitor engine still owns the JSON data contract:

```text
clients/btx/artifacts/run_output.json
clients/btx/artifacts/archive.json
clients/btx/artifacts/map_targets.json
```

## Current Architecture

```text
Public defense sources / configured APIs
        ↓
monitor_engine
        ↓
run_output.json + archive.json + map_targets.json
        ↓
GitHub Pages /btx/*.json
        ↓
React cockpit
        ↕
FastAPI backend on Fly.io
        ↕
HubSpot / LLM / pipeline / settings
```

The cockpit supports these data modes:

- `hybrid` — production demo default: HubSpot CRM reads, monitor JSON signals, demo fallback for not-yet-integrated operating context.
- `live` — backend-only mode for CRM reads and other live backend integrations.
- `artifact` — monitor artifact mode for static signal consumption.
- `demo` — deterministic local/test scaffolding from `frontend/data/demo/btx/`.

Demo mode and demo fixtures are intentionally kept for local development and tests.

## Local Frontend

```bash
cd frontend
npm ci
npm run dev
```

Production-equivalent local build:

```bash
cd frontend
VITE_DATA_MODE=hybrid \
VITE_BACKEND_ENDPOINT=https://btx-platform.fly.dev \
VITE_COPILOT_ENDPOINT=https://btx-platform.fly.dev/llm \
VITE_ARTIFACT_BASE_URL=../btx \
npm run build
```

`VITE_BACKEND_AUTH_TOKEN` is not baked into the Pages build. Backend-authenticated browser calls need a safer runtime auth design.

## Local Backend

```bash
pip install -e ".[dev]"
uvicorn btx_platform.asgi:app --reload --port 8001
```

Useful smoke checks:

```bash
curl http://127.0.0.1:8001/health
curl http://127.0.0.1:8001/engine-config/scoring_weights \
  -H "Authorization: Bearer $BTX_BACKEND_AUTH_TOKEN"
```

Fly.io deployment instructions live in `docs/DEPLOY_BACKEND.md`.

## Monitor Engine

Run source connectivity:

```bash
python3 -m monitor_engine.collectors \
  --config clients/btx/config.json \
  --days-back 14 \
  --max-items 3
```

Run the monitor JSON pipeline without LLM analysis:

```bash
SAM_API_KEY=dummy CONGRESS_API_KEY=dummy \
python3 -m monitor_engine \
  --config clients/btx/config.json \
  --output /tmp/btxout \
  --archive /tmp/btxout/archive.json \
  --skip-analysis
```

Validate the output contract:

```bash
python3 -c "from monitor_engine.models import RunOutput; from pathlib import Path; RunOutput.model_validate_json(Path('/tmp/btxout/run_output.json').read_text()); print('OK')"
```

Build account-map data:

```bash
SAM_API_KEY=dummy CONGRESS_API_KEY=dummy \
python3 -m monitor_engine.targets \
  --config clients/btx/config.json \
  --output /tmp/btxmap
```

This writes `map_targets.json` only. Rendering happens in the React cockpit.

## GitHub Actions

Workflows are manual-dispatch only unless explicitly changed.

- **Monitor Pipeline**: test gate, collect/analyze, write JSON artifacts, commit artifacts, then call Pages deployment.
- **Deploy Pages**: builds the React cockpit and publishes:
  - `/cockpit/` — cockpit app
  - `/btx/run_output.json`
  - `/btx/archive.json`
  - `/btx/map_targets.json`

Enable Pages in the repo UI with Settings → Pages → Source: **GitHub Actions**.

## Configuration

Primary client config:

```text
clients/btx/config.json
```

Useful fields:

| Field | Purpose |
|---|---|
| `branding` | Client display metadata embedded in `run_output.json` |
| `sources` | RSS, JSON API, or HTML-list public monitor sources |
| `keyword_prefilter` | Cheap text include/exclude filter before LLM analysis |
| `scoring_rubric` | Tier thresholds and never-discard terms |
| `profile` | BTX capabilities, customers, goals, risks, and named entities |
| `enrichers` | Optional cross-API enrichment for extracted entities |
| `deep_analysis` | Optional agentic deep-analysis settings |
| `account_map` | Target account sources and fit-map configuration for `map_targets.json` |

Never put secrets in `config.json`. Use `auth_env_var` and configure secrets in GitHub Actions or Fly.io.

## Verification

Core suite:

```bash
cd frontend
npm ci
npm run typecheck
npm run build
npm run test:metrics
npm run test:rail
npm run test:settings

cd ..
python3 -m pytest -q
```

Known local auth caveat: the full monitor command needs `ANTHROPIC_API_KEY` for LLM analysis, and BTX has auth-gated SAM.gov/Congress.gov sources. Use `--skip-analysis` plus dummy source keys for local JSON-contract smoke tests when real keys are unavailable.

## Files To Edit

| Path | Owner |
|---|---|
| `frontend/` | Cockpit UI and frontend data adapters |
| `btx_platform/` | Backend API, integrations, persistence |
| `monitor_engine/` | Monitor engine collection, scoring, enrichment, JSON artifacts |
| `clients/btx/config.json` | BTX monitor configuration |
| `clients/btx/artifacts/*.json` | Committed JSON outputs from CI |
| `.github/workflows/` | Manual pipeline and deployment workflows |

Avoid committing generated frontend build output, local databases, virtualenvs, or local env files.
