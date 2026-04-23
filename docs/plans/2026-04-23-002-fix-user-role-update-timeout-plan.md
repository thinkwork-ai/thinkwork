---
title: "fix: Resolve user-role update timeout (issue #470)"
type: fix
status: active
date: 2026-04-23
origin: https://github.com/thinkwork-ai/thinkwork/issues/470
---

# fix: Resolve user-role update timeout (issue #470)

## Overview

Admin user reports that changing a user's role via the admin SPA (People → select user → change role) fails with a generic `ERROR HTTP_ERROR` toast. The request appears to time out rather than return a validation error. The screenshot in issue #470 also shows an AppSync "Attempting to reconnect" banner in the same session, which may be a parallel symptom or a hint at broader connectivity.

This plan (1) captures enough production evidence to pin the actual root cause, (2) closes the most likely gaps on the hot path regardless of which cause lands, and (3) installs observability so the same class of failure is no longer silent.

## Problem Frame

`updateTenantMember` is an always-on admin workflow. When it fails with an opaque "HTTP_ERROR" instead of a validation-coded toast, the operator cannot distinguish between "server refused" (e.g., permission), "server broke" (500/502), and "server timed out." The resolver itself is already tenant-pinned via `requireTenantAdmin(ctx, target.tenant_id, tx)` — so the known Google-federated `ctx.auth.tenantId === null` pitfall is not the direct trigger here (see `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`). That narrows the likely causes to:

1. **Network layer:** CORS preflight or API Gateway 5xx (request never reaches the Lambda), analogous to the shape documented in `docs/solutions/integration-issues/lambda-options-preflight-must-bypass-auth-2026-04-21.md`.
2. **Resolver-layer hang:** Lock contention on `SELECT … FOR UPDATE` against `tenantMembers` during the last-owner guard, or a Drizzle pool/connection stall on cold start, exceeding the 30 s Lambda timeout.
3. **UI swallowing a fast failure:** The resolver returns a GraphQL error quickly (e.g., `FORBIDDEN`, `NOT_FOUND`) but urql's network-layer error path surfaces the raw `error.message` without a known `extensions.code`, so `mapErrorToToast` falls through to a confusing message.

All three are worth hardening. The investigation step in Unit 1 picks which one is the **direct** root cause; Units 2–5 close the supporting gaps either way.

## Requirements Trace

- **R1.** Changing a user's role in admin (owner↔admin, admin↔member, and allowed demotion of a non-last owner) completes successfully for a tenant owner using Google OAuth, and the UI reflects the new role without manual refresh.
- **R2.** When the mutation fails, the operator sees a specific, actionable message — not a generic `ERROR HTTP_ERROR` — and the Role dropdown reverts to its previous value.
- **R3.** The backend logs expose the outcome, caller, tenant, target, and duration of every `updateTenantMember` call so operators can diagnose timeouts without re-instrumenting.
- **R4.** The underlying cause captured during the investigation in Unit 1 is fixed, with a regression test that fails on `main` before the fix and passes after.

## Scope Boundaries

- No schema changes to `TenantMember` / `UpdateTenantMemberInput` (keep role as `String`; no enum migration as part of this plan).
- No rework of the auth middleware, Cognito pre-token trigger, or `resolveCallerFromAuth` semantics.
- No change to tenant-admin authorization semantics; only their execution profile (fewer redundant lookups).
- No broader rewrite of the admin People/Humans routes.

### Deferred to Separate Tasks

- **Cognito pre-token trigger** to populate `custom:tenant_id` for Google-federated users: already tracked under `project_google_oauth_setup`; not a prerequisite for this fix because the resolver derives tenantId from `target.tenant_id`.
- **Structured urql error-formatter overhaul** across every mutation in admin: keep scoped to the People screen here; a global error-formatter refactor is a separate PR.
- **Promoting `role` to a GraphQL enum:** related but separable; pursue in a follow-up schema PR.

## Context & Research

### Relevant Code and Patterns

- Admin route: `apps/admin/src/routes/_authed/_tenant/humans/$humanId.tsx` (member lookup + render of the membership section).
- Role-change component: `apps/admin/src/components/humans/HumanMembershipSection.tsx:40-102` — `mapErrorToToast` currently only branches on `LAST_OWNER` / `FORBIDDEN`; any other error (including `error.networkError`) shows the raw `result.error.message`.
- Generated mutation hook: `apps/admin/src/lib/graphql-queries.ts:998-1010` — `UpdateTenantMemberMutation` uses urql's default behavior (no `requestPolicy: 'network-only'`, no optimistic response).
- GraphQL schema: `packages/database-pg/graphql/types/core.graphql:257` — `updateTenantMember(id, input): TenantMember`; `UpdateTenantMemberInput` at lines 169-174.
- Resolver: `packages/api/src/graphql/resolvers/core/updateTenantMember.mutation.ts:22-87` — single transaction, 2–4 DB reads plus 1 write; `FOR UPDATE` on the target row always, on owner siblings only during owner-demotion.
- Caller resolution: `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts:16-50` — for Google-federated users, does up to 2 SELECTs on `users` (by id, then by email).
- Authz helper: `packages/api/src/graphql/resolvers/core/authz.ts:65-90` — `requireTenantAdmin` performs a separate `resolveCallerUserId()` call (redundant with the resolver's own `resolveCaller`) plus its own `tenantMembers` lookup.
- Lambda timeout: `terraform/modules/app/lambda-api/handlers.tf:193` — `graphql-http` falls through to the 30 s default; memory 512 MB.

### Institutional Learnings

- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` — confirms the tenant-pin pattern already in use here; cross-check during review.
- `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md` — documents the `resolveCaller` contract relied on by this resolver.
- `docs/solutions/integration-issues/lambda-options-preflight-must-bypass-auth-2026-04-21.md` — same "admin mutation appears to hang with opaque DevTools output" shape; include a 30-second preflight check in the Unit 1 investigation.
- Auto-memory: `feedback_oauth_tenant_resolver` (use `resolveCallerTenantId(ctx)` fallback), `feedback_avoid_fire_and_forget_lambda_invokes`, `feedback_read_diagnostic_logs_literally` (codeLen-on-UUID incident) — honor during the investigation.

### External References

None gathered — the stack is well-patterned internally and the failure is localized to one mutation path.

## Key Technical Decisions

- **Investigate before narrowing the fix.** The UI symptom is ambiguous between three root-cause classes. We invest one short investigation unit that collects CloudWatch, X-Ray, and browser-network evidence, then select the single targeted fix whose contents are declared now and implemented after evidence lands.
- **Do the cheap hardening regardless.** UI error differentiation, resolver query-fanout reduction, and structured logging are low-risk wins whose value does not depend on which root cause the investigation confirms.
- **Keep `role` as String (no enum).** Migrating to a GraphQL enum is orthogonal; doing it here would widen this fix and require codegen churn across three consumers.
- **No Lambda timeout bump.** A 30 s timeout is already generous for a 4-query transaction; raising it hides real problems. Fix the queries/locks, not the ceiling.
- **No optimistic UI.** The select already flips eagerly and reverts on error; adding urql optimistic cache on top would complicate the LAST_OWNER path.

## Open Questions

### Resolved During Planning

- **Does the resolver call Cognito `AdminAddUserToGroup` / `AdminRemoveUserFromGroup`?** No. Role is DB-only in `tenantMembers`. Ruled out as a timeout source.
- **Is the Google-federated null-tenantId bug the cause?** No; the resolver derives tenant from `target.tenant_id`, not `ctx.auth.tenantId`.
- **Is the `FOR UPDATE` on owner siblings always taken?** No — only when demoting from `owner`. The always-taken lock is on the target row.

### Deferred to Implementation

- **Whether the AppSync reconnect banner is a symptom of the same underlying API Gateway / network issue** or an orthogonal subscription problem. Check during Unit 1; if orthogonal, file a separate issue rather than widening this plan.
- **Whether to retry on `networkError` at the urql layer** — deferred; Unit 2 first surfaces the real error so operators can distinguish real server unreachability from transient 5xx.

### Unit 1 findings — 2026-04-23

**Direct root cause: connection-acquisition timeout in the pg pool.** Not resolver-hang, not CORS, not UI-swallow.

Evidence:
- `graphql-http` Lambda over the last 30 days: **zero `Task timed out` entries** across 765,478 scanned records; Lambda `Errors` metric ~0 (1 single error on 2026-04-17 out of ~170 K weekly invocations). Runtime-level timeout is not firing.
- API Gateway `IntegrationLatency` p99.9 has spikes up to **30,004 ms on 2026-04-18** and **26,656 ms on 2026-04-21**, with ~700–7,000 5xx/day across the past week. The gap between "no Lambda errors" and "many 5xx at the edge" means requests are resolving slowly enough that API Gateway emits 5xx before the Lambda's own timeout fires.
- A Logs Insights pass for `@duration > 5000 ms` in the last 24 h surfaces a tight cluster of six invocations between 14:37–14:45 UTC on 2026-04-23 with durations 5015–5093 ms — each with only `START`/`END`/`REPORT` and **zero intermediate log lines**. A tight 5-second cluster with no handler output is the fingerprint of a blocking call failing at a 5-second client-side deadline, not a SQL query running slowly.
- `packages/database-pg/src/db.ts:79` hard-codes `connectionTimeoutMillis: 5_000` with `max: 1` and no `keepAlive`. When Aurora Serverless v2 reaps an idle server-side connection (its min_capacity is 0.5 ACU per `aws rds describe-db-clusters` — warm but small and scale-reactive), the cached pg socket is stale; the next `pool.connect()` call blocks for exactly the configured timeout before erroring with `timeout exceeded when trying to connect`. The error propagates to Yoga → 500 → API Gateway 5xx → urql `networkError` → admin UI `ERROR HTTP_ERROR`. This also explains the AppSync "Attempting to reconnect" banner visible in the issue screenshot: same stale-connection class, different transport.
- The `graphql-http` handler (`packages/api/src/handlers/graphql-http.ts`) delegates straight to `yoga.fetch` with no per-request logging. There is no way to identify *which* GraphQL operation failed from the log stream — every 5 s failure is anonymous. Unit 4's instrumentation is a prerequisite for future diagnosability; API Gateway access logs are currently disabled (`AccessLogSettings: null` on stage `$default`).
- 4xx volume is low and steady (12–500/day), inconsistent with a CORS preflight regression. API Gateway CORS is permissive (`AllowOrigins: ["*"]`, all relevant headers allowed).

Implication for Unit 5: fix connection lifecycle in the pg pool rather than resolver-side work. Unit 3 (resolver fold/lock tightening) remains useful hygiene but is no longer the direct fix.

## Implementation Units

- [x] **Unit 1: Capture production evidence of the timeout**

**Goal:** Collect the artifacts needed to identify which of the three root-cause classes triggered issue #470, and record the finding in the plan so subsequent units land the right fix.

**Requirements:** R4

**Dependencies:** None

**Files:**
- Modify: `docs/plans/2026-04-23-002-fix-user-role-update-timeout-plan.md` (append a "Unit 1 findings" section under Open Questions when done)

**Approach:**
- Reproduce the failure against the affected stage (dev/prod as available) while tailing `graphql-http` CloudWatch logs, filtered to `updateTenantMember`.
- Capture: request id, duration, whether the handler started, whether the transaction committed, and any thrown error.
- Check API Gateway access logs for the matching request id — if no `graphql-http` invocation, the request died at the edge (CORS / 4xx / 5xx) and Unit 5 should target that class.
- Capture the browser Network panel (request URL, status, response body, timing) and DevTools console for CORS/preflight messages.
- If X-Ray is enabled on `graphql-http`, pull the trace.

**Execution note:** Investigation only — no code. This is explicitly the "planning-time-unknowable, execution-time-discoverable" branch of this plan.

**Test scenarios:** Test expectation: none — this is a diagnostic unit. Completion is measured by the findings note.

**Verification:**
- A one-paragraph findings note is appended to this plan stating: "Direct root cause: `<network | resolver-hang | ui-swallow>`. Evidence: `<link to log stream / request id / browser HAR>`." Unit 5's scope is selected from that note.

---

- [x] **Unit 2: Admin SPA — differentiate network/5xx from GraphQL errors in the role toast**

**Goal:** When `updateTenantMember` fails, the operator sees a message that distinguishes "couldn't reach the server" from "server rejected the change," and the role dropdown always reverts on failure. Keep the change scoped to the People screen; no global error-formatter refactor.

**Requirements:** R2

**Dependencies:** None — can land in parallel with Unit 1.

**Files:**
- Modify: `apps/admin/src/components/humans/HumanMembershipSection.tsx`
- Test: `apps/admin/src/components/humans/HumanMembershipSection.test.tsx` (create if missing)

**Approach:**
- Expand `mapErrorToToast` to branch on `result.error.networkError` (surface a "Couldn't reach the server — try again" message) vs `result.error.graphQLErrors` (use the existing coded-error branch; fall back to the first `graphQLError.message` when no code matches).
- Apply the same differentiation to the `removeMember` error path to avoid drift.
- Ensure role reverts to `currentRole` in both error branches (already does on the error path; verify for `networkError`).
- Consider capturing the urql request operation key in the toast (dev-only) to make future bug reports actionable — gated behind `import.meta.env.DEV`.

**Patterns to follow:**
- Other admin forms that already handle urql's `networkError` / `graphQLErrors` split (scan `apps/admin/src/components/**/*.tsx` before inventing a new shape).

**Test scenarios:**
- Happy path: successful mutation → success toast, no revert, dropdown reflects new role.
- Error path (coded): resolver returns `LAST_OWNER` / `FORBIDDEN` → matching specific toast, role reverts.
- Error path (uncoded GraphQLError): resolver returns a GraphQL error with no `extensions.code` → toast shows the server `message`, not "HTTP_ERROR."
- Error path (networkError): mutation rejects with `networkError` → toast reads as "couldn't reach the server" and role reverts.
- Self-edit guard: controls are disabled when `isSelf` is true (regression).

**Verification:**
- Reproducing issue #470's HTTP timeout shape surfaces a network-specific toast in dev, not `ERROR HTTP_ERROR`.

---

- [ ] **Unit 3: Resolver — fold redundant caller lookups and tighten the owner-demotion lock window** *(deferred to follow-up PR — hygiene refactor unrelated to #470's root cause; keeping the bug-fix PR focused)*

**Goal:** Reduce the `updateTenantMember` transaction's DB fan-out and shrink the owner-row lock window so a cold Lambda under load cannot realistically reach the 30 s timeout.

**Requirements:** R1, R4 (partial — see Unit 5 for the targeted fix)

**Dependencies:** Unit 1 (so we don't overfit) — OK to start in a worktree while Unit 1 runs.

**Files:**
- Modify: `packages/api/src/graphql/resolvers/core/updateTenantMember.mutation.ts`
- Modify: `packages/api/src/graphql/resolvers/core/authz.ts` (optional: accept a pre-resolved `callerUserId` to avoid the second `resolveCallerUserId` round-trip)
- Test: `packages/api/test/integration/updateTenantMember.integration.test.ts` (create if absent; follow the existing `packages/api/test/integration/**` pattern)

**Approach:**
- Pass the already-resolved `callerUserId` from `resolveCaller(ctx)` into `requireTenantAdmin` (via an overloaded signature or a helper) so the authz step does not repeat the users lookup.
- Leave the tenant-pin semantics of `requireTenantAdmin` unchanged; this is a performance fold, not an authz change.
- Keep the target-row `FOR UPDATE` — it's the correct primitive for serializing the self-guard and the update.
- Leave the owner-sibling `FOR UPDATE` conditional on actual owner demotion (already the case). Consider replacing it with a `COUNT(*)` under the same lock scope so we don't hydrate every owner row when the tenant has many owners (for the 4 × 100+ agents × ~5 templates scale from `project_enterprise_onboarding_scale`, the owner list is still small, but the pattern generalizes).
- Add a short-circuit: if `args.input.role` and `args.input.status` are both `undefined`, return the current row without the write (already effectively the case; make it explicit so we don't commit a no-op transaction).

**Execution note:** Test-first — add the integration test covering happy-path, FORBIDDEN (caller not admin of target tenant), LAST_OWNER, and self-edit-refused before touching the resolver.

**Patterns to follow:**
- Other admin mutations that were tenant-pinned in `f820adc` (PR #398) for a working example of `requireTenantAdmin` usage.
- Existing Drizzle transaction usage in `packages/api/src/graphql/resolvers/core/*.mutation.ts`.

**Test scenarios:**
- Happy path: admin demotes admin → admin (no-owner guard taken), member sees new role.
- Happy path: owner demotes another owner when ≥2 owners remain → success.
- Edge case: owner demotes the only remaining owner → `LAST_OWNER` GraphQL error, no write.
- Edge case: no-op update (empty input) → resolver returns current row without writing `updated_at`.
- Error path: non-admin caller attempts update → `FORBIDDEN`, no write.
- Error path: caller updates their own membership → `FORBIDDEN`.
- Integration: concurrent updates on two different members of the same tenant do not deadlock (run two updates under `Promise.all`).

**Verification:**
- The DB query count in the happy-path integration test is 3 (target SELECT + authz tenantMembers SELECT + UPDATE), not 5+.
- All listed test scenarios pass locally and in CI.

---

- [x] **Unit 4: Instrumentation — structured logging for GraphQL requests** *(shipped at the `graphql-http` handler layer rather than per-resolver — one JSON log line per request covers the full GraphQL surface and is what would have caught #470 on first occurrence.)*

**Goal:** Emit one structured log line per invocation with enough context to diagnose the next timeout without code changes, and one CloudWatch metric capturing resolver duration.

**Requirements:** R3

**Dependencies:** None.

**Files:**
- Modify: `packages/api/src/graphql/resolvers/core/updateTenantMember.mutation.ts`
- Modify: `packages/api/src/lib/logger.ts` (or the equivalent existing logging helper — confirm during implementation)
- Test: `packages/api/test/integration/updateTenantMember.integration.test.ts` (extend Unit 3's test with a log-capture assertion)

**Approach:**
- Wrap the resolver body in a timing boundary; emit one structured log (`level=info` on success, `level=warn` on known-coded errors, `level=error` on unknown) with `{ mutation, tenantId, callerUserId, targetMemberId, prevRole, nextRole, durationMs, outcome }`.
- Redact nothing beyond what `resolveCaller` already returns — no PII beyond what is already logged elsewhere on this handler.
- Emit a CloudWatch EMF metric `thinkwork.api.updateTenantMember.duration_ms` (or follow whatever convention the existing handler uses; check for prior examples before inventing a new namespace).

**Patterns to follow:**
- Other resolvers that log structured outcomes — grep `packages/api/src/graphql/resolvers/**/*.ts` for `logger.info(` usage.

**Test scenarios:**
- Happy path: a single log line is emitted with `outcome: "success"` and `durationMs >= 0`.
- Coded-error path: log line carries `outcome: "LAST_OWNER" | "FORBIDDEN"` (depending on case) at `warn` level.
- Unknown-error path: log line at `error` level, `outcome: "UNHANDLED"`.

**Verification:**
- Running the Unit 3 integration test shows the expected log shape captured via the existing log helper's test hook.

---

- [x] **Unit 5: Fix pg pool connection lifecycle (targeted root-cause fix)**

**Goal:** Eliminate the 5-second connection-acquisition failures by making the pg pool resilient to stale server-side connections, so admin users no longer see opaque `HTTP_ERROR` toasts when Aurora reaps an idle connection or a Lambda container is revived after sitting cold.

**Requirements:** R1, R4

**Dependencies:** Unit 1 findings (landed 2026-04-23).

**Files:**
- Modify: `packages/database-pg/src/db.ts` (pg Pool options + post-connect health wiring)
- Test: `packages/database-pg/test/db-pool.test.ts` (create — unit-level, asserts pool options; no live DB required)
- Optional: `packages/api/src/handlers/graphql-http.ts` (surface a specific HTTP status / GraphQL extension when a connection error occurs, so the UI change from Unit 2 can render it)

**Approach:**
- In `createDb`, enable TCP keepalive so idle connections don't get silently reaped by the server: pass `keepAlive: true` and `keepAliveInitialDelayMillis: 10_000` to the pool config.
- Bump `max` from 1 to 2 so a single in-flight transaction cannot starve a sibling request on the same warm container (Node Lambda is single-concurrency per container today, but the pool is also used by non-Lambda code paths and by any internal parallelism Yoga introduces). Re-evaluate with concrete log data before increasing further.
- On pool-level connection errors, evict the bad client and mark `_db` undefined so the next request creates a fresh pool rather than retrying against a dead one. Listen on `pool.on('error', ...)` and call `pool.end().catch(() => {})` + reset the module-level singletons.
- In the Drizzle transaction wrapper used by resolvers (or at `createDb` boot), run a one-shot `SET statement_timeout = '25s'` so individual SQL statements fail just before API Gateway's 30 s integration timeout — turning silent 5xx into surfaced query errors.
- In `graphql-http.ts`, catch connection-class errors thrown by Yoga execution and respond with a `503` plus a GraphQL error with `extensions.code: "SERVICE_UNAVAILABLE"` (or the closest existing coded error). This gives Unit 2 a specific code to render, instead of the current `HTTP_ERROR` fallthrough.

**Execution note:** Add the db-pool option test first and let it fail before touching `db.ts`. For the `graphql-http.ts` change, keep the catch narrow — only translate known pg connection-class errors, never Yoga validation errors.

**Patterns to follow:**
- Other pg-client bootstrapping in `packages/api/src/**` (grep for `new Pool`) to avoid divergent lifetime semantics.
- Existing Yoga error formatter wiring in `packages/api/src/graphql/server.ts`.

**Test scenarios:**
- Happy path: `createDb` returns a Drizzle client whose underlying Pool exposes `keepAlive === true`, `max === 2`, and `connectionTimeoutMillis === 5_000`.
- Edge case: `pool.on('error')` handler clears `_db`/`_pool`; the next `getDb()` call creates a fresh pool rather than reusing the corrupted one.
- Error path: a connection error from the pg layer is translated to a `503` with `extensions.code: "SERVICE_UNAVAILABLE"` at the HTTP handler, not a silent 500.
- Integration: with Unit 3's tests in place, a happy-path `updateTenantMember` still completes with the new pool settings.

**Verification:**
- Manual reproduction of issue #470 on `dev` (stop + restart admin tab, wait >5 min, change role) succeeds on the first try, or fails with a specific "couldn't reach the server" toast from Unit 2.
- In CloudWatch over the first 24 h after deploy, the cluster of `~5000 ms` REPORTs disappears from the `graphql-http` log group. Track via a saved Logs Insights query included in the PR description.

## System-Wide Impact

- **Interaction graph:** `updateTenantMember` is consumed only by `HumanMembershipSection` on the admin `humans/$humanId` route today. Grep `apps/mobile/` and `packages/api/` before landing to confirm no other caller.
- **Error propagation:** The UI changes in Unit 2 change how errors surface but not the shape of the GraphQL response; no impact on AppSync subscriptions or the mobile client.
- **State lifecycle risks:** None new. The target row is still locked for the transaction; the update remains a single row write.
- **API surface parity:** Other admin mutations that are tenant-pinned follow the same `requireTenantAdmin` path. Unit 3's authz fold is isolated to `updateTenantMember` to keep blast radius small; if it proves a win we can extend the pattern in a follow-up PR.
- **Integration coverage:** Unit 3's integration test is the first coverage for this resolver; it also doubles as the scaffold for future `tenantMembers` mutation tests.
- **Unchanged invariants:** The GraphQL schema for `updateTenantMember`, the `UpdateTenantMemberInput` shape, and the LAST_OWNER / FORBIDDEN error codes are preserved; the Cognito group state is still not read or written from this path.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Unit 1 cannot reproduce the timeout on demand. | Keep Unit 2, 3, 4 as the always-applicable hardening floor; Unit 5 becomes a defensive `statement_timeout` + structured-log assertion rather than a targeted fix. Flag the residual risk in the PR description. |
| Folding caller resolution into `requireTenantAdmin` inadvertently widens who counts as an admin. | Unit 3's integration tests pin `FORBIDDEN` behavior before the refactor and must still pass after. |
| Reducing log verbosity hides a subtler bug. | Unit 4 increases logging, not decreases; the single-line-per-invocation contract is additive. |
| The "AppSync reconnect" banner in the screenshot turns out to be a separate infra issue. | Call it out in Unit 1 findings; if orthogonal, file a new issue rather than expanding this plan. |

## Documentation / Operational Notes

- After Unit 1 lands findings, publish a short learning under `docs/solutions/integration-issues/` describing the root-cause pattern — especially if it turns out to be a CORS/preflight relapse (would add a sibling to the existing `lambda-options-preflight-must-bypass-auth` doc).
- No customer-facing docs change; this is an admin-only workflow.
- No migration, no feature flag, no rollout staging — ship through the normal PR pipeline to `main` (per `feedback_graphql_deploy_via_pr`).

## Sources & References

- Issue: https://github.com/thinkwork-ai/thinkwork/issues/470
- Resolver: `packages/api/src/graphql/resolvers/core/updateTenantMember.mutation.ts:22-87`
- Admin component: `apps/admin/src/components/humans/HumanMembershipSection.tsx:40-102`
- Caller resolution: `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts:16-50`
- Authz helper: `packages/api/src/graphql/resolvers/core/authz.ts:65-90`
- Schema: `packages/database-pg/graphql/types/core.graphql:169-257`
- Lambda timeout: `terraform/modules/app/lambda-api/handlers.tf:193`
- Learnings: `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`, `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md`, `docs/solutions/integration-issues/lambda-options-preflight-must-bypass-auth-2026-04-21.md`
- Prior PR for tenant-pin sweep: #398 (`f820adc`)
