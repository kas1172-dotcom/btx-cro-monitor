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

The browser build never holds a shared backend secret. Instead it gates the app behind Clerk sign-in (`VITE_CLERK_PUBLISHABLE_KEY`) and sends each signed-in user's session token on every backend call; the backend validates that token per-request against Clerk's JWKS.

In `hybrid` mode, monitor artifacts are treated as real market/portfolio signals unless the interim text-fit guard can link them strongly to an account. Weak matches stay unlinked and do not change account scores.

## Local Backend

```bash
pip install -e ".[dev,platform]"
uvicorn btx_platform.asgi:app --reload --port 8001
```

Local SQLite dev creates its tables automatically on startup (`init_db`) — no
migration step needed. Against Postgres (`docker-compose up postgres redis`,
then `BTX_DATABASE_URL=postgresql+psycopg://btx:btx@localhost:5432/btx`), or
whenever `BTX_ENV=prod`, run migrations explicitly first:

```bash
alembic upgrade head
```

To run the background forwarder (retries/dead-letters failed webhook
forwards; needs Redis and `BTX_QUEUE_BACKEND=celery`):

```bash
celery -A btx_platform.workers.celery_app worker --loglevel=info
```

Useful smoke checks:

```bash
curl http://127.0.0.1:8001/health
curl http://127.0.0.1:8001/engine-config/scoring_weights \
  -H "Authorization: Bearer $CLERK_SESSION_TOKEN"
```

`$CLERK_SESSION_TOKEN` is a session JWT for a signed-in user (copy one from your
browser's dev tools while signed in locally, or mint one with the Clerk backend
SDK). There is no shared backend token anymore — see `docs/DEPLOY_BACKEND.md`
for how Clerk auth is configured.

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

10 workflows under `.github/workflows/`. Two run automatically on every PR/push
to `main`; everything else is manual-dispatch only, run from the Actions tab.

**Automatic (PR/push gates):**

- **CI** (`ci.yml`) — frontend typecheck/build/every non-browser test suite,
  plus backend pytest. Required status check for `main`.
- **E2E** (`e2e.yml`) — browser smoke test across the four core surfaces.
  Skipped by default (set repo variable `RUN_E2E=1` to enable); kept off ci.yml
  because it installs a real Chromium browser and is slower.

**Manual — day-to-day demo refresh:**

- **Update demo (bake + deploy)** (`update.yml`) — ★ the one button you
  normally need. Refreshes LLM-baked artifacts (dossier prose, extracted
  signals) then rebuilds and publishes the cockpit. Does **not** re-collect
  fresh signals from sources — run Monitor Pipeline first if those are stale.
- **Deploy Frontend Cockpit** (`deploy-frontend.yml`) — rebuilds and publishes
  the frontend only, no re-baking. Use after merging a frontend-only change.
- **Bake LLM artifacts** (`insights.yml`) — refreshes dossier prose and
  extracted signals and commits them, without deploying. Also runs as the
  first step of "Update demo."

**Manual — data pipeline:**

- **Monitor Pipeline** (`monitor.yml`) — the test gate, then collect →
  analyze → write JSON artifacts (`run_output.json`, `archive.json`,
  `map_targets.json`) → commit → publish to Pages. Run this when the
  underlying signals themselves need refreshing, not just the LLM prose.
- **Discovery Validation** (`discovery-validate.yml`) — unrelated maintenance
  tool for onboarding a new client: runs the source-discovery agent live
  against a client's intake and reports coverage against the hand-built
  `config.json`. Not part of the demo-refresh flow.

**Manual — backend:**

- **Deploy Backend (Staging)** (`deploy-staging.yml`) — deploys `btx_platform`
  to a separate Fly staging app. Requires typing `staging` to confirm and a
  one-time staging app + secrets setup (see the workflow header). Production
  backend deploys stay a manual `fly deploy` per `docs/DEPLOY_BACKEND.md` —
  there is no one-click production backend deploy.

**Manual — other:**

- **Weekly Revenue Brain Memo** (`weekly-memo.yml`) — generates and commits
  the weekly memo archive under `frontend/memo_archive/`. Cron trigger is
  disabled pending client validation of the cadence.

`pages.yml` ("Deploy Pages") is not in this list — it is reusable publish logic
called by the three deploy workflows above, not something you run directly.

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
