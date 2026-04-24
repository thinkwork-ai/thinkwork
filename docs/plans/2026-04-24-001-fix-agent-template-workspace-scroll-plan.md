---
title: "fix: Restore scroll in agent template workspace editor"
type: fix
status: active
date: 2026-04-24
---

# fix: Restore scroll in agent template workspace editor

## Overview

The **Agent Templates → Workspace** editor in the admin SPA cannot scroll — neither the left file list nor the right content pane. Files past the first few are hidden, and file content is cut off mid-line with no way to reach the rest. The visually similar **Capabilities → Skills** editor works correctly. Align the workspace editor's layout with the skill editor's working flex-based pattern so both panes scroll inside their own viewports.

## Problem Frame

Screenshots attached to the request show the template workspace tab displaying `11 files` but only ~8 visible, and `SOUL.md` content cut off around line 9 of the file — with no scrollbar on either pane and no way to reach the hidden content. The skill editor (Capabilities → Skills → *Agent Email Send*) uses a visually similar two-pane layout and scrolls correctly.

**Root cause.** The ancestor `<main>` in `apps/admin/src/routes/_authed/_tenant.tsx:124` is `flex-1 overflow-y-auto min-h-0` — it *is* the page scroll container. The skill editor route cooperates with this by rooting itself in `flex flex-col h-full min-h-0` and using `flex-1 min-h-0` + `overflow-y-auto` on the inner tree and content panes (`apps/admin/src/routes/_authed/_tenant/capabilities/skills/$slug.tsx:446,573,613,704`). Its height naturally resolves to the available main-pane height.

The workspace tab instead wraps its split pane in:

`apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx:1065`
```
grid grid-cols-[250px_1fr] gap-0 h-[calc(100vh-160px)] border rounded-md overflow-hidden
```

Two things break here:

1. `h-[calc(100vh-160px)]` is a magic viewport calculation. The actual chrome above `<main>` (app sidebar header row + breadcrumb bar + page title + `Configuration | Workspace | Skills | MCP Servers` tab strip + `Save Changes / Delete` action row + `<main>`'s own `p-6`) adds up to substantially more than 160px on a normal desktop viewport and even more at higher browser zoom levels or on laptops. The grid ends up taller than the visible main pane.
2. `overflow-hidden` on the grid prevents `<main>`'s own `overflow-y-auto` from acting as a fallback scroll surface. The inner file-list sidebar has `overflow-y-auto` but its scrollbar thumb sits *below* the visible viewport, so the user never sees it. Similarly the right pane hands a `height="100%"` to CodeMirror inside a container whose height extends past what the viewport shows, so CodeMirror's internal scroller is also offscreen.

The fix is to replace the calc-height CSS grid with the flex-based height-inheritance pattern the skill editor already uses successfully on the same page shell.

## Requirements Trace

- R1. The left file tree must scroll within its own pane when the file list exceeds the available height (verified with templates containing 20+ files).
- R2. The right editor content must scroll within its own pane when the file content exceeds the available height (verified with a markdown file of ≥500 lines).
- R3. No whole-page scroll is introduced on the workspace tab; the route stays inside `<main>`'s existing scroll contract.
- R4. Visual layout (header, tabs, pane sizes, toolbar row) remains substantially unchanged — this is a structural fix, not a redesign.
- R5. Behavior holds at standard desktop widths and at 125% / 150% browser zoom, where the original `calc(100vh-160px)` underflow was worst.

## Scope Boundaries

- Do not change the workspace-files backend (S3 overlay, inheritance, sync semantics — that is the separate `docs/brainstorms/2026-04-21-agent-workspace-files-requirements.md` track).
- Do not add markdown preview mode to the workspace editor even though the skill editor has one. Preview parity is a real drift but belongs in follow-up work.
- Do not touch the skill editor's layout, the `AgentContextDialog` embedded editor, or the `apps/mobile` workspace surface.
- Do not introduce a new animation, resize handle, or layout library.

### Deferred to Follow-Up Work

- Extract a shared `<FileTreeEditor>` component used by both the skill editor and the template workspace editor: separate PR. The two routes currently each carry their own `buildTree` (`$slug.tsx:78`, `$tab.tsx:128`) and near-duplicate `TreeItem` / `WsTreeItem` components, which is exactly the drift that allowed this bug to land in one place and not the other. Deferring here because: (a) the template editor also needs delete-file affordance the skill tree lacks, (b) the toolbars differ (workspace has no preview toggle, no per-file dependency badges), and (c) merging surface area mid-bugfix increases regression risk against the skill editor, which is currently working. Schedule once the bug is closed.

## Context & Research

### Relevant code and patterns

- `apps/admin/src/routes/_authed/_tenant.tsx:124` — `<main className="flex-1 overflow-y-auto overflow-x-hidden p-6 min-h-0 min-w-0">`. This is the ancestor scroll container every route child must cooperate with.
- `apps/admin/src/routes/_authed/_tenant/capabilities/skills/$slug.tsx:446` — root `flex flex-col h-full min-h-0`. Header rows use `shrink-0`; split pane uses `flex border rounded-md flex-1 min-h-0`.
- `apps/admin/src/routes/_authed/_tenant/capabilities/skills/$slug.tsx:573–626` — sidebar pattern: `w-56 shrink-0 border-r flex flex-col`, header row (no shrink-0 needed — fixed height via `h-9`), then `flex-1 overflow-y-auto py-1` for the tree.
- `apps/admin/src/routes/_authed/_tenant/capabilities/skills/$slug.tsx:629–714` — editor pane pattern: `flex-1 flex flex-col min-w-0`, toolbar `h-9 … border-b`, content `flex-1 min-h-0 overflow-hidden bg-black [&>div]:h-full` with `CodeMirror height="100%"`.
- `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx:1060–1159` — the broken workspace tab. Surrounding code on the same route (the Configuration/Skills/MCP Servers tabs above) are short tables rendered without a height wrapper and rely entirely on `<main>`'s scroll. Only the Workspace tab uses the grid-with-calc pattern.
- `apps/admin/src/components/skills/SkillFileTree.tsx` — exists but unused by `$slug.tsx`; not a viable drop-in for either route as shipped.

### Institutional learnings

No directly applicable entry in `docs/solutions/`. Closest adjacent signal is the admin-worktree Cognito callback memory (unrelated; calls out that the admin is a Vite/React SPA on ports 5174+). Noting for the execution implementer: if they spin up a worktree on 5175+, the callback URL must already be in the Cognito `ThinkworkAdmin` allowlist to reach a logged-in session.

## Key Technical Decisions

- **Mirror the skill editor layout rather than invent a third pattern.** Two routes rendering a file tree + code editor in the admin should render the same way. The skill editor's pattern already cooperates correctly with `<main>`. Any novel layout here — `overflow: hidden` + `min-height: 0` + container queries, fixed positioning, etc. — would add a fourth thing to maintain.
- **Keep CSS grid out of the split-pane container.** Grid is fine for layouts where the track height is known and children can inherit it, but here the height must be *derived from the parent flex chain*. Flex rows with `flex-1 min-h-0` on the pane container + `w-[250px] shrink-0` on the sidebar column reproduces the visual 250px + 1fr split without the implicit-track height traps that grid introduces when combined with `overflow-hidden`.
- **Do not extract a shared component in this PR.** The two trees are close but not identical (delete affordance, tree item shape, toolbar actions). Refactoring while fixing a scroll bug enlarges the blast radius. Fix first, then revisit extraction in a dedicated PR (see *Deferred to Follow-Up Work*).
- **Do not add a nested scroll container on `<main>`.** `<main>` is already `overflow-y-auto`. Introducing a second full-height scroll surface for the workspace tab would double up scrollbars at certain sizes. The route root uses `h-full min-h-0` to claim the available space but lets `<main>` own the outer scroll contract unchanged.

## Open Questions

### Resolved During Planning

- **Should we fix by tweaking the calc (`h-[calc(100vh-220px)]`) or by replacing the pattern?** Replace the pattern. Any magic calc is fragile against header chrome changes, zoom, and future layout additions to `_tenant.tsx`; the flex pattern is dimension-agnostic.
- **Is the skill editor pattern the correct reference?** Yes — it's the only working two-pane file editor in the admin SPA, lives under the same `<main>` shell, and has been in production long enough to be the de-facto standard.

### Deferred to Implementation

- **Exact Tailwind classes to mirror (`w-56` vs `w-[250px]`, pane border color, badge spacing).** The goal is visual parity with the current workspace tab, not perfect parity with the skill editor — implementer should match the *current* visual (250px sidebar width) while adopting the skill editor's *structural* pattern.
- **Whether `[&>div]:h-full` on the CodeMirror wrapper is still needed after the flex chain resolves.** It is in the skill editor; implementer may keep it verbatim or confirm via DOM inspection that it's redundant. No behavior cost either way.

## Implementation Units

- [ ] U1. **Replace workspace tab layout with flex-based height-inheritance pattern**

**Goal:** Make the template workspace file list and content pane scroll independently inside the available `<main>` height, eliminating the `h-[calc(100vh-160px)]` + `grid` + `overflow-hidden` combination that currently prevents both scrolls.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** None

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx`

**Approach:**
- Starting from the Workspace-tab branch (`$tab.tsx:1060`), restructure the JSX so that:
  - The outermost container of the `tab === "workspace"` branch becomes a flex column that claims the remaining main-pane height (`flex flex-col h-full min-h-0`). If the component's existing root already covers this for all tabs, apply the change at the tab branch wrapper instead.
  - Any sibling rows (template header, tab buttons, action bar) that live outside this branch already render fine — do not touch them. If, after the change, the page-level header row stops sizing correctly, add `shrink-0` to the relevant wrappers rather than reintroducing a fixed height.
  - The split-pane container becomes `flex border rounded-md flex-1 min-h-0` (replacing the `grid grid-cols-[250px_1fr] gap-0 h-[calc(100vh-160px)] overflow-hidden`).
  - The file-tree sidebar becomes `w-[250px] shrink-0 border-r flex flex-col` (preserving the 250px visual width the current design uses).
  - The sidebar header row (`{wsFiles.length} files` + `FilePlus` button) stays at the top of the sidebar flex column, sized by its own content — no `shrink-0` needed because it has no large children, but add it if testing shows it compressing.
  - The inner tree wrapper becomes `flex-1 overflow-y-auto py-1`, matching `$slug.tsx:613`.
  - The editor (right) pane becomes `flex-1 flex flex-col min-w-0 bg-background`.
  - The toolbar row (filename + Save / Discard / Delete buttons) stays above the editor content as-is; it will not shrink because it has no `flex-1`.
  - The CodeMirror wrapper stays `flex-1 min-h-0 overflow-hidden bg-black [&>div]:h-full` with `CodeMirror … height="100%"` — this already matches the skill editor.
- Leave all state, handlers, and dialogs (`wsFiles`, `wsSelectedFile`, `wsContent`, `createNewFile`, `saveFileContent`, `deleteFile`, `WsTreeItem`, the new-file `Dialog`) unchanged. This unit is structural, not behavioral.

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/capabilities/skills/$slug.tsx:446,573,613,629,704` — the entire root-to-content flex chain on the skill editor.
- `apps/admin/src/routes/_authed/_tenant.tsx:124` — the `<main>` contract the fix must cooperate with.

**Test scenarios:**
- *Happy path — tall file list scrolls inside sidebar.* Open a template with a workspace whose file count exceeds the visible sidebar height (the seeded Default has ≥11; create or find one with 20+ if needed by adding files through the existing `+` button). Expected: the file-tree sidebar has its own vertical scrollbar, the `N files` header stays visible while scrolling the list, the right pane does not scroll, and the rest of the page (breadcrumb, tabs, Save Changes) stays fixed.
- *Happy path — long file content scrolls inside editor pane.* Open any ≥500-line file (`IDENTITY.md` on a seeded Default is often long enough; otherwise paste content to grow it). Expected: scrolling inside the right pane scrolls only the CodeMirror content; the sidebar, toolbar row, and page chrome stay fixed.
- *Edge case — short file list + short content.* Open a template with ≤3 files and a very short file. Expected: no scrollbar appears on either pane; no layout collapse; no empty whitespace below the grid.
- *Edge case — `Select a file to edit` empty state.* Deselect / navigate so no file is selected. Expected: the "Select a file to edit" placeholder centers vertically and horizontally in the right pane and does not push layout.
- *Edge case — browser zoom 125% and 150%.* Reproduces the original failure mode where `calc(100vh-160px)` was most wrong. Expected: both panes still scroll correctly; no content vanishes below the viewport.
- *Edge case — narrow viewport (≤1280px width).* Expected: sidebar stays 250px, right pane stays readable, no horizontal overflow on the whole page.
- *Integration — switching tabs preserves state.* Switch from Workspace → Configuration → Workspace. Expected: selected file and any unsaved edits are preserved (these are route-level state, so this is regression coverage for the refactor, not new behavior).
- *Integration — save & delete still work.* Edit `SOUL.md`, click Save; expected: success toast, `wsOriginalContent` updates, Save button disables. Delete a file; expected: file removed from tree, selected file falls back to the next in the list.
- *Regression — skill editor unchanged.* Navigate to Capabilities → Skills → any installed skill. Expected: behavior and appearance identical to before the change (no shared code was touched, but verifying guards against accidental cross-file edits).

**Verification:**
- Both panes scroll under their own viewport in the Workspace tab of a template whose files and content each exceed the visible area.
- No whole-page scroll is triggered by the Workspace tab content.
- Visual diff vs. `main`: structural changes only (class names on a handful of wrapper divs). No new state, handlers, helper components, or imports.
- `pnpm --filter @thinkwork/admin typecheck` passes.
- Manually exercised at default zoom, 125%, and 150%; at default admin dev port 5174 and whichever worktree port the implementer is using.

## System-Wide Impact

- **Interaction graph:** None at the React-state or GraphQL layer. Only the CSS-class composition around the Workspace tab JSX in `$tab.tsx` changes.
- **Error propagation:** Unchanged. The workspace file-load / save / delete paths raise through the same `handleError` surface they do today.
- **State lifecycle risks:** None. No component unmounts or remounts as part of this change.
- **API surface parity:** None. This is a route-local layout fix with no shared-component changes.
- **Integration coverage:** Manual verification covers the cross-tab (Configuration ↔ Workspace) and intra-pane save/delete paths. No automated UI test scaffolding currently exists for these routes.
- **Unchanged invariants:** The skill editor layout, the AgentContextDialog editor, the workspace tab's state model, and the workspace-files GraphQL/S3 contract are all explicitly untouched. The route's header, breadcrumb, tab strip, and `Save Changes / Delete` row remain as-is.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Height chain breaks because a parent further up is not `flex flex-col` / `min-h-0`. | `<main>` is `flex-1 overflow-y-auto min-h-0` and `flex-col` is provided by `SidebarInset`'s default layout — verified in `_tenant.tsx`. If the route component root is not `flex-col` today, the unit applies the change at the Workspace-tab wrapper rather than the route root to avoid reshaping the other three tabs (Configuration, Skills, MCP Servers). |
| The 250px sidebar width shifts visually. | Preserve via `w-[250px]` rather than the skill editor's `w-56` (224px). Visual parity with the current design is requirement R4. |
| CodeMirror `height="100%"` becomes 0 because the flex chain still leaves the container unsized. | Already proven by the skill editor, which uses the exact same CodeMirror wrapper (`flex-1 min-h-0 overflow-hidden bg-black [&>div]:h-full`). If it regresses, first check that `[&>div]:h-full` was preserved. |
| Removing `overflow-hidden` from the split-pane container allows a tiny content overflow to leak into `<main>`'s scroll and produce double scrollbars at some zoom levels. | Mitigate by keeping `overflow-hidden` on the inner CodeMirror wrapper (as the skill editor does) and relying on `min-h-0` to prevent the split-pane container itself from growing. Verify at 125% / 150% zoom in the test scenarios. |
| Drift reappears later when someone copy-pastes a new tab or a new file-tree route. | Flagged as follow-up extraction under *Deferred to Follow-Up Work*. Not a blocker for this PR. |

## Documentation / Operational Notes

- No docs, rollout, monitoring, or support impacts. Pure client-side CSS/layout fix shipped via the standard admin Vercel deploy on merge to `main`.
- No migrations, no environment variables, no feature flags.

## Sources & References

- Related code:
  - `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx:1060` — Workspace tab (broken)
  - `apps/admin/src/routes/_authed/_tenant/capabilities/skills/$slug.tsx:446` — skill editor (reference pattern)
  - `apps/admin/src/routes/_authed/_tenant.tsx:124` — `<main>` scroll ancestor
  - `apps/admin/src/components/skills/SkillFileTree.tsx` — unused simpler tree component, not adopted here
- Related brainstorms: `docs/brainstorms/2026-04-21-agent-workspace-files-requirements.md` *(adjacent, not origin — covers S3 overlay semantics, not UI scroll)*
