---
title: "feat(agent-builder): author local SKILL.md files in agent workspaces"
type: feat
status: completed
date: 2026-04-25
origin: docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md
---

# feat(agent-builder): author local SKILL.md files in agent workspaces

## Overview

Add an inline local-skill authoring path to the existing admin agent workspace builder. Operators should be able to create a local `skills/{slug}/SKILL.md` file, seed it from the same practical templates as the tenant skill builder, optionally create starter `scripts/` or `references/` files under that local skill folder, and continue editing the generated files in the existing workspace editor.

This is the focused follow-up to the master fat-folder plan's deferred local `SKILL.md` authoring question. It does not attempt the full future agent-builder redesign; it makes the current `agents/$agentId_/workspace` route useful for the local-skill authoring workflow that the fat-folder runtime already recognizes.

## Problem Frame

The repository now treats `SKILL.md` frontmatter as the single source of truth for skill metadata, and the fat-folder master plan reserves `skills/` as the per-agent local skill namespace. The admin app has two partial surfaces:

- `apps/admin/src/routes/_authed/_tenant/capabilities/skills/builder.tsx` can create tenant-wide skills from templates.
- `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspace.tsx` can edit arbitrary workspace files, including paths under `skills/`, but offers only generic "new file" affordances.

That means a tenant operator can technically hand-author `skills/foo/SKILL.md`, but the intended workflow is hidden and error-prone. The agent builder should expose local skill creation as a first-class action while still persisting through the existing workspace-files API.

## Requirements Trace

- **R20/R22 from origin**: local skill authoring belongs inside the folder-native agent builder rather than the retired standalone skill-assignment model.
- **R13 from origin**: common agent creation and editing actions should be available from the web builder; local skill creation is now a common action.
- **Plan 2026-04-24-009**: generated skills must use `SKILL.md` frontmatter only; no `skill.yaml` writes or comments.
- **Reserved-folder decision from origin**: `skills/` is reserved as a local skill namespace, not a delegable sub-agent target.

## Scope Boundaries

- Add local skill creation to the existing agent workspace route only.
- Do not create a new GraphQL mutation or REST endpoint; use `putWorkspaceFile` so auth, tenant resolution, overlay writes, and cache invalidation stay centralized in `packages/api/workspace-files.ts`.
- Do not install or attach platform catalog skills. This creates local workspace files only.
- Do not retire `apps/admin/src/routes/_authed/_tenant/capabilities/skills/builder.tsx`; tenant-wide custom skills still use that surface.
- Do not implement routing-table auto-sync or drag-to-organize. The operator can add the new skill slug to `AGENTS.md` using the existing editor.
- Do not change runtime skill resolution in this slice.

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspace.tsx` owns the current agent workspace editor, file tree, `putWorkspaceFile` calls, and new file/folder dialogs.
- `apps/admin/src/routes/_authed/_tenant/capabilities/skills/builder.tsx` contains the current tenant skill templates and slug derivation behavior. Its templates are useful, but should be extracted or copied carefully so local authoring does not import a route component.
- `apps/admin/src/lib/workspace-files-api.ts` exposes `putWorkspaceFile(target, path, content)` for agent, template, and defaults workspace writes.
- `packages/api/src/lib/skill-md-parser.ts` validates `SKILL.md` frontmatter. The admin route does not need to parse locally in v1, but generated frontmatter should match this schema.
- `packages/api/src/lib/reserved-folder-names.ts` and tests document that `skills/` is reserved for local skills and should not be treated as a sub-agent route.
- `docs/plans/2026-04-24-009-refactor-skill-yaml-to-skill-md-frontmatter-plan.md` is the canonical source for the `SKILL.md`-only shift.

### Institutional Learnings

- `docs/solutions/workflow-issues/workspace-defaults-md-byte-parity-needs-ts-test-2026-04-25.md` reinforces adding a focused UI or unit guard when markdown defaults/templates become user-visible behavior.
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` supports landing this as a narrow live slice through the existing workspace route instead of waiting for the full builder replacement.

### External Research

Skipped. The repo already has strong local patterns for skill frontmatter, workspace file writes, and the admin route structure; no external API or novel library choice is involved.

## Key Technical Decisions

- **Use the workspace-files API, not the tenant skills API.** Local skills live under the agent workspace tree as `skills/{slug}/...`, so `putWorkspaceFile({ agentId }, path, content)` is the correct persistence path. Tenant skill APIs write to `tenants/{tenantSlug}/skills/{slug}/...`, which is a different scope.
- **Create a small shared admin helper for skill templates.** Move the template metadata and rendering helpers out of the tenant skill builder route into a reusable admin module such as `apps/admin/src/lib/skill-authoring-templates.ts`. Both the tenant skill builder and the agent workspace route can then render identical `SKILL.md` content without route-to-route coupling.
- **Generate conservative frontmatter.** Local skill templates should include at least `name`, `description`, `license`, `metadata.author`, `metadata.version`, `execution`, and `mode`. Script templates include a `scripts` block pointing at the generated local script path.
- **Batch file creation sequentially with best-effort rollback avoided.** The workspace API has no multi-file transaction. The UI should create `SKILL.md` first, then optional support files, and surface a toast listing any support-file failures. This matches existing workspace editor expectations and avoids pretending atomicity exists.
- **No local parser dependency in the browser.** Browser-side validation should cover slug and empty content. Server/runtime parser tests already own full `SKILL.md` schema validation.

## Implementation Units

- [ ] **U1. Extract reusable skill authoring templates**

**Goal:** Make the existing tenant skill builder templates reusable without importing a route component.

**Requirements:** Plan 2026-04-24-009 compatibility; R20/R22 authoring consistency.

**Files:**
- Create: `apps/admin/src/lib/skill-authoring-templates.ts`
- Modify: `apps/admin/src/routes/_authed/_tenant/capabilities/skills/builder.tsx`

**Approach:**
- Move template keys, labels, descriptions, icon names, `skillMd` bodies, extra files, category list, slug helper, and render helper into the new lib file.
- Keep icon component mapping in the route if needed to avoid storing React components in plain data.
- Add `execution` and `mode` fields to generated frontmatter where absent.
- Preserve the tenant skill builder's current behavior: template selection, rendered content, support-file creation, and navigation should not change.

**Test scenarios:**
- Tenant skill builder still renders all four templates.
- Generated script template includes a `scripts` frontmatter entry matching `scripts/tool.py`.
- Slug generation remains lowercase alphanumeric plus hyphen.

- [ ] **U2. Add local skill creation dialog to the agent workspace route**

**Goal:** Operators can create a local skill from the agent workspace editor without manually typing file paths.

**Requirements:** R13, R20/R22.

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspace.tsx`

**Approach:**
- Add a "New Skill" action near the existing new file/folder controls.
- Dialog fields: template, name, description, optional category/tags if the shared template renderer supports them, and slug preview.
- On create, write `skills/{slug}/SKILL.md` via `putWorkspaceFile(target, path, content)`.
- For template support files, write `skills/{slug}/{extraPath}` with rendered content.
- Refresh the file list, expand `skills/` and `skills/{slug}`, select `skills/{slug}/SKILL.md`, and load the generated content into the editor.
- Reject empty names and empty slugs before making API calls.

**Test scenarios:**
- Happy path creates `skills/approve-receipt/SKILL.md` and selects it.
- Script template also creates `skills/approve-receipt/scripts/tool.py`.
- Existing local skill slug returns a workspace API error and keeps the dialog open with an error toast.
- Support-file creation failure after `SKILL.md` creation reports which file failed, refreshes the tree, and selects the created `SKILL.md`.
- Canceling the dialog does not mutate workspace files.

- [ ] **U3. Add focused admin tests for local skill authoring helpers**

**Goal:** Protect generated paths and frontmatter shape without over-testing UI internals.

**Requirements:** Quality bar for feature-bearing implementation units.

**Files:**
- Create: `apps/admin/src/lib/__tests__/skill-authoring-templates.test.ts`
- Modify or add route-adjacent tests only if an existing test harness already covers admin routes.

**Approach:**
- Unit-test pure helpers: slug generation, SKILL.md rendering, extra-file rendering, and local workspace path generation.
- If the admin package has no route test harness, do not introduce a new heavy browser-test stack in this slice.

**Test scenarios:**
- `Approve Receipt!` slugifies to `approve-receipt`.
- Knowledge template renders `name`, `description`, `execution: context`, and `mode: tool`.
- Script template renders `execution: script`, a `scripts` entry, and `scripts/tool.py`.
- Path builder rejects path traversal-like slugs by deriving from slug helper only.

## Verification

- `pnpm --filter @thinkwork/admin typecheck`
- `pnpm --filter @thinkwork/admin test -- skill-authoring-templates` if the admin test script supports file filters; otherwise run the package test script.
- Manual browser check through the admin dev server: open an agent workspace, create a local skill, confirm the tree shows `skills/{slug}/SKILL.md`, edit/save the file, and confirm reload preserves content.

## Dependencies And Sequencing

U1 must land before U2 so the workspace route and tenant skill builder use the same generator. U3 can land alongside U1 because the helper is pure. No backend deploy dependency beyond the existing workspace-files Lambda.

## Risks

| Risk | Mitigation |
| --- | --- |
| Operators assume local skills are automatically referenced by `AGENTS.md` | Keep the slice file-authoring only; future U18/U21 routing-table work owns auto-sync. |
| Route grows larger | Extract helpers and keep dialog state localized. The full agent-builder component split remains a later plan unit. |
| Multi-file creation partially succeeds | Surface exact failed support files and select the created `SKILL.md` so the operator can continue. |
| Generated frontmatter drifts from parser expectations | Helper tests pin the fields that `parseSkillMd` expects. |
