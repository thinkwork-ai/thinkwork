---
title: "Pi Runtime Tools, MCP, and Memory E2E Smokes"
status: active
created: 2026-04-27
origin: user request in Codex session
---

# Pi Runtime Tools, MCP, and Memory E2E Smokes

## Problem Frame

The Pi runtime has been proven through a real thread-message turn: `createThread` plus `sendMessage` routed through `chat-agent-invoke`, invoked AgentCore with `runtime=pi`, and wrote an assistant message back to the thread. That is not enough to prove the runtime is operator-ready. The user specifically wants a true end-to-end check that Pi can call each enabled tool and MCP server, including web search, code sandbox, Hindsight memory, and any configured MCP servers, and wants to know whether Hindsight memory is updated at the end of a turn.

Current discovery found a critical gap: `packages/agentcore-pi/agent-container/src/runtime/pi-loop.ts` constructs `new Agent(...)` without passing any `tools`, and it does not return `tool_invocations`, `tools_called`, `hindsight_usage`, or post-turn memory-retain evidence. `chat-agent-invoke` already passes `skills`, `mcp_configs`, `thinkwork_api_url`, `thinkwork_api_secret`, `hindsight_endpoint`, sandbox preflight fields, and `use_memory: true`; the Pi container currently ignores those capabilities.

## Requirements Trace

- R1. Run a deployed thread-message smoke for every Pi capability the sandbox agent is expected to have, not just a plain text response.
- R2. Prove web search by requiring a tool-backed answer and asserting turn metadata or runtime logs show `web_search`.
- R3. Prove code sandbox by requiring executable code and asserting sandbox invocation evidence, not just model-written code.
- R4. Prove Hindsight recall/reflect/retain behavior, including whether memory is updated at end of turn.
- R5. Prove configured MCP servers are reachable from Pi when the agent/template grants them.
- R6. Persist the smoke as a repeatable operator script/test so the result can be re-run after deploys.
- R7. Report unsupported capabilities as explicit failures with evidence, not as ambiguous assistant text.

## Scope Boundaries

- In scope: Pi runtime capability wiring and a repeatable E2E smoke harness against the deployed dev stack.
- In scope: thread-message path only (`createThread`/`sendMessage` -> `chat-agent-invoke` -> AgentCore Pi -> persisted assistant message/turn metadata).
- Out of scope: replacing Strands runtime behavior or changing the existing GraphQL/Admin UI selector.
- Out of scope: using direct Lambda invocation as the final proof path, except as diagnostic support.

## Existing Patterns To Follow

- `packages/api/src/handlers/chat-agent-invoke.ts` is the canonical thread-message dispatch path. It already persists `thread_turns.usage_json.tools_called` and `thread_turns.usage_json.tool_invocations` when the runtime returns them.
- `packages/api/test/integration/sandbox/sandbox-pilot.e2e.test.ts` shows deployed integration-test posture with DB assertions.
- `packages/api/test/integration/user-memory-mcp/agent-user-mcp.e2e.test.ts` and `packages/api/test/integration/user-memory-mcp/codex-user-memory-mcp.e2e.test.ts` show live MCP/memory E2E structure.
- `scripts/smoke-thread-cleanup.sh` and `scripts/smoke/_env.sh` show repo-local smoke script conventions and deployed env resolution.
- `packages/agentcore-pi/agent-container/tests/system-prompt.test.ts` and `packages/agentcore-pi/agent-container/tests/env-snapshot.test.ts` show Pi package test conventions.
- `docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md` reinforces the verification stance: assert raw persisted state and logs, not only UI narratives.

## Decisions

1. The E2E harness must create real chat threads and send real user messages. This avoids the earlier wakeup-only false positive where a turn succeeded without a visible thread.
2. Passing criteria require persisted evidence: assistant message, `thread_turns.status='succeeded'`, runtime `pi`, and either `usage_json.tool_invocations`/`tools_called` or capability-specific raw storage/log evidence.
3. Capability support should be implemented in Pi before declaring a capability green. A model claiming it searched or executed code is a failure unless runtime evidence proves the tool call.
4. Hindsight end-of-turn validation needs two checks: runtime/cost evidence that retain or reflect ran, and a recall query or DB/provider read proving the new memory is retrievable.
5. MCP validation should enumerate the sandbox agent's resolved `mcp_configs` and create one scenario per server/tool where feasible. If no MCP servers are configured, the harness should report `SKIP:no_mcp_configured`, not pass.

## Implementation Units

### U1. Add A Deployed Pi Capability Smoke Harness

**Goal:** Provide one repeatable command that creates thread-message smokes for Pi capabilities and asserts persisted results.

**Create/Modify:**

- Create: `packages/api/scripts/pi-runtime-capability-smoke.ts`
- Modify: `packages/api/package.json`
- Optional helper: `packages/api/scripts/lib/pi-smoke-graphql.ts`

**Approach:**

- Resolve `VITE_GRAPHQL_HTTP_URL` and `VITE_GRAPHQL_API_KEY` from `apps/admin/.env` or accept `THINKWORK_GRAPHQL_URL`/`THINKWORK_GRAPHQL_API_KEY`.
- Accept `--tenant-id`, `--agent-id`, `--timeout`, and `--capability`.
- For each capability, create a chat thread with a unique title, call `sendMessage`, poll `messages` and `threadTurns(threadId:)`, and emit structured JSON summary.
- Fail when the assistant message exists but no runtime evidence exists for the requested tool.

**Test Scenarios:**

- Happy path: plain Pi chat smoke succeeds and returns a visible thread.
- Failure path: a capability prompt that produces assistant text but no `tool_invocations` fails with `FAIL:no_tool_evidence`.
- Timeout path: no terminal turn within the timeout fails with thread id and latest turn status.

**Verification:**

- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/api exec tsx packages/api/scripts/pi-runtime-capability-smoke.ts --capability plain --tenant-id <dev tenant> --agent-id <sandbox agent>`

### U2. Wire Pi Runtime Tool Invocation Metadata

**Goal:** Make Pi runtime return observable tool-call metadata in the shape `chat-agent-invoke` already persists.

**Modify:**

- `packages/agentcore-pi/agent-container/src/runtime/pi-loop.ts`
- `packages/agentcore-pi/agent-container/tests/*.test.ts`

**Approach:**

- Use `@mariozechner/pi-agent-core` `AgentTool` support rather than custom LLM parsing.
- Attach runtime tools through `initialState.tools`.
- Capture `tool_execution_start`/`tool_execution_end` or equivalent events into `tools_called` and `tool_invocations`.
- Return metadata at top level and/or inside `response` so `chat-agent-invoke` persists it unchanged.

**Test Scenarios:**

- Tool result appears in `tool_invocations`.
- Tool error is recorded without crashing the runtime.
- Multiple tool calls preserve source-order metadata.

**Verification:**

- `pnpm --filter @thinkwork/agentcore-pi test`
- Existing thread-message smoke still passes.

### U3. Add Pi Web Search Tool E2E

**Goal:** Prove the sandbox Pi agent can call web search from a deployed thread.

**Modify:**

- Pi runtime tool registry files from U2.
- `packages/api/scripts/pi-runtime-capability-smoke.ts`

**Approach:**

- Reuse the existing web-search skill/MCP implementation if it is available to the agent runtime. If it is Strands-specific, add a minimal Pi adapter around the same deployed API or skill handler.
- The smoke prompt should ask for a current fact and require a cited result that cannot be known from model-only memory.

**Test Scenarios:**

- Happy path: turn metadata includes `web_search` and assistant cites/searches.
- Missing key/provider: smoke fails with explicit web-search provider error.
- Disabled capability: smoke fails as `tool_not_registered`.

**Verification:**

- Deployed smoke: `--capability web_search`

### U4. Add Pi Code Sandbox E2E

**Goal:** Prove Pi can execute code through the sandbox path, not by hallucinating output.

**Modify:**

- Pi runtime tool registry files from U2.
- `packages/api/scripts/pi-runtime-capability-smoke.ts`

**Approach:**

- Use the existing sandbox preflight payload fields that `chat-agent-invoke` already applies.
- Register a Pi `execute_code` tool only when sandbox preflight reports `ready`.
- The smoke prompt should request a deterministic computation and require returning the exact output plus execution evidence.

**Test Scenarios:**

- Ready sandbox: metadata includes `execute_code`; answer contains deterministic output.
- Provisioning/unavailable sandbox: smoke reports the exact preflight status.
- Tool runtime error: turn succeeds or fails with structured tool error, never silent model output.

**Verification:**

- Deployed smoke: `--capability execute_code`

### U5. Add Pi Hindsight Memory E2E

**Goal:** Answer whether Hindsight memory is updated at end of turn and prove recall works.

**Modify:**

- Pi runtime memory integration files from U2.
- `packages/api/scripts/pi-runtime-capability-smoke.ts`

**Approach:**

- Determine the current Strands end-of-turn Hindsight contract and mirror it for Pi.
- At minimum, if `use_memory: true` and `hindsight_endpoint` are present, call retain/reflect after successful assistant response and return `hindsight_usage`.
- Add a smoke with a unique memory token in one turn, then run a second recall turn asking for that token. Assert recall evidence or provider record.

**Test Scenarios:**

- Retain: first turn stores unique token and reports Hindsight usage.
- Recall: second turn retrieves the unique token without it being in `messages_history` if possible.
- Missing Hindsight config: smoke reports skipped/failed with explicit config reason.

**Verification:**

- Deployed smoke: `--capability hindsight`
- `thread_turns.usage_json` or `cost_events` includes Hindsight evidence.

### U6. Add Pi MCP Server E2E

**Goal:** Prove configured MCP servers can be called through Pi.

**Modify:**

- Pi runtime MCP adapter files from U2.
- `packages/api/scripts/pi-runtime-capability-smoke.ts`

**Approach:**

- Use `mcp_configs` from `resolveAgentRuntimeConfig`.
- Register one Pi tool per MCP tool or an MCP bridge tool that forwards calls.
- Smoke enumerates configured MCP servers and exercises a safe read-only tool per server. If none exist, emit a skip with evidence.

**Test Scenarios:**

- At least one configured MCP server: call succeeds and metadata names server/tool.
- No configured MCP server: reports `SKIP:no_mcp_configured`.
- MCP tool error: structured error captured in turn metadata.

**Verification:**

- Deployed smoke: `--capability mcp`

### U7. Operator Runbook And CI-Friendly Output

**Goal:** Make results easy to interpret and paste into PRs/deploy checks.

**Create/Modify:**

- Create: `docs/runbooks/pi-runtime-capability-smoke.md`
- Modify: `packages/api/scripts/pi-runtime-capability-smoke.ts`

**Approach:**

- Document prerequisites, command examples, expected PASS/FAIL/SKIP outputs, and cleanup guidance.
- Emit one JSON line per capability plus a human-readable summary.

**Test Scenarios:**

- Partial failure exits non-zero.
- Explicit `--allow-skip mcp` keeps no-MCP dev stacks from failing the full suite.

**Verification:**

- `pnpm --filter @thinkwork/api exec tsx packages/api/scripts/pi-runtime-capability-smoke.ts --help`

## Sequencing

1. U1 first, because it provides the failing characterization harness.
2. U2 next, because every real capability depends on Pi tool registration and metadata capture.
3. U3/U4/U5 can proceed after U2, with Hindsight prioritized because it answers the user's explicit end-of-turn question.
4. U6 follows once the MCP adapter shape is clear.
5. U7 wraps the durable operator workflow.

## Risks And Mitigations

- **Risk:** Tool prompts pass by model text alone. **Mitigation:** every smoke asserts persisted tool evidence or raw provider evidence.
- **Risk:** Sandbox credentials are user-scoped and not present for API-key test calls. **Mitigation:** smoke accepts sender identity when needed and reports sandbox preflight status.
- **Risk:** MCP server availability differs by tenant/template. **Mitigation:** enumerate resolved config and make no-config a skip, not a fake pass.
- **Risk:** Hindsight writes may be async. **Mitigation:** poll recall/provider evidence with timeout and report retain-vs-recall separately.
- **Risk:** Implementing all Pi adapters in one PR may be large. **Mitigation:** U1 can land first as characterization; runtime adapter units can be split if needed.

## Acceptance Checklist

- A single command runs plain, web search, code sandbox, Hindsight, and MCP Pi smokes against the sandbox agent.
- Each capability reports PASS/FAIL/SKIP with thread id, turn id, and evidence.
- Hindsight memory update at end-of-turn is explicitly reported as PASS or FAIL.
- The sandbox agent's latest smoke threads are visible through `threads(tenantId, agentId)`.
- `thread_turns.usage_json.tool_invocations` or equivalent evidence exists for every passing tool/MCP capability.
