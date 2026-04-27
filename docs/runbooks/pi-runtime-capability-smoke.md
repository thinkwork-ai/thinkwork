# Pi Runtime Capability Smoke

Use this smoke after deploying Pi runtime changes to prove the real thread-message path can call runtime capabilities.

The smoke uses GraphQL to create a chat thread, sends a user message with `sendMessage`, polls the resulting assistant message and `thread_turns`, and then checks persisted evidence. For tool-backed capabilities, model text alone is not enough. A passing tool smoke requires `thread_turns.usage_json.tools_called` or `thread_turns.usage_json.tool_invocations` to name the tool.

## Prerequisites

- `apps/admin/.env` exists with `VITE_GRAPHQL_HTTP_URL` and `VITE_GRAPHQL_API_KEY`, or set `THINKWORK_GRAPHQL_URL` and `THINKWORK_GRAPHQL_API_KEY`.
- A deployed agent whose `runtime` is `PI`.
- The agent is reachable through the normal thread-message path.

## Command

```bash
pnpm --filter @thinkwork/api pi:capability-smoke -- \
  --tenant-id <tenant-id> \
  --agent-id <agent-id> \
  --capability all \
  --timeout 90000
```

Run one capability at a time while debugging:

```bash
pnpm --filter @thinkwork/api pi:capability-smoke -- \
  --tenant-id <tenant-id> \
  --agent-id <agent-id> \
  --capability web_search \
  --json
```

Capabilities:

- `plain` proves basic Pi thread-message routing and assistant persistence.
- `web_search` requires persisted web-search tool evidence.
- `execute_code` requires persisted code/sandbox tool evidence.
- `hindsight` requires persisted memory/retain/recall/reflect evidence.
- `mcp` requires persisted MCP tool/server evidence.

## Interpreting Results

`PASS` means the thread turn succeeded and the required persisted evidence was present.

`FAIL:no_tool_evidence_in_thread_turn_usage_json` means the assistant may have produced text that looks like a tool call, but the runtime did not actually report a tool invocation to `chat-agent-invoke`. Treat that as a real runtime wiring failure.

The output includes thread id, thread identifier, turn id, assistant message id, response text, and the persisted `usageJson`/`resultJson` evidence needed for follow-up debugging.

## Current Dev Baseline

As of 2026-04-27, plain Pi chat passes for the sandbox agent. Tool-backed smokes fail because `packages/agentcore-pi/agent-container/src/runtime/pi-loop.ts` does not register Pi tools or return tool invocation metadata. Hindsight end-of-turn memory is therefore not being retained by Pi turns.
