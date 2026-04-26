# User Memory MCP end-to-end harness

Lives in `packages/api/test/integration/user-memory-mcp/`. Validates two
live surfaces deliberately and opt-in:

- `agent-user-mcp.e2e.test.ts` invokes a deployed ThinkWork agent that has
  a user-authorized MCP server assigned to it, then checks the resulting
  `thread_turns.tool_invocations` for the MCP call.
- `codex-user-memory-mcp.e2e.test.ts` calls the real inbound User Memory MCP
  server directly from this workspace with the current user's bearer token.

These tests do **not** run in default CI. Without live-stage env vars they
print a blocked diagnostic and pass without mutating deployed resources.

## Run

```bash
pnpm --filter @thinkwork/api user-memory-mcp:e2e
```

## Agent outbound MCP env

This scenario expects the stage already has an agent assigned to an approved
MCP server and that the thread's creator, or supplied message sender, has an
active `user_mcp_tokens.user_id` token for that server.

| Variable | What |
|---|---|
| `STAGE` | Deployed stage, e.g. `dev`. |
| `AWS_REGION` | AWS region, defaults to `us-east-1`. |
| `DATABASE_URL` | Postgres connection string with `sslmode=require`. |
| `USER_MEMORY_MCP_E2E_TENANT_ID` | Tenant id that owns the test agent/thread. |
| `USER_MEMORY_MCP_E2E_AGENT_ID` | Agent id with the MCP server assigned. |
| `USER_MEMORY_MCP_E2E_THREAD_ID` | Existing thread id for the invocation. |
| `USER_MEMORY_MCP_E2E_MESSAGE_ID` | Optional user message id; otherwise `chat-agent-invoke` falls back to the thread creator. |
| `USER_MEMORY_MCP_E2E_PROMPT` | Optional prompt. Defaults to asking the agent to call the configured user-memory MCP probe tool. |
| `USER_MEMORY_MCP_E2E_EXPECTED_TOOL` | Optional tool/server substring to require in `thread_turns.tool_invocations`. |

## Direct Codex User Memory MCP env

This scenario is blocked until
`docs/plans/2026-04-20-008-feat-memory-wiki-mcp-server-plan.md` ships a real
inbound User Memory/Wiki MCP endpoint.

| Variable | What |
|---|---|
| `USER_MEMORY_MCP_URL` | Streamable-HTTP MCP endpoint for the user's ThinkWork Memory/Wiki MCP server. |
| `USER_MEMORY_MCP_TOKEN` | Bearer token for the current user. |
| `USER_MEMORY_MCP_REQUIRE_RECALL_MATCH` | Optional `true` to poll until `memory_recall` returns the retained sentinel. |

## What success means

- The agent outbound test proves the deployed agent runtime can use a
  user-scoped MCP credential selected by `user_mcp_tokens.user_id`.
- The Codex direct test proves this workspace can call the real user-facing
  `retain`, `memory_recall`, and `wiki_search` tools once the inbound server
  exists.
