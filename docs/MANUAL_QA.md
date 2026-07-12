# Manual QA Checklist

Use this checklist for UI behaviors that are not covered by the deterministic TypeScript regression tests.

- Navigation: exactly one Home icon appears in the rail; clicking the brand title returns to Home.
- Nav sweep at 1280px desktop: click Core (Today's Brief, Work Queue, Accounts, Ask), Analytical (Map, Analysis, Capacity, Programs), and Utility (Settings). Screenshot each and confirm every surface renders its distinct component.
- Mobile sweep at 390px and 414px: verify the rail is a bottom touch tab bar, Core surfaces open as full-screen views, Ask reads like a chat surface, Account 360 scrolls without horizontal overflow, and the right context/dossier panels open as sheets.
- Mobile map sweep at 390px and 414px: open Map, rotate or resize, and confirm tiles/markers redraw rather than appearing blank. The automated smoke writes reference screenshots to `/tmp/btx-mobile-smoke/cockpit-390.png`, `/tmp/btx-mobile-smoke/cockpit-414.png`, and `/tmp/btx-mobile-smoke/cockpit-1280.png`.
- Ask chips: chips work from Home, responses, deliverables, and every workspace tab.
- Parameter chips: Meeting brief shows account select; Plan a trip shows city and date range; Board deck shows quarter; Analysis view shows metric preset; Escape closes the popover.
- Dossier: X closes the dossier, clicking the backdrop closes it, and Escape closes only the dossier without changing the active tab or response.
- Deliverable actions: Send and Create task modals open, Confirm closes them, and Cancel closes them from every deliverable type.
- Board deck and Analysis view chips generate/open the expected artifacts from Home.
- Today chips route to the expected account, signal, or risk context.
- Market dropdown changes recompute chips, tabs, and map/list contents.
- Map: pins have compact markers, names appear only on hover/click, labels do not clip at map bounds, and itinerary labels do not show duplicated numbering.
- Browser Back: verify the browser does not leave the app in a stale dossier or modal state.
- Resize: verify 1512px wide, 1280px wide, and 1024x768 tablet landscape have no horizontal scroll, no overlapping panels, and readable tables. Open a dossier at each width and confirm it sits below the topbar with no content clipping.
- Resize: verify below 900px shows the desktop-focused mobile companion message rather than a broken app layout.
- FAB/Chatpil: open a dossier or context panel, confirm the Chatpil FAB shifts left so it does not cover the right panel; close the panel and confirm the FAB returns to the right edge.
- Param popup: open "Plan a trip", confirm skeleton loading bars from a prior request are not visible behind the popup; confirm the × close button is at least 32×32px and clearly visible.
- Overflow auditor (DEV only): in the browser console run `window.__btxAudit?.()` after navigating to each tab. No red warnings should appear. If any appear, record the selector and report.
- Width sweep: at 1512, 1280, and 1024px — verify no column is squished to zero, no button label is cut mid-word, no table overflows its container, and no rail badge overlaps the nav icon.

## Artifact mode smoke test

Artifact mode uses Vite-bundled JSON imports from `clients/btx/artifacts/run_output.json` and `archive.json`. This works on GitHub Pages because the artifacts are compiled into the static JS bundle; there is no backend route or absolute asset path to configure.

1. Start the frontend with `VITE_DATA_MODE=artifact npm run dev` or build with `VITE_DATA_MODE=artifact npm run build`.
2. Confirm the topbar shows "Monitor run" with the artifact run timestamp. If the run is older than 7 days, confirm the visible "stale data" state appears.
3. Open Signals. Confirm rows show real source names/dates such as `SpaceNews` or `Federal Register`, and CRM/capacity/pipeline panes still identify simulated operating data.
4. Generate a meeting brief from an account with a signal. In "Live Signals", confirm the evidence includes a real source/date citation inline.
5. Temporarily break the artifact JSON shape in a local throwaway copy, rebuild, and confirm artifact mode falls back to demo signals with a visible "Artifact fallback" notice. Restore the artifact before committing.

## Backend live-mode Settings smoke test

1. Start `btx_platform` with `BTX_BACKEND_AUTH_TOKEN`, `BTX_ANTHROPIC_API_KEY`, and either `BTX_PIPELINE_MECHANISM=subprocess` locally or `github` in production.
2. Start the frontend with `VITE_BACKEND_ENDPOINT`, `VITE_COPILOT_ENDPOINT=<backend>/llm`, and `VITE_DATA_MODE=live`. The browser build must not hold a shared backend bearer token; protected backend-route QA waits for WP10 browser-safe auth or should use direct backend curl checks.
3. Open Settings → Engine tuning. Confirm the panel shows `Backend scoring_weights`, a version number, and editable scoring rows. Change one weight, save, and confirm the version/status updates.
4. Open Settings → Sources. Toggle a source, save, reload, and confirm the saved enabled state returns from the backend.
5. Click `Run collection now`. Confirm the button reports the run status, recent runs populate, and a second click inside the rate-limit window is refused with a visible message.
6. Ask Chatpil a simple question while pointed at `/llm`. Confirm the LIVE badge recovers and no local `copilot-proxy.mjs` process is required.

## Chatpil smoke tests (run in both proxy-on and proxy-off states)

**Proxy-off (no VITE_COPILOT_ENDPOINT set):**
1. Open Chatpil. Badge shows "offline" (not "live" or "…"). Opening brief appears.
2. Ask a data question: "What's the top opportunity?" → grounded deterministic answer, no debug text, no raw JSON or "model:" string.
3. Type "open top risk account" → dossier opens for the highest-risk account; thread shows "Opened dossier for …" confirmation.
4. Ask an out-of-scope question: "What is the European churn rate?" → response mentions the data isn't available, offers what IS in context. No hallucinated numbers.
5. Suggestion chips show entity names from world data (not "BTX Precision"). Clicking a chip fires the question.

**Proxy-on (VITE_COPILOT_ENDPOINT set to running proxy):**
1. Open Chatpil. Badge shows "…" briefly then "live" after health-check completes.
2. Ask "What needs my attention today?" → LLM answer grounded in account names, scores, and recommendations; no "model:", no raw JSON. "based on:" line present.
3. Receive an OFFER button from the LLM response → clicking it either opens a dossier or drafts an outreach; a confirmation message follows in the thread.
4. After proxy is stopped (kill the process mid-session): ask another question → falls back to deterministic answer + one offline note. Badge flips to "offline". The thread shows no debug text.
5. Restart the proxy → on the next question the health-check recovers: badge returns to "live", offline note is not repeated.
