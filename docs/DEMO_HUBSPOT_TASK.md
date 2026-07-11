# HubSpot Task Demo

This flow proves the cockpit can write one real action back to the connected HubSpot portal.

## Prerequisites

- Fly backend is deployed and healthy at `https://btx-platform.fly.dev/health`.
- `BTX_HUBSPOT_ACCESS_TOKEN` is set on Fly with CRM task write scope.
- The GitHub Pages cockpit is deployed in `hybrid` or `live` data mode.
- `VITE_BACKEND_ENDPOINT` is set in the frontend deploy secrets.
- Until browser-safe backend auth lands in WP10, real task creation should be rehearsed through direct backend smoke checks. The public Pages build does not hold a shared backend bearer token.

## Demo Flow

1. Open the cockpit on GitHub Pages and unlock it.
2. Use a real HubSpot company in the cockpit.
3. Generate or open a deliverable for that company, such as a meeting brief.
4. Click `Create task` in the deliverable header.
5. Confirm the dialog shows:
   - task subject,
   - body preview,
   - target company,
   - target contact or deal when available.
6. Click `Confirm`.
7. The success state should show `Open in HubSpot`.
8. Click the link and verify the task appears in the connected HubSpot portal.

Expected HubSpot task URL format:

```text
https://app.hubspot.com/tasks/<task_id>
```

## Same-Day Rehearsal

Before any live demo, run this once the same day with a non-critical HubSpot company. Confirm the task appears in HubSpot, then complete, archive, or delete the rehearsal task so the portal stays clean.
