---
title: "fix: Polish desktop chrome drag and toolbar treatment"
type: fix
status: completed
date: 2026-05-26
origin: docs/brainstorms/2026-05-20-computer-electron-desktop-shell-requirements.md
completed_by:
  - "commit b9cd502f"
  - "commit 040da7c0"
---

# fix: Polish desktop chrome drag and toolbar treatment

## Overview

Polish the Electron-hosted `apps/spaces` desktop chrome so the New Thread surface can still drag the window when its visible top bar is hidden, toolbar icons read quieter against the dark UI, and the desktop update/restart badge has a shorter, lighter treatment. The work should be verified in the local Electron app before any PR is opened.

---

## Problem Frame

The desktop shell uses macOS `titleBarStyle: "hiddenInset"` and custom renderer chrome (see origin: `docs/brainstorms/2026-05-20-computer-electron-desktop-shell-requirements.md`). Existing `.desktop-app-header` CSS already marks visible desktop headers as draggable, but `/new` calls `usePageHeaderActions({ hideTopBar: true })`; when the sidebar header no longer spans the main content, the large top area of the New Thread page becomes non-draggable. Separately, the navigation/action icons and restart badge are too visually assertive compared with the quieter Info Panel palette shown in the screenshots.

---

## Requirements Trace

- R1. The New Thread page must expose a desktop-only draggable region across the content side even while the visible content header stays hidden.
- R2. Header navigation and action icons must be muted more than today, closer to the Info Panel's subdued icon treatment and less primary-color-forward.
- R3. The update/restart badge must be shorter, slightly smaller, and less bold while preserving its click behavior and accessible label.
- R4. The changes must be manually verified in the local desktop app before PR handoff.

**Origin flows:** F3 (autoupdate check, download, install)
**Origin acceptance examples:** AE5 (custom chrome), AE6 (update state reflected in renderer)

---

## Scope Boundaries

- Do not change Electron main-process window options unless renderer drag regions prove insufficient.
- Do not change the web/mobile top bar behavior; desktop-only branches should remain gated by `isDesktopBuild()` or desktop-specific CSS classes.
- Do not change update state-machine behavior, IPC contracts, labels, or install/download semantics.
- Do not redesign the New Thread layout beyond the invisible/hidden drag affordance.

---

## Context & Research

### Relevant Code and Patterns

- `apps/desktop/src/main/window.ts` already creates the macOS window with `titleBarStyle: "hiddenInset"` and `trafficLightPosition`.
- `apps/spaces/src/index.css` defines `.desktop-app-header` as `app-region: drag` and marks nested buttons/links as `no-drag`.
- `apps/spaces/src/routes/_authed/_shell/new.tsx` hides the page header for `/new`, creating the drag gap shown in the screenshot.
- `apps/spaces/src/components/DesktopApplicationHeader.tsx` owns the desktop content header, navigation buttons, and hidden-when-empty behavior.
- `apps/spaces/src/components/SpacesSidebar.tsx` renders desktop navigation controls in the sidebar header.
- `apps/spaces/src/components/update-banner.tsx` owns `DesktopUpdateBadge`, including the visible "Restart" badge.
- `apps/spaces/src/components/workbench/TaskThreadView.tsx` contains the Info Panel palette reference: muted `text-white/45`, `text-white/55`, and `bg-white/8` treatments.

### Institutional Learnings

- `docs/solutions/best-practices/mobile-sub-screen-headers-use-detail-layout-2026-04-23.md` reinforces that small header/chrome divergences are user-visible and should be handled through shared layout patterns when possible.
- `docs/solutions/spikes/2026-05-21-electron-oauth-cold-start-validation.md` confirms the current Electron shell path is viable; this plan should stay within the renderer chrome and avoid main-process churn.

### External References

- None. Existing Electron and Spaces patterns are sufficient.

---

## Key Technical Decisions

- Keep New Thread visually headerless, but add a desktop-only drag strip in the shell/content area so the user gets window movement without visible extra chrome.
- Prefer a shared desktop toolbar icon class or small helper treatment over one-off color edits so sidebar navigation, collapsed content navigation, thread actions, info toggle, and artifact fullscreen controls stay consistent.
- Use the Info Panel's muted visual vocabulary as a target, but adapt it to toolbar controls with accessible hover/focus states instead of copying panel-only `text-white/*` classes blindly into semantic UI surfaces.
- Keep update badge behavior inside `DesktopUpdateBadge`; only its sizing, font weight, and color intensity should change.

---

## Open Questions

### Resolved During Planning

- Should `/new` show a visible header again? No. The user's screenshot asks for a "hidden header or something"; the plan preserves the current uncluttered New Thread page and restores drag behavior invisibly.
- Is external design or Electron research required? No. The repo already has working `app-region` CSS and desktop-header tests.

### Deferred to Implementation

- Exact drag-strip height: choose during local visual verification so it covers the screenshot's red area without intercepting composer or starter-card clicks.
- Exact muted icon color: tune while the local app is running, using the Info Panel as the reference and preserving hover/focus contrast.

---

## Implementation Units

- U1. **Restore hidden New Thread drag affordance**

**Goal:** Make the content side of `/new` draggable in the desktop shell while keeping the visible New Thread page header hidden.

**Requirements:** R1, R4, origin AE5

**Dependencies:** None

**Files:**
- Modify: `apps/spaces/src/components/DesktopApplicationHeader.tsx`
- Modify: `apps/spaces/src/routes/_authed/_shell.tsx`
- Modify: `apps/spaces/src/index.css`
- Test: `apps/spaces/src/components/DesktopApplicationHeader.test.tsx`
- Test: `apps/spaces/src/routes/_authed/_shell/-shell.test.tsx`

**Approach:**
- Introduce a desktop-only hidden drag region when `DesktopApplicationHeader` would otherwise return `null` because the page header is hidden or empty while the sidebar is open.
- Keep the region visually transparent and non-layout-disruptive, likely absolute-positioned at the top of the content inset with `desktop-app-header` drag behavior.
- Ensure any interactive controls layered near the top remain `no-drag`; the drag strip must not cover buttons, composer controls, or starter-card clicks.
- Prefer the existing `.desktop-app-header` class so the implementation reuses the established app-region CSS.

**Patterns to follow:**
- `.desktop-app-header` and nested `button, a` no-drag rules in `apps/spaces/src/index.css`.
- Hidden-header behavior in `apps/spaces/src/components/DesktopApplicationHeader.tsx`.
- Desktop shell layout in `apps/spaces/src/routes/_authed/_shell.tsx`.

**Test scenarios:**
- Happy path: desktop build, sidebar open, `/new` sets `hideTopBar: true`; render includes a drag-region element but no visible "New thread" header text.
- Edge case: desktop build, route has no header actions; render still provides a drag-region element without adding visible chrome.
- Regression: sidebar collapsed; visible desktop navigation controls still render in the content header and remain clickable.
- Regression: non-desktop shell uses `AppTopBar` behavior and receives no desktop drag strip.

**Verification:**
- Local Electron app allows dragging the window from the blank top content area on New Thread.
- Composer, mention, attach, submit, and starter-card clicks still work normally.

---

- U2. **Mute desktop header icons consistently**

**Goal:** Reduce the visual intensity of header navigation/action icons across desktop chrome so they feel closer to the Info Panel's muted treatment and less primary-colored.

**Requirements:** R2, R4

**Dependencies:** U1 if the same header component is touched first

**Files:**
- Modify: `apps/spaces/src/components/DesktopApplicationHeader.tsx`
- Modify: `apps/spaces/src/components/SpacesSidebar.tsx`
- Modify: `apps/spaces/src/components/workbench/SpacesThreadDetailRoute.tsx`
- Modify: `apps/spaces/src/components/workbench/ThreadDetailActions.tsx`
- Test: `apps/spaces/src/components/DesktopApplicationHeader.test.tsx`
- Test: `apps/spaces/src/components/workbench/ThreadDetailActions.test.tsx`
- Test: `apps/spaces/src/components/workbench/SpacesThreadDetailRoute.test.tsx`

**Approach:**
- Define or inline a consistent muted toolbar control treatment for desktop header icon buttons: subdued default text color, low-contrast hover background, and no primary color unless the control is in a truly active state.
- Apply it to the sidebar trigger, back/forward buttons, thread actions ellipsis, Info button, and artifact fullscreen/minimize buttons.
- For active states such as open Info Panel or artifact fullscreen, use a restrained foreground treatment rather than bright `text-primary`.
- Preserve accessible names, button sizes, keyboard focus rings, and Radix dropdown behavior.

**Patterns to follow:**
- Info Panel muted colors in `apps/spaces/src/components/workbench/TaskThreadView.tsx`.
- Existing `text-muted-foreground hover:text-foreground` button treatment in `apps/spaces/src/components/workbench/SpacesComposer.tsx`.
- Current desktop navigation component in `apps/spaces/src/components/DesktopApplicationHeader.tsx`.

**Test scenarios:**
- Happy path: desktop navigation controls render with muted default classes and retain Back/Forward/Sidebar accessible labels.
- Happy path: thread action ellipsis keeps opening its dropdown after class changes.
- Active state: Info button and artifact fullscreen button still expose the correct aria-label/title while using muted active styling.
- Regression: tests that assert thread delete/archive dropdown behavior remain unchanged.

**Verification:**
- Local desktop screenshot shows navigation, ellipsis, and info icons are subdued relative to current screenshots while still discoverable on hover and focus.

---

- U3. **Compact the desktop update/restart badge**

**Goal:** Make the header update badge shorter, smaller, and less bold without changing update actions.

**Requirements:** R3, R4, origin F3, origin AE6

**Dependencies:** None

**Files:**
- Modify: `apps/spaces/src/components/update-banner.tsx`
- Test: `apps/spaces/src/components/update-banner.test.tsx`

**Approach:**
- Reduce `DesktopUpdateBadge` height, horizontal padding, text size, and font weight.
- Move away from the bright blue filled style toward a quieter secondary/outline treatment that still reads as actionable.
- Keep the compact labels (`Update`, progress percent, `Restart`, `Retry`) and existing title/aria-label strings.
- Keep disabled, checking/downloading spinner, and bridge action handling unchanged.

**Patterns to follow:**
- Existing `DesktopUpdateBadge` tests for click behavior and labels.
- Muted pill styles used in `apps/spaces/src/components/workbench/TaskDashboard.tsx` and Info Panel percent badges.

**Test scenarios:**
- Happy path: downloaded update renders `Restart`, has a shorter/lighter class treatment, and calls `installUpdate()` on click.
- Happy path: available update renders `Update` and still calls `downloadUpdate()`.
- Edge case: downloading update still shows compact percent text without expanding the chrome.
- Regression: disabled update state still renders no badge.

**Verification:**
- Local desktop header shows a compact Restart badge that is visibly shorter and less bold than the screenshot while retaining click behavior.

---

- U4. **Run local desktop visual verification**

**Goal:** Confirm the changes in the actual Electron desktop app before PR work starts.

**Requirements:** R4

**Dependencies:** U1, U2, U3

**Files:**
- Modify: none
- Test: none

**Approach:**
- Run the Spaces/desktop local app using the existing desktop dev flow.
- Navigate to New Thread and an existing thread detail with the Info Panel/action buttons visible.
- Capture screenshots or otherwise compare against the supplied screenshots for drag affordance, icon muting, and compact restart badge.
- If a fresh checkout/worktree lacks `apps/spaces/.env`, copy it from the primary checkout before launching as documented in `apps/desktop/README.md`.

**Patterns to follow:**
- `apps/desktop/README.md` local development instructions.

**Test scenarios:**
- Test expectation: none -- this is manual local verification, not a feature-bearing code unit.

**Verification:**
- The app is running locally in Electron.
- The user can drag the window from the New Thread blank top area.
- Header icons and Restart badge match the requested quieter visual direction closely enough to review before PR.

---

## System-Wide Impact

- **Interaction graph:** Renderer-only chrome and button styling; no GraphQL, AppSync, or Electron IPC contract changes.
- **Error propagation:** No new error paths expected.
- **State lifecycle risks:** Update state remains unchanged; only its compact renderer control changes.
- **API surface parity:** Web/mobile should remain unchanged; desktop-only UI must stay gated.
- **Integration coverage:** Local Electron verification is required because jsdom can assert DOM/classes but cannot prove macOS drag-region behavior.
- **Unchanged invariants:** Existing update actions, thread actions, history navigation, sidebar toggle behavior, and hidden `/new` top-bar layout remain intact.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Hidden drag strip intercepts clicks near the top of New Thread | Keep it shallow, pointer-safe around controls, and verify composer/starter-card interactions locally |
| Muted icons become too low contrast | Tune against Info Panel palette and preserve hover/focus contrast |
| Badge restyle breaks brittle class assertions | Update tests to assert meaningful compact/muted classes plus behavior, not exact full class strings |
| jsdom cannot validate actual window dragging | Treat local Electron manual verification as required before PR |

---

## Documentation / Operational Notes

- No public docs need updates.
- Final implementation handoff should include the local Electron URL/state and screenshots or a short note confirming the app was run locally.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-20-computer-electron-desktop-shell-requirements.md](../brainstorms/2026-05-20-computer-electron-desktop-shell-requirements.md)
- Related code: `apps/desktop/src/main/window.ts`
- Related code: `apps/desktop/README.md`
- Related code: `apps/spaces/src/components/DesktopApplicationHeader.tsx`
- Related code: `apps/spaces/src/components/SpacesSidebar.tsx`
- Related code: `apps/spaces/src/components/update-banner.tsx`
- Related code: `apps/spaces/src/routes/_authed/_shell/new.tsx`
- Related code: `apps/spaces/src/index.css`
