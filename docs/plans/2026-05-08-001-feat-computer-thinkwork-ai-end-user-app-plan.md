---
title: 'feat: computer.thinkwork.ai end-user web app'
type: feat
status: active
date: 2026-05-08
origin: docs/brainstorms/2026-05-08-computer-thinkwork-ai-end-user-app-requirements.md
---

# feat: computer.thinkwork.ai end-user web app

## Summary

Phase 0 extracts admin's UI primitives, theme, and sidebar shell into a new `@thinkwork/ui` package and migrates admin to consume it. Phase 1 scaffolds `apps/computer` (Vite + TanStack Router + urql + Cognito), wires Google OAuth via the existing `ThinkworkAdmin` Cognito client (adding new CallbackURLs/LogoutURLs), builds a sidebar with a "New Thread → Blank Chat" CTA + permanent placeholder pages + Computer-scoped threads list using existing GraphQL surfaces, and stands up a parallel static-site Terraform instance plus a Cloudflare CNAME / ACM SAN. Phase 1 ships to dev only behind a deployed-URL smoke gate.

---

## Problem Frame

Admin is shaped for the operator; mobile is the on-the-go end-user surface; nothing on the web is shaped for an end user at their desk. See origin (`docs/brainstorms/2026-05-08-computer-thinkwork-ai-end-user-app-requirements.md`) for the full pain narrative.

---

## Requirements

- R1. A new `apps/computer` workspace exists in the monorepo with the same tooling conventions as `apps/admin`. (origin R1)
- R2. The app is reachable in dev at `https://computer.thinkwork.ai` after Phase 1; production rollout is a separate user-driven step. (origin R2)
- R3. DNS + TLS follow admin's pattern: Cloudflare CNAME (DNS-only) → CloudFront, ACM cert in us-east-1. (origin R3)
- R4. Auth reuses the existing Cognito user pool and `ThinkworkAdmin` app client; computer.thinkwork.ai origins are added to its CallbackURLs/LogoutURLs. (origin R4)
- R5. Sidebar's first item is a "New Thread → Blank Chat" CTA. (origin R5)
- R6. The CTA creates a real thread on the caller's Computer and routes the user to that thread. (origin R6)
- R7. Sidebar permanent nav: Computer → Automations → Inbox. (origin R7)
- R8. Threads section shows threads on the caller's Computer, newest first, capped. (origin R8)
- R9. Computer / Automations / Inbox routes are placeholder pages in Phase 1. (origin R9)
- R10. `/threads/$id` is a placeholder in Phase 1. (origin R10)
- R11. Sign-out, dark-mode toggle, and command palette match admin behavior. (origin R11)
- R12. Single sign-in across admin and computer.thinkwork.ai (subject to refresh-token mechanics). (origin R12)
- R13. Every authenticated query is bounded to the caller's identity / Computer. (origin R13)
- R14. `@thinkwork/ui` package contains shared visual primitives, theme tokens, and the sidebar shell. (origin R14, refined: not the heavyweight `CreateThreadDialog`)
- R15. `apps/admin` migrates to consume `@thinkwork/ui`; behavior otherwise unchanged. (origin R15)
- R16. `apps/computer` consumes `@thinkwork/ui` from day one. (origin R16)
- R17. Routing, urql, Cognito hooks, admin-domain components stay app-local. (origin R17)
- R18. Operator-only surfaces are not navigable on `computer.thinkwork.ai`. (origin R18)
- R19. The "Computer" nav goes to a single page, not a list. (origin R19)

**Origin actors:** A1 (end user), A2 (tenant operator — out-of-scope receiver), A3 (existing Cognito identity), A4 (caller's Computer).
**Origin flows:** F1 (sign-in), F2 (new thread), F3 (sidebar threads), F4 (placeholder pages).
**Origin acceptance examples:** AE1 (R3, R4, R12), AE2 (R5, R6, R8), AE3 (R7, R8, R13), AE4 (R9, R10), AE5 (R14, R15, R16), AE6 (R18, R19).

---

## Scope Boundaries

- No changes to the `threadsPaged` resolver (no `computerId` filter); Phase 1 sidebar uses non-paged `threads(computerId:)`.
- No visual regression infrastructure (Chromatic, Percy, Storybook) for `@thinkwork/ui`; drift signal is typed-export breakage on both consumers.
- No production-stage rollout in Phase 1.
- No mobile-app changes.
- No admin functional changes other than consuming `@thinkwork/ui`.
- No thread chat UI; no real Computer / Automations / Inbox page content (Phase 2 in origin).
- No new Cognito app client (origin R4 — reuse existing).
- No `ThinkworkAdmin` client rename.
- No password-auth path on `apps/computer` (Google OAuth via the existing client only).

### Deferred to Follow-Up Work

- Computer-scoped pagination on `threadsPaged` (with totalCount): follow-up plan when a deep `/threads` page is needed in computer.thinkwork.ai.
- Storybook / visual regression for `@thinkwork/ui`: follow-up if drift becomes painful.
- Phase 2 (real Computer / Automations / Inbox / chat UI / production rollout): tracked in origin scope boundaries; separate plan(s).

---

## Context & Research

### Relevant Code and Patterns

- **Static-site Terraform module instance** — `terraform/modules/thinkwork/main.tf` lines 542-550 define `module "admin_site"`; lines 87-96 wire admin callback URL `concat()` into `aws_cognito_user_pool_client.admin.callback_urls` (`terraform/modules/foundation/cognito/main.tf:212`). The new `module "computer_site"` mirrors this exactly.
- **Cert-SAN gate** — `terraform/modules/app/www-dns/main.tf:43-48` uses plain bools (`include_admin`, `include_docs`, `include_api`) to break the cert-vs-distribution cycle. Adding `include_computer` follows the same pattern; lines 76-97 auto-create Cloudflare validation records via `for_each`.
- **Greenfield wiring** — `terraform/examples/greenfield/main.tf:255-258` derives `local.admin_domain = "admin.${var.www_domain}"` etc.; greenfield is the live root that calls into `terraform/modules/thinkwork`.
- **Build script** — `scripts/build-admin.sh` (80 lines) reads Terraform outputs, writes `apps/admin/.env.production`, runs `pnpm --filter admin build`, syncs S3, invalidates CloudFront. `scripts/build-computer.sh` mirrors it line-for-line.
- **CI deploy** — `.github/workflows/deploy.yml` `build-admin` job (lines 941-980) is the template for `build-computer`; path filter at lines 66-67; summary block at line 1097.
- **Admin auth** — `apps/admin/src/lib/auth.ts` (350 lines), `apps/admin/src/context/AuthContext.tsx`, `apps/admin/src/context/TenantContext.tsx`, `apps/admin/src/routes/auth/callback.tsx`, `apps/admin/src/routes/_authed.tsx`, `apps/admin/src/routes/sign-in.tsx`. All decoupled enough to copy into `apps/computer` near-verbatim.
- **urql client** — `apps/admin/src/lib/graphql-client.ts` (283 lines), single `graphqlClient` with a custom AppSync subscription exchange. Phase 1 doesn't need subscriptions — copy without the subscription exchange to start.
- **Existing GraphQL surface (no schema changes needed):**
  - `myComputer` resolver: `packages/api/src/graphql/resolvers/computers/myComputer.query.ts`
  - `threads(tenantId, computerId, limit)` query: `packages/database-pg/graphql/types/threads.graphql:178-187`; resolver `packages/api/src/graphql/resolvers/threads/threads.query.ts:18`
  - `CreateThreadInput` already accepts `computerId` and `firstMessage`: `packages/database-pg/graphql/types/threads.graphql:118-136`
  - Reference query already in admin: `ComputerThreadsQuery` at `apps/admin/src/lib/graphql-queries.ts:379`
- **Tailwind v4 CSS-first config** — admin has no `tailwind.config.{ts,js}`. `apps/admin/src/index.css` (297 lines) carries the `@theme inline` block + `:root` / `.dark` color tables + base layer + scrollbars. Vite plugin `@tailwindcss/vite` configured in `apps/admin/vite.config.ts:11`.
- **Theme context** — `apps/admin/src/context/ThemeContext.tsx` (58 lines, no app coupling). localStorage key `thinkwork.theme`, document class toggle, `<meta name="theme-color">` updates.
- **Sidebar primitive** — `apps/admin/src/components/ui/sidebar.tsx` (703 lines). Self-contained except for `useIsMobile` at `apps/admin/src/hooks/use-mobile.ts` (19 lines).
- **shadcn primitive inventory** — 43 files at `apps/admin/src/components/ui/`. All depend only on Radix + cva + clsx + tailwind-merge + lucide. `sonner.tsx` imports `@/context/ThemeContext` (relocate the context with it). All import `cn` from `@/lib/utils` (4-line `clsx + tailwind-merge`).
- **Reference for new package shape** — `packages/pricing-config` (no React, simplest) and `packages/admin-ops` (multi-export). Both use TS-source pattern (`"main": "./src/index.ts"`, no compile step). `packages/react-native-sdk` uses peer-dep React + `composite:true`; `@thinkwork/ui` follows pricing-config's TS-source pattern but with React peer deps.
- **`CreateThreadDialog` (do NOT extract)** — `apps/admin/src/components/threads/CreateThreadDialog.tsx` (445 lines, agent picker + status enum + due-date). Origin R14 originally listed it; the plan instead extracts the underlying primitives and writes a thin new dialog in `apps/computer`.
- **Worktree env-file step** — `AGENTS.md:93-99` requires copying `.env` into worktrees; same applies to `apps/computer`.
- **Concurrent vite ports + Cognito callbacks** — `CLAUDE.md:93` + memory `project_admin_worktree_cognito_callbacks`: every dev port must be in `ThinkworkAdmin.CallbackURLs` or sign-in fails with `redirect_mismatch`.

### Institutional Learnings

- `docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md` — Drift-detection forcing function is the load-bearing question for any extraction. The plan's drift signal is typed exports both apps import; export-shape breakage fails CI on both sides.
- `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md` — Each component on the extract-list is a bridge-cost decision, not a feature wishlist. The plan's component inventory is grounded in research, not invention.
- `docs/solutions/build-errors/worktree-stale-tsbuildinfo-drizzle-implicit-any-2026-04-24.md` — Skip `composite:true` on `@thinkwork/ui`; TS-source pattern means no `dist/` to bootstrap.
- `docs/solutions/integration-issues/lambda-options-preflight-must-bypass-auth-2026-04-21.md` — A new origin (`https://computer.thinkwork.ai`) triggers OPTIONS preflights against every REST handler the SPA reaches. The CORS audit is its own implementation unit.
- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` — `ctx.auth.tenantId` is null for Google-federated users; mutations and queries must use `resolveCallerTenantId(ctx)`. The reused paths already do; verification is part of U9 + U13.
- `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md` — Tenant-only `WHERE` without per-user predicate leaks data in multi-user tenants. The multi-user fixture test (U13) keeps single-user-tenant testing from hiding it.
- `docs/solutions/patterns/mcp-custom-domain-setup-2026-04-23.md` — Two-pass apply applies when validation records are out-of-band. Not this case: `www-dns` already manages validation via `for_each`. Single-apply works here.
- `docs/solutions/workflow-issues/deploy-silent-arch-mismatch-took-a-week-to-surface-2026-04-24.md` — Cross-component handshakes fail silently while CI is green. Phase 1's done-criterion is a smoke against the deployed URL (U14), not just merge.
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — N/A (no schema changes in Phase 1).

### External References

External research not invoked — all relevant patterns are already in-repo.

---

## Key Technical Decisions

- **No GraphQL schema changes in Phase 1.** Existing `threads(tenantId, computerId)` query, `myComputer` resolver, `CreateThreadInput.computerId` and `firstMessage` cover the brainstorm scope. Resolves origin OQs about new fields and mutation shape.
- **`@thinkwork/ui` uses TS-source layout, not compiled.** `"main": "./src/index.ts"`, no `composite:true`, no `dist/`. Mirrors `packages/pricing-config` and avoids the worktree-tsbuildinfo footgun.
- **Theme moves into the package.** Ship `theme.css` (the `@theme inline` block + `:root` / `.dark` tables + base layer + scrollbars) as a CSS import; ship `ThemeProvider`/`useTheme` as exports. Both consumers `@import "@thinkwork/ui/theme.css"` from their own `index.css`. Sonner's existing `useTheme` import becomes intra-package.
- **`CreateThreadDialog` does NOT move into `@thinkwork/ui`.** Admin's 445-line dialog is admin-shaped (agent picker, status enum, due date). Origin R14 listed "create-thread dialog primitive"; this plan refines to "extract Dialog + form primitives; `apps/computer` writes a thin `NewThreadDialog`."
- **Single-apply Terraform.** `www-dns`'s `cert_sans` is gated on plain bools, and `acm_validation` Cloudflare records auto-create via `for_each`. Adding `include_computer = true` produces cert SAN + validation records + CloudFront cert binding + CNAME in one apply.
- **Reuse existing `ThinkworkAdmin` Cognito client** — extend the existing `concat()` for `admin_callback_urls` / `admin_logout_urls` in `terraform/modules/thinkwork/main.tf:87-96`. One client, four origins (admin distribution, admin domain, computer distribution, computer domain — each with `/auth/callback`). No new client variables.
- **Local dev port 5180 for `apps/computer`** (admin uses 5174 + worktree range 5175+). Add `http://localhost:5180` and `http://localhost:5180/auth/callback` to default `var.admin_callback_urls` so local sign-in works without a one-off Cognito edit.
- **CORS audit + multi-user fixture test + dev-URL smoke are explicit units**, not informal checks. Each is grounded in a specific institutional learning.
- **Phase 1 acceptance gate = deployed-URL smoke**, not green CI.
- **Drift detection for `@thinkwork/ui`** = typed exports both apps import. Storybook / visual regression deferred unless drift becomes painful.

---

## Open Questions

### Resolved During Planning

- *Origin: "Determine threads-by-Computer GraphQL shape"* — Resolved: existing `threads(tenantId, computerId)` is sufficient for Phase 1. Reference query `ComputerThreadsQuery` already exists at `apps/admin/src/lib/graphql-queries.ts:379`.
- *Origin: "Confirm reuse of admin's create-thread mutation and computer-scoping inputs"* — Resolved: `CreateThreadInput.computerId` and `firstMessage` already in canonical schema. `apps/computer` calls existing `createThread` mutation with both.
- *Origin: "Identify Cloudflare DNS resource pattern"* — Resolved: `terraform/modules/app/www-dns/main.tf` `include_admin` pattern at lines 34-55, 238-248. Mirror as `include_computer`.
- *Origin: "Define CallbackURLs to add to `ThinkworkAdmin`"* — Resolved: extend `concat()` at `terraform/modules/thinkwork/main.tf:87-96`. Admin distribution + admin domain + computer distribution + computer domain (each with `/auth/callback`), plus `http://localhost:5180` + `/auth/callback` for local dev.
- *Origin: "Identify which `apps/admin/src/components/ui/*` files belong in the new package"* — Resolved: all 43 files; sidebar drags `useIsMobile` with it; sonner drags `ThemeContext` with it; `cn` util moves to `packages/ui/src/lib/utils.ts`.
- *Origin: "Sequence the admin migration"* — Resolved: single PR per phase. Phase 0 PR creates the package + moves files + admin imports updated in lockstep + admin behavior unchanged. No backwards-compatible re-export shim because admin owns both halves of the move.
- *Origin: cross-domain refresh-token behavior* — Defer to dev smoke (U14): the smoke verifies that signing into admin and then visiting `computer.thinkwork.ai` reaches an authenticated surface without re-OAuth. If smoke fails, follow-up.

### Deferred to Implementation

- Exact `peerDependencies` list for `@thinkwork/ui` — discover during U2 by reading the actual imports of moved files; declare what's used.
- Whether `apps/computer` needs the AppSync subscription exchange in `lib/graphql-client.ts` for Phase 1 — likely no (sidebar + CTA + placeholders don't need realtime). Decide during U6; copy from admin omitting the subscription exchange to start.
- Exact behavior of the placeholder thread-detail route — minimal `<div>` with thread title/id and a "chat UI coming soon" affordance. Decide copy during U7.
- Whether to commit `apps/computer/src/gql/` to git as admin does, or gitignore. Decide during U5; default to mirroring admin (commit it).

---

## Output Structure

    apps/computer/
      package.json
      vite.config.ts
      tsconfig.json
      codegen.ts
      components.json
      index.html
      vite-env.d.ts
      .env.example
      public/
      src/
        main.tsx
        index.css                           # @import @thinkwork/ui/theme.css + app-specific
        gql/                                # codegen output
        context/
          AuthContext.tsx                   # copy from admin
          TenantContext.tsx                 # copy from admin
        lib/
          auth.ts                           # copy from admin
          graphql-client.ts                 # copy from admin (no subscription exchange)
          graphql-queries.ts                # only the queries this app uses
          api-fetch.ts                      # copy from admin
          utils.ts                          # app-specific helpers (cn re-imported from @thinkwork/ui)
        hooks/
        components/
          ComputerSidebar.tsx               # the new app's sidebar
          NewThreadDialog.tsx               # thin dialog calling createThread
        routes/
          __root.tsx
          sign-in.tsx                       # copy from admin
          _authed.tsx                       # copy from admin
          _authed/
            _shell.tsx                      # TenantLayout equivalent for computer
            _shell/
              computer.tsx                  # placeholder
              automations.tsx               # placeholder
              inbox.tsx                     # placeholder
              threads.$id.tsx               # placeholder
          auth/
            callback.tsx                    # copy from admin

    packages/ui/
      package.json
      tsconfig.json
      README.md
      src/
        index.ts                            # re-exports
        theme.css                           # extracted @theme + tokens
        lib/
          utils.ts                          # cn helper
        hooks/
          use-mobile.ts                     # moved from admin
        context/
          ThemeContext.tsx                  # moved from admin
        components/
          ui/                               # 43 shadcn primitives + sidebar.tsx + sonner.tsx
          ...

    scripts/
      build-computer.sh                     # mirrors build-admin.sh
      smoke-computer.sh                     # Phase 1 acceptance smoke

    terraform/
      modules/
        thinkwork/
          main.tf                           # add module "computer_site" + extend callback URLs
          variables.tf                      # add computer_domain + computer_certificate_arn
          outputs.tf                        # add computer_distribution_id, computer_url, etc.
        app/
          www-dns/
            main.tf                         # add include_computer + computer CNAME
            variables.tf                    # add include_computer + computer_cloudfront_domain_name
      examples/
        greenfield/
          main.tf                           # add local.computer_domain + pass-through

    .github/
      workflows/
        deploy.yml                          # add path filter + build-computer job + summary

---

## Implementation Units

### U1. Create `@thinkwork/ui` package skeleton

**Goal:** Establish the new package's shape so primitives can move in cleanly in U2-U3.

**Requirements:** R14, R16, R17

**Dependencies:** None.

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/index.ts` (empty re-export barrel for now)
- Create: `packages/ui/src/lib/utils.ts` (the `cn` helper)
- Create: `packages/ui/README.md` (one-paragraph statement of scope)

**Approach:**
- Name the package `@thinkwork/ui`. TS-source layout: `"main": "./src/index.ts"`, `"types": "./src/index.ts"`, exports map `{ ".": "./src/index.ts", "./theme.css": "./src/theme.css", "./lib/utils": "./src/lib/utils.ts" }` (theme path materialises in U3).
- `peerDependencies`: `react`, `react-dom`, plus the radix / cva / clsx / tailwind-merge / lucide / cmdk / react-hook-form / @hookform/resolvers / zod / sonner / recharts dependencies actually imported by primitives moved in U2-U3. Final list determined during U2 by reading the moved files' imports.
- No `composite: true`, no `dist/`. tsconfig extends repo's base.
- Workspace `pnpm install` reaches the package via the existing `apps/*` / `packages/*` glob.

**Patterns to follow:**
- `packages/pricing-config/package.json` for TS-source layout and exports.
- `packages/admin-ops/package.json` for multi-`exports` map.

**Test scenarios:**
- Test expectation: none — pure scaffolding. The drift-detection forcing function (typed exports both apps import) lands in U2 and U4.

**Verification:**
- `pnpm install` succeeds; `@thinkwork/ui` resolves from a workspace consumer's `node_modules`.
- `pnpm --filter @thinkwork/ui typecheck` passes against the empty barrel.

---

### U2. Move shadcn primitives, sidebar, and supporting hooks to `@thinkwork/ui`

**Goal:** All visual primitives admin uses live in the package and re-export through the barrel.

**Requirements:** R14, R16

**Dependencies:** U1.

**Files:**
- Move (admin → package): `apps/admin/src/components/ui/*.tsx` (43 files) → `packages/ui/src/components/ui/*.tsx`
- Move: `apps/admin/src/hooks/use-mobile.ts` → `packages/ui/src/hooks/use-mobile.ts` (sidebar.tsx imports it)
- Modify: `packages/ui/src/index.ts` (add re-exports for every moved component)
- Modify: `packages/ui/package.json` (peer-deps now reflect actual imports of moved files)

**Approach:**
- Replace internal `@/lib/utils` imports in moved files with `../lib/utils` (or appropriate relative). The `cn` helper is the only thing they need from utils; admin's domain helpers (`formatCents`, `formatDate`, etc.) stay in `apps/admin/src/lib/utils.ts`.
- `sonner.tsx`'s `import { useTheme } from "@/context/ThemeContext"` will not resolve in this unit; defer the fix to U3 when ThemeContext also moves. Mark with a TODO; expect typecheck failure on `sonner.tsx` until U3 lands.
- Admin's imports still point at `@/components/ui/*`; admin keeps working until U4 swaps them. The duplicate `apps/admin/src/components/ui/*` files are NOT deleted in this unit (would break admin); deletion happens in U4.

**Patterns to follow:**
- `packages/pricing-config/src/index.ts` for barrel-export pattern.

**Test scenarios:**
- Happy path: `pnpm --filter @thinkwork/ui typecheck` passes (modulo sonner.tsx if U3 hasn't run).
- Integration: import `Button` from `@thinkwork/ui` in a one-off test file; render the button; assert it carries the expected class names.
- Edge case: `data-table.tsx` and `chart.tsx` peer-dep on `@tanstack/react-table` and `recharts` resolve correctly when imported from a consumer.

**Verification:**
- All non-sonner files in `packages/ui/src/components/ui/` typecheck cleanly.
- `pnpm --filter @thinkwork/ui typecheck` passes (with sonner.tsx flagged for U3).

---

### U3. Move ThemeContext, useTheme, and theme.css to `@thinkwork/ui`; resolve sonner

**Goal:** Theme and dark-mode infrastructure ships from the package; sonner's `useTheme` import resolves intra-package; the package exposes a single `theme.css` consumers `@import`.

**Requirements:** R11, R14, R16

**Dependencies:** U1, U2.

**Files:**
- Move: `apps/admin/src/context/ThemeContext.tsx` → `packages/ui/src/context/ThemeContext.tsx`
- Create: `packages/ui/src/theme.css` (extracted from `apps/admin/src/index.css`)
- Modify: `packages/ui/src/index.ts` (re-export `ThemeProvider`, `useTheme`)
- Modify: `packages/ui/src/components/ui/sonner.tsx` (`import { useTheme } from "../../context/ThemeContext"`)
- Modify: `packages/ui/package.json` (`exports["./theme.css"]` from U1 now points at the new file)

**Approach:**
- `theme.css` contains: `@import "tailwindcss"`, `@import "tw-animate-css"`, `@import "shadcn/tailwind.css"`, fontsource Geist import, the `@theme inline { ... }` block, the `:root` and `.dark` token tables, base scrollbars, and the standard shadcn base layer. Admin- and reactflow-specific overrides stay in `apps/admin/src/index.css`.
- `ThemeContext.tsx` keeps its localStorage key (`thinkwork.theme`), document-class toggle, and `<meta name="theme-color">` updates exactly as in admin. No behavioral change.
- After move, `sonner.tsx` typechecks against the package-relative `useTheme`.

**Patterns to follow:**
- `apps/admin/src/index.css` lines 1-123 for theme content layout.
- `apps/admin/src/context/ThemeContext.tsx` is a verbatim move.

**Test scenarios:**
- Happy path: `pnpm --filter @thinkwork/ui typecheck` passes including sonner.tsx.
- Integration: render a `<ThemeProvider>`-wrapped tree, call `toggleTheme`, assert `document.documentElement.classList.contains('dark')` flips.
- Edge case: localStorage key collision — `ThemeProvider` reads `thinkwork.theme` defaulting to `"dark"`.

**Verification:**
- `packages/ui/src/theme.css` exists; importing it from a consumer's CSS does not error in Vite.
- `<ThemeProvider>` and `useTheme` are exported from `@thinkwork/ui`.

---

### U4. Migrate `apps/admin` to consume `@thinkwork/ui`

**Goal:** Admin imports primitives, theme tokens, and ThemeProvider from the package; duplicates removed; admin behavior unchanged.

**Requirements:** R14, R15, R17

**Dependencies:** U1, U2, U3.

**Files:**
- Modify: `apps/admin/package.json` (add `"@thinkwork/ui": "workspace:*"`)
- Modify: `apps/admin/src/index.css` (replace the moved imports/blocks with `@import "@thinkwork/ui/theme.css"`; keep admin-specific reactflow/animation overrides)
- Modify: ~150-200 admin files that import from `@/components/ui/*`, `@/context/ThemeContext`, or `@/hooks/use-mobile` — switch to `@thinkwork/ui`. Repo-wide search-and-replace covers the canonical paths. `@/lib/utils`'s `cn` helper now imports from `@thinkwork/ui/lib/utils`.
- Delete: `apps/admin/src/components/ui/*.tsx` (the 41 moved files)
- Delete: `apps/admin/src/context/ThemeContext.tsx`
- Delete: `apps/admin/src/hooks/use-mobile.ts`
- Modify: `apps/admin/src/lib/utils.ts` — drop the `cn` definition (re-export from `@thinkwork/ui` for back-compat, or migrate callers to import from `@thinkwork/ui` directly). Domain helpers remain.

**Approach:**
- The migration is mechanical search-and-replace plus a delete pass. Verify with `pnpm --filter @thinkwork/admin typecheck` + `lint`.
- Keep admin's `apps/admin/components.json` (shadcn config). The package owns the source of truth for primitives but isn't shadcn-CLI-managed.
- Deletions land in the same PR as the search-and-replace; no parallel-import phase.
- Verify dark-mode toggle, sidebar collapse (Cmd/Ctrl+B), command palette (Cmd/Ctrl+K), and dialogs all still work in admin before merge.

**Execution note:** Run `pnpm --filter @thinkwork/admin typecheck` after every batch of import updates rather than at the end — small typo'd imports surface immediately.

**Patterns to follow:**
- Existing `apps/admin/src/index.css` import block.

**Test scenarios:**
- Covers AE5. Happy path: `pnpm --filter @thinkwork/admin build` succeeds; the bundle contains a single resolved copy of each primitive (via the package), not duplicates.
- Integration: `pnpm --filter @thinkwork/admin dev`; sign in (Google OAuth); verify dashboard renders, sidebar toggles, dark mode persists, command palette opens, dialogs render correctly.
- Edge case: a file accidentally still imports from `@/components/ui/*` — typecheck fails because the path no longer resolves; CI catches it.
- Edge case: a missing peer-dep in `@thinkwork/ui` — surfaces as a build-time `Cannot find module` from admin's vite build.

**Verification:**
- `apps/admin/src/components/ui/` is empty (or removed).
- Admin renders identically before and after (visual smoke).
- `pnpm --filter @thinkwork/admin typecheck`, `lint`, and `build` all pass.

---

### U5. Scaffold `apps/computer` workspace

**Goal:** A new Vite + TanStack Router + urql + Cognito SPA skeleton boots locally, consumes `@thinkwork/ui`, has codegen wired, and renders an empty signed-out shell.

**Requirements:** R1, R16

**Dependencies:** U1, U2, U3 (`@thinkwork/ui` must exist; U4 not strictly required but recommended to lockstep).

**Files:**
- Create: `apps/computer/package.json`
- Create: `apps/computer/vite.config.ts`
- Create: `apps/computer/tsconfig.json`
- Create: `apps/computer/codegen.ts`
- Create: `apps/computer/components.json` (`style: radix-nova`, `baseColor: neutral` matching admin)
- Create: `apps/computer/index.html`
- Create: `apps/computer/vite-env.d.ts`
- Create: `apps/computer/.env.example`
- Create: `apps/computer/src/main.tsx`
- Create: `apps/computer/src/index.css` (`@import "@thinkwork/ui/theme.css"` + minimal app-specific overrides)
- Create: `apps/computer/src/routes/__root.tsx`
- Create: `apps/computer/src/lib/utils.ts` (app-specific helpers; `cn` imports from `@thinkwork/ui/lib/utils`)

**Approach:**
- Mirror `apps/admin/package.json` scripts (`dev`, `build`, `preview`, `test`, `codegen`). Vite dev port 5180 (configured in `vite.config.ts`).
- `vite.config.ts` registers `@tailwindcss/vite` + `@tanstack/router-plugin`. Mirror admin's plugin order.
- `codegen.ts` is a near-verbatim copy of `apps/admin/codegen.ts`: schema points at `../../packages/database-pg/graphql/{schema.graphql,types/*.graphql}`; generates `src/gql/`.
- `main.tsx` renders `<ThemeProvider>` (from `@thinkwork/ui`) wrapping a `RouterProvider`.
- `__root.tsx` is an `<Outlet />` shell.
- `apps/computer/.env.example` mirrors admin's `VITE_*` variable names verbatim.

**Patterns to follow:**
- `apps/admin/package.json`, `apps/admin/vite.config.ts`, `apps/admin/codegen.ts`, `apps/admin/index.html`, `apps/admin/src/main.tsx`, `apps/admin/src/routes/__root.tsx`.

**Test scenarios:**
- Happy path: `pnpm --filter @thinkwork/computer dev` boots; `http://localhost:5180` renders an empty page with shared theme tokens applied.
- Integration: `pnpm --filter @thinkwork/computer build` succeeds and emits a `dist/` with `index.html` referencing the bundled CSS/JS.
- Edge case: codegen runs cleanly (`pnpm --filter @thinkwork/computer codegen`) with the empty `src/` documents glob; no errors.

**Verification:**
- Dev server boots on :5180.
- Production build emits `dist/`.
- `@thinkwork/ui` is a workspace dependency that resolves at build time.

---

### U6. Wire authentication: Cognito + Google OAuth + AuthContext + TenantContext + sign-in + callback routes

**Goal:** End user can complete Google OAuth on `apps/computer` against the existing `ThinkworkAdmin` Cognito client and reach an authenticated route.

**Requirements:** R4, R12, R13

**Dependencies:** U5 (scaffold).

**Files:**
- Create: `apps/computer/src/lib/auth.ts` (copy from `apps/admin/src/lib/auth.ts`)
- Create: `apps/computer/src/lib/api-fetch.ts` (copy from admin)
- Create: `apps/computer/src/lib/graphql-client.ts` (copy from admin; remove the AppSync subscription exchange)
- Create: `apps/computer/src/context/AuthContext.tsx` (copy from admin)
- Create: `apps/computer/src/context/TenantContext.tsx` (copy from admin)
- Create: `apps/computer/src/routes/sign-in.tsx` (adapt from admin's; minimal copy)
- Create: `apps/computer/src/routes/_authed.tsx` (copy from admin)
- Create: `apps/computer/src/routes/auth/callback.tsx` (copy from admin)
- Modify: `apps/computer/src/main.tsx` (wrap with `AuthProvider` + `TenantProvider`)

**Approach:**
- Verbatim copies where possible; admin's auth lib is decoupled enough to drop in.
- `sign-in.tsx` renders a "Sign in with Google" button (or auto-redirects). No password fallback path.
- `getGoogleSignInUrl()` builds redirect URI from `window.location.origin/auth/callback` — works for both `localhost:5180` and `computer.thinkwork.ai`.
- `TenantContext` runs the `bootstrapUser` mutation when `custom:tenant_id` is null — same auto-bootstrap admin uses.

**Execution note:** Live OAuth verification depends on U10 landing the Cognito CallbackURLs. Local typecheck/build verification is independent.

**Patterns to follow:**
- `apps/admin/src/lib/auth.ts` (350 lines)
- `apps/admin/src/context/AuthContext.tsx`
- `apps/admin/src/context/TenantContext.tsx`
- `apps/admin/src/routes/auth/callback.tsx`

**Test scenarios:**
- Covers F1. Happy path (post-U10): visit `localhost:5180/sign-in`, click Google, complete OAuth, land on `_authed/...` with `useAuth().user` populated.
- Edge case: PreSignUp Google account-linking error on first sign-in — admin's callback already handles this; verify the copy preserves behavior.
- Error path: invalid `code` query param on `/auth/callback` — error surfaces to user (not silently swallowed).
- Integration: `useTenant()` resolves the caller's tenant via either `custom:tenant_id` claim or `bootstrapUser` mutation.

**Verification:**
- `apps/computer` typechecks; auth providers instantiate cleanly; `getCurrentSession()` boot path runs.
- Live OAuth round-trip succeeds against dev Cognito (verified in U14 smoke).

---

### U7. Build app shell: ComputerSidebar + TenantLayout + placeholder routes

**Goal:** Authenticated user lands in a shell with the brainstorm-defined nav (New Thread CTA + Computer / Automations / Inbox / Threads section); each placeholder route renders.

**Requirements:** R5, R7, R9, R10, R11, R18, R19

**Dependencies:** U5, U6.

**Files:**
- Create: `apps/computer/src/routes/_authed/_shell.tsx`
- Create: `apps/computer/src/components/ComputerSidebar.tsx`
- Create: `apps/computer/src/routes/_authed/_shell/computer.tsx` (placeholder)
- Create: `apps/computer/src/routes/_authed/_shell/automations.tsx` (placeholder)
- Create: `apps/computer/src/routes/_authed/_shell/inbox.tsx` (placeholder)
- Create: `apps/computer/src/routes/_authed/_shell/threads.$id.tsx` (placeholder thread detail)

**Approach:**
- `_shell.tsx` mirrors admin's `apps/admin/src/routes/_authed/_tenant.tsx` chrome (sidebar provider, top bar with theme toggle, sign-out menu) but drops admin-specific children (`<AppSyncSubscriptionProvider>`, admin breadcrumb, admin command palette content).
- `ComputerSidebar` consumes `Sidebar*` primitives from `@thinkwork/ui`. Top to bottom: New Thread CTA (button styled with primary color), three permanent links (Computer → Automations → Inbox, lucide icons matching admin's conventions), then a "Threads" section header with a placeholder list (real data lands in U9).
- "Computer" link routes to `/computer`, not `/computers` (R19).
- Each placeholder page is a minimal `<div>` with the page name and a "coming soon" affordance. No skeleton; no fake data.
- Sidebar collapse (Cmd/Ctrl+B), dark-mode toggle, sign-out match admin behavior automatically by reusing `@thinkwork/ui` primitives.
- Operator-only nav links (People, Billing, Compliance, etc.) are NOT rendered (R18).

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant.tsx` for the layout shell.
- `apps/admin/src/components/Sidebar.tsx` for the AppSidebar pattern (write a thinner version).

**Test scenarios:**
- Covers AE4. Happy path: signed-in user at `/computer` sees the shell + placeholder body; clicking Automations / Inbox routes there; clicking the Computer link returns to `/computer`.
- Covers AE6. Integration: only the New Thread CTA + Computer / Automations / Inbox + Threads section header are present; no operator nav items.
- Edge case: collapse the sidebar with Cmd+B; verify the icon-only state renders.
- Edge case: switch to light mode; verify text and surfaces re-render with the light token set.
- Error path: navigate to `/threads/$id` for a non-existent id — placeholder still renders (no 404 in Phase 1).

**Verification:**
- All four placeholder routes render.
- Sidebar nav is exactly: CTA, Computer, Automations, Inbox, Threads (section header + empty list until U9).
- Dark mode toggle, sign-out, sidebar collapse work.

---

### U8. New Thread → Blank Chat CTA flow

**Goal:** Clicking the CTA opens a thin dialog, calls `createThread` with the caller's `computerId`, and routes the user to the new thread's placeholder page.

**Requirements:** R5, R6

**Dependencies:** U6, U7.

**Files:**
- Create: `apps/computer/src/components/NewThreadDialog.tsx`
- Modify: `apps/computer/src/lib/graphql-queries.ts` (add `MyComputerQuery` and `CreateThreadMutation`)
- Modify: `apps/computer/src/components/ComputerSidebar.tsx` (wire CTA `onClick` to open the dialog)

**Approach:**
- `NewThreadDialog` is ~80 lines: a `Dialog` (from `@thinkwork/ui`) with a single `Input` for thread title (optional; defaults to "New thread"), Cancel + Create buttons.
- On submit: read computerId from the cached `MyComputerQuery` result, then call `createThread({ input: { tenantId, computerId, title, channel: CHAT } })`. The brainstorm's wording is "Blank Chat" — omit `firstMessage` so the thread is truly empty until the user types.
- On success: navigate to `/threads/${newThread.id}` and trigger a sidebar threads refetch.
- Loading + error states: inline error if `createThread` fails; keep the dialog open so the user can retry.

**Patterns to follow:**
- `apps/admin/src/lib/graphql-queries.ts:324` for `MyComputerQuery`.
- `apps/admin/src/components/threads/CreateThreadDialog.tsx` for dialog structure (do NOT copy the agent picker / status / due-date logic).

**Test scenarios:**
- Covers F2, AE2. Happy path: signed-in user with a Computer clicks New Thread, types a title, clicks Create; mutation fires with `{ tenantId, computerId, title, channel: CHAT }`; user lands on `/threads/${id}` placeholder.
- Edge case: empty title → submit with default "New thread".
- Error path: mutation fails (network or server) → error message renders in the dialog; user can retry.
- Integration: after create, the sidebar Threads section reflects the new thread (depends on U9's data refresh; verify via cache invalidation or refetch).

**Verification:**
- Mutation invokes with the caller's resolved computerId.
- New thread is visible in the database (verify via direct query during dev).
- User is routed to the new thread's placeholder.

---

### U9. Sidebar Threads list (Computer-scoped, real data)

**Goal:** The sidebar's Threads section renders the caller's Computer's threads (newest first, capped) using existing GraphQL surfaces. No schema changes.

**Requirements:** R8, R13

**Dependencies:** U6, U7.

**Files:**
- Modify: `apps/computer/src/lib/graphql-queries.ts` (add a `ComputerThreadsQuery` matching `apps/admin/src/lib/graphql-queries.ts:379`)
- Modify: `apps/computer/src/components/ComputerSidebar.tsx` (run `MyComputerQuery` then `ComputerThreadsQuery`; render results)

**Approach:**
- Compose the two queries: `myComputer { id }` then `threads(tenantId, computerId, limit: 50)`. Resolver already orders desc by `created_at`.
- Render a `SidebarMenu` of thread rows; each row links to `/threads/${id}`. Show thread title + relative timestamp; truncate title with CSS.
- Empty state: "No threads yet — click New Thread to start one."
- Loading state: skeleton rows.
- Error state: small "Failed to load threads" inline message.
- After `createThread` (U8), invalidate the cache (urql typename-based or manual `reexecuteQuery`).

**Patterns to follow:**
- `apps/admin/src/lib/graphql-queries.ts:379` (`ComputerThreadsQuery` shape — copy directly).

**Test scenarios:**
- Covers F3, AE2 (post-create reflection). Happy path: signed-in user with N threads on their Computer sees N rows, newest first, capped at 50.
- Edge case: 0 threads → empty-state copy renders.
- Edge case: 51+ threads → only 50 most recent render; an overflow affordance points at a future "all threads" page (R8 — overflow target stays a placeholder).
- Integration with U8: creating a new thread refreshes the sidebar list within a tick.

**Verification:**
- Sidebar Threads renders real data.
- Threads belonging to other Computers in the same tenant do NOT appear.

---

### U10. Terraform: `module "computer_site"` + cert SAN + Cognito CallbackURLs + greenfield wiring

**Goal:** A single `terraform apply` against dev produces an S3 bucket + CloudFront distribution + ACM SAN cert covering `computer.thinkwork.ai` + a Cloudflare CNAME + the `ThinkworkAdmin` Cognito client now accepting the new origins.

**Requirements:** R2, R3, R4, R12

**Dependencies:** None on TS units; depends on `@thinkwork/ui` only at build time, not deploy time.

**Files:**
- Modify: `terraform/modules/thinkwork/main.tf` (add `module "computer_site"` mirroring `module "admin_site"` at lines 542-550; extend the `concat()` for `admin_callback_urls` / `admin_logout_urls` at lines 87-96 to include computer distribution + computer domain origins, plus `http://localhost:5180` and `/auth/callback` for local dev)
- Modify: `terraform/modules/thinkwork/variables.tf` (add `computer_domain` and `computer_certificate_arn` mirroring `admin_domain` / `admin_certificate_arn` at lines 311-321)
- Modify: `terraform/modules/thinkwork/outputs.tf` (add `computer_distribution_id`, `computer_distribution_domain`, `computer_bucket_name`, `computer_url` mirroring the admin variants)
- Modify: `terraform/modules/app/www-dns/variables.tf` (add `include_computer` bool + `computer_cloudfront_domain_name` string)
- Modify: `terraform/modules/app/www-dns/main.tf` (add `computer.${var.www_domain}` to the `cert_sans` local at lines 43-48 when `include_computer = true`; add a `cloudflare_record.computer` CNAME mirroring `cloudflare_record.admin` at lines 238-248)
- Modify: `terraform/examples/greenfield/main.tf` (add `local.computer_domain = "computer.${var.www_domain}"` near lines 255-258; pass `computer_domain` and `computer_certificate_arn = module.www_dns[0].certificate_arn` into `module.thinkwork`; set `include_computer = true` and `computer_cloudfront_domain_name = module.thinkwork.computer_distribution_domain` on the `www_dns` module)

**Approach:**
- `module "computer_site"` is a copy of `module "admin_site"` with `site_name = "computer"` and `is_spa = true`. Bucket name defaults to `thinkwork-${stage}-computer`.
- The Cognito callback extension is critical: the same `aws_cognito_user_pool_client.admin` (the `ThinkworkAdmin` client) now accepts admin AND computer origins. Verify the resulting CallbackURLs list contains all four production-class origins (admin distribution, admin domain, computer distribution, computer domain — each with `/auth/callback`) plus `http://localhost:5174`, `http://localhost:5180`, and any worktree ports.
- One apply: ACM cert with the new SAN issues; Cloudflare validation records auto-create via the existing `for_each`; `aws_acm_certificate_validation.www` waits for ISSUED; CloudFront distribution binds the validated cert; CNAME points at the distribution domain.
- Cloudflare token requirement: `Zone.DNS:Edit` on `thinkwork.ai`. Confirm CI's `CLOUDFLARE_API_TOKEN` (rotated 2026-04-24) still has scope.

**Execution note:** This unit changes infra. Plan the apply during a low-traffic window. The cert re-issuance forces CloudFront to swap certs; brief (sub-minute) cert re-binding is expected. Save `terraform plan` output for review.

**Patterns to follow:**
- `terraform/modules/thinkwork/main.tf` lines 87-96, 542-570 for module instantiation + callback URL concat.
- `terraform/modules/app/www-dns/main.tf` lines 34-55, 238-248 for cert SAN gate + Cloudflare CNAME.
- `terraform/examples/greenfield/main.tf` lines 255-349 for local + module wiring.

**Test scenarios:**
- Covers AE1. Happy path: `terraform plan` shows new S3 bucket + CloudFront distribution + ACM SAN + 1 new Cloudflare validation record + 1 new computer.thinkwork.ai CNAME + Cognito callback URL diff. `terraform apply` succeeds; `aws cognito-idp describe-user-pool-client --user-pool-id <id> --client-id <admin_client_id>` shows the new CallbackURLs.
- Edge case: dev applies with `var.computer_domain = ""` (no custom domain) — works, computer is reachable only via the raw CloudFront URL.
- Edge case: applying without a fresh `CLOUDFLARE_API_TOKEN` — surfaces a clear CF 10000 error; rotate and retry.
- Error path: cert issuance times out (DNS propagation slow) — re-apply succeeds.

**Verification:**
- `https://${module.thinkwork.computer_distribution_domain}/` returns the (empty until U11+U14 deploys content) CloudFront default.
- ACM cert in us-east-1 lists `computer.thinkwork.ai` as a SAN, status ISSUED.
- Cloudflare zone shows the `computer.thinkwork.ai` CNAME (DNS-only, grey cloud).
- `aws cognito-idp describe-user-pool-client` includes all expected callback URLs.

---

### U11. `scripts/build-computer.sh` + CI deploy job + path filter + summary block

**Goal:** Pushing to main with changes under `apps/computer/**` runs the new `build-computer` CI job, which builds the SPA, syncs to S3, invalidates CloudFront, and reports status in the workflow summary.

**Requirements:** R1, R2

**Dependencies:** U10 (Terraform outputs the new bucket + distribution id).

**Files:**
- Create: `scripts/build-computer.sh` (mirror `scripts/build-admin.sh`)
- Modify: `.github/workflows/deploy.yml` (add `computer:` path filter at lines 66-67; add `build-computer` job mirroring `build-admin` at lines 941-980; add `build-computer` to the summary block at line 1097)

**Approach:**
- `build-computer.sh` reads Terraform outputs `api_endpoint`, `appsync_api_url`, `appsync_realtime_url`, `appsync_api_key`, `user_pool_id`, `admin_client_id` (reused as computer client id), `auth_domain`, `computer_bucket_name`, `computer_distribution_id`. Writes `apps/computer/.env.production` with the same `VITE_*` names admin uses (verbatim). Runs `pnpm --filter computer build`. `aws s3 sync apps/computer/dist/ s3://${COMPUTER_BUCKET}/ --delete`. CloudFront invalidation `--paths "/*"`.
- Critically: do NOT inject `VITE_API_AUTH_SECRET` (admin's build script forbids this; same rule for computer).
- CI job is a copy of `build-admin` with names swapped. Triggered on the same conditions (after `terraform-apply` succeeds). Path filter is set up but not consumed for gating today — set it up for future selective deploys.

**Patterns to follow:**
- `scripts/build-admin.sh` (80 lines, line-for-line template).
- `.github/workflows/deploy.yml` lines 66-67, 941-980, 1097.

**Test scenarios:**
- Happy path: a PR touching `apps/computer/**` lands on main; `build-computer` runs after `terraform-apply`; the workflow summary prints "build-computer: success".
- Edge case: a PR touches only `apps/admin/**` — `build-computer` still runs (path filter is informational today); verify it succeeds without doing useful work.
- Error path: `apps/computer/.env.production` write fails because a Terraform output is missing — clear error, job fails fast.
- Integration: post-job, `https://${computer_distribution_domain}/` returns the deployed SPA's `index.html` (verified in U14).

**Verification:**
- Manual run of `bash scripts/build-computer.sh dev` from a developer machine builds and deploys.
- Next push to main runs the new CI job and deploys.

---

### U12. CORS audit + allow-origin updates for the new SPA origin

**Goal:** Every REST handler `apps/computer` calls accepts `https://computer.thinkwork.ai` (plus `http://localhost:5180`) and routes OPTIONS through `corsPreflight()` before `authenticate()`.

**Requirements:** R12, R13

**Dependencies:** None on TS units; runs in parallel with U10/U11.

**Files:**
- Audit + modify (as needed): `packages/api/src/handlers/*.ts` for any handler `apps/computer` reaches via `apiFetch`. Initial reach: `/api/auth/me` (used by AuthContext); confirm during impl whether `/api/scheduled-jobs` or others are pulled in.
- Audit + modify: `packages/api/workspace-files.ts` (canonical handler with its own preflight handling).
- Modify: `packages/api/src/lib/response.ts` (or wherever `corsPreflight()` lives) — confirm allowed-origin logic includes the new origin. If origins are an explicit allowlist, add `https://computer.thinkwork.ai` and `http://localhost:5180`.

**Approach:**
- The institutional learning (`docs/solutions/integration-issues/lambda-options-preflight-must-bypass-auth-2026-04-21.md`) is direct. Audit each handler reachable from `apps/computer`'s `apiFetch`. For each, confirm the OPTIONS branch returns 2xx with the right CORS headers BEFORE the auth check runs.
- Confirm the GraphQL Yoga handler at `/graphql` accepts the new origin (Yoga handles its own preflight; verify the configured allow-origin list).
- Smoke during U14: from `localhost:5180` with the Vite dev server, attempt `apiFetch('/api/auth/me')` and verify CORS doesn't reject it.

**Patterns to follow:**
- `packages/api/src/lib/response.ts` `corsPreflight()` helper.

**Test scenarios:**
- Happy path: from a browser at `http://localhost:5180`, fetch `/api/auth/me` against the dev API gateway. Browser sends OPTIONS; API returns 2xx with `Access-Control-Allow-Origin: http://localhost:5180`. Subsequent GET succeeds.
- Edge case: invalid origin (e.g., `https://example.com`) is rejected.
- Error path: handler returns 500 — error response also includes the Allow-Origin header (don't drop CORS headers on error paths; common bug).

**Verification:**
- `apps/computer` apiFetch calls succeed in dev without CORS errors.
- A sample of REST handlers verified to handle OPTIONS without reaching the auth check.

---

### U13. Multi-user fixture test for Computer-scoped thread filtering

**Goal:** Prove that the `threads(tenantId, computerId)` query path used by `apps/computer`'s sidebar does NOT leak threads from another user's Computer in the same tenant.

**Requirements:** R8, R13, AE3

**Dependencies:** None on UI units; runs against the existing GraphQL surface.

**Files:**
- Create: `packages/api/test/integration/threads-computer-scope.test.ts` (or similar; check `packages/api/test/integration/` for existing fixture patterns)

**Approach:**
- Set up a synthetic two-user-one-tenant fixture: tenant T, users U_A and U_B, computers C_A (owned by U_A) and C_B (owned by U_B), threads T_A1 + T_A2 on C_A, thread T_B1 on C_B.
- Call `threads(tenantId: T, computerId: C_A)` as U_A and assert exactly {T_A1, T_A2}.
- Call `threads(tenantId: T, computerId: C_B)` as U_A and assert it returns an authorization error OR an empty list (whichever the resolver's policy is). If it silently filters down to user-A's data, that's a real bug — fix in this unit.
- Verify `myComputer` resolver as U_A returns C_A, not C_B.

**Execution note:** Implement test-first. Run the test against the existing resolver before changing anything; if it passes as-is, no resolver change is needed. If it fails, fix the resolver to add the per-user predicate.

**Patterns to follow:**
- Existing fixtures in `packages/api/test/integration/` (file paths discovered during impl).

**Test scenarios:**
- Covers AE3, R13. Happy path: U_A calling `threads(computerId: C_A)` returns U_A's threads only.
- Edge case: U_A calling `threads(computerId: C_B)` (another user's Computer in same tenant) — must not return T_B1. Either a 403/error or an empty result. Whichever the resolver does, make it explicit.
- Edge case: cross-tenant access — covered by the existing tenant gate; verify it still works after any changes.

**Verification:**
- Test passes against the existing resolver, OR the resolver is patched to enforce per-user isolation and the test then passes.

---

### U14. Dev smoke: deployed-URL acceptance for Phase 1

**Goal:** A scripted smoke against `https://${computer_distribution_domain}/` (or `https://computer.thinkwork.ai/` once DNS resolves) confirms HTTP 200 + the SPA's expected `<title>` + the OAuth redirect kicks off when an unauthenticated visitor hits the root. This is the Phase 1 acceptance gate.

**Requirements:** R2, R12

**Dependencies:** U10, U11.

**Files:**
- Create: `scripts/smoke-computer.sh` (or extend an existing smoke script under `scripts/`)
- Modify: `apps/computer/README.md` (one-paragraph "how to smoke" + the Phase 1 acceptance criteria)

**Approach:**
- The smoke is `curl`-based: GET `https://computer.thinkwork.ai/` → expect HTTP 200 + `Content-Type: text/html` + body contains the SPA's expected `<title>` (set during U5).
- Second check: GET `https://computer.thinkwork.ai/sign-in` → expect HTTP 200 + body indicates the OAuth button or auto-redirect is present.
- Optional third check: GET `https://computer.thinkwork.ai/auth/callback` → expect 200 (SPA fallback, not a 404) confirming `is_spa = true` is wired.
- Don't try to complete OAuth in the smoke script; the redirect-kicks-off check is enough.

**Patterns to follow:**
- Any existing `scripts/smoke-*.sh` patterns.

**Test scenarios:**
- Happy path: smoke passes after a successful Phase 1 deploy.
- Edge case: cert is `pending_validation` — smoke fails with a TLS error; clear signal.
- Edge case: CloudFront cache hasn't invalidated — smoke might pass with stale content; the `--paths "/*"` invalidation in `build-computer.sh` plus the `<title>` assertion catches it.

**Verification:**
- Smoke runs cleanly post-deploy.
- The README documents how to run it and what passing means.

---

## System-Wide Impact

- **Interaction graph:** the new `https://computer.thinkwork.ai` origin reaches the same GraphQL Lambda + REST API Gateway as admin. No new server entry points; Cognito + GraphQL + REST handlers are unchanged in surface (only allowed-origin lists grow).
- **Error propagation:** auth errors propagate through `apps/computer/src/lib/auth.ts` exactly as in admin. CORS errors surface in the browser DevTools and in apiFetch's error handling (existing pattern).
- **State lifecycle risks:** the `ThinkworkAdmin` Cognito client now serves two SPAs. Refresh-token mechanics are per-domain (localStorage-keyed by `CognitoIdentityServiceProvider.${CLIENT_ID}`); a user signed into admin and then opening computer.thinkwork.ai may need a fresh OAuth round-trip even though the same client technically allows reuse. U14 documents what's expected; F1 acceptance accepts "subject to refresh-token mechanics."
- **API surface parity:** no GraphQL or REST API changes. AppSync schema unchanged.
- **Integration coverage:** U13's multi-user fixture test prevents the cross-user-in-same-tenant leak class. U12's CORS sweep prevents the silent-preflight-failure class. U14's deployed-URL smoke prevents the green-CI-but-broken-deploy class.
- **Unchanged invariants:** `ThreadsPagedQuery` resolver remains tenant-only; admin's behavior is unchanged. `myComputer`, `threads(computerId:)`, `createThread(input.computerId:)`, `CreateThreadInput.firstMessage` all remain as-is. Admin's `CreateThreadDialog` is untouched.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Cert SAN re-issuance briefly fails CloudFront cert binding during U10 apply | Apply during low-traffic window; admin distribution still works through the brief cert swap; both distributions reference the same cert ARN, so the swap is atomic at the ACM level. |
| Cognito CallbackURL list grows unwieldy | Currently 8-12 entries (admin × 2 origins, computer × 2 origins, localhost dev × 2 ports, plus their `/auth/callback` siblings). Manageable. Document at the top of the concat in `terraform/modules/thinkwork/main.tf`. |
| Cross-domain SSO (admin ↔ computer) doesn't carry refresh tokens cleanly | Tokens are localStorage-keyed per-origin. The brainstorm explicitly accepts "subject to refresh-token mechanics"; U14 documents whether a second OAuth round-trip is required. If unacceptable, follow-up. |
| Phase 0 (admin migration) introduces a regression in admin's visual or behavioral surface | U4's verification step requires running admin in dev and exercising sidebar collapse + dark mode + command palette + dialogs before merge. |
| `@thinkwork/ui` peer-dep mismatch between admin and computer | Both apps use pnpm workspace pinning; declare exact peer deps in `packages/ui/package.json` and let consumers resolve. Smoke catches mismatches at build time. |
| CORS preflight regression on a handler `apps/computer` doesn't currently call but later starts calling | U12 audits handlers reachable in Phase 1; future calls to other handlers need a similar audit. Add a comment at the top of `apps/computer/src/lib/api-fetch.ts`. |
| Multi-user thread leak via `threads(computerId:)` if the resolver lacks per-user isolation | U13 is the explicit unit; if it discovers a leak, fix the resolver in that unit. |
| Cloudflare API token drift (per memory `project_ci_cloudflare_token_rotated`) | If U10 apply fails with CF error 10000, rotate the `CLOUDFLARE_API_TOKEN` secret and retry. |
| Tailwind v4 CSS-first config drifts between `@thinkwork/ui/theme.css` and admin's `apps/admin/src/index.css` post-extraction | U3 puts the canonical theme in the package; admin's `index.css` becomes a thin wrapper that imports the package theme + adds reactflow-only overrides. Document this at the top of admin's `index.css`. |

---

## Documentation / Operational Notes

- Update `apps/computer/README.md` with: stack, dev port (5180), how to run the smoke, env vars expected.
- Update `CLAUDE.md` (or `AGENTS.md`) to mention `apps/computer` alongside `apps/admin` and `apps/mobile` in the "Repository at a glance" section.
- Extend the rule in CLAUDE.md memory note `project_admin_worktree_cognito_callbacks` context: every concurrent vite port across admin OR computer must be in `ThinkworkAdmin` CallbackURLs.
- Document the Cognito CallbackURL list ordering in a comment in `terraform/modules/thinkwork/main.tf` near the concat at lines 87-96.
- After U4 lands, mention the new `@thinkwork/ui` package in `CLAUDE.md`'s packages list and explain its scope (visual primitives + theme; no domain components).

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-08-computer-thinkwork-ai-end-user-app-requirements.md](docs/brainstorms/2026-05-08-computer-thinkwork-ai-end-user-app-requirements.md)
- **Related brainstorms:** `docs/brainstorms/2026-05-06-thinkwork-computer-product-reframe-requirements.md`, `docs/brainstorms/2026-05-07-thinkwork-computer-on-strands-requirements.md`
- **Reference admin queries:** `apps/admin/src/lib/graphql-queries.ts:324` (`MyComputerQuery`), `apps/admin/src/lib/graphql-queries.ts:379` (`ComputerThreadsQuery`)
- **Reference Terraform pattern:** `terraform/modules/thinkwork/main.tf:87-96, 542-570`, `terraform/modules/app/www-dns/main.tf:34-55, 238-248`, `terraform/examples/greenfield/main.tf:255-349`
- **Reference build script:** `scripts/build-admin.sh`
- **Reference CI job:** `.github/workflows/deploy.yml` lines 66-67, 941-980, 1097
- **Institutional learnings cited:** `docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md`, `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md`, `docs/solutions/build-errors/worktree-stale-tsbuildinfo-drizzle-implicit-any-2026-04-24.md`, `docs/solutions/integration-issues/lambda-options-preflight-must-bypass-auth-2026-04-21.md`, `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`, `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md`, `docs/solutions/patterns/mcp-custom-domain-setup-2026-04-23.md`, `docs/solutions/workflow-issues/deploy-silent-arch-mismatch-took-a-week-to-surface-2026-04-24.md`
