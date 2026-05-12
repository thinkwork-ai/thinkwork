# @thinkwork/runbooks

Compatibility adapter for repo-authored Computer runbooks.

Computer runbooks are now standard Agent Skill directories under `packages/skill-catalog/<slug>/`. The `@thinkwork/runbooks` package remains as a compatibility layer while API routing and execution migrate to direct skill discovery. It reads runbook-capable skills and adapts their `references/thinkwork-runbook.json` contracts into the existing `RunbookDefinition` shape.

## Layout

```text
packages/skill-catalog/<slug>/
  SKILL.md
  references/thinkwork-runbook.json
  references/<phase>.md
  assets/*
packages/runbooks/
  src/schema.ts
  src/loader.ts
  src/registry.ts
```

## Add a runbook

1. Create `packages/skill-catalog/<slug>/SKILL.md`.
2. Mark the skill with `metadata.thinkwork_kind: computer-runbook`.
3. Add `references/thinkwork-runbook.json`.
4. Add phase Markdown files referenced by `phases[].guidance`.
5. Keep the phase ids ordered around user-visible work, usually `discover`, `analyze`, `produce`, `validate`.
6. Use capability roles such as `research`, `analysis`, `artifact_build`, `map_build`, and `validation`; do not name concrete specialist agents.
7. Put output schemas, layout recipes, examples, or validation fixtures under `assets/`.
8. Add tests under `packages/skill-catalog/__tests__` when the runbook introduces new shape, routing, roles, or output expectations.
9. Run:

```sh
pnpm --filter @thinkwork/skill-catalog test -- runbook-skill-contract
pnpm --filter @thinkwork/runbooks test
pnpm --filter @thinkwork/runbooks typecheck
pnpm --filter @thinkwork/runbooks build
```

## Initial runbooks

- `crm-dashboard` - opinionated CRM dashboard artifact.
- `research-dashboard` - generic evidence-backed dashboard artifact.
- `map-artifact` - map-centered artifact using the Computer artifact path.

## Contract

Runbooks are ThinkWork-published starter skills in v1. Future tenant/operator editing should install, edit, or fork skill directories while preserving the runbook contract validator and the `overrides.allowedFields` boundary.
