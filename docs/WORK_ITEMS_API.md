# Work Items API

Work items are the backend-owned operational record for the cockpit. The frontend may edit metadata and request lifecycle commands, but it cannot patch authoritative lifecycle state directly.

## Lifecycle

Canonical statuses:

```text
detected -> triaged -> prepared -> awaiting_approval -> approved -> in_progress -> executed -> verified -> outcome_recorded -> closed
```

Terminal alternatives:

- `dismissed` with a required reason
- `prepared` after rejection from `awaiting_approval`
- `triaged` after authorized reopen from `dismissed` or `closed`

Legacy inbound statuses are normalized:

- `proposed` -> `detected`
- `done` -> `closed`
- `queued` / `running` -> `pending`
- `completed` -> `verified`

## Model

`WorkItem` includes:

- account/program/opportunity/relationship/signal references
- `priority` and `priority_status`
- `status`, `approval_state`, and `execution_state`
- owner, due date, follow-up date, description, and recommended action
- outcome, outcome category, rejection reason, and dismissal reason
- external system reference fields for verified actions
- `allowed_actions`, computed by the backend for the caller role
- append-only `audit_history`
- durable `notes`

## Endpoints

`POST /work-items`

Creates a durable item. If `dedupe_key` matches an active item for the tenant, the existing active item is returned instead of creating a duplicate.

`GET /work-items`

Filters:

- `status`
- `type`
- `owner`, including `owner=unassigned`
- `account`
- `program`
- `priority`
- `approval`
- `execution`
- `overdue=true`
- `view=what_changed|needs_attention|prepared|needs_approval|outcomes`
- `sort=updated|priority|due_date|account`

`GET /work-items/{id}`

Returns the complete work item, allowed actions, notes, audit history, and external references. Cross-tenant access returns 404.

`PATCH /work-items/{id}`

Metadata only. Allowed fields are owner, priority, due date, follow-up date, description, recommended action, and generated artifact reference. Lifecycle fields are rejected.

`POST /work-items/{id}/transition`

Body:

```json
{
  "action": "request_approval",
  "note": "Ready for CRO review",
  "reason": "Required for reject/dismiss",
  "outcome": "Required for record_outcome",
  "outcome_category": "meeting_booked",
  "follow_up_date": "2026-07-31"
}
```

Invalid transitions return `409 invalid_transition` with `allowed_actions`. Missing reasons/outcomes return `422 validation_error`. Viewer users cannot mutate; approval, rejection, and reopen require CRO or admin.

`POST /work-items/{id}/notes`

Adds an append-only note or finding. Notes are tenant-scoped, include author user id, and create an audit event.

`POST /work-items/{id}/preview/hubspot-task`

Returns the exact backend-generated HubSpot task preview: account/company, owner, due date, subject, body, evidence, associations, related work item, idempotency key, integration availability, and whether this caller may execute.

`POST /work-items/{id}/execute/hubspot-task`

Requires:

- `confirmed=true`
- caller role CRO or admin
- approved work item
- configured HubSpot token
- idempotency key

The backend creates the task, reads it back, verifies expected fields, stores the external ID/URL, records audit entries, and sets `status=verified`, `execution_state=verified`. Failed verification leaves the item not complete with `execution_state=failed`.

## Audit

Audit events are append-only JSON entries containing event type, previous state, new state, actor, timestamp, note/reason, safe metadata, and before/after snapshots. Secrets and provider tokens must never be written to audit metadata.

## Roles

- Viewer: read-only.
- Analyst: triage, prepare, request approval, assign permitted work, and add notes.
- CRO: approve, reject, start approved work, dismiss with rationale, reopen, execute approved HubSpot work, and record strategic outcomes.
- Admin: all permitted actions, including repair-style reopen.

## Relationship Review

Relationship-review decisions still use `PATCH /signal-relationships/{id}`. Confirm, reject, mark market-level, or mark program-level updates the durable relationship, recalculates score inputs on the next snapshot, closes active related work items, and avoids duplicate active relationship-review tasks through the relationship work item reference.
