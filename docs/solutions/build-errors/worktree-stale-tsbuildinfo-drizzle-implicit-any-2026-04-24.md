---
title: Stale tsbuildinfo in fresh worktree breaks api typecheck via degraded Drizzle inference
date: 2026-04-24
category: build-errors
module: packages/api
problem_type: build_error
component: tooling
symptoms:
  - "`pnpm --filter @thinkwork/api typecheck` fails with TS7006 implicit-any on Drizzle callback params in a fresh worktree"
  - "`packages/api/src/lib/workspace-map-generator.ts` + `packages/api/src/lib/wiki/repository.ts` flag implicit-any on `.map((r) => ...)` callbacks; same files compile cleanly on main"
  - "drizzle-orm query result rows resolve to `any` instead of inferred row shape"
  - "Issue recurs on unrelated worktrees (hit twice this session — U3 schema PR and U10 plugin-upload PR)"
root_cause: config_error
resolution_type: environment_setup
severity: medium
tags:
  - worktree
  - tsbuildinfo
  - drizzle-orm
  - typescript
  - incremental-build
  - pnpm-workspace
  - type-inference
---

# Stale tsbuildinfo in fresh worktree breaks api typecheck via degraded Drizzle inference

## Problem

In a fresh git worktree under `.claude/worktrees/<name>/`, `pnpm --filter @thinkwork/api typecheck` fails with TS7006 implicit-any errors on Drizzle callback parameters, even though the same commit typechecks cleanly in the main checkout. The cause is a stale `tsconfig.tsbuildinfo` in `dist/` whose cached type identities don't line up with the worktree's freshly-installed `node_modules` — not anything in the source, lockfile, or package versions.

Costs ~10 min of debugging per incident. Hit twice in one session (U3, U10) before being recognized as a pattern.

## Symptoms

Typecheck fails immediately after `pnpm install` in the new worktree:

```
src/lib/workspace-map-generator.ts(295,50): error TS7006: Parameter 's' implicitly has an 'any' type.
src/lib/workspace-map-generator.ts(326,41): error TS7006: Parameter 'kb' implicitly has an 'any' type.
src/lib/wiki/repository.ts(1609,30): error TS7006: Parameter 'tx' implicitly has an 'any' type.
```

All of these are Drizzle query callbacks — `skillRows.map((s) => ...)` where `s` should infer to the row shape from the `select()` return type but instead comes back as `any`, so every downstream property access trips TS7006. Same commit, same `package.json`, same `pnpm-lock.yaml`, same `drizzle-orm@0.39.3` resolved via the same `.pnpm/` content-addressed path — only the main checkout passes.

## What Didn't Work

- **Fresh `pnpm install` (including `--frozen-lockfile`)** — reinstalls `node_modules` but never touches each package's `dist/tsconfig.tsbuildinfo`, so tsc still trusts the stale cache.
- **`pnpm --filter @thinkwork/database-pg build` alone** — with the stale buildinfo in place, `tsc --build` decides the package is already up to date and skips emit. The bad cached type identities survive.
- **Deleting only `packages/api`'s tsbuildinfo** — api consumes types from `packages/database-pg/dist`, which was itself built against a different `node_modules`. database-pg's stale buildinfo re-poisons api's inference the moment api is rechecked.
- **Assuming a package-version mismatch** — verified `drizzle-orm@0.39.3` resolves to the same `.pnpm/` hash path in both checkouts. Versions are identical; only the compile cache diverges.

## Solution

```bash
# 1. Clean every tsbuildinfo in the worktree (skip node_modules).
find . -name "tsconfig.tsbuildinfo" -not -path "*/node_modules/*" -delete

# 2. Rebuild the shared type producer first.
pnpm --filter @thinkwork/database-pg build

# 3. Downstream packages now typecheck clean.
pnpm --filter @thinkwork/api typecheck
```

Order matters:

- **Clean first, build second** — without step 1, step 2 is a no-op because `tsc --build` reads the cached buildinfo and exits early. The cache has to be gone before tsc will re-run inference.
- **database-pg before api** — api's type graph roots in `@thinkwork/database-pg`'s emitted `.d.ts` files. Rechecking api against a stale database-pg `dist/` propagates the degraded generics downstream regardless of api's own cache state. Rebuild the producer, then the consumer.

## Why This Works

`tsc --build` is an incremental compiler. On each run it writes `tsconfig.tsbuildinfo` next to `dist/` containing a serialized snapshot of the program: file hashes, resolved module paths, and — critically — internal **type identities** assigned to every symbol it saw last time. On the next build, tsc loads that snapshot and reuses those identities instead of recomputing them, which is what makes incremental compilation fast.

When a git worktree is created, `dist/` and its `tsconfig.tsbuildinfo` are brought along with the tracked source (or survive from a previous build inside the worktree directory). But the worktree's `pnpm install` creates its **own** `node_modules/.pnpm/` tree. Even when pnpm resolves the same version of a package to the same content-addressed path, the resolution metadata recorded in the buildinfo — absolute paths, symlink targets, module resolution cache keys — doesn't line up byte-for-byte with the new install. tsc sees the mismatch, can't reuse the cached type identities for types coming out of `drizzle-orm`, and falls back to recomputing them from scratch.

Drizzle is where this becomes visible because its select/query builder types are among the most generic-heavy in the TypeScript ecosystem: `PgSelectBase<...>` threads a dozen type parameters through conditional types, mapped types, and deep inference chains to produce the row shape. When any link in that chain fails to resolve cleanly against the rebuilt module graph, the whole inference collapses to `any` at the outermost boundary — which is exactly the `.map((s) => ...)` callback parameter. The callback's `s` gets `any`, TS7006 fires, and the error surfaces at the call site rather than at the underlying type-resolution failure.

A package like `zod` or `lodash` wouldn't degrade this way — its public types are mostly concrete, so a partial cache miss still produces usable inference. Drizzle's "infer the row shape from the columns you selected" contract has no fallback: either the generic machinery resolves end-to-end or every callback parameter is `any`.

This is **not** a pnpm bug, **not** a Drizzle bug, and **not** a TypeScript bug — it's the documented behavior of each, interacting badly when a `dist/` directory is reused across two separately-installed `node_modules` trees.

## Prevention

- **Fresh-worktree bootstrap checklist** — immediately after `pnpm install` in a new worktree, and before any `pnpm typecheck` / `pnpm build`:

  ```bash
  find . -name "tsconfig.tsbuildinfo" -not -path "*/node_modules/*" -delete
  pnpm --filter @thinkwork/database-pg build
  ```

- **Shell alias / package script** — worth adding a root-level `pnpm wt:bootstrap` (or `scripts/worktree-bootstrap.sh`) that runs install + clean + database-pg build as one step. Keeps the sequence correct and avoids the 10-minute rediscovery penalty.
- **Project instructions** — worth a short entry under "PR / branch workflow" in `CLAUDE.md`, adjacent to the existing worktree guidance. Something like: *"After creating a new worktree and running `pnpm install`, delete stale tsbuildinfo and rebuild `@thinkwork/database-pg` before running typecheck. TypeScript's incremental cache cross-contaminates between checkouts and produces spurious TS7006 errors in Drizzle callbacks."*
- **Optional belt-and-suspenders** — a `postinstall` script on `@thinkwork/database-pg` that deletes its own `dist/tsconfig.tsbuildinfo` would eliminate the class of problem entirely, at the cost of always re-emitting on install. Worth considering if this recurs a third time.

## Related Issues

- [`docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`](../workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md) — sibling "silent stale-state drift in developer workflows" pattern, though different domain (DB migrations vs. TypeScript compile cache).
- `CLAUDE.md` §PR / branch workflow — existing worktree guidance that should grow to include the fresh-worktree bootstrap step.
