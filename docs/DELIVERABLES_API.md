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

- cover/header with account, meeting purpose, prepared date, data freshness, and classification
- executive summary
- account context
- recent developments
- decision summary
- meeting preparation
- current work
- sources and data notes

The preview is not persisted until the user confirms. Confirmation calls `POST /deliverables`, then the UI refreshes shared backend state and returns a route to the created deliverable.

Ask must not include unconfirmed relationships as facts, unsupported opportunity values, invented capacity, or external web claims.

Deliverable preview supports Focus mode and Briefing mode from the same document object. Source entries can open the shared Evidence Drawer; exports continue to use the existing markdown, Word, PDF-print, PowerPoint, spreadsheet, CSV, and calendar export code paths where those formats are supported for the deliverable type.
