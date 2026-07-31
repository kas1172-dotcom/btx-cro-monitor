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

## Deployed Demo Route

Deployed cockpit: `https://kas1172-dotcom.github.io/btx-cro-monitor/cockpit/`
Deployed backend: `https://btx-platform.fly.dev`
Demo tenant: `btx-demo-command-cockpit`

Sign in through Clerk as an operator whose session token carries a role claim of
`cro`. Anything less cannot use Ask, which needs analyst or higher, and cannot
execute a HubSpot task, which needs `cro`.

### Journey 1: Lockheed Martin, current customer

1. Open the cockpit root. It lands on Today.
2. The sourced directed-energy development is the item needing attention. Open it.
3. Follow it to the Lockheed account. It is classified a current customer.
4. Read the score. Lockheed carries an engine-computed attractiveness score with a
   factor breakdown: capability alignment, addressable work package, award
   momentum, and strategic relevance all contribute. Nothing is hand-set.
5. Open `View evidence` to show the sources behind the score and the account link.
6. Open the approval-gated work item.
7. `Preview HubSpot task`, confirm, and show the real task id and its verification.
   The task lands on Lockheed Martin Aeronautics, HubSpot company `336059557613`.
8. Open the seeded meeting brief from Deliverables.

### Journey 2: nLIGHT, prospect

9. Open the nLIGHT account. It is classified a prospect, not a customer.
10. The score reads insufficient data, honestly, because the evidence is not there.
11. Open `View evidence` on the prospect-research work item. It names all four
    gaps: no CAGE code, no named contact, unconfirmed supplier fit, and no
    assessed capacity.
12. Show the relationship-review item. The nLIGHT account link is unconfirmed, which
    is why nLIGHT is not treated as an account fact.

### Pulse Space, surfaced but not actioned

13. Pulse Space appears as a held signal. Its subcontract relevance to BTX is not
    confirmed, so it stays a research target rather than being escalated.

### Ask

14. Ask a question spanning both accounts. The answer is grounded in stored records,
    carries internal citations, and states its limits rather than inventing.

## Between Takes

The demo tenant never issues an external mutation on reset, but Journey 1 step 7
creates a real HubSpot task. Before re-recording:

1. Delete the demo task created on Lockheed Martin Aeronautics in the HubSpot portal.
2. Re-run the tenant reset against the deployed database to restore workflow state:
   `python3 tooling/reset_demo_tenant.py --tenant btx-demo-command-cockpit`
   then the same command with `--verify-only`.

Do not run the HubSpot cleanup or seed between takes. Those manage the three demo
companies, not the per-take task.

## Go Or No-Go

Status: **NO-GO, pending the signed-in walkthrough on the deployed site.**
Everything that can be verified without an operator login is verified and green.

### Verified on the deployed stack

- Backend Fly release **v22**, built from `main`. Health reports `status: ok`,
  `env: prod`, `db: true`, `llm: true`, `auth: true`. HubSpot configured and ok.
- Schema is at alembic head `8c1d4a7e3b52`, confirmed on the production database.
- The deployed demo tenant resets and passes verify-only: 3 accounts, 3 signals,
  2 relationships, 6 work items, 1 deliverable, 2 programs.
- Frontend deployed to Pages from `main`. The site boots with zero asset errors
  and zero page errors, and shows no em dash and no scaffolding copy.
- Deep links resolve. `/btx-cro-monitor/cockpit/accounts/demo-acct-nlight` serves
  the app shell and preserves the full path through the Clerk sign-in redirect.
- CORS allows the Pages origin. Unauthenticated API calls return 401.
- The demo HubSpot portal holds exactly three companies in the expected shape.

### Still required for GO, and it needs an operator login

The signed-in walkthrough cannot be run without Clerk credentials, so these
remain unverified rather than assumed:

1. Top bar reads AI live.
2. Lockheed shows its engine-computed score and factor breakdown on the deployed
   site, and the evidence drawer shows sources.
3. A work item creates a real HubSpot task with preview, confirm, real id, and
   verification, landing on company `336059557613`.
4. nLIGHT shows insufficient data with all four named gaps.
5. Pulse Space reads as surfaced but deliberately not actioned.
6. Ask returns a live grounded answer with citations across both accounts.
7. The four surfaces audited for loading, empty, stale, and failure states.

### Release checks before recording

- `cd frontend && npm run test:release-critical`
- `python3 -m pytest -q`
- `python3 tooling/verify_deployment_parity.py --api-url https://btx-platform.fly.dev`

The Clerk development instance (`unbiased-gecko-3.accounts.dev`) renders a
"Development mode" badge on the sign-in screen. Sign in before recording, or
move the target deployment to a production Clerk instance.

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
