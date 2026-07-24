# Canonical Identity And Scoring

This is the current integrity model for the BTX Revenue Cockpit demo.

## Canonical Accounts

The backend owns account identity. HubSpot company IDs, domains, legal names, CAGE codes, UEIs, and public recipient IDs are identifiers attached to a tenant-scoped canonical account. They are not the account's primary identity.

Core records:

- `canonical_accounts`: stable account row with legal name, display name, account type, parent account, public IDs, and known program context.
- `account_identifiers`: tenant-scoped identifiers with normalized values, source classification, and verification state.

The cockpit should read canonical IDs from `/world-snapshot`. It should not invent account IDs in the browser.

## Signal Relationships

Monitor signals become durable `intelligence_signals`. A signal only counts as account-specific when it has a confirmed `signal_account_relationship`.

Confirmed account signal rule:

- Signal scope is `specific_account`.
- Relationship review status is `confirmed`.
- Relationship confidence is at least `0.80`.
- Relationship has supporting evidence IDs.
- Relationship account ID matches the signal subject account ID.

Exact legal name, verified domain, HubSpot ID, CAGE, UEI, and public recipient matches can auto-confirm. Alias or ambiguous matches are held for review.

Review records are exposed in `/signal-relationships/review` and mirrored into `relationship_review` work items so the operator can confirm, reject, reopen, or mark the signal as market/program-level.

## Score Families

The backend emits six deterministic score families in `/world-snapshot.scores`:

- Account attractiveness
- Signal confidence
- Pursuit / PWIN
- Delivery feasibility
- Relationship health
- Action priority

Each score snapshot includes the score, status, data completeness, missing inputs, hard gate failures, factor contributions, and scoring configuration version.

Important behavior:

- Unknown data stays unknown. The backend returns `insufficient_data` instead of guessing.
- Operating inputs such as capacity, delivery schedule, margin, and relationship sentiment are not fabricated.
- Repeated score runs are persisted as `score_snapshots` so history can be displayed and audited.

## UI Contract

Frontend surfaces should use backend-authoritative payloads:

- Account 360 shows five account score families and explains missing inputs.
- Today prioritizes backend work items, then highest-confidence signals.
- Map markers scale by backend account attractiveness when available.
- Linked account signals require confirmed relationships.
- Work Queue uses the lifecycle: detected, triaged, prepared, awaiting approval, approved, in progress, executed, verified, outcome recorded, closed, dismissed.

Legacy browser-side scoring can still support tests and local empty-state tooling, but it must not override backend score snapshots in the live cockpit.

