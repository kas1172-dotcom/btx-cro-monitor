# GitHub Pages Publishing

The BTX brief is deployed by GitHub Actions after the manual Monitor Pipeline
finishes. The workflow publishes the static files generated in:

```text
clients/btx/artifacts/
```

The direct public URL for the current BTX defense monitor is:

```text
https://<owner>.github.io/<repo>/btx/
```

For this repository, the expected URL is:

```text
https://kas1172-dotcom.github.io/btx-cro-monitor/btx/
```

The backend-connected cockpit is deployed beside the brief under:

```text
https://kas1172-dotcom.github.io/btx-cro-monitor/cockpit/
```

The Pages root is a lightweight index that links to both public entry points.

## Required Repo Setting

GitHub Pages must be enabled from the repository UI:

1. Open the repository on GitHub.
2. Go to **Settings**.
3. Select **Pages** in the left sidebar.
4. Under **Build and deployment**, set **Source** to **GitHub Actions**.
5. Save the setting if GitHub shows a save button.

The workflow cannot reliably toggle this setting from code. Once enabled, the
manual **Monitor Pipeline** workflow publishes the latest generated BTX brief
through the reusable **Deploy Pages** workflow.

## Required Repo Secrets

The cockpit is built by GitHub Actions, so production Vite values come from
repository secrets:

```text
VITE_BACKEND_ENDPOINT=https://btx-platform.fly.dev
VITE_BACKEND_AUTH_TOKEN=<same value as BTX_BACKEND_AUTH_TOKEN on Fly>
VITE_COCKPIT_PASSWORD=<demo access password>
```

`VITE_COCKPIT_PASSWORD` is hashed during the workflow and only the SHA-256
digest is bundled into the static frontend. This is a light demo-safety gate,
not real authentication. Because the backend bearer token is still bundled into
the browser build, do not treat this as customer-grade access control.

## Workflow Behavior

- `.github/workflows/monitor.yml` remains manual-dispatch only.
- `.github/workflows/deploy-frontend.yml` manually republishes the cockpit
  without rerunning the monitor.
- The monitor pipeline writes the BTX static site into `clients/btx/artifacts/`.
- `.github/workflows/pages.yml` assembles the Pages artifact in `_site/`.
- The cockpit is copied to `_site/cockpit/`.
- The BTX brief is copied to `_site/btx/` for the direct public URL.
- Artifact mode fetches monitor JSON at `../btx/run_output.json` and
  `../btx/archive.json` from the cockpit page.
- Pages deployments are serialized by the `pages` concurrency group.
