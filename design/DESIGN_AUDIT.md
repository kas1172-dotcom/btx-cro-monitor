# Design system audit — frontend/src/ui

Audited against `design.md`. Read-only findings before any retrofit work; each
item below states current state, verdict, and what (if anything) this pass fixes.

## 1. Raw hex colors in components

**Clean.** Zero raw hex literals found in any `.tsx`/`.ts` file under
`frontend/src/ui/` (including inline `style={{}}` objects) outside `uiTokens.ts`
itself. `AppShell`'s one inline `style={{ "--right-w": rightW }}` sets a CSS
custom property, not a color. No action needed.

## 2. `styles.css` token structure

**Two `:root` blocks exist.**
- Block A (lines 1–17): the 16 locked cockpit tokens, exactly matching
  `uiTokens.ts`. This is the canonical set `design.md` documents.
- Block B (~lines 2567–2585): a second `:root` reintroducing 16 `--ss-*`
  prefixed hex values (navy, teal, steel, ink, muted, bg, panel, white, ice,
  line, tint, prov-border, prov-ink, green, amber, red) — a **light-mode**
  palette for the separate deliverable/document export theme
  (`frontend/src/deliverables/steelSignalTemplates.tsx`), not the live cockpit.
  Some values duplicate locked tokens (teal, amber); most are new and scoped
  only to document rendering.

**Verdict:** not a violation — it's a legitimately separate theme for a
different artifact class (see `design.md`'s "Known, deliberate exception").
**Action this pass:** add an explicit comment banner around Block B in
`styles.css` making the exception unambiguous to future readers, and exclude
it by name from the raw-hex guard script rather than leaving the two blocks
visually indistinguishable.

## 3. Font weights

All component CSS correctly uses `var(--font-regular)` (400) / `var(--font-semibold)`
(600) except two hardcoded literals:
- `styles.css:1340` — `.brand-sub { font-weight: 400; ... }`
- `styles.css:1901` — `.copilot-head small { font-weight: 400; ... }`

Both are value-correct (400 is an allowed weight) but bypass the variable.
**Action this pass:** switch both to `var(--font-regular)` for strict
consistency, per Step 3's "every ... value ... MUST come from" requirement.

No other weight (300/500/700/800) appears anywhere in the cockpit UI. Font
family is Inter everywhere it's declared. No action beyond the two lines above.

## 4. Provenance / confidence visual grammar

**Partially exists.** `ProvenanceBadge` (categorical: CRM/Monitor/Demo, 3-tone)
and `ProvenanceStrip` (a colored dot + text, in `primitives.tsx`) already exist
and are well-built. **Missing:** any continuous confidence-to-visual-weight
mapping (solid-vs-dashed border, opacity gradient) tied to whether a claim is
relationship-backed and how confident that link is. Existing dashed borders
(`.empty-state`, `.settings-placeholder`) are unrelated to confidence.

**Action this pass:** new `ConfidenceEdge` component (see `design.md` §1) wired
into every place an account-linked claim renders: `SignalCard`, Account 360's
relationship-backed signal list, Programs, Capacity.

## 5. Scope pills

**Exists and is solid.** `ScopePill` in `primitives.tsx`, three color tones,
all `var()`-based, correctly mapped to scope categories. Only gap: it's wired
into `SignalCard` but not universally everywhere a signal/claim renders outside
that component.

**Action this pass:** confirm every signal-bearing surface routes through
`SignalCard` or otherwise renders a `ScopePill`; add where missing.

## 6. Account status rings

**Does not exist for accounts.** A `.ss-status-dot` + `.at-risk`/`.churned`
class exists in `styles.css` but belongs to the unused document-theme block
(§2) and isn't wired to any live component. The only live status-dot pattern
(`Integrations.tsx`, `PlatformHealthWidget.tsx`, `OperatingSnapshot.tsx`) is for
integration/platform connection health, not account health.

**Action this pass:** new `AccountToken` component (design.md §3), deriving
growing/at-risk/churned from the existing `CompanyScore.dimensions.risk.score`
(no new backend data needed) — wired into Account 360's account list and the
Map's markers/legend.

## 7. Empty states

**Consistent where present, but only in 4 places.** `EmptyState` component is
correctly icon+headline+body everywhere it's used: `TodayBrief.tsx`,
`Account360.tsx` (x2), `ProgramContractTracker.tsx`. Not found in: `WorkQueue.tsx`,
`AskSurface.tsx`, `CapacityAssessment.tsx`, `AnalysisDashboard.tsx`,
`Prospecting.tsx`, `Dossier.tsx`, `CurrentBusiness.tsx`, `SignalFeed.tsx`.

**Action this pass:** add `EmptyState` to any of the above that can reach a
genuinely empty condition with today's data (verified per-surface during
retrofit — not every listed surface necessarily has a reachable empty state).

## 8. Surface inventory (retrofit scope for Step 2)

| Surface | File | Status pre-retrofit |
|---|---|---|
| Today's Brief | `surfaces/TodayBrief.tsx` | On-system; has EmptyState |
| Work Queue | `surfaces/WorkQueue.tsx` + `surfaces/WorkItemList.tsx` | On-system; no EmptyState |
| Accounts / Account 360 | `surfaces/Account360.tsx` | On-system; has EmptyState; no status ring |
| Ask | `surfaces/AskSurface.tsx` | On-system; no EmptyState |
| Map | `map/ProspectMap.tsx` + `map/mapModel.ts` | On-system (uses `uiTokens` directly); no status ring |
| Analysis | `surfaces/AnalysisDashboard.tsx` | On-system; no EmptyState |
| Capacity | `surfaces/CapacityAssessment.tsx` (wraps `operating/OperatingSnapshot.tsx`) | On-system; no EmptyState |
| Programs | `surfaces/ProgramContractTracker.tsx` | On-system; has EmptyState |
| Settings | `settings/SettingsWorkspace.tsx` | On-system |
| App shell | `primitives.tsx` (`AppShell`, `SurfaceHeader`) + `App.tsx` + `brain/BrainSidebar.tsx` | On-system, no hardcoded styling |

## 9. App shell

Already fully on-system — `AppShell`, `BrainSidebar`, and `App.tsx`'s topbar
composition use CSS classes/vars exclusively. No action needed beyond whatever
new components (status rings, confidence edges) get composed into it.

## 10. Prior design docs

No `design.md` existed before this pass (now created). `design/reference/`
contains only WP9 deliverable-template assets (specs, generator scripts,
sample renders) — unrelated to this cockpit restyle. `design/samples/ui/`
already contains reference screenshots (`account-360-*`, `analysis-*`,
`todays-brief-*`, `work-queue-*` at desktop+mobile) from prior work — reused
as the baseline to diff this pass's new screenshots against.

## Summary punch list

1. Label/isolate the `--ss-*` block in `styles.css` as the deliverable-theme
   exception, excluded from the raw-hex guard.
2. Fix two hardcoded `font-weight: 400` literals → `var(--font-regular)`.
3. Build `ConfidenceEdge` (confidence-gradient border/opacity) and wire it
   everywhere account-linked claims render.
4. Build `AccountToken` (status ring) and wire it into Account 360 + Map.
5. Confirm/extend `ScopePill` coverage to every signal-bearing surface.
6. Add `EmptyState` to WorkQueue, AskSurface, CapacityAssessment,
   AnalysisDashboard, Prospecting, Dossier, CurrentBusiness, SignalFeed where
   a genuinely empty condition is reachable.
7. Add `frontend/tools/check-design-tokens.ts` guard script + `npm run
   check:design` entry.
8. Screenshots: Today's Brief, Account 360, Analysis, Work Queue, Map at
   desktop + one mobile width, saved to `design/samples/ui/`.

## Follow-up (not done in this pass)

Item 6 above was scoped to each surface's primary/top-level list only
(Prospecting's Top New Prospects, CurrentBusiness's attention rows,
SignalFeed's main list, WorkQueue/AskSurface via `WorkItemList`). Several
secondary/nested lists still render nothing when empty rather than a bare-text
or designed empty state, and were deliberately left out of this visual pass
as more surgical/behavioral than a style retrofit:
- `Prospecting.tsx`: Nearby/Market-Based Prospects, Recommended Actions,
  Active Buying Signals, Outreach Queue panels.
- `CurrentBusiness.tsx`: Recommended Actions, Expansion Opportunities, open
  pipeline/won contracts, Risk Signals panels.
- `Dossier.tsx`: open opportunities, facilities, signals panels (contacts
  already has a bare-text guard at line 224 — candidate to upgrade alongside
  the rest).
Recommend a follow-up pass auditing each for whether it can genuinely reach
zero items with real data (not just demo fixtures) before adding guards.

Also noted while capturing screenshots: `ProspectMap.tsx` never sets
`data-surface-component="surface-map"` on its root (unlike every other
surface) — a pre-existing gap, not introduced by this pass, worth a one-line
fix in a future PR so browser-automated tooling can target it consistently
(`.map-shell` works as a stand-in selector today).

## Verification (Step 4)

- `npm run build` — pass.
- `npm run typecheck` — pass.
- All frontend test suites (`test:metrics`, `test:rail`, `test:settings`,
  `test:flows`, `test:tour`, `test:phase0`, `test:identity`, `test:map`,
  `test:live-adapter`, `test:deliverables`) — pass.
- `npm run check:design` — pass (verified the guard actually catches a
  violation by injecting a temporary raw hex, confirming the script fails,
  then reverting).

Grep proof — zero raw hex under `frontend/src/ui/` outside `styles.css`:

```
$ grep -rEn "#[0-9A-Fa-f]{3,8}\b" src/ui --include="*.tsx" --include="*.ts" | grep -v "/styles.css"
(no output)
```

Screenshots saved to `design/samples/ui/`: `todays-brief-{desktop,mobile}.png`,
`account-360-{desktop,mobile}.png`, `analysis-{desktop,mobile}.png`,
`work-queue-{desktop,mobile}.png`, `map-{desktop,mobile}.png` — captured
against `VITE_DATA_MODE=demo` so accounts/map are populated for review (the
default hybrid-mode preview build has no live backend and renders these two
surfaces' correctly-working empty states instead).
