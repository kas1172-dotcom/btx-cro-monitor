# Deploy Backend

`btx_platform` is the single production backend for authenticated settings, LLM composition, and monitor pipeline triggers. It is single-tenant and uses one static bearer token.

Primary target: Fly.io. Railway notes are included after the Fly runbook.

## Required Env

Generate secrets locally:

```bash
openssl rand -base64 32
```

Set these values in production:

```bash
BTX_ENV=prod
BTX_DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:PORT/DBNAME
BTX_BACKEND_AUTH_TOKEN=<openssl-output>
BTX_FRONTEND_ORIGINS=https://<your-github-pages-host>
BTX_ANTHROPIC_API_KEY=<anthropic-key>
BTX_PIPELINE_MECHANISM=github
BTX_GITHUB_PAT=<github-token-with-actions-write>
BTX_GITHUB_REPO=kas1172-dotcom/btx-cro-monitor
BTX_GITHUB_WORKFLOW=monitor.yml
BTX_GITHUB_REF=main
BTX_PIPELINE_MIN_INTERVAL_SECONDS=600
```

Local/dev defaults:

```bash
BTX_DATABASE_URL=sqlite:///./btx_platform.db
BTX_PIPELINE_MECHANISM=subprocess
BTX_PIPELINE_OUTPUT_DIR=clients/btx/artifacts
BTX_PIPELINE_GENERATED_DIR=.btx_platform/generated
```

Optional integration env:

```bash
BTX_HUBSPOT_ACCESS_TOKEN=
BTX_GMAIL_ALLOWLIST=
BTX_LLM_TIMEOUT_SECONDS=45
BTX_LLM_MAX_BODY_BYTES=524288
```

Frontend live env:

```bash
VITE_DATA_MODE=live
VITE_BACKEND_ENDPOINT=https://<backend-host>
VITE_BACKEND_AUTH_TOKEN=<same-token-as-BTX_BACKEND_AUTH_TOKEN>
VITE_COPILOT_ENDPOINT=https://<backend-host>/llm
```

## Fly.io

1. Install the Fly CLI and log in:

```bash
brew install flyctl
fly auth login
```

2. Create the app and Postgres database:

```bash
fly apps create btx-platform
fly postgres create --name btx-platform-db --region iad
fly postgres attach --app btx-platform btx-platform-db
```

3. Set secrets:

```bash
fly secrets set \
  BTX_ENV=prod \
  BTX_BACKEND_AUTH_TOKEN="$(openssl rand -base64 32)" \
  BTX_FRONTEND_ORIGINS="https://<your-github-pages-host>" \
  BTX_ANTHROPIC_API_KEY="<anthropic-key>" \
  BTX_PIPELINE_MECHANISM=github \
  BTX_GITHUB_PAT="<github-token>" \
  BTX_GITHUB_REPO="kas1172-dotcom/btx-cro-monitor" \
  BTX_GITHUB_WORKFLOW="monitor.yml" \
  BTX_GITHUB_REF="main"
```

Fly sets `DATABASE_URL` when Postgres is attached. Map it into the app env if needed:

```bash
fly secrets set BTX_DATABASE_URL="$DATABASE_URL"
```

4. Deploy with this start command:

```bash
uvicorn btx_platform.asgi:app --host 0.0.0.0 --port 8080
```

5. Initialize or migrate the database. The current platform pattern is model-driven `create_all`; the app also runs this on boot for dev/test convenience.

```bash
python - <<'PY'
from btx_platform.config import get_settings
from btx_platform.db import init_db, make_engine
init_db(make_engine(get_settings().database_url))
PY
```

## Railway

1. Create a Railway project from this repository.
2. Add the Postgres plugin.
3. Set `BTX_DATABASE_URL` to Railway's Postgres URL using the `postgresql+psycopg://` driver prefix.
4. Set the same env values listed above.
5. Use the start command:

```bash
uvicorn btx_platform.asgi:app --host 0.0.0.0 --port $PORT
```

Run the same database initialization command in a Railway shell before the first smoke test.

## Smoke Tests

Replace `TOKEN` and `BASE`:

```bash
export BASE=https://<backend-host>
export TOKEN=<BTX_BACKEND_AUTH_TOKEN>
```

Health is public:

```bash
curl -s "$BASE/health"
```

Protected routes reject missing auth:

```bash
curl -i "$BASE/engine-config/scoring_weights"
```

Config read:

```bash
curl -s "$BASE/engine-config/scoring_weights" \
  -H "Authorization: Bearer $TOKEN"
```

LLM proxy contract:

```bash
curl -s "$BASE/llm" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"system":"Reply in one short sentence.","messages":[{"role":"user","content":"Say BTX backend is live."}]}'
```

Pipeline run:

```bash
curl -s -X POST "$BASE/pipeline/run" \
  -H "Authorization: Bearer $TOKEN"

curl -s "$BASE/pipeline/runs" \
  -H "Authorization: Bearer $TOKEN"
```

## Frontend Cutover

Set these in the frontend build environment:

```bash
VITE_DATA_MODE=live
VITE_BACKEND_ENDPOINT=$BASE
VITE_BACKEND_AUTH_TOKEN=$TOKEN
VITE_COPILOT_ENDPOINT=$BASE/llm
```

`copilot-proxy.mjs` remains in the repo for local fallback only; production LLM calls should go to `btx_platform /llm`.
