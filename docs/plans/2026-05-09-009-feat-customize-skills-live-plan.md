---
date: 2026-05-09
status: active
type: feat
topic: customize-skills-live
parent: docs/plans/2026-05-09-006-feat-computer-customization-page-plan.md
origin: docs/brainstorms/2026-05-09-computer-customization-page-requirements.md
---

# feat: Customize Skills live mutations (U5 from parent plan)

## Summary

Wire the Customize page's Skills tab to live enable/disable mutations. `enableSkill` / `disableSkill` GraphQL mutations write to `agent_skills` keyed by the Computer's `primary_agent_id` and the catalog `skill_id`, gated by `requireTenantMember` + Computer-ownership. Built-in tool slugs (per `packages/api/src/lib/builtin-tool-slugs.ts`) are rejected in the mutation path so they cannot be enabled/disabled from the desktop Customize page. Frontend wires the Sheet's Connect/Disable button through a `useSkillMutation` hook with the same urql `additionalTypenames` invalidation pattern U4 established.

---

## Problem Frame

PR #1076 wired the Skills tab to live read paths (`skillCatalog` query joining `tenant_skills` × `skill_catalog`, `connectedSkillIds` already returned by `customizeBindings`). The Sheet button still does nothing for the Skills tab — `customize.skills.tsx` doesn't pass an `onAction` handler, so the button is inert. PR #1078 shipped the analogous wiring for Connectors. This unit ports the same shape to Skills.

`agent_skills` is the canonical binding table (`agent_id` × `skill_id`) and `customizeBindings` already filters by `agent_id == primary_agent_id` for the caller's Computer, so binding detection works the moment the mutation lands a row. No schema changes; no new migrations; no resolver changes outside the new mutation files. The Skills tab is the cheapest of the U4-U6 trio because all the seams already exist.

---

## Requirements Trace

Origin requirements carried forward from `docs/brainstorms/2026-05-09-computer-customization-page-requirements.md`:

- R6 (Skills pill from per-tenant catalog) — already met by PR #1076.
- R8 (Connected reads canonical tables) — already met; `customizeBindings.connectedSkillIds` joins `agent_skills`.
- R11 (toggles write canonical bindings) → U5-1 (mutations write `agent_skills`).
- R14 (edits caller's own Computer only) → U5-1 (resolver authz).
- R16 (no real-time multi-client subscriptions) → U5-2 (`additionalTypenames` invalidation only).

Acceptance examples AE3 (enable creates agent_skills row, card flips to Disable) and AE5 (disable soft-disables, card flips to Connect) map to test scenarios on U5-1 and U5-2.

Built-in tool exclusion follows `docs/solutions/best-practices/injected-built-in-tools-are-not-workspace-skills-2026-04-28.md` — built-ins are template/runtime config, not workspace skills, and must not be toggled through this surface.

---

## System-Wide Impact

- `packages/api` — two new mutation files, GraphQL types/extensions, resolver index wiring.
- `apps/computer` — new `useSkillMutation` hook + Skills tab page rewrite to pass `onAction`.
- No `packages/database-pg` schema changes.
- No migrations.
- No `apps/admin` / `apps/mobile` / Strands runtime changes.

---

## Implementation Units

### U5-1. `enableSkill` + `disableSkill` GraphQL mutations

**Goal:** Add the two mutations the Skills Sheet button calls. Write to `agent_skills` keyed by the Computer's primary agent and the catalog `skill_id`. Reject built-in tool slugs.

**Requirements:** R11, R14.

**Dependencies:** none (relies on existing `agent_skills` schema + `tenant_skills` catalog).

**Files:**
- `packages/database-pg/graphql/types/customize.graphql` (modify — add `SkillBinding`, `EnableSkillInput`, `DisableSkillInput`, mutations on `extend type Mutation`)
- `terraform/schema.graphql` (regenerate via `pnpm schema:build`)
- `packages/api/src/graphql/resolvers/customize/enableSkill.mutation.ts` (new)
- `packages/api/src/graphql/resolvers/customize/disableSkill.mutation.ts` (new)
- `packages/api/src/graphql/resolvers/customize/index.ts` (modify — add to `customizeMutations`)
- `packages/api/src/graphql/resolvers/customize/enableSkill.mutation.test.ts` (new)
- `packages/api/src/graphql/resolvers/customize/disableSkill.mutation.test.ts` (new)

**Approach:**
- Mutation surface:
  - `enableSkill(input: EnableSkillInput!): SkillBinding!` where input is `{ computerId: ID!, skillId: String! }`.
  - `disableSkill(input: DisableSkillInput!): Boolean!` — same input, idempotent.
- `SkillBinding` GraphQL type: `id`, `tenantId`, `agentId`, `skillId`, `enabled`.
- Resolver flow (mirrors enableConnector exactly):
  1. `resolveCaller(ctx)` → tenantId, userId; null short-circuit.
  2. Load `computers` row keyed on `(id, owner_user_id, status<>'archived')` so caller-owns-Computer is enforced before any other read.
  3. `requireTenantMember(ctx, computer.tenant_id)`.
  4. **Built-in rejection:** if `isBuiltinToolSlug(skillId)` returns true, throw `CustomizeBuiltinToolNotEnableableError` with extension `code: "CUSTOMIZE_BUILTIN_TOOL_NOT_ENABLEABLE"` — built-ins are template/runtime config, not workspace skills.
  5. Resolve `agentId` via `computer.primary_agent_id ?? computer.migrated_from_agent_id` (mirrors `customizeBindings`). Reject with `CUSTOMIZE_PRIMARY_AGENT_NOT_FOUND` when both are null.
  6. Optional: lookup `tenant_skills` row by `(tenant_id, skill_id)` to confirm the slug is part of the tenant's catalog. Reject with `CUSTOMIZE_CATALOG_NOT_FOUND` when missing.
  7. Native path: upsert `agent_skills` row keyed by `uq_agent_skills_agent_skill (agent_id, skill_id)` — `INSERT ... ON CONFLICT DO UPDATE SET enabled=true`.
  8. Disable: `UPDATE agent_skills SET enabled=false WHERE agent_id=? AND skill_id=?`. Idempotent.
- All mutations idempotent. No `requires_verification` side effects.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/customize/enableConnector.mutation.ts` — same auth flow, same upsert pattern, same error code shape.
- `packages/api/src/graphql/resolvers/customize/disableConnector.mutation.ts` — same idempotent UPDATE shape.
- `packages/api/src/lib/builtin-tool-slugs.ts` — `isBuiltinToolSlug(slug)` is the canonical check.
- `agent_skills` schema in `packages/database-pg/src/schema/agents.ts` — column shape including `enabled`, `config`, `permissions`, etc.

**Test scenarios:**
- Happy path enable: new `agent_skills` row created with `agent_id=primary_agent_id`, `skill_id=<slug>`, `enabled=true`. **Covers AE3.**
- Idempotent enable: second call returns the same row, no duplicate insert.
- Happy path disable: existing row flips to `enabled=false`. **Covers AE5.**
- Idempotent disable: call when no row exists returns true (no-op).
- Authz: caller without Computer ownership rejected before any DB write. **Covers AE6.**
- Authz: caller with non-matching tenantId rejected.
- Built-in tool rejection: enabling `web-search` raises `CUSTOMIZE_BUILTIN_TOOL_NOT_ENABLEABLE`; no `agent_skills` row created.
- Catalog miss: unknown `skillId` raises `CUSTOMIZE_CATALOG_NOT_FOUND`.
- Missing primary agent: Computer with both `primary_agent_id` and `migrated_from_agent_id` null raises `CUSTOMIZE_PRIMARY_AGENT_NOT_FOUND`.

**Verification:** Resolver tests pass; calling `enableSkill` then re-querying `customizeBindings` shows the slug in `connectedSkillIds`.

---

### U5-2. Wire Sheet's Connect / Disable button to the Skills mutations

**Goal:** The user clicks Connect on a skill card → row appears in `connectedSkillIds` → table flips to Connected via urql cache invalidation → Sheet header status badge follows. Built-in tools are filtered out client-side as well so they never reach the button (defensive — server is the authoritative gate).

**Requirements:** R11, R14, R16.

**Dependencies:** U5-1.

**Files:**
- `apps/computer/src/lib/graphql-queries.ts` (modify — append `EnableSkillMutation`, `DisableSkillMutation`)
- `apps/computer/src/components/customize/use-customize-mutations.ts` (modify — add `useSkillMutation` hook alongside the existing `useConnectorMutation`; reuse `MCP_VIA_MOBILE_HINT` not applicable but add a `BUILTIN_TOOL_HINT` constant in case the user clicks a card we somehow surfaced for a built-in)
- `apps/computer/src/routes/_authed/_shell/customize.skills.tsx` (modify — pass `onAction` from the new hook)
- `apps/computer/src/components/customize/use-customize-data.ts` (modify only if we choose to filter built-in slugs from the rendered list — see Approach)

**Approach:**
- New `useSkillMutation` hook in `use-customize-mutations.ts` mirrors `useConnectorMutation` exactly: resolves `MyComputerQuery` once, holds `pendingSlugs: Set<string>` so overlapping toggles don't clobber, returns `{ toggle, pendingSlugs }`.
- urql `additionalTypenames` invalidation list: `["AgentSkill", "SkillBinding", "CustomizeBindings"]`. Extract a `SKILL_TYPENAMES` constant alongside the existing `CONNECTOR_TYPENAMES` constant.
- Frontend defense-in-depth: `useSkillItems` already returns whatever `skillCatalog` returns; the resolver excludes built-ins from `tenant_skills` results today via the join's natural filter (`tenant_skills` doesn't include built-ins). If a built-in ever does appear (catalog drift), the toast falls back to the GraphQL error code surfaced in the hook's catch.
- The Skills page passes `(slug, nextConnected) => trigger(slug, nextConnected)` as `onAction`. No special-case handling like the MCP card has — built-ins are server-rejected, not surface-rejected.
- Errors: `sonner` toast surfaces server error message. Specific code-based handling for `CUSTOMIZE_BUILTIN_TOOL_NOT_ENABLEABLE` shows a clearer "Built-in skills are managed by your tenant template, not the Customize page." message.

**Patterns to follow:**
- `apps/computer/src/components/customize/use-customize-mutations.ts` `useConnectorMutation` — verbatim shape.
- `apps/computer/src/routes/_authed/_shell/customize.connectors.tsx` — `onAction` wiring.

**Test scenarios:**
- Skill enable: clicking Connect on a non-connected skill fires `EnableSkillMutation` with `(computerId, skillId)`. **Covers AE3.**
- Skill disable: clicking Disable on a connected skill fires `DisableSkillMutation`. **Covers AE5.**
- Pending state: while a mutation is in flight for a skill, the Sheet button shows the disabled / pending state.
- Refetch: after a successful mutation, the row's Connected status reflects the new state without manual refresh.
- Built-in defense: if the resolver rejects with `CUSTOMIZE_BUILTIN_TOOL_NOT_ENABLEABLE`, the user sees the typed toast (error path test in the hook).

**Verification:** Vitest passes; manual dev-stage smoke shows the row flipping between Connected and Available with seeded skills.

---

## Sequencing

```mermaid
flowchart LR
    U5_1[U5-1: mutations]
    U5_2[U5-2: Sheet wiring]

    U5_1 --> U5_2
```

Both units land in a single PR.

---

## Key Technical Decisions

- **Reject built-ins in the resolver, not the catalog.** The `tenant_skills` table doesn't include built-in tool slugs today, so a built-in slug reaching the mutation path is already an off-path event. Server-side `isBuiltinToolSlug` is the authoritative gate; frontend filtering is defense-in-depth, not the contract.
- **Reuse the U4 resolver shape verbatim.** Auth-then-Computer-load-then-action mirrors U4 exactly. Small duplication is accepted per the parent plan; helper extraction can land when U6 adds the third call site.
- **No `requireTenantMember + 'admin'` escalation.** Self-serve customization is the same surface as Connectors; the Computer-ownership predicate is the per-Computer scope.
- **Idempotent `ON CONFLICT DO UPDATE`.** Re-clicking Connect on an already-connected skill is a no-op. Same for Disable. The `uq_agent_skills_agent_skill (agent_id, skill_id)` index already exists; no schema change needed.
- **Errors as typed GraphQL errors with stable codes.** `CUSTOMIZE_CATALOG_NOT_FOUND`, `CUSTOMIZE_BUILTIN_TOOL_NOT_ENABLEABLE`, `CUSTOMIZE_PRIMARY_AGENT_NOT_FOUND`, plus the standard `COMPUTER_NOT_FOUND` / `UNAUTHENTICATED`.

---

## Risk Analysis & Mitigation

- **Risk: missing primary_agent_id on Eric's-style legacy Computers.** Mitigation: 0077 already backfilled `primary_agent_id` from `migrated_from_agent_id`; the resolver also has the runtime fallback. Reject with a typed error if both are null so the failure is visible.
- **Risk: a future catalog row exposes a built-in slug.** Mitigation: server-side rejection by `isBuiltinToolSlug` always wins, regardless of catalog content.
- **Risk: derive-agent-skills races with the mutation.** `derive-agent-skills.ts` runs on workspace AGENTS.md writes and uses `onConflictDoNothing` to preserve per-row metadata. Our mutation explicitly sets `enabled` so the two paths don't fight: workspace deletion of the SKILL.md folder still drops the row, but our `enabled=true` wouldn't survive that anyway. Document this overlap in the resolver comment.
- **Risk: optimistic UX expectations.** Mitigation: relying on urql cache invalidation + refetch keeps the source of truth on the server; no optimistic local state to drift.

---

## Worktree Bootstrap

Sessions touching `packages/database-pg` and `packages/api` together (this plan touches packages/api but not packages/database-pg schema):

```
pnpm install
find . -name tsconfig.tsbuildinfo -not -path '*/node_modules/*' -delete
pnpm --filter @thinkwork/database-pg build
```

Per `docs/solutions/build-errors/worktree-stale-tsbuildinfo-drizzle-implicit-any-2026-04-24.md`.

---

## Scope Boundaries

- Workflow enable / disable wiring (parent plan U6).
- Workspace renderer extension projecting active skill set into `AGENTS.md` (parent plan U7).
- MCP server enable / disable from desktop Customize (deferred indefinitely; mobile per-user OAuth path remains the owner).
- Real-time multi-client subscription updates on Customize (parent plan R16).
- Custom skill authoring sub-flows (parent plan R15).
- Editing per-skill `config`, `permissions`, `rate_limit_rpm`, or `model_override` from this surface — those stay on existing admin / `setAgentSkills` paths.

### Deferred to Follow-Up Work

- Helper extraction for the duplicated auth+Computer-load preamble across `enableConnector` / `disableConnector` / `enableSkill` / `disableSkill` once U6 brings the count to six call sites (residual #7 from PR #1078 review).
- Documenting the new typed error codes (`CUSTOMIZE_*`) as the official Customize-surface vocabulary, or unifying with Apollo standard codes (residual #3 from PR #1078 review).

---

## Outstanding Questions

### Resolve Before Implementation

- None — the parent plan + brainstorm + U4 ship resolved the substantive blockers.

### Deferred to Implementation

- [Affects U5-1][Technical] Whether to round-trip the `enabled` column through `SkillBinding` or omit it (always `true` on enable, always `false` on disable). Either is fine; pick whichever matches the U4 `ConnectorBinding` shape choice at implementation time.
- [Affects U5-1][Technical] Whether to copy any `tenant_skills.config` / `default_config` into the new `agent_skills.config` row, or leave it null on enable. v1 leaves it null; per-skill config editing belongs to a different surface.
- [Affects U5-2][Product] Whether the built-in tool error message should be plain text or a richer affordance pointing the user at the workspace template. Toast is sufficient for v1.
