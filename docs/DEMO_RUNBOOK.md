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

The demo tenant is exactly two journeys plus one supporting prospect account.

- Accounts: 3. Lockheed Martin Corporation (current customer), nLIGHT, Inc. (prospect),
  Pulse Space Technologies (supporting prospect).
- Signals: 3. Programs: 2. Relationships: 2. Work items: 6. Deliverables: 1. Notes: 3.
- Source health: illustrative CRM seed, stale monitor pipeline, ERP/MES not configured.
- Work states include pending approval, verified simulated HubSpot task, and recorded outcome history.
- Seeded deliverable: `Executive Account and Meeting Brief - Lockheed Martin Corporation`.
- Ask conversation: seeded Lockheed account conversation with citations.
- Navigation is the four-surface cockpit: Today, Work, Accounts, Ask. Deliverables,
  Integrations, and Settings remain reachable as utilities. The analytical surfaces
  (Prospects, Trip Planner, Map, Analysis, Capacity, Programs) were retired on 2026-07-25
  and are not in the rail.

## Route Sequence

### Journey 1: Lockheed Martin, current customer

1. `/today`. The sourced directed-energy development is the item that needs attention.
2. `/accounts/demo-acct-lockheed`. Current-customer context, confirmed account link.
3. Open `View evidence`. Confidence reads as a qualitative band with its reason, never a percentage.
4. Review the account timeline.
5. `/work/demo-wi-approve-lockheed`. The approval-gated work item.
6. Open `Preview HubSpot task`. Keep execution simulated. Reset never issues a real external mutation.
7. `/deliverables`, open `Executive Account and Meeting Brief - Lockheed Martin Corporation`.
8. `/accounts/demo-acct-lockheed?view=briefing` for the briefing view.

### Journey 2: nLIGHT, prospect

9. `/accounts/demo-acct-nlight`. Classified as a prospect, not a customer.
10. The nLIGHT signal comes from the same public Breaking Defense source as Journey 1,
    but its account link is `needs_review`, so it is held as a prospect to qualify.
11. `/work/demo-wi-research-nlight`. The prospect-research item names its four gaps:
    no CAGE code, no named contact, unconfirmed supplier fit, and no assessed capacity.
12. `/work/demo-wi-review-nlight`. The relationship review that must happen before
    nLIGHT is treated as an account fact.
13. `/ask/demo-assist-lockheed`. Ask answers from stored records and states its limits.

## Go Or No-Go

Status as of 2026-07-25: **NO-GO pending the on-camera surface audit.**

Verified by this pass:

- Reset is deterministic and idempotent. Two consecutive resets produce identical
  counts and fingerprints, and verify-only passes against the result.
- Backend `pytest`: 454 passed.
- Frontend typecheck clean, production build succeeds, `check:design` and `check:voice` pass.
- Repo-wide em-dash grep is clean apart from one `.gitignore` comment.
- No surface renders a fabricated percentage confidence.

Not yet verified, and required before a GO:

- The live click-through of both journeys in a running browser, including loading,
  empty, stale, and failure states on each of the four primary surfaces.
- Confirmation that AI status shows live when the LLM is configured.
- `test:phase0` and `test:identity` are red. Both were already red on `main` before this
  consolidation and both run in CI, so CI is currently red for a pre-existing reason.

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
