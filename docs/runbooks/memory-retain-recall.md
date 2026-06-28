# Memory Retain/Recall Runbook

Use this runbook after deploying memory runtime or retain-worker changes. The
bar is the product path: a new thread states a high-confidence fact, the retain
worker writes it to Hindsight-backed Memory, and a separate new thread recalls
it from memory.

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
- `retained`: Hindsight writes completed and Memory records should be visible.
- `failed_timeout`: Hindsight timed out and product retry should run.
- `failed_backend`: provider/backend failure; product retry should run.
- `dead_lettered`: max attempts exceeded or terminal failure; inspect
  `errorClass`, `errorMessage`, and CloudWatch for the retain Lambda.

The Memory page refreshes records and retain diagnostics together. Retry and
dead-letter counts appear only when there is operator action to take.

## Triage

- Memory record missing but attempt retained: search by the exact token in
  `/settings/memory`; then inspect `providerResult` on the retain attempt.
- Attempt stuck in `queued`: check the retry drainer schedule and
  `memory-retain` Lambda invocations.
- Attempt stuck in `running`: check lock age and retry-drainer lock expiry.
- Recall answer missing token but record exists: check Pi runtime container
  version and direct memory-question preflight. Direct questions should pass a
  `groundingQuery` to the memory extension before model answer generation.
- UI does not refresh: use the Memory header refresh icon, which should spin
  while records and retain diagnostics refetch.
