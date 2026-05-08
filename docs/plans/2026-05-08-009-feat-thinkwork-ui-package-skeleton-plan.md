---
title: 'feat: @thinkwork/ui package skeleton'
type: feat
status: active
date: 2026-05-08
origin: docs/plans/2026-05-08-001-feat-computer-thinkwork-ai-end-user-app-plan.md
---

# feat: @thinkwork/ui package skeleton

## Summary

Carve the lowest-risk slice out of the parent plan's Phase 0: create the `@thinkwork/ui` package skeleton, move the `cn` util + `ThemeContext`/`useTheme` in, and extract `theme.css` from `apps/admin/src/index.css`. Admin keeps its own copies of these — no admin imports change, no admin files delete. This unblocks a future admin-migration PR (parent U2 + U4) without touching any consumer in this PR.

---

## Requirements

- R1. New workspace package `@thinkwork/ui` exists at `packages/ui/` with TS-source layout (`"main": "./src/index.ts"`, no `composite:true`, no `dist/`).
- R2. Package exports `ThemeProvider`, `useTheme`, and `cn` from its barrel.
- R3. Package ships `theme.css` (the Tailwind imports, `@theme inline` block, `:root` / `.dark` token tables, base layer, scrollbars) consumers can `@import "@thinkwork/ui/theme.css"`.
- R4. `apps/admin` is unchanged in this PR — no imports updated, no files deleted, no behavioral diff.
- R5. `pnpm install` resolves the new workspace dependency. `pnpm --filter @thinkwork/ui typecheck` and `pnpm --filter @thinkwork/ui test` pass.

---

## Scope Boundaries

- No move of shadcn primitives (parent U2 — separate PR).
- No admin migration / import updates (parent U4 — separate PR).
- No `sonner.tsx` adaptation (depends on parent U2; out of slice).
- No mobile or computer-app consumer wiring.
- No Storybook, visual regression, or richer drift-detection tooling.
- No new peer-deps beyond React (radix / cmdk / react-hook-form etc. arrive in parent U2 with their components).

### Deferred to Follow-Up Work

- Move shadcn primitives + `useIsMobile` hook (parent U2).
- Migrate `apps/admin` to consume `@thinkwork/ui` and delete duplicates (parent U4).

---

## Context & Research

### Relevant Code and Patterns

- `packages/pricing-config/package.json` — TS-source workspace package layout (verbatim template).
- `packages/pricing-config/tsconfig.json` — extends `tsconfig.base.json`, no `composite:true`.
- `apps/admin/src/lib/utils.ts:1-6` — canonical `cn` helper.
- `apps/admin/src/context/ThemeContext.tsx` — full file, copies into the package; admin's copy stays in place this PR.
- `apps/admin/src/index.css:1-208` — source for `theme.css`. Skip line 5 (`@xyflow/react/dist/style.css`) and lines 209-296 (`routine-flow-canvas`, `dashboard-activity` animations) — admin-specific.

### Institutional Learnings

- `docs/solutions/build-errors/worktree-stale-tsbuildinfo-drizzle-implicit-any-2026-04-24.md` — skip `composite:true` to avoid the cached-tsbuildinfo footgun.

---

## Key Technical Decisions

- **Admin keeps its existing files.** Slice ships duplicate code temporarily; the migration that removes the duplicates is a separate PR.
- **Single barrel + `./theme.css` + `./lib/utils` exports.** Fine-grained subpaths can land later if a consumer needs them.
- **Peer-dep React only.** Other peer deps (radix, cmdk, etc.) arrive when their consuming components do (parent U2).

---

## Implementation Units

### U1. Create `packages/ui/` workspace package skeleton

**Goal:** Workspace recognizes `@thinkwork/ui`; `pnpm install` succeeds; an empty barrel typechecks.

**Requirements:** R1, R5

**Dependencies:** None.

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/README.md`
- Create: `packages/ui/src/index.ts` (initially exports only `cn`)
- Create: `packages/ui/src/lib/utils.ts` (`cn` helper)

**Approach:**
- `package.json`: `"name": "@thinkwork/ui"`, `"private": true`, `"type": "module"`, `"main": "./src/index.ts"`, `"exports": { ".": "./src/index.ts", "./theme.css": "./src/theme.css", "./lib/utils": "./src/lib/utils.ts" }`. Scripts: `typecheck: "tsc --noEmit"`, `test: "vitest run"`. Dependencies: `clsx`, `tailwind-merge`. peerDependencies: `react: ">=19"`, `react-dom: ">=19"`. devDependencies: `@types/react`, `@types/react-dom`, `@testing-library/react`, `jsdom`, `typescript`, `vitest`.
- `tsconfig.json`: extends `../../tsconfig.base.json`, `"jsx": "react-jsx"`, `"noEmit": true`, `"include": ["src", "test"]`.
- `README.md`: one paragraph stating scope.
- `lib/utils.ts`: `cn` helper copied verbatim from `apps/admin/src/lib/utils.ts:1-6`.

**Patterns to follow:**
- `packages/pricing-config/package.json` shape.
- `apps/admin/tsconfig.json` for `"jsx": "react-jsx"` setting.

**Test scenarios:**
- Test expectation: smoke test in U2 verifies barrel exports. No tests in this unit.

**Verification:**
- `pnpm install` succeeds at workspace root.
- `pnpm --filter @thinkwork/ui typecheck` passes.

---

### U2. Add ThemeContext, theme.css, and barrel re-exports

**Goal:** `@thinkwork/ui` exports `ThemeProvider` and `useTheme`; package ships `theme.css` consumers can `@import`.

**Requirements:** R2, R3, R5

**Dependencies:** U1.

**Files:**
- Create: `packages/ui/src/context/ThemeContext.tsx` (verbatim copy of `apps/admin/src/context/ThemeContext.tsx`)
- Create: `packages/ui/src/theme.css`
- Modify: `packages/ui/src/index.ts` (add `ThemeProvider`, `useTheme` exports)
- Create: `packages/ui/test/exports.test.ts` (smoke that the barrel surfaces the documented exports)

**Approach:**
- `theme.css` contains, in order: `@import "tailwindcss"`, `@import "tw-animate-css"`, `@import "shadcn/tailwind.css"`, `@import "@fontsource-variable/geist"`, `@plugin "@tailwindcss/typography"`, the `@custom-variant dark (&:is(.dark *))` directive, the `@theme inline { ... }` block, `:root { ... }` token table, `.dark { ... }` token table, `@layer base { ... }`, `@media (pointer: coarse) { ... }`, `.dark { color-scheme: dark; }`, dark scrollbars, `.scrollbar-auto-hide` utility, and the `[data-slot="dialog-content"]` transition. Skip `@xyflow/react` import and the `routine-flow-canvas` + `dashboard-activity` blocks (admin-specific; stay in `apps/admin/src/index.css`).
- `ThemeContext.tsx` is a verbatim copy. `apps/admin/src/context/ThemeContext.tsx` is unchanged in this PR.
- `index.ts`: `export { ThemeProvider, useTheme } from "./context/ThemeContext.js";` plus existing `export { cn } from "./lib/utils.js";`.
- `exports.test.ts`: import `ThemeProvider`, `useTheme`, `cn` from the package's barrel and assert they are defined; assert `cn("a", "b") === "a b"` and `cn("a", false, "b") === "a b"`.

**Patterns to follow:**
- `apps/admin/src/index.css` lines 1-208 for `theme.css` content layout.
- `apps/admin/src/context/ThemeContext.tsx` copied verbatim.

**Test scenarios:**
- Happy path: `pnpm --filter @thinkwork/ui test` passes the exports smoke.
- Edge case: `cn` collapses falsy values (`cn("a", false, "b") === "a b"`).
- Test expectation for theme.css: none — it's a CSS asset, not testable in vitest. Verification is consumer-side once parent U4 ships.

**Verification:**
- `pnpm --filter @thinkwork/ui typecheck` and `test` both pass.
- `apps/admin` still imports from `@/context/ThemeContext` and `@/lib/utils` — unchanged.
- Diff vs `main` shows ONLY new files under `packages/ui/` plus this plan doc — no admin file changes.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Code duplication between admin and `@thinkwork/ui` until parent U4 ships | Accepted; the migration PR in parent U4 deletes admin's copies. Documented in Scope Boundaries. |
| `theme.css` drifts from `apps/admin/src/index.css` between this PR and parent U4 | Limit Phase-0 work to a single committer's window; parent U4 verifies admin still renders identically before merge. |
| Vitest config interactions with workspace root | The package's `vitest.config.ts` (or absence + reliance on `vitest run` defaults) is verified by running `pnpm --filter @thinkwork/ui test` locally before commit. |

---

## Sources & References

- **Origin (parent plan):** [docs/plans/2026-05-08-001-feat-computer-thinkwork-ai-end-user-app-plan.md](docs/plans/2026-05-08-001-feat-computer-thinkwork-ai-end-user-app-plan.md)
- Reference package: `packages/pricing-config/`
- Source files copied from admin: `apps/admin/src/lib/utils.ts`, `apps/admin/src/context/ThemeContext.tsx`, `apps/admin/src/index.css`
