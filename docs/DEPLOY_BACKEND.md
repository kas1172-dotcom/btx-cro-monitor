# Deploy `btx_platform` on Fly.io

`btx_platform` is the production backend for authenticated settings, LLM
composition, monitor-pipeline dispatch, and future CRM/HubSpot integration. The
frontend and public monitor stay static; this service holds server-side secrets
and calls private APIs.

The Fly app name is:

```text
btx-platform
```

The public backend URL will be:

```text
https://btx-platform.fly.dev
```

## Prerequisites

Install and log in to the Fly CLI:

```bash
brew install flyctl
fly auth login
```

Generate the backend bearer token locally:

```bash
openssl rand -base64 32
```

Create or gather these secrets before deploy:

```text
BTX_BACKEND_AUTH_TOKEN       generated with openssl above
BTX_ANTHROPIC_API_KEY        Anthropic API key for /llm
BTX_HUBSPOT_ACCESS_TOKEN     HubSpot private-app token
BTX_GITHUB_PAT               GitHub token with permission to dispatch Actions
```

`BTX_FRONTEND_ORIGINS` should be the deployed frontend origin. For the current
GitHub Pages deployment, use this unless Phase 3 moves the frontend elsewhere:

```text
https://kas1172-dotcom.github.io
```

If the frontend later gets a custom domain, replace that value with the exact
custom origin.

## First Deploy

Run these commands from the repository root.

1. Create/confirm the Fly app without deploying yet.

```bash
fly launch --no-deploy
```

When prompted:

- App name: `btx-platform`
- Region: `iad`
- Use the existing `fly.toml` in this repo if Fly asks.
- Decline Dockerfile generation if Fly asks; this repo already has one.
- Do not deploy from `fly launch`; deploy happens after Postgres and secrets.

2. Create a managed Postgres database in the same region.

```bash
fly mpg create --name btx-platform-db --region iad --plan Basic --pg-major-version 17
```

3. Attach Postgres to the backend app.

```bash
fly mpg attach <cluster-id-from-create-output> --app btx-platform --variable-name DATABASE_URL
```

Fly injects a `DATABASE_URL` secret during attach. The backend accepts that
value directly. If your Fly CLI instead prints a database URL and does not set
it automatically, set it explicitly as `BTX_DATABASE_URL`:

```bash
fly secrets set BTX_DATABASE_URL="postgresql+psycopg://USER:PASSWORD@HOST:PORT/DBNAME"
```

4. Set production secrets.

```bash
fly secrets set \
  BTX_ENV=prod \
  BTX_BACKEND_AUTH_TOKEN="<openssl-output>" \
  BTX_FRONTEND_ORIGINS="https://kas1172-dotcom.github.io" \
  BTX_ANTHROPIC_API_KEY="<anthropic-key>" \
  BTX_HUBSPOT_ACCESS_TOKEN="<hubspot-private-app-token>" \
  BTX_PIPELINE_MECHANISM=github \
  BTX_GITHUB_PAT="<github-token>" \
  BTX_GITHUB_REPO="kas1172-dotcom/btx-cro-monitor" \
  BTX_GITHUB_WORKFLOW="monitor.yml" \
  BTX_GITHUB_REF="main"
```

5. Deploy.

```bash
fly deploy
```

The app creates its SQLAlchemy tables on startup if they do not already exist.
There are no Alembic migrations in this repo today.

## Smoke Tests

Set local shell variables for the smoke tests:

```bash
export BASE="https://btx-platform.fly.dev"
export TOKEN="<same-value-as-BTX_BACKEND_AUTH_TOKEN>"
```

Health is public:

```bash
curl -s "$BASE/health"
```

Protected config read:

```bash
curl -s "$BASE/engine-config/scoring_weights" \
  -H "Authorization: Bearer $TOKEN"
```

LLM proxy:

```bash
curl -s "$BASE/llm" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "system": "Reply in one short sentence.",
    "messages": [{"role": "user", "content": "Say BTX backend is live."}]
  }'
```

Trigger a monitor pipeline run through GitHub Actions:

```bash
curl -s -X POST "$BASE/pipeline/run" \
  -H "Authorization: Bearer $TOKEN"
```

List recent pipeline runs:

```bash
curl -s "$BASE/pipeline/runs" \
  -H "Authorization: Bearer $TOKEN"
```

## Operations

View logs:

```bash
fly logs --app btx-platform
```

Restart the app:

```bash
fly apps restart btx-platform
```

Open the Fly dashboard:

```bash
fly dashboard --app btx-platform
```

Check configured secrets:

```bash
fly secrets list --app btx-platform
```

## Frontend Cutover

When Phase 3 deploys or rebuilds the frontend against this backend, use:

```text
VITE_BACKEND_ENDPOINT=https://btx-platform.fly.dev
VITE_COPILOT_ENDPOINT=https://btx-platform.fly.dev/llm
```

Do not expose `BTX_BACKEND_AUTH_TOKEN` as a long-term public frontend secret.
For a real customer deployment, put the cockpit behind an access-control layer
or add user authentication before showing private HubSpot data.
