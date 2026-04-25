---
title: "feat: Phase E agent builder shell"
type: feat
status: active
date: 2026-04-25
origin: docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md
---

# feat: Phase E agent builder shell

## Overview

Ship the unblocked Phase E slice of Plan 008: replace the old agent workspace split-pane and sub-workspace wizard with a unified agent builder shell, add a structured `AGENTS.md` routing-table editor, add the Phase D-backed bundle import surface, retire the standalone skills-assignment page from the admin UI, and add a small starter/snippet surface for common agent-builder authoring flows.

This plan intentionally does **not** implement drag-to-organize (`U19`) or destructive template swap (`U23`) because those need stronger lock/move semantics from `U13`. Phase D landed while this branch was in flight, so `U20` is included against the shipped `/api/agents/{agentId}/import-bundle` endpoint.

---

## Problem Frame

Plan 008 has made Fat-folder sub-agents real in the backend and runtime: recursive overlay composition, `AGENTS.md` parsing, derived `agent_skills`, and live `delegate_to_workspace` are already shipped. The admin UI still reflects the older model: a root-oriented workspace editor, a separate sub-workspace wizard, and a separate skills page that writes `agent_skills` directly.

Operators need one authoring surface where the folder tree is the agent, inherited/overridden state is visible, `AGENTS.md` routing rows are editable without hand-formatting markdown, and skill assignment happens through the routing table rather than through the retired skills page.

---

## Requirements Trace

- **R1.** Replace the existing agent workspace route with an agent builder shell that renders recursive workspace files, folder nodes, file source/inheritance state, and a markdown editor. (Plan 008 U17, R13.)
- **R2.** Fold the sub-workspace wizard route into the builder by representing sub-agents as folders in the same tree, while preserving `?folder=` deep-link behavior into a folder's `CONTEXT.md`. (Plan 008 U17, R13.)
- **R3.** When viewing `AGENTS.md`, provide a structured routing-table editor for `Task`, `Go to`, `Read`, and `Skills`, and round-trip edits back into valid markdown. (Plan 008 U18, R21.)
- **R4.** Stop exposing the standalone skills-assignment page in navigation; direct skill membership is now derived from `AGENTS.md` through shipped U11. (Plan 008 U21, R20.)
- **R5.** Provide zip and git-ref folder-bundle import from the builder using the Phase D import endpoint. (Plan 008 U20, R10.)
- **R6.** Provide a small snippet/starter surface for common authoring actions. (Plan 008 U22, R26.)

**Origin actors:** A1 (template author), A2 (tenant operator), A3 (paired human), A4 (agent runtime).
**Origin flows:** F1 (template inheritance), F3 (sub-agent delegation).
**Origin acceptance examples:** AE6 (workspace-skills unification), AE8 (starter snippets + organize flow, partially covered here before drag-to-organize).

---

## Scope Boundaries

- No drag rename/move/create flow. `U19` waits for atomic S3 move/rollback and agent-level lock semantics.
- No destructive template swap flow. `U23` waits for `U13` and its backend GraphQL mutations.
- No new backend mutation for routing rows. The builder writes `AGENTS.md` through the existing `/api/workspaces/files` `put` path; U11 derives `agent_skills`.
- No inline local `SKILL.md` authoring. Local-skill authoring remains deferred in the master plan.

### Deferred to Follow-Up Work

- `U19` drag-to-organize with AGENTS.md auto-sync, after lock/move semantics are available.
- `U23` template swap dialog, after `U13` and backend swap/restore mutations land.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspace.tsx` is the current 800-line workspace editor. It already uses `listWorkspaceFiles`, `getWorkspaceFile`, `putWorkspaceFile`, `deleteWorkspaceFile`, `WorkspaceFileBadge`, `AcceptTemplateUpdateDialog`, CodeMirror, and `AgentPinStatus`.
- `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspaces.tsx` is the current sub-workspace wizard. The reusable behavior is folder discovery from `*/CONTEXT.md`, create-folder content defaults, and deep-linking back to `/workspace?folder=slug`.
- `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.skills.tsx` is the legacy direct skill assignment UI. After U11, the route should no longer be linked or considered canonical.
- `apps/admin/src/lib/workspace-files-api.ts` is the REST client for composed workspace files. It already returns `WorkspaceFileMeta { path, source, sha256, overridden }`.
- `apps/admin/src/components/WorkspaceFileBadge.tsx` and `apps/admin/src/components/AcceptTemplateUpdateDialog.tsx` are the existing inheritance/update UI pieces to preserve.
- `packages/api/src/lib/agents-md-parser.ts` parses routing rows server-side. The admin needs a small client-side mirror/helper for structured editing unless an existing shared package appears during implementation.
- `packages/workspace-defaults/files/AGENTS.md` is the canonical routing-table shape and should be used as the format fixture.

### Institutional Learnings

- `docs/solutions/patterns/retire-thinkwork-admin-skill-2026-04-24.md` — follow the existing retirement pattern for removing the old skills page from operator navigation.
- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` — all writes continue through the U31-hardened workspace-files REST handler; do not add a bypassing client write path.
- Plan 008 U9 lesson: when touching `packages/workspace-defaults/files/*.md`, keep `packages/workspace-defaults/src/index.ts` byte parity in sync. This slice should avoid editing those files unless needed.

### External References

None. The work is internal admin UI refactoring around existing Vite/React/TanStack Router/shadcn patterns.

---

## Key Technical Decisions

- **Extract components before expanding behavior.** Move tree/editor/inheritance logic into `apps/admin/src/components/agent-builder/` and keep the route thin. This keeps later U19/U20/U23 additions from growing another monolithic route.
- **Use the existing workspace-files REST API as the only write path.** It already handles Cognito auth, admin/owner write gating, composer invalidation, and U11 `AGENTS.md` recompute.
- **Mirror only the routing-table editing shape in the client.** The canonical parser stays server-side, but the UI needs a lightweight parse/serialize helper to support form editing. Keep it scoped to markdown tables under `## Routing`, with tests against the shipped default `AGENTS.md` shape.
- **Make skills editable as free-form slugs in this slice.** A catalog-backed multiselect can follow once the builder has a stable data source for local + platform skills. Free-form chip input preserves correctness because U11/runtime resolver handle invalid slugs explicitly.
- **Retire navigation before deleting backend support.** Remove the skills route/link from the admin surface, but leave the GraphQL mutation live and deprecated as U11 already arranged.

---

## Open Questions

### Resolved During Planning

- **Q: Is Phase D a blocker for Phase E?** No. It only blocked `U20` import UI. Phase D has now landed, so this slice includes the import UI.
- **Q: Should this slice include drag-to-organize?** No. Drag move/rename needs atomic copy/delete, conflict handling, and likely U13 locking. It is not part of this unblocked slice.
- **Q: Should the builder replace `/workspace` or add a new route?** Replace `/agents/$agentId/workspace` in place so existing links keep working. The route becomes the builder.

### Deferred to Implementation

- Final component names and exact route split can adapt to local patterns while preserving the public route.
- If an existing markdown-table helper is already available in admin dependencies, use it. Otherwise add a tiny tested helper under `apps/admin/src/components/agent-builder/`.
- Decide during implementation whether to physically delete `$agentId_.workspaces.tsx` and `$agentId_.skills.tsx` immediately or leave redirect stubs if route-tree generation makes deletion noisy.

---

## Output Structure

```text
apps/admin/src/components/agent-builder/
├── AgentBuilderShell.tsx
├── FileEditorPane.tsx
├── FolderTree.tsx
├── InheritanceIndicator.tsx
├── ImportDropzone.tsx
├── ImportErrorDialog.tsx
├── ImportRootReservedDialog.tsx
├── RoutingTableEditor.tsx
├── SnippetLibrary.tsx
├── routing-table.ts
└── __tests__/
    ├── FolderTree.test.tsx
    ├── RoutingTableEditor.test.tsx
    ├── routing-table.test.ts
    └── snippets.test.ts
```

The per-unit file lists are authoritative if implementation reveals a better split.

---

## Implementation Units

- U1. **Agent builder shell and extracted file tree**

**Goal:** Replace the workspace route body with a reusable builder shell made from extracted components, preserving current list/open/edit/save/delete/bootstrap behavior and recursive folder rendering.

**Requirements:** R1, R2.

**Dependencies:** Shipped Plan 008 U5, U11, U31.

**Files:**

- Create: `apps/admin/src/components/agent-builder/AgentBuilderShell.tsx`
- Create: `apps/admin/src/components/agent-builder/FolderTree.tsx`
- Create: `apps/admin/src/components/agent-builder/FileEditorPane.tsx`
- Create: `apps/admin/src/components/agent-builder/InheritanceIndicator.tsx`
- Create: `apps/admin/src/lib/agent-builder-api.ts`
- Modify: `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspace.tsx`
- Test: `apps/admin/src/components/agent-builder/__tests__/FolderTree.test.tsx`

**Approach:**

- Extract the existing route-local tree builder and tree item into `FolderTree`.
- Keep CodeMirror editing in `FileEditorPane`, preserving markdown language, vscode theme, save/delete affordances, and `?folder=` auto-open behavior.
- Wrap `WorkspaceFileBadge` with `InheritanceIndicator` so later U25 can add path-qualified pin status without changing the shell's layout.
- Add `agent-builder-api.ts` as a thin wrapper over `workspace-files-api.ts`; do not create a new backend path.
- Keep visual density close to the existing admin app: restrained panels, no marketing-style hero, no decorative cards.

**Patterns to follow:**

- `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspace.tsx`
- `apps/admin/src/lib/workspace-files-api.ts`
- `apps/admin/src/components/WorkspaceFileBadge.tsx`

**Test scenarios:**

- Happy path: given file paths `AGENTS.md`, `expenses/CONTEXT.md`, and `expenses/escalation/GUARDRAILS.md`, `FolderTree` renders nested folders before files.
- Happy path: selecting a file calls `onSelect` with the full path.
- Edge case: folder with no visible children renders an empty state without resizing the full layout.
- Edge case: inherited, overridden, pinned, and update-available source states render distinct badge text or accessible labels.
- Integration: route still opens `folder=expenses` by selecting `expenses/CONTEXT.md` when present.

**Verification:**

- The `/agents/$agentId/workspace` route loads, lists recursive files, opens files, saves edits, deletes overrides, and refreshes pin status.
- Existing workspace editor behavior remains available from the new shell.

---

- U2. **Structured `AGENTS.md` routing editor**

**Goal:** Add a form-based editor for the `## Routing` markdown table in `AGENTS.md`, while preserving raw markdown editing and round-tripping back to valid table syntax.

**Requirements:** R3.

**Dependencies:** U1.

**Files:**

- Create: `apps/admin/src/components/agent-builder/RoutingTableEditor.tsx`
- Create: `apps/admin/src/components/agent-builder/routing-table.ts`
- Modify: `apps/admin/src/components/agent-builder/FileEditorPane.tsx`
- Test: `apps/admin/src/components/agent-builder/__tests__/RoutingTableEditor.test.tsx`
- Test: `apps/admin/src/components/agent-builder/__tests__/routing-table.test.ts`

**Approach:**

- Parse the table under `## Routing` into rows with `{ task, goTo, read, skills }`.
- Render editable rows above the raw markdown editor when `selectedPath` ends with `AGENTS.md`.
- Keep raw markdown visible and editable; if raw content becomes malformed, show a non-blocking warning and keep the form disabled until the table parses again.
- Serialize form edits by replacing only the routing table block, preserving prose before and after the table.
- Model skills as comma-separated slug chips/free-form text in this slice; catalog-backed selection can follow later.

**Patterns to follow:**

- `packages/api/src/lib/agents-md-parser.ts` for table semantics, adapted lightly for browser use.
- `apps/admin/src/components/skills/PermissionsEditor.tsx` for compact editable row controls.

**Test scenarios:**

- Happy path: parse default `AGENTS.md` routing table and serialize it back with equivalent rows.
- Happy path: add a row via the form; markdown content gains a row and reparses to the same values.
- Edge case: empty Skills cell serializes as an empty cell and parses to an empty list.
- Edge case: malformed raw markdown disables the structured form without discarding unsaved raw edits.
- Error path: missing `Go to` column surfaces an inline warning and leaves raw editing available.

**Verification:**

- Opening root or sub-agent `AGENTS.md` shows the structured routing editor.
- Saving a form edit calls the existing workspace-file `put`, and U11 handles `agent_skills` recompute server-side.

---

- U3. **Fold old workspaces route into builder navigation**

**Goal:** Remove the standalone sub-workspace wizard as a separate authoring surface and route operators to the builder's folder tree instead.

**Requirements:** R2.

**Dependencies:** U1.

**Files:**

- Modify or delete: `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspaces.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/agents/$agentId.tsx`
- Modify: `apps/admin/src/routeTree.gen.ts` if route generation is not automatic in the test workflow.

**Approach:**

- Change "Workspaces" links to point at `/agents/$agentId/workspace`.
- Preserve existing deep-link semantics by using `/agents/$agentId/workspace?folder=<slug>` where a specific sub-agent folder is needed.
- Prefer deleting the old route if TanStack route generation/tests handle it cleanly; otherwise leave a redirect-only stub.

**Patterns to follow:**

- Existing link structure in `apps/admin/src/routes/_authed/_tenant/agents/$agentId.tsx`.

**Test scenarios:**

- Happy path: clicking the agent detail "Workspace" or former "Workspaces" affordance lands on the builder.
- Edge case: visiting `/agents/$agentId/workspaces` redirects or otherwise does not expose the retired wizard.

**Verification:**

- No visible navigation points to the old wizard.
- Route tree/typecheck stays green.

---

- U4. **Retire standalone skills page from admin navigation**

**Goal:** Remove direct skill-assignment UI from the agent admin surface while keeping backend compatibility for transition.

**Requirements:** R4.

**Dependencies:** U2.

**Files:**

- Modify or delete: `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.skills.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/agents/$agentId.tsx`
- Modify: `apps/admin/src/lib/skills-api.ts`
- Test: route or component tests if existing coverage references the skills tab.

**Approach:**

- Remove the Skills tab/link from agent detail navigation.
- Prefer a redirect/empty route if direct URL compatibility is needed; otherwise delete the route and regenerate route tree.
- Keep read-only skill APIs used by capability pages; remove only mutation helpers that are exclusively used by the retired page.
- Do not remove `setAgentSkills` from GraphQL in this slice.

**Patterns to follow:**

- `docs/solutions/patterns/retire-thinkwork-admin-skill-2026-04-24.md`
- Existing capability skills pages under `apps/admin/src/routes/_authed/_tenant/capabilities/skills/`

**Test scenarios:**

- Happy path: agent detail page no longer renders a Skills tab.
- Regression: capability skills pages still compile and can import read-only skill APIs.
- Integration: editing `AGENTS.md` skills through U2 remains the visible path for skill membership.

**Verification:**

- `rg "setAgentSkills|SetAgentSkillsMutation" apps/admin/src` shows no active agent-page caller after route retirement, excluding generated GraphQL artifacts if still present.

---

- U5. **Starter snippets and starter templates surface**

**Goal:** Add a small local library of starter snippets/templates inside the builder without changing backend defaults or requiring Phase D import.

**Requirements:** R5.

**Dependencies:** U1, U2.

**Files:**

- Create: `apps/admin/src/components/agent-builder/SnippetLibrary.tsx`
- Create: `apps/admin/src/components/agent-builder/StarterTemplates.tsx`
- Create: `apps/admin/src/components/agent-builder/snippets.ts`
- Modify: `apps/admin/src/components/agent-builder/FileEditorPane.tsx`
- Test: `apps/admin/src/components/agent-builder/__tests__/snippets.test.ts`

**Approach:**

- Keep the v1 catalog small and client-local: routing row, guardrails section, identity block, context section, and a two-specialist starter `AGENTS.md` fragment.
- Snippets insert into the current editor content at the cursor when available, or append to the file content otherwise.
- Starter templates in this slice are content insertions/seeding helpers inside the current builder, not destructive whole-agent replacement. Destructive starter application waits for U19/U23 lock semantics.

**Patterns to follow:**

- Existing simple content defaults in `$agentId_.workspace.tsx` and `$agentId_.workspaces.tsx`.

**Test scenarios:**

- Happy path: selecting a routing-row snippet inserts a valid table row that U2 can parse.
- Happy path: selecting a guardrails snippet appends a markdown section to `GUARDRAILS.md`.
- Edge case: applying a starter template with existing content asks for confirmation before replacing the current editor buffer.

**Verification:**

- Snippet library opens from the file editor and inserts usable markdown without layout shift.
- Starter templates do not write multiple files or delete existing data in this slice.

---

- U6. **Import dropzone UI**

**Goal:** Add the U20 zip + git-ref import entry point inside the builder now that Phase D has landed.

**Requirements:** R5.

**Dependencies:** U1, Phase D U15.

**Files:**

- Create: `apps/admin/src/components/agent-builder/ImportDropzone.tsx`
- Create: `apps/admin/src/components/agent-builder/ImportErrorDialog.tsx`
- Create: `apps/admin/src/components/agent-builder/ImportRootReservedDialog.tsx`
- Modify: `apps/admin/src/lib/agent-builder-api.ts`
- Modify: `apps/admin/src/components/agent-builder/AgentBuilderShell.tsx`
- Test: `apps/admin/src/components/agent-builder/__tests__/import-bundle.test.ts`

**Approach:**

- Add a compact import panel to the builder sidebar so imports sit next to the folder tree they update.
- Accept `.zip` files through drag/drop or browse and POST base64 body to `/api/agents/{agentId}/import-bundle`.
- Support git repository URL with optional ref and PAT. PAT stays in component state only and is sent once to the import endpoint.
- Map structured backend errors to operator-facing copy; protected root-file errors use an explicit confirmation dialog and retry with `allowRootOverrides`.
- On success, refresh the builder tree so imported sub-agent folders and the generated parent `AGENTS.md` row are visible.

**Verification:**

- Zip and git-ref controls render inside the builder.
- Helper tests cover zip acceptance, git request shaping, SI-4 copy, root-protected copy, and collision copy.

---

## System-Wide Impact

- Admin operators shift from direct `agent_skills` assignment to routing-table-driven skill membership.
- Runtime behavior remains unchanged because U11 already derives `agent_skills` from `AGENTS.md`.
- Existing `/api/workspaces/files` write semantics stay authoritative for admin builder writes.
- Phase D and future Phase E units can plug into the new `agent-builder` component directory instead of editing the route monolith.

---

## Risks & Mitigations

| Risk                                                                     | Mitigation                                                                                                                             |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| UI route refactor accidentally drops existing workspace editing behavior | Extract from the existing route first, then add routing editor/snippets in separate units.                                             |
| Client parser drifts from server parser                                  | Keep helper minimal, test against `packages/workspace-defaults/files/AGENTS.md`, and let server-side U11 remain the enforcement point. |
| Retiring skills page strands operators before routing editor works       | Sequence U4 after U2 and verify AGENTS.md skill edits save successfully.                                                               |
| Route deletion makes TanStack generated types noisy                      | Use redirect stubs if deletion creates churn; regenerate route tree only if the repo workflow expects generated route changes.         |
| Import endpoint contract drifts from the UI assumptions                  | Keep request shaping in `agent-builder-api.ts`, use backend `code/error/details` fields directly, and test the copy/shape helpers.     |

---

## Verification

- `pnpm --filter @thinkwork/admin typecheck`
- Focused component tests for `agent-builder` helpers.
- Browser smoke on admin dev server: open an agent workspace, expand nested folders, edit a file, edit `AGENTS.md` through the structured form, and confirm the old Skills/Workspaces surfaces are no longer primary navigation.
