---
title: "feat: Public and private Space access"
type: feat
status: completed
date: 2026-05-21
depth: deep
origin: docs/brainstorms/2026-05-19-spaces-collaborative-user-app-ui-requirements.md
---

# feat: Public and private Space access

## Overview

Add an explicit tenant-scoped public/private access model to Spaces. Public Spaces are visible and usable by every active tenant member. Private Spaces are visible and usable only by users who have a `space_members` row. This should unblock newly invited tenant users from starting work in the default public Space while preserving the tighter thread access rule from the adjacent thread-participant work: a user sees a Thread only if they started it or were mentioned/added as a participant.

This plan extends the newer Spaces-as-contextual-workrooms direction from `docs/plans/2026-05-20-003-spaces-as-agent-contextual-workrooms-template-removal-plan.md`; it does not revive the superseded plan to remove Spaces from Threads.

---

## Problem Frame

The current app has two overlapping gates:

- `packages/api/src/graphql/resolvers/spaces/shared.ts` treats Space access as Space membership for Cognito callers.
- `apps/computer/src/components/computer/ComputerWorkbench.tsx` blocks new Thread creation when no Computer/workspace is assigned, even if the user is a tenant member and a default Space exists.

That makes a newly logged-in user feel locked out of the product. The desired behavior is more natural: every tenant member can see and start Threads in public Spaces, and private Spaces require explicit membership.

---

## Requirements Trace

- R1. Public Space access is tenant-public: every active tenant member can list the Space, select it, and create a Thread in it.
- R2. Private Space access requires a matching `space_members` row for the user before the Space appears in user-facing Space lists or accepts user posting.
- R3. The default conversation Space is public by default, including both API-created defaults and existing rows after migration.
- R4. Public/private Space access does not override Thread privacy. Users still see only Threads they started or where they are participants.
- R5. Private Space Threads require both Thread participation and Space membership; mentioning a user who is not a private Space member must not create a bypass.
- R6. Admin/operator management can still configure Space access mode and manage members without granting user-facing posting access by accident.
- R7. The user-facing composer should no longer show "You need access to a workspace before starting work" when a tenant member has an accessible public Space but no assigned Computer.

**Origin actors:** A1 general user, A2 mentioned teammate, A3 mentioned agent, A4 Space member, A5 tenant admin.
**Origin flows:** F1 global Chat Inbox, F2 switch to a Space, F3 mention a teammate or agent, F4 start a new Thread.
**Origin acceptance examples:** AE1 global unread across Spaces, AE2 Space selection, AE3 teammate mention joins participant, AE4 agent mention wakes in shared Thread, AE5 composer/header show Space context.

---

## Scope Boundaries

- Public means visible within the tenant only; it does not grant anonymous, cross-tenant, or API-key access.
- This plan does not make public Spaces show every Thread to every tenant member. Thread listing remains participant-based.
- This plan does not redesign Computer assignment or Computer ownership. It only allows a Space-first Thread creation path when no Computer is selected.
- This plan does not add a full member-management UX beyond what is required to create private Spaces and display/configure access mode.
- This plan does not implement row-level database security; authorization remains in GraphQL/API helpers and existing tenancy constraints.

---

## Research Summary

Relevant current code:

- `packages/database-pg/src/schema/spaces.ts` has `spaces` and `space_members`, but no access mode column.
- `packages/database-pg/graphql/types/spaces.graphql` exposes Space status/kind/member data and `CreateSpaceInput`, but no public/private contract.
- `packages/api/src/graphql/resolvers/spaces/shared.ts` currently has `canReadTenantSpaces` and `hasSpaceMemberAccess`; the latter requires membership for all Spaces.
- `packages/api/src/graphql/resolvers/spaces/spaces.query.ts` lists all tenant Spaces after tenant membership, which is too broad for private user-facing lists and too narrow in helper semantics for public posting.
- `packages/api/src/graphql/resolvers/threads/createThread.mutation.ts` validates explicit Space existence/status but does not yet express public/private posting semantics.
- `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.ts` needs to preserve participant-based Thread access rather than treating public Space access as write access to every Thread.
- `packages/api/src/lib/mentions/thread-mention-targets.ts` currently includes all active tenant users even when a Thread has a Space, which would allow non-members to be mentioned into a private Space Thread.
- `apps/computer/src/components/computer/ComputerWorkbench.tsx` currently requires a selected Computer and sends `computerId` in the new Thread path.
- `apps/admin/src/lib/graphql-queries.ts` and `apps/admin/src/routes/_authed/_tenant/spaces/index.tsx` are the current Space management entry points.

Institutional context:

- `docs/brainstorms/2026-05-19-spaces-collaborative-user-app-ui-requirements.md` establishes that Spaces are a user-facing collaboration/context surface and mentions join users/agents as Thread participants.
- `docs/plans/2026-05-20-003-spaces-as-agent-contextual-workrooms-template-removal-plan.md` supersedes older Space removal direction and keeps Spaces as contextual workrooms.
- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` warns against relying on `ctx.auth.tenantId` for Google-federated users; resolver gates should use tenant membership/admin helpers that resolve the caller from persisted data.

External research skipped: the repo already has strong local patterns for tenant membership, Drizzle schema/migrations, GraphQL auth helpers, and generated client updates.

---

## Target Access Model

This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.

| Operation | Public Space | Private Space |
| --- | --- | --- |
| User-facing Space list | Active tenant member can see it | Only Space member can see it |
| Admin Space management | Tenant admin/service can manage it | Tenant admin/service can manage it |
| Create new Thread in Space | Active tenant member can create | Space member can create |
| Read/list existing Threads | Thread owner/participant only | Thread owner/participant and Space member |
| Send message to existing Thread | Thread owner/participant only | Thread owner/participant and Space member |
| Mention user in Thread | Any active tenant user | Existing Thread participant or Space member |
| Mention agent in Thread | Space-assigned active agents | Space-assigned active agents |

Key implication: public Space membership is optional metadata for roles, notifications, ownership, or admin display. It is not required for basic public access.

---

## Key Decisions

### D1. Store `spaces.access_mode`

Add `spaces.access_mode text NOT NULL DEFAULT 'public'` with allowed values `public` and `private`. Prefer `access_mode` over `visibility` because "public" is tenant-public, not internet-public.

### D2. Keep Thread visibility participant-based

Space access answers "can this user enter/post in this workroom?" Thread participation answers "can this user see this conversation?" Public Spaces do not become shared archives of every Thread in the Space.

### D3. Private Space membership is a hard user-facing gate

For private Spaces, a user must be a `space_members` member to list the Space, create Threads in it, read participant Threads in it, send messages in it, or be added through a mention.

### D4. Separate admin management from user participation

Tenant admins and service callers still need management visibility for all Spaces. That should be represented by admin-specific helpers or query arguments rather than weakening the user-facing access helpers.

### D5. Allow Space-first Thread creation without a selected Computer

The Computer app's New Thread surface should be able to create a Thread in an accessible public Space without `computerId`. Existing backend behavior already supports non-Computer Threads and default agent routing; the UI should not block just because the user lacks an assigned Computer.

---

## Implementation Units

- U1. **Add Space access mode to the data and GraphQL contracts**

  **Goal:** Introduce a persisted public/private Space contract with public as the default.

  **Requirements:** R1, R2, R3, R6

  **Dependencies:** None

  **Files:**

  - `packages/database-pg/src/schema/spaces.ts`
  - `packages/database-pg/graphql/types/spaces.graphql`
  - `packages/database-pg/drizzle/0117_space_access_mode.sql`
  - `packages/database-pg/__tests__/spaces-schema.test.ts`
  - `packages/api/src/graphql/resolvers/spaces/shared.ts`
  - `packages/api/src/graphql/resolvers/spaces/createSpace.mutation.ts`
  - `packages/api/src/lib/spaces/default-space.ts`

  **Approach:**

  Add `spaces.access_mode` with default `public`, a check constraint, and a manual migration marker for drift reporting. Backfill all existing Spaces to `public` so current tenants keep access until an operator intentionally marks a Space private. Update GraphQL with `enum SpaceAccessMode { PUBLIC PRIVATE }`, add `accessMode` to `Space`, and add optional `accessMode` to `CreateSpaceInput`.

  Update both default Space helpers so API-created defaults are explicitly public. Keep owner insertion in `createSpace` because public Space owners still matter for ownership and notifications.

  **Patterns to follow:**

  - `packages/database-pg/drizzle/0112_recast_spaces_as_contextual_workrooms.sql` for manual migration markers and idempotent column additions.
  - `parseSpaceStatus` / `toGraphqlSpace` enum casing in `packages/api/src/graphql/resolvers/spaces/shared.ts`.

  **Test scenarios:**

  - `packages/database-pg/__tests__/spaces-schema.test.ts`: `spaces.access_mode` exists, is non-null, and defaults to `public`.
  - `packages/database-pg/__tests__/spaces-schema.test.ts`: migration `0117_space_access_mode.sql` declares a `creates-column: public.spaces.access_mode` marker and adds an allowed-value constraint.
  - `packages/api/src/graphql/resolvers/spaces/createSpace.mutation.test.ts`: omitted `accessMode` creates a public Space.
  - `packages/api/src/graphql/resolvers/spaces/createSpace.mutation.test.ts`: `PRIVATE` input persists `private` and still inserts the creator as owner.

  **Verification:** Generated GraphQL types expose `Space.accessMode`, existing Spaces remain public after migration, and default Space creation is idempotent.

- U2. **Centralize Space access helpers and resolver filtering**

  **Goal:** Make one shared API model decide which Spaces a caller can see, enter, post to, and manage.

  **Requirements:** R1, R2, R4, R5, R6

  **Dependencies:** U1

  **Files:**

  - `packages/api/src/graphql/resolvers/spaces/shared.ts`
  - `packages/api/src/graphql/resolvers/spaces/spaces.query.ts`
  - `packages/api/src/graphql/resolvers/spaces/space.query.ts`
  - `packages/api/src/graphql/resolvers/spaces/customerOnboardingSpace.query.ts`
  - `packages/api/src/graphql/resolvers/spaces/startCustomerOnboarding.mutation.ts`
  - `packages/api/src/graphql/resolvers/linked-tasks/threadLinkedTasks.query.ts`
  - `packages/api/src/graphql/resolvers/spaces/spaces.query.test.ts`
  - `packages/api/src/graphql/resolvers/spaces/space.query.test.ts`
  - `packages/api/src/graphql/resolvers/spaces/customerOnboardingSpace.query.test.ts`
  - `packages/api/src/graphql/resolvers/spaces/startCustomerOnboarding.mutation.test.ts`
  - `packages/api/src/graphql/resolvers/linked-tasks/threadLinkedTasks.query.test.ts`

  **Approach:**

  Replace the binary `hasSpaceMemberAccess` meaning with clearer helpers:

  - tenant membership gate: active tenant member or authorized service/admin.
  - user Space participation gate: public Space plus active tenant member, or private Space plus `space_members`.
  - user Space posting gate: same as participation for v1.
  - admin Space management gate: tenant admin/service, independent from user participation.

  Update `spaces(tenantId, status)` to return user-accessible Spaces for Cognito user surfaces: public active Spaces plus private Spaces where the caller is a member. Preserve or introduce an admin management path so admin pages can still manage all Spaces without making those Spaces user-postable. Update `space(id)` to return null for inaccessible private Spaces on user calls.

  **Patterns to follow:**

  - `requireTenantMember` and `requireAdminOrServiceCaller` usage in `packages/api/src/graphql/resolvers/core/authz.ts`.
  - `resolveCallerUserId` fallback behavior for Google-federated users.

  **Test scenarios:**

  - `packages/api/src/graphql/resolvers/spaces/spaces.query.test.ts`: tenant user sees public Spaces without `space_members`.
  - `packages/api/src/graphql/resolvers/spaces/spaces.query.test.ts`: tenant user sees private Spaces only when `space_members.user_id` matches.
  - `packages/api/src/graphql/resolvers/spaces/spaces.query.test.ts`: user from another tenant sees an empty list.
  - `packages/api/src/graphql/resolvers/spaces/space.query.test.ts`: direct private Space lookup returns null for a non-member tenant user.
  - `packages/api/src/graphql/resolvers/spaces/startCustomerOnboarding.mutation.test.ts`: starting onboarding in a private Space fails for a non-member and succeeds for a member.
  - `packages/api/src/graphql/resolvers/linked-tasks/threadLinkedTasks.query.test.ts`: linked tasks for a private Space Thread are hidden from non-members even when they know the Thread ID.

  **Verification:** All Space read/post call sites use the same public/private semantics, and admin management is intentionally separated from user participation.

- U3. **Apply Space access to Thread creation, reading, messages, and mentions**

  **Goal:** Ensure public Spaces allow new Threads while private Spaces cannot be bypassed through Thread IDs or mentions.

  **Requirements:** R1, R2, R4, R5, R7; origin AE3, AE4

  **Dependencies:** U1, U2

  **Files:**

  - `packages/api/src/graphql/resolvers/threads/createThread.mutation.ts`
  - `packages/api/src/graphql/resolvers/threads/access.ts`
  - `packages/api/src/graphql/resolvers/threads/threadsPaged.query.ts`
  - `packages/api/src/graphql/resolvers/threads/threads.query.ts`
  - `packages/api/src/graphql/resolvers/threads/thread.query.ts`
  - `packages/api/src/graphql/resolvers/threads/threadByNumber.query.ts`
  - `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.ts`
  - `packages/api/src/lib/mentions/thread-mention-targets.ts`
  - `packages/api/src/lib/mentions/thread-participant-mentions.ts`
  - `packages/api/src/graphql/resolvers/threads/createThread.space.test.ts`
  - `packages/api/src/graphql/resolvers/threads/threadsPaged.query.test.ts`
  - `packages/api/test/integration/thread-tenant-pin.test.ts`
  - `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.test.ts`
  - `packages/api/src/lib/mentions/thread-mention-targets.test.ts`
  - `packages/api/src/lib/mentions/thread-participant-mentions.test.ts`

  **Approach:**

  In `createThread`, validate explicit `spaceId` through the new user posting helper. For omitted `spaceId`, `ensureDefaultThreadSpace` should resolve a public Space, then posting should pass for any active tenant member. Keep requester insertion into `thread_participants`.

  Extend the shared Thread visibility predicate so Cognito callers need both:

  - Thread participation: they started the Thread or have a `thread_participants` user row.
  - Space access: no Space, a public Space in the same tenant, or a private Space where they are a member.

  Update `sendMessage` to enforce the same Thread visibility/posting rule before inserting a message. Do not treat public Space access alone as permission to write to every Thread in that Space.

  Update mention target loading so public Spaces can mention active tenant users, private Spaces can mention only Space members plus existing Thread participants, and assigned agents remain governed by active `space_agent_assignments`.

  **Execution note:** Implement the private Space bypass cases test-first. They are the highest-risk authorization paths.

  **Patterns to follow:**

  - The shared `callerVisibleThreadPredicate` introduced for participant-based Thread access.
  - Existing `insertMentionParticipants` behavior, which adds mentioned people/agents as Thread participants.

  **Test scenarios:**

  - `packages/api/src/graphql/resolvers/threads/createThread.space.test.ts`: a tenant member without `space_members` can create a Thread in a public Space.
  - `packages/api/src/graphql/resolvers/threads/createThread.space.test.ts`: a tenant member without `space_members` cannot create a Thread in a private Space.
  - `packages/api/src/graphql/resolvers/threads/createThread.space.test.ts`: creating without `spaceId` uses the public default Space and succeeds for a tenant member.
  - `packages/api/src/graphql/resolvers/threads/threadsPaged.query.test.ts`: public Space Threads still appear only when the caller is owner/participant.
  - `packages/api/test/integration/thread-tenant-pin.test.ts`: a mentioned participant can read a public Space Thread.
  - `packages/api/test/integration/thread-tenant-pin.test.ts`: a mentioned non-member cannot read a private Space Thread unless they also have `space_members`.
  - `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.test.ts`: known Thread ID is insufficient to post to someone else's public Space Thread.
  - `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.test.ts`: private Space member and Thread participant can post.
  - `packages/api/src/lib/mentions/thread-mention-targets.test.ts`: public Space targets include active tenant users.
  - `packages/api/src/lib/mentions/thread-mention-targets.test.ts`: private Space targets exclude tenant users who are not Space members or current Thread participants.

  **Verification:** A new tenant user can create a Thread in the default public Space, cannot see unrelated public Space Threads, and cannot be pulled into a private Space Thread without membership.

- U4. **Update user app Space selection and no-Computer Thread creation**

  **Goal:** Let user-facing apps consume accessible Spaces and create Space-first Threads when no Computer is assigned.

  **Requirements:** R1, R2, R3, R7; origin F2, F4, AE2, AE5

  **Dependencies:** U1, U2, U3

  **Files:**

  - `apps/computer/src/lib/graphql-queries.ts`
  - `apps/computer/src/components/computer/ComputerWorkbench.tsx`
  - `apps/computer/src/components/computer/ComputerWorkbench.test.tsx`
  - `apps/computer/src/components/shell/ChatSidebar.tsx`
  - `apps/computer/src/components/shell/ChatSidebar.test.tsx`
  - `apps/computer/src/components/spaces/space-types.ts`
  - `apps/computer/src/gql/graphql.ts`
  - `apps/computer/src/gql/gql.ts`
  - `apps/mobile/lib/graphql-queries.ts`
  - `apps/mobile/app/(tabs)/index.tsx`
  - `apps/mobile/components/input/WorkspacePickerSheet.tsx`
  - `apps/mobile/lib/gql/graphql.ts`
  - `apps/mobile/lib/gql/gql.ts`

  **Approach:**

  Add `accessMode` to Space queries and UI types. Use the API's accessible Space list as the source of truth. Default selection should prefer the public default Space (`slug` `default` or `general`) when present.

  In `ComputerWorkbench`, split the "no assigned Computer" case from "no accessible Space":

  - If no Computer is selected but an accessible Space exists, create a Space-first Thread by omitting `computerId`.
  - If no accessible Space exists, show a Space-specific error.
  - Keep Computer-specific attachment/runbook behavior only on paths where a Computer is selected.

  Adjust navigation after creation to route to the Space Thread route when a Space was selected, or the general Thread route when appropriate.

  Mobile still has older workspace/sub-agent naming. Do not rename the whole mobile concept in this plan, but make any Space-aware query/type changes needed so generated clients remain consistent and empty states do not claim "No workspaces available" when public Spaces exist.

  **Patterns to follow:**

  - Existing default Space selection logic in `ComputerWorkbench`.
  - Existing route helper behavior around `/threads/$id` and `/spaces/$spaceId/threads/$threadId`.

  **Test scenarios:**

  - `apps/computer/src/components/computer/ComputerWorkbench.test.tsx`: tenant user with no assigned Computers but with a public default Space can submit a prompt; mutation omits `computerId` and includes `spaceId`.
  - `apps/computer/src/components/computer/ComputerWorkbench.test.tsx`: no Computer and no accessible Space shows a Space-specific error.
  - `apps/computer/src/components/computer/ComputerWorkbench.test.tsx`: assigned Computer path continues to send `computerId`.
  - `apps/computer/src/components/shell/ChatSidebar.test.tsx`: Space list includes public Spaces returned by the API and private member Spaces, with access labels available in data.
  - Mobile type/query coverage: generated GraphQL artifacts include `accessMode` for Space queries that need it.

  **Verification:** The screenshot scenario becomes a successful Space-first Thread creation for a tenant member with access to the default public Space.

- U5. **Expose access mode in admin Space management**

  **Goal:** Give operators a way to create, identify, and manage private Spaces without conflating admin management with user posting access.

  **Requirements:** R2, R3, R6

  **Dependencies:** U1, U2

  **Files:**

  - `apps/admin/src/lib/graphql-queries.ts`
  - `apps/admin/src/routes/_authed/_tenant/spaces/index.tsx`
  - `apps/admin/src/routes/_authed/_tenant/spaces/$spaceId.tsx`
  - `apps/admin/src/routes/_authed/_tenant/spaces/-spaces-admin-route.test.ts`
  - `apps/admin/src/components/agents/AgentSpacesPanel.tsx`
  - `apps/admin/src/components/agents/__tests__/AgentSpacesPanel.target.test.ts`
  - `apps/admin/src/gql/graphql.ts`
  - `apps/admin/src/gql/gql.ts`

  **Approach:**

  Add `accessMode` to admin Space list/detail/create queries and display it as a compact label in Space rows/detail headers. `CreateSpace` should default to public but allow private creation. If the existing admin list starts using a user-accessible `spaces` query, introduce or use an admin management path so tenant admins can still find private Spaces to add members/configure them.

  Keep the UI change practical: a segmented control or select for Public/Private during creation, a label on lists/detail, and no broad redesign of member management.

  **Patterns to follow:**

  - Existing create Space dialog in `apps/admin/src/routes/_authed/_tenant/spaces/index.tsx`.
  - Existing admin target tests that assert route/query structure.

  **Test scenarios:**

  - `apps/admin/src/routes/_authed/_tenant/spaces/-spaces-admin-route.test.ts`: admin queries include `accessMode`.
  - `apps/admin/src/routes/_authed/_tenant/spaces/-spaces-admin-route.test.ts`: create dialog sends `accessMode` and defaults to `PUBLIC`.
  - `apps/admin/src/components/agents/__tests__/AgentSpacesPanel.target.test.ts`: Space rows retain agent assignment display after `accessMode` is added.

  **Verification:** Operators can create a private Space, see which Spaces are public/private, and still manage private Spaces even before adding themselves as user-facing participants.

- U6. **Regenerate schemas and verify the authorization matrix**

  **Goal:** Keep generated clients in sync and prove the cross-layer access behavior.

  **Requirements:** R1-R7; origin AE1-AE5

  **Dependencies:** U1, U2, U3, U4, U5

  **Files:**

  - `terraform/schema.graphql`
  - `apps/admin/src/gql/graphql.ts`
  - `apps/admin/src/gql/gql.ts`
  - `apps/mobile/lib/gql/graphql.ts`
  - `apps/mobile/lib/gql/gql.ts`
  - `apps/computer/src/gql/graphql.ts`
  - `apps/computer/src/gql/gql.ts`
  - `packages/api/src/graphql/resolvers/spaces/spaces.query.test.ts`
  - `packages/api/src/graphql/resolvers/threads/threadsPaged.query.test.ts`
  - `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.test.ts`
  - `apps/computer/src/components/computer/ComputerWorkbench.test.tsx`

  **Approach:**

  Regenerate the AppSync schema and all affected GraphQL clients after the canonical GraphQL changes. Run focused API and UI tests around the access matrix before broader package typechecking.

  **Test scenarios:**

  - Public default Space appears for a newly added tenant member with no `space_members` row.
  - New user can create a Thread in that public Space.
  - New user does not see unrelated public Space Threads.
  - Private Space does not appear in user-facing lists until the user is added as a member.
  - Private Space Thread is hidden from a non-member even if they are accidentally inserted into `thread_participants`.
  - Admin can still create/configure private Spaces.

  **Verification:** Focused tests pass, generated GraphQL artifacts compile, and package typechecks pass for `@thinkwork/database-pg`, `@thinkwork/api`, `@thinkwork/computer`, `@thinkwork/admin`, and affected mobile code.

---

## System-Wide Impact

- End users get immediate access to the default public Space after joining a tenant.
- Tenant admins gain a clear public/private control on Spaces.
- Thread privacy remains stricter than Space visibility, so public Spaces do not leak another user's conversations.
- Private Space configuration becomes meaningful across Space lists, Thread access, message posting, mention targets, linked tasks, and customer onboarding flows.
- Generated GraphQL consumers across admin, mobile, and computer must all move together once `Space.accessMode` is added.

---

## Deferred Implementation Notes

- Exact helper names can shift during implementation, but the plan requires separate semantics for tenant membership, user Space participation/posting, and admin management.
- If the admin app cannot practically switch to an admin-specific Space query in this slice, the minimum acceptable fallback is preserving tenant-admin management visibility while proving user-facing participation helpers do not use that broader path.
- Existing data will become public by default. If any known production Spaces should be private immediately, run a targeted data update after the migration based on tenant/operator input.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Public Space access accidentally exposes all Threads in that Space | Medium | High | Keep Thread visibility predicate participant-based and add tests where public Space non-participant cannot list/read/post |
| Private Space can be bypassed by mentioning a non-member | Medium | High | Restrict private Space mention targets and add integration coverage for mention + Thread read behavior |
| Admin loses ability to manage private Spaces | Medium | Medium | Separate admin management helpers/query path from user-facing participation access |
| Computer no-assignment path conflates Space access with Computer access | Medium | Medium | Omit `computerId` only for Space-first Threads and keep Computer-specific paths gated on selected Computer |
| Existing Spaces unexpectedly become private | Low | High | Migration defaults and backfills all existing rows to `public`; private is opt-in |

---

## Rollout Notes

1. Apply the `spaces.access_mode` migration before deploying API code that selects or serializes `accessMode`.
2. Deploy API authorization changes with generated GraphQL artifacts in the same PR so clients compile against the new contract.
3. After deploy, spot-check a newly added tenant member:
   - sees the default public Space,
   - can create a new Thread there,
   - does not see unrelated Threads,
   - cannot access a private Space until added as a member.
