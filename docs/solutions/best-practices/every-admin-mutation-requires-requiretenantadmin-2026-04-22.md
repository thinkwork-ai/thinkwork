---
title: Every admin-reachable GraphQL mutation requires requireTenantAdmin with a tenant pin
date: 2026-04-22
category: docs/solutions/best-practices
module: packages/api/src/graphql/resolvers
problem_type: best_practice
component: authentication
severity: critical
applies_when:
  - Adding a new GraphQL mutation reachable from admin, mobile, or CLI
  - Mutation targets or creates a tenant-scoped entity (agent, team, template, member, Cognito user)
  - Caller is Google-federated (ctx.auth.tenantId is null until pre-token trigger lands)
  - Mutation performs destructive or side-effecting work (Cognito AdminCreateUser, row deletes, SES sends)
  - Reviewing a PR that touches resolvers/** without an explicit authz gate
symptoms:
  - Any authenticated user can overwrite, archive, or create entities in another tenant
  - Cognito invite emails fire before any DB-level authorization check
  - setAgentCapabilities deletes rows for non-existent or cross-tenant agents
  - Naive ctx.auth.tenantId === args.tenantId checks silently pass for Google-federated callers
root_cause: missing_permission
tags: [graphql, authorization, multi-tenant, requiretenantadmin, resolvecaller, cognito, security-pattern]
---

# Every admin-reachable GraphQL mutation requires `requireTenantAdmin` with a tenant pin

## Context

Three separate occurrences made this pattern load-bearing:

1. **PR #391** retrofitted `resolveCaller` + tenant pin onto `updateAgent` after the gap was noticed in review.
2. **PR #398** (merged 2026-04-22) audited the remaining mutation surface and fixed **13 admin-reachable resolvers** in one sweep — several were P0 cross-tenant.
3. **Future mutations keep arriving.** Without a documented rule, each new resolver relitigates the same decision and occasionally ships ungated.

Before PR #398, any authenticated user could:

- Overwrite any agent's `agent_skills.permissions` jsonb via `setAgentSkills` — the column the admin-skill plan uses to narrow an agent's operation allowlist (P0).
- DoS any agent's capabilities via `setAgentCapabilities` (deleted rows before verifying the agent existed).
- Archive any team in any tenant via `deleteTeam` (zero auth checks).
- Add themselves as `admin` to any tenant via `inviteMember` / `addTenantMember` knowing only a tenantId.
- Spam Cognito `AdminCreateUser` (which emails the invitee) across any tenant via `inviteMember` — the Cognito call ran before any DB auth gate.
- Stamp hostile `createAgentTemplate` rows with arbitrary system prompts into any tenant.
- Overwrite all linked agents of any template via `syncTemplateToAllAgents` — fully unauthenticated.

At current scale (4 enterprises × 100+ agents × ~5 templates), a single missed gate exposes every customer's data. The rule below is cheap to follow on day one and expensive to retrofit.

## Guidance

**Rule:** Every admin-reachable mutation must call `requireTenantAdmin(ctx, tenantId)` **before any side effect**, with `tenantId` derived from the **row being mutated** (not from `ctx.auth.tenantId`, not from a naive arg-match).

### Decision flow

- **Is the entity already in the DB?** (update / delete / any mutation keyed on an existing id)
  - Look it up first. `throw NOT_FOUND` if missing. Then `requireTenantAdmin(ctx, row.tenant_id)`. **Row-derived.**
- **Are you creating the entity?** (no row exists yet)
  - `requireTenantAdmin(ctx, input.tenantId)` against the arg. **Arg-derived.**
- **Does the resolver touch an external system** (Cognito, SES, Bedrock, GitHub, Slack)?
  - Gate **before** the external call. An email sent to a victim is not undone by a later FORBIDDEN response.
- **Does it delete/overwrite rows?**
  - Confirm the target row exists *and* gate auth *before* the destructive write. Ordering matters for DoS resistance.

### Why `requireTenantAdmin` alone is the tenant pin

`requireTenantAdmin(ctx, tenantId)` performs a live `tenant_members` lookup for `(caller_user_id, tenantId)`. If the caller is admin of tenant B and passes `tenantId=A`, the row doesn't exist and it throws FORBIDDEN. **No separate `args.tenantId === ctx.auth.tenantId` check is needed** — and that check would be wrong anyway, because `ctx.auth.tenantId` is null for Google-federated users.

`requireTenantAdmin` is the authz gate. `resolveCaller(ctx)` / `resolveCallerTenantId(ctx)` is the caller-identity helper — use it for reading the current tenant (e.g., "list my agents"), not as a substitute for the gate.

### Correct: row-derived (update / delete)

```typescript
export const deleteTeamResolver = async (_, args, ctx) => {
  const team = await db.query.teams.findFirst({ where: eq(teams.id, args.id) });
  if (!team) throw new GraphQLError('NOT_FOUND');

  await requireTenantAdmin(ctx, team.tenant_id); // row-derived — authoritative

  await db.update(teams).set({ status: 'archived' }).where(eq(teams.id, args.id));
};
```

### Correct: arg-derived (create, no row yet)

```typescript
export const createTeamResolver = async (_, { input }, ctx) => {
  await requireTenantAdmin(ctx, input.tenantId); // arg-derived for create
  return db.insert(teams).values(input).returning();
};
```

### Wrong patterns

```typescript
// Naive ctx.auth.tenantId check — null for Google-federated users, silently passes
if (ctx.auth.tenantId !== args.tenantId) throw new GraphQLError('FORBIDDEN');

// Side-effect before gate — Cognito user created + invite email sent before auth check
await cognito.adminCreateUser({ UserPoolId, Username: email });
await requireTenantAdmin(ctx, args.tenantId); // too late

// Destructive delete before existence check — DoS any agent by anyone
await db.delete(agentCapabilities).where(eq(agentCapabilities.agent_id, args.agentId));
const agent = await db.query.agents.findFirst({ where: eq(agents.id, args.agentId) });
if (!agent) throw new GraphQLError('NOT_FOUND'); // too late — rows already gone
```

## Why This Matters

- **Enterprise blast radius.** 4 enterprises × 100+ agents × ~5 templates. One ungated cross-tenant mutation exposes every customer simultaneously — this is not a theoretical n=1 risk.
- **Cognito email-spam vector (`inviteMember`).** `AdminCreateUser` triggers an invite email. Before PR #398, any authenticated user could cause emails to arbitrary addresses by spraying tenantIds. Gate-before-side-effect is not stylistic — it's the difference between a FORBIDDEN response and an email hitting a victim's inbox.
- **DoS vector (`setAgentCapabilities`).** The resolver deleted existing rows before confirming the agent existed. Any authenticated user could wipe any agent's capabilities. Ordering: existence check → auth gate → destructive write.
- **Google-federated silent bypass.** `ctx.auth.tenantId` is `null` for users signed in via Google OAuth until the Cognito pre-token trigger lands. Code like `if (ctx.auth.tenantId !== args.tenantId) throw FORBIDDEN` passes for every Google user — the whole class of checks is broken. `requireTenantAdmin` avoids this by reading `tenant_members` directly.

## When to Apply

**Apply to:**

- Any new GraphQL mutation touching a tenant-scoped table (anything with a `tenant_id` column).
- Any mutation creating, updating, or deleting a row owned by a tenant.
- Any mutation calling an external system (Cognito, SES, Bedrock, GitHub, Slack) on behalf of a tenant — gate must happen before the outbound call.
- Any mutation that takes `tenantId` (or an id that resolves to one) as an argument.

**Do NOT apply to:**

- `createTenant` — different privilege class, not tenant-scoped, human-only via SPA/CLI. Uses a different gate.
- Subscription resolvers — auth is enforced at the AppSync layer against the subscription filter.
- Query resolvers — separate read-path auth model; `requireTenantAdmin` is a mutation-side rule. Queries should still scope by the caller's tenant via `resolveCallerTenantId(ctx)`.

## Examples

### `teams/deleteTeam` — silent archive of any team, now row-derived gate

**Before:**

```typescript
export const deleteTeam = async (_, args, ctx) => {
  await db
    .update(teams)
    .set({ status: 'archived' })
    .where(eq(teams.id, args.id));
  return true;
};
```

Zero auth. Any authenticated user, knowing only a team id, archived that team in any tenant.

**After:**

```typescript
export const deleteTeam = async (_, args, ctx) => {
  const team = await db.query.teams.findFirst({ where: eq(teams.id, args.id) });
  if (!team) throw new GraphQLError('NOT_FOUND');

  await requireTenantAdmin(ctx, team.tenant_id);

  await db
    .update(teams)
    .set({ status: 'archived' })
    .where(eq(teams.id, args.id));
  return true;
};
```

Worth calling out because archiving a team **felt benign** — it's a soft status flip, not a hard delete. That's exactly why it slipped: benign-looking mutations get the same drive-by review as read resolvers. The rule doesn't care how destructive the write "feels."

### `core/inviteMember` — Cognito email before auth, now gated first

**Before:**

```typescript
export const inviteMember = async (_, args, ctx) => {
  // Creates the Cognito user AND sends the invite email
  await cognito.adminCreateUser({
    UserPoolId: USER_POOL_ID,
    Username: args.email,
    DesiredDeliveryMediums: ['EMAIL'],
  });

  // Auth check fires after the email is already out
  await requireTenantAdmin(ctx, args.tenantId);

  await db.insert(tenantMembers).values({
    user_id: /* ... */,
    tenant_id: args.tenantId,
    role: args.role,
  });
};
```

Any authenticated user could spray `inviteMember` across tenantIds and cause Cognito to email arbitrary addresses. The FORBIDDEN response came *after* the email hit the victim's inbox.

**After:**

```typescript
export const inviteMember = async (_, args, ctx) => {
  await requireTenantAdmin(ctx, args.tenantId); // gate first — before any side effect

  await cognito.adminCreateUser({
    UserPoolId: USER_POOL_ID,
    Username: args.email,
    DesiredDeliveryMediums: ['EMAIL'],
  });

  await db.insert(tenantMembers).values({
    user_id: /* ... */,
    tenant_id: args.tenantId,
    role: args.role,
  });
};
```

General principle: **external side effects are not transactional**. A FORBIDDEN thrown after `adminCreateUser` does not un-send the email, does not un-create the Cognito user, and does not un-log the event. Gate must precede the outbound call.

## PR #398 audit table (for reference)

The 13 resolvers fixed in the sweep, plus the 3 already-gated ones verified during audit:

| Resolver | Tenant source | Status |
|---|---|---|
| `agents/createAgent` | `i.tenantId` (arg) | Fixed in #398 |
| `agents/setAgentSkills` | `agent.tenant_id` (row) | Fixed in #398 (P0) |
| `agents/setAgentCapabilities` | `agent.tenant_id` (row) | Fixed in #398 + delete reordered |
| `agents/acceptTemplateUpdate` | `agent.tenant_id` (row) | Already gated (verified) |
| `teams/createTeam` | `i.tenantId` (arg) | Fixed in #398 |
| `teams/updateTeam` | `team.tenant_id` (row) | Fixed in #398 |
| `teams/deleteTeam` | `team.tenant_id` (row) | Fixed in #398 |
| `teams/addTeamAgent` | `team.tenant_id` (row) | Fixed in #398 |
| `teams/addTeamUser` | `team.tenant_id` (row) | Fixed in #398 |
| `teams/removeTeamAgent` | `team.tenant_id` (row, looked up) | Fixed in #398 |
| `teams/removeTeamUser` | `team.tenant_id` (row, looked up) | Fixed in #398 |
| `core/updateTenant` | `args.id` (arg) | Fixed in #398 |
| `core/addTenantMember` | `args.tenantId` (arg) | Fixed in #398 |
| `core/inviteMember` | `args.tenantId` (arg) | Fixed in #398 + gate moved before Cognito write |
| `core/updateTenantMember` | `target.tenant_id` (row, tx) | Already gated (verified) |
| `core/removeTenantMember` | `target.tenant_id` (row, tx) | Already gated (verified) |
| `templates/createAgentTemplate` | `i.tenantId` (arg) | Fixed in #398 |
| `templates/syncTemplateToAgent` | `agentTemplate.tenant_id` (row) | Fixed in #398 |
| `templates/syncTemplateToAllAgents` | `template.tenant_id` (row, looked up) | Fixed in #398 + gated once, not per-iteration |

Out of scope: `createTenant` (different privilege class).

## Related

- [Service endpoint vs widening resolveCaller auth](./service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md) — Companion rule on the auth-helper side: don't grow cross-tenant trust by widening a shared caller resolver; add a service-scoped path instead. This doc handles the gate side; that doc handles the helper side.
- [OAuth authorize wrong user_id binding](../logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md) — Precedent for the same failure shape (ambient-tenant trust leading to wrong-row writes) in a different subsystem.
- PR #391 — `updateAgent` cross-tenant write gap fixed with `resolveCaller` + tenant pin (first occurrence).
- PR #398 — Role-gate + tenant-pin sweep across 13 admin-reachable mutations (retroactive audit, source for this pattern doc).
