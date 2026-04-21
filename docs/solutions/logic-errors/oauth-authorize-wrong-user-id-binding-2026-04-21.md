---
module: packages/api/src/handlers/oauth-authorize.ts
date: 2026-04-21
problem_type: logic_error
category: logic-errors
component: authentication
severity: high
symptoms:
  - "Mobile 'Connect' tile stuck in unconnected state despite OAuth token exchange succeeding and DB row landing in 'active' state"
  - "GET /api/connections returned zero rows for the signed-in user even though an active connection existed in the tenant"
  - "Per-user OAuth connection bound to a different user_id than the caller (e.g., eric@thinkwork.ai's Connect attempt landed on scotthertel@me.com)"
  - "Diagnostic log '[useConnections] fetched 0 rows for user=<prefix>' revealed DB had the connection under a different user UUID than the mobile client was filtering by"
root_cause: scope_issue
resolution_type: code_fix
related_components:
  - database
  - service_object
tags:
  - oauth
  - multi-user-tenant
  - user-resolution
  - drizzle
  - rest-api
  - authentication
  - connections
  - silent-failure
---

# oauth-authorize bound OAuth connections to the wrong user in multi-user tenants

## Problem

`packages/api/src/handlers/oauth-authorize.ts` silently bound per-user OAuth connections to the wrong `user_id` in multi-user tenants. The handler resolved the caller's user by running `SELECT users WHERE tenant_id = ? LIMIT 1` with no per-user predicate and no `ORDER BY`, so in any tenant with more than one user Postgres returned an arbitrary row. Eric tapped Connect from `eric@thinkwork.ai`, OAuth succeeded end-to-end, and the connection row landed with `user_id` bound to `scotthertel@me.com` — a different user in the same tenant. The mobile `Connect` tile stayed on "Connect" forever because the UI filtered `/api/connections` by the signed-in user's id and got zero rows back.

## Symptoms

- User taps **Connect** on an integration tile. Google OAuth consent completes successfully.
- `connections` row created with `status='active'`, correct `external_id=ericodom37@gmail.com`, valid tokens in Secrets Manager.
- Lambda logs show clean token exchange: `[oauth-callback] Token exchange succeeded`, `Connection <id> activated`.
- Mobile UI **never flips off "Connect"** — stays on the unconnected state indefinitely.
- Pull-to-refresh does not help.
- Mobile diagnostic log shows `[useConnections] fetched 1 rows for user=4dee701a tenant=0015953e; statuses=inactive` — the signed-in user sees zero Google rows despite successful OAuth.
- DB inspection: the new Google connection row has `user_id=1418d468...` (scotthertel@me.com) instead of `user_id=4dee701a...` (eric@thinkwork.ai, the actual signed-in user who tapped Connect).

## What Didn't Work

1. **Mobile-side refetch race theory.** First assumed `useConnections` was stale after the OAuth return; advised pull-to-refresh. Failed because the row simply was not fetchable under the signed-in user's id — no amount of refetching could surface a row persisted under a different user.
2. **Server-side token-exchange audit.** Checked Lambda logs and DB row; both looked "correct" in isolation (active status, valid `external_id`, successful token exchange). Failed because the bug was not in token exchange — it was one step earlier, in the user-resolution query that chose which `user_id` to persist.
3. **Mobile cache hook inspection.** Read `useConnections.ts` looking for a cache-invalidation bug. Failed because the hook was behaving correctly; it was filtering by `users.id` as designed, and the server had written the row under a different `users.id`.
4. **Diagnostic log at the mobile fetch boundary (the step that finally worked).** Added `[useConnections] fetched ${data.length} rows for user=${userId.slice(0,8)}...`. That log surfaced the mismatch (`user=4dee701a` returning zero Google rows) and redirected the investigation to server-side resolution. Without this log we kept chasing the UI-cache theory — the lesson is to read diagnostic output literally and generate cheap row-count signals at data-fetch boundaries before debugging downstream (auto memory [claude]: `feedback_read_diagnostic_logs_literally`).

## Solution

**Before** (`packages/api/src/handlers/oauth-authorize.ts:127-139`):

```ts
let resolvedUserId = userId;
try {
  const [dbUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.tenant_id, tenantId))   // ← tenant-only, no user filter, no ORDER BY
    .limit(1);
  if (dbUser) resolvedUserId = dbUser.id;
} catch (err) {
  console.warn(`[oauth-authorize] Failed to resolve user, using provided userId:`, err);
}
```

**After**:

```ts
import { eq, and } from "drizzle-orm";  // added `and`

// Mobile/admin UI passes meUser.id (already users.id from the `me` GraphQL
// resolver), so the direct match is the common case. Fall back to tenant-only
// lookup only for legacy callers that pass a raw Cognito sub without a
// matching users row.
let resolvedUserId = userId;
try {
  const [dbUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenant_id, tenantId), eq(users.id, userId)))
    .limit(1);
  if (dbUser) {
    resolvedUserId = dbUser.id;
  } else {
    // Legacy fallback — deterministic (earliest-created), not arbitrary.
    const [fallbackUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.tenant_id, tenantId))
      .orderBy(users.created_at)
      .limit(1);
    if (fallbackUser) {
      console.warn(
        `[oauth-authorize] userId=${userId.slice(0,8)} not a users.id in tenant; ` +
        `falling back to first user ${fallbackUser.id.slice(0,8)}`
      );
      resolvedUserId = fallbackUser.id;
    }
  }
} catch (err) {
  console.warn(`[oauth-authorize] Failed to resolve user, using provided userId:`, err);
}
```

Shipped in PR #342 (merged `c7698f3c96bc402cf717ee8258a816bad3f7c8f5` on 2026-04-21).

## Why This Works

- **Root cause:** the original query had no per-user predicate and no ordering, so in a multi-user tenant Postgres returned any row satisfying `tenant_id = ?`. Single-user tenants hid the bug for weeks — the handler had this shape since commit `41c712d` (2026-04-10 Phase 4 API migration), ported from a single-user-tenant context (session history).
- **Correct contract confirmed empirically:** mobile passes `meUser.id`, which is already `users.id`. The GraphQL `me` resolver at `packages/api/src/graphql/resolvers/core/me.query.ts` resolves the Cognito sub (or email, for Google-federated users whose sub ≠ `users.id`) to a `users.id` before returning the user object. The stale code comment claiming *"UI passes the Cognito sub"* was out of date.
- **New query** `users.id = userId AND tenant_id = tenantId` either matches the exact caller or returns empty — no more arbitrary-row selection.
- **Fallback is deterministic** (`ORDER BY created_at LIMIT 1`) and emits a warning log, so any lingering legacy caller still works but surfaces in CloudWatch for follow-up instead of silently corrupting ownership.
- **Matches an established pattern already in the codebase** — the GraphQL side solved this shape via `resolveCaller` in `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts` (users.id match → email fallback → fail closed). This fix brings the REST handler in line.

## Prevention

- **Pattern: mirror `resolveCaller` for REST.** When a REST endpoint accepts a `userId` from the UI, follow the GraphQL `resolveCaller` helper in `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts`: match `users.id = ?` first, fall back to Cognito email when available, and fail closed if nothing matches. Do not fall back by picking an arbitrary tenant row.
- **Lint/review rule:** Any `SELECT ... WHERE tenant_id = ? LIMIT 1` **without** an `ORDER BY` **and without** a per-user predicate is a bug. If the code legitimately means "the tenant's first user," make that explicit with `ORDER BY created_at LIMIT 1` and emit a warning log so the fallback path is observable.
- **Code-comment hygiene:** don't trust stale comments about wire format. Verify contracts empirically by curl-ing the live endpoint or tracing the actual field written by the caller (auto memory [claude]: `feedback_verify_wire_format_empirically`).
- **Diagnostic-log boundary:** keep a cheap log at every hook/data-fetch boundary that prints row count, the user id being filtered on, and the status set it saw. This single log line turned this from a multi-hour investigation into an obvious server-side mismatch. It was added during investigation in `apps/mobile/lib/hooks/use-connections.ts`; re-introduce a similar signal in other data hooks that feel fragile.
- **Migration-era artifact risk:** code ported during framework migrations often carries assumptions from the old context (in this case, single-user tenants). When reviewing migration diffs, grep for `LIMIT 1` without `ORDER BY` as a red flag (session history: the bug was present since the Phase 4 API migration on 2026-04-10 and went undetected through two prior OAuth-related PRs in the same investigation).
- **Audit similar handlers:** this bug pattern (tenant-only resolution + `LIMIT 1` + no `ORDER BY`) may exist elsewhere. Candidates to audit: any REST handler that writes a row with a `user_id` FK based on a request parameter. The GraphQL side already uses `resolveCaller` and is not affected.

## Related

- **Plan doc (this fix's origin):** [`docs/plans/2026-04-21-006-fix-oauth-integrations-credentials-locker-plan.md`](../../plans/2026-04-21-006-fix-oauth-integrations-credentials-locker-plan.md)
- **Canonical pattern (GraphQL side):** `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts` — the `resolveCaller` helper already implements the right shape: `users.id` match first, email fallback, fail closed.
- **Related best-practice:** [`docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md`](../best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md) — this doc mirrors `resolveCaller`'s **user-resolution shape** in a REST handler (users.id match → email fallback → fail closed). A separate question is whether to widen `resolveCaller`'s **accepted auth types** (e.g., apikey) so service identities can drive the same mutations; the answer there is no — stand up a narrow REST endpoint instead. Shape reuse: good. Auth-type widening: bad. Different axes, compatible recommendations.
- **Related memory:** `feedback_oauth_tenant_resolver` — tenantId-null-for-Google-federated-users (PR #239 fixed a structurally identical pattern in GraphQL `mobileWikiSearch` / `recentWikiPages` resolvers). Both bugs stem from assuming Cognito claims carry complete user identity for Google-federated users, when they don't. The REST side of this pair had not been fixed until now.
- **Operational note:** fixing the authorize path clears **new** connections. Any wrongly-bound active rows already in the DB persist through token refresh as well (refresh uses the existing row's `user_id`). When deploying this fix to an environment with existing per-user OAuth traffic, audit the `connections` table for rows whose `user_id` doesn't match the owning user's recent sign-in pattern and purge them so users can reconnect cleanly.
