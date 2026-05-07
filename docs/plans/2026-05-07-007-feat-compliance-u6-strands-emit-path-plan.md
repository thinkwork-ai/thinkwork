---
title: "feat: Compliance U6 — Strands runtime emit path (POST /api/compliance/events + Python client)"
type: feat
status: active
date: 2026-05-07
origin: docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md
---

# feat: Compliance U6 — Strands runtime emit path (POST /api/compliance/events + Python client)

## Summary

Stand up the cross-runtime audit emit path so the Python Strands runtime can write audit events to the same `compliance.audit_outbox` U5's TypeScript call sites populate. New narrow REST endpoint `POST /api/compliance/events` on its own Lambda (`compliance-events`), authenticated by `API_AUTH_SECRET`, with a cross-tenant guard on `actorUserId`/`tenantId` and idempotency via a client-supplied `event_id` (UUIDv7). Python client at `packages/agentcore-strands/agent-container/container-sources/compliance_client.py` mirrors the existing `_log_invocation` urllib pattern (3s timeout, env-snapshotted credentials, exception-swallow telemetry semantics). U6 ships the **infrastructure only** — handler + client + Terraform wiring + tests + boot-time client instantiation. **No live emit call sites in U6**: the only obvious candidate (Strands AGENTS.md edits) goes through `/api/workspaces/files`, which already emits `agent.skills_changed` via U5's TypeScript path; emitting from Python on top would create duplicate audit rows. Selection of the first non-duplicate Strands call site (skill-run lifecycle, MCP tool wrapper, or new event types) is explicitly deferred to a Phase 4 brainstorm.

---

## Problem Frame

U5 closed the loop for TypeScript-runtime audit events: GraphQL resolvers, Lambda handlers, and workspace-files emit through the in-process `emitAuditEvent` helper. The Strands Python runtime cannot use that helper — it runs in a separate AgentCore container with no DB connection of its own, no Drizzle, no shared in-process state with the api Lambda. Without a cross-runtime emit path, every action the agent runtime takes (skill-marker writes, tool executions, capability changes) goes unaudited, leaving a structural gap in the SOC2 Type 1 evidence story.

The path needs to be narrow, service-authenticated (no user session at the agent runtime), idempotent under retries, and telemetry-tier — Strands cannot block agent execution waiting on a compliance write.

---

## Requirements

Carried forward from origin master plan U6 (R6, R10).

- R5. Append-only audit-event log with the canonical envelope. *(satisfied at write-time by U3 helper; U6 is another caller.)*
- R6. Two-tier write semantics. **Strands emits are telemetry-tier by definition** — the originating action (the agent's tool call, file write, etc.) has already happened before the emit fires. Audit failure cannot un-execute an agent action.
- R10. Cross-runtime emit path so Strands can contribute to the SOC2 Type 1 starter slate.
- R11. Audit data lives in dedicated `compliance` Postgres schema; the new endpoint writes through the same `compliance_writer` role + `audit_outbox` table that U5 uses.
- R12. Per-tenant hash chain integrity preserved — every emit row from this endpoint must carry a server-validated `tenant_id` (cross-tenant guard against caller-supplied IDs).
- R15. Redaction-before-write — handled by U3 helper; U6 just calls it.

**Origin actors:** A1 Tenant admin (consumes resulting audit log), A3 Platform services (Strands runtime is the new caller).
**Origin flows:** F5 Platform service writes an audit event.
**Origin acceptance examples:** AE5 (cross-runtime audit roundtrip).

---

## Scope Boundaries

- S3 anchor bucket and anchor Lambda — U7 + U8a/b.
- Standalone audit-verifier CLI — U9.
- Admin "Compliance" pages and GraphQL read resolvers — U10.
- Async export job and admin Exports page — U11.
- Migrating httpx-based async emits — defer; stdlib `urllib.request` for U6 to keep parity with existing `_log_invocation` template.
- Per-tool-execution / per-LLM-call / per-router-decision audit emits from Strands — Phase 4 brainstorm. Each is its own product question (cardinality, sampling, cost), not a wire-up question.

### Deferred to Follow-Up Work

- Migrating the existing `_log_invocation` sandbox-audit endpoint (`/api/sandbox/invocations`) to use the same compliance emit path. The two surfaces serve different purposes (sandbox quota observability vs. SOC2 audit) but converging them post-Type-1 audit is a candidate cleanup.
- Strands emit-cardinality controls (sampling, throttling, queueing) for high-frequency call sites added in Phase 4.

---

## Context & Research

### Relevant Code and Patterns

- **Existing Strands → API HTTP callback** — `packages/agentcore-strands/agent-container/container-sources/server.py:920-1000`. `_check_quota` and `_log_invocation` use stdlib `urllib.request` + `Authorization: Bearer ${API_AUTH_SECRET}` + 3s timeout, with env vars (`_sb_api_url`, `_sb_api_secret`) snapshotted in the closure scope. Mirror this exactly — the compliance client is the same shape with a different URL and a different payload contract.
- **API_AUTH_SECRET validator** — `packages/api/src/lib/auth.ts` exports `extractBearerToken(event)` and `validateApiSecret(token)` (timingSafeEqual against `process.env.API_AUTH_SECRET`). The new compliance handler authenticates via this pair, mirroring `tenant-membership.ts:91-101`.
- **U3 emit helper** — `packages/api/src/lib/compliance/emit.ts`. Signature: `emitAuditEvent(tx, {tenantId, actorId, actorType, eventType, source, payload, ...})`. The handler calls this inside a Drizzle `db.transaction(...)` so audit failures roll back; idempotency is handled at the helper level via a unique constraint on `audit_outbox.event_id` (U1 schema).
- **Narrow REST handler pattern** — `packages/api/src/handlers/skills.ts:117-200` (auth dispatch + route matching) and `packages/api/src/handlers/invites.ts` (single-purpose narrow handler). U6 follows the second shape: dedicated handler, single endpoint per Lambda.
- **API Gateway route registration** — `terraform/modules/app/lambda-api/handlers.tf:580-700` — the `api_routes` map registers `route_key → handler_name` pairs. Each handler is its own Lambda, so a new entry is one map line plus a handler block in the same file.
- **Build pipeline** — `scripts/build-lambdas.sh:106` (`build_handler "graphql-http" ...`) and other entries. New handler needs a `build_handler "compliance-events" "$REPO_ROOT/packages/api/src/handlers/compliance.ts"` line (per `feedback_lambda_zip_build_entry_required`).
- **Strands env-snapshot pattern** — `packages/agentcore-strands/agent-container/container-sources/server.py:917-925` — env vars captured in closure scope at handler-init time. The compliance client must do the same: snapshot `THINKWORK_API_URL` (or equivalent) + `API_AUTH_SECRET` at module-load / `__init__`, never re-read inside retry loops (per `feedback_completion_callback_snapshot_pattern`).
- **Existing Strands skill-marker write site** — search for AGENTS.md writes from Strands tools (skill-creation, capability-set updates). The initial U6 call site emits `agent.skills_changed` from the Python runtime when an in-Strands tool calls the `update-agents-md` workflow (or the equivalent — implementer locates at integration time).

### Institutional Learnings

- `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md` — Don't widen `resolveCaller` for service-asserted compliance writes. Stand up a narrow service-only endpoint with explicit `tenantId` + `actorUserId` body fields and validate cross-tenant ownership server-side.
- `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md` — Strands runtime callback paths must snapshot `THINKWORK_API_URL` + `API_AUTH_SECRET` at coroutine entry. Re-reading `os.environ` after agent turn execution can silently shadow with stale values; for audit emits that's an undetectable evidence gap.
- `feedback_smoke_pin_dispatch_status_in_response` — return `dispatched: true` (and the emitted `eventId` / `outboxId`) in the response body so smoke tests can pin the dispatch shape without parsing CloudWatch logs.
- `feedback_lambda_zip_build_entry_required` — every new Lambda needs both a Terraform `handlers.tf` block AND a `scripts/build-lambdas.sh` entry. Missing the second blocks every deploy with `filebase64sha256` errors.
- `project_async_retry_idempotency_lessons` — set `MaximumRetryAttempts=0` on the new Lambda's async invoke config since the originating Strands call already retries (3-attempt exponential backoff). Compounding retries would amplify dupes.

### External References

- AWS Lambda async invoke retry semantics — https://docs.aws.amazon.com/lambda/latest/dg/invocation-retries.html
- HTTP `Idempotency-Key` header convention (Stripe-style) — https://stripe.com/docs/api/idempotent_requests
- urllib.request Python stdlib reference — https://docs.python.org/3/library/urllib.request.html

---

## Key Technical Decisions

- **Dedicated Lambda over piggybacking on graphql-http** — `compliance-events` is its own Lambda. The codebase pattern at `handlers.tf:580-700` is one Lambda per narrow REST surface (`agents`, `messages`, `invites`, `skills`, `webhooks`, etc.). Mounting compliance on graphql-http would diverge from the convention without a clear benefit, and graphql-http already carries 512MB memory + the GraphQL bundle. Cost: ~50ms cold-start per first invocation, amortized across warm invocations. Rationale: convention parity, isolation, and future-flexibility (e.g., reserved concurrency or VPC config without affecting graphql-http).
- **Authentication: API_AUTH_SECRET only** — no Cognito path on this endpoint. The Strands runtime has no user session; the bearer is the platform-credential. Use `extractBearerToken(event)` + `validateApiSecret(bearer)`, return `401` on either miss. This matches the existing `_log_invocation` shape and is consistent with `service-endpoint-vs-widening-resolvecaller-auth` learning.
- **Cross-tenant guard via SELECT-then-assert** — body carries `tenantId` and `actorUserId`. Handler does `SELECT users.tenant_id FROM users WHERE users.id = $actorUserId` and asserts `=== body.tenantId`. On mismatch (or no row): return `403 Forbidden`, do not reveal whether the user exists in another tenant. The U3 helper docstring explicitly delegates this validation to the caller.
- **Idempotency via client-supplied `event_id` (UUIDv7), enforced server-side by extending the U3 helper** — Today's `emitAuditEvent` at `packages/api/src/lib/compliance/emit.ts:157` unconditionally generates `event_id` server-side via `uuidv7()`, so a client-supplied id never reaches the unique index. **U1 extends the helper to accept an optional `eventId` field on `EmitAuditEventInput`** — when present, the helper uses it; when absent, the helper generates one as today (preserves U5 callers). The handler then SELECTs against `compliance.audit_outbox.event_id` (the `uq_audit_outbox_event_id` constraint from U1's schema) BEFORE calling the helper — a hit returns 200 `{dispatched: true, idempotent: true, eventId}` without opening a tx. A miss falls through to the helper-driven insert, which still has its OWN safety net via `onConflictDoNothing({target: auditOutbox.event_id})` covering the race between SELECT and INSERT. Rationale: client-side UUIDv7 generation lets Strands log the event_id locally before the POST attempt; retries are deterministic and observable end-to-end. The Idempotency-Key header is a courtesy mirror of body's event_id; handler validates header == body when both are present and rejects 400 on mismatch (catches client bugs, no security boundary). Strands MUST use UUIDv7 (not uuid4) so the chain-head ordering invariant U4 relies on holds across cross-runtime emits.
- **Emit-inside-tx semantics** — handler wraps `emitAuditEvent` in `db.transaction(async (tx) => ...)`. If the cross-tenant guard fails, the tx is never opened. If the U3 helper throws (validation, redaction-registry miss, etc.), the tx rolls back and the handler returns the error. The handler is *internally* atomic — a partial write is the worst possible state for the hash chain. The "telemetry tier" framing applies only to the **Strands caller's** perspective: when the entire HTTP round-trip fails (network, 5xx, DB unreachable), the Python client logs and the agent action proceeds, accepting that audit row as lost.

- **DB connection: master singleton, not `compliance_writer`** — U5's existing emit sites in `packages/api/src/handlers/invites.ts`, `packages/api/src/handlers/skills.ts`, and `packages/api/src/graphql/resolvers/agents/createAgent.mutation.ts` all import `db` from `packages/api/src/lib/db.js` (the `getDb()` master singleton against `DATABASE_SECRET_ARN`). The `compliance_writer` Aurora role exists (created in U2's migration `0070_compliance_aurora_roles.sql`) and its Secrets Manager secret is exported at `terraform/modules/data/aurora-postgres/outputs.tf:51`, but **no Lambda consumes it today** — the U4 drainer uses `compliance_drainer`, which is a different role. U6 follows U5's pattern: import the master `db` singleton, no new IAM role / secret wiring. The `compliance_writer` role is reserved for future per-runtime privilege isolation (a Phase 4+ hardening) — pulling that work into U6 would require migrating every U5 emit site too. Document the divergence from the master plan's "compliance_writer" mention as deliberate convention parity.
- **Python client transport: stdlib urllib.request** — same pattern as `_log_invocation` at `server.py:972-1000`. Synchronous `urlopen` wrapped in `loop.run_in_executor(None, _post)` for async-context callers. 3-second timeout. 3-attempt retry with exponential backoff (e.g., 0.5s, 1.0s, 2.0s) on `5xx` and `429` only — not on 4xx (those are client-side bugs that retry won't fix). httpx is not added as a dep (revisit only when async/concurrent emit becomes a real need; for one call site at telemetry tier, stdlib is sufficient and zero-dep).
- **Env snapshot at coroutine entry** — `compliance_client.ComplianceClient.__init__(self)` reads `os.environ.get("THINKWORK_API_URL")` and `os.environ.get("API_AUTH_SECRET")` ONCE at construction. Never re-read inside `emit()` or the retry loop. The Strands `server.py` instantiates the client at server startup and reuses the instance across agent turns. (Aligns with `feedback_completion_callback_snapshot_pattern`.)
- **Telemetry-tier failure semantics** — when the Python emit raises after retries exhaust, Strands logs a structured event (`compliance.emit_failed` with `event_id`, `event_type`, `tenant_id`, error class) and **continues**. The agent action (whatever triggered the emit) is not blocked. This is a deliberate evidence gap in adverse audit-DB conditions — documented as accepted SOC2 Type 1 limitation, mirroring U5's Cognito-trigger telemetry-tier deviation.
- **No live emit call sites in U6 — infrastructure only** — the obvious "first caller" candidate is Strands' AGENTS.md edit path, but Strands doesn't write S3 directly: it POSTs to `/api/workspaces/files`, which is exactly the surface where U5's `agent.skills_changed` and `workspace.governance_file_edited` emits already fire. A Python emit on top of that path would create duplicate audit rows (TS handler emits AND Python client emits for the same logical event), corrupting the per-tenant hash chain's evidence shape. Other plausible Strands-only sites (skill-run lifecycle, MCP tool wrapper, LLM-call audit) are each their own product question (cardinality, sampling cost, what counts as auditable) and don't have allow-listed event types in `EVENT_PAYLOAD_SHAPES` yet. U6 ships the handler, the Python client, the Terraform wiring, integration tests, and instantiates `ComplianceClient` at server boot (so the singleton is in scope when a Phase 4 caller lands) — but adds no `client.emit(...)` call sites. The first non-duplicate caller is selected in a Phase 4 brainstorm.
- **Lambda async-invoke config: zero retries** — `aws_lambda_function_event_invoke_config` with `maximum_retry_attempts = 0` and a SQS DLQ for unprocessed events (per `project_async_retry_idempotency_lessons`). The originating Strands client already retries 3× with backoff; Lambda-managed retries on top would 6× the dupe surface. Note: this endpoint is invoked synchronously from API Gateway, so Lambda async retries don't normally apply — but configuring zero is defense-in-depth in case future callers invoke async.

---

## Open Questions

### Resolved During Planning

- **One Lambda or piggyback on graphql-http?** — One Lambda. Convention parity with `agents`, `messages`, `invites`, etc.
- **Cognito or service auth?** — Service auth only (`API_AUTH_SECRET`). Strands has no user session.
- **Idempotency key shape?** — Client-supplied UUIDv7 in both `Idempotency-Key` header and body's `event_id`. Handler does ON CONFLICT DO NOTHING against the U1 `uq_audit_outbox_event_id` index.
- **403 vs 404 on missing user?** — 403 (consistent with cross-tenant mismatch path; doesn't reveal whether the user exists in another tenant).
- **stdlib urllib vs httpx?** — stdlib. Single call site, telemetry tier, parity with existing `_log_invocation`.
- **Initial Strands call site?** — `agent.skills_changed` after Strands-driven AGENTS.md edits. One site, no scope creep.

### Deferred to Implementation

- **Exact Strands integration point for the AGENTS.md write site** — the implementer must locate the in-Strands skill-creation / AGENTS.md-update path and confirm where the emit call belongs (after-write vs before-tool-success-return). Acceptable variants: (a) wrap the `update_agents_md` tool's success-return; (b) hook the workspace-files HTTP write site that Strands posts to and emit there. Recommend (a) — closer to the agent's intent and gives access to the skill delta.
- **Strands `THINKWORK_API_URL` env var name** — the existing `_log_invocation` uses `_sb_api_url` derived from a different env var. Implementer threads the right env name through Terraform's AgentCore module + the agent-container Dockerfile / runtime config. Not blocking design; integration-time detail.
- **Whether to emit `dispatched: true` smoke-pin field** — recommend yes per `feedback_smoke_pin_dispatch_status_in_response` so the Python client's tests can pin handler success without log scraping. Implementer confirms response shape at integration.

---

## Implementation Units

- U1. **Compliance-events Lambda handler (TypeScript)**

**Goal:** Create the `compliance-events` Lambda + handler that authenticates via `API_AUTH_SECRET`, validates cross-tenant ownership, and writes the audit event through the U3 emit helper inside a transaction.

**Requirements:** R6, R10, R11, R12, R15.

**Dependencies:** None (U3 + U4 already shipped + deployed).

**Files:**
- Create: `packages/api/src/handlers/compliance.ts`
- Create: `packages/api/src/handlers/__tests__/compliance.test.ts`
- Modify: `packages/api/src/lib/compliance/emit.ts` — extend `EmitAuditEventInput` with optional `eventId?: string`. When supplied, the helper uses it as-is (still validates UUIDv7 shape via regex); when absent, falls back to `uuidv7()` as today. Preserves all existing U5 callers (none pass `eventId`).
- Modify: `packages/api/src/lib/compliance/__tests__/emit.test.ts` — add coverage for the new optional `eventId` input.

**Approach:**
- Single `export async function handler(event: APIGatewayProxyEventV2)` matching the existing narrow-handler shape. Route match: `POST /api/compliance/events`.
- DB connection: `import { db } from "../lib/db.js"` (the master `getDb()` singleton, same pattern as `invites.ts` / `skills.ts` / `createAgent.mutation.ts`). **Do NOT add a new compliance_writer client.** Per Key Technical Decisions §DB connection.
- Auth: `const bearer = extractBearerToken(event); if (!bearer || !validateApiSecret(bearer)) return error("Unauthorized", 401);`
- Body parse: validate `tenantId`, `actorUserId`, `eventType`, `payload`, `event_id` are present + correct shape (TypeScript type guards or zod). Reject 400 on malformed. Validate `event_id` matches UUIDv7 regex; reject 400 on shape mismatch.
- Idempotency-Key header check: if header is present, assert it equals body's `event_id`; reject 400 on mismatch (catches client bugs, no security boundary).
- Cross-tenant guard: `db.select({tenant_id: users.tenant_id}).from(users).where(eq(users.id, body.actorUserId))` — if no row OR `tenant_id !== body.tenantId`, return 403. Don't reveal whether the user exists in another tenant.
- Idempotency pre-check: `db.select({event_id: auditOutbox.event_id, outbox_id: auditOutbox.outbox_id}).from(auditOutbox).where(eq(auditOutbox.event_id, body.event_id)).limit(1)`. On hit: return `200 {dispatched: true, idempotent: true, eventId, outboxId}` without opening a tx.
- Emit (on idempotency miss): `await db.transaction(async (tx) => { return await emitAuditEvent(tx, {eventId: body.event_id, tenantId, actorId: actorUserId, actorType: 'user', eventType, source: 'strands', payload, occurredAt, requestId, threadId, agentId, resourceType, resourceId, action, outcome, controlIds}); })`. The helper now respects the caller's `eventId` (per the U3 file change above).
- Race-condition safety: between the SELECT and the INSERT, a concurrent request with the same `event_id` could land first. The U3 helper's INSERT into `audit_outbox` is then guarded by the pg unique constraint `uq_audit_outbox_event_id`. Catch the pg error code `23505` (unique violation — pattern already used in `packages/api/src/lib/computers/tasks.ts:383` and `packages/api/src/lib/connectors/runtime.ts:860`, so the code does survive drizzle-orm wrapping). On 23505: re-run the idempotency SELECT and return the previously-inserted row's metadata as `{dispatched: true, idempotent: true, eventId, outboxId}`. On any other error, propagate to 500.
- Response on success: `200 {dispatched: true, idempotent: false, eventId, outboxId, redactedFields}`.
- Smoke-pin: include `dispatched: true` in every success path response (per the smoke-pin learning).
- The `'strands'` value in `COMPLIANCE_SOURCES` already exists (verified: `packages/api/src/lib/compliance/emit.ts:52-58`). No enum extension needed.

**Patterns to follow:**
- `packages/api/src/handlers/invites.ts` (single-purpose narrow handler shape, `handler(event)` export, json/error response helpers).
- `packages/api/src/lib/auth.ts:15-38` (`extractBearerToken` + `validateApiSecret`).
- `packages/api/src/lib/compliance/emit.ts` (helper signature + AuditTx + EmitAuditEventInput).
- `packages/api/src/handlers/skills.ts:2030+` (in-tx emit pattern from U5; same shape applies here).

**Test scenarios:**
- *Happy path:* POST with valid bearer + valid body where `actorUserId` belongs to `tenantId` → 200 `{dispatched: true, idempotent: false, eventId, outboxId, redactedFields}`. Outbox row visible afterwards with the right `tenant_id`, `actor`, `event_type`, redacted payload.
- *Happy path (with optional fields):* POST with `requestId`, `threadId`, `agentId`, `resourceType`, `resourceId`, `action`, `outcome`, `controlIds` → those fields persisted in the row.
- *Edge case (idempotency, covers AE5):* Replay POST with the same `event_id` (UUIDv7) → 200 `{dispatched: true, idempotent: true, eventId}`. Only one outbox row exists (assert via SELECT count).
- *Error path (auth missing):* POST with no `Authorization` header → 401, no DB write attempted.
- *Error path (bad bearer):* POST with `Authorization: Bearer wrong-token` → 401.
- *Error path (cross-tenant):* POST with `actorUserId` belonging to tenantA but body's `tenantId` = tenantB → 403, no DB write.
- *Error path (unknown actor):* POST with `actorUserId` that doesn't exist in `users` → 403 (not 404 — don't reveal existence).
- *Error path (malformed body):* POST with missing `eventType` → 400.
- *Error path (unknown event type):* POST with `eventType: 'made-up.event'` → 400 from U3 helper validation, propagated as 400.
- *Edge case (allow-list drop):* POST with payload containing both allowed and unknown keys → 200, `redactedFields` lists the dropped keys, payload contains only allow-listed ones.

**Verification:** Integration test passes against dev DB. Manual `curl -X POST -H "Authorization: Bearer $API_AUTH_SECRET" -H "Content-Type: application/json" -d '{"tenantId":"...","actorUserId":"...","eventType":"agent.skills_changed","payload":{"agentId":"a","addedSkills":["test"],"removedSkills":[],"reason":"u6_smoke"}}' $API_URL/api/compliance/events` returns 200 with `dispatched: true` and the `compliance.audit_outbox` table shows the new row.

---

- U2. **Terraform + build-script wiring**

**Goal:** Register the new Lambda in Terraform (handler block + API Gateway route + IAM + DLQ + zero-retry async config) and add the `scripts/build-lambdas.sh` entry.

**Requirements:** R10.

**Dependencies:** U1.

**Files:**
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (add `compliance-events` to handler-defs map + add `"POST /api/compliance/events" = "compliance-events"` to `api_routes`).
- Modify: `scripts/build-lambdas.sh` (new `build_handler` line for `compliance-events`).
- No new module — reuse the existing `lambda-api` handler infrastructure.

**Approach:**
- Mirror the existing **narrow-handler shape** (e.g., `invites`, `agents`, `skills`) — IAM template, env vars, build flags. **NOT the `compliance-outbox-drainer` shape**: that uses `compliance_drainer` role + Secrets Manager wiring, which U6 explicitly avoids. U6 connects via the master `DATABASE_SECRET_ARN` like every other narrow handler (per Key Technical Decisions §DB connection). IAM: standard narrow-handler set (CloudWatch Logs + Secrets Manager read on the master DB secret), no compliance_writer secret access.
- API Gateway integration: add `"POST /api/compliance/events" = "compliance-events"` to the `local.api_routes` map. The map → routes resource is already wired generically. Verified no existing route conflicts (no `/api/compliance/{proxy+}` or similar).
- Synchronous-only: the route is fronted by API Gateway invoke (synchronous). Skip the `aws_lambda_function_event_invoke_config` block — the existing `compliance-outbox-drainer` block sets it because the drainer is invoked on a schedule (async). For a synchronous-only path, a zero-retry async config is dead Terraform.
- Build script: insert `build_handler "compliance-events" "$REPO_ROOT/packages/api/src/handlers/compliance.ts"` adjacent to the other narrow handler builds. Inherit the default esbuild flags (no `BUNDLED_AGENTCORE_ESBUILD_FLAGS` needed — this handler doesn't use the SDK clients in that allow-list).

**Patterns to follow:**
- `terraform/modules/app/lambda-api/handlers.tf` U4-added `compliance-outbox-drainer` block (handler definition + IAM + DLQ + reserved concurrency=1 — for U6 we DON'T set reserved-concurrency=1; that's a single-writer constraint specific to the drainer).
- `scripts/build-lambdas.sh:106-110` (the `cognito-pre-signup` and other narrow handler `build_handler` entries).

**Test scenarios:**
- *Verification:* `terraform plan` against dev shows the new Lambda + IAM role + API Gateway integration + DLQ. `pnpm build:lambdas compliance-events` produces a valid zip at `dist/lambdas/compliance-events/index.mjs`.
- *Test expectation:* none for the Terraform / build-script wiring itself. Coverage comes from U1's integration test exercising the handler post-deploy.

**Verification:** `terraform plan` clean; build succeeds; deploy run hits the new endpoint without 502/404.

---

- U3. **Python compliance client (`compliance_client.py`)**

**Goal:** Reusable Python client class that posts to `/api/compliance/events` with retry, idempotency, and env-snapshot semantics.

**Requirements:** R10.

**Dependencies:** U1, U2 (handler must exist + be reachable for the client's contract).

**Files:**
- Create: `packages/agentcore-strands/agent-container/container-sources/compliance_client.py`
- Create: `packages/agentcore-strands/agent-container/test_compliance_client.py`

**Approach:**
- `class ComplianceClient` with `__init__(self)` that snapshots `THINKWORK_API_URL` and `API_AUTH_SECRET` from env into instance attrs (env vars confirmed in `packages/agentcore-strands/agent-container/container-sources/server.py:454-460`). If either is missing, set a `disabled = True` flag and have `emit()` return early as a no-op (preserves dev-stage behavior where the secret isn't wired — same shape as `_log_invocation`).
- `emit(self, *, tenant_id, actor_user_id, event_type, payload, occurred_at=None, request_id=None, thread_id=None, agent_id=None, resource_type=None, resource_id=None, action=None, outcome=None, control_ids=None) -> dict | None` — async-friendly via `asyncio.get_event_loop().run_in_executor(None, _post)`. Generates `event_id` as a UUIDv7 client-side (see UUIDv7 helper note below). The handler's idempotency depends on this being UUIDv7 — uuid4 breaks the per-tenant chain ordering invariant U4 relies on (`recorded_at, event_id` sort).
- **UUIDv7 helper**: `packages/agentcore-strands/pyproject.toml` does not currently include `uuid_extensions` (verified). Two options: (a) add `uuid_extensions` as a dep (stable lib, ~1KB, supports `uuid7()`); (b) ship a ~30-line stdlib UUIDv7 implementation inside `compliance_client.py` (reads `time.time_ns()`, packs the 48-bit timestamp + version + variant + 74 random bits per RFC 9562). Recommend (b) — keeps the client zero-dep and avoids dependency churn for one helper function. Verify the UUIDv7 output against an online RFC 9562 reference test vector.
- Headers: `Authorization: Bearer ${snapshotted_secret}`, `Content-Type: application/json`, `Idempotency-Key: ${event_id}`.
- Body: snake_case-to-camelCase conversion at the **client boundary**. The TS handler accepts camelCase (`tenantId`, `actorUserId`, `eventType`, etc.) per existing API convention. The Python client surface uses snake_case for the function signature; the `_post` inner function builds the JSON dict with camelCase keys before serializing. Document the conversion in the function docstring so future emit-site authors don't ship snake_case payloads.
- Retry: 3 attempts with exponential backoff (`0.5s, 1.0s, 2.0s`). Retry only on `urllib.error.HTTPError` with status `>= 500` or `== 429`. Don't retry 4xx.
- Failure: after retries exhaust, log a structured error (matching the existing `_log_invocation` exception-swallow pattern) and return None. Caller doesn't block on failure.
- Returns: parsed JSON dict on success (`{dispatched, idempotent, eventId, outboxId, redactedFields}`), None on suppressed failure.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/container-sources/server.py:920-1000` (`_log_invocation` shape — closure-scoped env, urllib.request, run_in_executor, exception swallow).
- `packages/agentcore-strands/agent-container/container-sources/api_runtime_config.py` (existing client class for runtime config — similar structural shape, `__init__` snapshots env, methods are I/O).
- `packages/agentcore-strands/agent-container/container-sources/api_memory_client.py` (another existing client following the same pattern).

**Test scenarios:**
- *Happy path:* `ComplianceClient.emit(...)` with a mocked urllib.request response returning 200 → returns the parsed dict.
- *Edge case (env missing):* `ComplianceClient()` with no `THINKWORK_API_URL` env → `disabled = True`. `.emit(...)` returns None without making a network call.
- *Edge case (idempotent replay):* Server returns 200 `{idempotent: true}` → client returns the dict; downstream Strands code can detect via the `idempotent` field.
- *Error path (5xx retry):* First attempt raises HTTPError(500), second attempt 200 → client retries, returns success dict, total elapsed time ≥ 0.5s.
- *Error path (5xx exhausted):* All 3 attempts return 500 → `.emit(...)` returns None after total elapsed ~3.5s. Structured log line emitted with event_id + error.
- *Error path (4xx no retry):* First attempt 403 → no retry, returns None immediately. Structured log line distinguishes 4xx (caller bug) from 5xx (transient).
- *Error path (network timeout):* `urlopen` times out (3s) on every attempt → returns None after retries exhaust, structured log includes timeout class.
- *Edge case (env snapshot stability):* Set env `API_AUTH_SECRET=foo`, instantiate `ComplianceClient()`, then change env to `bar`, call `.emit(...)` — bearer in request is `foo` (snapshotted, not re-read).

**Verification:** Pytest passes against mocked urllib (use `unittest.mock.patch("urllib.request.urlopen")`). Integration test against dev (manual or scripted) confirms the client successfully posts to the deployed endpoint.

---

- U4. **Boot-time `ComplianceClient` instantiation in Strands server (no live emit call sites)**

**Goal:** Construct the `ComplianceClient` singleton at Strands server startup so a Phase 4 caller can pick up the existing instance, and verify the boot-time wire-up is observable. **Does not add `client.emit(...)` call sites** — see Key Technical Decisions §"No live emit call sites in U6" for rationale (the only obvious candidate produces duplicate rows with U5).

**Requirements:** R10 (cross-runtime infra exists), partial R12 (the chain is ready to receive Strands rows when callers exist).

**Dependencies:** U3.

**Files:**
- Modify: `packages/agentcore-strands/agent-container/container-sources/server.py` — instantiate `ComplianceClient` once near the `_log_invocation` setup (around line 920); log a structured boot event with `disabled` status so operators can observe whether env wiring succeeded.
- Test: `packages/agentcore-strands/agent-container/test_compliance_client.py` (boot-time instantiation case + env-snapshot stability).

**Approach:**
- At server startup, construct `client = ComplianceClient()`. Stash in the same closure scope as `_log_invocation` / `_check_quota` so future Strands tool implementations can `await client.emit(...)` without re-instantiating.
- Log structured boot event: `{event: "compliance.client_initialized", disabled: client.disabled, api_url_set: bool(client._api_url), secret_set: bool(client._api_secret)}`. Operator dashboard surfaces this so a misconfigured stage is visible at deploy time, not at first emit attempt.
- **Do not add any `await client.emit(...)` call sites** in this PR. The only natural candidate (Strands AGENTS.md edits → `/api/workspaces/files`) already emits via U5's TypeScript path; emitting from Python on top would duplicate audit rows. Selection of the first non-duplicate caller is a Phase 4 brainstorm.
- Document U6's "ships infrastructure, no live emit" posture in the PR description so reviewers don't expect to see new `compliance.audit_outbox` rows from `source='strands'` post-deploy.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/container-sources/server.py:917-925` (closure-scoped `_sb_api_url` / `_sb_api_secret` instantiation pattern at server boot).
- `packages/agentcore-strands/agent-container/container-sources/api_runtime_config.py` (existing client class instantiated once at server boot, reused across requests — same lifecycle U6 uses).

**Test scenarios:**
- *Happy path:* Server starts with `THINKWORK_API_URL` + `API_AUTH_SECRET` set → `ComplianceClient` boots with `disabled=False`. Boot log shows `disabled: False, api_url_set: True, secret_set: True`.
- *Edge case (env unset):* Server starts with no `THINKWORK_API_URL` → `disabled=True`. Boot log surfaces both False flags. Subsequent agent activity does NOT raise.
- *Test expectation (no live emit):* Verify by code search that `server.py` contains no `await client.emit(` or `client.emit(` lines after this PR — except inside the boot-log message itself. A pre-merge check (grep) catches accidental scope creep.

**Verification:** Strands server starts cleanly on dev; CloudWatch shows the boot log line. Subsequent agent runs proceed without error. `compliance.audit_outbox` continues to receive U5's TypeScript-runtime rows; no `source='strands'` rows appear (this is correct — there are no Strands callers yet).

---

## System-Wide Impact

- **Interaction graph:** New endpoint `POST /api/compliance/events` writes to the same `compliance.audit_outbox` table U5 populates, picked up by the same U4 drainer Lambda. No changes to the drainer; the source vocabulary expansion (`'strands'`) is handled at U3 helper level via the existing `COMPLIANCE_SOURCES` enum.
- **Error propagation:** Telemetry-tier from Strands. The handler itself rolls back on any DB error; Strands swallows the failure and continues. SOC2 Type 1 acceptable per origin master plan rationale (mirrors U5's Cognito-trigger telemetry-tier deviation).
- **State lifecycle risks:** Idempotency-Key replay handling means a Strands retry doesn't double-insert. Without idempotency, network blips between Strands and the api Lambda would balloon the audit log.
- **API surface parity:** No change to existing endpoints. New endpoint is additive. The U1-shipped redaction registry covers the event types Strands will emit (initially just `agent.skills_changed`); future Strands emits must validate the eventType is in `COMPLIANCE_EVENT_TYPES` and an entry exists in `EVENT_PAYLOAD_SHAPES`.
- **Integration coverage:** Cross-runtime + cross-tenant guard tests validate the contract end-to-end. The U1 handler integration tests against dev DB confirm the SQL-layer behavior; the U3 Python client tests confirm the HTTP-layer retry + env-snapshot behavior.
- **Unchanged invariants:** `compliance_writer` Aurora role's grants stay unchanged (the new Lambda uses the existing role). U4 drainer's chain-head ordering by `recorded_at, event_id` stays unchanged. U3 helper signature is untouched (just extending the `COMPLIANCE_SOURCES` set if `'strands'` isn't already there — verify at implementation time).

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Strands runtime missing `THINKWORK_API_URL` or `API_AUTH_SECRET` env vars in dev/staging → emits silently no-op | `ComplianceClient.__init__` sets `disabled=True` with a structured log line on instantiation. Operator dashboard surfaces `disabled` instances post-deploy. The TS handler is unchanged, so other callers continue to work. |
| Idempotency-Key collisions across tenants if Strands generates the same UUIDv7 twice | UUIDv7 collision probability is cryptographically negligible at expected throughput. The `uq_audit_outbox_event_id` index is global (not per-tenant), so a cross-tenant collision would be detectable as an immediate ON CONFLICT on the second emit; but given UUIDv7 generation is monotonic + random-tail per process, this is paper-thin risk. No mitigation beyond the existing index. |
| Cross-tenant guard SQL failure (transient DB blip) → handler returns 500 | Strands retries (3× backoff) cover transient blips; persistent failure logs + agent action completes. SOC2 acceptable telemetry-tier behavior. |
| Drift between U3's `COMPLIANCE_SOURCES` enum and the handler's `source: 'strands'` | U3 helper validates source at runtime — a missing entry would 400. Verification: U1 implementation explicitly checks `COMPLIANCE_SOURCES` before writing the handler's `source` field. |
| `agent.skills_changed` double-emit from both U5 (workspace-files.ts) and U6 (Strands client) when the path goes through both | U4 explicit decision: if Strands posts to the workspace-files endpoint, do NOT also emit from Python — the TypeScript side already handles it. Implementer evaluates the actual flow at integration; default to single-emit. |
| Python client's `urllib.request` timing-out the entire 3-second budget on slow Aurora connections | The handler is in front of Aurora via the existing `compliance_writer` connection pool (warmed by other compliance traffic post-U5). Cold-path emit p99 < 1 second based on U5 emit measurements. If observed > 2s in production, raise the per-attempt timeout to 5s and reduce retry count to 2 (3.5s → 5s budget). |
| New Lambda's cold start adds ~50ms p99 latency to first emit per warm-container window | Acceptable for telemetry-tier. The Strands runtime doesn't block on emit; agent latency is unaffected. |

---

## Documentation / Operational Notes

- After deploy, manual smoke from a dev shell:
  ```
  curl -X POST -H "Authorization: Bearer $API_AUTH_SECRET" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: 01900000-0000-7000-8000-000000000001" \
    -d '{"tenantId":"<dev-tenant>","actorUserId":"<dev-user>","eventType":"agent.skills_changed","payload":{"agentId":"<a>","addedSkills":["smoke-test"],"removedSkills":[],"reason":"u6_smoke"},"event_id":"01900000-0000-7000-8000-000000000001"}' \
    $API_URL/api/compliance/events
  ```
  Expected: 200 `{"dispatched":true,"idempotent":false,...}`. Replay returns 200 `{"dispatched":true,"idempotent":true,...}` with no second outbox row.
- After Strands deploy: trigger a tool execution that edits AGENTS.md and confirm `compliance.audit_outbox` shows a row with `source='strands'` within 5s.
- Update `docs/solutions/architecture-patterns/` with a one-page "U6 cross-runtime emit reference" linking the handler, client, and the U4 drainer integration. Author after merge.

---

## Sources & References

- **Origin master plan:** `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md` §U6 (lines 466-498).
- **U1 schema:** `packages/database-pg/drizzle/0069_compliance_schema.sql`, `packages/database-pg/src/schema/compliance.ts`.
- **U3 helper:** `packages/api/src/lib/compliance/emit.ts`, `packages/api/src/lib/compliance/event-schemas.ts`, `packages/api/src/lib/compliance/redaction.ts`.
- **U4 drainer (precedent for compliance Lambda + DLQ + IAM shape):** `packages/lambda/compliance-outbox-drainer.ts`, `terraform/modules/app/lambda-api/handlers.tf` (compliance-outbox-drainer block).
- **Strands runtime callback template:** `packages/agentcore-strands/agent-container/container-sources/server.py:920-1000` (`_check_quota` + `_log_invocation`).
- **API auth helpers:** `packages/api/src/lib/auth.ts` (`extractBearerToken`, `validateApiSecret`).
- **Solutions:** `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md`, `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md`, `docs/solutions/runtime-errors/lambda-web-adapter-in-flight-promise-lifecycle-2026-05-06.md` (smoke-pin dispatch status).
- **External:** AWS Lambda async retries — https://docs.aws.amazon.com/lambda/latest/dg/invocation-retries.html. HTTP Idempotency-Key — https://stripe.com/docs/api/idempotent_requests.
