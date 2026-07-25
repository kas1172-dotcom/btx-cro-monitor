# Reconciliation Map

Status: Phase 0 discovery complete. Nothing has been merged, deleted, or pushed.
Date: 2026-07-25

## 1. Every clone on this machine

A filesystem-wide scan for `.git` directories found four repositories, two of which are relevant.

| Path | Remote | Branch | Commits | Working tree |
| --- | --- | --- | --- | --- |
| `/Users/kapilsharma/Desktop/btx-cro-monitor` | `origin` = btx-cro-monitor, `btx-engine` = BTX_Engine | `main` @ `084d789` | 146 | Clean |
| `/Users/kapilsharma/Desktop/monitor-engine` | `origin` = monitor-engine | `main` @ `5cf63c0` | 29 | 17 modified, 5 untracked |
| `/Users/kapilsharma/Documents/Notion Hub` | unrelated | | | |
| `/Users/kapilsharma/medicaid-financing-workbench` | unrelated | | | |

Note: the working tree of `btx-cro-monitor` was dirty at session start. Those changes are now
committed as `084d789`, which is the single unpushed commit. No uncommitted work was lost.

## 2. Remote tips and divergence

| Ref | Tip | Subject |
| --- | --- | --- |
| local `main` | `084d789` | Complete final demo rehearsal and release hardening |
| `origin/main` | `26b64b9` | Harden executive demo experience |
| `btx-engine/main` | `2df8169` | docs: platform architecture blueprint (two-engine design) |

Divergence:

- `origin/main..main` = **1 commit** (`084d789`, unpushed).
- `main..origin/main` = **0 commits**. Local main is a clean fast-forward of origin.
- `main..btx-engine/main` = **0 commits**.
- `btx-engine/main..main` = **142 commits**.
- `git merge-base main btx-engine/main` = `2df8169`, which *is* the BTX_Engine tip.

**BTX_Engine contains zero commits that are not already in btx-cro-monitor `main`.** It is a pure
ancestor, not a divergent line. Abandoning it loses nothing. This is the single most important
finding: there is no three-way merge to perform.

### Local-only branches in btx-cro-monitor

All eleven are from 2026-07-13 to 2026-07-15 and none has a live remote tracking branch except
`chore/github-and-repo-cleanup`, whose upstream is gone.

| Branch | Ahead of main | Behind main | Last commit |
| --- | --- | --- | --- |
| `chore/github-and-repo-cleanup` | 1 | 45 | 2026-07-15 |
| `docs/integration-codex-prompts` | 2 | 60 | 2026-07-13 |
| `docs/integrations-plan` | 1 | 60 | 2026-07-13 |
| `feat/analysis-figure-hub` | 5 | 60 | 2026-07-13 |
| `feat/chatpill-active-context` | 1 | 60 | 2026-07-13 |
| `feat/clients-deadlines-wizard` | 2 | 60 | 2026-07-13 |
| `feat/deliverable-wizard` | 1 | 60 | 2026-07-13 |
| `feat/home-daily-brief` | 1 | 60 | 2026-07-13 |
| `feat/prospecting-tab` | 3 | 60 | 2026-07-13 |
| `feat/settings-template-memory` | 1 | 60 | 2026-07-13 |
| `feat/trip-planner` | 4 | 60 | 2026-07-13 |

Every one of these predates the executive cockpit rebuild (`5074d29` onward). Their surfaces
(prospecting, trip planner, deliverable wizard, analysis hub, settings memory) all exist on `main`
in rebuilt form. They are ChatPill-era and seven-tab-era work that has been superseded.

## 3. Line versus capability

Inspected by reading files, not commit messages.

| Capability | btx-cro-monitor `main` (`084d789`) | BTX_Engine `main` (`2df8169`) | Local feature branches |
| --- | --- | --- | --- |
| Demo tenant + reset tooling (`btx_platform/demo/`, `tooling/reset_demo_tenant.py`) | **Present.** `definitions.py` 602 lines, `reset.py` 523, `assertions.py`, CLI with `--dry-run` / `--verify-only` | Absent (ancestor) | Absent |
| Persistent grounded Ask (`btx_platform/assistant.py`, `docs/ASSISTANT_ARCHITECTURE.md`) | **Present.** Backend-served, `AskSurface.tsx` calls `assistantApi.ts` | Absent | Absent |
| Work-item lifecycle | **Present.** Transition rules, role-gated actions, audit trail, `/work-items/*` endpoints | Absent | Absent |
| Evidence drawer | **Present.** `frontend/src/ui/evidence/EvidenceDrawer.tsx`, wired into Ask | Absent | Partial, older form |
| Focus mode | **Absent.** No focus-mode module found | Absent | Absent |
| Briefing mode | **Present.** `frontend/src/ui/modes/BriefingMode.tsx` | Absent | Absent |
| Navigation model | **Neither of the two options.** See section 4 | Absent | Seven-tab era |
| Saronic prospect journey | **Dead code only.** See section 5 | Absent | Absent |
| Qualitative confidence (`frontend/src/app/confidence.ts`) | **Present**, but two percentage leaks remain. See section 6 | Absent | Absent |
| Anti-slop enforcement | **Present.** `docs/DESIGN_SPEC.md`, `docs/VOICE_SPEC.md`, `frontend/src/app/brandCore.ts`, `check:design` and `check:voice` npm scripts | Absent | Absent |
| Real map tiles | **Present.** Leaflet + react-leaflet, CARTO dark basemap in `DarkMapTiles.tsx` | Absent | Older map |
| In-app create-task write action | **Present.** `/work-items/{id}/preview/hubspot-task` and `/execute/hubspot-task` | Absent | Absent |
| In-app add-company write action | **Absent from the backend.** No create-company endpoint exists. `docs/DEMO_SCRIPT.md` still narrates one | Absent | Absent |

Baseline health of the canonical line: `pytest` **454 passed**, `tsc --noEmit` clean, em-dash grep
finds **one** hit and it is a comment in `.gitignore`.

## 4. Recommended canonical line

**`btx-cro-monitor`, branch `main`, at `084d789`.**

Rationale: it holds every capability that exists anywhere, BTX_Engine is a strict ancestor with
nothing to salvage, and all eleven feature branches are 60 commits behind and superseded. This is
not a merge problem. It is a delete-and-push problem, which removes essentially all of the risk
this task was scoped for.

Consolidation actions this implies:

1. Push `084d789` to `origin/main`. One commit, fast-forward, no force.
2. Delete all eleven local feature branches, and the stale `origin/chore/github-and-repo-cleanup`
   remote branch if it still exists. **MANUAL: needs human approval.**
3. Remove the `btx-engine` remote and stop pushing to it. Archive the BTX_Engine repository on
   GitHub. **MANUAL: needs human approval and a GitHub action.**
4. Leave `/Users/kapilsharma/Desktop/monitor-engine` alone. It is the upstream generic engine, a
   different product. Its uncommitted work (`clients/aerospace` renamed to `clients/btx`, plus
   `enrichment/` and `analysis/research.py`) has **already been carried into** btx-cro-monitor,
   which has `monitor_engine/enrichment/`, `monitor_engine/analysis/research.py`, and `clients/btx/`.
   Nothing needs to be merged from it. Recommend committing or discarding its working tree
   separately, outside this consolidation.

## 5. Fork A, prospect journey: Saronic or directed energy

This is the fork with real consequences, because the two journeys live in **two different data
paths**, only one of which the running app uses.

**The directed-energy journey is the live one.** The backend demo tenant
(`btx_platform/demo/definitions.py`, tenant `btx-demo-command-cockpit`) seeds six accounts and its
prospect story is **nLIGHT, Inc.**, a real directed-energy laser company, classified `target`, with a
public-classified signal ("Pentagon picks Lockheed, nLIGHT for laser defense project") that links to
the Lockheed customer journey. The frontend reads this through `useWorld` and the backend
`/world-snapshot` contract.

**The Saronic journey is dead code.** Saronic exists only in
`frontend/data/demo/btx/*.json`, `clients/btx/pinned_signals.json`,
`frontend/src/brain/groundedAssistant.ts`, and `docs/DEMO_SCRIPT.md`. These are reached through
`CockpitDataAdapter` / `DemoDataAdapter` via `createDataAdapter()`, and **`createDataAdapter()` has
no callers anywhere in `frontend/src`**. This is the parallel frontend demo mode that Phase 3 is
meant to delete.

Three problems make Saronic expensive to revive:

1. **The investor attribution is wrong and the source URL looks fabricated.**
   `clients/btx/pinned_signals.json` credits the raise to "Corsair Capital" with the URL
   `https://www.corsair-capital.com/news/saronic-raises-1-75-billion-series-c`. Corsair is Saronic's
   *vessel*, not its investor. The real $1.75B round was a Series D led by Kleiner Perkins. The
   record also calls it a Series C in the slug. That is a fabricated citation on the exact kind of
   claim the honesty rule exists to protect.
2. **`docs/DEMO_SCRIPT.md` narrates real external mutations** for this journey: "creates the Saronic
   company in HubSpot", plus a cleanup section instructing the operator to delete the created
   company and tasks between takes. This violates the rule that the demo tenant never issues a real
   external mutation.
3. **The add-company write action it depends on does not exist in the backend.** Reviving Saronic
   means building an endpoint, not just moving data.

**Recommendation: keep nLIGHT / directed energy. Retire Saronic.** It is live, backend-grounded,
already honest about missing evidence, narratively connected to the Lockheed journey through the
shared laser-defense signal, and needs no new endpoints. Delete the Saronic fixture data,
`clients/btx/pinned_signals.json`, the dead adapters, and `docs/DEMO_SCRIPT.md` in Phase 3.

If the human picks Saronic instead, the Phase 1 correction is to remove the "Corsair Capital"
attribution and its URL entirely rather than substitute Kleiner Perkins, because a source link is
needed and I do not have a verified one to cite.

## 6. Fork B, navigation: four-surface cockpit or seven-tab layout

**Neither option describes what is on `main`.** `frontend/src/app/surfaces.ts` defines **twelve**
surfaces in three groups, and `router.ts` routes all of them:

- Core, and the value of `PRIMARY_TAB_IDS`: **Today, Work, Accounts, Ask**.
- Analytical: Prospects, Trip Planner, Map, Analysis, Capacity, Programs.
- Utility: Deliverables, Integrations, Settings.

So the four-surface cockpit is already the primary navigation, with eight secondary surfaces behind
it. The real question is not four versus seven, it is **whether the eight secondary surfaces stay**.

**Recommendation: keep the four-surface primary nav and retire the secondary surfaces down to what
the two journeys touch.** Phase 4 requires auditing every tab and every visible control for loading,
empty, stale, and failure states, and confirming no tab is broken on camera. Twelve surfaces is a
large audit surface for a demo that tells two stories. Trip Planner and Analysis in particular are
not on either journey path.

I do not recommend deleting their code in this pass. Removing them from `ALL_SURFACES` so they are
unreachable is reversible, cheap, and shrinks the Phase 4 audit to four surfaces.

## 7. Honesty findings that need a decision regardless of the forks

These surfaced during discovery and are in scope for Phase 2's "verify every simulated field is
classified and no surface shows a fabricated percentage confidence or invented specifics".

1. **Fabricated percentage confidence, two sites.** `frontend/src/app/evidence.ts:157` renders
   `${Math.round(signal.confidence * 100)}%` as a field literally labeled "Confidence", and
   `frontend/src/app/timeline.ts:73` renders match confidence as a percentage. The qualitative
   `confidence.ts` module exists and is correct; these two bypass it.
2. **"Pulse Space Technologies" appears to be a fabricated company.** It is seeded in the demo tenant
   as a `target` account with a "Laser power transmission" program and "U.S. Space Force" as a known
   customer, across 56 references. I could not confirm it is a real company. Every other seeded
   account (Lockheed, RTX, Northrop, nLIGHT, Collins) is real. **This needs the human to confirm or
   deny.** If fabricated, it must be removed, which Phase 2's noise-trimming would do anyway.
3. **`docs/DEMO_SCRIPT.md` and `docs/DEMO_RUNBOOK.md` contradict each other** on external writes.
   The runbook says keep execution simulated; the script says create real HubSpot records. The
   script also describes a tab sweep and an add-company button that do not match the current app.

## 8. Decisions recorded

Confirmed by the product owner on 2026-07-25.

| Decision | Outcome |
| --- | --- |
| Canonical repo and branch | **btx-cro-monitor `main`**. Confirmed without caveat |
| BTX_Engine | **Abandon and archive** after salvaging `docs/PLATFORM_BLUEPRINT.md` |
| Eleven local feature branches | **Delete**, each tagged first for recoverability |
| Fork A, prospect journey | **nLIGHT, directed energy.** Saronic retired, held as a possible post-demo second version |
| Fork B, navigation | **Four-surface primary**, secondary surfaces retired |
| Pulse Space Technologies | **Real, keep.** Bellevue-based, $40M Space Force laser contract, on the MDA SHIELD vehicle |

### Fork A rationale, as decided

nLIGHT is real, already built, and sourced from a genuine $627M directed-energy contract, so its
records carry no fabrication risk. Saronic stays retired rather than deleted from history: its data
is removed from the working tree in Phase 3 and remains recoverable through git.

### Fork B rationale, as decided

The four-surface layout is the focused, answer-first one. Twelve tabs is the clutter this product
has been cutting, and neither journey depends on a retired surface. nLIGHT specifically needs no
map, which was the one dependency risk worth checking.

## 9. Phase 1 execution record

### BTX_Engine salvage, completed

- `docs/PLATFORM_BLUEPRINT.md` copied from `btx-engine/main` into the canonical repo. It was the
  only file in BTX_Engine not already present here. Its 22 em dashes were converted to commas,
  colons, and sentence breaks to satisfy the house style rule.
- The two `monitor_engine` trees were compared by tracked file, not by working directory: BTX_Engine
  has **38** tracked files, canonical has **29**. The 9 extras are `monitor_engine/site/` (the static
  site builder and its assets) and `monitor_engine/targets/_assets/` (the static map).
- All 9 were removed deliberately by `55e9fd0 chore(engine): remove retired static renderers`, and a
  repo-wide search finds **no live reference** to any of them. The React frontend replaced them.
  **Confirmed not an engine change to keep.**
- Every other shared file differs only by forward development on the canonical line.

### Branch retirement, completed

`git branch --merged main` returned **nothing**. All eleven branches were `--no-merged`, so all
eleven were tagged before deletion, per the gate.

Each branch was verified to hold nothing still wanted:

- `Prospecting.tsx`, `TripPlanner.tsx`, `DeliverableWizard.tsx`, `SettingsWorkspace.tsx`, and
  `deliverablesApi.ts` all exist on `main` in rebuilt form.
- `prospectingModel.ts` and `useActiveContext.ts` are absent from `main` by design. They are
  ChatPill-era modules replaced by the backend-served assistant.
- `chore/github-and-repo-cleanup` removed `pages.yml`, `e2e.yml`, `insights.yml`, and
  `weekly-memo.yml`. `main` has **already** dropped all four. The branch is superseded.
- `docs/INTEGRATIONS_PLAN.md` and `docs/INTEGRATION_CODEX_PROMPTS.md` (1031 lines) are unique to
  branches but are stale planning docs of the kind Phase 3 removes. Preserved by tag only.

Recovery: `git checkout -b <name> retired/2026-07-25/<slug>`.

| Retired tag | Commit |
| --- | --- |
| `retired/2026-07-25/chore-github-and-repo-cleanup` | `4ad35e7` |
| `retired/2026-07-25/docs-integration-codex-prompts` | `2c9771f` |
| `retired/2026-07-25/docs-integrations-plan` | `45dd4e2` |
| `retired/2026-07-25/feat-analysis-figure-hub` | `565693c` |
| `retired/2026-07-25/feat-chatpill-active-context` | `981acd2` |
| `retired/2026-07-25/feat-clients-deadlines-wizard` | `1129680` |
| `retired/2026-07-25/feat-deliverable-wizard` | `b3e206f` |
| `retired/2026-07-25/feat-home-daily-brief` | `f2ebe71` |
| `retired/2026-07-25/feat-prospecting-tab` | `cc1946c` |
| `retired/2026-07-25/feat-settings-template-memory` | `83d308e` |
| `retired/2026-07-25/feat-trip-planner` | `5804a69` |

### End state

One repo, one branch. `git branch -a` shows `main` and remote tracking refs only. The `btx-engine`
remote is removed and the repository is to be archived read-only on GitHub, not deleted, which is a
manual step for the product owner.

## 10. Correction to section 7

Item 2 of section 7 questioned whether Pulse Space Technologies was fabricated. **It is real**, and
the finding is withdrawn. Its signal is legitimate and sourced, and it stays in the demo tenant.

One detail still needs reconciling in Phase 2: the seeded record in `btx_platform/demo/definitions.py`
places Pulse Space in **Los Angeles, CA**, while the company is **Bellevue** based. That is a factual
field to correct, not a fabricated company.

Items 1 and 3 of section 7 stand and carry into Phase 2 and Phase 3.
