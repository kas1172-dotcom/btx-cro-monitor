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

The Enterprise Brain remains at the Pages root, and the monitor is also copied
under the cockpit index:

```text
https://kas1172-dotcom.github.io/btx-cro-monitor/
https://kas1172-dotcom.github.io/btx-cro-monitor/cockpit/btx/
```

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

## Workflow Behavior

- `.github/workflows/monitor.yml` remains manual-dispatch only.
- The pipeline writes the BTX static site into `clients/btx/artifacts/`.
- `.github/workflows/pages.yml` assembles the Pages artifact in `_site/`.
- The BTX brief is copied to `_site/btx/` for the direct public URL.
- Pages deployments are serialized by the `pages` concurrency group.
