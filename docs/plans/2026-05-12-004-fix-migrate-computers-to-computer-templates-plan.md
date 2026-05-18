---
title: "fix(computer): migrate legacy Computers to Computer templates"
type: fix
status: active
date: 2026-05-12
origin: docs/plans/2026-05-12-001-refactor-computer-runbooks-as-agent-skills-plan.md
---

# fix(computer): migrate legacy Computers to Computer templates

## Overview

Legacy Computers can still point at rows in `agent_templates` where `template_kind = 'agent'`. That breaks the current Computer architecture: Computer creation and editing now require `template_kind = 'computer'`, the admin picker lists only Computer templates, and default runbook skills materialize from Computer template workspace state.

The durable fix is to backfill every active Computer onto a Computer template while preserving tenant-specific workspace content. Existing tenant Agent templates must not be mutated in place, because Agents may still depend on them. Instead, each legacy Computer template assignment should be cloned into a tenant-scoped Computer template when needed, and Computers should be repointed to that clone. If the source template is missing or unrecoverable, the migration falls back to the platform default Computer template.

## Problem Frame

The live dev state exposed the issue directly:

- `Smoke` uses a tenant Computer template.
- `Monica` uses the platform default Computer template.
- `Marco`, `Loki`, `GiGi`, and `Cruz` still use the tenant `default` Agent template.

Those four Computers are valid rows, but their `template_id` points at the wrong template kind. That is why default runbook skill materialization did not automatically populate Marco's `skills/` folder after the runbook-as-skills work shipped.

## Requirements

- R1. No active, non-archived Computer may remain assigned to an Agent template after the migration runs.
- R2. Already-correct Computers assigned to Computer templates are left untouched.
- R3. Existing tenant template/workspace customizations used by legacy Computers are preserved by cloning the source Agent template into a tenant-scoped Computer template instead of mutating the Agent template.
- R4. The migration is idempotent: repeated dry-runs and apply-runs reuse the same migrated Computer template and do not duplicate templates or workspace files.
- R5. Migrated Computer template workspaces contain starter runbook skills under `workspace/skills/<slug>/` where appropriate.
- R6. Live Computer EFS workspaces are refreshed from assigned template workspace skill files so the admin Workspace tab and runtime both see the skills.
- R7. Future create/update/admin paths continue rejecting Agent templates for Computers.
- R8. The migration is observable through dry-run output, applied counts, and SQL verification queries.

## Scope Boundaries

- Do not rename `agent_templates`; the table remains the shared storage table with `template_kind` as the discriminator.
- Do not mutate existing tenant Agent templates from `template_kind = 'agent'` to `template_kind = 'computer'`.
- Do not delete legacy Agent templates.
- Do not add an S3 event-driven sync dependency for this fix.
- Do not require direct production mutation outside the normal reviewed migration/backfill path.
- Do not broaden built-in tool materialization into `workspace/skills/`; built-ins remain separate from editable workspace skills.

## Context And Existing Patterns

- `docs/plans/2026-05-06-005-feat-thinkwork-computer-phase-one-foundation-plan.md` chose `agent_templates.template_kind` as the Computer Template discriminator.
- `docs/plans/2026-05-11-003-feat-computer-admin-crud-plan.md` seeded the platform default at `tenant_id IS NULL`, slug `thinkwork-computer-default`, `template_kind = 'computer'`.
- `packages/api/src/graphql/resolvers/computers/shared.ts` already validates create paths through `requireComputerTemplate`.
- `packages/api/src/graphql/resolvers/computers/updateComputer.mutation.ts` already validates template updates through `requireComputerTemplate`.
- `packages/api/src/lib/computers/provision.ts` resolves auto-provisioned Computers by platform default slug, `tenant_id IS NULL`, and `template_kind = 'computer'`.
- `apps/admin/src/components/computers/ComputerFormDialog.tsx` and `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerIdentityEditPanel.tsx` already use `computerTemplates`.
- `docs/plans/2026-04-27-004-feat-skills-as-workspace-folder-plan.md` established `workspace/skills/<slug>/SKILL.md` as activation truth.
- `docs/solutions/best-practices/injected-built-in-tools-are-not-workspace-skills-2026-04-28.md` warns not to copy injected built-ins into editable workspace skills.
- `packages/api/src/lib/computers/workspace-seed.ts` already has a pattern for copying S3 workspace files into live Computer EFS via `workspace_file_write` tasks.

## Key Decisions

- **Clone, then repoint.** For each `(tenant_id, legacy_template_id)` used by legacy Computers, create or reuse a tenant-scoped Computer template cloned from the legacy Agent template. Repoint Computers to the clone. This preserves tenant customizations and avoids breaking Agents.
- **Use deterministic migrated template identity.** The cloned template should have a stable slug such as `computer-${legacy_slug}` and config metadata recording `migratedFromAgentTemplateId`. Re-runs should find the clone by metadata first, then slug.
- **Copy workspace content before repointing.** Template workspace files under `tenants/{tenantSlug}/agents/_catalog/{legacyTemplateSlug}/workspace/` should be copied to the migrated Computer template workspace prefix before Computers are updated.
- **Generalize template-to-live skill materialization.** The runtime should not only materialize starter skills for the platform default template. Any Computer should be able to refresh `workspace/skills/*` from its assigned Computer template into the live EFS workspace.
- **Fallback is platform default.** If the legacy template row is missing or the source workspace cannot be listed, the migration may repoint the Computer to `thinkwork-computer-default`, but it must report the fallback clearly.
- **Application guards stay primary.** Cross-table `template_kind` enforcement is not practical as a simple SQL check. Keep create/update validation and add tests plus verification queries.

## Implementation Units

### U1. Add legacy Computer template audit and clone planner

**Goal:** Produce a dry-run report of Computers whose template is missing or not `template_kind = 'computer'`, grouped by tenant and legacy template.

**Requirements:** R1, R2, R4, R8

**Files:**

- Create: `packages/api/src/lib/computers/template-kind-migration.ts`
- Create: `packages/api/src/lib/computers/template-kind-migration.test.ts`

**Approach:**

- Query active/non-archived Computers with their template row, tenant slug, and template slug.
- Group invalid rows by `(tenant_id, template_id)`.
- For each group, classify the action: `reuse_existing_migrated_template`, `create_migrated_template`, or `fallback_platform_default`.
- Include the affected Computer ids/names and source template metadata in the report.

**Test scenarios:**

- A Computer already using a Computer template is omitted from the invalid group list.
- Multiple Computers on the same Agent template produce one migration group.
- A pre-existing migrated Computer template with matching metadata is reused.
- A missing legacy template is classified as platform-default fallback.

### U2. Implement idempotent template clone and workspace copy

**Goal:** Create tenant-scoped Computer template clones and copy template workspace files from the legacy Agent template prefix to the new Computer template prefix.

**Requirements:** R3, R4, R5

**Files:**

- Modify: `packages/api/src/lib/computers/template-kind-migration.ts`
- Test: `packages/api/src/lib/computers/template-kind-migration.test.ts`

**Approach:**

- Clone the source `agent_templates` row into a new row with `template_kind = 'computer'`, `source = 'user'`, a deterministic slug, and migration metadata in `config`.
- Preserve operationally meaningful template fields: name, description, category, icon, runtime, model, guardrail, blocked tools, skills, knowledge bases, sandbox, browser, web search, send email, context engine, and published state.
- Copy all non-empty workspace files from the legacy template workspace prefix into the migrated Computer template workspace prefix.
- Ensure starter runbook skills from the skill catalog exist in the migrated template workspace if the source did not already contain them.
- Keep built-in tool pseudo-skills out of the copied workspace.

**Test scenarios:**

- Applying a ready group creates one Computer template clone with `template_kind = 'computer'`.
- Re-running apply reuses the same clone and does not create duplicate template rows.
- Workspace copy preserves `workspace/skills/<slug>/SKILL.md`, `references/`, and `assets/`.
- Built-in tool paths such as `workspace/skills/web-search/SKILL.md` are skipped if encountered.
- Source workspace absence still allows a fallback decision and clear report entry.

### U3. Repoint legacy Computers and record audit events

**Goal:** Update each invalid Computer to its migrated Computer template or fallback template and leave an observable audit trail.

**Requirements:** R1, R2, R4, R8

**Files:**

- Modify: `packages/api/src/lib/computers/template-kind-migration.ts`
- Test: `packages/api/src/lib/computers/template-kind-migration.test.ts`

**Approach:**

- Update `computers.template_id` only after the target Computer template has been created or resolved.
- Add `computer_events` rows such as `computer_template_kind_migration_applied`.
- Add migration metadata to `computers.migration_metadata` recording source template id/kind/slug and target template id/slug.
- Return counts for scanned, migrated, skipped, fallback, and failed rows.

**Test scenarios:**

- A legacy Computer is repointed from an Agent template to the migrated Computer template.
- A second apply run reports the Computer as already migrated.
- Existing `migration_metadata` is merged rather than overwritten.
- Audit event payload includes source and target template ids.

### U4. Add a deploy-safe backfill entry point

**Goal:** Make the migration runnable in dry-run and apply modes without hand-editing DB rows or EFS.

**Requirements:** R4, R8

**Files:**

- Create: `packages/api/scripts/migrate-computers-to-computer-templates.ts`
- Modify: `packages/api/package.json`
- Optionally create: `docs/runbooks/migrate-computers-to-computer-templates.md`

**Approach:**

- Add a script with `--tenant-id`, `--all-tenants`, `--dry-run`, and `--apply`.
- Default to dry-run.
- Print a concise JSON report suitable for CI logs or operator notes.
- Use the same AWS/S3 and database environment conventions as existing API scripts.

**Test scenarios:**

- Running without `--apply` performs no writes.
- `--tenant-id` scopes to one tenant.
- `--all-tenants --apply` requires an explicit apply flag.
- Missing `WORKSPACE_BUCKET` fails before partial S3 work.

### U5. Generalize assigned template skill materialization

**Goal:** Ensure live Computer workspaces receive assigned template skills, not just starter skills for the platform default template.

**Requirements:** R5, R6

**Files:**

- Modify: `packages/api/src/lib/computers/workspace-seed.ts`
- Modify: `packages/api/src/lib/runbooks/skill-discovery.ts`
- Test: `packages/api/src/lib/computers/workspace-seed.test.ts`
- Test: `packages/api/src/lib/runbooks/skill-discovery.test.ts`

**Approach:**

- Rename or complement the default-only helper with an assigned-template materializer.
- For a Computer, resolve its assigned Computer template, list `workspace/skills/*` files under that template prefix, and enqueue `workspace_file_write` tasks into the live Computer workspace.
- Keep idempotency keys based on Computer id, template id, path, and source ETag.
- Keep the platform-default starter seeding path, but treat it as a way to populate the platform template source, not as the only materialization path.

**Test scenarios:**

- A Computer assigned to a tenant Computer template with `workspace/skills/crm-dashboard/SKILL.md` gets a live workspace write task.
- Re-running with the same ETag does not enqueue duplicate work.
- Updating a template skill file ETag enqueues a new write.
- A Computer assigned to an Agent template is reported as invalid and does not silently materialize.

### U6. Verify future guards and admin behavior

**Goal:** Lock in the template-kind boundary so new code does not reintroduce Agent-template Computers.

**Requirements:** R7

**Files:**

- Modify or add tests: `packages/api/src/graphql/resolvers/computers/createComputer.mutation.test.ts`
- Modify or add tests: `packages/api/src/graphql/resolvers/computers/updateComputer.mutation.test.ts`
- Modify or add tests: `apps/admin/src/components/computers/ComputerFormDialog.test.tsx`
- Modify or add tests: `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerIdentityEditPanel.test.tsx`

**Approach:**

- Add explicit negative tests for create/update attempts with an Agent template id.
- Confirm the admin create/edit flows query `computerTemplates`, not `agentTemplates`.
- Confirm empty Computer-template states show a useful disabled picker state rather than falling back to an Agent template.

**Test scenarios:**

- `createComputer` rejects `template_kind = 'agent'`.
- `updateComputer` rejects `template_kind = 'agent'`.
- Admin create dialog defaults to `thinkwork-computer-default` when available.
- Admin edit template picker contains only Computer templates.

### U7. Apply and verify the migration in dev, then promote normally

**Goal:** Run the migration through the normal PR/deploy path and verify real Computers.

**Requirements:** R1, R5, R6, R8

**Files:**

- Update: `docs/plans/autopilot-status.md` if executed under autopilot.
- Optionally update: `docs/runbooks/migrate-computers-to-computer-templates.md`

**Approach:**

- Merge the implementation first.
- Run dry-run against dev and attach the report to the PR or status doc.
- Run apply against dev after deploy.
- Verify with SQL that zero active Computers join to `agent_templates.template_kind != 'computer'`.
- Verify Marco, Loki, GiGi, and Cruz show populated `skills/` folders in the admin Workspace tab.
- Promote to production through the normal merge/deploy pipeline.

**Test scenarios:**

- SQL verification returns zero invalid Computers after apply.
- Runtime workspace file listing for a migrated Computer includes `skills/crm-dashboard/SKILL.md`, `skills/research-dashboard/SKILL.md`, and `skills/map-artifact/SKILL.md`.
- Admin Workspace tab displays the same skill directories after refresh.

## Verification Queries

```sql
select
  c.id,
  c.name,
  t.slug as template_slug,
  t.template_kind,
  t.source
from computers c
left join agent_templates t on t.id = c.template_id
where c.status <> 'archived'
  and (t.id is null or t.template_kind <> 'computer')
order by c.created_at;
```

```sql
select
  t.tenant_id,
  t.slug,
  t.template_kind,
  t.config->'computerTemplateMigration' as migration
from agent_templates t
where t.template_kind = 'computer'
  and t.config ? 'computerTemplateMigration'
order by t.created_at;
```

## Risks

- **Template behavior drift:** Repointing to the platform default would lose tenant-specific config. Cloning avoids that for normal cases.
- **Workspace copy size:** Template workspaces could contain large files. Keep the existing max-size/skip behavior from Computer workspace seeding and report skips.
- **Partial apply:** A failure between clone, S3 copy, and Computer update could leave extra templates. Idempotent metadata and deterministic slugs make retries safe.
- **Agent coupling:** Mutating the existing `default` Agent template would be risky because Agents still use it. The plan explicitly avoids that.
- **Runtime freshness:** S3 template updates do not automatically imply live EFS updates. U5 addresses this with explicit assigned-template materialization during Computer runtime paths.

## Acceptance Criteria

- All active Computers in dev and production point to `template_kind = 'computer'`.
- Marco's class of legacy Computer no longer needs manual S3/EFS patching to see assigned skills.
- The migration can be re-run without duplicating templates, files, or events.
- New Computer create/update attempts with Agent templates fail in API tests.
- Admin create/edit surfaces only Computer templates.
- The runbook-as-skills work can rely on `workspace/skills/<slug>/SKILL.md` being present for migrated Computers.
