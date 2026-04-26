---
title: "feat: Agent-builder `agents/` section grouping and Add Sub-agent affordance"
type: feat
status: active
date: 2026-04-26
origin: docs/brainstorms/2026-04-26-agents-folder-reserved-name-requirements.md
supersedes: docs/plans/2026-04-26-002-feat-agents-folder-reserved-name-plan.md (prior storage-rewrite draft, rejected via document review)
---

# feat: Agent-builder `agents/` section grouping and Add Sub-agent affordance

## Overview

Deliver the two affordances the operator was missing in Marco's workspace — a visible "where sub-agents live" location and an Add Sub-agent button — entirely as UI changes in the agent builder. Storage remains FOG-pure per Plan 008 (`docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md`): sub-agents continue to live at `{agent}/{slug}/` paths enumerated by the parent's `AGENTS.md` routing table. The `agents/` group is a UI fabrication that reads from the routing table and renders routed top-folders together under a synthetic section header — not a storage layout, not a reserved name, not a translation pattern.

This plan supersedes the storage-rewrite approach the origin requirements doc proposed (R1, R2, R5, R10, R11, R19 of origin). Document review (`ce-doc-review` round 1, 2026-04-26) surfaced that the brainstorm's two stated gaps were both UI affordances, that the plan's own U6 conceded "the UI fabricates the section header" and "hide `agents/` segment in display path," and that 7 of 8 implementation units were paying for an invariant the operator never sees. The reconsidered decision: UI fabrication delivers identical operator-visible behavior at a fraction of the surface area, preserves Plan 008's FOG-pure commitment, and avoids retrofitting a translation layer under three already-shipped phases.

---

## Problem Frame

When inspecting a real workspace (Marco's), two affordances were missing in the agent builder:

1. **No visible "where sub-agents go" location.** The mental model needs an anchor — even when empty — so an operator looking at a workspace can answer "where would a sub-agent go?" without reading the routing table.
2. **No Add Sub-agent action in the builder.** The flagship authoring surface lacked the most common sub-agent creation move.

Both gaps are UI surfaces. Plan 008's storage layout (sub-agents at top level, enumerated by `AGENTS.md`) is correct for distribution and runtime — the gap is that the builder doesn't *render* the routing-table enumeration as a visible group, and doesn't expose a button for the create action. The fix is: read the parent's `AGENTS.md` routing rows, group every top-folder whose slug is a `Go to` target under a synthetic `agents/` section header in the tree, and add a creation affordance in the section's empty state and toolbar.

(See origin: `docs/brainstorms/2026-04-26-agents-folder-reserved-name-requirements.md`. Origin's R1–R12, R16–R22 — which described a storage rewrite — are superseded; only origin R7 and R8 — the operator-facing affordance requirements — carry forward.)

---

## Requirements Trace

- R1. The agent-builder FolderTree renders a synthetic `agents/` section header that groups every top-level folder whose slug appears as a `Go to` target in the agent's root `AGENTS.md` routing table. (origin R7)
- R2. The synthetic `agents/` section is always visible in the tree, even when zero sub-agents exist. (origin R7)
- R3. The empty state of the `agents/` section shows an Add Sub-agent affordance with a one-line explanation of what sub-agents are. (origin R7, R8)
- R4. The Add Sub-agent action creates a top-level sub-agent folder, seeds `CONTEXT.md` from the active starter snippet, and atomically appends a routing row to the parent's `AGENTS.md`. (origin R8)
- R5. Slug validation rejects the existing reserved-name set (`memory`, `skills`) and any slug that collides with an existing top-folder. (origin R8)
- R6. Storage layout, importer, composer, runtime, parser, and `delegate_to_workspace` semantics are unchanged from Plan 008. No new reserved name, no path-translation layer, no FOG-bundle relocation rule, no `DEFAULTS_VERSION` bump. (deliberate scope cut from the prior draft)

**Origin actors carried forward:** A2 (tenant operator) is the primary actor; A4 (agent runtime) is unaffected because storage stays the same.

**Origin acceptance examples that survive:** AE1 (empty `agents/` section + Add button) and AE2 mapped onto the new model — the operator's view is identical, the storage path is `{agent}/expenses/` rather than `{agent}/agents/expenses/`. AE3–AE6 (storage rewrite, importer relocation, vendor normalization changes) no longer apply.

---

## Scope Boundaries

- Not changing storage layout, S3 key shape, or the composer's path resolution.
- Not adding a reserved name. The `agents/` group is purely a UI grouping; the slug `agents` remains a valid top-folder name as far as the parser, runtime, and S3 are concerned (it would just visually appear under the synthetic group like any other routed slug).
- Not modifying the FOG/FITA importer, vendor-path normalizer, or `vendor-path-normalizer.ts` rule table.
- Not touching `packages/agentcore-strands/agent-container/container-sources/*` or any Python source. No AgentCore container redeploy required.
- Not bumping `DEFAULTS_VERSION`. Workspace-defaults source files unchanged.
- Not migrating any tenant data. Forward-compatible by construction — every existing routed sub-agent immediately renders under the new section grouping with zero data movement.
- Not authoring inline `SKILL.md` (already deferred by Plan 008; unchanged).

### Deferred to Follow-Up Work

- **Add Sub-agent flow inside an existing sub-agent.** v1 ships the affordance at the agent root only (creating a top-level sub-agent). Adding a sub-sub-agent ("a sub-agent inside `expenses/`") is deferred — Plan 008 U19 (drag-create) is the natural home if/when it ships, otherwise a follow-up unit. Rationale: Marco's workspace gap was at the root; nested authoring is a smaller-population need that can wait for usage signal.

---

## Context & Research

### Relevant Code and Patterns

**Agent builder UI (the only modified surface):**
- `apps/admin/src/components/agent-builder/AgentBuilderShell.tsx` — `FOLDER_TEMPLATES` (lines ~138-144), `handleAddFolder` (lines ~369-376), the "+" dropdown menu (lines ~600-640). New `handleAddSubAgent(slug, snippetId)` lands here.
- `apps/admin/src/components/agent-builder/FolderTree.tsx` — `buildWorkspaceTree(files)` (lines 21-63) is purely file-path-driven today. New signature accepts the parent's `AGENTS.md` routing rows; routed top-folder slugs are grouped under a synthetic `agents/` parent node before render.
- `apps/admin/src/components/agent-builder/snippets.ts` — `STARTER_AGENT_TEMPLATES` (lines 38-53) already uses FOG-pure semantic paths (`support/`, `operations/`); content unchanged.
- `apps/admin/src/lib/agent-builder-api.ts` — add `createSubAgent(agentId, slug, contextContent)` mutation that POSTs `{slug}/CONTEXT.md` and PATCHes parent `AGENTS.md` in a single Lambda round-trip.
- `apps/admin/src/lib/workspace-tree-actions.ts` — slug-validation helper extends the existing reserved-name check (currently `memory`, `skills`) with a top-folder collision check.

**Existing infrastructure leveraged unchanged:**
- `packages/api/src/lib/agents-md-parser.ts` — already extracts `RoutingRow { task, goTo, ... }` from `AGENTS.md`. The builder consumes this output via `composeFile` to identify routed slugs.
- `packages/api/src/lib/workspace-map-generator.ts` — `appendRoutingRowIfMissing` already exists for inserting routing rows; reused by the new `createSubAgent` mutation.
- `packages/api/workspace-files.ts` — POST/PATCH handlers unchanged; no new endpoints.

**Plan 008 in-flight coordination:**
- Plan 008 U19 (drag-create with `AGENTS.md` auto-sync) — codebase scan confirms not shipped (`apps/admin/src/components/agent-builder/DragDropCoordinator.tsx` absent, no `createSubAgent` mutation in `agent-builder-api.ts`). Plan 008 U19 and this plan's U2 land overlapping mutations; sequencing decided in Open Questions below.

### Institutional Learnings

- `docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md` — applies to the slug-validation helper. Inline the reserved-name list in `workspace-tree-actions.ts`; the existing TS↔Python parity test in `packages/agentcore/agent-container/fixtures/agents-md-sample.md` continues to gate reserved-set drift across the parser pair (no parser change in this plan).
- `docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md` — applies to the U2/U19 coordination question. Re-survey Plan 008 Phase E ship state immediately before U2 implementation begins; the plan documents the survey output as a prerequisite, not a discovery.

### External References

None required — this plan operates entirely inside the existing builder, parser, and routing-table contracts that Plan 008 has already shipped or is shipping.

---

## Key Technical Decisions

- **Storage stays FOG-pure.** Sub-agents live at `{agent}/{slug}/` exactly as Plan 008 ships. The `agents/` group is a UI fabrication in `FolderTree.tsx`. Operator-visible behavior matches the storage-rewrite design; the implementation cost is one component refactor instead of seven.
- **The synthetic `agents/` section is rendered from `AGENTS.md` routing rows, not from a storage prefix.** `FolderTree` reads the parent's parsed routing rows (already produced by `agents-md-parser.ts` and surfaced through `composeFile`) and treats every top-folder whose slug appears as a `Go to` target as a "sub-agent." Top-folders that don't appear in any routing row render outside the group as data.
- **The `agents/` section is unconditionally present.** When zero routed slugs exist, the section header renders with an empty-state row + Add Sub-agent button. There is no DB row, no S3 placeholder, no `.keep` file — the empty section is purely a render-time fabrication, identical to how stub headers work today for "Memory" and "Skills" groupings in the builder.
- **Add Sub-agent goes through one Lambda call.** The new `createSubAgent(agentId, slug, contextContent)` API does both writes in one handler invocation — `PutObject` for `{slug}/CONTEXT.md` and an `appendRoutingRowIfMissing` patch on `{agent}/AGENTS.md`. Atomicity comes from the Lambda's success-or-error contract; partial failures surface to the operator as a single error toast (no half-created agents in the tree).
- **Slug validation reuses the existing reserved-name set.** `memory` and `skills` remain rejected (Plan 008 R25). No new reserved name. Top-folder name collision is checked against the current composed file list returned by `composeList`. Format rule: alphanumeric + hyphen, starting with alphanumeric, max 32 chars (matches Plan 008 R25 implicit convention; explicit here for the validator).
- **Coordinate with Plan 008 U19 by ownership, not by reuse.** This plan owns the Add Sub-agent at root; Plan 008 U19 owns drag-create at depth (sub-agent inside a sub-agent). The two units share the underlying mutation but at different call sites. To avoid two-mutations-overlap, this plan ships `createSubAgent` as the canonical mutation; U19 adopts it when it lands. If U19 has already shipped its own mutation by the time this plan starts, U2 reuses U19's mutation instead of defining one.
- **Forward-only, zero-migration.** Every existing routed sub-agent in any tenant immediately renders under the new section. No data scan, no relocation, no `DEFAULTS_VERSION` bump.

---

## Open Questions

### Resolved During Planning

- **Should storage layout change to nest sub-agents under `agents/`?** → No. Storage stays FOG-pure (Plan 008 unchanged). The affordance is a UI fabrication.
- **Empty `agents/` section — backing storage?** → No backing storage. Pure render-time fabrication.
- **What is the source of truth for "is this folder a sub-agent?"** → The parent's `AGENTS.md` routing table, exactly as Plan 008 specifies. The builder reads the parsed routing rows via `composeFile`/`agents-md-parser`.
- **Should the `agents/` slug be reserved?** → No. With UI fabrication, there's no storage-layer requirement to reserve it. If an operator names a sub-agent `agents`, it renders under the synthetic group like any other routed slug — slightly confusing visually but not broken.

### Deferred to Implementation

- **Add Sub-agent error UX when the parent `AGENTS.md` doesn't exist yet.** Two options: (a) the Lambda's `appendRoutingRowIfMissing` creates a minimal `AGENTS.md` from `workspace-map-generator.ts:renderAgentsMap`; (b) the form blocks with a "Generate AGENTS.md first" prompt. Bias: (a), reusing the existing renderer. Resolve in U2.
- **Slug-validation reject UX copy and trigger point.** Inline error on keystroke vs. on submit; copy ("`memory` is a reserved folder name" vs. "Choose a different name"). Resolve in U2; reuse the existing form-error pattern from `AgentBuilderShell`'s file-create dialogs.
- **Plan 008 U19 sequencing.** This plan's U2 must run a 5-minute survey of Phase E ship state immediately before implementation: if U19 has shipped a `createSubAgent` mutation, U2 imports it; if not, U2 defines it and U19 imports it when it lands. Either way, single mutation across both call sites. Survey command: `git grep -l createSubAgent apps/admin/src/lib/`.
- **Whether the synthetic `agents/` group's expand/collapse state persists across sessions.** Existing `expandedFolders` state in `FolderTree` is local to the component. Bias: persist the synthetic node's state in the same set (treat it like any other folder for UI persistence).

---

## Implementation Units

- U1. **FolderTree: render synthetic `agents/` section grouped by AGENTS.md routing rows**

**Goal:** `buildWorkspaceTree` accepts the parent's routing rows; routed top-folders render under a synthetic `agents/` section header. Non-routed top-folders render outside the group as data. The synthetic section is always present, even when empty.

**Requirements:** R1, R2.

**Dependencies:** None.

**Files:**
- Modify: `apps/admin/src/components/agent-builder/FolderTree.tsx` (extend `buildWorkspaceTree(files, routingRows?)`; introduce `SyntheticFolderNode` type or a `synthetic: true` flag on `TreeNode`)
- Modify: `apps/admin/src/components/agent-builder/AgentBuilderShell.tsx` (parse the agent's root `AGENTS.md` once via existing `composeFile` + `parseAgentsMd`, pass routing rows to FolderTree)
- Test: `apps/admin/src/components/agent-builder/__tests__/FolderTree.test.tsx`

**Approach:**
- `buildWorkspaceTree` becomes `(files, routingRows?) => TreeNode[]`. When `routingRows` is supplied, top-folder slugs that appear as `Go to` targets become children of a synthetic `agents/` parent node (label: "Sub-agents", `synthetic: true`). When no rows or empty rows, the synthetic parent is still present with zero children — its `EmptyState` child renders the Add Sub-agent affordance (delivered in U2).
- Non-routed top-folders (e.g., `attachments/`, `archive/`) render at root level as today.
- Reserved folders `memory/` and `skills/` continue to render at their existing positions; they are never under the synthetic group regardless of routing-row content.
- The synthetic node is purely render-time; it never round-trips into the file list, never appears in `path` strings passed back to the API, and never writes to S3.

**Patterns to follow:**
- Existing `FolderTree` state-rendering pattern; extend, don't rewrite.
- Existing `expandedFolders` pattern for collapse-by-default; the synthetic node defaults to expanded for discoverability.

**Test scenarios:**
- Happy path: agent with `expenses/CONTEXT.md`, `recruiting/CONTEXT.md` and a root `AGENTS.md` routing both — both render as children of the synthetic `Sub-agents` node. `attachments/file.pdf` (no routing row) renders outside the group.
- Happy path: agent with no routing rows — synthetic node renders with zero children and an empty-state placeholder.
- Happy path: agent with one routing row pointing to `expenses/` but no `expenses/` files yet — synthetic node renders an "expenses (no files)" entry that links into the section.
- Edge case: an `AGENTS.md` row whose `Go to` slug has no matching top-folder — render the slug under the synthetic group with a "missing files" indicator (drift between routing and storage; surfaced visually so the operator can resolve).
- Edge case: a top-folder whose slug is NOT in any routing row but DOES contain `CONTEXT.md` (orphan sub-agent, e.g., from manual S3 PUT) — renders outside the synthetic group as data. Operator can fix by adding a routing row.
- Edge case: routing row points to nested path `expenses/escalation/` — v1 renders under the synthetic group as `expenses/escalation` (string display). Nested grouping is a follow-up.
- Edge case: malformed `AGENTS.md` (parser returns empty rows) — synthetic node renders empty; no crash.
- Integration: change `AGENTS.md` (add a row) → next render groups the matching folder under the synthetic node without page reload (existing React Query invalidation flow).

**Verification:**
- `pnpm --filter @thinkwork/admin test FolderTree` green.
- Manual: open Marco's workspace; the synthetic `Sub-agents` section is visible at the top of the tree, populated with whatever routing rows exist (likely zero, given his current state).

---

- U2. **Add Sub-agent affordance: button, form, and `createSubAgent` mutation**

**Goal:** Empty-state and section-header render an Add Sub-agent button. Clicking opens a form (slug, snippet, optional template). Submission creates `{slug}/CONTEXT.md` and atomically appends a routing row to the parent's `AGENTS.md`. Slug validation rejects reserved names and existing top-folder collisions.

**Requirements:** R3, R4, R5.

**Dependencies:** U1 (the synthetic section is the affordance's host).

**Files:**
- Modify: `apps/admin/src/components/agent-builder/AgentBuilderShell.tsx` (add `handleAddSubAgent`; new menu item in "+" dropdown; new dialog component)
- Create: `apps/admin/src/components/agent-builder/AddSubAgentDialog.tsx` (form, validation, submission; reuse existing dialog primitives)
- Modify: `apps/admin/src/lib/agent-builder-api.ts` (`createSubAgent(agentId, slug, contextContent)` mutation)
- Modify: `apps/admin/src/lib/workspace-tree-actions.ts` (slug-validation helper)
- Modify: `packages/api/workspace-files.ts` (new sub-handler or composite endpoint that performs PutObject + AGENTS.md PATCH atomically — single Lambda call)
- Test: `apps/admin/src/components/agent-builder/__tests__/AddSubAgentDialog.test.tsx`
- Test: `packages/api/__tests__/workspace-files-handler.test.ts` (extend to cover the composite create-sub-agent path)

**Approach:**
- "+" dropdown gains an "Add Sub-agent" entry, available only when the active context is the agent root (not a sub-folder, not memory/, not skills/).
- AddSubAgentDialog form fields: Slug (text, validated on keystroke), Snippet (dropdown — defaults to a minimal `# {slug}` CONTEXT.md, options pull from existing `STARTER_AGENT_TEMPLATES` snippet library where applicable).
- Slug validation rules (inline error on keystroke):
  - Format: `/^[a-z][a-z0-9-]{0,31}$/` (alphanumeric + hyphen, starts with letter, ≤32 chars).
  - Reserved-name reject: any segment in the existing TS reserved set (`memory`, `skills`).
  - Top-folder collision: query the current composed file list; if any existing top-folder shares the slug, reject.
- On submit:
  - Client calls `createSubAgent(agentId, slug, contextContent)`.
  - Server handler does:
    1. Validate slug server-side (defense in depth — same regex + reserved set, look up current top-folders for collision).
    2. Compose current `AGENTS.md` content (read via existing composer).
    3. Compute new `AGENTS.md` content via `appendRoutingRowIfMissing(currentContent, { task: slug, goTo: slug, reads: [`${slug}/CONTEXT.md`], skills: [] })`.
    4. Single S3 transaction (or sequenced PUTs with idempotency markers): write `{agent-prefix}/{slug}/CONTEXT.md` and `{agent-prefix}/AGENTS.md`. If the routing-row write fails, the orphan `CONTEXT.md` is benign — it renders outside the synthetic group as data; operator can retry or delete via existing tree actions.
    5. Return the new file list (so React Query can invalidate without a full refetch round-trip).
- On error: form keeps the slug entered, surfaces the server error inline (e.g., "slug already taken at storage path").

**Patterns to follow:**
- Existing dialog primitives in `AgentBuilderShell` for file-create and folder-create flows.
- `appendRoutingRowIfMissing` in `packages/api/src/lib/workspace-map-generator.ts` is the canonical row-insertion helper.
- `requireTenantAdmin(ctx, tenantId)` per `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` on the new server handler.

**Test scenarios:**
- Happy path: operator opens form, types `support`, picks the minimal snippet, submits → POST 200; tree refreshes; "support" appears under the synthetic group; `AGENTS.md` has a new routing row for it.
- Happy path: operator with no `AGENTS.md` at root yet — handler renders one via `workspace-map-generator.renderAgentsMap` and includes the new routing row in the rendered content.
- Edge case: operator types `memory` → inline error: "`memory` is a reserved folder name"; submit button disabled.
- Edge case: operator types `skills` → same as above.
- Edge case: operator types `Sales` (invalid case) → inline error: "Slug must start with lowercase letter and contain only a-z, 0-9, and hyphens."
- Edge case: operator types `expenses` while `expenses/` already exists at root — server-side collision check returns 409; form surfaces "A folder named `expenses` already exists at this agent's root."
- Edge case: operator submits with valid slug while another tab is creating the same slug concurrently — second request returns 409; first wins.
- Edge case: handler succeeds writing `CONTEXT.md` but fails patching `AGENTS.md` (e.g., S3 throttle on second PUT) — operator sees error toast; tree refresh shows orphan `expenses/CONTEXT.md` outside the synthetic group; retrying the form's submit re-derives the routing-row patch idempotently.
- Integration: end-to-end — create a sub-agent via the UI, then call `delegate_to_workspace("expenses")` from a chat session; the delegated agent's prompt includes the seeded `CONTEXT.md` content. (Existing Plan 008 behavior; verifies the affordance integrates cleanly.)
- **Covers AE1 (origin).** Empty workspace shows the affordance from second zero.

**Verification:**
- `pnpm --filter @thinkwork/admin test AddSubAgentDialog` green.
- `pnpm --filter @thinkwork/api test workspace-files-handler` green.
- Manual: brand-new agent in dev → builder shows synthetic section with Add button → click → create `support` → routing row appears in `AGENTS.md` → delegate from a chat session works.

---

## System-Wide Impact

- **Interaction graph:** `FolderTree` becomes routing-row-aware; the new `createSubAgent` server handler is a thin composition of existing primitives (composer + `appendRoutingRowIfMissing` + S3 PUT). No other surface changes.
- **Error propagation:** Add Sub-agent failures are confined to the form; partial state (orphan `CONTEXT.md` without routing row) renders visibly outside the synthetic group, which is the existing behavior for any non-routed top-folder.
- **State lifecycle risks:** None new. The synthetic `agents/` node has no persisted state; React Query handles freshness on routing-row changes.
- **API surface parity:** `POST /api/workspaces/files` gains a composite mode (or a new sibling endpoint) for the create-sub-agent two-write atomic operation. AppSync/GraphQL schema unchanged. Mobile/CLI surfaces unaffected.
- **Integration coverage:** The runtime/`delegate_to_workspace` integration is unchanged because storage is unchanged. The end-to-end test in U2 verifies the new affordance writes data the runtime can already consume.
- **Unchanged invariants:** Storage layout, S3 keys, composer path resolution, reserved-name set, vendor-path normalization, FOG/FITA bundle import, AgentCore container, `delegate_to_workspace` contract, `write_memory` semantics, pinned-version key shape, and Plan 008 Phases A/B/C — all preserved.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Plan 008 U19 (drag-create) ships its own `createSubAgent` mutation in parallel, leading to two overlapping mutations | This plan ships `createSubAgent` as the canonical mutation. U2's pre-implementation survey (`git grep -l createSubAgent apps/admin/src/lib/`) determines whether to define or import. Either way, single mutation across both surfaces. |
| The synthetic `agents/` section visually conflates "routed sub-agent with no files" and "files exist at this slug but not in routing" | U1 surfaces drift visually (missing-files indicator + orphan-folder rendering outside the group). Operator has tools to resolve via existing tree actions. |
| Operator names a sub-agent `agents`, which then renders under the synthetic section labeled "Sub-agents > agents" | Visually slightly confusing but not broken. Plan acknowledges this is acceptable v1 behavior; if it becomes a real complaint, a future PR can add `agents` to the reserved-name set as a UI-only convention (no storage impact). |
| Add Sub-agent's two-write composite is not transactional in S3 | Idempotent retry in the form on partial failure; orphan `CONTEXT.md` renders outside the synthetic group, so the operator sees the partial state and can retry. No silent corruption. |
| Plan 008 U19 has already shipped before this plan starts and chose a different mutation shape | U2's survey detects this; U2 then adopts U19's mutation rather than defining its own. Coordination through code, not through plans. |

---

## Documentation / Operational Notes

- No Starlight doc updates required. `/docs/agent-design/folder-is-the-agent.mdx` and `/docs/agent-design/inheritance-rules.mdx` continue to describe the FOG-pure layout accurately. The synthetic `agents/` section is a builder-internal UI concept; documenting it in the agent-design section would mislead authors into thinking it's a storage concept.
- No deploy runbook changes; standard `deploy.yml` flow.
- No AgentCore container redeploy needed.
- Origin requirements doc (`docs/brainstorms/2026-04-26-agents-folder-reserved-name-requirements.md`) needs an update reflecting the reconsidered decision: the storage rewrite is dropped in favor of UI fabrication. Update lands alongside this plan's first PR.
- Memory note `project_fat_folders_decision.md` needs no change — the FOG-pure decision it captures stands. A new memory note captures the 2026-04-26 reconsideration.

---

## Sources & References

- **Origin document (partially superseded):** [docs/brainstorms/2026-04-26-agents-folder-reserved-name-requirements.md](docs/brainstorms/2026-04-26-agents-folder-reserved-name-requirements.md). Origin R7 and R8 (the operator-facing affordance requirements) carry forward; origin R1–R6 and R9–R22 (storage rewrite, importer relocation, vendor normalization, etc.) are dropped.
- **Parent plan (unchanged by this plan):** [docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md](docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md) — Phases A/B/C shipped; D/E/F continue against FOG-pure layout.
- **Document review that produced this reconsidered scope:** ce-doc-review round 1, 2026-04-26 (product-lens chain root challenged the storage rewrite; user accepted "U6-only" reconsideration option).
- **Inline-helpers learning:** docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md
- **Survey-before-destructive-work learning:** docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md
- **TenantAdmin-on-mutations learning:** docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md
