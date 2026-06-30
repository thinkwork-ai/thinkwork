---
title: "Autopilot status: THINK-113 n8n integrated app"
date: 2026-06-30
issue: THINK-113
plan: docs/plans/2026-06-30-001-feat-n8n-integrated-app-plan.md
status: active
---

# Autopilot status: THINK-113 n8n integrated app

## Current state

- Linear issue: `THINK-113`, status `In Progress`, priority High, assignee Eric.
- Primary plan: `docs/plans/2026-06-30-001-feat-n8n-integrated-app-plan.md`.
- Origin requirements: `docs/brainstorms/2026-06-30-think-113-n8n-integrated-app-requirements.md`.
- Linear attached document: `Plan: Add n8n integrated app`.
- Child issues: none found. Autopilot will use plan units as implementation units.
- Blocking issue relations: none found.

## Context discovery

- The user clarified the earlier brainstorm session should have stayed requirements-only; implementation now proceeds from the reviewed plan under autopilot.
- The n8n plugin package already owns manifest, deployment, Terraform, runtime, web settings, skills, smoke, tests, and docs through `plugins/n8n/src/index.ts`.
- Twenty's native app is the packaging precedent, but its `twenty-sdk` host API is Twenty-specific and cannot be assumed for n8n.
- Existing n8n product constraints remain in force: managed ThinkWork install path, tenant service credential for native n8n MCP, stock HTTP Request plus Wait nodes for the agent-step bridge, redacted telemetry, and no V1 production workflow control actions.
- Relevant durable patterns loaded:
  - plugin source boundaries should be package-owned and deploy-verified;
  - external workflow agent-step bridges need resumable ledgers and redacted evidence;
  - plugin/provider setup surfaces are distinct from catalog visibility and selection surfaces;
  - screen-owned adapters keep table/list display semantics portable.

## Unit order

1. U1: Confirm/scaffold n8n app host and app-to-ThinkWork auth boundary.
2. U4: Simplify the ThinkWork n8n plugin detail to settings-only and add install access.
3. U2: Add read-only app data API for workflows and executions.
4. U3: Build the read-only n8n integrated app tables.
5. U5: Add guarded sync/docs/smoke verification for the integrated app.

U1 stays first because U2 and U3 depend on the host/auth decision. U4 can land independently after U1 because it fixes the current operator-facing plugin surface without depending on app data.

## Gate log

| Time | Gate | Evidence | Result |
| --- | --- | --- | --- |
| 2026-06-30 | Requirements located | Requirements, primary plan, and Linear attached plan document found. | Passed |
| 2026-06-30 | Linear dependency scan | No child issues, blockers, duplicate, attachments, customer needs, or release blockers found. | Passed |
| 2026-06-30 | Repo baseline | Worktree is detached at `038fb2a5c`; only requirements and plan artifacts are untracked. | Passed |
| 2026-06-30 | Implementation started | Linear moved to `In Progress`; kickoff comment posted for U1. | Passed |
| 2026-06-30 | U1 branch created | Created `codex/think-113-u1-n8n-app-host` from `origin/main`. | Passed |
| 2026-06-30 | U1 package verification | `pnpm --filter @thinkwork/plugin-n8n test`; `pnpm --filter @thinkwork/plugin-n8n typecheck`. The typecheck now also runs `tsc -p n8n-app/tsconfig.json --noEmit`. | Passed |
| 2026-06-30 | U1 catalog verification | `pnpm --filter @thinkwork/plugin-catalog test`; `pnpm --filter @thinkwork/plugin-catalog check:plugins`. | Passed |
| 2026-06-30 | U1 source-boundary verification | `pnpm lint:plugin-source`. | Passed |
| 2026-06-30 | U1 review | Testing reviewer found missing `workflow-publish` contract coverage and nested app typecheck gap; correctness reviewer found manifest payload versioning risk. Both were fixed and reverified. Project-standards reviewer found no issues. | Passed |
| 2026-06-30 | Format command check | `pnpm exec prettier --write ...` could not run because the root dependency install does not expose a `prettier` binary. | Blocked |

## Active unit

U1 implementation is ready for PR. The branch adds package-owned `plugins/n8n/n8n-app` host/auth scaffolding, publishes a launchable `apps.main` n8n app surface in n8n plugin version `0.2.0` while preserving the legacy `0.1.0` payload, and adds package-local contract coverage.
