# Declutter Report

Branch: `chore/declutter`

Decision: `frontend/` React cockpit plus `btx_platform/` FastAPI backend is the canonical product. The Python monitor engine remains canonical for JSON artifacts (`run_output.json`, `archive.json`, `map_targets.json`). Python-generated static HTML (`index.html`, `map.html`, static-site service worker) is retired.

## Task 1 Usage Map

No deletions were made before this usage map.

### Duplicate Fixtures: `frontend/data/mock/`

Command evidence:

```text
rg -n "frontend/data/mock" . --glob '!frontend/node_modules/**' --glob '!**/__pycache__/**' --glob '!frontend/dist/**'
# no matches

rg -n "data/mock" . --glob '!frontend/node_modules/**' --glob '!**/__pycache__/**' --glob '!frontend/dist/**'
# no matches
```

Finding: `frontend/data/mock/` appears unreferenced by shipping code, tests, docs, and tooling.

### Static Brief Builder: `monitor_engine/site/`

Command evidence:

```text
rg -n "monitor_engine.site|build_site|site.builder" . --glob '!frontend/node_modules/**' --glob '!**/__pycache__/**' --glob '!frontend/dist/**'
monitor_engine/site/__init__.py:1:from monitor_engine.site.builder import build_site
monitor_engine/pipeline.py:38:from monitor_engine.site.builder import build_site
monitor_engine/pipeline.py:260:    build_site(run_output, config, output_dir)
README.md:104:build_site()          inlines CSS+JS into a single index.html;
tests/test_site.py:29:from monitor_engine.site.builder import build_site
tests/test_site.py:119:        build_site(run_output, config, tmp_path)
```

Finding: static brief generation is still active in `monitor_engine/pipeline.py`; tests and README also reference it. It cannot be deleted until the pipeline call and tests/docs are changed.

### Static Map HTML Renderer: `monitor_engine/targets/_assets/*` and `write_map_site`

Command evidence:

```text
rg -n "map.html|map_targets" . --glob '!frontend/node_modules/**' --glob '!**/__pycache__/**' --glob '!frontend/dist/**'
monitor_engine/targets/__main__.py:46:        f"{map_data.placed_count} placed → {args.output / 'map.html'}"
monitor_engine/targets/build.py:5:  map_targets.json  — MapData artifact (the contract the page reads)
monitor_engine/targets/build.py:6:  map.html          — self-contained interactive map (CSS+JS inlined; Leaflet
monitor_engine/targets/build.py:106:    """Write map_targets.json + a self-contained map.html into output_dir."""
monitor_engine/targets/build.py:118:    (output_dir / "map.html").write_text(html, encoding="utf-8")
README.md:58:write_map_site            map_targets.json (data) + map.html (interactive Leaflet page)
tests/test_targets.py:213:    html = (out / "map.html").read_text()
clients/btx/artifacts/map.html:176:  <script>window.__DATA_URL = 'map_targets.json';</script>
```

Finding: `map_targets.json` is a live data contract and must stay. `map.html` generation is active in `monitor_engine/targets/build.py` and tested in `tests/test_targets.py`; remove only the HTML half after changing code/tests.

### Pages Builder: `tooling/build_pages.py`

Command evidence:

```text
rg -n "build_pages" . --glob '!frontend/node_modules/**' --glob '!**/__pycache__/**' --glob '!frontend/dist/**'
tooling/build_pages.py:11:    python -m tooling.build_pages --clients-dir clients --out _site
tests/test_build_pages.py:7:from tooling.build_pages import build, discover_clients, render_landing
```

Finding: this is legacy static-site publishing support and is only referenced by its tests. Delete with `tests/test_build_pages.py` after workflow/docs no longer use static Pages publishing.

### Committed Static HTML Artifacts

Command evidence:

```text
rg -n "clients/btx/artifacts/index.html|clients/btx/artifacts/map.html|clients/btx/artifacts/sw.js" . --glob '!frontend/node_modules/**' --glob '!**/__pycache__/**' --glob '!frontend/dist/**'
# no matches by full path

rg -n "index.html|map.html|sw.js" README.md monitor_engine tests clients/btx/artifacts --glob '!**/__pycache__/**'
README.md:43:and commits `index.html` + `map.html` + JSON artifacts back to the repo.
monitor_engine/site/builder.py:77:    (output_dir / "index.html").write_text(html, encoding="utf-8")
monitor_engine/site/builder.py:81:    (output_dir / "sw.js").write_text(
monitor_engine/targets/build.py:118:    (output_dir / "map.html").write_text(html, encoding="utf-8")
tests/test_pipeline.py:139:        assert (output_dir / "index.html").exists()
tests/test_targets.py:213:    html = (out / "map.html").read_text()
clients/btx/artifacts/index.html:1218:    navigator.serviceWorker.register('sw.js').catch(() => {});
clients/btx/artifacts/map.html:151:        <a class="brief-link" id="brief-link" href="index.html">← Intelligence brief</a>
```

Finding: `clients/btx/artifacts/index.html`, `map.html`, and `sw.js` are static-site artifacts. They are not referenced by full path, but generic references remain in static-site code/tests/docs.

### Tests Tied To Retired HTML

Command evidence:

```text
rg -n "build_site|index.html|sw.js" tests/test_site.py tests/test_pipeline.py tests/frontend/render.mjs
tests/test_site.py:29:from monitor_engine.site.builder import build_site
tests/test_site.py:120:        assert (tmp_path / "index.html").exists()
tests/test_site.py:129:        assert (tmp_path / "sw.js").exists()
tests/test_pipeline.py:139:        assert (output_dir / "index.html").exists()
tests/frontend/render.mjs:14:const TEMPLATE = join(ROOT, 'monitor_engine', 'site', '_template', 'index.html');

rg -n "map.html|map_targets.json" tests/test_targets.py
tests/test_targets.py:213:    html = (out / "map.html").read_text()
tests/test_targets.py:216:    data = json.loads((out / "map_targets.json").read_text())
```

Finding: delete/rewrite tests after code no longer emits static HTML. Keep JSON contract assertions.

### Demo Data Mode: Keep

Command evidence:

```text
rg -n "DemoDataAdapter|VITE_DATA_MODE|dataMode|Demo fallback" frontend/src frontend/tools frontend/demo frontend/package.json
frontend/src/adapters/createDataAdapter.ts:19:  const mode = urlDataMode() ?? env?.VITE_DATA_MODE ?? processEnv?.VITE_DATA_MODE ?? "demo";
frontend/src/adapters/hybrid/HybridDataAdapter.ts:26:  private demo = new DemoDataAdapter();
frontend/src/adapters/artifact/ArtifactDataAdapter.ts:35:  private demo = new DemoDataAdapter();
frontend/tools/test-metrics.ts:27:  const adapter = new DemoDataAdapter();
frontend/tools/test-rail-tabs.ts:17:  const adapter = new DemoDataAdapter();
frontend/tools/test-tour.ts:17:  const adapter = new DemoDataAdapter();
frontend/tools/test-demo-flows.ts:23:  const adapter = new DemoDataAdapter();
```

Finding: demo data is load-bearing for tests, local dev, artifact fallback, and hybrid fallback. Do not delete.

### Overlapping Assistant Modules: Inventory Target

Command evidence:

```text
rg -n "jarvis|copilot|brainEngine|generateBrainResponse" frontend/src frontend/tools
frontend/src/brain/jarvis.ts:8:import { answer as deterministicAnswer } from "./copilot.ts";
frontend/src/brain/brainEngine.ts:4:import { generateBrainResponse } from "./generateBrainResponse.ts";
frontend/src/app/brainActions.ts:2:import { processBrainQuestionAsync } from "../brain/brainEngine.ts";
frontend/src/ui/copilot/Copilot.tsx:7:import { askJarvis, openingBrief, runHealthCheck, subscribeToLiveStatus, getLiveStatus, dispatchChatpilAction } from "../../brain/jarvis.ts";
frontend/src/ui/brain/BrainHome.tsx:4:import { processBrainQuestion } from "../../brain/brainEngine.ts";
frontend/tools/test-demo-flows.ts:4:import { processBrainQuestion } from "../src/brain/brainEngine.ts";
```

Finding: these modules are referenced. Inventory only unless a specific export is proven dead.

### Frontend Tools

Command evidence:

```text
find frontend/tools -maxdepth 1 -type f -print
```

Referenced by `frontend/package.json`: `cleanup-hubspot.ts`, `generate-demo.ts`, `generate-sample-library.ts`, `run-weekly-memo.ts`, `seed-hubspot.ts`, `test-demo-flows.ts`, `test-live-adapter.ts`, `test-metrics.ts`, `test-rail-tabs.ts`, `test-settings-shell.ts`, `test-tour.ts`.

Referenced by workflows/config/docs: `extract-signals.ts`, `generate-insights.ts`, `copilot-worker.js`, `copilot-proxy.mjs`.

Finding: no frontend tool is safe to remove in the first pass.

## Verification Log

Verification will be appended after each cleanup commit.

### After Task 2: Removed `frontend/data/mock/`

Removal evidence:

```text
rg -n "frontend/data/mock|data/mock" . --glob '!frontend/node_modules/**' --glob '!frontend/dist/**' --glob '!**/__pycache__/**'
# matches only docs/DECLUTTER_REPORT.md
```

Removed files:

```text
frontend/data/mock/companies.json
frontend/data/mock/contacts.json
frontend/data/mock/extracted-signals.json
frontend/data/mock/facilities.json
frontend/data/mock/insights.json
frontend/data/mock/news.json
frontend/data/mock/opportunities.json
frontend/data/mock/signals.json
```

Verification:

```text
cd frontend && npm ci
cd frontend && npm run typecheck
cd frontend && npm run build
cd frontend && npm run test:metrics
cd frontend && npm run test:rail
cd frontend && npm run test:settings
python3 -m pytest -q
SAM_API_KEY=dummy CONGRESS_API_KEY=dummy python3 -m monitor_engine --config clients/btx/config.json --output /tmp/btxout --archive /tmp/btxout/archive.json --skip-analysis
python3 -c "from monitor_engine.models import RunOutput; from pathlib import Path; RunOutput.model_validate_json(Path('/tmp/btxout/run_output.json').read_text()); print('OK')"
```

Result: all listed checks passed. The exact no-env smoke command stopped on missing local `ANTHROPIC_API_KEY`; the local smoke was rerun with `--skip-analysis` and dummy `SAM_API_KEY`/`CONGRESS_API_KEY`, producing valid `run_output.json` and `archive.json`. SAM.gov and Congress.gov emitted expected auth/API source alerts with dummy keys.

### After Task 3.1: Stopped Static HTML Generation

Changed:

- `monitor_engine.pipeline.run_pipeline` now writes `run_output.json` directly and no longer calls `monitor_engine.site.builder.build_site`.
- `run_output.json` still embeds `site_config`; `account_map_url` is now `null` because `map.html` is retired.
- `monitor_engine.targets.write_map_data` now writes only `map_targets.json`.
- Pipeline/target tests were updated to assert JSON outputs remain and retired HTML files are not produced.

Verification:

```text
python3 -m pytest -q tests/test_pipeline.py tests/test_targets.py
SAM_API_KEY=dummy CONGRESS_API_KEY=dummy python3 -m monitor_engine --config clients/btx/config.json --output /tmp/btxout --archive /tmp/btxout/archive.json --skip-analysis
python3 -c "from monitor_engine.models import RunOutput; from pathlib import Path; RunOutput.model_validate_json(Path('/tmp/btxout/run_output.json').read_text()); print('OK')"
SAM_API_KEY=dummy CONGRESS_API_KEY=dummy python3 -m monitor_engine.targets --config clients/btx/config.json --output /tmp/btxmap
test -f /tmp/btxmap/map_targets.json
test ! -f /tmp/btxmap/map.html
cd frontend && npm run typecheck
cd frontend && npm run build
cd frontend && npm run test:metrics
cd frontend && npm run test:rail
cd frontend && npm run test:settings
python3 -m pytest -q
```

Result: all listed checks passed. The monitor smoke produced valid `run_output.json`/`archive.json`; target smoke produced `map_targets.json` and no `map.html`.

### After Task 3.2/3.5: Deleted Dead Static Renderers And Tests

Deletion evidence after Task 3.1:

```text
rg -n "monitor_engine.site|from monitor_engine.site|tooling.build_pages|site/_assets|site/_template|monitor_engine/targets/_assets" . --glob '!frontend/node_modules/**' --glob '!frontend/dist/**' --glob '!**/__pycache__/**'
# remaining matches were only docs/DECLUTTER_REPORT.md plus retired tests/harness before deletion
```

Removed files:

```text
monitor_engine/site/__init__.py
monitor_engine/site/_assets/app.js
monitor_engine/site/_assets/style.css
monitor_engine/site/_assets/sw.js
monitor_engine/site/_template/index.html
monitor_engine/site/builder.py
monitor_engine/targets/_assets/map.css
monitor_engine/targets/_assets/map.html
monitor_engine/targets/_assets/map.js
tooling/build_pages.py
tests/test_site.py
tests/test_build_pages.py
tests/test_frontend.py
tests/frontend/render.mjs
tests/frontend/dom_harness.mjs
tests/frontend/fixtures/sample_run_output.json
```

Also removed the obsolete `monitor_engine.site` package-data entry from `pyproject.toml`.

Verification:

```text
python3 -m pytest -q
SAM_API_KEY=dummy CONGRESS_API_KEY=dummy python3 -m monitor_engine --config clients/btx/config.json --output /tmp/btxout --archive /tmp/btxout/archive.json --skip-analysis
python3 -c "from monitor_engine.models import RunOutput; from pathlib import Path; RunOutput.model_validate_json(Path('/tmp/btxout/run_output.json').read_text()); print('OK')"
SAM_API_KEY=dummy CONGRESS_API_KEY=dummy python3 -m monitor_engine.targets --config clients/btx/config.json --output /tmp/btxmap
test -f /tmp/btxmap/map_targets.json
test ! -f /tmp/btxmap/map.html
cd frontend && npm run typecheck
cd frontend && npm run build
cd frontend && npm run test:metrics
cd frontend && npm run test:rail
cd frontend && npm run test:settings
```

Result: all listed checks passed.

## Task 4 Demo Data Mode Findings

Default mode is now backend-canonical hybrid when neither URL nor build/runtime env chooses a mode.

Command evidence:

```text
rg -n "getDataMode|VITE_DATA_MODE|Falling back" frontend/src/adapters/createDataAdapter.ts
frontend/src/adapters/createDataAdapter.ts:16:export function getDataMode(): DataMode {
frontend/src/adapters/createDataAdapter.ts:19:  const mode = urlDataMode() ?? env?.VITE_DATA_MODE ?? processEnv?.VITE_DATA_MODE ?? "hybrid";
frontend/src/adapters/createDataAdapter.ts:21:  console.warn(`Unknown data mode "${mode}". Falling back to hybrid.`);
```

Explicit demo mode remains available for development and tests through `?dataMode=demo`, `?mode=demo`, or `VITE_DATA_MODE=demo`.

User-facing or shipped demo fallback wiring that remains intentionally:

```text
frontend/src/adapters/createDataAdapter.ts:11:  return new URLSearchParams(window.location.search).get("dataMode")
frontend/src/adapters/createDataAdapter.ts:20:  if (mode === "artifact" || mode === "live" || mode === "demo" || mode === "hybrid") return mode;
frontend/src/adapters/hybrid/HybridDataAdapter.ts:26:  private demo = new DemoDataAdapter();
frontend/src/adapters/hybrid/HybridDataAdapter.ts:41:    return this.demo.getFacilities(filter);
frontend/src/adapters/hybrid/HybridDataAdapter.ts:49:    const [demoSnapshot, artifactSnapshot] = await Promise.all([
frontend/src/adapters/hybrid/HybridDataAdapter.ts:77:          id: "demo-fallback",
frontend/src/adapters/artifact/ArtifactDataAdapter.ts:35:  private demo = new DemoDataAdapter();
frontend/src/adapters/artifact/ArtifactDataAdapter.ts:83:    const companies = await this.demo.getCompanies();
frontend/src/adapters/artifact/ArtifactDataAdapter.ts:111:    if (!artifact || !artifact.signals.length) return this.demo.getSignals(filter);
frontend/src/adapters/artifact/ArtifactDataAdapter.ts:143:          notice: `Artifact mode requested, but ${this.artifactError ?? "artifact signals were unavailable"}. Falling back to demo signals.`,
frontend/src/ui/deliverables/DocumentViewer.tsx:164:    if ((world?.dataMode === "hybrid" || world?.dataMode === "live")) {
frontend/src/ui/deliverables/DocumentViewer.tsx:172:    openDemoAction({ title: "Create CRM task", action: "crm_task", evidence: deliverable.title });
frontend/src/ui/deliverables/DocumentViewer.tsx:234:          <button onClick={() => openDemoAction({ title: "Send via Outlook", action: "follow_up", evidence: "Demo mode - no external writes." })}>Send</button>
frontend/src/App.tsx:203:                Confirm Demo Action
frontend/src/ui/brain/RightContextPanel.tsx:28:          <button key={action} onClick={() => openDemoAction({ title: action, action: "crm_task" })}>{action}</button>
frontend/src/ui/brain/OpportunityCards.tsx:21:              openDemoAction({ title: card.recommendedAction, accountName: card.companyName, action: "crm_task", evidence: card.topSignal });
frontend/src/ui/actions/DemoActionButton.tsx:9:    openDemoAction(action);
frontend/src/ui/settings/SettingsWorkspace.tsx:78:  if (!window.confirm("Reset demo and clear all local state?")) return;
```

Recommendation: keep `DemoDataAdapter` and `frontend/data/demo/btx/` until live backend adapters cover capacity, ERP, operating snapshot, non-deliverable CRM actions, and local settings drafts. The remaining demo action modal is acceptable for non-deliverable actions, but should be replaced with backend write routes one action family at a time.

## Task 5 Assistant Module Inventory

Responsibilities and call graph:

- `frontend/src/brain/jarvis.ts`: Chatpil live/offline assistant. It owns `/llm` health checks, LLM request construction, deterministic fallback, and action dispatch offers.
- `frontend/src/brain/copilot.ts`: deterministic fallback narrator and suggestion generator. `jarvis.ts` imports `answer`; `Copilot.tsx` imports `worldSuggestions`.
- `frontend/src/brain/brainEngine.ts`: classic Ask Brain engine. It classifies a question, retrieves context, and calls `generateBrainResponse`.
- `frontend/src/brain/generateBrainResponse.ts`: pure response composer for the Ask Brain surface.

Command evidence:

```text
rg -n "jarvis|copilot|brainEngine|generateBrainResponse|retrieveContext|processBrainQuestion|askJarvis|openingBrief|runHealthCheck|dispatchChatpilAction|worldSuggestions" frontend/src frontend/tools -g '*.{ts,tsx,js,mjs}'
frontend/src/brain/jarvis.ts:8:import { answer as deterministicAnswer } from "./copilot.ts";
frontend/src/brain/brainEngine.ts:3:import { retrieveContext } from "./retrieveContext.ts";
frontend/src/brain/brainEngine.ts:4:import { generateBrainResponse } from "./generateBrainResponse.ts";
frontend/src/ui/copilot/Copilot.tsx:7:import { askJarvis, openingBrief, runHealthCheck, subscribeToLiveStatus, getLiveStatus, dispatchChatpilAction } from "../../brain/jarvis.ts";
frontend/src/ui/copilot/Copilot.tsx:9:import { worldSuggestions } from "../../brain/copilot.ts";
frontend/src/ui/brain/BrainHome.tsx:4:import { processBrainQuestion } from "../../brain/brainEngine.ts";
frontend/src/app/brainActions.ts:2:import { processBrainQuestionAsync } from "../brain/brainEngine.ts";
frontend/tools/test-demo-flows.ts:4:import { processBrainQuestion } from "../src/brain/brainEngine.ts";
frontend/src/brain/generateBrainResponse.ts:46:export function generateBrainResponse(ctx: RetrievedContext, world: World): BrainResponse {
```

Provably dead exports/files removed:

```text
rg -n "scoreOpportunities" . --glob '!frontend/node_modules/**' --glob '!frontend/dist/**' --glob '!**/__pycache__/**'
# before deletion: only frontend/src/brain/scoreOpportunities.ts exported it
# after deletion: no matches

rg -n "saveBrainNote" frontend/src frontend/tools -g '*.{ts,tsx,js,mjs}'
# before deletion: only frontend/src/brain/saveBrainNote.ts exported it
# after deletion: no matches

rg -n "jarvisLive" frontend/src frontend/tools -g '*.{ts,tsx,js,mjs}'
# before deletion: only frontend/src/brain/jarvis.ts exported it
# after deletion: no matches
```

Recommendation: consolidate toward two assistant surfaces: `jarvis.ts` as the live Chatpil orchestration layer, and a renamed `askBrainEngine.ts` for deterministic analysis workspace behavior. `copilot.ts` should eventually become a fallback helper under `jarvis/` once the UI no longer treats "Copilot" and "Chatpil" as separate concepts.

## Task 6 Dead Code And Packaging Hygiene

Removed provably unreachable assistant helpers:

```text
frontend/src/brain/scoreOpportunities.ts
frontend/src/brain/saveBrainNote.ts
frontend/src/brain/jarvis.ts: removed unreferenced jarvisLive export
```

Updated `.gitignore` to cover local DB patterns broadly:

```text
.venv/
node_modules/
dist/
btx_platform.db
*.db
*.sqlite
*.sqlite3
.env
.env.*
!.env.example
!.env.production.example
```

Tracked ignored-file check:

```text
git ls-files -ci --exclude-standard
# no output
```

Frontend tool sweep:

```text
rg -n "extract-signals|generate-insights|copilot-worker|copilot-proxy|tools/" .github frontend/package.json frontend/wrangler.toml docs README.md ARCHITECTURE.md --glob '!frontend/node_modules/**' --glob '!frontend/dist/**'
frontend/package.json:10:    "gen": "tsx tools/generate-demo.ts && tsx tools/generate-sample-library.ts",
frontend/package.json:13:    "test:metrics": "tsx tools/test-metrics.ts",
frontend/package.json:14:    "test:flows": "tsx tools/test-demo-flows.ts",
frontend/package.json:15:    "test:rail": "tsx tools/test-rail-tabs.ts",
frontend/package.json:16:    "test:settings": "tsx tools/test-settings-shell.ts",
frontend/package.json:17:    "test:tour": "tsx tools/test-tour.ts",
frontend/package.json:18:    "test:live-adapter": "tsx tools/test-live-adapter.ts",
frontend/package.json:19:    "seed:hubspot": "tsx tools/seed-hubspot.ts",
frontend/package.json:20:    "cleanup:hubspot": "tsx tools/cleanup-hubspot.ts",
frontend/package.json:21:    "weekly:memo": "tsx tools/run-weekly-memo.ts"
.github/workflows/insights.yml:34:        run: node tools/generate-insights.ts
.github/workflows/insights.yml:40:        run: node tools/extract-signals.ts
frontend/wrangler.toml:5:main = "tools/copilot-worker.js"
docs/MANUAL_QA.md:40:6. Ask Chatpil a simple question while pointed at `/llm`. Confirm the LIVE badge recovers and no local `copilot-proxy.mjs` process is required.
```

Finding: no additional `frontend/tools/*` file is safe to remove in this pass.

## Final Verification

Commands run after the final cleanup pass:

```text
cd frontend && npm ci
cd frontend && npm run typecheck
cd frontend && npm run build
cd frontend && npm run test:metrics
cd frontend && npm run test:rail
cd frontend && npm run test:settings
python3 -m pytest -q
SAM_API_KEY=dummy CONGRESS_API_KEY=dummy python3 -m monitor_engine --config clients/btx/config.json --output /tmp/btxout --archive /tmp/btxout/archive.json --skip-analysis
python3 -c "from monitor_engine.models import RunOutput; from pathlib import Path; RunOutput.model_validate_json(Path('/tmp/btxout/run_output.json').read_text()); assert Path('/tmp/btxout/archive.json').exists(); assert not Path('/tmp/btxout/index.html').exists(); print('OK')"
SAM_API_KEY=dummy CONGRESS_API_KEY=dummy python3 -m monitor_engine.targets --config clients/btx/config.json --output /tmp/btxmap
test -f /tmp/btxmap/map_targets.json
test ! -f /tmp/btxmap/map.html
```

Results:

- `npm ci`: passed; npm reported existing dependency deprecation/audit warnings.
- `npm run typecheck`: passed.
- `npm run build`: passed; Vite reported the existing large chunk warning.
- `npm run test:metrics`: passed.
- `npm run test:rail`: passed.
- `npm run test:settings`: passed.
- `python3 -m pytest -q`: `354 passed, 1 warning`.
- Monitor smoke: valid `run_output.json` and `archive.json`; no `index.html`. SAM.gov and Congress.gov raised expected source alerts with dummy local keys.
- Target smoke: valid `map_targets.json`; no `map.html`.

Known pre-existing failures from the task prompt, not rerun as part of the required suite: `npm run test:flows` and `npm run test:tour` may crash on `import.meta.env` in `frontend/src/app/llmConfig.ts`.

Follow-ups:

- `clients/btx/artifacts/run_output.json` is a kept committed JSON artifact from before static HTML retirement and may still contain an old `account_map_url` value. The next monitor run will refresh the JSON contract with `account_map_url: null`.
- The cockpit still has intentional demo scaffolding for non-deliverable actions, capacity/ERP/operating fallback data, local settings drafts, and dev/test fixture mode.

### After Task 3.4: Updated CI And Pages Publishing

Changed:

- `.github/workflows/monitor.yml` now describes and validates JSON artifacts, with `map_targets.json` as the account-map output.
- `.github/workflows/pages.yml` publishes the cockpit under `/cockpit/` and only selected JSON artifacts under `/btx/`: `run_output.json`, `archive.json`, `map_targets.json`.
- Removed `VITE_BACKEND_AUTH_TOKEN` from the Pages workflow `workflow_call` secrets and frontend build environment per the auth follow-up instruction.

Verification:

```text
VITE_DATA_MODE=hybrid VITE_BACKEND_ENDPOINT=https://btx-platform.fly.dev VITE_COPILOT_ENDPOINT=https://btx-platform.fly.dev/llm VITE_ARTIFACT_BASE_URL=../btx VITE_COCKPIT_PASSWORD_HASH=0000000000000000000000000000000000000000000000000000000000000000 npm run build
python3 -m pytest -q
SAM_API_KEY=dummy CONGRESS_API_KEY=dummy python3 -m monitor_engine --config clients/btx/config.json --output /tmp/btxout --archive /tmp/btxout/archive.json --skip-analysis
python3 -c "from monitor_engine.models import RunOutput; from pathlib import Path; RunOutput.model_validate_json(Path('/tmp/btxout/run_output.json').read_text()); print('OK')"
SAM_API_KEY=dummy CONGRESS_API_KEY=dummy python3 -m monitor_engine.targets --config clients/btx/config.json --output /tmp/btxmap
test -f /tmp/btxmap/map_targets.json
test ! -f /tmp/btxmap/map.html
cd frontend && npm run typecheck
cd frontend && npm run test:metrics
cd frontend && npm run test:rail
cd frontend && npm run test:settings
```

Result: all listed checks passed. Follow-up: backend-authenticated frontend calls will need a safer runtime auth design; the build no longer bakes `VITE_BACKEND_AUTH_TOKEN`.

### After Docs/API Name Cleanup

Changed:

- Rewrote `README.md` and `ARCHITECTURE.md` around the backend-canonical architecture.
- Updated Pages/backend/manual-QA/HubSpot-task docs to remove stale static-site and build-time backend token guidance.
- Renamed `monitor_engine.targets.write_map_site` to `write_map_data` after grep showed only internal/test references.

Verification:

```text
python3 -m pytest -q tests/test_targets.py
SAM_API_KEY=dummy CONGRESS_API_KEY=dummy python3 -m monitor_engine.targets --config clients/btx/config.json --output /tmp/btxmap
test -f /tmp/btxmap/map_targets.json
test ! -f /tmp/btxmap/map.html
cd frontend && npm run typecheck && npm run build && npm run test:metrics && npm run test:rail && npm run test:settings
python3 -m pytest -q
```

Result: all listed checks passed.

### After Task 3.3: Removed Committed Static HTML Artifacts

Deletion evidence:

```text
rg -n "clients/btx/artifacts/index.html|clients/btx/artifacts/map.html|clients/btx/artifacts/sw.js" . --glob '!frontend/node_modules/**' --glob '!frontend/dist/**' --glob '!**/__pycache__/**'
# matches only historical evidence in docs/DECLUTTER_REPORT.md
```

Removed files:

```text
clients/btx/artifacts/index.html
clients/btx/artifacts/map.html
clients/btx/artifacts/sw.js
```

Kept JSON artifacts:

```text
clients/btx/artifacts/run_output.json
clients/btx/artifacts/archive.json
clients/btx/artifacts/map_targets.json
```

Verification:

```text
python3 -m pytest -q
SAM_API_KEY=dummy CONGRESS_API_KEY=dummy python3 -m monitor_engine --config clients/btx/config.json --output /tmp/btxout --archive /tmp/btxout/archive.json --skip-analysis
python3 -c "from monitor_engine.models import RunOutput; from pathlib import Path; RunOutput.model_validate_json(Path('/tmp/btxout/run_output.json').read_text()); print('OK')"
SAM_API_KEY=dummy CONGRESS_API_KEY=dummy python3 -m monitor_engine.targets --config clients/btx/config.json --output /tmp/btxmap
test -f /tmp/btxmap/map_targets.json
test ! -f /tmp/btxmap/map.html
cd frontend && npm run typecheck && npm run build && npm run test:metrics && npm run test:rail && npm run test:settings
```

Result: all listed checks passed.
