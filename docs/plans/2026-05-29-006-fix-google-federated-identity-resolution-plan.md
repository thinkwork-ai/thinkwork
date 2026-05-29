---
title: "fix: Resolve Google-federated identity by stable Cognito sub"
type: fix
status: completed
date: 2026-05-29
deepened: 2026-05-29
origin: docs/brainstorms/2026-05-29-google-federated-identity-resolution-requirements.md
---

# fix: Resolve Google-federated identity by stable Cognito sub

## Summary

Google-federated Cognito users are linked to their `users` row only by the ID-token `email` claim. When a refreshed federated token drops `email`, identity resolves to `null` and every identity-requiring write (`sendMessage`, `createThread`, mark-read) breaks. This plan persists the always-present Cognito `sub` on the `users` row and resolves callers by it. The sub is captured at two moments: **at user creation** (`bootstrapUser`, where `email` is guaranteed present) so new users are linked immediately, and **opportunistically** when an existing user resolves via a fallback path on a token that still carries `email`. Because tenant id is derived from the resolved row, this closes the `tenant_id`-is-null gap for Google users in the same change. Server-side only — no Cognito or Terraform change.

**Honest heal boundary** (sharpened in doc review): a token that *lacks* `email` cannot heal itself — step 1 (by-sub) misses for an unhealed user, and the email fallback that would capture the sub is exactly what the broken token defeats. So an existing Google user whose tokens are *currently* email-less stays broken on identity-critical writes until either (a) one email-bearing token arrives (a fresh sign-in / full refresh) and heals the row, or (b) the deferred one-time backfill job runs. New users created after this ships are healed at creation and never depend on the email path. This plan narrows the broken population to "pre-existing Google users who have not yet presented an email-bearing token since deploy"; it does not claim to fix a perpetually-email-less live token in place.

---

## Problem Frame

`resolveCallerFromAuth` (`packages/api/src/graphql/resolvers/core/resolve-auth-user.ts`) resolves a Cognito caller by `users.id == principalId` (the `sub`). Native users have `users.id == sub`, so they hit. Google-federated users get a fresh-UUID `users.id ≠ sub`, so the by-id lookup misses and the code falls back to `users.email == auth.email`. The verifier (`packages/api/src/lib/cognito-auth.ts:112`) sets `email = (payload as any).email || null` — and federated refresh tokens can drop mapped attributes, leaving `email` null. Null email + by-id miss ⇒ `userId: null`, `tenantId: null`.

PR #1837 already fail-softed the *best-effort* mark-read so it stops surfacing a blocking "Requester user identity required" error. This is the durable fix for the underlying fragility: identity must resolve from a stable signal.

The fix turns on one fact verified against the code: the Cognito `sub` (`payload.sub` → `auth.principalId`) is always present and stable in a verified ID token (`cognito-auth.ts:110`), but `users` has no column storing it. Adding that column, writing it at creation, and resolving by it makes the stable signal the primary path.

---

## Requirements

Carried from origin (`docs/brainstorms/2026-05-29-google-federated-identity-resolution-requirements.md`). R8–R9 are **plan-introduced** from doc-review findings and noted as such.

- **R1 — Stable sub link.** Persist the Cognito `sub` on `users` so a caller resolves by `sub` regardless of how `users.id` was minted. → U1
- **R2 — Resolution order.** Resolve by stored `sub` first, then existing fallbacks, then null. → U2 (refined to a 4-step order; see KTD-1)
- **R3 — Opportunistic backfill (self-healing).** When resolution falls through to a fallback path and succeeds against a row with a null `cognito_sub` on a token that carries the data needed to bind safely, write the caller's `sub` so the next request resolves by `sub`. → U2
- **R4 — Tenant id rides along.** Tenant id continues to come from the resolved row; reliable user resolution ⇒ reliable tenant resolution. Confirm the gap closes (no separate mechanism). → U2, U4, U5
- **R5 — Email stays as last-resort.** Keep the email fallback for not-yet-healed users; do not remove it. → U2, U5
- **R6 — Failure posture unchanged.** When no path resolves a user, identity is still null; identity-critical writes still fail loudly, best-effort writes still fail soft (#1837). This change narrows null, it does not eliminate it. → U2, U5
- **R7 — Native users unaffected.** Native Cognito users (`users.id == sub`) must resolve exactly as today. → U2 (the `byId` step is retained), U5
- **R8 — (plan-introduced) Capture sub at creation.** Write `cognito_sub` when the `users` row is created, where `email` is already required and present, so new users never depend on the heal path. → U3
- **R9 — (plan-introduced) `me` query parity.** The `me` query must resolve identity through the same stable-sub path, so a healed user with an email-less token is not reported as signed-out. → U4

---

## Key Technical Decisions

### KTD-1 — Resolution order is 4-step, retaining the native `byId` lookup

The brainstorm framed the order as "by-sub → by-email → null." The code shows that would regress native users: native rows resolve via `users.id == sub` and carry **no** stored `cognito_sub`, so a native user whose token lost `email` would miss by-sub, miss by-email, and resolve null — a new failure that doesn't exist today. The retained order is:

1. **by `cognito_sub == principalId`** — healed/created-linked users (the reliable primary path).
2. **by `id == principalId`** — native users, exactly as today (R7).
3. **by `email == auth.email`** — not-yet-healed Google users (R5), gated per KTD-5.
4. **null** — failure posture unchanged (R6).

Backfill (KTD-2) fires on a hit from step 2 or step 3 when the resolved row's `cognito_sub` is null.

### KTD-2 — Opportunistic backfill, with a load-bearing null guard

Whenever resolution succeeds against a row whose `cognito_sub` is null, write `cognito_sub = principalId`. The UPDATE's `WHERE id = :userId AND cognito_sub IS NULL` clause is **non-optional and load-bearing** (not "directional"): it makes the write idempotent, makes concurrent same-user first-requests safe (the loser updates 0 rows and is a clean no-op — *not* a constraint conflict, because both racers write the identical sub to the identical row), and prevents overwriting an already-set sub. Both racers return the correct identity from the row already in hand regardless of UPDATE outcome.

Backfill is best-effort and must never change resolved identity or block the request on failure. Error handling distinguishes:
- **Unique-constraint violation (Postgres `23505`)** — a *different* sub already owns this row's `cognito_sub`, i.e. the A2 one-sub-one-row invariant is contended. Log at `console.error` with both `principalId` and `userId` so ops can audit a duplicate-sub/recycled-email case. Return the resolved identity (do not null out).
- **Transient errors** — `console.warn`, return resolved identity.

**Step-2 (by-id) backfill invariant:** a by-id hit means `users.id == sub`, which is only true for native rows whose id was *minted from* the sub — so writing `cognito_sub = id = sub` is tautological, never a foreign value. (The theoretical 122-bit UUID-namespace collision where a Google row's random `id` equals another user's sub is acknowledged and out of scope; the unique index would surface the resulting step-1 conflict via the `23505` path above.)

### KTD-3 — Hand-rolled SQL migration with `-- creates-column` markers (corrected)

**The Drizzle journal is frozen** (`drizzle/meta/_journal.json` last tag `0020_crazy_the_anarchist`) while `drizzle/` holds 167 files numbered to `0137`. `pnpm db:push` runs `drizzle-kit push --force` (`scripts/db-push.sh:82`) — it **introspects the live DB and force-applies the schema diff; it does not replay journal migrations.** Every recent migration, including purely additive `ADD COLUMN` ones (e.g. `0124_thread_turns_finalized_at.sql` → `-- creates-column: public.thread_turns.finalized_at`), is hand-rolled with an `Apply manually: psql` header and `-- creates:` / `-- creates-column:` markers, and `pnpm db:migrate-manual` gates those markers in **both** `.github/workflows/migration-precheck.yml` (PR check) and `deploy.yml` (post-`terraform-apply` gate). A column shipped without the marker bypasses the drift gate — exactly the failure class the gate exists to catch.

Therefore: edit the Drizzle schema in `core.ts` (so `drizzle-kit push --force` applies it to dev and introspection stays consistent) **and** hand-author `drizzle/0138_users_cognito_sub.sql` with the `Apply manually` header + `-- creates-column:`/`-- creates:` markers, applied via `psql` and verified by `db:migrate-manual`. Do **not** rely on the journal or claim `db:push` replays it.

### KTD-4 — No GraphQL surface change

`cognito_sub` is an internal identity-resolution detail. It is not exposed on the `User` GraphQL type, so no `*.graphql` edit and no `codegen` run in any consumer.

### KTD-5 — Gate the *email-path backfill* on `email_verified`

The email fallback creates a **new, permanent** sub↔row binding that did not exist before this change. Binding on an unverified or recycled email is an identity-takeover surface: an attacker who registers a Cognito identity with a victim's recycled email address could permanently capture the victim's row (and tenant, since tenant rides the row). The verifier reads `payload.email` with no `email_verified` check today. Add `emailVerified` to `AuthResult` and **gate the step-3 backfill** (the permanent write) on `auth.emailVerified === true`. Resolution via email may still *read* (R5 preserved), but the permanent bind only happens for a verified email. Google-linked identities carry `email_verified: true`, so legitimate Google users are unaffected. (Reading the existing-row resolution itself stays as-is to preserve R5; only the new permanent write is gated.)

---

## Implementation Units

### U1. Add `cognito_sub` column to `users` + hand-rolled migration

**Goal:** Persist the Cognito `sub` on `users` with a unique index.

**Requirements:** R1.

**Dependencies:** none.

**Files:**
- `packages/database-pg/src/schema/core.ts` — add `cognito_sub: text("cognito_sub")` to `users` (nullable); add `uniqueIndex("idx_users_cognito_sub").on(table.cognito_sub)` to the index list (alongside `idx_users_email`, `idx_users_tenant_id`).
- `packages/database-pg/drizzle/0138_users_cognito_sub.sql` — **hand-rolled** (KTD-3): `\set ON_ERROR_STOP on`, `BEGIN; SET LOCAL lock_timeout`/`statement_timeout`, `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS cognito_sub text`, `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cognito_sub ON public.users (cognito_sub)`, `COMMIT;`. Header carries `-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0138_users_cognito_sub.sql`, `-- Plan: docs/plans/2026-05-29-006-...`, `-- creates-column: public.users.cognito_sub`, `-- creates: public.idx_users_cognito_sub`.

**Approach:** Mirror the column/marker shape of `0124_thread_turns_finalized_at.sql` for the header and markers; mirror `email` (`text`, nullable, unique index) for the schema-edit shape. Nullable because existing rows have none. Postgres treats NULLs as distinct in a unique index, so many un-backfilled rows coexist (no partial index needed). Additive + nullable ⇒ safe to apply before or after the code deploy; the destructive-migration ordering rule does not apply.

**Patterns to follow:** `0124_thread_turns_finalized_at.sql` (hand-rolled additive column + marker); `users.email` + `idx_users_email` in `core.ts:137,162`.

**Test scenarios:** `Test expectation: none -- schema + hand-rolled migration; behavior is covered by U5 against the resolver.`

**Verification:** `pnpm --filter @thinkwork/database-pg build` succeeds; the `.sql` file carries the `-- creates-column:` and `-- creates:` markers; `pnpm db:migrate-manual` reports the column + index as present once applied to dev (and would FAIL the marker gate if missing).

---

### U2. Resolve by `cognito_sub` first, with guarded opportunistic backfill

**Goal:** Rewrite `resolveCallerFromAuth`'s Cognito branch to the 4-step order with a load-bearing backfill guard and an `email_verified`-gated permanent write; surface `emailVerified` from the verifier.

**Requirements:** R2, R3, R4, R5, R6, R7.

**Dependencies:** U1.

**Files:**
- `packages/api/src/lib/cognito-auth.ts` — add `emailVerified: boolean` to `AuthResult`; in the cognito branch set `emailVerified: (payload as any).email_verified === true || (payload as any).email_verified === "true"`. Set `emailVerified: false` in `apikeyAuthResult` (no verified-email semantics there).
- `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts` — rewrite the cognito branch of `resolveCallerFromAuth`; add a private `backfillSub` helper.

**Approach:**
- Leave the `apikey` / `service` branches and the non-cognito early return unchanged (aside from the new `emailVerified` field, defaulted false).
- Cognito branch resolves in KTD-1 order. Lookups that can trigger backfill (`byId`, `byEmail`) must also `select cognito_sub`:
  1. `byCognitoSub(principalId)` → return on hit, no backfill.
  2. `byId(principalId)` → on hit, backfill if `cognito_sub` is null (tautological native write, KTD-2), return.
  3. if `auth.email`: `byEmail(auth.email)` → on hit, return; backfill **only if** `cognito_sub` is null **and** `auth.emailVerified === true` (KTD-5).
  4. return `{ userId: null, tenantId: null }`.
- `backfillSub(userId, principalId)`: `update users set cognito_sub = principalId where id = userId and cognito_sub is null` (guard is load-bearing, KTD-2). Wrap so `23505` logs `console.error` and all other errors log `console.warn`; never throw, never change the resolved identity. Awaiting before return is acceptable (row already in hand).
- `tenantId` continues to read from the resolved row in every path (R4).

**Technical design** (directional guidance, not implementation specification):

```
cognito branch:
  if (!principalId) return {null, null}
  row = byCognitoSub(principalId)                 // step 1
  if (row) return {row.id, row.tenant_id}
  row = byId(principalId)                          // step 2 — native (R7)
  if (row) { if (!row.cognito_sub) await backfillSub(row.id, principalId); return {row.id, row.tenant_id} }
  if (auth.email) {
    row = byEmail(auth.email)                      // step 3 — unhealed Google (R5)
    if (row) {
      if (!row.cognito_sub && auth.emailVerified)  // KTD-5: permanent bind only on verified email
        await backfillSub(row.id, principalId)
      return {row.id, row.tenant_id}
    }
  }
  return {null, null}                              // step 4 — posture unchanged (R6)
```

**Patterns to follow:** the existing `db.select({...}).from(users).where(eq(users.id, principalId))` shape already in this file; best-effort `.catch`/swallow patterns used for non-critical writes elsewhere in the resolvers.

**Test scenarios:** covered in U5.

**Verification:** `pnpm --filter @thinkwork/api typecheck` + `test` pass; identity-critical write callers (`sendMessage`, `createThread`) receive non-null `userId` for a healed Google user, and `null` only when no path matches.

---

### U3. Capture `cognito_sub` at user creation (`bootstrapUser`)

**Goal:** Write `cognito_sub` when the `users` row is created, so new users are linked immediately and never depend on the heal path. This is the reliable heal trigger — `bootstrapUser` already **requires** `email` (`bootstrapUser.mutation.ts:32`) and has the sub in scope (`cognitoSub = ctx.auth.principalId`, line 36).

**Requirements:** R8.

**Dependencies:** U1.

**Files:**
- `packages/api/src/graphql/resolvers/core/bootstrapUser.mutation.ts` — set `cognito_sub: cognitoSub` in both `db.insert(users).values({...})` sites (the two insert paths at ~lines 84 and ~161).

**Approach:** Add the single column to the insert values. No control-flow change — the guard at line 32 already ensures `principalId` and `email` are present. For a Google user whose `users.id` is a fresh UUID, this stores the sub at birth so step 1 of U2 resolves them forever, independent of whether later tokens carry `email`. Check for any other code path that inserts a `users` row (e.g. a pre-signup/seed path) and stamp `cognito_sub` there too if it has the sub in scope; if it does not, note it as residual (those rows heal via U2).

**Patterns to follow:** the existing `.values({...})` shapes in `bootstrapUser.mutation.ts`.

**Test scenarios:** covered in U5.

**Verification:** a new user created via `bootstrapUser` has `cognito_sub` populated in the same insert; resolving that caller hits U2 step 1.

---

### U4. Route the `me` query through the stable-sub resolver

**Goal:** Replace `me.query.ts`'s independent `byId → byEmail` resolution with `resolveCaller`, so a healed user with an email-less token is not reported as signed-out (R9).

**Requirements:** R9, R4.

**Dependencies:** U2.

**Files:**
- `packages/api/src/graphql/resolvers/core/me.query.ts` — resolve the user id via `resolveCallerUserId(ctx)` (or `resolveCaller(ctx)`), then `select` the row by that id and `snakeToCamel` it.

**Approach:** `me.query.ts` currently does `byId(principalId) → byEmail(auth.email)` with its own logic and reads `x-principal-id` ahead of the verified sub. Route the cognito identity resolution through `resolveCaller` so it inherits step 1 (by-sub). **Scope note:** the pre-existing `x-principal-id` header precedence is an `apikey`/service-impersonation affordance; this unit does not change impersonation semantics — it only fixes the cognito path. If preserving the header path is required for admin-skill impersonation, keep it for non-cognito callers and route only `authType === "cognito"` through `resolveCaller`. Confirm against `resolveCallerFromAuth`'s apikey branch before finalizing.

**Patterns to follow:** how `updateThread.mutation.ts` calls `resolveCallerUserId(ctx)`.

**Test scenarios:** covered in U5.

**Verification:** a healed Google user (cognito_sub stored) with `email: null` in the token gets a non-null `me` result.

---

### U5. Tests: resolution order, backfill, gating, creation-link, `me` parity

**Goal:** Lock the full decision tree with direct tests.

**Requirements:** R2, R3, R4, R5, R6, R7, R8, R9.

**Dependencies:** U2, U3, U4.

**Files:**
- `packages/api/src/graphql/resolvers/core/resolve-auth-user.test.ts` — new.
- extend/auth-mock in `bootstrapUser` and `me` tests (or new files) for U3/U4 assertions.

**Approach:** Mock `../../utils.js` (`db`, `eq`, `users`) following **`packages/api/src/__tests__/messages-tenant-scoping.test.ts`** — it mocks `../graphql/utils.js`, overrides `db`/`eq`/table markers, and supports the bare `const [row] = await db.select().from().where()` destructure via a `then` thenable. (Do **not** model it on `tenant-membership.test.ts`, which mocks `@thinkwork/database-pg` `getDb` with a `.limit()` chain — a different layer than the resolver imports.) Neither reference models `update`, so **extend the mock builder with an `update().set().where()` path that records the written `cognito_sub`** (and lets the test simulate 0-row no-op and a `23505` throw). Reset captured writes in `beforeEach`.

**Test scenarios:**
- **Google user resolves by stored `cognito_sub` when `email` is null** — row with `cognito_sub == principalId`, different `id`, `email: null`. Expect resolved id/tenant, **no** `update`. Covers R2 step 1 (the core bug).
- **Native user resolves by id and backfills tautologically** — `principalId == users.id`, `cognito_sub: null`. Expect resolved `userId == principalId` and an `update` writing `cognito_sub = principalId`. Covers R7 + R3 native path.
- **Unhealed Google user, verified email → resolves by email and backfills** — by-sub/by-id miss, `email` present, `emailVerified: true`, row found with `cognito_sub: null`. Expect resolved id/tenant **and** an `update`. Covers R3, R5, KTD-5.
- **Unhealed Google user, UNVERIFIED email → resolves but does NOT backfill** — same as above with `emailVerified: false`. Expect resolved id/tenant and **no** `update` (no permanent bind). Covers KTD-5 (takeover guard).
- **Backfill `23505` conflict does not change identity, logs error** — mocked `update` throws a `23505`. Expect resolver still returns the resolved `{ userId, tenantId }`; assert `console.error` called. Covers KTD-2 conflict path.
- **Concurrent same-user backfill (0-row no-op)** — mocked `update` resolves 0 rows (lost the race). Expect resolved identity unchanged. Covers KTD-2 idempotency.
- **No sub match + null email ⇒ null** — all lookups miss / email absent. Expect `{ null, null }`, no throw. Covers R6.
- **`tenantId` comes from the resolved row on the sub path** — sub-matched row has non-null `tenant_id` while `auth.tenantId` is null. Expect returned `tenantId == row.tenant_id`. Covers R4 (tenant gap closes).
- **Non-cognito callers unchanged** — `apikey`/`service` return header-derived `{ principalId, tenantId }`, `emailVerified: false`; `cognito` with `principalId: null` returns null/null. Regression-safety.
- **`bootstrapUser` writes `cognito_sub` on create** — assert both insert paths include `cognito_sub == principalId`. Covers R8.
- **`me` returns the user for a healed, email-less token** — cognito caller, `email: null`, row resolvable only by stored sub. Expect non-null `me`. Covers R9.

**Verification:** `npx vitest run` for the new/changed test files is green from `packages/api`; every scenario is a distinct `it`.

---

## Scope Boundaries

**In scope:** the `cognito_sub` column + hand-rolled migration; the 4-step resolution order with guarded, `email_verified`-gated backfill; creation-time sub capture in `bootstrapUser`; `me` query parity; surfacing `emailVerified`; resolver/creation/`me` tests; confirming the `tenant_id` gap closes.

**Deferred for later** (from origin):
- **Cognito pre-token-generation trigger** injecting `custom:tenant_id` + a stable user id into tokens. Not required once resolution is reliable.
- **One-time backfill job** for existing Google users. Per the heal-boundary note, this is the **only** mechanism that fixes a pre-existing user whose tokens are perpetually email-less without a re-auth — reclassified from "optional acceleration" to **required mitigation if dev shows a non-trivial email-less-on-first-contact population** (watch item A3).
- **identities/links table** for multiple federated identities per user.

**Outside this change:** any UI; the desktop session/token-refresh behavior itself (this fix makes server resolution correct regardless of which claims a token carries; it does not change how the client obtains/refreshes tokens). The pre-existing `x-principal-id` impersonation precedence in `me.query.ts` is preserved for non-cognito callers, not redesigned here.

---

## Dependencies / Assumptions

- **A1** — The Cognito `sub` (`auth.principalId`) is stable per user across logins/refreshes and always present in a verified ID token. Verified against `cognito-auth.ts:110` (`principalId: payload.sub`, set unconditionally on successful verify).
- **A2** — One `sub` maps to at most one `users` row. The unique index on `cognito_sub` (U1) enforces it; a contended backfill fails with `23505`, which U2 logs at `console.error` and swallows. `idx_users_email` is already unique, so duplicate-email rows cannot exist (the email path is deterministic).
- **A3 — heal-boundary watch item.** Existing Google users self-heal only when they present an email-bearing token at least once after deploy (or are re-created). A user whose tokens are *perpetually* email-less is **not** fixed in place by this change — only by re-auth (a fresh full token) or the deferred one-time backfill job. The dev verification step (below) must reproduce an **email-less** first request specifically to learn whether the live stuck session heals or needs a re-login; if a non-trivial population never presents email, schedule the backfill job.
- **A4** — Cognito sets `email_verified: true` for Google-federated identities, so KTD-5's gate does not block legitimate Google users. Confirm during implementation; if any legitimate unhealed population presents `email_verified` false/absent, revisit the gate (read-resolution is unaffected; only the permanent write is gated).
- **A5** — Cognito does not rotate a user's `sub` (pool migration / account merge would be the only causes). If it ever did, step 1 would miss, steps 2/3 would re-resolve, and the stale `cognito_sub` would remain (overwrite only happens on null) — falling back to email. Treated as not-expected; noted for completeness.

---

## Risks & Mitigations

- **Migration bypasses the drift gate** (the original plan's error). Mitigated by KTD-3: hand-rolled `.sql` with `-- creates-column:`/`-- creates:` markers, applied via `psql`, verified by `db:migrate-manual` (which gates the deploy).
- **Identity takeover via recycled/unverified email on the new permanent bind.** Mitigated by KTD-5 (`email_verified` gate on the step-3 backfill) + A2's unique index + `23505` audit logging.
- **The fix appears to work on a refreshed (email-bearing) token while the real email-less population stays broken.** Mitigated by the honest heal-boundary framing (Summary, A3) and a dev verification step that reproduces an email-less first request specifically.
- **Resolution regression for native users.** Mitigated by retaining step 2 (`byId`) and asserting native parity in U5.
- **`me` reports a healed user as signed-out.** Mitigated by U4 (route through the resolver) + the U5 `me` parity test.
- **Backfill write amplification / concurrency.** Bounded: stops permanently after first successful heal (step 1 short-circuits); the load-bearing `cognito_sub IS NULL` guard makes the write idempotent and concurrent same-user races clean no-ops.

---

## Verification Strategy

- Unit: U5 covers the full decision tree (order, guarded backfill, `email_verified` gate, conflict/concurrency, creation-link, `me` parity, tenant close, failure posture).
- Type/lint/test: `pnpm --filter @thinkwork/database-pg build`, `pnpm --filter @thinkwork/api typecheck`, `pnpm --filter @thinkwork/api test`.
- Migration gate: `pnpm db:migrate-manual` reports `public.users.cognito_sub` + `public.idx_users_cognito_sub` present after `psql` apply to dev.
- Post-deploy (dev), **email-less reproduction**: confirm whether Eric's current stuck session heals after one *email-bearing* request, and separately confirm a deliberately email-less first request still fails identity-critical writes as A3 predicts (proving the boundary is understood, not a surprise). Confirm `cognito_sub` is populated on his `users` row after a heal, and that `sendMessage` / `createThread` / mark-read / `me` all succeed thereafter.
