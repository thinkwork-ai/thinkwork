---
title: U10 frontend — admin SPA Compliance section (sidebar + list + detail)
type: feat
status: active
date: 2026-05-07
origin: docs/plans/2026-05-07-014-feat-compliance-u10-admin-events-plan.md
---

# U10 frontend — admin SPA Compliance section (sidebar + list + detail)

## Summary

Build the operator-facing surface that consumes the `complianceEvents` / `complianceEvent` / `complianceEventByHash` GraphQL contract merged in PR #937 (4f5df0ab): a "Compliance" entry in the admin sidebar's Manage group, an Events list page at `/compliance` with cursor pagination + filter bar, and a flat full-page detail at `/compliance/events/$eventId` showing chain position + anchor status + JSON payload. Adds one tiny backend addition (`complianceTenants` query) so the operator's tenant filter is a real typeahead, not a UUID paste.

---

## Problem Frame

The U10 backend (#937, merged 2026-05-07) shipped the GraphQL read API + reader role + auth scoping inert. Today an operator can't actually browse the WORM-locked audit log — there's no UI. A SOC2 walkthrough demo would require an operator hand-running GraphQL queries in a console. This plan ships the admin SPA surface that closes that loop and turns the compliance substrate into something an auditor can be walked through.

---

## Requirements

- R1. New "Compliance" entry in `apps/admin/src/components/Sidebar.tsx`'s `manageItems` array, **placed adjacent to Settings** (Compliance is an audit/infrastructure control, not a metrics tool — should not sit beside Analytics). Icon: `ScrollText` from lucide-react. Label: "Compliance".
- R2. Parent route at `/compliance` rendering an Events list page with cursor pagination ("Load more" button), default filter `since = now - 7d`, table columns: relative-time + event_type badge + actor + actor_type badge + tenant_id (operators only — short hash + copy) + event_id (link → detail page). Default page size 50. Empty states differentiated: "No audit events match the current filter" vs "No audit events have been recorded yet" (fresh deploy, no filter active).
- R3. Filter bar exposing: tenant_id (operators only — typeahead via the new `complianceTenants` query, NOT UUID-paste), actor_type, event_type, since/until (ISO8601 inputs). Filter values round-trip through URL search params via TanStack Router's `validateSearch`. Malformed values coerce to undefined and trigger a non-blocking toast: "One or more URL filters were invalid and have been cleared." Don't 404.
- R4. Flat full-page detail route at `/compliance/events/$eventId` (NOT a drawer overlay — the cited drawer-via-Outlet pattern doesn't exist in this admin SPA; mirror the flat-page shape in `routines/$routineId_.executions.$executionId.tsx`). Header + back-to-list nav. Three panels: chain position, anchor status, JSON payload.
- R5. Chain-position panel: event_hash + prev_hash with copy buttons (icon-swap-1500ms `CopyableRow` pattern from `apps/admin/src/routes/_authed/_tenant/settings.tsx`). prev_hash is **clickable** — fires `complianceEventByHash` query and navigates to `/compliance/events/$resolvedEventId` on success. On null result (chain genesis or scope-restricted), surface a toast "Previous event not visible to your tenant scope" and stay on the current page. prev_hash null (genesis) renders "GENESIS" label, no link.
- R6. Anchor-status panel: badges with icon + text (NOT color alone — accessibility). ANCHORED renders green Badge with `CheckCircle` icon + cadenceId (copy button) + relative-time of `anchoredRecordedAt`. PENDING renders amber Badge with `Clock` icon + "Anchored on next cadence — within 15 minutes". Subtitle copy is operator-facing, not spec-pasted: "This event is part of an immutable audit record — tamper-evident and retained for 365 days."
- R7. JSON payload section: pretty-printed via `JSON.stringify(payload, null, 2)` inside a ScrollArea (`flex-1 min-h-0` per `apps/admin/src/components/threads/ThreadDetailSheet.tsx:113`'s pattern) so the payload scrolls independently of the page header. **256KB inline cap**: if `JSON.stringify(payload).length > 262144`, render the first 1KB as preview + a "Download full payload" button that triggers a browser download of the full JSON. Avoids browser tab-freeze on multi-MB governance file diffs.
- R8. Operator detection + indicator: when `THINKWORK_PLATFORM_OPERATOR_EMAILS` includes the caller's email, the filter bar shows a "Cross-tenant view" badge prominently positioned ABOVE the filter row (not buried inside it — design-lens finding), and the tenant_id filter is visible. Non-operators don't see the tenant_id filter at all. Operator detection happens via a NEW top-level Query field `complianceOperatorCheck: ComplianceOperatorCheckResult!` returning `{ isOperator: Boolean!, allowlistConfigured: Boolean! }` — mirrors the existing `adminRoleCheck` query pattern, AVOIDS attaching a caller-dependent field to the `User` GraphQL type (ADV-001 finding), and exposes a `allowlistConfigured` field so dev-environment misconfiguration produces a distinct UI state ("Compliance operator allowlist not configured for this environment") rather than silently flipping to non-operator UI (ADV-005 finding).
- R9. New backend query `complianceTenants: [ID!]!` returning DISTINCT tenant_id from `compliance.audit_events`, scoped via the same `requireComplianceReader` auth (apikey hard-block + operator-only — non-operators receive a 1-element list of their own tenant). Adds the operator's typeahead source and resolves R3's "tenant typeahead REQUIRED" guard without forcing UUID-paste UX.
- R10. Loading state: 5 skeleton rows on first load (NOT centered spinner). Establishes a new pattern for table-with-rows pages; existing `PageSkeleton` usage stays untouched. Comment in code explaining the deliberate divergence.
- R11. Codegen: this PR adds `gql\`...\`` documents in admin source files that trigger `pnpm --filter @thinkwork/admin codegen`. Verify the resulting `src/gql/` artifacts compile against the merged backend types.

**Origin requirements** (from U10 backend plan's "What's deferred to the U10 frontend PR" section + the corrected-via-ce-doc-review guards #1, #2, #4, #7, #8, #11, #12, #13, #14): R1–R11 carry every named element forward.

---

## Scope Boundaries

- **Aggregate dashboard** (counts per event_type / actor_type / day) — no `complianceEventCounts` query exists; deferred to U10 v2.
- **Verification status panel** — depends on a daily-verifier scheduled Lambda not yet built; deferred to a separate plan.
- **AppSync subscriptions / real-time counters** — backend deliberately read-only; no live updates in v1.
- **CSV / NDJSON export from the list page** — that's U11's async export job, not this PR.
- **Mobile compliance browse** — admin-tier only per the CLAUDE.md guardrail.
- **Drawer-overlay UX** — the originally-cited Outlet-based drawer pattern doesn't exist in this admin SPA; ship a flat detail page instead, revisit drawer-overlay in a follow-up if operators need it.
- **Forensic per-event Merkle proof generation** — needs the U9 verifier embedded as a Lambda; not in this PR.

### Deferred to Follow-Up Work

- **Aggregate dashboard with `complianceEventCounts` resolver** — a single `GROUP BY event_type / actor_type / day` query + chart card. Cheap follow-up if v1 telemetry surfaces a need.
- **Daily verifier scheduled Lambda + Verification status panel** — wires `@thinkwork/audit-verifier` (U9) into a daily run, surfaces results to a new admin panel. Separate plan.
- **Forensic per-event Merkle proof "Generate proof" button** — invokes the verifier as a Lambda (single S3 GET per drawer-open). Closes the gap between "Anchored" badge and byte-level proof for SOC2 walkthroughs.

---

## Context & Research

### Relevant Code and Patterns

- **Sidebar:** `apps/admin/src/components/Sidebar.tsx` — `manageItems` array around line 249; existing entries Analytics / People / Billing(owner) / Settings.
- **Tenant layout:** `apps/admin/src/routes/_authed/_tenant.tsx` — parent layout. New routes nest under `_authed/_tenant/compliance/`.
- **Flat detail-page reference:** `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId_.executions.$executionId.tsx` — flat full-page detail with PageHeader + back navigation. The shape U6 mirrors.
- **List-page + filter pattern:** `apps/admin/src/routes/_authed/_tenant/automations/routines/index.tsx` (or similar list page) — cursor pagination + filter shape. 16 routes use `validateSearch` for URL params (per the U10 backend ce-doc-review feasibility F10 confirm); pick the closest sibling.
- **Copy buttons:** `apps/admin/src/routes/_authed/_tenant/settings.tsx` lines 131-167 — `CopyableRow` is a NON-EXPORTED inline function (not importable). The compliance components either (a) extract `CopyableRow` to `apps/admin/src/components/ui/copyable-row.tsx` and update settings.tsx to import from there, or (b) re-implement the same shape inline. Recommend (a) since the chain-position panel needs an enhanced variant supporting an `onClick` callback (for prev_hash navigation) — extracting now lets settings.tsx and compliance share the base.
- **ScrollArea wrapping:** `apps/admin/src/components/threads/ThreadDetailSheet.tsx:113` — `flex-1 min-h-0` ScrollArea so payload sections scroll independently of page chrome.
- **GraphQL types:** `packages/database-pg/graphql/types/compliance.graphql` (merged in #937). The `gql\`...\`` queries this PR adds will be picked up by admin codegen via `documents: "src/**/*.{ts,tsx}"` in `apps/admin/codegen.ts`.
- **Auth context (admin):** `apps/admin/src/context/AuthContext.tsx` — exposes `useAuth()` with current user info; the operator-detection probe wires through here.
- **Backend resolver auth helper:** `packages/api/src/lib/compliance/resolver-auth.ts` — `requireComplianceReader` + `isPlatformOperator` (already exported); the new `complianceTenants` resolver reuses both.
- **Backend resolver pattern:** `packages/api/src/graphql/resolvers/compliance/query.ts` — model for the new `complianceTenants` resolver shape.

### Institutional Learnings

- **`feedback_oauth_tenant_resolver`** — Google-OAuth users may have null `ctx.auth.tenantId`; the backend already handles this via `resolveCallerTenantId`. Frontend doesn't need to re-handle; operator-detection probe should not assume tenantId is non-null.
- **`feedback_user_opt_in_over_admin_config`** — Compliance is admin-tier; sidebar placement is correct. Does NOT belong in mobile.
- **`feedback_pnpm_in_workspace`** — every `pnpm` invocation uses pnpm, never npm.
- **`project_admin_worktree_cognito_callbacks`** — concurrent admin vite ports must be in `ThinkworkAdmin` CallbackURLs to avoid Google-OAuth `redirect_mismatch`. If user runs the dev server on 5174 (default), no callback URL update needed; 5175+ requires Cognito update.
- **`feedback_smoke_pin_dispatch_status_in_response`** — N/A here (read-only browse, no dispatch); but when this surface gets a future "Generate proof" button, the dispatch-pin pattern applies.
- **`project_system_workflows_revert_compliance_reframe`** — Phase 3 progress: 10.5/11 units after #937. This PR completes U10.

### External References

- TanStack Router `validateSearch` + nested-route pattern (already established; no external research needed).
- urql `useQuery` cursor-pagination cache hooks (already in use across the admin SPA).
- Tenant typeahead component: shadcn `Combobox` recipe is NOT pre-built in this admin SPA (verified — no `apps/admin/src/components/ui/combobox.tsx`). Implementer composes one from existing `command.tsx` + `popover.tsx` primitives following the shadcn Combobox recipe pattern. `multi-select.tsx` is a closer existing reference for the wiring shape (single-select Combobox = `<Popover>` + `<PopoverTrigger>` button + `<PopoverContent>` containing `<Command>` with `<CommandInput>` + `<CommandList>` + `<CommandItem>` per option). Fallback `<input list>+<datalist>` is rejected — at 100+ tenants the native datalist UX degrades and contradicts the "no UUID-paste" requirement.

---

## Key Technical Decisions

- **Operator detection: new top-level `complianceOperatorCheck` query, NOT a `me.isComplianceOperator` field.** Attaching the field to the `User` type leaks caller-dependent semantics across every other `User`-returning query (tenantMembers, agent owners, etc.) — a future selection of `tenantMembers { isComplianceOperator }` would return TRUE for every member when the caller is an operator, FALSE otherwise. The top-level query mirrors the existing `adminRoleCheck.query.ts` pattern, returns `{ isOperator, allowlistConfigured }` so the dev-env-misconfigured case has a distinct UI state, and there is exactly ONE consumer (the compliance page) so type-leakage is impossible. Single import of `isPlatformOperator` from `packages/api/src/lib/compliance/resolver-auth.ts` (do NOT re-implement; the `updateTenantPolicy.mutation.ts:195` independent copy is a known divergence the U10 frontend PR does not regress).
- **Tenant typeahead source: NEW `complianceTenants` GraphQL query** returning DISTINCT tenant_id from `compliance.audit_events`. Reuses the merged `requireComplianceReader` auth gate; non-operators get a 1-element list (their own tenant); operators get the full distinct set. SQL: `SELECT DISTINCT tenant_id::text FROM compliance.audit_events ORDER BY tenant_id ASC`. Single query result fits in browser memory at any plausible tenant count (4 enterprises × N sub-tenants ≪ thousands).
- **Detail page is a FLAT full-page route, not a drawer overlay.** The originally-cited drawer-via-Outlet pattern doesn't exist; designing layout-route + scroll-preservation + drawer-mount-survival from scratch is out of scope for this PR. Mirror `routines/$routineId_.executions.$executionId.tsx`'s shape.
- **`since` default uses a `range` marker, not a derived ISO timestamp.** Computing `since = (Date.now() - 7d).toISOString()` inside `validateSearch` rewrites the URL on every cold load (cache miss + URL mutation surprise) AND breaks the empty-state heuristic (an explicit "Last 7 days" preset is indistinguishable from the default). Instead: leave `since` undefined in the URL when the user hasn't picked a window; surface `?range=7d` as a marker (or no query param at all → resolver applies the 7d window). The list resolver supplies the default if both `since` and `range` are absent; explicit `?since=<iso>` always wins. Empty-state heuristic distinguishes "no filter" (no range, no since, no until, no eventType, no actorType, no tenantId) from "default 7d range with zero results."
- **`validateSearch` falls back to undefined + toast on malformed values**, not to defaults + silence. Auditors pasting URLs will get a visible signal that their input was rejected; defaults-without-warning is the silent-failure mode the plan explicitly rejects.
- **Skeleton rows for loading, NOT centered spinner.** Establishes a new pattern; the table-with-rows shape benefits from skeleton rows (LCP + perceived performance), and the existing `PageSkeleton` (centered spinner) is for full-page loads that don't have an obvious row shape. Inline comment documents the deliberate divergence so future readers understand both patterns coexist.
- **prev_hash click-through with toast on null**: the chain-position click is the primary "trust signal" during a SOC2 walkthrough. Failing silently when `complianceEventByHash` returns null would erode trust. The toast ("Previous event not visible to your tenant scope") explains the boundary explicitly.
- **Operator badge in filter bar**: when an operator is browsing cross-tenant, surface a "Cross-tenant view" indicator. Without it, an operator could screenshot for an external auditor and inadvertently include another tenant's PII. Cheap copy-paste defense.
- **Sidebar placement adjacent to Settings, not Analytics.** Compliance is an infrastructure/audit control, not a metrics surface. Placing it next to Analytics conflates retrospective metrics with evidence-of-control.
- **256KB inline cap with byte-precise check**: `JSON.stringify(payload, null, 2).length` is a tight upper bound on render cost. `262144` byte threshold matches the `--check-retention` retention/perf math from U9. Below 256KB renders inline; above renders preview + Download. The Download button creates a `Blob` from the full JSON and uses an anchor with `download` attribute — no server round-trip.
- **Today's date: 2026-05-07** — used for `since = now - 7d` test fixtures so they're visually anchored.
- **No mobile / CLI codegen regen.** The api package's compliance types already exist (from #937). Admin codegen runs in this PR; mobile + CLI don't consume compliance types.

---

## Open Questions

### Resolved During Planning

- **Where does the tenant typeahead get its source list?** Resolved — new `complianceTenants` GraphQL query in this PR (additive on the merged reader-db pool; ~30 lines of resolver code). Honors the "tenant typeahead REQUIRED" guard without forcing UUID-paste UX.
- **How does the frontend know whether the user is an operator?** Resolved — extend the existing `me` query (or equivalent) with an `isComplianceOperator: Boolean!` field that delegates to the backend's `isPlatformOperator` helper. Single round-trip, no probe race.
- **Drawer overlay or flat detail page?** Resolved — flat page (the cited drawer-via-Outlet pattern doesn't exist; designing it from scratch is out of scope).
- **Default time window?** Resolved — `since = now - 7d`, applied in `validateSearch` parser. Auditor presets ("Q1 2026", "Last 30 days") can hang off this in a follow-up.
- **Skeleton vs spinner?** Resolved — 5 skeleton rows for the table; spinner stays for full-page navigations elsewhere.
- **Chain-position prev_hash UX?** Resolved — clickable, resolves via `complianceEventByHash`, toast on null. NOT a copy-only hex dead-end.

### Deferred to Implementation

- **Exact admin auth-context shape for the operator field** — implementer reads `apps/admin/src/context/AuthContext.tsx` and picks whether to (a) add `isComplianceOperator` to the existing `me` query result + plumb through context, (b) add a separate `useComplianceOperator()` hook, or (c) attach it to the existing user object's metadata. Whichever fits the established pattern; the visible behavior is the same.
- **Exact tenant-typeahead component** — shadcn `Combobox` is the default; if it isn't already in use, fall back to a styled `<input list>` with a `<datalist>` of tenant_ids. Either is acceptable; the user requirement is "no UUID-paste fallback."
- **JSON viewer styling** — pretty-printed inside `<pre>` with mono font is the minimum. If a richer JSON viewer (collapsible nodes) is already present in the admin codebase, reuse it; if not, the `<pre>` works for v1.
- **Date input component** — implementer picks. shadcn `DatePicker`, raw `<input type="datetime-local">`, or whatever's used elsewhere.
- **Copy-button toast placement** — `sonner` is installed; either inline icon-swap (matching `CopyableRow`) or a top-right toast. CopyableRow pattern is the explicit recommendation.

---

## Output Structure

This PR modifies `apps/admin` extensively + adds one small backend resolver. New files:

    apps/admin/src/routes/_authed/_tenant/compliance/
    ├── route.tsx                       # parent route (Outlet for nested children, breadcrumb)
    ├── index.tsx                       # /compliance — Events list page
    └── events.$eventId.tsx             # /compliance/events/$eventId — flat detail page
    apps/admin/src/components/compliance/
    ├── ComplianceFilterBar.tsx         # tenant typeahead + actor/event-type/since/until
    ├── ComplianceEventsTable.tsx       # table + skeleton rows + Load More
    ├── ChainPositionPanel.tsx          # event_hash + prev_hash + clickable chain navigation
    ├── AnchorStatusPanel.tsx           # ANCHORED/PENDING badge + cadenceId
    └── PayloadSection.tsx              # JSON pretty-print + 256KB cap + download
    apps/admin/src/lib/compliance/
    └── url-search-params.ts            # validateSearch with default-since-7d + malformed fallback
    packages/api/src/graphql/resolvers/compliance/
    └── tenantsList.query.ts            # NEW backend resolver: complianceTenants
    packages/database-pg/graphql/types/compliance.graphql  # MODIFIED: add complianceTenants + me.isComplianceOperator field
    packages/api/src/graphql/resolvers/core/me.query.ts    # MODIFIED: add isComplianceOperator field

---

## Implementation Units

- U1. **Backend extensions: `complianceTenants` query + `me.isComplianceOperator` field**

**Goal:** Land the two small backend additions the frontend depends on. Single-purpose backend changes that unblock U2/U3/U4.

**Requirements:** R8, R9.

**Dependencies:** None (#937 backend already merged).

**Files:**
- Modify: `packages/database-pg/graphql/types/compliance.graphql` (add `complianceTenants: [ID!]!` query field; the `me { isComplianceOperator }` field lands in `core.graphql` instead since `me` lives there)
- Modify: `packages/database-pg/graphql/types/core.graphql` (add `isComplianceOperator: Boolean!` to the `Me` type — find the existing `me` query result type)
- Create: `packages/api/src/graphql/resolvers/compliance/tenantsList.query.ts` (resolver: `requireComplianceReader` then `SELECT DISTINCT tenant_id::text FROM compliance.audit_events ORDER BY tenant_id ASC`; non-operators get just `[callerTenantId]`)
- Modify: `packages/api/src/graphql/resolvers/compliance/index.ts` (export the new resolver)
- Modify: `packages/api/src/graphql/resolvers/index.ts` (register `complianceTenants`)
- Modify: `packages/api/src/graphql/resolvers/core/me.query.ts` (add `isComplianceOperator` resolution via `isPlatformOperator(ctx)` from the merged `resolver-auth.ts` module)
- Test: `packages/api/src/__tests__/compliance-tenants-list.test.ts` (new): 4 scenarios — operator returns full list; non-operator returns 1-element list with own tenantId; apikey FORBIDDEN; null-tenant non-operator UNAUTHENTICATED.

**Approach:**
- Reuse the existing `getComplianceReaderClient()` lazy pg client.
- For non-operators, short-circuit and return `[effectiveTenantId]` without hitting the DB (saves a query for the common case where the user can only see one tenant).
- `me.isComplianceOperator` resolver imports `isPlatformOperator` from `packages/api/src/lib/compliance/resolver-auth.ts` (already exported). One-line resolver.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/compliance/query.ts` — auth pre-check shape + lazy DB client + parameterized SQL.
- `packages/api/src/graphql/resolvers/core/adminRoleCheck.query.ts` — `me`-style derived-field resolver shape.

**Test scenarios:**
- Happy path: operator caller (email matches `THINKWORK_PLATFORM_OPERATOR_EMAILS`) → returns 4-element array of distinct tenant_ids from a seeded mock pg.
- Happy path: non-operator caller → returns 1-element array `[callerTenantId]` without hitting pg.query (assert via `vi.fn` that the SQL was NOT called).
- Error path: apikey caller → throws FORBIDDEN.
- Error path: non-operator + `resolveCallerTenantId` returns null → throws UNAUTHENTICATED.
- Happy path: `me.isComplianceOperator` returns `true` for operator email, `false` for non-operator (snapshot test against `isPlatformOperator`).

**Verification:**
- `pnpm --filter @thinkwork/api typecheck` clean.
- `pnpm --filter @thinkwork/api test -- --run compliance-tenants` 4/4 pass + drift snapshot still passes.
- `pnpm schema:build` regenerates `terraform/schema.graphql` with no compliance type additions (the new types are Query-only).

---

- U2. **Sidebar entry + parent route + GraphQL documents + admin codegen**

**Goal:** Land the sidebar entry, the parent compliance route, the `gql\`...\`` document declarations for all 4 queries (`complianceEvents`, `complianceEvent`, `complianceEventByHash`, `complianceTenants`), and run admin codegen so subsequent units can `import { ... } from "@/gql"` cleanly.

**Requirements:** R1, R11.

**Dependencies:** U1 (backend types must exist before admin codegen produces typed query results).

**Files:**
- Modify: `apps/admin/src/components/Sidebar.tsx` (insert `{ to: "/compliance", icon: ScrollText, label: "Compliance" }` AFTER Settings in `manageItems`)
- Create: `apps/admin/src/routes/_authed/_tenant/compliance/route.tsx` (parent route with breadcrumb + `<Outlet />`)
- Create: `apps/admin/src/lib/compliance/queries.ts` (4 `gql\`...\`` documents)
- Create: `apps/admin/src/routes/_authed/_tenant/compliance/index.tsx` (placeholder list page — empty table; U3 fills it in)
- Modify: `apps/admin/src/gql/` codegen artifacts (auto-generated; don't hand-edit)

**Approach:**
- Sidebar insert is a 1-line addition. ScrollText is a lucide-react icon NOT currently used in admin (verified via grep — fresh icon, not a "already used elsewhere" reuse). lucide-react is in apps/admin/package.json so the import resolves cleanly.
- The 4 `gql\`...\`` documents land in `lib/compliance/queries.ts` so subsequent units import them by name. Codegen produces typed `useQuery` hooks via the urql `client` preset (see `apps/admin/codegen.ts`).
- The placeholder index.tsx contains just a `<PageHeader title="Compliance" />` and a "List landing in U3" note. Keeps codegen happy on first run when the gql documents exist but components don't yet reference them all.

**Patterns to follow:**
- `apps/admin/src/components/Sidebar.tsx:240-256` — manageItems shape.
- `apps/admin/src/routes/_authed/_tenant/automations/routines/route.tsx` (or sibling) — parent route with `<Outlet />`.
- `apps/admin/src/lib/graphql-queries.ts` (or similar) — existing gql document organization pattern.

**Test scenarios:**
- *Test expectation: none — pure scaffolding. Unit-test of components lands in U3/U4 with the actual UI.*

**Verification:**
- `pnpm --filter @thinkwork/admin codegen` produces typed query results in `apps/admin/src/gql/`.
- `pnpm --filter @thinkwork/admin typecheck` clean.
- Vite dev server renders `/compliance` with placeholder + sidebar nav working.
- Manual: clicking "Compliance" in the sidebar lands on the placeholder; refresh keeps the route.

---

- U3. **Events list page + filter bar + URL params + skeleton rows + pagination**

**Goal:** Build the events list page at `/compliance` with the full filter bar, URL-driven filter state via `validateSearch`, default `since = now - 7d`, "Load more" cursor pagination, skeleton-row loading state, and differentiated empty states.

**Requirements:** R2, R3, R8 (operator badge), R10, R11.

**Dependencies:** U2 (codegen artifacts + parent route).

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/compliance/index.tsx` (replace placeholder with full list page)
- Create: `apps/admin/src/components/compliance/ComplianceFilterBar.tsx`
- Create: `apps/admin/src/components/compliance/ComplianceEventsTable.tsx`
- Create: `apps/admin/src/lib/compliance/url-search-params.ts` (validateSearch with default-since-7d + malformed fallback + toast)

**Approach:**
- `validateSearch` parses `?tenantId=&actorType=&eventType=&since=&until=&cursor=` query params. Invalid ISO8601 dates / unrecognized enum values → coerce to undefined + queue a toast on next render. Default `since = (Date.now() - 7 * 24 * 3600 * 1000).toISOString()` if absent.
- `useQuery` with the `complianceEvents` query keyed off the parsed search args. Filter inputs change → router `navigate()` updates URL query params → query auto-refetches. Cursor pagination accumulates pages in component state; "Load more" button advances the cursor.
- Operator badge: read `me.isComplianceOperator` from a top-level `useMe()` hook (or equivalent) and conditionally render the "Cross-tenant view" badge + the tenant_id filter dropdown. Non-operators don't see the tenant filter at all.
- Tenant typeahead: shadcn `Combobox` populated from `complianceTenants` query result. Only fires when operator status confirmed.
- Empty states: if `edges.length === 0`, check whether any filter is active (truthy values in search args excluding the default `since`). Active filter → "No audit events match the current filter." No active filter → "No audit events have been recorded yet. Events will appear here as the system records them."
- Skeleton rows: 5 rows in `<Table>` using shadcn `<Skeleton>` for each column. Documented inline why this differs from the existing `PageSkeleton` spinner pattern.

**Patterns to follow:**
- `validateSearch` is established in the admin SPA (16 routes use it: memory/index.tsx, threads/$threadId.tsx, computers/$computerId.tsx, etc. — verified via grep). HOWEVER, **cursor pagination is NOT established** anywhere in admin — `automations/routines/index.tsx` does NOT paginate; the only `loadMore`/`fetchMore` hit across the routes tree is in `symphony.tsx` (unrelated). This unit ESTABLISHES the cursor-pagination pattern. urql doesn't have a built-in `fetchMore`; cursor accumulation is hand-coded via `useState<string[]>` (accumulated cursors) + manual concat of edges + reset on filter change. **Cursor must persist in URL**, not just component state — back-from-detail-page (operator at row 150 → opens event → back) preserves the URL but unmounts component state, which would reset list to page 1. Use `?cursor=` URL param (with `validateSearch` decoding it back into the accumulated state on mount) so back-navigation preserves position.
- `apps/admin/src/routes/_authed/_tenant/threads/index.tsx` (or analogous) for filter-bar + table layout.
- shadcn primitives in use: `Table`, `Select`, `Combobox`, `Input` (for date pickers), `Skeleton`, `Badge`, `Button`.
- Toast: `sonner` (already installed; check imports).

**Test scenarios:**
- Manual: load `/compliance` cold → URL gains `?since=<7-days-ago>` automatically; first 50 rows render or empty state.
- Manual: select `event_type: AGENT_CREATED` → URL becomes `?since=...&eventType=AGENT_CREATED`; only matching rows render.
- Manual: paste `/compliance?since=garbage` → toast "One or more URL filters were invalid and have been cleared" + page renders with default filter.
- Manual: scroll to bottom + click "Load more" → 50 more rows append; URL gains `?cursor=...`.
- Manual: operator login → "Cross-tenant view" badge visible + tenant filter dropdown shows distinct tenants.
- Manual: non-operator login → no tenant filter visible.
- Manual: empty result set with active filter → "No audit events match the current filter."
- Manual: empty result set with default `since` only (fresh deploy) → "No audit events have been recorded yet."
- Manual: skeleton rows appear during initial load (slow network throttle in dev tools confirms).
- *Automated: no admin route tests today; this list landed without test infra. Manual verification in dev is the gate.*

**Verification:**
- `pnpm --filter @thinkwork/admin typecheck` clean.
- Vite dev server renders the full list against the deployed dev API with seeded events.
- All filter combinations round-trip through URL params correctly.

---

- U4. **Event detail page (flat full-page route, chain + anchor + payload)**

**Goal:** Build the flat full-page detail at `/compliance/events/$eventId` rendering chain-position panel, anchor-status panel, and JSON payload section. prev_hash click-through resolves via `complianceEventByHash` and navigates.

**Requirements:** R4, R5, R6, R7.

**Dependencies:** U2 (codegen + parent route), U3 (so navigation back to `/compliance` preserves filter URL params).

**Files:**
- Create: `apps/admin/src/routes/_authed/_tenant/compliance/events.$eventId.tsx`
- Create: `apps/admin/src/components/compliance/ChainPositionPanel.tsx`
- Create: `apps/admin/src/components/compliance/AnchorStatusPanel.tsx`
- Create: `apps/admin/src/components/compliance/PayloadSection.tsx`

**Approach:**
- Route file: `useQuery` with `complianceEvent(eventId: $eventId)`. Loading → spinner; null result → "Event not found or not visible to your tenant scope" + back-to-list button; success → render the three panels.
- ChainPositionPanel: header with relative time + event_type badge. Body: two `CopyableRow`-pattern rows (event_hash, prev_hash). prev_hash row is clickable IF non-null; click fires `useQuery` for `complianceEventByHash(eventHash: prevHash)` and navigates on result OR shows a toast on null result. prev_hash null → renders "GENESIS" label, no link.
- AnchorStatusPanel: badge with icon (CheckCircle/Clock) + status text + (if ANCHORED) cadenceId copy + relative-time of `anchoredRecordedAt`. Subtitle: "This event is part of an immutable audit record — tamper-evident and retained for 365 days." for ANCHORED; "Will be anchored at the next 15-minute cadence." for PENDING.
- PayloadSection: parse `event.payload` as JSON, compute `JSON.stringify(payload, null, 2).length`. ≤ 262144 → render inside `<pre>` inside `<ScrollArea className="flex-1 min-h-0 max-h-96">`. > 262144 → render the first 1KB as preview + "Download full payload" button that creates a Blob + triggers download.
- All copy buttons use the `CopyableRow` icon-swap-1500ms pattern.

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId_.executions.$executionId.tsx` — flat detail page shape (header + back nav).
- `apps/admin/src/routes/_authed/_tenant/settings.tsx` — `CopyableRow` icon-swap.
- `apps/admin/src/components/threads/ThreadDetailSheet.tsx:113` — `flex-1 min-h-0` ScrollArea.

**Test scenarios:**
- Manual: navigate to `/compliance/events/<eventId>` → all three panels render.
- Manual: click prev_hash → resolves via complianceEventByHash + navigates to that event.
- Manual: click prev_hash that returns null (genesis-adjacent or scope-restricted) → toast "Previous event not visible to your tenant scope" + stays on current page.
- Manual: GENESIS event (prev_hash null) → renders "GENESIS" label + no clickable link.
- Manual: ANCHORED event → green CheckCircle badge + cadenceId visible.
- Manual: PENDING event → amber Clock badge + "Within 15 min" copy.
- Manual: copy buttons on event_hash/prev_hash/cadenceId → icon swaps to checkmark for 1500ms; clipboard contains the value.
- Manual: small payload (under 256KB) → renders inline pretty-printed.
- Manual: large payload (> 256KB) → renders 1KB preview + Download button; click downloads the full JSON.
- Manual: event not visible to tenant → "Event not found or not visible to your tenant scope" empty state with back button.
- Manual: browser back from detail → returns to `/compliance` with filter URL params preserved (TanStack Router default behavior).
- *Automated: same testing-infra-not-established caveat as U3.*

**Verification:**
- `pnpm --filter @thinkwork/admin typecheck` clean.
- Vite dev server: full flow from list → click row → detail panels → click prev_hash → navigate works end-to-end.

---

- U5. **Verify + commit + push + ce-code-review autofix + open PR**

**Goal:** Repo-wide typecheck + admin codegen verify + manual SOC2-walkthrough rehearsal in dev + commit + push + ce-code-review autofix + open PR with operator readme note (worktree port + Cognito callback URL caveat).

**Requirements:** R11.

**Dependencies:** U1, U2, U3, U4.

**Files:**
- (no new files in this unit; this is the verification + ship pass)

**Approach:**
- `pnpm --filter @thinkwork/admin codegen && pnpm -r --if-present typecheck` clean.
- `pnpm --filter @thinkwork/api test` runs the new compliance-tenants test (from U1) + the existing compliance-authz / cursor / drift tests.
- Manual SOC2 rehearsal: spin up vite dev server (port 5174 if free, 5175+ if not — and add to Cognito callbacks then). Sign in as a known operator email. Navigate to /compliance. Filter by event_type = AGENT_CREATED. Open one event. Verify chain-position + anchor-status + payload sections render. Click prev_hash, verify navigation. Sign out + sign in as a non-operator. Verify "Cross-tenant view" badge gone + tenant filter hidden + only own-tenant events visible.
- `git add` + commit with conventional message + push.
- Run ce-code-review autofix.
- Open PR with body documenting: the SOC2 rehearsal walkthrough script + operator pre-merge step (none — no new migration in this PR; the U10 backend's 0074 migration is already applied to dev) + Cognito callback URL caveat for reviewers running locally.

**Test scenarios:**
- *Test expectation: none for unit-level coverage. The verification step IS the test.*

**Verification:**
- All checks pass.
- PR opened, CI green on the standard 5 checks.

---

## System-Wide Impact

- **Interaction graph:** New admin SPA routes nest under `/compliance`. Sidebar adds one entry. Backend gets two small additions (`complianceTenants` query, `me.isComplianceOperator` field). No changes to existing resolvers, existing GraphQL types, existing admin routes, or any deployed Lambda surface.
- **Error propagation:** All errors are GraphQL errors from the backend (apikey, UNAUTHENTICATED, INTERNAL_SERVER_ERROR for missing env). UI renders structured 5xx as "Compliance event browsing is not available in this environment" empty state. UI renders FORBIDDEN as "Compliance access requires either platform-operator email or a resolved tenant scope" empty state. UI renders network errors via the existing urql error handler.
- **State lifecycle risks:** None — read-only queries with urql cache invalidation on filter URL change. No persistent state beyond URL params (which is the desired source of truth).
- **API surface parity:** GraphQL is the only API surface. No REST. No AppSync subscription. Mobile + CLI still don't consume compliance types.
- **Integration coverage:** SOC2 rehearsal (Verification step in U5) IS the integration test. Manual but high-value.
- **Unchanged invariants:** No changes to existing GraphQL resolvers' DB pool, the compliance schema, the writer Lambda, the U7 bucket, the U8b retention contract, or the U9 verifier. Backend additions are purely additive (new query field + new derived field on existing `me` type). The merged backend's auth contract (apikey hard-block + operator-vs-tenant) is reused unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `complianceTenants` query is unbounded — at extreme scale (4 enterprises × hundreds of sub-tenants), the typeahead source list is large. | DISTINCT tenant_id from `compliance.audit_events` naturally bounds at "tenants that have emitted any audit event." Worst case is hundreds of UUIDs — fits in browser memory and Combobox component handles it. If we ever hit 10k+ tenants, add server-side pagination as a follow-up. |
| Filter UI flicker between "URL changes" and "urql refetch" — typing in a date input could fire URL changes per keystroke. | Date inputs commit on blur (or debounce 300ms). Dropdowns commit on selection. Spec'd in U3's approach. |
| Cognito CallbackURLs gap — operator runs vite on 5175 without updating Cognito → Google OAuth fails with `redirect_mismatch`. | PR body documents the caveat. Default 5174 works without changes. `project_admin_worktree_cognito_callbacks` memory captures the institutional pattern. |
| prev_hash click resolves to null silently — operator clicks expecting navigation, gets nothing. | Toast "Previous event not visible to your tenant scope" makes the boundary explicit. Test scenario in U4 covers it. |
| Operator forgets they're in cross-tenant view + screenshots PII for an external auditor. | "Cross-tenant view" badge + tenant_id column visible only for operators makes the scope obvious. Plan-level acknowledgment that this is a UX defense, not a strict access control (operators can already see all data). |
| Large payload renders freeze the browser on multi-MB governance file diffs. | 256KB inline cap + Download button. Test scenario in U4 covers a synthetic 500KB payload. |
| Codegen drift if mobile/CLI ever add a compliance query without rerunning their codegen. | `pnpm -r typecheck` catches drift. The PR body documents that mobile/CLI codegen are intentionally skipped. |
| Empty-bucket cold load on a fresh deploy → all events query returns nothing → empty-state confusion. | Differentiated copy: "No audit events have been recorded yet" (vs "match the current filter"). Test scenario in U3 covers both. |

---

## Documentation / Operational Notes

- **Operator runbook update** — `docs/runbooks/compliance-walkthrough.md` (or wherever the SOC2 walkthrough is documented if at all): add the navigation flow "Sidebar → Compliance → click event → review chain + anchor → click prev_hash to walk the chain."
- **No new migrations.** Backend additions (`complianceTenants`, `me.isComplianceOperator`) are pure GraphQL extensions on the merged reader-db and existing `me` resolver — no schema changes.
- **Vite dev server port** — 5174 by default. Concurrent worktrees on 5175+ require Cognito CallbackURLs update per `project_admin_worktree_cognito_callbacks`.
- **Manual SOC2 rehearsal** is U5's verification surface. Capture screenshots if an issue surfaces during rehearsal (helps the PR review).

---

## Sources & References

- **Origin master plan:** `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md` (U10 entry).
- **U10 backend plan (origin):** `docs/plans/2026-05-07-014-feat-compliance-u10-admin-events-plan.md` — the corrected plan that ce-doc-review's safe_auto fixes folded into.
- **U10 backend PR:** #937 (merged at 4f5df0ab on 2026-05-07).
- **GraphQL contract:** `packages/database-pg/graphql/types/compliance.graphql` (introduced by #937).
- **Resolver auth helper:** `packages/api/src/lib/compliance/resolver-auth.ts`.
- **Pattern references:**
  - `apps/admin/src/components/Sidebar.tsx` (manageItems)
  - `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId_.executions.$executionId.tsx` (flat detail page shape)
  - `apps/admin/src/routes/_authed/_tenant/settings.tsx` (CopyableRow icon-swap)
  - `apps/admin/src/components/threads/ThreadDetailSheet.tsx:113` (ScrollArea pattern)
