---
title: "Pi Runtime Tool Execution Parity"
status: superseded
superseded_by: docs/plans/2026-05-03-005-feat-flue-runtime-production-wiring-plan.md
created: 2026-04-27
origin: user request in Codex session
---

# Pi Runtime Tool Execution Parity

## Problem Frame

The Pi runtime can now complete a real thread-message turn, but the capability smoke in `docs/runbooks/pi-runtime-capability-smoke.md` proves that tool-backed turns are not real yet. Pi currently emits text that looks like tool calls while `thread_turns.usage_json.tools_called` and `thread_turns.usage_json.tool_invocations` remain empty. This must be fixed before Pi can be treated as a parallel substrate for Strands.

The implementation target is the deployed thread-message path:

`createThread` / `sendMessage` -> `packages/api/src/handlers/chat-agent-invoke.ts` -> AgentCore Pi Lambda -> `packages/agentcore-pi/agent-container/src/runtime/pi-loop.ts` -> persisted assistant message and `thread_turns`.

## Requirements Trace

- R1. Pi must register real `AgentTool` definitions with `@mariozechner/pi-agent-core`, not ask the model to inline pseudo tool XML/JSON.
- R2. Pi must return `tools_called` and `tool_invocations` in the shape `chat-agent-invoke` already persists.
- R3. `web_search` must call the real deployed web-search provider using the same environment contract as the skill catalog (`WEB_SEARCH_PROVIDER`, `EXA_API_KEY`, `SERPAPI_KEY`).
- R4. `execute_code` must call Bedrock AgentCore Code Interpreter when `sandbox_interpreter_id` is present, and degrade with a structured provisioning error when it is absent.
- R5. Hindsight memory tools must expose at least recall/reflect, and successful Pi turns with `use_memory: true` must retain the completed turn at end of turn.
- R6. MCP support must use `mcp_configs` from `chat-agent-invoke`; if full MCP bridging cannot be finished in this slice, the runtime must report a clear `SKIP/unsupported` outcome and the smoke must not pass.
- R7. The deployed capability smoke must pass for the capabilities implemented in this slice and fail crisply for anything still unsupported.

## Scope Boundaries

- In scope: Pi runtime package, Docker dependencies, and smoke/runbook updates needed to prove real tools.
- In scope: direct runtime adapters for web search, execute code, Hindsight recall/reflect/retain, and tool metadata capture.
- In scope: deployed dev verification using the sandbox agent.
- Out of scope: changing the Admin runtime selector or GraphQL runtime schema.
- Out of scope: rewriting the Strands runtime.
- Out of scope: pretending MCP is complete without a real MCP client bridge and a configured server/tool call.

## Existing Patterns To Follow

- `packages/agentcore-pi/node_modules/@mariozechner/pi-agent-core/README.md` documents `AgentTool` shape, `initialState.tools`, event subscription, and `tool_execution_*` events.
- `packages/api/src/handlers/chat-agent-invoke.ts` already persists `invokeResult.tools_called`, `invokeResult.tool_invocations`, and `invokeResult.hindsight_usage`.
- `packages/skill-catalog/web-search/scripts/search.py` defines the provider contract Pi should mirror.
- `packages/agentcore-strands/agent-container/container-sources/sandbox_tool.py` defines sandbox result semantics and AgentCore Code Interpreter lifecycle.
- `packages/agentcore-strands/agent-container/container-sources/hindsight_tools.py` defines Hindsight tool names and retry/close behavior.
- `packages/api/src/lib/memory/adapters/hindsight-adapter.ts` documents Hindsight HTTP endpoints and bank naming.
- `packages/api/scripts/pi-runtime-capability-smoke.ts` is the deployed characterization harness.

## Decisions

1. Tool execution metadata is part of the runtime contract. Pi should record `tool_execution_start` and `tool_execution_end` events and return normalized metadata to `chat-agent-invoke`.
2. The first implementation should favor direct TypeScript adapters over shelling out to Python skill scripts. The Pi Docker image currently copies only the Pi package source; copying the whole skill catalog just to run one Python script would blur runtime ownership.
3. `execute_code` should use `@aws-sdk/client-bedrock-agentcore` runtime commands (`StartCodeInterpreterSessionCommand`, `InvokeCodeInterpreterCommand`, `StopCodeInterpreterSessionCommand`) and only register when `sandbox_interpreter_id` exists.
4. End-of-turn Hindsight retain should happen after the assistant response is produced and before returning to `chat-agent-invoke`, so the response can include `hindsight_usage`/retain evidence.
5. MCP should not be marked done until there is a real MCP client bridge. If this slice cannot complete MCP safely, leave the harness failing MCP and document it as residual.

## Implementation Units

### U1. Tool Registry And Metadata Capture

**Goal:** Give Pi a reusable tool registry and return real tool invocation evidence.

**Create/Modify:**

- Create: `packages/agentcore-pi/agent-container/src/runtime/tools/types.ts`
- Create: `packages/agentcore-pi/agent-container/src/runtime/tools/registry.ts`
- Modify: `packages/agentcore-pi/agent-container/src/runtime/pi-loop.ts`
- Test: `packages/agentcore-pi/agent-container/tests/tool-metadata.test.ts`

**Approach:**

- Define a `PiToolInvocation` record compatible with `chat-agent-invoke` expectations.
- Build tools from the invocation payload and runtime env.
- Subscribe to Pi `tool_execution_start` / `tool_execution_end` events.
- Return `tools_called` and `tool_invocations` at top level and under `response`.

**Verification:**

- Unit test with fake tools proves metadata capture.
- `pnpm --filter @thinkwork/agentcore-pi test`

### U2. Web Search Tool

**Goal:** Register a real `web_search` AgentTool.

**Create/Modify:**

- Create: `packages/agentcore-pi/agent-container/src/runtime/tools/web-search.ts`
- Modify: `packages/agentcore-pi/package.json` only if a schema helper dependency is required.
- Test: `packages/agentcore-pi/agent-container/tests/web-search-tool.test.ts`

**Approach:**

- Implement Exa and SerpAPI fetch adapters in TypeScript.
- Parameters: `query`, `num_results`, optional `category`, `start_published_date`, `include_domains`, `exclude_domains`.
- Return compact JSON text and structured details.
- Register when provider credentials exist; otherwise either omit the tool or return a structured unavailable error.

**Verification:**

- Unit tests mock `fetch`.
- Deployed smoke: `--capability web_search` passes with tool evidence.

### U3. Execute Code Tool

**Goal:** Register a real `execute_code` AgentTool backed by AgentCore Code Interpreter.

**Create/Modify:**

- Create: `packages/agentcore-pi/agent-container/src/runtime/tools/execute-code.ts`
- Modify: `packages/agentcore-pi/package.json` to include `@aws-sdk/client-bedrock-agentcore`.
- Test: `packages/agentcore-pi/agent-container/tests/execute-code-tool.test.ts`

**Approach:**

- Register only when payload includes `sandbox_interpreter_id`.
- Start one Code Interpreter session lazily per Pi invocation.
- Invoke `executeCode` with Python by default.
- Stop the session in a cleanup callback after the agent turn.
- Shape result with stdout/stderr/exit status where available.

**Verification:**

- Unit tests mock the Bedrock AgentCore client.
- Deployed smoke: `--capability execute_code` passes with tool evidence when sandbox preflight is ready.

### U4. Hindsight Memory Tools And End-Of-Turn Retain

**Goal:** Provide Pi memory tools and retain successful turns.

**Create/Modify:**

- Create: `packages/agentcore-pi/agent-container/src/runtime/tools/hindsight.ts`
- Modify: `packages/agentcore-pi/agent-container/src/runtime/pi-loop.ts`
- Test: `packages/agentcore-pi/agent-container/tests/hindsight-tool.test.ts`

**Approach:**

- Use `hindsight_endpoint`, `tenant_slug`/`instance_id`, `user_id`, and `assistant_id` from the invocation payload to compute the same bank style expected by existing Hindsight usage.
- Register `hindsight_recall` and `hindsight_reflect` when endpoint/bank are present.
- After a successful turn, call a retain endpoint with user message + assistant response and return retain evidence in `hindsight_usage` or `tool_invocations`.
- If endpoint is absent, omit tools and surface no memory support.

**Verification:**

- Unit tests mock Hindsight fetch.
- Deployed smoke: `--capability hindsight` proves retain/recall evidence or reports a specific config failure.

### U5. MCP Bridge

**Goal:** Connect Pi to configured MCP servers from `mcp_configs`.

**Create/Modify:**

- Create: `packages/agentcore-pi/agent-container/src/runtime/tools/mcp.ts`
- Test: `packages/agentcore-pi/agent-container/tests/mcp-tool.test.ts`

**Approach:**

- Inspect `@modelcontextprotocol/sdk` availability and Pi dependency compatibility.
- Build streamable HTTP MCP clients from `mcp_configs`, list tools, and expose each tool as a Pi `AgentTool`.
- Include server name and tool name in `tool_invocations`.
- Always close clients after the turn.

**Verification:**

- Unit test against a fake MCP transport if feasible.
- Deployed smoke: `--capability mcp` passes only when the sandbox agent has at least one configured MCP server.

### U6. Deployed Smoke And PR Evidence

**Goal:** Prove the implementation on dev.

**Modify:**

- `docs/runbooks/pi-runtime-capability-smoke.md`
- PR body for the current branch.

**Approach:**

- Run the smoke capabilities after deploying.
- Record PASS/FAIL/SKIP by capability.
- Any unsupported capability must remain explicit residual work.

**Verification:**

- `pnpm --filter @thinkwork/agentcore-pi typecheck`
- `pnpm --filter @thinkwork/agentcore-pi test`
- `pnpm --filter @thinkwork/api typecheck`
- Deployed `pi:capability-smoke`

## Sequencing

1. U1 metadata first.
2. U2 and U3 next because they are bounded and directly unblock user examples.
3. U4 next because end-of-turn retain answers the user's memory question.
4. U5 last because MCP dependency shape is the least certain and may need a follow-up PR.
5. U6 after deploy.

## Acceptance Checklist

- Pi no longer emits fake tool-call text as the only evidence for tool use.
- Web search smoke passes with `tools_called`/`tool_invocations`.
- Execute code smoke passes with sandbox evidence.
- Hindsight smoke proves end-of-turn retain or fails with a specific missing-config reason.
- MCP smoke passes only with real configured MCP evidence, otherwise remains a documented residual.
