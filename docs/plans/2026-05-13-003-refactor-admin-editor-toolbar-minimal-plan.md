---
title: "refactor(admin): minimal workspace editor toolbar + shadcn folder context menu"
status: active
created: 2026-05-13
type: refactor
area: apps/admin
scope: workspace-editor
---

# refactor(admin): minimal workspace editor toolbar + shadcn folder context menu

## Summary

Two coordinated changes to the shared workspace editor used by Computer → Workspace, Agent Templates → workspace, the Defaults editor, and the Agent Builder shell:

1. **Trim the toolbar dropdown to two items: `New File` and `New Folder`.** Remove `New Skill`, `Add catalog skill`, the four hardcoded folder buttons (`Add docs/ folder`, `Add procedures/ folder`, `Add templates/ folder`, `Add memory/ folder`), `Import bundle`, `Bootstrap defaults`, `Add sub-agent`, and the `Snippets` submenu. All four `WorkspaceEditorMode` values share the same flat two-item toolbar.
2. **Add a shadcn `ContextMenu` to each folder row in `FolderTree`.** Right-click on a folder shows `New File` and `New Folder`, both pre-filling the right-clicked folder as the parent path. The existing custom popover on `skills/` folders (`New Skill` / `Add from catalog` / `Delete`) is replaced by this generic primitive.

This is the natural continuation of PRs #1193, #1199, and #1203 — the editor pane has already been stripped to a plain CodeMirror with Save/Discard/Delete. The toolbar is the last over-engineered surface left.

## Problem Frame

The workspace toolbar dropdown menu accumulated nine product-specific affordances over time — most either duplicate existing flows that live elsewhere in the admin (`/capabilities/skills` for skill installs, AGENTS.md routing rows for sub-agents) or hardcode opinionated folder names (`docs/`, `procedures/`, `templates/`, `memory/`) that don't generalize. The Snippets submenu offered text inserts that users can paste directly into the editor.

Users want a plain file/folder editor — `New File`, `New Folder`, type whatever you want.

The custom skills-folder popover in `FolderTree.tsx` is the only right-click affordance today, and it's tightly coupled to a single domain action. The standard solution is a shadcn `ContextMenu` wrapping every folder row.

## Scope

### In scope

- Slim `WorkspaceEditorAction` to `"new-file" | "new-folder"`.
- Slim `WorkspaceEditorCapabilities` to the flags that still drive editor behavior (`canReviewTemplateUpdates` for the inheritance Review badge in the tree). Drop `canImportBundle`, `canAddSubAgent`, `canCreateLocalSkill`, `canAddCatalogSkill`, `canBootstrapDefaults`.
- Slim `workspaceEditorActions()` to a flat `["new-file", "new-folder"]` for every mode.
- Add `handleCreateFolder` and a small `New Folder` dialog. Creates `<path>/.gitkeep` via `agentBuilderApi.putFile`.
- Extend the `New File` flow to accept an optional `parentFolder` so the context-menu right-click can pre-fill it.
- Drop the `.md` auto-title scaffold in `handleCreateFile`. Files are created empty.
- Vendor shadcn `ContextMenu` at `apps/admin/src/components/ui/context-menu.tsx` using the existing `radix-ui` meta-package import pattern.
- Refactor `FolderTree.tsx`: replace the custom skills-folder popover with `ContextMenu` wrapping each folder row. New props: `onNewFile(parentPath)`, `onNewFolder(parentPath)`. Drop `onCreateSkill`, `onAddSkillFromCatalog`, `preferRunbookSkills`, `isSkillsFolderPath`, the inline popover JSX, the `useEffect` that closes it, the `useState` for menu coordinates.
- Update `AgentBuilderShell.tsx` to drop `AGENT_WORKSPACE_DEFAULT_FILES` import and the `bootstrapFiles` prop pass.
- Rewrite `WorkspaceEditor.target.test.ts` to match the new minimal API surface.
- Delete orphaned files (see Output Structure below).

### Out of scope / Deferred to Follow-Up Work

- Backend endpoints: `installSkill`, `installCatalogSkill`, `importBundle`, `bootstrapDefaults`, `addSubAgent` GraphQL mutations stay. Skills CRUD remains accessible from `/capabilities/skills`. Sub-agents can still be added by editing AGENTS.md routing rows by hand — the synthetic `agents/` tree grouping is data-driven and continues to work.
- Right-click on **file** rows. The editor pane's trash button is the file-delete entry point; no per-file context menu added in this pass.
- Right-click on **empty tree space**. The toolbar covers the no-parent case.
- Delete affordance inside the new right-click menu. Folder delete is removed entirely — the only way to remove a folder is to delete every file under it. The editor pane's trash continues to delete the currently-open file.
- The `routing-table.ts` parser, `WorkspaceEditor`'s AGENTS.md parse, and `FolderTree`'s synthetic `agents/` grouping stay (data-driven, still useful).
- New computer/template workspaces will start completely empty (no bootstrap scaffold). This is intentional per the "plain editor" intent — out of scope to also redesign onboarding.

---

## Key Technical Decisions

### `New Folder` creates `<path>/.gitkeep`

S3 (and git) only materializes a folder when it contains a file. A zero-byte `.gitkeep` is the conventional way to represent an intentionally empty folder. Same approach the existing `FOLDER_TEMPLATES` constants used implicitly, just generic instead of opinionated. The folder appears in the tree immediately because `agentBuilderApi.listFiles()` includes the `.gitkeep`, and the tree builder already skips `.gitkeep` entries from the leaf rendering (see `buildWorkspaceTree` in `FolderTree.tsx` — the `if (part === ".gitkeep" && isLast) continue` branch).

### Right-click context menu is folder-only

Files get their delete affordance from the editor pane's trash. Empty tree space gets coverage from the toolbar dropdown. Folder rows are the only surface that benefits from a contextual create-with-parent affordance.

### No `Delete` in the new context menu

The user's instruction was explicit: `New File`, `New Folder`. Folder delete was previously available only inside the custom `skills/` popover; it's not preserved. The trade-off is intentional — folder delete is rare, and "delete the files under it" is a clean fallback.

### Vendor shadcn `ContextMenu` to `apps/admin/src/components/ui/context-menu.tsx`

`radix-ui` meta-package is already a dep (`apps/admin/package.json:radix-ui ^1.4.3`). Other shadcn components in the admin (`dropdown-menu.tsx`, `popover.tsx`) import primitives via `import { X as XPrimitive } from "radix-ui"`. Match that pattern. Avoid the `shadcn add` CLI — last attempt failed because the CLI defaults to `npm install` for peer deps and breaks on pnpm workspace protocol (see [`feedback_pnpm_in_workspace`](../../) memory).

### Drop the `.md` auto-title scaffold

The existing `handleCreateFile` pre-fills `.md` files with `# <basename>\n\n`. The user's stated intent ("users will have to hand code or copy paste text into the files") rules this out. Files are created empty.

### Backend endpoints stay; only UI entry points come out

`installSkill`, `installCatalogSkill`, `importBundle`, `bootstrapDefaults`, `addSubAgent` GraphQL mutations are still wired and tested. Skills CRUD at `/capabilities/skills` remains the canonical entry point for skill installs. AGENTS.md routing rows still drive the synthetic `agents/` grouping in the tree.

### Bootstrap defaults loss is acceptable

Today, computer and template workspaces can be bootstrapped from `AGENT_WORKSPACE_DEFAULT_FILES` (SOUL.md / IDENTITY.md / etc.). Removing this means new workspaces start empty. The user has accepted this consequence — the path forward is hand-typed content, not template-driven scaffolds.

---

## Output Structure

```
apps/admin/src/
├── components/
│   ├── agent-builder/
│   │   ├── WorkspaceEditor.tsx          (heavily trimmed — see U4)
│   │   ├── FolderTree.tsx               (refactored — see U3)
│   │   ├── AgentBuilderShell.tsx        (lightly trimmed — see U5)
│   │   ├── __tests__/
│   │   │   └── WorkspaceEditor.target.test.ts  (rewritten — see U6)
│   │   ├── ImportDropzone.tsx           (deleted — see U6)
│   │   ├── ImportErrorDialog.tsx        (deleted — see U6)
│   │   ├── ImportRootReservedDialog.tsx (deleted — see U6)
│   │   ├── AddSubAgentDialog.tsx        (deleted — see U6)
│   │   ├── snippets.ts                  (deleted — see U6)
│   │   └── __tests__/
│   │       ├── AddSubAgentDialog.test.tsx  (deleted — see U6)
│   │       └── import-bundle.test.ts       (deleted — see U6)
│   └── ui/
│       └── context-menu.tsx             (new — vendored shadcn — see U1)
```

---

## Implementation Units

### U1. Vendor shadcn `ContextMenu`

**Goal:** Add `apps/admin/src/components/ui/context-menu.tsx` so U3 can use it. Independent of all other units.

**Dependencies:** none.

**Files:**
- `apps/admin/src/components/ui/context-menu.tsx` (new)

**Approach:**
- Use the shadcn registry source as the base. Replace `from "@radix-ui/react-context-menu"` with `import { ContextMenu as ContextMenuPrimitive } from "radix-ui"` to match `apps/admin/src/components/ui/dropdown-menu.tsx` and `popover.tsx`.
- Export the primitives the tree refactor needs: `ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`, `ContextMenuItem`, `ContextMenuSeparator`. Re-exporting the rest of the standard surface (`ContextMenuSub`, `ContextMenuSubContent`, `ContextMenuSubTrigger`, `ContextMenuShortcut`, etc.) is fine for parity with the upstream shape but not required by this plan.
- Use `cn(...)` from `@/lib/utils` for class merging, same as the other shadcn components in this folder.

**Patterns to follow:**
- `apps/admin/src/components/ui/dropdown-menu.tsx` — closest existing analogue for the Radix-meta-import pattern.
- `apps/admin/src/components/ui/popover.tsx` — Portal + Content pattern.

**Test scenarios:**
- Test expectation: none — vendoring a stock shadcn primitive. Behavior coverage comes from U3's source-level structural test that asserts FolderTree imports and uses `ContextMenu` / `ContextMenuTrigger` / `ContextMenuContent` / `ContextMenuItem`.

**Verification:**
- `pnpm --filter @thinkwork/admin build` succeeds (Vite picks up the new component cleanly).
- `tsc --noEmit` clean on the new file.

---

### U2. Add `handleCreateFolder` + New Folder dialog to `WorkspaceEditor`

**Goal:** Land the new folder creation flow before gutting the toolbar. The toolbar still renders all its current items; only `New Folder` is added in this unit. New File grows a `parentFolder` parameter.

**Dependencies:** none.

**Files:**
- `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx` (modify)

**Approach:**
- Add `showNewFolderDialog` state, `newFolderPath` state, `creatingFolder` state.
- Add `handleCreateFolder` async function: trims input, validates non-empty, ensures no leading `/` or `..` segments, calls `agentBuilderApi.putFile(stableTarget, "<path>/.gitkeep", "")`. On success, refresh files, close dialog, clear input. On error, surface via `console.error` consistent with `handleCreateFile`.
- Refactor `handleCreateFile`:
  - Drop the `.md` auto-title scaffold; create files with empty content.
  - Accept an optional `parentFolder` string. When present, prepend `<parentFolder>/` to the user's input if the input is a leaf-only name (no `/`); otherwise treat the input as already-rooted.
- Add a `New Folder` button + dialog to the toolbar dropdown menu. Place it just below `New File`. The visible menu still includes every existing item — the toolbar gut happens in U4.
- Add the dialog: input field labeled "Folder path" with placeholder `docs/notes` and a Create button. Same dialog shape and styling as the existing `New File` dialog.

**Patterns to follow:**
- Existing `handleCreateFile` (`WorkspaceEditor.tsx`) for async flow + state shape.
- Existing `showNewFileDialog` UI for the dialog markup.

**Test scenarios:**
- **Happy path:** Calling `handleCreateFolder` with `docs/notes` produces a `putFile` call with key `docs/notes/.gitkeep` and empty content.
- **Edge case:** Trailing slash on input (`docs/notes/`) is normalized to a single trailing slash before `.gitkeep` is appended.
- **Edge case:** Leading slash (`/docs/notes`) is rejected or stripped (decision: strip the leading slash, same as the existing `handleCreateFile` does implicitly).
- **Edge case:** Empty input is rejected without a `putFile` call.
- **Error path:** `putFile` rejection bubbles to `console.error` and leaves the dialog open with the input preserved (UX matches existing `handleCreateFile`).
- **Integration:** `handleCreateFile("notes.md", "docs")` produces a `putFile` call with key `docs/notes.md`.
- **Integration:** `handleCreateFile("docs/notes.md", null)` (no parent) produces a `putFile` call with key `docs/notes.md` unchanged.
- **Integration:** `handleCreateFile("config.json")` no longer pre-fills `# Config\n\n`; the file content is empty string.

If a vitest test for `WorkspaceEditor.tsx` doesn't exist yet, add an inline `handleCreateFolder`-shape unit covered via the existing source-level pattern (no DOM render needed — the project uses module-level source checks in `WorkspaceEditor.target.test.ts`). Otherwise extend the existing target test with assertions that the new strings (`New Folder`, `handleCreateFolder`) are present in the source.

**Verification:**
- `pnpm --filter @thinkwork/admin test` passes.
- Manual: on `localhost:5175` create a folder named `notes` via the new menu item; verify it appears in the tree as an empty folder; verify `.gitkeep` is not visible as a leaf in the rendered tree (existing `buildWorkspaceTree` filters it).

---

### U3. Refactor `FolderTree.tsx` to shadcn `ContextMenu`

**Goal:** Replace the custom `skills/`-folder popover with a generic right-click `ContextMenu` on every folder row. New items: `New File`, `New Folder`. Both call into the parent's create handlers with the right-clicked folder as the parent path.

**Dependencies:** U1.

**Files:**
- `apps/admin/src/components/agent-builder/FolderTree.tsx` (modify)
- `apps/admin/src/components/agent-builder/__tests__/FolderTree.test.ts` (extend if structural assertions warranted, otherwise leave the existing `buildWorkspaceTree` tests alone)

**Approach:**
- Drop from `FolderTreeProps`: `onCreateSkill`, `onAddSkillFromCatalog`, `preferRunbookSkills`.
- Add to `FolderTreeProps`: `onNewFile: (parentPath: string) => void`, `onNewFolder: (parentPath: string) => void`.
- Delete the `skillsMenu` state, the `openSkillsMenu` helper, the `useEffect` that closes it on click/keydown, the inline popover JSX block, and the `isSkillsFolderPath` helper. The unused `Plus`, `Trash2`, and the runbook-skill text literals come out too.
- Wrap each `FileTreeFolder` element in `<ContextMenu><ContextMenuTrigger asChild>...</ContextMenuTrigger><ContextMenuContent>...</ContextMenuContent></ContextMenu>`. `asChild` makes the trigger transparent — the folder row itself receives the right-click.
- The `ContextMenuContent` has two `ContextMenuItem`s: `New File` (calls `onNewFile(node.path)`) and `New Folder` (calls `onNewFolder(node.path)`). For the synthetic `agents/` folder (`node.synthetic === true`), still render the context menu — the synthetic path is `__synthetic__/sub-agents`, which the parent's create handlers should treat as a root-create (no prefix). The cleanest approach is to pass empty string instead: `onNewFile(node.synthetic ? "" : node.path)`.

**Patterns to follow:**
- Existing `FileTreeFolder` usage in `FolderTree.tsx` post-PR-#1193 — folder rows already wrap a `<FileTreeFolder>` from the AI Elements vendored component.
- `apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts` source-level assertion pattern for any new structural checks.

**Test scenarios:**
- **Happy path:** Source assertion — `FolderTree.tsx` imports `ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`, `ContextMenuItem` from `@/components/ui/context-menu`.
- **Happy path:** Source assertion — `FolderTree.tsx` no longer imports or references `onCreateSkill`, `onAddSkillFromCatalog`, `preferRunbookSkills`, `isSkillsFolderPath`, `skillsMenu`, or `openSkillsMenu`.
- **Happy path:** Source assertion — the strings `"New File"` and `"New Folder"` appear as `ContextMenuItem` children.
- **Edge case:** Synthetic `agents/` folder triggers `onNewFile("")` / `onNewFolder("")` (root-create), not `onNewFile("__synthetic__/sub-agents")` — verify via source-level check on the `ContextMenuItem` `onSelect` handlers.
- **Edge case:** `buildWorkspaceTree` is unchanged — existing tests in `FolderTree.test.ts` continue to pass.

**Verification:**
- `pnpm --filter @thinkwork/admin test` passes.
- Manual: on `localhost:5175`, right-click a regular folder → menu shows `New File` and `New Folder`; click each → corresponding dialog opens with the parent pre-filled. Right-click `skills/` folder → same generic menu (no longer special). Right-click synthetic `agents/` group → same menu; created items appear at workspace root.

---

### U4. Gut `WorkspaceEditor.tsx` toolbar dropdown

**Goal:** Slim the toolbar to two items: `New File` and `New Folder`. Remove the bootstrap UI, the skills creation flow, the catalog skill picker, the import bundle dropzone, the snippets submenu, and the add-sub-agent dialog. Wire the FolderTree's `onNewFile` and `onNewFolder` to open the same dialogs as the toolbar buttons.

**Dependencies:** U2 (uses `handleCreateFolder`), U3 (passes `onNewFile`/`onNewFolder` to FolderTree).

**Files:**
- `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx` (modify)

**Approach:**
- Type-level cleanup:
  - Slim `WorkspaceEditorAction` to `"new-file" | "new-folder"`.
  - Slim `WorkspaceEditorCapabilities` to `{ canReviewTemplateUpdates: boolean }`. Drop `canImportBundle`, `canAddSubAgent`, `canCreateLocalSkill`, `canAddCatalogSkill`, `canBootstrapDefaults`.
  - Slim `workspaceEditorCapabilities(mode)` to return only the surviving flag.
  - Slim `workspaceEditorActions(mode)` to `["new-file", "new-folder"]` for every mode.
- Drop the constants: `AGENT_WORKSPACE_DEFAULT_FILES` (exported — see U5 for the consumer), `FOLDER_TEMPLATES`, `DEFAULT_ROUTER`, `DEFAULT_AGENTS`, `DEFAULT_CONTEXT`.
- Drop state and handlers:
  - `showNewSkillDialog`, `newSkillSlug`, `creatingSkill`, `openNewSkillDialog`, `handleCreateSkill`
  - `showCatalogSkillDialog`, `catalogSkillSearch`, `openCatalogSkillDialog`, `handleCatalogSkillSelect`, all skill-catalog filtering helpers
  - `bootstrapping`, `handleBootstrap`, the bootstrap CTA, and the `bootstrapFiles` / `bootstrapLabel` props on `WorkspaceEditorProps`
  - `showImportDialog`, `handleImportComplete`, the `<ImportDropzone>` mount
  - `showAddSubAgentDialog`, `setShowAddSubAgentDialog`, `handleAddSubAgent`, the `<AddSubAgentDialog>` mount
  - `snippetsOpen`, the snippets submenu in the dropdown, the helper that builds snippet items
- Drop imports: `AddSubAgentDialog`, `ImportDropzone`, `snippets.ts` re-exports, `Plus` (if unused), and any lucide icons exclusive to deleted UI.
- Drop the `RoutingRow`-passing prop on FolderTree (it's already in place — keep) — the synthetic `agents/` grouping continues; this unit doesn't touch the routing parse.
- Wire FolderTree's new props:
  - `onNewFile={(parentPath) => { setNewFileParent(parentPath); setShowNewFileDialog(true); }}`
  - `onNewFolder={(parentPath) => { setNewFolderParent(parentPath); setShowNewFolderDialog(true); }}`
- Add the per-dialog `parent` state (`newFileParent: string`, `newFolderParent: string`). Reset on close.
- Adjust the toolbar dropdown JSX to render only two `DropdownMenuItem`s — `New File`, `New Folder`. Drop all conditional rendering blocks tied to capabilities.

**Patterns to follow:**
- Existing `handleCreateFile` for the dialog flow shape.
- Existing `showNewFileDialog` toolbar block — the `New Folder` button mirrors it.
- The post-PR-#1199 minimal `FileEditorPane.tsx` for the "strip everything not load-bearing" pattern.

**Test scenarios:**
- **Happy path:** Source assertion — `WorkspaceEditor.tsx` no longer imports `ImportDropzone`, `AddSubAgentDialog`, or `./snippets`.
- **Happy path:** Source assertion — strings `"New Skill"`, `"Add catalog skill"`, `"Add docs/ folder"`, `"Add procedures/ folder"`, `"Add templates/ folder"`, `"Add memory/ folder"`, `"Import bundle"`, `"Snippets"`, `"Bootstrap defaults"`, `"Add sub-agent"` no longer appear in the source.
- **Happy path:** Source assertion — `workspaceEditorActions("agent")`, `workspaceEditorActions("template")`, `workspaceEditorActions("computer")`, `workspaceEditorActions("defaults")` all return `["new-file", "new-folder"]`.
- **Happy path:** Source assertion — `workspaceEditorCapabilities("computer")` matches `{ canReviewTemplateUpdates: false }` (or whatever the surviving flag's value is for computer mode).
- **Edge case:** `WorkspaceEditorProps.bootstrapFiles` and `bootstrapLabel` are removed from the type.
- **Integration:** Right-clicking a folder fires `onNewFile(parentPath)` / `onNewFolder(parentPath)`; the parent dialog opens with the parent path pre-filled.

**Verification:**
- `pnpm --filter @thinkwork/admin test` passes (the rewritten `WorkspaceEditor.target.test.ts` is covered in U6, but the unit-level structural assertions added here can be inline).
- `tsc --noEmit` clean on `WorkspaceEditor.tsx`.
- Manual: on `localhost:5175`, the toolbar dropdown shows only `New File` and `New Folder` on Computer, Agent Templates, Defaults, and Agent Builder.

---

### U5. Update `AgentBuilderShell.tsx`

**Goal:** Drop the `AGENT_WORKSPACE_DEFAULT_FILES` import and the `bootstrapFiles` prop pass that no longer exist after U4.

**Dependencies:** U4.

**Files:**
- `apps/admin/src/components/agent-builder/AgentBuilderShell.tsx` (modify)

**Approach:**
- Remove the `AGENT_WORKSPACE_DEFAULT_FILES` import.
- Remove the `bootstrapFiles={AGENT_WORKSPACE_DEFAULT_FILES}` prop from the `<WorkspaceEditor>` mount.
- If `bootstrapLabel` was passed, remove it too.
- Verify no other references in this file.

**Test scenarios:**
- Test expectation: none — type-driven cleanup. TypeScript catches incorrect prop shapes during `tsc --noEmit`.

**Verification:**
- `tsc --noEmit` clean on `AgentBuilderShell.tsx`.
- `pnpm --filter @thinkwork/admin build` succeeds.

---

### U6. Delete orphans + rewrite `WorkspaceEditor.target.test.ts`

**Goal:** Remove dead files and update the action-list test to match the new minimal API. After U4 + U5 land, these files have no consumers.

**Dependencies:** U4, U5.

**Files (deletions):**
- `apps/admin/src/components/agent-builder/ImportDropzone.tsx`
- `apps/admin/src/components/agent-builder/ImportErrorDialog.tsx`
- `apps/admin/src/components/agent-builder/ImportRootReservedDialog.tsx`
- `apps/admin/src/components/agent-builder/AddSubAgentDialog.tsx`
- `apps/admin/src/components/agent-builder/__tests__/AddSubAgentDialog.test.tsx`
- `apps/admin/src/components/agent-builder/__tests__/import-bundle.test.ts`
- `apps/admin/src/components/agent-builder/snippets.ts`

**Files (modify):**
- `apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts`

**Approach:**
- Before deletion: `grep -rn` each filename across the repo to confirm zero remaining imports. If any reference survives, it's an indicator U4 missed something — fix in U4 rather than carrying compat shims.
- Rewrite the target test:
  - The four `workspaceEditorCapabilities(mode)` cases collapse to a single assertion shape — only `canReviewTemplateUpdates` survives, and its per-mode value is the only thing being tested.
  - The four `workspaceEditorActions(mode)` cases all return `["new-file", "new-folder"]`. One assertion per mode, or one parameterized test.
  - Keep the existing structural invariant: template route source files (`agent-templates/$templateId.$tab.tsx`, `agent-templates/defaults.tsx`) must still go through `WorkspaceEditor` and must not directly embed `CodeMirror`, `WsTreeItem`, `buildTree`, etc. That assertion stays as-is.
  - Drop the now-obsolete cases that asserted `add-catalog-skill`, `new-skill`, `import-bundle`, `bootstrap`, `add-sub-agent` membership.
  - Drop the `keeps runbook assignment on template workspace skill folders` test entirely — the "New Runbook Skill" / "Add Runbook Skill" strings are removed from `FolderTree.tsx` and from `WorkspaceEditor.tsx` in U3/U4.

**Test scenarios:**
- **Happy path:** All four modes' `workspaceEditorActions(mode)` returns exactly `["new-file", "new-folder"]`.
- **Happy path:** `workspaceEditorCapabilities("agent")`, `workspaceEditorCapabilities("template")`, `workspaceEditorCapabilities("computer")`, `workspaceEditorCapabilities("defaults")` each match the expected `canReviewTemplateUpdates` value (only `agent` mode keeps it `true` — verify against U4's `workspaceEditorCapabilities` implementation).
- **Edge case:** `workspaceEditorTargetKey({ computerId: "computer-marco" })` still returns `"computer:computer-marco"` (existing invariant — keep).
- **Integration:** Template route source files still import `WorkspaceEditor` and still do not import `CodeMirror`, `markdownLanguage`, `vscodeDark`, etc. (existing structural test — keep).

**Verification:**
- `pnpm --filter @thinkwork/admin test` passes.
- `tsc --noEmit` clean across `apps/admin/src`.
- `grep -rn "ImportDropzone\|AddSubAgentDialog\|snippets\|AGENT_WORKSPACE_DEFAULT_FILES\|FOLDER_TEMPLATES\|DEFAULT_ROUTER\|DEFAULT_AGENTS\|DEFAULT_CONTEXT" apps/admin/src` returns zero matches.

---

## System-Wide Impact

- **All four `WorkspaceEditor`-driven routes share the new flat 2-item toolbar** because they share the same component. No per-route changes required.
- **`apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts:76-89` invariant remains intact** — template routes still go through `WorkspaceEditor`, still don't import `CodeMirror` / `markdownLanguage` / `vscodeDark` directly. Only the action-list assertions change.
- **Bundle size**: net deletion (~2,500 lines of orphaned UI plus the constants block in `WorkspaceEditor.tsx`). The vendored shadcn `ContextMenu` is ~100 lines but trivially tree-shakeable to the parts used.
- **No data model / no GraphQL / no Lambda / no Terraform changes.**
- **Backend endpoints unchanged**: `installSkill`, `installCatalogSkill`, `importBundle`, `bootstrapDefaults`, `addSubAgent` GraphQL mutations remain wired and continue to serve `/capabilities/skills` and any direct API consumers.
- **AGENTS.md routing parsing stays** in `routing-table.ts`; the synthetic `agents/` grouping in the tree continues to work for hand-typed routing rows. The sub-agent creation path moves from "dialog → mutation" to "edit AGENTS.md → server derives".
- **New workspaces start empty.** Computer / Template / Defaults onboarding via the editor no longer scaffolds default files. Acceptable per user direction; out of scope to redesign onboarding.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Mitigation |
|---|---|---|
| Removing AddSubAgentDialog without an alternative breaks sub-agent creation UX | Medium | Documented in Scope: sub-agents are added by hand-editing AGENTS.md routing rows. The synthetic `agents/` grouping in the tree still works data-driven. Surface this in the PR description so testers know how to add a sub-agent post-change. |
| `pnpm` doesn't have `radix-ui` ContextMenu — runtime "module not found" | Low | Verified: `radix-ui ^1.4.3` is in `apps/admin/package.json`. `radix-ui` is the meta package and re-exports `ContextMenu`. Other vendored shadcn components (`dropdown-menu.tsx`, `popover.tsx`) use the same import pattern. |
| Shadcn `ContextMenu` default styling clashes with the AI Elements file tree row hover state | Low | `ContextMenuTrigger asChild` is transparent — the underlying row keeps its own hover/select styles. Verify in U3's manual check; if the trigger introduces a wrapping div that breaks layout, switch to a manual `onContextMenu` handler invoking a controlled `<ContextMenu open={...}>`. |
| Right-click on the synthetic `agents/` folder creates files at `__synthetic__/sub-agents/...` instead of root | Medium | Decision in U3 Approach: synthetic folder triggers `onNewFile("")` / `onNewFolder("")` — empty parent path. Verify with manual test. |
| Removing `AGENT_WORKSPACE_DEFAULT_FILES` regresses some onboarding flow not visible in this scope (e.g. a test fixture, a CLI command) | Low | `grep -rn` for `AGENT_WORKSPACE_DEFAULT_FILES` returns only `WorkspaceEditor.tsx` (defines) and `AgentBuilderShell.tsx` (consumes). Both are in scope. |
| User wants Delete back in the right-click menu after seeing the change live | Low | Folder delete was rare; the editor pane's trash handles file delete. If they request it, follow-up PR adds `Delete` as a third `ContextMenuItem`. The shape is ready. |
| New workspaces feel barren post-bootstrap-removal | Medium | User has accepted this trade. If they want it back, follow-up PR re-adds bootstrap as a one-time "Initialize defaults" toolbar action on empty workspaces only — out of scope here. |

---

## Verification

Plan complete when:

- `pnpm --filter @thinkwork/admin lint && pnpm --filter @thinkwork/admin test` green; `tsc --noEmit` clean on every file touched.
- Toolbar dropdown on every `WorkspaceEditor` surface (Computer, Agent Templates, Defaults, Agent Builder) shows exactly two items: `New File`, `New Folder`.
- Right-click on any folder row shows the same two items in a shadcn `ContextMenu`; clicking either opens the corresponding dialog with the folder pre-filled as the parent.
- New File on `.md` files creates an empty file (no `# Title` scaffold).
- New Folder on a user-typed name creates an empty folder rendered as a collapsible tree node; verify the underlying `.gitkeep` is filtered out of the rendered tree.
- The synthetic `agents/` grouping in the tree still appears when AGENTS.md has routing rows; manually hand-typing a routing row in AGENTS.md and saving causes the sub-agent folder to appear under the synthetic node.
- Skills CRUD remains functional from `/capabilities/skills`.
- No leftover orphans: `grep -rn "ImportDropzone\|AddSubAgentDialog\|snippets\|AGENT_WORKSPACE_DEFAULT_FILES" apps/admin/src` is empty.
