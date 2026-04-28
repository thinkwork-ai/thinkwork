---
title: Remove Admin Connectors
type: refactor
status: active
date: 2026-04-20
origin: docs/brainstorms/2026-04-20-remove-admin-connectors-requirements.md
---

# Remove Admin Connectors

## Overview

Retire the admin app's "Connectors" page and its tendrils across build config, public docs, and mobile dead-code branches. The backend REST endpoints were removed in `c4b92d2` (2026-04-18) and the terraform API-Gateway routes in `81406b5`, so the admin page already errors on load and external callers already 404. This PR cleans up the now-zombie surface.

**No data deletes. No schema changes.** Stale `webhooks` (`target_type='task'`) and `connect_providers` (`provider_type='task'`) rows sit harmless: no UI reads them, API Gateway returns 404, and `webhook_deliveries` ages out via the existing 90-day retention sweep. Shared integration tables (`connect_providers`, `connections`, `credentials`) stay intact — OAuth + MCP depend on them.

## Problem Frame

Per origin: the admin `/connectors` route calls `/api/task-connectors*` endpoints that no longer exist, so the page throws on load. The underlying external-task ingestion concept was retired during the SDK pivot (commit `c4b92d2`, "Phase C: remove Task concept from ThinkWork backend"). Continuing to ship the page is strictly negative: tenants see a broken admin surface, the sidebar advertises a capability that doesn't exist, the public docs site documents a feature that's gone, and three live mobile navigation call-sites still push users toward a broken `/settings/connectors` path.

Retiring the *current* surface is not the same as closing the door on inbound partner-initiated task ingestion forever. If a external provider-class partner re-enters the picture later, the right home is mobile self-serve (per memory: `feedback_user_opt_in_over_admin_config`) built on the preserved `connect_providers`/`connections`/`credentials` schema. This plan leaves that door open — no design work is committed here.

## Requirements Trace

Source IDs from the origin document (`docs/brainstorms/2026-04-20-remove-admin-connectors-requirements.md`):

- **R1–R3** — Admin UI removal (route files, sidebar entry, regenerated route tree)
- **R4–R5** — Build + infra cleanup (`scripts/build-lambdas.sh` entry + grep verification)
- **R6–R8** — Documentation (delete retired `.mdx` files, sweep cross-links and nav)
- **R9** — Schema comment hygiene (drop `task` from target_type docstring enums)
- **R10** — Mobile dead-code cleanup (external provider tile + `hasTaskConnector`/`activeTaskConnectors` branches + nav cleanup)

Success criteria from origin:

- `/connectors` produces a route-tree 404, not a runtime fetch error
- Admin sidebar has no Connectors entry
- `pnpm build` (admin + lambdas) succeeds with no `task-connectors` references
- Unit 3's explicit grep gate returns no broken internal links (Starlight does not fail builds on dead links — see Key Technical Decisions)
- The Unit 6 verification grep returns no live-code matches
- OAuth sign-in (Google) and existing mobile MCP server connections still work end-to-end

## Scope Boundaries

- **Out of scope:** data deletes of any kind (see origin Key Decisions — the FK trap on `connect_providers.id` makes cosmetic deletes disproportionately risky).
- **Out of scope:** schema DDL changes to `connect_providers`, `connections`, `credentials` (shared with OAuth + MCP).
- **Out of scope:** any new replacement UI for external-task ingestion. Parked, not killed.
- **Out of scope:** generic webhook admin at `/webhooks` (unrelated, stays).
- **Out of scope:** `seeds/eval-test-cases/*.json` connector references (scenario fixtures, not runtime — but add `seeds/` to Unit 6's tolerated-match list so matches there don't trip the gate).
- **Out of scope:** archived plans under `docs/plans/archived/` and historical docs under `docs/plans/` and `docs/brainstorms/`.
- **Out of scope:** `docs/src/content/docs/guides/connectors.mdx` — research confirmed this is a *generic* custom-connector recipe guide covering Slack/GitHub/Google patterns, not task-connector-specific. It stays.
- **Out of scope: the external provider MCP server.** The retirement targets *external provider-as-task-connector* (the deprecated surface this PR removes). *external provider-as-MCP-server* is a separate, supported integration and stays wherever it lives — MCP server catalog entries, `apps/mobile/app/settings/mcp-server-detail.tsx`, MCP-side OAuth flows, and any provider-name references in MCP code. Unit 6's tolerated-match list below names these paths explicitly.
- **Out of scope:** `EXTERNAL_PROVIDER_CLIENT_ID` / `EXTERNAL_PROVIDER_CLIENT_SECRET` / `task_system_tasks_API_URL` revocation at the provider and env removal (captured in Documentation / Operational Notes as a tracked follow-up).
- **Out of scope:** Secrets Manager audit of orphaned signing secrets from the retired `/api/task-connectors/:slug/generate-secret` flow (captured as a tracked follow-up).
- **Out of scope:** Adding `starlight-links-validator` (or equivalent) as a permanent CI step — worth a follow-up since this is the first docs-pruning PR, but not required for this change.

### Deferred to Separate Tasks

- **EXTERNAL_PROVIDER_*** env/secret cleanup and provider-side revocation** — separate PR, see Documentation / Operational Notes.
- **Orphaned Secrets Manager entries audit** — separate one-off operational task, see Documentation / Operational Notes.
- **Global `notFoundComponent` for admin + `+not-found.tsx` for mobile** — improves 404 UX beyond the default blank screen; separate follow-up (see Risks & Dependencies).

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/routes/_authed/_tenant/connectors/index.tsx`, `$slug.tsx` — the zombie route pair (call deleted REST endpoints)
- `apps/admin/src/components/Sidebar.tsx:21` (imports `Plug` from `lucide-react`) and `:179` (single-line nav entry). `Plug` is used only for this entry in the file (verified), so drop both lines
- `apps/admin/src/routeTree.gen.ts` — auto-generated by `@tanstack/router-plugin` Vite plugin (v1.154.14); regenerated by `pnpm --filter admin build` or dev server; ~14 current connector references will drop on regeneration
- `apps/admin/src/routes/__root.tsx` — root layout has no `notFoundComponent`, so a deleted-route visit renders a blank area inside the outlet. Accepted for this PR; see Deferred to Separate Tasks
- `scripts/build-lambdas.sh:211-212` — the `build_handler "task-connectors"` pair; handler source at `packages/api/src/handlers/task-connectors.ts` was already deleted in `c4b92d2`
- `docs/astro.config.mjs` — 4 sidebar entries to remove at lines 70, 135, 152, 208
- `apps/mobile/lib/hooks/use-connections.ts` — `activeTaskConnectors` useMemo at lines 191–195, `hasTaskConnector` at line 197, both exported at 205 and 208. **Module-level JSDoc at lines 6–16** still references "the inbox screen (gates the Threads/Tasks tab bar on `hasTaskConnector`) and the Connectors settings screen." **`ConnectionRow.provider_type` docstring at lines 32–39** explicitly documents `"task"` as a valid value and references the Tasks-tab inference rationale — both go in Unit 4
- `apps/mobile/app/settings/connectors.tsx` — confirmed one-line re-export: `export { default } from "./integrations";` — delete the file
- `apps/mobile/app/_layout.tsx:276` — `<Stack.Screen name="settings/connectors" />` registration. Delete the file without removing this line and Expo Router has a registered screen with no component, which is a runtime error, not a clean 404
- `apps/mobile/app/(tabs)/index.tsx:439` — `HeaderContextMenu` entry `{ label: "Connectors", icon: Plug, onPress: () => router.push("/settings/connectors") }`. Live navigation call site — remove alongside the file delete. Check whether `Plug` is still used elsewhere in the file before dropping the import
- `apps/mobile/app/settings/integration-detail.tsx:79` — `router.replace("/settings/connectors")` post-disconnect fallback. Retarget to `/settings/integrations`
- `apps/mobile/app/settings/integrations.tsx` — external provider surface is wider than a catch-all captures (verified via grep). Enumerated in Unit 4
- `packages/database-pg/src/schema/webhooks.ts:44` — comment `// agent | routine | task`
- `packages/database-pg/src/schema/webhook-deliveries.ts:48` — comment `// agent | routine | task | null`

### Docs cross-link surface (verified by `grep -rln 'external-tasks|applications/admin/connectors' docs/src/content/docs/`)

Files with live references that need cross-link or prose edits after Unit 3's deletions:

1. `docs/src/content/docs/architecture.mdx` (line 224: `[External Tasks](/concepts/connectors/external-tasks/)`; also line 76 references `MCP Tools` which stays — leave that)
2. `docs/src/content/docs/concepts/connectors.mdx` (line 50: External Tasks bullet)
3. `docs/src/content/docs/applications/admin/index.mdx` (line 57: "Connectors" card)
4. `docs/src/content/docs/applications/admin/webhooks.mdx` (lines 8, 162)
5. `docs/src/content/docs/applications/admin/builtin-tools.mdx` (1 ref)
6. `docs/src/content/docs/applications/admin/agent-invites.mdx` (lines 97, 121)
7. `docs/src/content/docs/applications/mobile/index.mdx`
8. `docs/src/content/docs/applications/mobile/threads-and-chat.mdx`
9. `docs/src/content/docs/applications/mobile/push-notifications.mdx` (lines referencing `/concepts/connectors/external-tasks/`)
10. `docs/src/content/docs/applications/mobile/integrations-and-mcp-connect.mdx` (refs to both `admin/connectors` and `external-tasks`)
11. `docs/src/content/docs/roadmap.mdx` (line 27: prose bullet "External task connectors (external provider adapter + generic adapter seam) | Beta" — no dead link, but the prose needs updating)

Files originally proposed in the sweep but **confirmed to have zero dead-link matches** (dropped from the list): `concepts/agents.mdx`, `concepts/threads/routing-and-metadata.mdx`, `index.mdx`. Their only connector references point to `/concepts/connectors/` (overview, survives).

### Institutional Learnings

None. `docs/solutions/` is 6 files old (all 2026-04-20, wiki/graph-related). No prior patterns for TanStack Router route removal, Astro docs pruning, or mobile dead-code sweeps. Worth capturing a `ce:compound` learning after this lands — it would be the first feature-retirement entry in the solutions tree.

### Applicable Memory

- `feedback_pnpm_in_workspace` — use `pnpm`, never `npm` (applies to R3 build command)
- `feedback_worktree_isolation` — the main tree has uncommitted work (`apps/admin/src/routes/__root.tsx` modified + four untracked planning docs); do this in `.claude/worktrees/<name>` off `origin/main`, not the main checkout
- `feedback_pr_target_main` — PR targets `main`, never stacked
- `feedback_user_opt_in_over_admin_config` — cited as the forward-looking rationale (integration setup belongs in mobile self-serve if it returns)

### External References

None — pure internal removal.

## Key Technical Decisions

- **Delete route files, let the Vite plugin regenerate `routeTree.gen.ts`.** Hand-editing the generated file gets clobbered on next dev start. Regeneration via `pnpm --filter admin build`; commit the regenerated file. **Allowed diff rule:** the `routeTree.gen.ts` commit diff must consist only of deletions referencing the `connectors` route files; any addition or edit to an unrelated route is a stop-the-line signal — abort the commit, rebase onto latest `origin/main`, resolve separately, then retry. Do not commit a mixed diff.
- **Surgical edit of `apps/mobile/app/settings/integrations.tsx`, not file delete.** The file still owns the Google + Microsoft integration UI. Unit 4 enumerates every verified external provider branch (research-grep confirmed at least 8 distinct locations, not the 3 the brainstorm catch-all implied); Unit 6's grep gate includes `mobile-host` (case-insensitive) with targeted tolerated-match comments.
- **Keep `guides/connectors.mdx`.** Research confirmed generic custom-connector recipe (Slack/GitHub/Google), not task-connector-specific.
- **Public-docs deletion is a positioning choice, not just hygiene.** Removing public pages about external-task ingestion is a statement that this capability is not currently offered. Matches the internal "parked, not killed" stance: roadmap.mdx keeps a one-line status note ("external task connectors retired — see roadmap for partner integrations if/when they return"), rather than going fully silent. This is explicit rather than implicit.
- **R5 grep expanded beyond origin spec.** Unit 6 adds `handleConnectExternalProvider` and `mobile-host` (case-insensitive) to catch literals that escape the origin's symbol-only pattern. Tolerated matches: `docs/plans/archived/`, `docs/plans/`, `docs/brainstorms/`, `seeds/`, and **MCP-side external provider references** (the external provider MCP server is a supported integration — see Scope Boundaries). Concrete tolerated paths: `apps/mobile/app/settings/mcp-server-detail.tsx`, `apps/mobile/app/settings/mcp-servers.tsx`, any `packages/api/src/handlers/mcp-*.ts`, and MCP server catalog seed data.
- **Replace "docs build warns on broken links" gate with explicit grep gate.** Verified that Starlight/Astro do not fail builds on dead internal links (no `starlight-links-validator` configured). Unit 3's verification is an explicit grep for `external-tasks|applications/admin/connectors` returning zero matches, not a passive build warning.
- **Mobile `/settings/connectors` hard-404 accepted** for this PR. The current file is a trivial re-export; deleting it is the cleanest removal. Adding a redirect would carry the retired surface forward for another release. If captive-audience bookmarks become a reported issue, a redirect can land as a follow-up.
- **No pre-merge prod evidence query required.** Origin doc already accepted the dev-only assumption. If wrong, existing API Gateway already 404s — no user-visible regression. A production check on `webhook_deliveries WHERE target_type='task' AND created_at > now() - interval '30 days'` is a nice-to-have, not a blocker.
- **Single PR, not phased.** Every unit is a small mechanical change; splitting into multiple PRs adds review overhead. Units are dependency-ordered for reviewer clarity, but they ship together.

## Open Questions

### Resolved During Planning

- **Is `apps/mobile/app/settings/connectors.tsx` a re-export or its own implementation?** Re-export. Delete the file + the Stack.Screen registration + the HeaderContextMenu nav + the integration-detail.tsx fallback (Unit 4).
- **Is `docs/src/content/docs/guides/connectors.mdx` task-connector-specific or generic?** Generic. Keep it.
- **Will `routeTree.gen.ts` edits stick?** No — regenerate via build; see Allowed diff rule above.
- **Which docs files need cross-link edits?** 11 files verified by grep (see Context & Research). Replaces the earlier overbroad list.
- **Is `Plug` still used elsewhere in `Sidebar.tsx`?** No — Plug appears only at lines 21 (import) and 179 (entry). Drop both.
- **Does Starlight fail on broken links?** No. Verification is an explicit grep, not a build warning.
- **Does the external provider MCP server also retire?** No. external provider-as-task-connector retires (this PR); external provider-as-MCP-server stays as a supported integration. Unit 6's tolerated-match list names the concrete MCP paths where `mobile-host` literals are legitimate.

### Deferred to Implementation

- **Exact prose edits in each cross-link file.** Unit 3 enumerates the 11 files; implementer decides whether to delete the bullet or redirect the link to a surviving page (usually `concepts/connectors/integrations` or `guides/connectors`).
- **Should `handleReconnect` (integrations.tsx:173–180) keep a `mobile-host` branch after the task-connector UI is gone?** Resolved via Unit 4: the `else if (providerName === "mobile-host")` branch is removed because the Integrations screen no longer surfaces a external provider tile — there's nothing to "reconnect" from this screen. Users reconnect external provider-as-MCP-server from the MCP Servers screen.
- **Is there a live inbox consumer of `hasTaskConnector`?** The use-connections.ts JSDoc claims the inbox screen gates the Threads/Tasks tab bar on `hasTaskConnector`, but grep shows no call sites outside the hook itself. Either the inbox caller was already removed or the docstring is stale — Unit 4 cleans up the docstring regardless.

## Implementation Units

- [ ] **Unit 1: Delete admin Connectors routes + sidebar entry**

**Goal:** Remove the zombie admin UI so visiting `/connectors` returns a route-tree 404.

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**
- Delete: `apps/admin/src/routes/_authed/_tenant/connectors/index.tsx`
- Delete: `apps/admin/src/routes/_authed/_tenant/connectors/$slug.tsx`
- Delete (empty parent dir cleanup): `apps/admin/src/routes/_authed/_tenant/connectors/`
- Modify: `apps/admin/src/components/Sidebar.tsx` — drop `Plug` from the `lucide-react` import at line 21, and remove the `{ to: "/connectors", icon: Plug, label: "Connectors" }` entry at line 179
- Regenerate + commit: `apps/admin/src/routeTree.gen.ts` via `pnpm --filter admin build`

**Approach:**
- Delete route files first so the Vite plugin has nothing to register on regeneration
- Edit `Sidebar.tsx`: drop both the `Plug` import (verified single-use) and the nav entry
- Run `pnpm --filter admin build` once; the `@tanstack/router-plugin` regenerates `routeTree.gen.ts`. Per the Allowed diff rule in Key Technical Decisions, the diff must consist only of deletions referencing the `connectors` route files — abort if anything else shifts

**Patterns to follow:**
- Precedent from `c4b92d2`: route files deleted directly; generated route tree committed as produced by the plugin, not hand-edited

**Test scenarios:**
- Happy path: After build, navigating to `/connectors` in the admin dev server lands on the root layout's outlet with no matched route (blank area — accepted for this PR; custom 404 component is a separate follow-up)
- Happy path: The admin sidebar renders with Inbox/Threads/Agents/etc. but no Connectors entry; no TypeScript error for the removed `Plug` import
- Edge case: Deep link `/connectors/mobile-host` also yields no matched route
- Integration: `pnpm --filter admin typecheck` and `pnpm --filter admin build` succeed with zero references to the deleted route files

**Verification:**
- `grep -rE 'connectors|Plug' apps/admin/src/components/Sidebar.tsx` returns no matches
- `grep -rE 'connectors/(index|\$slug)' apps/admin/src/routeTree.gen.ts` returns no matches (after regeneration)
- Admin typecheck + build pass

---

- [ ] **Unit 2: Remove `task-connectors` Lambda registration from build script**

**Goal:** Stop the build pipeline from registering a handler whose source file no longer exists.

**Requirements:** R4, R5

**Dependencies:** None

**Files:**
- Modify: `scripts/build-lambdas.sh` — delete the `build_handler "task-connectors" \` + indented path line at 211–212

**Approach:**
- Two-line deletion. The handler source `packages/api/src/handlers/task-connectors.ts` was already removed in `c4b92d2`, so the build currently skips it silently
- The `graphql-http | memory-retain | eval-runner | wiki-compile | wiki-bootstrap-import` special-case list at line 73 does not include `task-connectors`; no second-pass edit needed there

**Patterns to follow:**
- Parallel terraform cleanup shipped in `81406b5`; this is the deferred counterpart

**Test scenarios:**
- Integration: `pnpm build:lambdas` completes with no "task-connectors" registration in output
- Integration: Unit 6's grep gate passes

**Verification:**
- `grep -n 'task-connectors' scripts/build-lambdas.sh` returns zero matches

---

- [ ] **Unit 3: Delete retired docs pages + sweep cross-links + fix sidebar nav**

**Goal:** Stop the public docs site from documenting a retired feature; stop shipping dead links.

**Requirements:** R6, R7, R8

**Dependencies:** None

**Files:**
- Delete: `docs/src/content/docs/concepts/connectors/external-tasks.mdx`
- Delete: `docs/src/content/docs/guides/external-tasks.mdx`
- Delete: `docs/src/content/docs/applications/mobile/external-tasks.mdx`
- Delete: `docs/src/content/docs/applications/admin/connectors.mdx`
- Modify: `docs/astro.config.mjs` — remove sidebar entries at lines 70 (Concepts > Connectors > External Tasks), 135 (Admin > Manage > Connectors), 152 (Mobile > External Tasks), 208 (Authoring Guides > External Tasks)
- Modify (cross-link sweep — verified list from grep):
  1. `docs/src/content/docs/architecture.mdx`
  2. `docs/src/content/docs/concepts/connectors.mdx`
  3. `docs/src/content/docs/applications/admin/index.mdx`
  4. `docs/src/content/docs/applications/admin/webhooks.mdx`
  5. `docs/src/content/docs/applications/admin/builtin-tools.mdx`
  6. `docs/src/content/docs/applications/admin/agent-invites.mdx`
  7. `docs/src/content/docs/applications/mobile/index.mdx`
  8. `docs/src/content/docs/applications/mobile/threads-and-chat.mdx`
  9. `docs/src/content/docs/applications/mobile/push-notifications.mdx`
  10. `docs/src/content/docs/applications/mobile/integrations-and-mcp-connect.mdx`
  11. `docs/src/content/docs/roadmap.mdx` (prose edit: update the "External task connectors (external provider adapter + generic adapter seam) | Beta" row to reflect retirement, or delete it if the table contract allows)
- Keep (explicit non-change): `docs/src/content/docs/concepts/connectors/integrations.mdx`, `docs/src/content/docs/concepts/connectors/mcp-tools.mdx`, `docs/src/content/docs/guides/connectors.mdx`, `docs/src/content/docs/concepts/agents.mdx`, `docs/src/content/docs/concepts/threads/routing-and-metadata.mdx`, `docs/src/content/docs/index.mdx`, `docs/src/content/docs/getting-started.mdx`

**Approach:**
- Delete the four retired `.mdx` files first; surviving refs to them become detectable in grep
- Edit `docs/astro.config.mjs` — remove the four sidebar entries
- Walk each of the 11 cross-link files. For each reference to a deleted page: either (a) delete the bullet/sentence if task-connector-specific, or (b) retarget the link to `concepts/connectors/integrations`, `concepts/connectors/mcp-tools`, or `guides/connectors` if the surrounding prose still makes sense for the generic integrations/MCP story. For the admin credential-vault cross-links in `webhooks.mdx` / `agent-invites.mdx` / `builtin-tools.mdx`, retarget to `guides/connectors` (generic custom-connector recipe) rather than deleting — credential-rotation guidance belongs somewhere
- Do NOT manually delete anything under `docs/dist/` — Astro regenerates that tree on the next CI publish

**Patterns to follow:**
- No local precedent for Starlight page removal; astro.config.mjs sidebar is a plain JS array

**Test scenarios:**
- Happy path: `pnpm --filter @thinkwork/docs build` completes with no build errors (note: Starlight does not fail on broken internal links; grep is the authoritative gate)
- Happy path: The Starlight sidebar renders with Integrations and MCP Tools under Concepts > Connectors, but no "External Tasks" entries anywhere
- Integration: No surviving `.mdx` file in `docs/src/content/docs/` links to `/concepts/connectors/external-tasks/`, `/applications/admin/connectors/`, `/guides/external-tasks/`, or `/applications/mobile/external-tasks/`
- Integration: `roadmap.mdx` no longer lists `External task connectors (external provider adapter + generic adapter seam)` as an active/beta item (either removed or marked retired)

**Verification:**
- `grep -rln 'external-tasks\|applications/admin/connectors' docs/src/content/docs/` returns zero matches (authoritative link gate)
- `grep -n 'External task connectors' docs/src/content/docs/roadmap.mdx` returns zero matches (prose gate)

---

- [ ] **Unit 4: Mobile dead-code cleanup + nav cleanup**

**Goal:** Remove all mobile runtime code and navigation paths that reach the retired Connectors surface or depend on `hasTaskConnector`/`activeTaskConnectors`.

**Requirements:** R10

**Dependencies:** Units 1–3 are ideal prerequisites for narrative consistency, not strict build-graph blockers

**Files:**
- Modify: `apps/mobile/lib/hooks/use-connections.ts`
  - Remove `activeTaskConnectors` useMemo at 191–195, `hasTaskConnector` derivation at 197, both exports at 205/208
  - Rewrite the **module-level JSDoc** at lines 6–16 — drop the "inbox screen (gates the Threads/Tasks tab bar on `hasTaskConnector`) and the Connectors settings screen" reference; leave a tight one-line "integrations-screen data hook" summary
  - Update the **`ConnectionRow.provider_type` docstring** at lines 32–39 — drop the `"task" for external provider Tasks` example and the "Surfaced by the server join... decides whether the inbox should show the Tasks tab" rationale
- Delete: `apps/mobile/app/settings/connectors.tsx` (one-line re-export)
- Modify: `apps/mobile/app/_layout.tsx` — remove `<Stack.Screen name="settings/connectors" />` at line 276
- Modify: `apps/mobile/app/(tabs)/index.tsx` — remove the `HeaderContextMenu` entry at line 439 (`{ label: "Connectors", icon: Plug, onPress: () => router.push("/settings/connectors") }`); check whether `Plug` is still used elsewhere in the file before dropping the import
- Modify: `apps/mobile/app/settings/integration-detail.tsx` — replace `router.replace("/settings/connectors")` at line 79 with `router.replace("/settings/integrations")`
- Modify (surgical, enumerated): `apps/mobile/app/settings/integrations.tsx`
  - Line 6 import: remove `ListChecks` if it becomes unused after the tile is gone (verify with in-file grep)
  - Line 21: `PROVIDER_ICONS.mobile-host` entry
  - Line 47: agent-pairing comment referencing external provider
  - Lines 88–94: MCP explanation block referencing "external provider Tasks uses OAuth through the MCP Servers screen…" — this block is task-connector guidance (how to get external provider *task data* into ThinkWork) and goes with the rest of the task-connector surface. The external provider MCP server itself stays; users connect to it via the MCP Servers screen directly
  - Lines 91–96: `handleConnectExternalProvider` declaration (originally called out)
  - Lines 173–180: `handleReconnect` else-if branch for `providerName === "mobile-host"`
  - Lines 284–357: per-user default-agent picker block gated on `conn.provider_name === "mobile-host"` (includes the `handleSelectDefaultAgent(conn, "mobile-host", …)` callsites at 320 and 337, plus surrounding metadata reads at 289, the ChevronDown/ChevronUp picker UI, and the "Attached automatically to new external provider task threads" footer at 351)
  - Lines 411–430: the unconnected-external provider "Available Connectors" tile Pressable
  - Lines 433–439: the "All available integrations connected" guard — drop `connectedProviders.has("mobile-host")` from the three-provider AND check so the guard correctly fires when Google + Microsoft are both connected
  - Line 435: the `connectedProviders.has("mobile-host") && (...)` connected-external provider render block (if not already swept by the 411–430 removal)
  - After removal, audit `AgentsQuery` (lines ~49–65) and the `myAgents` useMemo — if their only remaining consumer was the external provider picker, remove them so the integrations screen stops firing an unused GraphQL query on every load

**Approach:**
- Edit `use-connections.ts` first so typecheck flags any surviving consumer — verifies the origin-doc claim that no live caller outside the hook uses these exports
- Delete `connectors.tsx` and its Stack.Screen registration and its two nav call-sites together — anything less leaves either a runtime error (registered screen, missing component) or a live nav push toward a deleted file
- Surgically edit `integrations.tsx` per the enumerated list. Research confirmed the brainstorm catch-all ("any branch that gates on `hasTaskConnector`/`activeTaskConnectors`") does NOT match the real external provider gates (which use `provider_name === "mobile-host"` and `connectedProviders.has("mobile-host")`), so the enumeration is authoritative
- Keep Google and Microsoft branches verbatim

**Patterns to follow:**
- Mobile deletes in `c4b92d2` removed `apps/mobile/app/(tabs)/tasks/` wholesale — same shape as the `connectors.tsx` deletion

**Test scenarios:**
- Happy path: Mobile typecheck passes with no errors from removed exports or deleted files
- Happy path: Settings → Integrations renders Google + Microsoft tiles, no external provider tile, no "All available integrations connected" dead state. When Google + Microsoft are both connected, the Muted "All available integrations connected" empty-state message shows (previously unreachable because mobile-host was in the AND)
- Happy path: Integrations → Reconnect on a Google or Microsoft row still works; no crash from the missing `handleConnectExternalProvider`
- Happy path: HeaderContextMenu on the inbox no longer lists "Connectors"
- Edge case: Deep link / bookmark to `/settings/connectors` yields Expo Router's default "Unmatched Route" screen (not a runtime error). Accepted — redirect is a separate-task follow-up
- Edge case: `integration-detail.tsx` disconnect flow now returns to `/settings/integrations`, not the deleted path
- Integration: `useConnections()` call sites in `integrations.tsx` (and anywhere the hook is imported) no longer destructure `hasTaskConnector` or `activeTaskConnectors`

**Verification:**
- `grep -rEi 'hasTaskConnector|activeTaskConnectors|handleConnectExternalProvider|PROVIDER_ICONS\.mobile-host|settings/connectors' apps/mobile/` returns zero matches
- `grep -rEi '[\"'\''\`]mobile-host[\"'\''\`]' apps/mobile/app/ apps/mobile/lib/` returns only MCP-server-catalog matches: `apps/mobile/app/settings/mcp-server-detail.tsx`, `apps/mobile/app/settings/mcp-servers.tsx`, and any MCP seed/catalog code. Matches anywhere else (settings/integrations.tsx, hooks/use-connections.ts, inbox, tabs/index.tsx, etc.) are unfinished Unit 4 scope
- Mobile typecheck passes

---

- [ ] **Unit 5: Schema comment hygiene**

**Goal:** Stop the Drizzle schema from documenting `task` as a valid `target_type` enum value after every producer is gone.

**Requirements:** R9

**Dependencies:** None

**Files:**
- Modify: `packages/database-pg/src/schema/webhooks.ts` — update line 44 comment `// agent | routine | task` → `// agent | routine`
- Modify: `packages/database-pg/src/schema/webhook-deliveries.ts` — update line 48 comment `// agent | routine | task | null` → `// agent | routine | null`

**Approach:**
- Two single-line comment edits. Not a DDL change, not a migration, not a column alteration. The `target_type` column type is still `text` and still permits `'task'` at the database level — only the application-level documentation of the enum values changes

**Patterns to follow:**
- Other Drizzle schema files use the same trailing-comment style for enum-like text columns

**Test scenarios:**
- Test expectation: none — pure documentation comment change; no behavior change, no runtime exercise

**Verification:**
- `grep -n '| task' packages/database-pg/src/schema/webhooks.ts packages/database-pg/src/schema/webhook-deliveries.ts` returns zero matches

---

- [ ] **Unit 6: Final verification sweep**

**Goal:** Prove the cleanup is complete before asking for review.

**Requirements:** R5 (grep gate), all success criteria

**Dependencies:** Units 1–5 complete

**Files:**
- No code changes — this is a gate, not a unit of delivery

**Approach:**
- **Primary grep** (expanded from origin R5 to cover the external provider literal surface Unit 4 requires): `grep -rEi 'task-connectors|task_connectors|hasTaskConnector|activeTaskConnectors|handleConnectExternalProvider' apps/ packages/ scripts/ terraform/ docs/src/`
  - Expected: zero matches in live code
  - Tolerated: matches in `docs/plans/archived/`, `docs/plans/`, `docs/brainstorms/`, `seeds/` (scenario fixtures, explicitly out of scope)
- **Secondary grep** (literal surface, mobile-scoped): `grep -rEi "[\\\"'\\\`]mobile-host[\\\"'\\\`]" apps/mobile/app/ apps/mobile/lib/`
  - Expected: zero matches
  - Tolerated: matches under `apps/mobile/app/mcp-servers/` or MCP-catalog code if the external provider MCP server is staying (see Open Questions — confirm at implementation time and document tolerated path)
- **Docs grep** (Unit 3's authoritative gate): `grep -rln 'external-tasks|applications/admin/connectors' docs/src/content/docs/` returns zero matches
- **Build gates**: `pnpm --filter admin build`, `pnpm build:lambdas`, `pnpm --filter @thinkwork/docs build`, and a mobile typecheck (`pnpm --filter mobile typecheck` or equivalent)
- **Smoke test OAuth + MCP**: Google sign-in in admin, existing MCP server connection on mobile — both must still work. These are the shared-infra surfaces the plan explicitly preserves

**Patterns to follow:**
- Origin Success Criteria section is the checklist

**Test scenarios:**
- Happy path: All three greps clean; all four builds succeed; Google sign-in and MCP connections unchanged
- Edge case: If any grep surfaces a match in an unexpected location (e.g., a live `.ts` file), treat as an unfinished unit — fix, don't allowlist. If a match shows up in an expected-tolerated path (e.g., `seeds/eval-test-cases/…`), document it in the PR description rather than adjusting the gate

**Verification:**
- All origin Success Criteria are observably met
- PR description lists the tolerated-match paths so reviewers can verify the whitelist is principled

## System-Wide Impact

- **Interaction graph:** Admin `/connectors` → deleted (root-layout outlet with no match). Admin sidebar → one fewer entry + dropped `Plug` import. Mobile `/settings/connectors` → deleted; its Stack.Screen registration, inbox HeaderContextMenu entry, and integration-detail.tsx fallback all updated. Mobile `/settings/integrations` → external provider tile, handler, default-agent picker, and "all connected" gate all removed. Public docs → 4 pages deleted; 11 cross-link files swept; 4 astro.config sidebar entries removed. No backend Lambda, MCP tool, or agent runtime path is touched in this PR.
- **Error propagation:** No new error paths. The page that currently throws on load is deleted. Deep links to retired routes yield default 404 UX (admin: blank root-layout outlet; mobile: Expo Router "Unmatched Route") — consistent with any unknown URL in the respective apps.
- **State lifecycle risks:** Low. No migrations, no feature flags, no caches to invalidate. One edge case: if any mobile user's on-device AsyncStorage or Tanstack Query cache was keyed on `hasTaskConnector`, first launch after this ships may log a soft error before the hook rehydrates against the new shape. React Query will refetch — not catastrophic, just worth noting in release notes if they exist.
- **API surface parity:** N/A — no API surface changes. The deleted REST endpoints were already gone.
- **Integration coverage:** Google OAuth sign-in and mobile MCP server connections **must still work** — both share the `connect_providers`/`connections`/`credentials` schema that this PR preserves. Unit 6 smoke-tests both.
- **Unchanged invariants:**
  - `connect_providers`, `connections`, `credentials` tables and their Drizzle definitions
  - Webhook admin at `/webhooks` (separate surface)
  - Generic connector docs: `concepts/connectors/integrations.mdx`, `concepts/connectors/mcp-tools.mdx`, `guides/connectors.mdx`
  - `webhooks.target_type` column permits `'task'` at the DB level (only the inline comment updates)
  - All mobile non-external provider integration UI (Google, Microsoft branches)
  - external provider MCP server catalog entry (if present) — out of scope; if it stays, Unit 6's tolerated-match list covers its `mobile-host` literals

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `routeTree.gen.ts` regeneration produces a mixed diff (another session's in-flight route changes on main) | Allowed diff rule (Key Technical Decisions): commit must contain only connector-related deletions. If anything else shifts, abort, rebase onto latest `origin/main`, and retry. Never commit a mixed generated-file diff |
| Unit 4 misses a external provider branch not yet surfaced by grep (e.g., string-concatenated provider names) | Unit 6 secondary grep for `mobile-host` literal in `apps/mobile/app/` + `apps/mobile/lib/` catches any survivor; enumerated list in Unit 4 Files covers the 8+ verified locations |
| Unit 3 cross-link sweep misses a file (grep pattern isn't exhaustive) | Unit 6 re-runs the sweep grep as a gate. Starlight does not fail on dead links, so the grep is the authoritative check (see Key Technical Decisions) |
| A user with a browser tab open to `/connectors` or a mobile bookmark to `/settings/connectors` hits a dead route on deploy | Accepted — admin page already errors today; mobile deep-link bookmarks are rare and a redirect is a separate-task follow-up. Both apps' default 404 UX is acceptable as a one-time transition cost |
| Data stays in prod DB (`connect_providers` with `provider_type='task'` + stale webhook rows) | Accepted — origin's Key Decisions explicitly chose no-data-deletes; endpoints already 404 so rows are inert |
| `EXTERNAL_PROVIDER_CLIENT_ID` / `EXTERNAL_PROVIDER_CLIENT_SECRET` / `task_system_tasks_API_URL` stay injected into Lambda common_env | Tracked follow-up in Documentation / Operational Notes. Not an in-scope security issue given the API Gateway 404 and zero active external provider partners |
| Uncommitted work on the main checkout collides with this PR | Execute in `.claude/worktrees/remove-admin-connectors/` off `origin/main` per `feedback_worktree_isolation` |

## Documentation / Operational Notes

- **No feature-flag / rollout coordination needed** — the admin surface is already broken; this PR removes the dead shell.
- **No customer communication needed** — origin's dev-only external provider assumption; even if wrong, external callers already 404 at API Gateway today.
- **VITE_API_AUTH_SECRET** has ~20 surviving consumers in the admin app (webhooks, agents, skills, MCP, etc.); no rotation is needed as a result of this PR.
- **Tracked follow-ups (separate tasks, not blocking this PR):**
  - **external provider credentials cleanup.** `terraform/examples/greenfield/terraform.tfvars` injects `task_system_tasks_API_URL`; `oauth-authorize.ts` and `oauth-callback.ts` read `EXTERNAL_PROVIDER_CLIENT_ID` / `EXTERNAL_PROVIDER_CLIENT_SECRET` from `process.env`. With the admin UI gone and no live partner, these credentials should be zeroed in tfvars/SSM and the OAuth client revoked at the provider. Per `project_tfvars_secrets_hygiene` memory, migration to SSM is already planned for prod — fold this cleanup into that effort.
  - **Orphaned Secrets Manager audit.** The retired `/api/task-connectors/:slug/generate-secret` endpoint wrote task-connector signing secrets to AWS Secrets Manager via `packages/api/connector-secrets.ts`. A one-off audit of paths matching `thinkwork/{stage}/connector/task-*` (or equivalent naming from that handler) should delete any orphaned entries.
  - **`packages/api/connector-secrets.ts` disposition.** The handler exists and may still be deployed; if its API Gateway route is already gone (confirm during implementation), the handler itself can follow as dead code. Out of scope here because removing it also requires SSM audit coordination.
  - **Custom 404 UX.** Admin lacks a `notFoundComponent`; mobile lacks a `+not-found.tsx`. Both fall through to default blank/"Unmatched Route" states. Worth a separate pass once this PR lands.
  - **`starlight-links-validator` CI step.** First docs-pruning PR in the repo; worth adding a permanent link-check gate to catch future deletions cleanly.
- **Worth capturing a `ce:compound` learning after merge** — first feature-retirement entry in `docs/solutions/`; template for future cleanup PRs (TanStack Router removal, Astro sidebar sweep, multi-surface grep gate, mobile nav cleanup).

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-20-remove-admin-connectors-requirements.md`
- Prior-art commits: `c4b92d2` (Phase C: strip Task concept — route files, handlers), `81406b5` (terraform task-connectors removal)
- Related files: see Context & Research
- No external references (pure internal cleanup)
