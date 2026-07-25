# Deliverables API

Deliverables are backend-owned saved documents used by the cockpit and the Ask draft workflow.

## Model

`Deliverable` includes tenant id, type, title, optional account/program/trip references, optional `entity_ids`, the structured document JSON, and timestamps.

The backend generates the record id. The frontend may preserve its own document id inside the document body, but the backend id is the canonical route id.

## Endpoints

- `POST /deliverables`
- `GET /deliverables`
- `GET /deliverables/{id}`
- `PATCH /deliverables/{id}`

List filters include `account` and `type`. Cross-tenant reads and updates return 404.

## Ask Drafts

Ask can prepare an executive account and meeting brief preview using only supported internal records:

- purpose
- executive summary
- why the account matters
- confirmed developments
- relevant programs
- score summary
- missing information
- talking points or next actions
- open work
- internal citations
- source freshness
- data classifications

The preview is not persisted until the user confirms. Confirmation calls `POST /deliverables`, then the UI refreshes shared backend state and returns a route to the created deliverable.

Ask must not include unconfirmed relationships as facts, unsupported opportunity values, invented capacity, or external web claims.
