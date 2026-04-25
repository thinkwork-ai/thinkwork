---
title: "fix(admin): add delete parity to agent workspace tree"
type: fix
status: completed
date: 2026-04-25
origin: docs/plans/2026-04-25-007-feat-agent-builder-skill-authoring-plan.md
---

# fix(admin): add delete parity to agent workspace tree

## Overview

Bring the agent workspace editor's delete affordances up to parity with the agent template workspace editors. Operators should be able to delete files from the tree, delete a folder prefix that contains override files, and clean up a local skill folder created by the new `Add -> New Skill` flow without hunting for individual files.

## Problem Frame

The local skill authoring E2E on `Sandbox Test Agent` proved the create path works, but it also exposed a lifecycle gap: the agent workspace route can create `skills/{slug}/SKILL.md` and support files, yet the tree does not expose a visible delete action for files or folders. The only delete action is the selected-file toolbar trash button. Template workspace editors already show per-file delete buttons in the tree, so the difference is implementation drift rather than a product distinction.

## Requirements Trace

- **User request:** "no way to delete a file or folder" on the agent workspace route.
- **Plan 007 follow-up:** local skills created under `skills/{slug}/...` must be cleanly removable from the same authoring surface.
- **Template parity:** mirror the visible tree delete affordance patterns from `apps/admin/src/routes/_authed/_tenant/agent-templates/defaults.tsx` and `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx`.

## Scope Boundaries

- Only modify the agent workspace route and its focused admin tests.
- Do not change the workspace-files API contract.
- Do not add hard-delete semantics for inherited-only files; deleting an inherited file should continue to call the existing override delete endpoint and refresh the composed tree.
- Do not add bulk folder delete to template routes in this slice.
- Do not delete live tenant data during automated tests without explicit action-time confirmation.

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspace.tsx` contains the current agent workspace tree, `handleDelete` for the selected file, and the new local skill creation flow.
- `apps/admin/src/routes/_authed/_tenant/agent-templates/defaults.tsx` exposes per-file delete buttons from `TreeItem` via `onDelete`.
- `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx` has the same tree delete pattern for template workspace files.
- `apps/admin/src/lib/workspace-files-api.ts` already exposes `deleteWorkspaceFile(target, path)`.
- `apps/admin/src/lib/skill-authoring-templates.ts` and `apps/admin/src/lib/__tests__/skill-authoring-templates.test.ts` are the focused test pattern added in Plan 007.

### External Research

Skipped. This is pure UI parity using existing repo patterns and APIs.

## Key Technical Decisions

- **Tree-level delete is a shared callback.** Extend the agent route's `TreeItem` with `onDeleteFile` and `onDeleteFolder` props rather than adding a separate toolbar-only path.
- **Folder delete deletes concrete files under the folder prefix.** The tree is derived from file paths, so a folder has no standalone storage object. Deleting `skills/e2e-local-skill` should delete every listed file whose path starts with `skills/e2e-local-skill/`.
- **Confirm before destructive actions.** Use explicit confirmations that name the file path or folder path and file count. Browser E2E deletion requires action-time confirmation from the user before clicking the destructive control.
- **Refresh and clear selection after delete.** If the deleted file or folder contains the selected file, clear editor state and reload the file list.
- **Helper-test the folder-file selection logic.** Extract tiny pure helpers for `filesForFolderDelete` and `pathIsWithinFolder` so the behavior is testable without a full UI harness.

## Implementation Units

- [x] **U1. Extract deletion helper functions**

**Goal:** Make folder-prefix matching deterministic and testable.

**Files:**
- Modify: `apps/admin/src/lib/skill-authoring-templates.ts` only if helper co-location makes sense, otherwise create `apps/admin/src/lib/workspace-tree-actions.ts`.
- Create or modify: `apps/admin/src/lib/__tests__/workspace-tree-actions.test.ts`.
- Modify: `apps/admin/package.json` only if the current test glob needs to include the new test file automatically.

**Approach:**
- Add `pathIsWithinFolder(path, folderPath)` and `filesForFolderDelete(files, folderPath)`.
- Normalize folder paths so `skills/foo` and `skills/foo/` behave the same.
- Avoid accidental prefix matches such as `skills/foo` matching `skills/foobar/SKILL.md`.

**Test scenarios:**
- `skills/foo/SKILL.md` is inside `skills/foo`.
- `skills/foo/references/guide.md` is inside `skills/foo/`.
- `skills/foobar/SKILL.md` is not inside `skills/foo`.
- Folder delete file list is sorted and contains only matching concrete files.

- [x] **U2. Add file and folder delete actions to the agent workspace tree**

**Goal:** Operators can delete a file or all files under a folder directly from the agent workspace tree.

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspace.tsx`.

**Approach:**
- Add hover-visible delete buttons to file nodes, matching template tree behavior.
- Add hover-visible delete buttons to folder nodes when the folder has at least one concrete file beneath it.
- Implement `handleDeleteFile(path)` using `deleteWorkspaceFile(target, path)`, refresh, clear selection if needed, and toast success/failure.
- Implement `handleDeleteFolder(path)` by computing matching concrete files, confirming with file count, deleting each sequentially, refreshing, clearing selection if selected file was inside the folder, and toasting the result.
- Keep the existing selected-file toolbar delete, but route it through `handleDeleteFile(openFile)` for one behavior path.

**Test scenarios:**
- File tree shows a delete affordance for `SKILL.md` and calls the existing delete API path.
- Folder delete for `skills/e2e-local-skill` deletes `SKILL.md` and `references/guide.md`.
- Deleting a folder clears the editor when the selected file is inside that folder.
- Deleting a non-selected file leaves the current editor selection intact.

## Verification

- `pnpm --filter @thinkwork/admin test`
- `pnpm --filter @thinkwork/admin build`
- Browser E2E on `http://localhost:5174/agents/63f92807-197d-424e-8b00-cbdb943e3717/workspace`: verify file and folder delete controls are visible. If performing the destructive delete of `skills/e2e-local-skill`, obtain action-time confirmation first.

## Risks

| Risk | Mitigation |
| --- | --- |
| Folder delete accidentally catches sibling prefixes | Test exact segment-boundary matching. |
| Deleting inherited files creates confusing reappearance after refresh | Existing API semantics control this; toasts should frame action as deleting/removing the override path. |
| E2E test deletes non-sandbox data | Only test on `Sandbox Test Agent`, and confirm before any destructive browser click. |
