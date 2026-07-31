# Reproducible release gate

Supported runtime: Node.js `22.18.0`.

Use `nvm use` from the repository root before running frontend commands. The CI
and deployment workflows read `.nvmrc`; local Node 26+ is intentionally treated
as unsupported for release-critical runs because native `tsx`/`esbuild`
optional packages can resolve differently from CI.

## Required gate

From `frontend/`:

```sh
npm ci
npm run test:release-critical
```

The release-critical gate covers:

- Node/runtime doctor check.
- Production dependency audit and checked development-risk acceptance.
- Build, typecheck, lint, static design/voice checks.
- Unit/static regression suites for metrics, CRM write gating, routing, missing
  data, Ask/evidence quality, settings/accessibility, mobile contracts, and the
  generated control harness.
- Browser E2E and mobile visual/workflow smoke tests.
- Deployment smoke coverage for commit identity, environment truth, demo
  banner, canonical metric parity, route load budget, Ask source-routing
  contract, and external-write freeze.

Deploy workflows must run the same gate before publishing. A deployment is not
releaseable if any release-critical step fails.

## Native `tsx` / `esbuild` execution

Do not execute TypeScript tools with plain `node tools/*.ts`. Use `tsx` through
package scripts or `npx tsx tools/<script>.ts`. The bake workflow follows this
rule so the native `esbuild` package selected by `npm ci` matches the pinned
Node runtime.
