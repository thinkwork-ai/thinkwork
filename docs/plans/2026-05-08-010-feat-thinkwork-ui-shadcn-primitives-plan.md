---
title: 'feat: move shadcn primitives into @thinkwork/ui'
type: feat
status: active
date: 2026-05-08
origin: docs/plans/2026-05-08-001-feat-computer-thinkwork-ai-end-user-app-plan.md
---

# feat: move shadcn primitives into @thinkwork/ui

## Summary

Phase 0 slice B (parent plan U2). Copy all 43 shadcn primitives from `apps/admin/src/components/ui/*.tsx` into `packages/ui/src/components/ui/`, plus `apps/admin/src/hooks/use-mobile.ts` → `packages/ui/src/hooks/use-mobile.ts`. Adapt internal `@/` imports to package-relative paths. Re-export from the package barrel using a root-barrel-only strategy. Admin keeps its existing copies — no migration in this PR (parent U4 handles that).

---

## Requirements

- R1. All 43 `*.tsx` files in `apps/admin/src/components/ui/` are duplicated under `packages/ui/src/components/ui/` with the same filenames.
- R2. `apps/admin/src/hooks/use-mobile.ts` is duplicated to `packages/ui/src/hooks/use-mobile.ts`.
- R3. Inside the moved files, `@/lib/utils` becomes `../../lib/utils.js`; `@/components/ui/<x>` becomes `./<x>.js`; `@/hooks/use-mobile` becomes `../../hooks/use-mobile.js`; `@/context/ThemeContext` (sonner.tsx only) becomes `../../context/ThemeContext.js`.
- R4. `packages/ui/src/index.ts` re-exports every moved primitive plus `useIsMobile` from the barrel. Root-barrel-only — no per-component subpaths added to the `exports` map.
- R5. `packages/ui/package.json` peer-deps reflect what the moved files actually import: `@radix-ui/*` packages, `class-variance-authority`, `cmdk`, `lucide-react`, `react-day-picker`, `date-fns`, `recharts`, `sonner`, `@tanstack/react-table`, `react-hook-form`, `@hookform/resolvers`, `zod`. Versions match admin's pins.
- R6. `apps/admin/src/components/ui/*.tsx` and `apps/admin/src/hooks/use-mobile.ts` are unchanged in this PR. Admin imports still resolve to admin's own `@/components/ui/*` paths and `@/hooks/use-mobile`. Admin builds + typechecks cleanly.
- R7. `pnpm --filter @thinkwork/ui typecheck` and `pnpm --filter @thinkwork/ui test` both pass. `apps/admin` typecheck still passes (regression check).
- R8. The 7 non-stock-shadcn files (`badge-selector`, `multi-select`, `copyable-row`, `input-group`, `data-table-filter-bar`, `combobox`, `spinner`) are individually audited for admin-domain coupling. If any imports admin-only types, GraphQL hooks, or app context, refactor at the seam OR keep that file in admin and document which.

---

## Scope Boundaries

- No changes to admin source files (R6).
- No deletion of admin's primitive copies (parent U4).
- No type-annotation improvements to `ThemeContext.tsx` (still verbatim with admin; deferred to U4).
- No `vitest.config.ts` setup yet — barrel smoke remains the same shape (no rendering tests in this slice).
- No new theme tokens beyond what's already in `packages/ui/src/theme.css`.
- No per-component subpath exports (root-barrel-only per #959 reviewer recommendation).
- No mobile or computer-app consumer wiring.

### Deferred to Follow-Up Work

- Migrate admin to consume `@thinkwork/ui` and delete admin's primitive copies (parent U4).
- Add `vitest.config.ts` with `environment: "jsdom"` once the first render-based test is needed.
- Re-evaluate per-component subpath exports if a real consumer needs tree-shaking beyond the bundler's named-export shaking.

---

## Context & Research

### Relevant Code and Patterns

- 43 primitive files at `apps/admin/src/components/ui/*.tsx` — verified by `ls apps/admin/src/components/ui/*.tsx | wc -l` = 43.
- `apps/admin/src/hooks/use-mobile.ts` — 19 lines, no app coupling. Sidebar.tsx imports it.
- `packages/ui/src/lib/utils.ts` already exists (from #959). `cn` is the only relocate target.
- `packages/ui/src/context/ThemeContext.tsx` already exists (from #959). Sonner.tsx will import from `../../context/ThemeContext.js`.
- Existing `@/` imports observed in primitives:
  - `@/lib/utils` (cn) — used by ~all 43 files.
  - `@/components/ui/<x>` — primitives importing each other (e.g., `data-table.tsx` imports `data-table-pagination.tsx`).
  - `@/hooks/use-mobile` — only in `sidebar.tsx`.
  - `@/context/ThemeContext` — only in `sonner.tsx`.
- Existing `apps/admin/package.json` deps that need to become `@thinkwork/ui` peer-deps: scan during impl for the actual versions, then mirror.

### Institutional Learnings

- `docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md` — the extraction is grounded; drift detection now runs on typed re-exports.
- `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md` — the audit-before-move approach (R8) directly mirrors the 5-step bridge-cost discipline.

---

## Key Technical Decisions

- **Root-barrel-only exports.** No per-component subpaths in `package.json#exports`. Decision recorded in #959's review (api-contract reviewer's AC-05).
- **Sonner.tsx is the one intentional divergence from "verbatim copy".** `import { useTheme } from "@/context/ThemeContext"` becomes `from "../../context/ThemeContext.js"`. Documented in this slice plan and the PR.
- **Sidebar.tsx is the second intentional divergence.** `import { useIsMobile } from "@/hooks/use-mobile"` becomes `from "../../hooks/use-mobile.js"`. Same shape, intra-package.
- **All other primitives stay byte-identical except for `@/lib/utils` → `../../lib/utils.js`** and `@/components/ui/<x>` → `./<x>.js` import-path rewrites.
- **Peer-deps declared, not bundled.** Mirrors admin's exact version pins so admin can swap to consuming `@thinkwork/ui` (parent U4) without version drift.

---

## Implementation Units

### U1. Copy primitives + hook + adapt import paths

**Goal:** All 43 primitives plus `use-mobile` exist under `packages/ui/src/` with adapted intra-package imports. Admin's copies untouched.

**Requirements:** R1, R2, R3, R6

**Dependencies:** None.

**Files:**
- Copy: `apps/admin/src/components/ui/*.tsx` (43 files) → `packages/ui/src/components/ui/*.tsx`
- Copy: `apps/admin/src/hooks/use-mobile.ts` → `packages/ui/src/hooks/use-mobile.ts`
- Modify (in moved files only): import paths.

**Approach:**
- `cp -R apps/admin/src/components/ui packages/ui/src/components/` then add `use-mobile.ts`.
- Rewrite imports in `packages/ui/src/components/ui/*.tsx`:
  - `from "@/lib/utils"` → `from "../../lib/utils.js"`
  - `from "@/components/ui/X"` → `from "./X.js"`
  - `from "@/hooks/use-mobile"` → `from "../../hooks/use-mobile.js"`
  - `from "@/context/ThemeContext"` → `from "../../context/ThemeContext.js"`
- Use a precise `from "@/` regex (not a string match) to avoid catching docstring or comment occurrences.
- Audit non-stock files (R8) by reading each and checking for admin-domain types/hooks. None expected; flag any that surface.

**Patterns to follow:**
- `packages/ui/src/lib/utils.ts` and `packages/ui/src/context/ThemeContext.tsx` (already in package from #959).

**Test scenarios:**
- Test expectation: smoke covered in U2. This unit's verification is typecheck-only.

**Verification:**
- `find packages/ui/src/components/ui -name "*.tsx" | wc -l` returns 43.
- `pnpm --filter @thinkwork/ui typecheck` passes (assuming peer-deps land in U2).
- No `@/` imports remain in `packages/ui/src/`.

---

### U2. Add peer-deps + dev-deps + barrel re-exports + smoke

**Goal:** Package's `package.json` declares the peer-deps the moved files actually import; `index.ts` re-exports every primitive; vitest smoke still passes.

**Requirements:** R4, R5, R7

**Dependencies:** U1.

**Files:**
- Modify: `packages/ui/package.json` (peer-deps + dev-deps for primitives' transitive needs)
- Modify: `packages/ui/src/index.ts` (extend barrel with primitive + useIsMobile re-exports)
- Modify: `packages/ui/test/exports.test.ts` (add a small assertion that representative primitives — Button, Dialog, Sidebar, useIsMobile — are exported from the barrel)

**Approach:**
- Scan `packages/ui/src/components/ui/*.tsx` and `packages/ui/src/hooks/use-mobile.ts` for non-relative imports. Bucket into peer-deps (consumer must provide; e.g., `radix-ui` packages, `react-hook-form`, `recharts`) vs dev-deps (only needed for the package's own typecheck, e.g., `@types/*`). Mirror admin's version pins for everything that crosses over.
- Update `package.json#dependencies`: keep `clsx`, `tailwind-merge`. Add nothing else as runtime deps.
- Update `package.json#peerDependencies`: react `>=19`, plus everything the components import. Drop `react-dom: ">=19"` per #959's deferred review finding (PR #3) — none of the moved files import from `react-dom` directly.
- Update `package.json#devDependencies`: install everything peer-dep-listed for the package's own typecheck pass.
- Run `pnpm install` to reconcile lockfile.
- `index.ts` adds re-exports. For shadcn-style components that export multiple symbols, use `export * from "./components/ui/<file>.js"` to surface them all without duplicating names. Override with named re-exports for any file that needs disambiguation.
- `exports.test.ts` adds: `import { Button, Dialog, Sidebar, useIsMobile } from "../src/index.js"; ... expect(typeof Button).toBe("function"); ...`.

**Patterns to follow:**
- `apps/admin/package.json` for version pins.
- `packages/pricing-config/package.json` for the workspace package shape (already followed in #959).

**Test scenarios:**
- Happy path: `pnpm --filter @thinkwork/ui test` passes the existing 3 smoke tests plus the new primitive-export checks.
- Edge case: `Button` from the barrel is the same module reference as `Button` from `./components/ui/button.js`.
- Verification: `pnpm --filter @thinkwork/admin typecheck` still passes (regression — admin imports are unchanged).

**Verification:**
- All package.json peer-deps reflect actual moved-file imports.
- Barrel surfaces every primitive named export.
- `pnpm --filter @thinkwork/ui typecheck` and `test` both green.
- `apps/admin` typecheck regression check passes.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Sed-replace of import paths catches non-import occurrences (e.g., docstring quotes, JSX text) | Use precise regex anchored on `from "@/`. Run typecheck after the sweep — any false rewrite surfaces as a missing-module error. |
| A non-stock file silently couples to admin (e.g., imports admin GraphQL types) | R8 audit + typecheck during U1 catch this. If any couples, refactor the seam OR explicitly leave the file out and document. |
| Peer-dep version drift between admin and `@thinkwork/ui` after this PR ships | Mirror admin's exact pins in U2. Document the convention so future bumps update both. |
| Admin runtime regression because admin's copies now have a workspace twin | Admin's imports point at `@/components/ui/*` (vite path alias) — they continue to resolve to admin's local files. The package's existence does not perturb admin's resolution. Verified by R6 + admin typecheck regression check. |

---

## Sources & References

- **Origin (parent plan):** [docs/plans/2026-05-08-001-feat-computer-thinkwork-ai-end-user-app-plan.md](docs/plans/2026-05-08-001-feat-computer-thinkwork-ai-end-user-app-plan.md)
- **Predecessor slice (U1 + U3 — already merged):** [docs/plans/2026-05-08-009-feat-thinkwork-ui-package-skeleton-plan.md](docs/plans/2026-05-08-009-feat-thinkwork-ui-package-skeleton-plan.md), PR #959
- Reference admin primitives: `apps/admin/src/components/ui/`, `apps/admin/src/hooks/use-mobile.ts`
- Reference admin package pins: `apps/admin/package.json`
