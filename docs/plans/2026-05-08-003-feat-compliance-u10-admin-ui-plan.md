---
title: U10 admin SPA UI — Compliance section (sidebar + list + detail + cross-tenant toggle)
type: feat
status: active
date: 2026-05-08
origin: docs/plans/2026-05-07-015-feat-compliance-u10-admin-frontend-plan.md
---

# U10 admin SPA UI — Compliance section

## Summary

Ship the user-visible admin Compliance section that consumes the merged GraphQL contract from PRs #937 + #939. New sidebar entry, `/compliance` list page with filter bar + URL-cursor pagination + Combobox-composed tenant typeahead, cross-tenant toggle (off by default for operators), `/compliance/events/$eventId` flat detail page with chain-position panel + walk-back-10-events iterator + softened anchor-status copy + Blob-byte 256KB payload cap. All architectural decisions are settled in the origin plan; this plan is the focused UI execution slice.

---

## Problem Frame

PR #937 (U10 backend) shipped the GraphQL read API + auth scoping. PR #939 (U10 backend extensions) added `complianceTenants`, `complianceOperatorCheck`, and the 64-hex format guard on `complianceEventByHash`. Both merged. The user-visible admin Compliance section is now the only thing standing between the WORM-locked audit substrate and a SOC2 walkthrough demo. See origin: `docs/plans/2026-05-07-015-feat-compliance-u10-admin-frontend-plan.md`.

---

## Requirements

- R1. New "Compliance" entry in `apps/admin/src/components/Sidebar.tsx`'s `manageItems` array — placed AFTER Settings (the existing last entry); icon `ScrollText` from lucide-react (fresh icon, not previously used in admin).
- R2. Parent route `/compliance` with breadcrumb + `<Outlet />`. Index list page with: filter bar (tenant_id Combobox for operators behind cross-tenant toggle, actor_type Select, event_type Select, since/until inputs, range presets "Last 7d / 30d / This quarter"), URL-cursor pagination via "Load more" button, 5 skeleton rows on first load, differentiated empty states ("No audit events match the current filter" with active filter / "No audit events have been recorded yet" without).
- R3. `validateSearch` URL-driven filter state with `?range=7d` marker (NOT a derived ISO timestamp — resolver applies the default; `?since=` / `?until=` always wins). Malformed values coerce to undefined + `sonner` toast "One or more URL filters were invalid and have been cleared." Cursor preserved in URL via `?cursor=<base64-url>` so back-from-detail-page restores list position.
- R4. Cross-tenant TOGGLE (URL-stored via `?xt=1`): when operator + toggle ON, `args.filter.tenantId` accepts any tenant; when operator + toggle OFF (default), forces caller's own tenant scope (NOT a passive badge — explicit gating). Non-operators don't see the toggle at all (their queries are server-side scoped regardless). Operator label "Cross-tenant view" visible above the filter row when ON.
- R5. Operator detection via `complianceOperatorCheck` query at the parent route level. Three states: `{isOperator: true, allowlistConfigured: true}` → operator UI; `{isOperator: false, allowlistConfigured: true}` → non-operator UI (no toggle, no tenant filter); `{isOperator: false, allowlistConfigured: false}` → "Compliance operator allowlist is not configured for this environment" empty-state instead of the filter bar (dev-env signal). Brief flicker between mount and query-resolve is accepted in v1.
- R6. Flat full-page detail route at `/compliance/events/$eventId` with PageHeader + back-to-list nav (preserves filter URL params). Three panels:
  - **ChainPositionPanel**: event_hash + prev_hash via the extracted `CopyableRow` (icon-swap-1500ms). prev_hash CLICKABLE → fires `complianceEventByHash` → navigates on success / `sonner` toast "Previous event not visible to your tenant scope" on null. prev_hash null → "GENESIS" label, no link.
  - **AnchorStatusPanel**: ANCHORED state shows green Badge + `CheckCircle` icon + cadenceId (CopyableRow) + "Recorded within anchored window <cadenceId>" copy. PENDING state shows amber Badge + `Clock` icon + "Will be anchored at the next 15-minute cadence" copy.
  - **PayloadSection**: pretty-printed JSON inside `<ScrollArea className="flex-1 min-h-0 max-h-96">`. `new Blob([JSON.stringify(payload, null, 2)]).size > 262144` → render first 1KB preview + "Download full payload" button (Blob URL, anchor with `download="compliance-event-${eventId}.json"`). null payload → "Payload not recorded for this event" empty state.
- R7. "Walk back 10 events" iterator on the chain panel: a button that recursively resolves `complianceEventByHash` up to 10 hops back, displaying each step's eventId + event_type + relative time + hash-prefix in a vertical strip. Stops at GENESIS or first null result. Disable button while in flight + spinner.
- R8. Extract `CopyableRow` from `apps/admin/src/routes/_authed/_tenant/settings.tsx:131-167` (currently inline non-exported function) to `apps/admin/src/components/ui/copyable-row.tsx`. Update settings.tsx to import from the new location. Enhance with optional `onClick` / `clickable` prop so the chain-position panel's prev_hash row gets navigation on click.
- R9. New `gql\`...\`` documents land via the typed `graphql()` client preset from `@/gql` (NOT untyped `gql\`\`` from `@urql/core`). Codegen produces typed `useQuery` hook results.
- R10. Combobox composition: build out of existing `apps/admin/src/components/ui/command.tsx` + `popover.tsx`. ESTABLISHES the Combobox pattern in this admin SPA (no `combobox.tsx` exists today). Used by the tenant_id filter; reusable for future typeaheads.

**Origin requirements:** R1-R11 from `docs/plans/2026-05-07-015-feat-compliance-u10-admin-frontend-plan.md` map onto R1-R10 here (the backend-half R8/R9 from origin shipped in #939; this plan's R8 is the CopyableRow extraction sub-requirement).

---

## Scope Boundaries

- Aggregate dashboard (`complianceEventCounts`) — backend missing.
- Verification status panel — daily verifier Lambda not built.
- AppSync subscriptions / real-time counters — read-only retrospective design.
- CSV / NDJSON export from list — U11.
- Mobile compliance browse — admin-tier only.
- Forensic per-event Merkle proof generation — needs U9-verifier-as-Lambda.
- Recursive audit-log of operator cross-tenant reads — deferred per ce-doc-review SEC-002 architectural decision.

### Deferred to Follow-Up Work

- **Aggregate dashboard** — `complianceEventCounts(filter): { byType, byActor, byDay }` resolver + chart card; cheap follow-up if v1 telemetry surfaces a need.
- **Daily verifier scheduled Lambda + Verification status panel** — wires `@thinkwork/audit-verifier` (U9) into a daily run; surfaces results to a new admin panel.
- **Forensic per-event Merkle proof "Generate proof" button** — invokes the verifier as a Lambda for byte-level chain attestation.
- **Range presets for SOC2 windows** ("This quarter", "Last quarter", "Since last audit") beyond the v1 set ("Last 7d / 30d / This quarter").

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/components/Sidebar.tsx` lines 249-256 — `manageItems` array; insert AFTER Settings.
- `apps/admin/src/routes/_authed/_tenant.tsx` — parent layout. New routes nest under `_authed/_tenant/compliance/`.
- `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId_.executions.$executionId.tsx` — flat detail-page shape (PageHeader + back nav).
- `apps/admin/src/routes/_authed/_tenant/memory/index.tsx` and 15 other routes — `validateSearch` URL-param pattern.
- `apps/admin/src/routes/_authed/_tenant/settings.tsx:131-167` — `CopyableRow` inline function to extract.
- `apps/admin/src/components/threads/ThreadDetailSheet.tsx:113` — `flex-1 min-h-0` ScrollArea pattern.
- `apps/admin/src/components/ui/command.tsx` + `popover.tsx` — Combobox recipe ingredients.
- `apps/admin/src/lib/graphql-queries.ts` — typed `graphql()` from `@/gql` pattern (use this, not untyped `gql\`\``).
- `apps/admin/codegen.ts` — `documents: "src/**/*.{ts,tsx}"` picks up `graphql()` calls.

### Institutional Learnings

- `feedback_oauth_tenant_resolver` — Google-OAuth users may have null `ctx.auth.tenantId`; backend already handles via `resolveCallerTenantId`.
- `feedback_user_opt_in_over_admin_config` — Compliance is admin-tier; placement OK.
- `feedback_pnpm_in_workspace` — pnpm only.
- `project_admin_worktree_cognito_callbacks` — concurrent admin vite ports must be in `ThinkworkAdmin` CallbackURLs.
- `feedback_ship_inert_pattern` — this is the live-surface PR following the substrate.

### External References

None — the codebase has strong established patterns for everything except cursor-pagination + Combobox composition, which this PR establishes.

---

## Key Technical Decisions

- **`?range=7d` marker** for the default time window, NOT a derived ISO timestamp. Avoids URL rewrite on every cold load + keeps the empty-state heuristic clean (an explicit "Last 7d" preset is distinguishable from default).
- **URL-cursor pagination** via `?cursor=<base64url>` — back-from-detail navigation preserves list position. Cursor stack accumulates in component state for "Load more" but the LATEST cursor is mirrored to the URL so back-nav restores.
- **Cross-tenant toggle, NOT a badge.** Operator default is single-tenant scope (their own resolved tenant); explicit `?xt=1` URL flag gates the all-tenants view. The "Cross-tenant view" indicator is a contextual label on the toggle, not a passive cue.
- **Operator detection at the parent route**, single `complianceOperatorCheck` query cached by urql for the lifetime of the /compliance navigation. Brief flicker on first paint accepted in v1; future polish could plumb through `AuthContext`.
- **`allowlistConfigured: false` is a distinct UI state** — empty-state with "Compliance operator allowlist is not configured for this environment" replaces the filter bar entirely. Distinct from "you're not an operator" so dev-env misconfig is obvious.
- **Walk-back-10-events client-side iteration**, no new backend query needed. Loop fires `complianceEventByHash` recursively up to 10 hops. Each step blocks the button (in-flight UI). Stops on GENESIS or first null. Display: vertical strip of `{eventId, event_type, relativeTime, hash-prefix-12chars}`.
- **CopyableRow extracted to `components/ui/copyable-row.tsx`** with optional `onClick` prop. settings.tsx updates its import. Reusable across the chain panel + future copy needs.
- **Combobox composed from Popover + Command** establishes the pattern. The component lives at `apps/admin/src/components/ui/combobox.tsx` so future consumers can reuse.
- **Filter inputs commit on blur** (date inputs, free-text) or on selection (dropdowns + Combobox). No 300ms debounce in v1 — simpler URL state semantics.
- **5 skeleton rows on first load** — table-shape page deserves rows; documented inline that this is a one-off vs the codebase's general PageSkeleton spinner.
- **Sidebar position adjacent to Settings** (after Settings in the existing manageItems order).
- **Today's date: 2026-05-08** for any test-fixture relative-time display.

---

## Open Questions

### Resolved During Planning

- **How is operator detection wired?** Parent-route `complianceOperatorCheck` query, urql-cached, flicker accepted in v1.
- **Where does the "Cross-tenant view" label live?** Above the filter bar row when toggle is ON (contextual to the toggle state).
- **Walk-back depth?** 10 hops max — covers a typical SOC2-walkthrough chain demonstration without unbounded resolver calls.
- **CopyableRow extraction or duplication?** Extract — the chain panel needs an enhanced variant (onClick) and the prop addition belongs in the canonical component.
- **Filter input commit semantics?** Blur for free-text/dates; selection for dropdowns. No debounce in v1.
- **Cursor encoding?** Backend already returns base64-url JSON cursors (PR #937); the frontend just stores the string in URL and passes it back unchanged.

### Deferred to Implementation

- **Combobox styling polish** — implementer matches existing admin shadcn aesthetic (Popover trigger button shape, Command list height cap, empty-search behavior).
- **Skeleton row column widths** — match the table column widths once the actual table is rendered.
- **Date input component** — implementer picks between shadcn DatePicker (if exists) or `<input type="datetime-local">` based on what's already in admin.
- **JSON viewer styling** — `<pre>` with mono font + `font-size: 0.85rem` is the minimum; richer collapsible viewer if one already exists in admin.
- **Walk-back vertical strip styling** — implementer picks between shadcn `Card` per step or a denser table-like row.

---

## Output Structure

    apps/admin/src/components/ui/
    ├── copyable-row.tsx                   # NEW: extracted from settings.tsx, +onClick
    └── combobox.tsx                       # NEW: Popover+Command composition
    apps/admin/src/components/compliance/
    ├── ComplianceFilterBar.tsx            # filter row (tenant Combobox + selects + dates + range presets)
    ├── ComplianceEventsTable.tsx          # table + 5 skeleton rows + Load More
    ├── CrossTenantToggle.tsx              # operator-only toggle component
    ├── ChainPositionPanel.tsx             # event_hash + prev_hash + walk-back-10
    ├── AnchorStatusPanel.tsx              # ANCHORED/PENDING badges + copy
    └── PayloadSection.tsx                 # JSON pretty-print + 256KB Blob cap + Download
    apps/admin/src/lib/compliance/
    ├── queries.ts                         # 5 graphql() docs (events, event, eventByHash, tenants, operatorCheck)
    ├── url-search-params.ts               # validateSearch with range marker + malformed fallback + toast
    └── use-compliance-operator.ts         # hook wrapping useQuery(ComplianceOperatorCheckQuery)
    apps/admin/src/routes/_authed/_tenant/compliance/
    ├── route.tsx                          # parent route, breadcrumb, <Outlet/>
    ├── index.tsx                          # /compliance list page
    └── events.$eventId.tsx                # /compliance/events/$eventId flat detail
    apps/admin/src/routes/_authed/_tenant/settings.tsx       # MODIFIED: import CopyableRow from ui/

---

## Implementation Units

- U1. **Foundations: CopyableRow extraction + sidebar entry + parent route + GraphQL documents + admin codegen**

**Goal:** Land the prerequisites every other unit needs: extracted `CopyableRow` (with optional onClick), Compliance sidebar entry, parent compliance route, 5 typed GraphQL documents, admin codegen output.

**Requirements:** R1, R8, R9.

**Dependencies:** None.

**Files:**
- Create: `apps/admin/src/components/ui/copyable-row.tsx` (extracted from settings.tsx + optional `onClick` prop)
- Modify: `apps/admin/src/routes/_authed/_tenant/settings.tsx` (replace inline CopyableRow with import from new location; remove the local function definition)
- Modify: `apps/admin/src/components/Sidebar.tsx` (add `{ to: "/compliance", icon: ScrollText, label: "Compliance" }` after Settings in `manageItems`)
- Create: `apps/admin/src/routes/_authed/_tenant/compliance/route.tsx` (parent route, breadcrumb, `<Outlet />`)
- Create: `apps/admin/src/routes/_authed/_tenant/compliance/index.tsx` (placeholder list page; U2 fills it in)
- Create: `apps/admin/src/lib/compliance/queries.ts` (5 `graphql()` documents using @/gql client preset)
- Modified: `apps/admin/src/gql/` codegen artifacts (auto-generated via `pnpm --filter @thinkwork/admin codegen`)

**Approach:**
- Extract CopyableRow with the existing `{label, value, url}` props PLUS optional `onClick: () => void` and `clickable?: boolean` props. When clickable + onClick: render the value as a button (shadcn ghost variant) firing onClick instead of the existing `url` link behavior.
- Sidebar insert is one line; verify `ScrollText` lucide-react import resolves.
- Parent route's component renders a breadcrumb + `<Outlet />`. Index.tsx placeholder is a `<PageHeader title="Compliance" />` + "List landing in U2."
- `queries.ts` defines five `graphql()` template literals: ComplianceEventsList, ComplianceEventDetail, ComplianceEventByHash, ComplianceTenants, ComplianceOperatorCheck. Each declares the exact field set the consumer needs.

**Patterns to follow:**
- `apps/admin/src/lib/graphql-queries.ts` — typed `graphql()` import pattern.
- `apps/admin/src/components/Sidebar.tsx:240-256` — manageItems shape.
- `apps/admin/src/routes/_authed/_tenant.tsx` — parent layout shape.

**Test scenarios:**
- *Test expectation: none — pure scaffolding + extraction. settings.tsx must still typecheck after the import swap. Codegen must produce typed query results in `apps/admin/src/gql/`.*

**Verification:**
- `pnpm --filter @thinkwork/admin codegen` succeeds; generated artifacts include the new query types.
- `pnpm --filter @thinkwork/admin typecheck` clean (settings.tsx still works post-extraction).
- Vite dev server renders `/compliance` placeholder; sidebar Compliance entry visible.

---

- U2. **Events list page (filter bar, URL params, cursor pagination, Combobox composition, range presets)**

**Goal:** Replace U1's placeholder with the full list page. Build the Combobox primitive, the ComplianceFilterBar, the ComplianceEventsTable with skeleton rows + Load More + URL cursor, the validateSearch parser with range-marker default + malformed fallback + sonner toast.

**Requirements:** R2, R3, R10.

**Dependencies:** U1.

**Files:**
- Create: `apps/admin/src/components/ui/combobox.tsx` (Popover + Command composition)
- Create: `apps/admin/src/components/compliance/ComplianceFilterBar.tsx`
- Create: `apps/admin/src/components/compliance/ComplianceEventsTable.tsx`
- Create: `apps/admin/src/lib/compliance/url-search-params.ts` (validateSearch helper)
- Modify: `apps/admin/src/routes/_authed/_tenant/compliance/index.tsx` (full list page)

**Approach:**
- Combobox: `<Popover>` + `<PopoverTrigger asChild>` button showing selected value + chevron; `<PopoverContent>` containing `<Command>` with `<CommandInput>` + `<CommandList>` + `<CommandEmpty>` + `<CommandGroup>` of `<CommandItem>` per option. Single-select with `value` + `onValueChange` props. Empty-search hint optional.
- url-search-params.ts: `validateSearch` parses `{tenantId?, actorType?, eventType?, since?, until?, range?, cursor?, xt?}`. Malformed values → coerce to undefined + queue a toast on next render via a one-shot `useEffect`. The `range` value is "7d" / "30d" / "this-quarter" — translates to `since` at render time.
- ComplianceFilterBar: hosts all five filter inputs + range preset chips ("Last 7d / 30d / This quarter / Custom"). Each control commits on blur (text/date) or selection (dropdowns/Combobox). On commit, `router.navigate({to: "/compliance", search: (prev) => ({...prev, [field]: value})})`.
- ComplianceEventsTable: `useQuery(ComplianceEventsListQuery, {filter, after: cursor, first: 50})`. 5 skeleton `<TableRow>`s on first load. Load More accumulates next page in component state; the LAST visible cursor is mirrored to URL via `router.navigate({search: (prev) => ({...prev, cursor: lastCursor})})`. On filter change, URL update clears cursor (router.navigate without cursor).

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/memory/index.tsx` — `validateSearch` shape.
- `apps/admin/src/components/ui/command.tsx` + `popover.tsx` — Combobox ingredients.
- `apps/admin/src/components/ui/skeleton.tsx` — skeleton row pattern.
- shadcn Table + Badge + Button + Sonner (`apps/admin/src/lib/sonner.ts` if it exists, or direct `import { toast } from "sonner"`).

**Test scenarios:**
- Manual: cold load `/compliance` → URL stays clean (no derived ISO since); list renders 50 rows or empty state.
- Manual: click "Last 30d" preset → URL becomes `?range=30d`; events filtered to last 30 days.
- Manual: paste `/compliance?since=garbage` → toast "One or more URL filters were invalid and have been cleared"; list renders default.
- Manual: type in tenant Combobox (operator only) → typeahead filters via existing options.
- Manual: scroll to bottom + click "Load more" → 50 more rows; URL gains `?cursor=...`.
- Manual: paste a `?cursor=...` URL → resumes at that page.
- Manual: empty-bucket fresh-deploy → "No audit events have been recorded yet."
- Manual: filter to a non-matching event_type → "No audit events match the current filter."

**Verification:**
- `pnpm --filter @thinkwork/admin typecheck` clean.
- Vite dev server renders the full list against deployed dev API with seeded events; all manual scenarios pass.

---

- U3. **Operator detection + cross-tenant toggle + dev-env-misconfigured state**

**Goal:** Wire the operator-vs-non-operator UI fork. `complianceOperatorCheck` query at the parent route via a small hook. CrossTenantToggle component shown only to operators. URL-stored `?xt=1` gates the all-tenants view. Distinct empty-state when the operator allowlist isn't configured.

**Requirements:** R4, R5.

**Dependencies:** U1, U2.

**Files:**
- Create: `apps/admin/src/lib/compliance/use-compliance-operator.ts` (urql `useQuery` hook wrapping the ComplianceOperatorCheck query; returns `{isOperator, allowlistConfigured, fetching, error}`)
- Create: `apps/admin/src/components/compliance/CrossTenantToggle.tsx` (shadcn `Switch` + label "Cross-tenant view"; URL-stored)
- Modify: `apps/admin/src/routes/_authed/_tenant/compliance/route.tsx` (parent route invokes the hook; if `!allowlistConfigured` renders the dev-env empty-state; else renders `<Outlet />`)
- Modify: `apps/admin/src/components/compliance/ComplianceFilterBar.tsx` (consume operator status; show CrossTenantToggle only when `isOperator`; show tenant_id Combobox only when toggle ON; force scope when OFF)
- Modify: `apps/admin/src/lib/compliance/url-search-params.ts` (parse `?xt=1` boolean)

**Approach:**
- Hook: simple `useQuery(ComplianceOperatorCheckQuery, {requestPolicy: "cache-first"})` so subsequent route mounts within the session reuse the cached result.
- Toggle: shadcn `Switch` + label. `checked = (search.xt === 1)`. On toggle, `router.navigate({search: (prev) => ({...prev, xt: prev.xt ? undefined : 1, tenantId: undefined})})` — flipping the toggle clears the tenantId filter.
- Filter bar conditional render:
  - Non-operator → don't render CrossTenantToggle; don't render tenant_id Combobox.
  - Operator + xt=undefined (toggle OFF, default) → render toggle with "Cross-tenant view" label; don't render tenant_id Combobox; the events query receives no tenantId and the backend forces caller's own scope (this matches the U10 backend's auth pre-check for non-operator-equivalent calls — actually here the operator IS authenticated so we override on the client too).
  - Operator + xt=1 → render toggle; render tenant_id Combobox; "Cross-tenant view" label visible above filter row.
- Dev-env empty state: when `allowlistConfigured === false`, parent route renders a centered card "Compliance operator allowlist is not configured for this environment. Set THINKWORK_PLATFORM_OPERATOR_EMAILS to enable cross-tenant browse." (Operators in dev see this; non-operators in dev would see the same but it's an admin-tier surface so most viewers there are at least curious about config.)

**Test scenarios:**
- Manual: operator login, default load → toggle visible, OFF; "Cross-tenant view" label hidden; tenant filter hidden; events scoped to caller's tenant.
- Manual: operator login + flip toggle ON → URL becomes `?xt=1`; tenant Combobox appears; "Cross-tenant view" label appears above filter row; events query fires with no tenantId (operator scope on backend).
- Manual: operator login + toggle ON + select tenant_X in Combobox → URL becomes `?xt=1&tenantId=tenant_X`; events scoped to tenant_X.
- Manual: operator login + flip toggle OFF (from xt=1) → tenantId cleared from URL; tenant filter hidden; scope returns to caller's own tenant.
- Manual: non-operator login → no toggle, no tenant filter, events scoped to own tenant (matches backend enforcement).
- Manual: dev environment with empty `THINKWORK_PLATFORM_OPERATOR_EMAILS` → operator-attempted login renders the dev-env empty-state, NOT the silent non-operator UI.

**Verification:**
- `pnpm --filter @thinkwork/admin typecheck` clean.
- Vite dev server: operator + non-operator logins exhibit the correct UI fork; toggle persists across refresh; allowlist-not-configured empty-state renders when env is empty.

---

- U4. **Event detail page (chain panel + walk-back-10 + anchor panel + payload)**

**Goal:** Build the flat full-page detail at `/compliance/events/$eventId`. ChainPositionPanel with walk-back iterator, AnchorStatusPanel with softened copy, PayloadSection with Blob-byte 256KB cap.

**Requirements:** R6, R7.

**Dependencies:** U1, U2 (so navigation back to `/compliance` preserves filter URL params).

**Files:**
- Create: `apps/admin/src/routes/_authed/_tenant/compliance/events.$eventId.tsx`
- Create: `apps/admin/src/components/compliance/ChainPositionPanel.tsx`
- Create: `apps/admin/src/components/compliance/AnchorStatusPanel.tsx`
- Create: `apps/admin/src/components/compliance/PayloadSection.tsx`

**Approach:**
- Route file: `useQuery(ComplianceEventDetailQuery, {eventId})`. Loading → centered spinner (NOT skeleton — full-page nav). null → "Event not found or not visible to your tenant scope" + back button. success → render the three panels stacked.
- ChainPositionPanel:
  - Header: relative time + event_type badge.
  - CopyableRow for event_hash (label "Event hash", value = full 64-char hex).
  - CopyableRow for prev_hash (label "Previous hash", value = hex; clickable + onClick = `() => walkChain(prev_hash, 1)`). null prev_hash → label "GENESIS", no clickable.
  - "Walk back 10 events" button below the rows. Click → component-state-driven recursion: `useState<{eventId, eventType, recordedAt, hashPrefix}[]>([])` accumulating hops. Each hop fires `client.query(ComplianceEventByHashQuery, {eventHash})` (urql client.query for imperative use). Stops on null result, GENESIS prev_hash, or 10-hop limit. Disable button + show "Walking..." while in flight.
  - Below the button: vertical strip of accumulated hops as `<Card>` rows showing `{shortHash} {event_type} {relativeTime}` per step. Click on a step navigates to that event's detail page.
- AnchorStatusPanel: `<Card>` with `<Badge>` (green CheckCircle for ANCHORED, amber Clock for PENDING) + status text + (if ANCHORED) CopyableRow for cadenceId + relative-time of anchoredRecordedAt + subtitle "Recorded within anchored window <cadenceId>". For PENDING: subtitle "Will be anchored at the next 15-minute cadence."
- PayloadSection:
  - Compute `const json = JSON.stringify(payload, null, 2); const bytes = new Blob([json]).size;`.
  - If `payload === null` or `payload === undefined` → empty state "Payload not recorded for this event."
  - If `bytes <= 262144` → render `<ScrollArea className="flex-1 min-h-0 max-h-96"><pre className="font-mono text-xs">{json}</pre></ScrollArea>` + CopyableRow header for "Payload (N bytes)".
  - If `bytes > 262144` → render first 1024 chars as preview in `<pre>` + `<Button>` "Download full payload (N bytes)" that creates a `Blob` URL + anchor with `download="compliance-event-${eventId}.json"` + revokes the URL after click.

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId_.executions.$executionId.tsx` — flat detail page shape.
- `apps/admin/src/components/threads/ThreadDetailSheet.tsx:113` — `flex-1 min-h-0` ScrollArea pattern.
- shadcn `Card`, `Badge`, `Button`, `ScrollArea`.

**Test scenarios:**
- Manual: click a row in the list → detail page; URL becomes `/compliance/events/<eventId>`; all three panels render.
- Manual: click prev_hash → navigates via complianceEventByHash to the previous event's detail.
- Manual: GENESIS event (prev_hash null) → "GENESIS" label + no link.
- Manual: prev_hash that resolves to null (cross-tenant scope or genuinely missing) → toast "Previous event not visible to your tenant scope" + stays on current page.
- Manual: click "Walk back 10 events" → strip populates with up to 10 hops; clickable steps navigate to that step's detail.
- Manual: walk-back hits GENESIS at hop 4 → strip shows 4 hops + "Reached chain start (GENESIS)" terminator.
- Manual: ANCHORED event → green CheckCircle badge + cadenceId + "Recorded within anchored window <cadenceId>" copy.
- Manual: PENDING event → amber Clock badge + "Will be anchored at the next 15-minute cadence."
- Manual: small payload (<256KB) → renders inline pretty-printed.
- Manual: large payload (>256KB) → 1KB preview + Download button; click downloads the full JSON with filename `compliance-event-<eventId>.json`.
- Manual: null payload → "Payload not recorded for this event."
- Manual: copy buttons on event_hash/prev_hash/cadenceId → CopyableRow icon-swap-1500ms.
- Manual: browser back from detail → returns to `/compliance` with filter URL params + cursor preserved (TanStack Router default).

**Verification:**
- `pnpm --filter @thinkwork/admin typecheck` clean.
- Vite dev server: full flow from list → click event → detail panels → click prev_hash → walk-back → back to list works end-to-end against deployed dev API.

---

- U5. **Verify + commit + push + ce-code-review autofix + open PR**

**Goal:** Repo-wide typecheck + admin codegen verify + manual SOC2 walkthrough rehearsal in dev + commit + push + ce-code-review autofix + open PR.

**Requirements:** R1-R10 (verification across the surface).

**Dependencies:** U1, U2, U3, U4.

**Files:** No new files; verification + ship pass.

**Approach:**
- `pnpm --filter @thinkwork/admin codegen && pnpm -r --if-present typecheck` clean.
- Manual SOC2 walkthrough rehearsal:
  1. Sign in as operator email (env var configured).
  2. Sidebar shows Compliance.
  3. /compliance loads with default 7d range, 50 rows.
  4. Cross-tenant toggle OFF by default; flip ON; "Cross-tenant view" label visible; tenant Combobox appears.
  5. Filter to event_type = AGENT_CREATED; URL updates; rows filtered.
  6. Click an event; detail page renders; chain + anchor + payload all present.
  7. Click prev_hash; navigates to previous event.
  8. Click "Walk back 10 events"; strip populates.
  9. Browser back → returns to `/compliance` with filter + cursor preserved.
  10. Sign out + sign in as a non-operator email → no toggle, no tenant filter, scoped to own tenant.
  11. (Optional) Spin up dev with empty `THINKWORK_PLATFORM_OPERATOR_EMAILS` → "allowlist not configured" empty-state renders.
- `git add` + commit with conventional message + push.
- Run ce-code-review autofix.
- Open PR with body documenting: SOC2 rehearsal walkthrough script + Cognito callback URL caveat for reviewers running locally.

**Test scenarios:**
- *Test expectation: none for unit-level coverage. The verification step IS the test.*

**Verification:**
- All checks pass.
- PR opened, CI green on the standard 5 checks.

---

## System-Wide Impact

- **Interaction graph:** New admin routes + sidebar entry + new components. Backend untouched (contract is stable post-#937/#939). settings.tsx loses an inline function; gains an import.
- **Error propagation:** GraphQL errors surface via the existing urql error handler. Validation errors on URL params produce sonner toasts. Walk-back hop failures show "Previous event not visible" toast + stop iteration.
- **State lifecycle risks:** None — read-only queries with URL-driven state. urql cache handles invalidation when filter URL params change. Walk-back uses local component state cleared on detail-page unmount.
- **API surface parity:** GraphQL only. No REST. No subscription.
- **Integration coverage:** SOC2 walkthrough rehearsal in U5 IS the integration test. Manual but high-value.
- **Unchanged invariants:** No backend changes. No GraphQL schema changes (contract is stable). settings.tsx behavior preserved (CopyableRow extraction is mechanical).

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Cross-tenant toggle UX confuses operators (OFF default may surprise users who expected the old behavior) | "Cross-tenant view" label + the toggle position above filter row makes the state explicit. Plan-doc captures this as the deliberate v1 default. |
| Walk-back-10 rate limits or DoSes the resolver | 10-hop ceiling + button disable during in-flight + the new 64-hex format guard at the resolver protect both client and server. Sequential (not parallel) to keep load bounded. |
| Operator-detection flicker on first paint | Plan accepts the flicker for v1; future polish could plumb operator status through AuthContext. |
| Combobox composition lands a new pattern under-tested | The pattern is small (Popover + Command, ~80 LOC) and reuses primitives that are already battle-tested in their respective component files. Future consumers can study `combobox.tsx` directly. |
| Cursor-pagination URL collision with browser back | URL-cursor design intentionally preserves position. Test scenario in U2 covers paste-cursor-resume + back-from-detail. |
| `?range=7d` and `?since=2026-...` both present in URL | Explicit `?since=` always wins (resolver applies range only when both `since` and `until` are absent). Documented in url-search-params.ts. |
| Vite dev port collision with concurrent worktrees | If user runs on 5175+, Cognito ThinkworkAdmin CallbackURLs needs the port added (institutional pattern in `project_admin_worktree_cognito_callbacks`). |
| Dev environment with empty THINKWORK_PLATFORM_OPERATOR_EMAILS surprises operator | `complianceOperatorCheck.allowlistConfigured: false` → distinct UI state (parent route renders dev-env empty-state). Test scenario in U3 covers this. |
| Large-payload Blob download fails under restrictive CSP | Verified during U5 SOC2 rehearsal in deployed dev (not just vite local where CSP is permissive). If CSP blocks blob:, falls back to inline-only with a "Payload too large; CSP blocks download" message — but no current CSP configured, so v1 ships the Download button. |

---

## Documentation / Operational Notes

- No new migrations. No backend changes. No Terraform changes. No Lambda redeploys.
- **Operator runbook update** (optional, post-rehearsal) — `docs/runbooks/compliance-walkthrough.md` documenting the navigation flow ("Sidebar → Compliance → flip cross-tenant toggle → filter → click event → walk chain"). Defer until after first real SOC2 rehearsal so the runbook reflects observed UX.
- **Cognito ThinkworkAdmin CallbackURLs** — if running vite dev on 5175+, add the port to ThinkworkAdmin CallbackURLs first (institutional pattern: each concurrent worktree port must be in the allowlist).

---

## Sources & References

- **Origin master plan:** `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md` (U10 entry).
- **Origin frontend plan:** `docs/plans/2026-05-07-015-feat-compliance-u10-admin-frontend-plan.md` — full backend+UI plan; this plan executes the UI half.
- **U10 backend PR:** #937 (merged at 4f5df0ab).
- **U10 backend extensions PR:** #939 (merged at cd58ac29). Adds complianceTenants, complianceOperatorCheck, complianceEventByHash format guard.
- **GraphQL contract:** `packages/database-pg/graphql/types/compliance.graphql`.
- **Pattern references** (verified during ce-doc-review on the 015 plan):
  - `apps/admin/src/components/Sidebar.tsx`
  - `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId_.executions.$executionId.tsx`
  - `apps/admin/src/routes/_authed/_tenant/settings.tsx:131-167`
  - `apps/admin/src/components/threads/ThreadDetailSheet.tsx:113`
  - `apps/admin/src/components/ui/command.tsx` + `popover.tsx`
  - `apps/admin/src/lib/graphql-queries.ts`
