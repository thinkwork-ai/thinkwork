---
date: 2026-05-24
topic: folder-is-the-agent-thinkwork-alignment
---

# Folder is the Agent — ThinkWork Alignment

## Summary

Establish the canonical ThinkWork interpretation of the "folder is the agent" pattern: one master platform agent per tenant whose tree IS the agent, workspaces (subagent folders) holding capability under a real `master/workspaces/` parent folder, Spaces holding only context (SPACE.md, knowledge, members, privacy, email — no skills/tools/MCP), per-user memory only, and a consolidated root file canon (AGENTS.md + CONTEXT.md + GUARDRAILS.md + USER.md). Anchors supersession for three in-flight brainstorms/plans; leaves the in-flight Pi skill catalog work untouched.

---

## Problem Frame

ThinkWork has spent three years moving toward a folder-is-the-agent product shape. Five brainstorms and four in-flight plans currently encode the runtime, all converging on the same direction but with terminology drift and unresolved choices accumulating between them. Five different markdown filenames sit at the master agent root (`SOUL.md`, `IDENTITY.md`, `GUARDRAILS.md`, `PLATFORM.md`, `CAPABILITIES.md`) when the cross-vendor convention is one always-loaded map file (`AGENTS.md`). The 2026-05-22 commitment described Spaces as capability-bearing context overlays (Space-level `skills/`, `TOOLS.md`, `MCP.md`), but operator framing of Spaces is consistently "extra context, KBs, files, public/private" — context-only. Storage uses synthetic UI grouping (`agents/`) while operator language uses "workspaces." The system-prompt builder loads files in a specific sequence but no document names the order, even though the source pattern treats reading order as load-bearing.

Operators, planners, and reviewers cannot point at a single document that says "this is what a ThinkWork agent looks like in the filesystem and in what order things are read." That gap is the cost of the accumulated alignment debt. Without it, every new feature has to re-derive product shape from five interlocking brainstorms, and every plan reviewer has to reconstruct which file goes where and what's allowed to live in it.

---

## Actors

- A1. **Tenant admin**: edits the master agent's workspace (AGENTS.md, CONTEXT.md, GUARDRAILS.md, workspace folders, baseline `skills/`); authors and configures Spaces; installs skills from the catalog.
- A2. **Space author**: configures a Space — SPACE.md, members, privacy, attached KBs/files, optional email opt-in.
- A3. **End user**: opens or participates in a thread inside a Space; mentions workspaces via `@`; triggers turns.
- A4. **Platform renderer**: composes the master agent baseline + active Space + invoking user into a per-tuple rendered workspace at turn time.
- A5. **Agent runtime (Pi/Strands container)**: syncs the rendered prefix to `/tmp/workspace`, builds the system prompt in the pinned reading order, runs the turn.
- A6. **Automation source**: scheduled job, connector webhook, or subagent delegation that invokes the runtime without a human user.

---

## Key Flows

- F1. **End user starts a thread in a Space and mentions a workspace**
  - **Trigger:** A3 opens a thread in the `finance` Space, types `@sql`.
  - **Actors:** A3, A4, A5
  - **Steps:** Server resolves the `(master_agent, finance_space, user)` tuple. Renderer composes the master baseline + finance Space tree + user folder into a cached S3 prefix. Runtime syncs to `/tmp/workspace`. System-prompt builder loads files in the pinned reading order: `AGENTS.md`, `CONTEXT.md`, `GUARDRAILS.md`, `spaces/finance/SPACE.md`, `USER.md`. Agent walks `AGENTS.md` routing, follows `@sql` to `workspaces/sql/`, reads its `CONTEXT.md`, executes.
  - **Outcome:** The agent operates with master baseline + Space context + user context; capability comes from baseline and the `@sql` workspace; the Space contributes only context overlay.
  - **Covered by:** R1, R2, R3, R8, R9, R12, R20

- F2. **Tenant admin edits the master agent**
  - **Trigger:** A1 opens the Agent Detail Workspace tab and edits any file in the master tree.
  - **Actors:** A1
  - **Steps:** Admin edits `AGENTS.md` hand-authored sections, or `CONTEXT.md`, or `GUARDRAILS.md`, or any workspace folder file. On save, the file lands in the master baseline S3 prefix. The editor regenerates the two derived sections of `AGENTS.md` (`## Folder Structure`, `## Skills & Tools`) from a tree walk. The renderer invalidates all rendered tuples `(master_agent, *, *)`.
  - **Outcome:** Subsequent turns rerender. Hand-authored AGENTS.md sections round-trip byte-identical; derived sections reflect the current tree. Cache invalidation scope is master-side here: writes to the master tree invalidate `(master_agent, *, *)`. Space-tree writes use F3's `(*, this_space, *)` scope; the two invalidation rules are independent and both must fire on their respective edits.
  - **Covered by:** R4, R5, R6, R7, R23

- F3. **Tenant admin creates and configures a Space**
  - **Trigger:** A1 creates a Space and edits its content.
  - **Actors:** A1, A2
  - **Steps:** Bootstrap seeds an initial `SPACE.md` from a default template. Space author edits SPACE.md, attaches KB files to `knowledge/`, sets privacy (public/private), adds members (private only), optionally opts into email triggers. No `skills/`, `TOOLS.md`, or `MCP.md` is created. Renderer invalidates `(*, this_space, *)`.
  - **Outcome:** Future turns in this Space see SPACE.md + knowledge/ + the standard rendered context layers. The Space contributes context, not capability.
  - **Covered by:** R10, R11, R12, R13, R14

- F4. **Tenant admin installs a skill from the catalog**
  - **Trigger:** A1 right-clicks the master's `skills/` folder and selects "Add Skill."
  - **Actors:** A1
  - **Steps:** This flow is governed by the `2026-05-24-pi-agent-skill-catalog-and-workspace-install-requirements.md` brainstorm, which stands as committed. Under Model A the only mechanical change is that Spaces have no `skills/` folder to install into — the install scope is master baseline and (where workspace folders carry their own `skills/`) any subagent workspace.
  - **Outcome:** Catalog skill copied into target `skills/<slug>/` + CONTEXT.md routing row written + `.catalog-ref.json` records install state. Drift detection and Reinstall continue to operate as designed.
  - **Covered by:** R21, R22

---

## Requirements

**Architectural primitives**

- R1. There is exactly one master platform agent per tenant. The `agents` DB table has one row per tenant; existing FKs continue to reference it unchanged. (Carries forward from the 2026-05-22 brainstorm; pinned here as canonical.)
- R2. The master agent's filesystem tree IS the agent. Identity, behavior, routing, baseline skills, and subagent folders all live in the workspace tree. Specialization comes from folder structure, not DB rows. (Carries forward; pinned.)
- R3. Workspaces are subagent folders inside the master tree, each located at `master/workspaces/<slug>/`. Each workspace can hold its own `CONTEXT.md`, `skills/`, sub-subagent folders, and other scope-local artifacts. Workspaces are enumerated by `AGENTS.md` routing; `@`mention resolves by walking the rendered tree to the target workspace folder, not by DB lookup.

**File naming canon at master root**

- R4. The master agent root contains exactly four canonical files, none of which may be replaced or renamed by feature work:
  - `AGENTS.md` — the always-loaded map. Contains two derived sections (`## Folder Structure`, `## Skills & Tools`) plus hand-authored sections including `## What This Is`, `## Personality`, `## Identity`, `## Platform Behavior`, `## Quick Navigation`, `## ID & Naming Conventions`, `## File Placement Rules`, `## Cross-Workspace Flow`, and `## Token Management`. The Personality / Identity / Platform Behavior sections absorb content previously held in `SOUL.md`, `IDENTITY.md`, and `PLATFORM.md`. The Skills & Tools section absorbs the operator-visible content previously held in `CAPABILITIES.md`.
  - `CONTEXT.md` — the root router. Operator-authored. Maps "what kind of task you're starting" → "which workspace to enter, which scope-local files to load."
  - `GUARDRAILS.md` — constraints and prohibitions. Standalone for edit-isolation; safety-critical and frequently reviewed by compliance.
  - `USER.md` — per-user identity facts. Server-managed; written by the platform on identity events. Composed into the rendered workspace only when an invoking user is present.
- R5. The files `SOUL.md`, `IDENTITY.md`, `PLATFORM.md`, and `CAPABILITIES.md` are retired from the master root. Their content moves into the named hand-authored sections of `AGENTS.md` per R4.
- R6. `AGENTS.md` regeneration on editor save preserves all hand-authored sections byte-identical. Only the two derived sections (`## Folder Structure`, `## Skills & Tools`) are rewritten. The 2026-05-23 editor-driven regen brainstorm's section-boundary parser applies unchanged; it gains additional preserved section names but no parser changes.
- R7. The two derived sections are both **tree-walk-derived**:
  - `## Folder Structure` is rendered by recursively walking the master S3 prefix (matches the 2026-05-23 brainstorm R5–R8).
  - `## Skills & Tools` is rendered by walking the tree for `skills/<slug>/SKILL.md` packages — master baseline `skills/` plus every workspace folder's `skills/` recursively. The `agent_skills` DB table is no longer the source of truth for this section.
- R7a. The `## Knowledge Bases` and `## Workflows` derived sections from the 2026-05-23 brainstorm are dropped. KB content is per-Space (not master-level) under Model A; multi-step workflows were retired with the System Workflows revert.

**Reading order at session start**

- R8. The system-prompt builder loads master-root files in this pinned order:
  1. `AGENTS.md`
  2. `CONTEXT.md`
  3. `GUARDRAILS.md`
  4. Active Space's `SPACE.md` (when an active Space is present)
  5. `USER.md` (when an invoking user is present)
- R8a. **No-user composition.** When no invoking user is present (automation-source A6 invocations — scheduled jobs, connector webhooks, parent-less subagent delegations), `USER.md` is omitted from the rendered workspace entirely and the system-prompt builder skips the `USER.md` slot. The platform does not synthesize a service-account or sentinel `USER.md`; consumers (memory tools, USER-aware skills, prompt sections that reference user identity) must handle the null case explicitly.
- R9. After R8's root load, the agent routes per `CONTEXT.md` to enter a specific workspace; the entered workspace's `CONTEXT.md` is then loaded as the scope router for that subtree.

**Workspaces (subagent folders)**

- R10. Workspaces live at `master/workspaces/<slug>/` under a real parent folder. The slug is the workspace's identifier; FOG/FITA imports normalize `.claude/agents/X/` → `workspaces/X/` on import. Each workspace contains at minimum a `CONTEXT.md` (scope router); it may also contain `skills/`, nested workspaces (sub-subagents), and any other scope-local artifacts.
- R11. Workspaces now live in storage at `master/workspaces/<slug>/` — the synthetic UI `agents/` group fabrication is retired and the file-tree UI shows the actual `workspaces/` folder. This reverses the storage-side of the 2026-04-26 "agents/ folder is UI fabrication, not storage" decision: agent-shaping content moves from flat-storage (`master/<slug>/`) to nested (`master/workspaces/<slug>/`) so storage and UI both use the operator-facing "workspaces" noun. The rationale for the reversal is documented under Key Decisions.

**Spaces (context-only overlays)**

- R12. Spaces are context-only. A Space's authored tree contains:
  - `SPACE.md` — startup instructions, operator-authored (parallel by role with USER.md, not by writer); mandatory, bootstrap-seeded from a default template.
  - `knowledge/` — KB content, attached files; operator-authored or uploaded.
  - Member and privacy state (DB-resident; not file-resident).
  - Email address derivation and `email_triggers_enabled` toggle (unchanged from 2026-05-22 R26–R31).
- R13. Spaces do NOT contain `skills/`, `TOOLS.md`, `MCP.md`, or any capability-additive declarations. The capability-bearing Space framing from 2026-05-22 R17–R19 is revised: Spaces add context only. Capability comes from master baseline + workspace folders, callable via `@`mention.
- R14. Spaces can declare which workspaces are mentionable inside the Space via a `## Mentionable Workspaces` H2 section in `SPACE.md`, containing a fenced code block with one workspace slug per line (e.g., a fenced block listing `sql` and `finance-analyst` on separate lines). The renderer parses this section to filter routable workspaces during turn composition. **Precedence defaults:** when the section is absent, all top-level workspaces in `AGENTS.md` are mentionable by default. When the section exists but its fenced block is empty, no workspaces are mentionable inside this Space — the agent can still read SPACE.md and `knowledge/` but cannot `@`route to any subagent. This preserves the per-Space-routing capability formerly served by `space_agent_assignments` (already dropped per 2026-05-22 R4) without requiring Space-level capability surfaces.

**Memory model**

- R15. Per-user Hindsight bank stays (existing). Per-Space Hindsight bank is **not provisioned in v1**. The 2026-05-22 brainstorm's R10, R20, R21, R22, and R24 are revised accordingly:
  - Recall fans only over the speaker user's Hindsight bank.
  - `remember()` writes to the speaker user's bank; the `scope='user'` opt-out becomes the only mode.
  - Multi-player threads share within-thread context via thread messages; cross-thread shared Space facts are supplied by operator-authored SPACE.md and attached knowledge, not by an agent memory bank.
- R16. The cross-thread Space-memory design space is reserved for v1.5. Two paths stay open: a filesystem-resident `spaces/<slug>/memory/` folder agents can write into, or re-adding a per-Space Hindsight bank. Choice deferred until real demand surfaces.

**Storage and migration**

- R17. The S3 layout under each tenant's master prefix is:
  ```
  master/
    AGENTS.md
    CONTEXT.md
    GUARDRAILS.md
    USER.md           (per-user, composed in at render time — see R23)
    skills/           (baseline skill packages)
    memory/           (reserved name; agent-writable)
    artifacts/        (reserved name; agent-writable)
    workspaces/       (parent folder for subagents)
      <slug>/
        CONTEXT.md
        skills/       (optional, subagent-local)
        ...
  spaces/
    <slug>/
      SPACE.md
      knowledge/
      ...
  ```
- R18. A one-time tenant tree migration moves existing flat-storage subagent folders from `master/<slug>/` to `master/workspaces/<slug>/`, **deletes the four retired root files** (`SOUL.md`, `IDENTITY.md`, `PLATFORM.md`, `CAPABILITIES.md`) **after absorbing their content into the named `AGENTS.md` sections per R5**, and rewrites AGENTS.md routing rows. The migration is mechanical-by-shape and owned by ce-plan; this brainstorm fixes the target state, not the migration mechanics.
- R18a. The migration sequence is **write-then-delete, per tenant**: (1) compose the new AGENTS.md absorbing the four retired files' content into their named sections; (2) verify the absorption landed and no safety-critical content (any in-flight GUARDRAILS material that may have been authored into the retired files) is among the soon-to-be-deleted material; (3) write `master/workspaces/<slug>/` for each subagent folder; (4) only then delete the retired root files and the flat subagent folders. Migration is per-tenant rollback-able — a partial failure on tenant N does not block tenants M..M+k.

**Rendering and runtime**

- R19. The per-tuple rendered workspace from the 2026-05-22 brainstorm continues to compose `(master_agent_baseline, active_space, invoking_user)` per turn. Under Model A the active Space layer contributes only SPACE.md + knowledge/ — no skill/tool/MCP composition. The renderer's composition rules simplify accordingly.
- R19a. **Render-layer authorization for private Spaces.** Before composing a private Space's `SPACE.md` and `knowledge/` into the rendered workspace, the renderer (A4) must verify the invoking actor against the DB-resident Space membership record. This gate applies to BOTH human-user (A3) invocations AND automation-source (A6) invocations — the A6-specific authorization model (what identity an A6 source presents, how it's resolved against membership) is an open design item in Outstanding Questions. A failed membership check returns an authorization error to the caller; no rendered prefix is produced. Editor-layer rejection of capability-additive files inside Space trees (AE5) is a write-side defense, not a substitute for this render-side gate.
- R20. The Pi runtime walks the rendered tree as it does today (`discoverWorkspaceSkills` and equivalent). **No runtime changes are required for capability discovery** — the tree walk already supports both baseline `skills/` and workspace-local `skills/`. R5 (retired root files) and R8 (pinned reading order) DO require updates to the system-prompt loader's `PROMPT_FILES` (or equivalent) list in both the Pi runtime (`packages/agentcore-pi/agent-container/src/runtime/system-prompt.ts`) and the Strands runtime (`packages/agentcore-strands/agent-container/container-sources/server.py`); these two loaders must stay in sync per the existing Pi-side "Strands `_build_system_prompt` mirrors this order" comment.

**Skill catalog (in-flight; not revised)**

- R21. The 2026-05-24 Pi skill catalog brainstorm (`docs/brainstorms/2026-05-24-pi-agent-skill-catalog-and-workspace-install-requirements.md`) **stands as committed**. Its install action, drift detection via sha256, Reinstall, WIRING.md format, and Skills tab in Agent Detail are all in scope of its own plan and are not modified by this brainstorm.
- R22. The catalog brainstorm's install-scope set reduces mechanically under Model A from {baseline, subagent, Space} to {baseline, subagent}. Spaces have no `skills/` folder to install into. This is a mechanical consequence of R12/R13, not a revision to the catalog brainstorm's surface.

**Portability commitment**

- R23. Agent-shaping content — everything that makes the agent behave like itself — lives in the filesystem. The master agent's workspace tree (master + workspaces + spaces + skills + system contracts) is the source of truth for agent behavior. Runtime-adjacent infrastructure (Hindsight banks, SES email plumbing, scheduled jobs, per-tuple render cache, Postgres-resident DB rows) stays AWS-tied and is not in scope of the portability commitment. v1 does not commit to export-to-local-Claude-Code runnability; v1.5 may revisit if real demand surfaces.

---

## Acceptance Examples

- AE1. **Covers R4, R5, R6, R7.** Given a master agent root containing the four canonical files plus the retired `SOUL.md`/`IDENTITY.md`/`PLATFORM.md`/`CAPABILITIES.md` legacy files, when the migration runs, then the four legacy files are deleted, their content lives in named sections of `AGENTS.md` (`## Personality`, `## Identity`, `## Platform Behavior`), and a subsequent editor save preserves all hand-authored sections byte-identical while regenerating only `## Folder Structure` and `## Skills & Tools`.

- AE2. **Covers R7, R7a.** Given an agent with skills installed at `master/skills/web-search/SKILL.md` and `master/workspaces/sql/skills/snowflake/SKILL.md`, when the editor regenerates `AGENTS.md`, then `## Skills & Tools` lists both skills (each annotated with its scope) and no `## Knowledge Bases` or `## Workflows` section is rendered.

- AE3. **Covers R8, R9.** Given a turn fires in the `(master, finance, eric)` tuple, when the system-prompt builder runs, then files are loaded in this order: `AGENTS.md`, `CONTEXT.md`, `GUARDRAILS.md`, `spaces/finance/SPACE.md`, `USER.md`. When the agent then routes per `CONTEXT.md` to `@sql`, then `master/workspaces/sql/CONTEXT.md` is loaded next.

- AE4. **Covers R10, R11.** Given a tenant tree pre-migration with subagent folders at `master/sql/` and `master/finance-analyst/`, when the migration runs, then those folders move to `master/workspaces/sql/` and `master/workspaces/finance-analyst/`, AGENTS.md routing rows are rewritten to match, and the admin file-tree UI no longer fabricates a synthetic `agents/` group header.

- AE5. **Covers R12, R13.** Given a `finance` Space, when a Space author tries to add a `skills/` folder or a `TOOLS.md`/`MCP.md` file inside the Space tree, then the operation is rejected at the editor layer (files of those names are not creatable inside `spaces/<slug>/`). When the same author needs Snowflake capability in finance threads, then they author a `finance-analyst` workspace at `master/workspaces/finance-analyst/` with `snowflake_mcp` wired in its `CONTEXT.md`, and the finance Space's `SPACE.md` declares `@finance-analyst` as a mentionable routing target.

- AE6. **Covers R15.** Given a turn in the `finance` Space with `eric` as invoking user, when the agent calls `remember("Q3 close deadline is Sept 30")`, then the fact writes to Eric's user bank only — there is no `finance` Space bank to receive it. Recall on a subsequent turn (any user, any Space) fans only over the recalling user's bank; multi-player visibility of the Q3 close deadline is via the thread messages themselves.

- AE7. **Covers R21, R22.** Given a tenant admin right-clicks the master `skills/` folder, then the "Add Skill" context menu appears and the install flow proceeds per the 2026-05-24 catalog brainstorm unchanged. Given they navigate to a Space's tree, then no `skills/` folder exists to right-click — the context-menu install affordance is absent at Space scope.

---

## Success Criteria

- An operator, planner, or new contributor can answer "what is an agent in ThinkWork, and what files live where?" in one sentence by pointing at this document. The five-brainstorm reconstruction required today goes away.
- The four supersession targets (2026-05-22 one-platform-agent runtime, 2026-05-23 editor-regen, 2026-05-22-001 system-contracts-as-workspace-files, and the workspaces/ migration) can be revised against this document without re-deciding product shape.
- The 2026-05-24 Pi skill catalog plan continues to ship as committed — this brainstorm does not perturb the in-flight implementation.
- A downstream ce-plan dispatch can produce the migration plan (S3 mv to `workspaces/`, system-contract file consolidation into AGENTS.md, AGENTS.md regen update, per-Space bank teardown for any Space banks that may have been provisioned) without needing to invent storage layout, file naming, reading order, or memory model.

---

## Scope Boundaries

- The 2026-05-24 Pi skill catalog brainstorm (`docs/brainstorms/2026-05-24-pi-agent-skill-catalog-and-workspace-install-requirements.md`) stands as committed. The catalog, install action, drift detection, Reinstall, WIRING.md, and `.catalog-ref.json` are not modified by this work.
- Cross-thread Space-level shared memory is deferred to v1.5. Operators handle in-Space shared facts via SPACE.md and attached KB documents in v1.
- Thread message export, Hindsight memory export, and any "export a tenant tree to local Claude Code" tooling. The portability commitment is filesystem-as-source-of-truth (floor B), not export-runnable.
- The customer-onboarding Space workflow (`spaces.kind = 'customer_onboarding'`) is a separate workstream and not in scope.
- DB schema cleanup for the now-unused `agent_skills` table and related rows is coordinated with the 2026-05-24 cleanup-catalog brainstorm.
- The tenant-tree migration implementation (S3 mv, AGENTS.md rewrites, system-contract file deletion) is owned by ce-plan; this brainstorm fixes the target state.
- Pi/Strands runtime _capability discovery_ requires no changes — existing tree walks handle arbitrary depth. The system-prompt builder in each runtime DOES require an ordered-list update per R5 + R8; that is the only runtime-side code change in scope of this brainstorm.
- Mobile (`apps/mobile`) and CLI (`apps/cli`) surface changes for the renamed files. The shared GraphQL/REST surface mediates; client work is incidental.

---

## Key Decisions

- **Model A (context-only Spaces) over capability-bearing.** Operator framing of Spaces consistently called them "extra context (KBs, files), public/private." The 2026-05-22 brainstorm's capability-bearing R17–R19 created two parallel surfaces for skills (workspaces vs Spaces) and forced a "where do skills live?" UX decision on every install. Model A keeps the capability surface in one place (master baseline + workspaces), preserves per-Space access control via SPACE.md mentionable-workspace declarations, and reduces the catalog install-scope set by one. Hybrid (Model C, context + restrict-only) was offered and not chosen — restriction can return as a focused feature later if compliance demand surfaces.
- **AGENTS.md absorbs SOUL/IDENTITY/PLATFORM/CAPABILITIES; GUARDRAILS stays standalone.** Cross-vendor convention is `AGENTS.md` as the always-loaded map (Claude Code, Codex, etc.). Splitting it into five files was accidental complexity from the system-contracts-in-the-container era. GUARDRAILS stays separate for edit-isolation: it is safety-critical, frequently reviewed by compliance, and benefits from small-blast-radius edits. The 2026-05-23 editor-regen brainstorm's section-boundary parser handles additional named hand-authored sections without code change.
- **Drop per-Space Hindsight bank for v1.** The bank is the most genuinely expensive Space surface (per 2026-05-22 Dependencies — quota/cost at 400+ Spaces per tenant unverified) and the use case it served (cross-thread shared Space facts) is partially served by SPACE.md and attached KBs. Multi-player within a single thread is unaffected — thread messages carry the context. v1.5 has two reversible paths open if real demand surfaces.
- **`AGENTS.md` derived sections collapse to two; tree-walk derivation replaces DB.** Skills live in the filesystem under Model A; deriving them from a DB table is now a parallel source of truth that drifts. `## Knowledge Bases` is per-Space (not master), so it doesn't belong in the master AGENTS.md. `## Workflows` was the multi-step orchestration era that was retired. Two derived sections remain (`## Folder Structure`, `## Skills & Tools`), both tree-walk-derived.
- **Real `master/workspaces/` parent folder.** The 2026-04-26 "agents/ folder is UI fabrication, not storage" decision was correct for that product state — operators never saw the storage form. The specific change that justifies reversing it now: in April, agents had distinct DB rows and the master tree was internal; under Model A (post-2026-05-22 commitment), the master tree IS the operator-edited surface and storage form is operator-visible. The "operator-language matches storage" argument now does operator-facing work that it could not do in April; that is the load-bearing change. Under Model A, "workspaces" is the operator-facing noun. Storage should match. Reserved-name collisions also become impossible (`skills`, `memory`, `artifacts` cannot accidentally be workspace slugs because they're at different paths). FOG-importer path normalization remains the same one-liner.
- **Pinned reading order is documented, not implicit.** The every.to article treats reading order as load-bearing. Our system-prompt builder has an order, but it lives only in code. Pinning it in this canonical doc (and gating regression in tests) closes the gap.
- **Floor-B portability, not export-runnable.** Filesystem is the source of truth for agent-shaping content. Runtime infrastructure stays AWS-tied. We do not commit to "export the tenant tree and run it locally in Claude Code" as a v1 promise. v1.5 may revisit; v1 does not pay the thread/memory export complexity tax.
- **Don't perturb the in-flight Pi skill catalog work.** The 2026-05-24 catalog brainstorm is mid-implementation. Its install flow (catalog → agent), drift detection, and Reinstall are exactly what tenant admins need. Under Model A the install-scope set reduces mechanically from three to two by virtue of Spaces having no skills/ folder — no further changes needed.

---

## Dependencies / Assumptions

- The 2026-05-22 brainstorm's per-tuple rendered workspace mechanism is preserved. Its renderer's composition rules simplify under Model A (no Space-additive skills/tools/MCP layer) but its caching, invalidation, and S3 prefix design are unchanged.
- The 2026-05-23 editor-driven AGENTS.md section regen brainstorm is in flight and adopts R6–R7a of this brainstorm during its planning pass. Its section-boundary parser handles additional named sections without code change.
- The 2026-05-22-001 system-contracts-as-workspace-files plan is in flight and revises to deliver SOUL/IDENTITY/PLATFORM/CAPABILITIES content as named sections of `AGENTS.md` rather than as separate files. GUARDRAILS.md stays as its own file in that plan.
- The 2026-05-24 Pi skill catalog plan continues unchanged; its install-scope set is Model-A-reduced by mechanical consequence.
- Pi runtime's `discoverWorkspaceSkills` (and equivalents) walks the rendered workspace tree at any depth. No runtime container changes are required for any requirement here.
- `packages/workspace-defaults` and bootstrap (`handlers/bootstrap-workspaces.ts`) will need updates to seed the consolidated AGENTS.md and drop the four retired system-contract files. Treated as planning territory, not in scope of this brainstorm's substance.
- Existing tenant trees need a one-time migration (S3 mv to `workspaces/` + AGENTS.md content absorption + retired-file deletion). Migration ordering and implementation are ce-plan concerns.
- The `agent_skills` DB table becomes unused once `## Skills & Tools` is tree-walk-derived. Its removal coordinates with the 2026-05-24 cleanup-catalog brainstorm rather than being done here.
- The current editor save path calls `derive-agent-skills.ts` (per `CLAUDE.md`), which writes to the `agent_skills` DB table. R7's tree-walk derivation must replace this read path before — or atomically with — the first tenant tree migration, otherwise the DB table remains the live source during a transition window where the tree walk is canonical. Sequencing this switchover is a planning prerequisite that the cleanup-catalog brainstorm coordinates with the migration plan.
- Cross-vendor naming convergence on `AGENTS.md` is presumed stable. If a major coding tool diverges, the canonical map filename becomes a planning concern at that time.

---

## Outstanding Questions

### Resolve Before Planning

- [Affects Summary, Dependencies][Process] **Supersession tracking** — before any plan revisions begin against this doc, edit the headers of the three anchored docs to record the partial supersession: `docs/brainstorms/2026-05-22-one-platform-agent-spaces-runtime-requirements.md` (R6, R10, R17–R19, R20, R21, R22, R24 superseded by Rxx of this doc), `docs/brainstorms/2026-05-23-editor-driven-agents-md-section-regen-requirements.md` (R9 reduced to two derived sections per R7/R7a here), and `docs/plans/2026-05-22-001-refactor-system-contracts-as-workspace-files-plan.md` (system-contract file count reduces to AGENTS.md + GUARDRAILS.md per R4/R5). Operationalizing the anchoring is part of making the anchor real, not a planning concern.

### Deferred to Planning

- [Affects R8][Technical] Where to encode and test the pinned reading order — system-prompt-builder code comment + unit test, or a separate manifest file the runtime consumes. Either works; pick during planning.
- [Affects R7][Technical] Exact tree-walk depth limit and ordering rules for the `## Skills & Tools` section. Top-down breadth-first vs depth-first vs alphabetical. Render format (table vs nested list) inherits from the 2026-05-23 brainstorm.
- [Affects R10, R11, R18][Technical] Tenant migration sequencing: per-tenant in-place rewrite vs new-tree-then-cutover. Whether to keep the legacy flat-storage path readable during a transition window for any in-flight clients.
- [Affects R5, R18][Technical] Migration content-merge policy — for tenants whose pre-migration `SOUL.md` / `IDENTITY.md` / `PLATFORM.md` / `CAPABILITIES.md` content differs substantially from workspace-defaults seeds, what is the merge strategy into the named `AGENTS.md` sections? Options to weigh: automated overwrite of defaults (data loss for customized tenants), automated append with operator-review flag (preserves content but needs a review surface), human-review-gated merge (safest but blocks bulk migration). v1 likely needs the third for any operator-customized content; the first works for fresh tenants.
- [Affects R16][Needs research] Demand signal for cross-thread Space memory in v1.5 — when does it become real, and which reserved path (Space `memory/` folder vs re-added Hindsight bank) wins. Defer until concrete use cases surface.
- [Affects R23][Needs research] Whether any v1.5 export tooling demand surfaces from real customers; if so, the thread + memory export design space is open.
- [Affects R18][Technical] Inventory of code paths that hard-code SOUL.md / IDENTITY.md / PLATFORM.md / CAPABILITIES.md file references — workspace-defaults composer, bootstrap, system-prompt builder, any audit/CLI tools. Mechanical sweep during planning.
- [Affects R5, R7a][Process] Reconciliation order across the four anchored brainstorms/plans: which one revises first, and whether any work-in-flight needs a brief pause for plan alignment.

---

## Deferred / Open Questions

### From 2026-05-24 review

- **Spaces context-only may fail for compliance and customer-onboarding workflows** — R12, R13; Key Decisions (Model A) (P1, adversarial, confidence 75)

  The premise that operator framing of Spaces is consistently "extra context" contradicts the document's own scope-boundary acknowledgement of a `spaces.kind = 'customer_onboarding'` workstream. Customer onboarding is the textbook case where Space-scoped capability (workflow-specific tools, restricted MCPs, audit-logged actions) is more than context overlay. Model C "restrict-only" was dismissed as something that "can return later if compliance demand surfaces" — but compliance demand was already cited as the reason GUARDRAILS stays edit-isolated. R14's mentionable-workspaces escape hatch only controls _visibility_ of workspaces, not which tools/MCPs are _invokable_ once routed. Operators wanting to gate a finance Space from `@code-executor` cannot achieve that under Model A without multiplying workspace count by Space count. Consult the customer-onboarding workstream's actual requirements before locking R13.

  <!-- dedup-key: section="r12 r13 key decisions model a" title="spaces context only may fail for compliance and customer onboarding workflows" evidence="r13 spaces do not contain skills tools md mcp md or any capability additive declarations" -->

- **Per-Space Hindsight drop conflates cross-thread shared facts with the agent's own learning loop** — R15, R16; Key Decisions (P1, product-lens + adversarial, confidence 100)

  The decision frames the per-Space bank as serving "cross-thread shared Space facts" that SPACE.md + KBs can partially replace. But Hindsight is also the agent's own reflective memory — what worked, what failed, what to do differently. Under Model A, if a finance-Space agent learns "the user wants Q3 reports formatted as PDF, not XLSX" during a turn with eric, that lesson only goes into eric's bank. The next finance turn with alice gets none of it. AE6 explicitly demonstrates the gap ("multi-player visibility of the Q3 close deadline is via the thread messages themselves") but undersells how often the second user is in a different thread on a different day. The "cost at 400+ Spaces per tenant unverified" justification is a feasibility concern, not a product-shape concern — answers might include lazy provisioning or shared banks, not deletion. Stress-test with a real workflow: two finance analysts in different threads in the same Space, day apart. Walk through what the second analyst experiences. If the answer is "they re-ask and get a different answer," that's a regression vs the 2026-05-22 commitment. Either keep per-Space Hindsight provisional with lazy-create on first remember(), or document the regression explicitly so 2026-05-22 stakeholders can object.

  <!-- dedup-key: section="r15 r16 key decisions" title="per space hindsight drop conflates cross thread shared facts with the agents own learning loop" evidence="r15 recall fans only over the speaker users hindsight bank remember writes to the speaker users bank" -->

- **R7a + R8 do not specify where Space knowledge/ content enters the system prompt** — R7, R7a; R8–R9 (P1, coherence, confidence 75)

  R7a says "KB content is per-Space" and R12 says Spaces contain a `knowledge/` folder. R8 pins a reading order that loads root files then SPACE.md and USER.md, but does not describe where `spaces/<slug>/knowledge/*` content enters the system prompt. If KBs are per-Space files, R8's reading order is incomplete — it names no rule for composing knowledge files into the prompt. AE3 only covers root + SPACE.md + USER.md, not knowledge composition. Either extend R8 to name where Space knowledge is loaded relative to the five file-loads, or add a new R8b explicitly stating whether/how knowledge files are synthesized into the prompt. Add an AE covering Space knowledge composition.

  <!-- dedup-key: section="r7 r7a r8 r9" title="r7a and r8 do not specify where space knowledge content enters the system prompt" evidence="r7a the knowledge bases and workflows derived sections from the 20260523 brainstorm are dropped kb content is per space" -->

- **Editor rejection UX for Space-scoped capability files is unspecified** — R13, AE5 (P1, design-lens, confidence 75)

  R13 says the editor rejects `skills/`, `TOOLS.md`, `MCP.md` inside `spaces/<slug>/`. AE5 confirms the operation is "rejected at the editor layer." But neither specifies what the operator sees: is the create action greyed out in the context menu, an inline error message, a save-blocked dialog, or a file that appears then gets removed? Different implementers will ship different behaviors. The right answer for compliance-critical rejections (operators trying to add capability to a Space they thought would have it) is not obvious. Two main options: (a) the context menu suppresses the restricted filenames entirely (simpler but invisible — operator never learns why); (b) names appear and trigger an inline error explaining capability files belong in `workspaces/`, not Spaces (teaches the model).

  <!-- dedup-key: section="r13 ae5" title="editor rejection ux for space scoped capability files is unspecified" evidence="r13 spaces do not contain skills tools md mcp md or any capability additive declarations" -->

- **Pinned reading order in code contradicts filesystem-is-the-agent portability claim** — R8, R23; Key Decisions (P2, adversarial, confidence 75)

  R23 commits to filesystem-as-source-of-truth (Floor B) and R8 pins reading order in code+tests with no operator-visible override. These are in tension: an operator exporting the tenant tree (the Floor-B promise) gets the files but not the reading order — a different runtime loading them in a different order produces different behavior. The premise question "doesn't violate filesystem is the agent" is defensible only if reading order is recoverable from the filesystem alone. By parity with `## Folder Structure` being operator-readable in AGENTS.md, reading order belongs there too, not only in code. The "pin in code + test" choice optimizes for runtime simplicity at the cost of the portability commitment R23 makes. Either resolve the planning deferral in favor of a filesystem manifest (so reading order travels with the tree), or weaken R23 to clarify that reading order is part of the runtime contract operators inherit when running on ThinkWork specifically.

  <!-- dedup-key: section="r8 r23 key decisions" title="pinned reading order in code contradicts filesystem is the agent portability claim" evidence="r8 the system prompt builder loads master root files in this pinned order 1 agents md 2 context md" -->

- **Mechanical migration claim hides parser and routing complexity** — R18; Dependencies (P2, adversarial, confidence 75)

  R18 asserts the migration is "mechanical and owned by ce-plan." The migration involves: S3 mv of subagent folders, reading SOUL/IDENTITY/PLATFORM/CAPABILITIES content (which may be arbitrary operator authorship), slotting it into named AGENTS.md sections while preserving byte-identical hand-authored content, rewriting AGENTS.md routing rows, and coordinating with the 2026-05-23 editor-regen brainstorm's section-boundary parser (which currently doesn't know the new sections). The content-slot step is NOT mechanical — mapping "whatever SOUL.md contains" to "## Personality" without a human decision is a content-merge problem. The Dependencies "Inventory of code paths that hard-code SOUL/IDENTITY/PLATFORM/CAPABILITIES file references — mechanical sweep during planning" is also discovery work whose scope is unknown until done. Don't claim mechanical until the migration is scoped. Either survey what's actually in those files across existing tenants and document a content-merge policy, or move R18 to explicit "planning will determine" framing.

  <!-- dedup-key: section="r18 dependencies scope boundaries" title="mechanical migration claim for tree rewrite and 4 file consolidation hides parser and routing complexity" evidence="r18 a one time tenant tree migration the migration is mechanical and owned by ce plan this brainstorm fixes the target state not the migration mechanics" -->

- **Model A defers the capability/permission question rather than resolving it** — R13, R14; Key Decisions (P2, product-lens, confidence 75)

  Model A's stated benefit is "capability surface in one place." But R14 introduces SPACE.md-declared mentionable workspaces — a per-Space capability gate that lives in operator-authored markdown rather than DB-resident assignments. For an internal-leaning enterprise product (4 enterprises, compliance reviewers in the loop), "which Space can invoke @sql" is a permission decision, not a context decision. Encoding it in SPACE.md markdown means no atomic enforcement (the agent reads markdown and is asked to comply), no audit trail beyond git-of-S3, and no admin UI affordance distinct from "edit a markdown file." Operators will ask "can I prove the legal Space cannot @sql production?" and the answer "it says so in SPACE.md" may not satisfy. Either (a) name explicitly that R14 mentionability is advisory/prompt-time and not an enforcement boundary (and accept that enterprise compliance will need a separate primitive), or (b) commit to enforcement-at-render: the renderer omits non-mentionable workspaces from the rendered tree entirely so the model literally cannot @ them.

  <!-- dedup-key: section="r13 r14 key decisions" title="spaces context only model defers the capability permission question rather than resolving it" evidence="r14 spaces can declare which workspaces are mentionable inside the space via a section of their space md" -->

- **AGENTS.md (300-500 lines) editor affordance for derived vs hand-authored sections** — R4, R6 (P2, design-lens, confidence 75)

  R4 enumerates nine or more hand-authored sections in AGENTS.md alongside two derived sections. R6 says derived sections are rewritten on every save while hand-authored sections must round-trip byte-identical. The file is estimated at 300-500 lines. An operator editing AGENTS.md needs to know which regions are editable and which are auto-generated — otherwise they edit a derived section, save, and silently lose their changes. No requirement specifies a visual distinction (read-only region marker, section header comment, collapsed derived block, inline warning). Add a requirement specifying how derived sections are surfaced in the editor — at minimum, a comment marker (e.g., `<!-- generated: do not edit -->`) above each derived section heading. If the editor renders a preview pane or save-diff, spec that behavior here.

  <!-- dedup-key: section="r4 r6" title="agents md file at 300 500 lines has no specified editor affordance for navigating hand authored vs derived sections" evidence="r4 agents md contains two derived sections folder structure skills tools plus hand authored sections" -->

- **Bootstrap-seeded SPACE.md default template content is unspecified** — R12, F3 (P2, design-lens, confidence 75)

  R12 and F3 say SPACE.md is "bootstrap-seeded from a default template" and is "mandatory." Neither specifies what the default template contains. A Space author opening SPACE.md for the first time sees this template as their starting point and mental model for what SPACE.md does. A blank file with a header gives no guidance; a rich example with sections teaches the `## Mentionable Workspaces` convention from R14 and the constraint in R13 (no skills/TOOLS.md/MCP.md). Add a requirement or acceptance example specifying the minimum sections in the default SPACE.md template: a description placeholder, a `## Mentionable Workspaces` stub matching R14's format, and a comment directing operators to `master/workspaces/` for capability additions.

  <!-- dedup-key: section="r12 f3" title="bootstrap seeded space md default template content is unspecified" evidence="r12 space md startup instructions operator authored parallel by role with user md not by writer mandatory bootstrap seeded from a default template" -->

- **Email channel security surface referenced but not re-specified** — R12, Dependencies (P2, security-lens, confidence 75)

  R12 states "email address derivation and email_triggers_enabled toggle (unchanged from 2026-05-22 R26–R31)." That phrasing carries the entire inbound email attack surface — cold-contact sender allow-list, reply token scoping, spoofing vectors — by reference to a brainstorm this doc partially supersedes. A plan author executing against only this document has no normative text specifying who may send cold-contact email, how reply tokens are scoped per-Space, or what happens when `email_triggers_enabled` is toggled off mid-thread. If the 2026-05-22 brainstorm is retired as a planning source, those controls disappear from the normative requirements surface. Either inline R26–R31 controls explicitly in this document's Spaces section, or add a Scope Boundary entry making explicit that the 2026-05-22 email security requirements remain normative and are NOT superseded by this document.

  <!-- dedup-key: section="r12 dependencies" title="email channel security surface referenced but not re specified" evidence="r12 email address derivation and email triggers enabled toggle unchanged from 20260522 r26 r31" -->

- **Automation source (A6) trust boundary not defined** — Actors A6, F1, R12 (P2, security-lens, confidence 75)

  Actor A6 ("automation source: scheduled job, connector webhook, or subagent delegation that invokes the runtime without a human user") is named but its trust relationship to Space privacy controls is undefined. F1 and R12 establish that private Spaces have member-restricted access for human users (A3). A6 operates without a human user — neither requirement nor flow specifies whether A6 must present a Space-authorized identity, whether it bypasses the private-Space gate, or whether the tuple `(master_agent, private_space, no_user)` is allowed. R19a now requires render-side membership check for private Spaces but defers A6's specific authorization model to this Open Question. Two options to weigh: (a) A6 must carry a Space-authorized service identity checked against the same DB-resident membership record used for human users; (b) A6 is restricted to non-private Spaces or to tenant-default-Space turns only. Without resolution, an automation could exfiltrate private Space `knowledge/` content into agent output or memory.

  <!-- dedup-key: section="actors a6 f1 r12" title="automation source a6 trust boundary not defined no requirement on what credentials or identity it presents when invoking a space scoped turn" evidence="actor a6 automation source scheduled job connector webhook or subagent delegation that invokes the runtime without a human user" -->
