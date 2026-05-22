---
title: "refactor: chat-agent-invoke direct-callback finalize architecture"
type: refactor
status: active
created: 2026-05-22
---

# chat-agent-invoke Direct-Callback Finalize Architecture

## Problem Frame

`packages/api/src/handlers/chat-agent-invoke.ts` (1,534 lines) currently does two distinct jobs in one Lambda:

1. **Setup** (≈ first 770 lines): validates the agent, resolves runtime config, builds the AgentCore invoke payload.
2. **Wait + Finalize** (≈ remaining 750 lines): invokes the AgentCore adapter Lambda via `InvocationType: "RequestResponse"`, synchronously waits up to 5 min, then on response runs cost recording, guardrail handling, assistant message insert, `notifyNewMessage`, computer-task completion, memory-retain dispatch, and eval/guardrail bookkeeping.

The Lambda's `timeout = 300` (5 min) and **no `EventInvokeConfig`** overriding `maximum_retry_attempts`. AgentCore can run up to 8 hours; real turns today routinely hit 4-8 min. Result: Lambda times out → AWS auto-retries up to 2× → each retry races against the same in-flight AgentCore session → the user's timeline shows 1-3 consecutive "5-min stall" entries before eventually catching the response on one of the retry attempts (or surfacing failure if all three time out).

## Goal

Eliminate the wait entirely. `chat-agent-invoke` does setup, dispatches the AgentCore adapter **Event-mode**, and returns in seconds. The Strands runtime, at end-of-turn, POSTs the finalize payload to a new HTTP endpoint `/api/threads/{threadId}/finalize`. A new Lambda handler owns the post-AgentCore bookkeeping that today lives at the tail of `chat-agent-invoke`.

User-facing UX is unchanged: the agent's streaming "Thinking…" updates over AppSync continue to flow during the turn exactly as they do today. What changes is that the user-message → assistant-message turn no longer fails or stalls because of a Lambda timeout, no matter how long AgentCore runs (full 8 h budget becomes usable).

## Non-Goals

- Do NOT introduce Step Functions or any new orchestration service.
- Do NOT rewrite the setup logic in `chat-agent-invoke.ts`; only change its dispatch + drop the wait/finalize path.
- Do NOT break `eval-runner` / `agentcore-direct.ts` — that path still uses `InvocationType: "RequestResponse"` and reads `invokeRes.Payload`. The finalize-callback behavior must be opt-in via a payload field that **only** `chat-agent-invoke` supplies.
- Do NOT migrate background "wake-up" paths in this plan — they have their own dispatch story. Scope is the user-message → assistant-message turn flow only.
- Do NOT change AppSync chunk streaming during the turn.
- Do NOT add a UI for "manually re-finalize this thread" right now — the endpoint exists, but no UI surface is built on top of it in this plan.

## Key Technical Decisions

1. **Opt-in callback gated on `finalize_callback_url` in the invoke payload.** The Strands runtime sees the field, runs in callback mode (POST finalize at end-of-turn, do not return the result via Lambda response). When the field is absent (`eval-runner` and any future direct-invocation caller), the existing synchronous return path is preserved verbatim. This means `chat-agent-invoke` and Strands are coupled by a single payload-field contract; everything else stays exactly as is.

2. **Idempotency key is `thread_turn_id`.** `chat-agent-invoke` already inserts a `thread_turns` row before dispatching (line ~452). The Strands runtime gets this `turn_id` in the invoke payload, includes it in the finalize POST body, and the finalize handler uses it as the dedup key: a `UNIQUE (thread_turn_id)` constraint on the assistant message insert plus a "finalized_at" timestamp on `thread_turns` so a second finalize call no-ops cleanly.

3. **Failure semantics: explicit error-callback on AgentCore-side failure.** When the Strands runtime hits an unrecoverable error mid-turn, it POSTs the finalize endpoint with `status: "failed"` + error details. The finalize handler inserts the error assistant message + marks the turn failed. If the Strands container crashes hard before it can POST anything, the `thread_turns` row stays in `dispatched` state — a future EventBridge reconciler sweep (out of scope here, deferred) can mark stale dispatched turns as failed after some grace period. In the meantime, the user sees no message; this is the same observable outcome as today's "Lambda exhausted all retries" case, just without the 15-min cascade.

4. **Authentication uses the existing `THINKWORK_API_SECRET` x-api-key pattern.** The Strands runtime already authenticates to `/api/workspaces/files` and `/api/memory/*` with `x-api-key: ${THINKWORK_API_SECRET}` (server.py line 895). The finalize endpoint reuses the same middleware; no new auth surface.

5. **Single new Lambda handler, not a route on graphql-http.** The finalize endpoint is a separate Lambda (`chat-agent-finalize`) wired to API Gateway under the existing API surface. This keeps the post-AgentCore code path independent of the GraphQL Lambda's bundle and gives the handler its own scaling profile. Mirrors the existing `chat-agent-invoke` handler-Lambda pattern.

6. **`chat-agent-invoke` Lambda timeout drops 300s → 60s** after the dispatch becomes Event-mode. Setup is ~5s; 60s gives 12× headroom for transient slowness. Add `EventInvokeConfig` with `maximum_retry_attempts = 0` (no auto-retries — setup failures are surfaced via the same error-message-insert path that exists today, then the user can resubmit). DLQ on setup failures so genuine outages are observable.

## High-Level Technical Design

This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.

```text
BEFORE (today):
GraphQL resolver
  → invokes chat-agent-invoke (Event-mode, fire-and-forget) ✓
      → invokes agentcore adapter Lambda (RequestResponse — BLOCKS 5 min)
          → Bedrock AgentCore service (Strands runtime, up to 8 h)
      ← AgentCore response returns through adapter ← chat-agent-invoke
      → cost recording / guardrail / message insert / notify / computer task / memory retain
      → return

  Failure mode: Lambda times out at 5 min → AWS auto-retry × 2 → each retry sees same in-flight AgentCore session
                User timeline shows multiple "5 min stall" entries

AFTER (this plan):
GraphQL resolver
  → invokes chat-agent-invoke (Event-mode, fire-and-forget, unchanged)
      → invokes agentcore adapter Lambda (EVENT mode now, no wait)
      → returns (~5 s total)

Strands runtime (running, up to 8 h)
  → stream chunks to AppSync during turn (unchanged)
  → at end of turn: POST to /api/threads/{id}/finalize with {turn_id, response, usage, guardrail_block, computer_state, ...}
      → invokes chat-agent-finalize Lambda
      → cost recording / guardrail / message insert / notify / computer task / memory retain
      → 200 OK back to Strands
  → done

  Failure mode: AgentCore-side errors POST finalize with status=failed → user sees error message exactly like today.
                Container crashes pre-POST leave the turn in 'dispatched' state (reconciler sweep handles this — deferred).
```

The contract field that makes this safe for `eval-runner`:

```text
invoke payload (chat-agent-invoke → AgentCore adapter):
  ...existing fields...
  finalize_callback_url: "https://api.../api/threads/{id}/finalize"   # chat-agent-invoke supplies this; eval-runner does not
  finalize_callback_secret: "${THINKWORK_API_SECRET}"                  # x-api-key value for the POST
  thread_turn_id: "<uuid>"                                             # idempotency key

Strands runtime behavior:
  if finalize_callback_url present:
    run turn → POST result to that URL → return empty/ack via Lambda response (or no response at all if invoked Event-mode)
  else:
    run turn → return full result via Lambda response (today's behavior — eval-runner path)
```

## Implementation Units

### U1. New `chat-agent-finalize` Lambda handler with the post-AgentCore logic

**Goal:** a working finalize endpoint that runs the same post-AgentCore bookkeeping `chat-agent-invoke` runs today, callable via HTTP with x-api-key auth, idempotent on `thread_turn_id`. No Strands changes yet; no dispatch changes yet.

**Files:**

- `packages/api/src/handlers/chat-agent-finalize.ts` (NEW)
- `packages/api/src/handlers/chat-agent-finalize.test.ts` (NEW)
- `packages/api/src/lib/chat-finalize/` (NEW directory — extracted helpers shared between chat-agent-invoke and the new handler; see Approach for what moves)
- `terraform/modules/app/lambda-api/handlers.tf` — add `chat-agent-finalize` to the handler key set (timeout 60s, EventInvokeConfig with `maximum_retry_attempts = 0` mirroring the wiki-compile pattern)
- `terraform/modules/app/lambda-api/main.tf` and the API Gateway route table — wire `POST /api/threads/{threadId}/finalize` to the new Lambda
- `scripts/build-lambdas.sh` — add `chat-agent-finalize` to the build entry list
- `packages/database-pg/drizzle/NNNN_thread_turns_finalized_at.sql` — add `finalized_at timestamptz` to `thread_turns` (hand-rolled, with `-- creates-column: public.thread_turns.finalized_at` marker)
- `packages/database-pg/src/schema/threads.ts` (or wherever `threadTurns` lives) — Drizzle column declaration

**Approach:**

1. Extract the post-AgentCore code path from `chat-agent-invoke.ts` (lines ~770 → ~1534) into helper modules under `packages/api/src/lib/chat-finalize/`. Candidate helpers: `recordCostFromInvokeResult`, `recordGuardrailBlock`, `insertAssistantMessageForTurn`, `notifyAssistantMessage`, `completeComputerTaskFromFinalize`, `dispatchMemoryRetainForTurn`. Extract as pure functions taking explicit deps so they're testable without the Lambda harness. **Do not change behavior** — characterize the existing code path first, then mechanically lift it.
2. Write `chat-agent-finalize.ts` as a thin HTTP handler that:
   - Validates `x-api-key: ${THINKWORK_API_SECRET}` (use the existing service-auth middleware pattern).
   - Parses the request body into a `FinalizePayload` type (`thread_turn_id`, `response`, `usage`, `guardrail_block`, `computer_state`, `duration_ms`, `status: "completed" | "failed"`, `error_message?`).
   - Looks up the `thread_turns` row by `thread_turn_id`. If `finalized_at IS NOT NULL`, return 200 with `{idempotent: true}` — already finalized.
   - Otherwise, in a single transaction: set `finalized_at = now()`, then call the extracted helpers in the same order chat-agent-invoke uses today (cost → guardrail → message insert → notify → computer task → memory retain).
   - On any helper error: log + insert a `GENERIC_AGENT_ERROR_MESSAGE` assistant message + set turn status = failed (use the same code path chat-agent-invoke uses today). Return 500.
3. Schema: add `finalized_at timestamptz` to `thread_turns`. Index: none required for now (lookups are PK-keyed on `id`).
4. Lambda config: timeout 60s, memory 256 MB (mirror chat-agent-invoke), DLQ + `maximum_retry_attempts = 0` (single-shot — Strands retries on its side).
5. API Gateway: `POST /api/threads/{threadId}/finalize` → invoke chat-agent-finalize. Pull `threadId` from the path param, but also verify against the `thread_turn_id` body field (defense in depth — POST body's `thread_id` must match path).

**Patterns to follow:**

- `packages/api/src/handlers/chat-agent-invoke.ts` lines 880-1534 — that's the source of the lift. Read carefully; preserve every observable side-effect.
- `packages/api/src/handlers/memory-retain.ts` — existing service-to-service x-api-key handler shape.
- Migration drift gate: hand-rolled `.sql` files declare their objects via `-- creates-column: public.thread_turns.finalized_at` so `db:migrate-manual` catches it; apply via `psql` to dev before the deploy gate runs (see `feedback_handrolled_migrations_apply_to_dev` memory).

**Test scenarios (`chat-agent-finalize.test.ts`):**

- **Happy path (completed turn):** valid payload with `status: "completed"` + non-empty response text → assistant message inserted, cost events recorded, AppSync `notifyNewMessage` called, turn `finalized_at` set, 200 OK.
- **Happy path (guardrail-blocked turn):** payload with `guardrail_block.blocked = true` → guardrail-block row inserted, error message inserted, 200 OK.
- **Happy path (failed turn):** payload with `status: "failed"` + `error_message` → error assistant message inserted, turn status set to failed, 200 OK.
- **Idempotency:** finalize POST → succeeds. Second POST with same `thread_turn_id` → 200 with `{idempotent: true}`; no second message inserted, no second cost-event row, no second notify call.
- **Auth missing:** POST with no x-api-key → 401.
- **Auth wrong:** POST with wrong x-api-key → 401.
- **Path/body mismatch:** path `/api/threads/A/finalize` with body `thread_id: B` → 400.
- **Unknown `thread_turn_id`:** POST referencing a non-existent turn → 404.
- **Integration:** with mocked DB, send a fully-shaped completed-turn payload and verify the entire side-effect chain fires in the right order. No mocks for the helpers themselves — they're the unit under test.

**Verification:**

- `pnpm --filter @thinkwork/api test -- src/handlers/chat-agent-finalize.test.ts` passes.
- `pnpm --filter @thinkwork/api run typecheck` clean.
- Existing `chat-agent-invoke.test.ts` still passes (lifting helpers shouldn't break it; this unit explicitly does not change chat-agent-invoke's caller-visible behavior yet).
- The hand-rolled migration applies to dev via `psql` and `pnpm db:migrate-manual` reports it present.

---

### U2. Strands runtime: opt-in finalize-callback POST at end of turn

**Goal:** when the invoke payload includes `finalize_callback_url`, the Strands runtime POSTs the finalize payload at end-of-turn instead of (or in addition to) returning it via the AgentCore Lambda response. When the field is absent, behavior is unchanged.

**Files:**

- `packages/agentcore-strands/agent-container/container-sources/server.py` (modify the end-of-turn flow)
- `packages/agentcore-strands/agent-container/test_finalize_callback.py` (NEW) — pytest covering the callback gating + payload shape + retry-once behavior

**Dependencies:** U1 (the endpoint must exist before Strands calls it — but Strands can be tested against a mock).

**Approach:**

1. In `server.py`, near the end of the agent-turn flow, read `finalize_callback_url`, `finalize_callback_secret`, and `thread_turn_id` from the invoke payload (around the same place workspace/tenant fields are read today, ~line 2809).
2. After the turn completes (whether by success, guardrail block, or runtime error), build the `FinalizePayload` (`thread_turn_id`, `response`, `usage`, `guardrail_block`, `computer_state`, `duration_ms`, `status`, optional `error_message`). The payload field shape mirrors what `chat-agent-invoke` reads today after the AgentCore response — same JSON structure, just sent via HTTP POST instead of Lambda response.
3. If `finalize_callback_url` is set: POST `${finalize_callback_url}` with `Content-Type: application/json`, `x-api-key: ${finalize_callback_secret}`, body = `FinalizePayload`. On non-2xx, log + retry **once** with 1s backoff (longer retries don't help — this is the LAST thing the turn does, and the user will see a stuck "thinking" state if it never resolves; better to surface failure quickly via the reconciler sweep). Do not block longer than ~5s total.
4. **Backward compat:** when `finalize_callback_url` is absent, return the response payload via the AgentCore Lambda response exactly as today. `eval-runner` and other direct callers see no change.
5. Container env snapshot: capture `THINKWORK_API_URL`, `THINKWORK_API_SECRET`, and `finalize_callback_url` at the start of the agent coroutine, per the existing `feedback_completion_callback_snapshot_pattern` memory — never re-read `os.environ` mid-turn.

**Patterns to follow:**

- `packages/agentcore-strands/agent-container/container-sources/server.py` line 895 area — existing x-api-key POST pattern to `${THINKWORK_API_URL}/api/workspaces/files`. Same shape.
- `feedback_hindsight_async_tools` memory — if any new wrappers around the HTTP call are async, follow the recall/reflect pattern (`async def`, fresh client, `aclose`, retry).

**Test scenarios (`test_finalize_callback.py`):**

- **Happy path:** payload with `finalize_callback_url` set → turn runs → finalize POST fires with matching body → no Lambda-response return (or returns ack envelope only).
- **Legacy path:** payload without `finalize_callback_url` → turn runs → full response returned via Lambda response, no POST.
- **Retry on transient failure:** POST returns 503 once, then 200 → no error, finalize considered successful.
- **Retry exhausted:** POST returns 503 twice → log error, do not block, return whatever ack envelope makes sense for Event-mode.
- **Guardrail block:** turn blocked by guardrail → finalize POST fires with `guardrail_block.blocked = true`.
- **Runtime error:** mid-turn exception → finalize POST fires with `status: "failed"`, `error_message` set.
- **Env snapshot regression:** simulate `os.environ` mutation mid-turn → POST still uses the snapshot captured at turn start (covers the prior shadow-bug pattern).

**Verification:**

- `uv run pytest packages/agentcore-strands/agent-container/test_finalize_callback.py` passes.
- Existing `test_server_chunk_streaming.py` and other Strands tests still pass (no regression on the legacy path).

---

### U3. `chat-agent-invoke`: drop the wait, switch dispatch to Event-mode, pass `finalize_callback_url`

**Goal:** the chat-agent-invoke Lambda dispatches the AgentCore adapter Event-mode and returns immediately. No more synchronous wait. The Strands runtime gets the finalize callback details in its payload.

**Files:**

- `packages/api/src/handlers/chat-agent-invoke.ts` (delete ~750 lines of post-AgentCore code; add ~10 lines of payload additions + dispatch flip)
- `packages/api/src/handlers/chat-agent-invoke.test.ts` (update test expectations — no longer mocks an AgentCore response; instead verifies the dispatch shape and that the helper functions are NOT called from here anymore)

**Dependencies:** U1 + U2 (need both the endpoint and Strands behavior in place before chat-invoke can rely on the callback).

**Approach:**

1. Build the finalize callback URL from environment + the `threadId` path param: `${THINKWORK_API_URL}/api/threads/${threadId}/finalize`. Add to the invoke payload: `finalize_callback_url`, `finalize_callback_secret: THINKWORK_API_SECRET`, `thread_turn_id: turnId`.
2. Flip the AgentCore adapter invocation from `InvocationType: "RequestResponse"` to `InvocationType: "Event"`. The `await lambdaClient.send(...)` still resolves (when the dispatch is accepted), but it no longer waits for the agent runtime; it returns once the Event-mode invoke is queued.
3. Delete everything from "AgentCore response received" through the end of the handler — that ~750 lines is now the finalize handler's job. **Carefully preserve** the pre-dispatch error paths (the agent-not-found, sandbox-preflight-failed, runtime-not-provisioned paths) — those stay in chat-agent-invoke because they happen during setup, before AgentCore is invoked.
4. Update `markComputerTaskFailedFromChatInvokeError` and related call sites: these are pre-dispatch error paths and stay; the post-dispatch ones move to finalize.
5. Terraform: bump `chat-agent-invoke` timeout from 300s → 60s. Add `aws_lambda_function_event_invoke_config.chat_agent_invoke` with `maximum_retry_attempts = 0` and an SQS DLQ (mirror `aws_lambda_function_event_invoke_config.wiki_compile`).
6. The `GENERIC_AGENT_ERROR_MESSAGE` / `chatInvokeErrorMessage` path that currently fires on AgentCore failure: that whole codepath stays alive but **moves to the finalize handler** (it fires when finalize is called with `status: "failed"`). The pre-dispatch error paths in chat-agent-invoke continue to insert error messages directly.

**Patterns to follow:**

- `terraform/modules/app/lambda-api/handlers.tf` `aws_lambda_function_event_invoke_config.wiki_compile` block for the retry-0 + DLQ pattern.
- Existing pre-dispatch error paths in `chat-agent-invoke.ts` for the inline error-message-insert shape.

**Test scenarios:**

- **Happy path dispatch:** valid invoke event → chat-invoke validates agent, builds payload including `finalize_callback_url`, dispatches AgentCore Event-mode, returns. No assistant message inserted by chat-invoke (that's finalize's job now). Cost recording not invoked. Memory retain not invoked.
- **Pre-dispatch agent-not-found:** invalid agent_id → error message inserted directly, no AgentCore dispatch, return.
- **Pre-dispatch sandbox-preflight failure:** sandbox unavailable for a sandbox-required agent → error message inserted, no dispatch, return.
- **AgentCore dispatch failure (Lambda invoke error):** `lambdaClient.send` rejects → error message inserted (still in chat-invoke since finalize won't be called), turn marked failed.
- **Event-mode contract:** `InvocationType: "Event"` is set on the InvokeCommand. Verify via spy/mock.
- **Idempotency-key plumbing:** `thread_turn_id` is included in the invoke payload and matches the row chat-invoke just inserted into `thread_turns`.

**Verification:**

- `pnpm --filter @thinkwork/api test -- src/handlers/chat-agent-invoke.test.ts` passes (updated expectations).
- `pnpm --filter @thinkwork/api run typecheck` clean.
- Manual end-to-end on dev: send a message → chat-invoke returns in < 5s (CloudWatch REPORT line) → Strands runs → finalize fires → assistant message appears in thread. Total wall time ≈ AgentCore turn duration (no 5-min stall).

---

### U4. Deploy + operational follow-ups

**Goal:** the new architecture is live in dev, observable, and has a documented rollback path.

**Files:** none — this is operational verification and one or two doc additions.

**Dependencies:** U1, U2, U3.

**Approach:**

1. **Apply the hand-rolled migration to dev** via `psql` before merging U1's PR (the Migration Drift Precheck CI gate enforces this; see `project_migration_precheck_ci_gate` memory).
2. **Deploy order:** U1 ships first (finalize endpoint live, but no callers — safe). U2 ships second (Strands learns the callback, but no `finalize_callback_url` is sent yet — still safe, legacy path used). U3 ships last (chat-invoke flips dispatch — now callbacks fire).
3. **CloudWatch log signatures preserved:** the `[chat-agent-invoke] Inserted assistant message: ${row.id}` log line moves to the finalize handler with the prefix `[chat-agent-finalize] Inserted assistant message: ${row.id}` — different prefix, same shape — so a CloudWatch search like `Inserted assistant message` still finds finalized turns. Document this in a one-line note in `docs/solutions/` so the next person searching for the old prefix isn't confused.
4. **Reconciler sweep for stuck `dispatched` turns:** defer to follow-up. Document the gap as a known limitation.
5. **Rollback plan:** if finalize fires but breaks (e.g., cost recording regression), the rollback is to revert U3. Once U3 is reverted, chat-invoke goes back to sync-wait + retry — degraded but functional. U1 and U2 can stay deployed harmlessly (the legacy Strands path is preserved by gating on `finalize_callback_url` presence).

**Patterns to follow:**

- `feedback_watch_post_merge_deploy_run` memory — watch `gh run list --branch main` after each merge.
- `feedback_handrolled_migrations_apply_to_dev` memory — apply via psql before deploy.

**Test scenarios:**

- Manual: re-run Eric's earlier crm-dashboard test on dev post-deploy. Confirm: no "5-min stall" timeline entries; final response renders normally; chat-agent-invoke CloudWatch `REPORT` line shows Duration < 10s.
- Manual: open a thread with a fast prompt (< 30s). Confirm finalize fires + message renders.
- Manual: deliberately trigger a guardrail block. Confirm finalize fires with `status: "completed"` + `guardrail_block.blocked = true`; user sees the policy-block message.

**Verification:**

- Eric runs a fresh thread on dev; the previous 4-8 min stall pattern is gone.
- CloudWatch dashboards / queries still surface assistant-message insertions (via the new log prefix).
- No stuck-in-dispatched turns on dev after 1 hour of normal usage.

## Scope Boundaries

- In scope: the user-message → assistant-message turn flow, end-to-end.
- Out of scope: background wakeup paths (scheduled jobs, webhook triggers, routine-task-python). They have their own dispatch story and aren't experiencing the same pain.
- Out of scope: Step Functions, Activity Tasks, or any new orchestration service.
- Out of scope: "manually re-finalize this thread" admin tooling. The endpoint exists; the UI to invoke it is a follow-up if/when needed.

### Deferred to Follow-Up Work

- **Reconciler sweep for stuck `dispatched` turns**: if Strands crashes mid-turn before posting finalize, the turn stays in `dispatched` state forever. EventBridge schedule + sweep handler that marks `dispatched > 1 hour` as failed and inserts an error message. Not urgent because Strands crashes are rare and the existing AppSync chunk stream gives users a visible "thinking" indicator that goes stale, prompting refresh.
- **Migrate wake-up dispatch paths to the same callback pattern**: wake-ups (scheduled-job triggers, future routine/webhook triggers) currently dispatch via a different code path. If those also start hitting Lambda timeouts, port the callback pattern over. Out of scope here.
- **CloudWatch dashboard query updates**: the `[chat-agent-invoke] Inserted assistant message` log prefix moves to `[chat-agent-finalize] Inserted assistant message`. Any dashboards/alerts keying on the literal prefix need updating. Inventory + update is a small follow-up; the search-by-substring path keeps working immediately.

## Risks & Mitigations

| Risk                                                                                   | Mitigation                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strands posts finalize twice (transient network failure → retry)                       | `thread_turn_id` idempotency key + `finalized_at` timestamp; second POST returns 200 `{idempotent: true}` with no side effects.                                                                                     |
| `eval-runner` path silently breaks                                                     | The `finalize_callback_url` field is opt-in; eval-runner never supplies it, so Strands' legacy Lambda-response path is preserved unchanged. Direct test on eval-runner during U2 verification.                      |
| `chat-agent-finalize` Lambda missing IAM permissions for cost-events / messages tables | Reuse the existing graphql/lambda IAM role (`aws_iam_role.lambda` in the lambda-api module). The role already has these permissions; the new handler just needs to be added to the function set under it.           |
| Database migration drift                                                               | Hand-rolled `.sql` with `-- creates-column:` marker + apply to dev via psql before merge + Migration Drift Precheck CI gate runs on PR. Per `project_migration_precheck_ci_gate` memory.                            |
| Cost-recording or memory-retain regression                                             | Test scenarios in U1 explicitly characterize the order and side-effects. Extracted helpers are pure functions, testable without the Lambda harness. Manual verification on dev confirms the chain fires end-to-end. |
| Strands container crashes pre-POST → turn stuck in `dispatched`                        | Documented as deferred follow-up (reconciler sweep). Same observable failure mode as today's "Lambda exhausted all retries"; the new architecture isn't worse on this axis.                                         |
| chat-agent-invoke setup itself fails (agent-not-found, sandbox preflight, etc.)        | Pre-dispatch error paths stay in chat-invoke and insert error messages inline as today. `maximum_retry_attempts = 0` ensures the error message is the user's only signal (no AWS retry storm).                      |

## System-Wide Impact

- **chat-agent-invoke Lambda**: timeout 300s → 60s, retries 2 → 0, +DLQ. Net cost drops dramatically (no more 5-min runs waiting for AgentCore).
- **New chat-agent-finalize Lambda**: small, fast (~5-10s per invocation), short timeout (60s), DLQ. Net cost is roughly equal to the post-AgentCore portion of today's chat-invoke runs.
- **Strands runtime**: one new HTTP POST per turn at end-of-turn. Negligible latency impact (~50-200ms).
- **Database schema**: one new column on `thread_turns` (`finalized_at timestamptz`). No new tables.
- **Logs**: assistant-message-insert log prefix changes from `[chat-agent-invoke]` to `[chat-agent-finalize]`. Substring searches still work; literal-prefix dashboards may need updating (deferred).
- **GraphQL schema**: no changes.
- **AppSync subscription stream**: no changes (the chunk-streaming behavior during the turn is unchanged).
- **End-user UX**: unchanged streaming behavior, but no more multi-retry "5 min stall" entries; long turns succeed without surfacing failure.

## Verification

End-to-end after all units ship + deploy:

1. `pnpm --filter @thinkwork/api test` — full suite green.
2. `pnpm --filter @thinkwork/api run typecheck` — clean.
3. `uv run pytest packages/agentcore-strands/agent-container/test_finalize_callback.py` — green.
4. `pnpm --filter @thinkwork/agentcore-strands ...` (whatever the Strands runtime's local pre-deploy check is) — green.
5. Manual: deploy to dev; send the crm-dashboard prompt on a fresh thread; observe CloudWatch:
   - `chat-agent-invoke` REPORT line: `Duration < 10s`.
   - `chat-agent-finalize` invocation occurs after Strands turn completes; REPORT line shows the actual finalize work (~1-5s).
   - Assistant message renders in the UI as soon as finalize completes; no 5-min stalls in the timeline.
6. Manual: send a very short prompt (< 5s turn). Confirm the full flow works for fast turns too.
7. Manual: trigger a guardrail block. Confirm finalize handles the guardrail-block path correctly.
