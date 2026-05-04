---
title: "refactor: Clean up Company Brain Sources tab"
type: refactor
status: completed
date: 2026-05-04
origin: docs/brainstorms/2026-04-29-company-brain-v0-requirements.md
---

# refactor: Clean up Company Brain Sources tab

## Overview

Company Brain -> Sources currently mixes actionable source configuration with inert/planned adapters and a redundant source-agent section. The next slice should make the tab feel like the rest of Admin: one compact, scannable source table that only shows sources an operator can actually use or configure today.

The backend can keep inert source-agent seams for future adapter activation, but the Admin Sources tab should not advertise those seams as product-ready sources.

---

## Problem Frame

The Company Brain v0 requirements introduced sub-agent providers and inert seams so future ERP, CRM, support, and catalog adapters could be activated without reshaping the Context Engine contract. That was useful implementation scaffolding, but the current Admin UI exposes those planned seams as cards with amber "planned" states. This makes the source list look unfinished and dilutes the live operator workflow.

The user request is explicit: remove planned adapters from the visible Sources tab, remove the redundant "Company Brain source agents" panel, and replace source cards with the shared datatable pattern used across Admin.

---

## Requirements Trace

- R1. The Sources tab only lists actionable sources: enabled/disabled built-in providers, live source-agent providers, eligible MCP/Web providers, and pending Web fallback rows when relevant.
- R2. Providers whose `family === "sub-agent"` and whose `subAgent.seamState !== "live"` are hidden from the Sources table, adapter selection UI, and Admin test-query provider selection.
- R3. The redundant `Company Brain source agents` panel is removed from the page.
- R4. The source list uses the shared `DataTable` component and column patterns already used in Admin list pages.
- R5. The test harness, provider status inspection, and configuration dialog continue to work for visible providers.
- R6. Backend provider contracts and inert seams are not deleted as part of this UI cleanup.

**Origin actors:** A3 (Sub-agent context provider), A5 (Tenant admin).
**Origin flows:** F4 (KB-backed enrichment on gap).
**Origin acceptance examples:** AE6 (degraded provider state remains visible when a real provider is stale/rate-limited).

---

## Scope Boundaries

- Do not remove API/provider definitions for inert ERP, CRM, support, or catalog seams.
- Do not change `query_context` response shape or provider status semantics.
- Do not redesign the test query harness, result dialogs, or memory provider configuration.
- Do not add new source adapters or make planned adapters live.
- Do not change mobile Company Brain or runtime provider selection behavior.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/routes/_authed/_tenant/knowledge/context-engine.tsx` currently owns the Sources tab, including provider fetching, adapter selection, card rendering, configuration dialog, and result inspection.
- `apps/admin/src/components/ContextEngineSubAgentPanel.tsx` renders the redundant source-agent summary section shown below the cards.
- `apps/admin/src/lib/context-engine-api.ts` defines `ContextProviderSummary.subAgent.seamState?: "inert" | "live"`, which is enough to classify planned source-agent seams without backend changes.
- `apps/admin/src/components/ui/data-table.tsx` is the shared TanStack Table wrapper used by Admin list pages.
- `apps/admin/src/routes/_authed/_tenant/people/index.tsx` and `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.sub-agents.tsx` show the local pattern for `ColumnDef`, `DataTable`, row data mapping, badges, and no-pagination list tables.
- `apps/admin/src/routes/_authed/_tenant/knowledge/-knowledge-tabs.test.ts` is the only current Knowledge route test; the Sources cleanup needs new helper-level coverage.

### Institutional Learnings

- `docs/solutions/best-practices/context-engine-adapters-operator-verification-2026-04-29.md` says operator surfaces should show adapter participation, hit count, latency, skipped/degraded state, and reasons, because no-hit provider behavior is otherwise ambiguous.
- `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md` reinforces using existing Admin UI/data patterns before reshaping a surface.
- `docs/plans/2026-04-29-004-feat-company-brain-v0-plan.md` intentionally shipped inert seams for future adapters; this plan should hide them from Admin rather than delete the seam contract.

### External References

- External research skipped: this is a repo-local Admin UI refactor with strong existing table and provider-state patterns.

---

## Key Technical Decisions

- Hide inert source-agent seams in Admin, do not delete them: this satisfies the requested UX cleanup while preserving the Company Brain v0 seam-swap architecture.
- Use one visible-provider derivation for the table, adapter dropdown, and Admin test-query selection: this prevents planned sources from disappearing visually but still being sent through a default query path.
- Keep provider-local status visible in query results: the redundant source-agent panel can go away without losing the operator verification contract, because result provider statuses and dialogs already expose hit counts, latency, errors, and source-agent traces.
- Prefer helper extraction over component-wide tests: the route is large and API-backed, so extracting source row/filter helpers gives focused coverage for the regression-prone logic without requiring a full router/API harness.

---

## Open Questions

### Resolved During Planning

- Should planned adapters be deleted from backend provider registration? No. The prior Company Brain v0 plan intentionally introduced inert seams. This cleanup should make them invisible in Admin operator lists while leaving the backend seam contract untouched.
- Should live sub-agent providers still be configurable? Yes. If a sub-agent provider has `seamState === "live"`, it is actionable and should appear in the table with the same configuration affordance and source-agent anatomy available in the dialog.
- Does the redundant panel need a replacement? No. The source table plus existing query result provider-status panel cover the useful operator information without duplicating a second source list.

### Deferred to Implementation

- Exact column widths and truncation classes: choose by matching the final rendered table against nearby Admin table density and the Sources tab viewport.
- Whether to delete `ContextEngineSubAgentPanel.tsx` or leave it only if another import exists: implementation should use `rg` before removal and delete it when unused.

---

## Implementation Units

- U1. **Extract visible source row helpers**

**Goal:** Centralize the source visibility, badge, and row-shaping logic so planned source-agent seams are hidden consistently.

**Requirements:** R1, R2, R5, R6; origin R7-R11 and R31 from `docs/brainstorms/2026-04-29-company-brain-v0-requirements.md`.

**Dependencies:** None.

**Files:**

- Create: `apps/admin/src/routes/_authed/_tenant/knowledge/-context-engine-sources.ts`
- Test: `apps/admin/src/routes/_authed/_tenant/knowledge/-context-engine-sources.test.ts`
- Modify: `apps/admin/src/routes/_authed/_tenant/knowledge/context-engine.tsx`

**Approach:**

- Move pure provider helpers out of the route where useful: visible-source filtering, badge state derivation, description text, family/source label formatting, selectable-state derivation, and last-test summary formatting.
- Define planned source-agent providers as `provider.family === "sub-agent" && provider.subAgent?.seamState !== "live"`.
- Exclude planned source-agent providers from the row model and adapter dropdown input.
- Derive `defaultProviderIds`, `selectedProviders`, and initial selected ids from visible providers, not the raw provider list.
- When the raw backend default ids differ from the visible default ids because hidden planned providers were marked default, make the Admin test query send explicit visible provider ids instead of omitting `providers` and falling through to backend defaults.
- Keep non-sub-agent disabled providers visible so operators can re-enable or understand tenant policy.
- Keep `isPendingWebSearchProvider` visible as "waiting on API" because it reflects a real built-in setting, not a speculative future source.

**Patterns to follow:**

- `apps/admin/src/routes/_authed/_tenant/people/index.tsx` for compact row mapping before rendering.
- `apps/admin/src/lib/context-engine-api.ts` for the typed `seamState` source of truth.

**Test scenarios:**

- Happy path: given memory, wiki, workspace, knowledge-base, and Exa providers, `visibleContextProviders` returns all actionable rows.
- Edge case: given ERP/CRM/support/catalog sub-agent providers with missing or inert `seamState`, the helpers exclude them from visible rows and selectable adapter ids.
- Edge case: given a live sub-agent provider, the helpers include it and label it as live.
- Error path: given a disabled provider, the helpers keep it visible but mark it non-selectable.
- Integration: given a pending Web Search fallback provider, the helpers keep it visible with the waiting/stale badge and non-default semantics.
- Integration: given a hidden planned provider marked `defaultEnabled`, the Admin query-selection helper returns explicit visible default ids so the hidden provider is not invoked by a default query.

**Verification:**

- Helper tests prove planned providers do not appear in table rows or dropdown data while live providers still do.

---

- U2. **Replace source cards with DataTable**

**Goal:** Render the Company Brain source catalog as a shared Admin datatable instead of a card grid.

**Requirements:** R1, R4, R5; origin R31.

**Dependencies:** U1.

**Files:**

- Modify: `apps/admin/src/routes/_authed/_tenant/knowledge/context-engine.tsx`
- Test: `apps/admin/src/routes/_authed/_tenant/knowledge/-context-engine-sources.test.ts`

**Approach:**

- Import `DataTable` and `ColumnDef` into the route.
- Build a `ContextSourceRow` array from visible providers.
- Use no pagination (`pageSize={0}`) for the short source list, matching small Admin tables.
- Recommended columns:
  - Source: icon, display name, short description.
  - Family: provider family/source family badge.
  - Default: default/opt-in badge.
  - Status: available, disabled, live, waiting on API, and last-test summary when present.
  - Actions: configure button only for providers that currently support configuration.
- Keep row content compact and table-fixed enough to avoid card-like sprawl on desktop while still wrapping gracefully on mobile.
- Preserve the existing configuration dialog and call `openProviderConfig(provider)` from the table action.
- Preserve the current "Reset defaults" behavior, but reset to visible defaults only.

**Patterns to follow:**

- `apps/admin/src/components/ui/data-table.tsx` for the shared table API.
- `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.sub-agents.tsx` for small `pageSize={0}` lists with action columns.
- `apps/admin/src/routes/_authed/_tenant/people/index.tsx` for badges and compact identity cells.

**Test scenarios:**

- Happy path: row mapping includes source name, source family, default state, status label, and configure eligibility for configurable providers.
- Edge case: source descriptions remain bounded/truncated for long text such as "Fast compiled page lookup remains separate from raw page inspection."
- Edge case: MCP providers do not render a configure action unless the existing route supports it.
- Integration: rendering a live sub-agent row still allows opening the existing source-agent configuration details in the dialog.

**Verification:**

- The Sources tab shows one bordered table instead of cards.
- Live/configurable providers still open the existing configuration dialog.
- The table visually matches other Admin list surfaces in density, border radius, badges, and action placement.

---

- U3. **Remove redundant source-agent panel**

**Goal:** Delete the lower "Company Brain source agents" section and any dead imports/components created solely for it.

**Requirements:** R3, R5, R6; origin R31.

**Dependencies:** U1, U2.

**Files:**

- Modify: `apps/admin/src/routes/_authed/_tenant/knowledge/context-engine.tsx`
- Delete: `apps/admin/src/components/ContextEngineSubAgentPanel.tsx`
- Test: `apps/admin/src/routes/_authed/_tenant/knowledge/-context-engine-sources.test.ts`

**Approach:**

- Remove the `ContextEngineSubAgentPanel` import and JSX from `context-engine.tsx`.
- Confirm no other imports reference `ContextEngineSubAgentPanel`; delete the component if unused.
- Preserve `SubAgentConfigDetails` inside the route for live sub-agent configuration dialogs, because it is not the redundant list.
- Ensure provider result dialogs still show source-agent traces when a query result includes them.

**Patterns to follow:**

- `sourceAgentTrace` and `SourceAgentTraceSummary` in `context-engine.tsx` remain the diagnostic path for actual query traces.

**Test scenarios:**

- Happy path: source row helpers still expose live sub-agent details for dialog usage even after the panel is gone.
- Edge case: planned sub-agent providers are absent rather than summarized in a separate planned-count badge.
- Test expectation: no component-level test for the deleted panel if it has no surviving public API; TypeScript/build coverage should catch stale imports.

**Verification:**

- The phrase `Company Brain source agents` no longer appears in the rendered Sources route or source files.
- Query result provider-status dialogs continue to show provider hit counts, latency, errors/reasons, and trace summaries.

---

- U4. **Verify Admin behavior and visual fit**

**Goal:** Confirm the cleanup preserves the operator workflow and looks native inside the Admin shell.

**Requirements:** R1-R6.

**Dependencies:** U1, U2, U3.

**Files:**

- Modify: `apps/admin/src/routes/_authed/_tenant/knowledge/context-engine.tsx`
- Test: `apps/admin/src/routes/_authed/_tenant/knowledge/-context-engine-sources.test.ts`

**Approach:**

- Run focused admin tests for the new helpers.
- Run the Admin build/typecheck path relevant to the route.
- Start the Admin dev server with the existing ignored env file present when doing browser verification.
- Smoke `/knowledge/context-engine` in the browser:
  - planned ERP/CRM/support/catalog rows are absent;
  - source list is a datatable;
  - adapter dropdown excludes planned rows;
  - test query still returns provider status and top hits;
  - configure dialog still opens for visible configurable providers.

**Patterns to follow:**

- Admin dev-server setup guidance in `AGENTS.md`, including copying `apps/admin/.env` when verifying from a worktree.
- Existing Admin pages that use `DataTable` as the visual baseline.

**Test scenarios:**

- Happy path: helper tests pass with a fixture matching the screenshot's visible providers.
- Integration: browser smoke confirms no planned adapters and no redundant source-agent section in the first viewport.
- Error path: provider-load error still renders the existing error message outside the table.
- Edge case: loading state remains clear while providers are being fetched.

**Verification:**

- `@thinkwork/admin` tests covering the new helper pass.
- Admin build/typecheck for the route completes.
- Browser inspection confirms the screenshot's red-X areas are gone and the source catalog is now table-shaped.

---

## System-Wide Impact

- **Interaction graph:** This is Admin-only rendering and helper logic. It touches provider list presentation, adapter selection input, and configuration actions, but not the Context Engine API, router, runtime tools, or database schema.
- **Error propagation:** Existing provider-load and query errors should continue to render as they do today. Hidden planned seams should not turn into user-facing errors because they are filtered before table/dropdown rendering.
- **State lifecycle risks:** Filtering must use a memoized/pure derivation from the fetched provider list so selected-provider state does not retain hidden planned ids after refresh.
- **API surface parity:** No GraphQL, JSON-RPC, MCP, mobile SDK, or runtime contract changes.
- **Integration coverage:** Browser smoke is important because this is primarily a layout/interaction cleanup; helper tests alone will not prove visual density or dropdown behavior.
- **Unchanged invariants:** Context Engine remains provider-routed, partial provider failures remain provider-local statuses, and inert seams remain available for future live adapter work.

---

## Risks & Dependencies

| Risk                                                                              | Mitigation                                                                                                               |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Hiding planned providers accidentally hides a live sub-agent provider             | Gate only on `family === "sub-agent"` and `subAgent.seamState !== "live"`; add helper tests for live sub-agent inclusion |
| Adapter dropdown still includes planned providers after table cleanup             | Use the same visible-provider derivation for table and dropdown                                                          |
| Admin test query still invokes a hidden planned provider through backend defaults | Compare visible defaults against raw defaults; send explicit visible provider ids when they differ                       |
| Removing the source-agent panel loses diagnostic detail                           | Preserve query result provider-status cards/dialogs and `SourceAgentTraceSummary`                                        |
| Table becomes too dense or truncates useful context                               | Use a two-line Source cell with description and a separate status column; verify desktop and mobile widths in browser    |
| Backend inert seams are mistaken for deleted product scope                        | State clearly in code review and docs that this is Admin visibility only, not provider removal                           |

---

## Documentation / Operational Notes

- No public docs update is required unless the Admin docs currently show the planned card grid. If docs do mention planned source agents, update `docs/src/content/docs/applications/admin/knowledge.mdx` or `docs/src/content/docs/api/context-engine.mdx` in the implementation pass.
- PR description should call out that planned adapters remain registered in backend seams but are hidden from the operator catalog.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-29-company-brain-v0-requirements.md](../brainstorms/2026-04-29-company-brain-v0-requirements.md)
- Related requirements: [docs/brainstorms/2026-04-28-context-engine-requirements.md](../brainstorms/2026-04-28-context-engine-requirements.md)
- Related plan: [docs/plans/2026-04-29-004-feat-company-brain-v0-plan.md](2026-04-29-004-feat-company-brain-v0-plan.md)
- Related plan: [docs/plans/2026-04-29-003-feat-context-engine-operator-configuration-plan.md](2026-04-29-003-feat-context-engine-operator-configuration-plan.md)
- Related learning: [docs/solutions/best-practices/context-engine-adapters-operator-verification-2026-04-29.md](../solutions/best-practices/context-engine-adapters-operator-verification-2026-04-29.md)
- Related code: `apps/admin/src/routes/_authed/_tenant/knowledge/context-engine.tsx`
- Related code: `apps/admin/src/components/ContextEngineSubAgentPanel.tsx`
- Related code: `apps/admin/src/components/ui/data-table.tsx`
- Related code: `apps/admin/src/lib/context-engine-api.ts`
