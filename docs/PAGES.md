# GitHub Pages Publishing

GitHub Pages publishes the React cockpit and the monitor JSON artifacts. The retired Python static brief/map HTML is no longer published.

Public URLs for this repository:

```text
https://kas1172-dotcom.github.io/btx-cro-monitor/
https://kas1172-dotcom.github.io/btx-cro-monitor/cockpit/
https://kas1172-dotcom.github.io/btx-cro-monitor/btx/run_output.json
https://kas1172-dotcom.github.io/btx-cro-monitor/btx/archive.json
https://kas1172-dotcom.github.io/btx-cro-monitor/btx/map_targets.json
```

## Required Repo Setting

GitHub Pages must be enabled from the repository UI:

1. Open the repository on GitHub.
2. Go to **Settings**.
3. Select **Pages** in the left sidebar.
4. Under **Build and deployment**, set **Source** to **GitHub Actions**.
5. Save the setting if GitHub shows a save button.

## Required Repo Secrets

The cockpit is built by GitHub Actions, so production Vite values come from repository secrets:

```text
VITE_BACKEND_ENDPOINT=https://btx-platform.fly.dev
VITE_COCKPIT_PASSWORD=<demo access password>
```

`VITE_COCKPIT_PASSWORD` is hashed during the workflow and only the SHA-256 digest is bundled into the static frontend. This is a light demo-safety gate, not real authentication.

The Pages build intentionally does not bundle a shared backend bearer token. Browser-safe backend auth is deferred to WP10; protected backend calls may reject public cockpit requests until then.

## Workflow Behavior

- `.github/workflows/monitor.yml` (`10 Monitor Pipeline`) remains manual-dispatch only.
- The monitor pipeline writes JSON artifacts into `clients/btx/artifacts/`.
- `.github/actions/deploy-pages/action.yml` builds `frontend/` and assembles the Pages artifact in `_site/`.
- The cockpit is copied to `_site/cockpit/`.
- `run_output.json`, `archive.json`, and `map_targets.json` are copied to `_site/btx/`.
- Pages deployments are serialized by the `pages` concurrency group.

## Frontend Build Values

The Pages workflow sets:

```text
VITE_DATA_MODE=hybrid
VITE_BACKEND_ENDPOINT=https://btx-platform.fly.dev
VITE_COPILOT_ENDPOINT=https://btx-platform.fly.dev/llm
VITE_ARTIFACT_BASE_URL=../btx
```

Run **30 Deploy Frontend Cockpit** from the Actions tab to republish without re-running the monitor pipeline.
