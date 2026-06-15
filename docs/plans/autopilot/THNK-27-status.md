# THNK-27 Autopilot Status

Issue: THNK-27 Add Plane Plugin

## Current State

- Linear state: `In Progress`.
- Labels: `Codex`, `Feature`.
- Active branch: `codex/thnk-27-plane-manifest`.
- Active unit: U2 Plugin Manifest and Catalog Entry.
- U2 local verification complete; PR open for CI/review.

## Context Discovered

- Linear issue has no child issues, blockers, related issues, attachments, or
  customer needs.
- Linear documents point to repo-local requirements and plan files that were not
  present on `origin/main`; this branch restores concise repo-local copies from
  Linear context.
- Plane docs confirm Docker self-hosting, external Postgres/Redis/S3 support,
  RabbitMQ variables, and an official MCP server.
- Plane MCP HTTP PAT mode requires `x-api-key` and `x-workspace-slug` request
  headers. Current ThinkWork plugin MCP dispatch supports OAuth/bearer and
  `auth: none`, so Plane MCP activation is a later unit before publishing the
  MCP component.

## Implementation Units

- [x] U1 Plane Contract Proof
- [x] U2 Plugin Manifest and Catalog Entry
- [ ] U3 Plane Managed-App Adapter
- [ ] U4 Plane Terraform Runtime Module
- [ ] U5 Per-User Plane MCP Activation
- [ ] U6 Plane Issue-Loop Skill
- [ ] U7 Plane Seed and End-to-End Smoke
- [ ] U8 Release Packaging and Controller Wiring
- [ ] U9 Docs, Rollout, and Operator Copy

## PRs

- U1 Plane Contract Proof:
  `https://github.com/thinkwork-ai/thinkwork/pull/2488` merged at
  `d4614c5f78f325c8bde77e4e4be3147d640cc7bd`.
- U2 Plugin Manifest and Catalog Entry:
  `https://github.com/thinkwork-ai/thinkwork/pull/2489` opened from
  `codex/thnk-27-plane-manifest`.

## Verification Log

- `pnpm --filter @thinkwork/deployment-runner test` passed.
- `pnpm --filter @thinkwork/deployment-runner typecheck` passed.
- `pnpm --filter @thinkwork/api test -- managed-applications.test.ts` passed.
- `pnpm --filter @thinkwork/api typecheck` passed.
- `pnpm format:check` currently fails because the root `format:check` script
  invokes `prettier`, but Prettier is not installed or declared in this
  workspace. Touched files were formatted with
  `pnpm dlx prettier@3.6.2 --write ...`.
- U2: `pnpm --filter @thinkwork/plugin-catalog test -- plane-manifest.test.ts`
  passed.
- U2: `pnpm --filter @thinkwork/plugin-catalog typecheck` passed.
- U2: `pnpm --filter @thinkwork/plugin-catalog test` passed.

## Decisions

- Do not register Plane in the published plugin catalog until the Terraform
  module and per-user MCP activation path are executable.
- Start with the adapter contract and proof tests so later Terraform/catalog
  units have a stable shape.
- Plane is registered in the deployment runner for contract proofing, but is
  hidden from the operator managed-app catalog with `catalogVisible: false`
  until the runtime module and release/controller wiring are ready.
- Plane manifest is exported for tests and later units, but is not added to
  `allPluginManifests` until the Terraform runtime and per-user MCP activation
  path are executable.
