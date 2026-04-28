---
title: "feat: Skills as a first-class workspace folder"
type: feat
status: completed
date: 2026-04-27
origin: docs/brainstorms/2026-04-27-skills-as-workspace-folder-requirements.md
---

# feat: Skills as a first-class workspace folder

## Overview

Move catalog-installed skills from `tenants/{slug}/agents/{slug}/skills/<slug>/` into the workspace prefix at `tenants/{slug}/agents/{slug}/workspace/skills/<slug>/`, render the folder in the admin Workspace tab, and update the runtime's `s3Key` source so it materializes from the workspace prefix (which now contains operator edits). The `skills/` reserved-folder convention is already declared in `packages/api/src/lib/reserved-folder-names.ts`; this plan closes the install path, the UI, and the runtime read source so they all line up.

Greenfield: zero installed skill files exist on dev. Hard cut, no migration.

---

## Problem Frame

Skills should be a workspace folder (alongside `memory/`, `CAPABILITIES.md`, etc.) but today the install path writes to a parallel S3 prefix outside the workspace. The Workspace tab never shows `skills/`; the standalone Skills tab on the agent-template editor maintains a separate JSON list; the runtime materializes from the catalog `s3Key` so operator edits would be invisible even if the UI surfaced them.

This plan aligns three things:
1. **Install path** writes to `workspace/skills/<slug>/` (agent + template).
2. **Admin UI** exposes Add-from-catalog and New-Skill in the Workspace tab; removes the standalone Skills tab; renders `skills/` at workspace root.
3. **Runtime read source** points `s3Key` at the workspace prefix so `install_skill_from_s3` materializes operator-edited content, not the catalog version.

The Capabilities → Skills tab (catalog browser) stays as-is.

---

## Requirements Trace

- R1. Catalog install (agent + template) writes to `workspace/skills/<slug>/`. (origin R1, R2, R11)
- R2. Skill files are first-class operator-editable workspace files; one-time clone, no upstream tracking. (origin R3, R4, R5)
- R3. Runtime materializes from the workspace prefix so operator edits take effect. (origin R6, R12)
- R4. Standalone Skills tab on agent-template editor is removed; Workspace tab is the single per-agent surface. (origin R8)
- R5. Capabilities → Skills tab unchanged; no new nav item. (origin R9 — corrected during planning per user feedback)
- R6. Workspace tab Add-menu and right-click context menu on the `skills/` folder expose New Skill (blank scaffold) and Add from catalog. (origin R10, R11)
- R7. Empty `skills/` folder renders in fresh agents via a workspace-defaults marker. (origin R15)

**Origin actors:** A1 operator-template, A2 operator-agent, A3 tenant admin (catalog), A4 Strands runtime
**Origin acceptance examples:** AE1 (R1, R2 write target), AE2 (R2 edit + no drift), AE3 (R3 runtime sees edits), AE4 (R4 Skills tab gone), AE5 (R6 deletion = deactivation)

---

## Scope Boundaries

- **Capabilities → Skills tab** — unchanged.
- **Plugin-upload flow** (`plugin-installer.ts` writing `tenants/{tid}/skills/{pluginName}`) — separate concept, untouched.
- **Tenant-level `installSkill`** (Capabilities Install button) — out of scope; revisit when needed. Button stays live; if dual-destination feedback arrives, hide it as a one-line follow-up.
- **Pi runtime adoption** — the convention is `walk workspace/skills/<slug>/SKILL.md`; the Pi runtime plan picks this up when it adds skill loading. Not implemented here.
- **Removing `install_skill_from_s3` / walking `/tmp/workspace` directly in Strands** — optimization that depends on materialize-at-write-time landing first. Out of scope; revisit then.
- **Upstream tracking / catalog drift indicators** — explicitly rejected (origin R4).

---

## Key Technical Decisions

- **Filesystem is truth for activation.** Presence of `workspace/skills/<slug>/SKILL.md` in the agent's prefix is the activation signal. AGENTS.md `Skills` column rows become documentation.
- **`s3Key` redirect, not runtime walk.** `install_skill_from_s3` already lists and downloads from any S3 prefix; pointing the operator-installed-skill `s3Key` at the workspace prefix is the smallest change that makes Phase A end-to-end functional. A future plan can replace materialization with a direct `/tmp/workspace` walk once the materialize-at-write-time refactor lands.
- **Bifurcated `skillsConfig` cleanup.** Only the operator-installed-skill construction in `wakeup-processor.ts` (the `isTenantCustom ? tenants/.../skills/... : skills/catalog/...` branch around lines 398–426) changes. Platform-catalog auto-injection of `agent-email-send`, `agent-thread-management`, `artifacts`, `workspace-memory`, built-ins, and Google integrations stays untouched — those are platform skills coordinated per-wakeup, not operator-installed.
- **derive-agent-skills is filesystem-only.** Walks `workspace/**/skills/<slug>/SKILL.md` via `ListObjectsV2`; emits one `agent_skills` row per discovered slug. Honors brainstorm R6/R7's "filesystem-as-truth, AGENTS.md-as-documentation" decision and avoids dual-source-of-truth confusion at scale.
- **Hard cut on dev.** Zero installed skill files verified. Same-PR removal of legacy install path. If a non-dev stage has installed skills at deploy time, run `aws s3 mv` as part of that stage's deploy.
- **Templates use the same install path as agents.** Templates have a workspace prefix at `tenants/{slug}/agents/_catalog/{templateSlug}/workspace/`. New `installSkillToTemplate` route writes there. The legacy `agent_templates.skills` JSON column is retired in U1; `createAgentFromTemplate` already copies the template's workspace prefix into the new agent's prefix, so installed skills propagate as workspace files.

---

## Implementation Units

### U1. Server: install handlers + runtime `s3Key` redirect

**Goal:** Catalog install (agent + template) writes to the workspace prefix. Runtime `s3Key` for operator-installed skills points at the workspace prefix so `install_skill_from_s3` materializes operator-edited content.

**Requirements:** R1, R3

**Dependencies:** none

**Files:**
- Modify: `packages/api/src/handlers/skills.ts` — `installSkillToAgent` (impl ~lines 1432–1460): change `agentPrefix` to `tenants/${tenantSlug}/agents/${agentSlug}/workspace/skills/${skillSlug}/`. Call `regenerateManifest` after the copy.
- Modify: `packages/api/src/handlers/skills.ts` — add `installSkillToTemplate(tenantSlug, templateSlug, skillSlug)` route + handler. Writes to `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/skills/${skillSlug}/`. Same copy-from-catalog semantics. Calls `regenerateManifest` for the template prefix.
- Modify: `packages/api/src/lib/resolve-agent-runtime-config.ts` (~lines 386–388): for operator-installed-skill rows, build `s3Key` as `tenants/${tenantSlug}/agents/${agentSlug}/workspace/skills/${s.skill_id}` instead of `tenants/${tenantSlug}/skills/${s.skill_id}`. Platform catalog s3Key (`skills/catalog/${id}`) unchanged.
- Modify: `packages/api/src/handlers/wakeup-processor.ts` (~lines 398–426): same `s3Key` change for the `agent_skills` table iteration. Auto-injection branches for `agent-email-send`, `agent-thread-management`, `artifacts`, `workspace-memory`, built-ins, and Google integrations unchanged.
- Delete: `agent_templates.skills` column writes — the template editor's `addSkill`/`removeSkill` (`apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx:487-509`) is replaced by `installSkillToTemplate` calls in U2; the column itself can stay in the schema for now (data-migration cleanup is a separate follow-up), but the GraphQL `template.skills` field is no longer authoritative for what skills the template ships.
- Test: `packages/api/src/__tests__/skills-handler.test.ts` (create) — assert `installSkillToAgent` writes to `agents/{slug}/workspace/skills/{slug}/`, `installSkillToTemplate` writes to `agents/_catalog/{templateSlug}/workspace/skills/{slug}/`, manifest regenerates after each.
- Test: `packages/api/src/__tests__/resolve-agent-runtime-config.test.ts` — assert operator-installed skills produce `s3Key` pointing at the workspace prefix.

**Test scenarios:**
- Happy path — `installSkillToAgent` writes catalog files to `workspace/skills/{slug}/`; nothing in legacy `skills/{slug}/`. Manifest updated. Covers AE1.
- Happy path — `installSkillToTemplate` writes to template's workspace prefix.
- Happy path — runtime invocation builds `s3Key` pointing at workspace prefix → `install_skill_from_s3` materializes operator-edited SKILL.md, not catalog version. Covers AE3.
- Happy path — wakeup-processor still injects `agent-email-send` and other built-ins (auto-injection branches unchanged).
- Edge case — installing a skill that already exists in the workspace returns a 409 conflict (operator must delete first). Prevents silent overwrite of edits per R4.
- Error path — install failure mid-copy leaves no partial state.

**Verification:**
- `aws s3 ls s3://thinkwork-dev-storage/tenants/{slug}/agents/{slug}/workspace/skills/` returns the catalog files after install; `aws s3 ls .../agents/{slug}/skills/` returns nothing.
- Agent invocation after install + edit shows operator's edited SKILL.md content, not catalog content.
- Email/SMS wakeups still receive injected built-in skills.

---

### U2. Admin Workspace tab integration

**Goal:** WorkspaceEditor exposes Add-from-catalog and New-Skill (already exists). Skills/ folder renders at workspace root. Right-click on `skills/` shows the same actions. Standalone Skills tab on the agent-template editor is removed; deep-link redirects. Workspace-defaults includes a `skills/.gitkeep` so empty folders render in fresh agents.

**Requirements:** R4, R5, R6, R7

**Dependencies:** U1

**Files:**
- Modify: `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx` — extend the add-menu (lines 739–871) with an "Add from catalog" item alongside the existing "New Skill" (line 772–780). Reuse the catalog dialog component currently in `apps/admin/src/components/agents/AgentConfigSection.tsx` (extract to a shared component or import directly). Dialog flow: select skill → call `installSkillToAgent` (or `installSkillToTemplate` per context) → close on success + refresh tree; on failure show inline error (not just `console.error`); in-flight state disables the picker and shows row spinner.
- Modify: `apps/admin/src/components/agent-builder/FolderTree.tsx` — add `onContextMenu` handler on folder rows whose path is `skills/` or `*/skills/`. Menu items: New Skill, Add from catalog, Delete. No context menu on file nodes or non-skills folders. Confirm `buildWorkspaceTree()` already renders top-level `skills/` at workspace root (the `RESERVED_ROUTING_FOLDERS` set at line 32 only suppresses skills from the synthetic agents/ group — top-level rendering should already work).
- Modify: `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx` — remove the Skills tab definition; remove `templateSkills` state (lines 192, 487–509, 566); add a TanStack Router redirect rule from `/agent-templates/{id}/skills` to `/agent-templates/{id}/workspace`.
- Modify: `apps/admin/src/components/agents/AgentConfigSection.tsx` — remove the Skills section (the Add-from-catalog dialog is now in WorkspaceEditor); leave the rest of the section unchanged.
- Modify: `apps/admin/src/lib/skills-api.ts` — add `installSkillToTemplate` wrapper.
- Modify: `apps/admin/src/lib/skill-authoring-templates.ts` — verify `buildLocalSkillPath` returns `skills/<slug>/SKILL.md` (the workspace-files Lambda's `agentKey()` prepends `workspace/` server-side; no client change should be needed).
- Create: `packages/workspace-defaults/files/skills/.gitkeep` (empty file).
- Modify: `packages/workspace-defaults/src/index.ts` — sync the inlined string constants to include the new file (per `docs/solutions/workflow-issues/workspace-defaults-md-byte-parity-needs-ts-test-2026-04-25.md`).
- Modify: `apps/admin/src/components/agent-builder/FolderTree.tsx` — filter `.gitkeep` from the visible file list (parent folder still renders).
- Test: `apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.test.tsx` — extend or add: add-menu shows New Skill + Add from catalog; Add from catalog calls `installSkillToAgent` with correct args; New Skill creates a `workspace/skills/<slug>/SKILL.md` put; right-click on `skills/` shows context menu; reinstalling an existing skill prompts confirmation (overwrite warning per R4).
- Test: workspace-defaults parity test passes (`pnpm --filter @thinkwork/workspace-defaults test`).

**Test scenarios:**
- Happy path — Add from catalog → research-assistant: file tree refreshes to show `skills/research-assistant/`.
- Happy path — New Skill with slug `foo`: `workspace/skills/foo/SKILL.md` is created with starter content. Covers AE2.
- Happy path — agent-template editor renders only Configuration / Workspace / MCP Servers tabs (no Skills tab). Covers AE4.
- Happy path — fresh agent created from defaults shows `skills/` folder (empty, via `.gitkeep` filtered from view).
- Edge case — right-click on `skills/` shows New Skill / Add from catalog / Delete.
- Edge case — reinstalling a skill that exists in the workspace prompts "Already installed — reinstall will overwrite edits" before confirming.
- Edge case — visiting `/agent-templates/{id}/skills` redirects to `/agent-templates/{id}/workspace`.
- Error path — install failure shows inline error in the dialog; dialog stays open.

**Verification:**
- Workspace tab visually matches the brainstorm's target: `skills/` next to `memory/` and the markdown files.
- No Skills tab in agent-template editor.
- Bookmarked Skills-tab links land on Workspace tab.

---

### U3. `derive-agent-skills` filesystem-only walker

**Goal:** `agent_skills` table reflects whatever skills are actually present at `workspace/**/skills/<slug>/SKILL.md`. Admin queries (cross-agent skill listings) see the same set the runtime activates.

**Requirements:** R3

**Dependencies:** U1

**Files:**
- Modify: `packages/api/src/lib/derive-agent-skills.ts` — replace the `composeList` AGENTS.md-row source with a filesystem walk: `ListObjectsV2` against the agent's S3 prefix with prefix filter `tenants/{slug}/agents/{slug}/workspace/`, then regex-match `skills/[^/]+/SKILL\.md$` to extract slugs. Emit one `agent_skills` row per discovered slug. AGENTS.md `Skills` column rows become documentation only (no row written from them).
- Modify: `packages/api/workspace-files.ts` — extend the `derive-agent-skills` trigger predicate (currently `isAgentsMdPath` at lines 408–410) to also fire on `put` and `delete` of `workspace/skills/*/SKILL.md` paths. Without this, derive only re-runs on AGENTS.md edits, so newly installed skills wouldn't get their `agent_skills` row until the operator also touched AGENTS.md.
- Modify: `packages/api/src/handlers/skills.ts` — `installSkillToAgent` and `installSkillToTemplate` invoke `deriveAgentSkills` after the copy completes (the copy bypasses workspace-files Lambda, so the trigger predicate above doesn't fire automatically).
- Test: `packages/api/src/__tests__/derive-agent-skills.test.ts` — replace mocks; add cases for filesystem-only derivation (presence emits row; absence does not), AGENTS.md-only references emit no row, deletion of folder removes the row.

**Test scenarios:**
- Happy path — agent with `workspace/skills/foo/SKILL.md` produces an `agent_skills` row for `foo`.
- Happy path — agent with AGENTS.md routing for `bar` (no folder) produces NO `agent_skills` row (filesystem is truth).
- Happy path — sub-agent skill at `workspace/sales-agent/skills/qux/SKILL.md` produces a row scoped to the sub-agent context.
- Edge case — empty `workspace/skills/foo/` (no SKILL.md) does not produce a row.
- Edge case — install via U1 triggers derive; row exists after install with no AGENTS.md edit.
- Edge case — delete the folder via Workspace tab → row removed on next derive run.

**Verification:**
- After install via U1: `SELECT * FROM agent_skills WHERE agent_id = ?` returns the new skill.
- After deleting the folder via Workspace tab: same query returns no row.
- AGENTS.md routing rows that mention orphan slugs do not produce phantom `agent_skills` rows.

---

## System-Wide Impact

- **Interaction graph:** API handlers (`skills.ts`, `workspace-files.ts`, `derive-agent-skills.ts`, `resolve-agent-runtime-config.ts`, `wakeup-processor.ts`); admin SPA (WorkspaceEditor, FolderTree, agent-templates route, AgentConfigSection); workspace-defaults. Strands runtime is unchanged — `install_skill_from_s3` still materializes from `s3Key`, but `s3Key` now points at the workspace prefix.
- **Error propagation:** Install failures surface in the catalog dialog (no silent `console.error`). Manifest regen failure on install is a P1 — recovery is a re-install or manifest re-derive.
- **State lifecycle:** `agent_skills` table widens its source set in U3 — filesystem becomes authoritative. Existing rows for AGENTS.md-routed orphans (no folder) are removed on the next derive run; flag this in the migration note if any exist on dev.
- **Unchanged invariants:** Tenant isolation (IAM at S3, tenant check in handler); reserved-folder names (`memory/`, `skills/`); `skill_resolver.py` walking precedence (local → ancestor → catalog); sub-agent skill resolution; Capabilities → Skills tab; plugin upload flow; tenant-level `installSkill`.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Hard-cut assumption fails at a non-dev stage | Pre-deploy gate: `aws s3 ls s3://thinkwork-{stage}-storage/tenants/ --recursive | grep '/skills/' | grep -v '/workspace/skills/'` against every stage. Non-zero count requires the `aws s3 mv` migration script before the install-handler PR ships. |
| Manifest not regenerated after install → admin UI shows stale tree | Explicit `regenerateManifest` call in U1 + test asserts the call. |
| derive doesn't fire after install (handler bypasses workspace-files Lambda) | U3 invokes `deriveAgentSkills` directly from the install handler. |
| Reinstalling a skill silently overwrites operator edits | U2 catalog picker checks for existing folder; prompts overwrite confirmation. |
| Strands runtime doesn't pick up the s3Key change | Verify in U1's verification step: invoke an agent after install + edit, confirm operator content executes. |
| Plugin-upload still writes to legacy `tenants/{tid}/skills/` | Out of scope; coexists. If three-storage-paths becomes a friction point, follow-up brainstorm. |

---

## Documentation / Operational Notes

- After ship, three storage paths coexist: workspace-installed (this plan), tenant-installed (Capabilities Install button — out of scope), plugin-uploaded (separate flow). If operators express confusion, follow-up brainstorm consolidates.
- The Pi runtime convention is: walk `/tmp/workspace/**/skills/<slug>/SKILL.md` (matches Strands' `skill_resolver.py` precedence). Pi's own runtime plan picks this up.
- Strands' `install_skill_from_s3` materialization is preserved. A future plan replaces it with a direct `/tmp/workspace` walk once the materialize-at-write-time refactor (`docs/plans/2026-04-27-003-refactor-materialize-at-write-time-workspace-bootstrap-plan.md`) lands.

---

## Sources & References

- **Origin:** `docs/brainstorms/2026-04-27-skills-as-workspace-folder-requirements.md`
- **Materialize plan (related, not blocking):** `docs/plans/2026-04-27-003-refactor-materialize-at-write-time-workspace-bootstrap-plan.md`
- **Plan §008 (reserved-folder convention):** `docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md`
- **Manifest regeneration:** `docs/solutions/workflow-issues/agent-builder-smoke-cleanup-needs-manifest-regeneration-2026-04-26.md`
- **Workspace-defaults parity:** `docs/solutions/workflow-issues/workspace-defaults-md-byte-parity-needs-ts-test-2026-04-25.md`
- Related code: `packages/api/src/lib/reserved-folder-names.ts`, `packages/agentcore/agent-container/install_skills.py`
