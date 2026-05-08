---
title: U10 — Admin Compliance section (nav + routes + GraphQL read + Events list/drawer)
type: feat
status: active
date: 2026-05-07
origin: docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md
---

# U10 — Admin Compliance section (nav + routes + GraphQL read + Events list/drawer)

## Summary

Add the operator-facing surface for the audit log: a new "Compliance" entry in the admin sidebar's Manage group, an Events list page at `/compliance` with tenant/actor/event-type/time filters and cursor pagination, and a drawer at `/compliance/events/$eventId` showing the full event JSON, chain position (event_hash + prev_hash), and anchor status (anchored vs not-yet-anchored, derived from `tenant_anchor_state`). Reads run through a new `complianceEvents` / `complianceEvent` GraphQL pair backed by the `compliance_reader` Aurora role provisioned in U2 — the graphql-http Lambda gets a second lazy pg pool keyed off `COMPLIANCE_READER_SECRET_ARN` so the existing graphql_db_secret_arn pool is untouched.

---

## Problem Frame

U1–U9 shipped the WORM-locked audit substrate: events are emitted (U3–U6), drained into a hash chain (U4), Merkle-anchored to S3 every 15 minutes with Object Lock retention (U7–U8b), and any third party can verify the resulting evidence cryptographically (U9). What's missing is the **operator-facing view**. A SOC2 Type 1 walkthrough is not "the auditor runs our verifier" — it's "show me your audit-trail control" / "demonstrate that an operator can see who did what when." Today an admin has no way to browse `compliance.audit_events` short of an Aurora `psql` session, which is not a control-walkthrough artifact. U10 builds the SPA surface that makes the substrate auditable.

---

## Requirements

- R1. New "Compliance" sidebar entry in the admin SPA's Manage group (alongside Analytics / People / Billing / Settings), routing to `/compliance`.
- R2. Events list page at `/compliance` with cursor pagination (default page size 50), sorted `occurred_at DESC, event_id DESC` to use the existing `(tenant_id, occurred_at DESC)` and `(tenant_id, event_type, occurred_at DESC)` indices on `compliance.audit_events`. Filter UI exposes: tenant_id (operator-only; tenant-scoped users locked to their own), actor_type, event_type (canonical slate from `packages/database-pg/src/schema/compliance.ts` `COMPLIANCE_EVENT_TYPES` — 14 emitted + 5 reserved values; do not transcribe; import or regenerate from the schema), `since` / `until` (ISO8601, half-open `[since, until)`, applied as `occurred_at`-bounds). Default filter on first page load: `since = now - 7 days`, no other filters set.
- R3. Event detail page at `/compliance/events/$eventId` rendering as a flat full-page route (matches the existing `routines/$routineId_.executions.$executionId.tsx` pattern — full-page detail with header navigation back to `/compliance`, NOT a sibling-Outlet drawer overlay; the Outlet-rendered drawer pattern does not exist in this admin SPA). Page shows: full event JSON pretty-printed (capped at 256KB inline render with a "Download full payload" affordance for larger payloads); chain-position panel with `event_hash` + `prev_hash` (copy-buttons with the `CopyableRow` icon-swap-1500ms pattern from `apps/admin/src/routes/_authed/_tenant/settings.tsx`); anchor-status panel showing **Anchored** (with `last_cadence_id` + `last_anchored_recorded_at`) or **Pending** ("Anchored on next cadence — within 15 min") based on `tenant_anchor_state.last_anchored_recorded_at >= event.occurred_at`. Both badges include an icon (`CheckCircle` / `Clock`) alongside the text label so status is distinguishable without color.
- R4. Two new GraphQL queries: `complianceEvents(filter: ComplianceEventFilter, after: String, first: Int): ComplianceEventConnection!` and `complianceEvent(eventId: ID!): ComplianceEvent`. Connection shape matches the existing repo convention (`{ edges: [{ node, cursor }], pageInfo: { hasNextPage, endCursor } }`).
- R5. Resolver auth scoping has TWO axes:
   - **Auth-type gate (apikey hard-block):** the resolvers explicitly reject `ctx.auth.authType === "apikey"` callers (Strands runtime, internal tools holding `API_AUTH_SECRET`). Compliance reads are Cognito-only. The Strands runtime does not need to read its own audit log; locking it out closes a service-key bypass. Mirrors the `requireNotFromAdminSkill` pattern in `packages/api/src/graphql/resolvers/core/authz.ts`.
   - **Operator-vs-tenant gate:** the existing `THINKWORK_PLATFORM_OPERATOR_EMAILS` allowlist (set on graphql-http via `terraform/modules/app/lambda-api/main.tf:44`) is the source of truth for "this user is a platform operator who can browse all tenants." Operators see all tenants when `args.filter.tenantId` is supplied or omitted; non-operators have their `args.filter.tenantId` server-side-overridden to `resolveCallerTenantId(ctx)`. There is NO Cognito group claim for "admin"; do not invent one. If `resolveCallerTenantId(ctx)` returns null (newly-onboarded Google-OAuth user, no tenant row yet), the resolver throws `UNAUTHENTICATED` with a structured message rather than fall through with a null-tenant SQL filter.
   - Cross-tenant leakage is integration-tested across both axes (apikey-blocked + non-operator-tenantId-spoof + null-tenant fail-closed).
- R6. Resolver reads run as the `compliance_reader` Aurora role via `COMPLIANCE_READER_SECRET_ARN` (already plumbed into `terraform/modules/app/lambda-api/handlers.tf` for the anchor Lambda; the graphql-http Lambda gets the same env var added in this PR). The graphql_db_secret_arn pool used by every other resolver is untouched.
- R7. URL filter parameters round-trip: `/compliance?event_type=agent.created&since=2026-04-01T00:00:00Z` is shareable and re-renders the same filtered view on a fresh load.
- R8. No mutations on `audit_events`. The trigger `audit_events_block_delete` enforces this at the DB layer; the GraphQL schema offers no write surface either.
- R9. Read-only — no AppSync subscriptions, no real-time counters, no aggregate dashboard. List-and-drawer browse is the entire user surface for v1.

**Origin requirements** (master plan U10 entry, lines ~615-660 of `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md`): admin Compliance nav + `/compliance` list + `/compliance/events/$eventId` drawer + `complianceEvents` / `complianceEvent` queries + `compliance_reader` resolver wiring. R1–R9 carry every named element of that origin entry.

---

## Scope Boundaries

- **Verification status panel** showing daily-verifier results — out of scope (post-Phase-D follow-up; U9 verifier exists, but the cron + admin display is a separate plan).
- **Mutations on `audit_events`** — the table is append-only by design; trigger + schema both reject.
- **AppSync subscriptions / real-time counters** — read-only retrospective browse only.
- **Async event export** — that's U11's plan, not U10.
- **Forensic per-event Merkle proof generation** — U10+ enhancement.
- **Aggregate dashboard** (counts per event_type / actor_type / tenant) — defer to a U10 v2 if low-effort; v1 ships list + drawer only.
- **Filter persistence across sessions** — URL query params (R7) cover the share-and-resume case.
- **Mobile surface** — admin-tier only per the CLAUDE.md guardrail; mobile compliance browse is separate scope.

### Deferred to Follow-Up Work

- **Verification status panel** — depends on a daily-verifier scheduled Lambda that runs `@thinkwork/audit-verifier` against the bucket and writes a summary row the admin SPA can read. Separate plan.
- **Aggregate dashboard** — `complianceEventCounts(filter): { byType, byActor, byDay }` query + chart card on `/compliance`. Defer to v2 if v1 surfaces a need.
- **CSV / NDJSON download from the list page** — U11's async-export job is the right surface, not a synchronous list-page button.

---

## Context & Research

### Relevant Code and Patterns

- **Sidebar nav:** `apps/admin/src/components/Sidebar.tsx` — `manageItems` array (line ~249) is where the new `{ to: "/compliance", icon: ScrollText, label: "Compliance" }` entry lands. Existing entries: Analytics, People, Billing (owner-only), Settings.
- **Tenant-scoped layout:** `apps/admin/src/routes/_authed/_tenant.tsx` — the parent layout. New compliance routes nest under `_authed/_tenant/compliance/`.
- **List + drawer pattern reference:** `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId_.executions.$executionId.tsx` — closest-existing nested-route execution-detail pattern (drawer-as-route via TanStack Router `Outlet`).
- **Param-route convention:** existing `*.\$paramId.tsx` files (e.g., `agent-templates/\$templateId.\$tab.tsx`) for the `/compliance/events/$eventId` layout.
- **Resolver auth helpers:** `packages/api/src/graphql/resolvers/core/authz.ts` (admin group check), `packages/api/src/graphql/resolvers/connectors/query.ts` (existing `resolveCallerTenantId(ctx)` use), `packages/api/src/lib/compliance/emit.ts` (existing tenant-resolver fallback).
- **Existing list resolver shape:** `packages/api/src/graphql/resolvers/agents/` for cursor-paginated connection convention. Match `{ edges, pageInfo }` shape exactly so the `urql` cache / hooks behave identically.
- **DB layer:** `packages/database-pg/src/schema/compliance.ts` — `auditEvents` table already exported from U1 with the right indices (`(tenant_id, recorded_at DESC)` and `(event_type, recorded_at DESC)`), and `tenantAnchorState` from U8a (`last_anchored_recorded_at`, `last_cadence_id`).
- **Aurora-via-Secrets-Manager pattern:** `packages/lambda/compliance-anchor.ts:264-321` — lazy pg client keyed off a Secrets Manager ARN, error-invalidation on connection failure, NODE_ENV=test escape hatch for `COMPLIANCE_READER_DATABASE_URL`.
- **GraphQL types canonical source:** `packages/database-pg/graphql/types/*.graphql`. After editing, run `pnpm schema:build` then `pnpm --filter <name> codegen` for `apps/admin`, `packages/api`, `apps/cli`, `apps/mobile`.
- **Terraform env-var plumbing:** `terraform/modules/app/lambda-api/handlers.tf` — `COMPLIANCE_READER_SECRET_ARN` already plumbed to the anchor Lambda; the new wiring adds it to the graphql-http handler's environment block too.

### Institutional Learnings

- **`feedback_oauth_tenant_resolver`** — `ctx.auth.tenantId` is null for Google-federated users; resolvers MUST use `resolveCallerTenantId(ctx)` as the fallback. Cross-tenant leakage tests must cover this case.
- **`feedback_user_opt_in_over_admin_config`** — Compliance is admin-tier (operator's view of audit infrastructure), not end-user opt-in surface; placing it in the admin sidebar's Manage group is the right shape.
- **`feedback_pnpm_in_workspace`** — every `pnpm` invocation in this work uses `pnpm`, never `npm`.
- **`project_admin_worktree_cognito_callbacks`** — concurrent vite worktrees on ports 5175+ must be added to the Cognito `ThinkworkAdmin` CallbackURLs OR run on the main port. Document the dev-server port choice when running this plan locally.
- **`feedback_graphql_deploy_via_pr`** — GraphQL Lambda deploys via `main` merge pipeline only, never `aws lambda update-function-code` directly. Holds for U10's resolver work.

### External References

- TanStack Router nested-route + `<Outlet>` pattern (already established in this codebase; no external research needed).
- urql cursor-pagination cache hooks (`useQuery` with `additive` cache exchange) — pattern already in use across the admin SPA.

---

## Key Technical Decisions

- **Detail page is a flat full-page route, not a drawer overlay.** The originally-cited "drawer-as-Outlet" reference (`routines/.../executions/$executionId.tsx`) is itself a flat full-page route with an in-page Sheet — not an Outlet-rendered drawer over a still-mounted list. Re-using a non-existent pattern would force the implementer to design layout-route + scroll-preservation + drawer-mount-survival from scratch. Ship a flat detail page now; revisit drawer-overlay UX in a follow-up if operators need it.
- **Auth-type gate: Cognito-only (apikey hard-block).** Compliance resolvers reject `ctx.auth.authType === "apikey"` to close the Strands-runtime / service-key bypass path. The existing `requireNotFromAdminSkill` helper in `packages/api/src/graphql/resolvers/core/authz.ts` is the model.
- **Operator concept reuses `THINKWORK_PLATFORM_OPERATOR_EMAILS`.** No new Cognito group, no new `ctx.auth.isAdmin` field. The graphql-http Lambda already loads this allowlist from env (`terraform/modules/app/lambda-api/main.tf:44`); resolvers gate cross-tenant browsing on `OPERATOR_EMAILS.includes(ctx.auth.email)`. Tenant-scoped users (everyone else) get `args.filter.tenantId` server-side-overridden to `resolveCallerTenantId(ctx)`, which fail-closes if no tenant resolves.
- **Sort + cursor on `occurred_at`, NOT `recorded_at`.** Existing indices on `compliance.audit_events` are `(tenant_id, occurred_at DESC)` and `(tenant_id, event_type, occurred_at DESC)` (see `packages/database-pg/drizzle/0069_compliance_schema.sql:210-215`). Sorting/filtering on `occurred_at` keeps the list page index-served at enterprise scale. The plan would otherwise force a hand-rolled migration adding `(tenant_id, recorded_at DESC)` — out of scope for U10.
- **Cursor format: opaque base64-url of `{occurred_at_iso, event_id}` JSON, with `occurred_at_iso` carrying microsecond precision.** Encode by stringifying the raw Postgres-returned `timestamptz` text (`"2026-05-07T14:23:45.123456+00:00"`) — never round-trip through `new Date(...).toISOString()` (loses microseconds → boundary skips/duplicates events). Decode by parsing back to a string + UUID; pass both back to SQL as parameterized `(occurred_at::timestamptz, event_id::uuid)`.
- **Anchor status uses `tenant_anchor_state` only (acknowledged approximation).** Drawer shows "Anchored" when `event.occurred_at <= tenant_anchor_state.last_anchored_recorded_at`, else "Pending". One SELECT against `tenant_anchor_state`, no S3 reads from the resolver. Known limitations: (a) **TOCTOU race** — `tenant_anchor_state` may be updated before the S3 PutObject confirms durability if U8b's update isn't post-PutObject; surface this in the README/Risks rather than rebuilding U8b. (b) **Approximation** — the badge proves "this event is in some anchored cadence's range," not "this exact cadence_id includes this event_id." For byte-level proof, the auditor runs `@thinkwork/audit-verifier` (U9). The drawer's anchor-panel subtitle says so plainly.
- **`AnchorStatus` is a flat object with a discriminant enum, NOT a GraphQL union.** `ComplianceAnchorStatus { status: AnchorStatusEnum!, cadenceId: ID, anchoredRecordedAt: DateTime, nextCadenceWithinMinutes: Int }`. Adding a field is non-breaking; one consumer is not enough to justify GraphQL union ergonomics in zod / urql.
- **Dedicated `reader-db.ts` module (lazy pg client), NOT `SET LOCAL ROLE`.** Role-switching inside the existing `graphql_db_secret_arn` pool requires every compliance query to wrap in a transaction with `SET LOCAL ROLE compliance_reader; ... ; RESET ROLE`. A future query that forgets the wrapper inherits the writer role's privileges silently — too easy to regress. The dedicated lazy module mirrors `compliance-anchor.ts:264-321`, which is battle-tested. Tradeoff: ~30 KB extra warm-container memory per Lambda. Acceptable.
- **Connection shape establishes a new pattern in this repo.** The existing `MessageConnection` / `TenantEntityFacetConnection` use a flat `cursor: String` on the query field, NOT relay-style `edges { node, cursor }`. U1 introduces relay-style explicitly so the urql cache key includes the per-edge cursor (better for "Load more" pagination). Document the choice in U1 — implementer is establishing a pattern, not following one.
- **GraphQL filter shape: flat input with optional fields.** `ComplianceEventFilter { tenantId, actorType, eventType, since, until }` — all optional. Server-side overrides for non-operators are applied BEFORE SQL parameterization (no TOCTOU between zod validation and auth override).
- **`event_type` enum is regenerated from `compliance.ts` schema, NOT hand-transcribed.** U1 derives the GraphQL enum values programmatically from `COMPLIANCE_EVENT_TYPES` (or hand-codes them once with a U2 unit test that asserts no drift between `emit.ts` and the GraphQL enum). Otherwise a future writer-side enum addition silently breaks the resolver via ZodError on the union response.
- **`event_hash` index + `complianceEventByHash` query land in this PR (not v2).** The chain-position panel's "view prev event" affordance is a primary trust signal during a SOC2 walkthrough. A hand-rolled index migration on `compliance.audit_events(event_hash)` plus a single tenant-scoped resolver is small enough to fit. Drawer renders `prev_hash` as a clickable link that resolves via the new query and redirects to `/compliance/events/$eventId`.
- **No mobile / CLI codegen regen.** Neither `apps/cli` nor `apps/mobile` consume compliance types in v1. `pnpm -r typecheck` catches drift if those packages ever add a query. Skipping their codegen scripts avoids 200-500 lines of generated-file noise per PR.
- **Sidebar position: between Settings and the bottom of Manage** (not between Analytics and People). Compliance is an infrastructure/audit control, semantically adjacent to Settings; placing it next to Analytics conflates a retrospective metrics tool with an evidence-of-control surface.
- **Sidebar icon: `ScrollText` from lucide-react.**
- **Vite dev server port: 5174.** If a concurrent admin is on 5174, use 5175 and add it to `ThinkworkAdmin` CallbackURLs (institutional pattern: each concurrent admin port must be in Cognito's CallbackURLs to avoid `redirect_mismatch`).
- **Today's date: 2026-05-07.**

---

## Open Questions

### Resolved During Planning

- **Drawer vs dedicated detail route?** Resolved — drawer (URL-driven nested route). Closes the loop with browser back/refresh and matches the routines pattern.
- **Specific anchor lookup or last-anchor approximation?** Resolved — last-anchor approximation via `tenant_anchor_state.last_anchored_recorded_at`. The "exact cadence_id that included this event" requires reading anchor JSON from S3, which adds an S3 dep to the resolver and a per-event S3 GET that scales poorly. The approximation answers the SOC2 walkthrough question ("was this event tamper-evidence-protected?") cleanly.
- **Admin auth source?** Resolved — Cognito `admin` group claim, same as `packages/api/src/graphql/resolvers/core/adminRoleCheck.query.ts` already uses. Tenant-scoped users locked via `resolveCallerTenantId(ctx)` per `feedback_oauth_tenant_resolver`.
- **Page size?** Resolved — default 50 (matches existing list resolvers in the repo). Cap at 200 server-side; client UI doesn't expose a picker in v1.
- **Timezone handling?** Resolved — all timestamps are UTC, displayed as ISO8601 with the local-time relative tooltip. No timezone picker.
- **What if the `compliance_reader` secret is missing in dev?** Resolved — resolver throws a structured 503 ("Compliance event browsing is not available in this environment — `COMPLIANCE_READER_SECRET_ARN` env var is unset"). The admin SPA renders a friendly empty-state with the message. Better than a blank list silently failing.

### Deferred to Implementation

- **Exact filter UI component shape** (multi-select for `event_type` vs single-select dropdown vs typeahead) — implementer picks based on what shadcn/ui primitives are already in use elsewhere in admin. Default expectation: shadcn `Select` for single-value filters; a dropdown checkbox group for multi-select if needed.
- **Whether to fold `tenant_anchor_state` lookup into the same `complianceEvent` query or use a separate query** — implementer decides at resolver-write time. Single query is preferable if the join is cheap (it is — single-row lookup by `tenant_id`); separate query if the resolver shape gets unwieldy.
- **Cursor encoding format** (base64 of `${recorded_at_iso}:${event_id}` vs separate fields) — implementer picks; the existing repo convention should drive this.
- **Whether to add `event_hash` index to the schema** for a future `complianceEventByHash` query — out of scope for v1; surface as a follow-up if v2 needs it.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
flow: GraphQL resolver path for `complianceEvents`
  │
  ├─ ctx auth check
  │   ├─ admin group claim? → tenantId filter is OPTIONAL (caller may scope to one or all)
  │   └─ non-admin?         → tenantId filter is FORCED to resolveCallerTenantId(ctx)
  │
  ├─ ComplianceReaderDb.client (lazy module-load; reads COMPLIANCE_READER_SECRET_ARN once)
  │   └─ pg client cached for warm-Lambda reuse, invalidated on connection error
  │
  ├─ SQL: SELECT event_id, tenant_id, recorded_at, occurred_at, actor, actor_type,
  │       source, event_type, event_hash, prev_hash, payload
  │       FROM compliance.audit_events
  │       WHERE (tenant_id  = $tenantFilter)?
  │         AND (actor_type = $actorTypeFilter)?
  │         AND (event_type = $eventTypeFilter)?
  │         AND  recorded_at >= $since
  │         AND  recorded_at <  $until
  │         AND  (recorded_at, event_id) <  decodeCursor($after)?
  │       ORDER BY recorded_at DESC, event_id DESC
  │       LIMIT $first + 1                           -- +1 to detect next page
  │
  ├─ encodeCursor(last edge)  →  pageInfo.endCursor
  └─ return { edges: [{ node, cursor }], pageInfo: { hasNextPage, endCursor } }


flow: GraphQL resolver path for `complianceEvent(eventId)`
  │
  ├─ ctx auth check (same admin/tenant logic)
  ├─ SELECT * FROM compliance.audit_events WHERE event_id = $eventId
  │   (resolver enforces caller's tenant scope; non-admin reading another tenant's
  │    event_id by guess returns null, NOT an authorization error — UI can't
  │    distinguish missing from forbidden, prevents existence oracle attacks)
  ├─ SELECT last_anchored_recorded_at, last_cadence_id FROM compliance.tenant_anchor_state
  │   WHERE tenant_id = $event.tenant_id
  └─ return ComplianceEvent {
       ...event,
       anchorStatus: event.recorded_at <= tas.last_anchored_recorded_at
         ? { status: "ANCHORED",  cadenceId, anchoredRecordedAt }
         : { status: "PENDING",   nextCadenceIn: "<= 15 min" }
     }


flow: SPA route layout
  /compliance                              ← Events list page (Outlet for drawer)
  /compliance/events/$eventId              ← Drawer route (renders inside list)

  When the drawer route is active:
    list page stays mounted (preserved scroll, filter state)
    drawer renders as overlay (shadcn Sheet or similar)
    closing drawer = navigate to "/compliance" (preserves filter URL params)
```

The unchanged invariant the design preserves: every other GraphQL resolver continues to use the existing `graphql_db_secret_arn` pool — U10 introduces a SECOND pool keyed off `compliance_reader`, used ONLY by these two resolvers.

---

## Implementation Units

- U1. **GraphQL schema + types**

**Goal:** Define `compliance.graphql` with the `ComplianceEvent` type, `ComplianceEventFilter` input, `ComplianceEventConnection` shape, and the two query fields. Run `pnpm schema:build` + codegen in every consumer that has a codegen script. The schema is the seam every downstream piece (resolver, admin route, smoke gate) reads from.

**Requirements:** R4, R8, R9.

**Dependencies:** None.

**Files:**
- Create: `packages/database-pg/graphql/types/compliance.graphql`
- Modify: `terraform/schema.graphql` (auto-regenerated by `pnpm schema:build`)
- Modify: `apps/admin/src/lib/graphql-queries.ts` and codegen artifacts (one `pnpm --filter @thinkwork/admin codegen` after schema lands)
- Modify: `packages/api/src/graphql/__generated__` codegen output

**Approach:**
- `ComplianceEvent` fields: `eventId: ID!`, `tenantId: ID!`, `occurredAt: DateTime!`, `recordedAt: DateTime!`, `actor: String!`, `actorType: ComplianceActorType!`, `source: String!`, `eventType: ComplianceEventType!`, `eventHash: String!`, `prevHash: String`, `payload: JSON!`, `anchorStatus: ComplianceAnchorStatus!`.
- `ComplianceAnchorStatus` is a union: `Anchored { cadenceId: ID!, anchoredRecordedAt: DateTime! }` | `Pending { nextCadenceWithinMinutes: Int! }`. Implementer can simplify to a flat object with optional fields if union ergonomics in zod / urql get awkward — record the simplification in code comments.
- `ComplianceActorType` enum: mirror the values from `packages/database-pg/src/schema/compliance.ts` (`system`, `user`, `agent`, `runtime`, etc — read the schema, don't transcribe).
- `ComplianceEventType` enum: 10-value slate from U5 (`agent.created`, `agent.deleted`, `agent.skills_changed`, `mcp.added`, `mcp.removed`, `user.invited`, `workspace.governance_file_edited`, plus the U6 set if any). Read `packages/api/src/lib/compliance/emit.ts` for the canonical list.
- `ComplianceEventFilter` input: `tenantId: ID`, `actorType: ComplianceActorType`, `eventType: ComplianceEventType`, `since: DateTime`, `until: DateTime`. All optional.
- Queries: `complianceEvents(filter, after, first): ComplianceEventConnection!`, `complianceEvent(eventId: ID!): ComplianceEvent`.
- Connection shape mirrors existing repo convention exactly — copy field names from `agents.graphql` / similar.
- No mutations.

**Patterns to follow:**
- `packages/database-pg/graphql/types/agents.graphql` for connection + filter input shape.
- `packages/database-pg/graphql/types/observability.graphql` for time-range filter conventions.

**Test scenarios:**
- *Test expectation: none — pure schema definition. Coverage lands in U2 (resolver) + U4 (frontend integration).*

**Verification:**
- `pnpm schema:build` succeeds; `terraform/schema.graphql` regenerated cleanly.
- `pnpm --filter @thinkwork/admin codegen && pnpm --filter @thinkwork/api codegen` produce no errors and stage updated codegen artifacts.
- Repo-wide `pnpm -r typecheck` clean (codegen consumers compile against the new types).

---

- U2. **Compliance reader DB module + resolvers + auth scoping + Terraform env-var + tests**

**Goal:** Implement the THREE resolvers (`complianceEvents`, `complianceEvent`, `complianceEventByHash`) backed by a NEW lazy pg client keyed off `COMPLIANCE_READER_SECRET_ARN`. Auth scoping is two-axis: apikey hard-block + operator-vs-tenant via `THINKWORK_PLATFORM_OPERATOR_EMAILS`. Add the `event_hash` index migration. Wire the env var into the graphql-http Lambda via Terraform. Cross-tenant leakage + apikey-bypass + null-tenant fail-closed are integration-tested.

**Requirements:** R4, R5, R6, R8.

**Dependencies:** U1.

**Files:**
- Create: `packages/api/src/lib/compliance/reader-db.ts`
- Create: `packages/api/src/graphql/resolvers/compliance/complianceEvents.query.ts`
- Create: `packages/api/src/graphql/resolvers/compliance/complianceEvent.query.ts`
- Create: `packages/api/src/graphql/resolvers/compliance/complianceEventByHash.query.ts`
- Modify: `packages/api/src/graphql/resolvers/index.ts` (register the three new resolvers)
- Create: `packages/database-pg/drizzle/0074_compliance_event_hash_index.sql` (hand-rolled migration with `-- creates: ...` markers; adds `CREATE INDEX idx_audit_events_event_hash ON compliance.audit_events(event_hash)` for the hash-lookup query). Operator must `psql -f` this against dev before merge per the hand-rolled-migrations drift-gate convention.
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (add `COMPLIANCE_READER_SECRET_ARN = var.compliance_reader_secret_arn` to the graphql-http handler's env block; the existing `lambda_secrets` policy already grants `secretsmanager:GetSecretValue` on `thinkwork/*` per `terraform/modules/app/lambda-api/main.tf:180-203`, so no new IAM resource needed)
- Test: `packages/api/src/graphql/resolvers/compliance/complianceEvents.query.test.ts`
- Test: `packages/api/src/graphql/resolvers/compliance/complianceEvent.query.test.ts`
- Test: `packages/api/src/__tests__/compliance-authz.test.ts` (cross-tenant leakage + apikey-bypass + null-tenant scenarios)

**Approach:**
- `reader-db.ts` exports `getComplianceReaderDb()`. Lazy pg client. `NODE_ENV=test` + `COMPLIANCE_READER_DATABASE_URL` escape hatch. On connection error, invalidate the cached client. Use `sslmode=require` (NOT `sslmode=no-verify` — the compliance-anchor pattern's no-verify default is acceptable for the writer Lambda but the read path is the higher-stakes surface for an audit tool). Mirrors `packages/lambda/compliance-anchor.ts:264-321` for shape; tightens TLS posture.
- **Auth pre-check (BEFORE arg validation):** every compliance resolver runs:
  1. `if (ctx.auth.authType === "apikey") throw new GraphQLError("Compliance reads are restricted to Cognito callers.", { extensions: { code: "FORBIDDEN" } });`
  2. Compute `isOperator = THINKWORK_PLATFORM_OPERATOR_EMAILS.includes(ctx.auth.email ?? "")`. If non-operator and `args.filter?.tenantId` is set, override it: `args.filter.tenantId = await resolveCallerTenantId(ctx)`.
  3. If non-operator AND the resolved tenantId is null/undefined, throw `UNAUTHENTICATED` with a documented message ("Compliance access requires either platform-operator email or a resolved tenant scope.")
  4. If `COMPLIANCE_READER_SECRET_ARN` is unset, throw `INTERNAL` with the env-var name; do not silently return empty results.
- **`complianceEvents.query.ts`** implements the SQL flow on `occurred_at` (matches existing indices). Cursor encoding is base64-url of `{occurred_at_iso_with_microseconds, event_id}` JSON. SQL: parameterize as `(occurred_at::timestamptz, event_id::uuid) < ($cur_occurred_at::timestamptz, $cur_event_id::uuid)` for the boundary predicate. ORDER BY `occurred_at DESC, event_id DESC`. LIMIT `first + 1` to detect next page.
- **`complianceEvent.query.ts`** flows: SELECT one row WITH `tenant_id = $callerTenantId` baked into the WHERE clause for non-operators (collapses "exists but forbidden" and "doesn't exist" to the same code path — closes the timing-side-channel oracle). Then SELECT tenant_anchor_state, compose `anchorStatus`. Returns null for any event the caller can't see.
- **`complianceEventByHash.query.ts`** flows: `SELECT * FROM compliance.audit_events WHERE event_hash = $hash AND tenant_id = $callerTenantId LIMIT 1` (operator scope: omit the tenant filter; non-operator scope: enforce it).
- Resolver tests mock pg.Client to assert SQL shape (parameterized values + WHERE clauses).
- Cross-tenant leakage test scenarios (in `__tests__/compliance-authz.test.ts`):
  - apikey caller → FORBIDDEN, no SQL fires.
  - non-operator with `args.filter.tenantId = "OTHER_TENANT"` → resolver overrides to caller's resolved tenant; `OTHER_TENANT` rows never returned.
  - non-operator Google-OAuth user with `ctx.auth.tenantId === null` and `resolveCallerTenantId` returning null → throws `UNAUTHENTICATED` (does NOT silently fall through with a null filter).
  - non-operator passing another tenant's `event_id` to `complianceEvent` → returns null (SQL filter applies; no timing leak).
  - operator caller without `args.filter.tenantId` → returns events from all tenants.
- **Cursor microsecond fidelity test:** seed two rows with `occurred_at` differing by exactly 1 microsecond, paginate `first: 1`, assert the second page returns the second row (not the first one duplicated, not nothing).
- **Enum drift test:** snapshot-test that `ComplianceEventType` GraphQL enum values exactly match `COMPLIANCE_EVENT_TYPES` from `packages/database-pg/src/schema/compliance.ts`. Fails CI if a writer-side addition outpaces the GraphQL schema.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/connectors/query.ts` for the admin-vs-tenant auth shape.
- `packages/api/src/lib/compliance/emit.ts` for `resolveCallerTenantId(ctx)` integration.
- `packages/api/src/graphql/resolvers/agents/agents.query.ts` (or similar) for connection + cursor pagination shape.
- `packages/lambda/compliance-anchor.ts:264-321` for the lazy DB client pattern.

**Test scenarios:**
- Happy path (admin caller, no filter): returns the first 50 events ordered `recorded_at DESC, event_id DESC` with a valid `endCursor`.
- Happy path (admin caller, filter by `event_type: agent.created` + 7-day `since/until` window): returns only matching rows.
- Pagination: 60-row fixture + `first: 50`; first call returns 50 rows + `hasNextPage: true`; second call with `after: endCursor` returns the remaining 10 rows + `hasNextPage: false`.
- Cursor stability across equal-microsecond timestamps: two events with identical `recorded_at` but distinct `event_id` — pagination boundary doesn't drop or duplicate either.
- Non-admin caller passes `filter.tenantId = "OTHER_TENANT"` — resolver silently overrides to caller's tenant; `OTHER_TENANT` rows never appear.
- Non-admin caller with null `ctx.auth.tenantId` (Google OAuth) — `resolveCallerTenantId(ctx)` fallback resolves correctly; tenant-scoped fetch succeeds.
- Edge case: `since > until` → returns empty edges list, `hasNextPage: false`. (Don't throw — auditors copy/paste timestamps and a swap is recoverable.)
- Error path: `COMPLIANCE_READER_SECRET_ARN` unset → resolver throws structured 503 with the env-var name in the message.
- Error path: pg client throws a connection error → resolver invalidates the cached client AND surfaces a structured GraphQL error (not a stack trace).
- `complianceEvent` happy path: admin caller, valid event_id → returns event + anchored status.
- `complianceEvent` non-admin reading another tenant's event_id → returns null (existence oracle defense), NOT an authorization error.
- `complianceEvent` anchor-status: event with `recorded_at <= tas.last_anchored_recorded_at` → `Anchored`; event with `recorded_at > tas.last_anchored_recorded_at` → `Pending`.

**Verification:**
- All resolver tests pass; cross-tenant leakage test pins the auth boundary.
- `pnpm --filter @thinkwork/api typecheck && pnpm --filter @thinkwork/api test` clean.
- Resolver entries appear in `packages/api/src/graphql/resolvers/index.ts`.

---

- U3. **(folded into U2)** — Terraform env-var addition is a single-line change to `terraform/modules/app/lambda-api/handlers.tf`. Keeping it as a standalone unit creates a hidden gap where U2's resolver tests pass via the `COMPLIANCE_READER_DATABASE_URL` escape hatch but the deployed Lambda is missing the env var. The single-line plumbing now lives in U2's Files list. Existing IAM grant (`thinkwork/*` wildcard in `terraform/modules/app/lambda-api/main.tf:180-203`) already covers `secretsmanager:GetSecretValue`; no new IAM resource needed.

(legacy U3 content retained below for traceability; do not implement separately)

**Requirements:** R6.

**Dependencies:** None.

**Files:**
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (graphql-http handler env block)
- Modify: `terraform/modules/app/lambda-api/variables.tf` (if `var.compliance_reader_secret_arn` isn't already plumbed at the lambda-api module level — check; it likely is, given the anchor Lambda already uses it from this same module)

**Approach:**
- Find the graphql-http handler environment block in `handlers.tf`. Add `COMPLIANCE_READER_SECRET_ARN = var.compliance_reader_secret_arn`.
- Variable is already defined at the lambda-api module level (the anchor Lambda uses it). Composite-root wiring is also already in place from U8a.
- Grant: `secretsmanager:GetSecretValue` on `var.compliance_reader_secret_arn` to the graphql-http Lambda's IAM role. Check if the role already has this grant (it might, if the role is shared) — if not, add an `aws_iam_role_policy` resource scoped to the secret ARN.

**Patterns to follow:**
- `terraform/modules/app/lambda-api/handlers.tf` — the existing anchor Lambda env block at `aws_lambda_function.compliance_anchor` shows the env-var shape.
- `aws_iam_role_policy.anchor_secrets` in `terraform/modules/data/compliance-audit-bucket/main.tf` for the GetSecretValue grant shape (scoped to a specific ARN).

**Test scenarios:**
- *Test expectation: none — pure Terraform plumbing. Verified at `terraform validate` time; runtime verified by U2's resolver test which uses `COMPLIANCE_READER_DATABASE_URL` escape hatch and never touches Secrets Manager in unit-test mode.*

**Verification:**
- `terraform validate` from `terraform/examples/greenfield/` clean.
- `terraform fmt -recursive` applied.
- Post-deploy, `aws lambda get-function-configuration --function-name thinkwork-dev-api-graphql-http --query 'Environment.Variables.COMPLIANCE_READER_SECRET_ARN'` returns the expected ARN.

---

- U4. **(folded into U5)** — Sidebar entry + route file land in the same PR as the events list page. The originally-proposed placeholder ships zero validatable behavior in isolation and creates an extra PR cycle. U5 now creates Sidebar entry + parent route file + index.tsx list page + `events.$eventId.tsx` detail page in one shot.

(legacy U4 content retained below for traceability; do not implement separately)

**Requirements:** R1.

**Dependencies:** U1 (codegen artifacts must exist for the route file to import types — but the route file in U4 is type-light, so this dependency is soft).

**Files:**
- Modify: `apps/admin/src/components/Sidebar.tsx` (add to `manageItems`)
- Create: `apps/admin/src/routes/_authed/_tenant/compliance/index.tsx`
- Create: `apps/admin/src/routes/_authed/_tenant/compliance/route.tsx` (parent layout with `<Outlet />` for the drawer)

**Approach:**
- `manageItems` insertion: `{ to: "/compliance", icon: ScrollText, label: "Compliance" }`. Place between Analytics and People to keep the visual rhythm — operator-facing infra items group near the top of Manage.
- `compliance/route.tsx` is the parent layout that renders the list page and an `<Outlet />` for the nested drawer. This is the standard TanStack Router pattern — see `routines/$routineId_.executions.$executionId.tsx` for a sibling-existing example.
- `compliance/index.tsx` placeholder: a minimal `<PageLayout>` with `<PageHeader title="Compliance" />` and a stub message like "Audit events will appear here." U5 replaces this with the full list page; landing a placeholder first lets the nav + breadcrumb integration ship before list-page complexity.

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/analytics.tsx` for a minimal `_tenant`-scoped page.
- `apps/admin/src/routes/_authed/_tenant/automations/routines/route.tsx` (or similar) for a parent route with `<Outlet />`.

**Test scenarios:**
- Manual visual check: sidebar shows "Compliance" with the ScrollText icon in the Manage group.
- Manual click: navigating to `/compliance` lands on the placeholder page with the breadcrumb "Compliance".
- *Test expectation: none for automated coverage — frontend route tests aren't established for this codebase. The placeholder is non-feature-bearing scaffolding.*

**Verification:**
- `pnpm --filter @thinkwork/admin typecheck` clean.
- Vite dev server renders the route without console errors.

---

- U5. **Sidebar entry + Events list page (filters + pagination)**

**Goal:** Land the Compliance sidebar entry, the parent route file, AND the full events list in one PR: filter bar (tenant_id with name-typeahead for operators / hidden for tenant-scoped users, actor_type, event_type, since/until with a default `since = now - 7d`), table with relative-time + badges + per-row navigation to detail, "Load more" cursor pagination, URL filter params round-trip with `validateSearch` falling back to defaults on malformed values + a non-blocking toast warning.

**Requirements:** R1, R2, R7.

**Dependencies:** U1, U2.

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/compliance/index.tsx` (replace placeholder)
- Create: `apps/admin/src/components/compliance/ComplianceEventsTable.tsx`
- Create: `apps/admin/src/components/compliance/ComplianceFilterBar.tsx`

**Approach:**
- Route uses `validateSearch` (TanStack Router) to parse `?event_type=&actor_type=&tenant_id=&since=&until=` query params. The filter bar is controlled by these params — changing a filter pushes a new URL with updated query params, which re-runs the query.
- `urql` `useQuery` with the `complianceEvents(filter, after, first)` query. Pagination state lives in component state (cursors collected via "Load more"); filter state lives in URL.
- Table columns: `recorded_at` (relative + tooltip absolute), `event_type` (badge), `actor` + `actor_type` (badge), `tenant_id` (admin only — show short hash w/ copy), `event_id` (link → drawer route). Row click → navigate to `/compliance/events/$eventId` (drawer overlay).
- Filter bar: shadcn `Select` for `actor_type` + `event_type`; date inputs for `since` + `until`; admin sees a `tenant_id` typeahead (defer the typeahead UX details to implementation — empty input + manual UUID paste is acceptable for v1 if the typeahead component is heavy).
- Empty state: "No audit events match the current filter." Loading state: shadcn skeleton rows. Error state: render the structured 503 message verbatim ("Compliance event browsing is not available in this environment...").
- "Load more" button at the bottom only appears when `hasNextPage`. Clicking appends the next page to the table (urql cache + manual cursor advance).

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/threads/` (or similar list page) for filter-bar + table layout.
- `apps/admin/src/routes/_authed/_tenant/automations/routines/index.tsx` for cursor pagination wiring.
- shadcn primitives already in use: `Table`, `Select`, `Input`, `Skeleton`, `Badge`.

**Test scenarios:**
- Manual: filter by `event_type: agent.created` → URL becomes `/compliance?event_type=agent.created`; only `agent.created` rows render.
- Manual: refresh the page on `/compliance?event_type=agent.created&since=2026-04-01T00:00:00Z` → filters re-render correctly from URL params.
- Manual: empty result → empty-state message renders.
- Manual: pagination → 50 rows render initially; "Load more" appears; clicking it appends 50 more.
- Manual: click a row → drawer route is active; `/compliance/events/$eventId` URL; drawer overlay shows the event detail.
- Manual: 503 error (env unset) → friendly empty-state with the env-var-name message.
- *Automated: no frontend route tests today; manual smoke is the verification surface for v1.*

**Verification:**
- `pnpm --filter @thinkwork/admin typecheck` clean.
- Manual verification on Vite dev server against deployed dev API: list renders with seeded events, filters round-trip, pagination works.

---

- U6. **Event detail page (flat full-page route, chain position + anchor status + payload)**

**Goal:** Flat full-page route at `/compliance/events/$eventId` (NOT a drawer overlay — the originally-cited Outlet-rendered drawer pattern doesn't exist in this admin SPA; ship a flat detail page matching `routines/$routineId_.executions.$executionId.tsx`'s shape). Renders chain-position panel (`event_hash` + `prev_hash` with copy buttons + clickable prev_hash that navigates via `complianceEventByHash` query), anchor-status panel (Anchored / Pending with `CheckCircle` / `Clock` icons + text), and full event JSON pretty-printed (capped at 256KB inline; "Download full payload" button for larger blobs).

**Requirements:** R3.

**Dependencies:** U2, U5.

**Files:**
- Create: `apps/admin/src/routes/_authed/_tenant/compliance/events.$eventId.tsx`
- Create: `apps/admin/src/components/compliance/ComplianceEventDrawer.tsx`
- Create: `apps/admin/src/components/compliance/ChainPositionPanel.tsx`
- Create: `apps/admin/src/components/compliance/AnchorStatusPanel.tsx`

**Approach:**
- Drawer route file uses TanStack Router file-based routing: `events.$eventId.tsx` becomes the drawer overlay rendered inside `compliance/route.tsx`'s `<Outlet />`.
- The drawer is a shadcn `Sheet` (right-side overlay). Closing it navigates to `/compliance` (preserves filter URL params).
- `urql` `useQuery({ complianceEvent: eventId })` fetches the event detail.
- Three sections in the drawer: 
  1. **Header:** event_type badge + actor + recorded_at relative; primary close button.
  2. **Chain position panel:** displays `event_hash` (full 64-char hex, monospace, copy button) and `prev_hash` (same shape, with "GENESIS" label when null). Adjacent caption: "This event is the Nth in tenant X's chain, written by source Y." (N is computed by the resolver if cheap; defer to implementation if not — the basic event_hash + prev_hash + source line is the minimum.)
  3. **Anchor status panel:** "Anchored" badge (green) with `cadence_id` (link/copy) + `anchored_recorded_at` (relative time) when `Anchored`; "Pending" badge (amber) with "Next cadence within 15 min" when `Pending`. Subtitle explains: "Anchored events are part of the cryptographic Merkle root in S3 (Object Lock-protected, 365-day retention)."
  4. **Full payload:** pretty-printed JSON, syntax-highlighted (use the existing JSON-viewer component if there is one; else `<pre>` with mono font + copy-all button).

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId_.executions.$executionId.tsx` for the drawer-as-route pattern.
- shadcn `Sheet`, `Badge`, `Card`.
- Existing JSON viewer component (grep `apps/admin/src/components` for `JSON` / `prism`); fall back to `<pre>` if none exists.

**Test scenarios:**
- Manual: click a row in the list → drawer opens with that event's detail; URL updates to `/compliance/events/<eventId>`.
- Manual: refresh on `/compliance/events/<eventId>` → drawer renders with same content; list page is mounted underneath.
- Manual: browser back → drawer closes; URL becomes `/compliance` (with filter params preserved).
- Manual: event with `prev_hash: null` → "GENESIS" label renders.
- Manual: event with `recorded_at <= tenant_anchor_state.last_anchored_recorded_at` → green "Anchored" badge with cadence_id.
- Manual: event with `recorded_at > tenant_anchor_state.last_anchored_recorded_at` → amber "Pending" badge.
- Manual: copy buttons on event_hash + prev_hash + cadence_id work (paste-roundtrip in browser console).
- Manual: drawer for non-existent event_id → 404-style empty state ("Event not found or not visible to your tenant scope").

**Verification:**
- `pnpm --filter @thinkwork/admin typecheck` clean.
- Manual verification on Vite dev server: row click → drawer; refresh; back; copy.

---

- U7. **(dropped)** — The originally-proposed deploy-time smoke gate cited an `ADMIN_API_TOKEN` GHA secret + a `compliance-anchor-smoke` GHA job that don't exist. The premise was false. For an authz-critical surface the value-add of a smoke gate would be exercising the cross-tenant boundary against the live Lambda (not just admin-token shape assertion); that's a meaningful follow-up after a real Cognito machine-identity strategy lands. For U10, the U2 integration tests + `pnpm -r typecheck && pnpm -r test` clean pass + manual verification against the deployed dev API are sufficient. If a deploy-time check is wanted later, fold a single `complianceEvents(first: 1)` assertion into an existing smoke script rather than adding a new GHA job + secret.

(legacy U7 content retained below for traceability; do not implement separately)

**Requirements:** R4, R5, R6.

**Dependencies:** U2, U3, U5, U6.

**Files:**
- Create: `packages/api/src/__smoke__/compliance-events-smoke.ts`
- Modify: `.github/workflows/deploy.yml` (new `compliance-events-smoke` job after `terraform-apply`)
- Modify: `scripts/build-lambdas.sh` (no change expected — the smoke calls the deployed graphql-http endpoint, not its own bundled handler)

**Approach:**
- Smoke script: HTTP POST to the deployed graphql-http URL with the `complianceEvents` query (`first: 1`, no filter). Asserts the response is shaped `{ data: { complianceEvents: { edges: [...], pageInfo: {...} } } }` — at least one edge in dev (events have been emitted since U5/U6 shipped). On empty bucket / fresh-deploy, accept `edges: []` and log a warning, don't fail.
- Auth: smoke uses an admin-tier API token (the same token the existing `compliance-anchor-smoke` uses). Document in the GHA job: needs `ADMIN_API_TOKEN` secret.
- GHA job: depends on `terraform-apply` like the anchor smoke. Same `aws-actions/configure-aws-credentials` + node setup pattern.

**Patterns to follow:**
- `packages/api/src/__smoke__/compliance-anchor-smoke.ts` for the dispatch + JSON-shape assertion pattern.
- `.github/workflows/deploy.yml` `compliance-anchor-smoke` job for GHA shape.

**Test scenarios:**
- Happy path: smoke against dev returns ≥0 edges with correct shape, exits 0.
- Edge case: empty result → log + exit 0 (empty is acceptable on fresh-deploy).
- Error path: 401 from auth → exit 2 (token misconfigured).
- Error path: 5xx from server → exit 2.

**Verification:**
- Smoke runs locally against dev's graphql-http URL with admin token.
- GHA workflow shows a green `compliance-events-smoke` job after `terraform-apply` on the merge-to-main run.
- `pnpm -r typecheck && pnpm -r test` clean repo-wide.

---

## System-Wide Impact

- **Interaction graph:** Two new GraphQL queries land in graphql-http Lambda's resolver tree. They use a NEW lazy pg pool keyed off `COMPLIANCE_READER_SECRET_ARN` — the existing `graphql_db_secret_arn` pool, used by every other resolver, is untouched. Frontend: new sidebar entry, new route file, new components — no shared-component changes.
- **Error propagation:** Resolver errors surface as structured GraphQL errors (not stack traces). Connection errors invalidate the cached pg client per `compliance-anchor.ts:298-302` pattern. UI renders the structured 503 message in the empty-state when `COMPLIANCE_READER_SECRET_ARN` is unset.
- **State lifecycle risks:** None — read-only queries with no caching state to invalidate. urql cache handles list invalidation when filter URL params change.
- **API surface parity:** GraphQL is the only API surface that gets compliance read access. No REST endpoint, no AppSync subscription. Mobile + CLI codegen runs but neither client uses the new types in v1.
- **Integration coverage:** Cross-tenant leakage is the highest-stakes integration. U2's dedicated leakage test exercises the auth boundary against both admin and tenant-scoped + Google-OAuth (null `ctx.auth.tenantId`) scenarios.
- **Unchanged invariants:** No changes to `compliance.audit_events` schema, no changes to the writer Lambda (compliance-outbox-drainer / compliance-events handler / compliance-anchor), no changes to the U7 bucket or U8b retention contract, no changes to existing GraphQL resolvers' DB pool. The verifier (U9) is also unaffected — it reads from S3, not GraphQL.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Cross-tenant leakage via the resolver — non-admin user sees another tenant's events. | Resolver overrides `args.filter.tenantId` to `resolveCallerTenantId(ctx)` for non-admins; dedicated leakage test in U2 covers both null-tenant Google OAuth and explicit-tenant filter-spoof scenarios. |
| `COMPLIANCE_READER_SECRET_ARN` unset on graphql-http Lambda → resolver throws on first call. | Structured 503 with the env-var name in the message; UI renders it as a friendly empty-state. U3 wires the Terraform plumbing so dev/prod always have it set. |
| Connection-pool exhaustion: graphql-http already runs a pg pool against `graphql_db_secret_arn`; adding a second pool doubles per-Lambda connections. | Lazy at module load + warm-Lambda cache reuse; only resolvers in this PR open the second pool. Default pool size 1 connection (single-shot per Lambda invocation). Re-evaluate if a future pattern adds a third pool. |
| Cursor instability: equal-microsecond timestamps across two events. | Cursor encodes `(recorded_at, event_id)` tuple; SQL ORDER BY uses both columns. Test scenario in U2 pins this. |
| Existence-oracle attack: non-admin guesses an event_id from another tenant; resolver leaks "exists" via 403 vs 404. | `complianceEvent` returns null (not 403) for any event the caller can't see. Standard authz-without-leak pattern. |
| Vite dev server port conflict with another running admin instance — Cognito callback rejection. | Run dev on the main port (5174). If a concurrent admin is already on 5174, use 5175 and add it to `ThinkworkAdmin` CallbackURLs per `project_admin_worktree_cognito_callbacks`. |
| Codegen drift: `pnpm schema:build` regen runs in U1 but downstream codegen forgotten in cli/mobile. | Verification in U1 explicitly runs codegen in admin + api + cli + mobile. Repo-wide `pnpm -r typecheck` catches missed regen. |
| Anchor-status simplification: showing `last_anchored_recorded_at` instead of the exact cadence that anchored a specific event may confuse auditors expecting per-event Merkle proof. | The drawer's anchor-status panel subtitle explains the boundary. The forensic per-event proof is U10+ scope; deferred-to-follow-up section names it. |

---

## Documentation / Operational Notes

- **`apps/admin/README.md`** (or component README, depending on project convention): note the new `/compliance` route + that it requires `COMPLIANCE_READER_SECRET_ARN` on the graphql-http Lambda.
- **Operator runbook for the SOC2 walkthrough**: a brief markdown at `docs/runbooks/compliance-walkthrough.md` documenting "Where to point the auditor" — sidebar → Compliance → filter by date → click a representative event → show chain position + anchor status. Optional but high-value; the master plan's Documentation Plan section asks for it.
- **No migrations** — `compliance.audit_events` schema and indices already exist from U1.
- **No new infrastructure** beyond the Terraform env-var addition in U3.

---

## Sources & References

- **Origin master plan:** `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md` (U10 entry, lines ~615-660).
- **Predecessor units:**
  - U1 schema: `packages/database-pg/src/schema/compliance.ts`
  - U4 drainer: `packages/lambda/compliance-outbox-drainer.ts`
  - U5 emit slate: `packages/api/src/lib/compliance/emit.ts`
  - U7 anchor bucket: `terraform/modules/data/compliance-audit-bucket/`
  - U8b live anchor: `packages/lambda/compliance-anchor.ts`
  - U9 verifier: `packages/audit-verifier/`
- **Related resolver patterns:**
  - `packages/api/src/graphql/resolvers/agents/`
  - `packages/api/src/graphql/resolvers/connectors/query.ts`
  - `packages/api/src/graphql/resolvers/core/authz.ts`
- **Related admin patterns:**
  - `apps/admin/src/components/Sidebar.tsx` (manageItems)
  - `apps/admin/src/routes/_authed/_tenant.tsx` (parent layout)
  - `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId_.executions.$executionId.tsx` (drawer-as-route)
- **Lazy DB pattern:** `packages/lambda/compliance-anchor.ts:264-321`.
