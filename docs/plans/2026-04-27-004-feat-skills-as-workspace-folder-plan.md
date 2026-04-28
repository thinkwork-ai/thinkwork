---
title: "feat: Skills as a first-class workspace folder"
type: feat
status: active
date: 2026-04-27
origin: docs/brainstorms/2026-04-27-skills-as-workspace-folder-requirements.md
---

# feat: Skills as a first-class workspace folder

## Overview

Move catalog-installed skills from the parallel S3 prefix `tenants/{slug}/agents/{slug}/skills/<slug>/` into the workspace prefix at `tenants/{slug}/agents/{slug}/workspace/skills/<slug>/`, render that folder in the admin Workspace tab, retire the standalone Skills tab, and align both the Strands and the (greenfield) Pi runtimes to walk `workspace/skills/*` instead of materializing skills via a separate `install_skill_from_s3` step.

The conceptual decision (`skills` is a reserved workspace folder) is already in the codebase: `packages/api/src/lib/reserved-folder-names.ts` lists it; `packages/agentcore-strands/agent-container/container-sources/skill_resolver.py` already walks `{folder}/skills/<slug>/SKILL.md` with local→ancestor→catalog precedence. This plan closes the **install path** and **UI** gaps so the storage layout matches the convention.

Verified greenfield: `aws s3 ls s3://thinkwork-dev-storage/tenants/ --recursive | grep '/skills/'` returns zero installed skill files. No migration burden.

---

## Implementation Progress

**As of 2026-04-27 evening (resume marker):**

| Unit                                                    | Status                                                       | Where                    |
| ------------------------------------------------------- | ------------------------------------------------------------ | ------------------------ |
| U1 — installSkillToAgent → workspace prefix             | ✅ shipped                                                   | PR #660 commit `206e045` |
| U1b — installSkillToTemplate route (P0-2)               | ✅ shipped                                                   | PR #660 commit `8979c55` |
| U2 — Workspace UI (Add-from-catalog, retire Skills tab) | ⚠️ **partial** — only FolderTree empty-folder render done    | PR #660 commit `f54c195` |
| U3 — Mobile mirror                                      | ✅ no-op (server-side U1 covers it)                          | —                        |
| U4 — derive-agent-skills filesystem walk                | ✅ shipped                                                   | PR #660 commit `2455e82` |
| U5 — Strands runtime swap                               | ❌ not started                                               | —                        |
| U6 — Pi runtime skill loader                            | ❌ not started                                               | —                        |
| U7 — Narrow wakeup-processor scope (P0-3)               | ❌ not started — has architectural subtlety, see notes below | —                        |
| U8 — `.gitkeep` marker                                  | ✅ replaced by FolderTree solution (U2 partial)              | —                        |

**Branch:** `feat/skills-as-workspace-folder` · **Worktree:** `.claude/worktrees/skills-as-workspace/` · **PR:** [#660](https://github.com/thinkwork-ai/thinkwork/pull/660) (CI green, awaiting human review/merge)

**Foundation deploy:** PR #659 (materialize-at-write-time, plan 003) merged at `b0d70ef` on 2026-04-28. As of last check, the dev deploy was still in `Terraform Apply` phase (build steps green; terraform was running for 15+ min, longer than typical). Need to verify deploy concluded successfully before U5/U6 land — those swap the runtime loader, and a broken materialize on dev would compound the failure surface.

### P0 architectural decisions made by the implementer

The plan-review section "Deferred — unresolved architectural decisions (block ce-work-as-written)" surfaced 3 P0 blockers. Resolutions:

- **P0-1 — Runtime activation targets wrong code path.** Strands' `register_skill_tools` at `server.py:1158` reads `/tmp/skills/<id>/` from the parallel prefix; `AgentSkills` plugin at `server.py:1378` is gated off when AGENTS.md exists. **Decision:** U5 replaces `install_skill_from_s3`'s S3 fetch with a local-tree walk of `/tmp/workspace/skills/` (analogous to how `delegate_to_workspace` was migrated in plan 003 U8). Both `register_skill_tools` (parent-agent loader) and the `AgentSkills` plugin (sub-agent path) are targeted in U5. Pre-condition: materialize-at-write-time deploy live on dev.
- **P0-2 — `installSkillToTemplate` doesn't exist.** **Decision:** added as U1b (shipped in PR #660). New route `POST /api/skills/template/:templateSlug/install/:skillSlug` writes to `tenants/{slug}/agents/_catalog/{templateSlug}/workspace/skills/{slug}/`. The `agent_templates.skills` JSON column stays as advisory index — retiring is separate cleanup, scope creep otherwise.
- **P0-3 — U7 bifurcation.** **Decision deferred to U7 implementation.** The existing `isTenantCustom` branch in `wakeup-processor.ts:411-414` covers both (a) agent-installed catalog skills (which U1 retires) AND (b) plugin-uploaded skills (out of scope for this plan). Bifurcating cleanly requires more code reading on `s.source` semantics — held for the next session.

### Apply-set items already incorporated

- **U4 changed from "filesystem-only" to "union with AGENTS.md routing"** — agent_skills now reflects both filesystem-discovered slugs (post-U1 the install handler writes here) and AGENTS.md-routed slugs. This way, an agent declaring a skill via routing — even if no SKILL.md is on disk yet — still surfaces in agent_skills.
- **U8 changed from `.gitkeep` to FolderTree empty-folder render** — UI-side filter is cleaner than polluting workspace-defaults with non-markdown placeholder files. `RESERVED_ROOT_FOLDERS = ["memory", "skills"]` is added unconditionally to the FolderTree at workspace root in `buildWorkspaceTree()`.

### Resume from here (next session)

**Order of attack (by risk + dependency):**

1. **Verify materialize deploy on dev landed clean.** `gh run view --workflow=Deploy --branch=main --limit 1` for the most recent commit on main. If green, smoke-test agent invocation.
2. **U2 rest** — pure frontend, no runtime risk:
   - Add "Add from catalog" item to `WorkspaceEditor.tsx` add-menu (line 739–871, sibling of existing "New Skill" at 772–780). Reuse the catalog dialog from `agent-templates/$templateId.$tab.tsx` (line 194 `addSkillDialogOpen`).
   - Remove standalone Skills tab from `agent-templates/$templateId.$tab.tsx` route definition.
   - Add deep-link redirect `/agent-templates/{id}/skills` → `/agent-templates/{id}/workspace`.
   - Right-click context menu on `skills/` folder in FolderTree (per plan-review P1).
   - Overwrite-on-install warning when `workspace/skills/<slug>/` already exists (per plan-review P1).
3. **U5** — Strands runtime swap. Inert→live seam pattern per `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md`. Two PRs: (a) introduce filesystem-walk plugin registration behind a callable seam, (b) flip the default with body-swap safety integration test. Targets BOTH `register_skill_tools` (parent) AND `AgentSkills` plugin (sub-agent).
4. **U6** — Pi runtime skill loader. Greenfield in `packages/agentcore-pi/`. Mirror U5's contract: walk `${WORKSPACE_DIR}/**/skills/<slug>/SKILL.md`, register via Pi's tool surface. Open question (per plan): does Pi have a built-in skill mechanism or does U6 author one?
5. **U7** — Resolve the `isTenantCustom` bifurcation in `wakeup-processor.ts:411-414`. Need to determine: which `s.source` values exist? (likely `'tenant'` vs `'platform'`). Plugin-uploaded skills must continue to resolve via `tenants/{ts}/skills/{slug}` since U1 only moved the agent-installed catalog path. Then narrow the removal to only the agent-installed branch.

### Plan-review apply-set still to do

These were flagged in the plan-review apply-set but haven't been applied yet:

- **[P1] Hide Capabilities → Skills Install button during the tenant-level deferral** — feature flag or conditional render so operators don't form habits around the soon-to-be-questioned tenant-level install path.
- **[P1] Mobile screen ruling** — keep `apps/mobile/app/agents/[id]/skills.tsx` as-is. No change needed; verify post-U1.
- **[P1] Right-click context menu spec** — extend U2: FolderTree gains an `onContextMenu` handler on folder rows whose path matches `^skills/` or `*/skills/`. Menu items: New Skill, Add from catalog, Delete (mirrors inline trash).
- **[P1] Overwrite-on-install warning** — U2 catalog picker scans the workspace manifest for existing `workspace/skills/<slug>/` paths; if present, dialog shows "Already installed — reinstall will overwrite edits" before confirming.
- **[P1] Deep-link redirect spec** — TanStack Router redirect `/agent-templates/{id}/skills` → `/agent-templates/{id}/workspace`. Ships with the tab removal in U2.
- **[P2] Per-stage hard-cut pre-flight gate** — before the legacy install path is removed, run `aws s3 ls s3://thinkwork-{stage}-storage/tenants/ --recursive | grep '/skills/' | grep -v '/workspace/skills/'` against every stage. If non-zero, run an `aws s3 mv` migration script as part of that stage's deploy step.
- **[P2] Plugin-upload trajectory note** — three storage paths will coexist post-ship (workspace-installed, tenant-installed, plugin-uploaded). Commit to one trajectory; plugin-upload migration becomes a tracked follow-up brainstorm.
- **[P2] Empty-folder rendering refinement** — current FolderTree solution renders memory/ and skills/ unconditionally. Plan-review wanted a `.gitkeep` filter rule too; that's not strictly needed since the folders show up regardless. Drop or adopt depending on whether ".gitkeep ever appears in S3" becomes a thing.
- **[P2] AGENTS.md orphan ruling** — U4 currently unions filesystem + AGENTS.md. The plan-review preferred filesystem-only with AGENTS.md routing as documentation. The current behavior is more permissive (declared skills still surface). If we want the stricter version, modify derive to drop AGENTS.md routing entirely and surface the routing-vs-folder mismatch as a workspace lint warning. Deferred until lint surface exists.
- **[P2] Catalog-picker state machine spec** — U2 catalog picker: closes on success, refreshes file tree after manifest regeneration, stays open with inline error on failure, in-flight state disables Install button.
- **[P2] Replace U5 body-swap fixture** — single-fixture body-swap test only catches diverging skill IDs, not diverging content. Use two fixtures (catalog version vs `/tmp/workspace/skills/x/SKILL.md` with edited frontmatter); assert seam-live path returns workspace version, registered tool docstring matches workspace SKILL.md.

---

## Problem Frame

The brainstorm (`docs/brainstorms/2026-04-27-skills-as-workspace-folder-requirements.md`) frames the gap as: skills are conceptually a workspace folder (reserved-folder-names declares it; skill_resolver walks it) but the install path writes to a parallel S3 prefix outside the workspace, so the Workspace tab in admin never shows `skills/`, the Strands install path keeps materializing to `/tmp/skills` instead of using the synced workspace tree, and the Pi runtime would inherit today's split if not corrected before its first ship.

The fix is greenfield in practice and breaks into three layers:

1. **Install path** writes to `workspace/skills/<slug>/` instead of the parallel prefix.
2. **Admin/Mobile UI** renders skills inside the Workspace tab, exposes Add-from-catalog there, and retires the standalone Skills tab. The Capabilities → Skills tab (catalog browser) is unchanged.
3. **Runtime activation** in Strands switches to filesystem-walk via the inert→live seam pattern; Pi adopts the same convention from day 1.

Layer 3 depends on the in-flight materialize-at-write-time refactor (`docs/plans/2026-04-27-003-refactor-materialize-at-write-time-workspace-bootstrap-plan.md`) landing first, so the runtime has `/tmp/workspace` to walk.

---

## Requirements Trace

- R1. Install path writes to `workspace/skills/<slug>/` (origin R1, R2)
- R2. Skill files are first-class operator-editable workspace files; no upstream catalog tracking after install (origin R3, R4, R5)
- R3. Filesystem is truth for activation — Strands and Pi register every `workspace/**/skills/<slug>/SKILL.md` they see (origin R6, R7, R12, R13)
- R4. Per-template/per-agent Skills tab is removed; Workspace tab is the single per-agent surface (origin R8)
- R5. Capabilities → Skills tab continues to serve as the catalog browser; no new nav item (origin R9 — corrected during planning per user feedback 2026-04-27)
- R6. Workspace tab Add-menu exposes "New Skill" (blank scaffold) and "Add from catalog" (clones into `workspace/skills/<slug>/`); identical behavior in template editor and agent builder (origin R10, R11)
- R7. Materialize-at-write-time plan is a prerequisite for runtime adoption (Phase C). UI/install changes (Phase A/B) ship independently (origin R14)
- R8. Workspace-defaults may include an empty `skills/` marker so the folder renders in fresh workspaces (origin R15)

**Origin actors:** A1 (operator — template editor), A2 (operator — agent builder), A3 (tenant admin — catalog), A4 (Strands runtime), A5 (Pi runtime, in development)
**Origin flows:** F1 (install catalog skill), F2 (create blank skill), F3 (edit installed skill), F4 (remove skill), F5 (browse catalog — uses existing Capabilities surface)
**Origin acceptance examples:** AE1 (covers R1, R2 — write target verification), AE2 (covers R3, R4 — edit + no drift), AE3 (covers R6, R12 — filesystem-truth activation), AE4 (covers R8, R9 — Skills tab gone, no new nav), AE5 (covers R6 — deletion = deactivation)

---

## Scope Boundaries

- **Catalog management** — uploading or editing platform skills inside `skills/catalog/` is unchanged. The existing pipeline that populates the catalog continues as-is.
- **Capabilities → Skills tab** — unchanged. It already serves as the catalog browser (search, install, upload, create). This plan does not touch it.
- **Plugin upload flow** — `packages/api/src/handlers/plugin-upload.ts` writes to `tenants/{tid}/skills/{pluginName}` via `PluginInstaller`. This is a distinct flow from catalog install and is **not** moved by this plan. If plugin uploads should also live in the workspace, that is a separate follow-up.
- **Tenant-level `installSkill` path** (`packages/api/src/handlers/skills.ts` line 138 → 938) — out of scope. The Capabilities Install button continues to write to `tenants/{slug}/skills/<slug>/`. Whether tenant-level install still makes sense in a workspace-first world is deferred (see Open Questions).
- **Upstream tracking / drift indicators** — explicitly rejected (origin R4). Installs are one-time clones.
- **Renaming the `skills/` reserved folder** — not in scope.
- **`agent_skills` DB table removal** — out of scope. The table can stay as a derived index for cross-tenant admin queries; it is no longer authoritative for activation but its content is still useful.

### Deferred to Follow-Up Work

- **Phase C (runtime activation alignment, U5–U7)** — depends on materialize-at-write-time U10 landing. Phase A and Phase B can ship first; Phase C lands when the materialize plan provides `/tmp/workspace` on both runtimes.

---

## Context & Research

### Relevant Code and Patterns

**API layer**

- `packages/api/src/handlers/skills.ts` — install router (line 250: `POST /api/skills/agent/:agentSlug/install/:skillSlug`); impl at lines 1432–1460. This is the primary write target to redirect.
- `packages/api/workspace-files.ts` — handles `put`/`delete` to arbitrary workspace paths (line 880 action dispatch). Writing `workspace/skills/<slug>/SKILL.md` already works through `put`; no new endpoint needed for blank-skill creation.
- `packages/api/src/lib/workspace-manifest.ts` — `regenerateManifest` must be called after any direct S3 mutation that bypasses workspace-files. Per `docs/solutions/workflow-issues/agent-builder-smoke-cleanup-needs-manifest-regeneration-2026-04-26.md`, the install handler must call this.
- `packages/api/src/lib/reserved-folder-names.ts` — already lists `memory` and `skills`. No change needed.
- `packages/api/src/lib/derive-agent-skills.ts` (lines 80–189) — currently AGENTS.md-only. With filesystem-truth activation, may need to union filesystem-discovered skills.
- `packages/api/src/lib/resolve-agent-runtime-config.ts` (lines 387–388, 404, 454) and `packages/api/src/handlers/wakeup-processor.ts` (multiple lines) — currently construct `s3Key` payload entries pointing at the legacy install prefix. After Phase C lands, these branches become dead code; delete in cleanup unit.

**Admin SPA**

- `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx` (lines 739–848) — hosts the `addMenu` dropdown. Already has "New Skill" gated on `capabilities.canCreateLocalSkill` (lines 772–780, dialog `showNewSkillDialog`). Need to add "Add from catalog" and verify the gate is on by default.
- `apps/admin/src/components/agent-builder/FolderTree.tsx` (line 32) — `RESERVED_ROUTING_FOLDERS = new Set(["memory", "skills"])` suppresses `skills/` from the synthetic `agents/` group, which is correct (skills/ should appear at workspace root, not nested under agents/). Verify no separate change is needed for top-level rendering.
- `apps/admin/src/lib/skill-authoring-templates.ts` — provides `buildLocalSkillPath` and `renderSkillTemplate` for blank-scaffold creation. Verify it constructs `workspace/skills/<slug>/SKILL.md`.
- `apps/admin/src/lib/skills-api.ts` (line 159) — wraps `installSkillToAgent`. Body unchanged (slugs only); only the server's write target moves.
- `apps/admin/src/components/agents/AgentConfigSection.tsx` (lines 29, 305) — calls `installSkillToAgent`. With Skills-tab removal, the install affordance migrates from this section to the WorkspaceEditor add-menu.
- `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx` — currently exposes a Skills tab (per origin doc image). Remove the tab definition.

**Mobile**

- `apps/mobile/app/agents/[id]/skills.tsx` (lines 34, 137) — calls `installSkillToAgent`. Same server change applies; mobile UI either keeps this screen as a thin wrapper or follows the admin pattern (TBD per device-specific UX).
- `apps/mobile/lib/skills-api.ts` (line 55) — same wrapper.

**Strands runtime (Phase C)**

- `packages/agentcore-strands/agent-container/container-sources/server.py` — reads `skills_config` (~lines 540–554), calls `install_skill_from_s3` (~615–700), registers AgentSkills plugin (~1120) from `/tmp/skills`.
- `packages/agentcore-strands/agent-container/container-sources/install_skills.py` — `install_skill_from_s3(s3_key, skill_id)` materializes from S3 to `/tmp/skills/{skillId}/`.
- `packages/agentcore-strands/agent-container/container-sources/skill_resolver.py` — already walks `{folder}/skills/<slug>/SKILL.md` with local → ancestor → platform-catalog precedence. Used by `delegate_to_workspace_tool.py`. No change needed for resolution; only AgentSkills plugin registration changes.

**Pi runtime (Phase C)**

- `packages/agentcore-pi/agent-container/src/server.ts` and `src/runtime/pi-loop.ts` — exist but contain zero `skill`, `workspace`, or `/tmp/workspace` references. Greenfield skill loader.

**Tests**

- `packages/api/src/__tests__/derive-agent-skills.test.ts` — mocks `composeList` and `db`; update if derive's input set broadens (U4).
- `packages/api/src/__tests__/workspace-files-handler.test.ts` — covers put/delete; add a `workspace/skills/foo/SKILL.md` put case.
- `packages/api/src/__tests__/plugin-installer.test.ts` (lines 155, 168) — asserts the plugin prefix; **out of scope** (plugin-upload not moved by this plan; tests stay).
- `packages/agentcore-strands/agent-container/test_skill_resolver.py` — pure-function coverage of `resolve_skill`; unchanged unless the walking precedence changes (it doesn't).
- `packages/agentcore-strands/agent-container/test_knowledge_pack_loader.py` (lines 107–110) — monkeypatches `install_skills.SYSTEM_WORKSPACE_DIR`; will break when `install_skill_from_s3` is removed in U5.

### Institutional Learnings

- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — the runtime swap in U5 should ship in two PRs: one introduces the filesystem-walk path behind a callable seam (inert), the next flips the default. Body-swap safety integration test asserts downstream effects (skills registered with same shape) rather than return shape.
- `docs/solutions/patterns/retire-thinkwork-admin-skill-2026-04-24.md` — canonical hard-cut deprecation template for skill-related code. Mirror its structure: pre-flight SQL count, idempotent deprecation, rollback one-liner, defensive primitives kept in place.
- `docs/solutions/workflow-issues/skill-catalog-slug-collision-execution-mode-transitions-2026-04-21.md` — `agent_skills` rows tie to skill slugs. Storage shape changes need a deliberate transition plan, never a silent replacement. Verified greenfield (zero installed skills) reduces risk to near-zero, but the lesson still informs Phase C ordering.
- `docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md` — before deleting the legacy install prefix or removing `install_skill_from_s3`, re-grep every consumer surface (Phase 1 already did this; re-verify at execution time).
- `docs/solutions/workflow-issues/agent-builder-smoke-cleanup-needs-manifest-regeneration-2026-04-26.md` — any direct S3 mutation must regenerate `manifest.json` via `packages/api/src/lib/workspace-manifest.ts`; the install handler in U1 must call `regenerateManifest`.
- `docs/solutions/workflow-issues/workspace-defaults-md-byte-parity-needs-ts-test-2026-04-25.md` — if U7 edits any `packages/workspace-defaults/files/<name>.md`, also update the inlined string constant in `packages/workspace-defaults/src/index.ts`. CI parity test rejects drift.
- Auto-memory `project_agents_folder_ui_only_decision` — storage stays FOG-pure; FolderTree groups routed top-folders under synthetic `agents/`. `skills/` should render at workspace root, NOT under `agents/`.

---

## Key Technical Decisions

- **Hard cut on dev, no dual-read transition.** Verified zero installed skill files on dev. The legacy install path is removed in the same PR that ships the new path. _Rationale_: greenfield state validated empirically; any other stage with installed skills can be one-shot moved at deploy time, but on current evidence none exist.
- **Inert→live seam for the Strands runtime swap (U5).** Two PRs: introduce filesystem-walk plugin registration behind a callable seam; flip the default with a body-swap safety integration test that asserts the same skills get registered. _Rationale_: matches `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md`; prevents a single PR from mutating both the call sites and the body simultaneously.
- **Reuse the existing Capabilities → Skills tab as the catalog browser.** No new nav item. _Rationale_: the page already exists with Skills | Built-in Tools | MCP Servers | Plugins tabs and full install/upload/create affordances; adding a parallel surface would duplicate without value (corrected during planning per user feedback).
- **derive-agent-skills.ts unions filesystem-discovered skills with AGENTS.md routing rows (U4).** Filesystem is truth for runtime activation, but `agent_skills` table is a derived admin-query index. After this change, the table reflects both AGENTS.md-routed skills and filesystem-discovered skills, so admin queries see the full picture. _Rationale_: avoids a confusing state where `workspace/skills/foo/` exists, the runtime loads it, but `agent_skills` shows nothing.
- **Plugin-upload path stays put.** `plugin-installer.ts` continues writing to `tenants/{tid}/skills/{pluginName}`. _Rationale_: plugin upload is a different flow (operator uploads a packaged plugin, not a catalog install); changing both paths in one plan multiplies blast radius.
- **Phase C waits on materialize-at-write-time U10.** UI/install changes (Phase A/B) ship independently because they are pure storage prefix changes invisible to the runtime. _Rationale_: runtime walking `/tmp/workspace/skills/*` requires the bootstrap to materialize there, which the materialize plan delivers. Decoupling lets the operator UX unblock now without waiting for the longer runtime refactor.

---

## Open Questions

### Resolved During Planning

- **Q: Add a global Skill Catalog nav item?** No — the existing Capabilities → Skills tab already serves this role (corrected per user feedback 2026-04-27).
- **Q: How does derive-agent-skills behave with filesystem-discovered skills?** Union — it walks both AGENTS.md routing rows and `workspace/skills/<slug>/SKILL.md` files, deduplicating by slug.
- **Q: Where does "Add from catalog" affordance live?** In the WorkspaceEditor add-menu (sibling of "New Skill") and in the right-click context menu when right-clicking the `skills/` folder. The dialog reuses the existing catalog list source from `apps/admin/src/lib/skills-api.ts` (`listCatalog`).

### Deferred from 2026-04-27 review

ce-doc-review surfaced 19 actionable findings (3 P0, 9 P1, 7 P2). Five mechanical fixes auto-applied silently. The remaining findings break into three buckets — **deferred (architecturally unresolved)**, **apply-set (concrete fixes the implementer should land before or during ce-work)**, and **FYI (advisory only)**. Each finding below is recorded with severity and short rationale; see the original review run in this conversation for full evidence quotes.

**Deferred — unresolved architectural decisions (block ce-work-as-written):**

- **[P0] Runtime activation targets wrong code path.** Phase A ships a silent UX regression: install handler writes to `workspace/skills/<slug>/`, but Strands' workspace-mode parent-agent loader (`register_skill_tools` at `server.py:1158`) still reads `/tmp/skills/<id>/` materialized by `install_skill_from_s3` from catalog `s3Key`. U5 targets the `AgentSkills` plugin (`server.py:1378`) which is gated off when AGENTS.md exists. Materialize plan U10 only covers `skill_resolver.py` (sub-agent path), not the parent-agent loader. **Decision needed:** restructure Phase A so it does not ship without (a) a Phase A.5 unit that hot-redirects the runtime to read the agent's S3 prefix at invocation time, or (b) extending materialize U10 to cover `register_skill_tools` + `install_skill_from_s3` removal. _Verified against `server.py:1158, 1378, 1907`, `resolve-agent-runtime-config.ts:386-388`, materialize plan U10 scope._
- **[P1] Pi AgentSkills equivalent unresolved.** Pi runtime has zero skill-loading code today. Whether Pi has a built-in skill mechanism or U6 must author one from scratch is a research item that materially changes U6 sizing. Resolve before sequencing U6.

**Apply-set — concrete fixes to land in ce-work (annotated changes the plan author selected during walk-through but were not surgically edited into the unit bodies due to volume):**

- **[P0] Add `installSkillToTemplate` unit.** Templates store skills as JSON on `agent_templates.skills` column today; no `installSkillToTemplate` route exists. Add a new unit (likely U1.5) for `installSkillToTemplate(tenantSlug, templateId, skillSlug)` writing to `tenants/{slug}/agents/_catalog/{templateSlug}/workspace/skills/<slug>/`. Decide and document: retire the `agent_templates.skills` JSON column (filesystem-only) OR keep as parallel index. Specify `createAgentFromTemplate`'s skill-copy semantics in the same unit.
- **[P0] U7 bifurcation: preserve platform-catalog auto-injection.** U7 must remove ONLY the `agent_skills`-table iteration in `wakeup-processor.ts:398-426` (the `isTenantCustom ? tenants/.../skills/... : skills/catalog/...` branch). Auto-injection of `agent-email-send`, `agent-thread-management`, `artifacts`, `workspace-memory`, built-ins, and Google integrations stays — these are platform skills feeding the runtime via `skillsConfig`, not operator-installed.
- **[P1] U4 is filesystem-only, not a union.** Walk `workspace/**/skills/<slug>/SKILL.md`; emit one `agent_skills` row per discovered slug. AGENTS.md `Skills` column rows become documentation. Orphan references (slug in AGENTS.md, no folder) surface as a workspace lint warning surface (out of scope for this plan; recorded as future work). Honors brainstorm R6/R7's filesystem-as-truth decision.
- **[P1] Hide Capabilities → Skills Install button during the tenant-level deferral.** Add a Phase A sub-unit that hides the affordance via feature flag or conditional render. Code stays; UI gate-off prevents operators from forming habits around the soon-to-be-questioned tenant-level install path.
- **[P1] Mobile screen ruling.** U3 keeps `apps/mobile/app/agents/[id]/skills.tsx` as-is. Server-side U1 already moves the install destination; OAuth/credential flows on mobile stay untouched. No retirement in this plan.
- **[P1] Right-click context menu spec.** Extend U2: FolderTree gains an `onContextMenu` handler on folder rows whose path matches `^skills/` or `*/skills/`. Menu items: New Skill, Add from catalog, Delete (mirrors inline trash). No context menu on file nodes or non-skills folders in this plan.
- **[P1] Overwrite-on-install warning.** U2 catalog picker scans the workspace manifest for existing `workspace/skills/<slug>/` paths; if present, dialog shows "Already installed — reinstall will overwrite edits" before confirming. Prevents silent loss of operator edits per R4.
- **[P1] Deep-link redirect spec.** TanStack Router redirect rule: `/agent-templates/{id}/skills` → `/agent-templates/{id}/workspace`. Lands at workspace root; no file selection preserved. Ships with the tab removal in U2.
- **[P1] derive-agent-skills walker primitive.** Use `ListObjectsV2` with prefix `tenants/{slug}/agents/{slug}/workspace/` and a regex match on `skills/[^/]+/SKILL\.md$`. Avoids manifest-format dependency on the materialize plan.
- **[P1] U4 dependency rewritten.** Current text "the materialize-at-write-time plan's read-from-prefix behavior for derive-agent-skills should already be in place" is backward. Plan 003 U14 depends on U4, not vice versa. Replace with: "U1 (so workspace prefix has skills to discover). Plan 003 U14 will later finalize the migration off composeList; U4 extends the current implementation."
- **[P2] Per-stage hard-cut pre-flight gate.** Before the legacy install path is removed, run `aws s3 ls s3://thinkwork-{stage}-storage/tenants/ --recursive | grep '/skills/' | grep -v '/workspace/skills/'` against every stage. If non-zero, run an `aws s3 mv` migration script as part of that stage's deploy step. Required gate, not contingent.
- **[P2] Plugin-upload trajectory note.** Documentation/Operational Notes adds: three storage paths will coexist post-ship (workspace-installed, tenant-installed, plugin-uploaded). Commit to one trajectory: plugin-upload migration becomes a tracked follow-up brainstorm before the next stage gets installed plugins.
- **[P2] Collapse U3 into U1 verification.** U3 has no mobile code change ("Server-side change in U1 already moves the write target"). Move U3's content into U1's Verification block as "Mobile verification". Renumber subsequent units: U4→U3, U5→U4, U6→U5, U7→U6.
- **[P2] Move workspace-defaults `skills/` marker out of U7 (Phase C) into U2 (Phase A).** The marker has zero runtime dependency — it only affects FolderTree rendering for fresh agents. Ship in Phase A so fresh agents see `skills/` immediately, not only post-install.
- **[P2] Empty-folder rendering: ship `.gitkeep` + filter rule.** Add `packages/workspace-defaults/files/skills/.gitkeep`. FolderTree filters `.gitkeep` files from the visible file list but renders the parent folder. Sync inlined constant in `packages/workspace-defaults/src/index.ts`.
- **[P2] AGENTS.md orphan ruling for U4.** With filesystem-only derivation (above), AGENTS.md skill references with no corresponding folder produce no `agent_skills` row and no UI indicator in this plan. TODO comment in `derive-agent-skills.ts` notes this as a future observability gap (lint warning surface).
- **[P2] Catalog-picker state machine spec for U2.** Picker closes on success and refreshes file tree after manifest regeneration confirms the folder. On failure, dialog stays open with inline error (not just `console.error`). In-flight state disables Install button and shows row spinner. Mirrors mobile pattern in `skills.tsx:362-365`.
- **[P2] Replace U5 body-swap fixture.** Single-fixture body-swap test only catches diverging skill IDs, not diverging content. Use two fixtures: catalog version of skill X and a `/tmp/workspace/skills/x/SKILL.md` with intentionally edited frontmatter. Assert the seam-live path returns the workspace version (not catalog) and that the registered Strands tool's docstring matches workspace SKILL.md, not catalog.

**FYI — advisory observations (no action required):**

- Detached-after-install forecloses skill upgrades at enterprise scale. Catalog skills are starter snapshots, not maintained assets — once installed, security fixes or behavior improvements landed centrally cannot propagate. This is a deliberate position; the trade-off is named here so a future incident does not surface it as a surprise.
- No cross-cutting "which agents have skill X" navigation surface exists post-ship. The Capabilities → Skills tab is a catalog browser, not an installed-skills index. If operators at the 400+-agent scale need this view, surface as a follow-up brainstorm reading the `agent_skills` table.

### Deferred to Implementation

- **[Affects U1]** Whether the install handler should always call `regenerateManifest` synchronously after the S3 copy, or whether it should rely on the workspace-files Lambda's own manifest regeneration when invoked through that path. Resolve by reading `packages/api/src/lib/workspace-manifest.ts` and the existing put/delete flow in `packages/api/workspace-files.ts`.
- **[Affects U2]** Whether the FolderTree's reserved-folder suppression needs an explicit "render at workspace root" code path or if it already works because the synthetic `agents/` group is built off routed folders only. Resolve by reading `apps/admin/src/components/agent-builder/FolderTree.tsx` `buildWorkspaceTree()`.
- **[Affects U3]** Mobile-specific UX — whether the existing `apps/mobile/app/agents/[id]/skills.tsx` screen stays (as a thin install screen) or is removed in favor of a workspace file browser. Decision can be deferred until mobile work begins.
- **[Affects U5][Needs research]** Whether the AgentSkills plugin needs to receive an `<available_skills>` XML hint (current behavior) or if walking `/tmp/workspace/skills/*` produces the equivalent shape natively. Resolve by reading the AgentSkills plugin source.
- **[Affects U6][Needs research]** Whether Pi has a built-in skill loader equivalent to Strands' AgentSkills, or whether U6 needs to author one from scratch. Resolve by reading the Pi runtime brainstorm + pi-mono base.
- **[Affects U7]** Whether the workspace-defaults `skills/` marker is a `.gitkeep`-style file or a `README.md`. Resolve by checking how the FolderTree handles empty folders.
- **[Affects scope]** Whether the tenant-level Capabilities Install button should still write to `tenants/{slug}/skills/<slug>/` or be reframed once skills are workspace-first. Defer to a follow-up brainstorm.

---

## Implementation Units

### Phase A — Storage and admin/mobile UI (independent of materialize plan)

- U1. **Move `installSkillToAgent` write target to the workspace prefix** — ✅ **shipped** (PR #660)

**Goal:** The install handler copies catalog files to `tenants/{tenantSlug}/agents/{agentSlug}/workspace/skills/{skillSlug}/...` instead of the parallel `tenants/{tenantSlug}/agents/{agentSlug}/skills/{skillSlug}/`. Manifest regeneration runs after the copy.

**Requirements:** R1, R2 (origin R1, R2)

**Dependencies:** none

**Files:**

- Modify: `packages/api/src/handlers/skills.ts` (impl ~lines 1432–1460; the `agentPrefix` construction)
- Modify: `packages/api/src/lib/workspace-manifest.ts` only if `regenerateManifest` doesn't already exist as a callable from skills.ts
- Test: `packages/api/src/__tests__/skills-handler.test.ts` (create if absent — handler-level coverage gap noted in Phase 1 research)

**Approach:**

- Change the destination prefix in `installSkillToAgent`'s S3 copy loop. Source (`skills/catalog/{slug}/`) and copy semantics stay identical.
- After the copy completes, invoke `regenerateManifest` for the agent's workspace prefix so admin/runtime consumers see the new files in the manifest.
- Confirm the legacy prefix is no longer written by anyone (Phase 1 research listed `installSkillToAgent` as the sole writer to `tenants/X/agents/Y/skills/`).

**Patterns to follow:**

- Existing CopyObjectCommand loop in the same file (no change to loop body, only the prefix variable).
- Manifest regeneration after S3 mutation per `docs/solutions/workflow-issues/agent-builder-smoke-cleanup-needs-manifest-regeneration-2026-04-26.md`.

**Test scenarios:**

- Happy path — `installSkillToAgent` for a fresh agent writes every catalog file under `workspace/skills/{slug}/` and writes nothing under the legacy `skills/{slug}/` prefix. Covers AE1.
- Happy path — manifest is regenerated after install (assert `regenerateManifest` was called with the agent prefix).
- Error path — install fails partway through copy → no partial state in the workspace prefix (existing rollback semantics; assert no file remains).
- Edge case — installing a skill that already exists overwrites cleanly (or rejects, depending on existing behavior; preserve current semantics).

**Verification:**

- `aws s3 ls s3://thinkwork-dev-storage/tenants/{slug}/agents/{slug}/workspace/skills/{slug}/` returns the catalog files after install.
- `aws s3 ls s3://thinkwork-dev-storage/tenants/{slug}/agents/{slug}/skills/` returns nothing post-install.
- Manifest at `tenants/{slug}/agents/{slug}/workspace/manifest.json` includes the new skill files.

---

- U1b. **Add `installSkillToTemplate` route (P0-2 fix from plan review)** — ✅ **shipped** (PR #660 commit `8979c55`)

**Goal:** Templates need a parallel install path so the agent-template editor's "Add from catalog" can target the template's `_catalog/{templateSlug}/workspace/skills/{slug}/` prefix. New agents created from the template inherit installed skills via `createAgentFromTemplate`'s bootstrap step (plan 003 U3 → bootstrapAgentWorkspace).

**Requirements:** R1, R2 (extends U1)

**Files modified:**

- `packages/api/src/handlers/skills.ts` — new route handler `installSkillToTemplate(tenantSlug, templateSlug, skillSlug)` and route dispatch for `POST /api/skills/template/:templateSlug/install/:skillSlug`.

**Decisions:**

- The `agent_templates.skills` JSON column stays as advisory index — retiring is separate cleanup, scope creep otherwise.
- Templates don't have their own per-instance manifest the way agents do; new installs propagate via `createAgentFromTemplate`'s bootstrap (or future rematerialize action from plan 003 U4).

---

- U2. **WorkspaceEditor: Add-from-catalog action; FolderTree renders skills/ at workspace root; remove standalone Skills tab from agent-template editor** — ⚠️ **PARTIAL** (FolderTree empty-folder render shipped in PR #660 commit `f54c195`; Add-from-catalog dialog + Skills-tab retirement + deep-link redirect still to do — see "Resume from here" above)

**Goal:** The Workspace tab in both the agent-template editor and the agent builder is the single per-agent surface for skill management. The add-menu exposes "New Skill" (already present) and a new "Add from catalog" action. The skills/ folder appears at workspace root in the file tree. The standalone Skills tab on the agent-template editor route is removed.

**Requirements:** R4, R6 (origin R8, R10, R11)

**Dependencies:** U1 (install handler must write to workspace prefix before the UI exposes "Add from catalog")

**Files:**

- Modify: `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx` (add-menu structure 739–871; existing New Skill item at 772–780 — add "Add from catalog" item; right-click context menu for the skills/ folder is greenfield in FolderTree)
- Modify: `apps/admin/src/components/agent-builder/FolderTree.tsx` (verify `buildWorkspaceTree()` renders top-level `skills/` at workspace root; line 32 reserved-set suppression should remain for synthetic `agents/` grouping only)
- Modify: `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx` (remove the `Skills` tab definition; route to Workspace tab as the default skill-management surface)
- Modify: `apps/admin/src/components/agents/AgentConfigSection.tsx` (lines 29, 305 — remove the Skills section if it lives here, or repoint to the WorkspaceEditor)
- Modify: `apps/admin/src/lib/skill-authoring-templates.ts` (verify `buildLocalSkillPath` produces `skills/<slug>/SKILL.md` — the workspace-files Lambda's `agentKey()` prepends `workspace/` server-side, so no client change should be needed)
- Test: `apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.test.tsx` (extend or add) — assert add-menu shows both "New Skill" and "Add from catalog"; assert "Add from catalog" calls `installSkillToAgent` with correct args; assert "New Skill" creates a `workspace/skills/<slug>/SKILL.md` put

**Approach:**

- Reuse the existing catalog dialog component (currently used by `AgentConfigSection.tsx`'s `addSkillDialogOpen`) — extract or import it into WorkspaceEditor.
- The "New Skill" action already exists (line 772–780) gated on `capabilities.canCreateLocalSkill`; verify the gate is on for both agent and template contexts.
- `Add from catalog` invokes `installSkillToAgent(tenant.slug, agentSlug, slug)` (or the template equivalent — see U1's open-question note about whether template uses a separate install path).
- Tab removal is a route-config change; ensure deep links to `/agent-templates/{id}/skills` redirect to `/agent-templates/{id}/workspace`.

**Patterns to follow:**

- Existing add-menu structure in `WorkspaceEditor.tsx` (line 739–848 — the dropdown with `New File`, `Add Sub-agent`, `New Skill`, `Add docs/folder`, etc.).
- Existing catalog dialog state in `agent-templates/$templateId.$tab.tsx` (line 194 `addSkillDialogOpen` + line 487–509 `addSkill()`).

**Test scenarios:**

- Happy path — clicking "Add from catalog → research-assistant" in WorkspaceEditor calls `installSkillToAgent` and refreshes the file tree to show `workspace/skills/research-assistant/`.
- Happy path — clicking "New Skill", entering slug `foo`, results in a `put` to `workspace/skills/foo/SKILL.md` with the template-rendered starter content. Covers AE2.
- Happy path — agent-template editor renders only Configuration / Workspace / MCP Servers tabs (no Skills tab). Covers AE4.
- Edge case — right-clicking the skills/ folder shows the same Add-from-catalog and New-Skill actions as the top-level add-menu.
- Edge case — `workspace/skills/` renders at the workspace root, NOT under the synthetic `agents/` group (verify FolderTree's reserved-set suppression behaves correctly).

**Verification:**

- Admin UI screenshot matches origin doc's Workspace tab showing `skills/`, `memory/`, and the markdown files.
- No `Skills` tab visible in agent-template editor.
- E2E: install via UI → file tree refreshes → new folder visible.

---

- U3. **Mobile: mirror admin install path change** — ✅ **no-op** (server-side U1 covers it; `apps/mobile/app/agents/[id]/skills.tsx` continues to call the same `installSkillToAgent` route which now writes to the workspace prefix)

**Goal:** Mobile clients use the same workspace-prefix install destination. Either the existing skills screen stays as a thin install wrapper, or it is removed in favor of a workspace file browser (defer to mobile UX).

**Requirements:** R1, R6 (origin R1, R10, R11)

**Dependencies:** U1

**Files:**

- Modify: `apps/mobile/app/agents/[id]/skills.tsx` (lines 34, 137 — `installSkillToAgent` call; no signature change needed since only the server-side write target moves)
- Modify: `apps/mobile/lib/skills-api.ts` (line 55 — verify wrapper still works)

**Approach:**

- Server-side change in U1 already moves the write target. Mobile client wrappers don't need code changes if they only pass slugs.
- Decide whether to keep the standalone skills screen on mobile or fold it into a workspace-file browser if one exists. Default: keep the screen as-is for now; mobile workspace browsing is a separate brainstorm.

**Patterns to follow:**

- Existing `apps/mobile/lib/skills-api.ts` wrapper.

**Test scenarios:**

- Happy path — mobile install of a catalog skill writes to the workspace prefix (verified via the server unit test in U1; mobile-side coverage just confirms the call shape is unchanged).

**Verification:**

- TestFlight build still loads the agent skills screen and install completes without error.

---

### Phase B — Activation index alignment

- U4. ✅ **shipped** (PR #660 commit `2455e82`) — **`derive-agent-skills.ts`: union filesystem-discovered skills with AGENTS.md routing**

**Goal:** The `agent_skills` table reflects both AGENTS.md routing rows (existing behavior) and filesystem-discovered skills under `workspace/**/skills/<slug>/SKILL.md`. Admin queries see the same set of skills the runtime will activate.

**Requirements:** R3 (origin R6, R7)

**Dependencies:** U1 (so workspace prefix has skills to discover); the materialize-at-write-time plan's read-from-prefix behavior for `derive-agent-skills` (origin R8 in materialize plan) should already be in place.

**Files:**

- Modify: `packages/api/src/lib/derive-agent-skills.ts` (the AGENTS.md iteration at lines 96–115 + DB reconciliation at 119–180 — extend the AGENTS.md-row source with a filesystem-walk over `workspace/**/skills/<slug>/SKILL.md` paths; deduplicate by slug)
- Test: `packages/api/src/__tests__/derive-agent-skills.test.ts` — add cases for filesystem-only skills, AGENTS.md-only skills, and overlap

**Approach:**

- Walk the agent's workspace prefix (or the locally synced manifest) for paths matching `^(workspace/)?(.*/)?skills/([^/]+)/SKILL\.md$`. Capture the slug.
- Union with the AGENTS.md routing rows. Deduplicate by slug; collapse on first source priority (filesystem wins, since that's what the runtime will load).
- Existing insert/delete logic stays unchanged — just the input set broadens.

**Patterns to follow:**

- Existing `composeList(...)` pattern in derive-agent-skills.ts.
- `skill_resolver.py`'s walking precedence (local → ancestor → catalog) — derive should mirror the same path predicate.

**Test scenarios:**

- Happy path — agent with `workspace/skills/foo/SKILL.md` (no AGENTS.md row) produces an `agent_skills` row for `foo`.
- Happy path — agent with AGENTS.md routing for `bar` (no filesystem folder) produces an `agent_skills` row for `bar` (existing behavior).
- Happy path — agent with both filesystem and AGENTS.md sources for `baz` produces one row (deduplicated).
- Edge case — sub-agent skill at `workspace/sales-agent/skills/qux/SKILL.md` produces a row scoped to the sub-agent context (preserve existing scoping semantics).
- Edge case — empty `workspace/skills/foo/` (no SKILL.md) does not produce a row.

**Verification:**

- Existing tests pass without modification.
- New tests pass.
- Manual: install a skill via U1 path, then query `agent_skills` table; row exists.

---

### Phase C — Runtime activation alignment (depends on materialize-at-write-time plan)

- U5. ❌ **not started** (depends on materialize-at-write-time PR #659 deploy being verified live on dev) — **Strands: replace `install_skill_from_s3` with filesystem-walk via inert→live seam**

**Goal:** The Strands runtime registers `AgentSkills` for every `workspace/**/skills/<slug>/SKILL.md` it finds in the locally synced workspace tree at `/tmp/workspace`. The legacy `install_skill_from_s3` materialization to `/tmp/skills/` is retired. The change ships in two PRs per the inert→live seam pattern.

**Requirements:** R3, R7 (origin R12, R14)

**Dependencies:** materialize-at-write-time U10 (skill_resolver consumes local synced tree) plus the workspace bootstrap that produces `/tmp/workspace`. **Do not start this unit until those have landed.**

**Files:**

- Modify: `packages/agentcore-strands/agent-container/container-sources/server.py` (~lines 540–554 skills_config consumption; ~615–700 install loop; ~1120 AgentSkills plugin registration)
- Delete (PR 2): `packages/agentcore/agent-container/install_skills.py` (this is the canonical location — `find packages/agentcore-strands -name 'install_skills*'` returns nothing; Strands' server.py imports from this file at lines 43, 365, 1907)
- Modify (PR 2): `packages/agentcore-strands/agent-container/container-sources/server.py` — remove `from install_skills import install_skills` (line 43), `from install_skills import install_workspace` (line 365), `from install_skills import install_skill_from_s3` (line 1907)
- Test: `packages/agentcore-strands/agent-container/test_strands_skill_loader.py` (new) — body-swap safety integration test asserting the same set of skills gets registered when the seam flips

**Approach:**

- **PR 1 (inert):** Introduce a `walk_workspace_skills(workspace_dir: str) -> list[str]` helper that returns absolute paths to every `<workspace>/**/skills/<slug>/SKILL.md`. Wire AgentSkills plugin registration through a callable seam: production passes `seam_fn=None` and falls through to the existing `/tmp/skills` materialization. Add a unit test for the helper and a no-op integration test confirming the seam contract.
- **PR 2 (live):** Flip the default — `seam_fn` returns `walk_workspace_skills('/tmp/workspace')`. Remove `install_skill_from_s3` and the `skills_config` consumption branch. Body-swap safety integration test asserts the same `AgentSkill` instances get registered as before for a fixture workspace.
- The `skill_resolver.py` walking precedence stays unchanged (it already does the right thing). Only the AgentSkills plugin registration changes.

**Execution note:** Apply the inert→live seam swap pattern from `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md`. Body-swap safety integration test asserts downstream effects (skills registered with same shape) rather than return shape.

**Patterns to follow:**

- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — exact pattern.
- Existing `skill_resolver.py` walking convention (mirror its path predicate).

**Test scenarios:**

- Happy path — a workspace at `/tmp/workspace` containing `skills/foo/SKILL.md` and `sub-agent/skills/bar/SKILL.md` produces two `AgentSkill` registrations after the seam flips. Covers AE3.
- Happy path — empty workspace produces zero registrations (no error).
- Edge case — `workspace/skills/foo/` without SKILL.md is ignored (existing skill_resolver behavior).
- Integration — body-swap safety: seam=None and seam=walk_workspace_skills produce identical AgentSkills registrations for a fixture workspace.
- Error path — workspace sync hasn't run yet (`/tmp/workspace` missing) → log + register zero skills (don't crash; the runtime should still boot).

**Verification:**

- Strands container boots, registers expected skills based on synced workspace, and answers a chat invocation that uses one of them.
- Old `/tmp/skills` directory is no longer created.
- `install_skill_from_s3` is no longer referenced anywhere in the runtime.

---

- U6. **Pi runtime: filesystem-walk skill loader (greenfield)** — ❌ **not started** (depends on U5's contract being settled first)

**Goal:** The Pi runtime registers skills by walking `/tmp/workspace/**/skills/<slug>/SKILL.md` and exposing each as an agent-callable skill via the Pi-equivalent of the Strands AgentSkills plugin.

**Requirements:** R3 (origin R13)

**Dependencies:** materialize-at-write-time U7 or equivalent for Pi (so Pi has `/tmp/workspace`); U5 ideally landed first so the convention is concrete.

**Files:**

- Create: `packages/agentcore-pi/agent-container/src/runtime/skills.ts` (or similar — TypeScript helper that walks the synced workspace and returns skill descriptors)
- Modify: `packages/agentcore-pi/agent-container/src/server.ts` and/or `src/runtime/pi-loop.ts` (register skills at boot)
- Test: `packages/agentcore-pi/agent-container/src/runtime/__tests__/skills.test.ts`

**Approach:**

- Mirror `walk_workspace_skills` from U5 in TypeScript: walk the local workspace directory, find every `*/skills/<slug>/SKILL.md`, return descriptors with slug + path + parsed SKILL.md frontmatter.
- Wire registration into the Pi runtime's startup. If Pi has a built-in skill mechanism (TBD per Open Questions), use it; otherwise expose skills as callable tools.
- Mirror Strands' `<available_skills>` progressive disclosure if applicable.

**Patterns to follow:**

- The TypeScript equivalent of Strands' `walk_workspace_skills` shape (exact same file predicate).
- Existing Pi runtime tool registration (see `src/runtime/tools/{web-search,mcp,execute-code,hindsight}.ts`).

**Test scenarios:**

- Happy path — workspace with `skills/foo/SKILL.md` registers `foo` as an available skill.
- Happy path — sub-agent skill at `sub-agent/skills/bar/SKILL.md` registers correctly within the sub-agent context.
- Edge case — empty workspace returns zero skills (no error).
- Error path — missing `/tmp/workspace` → log + register zero skills (boot succeeds).

**Verification:**

- Pi container boots, walks the synced workspace, registers expected skills.
- A Pi-runtime chat invocation that exercises a workspace skill completes successfully.

---

- U7. ❌ **not started** — **architectural subtlety flagged**: the `isTenantCustom` branch in `wakeup-processor.ts:411-414` covers BOTH agent-installed catalog skills (which U1 retires) AND plugin-uploaded skills (out of scope for this plan). Bifurcating cleanly requires more code reading on `s.source` semantics. Held for next session. — **Cleanup: remove dead skills_config construction; workspace-defaults skills/ marker**

**Goal:** With Phase C live, the `s3Key` construction in `resolve-agent-runtime-config.ts` and `wakeup-processor.ts` becomes dead code. Remove it. Add an empty `skills/` marker to workspace-defaults so the folder renders in fresh workspaces.

**Requirements:** R8 (origin R15)

**Dependencies:** U5 and U6

**Files:**

- Modify: `packages/api/src/lib/resolve-agent-runtime-config.ts` (lines 387–388, 404, 454 — remove `skills_config` construction; runtime no longer consumes it)
- Modify: `packages/api/src/handlers/wakeup-processor.ts` (lines 413–414, 468, 493, 514–517, 556, 792, 843–844 — remove the same construction)
- Modify: `packages/workspace-defaults/files/skills/.gitkeep` (or appropriate marker — TBD per Open Questions)
- Modify: `packages/workspace-defaults/src/index.ts` (sync inlined-string constant per `docs/solutions/workflow-issues/workspace-defaults-md-byte-parity-needs-ts-test-2026-04-25.md`)
- Test: `packages/workspace-defaults/src/__tests__/parity.test.ts` (existing) — should pass without modification

**Approach:**

- Search for any remaining `skills_config` references in TS code; remove.
- Verify `wakeup-processor.ts` still functions for non-skill payloads after the cleanup.
- Add the marker file to workspace-defaults; sync the inlined constant; run `pnpm --filter @thinkwork/workspace-defaults test`.

**Test scenarios:**

- Happy path — wakeup-processor still produces correct payload for a non-skill wakeup after the cleanup.
- Happy path — workspace-defaults parity test passes.
- Edge case — fresh agent created from defaults shows `skills/` folder in the WorkspaceEditor.

**Verification:**

- `rg 'skills_config' packages/api packages/agentcore-strands packages/agentcore-pi` returns no matches.
- Fresh agent's WorkspaceEditor shows the empty `skills/` folder.
- Workspace-defaults parity test passes.

---

## System-Wide Impact

- **Interaction graph:** Affected components are `apps/admin` (WorkspaceEditor, FolderTree, agent-templates route, AgentConfigSection), `apps/mobile` (skills screen + skills-api wrapper), `packages/api` (skills.ts handler, derive-agent-skills.ts, workspace-manifest.ts, resolve-agent-runtime-config.ts, wakeup-processor.ts), `packages/agentcore-strands/agent-container` (server.py, install_skills.py removal), `packages/agentcore-pi/agent-container` (greenfield skill loader), `packages/workspace-defaults` (optional marker). The legacy parallel S3 prefix becomes write-dead after U1; reads from it stop after U7.
- **Error propagation:** If U1 fails partway through copy, no partial state lands in the workspace prefix (preserve existing rollback). If U5's seam flip exhibits unexpected differences, the body-swap safety test catches it before merge. If U6 fails to find a workspace, log + register zero skills rather than crashing the runtime.
- **State lifecycle risks:** The `agent_skills` DB table widens its source set in U4. Existing rows for AGENTS.md-routed skills are preserved; new filesystem-discovered rows are added. Deletion of a skill folder leads to deletion of its `agent_skills` row on next derive run.
- **API surface parity:** The `installSkillToAgent` HTTP route signature is unchanged (`POST /api/skills/agent/:agentSlug/install/:skillSlug` with empty body). Only the server's S3 destination moves. Both admin and mobile clients work without wrapper changes.
- **Integration coverage:** End-to-end on dev — install a catalog skill via UI → verify file in workspace prefix → verify manifest updated → verify next agent invocation registers the skill.
- **Unchanged invariants:**
  - Tenant isolation (IAM at S3 + tenant check in handler).
  - Reserved folder names (`memory/`, `skills/`).
  - `skill_resolver.py` walking precedence (local → ancestor → platform catalog).
  - Sub-agent skill resolution semantics (Plan §008 fat-folder convention).
  - Capabilities → Skills tab (catalog browser).
  - Plugin upload flow (`plugin-installer.ts`).
  - Tenant-level `installSkill` path (deferred decision).

---

## Risks & Dependencies

| Risk                                                                                               | Mitigation                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Other consumers of the legacy install prefix that Phase 1 research missed                          | Re-grep at execution time per `docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md`: `rg -l 'tenants/.*agents/.*/skills/' packages apps`. |
| Phase C ordering against materialize-at-write-time                                                 | Phase A and Phase B can ship first because they are pure storage prefix changes invisible to the runtime. Phase C is gated explicitly on the materialize plan landing.                 |
| `regenerateManifest` not called from the install handler → admin sees stale manifest after install | U1 explicit test asserts the call.                                                                                                                                                     |
| `derive-agent-skills` filesystem walk performance                                                  | The walk happens on the agent's manifest, not raw S3 listing. Manifest lookup is O(files). For the 4 enterprises × 100+ agents × ~5 templates scale, this is bounded.                  |
| Strands runtime regression when seam flips in U5                                                   | Body-swap safety integration test asserts identical AgentSkill registrations. Inert→live seam pattern allows a one-PR revert.                                                          |
| Pi runtime missing built-in skill loader                                                           | U6 authors one if needed; deferred research item already flagged.                                                                                                                      |
| Workspace-defaults `.md` byte parity drift                                                         | U7 syncs the inlined constant per the existing CI parity test (will fail loudly if missed).                                                                                            |
| Plugin-upload path also writing to `tenants/X/skills/` continues to confuse the picture            | Out of scope per scope boundaries; revisit in a follow-up brainstorm if it becomes a friction point.                                                                                   |

---

## Documentation / Operational Notes

- The materialize-at-write-time plan should be updated to reference this plan as a downstream consumer (Phase C dependency).
- `packages/workspace-defaults/files/AGENTS.md` and similar may benefit from a brief note that `skills/` folders are runtime-active by presence — defer to U7 if it would help operators discover the convention.
- No production data migration needed (verified greenfield on dev). If a non-dev stage is found to have installed skills, a one-shot `aws s3 mv` operation moves them; this plan can include that script but does not assume it's needed.
- After Phase A ships, communicate to operators that the standalone Skills tab is gone; per-agent skill management is in the Workspace tab.

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-27-skills-as-workspace-folder-requirements.md`
- **Materialize-at-write-time plan (Phase C dependency):** `docs/plans/2026-04-27-003-refactor-materialize-at-write-time-workspace-bootstrap-plan.md`
- **Plan §008 (fat-folder reserved-folder convention):** `docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md`
- **Inert→live seam pattern:** `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md`
- **Manifest regeneration requirement:** `docs/solutions/workflow-issues/agent-builder-smoke-cleanup-needs-manifest-regeneration-2026-04-26.md`
- **Workspace-defaults parity:** `docs/solutions/workflow-issues/workspace-defaults-md-byte-parity-needs-ts-test-2026-04-25.md`
- **Hard-cut deprecation template:** `docs/solutions/patterns/retire-thinkwork-admin-skill-2026-04-24.md`
- **Pre-execution consumer survey:** `docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md`
- **Slug-collision lessons:** `docs/solutions/workflow-issues/skill-catalog-slug-collision-execution-mode-transitions-2026-04-21.md`
- Related code: `packages/api/src/lib/reserved-folder-names.ts`, `packages/agentcore-strands/agent-container/container-sources/skill_resolver.py`
