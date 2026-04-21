---
module: packages/api/src/handlers/skills.ts + packages/api/src/graphql/resolvers/core/resolve-auth-user.ts
date: 2026-04-21
category: best-practices
problem_type: best_practice
component: authentication
severity: high
related_components:
  - service_object
applies_when:
  - "A service inside our infra needs to invoke a mutation on behalf of a user"
  - "The service authenticates with API_AUTH_SECRET, not a user Cognito JWT"
  - "Extending resolveCaller to honor the service auth would widen impersonation across every resolver"
tags:
  - authentication
  - impersonation
  - service-to-service
  - rest-api
  - graphql
  - resolvecaller
  - blast-radius
---

# Prefer narrow REST endpoints over widening `resolveCaller` when service identities need to act on behalf of users

## Context

Unit 5 of the composable-skills plan needed the AgentCore container's
`skill-dispatcher` to start a composition on behalf of the chat
invoker. The container authenticates outbound calls with
`THINKWORK_API_SECRET`, not a Cognito JWT. The GraphQL
`startSkillRun` mutation uses `resolveCaller(ctx)` to derive
`{userId, tenantId}` from the Cognito JWT — and the function is
hard-gated to `authType === "cognito"`:

```ts
export async function resolveCaller(
  ctx: GraphQLContext,
): Promise<{ userId: string | null; tenantId: string | null }> {
  if (ctx.auth.authType !== "cognito") {
    return { userId: null, tenantId: null };
  }
  // ...
}
```

The natural-looking fix was to extend `resolveCaller` to also accept
`authType === "apikey"`, reading `x-principal-id` and `x-tenant-id`
headers the container already sends. We rejected that path and
instead added a new `POST /api/skills/start` handler inside the
existing `skills.ts` router. This doc captures why.

## Guidance

When a trusted service inside your infra needs to act on behalf of a
user and it doesn't hold that user's JWT:

**Don't extend the shared user-resolution helper to honor the service
auth path.** It looks like the DRY move, but it widens the
impersonation surface across every resolver in the GraphQL schema —
every mutation, not just the one you want. The service secret
becomes a universal impersonation credential, and auditing which
endpoints a leaked secret can exploit becomes a whole-schema
question instead of a single-handler question.

**Instead:** stand up a narrow REST endpoint dedicated to the
service-invocation use case. Authenticate it with the service
secret, take `tenantId` + `invokerUserId` explicitly in the payload,
cross-check that the claimed invoker belongs to the claimed tenant,
and wire the endpoint to mirror the mutation's business logic (same
dedup, same envelope shape, same downstream invoke target).

Result: two doors into the same audit surface (`skill_runs` table
in this case), but with sharply different trust models. Only the
one dedicated handler trusts service-asserted identity; every other
mutation continues to require a real Cognito JWT.

## Why This Matters

Auth surfaces have two dimensions that look equivalent but aren't:

1. **Who can authenticate.** `resolveCaller` currently accepts
   Cognito. Widening it to accept API key means the API key now
   authenticates *everywhere* `resolveCaller` is called — dozens
   of resolvers, every mutation that touches a tenant-scoped
   resource.
2. **What that authentication can do.** A dedicated REST endpoint
   bounds this to one operation.

Extending (1) silently extends (2) across every endpoint. A
dedicated REST endpoint inverts it: auth is bounded to one
entrypoint, and you can reason about the blast radius of a
compromised `API_AUTH_SECRET` by reading one file.

The secondary benefit: the new REST endpoint is an explicit
service-integration contract. A reader scanning
`terraform/modules/app/lambda-api/handlers.tf` sees
`POST /api/skills/start` and knows instantly that there's a
service-to-service path here. Widening `resolveCaller` leaves the
same capability implicit and split across every resolver.

## When to Apply

Apply this pattern when:

- A service inside your infra authenticates with a long-lived
  shared secret (API_AUTH_SECRET, IAM role, etc.) rather than an
  end-user credential
- The service needs to invoke an operation that would otherwise
  require user-JWT auth
- The "obvious" fix would extend a shared auth helper
  (`resolveCaller`, `authenticate`, middleware) to accept the
  service's credential type
- The shared helper is called by many endpoints, so widening it
  widens every endpoint's trust surface

Do **not** apply when:

- The operation is already scoped to a single endpoint that doesn't
  share an auth helper with anything else
- The service credential is short-lived and narrowly scoped (e.g.,
  a signed JWT with a specific `aud`) such that honoring it in the
  shared helper is self-bounding
- The expected growth is many dozens of service-invoked operations;
  at some point the duplication cost of N REST handlers eclipses
  the blast-radius cost of one widened helper. (Tip: if you're
  building a whole service-to-service API surface, go design that
  surface explicitly, don't grow it by accretion on both sides.)

## Examples

**What we rejected — widening `resolveCaller`:**

```ts
// NOT the chosen path.
export async function resolveCaller(ctx: GraphQLContext): Promise<...> {
  if (ctx.auth.authType === "cognito") {
    // existing Cognito path
  }
  if (ctx.auth.authType === "apikey") {
    // NEW: trust x-principal-id header
    return {
      userId: ctx.headers["x-principal-id"] ?? null,
      tenantId: ctx.headers["x-tenant-id"] ?? null,
    };
  }
  return { userId: null, tenantId: null };
}
```

The moment this lands, every GraphQL mutation — `createAgent`,
`deleteRun`, `submitRunFeedback`, `setAgentSkills`, etc. — also
accepts service-asserted identity. A compromised `API_AUTH_SECRET`
becomes an any-user, any-mutation impersonation credential.

**What we chose — a narrow REST endpoint:**

`packages/api/src/handlers/skills.ts:313-...`

```ts
// POST /api/skills/start — service-to-service wrapper around
// startSkillRun. Authenticates with API_AUTH_SECRET; trusts the
// caller to assert tenantId + invokerUserId; cross-checks that
// the claimed invoker belongs to the claimed tenant.
async function startSkillRunService(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  // auth already validated at the handler entry — see skills.ts:65-70
  const body = JSON.parse(event.body || "{}") as StartSkillRunServiceBody;
  const { tenantId, invokerUserId, skillId, invocationSource } = body;

  // ... field validation ...

  // Sanity check: the claimed invoker belongs to the claimed tenant.
  const [invoker] = await db.select({ id: users.id, tenant_id: users.tenant_id })
    .from(users).where(eq(users.id, invokerUserId));
  if (!invoker) return error("invokerUserId not found", 404);
  if (invoker.tenant_id !== tenantId) {
    return error("invokerUserId tenant mismatch", 403);
  }

  // ... mirrors startSkillRun mutation: INSERT ON CONFLICT + invoke ...
}
```

`resolveCaller` is untouched. Only `POST /api/skills/start` honors
the service secret's identity assertion, and the cross-tenant check
bounds the damage of a compromised secret (they'd need *both* the
secret *and* a valid user row in the target tenant).

## Related

- `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md`
  — the `oauth-authorize` handler mirrors the GraphQL `resolveCaller`
  *shape* (users.id → email fallback → fail closed) inside a REST
  handler. That doc canonicalizes the *user-resolution logic* as
  something worth mirroring across surfaces. **This doc
  distinguishes** that mirroring from *auth-type widening*: reuse
  the shape, don't widen the acceptance. Different axes, compatible
  recommendations.
- `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts` —
  the helper intentionally kept narrow to Cognito.
- auto memory `feedback_oauth_tenant_resolver` — the companion
  `resolveCallerTenantId(ctx)` fallback that handles Google-OAuth
  users whose Cognito JWT lacks `custom:tenant_id`. Same theme:
  tight resolution logic with a bounded fallback, not a widening
  acceptance.
