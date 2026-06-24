# Company ETL Plugin

The Company ETL plugin is the package-owned source boundary for the first-party
ETL integration shell. This slice publishes the stable catalog
identity and normal ThinkWork install path before any live integration runtime
exists.

The shell intentionally does not deploy connector runtime, ETL jobs, schedules,
pipelines, MCP servers, skills, credentials, datalake, warehouse, query,
monitoring, analytics UI, BI, bucket, warehouse, or Terraform-managed resources.
Future Company ETL work should extend this `company-etl` package and version
line with explicit requirements, handler-backed components, and deployed
verification before introducing runtime capability.

## Owned Source

- `src/manifest.ts` declares the catalog manifest with empty OAuth scopes,
  no capabilities, and one declared-only `ui-surface` component.
- `test/manifest.test.ts` validates the shell boundary, manifest shape,
  customer-facing integration copy, and deferred-resource language.

## Shell Scope

V1 is deliberately narrow:

- Company ETL appears in the first-party plugin catalog as
  `company-etl@0.1.0`.
- Tenant administrators can install the shell through the normal plugin
  install flow.
- The plugin engine records only the install and one no-op UI-surface component
  with an empty handler reference.
- Live connector runtime, ETL jobs, schedules, pipelines, MCP servers, skills,
  credentials, analytics UI, BI, lakehouse query UI, and infrastructure are
  deferred follow-up work.

## Verification Notes

Package-local verification:

```bash
pnpm --filter @thinkwork/plugin-company-etl test
pnpm --filter @thinkwork/plugin-company-etl typecheck
pnpm --filter @thinkwork/plugin-catalog test
pnpm --filter @thinkwork/plugin-catalog typecheck
node scripts/verify-plugin-source-boundary.mjs
```
