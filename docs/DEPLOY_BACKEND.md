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

Create a Clerk application (clerk.com) if you don't have one yet. Single-tenant
is fine to start. From its dashboard, copy the publishable key (frontend,
non-secret) and the secret key (backend only), and note the instance's issuer
URL (Frontend API URL under API Keys — looks like
`https://<your-instance>.clerk.accounts.dev`).

Create or gather these secrets before deploy:

```text
CLERK_SECRET_KEY             Clerk backend secret key
BTX_CLERK_ISSUER             Clerk instance issuer URL
BTX_ANTHROPIC_API_KEY        Anthropic API key for /llm
BTX_HUBSPOT_ACCESS_TOKEN     HubSpot private-app token
BTX_GITHUB_PAT               GitHub token with permission to dispatch Actions
```

`BTX_FRONTEND_ORIGINS` should be the deployed frontend origin. The Phase 3
cockpit URL is:

```text
https://kas1172-dotcom.github.io/btx-cro-monitor/cockpit/
```

CORS origins do not include paths, so set the Fly secret to:

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

4. Provision Redis for the Celery worker queue.

```bash
fly redis create   # note the redis:// URL it prints
```

5. Generate an encryption key for credentials stored at rest (connection
   signing secrets):

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

6. Set production secrets.

```bash
fly secrets set \
  BTX_ENV=prod \
  CLERK_SECRET_KEY="<clerk-secret-key>" \
  BTX_CLERK_ISSUER="https://<your-instance>.clerk.accounts.dev" \
  BTX_FRONTEND_ORIGINS="https://kas1172-dotcom.github.io" \
  BTX_ANTHROPIC_API_KEY="<anthropic-key>" \
  BTX_HUBSPOT_ACCESS_TOKEN="<hubspot-private-app-token>" \
  BTX_PIPELINE_MECHANISM=github \
  BTX_GITHUB_PAT="<github-token>" \
  BTX_GITHUB_REPO="kas1172-dotcom/btx-cro-monitor" \
  BTX_GITHUB_WORKFLOW="monitor.yml" \
  BTX_GITHUB_REF="main" \
  BTX_REDIS_URL="<redis-url-from-step-4>" \
  BTX_QUEUE_BACKEND=celery \
  BTX_ENCRYPTION_KEY="<key-from-step-5>"
```

7. Run migrations before the new code serves traffic.

```bash
fly ssh console --app btx-platform -C "alembic upgrade head"
# or locally against BTX_DATABASE_URL:
BTX_DATABASE_URL="<prod-database-url>" alembic upgrade head
```

With `BTX_ENV=prod`, the app refuses to start against a database that hasn't
had this run — it raises `SchemaNotMigrated` instead of silently creating
tables from model metadata (that fallback is dev/test-only).

8. Deploy. `fly.toml` defines two processes from the same image: `app`
   (the API, serving `http_service`) and `worker` (the Celery consumer). Both
   deploy together.

```bash
fly deploy
```

9. Confirm the worker process is running.

```bash
fly status --app btx-platform   # expect both an `app` and a `worker` machine
fly logs --app btx-platform     # watch for celery worker startup + task logs
```

Every future schema change ships as a new file under `alembic/versions/`;
generate one with `alembic revision --autogenerate -m "..."` after changing
`btx_platform/models.py`, review the generated upgrade/downgrade, then run
step 7 again on the next deploy.

## Smoke Tests

Set local shell variables for the smoke tests:

```bash
export BASE="https://btx-platform.fly.dev"
export TOKEN="<a-signed-in-user's-clerk-session-token>"
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
VITE_DATA_MODE=hybrid
VITE_ARTIFACT_BASE_URL=../btx
```

Add these repository secrets for the GitHub Pages frontend workflow:

```text
VITE_BACKEND_ENDPOINT=https://btx-platform.fly.dev
VITE_COCKPIT_PASSWORD=<demo access password>
```

Do not add a shared backend bearer token to the Pages build. Browser-safe
backend auth is deferred to WP10; protected backend calls may reject public
cockpit requests until then.

After those secrets are set, run the **Deploy Frontend Cockpit** workflow from
the Actions tab. The cockpit will publish at:

```text
https://kas1172-dotcom.github.io/btx-cro-monitor/cockpit/
```

If you need to update the allowed frontend origin on Fly later, run:

```bash
fly secrets set --app btx-platform BTX_FRONTEND_ORIGINS="https://kas1172-dotcom.github.io"
```

Never put `CLERK_SECRET_KEY` in a `VITE_` variable or any frontend build — it
is backend-only. Only `VITE_CLERK_PUBLISHABLE_KEY` belongs in the frontend
build; it identifies the Clerk instance and is not a secret.
