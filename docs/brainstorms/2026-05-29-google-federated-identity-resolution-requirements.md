# Google-Federated Identity Resolution — Requirements

**Date:** 2026-05-29
**Area:** `packages/api` (server-side auth/identity resolution)
**Scope:** Standard — durable fix for a known auth gap.
**Origin:** Root cure for the bug fail-softed in PR #1837 ("[GraphQL] Requester user identity required"). This brainstorm resolves the underlying fragility.

## Problem

Google-federated Cognito users are linked to their DB `users` row **only by the ID-token `email` claim**. The resolver (`packages/api/src/graphql/resolvers/core/resolve-auth-user.ts` `resolveCallerFromAuth`) tries to match `users.id == principalId` (the Cognito `sub`) — which works for native users (whose `users.id` *is* the sub) but always misses for Google users (fresh-UUID `users.id` ≠ sub) — then falls back to an email lookup. When the ID token lacks `email` (federated refresh tokens can drop mapped attributes), identity resolves to **null**, and every identity-requiring write breaks (`sendMessage`, `createThread`, mark-read). The same root — Google tokens not carrying server-trusted identity — also produces the `custom:tenant_id`-is-null gap that already required a `resolveCallerTenantId` workaround.

PR #1837 fail-softed the *best-effort* mark-read so it stops surfacing a blocking error, but identity-critical writes still fail when the email claim is absent. This is the durable fix.

## Outcome

A Google-federated user's identity resolves from a **stable, always-present** signal (the Cognito `sub`), not an optional token claim — so sending, thread creation, and read-state never break due to a missing `email`. Because tenant id is derived from the resolved user row, this cures the `tenant_id` resolution gap for Google users in the same stroke. Server-side only; no Cognito or Terraform changes.

## Requirements

- **R1 — Stable sub link.** Persist the Cognito `sub` on the `users` record so a user can be resolved by `sub` regardless of how their `users.id` was minted.
- **R2 — Resolution order.** Resolve the caller in this order: (1) by stored Cognito `sub`; (2) by email (existing fallback); (3) null. The `sub` path is the primary, reliable path.
- **R3 — Opportunistic backfill (self-healing).** When resolution falls through to the email path and succeeds, **write the caller's `sub`** onto that user row so the next request resolves by `sub`. Existing Google users heal on their next authenticated request with an email-bearing token; no separate migration is required for correctness. (A one-time backfill job is optional acceleration, not a prerequisite — note for planning.)
- **R4 — Tenant id rides along.** Tenant id continues to come from the resolved user row, so reliable user resolution = reliable tenant resolution for Google users. The feature must confirm the `tenant_id` gap is closed by this change (no separate mechanism).
- **R5 — Email stays as last-resort.** Keep the email fallback for users not yet backfilled; it becomes effectively unused as users heal. Do not remove it in this change.
- **R6 — Failure posture unchanged.** When neither `sub` nor email resolves a user, identity is still null. Identity-critical writes (`sendMessage`, `createThread`) continue to fail loudly; best-effort writes (mark-read) continue to fail soft (PR #1837). This change makes null far rarer; it does not change what happens when it occurs.
- **R7 — Native users unaffected.** Native Cognito users (where `users.id == sub`) must continue to resolve exactly as today.

## Key decisions

- **Resolve-by-sub on a stable link, server-side only** — chosen over a Cognito **pre-token-generation Lambda** (which would inject identity/tenant into the token). The pre-token trigger is the AWS-native "proper fix" and would also carry `tenant_id`, but it adds a Lambda + Cognito/Terraform config and *still* needs a `sub`→user link underneath to look up. The server-side link cures both gaps with no infrastructure change and self-heals existing users. The pre-token trigger remains a possible later optimization (read identity from token claims, skip the DB lookup) but is **not** needed for correctness.
- **Opportunistic backfill over a mandatory migration** — self-healing on next request keeps the change small and avoids a one-shot data job as a release gate.

## Scope boundaries

**In scope:** server-side identity resolution (the `sub` link, resolution order, opportunistic backfill), confirming the `tenant_id` gap closes, preserving current failure posture.

**Deferred for later:**
- **Cognito pre-token-generation trigger** that injects `custom:tenant_id` + a stable user id into tokens (token-claim optimization to skip the DB lookup). The same family CLAUDE.md references; not required once resolution is reliable.
- A one-time **backfill job** for all existing Google users (opportunistic self-heal covers correctness; a job only accelerates it).
- An **identities/links table** supporting multiple federated identities per user (a single `sub` link suffices today).

**Outside this change:** any UI; the desktop session/token-refresh behavior itself (this fixes server resolution regardless of which claims the token carries).

## Dependencies / Assumptions

- **A1** — The Cognito `sub` (`principalId`) is stable per user across logins/refreshes and always present in the verified token. (Standard Cognito behavior; confirm in planning.)
- **A2** — There is a one-to-one mapping between a Cognito `sub` and a `users` row (no shared/duplicated subs). If a `sub` could ever map to multiple users, the link needs a uniqueness/conflict strategy — planning must check.
- **A3** — Existing Google users will, on a normal authenticated request, present a token that resolves via email at least once so the backfill can capture their `sub`. Users whose tokens *never* carry email won't self-heal via email — flag whether a one-time job is then warranted.

## Success criteria

- A Google-federated user whose token lacks `email` still resolves to their user id (via the stored `sub`) → sending, thread creation, and mark-read all work.
- After one successful request, an existing Google user's `sub` is stored; subsequent requests resolve by `sub` without touching the email path.
- Native Cognito users resolve exactly as before (regression-safe).
- `tenant_id` resolves for Google users via the resolved row — the `resolveCallerTenantId` null case stops occurring for resolved users.
