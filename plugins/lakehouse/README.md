# LakeHouse Plugin

The LakeHouse plugin is the package-owned source boundary for the first-party
LakeHouse solution shell and the first Meltano edge-runner contracts. The
catalog manifest remains intentionally inert; runtime code in this package
defines the reviewable bundle, local runner, MCP safety, evidence, and parity
contracts that future control-plane slices consume.

The manifest intentionally does not deploy datalake, warehouse, query,
monitoring, automation, MCP, skill, credential, schedule, pipeline, bucket,
warehouse, or Terraform-managed resources. Edge-runner helpers in this package
are deterministic local building blocks only: they verify signed bundle
contracts, materialize clean project directories, build allowlisted Meltano
commands, redact logs, and produce payload-light evidence. Future slices must
wire these contracts through handler-backed control-plane components and
deployed verification before introducing live runtime capability.

## Owned Source

- `src/manifest.ts` declares the catalog manifest with empty OAuth scopes,
  no capabilities, and one declared-only `ui-surface` component.
- `src/edge-integration/` defines the signed Meltano bundle, extract, evidence,
  and policy contracts used by the runner and control surfaces.
- `runner/src/` contains local pull-before-run helpers for bundle verification,
  clean materialization, local secret references, allowlisted Meltano argv, and
  payload-light evidence capture.
- `mcp/src/` exposes structured, redacted read-only tools and policy-gated
  write helpers with audit envelopes. It does not expose arbitrary shell or raw
  Meltano CLI arguments.
- `parity/src/` creates McPherson/Fivetran comparison reports from structured
  run evidence without raw source rows.
- `test/manifest.test.ts` validates the shell boundary, manifest shape, and
  deferred-resource language.
- `test/edge-integration-contract.test.ts` validates the contract, runner, MCP,
  and parity helper behavior.

## Shell Scope

V1 is deliberately narrow:

- LakeHouse appears in the first-party plugin catalog as `lakehouse@0.1.0`.
- Tenant administrators can install the shell through the normal plugin
  install flow.
- The plugin engine records only the install and one no-op UI-surface component
  with an empty handler reference.
- Live datalake, warehouse, query, monitoring, automation, MCP server
  registration, skills, credentials, and infrastructure are deferred follow-up
  work.
- Meltano is the local execution substrate, not the customer-facing product or
  the canonical authoring path. Durable configuration changes must flow through
  ThinkWork review, approval, and signed immutable bundle publication.

## Verification Notes

Package-local verification:

```bash
pnpm --filter @thinkwork/plugin-lakehouse test
pnpm --filter @thinkwork/plugin-lakehouse typecheck
pnpm --filter @thinkwork/plugin-catalog test
pnpm --filter @thinkwork/plugin-catalog typecheck
node scripts/verify-plugin-source-boundary.mjs
```
