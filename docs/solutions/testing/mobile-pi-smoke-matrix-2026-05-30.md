# Mobile Pi Smoke Matrix

Date: 2026-05-30

This matrix makes the mobile Pi host measurable across local tests, simulator,
deployed-stage harness runs, and TestFlight validation. It exists because the
mobile runtime is intentionally Pi-compatible rather than the upstream Pi SDK:
parity has to be checked by observable behavior, not by assuming the same host
process.

## Automated Harness

The executable harness is `apps/mobile/scripts/pi-harness-smoke.ts`.

Credential-free matrix check:

```bash
pnpm --filter @thinkwork/mobile smoke:pi-harness:dry-run
```

Credential-free full matrix check, including managed AgentCore Pi:

```bash
pnpm --filter @thinkwork/mobile smoke:pi-harness:full:dry-run
```

Credential-free background handoff matrix check:

```bash
pnpm --filter @thinkwork/mobile smoke:pi-harness:handoff:dry-run
```

Deployed-stage run:

```bash
pnpm --filter @thinkwork/mobile smoke:pi-harness -- \
  --tenant-id "$THINKWORK_TENANT_ID" \
  --agent-id "$THINKWORK_AGENT_ID" \
  --id-token "$THINKWORK_ID_TOKEN" \
  --capabilities all \
  --image-path ./fixtures/card.png \
  --file-path ./fixtures/note.txt \
  --json
```

Deployed-stage full run:

```bash
pnpm --filter @thinkwork/mobile smoke:pi-harness -- \
  --tenant-id "$THINKWORK_TENANT_ID" \
  --agent-id "$THINKWORK_AGENT_ID" \
  --id-token "$THINKWORK_ID_TOKEN" \
  --capabilities full \
  --image-path ./fixtures/card.png \
  --file-path ./fixtures/note.txt \
  --timeout 180000 \
  --json
```

The deployed run requires tenant, agent, GraphQL URL/API key, and Cognito
ID-token inputs. The script reads `apps/admin/.env` and `apps/mobile/.env` for
non-secret API defaults, resolves the current `me.id` from the Cognito token,
and accepts `THINKWORK_USER_ID` only as a fallback. It does not mint a user
token.

## Coverage

| Capability                  | Expected Evidence                                                               | Thread Capture                                                      |
| --------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `plain`                     | Assistant includes the generated token with no required tool call.              | Script prints `thread.id` and `thread.identifier`.                  |
| `workspace`                 | User identity answer is grounded in `USER.md`/requester context.                | Script prints `thread.id` and `thread.identifier`.                  |
| `workspace_tools`           | At least one cached-workspace tool call: `read`, `grep`, `find`, or `ls`.       | Script prints `thread.id` and `thread.identifier`.                  |
| `web_search`                | Direct ThinkWork `web_search` is used; it is not routed through MCP.            | Script prints `thread.id` and `thread.identifier`.                  |
| `bash`                      | A `bash`/shell tool call precedes the answer and command output matches.        | Script prints `thread.id` and `thread.identifier`.                  |
| `skill`                     | Shared `workspace_skill` reads deterministic skill instructions.                | Script prints `thread.id` and `thread.identifier`.                  |
| `mcp`                       | Bounded `mcp` gateway is used for list/search/call.                             | Script prints `thread.id` and `thread.identifier`.                  |
| `mcp_auth_failure`          | Invalid bearer resolution returns recoverable auth/reconnect guidance.          | Script prints `thread.id` and `thread.identifier`.                  |
| `image`                     | Image reaches the model and is persisted as mobile session attachment evidence. | Script prints `thread.id` and `thread.identifier`.                  |
| `file`                      | File metadata reaches `mobile_session.attachments`.                             | Script prints `thread.id` and `thread.identifier`.                  |
| `handoff_local`             | Durable mobile lease starts, checkpoints, and finalizes before stale claim.     | Script prints `thread.id`, `thread.identifier`, and `threadTurnId`. |
| `agentcore_pi`              | A normal managed AgentCore Pi thread turn completes with runtime `pi`.          | Script prints `thread.id` and `thread.identifier`.                  |
| `handoff_managed`           | Heartbeat stops, watchdog claims the same turn, and AgentCore completes it.     | Script prints `thread.id`, `thread.identifier`, and `threadTurnId`. |
| `handoff_late_finalize`     | Managed claim/completion rejects a later mobile finalization attempt.           | Script prints `thread.id`, `thread.identifier`, and `threadTurnId`. |
| `handoff_unsafe_checkpoint` | Unsafe in-flight checkpoint is skipped and the latest safe checkpoint is used.  | Script prints `thread.id`, `thread.identifier`, and `threadTurnId`. |
| `abort`                     | Stop reason is persisted as `aborted`.                                          | Script prints `thread.id` and `thread.identifier`.                  |

## Runtime Parity Notes

- Desktop Local Pi and AgentCore Pi can be compared directly for shared
  capabilities: plain, workspace/name, web search, bash, workspace read/search,
  workspace skills, MCP CRM, abort, and missing MCP credentials.
- Mobile-only rows, including camera/photo-library selection, file picker, and
  clipboard permissions, should be compared against desktop by evidence shape
  rather than identical OS affordances.
- Mobile's default execution primitive is host-contained `bash` backed by
  `just-bash`. AgentCore/desktop `execute_code` remains a separate sandbox
  capability and is not part of the mobile-required `all` matrix unless a future
  mobile code-interpreter extension is intentionally added.
- Simple prompts should route optimistically and show activity immediately.
  External calls such as MCP and web search may take longer, but workspace sync
  should not be visible as part of the model turn when the cache is warm.
- Background handoff uses the existing stall monitor. The smoke timeout should
  be at least 180 seconds because the stale threshold is 30 seconds but the
  watchdog cadence is roughly one minute.
- Handoff rows intentionally validate one logical turn: the user message is
  created by the mobile lease, the activity stream records local checkpoints and
  managed claim, and the assistant answer is finalized by exactly one owner.
- For new thread UI smokes, submit must seed the mobile lease atomically through
  `createThread` before routing/local model work. The required visible proof is
  that immediately backgrounding after submit still leaves a running
  `thread_turns` row with checkpoint 0 for AgentCore to claim.

## Current Operational Gaps

- TestFlight validation is a manual gate after local, simulator, and deployed
  harness checks. The repository should not run manual production mutations as
  part of this smoke path.

## Latest Dev Evidence

2026-05-30, dev stage:

- Full matrix passed for `plain` (`CHAT-919`), `workspace` (`CHAT-920`),
  `workspace_tools` (`CHAT-921`), `web_search` (`CHAT-922`), `mcp`
  (`CHAT-923`), `mcp_auth_failure` (`CHAT-924`), `bash` (`CHAT-925`),
  `skill` (`CHAT-926`), `agentcore_pi` (`CHAT-929`), and `abort`
  (`CHAT-930`).
- Attachment rows passed after repo-relative fixture path support: `image`
  (`CHAT-931`) and `file` (`CHAT-932`).

2026-05-31, U5 branch:

- Dry-run handoff matrix passed locally for `handoff_local`, `handoff_managed`,
  `handoff_late_finalize`, and `handoff_unsafe_checkpoint`; every row prints a
  replayable `threadTurnId`.
- Full dry-run matrix now covers 16 rows: local/tool/skill/MCP/attachment rows,
  normal managed AgentCore Pi, four handoff scenarios, and abort.
- Deployed dev handoff rows passed with the U5 harness:
  `handoff_local` (`CHAT-936`), `handoff_managed` (`CHAT-937`),
  `handoff_unsafe_checkpoint` (`CHAT-938`), and `handoff_late_finalize`
  (`CHAT-939`).
