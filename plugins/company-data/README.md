# Company Data Plugin

The Company Data plugin is the package-owned source boundary for the
first-party operational facts substrate. This slice publishes the stable
catalog identity and normal ThinkWork install path before any live Company Data
runtime exists.

The shell intentionally does not deploy extraction runners, projection database
schema, mapping workflows, schedules, pipelines, MCP servers, skills,
credentials, datalake, warehouse, query engine, monitoring, analytics UI, BI,
Context Engine providers, live operator UI, source-system writes, or
Terraform-managed resources. Future Company Data work should extend this
`company-data` package and version line with explicit requirements,
handler-backed components, and deployed verification before introducing runtime
capability.

## Owned Source

- `src/manifest.ts` declares the catalog manifest with empty OAuth scopes,
  no capabilities, and one declared-only `ui-surface` component.
- `test/manifest.test.ts` validates the shell boundary, manifest shape,
  customer-facing operational facts copy, and deferred-resource language.

## Shell Scope

V1 is deliberately narrow:

- Company Data appears in the first-party plugin catalog as
  `company-data@0.1.0`.
- Tenant administrators can install the shell through the normal plugin
  install flow.
- The plugin engine records only the install and one no-op UI-surface component
  with an empty handler reference.
- Live extraction runtime, projection schema, mapping workflows, schedules,
  pipelines, MCP servers, skills, credentials, Context Engine providers,
  analytics UI, BI, lakehouse query UI, source-system writes, and
  infrastructure are deferred follow-up work.

## Verification Notes

Package-local verification:

```bash
pnpm --filter @thinkwork/plugin-company-data test
pnpm --filter @thinkwork/plugin-company-data typecheck
pnpm --filter @thinkwork/plugin-catalog test
pnpm --filter @thinkwork/plugin-catalog typecheck
node scripts/verify-plugin-source-boundary.mjs
```
