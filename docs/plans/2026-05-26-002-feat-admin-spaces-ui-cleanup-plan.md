---
title: "feat: Admin Spaces UI Cleanup"
date: 2026-05-26
type: feat
status: completed
depth: standard
origin: docs/brainstorms/2026-05-26-admin-spaces-ui-cleanup-requirements.md
completed_by: "PR #1735"
---

# feat: Admin Spaces UI Cleanup

## Summary

Apply a focused UI-cleanup pass to `apps/admin → Spaces` to bring the list page, Space Detail chrome, and per-tab panels into alignment with the rest of the admin: a flex-1 truncating Description column on the list (Routines pattern), tab reorder/rename on Space Detail (**Workspace** default · KBs · Triggers · Settings · Members), per-tab contextual Add/Save actions in the chrome header, separate email column on Members, and the existing Email Triggers toggle re-surfaced as a single synthetic row in a renamed Triggers tab alongside Webhook and Schedule.

No backend changes. Data model is untouched. Email-as-a-trigger-row is driven by the existing per-Space `emailTriggersEnabled` boolean (see origin: `docs/brainstorms/2026-05-26-admin-spaces-ui-cleanup-requirements.md`).

---

## Problem Frame

The admin Spaces section drifted from the patterns the rest of admin uses:

- **List page** is missing the standard description column (every adjacent list — Routines, Webhooks, Schedules — has one).
- **Space Detail chrome** lands on "Configuration" instead of the workspace the operator usually wants; "Configuration" is also the wrong label (it's really settings + a buried email triggers toggle).
- **Members tab** stacks name + email in one cell and renders its own in-panel subheader with an "Add member" button, instead of using the standard chrome header right slot.
- **Automations tab** has two separate Add buttons inside the panel, no description column (today's "Schedule / Trigger" raw expression isn't a real description), and Email Triggers are hidden inside the Configuration tab as a single toggle.

The brainstorm consolidated these into one prescriptive change list. This plan turns that list into implementation units, with two adjacent items pulled in from research:

- The `$spaceId.tsx` default-redirect must flip from `/configuration` → `/workspace`.
- The tanstack-router `routeTree.gen.ts` must regenerate after the `automations` → `triggers` route file rename.

---

## Requirements

Carried forward verbatim from the origin requirements doc, grouped by change area:

**Spaces list table**
- R1. Add a Description column between Space and Access; render with the Routines pattern (`text-muted-foreground text-sm truncate overflow-hidden`, no fixed `size`). `SpacesListQuery` already returns `description`.

**Space Detail chrome**
- R2. Tab order becomes Workspace · KBs · Triggers · Settings · Members.
- R3. Default landing tab becomes Workspace (replaces Configuration in `$spaceId.tsx` redirect + post-create navigate in `spaces/index.tsx` + row-click navigation).
- R4. Tab labels: "Configuration" → "Settings"; "Memory" → "KBs"; "Automations" → "Triggers".
- R5. Chrome header right slot becomes a per-tab contextual action area (Add on Triggers, Add on Members-when-private, Save-when-dirty on Settings).

**Settings tab (formerly Configuration)**
- R6. Rename in-panel field label "Instructions" back to "Description" (storage stays on `space.description`).
- R7. Remove `<SpaceEmailTriggersToggle>` from the Settings panel — it moves to the Triggers tab.

**Members tab**
- R8. Split User column into User (name only) and Email (separate column, truncate-on-overflow).
- R9. Remove the in-panel subheader entirely (the h2 "Members" + paragraph + inline Add button).
- R10. Move Add to the chrome header right slot; label is literally "Add".

**Triggers tab (formerly Automations)**
- R11. Route file rename: `$spaceId_.automations.tsx` → `$spaceId_.triggers.tsx`; path `/spaces/:id/automations` → `/spaces/:id/triggers`.
- R12. Old `/spaces/:id/automations` is deleted; no redirect, accept 404 on stale URLs (admin-only surface, per plan-time decision).
- R13. Replace the two in-panel Add Webhook + Add Schedule buttons with a single Add dropdown in the chrome header right slot, with items Schedule · Webhook · Email.
- R14. When `emailTriggersEnabled === true`, the Email dropdown item is disabled (no second-add path).
- R15. Replace the "Schedule / Trigger" column with a Description column matching the Routines pattern (flex-1 + truncate).
- R16. Description cell content depends on `kind`: schedule → current `formatAutomationSchedule()` output (humanizer deferred per origin decision); webhook → webhook URL with copy-link; email → derived `${spaceSlug}@${tenantSlug}.thinkwork.ai` with copy-link.
- R17. When `emailTriggersEnabled` is true, insert one synthetic row (kind: "email", typeLabel: "Email", description: derived address with copy link). When false, no email row.
- R18. Email row click path: opens a disable confirmation (parity with Schedule/Webhook row-detail navigation, which the brainstorm intentionally kept).

---

## Scope Boundaries

### In scope
- All R1–R18 above.
- Shared `<CopyLinkButton>` extraction in `apps/admin/src/components/ui/` (used by Triggers description cells + `SpaceEmailTriggersToggle` after a small refactor).
- Default-redirect flip in `$spaceId.tsx`.
- Code-level test coverage (vitest) for the new column rendering, route default, contextual chrome action mechanism, and email-row insertion.

### Outside this product's identity
- (None — UI-only cleanup. Carried over from origin: no `apps/user` UI changes, no Space data-model changes.)

### Deferred for later (from origin)
- Cron-to-prose schedule humanizer (e.g., `"Every day at 6:00 AM"`). Shipping this work uses the current `formatAutomationSchedule()` output.
- Multiple email aliases per Space (single synthetic row only).

### Deferred to Follow-Up Work
- Cypress / Playwright end-to-end coverage for the Spaces section. Out of band — this plan ships with vitest unit coverage only.
- Migrating other admin tables to use the same shared `<CopyLinkButton>` component (Webhooks detail page, etc.). Component lands here and earns its keep through three call sites; broader adoption is opportunistic.

---

## Key Technical Decisions

**KTD1. Chrome action slot — `headerActions` prop accepts a render function with chrome context.**
`SpaceDetailChrome` gains a `headerActions?: (ctx: { space, draft, setDraft, refreshSpace }) => ReactNode` prop. The chrome calls it inside the same render path that yields `space`, so the action can reference per-Space state (e.g., the Triggers Add dropdown needs `space.emailTriggersEnabled` to disable the Email item; the Members Add button needs to gate on `space.accessMode`). Static `ReactNode` is NOT accepted as an alternate shape — the chrome always calls the function with ctx, and route files that don't need ctx return their action regardless. This is the only mechanism that works for both Members and Triggers without forcing route files to fetch `space` independently. Rejected: a separate SpaceDetailChromeContext (more flexible but a new pattern with no other admin call sites); a `ReactNode | function` union (two shapes invites confusion).

**KTD2. Old `/spaces/:id/automations` route is deleted, not redirected.**
Admin-only surface, no external bookmark exposure, no carrying-cost justification for a permanent redirect file. The route file is removed, `routeTree.gen.ts` is regenerated, stale URLs 404 cleanly. If a user reports a broken bookmark we can revisit.

**KTD3. Shared `<CopyLinkButton text={...}>` extracted at U1.**
Lives in `apps/admin/src/components/ui/CopyLinkButton.tsx`. Reused by (a) the new email row description cell, (b) the webhook row description cell. (The existing `SpaceEmailTriggersToggle` is **not** refactored to use it — that component is deleted entirely in U7 because the Settings panel no longer renders it.) Two new call sites — enough to justify the abstraction without speculation. Behavior mirrors the existing `SpaceEmailTriggersToggle` pattern: ghost-icon button, click → `navigator.clipboard.writeText`, transient `<Check/>` icon for ~1.5s.

**KTD4. Email row is synthetic, derived from `emailTriggersEnabled`.**
No new table, no new entity. The Triggers panel's `rows` `useMemo` conditionally prepends one row when `space.emailTriggersEnabled === true`. Selecting "Email" in the Add dropdown fires the existing `SetSpaceEmailTriggersMutation` with `enabled: true`; the disable path on the row fires the same mutation with `enabled: false`. The dropdown's Email item is `disabled` when the boolean is already true.

**KTD5. Schedule description uses current formatter output, humanizer is a follow-up.**
Per the locked origin decision. The schedule row's `description` field is `formatAutomationSchedule(scheduleExpression)` as-is — `"24 hours"`, `"5 minutes"`, raw `at(...)` parsed date. True cron-to-prose lives in a separate follow-up.

---

## High-Level Technical Design

This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.

```text
                    ┌──────────────────────────────────────────────┐
                    │  SpaceDetailChrome (route-wrapper component)  │
                    │                                                │
   route file ───►  │   children({                                   │
   passes through   │     space, draft, setDraft, refreshSpace,      │
                    │     headerActions: <Button /> | <Dropdown />,  │  ◄── NEW
                    │   })                                           │
                    │                                                │
                    │   header layout:                               │
                    │     [title]   [tabs centered]   [right slot]   │
                    │                                  ▲             │
                    │   right slot renders, in priority order:       │
                    │     • headerActions (when provided)            │
                    │     • Save button (when Settings draft dirty)  │
                    └──────────────────────────────────────────────┘

   Per-route adapter passes the right thing:
   - workspace.tsx, memory.tsx (now kbs):  headerActions undefined
   - members.tsx:   headerActions = <Button onClick={openAddDialog}>Add</Button>
                    (rendered only when accessMode === "PRIVATE")
   - triggers.tsx:  headerActions = <AddTriggerDropdown onAdd={...} emailEnabled={...} />
   - configuration.tsx (now settings):  headerActions undefined; Save still
                    rendered by chrome when dirty
```

Triggers panel row composition:

```text
rows = useMemo(() => [
   ...(space.emailTriggersEnabled ? [synthesizeEmailRow(space, tenantSlug)] : []),
   ...scheduledJobs.map(mapScheduleRow),
   ...webhooks.map(mapWebhookRow),
].sort(byCreatedAtDesc), [scheduledJobs, webhooks, space.emailTriggersEnabled, ...])

description column cell, switching on row.kind:
   "schedule"  →  <span>{formatAutomationSchedule(scheduleExpression)}</span>
   "webhook"   →  <div className="flex items-center gap-2 truncate">
                     <code className="truncate">{webhookUrl}</code>
                     <CopyLinkButton text={webhookUrl} />
                  </div>
   "email"     →  <div className="flex items-center gap-2 truncate">
                     <code className="truncate">{emailAddress}</code>
                     <CopyLinkButton text={emailAddress} />
                  </div>
```

---

## Implementation Units

### U1. Shared `<CopyLinkButton>` component

**Goal:** Create a reusable `<CopyLinkButton text={...}/>` component for the Triggers description cells (webhook URL + email address copy affordances).

**Requirements:** Foundation for R16 (webhook + email description cells with copy link).

**Dependencies:** None.

**Files:**
- Create: `apps/admin/src/components/ui/CopyLinkButton.tsx`
- Create: `apps/admin/src/components/ui/CopyLinkButton.test.tsx`

**Approach:**
- Props: `text: string`, optional `aria-label` override, optional `className`.
- Ghost icon button (lucide `Copy` / `Check`), `size="icon"` per shadcn convention.
- On click: `navigator.clipboard.writeText(text)`, set local `copied` state, swap to `<Check/>` icon, restore after 1500ms.
- No toast on copy — the icon swap is the affirmation, mirroring the existing `SpaceEmailTriggersToggle` pattern.
- Do not touch `SpaceEmailTriggersToggle.tsx` here — U7 deletes that file entirely.

**Patterns to follow:** Existing `SpaceEmailTriggersToggle.tsx` implementation is the reference. shadcn-style ghost icon button.

**Test scenarios:**
- Renders the Copy icon initially.
- Click writes `text` to `navigator.clipboard` (mock `navigator.clipboard.writeText`).
- After click, the Check icon renders and the Copy icon disappears.
- After 1500ms (vi.useFakeTimers + advanceTimersByTime), the Copy icon returns.
- `aria-label` prop is reflected on the rendered button.
- Test expectation: covers happy path; clipboard rejection is not handled today and stays out of scope (no behavioral change from `SpaceEmailTriggersToggle`'s current behavior).

**Verification:** `pnpm --filter @thinkwork/admin test CopyLinkButton` passes.

---

### U2. Spaces list Description column

**Goal:** Add the Description column to the Spaces list table.

**Requirements:** R1.

**Dependencies:** None (independent of every other unit — can land standalone).

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/spaces/index.tsx`
- Modify (or augment): `apps/admin/src/routes/_authed/_tenant/spaces/-spaces-admin-route.test.ts` if a colocated test file is the project convention. Otherwise add a new test file at `apps/admin/src/routes/_authed/_tenant/spaces/index.test.tsx`.

**Approach:**
- Add `description: string | null` to the `SpaceRow` type and to the row mapper in `rows` `useMemo` (pull from `space.description`).
- Insert a new column between `name` and `accessMode`:
  ```text
  { accessorKey: "description", header: "Description",
    cell: row → <div className="text-muted-foreground text-sm truncate overflow-hidden">
                  {row.original.description ?? "—"}
                </div>,
    // no `size` — flex-1 by default
  }
  ```
- Other columns keep their existing `size` fields so Description is the only flex column.
- `SpacesListQuery` already returns `description` — no GraphQL change.

**Patterns to follow:** `apps/admin/src/routes/_authed/_tenant/automations/routines/index.tsx` lines 49-57 (Description column definition pattern).

**Test scenarios:**
- *Happy path:* a row with a non-null description renders the description text.
- *Edge case:* a row with a null description renders the em-dash `—`.
- *Edge case:* a long description (>200 chars) renders truncated with overflow hidden — assert the cell has `truncate overflow-hidden` classes; do not assert ellipsis pixel position (brittle).
- *Layout:* at a 1280px viewport, the table does not overflow horizontally (use a render harness that exercises the parent layout; if too complex for unit scope, document this as a smoke verification step instead).

**Verification:** `pnpm --filter @thinkwork/admin test spaces` passes. Manual: open the Spaces page, confirm Description column appears, populates from `space.description`, truncates without horizontal scroll.

---

### U3. Triggers route rename + default-tab redirect flip

**Goal:** Rename the automations route to triggers, delete the old route, flip the `$spaceId.tsx` default redirect from `/configuration` to `/workspace`, and update post-navigation calls in `spaces/index.tsx`.

**Requirements:** R3, R11, R12.

**Dependencies:** None (U4's chrome tab changes reference the new path, so U3 must land first or in the same PR).

**Files:**
- Create: `apps/admin/src/routes/_authed/_tenant/spaces/$spaceId_.triggers.tsx` (copy of current automations.tsx with route id updated and `activeTab="triggers"`).
- Delete: `apps/admin/src/routes/_authed/_tenant/spaces/$spaceId_.automations.tsx`.
- Modify: `apps/admin/src/routes/_authed/_tenant/spaces/$spaceId.tsx` (redirect target → `/spaces/$spaceId/workspace`).
- Modify: `apps/admin/src/routes/_authed/_tenant/spaces/index.tsx` (post-create navigate + row-click navigate → `/spaces/$spaceId/workspace`).
- Regenerate: `apps/admin/src/routeTree.gen.ts` (auto-generated by tanstack-router; do not hand-edit beyond running the generator).

**Approach:**
- Copy `$spaceId_.automations.tsx` to `$spaceId_.triggers.tsx`. Update:
  - `createFileRoute("/_authed/_tenant/spaces/$spaceId_/triggers")`
  - `<SpaceDetailChrome activeTab="triggers">`
- Delete the old `$spaceId_.automations.tsx` file.
- In `$spaceId.tsx`, change `to="/spaces/$spaceId/configuration"` → `to="/spaces/$spaceId/workspace"`.
- In `spaces/index.tsx`, update the two `navigate({ to: "/spaces/$spaceId/configuration", ... })` call sites (post-create + row-click) to `/spaces/$spaceId/workspace`.
- Regenerate `routeTree.gen.ts`: this is handled by the `TanStackRouterVite` plugin in `apps/admin/vite.config.ts` — it auto-regenerates during `pnpm --filter @thinkwork/admin dev` (file watch) or `pnpm --filter @thinkwork/admin build` (one-shot). There is no separate router CLI; `pnpm codegen` in apps/admin is GraphQL codegen, unrelated to the route tree.

**Patterns to follow:** `$spaceId_.workspace.tsx`, `$spaceId_.members.tsx` — minimal route files that render the chrome with a panel.

**Test scenarios:**
- *Route happy path:* navigating to `/spaces/:id/triggers` renders the chrome with `activeTab="triggers"` and the panel.
- *Old route absent:* verify the route file `$spaceId_.automations.tsx` no longer exists and `routeTree.gen.ts` does not contain `automations` in the space subtree. This is a static file-content assertion — easier and more reliable than testing tanstack-router 404 behavior in a vitest harness.
- *Default redirect:* navigating to `/spaces/:id` redirects to `/spaces/:id/workspace` (use the existing `-spaces-admin-route.test.ts` harness or add a small assertion that `<Navigate>` target is `/workspace`).
- *Post-create navigate:* creating a Space via `NewSpaceDialog` navigates to `/spaces/:id/workspace` (assert against the `navigate` mock).
- *Row click:* clicking a row navigates to `/spaces/:id/workspace`.

**Verification:** `routeTree.gen.ts` no longer contains `automations` for the space subtree but does contain `triggers`. Dev server boots without route errors. Manual: visit `/spaces`, click a row, land on `/spaces/:id/workspace`.

---

### U4. SpaceDetailChrome: tab reorder + rename + route URL flips + `headerActions` slot

**Goal:** Reorder the tab list to **Workspace · KBs · Triggers · Settings · Members**, rename labels accordingly, flip the corresponding route URLs (`/memory→/kbs`, `/configuration→/settings`) to match the Triggers rename pattern, and extend `SpaceDetailChrome` with a `headerActions` slot consumed by the existing right-side header area.

**Requirements:** R2, R4, R5.

**Dependencies:** U3 (`/triggers` route exists). U3 and U4 land together since the chrome tabs reference all three renamed paths.

**Files:**
- Modify: `apps/admin/src/components/spaces/SpaceDetailChrome.tsx`
- Create: `apps/admin/src/routes/_authed/_tenant/spaces/$spaceId_.kbs.tsx` (copy of memory.tsx with route id + activeTab updated)
- Create: `apps/admin/src/routes/_authed/_tenant/spaces/$spaceId_.settings.tsx` (copy of configuration.tsx with route id + activeTab updated). U7 makes additional edits to this file.
- Delete: `apps/admin/src/routes/_authed/_tenant/spaces/$spaceId_.memory.tsx`
- Delete: `apps/admin/src/routes/_authed/_tenant/spaces/$spaceId_.configuration.tsx`
- Regenerate: `apps/admin/src/routeTree.gen.ts` (auto-generated; do not hand-edit)

**Approach:**
- Commit to flipping URLs for both `/memory→/kbs` and `/configuration→/settings`, mirroring the Triggers route rename in U3. Rationale: consistency — partial URL flip would leave the admin URL surface mixed (some new labels with new URLs, others with stale URLs). Old URLs 404 cleanly per the same admin-only-surface rationale used in KTD2.
- Update `SpaceDetailTab` type union: `"workspace" | "kbs" | "triggers" | "settings" | "members"`.
- Add a `headerActions` prop to `SpaceDetailChrome`:
  ```text
  <SpaceDetailChrome
    spaceId
    activeTab
    headerActions={(ctx) => <YourActionComponent space={ctx.space} />}
  >
    {(ctx) => <YourPanel space={ctx.space} ... />}
  </SpaceDetailChrome>
  ```
  Signature: `headerActions?: (ctx: { space, draft, setDraft, refreshSpace }) => ReactNode`. The chrome calls it inside the same render path that yields `space`, so route files don't need to fetch space independently. Always a function, never a static ReactNode — single shape avoids the two-shape ambiguity.

- Inside the chrome, render the right slot as:
  - If `headerActions` provided: call `headerActions(ctx)` and render the result.
  - Else if `dirty`: render the existing Save button.
  - Else: empty.

- Tabs list, in order:
  - Workspace (link `/spaces/$spaceId/workspace`)
  - KBs (link `/spaces/$spaceId/kbs`)
  - Triggers (link `/spaces/$spaceId/triggers`)
  - Settings (link `/spaces/$spaceId/settings`)
  - Members (conditional on `accessMode === "PRIVATE"`, link `/spaces/$spaceId/members`)

**Patterns to follow:** Existing chrome `TabsList` structure; the existing `accessMode === "PRIVATE"` gate for Members.

**Test scenarios:**
- *Tab order:* tabs render in the order Workspace · KBs · Triggers · Settings · Members.
- *Labels:* tab text is "Workspace" / "KBs" / "Triggers" / "Settings" / "Members" (no "Memory", no "Configuration", no "Automations").
- *Member gate:* Members tab renders only when `space.accessMode === "PRIVATE"`.
- *Header actions slot:* when `headerActions={(ctx) => <Add space={ctx.space} />}` is passed, the chrome calls the function with the chrome context (space, draft, setDraft, refreshSpace) and renders the returned ReactNode in the right slot.
- *Save fallback:* when no `headerActions` is passed AND the draft is dirty, the Save button still renders.
- *Save scope:* when `headerActions` IS passed AND the draft is dirty, render `headerActions` (the per-tab action wins — Save only ever fires on Settings, which doesn't pass headerActions).

**Verification:** `pnpm --filter @thinkwork/admin test SpaceDetailChrome` passes. Manual: visit each tab, confirm the right slot updates correctly.

---

### U5. Members panel restructure

**Goal:** Split the User column into User + Email, remove the in-panel subheader, and route the Add button through the chrome's new `headerActions` slot.

**Requirements:** R8, R9, R10.

**Dependencies:** U4 (`headerActions` slot must exist).

**Files:**
- Modify: `apps/admin/src/components/spaces/SpaceMembersPanel.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/spaces/$spaceId_.members.tsx` (route file passes the Add button into chrome via `headerActions`)
- Modify (or augment): an existing Members panel test if one exists; otherwise create `apps/admin/src/components/spaces/SpaceMembersPanel.test.tsx`.

**Approach:**
- Columns redefined:
  - `User`: cell renders `row.original.name` only (truncate). Drop the email line under the name.
  - `Email`: new column, `accessorKey: "email"`, cell renders `<span className="text-muted-foreground text-sm truncate overflow-hidden">{row.original.email || "—"}</span>`. Apply the same flex-1 styling, OR give it a reasonable fixed `size` if a fixed width reads better in dense rows (recommend flex-1 to match the Description pattern from other tables, since email addresses vary in length).
  - Role, Joined, actions: unchanged.
- Delete the entire `<div className="flex items-center justify-between gap-3">` block that contains the h2 + paragraph + `<Button>Add member</Button>` (lines 180-192).
- The component still owns `addOpen` state + `<AddSpaceMemberDialog>`. Lift the Add button into the **route file**:
  - The route file imports `SpaceMembersPanel` and a reference to its `openAdd: () => void` callback. Simplest mechanism: lift `addOpen` state into the route file and pass `open` + `onOpenChange` props down to `SpaceMembersPanel` (which now becomes mostly stateless re: the dialog), OR expose a `ref` / imperative handle. Cleanest: lift state into route file.
  - Route file passes `headerActions={space.accessMode === "PRIVATE" ? <Button size="sm" onClick={() => setAddOpen(true)}><UserPlus className="h-3.5 w-3.5"/>Add</Button> : null}` to `SpaceDetailChrome`.
  - `SpaceMembersPanel` receives `addOpen` + `setAddOpen` as props (or the route can pass a `dialogElement` already-instantiated, but lifting state keeps the dialog colocated with the panel).

**Patterns to follow:** existing `SpaceMembersPanel` columns; existing post-action `reexecute` flow.

**Test scenarios:**
- *Column split happy path:* a row with `name="Eric Odom"` and `email="eric@thinkwork.ai"` renders the name in the User cell and the email in a separate Email cell.
- *Edge case:* a row with no email (rare but possible) renders `—` in the Email cell.
- *Edge case:* a row where name is missing (member.user is null) — current behavior falls back to email-as-name; preserve that, so User cell shows the email and Email cell shows the email too. Note: arguable. Confirm with implementation whether to suppress duplicate in Email when User fell back to email; planning-time default: **do show the email in both cells when name is null** (loud and consistent over silent dedup).
- *Subheader removed:* the rendered panel does not contain the h2 "Members" or the paragraph "People who can access this private Space."
- *Add button location:* the panel does not render its own Add button; the chrome header right slot renders an `<Add>` button when `accessMode === "PRIVATE"`.
- *Add button hidden on public:* when `accessMode === "PUBLIC"`, the chrome's right slot does not render an Add button (members tab is also not present in tabs).
- *Add button click:* clicking the chrome's Add button opens the `<AddSpaceMemberDialog>`.

**Verification:** `pnpm --filter @thinkwork/admin test SpaceMembersPanel` passes. Manual: open a private Space's Members tab, confirm two columns, no subheader, chrome-right-slot Add button works.

---

### U6. Triggers panel: Add dropdown + Description column + email synthetic row

**Goal:** Replace the two in-panel Add buttons with a single chrome-header Add dropdown (Schedule / Webhook / Email), replace the "Schedule / Trigger" column with a Description column using `<CopyLinkButton>` for URL/email content, and insert a synthetic email row when `emailTriggersEnabled` is true.

**Requirements:** R13, R14, R15, R16, R17, R18.

**Dependencies:** U1 (CopyLinkButton), U3 (route exists), U4 (`headerActions` slot exists).

**Files:**
- Modify: `apps/admin/src/components/spaces/SpaceDetailChrome.tsx` (the `SpaceAutomationsPanel` export — rename to `SpaceTriggersPanel` for clarity; or keep the name and re-export an alias for back-compat. Recommend: **rename** since U3 already renamed the route file and there's no other consumer.)
- Modify: `apps/admin/src/routes/_authed/_tenant/spaces/$spaceId_.triggers.tsx` (route file passes Add dropdown into chrome via `headerActions`)
- Modify (test): `apps/admin/src/components/spaces/SpaceTriggersPanel.test.tsx` (create or augment)
- Reuse: existing `ScheduledJobFormDialog`, `WebhookFormDialog`, `SetSpaceEmailTriggersMutation`.

**Approach:**
- Rename `SpaceAutomationsPanel` → `SpaceTriggersPanel`. Update the export in `SpaceDetailChrome.tsx` and the import in the renamed route file.
- Update the `SpaceAutomationRow` type union: add `"email"` to `kind`.
- Extend `SPACE_AUTOMATION_TYPE_LABELS` if helpful; or just hardcode `typeLabel: "Email"` for the synthetic row.
- `rows` `useMemo` now also depends on `space.emailTriggersEnabled` and the derived email address:
  - When `emailTriggersEnabled === true`, prepend one synthetic row:
    - `kind: "email"`, `typeLabel: "Email"`, `name: "Email trigger"` (literal label; do not concatenate the Space name — keeps it obviously generic), `description: emailAddress`, `enabled: true`, `lastRunAt: null`, `nextRunOrDeliveryAt: null`, `createdAt: <some sentinel — e.g., the Space's createdAt>` so sort doesn't crash.
- **Remove** the "Schedule / Trigger" column.
- **Add** a "Description" column (between "Type" and "Status", no `size`):
  - schedule kind: render `<span>{formatAutomationSchedule(scheduleExpression)}</span>` (keep the current formatter; humanizer is deferred).
  - webhook kind: render `<div className="flex items-center gap-2 min-w-0"><code className="truncate text-xs">{webhookUrl}</code><CopyLinkButton text={webhookUrl} aria-label="Copy webhook URL"/></div>`.
  - email kind: render the same shape with the email address.
  - **Webhook URL construction:** add `token: string` to the `WebhookRow` type (it's already returned by `listWebhooks` per `packages/api/src/handlers/webhooks-admin.ts` line 162) and construct the URL client-side as `${import.meta.env.VITE_API_URL || ""}/webhooks/${token}` — the same pattern used in `apps/admin/src/routes/_authed/_tenant/automations/webhooks/$webhookId.tsx` line 300. No backend change.
- **Remove** the two in-panel `<Button>Add Webhook</Button>` + `<Button>Add Schedule</Button>` block at the top of the panel.
- Lift `scheduleDialogOpen` + `webhookDialogOpen` state into the route file (so the chrome's Add dropdown can open them), OR keep state inside the panel and pass a callback up via a `ref` / imperative handle / context. Cleanest: lift state to the route file, pass `onAddSchedule`, `onAddWebhook`, `onAddEmail` callbacks down to the panel (which only owns row rendering + the existing dialog mounts that consume the open state).
- The route file's `headerActions`:
  ```text
  <DropdownMenu>
    <DropdownMenuTrigger asChild><Button size="sm"><Plus/>Add</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={onAddSchedule}>Schedule</DropdownMenuItem>
      <DropdownMenuItem onSelect={onAddWebhook}>Webhook</DropdownMenuItem>
      <DropdownMenuItem onSelect={onAddEmail} disabled={space.emailTriggersEnabled}>Email</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
  ```
- `onAddEmail` callback: fires `SetSpaceEmailTriggersMutation({ spaceId, enabled: true })` then calls `refreshSpace()` so the synthetic row appears immediately.
- Email row click: opens a confirmation modal asking "Disable email trigger for this Space?". On confirm: fires `SetSpaceEmailTriggersMutation({ spaceId, enabled: false })` and refetches. On cancel: closes. Place the modal inline in the panel (reuse `AlertDialog` from shadcn).

**Patterns to follow:**
- `apps/admin/src/components/spaces/SpaceMembersPanel.tsx` for `DropdownMenu` usage (the row-actions menu) — same shadcn primitive.
- `formatAutomationSchedule` / `estimateNextAutomationRun` stay as-is.
- The existing `webhook` and `schedule` data-fetch flow (`spaceApiFetch`) is unchanged.

**Test scenarios:**
- *Email row presence (happy path):* with `space.emailTriggersEnabled === true`, the rendered table includes one row where `typeLabel === "Email"` and the description cell contains the derived email address.
- *Email row absence:* with `emailTriggersEnabled === false`, the table contains no email row.
- *Description for webhook:* a webhook row's description cell contains the webhook URL inside a `<code>` and a `<CopyLinkButton>` adjacent to it.
- *Description for schedule:* a schedule row's description cell renders the `formatAutomationSchedule()` output (e.g., for `rate(1 day)` it shows `"1 day"`; for `at(2026-06-01T06:00:00Z)` it shows the locale-formatted date).
- *Description for email:* an email row's description cell contains the email address and a `<CopyLinkButton>`.
- *Old column gone:* the rendered table does NOT contain a column header "Schedule / Trigger".
- *Add dropdown items:* the chrome-header Add button opens a menu with exactly three items: Schedule, Webhook, Email.
- *Email item disabled when on:* with `emailTriggersEnabled === true`, the Email menu item is `disabled` (no second-add path).
- *Schedule item opens existing dialog:* clicking Schedule sets `scheduleDialogOpen` true and `<ScheduledJobFormDialog>` renders.
- *Webhook item opens existing dialog:* clicking Webhook sets `webhookDialogOpen` true and `<WebhookFormDialog>` renders.
- *Email item enables triggers:* with `emailTriggersEnabled === false`, clicking Email fires `SetSpaceEmailTriggersMutation` with `enabled: true` and triggers a refresh.
- *Email row click → disable confirmation:* clicking the email row opens an `<AlertDialog>` with a confirm action that fires `SetSpaceEmailTriggersMutation` with `enabled: false`.
- *Two-Add-button block gone:* the rendered panel does NOT contain an `<Add Webhook>` or `<Add Schedule>` button at the top of the section.

**Verification:** `pnpm --filter @thinkwork/admin test SpaceTriggersPanel` passes. Manual: enable email triggers via the dropdown, see the synthetic row, click it, confirm the disable modal works.

---

### U7. Settings panel: rename field label, remove EmailTriggersToggle, delete dead component

**Goal:** Flip the Configuration panel's field label back to "Description", remove the `<SpaceEmailTriggersToggle>` render from the Settings panel, and delete the now-unused `SpaceEmailTriggersToggle.tsx` component file + tests.

**Requirements:** R6, R7.

**Dependencies:** U6 (the synthetic email row in the Triggers tab must be reachable BEFORE removing the toggle, so users always have a way to manage email triggers).

**Files:**
- Modify: `apps/admin/src/components/spaces/SpaceDetailChrome.tsx` (the `SpaceConfigurationPanel` export — rename to `SpaceSettingsPanel`; flip label; drop the import + render of `SpaceEmailTriggersToggle`)
- Delete: `apps/admin/src/components/spaces/SpaceEmailTriggersToggle.tsx`
- Delete: `apps/admin/src/components/spaces/SpaceEmailTriggersToggle.test.tsx`
- Verify (search): no other consumer imports `SpaceEmailTriggersToggle`. If any are found, route them through U6's Add dropdown / synthetic row instead.

**Approach:**
- In `SpaceDetailChrome.tsx`'s settings panel (currently `SpaceConfigurationPanel`), change `<Label htmlFor="space-description">Instructions</Label>` → `<Label htmlFor="space-description">Description</Label>`.
- Delete the `import { SpaceEmailTriggersToggle } from "@/components/spaces/SpaceEmailTriggersToggle"` line.
- Delete the JSX block that renders `<SpaceEmailTriggersToggle .../>`.
- Rename `SpaceConfigurationPanel` → `SpaceSettingsPanel` (export name + all import sites).
- Delete `SpaceEmailTriggersToggle.tsx` and its test file — the synthetic email row in U6 + the Add dropdown + the existing `SetSpaceEmailTriggersMutation` cover all the toggle's previous user behaviors.
- Grep before deleting to confirm nothing else imports `SpaceEmailTriggersToggle` (apps/admin, packages, anywhere). The mutation `SetSpaceEmailTriggersMutation` from `lib/graphql-queries.ts` is preserved — U6 calls it directly.

**Patterns to follow:** Existing panel section structure; existing `<Label>` + `<Textarea>` shadcn pattern.

**Test scenarios:**
- *Label flip:* the field label adjacent to the Description textarea reads "Description" (not "Instructions").
- *Textarea wiring unchanged:* typing into the Description textarea still updates `draft.description`.
- *Save still works:* changing the description, clicking the chrome Save button, fires `UpdateSpaceMutation` with the new description.
- *EmailTriggersToggle removed:* the rendered Settings panel does NOT contain the email-triggers card (no `<Mail/>` icon, no "Email Triggers" label, no `[email]@[tenant].thinkwork.ai` code block).
- *Email triggers still manageable:* navigate to the Triggers tab — verify the email synthetic row + Add dropdown still work end-to-end (this is an integration check, may be a manual verification step).
- *Dead component deletion:* `SpaceEmailTriggersToggle.tsx` and its test no longer exist. `pnpm --filter @thinkwork/admin lint` does not report missing imports.

**Verification:** `pnpm --filter @thinkwork/admin test` passes for the renamed panel. Grep confirms no remaining imports of `SpaceEmailTriggersToggle`. Manual: open Settings tab, label says Description, no email-triggers card.

---

## System-Wide Impact

- **Routes affected:** All three URL flips are committed in U3–U4 for consistency: `/spaces/:id/automations → /triggers`, `/spaces/:id/memory → /kbs`, `/spaces/:id/configuration → /settings`. Old routes deleted, no redirects (KTD2 rationale applied to all three).
- **Auto-generated files:** `apps/admin/src/routeTree.gen.ts` regenerates after each route file rename / delete. Do not hand-edit.
- **Tests:** vitest. Suites located colocated with components or in `routes/_authed/_tenant/spaces/-spaces-admin-route.test.ts`.
- **GraphQL:** no schema or query changes. `SpacesListQuery` already returns `description`; `SetSpaceEmailTriggersMutation` is unchanged.
- **Other admin pages:** none. The shared `<CopyLinkButton>` is new — only Spaces consumes it on landing.
- **Backend, agentcore, terraform:** no changes.

---

## Risks & Mitigations

- **Risk:** Lifting `addOpen` / dialog state into route files (for U5, U6) creates more prop drilling and could make the route files heavier than expected.
  **Mitigation:** If route files grow past ~80 lines or feel awkward, refactor toward a context inside `SpaceDetailChrome` provider (KTD1 alternative). Don't preemptively do this — wait for the smell.

- **Risk:** Deleting `/automations` will break any external bookmarks or sidebar links someone has saved.
  **Mitigation:** Per KTD2, accepted as low-risk for an admin-only surface. If reported post-merge, add a redirect file (cheap follow-up).

---

## Verification & Done

The plan is complete when:

- The Spaces list shows a Description column that flexes and truncates with no horizontal scroll at 1280px (R1).
- Opening any Space lands on `/spaces/:id/workspace` (R3) and the tabs render Workspace · KBs · Triggers · Settings · Members in that order (R2, R4).
- Members tab has the chrome-header Add button (gated on PRIVATE), email in its own column, and no in-panel subheader (R8–R10).
- Triggers tab has a chrome-header Add dropdown (Schedule / Webhook / Email) with the Email item disabled when already enabled, a Description column with copy-link affordances for URL and email rows, and the synthetic email row appears iff `emailTriggersEnabled` is true (R13–R18).
- Settings tab's field label reads "Description" and the Email Triggers card is gone (R6–R7).
- `/spaces/:id/automations` 404s (R12).
- All vitest suites in `apps/admin` pass after the changes.
- `pnpm format:check && pnpm lint && pnpm typecheck` clean in `apps/admin`.

---

## Open Items

(None remaining. Webhook URL field availability was confirmed via doc-review: `packages/api/src/handlers/webhooks-admin.ts` already returns `token` in the list response, and the URL is constructed client-side as `${VITE_API_URL}/webhooks/${token}` — same pattern used by the webhook detail page at `apps/admin/src/routes/_authed/_tenant/automations/webhooks/$webhookId.tsx`. U6 pulls `token` into `WebhookRow` and constructs the URL in the description cell — no backend change.)
