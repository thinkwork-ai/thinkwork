---
title: "feat(admin): file-type-aware CodeMirror highlighting + AI Elements file tree swap"
status: active
created: 2026-05-13
type: feat
area: apps/admin
scope: workspace-editor
---

# feat(admin): file-type-aware CodeMirror highlighting + AI Elements file tree swap

## Summary

Two related polish improvements to the shared workspace editor used by Computer → Workspace, Agent Templates → workspace, the Agent Builder shell, and the Defaults editor:

1. **Fix syntax highlighting per file type.** Today every file is highlighted as Markdown regardless of extension, so a `.json` file (e.g. `thinkwork-runbook.json`) renders with markdown's heading/emphasis squigglies on top of JSON tokens. Introduce a small `languageForFile()` helper and apply it to every CodeMirror call site that loads workspace files.
2. **Adopt the Vercel AI Elements `file-tree` component.** Replace the hand-rolled `FolderTree.tsx` UI shell with the composable AI Elements primitive while preserving every existing domain feature (synthetic `agents/` grouping, inheritance Review badges, skills context menu, confirm-delete UX, missing-folder annotations). Aligns the admin tree with the AI Elements vocabulary already adopted in `apps/computer`.

The screenshot that triggered this plan shows `apps/admin/src/components/agent-builder/FileEditorPane.tsx:167-170` highlighting a `.json` file with the Markdown grammar. The same single-language hardcode appears at `apps/admin/src/routes/_authed/_tenant/capabilities/skills/$slug.tsx:722-724` with only partial coverage (`python`/`yaml`/`markdown` fallback — no JSON, JS/TS, etc.).

## Problem Frame

### Bug: wrong language extension per file

`FileEditorPane.tsx` is rendered by the shared `WorkspaceEditor` and is the editor for **four** routes today:

- `apps/admin/src/routes/_authed/_tenant/computers/$computerId.tsx` (Computer → Workspace tab)
- `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx` (Agent Templates → workspace)
- `apps/admin/src/routes/_authed/_tenant/agent-templates/defaults.tsx` (Defaults editor)
- `apps/admin/src/components/agent-builder/AgentBuilderShell.tsx` (Agent Builder shell)

`FileEditorPane.tsx:167-170` hardcodes `markdown({ base: markdownLanguage, codeLanguages: languages })` regardless of file extension. The Markdown grammar happily parses any text — but token classes meant for headings/emphasis/code-fences render as colorful squigglies on non-markdown content.

The standalone Skill editor at `apps/admin/src/routes/_authed/_tenant/capabilities/skills/$slug.tsx:722-724` has the same shape with partial coverage:

```text
isPython ? python() : isYaml ? yaml() : markdownLang(...)
```

— no branch for JSON, JS/TS, HTML, CSS, or anything else.

The fix is a single shared helper that maps file extension → CodeMirror language extension, applied at both call sites.

### File-tree swap: align with AI Elements

`apps/admin/src/components/agent-builder/FolderTree.tsx` is a hand-rolled tree (485 lines) with custom indentation math, hover/select styles, and chevron toggles. Meanwhile `apps/computer` has standardized on the Vercel AI Elements component vocabulary (see [project_computer_ai_elements_adoption](../../) memory and the existing `apps/computer/src/components/ai-elements/*` files).

The AI Elements `file-tree` (https://elements.ai-sdk.dev/components/file-tree) is composable — `<FileTree>` / `<FileTreeFolder>` / `<FileTreeFile>` accept arbitrary children including a `<FileTreeActions>` slot that stops click propagation — so we can host the existing per-row UI (inheritance indicators, Review badge, delete-confirm button) inside the new primitive without losing functionality.

This is a UI shell swap, not a data-model change. `buildWorkspaceTree()` and the `TreeNode` shape stay exactly as they are.

## Scope

### In scope

- New helper `apps/admin/src/lib/codemirror-language.ts` mapping file extension → CodeMirror `Extension`, with co-located vitest unit tests.
- Wire helper into `FileEditorPane.tsx` so all four `WorkspaceEditor`-driven routes get correct highlighting in one shot.
- Wire helper into `skills/$slug.tsx` so the standalone Skill editor matches.
- Install AI Elements `file-tree` into `apps/admin/src/components/ai-elements/file-tree.tsx` via the AI Elements installer.
- Refactor `FolderTree.tsx` to render AI Elements primitives while preserving every existing domain feature.
- Preserve markdown-preview mode and `RoutingTableEditor` behavior in `FileEditorPane.tsx` (they short-circuit before CodeMirror renders).

### Out of scope / Deferred to Follow-Up Work

- `apps/admin/src/components/routines/RoutineCodeEditor.tsx` — takes an explicit `language` prop (`python` / `typescript`) so it isn't broken, just inconsistent. Defer; if convergence becomes interesting later, route through the same helper.
- `apps/admin/src/routes/_authed/_tenant/capabilities/skills/builder.tsx:263-280` — only edits `SKILL.md`, so the hardcoded markdown extension is correct. Touch only if the helper makes it cleaner; otherwise leave.
- Adding new CodeMirror language packs (HTML, CSS, SQL, shell, TOML). The five already-installed packs (`lang-markdown`, `lang-json`, `lang-javascript`, `lang-python`, `lang-yaml`) cover the vast majority of workspace files. Unknown extensions fall back to plain text — no false squigglies. Adding more packs is a one-line follow-up when a real file type starts appearing.
- Lazy language loading via `@codemirror/language-data`'s `LanguageDescription.matchFilename()`. The five eager imports together add ~50 KB gzip — acceptable for an internal admin app. Revisit only if the admin bundle gets pressure-tested.
- Migrating any `apps/computer` file-tree usage. `apps/computer` does not currently render a file tree (verified — no `FolderTree` / `FileTree` references).
- Simplifying or dropping current `FolderTree` features as part of the swap. **All** existing UX (synthetic `agents/`, inheritance Review badges, skills context menu, missing-folder annotations, confirm-delete UX) is preserved. If the operator wants to simplify later, that's a separate UX-design pass.

---

## Key Technical Decisions

### Eager static imports for the five installed language packs

Use direct imports of `lang-markdown`, `lang-json`, `lang-javascript`, `lang-python`, `lang-yaml` and a small switch by extension. Reasons:

- All five packs are already in `apps/admin/package.json`.
- A static switch is the simplest mental model and trivially testable.
- Lazy loading via `LanguageDescription.matchFilename()` is async (`Promise<LanguageSupport>`) and requires plumbing a state effect to add the extension after the editor mounts — not worth it for an internal app with five real file types.

### Unknown extensions fall back to plain text, not markdown

Returning an empty extension list (no language) renders content as plain text — no false syntax tokens. This is intentionally different from today's behavior (everything as markdown). For markdown files specifically, the existing markdown-preview toggle in `FileEditorPane.tsx` already gives a "rendered" view; the editor mode should highlight markdown grammar only when the file is actually `.md`.

### Helper lives in `apps/admin/src/lib/codemirror-language.ts`

Mirrors the existing pattern of small admin-local utility modules (e.g. `apps/admin/src/lib/agent-builder-api.ts`). Not in `@thinkwork/ui` because CodeMirror extensions are admin-app-specific and we don't want to pull `@codemirror/*` packages into the shared UI library.

### File-extension → language table

| Extension(s) | CodeMirror language | Source pack |
|---|---|---|
| `.md`, `.markdown` | `markdown({ base: markdownLanguage, codeLanguages: languages })` | `@codemirror/lang-markdown` + `@codemirror/language-data` |
| `.json`, `.jsonc` | `json()` | `@codemirror/lang-json` |
| `.ts`, `.tsx` | `javascript({ jsx: true, typescript: true })` | `@codemirror/lang-javascript` |
| `.js`, `.jsx`, `.mjs`, `.cjs` | `javascript({ jsx: true })` | `@codemirror/lang-javascript` |
| `.py`, `.pyi` | `python()` | `@codemirror/lang-python` |
| `.yaml`, `.yml` | `yaml()` | `@codemirror/lang-yaml` |
| (none of the above, or no extension) | plain text — `[]` | — |

Extension matching is case-insensitive on the trailing segment. Files with no extension (e.g. `Dockerfile`) get plain text — operators rarely edit those in workspaces today.

### Preserve every `FolderTree` domain feature during the AI Elements swap

The current `FolderTree.tsx` carries domain behavior the AI Elements primitive does not have natively:

1. **Synthetic `agents/` grouping** — `buildWorkspaceTree` returns a virtual top-level node `__synthetic__/sub-agents` that groups routed sub-agent folders. Preserved as a `<FileTreeFolder>` rendered without `<FileTreeActions>` (per the memory note: agents/ is UI fabrication, not storage; `project_agents_folder_ui_only_decision`).
2. **Reserved root folders shown when empty** — `memory/`, `skills/` always appear. Preserved by passing the same `TreeNode` array; we render whatever `buildWorkspaceTree` returns.
3. **Inheritance indicators + "Review" button** — `InheritanceIndicator` and the amber "Review" button render inside `<FileTreeActions>` so click propagation is suppressed.
4. **Per-row delete with confirm-on-mouse-leave-cancel** — same logic, rendered inside `<FileTreeActions>`.
5. **Skills-folder context menu** — `onContextMenu` attached at the `<FileTreeFolder>` level (DOM event passthrough); menu still rendered as the fixed positioned popover at `clientX`/`clientY`.
6. **"missing" / "no files" annotation** — rendered next to the name as today.
7. **"Empty folder" placeholder rows** — rendered as a non-interactive `<div>` after the expanded folder's children, same as today.

`buildWorkspaceTree(files, routingRows)` and its full test in `apps/admin/src/components/agent-builder/__tests__/FolderTree.test.ts` stay untouched. Only the rendering layer changes.

### AI Elements file-tree installation surface

The AI Elements installer (`<ElementsInstaller path="file-tree" />` on the docs site) lands the component source in the consumer's repo, shadcn-style. Expected destination: `apps/admin/src/components/ai-elements/file-tree.tsx`. The component depends on whatever Radix / utility primitives the AI Elements project relies on (typically already covered by our shadcn baseline); verify during U4 implementation and add any missing peer deps to `apps/admin/package.json`.

---

## High-Level Technical Design

*Directional guidance for review — not implementation specification.*

### `languageForFile` signature

```text
// apps/admin/src/lib/codemirror-language.ts

export function languageForFile(filePath: string | null): Extension[]
//   returns [] for null / unknown
//   returns [markdown(...)] / [json()] / [javascript(...)] / [python()] / [yaml()] otherwise
```

Consumed at the CodeMirror call sites as:

```text
extensions={[
  ...languageForFile(openFile),
  EditorView.lineWrapping,
]}
```

### `FolderTree` rendering shape after the swap

```text
<FileTree
  expanded={expandedFolders}
  onExpandedChange={setExpandedFolders}
  selectedPath={selectedPath ?? undefined}
  onSelect={onSelect}
>
  {nodes.map(node => renderNode(node))}
</FileTree>

function renderNode(node):
  if node.isFolder:
    <FileTreeFolder path={node.path} name={node.name}
                    onContextMenu={skills-context-menu-handler}>
      {node.children.map(renderNode)}
      {empty-or-placeholder-row}
      {!node.synthetic && <FileTreeActions>{delete-confirm-button}</FileTreeActions>}
    </FileTreeFolder>
  else:
    <FileTreeFile path={node.path} name={node.name} icon={...}>
      <FileTreeActions>
        {inheritance-review-badge}
        {delete-confirm-button}
      </FileTreeActions>
    </FileTreeFile>
```

`buildWorkspaceTree` output is unchanged. Selection / expansion state stays controlled in the parent (`WorkspaceEditor`).

---

## Implementation Units

### U1. `languageForFile()` helper + unit tests

**Goal:** Pure helper module that maps a file path to a CodeMirror `Extension[]`. Land first so U2 and U3 can wire it in without rework.

**Dependencies:** none.

**Files:**
- `apps/admin/src/lib/codemirror-language.ts` (new)
- `apps/admin/src/lib/codemirror-language.test.ts` (new)

**Approach:**
- Export a single `languageForFile(filePath: string | null): Extension[]`.
- Lowercase the trailing extension, switch through the table in Key Technical Decisions.
- Return `[]` for `null`, no extension, or an unrecognized extension.
- For `.md` / `.markdown`, return the markdown extension with `codeLanguages: languages` so fenced code blocks inside markdown still highlight properly.
- For `.ts` / `.tsx`, pass `{ jsx: true, typescript: true }`. For `.js` / `.jsx` / `.mjs` / `.cjs`, pass `{ jsx: true }` only.

**Patterns to follow:** existing small utility modules under `apps/admin/src/lib/` (e.g. `agent-builder-api.ts` for module shape; `routing-table.ts` for "pure function + colocated test" style).

**Test scenarios:**
- `.json` returns a non-empty extension array containing the JSON language.
- `.md` returns the markdown extension; `.markdown` matches too.
- `.ts` and `.tsx` both return the JavaScript extension configured for TypeScript + JSX.
- `.js`, `.jsx`, `.mjs`, `.cjs` return the JavaScript extension without `typescript: true`.
- `.py` and `.pyi` return the Python extension.
- `.yaml` and `.yml` return the YAML extension.
- Case-insensitive: `.JSON` matches the same as `.json`.
- `null` returns `[]`.
- Empty string returns `[]`.
- Unknown extension (`.foo`) returns `[]`.
- A file with no extension (`Dockerfile`) returns `[]`.
- A path with directory segments (`skills/crm-dashboard/thinkwork-runbook.json`) is matched by its trailing extension.

Assertions check that the returned arrays have the expected `length` and that the language objects are the imported singletons / configured calls (compare instance reference where possible; otherwise verify the array is non-empty and the path-shape produces it).

**Verification:** `pnpm --filter @thinkwork/admin test codemirror-language` passes; `pnpm --filter @thinkwork/admin typecheck` clean.

---

### U2. Wire `languageForFile` into `FileEditorPane.tsx`

**Goal:** Replace the hardcoded markdown extension at `FileEditorPane.tsx:167-170` so every file in a workspace gets correct highlighting in Computer / Agent Templates / Agent Builder / Defaults workspaces.

**Dependencies:** U1.

**Files:**
- `apps/admin/src/components/agent-builder/FileEditorPane.tsx` (modify)
- `apps/admin/src/components/agent-builder/FileEditorPane.test.tsx` (new — small render-shape test, see scenarios)

**Approach:**
- Replace the inline markdown call inside `extensions={[...]}` with `...languageForFile(openFile)`.
- Remove the now-unused `markdown` / `markdownLanguage` / `languages` imports if nothing else in the file uses them. (Note: the markdown-preview branch at lines 155-160 uses `ReactMarkdown`, not the CodeMirror markdown extension, so those imports become dead.)
- Markdown preview mode (`showMarkdownPreview`) and the `RoutingTableEditor` short-circuit branch already short-circuit before CodeMirror renders — no changes needed there.
- Keep `EditorView.lineWrapping`, theme, `basicSetup`, and styling identical.

**Patterns to follow:** existing extension array shape; the file's existing import-cleanup style.

**Test scenarios:**
- Render with `openFile="thinkwork-runbook.json"` and a JSON-shaped `value` — assert the CodeMirror DOM mounts (smoke) and the JSON language extension is present in the extensions array (assert via spy on `languageForFile` import).
- Render with `openFile="AGENTS.md"` — `RoutingTableEditor` still renders (existing behavior); markdown-preview toggle still works.
- Render with `openFile="schedule.yaml"` — YAML highlighting applies.
- Render with `openFile="recipe.py"` — Python highlighting applies.
- Render with `openFile="random.unknown"` — editor mounts with no language extension (plain text); no console errors.
- Render with `openFile={null}` — "Select a file" placeholder renders, CodeMirror does not mount.

**Verification:**
- `pnpm --filter @thinkwork/admin test FileEditorPane` passes.
- `pnpm --filter @thinkwork/admin dev` on a registered Cognito port (`:5174` / `:5175` / `:5180`): open Computer → Workspace, click `thinkwork-runbook.json` from the screenshot — JSON tokens highlighted, no markdown squigglies. Repeat with `AGENTS.md` (markdown still works in editor mode), `schedule.yaml`, `*.py`.
- Repeat on Agent Templates → workspace and on the Defaults editor to confirm the fix lands on every shared-editor surface.

---

### U3. Wire `languageForFile` into `skills/$slug.tsx`

**Goal:** Replace the partial ternary at `skills/$slug.tsx:722-724` with the shared helper so the standalone Skill editor matches.

**Dependencies:** U1.

**Files:**
- `apps/admin/src/routes/_authed/_tenant/capabilities/skills/$slug.tsx` (modify)

**Approach:**
- Replace `isPython ? python() : isYaml ? yaml() : markdownLang(...)` inside the `extensions={[...]}` array with `...languageForFile(<the file path variable used here>)`.
- Remove `isPython` / `isYaml` / `isMarkdown` flag variables if they are no longer referenced after the swap (the markdown-preview branch may still need `isMarkdown`).
- Drop the now-unused `python` / `yaml` / `markdownLang` / `markdownLanguage` / `languages` imports (confirm with the linter; keep `markdownLanguage` only if the preview path needs it — it doesn't, it uses `ReactMarkdown`).

**Patterns to follow:** same shape as U2.

**Test scenarios:**
- No new unit test required for the route — the helper is already covered in U1 and the route is exercised end-to-end during U2's manual verification pass. If a snapshot or shallow render test for this route exists, update it; otherwise rely on the manual smoke.

**Verification:**
- `pnpm --filter @thinkwork/admin typecheck` clean (no unused-import lint warnings).
- Manual: navigate to a skill at `/capabilities/skills/<slug>`, open a `.json` file in the right pane — JSON highlighting. Open a `.ts` file — TypeScript highlighting. Open `.md` — markdown highlighting (and the preview toggle still works if it exists on this route).

---

### U4. Swap `FolderTree` rendering to AI Elements `file-tree`

**Goal:** Replace the hand-rolled `FolderTree.tsx` UI shell with the AI Elements `file-tree` primitive while preserving every existing domain feature. Aligns admin with the AI Elements vocabulary used in `apps/computer`.

**Dependencies:** none (independent of U1/U2/U3).

**Files:**
- `apps/admin/src/components/ai-elements/file-tree.tsx` (new — landed by the AI Elements installer)
- `apps/admin/src/components/agent-builder/FolderTree.tsx` (modify — rendering refactor)
- `apps/admin/package.json` (modify — add any new peer deps the installer surfaces)
- `apps/admin/src/components/agent-builder/__tests__/FolderTree.test.ts` (verify still passes; tests cover `buildWorkspaceTree`, not the renderer)

**Approach:**

1. **Install the component.** Run the AI Elements installer for `file-tree`, targeting `apps/admin/src/components/ai-elements/file-tree.tsx`. Inspect the landed file: confirm exports (`FileTree`, `FileTreeFolder`, `FileTreeFile`, `FileTreeIcon`, `FileTreeName`, `FileTreeActions`), confirm prop signatures match what the docs page lists (`expanded`, `defaultExpanded`, `selectedPath`, `onSelect`, `onExpandedChange`), and add any peer deps to `apps/admin/package.json` that aren't already present.

2. **Refactor `FolderTree` rendering.** Keep `buildWorkspaceTree`, `TreeNode`, `RESERVED_ROOT_FOLDERS`, `subAgentsNodePath`, `isSkillsFolderPath`, `routedFolderPaths`, `normalizeRoutingPath`, and `sortNodes` exactly as they are. Replace the top-level `<TooltipProvider><div className="py-1">...</div></TooltipProvider>` and the `FolderTreeItem` recursion with:
   - `<FileTree expanded={...} onExpandedChange={...} selectedPath={...} onSelect={...}>` at the root.
   - For each folder node: `<FileTreeFolder path={...} name={...} onContextMenu={...}>` containing children + the empty-folder placeholder + (when not synthetic) `<FileTreeActions>` with the delete/confirm button.
   - For each file node: `<FileTreeFile path={...} name={...} icon={...}>` with `<FileTreeActions>` containing `InheritanceIndicator` + the "Review" button + the delete/confirm button.
   - The skills-folder context-menu popover continues to live at the `FolderTree` root (fixed positioning at `clientX`/`clientY`).
   - The "missing" amber annotation stays as a `<span>` next to the name (or as custom children inside `<FileTreeName>` if that subcomponent supports it).

3. **Selection state and expansion state stay controlled by the parent.** `WorkspaceEditor` already owns `expandedFolders: Set<string>` and `selectedPath: string | null`; `FolderTree` forwards them to the AI Elements primitive. The existing `onSelect` / `onToggle` callbacks bridge to `onSelect` and `onExpandedChange`.

4. **Visual parity check.** AI Elements applies its own indent / chevron / row styles. Verify side-by-side with the current tree in dev:
   - Same nesting depth visible at a glance.
   - Selected row still visually distinct (border or background); add an override className via `className` prop on `<FileTreeFile>` / `<FileTreeFolder>` if needed to retain the sky-500 selected border.
   - Hover affordances still discover (Review / Delete buttons appear on hover; sticky when row is selected or confirm-delete is pending).
   - Synthetic `agents/` row visually grouped at the top with no delete button.
   - "Empty folder" and "Route specialist folders from AGENTS.md" placeholder text still render inside expanded empty folders.

5. **Keep the existing `FolderTree.test.ts` green.** That test covers `buildWorkspaceTree`'s data shape, not the renderer, so behavior should be preserved. Run it and `WorkspaceEditor.target.test.ts` to confirm.

**Patterns to follow:**
- `apps/computer/src/components/ai-elements/*.tsx` for AI Elements file conventions (where the installer drops files; how existing components are wired into product UI).
- Existing `FolderTree.tsx` for every domain-feature rendering detail to be preserved.

**Test scenarios:**

For this unit, behavior coverage is split between the unchanged `buildWorkspaceTree` test and a new `FolderTree.render.test.tsx` covering rendering invariants:

- Renders one row per file plus one row per folder from a representative `TreeNode[]` (e.g. nested `skills/crm-dashboard/SKILL.md`).
- Synthetic `agents/` node renders without a delete button (no `<FileTreeActions>` containing the trash icon).
- Inherited file with `updateAvailableFor(path) === true` renders the "Review" button inside the row's actions area.
- Clicking a file invokes `onSelect` with the file's path.
- Clicking a folder invokes `onToggle` with the folder's path.
- Right-click on a `skills` folder opens the New Skill / Add from catalog popover at the click coordinates.
- Right-click on a non-skills folder does not open the popover.
- A folder with `missing: true` renders the amber "no files" annotation next to the name.
- An expanded folder with `children.length === 0` renders the "Empty folder" placeholder row.
- The synthetic `agents/` folder when empty renders the "Route specialist folders from AGENTS.md" hint row.
- Delete affordance: click trash icon → row enters confirm state → mouse leaves the row → confirm state cancels (existing onMouseLeave behavior preserved).
- `WorkspaceEditor.target.test.ts:76-89` still passes: template route files still go through `WorkspaceEditor` and still don't import CodeMirror or `markdownLanguage` directly.

**Verification:**
- `pnpm --filter @thinkwork/admin test FolderTree` passes (existing data tests + new render tests).
- `pnpm --filter @thinkwork/admin test WorkspaceEditor` passes.
- `pnpm --filter @thinkwork/admin typecheck` clean.
- `pnpm --filter @thinkwork/admin lint` clean.
- Manual on `:5174` (or another registered Cognito port):
  - Computer → Workspace: tree renders with synthetic `agents/` at top, skills/memory reserved roots visible, inheritance Review badges still show on inherited template files, delete confirm still works, right-click on `skills/` still opens New Skill menu.
  - Agent Templates → workspace and Defaults editor: same parity check.
  - Agent Builder shell: same parity check.

---

## System-Wide Impact

- **All four `WorkspaceEditor`-driven routes pick up both fixes automatically** because they share `FileEditorPane.tsx` and `FolderTree.tsx`. No per-route changes required.
- **`apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts:86` invariant remains intact** — template routes still go through `WorkspaceEditor`, still don't import `CodeMirror` / `markdownLanguage` / `vscodeDark` directly. The swap happens inside `FolderTree.tsx`, not at the route level.
- **Bundle size**: U1-U3 add `lang-json` and `lang-javascript` to the runtime path of `FileEditorPane`. Both are already in `package.json` as dev-time installs — they just weren't reaching the bundle. Estimated < 50 KB gzip combined. U4's AI Elements component is small (~3-5 KB depending on landed source).
- **No data model / no GraphQL / no Lambda / no Terraform changes.**

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Mitigation |
|---|---|---|
| AI Elements `file-tree` indent / row styles differ enough to look broken at first glance | Medium | Side-by-side dev check during U4 step 4; apply `className` overrides on `<FileTreeFolder>` / `<FileTreeFile>` to retain the sky-500 selected border and existing row density. Land U4 only when visually on par. |
| `FileTreeActions` doesn't stop propagation reliably and clicking the trash icon also selects the row | Low | Verify in step 4. If the slot's stopPropagation is incomplete, wrap the action button in an extra `onClick={(e) => e.stopPropagation()}` (already the pattern in `FolderTree.tsx:332`). |
| AI Elements installer pulls in peer deps that conflict with existing admin deps | Low | Inspect what the installer adds. Admin already has `@radix-ui/*`, `class-variance-authority`, `clsx`, `lucide-react`, `tailwind-merge` — that covers the typical shadcn-style baseline. |
| `languageForFile` returns the wrong language for an edge-case path (e.g. file named `package.json.bak`) | Low | Test covers case-insensitive trailing-extension matching; `.bak` falls through to plain text, which is correct. |
| `.json` files with comments (e.g. `tsconfig.json`) show "syntax error" markers because `lang-json` is strict | Low | Acceptable — these will simply show CodeMirror's default lint markers, not block editing. If it becomes annoying, swap to `jsonParseLinter`-disabled or treat `.jsonc` separately (the table already separates `.jsonc` from `.json`, so future-proofed). |
| Existing snapshot / shallow-render tests break because the rendered DOM shape changes after the file-tree swap | Medium | Run the full admin test suite after U4. Update snapshots only where the change is the expected refactor; investigate any behavior-level failures. |

---

## Verification

Full plan complete when:

- `pnpm --filter @thinkwork/admin lint && pnpm --filter @thinkwork/admin typecheck && pnpm --filter @thinkwork/admin test` all green.
- On `:5174`, the `thinkwork-runbook.json` file from the screenshot renders with JSON syntax highlighting and no markdown squigglies.
- Markdown files (`AGENTS.md`, `SKILL.md`, `references/*.md`) still highlight as markdown in editor mode and the preview toggle still flips to rendered output.
- `.py`, `.yaml`, `.ts`, `.tsx` files all highlight under their respective grammars.
- The file tree on Computer → Workspace, Agent Templates → workspace, Defaults, and the Agent Builder shell renders the synthetic `agents/` row, reserved `memory/` and `skills/` roots, inheritance Review badges, delete-confirm UX, and skills-folder context menu — all unchanged from today's behavior.
- `apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts` still passes without modification.
