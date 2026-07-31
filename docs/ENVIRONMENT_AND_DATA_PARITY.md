# Environment and data parity

`GET /environment` is the canonical, non-secret deployment contract. It reports
demo status, tenant identity, Clerk key class, source type, external-write
capability, provenance, and deployed/expected revision. Demo deployments must
set `BTX_DEPLOYMENT_MODE=demo`; production must set
`BTX_DEPLOYMENT_MODE=production` and use Clerk live credentials.

The reconciled seed baseline revision is `779198f`. Demo resets persist this revision in
`tenants.demo_metadata.repositoryRevision`, and verification fails if it drifts.

Deployment order:

1. Set `BTX_DEPLOYED_REVISION` to the deployed Git SHA. Keep
   `BTX_EXPECTED_REPOSITORY_REVISION=779198f` until a reviewed seed migration
   deliberately advances both the expected and persisted seed revisions.
2. Run `alembic upgrade head`.
3. For the demo tenant, run
   `python3 tooling/reset_demo_tenant.py --tenant btx-demo-command-cockpit`.
4. Verify schema, seed, and API truth with:
   `python3 tooling/verify_deployment_parity.py --api-url https://API_HOST`.
5. Only serve the new revision after verification succeeds.

Never use `create_all()` in production. Never hand-edit demo tenant rows; reset
them through the repository tool so code, schema, and seed remain atomic and
auditable.
