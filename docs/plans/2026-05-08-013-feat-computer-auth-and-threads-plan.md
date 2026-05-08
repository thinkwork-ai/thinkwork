---
title: 'feat: auth + real threads + working New Thread CTA on apps/computer'
type: feat
status: active
date: 2026-05-08
origin: docs/plans/2026-05-08-001-feat-computer-thinkwork-ai-end-user-app-plan.md
---

# feat: auth + real threads + working New Thread CTA on apps/computer

## Summary

Phase 1 slice D (parent U6 + parent U9 + a thin parent U8). Wires Cognito + Google OAuth into `apps/computer` by copying admin's auth surface near-verbatim, adds an `_authed` route gate around the shell, replaces the placeholder threads list in the sidebar with real data scoped to the caller's Computer (`myComputer { id }` → `threads(tenantId, computerId)`), and makes the New Thread CTA fire admin's existing `createThread` mutation through a thin dialog. Adds a multi-user fixture test for the threads-by-Computer resolver. Suppresses admin's `bootstrapUser` auto-promotion path on `apps/computer` so end users without a tenant render a "contact your operator" surface instead of being silently promoted to operator of a fresh empty tenant. Local-dev only — Cognito CallbackURL Terraform changes, `computer.thinkwork.ai` DNS, and CI deploy job all remain deferred.

---

## Requirements

- R1. `apps/computer` reuses the existing `ThinkworkAdmin` Cognito app client. New origins (`http://localhost:5180` + `/auth/callback`) need to be added to the dev Cognito callback URL list before sign-in works locally; this is a manual tfvars edit documented in the slice plan and the PR body.
- R2. `apps/computer` boots, redirects unauthenticated visitors to `/sign-in`, and lands authenticated visitors at `/computer`.
- R3. Sign-in route renders a "Continue with Google" button that initiates the OAuth flow via Cognito's hosted UI; the `/auth/callback` route exchanges the code for a session and routes to `/computer`. Mirrors admin's flow.
- R4. `_authed` route gate redirects to `/sign-in` when no Cognito session exists. Wraps `_shell` so all four placeholder routes plus the threads detail route require auth.
- R5. `apps/computer` has urql wired (without the AppSync subscription exchange — Phase 1 is HTTP-only).
- R6. The sidebar's Threads section renders real data from `myComputer { id }` → `threads(tenantId, computerId, limit: 50)`. The placeholder hardcoded array is removed.
- R7. The New Thread CTA opens a thin dialog with a single title input (default "New thread"). Submit fires `createThread(input: { tenantId, computerId, title, channel: CHAT })` and routes to `/threads/$newId`. Cancel closes the dialog. Errors render inline.
- R8. Admin's `bootstrapUser` auto-promotion path is **suppressed** for `apps/computer`: when the caller has no `custom:tenant_id` and no tenant is fetched, render a "Computer not provisioned — contact your tenant operator" surface instead of calling `bootstrapUser`. The CTA, threads list, and placeholder pages all gate on a resolved tenant.
- R9. A multi-user fixture test in `packages/api/test/integration/threads-computer-scope.test.ts` proves `threads(tenantId: T, computerId: C)` does not leak threads from a different user's Computer in the same tenant. If the test fails today (resolver lacks the per-user predicate), the resolver fix lands in this same slice; if it passes, the test stays as a regression guard.
- R10. `apps/admin`, `apps/mobile`, packages/ui, and other backend resolvers are unchanged unless R9's fix path requires it.

---

## Scope Boundaries

- No `computer.thinkwork.ai` Terraform / DNS / ACM cert / CloudFront work.
- No Cognito CallbackURL Terraform changes — the dev tfvars edit is a manual one-line change described in the PR body, not part of the diff. (The actual Terraform change lands in a future infra slice.)
- No CI deploy job (`scripts/build-computer.sh`, `.github/workflows/deploy.yml` `build-computer` job).
- No GraphQL codegen for `apps/computer` — uses plain `gql` from `@urql/core` for the 2 queries + 1 mutation. Codegen wiring lands in a future slice.
- No AppSync subscription exchange — Phase 1 doesn't need realtime.
- No thread chat UI — clicking a sidebar thread row goes to the existing placeholder `/threads/$id` page.
- No password-auth fallback — Google OAuth only.
- No `createThread` per-user resolver predicate fix beyond what R9's test reveals (focus stays on read-side `threads` query).

### Deferred to Follow-Up Work

- Cognito CallbackURL Terraform addition + production rollout.
- `computer.thinkwork.ai` DNS, ACM SAN, CloudFront site, build script, CI job (parent U10 + U11 + U14).
- Thread chat UI (parent plan Phase 2).
- GraphQL codegen pipeline for `apps/computer` (when query count grows).

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/lib/auth.ts` (349 lines) — Cognito client setup, Google OAuth URL builder, code → session exchange, token storage in localStorage. Verbatim copy.
- `apps/admin/src/lib/api-fetch.ts` (102 lines) — fetch wrapper with auth + tenant headers + `NotReadyError` for the auth-not-yet-hydrated race. Verbatim copy.
- `apps/admin/src/lib/graphql-client.ts` (282 lines) — urql client. **Strip the AppSync subscription exchange** — apps/computer Phase 1 doesn't need realtime. Keep the auth + tenant header + token refresh interval.
- `apps/admin/src/context/AuthContext.tsx` (125 lines) — verbatim copy.
- `apps/admin/src/context/TenantContext.tsx` (190 lines) — copy with the `bootstrapUser` auto-promotion path replaced by a "no tenant assigned" surface (R8 / ADV-9 from #959 review).
- `apps/admin/src/routes/sign-in.tsx` — admin has a heavier sign-in with email/password fallback. apps/computer keeps just the Google button.
- `apps/admin/src/routes/_authed.tsx` (23 lines) — verbatim copy.
- `apps/admin/src/routes/auth/callback.tsx` (88 lines) — verbatim copy.
- `apps/admin/src/lib/graphql-queries.ts` — `MyComputerQuery` (line 324, no args; uses caller's resolved tenant) and `ComputerThreadsQuery` (line 379; takes `tenantId` + `computerId` + `limit`). Mirror as plain `gql` template literals in `apps/computer/src/lib/graphql-queries.ts`.
- `packages/database-pg/graphql/types/threads.graphql:118-136` — `CreateThreadInput` already accepts `computerId` and `firstMessage` (per #959 research). No schema change needed.
- `packages/api/src/graphql/resolvers/threads/threads.query.ts:9-18` — current resolver builds WHERE clause from `args.tenantId` directly. Memory note from prior reviews: lacks per-user membership check. R9 test will reveal.

### Institutional Learnings

- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` — `ctx.auth.tenantId` is null for Google-federated users; resolvers must use `resolveCallerTenantId(ctx)` fallback. The reused `createThread` and `threads` paths must honor this. Verify during implementation.
- `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md` — tenant-only WHERE without per-user predicate leaks data in multi-user tenants. Direct precedent for R9.
- Memory `feedback_oauth_tenant_resolver` — `resolveCallerTenantId(ctx)` is the canonical fallback when `ctx.auth.tenantId` is null.

---

## Key Technical Decisions

- **Reuse the existing `ThinkworkAdmin` Cognito app client.** No new client. Same user pool. `apps/computer` just adds new origins to the existing CallbackURLs / LogoutURLs (manual tfvars edit, deferred to infra slice).
- **No GraphQL codegen for this slice.** Use plain `gql` from `@urql/core` for the 3 GraphQL operations. Avoids hauling the codegen toolchain into apps/computer for 3 queries.
- **No AppSync subscription exchange** in `apps/computer/src/lib/graphql-client.ts`. Realtime can land later.
- **Bootstrap suppression is mandatory, not optional.** Per ADV-9 in #959 review, admin's verbatim TenantContext would auto-promote unprovisioned end users to tenant operators of fresh empty tenants. apps/computer's TenantContext gates the autoBootstrap path on a `mode` prop (or a hardcoded `false` since it's the only consumer here) and renders a "no tenant assigned" surface instead.
- **No password-auth path.** apps/computer's sign-in is Google-only — no email/password fields, no signup, no confirm. Lockout recovery deferred (acknowledged gap from #959 ADV-10).
- **`createThread` mutation is fired with `firstMessage: undefined`** — the brainstorm says "blank chat" so the thread starts truly empty. The user types in the chat UI in slice E.
- **The R9 test is mandatory in this slice.** If it reveals a real leak (resolver lacks per-user predicate), the resolver fix lands here too; if it passes, the test stays as a regression guard.

---

## Implementation Units

### U1. Copy admin auth surface into apps/computer

**Goal:** All auth files exist under `apps/computer/src/`. Verbatim copies except for the `bootstrapUser` suppression in TenantContext and the Google-only sign-in.

**Requirements:** R1, R2, R3, R4, R5, R8

**Dependencies:** None (apps/computer skeleton exists from #962).

**Files:**
- Create: `apps/computer/src/lib/auth.ts` (verbatim copy of `apps/admin/src/lib/auth.ts`)
- Create: `apps/computer/src/lib/api-fetch.ts` (verbatim)
- Create: `apps/computer/src/lib/graphql-client.ts` (copy from admin; **strip the AppSync subscription exchange and `AppSyncSubscriptionClient` class**; keep auth + tenant + token refresh)
- Create: `apps/computer/src/context/AuthContext.tsx` (verbatim)
- Create: `apps/computer/src/context/TenantContext.tsx` (copy, but replace `autoBootstrap` body with a no-op + surface state `noTenantAssigned: true`; expose this on the context value so the shell can render a "contact your operator" page)
- Create: `apps/computer/src/routes/_authed.tsx` (verbatim)
- Create: `apps/computer/src/routes/sign-in.tsx` (slim version: just a "Continue with Google" button calling `getGoogleSignInUrl()`. No email/password / signup / confirm UI.)
- Create: `apps/computer/src/routes/auth/callback.tsx` (verbatim copy of admin's; route lives at `/auth/callback`)
- Create: `apps/computer/.env.example` (mirror admin's `VITE_*` set: `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_DOMAIN`, `VITE_API_URL`, `VITE_GRAPHQL_HTTP_URL`, `VITE_GRAPHQL_URL`, `VITE_GRAPHQL_API_KEY`)
- Modify: `apps/computer/package.json` (add `amazon-cognito-identity-js`, `urql`, `@urql/core`, `@graphql-typed-document-node/core`, `graphql`, `graphql-ws` to deps mirroring admin's pins)
- Modify: `apps/computer/vite.config.ts` (add `define: { global: "globalThis" }` for `amazon-cognito-identity-js`'s Node-globals usage)
- Modify: `apps/computer/src/main.tsx` (wrap `<RouterProvider>` with `<AuthProvider>` + `<TenantProvider>` + `<UrqlProvider value={graphqlClient}>`; theme provider stays outermost)

**Approach:**
- Copy files line-for-line; only edit imports if a path was `@/lib/utils` etc. that needed conversion.
- For `graphql-client.ts`: keep `cacheExchange`, `fetchExchange`. Drop `subscriptionExchange`, the `AppSyncSubscriptionClient` class definition, the `wsClient` setup. Keep `setAuthToken`, `setTokenProvider`, `setGraphqlTenantId`, `startTokenRefresh`, `stopTokenRefresh`. Verify the urql client builds without subscriptions.
- For `TenantContext.tsx`: change the `autoBootstrap` function to set a `noTenantAssigned: true` state instead of calling `bootstrapUser`. Add `noTenantAssigned: boolean` to the context value type.
- `sign-in.tsx`: minimal — render `<Button>` from `@thinkwork/ui` calling `window.location.href = getGoogleSignInUrl()`. No form state.

**Patterns to follow:**
- All files cited in Context & Research. Verbatim copies preferred to minimize divergence risk.

**Test scenarios:**
- Test expectation: smoke covered in U2 (sidebar and threads list testing). U1 verifies via typecheck + manual sign-in.

**Verification:**
- `pnpm --filter @thinkwork/computer typecheck` passes.
- After manual tfvars edit (`http://localhost:5180` callbacks added) and `pnpm --filter @thinkwork/computer dev`, an unauthenticated visit redirects to `/sign-in`; clicking Google completes OAuth and lands at `/computer`.

---

### U2. Real threads sidebar + New Thread CTA

**Goal:** Sidebar's Threads section shows real data from the caller's Computer. New Thread CTA opens a thin dialog that creates a real thread via `createThread` and navigates to it.

**Requirements:** R6, R7, R8

**Dependencies:** U1.

**Files:**
- Create: `apps/computer/src/lib/graphql-queries.ts` (plain `gql` template literals: `MyComputerQuery`, `ComputerThreadsQuery`, `CreateThreadMutation`)
- Create: `apps/computer/src/components/NewThreadDialog.tsx` (~80 lines: Dialog + Input + Cancel/Create buttons; calls createThread; navigates to `/threads/$newId`; renders inline error on failure)
- Modify: `apps/computer/src/components/ComputerSidebar.tsx` (replace hardcoded `PLACEHOLDER_THREADS` with `useQuery(MyComputerQuery)` then `useQuery(ComputerThreadsQuery, { tenantId, computerId, limit: 50 })`; render real rows with empty/loading/error states; wire New Thread CTA `onClick` to open the dialog)
- Modify: `apps/computer/src/routes/_authed/_shell.tsx` (gate on `useTenant().noTenantAssigned`: render a "Computer not provisioned — contact your operator" surface when true; otherwise render the existing shell)
- Modify: `apps/computer/src/routes/_authed/_shell/threads.$id.tsx` (no functional change beyond placeholder — already routed; verify `Route.useParams()` still works)

**Approach:**
- `graphql-queries.ts`: use `gql` from `@urql/core` (not codegen). Three operations:
  - `MyComputerQuery` — no args; selects `id`.
  - `ComputerThreadsQuery` — args `tenantId: ID!`, `computerId: ID!`, `limit: Int`; selects `id`, `number`, `identifier`, `title`, `status`, `channel`, `createdAt`, `updatedAt`.
  - `CreateThreadMutation` — args `input: CreateThreadInput!`; selects the created thread's `id`.
- `ComputerSidebar.tsx`:
  - Run `MyComputerQuery` first. While loading, show skeleton rows. On error, show "Failed to load threads."
  - Once `myComputer.id` is available, run `ComputerThreadsQuery({ tenantId, computerId, limit: 50 })`.
  - Empty state: "No threads yet — click New Thread to start one."
  - The New Thread CTA's `onClick` opens a `<NewThreadDialog>` — controlled via a `useState<boolean>(false)`.
- `NewThreadDialog.tsx`:
  - Dialog with Input (default "New thread"), Cancel, Create.
  - `onSubmit`: read `myComputer.id` from cache (run a quick `useQuery(MyComputerQuery)` if not already cached); call `createThread({ input: { tenantId, computerId, title, channel: "CHAT" } })`; on success, `navigate({ to: "/threads/$id", params: { id: newThread.id } })`; on error, render inline error.
- `_shell.tsx` no-tenant gate:
  - `const { noTenantAssigned } = useTenant();`
  - If true, render `<NoTenantAssignedPage>` (a small new component or inline) — sidebar hidden, just centered card text.

**Patterns to follow:**
- `apps/admin/src/components/threads/CreateThreadDialog.tsx` for dialog structure (slim it dramatically — admin's has agent picker + status + due date that we don't want).
- `apps/admin/src/components/Sidebar.tsx` for the GraphQL query usage pattern.

**Test scenarios:**
- Happy path: signed-in user with 0 threads → sidebar shows empty state; click New Thread, dialog opens; type title; submit; new thread appears in sidebar; user lands on `/threads/$newId`.
- Edge: 51+ threads → 50 newest render; overflow affordance shows "Showing 50 of N — older threads coming soon" non-interactive footer (no link, since `/threads` index doesn't exist this slice).
- Error: createThread mutation fails → dialog stays open with inline error.

**Verification:**
- `pnpm --filter @thinkwork/computer dev` → sign in → see real threads in sidebar (or empty state) → click New Thread → create one → see it in sidebar.
- `pnpm --filter @thinkwork/computer typecheck` passes.

---

### U3. Multi-user fixture test for threads(computerId) + resolver fix if needed

**Goal:** Prove the threads-by-Computer resolver does not leak across users in the same tenant. Fix the resolver if the test reveals a leak.

**Requirements:** R9

**Dependencies:** None on apps/computer; backend-only.

**Files:**
- Create: `packages/api/test/integration/threads-computer-scope.test.ts`
- Modify (if leak found): `packages/api/src/graphql/resolvers/threads/threads.query.ts` — add per-user predicate when `args.computerId` is supplied.

**Approach:**
- Test setup: 2 users (U_A, U_B) in the same tenant T, each with their own Computer (C_A, C_B), 2 threads on C_A, 1 thread on C_B.
- Test 1: U_A calls `threads(tenantId: T, computerId: C_A)` → returns exactly U_A's 2 threads.
- Test 2: U_A calls `threads(tenantId: T, computerId: C_B)` → must NOT return T_B1. Either returns an authorization error, or returns an empty list. Whichever the resolver does, assert the specific behavior.
- If Test 2 reveals a leak (returns T_B1 to U_A), patch the resolver: when `args.computerId` is supplied, JOIN against `computers` table and require `computers.owner_user_id = resolveCallerUserId(ctx)`.
- Use existing fixture utilities in `packages/api/test/integration/` if any; otherwise write minimal seed/teardown.

**Patterns to follow:**
- Existing tests in `packages/api/test/integration/` for fixture shape.
- `packages/api/src/graphql/resolvers/computers/myComputer.query.ts` for the `owner_user_id` ownership check pattern (uses it correctly).

**Test scenarios:**
- Both Test 1 and Test 2 above are the actual test cases.
- Edge: cross-tenant — U_A calling `threads(tenantId: OTHER_TENANT, computerId: C_A)` is already protected by the existing tenant gate; verify it still works.

**Verification:**
- `pnpm --filter @thinkwork/api test` runs the new integration test green.
- If resolver was patched, `pnpm --filter @thinkwork/api typecheck` passes.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Cognito CallbackURL list lacks `http://localhost:5180/auth/callback` → sign-in fails with `redirect_mismatch` | Manual tfvars edit documented in PR body; user adds it before testing locally. Real Terraform addition is deferred infra slice. |
| `bootstrapUser` suppression accidentally regresses admin's auto-bootstrap behavior | apps/computer's TenantContext is a separate copy; admin's is untouched. Admin verifies via existing flow. |
| `graphql-client.ts` strip of subscription exchange breaks the urql client setup | Test typecheck + manual dev-server boot before declaring U1 done. |
| Multi-user fixture test reveals a real cross-user leak in `threads(computerId:)` resolver | Plan accepts this and lands the fix in U3. The test is required regardless. |
| Refresh-token cross-domain SSO behavior unverified | Plan says local-dev only — SSO mechanics with admin tested only when both run on the same browser session. Acceptable for this slice. |
| Email-link Cognito-side notifications (signup, password reset) leak through Google flow | Google OAuth doesn't trigger these; not a risk. |

---

## Sources & References

- **Origin (parent plan):** [docs/plans/2026-05-08-001-feat-computer-thinkwork-ai-end-user-app-plan.md](docs/plans/2026-05-08-001-feat-computer-thinkwork-ai-end-user-app-plan.md)
- **Predecessors merged:** #959 (UI skeleton), #961 (43 primitives), #962 (apps/computer scaffold)
- Reference admin auth: `apps/admin/src/lib/auth.ts`, `apps/admin/src/context/AuthContext.tsx`, `apps/admin/src/context/TenantContext.tsx`, `apps/admin/src/routes/_authed.tsx`, `apps/admin/src/routes/auth/callback.tsx`
- Reference admin queries: `apps/admin/src/lib/graphql-queries.ts:324` (`MyComputerQuery`), `:379` (`ComputerThreadsQuery`)
- Reference admin urql client: `apps/admin/src/lib/graphql-client.ts`
- Reference resolver: `packages/api/src/graphql/resolvers/threads/threads.query.ts`
