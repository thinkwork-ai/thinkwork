# THNK-6 Autopilot Status

Linear issue: THNK-6 - ThinkWork Brain
Target branch: `main`
Current implementation branch: `codex/thnk-6-u4-migration-orchestration`
Plan: `docs/plans/2026-06-14-004-feat-company-brain-remaining-substrate-plan.md`
Status doc created: 2026-06-14

## Current Status

- THNK-15, the Company Brain premium plugin shell blocker, is Done.
- THNK-17, THNK-18, THNK-19, and THNK-20 are Done and merged to `main`.
- Remaining parent-scope units are U4 migration orchestration, U5b
  migration-aware reads, U6 Brain operations UI, and U7 docs/smoke closure.
- This branch starts U4: default-to-production migration orchestration.

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

## Linear State Changes

- 2026-06-14: Moved THNK-6 from `Ready to Work` to `In Progress`.
- 2026-06-14: Moved THNK-6 from `In Progress` to `Verification` after opening
  U4 PR [#2461](https://github.com/thinkwork-ai/thinkwork/pull/2461).

## PR / CI Log

- 2026-06-14: Opened U4 PR
  [#2461](https://github.com/thinkwork-ai/thinkwork/pull/2461) for Company
  Brain default-to-production migration orchestration.

## Decisions

- Treat the completed dogfood milestone as inputs, not as work to repeat.
- Start with U4 because migration-aware reads and operations UI need durable
  migration state and transition semantics.
- Use one PR per remaining implementation unit unless a dependency is
  inseparable after implementation discovery.
- Keep progress tracking in this parent status ledger across all remaining
  units.

## Blockers

- None currently.
