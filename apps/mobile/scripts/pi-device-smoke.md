# Mobile Pi Device Smoke Checklist

Use this checklist for simulator, TestFlight, and real-device validation after
the automated harness is green. Record both the ThinkWork `thread.id` UUID and
the human `thread.identifier` for every run so failures can be replayed from the
desktop/admin console.

## Setup

1. Copy the mobile environment from the main checkout when using a worktree:
   `cp /Users/ericodom/Projects/thinkwork/apps/mobile/.env apps/mobile/.env`.
2. Build the React Native SDK workspace package:
   `pnpm --filter @thinkwork/react-native-sdk build`.
3. Start the local app:
   `pnpm --filter @thinkwork/mobile ios`.
4. Select the `Default` space and the same agent used by the desktop Pi smoke.
5. Keep the activity timeline open enough to confirm tool evidence and stop
   reasons.

## Harness Commands

Dry-run matrix, no deployed credentials required:

```bash
pnpm --filter @thinkwork/mobile smoke:pi-harness:dry-run
```

Deployed-stage matrix, with identity inputs supplied through flags or env:

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

## Matrix

| Capability         | Prompt                                                  | Expected Signal                                                                         |
| ------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `plain`            | Ask for a short exact-token reply.                      | Optimistic route and Working state appear immediately; no tool call required.           |
| `workspace`        | Ask "what is my name?"                                  | Answer uses `USER.md` or requester context; no visible full workspace sync in the turn. |
| `workspace_tools`  | Ask it to inspect cached workspace files.               | At least one of `read`, `grep`, `find`, or `ls` appears in tool events.                 |
| `bash`             | Ask it to run a simple command and not answer mentally. | `bash` tool call precedes the answer; command output matches.                           |
| `mcp`              | Ask for a safe CRM read-only call.                      | Bounded `mcp` list/search/call is used; no bearer token is shown.                       |
| `mcp_auth_failure` | Run with invalid MCP bearer resolution.                 | Recoverable auth/reconnect guidance is visible.                                         |
| `image`            | Attach a photo or fixture image.                        | Image evidence is persisted in `mobile_session.attachments`.                            |
| `file`             | Attach a small text file.                               | Filename, MIME type, size, and attachment evidence are persisted.                       |
| `abort`            | Start a long turn and cancel.                           | UI shows cancellation and persisted stop reason is `aborted`.                           |

## Record

For each row, capture:

- Runtime: `Mobile Pi`, `Desktop Local Pi`, or `AgentCore Pi`.
- `thread.id` and `thread.identifier`.
- Time from submit tap to thread detail route.
- Time to first activity/assistant output.
- Tool calls and failures from the activity timeline.
- Pass, fail, skip, or blocked reason.

## TestFlight Gate

Submit to TestFlight only after unit tests, mobile web bundle, deployed harness
smokes, and at least one simulator pass are complete. Use the normal EAS
profile and avoid production mutation commands outside the merge/deploy
pipeline.
