# HubSpot Task Demo

This flow proves the cockpit can execute one real action safely: a work item creates a HubSpot task only after preview and explicit confirmation, then the backend verifies the task and records the result.

## Prerequisites

- Fly backend is deployed and healthy at `https://btx-platform.fly.dev/health`.
- `BTX_HUBSPOT_ACCESS_TOKEN` is set on Fly or locally with a HubSpot Private App token.
- Required scopes: `crm.objects.companies.read`, `crm.objects.contacts.read`, `crm.objects.deals.read`, `crm.objects.tasks.write`. Add company/contact/deal write scopes only if your rehearsal flow mutates those objects elsewhere.
- The GitHub Pages cockpit is deployed in `hybrid` or `live` data mode.
- `VITE_BACKEND_ENDPOINT` is set in the frontend deploy secrets.
- Until browser-safe backend auth lands in WP10, real task creation should be rehearsed through direct backend smoke checks. The public Pages build does not hold a shared backend bearer token.

## Demo Flow

1. Open the cockpit and go to Work Queue.
2. Create or select an `account_action` work item for a real HubSpot-backed canonical account.
3. Click `Create HubSpot task`.
4. Confirm the preview shows the exact account, owner, due date, task text, evidence, and relationship record when available.
5. Click `Confirm and create in HubSpot`.
6. The backend posts to HubSpot, reads the task back, verifies expected fields, then stores `external_record_id` and `external_record_url` on the work item.
7. The work item status becomes `done`, `execution_state=completed`, and the audit trail includes `hubspot_task_execute_started` and `hubspot_task_execute_verified`.
8. Click `Open in HubSpot` and verify the task appears in the connected portal.

Expected HubSpot task URL format:

```text
https://app.hubspot.com/tasks/<task_id>
```

## Direct Backend Rehearsal

Use a HubSpot sandbox/test portal for the first live write.

```bash
BASE=https://btx-platform.fly.dev
TOKEN=<BTX_BACKEND_AUTH_TOKEN>

WORK_ITEM_ID=$(curl -s "$BASE/work-items" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "type":"account_action",
    "canonical_account_id":"hubspot-company-<company_id>",
    "source_signal_ids":["manual-rehearsal"],
    "owner":"<hubspot_owner_id>",
    "priority":"high",
    "status":"proposed",
    "approval_state":"pending",
    "due_date":"2026-07-20T15:00:00Z",
    "recommended_action":"Rehearsal: create BTX HubSpot task from a verified work item",
    "generated_artifact_ref":"manual rehearsal evidence"
  }' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')

curl -s "$BASE/work-items/$WORK_ITEM_ID/execute/hubspot-task" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -H "X-Idempotency-Key: rehearsal-$WORK_ITEM_ID" \
  -d '{
    "confirmed": true,
    "relationship_record": {
      "match_method": "manual",
      "confidence": 1,
      "evidence": "Same-day sandbox rehearsal"
    }
  }'
```

Retry the exact same `curl` with the same `X-Idempotency-Key`; it should return the same HubSpot task instead of creating a duplicate.

## Same-Day Rehearsal

Before any live demo, run this once the same day with a non-critical HubSpot company. Confirm the task appears in HubSpot, then complete, archive, or delete the rehearsal task so the portal stays clean.

Email and calendar actions should follow this same preview -> confirm -> execute -> verify pattern later; they are intentionally out of scope for WP8.
