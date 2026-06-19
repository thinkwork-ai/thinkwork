---
title: "WorkOS primary auth can bridge back to Cognito tokens"
date: 2026-06-19
category: architecture-patterns
module: WorkOS Auth / Cognito bridge
problem_type: architecture_pattern
component: authentication
severity: high
applies_when:
  - "A broker such as WorkOS must own the browser auth session"
  - "ThinkWork clients and APIs still require Cognito-issued tokens"
  - "Logout or account switching depends on upstream provider session state"
  - "Plugin-gated auth must hide public controls until the route is validated"
related_components:
  - packages/api/src/handlers/workos-auth.ts
  - packages/api/src/handlers/cognito-custom-auth.ts
  - packages/api/src/lib/workos-cognito-bridge.ts
  - packages/api/src/lib/workos-auth-session.ts
  - apps/web/src/lib/auth.ts
  - apps/web/src/routes/auth/callback.tsx
  - packages/database-pg/drizzle/0174_workos_auth_bridges.sql
  - packages/database-pg/drizzle/0175_workos_auth_sessions.sql
tags: [thnk-43, workos, cognito, custom-auth, logout, sso, authkit, plugins]
---

# WorkOS primary auth can bridge back to Cognito tokens

## Context

THNK-43 started with a plausible shape: keep Cognito Hosted UI as the browser
front door, configure WorkOS as an upstream OIDC identity provider, then let
Cognito issue the final ThinkWork tokens. The compatibility spike proved this
could work for a single `Continue with SSO` route, but the completed
implementation found that compatibility was not enough for correct session
ownership.

The hosted Cognito -> WorkOS route hides the WorkOS access token from
ThinkWork. That means ThinkWork cannot read the WorkOS session `sid`, cannot
call the WorkOS session logout URL for that browser session, and cannot prove
that a second SSO click after app logout returns to provider/account selection
instead of stale WorkOS consent. Session history from the implementation also
records the same failed fork: the original nested bridge was useful evidence,
but it was not the logout solution.

The durable pattern is to make WorkOS the primary browser auth hop, then bridge
the verified WorkOS identity back into Cognito with server-owned custom auth.
Cognito remains the final token issuer for ThinkWork clients and APIs, while
ThinkWork regains enough upstream session ownership to implement logout,
account switching, audit evidence, and plugin fail-closed behavior.

## Guidance

Use a direct broker-first route whenever ThinkWork needs to manage the upstream
auth session, even if Cognito can technically federate to that broker as an OIDC
IdP.

The THNK-43 shape is:

1. Public auth options publish a WorkOS API authorize route only after the
   WorkOS Auth plugin/configuration is valid.
2. The browser starts at `GET /api/auth/workos/authorize`, not Cognito Hosted
   UI.
3. The API builds a WorkOS/AuthKit authorization URL with signed state,
   redirect allowlists, return path binding, and account-selection hints.
4. WorkOS redirects to `GET /api/auth/workos/callback`.
5. The API exchanges the WorkOS code, requires verified identity data, captures
   the WorkOS `sid`, and stores a short-lived bridge record without raw WorkOS
   tokens.
6. The web callback receives a one-time `workos_bridge` code.
7. `POST /api/auth/workos/bridge` consumes that code and completes Cognito
   `CUSTOM_AUTH` server-side through Define/Create/Verify auth challenge
   triggers.
8. The web app stores the returned Cognito tokens through the existing token
   storage path, so GraphQL, API Gateway, refresh, and tenant resolution keep
   using Cognito.
9. Logout for WorkOS-sourced sessions calls ThinkWork's logout endpoint, marks
   the stored WorkOS session logged out, and redirects the browser to the WorkOS
   logout URL for the captured `sid`.

Keep these invariants tight:

- Store digest-only or short-lived bridge material. Do not store raw WorkOS
  access tokens or refresh tokens just to make the bridge work.
- Treat the bridge code as one-time, expiring, and bound to the resolved
  WorkOS/ThinkWork identity.
- Keep Cognito custom-auth config in runtime config or deployed secrets, not
  direct `process.env` reads that bypass the runtime-config fixture guard.
- Resolve tenant membership server-side from the mapped ThinkWork user. A
  historical `users.tenant_id` or stale Cognito `custom:tenant_id` claim is not
  enough to grant workspace access.
- Emit audit evidence with identifiers such as WorkOS user id, Cognito sub,
  ThinkWork user id, tenant id, auth-provider resource id, tenant auth-provider
  reference id, and logout result, while still redacting token/client-secret
  shaped fields.

The implementation lives across these merged surfaces:

```text
packages/api/src/handlers/workos-auth.ts
packages/api/src/handlers/cognito-custom-auth.ts
packages/api/src/lib/workos-cognito-bridge.ts
packages/api/src/lib/workos-auth-session.ts
apps/web/src/routes/auth/callback.tsx
packages/database-pg/drizzle/0174_workos_auth_bridges.sql
packages/database-pg/drizzle/0175_workos_auth_sessions.sql
```

## Why This Matters

Cognito federation compatibility answers only "can a token be issued?" It does
not answer "does ThinkWork own enough of the auth flow to end the right browser
session, switch accounts, preserve tenant boundaries, and audit what happened?"

The nested Hosted UI approach failed that second question. After app logout,
the next SSO attempt could reuse the active WorkOS browser session and return
to Cognito as the same user without provider/account selection. A callback
guard can reject stale callbacks, but it cannot give users a correct logout
experience if ThinkWork never sees the upstream `sid`.

The broker-first bridge makes the ownership boundary explicit:

- WorkOS owns upstream provider choice and browser auth session.
- ThinkWork owns the callback, bridge record, tenant/user resolution, audit
  evidence, and WorkOS logout redirect.
- Cognito owns final ThinkWork tokens so existing web, mobile, CLI, API
  Gateway, AppSync, and runtime assumptions stay intact.

That separation let THNK-43 ship the WorkOS Auth plugin route without accepting
WorkOS JWTs directly in ThinkWork APIs or regressing Cognito-only deployments.

## When to Apply

- A third-party auth broker needs to be plugin-gated but existing clients still
  depend on Cognito sessions.
- Logout requires an upstream session id, logout URL, refresh-session marker, or
  other broker-owned session artifact.
- Provider-specific buttons would be misleading because final Cognito claims do
  not prove which upstream provider or connection was actually used.
- A tenant may install/configure auth for one deployment while another
  deployment or host must remain Cognito-only.
- A browser smoke must prove account switching in the same profile without
  manual cookie clearing.

Do not use this pattern when a plain Cognito Hosted UI federation route is
enough and ThinkWork does not need upstream session ownership. The custom-auth
bridge is more moving parts, so it earns its keep only when the broker-first
callback boundary is necessary.

## Examples

Insufficient shape:

```text
web -> Cognito Hosted UI -> WorkOS/AuthKit -> Cognito callback -> web
```

This can issue Cognito tokens, but ThinkWork cannot see the WorkOS `sid`.
Logout can clear local Cognito tokens and maybe revoke Cognito refresh state,
but it cannot reliably terminate the WorkOS browser session that will be reused
on the next SSO click.

Preferred shape:

```text
web -> ThinkWork API authorize -> WorkOS/AuthKit
    -> ThinkWork API callback -> one-time bridge
    -> Cognito CUSTOM_AUTH -> web stores Cognito tokens
```

The bridge preserves the existing Cognito-token contract while giving ThinkWork
the WorkOS session artifact required for correct logout:

```text
web logout -> ThinkWork WorkOS logout endpoint
           -> mark WorkOS session logged out
           -> redirect browser to WorkOS logout URL for sid
           -> return to /sign-in
```

The proof is behavioral, not just structural. THNK-43 only passed after the
same browser profile could:

1. Open `http://localhost:5180/sign-in?next=/new`.
2. Click `Continue with SSO`.
3. Complete WorkOS primary auth and land on `/new` with Cognito tokens stored.
4. Log out from the app.
5. Click `Continue with SSO` again without clearing cookies.
6. Stop at WorkOS AuthKit/provider selection instead of silently restoring the
   previous ThinkWork session.

## Related

- Linear THNK-43, "WorkOS Auth plugin upstream of Cognito"
- PR [#2671](https://github.com/thinkwork-ai/thinkwork/pull/2671) - WorkOS
  primary auth spike and bridge decision
- PR [#2672](https://github.com/thinkwork-ai/thinkwork/pull/2672) -
  server-owned WorkOS authorize/callback endpoints
- PR [#2673](https://github.com/thinkwork-ai/thinkwork/pull/2673) - Cognito
  custom-auth bridge
- PR [#2674](https://github.com/thinkwork-ai/thinkwork/pull/2674) - WorkOS
  session logout
- PR [#2682](https://github.com/thinkwork-ai/thinkwork/pull/2682) -
  tenant/user enforcement and rollout evidence
- [WorkOS to Cognito OIDC compatibility spike](../spikes/2026-06-18-workos-cognito-oidc-compatibility.md)
- [WorkOS primary auth with Cognito token bridge plan](../../plans/2026-06-19-001-feat-workos-primary-auth-bridge-plan.md)
- [THNK-43 autopilot status](../../plans/autopilot/THNK-43-status.md)
- [OAuth client credentials should live in Secrets Manager](../best-practices/oauth-client-credentials-in-secrets-manager-2026-04-21.md)
