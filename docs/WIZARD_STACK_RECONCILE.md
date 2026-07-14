# Wizard Stack Reconcile Plan

**Status:** Plan only. Nothing in this document has been merged or executed. Each feature below stays on its branch until explicitly approved.

**The stack:** five commits in one linear chain off pre-consolidation main (`69a6898`). Each branch tip includes everything before it, so they cannot be merged independently in their current form — porting means extracting each feature onto the new conformant main.

| Order | Branch | Commit | Feature |
|---|---|---|---|
| 1 | `feat/deliverable-wizard` | `b3e206f` | Deliverable generation wizard + **non-conformant backend store** |
| 2 | `feat/clients-deadlines-wizard` | `1129680` | Account 360 "Clients" scoping + deadlines panel |
| 3 | `feat/prospecting-tab` | `cc1946c` | Purpose-built Prospecting surface + prospect detail |
| 4 | `feat/trip-planner` | `5804a69` | Trip Planner surface + itinerary/trip-brief agents |
| 5 | `feat/analysis-figure-hub` | `565693c` | Analysis figure hub (chart figures in deliverables) |

**Why the stack is non-conformant (all five branches inherit this):**

1. **Banned Deliverable model.** Commit `b3e206f` adds `DeliverableRecord` (`btx_platform/models.py`): client-supplied `String(120)` primary key, `entity_ids` JSON, and — critically — the **same `deliverables` table name** the canonical WP1 `Deliverable` model now owns on main (server-generated `String(32)` id, `program_id`/`trip_id`). Merging any stack branch would collide two SQLAlchemy models on one table.
2. **Forked migration.** The stack's Alembic revision `9c5b1fbd2e4a` has `down_revision 8233aeb6057e` — same parent as main's canonical `a9a010e2152e`. Merging forks the migration history.
3. **Old navigation model.** The stack's `surfaces.ts` still uses `SurfaceId`/`BrainArea`/`surfaceFromBrainArea` (banned symbols) and renames Accounts to "Clients". Main is now on the `TabId` model.
4. **Superseded surfaces.** Main now has its own `surfaces/Prospecting.tsx` (ported from the legacy prospecting workspace during WP10 consolidation, with CSV import). The stack's Prospecting surface is a *different, richer* implementation of the same tab.

---

## 1. Deliverable Wizard (`feat/deliverable-wizard`, b3e206f)

**What it does:** A guided multi-step wizard (`ui/deliverables/DeliverableWizard.tsx`, ~330 lines) for generating deliverables from the Ask bar and the account dossier: pick type → pick scope/entities → generate via `agents/deliverableRegistry.ts` → save to backend. Includes `tests/test_deliverables_api.py` (111 lines) and a frontend test tool.

**Files:** `DeliverableWizard.tsx`, `agents/deliverableRegistry.ts`, `app/deliverablesApi.ts` (client-id POST variant), `AskBrainBar.tsx` + `Dossier.tsx` entry points, `btx_platform/{models,api,schemas}.py`, `alembic/versions/9c5b1fbd2e4a_add_deliverables.py`, styles, tests.

**Exact port work:**
- Drop `DeliverableRecord`, migration `9c5b1fbd2e4a`, and the branch's `api.py`/`schemas.py` deliverable routes entirely — main's canonical WP1 model + routes already cover CRUD.
- If account linkage is needed, add `entity_ids: Mapped[list | None]` (JSON) to the **canonical** model in a new migration parented on `a9a010e2152e` (per consolidation law #3) rather than resurrecting the variant.
- Rewire the wizard's save path onto main's `deliverablesApi.ts` (`createStoredDeliverable` — POST without client id, PATCH by `backendRecordId`).
- Re-resolve `AskBrainBar.tsx` and `Dossier.tsx` entry points against their restyled main versions (both changed in the design-system merge).
- Port the branch's `test_deliverables_api.py` assertions onto the canonical routes where they add coverage main lacks (e.g. type filtering), discard duplicates.

**Recommendation: port now** (it is the foundation the rest of the stack builds on, and the wizard is the only generation UX the demo has beyond the Ask bar). Port cost is moderate — the wizard UI itself is reusable nearly as-is; the work is entirely in the data layer swap.

## 2. Clients scoping + deadlines (`feat/clients-deadlines-wizard`, 1129680)

**What it does:** Renames the Accounts tab to "Clients" (current-business framing), adds `ui/clients/DeadlinesPanel.tsx` (102 lines — contract/PO deadline list) into `Account360.tsx`, plus a test tool.

**Files:** `surfaces.ts` (label change), `Account360.tsx` (+38), `DeadlinesPanel.tsx`, styles, `tools/test-clients-surface.tsx`.

**Exact port work:**
- `DeadlinesPanel.tsx` is self-contained; drop it into main's `Account360.tsx` (which has since been restyled — re-resolve the insertion point) and re-point its styles at Steel & Signal tokens (audit for raw hex before merging; the stack predates the design system).
- The Accounts→"Clients" rename is a product-language decision for Jamie: main's IA plan says "Accounts / Account 360". **Do not port the rename without sign-off.**

**Recommendation: shelve until Jamie's requirements.** The deadlines panel is useful but small; it rides along cheaply whenever the wizard port happens. The rename question needs a human decision.

## 3. Prospecting tab (`feat/prospecting-tab`, cc1946c)

**What it does:** A purpose-built `surfaces/Prospecting.tsx` (list + `ProspectDetail.tsx` drill-down + "generate deliverable" per prospect), `prospectingModel.ts` (ranked rows, industry updates), and `prospectingMemory.ts` — which stores per-prospect "generation state" as fake deliverable records (`PROSPECT_GENERATION_RECORD_TYPE = "prospect_generation_state"`) in the deliverables table.

**Files:** `surfaces/Prospecting.tsx` (139 lines), `ui/prospecting/{ProspectDetail,prospectingModel}.ts(x)`, `app/prospectingMemory.ts`, `DeliverableWizard.tsx` extensions, registers `prospecting` as a **core** tab, styles, tests.

**Exact port work:**
- Main already has a conformant `prospecting` tab (analytical group) holding the legacy-derived surface + CSV import modal. Porting this feature means **replacing that surface's internals** with the stack's list/detail/generate flow while keeping the Import list button and `ImportListModal` wiring.
- Depends on the wizard (imports `DeliverableWizard`) — can only follow port #1.
- Replace `prospectingMemory.ts`'s fake-deliverable KV hack: either a dedicated `prospect_state` backend concept or client-side memory. Storing UI state as deliverables pollutes the library and should not survive the port.
- Reconcile core-vs-analytical grouping: the stack made Prospecting a core tab; consolidated main groups it analytical. Keep analytical unless Jamie says otherwise (core four is a deliberate IA constraint).

**Recommendation: shelve until Jamie's requirements**, then port after #1. Main's current Prospecting surface already covers the demo need (ranked targets, buying signals, outreach queue, visit plan, CSV import); the stack version adds detail-pane depth and per-prospect generation, which is worth having but not blocking.

## 4. Trip Planner (`feat/trip-planner`, 5804a69)

**What it does:** A `trip_planner` analytical tab: `TripInputForm.tsx` (goal/region/dates) → `tripBriefAgent.ts` + extended `itineraryAgent.ts` (192 lines changed) generate candidate stops and a trip brief; map integration (itinerary pins in `ProspectMap.tsx`/`mapModel.ts`, ~100 lines).

**Files:** `surfaces/TripPlanner.tsx` (217 lines), `ui/trips/TripInputForm.tsx`, `agents/{tripBriefAgent,itineraryAgent,rubrics,runAgent}.ts`, map changes, styles, tests.

**Exact port work:**
- Register `trip_planner` in the TabId model (`AnalyticalTab`), spec entry, label, icon, count, `viewScope`, rail assertion updates — same mechanical port done for `deliverables`/`hubspot`/`prospecting` during consolidation.
- Re-resolve `ProspectMap.tsx`/`mapModel.ts` against main (map was restyled; the itinerary-pin CSS classes `itinerary-pin-day-*` already exist on main's styles.css, suggesting partial overlap — diff carefully).
- The trip brief saves via the wizard's deliverable path → depends on port #1 for persistence (canonical model already has `trip_id`, which fits perfectly).
- Token-audit `TripPlanner.tsx`/`TripInputForm.tsx` (pre-design-system code).

**Recommendation: shelve until Jamie's requirements.** High demo value (map-actionable prospecting is a CLAUDE.md pillar) but the largest port surface after the wizard, and its persistence depends on #1.

## 5. Analysis figure hub (`feat/analysis-figure-hub`, 565693c)

**What it does:** Overhauls `AnalysisView.tsx` (428 lines changed) into a figure hub: `ChartFigure.tsx` (rendered chart as a saveable figure), `FigureTypePicker.tsx`, `chartSpec.ts` extensions, and `DocumentViewer.tsx` embedding of figures into deliverables.

**Files:** `ui/analysis/{AnalysisView,ChartFigure,FigureTypePicker}.tsx`, `metrics/chartSpec.ts`, `DocumentViewer.tsx`, styles, tests.

**Exact port work:**
- No nav/model entanglement of its own (only App.tsx line + the inherited stack baseline), so it rebases mostly cleanly — but `AnalysisView.tsx` and `DocumentViewer.tsx` have both changed substantially on main (restyle + `activeTab` port + StoredDeliverable rename), so the 428-line AnalysisView diff needs careful re-application, not a mechanical merge.
- Figure-into-deliverable embedding should target the canonical stored-deliverable document shape.
- Token-audit `ChartFigure`/`FigureTypePicker`.

**Recommendation: shelve until Jamie's requirements.** Self-contained and desirable (explainable analysis → deliverables), but the AnalysisView rewrite is exactly the kind of large re-application that should wait until the wizard port stabilizes the deliverable document shape.

---

## Suggested sequence if/when approved

1. Port **deliverable wizard** onto canonical model (new branch off consolidated main; add `entity_ids` migration if needed).
2. Ride **deadlines panel** along (hold the "Clients" rename for Jamie).
3. Port **prospecting internals** onto the existing conformant tab (replace fake-deliverable memory hack).
4. Port **trip planner** (canonical `trip_id` persistence).
5. Port **analysis figure hub** last (depends on stable deliverable shape).

After all ports land, delete the five stack branches; none should ever merge directly.
