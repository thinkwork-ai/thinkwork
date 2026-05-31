---
title: "refactor: Spaces settings UI cleanup (Space/User/Agent/Workspace detail)"
type: refactor
status: active
date: 2026-05-31
deepened: 2026-05-31
depth: standard
target_repo: thinkwork (apps/spaces)
---

# refactor: Spaces settings UI cleanup

## Summary

Five small, operator-requested visual cleanups to the settings detail pages, plus
one shared component extraction. The screens live in **`apps/spaces`** (the React
web app the `apps/desktop` Electron shell renders) — not `apps/desktop/src/renderer`,
which does not exist. All changes render in the desktop window from the screenshots.

The work: (1) extract a single info/workspace **toggle** button and apply it to
Space Detail, Agent, and User Detail; (2) give Space Detail and User Detail a big
in-body page title to match the other settings pages; (3) restructure Space Detail's
Information form so Access + Status sit beside Name; (4) dissolve User Detail's
"Membership" section — Role moves into Profile, Status moves beside the title; (5)
drop the credentials-warning banner from the Workspace view.

`apps/spaces` has a working **vitest + `@testing-library/react`** harness
(`pnpm --filter @thinkwork/spaces test`; pattern reference:
`src/components/artifacts/PinToggleButton.test.tsx`). The two units with real
behavior — the shared toggle (U1) and the role-merge (U4) — get unit tests; the
layout/deletion units (U2, U3, U5) are verified by typecheck, the existing suite
staying green, and visual inspection in the desktop shell.

---

## Problem Frame

The settings detail pages drifted into small inconsistencies the operator flagged
in their message and annotated screenshots:

- **Space Detail** shows the space name only as a breadcrumb (no big page title
  like the Spaces list / Agent pages), exposes **two** redundant header toggle
  buttons (Info + Files), and stacks Access/Status in a separate row below
  Description, wasting the horizontal space next to Name.
- **User Detail** carries a low-value "Membership" section, a free-floating "Can't
  change your role here" helper line, a plain-text "Workspace" link in the Profile
  header, and a status value buried in a row instead of beside the name. It lacks
  the unified info/workspace toggle.
- **Agent** uses a plain-text "Workspace" link instead of the toggle the other
  detail pages should share.
- **Workspace** view renders a noisy "…including any credentials stored in
  workspace files" banner above the tree.

Goal: a consistent, denser, lower-noise settings surface, with one reusable toggle
pattern across the three detail pages.

---

## Requirements

Each requirement below is **stated explicitly in the operator's request message**
and corroborated by the annotated screenshots; R3's column layout was confirmed via
a follow-up question (Name left, Access+Status right). These are operator
instructions, not intent inferred from screenshots alone.

- **R1 — Space Detail title.** Render the space name as a prominent in-body page
  title, matching the Spaces list / Agent pages.
- **R2 — Single info/workspace toggle.** Replace Space Detail's two header buttons
  with one button that toggles views and shows the *destination* icon (folder/files
  icon while on Info; info icon while on Workspace). Operator: "We don't need both…
  it should toggle between them. When on info view → show workspace icon."
- **R3 — Space Detail Access/Status layout.** Move Access (dropdown) and Status
  (badge) into a multi-column row beside Name: Name in a wide left column, Access
  and Status in narrower columns to its right (operator-confirmed).
- **R4 — User Detail title + toggle + link removal.** Give User Detail the same
  in-body title and single info/workspace toggle; remove the plain-text "Workspace"
  link.
- **R5 — User Detail Role into Profile.** Move the Role control into the Profile
  section, below Name; remove the "You can't change your own role here." helper text.
- **R6 — User Detail status beside title.** Render the membership status as a badge
  beside the page title.
- **R7 — User Detail remove Membership section.** Remove the "Membership" section
  wrapper entirely (its contents are relocated per R5/R6).
- **R8 — Agent link → toggle.** Remove Agent's plain-text "Workspace" link and use
  the shared single info/workspace toggle in the header.
- **R9 — Workspace banner removal.** Remove the "Shows every workspace synced to
  this machine, including any credentials stored in workspace files." banner.

---

## Key Technical Decisions

- **KTD1 — One shared toggle component, used in all three detail pages.** Extract
  `WorkspaceViewToggle` (single icon button) rather than duplicating the two-button
  block. Space Detail currently hard-codes a two-`Button` block
  (`SettingsSpaceConfig.tsx:60–95`); Agent and User Detail use a text link. A single
  component unifies the pattern and satisfies R2/R4/R8 at once.
- **KTD2 — Toggle is published via the header `action` slot, and supersedes the
  per-view "Done" button.** All three pages already call
  `usePageHeaderActions({ action })`. The toggle goes in that slot (top-right of the
  settings header bar), where Space Detail's buttons and Agent/User's "Done" button
  already live. Because the toggle is always present and closes the workspace view
  as well as opening it, the separate "Done" buttons in Agent and User Detail are
  removed. No change to `SettingsHeaderBar` or `PageHeaderContext`.
- **KTD2a — `actionKey` must change with the toggle's boolean.** `usePageHeaderActions`
  only re-publishes the action when its `actionKey` changes (it does not diff the
  action node's props). Today Agent's `actionKey` is `undefined` on the info view and
  only set when `filesOpen && agent`, and User's only when `filesOpen`. For the
  toggle icon to actually swap when entering/leaving the workspace view, `actionKey`
  must encode the boolean in **both** states — e.g. `` `agent-files:${filesOpen}` ``
  (Agent), `` `user-files:${memberId}:${filesOpen}` `` (User), and Space Detail's
  existing `view`-keyed `actionKey` already satisfies this.
- **KTD3 — Add an optional `badge` prop to `SettingsPageTitle`.** R6 ("status beside
  the title") needs a slot adjacent to the `<h1>`. `SettingsPageTitle` already has a
  right-aligned `actions` prop, but "beside the title" means inline with the name,
  not far-right. Add a small optional `badge?: ReactNode` rendered immediately after
  the `<h1>` inside the same left flex group (`SettingsContent.tsx:37–59`). Reusable
  and minimal; Space Detail can ignore it. (Considered and rejected: widening `title`
  to `ReactNode` — the dedicated prop keeps the common string path clean and is the
  same edit size.)
- **KTD4 — In-body titles coexist with breadcrumbs.** Adding `SettingsPageTitle` to
  Space/User Detail duplicates the name that's also in the header-bar breadcrumb —
  this is the established pattern (Agent renders both at `SettingsAgentConfig.tsx:80,
  91, 131`; the `SettingsHeader`/`SettingsPageTitle` doc comments document
  breadcrumb-for-nav + in-body-h1-for-heading). Keep both.
- **KTD5 — Merge `RoleSection` logic into `ProfileSection`, preserving its own
  mutation state.** R5 moves Role into Profile and R7 deletes the Membership
  section. Fold `RoleSection`'s logic into `ProfileSection`, which then needs
  `memberId`, `currentRole`, `status`, `isSelf`, `callerIsOwner` as props. **The
  relocated role `<Select>` keeps its own mutation's fetching flag** — introduce a
  dedicated `const [roleState, updateMember] = useMutation(SettingsUpdateTenantMemberMutation)`
  inside `ProfileSection` and guard with `disabled={isSelf || roleState.fetching}`.
  Do **not** reuse ProfileSection's existing `saving` (= `savingUser ||
  savingProfile`), which tracks the profile Save button, not the auto-saving role
  change — reusing it would wrongly disable Role during a profile Save and leave it
  enabled during its own change. Drop the "You can't change your own role here."
  description (R5). Server-side authz is unaffected: the `updateTenantMember`
  resolver (`packages/api/src/graphql/resolvers/core/updateTenantMember.mutation.ts`)
  independently enforces self-edit denial, owner-grant restriction, and the
  last-owner invariant; the `isSelf`/`callerIsOwner` client guards are UX only.
- **KTD6 — Right-size tests to behavior, not breadth.** The harness exists, so write
  unit tests for the two behavior-bearing changes (U1 toggle, U4 role merge) using
  the `PinToggleButton.test.tsx` pattern. The pure layout/deletion units (U2 form
  regrid, U3 link→toggle swap, U5 banner deletion) are covered by typecheck + the
  existing suite staying green + visual inspection; no bespoke tests for those.

---

## High-Level Technical Design

Shared toggle, driven by each page's existing view-state boolean:

```
                       usePageHeaderActions({ action: <WorkspaceViewToggle …/>,
                                              actionKey: encodes the boolean })
                                        │
        ┌───────────────────────────────┼────────────────────────────┐
        ▼                                ▼                             ▼
  Space Detail                       Agent                       User Detail
  view: "info"|"files"               filesOpen: boolean          filesOpen: boolean
  showingWorkspace =                 showingWorkspace =          showingWorkspace =
    view === "files"                   filesOpen                   filesOpen
  onToggle: setView(                 onToggle:                   onToggle:
    info<->files)                      setFilesOpen(!)             setFilesOpen(!)

  WorkspaceViewToggle({ showingWorkspace, onToggle }):
    button aria-pressed={showingWorkspace}
           title = showingWorkspace ? "Show information" : "Open workspace files"
           className = showingWorkspace ? desktopToolbarActiveButtonClassName
                                        : desktopToolbarButtonClassName
    icon = showingWorkspace ? <IconInfoCircle/>   // click → back to info
                            : <IconFiles/>        // click → open workspace
```

The single button encodes the destination via its icon (per R2) **and** its current
state via `aria-pressed` + an active highlight when the workspace view is open —
recovering the state affordance the two-button segmented control gave for free.

Space Detail Information form, after R3 (operator-confirmed layout):

```
SettingsPageTitle  title={spaceName}            ← R1 (new)
SettingsSection label="Information"
  sm+ : ┌─────────────────────┬───────────┬──────────┐
        │ Name                 │ Access     │ Status   │  ← 3-col row
        │ [Input]              │ [Select]   │ [Badge]  │
        └─────────────────────┴───────────┴──────────┘
  narrow: Name (full width)
          ┌───────────┬──────────┐   ← Access+Status in a 2-col sub-grid
          │ Access     │ Status   │
          └───────────┴──────────┘
  Description
  [Textarea]
  ───────────────────────────────────────── Save
```

User Detail, after R4–R7:

```
SettingsPageTitle title={displayName} badge={<Badge>{status}</Badge>}   ← R1/R6
SettingsSection label="Profile"
  User ID
  Name
  Role            ← R5: moved here, below Name, no helper text, own error span
  Title | Timezone
  Notes
  ─────────────── Save
(Membership section deleted)                ← R7
(header action: WorkspaceViewToggle; "Done" button removed)            ← R4/KTD2
```

---

## Implementation Units

### U1. Extract shared `WorkspaceViewToggle` component

**Goal:** A single reusable icon-toggle button for the settings header action slot.

**Requirements:** R2, R4, R8 (enabling), R6 prep via KTD3.

**Dependencies:** none.

**Files:**
- `apps/spaces/src/components/settings/WorkspaceViewToggle.tsx` (new)
- `apps/spaces/src/components/settings/WorkspaceViewToggle.test.tsx` (new)
- `apps/spaces/src/components/settings/SettingsContent.tsx` (add `badge?` prop to `SettingsPageTitle`)

**Approach:**
- Props: `{ showingWorkspace: boolean; onToggle: () => void }`. No `infoLabel`/
  `workspaceLabel` props — there is no second label variant; inline the strings
  (drop speculative extensibility).
- Render one `Button` (`variant="ghost"`, `size="icon-sm"`, `className="size-8"`).
  - Icon: `showingWorkspace ? <IconInfoCircle/> : <IconFiles/>` (`@tabler/icons-react`).
  - `aria-pressed={showingWorkspace}` and `title`/`aria-label = showingWorkspace ?
    "Show information" : "Open workspace files"` (describe the action).
  - `className` toolbar style: `desktopToolbarActiveButtonClassName` when
    `showingWorkspace`, else `desktopToolbarButtonClassName` (from
    `@/lib/desktop-chrome`) — gives an active highlight while the workspace view is
    open.
- `SettingsPageTitle`: add optional `badge?: ReactNode`, rendered inline right after
  the `<h1>`. Wrap the `<h1>` and badge in a flex `items-center gap-2` row inside the
  existing left `<div className="min-w-0">`; leave the `actions` (right) slot
  untouched.

**Patterns to follow:** the existing two-button block at `SettingsSpaceConfig.tsx:60–95`
(sizes, icons); `@/lib/desktop-chrome` for class names;
`src/components/artifacts/PinToggleButton.test.tsx` for the test shape.

**Test scenarios** (`WorkspaceViewToggle.test.tsx`, `@testing-library/react`):
- Renders the **files** icon and `aria-pressed=false` / action label "Open workspace
  files" when `showingWorkspace={false}`.
- Renders the **info** icon and `aria-pressed=true` / action label "Show information"
  when `showingWorkspace={true}`.
- Clicking the button calls `onToggle` exactly once.
- (`SettingsPageTitle`) renders `badge` content beside the title when provided, and
  renders unchanged (no empty wrapper regressions) when `badge` is omitted —
  guarding existing callers (Agent, Spaces list).

**Verification:** `pnpm --filter @thinkwork/spaces typecheck` + `test` green;
`SettingsPageTitle` existing callers still render.

---

### U2. Space Detail — title, single toggle, Access/Status beside Name

**Goal:** Apply R1, R2, R3 to `SettingsSpaceConfig.tsx`.

**Requirements:** R1, R2, R3.

**Dependencies:** U1.

**Files:**
- `apps/spaces/src/components/settings/SettingsSpaceConfig.tsx`

**Approach:**
- **R2:** Replace the two-`Button` block in the `usePageHeaderActions` `action`
  (lines ~60–95) with `<WorkspaceViewToggle showingWorkspace={view === "files"}
  onToggle={() => setView(view === "files" ? "info" : "files")} />`. Keep `actionKey`
  keyed on `view` (already correct per KTD2a). Drop now-unused direct
  `IconFiles`/`IconInfoCircle` imports if no longer referenced.
- **R1:** In the info-view return (lines ~131–145), add `<SettingsPageTitle
  title={spaceName} />` at the top of the `max-w-3xl` wrapper, above
  `<InformationSection/>`. Import `SettingsPageTitle` from
  `@/components/settings/SettingsContent`.
- **R3:** In `InformationSection` (lines ~205–260), restructure the form top.
  Replace the standalone Name `Labeled` block and the `grid-cols-2` Access/Status row
  (lines ~223–245) with: at `sm+`, a single grid row `grid grid-cols-1 gap-4
  sm:grid-cols-[2fr_1fr_1fr]` holding Name / Access / Status; at narrow width it
  collapses to Name full-width followed by a nested `grid-cols-2` sub-grid for
  Access + Status (so Status never becomes a lonely full-width label-only row).
  Description, then the Save row, follow unchanged. Keep Status as `<Badge
  variant="secondary">{titleCase(status)}</Badge>` under a "Status" label.

**Patterns to follow:** Agent's `<SettingsPageTitle title="Agent" />`
(`SettingsAgentConfig.tsx:131`); existing `Labeled` helper in the same file.

**Test scenarios:** Test expectation: none beyond U1 — pure layout + wiring; covered
by typecheck, the existing suite staying green, and visual inspection. Manual:
single toggle switches info↔workspace; title shows; Name/Access/Status share one row
at desktop width and stack cleanly when narrow; Save still persists
name/description/access.

**Verification:** Typecheck + suite green; in the desktop dev shell the Space Detail
page shows one toggle, a title, and the new row layout; Save round-trips.

---

### U3. Agent — replace "Workspace" link with shared toggle

**Goal:** Apply R8 to `SettingsAgentConfig.tsx`.

**Requirements:** R8.

**Dependencies:** U1.

**Files:**
- `apps/spaces/src/components/settings/SettingsAgentConfig.tsx`

**Approach:**
- Remove the plain-text "Workspace" `<button>` from the `Configuration`
  `SettingsSection` `action` (lines ~134–149); keep the saving/error status spans in
  that action slot.
- In `usePageHeaderActions` (lines ~62–75), replace the `filesOpen ? <Done> :
  undefined` action with `<WorkspaceViewToggle showingWorkspace={filesOpen}
  onToggle={() => setFilesOpen(!filesOpen)} />`. The toggle now both opens and closes
  the workspace view, so the separate "Done" button is removed (KTD2).
  - **Render/guard:** show the toggle whenever `filesOpen || agent` so a user who
    opened the workspace view can always toggle back even if `agent` momentarily
    re-fetches to null; the open action is a no-op until `agent` is loaded. Keep the
    `filesOpen` breadcrumb extension.
  - **actionKey:** set to `` `agent-files:${filesOpen}` `` (when shown) so the icon
    re-publishes on toggle (KTD2a).

**Patterns to follow:** Space Detail's toggle wiring from U2.

**Test scenarios:** Test expectation: none beyond U1 — link→toggle swap; covered by
typecheck + existing suite + visual. Manual: toggle opens the AGENTS.md workspace
editor and toggles back; no "Workspace" text link remains; Runtime/model auto-save
still works.

**Verification:** Typecheck + suite green; Agent page shows the toggle, no text link.

---

### U4. User Detail — title+status, toggle, Role into Profile, drop Membership

**Goal:** Apply R4, R5, R6, R7 to `SettingsUserDetail.tsx`.

**Requirements:** R4, R5, R6, R7.

**Dependencies:** U1.

**Files:**
- `apps/spaces/src/components/settings/SettingsUserDetail.tsx`
- `apps/spaces/src/components/settings/SettingsUserDetail.test.tsx` (new — role-merge regression)

**Approach:**
- **R4 (toggle):** In `usePageHeaderActions` (lines ~62–79), replace the `filesOpen ?
  <Done> : undefined` action with `<WorkspaceViewToggle showingWorkspace={filesOpen}
  onToggle={() => setFilesOpen(!filesOpen)} />`, and set `actionKey` to
  `` `user-files:${memberId}:${filesOpen}` `` (KTD2a). Keep `subtitle`/breadcrumb logic.
- **R4 (link removal):** Delete the "Workspace" text `<button>` from
  `ProfileSection`'s `SettingsSection` `action` (lines ~281–289); remove the
  `onOpenWorkspace`/`action` plumbing from `ProfileSection`. Workspace opens via the
  header toggle now.
- **R1/R6:** Add `<SettingsPageTitle title={displayName} badge={<Badge
  variant="secondary">{titleCase(member.status)}</Badge>} />` at the top of the
  `SettingsPane` body (lines ~118–136), above `ProfileSection`. Import `Badge` from
  `@thinkwork/ui`, `SettingsPageTitle`, and a `titleCase` helper. (Status badge keeps
  `variant="secondary"` for consistency with Space Detail; a status→variant color map
  is a deliberate non-goal here — see Scope Boundaries.)
- **R5 (Role merge — KTD5):** Move `RoleSection`'s logic into `ProfileSection`. Pass
  `memberId`, `currentRole`, `isSelf`, `callerIsOwner`. Inside `ProfileSection`, add
  its **own** `const [roleState, updateMember] = useMutation(SettingsUpdateTenantMemberMutation)`
  and the `onRoleChange` + owner-option-filtering logic. Render the role `<Select>`
  as a new `Labeled label="Role"` block directly below the Name block (after line
  ~300), `disabled={isSelf || roleState.fetching}`. **Drop** the "You can't change
  your own role here." description (R5). Show role-save errors in a small span
  adjacent to the Role select (keep them distinct from the profile Save-row error
  span — do not collapse the two into one ambiguous message).
- **R7:** Delete the `RoleSection` component and its render call (lines ~128–134,
  ~141–206). Its Status row becomes the title badge (R6); its Role control is now in
  Profile. No "Membership" section remains.

**Patterns to follow:** existing `ProfileSection` field structure and `Labeled`;
the `RoleSection` mutation/option logic being relocated; `PinToggleButton.test.tsx`
for the test shape.

**Test scenarios** (`SettingsUserDetail.test.tsx` — the plan's highest-risk change):
- Role `<Select>` is **disabled** when `isSelf` is true (self cannot change own role).
- Role `<Select>` is **enabled** for a non-self member and a role change fires
  `SettingsUpdateTenantMemberMutation` with the chosen role.
- "owner" option is present when `callerIsOwner` (or current role is owner) and
  absent otherwise.
- The "You can't change your own role here." text is **not** rendered.
- No element labeled "Membership" is rendered; the status badge appears beside the
  title.
- (If straightforward to assert) a role-save error renders near the Role select and
  does not overwrite the profile Save-row state.

**Verification:** Typecheck + suite green; behavior above confirmed in desktop dev
shell. U4 is the highest-risk unit (KTD5) — confirm the role mutation still fires
and the self-disable guard holds after the merge.

---

### U5. Workspace — remove credentials banner

**Goal:** Apply R9 to `LocalWorkspaceView.tsx`.

**Requirements:** R9.

**Dependencies:** none.

**Files:**
- `apps/spaces/src/components/local-workspace/LocalWorkspaceView.tsx`

**Approach:** Delete the `<p>` banner at lines 104–107 (the "Shows every workspace
synced to this machine…" text). The outer `<div className="flex h-full flex-col">`
then contains only the `ResizablePanelGroup`. (`LocalWorkspaceView.test.tsx`
exists but does **not** assert the banner text — confirmed — so no test update is
needed; the existing suite must still pass.)

**Patterns to follow:** n/a (pure deletion).

**Test scenarios:** Test expectation: none — pure JSX deletion, no behavior change;
the existing suite must stay green.

**Verification:** Typecheck + suite green; Workspace view renders the tree/content
with no banner.

---

## Scope Boundaries

**In scope:** the five detail-page edits above and the shared toggle component, all
in `apps/spaces`.

**Out of scope / non-goals:**
- The Spaces *list* page (`SettingsSpaces.tsx`) — already has its title; no change.
- `SettingsHeaderBar` / `PageHeaderContext` mechanics — the toggle reuses the
  existing `action` slot (only `actionKey` values change, per KTD2a).
- Status→badge-color semantics — all statuses render `variant="secondary"`, matching
  Space Detail. Adding a state-dependent color map across pages is a separate styling
  pass.
- Any `apps/admin` equivalent screens (a separate admin spaces UI cleanup brainstorm
  exists but is not this work).

**Membership grouping note (R7):** dissolving "Membership" is justified because it
currently holds only two fields (Role + Status). Role/Status are tenant-membership
concepts distinct from Profile fields. **Re-introduction trigger:** if a third
membership-scoped field is later added (joined-date, invited-by, seat type,
suspend/reactivate, per-space membership), restore a distinct section rather than
further growing Profile. Keep the relocated Role logic cohesive (own sub-block + own
error span) so re-extracting it is cheap.

---

## Risks & Dependencies

- **Role-merge regression (medium — highest risk in this plan).** Folding
  `RoleSection` into `ProfileSection` (KTD5) moves a live mutation and its guards.
  Risks: reusing the wrong fetching flag for the disable guard (mitigated by a
  dedicated `roleState`, KTD5), or dropping the `isSelf`/owner-option filtering.
  Mitigation: relocate logic verbatim; the U4 unit test asserts self-disable, the
  mutation firing, and owner-option visibility.
- **Stale toggle icon (low).** If `actionKey` doesn't encode the boolean, the header
  memo won't re-publish and the icon won't swap. Mitigated by KTD2a (explicit
  `actionKey` values for Agent/User).
- **Toggle state legibility (low).** A destination-icon-only button can read as
  current-state; mitigated by `aria-pressed` + active highlight (U1).
- **Duplicate-title visual (low).** In-body title duplicates the breadcrumb name;
  matches the established Agent pattern (KTD4), accepted.

---

## Verification Strategy

Per unit: `pnpm --filter @thinkwork/spaces typecheck` and `pnpm --filter
@thinkwork/spaces test` (existing suite stays green; U1 + U4 add new tests), plus
`pnpm format:check`. Whole-feature: run the desktop dev shell and walk the four pages
against the screenshots.

---

## Sources & Research

Current-state reads (2026-05-31), all `apps/spaces/src` unless noted:
- `components/settings/SettingsSpaceConfig.tsx` — two-button toggle (60–95),
  InformationSection grid (223–245).
- `components/settings/SettingsAgentConfig.tsx` — "Workspace" link (141–147), header
  action + `actionKey` (62–75), dual-title precedent (80, 91, 131).
- `components/settings/SettingsUserDetail.tsx` — header (62–79), ProfileSection +
  "Workspace" link (278–335), `RoleSection` "Membership" (141–206), `saving` =
  `savingUser || savingProfile` (254).
- `components/local-workspace/LocalWorkspaceView.tsx` — banner (104–107);
  `LocalWorkspaceView.test.tsx` exists but does not assert the banner text.
- `components/settings/SettingsContent.tsx` — `SettingsPageTitle` (37–59),
  `SettingsSection`/`SettingsRow`.
- `lib/desktop-chrome.ts` — `desktopToolbarButtonClassName`,
  `desktopToolbarActiveButtonClassName`, `desktopToolbarGapClassName`.
- `components/artifacts/PinToggleButton.test.tsx` — vitest +
  `@testing-library/react` pattern; harness declared in `apps/spaces/package.json`
  (`"test": "vitest run"`) + `apps/spaces/vitest.config.ts`.
- `packages/api/src/graphql/resolvers/core/updateTenantMember.mutation.ts` — server
  enforces self-edit denial, owner-grant restriction, last-owner invariant (client
  guards are UX only).

Architecture note: `apps/desktop` is the Electron shell; the settings UI is
`apps/spaces`. Icons: `@tabler/icons-react` (toggle) + `lucide-react`.

Review note: this plan was deepened via a six-persona doc review (coherence,
feasibility, design, security, scope, adversarial). Security found no issues
(server-side authz holds). The test-harness premise, role-guard fetching flag,
`actionKey` re-publish keying, toggle accessibility, "Done"-button supersession,
narrow-width stacking, and speculative toggle props were all corrected above.
