# BTX Revenue Brain Demo Script

## Preflight

1. Open the public cockpit: `https://kas1172-dotcom.github.io/btx-cro-monitor/cockpit/`.
2. Sign in through Clerk and confirm the top bar shows your Clerk email.
3. Confirm the top bar shows live source status and no raw fetch error.
4. Use the Actions tab only if a fresh deploy is needed. For normal recording, start in the cockpit.

## Journey 1: Lockheed Call Prep From A Signal

1. Start on Brief.
   Narration: "The day starts from live CRM plus monitor artifacts, so BTX sees account work and public market changes together."
2. Open the Lockheed F-35 signal.
   Narration: "This signal is pinned for the demo, but it is still a real source with a real URL and canonical account resolution."
3. In the signal card, point out the solid account link and source evidence.
   Narration: "Lockheed resolves through the live account and verified identifiers, including CAGE 81755 and the F-35 program."
4. Click Create call prep.
   Narration: "The system turns the signal and account context into a meeting brief using the existing deliverable engine."
5. Review the meeting brief.
   Narration: "The brief stays grounded in account context, source evidence, and explicit provenance."
6. Go to Work Queue.
   Narration: "The brief also creates a durable work item for the Lockheed call."
7. Click Create HubSpot task on the Lockheed work item, review the preview, then confirm.
   Narration: "The final step writes a real HubSpot task against the test portal and verifies the task id."

## Journey 2: Saronic Prospect From A Public Signal

1. Return to Brief or Signal Inbox and open the Saronic signal.
   Narration: "This is a public prospecting signal, not an existing BTX account."
2. Point out the qualification gaps.
   Narration: "The system explains why Saronic is interesting, but it marks missing CAGE, contact, fit, and supplier evidence as unqualified."
3. Open Map.
   Narration: "Saronic appears as an Austin prospect pin because the signal supports a location hypothesis, not because it is a verified customer."
4. Return to the Saronic signal and click Create Saronic prospect.
   Narration: "Before writing to HubSpot, the cockpit previews the company fields and the unknowns left blank."
5. Confirm and create.
   Narration: "The system creates the Saronic company in HubSpot and creates two durable work items: qualify the account and draft intro outreach."
6. Go to Work Queue.
   Narration: "The queue now separates research, outreach, and execution so BTX can move from public signal to controlled follow-up."
7. Create HubSpot tasks from the Saronic work items only after reviewing the preview.
   Narration: "Every external write is confirmed before it reaches HubSpot."

## Camera-Safe Tab Sweep

1. Brief: show live mini-brief, source status, and pinned signals.
2. Work Queue: show backend work items, preview panels, and HubSpot task status.
3. Accounts: show Lockheed account context after seed.
4. Ask: ask "What should BTX do about the Lockheed F-35 signal?"
5. Prospecting: show Saronic as needs qualification and Lockheed as existing customer context.
6. Map: show the Lockheed account and Saronic Austin pin.
7. Analysis: show scored evidence and explainability.
8. Capacity: show a clean capacity state.
9. Programs: show F-35 and contract-related signals.
10. Deliverable Editor: open the generated Lockheed meeting brief.
11. Settings: show integration and health status if needed.

## Between-Takes Reset

Journey 2 creates live HubSpot records. Before re-recording Journey 2, the operator should delete or archive:

1. The Saronic Technologies company created during the take.
2. Any Saronic contacts, if added later.
3. HubSpot tasks created from the Saronic work items.
4. The Saronic work items in the backend, or mark them dismissed if preserving audit history.

Do not delete the seeded Lockheed account between takes unless you plan to rerun the cleanup and seed tools.
