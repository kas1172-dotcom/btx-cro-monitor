# Routing And State

The cockpit uses URL routes as the source of truth for the active workspace and full-page account selection.

## Routes

- `/today`
- `/work`
- `/work/:workItemId`
- `/accounts`
- `/accounts/:accountId`
- `/programs`
- `/programs/:programId`
- `/prospecting`
- `/capacity`
- `/analysis`
- `/map`
- `/ask`
- `/ask/:conversationId`
- `/deliverables`
- `/deliverables/:deliverableId`
- `/integrations`
- `/settings`

Query parameters carry filters and lightweight selections, for example `/map?account=<accountId>`, `/work?status=awaiting_approval`, `/work?overdue=true`, or `/work?type=relationship_review`.

Ask context may use `/ask?account=<accountId>`, `/ask?work=<workItemId>`, `/ask?signal=<signalId>`, `/ask?deliverable=<deliverableId>`, or `/ask?prompt=<encodedPrompt>`. After a message is sent, the route resolves to `/ask/:conversationId`.

## Selected Account

The full account page is `/accounts/:accountId`. Account 360 reads that ID from the route and shows an honest not-found state when the backend world snapshot does not contain the account.

Preview surfaces such as Map may use query-selected accounts. The dossier remains a preview panel and should not maintain a separate default account.

## Server State

Shared backend reads go through `serverState.ts`. Query keys include resource identity and configuration version where relevant. The current implementation deduplicates identical requests, preserves the last successful state during refresh, and distinguishes loading, refreshing, stale, success, and error.

The backend remains authoritative for accounts, scores, work items, deliverables, relationships, source health, and Ask conversations.

Work-item mutations invalidate the shared work-item collections, individual work-item detail records, and the backend world snapshot query. The route and filter query string are preserved while the updated backend state is fetched.
