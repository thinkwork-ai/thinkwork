---
title: "feat: Regenerate derived AGENTS.md sections from editor writes"
type: feat
status: active
date: 2026-05-23
origin: docs/brainstorms/2026-05-23-editor-driven-agents-md-section-regen-requirements.md
---

# feat: Regenerate derived AGENTS.md sections from editor writes

## Overview

Make the Agent Editor the single lifetime writer for the four derived sections of
an agent workspace `AGENTS.md`: `## Folder Structure`, `## Skills & Tools`,
`## Knowledge Bases`, and `## Workflows`. Editor writes re-render those sections
from S3 and DB state while preserving every other byte of the document. Skill,
knowledge-base, customize-render, folder import, eval provisioning, and post-deploy
map rewrites stop editing `AGENTS.md`; bootstrap and operator-triggered
rematerialization remain the creation/repair carve-outs.

## Problem Frame

`packages/api/src/lib/workspace-map-generator.ts` currently renders an entire
`AGENTS.md` document from a shallow, hard-coded view of the workspace tree. That
document can be rewritten by several non-editor flows, so hand-authored operator
sections are not durable. Meanwhile the editor already owns user-visible file
CRUD and manifest regeneration, but it does not update the map after file changes.

The new model makes `AGENTS.md` partly derived and partly operator-authored. The
derived parts must be precise, idempotent, and section-scoped; the rest of the file
must round-trip unchanged.

## Requirements Trace

- R1-R4: Add a section-scoped helper that replaces only the four named sections,
  detects boundaries by `##` heading to next `---` or `##`, appends missing sections
  in canonical order, and preserves all other bytes.
- R5-R8: Render `## Folder Structure` from a recursive S3 workspace walk, including
  nested folders, reserved folders when present, annotations, and hidden/system file
  filtering.
- R9-R10: Preserve the existing Skills, Knowledge Bases, and Workflows table shapes
  and empty states.
- R11-R13: Run the section-scoped rewrite after successful agent-target
  `put`, `delete`, `move`, and `create-sub-agent` actions; keep `regenerate-map`
  as a manual escape hatch using the same helper.
- R14-R16: Remove or retire non-editor `regenerateWorkspaceMap` callers and the
  bulk post-deploy map regeneration path.
- R17: Add an operator-triggered normalization/repair path that seeds a well-formed
  `AGENTS.md` template plus derived sections for drifted agents.
- R18-R19: Keep bootstrap seeding initial files, and keep rematerialization as the
  explicit operator-controlled exception.

## Scope Boundaries

- Do not change runtime sync semantics or manifest generation beyond invoking the
  existing manifest helper after editor-side rewrites.
- Do not make skill/KB/customize changes update `AGENTS.md` immediately. The lag
  until the next editor save is intentional.
- Do not add automatic live-agent sweeps or production mutation commands.
- Do not redesign `CONTEXT.md`; only remove legacy renderer coupling where it is
  left unused by this change.

## Context and Patterns

- `packages/api/workspace-files.ts` is the canonical server-side editor write path
  and already regenerates `manifest.json` after agent file mutations.
- `packages/api/src/lib/workspace-map-generator.ts` already contains the DB queries
  and table rendering behavior for skills, knowledge bases, and workflows.
- `docs/solutions/design-patterns/gitkeep-materialization-s3-empty-folders-2026-05-13.md`
  says S3 folder materialization relies on `.gitkeep` sentinels that should be
  hidden from user-facing trees.
- `docs/solutions/workflow-issues/agent-builder-smoke-cleanup-needs-manifest-regeneration-2026-04-26.md`
  reinforces that any direct workspace shape change must be followed by manifest
  regeneration.
- `docs/solutions/architecture-patterns/workspace-skills-load-from-copied-agent-workspace-2026-04-28.md`
  and `docs/solutions/best-practices/injected-built-in-tools-are-not-workspace-skills-2026-04-28.md`
  define the editable skill-folder and built-in tool boundary.

## Key Technical Decisions

- Use a line-oriented section parser rather than a Markdown AST. The boundary
  contract is heading/simple-divider based, and a scanner can preserve untouched
  regions byte-for-byte without parser normalization.
- Extract reusable derived-section rendering from `workspace-map-generator.ts`
  before wiring editor actions. This keeps the riskiest logic pure and unit tested.
- Build the folder tree from all S3 object keys under the agent workspace prefix,
  filtering hidden basenames and operational sentinels, then render directories and
  files deterministically.
- Keep DB projections in the API package and reuse the current escaping/truncation
  rules so the derived tables do not visually regress.
- Treat `regenerate-map` as a manual section refresh, not a whole-document rewrite.
- Implement normalization as an explicit operator action using a canonical template
  plus the same derived-section renderer; do not run normalization automatically.

## Implementation Units

### U1. Section Rewriter and Recursive Renderer Core

**Goal:** Add the pure section replacement helper, recursive S3 tree discovery, and
derived section renderers behind `regenerateWorkspaceMap` while keeping existing
external behavior compatible.

**Files:**

- Modify: `packages/api/src/lib/workspace-map-generator.ts`
- Modify: `packages/api/src/lib/__tests__/workspace-map-generator.test.ts`
- Add or update: helper exports in the same module unless tests show a separate
  module is cleaner.

**Tests:**

- Existing `workspace-map-generator` workflow, skill, empty-state, and idempotency
  tests continue to pass.
- New parser tests cover preserving non-derived sections byte-identical and appending
  missing sections in canonical order.
- New folder-tree tests cover nested paths, reserved folders, annotation extraction
  from `CONTEXT.md`, and dotfile / `.gitkeep` filtering.

### U2. Editor Integration and Background Rewriter Retirement

**Goal:** Invoke the section-scoped helper after successful agent editor writes and
remove non-editor auto-rewrite callers.

**Files:**

- Modify: `packages/api/workspace-files.ts`
- Modify: `packages/api/src/__tests__/workspace-files-handler.test.ts`
- Modify: `packages/api/src/graphql/resolvers/knowledge/setAgentKnowledgeBases.mutation.ts`
- Modify: `packages/api/src/graphql/resolvers/customize/render-workspace-after-customize.ts`
- Modify: `packages/api/src/graphql/resolvers/customize/render-workspace-after-customize.test.ts`
- Modify: `packages/api/src/lib/evals/eval-agent-provisioning.ts`
- Modify: `packages/api/src/handlers/bootstrap-workspaces.ts`
- Modify/delete: `packages/api/scripts/regen-all-workspace-maps.ts`
- Modify: `scripts/bootstrap-workspace.sh`

**Tests:**

- Workspace-files handler tests prove `put`, `delete`, `move`, and
  `create-sub-agent` trigger section rewrite for agent targets only, surface rewrite
  failures, and leave non-agent targets alone.
- Mutation tests prove skill/KB/customize paths no longer call map regeneration.
- Existing eval provisioning tests prove agent setup no longer rewrites `AGENTS.md`.

### U3. Operator Normalization and Bootstrap Polish

**Goal:** Seed/repair drifted `AGENTS.md` documents through explicit operator actions
while keeping bootstrap/rematerialize as the only non-editor exceptions.

**Files:**

- Modify: `packages/api/src/lib/workspace-bootstrap.ts`
- Modify: `packages/api/src/__tests__/workspace-bootstrap.test.ts`
- Modify: `packages/api/workspace-files.ts`
- Modify: `packages/api/src/__tests__/workspace-files-handler.test.ts`
- Modify: `apps/admin/src/lib/workspace-files-api.ts`
- Modify relevant Agent Editor / Agent Builder UI files if the existing
  rematerialize affordance is insufficient.

**Tests:**

- Bootstrap/rematerialize tests prove initial or operator-triggered `AGENTS.md`
  includes all four derived sections and hand-authored template sections.
- Workspace-files tests prove the normalization path is agent-only and uses the
  same section renderer.
- Admin tests cover the API client shape and any new button/label introduced.

## Verification Strategy

For each unit, run the focused package tests first, then `pnpm --filter
@thinkwork/api typecheck` for backend units. Before opening PRs, run touched-file
Prettier checks, `git diff --check`, and the smallest broader test slice that
covers the changed package. GitHub required checks are the final gate before merge.
