---
title: "feat: Polish workspace file-tree inline focus and folder creation"
type: feat
status: active
date: 2026-05-24
origin: user feedback after PR #1615
---

# Plan

## Problem Frame

The workspace file tree now supports inline file creation and rename, but the remaining interaction polish should match standard editor behavior:

- Creating a new file or folder should immediately focus the name input.
- Renaming a file or folder should focus the input and select the whole current basename.
- Folder creation should use the same inline tree interaction model as file creation, not a separate dialog.
- Focused tree items should support `F2` rename as an editor-style keyboard affordance.

This is a focused admin UI improvement. It should not change workspace storage semantics beyond folder creation continuing to create a `.gitkeep` marker.

## Current Patterns To Follow

- `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx` owns workspace file/folder mutations, focused tree path, keyboard shortcuts, and tree edit state.
- `apps/admin/src/components/agent-builder/FolderTree.tsx` owns context-menu actions and inline row rendering.
- `apps/admin/src/components/ai-elements/file-tree.tsx` provides folder/file primitives that already support editable label content.
- `apps/admin/src/lib/workspace-tree-actions.ts` contains small path helpers and inline basename validation.
- Existing source-target tests in `apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts` and `apps/admin/src/components/agent-builder/__tests__/FolderTree.test.ts` assert behavior-bearing wiring for this area.

## Scope

In scope:

- Extend inline edit state to cover `new-folder`.
- Route New Folder actions through an inline pending folder row.
- Commit inline folders by writing `<folder>/.gitkeep`.
- Ensure inline inputs focus on mount and select text for rename while leaving new create inputs empty and focused.
- Add `F2` rename for the currently focused tree item.
- Keep Escape cancel, Enter commit, and blur commit behavior.
- Add focused tests for the new wiring and helper behavior.

Out of scope:

- Changing backend folder semantics away from `.gitkeep`.
- Implementing browser-authenticated end-to-end mutation tests.
- Changing drag/drop, cut/paste, delete, or backend rename behavior.

## Requirements Trace

- R1: New File starts an inline empty input and focuses it.
- R2: New Folder starts an inline empty input and focuses it.
- R3: Empty New File/New Folder blur or Escape creates nothing.
- R4: Committing New Folder writes a `.gitkeep` marker and refreshes the tree.
- R5: Rename starts with the existing basename selected in the input.
- R6: `F2` renames the currently focused real file or folder.

## Implementation Units

### U1: Inline Folder Create State And Rendering

Files:

- Modify `apps/admin/src/components/agent-builder/FolderTree.tsx`
- Modify `apps/admin/src/components/ai-elements/file-tree.tsx` only if the existing folder editing slot needs a small refinement
- Test `apps/admin/src/components/agent-builder/__tests__/FolderTree.test.ts`

Approach:

- Add `new-folder` to `InlineEditState`.
- Render a pending folder row under the requested parent, mirroring the pending file row.
- Ensure pending folder rows do not show the empty-folder placeholder at the same time.
- Keep root pending folder support inside the root tree.
- Reuse `InlineNameInput`, but adjust selection behavior so rename selects all and create modes focus with an empty caret.

Test scenarios:

- FolderTree source includes `new-folder` inline state and pending folder rendering.
- Inline input focus/select behavior distinguishes rename from create modes.
- Pending new folder rows suppress empty folder text.

### U2: WorkspaceEditor Folder Commit And Keyboard Rename

Files:

- Modify `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx`
- Modify `apps/admin/src/lib/workspace-tree-actions.ts`
- Test `apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts`
- Test `apps/admin/src/lib/__tests__/workspace-tree-actions.test.ts`

Approach:

- Replace New Folder dialog entry points with `startNewFolder(parentPath?)` that creates inline edit state.
- Commit `new-folder` by validating basename, checking file/folder collisions, and calling `putFile(stableTarget, `${path}/.gitkeep`, "")`.
- Preserve the existing modal only if another code path still needs it; otherwise remove dead dialog state and JSX.
- Add a focused-tree `F2` shortcut that calls rename for the selected path using folder/file detection.
- Ensure rename selection still uses basename only.

Test scenarios:

- Source-target test confirms New Folder no longer opens the dialog and instead uses `inlineEdit` mode `new-folder`.
- Source-target test confirms folder commits write `.gitkeep`.
- Source-target test confirms `F2` is registered for rename.
- Helper tests cover any new folder create path helper if added.

### U3: Verification And Review

Files:

- Test `apps/admin/src/lib/__tests__/workspace-tree-actions.test.ts`
- Test `apps/admin/src/components/agent-builder/__tests__/FolderTree.test.ts`
- Test `apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts`

Approach:

- Run focused admin tests.
- Run admin production build for TypeScript/bundling coverage.
- Run browser pipeline with `agent-browser`; unauthenticated redirect is acceptable if the profile cannot access protected workspace pages.

Verification:

- `pnpm --filter @thinkwork/admin exec vitest run src/lib/__tests__/workspace-tree-actions.test.ts src/components/agent-builder/__tests__/FolderTree.test.ts src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts`
- `pnpm --filter @thinkwork/admin build`
- `agent-browser` pipeline against the admin dev server.
