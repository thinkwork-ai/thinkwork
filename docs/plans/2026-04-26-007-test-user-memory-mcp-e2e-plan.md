---
title: "test: User Memory MCP End-to-End Coverage"
type: test
status: completed
date: 2026-04-26
origin: docs/brainstorms/2026-04-20-thinkwork-memory-wiki-mcp-requirements.md
---

# test: User Memory MCP End-to-End Coverage

## Overview

Add deliberate end-to-end coverage for two user-memory MCP surfaces:

1. A ThinkWork agent invoking a user-authorized MCP server through the existing outbound MCP assignment path.
2. Codex invoking the user's ThinkWork Memory/Wiki MCP server directly from this workspace.

The first surface exists today: `packages/api/src/lib/mcp-configs.ts` resolves agent-assigned MCP servers and user OAuth tokens into `mcp_configs`, and `packages/agentcore-strands/agent-container/container-sources/server.py` registers those configs as Strands MCP clients. The second surface is intentionally gated: `docs/plans/2026-04-20-008-feat-memory-wiki-mcp-server-plan.md` still describes the inbound User Memory/Wiki MCP server as greenfield, so the Codex E2E must fail with a precise "server/config unavailable" diagnostic until a real endpoint and token are supplied. It must not pass against a fake local implementation while claiming to validate the product surface.

## Requirements Trace

- **R1. Agent outbound MCP E2E:** prove an agent invocation receives a user-scoped MCP config for an assigned server and can reach a streamable-HTTP MCP tool with the user's bearer token, not an agent-id token.
- **R2. Runtime registration:** prove the Strands runtime converts `mcp_configs` into authenticated MCP clients without leaking token values in logs.
- **R3. Direct Codex Memory MCP E2E:** provide a runnable Codex-side harness that calls `retain`, `memory_recall`, and `wiki_search` against the real User Memory MCP endpoint when configured.
- **R4. Honest inbound-server gate:** when no real User Memory MCP endpoint/token/tooling is configured, the Codex harness exits with an explicit skipped/blocked diagnostic that points to `docs/plans/2026-04-20-008-feat-memory-wiki-mcp-server-plan.md`.
- **R5. User scope:** assertions must name `userId` / `user_id` as the scoped owner. Do not reintroduce `ownerId` terminology.

## Scope Boundaries

- Do not implement the inbound User Memory/Wiki MCP server here; that belongs to `docs/plans/2026-04-20-008-feat-memory-wiki-mcp-server-plan.md`.
- Do not modify live Hindsight/wiki migration scripts, admin memory/wiki UI, or GraphQL auth/resolver files.
- Prefer `packages/api` test harnesses and `packages/agentcore-strands` runtime tests. Only touch `packages/workspace-defaults/terraform` if a deployed-stage E2E requires a minimal env/readme update.
- No local-only product claims. ThinkWork's true E2E path requires deployed AWS infrastructure; local tests may be deterministic characterization tests, but the live harness must be gated by real endpoint env.

## Context

### Existing outbound MCP path

- `packages/api/src/lib/mcp-configs.ts` builds `McpServerConfig[]` for an agent invocation from `agent_mcp_servers`, `tenant_mcp_servers`, and `user_mcp_tokens`.
- For `oauth` / `per_user_oauth`, `buildMcpConfigs(agentId, humanPairId, ...)` looks up `user_mcp_tokens.user_id = humanPairId` and returns a bearer token in the config.
- `packages/api/src/lib/resolve-agent-runtime-config.ts` delegates to `buildMcpConfigs(agentId, humanPairId, ...)`, so tests should keep the distinction between agent id and user id visible.
- `packages/agentcore-strands/agent-container/container-sources/server.py` receives `mcp_configs`, maps `auth.type="bearer"` to an `Authorization: Bearer ...` header, and registers each server with `MCPClient(lambda: streamablehttp_client(...))`.

### Inbound User Memory MCP status

- `docs/plans/2026-04-20-008-feat-memory-wiki-mcp-server-plan.md` states the inbound Memory/Wiki MCP server is greenfield and has no shipped handler yet.
- The requested Codex test therefore needs a real configured endpoint/token to run live, and otherwise should be a blocked-gate diagnostic rather than a fake pass.

## Implementation Units

### Unit 1: API characterization for user-scoped MCP config

**Goal:** Strengthen API tests so the outbound agent MCP path proves user OAuth tokens are selected by `user_id` / `humanPairId`, never by `agentId`.

**Files:**

- Modify: `packages/api/src/lib/__tests__/mcp-configs-approved-filter.test.ts`

**Approach:**

- Add a focused test for `auth_type: "oauth"` or `per_user_oauth`.
- Mock the joined rows so a server is assigned to `agent-1`, then verify the token lookup predicate contains `userMcpTokens.user_id` and the supplied human user id.
- Mock Secrets Manager returning a sentinel user token and assert the resulting config has `auth: { type: "bearer", token: <sentinel> }`.
- Include an explicit negative assertion that the lookup predicate does not use the agent id as the user id.

**Execution note:** test-first. Write the assertion against current behavior before any implementation changes; if it passes, this unit is characterization coverage.

**Verification:**

- `pnpm --filter @thinkwork/api test -- src/lib/__tests__/mcp-configs-approved-filter.test.ts`

### Unit 2: Runtime MCP client registration test

**Goal:** Verify the Strands runtime uses the provided user bearer token when constructing MCP streamable-HTTP clients.

**Files:**

- Create or modify: `packages/agentcore-strands/agent-container/test_mcp_client_registration.py`

**Approach:**

- Import the runtime module with stubbed `strands.tools.mcp.MCPClient` and `mcp.client.streamable_http.streamablehttp_client`.
- Call the smallest available runtime construction function that accepts `mcp_configs`; if no narrow function exists, add a tiny helper in `server.py` to build MCP clients from configs without invoking the model.
- Assert bearer auth is translated to an `Authorization` header with the configured token.
- Assert API-key auth remains `x-api-key`.
- Assert missing URLs are skipped.

**Execution note:** prefer characterization-first. Add a helper only if the current implementation cannot be tested without launching the full agent.

**Verification:**

- `uv run pytest packages/agentcore-strands/agent-container/test_mcp_client_registration.py`

### Unit 3: Live agent MCP E2E harness documentation

**Goal:** Add a runnable, deployment-gated E2E entry point for an operator to validate an agent can call a user-scoped MCP server in a real stage.

**Files:**

- Create: `packages/api/test/integration/user-memory-mcp/README.md`
- Modify: `packages/api/package.json`

**Approach:**

- Follow the style of `packages/api/test/integration/sandbox/README.md`.
- Document required env for a real stage: `THINKWORK_API_URL`, `API_AUTH_SECRET`, `DATABASE_URL`, `AWS_REGION`, `STAGE`, a test `TENANT_ID`, `USER_ID`, `AGENT_ID`, and a registered test MCP server URL/token.
- Add a package script with a clear name, e.g. `user-memory-mcp:e2e`, wired to a Vitest config or an explicit test file when the harness exists.
- If full live automation is too large for this slice, include a preflight test that fails/skips with missing-env diagnostics before touching AWS.

**Execution note:** keep this harness self-documenting and opt-in; it must not run in default CI.

**Verification:**

- Missing-env run prints a precise diagnostic and does not mutate deployed resources.

### Unit 4: Direct Codex User Memory MCP harness

**Goal:** Provide a local Codex-side command that validates the real User Memory MCP endpoint once it exists.

**Files:**

- Create: `packages/api/test/integration/user-memory-mcp/codex-user-memory-mcp.e2e.test.ts`
- Create or modify: `packages/api/vitest.user-memory-mcp-e2e.config.ts`
- Modify: `packages/api/package.json`

**Approach:**

- Gate on `USER_MEMORY_MCP_URL` and `USER_MEMORY_MCP_TOKEN` (and optional `USER_MEMORY_MCP_USER_ID` for diagnostics only).
- Use JSON-RPC over streamable HTTP to call:
  - `tools/list`, asserting `retain`, `memory_recall`, and `wiki_search` are present.
  - `tools/call retain` with a unique sentinel content string.
  - `tools/call memory_recall` for the sentinel.
  - `tools/call wiki_search` for the sentinel if the deployed stage has wiki compile enabled; otherwise log that wiki search may lag.
- If env is absent, skip with a message that the inbound server remains blocked by `docs/plans/2026-04-20-008-feat-memory-wiki-mcp-server-plan.md`.
- If the endpoint returns auth/discovery errors, fail loudly with the response status and short body.

**Execution note:** do not mock the User Memory MCP server in this test. The value is proving Codex can use the real user-facing MCP surface.

**Verification:**

- `pnpm --filter @thinkwork/api user-memory-mcp:e2e` skips cleanly without env.
- With `USER_MEMORY_MCP_URL` and `USER_MEMORY_MCP_TOKEN`, the test performs the three real tool calls.

### Unit 5: Plan and status update for external User Memory MCP

**Goal:** Make the existing external MCP plan's integration status clear from this new test work.

**Files:**

- Modify: `docs/plans/2026-04-20-008-feat-memory-wiki-mcp-server-plan.md`

**Approach:**

- Add a short "Validation Dependency" note linking this test plan and stating that the Codex direct E2E is blocked until the inbound MCP server ships.
- Preserve `ownerId` → `userId` terminology.

**Execution note:** docs-only.

**Verification:**

- `rg -n "ownerId|userId|Validation Dependency" docs/plans/2026-04-20-008-feat-memory-wiki-mcp-server-plan.md`

## Verification Plan

- `pnpm --filter @thinkwork/api test -- src/lib/__tests__/mcp-configs-approved-filter.test.ts`
- `uv run pytest packages/agentcore-strands/agent-container/test_mcp_client_registration.py`
- `pnpm --filter @thinkwork/api user-memory-mcp:e2e`
- If live MCP env is available, rerun `pnpm --filter @thinkwork/api user-memory-mcp:e2e` with `USER_MEMORY_MCP_URL` and `USER_MEMORY_MCP_TOKEN`.

## Acceptance Criteria

- The outbound agent MCP path has automated coverage proving per-user token lookup and runtime bearer-header propagation.
- The direct Codex User Memory MCP command exists and is truthful: skipped/blocked when no real endpoint is configured, real `retain`/`memory_recall`/`wiki_search` calls when configured.
- The external Memory/Wiki MCP plan clearly names the direct Codex E2E as a validation dependency.
- No admin UI, GraphQL auth/resolver, or live migration scripts are modified.
