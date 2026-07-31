# Development dependency risk acceptance

Date: 2026-07-31

`npm audit --json` currently reports high-severity findings only in the
frontend development toolchain, collapsed by npm into these vulnerability
groups:

- `@eslint/config-array`
- `@eslint/eslintrc`
- `brace-expansion`
- `eslint`
- `eslint-plugin-jsx-a11y`
- `minimatch`

The vulnerable path is the ESLint/minimatch/brace-expansion toolchain used by
local and CI checks. It is not bundled into the Vite production artifact and is
not installed in production runtime environments.

Release gate treatment:

- `npm audit --omit=dev --audit-level=high` must pass.
- `npm run audit:dev-risk` must prove every remaining high/critical finding is
  on the allowlist above.
- Any new production finding, critical finding, or unallowlisted development
  finding fails CI.

Risk acceptance expires on 2026-09-30 or earlier if upstream patched ESLint /
jsx-a11y releases are available without a breaking downgrade/major migration.
