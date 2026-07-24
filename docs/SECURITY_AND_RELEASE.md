# Security And Release

## Runtime Secrets

Do not commit `.env`, database files, token exports, generated build output, or downloaded dependency folders. CI runs `python3 tooling/secret_scan.py` to block common secret patterns and tracked local artifacts.

Rotate any token that was pasted into a terminal, screenshot, document, or issue before sharing the repository. For Fly.io deploys, set secrets one at a time with `flyctl secrets set --app <app> NAME=VALUE`.

## Frontend Auth

The static frontend receives only browser-safe values:

```text
VITE_BACKEND_ENDPOINT
VITE_COPILOT_ENDPOINT
VITE_CLERK_PUBLISHABLE_KEY
```

There is no shared cockpit password and no bundled backend bearer token. The backend validates the signed-in user's Clerk session token on each protected request.

## Source Archives

Create a source-only release archive from the current Git commit with:

```bash
python3 tooling/create_source_archive.py --output /tmp/btx-cro-monitor-source.tar.gz
```

The archive is built with `git archive`, so it contains tracked source files only.
