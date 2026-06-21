# Pi Runtime Capability Smoke

Use this smoke after deploying Pi runtime changes to prove the real thread-message path can call runtime capabilities.

The smoke uses GraphQL to create a chat thread, sends a user message with `sendMessage`, polls the resulting assistant message and `thread_turns`, and then checks persisted evidence. For tool-backed capabilities, model text alone is not enough. A passing tool smoke requires `thread_turns.usage_json.tools_called` or `thread_turns.usage_json.tool_invocations` to name the tool.

## Prerequisites

- `apps/web/.env` exists with `VITE_GRAPHQL_HTTP_URL` and
  `VITE_GRAPHQL_API_KEY`, or set `THINKWORK_GRAPHQL_URL` and
  `THINKWORK_GRAPHQL_API_KEY`.
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
- `goal` sends a composer-style goal-mode message and requires persisted `thread_turns.usage_json.goal_run` or `thread_turns.result_json.goal_run` evidence from `@narumitw/pi-goal`.
- `hindsight` requires persisted memory/retain/recall/reflect evidence.
- `mcp` requires persisted MCP tool/server evidence.

`--capability all` intentionally keeps the core routing/tool set (`plain`, `web_search`, `execute_code`, `hindsight`, `mcp`). Run `--capability goal` explicitly when validating THNK-21 or a Pi goal extension rollout:

```bash
pnpm --filter @thinkwork/api pi:capability-smoke -- \
  --tenant-id <tenant-id> \
  --agent-id <agent-id> \
  --sender-id <human-user-id> \
  --capability goal \
  --timeout 120000
```

`send_email` is not part of this smoke yet. A true `send_email` end-to-end test sends a real email, so use it deliberately: first verify runtime config includes `sendEmailConfig`, then run an explicit user-approved send test against a safe recipient. Do not use the old `agent-email-send` workspace skill path for new verification; Send Email is injected as a direct built-in tool.

## Interpreting Results

`PASS` means the thread turn succeeded and the required persisted evidence was present.

`FAIL:no_tool_evidence_in_thread_turn_usage_json` means the assistant may have produced text that looks like a tool call, but the runtime did not actually report a tool invocation to `chat-agent-invoke`. Treat that as a real runtime wiring failure.

`FAIL:no_goal_run_evidence_in_thread_turn_usage_json_or_result_json` means the assistant may have produced prose that sounds like it completed the goal, but the runtime/finalizer did not persist `goal_run` evidence. Treat that as a goal-mode wiring failure until proven otherwise. A passing goal smoke needs `source: "pi_goal"` plus either completed evidence with `goal_complete`/`completion_summary` or budget-limited evidence with a budget reason.

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
- Goal smoke with no `goal_run` evidence usually means one of the THNK-21 handoffs broke: the web/API message metadata did not include `goalMode`, the API did not resolve tenant `goalDefaultTokenBudget`, `chat-agent-invoke` did not send `goal_mode`, the Pi runtime did not load the goal extension, or finalize did not persist the runtime's `goal_run`.
- Goal smoke with no `goal_complete` invocation but `status: "complete"` can still pass when `completion_summary` is present, because `@narumitw/pi-goal` state may be the durable source of completion. Missing both tool and summary evidence is not a pass.

## Goal Extension Rollout Notes

- The imported runtime extension is pinned as `@narumitw/pi-goal@0.4.2` in the AgentCore Pi package.
- Source review for the pinned version found no unexpected network clients, no secret-bearing logs, and no non-tenant global persistence. Thinkwork wraps it with `THINKWORK_PI_GOAL_DISABLE_HIDDEN_CONTINUATION=1` so hidden continuations cannot bypass the normal thread-turn/finalize/cost pipeline.
- Goal state is session-scoped in the Pi workspace/session store. Thinkwork persists UI and smoke evidence on `thread_turns.usage_json.goal_run` and `thread_turns.result_json.goal_run`; v1 does not create or mutate durable `ThreadGoal` records.
- The tenant budget source of truth is Settings -> Agents / Agent configuration (`goalDefaultTokenBudget`). Users should not type token or cost budgets in the composer prompt.
- If `goal_complete` is absent from tool evidence, inspect the Pi runtime payload for `goal_mode`, `buildInvocationResources` extension tool names, and the `goal_complete` allowlist entry before trusting assistant text.
