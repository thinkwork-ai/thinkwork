---
title: "feat: Add inline workspace file-tree create and rename"
type: feat
status: active
date: 2026-05-23
origin: docs/brainstorms/2026-05-23-workspace-filetree-cut-paste-drag-requirements.md
---

# feat: Add inline workspace file-tree create and rename

## Overview

Add VS Code-style inline editing to the shared workspace file tree: right-click `Rename` turns the row label into an input, `Enter` or blur commits, and `Escape` cancels. `New File` should also start as an empty inline row in the tree instead of opening a dialog; if the user leaves it empty, no S3 object is created. Folder rename should work the same way as file rename.

This extends the existing `WorkspaceEditor` / `FolderTree` surface that already handles tree rendering, context menus, cut/paste, drag-and-drop, folder creation through `.gitkeep`, and server-backed moves.

## Problem Frame

The workspace tree is trying to feel like a filesystem. It now supports creation, deletion, cut/paste, and drag/drop, but file creation still happens through a modal path prompt and rename is not available from the tree. The desired interaction is familiar editor behavior: the filename itself becomes editable in place. This matters because operators are organizing large agent workspaces and need low-friction create/rename workflows without jumping to dialogs.

The existing server `move` action is close but not sufficient for rename. It preserves the basename and auto-renames on collision, which is good for drag/drop but wrong for typed rename. A rename operation should target the exact new path and fail cleanly on invalid names or collisions.

## Requirements Trace

- R1. File context menus include `Rename`.
- R2. Folder context menus include `Rename`.
- R3. Selecting `Rename` replaces the tree row label with an input seeded with the current basename.
- R4. `Enter` commits the rename; blur also commits; `Escape` cancels without mutation.
- R5. Empty rename input cancels without changing the file/folder.
- R6. Rename validates a basename, not a full path, from the UI. The parent folder remains unchanged.
- R7. Rename collision fails visibly and leaves the row in edit mode so the user can fix it.
- R8. Renaming a currently open file updates `openFile`, editor content state, selected row, and focused-tree path to the new path.
- R9. Renaming a folder rewrites every object under that folder prefix to the new folder prefix and updates any open file inside that folder.
- R10. `New File` from toolbar, root context menu, or folder context menu creates an inline empty file row in the destination folder.
- R11. Empty new-file input on blur or `Escape` does not create an object.
- R12. New-file `Enter` or non-empty blur creates a zero-byte file at the typed basename within the selected parent folder, opens it, and refreshes the file list.
- R13. New folder may keep the existing dialog in this slice unless implementation cost is low; the explicit user request only changes New File plus rename for files/folders.
- R14. Existing `.gitkeep` folder materialization remains the folder creation mechanism.
- R15. The behavior applies through shared `WorkspaceEditor` / `FolderTree` so agent, template, space, user, defaults, and context workspaces stay consistent.

## Scope Boundaries

- Do not add multi-select rename or batch rename.
- Do not make rename a cross-folder move from the UI; inline rename edits only the basename.
- Do not replace drag/drop or cut/paste collision behavior. Those keep the existing Finder-style ` (2)` auto-rename behavior.
- Do not expose or render `.gitkeep` as a renameable file.
- Do not redesign folder creation unless it falls out naturally from the inline editor abstraction.
- Do not support Computer targets for rename; the existing move action already rejects Computer targets and the product has been retiring that concept.

## Context And Patterns

- `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx` owns file list state, `openFile`, `editValue`, per-node mutation tracking, `New File` / `New Folder` dialogs, cut/paste, and keyboard shortcuts.
- `apps/admin/src/components/agent-builder/FolderTree.tsx` owns the rendered tree, root/folder/file context menus, synthetic `agents` grouping, and row-level props for mutation/cut states.
- `apps/admin/src/components/ai-elements/file-tree.tsx` owns the primitive `FileTreeFolder` and `FileTreeFile` row markup, icons, drag/drop wiring, selected styling, and name rendering.
- `apps/admin/src/lib/workspace-files-api.ts` wraps `/api/workspaces/files`. It already exposes `moveWorkspaceFile(target, fromPath, toFolder)` for destination-folder moves.
- `packages/api/workspace-files.ts` implements `move` with S3 `CopyObjectCommand` + `DeleteObjectCommand`, folder prefix walking, manifest regeneration, and `deriveAgentSkills` on `AGENTS.md` / `SKILL.md` moves.
- `packages/api/src/__tests__/workspace-files-handler.test.ts` has extensive move coverage for single files, folders, collisions, protected target behavior, manifest regeneration, and derive side effects.
- `docs/solutions/design-patterns/gitkeep-materialization-s3-empty-folders-2026-05-13.md` documents the `.gitkeep` pattern and the tree-side filter.
- `docs/brainstorms/2026-05-23-workspace-filetree-cut-paste-drag-requirements.md` is the closest origin: it established the filesystem-is-the-agent posture and the shared tree substrate.

External research is not needed. The repo already has a strong local file-tree pattern, established dnd/context-menu components, and backend S3 move primitives to extend.

## Key Decisions

- Add a distinct `rename` API action instead of overloading `move`. Rename needs exact destination semantics and should fail on collision; move needs destination-folder semantics and auto-collision resolution.
- Let the UI submit only a basename for inline rename and construct the destination path from the current parent folder. This matches VS Code row rename and avoids accidental cross-folder moves.
- Keep backend rename more general by accepting `fromPath` and `toPath`, then validate both as normalized workspace paths. The client will use same-parent paths, while tests protect the server path behavior.
- For folder rename, copy every object under `fromPath/` to `toPath/`, then delete source objects only after all copies succeed. This should reuse the same atomicity posture as folder move.
- Treat destination collisions as a 409-style user error, not an auto-rename. The user typed the exact target name; silently changing it would be surprising.
- For inline new file, use a transient tree node rather than mutating the `files` array immediately. Empty cancel should leave no filesystem trace.
- Keep mutation state per source path. During new-file creation, use the pending path or parent path for a spinner only if it helps; avoid global loading.

## Implementation Units

### U1. Backend exact rename action

**Goal:** Add `/api/workspaces/files` support for exact file and folder rename.

**Files:**

- Modify: `packages/api/workspace-files.ts`
- Modify: `packages/api/src/__tests__/workspace-files-handler.test.ts`

**Approach:**

- Extend `WRITE_ACTIONS` and `RequestBody` with action `rename`, `fromPath`, and `toPath`.
- Implement `handleRename(deps, fromPath, toPath)` for non-Computer writable targets.
- Normalize and validate both paths with `normalizeWorkspacePath`.
- Reject identical paths.
- Reject `toPath` when its basename is empty, contains slash/backslash traversal, or normalizes outside the workspace.
- Detect folder-vs-file the same way `handleMove` does: list `target.key(cleanFrom) + "/"`.
- For files:
  - Reject when `target.key(cleanTo)` already exists as an object or folder prefix.
  - Copy source object to exact destination key.
  - Delete source object only after copy succeeds.
- For folders:
  - Reject moving into itself or a subfolder of itself.
  - Reject if destination folder/object already exists.
  - Copy every object under the source prefix to destination prefix preserving child relative paths, then delete source objects after successful copy phase.
- Preserve existing policy checks from move: user-context visibility, built-in tool paths, protected orchestration write paths, manifest regeneration for agent targets, and `deriveAgentSkills` when paths touch `AGENTS.md` or `SKILL.md`.
- Return `{ ok: true, destPath, movedCount, detachedPinnedCount }` for shape compatibility with move.

**Test Scenarios:**

- Renames a single file in place: `notes.md` to `ideas.md`.
- Rejects a file rename when `ideas.md` already exists.
- Renames a folder and rewrites all child objects.
- Rejects folder rename into itself or nested child.
- Regenerates manifest and derives skills when renaming `AGENTS.md`, a `SKILL.md`, or a folder containing either.
- Rejects Computer targets.
- Leaves sources undeleted when copy fails mid-folder rename.
- Returns partial-delete metadata if delete phase fails after copy.

### U2. Admin API wrapper and path helpers

**Goal:** Expose exact rename to the admin frontend with small reusable path helpers.

**Files:**

- Modify: `apps/admin/src/lib/workspace-files-api.ts`
- Modify: `apps/admin/src/lib/agent-builder-api.ts`
- Modify: `apps/admin/src/lib/workspace-tree-actions.ts`
- Modify: `apps/admin/src/lib/__tests__/workspace-files-api.test.ts`
- Modify: `apps/admin/src/lib/__tests__/workspace-tree-actions.test.ts`

**Approach:**

- Add `renameWorkspacePath(target, fromPath, toPath): Promise<MoveResult>`.
- Re-export as `agentBuilderApi.renamePath` or `renameFile` alongside existing `moveFile`.
- Add helpers for:
  - `basenameOf(path)`
  - `joinFolderPath(parent, basename)`
  - `replacePathPrefix(path, fromPath, toPath)` for updating an open file inside a renamed folder.
  - `isSafeInlineBasename(value)` or equivalent validation returning an operator-facing error.
- Keep helpers path-only and framework-free so they are easy to test.

**Test Scenarios:**

- Wrapper posts `{ action: "rename", fromPath, toPath }` with the target.
- Empty root parent joins to `basename`; nested parent joins to `folder/basename`.
- Prefix replacement updates `folder/a.md` to `renamed/a.md` and does not change `folderish/a.md`.
- Basename validation rejects empty, slash, backslash, `.` and `..`.

### U3. Inline edit support in tree rows

**Goal:** Let `FolderTree` render a row label as an input for rename and pending new file creation.

**Files:**

- Modify: `apps/admin/src/components/agent-builder/FolderTree.tsx`
- Modify: `apps/admin/src/components/ai-elements/file-tree.tsx`
- Modify: `apps/admin/src/components/agent-builder/__tests__/FolderTree.test.ts`

**Approach:**

- Add an `editingPath` / `editingDraft` model passed from `WorkspaceEditor` to `FolderTree`.
- Add callbacks from `FolderTree` to the parent:
  - `onRename(path, kind)`
  - `onInlineCommit(value)`
  - `onInlineCancel()`
  - `onInlineChange(value)`
- Render an `Input` or native `input` in place of `FileTreeName` for the currently edited row.
- Focus and select input text when edit mode starts.
- Stop propagation from the input so drag/drop, row selection, keyboard shortcuts, and context menu triggers do not consume typing.
- On `Enter`, commit. On `Escape`, cancel. On blur, commit.
- Add `Rename` context menu items for real file/folder nodes; do not show it on synthetic `agents` grouping or missing routed folders.
- Add transient pending new-file nodes under the right parent folder, visually matching a file row with an empty input.

**Test Scenarios:**

- Folder context menu source includes `Rename` for real folders and excludes synthetic/missing folders.
- File context menu source includes `Rename`.
- Inline input source handles Enter, Escape, and blur.
- Pending new-file node is rendered under the requested folder path and not sorted as a persisted file.

### U4. WorkspaceEditor inline rename/create orchestration

**Goal:** Wire row edit state to backend operations and local editor state.

**Files:**

- Modify: `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx`
- Modify: `apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts`

**Approach:**

- Replace `showNewFileDialog` / `newFilePath` flow with inline new-file state:
  - `pendingCreate: { kind: "file"; parentPath: string; draft: string } | null`
  - `editing: { mode: "rename"; path; kind; draft } | { mode: "new-file"; parentPath; draft } | null`
- `openNewFileDialog(parentPath)` becomes `startNewFile(parentPath)`, expands the parent, sets focused tree path, and renders an empty input row.
- Commit new file:
  - Validate basename.
  - If empty, cancel.
  - Construct full path from parent.
  - `putFile(stableTarget, path, "")`
  - Refresh file list, open the new file, clear editing state.
- Start rename:
  - Seed draft with `basenameOf(path)`.
  - For folder rows, ensure the folder stays expanded while editing.
- Commit rename:
  - Validate basename.
  - Empty cancels.
  - Same basename cancels.
  - Construct `toPath` from parent + basename.
  - Call `renamePath`.
  - Refresh file list.
  - If `openFile === fromPath`, update to `destPath`.
  - If `openFile` is inside a renamed folder, rewrite the prefix and preserve content/editValue.
  - Clear clipboard if it references the renamed path or a child path.
  - Keep edit mode active and show toast on validation/collision/server error.
- Preserve `New Folder` dialog for this slice.

**Test Scenarios:**

- Source inspection test confirms `New File` no longer opens the modal/dialog path.
- Source inspection test confirms `FolderTree` receives rename callbacks and pending create state.
- Source inspection test confirms open-file prefix update for folder rename.
- Manual/browser test covers actual inline flow.

### U5. Browser verification

**Goal:** Prove the editor interaction works visually and behaviorally.

**Files:**

- No code files; browser workflow against `apps/admin`.

**Approach:**

- Run the admin dev server with the existing ignored `.env` copied into the worktree.
- Open an agent/space workspace route that renders `WorkspaceEditor`.
- Test:
  - Right-click file -> Rename -> type new basename -> Enter.
  - Right-click folder -> Rename -> type new basename -> blur.
  - New File toolbar -> empty inline input -> blur -> no file created.
  - New File in folder -> type name -> Enter -> file appears and opens.
  - Collision error leaves input active.

**Verification:**

- Browser snapshots/screenshots show inline input in the tree.
- Network-backed rename and creation survive refresh/list refetch.

## Risks And Mitigations

- **S3 has no directories.** Folder rename must operate on objects under a prefix and preserve `.gitkeep` sentinels. Reuse the existing folder-move walk pattern.
- **Inline input can fight row click/drag handlers.** Stop event propagation on the input and keep tests/source checks around keyboard handlers.
- **Collision semantics differ from move.** Keep `rename` separate from `move` and cover both in tests.
- **Open editor state can point at stale paths.** Explicitly update exact open file and prefix-contained open file after rename.
- **Synthetic `agents` grouping is not storage.** Do not offer rename on synthetic or missing nodes; rename the real routed folder child instead.

## Verification Summary

- Backend unit tests: `pnpm --filter @thinkwork/api exec vitest run src/__tests__/workspace-files-handler.test.ts`
- Admin unit/source tests: `pnpm --filter @thinkwork/admin exec vitest run src/lib/__tests__/workspace-files-api.test.ts src/lib/__tests__/workspace-tree-actions.test.ts src/components/agent-builder/__tests__/FolderTree.test.ts src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts`
- Type checks: `pnpm --filter @thinkwork/api typecheck` and `pnpm --filter @thinkwork/admin typecheck`
- Browser test: `ce-test-browser mode:pipeline` against the affected admin workspace editor route.
