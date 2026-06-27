---
title: fix: Restore local thread memory event detail and GraphQL auth fallback
type: fix
status: active
date: 2026-06-27
---

# fix: Restore local thread memory event detail and GraphQL auth fallback

## Overview

Local development thread detail should be able to load turn event rows for expanded memory/tool details, and local GraphQL queries such as `tenantAgent` and `tenantMentionTargets` should fail clearly on stale user sessions while still accepting the runtime-config-backed private service-secret fallback used by deployed service clients.

This plan fixes two related local-dev symptoms discovered during THINK-92 validation:

- The thread detail event fetch reports a browser CORS error because the web app calls an unregistered REST route.
- Tenant-agent GraphQL calls can surface as opaque HTTP 500 responses when local tokens are stale or when private service-secret fallback is expected.

---

## Problem Frame

The Thread detail UI renders memory detail from persisted usage JSON, but it also fetches turn events via the scheduled-jobs REST handler. In local dev, that fetch targeted `/api/trigger-runs/:id/events`; API Gateway exposed `/api/thread-turns/*`, so the actual GET returned an API Gateway `404 {"message":"Not Found"}` without the Lambda CORS headers. The browser reported this as CORS, masking the missing route.

Separately, tenant agent and mention target GraphQL calls looked like resolver failures, but CloudWatch showed `Error: Unauthorized` from GraphQL context creation. Stale Cognito bearer tokens were being masked into generic HTTP 500 responses, and private service-secret fallback was broken because `API_AUTH_SECRET` had moved out of Lambda env and into runtime-config secret accessors.

---

## Requirements Trace

- R1. Thread detail must request the canonical REST route for turn events so local and deployed API Gateway routing agree.
- R2. The scheduled-jobs handler should remain backward compatible with legacy `/api/trigger-runs/*` callers until cached clients age out.
- R3. GraphQL authentication failures must surface as coded `UNAUTHENTICATED` GraphQL errors rather than masked internal server errors.
- R4. GraphQL HTTP auth must accept runtime-config-backed private service secrets after those values leave Lambda env, while keeping public AppSync API keys scoped to AppSync subscriptions only.
- R5. Focused tests must cover route matching, auth fallback, and the affected thread detail request path.

---

## Scope Boundaries

- Do not redesign tenant-agent authorization or relax admin/member checks.
- Do not reintroduce plaintext `GRAPHQL_API_KEY`, `API_AUTH_SECRET`, or `THINKWORK_API_SECRET` as Lambda env requirements.
- Do not change the memory detail UI presentation beyond restoring its event fetch path.
- Do not change Hindsight memory persistence or recall behavior.

---

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/components/workbench/SpacesThreadDetailRoute.tsx` uses `apiFetch` to load per-turn events and already passes `x-tenant-id`.
- `packages/api/src/handlers/scheduled-jobs.ts` owns scheduled job and thread-turn REST routes and returns shared CORS headers through `packages/api/src/lib/response.ts`.
- `terraform/modules/app/lambda-api/handlers.tf` is the source of API Gateway route-to-handler mappings.
- `packages/api/src/graphql/context.ts` creates GraphQL request context and currently controls whether authentication failure is coded or generic.
- `packages/api/src/lib/cognito-auth.ts` accepts Cognito JWT, service bearer, and `x-api-key` auth paths.
- `packages/runtime-config/src/loader.ts` provides `getApiAuthSecret()` after secrets moved out of direct env reads. `getAppsyncApiKey()` remains for the subscription channel only.

### Institutional Learnings

- `docs/solutions/integration-issues/lambda-options-preflight-must-bypass-auth-2026-04-21.md`: browser CORS symptoms can hide auth/route mistakes; Lambda responses need consistent CORS, but preflight success alone does not prove the actual route exists.
- `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md`: service-auth paths should be explicit and narrow, rather than widening user-context resolver behavior.
- `docs/solutions/security/rotate-api-auth-secret-2026-04-24.md`: shared service secrets are high leverage and should remain centralized; avoid broadening their use or leaking them to client bundles.

### External References

- Not used. Local code and existing ThinkWork runtime-config/security patterns are sufficient.

---

## Key Technical Decisions

- Use `/api/thread-turns/:id/events` as the web client's canonical route because Terraform already exposes `/api/thread-turns/*` and the handler comments describe thread-turn routes.
- Keep `/api/trigger-runs/*` as a server-side alias in both the Lambda route matcher and Terraform routes so old clients fail gracefully during rollout.
- Throw a `GraphQLError` with `extensions.code = "UNAUTHENTICATED"` from GraphQL context creation so Yoga does not mask auth failure as a generic internal error.
- Read accepted private service keys through `getApiAuthSecret()` instead of direct env-only reads so the code matches the runtime-config secret migration. Public AppSync keys remain available to the subscription client but are not GraphQL HTTP service credentials.

---

## Open Questions

### Resolved During Planning

- Should the fix add CORS headers to API Gateway 404s or correct the route? Correct the route. The live preflight succeeds, while the actual GET misses API Gateway routing.
- Should GraphQL tenant-agent resolver logic change? No. Logs show authentication fails before resolver execution when local credentials are stale or fallback secrets are not accepted.

### Deferred to Implementation

- Whether deployed validation can use a refreshed Cognito browser session or private service-secret path first: implementation can choose the quickest safe validation after deploy.

---

## Implementation Units

- U1. **Align Thread Turn Event Routing**

**Goal:** Restore thread detail event fetching by using the canonical route and keeping a legacy alias.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Modify: `apps/web/src/components/workbench/SpacesThreadDetailRoute.tsx`
- Modify: `packages/api/src/handlers/scheduled-jobs.ts`
- Modify: `terraform/modules/app/lambda-api/handlers.tf`
- Test: `apps/web/src/components/workbench/SpacesThreadDetailRoute.test.tsx`
- Test: `packages/api/src/handlers/scheduled-jobs.test.ts`

**Approach:**
- Change the web fetch path from `/api/trigger-runs/:id/events` to `/api/thread-turns/:id/events`.
- Add a small shared route matcher in the scheduled-jobs handler that accepts both `/api/thread-turns` and `/api/trigger-runs`.
- Add Terraform route mappings for `/api/trigger-runs` and `/api/trigger-runs/{proxy+}` as a compatibility alias.

**Patterns to follow:**
- Existing REST handler route checks in `packages/api/src/handlers/scheduled-jobs.ts`.
- Existing `apiFetch` expectations in `apps/web/src/components/workbench/SpacesThreadDetailRoute.test.tsx`.

**Test scenarios:**
- Web thread detail calls `/api/thread-turns/<turn-id>/events?limit=500` with `x-tenant-id`.
- Route matcher extracts the run id for `/api/thread-turns/<turn-id>/events`.
- Route matcher extracts the run id for legacy `/api/trigger-runs/<turn-id>/events`.
- Terraform formatting remains valid after adding API Gateway aliases.

**Verification:** Expanded thread detail can request event rows through the canonical route without API Gateway 404/CORS masking.

- U2. **Make GraphQL Auth Failures Explicit**

**Goal:** Prevent stale or missing authentication from being reported as a generic internal GraphQL failure.

**Requirements:** R3

**Dependencies:** None

**Files:**
- Modify: `packages/api/src/graphql/context.ts`
- Test: `packages/api/src/graphql/context.test.ts`

**Approach:**
- Replace generic `Error("Unauthorized")` from context creation with a `GraphQLError("Authentication required", { extensions: { code: "UNAUTHENTICATED" } })`.
- Keep resolver authorization behavior unchanged.

**Patterns to follow:**
- Existing coded GraphQL errors in `packages/api/src/graphql/resolvers/core/authz.ts`.
- Existing Yoga masking configuration in `packages/api/src/graphql/server.ts`.

**Test scenarios:**
- When `authenticate()` returns null, `createContext()` rejects with message `Authentication required` and extension code `UNAUTHENTICATED`.
- The error remains a GraphQL error object rather than a plain JavaScript `Error`.

**Verification:** Stale local credentials produce a clear GraphQL auth failure instead of HTTP 500 `Unexpected error`.

- U3. **Restore Runtime-Config-Backed Service-Secret Auth**

**Goal:** Ensure GraphQL HTTP accepts private service secrets after secret-class values move out of Lambda env.

**Requirements:** R4

**Dependencies:** U2

**Files:**
- Modify: `packages/api/src/lib/cognito-auth.ts`
- Test: `packages/api/src/lib/cognito-auth.test.ts`

**Approach:**
- Include `getApiAuthSecret()` in `acceptedApiKeys()`.
- Keep public `GRAPHQL_API_KEY` / `APPSYNC_API_KEY` values out of HTTP service auth and reserve them for AppSync subscriptions.
- Keep Cognito JWT verification first, with service/API-key fallback only when JWT verification fails or no bearer is provided.

**Patterns to follow:**
- Secret accessors from `packages/runtime-config/src/loader.ts`.
- Existing service-auth behavior tests in `packages/api/src/lib/cognito-auth.test.ts`.

**Test scenarios:**
- `x-api-key` matching runtime-config API auth secret authenticates as service when no principal/agent identity headers are present.
- Bearer token matching runtime-config API auth secret authenticates as service.
- Public AppSync API keys are rejected by GraphQL HTTP service auth.
- Existing env-backed service secret tests continue to pass.
- Wrong API keys and malformed JWTs remain rejected.

**Verification:** Local GraphQL calls with a refreshed Cognito token or private service secret no longer fail context authentication solely because Lambda env secret copies are absent, while public subscription keys do not grant HTTP service access.

- U4. **Focused Validation**

**Goal:** Prove the fix across API, web, type, and Terraform surfaces.

**Requirements:** R5

**Dependencies:** U1, U2, U3

**Files:**
- Test: `packages/api/src/lib/cognito-auth.test.ts`
- Test: `packages/api/src/graphql/context.test.ts`
- Test: `packages/api/src/handlers/scheduled-jobs.test.ts`
- Test: `apps/web/src/components/workbench/SpacesThreadDetailRoute.test.tsx`
- Test: `terraform/modules/app/lambda-api/handlers.tf`

**Approach:**
- Run focused API and web tests for the affected surfaces.
- Run API and web typechecks because the changes touch shared auth and React component code.
- Run `terraform fmt -check` on the touched Terraform file.
- After deploy, validate the canonical event route and GraphQL auth behavior against the deployed dev API.

**Patterns to follow:**
- AGENTS.md verification guidance for local web and deployed stack realities.

**Test scenarios:**
- Focused API tests pass for auth and route behavior.
- Focused web thread detail test passes for event fetch route.
- Typecheck passes for API and web packages.
- Terraform route file remains formatted.

**Verification:** The implementation has green focused checks and a clear post-deploy validation path.

---

## System-Wide Impact

- Browser users benefit from restored thread event detail loading in local dev and deployed clients after rollout.
- Operators get clearer GraphQL auth diagnostics when a local session token is stale.
- Runtime-config migration remains intact because auth reads secrets through the existing accessors rather than reinstating env-only dependencies.

---

## Risk Analysis & Mitigation

- **Risk:** Accepting AppSync API keys through GraphQL HTTP could broaden service access.
  **Mitigation:** Do not accept `GRAPHQL_API_KEY`, `APPSYNC_API_KEY`, or `getAppsyncApiKey()` values for GraphQL HTTP service auth; keep them scoped to AppSync subscriptions.
- **Risk:** Legacy `/api/trigger-runs` alias could outlive its usefulness.
  **Mitigation:** Keep it as rollout compatibility; remove later only after clients no longer reference it.
- **Risk:** Auth error handling might expose too much detail.
  **Mitigation:** The message is generic (`Authentication required`) and uses a standard auth error code.

---

## Rollout Notes

- Merging code is not enough for the REST alias; Terraform deploy must apply API Gateway route changes.
- After deploy, validate:
  - `/api/thread-turns/<turn-id>/events?limit=500` returns Lambda JSON/CORS behavior instead of API Gateway 404.
  - `/api/trigger-runs/<turn-id>/events?limit=500` also reaches the Lambda compatibility path.
  - `tenantAgent` and `tenantMentionTargets` GraphQL calls with a refreshed Cognito token return data or a coded auth error, and public AppSync API keys do not authenticate as HTTP service callers.
