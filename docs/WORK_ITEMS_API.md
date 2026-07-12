# Work Items API

The cockpit work loop is backed by durable `work_items` stored in the BTX backend database. All routes below use the existing backend bearer-auth boundary.

## Model

`WorkItem`

- `id`: server-assigned id
- `type`: `account_action`, `research_task`, `customer_question`, `capacity_check`, `meeting_brief`, `outreach_draft`, `qualified_opportunity`, or `dismissed`
- `canonical_account_id`: stable account id, when account-scoped
- `source_signal_ids`: monitor or analysis signal ids that caused the item
- `owner`: assigned user/team
- `priority`: `low`, `normal`, `high`, or `urgent`
- `status`: `proposed`, `approved`, `in_progress`, `done`, or `dismissed`
- `due_date`: ISO date/datetime
- `recommended_action`: human-readable next action
- `generated_artifact_ref`: reference to a generated brief/draft/deck
- `approval_state`: `not_required`, `pending`, `approved`, or `rejected`
- `execution_state`: `not_started`, `queued`, `running`, `completed`, or `failed`
- `outcome`: completion result, or dismissal reason
- `follow_up_date`: ISO date/datetime
- `audit_history`: append-only list of `{ timestamp, actor, action, before, after }`

Status transitions are:

`proposed -> approved -> in_progress -> done`

Any non-terminal state can transition to `dismissed`. A dismissed item must record a reason in `outcome`; the `/dismiss` route enforces this.

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
- `outcomes`: recently terminal work, currently `done` or `dismissed`

`PATCH /work-items/{id}`

Updates owner, priority, status, outcome, due/follow-up dates, artifact ref, approval state, or execution state. Each mutation appends an audit entry with full before/after snapshots.

`POST /work-items/{id}/dismiss`

Body: `{ "reason": "..." }`

Dismisses the item, records the reason as `outcome`, marks execution completed, and appends an audit entry.

## Deferred Manual Verification

After the map/live-join branch is merged and deployed, run this cockpit check:

1. Load the map in `demo` mode. Confirm pins render, high-opportunity pins glow larger, and the map is not blank or collapsed.
2. Load the cockpit against a live backend in `hybrid` mode once browser-safe CRM auth exists.
3. Confirm live CRM accounts plot.
4. Confirm linked monitor signals attach only to the correct canonical accounts.
5. Confirm unlinked monitor signals remain market/portfolio scope and do not affect account scores.
