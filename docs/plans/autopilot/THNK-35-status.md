---
date: 2026-06-17
linear: THNK-35
status: active
---

# THNK-35 Email Channel Plugin Autopilot Status

## Current State

- Linear issue: THNK-35, moved from Ready to Work to In Progress after
  discovery on 2026-06-17.
- Implementation base: `origin/main` at
  `99f05c1e768bb85b863e911a20e152b7daa48990` (U2 merge).
- Active branch: `codex/thnk-35-email-channel-u3`.

## Progress

| Unit                                                                     | Status              | Evidence                                                          |
| ------------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------- |
| U1 Email plugin package and catalog contract                             | Merged              | PR #2586; merge commit `c83013559163983d22b615e057d1e6b88d3bb2c7` |
| U2 Email channel data model, GraphQL, and ledger contract                | Merged              | PR #2589; merge commit `99f05c1e768bb85b863e911a20e152b7daa48990` |
| U3 Resend and SES provider adapter service                               | Implemented locally | Branch `codex/thnk-35-email-channel-u3`; focused checks passed    |
| U4 Readiness state machine and plugin settings surface                   | Pending             | Not started                                                       |
| U5 Outbound channel, first-send HITL, and ledger writes                  | Pending             | Not started                                                       |
| U6 Inbound webhook normalization, authorization, rate limits, and wakeup | Pending             | Not started                                                       |
| U7 Routine, runtime, and cross-surface email parity                      | Pending             | Not started                                                       |
| U8 SES migration, observability, documentation, and deployed validation  | Pending             | Not started                                                       |

## Notes

- Discovery read `AGENTS.md`, THNK-35, Linear comments, linked Linear
  requirement/plan documents, repo requirements, repo plan, and `CONCEPTS.md`.
- No child issues were returned for THNK-35 during discovery.
- Production mutation and manual deployment commands are out of scope during
  implementation.

## Verification Log

- U3 focused checks:
  - `pnpm --filter @thinkwork/api test -- src/lib/email-channel/__tests__/provider-contract.test.ts src/lib/email-channel/__tests__/resend-provider.test.ts src/lib/email-channel/__tests__/ses-provider.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
  - `node scripts/verify-plugin-source-boundary.mjs`
  - `bash scripts/build-lambdas.sh email-send`
  - `bash scripts/build-lambdas.sh email-inbound`
- U2 focused checks:
  - `pnpm schema:build`
  - `pnpm --filter @thinkwork/web codegen`
  - `pnpm --filter @thinkwork/mobile codegen`
  - `pnpm --dir apps/cli codegen`
  - `pnpm --filter @thinkwork/database-pg test -- migration-0170-email-channel-plugin.test.ts`
  - `pnpm --filter @thinkwork/api test -- src/__tests__/graphql-contract.test.ts`
  - `pnpm --filter @thinkwork/database-pg typecheck`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/web typecheck`
  - `pnpm --dir apps/cli typecheck`
  - `node scripts/verify-plugin-source-boundary.mjs`
  - Applied `packages/database-pg/drizzle/0170_email_channel_plugin.sql` to the
    dev database after CI drift precheck reported the scoped new manual
    migration missing.
  - `bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0170_email_channel_plugin.sql`
- U1 focused checks:
  - `pnpm --filter @thinkwork/plugin-email-channel test`
  - `pnpm --filter @thinkwork/plugin-email-channel typecheck`
  - `pnpm --filter @thinkwork/plugin-catalog test`
  - `pnpm --filter @thinkwork/plugin-catalog typecheck`
  - `pnpm --filter @thinkwork/plugin-catalog check:plugins`
  - `node scripts/verify-plugin-source-boundary.mjs`
  - `node --test scripts/__tests__/verify-plugin-source-boundary.test.mjs`

## Environment Notes

- `pnpm --dir apps/mobile exec tsc --noEmit` was run after mobile codegen and
  failed on existing mobile app type debt unrelated to the email channel
  contract, including missing `@react-navigation/native` declarations, stale
  layout prop names, and pre-existing generated-query mismatches in fleet,
  agents, inbox, settings, and extension tests.
- Root `pnpm exec prettier --write ...` is not runnable in this checkout
  because `prettier` is not declared in the workspace dependencies or lockfile;
  touched files were formatted with `pnpm dlx prettier@3.6.2 --write ...`.
- `pnpm install` completed and installed workspace binaries, but optional
  `canvas` native build output reported missing local `pkg-config`/pixman
  tooling on Node 25. The focused U1 checks above do not depend on `canvas`.
- `pnpm --filter @thinkwork/plugin-catalog build:catalog` was not used as a
  local acceptance gate because catalog signing requires
  `PLUGIN_CATALOG_SIGNING_KEY`; the registry freshness check and signed-catalog
  tests passed instead.
