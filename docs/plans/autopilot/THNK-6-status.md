# THNK-6 Autopilot Status

Linear issue: THNK-6 - ThinkWork Brain
Target branch: `main`
Current implementation branch: `codex/thnk-6-u6-brain-operations-ui`
Plan: `docs/plans/2026-06-14-004-feat-company-brain-remaining-substrate-plan.md`
Status doc created: 2026-06-14

## Current Status

- THNK-15, the Company Brain premium plugin shell blocker, is Done.
- THNK-17, THNK-18, THNK-19, and THNK-20 are Done and merged to `main`.
- U4 migration orchestration is merged to `main`.
- Remaining parent-scope units are U6 Brain operations UI and U7 docs/smoke
  closure.
- This branch implements U6: Brain operations UI and action model.

## Discovery

- Read `AGENTS.md`.
- Read Compound Engineering `lfg` and `ce-plan` skill instructions, plus the
  Linear skill instructions.
- Fetched THNK-6 with relations, labels, attachments, documents, project,
  milestone, state history, customer needs, releases, and branch name.
- Fetched THNK-6 comments.
- Fetched THNK-15 blocker and confirmed it is Done.
- Fetched child issues THNK-17, THNK-18, THNK-19, and THNK-20 with relations;
  all are Done.
- Fetched comments for THNK-17, THNK-18, THNK-19, and THNK-20.
- Fetched THNK-6 Linear documents:
  - `Implementation plan: Company Brain physical substrate`
  - `Company Brain physical substrate requirements`
  - `OKF considered and deferred for Company Brain`
- Fetched THNK-6 attachment:
  - `2026-06-13-003-feat-company-brain-physical-substrate-plan.md.gz`
- Fetched project `Enterprise Agent OS` and milestone `Company Brain dogfood
proof`, which is 100% complete.
- Fetched ThinkWork team statuses; `In Progress`, `Verification`, and `Done`
  are available.
- Searched the repo for THNK-6, ThinkWork Brain, Company Brain, physical
  substrate, Brain substrate, dogfood proof, U5b, U6, U7,
  default-to-production, migration, and operations terms.
- Read completed child status ledgers:
  - `docs/plans/autopilot/THNK-17-status.md`
  - `docs/plans/autopilot/THNK-18-status.md`
  - `docs/plans/autopilot/THNK-19-status.md`
  - `docs/plans/autopilot/THNK-20-status.md`
- Read current code seams for substrate status, migration tables, Context
  Engine Brain provider, and Company Brain plugin detail.
- Checked referenced external docs for Cognee storage/provider posture and AWS
  Neptune/OpenSearch cost/storage facts.

## Important Context

- Company Brain is the customer-facing product. Cognee is internal substrate
  machinery and should not be surfaced as a product, plugin, license,
  install option, or storage choice.
- Hindsight remains episodic memory; Company Brain owns governed graph/vault
  substrate behavior and agent-facing Brain retrieval.
- S3 artifacts/manifests are canonical replay inputs. EFS and markdown vault
  projections are not canonical storage.
- Production graph/vector posture uses Neptune Analytics, not direct
  OpenSearch vector storage.
- First-party agents use Context Engine / `query_brain_context`; raw Cognee,
  Neptune, and S3 paths remain internal.

## Implementation Units

1. U4 - Default-to-production migration orchestration.
2. U5b - Migration-aware Brain reads.
3. U6 - Brain operations UI and action model.
4. U7 - Documentation and smoke closure.

## Progress Log

- 2026-06-14: Created long-lived autopilot goal for THNK-6.
- 2026-06-14: Completed Linear and repo context discovery for THNK-6 and the
  completed child issues.
- 2026-06-14: Confirmed the worktree is clean and based on `origin/main` at
  `62c76734a`.
- 2026-06-14: Created branch
  `codex/thnk-6-u4-migration-orchestration` from `origin/main`.
- 2026-06-14: Added remaining-scope plan and this THNK-6 status ledger.
- 2026-06-14: Moved THNK-6 from `Ready to Work` to `In Progress` before
  implementation began.
- 2026-06-14: Implemented U4 API/domain migration orchestration:
  `requestCompanyBrainProductionMigration` and `updateCompanyBrainMigration`
  GraphQL mutations, a tested Company Brain migration domain helper, resolver
  wiring, canonical GraphQL schema updates, and generated CLI/web/mobile
  GraphQL types.
- 2026-06-14: U4 codegen note: CLI and mobile generated types also picked up
  pre-existing schema drift for skill-eval/skill-update fields; web generated
  output only changed for the new Company Brain migration mutations.
- 2026-06-14: U4 local verification passed:
  `pnpm --filter @thinkwork/api exec vitest run src/lib/company-brain/migration.test.ts src/graphql/resolvers/brain/companyBrainMigration.mutation.test.ts src/graphql/resolvers/brain/companyBrainStatus.query.test.ts`,
  `pnpm --filter @thinkwork/api typecheck`,
  `pnpm --filter thinkwork-cli typecheck`, and
  `pnpm --filter @thinkwork/web typecheck`.
- 2026-06-14: U4 full API verification passed:
  `pnpm --filter @thinkwork/api test` (501 files passed, 4,789 tests passed,
  existing skipped live/integration cases remained skipped).
- 2026-06-14: Ran code review agents for U4. Actionable findings were:
  non-atomic migration/substrate/event writes, duplicate active migrations,
  impossible failed-to-rolled-back transition, unsafe phase skips, phase/status
  contradictions, and unredacted validation summaries. Fixed all of them with
  transaction-wrapped writes, substrate row locking, active-migration guard,
  strict adjacent transition validation, phase/status consistency validation,
  and validation-summary allowlisting on write and read.
- 2026-06-14: U4 post-review verification passed:
  `pnpm --filter @thinkwork/api exec vitest run src/lib/company-brain/migration.test.ts src/graphql/resolvers/brain/companyBrainMigration.mutation.test.ts src/graphql/resolvers/brain/companyBrainStatus.query.test.ts`,
  `pnpm --filter @thinkwork/api typecheck`, and
  `pnpm --filter @thinkwork/api test` (501 files passed, 4,794 tests passed,
  existing skipped live/integration cases remained skipped).
- 2026-06-14: `pnpm --filter @thinkwork/mobile typecheck` was attempted but
  `@thinkwork/mobile` has no `typecheck` script; mobile codegen completed.
- 2026-06-14: `pnpm install` completed dependency linking in this worktree.
  Optional `canvas` native build still failed on local Node 25 because
  `pkg-config`/pixman were unavailable; the API/client verification above did
  not require `canvas`.
- 2026-06-14: Opened U4 PR
  [#2461](https://github.com/thinkwork-ai/thinkwork/pull/2461) and moved
  THNK-6 to `Verification`.
- 2026-06-14: U4 PR
  [#2461](https://github.com/thinkwork-ai/thinkwork/pull/2461) passed CI
  (`cla`, `lint`, `verify`, `typecheck`, `test`) and was squash-merged to
  `main` at `619ff085`.
- 2026-06-14: Deleted the merged remote U4 branch and force-deleted the local
  U4 branch after squash merge.
- 2026-06-14: Created branch
  `codex/thnk-6-u5b-migration-aware-reads` from updated `origin/main` and
  moved THNK-6 back to `In Progress` for U5b.
- 2026-06-14: Implemented U5b migration-aware Brain reads in the Company Brain
  Context Engine provider: reads stay on the active backend, provider status
  and hit provenance now report redacted active/shadow/fallback/vault read
  posture, validation summaries are allowlisted, unsupported active backends
  are skipped, and tenant-visible read metadata no longer exposes internal
  graph/vector backend names.
- 2026-06-14: U5b verification passed:
  `pnpm --filter @thinkwork/api exec vitest run src/lib/context-engine/providers/company-brain.test.ts`,
  `pnpm --filter @thinkwork/api typecheck`, and
  `pnpm --filter @thinkwork/api test` (501 files passed, 4,797 tests passed,
  existing skipped live/integration cases remained skipped).
- 2026-06-14: Opened U5b PR
  [#2462](https://github.com/thinkwork-ai/thinkwork/pull/2462) for
  migration-aware Company Brain Context Engine reads.
- 2026-06-14: Attempted to move THNK-6 to `Verification` for U5b, but the
  Linear connector returned `401 token_revoked`.
- 2026-06-14: Dispatcher moved THNK-6 to `Verification` and added the PR
  [#2462](https://github.com/thinkwork-ai/thinkwork/pull/2462) tracking
  comment externally because the Linear connector token was revoked.
- 2026-06-14: U5b PR
  [#2462](https://github.com/thinkwork-ai/thinkwork/pull/2462) passed CI
  (`cla`, `lint`, `verify`, `test`, `typecheck`) and was squash-merged to
  `main` at `248f5816`.
- 2026-06-14: Deleted the merged remote U5b branch and force-deleted the local
  U5b branch after squash merge.
- 2026-06-14: Created branch
  `codex/thnk-6-u6-brain-operations-ui` from updated `origin/main`.
- 2026-06-14: Implemented U6 Brain operations UI:
  operator-guarded `/settings/brain-operations` route, Company Brain plugin
  deep link, tenant-safe status cards, backend/operator evidence redaction,
  migration action buttons backed by U4 mutations, failure/rollback controls,
  active-migration request guard, terminal rollback retry handling, and links
  to ontology, tools, billing, and plugin lifecycle surfaces.
- 2026-06-14: U6 generated web GraphQL documents/types and route tree after
  adding the Brain operations route and mutation documents.
- 2026-06-14: U6 local verification passed:
  `pnpm --filter @thinkwork/web codegen`,
  `pnpm --filter @thinkwork/web test -- src/components/settings/brain/BrainOperationsPage.test.tsx src/components/settings/plugins/PluginDetail.test.tsx`
  (20 tests passed), `pnpm --filter @thinkwork/web typecheck`,
  `pnpm --filter @thinkwork/web build`, and `git diff --check`.
- 2026-06-14: U6 broader web verification passed before the final retry-guard
  patch: `pnpm --filter @thinkwork/web test` (164 files passed, 1,219 tests
  passed). The affected Brain operations tests were rerun and passed after the
  retry-guard patch.
- 2026-06-14: U6 browser smoke attempted with the in-app Browser on local
  Vite. The browser tab crashed before rendering the route; the dev server
  stayed healthy and `curl -I http://localhost:5174/settings/brain-operations`
  returned HTTP 200 with the Vite shell. Visual inspection remains limited by
  the browser runtime crash.
- 2026-06-14: `pnpm exec prettier --write ...` was attempted for U6, but this
  workspace does not expose a `prettier` binary through pnpm exec in the
  current install (`Command "prettier" not found`). Formatting was kept
  consistent manually and `git diff --check` passed.
- 2026-06-14: Opened U6 PR
  [#2464](https://github.com/thinkwork-ai/thinkwork/pull/2464) for the Brain
  operations UI and action model.

## Linear State Changes

- 2026-06-14: Moved THNK-6 from `Ready to Work` to `In Progress`.
- 2026-06-14: Moved THNK-6 from `In Progress` to `Verification` after opening
  U4 PR [#2461](https://github.com/thinkwork-ai/thinkwork/pull/2461).
- 2026-06-14: Moved THNK-6 from `Verification` to `Done` after U4 merged,
  then back to `In Progress` to start U5b.
- 2026-06-14: U5b Linear move to `Verification` failed because the Linear
  OAuth token was revoked.
- 2026-06-14: Dispatcher externally moved THNK-6 to `Verification` and added a
  U5b PR [#2462](https://github.com/thinkwork-ai/thinkwork/pull/2462)
  tracking comment because the local Linear connector remained revoked.
- Desired next Linear update from dispatcher for U6: keep THNK-6 in
  `Verification` and add a comment: "Opened U6 PR for Brain operations UI:
  https://github.com/thinkwork-ai/thinkwork/pull/2464. Local verification: web
  codegen, focused Brain operations/plugin tests, web typecheck, web build,
  git diff check, full web test pre-final guard patch, focused rerun after
  guard patch. Browser visual smoke was attempted; in-app Browser tab crashed,
  while local Vite route returned HTTP 200."

## PR / CI Log

- 2026-06-14: Opened U4 PR
  [#2461](https://github.com/thinkwork-ai/thinkwork/pull/2461) for Company
  Brain default-to-production migration orchestration.
- 2026-06-14: U4 PR
  [#2461](https://github.com/thinkwork-ai/thinkwork/pull/2461) CI passed and
  the PR was squash-merged to `main`.
- 2026-06-14: Opened U5b PR
  [#2462](https://github.com/thinkwork-ai/thinkwork/pull/2462) for
  migration-aware Brain reads.
- 2026-06-14: U5b PR
  [#2462](https://github.com/thinkwork-ai/thinkwork/pull/2462) CI passed and
  the PR was squash-merged to `main`.
- 2026-06-14: Opened U6 PR
  [#2464](https://github.com/thinkwork-ai/thinkwork/pull/2464) for Brain
  operations UI and action model.

## Decisions

- Treat the completed dogfood milestone as inputs, not as work to repeat.
- Start with U4 because migration-aware reads and operations UI need durable
  migration state and transition semantics.
- Use one PR per remaining implementation unit unless a dependency is
  inseparable after implementation discovery.
- Keep progress tracking in this parent status ledger across all remaining
  units.

## Blockers

- Linear connector credentials remain unavailable locally with
  `401 token_revoked`; dispatcher is applying required Linear state/comment
  updates externally while GitHub/repo workflow continues.
- U6 visual browser smoke is limited by an in-app Browser tab crash. HTTP route
  smoke, production build, typecheck, and tests passed.
