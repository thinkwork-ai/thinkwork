---
title: "feat: Compliance U5 — emitAuditEvent call-site wiring (Phase 3 starter slate)"
type: feat
status: active
date: 2026-05-07
origin: docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md
---

# feat: Compliance U5 — emitAuditEvent call-site wiring (Phase 3 starter slate)

## Summary

Wire the U3 `emitAuditEvent` helper into every existing call site that maps to the Phase 3 SOC2 starter slate, plus stand up the one new Cognito hook (`PostAuthentication`) that the slate requires. This is the call-site PR for the audit-event log: U1–U4 already shipped the schema, roles, write helper, and outbox drainer; U5 is the first PR where actual production traffic causes audit rows to land.

The U3 redaction registry already declares all 14 Phase 3 event types. U5 wires emits at the **9 event types whose call sites exist in the codebase today** (`auth.signin.success`, `user.invited`, `user.created`, `agent.created`, `agent.deleted`, `agent.skills_changed`, `mcp.added`, `mcp.removed`, `workspace.governance_file_edited`). The remaining **5 event types** (`auth.signin.failure`, `auth.signout`, `user.disabled`, `user.deleted`, `data.export_initiated`) have no current call site to wire into and are deferred to follow-up PRs rather than invented here.

---

## Problem Frame

Origin master plan §U5 lists 14 Phase 3 event types. The U3 redaction registry (`packages/api/src/lib/compliance/event-schemas.ts:137-221`) already declares all 14, but the helper has zero callers in production code. Until U5 lands, the outbox is empty, the drainer wakes up every minute and finds nothing, and Phase 3's SOC2 evidence story is theoretical.

U5's job is the disciplined wire-up: locate the resolver / handler / Lambda for each event type, decide tier (control-evidence vs telemetry), wrap the existing primary write in `db.transaction(async (tx) => { ... })`, and call `emitAuditEvent(tx, …)` inside. For event types whose call site does not exist yet (no signout mutation, no user-disable path, no data-export resolver), surface that explicitly in scope boundaries — do not invent the call site here, since "what does the disable flow actually look like?" is a product question, not a wire-up question.

---

## Requirements

Carried forward verbatim from origin master plan U5 (R6, R10).

- R5. Append-only audit-event log with the canonical 22-field envelope. *(satisfied at write-time by the U3 helper; this plan's job is to feed it.)*
- R6. Two-tier write semantics. Control-evidence events fail the originating action on audit-write failure. Telemetry events log-and-continue.
- R10. SOC2 starter-slate emit at the 14 Phase 3 event types declared in `packages/database-pg/src/schema/compliance.ts` `COMPLIANCE_EVENT_TYPES` (the redaction allow-lists for those types live in `packages/api/src/lib/compliance/event-schemas.ts:137-221`). U5 wires 9 of the 14; the remaining 5 are deferred (see Scope Boundaries).
- R12. Every emitted row carries a correctly-resolved `tenant_id` so the U4 drainer's per-tenant hash chain stays intact for both Cognito-direct and Google-federated callers.
- R15. Redaction-before-write — handled by U3 helper; U5 verifies allow-lists actually cover the production payload shapes the call sites pass.

**Origin actors:** A1 Tenant admin, A3 Platform services.
**Origin flows:** F5 Platform service writes an audit event.
**Origin acceptance examples:** AE2a (control-evidence rollback), AE2b (telemetry log-and-continue), AE4 (governance-file edit emits with diff preview).

---

## Scope Boundaries

- Strands runtime emit path (`POST /api/compliance/events` + Python client) — that's U6.
- S3 anchor bucket, anchor Lambda, scheduled root anchoring — U7+U8.
- Standalone audit-verifier CLI — U9.
- Admin "Compliance" pages and GraphQL read resolvers — U10.
- Async export job and admin Exports page — U11.
- 12-month retention enforcement, archival, automated deletion — Phase 4.
- Migrate `activity_log` writers to dual-write `compliance.audit_events` — deferred per `docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md`.

### Deferred to Follow-Up Work

These slate event types have no existing production call site to wire into. Inventing the call site is a product decision (what should the user-facing flow look like?), not a wire-up decision, and stuffing one into this PR would expand U5 well past its review-friendly shape.

- **`auth.signin.failure`** — Cognito does not invoke any Lambda trigger on failed authentication. CloudTrail-data-event-driven harvesting is the right path; ships as a follow-up PR with its own Lambda and EventBridge wiring. SOC2 Type 1 evidence is acceptable on success-only events plus signout per origin master plan rationale.
- **`auth.signout`** — no GraphQL `signout` / `logout` mutation exists today; clients clear their token client-side. A real signout mutation is a Phase 4 / Type 2 item; defer.
- **`user.disabled`** — no `disableUser` mutation in `packages/api/src/graphql/resolvers/teams/` or anywhere else. Disable-user is a Phase 4 admin-UX item.
- **`user.deleted`** — `removeTeamUser` is per-team-membership, not per-user. There is no real `users` table delete path. Defer until a hard-delete admin tool is built.
- **`data.export_initiated`** — U11 builds the export-job mutation and runner; that PR will add the emit at job creation. No stub here.

The remaining 9 event types (`auth.signin.success`, `user.invited`, `user.created`, `agent.created`, `agent.deleted`, `agent.skills_changed`, `mcp.added`, `mcp.removed`, `workspace.governance_file_edited`) all have current call sites and are in scope for U5.

---

## Context & Research

### Relevant Code and Patterns

- **U3 emit helper signature** — `packages/api/src/lib/compliance/emit.ts:48-50, 69-92, 126-198`. Exported `AuditTx = Database | tx-from-db.transaction-callback`. Required input fields: `tenantId`, `actorId`, `actorType ∈ {'user','agent','system','service'}`, `eventType`, `source ∈ {'graphql','lambda','strands','scheduler','system'}`, `payload`. Optional: `occurredAt`, `resourceType`, `resourceId`, `action`, `outcome`, `requestId`, `threadId`, `agentId`, `controlIds[]`, `payloadSchemaVersion`, `payloadOversizeS3Key`. Returns `{eventId, outboxId, redactedFields}`.
- **U3 redaction registry (the 14 event types this PR wires)** — `packages/api/src/lib/compliance/event-schemas.ts:137-221`. Allow-lists are authoritative; payload fields outside the allow-list silently drop and appear in `redactedFields`. Confirm each call site's payload shape only uses allowed keys, otherwise the audit row carries empty payload.
- **Canonical actor-resolution pattern (GraphQL resolvers)** — `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts:16-50, 80`. `resolveCallerFromAuth(auth)` returns `{userId, tenantId, type}`. `resolveCallerTenantId(ctx)` is the fallback for Google-federated users where `ctx.auth.tenantId` is null. CLAUDE.md flags this as load-bearing — every U5 call site must use the resolver helpers, never `ctx.auth.userId` / `ctx.auth.tenantId` directly.
- **Canonical in-tx audit-emit pattern** — `packages/api/src/graphql/resolvers/core/updateTenantPolicy.mutation.ts:73-100`. `db.transaction(async (tx) => { ... primary write ...; await tx.insert(events).values([...]); })`. Mirror this shape for `emitAuditEvent(tx, …)`.
- **Cognito Pre-SignUp Lambda template** — `packages/api/src/handlers/cognito-pre-signup.ts:1-100` paired with `terraform/modules/foundation/cognito/main.tf:9-85, 138-143`. Shows the create-toggle-by-zip-presence pattern (`create_pre_signup = local.create && var.pre_signup_lambda_zip != ""`), per-trigger IAM role, lambda function, and `dynamic "lambda_config"` block. U5's new `auth-audit-trigger` Lambda mirrors this exactly. Build-script entry: `scripts/build-lambdas.sh:109-110`.
- **`derive-agent-skills.ts` change-detection signal** — `packages/api/src/lib/derive-agent-skills.ts:118-135` returns `DeriveResult { changed, addedSlugs, removedSlugs, agentsMdPathsScanned, warnings }`. Caller in `packages/api/workspace-files.ts:487-510` checks `result.changed` but currently only `console.log`s. U5 emits `agent.skills_changed` from this site when `changed === true`.
- **`workspace-files.ts handlePut`** — `packages/api/workspace-files.ts:427-527`. Today: S3 PutObjectCommand fires unconditionally; no `db.transaction` wraps it. U5 introduces a tx that emits `workspace.governance_file_edited` first, then performs the S3 put inside the tx callback so an S3 failure rolls the audit row back. (The reverse — S3 first, then audit — leaves orphaned files with no audit trail; this plan rejects that ordering.)
- **MCP tenant-server CRUD** — `packages/api/src/handlers/skills.ts:2030, 2116`. `mcpCreateServer` (insert tenantMcpServers) and `mcpDeleteServer` (delete agentMcpServers + tenantMcpServers). Both are REST handlers serving CLI / admin traffic. There is no GraphQL surface for tenant-MCP CRUD today. Wire emits inside a wrapping `db.transaction`.
- **Invite + create-user flows** — `packages/api/src/handlers/invites.ts:205-240` (`createInvite`), `packages/api/src/handlers/invites.ts:455-542` (`approveJoinRequest`). Caller resolution uses `event.headers["x-principal-id"]` because these are Lambda-style HTTP handlers, not Yoga resolvers.
- **Agent CRUD GraphQL surface** — `packages/api/src/graphql/resolvers/agents/createAgent.mutation.ts:18-150` (wrapped in `runWithIdempotency`), `packages/api/src/graphql/resolvers/agents/deleteAgent.mutation.ts:8-28` (soft-delete via `status: "archived"`).

### Institutional Learnings

- `feedback_oauth_tenant_resolver` — `ctx.auth.tenantId` is null for Google-federated users; every U5 resolver call site must call `resolveCallerTenantId(ctx)` as a fallback. A miss here corrupts the per-tenant hash chain (R12).
- `feedback_lambda_zip_build_entry_required` — the new `auth-audit-trigger` Lambda needs both `terraform/modules/foundation/cognito/main.tf` resource block AND `scripts/build-lambdas.sh` entry. Missing either blocks every deploy with `filebase64sha256` errors. Mirror the `cognito-pre-signup` shape exactly.
- `feedback_completion_callback_snapshot_pattern` — the new auth-audit-trigger handler must snapshot `THINKWORK_COMPLIANCE_DB_SECRET_ARN` (or whatever env it reads) at handler entry, not inside callback paths. PR #563 surfaced the env-shadowing bug; the same risk applies to any new Lambda that does post-handler work.
- `project_async_retry_idempotency_lessons` — Cognito Lambda triggers retry on failure (Cognito-managed). Audit emit failing inside the trigger means Cognito retries the auth flow itself, which is acceptable Type 1 behavior. Document the trade-off.
- `feedback_smoke_pin_dispatch_status_in_response` — for governance-file edits and other handler-style call sites, return the dispatch status (e.g., `audit_event_id`) in the response body so smoke pinning works without CloudWatch log filtering.
- `feedback_completion_callback_snapshot_pattern` (also covers env shadowing in Strands runtime) — applies to U6, not U5, but worth noting because the auth-audit-trigger Lambda handler shape mirrors the same pattern.
- `feedback_handrolled_migrations_apply_to_dev` — U5 introduces no new migrations; existing U1 schema covers all writes. No drift-gate risk for this PR.

### External References

- AWS Cognito Lambda triggers — https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools-working-with-aws-lambda-triggers.html (PostAuthentication and PostConfirmation reference)
- Drizzle pg-core transactions — https://orm.drizzle.team/docs/transactions
- AWS Cognito PostConfirmation event shape — https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-post-confirmation.html

---

## Key Technical Decisions

- **Tier assignment** — Two tiers, not one:
  - **Control-evidence tier (7 events):** `user.invited`, `agent.created`, `agent.deleted`, `agent.skills_changed`, `mcp.added`, `mcp.removed`, `workspace.governance_file_edited`. Audit-write failure rolls back the originating action by throwing inside `db.transaction(...)`.
  - **Telemetry tier (2 events):** `auth.signin.success` and `user.created`. Both fire from a Cognito synchronous Lambda trigger (`PostAuthentication` / `PostConfirmation`). A Lambda failure in a synchronous Cognito trigger fails the auth call entirely (per AWS docs — Cognito sync triggers do NOT auto-retry on Lambda failure; the user sees an error and must retry the whole sign-in). The U5 handler MUST NOT throw on audit-emit failure or every audit DB blip locks every user out, so these emits are best-effort with structured logs + CloudWatch alarm on emit-miss rate. Rationale: the alternative — taking sign-in down on audit DB instability — is a worse SOC2 finding than gaps in the audit row stream.
  - Note on `agent.skills_changed`: the wrapping tx covers the audit emit, but `deriveAgentSkills` already mutated `agent_skills` rows on its own connection before the wrapping tx fires. So a wrapping-tx rollback only undoes the audit row, not the skill-state mutation. This is acceptable because `agent_skills` is derived state — the next derive run will reconcile — and the underlying `workspace.governance_file_edited` event records the original SKILL.md write that triggered the derive. Document this as a known eventual-consistency seam, not a control gap.
- **Cognito `auth.signin.success` source** — New `auth-audit-trigger` Lambda wired to the user pool's `PostAuthentication` trigger. Rationale: PostAuthentication fires on every successful sign-in (Google federated + native email/password), receives `event.request.userAttributes` (sub, email, custom:tenant_id), and Cognito retries on Lambda failure. Alternative considered (GraphQL `viewer` query that detects new sessions) was rejected because it misses sessions established via the mobile token-refresh path.
- **Cognito `user.created` source** — Same `auth-audit-trigger` Lambda, but listening to `PostConfirmation` trigger as well. The single Lambda handles both auth events; routing is by `event.triggerSource`. Rationale: one IAM role, one secret, one connection pool, one bundle to maintain, vs two near-identical handlers.
- **`workspace.governance_file_edited` ordering** — `db.transaction` wraps the S3 PutObjectCommand. `emitAuditEvent` runs first inside the tx, then the S3 put runs (still inside the tx callback so an S3 throw rolls back the audit row). Rationale: the reverse ordering (S3 first, audit second) leaks edited files with no audit trail when the audit DB is briefly down. Limitation: an S3 failure mid-flight after a successful `PutObjectCommand` (e.g., a network blip after S3 returned 200 but before tx commit) leaves an audit row pointing at an S3 object that exists; this is acceptable because the audit row is an evidence-of-intent record, not a guarantee-of-content record.
- **Governance-file path filter** — New helper `isGovernanceFilePath(cleanPath: string): boolean` in `packages/api/workspace-files.ts` matching the full set of top-level governance/identity files actually shipped in `packages/system-workspace/` (and equivalents in any per-tenant workspace overlays). Implementer reads `packages/system-workspace/files/` (or the current shipping path) at implementation time and includes every top-level `*.md` whose semantics shape agent capability or behavior. The seed set, expected to expand on inspection, is: `AGENTS.md`, `GUARDRAILS.md`, `CAPABILITIES.md`, `PLATFORM.md`, `MEMORY_GUIDE.md`, `USER.md`. (Per project memory, `USER.md` is server-managed; edits to it are still security-relevant and must be audited.) If implementation discovers additional governance files (e.g., `IDENTITY.md`, `ROUTER.md`, `SOUL.md`, `TOOLS.md`, `CONTEXT.md`), include them. The U3 redaction registry's `governanceFileDiffTransform` already produces `{file, content_sha256, preview, workspaceId}`, so the call site only needs to pass `{file: cleanPath, content, workspaceId: target.workspaceId-or-tenant-slug-fallback}`.
- **MCP CRUD audit source** — REST handlers in `packages/api/src/handlers/skills.ts` use `db.insert` / `db.delete` directly today, no `db.transaction` wrapping. U5 introduces the wrapping tx. Rationale: U3 helper requires a tx-or-db handle; using the wrapping tx makes the rollback semantics explicit and matches every other in-scope call site.
- **Actor-type vocabulary for the 9 events** — Cognito triggers (`auth.signin.success`, `user.created`) emit with `actorType: 'user'`, `actorId: event.request.userAttributes.sub` (Cognito-signed; trustworthy). GraphQL resolvers (`createAgent`, `deleteAgent`) emit with `actorType: 'user'`, `actorId: resolveCallerFromAuth(ctx.auth).userId`. CLI / admin REST handlers (`createInvite`, `mcpCreateServer`, `mcpDeleteServer`) **branch by auth path**:
  - When the verdict's `userId` is non-null (Cognito-authenticated path): emit with `actorType: 'user'`, `actorId: verdict.userId`.
  - When the verdict's `userId` is null (apikey path — request authenticated by `API_AUTH_SECRET`): emit with `actorType: 'service'`, `actorId: 'platform-credential'`. **Never** read `event.headers["x-principal-id"]` for the audit `actorId` — that header is an unverified self-assertion (per `packages/api/src/lib/tenant-membership.ts:112-114`); using it would let any holder of the platform credential forge audit rows attributing actions to arbitrary user subs.
  - The `derive-agent-skills` site emits with `actorType: 'user'` if a userId can be threaded through from the workspace-files handler's auth context, else `actorType: 'service'`, `actorId: 'workspace-files'`.
- **`source` vocabulary** — `'lambda'` for Cognito triggers + REST handlers, `'graphql'` for Yoga resolvers, `'system'` for the derive-skills emit when called from a non-user-driven path. (No `'strands'` use in U5; that's U6.)
- **`occurred_at` precedence** — Caller-supplied where the business event has a meaningful timestamp (Cognito event timestamp for sign-ins, S3 object LastModified for governance files). Helper-default (`new Date()`) for resolver paths where "now" is the action time. Both paths are consistent with U4's chain-head ordering on `recorded_at, event_id` (server-set), so caller-supplied `occurred_at` cannot be used to inject events at the head of an old tenant's chain.
- **Test posture** — Integration-only. Unit tests of resolver/handler internals don't catch the actual emit-shape bugs that production hits (missing actor resolution, wrong tenant_id, payload key not in allow-list). Each in-scope event family gets one happy-path integration test that exercises the real resolver/handler against the dev DB and asserts the outbox row appears with the right shape. Cross-cutting concerns (allow-list drop, tenant resolution, tier rollback) get one integration test each rather than per-event-type duplication.

---

## Open Questions

### Resolved During Planning

- **What's the right Cognito hook for sign-in events?** PostAuthentication. Fires on every successful auth (federated + native), retried by Cognito on Lambda failure.
- **What about `auth.signin.failure`?** Defer. Cognito has no Lambda trigger for failed auth; CloudTrail data event harvesting is the right path but is its own PR.
- **Is `user.created` the same trigger as `auth.signin.success`?** No — different trigger sources (`PostConfirmation` vs `PostAuthentication`) but same Lambda. Routing is by `event.triggerSource`.
- **Where does `agent.skills_changed` actually emit from?** `packages/api/workspace-files.ts:489` after `deriveAgentSkills(...)` returns `{changed: true}`. The setAgentSkills GraphQL mutation is deprecated and not in U5 scope.
- **Are governance files the same as skill files?** No. Skills are user-defined workspace tree (handled by `isSkillMarkerPath`). Governance files are AGENTS.md / GUARDRAILS.md / CAPABILITIES.md / PLATFORM.md / MEMORY_GUIDE.md — fixed top-level filenames, never nested.
- **Do MCP add/remove have GraphQL mutations?** No. They're REST endpoints in `packages/api/src/handlers/skills.ts` (CLI- and admin-driven). No new GraphQL surface in U5.

### Deferred to Implementation

- **Exact `controlIds[]` SOC2 mapping for each event type** — implementer can default to empty array for U5 and follow up with a SOC2 mapping table when the auditor's PoV is clearer. Empty is valid; the column is `text[] not null default array[]::text[]`.
- **Whether `derive-agent-skills.ts` callsite has user context** — workspace-files handler resolves `tenantId` via `target.tenantId` but `userId` may not be threaded. Implementer chooses `actorType: 'user'` (with user resolution) or `actorType: 'system'` (with `actorId: 'derive-agent-skills'` literal).
- **Whether `mcpCreateServer` and `mcpDeleteServer` REST handlers can take a `db.transaction`** — Drizzle's `db.transaction` works at the connection level; the handler shape today calls `db.insert(...).returning()` directly. Implementer wraps in `db.transaction(async (tx) => { ... return tx.insert(...).returning(); })`.
- **`audit_event_id` in handler responses** — for smoke-pinning, governance-file PUT and MCP-CRUD handlers should return the emitted event's `outboxId` in the JSON response. Implementer decides whether to expose under `audit_event_id` or `compliance_event_id` field name.

---

## Implementation Units

### Phase A — Cognito hook (new infrastructure)

- U1. **`auth-audit-trigger` Lambda — handler + Terraform + build wiring**

**Goal:** Stand up a single new Lambda wired to both `PostAuthentication` and `PostConfirmation` Cognito triggers that emits `auth.signin.success` and `user.created` audit events.

**Requirements:** R6, R10, R12.

**Dependencies:** None within U5 scope (uses U3 emit helper directly).

**Files:**
- Create: `packages/api/src/handlers/cognito-auth-audit.ts`
- Create: `packages/api/src/handlers/__tests__/cognito-auth-audit.test.ts`
- Modify: `terraform/modules/foundation/cognito/main.tf` — add `create_post_auth` local + IAM role + IAM policy attaching `secretsmanager:GetSecretValue` on the compliance_writer secret ARN + Lambda function + Lambda permission + extend `lambda_config` dynamic block.
- Modify: `terraform/modules/foundation/cognito/variables.tf` — add `auth_audit_lambda_zip` and `compliance_writer_secret_arn` variables.
- Modify: `terraform/modules/thinkwork/main.tf` and `terraform/modules/thinkwork/variables.tf` — pass through.
- Modify: `terraform/examples/greenfield/main.tf` — wire the variable into the example.
- Modify: `scripts/build-lambdas.sh` — add `cognito-auth-audit` entry mirroring lines 109-110.

**Approach:**
- Handler routes by `event.triggerSource`:
  - `PostAuthentication_Authentication` → emit `auth.signin.success` with payload `{userId, method: 'cognito'|'google', ip: event.request.userContextData?.encodedData ?? null, userAgent: null}`.
  - `PostConfirmation_ConfirmSignUp` and `PostConfirmation_ConfirmForgotPassword` → emit `user.created` with payload `{userId, email, role: 'tenant_member'}`. (Confirm-forgot-password counts as user.created? No — it's a credential reset. Implementer decides per the redaction registry's `user.created` allow-list; if the `role` field can't be reliably determined, drop to `{userId, email}`.)
  - Any other `triggerSource` → return event unchanged, no emit.
- Tenant resolution: `event.request.userAttributes["custom:tenant_id"]` is the canonical source. If absent (Google-federated users without the post-tenant-attribute trigger), fall back to a single `db.select` against the `users` table by Cognito sub. If neither resolves, log + return event unchanged (do NOT throw — that fails the auth flow). Document the gap as a known issue tracked by the OAuth tenantId resolver follow-up.
- Actor: `actorType: 'user'`, `actorId: event.request.userAttributes.sub`.
- Source: `'lambda'`. `occurredAt`: `event.request.userAttributes.event_timestamp` if present, else `new Date()`.
- Snapshot env at handler entry: `const env = { secretArn: process.env.COMPLIANCE_DB_SECRET_ARN, dbHost: process.env.DATABASE_HOST, dbName: process.env.DATABASE_NAME, ... }` to avoid completion-callback shadowing per `feedback_completion_callback_snapshot_pattern`.
- DB connection: this Lambda does NOT use `getDb()` from `@thinkwork/database-pg` — that helper resolves from `DATABASE_SECRET_ARN`, which is the wrong role (it's the app's superuser role, not `compliance_writer`). Instead, lazy-initialize a dedicated Drizzle client at module scope using the `compliance_writer` Secrets Manager secret (created in U2). Reuse across warm Lambda invocations. Mirror the connection bootstrap from `packages/lambda/compliance-outbox-drainer.ts` (which is the actual right pattern for this Lambda — the cognito-pre-signup template has zero DB imports and is the wrong reference for the DB-bootstrap piece, even though its IAM role / Lambda resource shape is the right reference for the Cognito-trigger wiring piece).
- Cognito synchronous-trigger timeout budget: AWS-published cap is **5 seconds** (not 10s). Within that budget the handler must: bootstrap connection (cold-start: Secrets Manager fetch ~150-300ms + Aurora handshake ~50-200ms), open tx, INSERT outbox row, COMMIT. Set per-request caps: 1.0s connection acquire, 1.0s INSERT, total 2.0s emit. Exceeded → handler swallows the timeout, logs structured event, returns the auth event unchanged (does NOT throw — telemetry tier).

**Patterns to follow:**
- `packages/api/src/handlers/cognito-pre-signup.ts:1-100` — handler shape, event interface, `triggerSource` routing.
- `terraform/modules/foundation/cognito/main.tf:9-85, 138-143` — `create_pre_signup` local + IAM role + Lambda + permission + `dynamic lambda_config` block. Mirror exactly for `create_post_auth`.
- `packages/lambda/compliance-outbox-drainer.ts` — DB connection bootstrap from Secrets Manager with `compliance_*` role.

**Test scenarios:**
- *Happy path (covers AE2a):* PostAuthentication event with valid `custom:tenant_id` → returns event unchanged; outbox row appears with `event_type='auth.signin.success'`, correct `tenant_id`, redacted payload.
- *Happy path:* PostConfirmation event → outbox row with `event_type='user.created'`.
- *Edge case:* PostAuthentication for Google-federated user with no `custom:tenant_id` and no users-table row → handler returns event unchanged, NO emit, structured log line records the resolution miss.
- *Edge case:* Unknown `triggerSource` → handler is a passthrough, no emit, no error.
- *Error path:* DB unreachable → emitAuditEvent throws → handler catches, logs, returns event unchanged (does NOT block sign-in). Document as known telemetry-gap risk; SOC2 Type 1 acceptable per origin master plan. *(Tier note: this is the one telemetry-tier deviation in U5 — the handler MUST NOT fail the auth flow on audit-write failure, or every Cognito blip locks users out.)*
- *Edge case (client-driven retries, NOT Lambda-managed retries):* Cognito synchronous Lambda triggers do NOT auto-retry on Lambda failure. A Lambda throw fails the auth call entirely; the user sees an error and must re-attempt the sign-in. Each successful re-attempt is a real distinct sign-in event and SHOULD emit a new audit row (this is correct evidence of multiple attempts, not a bug). For U5, no idempotency dedup is added; a Phase 4 follow-up may add a Cognito-event-coordinate-derived idempotency key (`hash(userPoolId + sub + triggerSource + floor(eventTimestamp/1000))`) if auditor feedback indicates multi-attempt rows are presentation-confusing.

**Verification:** `terraform plan` shows the new Lambda + IAM role + Cognito wiring; integration test against dev DB confirms outbox row shapes; manual sign-in via Google OAuth on dev produces an `auth.signin.success` outbox row within 5 seconds.

---

### Phase B — Existing call-site wiring (in-codebase emits)

- U2. **`agent.created` + `agent.deleted` (GraphQL resolvers)**

**Goal:** Wrap existing `createAgent` / `deleteAgent` resolver writes in `db.transaction(tx => …)` and emit alongside.

**Requirements:** R6, R10, R12.

**Dependencies:** None.

**Files:**
- Modify: `packages/api/src/graphql/resolvers/agents/createAgent.mutation.ts`
- Modify: `packages/api/src/graphql/resolvers/agents/deleteAgent.mutation.ts`
- Test: `packages/api/test/integration/compliance-event-writers/agent-crud.integration.test.ts` *(new file; integration tests for both create + delete in one suite to share dev-DB setup)*

**Approach:**
- `createAgent`: convert the existing direct `db.insert(agents).values(...)` (line 78-98) to `db.transaction(async (tx) => { const inserted = await tx.insert(agents).values(...).returning(); await emitAuditEvent(tx, {...}); return inserted; })`. Payload: `{agentId, name, templateId}` (matches `event-schemas.ts:168` allow-list).
- `deleteAgent`: same wrapping, but the existing `db.update(agents).set({status: 'archived'})` is the primary write. Payload: `{agentId, reason: 'admin_delete'}` (matches `event-schemas.ts:171` allow-list; `reason` is implementer's choice — the allow-list permits it, but if no reason is meaningful at this site, pass `{agentId}` and let redaction silently drop nothing).
- Actor resolution: prefer `ctx.auth.authType === 'apikey'` → `{actorType: 'service', actorId: ctx.auth.principalId}`; else `{actorType: 'user', actorId: resolveCallerFromAuth(ctx.auth).userId}`. Tenant: `resolveCallerTenantId(ctx)`.
- Source: `'graphql'`. occurredAt: `new Date()`.
- Both mutations remain wrapped in `runWithIdempotency` for `createAgent`; the `db.transaction` is INSIDE the idempotency wrapper.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/core/updateTenantPolicy.mutation.ts:73-100` — in-tx audit-shape emit pattern.
- `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts:16-50, 80` — actor resolution.

**Test scenarios:**
- *Happy path (covers AE2a):* GraphQL `createAgent` mutation with valid auth → agent row inserted, outbox row inserted with `event_type='agent.created'`, both visible in same tx.
- *Error path (covers AE2a rollback):* createAgent payload that triggers a DB constraint violation → agent insert fails, audit emit never runs, no outbox row.
- *Error path (covers AE2a tier):* Force emitAuditEvent to throw (e.g., pass an unknown event type via test-only override) → agent row NOT created, transaction rolled back. Cannot run as written without monkeypatching; integration test instead asserts that the outbox row presence is a hard precondition for the agent row presence by querying both in the same SELECT after the mutation.
- *Edge case:* Google-federated caller (`ctx.auth.tenantId` null) → emit row carries the correctly-resolved `tenant_id` from `resolveCallerTenantId(ctx)`.
- *Happy path:* `deleteAgent` mutation → agent.status flips to 'archived', outbox row with `event_type='agent.deleted'`.

**Verification:** Integration test passes against dev DB.

---

- U3. **`user.invited` (REST handler)**

**Goal:** Emit `user.invited` from `createInvite()` in invites handler.

**Requirements:** R6, R10, R12.

**Dependencies:** None.

**Files:**
- Modify: `packages/api/src/handlers/invites.ts`
- Test: `packages/api/src/handlers/__tests__/invites-audit.test.ts` *(new file; focused on the audit-emit path, not re-testing the existing invite logic)*

**Approach:**
- Wrap the existing `db.insert(invites).values(...).returning()` (around line 220-238) in `db.transaction(async (tx) => { const [row] = await tx.insert(invites)…; await emitAuditEvent(tx, {…, eventType: 'user.invited', payload: {email, role, invitedBy}}); return row; })`.
- Actor: branch by auth path — `verdict.userId` non-null (Cognito-authenticated): `{actorType: 'user', actorId: verdict.userId}`; `verdict.userId` null (apikey path): `{actorType: 'service', actorId: 'platform-credential'}`. **Do not** trust `event.headers["x-principal-id"]` for audit purposes (per Key Technical Decisions §Actor-type vocabulary).
- Tenant: `verdict.tenantId` (already resolved at handler entry).
- Source: `'lambda'`. occurredAt: `new Date()`.
- Payload allow-list: `{email, role, invitedBy}` per `event-schemas.ts:155`.

**Patterns to follow:**
- `packages/api/src/handlers/invites.ts:205-240` (existing structure).

**Test scenarios:**
- *Happy path:* REST POST `/invites` with valid auth → invite row created + outbox row with `event_type='user.invited'`.
- *Error path:* DB constraint failure on invite insert → no outbox row. (Verifies tx atomicity.)
- *Edge case:* `x-principal-id` header missing → `actorId` falls back to body's `user_id`; if both absent, the existing handler already 401s before audit emit attempts.

**Verification:** Integration test passes against dev DB.

---

- U4. **`agent.skills_changed` (workspace-files derive callsite)**

**Goal:** Emit `agent.skills_changed` when `deriveAgentSkills` returns `{changed: true}`.

**Requirements:** R6, R10, R12.

**Dependencies:** None.

**Files:**
- Modify: `packages/api/workspace-files.ts` — wrap a NEW (post-derive) tx that emits on `result.changed`.
- Modify: `packages/api/src/lib/compliance/event-schemas.ts:175-181` — swap the `agent.skills_changed` allow-list keys from `["agentId", "skillIds", "previousSkillIds", "reason"]` to `["agentId", "addedSkills", "removedSkills", "reason"]` so the delta-shape payload (decision below) passes the allow-list. This is a U3 amendment landing in U5 because there is no existing caller of `agent.skills_changed`; the registry shape was a placeholder.
- Test: `packages/api/src/__tests__/workspace-files-skills-audit.test.ts` *(new file)*

**Approach:**
- `deriveAgentSkills` does NOT accept a `tx` parameter today (signature is `(scope, agentId)` per `packages/api/src/lib/derive-agent-skills.ts:118-135`); do not invent one. Run `deriveAgentSkills(...)` exactly as today (preserves its own internal connection / writes), then — if `result.changed` — open a NEW tx that ONLY emits the audit row:
  ```
  const result = await deriveAgentSkills({ tenantId }, target.agentId);
  if (result.changed) {
    await db.transaction(async (tx) => {
      await emitAuditEvent(tx, { ..., eventType: 'agent.skills_changed', payload: { agentId: target.agentId, addedSkills: result.addedSlugs, removedSkills: result.removedSlugs, reason: 'workspace_skill_marker_change' }});
    });
  }
  ```
- This is **telemetry-tier semantics for `agent.skills_changed` specifically**: derive's writes already committed before the audit emit fires, so an emit failure does not roll back the skill-state change. This is acceptable because (a) `agent_skills` is derived state — the next derive run reconciles, and (b) the underlying SKILL.md write that triggered this derive is itself audited under `workspace.governance_file_edited` once SKILL.md is added to `isGovernanceFilePath` (see U5 below). For U5, log emit failures with structured fields so an operator dashboard catches drift; do not throw.
- **Payload shape: delta-only.** Emit `{agentId, addedSkills, removedSkills, reason}`. Don't read absolute current/previous skill lists — adds an extra round-trip and the delta is what an auditor cares about. The U3 allow-list update in the Files section above is the corresponding registry change.
- Actor: workspace-files handler has `tenantId` but `userId` is not always threaded; the existing handler resolves via `resolveCallerFromAuth(auth)` at line 875. Implementer threads the resolved userId through to the emit. If auth context is service-style (CLI / mobile), use `actorType: 'service'`, `actorId: 'workspace-files'`.
- Source: `'lambda'` (workspace-files runs as a Lambda handler, not a Yoga resolver).

**Patterns to follow:**
- `packages/api/workspace-files.ts:487-510` (existing derive call).
- `packages/api/src/lib/derive-agent-skills.ts:118-135` (DeriveResult shape).

**Test scenarios:**
- *Happy path:* PUT a SKILL.md that adds one skill → `agent_skills` row appears, outbox row with `event_type='agent.skills_changed'`, payload contains `addedSkills: ['<new-slug>']`.
- *Edge case:* PUT a SKILL.md that doesn't change the derived set (idempotent re-write) → no outbox row (because `result.changed === false`).
- *Edge case:* Absolute-vs-delta payload shape — verify chosen approach matches the redaction allow-list.
- *Error path:* derive throws → caller's existing 500 path runs, no audit row (because the throw happens before emit).

**Verification:** Integration test confirms outbox row only appears on actual changes.

---

- U5. **`workspace.governance_file_edited` (workspace-files PUT path)**

**Goal:** Emit `workspace.governance_file_edited` whenever a governance file (AGENTS.md / GUARDRAILS.md / CAPABILITIES.md / PLATFORM.md / MEMORY_GUIDE.md) is PUT to S3.

**Requirements:** R6, R10, R12, R15.

**Dependencies:** None.

**Files:**
- Modify: `packages/api/workspace-files.ts` — add `isGovernanceFilePath` helper + wrap S3 PutObjectCommand in `db.transaction(async (tx) => { await emitAuditEvent(tx, {...}); await s3.send(new PutObjectCommand(...)); })`.
- Test: `packages/api/src/__tests__/workspace-files-governance-audit.test.ts` *(new file)*

**Approach:**
- Add helper: `function isGovernanceFilePath(path: string): boolean` returning true for the full set of top-level governance/identity/capability files actually shipped in the workspace-defaults bundle. Implementer reads `packages/system-workspace/files/` (or current shipping path) and includes every top-level `*.md` whose semantics shape agent capability or behavior. Seed set is `["AGENTS.md","GUARDRAILS.md","CAPABILITIES.md","PLATFORM.md","MEMORY_GUIDE.md","USER.md"]` — expand on inspection. **Also include `SKILL.md`**: SKILL.md edits change effective agent capabilities (they trigger the U4 derive path) and an unaudited SKILL.md edit followed by a revert before the next derive cycle would let an attacker modify agent capabilities without a durable audit trail.
- In `handlePut` (line 472-479 + 518-525), gate the existing S3 put on the governance check: `if (isGovernanceFilePath(cleanPath)) { await db.transaction(async (tx) => { await emitAuditEvent(tx, {...}); await s3.send(new PutObjectCommand(...)); }); } else { await s3.send(new PutObjectCommand(...)); }`. Inside the tx: emit FIRST, S3 put SECOND, so emit failure prevents the S3 write entirely and S3 failure rolls back the audit row. Non-governance files (e.g., free-form notes, agent memory) intentionally bypass both the audit emit and the new tx — keeping U5 scope to governance evidence and avoiding a hot-path tx on every workspace write.
- Payload shape (matches U3 `governanceFileDiffTransform`): pass raw `{file: cleanPath, content, workspaceId: target.tenantSlug}` to `emitAuditEvent`. The U3 transform converts to `{file, content_sha256, preview, workspaceId}` automatically.
- Actor: `resolveCallerFromAuth(auth)` (existing pattern at line 875). Source: `'lambda'`.
- IMPORTANT — ordering inside the tx: emit FIRST, S3 put SECOND. Reasoning is in Key Technical Decisions. An emit failure prevents the S3 write entirely; an S3 failure rolls back the audit row.

**Patterns to follow:**
- `packages/api/workspace-files.ts:472-479` (existing S3 put).

**Test scenarios:**
- *Happy path (covers AE4):* PUT AGENTS.md with new content → S3 object appears, outbox row with `event_type='workspace.governance_file_edited'`, payload contains `{file: 'AGENTS.md', content_sha256: <sha>, preview: <first-2KB>, workspaceId: <tenant-slug>}`.
- *Edge case:* PUT a non-governance file (e.g., `notes.md`) → S3 put succeeds, NO outbox row.
- *Edge case:* PUT GUARDRAILS.md, CAPABILITIES.md, PLATFORM.md, MEMORY_GUIDE.md each → 4 outbox rows with correct `file` field.
- *Error path:* Force S3 put to fail (e.g., bad bucket) → audit row NOT in outbox (rolled back).
- *Edge case (large content):* PUT AGENTS.md with 50KB content → preview is truncated to 2KB, content_sha256 hashes the FULL content, no secret leak in preview boundary (verify via U3 governanceFileDiffTransform unit tests already covering the boundary case).

**Verification:** Integration test passes; manual PUT to dev tenant produces an outbox row.

---

- U6. **`mcp.added` + `mcp.removed` (REST handlers)**

**Goal:** Emit `mcp.added` / `mcp.removed` from `mcpCreateServer` / `mcpDeleteServer` in skills handler.

**Requirements:** R6, R10, R12.

**Dependencies:** None.

**Files:**
- Modify: `packages/api/src/handlers/skills.ts` (lines 2030, 2116 area).
- Test: `packages/api/src/handlers/__tests__/skills-mcp-audit.test.ts` *(new file)*

**Approach:**
- `mcpCreateServer` (line ~2030): wrap the existing `db.insert(tenantMcpServers)…returning(...)` in `db.transaction(async (tx) => { const [inserted] = await tx.insert(...)…; await emitAuditEvent(tx, {…, eventType: 'mcp.added', payload: {mcpId: inserted.id, url, scopes: []}}); return inserted; })`.
- `mcpDeleteServer` (line ~2116): wrap the existing two-step delete (agentMcpServers cleanup + tenantMcpServers delete) in a single tx, capture the deleted row's `url` via `.returning()` instead of a SELECT-before-delete, and emit:
  ```
  db.transaction(async (tx) => {
    await tx.delete(agentMcpServers)…;
    const [deleted] = await tx.delete(tenantMcpServers).where(...).returning({ id: tenantMcpServers.id, url: tenantMcpServers.url });
    if (deleted) await emitAuditEvent(tx, {…, eventType: 'mcp.removed', payload: {mcpId: deleted.id, url: deleted.url}});
    return deleted;
  });
  ```
- Actor: branch by auth path — `verdict.userId` non-null (Cognito-authenticated): `{actorType: 'user', actorId: verdict.userId}`; `verdict.userId` null (apikey path authenticated by `API_AUTH_SECRET`): `{actorType: 'service', actorId: 'platform-credential'}`. **Do not** read `event.headers["x-principal-id"]` for audit `actorId` (per Key Technical Decisions §Actor-type vocabulary — the header is an unverified self-assertion on the apikey path).
- Tenant: `tenantId` resolved at handler entry from `tenantSlug`.
- Source: `'lambda'`.
- Payload allow-list: `{mcpId, url, scopes}` for added; `{mcpId, url}` for removed. Both have `mcpUrlPreTransform` that strips userinfo.

**Patterns to follow:**
- `packages/api/src/handlers/skills.ts:2030-2055` (existing create).
- `packages/api/src/handlers/skills.ts:2103-2120` (existing delete).

**Test scenarios:**
- *Happy path:* POST `/mcp/servers` → tenantMcpServers row created, outbox row with `event_type='mcp.added'`.
- *Happy path:* DELETE `/mcp/servers/:id` → row deleted, outbox row with `event_type='mcp.removed'`.
- *Edge case (URL with userinfo):* POST `/mcp/servers` with `url: 'https://user:pass@example.com'` → outbox row's `payload.url` is `'https://example.com'` (userinfo stripped by U3 `mcpUrlPreTransform`).
- *Edge case (delete idempotency):* DELETE same `:id` twice → first call emits, second returns 404 with no second emit (because `deleted.length === 0` short-circuits).

**Verification:** Integration test passes against dev DB.

---

### Phase C — Cross-cutting test guarantees

- U7. **Cross-cutting tier + tenant integration tests**

**Goal:** One integration test for each cross-cutting concern that's hard to assert per-event-family.

**Requirements:** R6, R10, R11, R12.

**Dependencies:** U1, U2, U3, U4, U5, U6.

**Files:**
- Test: `packages/api/test/integration/compliance-event-writers/cross-cutting.integration.test.ts` *(new file)*

**Approach:**
- Three integration tests that exercise the cross-cutting properties without per-event-type duplication:
  1. **Tier rollback (control-evidence)**: Force-throw inside one of the wrapped resolvers' tx using a test-only sentinel (e.g., a magic agent name `__force_audit_failure__`). Assert: primary write absent + outbox row absent. This proves the tx atomicity at U2's createAgent path.
  2. **Tenant resolution (Google-federated)**: Mint a Google-federated test session with `ctx.auth.tenantId === null`. Run `createAgent`. Assert outbox row carries the correctly-resolved tenant_id from `resolveCallerTenantId(ctx)`, not null.
  3. **Allow-list drop**: Pass an agent name with extraneous fields beyond the allow-list (e.g., a SQL-injected payload string). Assert payload only contains allow-listed keys; `payload_redacted_fields` records the dropped keys.
  4. **Governance-file PUT pool-starvation smoke**: 10 concurrent PUTs of a 50KB AGENTS.md against the dev tenant. Assert no resolver in the same warm container is starved beyond p99 < 3s. Documents the U5-tx-wraps-S3 tradeoff with empirical data and surfaces regressions if pool sizing changes.
  5. **PostConfirmation user.created path**: Drive a PostConfirmation_ConfirmSignUp event fixture into the U1 handler; assert outbox row with `event_type='user.created'`, `payload.userId === sub`, `payload.email === email`. PostConfirmation_ConfirmForgotPassword events do NOT emit (they're credential resets, not user creation).
- These tests use the dev DB; they're integration tests, not unit tests with mocks.

**Test scenarios:**
- (covered above as the three explicit tests)

**Verification:** All three integration tests pass.

---

## System-Wide Impact

- **Interaction graph:** Every in-scope mutation/handler now writes through `db.transaction`. Existing transactional code is preserved; new transaction boundaries are introduced for previously-direct writes (`createAgent`, `createInvite`, MCP CRUD, governance-file PUT). No middleware, callback, or observer reorderings.
- **Error propagation:** Two error-propagation classes:
  - **Control-evidence (7 events):** `user.invited`, `agent.created`, `agent.deleted`, `mcp.added`, `mcp.removed`, `workspace.governance_file_edited` (and the deferred `data.export_initiated`). Audit-write failure rolls back the originating mutation through `db.transaction`.
  - **Telemetry tier (3 events):** `auth.signin.success` and `user.created` (Cognito synchronous triggers — must not fail the auth flow); `agent.skills_changed` (derive runs and commits before the wrapping audit tx fires; audit failure does not roll back skill state, but the underlying SKILL.md write is itself audited under `workspace.governance_file_edited` once SKILL.md is added to `isGovernanceFilePath`).
  - All telemetry-tier emits log structured failure events; CloudWatch alarms fire on emit-miss rate exceeding tenant-specific thresholds.
- **State lifecycle risks:** Two ordering concerns:
  - `workspace.governance_file_edited` — emit-before-S3-put leaves an audit row pointing at content that may not have landed if the tx commits before S3 succeeds. Solution: S3 put is INSIDE the tx callback so an S3 throw rolls back the audit row. Cost: pool connection held for the S3 round trip — see Risks table for the pool-starvation tradeoff and U7's load test.
  - `agent.skills_changed` — derive runs and commits BEFORE the wrapping audit tx fires. Audit failure does not roll back the skill state. The underlying SKILL.md write that triggered the derive is itself audited under `workspace.governance_file_edited` (SKILL.md is on the `isGovernanceFilePath` allow-list), so the original capability-changing edit is captured even if the post-derive `agent.skills_changed` emit drops.
- **API surface parity:** No GraphQL schema changes. The setAgentSkills mutation continues to log its deprecation; U5 doesn't accelerate retirement.
- **Integration coverage:** Phase C's three cross-cutting tests cover what per-event-type tests can't.
- **Unchanged invariants:** `activity_log` writers stay untouched (defer per origin master plan). `tenant_policy_events` writers stay untouched. Existing ctx.auth resolution stays unchanged. The U3 helper signature stays unchanged. The U4 drainer's chain-head ordering stays unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Cognito synchronous-trigger 5s timeout blocks sign-in flow if audit DB is slow | Lazy-init connection pool with 1.0s connection acquire cap + 1.0s INSERT cap (total 2.0s budget). Audit emit failure logs structured event + lets Cognito succeed — handler MUST NOT throw (telemetry tier per Key Technical Decisions). |
| Drizzle `db.transaction` semantics with the node-postgres driver | The driver checks out a dedicated client from the pool, runs `BEGIN`, runs the callback, then COMMITs on resolve / ROLLBACKs on throw — verified in production at `packages/api/src/graphql/resolvers/core/updateTenantPolicy.mutation.ts:73-100`. Mirror that pattern. |
| Wrapping S3 PutObjectCommand inside an open Drizzle tx pins a pool connection across an external network round-trip (50ms-2s typical, P99 worse for 50KB AGENTS.md). With the api Lambda's small pool, bursty editor saves can serialize PUTs and starve other resolvers in the same warm container. | U5's wrapping approach is the chosen tradeoff: rejecting reverse ordering (S3 first, audit second) prevents leaked-edit-without-audit-trail. Two compensating measures: (a) AGENTS.md / GUARDRAILS.md edits are low-frequency operator actions, not a hot path; expected p99 throughput is single-digit edits/minute per tenant. (b) U8's cross-cutting integration tests include a synthetic 10-concurrent-PUT load test against governance files to confirm pool exhaustion does not cascade. If the load test reveals starvation, fall back to a compensation-pattern variant: emit audit row first in a short tx, attempt S3 put, if S3 fails issue a compensating `workspace.governance_file_edit_failed` event in a follow-up tx. |
| New `auth-audit-trigger` Lambda's `auth_audit_lambda_zip` variable not threaded through all greenfield examples | U1 explicitly modifies `terraform/examples/greenfield/main.tf`. Build pipeline fails if zip variable references unbuilt artifact. |
| Allow-list mismatch silently drops payload fields (e.g., `mcp.added.scopes` array of strings vs. array of objects) | Each Phase B unit's integration test asserts the outbox row payload shape matches the U3 allow-list exactly. Mismatches fail CI. |
| `agent.skills_changed` payload allow-list change (`addedSkills`/`removedSkills` vs `skillIds`/`previousSkillIds`) is a U3 amendment landing in U5 | Safe to land in U5: the registry shape was a placeholder (`agent.skills_changed` had zero callers before this PR). The Files section of U4 explicitly lists `event-schemas.ts:175-181` as a modified file so reviewers see the registry change in the diff. |
| Cognito client-driven retry creates distinct audit rows for the same logical sign-in attempt | Accepted as correct evidence: each successful retry IS a real distinct sign-in (Cognito sync triggers do NOT auto-retry on Lambda failure; client-driven retries are user-visible re-attempts). No idempotency dedup in U5; Phase 4 follow-up may add one if auditor feedback demands. |
| Multi-tenant Cognito users (sub belongs to >1 tenant via the `users:tenants` many-to-many) → Cognito `custom:tenant_id` is single-valued, fallback users-table lookup may return >1 row | U1 specifies: prefer `custom:tenant_id` (Cognito-signed); on multi-row fallback, log a structured warning + emit one row per tenant the user belongs to. Document as known imperfection; clean fix lands when the Cognito pre-token tenant trigger guarantees `custom:tenant_id` is always set. |
| Tenant-resolution miss for Google-federated users emits no audit row → silent gap | U1 emits a CloudWatch custom metric `compliance.tenant_resolution_miss` per occurrence and includes a Terraform CloudWatch alarm in the U1 file list. Operator pages on metric > 0 in any 5-min window. |

---

## Documentation / Operational Notes

- After deploy, manual smoke check: sign in via Google OAuth on dev → `psql` query `SELECT * FROM compliance.audit_outbox ORDER BY enqueued_at DESC LIMIT 5;` should show an `auth.signin.success` row within 5s.
- Drainer dashboard (when U10 lands) should show outbox depth steady near zero and audit_events row count rising on real traffic.
- Update `docs/solutions/architecture-patterns/` with a one-page "U5 wire-up reference" listing the 9 in-scope event sites + their actor / source / tier mappings — author this after merge.

---

## Sources & References

- **Origin master plan:** `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md` §U5 (lines 416-453)
- **Origin requirements doc:** `docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md`
- **U1 schema:** `packages/database-pg/drizzle/0069_compliance_schema.sql`, `packages/database-pg/src/schema/compliance.ts`
- **U2 roles:** `packages/database-pg/drizzle/0070_compliance_aurora_roles.sql`, `terraform/modules/data/aurora-postgres/main.tf` (compliance writer/drainer/reader secrets)
- **U3 helper:** `packages/api/src/lib/compliance/emit.ts`, `packages/api/src/lib/compliance/event-schemas.ts`, `packages/api/src/lib/compliance/redaction.ts`
- **U4 drainer:** `packages/lambda/compliance-outbox-drainer.ts`
- **Pattern: in-tx audit emit:** `packages/api/src/graphql/resolvers/core/updateTenantPolicy.mutation.ts:73-100`
- **Pattern: actor resolution:** `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts:16-50, 80`
- **Pattern: Cognito Lambda template:** `packages/api/src/handlers/cognito-pre-signup.ts`, `terraform/modules/foundation/cognito/main.tf:9-85, 138-143`, `scripts/build-lambdas.sh:109-110`
- **External: AWS Cognito triggers** — https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools-working-with-aws-lambda-triggers.html
