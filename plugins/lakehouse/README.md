# LakeHouse Plugin

The LakeHouse plugin is the package-owned source boundary for the first-party
LakeHouse solution shell. This slice publishes the stable catalog identity and
normal ThinkWork install path before any live data platform runtime exists.

The shell intentionally does not deploy datalake, warehouse, query, monitoring,
automation, MCP, skill, credential, schedule, pipeline, bucket, warehouse, or
Terraform-managed resources. Future LakeHouse work should extend this
`lakehouse` package and version line with explicit requirements, handler-backed
components, and deployed verification before introducing runtime capability.

## Owned Source

- `src/manifest.ts` declares the catalog manifest with empty OAuth scopes,
  no capabilities, and one declared-only `ui-surface` component.
- `test/manifest.test.ts` validates the shell boundary, manifest shape, and
  deferred-resource language.

## Shell Scope

V1 is deliberately narrow:

- LakeHouse appears in the first-party plugin catalog as `lakehouse@0.1.0`.
- Tenant administrators can install the shell through the normal plugin
  install flow.
- The plugin engine records only the install and one no-op UI-surface component
  with an empty handler reference.
- Live datalake, warehouse, query, monitoring, automation, MCP, skills,
  credentials, and infrastructure are deferred follow-up work.

## Verification Notes

Package-local verification:

```bash
pnpm --filter @thinkwork/plugin-lakehouse test
pnpm --filter @thinkwork/plugin-lakehouse typecheck
pnpm --filter @thinkwork/plugin-catalog test
pnpm --filter @thinkwork/plugin-catalog typecheck
node scripts/verify-plugin-source-boundary.mjs
```
