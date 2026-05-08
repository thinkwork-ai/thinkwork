---
title: 'feat: scaffold apps/computer with sidebar shell (no auth)'
type: feat
status: superseded
date: 2026-05-08
origin: docs/plans/2026-05-08-001-feat-computer-thinkwork-ai-end-user-app-plan.md
superseded_by: docs/plans/2026-05-08-014-feat-thinkwork-computer-v1-consolidated-plan.md
---

# feat: scaffold apps/computer with sidebar shell (no auth)

This plan is superseded by `docs/plans/2026-05-08-014-feat-thinkwork-computer-v1-consolidated-plan.md`. Its scoped apps/computer scaffold work shipped via PR #962, and the consolidated Computer v1 plan now carries the remaining milestone sequencing.

## Summary

Phase 1 slice C (parent plan U5 + minimum-viable U7). Scaffolds `apps/computer` as a Vite + TanStack Router SPA that consumes `@thinkwork/ui` from day one and boots locally on `http://localhost:5180`. Renders a sidebar shell (New Thread CTA at the top, permanent nav: Computer / Automations / Inbox, Threads section with a static placeholder list) and four placeholder routes plus a 404 catch-all. **Auth is intentionally skipped this slice** — no Cognito, no `AuthContext`, no urql, no GraphQL queries. The acceptance bar is "open `localhost:5180` in a browser and see the shell."

---

## Requirements

- R1. New `apps/computer` workspace exists with `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/index.css`, `vite-env.d.ts`. Mirrors `apps/admin` tooling conventions (Vite 6 + React 19 + TanStack Router + Tailwind v4).
- R2. `pnpm --filter @thinkwork/computer dev` boots a Vite dev server on `http://localhost:5180`.
- R3. `pnpm --filter @thinkwork/computer build` produces a `dist/` directory with `index.html` referencing the bundled assets.
- R4. `pnpm --filter @thinkwork/computer typecheck` passes.
- R5. `apps/computer` consumes `@thinkwork/ui` for theme tokens (via `@import "@thinkwork/ui/theme.css"`) and shadcn primitives (Sidebar, Button, etc.). It does NOT duplicate any primitive.
- R6. Sidebar layout, top to bottom: **New Thread CTA** (button styled with primary color; click is a no-op or opens a stub dialog), then permanent nav items **Computer**, **Automations**, **Inbox** (each routes to `/computer`, `/automations`, `/inbox`), then a **Threads** section header with a static placeholder list of 3-5 fake thread rows.
- R7. Four placeholder routes exist: `/computer`, `/automations`, `/inbox`, `/threads/$id`. Each renders a uniform `<PlaceholderPage>` component with the route name and a "Coming in Phase 2" affordance.
- R8. A catch-all route `$.tsx` renders a `<NotFound>` component on unknown paths (e.g., `/people` from a copy-pasted admin URL).
- R9. `/` redirects to `/computer` (single-Computer-per-user invariant from the parent plan).
- R10. `apps/admin`, `apps/mobile`, `packages/ui`, and all backend code are unchanged. No Cognito callback URLs, no Terraform, no admin migration.
- R11. Dark mode is on by default (matches admin's `<html class="dark">` initial state); the dark/light toggle in the top bar works via `@thinkwork/ui`'s `useTheme`.

---

## Scope Boundaries

- **No auth.** No `AuthContext`, no Cognito SDK, no sign-in route, no `/auth/callback` handler, no `_authed` route gate. The sign-in flow lands in slice D.
- **No GraphQL.** No urql client, no `MyComputerQuery`, no `ComputerThreadsQuery`. Threads list in sidebar is static placeholder data hardcoded in the component.
- **No real Computer object.** No `myComputer` query, no `Computer` type imports.
- **No createThread mutation.** New Thread CTA opens a stub dialog (or no-op alert) — does not create a real thread. Real createThread is slice D.
- **No Terraform.** No `module "computer_site"`, no Cognito CallbackURLs additions, no Cloudflare DNS, no ACM SAN.
- **No CI deploy job.** No `scripts/build-computer.sh`, no `.github/workflows/deploy.yml` changes.
- **No admin or mobile changes.**
- **No 43rd primitive port.** Everything visual comes from `@thinkwork/ui`.
- **No CORS audit, no smoke against deployed URL.** Local-only acceptance.

### Deferred to Follow-Up Work

- Auth wiring (Cognito + Google OAuth + AuthContext + sign-in + callback) — slice D.
- Real threads list (myComputer + threads(computerId:) queries) — slice D.
- New Thread mutation flow (createThread with computerId + firstMessage) — slice D.
- Terraform site + Cognito callbacks + Cloudflare CNAME (parent U10) — separate slice.
- CI deploy job + smoke (parent U11 + U14) — separate slice.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/package.json` — Vite + TanStack Router + tailwindcss devDeps and exact version pins. Mirror everything except Cognito/urql/cmdk-extras (not needed in this slice).
- `apps/admin/vite.config.ts` — TanStack Router Vite plugin + react + tailwindcss; alias `@` → `./src`; port 5174. Mirror with port 5180.
- `apps/admin/src/main.tsx` — RouterProvider mount with `routeTree.gen.ts`. Strip out admin's many providers (Auth, Tenant, Urql, etc.) — keep only `<ThemeProvider>` from `@thinkwork/ui`.
- `apps/admin/src/index.css` — keeps reactflow-specific overrides; `apps/computer/src/index.css` is far simpler: just `@import "@thinkwork/ui/theme.css"`.
- `apps/admin/src/routes/_authed/_tenant.tsx` — sidebar layout pattern (SidebarProvider + AppSidebar + SidebarInset + top bar). Adapt for `apps/computer`: drop `_authed` gate, drop subscription provider, drop command palette, drop breadcrumbs, drop dialog providers, drop the dropdown-menu auth UI.
- `apps/admin/src/components/Sidebar.tsx` — admin's AppSidebar pattern. Computer writes a much thinner ComputerSidebar from scratch using `@thinkwork/ui`'s `Sidebar`/`SidebarMenu` primitives.
- `apps/admin/index.html` — meta tags + theme-color + `<html class="dark">`. Mirror with title "ThinkWork Computer".
- `apps/admin/codegen.ts` — NOT needed this slice (no GraphQL).
- `apps/admin/components.json` — shadcn config; not strictly needed this slice (no `npx shadcn add` runs against `apps/computer`), but include for parity if a future slice needs it.

### Institutional Learnings

- `docs/solutions/build-errors/worktree-stale-tsbuildinfo-drizzle-implicit-any-2026-04-24.md` — apps/computer extends `tsconfig.base.json`; keep `noEmit: true`, no `composite: true`. Avoid the cached-tsbuildinfo footgun.
- Memory `feedback_pnpm_in_workspace` — pnpm only, never npm.

---

## Key Technical Decisions

- **No auth = no `_authed` route gate.** All routes are public-by-routing in this slice. `apps/computer` is dev-only and not in any deployment pipeline. The next slice adds auth.
- **`/` → `/computer` redirect.** Single-Computer-per-user invariant from parent plan R19. The user's home is "their" Computer, not a list.
- **Sidebar threads list is hardcoded placeholder data** — 3-5 fake rows like "Welcome thread", "Sample thread 2", etc. Real data lands in slice D when GraphQL is wired.
- **New Thread CTA is a stub.** Click opens a tiny dialog with "Thread creation lands in the next slice" copy, or no-op via `console.log`. Real createThread is slice D.
- **Catch-all `$` route renders a NotFound page** with a "This route lives in admin — go to admin.thinkwork.ai" affordance. Per the design-lens finding from #959 review.
- **Workspace name stays `apps/computer`.** Matches the parent brainstorm + plan + domain (`computer.thinkwork.ai`). The api-contract reviewer's namespace-collision concern with `packages/computer-runtime` is acknowledged but not actioned — the two products are distinct (SPA vs. agent runtime image).
- **No `routeTree.gen.ts` checked in.** TanStack Router Vite plugin generates it on dev/build; `.gitignore` covers it.

---

## Implementation Units

### U1. Workspace skeleton + Vite + TanStack Router scaffolding

**Goal:** `pnpm install` recognizes `@thinkwork/computer`; `pnpm --filter @thinkwork/computer dev` boots an empty Vite server on port 5180.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None.

**Files:**
- Create: `apps/computer/package.json`
- Create: `apps/computer/tsconfig.json`
- Create: `apps/computer/vite.config.ts`
- Create: `apps/computer/index.html`
- Create: `apps/computer/vite-env.d.ts`
- Create: `apps/computer/src/main.tsx` (initial empty `<div>Hello</div>` mount)
- Create: `apps/computer/src/index.css` (`@import "@thinkwork/ui/theme.css"` only)

**Approach:**
- `package.json` mirrors admin's scripts (`dev`, `build`, `preview`, `test`, `typecheck`). Dependencies: `@thinkwork/ui: workspace:*`, `@tanstack/react-router`, `@tanstack/router-plugin`, `lucide-react`, `react`, `react-dom`, `clsx`, `tailwind-merge`. devDeps: `@tailwindcss/vite`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `tailwindcss`, `typescript`, `vite`, `vitest`. Pin versions to admin's exact pins where overlapping.
- `tsconfig.json` extends `tsconfig.base.json` with `jsx: "react-jsx"`, `noEmit: true`, `paths: { "@/*": ["./src/*"] }`, `include: ["src", "vite-env.d.ts"]`.
- `vite.config.ts`: TanStackRouterVite + react + tailwindcss plugins; alias `@` → `./src`; `server.port = 5180`. No zod alias workaround (no react-hook-form), no `define.global` (no Cognito SDK).
- `index.html`: `<html lang="en" class="dark" style="color-scheme: dark">` with `<title>ThinkWork Computer</title>` and `<meta name="theme-color" content="#1a1a1a">`.
- `main.tsx` (this unit): mount `<StrictMode><div>ThinkWork Computer scaffold</div></StrictMode>` to a `#root` div. RouterProvider lands in U2.

**Patterns to follow:**
- `apps/admin/package.json`, `apps/admin/vite.config.ts`, `apps/admin/index.html`, `apps/admin/tsconfig.json`.

**Verification:**
- `pnpm install` succeeds; `@thinkwork/computer` resolves.
- `pnpm --filter @thinkwork/computer typecheck` passes.
- `pnpm --filter @thinkwork/computer dev` reports "Local: http://localhost:5180/" without errors.

---

### U2. Routing tree + sidebar shell + placeholder pages

**Goal:** Visiting `localhost:5180` shows the sidebar layout with a clickable nav. All four placeholder routes render. `/` redirects to `/computer`. Unknown paths render the NotFound page. Theme toggle works.

**Requirements:** R5, R6, R7, R8, R9, R11

**Dependencies:** U1.

**Files:**
- Modify: `apps/computer/src/main.tsx` (add `<ThemeProvider>` from `@thinkwork/ui` + `<RouterProvider>` with the generated route tree)
- Create: `apps/computer/src/router.ts` (createRouter wrapper)
- Create: `apps/computer/src/routes/__root.tsx` (root Outlet)
- Create: `apps/computer/src/routes/index.tsx` (redirect to `/computer`)
- Create: `apps/computer/src/routes/_shell.tsx` (sidebar layout: SidebarProvider + ComputerSidebar + SidebarInset + top bar with theme toggle + Outlet)
- Create: `apps/computer/src/routes/_shell/computer.tsx` (renders `<PlaceholderPage title="Computer" />`)
- Create: `apps/computer/src/routes/_shell/automations.tsx`
- Create: `apps/computer/src/routes/_shell/inbox.tsx`
- Create: `apps/computer/src/routes/_shell/threads.$id.tsx` (renders `<PlaceholderPage title={`Thread ${threadId}`} />`)
- Create: `apps/computer/src/routes/$.tsx` (catch-all: renders `<NotFound />`)
- Create: `apps/computer/src/components/ComputerSidebar.tsx` (sidebar with New Thread CTA + 3 nav items + Threads section with hardcoded placeholder list of 3 fake thread rows)
- Create: `apps/computer/src/components/PlaceholderPage.tsx` (uniform placeholder component)
- Create: `apps/computer/src/components/NotFound.tsx`
- Create: `apps/computer/src/components/AppTopBar.tsx` (theme toggle + sidebar trigger; no auth UI)
- Add: `apps/computer/.gitignore` entry for `src/routeTree.gen.ts`

**Approach:**
- `routeTree.gen.ts` is auto-generated by the TanStackRouterVite plugin on dev/build — gitignored.
- `_shell.tsx` is the layout that wraps all four authenticated-feel pages (even though there's no auth). Uses `@thinkwork/ui`'s `Sidebar`, `SidebarProvider`, `SidebarInset`, `SidebarTrigger`, plus `useTheme` for the theme toggle.
- `ComputerSidebar.tsx` renders, top to bottom:
  - `<SidebarHeader>` with the "ThinkWork" wordmark.
  - **New Thread → Blank Chat** button (primary-styled). Click is a no-op + `console.log` for now.
  - `<SidebarGroup>` with 3 nav items (Computer / Automations / Inbox), each using `<Link to="/computer" />` etc. Highlight active route via TanStack's `useRouterState`.
  - `<SidebarGroup label="Threads">` with a static `<SidebarMenu>` of 3 hardcoded rows. Each row is a `<Link to="/threads/$id" params={{ id: "..." }} />`.
- `PlaceholderPage` accepts a `title` prop. Renders an h1 + a one-sentence "This surface lands in Phase 2 — auth + real data come in the next slice."
- `NotFound` renders an h1 ("Not found") + "This path doesn't exist on computer.thinkwork.ai. If you're looking for an admin surface (People, Billing, Compliance, etc.), they live at admin.thinkwork.ai." Includes a back-to-home link to `/computer`.
- `AppTopBar` renders the sidebar trigger + a theme-toggle button using `useTheme` from `@thinkwork/ui`.

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant.tsx` for the SidebarProvider + SidebarInset shell. Strip auth-related children and providers.
- `apps/admin/src/components/Sidebar.tsx` for the AppSidebar shape — but write a much thinner version that doesn't query GraphQL.

**Test scenarios:**
- Test expectation: minimal smoke. Add a single vitest in `apps/computer/test/smoke.test.tsx` that imports `<PlaceholderPage>` and asserts it renders. Defer broader render tests to slice D.

**Verification:**
- `pnpm --filter @thinkwork/computer dev` → open `http://localhost:5180/` → see the sidebar shell with placeholder content.
- Clicking each nav item navigates and the corresponding placeholder renders.
- Pasting `/people` (an admin path) in the URL bar shows the NotFound page.
- Theme toggle flips between dark and light; document `class="dark"` toggles correctly.
- `pnpm --filter @thinkwork/computer build` produces a `dist/` with no errors.
- `pnpm --filter @thinkwork/computer typecheck` passes.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| TanStack Router Vite plugin generates `routeTree.gen.ts` lazily; first dev boot may show a brief "module not found" until generation completes | Run `pnpm --filter @thinkwork/computer dev` once before typecheck so the generated file exists. Alternatively, run `pnpm --filter @thinkwork/computer build` once, which generates it eagerly. |
| `@thinkwork/ui`'s `Sidebar` component imports `useIsMobile` which references `window.matchMedia` | Vite serves modules client-side; `window` is defined. SSR isn't in scope. No mitigation needed for dev. |
| `apps/computer/src/index.css`'s `@import "@thinkwork/ui/theme.css"` may not resolve through Vite's CSS pipeline if the package's `exports["./theme.css"]` is malformed | Verified during implementation by booting the dev server. The `exports` map in `packages/ui/package.json` already declares `./theme.css`. |
| Workspace name collision with `packages/computer-runtime` (per #961 review) | Documented in Key Technical Decisions. Both products keep their names; the SPA is at `apps/computer` and the runtime is at `packages/computer-runtime`. CI summary will list them adjacently — operators read PR titles, not just check names. |

---

## Sources & References

- **Origin (parent plan):** [docs/plans/2026-05-08-001-feat-computer-thinkwork-ai-end-user-app-plan.md](docs/plans/2026-05-08-001-feat-computer-thinkwork-ai-end-user-app-plan.md)
- **Predecessors merged:** #959 (UI skeleton), #961 (43 primitives)
- Reference admin: `apps/admin/package.json`, `apps/admin/vite.config.ts`, `apps/admin/src/main.tsx`, `apps/admin/src/routes/_authed/_tenant.tsx`, `apps/admin/src/components/Sidebar.tsx`
