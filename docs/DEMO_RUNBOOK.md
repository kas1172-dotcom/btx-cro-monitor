# Demo Runbook

## Starting Point

- Branch: `main`
- Required commit for this milestone: the local commit that includes evidence drawer, timelines, focus mode, briefing mode, and the executive brief.
- Do not demo from an uncommitted worktree.

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
python3 -m btx_platform.demo.reset --tenant demo-btx --dry-run
python3 -m btx_platform.demo.reset --tenant demo-btx
python3 -m btx_platform.demo.reset --tenant demo-btx --verify-only
```

The reset is deterministic, idempotent, tenant-scoped, and should not affect normal tenants.

## Start Locally

Backend:

```bash
source .venv/bin/activate
uvicorn btx_platform.api:app --reload
```

Frontend:

```bash
cd frontend
npm run dev
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
2. Open the first priority work item.
3. `/accounts/demo-acct-lockheed`
4. Open `View evidence`.
5. Review the meaningful timeline.
6. `/accounts/demo-acct-lockheed?view=focus`
7. `/ask?account=demo-acct-lockheed&prompt=Why%20did%20the%20system%20recommend%20this%20action%2C%20and%20what%20should%20I%20discuss%20with%20this%20account%3F`
8. Create or open the executive brief.
9. `/accounts/demo-acct-lockheed?view=briefing`
10. Open the deliverable and use `Briefing mode`.

## Exact Ask Question

```text
Why did the system recommend this action, and what should I discuss with this account?
```

Expected behavior: Ask uses internal citations, distinguishes confirmed facts from derived scores and simulated records, previews drafts, requires confirmation, and persists deliverables through the normal deliverable API.

## Real Versus Simulated

- Public monitor records are stored source records.
- Internal CRM, opportunity, contact, work, and capacity records in the demo tenant are illustrative.
- HubSpot task verification in the demo can be represented by seeded demo records.
- Live internet research, email execution, calendar execution, ERP/MES integration, Compare mode, PWIN calibration, and self-learning score updates are not implemented.

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
