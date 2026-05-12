---
title: "fix(computer): sync desired workspace skills from S3 into EFS"
type: fix
status: active
date: 2026-05-12
origin: docs/plans/2026-05-12-001-refactor-computer-runbooks-as-agent-skills-plan.md
---

# fix(computer): sync desired workspace skills from S3 into EFS

## Problem Frame

Computer runbook-capable skills are now standard Agent Skills assigned by
`workspace/skills/<slug>/SKILL.md` in a Computer template workspace. That is the
right source model, but it exposed a substrate mismatch: Computer workspaces are
live EFS, while template/catalog skills live in S3. An existing Computer such as
Marco can therefore show an empty live `skills/` folder even though the catalog
contains the converted runbook skills and routing expects assigned skills.

The fix should make S3 the control-plane desired state for template/catalog
workspace files and EFS the live materialized Computer workspace. The API should
not mutate EFS directly. Instead, it should enqueue Computer runtime tasks that
copy the relevant S3 files into EFS. This follows the existing Computer task
surface (`workspace_file_list`, `workspace_file_read`, `workspace_file_write`,
`workspace_file_delete`) and avoids adding a fragile direct Lambda-to-EFS path.

## Requirements

- R1. Platform-default Computers must get the starter runbook-capable skills
  (`crm-dashboard`, `research-dashboard`, `map-artifact`) without manual EFS
  edits.
- R2. The sync path must use Computer runtime tasks to materialize S3 desired
  state into EFS; no API-side direct EFS mutation.
- R3. Runbook routing must not silently see an empty assignment set for a
  platform-default Computer just because the template workspace has not yet been
  materialized.
- R4. The live Computer workspace UI should be able to show the materialized
  `skills/<slug>/SKILL.md` folders after the runtime processes the sync task.
- R5. Custom Computer templates remain opt-in: do not globally install starter
  runbook skills into every tenant-authored template unless the operator chooses
  them.
- R6. The sync must be idempotent and retry-safe, so repeated heartbeats or
  routing attempts do not create duplicate work or overwrite unrelated files
  outside the intended skill directories.

## Existing Patterns

- `packages/api/src/lib/computers/workspace-seed.ts` already enqueues
  `workspace_file_write` tasks to copy S3 files into Computer EFS for migrated
  source Agent workspaces.
- `packages/api/src/lib/computers/tasks.ts` validates and idempotently enqueues
  Computer tasks.
- `packages/computer-runtime/src/task-loop.ts` already executes
  `workspace_file_list`, `workspace_file_read`, `workspace_file_write`, and
  `workspace_file_delete` against the mounted EFS workspace.
- `packages/api/src/lib/runbooks/skill-discovery.ts` discovers assigned
  runbook-capable skills from the active Computer template workspace.
- `packages/api/src/handlers/skills.ts` already copies catalog skill files into
  template S3 workspaces for operator-driven installs.

## Key Decisions

- **Use S3 desired state plus queued Computer tasks as the materialization
  channel.** The API will first ensure the tenant's platform-default template
  S3 workspace contains the starter skill files, then enqueue bounded
  `workspace_file_write` tasks for the live Computer. This keeps EFS access
  inside the Computer runtime while preserving `workspace/skills/<slug>/SKILL.md`
  as the assignment truth.
- **Seed only the platform-default Computer template automatically.** The
  default template is a product starter. Tenant-authored templates continue to
  use Admin's Add-from-catalog flow.
- **Materialize full skill directories, not only `SKILL.md`.** Runbook-capable
  skills need `references/` and `assets/` for routing, confirmation, output
  shaping, and runtime execution context.
- **Make the first pass pull-based and idempotent.** Routing and heartbeat can
  call a helper that ensures the default runbook skill files are present in
  template S3 and have been enqueued for EFS materialization.
  A later event-driven S3 notification can build on the same helper if needed.
- **Avoid deletion sync for starters in this fix.** The immediate bug is missing
  starter skills on default Computers. Operator-driven removal from custom
  templates should remain explicit; destructive delete propagation needs a
  separate product decision.

## Implementation Units

### U1. Add default runbook skill materialization helper

**Goal:** Copy starter runbook-capable skill directories from catalog S3 into
the tenant's platform-default Computer template S3 workspace, then into the
Computer's live EFS workspace via queued tasks.

**Requirements:** R1, R2, R4, R6

**Files:**

- Modify: `packages/api/src/lib/computers/workspace-seed.ts`
- Modify: `packages/api/src/lib/computers/workspace-seed.test.ts`
- Modify: `packages/api/src/lib/computers/tasks.ts`
- Modify: `packages/api/src/lib/computers/tasks.test.ts`

**Approach:**

- Add a constant list of starter runbook skill slugs:
  `crm-dashboard`, `research-dashboard`, `map-artifact`.
- Add a helper that resolves a Computer's tenant slug and template slug.
- If the template slug is `thinkwork-computer-default`, list
  `skills/catalog/<slug>/` for each starter skill.
- Copy each catalog file into
  `tenants/<tenant>/agents/_catalog/thinkwork-computer-default/workspace/skills/<slug>/...`
  when missing or stale, so runbook routing sees an assigned skill in the
  normal template workspace.
- Enqueue `workspace_file_write` tasks to materialize the same files into live
  EFS at `skills/<slug>/<relative-file>`.
- Use deterministic idempotency keys based on computer id, skill slug, relative
  path, and source ETag.
- Keep the existing migrated-agent seeding behavior intact.
- Raise or log missing catalog files as a non-fatal skipped file so one missing
  starter does not block unrelated workspace preparation.

**Test Scenarios:**

- Platform-default Computer copies starter skill files into template S3 and
  enqueues all starter skill files into live EFS `skills/<slug>/...` paths.
- Re-running with the same ETag uses the same idempotency key and does not
  require new behavior from the runtime.
- Non-default Computer template skips automatic starter materialization.
- Empty, oversized, operational, and missing source objects are skipped.
- Existing migrated workspace seeding still works as before.

### U2. Ensure routing triggers default materialization before discovery

**Goal:** Avoid a "no assigned runbooks" routing result when the default
template has not yet been materialized.

**Requirements:** R1, R3, R6

**Files:**

- Modify: `packages/api/src/lib/runbooks/skill-discovery.ts`
- Modify: `packages/api/src/lib/runbooks/skill-discovery.test.ts`
- Modify: `packages/api/src/lib/computers/runtime-api.ts`
- Modify: `packages/api/src/lib/computers/runtime-api.test.ts`

**Approach:**

- Call the default runbook materialization helper from the Computer heartbeat
  path so running Computers converge in the background.
- Call the same helper before runbook skill discovery. Discovery should still
  read assigned skills from the template S3 workspace; the helper ensures that
  workspace is populated for platform-default Computers and that the live EFS
  workspace receives the same starter skill files.
- Keep failures non-fatal in routing; log them and continue to normal discovery
  so a sync issue does not break all Computer chat.

**Test Scenarios:**

- Heartbeat calls default runbook materialization after migrated workspace seed.
- Runbook skill discovery invokes the materialization helper before listing
  assigned workspace skills.
- Materialization errors are logged and discovery continues.

### U3. Keep Computer runtime sync behavior explicit and covered

**Goal:** Make the runtime's existing EFS task surface visibly support the
materialization contract.

**Requirements:** R2, R4

**Files:**

- Modify: `packages/computer-runtime/src/task-loop.ts`
- Modify: `packages/computer-runtime/src/workspace.ts`
- Modify: `packages/computer-runtime/test/task-loop.test.ts`
- Modify: `packages/computer-runtime/test/workspace.test.ts`

**Approach:**

- Keep using `workspace_file_write`; no new runtime task is required for the
  first pass.
- Add/adjust tests proving nested `skills/<slug>/references/...` files are
  written and listed correctly.
- Avoid broad runtime refactors.

**Test Scenarios:**

- Runtime writes a nested runbook skill file under `skills/crm-dashboard/`.
- Runtime lists nested skill support files and excludes only runtime-private
  `.thinkwork*` files.

## Verification

- `pnpm --filter @thinkwork/api test -- workspace-seed skill-discovery runtime-api`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/computer-runtime test`
- `pnpm --filter @thinkwork/computer-runtime typecheck`
- `pnpm -r --if-present typecheck`
- `pnpm -r --if-present test`
- `pnpm -r --if-present lint`
- `pnpm -r --if-present build`

## Follow-Ups

- Add an event-driven S3 desired-state sync trigger if template workspace edits
  need near-real-time propagation to idle Computers.
- Add a deliberate delete propagation policy for removing default starter skills
  from existing Computers.
- Add an Admin affordance that distinguishes template-assigned skills from
  live-EFS materialization status.
