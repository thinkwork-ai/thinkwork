---
title: "feat: agent-skill permissions.operations UI editor"
type: feat
status: active
date: 2026-04-22
origin: docs/brainstorms/2026-04-22-agent-skill-permissions-ui-requirements.md
---

# Agent-Skill `permissions.operations` UI Editor

## Overview

The shipped `thinkwork-admin` skill exposes 33 platform operations gated per-call by `requireAgentAllowsOperation`, which reads `agent_skills.permissions.operations` jsonb. There is no authoring surface for that field — every agent assigned the skill currently has an empty allowlist and the resolver refuses everything. This plan adds a per-template + per-agent permissions editor (template = ceiling, agent narrows), rewrites the template-to-agent sync pipeline to preserve per-agent narrowing, closes two P0 security gaps in adjacent mutations, backfills existing template assignments, and fixes a latent round-trip bug in the existing Skills tab that would otherwise wipe permissions on every save.

Scope spans the admin SPA (React 19 + TanStack Router + urql), GraphQL resolvers (Yoga, `packages/api`), Drizzle schema/migrations (`packages/database-pg`), a catalog REST handler (no handler edits required — existing endpoint already returns the needed data), and one manifest flag added to `packages/skill-catalog/thinkwork-admin/skill.yaml`.

## Problem Frame

At 4 enterprises × ~100 agents × ~5 templates, manual jsonb-hacking is not an option. The allowlist is the middle layer of the three-layer authz model — Problem Frame of the origin document calls it "the real defense against shared-service-secret impersonation" (see origin: `docs/brainstorms/2026-04-22-agent-skill-permissions-ui-requirements.md`). Two adjacent security gaps surfaced during document review must be closed as prerequisites: `updateAgentTemplate` currently has no auth check at all (raw Drizzle UPDATE), and `setAgentSkills` with a default-enabled `set_agent_skills` manifest op allows an agent to rewrite its own allowlist. The brainstorm folded both into R15/R16.

## Requirements Trace

All 16 origin-document requirements flow through this plan's implementation units:

- R1, R2, R3 — manifest opt-in flag and closed-universe op selector → Unit 3
- R4, R5, R6 — template-ceiling + agent-narrowing semantics → Units 5, 6, 8, 9
- R7 — template shrink rebases narrowed agents on sync → Unit 6
- R8, R9, R10 — template and agent authoring panels → Units 8, 9
- R11 — round-trip safety for `permissions` on every save → Unit 7
- R12 — empty-allowlist inline warning (template + agent) → Units 8, 9
- R13, R14 — one-time migration backfill → Unit 4
- R15 — `updateAgentTemplate` authz gate → Unit 1
- R16 — `setAgentSkills` self-target rejection → Unit 2
- R17 — `syncTemplateToAllAgents` Cognito-only catastrophic-tier gate → Unit 2b

## Scope Boundaries

- Per-user (mobile) authoring — not in scope; admin SPA is the only authoring surface in v1.
- Stricter-than-tenant-admin auth (owner-only) — not in scope; reuse `requireTenantAdmin`.
- Custom / tenant-authored op definitions — not in scope; manifest is the closed universe.
- Free-form `permissions` jsonb for skills that do **not** opt into `permissions_model: operations` — untouched.
- Rate limits, model overrides, and other `agent_skills` fields — outside scope.
- Standalone agents (agent with no template) — schema already forbids via `agents.template_id.notNull()`. The deferred-to-planning question is closed by construction.
- `createAgentTemplate` idempotency / `setAgentSkills` idempotencyKey enforcement — the schema already exposes `idempotencyKey` fields but the resolvers don't consume them. Wiring is out of scope; concurrent editor loss is accepted as last-writer-wins in v1 (see Key Technical Decisions).

### Deferred to Separate Tasks

- **Permissions-aware template-sync UX polish.** Base diff surfacing lands in Unit 6 (see below). Extended treatments — e.g., per-agent preview grouped by op, or an "apply to subset of agents" selector — are a follow-up if operators ask for them after the v1 flow ships.
- **Manifest op rename/removal semantics.** Ops are treated as append-only within a major skill version for v1. A skill-version-migration unit that rewrites stale entries in `agent_skills.permissions.operations` lands separately, when the first rename actually happens.
- **Mobile parity.** `apps/mobile/lib/graphql-queries.ts` also omits `permissions` from its `SetAgentSkills` fragment. This plan fixes admin only. A mobile sweep is a follow-up (mobile is not currently an authoring surface for `thinkwork-admin`, so the risk is lower).

## Context & Research

### Relevant Code and Patterns

**Authz helpers (`packages/api/src/graphql/resolvers/core/authz.ts`):**
- `requireTenantAdmin(ctx, tenantId, dbOrTx?)` — throws `FORBIDDEN` on failure, accepts optional transaction handle for "role-check + write atomic" invariants.
- `requireAgentAllowsOperation(ctx, operationName, dbOrTx?)` — per-agent allowlist check; already deployed. Does **not** verify `agent.ops ⊆ template.ops` today.
- `requireAdminOrApiKeyCaller(ctx, tenantId, operationName, dbOrTx?)` — admin-skill-aware variant with live DB role check (no caching).
- `resolveCallerTenantId(ctx)` in `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts:80` — Google-federated fallback for reads only, not a mutation gate.

**Jsonb validator pattern:** `validateTemplateSandbox` in `packages/api/src/lib/templates/sandbox-config.ts` is the canonical shape for resolver-boundary jsonb validators — returns `{ ok: true, value } | { ok: false, error }`, tolerates JSON-string payloads, rejects unknown values with a verbatim error. The new `validateAgentSkillPermissions(rawPerms, templatePerms)` helper (Unit 5) mirrors this exactly.

**Resolver-as-template references:**
- `setAgentSkills` (`packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.ts:22-27`) — already loads target agent's `tenant_id` and calls `requireTenantAdmin(ctx, agent.tenant_id)`. Pattern to mirror in Unit 1 for `updateAgentTemplate`.
- `createAgentTemplate` (`packages/api/src/graphql/resolvers/templates/createAgentTemplate.mutation.ts:14`) — gates on `i.tenantId` directly for creates.
- `syncTemplateToAgent` (`packages/api/src/graphql/resolvers/templates/syncTemplateToAgent.mutation.ts`) — current wholesale `delete agentSkills + insert from template`; snapshot is already captured before writes via `snapshotAgent(...)` from `packages/api/src/lib/agent-snapshot.ts` (confirmed to include `permissions` at lines 190, 247 — rollback path safe).
- `templateSyncDiff` (`packages/api/src/graphql/resolvers/templates/templateSyncDiff.query.ts:47`) — skill signature currently `JSON.stringify({config, model_override, enabled})`; must extend with `permissions`.

**Admin SPA surfaces:**
- `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.skills.tsx` — per-agent Skills tab; row-click opens `credDialogSkill` dialog; `items` state at line 137-143 drops `permissions` from the shape (the R11 round-trip bug).
- `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.tsx` — per-template Skills tab at lines 717-767; local `TemplateSkill` type at line 208 is `{skill_id, enabled, model_override?}` (no permissions); `addSkill` at line 435 pushes `{skill_id, enabled: true}`.
- `apps/admin/src/lib/graphql-queries.ts:84-89` (`AgentDetailQuery.skills`) and `:186-192` (`SetAgentSkillsMutation` return) — both omit `permissions`; Unit 7 adds it.
- `apps/admin/src/lib/skills-api.ts:24-44` (`CatalogSkill` type) — needs `scripts[]` and `permissions_model` surfaced; Unit 4 widens.
- Dialog pattern reference: `apps/admin/src/routes/_authed/_tenant/capabilities/builtin-tools.tsx:ConfigureDialog` — cleanest in-tree example of the "row-click, dialog does everything" idiom.
- Checkbox list primitives: `apps/admin/src/components/ui/badge-selector.tsx:300-362` (BadgeSelectorMulti, flat list); `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspaces.tsx:469-500` (per-skill checkbox list with nested config); `apps/admin/src/routes/_authed/_tenant/threads/index.tsx:149` (`groupBy` utility).
- No existing Accordion component — group headers use `<Card>` + `<CardHeader>` or `<details>`.

**REST catalog already returns everything needed:**
- `packages/api/src/handlers/skills.ts:getCatalogSkill(slug)` — reads `skills/<slug>/skill.yaml` from S3, returns the parsed YAML verbatim (including the full `scripts[]` array). No handler edits required.
- `apps/admin/src/lib/skills-api.ts:getCatalogSkill(slug)` — already live in the SPA. Unit 4 widens the return type only.

**GraphQL schema:** `AgentSkill.permissions: AWSJSON` and `AgentSkillInput.permissions: AWSJSON` are already in `packages/database-pg/graphql/types/agents.graphql` (lines 64, 166). `UpdateAgentTemplateInput.skills: AWSJSON` is a whole-blob overwrite in the resolver (`updateAgentTemplate.mutation.ts:30-32`). No `.graphql` edits, no `pnpm schema:build`, no AppSync schema regen. Client codegen (`pnpm --filter @thinkwork/admin codegen`) runs after client-side query-shape changes in Unit 7.

**Hand-rolled SQL migration convention (CLAUDE.md + `scripts/db-migrate-manual.sh`):**
- Files under `packages/database-pg/drizzle/NNNN_*.sql` with `-- creates:` / `-- updates:` / `-- creates-column:` markers in the header.
- `bash scripts/db-migrate-manual.sh` verifies declared objects exist; `deploy.yml` gates on it.
- Template to mirror: `packages/database-pg/drizzle/0019_webhook_skill_runs.sql` (additive, idempotent, multi-marker header).
- `pnpm db:migrate-manual` runs the reporter; the migration is applied via `psql "$DATABASE_URL" -f <file>`.

**Manifest sync:** `packages/skill-catalog/scripts/sync-catalog-db.ts` writes the full parsed YAML to `skill_catalog.tier1_metadata` jsonb. Adding a new top-level `permissions_model` key propagates automatically; tier1_metadata is lossless.

### Institutional Learnings

- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` — PR #398 (same day as this plan's origin doc) audited 19 resolvers including `setAgentSkills`, `syncTemplateToAgent`, `syncTemplateToAllAgents`, `acceptTemplateUpdate`, `createAgentTemplate`, `createAgent`. The row-derived-tenant-pin rule is the canonical pattern. `setAgentSkills` is explicitly flagged as the P0 anchor for this permissions column. **Unit 1's R15 fix is a retrofit against this contract, not new design.** Do not trust `ctx.auth.tenantId` for Google-federated callers (null); always derive from the row.
- `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md` — do not widen `resolveCaller` for apikey callers; prefer narrow REST endpoints. Relevant confirmation that the existing admin-SPA-writes-via-GraphQL path is the right shape; no new service handlers are introduced.
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — hand-rolled SQL marker conventions + `to_regclass(...)` pre-flight + PR `\d+` paste requirement + deploy.yml drift gate. Unit 4 follows exactly.
- `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md` — `users.id` vs Cognito sub distinction; relevant only to confirm this plan doesn't touch that path.
- `docs/solutions/build-errors/dockerfile-explicit-copy-list-drops-new-tool-modules-2026-04-22.md` — Strands container silently swallows tool registration failures; cross-ref for Unit 3's `permissions_model` validator check (a new manifest key must not be silently ignored).

### External References

Skipped — the codebase has strong local patterns for every surface this plan touches (admin authz, Drizzle migrations, urql + codegen, shadcn/ui dialog primitives). No external frameworks introduced.

## Key Technical Decisions

- **Subset enforcement at `setAgentSkills` write time.** One extra lookup of `agent_templates.skills` per write (template_id is notNull, so no null branching). Catches violations at the source — closes the UI-only-contract gap the origin document flagged against the stated threat model (shared-service-secret impersonation). Keeps `requireAgentAllowsOperation` a single-row hot-path read at call time; the invariant `agent.ops ⊆ template.ops` is maintained at the write boundary. Pattern mirrors `validateTemplateSandbox` from `packages/api/src/lib/templates/sandbox-config.ts`.
- **`syncTemplateToAgent` rewrite: intersection, not three-way merge.** New agent permissions = `agent_current.operations ∩ template_new.operations` for each skill whose manifest declares `permissions_model: operations`. An agent that narrowed `[A, B]` from a template `[A, B, C]` keeps `[A, B]` when template stays the same. An agent that narrowed `[A, B]` from a template that shrinks to `[A]` rebases to `[A]`. An agent with null (inheriting) continues to inherit. Strictly simpler than a true three-way merge (no diff-tracking), and delivers R7's stated behavior. The shared helper is `syncSkillsToAgent(agentId, tenantId, templateSkills, currentAgentSkills)`, factored so `syncTemplateToAllAgents` picks up the intersection semantics for free.
- **Render-only tri-state.** `agent_skills.permissions.operations` stays a flat `string[]`. The UI computes `inherited` / `allowed` / `denied` at render time by diffing against the template's list. "Explicit allowed" and "inherited" collapse on save — this is correct behavior under the narrow-only invariant, since an agent's storage being a subset of the template's list means the two states are functionally identical at persistence. If the template later removes an op that the agent had "explicitly allowed," the intersection sync correctly drops it from the agent. Avoids a schema migration and the complexity of an override-model. See also "Alternative Approaches Considered."
- **Reuse existing `getCatalogSkill(slug)` REST endpoint for manifest metadata.** No new GraphQL surface. The endpoint already returns the full parsed YAML including `scripts[]`. Unit 4 only widens the client-side `CatalogSkill` TypeScript type in `apps/admin/src/lib/skills-api.ts`. Avoids widening the list endpoint (which mobile also consumes) and avoids cross-app codegen regeneration for a new GraphQL type.
- **Hand-rolled SQL migration with `-- updates:` marker for R13 backfill.** Per CLAUDE.md + the prior-learnings doc. Data mutation (jsonb-array-element update on `agent_templates.skills`), not schema change. Idempotent guard: only updates elements where `permissions` is absent or null. The drift reporter doesn't natively cover pure-data migrations (no schema object to declare), so the file uses a small sentinel: include a `-- creates:` marker for a no-op partial index that only exists post-apply, so `scripts/db-migrate-manual.sh` can gate on its presence.
- **Ceiling fetch on per-agent Skills tab: extend `AgentDetailQuery`.** Add `template { skills }` to the same round-trip. Avoids N+1 / cache-invalidation complexity of a separate fetch. No new resolver — the `agent.template` relation already exists.
- **Add-Skill on template auto-seeds default_enabled ops.** When an operator adds a `permissions_model: operations` skill to a template via the Add dialog, initial `permissions.operations` is populated from the manifest's `default_enabled: true` entries. Mirrors R13 backfill intent and prevents an immediate R12 empty-allowlist warning on first add. Does NOT apply to the per-agent Skills tab add flow (agents inherit from template on add).
- **`templateSyncDiff` skill signature includes `permissions`.** Extending the existing signature (`JSON.stringify({config, model_override, enabled})` → include `permissions`). Without this, operators who edit only permissions see "no changes" and Push silently wipes narrowing. The `TemplateSyncDialog` surfaces a per-op delta ("+ ops granted, − ops revoked") grouped by affected agent so Push is an informed decision.
- **R16 self-target rejection at `setAgentSkills` top.** `if (ctx.auth.authType === 'apikey' && ctx.auth.agentId === args.agentId) throw forbidden(...)`. Placed inline at the top of the resolver (after tenant fetch, before any write). Legitimate cross-agent provisioning (reconcilers, onboarding) continues; `set_agent_skills` stays `default_enabled: true`.
- **Concurrent editor race: last-writer-wins v1.** No `If-Match`/version guard on `updateAgentTemplate` or `setAgentSkills`. The audit log (already structured-logged for admin mutations) is the recovery surface. Optimistic concurrency is a future PR, not in this plan.
- **Deploy ordering: migration first, UI second (or gated concurrent).** R13 SQL lands in deploy N; the UI in deploy N or N+1. If concurrent, the deploy.yml `db:migrate-manual` drift gate blocks the deploy if the SQL hasn't applied. This prevents a window where the UI shows R12 warnings for templates that would be fine post-backfill.

## Open Questions

### Resolved During Planning

- **Three architecture P1s from the brainstorm** — see Key Technical Decisions: write-time subset check, intersection sync, render-only tri-state.
- **Standalone agents** — `agents.template_id` is `.notNull()`; scenario cannot arise. Remove from ambiguity.
- **GraphQL surface for manifest metadata** — reuse `getCatalogSkill(slug)` REST; no new GraphQL type needed.
- **Migration location** — hand-rolled SQL under `packages/database-pg/drizzle/` per CLAUDE.md convention.
- **Drizzle `undefined`-in-`.set()` behavior** — preserves on update, writes NULL on insert (characterized in origin Dependencies section). R11's fix specifically targets the Add-Skill insert path.
- **Add Skill seed behavior on template** — auto-seed default_enabled on add. Prevents immediate R12 warning.
- **Ceiling fetch shape on per-agent Skills tab** — extend `AgentDetailQuery` with `template { skills }` in the same round-trip.

### Deferred to Implementation

- **`permissions_model` validator drift.** Unit 3 verifies `packages/agentcore-strands/agent-container/test_skill_yaml_coercion.py` and the sync script tolerate a new top-level key. If either rejects it, Unit 3 extends the validator; can't know the exact shape without running the test.
- **Exact grouping key for the checkbox list.** `script.path` segments (e.g., `scripts/operations/reads.py`) → display label (`reads.py`) needs a small normalization helper. Obvious but not pre-specified.
- **Partial-index sentinel for R13 backfill drift-gating.** The specific predicate that makes the sentinel index meaningful only post-apply is a detail best chosen while writing the SQL — e.g., a predicate asserting at least one `thinkwork-admin` template has non-null permissions.
- **TemplateSyncDialog copy.** The exact warning text for permissions-revoking syncs is UX polish; prose finalizes during implementation.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
flowchart LR
    subgraph Manifest["skill.yaml (Unit 3)"]
        PM[permissions_model: operations]
        SC[scripts[]: {name, path, description, default_enabled}]
    end

    subgraph REST["getCatalogSkill(slug) — existing"]
        PM --> Payload[Full parsed YAML]
        SC --> Payload
    end

    subgraph AdminSPA["Admin SPA (Units 4, 7, 8, 9)"]
        CT[CatalogSkill type widened]
        TP[Template Skills tab<br/>Permissions sub-panel]
        AP[Per-agent Skills tab<br/>Permissions sub-panel<br/>tri-state inherited/allowed/denied]
        RT[R11: AgentDetailQuery + SetAgentSkillsMutation<br/>round-trip permissions]
        Payload --> CT
        CT --> TP
        CT --> AP
    end

    subgraph Backend["GraphQL resolvers (Units 1, 2, 5, 6)"]
        UAT[updateAgentTemplate + requireTenantAdmin]
        SAS[setAgentSkills + self-target reject + subset check]
        STA[syncTemplateToAgent<br/>intersection-based merge]
        TSD[templateSyncDiff: sig includes permissions<br/>per-op delta]
        TP -->|updateAgentTemplate| UAT
        AP -->|setAgentSkills| SAS
        RT -->|setAgentSkills| SAS
        TP -->|sync flow| TSD
        TSD --> STA
    end

    subgraph DB["Aurora Postgres (Unit 4)"]
        AT[(agent_templates.skills jsonb)]
        AS[(agent_skills.permissions jsonb)]
        UAT --> AT
        SAS --> AS
        STA --> AS
    end

    subgraph Migration["Unit 4: hand-rolled SQL"]
        SQL[Backfill default_enabled ops<br/>for every template with thinkwork-admin]
        SQL --> AT
    end

    subgraph Runtime["Existing runtime check"]
        RQA[requireAgentAllowsOperation<br/>reads agent_skills.permissions.operations]
        AS --> RQA
    end
```

Key shape notes:
- Template's `skills` is a jsonb blob containing an array of `{skill_id, enabled, permissions?, ...}`. R7 invariant: for a given agent, `agent_skills.permissions.operations ⊆ agent_templates.skills[skill_id].permissions.operations`.
- Tri-state is render-only. Storage is flat `string[]`. UI computes:
    - `inherited`: op ∈ template AND agent row is null (no override yet)
    - `allowed`: op ∈ template AND op ∈ agent's explicit array
    - `denied`: op ∈ template AND op ∉ agent's explicit array
    - Any op not in template is not rendered as a selectable option at all
- `syncTemplateToAgent` intersection: `agent_new.permissions.operations = (agent_current.permissions.operations ?? template_new.permissions.operations) ∩ template_new.permissions.operations`. Inheritance (null) propagates as inheritance.

## Implementation Units

- [ ] **Unit 1: `updateAgentTemplate` authz gate (R15, prerequisite)**

**Goal:** Close the raw-UPDATE authorization gap in `updateAgentTemplate` before any new surface relies on it. Mirror `setAgentSkills`'s row-derived-tenant-pin pattern.

**Requirements:** R15

**Dependencies:** None (prerequisite for all subsequent units that extend the template input shape)

**Files:**
- Modify: `packages/api/src/graphql/resolvers/templates/updateAgentTemplate.mutation.ts`
- Test: `packages/api/src/graphql/resolvers/templates/updateAgentTemplate.mutation.test.ts` (create if absent; repo convention uses `.test.ts` sibling or `__tests__/` subfolder — match whichever this resolver family uses)

**Approach:**
- Before the Drizzle `set: Record<string, any>` build: SELECT `tenant_id` from `agent_templates` by `args.id`; if missing, throw `NOT_FOUND`; else call `requireTenantAdmin(ctx, template.tenant_id)`.
- Use the `DbOrTx` pattern: pass a transaction handle if one is easily threaded, so role check + write are atomic. Matches `createAgentTemplate`'s style but derived from the row, not the input.
- Rename `_ctx` → `ctx` in the signature.

**Execution note:** Test-first — write the "unauthenticated caller is refused" and "non-admin same-tenant caller is refused" tests before the resolver change. These are the P0 regressions that Unit 1 prevents.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.ts:22-27` (row-lookup → `requireTenantAdmin`).
- `packages/api/src/graphql/resolvers/templates/syncTemplateToAgent.mutation.ts:41,54` (template `tenant_id` lookup → gate).

**Test scenarios:**
- Happy path: cognito caller who is admin of the template's tenant succeeds and writes are persisted.
- Error path: no `ctx.auth` → throws `UNAUTHENTICATED` (via `requireTenantAdmin`'s internal gate).
- Error path: cognito caller who is member (not admin) of the template's tenant → throws `FORBIDDEN`.
- Error path: cognito caller who is admin of a DIFFERENT tenant than the template's → throws `FORBIDDEN`.
- Error path: template id does not exist → throws `NOT_FOUND` before any auth check leaks tenant info.
- Happy path: apikey caller with valid admin-role agent in the template's tenant succeeds.
- Edge case: Google-federated caller whose `ctx.auth.tenantId` is null still resolves tenant from the target row, not the caller. (Regression against the institutional learning doc's P0 call-out.)

**Verification:**
- All existing `updateAgentTemplate` callers continue to work (admin SPA template save, any thinkwork-admin `update_agent_template` wrapper if present).
- The resolver file no longer contains `_ctx`.
- Typecheck passes after renaming.

---

- [ ] **Unit 2: `setAgentSkills` self-target rejection (R16, prerequisite)**

**Goal:** Prevent an agent holding `thinkwork-admin` with `set_agent_skills` in its allowlist from rewriting its own `permissions.operations`. Closes the self-bootstrapping privilege escalation identified in document review.

**Requirements:** R16

**Dependencies:** None

**Files:**
- Modify: `packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.ts`
- Test: `packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.test.ts` (create or extend)

**Approach:**
- Inline check **before** the tenant fetch + `requireTenantAdmin` call, so the self-target guard is order-independent of any future changes to `requireTenantAdmin`: if `ctx.auth.authType === 'apikey' && ctx.auth.agentId && ctx.auth.agentId === args.agentId`, throw a `FORBIDDEN` error ("an agent cannot modify its own skill permissions"). Today `requireTenantAdmin` unconditionally refuses apikey callers, so positioning doesn't matter for correctness; but the self-target check should be load-bearing on its own merits, not order-coupled to an unrelated gate.
- `set_agent_skills` stays `default_enabled: true` in the manifest — legitimate cross-agent provisioning (reconcilers, onboarding automations) is unaffected. "Self-target" here means an agent rewriting its own allowlist; cross-agent writes from one agent to a sibling agent are not blocked by this check.
- Cognito callers are unaffected (no `agentId` on the principal).

**Execution note:** Test-first.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/core/authz.ts:43-47` (`forbidden(...)` helper).

**Test scenarios:**
- Error path: apikey caller with `ctx.auth.agentId === args.agentId` → throws `FORBIDDEN`; agent row is not modified.
- Happy path: apikey caller with `ctx.auth.agentId !== args.agentId` (legitimate cross-agent provisioning) → succeeds normally.
- Happy path: cognito caller (no `agentId` on principal) → unaffected.
- Edge case: apikey caller with no `ctx.auth.agentId` somehow (misconfigured principal) → does not throw self-target error; tenant admin check alone governs.

**Verification:**
- The reconciler-style "agent X provisions agent Y" flow (from the predecessor plan's test fixtures) continues to pass.
- New test "agent X cannot rewrite agent X's own permissions" fails before the change, passes after.

---

- [ ] **Unit 2b: `syncTemplateToAllAgents` Cognito-only catastrophic-tier gate (R17, prerequisite)**

**Goal:** Block apikey callers (including agents holding `thinkwork-admin` with `sync_template_to_all_agents` in their allowlist) from invoking the tenant-wide fan-out. Tenant-wide permissions propagation is catastrophic-blast — it must go through a Cognito-authenticated admin session where audit trail is strongest.

**Requirements:** R17

**Dependencies:** None (independent security gate; does not depend on the sync rewrite in Unit 6a — can land before it).

**Files:**
- Modify: `packages/api/src/graphql/resolvers/templates/syncTemplateToAllAgents.mutation.ts`
- Test: `packages/api/src/graphql/resolvers/templates/syncTemplateToAllAgents.mutation.test.ts` (create or extend)

**Approach:**
- Add `requireNotFromAdminSkill(ctx)` call near the top of the resolver, alongside the existing `requireTenantAdmin`. `requireNotFromAdminSkill` is already defined in `packages/api/src/graphql/resolvers/core/authz.ts` for the catastrophic-tier pattern and throws `FORBIDDEN` for apikey callers unconditionally. Single-agent `syncTemplateToAgent` is unaffected — this plan only gates the fan-out. Ordering: place before `requireTenantAdmin` so the gate fires before any tenant lookup, making the check order-independent of future auth helper changes.
- Update the `thinkwork-admin` skill's `set_agent_skills`/`sync_template_to_all_agents` wrapper (Python side, `packages/skill-catalog/thinkwork-admin/scripts/operations/templates.py` or equivalent) to surface a clear error when the resolver refuses, so an agent hitting the gate gets a descriptive message rather than a raw GraphQL error.

**Execution note:** Test-first — write the "apikey caller is refused" test before the gate.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/core/authz.ts:211` (`requireNotFromAdminSkill`).
- Any existing resolver that already calls `requireNotFromAdminSkill` — grep for callers to confirm the expected surface.

**Test scenarios:**
- Error path: apikey caller (authType === 'apikey') → throws `FORBIDDEN`; no agents synced.
- Happy path: cognito caller who is tenant admin → succeeds, fan-out runs.
- Error path: cognito caller who is not tenant admin → throws `FORBIDDEN` via requireTenantAdmin (pre-existing behavior, regression test).
- Integration: thinkwork-admin agent attempting `sync_template_to_all_agents` gets a descriptive error surfaced to the skill-run log (not a raw GraphQL resolver error).

**Verification:**
- Existing admin SPA flow (tenant admin clicking Push in TemplateSyncDialog) continues to work.
- Any existing apikey automation that relied on calling syncTemplateToAllAgents — grep for callers before merge; if one exists, decide whether to refactor it to Cognito or accept the break.

---

- [ ] **Unit 3: Skill manifest `permissions_model` flag + Strands validator check**

**Goal:** Add the `permissions_model: operations` top-level key to `thinkwork-admin/skill.yaml` and confirm no manifest-consuming code rejects it silently (Strands YAML coercion test, catalog sync script).

**Requirements:** R1, R3

**Dependencies:** None (independent; can land in any order before Unit 8/9)

**Files:**
- Modify: `packages/skill-catalog/thinkwork-admin/skill.yaml`
- Verify (and modify if they reject the new key): `packages/agentcore-strands/agent-container/test_skill_yaml_coercion.py`, `packages/skill-catalog/scripts/sync-catalog-db.ts`
- Test: an existing pytest or new fixture case for the coercion test

**Approach:**
- Insert `permissions_model: operations` near line 14 of `skill.yaml` (after `is_default: false`, keeping alphabetical-ish ordering with existing keys).
- Run `uv run pytest packages/agentcore-strands/agent-container/test_skill_yaml_coercion.py` and confirm round-trip works. If the validator rejects unknown keys, extend the schema to tolerate an optional `permissions_model: Optional[str]` field.
- Run `pnpm --filter @thinkwork/skill-catalog sync:dev` (or whatever the local script name is) and verify `skill_catalog.tier1_metadata` picks up the new key (tier1_metadata stores the full parsed YAML, so this should propagate for free — confirm with a SQL SELECT).
- Cross-reference the `docs/solutions/build-errors/dockerfile-explicit-copy-list-drops-new-tool-modules-2026-04-22.md` pattern: ensure the new key isn't silently dropped at container build time by the Dockerfile's COPY rules.

**Patterns to follow:**
- Existing skill.yaml structure at `packages/skill-catalog/thinkwork-admin/skill.yaml` — flat top-level keys.

**Test scenarios:**
- Happy path: `uv run pytest packages/agentcore-strands/agent-container/test_skill_yaml_coercion.py` passes with the new key present.
- Integration: after `sync-catalog-db.ts` runs in dev, a SQL `SELECT tier1_metadata->'permissions_model' FROM skill_catalog WHERE slug='thinkwork-admin'` returns `"operations"`.
- Edge case: a skill.yaml without `permissions_model` still loads (the key is optional; absence = classic free-form permissions).

**Verification:**
- `pnpm --filter @thinkwork/skill-catalog lint` passes.
- The Strands container still boots when rebuilt locally.

---

- [ ] **Unit 4: Hand-rolled SQL backfill migration (R13, R14)**

**Goal:** Seed `permissions.operations` on every existing template where `skills` includes `thinkwork-admin`. Idempotent, re-runnable, drift-gated.

**Requirements:** R13, R14

**Dependencies:** Unit 3 (manifest flag must exist in the catalog before UI relies on it; backfill itself does not read the manifest — seeds are hardcoded in the SQL).

**Files:**
- Create: `packages/database-pg/drizzle/NNNN_seed_thinkwork_admin_permissions.sql` (choose next unused number — current max is `0020_mutation_idempotency.sql`)
- Modify: `docs/plans/2026-04-22-008-feat-agent-skill-permissions-ui-plan.md` header as the `plan link` in the SQL header

**Approach:**
- Follow the `0019_webhook_skill_runs.sql` template for header structure.
- Header block: plan link, apply command, drift-detection command, purpose.
- Pre-flight: `DO $$ BEGIN IF to_regclass('public.agent_templates') IS NULL THEN RAISE EXCEPTION 'agent_templates not found'; END IF; END $$;`
- Data statement: `UPDATE agent_templates SET skills = (SELECT jsonb_agg(...) FROM jsonb_array_elements(skills) ...)` with a canonical jsonb-array-element-transform CTE. For each array element: if `skill_id = 'thinkwork-admin'` AND (`permissions` IS NULL OR `permissions` = '{}'::jsonb OR NOT `permissions` ? 'operations'), set `permissions = jsonb_build_object('operations', to_jsonb(ARRAY[<ops-from-manifest>]))`.
- **Do not hardcode the op list in the plan. Derive it from the manifest at implementation time.** Read `packages/skill-catalog/thinkwork-admin/skill.yaml`, collect every `scripts[].name` where `default_enabled: true`, emit those names as string literals in the SQL's `ARRAY[...]`. Verify count matches the manifest's default_enabled count (should be 29 of 33). Omit the 4 `default_enabled: false` ops (e.g., `remove_tenant_member`, `remove_team_agent`, `remove_team_user`, `sync_template_to_all_agents`). A small build script (e.g., `pnpm tsx packages/skill-catalog/scripts/gen-thinkwork-admin-seed-sql.ts > packages/database-pg/drizzle/NNNN_seed_thinkwork_admin_permissions.sql`) is the safest path; if that feels heavy, write the SQL by hand from a fresh read of the manifest and paste the manifest-parsed list into the PR description for review.
- Idempotent guard in WHERE: only transform array elements whose `permissions` is absent OR `null`::jsonb OR lacks the `operations` key. A re-run after partial apply is safe.
- **No drift-gate sentinel.** The migration is a pure data backfill — no schema object is created, and the `db:migrate-manual` drift reporter gates on object presence, not data content. A sentinel view or partial index created solely to satisfy the reporter adds a permanent schema object for a one-time migration; not worth it. Follow the CLAUDE.md pattern for pure-data migrations: document the backfill in the file header, paste a before/after `SELECT` in the PR description, and rely on deploy ordering + idempotency to prevent drift. The migration is re-runnable, so a missed apply is recoverable by re-running.
- Header markers: `-- updates: public.agent_templates.skills` (the reporter tolerates `-- updates:` for data changes; no `-- creates:` needed).

**Execution note:** Apply to dev via `psql "$DATABASE_URL" -f <file>`, paste `\d+ agent_templates` and a sample `SELECT skills FROM agent_templates WHERE skills @> '[{"skill_id":"thinkwork-admin"}]'::jsonb LIMIT 3` to the PR description before merge.

**Patterns to follow:**
- `packages/database-pg/drizzle/0019_webhook_skill_runs.sql` (header structure, marker conventions).
- `packages/database-pg/drizzle/0020_mutation_idempotency.sql` (pre-flight `to_regclass` probe).

**Test scenarios:**
- Happy path: dev DB with two templates — one with `thinkwork-admin`, one without. Apply SQL. First template's `skills[i].permissions.operations` has the 29 default-enabled ops; second template is unchanged.
- Happy path: re-apply same SQL. No rows modified (idempotent).
- Edge case: template with `thinkwork-admin` that already has `permissions.operations = ['invite_member']` (operator pre-authored via API). SQL does NOT overwrite — idempotent guard respects existing values.
- Edge case: template with `thinkwork-admin` that has `permissions = {}` (empty object, no `operations` key). SQL seeds `operations` without replacing the object.
- Integration: `pnpm db:migrate-manual` reports no MISSING after apply.
- Post-condition: `SELECT count(*) FROM agent_templates WHERE skills @> '[{"skill_id":"thinkwork-admin"}]'::jsonb AND skills @> '[{"skill_id":"thinkwork-admin","permissions":{"operations":["me"]}}]'::jsonb` returns the same count as total templates with thinkwork-admin.

**Verification:**
- Drift reporter (`bash scripts/db-migrate-manual.sh`) reports no MISSING rows referencing this file.
- Existing agents with `thinkwork-admin` and empty/null permissions now have a non-empty effective allowlist via inheritance (R14).

---

- [ ] **Unit 5: Permissions subset helper + resolver-side subset enforcement**

**Goal:** New shared helper validates `agent.ops ⊆ template.ops` and enforces it at `setAgentSkills` write time. Closes the UI-only-contract gap for non-UI callers.

**Requirements:** R4, R5, R10

**Dependencies:** Unit 2 (self-target rejection) — the subset check runs after the self-target check; both live at the top of the resolver.

**Files:**
- Create: `packages/api/src/lib/skills/permissions-subset.ts`
- Modify: `packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.ts`
- Test: `packages/api/src/lib/skills/permissions-subset.test.ts`
- Test: extend `setAgentSkills.mutation.test.ts` from Unit 2

**Approach:**
- Helper exports exactly two public functions (mirroring `validateTemplateSandbox`'s single-exported-function shape; keep `parsePermissions` private):
    - `validateAgentSkillPermissions(agentPerms, templatePerms, manifestOps): { ok: true } | { ok: false; error: string }` — enforces `agent.ops ⊆ template.ops ⊆ manifestOps`. Returns granular error (`"op 'foo' not authorized by template"`). Internal `parsePermissions` helper handles AWSJSON string, parsed object, null, empty array.
    - `intersectPermissions(agentOps, templateOps): string[]` — pure function used by Unit 6. Keep it in this file because Unit 5 and Unit 6 are the only callers; the shared module name remains `packages/api/src/lib/skills/permissions-subset.ts`.
- `setAgentSkills`: for each skill in `args.skills` where the skill's manifest declares `permissions_model: operations` (sourced below), fetch the template's per-skill permissions, call `validateAgentSkillPermissions`, throw `BAD_USER_INPUT` on violation.
- **manifestOps source:** resolver reads `skill_catalog.tier1_metadata` for each distinct skill_id in the incoming payload (one SELECT per distinct skill_id, cached in a Map within the resolver call). `tier1_metadata` is stored as a JSON-stringified blob by `packages/skill-catalog/scripts/sync-catalog-db.ts:170` (not native jsonb structure), so the resolver must `JSON.parse(row.tier1_metadata)` and extract `.scripts[].name` for default_enabled ops and `.permissions_model` for the opt-in flag. Agents' `template_id` is notNull; the template always exists.
- **Defensive resolver guard for mobile-deferral safety (R11 bridge fix):** mobile SPA still omits `permissions` from its `SetAgentSkills` fragment (Scope Boundaries). To prevent a mobile-initiated save from silently nulling `permissions`, change the resolver's `onConflictDoUpdate.set(...)` payload to conditionally include `permissions` only when `s.permissions !== undefined`: `set: { config, ...(s.permissions !== undefined ? { permissions: parsedPermissions } : {}), rate_limit_rpm, ... }`. Same for the `.values(...)` insert payload — but the insert path already has the UI always sending a value post-Unit-7. This two-line change makes the mobile deferral safe in the meantime, and remains correct after mobile catches up.

**Execution note:** Helper is test-first — the pure-function behavior is straightforward and fully unit-testable. Resolver wiring lands after helper is green.

**Patterns to follow:**
- `packages/api/src/lib/templates/sandbox-config.ts:validateTemplateSandbox` — exact shape.
- `packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.ts:71-75` — where `permissions` is parsed; the new validator slots in just after.

**Test scenarios:**
- Helper happy path: `agentOps = ['a', 'b']`, `templateOps = ['a', 'b', 'c']` → `{ ok: true }`.
- Helper error: `agentOps = ['a', 'd']`, `templateOps = ['a', 'b', 'c']` → `{ ok: false, error: "op 'd' not authorized by template" }`.
- Helper edge: `agentOps = null` (inheriting), any template → `{ ok: true }` (inheritance is always valid).
- Helper edge: `agentOps = []` (explicit narrowed-to-empty), any template → `{ ok: true }` (empty is always a subset).
- Helper edge: `agentOps = ['a']`, `templateOps = null` (template never authored) → `{ ok: false, error: "template has no permissions authored for this skill" }`.
- Helper edge: `intersectPermissions(['a', 'b', 'c'], ['b', 'c', 'd'])` → `['b', 'c']` (order preserved from first argument).
- Resolver integration happy path: admin caller writes `permissions.operations = ['me', 'list_agents']` for an agent whose template has those ops → write succeeds.
- Resolver integration error: admin caller writes `permissions.operations = ['remove_tenant_member']` for an agent whose template authorizes `['me', 'list_agents']` → throws; row not modified.
- Resolver integration happy path: caller writes for a skill without `permissions_model: operations` in its manifest → no subset check runs; arbitrary `permissions` jsonb accepted (backward compatibility).
- Edge: apikey caller passing the exact self-target scenario from Unit 2 → Unit 2's self-target check fires first.

**Verification:**
- `requireAgentAllowsOperation` is unchanged; the write-time check is the only new enforcement.
- Existing tests for `setAgentSkills` (reconciler flow, template-sync-flow) continue to pass.

---

- [ ] **Unit 6a: `syncTemplateToAgent` intersection rewrite (+ `syncTemplateToAllAgents` by delegation)**

**Goal:** Replace wholesale delete+insert with an intersection-based merge that preserves per-agent narrowing. This is the load-bearing fix for R7.

**Requirements:** R7

**Dependencies:** Unit 5 (reuses `intersectPermissions`).

**Files:**
- Modify: `packages/api/src/graphql/resolvers/templates/syncTemplateToAgent.mutation.ts`
- Modify: `packages/api/src/graphql/resolvers/templates/syncTemplateToAllAgents.mutation.ts` (verify existing delegation still works; no logic change beyond what falls out of Unit 6a's rewrite)
- Test: `packages/api/src/graphql/resolvers/templates/syncTemplateToAgent.mutation.test.ts` (extend)

**Approach:**
- **Inline the intersection logic as a private function in `syncTemplateToAgent.mutation.ts`; do NOT extract a new `sync-skills-to-agent.ts` file.** `syncTemplateToAllAgents` already delegates to `syncTemplateToAgent` in a loop — the intersection semantics propagate for free via the existing delegation. The only new shared symbol is `intersectPermissions` from Unit 5's `permissions-subset.ts`. Applies the single-consumer-abstraction principle from `docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md`.
- Private `computeSyncedSkills(templateSkills, currentAgentSkills): SyncedSkill[]`:
    - Build a Map<skill_id, current agent row> from `currentAgentSkills`.
    - For each `templateSkill`: look up current agent row by skill_id. For a skill whose manifest declares `permissions_model: operations`: `new_perms.operations = agent_current.operations === null ? null : intersectPermissions(agent_current.operations, template.permissions.operations)`. For other skills: preserve `agent_current.permissions` verbatim (not template's) — matches the "permissions is only template-derived for permissions_model skills" invariant.
    - Config, model_override, enabled: keep the existing template-wins semantics (not the subject of this plan).
- `syncTemplateToAgent.mutation.ts`: replace the existing `delete + insert` block with: (1) fetch current agent_skills keyed by skill_id, (2) call `computeSyncedSkills`, (3) delete skills NOT in the template, (4) upsert the remaining skills via `onConflictDoUpdate` keyed on `(agent_id, skill_id)` (not delete+insert). Keep the existing `snapshotAgent` call before writes.
- **Defensive tenant assertion:** before processing, assert `agent.tenant_id === template.tenant_id`. If not, throw `FORBIDDEN` (or add to `SyncSummary.errors` for the bulk variant). Protects against the theoretical cross-tenant agent/template link surfaced during review. Template `tenant_id` is already loaded; agent `tenant_id` lookup is free (already happening).

**Execution note:** Characterization-first — write a test that captures the current delete+insert behavior before rewriting. This is legacy code touching production data; a failing characterization test is cheap insurance against accidentally changing `config` / `model_override` / `enabled` semantics.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.ts:43-98` (upsert pattern with onConflictDoUpdate keyed on `(agent_id, skill_id)`).
- `packages/api/src/lib/agent-snapshot.ts:snapshotAgent` (already captures permissions; no change needed here).

**Test scenarios:**
- Happy path: agent has narrowed `[me, list_agents]`, template has `[me, list_agents, invite_member]`. After sync: agent still has `[me, list_agents]` (narrowing preserved).
- Happy path: agent inherits (null), template has `[me, list_agents]`. After sync: agent still has null (inheritance preserved).
- Edge: agent has `[me, remove_tenant_member]` (pre-Unit-5 legacy data). Template shrinks to `[me]`. After sync: agent has `[me]` (rebase fires; superset op drops).
- Edge: agent has `[]` (explicit narrowed-to-empty). Template has `[me]`. After sync: agent still has `[]`.
- Edge: template's skill list no longer includes `thinkwork-admin`. After sync: agent's `thinkwork-admin` row is deleted.
- Edge: agent.tenant_id !== template.tenant_id (legacy data integrity gap). Throws FORBIDDEN.
- Rollback: trigger a bad sync mid-loop for one agent in `syncTemplateToAllAgents`; verify the snapshot-based rollback restores that agent's pre-sync `permissions.operations` bit-for-bit.

**Verification:**
- Existing `acceptTemplateUpdate` and unrelated sync tests continue to pass.
- Manual admin UI smoke: operator narrows template permissions; Push; spot-check 2 agents retain narrowing within new ceiling; one agent previously at [remove_tenant_member] is rebased.

---

- [ ] **Unit 6b: `templateSyncDiff` permissions-aware + `TemplateSyncDialog` delta surfacing**

**Goal:** Surface permissions deltas in the sync confirmation UI so operators see what Push will do. Separated from Unit 6a so the backend correctness fix and the UX polish can ship/review independently.

**Requirements:** R7

**Dependencies:** Unit 6a (sync merge works correctly before we start showing its results to operators).

**Files:**
- Modify: `packages/api/src/graphql/resolvers/templates/templateSyncDiff.query.ts`
- Modify: `apps/admin/src/routes/_authed/_tenant/agent-templates/-components/TemplateSyncDialog.tsx` (path to confirm during implementation — dialog is invoked from `$templateId.tsx` line ~953)
- Test: `packages/api/src/graphql/resolvers/templates/templateSyncDiff.query.test.ts` (extend)

**Approach:**
- `templateSyncDiff.query.ts`: extend the skill signature from `JSON.stringify({config, model_override, enabled})` to include `permissions.operations` (sorted for stable comparison). Add a computed `permissionsDelta: {added: string[], removed: string[]}` per changed skill per agent; add it to the existing diff shape (AWSJSON-packed). **Minimum-viable scope for v1:** signature + per-skill `permissionsDelta`. Per-op grouping across agents and per-agent disclosure lists are polish that can layer on later.
- `TemplateSyncDialog.tsx`: when `permissionsDelta` is non-empty for any agent, render a "Permission changes" section with aggregate text (e.g., "3 agents will lose `invite_member`, 1 agent will gain `create_team`"). Disclosure-toggle to expand per-agent names is a nice-to-have; ship the aggregate first. Uses existing shadcn/ui primitives. Text copy finalizes during implementation.

**Test scenarios:**
- Happy path: template with only a permissions change now shows `skillsChanged = [{skill_id: 'thinkwork-admin', permissionsDelta: {added: [], removed: ['invite_member']}}]` (previously returned empty — regression test).
- Edge: template with both a config change and a permissions change for the same skill → both deltas surfaced.
- Integration (admin UI smoke): operator saves template with permissions narrowed; TemplateSyncDialog shows the "N agents will lose [op]" text before Push.

**Verification:**
- Operators saving a permissions-only template change see a non-empty diff and confirmation summary.

**Execution note:** Characterization-first — write a test that captures the current delete+insert behavior before rewriting. This is legacy code touching production data; a failing characterization test is cheap insurance against accidentally changing `config` / `model_override` / `enabled` semantics.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.ts:43-98` (upsert pattern with onConflictDoUpdate keyed on `(agent_id, skill_id)`).
- `packages/api/src/graphql/resolvers/templates/acceptTemplateUpdate.mutation.ts` (shared-helper + bulk-variant factoring — mirror this shape).
- `packages/api/src/lib/agent-snapshot.ts:snapshotAgent` (already captures permissions; no change needed here).

**Test scenarios:**
- Helper happy path: agent has narrowed `[me, list_agents]`, template has `[me, list_agents, invite_member]`. After `syncSkillsToAgent`: agent still has `[me, list_agents]` (narrowing preserved).
- Helper happy path: agent inherits (null), template has `[me, list_agents]`. After sync: agent still has null (inheritance preserved).
- Helper edge: agent has `[me, remove_tenant_member]` (shouldn't be possible post-Unit-5, but legacy data might). Template shrinks to `[me]`. After sync: agent has `[me]` (rebase fires, `remove_tenant_member` drops).
- Helper edge: agent has `[]` (explicit narrowed-to-empty). Template has `[me]`. After sync: agent still has `[]`.
- Helper edge: template's skill list no longer includes `thinkwork-admin`. After sync: agent's `thinkwork-admin` row is deleted.
- `templateSyncDiff` happy path: template with only a permissions change shows `skillsChanged = [{skill_id: 'thinkwork-admin', permissionsDelta: {added: [], removed: ['invite_member']}}]` (previously showed empty array — regression test).
- `templateSyncDiff` edge: template with both a config change and a permissions change for the same skill → both deltas surfaced.
- Integration (admin UI manual test): operator saves template with permissions narrowed; TemplateSyncDialog shows the "N agents will lose [op]" text before Push.
- Rollback: trigger a bad sync (e.g., force helper to throw mid-loop for one agent in `syncTemplateToAllAgents`); verify the snapshot-based rollback restores that agent's pre-sync `permissions.operations` bit-for-bit.

**Verification:**
- Existing `acceptTemplateUpdate` and unrelated `syncTemplateToAgent` tests continue to pass.
- Manual admin UI smoke: operator narrows template permissions; Push; spot-check 2 agents retain narrowing within new ceiling; one agent previously at [remove_tenant_member] is rebased to the new ceiling.
- `pnpm -r --if-present typecheck` and `pnpm -r --if-present test` pass.

---

- [ ] **Unit 7: Admin SPA data plumbing (R11 round-trip + CatalogSkill widening)**

**Goal:** Thread `permissions` through every admin SPA query/mutation touching agent skills, preventing the Add-Skill NULL-write and per-save drop. Extend `CatalogSkill` TypeScript type to surface `scripts[]` and `permissions_model` from the existing REST payload.

**Requirements:** R11

**Dependencies:** Units 1, 2, 5, 6 (all resolver changes should be live before the UI begins sending `permissions` on the wire).

**Files:**
- Modify: `apps/admin/src/lib/graphql-queries.ts` (add `permissions` to `AgentDetailQuery.skills` fragment; add `permissions` to `SetAgentSkillsMutation` return shape)
- Modify: `apps/admin/src/lib/skills-api.ts` (widen `CatalogSkill` type with `scripts?: Array<{name: string; path: string; description: string; default_enabled: boolean}>` and `permissions_model?: 'operations'`)
- Modify: `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.skills.tsx` (items state, normalizeForSave, handleSaveSkills, handleAddSkill — thread `permissions` through all five touchpoints per research)
- Modify: `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.tsx` (`TemplateSkill` type, `addSkill` handler — permissions field + default_enabled seed on add)
- Run: `pnpm --filter @thinkwork/admin codegen` after query-shape changes. `apps/mobile` and `apps/cli` codegen do NOT need to run as part of this unit — no `.graphql` type files are edited (AgentSkill.permissions / AgentSkillInput.permissions already exist in the schema), so mobile and CLI generated types are already correct. They regenerate on their own schedule.
- Test: extend any `apps/admin/__tests__` coverage for `$agentId_.skills.tsx` (the SPA's test coverage is sparse; see Verification for the manual smoke alternative).

**Empirical verification step for the Drizzle behavior claim.** Before Unit 7 lands, write a characterization test against the existing `setAgentSkills` resolver that (a) creates an `agent_skills` row with `permissions: { operations: ['me'] }`, (b) calls `setAgentSkills` with the `permissions` key omitted from the input payload, (c) SELECTs the row afterward. Observe whether `permissions` is preserved or nulled. Lock the behavior in a test so future Drizzle upgrades don't silently regress. This closes the "preserves on update, writes NULL on insert" assumption that the plan currently cites from the origin Dependencies section without a live test.

**Approach:**
- `graphql-queries.ts`: `AgentDetailQuery.skills { id skillId enabled config permissions }` and `SetAgentSkillsMutation(...) { ... permissions }`.
- `skills-api.ts`: only the type extension; no fetch logic change (the REST endpoint already returns the full shape).
- `$agentId_.skills.tsx`: change `skills.map((s) => ({ skillId, enabled, config }))` at line 137-143 to include `permissions`. Change `normalizeForSave` (line 145-155) to include `permissions`. Change `handleSaveSkills` (line 157-175) and the inline `handleAddSkill` mutation (line 236-267) likewise. `permissions` is AWSJSON → `JSON.stringify` on save, `JSON.parse` on load (same pattern as `config`).
- `$templateId.tsx`: widen `type TemplateSkill` at line ~208 with `permissions?: { operations: string[] } | null`. In `addSkill` (line 435), when the added skill's manifest declares `permissions_model: operations`, seed `permissions = { operations: [...defaultEnabledOpsFromManifest] }`. The `getCatalogSkill(slug)` call returns `scripts[]` — derive the seed list from there at add time (a call per add, acceptable).
- **Insert-path fix (the acute R11 hazard):** `setAgentSkills` resolver's `.values({ permissions })` with undefined writes NULL (characterized in origin Dependencies). After Unit 7, the UI always passes a non-undefined value for existing skills (round-tripped from query) and an explicit seeded value for adds. No resolver change needed.

**Execution note:** Codegen may surface type errors in unrelated files — dev server reloads are expected. Run `pnpm --filter @thinkwork/admin typecheck` after codegen to catch drift.

**Patterns to follow:**
- The `config` field in the same files is the template — round-trips as AWSJSON, stringified on save, parsed on load. `permissions` follows exactly the same lifecycle.
- `apps/admin/src/routes/_authed/_tenant/capabilities/builtin-tools.tsx:ConfigureDialog` (ConfigureDialog's clean state-round-trip pattern).

**Test scenarios:**
- Regression: open admin, open an agent with `thinkwork-admin` assigned, make an unrelated skill toggle (add a different skill), save. Verify via SQL `SELECT permissions FROM agent_skills WHERE agent_id=? AND skill_id='thinkwork-admin'` that `permissions` is unchanged bit-for-bit.
- Regression: open admin, open an agent without `thinkwork-admin`. Add `thinkwork-admin` via Add dialog. Verify `permissions.operations` on the new row contains the default-enabled ops immediately (no R12 warning; no dead skill).
- Codegen: `pnpm --filter @thinkwork/admin codegen` produces a `permissions: any | null` field on the generated `AgentSkill` type.
- Typecheck: `pnpm -r --if-present typecheck` passes across all apps.
- Integration: existing Skills tab smoke tests (toggle enabled, edit config, remove skill) still pass on admin dev server.

**Verification:**
- Admin dev server runs on port 5174 (or 5175+ in a worktree — callback URLs in Cognito already configured).
- Manual smoke: sign in, navigate to `/agents/<id>/skills`, make a save, verify via SQL that `permissions` didn't regress.
- No codegen drift in `apps/mobile` or `apps/cli` after their codegen scripts run.

---

- [ ] **Unit 8: Template Skills tab Permissions sub-panel (R8, R12 template side)**

**Goal:** Author-facing UI on the template edit page. Row-click `thinkwork-admin` (or any skill with `permissions_model: operations`) opens the Permissions sub-panel in the existing row-click dialog. Checkbox list of manifest ops grouped by source file. Empty-list warning when saved state would leave zero ops.

**Requirements:** R8, R10, R12 (template half)

**Dependencies:** Units 3 (manifest flag), 4 (backfill seeds existing templates), 7 (client plumbing), 1 (updateAgentTemplate authz).

**Files:**
- Create: `apps/admin/src/components/skills/PermissionsEditor.tsx` (shared between Units 8 and 9)
- Modify: `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.tsx` (Skills tab row-click handler; inject PermissionsEditor as a new dialog mode when the clicked skill's `permissions_model === 'operations'`)

**Approach:**
- `PermissionsEditor` props: `{ ops: SkillOperation[]; value: string[]; onChange: (next: string[]) => void; mode: 'template' }`. Pure controlled component. No mutation wiring; the parent handles save.
- Ops list: fetched via `getCatalogSkill(slug)` when the dialog opens. Use a `useEffect` keyed on `credDialogSkill`. Cache in component state so reopening is instant.
- Grouping: `groupBy(ops, (op) => op.path.split('/').pop() || 'other')` — produces `{ 'reads.py': [...], 'tenants.py': [...], ... }`. Render each group as a `<Card>` with `<CardHeader>` (group label, op count) + `<CardContent>` (checkbox list). Collapsible via `<details>` is optional for v1.
- Checkbox row: shadcn `<Checkbox>` + `<Label>`. Show `op.description` as helper text under the label. Destructive ops (`default_enabled: false`) get a subtle `<Badge variant="destructive" className="text-xs">destructive</Badge>` tag.
- Empty-list warning (R12): when `value.length === 0 && ops.length > 0`, render an inline `<Alert variant="warning">` above the groups: "No operations enabled — any agent inheriting from this template will have zero effective ops for this skill."
- Template page wiring: existing `credDialogSkill` state gates the dialog; add a derived `dialogMode = 'oauth' | 'creds' | 'permissions'`. Existing dialog footer (Save / Remove / Cancel) stays; Save hooks into the existing template save flow, which serializes `templateSkills` → `skillsJson` → `updateAgentTemplate`.
- `TemplateSkill` type already widened in Unit 7; Save now writes `{skill_id, enabled, permissions: {operations: [...]}}`.

**Execution note:** Manual visual smoke during implementation (open the admin dev server, click through). Automated UI testing for this page is currently sparse; follow-up test infra is out of scope.

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/capabilities/builtin-tools.tsx:ConfigureDialog` — the dialog-does-everything idiom.
- `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspaces.tsx:469-500` — checkbox-list-with-nested-state pattern.
- `apps/admin/src/routes/_authed/_tenant/threads/index.tsx:groupBy` — grouping utility (copy/inline, not extracted to a shared module — per the `inline-helpers-vs-shared-package` learning).
- `apps/admin/src/components/ui/badge-selector.tsx:300-362` (BadgeSelectorMulti) — alternate primitive if the team prefers a searchable popover over an inline list. Start simple (inline); revisit if 33 ops feels overwhelming.

**Test scenarios:**
- Happy path: open template edit page, Skills tab, row-click `thinkwork-admin`. Permissions sub-panel opens. 29 ops pre-checked (default_enabled), 4 unchecked.
- Happy path: uncheck `invite_member`, click Save, reload page, reopen. `invite_member` stays unchecked.
- Happy path: row-click a non-`permissions_model: operations` skill (e.g., `provider-mcp`). Dialog opens in its existing mode (credentials/OAuth); no Permissions sub-panel.
- Edge case: uncheck all ops, click Save. Inline warning shows on the Skills tab row post-save. No modal, no confirmation.
- Edge case: manifest has 0 ops (hypothetical; no real skill has this today). Permissions editor shows an empty state: "This skill has no operations declared in its manifest."
- Edge case: `getCatalogSkill` fetch fails (network). Dialog shows a loading error; Save is disabled.
- Integration: after save, `SELECT skills FROM agent_templates WHERE id=?` shows the expected `permissions.operations` array in the target element.
- Integration: linked agents with null `permissions.operations` inherit the updated list on next `requireAgentAllowsOperation` call.

**Verification:**
- `pnpm --filter @thinkwork/admin typecheck` passes.
- Admin dev server renders the new UI without runtime errors.
- Manual smoke of the template-save → sync flow: narrow permissions, Save, TemplateSyncDialog shows the permission delta (via Unit 6), Push, verify linked agents are intersected correctly.

---

- [ ] **Unit 9: Per-agent Skills tab Permissions sub-panel with tri-state + ceiling fetch (R9, R6, R12 agent side)**

**Goal:** Author-facing UI on the agent detail page. Row-click `thinkwork-admin` opens the Permissions sub-panel with inherited/allowed/denied tri-state visual. Ops beyond the template's ceiling are rendered disabled with an explanatory tooltip.

**Requirements:** R6, R9, R10, R12 (agent half)

**Dependencies:** Unit 8 (reuses `PermissionsEditor` component with `mode: 'agent'`), Unit 5 (subset enforcement backstops client contract), Unit 7 (client plumbing for `permissions` round-trip).

**Files:**
- Modify: `apps/admin/src/components/skills/PermissionsEditor.tsx` (extend to accept `mode: 'agent'` with `ceiling: string[]` + `inheritedByDefault: boolean`)
- Modify: `apps/admin/src/lib/graphql-queries.ts` (extend `AgentDetailQuery` with `agent.template { id skills }` so the client has the ceiling without a second round-trip)
- Modify: `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.skills.tsx` (row-click handler → PermissionsEditor when `permissions_model === 'operations'`)

**Approach:**
- Ceiling fetch: `AgentDetailQuery` already selects `agentTemplate { id name slug model guardrailId blockedTools }` (confirmed in `apps/admin/src/lib/graphql-queries.ts:58-65`). **Widen the existing `agentTemplate` selection to include `skills`** — do not add a new `template { ... }` relation (that field doesn't exist; the correct relation name is `agentTemplate`). Parse the `agentTemplate.skills` AWSJSON, find the skill's `permissions.operations` array — that's the ceiling. If the template has no entry for the skill (shouldn't happen in steady state; could happen mid-migration), treat ceiling as empty and show a loud inline warning: "This skill is not authorized at the template level — contact your template administrator."
- `PermissionsEditor` in `agent` mode:
    - Render every manifest op. For each op, compute state:
        - If `op ∉ ceiling`: render the row disabled. Tooltip: "Not authorized by template." Checkbox reads as unchecked, un-clickable.
        - Else if agent's `permissions.operations` is null: state is `inherited`. Render checkbox as **indeterminate** (checked visual with a subtle distinction, not plain checked) so "inherited" and "explicit allowed" are distinguishable at a glance.
        - Else if `op ∈ agent.permissions.operations`: state is `allowed`. Checkbox checked (fully, not indeterminate).
        - Else: state is `denied` (explicit narrow). Checkbox unchecked.
    - Loading state: while `getCatalogSkill(slug)` and/or the template ceiling data is in flight, render a skeleton placeholder (shadcn `<Skeleton>`) inside the dialog; Save button is disabled. Fetch error → error message + disabled Save.
    - **Save uses dirty-diff semantics, not current-state snapshot.** The editor tracks the initial state at open-time. On Save: compute the delta between initial and current states. If no op differs from its initial state, Save is a no-op (button disabled or emits nothing). If the operator genuinely narrowed (or un-narrowed), compute the new `permissions.operations` array. **If the resulting array is equal to the ceiling AND the agent's initial state was `null` (inheriting)**, write `null` — do not materialize. Only write an explicit array when the operator actually diverged from the template ceiling. This prevents the silent-materialization drift where a passing click-through bakes the current template into the agent and later template additions skip the agent. Render-only tri-state storage stays flat `string[]`; the "explicit allowed" signal lives in `dirty-diff is empty` ⇒ `null` at save time.
    - Special "Reset to template defaults" button: sets local state to `null`, Save writes `null` → inheritance.
- Empty-list warning (R12, agent half): when effective ops = 0 (either ceiling is empty or agent narrowed to empty), show inline `<Alert variant="warning">` above groups. Same copy as template side (see R12 in origin).
- `$agentId_.skills.tsx` dialog mode branching: reuses the pattern from Unit 8 (dialogMode = 'oauth' | 'creds' | 'permissions'). For `thinkwork-admin` specifically — which has no OAuth and no env-vars — the dialog previously showed only the Remove button; now it shows the Permissions editor by default. Footer (Save / Remove / Cancel) layout stays; Remove button stays in the footer across all modes.
- **Skill with both credentials AND `permissions_model: operations`** — no skill today is in this state (`thinkwork-admin` is a platform skill, not an integration). If a future skill combines them, the dialog needs a secondary tab or a stacked layout; out of scope for v1. Document the assumption in a code comment near the dialogMode derivation.

**Execution note:** Test the ceiling-stale race informally — open two admin sessions, narrow template in one, open the other's agent page that was already loaded. Expected behavior: the second session's checkbox list is stale; on Save it may send ops that are no longer in the ceiling, and Unit 5's subset check throws `BAD_USER_INPUT`. The UI should surface this error gracefully; don't invent optimistic version-pinning in v1.

**Patterns to follow:**
- Same as Unit 8.
- Tooltip pattern: shadcn `<Tooltip>` / `<TooltipTrigger>` / `<TooltipContent>` — grep for existing uses in admin for copy-paste starting point.

**Test scenarios:**
- Happy path (inheriting): template has `[me, list_agents, invite_member]`, agent has null permissions. Row-click, dialog opens. All three ops rendered as checked (inherited). No ops rendered disabled.
- Happy path (narrow): operator unchecks `invite_member`, Save. Verify `SELECT permissions FROM agent_skills WHERE agent_id=?` shows `{operations: ['me', 'list_agents']}`.
- Happy path (reset): after narrowing, click "Reset to template defaults". Save. Verify `permissions` is `null` (or absent); reopen dialog — all ops show inherited again.
- Edge: template has `[me, list_agents]`, agent row explicitly has `[me, list_agents, remove_tenant_member]` (legacy data pre-Unit-5). Dialog opens. `remove_tenant_member` is NOT rendered at all (not in ceiling). Ops not in ceiling are simply absent from the agent's view — the subset check would reject a save attempt, so rendering them would confuse operators.
- Edge: template has empty `permissions.operations` (edge case of Unit 8 save-with-no-ops). Agent page opens. Permissions editor renders "No operations authorized by template" empty state. Save is disabled.
- Edge: operator in session A checks op `foo` while operator in session B concurrently narrows template to remove `foo`. Session A saves → Unit 5's subset check throws `BAD_USER_INPUT`. UI catches the error and shows a toast: "Template has changed — reload to see the current ceiling." No data corruption.
- Integration: after save, `requireAgentAllowsOperation(ctx, 'invite_member')` throws for the narrowed agent, passes for a sibling agent inheriting.
- R12: agent narrows to empty array, inline warning appears on the Skills tab row.

**Verification:**
- `pnpm --filter @thinkwork/admin typecheck` passes.
- Admin dev server renders the tri-state correctly.
- Manual smoke of end-to-end: template narrows → TemplateSyncDialog shows delta → Push → agent page reflects new ceiling → narrow further on agent → `thinkwork-admin` op calls from agent respect final allowlist.

## System-Wide Impact

- **Interaction graph:**
    - `setAgentSkills` now reads `agent_templates.skills` per write (template lookup for subset check) — small added latency, one SELECT per call on an indexed PK lookup.
    - `syncTemplateToAgent` now reads current `agent_skills` before writing (intersection requires it). Previously it did an unconditional DELETE.
    - `requireAgentAllowsOperation` hot path is unchanged — still a single row read. The subset invariant is enforced at write time, not read time.
    - Audit log: every `setAgentSkills` and `updateAgentTemplate` call already emits `STRUCTURED_LOG {event_type="admin_mutation"}` per the predecessor plan; this continues untouched.
- **Error propagation:**
    - Subset-violation errors (`BAD_USER_INPUT`) bubble as GraphQL errors; admin SPA catches and shows as toasts.
    - `requireTenantAdmin` failures from Unit 1 bubble as `FORBIDDEN` — any existing caller of `updateAgentTemplate` that was implicitly relying on no-auth will break loudly. This is intentional (closes the security gap).
- **State lifecycle risks:**
    - Concurrent template edits: last-writer-wins. Audit log is the recovery surface. Accepted for v1.
    - Concurrent agent edits: same. `setAgentSkills` idempotencyKey exists in schema but is unused in v1.
    - Rollback: `snapshotAgent` already captures `permissions` per the agent-snapshot lib. Bad sync → snapshot restores.
    - Partial migration apply: R13 SQL is idempotent with a re-run guard. Partial apply can be resumed by re-running.
- **API surface parity:**
    - `AgentSkill.permissions: AWSJSON` and `AgentSkillInput.permissions: AWSJSON` already exist in the canonical schema. No `.graphql` edits; no `pnpm schema:build` needed.
    - Mobile `SetAgentSkills` fragment in `apps/mobile/lib/graphql-queries.ts:135` also omits `permissions` — the same round-trip bug exists there. Fix is deferred to a follow-up (mobile is not currently an authoring surface for `thinkwork-admin`); documented in Scope Boundaries.
- **Integration coverage:**
    - Template save → TemplateSyncDialog → Push → per-agent narrowing preservation is the single most important cross-layer scenario; unit tests alone will not prove it. Manual admin smoke in Unit 6 and Unit 8 is the coverage.
- **Unchanged invariants:**
    - `AgentSkill.permissions` and `AgentSkillInput.permissions` GraphQL types — unchanged.
    - `getCatalogSkill` REST endpoint payload shape — unchanged (existing payload already returns scripts[]; client-side type widening only).
    - `requireAgentAllowsOperation` behavior — unchanged.
    - Cognito auth flow — unchanged.
    - Audit log structure — unchanged (new event types added, existing shape preserved).
    - Mutation idempotency (via `runWithIdempotency`) — untouched; neither `setAgentSkills` nor `updateAgentTemplate` is wrapped in it today, and this plan does not add that wrapping.
- **Write-boundary invariant for `agent_skills.permissions.operations`:** only two code paths write this column after the plan ships — `setAgentSkills` (with full validation: requireTenantAdmin + self-target check + subset check) and `syncTemplateToAgent`'s private `computeSyncedSkills` (which produces subsets by construction via `intersectPermissions`). Any future writer must go through one of these paths, or call `validateAgentSkillPermissions` itself. Document the invariant in a comment at the top of `packages/api/src/lib/skills/permissions-subset.ts`.
- **Known gap on the template-side narrow:** `updateAgentTemplate` writes `skills` as a whole-value jsonb overwrite. When an operator narrows a template (e.g., removes op `X` from template.permissions.operations), agents with `X` in their existing `agent_skills.permissions.operations` temporarily violate the subset invariant until `syncTemplateToAgent` runs. The TemplateSyncDialog is the intended choke point but nothing forces Push — operators can save the template and walk away. `requireAgentAllowsOperation` still allows `X` on those agents during the window. Accepted for v1; operators are tenant-admins with audit-log visibility. See "Open Questions — Deferred to Implementation" for two options (auto-propagate on save / narrow-only validation) that could close this window if it proves operationally problematic.

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| Unit 1's auth gate breaks a legitimate existing `updateAgentTemplate` caller (CLI, automation, thinkwork-admin's own `update_agent_template` wrapper) | Grep for all callers before merge: `rg "updateAgentTemplate\|update_agent_template" --type ts --type py`. If a thinkwork-admin skill wrapper exists, confirm it passes admin auth through. If a CLI caller relies on a service-secret path, surface it — likely needs a separate service-endpoint per the institutional-learnings `service-endpoint-vs-widening-resolvecaller-auth` doc. |
| Unit 6's sync rewrite corrupts production data on first deploy | Characterization test captured before rewrite (per Execution note). Snapshot-based rollback is safe (snapshots capture permissions). Deploy with one template as a canary; verify linked agents post-sync before widening. |
| R13 backfill accidentally overwrites operator-authored `permissions.operations` | Idempotent guard: only transform array elements whose `permissions` is NULL / empty / missing the `operations` key. Dev apply + `\d+` paste + SELECT sample in PR description per the manual-migration institutional-learning doc. |
| `permissions_model` manifest key is silently ignored by Strands container | Unit 3 explicit validator verification step; uses the `dockerfile-explicit-copy-list-drops-new-tool-modules` pattern as precedent for "silent ignore" class bugs. |
| `setAgentSkills` subset-check latency regression at scale (400+ agents × frequent saves) | One indexed PK lookup per write. Negligible at current scale. If it becomes a hot path, cache the template's permissions in the resolver call's local Map (already the design). |
| Admin operator in one session narrows template while another session has stale ceiling open | `BAD_USER_INPUT` from Unit 5's subset check is caught in admin UI and shown as a toast with reload suggestion. No data corruption. v1 accepts the race explicitly. |
| Mobile `SetAgentSkills` still has the round-trip bug | Out of scope; flagged in Scope Boundaries / Deferred to Separate Tasks. Mobile is not currently an authoring surface for thinkwork-admin. |

## Documentation / Operational Notes

- No new docs pages. The origin document in `docs/brainstorms/` stays as the product-level reference.
- A companion solutions doc under `docs/solutions/best-practices/` should capture "subset enforcement at write-time is cheaper than at read-time for closed-universe allowlists" after the plan ships — pending learning, not a deliverable here.
- Deploy ordering: R13 SQL lands in deploy N. UI (Units 7, 8, 9) can land in deploy N or N+1. Worst case — UI ships before SQL — operators see the R12 warning on templates (still usable, just scary-looking). Preferred ordering: stagger across two deploys for safety.
- **CloudWatch monitoring — two metric filters:**
    - Error spike: `STRUCTURED_LOG {event_type="admin_mutation", operation="setAgentSkills", result="error"}` — a spike signals Unit 5's subset check catching misconfigured writes (or a client drift / race).
    - **Permission-widening watch:** `STRUCTURED_LOG {event_type="admin_mutation", operation="updateAgentTemplate"}` where the template's `skills[].permissions.operations` array grew compared to the prior state. Alarm threshold: ~5 widening updates within a 1-hour rolling window per tenant = early-detection signal for insider or compromised-admin escalation patterns. Structured log captures pre/post state via existing audit middleware — confirm before/after state is included in the log payload during implementation; extend the audit helper if not.
- R13 migration writes an audit-log event per tenant: `STRUCTURED_LOG {event_type="permissions_seed_migration", tenant_id, template_count, ops_granted_count}`. This gives tenant admins a breadcrumb in their audit trail to notice that 29 platform-mutating ops were granted to their existing templates during migration, rather than the current plan's passive "operators find it next time they open the skill" discovery. Zero-cost addition; implementation is a single log statement inside the SQL-triggering pipeline.
- No user-visible breaking change; no announcement needed. Existing operators find the new Permissions sub-panel the next time they open `thinkwork-admin` on an agent or template edit page.

## Alternative Approaches Considered

- **Three-way merge on sync instead of intersection.** Rejected. Three-way merge (template_old, template_new, agent_current → agent_new) requires diff-tracking infrastructure (storing or recomputing template_old) and adds conceptual complexity. The narrow-only invariant means `agent_current ⊆ template_old` always, so any op the agent is currently denying was either (a) never in template_old (impossible under the invariant), or (b) in template_old and narrowed by the operator. Under intersection, ops still in template_new are preserved; ops dropped from template_new are rebased. This is semantically equivalent to three-way merge for the narrow-only case, with simpler code.
- **Richer storage shape `{overrides: {op: 'allow'|'deny'}[]}` for tri-state.** Rejected. Would require a schema migration (jsonb shape change on `agent_skills.permissions`). Only needed if future UX required "stay explicitly allowed even if template later removes this op" — but the brainstorm's narrow-only semantic explicitly says template removal rebases the agent. Render-only tri-state is the natural fit.
- **New GraphQL `skillManifest(skillId)` query or widening `CatalogSkill` GraphQL type.** Rejected per origin Key Decisions. The existing REST `getCatalogSkill(slug)` endpoint already returns the full parsed YAML. Client-side TypeScript widening is sufficient; avoids cross-app codegen churn (mobile, CLI, admin, api all run codegen on type changes).
- **TypeScript seed script in the deploy pipeline instead of hand-rolled SQL for R13.** Rejected per CLAUDE.md convention. Hand-rolled SQL with `-- updates:` markers gates the drift reporter and is the institutional pattern.
- **Subset enforcement at `requireAgentAllowsOperation` read time (every op check).** Rejected. 33 ops × hot-path check × O(template lookups) per agent call. Write-time at `setAgentSkills` is one extra read per write. Latency and call-frequency both favor write-time.
- **`set_agent_skills` flipped to `default_enabled: false` (disable by default).** Rejected for R16. Would break legitimate cross-agent provisioning (reconcilers, onboarding automations) where setting an agent's skills is part of the happy path. Self-target rejection is a surgical fix that preserves the useful capability.

## Phased Delivery

**Phase 1 — Security prereqs (ship immediately, independent of UI plan timing):**
- Unit 1 (`updateAgentTemplate` authz) + Unit 2 (`setAgentSkills` self-target) + Unit 2b (`syncTemplateToAllAgents` Cognito-only gate). One small PR bundling all three. **These are standalone P0 security fixes that exist regardless of this UI work** — the `updateAgentTemplate` gap is a live production bug (any authenticated caller can overwrite any tenant's template), and the `syncTemplateToAllAgents` fan-out path is reachable from any compromised or misconfigured agent holding the right manifest op. Land this PR first, today. If the UI plan is descoped, delayed, or split, these still ship. The remaining plan depends on them being merged first but does not depend on UI timing.

**Phase 2 — Backend foundation:**
- Unit 3 (manifest flag + validator verify) + Unit 5 (subset helper + resolver enforcement). Can ship together as Phase 2a.
- Unit 6a (sync rewrite) — Phase 2b. Correctness-critical backend change; separate PR for reviewability and rollback blast-radius.
- Unit 6b (sync diff + dialog UX) — Phase 2c. UX polish that layers on Unit 6a; separate PR makes the sync-correctness review cleaner.

**Phase 3 — Migration + data plumbing:**
- Unit 4 (SQL backfill). Small PR, reviewed with the SQL dev-apply paste in PR body.
- Unit 7 (admin SPA data plumbing + R11 + characterization test). Small PR.

**Phase 4 — Authoring UI:**
- Unit 8 (template Permissions sub-panel) + Unit 9 (agent Permissions sub-panel with tri-state). Likely one PR since Unit 9 reuses Unit 8's component; could split if the diff gets large.

Total: 6-7 PRs. Larger than the handoff's original "2-4 small PRs" framing because document review and research surfaced substantial backend work (sync rewrite, subset enforcement, two security prereqs) that the handoff did not anticipate. The Phase 1 security PR can and should ship today independent of the rest; its scope fits the "small PR" framing even without the broader plan.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-22-agent-skill-permissions-ui-requirements.md`
- **Predecessor plan:** `docs/plans/2026-04-22-004-feat-thinkwork-admin-skill-plan.md` (shipped the Python skill + resolver gate)
- **Handoff:** `docs/plans/2026-04-22-007-handoff-agent-skill-permissions-ui.md`
- **Institutional learnings:**
    - `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`
    - `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md`
    - `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
    - `docs/solutions/workflow-issues/skill-catalog-slug-collision-execution-mode-transitions-2026-04-21.md`
    - `docs/solutions/build-errors/dockerfile-explicit-copy-list-drops-new-tool-modules-2026-04-22.md`
- **Key code:**
    - `packages/api/src/graphql/resolvers/core/authz.ts`
    - `packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.ts`
    - `packages/api/src/graphql/resolvers/templates/updateAgentTemplate.mutation.ts`
    - `packages/api/src/graphql/resolvers/templates/syncTemplateToAgent.mutation.ts`
    - `packages/api/src/graphql/resolvers/templates/templateSyncDiff.query.ts`
    - `packages/api/src/lib/templates/sandbox-config.ts` (validator pattern)
    - `packages/api/src/lib/agent-snapshot.ts` (snapshot safety)
    - `packages/database-pg/graphql/types/agents.graphql`
    - `packages/database-pg/src/schema/agents.ts` (template_id notNull)
    - `packages/database-pg/drizzle/0019_webhook_skill_runs.sql` (migration template)
    - `packages/skill-catalog/thinkwork-admin/skill.yaml`
    - `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.skills.tsx`
    - `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.tsx`
    - `apps/admin/src/lib/graphql-queries.ts`
    - `apps/admin/src/lib/skills-api.ts`
