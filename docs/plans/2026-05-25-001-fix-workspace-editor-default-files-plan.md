---
title: "fix: Auto-select default files in Workspace editors"
type: fix
status: completed
date: 2026-05-25
---

# fix: Auto-select default files in Workspace editors

## Overview

When an operator opens a workspace-file editor, the shared editor should open the surface's canonical root document instead of leaving the editor pane on the blank "Select a file" state. The defaults are `AGENTS.md` for `/agent/files`, `SPACE.md` for Space workspace files, and `USER.md` for user workspace files. The change is a small client-side default-selection fix in the admin SPA; it should not change workspace file APIs, backend derivation, save semantics, or file-tree actions.

## Problem Frame

The current `WorkspaceEditor` loads the workspace file list and renders the tree, but `openFile` remains `null` unless the user clicks a file or `initialFolder` resolves to `<folder>/CONTEXT.md`. On `/agent/files` this makes the first view feel empty even though `AGENTS.md` is visible and is the primary always-loaded workspace document. The same blank-pane problem applies to related file editors where the root document carries the surface identity: `SPACE.md` for Spaces and `USER.md` for Users.

## Requirements Trace

- R1. Opening `/agent/files` with root `AGENTS.md` present should automatically select and load `AGENTS.md`.
- R2. Opening a Space workspace-file surface with root `SPACE.md` present should automatically select and load `SPACE.md`.
- R3. Opening a user workspace-file surface with root `USER.md` present should automatically select and load `USER.md`.
- R4. The file tree selected state and editor header should reflect the automatically opened file after load, matching a manual click.
- R5. Existing explicit `initialFolder` behavior should continue to take priority when it resolves to `<folder>/CONTEXT.md`.
- R6. The automatic selection should run only when no file is already open and should not interrupt pending edits, manual file selection, target changes, or stale in-flight loads.
- R7. If the expected default file is absent, the editor should keep the existing "Select a file" empty state rather than choosing an arbitrary fallback file.

## Scope Boundaries

- Do not change the workspace-files API or any S3 write/read behavior.
- Do not add a route query parameter for selected file in this slice.
- Do not auto-select arbitrary first files for any editor.
- Do not change catalog, defaults, computer, or tenant skill catalog behavior.
- Do not change `FileEditorPane` empty-state text; the goal is to avoid that state only when the surface's canonical file exists.
- Do not change file-tree sorting, expansion, context menus, or regenerate actions.

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/components/tenant-agent/TenantAgentWorkspaceTab.tsx` mounts `WorkspaceEditor` with `target={{ agentId }}` and `mode="agent"` for `/agent/files`, the Workspace tab shown in the screenshot.
- `apps/admin/src/components/spaces/SpaceDetailChrome.tsx` mounts `WorkspaceEditor` with `target={{ spaceId }}` and `mode="context"` for Space workspace files.
- `apps/admin/src/routes/_authed/_tenant/users/$userId.tsx` mounts `WorkspaceEditor` with `target={{ userId }}` and `mode="context"` for the Users `files` tab.
- `apps/admin/src/routes/_authed/_tenant/knowledge/user.tsx` also mounts a user-targeted `WorkspaceEditor`; this is the main ambiguity to avoid. A target-derived default would affect it too, so the safer plan is explicit host opt-in.
- `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx` owns file list loading, `openFile`, `focusedTreePath`, `openWorkspaceFile`, `requestOpenWorkspaceFile`, `loadRequestId`, and the existing `initialFolder` effect.
- `apps/admin/src/components/agent-builder/FileEditorPane.tsx` renders "Select a file" only when `openFile` is `null`.
- `apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts` already uses source-level assertions for WorkspaceEditor behavior and is the lowest-friction place to pin this targeted state-flow contract.
- `docs/plans/2026-05-24-002-feat-context-md-folder-structure-generation-plan.md` reinforces that `WorkspaceEditor` is the right owner for tree/editor interactions and dirty-save-aware file loading.

### Institutional Learnings

- `docs/solutions/conventions/admin-trim-ui-preserve-backend-mutations-2026-05-13.md` cautions against coupling small admin UI changes to backend mutation cleanup. This fix should stay UI-scoped.
- `docs/solutions/design-patterns/gitkeep-materialization-s3-empty-folders-2026-05-13.md` documents that the workspace editor has several synthesized tree affordances; default selection should use real root file paths, not synthetic folder rows or `.gitkeep` sentinels.

### External References

- None. The repo has direct local patterns for this React state-flow change.

## Key Technical Decisions

- Add default selection inside `WorkspaceEditor`, close to the existing `initialFolder` handling, because the behavior depends on loaded file paths and the editor's request-id guards.
- Add an explicit optional prop, `defaultOpenFile`, so each host opts into its canonical root file: `/agent/files` passes `AGENTS.md`, Space workspace passes `SPACE.md`, and Users files passes `USER.md`.
- Prefer exact root files only, not nested `*/AGENTS.md`, `*/SPACE.md`, or `*/USER.md`, because each default represents the current root surface.
- Preserve explicit deep-link intent by letting `initialFolder` handling open `<folder>/CONTEXT.md` first when it can; the default-file selection should only run when no open file exists.
- Reuse `openWorkspaceFile(defaultOpenFile)` rather than duplicating fetch logic so `openFile`, `focusedTreePath`, loading state, content, error behavior, and stale-response handling remain consistent.

## Open Questions

### Resolved During Planning

- Should the default be the canonical surface file or first file? Use only the canonical surface file: `AGENTS.md`, `SPACE.md`, or `USER.md`.
- Should a missing default select another file? No; keep the existing empty state when the expected default is unavailable.
- Should this include catalog/skills tab behavior? No; catalog mode has different semantics and no single root governance file.

### Deferred to Implementation

- Exact effect shape: implementation can choose one combined effect or two ordered effects as long as `initialFolder` priority, `openFile` guards, and request-id behavior are preserved.

## Implementation Units

- U1. **Default root file selection**

**Goal:** Automatically open the appropriate root file after the workspace file list loads, without disturbing explicit or user-selected files.

**Requirements:** R1, R2, R3, R4, R5, R6, R7

**Dependencies:** None

**Files:**
- Modify: `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx`
- Modify: `apps/admin/src/components/tenant-agent/TenantAgentWorkspaceTab.tsx`
- Modify: `apps/admin/src/components/spaces/SpaceDetailChrome.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/users/$userId.tsx`
- Test: `apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts`

**Approach:**
- Add a small derived guard or effect that runs after `files` is populated.
- Add `defaultOpenFile?: string` to `WorkspaceEditorProps`.
- Pass `defaultOpenFile="AGENTS.md"` from `TenantAgentWorkspaceTab`, `defaultOpenFile="SPACE.md"` from `SpaceWorkspacePanel`, and `defaultOpenFile="USER.md"` from the Users `files` tab.
- Require `defaultOpenFile`, `openFileRef.current === null`, and `files.includes(defaultOpenFile)` before invoking `openWorkspaceFile(defaultOpenFile)`.
- Keep the existing `initialFolder` effect higher priority: if `initialFolder` resolves to `<folder>/CONTEXT.md`, that file opens and the default-selection guard sees an open file and exits.
- Use an idempotence ref only if needed to prevent repeat attempts while still allowing the existing target-key reset effect to re-enable default selection for a different agent.

**Patterns to follow:**
- Existing `initialFolder` effect in `WorkspaceEditor.tsx`.
- Existing `openWorkspaceFile` request-id and stale-response handling in `WorkspaceEditor.tsx`.

**Test scenarios:**
- Happy path: given an agent target and files `["AGENTS.md", "CONTEXT.md"]`, when the file list is available and no file is open, the WorkspaceEditor source includes a guarded path that opens `AGENTS.md` by default.
- Happy path: given a space target and files `["SPACE.md", "CONTEXT.md"]`, the default path resolves to `SPACE.md`.
- Happy path: given a user target and files `["USER.md", "memory/profile.md"]`, the default path resolves to `USER.md`.
- Edge case: given a user-targeted `WorkspaceEditor` without `defaultOpenFile`, no automatic `USER.md` selection occurs.
- Edge case: given `initialFolder` can resolve to `workspaces/sql/CONTEXT.md`, the default selection does not override that explicit file intent.
- Edge case: given files do not include the expected root default file, no fallback first-file selection is introduced.
- Edge case: given a file is already open, the default-selection path does not invoke `openWorkspaceFile(defaultPath)` again.
- Integration: selectedPath continues to receive `openFile`, so the tree row highlight follows the automatically opened file through the existing `FolderTree` props.

**Verification:**
- Opening `/agent/files` for an agent with root `AGENTS.md` shows the AGENTS.md editor content instead of "Select a file".
- Opening a Space workspace with root `SPACE.md` shows the SPACE.md editor content instead of "Select a file".
- Opening a Users `files` tab with root `USER.md` shows the USER.md editor content instead of "Select a file".
- Opening a workspace link with a valid folder intent still opens that folder's `CONTEXT.md`.
- The editor remains blank only when the workspace lacks the expected default file.

- U2. **Focused regression coverage for default-file hosts**

**Goal:** Pin the host wiring so future changes do not accidentally move default-selection behavior to the wrong mode, target, or root file.

**Requirements:** R1, R2, R3, R6

**Dependencies:** U1

**Files:**
- Modify: `apps/admin/src/components/tenant-agent/TenantAgentWorkspaceTab.tsx`
- Modify: `apps/admin/src/components/spaces/SpaceDetailChrome.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/users/$userId.tsx`
- Test/inspect: `apps/admin/src/routes/_authed/_tenant/knowledge/user.tsx`
- Test: `apps/admin/src/routes/_authed/_tenant/agent/__tests__/-AgentToolsTabs.target.test.ts`
- Test: `apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts`

**Approach:**
- Keep loading behavior internal to `WorkspaceEditor`, but make the default choice host-controlled via `defaultOpenFile`.
- Avoid changing the existing tab route contract in `apps/admin/src/routes/_authed/_tenant/agent/files.tsx`; it should continue to mount `TenantAgentWorkspaceTab` for the tenant agent.
- Add source-level tests only where current project style already uses source assertions; do not introduce a heavy browser test for this small state-flow fix.

**Patterns to follow:**
- Existing Agent tab source assertions in `apps/admin/src/routes/_authed/_tenant/agent/__tests__/-AgentToolsTabs.target.test.ts`.
- Existing WorkspaceEditor source assertions in `apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts`.

**Test scenarios:**
- Happy path: `TenantAgentWorkspaceTab` passes `defaultOpenFile="AGENTS.md"`.
- Happy path: `SpaceWorkspacePanel` passes `defaultOpenFile="SPACE.md"`.
- Happy path: Users `files` tab passes `defaultOpenFile="USER.md"`.
- Edge case: `apps/admin/src/routes/_authed/_tenant/knowledge/user.tsx` does not accidentally receive `USER.md` defaulting unless the product owner intentionally opts that surface in.
- Edge case: catalog Skills tab wiring remains `mode="catalog"` and does not inherit a default root file.
- Regression: source assertions confirm the default-selection behavior is tied to explicit root files, not the first file in the tree.

**Verification:**
- Focused admin tests covering WorkspaceEditor and relevant host wiring pass.
- Manual browser smoke confirms the screenshot state is gone on `/agent/files`, Space workspace opens `SPACE.md`, Users files opens `USER.md`, and Skills/catalog surfaces remain unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Auto-open races with `initialFolder` and briefly loads a default file before a deep-linked `CONTEXT.md`. | Gate on `initialFolder` handling or track whether explicit folder intent is pending before running the fallback. |
| Shared `WorkspaceEditor` behavior leaks into catalog or unrelated editors. | Use explicit `defaultOpenFile` host props; unsupported surfaces pass nothing and keep the current selection-first behavior. |
| The effect repeatedly reloads the default file after file-list refreshes. | Require no open file and add an idempotence ref if the existing `openFile` guard is insufficient. |

## Sources & References

- Related requirements: `docs/brainstorms/2026-04-28-agent-detail-dashboard-editor-tabs-requirements.md`
- Related requirements: `docs/brainstorms/2026-05-23-editor-driven-agents-md-section-regen-requirements.md`
- Related plan: `docs/plans/2026-05-24-002-feat-context-md-folder-structure-generation-plan.md`
- Related code: `apps/admin/src/components/tenant-agent/TenantAgentWorkspaceTab.tsx`
- Related code: `apps/admin/src/components/spaces/SpaceDetailChrome.tsx`
- Related code: `apps/admin/src/routes/_authed/_tenant/users/$userId.tsx`
- Related code: `apps/admin/src/routes/_authed/_tenant/knowledge/user.tsx`
- Related code: `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx`
- Related code: `apps/admin/src/components/agent-builder/FileEditorPane.tsx`
- Related tests: `apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts`
