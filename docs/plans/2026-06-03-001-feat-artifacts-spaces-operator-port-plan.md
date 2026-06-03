---
title: "feat: Port admin Artifacts operator tooling into spaces"
status: completed
date: 2026-06-03
type: feat
origin: docs/brainstorms/2026-06-03-artifacts-admin-to-spaces-requirements.md
depth: standard
---

# feat: Port admin Artifacts operator tooling into spaces

## Summary

Retire the deprecated `apps/admin` Artifacts page by bringing its three operator capabilities into `apps/spaces` (the single operator console): (1) an operator-only user-ID filter on the existing tenant-wide `/artifacts` list, (2) operator-gated Source/Config tabs on the existing artifact detail view, and (3) a dedicated operator-only "App Style" Settings section for the tenant applet theme.

This is a **frontend-only port** — all three backend resolvers (`adminApplets`, `adminUpdateAppletSource`, `updateTenantSettings`) already exist and are server-gated with `requireTenantAdmin`/`requireAdminOrServiceCaller`. The work is spaces UI plus porting typed GraphQL documents into a codegen-included queries file, mirroring the completed Evaluations admin→spaces port (PR #1865). It closes with removal of the admin Artifacts route/detail.

---

## Problem Frame

`apps/admin` is being deprecated; `apps/spaces` is the single operator console. The admin Artifacts page (`apps/admin/src/routes/_authed/_tenant/applets/index.tsx` + `$appId.tsx`) is the only home for three operator/support capabilities. Spaces already has a mature **user-facing** artifacts surface (`/artifacts` list + `/artifacts/$id` detail with iframe mounting, favorites, versioning, theme support). So this is not a page move — it is migrating the operator-only capabilities onto the surface that already exists, then deleting the admin page (see origin: `docs/brainstorms/2026-06-03-artifacts-admin-to-spaces-requirements.md`).

**Key research finding that shaped this plan:** the existing spaces `/artifacts` list runs the `applets` resolver (`listApplets` in `packages/api/src/graphql/resolvers/applets/applet.shared.ts:138-182`), which filters **only by tenant** — every tenant member already sees all tenant applets. The brainstorm's flagged "behavior change" risk is therefore resolved: operator scope is a **pure addition** (an operator-only user-ID filter), not a restriction on non-operators.

---

## Requirements

Carried from origin requirements doc:

- **R1** — An operator can browse all tenant applets and filter by user, from spaces, without opening admin.
- **R2** — An operator can view and save an applet's TSX source from the spaces artifact detail view.
- **R3** — An operator can set the tenant applet theme CSS from spaces Settings, with the same validation as admin today (≤20,000 chars; requires `:root`/`.dark`; valid custom-property tokens; strips `url()`/`expression()`/`@import`/`javascript:`).
- **R4** — A non-operator's `/artifacts` experience is unchanged from their perspective (they keep the existing tenant-wide list; the operator-only filter/tabs/nav simply do not appear).
- **R5** — The admin Artifacts route and detail page are removed.

---

## Key Technical Decisions

- **KTD1 — Operator-only user-ID filter, not a "Mine/All" scope toggle.** The brainstorm framed this as a "Mine / All in tenant" scope control, but the list is already tenant-wide for everyone, so a "Mine" view would be net-new behavior nobody requested. We match admin exactly: an operator-only "filter by user ID" input that switches the query to `adminApplets(userId:)`. Non-operators see the unchanged default list. (see origin: scope boundaries)
- **KTD2 — No backend changes.** `adminApplets` (`packages/api/src/graphql/resolvers/applets/adminApplets.query.ts`), `adminUpdateAppletSource` (`adminUpdateAppletSource.mutation.ts` → `adminUpdateAppletSourceInner` in `applet.shared.ts`), and `updateTenantSettings` (`packages/api/src/graphql/resolvers/core/updateTenantSettings.mutation.ts`) all exist and re-enforce `requireTenantAdmin`/`requireAdminOrServiceCaller` server-side. Client gating is UX only; the server fails closed.
- **KTD3 — Client gating via `useTenant()`.** Gate every operator control on `roleResolved && isOperator` from `TenantContext` (`apps/spaces/src/context/TenantContext.tsx:247`). For the new Settings section, use the same `OperatorGuard` route wrap + `operatorOnly: true` nav flag used by `settings.tools.tsx`. Both layers are needed: nav flag hides the link, `OperatorGuard` blocks direct-URL access.
- **KTD4 — Typed GraphQL documents go in a codegen-included `src/lib/*-queries.ts` file.** Spaces excludes `src/lib/graphql-queries.ts` from codegen (untyped `gql` there). Per the Evaluations-port learning, the three new operations — `AdminApplets` (query), `AdminUpdateAppletSource` (mutation), and `UpdateTenantArtifactStyle` (mutation, the `updateTenantSettings` resolver) plus a tenant-settings read — must live in a dedicated codegen-included queries file to get typed hooks. **Glob is already correct:** `apps/spaces/codegen.ts` matches `src/**/*.{ts,tsx}` minus only `src/lib/graphql-queries.ts`, so a new `src/lib/applet-admin-queries.ts` is auto-covered — no glob edit. The real constraints: (a) use the typed `graphql()` helper (as `evaluation-queries.ts`/`routine-queries.ts` do), **not** the untyped `gql` tag — admin's `UpdateTenantArtifactStyleMutation` uses untyped `gql`, so do not port it verbatim; (b) do not name the file `graphql-queries.ts` (the one exclusion).
- **KTD5 — Keep operator scope in the dedicated `adminApplets` path; do not widen shared auth helpers.** Per `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md`, widening `resolveCaller`/`ArtifactsListQuery` to add user filtering would silently widen what every resolver permits. The bounded `adminApplets` query is the correct seam.
- **KTD6 — Drive explicit list refresh after operator mutations.** Spaces urql uses the document `cacheExchange`, not graphcache (`apps/spaces/src/lib/graphql-client.ts`). After a theme save or a filter change, reexecute the relevant query with `requestPolicy: "network-only"` rather than relying on cache invalidation (`docs/solutions/integration-issues/spaces-urql-doc-cache-no-live-invalidation.md`).

---

## Implementation Units

### U1. Port operator GraphQL documents into a codegen-included queries file

**Goal:** Establish typed spaces documents for the three operator operations so U2–U4 consume generated types/hooks.
**Requirements:** R1, R2, R3 (foundation)
**Dependencies:** none
**Files:**
- `apps/spaces/src/lib/applet-admin-queries.ts` (new — auto-covered by the codegen glob; uses the typed `graphql()` helper, NOT `gql`)
- Generated `apps/spaces/src/gql/*` (regenerated, not hand-edited)

**Approach:** Author (do not blind-copy) the documents using the typed `graphql()` helper: `AdminApplets` (query — inputs `tenantId`, `userId?`, `cursor?`, `limit?`; returns `AppletConnection`), `AdminUpdateAppletSource` (mutation — input `{ appId, source }`; returns `SaveAppletPayload`), and `UpdateTenantArtifactStyle` (mutation — the `updateTenantSettings` resolver) plus a tenant-settings read query exposing `settings.features.artifactStyle.appletTheme.css`. Reference the admin shapes in `apps/admin/src/lib/graphql-queries.ts` (`AdminAppletsQuery` ~line 1776, `AdminUpdateAppletSourceMutation`, `UpdateTenantArtifactStyleMutation`) for field selection — but **`AdminApplets` must select the spaces `AppletPreviewFields` set, including `artifact.favoritedAt`** (admin's selection omits `favoritedAt`; copying it verbatim makes every operator-filtered row render as un-favoritable — see U2). Both `applets` and `adminApplets` resolve through the same `toAppletPreview` shape, so the list renderer is field-shape-agnostic once the document selects the spaces fields. Note: admin's `UpdateTenantArtifactStyleMutation` uses the untyped `gql` tag — re-author it with `graphql()`. Run `pnpm --filter @thinkwork/spaces codegen`.
**Patterns to follow:** Evaluations port (`docs/plans/2026-05-30-001-feat-spaces-evaluations-port-plan.md`) — dedicated `*-queries.ts` in a codegen-included path.
**Test scenarios:** `Test expectation: none — scaffolding/codegen unit. Verification is that codegen emits typed documents and the package typechecks.`
**Verification:** `pnpm --filter @thinkwork/spaces codegen` regenerates without error; typed operation hooks/types exist for all three operations; `pnpm --filter @thinkwork/spaces typecheck` passes.

---

### U2. Operator-only user-ID filter on the /artifacts list

**Goal:** Let an operator filter the existing tenant-wide applet list by user ID, matching admin.
**Requirements:** R1, R4
**Dependencies:** U1
**Files:**
- `apps/spaces/src/components/artifacts/ArtifactsListBody.tsx` (hold `useTenant()` in `LiveArtifactsListBody`; pass `isOperator`/`roleResolved` down as props)
- `apps/spaces/src/components/artifacts/ArtifactsToolbar.tsx` (filter input lives here; receives operator state via props, not its own context call)
- `apps/spaces/src/components/artifacts/ArtifactsListBody.test.tsx`

**Approach:** Add an operator-only "Filter by user ID" text input (gated on `roleResolved && isOperator`). **Component boundary:** call `useTenant()` in the live-data layer (`LiveArtifactsListBody`) and thread `isOperator`/`roleResolved` down through `ArtifactsListBodyView` to `ArtifactsToolbar` as props — do not add a context call inside the presentational toolbar (it would bypass the existing `itemsProp` test seam). Extend the test-seam props with `isOperator?`/`roleResolved?` so both operator states are testable without mocking context. When empty or for non-operators, keep the current `AppletsQuery` path unchanged. When an operator enters a user ID, switch the list query to `AdminApplets(tenantId, userId)` — `tenantId` MUST come from `useTenant().tenantId`, never a route param or user-editable field. Both queries resolve through the same `toAppletPreview`/`AppletPreviewNode` shape (see U1), so no per-field reconciliation is needed once `AdminApplets` selects the spaces field set. Drive a `network-only` reexecute on filter change (KTD6); clear `items` on filter-value change so the loading shell renders during the query switch rather than leaving the prior list stale on screen. When a filter is active and returns zero rows, show "No artifacts found for this user ID." rather than the default "Ask ThinkWork to create an artifact…" empty message.
**Patterns to follow:** admin filter UI `apps/admin/src/routes/_authed/_tenant/applets/index.tsx:153-161`; operator gating `apps/spaces/src/components/settings/OperatorGuard.tsx` / `useTenant()`.
**Test scenarios:**
- Covers R4. Non-operator (`isOperator=false`): filter input is not rendered; list shows the unchanged tenant-wide applets.
- Operator with empty filter: default list query is used; all tenant applets shown.
- Operator enters a user ID: list switches to the `AdminApplets` result filtered to that user's applets.
- Operator filter returns zero rows: scoped empty-state message ("No artifacts found for this user ID."), not the default create-prompt message.
- Operator clears the filter: list reverts to the default query and refetches (network-only); loading shell renders during the switch (no stale prior list).
- Filtered rows remain favoritable (favorite affordance present — guards against the `favoritedAt` omission from U1).
- Before role resolves (`roleResolved=false`): filter input is hidden (no flash of operator UI).
**Verification:** Operator sees and can use the user-ID filter; non-operator sees the existing list with no filter affordance; switching/clearing the filter visibly refreshes results with a loading state.

---

### U3. Operator-gated Source/Config tabs on the artifact detail view

**Goal:** Let an operator view and save applet TSX source from the spaces detail view.
**Requirements:** R2, R4
**Dependencies:** U1
**Files:**
- `apps/spaces/src/routes/_authed/_shell/artifacts.$id.tsx`
- `apps/spaces/src/routes/_authed/_shell/-artifacts.$id.test.tsx`

**Approach:** Add operator-gated **Source** and **Config** tabs alongside the existing App/preview tab, gated on `roleResolved && isOperator`. **Do NOT wrap the `/artifacts/$id` route in `OperatorGuard`** — the detail route stays accessible to all users (a non-operator following an artifact link must land on the artifact, not get redirected to `/settings/general`); gate only the individual tab elements. The existing spaces `AppletQuery` (non-admin `applet` resolver via `loadApplet` → `assertAppletArtifactAccess`, which gates on **tenant only, not user ownership**) already returns `source` + `metadata`, so an operator can read any tenant applet's source through it — no new read query, and `adminApplet` (singular) is deliberately **not** ported. Keep `AppletQuery`/`AppletsQuery` reads in the untyped `graphql-queries.ts`; only the new operator mutation moves to the typed file. Source tab: CodeMirror editor (`@uiw/react-codemirror` — **already a spaces dependency**, `apps/spaces/package.json:46`) bound to source state with a Save button (enabled only when dirty). Port the *save semantics* — call `AdminUpdateAppletSource({ appId, source })`, surface `SaveAppletPayload.errors`, reflect the returned `version` — but this is **not** a verbatim copy of admin's `saveSource`: admin's handler reexecutes `AdminAppletQuery`; the spaces handler must wire its post-save `network-only` reexecute to the existing spaces `reexecuteAppletQuery` handle (`artifacts.$id.tsx:44`). Surface save success/error via the spaces toast pattern, not admin's absolute-right inline span (the spaces split-shell layout has no analogous slot). Verify the `codemirror-language` helper (admin's `languageForFile`) exists in spaces; port it from admin if absent, and add `@codemirror/lang-json` only if the Config tab renders JSON via CodeMirror. Server re-enforces `requireTenantAdmin`, so a forced UI gains nothing.
**Patterns to follow:** admin detail `apps/admin/src/routes/_authed/_tenant/applets/$appId.tsx` (tabs, editor, save semantics — adapt the refetch wiring); editable-workspace-settings gating (`docs/plans/2026-06-01-001-feat-editable-workspace-settings-plan.md`) — non-admins see content but no save affordance.
**Test scenarios:**
- Covers R4. Non-operator: route loads normally (no redirect); only the App/preview tab renders; no Source/Config tabs.
- Operator: App/Source/Config tabs all render.
- Operator edits source → Save enabled; save round-trips through `AdminUpdateAppletSource`, reflects the returned version, and the preview refetches via `reexecuteAppletQuery`.
- Operator with unmodified source: Save disabled.
- Save returns validation errors (`SaveAppletPayload.errors`): errors surfaced (toast), source not silently dropped.
- Config tab renders provenance (appId, version, generatedAt, threadId, agentId, modelId, stdlib) read-only.
**Verification:** Operator can view/edit/save source and inspect config, with preview refreshing on save; non-operator detail is unchanged (preview-only) and the route is never redirected.

---

### U4. "App Style" operator-only Settings section

**Goal:** Move Set App Style (tenant applet theme CSS) into a dedicated operator-only spaces Settings section.
**Requirements:** R3, R4
**Dependencies:** U1
**Files:**
- `apps/spaces/src/routes/_authed/settings.app-style.tsx` (new — `OperatorGuard`-wrapped route)
- `apps/spaces/src/components/settings/SettingsAppStyle.tsx` (new section component)
- `apps/spaces/src/components/settings/settings-nav.tsx` (add `operatorOnly: true` nav entry)
- `apps/spaces/src/components/settings/SettingsAppStyle.test.tsx`

**Approach:** Port admin's Set App Style dialog logic (`apps/admin/src/routes/_authed/_tenant/applets/index.tsx:184-345`) into a settings section: a CSS textarea/paste-or-upload control that reads current `settings.features.artifactStyle.appletTheme.css` (via the U1 read query) and writes it via `UpdateTenantArtifactStyle`. **Carry the validation by copying `buildAppletTheme` + `parseThemeTokens` + `normalizeRecord` verbatim from admin `index.tsx:372-410`** — these are admin-local functions, not a shared export; the `parseThemeTokens` regex (~`index.tsx:397`) is what strips `url()`/`expression()`/`@import`/`javascript:`, so port it intact (an incomplete copy silently drops R3 sanitization). Add a client-side length pre-check (≤20,000) that disables Save and shows "CSS exceeds 20,000 characters (X/20,000)"; surface structural-rule failures inline below the textarea (`role="alert"`), matching the admin pattern. Render the empty/cleared state explicitly: empty textarea with the same shadcn-style placeholder admin uses plus a one-line description, and keep admin's **Clear** action. Render inside the settings shell (header via `usePageHeaderActions` breadcrumbs; never bounce to the main app shell). Add the nav item with `operatorOnly: true`. Reexecute the settings read with `network-only` after save (KTD6). **Open scope question (see Open Questions):** R3's `url()`/`expression()`/`@import`/`javascript:` strip is currently client-side only, while the `updateTenantSettings` resolver accepts arbitrary `features` JSON from any `requireAdminOrServiceCaller` caller — so a service-secret caller bypassing the UI can inject unsanitized CSS into every member's applet iframe. Resolving this may require a server-side strip (a backend change, in tension with KTD2).
**Patterns to follow:** Evaluations port mechanics (`docs/plans/2026-05-30-001-feat-spaces-evaluations-port-plan.md`); `settings.tools.tsx` + `SettingsTools.tsx`; admin Set App Style dialog.
**Test scenarios:**
- Covers R3. Valid CSS (has `:root`, valid tokens, ≤20,000 chars): accepted; `UpdateTenantArtifactStyle` called with the CSS.
- CSS exceeding 20,000 chars: Save disabled with the char-count error; no mutation fired (client pre-check).
- CSS missing `:root`/`.dark`: rejected with inline error.
- CSS containing `url()`/`expression()`/`@import`/`javascript:`: stripped per the ported `parseThemeTokens`.
- Empty/first-use state: placeholder + description render; no error.
- Clear action: removes the theme and refetches.
- Covers R4. Non-operator: nav item hidden; direct navigation to `/settings/app-style` redirects (OperatorGuard).
- After successful save: section reflects the saved CSS (network-only refetch).
**Verification:** Operator can set/update/clear the tenant theme with full validation and clear error feedback; the saved theme flows into the applet runtime (`loadTenantAppletThemeCss`); non-operators cannot reach the section.

---

### U5. Remove the admin Artifacts route and detail

**Goal:** Retire the admin Artifacts page once spaces parity lands.
**Requirements:** R5
**Dependencies:** U2, U3, U4
**Scope note:** This removes the admin **`/applets`** page (the "Artifacts" operator page this plan ports). Admin has a *separate* `_authed/_tenant/artifacts/` route (`apps/admin/src/routes/_authed/_tenant/artifacts/index.tsx`, backed by `ArtifactsListQuery`/`ArtifactDetailQuery` — a different generic-artifact page) — that route is **out of scope** for this unit; do not delete it here.
**Files:**
- `apps/admin/src/routes/_authed/_tenant/applets/index.tsx` (remove)
- `apps/admin/src/routes/_authed/_tenant/applets/$appId.tsx` (remove)
- `apps/admin/src/routes/_authed/_tenant/applets/-applets-route.test.ts` (remove — breaks on deletion)
- `apps/admin/src/components/Sidebar.tsx` (remove the `{ to: "/applets", … label: "Artifacts" }` entry, ~line 252)
- `apps/admin/src/components/CommandPalette.tsx` (remove the `{ label: "Artifacts", to: "/applets" }` entry, ~line 36)
- admin route tree regeneration (`routeTree.gen.ts`) as applicable

**Approach:** Delete the admin `/applets` list + detail routes, the route test, and both nav references (Sidebar + CommandPalette — both carry typed `Link to="/applets"`, so a missed one is a typecheck failure, not a silent break). Leave the shared backend resolvers untouched (still used by spaces) and leave the separate admin `/artifacts` route alone. Verify no remaining admin references to `/applets`.
**Patterns to follow:** prior admin-route removals from the admin→spaces port series.
**Test scenarios:** `Test expectation: none — deletion unit. Verification is that admin builds/typechecks with no dangling references and the /applets route is gone.`
**Verification:** `pnpm --filter @thinkwork/admin build` and `typecheck` pass (a dangling `Link to="/applets"` would fail typecheck); the Artifacts nav entry and `/applets` routes no longer exist; the separate `/artifacts` route is untouched; spaces parity (U2–U4) confirmed before merge.

---

## Scope Boundaries

**In scope**
- Operator-only user-ID filter on `/artifacts` (U2).
- Operator-gated Source/Config tabs on `/artifacts/$id` (U3).
- Operator-only "App Style" Settings section (U4).
- Removal of the admin Artifacts route/detail (U5).
- Porting typed GraphQL documents into a codegen-included spaces file (U1).

**Deferred for later** (carried from origin)
- **Per-Space Artifacts tab (Approach C).** Give each Space a tab showing artifacts from its threads. Most product-correct long-term home, but a real build and the artifact→space link is only indirect today — there is no `space_id` on `artifacts` (`packages/database-pg/src/schema/artifacts.ts`). Explicitly not gating admin retirement.

**Deferred to Follow-Up Work**
- A "Mine" vs "All in tenant" scope toggle, if product later wants per-user default scoping (not built now — see KTD1).

**Outside this work**
- New artifact types or generation changes.
- Changes to applet mounting/runtime.
- Any backend resolver/schema change (none required — KTD2).
- Any direct `space_id` schema change on `artifacts`.

---

## Risks & Dependencies

- **Google-federated tenantId-null trap.** Do not introduce any `ctx.auth.tenantId === args.tenantId` check — it silently passes for Google users (Eric). The existing resolvers correctly use `requireTenantAdmin` with row-derived tenantId; this plan adds no new server check, so the risk is only that a future "helpful" backend edit reintroduces it. (`docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`)
- **CodeMirror helper, not the editor itself (U3).** `@uiw/react-codemirror` is **already** a spaces dependency (`apps/spaces/package.json:46`) — there is no dep-add work and no textarea fallback needed. The only real gap is admin's `codemirror-language` helper (`languageForFile`); confirm it exists in spaces or port it, and add `@codemirror/lang-json` only if the Config tab renders JSON via CodeMirror.
- **App-style CSS sanitization is client-side only (U4 — security).** R3's `url()`/`expression()`/`@import`/`javascript:` strip runs in the spaces UI, but `updateTenantSettings` accepts arbitrary `features` JSON from any `requireAdminOrServiceCaller` caller (including bare service-secret callers), and the read path (`parseAppletThemeCss`) only length-checks and `:root`/`.dark`-checks — it does not strip dangerous patterns. A caller bypassing the UI can inject CSS that loads cross-origin resources into every member's applet iframe. Resolving this requires a server-side strip (a backend change in tension with KTD2) or explicit risk acceptance — see Open Questions.
- **urql document-cache staleness (U2, U4).** Without explicit `network-only` reexecute, the list/settings may not refresh after a filter change or theme save. Mitigation: KTD6.
- **Sequencing.** U5 (admin removal) must land only after U2–U4 prove parity, to avoid a capability gap window.

---

## Open Questions

- **OQ1 — Server-side app-style CSS sanitization (security; decide before U4 ships).** Client-side stripping is UX, not a security gate, because `updateTenantSettings` accepts service-auth callers that never run the UI. Options: (a) add a server-side strip in `parseAppletThemeCss`/`updateTenantSettings` (smallest correct fix, but a backend change vs KTD2's "frontend-only"), (b) accept the residual risk and document it (operators/service-secret holders are already trusted), or (c) defer to a separate hardening PR. **Recommendation: (a)** — it's a small, contained backend addition and CSS reaches every member's iframe; the "frontend-only" framing shouldn't block a real injection fix. Needs your call.
- **OQ2 — Pre-existing cross-tenant read on `artifacts_` (out of scope, track separately).** The generic `artifacts` query resolver (`packages/api/src/graphql/resolvers/artifacts/artifacts.query.ts`) takes a caller-supplied `tenantId` with no `requireTenantMember` check — a known cross-tenant read vector this plan neither introduces nor worsens (this plan's applet paths gate correctly). Flagging so it can be tracked as its own fix; not part of this work.

---

## Sources & Research

- Origin requirements: `docs/brainstorms/2026-06-03-artifacts-admin-to-spaces-requirements.md`
- Canonical admin→spaces port precedent: `docs/plans/2026-05-30-001-feat-spaces-evaluations-port-plan.md` (PR #1865)
- Operator-gated editing precedent: `docs/plans/2026-06-01-001-feat-editable-workspace-settings-plan.md`
- Auth gating: `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`, `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md`
- urql cache behavior: `docs/solutions/integration-issues/spaces-urql-doc-cache-no-live-invalidation.md`
- Key code: `apps/spaces/src/context/TenantContext.tsx`, `apps/spaces/src/components/settings/{settings-nav,OperatorGuard,SettingsTools}.tsx`, `apps/spaces/src/routes/_authed/settings.tools.tsx`, `apps/spaces/src/components/artifacts/ArtifactsListBody.tsx`, `apps/spaces/src/routes/_authed/_shell/artifacts.$id.tsx`, `packages/api/src/graphql/resolvers/applets/{adminApplets.query,applet.shared,adminUpdateAppletSource.mutation}.ts`, `packages/api/src/graphql/resolvers/core/updateTenantSettings.mutation.ts`
