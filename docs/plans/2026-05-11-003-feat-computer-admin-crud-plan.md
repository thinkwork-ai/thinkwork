---
date: 2026-05-11
status: active
type: feat
origin: docs/brainstorms/2026-05-11-computer-admin-crud-requirements.md
---

# feat: Computer Admin CRUD

> **Current LFG scope:** U1 + U2 only (backend foundation — seed migration, `computerTemplates` query, `provisionComputerForMember` helper, and call-site wiring across `addTenantMember`, `inviteMember`, `bootstrapUser`, and the two admin-reachable REST handlers). U3–U7 (admin UI) land in subsequent runs.

## Summary

Deliver admin CRUD for Computers in `apps/admin`: a shared create-dialog used at both `/computers` and `/people/$humanId`, a server-side `provisionComputerForMember` helper wired into every code path that produces an active tenant-member row, Config-tab inline edits for rename/template/budget, and an archive action with a "Show archived" filter on the list. Backend mutations already exist — no GraphQL schema edits required. A hand-rolled SQL migration seeds the platform-default Computer template so day-one auto-provision works with zero admin configuration.

---

## Problem Frame

The Computers backend is fully built — table, GraphQL mutations, tenant-admin authz, partial-unique-index enforcement of one active Computer per (tenant, owner) — but admin has no UI to create one. The empty state on `/computers` literally directs admins to "provision users," yet that path does not exist. A tenant admin who navigates to a person's profile and wants to create a Computer for them has no affordance; users who pre-date the Computer feature, or whose Computer was archived, are stranded. The single concrete trigger is a tenant admin trying to provision a Computer for Joey Terrazas and finding no button anywhere in admin.

The edit surface is similarly thin. The only inline edit today is start/stop runtime; rename, template change, budget, and archive all require direct database access. As the platform scales toward enterprise onboarding, these admin-driven operations become routine and can no longer live outside the UI.

(see origin: `docs/brainstorms/2026-05-11-computer-admin-crud-requirements.md`)

---

## Requirements Traceability

Origin requirements carried forward (full text in origin):

- R1 — manual "New Computer" on `/computers` → U3, U4
- R2 — "Provision Computer" CTA on `/people/$humanId`, gated on no-active-Computer → U3, U5
- R3 — auto-provision on tenant-member-add with platform-default template → U1, U2
- R4 — auto-provision failure must not block membership → U2
- R5 — inline rename on Config tab → U6
- R6 — change base template with consequence warning → U6
- R7 — tenant-admin gate on all CUD → enforced by existing resolvers (verify in U2, U6, U7)
- R8 — one-active-per-user invariant honored end-to-end; users-with-active hidden from owner picker → U3
- R9 — mutation failures surface in-dialog without losing input → U3, U6
- R10 — platform default preselected; owner preselected only via Person-page entry → U3, U5
- R11 — auto-provision success/failure observable for backfill → U2
- R12 — Archive action with destructive confirmation → U7
- R13 — set/change/clear monthly budget → U6
- R14 — auto-provision is idempotent against the active-slot invariant → U2
- R15 — archived Computers excluded from default list with opt-in filter → U7
- R16 — archive frees the active-per-user slot → enforced by existing partial unique index (verify in U7)

Acceptance Examples AE1–AE7 trace to U3, U5, U2, U6, U7 as covered in per-unit Test Scenarios.

---

## Key Technical Decisions

- **Platform default identified by slug convention, not a new column.** Seed a single row at `tenant_id IS NULL, slug = 'thinkwork-computer-default', template_kind = 'computer', source = 'system'`. The existing `requireComputerTemplate` helper already accepts `tenant_id IS NULL` rows — no resolver changes needed. Rationale: lightest mechanism, no schema column, matches existing `agent_templates` shape and the hand-rolled-seed precedent at `packages/database-pg/drizzle/0022_seed_thinkwork_admin_permissions.sql`. Alternative considered: `is_default_computer boolean` column with partial unique index per tenant — rejected as heavier and harder to override later.

- **Shared `provisionComputerForMember` helper wired into every active-membership insertion path.** Research found five active-membership insertion paths: three GraphQL paths (`addTenantMember`, `inviteMember`'s core, `bootstrapUser` claim path, and `bootstrapUser` default path) plus two REST handlers (`POST /api/tenants/:id/members` and `POST /api/tenants/:slug/invites` in `packages/api/src/handlers/tenants.ts`). All are admin-reachable; all call the helper in U2. Rationale: the brainstorm's R3 says "when a user is added to a tenant" — every active-membership creation must trigger provisioning, not just the GraphQL surface admin uses.

- **Auto-provision failure follows the `createTenant` sandbox-provision precedent: synchronous, try/catch, swallow, log + activity_log row.** Never re-throws; membership succeeds even when provisioning fails. Rationale: the brainstorm's R4 explicitly says failure must not block membership; this matches an in-repo precedent that's already aligned with the user-driven RequestResponse guidance. (see origin: brainstorm Outstanding Questions on failure surface)

- **Template change consequence is UI-warning-only in v1.** Research confirmed `derive-agent-skills.ts` is not called from Computer mutations today; the warning text is forward-looking. A separate brainstorm tracks the actual workspace re-seed pipeline. Rationale: the alternative would be a much larger plan that conflates two product moves, against the brainstorm's "v1 unblocks creation" framing and against the "decisive over hybrid" preference.

- **Archive flows through the existing `updateComputer` mutation with `status: ARCHIVED`.** No new resolver. Rationale: schema already supports it; adding a dedicated `archiveComputer` mutation would be cosmetic.

- **List "Show archived" filter is client-side.** Fetch all rows, filter on the client. Resolves the origin Outstanding Question on archived-list mechanism (origin doc, "Deferred to Planning"). Rationale: matches the existing threads-page precedent and avoids requiring a new backend arg; the backend `computers(tenantId, status?)` query currently filters only when a single status is given, so server-side filtering would require either a new arg or duplicate queries.

- **Idempotency rests on the existing DB partial unique index + `assertNoActiveComputer`.** The helper treats CONFLICT as success. Rationale: the brainstorm's R14 covers re-invite / status-flip edge cases without new code.

- **One shared `ComputerFormDialog` component, two entry points, controlled by an `ownerLocked` prop.** Rationale: the brainstorm's R10 differs between entry points only in owner-preselection; cloning the dialog would duplicate the form, validation, mutation wiring, and codegen-typed inputs.

---

## System-Wide Impact

- **GraphQL schema:** no changes. All inputs (`CreateComputerInput`, `UpdateComputerInput`, `computers(tenantId, status?)`) already exist in `packages/database-pg/graphql/types/computers.graphql`.
- **Database:** one new hand-rolled migration seeding a single platform `agent_templates` row. No new columns, indexes, or constraints. Existing `uq_computers_active_owner` partial unique index continues to enforce the invariant.
- **Resolver surface:** new helper file under `packages/api/src/lib/computers/`. Modifications to three existing resolvers (`addTenantMember`, `inviteMember`, `bootstrapUser`) to call the helper. No new mutations.
- **Admin UI:** new dialog component + new edit panel + modifications to three routes (`/computers`, `/computers/$computerId`, `/people/$humanId`).
- **Codegen:** admin-only (`pnpm --filter @thinkwork/admin codegen`). No changes to CLI, mobile, or API codegen because no `.graphql` files change.
- **Affected actors:** tenant admins gain visible CUD. End users see no admin UI changes; they receive a Computer at tenant-join time without action.

---

## Implementation Units

### U1. Seed the platform-default Computer template + add `computerTemplates` query

**Goal:** ship the platform-wide `agent_templates` row that auto-provisioning resolves to, AND expose a GraphQL query that returns the union of tenant-scoped + NULL-tenant Computer templates so the admin template-picker can see the platform default. The existing `agentTemplates(tenantId)` query filters with `eq(tenant_id, args.tenantId)` and never returns NULL-tenant rows — a strict additive `computerTemplates(tenantId)` query is the lightest way to expose them without changing the existing query's blast radius.

**Requirements:** R3, R10.

**Dependencies:** none. Lands first because U2 depends on this row existing in dev, and U3 (a later run) depends on the new query existing.

**Files:**
- `packages/database-pg/drizzle/00NN_seed_thinkwork_computer_default_template.sql` (new — assign the next sequence number after running `ls packages/database-pg/drizzle/` at execution time)
- `packages/database-pg/graphql/types/agent-templates.graphql` (modify — add the `computerTemplates(tenantId: ID!): [AgentTemplate!]!` field to the `Query` extension)
- `packages/api/src/graphql/resolvers/templates/computerTemplates.query.ts` (new — resolver)
- `packages/api/src/graphql/resolvers/templates/computerTemplates.query.test.ts` (new — unit tests)
- `packages/api/src/graphql/resolvers/templates/index.ts` (modify — wire the new resolver into the Query map)
- `apps/admin/src/lib/graphql-queries.ts` (modify — add `ComputerTemplatesListQuery` tagged template for U3's later use; ship now so U2's verification can use it)
- Regenerated: `apps/admin/src/gql/*`, `apps/cli/src/gql/*`, `apps/mobile/lib/gql/*`, `packages/api/src/gql/*` after running codegen in every consumer (per repo CLAUDE.md rule when GraphQL types change)

**Approach:**
- Seed row: single `INSERT INTO agent_templates ... ON CONFLICT DO NOTHING` for `(tenant_id = NULL, slug = 'thinkwork-computer-default', template_kind = 'computer', source = 'system', name = 'Thinkwork Computer', model = '<current default Sonnet inference profile>')`.
- The migration file is hand-rolled SQL — declare a `-- creates:` header marker in a form the drift reporter recognizes (verify against `pnpm db:migrate-manual`'s detection logic at execution time; if it doesn't support row-level markers, use a marker the reporter does support and document the verification path in the PR description).
- Apply to dev via `psql "$DATABASE_URL" -f <file>` before opening the PR per `feedback_handrolled_migrations_apply_to_dev`.
- New GraphQL query `computerTemplates(tenantId: ID!): [AgentTemplate!]!` — resolver does `db.select().from(agentTemplates).where(and(eq(template_kind, 'computer'), or(eq(tenant_id, args.tenantId), isNull(tenant_id))))`. Authz: `requireTenantMember` (any member can list templates for picker UX — match the existing `agentTemplates` query's authz posture).

**Execution note:** apply seed to dev first, then add the file + run codegen across all four consumers in the PR. Confirm via psql that the row exists and via a one-off GraphQL ping that the query returns it.

**Patterns to follow:**
- Hand-rolled migration header markers: `packages/database-pg/drizzle/0022_seed_thinkwork_admin_permissions.sql`
- Drift reporter convention documented in repo root `CLAUDE.md` (Database / GraphQL schema section)
- Existing `agentTemplates` resolver shape: `packages/api/src/graphql/resolvers/templates/agentTemplates.query.ts`

**Test scenarios:**
- Resolver happy path: given the seed row exists and one tenant-authored `template_kind='computer'` row exists for tenant T, calling `computerTemplates(tenantId: T)` returns both rows.
- Filter by kind: given a tenant-authored `template_kind='agent'` row for tenant T, `computerTemplates(tenantId: T)` does NOT return it.
- Other-tenant exclusion: given a `template_kind='computer'` row for tenant U (other tenant), `computerTemplates(tenantId: T)` does NOT return it.
- NULL-tenant inclusion regardless of caller tenant: given the seed row (`tenant_id IS NULL`), calling `computerTemplates(tenantId: T)` for any T returns it.
- Authz: caller without tenant membership is rejected; caller as any member (not necessarily admin) is allowed (matches existing `agentTemplates` posture).

**Verification:**
- Seed row exists in dev after `psql -f` apply; `pnpm db:migrate-manual` reports the marker as present.
- `pnpm --filter @thinkwork/api typecheck` and `pnpm --filter @thinkwork/api test` green.
- Codegen completes cleanly in all four consumers and the new query type is exported.

---

### U2. `provisionComputerForMember` helper + wire into membership paths

**Goal:** every active `tenant_members` insertion triggers a best-effort Computer auto-provision using the platform default; failure never blocks the primary mutation; observed via `activity_log`.

**Requirements:** R3, R4, R7, R11, R14.

**Dependencies:** U1 (the helper resolves the platform default by slug; in dev that row must exist for the helper to succeed end-to-end).

**Files:**
- `packages/api/src/lib/computers/provision.ts` (new — `provisionComputerForMember` helper)
- `packages/api/src/lib/computers/provision.test.ts` (new)
- `packages/api/src/graphql/resolvers/computers/createComputer.mutation.ts` (modify — extract `createComputerCore` and have the existing resolver delegate to it after authz)
- `packages/api/src/graphql/resolvers/computers/shared.ts` (modify if needed — host `createComputerCore` here alongside the other Computer-domain helpers)
- `packages/api/src/graphql/resolvers/core/addTenantMember.mutation.ts` (modify — call helper after insert)
- `packages/api/src/graphql/resolvers/core/inviteMember.mutation.ts` (modify — call helper inside `inviteMemberCore` after the member insert)
- `packages/api/src/graphql/resolvers/core/bootstrapUser.mutation.ts` (modify — call helper after each of the two `insert(tenantMembers)` sites)
- `packages/api/src/handlers/tenants.ts` (modify — call helper after each of the two `insert(tenantMembers)` sites at lines ~284 and ~369; both are confirmed admin-reachable via `gate(['owner','admin'])`)
- `packages/api/src/handlers/tenants.test.ts` (modify or add — integration coverage for the REST paths)

**Approach:**
- Helper signature is "given a tenant ID + user (the `principal_id` from the `tenant_members` row, which is the FK to `users.id` for USER principals) + optional template override, attempt to create a Computer; return a discriminated result (`created` | `skipped:already_active` | `skipped:not_user_principal` | `failed:<reason>`); never throw out of the helper".
- **Skip non-USER principals.** First action in the helper: if `principal_type.toLowerCase() !== 'user'`, return `skipped:not_user_principal` (no log, no insert). The codebase mixes both `'USER'` (inviteMember) and `'user'` (bootstrapUser) casings — the comparison must be case-insensitive.
- **Resolve the default template** by slug + `tenant_id IS NULL` + `template_kind = 'computer'`. The slug-based lookup must pin `template_kind` in SQL — do NOT rely on a downstream `requireComputerTemplate` call alone, since the helper's `createComputerCore` path may not go through that helper. If the lookup yields no row, return `failed:no_default_template` AND write the activity_log row (treat config drift the same as runtime failure for backfill visibility), plus `console.error` for operational logging.
- **Bypass `requireTenantAdmin` via core extraction.** Refactor `createComputer.mutation.ts`: extract `createComputerCore(args: { tenantId, ownerUserId, templateId, name, slug?, runtimeConfig?, budgetMonthlyCents?, migratedFromAgentId?, migrationMetadata?, createdBy?: string | null })` into `shared.ts` (or a new `core.ts` next to it). The core function performs the validation calls (`requireTenantUser`, `requireComputerTemplate`, `assertNoActiveComputer`) and the DB insert, but does NOT call `requireTenantAdmin`. The existing `createComputer` resolver continues to call `requireTenantAdmin(ctx, input.tenantId)` first, then delegates to `createComputerCore` with `createdBy = await resolveCallerUserId(ctx)`. The new helper `provisionComputerForMember` calls `createComputerCore` directly with `createdBy = null` (or a designated system identifier) for bootstrapUser-path provisioning, bypassing the admin gate — this is required because at first sign-in the new user isn't yet admin-resolvable for Google-OAuth callers (`ctx.auth.tenantId` is null until the pre-token trigger lands).
- **Idempotency catches both error shapes.** `assertNoActiveComputer` throws a `GraphQLError` with `extensions.code === 'CONFLICT'`. The DB-level partial unique index `uq_computers_active_owner` separately surfaces concurrent races as Postgres SQLSTATE `23505`. The helper wraps `createComputerCore` in a try/catch that maps BOTH error shapes to `skipped:already_active` (read either `err.extensions?.code === 'CONFLICT'` OR drizzle/pg's wrapped `cause?.code === '23505'`). Add a unit test covering the race-loss path explicitly.
- **Failure surface.** On `failed:*` (including `failed:no_default_template`), write an `activity_log` row scoped to the tenant with payload `{ kind: 'computer_auto_provision_failed', tenantId, userId, reason, callSite }` so admins can find these from the existing activity surface. Do not write the row on `skipped:*`. For the `bootstrapUser`-path call, the activity_log row's `actor_id` should reflect a system identifier rather than the new user's principal_id, so the audit trail reads as a system event.
- **At each call site:** wrap the helper call in try/catch, `console.error` on unexpected throw, swallow. The primary mutation/REST insert must succeed even when the helper has any failure mode.
- **REST handler wiring is in scope, not deferred.** Research confirmed both `packages/api/src/handlers/tenants.ts` insertion sites (POST `/api/tenants/:slug/invites` at ~line 284 and POST `/api/tenants/:id/members` at ~line 369) are gated by `gate(['owner','admin'])` and are admin-reachable. Both call the helper after their respective `tenant_members` inserts. The REST `inviteMember` path lacks the GraphQL-side `runWithIdempotency` wrapper — the helper's `assertNoActiveComputer` + 23505 catch IS the idempotency mechanism for REST retries.

**Technical design (directional, not implementation specification):**

```
provisionComputerForMember(ctx, { tenantId, userId, templateSlug? }) ->
  | { status: 'created', computer }
  | { status: 'skipped_already_active' }
  | { status: 'failed', reason }
```

Caller pattern (illustrative — not code to copy):

```
const member = await db.insert(tenantMembers)...
try {
  const result = await provisionComputerForMember(ctx, { tenantId, userId: member.principal_id })
  if (result.status === 'failed') {
    console.warn(...)
    await writeActivityLog(...)
  }
} catch (err) {
  console.error('[<resolver>] unexpected provisioning throw', err)
}
return member
```

**Execution note:** characterization-first — before changing each resolver, write a test that pins the existing primary-insert behavior, then add a second test that pins "provisioning failure does not break the primary insert". This protects against the failure path silently degrading the primary mutation.

**Patterns to follow:**
- Primary-insert-plus-best-effort-side-effect: `packages/api/src/graphql/resolvers/core/createTenant.mutation.ts` (sandbox provision is the in-repo precedent that explicitly references the user-driven RequestResponse memory)
- Existing Computer write path: `packages/api/src/graphql/resolvers/computers/createComputer.mutation.ts` and `packages/api/src/graphql/resolvers/computers/shared.ts` (the `assertNoActiveComputer` / `requireComputerTemplate` helpers)
- Vitest convention: `packages/api/src/**/*.test.ts`; see `packages/api/src/graphql/resolvers/computers/createComputer.mutation.test.ts` for shape

**Unit test scenarios (`packages/api/src/lib/computers/provision.test.ts`):**
- Happy path: given an active tenant member with no Computer and the default template seeded, the helper returns `created` and a Computer row exists for that user. **Covers AE3.**
- Pre-flight idempotency: given a tenant member who already has an active Computer, the helper returns `skipped:already_active` (caught from `assertNoActiveComputer`'s GraphQLError). No duplicate Computer row inserted, no activity_log row written. **Covers R14.**
- Race-loss idempotency: given a concurrent provision that wins the partial-unique-index slot first, the second call hits Postgres SQLSTATE 23505 inside `createComputerCore`; the helper maps that error shape to `skipped:already_active` (not `failed`). No activity_log row written. **Covers R14.**
- Non-USER principal skip: given `principal_type='team'` (or any non-USER casing), helper returns `skipped:not_user_principal` immediately. No DB read, no template lookup, no activity_log row.
- Missing default template: given the seed row is absent (template lookup returns null), the helper returns `failed:no_default_template`, no Computer row exists, no throw escapes the helper, AND an activity_log row is written so admins can detect the config drift.
- Wrong template_kind for matching slug: given a row with `slug='thinkwork-computer-default'` but `template_kind='agent'` (drift scenario), helper's SQL lookup pins `template_kind='computer'` and treats the row as absent — returns `failed:no_default_template`.
- Activity-log surface on `failed:*`: writes a row with tenant, user, reason, callSite. The bootstrapUser-path test passes a `callSite: 'bootstrapUser'` flag and asserts the row's `actor_id` is a system identifier, not the new user's principal_id.
- No activity-log on skipped: on `created`, `skipped:already_active`, and `skipped:not_user_principal` no activity_log row is written.
- Throw containment: if the underlying `db.insert` rejects with an unexpected non-23505 error, the helper returns `failed:<err.message>` rather than propagating.

**Integration test scenarios (extend each modified resolver's existing `.test.ts` file):**
- `addTenantMember`: happy path inserts the member and creates a Computer; given a provisioning failure (mock helper to return `failed`), the member row still exists in DB and the response is success. **Covers AE4.**
- `inviteMember` (inside `inviteMemberCore`): same shape — member exists, Computer created on success; on simulated failure the membership succeeds and is queryable.
- `bootstrapUser`: both the claim path (existing pendingTenant) and the default-path (fresh tenant on first sign-in) call the helper; failure on either path does not break first-sign-in tenant creation. Explicitly cover the Google-OAuth path where `ctx.auth.tenantId` is null — helper succeeds because it bypasses `requireTenantAdmin` via `createComputerCore`.
- REST `POST /api/tenants/:id/members` (tenants.ts ~line 369): happy path inserts member and Computer; provisioning failure leaves member intact and returns success.
- REST `POST /api/tenants/:slug/invites` (tenants.ts ~line 284): same shape; helper is called on the active-member insertion branch.
- `createComputer` resolver regression: existing tests must continue to pass — the resolver's behavior (admin gate + delegate to core) is unchanged from the caller's perspective.

**Verification:**
- All new and modified resolver tests green.
- Manual check in dev: add a tenant member via the admin UI, observe a Computer row appears for them; force a failure by temporarily renaming the default template's slug, repeat, observe membership succeeds and an `activity_log` row is written.

---

### U3. `ComputerFormDialog` component + `CreateComputerMutation`

**Goal:** ship the shared create-Computer dialog that both entry points (U4, U5) mount.

**Requirements:** R1, R2, R8, R9, R10.

**Dependencies:** none for the admin compilation; logically depends on U2 only for end-to-end "person provisioned via admin appears in admin's `myComputer` lookup" (not blocking this unit's tests).

**Files:**
- `apps/admin/src/lib/graphql-queries.ts` (modify — add `CreateComputerMutation` tagged template)
- `apps/admin/src/components/computers/ComputerFormDialog.tsx` (new — shared dialog)
- `apps/admin/src/components/computers/ComputerFormDialog.test.tsx` (new)
- Generated `apps/admin/src/gql/*` after `pnpm --filter @thinkwork/admin codegen`

**Approach:**
- Dialog is mode-aware via props but ships in `mode: "create"` only (edit happens inline on the Config tab in U6, not through this dialog). Props include `open`, `onOpenChange`, `initial?: { ownerUserId?: string }`, `ownerLocked?: boolean`, `onCreated?: (computerId: string) => void`.
- Fields: owner picker (Select), name (Input, required), template picker (Select, filtered to `templateKind === "COMPUTER"`, platform default preselected by slug), optional monthly budget (Input, dollar→cents conversion at submit).
- Owner picker sources from `TenantMembersListQuery` + `ComputersListQuery`, filters client-side to USER members without an active Computer — this implements R8 in the UI before the backend ever needs to reject a duplicate. When `ownerLocked`, the picker is hidden/disabled and the preselected value is the only one shown.
- Template picker preselects the platform default by matching `slug === 'thinkwork-computer-default'`; falls back to the first `templateKind === 'COMPUTER'` row if the seed is missing in a non-dev environment (this also surfaces the seed-drift case to admins by showing a non-default fallback in the dropdown).
- Error surfacing follows the `AgentFormDialog` precedent: per-field validation via zod + react-hook-form; mutation errors surface either as `form.setError` on a relevant field or a destructive-styled banner above the submit button. Input state is preserved on error.
- On success, close the dialog and call `onCreated(id)`. Entry points (U4, U5) decide what to do with the new id (typically navigate to detail).

**Patterns to follow:**
- Canonical create-dialog: `apps/admin/src/components/agents/AgentFormDialog.tsx` (shadcn Dialog + react-hook-form + zodResolver + urql `useMutation`)
- Mutation tag location convention: all tagged templates in `apps/admin/src/lib/graphql-queries.ts`; mutations named `<Verb><Entity>Mutation`
- Inline-edit / inline-mutation precedent (for error UX shape): `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerStatusPanel.tsx`

**Test scenarios (`ComputerFormDialog.test.tsx`):**
- Happy path: given a tenant with two members (one with an active Computer, one without) and the platform-default template seeded, opening the dialog shows only the member-without-Computer in the owner picker; the template is preselected to the platform default; submitting valid input fires `CreateComputerMutation` and calls `onCreated` with the returned id. **Covers AE1, AE6.**
- `ownerLocked` mode: given `initial.ownerUserId` and `ownerLocked=true`, the picker is non-interactive and the locked user is the submitted owner. **Covers R10.**
- Validation: empty name shows a per-field error, submit is blocked.
- Mutation error: when the mutation returns an error (e.g., simulated server-side `CONFLICT` from `assertNoActiveComputer`), an inline banner shows the message and form state is preserved. **Covers R9.**
- Budget conversion: a value of `"50"` in the budget input becomes `5000` cents in the mutation input; clearing the field omits `budgetMonthlyCents`.
- Empty owner-pool edge: when every USER member already has an active Computer, the picker shows an empty state explaining there are no eligible users; submit is disabled.

**Verification:**
- `pnpm --filter @thinkwork/admin codegen` regenerates `gql.ts` / `graphql.ts` with the new mutation typed.
- `pnpm --filter @thinkwork/admin test` green.
- `pnpm --filter @thinkwork/admin typecheck` green.

---

### U4. "New Computer" entry on `/computers`

**Goal:** add the top-right action on the list page; clicking opens the U3 dialog in unlocked mode.

**Requirements:** R1.

**Dependencies:** U3.

**Files:**
- `apps/admin/src/routes/_authed/_tenant/computers/index.tsx` (modify)

**Approach:**
- Add a "New Computer" button to the existing `PageHeader actions` slot, alongside the existing Refresh button.
- Manage `open` state locally in the route component; mount `<ComputerFormDialog mode="create" ... />` once, controlled by that state.
- On `onCreated(id)`, close the dialog and `navigate({ to: '/computers/$computerId', params: { computerId: id }, search: { tab: 'dashboard' } })`.
- Also update the empty-state to point at the new button instead of "View People".

**Patterns to follow:**
- Header actions pattern: existing Refresh button at the same site
- Dialog open-state pattern: any of the agent-page consumers of `AgentFormDialog`

**Test scenarios:**
- Render: clicking the "New Computer" button opens the dialog; closing the dialog without submitting leaves the list unchanged.
- Empty-state CTA: when the list is empty, the empty-state action label is "New Computer" and clicking it opens the dialog rather than navigating to `/people`.

**Verification:**
- Manual: with the platform default seeded, click "New Computer", pick an eligible user, submit, land on that user's new Computer detail page.

---

### U5. "Provision Computer" CTA on `/people/$humanId`

**Goal:** show a per-person CTA that opens the U3 dialog in `ownerLocked` mode, but only when the person has no active Computer.

**Requirements:** R2, R8.

**Dependencies:** U3.

**Files:**
- `apps/admin/src/routes/_authed/_tenant/people/$humanId.tsx` (modify)
- `apps/admin/src/components/humans/HumanMembershipSection.tsx` (modify — natural home for the CTA next to membership controls; alternatively a sibling card on the route itself if research finds a cleaner home during execution)

**Approach:**
- Add a `ComputersListQuery` fetch alongside the existing `TenantMembersListQuery`; derive `hasActiveComputer = computers.some(c => c.ownerUserId === member.user.id && c.status !== 'ARCHIVED')`.
- When `!hasActiveComputer`, render a "Provision Computer" button (size + variant consistent with other buttons in `HumanMembershipSection`). The button opens `<ComputerFormDialog mode="create" initial={{ ownerUserId: member.user.id }} ownerLocked onCreated={navigateToDetail} />`.
- When `hasActiveComputer`, hide the button entirely (do not show a disabled / "already has Computer" state — keep the surface clean).
- On `onCreated(id)`, navigate to the new Computer's detail page.

**Patterns to follow:**
- Existing fetches at the top of `apps/admin/src/routes/_authed/_tenant/people/$humanId.tsx`
- Membership-section button conventions in `HumanMembershipSection.tsx`

**Test scenarios:**
- Visibility: given a USER member with no active Computer, the CTA is shown; given the same user with an active Computer, the CTA is absent. **Covers AE1, AE2.**
- Locked owner: opening the CTA's dialog shows the person preselected and the owner picker non-interactive (this is implicitly covered by U3's ownerLocked test, but verify the wiring at this site).
- Navigation: on successful create, route changes to `/computers/<new-id>?tab=dashboard`.

**Verification:**
- Manual: open `/people/<joey-id>`, see the CTA, click, complete the dialog, land on Joey's new Computer.

---

### U6. Config-tab edit affordances + template-change consequence dialog

**Goal:** rename, change template (with consequence warning), and set/change/clear budget — all inline on the existing Config tab.

**Requirements:** R5, R6, R13, R7, R9.

**Dependencies:** none (uses the existing `UpdateComputerMutation`; the only new dialog is the consequence warning for template change).

**Files:**
- `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerIdentityEditPanel.tsx` (new — replaces or extends the read-only `IdentityCard` defined inline in `$computerId.tsx`)
- `apps/admin/src/routes/_authed/_tenant/computers/$computerId.tsx` (modify — wire the new panel in the Config tab, remove inline `IdentityCard` if fully replaced)

**Approach:**
- Three independent inline micro-forms in a single panel, each calling `UpdateComputerMutation` with a single-field input. Each form has its own local state + save-pending flag, mirroring the existing `ComputerStatusPanel` pattern.
  - **Rename:** Input + Save / Cancel buttons. Slug stays server-managed.
  - **Change template:** Select (templates filtered to `templateKind === "COMPUTER"`, sourced from the new `ComputerTemplatesListQuery` so the platform default is visible) + Save. On Save click, if the selection differs from the current `template.id`, open a small confirm Dialog. The dialog body matches v1's actual behavior: "Changing the template updates this Computer's template association. Re-deriving the workspace's skills and MCP from the new template is not yet implemented — you'll need to re-seed manually for now." (A follow-up plan tracks the actual re-seed pipeline; at that point the warning copy is replaced with accurate consequence text.) On confirm, fire the mutation; on cancel, revert the Select.
  - **Budget:** Input (dollar value) + Save + Clear. Clear sends `budgetMonthlyCents: null`; Save converts dollars → cents.
- Surface mutation errors via a destructive-styled banner adjacent to the affected field, matching the existing inline-edit pattern.
- The template-change consequence dialog is a separate small shadcn `Dialog` (not `AlertDialog`) — it's a "are you sure?" confirm step embedded inside a larger edit form, not an atomic destructive action.

**Patterns to follow:**
- Inline-edit + mutation: `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerStatusPanel.tsx`
- shadcn `Dialog` (for the consequence confirm): `apps/admin/src/components/ui/dialog.tsx`

**Test scenarios (`ComputerIdentityEditPanel.test.tsx`):**
- Rename happy path: editing the name and clicking Save fires `UpdateComputerMutation` with `{ name }` and shows success state.
- Rename error: when the mutation errors, an inline banner shows the message and the in-progress name is preserved.
- Template change shows consequence dialog: selecting a different template and clicking Save opens the consequence Dialog; canceling reverts the Select; confirming fires the mutation. **Covers AE5.**
- Same-template Save is a no-op: clicking Save with no template change does not open the dialog or fire the mutation.
- Budget set / change / clear: setting `100` fires `{ budgetMonthlyCents: 10000 }`; clearing fires `{ budgetMonthlyCents: null }`.
- Tenant-admin gate: when the caller is not a tenant admin, the panel renders read-only (or is omitted entirely — choose at execution time based on existing admin convention).

**Verification:**
- Manual: open a Computer detail page, rename it, change its template (observe the consequence dialog and confirm), set a budget, clear the budget. All four operations persist across a refresh.

---

### U7. Archive action + "Show archived" list filter

**Goal:** archive button on the detail page with destructive confirm; list page hides archived by default with an opt-in toggle.

**Requirements:** R12, R15, R16, R7.

**Dependencies:** none.

**Files:**
- `apps/admin/src/routes/_authed/_tenant/computers/$computerId.tsx` (modify — add Archive button + AlertDialog in the header)
- `apps/admin/src/routes/_authed/_tenant/computers/index.tsx` (modify — add `FilterBarPopover` with "Show archived" switch + client-side filtering)

**Approach:**
- Detail page: add a destructive `Button` near the existing header badges. Wrap in shadcn `AlertDialog` with the title "Archive this Computer?" and a body explaining: archives this Computer, frees the active slot, can be backfilled later. On confirm, call `UpdateComputerMutation` with `{ status: ARCHIVED }`; on success, navigate back to `/computers`.
- List page: replace the bare `FilterBarSearch + FilterBarSort` row with `FilterBarSearch + FilterBarPopover + FilterBarSort`. Inside `FilterBarPopover`, add a switch labeled "Show archived" (default off). Filter all fetched rows client-side by `status !== 'ARCHIVED'` unless the switch is on, in which case show everything.
- On confirm-archive, also invalidate or refetch the list query so the row disappears from the default view on return.

**Patterns to follow:**
- Atomic destructive `AlertDialog`: `apps/admin/src/routes/_authed/_tenant/automations/webhooks/$webhookId.tsx` (delete-webhook precedent)
- "Show archived" filter via `FilterBarPopover` + switch: `apps/admin/src/routes/_authed/_tenant/threads/index.tsx`
- Filter primitive: `apps/admin/src/components/ui/data-table-filter-bar.tsx`

**Test scenarios (`$computerId.tsx` archive button + list filter):**
- Archive happy path: clicking Archive opens the AlertDialog; confirming fires `UpdateComputerMutation` with `{ status: ARCHIVED }` and navigates back to `/computers`. **Covers AE7.**
- Archive cancel: clicking Cancel in the AlertDialog dismisses without firing the mutation.
- Slot reuse after archive: after archiving Joey's Computer, opening the U3 dialog (or the U5 CTA) shows Joey as an eligible owner again. **Covers R16, AE7.**
- List default-hidden: with the switch off, archived Computers do not appear in the default list. **Covers R15.**
- List opt-in show: toggling the switch on includes archived rows; toggling off hides them again.
- Filter badge: the active-filter count on the `FilterBarPopover` increments when the switch is on.

**Verification:**
- Manual: archive a Computer; observe it leaves the default list; toggle "Show archived" on; observe it reappears. Re-provision the same user via U4 or U5; observe a new Computer row is created and the new Computer is the active one.

---

## Scope Boundaries

### Deferred to Follow-Up Work

- Phase-2 brainstorm + plan for actually re-seeding the Computer's workspace from the new template on template change (U6 ships honest-copy warning only — see U6 notes).
- Admin Settings UI to override the platform-default Computer template at the tenant level (`tenant_settings.default_computer_template_id` or equivalent).
- Surfacing auto-provision failures as a dedicated admin list ("Needs backfill") instead of the existing `activity_log` surface.
- Field-scoped mutation for `updateComputer` so infra fields (`efsAccessPointId`, `ecsServiceName`, `liveWorkspaceRoot`, `runtimeStatus`, `spentMonthlyCents`, `budgetPausedReason`) are not writable by tenant-admin callers via direct API. Plan accepts the v1 risk because admin UI does not expose these fields.
- Periodic reconciler that finds `tenant_members` rows without active Computers and provisions them — backstop for future insertion paths that may be added (SAML, SCIM, fixtures) without being wired to the helper.

### Out of scope (carried from origin)

- Owner reassignment (move a Computer between users).
- Hard delete (only archive).
- Bulk operations (bulk create, bulk archive).
- CLI commands for Computer CRUD.
- Mobile UX changes.
- Changes to existing Dashboard, Workspace, Runtime, Live Tasks, Events, Migration panels on the detail page.
- Auto-un-archive on re-invite (re-provisioning produces a new row).

---

## Dependencies / Assumptions

- The existing `createComputer` / `updateComputer` resolvers continue to enforce `requireTenantAdmin` and `assertNoActiveComputer`. R7 and R8 lean on this; the plan does not re-implement either check.
- The hand-rolled-migrations regime documented in `CLAUDE.md` (with `-- creates:` markers and `pnpm db:migrate-manual` drift gate) remains in force. U1 follows that regime; the user-memory `feedback_handrolled_migrations_apply_to_dev` is the cost we are choosing to pay rather than introduce a new mechanism.
- The current default Sonnet inference profile (`us.anthropic.claude-sonnet-4-20250514-v1:0`) is the right model field value for the platform-default template at seed time. If the platform model default shifts before this lands, update U1's `INSERT` accordingly.
- `activity_log` is the right tenant-scoped audit surface for auto-provision failures; if research at execution time finds a more specific surface (e.g., a per-tenant "inbox" already used for similar events), U2 may prefer that instead — the product decision (visible, surface-able for backfill) is fixed; the surface is interchangeable.

---

## Outstanding Questions

### Deferred to Implementation

- [Affects U6] Should the template-change consequence dialog disable the rename / budget save buttons while open, or are the three inline edits fully independent? Pick at execution time based on UX feel.
- [Affects U6] Should the panel render fully read-only for non-tenant-admin viewers, or be omitted entirely from their view of the Config tab? Match existing admin convention at execution time.
- [Affects U7] Should the AlertDialog include the Computer's name in the body for accidental-archive protection ("Archive 'Joey's Computer'?"), and require the admin to type the name to confirm? Default to no; revisit if archive-by-mistake reports come in post-launch.
