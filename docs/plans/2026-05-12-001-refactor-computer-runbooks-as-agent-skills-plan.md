---
title: "refactor(computer): make runbooks standard Agent Skills"
type: refactor
status: active
date: 2026-05-12
origin: docs/brainstorms/2026-05-11-computer-runbooks-tenant-authored-template-assigned-requirements.md
---

# refactor(computer): make runbooks standard Agent Skills

## Overview

Computer runbooks should become complex Agent Skills, not a parallel proprietary definition type. The product concept stays: Computer can route substantial repeatable work, ask for confirmation, show phase/task progress, and preserve an auditable execution snapshot. The source artifact changes: a runbook is now a standard skill directory with `SKILL.md`, optional `references/`, optional `assets/`, and optional `scripts/`, following the emerging Agent Skills specification.

This plan replaces the `packages/runbooks/runbooks/<slug>/runbook.yaml + phases/*.md` source format with runbook-capable skill directories. Thinkwork-specific routing, approval, output, and phase metadata should live inside the skill's standard extension surfaces: concise spec frontmatter in `SKILL.md`, agent instructions in the body, detailed contracts under `references/`, and output templates or schemas under `assets/`.

The user-visible assignment model also changes. We should not add a runbook-template assignment table. A Computer template gets a runbook by having the skill installed in its workspace at `workspace/skills/<slug>/`. Presence in the template workspace is the assignment and activation signal, consistent with the existing "skills as workspace folder" architecture.

## Problem Frame

The previous plan treated runbooks as distinct YAML-plus-Markdown product definitions assigned to Computer templates. That would create a second authoring and runtime substrate beside skills, even though the repo already moved strongly toward `SKILL.md` as the canonical skill contract and `workspace/skills/<slug>/SKILL.md` as activation truth.

That split is now the wrong direction. Agent Skills provide the exact shape this feature needs:

- `SKILL.md` for discoverable metadata plus agent instructions.
- `references/` for progressively loaded detailed phase guidance, schemas, examples, and artifact recipes.
- `assets/` for templates, example datasets, UI specs, or other output-shaping material.
- `scripts/` when a runbook-capable skill needs deterministic helper code.

The plan should preserve the already-useful Computer run lifecycle and UI pieces, but make the source and admin mental model skill-native.

## Requirements Trace

- R1. Existing packaged runbooks are converted into Agent Skill directories. The initial set is `crm-dashboard`, `research-dashboard`, and `map-artifact` from `packages/runbooks/runbooks/`.
- R2. No new `runbook.yaml` source format is introduced. Converted runbooks use `SKILL.md`, `references/`, `assets/`, and `scripts/` only.
- R3. A runbook-capable skill is still routable by Computer for substantial work. Routing uses the skill's `name`, `description`, and a structured reference contract, not a bespoke runbook registry.
- R4. Template assignment means installing or removing the skill under the Computer template workspace. The existing workspace-skill activation invariant remains: `workspace/skills/<slug>/SKILL.md` present means active.
- R5. Auto-selected runbook-capable skills still require a Confirmation card before execution. Explicit named invocation can skip confirmation only after the skill is present on the Computer template.
- R6. Execution still snapshots what ran, expands user-visible phase/task progress, streams the Queue UI, and records completion/failure/cancellation for audit.
- R7. Capability bounding is enforced by Thinkwork runtime policy, not by trusting skill prose. Agent Skills `allowed-tools` may be read as a hint where present, but enforcement stays fail-closed in the runtime/tool surface.
- R8. Tenant-authored runbooks become tenant-authored skills. Admin authoring should produce valid skill directories rather than tenant-scoped proprietary runbook files.
- R9. `references/` and `assets/` are first-class output-shaping inputs. For artifact-producing skills, output schema, layout guidance, example payloads, and validation rubrics move there.
- R10. The previous "runbooks reference skills but are not skills" decision is withdrawn.

## Scope Boundaries

- No cross-tenant marketplace or publishing flow.
- No visual drag-drop workflow builder.
- No new M:N runbook-template assignment table.
- No separate tenant runbook filesystem outside `workspace/skills/`.
- No immediate physical rename of every `computer_runbook_*` table if it would create migration churn; API/product naming should move toward skill-run language while storage can keep compatibility names during the transition.
- No reliance on Agent Skills `allowed-tools` as the only permission model because support is experimental and varies by agent implementation.
- No S3-event-driven orchestration dependency.
- No removal of generic skills, built-in tools, or existing workspace skill behavior.

## Context & Research

### Existing Patterns to Reuse

- `packages/skill-catalog/*/SKILL.md` is already the canonical metadata + instruction file for bundled skills. Tests under `packages/skill-catalog/__tests__/skill-md-frontmatter.test.ts` assert every catalog skill has valid `SKILL.md` frontmatter.
- `packages/skill-catalog/scripts/sync-catalog-db.ts` already syncs skill frontmatter to `skill_catalog.tier1_metadata`.
- `docs/plans/2026-04-27-004-feat-skills-as-workspace-folder-plan.md` established the current invariant: `workspace/**/skills/<slug>/SKILL.md` is activation truth for operator-editable skills.
- `packages/database-pg/src/schema/runbooks.ts` already has useful run lifecycle tables: `tenant_runbook_catalog`, `computer_runbook_runs`, and `computer_runbook_tasks`.
- `packages/api/src/lib/computers/thread-cutover.ts` already routes Computer messages through runbook confirmation and queue creation.
- `packages/api/src/lib/runbooks/router.ts` has deterministic route scoring that can be ported from `RunbookDefinition` to runbook-capable skill summaries.
- `apps/computer/src/components/runbooks/RunbookQueue.tsx` and the `data-runbook-confirmation` / `data-runbook-queue` message parts can survive as UI affordances, even if product copy gradually says "skill run" instead of "runbook."

### Current Runbook Source to Retire

- `packages/runbooks/runbooks/crm-dashboard/runbook.yaml`
- `packages/runbooks/runbooks/research-dashboard/runbook.yaml`
- `packages/runbooks/runbooks/map-artifact/runbook.yaml`
- Their phase markdown files under each `phases/` directory.

### External Reference

- Agent Skills specification: `https://agentskills.io/specification`

Important constraints from that spec:

- A skill directory requires `SKILL.md`.
- `scripts/`, `references/`, and `assets/` are optional standard directories.
- Skills are designed for progressive disclosure: load metadata first, then `SKILL.md`, then referenced files only as needed.
- `allowed-tools` exists but is experimental, so Thinkwork should treat it as advisory rather than authoritative.

## Key Technical Decisions

- **Agent Skill directory is source of truth.** Converted runbooks live as skills, ideally under `packages/skill-catalog/<slug>/` or a clearly named subfolder that the catalog sync already understands. `packages/runbooks` becomes temporary compatibility only, then is deleted.
- **Use `references/` for the rich runbook contract.** Keep `SKILL.md` frontmatter close to the public Agent Skills spec. Put routing examples, confirmation copy, phase definitions, task seeds, expected outputs, validation rubrics, and artifact schemas in focused files under `references/` and `assets/`.
- **Use a thin Thinkwork marker, not a new format.** A runbook-capable skill can declare a simple marker such as `metadata.thinkwork_kind: computer-runbook` or equivalent scalar metadata. The rich contract is referenced from the skill body or standard directories.
- **Assignment equals template workspace installation.** Installing `crm-dashboard` into `tenants/{tenant}/agents/_catalog/{template}/workspace/skills/crm-dashboard/` makes that runbook-capable skill available to Computers created from that template. Removing the folder disables it on the next turn.
- **Route against assigned skills only.** Computer routing must discover runbook-capable skills from the active Computer/template workspace, not from all bundled starter skills.
- **Preserve execution audit, migrate semantics.** `computer_runbook_runs.definition_snapshot` should snapshot the activated skill directory metadata and referenced contract. Long-term storage can be renamed to `computer_skill_runs`, but the first implementation should avoid a risky table rename unless the migration is clearly cheap.
- **Capability enforcement remains runtime-owned.** Skill content can request capabilities, but the runtime maps those requests to an allowlist and blocks tools outside the active run's policy.
- **Starters are catalog skills.** Thinkwork-published starters are bundled catalog skills that tenants can install, edit, and fork like other skills.

## Implementation Units

### U1. Define the runbook-capable skill contract

**Goal:** Establish the minimal standard skill shape Computer needs to route, confirm, execute, and audit a complex skill.

**Requirements:** R2, R3, R5, R6, R7, R9

**Files:**

- Modify or create: `packages/skill-catalog/__tests__/runbook-skill-contract.test.ts`
- Modify: `packages/api/src/lib/skill-md-parser.ts` if additional metadata tolerance is needed
- Create: `packages/skill-catalog/README.md` section documenting runbook-capable skills

**Approach:**

- Choose one contract file name under `references/`, for example `references/thinkwork-runbook.json`.
- Keep the file focused on machine-readable fields Computer needs before loading the whole skill: routing aliases, trigger examples, confirmation summary, phase ids/titles, capability roles, task seeds, expected outputs, and optional asset references.
- Keep phase guidance in separate focused files such as `references/discover.md`, `references/analyze.md`, `references/produce.md`, and `references/validate.md`.
- Keep artifact output shaping in `assets/`, such as schemas, data examples, layout recipes, and validation fixtures.
- Add validation that a skill marked as Computer-runbook-capable has the referenced contract and that referenced files exist.

**Test scenarios:**

- Valid runbook-capable skill parses with `SKILL.md` plus `references/thinkwork-runbook.json`.
- Missing contract file fails validation with the skill slug and missing path.
- Contract references a missing phase file or asset and fails validation.
- Skill with no runbook marker remains a normal skill and is ignored by Computer runbook routing.
- Contract includes capability roles outside the registry and fails validation.

### U2. Convert existing packaged runbooks into skills

**Goal:** Move `crm-dashboard`, `research-dashboard`, and `map-artifact` from `packages/runbooks/runbooks/` into skill directories.

**Requirements:** R1, R2, R9

**Files:**

- Create or modify: `packages/skill-catalog/crm-dashboard/SKILL.md`
- Create: `packages/skill-catalog/crm-dashboard/references/*`
- Create: `packages/skill-catalog/crm-dashboard/assets/*` if output schemas/templates warrant it
- Create or modify: `packages/skill-catalog/research-dashboard/SKILL.md`
- Create: `packages/skill-catalog/research-dashboard/references/*`
- Create or modify: `packages/skill-catalog/map-artifact/SKILL.md`
- Create: `packages/skill-catalog/map-artifact/references/*`
- Modify: `packages/skill-catalog/__tests__/skill-md-frontmatter.test.ts`
- Modify: `packages/skill-catalog/__tests__/tier1-metadata-shape.test.ts`
- Delete after compatibility cutover: `packages/runbooks/runbooks/*`

**Approach:**

- Translate each `runbook.yaml` into a `SKILL.md` summary plus `references/thinkwork-runbook.json`.
- Move existing phase markdown into `references/` with stable relative paths.
- Put artifact-specific data contracts such as `CrmDashboardData` in `assets/` or focused reference files.
- Ensure `SKILL.md` descriptions are strong enough for startup-level discovery while detailed routing examples stay in the reference contract.
- Keep slugs unchanged to avoid breaking existing routes and run history.

**Test scenarios:**

- All three converted skills pass the normal skill-catalog frontmatter tests.
- All three pass the runbook-capable contract validator.
- No `runbook.yaml` remains for those three slugs.
- Existing phase guidance content is preserved and reachable by relative references.
- Generated skill catalog sync includes these slugs.

### U3. Replace `@thinkwork/runbooks` registry usage with skill catalog discovery

**Goal:** Computer routing and catalog seeding read runbook-capable skills from the skill catalog/template workspace instead of `runbookRegistry.all`.

**Requirements:** R3, R4, R5, R8

**Files:**

- Modify: `packages/api/src/lib/runbooks/router.ts`
- Modify: `packages/api/src/lib/runbooks/catalog.ts`
- Modify: `packages/api/src/lib/computers/thread-cutover.ts`
- Modify: `packages/api/src/lib/runbooks/confirmation-message.ts`
- Modify: `packages/api/src/lib/runbooks/tasks.ts`
- Modify tests under: `packages/api/src/lib/runbooks/*.test.ts`

**Approach:**

- Introduce a `ComputerRunbookSkill` adapter type built from a skill directory/frontmatter plus the runbook reference contract.
- For bundled starters, load from `skill_catalog` or the on-disk skill catalog during tests.
- For live Computer routing, resolve only skills present in the active Computer/template workspace.
- Preserve route semantics: explicit invocation requires a matching assigned skill; auto-routing requires confidence; ambiguous matches render a disambiguation message; no match falls back to normal Computer planning.
- Stop seeding `tenant_runbook_catalog` from `runbookRegistry.all`. If catalog rows remain for UI/query compatibility, derive them from installed runbook-capable skills.

**Test scenarios:**

- Explicit prompt for `crm-dashboard` routes only when that skill exists in the template workspace.
- Explicit prompt for a non-installed skill is rejected or falls back with a clear unauthorized/unavailable outcome.
- Auto prompt routes to the best assigned runbook-capable skill and creates an awaiting-confirmation run.
- No assigned skill match falls back to normal Computer execution.
- Ambiguous assigned skill matches produce the existing ambiguity response.

### U4. Make admin assignment skill-native

**Goal:** Admin UI assigns runbook-capable skills to Computer templates by installing/removing skills in the template workspace.

**Requirements:** R4, R8

**Files:**

- Modify: `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx`
- Modify: `apps/admin/src/components/agent-builder/FolderTree.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx`
- Modify: `apps/admin/src/lib/skills-api.ts`
- Modify or add tests under: `apps/admin/src/components/agent-builder/__tests__/`

**Approach:**

- Reuse existing Add-from-catalog and New Skill workspace flows where possible.
- Add a filtered view or picker state for runbook-capable skills so operators can find starter runbooks without learning internal slugs.
- Avoid a separate Runbooks tab if Workspace can carry the behavior cleanly; if a product tab remains, it should operate on skill directories, not runbook rows.
- Installing a starter skill into a template workspace is assignment. Removing it disables routing on the next turn.

**Test scenarios:**

- Template workspace can install `crm-dashboard` from catalog and shows `skills/crm-dashboard/SKILL.md`.
- Removing the folder removes the runbook-capable skill from assignment.
- New tenant-authored runbook skill scaffold creates valid `SKILL.md` plus starter `references/thinkwork-runbook.json`.
- UI copy says this is a skill-based runbook, not a separate proprietary runbook file.

### U5. Adapt execution snapshots and runtime context

**Goal:** Run execution consumes the activated skill snapshot and gives Strands the right progressive-disclosure context.

**Requirements:** R5, R6, R7, R9

**Files:**

- Modify: `packages/api/src/lib/runbooks/runs.ts`
- Modify: `packages/api/src/lib/runbooks/runtime-api.ts`
- Modify: `packages/agentcore-strands/agent-container/container-sources/workflow_skill_context.py`
- Modify: `packages/agentcore-strands/agent-container/container-sources/server.py`
- Modify tests under: `packages/api/src/lib/runbooks/*.test.ts`
- Modify or add Python tests under: `packages/agentcore-strands/agent-container/`

**Approach:**

- Snapshot the activated skill's `SKILL.md`, frontmatter, contract reference, relevant phase guidance, and asset references into `definition_snapshot`.
- Keep the existing phase/task queue model but derive phases from the skill contract.
- Supply Strands with the skill's main instructions first, then phase-specific references as tasks execute.
- Enforce capability roles before dispatching tools or helper skills.
- Preserve current run statuses and Queue UI events.

**Test scenarios:**

- Run snapshot includes skill slug, version, `SKILL.md` checksum/content, contract, and phase references.
- Editing the skill mid-run does not affect the active run snapshot.
- Out-of-allowlist capability request fails the task and records an error.
- Phase guidance is loaded progressively and does not inject every reference/asset up front.
- Queue updates still group tasks by phase.

### U6. Clean up compatibility package and naming

**Goal:** Remove the proprietary runbook package once routing, execution, and tests use skills.

**Requirements:** R2, R10

**Files:**

- Delete or shrink: `packages/runbooks/*`
- Modify: root `package.json` / `pnpm-workspace.yaml` if the package is removed
- Modify imports currently using `@thinkwork/runbooks`
- Modify: `docs/plans/2026-05-10-003-feat-computer-runbooks-foundation-plan.md` with a superseded note or archive status
- Modify: relevant docs under `docs/` once code lands

**Approach:**

- Remove `@thinkwork/runbooks` only after no production code imports it.
- If physical DB table renames are deferred, add comments/docs that `computer_runbook_*` tables now store skill-run compatibility records.
- Update docs so future plans start from skill-native architecture.

**Test scenarios:**

- `rg "@thinkwork/runbooks|runbook.yaml|packages/runbooks/runbooks" packages apps docs` only finds deliberate historical references.
- `pnpm -r --if-present typecheck` has no missing package references.
- Runbook UI/API tests pass against skill-backed fixtures.

## System-Wide Impact

- **Source artifact:** shifts from `packages/runbooks` YAML to standard skill directories.
- **Admin model:** template assignment becomes workspace skill install/remove.
- **Routing:** filters assigned runbook-capable skills from the template workspace.
- **Runtime:** executes a skill snapshot with progressive references/assets.
- **Persistence:** run/task lifecycle can remain, but semantics change from proprietary runbook definition to skill execution snapshot.
- **Docs:** previous requirement docs that say "runbooks are not skills" are superseded by this plan.

## Risks & Mitigations

| Risk                                                            | Mitigation                                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Agent Skills spec rejects rich custom frontmatter               | Keep rich Thinkwork contract in `references/`, not top-level frontmatter.                     |
| Template assignment becomes less visible if it is only a folder | Add a filtered runbook-capable skill picker in the Workspace/template UI.                     |
| Runtime accidentally routes unassigned catalog starters         | Route only against skills present in the active template/computer workspace.                  |
| Existing run history expects runbook slugs                      | Preserve slugs and keep storage compatibility during the first migration.                     |
| Permission model gets too trusting of skill prose               | Treat skill-declared roles as requested capabilities and enforce runtime allowlists.          |
| `packages/runbooks` removal breaks tests late                   | Convert tests unit by unit, then delete package only after `rg @thinkwork/runbooks` is clean. |

## Verification Plan

- `pnpm --filter @thinkwork/skill-catalog test`
- `pnpm --filter @thinkwork/api test -- runbooks`
- `pnpm --filter @thinkwork/admin test -- WorkspaceEditor`
- `uv run pytest packages/agentcore-strands/agent-container/test_*runbook* packages/agentcore-strands/agent-container/test_*skill*`
- `pnpm -r --if-present typecheck`
- Manual admin check: install a runbook-capable skill into a Computer template workspace, start a Computer turn, confirm the card, watch Queue progress, and verify the run snapshot references the skill, not `runbook.yaml`.

## Rollout Notes

1. Convert and ship the three starter skills behind compatibility code first.
2. Route one non-critical template to the skill-backed path while keeping current UI parts.
3. Remove `packages/runbooks` and old registry imports after the skill-backed route is stable.
4. Revisit physical DB/table/API naming only after execution semantics are proven; do not block the standards pivot on a large rename migration.
