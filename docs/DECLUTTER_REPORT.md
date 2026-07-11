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
- `monitor_engine.targets.write_map_site` now writes only `map_targets.json`.
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
