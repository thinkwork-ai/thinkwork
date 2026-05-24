---
title: "feat: Space Detail — Members tab, Workspace label revert, Generate Folder Structure parity"
type: feat
status: active
created: 2026-05-24
origin:
  - docs/plans/2026-05-23-002-feat-space-detail-polish-and-tenant-scoped-email-plan.md
  - docs/plans/2026-05-24-002-feat-context-md-folder-structure-generation-plan.md
  - docs/plans/2026-05-21-001-feat-public-private-space-access-plan.md
depth: standard
---

# feat: Space Detail — Members tab, Workspace label revert, Generate Folder Structure parity

## Summary

Three polish updates to the admin Space Detail page (`/spaces/$spaceId/*`):

1. **Generate Folder Structure parity for Spaces.** Extend the agent-only `generate-folder-structure` workspace-files action (shipped in `docs/plans/2026-05-24-002-feat-context-md-folder-structure-generation-plan.md`, R9 explicitly deferred Space targets) to accept a Space target. The context-menu affordance already lives in `apps/admin/src/components/agent-builder/FolderTree.tsx` which is shared between agent and Space workspace editors — the only blockers are a server `target.kind !== "agent"` gate, a client `"agentId" in stableTarget` gate, and an agent-shaped renderer (`generateContextFolderStructure(agentId, ...)`). Adding a Space-shaped sibling and a target-agnostic core unblocks parity.
2. **Revert the Files tab label back to Workspace.** The 2026-05-23-002 untracked plan renamed Workspace → Files on the rationale that "workspace" in product vocabulary refers to the rendered agent workspace tree. In context (a Space Detail page tab), "Workspace" reads as "this Space's workspace" — the collision the prior plan worried about is acceptable, and "Workspace" matches the route URL (`/spaces/$spaceId/workspace`), the underlying `WorkspaceEditor` component name, and the `Target.spaceId` workspace concept. Label-only change; the route URL stays.
3. **Members tab for private Spaces.** The `space_members` table already exists (shipped in `docs/plans/2026-05-21-001-feat-public-private-space-access-plan.md` — columns: `id`, `tenant_id`, `space_id`, `user_id`, `role`, `notification_preference`, with a `'owner'|'admin'|'member'|'viewer'` role check) and `createSpace` already inserts the creator as a member. The 2026-05-21-001 plan explicitly deferred member-management UX. Add GraphQL list/add/remove resolvers, a Members tab in `SpaceDetailChrome.tsx` rendered only when `access_mode === "PRIVATE"`, a DataTable of members, and an "Add member" dialog with a Combobox typeahead over the tenant's user list.

Item 4 from Eric's prompt — emails to `default@sleek-squirrel-230.thinkwork.ai` not triggering a thread — is a debug investigation and stays out of this plan. Track via `/ce-debug` invocation; see Deferred Work.

---

## Problem Frame

After the Space Detail page polish in `docs/plans/2026-05-23-002-feat-space-detail-polish-and-tenant-scoped-email-plan.md`, three rough edges remain:

- **Spaces can't refresh their own folder maps.** The `Generate Folder Structure` context-menu item is hidden on Space `CONTEXT.md` files (currently `Cut`/`Rename`/`Delete` only — confirmed in operator screenshot). The action exists, the FolderTree is shared, but the server + map-generator + client handler all hard-code an agent target. R9 of the agent-version plan deferred this with no follow-up issue.
- **The Files tab label conflicts with the route URL.** The route is `/spaces/$spaceId/workspace`, the underlying component is `WorkspaceEditor`, and the API target shape is `{ spaceId }` under `Target`. Calling the tab "Files" makes the URL → label mapping non-obvious for operators and makes admin-side terminology inconsistent (Files in UI, workspace in URLs, `workspace-files` in API). Reverting to "Workspace" lines all three up.
- **Operators have no way to manage members of private Spaces.** Private Spaces ship with a creator-as-only-member row and no UI to add more. The 2026-05-21-001 access plan committed `space_members.role` (with four-tier roles) but no resolvers or UI consume it.

These three changes hang together as a single Space Detail polish PR: all three touch `SpaceDetailChrome.tsx`, the rename is mechanical, and Members + Generate-Folder-Structure are both small additions that benefit from shared codegen + smoke testing.

---

## Requirements

Repo-relative paths only.

**Generate Folder Structure parity for Spaces**

- **R1.** The `Generate Folder Structure` file context-menu item appears on Space `CONTEXT.md` files at any depth (root or nested), matching agent behavior.
- **R2.** The `generate-folder-structure` workspace-files action accepts a Space target (`Target = { spaceId }`) in addition to the existing agent target. Server validation continues to require the path to end in `CONTEXT.md`.
- **R3.** For a Space target, the generated `## Folder Structure` section renders the Space's workspace subtree rooted at the clicked CONTEXT.md's parent folder, using the same algorithm as agents (folder-first sort, hidden-path filtering, `.gitkeep` suppression, `CONTEXT.md ← You are here` annotation on the clicked file).
- **R4.** For a Space target, the renderer must NOT load agent-only catalogs (`agent_skills`, `agent_knowledge_bases`, routines) or attempt to call `regenerateAgentsMdDerivedSections` — Spaces don't have AGENTS.md derived sections. Manifest regeneration uses the Space's manifest path.

**Workspace tab label revert**

- **R5.** The Space Detail tab currently labeled `Files` reads `Workspace`. Route URL stays `/spaces/$spaceId/workspace`. The internal tab union value stays `"workspace"`. The GraphQL `Space.description` field, DB columns, and mutation inputs are not touched.

**Members tab for private Spaces**

- **R6.** The Space Detail page chrome renders a `Members` tab **only when `space.accessMode === "PRIVATE"`**. Public Spaces do not show the tab. The tab appears at the end of the tab list: Configuration / Workspace / Memory / Automations / Members.
- **R7.** The route `/spaces/$spaceId/members` exists and renders the Members panel inside `SpaceDetailChrome`. Direct navigation to that URL on a public Space redirects to `/spaces/$spaceId/configuration`.
- **R8.** The Members panel renders a DataTable with columns: **User** (name + email), **Role** (badge — owner/admin/member/viewer), **Joined** (relative time). The DataTable uses the canonical `apps/admin/src/components/ui/data-table.tsx`.
- **R9.** Toolbar above the DataTable contains an **Add member** primary button. Clicking opens a Dialog with a Combobox typeahead over the tenant's USER-principal tenant-members, excluding users already in the Space. Selecting a user and confirming inserts a `space_members` row with `role = 'member'` and `notification_preference = 'subscribed'`.
- **R10.** Each table row has a trailing action menu with a **Remove** action. Removing the creator (the lone `owner`-roled member) is blocked server-side with a typed `CANNOT_REMOVE_OWNER` error; the UI surfaces the error inline.
- **R11.** GraphQL surface: `Space.members: [SpaceMember!]!` field on the `Space` type; `addSpaceMember(spaceId: ID!, userId: ID!): SpaceMember!` mutation; `removeSpaceMember(spaceId: ID!, userId: ID!): Boolean!` mutation. All three are admin-only via `requireAdminCaller(ctx, tenantId, "manage_space_members")`. Service-auth callers are rejected.
- **R12.** Adding a user already in the Space is idempotent (returns the existing membership row, no duplicate INSERT — the existing `uq_space_members_user(tenant_id, space_id, user_id)` unique index protects at the DB layer).
- **R13.** No new tables, no new columns, no schema changes. `space_members` is consumed as-is. Role grain stays four-tier in the DB but v1 UI only writes `member`; the `owner` row created by `createSpace` and any pre-existing `admin`/`viewer` rows render correctly as badges but are not assignable via the v1 add-flow.

---

## Acceptance Examples

- **AE1.** *(Covers R5.)* Given an admin opens `/spaces/<id>/configuration` on any Space, the tab list reads exactly **Configuration**, **Workspace**, **Memory**, **Automations** (plus **Members** on private Spaces — see AE4). The text "Files" does not appear in the tab list.

- **AE2.** *(Covers R1, R2, R3.)* Given an admin opens the Workspace tab on a Space containing `CONTEXT.md` at the root, right-clicking `CONTEXT.md` shows a `Generate Folder Structure` menu item. Selecting it sends a `POST /workspace-files { action: "generate-folder-structure", spaceId, path: "CONTEXT.md" }`; the server returns `{ ok: true }`; the file reloads and its `## Folder Structure` section now contains a fenced code block rooted at the Space slug with all workspace files listed and `CONTEXT.md ← You are here`.

- **AE3.** *(Covers R2, R4.)* Given the same call, the response is fast (no `agent_skills` or `agent_knowledge_bases` queries are issued — verifiable in server logs). The Space's workspace manifest is regenerated. No call to `regenerateAgentsMdDerivedSections` is made.

- **AE4.** *(Covers R6, R7, R8.)* Given a Space with `accessMode = PRIVATE`, the Space Detail tab list ends with a **Members** tab. Opening `/spaces/<id>/members` shows a DataTable with one row (the creator), columns User / Role / Joined, role badge reading `Owner`. Given the same path on a Space with `accessMode = PUBLIC`, the page redirects to `/spaces/<id>/configuration` and the Members tab is absent from the chrome.

- **AE5.** *(Covers R9, R11, R12.)* Given the admin clicks **Add member** on a private Space, a Dialog opens with a Combobox typeahead. Typing "ja" surfaces tenant users whose name or email matches (e.g., "Jane Doe — jane@acme.com"); users already in the Space are excluded from the list. Selecting Jane and confirming fires `addSpaceMember(spaceId, userId=jane.id)`; the DataTable refreshes to include Jane with role `Member`. Clicking **Add member** a second time and re-selecting Jane succeeds idempotently (no error, table unchanged).

- **AE6.** *(Covers R10, R11.)* Given the same private Space, opening the row action menu on Jane's row exposes a **Remove** item. Selecting it fires `removeSpaceMember(spaceId, userId=jane.id)`; the DataTable refreshes without Jane. Selecting **Remove** on the creator's row (role = owner) returns `CANNOT_REMOVE_OWNER`; the UI shows a toast with that message and leaves the row in place.

- **AE7.** *(Covers R11.)* Service-auth (`apikey`) callers invoking `addSpaceMember` or `removeSpaceMember` are rejected with the standard admin-only authz error. A user signed in as admin in a different tenant invoking the mutation is also rejected.

---

## Key Technical Decisions

- **Pick-from-tenant-user-list, not invite-by-email, for v1 add-flow.** Space membership presupposes an existing tenant user (per `docs/brainstorms/2026-05-22-one-platform-agent-spaces-runtime-requirements.md` R31's email-trigger model, where the inbound parser matches sender against `users.email` in the same tenant). Invite-by-email is a separate flow with onboarding/Cognito side effects and is deferred. The Combobox typeahead reuses `apps/admin/src/components/ui/combobox.tsx`; the tenant user list comes from the existing `TenantMembersListQuery` filtered to `principalType === "USER"`. Pattern precedent: `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerAccessUsersTable.tsx`.
- **Members tab only renders on private Spaces.** Public Spaces have implicit access (any tenant user can read/post); a Members tab there would be misleading. The tab visibility check is `space.accessMode === "PRIVATE"`. The `/members` route exists unconditionally for URL stability, but redirects to `/configuration` on public Spaces — same pattern as a deleted Space (the page resolves, the chrome rewrites navigation).
- **Flat membership in v1 UI; role column displays existing roles but only writes `member`.** The four-tier role check in `space_members.role` is preserved. The `owner` role is reserved for the Space creator (inserted by `createSpace`). UI never writes `owner`, `admin`, or `viewer`. A future plan can add role editing once product intent is clear; until then, displaying the role badge as read-only documents the existing data without committing to UI semantics. The four-tier DB constraint stays — no migration.
- **Label-only revert for Workspace tab.** No GraphQL, DB, or route URL changes. Same discipline as the 2026-05-23-002 plan's other rename decisions and the convention in `docs/solutions/conventions/admin-trim-ui-preserve-backend-mutations-2026-05-13.md`.
- **Extract a target-agnostic core for folder-structure rendering.** `generateContextFolderStructure` currently couples (a) loading the agent's S3 prefix + workspace catalog (which pulls skills/KBs/workflows), (b) reading + transforming the CONTEXT.md, (c) running `regenerateAgentsMdDerivedSections`, and (d) regenerating the manifest. For Spaces, (a) needs a Space-prefix loader and (c) is a no-op. Extract a private `renderAndWriteContextFolderStructure({ bucket, prefix, contextPath, rootLabel, contextByFolder, workspaceObjectPaths, manifestRegeneration, afterWrite })` core; provide one Space loader + one Agent loader. The renderer at line 1258 (`renderScopedContextFolderStructureBody`) is already target-agnostic and stays untouched.
- **No new GraphQL types for SpaceMember — extend the existing `Space` type.** `Space.members: [SpaceMember!]!` is a field on the existing `Space` type. `SpaceMember` is a new object type with `id`, `userId`, `user: User`, `role`, `notificationPreference`, `createdAt`. This avoids a separate `spaceMembers(spaceId)` query and keeps the data colocated with the Space the admin is viewing.
- **Server-side `CANNOT_REMOVE_OWNER` guard.** The single existing `owner`-roled member (the creator) is protected from removal by a server-side check. This is a UX guardrail, not a security boundary — admins can still re-assign ownership via direct DB if needed, and we intentionally don't add a "transfer ownership" mutation in v1. Documented in Deferred Work.
- **Idempotent add, hard-error remove-owner.** The unique index already enforces no-duplicate at the DB layer; the resolver catches the unique-violation and returns the existing row instead of erroring. Removing the owner returns a typed `GraphQLError` (`CANNOT_REMOVE_OWNER`) rather than silently no-opping, because operators clicking Remove deserve to know why nothing happened.

---

## High-Level Technical Design

Directional sketch of the folder-structure-on-Space pipeline. *Not implementation specification.*

```text
GENERATE FOLDER STRUCTURE on a Space CONTEXT.md:

  FolderTree (shared agent + space)
    right-click CONTEXT.md → menu item "Generate Folder Structure"
      → calls onGenerateFolderStructure(node.path) IF prop was passed

  WorkspaceEditor
    target = { spaceId } | { agentId } | ...
    onGenerateFolderStructure provided when "agentId" in target OR "spaceId" in target
    handleGenerateFolderStructure(path):
      save dirty editor first (existing path)
      call workspaceFilesApi.generateFolderStructure(target, path)
      reload file content

  workspace-files-api (admin client)
    generateFolderStructure(target: Target, path: string):
      POST /workspace-files
        body = { action: "generate-folder-structure", ...target, path }

  workspace-files Lambda handler (packages/api/workspace-files.ts)
    handleGenerateFolderStructure(deps, path):
      switch (target.kind):
        case "agent": existing path (unchanged)
        case "space": new path
          → resolveSpaceTarget already supplies { bucket, prefix, spaceSlug, ... }
          → generateContextFolderStructureForSpace(target.spaceId, cleanPath)
        else: 400

  workspace-map-generator (packages/api/src/lib/)
    NEW: loadFolderStructureRenderContext({ kind: "space", spaceId }):
      → query spaces + tenants for slugs
      → enumerate S3 objects under `tenants/{t}/spaces/{s}/workspace/`
      → extract H1 from nested CONTEXT.md files (same helper as agent path)
      → return { bucket, prefix, rootLabel: spaceSlug, workspaceObjectPaths, contextByFolder }

    NEW: generateContextFolderStructureForSpace(spaceId, contextPath):
      ctx = loadFolderStructureRenderContext({ kind: "space", spaceId })
      → core write path (read CONTEXT.md, replaceMarkdownSection, write, regen manifest)
      → DOES NOT call regenerateAgentsMdDerivedSections

    REFACTOR: generateContextFolderStructure(agentId, contextPath) ->
      thin wrapper that builds an agent-shaped context and delegates to the core,
      preserving the existing regenerateAgentsMdDerivedSections post-write step.
```

```text
MEMBERS TAB on a private Space:

  SpaceDetailChrome
    space.accessMode === "PRIVATE" → render <TabsTrigger value="members">
    activeTab === "members" → <SpaceMembersPanel spaceId />

  /spaces/$spaceId/members route
    beforeLoad: if space.accessMode !== "PRIVATE" → redirect to /configuration

  SpaceMembersPanel (apps/admin/src/components/spaces/SpaceMembersPanel.tsx)
    useQuery(SpaceMembersQuery) → space.members
    DataTable columns: User (name + email), Role (badge), Joined (relativeTime)
    Toolbar: <Button>Add member</Button>
    Row action menu: Remove (calls removeSpaceMember)

  Add Member Dialog
    Combobox typeahead over TenantMembersListQuery
      .filter(m => m.principalType === "USER" && !alreadyInSpace(m.user.id))
    Confirm → addSpaceMember(spaceId, userId) → refetch SpaceMembersQuery
```

---

## Output Structure

```text
apps/admin/src/components/spaces/
  SpaceDetailChrome.tsx                    (modified — tab label revert, conditional Members tab, panel mount)
  SpaceMembersPanel.tsx                    (NEW)
  SpaceMembersPanel.test.tsx               (NEW)
  AddSpaceMemberDialog.tsx                 (NEW — Combobox typeahead + confirm)
  AddSpaceMemberDialog.test.tsx            (NEW)
apps/admin/src/routes/_authed/_tenant/spaces/
  $spaceId_.members.tsx                    (NEW — route file + redirect guard)
apps/admin/src/components/agent-builder/
  WorkspaceEditor.tsx                      (modified — extend handleGenerateFolderStructure to spaceId; widen the prop gate)
apps/admin/src/lib/
  workspace-files-api.ts                   (modified — generateFolderStructure accepts Target, not raw agentId)
  agent-builder-api.ts                     (modified — mirror Target-aware wrapper if needed)
  graphql-queries.ts                       (modified — add SpaceMembersQuery, AddSpaceMemberMutation, RemoveSpaceMemberMutation;
                                            extend SpaceAdminDetailQuery if needed for accessMode read in chrome)
packages/api/workspace-files.ts            (modified — handleGenerateFolderStructure dispatches on target.kind)
packages/api/src/lib/workspace-map-generator.ts
                                           (modified — extract target-agnostic core; add Space loader + Space-shaped wrapper)
packages/api/src/lib/__tests__/workspace-map-generator.test.ts
                                           (modified — Space-target test cases)
packages/api/src/__tests__/workspace-files-handler.test.ts
                                           (modified — Space-target generate-folder-structure tests)
packages/api/src/graphql/resolvers/spaces/
  spaceMembers.field.ts                    (NEW — Space.members field resolver)
  addSpaceMember.mutation.ts               (NEW)
  addSpaceMember.mutation.test.ts          (NEW)
  removeSpaceMember.mutation.ts            (NEW)
  removeSpaceMember.mutation.test.ts       (NEW)
  index.ts                                 (modified — register new resolvers)
packages/database-pg/graphql/types/
  spaces.graphql                           (modified — SpaceMember type, members field, two mutations)
```

---

## Implementation Units

### U1. Revert Files tab label to Workspace

- **Goal:** Cosmetic label revert that lines up tab text with route URL + component naming.
- **Requirements:** R5
- **Dependencies:** none
- **Files:**
  - `apps/admin/src/components/spaces/SpaceDetailChrome.tsx` *(modify — change the `<TabsTrigger value="workspace">` link text from `Files` to `Workspace`; this is around lines 178-180 of the current file)*
- **Approach:** Pure text swap. Route paths and the `SpaceDetailTab` union (`"workspace"`) are unchanged.
- **Test scenarios:**
  - admin chrome test snapshot or assertion: visible tab list reads `Configuration`, `Workspace`, `Memory`, `Automations` (Members appears separately when accessMode is PRIVATE — see U4 tests).
  - the literal string `"Files"` does not appear in the tab list rendering.
- **Verification:** open `/spaces/<id>/configuration` on dev and confirm the second tab reads `Workspace`.

### U2. Server: target-agnostic generate-folder-structure core + Space loader

- **Goal:** Refactor `generateContextFolderStructure` into a target-agnostic core; add a Space-shaped sibling that reuses it.
- **Requirements:** R2, R3, R4
- **Dependencies:** none
- **Files:**
  - `packages/api/src/lib/workspace-map-generator.ts` *(modify — extract `renderAndWriteContextFolderStructure({ bucket, prefix, rootLabel, contextPath, workspaceObjectPaths, contextByFolder, contextDisplayName, afterWrite, regenerateManifest })` core; refactor existing `generateContextFolderStructure(agentId, contextPath)` to load agent context via `loadWorkspaceMapRenderContext`, then delegate to the core with the existing `regenerateAgentsMdDerivedSections` as `afterWrite`; add new `generateContextFolderStructureForSpace(spaceId, contextPath)` that resolves the Space prefix via the same logic used by `resolveSpaceTarget` in `packages/api/workspace-files.ts`, enumerates S3 objects under that prefix, derives `contextByFolder` via the existing H1 extractor, and delegates to the core with `afterWrite = async () => {}` (no AGENTS.md derived sections on Spaces))*
  - `packages/api/src/lib/__tests__/workspace-map-generator.test.ts` *(modify — add Space-target test coverage)*
- **Approach:** The renderer `renderScopedContextFolderStructureBody` (line 1258) already takes pure arguments — no refactor needed there. The new core just wires the I/O around it. For the Space prefix derivation, prefer to extract the prefix builder from `packages/api/workspace-files.ts:resolveSpaceTarget` into a shared helper in `packages/api/src/lib/space-workspace-prefix.ts` (NEW) so both the workspace-files handler and the map generator use the same logic — eliminates the risk of drift.
- **Patterns to follow:** existing agent-target loader at lines 561-775 (`loadWorkspaceMapRenderContext`) for S3 enumeration; `resolveSpaceTarget` at workspace-files.ts:355-385 for prefix derivation.
- **Test scenarios:**
  - happy path: a Space with `tenants/<t>/spaces/<s>/workspace/CONTEXT.md` and a `memory/CONTEXT.md` → calling `generateContextFolderStructureForSpace(spaceId, "CONTEXT.md")` writes a `## Folder Structure` section with both files listed under the Space slug root, with `CONTEXT.md ← You are here`.
  - nested: calling with path `memory/CONTEXT.md` renders only the `memory/` subtree, with `memory/CONTEXT.md ← You are here`.
  - missing section: Space CONTEXT.md without a `## Folder Structure` section gets a canonical section appended (same behavior as agent).
  - blank file: empty CONTEXT.md receives a minimal heading + the generated section.
  - no AGENTS.md side effects: the Space path does NOT call `regenerateAgentsMdDerivedSections` (assert via spy that the agent-only post-write isn't invoked).
  - manifest regenerated: the Space's workspace manifest is regenerated after the write (assert via spy on `regenerateManifest`).
  - non-existent space: invalid spaceId throws a clear error.
  - path must end in CONTEXT.md: non-CONTEXT.md path throws the same error as the agent path.
- **Verification:** `pnpm --filter @thinkwork/api exec vitest run src/lib/__tests__/workspace-map-generator.test.ts` passes; the new Space test cases cover both root and nested CONTEXT.md.

### U3. Server: workspace-files handler dispatches generate-folder-structure on target.kind

- **Goal:** Drop the agent-only gate in `handleGenerateFolderStructure` and route Space targets to U2's new function.
- **Requirements:** R1, R2
- **Dependencies:** U2
- **Files:**
  - `packages/api/workspace-files.ts` *(modify — at lines 2334-2373 replace the hard `target.kind !== "agent"` early return with a switch on `target.kind`: `"agent"` → existing path (incl. service-auth `x-agent-id` check); `"space"` → require admin caller via the existing auth context (no x-agent-id check), then call `generateContextFolderStructureForSpace(target.spaceId, cleanPath)`; any other kind → existing 400 with updated message "generate-folder-structure requires agentId or spaceId")*
  - `packages/api/src/__tests__/workspace-files-handler.test.ts` *(modify — add Space-target generate-folder-structure tests; assert existing agent-target behavior unchanged)*
- **Approach:** Service-auth (`apikey`) gating: agents can call generate-folder-structure on themselves (existing path); Spaces have no equivalent service caller in v1 (the runtime doesn't write Space CONTEXT.md), so reject `apikey` auth on Space targets with the existing 403 message generalized. Path normalization + CONTEXT.md basename check stays in the handler (shared across both kinds).
- **Patterns to follow:** existing `handleRegenerateMap` at lines 2323-2332 for the agent-only gate pattern (we're widening this, not copying it).
- **Test scenarios:**
  - agent target: existing behavior unchanged (regression assertion).
  - Space target, admin auth, root CONTEXT.md: 200 ok, file written, manifest regenerated.
  - Space target, admin auth, nested CONTEXT.md: 200 ok, scoped subtree rendered.
  - Space target, apikey auth: 403 rejected.
  - Space target, wrong path basename (e.g., `notes.md`): 400 with the existing message.
  - Space target, normalized-path traversal (`../../etc/passwd`): 400 via `normalizeWorkspacePath`.
  - Unknown target kind: 400 with updated error message naming both agentId and spaceId.
- **Verification:** `pnpm --filter @thinkwork/api exec vitest run src/__tests__/workspace-files-handler.test.ts` passes.

### U4. Admin: WorkspaceEditor + workspace-files-api client accept Space target for generate-folder-structure

- **Goal:** Surface the menu affordance on Space CONTEXT.md files and wire the client API to forward the Space target.
- **Requirements:** R1
- **Dependencies:** U3
- **Files:**
  - `apps/admin/src/lib/workspace-files-api.ts` *(modify — change `generateFolderStructure(agentId: string, path: string)` to `generateFolderStructure(target: Target, path: string)`; the body now spreads the target into the request `body` so `{ agentId }` or `{ spaceId }` flows through to the Lambda)*
  - `apps/admin/src/lib/agent-builder-api.ts` *(modify if it re-exports the wrapper — keep `agentBuilderApi.generateFolderStructure(agentId, path)` working by adapting it to the new signature, or update callers)*
  - `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx` *(modify — at lines 734-773 replace the agent-only `handleGenerateFolderStructure` body's `("agentId" in stableTarget)` gate with a check that accepts either agent or Space target; pass `stableTarget` to the API client; at lines 874-877 widen the prop gate from `"agentId" in stableTarget ? handleGenerateFolderStructure : undefined` to `("agentId" in stableTarget || "spaceId" in stableTarget) ? handleGenerateFolderStructure : undefined`)*
  - `apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts` *(modify — assert the Space-target case now enables the affordance)*
  - `apps/admin/src/lib/__tests__/workspace-files-api.test.ts` *(modify — assert the client sends `spaceId` in the request body when target is `{ spaceId }`)*
- **Approach:** Keep the dirty-save → generate → reload sequence intact (it's target-agnostic). The FolderTree context-menu gate at lines 595-596 is already correct (`node.name === "CONTEXT.md" && onGenerateFolderStructure`) — no change needed there.
- **Patterns to follow:** the existing agent path's dirty-save flow at lines 738-770.
- **Test scenarios:**
  - on a Space target, the context menu shows `Generate Folder Structure` for a CONTEXT.md node.
  - clicking the item calls `workspaceFilesApi.generateFolderStructure({ spaceId }, path)`.
  - the client request body includes `spaceId`, not `agentId`.
  - agent-target behavior is unchanged (regression).
  - errors from the server surface as toasts; editor state preserved.
- **Verification:** open Space Workspace tab, right-click CONTEXT.md, confirm the menu item appears; selecting it produces the new `## Folder Structure` section.

### U5. GraphQL: Space.members field + addSpaceMember + removeSpaceMember resolvers

- **Goal:** Server-side data surface for the Members tab.
- **Requirements:** R8, R9, R10, R11, R12, R13
- **Dependencies:** none
- **Files:**
  - `packages/database-pg/graphql/types/spaces.graphql` *(modify — define `type SpaceMember { id: ID!, userId: ID!, user: User!, role: String!, notificationPreference: String!, createdAt: DateTime! }`; add `members: [SpaceMember!]!` field on `Space`; add `addSpaceMember(spaceId: ID!, userId: ID!): SpaceMember!` and `removeSpaceMember(spaceId: ID!, userId: ID!): Boolean!` to the Mutation extension)*
  - `packages/api/src/graphql/resolvers/spaces/spaceMembers.field.ts` *(NEW — field resolver on `Space.members`; queries `spaceMembers` joined with `users` by `tenant_id + space_id`, ordered by `role` (owner first) then `created_at` asc; uses DataLoader pattern if a Space-batching loader exists, otherwise direct query)*
  - `packages/api/src/graphql/resolvers/spaces/addSpaceMember.mutation.ts` *(NEW — `requireAdminCaller(ctx, tenantId, "manage_space_members")`; verify `userId` belongs to the same tenant; INSERT into `space_members` with `role='member'`, `notification_preference='subscribed'`; on `unique_violation` (existing membership), SELECT the existing row and return it (idempotent); validation: reject if Space is not private (typed `SPACE_NOT_PRIVATE` — public Spaces don't take explicit members in v1))*
  - `packages/api/src/graphql/resolvers/spaces/addSpaceMember.mutation.test.ts` *(NEW)*
  - `packages/api/src/graphql/resolvers/spaces/removeSpaceMember.mutation.ts` *(NEW — admin-only authz; SELECT target row; if `role === 'owner'`, throw `CANNOT_REMOVE_OWNER` GraphQLError; otherwise DELETE; return true on success, false if no row matched)*
  - `packages/api/src/graphql/resolvers/spaces/removeSpaceMember.mutation.test.ts` *(NEW)*
  - `packages/api/src/graphql/resolvers/spaces/index.ts` *(modify — register the new field resolver + mutations)*
  - `packages/api/src/__tests__/graphql-contract.test.ts` *(modify — extend snapshot to include the new field + mutations)*
  - `apps/admin/src/lib/graphql-queries.ts` *(modify — add `SpaceMembersQuery($spaceId: ID!)` selecting `space.id, space.accessMode, space.members { id, userId, role, notificationPreference, createdAt, user { id, name, email, image } }`; add `AddSpaceMemberMutation`, `RemoveSpaceMemberMutation`)*
  - codegen regen across `apps/admin`, `apps/mobile`, `apps/cli`, `packages/api` per CLAUDE.md
- **Approach:** Field resolver attached to the `Space` type rather than a top-level `spaceMembers(spaceId)` query — colocates the data with the Space object and lets the admin select members on the existing space-by-id fetch when convenient. The `SpaceMembersQuery` still exists separately so the Members tab can refetch independently of the chrome.
- **Patterns to follow:** existing `setSpaceEmailTriggers.mutation.ts` for resolver shape, `requireAdminCaller` admin-only auth, and typed GraphQLError pattern. `updateSpace.mutation.ts` for tenant-guard verification.
- **Test scenarios:**
  - **add happy path:** admin adds a tenant user not yet a member → row inserted, returns SpaceMember with role=member, user populated.
  - **add idempotent:** adding the same user twice → no DB error, second call returns the existing row.
  - **add wrong tenant:** userId belongs to a different tenant → typed `USER_NOT_IN_TENANT`.
  - **add to public Space:** Space `access_mode='public'` → typed `SPACE_NOT_PRIVATE`.
  - **add unauthorized:** non-admin caller rejected; service-apikey caller rejected.
  - **remove happy path:** admin removes a `member`-role user → row deleted, returns true.
  - **remove owner:** target role='owner' → typed `CANNOT_REMOVE_OWNER`; row stays.
  - **remove non-existent:** userId not a member → returns false (no error).
  - **remove unauthorized:** non-admin rejected; cross-tenant admin rejected.
  - **field resolver:** Space.members returns owner first, then members in creation order, with full user payload.
  - **contract snapshot:** new types + mutations appear in the contract test.
- **Verification:** `pnpm --filter @thinkwork/api exec vitest run src/graphql/resolvers/spaces` passes; manual GraphQL query against dev against `space.members` returns the populated list.

### U6. Admin: Members tab + DataTable + Add Member dialog

- **Goal:** Render the Members UI in `SpaceDetailChrome`, gated to private Spaces.
- **Requirements:** R6, R7, R8, R9, R10
- **Dependencies:** U5
- **Files:**
  - `apps/admin/src/components/spaces/SpaceDetailChrome.tsx` *(modify — extend `SpaceDetailTab` union to include `"members"`; conditionally render `<TabsTrigger value="members">` after Automations when `space.accessMode === "PRIVATE"`; export `SpaceMembersPanelMount` wrapper that reads `spaceId` from context and delegates to the new `SpaceMembersPanel` component; ensure `SpaceAdminDetailQuery` selects `accessMode` if it doesn't already)*
  - `apps/admin/src/components/spaces/SpaceMembersPanel.tsx` *(NEW — useQuery(SpaceMembersQuery); render DataTable with columns User (avatar + name + email), Role (badge with role colors), Joined (relativeTime); toolbar with "Add member" button; row action menu with Remove (calls RemoveSpaceMemberMutation, refetch on success); error toasts for `CANNOT_REMOVE_OWNER` and any other typed errors)*
  - `apps/admin/src/components/spaces/SpaceMembersPanel.test.tsx` *(NEW)*
  - `apps/admin/src/components/spaces/AddSpaceMemberDialog.tsx` *(NEW — Dialog containing a Combobox typeahead populated from TenantMembersListQuery filtered to `principalType === "USER"` and excluding userIds already in `existingMemberUserIds` prop; Confirm button fires AddSpaceMemberMutation; on success, calls `onMemberAdded` callback and closes dialog)*
  - `apps/admin/src/components/spaces/AddSpaceMemberDialog.test.tsx` *(NEW)*
  - `apps/admin/src/routes/_authed/_tenant/spaces/$spaceId_.members.tsx` *(NEW — TanStack route file; `beforeLoad` fetches the Space's accessMode (via a small dedicated query or by reading from the chrome's loader); if `accessMode !== "PRIVATE"`, throw `redirect({ to: "/spaces/$spaceId/configuration", params: { spaceId } })`; otherwise render `<SpaceDetailChrome spaceId activeTab="members">{({ space }) => <SpaceMembersPanel spaceId={space.id} />}</SpaceDetailChrome>`)*
- **Approach:** Members tab visibility is data-driven on `space.accessMode` from the chrome's existing query. The `/members` route's redirect guard is the second line of defense in case someone bookmarks the URL after flipping a Space from private to public. Use the same `useMutation(RemoveSpaceMemberMutation)` pattern as `setSpaceEmailTriggers`. The Combobox is wired to the existing `apps/admin/src/components/ui/combobox.tsx`.
- **Patterns to follow:**
  - `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerAccessUsersTable.tsx` for the user-in-X DataTable shape, TenantMembersListQuery filter, and Edit-Dialog pattern.
  - `apps/admin/src/components/spaces/SpaceEmailTriggersToggle.tsx` for the typed-error → toast surface pattern.
  - `apps/admin/src/components/ui/combobox.tsx` for the typeahead behavior; `apps/admin/src/components/ui/data-table.tsx` for the DataTable; `apps/admin/src/components/ui/dropdown-menu.tsx` for the row action menu.
- **Test scenarios:**
  - **chrome tab visibility:** Space with accessMode=PRIVATE renders the Members tab in the tab list; Space with accessMode=PUBLIC does not.
  - **route guard:** navigating to `/spaces/<id>/members` on a public Space redirects to `/spaces/<id>/configuration`.
  - **DataTable rendering:** seeded Space with one owner row → table shows one row with role badge `Owner`; multiple members → owner first, then members by joined-time asc.
  - **Add Member dialog:** opens with empty Combobox; typing filters tenant users; users already in space are absent from suggestions; selecting + confirming fires mutation; on success table refetches.
  - **Add Member error:** mutation returns `USER_NOT_IN_TENANT` → toast surfaces the error; dialog stays open.
  - **Remove member row action:** clicking Remove on a member row fires `removeSpaceMember`; table refetches; row gone.
  - **Remove owner blocked:** clicking Remove on the owner row → mutation returns `CANNOT_REMOVE_OWNER` → toast; row remains.
  - **Empty Combobox state:** all tenant users already members → Combobox shows "No users available".
- **Verification:** open a private Space on dev; confirm Members tab visible, add a tenant user, remove a member, confirm owner can't be removed.

---

## Scope Boundaries

In scope:
- The six implementation units above as a single bundled PR.
- Label-only revert of "Files" → "Workspace".
- Extending `generate-folder-structure` to Space targets (R9 of the agent plan).
- Members tab on private Spaces with DataTable + add/remove flows backed by new GraphQL surface.

Out of scope:
- The email-not-triggering-thread debug (Eric's item 4). Investigate via `/ce-debug` separately. The failure could be: (a) Eric's tenant slug is still the auto-generated `sleek-squirrel-230` so the SES domain identity for that subdomain may not exist; (b) the inbound parser logic for the new `<space>@<tenant>.thinkwork.ai` shape may not be wired yet (per 2026-05-23-002, U7 was the email parser switch — confirm whether that PR landed); (c) the receipt rule may not be picking up `*.thinkwork.ai`. The fact that the address Eric sent to is `default@sleek-squirrel-230.thinkwork.ai` confirms he's using the new shape; the right next step is `/ce-debug` against the email-inbound CloudWatch logs.
- Role editing (changing a member's role between member/admin/viewer). The four-tier role check stays in DB but UI only writes `member`.
- Invite-by-email for users not yet in the tenant.
- Transfer ownership of a Space (changing which member has `role='owner'`).
- Members tab on public Spaces (intentionally absent — public Spaces have implicit access).
- Bulk add (multi-select Combobox or CSV import).
- Notification preference editing per-member (the column exists in DB; UI doesn't expose it).
- AGENTS.md derived-section equivalents for Spaces (e.g., a "SPACE.md" with Skills/KBs/Workflows sections). The 2026-05-22 one-platform-agent brainstorm mentions Space-additive `skills/`, `TOOLS.md`, `MCP.md` but those are separate from CONTEXT.md folder structure rendering.

### Deferred to Follow-Up Work

- **`/ce-debug` for email-not-triggering-thread.** Investigate `default@sleek-squirrel-230.thinkwork.ai` send → no thread. Likely related to whether U6 (SES + DNS Terraform) and U7 (email parser) of `docs/plans/2026-05-23-002-feat-space-detail-polish-and-tenant-scoped-email-plan.md` have actually landed. Out of scope for this plan; logged here so it isn't forgotten.
- **Role editing UI for space members.** Once product intent is clear on what `admin` vs `viewer` actually mean in v1, add an inline role picker. The DB constraint and resolver auth are ready.
- **Transfer ownership mutation.** Currently the creator is permanently the `owner` row. A `transferSpaceOwnership(spaceId, newOwnerUserId)` mutation that atomically demotes the current owner to admin and promotes the target to owner is straightforward but unscoped here.
- **Invite-by-email for non-tenant users.** Pre-creates a tenant user, sends an invite email with a sign-up link via Cognito, and inserts a pending `space_members` row on accept. Needs onboarding/Cognito design.
- **Notification preference per-member.** `space_members.notification_preference` exists (subscribed/mentions/muted) but no UI consumes it. Add to the member row or member detail flyout once product intent is clear.
- **Bulk add (multi-select Combobox).** Trivial UX extension once the single-add flow is in.
- **Members tab parity in mobile (`apps/mobile`).** Codegen regen happens but no mobile UI is added.

---

## Risks & Mitigations

- **Risk: the workspace-map-generator core refactor breaks the agent path.** The existing agent generate-folder-structure tests are the safety net. Mitigation: U2 keeps the agent test suite green as a regression gate; the refactor preserves the `regenerateAgentsMdDerivedSections` call on the agent path by passing it as `afterWrite`. Run agent-target tests first before merging.
- **Risk: `Space.members` field on every Space query pulls a large join on tenants with many Spaces.** Spaces are tenant-scoped; current scale is ~5 Spaces per tenant max so the field is small. Mitigation: the field is opt-in (only `SpaceMembersQuery` selects it; the chrome's general `SpaceAdminDetailQuery` doesn't). If list pages start selecting it later, add a DataLoader.
- **Risk: route-level redirect-on-public-Space conflicts with TanStack's `beforeLoad` typing.** The Space's accessMode isn't always available pre-load. Mitigation: use TanStack's `loader` + redirect-in-component pattern (render a temporary `<Redirect />` or fire `navigate({ to: "/spaces/$spaceId/configuration" })` in an effect) instead of a strict `beforeLoad` if the typing fights us. The user-visible behavior (private vs public Members visibility) is identical either way.
- **Risk: `CANNOT_REMOVE_OWNER` guard is bypassable via direct DB.** Intentional — this is a UX guardrail. If a tenant admin needs to recover from a deleted-owner state, they can DELETE + INSERT directly. Documented in Key Technical Decisions.
- **Risk: Combobox typeahead over a large tenant user list (1000+ users) is slow.** Current scale is ~20-50 users per tenant; the Combobox renders client-side filter. Mitigation: defer server-side typeahead to a follow-up when a tenant exceeds 200 users — easy to bolt on once data scales.
- **Risk: Space CONTEXT.md doesn't currently exist for some Spaces** (created before Spaces auto-seeded a CONTEXT.md). The Generate Folder Structure action handles missing-section and blank-file cases (U2 test scenarios), but if the file is entirely absent (no S3 object), the read returns empty and the seed path fires. Mitigation: U2 tests cover the blank-file case; the action is safe to invoke on Spaces with no existing CONTEXT.md.

---

## Dependencies / Prerequisites

- `space_members` table exists at `packages/database-pg/src/schema/spaces.ts` lines 91-134 (shipped in 2026-05-21-001-feat-public-private-space-access-plan).
- `spaces.access_mode` column exists with `'public'|'private'` check (same plan).
- Shared `WorkspaceEditor` already accepts `Target = { spaceId }` (confirmed at `apps/admin/src/components/spaces/SpaceDetailChrome.tsx:305-313`).
- `resolveSpaceTarget` already builds the Space S3 prefix from tenant+space slugs (`packages/api/workspace-files.ts:355-385`).
- `apps/admin/src/components/ui/data-table.tsx` and `combobox.tsx` are canonical and stable.
- `TenantMembersListQuery` exists at `apps/admin/src/lib/graphql-queries.ts:1588`.
- CI's `pnpm db:migrate-manual` gate is a no-op for this PR (no migrations).
- After merge, no Terraform apply or operator action is required (no infrastructure changes).
