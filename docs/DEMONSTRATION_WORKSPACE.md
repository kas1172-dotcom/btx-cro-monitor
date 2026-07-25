# Demonstration Workspace

## Tenant

- Tenant id: `btx-demo-command-cockpit`
- Display name: `BTX Demonstration Workspace`
- Durable marker: `tenants.is_demonstration = true`

The reset tool refuses any tenant that is missing, not marked as demonstration, or not the configured demo tenant id.

## Purpose

The workspace gives Jamie Goettler a repeatable, realistic BTX Revenue Cockpit story without introducing a frontend demo runtime or a second data path. It uses the normal backend database tables, APIs, work-item lifecycle, score snapshots, relationship review, and deliverable storage.

## Real Versus Simulated Data

Public intelligence is seeded from repository monitor-artifact metadata and retains source names, URLs, dates, and `dataClassification = "public"`.

Illustrative internal BTX records are classified as simulated. These include CRM contacts, opportunities, internal notes, manual capacity context, owners, due dates, approval actors, and local demonstration execution state.

The default reset does not call HubSpot and does not create or delete external records. A verified demo item uses `external_system = "hubspot-demo"` and includes notes explaining that it is a local illustrative record.

## Seed Contents

- 6 accounts:
  - Lockheed Martin Corporation
  - RTX Corporation
  - Northrop Grumman Corporation
  - nLIGHT, Inc.
  - Pulse Space Technologies
  - Collins Aerospace
- 3 program themes:
  - Directed-energy laser defense
  - Hypersonics production risk
  - Laser power transmission
- 7 public signals:
  - 1 confirmed Lockheed account-specific signal
  - 1 unresolved nLIGHT relationship-review signal
  - 1 program-level hypersonics signal
  - 4 market or research signals
- 6 work items:
  - Awaiting approval
  - Relationship review
  - Capacity check
  - Approved HubSpot task preview candidate
  - Verified simulated completion with outcome still needed
  - Closed item with recorded outcome
- 1 seeded deliverable:
  - `demo-deliv-lockheed-brief`

## Date Strategy

The reset generates business-relevant dates relative to reset time:

- Signals appear one to three days before reset.
- One work item is due today.
- One item is due tomorrow.
- Follow-up dates land about one week after reset.

This avoids stale screenshots while preserving a stable story sequence.

## Commands

Dry run:

```bash
python3 tooling/reset_demo_tenant.py --tenant btx-demo-command-cockpit --dry-run
```

Reset:

```bash
python3 tooling/reset_demo_tenant.py --tenant btx-demo-command-cockpit
```

Verify only:

```bash
python3 tooling/reset_demo_tenant.py --tenant btx-demo-command-cockpit --verify-only
```

The command uses `BTX_DATABASE_URL` or `DATABASE_URL` through the normal backend settings.

## Safety Controls

- Requires explicit `--tenant`.
- Checks the durable database marker.
- Refuses normal tenants.
- Refuses unknown tenants.
- Refuses any tenant id other than `btx-demo-command-cockpit`.
- Supports dry-run with zero mutations.
- Uses a transaction boundary.
- Rolls back on failure.
- Deletes/restores only rows scoped to the selected tenant.
- Does not call external integrations.

## Expected Initial State

Today should show a clear priority stack led by the Lockheed directed-energy follow-up approval. Account 360 should explain why Lockheed matters, show public source evidence, and keep missing delivery-feasibility inputs unavailable. Work Queue should include approval, relationship review, capacity check, approved, verified, and closed states.

## Integration Limitations

HubSpot execution is previewable from approved work items, but real execution remains disabled unless a sandbox HubSpot token is configured and the user has the required role. ERP/MES operating data is not connected; capacity context is illustrative and marked through the demo notice and work-item context.

## Recovery

Rerun the reset command. It is deterministic and idempotent for the configured demo tenant.
