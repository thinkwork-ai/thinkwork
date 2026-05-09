---
title: apps/computer UI polish — page titles, sidebar collapse UX, threads scroll, hero spacing
type: feat
status: active
date: 2026-05-09
---

# apps/computer UI polish — page titles, sidebar collapse UX, threads scroll, hero spacing

## Summary

Five bounded UI polish items in `apps/computer`: port admin's dynamic per-route HTML title (`PageName · ThinkWork`) so browser tabs identify the current page; relocate the sidebar collapse trigger from the top bar into the sidebar; make the brain logo expand the sidebar when collapsed; add right padding to the collapsed sidebar rail so icons read as centered; restructure the threads-list view so only the list scrolls (mirroring `apps/admin`'s threads page layout); and add vertical space between the composer and starter-card grid on the New Thread hero.

---

## Problem Frame

`apps/computer` is the new operator-facing workspace, and a few rough edges in the chrome and threads list undermine its polish. Browser tabs all read `ThinkWork Computer` regardless of which page is open (admin solved this with a `BreadcrumbContext`-driven dynamic title). The sidebar collapse trigger lives outside the sidebar in the top bar, which puts a chrome control adjacent to page content; users also expect the brain logo to be the natural expand affordance when the rail is collapsed. The collapsed rail's icons sit flush-left rather than centered. The Computer threads-list view scrolls as a whole page instead of pinning the title/search header and scrolling only the list — a layout `apps/admin/src/routes/_authed/_tenant/threads/index.tsx` already gets right via `PageLayout` + `flex-1 overflow-y-auto min-h-0`. And on the hero, the starter-card grid butts up against the composer with too little breathing room.

None of these touch the runtime, schema, or GraphQL. All five live entirely in `apps/computer/src/`.

---

## Requirements

- R1. Visiting any computer route sets the document title to `<PageName> · ThinkWork` (middle dot `·`), matching admin's dynamic title format. Pre-hydration fallback in `apps/computer/index.html` is `ThinkWork`.
- R2. The sidebar collapse trigger renders inside the sidebar (not in `AppTopBar`); the `apps/computer/src/components/AppTopBar.tsx` no longer renders `<SidebarTrigger>`.
- R3. When the sidebar is collapsed, clicking the brain logo expands it. When the sidebar is expanded, the brain logo continues to behave as a `Link` to `COMPUTER_WORKBENCH_ROUTE`.
- R4. When the sidebar is collapsed, icons appear visually centered in the rail (right padding on the rail container balances the existing left padding so icons no longer read as flush-left).
- R5. The threads-list view (`ComputerWorkbench` threads-mode) does not scroll as a whole page. The title block ("Computer", thread count, search input) stays fixed; only the threads list scrolls.
- R6. On the New Thread hero, there is a clear vertical gap between `ComputerComposer` and `StarterCardGrid` — enough to read as a deliberate section break, not a tight stack.
- R7. No GraphQL schema, resolver, Lambda, or terraform changes. All changes are limited to `apps/computer/src/` and `apps/computer/index.html`.

---

## Key Technical Decisions

- **Port admin's title mechanism rather than create a new one.** Admin's `BreadcrumbContext.tsx` already implements `document.title = ${title} · ThinkWork` as a side effect of `useBreadcrumbs([{ label }])`. Port the same provider + hook into `apps/computer/src/context/BreadcrumbContext.tsx` and wrap the app in `apps/computer/src/main.tsx`. Per-route page components call `useBreadcrumbs([{ label: "Computer" }])`. Rationale: identical shape across apps reduces cognitive load; lifting into a shared package is a separate refactor outside this plan's scope.
- **Sidebar collapse trigger lives inside the sidebar header, next to the brain logo.** Use the existing shadcn `<SidebarTrigger>` primitive — only the host changes. Deleting the trigger from `AppTopBar` leaves the top bar otherwise intact.
- **Brain logo expand-on-click is conditional, not a swap.** When `state === "collapsed"` (read from shadcn's `useSidebar()`), the logo's click handler calls `setOpen(true)` and prevents the `Link` navigation; when expanded, the `Link` to `COMPUTER_WORKBENCH_ROUTE` works as it does today. Rationale: preserves the existing nav affordance and avoids a structural swap that would re-render the logo node.
- **Collapsed rail padding applied at the container level.** One `pr-*` token on the rail container — not on each menu item — keeps icon centering as a group property.
- **Threads-list restructure mirrors admin's pattern in place.** The threads-mode branch inside `apps/computer/src/components/computer/ComputerWorkbench.tsx` is rewritten to a `flex flex-col` parent with a `shrink-0` header (title + count + search) and a `flex-1 overflow-y-auto min-h-0` list body. The hero-mode branch is untouched. Rationale: keeps the change local to the file the user already pointed at and avoids a cross-app component lift.

---

## Implementation Units

### U1. Port dynamic page-title mechanism + register per-route titles

**Goal:** Browser tabs read `<PageName> · ThinkWork` as the user navigates inside `apps/computer`.

**Requirements:** R1, R7

**Dependencies:** none

**Files:**
- create `apps/computer/src/context/BreadcrumbContext.tsx`
- modify `apps/computer/src/main.tsx` (wrap app in `BreadcrumbProvider`)
- modify `apps/computer/index.html` (`<title>ThinkWork</title>`)
- modify `apps/computer/src/routes/_authed/_shell/computer.tsx` (call `useBreadcrumbs([{ label: "Computer" }])`)
- modify `apps/computer/src/routes/_authed/_shell/apps.index.tsx` (`Apps`)
- modify `apps/computer/src/routes/_authed/_shell/apps.$id.tsx` (per-app label or fallback)
- modify `apps/computer/src/routes/_authed/_shell/automations.tsx` (`Automations`)
- modify `apps/computer/src/routes/_authed/_shell/inbox.tsx` (`Inbox`)
- modify `apps/computer/src/routes/_authed/_shell/tasks.index.tsx` (`Tasks`)
- modify `apps/computer/src/routes/_authed/_shell/tasks.$id.tsx` (per-task label or fallback)
- modify `apps/computer/src/routes/_authed/_shell/threads.$id.tsx` (per-thread label or fallback)
- create `apps/computer/src/context/BreadcrumbContext.test.tsx`

**Approach:** Mirror the structure of `apps/admin/src/context/BreadcrumbContext.tsx` verbatim — `BreadcrumbProvider`, `useBreadcrumbs(crumbs)`, and the `useEffect` that sets `document.title = ${last-crumb-label} · ThinkWork` (and resets to `ThinkWork` on unmount). Wrap the React tree in `apps/computer/src/main.tsx` at the same nesting level admin uses. Each leaf route calls `useBreadcrumbs` with a single-entry array; detail routes (`apps.$id`, `tasks.$id`, `threads.$id`) use the loaded entity's title when available with a sensible fallback. Update `apps/computer/index.html`'s static `<title>` to `ThinkWork` so the pre-hydration tab text matches the dot-suffix shape.

**Patterns to follow:** `apps/admin/src/context/BreadcrumbContext.tsx`; `apps/admin/src/routes/_authed/_tenant/threads/index.tsx` for `useBreadcrumbs` call site shape.

**Test scenarios:**
- Rendering `BreadcrumbProvider` with a child that calls `useBreadcrumbs([{ label: "Computer" }])` sets `document.title` to `Computer · ThinkWork`.
- Unmounting that child resets `document.title` to `ThinkWork`.
- Calling `useBreadcrumbs([{ label: "Apps" }])` after `Computer` updates `document.title` to `Apps · ThinkWork` (latest registration wins).
- Calling `useBreadcrumbs([])` (or not calling it) leaves the static fallback `ThinkWork` in place.

**Verification:** Tab title updates as the user clicks through Computer / Tasks / Apps / Automations / Inbox in dev. Static `index.html` fallback reads `ThinkWork` before React hydrates.

---

### U2. Move sidebar collapse trigger into sidebar; brain logo expands when collapsed; right padding on collapsed rail

**Goal:** The sidebar owns its own collapse UX. The trigger lives inside the sidebar header next to the brain logo, the logo itself is the expand affordance when collapsed, and collapsed icons read as visually centered.

**Requirements:** R2, R3, R4, R7

**Dependencies:** none

**Files:**
- modify `apps/computer/src/components/ComputerSidebar.tsx`
- modify `apps/computer/src/components/AppTopBar.tsx`

**Approach:** In `ComputerSidebar.tsx`, render `<SidebarTrigger />` inside the sidebar header region (alongside or directly under the brain logo / "ThinkWork / Cloud Computer" block — implementer chooses the cleanest placement against the current header markup). Wrap the brain logo's existing `<Link to={COMPUTER_WORKBENCH_ROUTE}>` so that an `onClick` handler reads shadcn's `useSidebar()` state: when `state === "collapsed"`, call `setOpen(true)` and `event.preventDefault()` to suppress navigation; when expanded, let the `Link` navigate as today. Add a `pr-*` Tailwind token on the rail container element (the parent that holds menu items) so collapsed-state icons sit visually centered against the existing left padding — exact value chosen by visual fit, expected `pr-1.5` or `pr-2`. In `AppTopBar.tsx`, delete the `<SidebarTrigger className="-ml-1" />` line and any wrapping container that becomes empty.

**Patterns to follow:** Existing `useSidebar()` hook usage from shadcn (already imported by `ComputerSidebar.tsx`); existing brain-logo `<Link>` wrapping in `ComputerSidebar.tsx`.

**Test scenarios:**
- Component test: rendering `ComputerSidebar` shows a `SidebarTrigger` inside the sidebar header (not in `AppTopBar`).
- Component test: rendering `AppTopBar` no longer renders any `SidebarTrigger`.
- Component test: clicking the brain logo while sidebar `state === "collapsed"` toggles `open` to `true` (mock `useSidebar`); navigation does not fire.
- Component test: clicking the brain logo while sidebar is expanded does not call `setOpen` and the `Link`'s default behavior is preserved.
- Visual: collapsed rail icons read as centered (manual dev-server check).

**Verification:** Dev server — click the new in-sidebar trigger to collapse; click the brain logo and the sidebar expands; icons appear centered in the collapsed rail; the top bar no longer carries the trigger.

---

### U3. Restructure threads-list view to match admin's fixed-header / scrolling-body pattern

**Goal:** The Computer threads-list view does not page-scroll. The "Computer" title, count, and search input stay pinned; only the threads list scrolls.

**Requirements:** R5, R7

**Dependencies:** none (independent of U1/U2; can land separately)

**Files:**
- modify `apps/computer/src/components/computer/ComputerWorkbench.tsx`
- modify `apps/computer/src/components/computer/ComputerWorkbench.test.tsx` (if existing tests assert layout structure that changes; add scroll-structure assertion otherwise)

**Approach:** In `ComputerWorkbench.tsx`'s threads-mode branch, replace the current centered-`max-w` block with a `flex flex-col h-full min-h-0` container. Inside: a `shrink-0` header section holding the "Computer" title, "N threads" subtitle, and search input; below it a `flex-1 overflow-y-auto overflow-x-hidden min-h-0` body that contains the threads list. Match the structural pattern from `apps/admin/src/routes/_authed/_tenant/threads/index.tsx` and `apps/admin/src/components/PageLayout.tsx` (do not import either — mirror the structure inline so the change stays localized to `apps/computer`). The hero-mode branch (composer + starter cards) is untouched. The route's outer shell must already provide a height-constrained parent for `h-full` to resolve — verify by inspecting `_authed/_shell.tsx`; if not, add `h-full` / `min-h-0` upward as needed without restructuring the shell.

**Patterns to follow:** `apps/admin/src/components/PageLayout.tsx`; `apps/admin/src/routes/_authed/_tenant/threads/index.tsx` (specifically the `flex-1 overflow-y-auto overflow-x-hidden min-h-0` body wrapper).

**Test scenarios:**
- Component test: rendering `ComputerWorkbench` in threads mode produces a header element with `shrink-0` and a body element with `overflow-y-auto` (asserts on classNames or `data-testid` markers).
- Component test: rendering `ComputerWorkbench` in hero mode (no threads) is unchanged.
- Visual: with 213 threads, the title/count/search row stays visible while the list scrolls underneath; the page itself does not show a window scrollbar.

**Verification:** Dev server with seeded threads — only the list scrolls; the header row stays fixed. Window scrollbar is absent on the threads-mode view.

---

### U4. Add vertical spacing between composer and starter-card grid on New Thread hero

**Goal:** The composer and starter-card grid on the hero read as separate sections, with breathing room between them.

**Requirements:** R6, R7

**Dependencies:** none

**Files:**
- modify `apps/computer/src/components/computer/ComputerWorkbench.tsx`

**Approach:** In the hero-mode branch of `ComputerWorkbench.tsx`, add a vertical gap between the `<ComputerComposer>` element (line 81) and the `<StarterCardGrid>` element (line 89). Use a Tailwind spacing token applied to the parent flex container (`gap-*`) or as a top margin on the `StarterCardGrid` wrapper (`mt-*`) — implementer chooses the form that reads cleanest against the existing flex layout. Expected value `mt-8` or `mt-10`; final value chosen by visual fit against the screenshot reference.

**Patterns to follow:** existing spacing tokens elsewhere in `ComputerWorkbench.tsx`.

**Test scenarios:**
- Test expectation: none — pure layout/spacing change, no behavioral assertion. Verify visually.

**Verification:** Dev server hero view — clear gap between composer and "Not sure where to start?" / starter cards; layout reads as two sections, not one tight stack.

---

## Scope Boundaries

In scope:
- HTML title behavior + per-route title registration in `apps/computer`
- Sidebar trigger placement, brain-logo expand behavior, collapsed-rail padding
- Threads-list scroll structure inside `ComputerWorkbench`
- Composer ↔ starter-card spacing on hero

Out of scope (deliberately excluded):
- Renaming `apps/admin`'s `<title>` (admin already uses the dot pattern via its breadcrumbs; static fallback `ThinkWork Admin` stays)
- Renaming `apps/mobile`'s stale `Maniflow Manager` title — tracked separately
- Any GraphQL schema, resolver, Lambda, or terraform change
- Sidebar visual redesign beyond the three requested tweaks
- Restyling the starter cards or composer themselves
- Other layout/scroll changes elsewhere in `apps/computer`

### Deferred to Follow-Up Work

- Lifting `BreadcrumbContext` / `PageLayout` / `PageHeader` into a shared `@thinkwork/ui` package so admin, computer, and any future SPA reuse one implementation. Worth doing once a third app needs the same chrome — premature today.

---

## System-Wide Impact

- **Operators:** Browser tab now identifies the current computer page. Sidebar collapse UX is more discoverable (trigger lives where the user expects). Threads-list view stops jumping the page header off-screen on long lists.
- **Developers:** New `BreadcrumbContext` in `apps/computer` mirrors admin's; future page additions are expected to call `useBreadcrumbs` for their tab title.
- **Runtime / data plane:** unaffected. No backend, schema, or terraform change.

---

## Risks & Mitigations

- **Risk:** Threads-list restructure relies on the route shell providing a height-constrained parent. If `_authed/_shell.tsx` doesn't already pass `h-full` / `min-h-0` down, `flex-1 overflow-y-auto` collapses to zero height and the list disappears.
  - **Mitigation:** During U3 implementation, inspect `_authed/_shell.tsx` first and propagate the height chain upward if needed. Visual smoke test in dev with 213 seeded threads catches this immediately.
- **Risk:** Brain-logo onClick that calls `event.preventDefault()` could break the `Link` even when expanded if the conditional is wrong.
  - **Mitigation:** U2 test scenarios cover both states (collapsed: setOpen called + nav suppressed; expanded: setOpen not called + nav preserved).
- **Risk:** Per-route `useBreadcrumbs` calls may conflict if a parent and child both register titles in nested routes.
  - **Mitigation:** Mirror admin's behavior — latest registration wins; child route's title takes precedence over parent. Covered by U1 test scenario asserting latest-call wins.

---

## Verification Strategy

- **Unit / component tests:** new tests for `BreadcrumbContext` (U1) and `ComputerSidebar` / `AppTopBar` (U2) and `ComputerWorkbench` threads-mode structure (U3) pass under `pnpm --filter @thinkwork/computer test`.
- **Type/lint:** `pnpm -r --if-present typecheck` and `pnpm -r --if-present lint` pass.
- **Manual smoke (dev server):** boot `apps/computer` on port 5174+ (added to Cognito callback URLs if running concurrently with admin), exercise:
  - Tab title updates across Computer / Tasks / Apps / Automations / Inbox.
  - Sidebar trigger lives inside the sidebar; clicking it collapses/expands.
  - Brain logo click while collapsed expands the sidebar; while expanded, navigates to the Computer workbench.
  - Collapsed rail icons read as centered.
  - Threads list scrolls without moving the title/search header; window scrollbar absent.
  - Hero shows clear gap between composer and starter cards.
