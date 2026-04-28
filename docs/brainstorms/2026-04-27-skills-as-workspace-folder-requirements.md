---
date: 2026-04-27
topic: skills-as-workspace-folder
---

# Skills as a First-Class Workspace Folder

## Problem Frame

Skills are conceptually a core part of an agent's workspace — `packages/api/src/lib/reserved-folder-names.ts` already lists `skills` as reserved alongside `memory`, the Strands runtime's `skill_resolver.py` already walks `{folder}/skills/{slug}/SKILL.md` with local → ancestor → platform-catalog precedence, and the materialize-at-write-time plan (in flight) already moves the runtime to read skills from the locally synced workspace tree.

But the **install/UI path is misaligned**. Today, when an operator clicks **Add Skill** in the Agent Template editor or the Agent Builder, files are copied from the catalog into a parallel S3 prefix at `tenants/{slug}/agents/{slug}/skills/{slug}/` — *outside* the workspace prefix. As a result:

- The Workspace tab in the Agent Template editor renders only `memory/`, `CAPABILITIES.md`, etc., and never shows `skills/` (because skills aren't in the workspace prefix).
- The Agent Template editor exposes a **separate "Skills" tab** that is conceptually disjoint from the Workspace tab even though both edit the same agent.
- The Agent Builder exposes a **"New Skill"** action in its add-menu that is structurally different from the `Add memory/ folder` action sitting two rows below it.
- The Strands `skill_resolver.py` walking convention works correctly for sub-agent skills (Plan §008 fat folders), but for root-level agents the install path doesn't write to the location the resolver expects, so the resolver never finds anything there.
- The forthcoming Pi harness has no convention to inherit — it would inherit today's split and replicate the inconsistency.

The fix is to make the install path target the workspace prefix at `workspace/skills/<slug>/`, render that folder in the Workspace tab, retire the standalone Skills tab, and let the existing Strands resolver + Pi harness pick up skills the same way they pick up every other workspace file: by walking the locally synced tree.

The fix is greenfield in practice — verified against `s3://thinkwork-dev-storage/tenants/` there are zero installed skill files anywhere on dev. No migration burden.

---

## Actors

- A1. **Operator (template editor)**: edits an agent template's workspace and skills via the admin SPA; the template's workspace is what new agents get materialized from.
- A2. **Operator (agent builder)**: edits a specific agent's workspace and skills via the admin SPA; mutations land in that agent's S3 prefix.
- A3. **Tenant admin (skill catalog)**: browses the platform skill catalog at the tenant level; clones catalog skills into agents/templates.
- A4. **Strands runtime**: reads workspace files from `/tmp/workspace` (post materialize-at-write-time U10), registers `AgentSkills` for every `workspace/**/skills/<slug>/SKILL.md` it walks.
- A5. **Pi runtime (parallel substrate, in development)**: must adopt the same convention from day 1; should not need its own install path.

---

## Key Flows

- F1. **Install a catalog skill into an agent's workspace**
  - **Trigger:** A2 right-clicks the `skills/` folder in the Workspace tab of the Agent Builder and selects **Add from catalog → choose skill**.
  - **Actors:** A2, A3 (the catalog the skill comes from).
  - **Steps:**
    1. Admin selects a skill slug from the catalog dialog.
    2. The install handler copies every file under `skills/catalog/{slug}/` to `tenants/{tenantSlug}/agents/{agentSlug}/workspace/skills/{slug}/`.
    3. The Workspace tab refreshes; `skills/{slug}/` appears as an editable folder under the workspace tree.
    4. Existing `derive-agent-skills.ts` runs (unchanged) if AGENTS.md was also touched.
    5. On the next agent invocation, Strands' workspace bootstrap syncs the new files to `/tmp/workspace`; `skill_resolver.py` walks the tree and registers the new skill.
  - **Outcome:** The skill is editable in the workspace tree and active at the next runtime turn. No write to the legacy `tenants/X/agents/Y/skills/` prefix.
  - **Covered by:** R2, R3, R6, R10

- F2. **Create a blank skill from scratch**
  - **Trigger:** A2 clicks **New Skill** in the Workspace tab's add-menu (or right-clicks `skills/` → **New Skill**).
  - **Actors:** A2.
  - **Steps:**
    1. Admin enters a slug.
    2. The handler writes a starter `workspace/skills/<slug>/SKILL.md` (template content) to S3.
    3. Workspace tab refreshes; operator can edit `SKILL.md` and add files (scripts, references) directly.
  - **Outcome:** A new local skill exists in the workspace tree with no catalog linkage.
  - **Covered by:** R3, R4, R6

- F3. **Edit an installed skill's SKILL.md or scripts**
  - **Trigger:** A2 opens any file under `workspace/skills/<slug>/` in the Workspace tab.
  - **Actors:** A2.
  - **Steps:**
    1. Admin edits the file in the workspace file editor.
    2. Save writes through the standard workspace-files Lambda (after the materialize-at-write-time refactor lands).
    3. The change is visible to the runtime on the next sync.
  - **Outcome:** Skill files behave like any other workspace file. No "drift from catalog" warning, no upstream tracking — the install was a one-time clone.
  - **Covered by:** R4, R5

- F4. **Remove a skill from an agent**
  - **Trigger:** A2 right-clicks `skills/<slug>/` and chooses **Delete**.
  - **Actors:** A2.
  - **Steps:** Standard workspace-files Lambda recursive delete under that prefix. Workspace tab refreshes; Strands no longer sees the folder on next sync.
  - **Outcome:** Skill is gone. No DB cleanup needed if `agent_skills` derivation is filesystem-driven (see R12).
  - **Covered by:** R6

- F5. **Browse the platform skill catalog**
  - **Trigger:** A3 clicks **Capabilities** in the existing left nav, then the **Skills** tab (alongside Built-in Tools / MCP Servers / Plugins).
  - **Actors:** A3.
  - **Steps:**
    1. The existing Capabilities → Skills page already lists every catalog skill at `s3://.../skills/catalog/*` with name, description, category, version, type, and install status.
    2. Operator can browse, search, install (tenant-level), upload, or create catalog skills here — this surface already exists and is unchanged by this brainstorm.
  - **Outcome:** No new nav item is added. The brainstorm's UI changes are limited to the per-agent / per-template Workspace tabs.
  - **Covered by:** R7, R8

---

## Requirements

**Storage layout**

- R1. The install path for a catalog skill into an agent or template MUST write to the workspace prefix at `tenants/{slug}/agents/{agentSlug}/workspace/skills/{skillSlug}/...` (and the analogous template prefix). The legacy parallel `tenants/{slug}/agents/{agentSlug}/skills/...` write path MUST be removed in the same change. *Verified by code read*: zero installed skill files exist on dev today, so removal is a hard cut with no migration.
- R2. The install handler MUST copy every file under `skills/catalog/{slug}/` (recursively) to the new workspace location, identical to current copy semantics — only the destination prefix changes.

**Edit model**

- R3. Skill files (SKILL.md, scripts, supporting files) under `workspace/skills/<slug>/` MUST be first-class workspace files: editable through the workspace file editor, deletable via folder delete, creatable from scratch via **New Skill**.
- R4. After install, an installed skill MUST be **detached** from its catalog source. There is no upstream version tracking, no drift indicator, no "update available" UI. The install is a one-time clone; subsequent edits belong to the operator.
- R5. Direct edits to skill files MUST go through the same workspace-files Lambda path that handles other workspace edits (no special-casing required — once the storage layout is unified, the path is generic).

**Activation**

- R6. The runtime MUST treat the **filesystem as truth**: every `workspace/**/skills/<slug>/SKILL.md` discovered in the locally synced tree is registered as an `AgentSkill`, with the existing `skill_resolver.py` walking precedence (local → ancestor → platform catalog). Presence of the folder = active. To deactivate, delete the folder.
- R7. AGENTS.md `Skills` column rows MUST become **optional documentation**, not a runtime gate. Existing AGENTS.md files that list skills continue to render in the routing table, but the runtime does not require a skill to appear there for it to load. *Verified by code read*: `derive-agent-skills.ts` already runs from AGENTS.md routing rows and writes to the `agent_skills` table; that derivation is unaffected by this change.

**Admin UI**

- R8. The per-template and per-agent **Skills tab** MUST be removed. All skill management for a single agent/template happens inside its Workspace tab.
- R9. **No new global nav item.** The existing **Capabilities → Skills** tab already serves as the catalog browser (with search, install, upload, create). It stays as-is. Per-agent install reaches the same catalog via the Workspace tab's "Add from catalog" flow.
- R10. The Workspace tab's add-menu (`...` button on the file tree) MUST expose **New Skill** (creates blank `workspace/skills/<slug>/SKILL.md`) and **Add from catalog** (opens catalog picker, then performs the R1 install). The same actions appear in the right-click menu when right-clicking the `skills/` folder.
- R11. The same UI affordances MUST be present in the Agent Template editor (Workspace tab) and the Agent Builder (workspace file tree), with identical behavior — only the destination prefix differs (template prefix vs agent prefix).

**Cross-runtime parity**

- R12. The Strands runtime MUST stop calling `install_skill_from_s3(s3_key, skill_id)` to materialize skills into `/tmp/skills/`. Skills MUST be loaded by walking `/tmp/workspace/**/skills/<slug>/SKILL.md` after the workspace sync completes. The `skills_config` payload from the chat-invoke handler becomes optional metadata; the runtime does not depend on it for activation.
- R13. The Pi runtime MUST adopt the same convention from day 1: walk the locally synced workspace tree, register every `skills/<slug>/SKILL.md` it finds via the equivalent of Strands' `AgentSkills` plugin in the Pi runtime. No separate install/copy step.
- R14. The materialize-at-write-time plan (`docs/plans/2026-04-27-003-refactor-materialize-at-write-time-workspace-bootstrap-plan.md`) is a **prerequisite**. R12 and R13 cannot land cleanly until U10 (skill_resolver consumes local synced tree) and the workspace-bootstrap-on-runtime work in that plan ship. This brainstorm's UI/install changes (R1–R11) can land independently of the materialize plan because they are pure storage-prefix changes invisible to the runtime until invocation time.

**Workspace defaults**

- R15. The platform `workspace-defaults/` MAY add an empty `skills/` folder marker so newly bootstrapped agents render the folder in the tree without requiring a skill to be installed first. This is a polish item, not blocking.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given an agent with no installed skills, when the operator selects **Add from catalog → research-assistant** in the Workspace tab, then `aws s3 ls s3://thinkwork-dev-storage/tenants/{slug}/agents/{slug}/workspace/skills/research-assistant/` returns the catalog files (recursive copy), AND `aws s3 ls s3://thinkwork-dev-storage/tenants/{slug}/agents/{slug}/skills/research-assistant/` returns nothing (legacy path is not written).
- AE2. **Covers R3, R4.** Given an installed `research-assistant` skill, when the operator opens `workspace/skills/research-assistant/SKILL.md` and edits a line, then save succeeds via the workspace-files Lambda, AND the next view shows the edited content, AND there is no UI indicator suggesting the skill has drifted from the catalog version.
- AE3. **Covers R6, R12.** Given a workspace with `workspace/skills/research-assistant/SKILL.md` present and **no row** in the `agent_skills` DB table for that agent + skill, when the next agent turn fires, then Strands registers `research-assistant` as an active `AgentSkill` (filesystem is truth, DB is not consulted for activation).
- AE4. **Covers R8, R9.** Given the admin SPA after this work ships, when the operator opens an agent template, then there is no **Skills** tab in the template editor (only Configuration, Workspace, MCP Servers), AND the sidebar shows no new nav items (the existing **Capabilities → Skills** tab continues to serve as the catalog browser).
- AE5. **Covers R6.** Given a workspace with `workspace/skills/foo/` present and the operator deletes the folder via the Workspace tab, when the next agent turn fires, then Strands does not register `foo` (deletion = deactivation).

---

## Success Criteria

- **Operator outcome**: Opening any agent template or agent in the admin shows a single Workspace tab where `skills/` sits next to `memory/` and the markdown files. Adding, editing, and removing skills uses the same mental model as adding/editing/removing any other workspace file. The standalone Skills tab and the bespoke "New Skill" add-menu entry are gone.
- **Runtime outcome**: Strands and Pi both pick up skills by walking the locally synced workspace tree. There is no separate `install_skill_from_s3` materialization step on either runtime. The same `workspace/skills/<slug>/SKILL.md` file works identically across both runtimes with no per-runtime adapter.
- **Storage outcome**: `aws s3 ls s3://thinkwork-dev-storage/tenants/ --recursive | grep '/skills/' | grep -v '/workspace/skills/'` returns zero results in steady state. The parallel install prefix is fully retired.
- **Downstream-agent handoff**: A planner reading this document can produce an implementation plan without needing to invent product behavior — the install handler change, the UI tab removal, the catalog nav item, the runtime walking convention, and the Pi adoption are all named with their target locations.

---

## Scope Boundaries

- **Catalog management UI** — uploading or editing platform skills inside `skills/catalog/` is out of scope. Whatever pipeline populates the catalog today continues unchanged. The new **Skill Catalog** nav item is read-only browse + preview only.
- **Upstream tracking / drift indicators** — explicitly rejected (see R4). If we later want a "this skill was installed from catalog version X" badge, that is a future brainstorm.
- **Renaming the `skills/` reserved folder** — not in scope. The name stays.
- **Changing the `skills_config` payload shape on chat-invoke** — out of scope; payload becomes optional metadata but is not removed in this work.
- **Hindsight memory store changes** — out of scope; this brainstorm is about skills, not memory.
- **Sub-agent skill semantics beyond what Plan §008 already defined** — out of scope; the existing local → ancestor → platform-catalog precedence stays unchanged.
- **Killing the `agent_skills` DB table** — out of scope. The table can stay as a derived index for cross-tenant admin queries; it is no longer authoritative for activation but its content (derived from AGENTS.md routing) is still useful and is not load-bearing.

---

## Key Decisions

- **Filesystem is truth for skill activation.** Presence of `workspace/skills/<slug>/SKILL.md` in the synced tree = active. AGENTS.md Skills column becomes documentation; `agent_skills` DB row is no longer required. *Rationale*: matches how `memory/` already works; eliminates dual sources of truth that would otherwise drift; uses the existing `skill_resolver.py` walking convention without modification.
- **Detached after install.** The catalog → workspace install is a one-time clone with no upstream linkage. *Rationale*: simplest model; matches operator expectation that workspace files are theirs; defers the entire "drift indicator" / "upgrade flow" surface area; consistent with the user's prior pattern of treating the workspace as authoritative ground truth.
- **Kill the per-agent/per-template Skills tab; reuse the existing Capabilities → Skills tab as the catalog browser.** Per-agent skill management collapses into the per-agent Workspace tab. Library browsing already exists on the Capabilities page (Skills | Built-in Tools | MCP Servers | Plugins) — no new nav item is added. *Rationale*: separates "manage this agent" from "browse the library" without inventing a new surface; eliminates the disjoint mental model between Workspace tab and Skills tab; matches the X drawn in the screenshot.
- **Greenfield cut, no migration.** *Rationale*: verified zero installed skill files on dev (`aws s3 ls s3://thinkwork-dev-storage/tenants/ | grep skills/` returns nothing). The legacy install path can be deleted in the same change as the new one ships, with no dual-read transition.
- **UI/storage changes can ship before the materialize-at-write-time plan completes.** R1–R11 are pure prefix changes invisible to the runtime until invocation. R12–R13 (runtime adoption) wait for materialize plan U10 + workspace-bootstrap-on-runtime to land. *Rationale*: lets us unblock the operator UX immediately while the runtime work proceeds on its own cadence.

---

## Dependencies / Assumptions

- **Materialize-at-write-time plan U10** (skill_resolver consumes local synced tree) and the workspace-bootstrap-on-runtime work are prerequisites for R12 (Strands stops calling `install_skill_from_s3`). The brainstorm doc for that work is `docs/brainstorms/2026-04-27-materialize-at-write-time-workspace-bootstrap-requirements.md`; the plan is `docs/plans/2026-04-27-003-refactor-materialize-at-write-time-workspace-bootstrap-plan.md`.
- **Plan §008 fat-folder convention** (sub-agent skills + reserved-folder names) is assumed in place. *Verified by code read*: `packages/api/src/lib/reserved-folder-names.ts` lists `skills` as reserved; `skill_resolver.py` walks `{folder}/skills/{slug}/SKILL.md`.
- **Workspace-files Lambda** already handles arbitrary workspace prefix paths — no new endpoint needed for skill file CRUD; the existing PUT/DELETE on `workspace/skills/<slug>/<file>` paths just works.
- **Catalog at `s3://thinkwork-dev-storage/skills/catalog/`** is the canonical source for the **Add from catalog** flow; it is not changed by this work.
- **Pi runtime is in development** (per memory: parallel substrate brainstorm 2026-04-26). Adopting the convention from day 1 means R13 lands in the Pi work, not as a retrofit.
- **Greenfield install state** is verified for dev (zero installed skill files). Assuming the same is true for any other live stage; if a stage has installed skills, R1 needs a one-shot move script — but on current evidence this is a non-issue.

---

## Outstanding Questions

### Resolve Before Planning

(none)

### Deferred to Planning

- [Affects R10][Technical] Where does **New Skill / Add from catalog** sit in the file tree's add-menu UI — is it a top-level menu entry like the current "New Skill" / "Add memory/ folder" entries, or is it a context-menu-only action when right-clicking the `skills/` folder, or both? Plan should pick a pattern consistent with how `Add memory/ folder` is exposed.
- [Affects R9][Technical] The existing **Capabilities → Skills** tab Install button performs a tenant-level install (writes to `tenants/X/skills/<slug>/`). Plan should decide whether tenant-level skill installs continue to make sense once skills are operator-editable workspace files at the agent level — or whether the tenant-level install should also be reframed (or removed) to avoid two install destinations from the same surface.
- [Affects R12, R13][Needs research] Does the Pi runtime need its own equivalent of Strands' `AgentSkills` plugin (progressive disclosure, `<available_skills>` XML injection, on-demand SKILL.md loading via a `skills` tool), or does the Pi base provide a different built-in mechanism that should be wired up instead? Plan should answer this from the Pi runtime brainstorm + pi-mono base.
- [Affects R15][Technical] How does the workspace-defaults bootstrap currently handle empty folders — is a `.gitkeep`-style marker required to make the folder render in the tree, or does the Workspace tab show empty reserved folders without a marker? Plan should verify against `apps/admin/src/routes/...templates/$templateId.$tab.tsx`.
- [Affects R7][Technical] Should the Workspace tab visually indicate when an AGENTS.md `Skills` column row references a skill that no longer exists in `workspace/skills/`? Decision is small but worth a one-liner in the plan.

---

## Next Steps

`-> /ce-plan` for structured implementation planning. Recommended split: one plan covers R1–R11 (storage + admin UI; ships independently of the materialize plan), and a follow-up unit (or a small plan tail) covers R12–R13 (runtime adoption) once the materialize-at-write-time plan's U10 + bootstrap work lands.
