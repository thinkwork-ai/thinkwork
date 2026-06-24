---
linear_issue: THNK-69
dispatcher_marker: "dispatcher:THNK-69:Ready to Work:Codex"
plan: "Linear document: Plan: Native Work Items"
requirements: "Linear document: Requirements: Native Work Items"
status: active
started_at: 2026-06-24T16:45:00Z
---

# THNK-69 Autopilot Status

## Scope

Implement native ThinkWork Work Items as the canonical task/work tracking
system. Threads remain collaboration surfaces; Work Items own task state.
Customer Onboarding is the first production producer and must preserve
`linked_tasks` compatibility during migration.

THNK-69 has no child issues, so the implementation units from the approved plan
are the execution units.

## Context Discovery

- Read `AGENTS.md`.
- Read Linear issue THNK-69 with description, labels, team, status history,
  documents, releases, customer needs, and relations.
- Read Linear comments, including dispatcher correction and the rolling
  `automation-ledger:THNK-69` comment.
- Read attached Linear documents:
  - `Requirements: Native Work Items`
  - `Plan: Native Work Items`
- Checked for child issues with `parentId=THNK-69`; none exist.
- Checked for blockers, blocked-by, related, duplicate, releases, customer
  needs, and attachments; none are active beyond the two embedded screenshots
  in the issue description.
- Searched `origin/main` for THNK-69, "Native Work Items", `work_item`, and
  `work_items`; no active implementation exists.
- Checked repo-local planning paths referenced by Linear. The named THNK-69
  brainstorm, ideation, and plan artifacts are not present on current
  `origin/main`, so the Linear documents are the authoritative plan artifacts
  for this worker.
- Read relevant `docs/solutions/` guidance named by the plan:
  - `docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md`
  - `docs/solutions/database-issues/feature-schema-extraction-pattern.md`
  - `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
  - `docs/solutions/integration-issues/spaces-urql-doc-cache-no-live-invalidation.md`

## Implementation Units

1. U1: Database substrate.
2. U2: Work Item API.
3. U3: Customer Onboarding producer.
4. U4: Agent tool contract.
5. U5: Web GraphQL and client model.
6. U6: Work Items route, views, and saved views.
7. U7: Thread and Space integration.
8. U8: Concepts, rollout, and cleanup.

The approved plan recommends PR slices that group tightly coupled units:

1. Substrate PR: U1 + U2 + generated clients.
2. Onboarding PR: U3.
3. UI PR: U5 + U6 + U7.
4. Tooling PR: U4.
5. Cleanup/docs PR: U8 and compatibility follow-ups.

## Linear State Changes

- 2026-06-24T16:45Z: Began implementation worker pass from fresh
  `origin/main` on branch `codex/thnk-69-native-work-items`.
- 2026-06-24T17:34Z: Substrate slice merged via PR #2925
  (`c8561cd04`). Duplicate PR #2926 was closed as superseded and cleaned up.
- 2026-06-24T17:35Z: Began onboarding producer slice from fresh `origin/main`
  on branch `codex/thnk-69-onboarding`.
- 2026-06-24T18:21Z: Onboarding producer slice merged via PR #2929
  (`2acb0dc3b`); remote branch deleted and local worktree cleanup verified.
- 2026-06-24T18:24Z: Began UI slice from the onboarding merge on branch
  `codex/thnk-69-web-work-items`.

## Unit Log

### Substrate PR: Database + API + Generated Clients

Objective: add native Work Item persistence, GraphQL schema, service-layer
mutations/queries, resolver coverage, and generated clients while keeping
existing UI behavior unchanged.

Branch:

- `codex/thnk-69-native-work-items`

Planned local verification:

- Focused database schema/migration tests.
- Focused API work item resolver/service tests.
- `pnpm schema:build`.
- Codegen for `apps/cli`, `apps/web`, `apps/mobile`, and `packages/api`.
- Package typechecks for touched workspaces.

Implementation notes:

- Added `work_item_statuses`, `work_items`, `work_item_thread_links`,
  `work_item_events`, `work_item_saved_views`, and `work_item_external_refs`.
- Added manual migration `0187_native_work_items.sql` with drift markers for
  all new tables, indexes, and CHECK constraints.
- Added canonical GraphQL Work Item schema, service-layer status/list/saved
  view mutations, resolver registration, and generated client type updates.
- Kept `linked_task` compatibility inert in
  `packages/api/src/lib/work-items/linked-task-compat.ts`; U3 will wire actual
  onboarding dual-write/read behavior through that stable module.
- `packages/api` does not currently declare a `codegen` script, so generated
  client regeneration was run for `apps/cli`, `apps/web`, and `apps/mobile`
  only.

Local verification:

- 2026-06-24T16:54Z: `pnpm schema:build` passed.
- 2026-06-24T16:54Z: `pnpm --filter thinkwork-cli codegen` passed.
- 2026-06-24T16:54Z: `pnpm --filter @thinkwork/web codegen` passed.
- 2026-06-24T16:54Z: `pnpm --filter @thinkwork/mobile codegen` passed.
- 2026-06-24T16:54Z: `pnpm --filter @thinkwork/database-pg typecheck` passed.
- 2026-06-24T16:54Z: `pnpm --filter @thinkwork/database-pg test -- __tests__/work-items-schema.test.ts` passed.
- 2026-06-24T16:54Z: `pnpm --filter @thinkwork/api typecheck` passed.
- 2026-06-24T16:54Z: `pnpm --filter @thinkwork/api test -- src/graphql/resolvers/work-items/workItems.resolver.test.ts` passed.
- 2026-06-24T16:56Z: `git diff --check` passed.
- 2026-06-24T16:56Z: `pnpm --filter thinkwork-cli typecheck` passed.
- 2026-06-24T16:57Z: `pnpm --filter @thinkwork/web typecheck` passed.

### Onboarding PR: Customer Onboarding Producer

Objective: make Customer Onboarding emit native Work Items while preserving
legacy `linked_tasks` compatibility during the migration.

Branch:

- `codex/thnk-69-onboarding`

Implementation notes:

- Added a Customer Onboarding Work Item adapter that creates native Work Items,
  thread links, external refs, events, default statuses, and linked-task metadata
  pointers.
- Kept existing linked-task rows as compatibility data and records the native
  Work Item ID back onto linked-task metadata.
- Changed Customer Onboarding goals to use `work_items` progress metadata.
- Updated progress rendering to prefer native Work Items when present and fall
  back to linked tasks for older threads.
- Synced native Work Item status when Customer Onboarding chat updates change or
  remove mapped linked tasks.
- Tenant-scoped linked-task compatibility pointer writes and filtered native
  progress reads to onboarding-origin Work Items.

Local verification:

- 2026-06-24T17:41Z: `pnpm install` completed in the fresh worktree. Optional
  `canvas` native build failed locally on Node 25 because `pkg-config`/pixman
  were unavailable, but install exited successfully.
- 2026-06-24T17:42Z: `pnpm --filter @thinkwork/api test -- src/lib/work-items/customer-onboarding.test.ts src/lib/spaces/customer-onboarding-workflow.test.ts src/lib/spaces/customer-onboarding-progress-md.test.ts src/lib/spaces/customer-onboarding-goal-md.test.ts src/lib/spaces/customer-onboarding-chat-updates.test.ts src/graphql/resolvers/spaces/startCustomerOnboarding.mutation.test.ts`
  passed: 6 files, 45 tests.
- 2026-06-24T17:42Z: `pnpm --filter @thinkwork/api typecheck` passed.
- 2026-06-24T17:48Z: Re-ran the focused onboarding/API tests after review
  edits; passed: 6 files, 45 tests.
- 2026-06-24T17:48Z: Re-ran `pnpm --filter @thinkwork/api typecheck`;
  passed.
- 2026-06-24T17:49Z: `pnpm --filter @thinkwork/api test` passed: 585 files,
  5,396 tests; 3 files/9 tests skipped for existing live-E2E gates.

Merge evidence:

- PR #2929: <https://github.com/thinkwork-ai/thinkwork/pull/2929>
- Merge commit: `2acb0dc3b feat(work-items): emit onboarding work items (#2929)`
- Cleanup: remote branch deleted; local branch/worktree removed after merge.

### UI PR: Web Work Items Route + Thread/Space Integration

Objective: add web-native Work Items discovery and triage surfaces, wire route
state/saved views/status movement, and make thread/Space context prefer native
Work Items with linked-task fallback.

Branch:

- `codex/thnk-69-web-work-items`

Implementation notes:

- Added Work Item web GraphQL documents and schema guards for list, thread,
  status, saved-view, update-status, save-view, and delete-view operations.
- Added Work Item display/filter helpers, including URL-backed due filters and
  saved-view serialization.
- Added `/work-items` under the shell with list and board views, Space/status/
  priority/due/required/blocked filters, saved views, focus refresh, inline
  status changes, and Work Items sidebar navigation.
- Added Space home Work Items summary metrics and a Space-scoped board link.
- Updated thread detail progress context to query `threadWorkItems`, prefer
  native Work Items when present, and fall back to progress markdown/linked
  tasks for legacy threads.
- Added targeted helper and route tests for Work Item summaries, filters,
  sidebar navigation, thread progress integration, Space summary metrics, and
  GraphQL/schema validation.

Local verification:

- 2026-06-24T18:40Z: `pnpm install` completed in the UI worktree. Optional
  `canvas` native build failed locally on Node 25 because `pkg-config`/pixman
  were unavailable, but install exited successfully.
- 2026-06-24T18:40Z: `pnpm --filter @thinkwork/web test -- src/components/work-items/work-item-display.test.ts src/components/work-items/work-item-filters.test.ts src/lib/graphql-queries.test.ts src/lib/graphql-queries.schema.test.ts src/components/shell/ChatSidebar.test.tsx`
  passed: 5 files, 70 tests.
- 2026-06-24T18:41Z: `pnpm --filter @thinkwork/web build` passed and
  regenerated `apps/web/src/routeTree.gen.ts`; build emitted existing sourcemap
  and chunk-size warnings only.
- 2026-06-24T18:42Z: `pnpm --filter @thinkwork/web typecheck` passed.
- 2026-06-24T18:48Z: `pnpm --filter @thinkwork/web test -- src/components/work-items/WorkItemsPage.test.ts src/components/workbench/SpacesThreadDetailRoute.test.tsx src/routes/_authed/_shell/-spaces-spaceId.test.ts`
  passed: 3 files, 41 tests.
- 2026-06-24T18:48Z: `pnpm --filter @thinkwork/web typecheck` passed after
  thread/Space integration changes.
