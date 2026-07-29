# Memory Retain/Recall Runbook

Use this runbook after deploying memory runtime or retain-worker changes. The
bar is the product path: a new thread states a durable fact, the retain worker
hands the turn to Bedrock AgentCore Memory, AgentCore extracts it in the
background, and a separate new thread recalls it.

AgentCore managed memory is the only memory engine. The Pi runtime invokes the
`memory-retain` Lambda once per turn; the Lambda calls `adapter.retainTurn` and
AgentCore runs its own extraction into the semantic, preferences, summaries, and
episodes namespaces. There is no fact-extraction step we own, so retain success
and record visibility are two separate events — extraction is asynchronous and a
`retained` attempt can briefly precede a searchable record.

## Smoke

```bash
pnpm --filter @thinkwork/api memory:retain-recall-smoke -- \
  --tenant-id <tenant-id> \
  --agent-id <agent-id> \
  --sender-id <user-id> \
  --timeout 180000
```

The smoke also reads `apps/web/.env` for `VITE_GRAPHQL_HTTP_URL` and
`VITE_GRAPHQL_API_KEY`. CI can pass `THINKWORK_GRAPHQL_URL`,
`THINKWORK_GRAPHQL_API_KEY`, `THINKWORK_TENANT_ID`, `THINKWORK_AGENT_ID`, and
`THINKWORK_USER_ID`.

Passing evidence includes:

- a retain thread id and a recall thread id
- a `memoryRetainAttempts` row with status `retained`
- a `memoryRecords` result containing the unique smoke token
- a later assistant answer containing the token from a separate recall thread

## Manual UI Check

1. Open `http://localhost:5180` and create a new thread.
2. Send a fresh fact in this shape:
   `Memory verification: We brought home a poodle named <Pet>. <Pet>'s favorite blue rope toy is named <Token>.`
3. Wait for the assistant turn to finish.
4. Open `/settings/memory`, click the refresh icon, and search for `<Token>`.
5. Create another new thread and ask:
   `What is my poodle <Pet>'s favorite blue rope toy named?`

This must be a separate recall thread. Reusing the original thread only proves
conversation context, not memory recall.

## Retain Statuses

- `queued`: an attempt exists and is waiting to run.
- `running`: a worker claimed the attempt.
- `retained`: `retainTurn` was accepted by AgentCore. Records appear once
  AgentCore's background extraction completes — usually seconds, not instant.
- `failed_timeout`: the AgentCore call timed out and product retry should run.
- `failed_backend`: provider/backend failure; product retry should run.
- `dead_lettered`: max attempts exceeded or terminal failure; inspect
  `errorClass`, `errorMessage`, and CloudWatch for the retain Lambda.

The Memory page refreshes records and retain diagnostics together. Retry and
dead-letter counts appear only when there is operator action to take.

## Triage

- Memory record missing but attempt retained: give AgentCore extraction a few
  seconds and refresh; then search by the exact token in `/settings/memory` and
  inspect `providerResult` on the retain attempt. A durable gap means AgentCore
  saw the turn but did not judge it worth extracting — check the turn actually
  stated a fact rather than asking a question.
- Attempt stuck in `queued`: check the retry drainer schedule and
  `memory-retain` Lambda invocations.
- Attempt stuck in `running`: check lock age and retry-drainer lock expiry.
- Recall answer missing token but record exists: check Pi runtime container
  version and direct memory-question preflight. Direct questions should pass a
  `groundingQuery` to the memory extension before model answer generation.
- UI does not refresh: use the Memory header refresh icon, which should spin
  while records and retain diagnostics refetch.
