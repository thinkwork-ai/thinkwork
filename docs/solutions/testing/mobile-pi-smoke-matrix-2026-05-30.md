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

Deployed-stage run:

```bash
pnpm --filter @thinkwork/mobile smoke:pi-harness -- \
  --tenant-id "$THINKWORK_TENANT_ID" \
  --agent-id "$THINKWORK_AGENT_ID" \
  --user-id "$THINKWORK_USER_ID" \
  --id-token "$THINKWORK_ID_TOKEN" \
  --capabilities all \
  --image-path ./fixtures/card.png \
  --file-path ./fixtures/note.txt \
  --json
```

The deployed run requires tenant, agent, user, GraphQL URL/API key, and Cognito
ID-token inputs. The script reads `apps/admin/.env` and `apps/mobile/.env` for
non-secret API defaults, but it does not mint a user token.

## Coverage

| Capability         | Expected Evidence                                                               | Thread Capture                                     |
| ------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------- |
| `plain`            | Assistant includes the generated token with no required tool call.              | Script prints `thread.id` and `thread.identifier`. |
| `workspace`        | User identity answer is grounded in `USER.md`/requester context.                | Script prints `thread.id` and `thread.identifier`. |
| `workspace_tools`  | At least one cached-workspace tool call: `read`, `grep`, `find`, or `ls`.       | Script prints `thread.id` and `thread.identifier`. |
| `bash`             | A `bash`/shell tool call precedes the answer and command output matches.        | Script prints `thread.id` and `thread.identifier`. |
| `mcp`              | Bounded `mcp` gateway is used for list/search/call.                             | Script prints `thread.id` and `thread.identifier`. |
| `mcp_auth_failure` | Invalid bearer resolution returns recoverable auth/reconnect guidance.          | Script prints `thread.id` and `thread.identifier`. |
| `execute_code`     | Code interpreter or execute-code tool is used instead of mental math.           | Script prints `thread.id` and `thread.identifier`. |
| `image`            | Image reaches the model and is persisted as mobile session attachment evidence. | Script prints `thread.id` and `thread.identifier`. |
| `file`             | File metadata reaches `mobile_session.attachments`.                             | Script prints `thread.id` and `thread.identifier`. |
| `abort`            | Stop reason is persisted as `aborted`.                                          | Script prints `thread.id` and `thread.identifier`. |

## Runtime Parity Notes

- Desktop Local Pi and AgentCore Pi can be compared directly for shared
  capabilities: plain, workspace/name, bash, workspace read/search, MCP CRM,
  abort, and missing MCP credentials.
- Mobile-only rows, including camera/photo-library selection, file picker, and
  clipboard permissions, should be compared against desktop by evidence shape
  rather than identical OS affordances.
- Simple prompts should route optimistically and show activity immediately.
  External calls such as MCP and web search may take longer, but workspace sync
  should not be visible as part of the model turn when the cache is warm.

## Current Operational Gaps

- Real deployed harness runs are blocked unless the operator supplies a valid
  Cognito ID token plus tenant, agent, and user ids.
- TestFlight validation is a manual gate after local, simulator, and deployed
  harness checks. The repository should not run manual production mutations as
  part of this smoke path.
