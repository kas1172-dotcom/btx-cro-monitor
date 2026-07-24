# Fixture Data

Static JSON snapshots under `frontend/data/demo/btx/` are retained for tests, local scaffolding, and fixture-based regression scripts. They are not a production runtime data path.

## Simulated Fixture Data

These files represent customer-private systems and are simulated for tests:

- `companies.json`: account and relationship records shaped like CRM accounts.
- `contacts.json`: buyer and influencer contacts shaped like CRM contact records.
- `opportunities.json`: opportunity records shaped like Salesforce-style deals.
- `facilities.json`: plant and headquarters records shaped like ERP/site master data.
- `crm.json`: focused CRM account-health snapshot for demo workflows.
- `erp_capacity.json`: capacity and shop-floor availability snapshot.
- `pipeline.json`: CRO-facing pipeline summary and next-best actions.
- `assumptions.json`: explicit modeling assumptions for the demo.

These records should include provenance fields where appropriate:

```json
{
  "source_type": "demo",
  "source_name": "Simulated Salesforce",
  "source_mode": "static_snapshot"
}
```

In production, the same shape can be populated by live authenticated adapters:

```json
{
  "source_type": "api",
  "source_name": "Salesforce",
  "source_mode": "live"
}
```

## Public Or Monitor-Derived Fixtures

`signals.json`, `news.json`, and `extracted-signals.json` are static snapshots for regression tests. Production market signals should come from backend-read monitor artifacts and carry provenance such as `source_type: "public"` or `source_type: "artifact"`.

## Rules For Fixtures

Keep fake numbers in data files, not React components. Components should render data, scoring output, and recommendations from the adapter contract.

Structure demo files as arrays or small objects that mirror likely API payloads. Prefer fields that could survive a future API mapping, such as IDs, account IDs, opportunity stages, capacity units, timestamps, status, and provenance.

Do not add more data than the tests need. The current snapshots should support workflows such as:

- "I'm in Austin. Who should I talk to?"
- "What changed this week?"
- "Why is this account ranked #1?"
- "Which opportunity should BTX act on now?"

Production runtime code should use the backend `WorldSnapshot` client, not `DemoDataAdapter`.
