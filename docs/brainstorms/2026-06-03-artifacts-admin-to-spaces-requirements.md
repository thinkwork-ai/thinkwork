# Artifacts: Admin → Spaces Operator Migration — Requirements

**Date:** 2026-06-03
**Status:** Ready for planning
**Scope:** Standard
**Approach:** A — Unified surface + operator scope

## Problem

`apps/admin` is being deprecated; `apps/spaces` is becoming the single operator console. The admin Artifacts page (`apps/admin/src/routes/_authed/_tenant/applets/index.tsx` + `$appId.tsx`) is the only home for three **operator/support** capabilities. When admin is retired, those capabilities disappear unless they land in spaces.

`apps/spaces` already has a mature **user-facing** artifacts surface (`/artifacts` list + `/artifacts/$id` detail with iframe mounting, favorites, versioning, theme support, and in-thread cards). So this is not a page move — it is migrating the three operator-only capabilities onto the surface that already exists.

## Goal

Retire the admin Artifacts page by bringing full operator parity into spaces, reusing the existing `/artifacts` surface rather than duplicating it.

## Users

- **Operators / tenant admins** (incl. Eric) — need cross-user applet visibility and source inspection for support/debugging.
- **End users** — already see their own artifacts via the existing `/artifacts` surface; their experience must not regress.

## The three capabilities being migrated

1. **Cross-user / tenant-wide browse** — list every applet across all threads and users, filterable by user ID. Admin gates this with `requireTenantAdmin()` (`apps/admin/.../applets/index.tsx`; resolver `packages/api/src/graphql/resolvers/applets/adminApplets.query.ts`, filters by `threads.user_id`).
2. **Set App Style** — tenant-wide applet theme CSS stored in `tenant_settings.features.artifactStyle.appletTheme.css` (mutation `UpdateTenantArtifactStyleMutation`; resolver `packages/api/src/graphql/resolvers/core/updateTenantSettings.mutation.ts`). Validation: ≤20,000 chars, requires `:root`/`.dark`, valid custom-property tokens, strips `url()`/`expression()`/`@import`/`javascript:`.
3. **Applet source editing** — admin detail page exposes App / Source / Config tabs and saves TSX via `AdminUpdateAppletSourceMutation` (`adminUpdateAppletSourceInner` in `applet.shared.ts`).

## Chosen approach — A: Unified surface + operator scope

- **Browse** → add an operator-gated **scope control** ("Mine" / "All in tenant") plus user-ID filter to the *existing* `/artifacts` list, reusing its cards/table/filtering (`apps/spaces/src/components/artifacts/*`).
- **Source editing** → add operator-gated **Source / Config tabs** to the existing `/artifacts/$id` detail (`apps/spaces/src/routes/_authed/_shell/artifacts.$id.tsx`), which is view-only today.
- **Set App Style** → move into a **Settings section** (the one genuinely tenant-config piece), following the existing settings pattern (`/settings/<section>`, `apps/spaces/src/components/settings/*`, `settings-nav.tsx`). Operator-only nav item.
- Admin Artifacts route + detail retired once parity lands.

Rationale: maximizes reuse of the mature mounting/favorites/versioning UI, keeps one artifacts surface and one mental model, and only Set App Style — which is genuinely tenant configuration, not a browse action — moves to Settings.

## Success criteria

- An operator can, from spaces, browse all tenant applets and filter by user — without opening admin.
- An operator can view and save an applet's TSX source from `/artifacts/$id`.
- An operator can set the tenant applet theme CSS from Settings, with the same validation as admin today.
- A non-operator's `/artifacts` experience is correct and unchanged from their perspective (sees only what they should).
- The admin Artifacts route and detail page are removed.

## Scope boundaries

**In scope**
- Operator scope control + user-ID filter on `/artifacts`.
- Operator-gated Source / Config tabs on `/artifacts/$id`.
- Settings section hosting Set App Style.
- Operator role-gating across all three.
- Removal of the admin Artifacts route/detail.

**Deferred (fast-follow, not now)**
- **Approach C — per-Space Artifacts tab.** Give each Space a tab showing artifacts from its threads (artifact → thread → space link). Most product-correct long-term home, but a real build and the artifact→space relationship is only *indirect* today (no `space_id` on `artifacts`; see `packages/database-pg/src/schema/artifacts.ts`). Recorded as the likely next step, explicitly not gating admin retirement.

**Out of scope**
- New artifact *types* or generation changes.
- Changes to applet mounting/runtime.
- Any per-artifact direct `space_id` schema change.

## Dependencies / assumptions (verify in planning)

- **Current `/artifacts` visibility — must verify before choosing the non-operator default.** `ArtifactsListQuery` (`packages/api/src/graphql/resolvers/artifacts/artifacts.query.ts`) is tenant-scoped with **no user filter**. If the existing spaces `/artifacts` list currently shows *all* tenant artifacts to *every* user, then introducing "operator scope" implies **restricting non-operators to their own artifacts** — a behavior change, not a pure addition. Planning must confirm today's behavior and decide the non-operator default scope.
- **Operator role signal in spaces.** Spaces already hides operator-only settings nav until role resolves; reuse that same operator check for the scope control, source tabs, and Settings item (admin used `requireTenantAdmin()`).
- **Resolver reuse vs. new.** Decide whether to fold the admin `adminApplets` user-filter capability into the existing artifacts query path or keep a distinct operator query. Resolver-level decision for planning.
- Spaces has a vitest harness (`apps/spaces/src/vitest.config.ts`) — new behavior should land with tests.

## Key references

- Admin source (to be retired): `apps/admin/src/routes/_authed/_tenant/applets/index.tsx`, `apps/admin/src/routes/_authed/_tenant/applets/$appId.tsx`
- Spaces artifacts surface (to extend): `apps/spaces/src/routes/_authed/_shell/artifacts.index.tsx`, `artifacts.$id.tsx`, `apps/spaces/src/components/artifacts/*`, `apps/spaces/src/lib/app-artifacts.ts`
- Spaces settings pattern: `apps/spaces/src/routes/_authed/settings.tsx`, `apps/spaces/src/components/settings/{SettingsSidebar,settings-nav}.tsx`
- Data model: `packages/database-pg/src/schema/artifacts.ts` (tenant-scoped; thread/agent FKs; no direct space_id)
- Resolvers/mutations: `packages/api/src/graphql/resolvers/applets/adminApplets.query.ts`, `.../applets/applet.shared.ts`, `.../artifacts/artifacts.query.ts`, `.../core/updateTenantSettings.mutation.ts`
