---
title: "feat: Enforce tenant-membership on 14 admin REST handlers"
type: feat
status: active
date: 2026-04-24
---

# feat: Enforce tenant-membership on 14 admin REST handlers

## Overview

PR #522 (merged 2026-04-24) closed the secret-in-bundle exposure by migrating the admin SPA to Cognito-JWT auth and adding `authenticate()` as the bearer-accepting gate on 14 handlers. The residual gap: handlers still read `event.headers["x-tenant-id"]` as authoritative after auth — any Cognito user can set `x-tenant-id: <victim-tenant>` and read/write that tenant's data.

This PR wraps `requireTenantMembership` (the helper PR #518 established and PR #522's tenant-membership.ts exports) around every admin REST surface. Post-merge, cognito callers must prove active-member status on the target tenant before the handler proceeds; the `x-tenant-id` header is *input* to the membership check, not a trusted credential. The apikey path (CI/CLI/Strands) keeps its existing bypass — that's the platform-operator trust boundary, not a tenant-scoped credential.

---

## Problem Frame

Thinkwork is onboarding 4 enterprises × 100+ agents into v1 imminently (`project_enterprise_onboarding_scale.md`). In the current (post-#522) state, any Cognito-authenticated user in the pool — including Google-federated accounts and any future self-signup — can forge `x-tenant-id` against the admin REST surface and reach another tenant's resources. That is an unacceptable v1-launch posture for a multi-tenant product.

The gap was intentionally documented in PR #522's Scope Boundaries as a deferred follow-up gated on this PR:

> **Timing constraint:** PR B must merge before any new enterprise tenant is onboarded to v1. Until then, any authenticated Cognito user can set x-tenant-id to a victim tenant UUID and read/write that tenant's data.

This plan closes that gap.

---

## Requirements Trace

- **R1.** Every admin-reachable REST handler rejects cognito requests whose caller is not an active member of the target tenant. `403` with no tenant-existence leakage (per `tenant-membership.ts`'s existing behavior).
- **R2.** Mutations (POST/PUT/PATCH/DELETE) require `owner` or `admin` role. Reads (GET) may widen to include `member` where appropriate.
- **R3.** The apikey path (Authorization or x-api-key with an accepted service secret) continues to bypass the membership check — preserves CI, CLI, and Strands service-to-service flows. The secret is platform-root trust, documented in `packages/api/src/lib/tenant-membership.ts`.
- **R4.** The admin SPA continues to work end-to-end. No admin-UI code changes are required; the SPA already sends `x-tenant-id` for the active tenant, which satisfies the new membership check as long as the signed-in user is a member.
- **R5.** The genuine AWS Scheduler callback path — `packages/lambda/job-trigger.ts`, invoked directly by EventBridge Scheduler via Lambda SDK (not HTTP) — is out of scope for this sweep; it has no REST surface. All HTTP routes under `scheduled-jobs.ts`, including `/fire` and `/wakeup`, are user-facing and get the full membership check. (Earlier draft of this plan mistakenly treated `/fire` and `/wakeup` as scheduler callbacks; feasibility review corrected the misidentification.)
- **R6.** A shared table-driven test asserts the authz matrix across all 14 handlers: cognito non-member → 403; cognito wrong-role → 403 on mutations; cognito owner/admin → non-401; apikey → non-401; no-auth → 401.
- **R7.** The existing `admin-rest-auth-bridge.test.ts` (from PR #522) continues to pass — the bridge's four credential cases still hold. This plan *extends* that test's guarantee; it doesn't replace it. For the happy-path JWT assertions, the DB mock must be upgraded so the `tenantMembers` lookup returns a valid row — the existing rejecting-proxy mock would produce false-pass 500s after this sweep.
- **R8.** Every by-ID query inside the 14 handlers scopes the WHERE clause by `verdict.tenantId` (the helper-resolved, authoritative tenantId), not by header alone. Specifically: `scheduled-jobs.ts`'s `getScheduledJob`, `getRun`, `cancelRun`, and `listEvents` need `eq(..., tenant_id)` added. Audit equivalents in connections/skills/webhooks-admin during execution. Without this, header-after-verify passes the membership check but a member of tenant A who knows a resource UUID from tenant B can still read/mutate B's row — IDOR.
- **R9.** `GET /api/tenants` (list-all, no `:id` path parameter) must not leak every tenant's name/slug/plan to any authenticated Cognito caller. Either filter results to tenants the caller is an active member of, or restrict the route to apikey-only (for the CLI tenant picker). Pick one and document.
- **R10.** `DELETE /api/invites/:id` (invite id in path, no tenant in path or header) must resolve `invites.tenant_id` via a lookup by `:id` and gate on that tenantId. The plan's "resource-id derivation is deferred" blanket does NOT apply here — this one route has no other tenantId source.
- **R11.** `skills.ts`'s tenant-scoped routes use `x-tenant-slug` (not `x-tenant-id`) as the header. The `requireTenantMembership` call passes the slug; the helper already accepts slug-or-UUID in its first arg. No SPA change.
- **R12.** `invites.ts` GET `/api/invites` with the `?tenantId=...` query-string fallback must pass the same value to `requireTenantMembership` that `listInvites` downstream uses. Either drop the QS fallback (preferred — one caller to audit) or pass the resolved value through both call sites.

---

## Scope Boundaries

- **Not** migrating `messages`, `sandbox-quota-check`, `sandbox-invocation-log`, `github-app`, `github-repos`, or `code-factory` — these are service-to-service or mobile-only routes not reached by the admin SPA; they stay on apikey-only auth and get their own sweep if audited later. (PR #522's bridge touched only the 14 admin-reachable handlers; same list applies here.)
- **Not** restructuring routes. Admin SPA already works; no path changes unless forced.
- **Not** replacing the `x-tenant-id` header contract. The header stays as input; only its trust semantics change.
- **Not** enhancing `requireTenantMembership` itself. The helper's `requiredRoles` option already covers every case this PR needs. Any additions are execution-time-only (and likely unnecessary).
- **Not** resource-id-based tenant derivation. For `connections.ts` and `skills.ts`, the cleaner "look up resource → read its tenant_id → check membership" pattern would eliminate the header-as-input posture. This PR keeps the header-after-verify approach for uniformity; resource-id derivation is a follow-up (see Deferred below).
- **Not** scheduler-callback HMAC hardening (PR C).
- **Not** rotating `API_AUTH_SECRET` — still an outstanding ops task from PR #522's U9.

### Deferred to Follow-Up Work

- **Resource-id tenant derivation** for connections/skills where the resource ID in the URL path already uniquely identifies the owning tenant: ~1 day follow-up PR once this sweep lands.
- **Service-route audit** for messages/github-*/code-factory/sandbox-* to decide whether any are accidentally admin-reachable and need the same treatment.
- **IAM-signed internal requests** to replace the apikey trust boundary for service-to-service callers.

---

## Context & Research

### Relevant Code and Patterns

- **Helper:** `packages/api/src/lib/tenant-membership.ts` — exported `requireTenantMembership(event, tenantIdOrSlug, opts)` returns a verdict object. Two branches:
  - **Cognito** — resolves `users.id` from the JWT, verifies active `tenant_members` row with `role ∈ requiredRoles`. Default `requiredRoles = ["owner", "admin"]`.
  - **Apikey** — bypasses the membership check (platform-root).
- **Existing consumers** (reference implementations to mirror): `packages/api/src/handlers/mcp-admin-keys.ts` and `packages/api/src/handlers/mcp-admin-provision.ts`. Both replaced the old `extractBearerToken` + `validateApiSecret` gate with `requireTenantMembership` wired to the URL-path tenantId. Their route regex + verdict branch are the canonical shape.
- **Auth bridge helper** `packages/api/src/lib/cognito-auth.ts` — `authenticate()` is the lower-level helper that `requireTenantMembership` calls. No change needed.
- **GraphQL-side convention** `packages/api/src/graphql/resolvers/core/authz.ts` — `requireTenantAdmin(ctx, tenantId)` enforces `role ∈ {"owner", "admin"}`. PR B mirrors this convention for REST.
- **Database schema** `packages/database-pg/src/schema/core.ts` — `tenantMembers` has `(tenant_id, principal_type, principal_id, role, status)`. Active members are `status = 'active'`. Roles are strings; current values are `owner`, `admin`, `member`.
- **Existing shared test** `packages/api/src/__tests__/admin-rest-auth-bridge.test.ts` — 56 assertions × 14 handlers from PR #522. New tests should extend its harness, not replace it.

### Handler survey (the sweep target)

Every handler listed here currently reads `x-tenant-id` from the header and trusts it after `authenticate()`. PR B wraps `requireTenantMembership` around that read. Handlers are grouped by risk-adjacent shape:

- **Path-parameter tenantId** (tenantId already in URL): `tenants.ts` (routes like `/api/tenants/:id/members`), `invites.ts` (but with pre-gate public routes — see U1).
- **Straight header-read handlers** (10 — uniform swap): `activity.ts`, `agents.ts`, `agent-actions.ts`, `budgets.ts`, `guardrails-handler.ts`, `routines.ts`, `team-members.ts`, `teams.ts`, `webhooks-admin.ts`, plus `connections.ts` and `skills.ts` (resource-id refinement deferred — header-after-verify is sufficient for this sweep).
- **Scheduler-callback shape** (1 — route-split): `scheduled-jobs.ts` has both user routes (`POST /api/scheduled-jobs`, etc.) and callback routes called by AWS Scheduler (`POST /api/scheduled-jobs/:id/fire`, `/api/trigger-runs/wakeup/:id`). User routes get membership; callbacks stay apikey-only.

### Institutional Learnings

- `feedback_oauth_tenant_resolver.md`: `ctx.auth.tenantId` is null for Google-federated users. `resolveCallerFromAuth` (which `requireTenantMembership` calls internally) falls back to email-based lookup. No extra handling in this PR — the helper already absorbs this quirk.
- `feedback_read_diagnostic_logs_literally.md`: when the test-suite error messages read "expected 403 got 200," read them literally. The gap is usually "the handler didn't swap the gate" or "test hit the apikey path by accident."
- `feedback_merge_prs_as_ci_passes.md`: merge on green for E2E validation.
- `project_enterprise_onboarding_scale.md`: 4 × 100+ agents imminent; this PR is the blocker.

### External References

None. Well-patterned local work.

---

## Key Technical Decisions

- **Header-after-verify is sufficient for this sweep.** For every handler, wrap `requireTenantMembership(event, event.headers["x-tenant-id"], ...)`. The threat model: a cognito caller must (a) pass JWT verification and (b) appear as an active member in the claimed tenant. A member of tenant A who sends `x-tenant-id: B` fails (b) with 403. A non-member sending any value fails. An apikey caller bypasses — that's platform-root trust. Resource-id lookup would be stricter but is gratuitous here; deferred.
- **Required roles default to `["owner", "admin"]` for mutations, widen to include `"member"` for GET reads only.** Matches the GraphQL `requireTenantAdmin` convention for mutations. For reads, widening to member preserves the admin SPA's current user experience for read-only dashboards (where any tenant member can view). Billing/budget reads stay at `["owner", "admin"]` because financial data warrants the narrower bar.
- **scheduled-jobs gets route-split inside the handler, not a separate handler file.** The router already matches `path.match(/^\/api\/scheduled-jobs\/([^/]+)\/fire$/)` for the callback. For the callback branch, skip `requireTenantMembership` entirely — `authenticate()` gave us the apikey `AuthResult` and that's the trust we need. For the user-facing branches, run the membership check on the header-supplied tenantId as usual.
- **Apikey callers bypass the membership check — intentional and documented.** `requireTenantMembership` already encodes this. Do not tighten apikey-bypass in this PR; that requires IAM-signed internal calls, which is a separate, larger design change.
- **One shared table-driven test, not 14 copies.** Extend `admin-rest-auth-bridge.test.ts`'s harness to assert the membership-check matrix. The existing 56-assertion structure already iterates all 14 handlers; adding a membership dimension costs one axis of parametrization.
- **No changes to the `requireTenantMembership` helper signature or behavior.** Every case here is covered by the existing `requiredRoles` option. If an edge surfaces during execution, handle it at the handler, not in the helper.
- **Test error messages must distinguish "not authenticated" (401) from "not authorized" (403).** Helper already returns `status: 401 | 403 | 404`; handlers forward as-is. The existing bridge test only asserted non-401 for success; new test dimension asserts exact status codes for the membership-rejection paths.

---

## Open Questions

### Resolved During Planning

- **Does requireTenantMembership already handle role widening for reads?** Yes — the `requiredRoles` option is an array. Default is `["owner", "admin"]`; callers widen to `["owner", "admin", "member"]` per GET route.
- **How is `tenants.ts` different from the others?** Its path already has `:tenantId`. `requireTenantMembership(event, tenantIdFromPath)` — no header read needed. Same for the sub-routes (`/api/tenants/:tenantId/members` etc).
- **Does invites.ts have public routes that must stay below the auth gate?** Yes, per PR #522: `GET /api/invites/:token`, `POST /api/invites/:token/accept`, `POST /api/join-requests/:id/claim-api-key`. Keep them positioned above the membership check.
- **Does skills.ts have a pre-auth OAuth branch?** Yes — the MCP OAuth callback flow. Position-sensitive: stays above the membership check.
- **Does scheduled-jobs really need route-split?** Yes. AWS Scheduler calls `/api/scheduled-jobs/:id/fire` with the shared apikey, not a Cognito JWT. Wrapping requireTenantMembership around that route would 403 every scheduled job trigger. Only user-facing routes (list/create/update/delete) get the membership check.
- **Does the admin SPA send x-tenant-id on every call?** Yes, verified. Every migrated call site in PR #522 either passes it via `extraHeaders` or it's part of the original route's headers. No SPA changes needed in PR B.

### Deferred to Implementation

- **Per-handler role overrides.** A few handlers may want to escalate reads to admin-only (e.g., `budgets.ts` GET — financial data). Decide per-handler during execution; default to the table below and adjust if a reviewer flags it.
- **Exact error message shape for 403s.** `requireTenantMembership` returns a human-readable `reason` string. Whether handlers forward it verbatim or rewrite for consistency is a per-handler call during U2.

---

## High-Level Technical Design

> *Directional guidance, not implementation specification. The implementer should treat the shape below as context, not code to reproduce.*

Per-handler transformation (applies to every handler in U1-U3, with per-handler variations called out inline):

```
BEFORE (current, post-PR #522):
  const auth = await authenticate(event.headers);
  if (!auth) return unauthorized();
  const tenantId = event.headers["x-tenant-id"];
  if (!tenantId) return error("Missing x-tenant-id header");
  // ...handler body uses tenantId...

AFTER (this PR):
  const tenantHeader = event.headers["x-tenant-id"];       // or path parameter, or route-specific source
  if (!tenantHeader) return error("Missing x-tenant-id header");
  const verdict = await requireTenantMembership(
    event,
    tenantHeader,
    { requiredRoles: [...required...] },                    // per-route (default owner/admin; widen for reads)
  );
  if (!verdict.ok) return error(verdict.reason, verdict.status);
  const tenantId = verdict.tenantId;                        // authoritative; resolved+verified by the helper
  // ...handler body uses tenantId...
```

Per-handler read/write role table (guidance; implementer adjusts if a route has unusual sensitivity):

| Handler | GET role bar | Mutation role bar |
|---|---|---|
| activity | `owner`,`admin`,`member` | `owner`,`admin` |
| agents | `owner`,`admin`,`member` | `owner`,`admin` |
| agent-actions | `owner`,`admin`,`member` | `owner`,`admin` |
| budgets | `owner`,`admin` (financial) | `owner`,`admin` |
| connections | `owner`,`admin`,`member` | `owner`,`admin` |
| guardrails-handler | `owner`,`admin`,`member` | `owner`,`admin` |
| invites | `owner`,`admin` (PII) | `owner`,`admin` |
| routines | `owner`,`admin`,`member` | `owner`,`admin` |
| scheduled-jobs (user routes) | `owner`,`admin`,`member` | `owner`,`admin` |
| scheduled-jobs (callback routes) | N/A — apikey only | N/A — apikey only |
| skills | `owner`,`admin`,`member` | `owner`,`admin` |
| team-members | `owner`,`admin`,`member` | `owner`,`admin` |
| teams | `owner`,`admin`,`member` | `owner`,`admin` |
| tenants | `owner`,`admin`,`member` | `owner`,`admin` |
| webhooks-admin | `owner`,`admin`,`member` | `owner`,`admin` |

---

## Implementation Units

- [ ] U1. **Path-parameter and lookup-derived handlers: tenants + invites**

**Goal:** Gate every gated route in `tenants.ts` and `invites.ts`. Most tenantIds come from the URL path; two routes need special handling: `GET /api/tenants` (list-all, no path tenantId) and `DELETE /api/invites/:id` (invite id only, tenantId must be looked up).

**Requirements:** R1, R2, R4, R9, R10, R12

**Dependencies:** None

**Files:**
- Modify: `packages/api/src/handlers/tenants.ts`
- Modify: `packages/api/src/handlers/invites.ts`

**Approach:**
- `tenants.ts`:
  - Sub-routes `/api/tenants/:id/...`: extract `tenantIdFromPath` from the match; `requireTenantMembership(event, tenantIdFromPath, { requiredRoles: method === "GET" ? ["owner", "admin", "member"] : ["owner", "admin"] })`. Replace downstream `event.headers["x-tenant-id"]` reads with `verdict.tenantId`.
  - `GET /api/tenants/by-slug/:slug`: same shape as sub-routes, pass the slug to `requireTenantMembership` (the helper accepts slug or UUID).
  - `GET /api/tenants` (list-all, no path tenantId): **filter to caller's memberships**. After `authenticate()`, if `auth.authType === "apikey"` → return full list (CLI tenant picker keeps working for ops). Otherwise resolve caller's `users.id` via `resolveCallerFromAuth(auth)` and filter the SELECT to only tenants where an active `tenant_members` row exists for that user. Empty result is fine. Rationale: platform-root trust keeps the ops surface; end users see only what they can act on. Closes the current "any Cognito caller can enumerate every tenant" leak.
- `invites.ts`:
  - Public pre-gate routes (`GET /api/invites/:token`, `POST /api/invites/:token/accept`, `POST /api/join-requests/:id/claim-api-key`, `GET /api/invites/:token/onboarding.txt`) stay positioned above the membership check — the token in the URL is its own authorization. Do NOT run `requireTenantMembership` on these; they are pre-auth by design.
  - `GET /api/invites` (list): currently accepts tenantId from `x-tenant-id` header OR `event.queryStringParameters?.tenantId`. **Drop the QS fallback** — one less client-controllable source. Pass the header value to `requireTenantMembership`, then use `verdict.tenantId` downstream.
  - `POST /api/invites` (create), `POST /api/tenants/:tenantId/invites` (create with path): read tenantId from path where present, from header otherwise; membership-check the resolved value.
  - `DELETE /api/invites/:id` (invite id in path, no tenantId anywhere): **look up `invites.tenant_id` first**, then call `requireTenantMembership(event, lookedUpTenantId, { requiredRoles: ["owner", "admin"] })`. If the invite doesn't exist → 404 before any auth check (preserves existing behavior). If the caller isn't a member of the owning tenant → 403. Refactor `revokeInvite(id)` to accept `event` so the membership-check branches with access to the resolved verdict.
- Do NOT add membership checks to the public-token routes — invite acceptance is how non-members become members.

**Patterns to follow:**
- `packages/api/src/handlers/mcp-admin-keys.ts`: the canonical example. Path-parameter tenantId + verdict extraction.

**Test scenarios:**
- Happy path: cognito owner on `GET /api/tenants/:id/members` → returns members list.
- Happy path: cognito owner on `POST /api/tenants/:id/members` → creates member.
- Happy path: cognito member on `GET /api/tenants/:id/members` → returns members list (widened read role).
- Error path: cognito member on `POST /api/tenants/:id/members` → 403 (insufficient role).
- Error path: cognito non-member on any `/api/tenants/:id/*` route → 403.
- Error path: no auth on any `/api/tenants/:id/*` → 401.
- Invites public path: `GET /api/invites/:token` with no auth → succeeds (pre-gate route, no check).
- Invites gated path: cognito non-member of X calling `GET /api/tenants/X/invites` → 403.
- Apikey path: `Authorization: Bearer <API_AUTH_SECRET>` on any route → bypasses membership check (platform-root).

**Verification:**
- `packages/api/src/handlers/tenants.ts` and `invites.ts` no longer read `event.headers["x-tenant-id"]` as authoritative inside gated routes.
- Existing `admin-rest-auth-bridge.test.ts` still passes (the bridge-level credential cases are not affected).

---

- [ ] U2. **Straight header-read handlers (11 handlers, uniform swap)**

**Goal:** Wrap `requireTenantMembership` around the header tenantId read for every handler that follows the simple `authenticate() → header tenantId` pattern.

**Requirements:** R1, R2, R3, R4, R6

**Dependencies:** None (can run in parallel with U1, U3)

**Files:**
- Modify: `packages/api/src/handlers/activity.ts`
- Modify: `packages/api/src/handlers/agents.ts`
- Modify: `packages/api/src/handlers/agent-actions.ts`
- Modify: `packages/api/src/handlers/budgets.ts`
- Modify: `packages/api/src/handlers/connections.ts`
- Modify: `packages/api/src/handlers/guardrails-handler.ts`
- Modify: `packages/api/src/handlers/routines.ts`
- Modify: `packages/api/src/handlers/skills.ts` (preserve MCP-OAuth pre-gate branch positioned above the membership check)
- Modify: `packages/api/src/handlers/team-members.ts`
- Modify: `packages/api/src/handlers/teams.ts`
- Modify: `packages/api/src/handlers/webhooks-admin.ts`

**Approach:**
- For each handler: after `authenticate()` succeeds, read `x-tenant-id` from the header (preserve the existing "Missing x-tenant-id header" 400 response when absent), then call `requireTenantMembership(event, tenantHeader, { requiredRoles })`. The `requiredRoles` is per-method: GET gets `["owner", "admin", "member"]`; other methods get `["owner", "admin"]`. (`budgets.ts` escalates GET to `["owner", "admin"]` — see decision table.)
- Replace all downstream `tenantId` reads with `verdict.tenantId` (helper-resolved, authoritative).
- For `skills.ts`: 20 tenant-scoped routes read `x-tenant-slug` (not `x-tenant-id`), and 3 routes read `x-tenant-id` for principal-scoped operations (MCP OAuth flows). Pass the correct header per-route to `requireTenantMembership` — the helper accepts slug or UUID as its second arg. Specifically: for the tenantSlug routes, the call is `requireTenantMembership(event, tenantSlug, { ... })`; for the x-tenant-id routes, `requireTenantMembership(event, event.headers["x-tenant-id"], { ... })`. The MCP-OAuth pre-gate branch stays positioned above the membership check. The apikey acceptance for AppSync-key callers already goes through `authenticate()` → apikey `AuthResult`; those callers bypass the membership check per the helper's documented apikey branch.
- For `connections.ts`: the `authenticate()` gate from PR #522 already supplanted the old permissive `!apiKey` check. This PR adds the membership wrap with no additional permissiveness concern.

**Execution note:** Use one subagent for all 11 handlers — the swap is uniform and mechanical. Each handler is 2 small edits: the gate wrap + replacing `tenantId = ...header...` with `tenantId = verdict.tenantId`. Batch them per U7b's pattern in PR #522.

**Patterns to follow:**
- `packages/api/src/handlers/mcp-admin-keys.ts`: the canonical pattern for tenantId-from-path + requireTenantMembership. This PR's handlers use tenantId-from-header instead, but the verdict extraction and downstream usage are identical.
- PR #522's U7b batch swap approach (documented in this repo's commit history at `5c79602`): 11 handlers, one sub-agent pass, shared test file.

**Test scenarios:**
- For each handler (covered by the shared U4 test; scenarios enumerated here for completeness):
  - Happy path: cognito member (`GET` routes) or cognito admin (all routes) with `x-tenant-id` matching their tenant → non-401 status.
  - Error path: cognito member attempting a mutation (POST/PUT/PATCH/DELETE) → 403 with `reason` matching `/lacks privilege/i`.
  - Error path: cognito caller with `x-tenant-id` set to a tenant they don't belong to → 403 with `reason` matching `/not a member/i`.
  - Error path: cognito caller with `x-tenant-id` missing → 400 "Missing x-tenant-id header".
  - Error path: cognito caller with suspended membership → 403.
  - Happy path: apikey caller (Authorization Bearer `<API_AUTH_SECRET>` or `x-api-key`) → bypasses membership check, handler proceeds.
  - Integration: the handler's downstream `tenantId` usage is the verdict's resolved id, not the raw header (protects against header-manipulation cases where the header holds a slug but the handler expected a UUID).
- `connections.ts`-specific: cognito member reading their tenant's connections list → non-401; cognito non-member → 403 regardless of `x-api-key` being set (tightens PR #522's tightening).
- `skills.ts`-specific: MCP-OAuth callback routes (`/api/skills/mcp-oauth/*`) remain reachable without any auth; the membership check only applies to the gated routes.
- `budgets.ts`-specific: cognito member on GET → 403 (financial data is owner/admin only).

**Verification:**
- Shared `admin-rest-auth-bridge.test.ts` (extended in U4) is green for every handler × every credential case.
- `grep -nE "event\.headers\[.x-tenant-id.\]" packages/api/src/handlers/` shows only handlers where the header is an *input to the membership check*, never a downstream authoritative value.

---

- [ ] U3. **scheduled-jobs: full membership check on every HTTP route + tenant-scope every by-ID query**

**Goal:** Every HTTP route in `scheduled-jobs.ts` gets a membership check — including `/fire` and `/wakeup` which are admin-SPA mutations, NOT scheduler callbacks (AWS Scheduler invokes `packages/lambda/job-trigger.ts` directly via Lambda SDK, never via HTTP). Plus: add `tenant_id` scoping to the four by-ID queries that currently query by id alone.

**Requirements:** R1, R2, R5, R8

**Dependencies:** None

**Files:**
- Modify: `packages/api/src/handlers/scheduled-jobs.ts`

**Approach:**
- No route-split: every HTTP route — `POST /api/scheduled-jobs`, `PATCH /api/scheduled-jobs/:id`, `DELETE /api/scheduled-jobs/:id`, `POST /api/scheduled-jobs/:id/fire`, `POST /api/thread-turns/wakeup/:agentId`, `GET /api/scheduled-jobs`, `GET /api/scheduled-jobs/:id`, `GET /api/thread-turns/:id`, `POST /api/thread-turns/:id/cancel`, `GET /api/thread-turns/:id/events` — goes through `requireTenantMembership` (GET = member-readable per the role table, mutations = owner/admin).
- Add `tenant_id` scoping to four by-ID queries that currently only match by id:
  - `getScheduledJob(id)` (~L228): add `eq(scheduledJobs.tenant_id, tenantId)` to the WHERE clause.
  - `getRun(id)` (~L523): add `eq(threadTurns.tenant_id, tenantId)` to the WHERE clause.
  - `cancelRun(id)` (~L529): add `eq(threadTurns.tenant_id, tenantId)` to the WHERE clause.
  - `listEvents(runId, …)` (~L544): join through `threadTurns` on `(id = runId AND tenant_id = tenantId)` before returning events, OR pass tenantId and enforce a pre-flight check that the run belongs to the caller's tenant.
- Pass the `verdict.tenantId` (helper-resolved, authoritative) to each function. Function signatures grow by one argument.
- Non-404 failures (e.g., member of tenant A asking for a job owned by tenant B) return 404, not 403 — don't leak tenant-resource existence. The membership check already returned 403 if the caller wasn't a member of the header-claimed tenant; past that, a missing-in-your-tenant row is a genuine "not found" from the caller's perspective.

**Execution note:** Verify with a `grep -nE "where\(eq\(scheduledJobs\.id|where\(eq\(threadTurns\.id" scheduled-jobs.ts` pre-and-post the change — the post-edit result should have zero occurrences of a WHERE clause that compares an id without ALSO comparing `tenant_id`.

**Patterns to follow:**
- `updateScheduledJob`, `deleteScheduledJob`, `fireScheduledJob` in the same file — these already scope by `(id, tenant_id)`. Mirror their WHERE shape on the four by-ID reads.

**Test scenarios:**
- Happy path: `POST /api/scheduled-jobs` with cognito admin + `x-tenant-id` of own tenant → 201.
- Happy path: `POST /api/scheduled-jobs/:id/fire` with cognito admin of the job's own tenant → 200.
- Error path: `POST /api/scheduled-jobs/:id/fire` with cognito member (non-admin) of own tenant → 403 (mutation requires admin).
- Error path: `POST /api/scheduled-jobs/:id/fire` with cognito admin of tenant A against a job owned by tenant B → 404 (IDOR closed).
- Error path: `GET /api/scheduled-jobs/:id` with cognito member of tenant A against a job owned by tenant B → 404 (not 403 — no resource-existence leak).
- Error path: `POST /api/thread-turns/:id/cancel` with cognito admin of tenant A against a run owned by tenant B → 404.
- Error path: `GET /api/thread-turns/:id/events` with cognito member of tenant A against a run owned by tenant B → 404 or empty events array (per handler convention).
- Apikey path: `POST /api/scheduled-jobs/:id/fire` with apikey → 200 (platform-root bypass; CI can still manually trigger jobs).
- Error path: no auth on any route → 401.

**Verification:**
- `grep` shows no by-ID WHERE clause in scheduled-jobs.ts that omits tenant_id.
- User-facing CRUD routes reject cross-tenant access.
- Manual fire + manual cancel still work from the admin SPA against jobs/runs in the caller's tenant.

---

- [ ] U4. **Extend admin-rest-auth-bridge.test.ts with the membership matrix**

**Goal:** Single table-driven test asserting the full auth matrix (JWT-member/JWT-admin/JWT-nonmember/JWT-wrongrole/apikey/none) × 14 handlers × read-vs-write routes.

**Requirements:** R1, R2, R3, R6, R7

**Dependencies:** U1, U2, U3 (tests assert the behavior those units establish)

**Files:**
- Modify: `packages/api/src/__tests__/admin-rest-auth-bridge.test.ts`

**Approach:**
- Extend the existing test file (don't create a parallel one). Current file uses a table: 14 handlers × 4 credential cases = 56 assertions. Add three new credential cases per handler: `cognito-member-not-admin`, `cognito-nonmember`, and (for mutations) `cognito-member-on-mutation`. New total: 14 × 7 = 98 assertions approximately, depending on which handlers expose mutations.
- Stub `requireTenantMembership` at the vi.mock layer for the new cases so the handlers receive predictable verdicts. The existing mock already stubs `CognitoJwtVerifier`; add a `@thinkwork/database-pg` mock for `tenantMembers` queries that returns the right membership row per test case.
- Critical property: for each new failure case, assert both the status code AND the `reason` string (via the body). `reason` is what ops sees in logs — pinning it prevents regressions to terse messages.
- Preserve every existing assertion in the file — the bridge-level cases are the foundation this PR builds on.

**Patterns to follow:**
- Existing `admin-rest-auth-bridge.test.ts` (from PR #522) — table-driven shape, vi.hoisted mocks, handler-import wiring.
- `packages/api/src/__tests__/tenant-membership.test.ts` — unit tests for the helper itself. Its mock setup for `tenantMembers` + `getDb` is the template for what this test needs.

**Test scenarios:** (each listed once as a property of the shared test, not repeated per handler)

- Happy path: cognito admin on any handler + matching `x-tenant-id` → gate crossed (non-401 status, not 403).
- Happy path: cognito member on GET routes (widened roles) → gate crossed.
- Happy path: apikey on any handler (Authorization Bearer or x-api-key) → gate crossed.
- Error path: cognito member on a mutation route → 403, reason matches `/lacks privilege/i`.
- Error path: cognito caller with `x-tenant-id` for a tenant they're not a member of → 403, reason matches `/not a member/i`.
- Error path: cognito caller with `x-tenant-id` missing → 400 "Missing x-tenant-id header".
- Error path: no auth header → 401.
- Edge case: cognito caller whose `tenant_members.status = 'suspended'` → 403.
- Integration: for one representative handler, assert that `verdict.tenantId` (not the raw header) is what the handler downstream uses — write a test that sends a slug in the header and confirms the handler queried the DB with the resolved UUID.

**Verification:**
- `pnpm --filter @thinkwork/api exec vitest run src/__tests__/admin-rest-auth-bridge.test.ts` green.
- Full api package tests stay green (`pnpm --filter @thinkwork/api test`).

---

- [ ] U5. **Post-deploy smoke + documentation update**

**Goal:** Verify the SPA still works end-to-end against dev after the sweep deploys, and update memory + docs to reflect the closed gap.

**Requirements:** R4

**Dependencies:** U1, U2, U3, U4 (post-deploy step)

**Files:**
- Modify: `docs/solutions/security/admin-secret-in-bundle-remediation-2026-04-24.md` (append PR-B-closes-follow-up note)
- Modify (memory, external to repo): `project_enterprise_onboarding_scale.md` — reflect that PR B has shipped and the enterprise-onboarding block is lifted.

**Approach:**
- Deploy to dev via the standard pipeline.
- Manual walkthrough of the admin SPA in a real browser — same 6 surfaces as PR #522's U8 (dashboard, sidebar counts, scheduled-job CRUD, webhook CRUD, skills view, guardrail view). Confirm every fetch succeeds with the caller's existing Cognito session.
- Cross-tenant rejection verification: in a dev-only test, use a second dev user's JWT to forge `x-tenant-id: <first-user's-tenant>` against any handler → expect 403. (If a second dev user isn't available, use curl with a valid JWT but set `x-tenant-id` to an impostor tenant UUID — same outcome.)
- CLI back-compat: `thinkwork mcp key create -t <own-tenant>` against dev still works — apikey path preserved.
- Append a short "PR B status: merged 2026-04-DD, enterprise-onboarding block lifted" note to the PR #522 solutions doc.
- Update `project_enterprise_onboarding_scale.md` memory.

**Test scenarios:**
- Manual walkthrough only (not automated). Failure mode is either "SPA feature broke" (unlikely — no SPA changes), "cross-tenant still works" (indicates U1/U2/U3 missed a handler), or "CLI broke" (indicates apikey path regressed).

**Verification:**
- No admin SPA regressions. Cross-tenant request returns 403. CLI still works. Memory + solutions doc updated.

---

## System-Wide Impact

- **Interaction graph:** Every admin REST endpoint now calls `requireTenantMembership` in its auth gate. The helper queries `tenant_members` once per request (one more round-trip vs. pre-sweep). Per-request latency impact: negligible (~5-10ms DB RTT, well within existing API latency budget for admin-REST routes).
- **Error propagation:** Handlers return `verdict.reason` directly. 403 responses carry `{ "error": "<reason-string>" }`. Admin SPA's existing error handling already surfaces these as toasts; no UI change needed.
- **State lifecycle risks:** None. The only state the helper touches is a read on `tenant_members`. No caching introduced; no write-path contention.
- **API surface parity:** No public API contract change. Routes, payload shapes, and status codes remain stable. The 403 path is new (previously the header was blindly trusted) but discoverable through standard HTTP semantics.
- **Integration coverage:** U4's shared test covers the cross-cutting membership-check behavior. The per-handler test files from pre-existing coverage verify handler-specific body logic.
- **Unchanged invariants:**
  - Apikey callers continue to bypass the membership check. No change for CI/CLI/Strands.
  - GraphQL resolvers (which already use `requireTenantAdmin`) are unaffected.
  - AWS Scheduler callbacks continue to work via the scheduled-jobs route-split.
  - `admin-rest-auth-bridge.test.ts`'s existing 56 assertions stay in place and green.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| A handler's existing test suite has a case that sends `x-tenant-id` for a tenant the mocked Cognito user doesn't belong to → the test starts failing 403 post-sweep. | Tests are table-driven in U4's shared file; per-handler tests that expect success on cross-tenant requests are almost certainly testing against stale behavior. Audit each 403 during U4 execution and either update the test's tenantId or document the intentional failure. |
| Cognito caller whose JWT claims a tenant via `custom:tenant_id` that differs from the `x-tenant-id` header. | Helper uses the header (or path) as the target — NOT the JWT's claim. Caller must be a member of whatever is in `x-tenant-id`, regardless of JWT claim. This is the correct behavior: JWT attests identity, not target-tenant permissions. |
| scheduled-jobs callback route gets JWT accidentally instead of apikey (e.g., a dashboard button sends a Cognito call to `/fire` for a manual trigger). | Route-split in U3 accepts both JWT and apikey on callback routes — no regression. Only the user-facing routes enforce membership. |
| Admin SPA's active tenant is desynced from what the user's membership says (e.g., stale session after being removed from a tenant). | User gets 403, which surfaces as a toast. Session refresh on next login clears the stale active tenant. No data leak. |
| CI / CLI sends x-api-key with a value that's accidentally interpreted as a Cognito JWT. | Helper's apikey branch is authoritative when the JWT branch rejects. Order of precedence in `cognito-auth.ts`: JWT first, apikey second, Bearer-as-apikey third. An ambiguous bearer value can't accidentally promote to Cognito. |
| Unit count is 5 but the change touches 14+ files. Large diff, reviewer fatigue. | U2's uniform-swap approach mirrors PR #522's U7b (which landed cleanly in one commit with a sub-agent). The per-handler change is 4-6 lines; the bulk is ceremony not logic. |

---

## Documentation / Operational Notes

- **No runbook changes needed** — the behavior is transparent to operators. 403s from cross-tenant attempts are a new log shape but immediately self-documenting (`reason` string carries the diagnosis).
- **Memory update (external):** `project_enterprise_onboarding_scale.md` — mark the v1 security gate as closed.
- **Cross-reference:** PR #522's solutions doc gets a trailer note confirming PR B closed the residual.

---

## Sources & References

- Origin: PR #522's Scope Boundaries / Deferred to Follow-Up Work section names this PR explicitly.
- Related code: `packages/api/src/lib/tenant-membership.ts`, `packages/api/src/handlers/mcp-admin-keys.ts`, `packages/api/src/handlers/mcp-admin-provision.ts`, `packages/api/src/__tests__/admin-rest-auth-bridge.test.ts`.
- Related PRs: #518 (helper), #522 (bridge).
- Memory: `project_enterprise_onboarding_scale.md`, `feedback_oauth_tenant_resolver.md`, `feedback_merge_prs_as_ci_passes.md`.
