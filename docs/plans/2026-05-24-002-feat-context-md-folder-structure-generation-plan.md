---
title: "feat: Generate folder structures for nested CONTEXT.md files"
type: feat
status: completed
date: 2026-05-24
related:
  - docs/brainstorms/2026-05-23-editor-driven-agents-md-section-regen-requirements.md
  - docs/plans/2026-05-23-007-feat-editor-driven-agents-md-section-regen-plan.md
---

# feat: Generate folder structures for nested CONTEXT.md files

## Overview

Add a manual `Generate Folder Structure` context-menu action for any agent
workspace file whose basename is `CONTEXT.md`, including nested sub-agent or
specialist folders. The action rewrites only that file's `## Folder Structure`
section from the clicked file's containing folder downward, matching the
provided workspace-blueprint community example: a fenced tree rooted at the
current folder, with `CONTEXT.md` marked as `You are here`.

## Problem Frame

The existing map-refresh work focuses on `AGENTS.md`, which describes the whole
agent workspace and carries broader derived sections such as skills, knowledge
bases, and workflows. Nested `CONTEXT.md` files need a lighter-weight operation:
operators want to refresh the local folder map for the current context area
without rewriting the rest of that context file or changing the whole agent map.

The important behavior is "from the current position down." Right-clicking
`community/CONTEXT.md` should render the `community/` subtree only. Right-clicking
`agents/earnest-falcon-947/CONTEXT.md` should render that nested agent folder
only. The generated section should be deterministic, readable, and safe to run
repeatedly.

## Requirements Trace

- R1: Show `Generate Folder Structure` in the file context menu for any
  `CONTEXT.md` file at any depth in an agent workspace.
- R2: Invoke a server action with the clicked file path, not merely the currently
  open file, so generation targets the exact right-clicked context file.
- R3: Scope the rendered tree to the clicked `CONTEXT.md` file's parent folder.
  A root `CONTEXT.md` renders the full workspace; a nested `CONTEXT.md` renders
  only that nested subtree.
- R4: Replace only the body of the `## Folder Structure` section. Preserve titles,
  prose, routing notes, skill/tool sections, and every unrelated section.
- R5: If `## Folder Structure` is missing, append a canonical section rather than
  replacing the document. If the file is blank, seed a minimal heading from the
  containing folder name before appending the section.
- R6: Render the folder structure as a fenced code block with deterministic
  folder-first sorting, hidden-path filtering, and `.gitkeep` suppression.
- R7: Mark the target `CONTEXT.md` row as `CONTEXT.md ← You are here`. Other
  nested `CONTEXT.md` files may continue to contribute H1-derived annotations,
  but the clicked file's annotation takes precedence.
- R8: After the generated file is written, run the same post-write maintenance as
  normal agent editor writes: refresh derived `AGENTS.md` sections when relevant
  and regenerate the workspace manifest.
- R9: The action is agent-target only in this plan. Hide or no-op the affordance
  for template, defaults, user-context, computer, and space targets until those
  surfaces have their own generation semantics.
- R10: If the clicked file is currently open and dirty, save it first using the
  existing editor save path, then regenerate, then reload the generated content.
  If the save fails, do not run generation.

## Scope Boundaries

- Do not change `AGENTS.md` behavior except for extracting shared helpers where
  that reduces duplicate tree-rendering logic.
- Do not auto-generate folder structures on every save. This is a deliberate
  manual context-menu action.
- Do not rewrite any `CONTEXT.md` sections other than `## Folder Structure`.
- Do not add production mutation scripts or direct S3 repair commands; all writes
  go through the existing authenticated workspace-files API.
- Do not expand this to non-agent target modes in the first implementation unit.

## Context and Patterns

- `packages/api/src/lib/workspace-map-generator.ts` already builds recursive
  tree structures from S3 object paths, filters hidden segments, extracts
  annotations from nested `CONTEXT.md` files, and replaces derived sections in
  `AGENTS.md`.
- `packages/api/workspace-files.ts` is the authenticated editor write surface and
  already owns target resolution, admin authorization, S3 writes, manifest
  regeneration, and workspace-file actions such as `regenerate-map`.
- `apps/admin/src/components/agent-builder/FolderTree.tsx` owns file context menu
  rendering and should expose the new menu item only when the node basename is
  exactly `CONTEXT.md`.
- `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx` owns tree
  mutations, dirty editor state, refreshes, and toasts. The generation handler
  should live here and pass through `FolderTree`.
- `apps/admin/src/lib/workspace-files-api.ts` and
  `apps/admin/src/lib/agent-builder-api.ts` are the client API layers to extend
  with the new workspace-files action.
- `docs/solutions/design-patterns/gitkeep-materialization-s3-empty-folders-2026-05-13.md`
  explains that `.gitkeep` sentinels exist only to materialize empty folders and
  must not leak into user-facing trees.
- `docs/solutions/workflow-issues/agent-builder-smoke-cleanup-needs-manifest-regeneration-2026-04-26.md`
  reinforces that workspace shape writes need manifest regeneration so runtimes
  sync the updated file set.

## Key Technical Decisions

- Use a new server action name such as `generate-folder-structure`, distinct from
  `regenerate-map`, because the target is a single `CONTEXT.md` section rather
  than the whole agent map.
- Reuse or extract the recursive tree builder from `workspace-map-generator.ts`,
  but give the folder-structure renderer explicit scope inputs: `rootPath`,
  `rootLabel`, and `currentContextPath`.
- Keep the section replacement line-oriented rather than introducing a Markdown
  AST. The existing generated-section contract is simple, and line scanning
  preserves untouched content with less formatter churn.
- Normalize and validate the requested path server-side with the existing
  workspace path validator, then require the basename to be exactly `CONTEXT.md`.
- Build annotations from available nested `CONTEXT.md` content in the scoped
  subtree, while overriding the clicked file with `You are here`.
- Return a simple `{ ok: true }` API response and let the client reload file
  content through the existing `getFile` path. This keeps the API shape aligned
  with the existing workspace-files actions.

## Implementation Units

### U1. Backend Generator and Workspace-Files Action

**Goal:** Add a tested, agent-only server path that rewrites only the scoped
`## Folder Structure` section of a selected `CONTEXT.md`.

**Files:**

- Modify: `packages/api/src/lib/workspace-map-generator.ts`
- Modify or add: `packages/api/src/lib/__tests__/workspace-map-generator.test.ts`
- Modify: `packages/api/workspace-files.ts`
- Modify: `packages/api/src/__tests__/workspace-files-handler.test.ts`

**Tests:**

- Replacing an existing nested `## Folder Structure` section preserves all other
  `CONTEXT.md` content.
- A nested path such as `community/CONTEXT.md` renders only the `community/`
  subtree and uses `community/` as the root label.
- Root `CONTEXT.md` renders the full agent workspace subtree.
- Missing `## Folder Structure` appends a canonical section without disturbing
  existing sections.
- Blank `CONTEXT.md` receives a minimal heading plus the generated section.
- The clicked file is annotated as `CONTEXT.md ← You are here`; sibling or child
  `CONTEXT.md` annotations remain H1-derived where available.
- Hidden paths, operational files, and `.gitkeep` sentinels do not render.
- Non-`CONTEXT.md` paths, path traversal attempts, and non-agent targets are
  rejected with clear 4xx responses.
- Successful writes regenerate the manifest; manifest failure surfaces as an
  error instead of silently reporting success.
- Successful writes run the existing `AGENTS.md` derived-section refresh path so
  root map annotations stay consistent if the generated `CONTEXT.md` content
  changes from blank or malformed to titled.

### U2. Admin Context Menu and Editor Refresh

**Goal:** Surface `Generate Folder Structure` on all agent-workspace `CONTEXT.md`
file rows and refresh the editor after generation.

**Files:**

- Modify: `apps/admin/src/components/agent-builder/FolderTree.tsx`
- Modify: `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx`
- Modify: `apps/admin/src/lib/workspace-files-api.ts`
- Modify: `apps/admin/src/lib/agent-builder-api.ts`
- Modify: `apps/admin/src/components/agent-builder/__tests__/FolderTree.test.ts`
- Modify: `apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts`
- Modify: `apps/admin/src/lib/__tests__/workspace-files-api.test.ts`

**Tests:**

- The file context menu shows `Generate Folder Structure` for root
  `CONTEXT.md`.
- The file context menu shows `Generate Folder Structure` for nested
  `CONTEXT.md` paths.
- The menu item does not appear for `AGENTS.md`, `SKILL.md`, arbitrary `.md`
  files, folders, or synthetic routing-group nodes.
- Selecting the menu item calls the client API with the clicked path.
- If the clicked file is open and dirty, the editor saves first, then calls the
  generation API, then reloads the generated file content.
- If the generated file is not open, the tree/list refreshes without changing the
  currently open editor pane.
- Errors show a toast and leave the user's current editor state intact.
- The API client sends `action: "generate-folder-structure"` with the existing
  agent target shape and rejects unsupported targets at the client boundary where
  practical.

## Verification Strategy

Run focused tests first:

- `pnpm --filter @thinkwork/api exec vitest run src/lib/__tests__/workspace-map-generator.test.ts src/__tests__/workspace-files-handler.test.ts`
- `pnpm --filter @thinkwork/admin exec vitest run src/components/agent-builder/__tests__/FolderTree.test.ts src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts src/lib/__tests__/workspace-files-api.test.ts`

Then run package-level verification for touched packages:

- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/admin build`

Before PR, run `git diff --check` and the repo's relevant formatting check for
touched files. CI remains the final gate before merge.

## Risks and Mitigations

- Section parsing could replace too much content if a `CONTEXT.md` has unusual
  heading structure. Mitigate with parser tests covering adjacent headings,
  dividers, missing trailing newlines, and repeated generation idempotency.
- A dirty editor save can succeed while generation fails. Mitigate by surfacing
  the generation error clearly and preserving the saved user content rather than
  attempting rollback.
- Extracting shared tree helpers could accidentally change `AGENTS.md` rendering.
  Mitigate by keeping existing `AGENTS.md` tests green and adding scoped tests for
  the new renderer rather than rewriting the renderer wholesale.
- Non-agent target modes may also contain `CONTEXT.md`, but their semantics are
  different. Mitigate by hiding the UI action outside agent workspaces and
  enforcing agent-only behavior server-side.

## Open Questions Resolved by Assumption

- Menu label: use the user's requested `Generate Folder Structure`.
- Target scope: agent workspaces only for this plan.
- Tree root label: use the clicked file's containing folder basename plus `/`;
  for root `CONTEXT.md`, use the agent slug plus `/`.
- Generated format: fenced code block under `## Folder Structure`, matching the
  provided nested `CONTEXT.md` example.
