---
title: "Fix Pi Context Engine Split Tools"
status: active
created: "2026-04-29"
owner: "codex"
origin: "Mobile e2e verification after context engine deploy"
---

# Fix Pi Context Engine Split Tools

## Problem Frame

Mobile new-chat verification showed the Pi runtime can fetch the requested Hindsight reflection, but it did not do so through the Context Engine split memory tool. The trace for `CHAT-227` recorded `query_context` plus raw `hindsight_reflect`; it did not record `query_memory_context`. Strands already registers `query_context`, `query_memory_context`, and `query_wiki_context`, while Pi only registers `query_context`.

The immediate goal is to make Pi expose the same Context Engine split tools as Strands so a mobile chat can explicitly use `query_memory_context` for Hindsight reflect-style memory retrieval and `query_wiki_context` for fast wiki-only lookup.

## Scope Boundaries

- In scope: Pi runtime tool registration, Context Engine JSON-RPC tool-name forwarding, tool telemetry classification, and focused unit coverage.
- In scope: deploy verification and mobile e2e trace verification after the fix merges.
- Out of scope: changing Context Engine provider behavior, Hindsight reranker configuration, mobile UI redesign, or replacing Wiki search UX in this branch.

## Requirements Trace

- R1: A mobile Pi agent must have a built-in `query_memory_context` tool available when Context Engine is enabled.
- R2: `query_memory_context` must call the Context Engine MCP endpoint with JSON-RPC `params.name = "query_memory_context"`, not raw Hindsight.
- R3: Pi must retain the default `query_context` behavior for ordinary fast context lookup.
- R4: Pi should also expose `query_wiki_context` so wiki-only lookup can stay separate from Hindsight memory.
- R5: Runtime traces should classify all Context Engine built-ins as built-in tools so DB verification can distinguish them from raw MCP or Hindsight calls.

## Existing Patterns

- `packages/agentcore-strands/agent-container/container-sources/context_engine_tool.py` already registers `query_context`, `query_memory_context`, and `query_wiki_context` against the same MCP endpoint.
- `packages/agentcore-pi/agent-container/src/runtime/tools/context-engine.ts` already centralizes Context Engine HTTP/MCP invocation for `query_context`.
- `packages/agentcore-pi/agent-container/src/runtime/tools/registry.ts` already gathers built-in tools based on runtime payload flags.
- `packages/agentcore-pi/agent-container/tests/tools.test.ts` already covers Pi built-in tool registration and endpoint payloads.

## Implementation Units

### U1: Add Pi split Context Engine tools

Files:

- Modify `packages/agentcore-pi/agent-container/src/runtime/tools/context-engine.ts`
- Modify `packages/agentcore-pi/agent-container/src/runtime/tools/hindsight.ts`
- Modify `packages/agentcore-pi/agent-container/src/runtime/tools/registry.ts`

Approach:

- Keep `buildContextEngineTool` as the existing single-tool helper for compatibility.
- Add a `buildContextEngineTools` helper that returns `query_context`, `query_memory_context`, and `query_wiki_context` when the Context Engine runtime flag and API config are present.
- Parameterize the existing JSON-RPC call helper by tool name so each built-in forwards the exact Context Engine tool name.
- Tune descriptions so the model prefers `query_memory_context` for Hindsight Memory and reflect-style memory requests, while keeping `query_context` as the ordinary fast default.
- Tune raw Hindsight tool descriptions so direct `hindsight_recall` and `hindsight_reflect` remain available for diagnostics but do not compete with Context Engine for normal memory lookup.

Test Scenarios:

- Context Engine enabled with API config registers all three tools in a stable order.
- Executing `query_memory_context` sends JSON-RPC `params.name = "query_memory_context"`.
- Existing `query_context` execution and disabled registration behavior remain intact.

### U2: Classify split Context Engine calls in Pi telemetry

Files:

- Modify `packages/agentcore-pi/agent-container/src/runtime/pi-loop.ts`

Approach:

- Treat `query_context`, `query_memory_context`, and `query_wiki_context` as built-in tools when recording tool invocation metadata.
- Keep existing classifications for Hindsight, web search, email, and sandbox tools unchanged.

Test Scenarios:

- Unit coverage for JSON-RPC forwarding is sufficient for registration behavior.
- Post-deploy DB trace for the mobile chat should show `query_memory_context` in `thread_turns.usage_json.tools_called` and/or tool invocation metadata.

## Verification

- Run focused Pi tests covering tool registration and endpoint payloads.
- Run Pi typecheck.
- Run Prettier check on touched files.
- After PR merge and dev deploy, start/keep admin and mobile dev servers visible.
- In iOS Simulator, create a new chat asking the agent to fetch memory for `Smoke Tests 27 April 2026` using `query_memory_context`.
- Verify the response includes the Hindsight reflect text and smoke tokens.
- Verify the DB trace records `query_memory_context`; raw `hindsight_reflect` should not be needed for this specific prompt.

## Risks

- The model may still prefer raw Hindsight if both raw Hindsight and Context Engine split tools are present. Tool descriptions should bias memory lookup toward `query_memory_context`, and the e2e trace is the final arbiter.
- Pi container deploy time can delay verification; do not treat local unit tests as sufficient for the requested mobile e2e result.
