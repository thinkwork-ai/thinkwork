---
title: "Computer applets reframe autopilot status"
type: status
status: active
date: 2026-05-09
plan: docs/plans/2026-05-09-001-feat-computer-applets-reframe-plan.md
---

# Computer applets reframe autopilot status

This file records implementation progress, PRs, CI failures, blockers, and
conservative decisions while executing the Computer applets reframe in
autopilot mode.

## 2026-05-09

- **Started U3:** Created isolated worktree
  `.Codex/worktrees/computer-applets-u3-api` on branch
  `codex/computer-applets-u3-api` from `origin/main` after U2 merged.
- **Progress:** Added the applet GraphQL contract, server-side S3 storage,
  metadata/access helpers, source validation, inert resolvers that expose the
  schema without wiring runtime behavior before U6, and regenerated GraphQL
  client types for CLI/admin/mobile.
- **Verification note:** `pnpm install --no-frozen-lockfile`, `pnpm install
  --frozen-lockfile`, applet-focused API tests, full API tests, codegen for
  `thinkwork-cli`, `@thinkwork/admin`, and `@thinkwork/mobile`, `git diff
  --check`, `pnpm lint`, `pnpm -r --if-present typecheck`, `pnpm -r
  --if-present test`, and `pnpm --filter @thinkwork/api build` all passed.
  `pnpm format:check` is still blocked by the existing missing `prettier`
  binary in the root workspace.
- **Current PR:** #1051 (`feat(computer): add inert applet API`).
- **CI:** PR #1051 checks passed: CLA, lint, test, typecheck, verify.
- **Started U2:** Created isolated worktree
  `.Codex/worktrees/computer-applets-u2-stdlib` on branch
  `codex/computer-applets-u2-stdlib` from `origin/main` after U1 merged.
- **Progress:** Added the initial `@thinkwork/computer-stdlib` package with
  generic primitives, formatters, the inert `useAppletAPI` hook, and package
  contract tests. No consumers are wired yet.
- **Current PR:** #1049 (`feat(computer): add applet stdlib package`).
- **CI:** PR #1049 checks passed: CLA, lint, test, typecheck, verify.
- **Verification note:** `pnpm install --no-frozen-lockfile` updated the
  lockfile for the new workspace package, and `pnpm install --frozen-lockfile`
  then passed. `pnpm --filter @thinkwork/computer-stdlib test`, `pnpm
  --filter @thinkwork/computer-stdlib build`, `pnpm -r --if-present
  typecheck`, `pnpm lint`, `pnpm -r --if-present test`, and `git diff --check`
  all passed locally.
- **Started U1:** Created isolated worktree
  `.Codex/worktrees/computer-applets-u1-contract` on branch
  `codex/computer-applets-u1-contract` from `origin/main`.
- **Decision:** Track both the applets reframe plan and its origin brainstorm
  in this branch because the referenced plan was present only as an untracked
  local document in the main checkout.
- **Decision:** The contract spec follows the implementation plan's S3 storage
  decision, not the origin brainstorm's earlier EFS framing.
- **Progress:** Added `docs/specs/computer-applet-contract-v1.md` and extended
  the plan 014 M1 contract-freeze gate with the applet-package shape.
- **Verification note:** `git diff --check` passed and a frontmatter sanity
  check passed for the new spec and status docs. `pnpm install
  --frozen-lockfile` succeeded, but `pnpm format:check` still cannot run
  because the root script references `prettier` and the repo does not expose a
  Prettier binary in `node_modules/.bin`.
- **Verification note:** `pnpm lint` passed locally.
- **Current PR:** #1047 (`docs(computer): lock applet contract`).
- **CI:** PR #1047 checks passed: CLA, lint, test, typecheck, verify.
- **Blockers:** None.
