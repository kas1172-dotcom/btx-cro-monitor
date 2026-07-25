# Work Item Lifecycle

The Work Queue is the cockpit's operational system of record. A recommendation is not complete when it is generated; it must move through backend-approved lifecycle commands.

## Standard Flow

```text
Detected
-> Triaged
-> Prepared
-> Awaiting approval
-> Approved
-> In progress
-> Executed
-> Verified
-> Outcome recorded
-> Closed
```

## Exceptions

- `dismissed`: allowed from active states only with a reason.
- `rejected`: represented by `approval_state=rejected`; the item returns to `prepared`.
- `failed`: represented by `execution_state=failed`; the item remains non-complete and can be retried where idempotency makes retry safe.
- `reopen`: allowed from `dismissed` or `closed` by CRO/admin, returning the item to `triaged`.

## Approval, Execution, Verification

Approval, execution, and verification are separate.

- Approval means a CRO/admin has approved the action.
- Execution means work was attempted or created externally.
- Verification means the backend checked the external result, such as reading a HubSpot task back after creation.

The UI must not label execution as completion before verification succeeds.

## Metadata

Owner, priority, due date, follow-up date, description, and recommended action are metadata updates. They are audited, but they do not change lifecycle state.

## Notes

Notes and findings are durable backend rows. They are append-only in the current product; editing/deletion is intentionally not exposed until audited edit semantics exist.

## Duplicate Prevention

System-generated work should provide a stable `dedupe_key`. The backend returns an existing active item with the same key instead of creating duplicates. Closed or dismissed items do not silently reopen.
