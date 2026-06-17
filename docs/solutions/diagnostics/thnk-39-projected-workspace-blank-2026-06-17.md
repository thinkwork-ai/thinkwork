---
module: apps/web thread conversation
date: 2026-06-17
problem_type: debug_findings
component: projected_workspace_panel
severity: medium
linear: THNK-39
status: diagnosis_only
tags:
  - thread-detail
  - projected-workspace
  - workspace-projection
  - ui-bug
  - debug-artifact
---

# THNK-39: Projected Workspace Blank

## Problem

Linear THNK-39 reports that after the Projected Workspace activity row was
pinned to the top of Thread Conversation -> Turn detail, expanding the row shows
no projection data. The attached screenshot shows the row rendered as
`Projected workspace 0 sources - 0 fetches`, while the same turn still shows
workspace sync, AgentCore phases, and MCP/tool invocation activity below it.

Issue context checked on 2026-06-17:

- Linear issue: THNK-39, "Projected workspace blank"
- Status before this artifact: Debug
- Labels: Bug, Codex
- Project: Enterprise Agent OS
- Comments: one dispatcher comment assigning the Codex debug worker
- Child issues: none found
- Existing Linear documents: none found
- Attachments: no separate Linear attachments; one screenshot embedded in the
  issue description

## Root Cause

The UI renders a Projected Workspace panel for projection-shaped shells that do
not contain the dispatch-time workspace snapshot fields.

Causal chain:

1. `chat-finalize` always attempts to merge a compact reconcile summary after
   `reconcileChangedFiles` completes, even when there were no rejected files:
   `packages/api/src/lib/chat-finalize/process-finalize.ts:201`.
2. `mergeWorkspaceProjectionReconcileSummary` creates the nested
   `workspace_projection` object if it is missing, by defaulting it to
   `'{}'::jsonb`, then setting only `workspace_projection.reconcile`:
   `packages/api/src/lib/workspace-projection-snapshot.ts:452`.
3. If the dispatch-time snapshot did not land or was not available on the row
   yet, the persisted shape is a reconcile-only shell. For a clean reconcile,
   that shell carries no visible sources, fetches, rendered prefix, injected
   files, or AGENTS.md key.
4. The web parser treats any object at
   `contextSnapshot.workspace_projection` as a valid projection, including `{}`:
   `apps/web/src/components/workbench/workspace-projection.ts:164`.
5. Existing tests explicitly bless this behavior:
   `apps/web/src/components/workbench/workspace-projection.test.ts:147` expects
   an empty object to parse as non-null, and
   `apps/web/src/components/workbench/ProjectedWorkspacePanel.test.tsx:306`
   expects a visible panel with `0 sources - 0 fetches`.
6. `ProjectedWorkspacePanel` then derives the summary from the empty arrays:
   `apps/web/src/components/workbench/ProjectedWorkspacePanel.tsx:176`.
7. PR #2546 moved the panel before the other activity rows. That did not create
   the empty data, but it made the placeholder the first visible expanded row,
   matching the screenshot.

The backend projection writer itself is not the likely generic failure point:
`recordDispatchWorkspaceProjectionSnapshot` writes `renderedPrefix`,
`sources`, `agentsMdKey`, `injectedFiles`, and `generatedAt` when the workspace
render returns a hydrate manifest. The bug is that finalize-side reconcile can
create a displayable shell without those dispatch fields, and the client has no
minimum-data gate.

## Evidence

- Recent relevant PR: #2546, "fix(web): pin projected workspace activity
  first", merged 2026-06-16. It only moved the existing panel above activity
  rows and added a test with a fully populated projection.
- Origin feature PR: #2405, "feat: dynamic workspace - routing tree, fetch
  tool, scoped settings, turn projections (THNK-10)", merged 2026-06-12.
- Existing API test confirms reconcile summaries can be empty:
  `packages/api/src/lib/workspace-projection-snapshot.test.ts` has
  `yields an empty summary for a clean reconcile`.
- Existing web tests confirm the current blank UI is intentional according to
  today's assertions, not a rendering crash.

Focused verification run in this debug worktree:

```bash
pnpm --filter @thinkwork/web test -- src/components/workbench/workspace-projection.test.ts src/components/workbench/ProjectedWorkspacePanel.test.tsx
pnpm --filter @thinkwork/api test -- src/lib/workspace-projection-snapshot.test.ts
```

Results:

- Web: 2 files passed, 29 tests passed
- API: 1 file passed, 23 tests passed

Environment note: the fresh worktree initially lacked `node_modules`.
`pnpm install` was required. During install, `canvas` attempted a Node 25 source
build and logged a `pkg-config` failure, but pnpm completed and the targeted
tests ran successfully.

## Assumption Audit

- Verified: The Linear screenshot shows a present Projected Workspace row with
  zero sources and zero fetches, while other turn activity is present.
- Verified: The current parser returns a non-null projection for an empty
  object.
- Verified: The current panel renders that parsed empty object as
  `0 sources - 0 fetches`.
- Verified: The finalize reconcile merge creates `workspace_projection` when it
  is missing.
- Verified: PR #2546 only changed ordering and test coverage around a populated
  fixture.
- Assumed: The affected production row has either `{}` or a reconcile-only
  `workspace_projection` shell. The screenshot is consistent with this, but the
  thread id was not available in the issue text, so no production DB row was
  queried.

## Fix Plan

Do not change product behavior in this debug artifact PR. For the product fix,
use one of these focused approaches:

1. Preferred client-side gate: update `parseWorkspaceProjection` to return
   `null` for projection shells with no displayable dispatch-time data and no
   non-empty fetch/reconcile evidence. A valid panel should require at least
   one of: `renderedPrefix`, `agentsMdKey`, `agentsMdHistoryKey`,
   `generatedAt`, non-empty `sources`, non-empty `fetches`, non-empty
   `injectedFiles`, or `reconcile.rejectedCount > 0`.
2. Backend hardening: change `mergeWorkspaceProjectionReconcileSummary` so a
   zero-rejection reconcile summary does not create `workspace_projection` when
   no dispatch snapshot exists. This prevents future shell rows, but does not
   by itself hide already persisted shells.
3. Best combined fix: implement the client gate for existing data and backend
   hardening for future rows.

Recommended tests for the fix PR:

- Change `apps/web/src/components/workbench/workspace-projection.test.ts` so
  `{ workspace_projection: {} }` parses to `null`.
- Add a parser case for `{ workspace_projection: { reconcile:
  { rejectedCount: 0, rejections: [] } } }` returning `null`.
- Keep a parser case where `reconcile.rejectedCount > 0` remains visible, so
  real rejected-file evidence is not hidden.
- Change `apps/web/src/components/workbench/ProjectedWorkspacePanel.test.tsx`
  to remove the current "minimal/malformed snapshot renders 0 sources" contract.
- Add or update a `TaskThreadView` test that a turn with reconcile-only,
  zero-rejection projection does not render `projected-workspace-panel`, while a
  populated projection still appears before workspace sync rows.
- If backend hardening is included, add an API test proving a clean reconcile
  does not create `workspace_projection` on rows where it is absent, while
  preserving existing dispatch fields when they are present.

## Risks

- Hiding all malformed projection shells could obscure useful reconcile
  rejection evidence. Preserve shells with `reconcile.rejectedCount > 0`.
- Backend-only hardening leaves already persisted empty shells visible until the
  client parser is fixed.
- A broad "require sources" rule would hide valid projections from unusual
  renders that have an AGENTS.md key or generated prefix but no source rows.
  Gate on displayable evidence, not source count alone.

## Status

Diagnosis only. No product fix was implemented in this artifact PR.
