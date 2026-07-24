# Work Items API

The cockpit work loop is backed by durable `work_items` stored in the BTX backend database. All routes below use the existing backend bearer-auth boundary.

## Model

`WorkItem`

- `id`: server-assigned id
- `type`: `account_action`, `research_task`, `customer_question`, `capacity_check`, `meeting_brief`, `outreach_draft`, `qualified_opportunity`, `relationship_review`, `dismissal`, or `dismissed`
- `canonical_account_id`: stable account id, when account-scoped
- `related_signal_id`: primary signal that caused the item
- `related_relationship_id`: signal-account relationship record, usually for review work
- `related_opportunity_id`: opportunity/deal record, when opportunity-scoped
- `program_id`: program context, when program-scoped
- `score_snapshot_ids`: score snapshots used to justify the recommendation
- `source_signal_ids`: monitor or analysis signal ids that caused the item
- `supporting_evidence`: structured evidence snippets, source IDs, or relationship evidence
- `missing_information`: open data required before execution
- `dedupe_key`: stable duplicate-prevention key
- `owner`: assigned user/team
- `priority`: `low`, `normal`, `high`, or `urgent`
- `status`: `detected`, `triaged`, `prepared`, `awaiting_approval`, `approved`, `in_progress`, `executed`, `verified`, `outcome_recorded`, `closed`, or `dismissed`
- `due_date`: ISO date/datetime
- `recommended_action`: human-readable next action
- `generated_artifact_ref`: reference to a generated brief/draft/deck
- `approval_state`: `not_required`, `pending`, `approved`, or `rejected`
- `execution_state`: `not_started`, `queued`, `running`, `completed`, or `failed`
- `outcome`: completion result, or dismissal reason
- `follow_up_date`: ISO date/datetime
- `external_system`: external system that fulfilled the work, currently `hubspot`
- `external_record_id`: verified external object id
- `external_record_url`: URL to open the verified external object
- `execution_idempotency_key`: idempotency key that produced the external object
- `execution_error`: last real execution error, if any
- `audit_history`: append-only list of `{ timestamp, actor, action, before, after }`

Current status transitions are:

`detected -> triaged -> prepared -> awaiting_approval -> approved -> in_progress -> executed -> verified -> outcome_recorded -> closed`

Any non-terminal state can transition to `dismissed` or `closed` where the backend transition table allows it. A dismissed item must record a reason in `outcome`; the `/dismiss` route enforces this. The legacy `proposed` and `done` statuses remain accepted for older clients and tests, but the cockpit UI uses the lifecycle above.

## Endpoints

`POST /work-items`

Creates a work item from a signal, insight, or generated recommendation. The server assigns `id` and writes the first audit entry.

`GET /work-items`

Filters:

- `account=<canonical_account_id>`
- `status=<status>`
- `owner=<owner>`
- `due_from=<ISO date/datetime>`
- `due_to=<ISO date/datetime>`
- `view=what_changed|needs_attention|prepared|needs_approval|outcomes`

Derived views:

- `what_changed`: items updated in the last seven days
- `needs_attention`: high/urgent or overdue non-terminal items
- `prepared`: items with `generated_artifact_ref`
- `needs_approval`: `approval_state=pending`
- `outcomes`: terminal work, currently `done`, `dismissed`, `closed`, `verified`, or `outcome_recorded`

`PATCH /work-items/{id}`

Updates owner, priority, status, outcome, due/follow-up dates, artifact ref, approval state, or execution state. Each mutation appends an audit entry with full before/after snapshots.

`POST /work-items/{id}/dismiss`

Body: `{ "reason": "..." }`

Dismisses the item, records the reason as `outcome`, marks execution completed, and appends an audit entry.

`POST /work-items/{id}/execute/hubspot-task`

Executes the one supported real action. Requires `confirmed=true` and uses `X-Idempotency-Key` to prevent duplicate HubSpot tasks.

Body:

```json
{
  "confirmed": true,
  "task_text": "Call Acme about the verified signal",
  "body": "Optional task body override",
  "evidence": "Optional evidence summary",
  "relationship_record": {
    "match_method": "exact_domain",
    "confidence": 0.96
  },
  "company_id": "hubspot-company-10",
  "contact_id": "hubspot-contact-20",
  "deal_id": "hubspot-deal-30",
  "owner_id": "12345",
  "due_at": "2026-07-20T15:00:00Z"
}
```

Response:

```json
{
  "status": "verified",
  "duplicate": false,
  "idempotency_key": "work-item-123",
  "work_item": {},
  "hubspot_task": {
    "id": "987654321",
    "record_url": "https://app.hubspot.com/tasks/987654321",
    "verified": true
  }
}
```

Failure behavior:

- missing confirmation returns `422 confirmation_required`
- missing HubSpot token returns `501 not_configured`
- HubSpot write/read/verify errors return `502 hubspot_error`
- failed execution leaves the work item not done, sets `execution_state=failed`, stores `execution_error`, and appends an audit entry
- retrying with the same idempotency key after success returns the same verified task with `duplicate=true`

## Relationship Review

`GET /signal-relationships/review`

Returns candidate signal-account links that need a human decision.

`PATCH /signal-relationships/{relationship_id}`

Body:

```json
{
  "action": "confirm",
  "note": "Exact legal-name evidence verified."
}
```

Allowed actions are `confirm`, `reject`, `reopen`, `mark_market`, and `mark_program`. Confirmed relationships need supporting evidence and are raised to the minimum confidence threshold before they can affect account-specific signal views or scores.

## Deferred Manual Verification

After the map/live-join branch is merged and deployed, run this cockpit check:

1. Load the map. Confirm pins render, account-attractiveness pins scale correctly, and the map is not blank or collapsed.
2. Load the cockpit against a live backend in `hybrid` mode once browser-safe CRM auth exists.
3. Confirm live CRM accounts plot.
4. Confirm linked monitor signals attach only to the correct canonical accounts.
5. Confirm unlinked monitor signals remain market/portfolio scope and do not affect account scores.
