---
title: "feat: Edit Human records in admin app"
type: feat
status: active
date: 2026-04-21
deepened: 2026-04-21
---

# feat: Edit Human records in admin app

## Overview

The admin app has no way to edit Human (User + TenantMember) records. The humans list at `apps/admin/src/routes/_authed/_tenant/humans/index.tsx` renders rows but clicking does nothing, and there is no detail route. This plan adds a `/humans/$humanId` detail+edit surface covering profile fields (`name`, `image`, `phone`) and tenant membership controls (`role`, `status`, remove). It also closes a concurrent authz gap: the underlying `updateUser`, `updateTenantMember`, and `removeTenantMember` mutations are currently fail-open (no caller check, no tenant scoping) — the admin UI cannot ship against fail-open mutations in good conscience.

## Problem Frame

**User need:** A tenant admin can today invite humans but cannot correct a typo in their name, change their role from `member` → `admin`, or remove a departed employee — so administrative cleanup has to happen directly in the database. Framed by the user as "fix asap."

**System state (from exploration):**
- `updateUser` resolver at `packages/api/src/graphql/resolvers/core/updateUser.mutation.ts` accepts any caller and any target user id across tenant boundaries.
- `updateTenantMember` and `removeTenantMember` resolvers in the same directory are identically fail-open.
- Role/admin enforcement in existing resolvers (e.g. `allTenantAgents`) is inline, duplicated, and has no shared helper.
- `apps/mobile` already depends on `updateUser` for self-service profile edits in `app/settings/account.tsx` — any authz change must preserve the self-edit path.

## Requirements Trace

- **R1.** A tenant admin can edit another human's profile (`name`, `image`, `phone`) from the admin app.
- **R2.** A tenant admin can change another human's tenant role (`member` ↔ `admin`) and status, and remove them from the tenant.
- **R3.** Non-admin callers cannot edit another user's record, regardless of surface (admin UI, mobile, direct API).
- **R4.** A user retains the ability to edit their own profile (mobile self-edit must not regress).
- **R5.** The last `owner` of a tenant cannot be removed or demoted, preventing tenant lockout.
- **R6.** The humans list in admin links to the detail route, so the new capability is discoverable.

## Scope Boundaries

- Not editing `email` — Cognito-owned, immutable through this path.
- Not editing agent records from the humans page — that already lives in `/agents/$agentId`.
- Not building a shared `requireTenantAdmin` directive or rewriting every resolver's authz — only the three mutations this feature touches get hardened now, plus a single extracted helper.
- Not adding a password reset, MFA reset, or Cognito-level account management — out of scope.
- Not adding `UserProfile` editing (displayName, theme, notification prefs) — user-owned, not admin business.

### Deferred to Separate Tasks

- **Backfill authz across remaining fail-open resolvers:** Separate follow-up — the exploration found `inviteMember` and others also have no admin check. Track as a broader hardening PR.
- **Shared `@auth` GraphQL directive:** Separate refactor once we have 5+ call sites of `requireTenantAdmin`.
- **Admin-side "My Profile" / self-edit surface:** Admin has no self-profile page today; not required for this fix.

## Context & Research

### Relevant Code and Patterns

- **Existing admin edit pattern to mirror:** `apps/admin/src/routes/_authed/_tenant/agents/$agentId.tsx` + `apps/admin/src/components/agents/AgentFormDialog.tsx` — react-hook-form + Zod + `useMutation(urql)` + Sonner toasts. This plan follows the route-loads-data → form-edits-data → mutation-on-submit pattern, but uses a full-page detail route rather than a dialog because membership controls (role change, remove) benefit from their own dedicated UI with confirm dialogs.
- **Existing inline admin-role check to extract:** `packages/api/src/graphql/resolvers/agents/allTenantAgents.query.ts` lines 30-40 — queries `tenantMembers` for caller's role and checks `role === 'owner' || role === 'admin'`. Extract once, reuse three times.
- **Humans list starting point:** `apps/admin/src/routes/_authed/_tenant/humans/index.tsx` + `InviteMemberDialog`. Query is `TenantMembersListQuery` filtered to `principalType === 'USER'`.
- **GraphQL context shape:** `packages/api/src/lib/cognito-auth.ts` — `ctx.auth = { principalId, tenantId, email, authType }`. No role on auth; must be fetched per-call.
- **DB schema for role/status:** `packages/database-pg/src/schema/core.ts` — role/status are `text` columns (no DB-level enum). Role values used in code: `owner`, `admin`, `member`. Status values used: `active` (plus possibly `removed` via status update or row deletion — verify in Unit 3).

### Institutional Learnings

- `feedback_user_opt_in_over_admin_config.md` — admin owns infrastructure and tenant-admin operations; this work is clearly infra/ops (managing other humans' membership), so the admin-surface choice is correct.
- `feedback_pnpm_in_workspace.md` — all commands run through pnpm.
- `feedback_graphql_deploy_via_pr.md` — do not direct-deploy the graphql Lambda; land via PR to main.
- `feedback_worktree_isolation.md` — implement in `.claude/worktrees/<name>` off origin/main.
- `project_admin_worktree_cognito_callbacks.md` — if using a second admin vite port, register its callback URL in Cognito.

### External References

None — this is a straightforward internal admin CRUD + authz change against patterns already in the repo.

## Key Technical Decisions

- **Detail route over dialog.** Membership controls (role select, remove with confirm, "last owner" error state) warrant a full page with multiple sections, unlike the simpler agent edit dialog.
- **Extract `requireTenantAdmin(ctx, tenantId, db)` helper** in `packages/api/src/graphql/resolvers/_shared/authz.ts` (or nearest conventional path discovered during implementation). Used by `updateUser`, `updateTenantMember`, `removeTenantMember` in this plan. Not a GraphQL directive yet — plain async function returning role or throwing. Keeps the abstraction light; upgrade later if call-count grows.
- **`updateUser` authz = self-or-admin — join via `tenantMembers`.** The `users` table has no Cognito-subject column, so self-detection cannot be a direct `principalId === targetUser.cognitoSub` compare. `ctx.auth.principalId` is the Cognito `sub`, which is stored on `tenantMembers.principal_id` where `principal_type = 'USER'`. Self = there exists a `tenantMembers` row with `principal_type='USER'`, `principal_id=ctx.auth.principalId`, and whose linked `users.id` equals the target user id. If self, allow. Otherwise call `requireTenantAdmin(ctx, targetTenantId, db)` where `targetTenantId` is resolved from the target's `tenantMembers` row.
- **`updateTenantMember` + `removeTenantMember` authz = admin-only, not self-admin.** Callers cannot change their own role (prevents accidental self-demote) and cannot remove themselves through this mutation (prevents self-lockout; a separate "leave tenant" flow can exist later).
- **Last-owner guard runs in a single DB transaction.** The owner-count check and the demote/delete must execute inside the same `db.transaction(...)` block; otherwise two concurrent admin actions (e.g. simultaneous deletes of two distinct owners) can each observe ≥2 owners and leave the tenant at zero — directly violating R5. This is not an "accepted residual risk"; it is a correctness requirement and it's one transaction block, not a large lift. Error code on failure: `LAST_OWNER`.
- **Role edit constraints in V1.** Admins can set role to `admin` or `member`. Only existing `owner`s can grant `owner`. This matches the common "owners are sticky" model and avoids introducing a chain-of-command bug in V1.
- **No new mutations.** `updateUser`, `updateTenantMember`, `removeTenantMember` already exist with acceptable signatures — we harden them rather than adding `setTenantMemberRole` / `deactivateTenantMember` variants.
- **Error surfacing.** Authz/invariant failures surface as GraphQL errors with stable `extensions.code` values (`FORBIDDEN`, `LAST_OWNER`). Admin UI renders these as Sonner toasts.

## Open Questions

### Resolved During Planning

- *Scope — profile only or profile+membership?* — Membership included (user choice).
- *Add admin authz now or defer?* — Add now (user choice).
- *Delivery shape — dialog or detail route?* — Detail route, because membership controls need more space and confirm dialogs.
- *Self-edit regression risk?* — Resolved via self-or-admin semantics on `updateUser`.
- *Role matrix?* — V1: admins can set `{admin, member}`; only owners can grant `owner`; last owner cannot be demoted/removed.

### Resolved During Deepening (2026-04-21)

- *Can `updateUser` self-detect without a schema change?* — Yes, via a `tenantMembers` join (see Key Technical Decisions). No schema migration needed.
- *Is `removeTenantMember` a hard or soft delete today?* — Hard delete (`db.delete(tenantMembers)...returning()`). Plan preserves this.

### Deferred to Implementation

- **Helper path.** `packages/api/src/graphql/resolvers/_shared/authz.ts` is the proposed location but the implementer should pick the nearest conventional spot; the directory layout may already have a preferred home for shared resolver utilities.
- **GraphQL fragment organization in admin.** Whether the new `HumanDetail` fragment lives in `apps/admin/src/lib/graphql-queries.ts` or a new `humans/` query module is an in-flight convention call; follow whatever the agents feature does.
- **Exact shape of `UpdateUserInput`.** Plan assumes `name`, `image`, `phone`. Before coding Unit 4, `grep` for `input UpdateUserInput` in `packages/database-pg/graphql/types/` and verify empirically per the `feedback_verify_wire_format_empirically.md` learning. If the input diverges (extra required fields, different names), update the admin form schema in Unit 5 accordingly.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
Admin UI                   GraphQL API                                     DB
--------                   -----------                                     --
HumansList
  row click  ─────────────────────────────────────────────────────────────────►
                         updateUser(id, input)
HumanDetailRoute  ───────►   │  1. load target user + resolve tenantId
   ├── ProfileSection        │  2. if caller === target → allow
   │      └─ submit ─────────┤     else requireTenantAdmin(ctx, targetTenantId)
   │                         │  3. persist                                  ─► users
   │
   └── MembershipSection
          ├─ role select ──► updateTenantMember(id, {role?, status?})
          │                      │  requireTenantAdmin(ctx, member.tenantId)
          │                      │  reject self-role-change
          │                      │  reject demote if target is last owner
          │                      │  reject grant-owner unless caller is owner
          │                      └─ persist                                  ─► tenant_members
          │
          └─ remove ──────► removeTenantMember(id)
                               │  requireTenantAdmin(ctx, member.tenantId)
                               │  reject self-remove
                               │  reject if target is last owner
                               └─ persist                                    ─► tenant_members
```

Authz helper shape (directional):

```
requireTenantAdmin(ctx, tenantId, db) -> "owner" | "admin"
  // throws GraphQLError(code=FORBIDDEN) if caller is not owner/admin in tenantId
  // returns the caller's role so callers can branch on owner vs admin (e.g. grant-owner)
```

## Implementation Units

- [ ] **Unit 1: Extract `requireTenantAdmin` helper**

**Goal:** Create a single shared authz helper used by all three mutations in this plan, replacing the ad-hoc inline pattern.

**Requirements:** R3 (enabler)

**Dependencies:** None

**Files:**
- Create: `packages/api/src/graphql/resolvers/_shared/authz.ts` (or nearest conventional location)
- Test: `packages/api/src/graphql/resolvers/_shared/authz.test.ts`

**Approach:**
- Function accepts `ctx`, target `tenantId`, and `db` handle; queries `tenantMembers` for caller's role in that tenant; throws a `GraphQLError` with `extensions.code === 'FORBIDDEN'` if not `owner`/`admin`; returns the role string on success.
- Do NOT migrate existing callers (e.g. `allTenantAgents`) in this PR — scope creep.

**Execution note:** Test-first — authz logic is small and high-risk; easier to pin behavior before wiring resolvers to it.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/agents/allTenantAgents.query.ts` lines 30-40 (inline version).
- Whatever GraphQLError / error-code convention the API package already uses.

**Test scenarios:**
- Happy path: caller is `admin` in target tenant → returns `"admin"`.
- Happy path: caller is `owner` in target tenant → returns `"owner"`.
- Error path: caller is `member` in target tenant → throws with code `FORBIDDEN`.
- Error path: caller is not a member of target tenant at all → throws with code `FORBIDDEN`.
- Error path: ctx has no `auth.principalId` → throws (treat as unauthenticated).

**Verification:**
- Test file green.
- Import works from a resolver file without circular-import issues.

---

- [ ] **Unit 2: Harden `updateUser` — self-or-admin authz**

**Goal:** `updateUser` rejects cross-tenant and non-admin edits while preserving mobile self-edit.

**Requirements:** R3, R4

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/api/src/graphql/resolvers/core/updateUser.mutation.ts`
- Test: `packages/api/src/graphql/resolvers/core/updateUser.mutation.test.ts` (create if absent)

**Approach:**
- Look up the target's `tenantMembers` row where `principal_type = 'USER'` and the linked user id matches `args.id`. Extract its `tenantId`. If no such row exists, return `NOT_FOUND` (covered in test scenarios).
- Self-detect: caller is self iff there exists a `tenantMembers` row with `principal_type='USER'`, `principal_id = ctx.auth.principalId`, and its linked user id equals `args.id`. (The `users` table does not hold the Cognito sub; the join goes through `tenantMembers.principal_id`.)
- If self, allow. Otherwise call `requireTenantAdmin(ctx, targetTenantId, db)`.
- Leave existing validation and persistence logic intact.

**Execution note:** Test-first — this is a security-sensitive behavioral change on a resolver many surfaces already call.

**Patterns to follow:**
- Existing resolver error shape in `packages/api/src/graphql/resolvers/core/`.

**Test scenarios:**
- Happy path: caller edits their own user (caller === target) → succeeds regardless of role.
- Happy path: admin in tenant T edits user U (both in tenant T) → succeeds.
- Error path: member in tenant T edits user U (both in tenant T, caller ≠ target) → `FORBIDDEN`.
- Error path: admin in tenant T edits user U in tenant T' (cross-tenant) → `FORBIDDEN`.
- Error path: unauthenticated call → rejected.
- Integration: mobile self-edit flow (simulated by caller === target) still writes expected fields to `users`.
- Edge case: target user exists but has no tenant membership → decide between `FORBIDDEN` and `NOT_FOUND`; document the choice in the test.

**Verification:**
- All scenarios green.
- Manual smoke: mobile `settings/account.tsx` "save name" still works against the updated resolver in a dev environment.

---

- [ ] **Unit 3: Harden `updateTenantMember` + `removeTenantMember` (admin-only + invariants)**

**Goal:** Lock down the two TenantMember-mutating resolvers and introduce the "last owner" invariant.

**Requirements:** R3, R5

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/api/src/graphql/resolvers/core/updateTenantMember.mutation.ts`
- Modify: `packages/api/src/graphql/resolvers/core/removeTenantMember.mutation.ts`
- Test: `packages/api/src/graphql/resolvers/core/updateTenantMember.mutation.test.ts` (create if absent)
- Test: `packages/api/src/graphql/resolvers/core/removeTenantMember.mutation.test.ts` (create if absent)

**Approach:**
- Open a `db.transaction(...)` block and perform the entire sequence inside it. This is a correctness requirement, not a nicety — the last-owner check and the write must be atomic to prevent concurrent admin actions from racing the tenant to zero owners.
- Load the target `tenantMembers` row to get its `tenantId` and current `role`.
- Call `requireTenantAdmin(ctx, member.tenantId, tx)` using the transaction handle — capture caller role.
- Reject if `ctx.auth.principalId === member.principalId` (no self-role-change, no self-remove).
- For role changes: if input role is `owner` and caller role is not `owner`, reject with `FORBIDDEN`.
- For role demotion or removal when target's current role is `owner`, count owners in the tenant inside the same transaction; if target is the last owner, reject with `extensions.code === 'LAST_OWNER'` and a user-friendly message. Transaction rolls back on reject.
- Preserve existing persistence semantics: `removeTenantMember` is a hard delete (confirmed via resolver read); keep it a hard delete.

**Execution note:** Test-first — invariant logic (last-owner guard, self-* checks) is the kind of thing that regresses silently.

**Patterns to follow:**
- Same error-code convention as Unit 2.

**Test scenarios:**
- Happy path: admin changes another member's role from `member` → `admin` → succeeds, row reflects new role.
- Happy path: owner grants `owner` to another admin → succeeds.
- Happy path: admin removes a departing `member` → row gone (or status=removed, per current semantics).
- Error path: admin attempts to grant `owner` → `FORBIDDEN`.
- Error path: admin attempts to change their own role → `FORBIDDEN`.
- Error path: admin attempts to remove themselves → `FORBIDDEN`.
- Error path: member-role caller attempts any change → `FORBIDDEN`.
- Error path: cross-tenant caller → `FORBIDDEN`.
- Edge case: demote the last owner of a tenant → `LAST_OWNER`.
- Edge case: remove the last owner of a tenant → `LAST_OWNER`.
- Edge case: tenant with two owners — demoting one succeeds (not the last).
- Integration: `updateTenantMember` with `{status: 'active'}` (no role change) on an already-active member → idempotent success, no invariant violation.
- Integration (concurrency): simulate two concurrent `removeTenantMember` calls against the two distinct owners of a tenant — exactly one should succeed; the other must fail with `LAST_OWNER`. This is the load-bearing test for the transaction wrapper.

**Verification:**
- All scenarios green.
- Row state in the DB matches expectations after each happy-path test.

---

- [ ] **Unit 4: Admin GraphQL wiring for human detail**

**Goal:** Give the admin app the queries/mutations and generated types it needs to load and edit a human.

**Requirements:** R1, R2

**Dependencies:** Units 2–3 not strictly required to compile, but server should be hardened first for end-to-end smoke.

**Files:**
- Modify: `apps/admin/src/lib/graphql-queries.ts` (or create a `humans/` query module if that matches the agents convention)
- Modify (generated): `apps/admin/src/gql/` codegen output — regenerate via project's codegen command
- Test: none for codegen output; query shape is exercised indirectly through Unit 5

**Approach:**
- Before writing the query/mutation documents, `grep` the schema for `input UpdateUserInput` and `input UpdateTenantMemberInput` to verify the field list. Do not assume the plan's `{name, image, phone}` list is correct (`feedback_verify_wire_format_empirically.md`).
- Add a `HumanDetailQuery` that takes a `tenantMemberId` and returns the member's `id`, `role`, `status`, `createdAt`, nested `user { id, name, email, image, phone }`, and the current `tenantId`.
- Add client-side mutation documents for `UpdateUser`, `UpdateTenantMember`, `RemoveTenantMember` — some may already exist (e.g. via `InviteMemberDialog` ecosystem); reuse rather than duplicate.
- Run codegen (pnpm script) to regenerate `apps/admin/src/gql/`.

**Patterns to follow:**
- `apps/admin/src/components/agents/AgentFormDialog.tsx` for how mutation documents are colocated with components vs centralized.

**Test scenarios:**
- Test expectation: none — this unit is data-layer scaffolding. Codegen must compile and the admin app must build.

**Verification:**
- `pnpm` build/typecheck in `apps/admin` passes.
- Generated types include the new query + any newly added mutation documents.

---

- [ ] **Unit 5: Build `/humans/$humanId` detail+edit route**

**Goal:** Ship the user-facing admin page that fulfills R1 and R2.

**Requirements:** R1, R2, R6

**Dependencies:** Units 2, 3, 4

**Files:**
- Create: `apps/admin/src/routes/_authed/_tenant/humans/$humanId.tsx`
- Create: `apps/admin/src/components/humans/HumanProfileSection.tsx`
- Create: `apps/admin/src/components/humans/HumanMembershipSection.tsx`
- Create: `apps/admin/src/components/humans/RemoveHumanConfirmDialog.tsx`
- Test: `apps/admin/src/components/humans/HumanProfileSection.test.tsx`
- Test: `apps/admin/src/components/humans/HumanMembershipSection.test.tsx`

**Approach:**
- Route loader uses `HumanDetailQuery` from Unit 4.
- `HumanProfileSection` = react-hook-form + Zod (string min length on `name`; optional `image` URL; optional `phone`), submits `UpdateUser`.
- `HumanMembershipSection` = role `<Select>` limited to `{member, admin}` unless current caller is `owner` (in which case `owner` is selectable); status toggle if applicable; "Remove from tenant" button opens `RemoveHumanConfirmDialog`.
- On mutation error, map `extensions.code` → Sonner toast copy: `FORBIDDEN` → "You don't have permission to make this change"; `LAST_OWNER` → "Cannot remove or demote the last owner of a tenant".
- Disable the role select and remove button when the target member is the current caller (UI-level reinforcement of server-side self-* rules).
- `email` rendered as read-only.
- Breadcrumb: Humans → {name or email}.

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/agents/$agentId.tsx` — route loading and layout.
- `apps/admin/src/components/agents/AgentFormDialog.tsx` — react-hook-form + Zod + urql mutation pattern.
- Existing breadcrumb / PageLayout components used in `settings.tsx`.

**Test scenarios:**
- Happy path: load a human → profile fields rendered, email shown read-only, role select shows current role.
- Happy path: edit name → submit → mutation called with `{id, input: {name}}` → success toast → field reflects new value.
- Happy path: change role `member` → `admin` → mutation called → success toast.
- Happy path: click Remove → confirm dialog → confirm → mutation called → route navigates back to list.
- Edge case: caller === target — role select and remove button are disabled with a tooltip ("You can't change your own membership here").
- Edge case: caller is admin (not owner) — `owner` is NOT present in role select.
- Edge case: caller is owner — `owner` IS present in role select.
- Error path: server returns `FORBIDDEN` → Sonner "permission" toast shown.
- Error path: server returns `LAST_OWNER` → Sonner "last owner" toast shown; form state un-changed.
- Error path: invalid name (empty string) → Zod validation error shown inline, mutation not called.
- Integration: Remove confirm dialog — cancel path does not call the mutation; confirm path does.

**Verification:**
- Component tests green.
- Manual: start admin (`pnpm` dev), sign in as a tenant admin, edit a human end-to-end.

---

- [ ] **Unit 6: Link humans list rows to detail route**

**Goal:** Make the new capability discoverable.

**Requirements:** R6

**Dependencies:** Unit 5

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/humans/index.tsx`

**Approach:**
- Wrap each row (or add a trailing "Edit" icon button) with a `<Link to="/humans/$humanId" params={{ humanId: member.id }}>`.
- Keep the existing "Invite Member" CTA untouched.

**Patterns to follow:**
- However the agents index navigates to `/agents/$agentId`.

**Test scenarios:**
- Happy path: click a row → TanStack Router navigates to `/humans/<id>`.
- Edge case: keyboard-accessible — focus + Enter triggers navigation.

**Verification:**
- Manual click-through from list to detail.

## System-Wide Impact

- **Interaction graph:** `updateUser` is called by `apps/mobile/app/settings/account.tsx` and by `apps/mobile/app/team/edit-member.tsx`. Any authz change must be verified against both surfaces — the self-or-admin semantics in Unit 2 is explicitly chosen to preserve `settings/account.tsx`. `edit-member.tsx` already targets other users; its callers must be admin in that tenant post-hardening — confirm expected usage with a manual test before merge.
- **Error propagation:** New `extensions.code` values (`FORBIDDEN`, `LAST_OWNER`) must match whatever convention the repo already uses. If a convention exists, adopt it; if not, pick `FORBIDDEN` / `LAST_OWNER` and document in the resolver code.
- **State lifecycle risks:** The last-owner invariant is not enforced at the DB level; it is enforced resolver-side inside a `db.transaction` block that covers both the owner count and the mutating write (see Unit 3). This closes the "concurrent demote + remove → zero owners" race that would otherwise violate R5.
- **API surface parity:** `updateUser` is also used by mobile — no mobile code changes are required, but the mobile team should be informed of the new error shape (a non-self caller will now get `FORBIDDEN`).
- **Integration coverage:** Unit 2's "caller === target writes persist" scenario and Unit 5's end-to-end admin click-through together prove the cross-layer behavior.
- **Unchanged invariants:**
  - `updateUser` still does not permit editing `email`.
  - No schema changes to `users` or `tenant_members` tables.
  - `inviteMember` is untouched (its fail-open behavior is tracked as a separate follow-up).
  - No changes to Cognito, auth middleware, or the `ctx.auth` shape.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Mobile self-edit regression after `updateUser` hardening | Self-or-admin semantics in Unit 2 + explicit test scenario + manual mobile smoke before merge |
| `apps/mobile/app/team/edit-member.tsx` starts returning `FORBIDDEN` for non-admin callers | Verify its current usage pattern during Unit 2 review; if it was also fail-open by mistake, this is the correct outcome — flag in PR description |
| Race on last-owner invariant (two concurrent demotes/removes) | Resolvers wrap count + write in a single `db.transaction`. Concurrency-test scenario in Unit 3 proves the invariant holds |
| `removeTenantMember` semantic change (hard vs soft delete) | Explicitly preserve current behavior — see deferred question |
| New shared helper creates import cycles | Keep helper tiny (one function, no resolver imports); unit-test it in isolation (Unit 1) |
| Admin app build breaks after codegen | Run `pnpm` typecheck in Unit 4 before starting Unit 5 |

## Documentation / Operational Notes

- No user-facing docs to update; capability is self-explanatory.
- No migration or rollout gating — resolvers harden atomically on deploy.
- GraphQL Lambda deploys via PR merge to main, per `feedback_graphql_deploy_via_pr.md`.
- Worktree: implement in `.claude/worktrees/admin-edit-humans` off `origin/main` per `feedback_worktree_isolation.md`.

## Sources & References

- Admin humans list: `apps/admin/src/routes/_authed/_tenant/humans/index.tsx`
- Admin edit pattern (mirror): `apps/admin/src/routes/_authed/_tenant/agents/$agentId.tsx`, `apps/admin/src/components/agents/AgentFormDialog.tsx`
- Fail-open resolvers to harden: `packages/api/src/graphql/resolvers/core/updateUser.mutation.ts`, `packages/api/src/graphql/resolvers/core/updateTenantMember.mutation.ts`, `packages/api/src/graphql/resolvers/core/removeTenantMember.mutation.ts`
- Existing inline admin check to extract: `packages/api/src/graphql/resolvers/agents/allTenantAgents.query.ts`
- Auth context shape: `packages/api/src/lib/cognito-auth.ts`
- DB schema: `packages/database-pg/src/schema/core.ts`
- Mobile self-edit consumers: `apps/mobile/app/settings/account.tsx`, `apps/mobile/app/team/edit-member.tsx`
