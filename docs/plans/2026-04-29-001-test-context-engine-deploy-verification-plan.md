---
title: "test: Verify deployed Context Engine memory and wiki paths"
type: test
status: active
date: 2026-04-29
origin: docs/plans/2026-04-28-008-feat-context-engine-plan.md
---

# test: Verify deployed Context Engine memory and wiki paths

## Overview

Verify that the deployed dev Context Engine behaves as intended after the memory-path tuning work: Hindsight memory must be queried through the explicit memory tool, wiki search must remain a separate fast path, and the deployed environment must reflect the new memory tuning settings.

This is a validation plan rather than a feature implementation plan. The durable output is a verification report under `docs/verification/` containing the live commands, summarized results, latency observations, and any follow-up issues.

## Problem Frame

The Context Engine PR changed provider routing and Hindsight tuning after dogfood results showed unacceptable recall latency. The highest-risk behavior is that deployed dev might still call memory through the default `query_context` path, call Hindsight with expensive recall defaults, or mix wiki and Hindsight in a way that hides partial failures.

The verification should prove that:

- `query_memory_context` calls the memory provider explicitly and uses the deployed reflect-mode setting.
- `query_wiki_context` calls the wiki provider separately and returns quickly.
- Mobile wiki search still uses the dedicated GraphQL `mobileWikiSearch` path.
- Admin exposes Context Engine as a built-in tool opt-in, while provider tuning remains infrastructure-owned for now.

## Requirements Trace

- R1. Verify the GitHub deploy for the merged Context Engine tuning commit completed successfully.
- R2. Verify deployed Lambda environment includes `CONTEXT_ENGINE_MEMORY_QUERY_MODE=reflect` and the intended memory timeout.
- R3. Verify deployed Hindsight ECS task definition includes the reranker and adaptive budget tuning.
- R4. Execute deployed MCP `query_memory_context` against real dev tenant/user data and capture provider status, latency, and top result shape.
- R5. Execute deployed MCP `query_wiki_context` against real dev tenant/user data and capture provider status, latency, and top result shape.
- R6. Verify the mobile wiki code path remains `mobileWikiSearch`, not Context Engine.
- R7. Verify the admin dev server is running and the built-in Context Engine controls are available for template/tool exposure.
- R8. Record results and follow-up recommendations in a repo-tracked verification report.

## Scope Boundaries

In scope:

- Dev-stage deployment verification.
- Service-level Context Engine MCP checks using the deployed MCP endpoint.
- Static/mobile path confirmation from source and generated SDK surface.
- Admin dev server availability check.
- Durable report writing.

Out of scope:

- New UI implementation for Context Engine tuning controls.
- iOS Simulator interaction unless the service-level checks reveal a mobile-specific regression.
- Production deploy or production data checks.
- Retuning Hindsight again unless deployed verification fails.

## Context And Patterns

- `packages/api/src/handlers/mcp-context-engine.ts` exposes `query_context`, `query_memory_context`, `query_wiki_context`, and provider listing.
- `packages/api/src/lib/context-engine/providers/memory.ts` selects reflect mode from `CONTEXT_ENGINE_MEMORY_QUERY_MODE`.
- `terraform/modules/app/lambda-api/handlers.tf` owns Context Engine Lambda environment settings.
- `terraform/modules/app/hindsight-memory/main.tf` owns Hindsight reranker and recall budget settings.
- `packages/react-native-sdk/src/hooks/use-mobile-memory-search.ts` and `packages/api/src/graphql/resolvers/memory/mobileWikiSearch.query.ts` preserve the mobile wiki GraphQL path.
- `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx` exposes template built-in tool opt-in controls.
- `apps/admin/src/routes/_authed/_tenant/capabilities/builtin-tools.tsx` exposes capabilities built-in tools status.

## Technical Decisions

- Use the deployed MCP Context Engine endpoint as the main behavioral proof because it exercises the same Lambda facade external agents and Codex MCP use.
- Fetch deployed environment values through AWS CLI queries that select only non-secret fields.
- Use service authorization from Lambda environment only inside local commands; never write or print the secret in the report.
- Treat `query_memory_context` and `query_wiki_context` as separate acceptance checks. Their provider status and latency should be reported independently.
- Record raw enough evidence to make future regressions diagnosable, but summarize hit text to avoid noisy or sensitive output.

## Implementation Units

- U1. **Deployment and Environment Verification**

  **Goal:** Confirm the merged dev deploy is green and deployed runtime configuration matches the intended settings.

  **Files:**
  - Report: `docs/verification/2026-04-29-context-engine-dev-verification.md`

  **Test scenarios:**
  - GitHub Actions deploy run completed with success.
  - Context Engine Lambda env reports memory query mode `reflect`.
  - Context Engine Lambda env reports memory timeout `20000`.
  - Hindsight ECS task definition reports local reranker, max candidates `20`, and adaptive budget settings.

- U2. **Deployed Context Engine MCP Smoke**

  **Goal:** Execute `query_memory_context` and `query_wiki_context` against dev with real tenant/user data and verify separated provider behavior.

  **Files:**
  - Report: `docs/verification/2026-04-29-context-engine-dev-verification.md`

  **Test scenarios:**
  - `query_memory_context` returns a successful MCP response, memory provider status, and at least one useful Hindsight reflection or an explainable no-hit status.
  - `query_wiki_context` returns a successful MCP response and wiki provider status without depending on Hindsight.
  - Provider durations are recorded separately so slow Hindsight cannot hide wiki behavior.
  - Partial failures, if present, are visible in provider status instead of collapsing the whole response.

- U3. **Client Path and Admin Surface Verification**

  **Goal:** Confirm mobile wiki search and admin built-in tool controls align with the intended product shape.

  **Files:**
  - Report: `docs/verification/2026-04-29-context-engine-dev-verification.md`

  **Test scenarios:**
  - Mobile wiki search source still references `mobileWikiSearch`.
  - React Native SDK Context Engine client remains available for explicit Context Engine calls.
  - Admin dev server is listening on port `5174`.
  - Template built-in tool controls include Context Engine.
  - Capabilities built-in tools table includes Context Engine.

## Verification Commands

The implementation should run focused commands rather than broad monorepo checks:

- `gh run view <deploy-run> --repo thinkwork-ai/thinkwork --json status,conclusion,headSha,url`
- `aws lambda get-function-configuration --function-name thinkwork-dev-api-mcp-context-engine --query 'Environment.Variables.{mode:CONTEXT_ENGINE_MEMORY_QUERY_MODE,timeout:CONTEXT_ENGINE_MEMORY_TIMEOUT_MS}'`
- `aws ecs describe-services` and `aws ecs describe-task-definition` with env-name filtering for Hindsight tuning variables.
- A local Node MCP JSON-RPC smoke script against `/mcp/context-engine` for `query_memory_context` and `query_wiki_context`.
- `rg` checks for mobile wiki and admin built-in tool paths.
- `lsof -nP -iTCP:5174 -sTCP:LISTEN`

## Risks

- Hindsight response latency may remain high even after tuning; report the measured latency and provider trace instead of masking it.
- Real dev data may produce no wiki results for a specific query; use one query known to exist in memory and a second query likely to exist in wiki if needed.
- The deployed service secret must stay local to the command process and out of logs/reports.

## Done Criteria

- Verification report exists with command outcomes, summarized MCP results, timings, and follow-up recommendations.
- Any failed acceptance check is called out clearly with the suspected owning layer.
- No secrets are written to disk or included in terminal-visible report content.
