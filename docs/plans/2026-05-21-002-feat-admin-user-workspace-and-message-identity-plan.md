---
title: "feat: admin User Workspace and message ownership"
status: active
created: 2026-05-21
origin: direct user request in Codex thread
---

# feat: admin User Workspace and message ownership

## Problem

ThinkWork is moving from personal Computers toward Spaces, role-based Agents, and user-scoped requester context. The current admin UI and runtime are partly out of alignment with that model:

- Spaces appears in the top admin nav group instead of the Agentic OS group.
- Spaces uses the generic `FolderKanban` icon rather than the requested Tabler `Planet` visual.
- People detail only edits global user fields and Computer assignments; it does not expose the user-scoped workspace/context surface where a person's `USER.md` should live.
- The user-scoped `USER.md` is written to S3 at `tenants/{tenantId}/users/{userId}/USER.md`, but the runtime prompt injection currently relies on user `knowledge-pack.md` and agent workspace `USER.md`.
- Messages store `sender_type` and `sender_id`, but the product needs an explicit owner identity that can be read as "this message is from user X" or "this message is from agent Y" for multi-user, multi-agent collaboration.

## Scope

This plan targets `apps/admin`, `packages/api`, and the Strands runtime prompt-loading path. It does not redesign the end-user chat UI, migrate all historical message rows, or remove legacy Computer routes.

## Requirements

- R1. Admin Spaces nav item must move from the top work group into the Agentic OS group.
- R2. Admin Spaces nav icon must use Tabler Icon Planet.
- R3. People detail must expose a User Workspace/context configuration surface.
- R4. People detail must let admins edit structured user profile context fields that render into the user-scoped S3 `USER.md`.
- R5. The existing raw S3 user workspace editor must be reachable from the People detail workflow.
- R6. User-scoped `USER.md` must be injected into user-originated thread turns alongside existing requester/user context.
- R7. Every message must expose an owner identity that distinguishes user-owned messages from agent-owned messages.
- R8. Existing `sender_type` / `sender_id` compatibility must be preserved while new ownership semantics are added.

## Existing Context

- Admin nav is built in `apps/admin/src/components/Sidebar.tsx`.
- The current structural test that locked Spaces into the top work group is `apps/admin/src/routes/_authed/_tenant/computers/-computers-route.test.ts`.
- People detail lives in `apps/admin/src/routes/_authed/_tenant/people/$humanId.tsx`.
- Current profile editing is limited to `apps/admin/src/components/humans/HumanProfileSection.tsx` and `UpdateUserMutation`.
- `UpdateUserProfileInput` already exists in `packages/database-pg/graphql/types/core.graphql`.
- The user-scoped S3 writer is `packages/api/src/lib/user-context-md-writer.ts`; it writes `tenants/{tenantId}/users/{userId}/USER.md`.
- `packages/api/workspace-files.ts` already supports `{ userId }` targets and hides unsafe paths while allowing `USER.md` and visible `memory/*`.
- `/knowledge/user` already mounts `WorkspaceEditor` with `target={{ userId }}` in `apps/admin/src/routes/_authed/_tenant/knowledge/user.tsx`.
- Runtime user identity flows through `packages/api/src/handlers/chat-agent-invoke.ts` as `user_id`, then Strands maps it to `USER_ID` / `CURRENT_USER_ID`.
- Strands currently injects `knowledge-pack.md` through `packages/agentcore-strands/agent-container/container-sources/user_storage.py` and `server.py`.
- Messages currently persist `sender_type` and `sender_id` in `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.ts`; thread opening messages are inserted in `packages/api/src/graphql/resolvers/threads/createThread.mutation.ts`.

## Decisions

1. **User Workspace belongs in People detail.** Keep `/knowledge/user` as a power-user/shared route for now, but make People detail the primary path for a specific person.
2. **Structured profile fields remain database-backed.** Fields such as title, timezone, pronouns, call-by, notes, family, and context should save via `updateUserProfile`, which already regenerates user-scoped `USER.md`.
3. **Raw S3 editor is a secondary Workspace tab.** Use the existing `WorkspaceEditor` with `{ userId }` rather than inventing a new S3 editor.
4. **Inject user `USER.md` separately from `knowledge-pack.md`.** `knowledge-pack.md` is compiled memory/wiki context; `USER.md` is identity/profile context. The runtime should fetch both when a user id is present and include `USER.md` in a stable prompt slot near the existing user pack.
5. **Message ownership should be explicit but compatible.** Add derived owner semantics in GraphQL/API first, based on existing sender fields, with persistence only if the current schema already has a suitable column. If a schema migration is needed, add nullable `owner_type` / `owner_id` columns and backfill from existing message sender values.

## Implementation Units

### U1. Admin Spaces IA and Icon

**Goal:** Move Spaces into Agentic OS and switch its icon to Tabler Planet.

Files:

- `apps/admin/src/components/Sidebar.tsx`
- `apps/admin/src/components/CommandPalette.tsx` if the command palette also needs icon parity
- `apps/admin/src/routes/_authed/_tenant/computers/-computers-route.test.ts`

Tests:

- Update `apps/admin/src/routes/_authed/_tenant/computers/-computers-route.test.ts` to assert Spaces is inside `agentsItemsSource`, not `workItemsSource`.
- Assert `IconPlanet` or the chosen Tabler Planet import is present in the sidebar source.

### U2. People Detail User Workspace Surface

**Goal:** Add a People detail Workspace/Context surface for the selected user.

Files:

- `apps/admin/src/routes/_authed/_tenant/people/$humanId.tsx`
- `apps/admin/src/components/humans/HumanUserContextSection.tsx` or equivalent
- `apps/admin/src/components/humans/HumanProfileSection.tsx`
- `apps/admin/src/lib/graphql-queries.ts`
- `apps/admin/src/routes/_authed/_tenant/people/-human-computer-assignments.test.tsx` or a new `-human-user-workspace.test.tsx`

Tests:

- People detail mounts a User Workspace/context section.
- The section uses `UpdateUserProfileMutation` for structured context fields.
- The section mounts `WorkspaceEditor` with `target={{ userId }}` and `mode="context"`.
- The section preserves existing profile and Computer assignment behavior.

### U3. User Profile GraphQL Coverage in Admin

**Goal:** Ensure People detail has enough data to render and edit the profile fields that feed `USER.md`.

Files:

- `apps/admin/src/lib/graphql-queries.ts`
- generated files under `apps/admin/src/gql/` after codegen
- `packages/api/src/graphql/resolvers/core/updateUserProfile.mutation.ts` only if resolver behavior needs a small compatibility fix

Tests:

- Admin source-level test asserts `TenantMembersListQuery` requests `user.profile` fields needed by the context editor, or a dedicated `UserProfile` query exists and is used.
- Existing API profile writer tests continue to pass: `packages/api/src/__tests__/user-context-md-writer.test.ts`, `packages/api/src/__tests__/update-user-resolver.test.ts`.

### U4. Runtime User USER.md Injection

**Goal:** Inject user-scoped S3 `USER.md` for user-originated turns.

Files:

- `packages/agentcore-strands/agent-container/container-sources/user_storage.py`
- `packages/agentcore-strands/agent-container/container-sources/server.py`
- `packages/agentcore-strands/agent-container/test_user_storage.py`
- `packages/agentcore-strands/agent-container/test_knowledge_pack_loader.py` or a focused new test

Tests:

- Key builder returns `tenants/{tenantId}/users/{userId}/USER.md`.
- Missing user `USER.md` is non-fatal.
- When both `USER.md` and `knowledge-pack.md` exist, the system prompt includes the user profile context in a deterministic slot and still includes the knowledge pack.
- When no user id is present, user `USER.md` is not fetched and no stale prior user context remains.

### U5. Message Owner Identity

**Goal:** Make each message's owner identity explicit for user/agent attribution.

Files:

- `packages/database-pg/src/schema/messages.ts` or current message schema file, if nullable persisted columns are needed
- `packages/database-pg/graphql/types/*.graphql`
- `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.ts`
- `packages/api/src/graphql/resolvers/threads/createThread.mutation.ts`
- `packages/api/src/graphql/resolvers/messages/types.ts`
- `packages/api/src/graphql/resolvers/messages/*.test.ts`
- `apps/admin/src/components/threads/*` only if existing UI reads the new field directly

Tests:

- User-created messages expose owner type `user` and owner id equal to the sender user id.
- Agent/assistant messages expose owner type `agent` when an agent id is available.
- Legacy rows with only `sender_type` / `sender_id` still resolve owner identity.
- Opening message created by `createThread` gets the same owner semantics as messages created through `sendMessage`.

## Sequencing

1. U1 is independent and should land first because it is low risk.
2. U2 and U3 should be implemented together if the admin UI needs profile fields in the same query.
3. U4 should follow U2/U3 so the same `USER.md` generated by profile edits is visible in runtime turns.
4. U5 can be implemented in parallel with U4 if it is resolver-derived only; if it requires a migration, do it after U2/U3 to keep schema/codegen churn coherent.

## Verification

- `pnpm --filter @thinkwork/admin codegen` if GraphQL documents change.
- `pnpm --filter @thinkwork/admin test -- <focused admin tests>`
- `pnpm --filter @thinkwork/api test -- <focused API/message/profile tests>`
- Python runtime tests via `uv run pytest packages/agentcore-strands/agent-container/test_user_storage.py` and any new focused Strands test.
- `pnpm --filter @thinkwork/admin typecheck`
- `pnpm --filter @thinkwork/api typecheck`
- Browser verification for `/people/:humanId` and `/spaces` admin nav when the dev server is available.

## Risks

- There is historical tension between `USER.md` as generated identity context and requester memory markdown as learned context. Keep generated `USER.md` server-managed and keep editable memory files under `memory/*`.
- If message ownership requires a database migration, generated GraphQL clients and migration safety need extra verification.
- Injecting both `USER.md` and `knowledge-pack.md` can duplicate some identity content. Preserve both for now because they serve different freshness and provenance roles; later compaction can dedupe prompt content if needed.
