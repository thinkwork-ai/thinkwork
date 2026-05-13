---
title: "Vendor shadcn components from the registry JSON instead of running `shadcn add` in a pnpm workspace"
date: 2026-05-13
category: tooling-decisions
module: apps/admin
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - Adding a new shadcn component to a pnpm workspace package
  - Touching apps/admin or apps/computer shadcn primitives
  - Any time `npx shadcn@latest add` errors on `workspace:*`
tags:
  - shadcn
  - pnpm
  - radix-ui
  - vendor-pattern
  - workspace-protocol
  - cleanup-arc-2026-05-13
---

# Vendor shadcn components from the registry JSON instead of running `shadcn add`

## Context

The `npx shadcn@latest add <component>` CLI defaults to `npm install` for resolving peer dependencies (Radix primitives, etc.). In any pnpm workspace monorepo — anywhere `workspace:*` appears in a `package.json` `dependencies` block — `npm install` errors with `Unsupported URL Type "workspace:": workspace:*`. The CLI offers no `--package-manager pnpm` flag, and patching around it (temporarily removing `workspace:*` entries, running the CLI, then restoring them) is fragile.

We hit this twice this session adding shadcn primitives to `apps/admin` (PRs #1193, #1207) and previously on the `codex/computer-ai-elements-adoption` branch when installing AI Elements components (session history — needed `pnpm add motion nanoid shiki use-stick-to-bottom @radix-ui/react-use-controllable-state` directly because the CLI couldn't resolve the cross-package dependency graph through the workspace protocol).

## Guidance

Skip the CLI. Fetch the registry JSON directly and vendor the source:

```bash
# 1. Fetch the registry JSON
curl -fsSL "https://ui.shadcn.com/r/styles/new-york-v4/<component>.json" \
  -o /tmp/<component>.json

# 2. Extract source content to the target path
jq -r '.files[0].content' /tmp/<component>.json \
  > apps/admin/src/components/ui/<component>.tsx

# 3. Swap the Radix import pattern to the repo's meta-package convention.
#    Replace:  import * as <X>Primitive from "@radix-ui/react-<x>"
#    With:     import { <X> as <X>Primitive } from "radix-ui"
```

The `radix-ui` meta-package is already a dep (`apps/admin/package.json` declares `radix-ui ^1.4.3`) and re-exports all primitives. Follow the same convention used in `apps/admin/src/components/ui/dropdown-menu.tsx` and `popover.tsx`.

If a vendored shadcn component pulls in radix primitives that aren't yet in the lockfile, install them through pnpm directly:

```bash
pnpm --filter @thinkwork/admin add @radix-ui/react-use-controllable-state
```

Never invoke `shadcn add` to install peer deps in a pnpm workspace.

## Why This Matters

Mixing per-primitive imports (`@radix-ui/react-context-menu`, `@radix-ui/react-dropdown-menu`, ...) and meta-package imports (`radix-ui`) bloats the dep tree with duplicate Radix primitives — different versions of the same component code can ship in the same bundle. Bundle size and runtime behavior both suffer. Keeping the import style uniform across `components/ui/` keeps the dep graph clean and makes future Radix upgrades atomic.

Skipping the CLI also avoids a class of "works on my machine" failures where contributors with global npm see different results than contributors using only pnpm.

The auto-memory invariant [[feedback_pnpm_in_workspace]] (auto memory [claude]) makes this concrete: **always use pnpm, never npm, for any script/install in the thinkwork monorepo**. `npx` is fine for one-off CLI tools, but `shadcn add` is not a one-off — it tries to mutate the lockfile through npm.

## When to Apply

- Adding any new shadcn primitive to `apps/admin` (or any pnpm-workspace package in this repo)
- Same pattern likely applies to other pnpm-workspace monorepos (Turborepo, Nx with pnpm, etc.)
- Any time `npx shadcn@latest add` errors on `workspace:*`

## Examples

**This session — adding shadcn `context-menu` to apps/admin (PR #1207):**

```bash
curl -fsSL "https://ui.shadcn.com/r/styles/new-york-v4/context-menu.json" \
  -o /tmp/context-menu.json
jq -r '.files[0].content' /tmp/context-menu.json \
  > apps/admin/src/components/ui/context-menu.tsx
```

Then the import swap, matching the convention in `dropdown-menu.tsx`:

```ts
// Before (what shadcn ships)
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu"

// After (this repo's convention)
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
```

**Prior session corroboration — installing AI Elements deps on `codex/computer-ai-elements-adoption` (session history):**

The session bypassed `shadcn add` for cross-package dependency installation entirely:

```bash
pnpm add motion nanoid shiki use-stick-to-bottom @radix-ui/react-use-controllable-state
```

The shadcn `components.json` was still committed to configure the registry source, but actual package resolution was done through pnpm workspace protocol.

## Related

- (auto memory [claude]) [[feedback_pnpm_in_workspace]] — always pnpm, never npm in this workspace
- (other pnpm-workspace friction) [docs/solutions/build-errors/worktree-stale-tsbuildinfo-drizzle-implicit-any-2026-04-24.md](../build-errors/worktree-stale-tsbuildinfo-drizzle-implicit-any-2026-04-24.md)
- PR #1193, PR #1207 — shadcn primitive additions to apps/admin (this session)
- `codex/computer-ai-elements-adoption` — AI Elements adoption with direct pnpm add (session history)
