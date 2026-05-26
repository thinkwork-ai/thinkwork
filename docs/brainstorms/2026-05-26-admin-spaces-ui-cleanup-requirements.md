---
title: Admin Spaces UI Cleanup
date: 2026-05-26
status: requirements
scope: lightweight
area: apps/admin
---

# Admin Spaces UI Cleanup

A focused pass over `apps/admin → Spaces` to align the list page, Space Detail chrome, and per-tab panels with the table/chrome patterns the rest of the admin already uses (Routines description column, single contextual action button in the page header, dropdown-based Add flows).

This brainstorm is intentionally **lightweight**: the user has provided a complete, prescriptive change list. The doc captures the list verbatim with enough acceptance detail that planning can break it into PRs without re-interviewing.

## Goals

- Bring the Spaces list table into the standard "flex-1 truncating description column" pattern (matches Routines).
- Make the Space Detail chrome consistent with the rest of admin: Workspace as the home tab, Settings (renamed from Configuration) as the last config-ish tab, contextual Add button right-justified in the header.
- Collapse Email Triggers from a buried Settings widget into a first-class entry in the Triggers tab alongside Webhook and Schedule.
- Tighten the Members table (separate email column, header-level Add action) and the Triggers table (Add dropdown, description column that's address-or-schedule-or-URL).

## Non-goals

- No changes to the user-facing app `apps/user` Spaces UI (see 2026-05-19-spaces-collaborative-user-app-ui-requirements.md for that surface).
- No changes to the Space data model, GraphQL schema, or backend handlers — `description` is already returned by `SpacesListQuery`, email-trigger toggle already exists, etc. If backend changes turn out to be required for "email as a trigger row" (see Open Questions §1), that's planning-time scoping.
- No restructuring of the underlying scheduled-jobs or webhooks domain entities.

## Changes

### 1. Spaces list table (`apps/admin/src/routes/_authed/_tenant/spaces/index.tsx`)

Add a **Description** column between `Space` and `Access`:

- `accessorKey: "description"`, header `"Description"`
- Cell renders `space.description ?? "—"` with classes that match Routines: `text-muted-foreground text-sm truncate overflow-hidden`.
- No `size` set — the column flexes to fill remaining width and truncates with ellipsis if the row is narrower than the content.
- Other columns keep their fixed `size` (Access 110, Status 110, Updated 130) so the description is the only flex column.

`SpacesListQuery` already returns `description` — no GraphQL change needed.

### 2. Space Detail chrome (`apps/admin/src/components/spaces/SpaceDetailChrome.tsx`)

Tab order, labels, and default change:

| Before                                                     | After                                               |
| ---------------------------------------------------------- | --------------------------------------------------- |
| Configuration · Workspace · Memory · Automations · Members | **Workspace** · KBs · Triggers · Settings · Members |
| Default tab: Configuration                                 | Default tab: **Workspace**                          |
| "Configuration"                                            | "Settings"                                          |
| "Memory"                                                   | "KBs"                                               |
| "Automations"                                              | "Triggers"                                          |

- Rename the **Instructions** field label inside the Settings panel back to **"Description"** (label only; storage stays on `space.description`).
- Workspace becomes the default landing tab. Every place that redirects to `/spaces/$spaceId/configuration` (e.g., post-create navigate in `spaces/index.tsx`, row click) should redirect to `/spaces/$spaceId/workspace` instead.
- Members stays conditional on `accessMode === "PRIVATE"` and stays last.
- The chrome header's right slot becomes a **contextual action area**:
  - On `workspace`, `kbs`: empty (or current Save button when dirty).
  - On `triggers`: **Add** dropdown (see §5).
  - On `settings`: current Save button when draft is dirty (unchanged behavior).
  - On `members`: **Add** button (label literally `"Add"`, see §4).

### 3. Settings tab (formerly Configuration)

- Rename the in-panel `<Label>` from "Instructions" to "Description" (`SpaceDetailChrome.tsx` line 288).
- **Remove the `<SpaceEmailTriggersToggle>` section from this panel.** The Email Triggers card moves to the Triggers tab (see §5.4).
- Otherwise unchanged: Name, Access, Description (full-width Textarea).

### 4. Members tab (`apps/admin/src/components/spaces/SpaceMembersPanel.tsx`)

- **Split User into two columns.** Today the `User` cell stacks name + email on two lines. After:
  - `User` column: name only (or email if no name).
  - `Email` column: email only, separate column. Truncate-on-overflow.
- **Remove the in-panel subheader entirely** — the `<div>` containing the `<h2>Members</h2>`, the paragraph "People who can access this private Space", and the inline `Add member` button (lines 180-192).
- **Move the Add button to the chrome header**, right-justified, on the same row as the tabs:
  - Label is just `"Add"` (not "Add member").
  - Same `<UserPlus />` icon optional.
  - Wires to the existing `setAddOpen(true)` flow + `<AddSpaceMemberDialog>`.

### 5. Triggers tab (formerly Automations)

This is the largest change. Affects `SpaceAutomationsPanel` in `SpaceDetailChrome.tsx` and the route file `apps/admin/src/routes/_authed/_tenant/spaces/$spaceId_.automations.tsx`.

#### 5.1 Route + label rename

- File rename: `$spaceId_.automations.tsx` → `$spaceId_.triggers.tsx`.
- Path: `/spaces/$spaceId/automations` → `/spaces/$spaceId/triggers`.
- Tab label: `"Automations"` → `"Triggers"`.
- Any internal references (sidebar, command palette, redirect URLs in `SpaceAutomationsPanel` row-click navigation) update accordingly. Keep the row-click destinations (`/automations/schedules/:id`, `/automations/webhooks/:id`) pointing at the existing top-level automations detail routes — those routes are not in scope.

#### 5.2 Single Add dropdown

- Replace the two `Add Webhook` + `Add Schedule` buttons (lines 746-759 of `SpaceDetailChrome.tsx`) with a **single `Add` dropdown** in the chrome header right slot (not inside the panel).
- Dropdown items: **Schedule**, **Webhook**, **Email**.
  - Schedule → opens `ScheduledJobFormDialog` (existing).
  - Webhook → opens `WebhookFormDialog` (existing).
  - Email → toggles `space.emailTriggersEnabled = true` via the existing `SetSpaceEmailTriggersMutation` (see §5.4 for the model decision).
- When email is already enabled, the Email item is disabled (or hidden) so the user doesn't try to "add" a second one.

#### 5.3 Trigger table columns

| Before                                                                          | After                                                                        |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Name · Type · Schedule / Trigger · Status · Last Run · Next Run / Last Delivery | Name · Type · **Description** · Status · Last Run · Next Run / Last Delivery |

- Remove the **Schedule / Trigger** column (lines 601-609).
- Add a **Description** column in its place. Same flex-1 + truncate styling as Routines (`text-muted-foreground text-sm truncate overflow-hidden`, no `size`).
- Description content depends on `kind`:
  - `kind === "schedule"`: the human-readable schedule, e.g., `"Every day at 6am"`. Today `formatAutomationSchedule()` returns the raw `rate(...)` interior or the parsed `at(...)` date. **This requires a small upgrade** to render true human-readable strings (e.g., cron-like expressions → "Every day at 6:00 AM"). If full cron-humanizing is out of scope, ship with the current `formatAutomationSchedule` output and treat the upgrade as a follow-up.
  - `kind === "webhook"`: the webhook URL with a copy-link affordance (small copy icon button at end of cell). URL truncates with ellipsis when the cell is narrow.
  - `kind === "email"`: the derived Space email address (`${spaceSlug}@${tenantSlug}.thinkwork.ai`) with a copy-link affordance (same component as Webhook).
- The copy-link affordance reuses the same pattern as `SpaceEmailTriggersToggle` (toast/transient check icon).

#### 5.4 Email as a row

When `space.emailTriggersEnabled === true`, **one synthetic row** is inserted into the table:

- `kind: "email"`, `typeLabel: "Email"`, `name: "Email trigger"` (or `space.name + " email"`).
- `description`: the derived email address (with copy link).
- `enabled: true` (mirrors the toggle).
- `lastRunAt` / `nextRunOrDeliveryAt`: `null` (or last received email if/when the backend exposes that — out of scope here).
- Row click: navigates to a placeholder detail or opens a confirmation modal that lets the user **disable** the email trigger (parity with how Schedule/Webhook rows currently navigate to their detail page).

The "disable / delete" path for this row toggles `emailTriggersEnabled = false`.

When the toggle is off, **no email row appears** in the table.

This keeps the data model untouched — no new table, no new entity — and reuses the existing mutation and derivation helper.

## Decisions (locked 2026-05-26)

1. **Email-trigger row semantics: single synthetic row.** The existing per-Space `emailTriggersEnabled` boolean + derived address stays the source of truth. When it's on, one synthetic row appears in the Triggers table (type=Email, description=derived address with copy link). Add → Email enables the toggle; deleting/disabling the row turns it off. No new backend entity. Multiple email aliases per Space is out of scope and would need its own brainstorm.
2. **Schedule description: ship with current formatter, humanizer is a follow-up.** This work ships using `formatAutomationSchedule()`'s current output (e.g., `"24 hours"`, `"5 minutes"`, or the raw `at(...)` parsed date). Planning files a separate follow-up for true cron-to-prose conversion (`"Every day at 6:00 AM"`); not on the critical path here.

## Other notes for planning

- **Chrome action slot ↔ Settings Save button.** The chrome header's right slot becomes per-tab. Save stays scoped to Settings only (it already does — `dirty` can only become true from the Settings panel), so there's no real conflict; just don't expect Save to follow the user between tabs.
- **"Description" vs "Instructions" elsewhere.** Only the field label in Settings flips back to "Description". Strings inside the Workspace context-editor or onboarding doc copy stay as-is unless we hit a specific call-out during implementation.

## Dependencies / Assumptions

- `SpacesListQuery` already returns `description` (verified in `apps/admin/src/lib/graphql-queries.ts`).
- The existing `SetSpaceEmailTriggersMutation`, `WebhookFormDialog`, and `ScheduledJobFormDialog` are reusable as-is.
- The data-table component supports flex-1 columns when no `size` is set (verified via Routines list).
- Members tab visibility rule stays the same (`accessMode === "PRIVATE"`). The chrome's Add-on-Members header action is rendered under the same gate.
- No breaking GraphQL changes required for any item in this brainstorm.

## Success criteria

- Spaces list shows a Description column that flexes and truncates the way Routines does, no horizontal scroll appears on a 1280px-wide layout.
- Opening any Space lands the user on Workspace by default.
- Settings tab is the second-to-last tab (last for Public Spaces, second-to-last for Private). Its label reads "Settings"; its field reads "Description".
- Members tab has the email in its own column, no in-panel subheader, and a single right-justified "Add" button in the chrome header.
- Triggers tab has a single right-justified Add dropdown (Schedule / Webhook / Email), a Description column matching the Routines pattern, and a single Email row visible iff email triggers are enabled.
- All renamed routes (`/spaces/:id/triggers`) return 200 and the old `/spaces/:id/automations` either redirects or 404s cleanly (planning decides which).

## Handoff notes

- This is small enough to plan as a single PR if Open Questions 1 + 2 resolve as recommended. If you want the schedule-humanizer treated as separate work, plan in two PRs: (a) layout/rename/columns/move-add-to-chrome, (b) human-readable schedule strings.
- Touch points: `apps/admin/src/routes/_authed/_tenant/spaces/index.tsx`, `apps/admin/src/components/spaces/SpaceDetailChrome.tsx`, `apps/admin/src/components/spaces/SpaceMembersPanel.tsx`, `apps/admin/src/components/spaces/SpaceEmailTriggersToggle.tsx` (reused or extracted to copy-link affordance), the renamed route file, and any sidebar / command-palette references to `/spaces/:id/automations`.
