---
title: "Collapse Agents Migration"
date: 2026-05-22
status: draft
---

# Collapse Agents Migration

This runbook operates the one-time migration that collapses each tenant from
multiple durable agent rows to one platform-default tenant agent. The migration
folds non-canonical S3 workspaces into the canonical agent workspace, repoints
agent foreign keys, archives non-canonical agents, and emits audit events.

## Scope

- Applies to the `migrate-collapse-agents.ts` script in `packages/api`.
- Runs per deployed stage: first dev, then production after dev verification.
- Does not run automatically in CI.
- Does not bypass the normal production change process or manually deploy code.
- Does not drop `space_agent_assignments`; that table is removed by the later
  schema migration after consumers have moved to the platform agent and Space
  runtime overrides.

## User-Visible Changes

- Operators configure the tenant platform agent at `/tenant-agent`; legacy
  `/agents/*` routes redirect there.
- Space-specific runtime settings live on Space Configuration. A null Space
  override inherits the tenant platform agent setting.
- Per-agent vanity addresses such as `<slug>@agents.thinkwork.ai` are retired.
  Space mail uses `tenantSlug.spaceSlug@agents.thinkwork.ai`.
- Legacy per-agent inbound mail receives the retirement notice added by the
  email cutover instead of waking an archived agent.
- After migration, `threads.agent_id` points to the tenant platform agent.
  Filters for a historical per-agent ID no longer distinguish old agents once
  rows are repointed to the canonical platform agent.

## Preconditions

- The schema migration adding `agents.is_platform_default` and Space runtime
  override columns has deployed to the target stage.
- The target stage has the U2 migration script code deployed or available from
  the reviewed branch.
- The workspace bucket name is known. The script defaults to
  `WORKSPACE_BUCKET`, then `AGENTCORE_FILES_BUCKET`; pass
  `--workspace-bucket` when in doubt.
- Operators can obtain the target stage database connection using the normal
  repo tooling and stage credentials.
- S3 workspace prefixes are backed up or versioned before production apply.
  Treat database restore plus S3 backup restore as the production rollback path
  for the data collapse.

## Consumer Survey

Before applying any stage, repeat the consumer survey from the implementation
branch and confirm no live callers still depend on per-Space agent assignments
or retired per-agent mutations:

```bash
rg "space_agent_assignments|spaceAgentAssignments|setSpaceAgentAvailability|claimVanityEmailAddress|releaseVanityEmailAddress|toggleAgentEmailChannel|updateAgentEmailAllowlist|agentEmailCapability|createAgent|deleteAgent|updateAgentRuntime|updateAgentStatus|setAgentBudgetPolicy|setAgentCapabilities|setAgentSkills" packages/api/src packages/lambda apps/cli/src apps/admin/src packages/database-pg/graphql/types
```

The broad string survey currently has expected residual hits for helper names,
comments, and legacy non-GraphQL handler text, including:

- `packages/api/src/graphql/resolvers/tenant-agent/loaders.ts`
  `createAgentLoaders`
- `packages/api/src/graphql/resolvers/customize/*` comments that refer to the
  old `setAgentSkills` log shape or projection source
- `packages/lambda/admin-ops-mcp.ts` `routineOps.createAgentRoutine`
- `packages/api/src/handlers/agents.ts` legacy REST handler text

The narrower retired GraphQL/admin/CLI survey should have no live hits:

```bash
rg "createAgent|setAgentSkills|updateAgentRuntime|setSpaceAgentAvailability|claimVanityEmailAddress|releaseVanityEmailAddress|toggleAgentEmailChannel|updateAgentEmailAllowlist|agentEmailCapability|updateAgentStatus|setAgentBudgetPolicy|setAgentCapabilities" packages/database-pg/graphql/types packages/api/src/graphql/resolvers apps/admin/src apps/cli/src
```

Expected result after the cutover PRs: only comments or helper identifiers, no
live retired GraphQL schema, resolver, admin, or CLI command surfaces. Stop if
this finds active callers that still require per-agent identity.

## Dry Run

Run dry-run first for the whole stage:

```bash
pnpm --filter @thinkwork/api exec tsx scripts/migrate-collapse-agents.ts --dry-run --workspace-bucket "$WORKSPACE_BUCKET"
```

For a single tenant rehearsal:

```bash
pnpm --filter @thinkwork/api exec tsx scripts/migrate-collapse-agents.ts --dry-run --tenant-id "$TENANT_ID" --workspace-bucket "$WORKSPACE_BUCKET"
```

Review every tenant report:

- `status: "dry-run"` means the tenant has planned S3 copies and DB repoints.
- `status: "noop"` means the tenant is already collapsed.
- `status: "skipped"` means the tenant has no non-archived agents to migrate.
- `status: "conflict"` means no DB writes will be applied for that tenant.
- `plannedWorkspaceCopies` should be plausible for the number of non-canonical
  agent workspaces.
- `canonicalPrefixObjectCount` should be reviewed for unexpectedly large
  canonical workspaces before enabling runtime reads.

## Conflict Review

Do not run `--apply` while any tenant reports S3 workspace conflicts.

For each conflict, inspect the reported source and destination keys under the
tenant workspace prefix. Resolve by one of these conservative choices:

- Keep canonical content and move the non-canonical object to a preserved
  subagent path.
- Rename the non-canonical object before rerunning dry-run.
- Delete only confirmed duplicate content.

After resolution, rerun dry-run for the affected tenant. Continue only when the
tenant reports no conflicts.

## Apply

Apply dev first:

```bash
pnpm --filter @thinkwork/api exec tsx scripts/migrate-collapse-agents.ts --apply --workspace-bucket "$WORKSPACE_BUCKET"
```

Apply production only after dev verification passes and the production change is
approved through the normal process:

```bash
pnpm --filter @thinkwork/api exec tsx scripts/migrate-collapse-agents.ts --apply --workspace-bucket "$WORKSPACE_BUCKET"
```

The script is idempotent. If a tenant is already collapsed but an archived-agent
foreign key remains, a later `--apply` repairs the leftover references without
emitting duplicate archive audit events. Re-run dry-run after apply; the desired
steady state is `noop` for already-collapsed tenants.

## Verification

Run these SQL checks against the target stage after apply:

```sql
SELECT
  tenant_id,
  count(*) FILTER (WHERE is_platform_default IS TRUE) AS platform_defaults
FROM agents
GROUP BY tenant_id
HAVING count(*) FILTER (WHERE is_platform_default IS TRUE) != 1;
```

Expected: zero rows.

```sql
SELECT count(*) AS active_nondefault_agents
FROM agents
WHERE status <> 'archived'
  AND is_platform_default IS NOT TRUE;
```

Expected: `0`.

```sql
SELECT count(*) AS thread_missing_agent
FROM threads t
LEFT JOIN agents a ON a.id = t.agent_id
WHERE t.agent_id IS NOT NULL
  AND a.id IS NULL;
```

Expected: `0`.

```sql
SELECT count(*) AS threads_not_on_platform_agent
FROM threads t
JOIN agents a ON a.id = t.agent_id
WHERE a.is_platform_default IS NOT TRUE;
```

Expected: `0`.

```sql
SELECT count(*) AS retry_queue_archived_agent_refs
FROM retry_queue rq
JOIN agents a ON a.id = rq.agent_id
WHERE a.status = 'archived';
```

Expected: `0`.

```sql
SELECT to_regclass('public.space_agent_assignments') IS NULL AS assignments_table_dropped;
```

Expected after the table-drop migration deploys: `true`. Before that deploy,
`false` is acceptable.

Also rerun:

```bash
pnpm --filter @thinkwork/api exec tsx scripts/migrate-collapse-agents.ts --dry-run --workspace-bucket "$WORKSPACE_BUCKET"
```

Expected: every tenant is `noop` or `skipped`, with no `conflict` reports.

## Rollback

Before the later table-drop migration, schema rollback is available through:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0123_single_platform_agent_and_overrides_rollback.sql
```

After `space_agent_assignments` has been dropped, its schema rollback is:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0125_drop_space_agent_assignments_rollback.sql
```

Those schema rollbacks do not reconstruct the pre-collapse per-agent data
topology. For production data rollback, restore Aurora and the affected S3
workspace prefixes from the backup taken before apply. Do not hand-edit
production rows to recreate multiple active agents.

## Dev Status

Dev has already been exercised with this sequence:

- Dry-run reported 1 tenant, 5 non-canonical agents, 149 planned workspace
  copies, and 0 conflicts.
- Apply archived 5 agents and emitted 6 audit events.
- A repair apply repointed 2 leftover `retry_queue.agent_id` references.
- Post-apply verification returned one platform default, zero active
  non-default agents, zero missing thread agents, and zero archived retry queue
  references.
- A final dry-run returned `noop`.
