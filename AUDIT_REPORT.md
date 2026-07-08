# BTX CRO Product — Read-Only Audit Report

Audit date: 2026-07-07. Branch: `brain-v2`. Auditor scope: verify which planned
work has actually landed in code (behavior verified, not docs/comments), with
file-path evidence. Facts only; no recommendations.

---

## Verification runs (exact results)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` (frontend) | **PASS** — clean, no output. |
| Build | `npm run build` (frontend) | **PASS** — 270 modules, built in ~3.3s. Only warning: index chunk 2.22 MB > 500 kB (chunk-size advisory, not an error). |
| test:metrics | `npm run test:metrics` | **PASS** — "14 metrics, 4 chart specs; 3 heatmap cells, deck==catalog==heatmap, YoY spot-check, 14 metric range checks". |
| test:rail | `npm run test:rail` | **PASS** — "home:home, market:rail-signals, customer:rail-accounts, capability:rail-capability, revenue:rail-revenue, geographic:map-exception, decision:rail-memory, workflow:rail-actions". |
| test:settings | `npm run test:settings` | **PASS** — "General & history · Engine tuning · Prompts & rubrics · Connections". |
| test:flows | `npm run test:flows` | **FAIL (runtime)** — `TypeError: Cannot read properties of undefined (reading 'VITE_MODEL_CHATPIL')` at [llmConfig.ts:6](frontend/src/app/llmConfig.ts#L6). `import.meta.env` is undefined under `tsx`/Node (only defined under Vite). Test aborts before assertions run. |
| test:tour | `npm run test:tour` | **FAIL (runtime)** — identical `import.meta.env` crash at [llmConfig.ts:6](frontend/src/app/llmConfig.ts#L6). |
| pytest | `python3 -m pytest -q` (repo root) | **PASS** — 412 passed, 1 warning (Starlette httpx deprecation). |

Note: `package.json` also defines `test:flows`/`test:tour`; both are broken by the
same `import.meta.env` access in `llmConfig.ts` (imported transitively by
`llmRouter.ts` → `brainEngine.ts` → the flow/tour tools). The tour/flow *logic*
is real code; the *test harness entry* cannot boot.

---

## A. Core product

### A1 Quiet cockpit Home — **DONE**
[BrainHome.tsx](frontend/src/ui/brain/BrainHome.tsx): welcome line
("Welcome to Chatpil, your personal assistant", L64); Today strip with 3 computed
chips — Top signal / Top opportunity / Top risk, each derived from
`world.analysis` (L24-37) and each wired to an action (`ask(...)` or open dossier,
L66-77); centered ask bar passed in as `askBar` (App renders `<AskBrainBar large>`);
recent-activity line (L80-82); Library ("Library" head + 6 samples, L83-96);
"Demo tour" button (`onClick={requestTour}`, L86). Action chips live in
[AskBrainBar.tsx](frontend/src/ui/brain/AskBrainBar.tsx#L177-181) (8 actions).

### A2 Labeled rail — **DONE**
[BrainSidebar.tsx](frontend/src/ui/brain/BrainSidebar.tsx): each button renders
icon `<span>` + label `<strong>` + count `<em>` (L27-30). Exactly one Home entry
(single `goHome` button, L17-20). Counts come from `buildRailView(...).total` in
[App.tsx:77-85](frontend/src/App.tsx#L77-L85). Seven area items: Signals,
Accounts, Capability, Revenue, Map, Memory, Actions, plus Home and Settings.
No mid-word truncation in markup (labels are full words). Truncation absence at
render width is UNVERIFIED-RUNTIME (see A2 note below).

### A3 Distinct view per rail tab — **DONE**
[App.tsx:66-75](frontend/src/App.tsx#L66-L75) switch: market/customer/capability/
revenue/decision/workflow each render `<RailAreaView area=...>`; geographic renders
`<ProspectMap>`. `RailAreaView` builds a distinct model per area via
[railViews.ts `buildRailView`](frontend/src/app/railViews.ts#L293-L303) with unique
`componentId` (rail-signals / rail-accounts / rail-capability / rail-revenue /
rail-memory / rail-actions / map-exception). **Revenue renders its own
`rail-revenue` component, not Home or another tab.** `test:rail` proves each tab
maps to a distinct `data-rail-component`.

### A4 Brain engine (router + model policy + thinking-state) — **DONE (with nuance)**
- Router: [llmRouter.ts](frontend/src/brain/llmRouter.ts) — `routeBrainQuestion`
  calls the proxy with a 3s-class timeout (`LLM_TIMEOUT_MS.routing` = 8000ms; the
  abort controller at L48-49 uses the routing timeout, **not literally 3s**),
  validates strict JSON via zod (L76-77), and falls back to the keyword
  `classifyQuestion` on any failure or when `VITE_COPILOT_ENDPOINT` is unset
  (L66, L86-88). Gap vs spec: timeout is 8s, not 3s.
- Model policy: [llmConfig.ts](frontend/src/app/llmConfig.ts) — chatpil/routing =
  `claude-haiku-4-5-20251001`, composition = `claude-sonnet-4-5`; both
  env-overridable via `VITE_MODEL_CHATPIL` / `VITE_MODEL_COMPOSE` (L6-10).
- Thinking-state checklist: [AskBrainBar.tsx:35-115](frontend/src/ui/brain/AskBrainBar.tsx#L35-L115)
  renders a 4-stage checklist (Routing / Retrieving / Scoring / Composing) driven
  by `BrainActionEvents` callbacks (`routed`/`retrieved`/`scored`/`composing`)
  fired from
  [brainActions.ts:58-170](frontend/src/app/brainActions.ts#L58-L170). Nuance: in
  `dispatchBrainQuestion` the `routed`/`retrieved`/`scored` events all fire in
  sequence *after* the single `await processBrainQuestionAsync`, before any
  deliverable work — so the "routed vs fallback" status is genuine but the three
  early stages do not map to separate async pipeline boundaries. `composing`
  labels do vary per deliverable branch (e.g. "Building board deck").

### A5 Deliverable engine (agent contract, runAgent, viewer from sections) — **DONE**
- Contract: [contract.ts:20-30](frontend/src/agents/contract.ts#L20-L30) —
  `DeliverableAgent` has `inputs` (zod), `contextRecipe`, `outputSchema`,
  `rubric`, `compose`, `validate`.
- `runAgent`: [runAgent.ts:28-72](frontend/src/agents/runAgent.ts#L28-L72) —
  validates inputs, builds context, composes (template or LLM), enforces
  `validate` + `validateAudienceAndForm`, throws on failure.
- Viewer renders only from `Deliverable.sections`:
  [DocumentViewer.tsx:166-224](frontend/src/ui/deliverables/DocumentViewer.tsx#L166-L224).
- **Registered agents (8):** `weekly_memo`, `meeting_brief`, `itinerary`,
  `board_deck`, `outreach`, `analysis_annotation`, `sales_pitch`,
  `capabilities_assessment` ([runAgent.ts:15-24](frontend/src/agents/runAgent.ts#L15-L24)).
- **Deliverable types (8):** outreach, meeting_brief, weekly_memo, itinerary,
  board_deck, analysis_view, sales_pitch, capabilities_assessment
  ([export.ts:18-27](frontend/src/deliverables/export.ts#L18-L27)).

### A6 Editor — **DONE (partial per-section coverage)**
[DocumentViewer.tsx](frontend/src/ui/deliverables/DocumentViewer.tsx): overlay
(`editor-overlay` role=dialog, L137); per-section text editing (`updateText`,
L46-54; edits `kind==="text"` blocks only); dirty guard on close
(`window.confirm`, L57-59); Chatpil editor pane is a **full suggestion-card
thread** (textarea + `Suggest Revision` → suggestion cards with Apply/Discard,
L237-251), not a single textarea; edits feed Copy (markdown from `current`,
L77-79) and Download (all formats use `current`, L81-90). Gaps: table blocks are
not editable (only text), and `applySuggestion` only replaces block index 0 of a
section ([L124-132](frontend/src/ui/deliverables/DocumentViewer.tsx#L124-L132)).

### A7 Validators — **DONE**
Enforced in `runAgent` ([L63-70](frontend/src/agents/runAgent.ts#L63-L70)) and
in the LLM composition loop ([llmCompose.ts:64-76](frontend/src/agents/llmCompose.ts#L64-L76)):
- Banned vocabulary per audience: `PROSPECT_BANNED` / `INTERNAL_BANNED`
  ([contract.ts:32-47, 68-78](frontend/src/agents/contract.ts#L32-L78)).
- Entity binding: evidence must contain its bound account name
  ([contract.ts:99-106](frontend/src/agents/contract.ts#L99-L106)).
- Quantitative claims: `passesGrounding` whitelists every numeric token against
  context facts ([llmCompose.ts:154-177](frontend/src/agents/llmCompose.ts#L154-L177)).
- Entity-name binding on generated prose: candidate names must exist in facts
  (same function).
- Schema-label prefix rules: memo must open `Verdict:`; email greeting/CTA/sign-off
  and 2–4 sentence bounds ([contract.ts:80-97](frontend/src/agents/contract.ts#L80-L97)).
- Computed confidence: per-agent, e.g.
  [weeklyMemoAgent.ts:34-96](frontend/src/agents/weeklyMemoAgent.ts#L34-L96)
  (high/medium/low + reason) and
  [generateBrainResponse.ts:11](frontend/src/brain/generateBrainResponse.ts#L11).
Note: an explicit "schema-label prefix ban" (banning literal `Verdict:`-style
labels leaking into prose) is not present as a separate rule; the memo rule
*requires* the `Verdict:` prefix rather than banning schema labels.

### A8 Metric catalog — **DONE (arg naming differs)**
- **14 metrics** in [catalog.ts:47-188](frontend/src/metrics/catalog.ts#L47-L188)
  (revenue, bookings, backlog, book_to_bill, pipeline_coverage, win_rate,
  avg_order_value, margin_trend, customer_concentration, capacity_utilization,
  on_time_delivery, repeat_revenue_rate, pipeline_by_stage, revenue_yoy_change).
- Args are `MetricFilters` (accountId/region/segment/min_value) + `TimeRange`
  ([types.ts:20-30](frontend/src/metrics/types.ts#L20-L30)) — **functionally
  {scope, window} but not named that**.
- Reconciliation tests exist (`test:metrics` output: heatmap cells,
  deck==catalog==heatmap cross-surface equality, YoY spot-check, 14 range checks).
- Chart-spec compiler: [chartSpec.ts `computeChart`](frontend/src/metrics/chartSpec.ts#L59-L108)
  handles heatmap/trend/ranked_bar; per-viz coverage validated by test:metrics
  ("4 chart specs"). `retention_grid` is selectable in the UI but has no distinct
  branch (falls through to the grid path).

### A9 Analysis views — **DONE**
[AnalysisView.tsx](frontend/src/ui/analysis/AnalysisView.tsx): control strip
(metric / viz / cols selects, L180-189); Save view (L194); Add to deck (L195);
legend with min/mid/max (L62-78, L200-202); QTD handling (quarter labels tagged
`(QTD)`, hatched `analysis-cell-qtd` cells, `qtdNote`; [chartSpec.ts:41-53,
98-100](frontend/src/metrics/chartSpec.ts#L41-L53)); description/annotation block
(`computeAnnotation`, L14-60, rendered L179); provenance tooltips (per-cell
`data-provenance` + click-through provenance dialog, L121-142; bottom provenance
strip L203-205).

### A10 Chart blocks in documents — **SPLIT**
- In the document viewer: **raw JSON**. `chart-spec` blocks render as
  `<pre>{JSON.stringify(block.spec, null, 2)}</pre>`
  ([DocumentViewer.tsx:184](frontend/src/ui/deliverables/DocumentViewer.tsx#L184)).
  Same in docx/pdf/csv/xlsx exports (blockText stringifies the spec,
  [export.ts:53](frontend/src/deliverables/export.ts#L53)).
- In the .pptx path: **native charts**. `downloadBoardDeck` calls `computeChart`
  and `slide.addChart("line" | "bar", ...)`
  ([pptx.ts:30-47](frontend/src/deliverables/deck/pptx.ts#L30-L47),
  [layouts.ts:52-93, 122-136](frontend/src/deliverables/deck/layouts.ts#L52-L136)).
  So PowerPoint gets real native charts; the on-screen document does not draw them.

### A11 Downloads per type — **DONE**
[export.ts `DELIVERABLE_DOWNLOAD_FORMATS`](frontend/src/deliverables/export.ts#L18-L27):
- outreach / meeting_brief / weekly_memo / sales_pitch / capabilities_assessment:
  docx, pdf, markdown.
- itinerary: docx, pdf, **ics**, markdown.
- board_deck: **pptx**, pdf, markdown.
- analysis_view: **xlsx**, **csv**, pdf, markdown.
All formats implemented: `downloadMarkdown`, `downloadDocx` (real docx),
`printDeliverable` (pdf via print), `downloadBoardDeck` (pptx, native charts),
`downloadXlsx` (real xlsx + provenance sheet), `downloadCsv`, `downloadIcs`
(real VCALENDAR). Checklist named md/docx/pdf/pptx/xlsx/ics — all six present;
csv is an extra.

### A12 Memory — **DONE**
- Persisted notes + activity + deliverables in `localStorage`
  ([localMemory.ts](frontend/src/memory/localMemory.ts): `STORAGE_KEY`,
  `saveBrainMemoryNote`, `addActivity`, `saveDeliverable`; activity capped 100,
  deliverables 40).
- Per-tab Chatpil threads: `btx.chatpil.thread.${activeBrainArea}` in
  [Copilot.tsx:25, 33-46](frontend/src/ui/copilot/Copilot.tsx#L25-L46).
- Settings history clear + Reset demo:
  [SettingsWorkspace.tsx:81-99](frontend/src/ui/settings/SettingsWorkspace.tsx#L81-L99)
  (clear this chat / all chats / notes+activity / reset demo with confirm +
  reload).

### A13 Tour — **DONE (test harness broken)**
- **10 steps** (the 4-act journey) in
  [tourSteps.ts:19-85](frontend/src/tour/tourSteps.ts#L19-L85): weekly ask →
  open dossier → hold → why-this-account ask → analysis view → capabilities
  assessment → outreach → sales pitch → board deck → return Home/Library.
- Execution via **store actions**, not DOM typing: `executeTourStep` calls
  `dispatchBrainQuestion`, `setState`, `runAgent`
  ([tourSteps.ts:117-155](frontend/src/tour/tourSteps.ts#L117-L155)).
- Watchdog with visible failure: `waitForState` timeout + a `Promise.race` 15s
  timeout in the HUD ([TourHud.tsx:47-77](frontend/src/ui/brain/TourHud.tsx#L47-L77));
  `role="alert"` error block with Retry/Skip/Exit (L161-170); pauses after
  repeated failures.
- Autoplay speed: 40 ms/char for `ask` steps, 18 ms/char otherwise
  ([TourHud.tsx:54](frontend/src/ui/brain/TourHud.tsx#L54)).
- HUD: eyebrow + step counter, title, narration, typewriter line, full control
  row (Restart/Play/Pause/Run step/Back/Next/Minimize/Take over), minimized
  variant ([TourHud.tsx:132-172](frontend/src/ui/brain/TourHud.tsx#L132-L172)).
- `test:tour`: **FAILS at runtime** (import.meta.env crash — see Verification runs).

### A14 Dossier + right panel — **DONE**
[App.tsx](frontend/src/App.tsx): dossier X button (L126); context-panel X button
([RightContextPanel.tsx:11](frontend/src/ui/brain/RightContextPanel.tsx#L11));
Esc closes only the topmost panel (dossier, then response) without navigating
(L40-58); single-panel rule (`dossierOpen` takes priority; `contextPanelOpen =
!dossierOpen && !!brainResponse`, L36-37); push-vs-overlay via CSS grid var
`--right-w` and `right-panel-open` class, so the center reflows on open/close
(L38, L90-92). Center reflow on close is UNVERIFIED-RUNTIME (CSS-driven).

### A15 Settings — **PARTIAL**
Four sections declared
([settingsSections.ts](frontend/src/app/settingsSections.ts)) and the shell renders
them (`test:settings` passes). **Only "General & history" is functional**
([SettingsWorkspace.tsx:81-99](frontend/src/ui/settings/SettingsWorkspace.tsx#L81-L99)).
Engine tuning, Prompts & rubrics, and Connections are **placeholder panels**
rendering static copy ("…land here in the next section." /
"…land here after engine settings are wired." / "…move here in the Connections
section.", [L26-47, L100-104](frontend/src/ui/settings/SettingsWorkspace.tsx#L26-L104)).
No editable scoring weights, no signal event-type weights, no live recompute, no
prompt/rubric editor, no connector registry UI.

### A16 Chatpil — **DONE**
[Copilot.tsx](frontend/src/ui/copilot/Copilot.tsx) + [jarvis.ts](frontend/src/brain/jarvis.ts):
- LIVE badge: driven by `runHealthCheck` (real proxy ping) via
  `subscribeToLiveStatus`/`getLiveStatus`; renders live / … / offline
  ([Copilot.tsx:29-31, 170-174](frontend/src/ui/copilot/Copilot.tsx#L170-L174);
  [jarvis.ts:42-88](frontend/src/brain/jarvis.ts#L42-L88)).
- Error handling: on missing endpoint / non-200 / invalid or debug-looking
  response / timeout / network error, falls back to `deterministicAnswer` and
  attaches a one-time offline note; a debug-text guard strips model/JSON/stack
  strings ([jarvis.ts:224-336](frontend/src/brain/jarvis.ts#L224-L336)).
- Model id: `LLM_MODELS.chatpil` (`claude-haiku-4-5-20251001`).
- Per-tab threads: yes (A12).
- Personal-assistant system prompt + action buttons: grounded system prompt with
  behavioral rules, `OFFER:`/`ACTION:` markers parsed into a rendered offer button
  and store-action dispatch ([jarvis.ts:206-222, 338-375](frontend/src/brain/jarvis.ts#L206-L375);
  `acceptOffer` runs real agents [Copilot.tsx:97-136](frontend/src/ui/copilot/Copilot.tsx#L97-L136)).
  Not rule-based only — LLM path is primary, deterministic is fallback.

---

## B. Data + world

### B1 Generator — **DONE**
[generate-demo.ts](frontend/tools/generate-demo.ts): seeded via `mulberry32(SEED)`
(SEED `0x42784358`, L11/L37/L47) with fixed `AS_OF_MS`; `assertReferentialIntegrity()`
runs and throws on failure (L511-528); generates 24 months each of revenue,
pipeline, backlog, capacity, and win/loss history (L550); win/loss included;
validation/summary console output (L549-550). Deterministic.

### B2 BTX Precision present — **DONE**
Present as an account with `relationship: "self"` (`id: "btx-precision"`, Dallas)
in the generator ([generate-demo.ts:64](frontend/tools/generate-demo.ts#L64)) and
in the client profile ([client-profile.json:3](frontend/data/config/client-profile.json#L3)).
It becomes the client "perspective" score via the self-lens
([lens.ts:54-129](frontend/src/engine/decision/lens.ts#L54-L129)) and surfaces in
Chatpil context as "(self)" ([jarvis.ts:159-165](frontend/src/brain/jarvis.ts#L159-L165)).
A "BTX Dallas Main" facility also exists.

### B3 Score calibration — **DONE**
`dimension_cap: 97` in
[scoring-weights.v1.json:4](frontend/data/config/scoring-weights.v1.json#L4) —
scores clamp to [0, 97], so **no 100s** ([score.ts:43-44, 103](frontend/src/engine/decision/score.ts#L43-L103);
[lens.ts:120](frontend/src/engine/decision/lens.ts#L120)). Win/loss rows carry
small realistic wins/losses (e.g. 1/2, 2/3) yielding sub-50% win rates. The
40–95 target band is not enforced by an explicit floor; only the 97 cap is coded.

### B4 Cached LLM outputs + Library provenance — **PARTIAL**
- `cached_flows.json` exists ([data/demo/btx/cached_flows.json](frontend/data/demo/btx/cached_flows.json))
  for scripted flows.
- Shipped `sample_library.json` (10 samples across 8 types) all carry
  `"compositionPath": "Composed: template"` — i.e. **template-composed, not
  LLM-composed** (8 occurrences found; the 3 analysis_view samples have no
  compositionPath). The LLM path label ("Composed: LLM (claude-sonnet-4-5)") is
  only produced at runtime when a proxy is configured
  ([llmCompose.ts:26-31](frontend/src/agents/llmCompose.ts#L26-L31)); it is not in
  the shipped samples.

---

## C. Backend + integrations

### C1 btx_platform routes — **PARTIAL (mostly stubs)**
[api.py](btx_platform/api.py):
- `/health` GET — **implemented** (reports env + live/llm booleans, L54-61).
- `/llm` POST — **stub**: returns 501 `provider_not_wired` even when a key is
  present ("provider wiring is intentionally deferred", L72-86).
- `/crm/accounts`,`/crm/deals`,`/crm/contacts` GET — **stubs**: 501 when no token,
  else empty `{records: []}` (L88-104).
- `/crm/task` POST — **stub**: 501 when no token, else accepts with `record_url:
  null` (L106-110).
- `/email/send` POST — **allowlist-gated stub**: 403 if recipient not in
  `gmail_allowlist`, else 501 `not_configured` (L112-120).
- `/calendar/event` POST — **stub**: always 501 (L122-124).
- `/webhooks/{connection_id}` POST — **implemented**: size guard, HMAC signature
  verify, idempotency, ingest+enqueue (L126-154).
- **`/connectors*` — MISSING** (no such route defined).
- Token storage: via `Settings`/env (`hubspot_access_token`, `anthropic_api_key`,
  `gmail_allowlist`); no DB token custody route.
- Allowlist: email allowlist only (L114).
- Audit log: webhook `WebhookEvent` model is the audit core
  ([models.py:57](btx_platform/models.py#L57)); no per-outbound-call audit for the
  stub routes.
- Tests: [tests/test_platform_webhook.py] covers webhook signature/idempotency/
  dedup/size/schema + `/health`. The `/llm`, `/crm/*`, `/email/send`,
  `/calendar/event` routes are **not** exercised by tests.

### C2 Frontend live mode — **PARTIAL**
[LiveDataAdapter.ts](frontend/src/adapters/live/LiveDataAdapter.ts): wired to
`/crm/accounts`, `/crm/contacts`, `/crm/deals` via `VITE_BACKEND_ENDPOINT`;
`getSignals`/`getFacilities` return `[]`; `getOperatingSnapshot` throws
"not implemented". Selected by
[createDataAdapter.ts:15-19](frontend/src/adapters/createDataAdapter.ts#L15-L19)
on `VITE_DATA_MODE=live`. **No health indicator or automatic demo-fallback in the
adapter layer** — on error it throws (L10-15); `useWorld` only `.catch`es the
operating snapshot ([useWorld.ts:43](frontend/src/app/useWorld.ts#L43)), not the
core adapter calls. (The Chatpil LIVE badge in A16 is a separate proxy health
check, not the data-adapter's.)

### C3 seed-hubspot / cleanup-hubspot — **DONE (no dry-run)**
- [seed-hubspot.ts](frontend/tools/seed-hubspot.ts): token from env; upserts
  companies/contacts/deals by trace id; creates missing associations; **verify
  stage** `verifyHubSpotSeed` asserts every company is named, expected counts, and
  correct associations, throwing on mismatch (L376-500).
- [cleanup-hubspot.ts](frontend/tools/cleanup-hubspot.ts): token from env;
  archives nameless-duplicate companies and their associations via batch/archive
  (L165-317).
- Safeguards present: env-token requirement, association verification, named-object
  checks. **No `--confirm`/`--dry-run` flag** on either tool; cleanup archives
  without an interactive gate.

### C4 Scheduled memo workflow — **DONE**
[.github/workflows/weekly-memo.yml](.github/workflows/weekly-memo.yml): cron
`0 12 * * 1` + manual dispatch; checks out, installs frontend deps, runs
`npm run weekly:memo`, commits `frontend/memo_archive`. Complete and self-contained.

### C5 Old copilot proxy status — **STILL THE ACTIVE LLM PATH**
All frontend LLM callers hit `VITE_COPILOT_ENDPOINT`
([jarvis.ts:15](frontend/src/brain/jarvis.ts#L15),
[llmRouter.ts:8](frontend/src/brain/llmRouter.ts#L8),
[llmCompose.ts:15-16](frontend/src/agents/llmCompose.ts#L15-L16),
[DocumentViewer.tsx:99](frontend/src/ui/deliverables/DocumentViewer.tsx#L99)),
served by [copilot-proxy.mjs](frontend/tools/copilot-proxy.mjs) (local Node) or
[copilot-worker.js](frontend/tools/copilot-worker.js) (Cloudflare). The
`btx_platform` `/llm` route is a **separate, stubbed** path not wired to the
frontend. Not absorbed.

---

## D. Hygiene

### D1 Failing/skipped tests; console errors — **PARTIAL FAILURES**
- `test:flows` and `test:tour` fail at runtime (import.meta.env — see Verification
  runs). `test:metrics`, `test:rail`, `test:settings`, typecheck, build, and the
  412 pytest tests pass.
- Build emits one advisory (chunk > 500 kB); no build errors.
- No skipped tests observed.

### D2 Dev overflow auditor — **DONE**
[overflowAudit.ts](frontend/src/app/overflowAudit.ts) `runOverflowAudit` (warns on
>2px overflow, L46-56); wired to `window.__btxAudit` in
[main.tsx:5-8](frontend/src/main.tsx#L5-L8) (dev only).

### D3 docs/MANUAL_QA.md — **DONE**
[docs/MANUAL_QA.md](docs/MANUAL_QA.md): covers rail sweep, ask/parameter chips,
dossier X/backdrop/Esc, deliverable Send/Create-task modals, Today chips, market
dropdown recompute, map pins/labels, browser Back, responsive resize sweeps
(1512/1280/1024/tablet/<900), FAB shift, overflow auditor usage, and a full
Chatpil smoke-test matrix for proxy-on and proxy-off.

### D4 Secrets committed — **NONE FOUND**
Scan for `pat-na1`, `sk-ant`, `sk-proj`, `ghp_`, `AKIA` across ts/tsx/py/json/
yml/mjs/js (excluding node_modules/.git): the only hit is a **comment example**
(`sk-ant-...`) in
[copilot-proxy.mjs:4](frontend/tools/copilot-proxy.mjs#L4). No live tokens.

### D5 Uncommitted changes / branch state — **DIRTY**
Branch `brain-v2`. Modified (tracked): `docs/MANUAL_QA.md`,
`frontend/data/demo/btx/companies.json`, `frontend/data/demo/btx/contacts.json`,
`frontend/package.json`, `frontend/src/App.tsx`, `frontend/src/store/store.ts`,
`frontend/src/tour/tourSteps.ts`, `frontend/src/ui/brain/BrainSidebar.tsx`,
`frontend/src/ui/brain/TourHud.tsx`, `frontend/src/ui/company/Dossier.tsx`,
`frontend/src/ui/styles.css`, `frontend/tools/generate-demo.ts`,
`frontend/tools/seed-hubspot.ts`, `frontend/tools/test-tour.ts`.
Untracked: `frontend/src/app/railViews.ts`, `frontend/src/app/settingsSections.ts`,
`frontend/src/ui/brain/RailAreaView.tsx`, `frontend/src/ui/settings/`,
`frontend/tools/cleanup-hubspot.ts`, `frontend/tools/test-rail-tabs.ts`,
`frontend/tools/test-settings-shell.ts`. Recent commits through `681b897`.
Note: several core audited files (railViews, settingsSections, RailAreaView,
settings/, cleanup-hubspot) are **untracked** — not yet committed.

---

## UNVERIFIED-RUNTIME items (need a human in the browser)
- A2 label truncation at render width — inspect the rail at 1512/1280/1024px.
- A14 center reflow on panel close — open/close a dossier and watch the grid.
- A10 in-document chart appearance — open a board deck deliverable and confirm the
  chart section shows raw JSON (as coded).
- C2 live-mode behavior — set `VITE_DATA_MODE=live` + `VITE_BACKEND_ENDPOINT` and
  confirm there is no graceful demo fallback on adapter error.
