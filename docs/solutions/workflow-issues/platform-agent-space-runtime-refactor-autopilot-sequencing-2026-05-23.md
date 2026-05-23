---
title: "Platform-agent Space runtime refactors need staged migration gates"
date: 2026-05-23
category: workflow-issues
module: "platform-agent-runtime"
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - "Refactoring runtime or configuration identity across database, GraphQL, UI, CLI, and deployed runtime surfaces"
  - "Retiring generated GraphQL schema fields where clients cannot typecheck until producer and consumer removals land together"
  - "Collapsing many persisted runtime/config rows into a smaller canonical model with historical foreign keys"
  - "Running a multi-PR autopilot sequence that must preserve operational truth across migrations, CI failures, and runbooks"
related_components:
  - database
  - documentation
  - tooling
  - assistant
tags:
  - platform-agent
  - space-runtime-overrides
  - schema-migration
  - graphql-codegen
  - destructive-migration
  - migration-drift
  - operator-runbook
  - autopilot
---

# Platform-agent Space runtime refactors need staged migration gates

## Context

Plan B collapsed Thinkwork from multiple per-agent runtime/config identities to
one tenant platform agent with Space-scoped runtime overrides. The refactor
touched Aurora schema, hand-rolled migrations, GraphQL schema and generated
clients, admin routes, CLI commands, runtime invocation payloads, email routing,
workspace rendering, and operator runbooks.

The completed autopilot sequence merged:

- [#1570](https://github.com/thinkwork-ai/thinkwork/pull/1570): additive schema
  groundwork for `agents.is_platform_default` and nullable Space runtime
  override columns.
- [#1572](https://github.com/thinkwork-ai/thinkwork/pull/1572): one-time
  `migrate-collapse-agents.ts` script, S3 workspace folding, FK repointing,
  audit events, and focused tests.
- [#1573](https://github.com/thinkwork-ai/thinkwork/pull/1573): tenant platform
  agent resolver and `resolveAgentRuntimeConfig(spaceId)` overlay.
- [#1575](https://github.com/thinkwork-ai/thinkwork/pull/1575): policy
  rendering moved into `workspace-renderer`; old turn-context renderer removed.
- [#1576](https://github.com/thinkwork-ai/thinkwork/pull/1576): grouped U5/U7
  GraphQL, CLI, admin `/agents`, `/tenant-agent`, and Space runtime override UI
  replacement after codegen proved the units were too coupled to split.
- [#1577](https://github.com/thinkwork-ai/thinkwork/pull/1577): per-agent
  vanity/default email fallback retired; outbound email now requires active
  Space context.
- [#1578](https://github.com/thinkwork-ai/thinkwork/pull/1578): gated
  `space_agent_assignments` table drop after consumer rewrites landed.
- [#1579](https://github.com/thinkwork-ai/thinkwork/pull/1579): collapse-agents
  operator runbook and `threads.agent_id` semantic comment.
- [#1580](https://github.com/thinkwork-ai/thinkwork/pull/1580): final
  `docs/plans/autopilot-status.md` truth-state update after the implementation
  PR merged.

Session history confirmed this was not a straight-line plan execution: U5/U7 had
to be grouped after codegen failed, the collapse migration needed repair
behavior after a missed FK surfaced, and the status ledger needed a final
status-only PR because the U8 PR necessarily merged with "ready to squash merge"
wording still present. (session history)

## Guidance

Use a staged collapse when retiring identity-bearing records.

1. **Add the new invariant before removing the old one.** Land additive schema
   first: a canonical/default marker plus typed override fields. For Plan B,
   that was `agents.is_platform_default` and nullable Space override columns.

2. **Centralize effective runtime resolution.** Runtime callers should ask a
   single resolver for effective config by Space. Plan B used
   `resolveAgentRuntimeConfig(spaceId)` so callers did not each reimplement
   "platform default plus Space overlay."

3. **Make the data migration dry-runnable, transactional, idempotent, and
   repairable.** The migration must report planned S3 copies and FK repoints
   before apply, perform DB repoints per tenant transaction, treat repeated S3
   copies safely, return `noop` when complete, and repair leftover archived-agent
   references without duplicating audit events.

4. **Let codegen define whether API and UI removal can split.** Pure
   substrate-first sequencing is best when each PR can build independently. But
   generated GraphQL clients create a hard boundary: if deleting producer schema
   fields makes admin/CLI/mobile generated documents invalid, group the producer
   deletion and dependent consumer retirement in one PR.

5. **Gate destructive drops on fresh consumer surveys.** Drop tables only after
   a new source grep proves every live consumer moved. Plan B dropped
   `space_agent_assignments` only after runtime, API, CLI, admin, and migration
   paths no longer needed it.

6. **Treat migration drift failures as evidence, not noise.** When CI's
   migration drift precheck fails because the target environment still has an
   intentionally dropped object, apply the scoped manual migration to that
   environment, verify scoped drift, and rerun CI. Do not weaken the drift gate.

7. **Close with an operator runbook and status truth update.** A platform refactor
   is not complete when the code PR merges if operators still need dry-run/apply,
   conflict resolution, verification SQL, rollback notes, or user-visible change
   guidance.

## Why This Matters

Runtime identity refactors are deceptively broad. The database row may look like
the object being removed, but background jobs, retry queues, email tokens,
threads, workspace prefixes, generated clients, and operator mental models all
carry the old identity.

Plan B’s target invariant is much easier to reason about:

```text
tenant -> one platform agent
space -> optional runtime overrides
effective runtime config = platform default + space overlay
```

That invariant only becomes safe if historical rows are repointed, stale
surfaces are retired, and operators know how to verify each deployed stage. A
single destructive PR would have mixed schema, data movement, runtime behavior,
UI deletion, and docs into one rollback-hostile change.

The actual sequence caught several risks before they became production defects:

- Splitting U5 and U7 failed because GraphQL schema deletion broke admin and CLI
  codegen until consumers moved in the same PR. (session history)
- The first migration apply attempt found an FK table without `tenant_id`
  (`agent_operation_leases`); the DB transaction rolled back and the script was
  fixed before reapply. (session history)
- A later FK survey found `retry_queue.agent_id`; repair mode repointed 2 dev
  rows without emitting duplicate audit events. (session history)
- U1b CI caught dev drift for `space_agent_assignments`; applying
  `0125_drop_space_agent_assignments.sql` to dev and rerunning the scoped drift
  reporter cleared the gate.
- The final ledger state was corrected by PR #1580 after #1579 merged, keeping
  `docs/plans/autopilot-status.md` useful for the next session.

## When to Apply

- A refactor collapses multiple persisted actors, workers, agents, computers, or
  runtime identities into one canonical row.
- Runtime variation should become contextual configuration, such as Space,
  requester, project, or environment overrides.
- The old identity appears in foreign keys, queues, tokens, generated GraphQL
  clients, admin UI, CLI commands, or email addresses.
- A plan calls for destructive schema removal after several earlier consumer
  rewrites.
- CI migration-drift checks run against a shared dev/staging database that may
  not yet have hand-rolled migrations applied.
- A long autopilot sequence needs an explicit repo-local ledger to survive
  context compactions and PR handoffs.

Do not apply this exact pattern when the old rows represent truly independent
authorization principals. In that case, collapsing identity can become a
security change, not just a runtime-config simplification.

## Examples

### Dry-run, apply, repair, then dry-run again

Plan B’s runbook records the real script shape:

```bash
pnpm --filter @thinkwork/api exec tsx scripts/migrate-collapse-agents.ts --dry-run --workspace-bucket "$WORKSPACE_BUCKET"
pnpm --filter @thinkwork/api exec tsx scripts/migrate-collapse-agents.ts --apply --workspace-bucket "$WORKSPACE_BUCKET"
pnpm --filter @thinkwork/api exec tsx scripts/migrate-collapse-agents.ts --apply --workspace-bucket "$WORKSPACE_BUCKET"
pnpm --filter @thinkwork/api exec tsx scripts/migrate-collapse-agents.ts --dry-run --workspace-bucket "$WORKSPACE_BUCKET"
```

The second `--apply` is intentional when a tenant is already collapsed but
leftover archived-agent references still exist. The healthy ending is `noop` or
`skipped` for every tenant and zero conflicts.

The verified dev sequence reported:

```text
dry-run: 1 tenant, 5 non-canonical agents, 149 planned workspace copies, 0 conflicts
apply: 5 agents archived, 6 audit events emitted
repair apply: 2 retry_queue.agent_id rows repointed
post-apply dry-run: noop
```

### Group producer and consumer removal when codegen forces it

The initial U5 path deleted per-agent GraphQL fields while admin and CLI
documents still referenced them. That made codegen fail before the dependent UI
retirement could land. The safe correction was to pull U7 forward into the same
PR:

```text
remove old GraphQL agent surfaces
+ add tenantAgent/updateTenantAgent/setSpaceRuntimeOverrides
+ stub retired CLI agent commands
+ delete admin /agents routes
+ add /tenant-agent and Space runtime override UI
= one buildable PR
```

This is the main caveat to the usual substrate-first pattern: generated clients
can make producer deletion and consumer retirement inseparable.

### Gate destructive drops with a source survey

Before U1b dropped `space_agent_assignments`, the branch reran a fresh source
survey across API, Lambda, admin, CLI, and GraphQL schema surfaces:

```bash
rg "space_agent_assignments|spaceAgentAssignments|setSpaceAgentAvailability" \
  packages/api/src packages/lambda apps/cli/src apps/admin/src packages/database-pg/graphql/types
```

Only after live consumers were gone did the destructive migration land. CI then
proved dev drift still existed, so the drop migration was applied to dev and
verified with the scoped drift reporter before rerunning checks.

### Preserve semantic breadcrumbs after the collapse

Some columns keep old names after the model changes. U8 added a comment at the
`threads.agent_id` filter branch clarifying that post-migration
`threads.agent_id` points to the tenant platform agent, so historical per-agent
filters no longer partition threads by retired agent identity.

That kind of small code comment prevents future agents from inferring that the
old per-agent model is still alive just because a column name remains.

## Related

- [docs/runbooks/collapse-agents-migration.md](../../runbooks/collapse-agents-migration.md)
  — operator dry-run, conflict review, apply, verification SQL, and rollback
  notes for the data migration.
- [docs/plans/autopilot-status.md](../../plans/autopilot-status.md) — PR-by-PR
  ledger for the Plan B autopilot sequence.
- [survey-before-applying-parent-plan-destructive-work-2026-04-24.md](./survey-before-applying-parent-plan-destructive-work-2026-04-24.md)
  — the destructive-work consumer-survey rule used for the
  `space_agent_assignments` drop.
- [manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md](./manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md)
  — the manual migration drift pattern used when CI proved dev still had the
  dropped table.
- [inert-first-seam-swap-multi-pr-pattern-2026-05-08.md](../architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md)
  — substrate-first sequencing pattern; Plan B adds the generated-client caveat
  where tightly coupled retirements must group.
- [routine-rebuild-closeout-checkpoints-2026-05-03.md](../developer-experience/routine-rebuild-closeout-checkpoints-2026-05-03.md)
  — closeout/status-ledger discipline for multi-PR arcs.
