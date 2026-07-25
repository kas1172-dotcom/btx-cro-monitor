# Demo Product Implementation Plan

This ledger coordinates the executive-demo readiness work. It is a planning record, not a second source of product truth.

## Starting State

- Branch: `main`
- Starting commit: `203c454 Document approved HubSpot task workflow`
- Local/remote: `main` matches `origin/main`
- Worktree: clean before this phase
- Coordination mode: sequential, because the first milestone touches shared shell, navigation, presentation contracts, and styles.

## Workstreams

| Workstream | Process | Files expected to change | Shared dependencies | Status | Validation | Commit |
| --- | --- | --- | --- | --- | --- | --- |
| 0 Audit and shared contracts | Main process | `docs/UX_AUDIT_AND_DEMO_READINESS.md`, `frontend/src/app/presentation.ts` | Backend world snapshot, work-item lifecycle | Complete in checkpoint 1 | `git diff --check`; frontend checks listed below | `5074d29` |
| 1 Cockpit foundation | Main process | `App.tsx`, `BrainSidebar.tsx`, `styles.css`, command palette | Shared presentation helpers | Complete in checkpoint 1 | frontend checks listed below | `5074d29` |
| 2 Executive surfaces | Main process | Today, Account 360, Work Queue, Map/Prospecting as scoped | Foundation components | Initial Today, Account 360, and Work Detail pass complete; evidence drawer, timeline, action dock, map/prospecting polish remain | frontend checks listed below | `5074d29` partial |
| 3 Demo workspace | Main process | `tooling/reset_demo_tenant.py`, backend seed fixtures/tests/docs | Existing backend schemas | Pending | Pending | Pending |
| 4 Assistant | Main process | Ask/assistant modules, backend conversation models/routes/tests | Backend authoritative retrieval | Pending | Pending | Pending |
| 5 Briefing/focus/deliverable | Main process | Deliverable templates, modes, runbook | Shared shell and route state | Pending | Pending | Pending |
| 6 Final hardening | Main process | QA docs, visual/mobile fixes | All prior work | Pending | Pending | Pending |

## Protected Files

No files are edited concurrently in this environment. Shared files are sequenced in this order:

1. Documentation and presentation contracts
2. Primitives and styles
3. App shell and navigation
4. Core surfaces
5. Tests and docs

## Integration Order

1. Establish plain-language presentation contracts.
2. Wire command frame, palette, and context ribbon to backend world state.
3. Refine the primary demo path: Today -> Account -> Work -> Ask -> Deliverable.
4. Add deterministic demo reset and persistent assistant after the visual foundation is stable.

## Checkpoint 1 Validation

- `git diff --check` passed.
- `cd frontend && npm run typecheck` passed.
- `cd frontend && npm run test:routing` passed.
- `cd frontend && npm run test:architecture` passed.
- `cd frontend && npm run check:design` passed.
- `cd frontend && npm run check:voice` passed.
- `cd frontend && npm run test:flows` passed.
- `cd frontend && npm run test:metrics` passed.
- `cd frontend && npm run test:wizard` passed.
- `cd frontend && npm run test:mobile` passed and produced screenshots in `/tmp/btx-mobile-smoke`.
- `cd frontend && npm run test:deliverables` passed with the existing Node localStorage experimental warning.
- `cd frontend && npm run test:map` passed.
- `cd frontend && npm run build` passed.
- `cd frontend && npm audit --audit-level=moderate` passed with `0 vulnerabilities`.
