---
date: 2026-06-26
linear_issue: THNK-77
status: u2-implementation
target_branch: main
---

# THNK-77 Autopilot Status

## Issue

- Linear: THNK-77, "Adopt json-render/shadcn as the Thread GenUI foundation"
- URL: https://linear.app/thinkworkai/issue/THNK-77/adopt-json-rendershadcn-as-the-thread-genui-foundation
- Parent status at discovery: Plan Review
- Child issues at discovery: none
- Primary plan: `docs/plans/2026-06-26-001-refactor-json-render-shadcn-cutover-plan.md`
- Origin requirements: `docs/brainstorms/2026-06-26-thnk-77-json-render-shadcn-foundation-requirements.md`

## Context Read

- `AGENTS.md`
- Autopilot attachment:
  `/Users/ericodom/.codex/attachments/4e75a4c8-d435-4f09-91d8-3fcadd478a2a/pasted-text.txt`
- Linear issue THNK-77, attached Linear plan document, comments, labels,
  project, assignee, and related issue search results.
- Repo plan and requirements docs listed above.
- Superseded THNK-34-era sources referenced by the plan:
  `docs/plans/2026-06-17-001-feat-thread-genui-json-render-plan.md`,
  `docs/specs/thread-genui-json-render-contract-v1.md`, and
  `docs/spikes/2026-06-17-json-render-adoption.md`.
- Related analytics contract:
  `docs/specs/analytics-display-contract-v1.md`.
- Repo references for `@thinkwork/genui`, `data-genui`, `ThreadGenUI`, and
  json-render/shadcn across web, mobile, API, runtime, and docs.
- Current package reality: `@json-render/core` and `@json-render/react` are
  present as web dev dependencies; `@json-render/shadcn` is not yet a workspace
  dependency; `@thinkwork/genui` is still imported by web, mobile, API, runtime,
  pi extensions, and tests.
- Upstream package metadata checked during planning: `@json-render/core`,
  `@json-render/react`, and `@json-render/shadcn` latest 0.19.0,
  Apache-2.0, React 19-compatible, with shadcn catalog export at
  `@json-render/shadcn/catalog`.

## Implementation Units

1. U1 dependencies + contract
   - Adopt upstream json-render/shadcn as production web dependencies.
   - Define the `data-json-render` carrier around upstream json-render spec.
   - Supersede conflicting `data-genui` docs and make smoke tests prove the
     shadcn package path.
2. U2 catalog + validation
   - Replace `@thinkwork/genui` catalog/schema helpers with app/package-owned
     json-render catalog and validation boundaries sourced from upstream shadcn
     APIs plus ThinkWork domain adapters/compositions.
3. U3 web renderer
   - Render `data-json-render` parts in Thread surfaces through
     `@json-render/react` and the combined primitive/domain registry.
4. U4 runtime/API carrier
   - Emit, stream, merge, and persist `data-json-render`; stop accepting old
     `data-genui` as current runtime output.
5. U5 durable actions + promotion
   - Rebase durable generated UI actions and promotion on `data-json-render`
     with source message, part, spec hash, tenant, idempotency, and rate-limit
     checks.
6. U6 mobile + deletion cleanup
   - Remove `@thinkwork/genui`, update mobile fallback for `data-json-render`,
     regenerate schema clients as needed, and mark superseded docs.

## Progress Log

### 2026-06-26

- Context discovery completed.
- Confirmed this local checkout is detached at `612d91f9c` with only the new
  THNK-77 brainstorm and plan docs untracked.
- Decision: use a fresh implementation worktree/branch from `origin/main` for
  U1, then copy the required plan/status docs into that branch so the PR carries
  the planning record.
- Linear state change: moved THNK-77 from Plan Review to In Progress when U1
  implementation started.
- U1 PR merged and local U1 worktree/branch cleaned up.
- U2 worktree created from updated `origin/main` at U1 merge commit.

## Unit Log

### U1 dependencies + contract

- Objective: install the upstream json-render packages for production web use,
  add `@json-render/shadcn`, define `data-json-render`, supersede rejected
  `data-genui` docs, and update smoke tests to prove the shadcn path.
- Branch: `codex/thnk-77-u1-json-render-carrier`
- Worktree:
  `/Users/ericodom/.codex/worktrees/thnk-77-u1-json-render-carrier`
- Linear state: In Progress
- PR: https://github.com/thinkwork-ai/thinkwork/pull/2972
- Commit: `a093ba284`
- Verification:
  - `pnpm install` completed after moving `@json-render/core` and
    `@json-render/react` to production web dependencies, adding
    `@json-render/shadcn`, and aligning web React/React DOM to a version that
    satisfies `@json-render/react@0.19.0`.
  - Remaining install peer warnings are outside `apps/web`: mobile/react-native
    SDK type/urql noise and lambda AWS SDK skew.
  - `pnpm --filter @thinkwork/web test -- src/components/workbench/genui/json-render-smoke.test.tsx`
    passed: 5 tests.
  - `pnpm --filter @thinkwork/web verify:json-render-smoke` passed with the
    real shadcn package path. Measured bundle delta:
    410,610 raw / 121,352 gzip. The verifier still scans for forbidden
    `fetch`, `eval`, `new Function`, `XMLHttpRequest`, dynamic import,
    `useUIStream`, and `useChatUI` patterns and executes the bundle under
    jsdom.
  - `pnpm --filter @thinkwork/web typecheck` passed.
  - `pnpm --filter @thinkwork/web build` passed with existing route,
    sourcemap, and large chunk warnings.
  - `pnpm dlx prettier@3.6.2 --check <touched U1 files>` passed.
  - Repo script `pnpm format:check` currently fails because the workspace does
    not install a `prettier` binary; this is unrelated to U1 file formatting.
- CI repair:
  - Initial PR CI passed `cla`, `lint`, `verify`, and `typecheck`; `test`
    failed because the web test runtime resolved both React 19.2.x and React
    19.1.x through web-adjacent workspace packages.
  - Aligned React/React DOM dev peer usage for `@thinkwork/ui`,
    `@thinkwork/graph`, `@thinkwork/computer-stdlib`, and
    `@thinkwork/workspace-editor` with the web/json-render React 19.2 line
    while leaving mobile and React Native packages on their current React
    19.1-compatible line.
  - Added local UI type bridges for `react-day-picker` `rootRef` and the
    lucide spinner icon where TypeScript still saw a stale React declaration
    identity from a third-party peer snapshot.
  - `pnpm --filter @thinkwork/web typecheck` passed after the repair.
  - `pnpm --filter @thinkwork/web test` passed after the repair: 202 files,
    1532 tests.
  - `pnpm --filter @thinkwork/web verify:json-render-smoke` passed after the
    repair with the same measured shadcn bundle delta:
    410,610 raw / 121,352 gzip.
- Final PR CI:
  - PR: https://github.com/thinkwork-ai/thinkwork/pull/2972
  - Merge commit: `99d60c224622bf20d0ae494e22f8952607b4c7b3`
  - `cla`, `lint`, `verify`, `typecheck`, and `test` passed before merge.

### U2 catalog + validation

- Objective: establish the two-layer json-render catalog and fail-closed
  validation boundary for web/API/runtime without extending the old
  `@thinkwork/genui` contract.
- Branch: `codex/thnk-77-u2-json-render-catalog`
- Worktree:
  `/Users/ericodom/.codex/worktrees/thnk-77-u2-json-render-catalog`
- Base: `origin/main` at `99d60c224622bf20d0ae494e22f8952607b4c7b3`
- Implemented:
  - Added web `json-render/` catalog modules that source primitive definitions
    from `@json-render/shadcn/catalog`, expose the shadcn registry path, and
    layer ThinkWork domain entries (`task.review`, `workflow.status`,
    `keyValue.list`, `form.action`, `analytics.display`) as json-render
    component definitions.
  - Added web fixtures and validation for `data-json-render` parts, nested
    upstream shadcn specs, ThinkWork domain entries, analytics adapter boundary,
    durable action descriptors, spec hashes, and legacy `data-genui` rejection.
  - Added runtime/API json-render carrier helpers for hash, validation,
    normalization, diagnostic fallback data, live activity event envelopes, and
    final-part merge behavior.
- Verification so far:
  - `pnpm --filter @thinkwork/web test -- src/components/workbench/json-render/catalog.test.ts src/components/workbench/json-render/validation.test.ts`
    passed: 10 tests.
  - `pnpm --filter @thinkwork/pi-runtime-core test -- test/json-render-runtime.test.ts`
    passed: 4 tests.
  - `pnpm --filter @thinkwork/api test -- src/lib/thread-json-render/validation.test.ts`
    passed: 2 tests.
  - `pnpm --filter @thinkwork/web typecheck` passed.
  - `pnpm --filter @thinkwork/pi-runtime-core typecheck` passed.
  - `pnpm --filter @thinkwork/api typecheck` passed.
  - `pnpm --filter @thinkwork/web verify:json-render-smoke` passed with the
    same measured shadcn bundle delta: 410,610 raw / 121,352 gzip.
  - `pnpm dlx prettier@3.6.2 --check --no-semi --trailing-comma all <touched U2 files>`
    passed.
  - `git diff --check` passed.
