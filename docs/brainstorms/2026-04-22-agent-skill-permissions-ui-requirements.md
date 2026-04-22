---
date: 2026-04-22
topic: agent-skill-permissions-ui
---

# Agent-Skill `permissions.operations` UI Editor

## Problem Frame

The shipped `thinkwork-admin` Python skill exposes 33 platform operations (29 default-enabled + 4 destructive opt-ins). Each agent's access to those ops is gated per-call by `requireAgentAllowsOperation`, which reads `agent_skills.permissions.operations` jsonb in Aurora. This allowlist is the middle layer of the skill's three-layer authz model — the real defense against shared-service-secret impersonation.

The admin SPA has no authoring surface for that field today. The per-agent Skills tab (`apps/admin/src/routes/_authed/_tenant/agents/$agentId_.skills.tsx`) toggles skills on/off; the template Skills tab (`apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.tsx`) does the same. Neither can express "agent X may call `invite_member` and `create_agent` but not `remove_tenant_member`." Without that path, enabling `thinkwork-admin` grants the agent zero ops — the resolver refuses everything — so the skill is unusable in practice. At 4 enterprises × ~100 agents × ~5 templates, manual jsonb-hacking is a non-starter.

A latent hazard compounds this: the current per-agent Skills page never reads or forwards `permissions`, so any save through `setAgentSkills` risks silently clobbering the jsonb. Fixing the UI and fixing the round-trip are the same unit of work.

Operators affected: tenant admins provisioning agents that drive the platform itself (onboarding automations, fleet reconcilers, admin-facing playbooks).

## Requirements

**Skill manifest as source of truth**

- R1. Each skill declares its operations in `skill.yaml` under `scripts:` (existing). For skills that want op-level permissions, the manifest also declares a new explicit flag (e.g., `permissions_model: operations`) to opt into this UI. Skills without the flag are unaffected.
- R2. A manifest-declared op with `default_enabled: true` pre-checks in the UI on first authoring; `default_enabled: false` is an unchecked opt-in the operator must deliberately enable.
- R3. Ops not in the manifest cannot be authored from the UI (the selector sources its choices from the manifest). The server-side Unit 11 lint test remains the catastrophic-tier gate; the UI does not duplicate that check.

**Trust-layer semantics (template = ceiling, agent narrows)**

- R4. Templates carry `permissions.operations` per skill. A template's list is the **maximum** set of ops that any agent instantiated from it may invoke.
- R5. Agents carry their own `permissions.operations` per skill. An agent's list must be a **subset** of its template's list for that skill. An agent may uncheck ops (narrow trust) but may not add ops the template did not authorize.
- R6. If an agent's `permissions.operations` is null or absent for a skill, it inherits the template's list verbatim. An explicit empty array `[]` is a narrowed-to-empty override, not inheritance. The UI renders inheritance distinctly so narrowing is an explicit act.
- R7. When a template's list shrinks, any linked agent whose per-agent list is now a strict superset is rebased to the new template ceiling on the next template-to-agent sync (reusing the existing sync confirmation flow). Agents that already narrowed within the new ceiling are left alone.

**Authoring surface**

- R8. The template edit page's Skills tab gains a per-skill "Permissions" sub-panel (Option A applied at template scope). The panel renders only for skills whose manifest declares `permissions_model: operations`. Inside, the operator sees a checkbox list of manifest ops grouped by source file (e.g., `reads.py`, `tenants.py`, `templates.py`) with each op's description.
- R9. The per-agent Skills tab gains the same panel with the same grouping as R8. For each op it shows three states: `inherited` (inherits from template, default), `allowed` (explicit check — no-op unless it differs from template), `denied` (explicit uncheck, narrower than template). An agent row cannot check an op the template did not authorize.
- R10. Typos are impossible — the UI never accepts free-form op names. All choices come from the manifest.

**Round-trip safety (prerequisite fix)**

- R11. The per-agent Skills page (`$agentId_.skills.tsx`) must load `permissions` on every skill row and include it in every `setAgentSkills` mutation, not just when the operator opens the permissions panel. Saving an unrelated change must not drop a skill's existing `permissions` jsonb. This requires adding `permissions` to `AgentDetailQuery.skills` selection and to `SetAgentSkillsMutation`'s return shape in `apps/admin/src/lib/graphql-queries.ts` (the `setAgentSkills` resolver already reads and writes `permissions`; the UI just never pulls or returns it). The risk is specifically acute on the **insert** path (adding a new skill) — Drizzle omits `undefined` keys from `onConflictDoUpdate.set` on update (preserving existing), but writes NULL for `undefined` in `.values()` on a fresh insert.

**Discoverability**

- R12. When an agent ends up with zero effective ops for a skill that uses `permissions_model: operations` (template list is empty, or agent narrowed to empty), the UI shows an inline warning on that skill row: "No operations enabled — this agent cannot use this skill." No modal, no confirmation — just visible state. The template Skills tab shows the same warning when the template itself has zero ops for such a skill — every linked agent inherits that state, and the operator needs the signal where the upstream cause lives.

**Migration (one-time backfill)**

- R13. For every existing template whose skills include `thinkwork-admin`, seed `permissions.operations` for that skill with the list of manifest ops where `default_enabled: true`. The 4 destructive opt-ins (`remove_tenant_member`, `remove_team_agent`, `remove_team_user`, `sync_template_to_all_agents`) are **not** seeded — operators opt into them deliberately.
- R14. Existing agents with `thinkwork-admin` assigned and empty/null `permissions.operations` inherit from their template after R13 lands. No per-agent backfill is required.

**Security prerequisites (land before or with the UI)**

- R15. `updateAgentTemplate` gains a `requireTenantAdmin(ctx, template.tenantId)` gate before any write, mirroring `createAgentTemplate`. The current mutation has no auth check — raw Drizzle UPDATE, no `ctx.auth` verification. Adding `permissions` to this mutation's input without fixing this first turns it into an unprotected privilege-escalation path. This is a prerequisite, not a follow-up — the UI feature must not ship before it.
- R16. `setAgentSkills` rejects calls where the target `agentId` matches the calling agent (`ctx.auth.agentId` for apikey callers). This closes the self-bootstrapping loop where an agent holding `thinkwork-admin` with `set_agent_skills` in its allowlist could rewrite its own `permissions.operations` to grant itself every other op. `set_agent_skills` stays `default_enabled: true` so legitimate cross-agent provisioning (reconcilers, onboarding automations) continues to work.

## Success Criteria

- A tenant admin can open a template, author `thinkwork-admin` permissions, save, open a linked agent, see the inherited list, narrow one op, save, and call a `thinkwork-admin` tool from that agent — end to end, no CLI, no jsonb hand-editing.
- After the migration ships, every pre-existing `thinkwork-admin` assignment across deployed tenants has a non-empty effective allowlist, and every default-enabled op works without operator touch.
- Saving unrelated skill changes (adding a non-admin skill, flipping enabled, editing config) on the per-agent Skills tab preserves `thinkwork-admin.permissions.operations` bit-for-bit.
- A second skill adopting `permissions_model: operations` in its manifest requires no admin-SPA changes to get the same authoring UI.

## Scope Boundaries

- Per-user authoring (operator accessing this via the mobile app or their own session) is not in scope. Tenant admins in the admin SPA are the only authoring surface in v1.
- Stricter-than-tenant-admin auth (e.g., owner-only) is not in scope. Permissions reuse `requireTenantAdmin`.
- Custom op definitions (ops not declared in a manifest) are not in scope. The manifest remains the closed universe.
- Free-form `permissions` jsonb for skills that do **not** opt into `permissions_model: operations` is untouched — this plan does not change their shape or their UI.
- Rate limits, model overrides, and other `agent_skills` fields are outside scope; this plan only addresses the `permissions.operations` authoring gap.
- A general audit view of "which agents have which ops enabled" across the tenant is a future dashboard, not a v1 requirement.

## Key Decisions

- **Per-template + per-agent override, with agents narrowing only.** Template defines the maximum trust; agents can revoke ops but never widen. Prevents an operator editing one agent from silently granting more than the template authorized. Makes "inherited vs overridden" trivially representable (subset relation).
- **Explicit manifest opt-in via `permissions_model: operations`.** Skills without the flag keep their existing `permissions` shape and UI. Zero clutter for skills that don't need op-level permissions; forward-compatible for future skills that do.
- **Seed migration at the template layer, inherit on the agent layer.** Templates get a one-time backfill of default-enabled ops. Agents inherit until narrowed, so no per-agent rows are mutated by the migration and existing agents come back to life automatically.
- **Round-trip fix is a prerequisite, not a follow-up.** The existing Skills tab's `permissions` drop-on-save bug must be fixed in the same plan. Shipping the UI without this fix would make the problem worse on every unrelated save.
- **Catastrophic-tier enforcement stays server-side.** Unit 11's `never-exposed-tier.test.ts` is the authoritative gate. The UI does not re-implement it — the manifest is the closed universe it authors from.
- **Reuse the existing `getCatalogSkill(slug)` REST endpoint for manifest metadata.** `packages/api/src/handlers/skills.ts:getCatalogSkill` already reads and returns the full parsed YAML (including the `scripts` array with `name`, `path`, `description`, `default_enabled`) for a single slug. The admin SPA already calls it via `apps/admin/src/lib/skills-api.ts:getCatalogSkill`. No new GraphQL type, no new query, no new persistence column. Extend the `CatalogSkill` TypeScript type in `skills-api.ts` to surface `scripts` and `permissions_model` from the existing payload. This avoids widening the list endpoint (which mobile also consumes) and avoids cross-app codegen regeneration.
- **R13 migration mechanism: hand-rolled SQL under `drizzle/` with a `-- updates:` marker.** CLAUDE.md mandates hand-rolled `.sql` files with `-- creates:` / `-- updates:` markers for migrations outside `db:push`'s scope, gated by `db:migrate-manual` in the deploy pipeline. The backfill is a data mutation (jsonb-array-element update on `agent_templates.skills` where the element's `skill_id = 'thinkwork-admin'`), so it belongs in this pattern, not in a TypeScript seed or one-off CLI script. Must be idempotent (`WHERE permissions IS NULL OR permissions = 'null'::jsonb`).

## Dependencies / Assumptions

- The GraphQL API does not expose manifest operation structure as a first-class field and does not need to — the existing REST `getCatalogSkill(slug)` endpoint returns the full parsed YAML directly from S3. `skill_catalog.tier1_metadata` also caches the full YAML, but the REST path is simpler and already live.
- `setAgentSkills` resolver (`packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.ts`) already accepts and writes `permissions`. No new mutation is needed on the agent side.
- `updateAgentTemplate` writes `skills` as a whole-value jsonb overwrite (not per-field merge), so **R11's round-trip hazard does not apply to the template side** — whatever the UI sends for `skills` is what gets stored. Extending the client-side `TemplateSkill` type with `permissions?: { operations: string[] }` and ensuring the template editor preserves/initializes it is the complete surface change on the template save path; no resolver change is required.
- `createAgentTemplate` gates on `requireTenantAdmin`, but the `updateAgentTemplate` mutation's auth check must be verified and tightened as part of this plan before `permissions` is added to its input (see Outstanding Questions — this is now a prerequisite, not an assumption).
- The `agent_skills.permissions.operations` resolver-side narrowing check may also need to enforce "agent's ops ⊆ template's ops" as a defense-in-depth server rule, but the UI contract alone prevents this for well-behaved clients. Whether to add the server-side subset check is a planning decision that is load-bearing for the stated threat model (see Outstanding Questions).
- "4 enterprises × ~100 agents × ~5 templates" fleet scale means bulk template edits are high-leverage and bulk agent edits are low-frequency. The UI emphasizes template-level authoring for that reason. Assumption: <10% of agents will narrow from their template ceiling in v1; if the override rate grows meaningfully higher, the deferred tenant-wide audit view becomes a fast-follow rather than a future dashboard.
- **Drizzle `undefined`-in-`.set()` behavior (confirmed empirically):** In `onConflictDoUpdate({ set: { ... permissions: undefined } })`, Drizzle omits the `permissions` key from the SQL SET clause, preserving the existing column. In `.values({ ... permissions: undefined })` on a fresh insert, it writes NULL. So the current UI's failure mode is asymmetric: saving an edit on an existing skill row preserves permissions; adding a new skill writes NULL. R11 must specifically test the Add-Skill insert path.

## Outstanding Questions

### Resolve Before Planning

(none — the two P0 security prerequisites surfaced by review became R15/R16; the three architecture-decision P1s moved to Deferred to Planning below)

### Deferred to Planning

- [Affects R4, R5, R6, R7][Security — P1] **Resolver-side subset enforcement (`agent.ops ⊆ template.ops`).** The Problem Frame calls the allowlist "the real defense against shared-service-secret impersonation." A UI-only subset contract is insufficient against that threat model — any non-UI caller (CLI, direct GraphQL, the thinkwork-admin skill's own `set_agent_skills` wrapper) can write agent `permissions.operations` outside the template ceiling. Decide at planning time: enforce `agent.ops ⊆ template.ops` at `setAgentSkills` write time (cheaper — one extra lookup per write, catches violations at the source), at `requireAgentAllowsOperation` read time (defense-in-depth, adds a template lookup per op check), or both. R16's self-target rejection constrains the blast radius in the meantime but does not replace this check for non-self callers.
- [Affects R7][Technical — P1] **`syncTemplateToAgent` rewrite.** Current resolver deletes + re-inserts `agent_skills` wholesale, which wipes agent narrowing. R7's "agents already narrowed are left alone" is false under that code. Plan must pick: (a) rewrite sync as a three-way merge (template_old ∩ template_new preserved, agent narrowing preserved where still within new ceiling), OR (b) encode narrowing as an explicit diff-from-template in the agent row so no merge is needed. Both choices are bigger than the handoff framed; each deserves its own implementation unit.
- [Affects R9][Design — P1] **Tri-state inherited/allowed/denied storage shape.** A flat `permissions.operations: string[]` cannot distinguish "inherited from template" from "explicitly allowed" at persistence time; they render identically and the explicit-check signal is lost on save. Pick at planning time: (a) render-only tri-state (compute inherited vs explicit by diffing against the template at render time; storage stays a flat array), or (b) richer storage (e.g., `{overrides: {op: 'allow' | 'deny'}[]}`). (a) is simpler and matches the "narrow only" decision; (b) is needed only if future UX requires "stay allowed even if template later removes this op," which is not a stated requirement.
- [Affects R8, R9][Design] Where does the permissions sub-panel render — expanding in-row table section, nested dialog inside the existing row-click credential dialog (which is max-w-md and already holds OAuth/env-var/delete UI), a new side panel, or a new tab within the dialog? For `thinkwork-admin` specifically, the row-click today opens an empty credentials dialog (no OAuth, no env vars), which is an awkward entry point for a 33-op checkbox list.
- [Affects R5, R9][Technical] **Standalone agents (created without a template_id)** are not covered by the "template = ceiling" model. Decide whether to (a) block `thinkwork-admin` assignment on templateless agents, (b) author permissions directly on the agent with no ceiling, or (c) require every agent to have a template. Plan should verify how many standalone agents exist across live stages before picking.
- [Affects R7][Design] **Permissions-diff surfacing in the sync confirmation dialog.** If R7's rebase-on-sync narrows live agent permissions, the existing `TemplateSyncDialog` needs a permissions-delta summary ("N agents will lose ops [...]") — it was built to push template config, not to communicate revocations. Scope: low if we reuse the dialog, moderate if we add a preview list.
- [Affects R13][Policy] **Migration conservatism.** R13 backfills the 29 default-enabled ops onto every template that has `thinkwork-admin` assigned, including templates that were aspirationally enabled but never usable (zero-ops since day one). This is a real grant of platform-mutating capability to agents that never had it. Decide whether to (a) skip templates whose permissions is already non-null (idempotent guard, already decided), (b) also skip templates whose linked agents have zero skill-runs in the last 30 days (filter abandoned setups), or (c) require per-tenant operator acknowledgement before the seed applies.
- [Affects R1, R3][Technical] **Manifest op rename/removal semantics.** The plan treats the manifest as a closed universe (R3, R10) but doesn't specify what happens to persisted `permissions.operations` entries whose op names no longer appear in the current manifest (skill version upgrades, rename, deletion). Decide whether the UI renders stale ops as "deprecated — will be removed on next edit," silently drops them on save, or blocks save until resolved. Policy candidates: ops are append-only within a major version; removals ship with a migration that rewrites `permissions.operations` rows.
- [Affects R1][Technical] **`permissions_model` key and the Strands runtime YAML validator.** Confirm that adding a top-level `permissions_model: operations` key to `skill.yaml` does not trip `packages/agentcore-strands/agent-container/test_skill_yaml_coercion.py` or any strict-schema validation in the sync script. Cheap (grep + test run), blocks a subtle Unit-0 failure.

## Next Steps

-> `/ce:plan` for structured implementation planning
