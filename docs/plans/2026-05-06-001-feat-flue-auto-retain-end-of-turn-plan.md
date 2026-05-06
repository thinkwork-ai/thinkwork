---
title: "feat: Flue auto-retain end-of-turn transcripts"
type: feat
status: active
date: 2026-05-06
---

# feat: Flue auto-retain end-of-turn transcripts

## Summary

Add a fire-and-forget end-of-turn auto-retain path to the Flue runtime that mirrors Strands' `api_memory_client.py`. After each turn completes, Flue invokes the existing `memory-retain` Lambda (`thinkwork-${stage}-api-memory-retain`, already wired via `MEMORY_RETAIN_FN_NAME` env var and IAM allow-list) with the conversation transcript, so Hindsight's reflection layer can extract durable facts. Closes the write-side parity gap surfaced today: PR #834 just enabled `hindsight_recall` on Flue, but Marco can't write to memory because Flue has no equivalent of Strands' `_fire_retain_full_thread` call site.

---

## Problem Frame

Today the user said "my favorite color is teal" in CHAT-257 (Flue runtime). Marco replied "Noted! I'll keep that in mind", then a fresh thread (CHAT-258) asked "What's my favorite color?" — Marco replied "I don't have that information on file." Live verification showed zero memory tool calls in either thread on the write side. PR #834 (just merged) wired `HINDSIGHT_ENDPOINT` into Flue's Lambda env, so `hindsight_recall` + `hindsight_reflect` now load and fire (verified in CHAT-260: both tools called, Strands-written history surfaced). But Flue still has no auto-retain — Strands' `packages/agentcore-strands/agent-container/container-sources/api_memory_client.py` and `server.py:1782-1842` retain transcripts via fire-and-forget `memory-retain` Lambda invokes; the rename PR #785 (`agentcore-pi → agentcore-flue`) didn't carry over the equivalent TS path.

Infrastructure is fully prepped:
- `MEMORY_RETAIN_FN_NAME=thinkwork-${stage}-api-memory-retain` env var wired (`terraform/modules/app/agentcore-flue/main.tf:279`).
- IAM role grants `lambda:InvokeFunction` against the memory-retain ARN (`terraform/modules/app/agentcore-flue/main.tf:194` — `Sid = "MemoryRetainInvoke"`, comment: "Async-invoke the memory-retain Lambda after every chat turn so the API's normalized memory layer can run the active engine's retainTurn() path"). The IAM was deliberately set up for this; only the TS code is missing.
- Marco's invocation payload from `packages/api/src/handlers/chat-agent-invoke.ts:336-53` already carries `tenant_id`, `user_id`, `thread_id`, `use_memory: true`. Identity scope is available at the retain call site.

A reference implementation exists locally at `packages/agentcore-pi/agent-container/src/runtime/tools/hindsight.ts:151-266` (predates the rename, never merged to main). Strands' `api_memory_client.py:40-93` is the Python source-of-truth contract.

---

## Requirements

- R1. After every Flue agent turn completes, fire a fire-and-forget `memory-retain` Lambda invoke with `{tenantId, userId, threadId, transcript}`.
- R2. Honor `payload.use_memory === false` as an explicit opt-out — zero retain attempts when set.
- R3. Snapshot env (`MEMORY_RETAIN_FN_NAME`, `awsRegion`) at handler entry per `feedback_completion_callback_snapshot_pattern`. Never re-read `process.env` post-turn.
- R4. Build the transcript identically to Strands' `_build_full_thread_transcript` (server.py:1782-1809) — history filtered to `role in {user, assistant}` with non-empty string content, then append `{user, message}` and `{assistant, response}` if non-empty. The Lambda does the longest-suffix-prefix merge against the canonical DB transcript.
- R5. Retain failure must never block, throw from, or alter the user-facing response. Log via `console.warn` with a `[agentcore-flue]` prefix.
- R6. Pass the full incoming payload (not a hand-curated subset dict) into the request builder — every payload field needed for the retain call must be visible to a single helper, so adding a new field cannot silently get dropped (per `apply-invocation-env-field-passthrough-2026-04-24.md`).
- R7. Use `InvocationType=Event` for the Lambda invoke. Verify the memory-retain Lambda's async retry config sets `MaximumRetryAttempts=0` (or that the handler is idempotent on `(tenantId, threadId)` writes) — Lambda Event invokes default to 2 retries, which can multi-write transcripts.
- R8. Test the inert→live seam empirically — a body-swap safety integration test must assert `LambdaClient.send` is invoked with `InvocationType: "Event"` against `MEMORY_RETAIN_FN_NAME`, not just that the wrapper returns OK.

---

## Scope Boundaries

- No explicit per-fact retain agent tool. Strands' `make_hindsight_tools` returns `retain` + `recall` + `reflect`; this plan only ports the auto-retain transcript path. Per-fact retain stays a separate follow-up if observed gaps demand it.
- No daily-kind retain (`{kind: "daily", date, content}`). Strands' `api_memory_client.py:97-138` defines `retain_daily` but it has no caller in `server.py` — it's dead in Strands today. Adding a daily-rollover hook is a coordinated change to both runtimes, out of scope here.
- No direct Hindsight HTTP write. All writes go through the API's normalized memory layer (`memory-retain` Lambda routes engine-aware), per the canonical Terraform comment at `agentcore-runtime/main.tf:55`.
- No changes to Strands. Strands' direct Hindsight retain remains the legacy path until a separate migration consolidates both runtimes onto the Lambda.
- No changes to chat-agent-invoke. Marco's payload already carries the required identity fields.

### Deferred to Follow-Up Work

- Per-fact `retain` agent tool for explicit "remember this" semantics: future plan if auto-retain proves insufficient.
- Daily-rollover retain on both runtimes simultaneously: separate plan covering Strands `server.py` + Flue parity.
- Strands migration off direct Hindsight HTTP retain onto the Lambda path: separate plan; not blocking.
- Empirical doc capture of Lambda Web Adapter in-flight Promise lifecycle in `docs/solutions/runtime-errors/` after this lands — the institutional record has no entry on whether LWA waits for awaited Promises before exit. We will resolve this in U2 by awaiting the InvokeCommand before HTTP response, but the doc capture is a follow-up.

---

## Context & Research

### Relevant Code and Patterns

- **Reference implementation (TS, local Codex branch only — never merged):** `packages/agentcore-pi/agent-container/src/runtime/tools/hindsight.ts:151-266` — `retainFullThread` + `buildRetainTranscript` + cached `LambdaClient` + `__setLambdaClientForTest` seam. Adapt to Flue's identity shape.
- **Reference call site:** `packages/agentcore-pi/agent-container/src/runtime/pi-loop.ts:220-242` — `void retainFullThread(...).then(success, err)` fire-and-forget pattern. Flue's call site differs because Flue's `server.ts:546-558` has different agent-loop structure.
- **Source-of-truth Python:** `packages/agentcore-strands/agent-container/container-sources/api_memory_client.py:40-93` (retain_conversation), `server.py:1782-1842` (helpers), `server.py:2253-2281` (call site).
- **Lambda contract:** `packages/api/src/handlers/memory-retain.ts` — required `tenantId` + `userId|agentId`; conversation branch needs `threadId` + `transcript`; canonical transcript merge via `mergeTranscriptSuffix` (lines 279-305).
- **Flue end-of-turn:** `packages/agentcore-flue/agent-container/src/server.ts:546-558` — `await agent.prompt(args.message)` → assistant message extraction → return `{content, usage, modelId, toolsCalled, toolInvocations}`. Retain hook lands between `agent.prompt` returning and the return.
- **Flue identity scope:** `packages/agentcore-flue/agent-container/src/handler-context.ts:26-34` — `InvocationIdentity { tenantId, userId, agentId, threadId }` already validated at handler entry.
- **Flue env snapshot:** `RuntimeEnvSnapshot` (handler-context.ts:126) already captures process.env at entry; extend to include `memoryRetainFnName`.
- **Flue runtime patterns:** `src/runtime/bootstrap-workspace.ts` (per-call AWS SDK client construction for S3, accepts `s3ClientFactory` injection), `src/runtime/system-prompt.ts` (workspace file loading style).
- **Flue tests:** `packages/agentcore-flue/agent-container/tests/` — uses vitest + lightweight `vi.spyOn` for mocking. `aws-sdk-client-mock` is in devDependencies as a fallback for full LambdaClient mock.
- **Marco's payload:** `packages/api/src/handlers/chat-agent-invoke.ts:336-53` already carries `tenant_id`, `user_id`, `thread_id`, `use_memory: true`.

### Institutional Learnings

- `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md` — The exact shape this port replays. Strands had `THINKWORK_API_URL` and `API_AUTH_SECRET` shadowed mid-turn. Snapshot env at entry, thread it forward as parameters, never re-read `process.env` post-turn.
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — Inert ship + live swap. Single-PR scope here is fine, but the body-swap safety test pattern is mandatory: assert downstream effects (LambdaClient.send invoked with the right shape), not just return shape.
- `docs/solutions/patterns/apply-invocation-env-field-passthrough-2026-04-24.md` — Subset-dict anti-pattern. Pass full payload to a `buildMemoryRetainRequest(payload, snapshot)` helper; unit-test that every declared payload field reaches the request body.
- `docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md` (+ auto-memory `project_async_retry_idempotency_lessons`) — AWS Lambda Event invokes default to 2 retries. Verify memory-retain Lambda's `aws_lambda_function_event_invoke_config` sets `MaximumRetryAttempts=0` OR that the handler is idempotent. April-19 bootstrap double-ingested journals after a 15-minute timeout retry.
- Auto-memory `feedback_vitest_env_capture_timing` — Module-load `const X = process.env.Y` locks in `""` before `beforeEach` fires. Wrap env reads in a function or accept an `envOverrides` parameter (Pi reference does the latter).
- Auto-memory `feedback_avoid_fire_and_forget_lambda_invokes` — User-driven create/update must use `RequestResponse` and surface errors. **This is NOT user-driven** — it's end-of-turn background persistence. `Event` is correct here, paired with retries=0.
- `docs/solutions/architecture-patterns/flue-runtime-launch-2026-05-04.md` — Yesterday's Flue launch runbook explicitly flagged the env-shadowing risk for Flue.

### External References

- AWS Lambda `InvocationType=Event` semantics — fire-and-forget; Lambda data plane returns 202 fast; default retry policy is 2 attempts unless overridden via `aws_lambda_function_event_invoke_config`.

---

## Key Technical Decisions

- **Single-PR delivery (not the inert→live two-PR variant).** The feature is small, the IAM and env are already in place, and we're closing a known gap with a live reference implementation. The body-swap safety test (R8) provides the regression guard the two-PR variant would otherwise enforce.
- **Module location: `packages/agentcore-flue/agent-container/src/runtime/tools/memory-retain-client.ts`.** Mirrors Pi's path. The `runtime/tools/` subdirectory is consistent with `run-skill.ts` and `workspace-skills.ts` already in that folder.
- **Identity shape: pass `InvocationIdentity`, not raw payload.** Flue already validates and structures identity at handler entry (handler-context.ts:65-86). The retain client takes `identity: InvocationIdentity` + `payload: PiInvocationPayload-shaped` rather than re-extracting from a loose payload object. Simpler, type-safe, and avoids the subset-dict drift problem at the entry seam.
- **Env passing: `RuntimeEnvSnapshot` parameter, not `process.env` reads.** Extend `RuntimeEnvSnapshot` (handler-context.ts:126-160) with `memoryRetainFnName: string`. Read in `loadRuntimeEnv` at entry. Pass to retain client as part of `env`. Tests inject `envOverrides` directly. Mirrors Pi's `envOverrides?: Record<string, string | undefined>` parameter for test ergonomics.
- **Await the InvokeCommand before HTTP response.** Pi's `pi-loop.ts:230` uses unawaited `void retainFullThread(...).then(...)` because Pi's loop doesn't return until response is fully assembled. For Flue, since LWA in-flight Promise lifecycle is undocumented in the institutional corpus and the Event invoke returns very fast (single 202 to Lambda data plane, ~10–30ms typical), `await` it before the return at server.ts:558. Trades ~tens of ms for guaranteed delivery; eliminates the LWA-cuts-us-off failure mode. Document in U2 verification.
- **Cached LambdaClient + static test seam.** `let _lambdaClient: LambdaClient | null` module-private; `getLambdaClient(region)` lazy-init; `__setLambdaClientForTest(client)` for tests. Mirrors Pi reference and Flue's existing AWS client patterns. Region is process-wide (Lambda runs in one region) so caching is safe.
- **Build helper takes full payload, not curated subset.** `buildMemoryRetainRequest(payload, identity, snapshot)` — payload is the source-of-truth; helper extracts what it needs. Unit-test asserts every declared payload field is reflected. Adds a new payload field → existing test fails until builder is updated.

---

## Open Questions

### Resolved During Planning

- **Where does the retain hook fire in Flue?** Resolved: `server.ts:558`, between `agent.prompt(args.message)` returning and the return statement that builds the response. Pi fired from `pi-loop.ts:220-242` (its outer entry); Flue's outer entry is the `executeAgentTurn`-equivalent function in `server.ts` around line 546-558.
- **Does Flue identity carry user_id/thread_id?** Resolved: yes — `InvocationIdentity` already validates and rejects 400 if any required field is missing (`handler-context.ts:65-86`). Marco's payload from `chat-agent-invoke.ts:336-53` includes them.
- **Does Flue's IAM grant InvokeFunction on memory-retain?** Resolved: yes — `terraform/modules/app/agentcore-flue/main.tf:194` `Sid = "MemoryRetainInvoke"`. No Terraform changes needed.
- **Does Flue's env carry MEMORY_RETAIN_FN_NAME?** Resolved: yes — wired at `terraform/modules/app/agentcore-flue/main.tf:279`.
- **Should we await the InvokeCommand or fire it unawaited?** Resolved: await it. Lambda Web Adapter's in-flight Promise lifecycle is undocumented in institutional corpus; Event invoke is fast (~tens of ms); awaiting eliminates the LWA-cuts-us-off failure mode. Latency cost is negligible vs the 9–12s typical Bedrock turn.

### Deferred to Implementation

- **Exact shape of `RuntimeEnvSnapshot` extension.** Whether to add `memoryRetainFnName` directly or via a nested `memory: { retainFnName }` is a code-style call. Implementer picks.
- **Whether `agentId` should also be passed through.** The memory-retain Lambda accepts it as a fallback for `userId` resolution (handler.ts:75-82). Marco's payload doesn't carry it (chat-agent-invoke.ts:336-53 sends `user_id` directly). Probably skip; verify by reading the memory-retain test fixtures.
- **Logging cardinality.** Pi reference logs every failure but not every success. For initial rollout, also log success at debug-level so we can observe retain rate in CloudWatch Insights for a few days, then dial back. Implementer's call.

---

## Implementation Units

- U1. **Port memory-retain client to TypeScript**

**Goal:** Create the TS module that mirrors Strands' `api_memory_client.py` retain_conversation, adapted to Flue's identity + env shape.

**Requirements:** R1, R2, R3, R4, R5, R6.

**Dependencies:** None.

**Files:**
- Create: `packages/agentcore-flue/agent-container/src/runtime/tools/memory-retain-client.ts`
- Create: `packages/agentcore-flue/agent-container/tests/memory-retain-client.test.ts`
- Modify: `packages/agentcore-flue/agent-container/src/handler-context.ts` (extend `RuntimeEnvSnapshot` with `memoryRetainFnName`; populate from `MEMORY_RETAIN_FN_NAME` in `loadRuntimeEnv`)

**Approach:**
- Port `retainFullThread` and `buildRetainTranscript` from `packages/agentcore-pi/agent-container/src/runtime/tools/hindsight.ts:151-266` (local Codex-branch reference). Adapt:
  - Take `identity: InvocationIdentity` + `payload: { use_memory?: boolean; messages_history?: unknown[]; message?: string }` rather than the loose `PiInvocationPayload`.
  - Take `env: RuntimeEnvSnapshot` (which now carries `memoryRetainFnName` + `awsRegion`).
  - Keep the `envOverrides?: Record<string, string | undefined>` test-injection parameter from the Pi reference for vitest ergonomics.
- Export `buildMemoryRetainRequest(payload, identity, snapshot)` as a separately testable pure helper. The unit test asserts the request envelope matches the memory-retain Lambda's contract (`{tenantId, userId, threadId, transcript}`) for every declared field — this is the anti-subset-dict guard.
- Cached `LambdaClient` + `__setLambdaClientForTest` test seam — copy verbatim from Pi.
- Snapshot all env at function entry (top of `retainConversation`), never read `process.env` after that point. Vitest tests pass `envOverrides` directly.
- Returns `Promise<{ retained: boolean; error?: string }>`. Never throws.
- Honors `payload.use_memory === false` as a fast return `{ retained: false }`.
- Validates `tenantId`, `userId`, `threadId` non-empty before any AWS call; missing → fast return.
- Empty transcript → fast return (no point invoking with no content).

**Patterns to follow:**
- `packages/agentcore-pi/agent-container/src/runtime/tools/hindsight.ts:151-266` — structural template.
- `packages/agentcore-flue/agent-container/src/runtime/bootstrap-workspace.ts` — Flue-specific AWS SDK client / factory injection style.
- `packages/agentcore-flue/agent-container/src/handler-context.ts:126-160` — `RuntimeEnvSnapshot` shape; extend cleanly.

**Test scenarios:**
- Happy path: full payload (use_memory=true, history of 5 user/assistant messages, message + assistant content) → `LambdaClient.send` invoked once with `InvocationType: "Event"`, `FunctionName === snapshot.memoryRetainFnName`, payload JSON matches `{tenantId, userId, threadId, transcript: [...] }` shape; returns `{retained: true}`.
- Edge case: `use_memory: false` → no LambdaClient call, returns `{retained: false}`.
- Edge case: missing `tenantId` → no LambdaClient call, returns `{retained: false}`.
- Edge case: missing `userId` → no LambdaClient call, returns `{retained: false}`.
- Edge case: missing `threadId` → no LambdaClient call, returns `{retained: false}`.
- Edge case: empty `MEMORY_RETAIN_FN_NAME` (env unset) → no LambdaClient call, returns `{retained: false}`.
- Edge case: empty transcript (no history, empty message, empty assistant content) → no LambdaClient call, returns `{retained: false}`.
- Edge case: history contains entries with non-string content or unknown roles → filtered out per the Strands rule, only valid pairs forwarded.
- Error path: `LambdaClient.send` throws → returns `{retained: false, error: "<message>"}`, never throws.
- Field-passthrough guard: a payload carrying every declared field calls the helper; assert every field is reflected in the JSON-decoded `Payload` body. Adding a new field to the payload type without updating the helper must fail this test.
- Env-snapshot timing: with `envOverrides: { MEMORY_RETAIN_FN_NAME: "fn-from-override" }`, the InvokeCommand uses `fn-from-override` even if `process.env.MEMORY_RETAIN_FN_NAME` is later set to a different value mid-test (regression guard against module-load env capture).

**Verification:**
- Tests pass under `pnpm --filter @thinkwork/agentcore-flue test` (or the package's test script equivalent).
- New module exports `retainConversation`, `buildMemoryRetainRequest`, `buildRetainTranscript`, `__setLambdaClientForTest`.
- `pnpm typecheck` clean — `RuntimeEnvSnapshot` extension carries through to all consumers.

---

- U2. **Wire into Flue end-of-turn**

**Goal:** Invoke `retainConversation` after each agent turn in `server.ts`, with the `await` semantics decided in Key Technical Decisions, plus a body-swap safety integration test.

**Requirements:** R1, R5, R7, R8.

**Dependencies:** U1.

**Files:**
- Modify: `packages/agentcore-flue/agent-container/src/server.ts` (add retain invocation between `agent.prompt(...)` returning and the response return at ~line 546-558)
- Modify: `packages/agentcore-flue/agent-container/tests/server.test.ts` (or the file that covers the agent-turn handler — add an integration test asserting LambdaClient.send is called with the right envelope)

**Approach:**
- After `agent.prompt(args.message)` resolves and the assistant message is extracted, build the transcript and call `retainConversation({ identity, payload, env, assistantContent })` — `await` the call before `return { content, usage, ... }`.
- Wrap in `try/catch` that logs but never re-throws — defensive, even though the client itself doesn't throw, in case future refactors regress the contract.
- Log success at info level once per turn (visible in CloudWatch for a few days post-launch); failure at warn level. Format: `[agentcore-flue] retain ok thread=<short> user=<short>` / `[agentcore-flue] retain failed (non-blocking): <error>`.
- Body-swap safety integration test: stub `LambdaClient.send` via `__setLambdaClientForTest`, drive a full turn through the test seam in server.test.ts (mocking the agent loop), assert `send` was invoked with `InvocationType: "Event"`, `FunctionName: <expected>`, and the payload JSON contains the right `{tenantId, userId, threadId}`. The assertion must check the actual `send` call shape, not just the wrapper return — this is the load-bearing regression guard against future "always returns OK" stubs.

**Execution note:** Test-first for the call-site test. Write the failing integration test in server.test.ts that asserts `LambdaClient.send` is invoked, then add the call site in server.ts to make it pass.

**Patterns to follow:**
- `packages/agentcore-pi/agent-container/src/runtime/pi-loop.ts:220-242` — call-site shape (adapt to await + Flue's server.ts location).
- `packages/agentcore-flue/agent-container/src/server.ts` existing patterns for structured logging and try/catch around agent.prompt.

**Test scenarios:**
- Integration: a full turn (mock `agent.prompt` to resolve with a known assistant message, valid identity in payload) → assert `LambdaClient.send` called exactly once with `InvocationType: "Event"`, `FunctionName === MEMORY_RETAIN_FN_NAME`, payload JSON deserializes to `{tenantId, userId, threadId, transcript: [...with the user msg + assistant response...]}`.
- Integration: `use_memory: false` in payload → assert `LambdaClient.send` is NOT called; agent.prompt result still returns successfully.
- Error path: `LambdaClient.send` rejects → user-facing response still returns successfully (status 200, content matches assistant message); a `console.warn` is emitted with the failure detail.
- Error path: `agent.prompt` itself throws → no retain attempt is made; existing error handling in server.ts is unchanged.

**Verification:**
- All existing server.test.ts tests pass unchanged.
- New body-swap integration test passes.
- A real dev-stage chat turn through admin shows a CloudWatch log line `[agentcore-flue] retain ok thread=<...> user=<...>` from the `/thinkwork/dev/agentcore-flue` log group. (Note: that log group has been suspiciously empty in past observation — see U3 if it stays empty post-deploy, that's a separate logging issue unrelated to the retain wiring.)

---

- U3. **Verify async retry safety on memory-retain Lambda**

**Goal:** Confirm the receiving Lambda has `MaximumRetryAttempts=0` configured, OR that its handler is idempotent on `(tenantId, threadId)`. If neither holds, add the Terraform config in this PR.

**Requirements:** R7.

**Dependencies:** None (independent verification, can run in parallel with U1+U2).

**Files:**
- Read: `packages/api/src/handlers/memory-retain.ts` — check whether the handler dedupes on a stable key.
- Read: `terraform/modules/app/lambda-api/handlers.tf` (or wherever the memory-retain Lambda is declared) — check for `aws_lambda_function_event_invoke_config` with `maximum_retry_attempts = 0`.
- Modify (only if missing): `terraform/modules/app/lambda-api/handlers.tf` (or sibling) — add the event-invoke config with retries=0 and ideally a DLQ.

**Approach:**
- If `MaximumRetryAttempts=0` is already configured → no change; document in plan verification log and move on.
- If absent and the handler is idempotent (e.g., uses `INSERT ... ON CONFLICT DO NOTHING` or CAS) → document the idempotency basis; still add `MaximumRetryAttempts=0` defensively because Lambda's default behavior can mutate even idempotent operations through cost.
- If absent and not idempotent → add `aws_lambda_function_event_invoke_config` with `maximum_retry_attempts = 0` and `destination_config.on_failure` pointing to an existing DLQ (use the agentcore-runtime async DLQ as parity).

**Test scenarios:**
- Test expectation: none — verification + Terraform-only config. Drift coverage is via `pnpm db:migrate-manual` for SQL drift; for Terraform itself, `terraform validate` is the gate.

**Verification:**
- `terraform validate` passes.
- A Terraform plan against the dev stage shows either no diff (if nothing was added) or only the new event-invoke config + DLQ.
- Document in the PR description what was found and whether config was added.

---

## System-Wide Impact

- **Interaction graph:** Flue Lambda → memory-retain Lambda (Event invoke). New edge in the runtime topology, but IAM + env already permit it. memory-retain → MemoryAdapter (via `getMemoryServices()`) → Hindsight HTTP. Flue → Hindsight is now fully bidirectional (recall reads on PR #834, retain writes via this plan).
- **Error propagation:** Retain failures are non-blocking — `console.warn` only, never propagated. User-visible chat responses are unaffected. CloudWatch alarms on memory-retain Lambda errors (separate observability concern, not in scope) would catch persistent failures.
- **State lifecycle risks:** AWS Lambda Event invokes default to 2 retries — addressed by R7 / U3. The memory-retain Lambda's transcript-merge path (longest-suffix-prefix overlap, handlers/memory-retain.ts:279-305) is designed to handle re-delivery without duplication, but explicit `MaximumRetryAttempts=0` is the cleaner guarantee.
- **API surface parity:** Strands' `_fire_retain_full_thread` (server.py:1812-1842) and Flue's new `retainConversation` should produce semantically equivalent payloads against the same Lambda. The transcript-build helper is line-for-line equivalent to Strands' `_build_full_thread_transcript`. Drift between runtimes would silently fork retain history; the unit tests in U1 are the parity guard.
- **Integration coverage:** U2's body-swap safety test pins the contract that future refactors of `retainConversation` (e.g., a hypothetical "always returns OK to keep tests green" stub) cannot regress without failing the test. The test asserts `send` was called with the right `InvocationType` and `FunctionName` — not just that the wrapper returned OK.
- **Unchanged invariants:** chat-agent-invoke's payload shape; the memory-retain Lambda's handler contract; Strands' direct retain path; Flue's hindsight_recall + hindsight_reflect tools shipped in PR #834.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Lambda Web Adapter exits before unawaited InvokeCommand queues | Await the InvokeCommand before HTTP response (Key Technical Decisions). Latency cost ~tens of ms; eliminates the failure mode. |
| memory-retain Lambda Event retries cause transcript double-write | U3 verifies + adds `MaximumRetryAttempts=0`. Even with retries, the Lambda's longest-suffix-prefix merge dedupes content. |
| Env shadowing post-turn (per `feedback_completion_callback_snapshot_pattern`) | Snapshot env at handler entry into `RuntimeEnvSnapshot`, pass forward as parameter. Never read `process.env` post-turn. R3. |
| Module-load env capture in vitest (per `feedback_vitest_env_capture_timing`) | All env reads are inside the function via `envOverrides ?? process.env`. Tests inject `envOverrides` directly. |
| Subset-dict drop of new payload fields | `buildMemoryRetainRequest` takes the full payload; field-passthrough unit test in U1 fails when new fields are added without updating the helper. |
| Body-swap regression where retain wrapper silently no-ops in production | U2's integration test asserts `LambdaClient.send` is invoked with the correct envelope, not just that the wrapper returns OK. |
| Flue CloudWatch log group still empty after this lands (logging infra issue) | Out of scope for this PR; flag separately. The retain functionality works regardless of whether logs surface — verified via the user-facing test (recall in a new thread surfaces what was just said). |

---

## Documentation / Operational Notes

- **PR description must include:** The current state (recall works, retain doesn't), what this PR adds, the verification plan (a real chat turn that tells Marco something new, then asks a fresh thread to recall it).
- **No runbook needed.** The retain path is invisible to operators; failures show only in CloudWatch and never user-visible.
- **Post-merge verification:** Open admin chat, tell Marco a memorable fact (e.g., "remember that I prefer rooibos tea"), close the thread, open a new thread and ask "what kind of tea do I like?" — Marco's `hindsight_recall` should surface "rooibos" within a turn or two (Hindsight's reflection layer is asynchronous; allow up to a minute for fact extraction to complete).
- **Follow-up doc capture:** After this lands, write `docs/solutions/runtime-errors/lambda-web-adapter-in-flight-promise-lifecycle-2026-05-06.md` documenting the awaited-vs-unawaited decision and the empirical observation. The institutional corpus has no entry on this today.

---

## Sources & References

- Reference TS implementation (Codex-branch local, never merged): `packages/agentcore-pi/agent-container/src/runtime/tools/hindsight.ts:151-266`
- Source-of-truth Python: `packages/agentcore-strands/agent-container/container-sources/api_memory_client.py:40-93`, `server.py:1782-1842`, `server.py:2253-2281`
- Receiving Lambda contract: `packages/api/src/handlers/memory-retain.ts`
- Flue Lambda Terraform: `terraform/modules/app/agentcore-flue/main.tf` (env at :279, IAM `MemoryRetainInvoke` at :194)
- Marco's invocation payload: `packages/api/src/handlers/chat-agent-invoke.ts:336-53`
- Flue end-of-turn hook target: `packages/agentcore-flue/agent-container/src/server.ts:546-558`
- Flue identity validation: `packages/agentcore-flue/agent-container/src/handler-context.ts:26-86`
- PR #834 (just merged, this PR's prerequisite): wires `HINDSIGHT_ENDPOINT` into Flue Lambda env
- Institutional learnings:
  - `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md`
  - `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md`
  - `docs/solutions/patterns/apply-invocation-env-field-passthrough-2026-04-24.md`
  - `docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md`
  - `docs/solutions/architecture-patterns/flue-runtime-launch-2026-05-04.md`
