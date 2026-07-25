# Demo Runbook

## Starting Point

- Branch: `main`
- Required commit for this milestone: the latest local commit named `Complete final demo rehearsal and release hardening`.
- Do not demo from an uncommitted worktree.
- Demo tenant: `btx-demo-command-cockpit`.

## Required Environment

Backend:

- `DATABASE_URL`
- `BTX_ENV`
- `BTX_FRONTEND_ORIGINS`
- `BTX_ENCRYPTION_KEY`
- `BTX_CLERK_ISSUER`
- `BTX_CLERK_SECRET_KEY`
- `BTX_QUEUE_BACKEND`
- `BTX_REDIS_URL` when queue backend is Celery
- LLM key only when live assistant composition is expected

Frontend:

- `VITE_BACKEND_ENDPOINT`
- Clerk publishable key if auth is enabled for the target environment

## Reset And Verify Demo Workspace

From the repository root:

```bash
python3 tooling/reset_demo_tenant.py --tenant btx-demo-command-cockpit --dry-run
python3 tooling/reset_demo_tenant.py --tenant btx-demo-command-cockpit
python3 tooling/reset_demo_tenant.py --tenant btx-demo-command-cockpit --verify-only
```

The reset is deterministic, idempotent, tenant-scoped, and should not affect normal tenants. Use this existing database-backed demonstration tenant only; do not create another tenant, demo mode, data provider, environment, or application instance for rehearsal.

## Start Locally

Backend:

```bash
source .venv/bin/activate
uvicorn btx_platform.asgi:app --reload --port 8001
```

Frontend:

```bash
cd frontend
VITE_BACKEND_ENDPOINT=http://127.0.0.1:8001 npm run dev
```

Open the Vite URL and sign in through Clerk when auth is enabled.

## Expected Demo State

- Source health: illustrative CRM seed, stale monitor pipeline, ERP/MES not configured.
- Main account: Lockheed Martin Corporation.
- Work states include pending approval, verified simulated HubSpot task, and recorded outcome history.
- Seeded deliverable: `Executive Account and Meeting Brief - Lockheed Martin Corporation`.
- Ask conversation: seeded Lockheed account conversation with citations.

## Route Sequence

1. `/today`
2. `/accounts/demo-acct-lockheed`
3. Open `View evidence`.
4. Review the account timeline.
5. `/work/demo-wi-approve-lockheed`
6. Add a note only during rehearsal, then reset before recording.
7. `/work/demo-wi-approved-pulse`
8. Open `Preview HubSpot task`; keep execution simulated unless staging is explicitly configured for a safe write target.
9. `/ask/demo-assist-lockheed`
10. Ask the three rehearsal questions below and inspect citations.
11. `/deliverables`
12. Open `Executive Account and Meeting Brief - Lockheed Martin Corporation`.
13. Use `Focus mode` and `Briefing mode`.
14. `/accounts/demo-acct-lockheed?view=focus`
15. `/accounts/demo-acct-lockheed?view=briefing`

## Exact Ask Questions

```text
Why did the system recommend this action, and what should I discuss with this account?
What information is still missing before we should pursue this account?
Prepare an executive account and meeting brief.
```

Expected behavior: Ask uses internal citations, distinguishes confirmed facts from derived scores and simulated records, previews drafts, requires confirmation, and persists deliverables through the normal deliverable API.

## Real Versus Simulated

- Public monitor records are stored source records.
- Internal CRM, opportunity, contact, work, and capacity records in the demo tenant are illustrative.
- HubSpot task verification in the demo can be represented by seeded demo records.
- Live internet research, email execution, calendar execution, ERP/MES integration, Compare mode, PWIN calibration, and self-learning score updates are not implemented.
- For the demo tenant, `/world-snapshot` must read the seeded demo workspace without syncing HubSpot or monitor records into that tenant and without recalculating demo score snapshots.

## Recovery

- If the world looks wrong, run verify-only first.
- If verify-only fails, run reset and then verify-only again.
- If the frontend cannot fetch, confirm `VITE_BACKEND_ENDPOINT` and Clerk session state.
- If Fly SSH fails, verify the Fly app name, token, and machine health before rerunning migrations.

## Pre-Recording Checklist

- `git status -sb` is clean.
- Demo reset verify-only passes.
- Backend and frontend are running.
- Clerk sign-in is valid.
- `/today`, Account 360, Work detail, Ask, Deliverable editor, Focus mode, Briefing mode, and Evidence Drawer all load.
- No terminal, database editing, browser reload, or manual repair is needed during the demo.
