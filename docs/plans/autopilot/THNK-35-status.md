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
  `da283bb52d4b5dda04bbbdabe67c623505233a4e` (U5 merge).
- Active branch: `codex/thnk-35-email-channel-u6`.

## Progress

| Unit                                                                     | Status              | Evidence                                                          |
| ------------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------- |
| U1 Email plugin package and catalog contract                             | Merged              | PR #2586; merge commit `c83013559163983d22b615e057d1e6b88d3bb2c7` |
| U2 Email channel data model, GraphQL, and ledger contract                | Merged              | PR #2589; merge commit `99f05c1e768bb85b863e911a20e152b7daa48990` |
| U3 Resend and SES provider adapter service                               | Merged              | PR #2591; merge commit `5839b9ccd420cc60d4e69c0c6874cedfe6ec969d` |
| U4 Readiness state machine and plugin settings surface                   | Merged              | PR #2595; merge commit `61599ac66fa03fbe4e855a0085688b81ee93458e` |
| U5 Outbound channel, first-send HITL, and ledger writes                  | Merged              | PR #2597; merge commit `da283bb52d4b5dda04bbbdabe67c623505233a4e` |
| U6 Inbound webhook normalization, authorization, rate limits, and wakeup | Implemented locally | Branch `codex/thnk-35-email-channel-u6`; focused checks passed    |
| U7 Routine, runtime, and cross-surface email parity                      | Pending             | Not started                                                       |
| U8 SES migration, observability, documentation, and deployed validation  | Pending             | Not started                                                       |

## Notes

- Discovery read `AGENTS.md`, THNK-35, Linear comments, linked Linear
  requirement/plan documents, repo requirements, repo plan, and `CONCEPTS.md`.
- No child issues were returned for THNK-35 during discovery.
- Production mutation and manual deployment commands are out of scope during
  implementation.

## Verification Log

- U6 focused checks:
  - `pnpm --filter @thinkwork/api test -- src/handlers/email-inbound.test.ts src/handlers/email-provider-webhook.test.ts src/lib/email-channel/inbound-routing.test.ts`
  - `pnpm --filter @thinkwork/web test -- src/components/settings/plugins/PluginDetail.test.tsx`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/web typecheck`
  - `bash scripts/build-lambdas.sh email-inbound`
  - `bash scripts/build-lambdas.sh email-provider-webhook`
  - Local dev server is running on `http://localhost:5174/` for user review.
  - Resend one-key setup was simplified so admins enter only the API key;
    ThinkWork derives the verified `thinkwork.ai` provider domain, uses tenant
    Space addresses under `*.thinkwork.ai`, creates the provider webhook
    server-side, stores the webhook signing secret server-side, and keeps
    stored credentials masked with a rotate-only input.
- U5 merge:
  - PR #2597 merged on 2026-06-17 at merge commit
    `da283bb52d4b5dda04bbbdabe67c623505233a4e`.
  - CI passed: `cla`, `lint`, `verify`, `typecheck`, `test`.
- U4 merge:
  - PR #2595 merged on 2026-06-17 at merge commit
    `61599ac66fa03fbe4e855a0085688b81ee93458e`.
  - CI passed after rebase: `cla`, `lint`, `verify`, `typecheck`, `test`.
  - User-requested Plugins page feedback was included before merge: catalog
    metadata moved to delayed refresh hover, list-page Install buttons removed
    in favor of status badges, Installed tab count removed, refresh spinner
    limited to explicit refresh, and metadata hover tightened with no caret.
- U5 focused checks:
  - `pnpm --filter @thinkwork/api test -- src/lib/email-channel/__tests__/first-send-approval.test.ts src/handlers/email-send.test.ts src/lib/email/thread-reply.test.ts`
  - `pnpm --filter @thinkwork/pi-extensions test -- test/capabilities.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/pi-extensions typecheck`
  - `pnpm lint`
- U4 focused checks:
  - `pnpm schema:build`
  - `pnpm --filter @thinkwork/web codegen`
  - `pnpm --filter @thinkwork/mobile codegen`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/web typecheck`
  - `pnpm --filter @thinkwork/web test -- src/components/settings/plugins/PluginDetail.test.tsx`
  - `pnpm lint`
  - `bash scripts/build-lambdas.sh email-readiness-probe`
- U3 merge:
  - PR #2591 merged on 2026-06-17 at merge commit
    `5839b9ccd420cc60d4e69c0c6874cedfe6ec969d`.
  - CI passed: `cla`, `lint`, `verify`, `typecheck`, `test`.
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
