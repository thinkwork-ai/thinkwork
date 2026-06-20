---
linear: THNK-54
title: n8n to ThinkWork Agent
status: active
started: 2026-06-20
target_branch: main
---

# THNK-54 Autopilot Status

## Dispatcher Marker

`dispatcher:THNK-54:ReadyToWork:Codex`

## Context Discovery

- Read `AGENTS.md`.
- Read Linear issue `THNK-54`, including description, state history, labels,
  project, cycle, related issues, attached documents, and relation metadata.
- Read Linear comments for `THNK-54`.
- Read attached Linear document `Requirements: n8n to ThinkWork Agent-Step Bridge`.
- Read attached Linear document `Plan: Add n8n agent-step bridge`.
- Confirmed Linear reports no child issues for `THNK-54`.
- Confirmed `THNK-54` has no blockers and is related to `THNK-50`.
- Read related Linear issue `THNK-50`, including relation metadata and attached
  docs.
- Read `THNK-50` comments for current n8n plugin deployment state and MCP
  version evidence.
- Read `docs/brainstorms/2026-06-20-n8n-thinkwork-agent-step-bridge-requirements.md`.
- Read `docs/brainstorms/2026-06-19-n8n-application-plugin-requirements.md`.
- Read `docs/plans/2026-06-19-003-feat-n8n-application-plugin-plan.md`.
- Read required solution context:
  - `docs/solutions/architecture-patterns/plugin-source-boundaries-package-owned-deploy-verified-2026-06-17.md`
  - `docs/solutions/architecture-patterns/managed-app-mcp-oauth-lifecycle-2026-06-06.md`
  - `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
- Repo search found the THNK-54 requirements doc on `main`; the referenced
  local plan file was missing and has been materialized at
  `docs/plans/2026-06-20-001-feat-n8n-agent-step-bridge-plan.md` from the
  approved Linear plan.

## Plan Source and Conflict Resolution

Primary plan:
`docs/plans/2026-06-20-001-feat-n8n-agent-step-bridge-plan.md`

The newest attached Linear implementation plan is authoritative. It is
consistent with the repo-local requirements document and THNK-50 n8n managed
application direction. No product-scope conflict was found during discovery.

## Implementation Units

1. U1 - Add bridge-run data model and contract types.
2. U2 - Implement bridge credentialing and the start endpoint.
3. U3 - Wire finalization and human-hold behavior.
4. U4 - Deliver n8n resume callbacks with retry and expiry.
5. U5 - Expose bridge telemetry in API and web surfaces.
6. U6 - Document the n8n workflow recipe and operator runbook.
7. U7 - Add end-to-end bridge smoke coverage.

## Dependency Order

U1 -> U2 -> U3 -> U4 -> U5 -> U6 -> U7.

## Linear State Changes

- 2026-06-20: moved `THNK-54` from `Ready to Work` to `In Progress` when U1
  implementation began.
- 2026-06-20: moved `THNK-54` from `In Progress` to `Verification` after U1
  PR opened. The team has no exact `Review` status, so `Verification` is the
  closest review-state equivalent.
- 2026-06-20: kept `THNK-54` in `Verification` while U1 PR checks ran and
  auto-merge completed.
- 2026-06-20: moved `THNK-54` from `Verification` back to `In Progress` when
  U2 implementation began.
- 2026-06-20: moved `THNK-54` from `In Progress` back to `Verification` after
  U2 PR opened. The team has no exact `Review` status, so `Verification` is the
  closest review-state equivalent.

## Active Unit

### U2 - Implement bridge credentialing and the start endpoint

Objective: let stock n8n HTTP Request nodes start or replay an agent-step run
through a tenant-scoped bridge credential, creating or reusing the bridge-run
row and dispatching the corresponding ThinkWork agent turn.

Branch: `codex/thnk-54-u2-n8n-start-endpoint`

Planned files:

- `plugins/n8n/src/manifest.ts`
- `plugins/n8n/src/deployment/managed-app.ts`
- `plugins/n8n/test/manifest.test.ts`
- `packages/api/src/graphql/resolvers/plugins/n8n-settings.ts`
- `packages/api/src/graphql/resolvers/plugins/n8n-settings.test.ts`
- `apps/web/src/components/settings/plugins/n8n/N8nSettings.tsx`
- `packages/api/src/handlers/n8n-agent-step-bridge.ts`
- `packages/api/src/lib/n8n-agent-step/auth.ts`
- `packages/api/src/lib/n8n-agent-step/start.ts`
- `packages/api/src/lib/n8n-agent-step/payload.ts`
- `packages/api/src/handlers/n8n-agent-step-bridge.test.ts`
- `scripts/build-lambdas.sh`
- `terraform/modules/app/lambda-api/handlers.tf`

## Progress Log

### 2026-06-20

- Created unit branch `codex/thnk-54-u1-n8n-agent-step-contract` from
  `origin/main`.
- Materialized the approved THNK-54 plan into `docs/plans/`.
- Created this autopilot status document before starting implementation.
- Moved Linear issue `THNK-54` to `In Progress` and posted the implementation
  start comment with discovery summary and U1 objective.
- Implemented U1 contract/data model:
  - added `n8n_agent_step_runs` Drizzle schema, manual migration, GraphQL type
    definitions, and migration fixture test;
  - added `packages/api/src/lib/n8n-agent-step/types.ts` with timeout,
    idempotency, preview, and metadata redaction helpers;
  - added U1 contract tests for stable idempotency, timeout bounds/defaults,
    metadata redaction, and bounded previews.
- Verification passed:
  - `pnpm --filter @thinkwork/api exec vitest run src/lib/n8n-agent-step/contract.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/database-pg typecheck`
  - `pnpm --filter @thinkwork/database-pg exec vitest run __tests__/migration-0176-n8n-agent-step-runs.test.ts`
  - `pnpm --filter @thinkwork/database-pg test`
  - `pnpm schema:build`
  - `pnpm dlx prettier@latest --check` on touched Markdown/TypeScript/GraphQL
    files
  - `git diff --check`
- Compound review completed with local artifact
  `.context/compound-engineering/ce-code-review/20260620-204942-thnk54-u1/summary.md`.
  One safe redaction-helper autofix was applied before commit; no residual
  actionable findings remain.
- Browser testing reviewed via `ce-test-browser` scope. U1 changes only
  backend schema, GraphQL contract definitions, migration SQL, and API contract
  helpers, so no web route or browser-testable surface changed in this unit.
- Opened U1 PR: https://github.com/thinkwork-ai/thinkwork/pull/2750
- Moved Linear issue `THNK-54` to `Verification` and posted the PR/status
  comment with marker `dispatcher:THNK-54:Review:Codex`.
- CI reported `lint` failure because the plugin-source-boundary guard treats
  paths containing `n8n` as plugin-specific unless they are documented shared
  surfaces. Added exact shared-contract allowlist entries for the U1 bridge
  files and verified:
  - `pnpm lint:plugin-source`
  - `pnpm lint`
- Pushed CI fix commit `fix(n8n): document shared bridge contract paths`.
- CI rerun passed all required checks:
  - `cla`
  - `lint`
  - `verify`
  - `typecheck`
  - `test`
  - `Migration Drift Precheck (dev)`
- U1 PR auto-merged at 2026-06-20T21:03:01Z:
  https://github.com/thinkwork-ai/thinkwork/pull/2750
- Dispatcher sent a CI follow-up after observing the transient
  `Migration Drift Precheck (dev)` failure. Rechecked PR #2750 after merge,
  confirmed GitHub shows the migration precheck rerun succeeded, and posted a
  `dispatcher:THNK-54:CI:Codex` Linear closure comment with the exact
  failure/fix/status.
- Removed local U1 branch. The remote branch had already been deleted by the
  merge flow.
- Synced from `origin/main` at merge commit `c667da8a9` and created U2 branch
  `codex/thnk-54-u2-n8n-start-endpoint`.
- Implemented U2 bridge credentialing and start/replay endpoint:
  - added a separate n8n agent-step bridge credential secret ref through the
    n8n manifest, managed-app adapter, Terraform module, apply-evidence
    reconciliation, and infra handler defaults;
  - exposed non-secret bridge endpoint/status metadata in n8n plugin settings
    and the Plugin Detail settings UI while continuing to redact raw secret and
    credential fields;
  - added `POST /api/integrations/n8n/agent-steps` and `OPTIONS` routes backed
    by the new `n8n-agent-step-bridge` Lambda handler;
  - added bridge auth, payload validation, resume URL validation, secret
    reference storage, idempotent ledger start/replay behavior, visible Space
    thread creation, opening system message persistence, and normal agent
    wakeup queue dispatch.
- U2 local verification passed:
  - `pnpm schema:build`
  - `pnpm --filter @thinkwork/web codegen`
  - `pnpm --filter thinkwork-cli codegen`
  - `pnpm --filter @thinkwork/mobile codegen`
  - `pnpm --filter @thinkwork/api exec vitest run src/lib/n8n-agent-step/auth.test.ts src/lib/n8n-agent-step/start.test.ts src/handlers/n8n-agent-step-bridge.test.ts src/graphql/resolvers/plugins/n8n-settings.test.ts src/graphql/resolvers/deployments/managed-application-deployment.test.ts src/lib/plugins/handlers/infra.test.ts`
  - `pnpm --filter @thinkwork/plugin-n8n test -- manifest.test.ts`
  - `pnpm --filter @thinkwork/deployment-runner exec vitest run test/deployment-runner-managed-apps.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/plugin-n8n typecheck`
  - `pnpm --filter @thinkwork/web typecheck`
  - `pnpm --filter thinkwork-cli typecheck`
  - `pnpm --filter @thinkwork/deployment-runner typecheck`
  - `pnpm --filter @thinkwork/web exec vitest run src/components/settings/plugins/PluginDetail.test.tsx`
  - `bash scripts/build-lambdas.sh n8n-agent-step-bridge`
  - `pnpm lint:plugin-source`
  - `pnpm lint`
  - `pnpm dlx prettier@latest --check` on U2-touched parseable files
  - `git diff --check`
- U2 lint initially flagged the new shared API handler files as n8n-specific
  source. Added exact source-boundary allowlist entries for
  `packages/api/src/handlers/n8n-agent-step-bridge.ts` and its test, then
  reran `pnpm lint:plugin-source` and `pnpm lint` successfully.
- `pnpm format:check` could not run because the root `prettier` binary is not
  installed in this worktree. The equivalent repo-wide `pnpm dlx
prettier@latest --check "**/*.{ts,tsx,js,jsx,json,md,yml,yaml}"` reports
  hundreds of pre-existing unrelated formatting warnings; U2-touched parseable
  files passed a targeted Prettier check.
- `pnpm --filter @thinkwork/mobile exec tsc --noEmit` was attempted after
  mobile codegen but failed on existing unrelated mobile TypeScript errors
  such as missing `@react-navigation/native` typings and stale component prop
  usages. Mobile has no package `typecheck` script; generated mobile GraphQL
  artifacts were regenerated as required.
- Opened U2 PR: https://github.com/thinkwork-ai/thinkwork/pull/2752
- Moved Linear issue `THNK-54` to `Verification` and posted the PR/status
  comment with marker `dispatcher:THNK-54:Review:Codex`.
- U2 verification failed and Linear was moved back to `In Progress` with marker
  `dispatcher:THNK-54:Verification:Codex`. Verified failure evidence:
  - `resumeUrl` accepted arbitrary HTTPS origins and paths such as
    `https://attacker.example.test/not-n8n-waiting?token=leak` instead of
    requiring the authenticated managed n8n public origin and
    `/webhook-waiting` path.
  - an accepted bridge-run row could poison idempotent retries when a side
    effect failed after ledger insert but before resume-secret storage, visible
    thread creation, opening message persistence, wakeup queueing, or status
    update.
- U2 focused fix pass implemented on the existing PR branch:
  - bridge auth now carries the managed n8n `publicUrl` from the tenant's
    managed application desired config;
  - handler/start validation rejects resume URLs unless they match the managed
    n8n HTTPS origin and n8n waiting-webhook path before any bridge run work is
    started;
  - start/replay now treats incomplete existing runs as recoverable instead of
    final replay responses, verifies existing resume URL host/path consistency,
    stores the resume URL secret idempotently, creates or recovers the visible
    thread, persists the opening message, requires/creates wakeup evidence, and
    only then marks the run `waiting`.
- U2 focused fix verification passed:
  - `pnpm --filter @thinkwork/api exec vitest run src/lib/n8n-agent-step/auth.test.ts src/lib/n8n-agent-step/start.test.ts src/handlers/n8n-agent-step-bridge.test.ts src/graphql/resolvers/plugins/n8n-settings.test.ts src/graphql/resolvers/deployments/managed-application-deployment.test.ts src/lib/plugins/handlers/infra.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
  - `bash scripts/build-lambdas.sh n8n-agent-step-bridge`
  - `pnpm lint:plugin-source`
  - `git diff --check`
  - `pnpm dlx prettier@latest --write` on focused U2 touched files

## Blockers

### 2026-06-20 - U1 PR dev manual migration gate (resolved)

PR: https://github.com/thinkwork-ai/thinkwork/pull/2750

Current branch: `codex/thnk-54-u1-n8n-agent-step-contract`

GitHub ruleset `Protected` requires `lint`, `typecheck`, `test`, `verify`, and
`cla`. The first CI run blocked merge because `Migration Precheck` failed for
the new hand-rolled migration. The failing job scoped the drift reporter to
`packages/database-pg/drizzle/0176_n8n_agent_step_runs.sql` and reported every
declared object missing in dev:

- `public.n8n_agent_step_runs`
- `public.n8n_agent_step_runs_tenant_idempotency_uidx`
- `public.n8n_agent_step_runs_tenant_status_idx`
- `public.n8n_agent_step_runs_thread_idx`
- `public.n8n_agent_step_runs_n8n_execution_idx`
- `public.n8n_agent_step_runs_due_expiry_idx`
- `public.n8n_agent_step_runs_resume_pending_idx`
- `constraint public.n8n_agent_step_runs.n8n_agent_step_runs_status_check`
- `constraint public.n8n_agent_step_runs.n8n_agent_step_runs_resume_status_check`
- `constraint public.n8n_agent_step_runs.n8n_agent_step_runs_timeout_bounds_check`
- `constraint public.n8n_agent_step_runs.n8n_agent_step_runs_terminal_state_check`

Attempted commands:

- `gh pr merge 2750 --squash --delete-branch --subject ... --body ...`
  returned `base branch policy prohibits the merge`.
- `gh pr merge 2750 --squash --delete-branch --auto --subject ... --body ...`
  succeeded in enabling auto-merge.
- `gh run view 27883565537 --log-failed` confirmed the dev migration gate
  failure.

Resolution: after the CI-fix push, the rerun of `Migration Drift Precheck (dev)`
passed. The successful log showed all declared `0176_n8n_agent_step_runs.sql`
objects present in dev. No manual database mutation was run from this autopilot
thread.
