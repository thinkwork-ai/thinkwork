# Pi Runtime Capability Smoke

Use this smoke after deploying Pi runtime changes to prove the real thread-message path can call runtime capabilities.

The smoke uses GraphQL to create a chat thread, sends a user message with `sendMessage`, polls the resulting assistant message and `thread_turns`, and then checks persisted evidence. For tool-backed capabilities, model text alone is not enough. A passing tool smoke requires `thread_turns.usage_json.tools_called` or `thread_turns.usage_json.tool_invocations` to name the tool.

## Prerequisites

- `` exists with `VITE_GRAPHQL_HTTP_URL` and `VITE_GRAPHQL_API_KEY`, or set `THINKWORK_GRAPHQL_URL` and `THINKWORK_GRAPHQL_API_KEY`.
- A deployed agent whose `runtime` is `PI`.
- The agent is reachable through the normal thread-message path.
- For `execute_code`, the agent/template must have Code Sandbox enabled and sandbox preflight must report a ready interpreter for the invoking user.
- For `browser_automation`, the agent/template must have Browser Automation enabled and the Pi runtime role/image must include AgentCore Browser permissions.

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
- `browser_automation` requires persisted AgentCore Browser tool evidence and should include Browser substrate cost metadata when the session starts.
- `hindsight` requires persisted memory/retain/recall/reflect evidence.
- `mcp` requires persisted MCP tool/server evidence.

`send_email` is not part of this smoke yet. A true `send_email` end-to-end test sends a real email, so use it deliberately: first verify runtime config includes `sendEmailConfig`, then run an explicit user-approved send test against a safe recipient. Do not use the old `agent-email-send` workspace skill path for new verification; Send Email is injected as a direct built-in tool.

## Interpreting Results

`PASS` means the thread turn succeeded and the required persisted evidence was present.

`FAIL:no_tool_evidence_in_thread_turn_usage_json` means the assistant may have produced text that looks like a tool call, but the runtime did not actually report a tool invocation to `chat-agent-invoke`. Treat that as a real runtime wiring failure.

The output includes thread id, thread identifier, turn id, assistant message id, response text, and the persisted `usageJson`/`resultJson` evidence needed for follow-up debugging.

For Pi core-agent readiness, run at minimum:

```bash
pnpm --filter @thinkwork/api pi:capability-smoke -- \
  --tenant-id <tenant-id> \
  --agent-id <pi-agent-id> \
  --sender-id <human-user-id> \
  --capability execute_code,browser_automation \
  --timeout 120000
```

Do not mark the core ThinkWork agent Pi-ready until both capabilities pass through this deployed thread-message path. The pass condition is persisted `thread_turns.usage_json.tool_invocations`, not model-written prose.

## Troubleshooting

- `turn_status_running` or a timeout usually means the runtime did not POST the finalize callback. Check the Pi Lambda logs for `finalize_callback_*`.
- `no_successful_tool_evidence_in_thread_turn_usage_json` means the tool was not called or the finalizer did not persist the invocation list.
- Browser `AccessDeniedException` means the Pi runtime role is missing AgentCore Browser actions such as `StartBrowserSession`, `InvokeBrowser`, or `StopBrowserSession`.
- Browser evidence with no cost row means the runtime called Browser but did not pass `tool_costs` through the finalizer payload.
- Sandbox provisioning/cap errors are real tool results. Check tenant sandbox readiness and quota before rerunning.
