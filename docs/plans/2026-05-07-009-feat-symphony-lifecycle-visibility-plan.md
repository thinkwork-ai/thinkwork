---
title: "feat: Symphony lifecycle visibility"
status: active
created: 2026-05-07
---

# feat: Symphony lifecycle visibility

## Problem

The Linear `symphony` checkpoint now works end to end, but operators still need SQL to see the full chain: connector execution, `connector_work` Computer task, Computer-owned thread, managed-agent `thread_turn`, and `computer_delegations` lifecycle status. The Symphony admin page already lists connectors and recent connector executions, but the Runs view does not expose the downstream lifecycle artifacts that prove delegation is healthy.

## Scope

- Add a read-only GraphQL lifecycle query for recent connector runs.
- Replace the Symphony Runs table data source with the lifecycle query.
- Keep existing connector setup/admin behavior unchanged.
- Preserve single-line, fixed-layout table rows with truncated long IDs/text and no horizontal scrolling.
- Use the existing admin tab style already used by Computer detail pages.

## Out Of Scope

- No new connector dispatch behavior, retries, or mutation semantics.
- No schema migration; the needed data already lives in existing tables/json payloads.
- No deep run detail drawer; this PR should keep the first visibility pass compact.

## Design Notes

Visual thesis: extend the existing dense dark admin surface with compact status badges and clipped monospaced identifiers, so lifecycle health reads at a glance without adding chrome.

Content plan: keep the page header tabs as `Connectors` and `Runs`; the Runs tab shows one row per connector execution with state, external ref, connector, Computer task, delegation, managed-agent turn, linked thread, and latest metadata.

Interaction plan: refresh and connector filters stay in the Runs toolbar; thread IDs use a compact ghost button that navigates to the existing thread route; long values truncate in place with full values available through native titles where useful.

## Existing Patterns

- `apps/admin/src/routes/_authed/_tenant/symphony.tsx` already owns the Symphony page, tab placement, connector table, and current execution table.
- `apps/admin/src/components/ui/data-table.tsx` supports `allowHorizontalScroll={false}` and `table-fixed` colgroups for clipped rows.
- `apps/admin/src/routes/_authed/_tenant/computers/$computerId.tsx` shows the tab style to follow with `Tabs`, `TabsList`, `TabsTrigger`, and TanStack Router links/search state.
- `packages/database-pg/graphql/types/connectors.graphql` and `packages/api/src/graphql/resolvers/connectors/query.ts` own connector read contracts and tenant scoping.
- `packages/api/src/graphql/resolvers/connectors/query.test.ts` is the focused resolver test file for connector read behavior.
- `apps/admin/src/lib/graphql-queries.ts` is the admin query source consumed by codegen.

## Implementation Units

### U1: GraphQL lifecycle read contract

**Goal:** Add a first-class read model for the Symphony Runs tab without changing persistence.

**Files**

- Modify: `packages/database-pg/graphql/types/connectors.graphql`
- Modify: `packages/api/src/graphql/resolvers/connectors/query.ts`
- Modify: `packages/api/src/graphql/resolvers/connectors/index.ts`
- Test: `packages/api/src/graphql/resolvers/connectors/query.test.ts`

**Approach**

- Add `ConnectorRunLifecycle` plus nested `ConnectorRunComputerTask`, `ConnectorRunDelegation`, and `ConnectorRunThreadTurn` types.
- Add `connectorRunLifecycles(connectorId: ID, limit: Int, cursor: String): [ConnectorRunLifecycle!]!`.
- Tenant-scope by resolved caller tenant exactly like `connectorExecutions`.
- Use `connector_executions` as the root row. Join downstream artifacts by existing durable links:
  - `computer_tasks.id = outcome_payload->>'computerTaskId'`
  - `computer_delegations.task_id = computer_tasks.id`
  - `thread_turns.id = computer_delegations.result->>'threadTurnId'` or `thread_turns.id = computer_delegations.output_artifacts->>'threadTurnId'`
- Return null nested objects when a run has not reached a downstream stage yet.

**Test Scenarios**

- Lists lifecycle rows for the caller tenant and maps snake_case fields into nested camelCase objects.
- Applies connector tenant visibility before filtering to a connector ID.
- Returns an empty list for a cross-tenant connector ID.
- Includes null nested task/delegation/turn fields for partial or failed-before-dispatch executions.
- Clamps limit to the existing resolver maximum.

### U2: Admin query/codegen

**Goal:** Make the admin client consume the lifecycle query with generated types.

**Files**

- Modify: `apps/admin/src/lib/graphql-queries.ts`
- Generated: `apps/admin/src/gql/graphql.ts`
- Generated: `apps/admin/src/gql/gql.ts`
- Generated as needed by codegen: API/client schema artifacts

**Approach**

- Add `ConnectorRunLifecyclesQuery` to `apps/admin/src/lib/graphql-queries.ts`.
- Include fields needed by the compact run table: execution ids/state/ref/timestamps, connector id/name/type, task id/status/output/error, delegation id/status/result/error/completedAt, thread turn id/status/error/resultJson/timestamps, and thread id/message id from payload-backed links.
- Run schema/codegen after SDL changes.

**Test Scenarios**

- Generated types include the lifecycle query and nested result fields.
- Typecheck catches any mismatched enum/name casing.

### U3: Symphony Runs table UI

**Goal:** Replace SQL-only debugging with a single compact lifecycle table.

**Files**

- Modify: `apps/admin/src/routes/_authed/_tenant/symphony.tsx`
- Modify or create helper tests if logic moves out: `apps/admin/src/lib/connector-admin.ts`

**Approach**

- Switch Runs data source from `ConnectorExecutionsListQuery` to `ConnectorRunLifecyclesQuery`.
- Keep the current Runs toolbar filters, refresh button, and cancelled toggle.
- Render fixed-width single-line columns:
  - State
  - External ref
  - Connector
  - Task
  - Delegation
  - Turn
  - Thread
  - Updated/started
- Use status badges for each lifecycle segment and truncated monospaced IDs for identifiers.
- Thread button navigates to `/threads/$threadId`.
- Derive visible run counts from lifecycle rows rather than execution rows.

**Test Scenarios**

- Typecheck proves the table consumes generated lifecycle types.
- Browser verification at desktop width shows no horizontal scroll and no multi-line rows.
- Browser verification at a narrower viewport still clips/truncates columns instead of wrapping.

### U4: Verification and release

**Goal:** Ship via normal workflow and prove the page loads against deployed data.

**Files**

- No feature files expected beyond U1-U3.

**Approach**

- Run focused API resolver tests.
- Run admin codegen/typecheck and normal repo checks.
- Use browser verification on the Symphony page after starting the admin dev server from this worktree.
- Open PR, monitor CI, merge when green, and let deploy complete.

**Test Scenarios**

- `pnpm --filter @thinkwork/api test -- src/graphql/resolvers/connectors/query.test.ts`
- `pnpm --filter @thinkwork/admin codegen`
- `pnpm --filter @thinkwork/admin typecheck`
- Browser screenshot confirms Runs tab table is readable, single-line, and no horizontal scroll is visible.

## Risks

| Risk                                              | Mitigation                                                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON-link joins are brittle if payload keys drift | Keep links read-only, null-safe, and anchored to the keys already proven by the checkpoint: `computerTaskId`, `threadId`, `messageId`, and `threadTurnId`. |
| UI becomes too wide again                         | Use `table-fixed`, `allowHorizontalScroll={false}`, fixed column sizes, `truncate`, and compact cell renderers only.                                       |
| GraphQL query overjoins cross-tenant data         | Root every query at tenant-scoped `connector_executions` and join only matching tenant/task rows. Test connector visibility and tenant scoping.            |

## Done

- Symphony Runs tab shows lifecycle status without SQL.
- Table rows stay single-line with truncated long values and no horizontal scroll.
- Thread links open the Computer-owned thread.
- Tests and codegen pass.
- PR is merged and deployed.
