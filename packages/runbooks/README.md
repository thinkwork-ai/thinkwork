# @thinkwork/runbooks

Repo-authored Computer runbooks.

Runbooks are YAML plus Markdown product definitions for substantial Computer work. They are the source of truth for routing hints, approval copy, phases, expected outputs, capability roles, and progress semantics.

## Layout

```text
packages/runbooks/
  runbooks/<slug>/runbook.yaml
  runbooks/<slug>/phases/<phase>.md
  src/schema.ts
  src/loader.ts
  src/registry.ts
```

## Add a runbook

1. Create `runbooks/<slug>/runbook.yaml`.
2. Add phase Markdown files referenced by `phases[].guidance`.
3. Keep the phase ids ordered around user-visible work, usually `discover`, `analyze`, `produce`, `validate`.
4. Use capability roles such as `research`, `analysis`, `artifact_build`, `map_build`, and `validation`; do not name concrete specialist agents.
5. Add tests under `src/__tests__` when the runbook introduces new shape, routing, roles, or output expectations.
6. Run:

```sh
pnpm --filter @thinkwork/runbooks test
pnpm --filter @thinkwork/runbooks typecheck
pnpm --filter @thinkwork/runbooks build
```

## Initial runbooks

- `crm-dashboard` - opinionated CRM dashboard artifact.
- `research-dashboard` - generic evidence-backed dashboard artifact.
- `map-artifact` - map-centered artifact using the Computer artifact path.

## Contract

Runbooks are ThinkWork-published in v1. Future tenant/operator editing should use the `overrides.allowedFields` boundary instead of mutating arbitrary definition fields.
