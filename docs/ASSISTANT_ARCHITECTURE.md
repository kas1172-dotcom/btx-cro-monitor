# Assistant Architecture

## Identity

The user-facing assistant is **Ask**. Legacy names such as ChatPill, Jarvis, and Copilot are not production-visible entry points.

## Persistence

Ask stores conversations in `assistant_conversations` and transcript rows in `assistant_messages`.

Conversation rows contain tenant id, title, active/archived status, route context, related account/program/work/signal/deliverable ids, timestamps, and creator user id.

Message rows contain only user-visible content, status, tool activity labels, citations, related records, and optional draft previews. They do not store hidden reasoning, model prompts, credentials, or chain-of-thought fields.

## Backend Flow

The canonical path is:

```text
Ask UI -> /assistant/ask -> btx_platform.assistant.persist_turn
        -> internal retrieval tools
        -> persisted user message + persisted assistant message
        -> conversation response with citations and previews
```

The compatibility route `/assistant/ask` creates a conversation when one is not supplied. Conversation management also supports:

- `GET /assistant/conversations`
- `POST /assistant/conversations`
- `GET /assistant/conversations/{id}`
- `PATCH /assistant/conversations/{id}`
- `POST /assistant/conversations/{id}/messages`

## Internal Tools

Ask retrieves only tenant-scoped backend records:

- canonical accounts
- confirmed signal-account relationships
- pending relationships as review items, not facts
- program metadata
- score snapshots
- work items
- deliverables
- source-health metadata

No live internet search, external web citations, email/calendar execution, or multi-agent orchestration is implemented in this milestone.

## Grounding

Citations use one shared shape:

- source type
- record id
- title
- route
- claim
- claim classification
- data classification
- relationship status when relevant

Claim classifications are `fact`, `derived`, `inference`, `missing`, and `simulation`.

Account answers use confirmed relationships as account facts. Pending relationships stay labeled as needing review. Scores cite persisted `score_snapshots`; missing scores are described as unavailable, not zero.

## Drafts

Ask may return previews for:

- work-item drafts that create through `POST /work-items`
- executive account and meeting brief drafts that create through `POST /deliverables`

The UI requires explicit confirmation before creating either record. Created records enter the normal backend lifecycle and the UI refreshes shared backend state.

## Permissions

Viewer users may ask read-only questions and create conversation/message rows. Work-item and deliverable creation still use existing protected backend routes and require the roles those routes require.

Tenant ids from the browser are ignored. Tenant scope comes from Clerk-authenticated request context.

## Demo Seed

The demonstration tenant seeds one active account conversation and one archived conversation. Seeded assistant messages include citations and contain no hidden reasoning.
