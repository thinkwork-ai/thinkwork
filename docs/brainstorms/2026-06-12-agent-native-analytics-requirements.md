---
date: 2026-06-12
topic: agent-native-analytics
---

# Agent-Native Analytics Module

## Summary

An agent-native self-service analytics module for ThinkWork. Managers and operators ask the agent for a view; the agent pulls platform data and connected-plugin data through its existing MCP tools, materializes the results as snapshot datasets, and a native block/dashboard UI built on the ThinkWork component library renders them with user-applied filters. Phase one of the full native analytics vision: the registry ingestion spine later upgrades snapshots to continuously-fed data without UI rework.

---

## Problem Frame

Prospects repeatedly ask in sales conversations what self-service analytics ThinkWork offers, and today there is no credible answer beyond the fixed cost dashboard at `/settings/activity`. Two buyer needs surfaced: operators want to produce reports that aren't included out of the box, and managers are excited by a "mash up" of data from connected plugins into a single view — CRM pipeline next to task throughput next to agent activity.

A prior exploration (`docs/ideation/2026-06-10-001-executive-dashboard-registry-second-route.md`) settled on Metabase for executive dashboards but was parked pending the registry tracer bullet. The sales need is different in kind: it rewards an agent-native experience — the agent builds the view for you — over an embedded third-party BI tool, and it can't wait for the ingestion spine.

---

## Key Decisions

- **Agent-native authoring is the front door.** Self-service means asking the agent, not hand-editing SQL or composing blocks manually. LastMile's builder makes humans assemble dashboards; ThinkWork inverts that — the agent generates datasets and an initial dashboard, the user adjusts with filters. A hand-editing builder may come later; it is not v1.
- **Snapshots now, ingestion spine later (C → A).** v1 dashboards render over agent-materialized snapshot datasets produced from live MCP queries at build/refresh time. This delivers the mashup demo without building the parked registry/analytics-datastore spine. The block/dataset/dashboard model is designed so the spine later swaps in as a data foundation with no UI rework.
- **First-party module, not a plugin UI surface.** The application-plugins spec (`docs/brainstorms/2026-06-12-application-plugins-requirements.md`) only reserves UI surfaces in v1, so the analytics UI ships natively in `apps/web` while remaining compatible with future plugin packaging of any infrastructure pieces.
- **LastMile is an architectural reference, not a code port.** The stack mismatch (Next.js server actions + Drizzle direct vs. Vite SPA + GraphQL) and domain coupling (Clerk auth, `company_id` tenancy, LastMile-schema prompts) rule out forking. Patterns worth borrowing: block/dataset/dashboard composition, pivot SQL generation, SELECT-only query validation, chart config shape.
- **Metabase stays parked.** It solves analyst-grade BI, not the agent-native self-service story. Revisit if heavy analyst demand materializes.
- **Dashboards are personal with explicit share.** A dashboard a manager builds is private to them by default and shareable within the tenant. Tenant isolation is absolute.

---

## Actors

- A1. **Manager** — asks the agent for cross-plugin mashup views; consumes dashboards, applies filters, refreshes.
- A2. **Operator** — uses the same agent-mediated path to produce reports not included out of the box.
- A3. **ThinkWork agent** — authors datasets and dashboards: queries connected plugins and platform data via MCP tools, materializes snapshots, composes blocks.

---

## Requirements

**Authoring and data**

- R1. A user can request an analytics view conversationally; the agent generates the needed dataset(s) and an initial dashboard without manual dataset or chart configuration.
- R2. Datasets can draw on platform data (cost events, agent activity, threads) and on connected-plugin data reachable through the agent's existing MCP tools, including combinations of both in one dashboard.
- R3. Agent-generated datasets are materialized as point-in-time snapshots persisted by ThinkWork, so dashboards render without re-querying sources on every view.
- R4. Dashboards and their datasets are saved and revisitable; they are not transient chat artifacts.

**Viewing and interaction**

- R5. Dashboards render natively using the ThinkWork component library (`packages/ui` chart and table components), not embeds or iframes.
- R6. Users can apply filters to a dashboard without invoking the agent; filters operate over the snapshot data.
- R7. Every dashboard visibly states its data freshness (when its snapshots were taken).
- R8. A user can request a refresh, which re-runs the agent's data collection and replaces the snapshots; the dashboard definition is unchanged by refresh.

**Access and scoping**

- R9. Dashboards and datasets are tenant-scoped; no cross-tenant visibility under any sharing configuration.
- R10. A dashboard is private to its creator by default and can be explicitly shared with other users in the tenant.

**Forward compatibility**

- R11. The dataset model treats "how the data got here" as swappable: a snapshot-backed dataset can later be upgraded to a continuously-ingested one (registry spine) without changes to dashboards, blocks, or filters built on it.

---

## Key Flows

- F1. Manager mashup creation
  - **Trigger:** Manager asks the agent for a combined view, e.g. "show me pipeline by rep alongside task throughput."
  - **Steps:** Agent queries the relevant connected plugins and platform data via MCP tools; materializes snapshot datasets; composes an initial dashboard of blocks; saves it.
  - **Outcome:** Manager opens a native dashboard showing both sources with freshness stamps, adjusts it with filters.
  - **Covers:** R1, R2, R3, R4, R5, R6, R7.

- F2. Refresh
  - **Trigger:** User hits refresh on a stale dashboard.
  - **Steps:** Agent re-runs the same data collection; new snapshots replace old; freshness stamps update.
  - **Outcome:** Same dashboard, current data.
  - **Covers:** R7, R8.

- F3. Operator custom report
  - **Trigger:** Operator needs a report not included out of the box.
  - **Steps:** Operator describes the report to the agent; agent generates dataset and dashboard; operator filters and optionally shares it with the team.
  - **Outcome:** A saved, shareable report produced without engineering involvement.
  - **Covers:** R1, R4, R10.

---

## Acceptance Examples

- AE1. **Covers R7.** Given a dashboard whose snapshots were taken at 2:14 PM, when a user views it at 4:30 PM, then the dashboard displays the 2:14 PM freshness, not an implication of live data.
- AE2. **Covers R6.** Given a dashboard over a snapshot dataset, when a user applies a filter, then results narrow immediately from the snapshot without an agent invocation or source re-query.
- AE3. **Covers R9, R10.** Given a manager's unshared dashboard, when another user in the same tenant browses analytics, then that dashboard is not visible; after the manager shares it, it is — and it is never visible to any other tenant.
- AE4. **Covers R8, R11.** Given a saved dashboard, when its dataset is later backed by the ingestion spine instead of snapshots, then the dashboard, its blocks, and its filters continue working unchanged.

---

## Scope Boundaries

**Deferred for later**

- Drill-throughs into underlying row-level data.
- Scheduled or automatic refresh; v1 refresh is user-initiated.
- Hand-editing builder UI (manual dataset/SQL editing, block-by-block composition à la LastMile).
- Registry ingestion spine and live/continuous data — phase two; v1's model must not block it (R11).
- Plugin-packaged analytics UI surface — follows the plugin system's own UI-surface timeline.

**Outside this product's identity**

- Embedded third-party BI (Metabase remains parked; see `docs/ideation/2026-06-10-001-executive-dashboard-registry-second-route.md`).
- A general-purpose BI tool for external data ThinkWork doesn't already reach through plugins.

---

## Dependencies / Assumptions

- Connected-plugin data is reachable through existing MCP tools with enough query expressiveness to produce useful datasets (assumed from current LastMile CRM/tasks/P21 tool surface; verify per-plugin during planning).
- Refresh and authoring runs consume agent compute and LLM spend, which lands in `cost_events` like any agent activity; acceptable for v1 volumes.
- The application-plugins v1 (per `docs/brainstorms/2026-06-12-application-plugins-requirements.md`) proceeds independently; this module depends on its concepts but not its delivery.

---

## Outstanding Questions

**Resolve before planning**

- Which two data sources anchor the first sales demo (cost/activity plus which connected plugin)?

**Deferred to planning**

- Snapshot storage shape, retention, and size limits.
- The agent's dataset/dashboard authoring tool surface and query-safety validation (LastMile's SELECT-only validation is prior art).
- How shared dashboards surface in navigation.
- Snapshot semantics for filters that need data not captured at snapshot time (re-snapshot vs. disallow).

---

## Sources / Research

- `docs/ideation/2026-06-10-001-executive-dashboard-registry-second-route.md` — Metabase assessment, analytics-datastore concept, parked status.
- `docs/brainstorms/2026-06-12-application-plugins-requirements.md` — plugin packaging model; UI surfaces reserved in v1.
- `packages/database-pg/src/schema/cost-events.ts` and `packages/database-pg/graphql/types/costs.graphql` — existing platform data and query surface.
- `packages/ui/src/components/ui/chart.tsx` — existing Recharts wrapper; `apps/web/src/components/settings/SettingsAnalytics.tsx` — current fixed dashboard.
- LastMile repo (`lastmile/web-apps/apps/lmi`): block/dataset/dashboard model (`database/src/block`, `database/src/dashboard`, `database/src/dataset`), pivot SQL (`analytics/src/queries/get-pivoted-data.ts`), NL→SQL agent (`src/mastra/agents/analytics-agent.ts`). ~37k LOC, no tests; reference patterns only — stack and domain coupling preclude a port.
