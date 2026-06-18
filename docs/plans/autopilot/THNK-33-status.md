---
date: 2026-06-18
linear: THNK-33
status: active
---

# THNK-33 Twenty-Native Launch Proof Status

## Current State

- Linear issue: THNK-33 was reopened from `Done` to `Ready to Work` after the
  prior pass over-advanced the issue.
- Implementation base: fresh `origin/main`; active branch:
  `codex/thnk-33-twenty-native-proof`.
- Prior merged proof: PR #2612 delivered `server_contract_verified` only.
- Current proof target: smallest user-visible Twenty Opportunity launch/resume
  path for Customer Onboarding.
- Explicitly not claimed: rich Twenty embedded app packaging,
  Twenty logic-function installation, and native Twenty status writeback
  execution.

## Rebound Evidence

- PR #2612 only added signed server-side task-event ingress, Twenty linked-task
  provider support, idempotent append/wake behavior, diagnostics, fixtures, and
  the server-contract runbook.
- Linear comments on 2026-06-17 explicitly recorded that #2612 did not
  implement native Twenty embedded app installation, plugin manifest packaging,
  logic-function producer installation, or `native_producer_verified`.
- The 2026-06-18 dispatcher prompt corrected the issue back to implementation
  work because user-visible Twenty-native launch/status proof was missing.

## Scope Decision

Implement a constrained fallback that proves the approved user workflow without
claiming the blocked native producer path:

- Add durable `crm_work_links` for one active
  Twenty Opportunity + Customer Onboarding outcome.
- Add `startTwentyCustomerOnboarding`, a first-slice GraphQL mutation that
  resumes an existing link before requiring fresh CRM auth, and requires the
  installed `twenty` plugin plus current-user activation before creating new
  work.
- Add an authenticated web launch route:
  `/crm/twenty/opportunity/:objectId/customer_onboarding`.
- Record status/writeback state on the link as `blocked` with
  `NATIVE_TWENTY_WRITEBACK_NOT_VERIFIED` until deployed self-hosted Twenty app
  runtime/writeback can be proven.
- Document verification and blocker evidence separately from the already-landed
  server task-event proof.

## Progress

| Unit                                   | Status              | Evidence                                                                    |
| -------------------------------------- | ------------------- | --------------------------------------------------------------------------- |
| Discovery and rebound classification   | Complete            | Linear state history and comments confirm Done -> Ready rebound after #2612 |
| CRM work-link schema                   | Implemented locally | `crm_work_links` schema, migration, GraphQL contract, schema test           |
| Twenty Opportunity onboarding mutation | Implemented locally | Resume-first/create-with-activation mutation plus focused resolver tests    |
| Web launch route                       | Implemented locally | Authenticated CRM launch page and component tests                           |
| Native Twenty app/writeback blocker    | Documented locally  | Status link failure code and verification doc                               |
| PR                                     | Pending             | Not opened yet                                                              |
| CI/merge                               | Pending             | Not run remotely yet                                                        |

## Native Twenty Blocker

Current `origin/main` now contains `plugins/twenty`, but this pass still cannot
honestly claim native Twenty embedded app or logic-function installation proof:

- `plugins/twenty/src/manifest.ts` includes `mcp-server` and `infrastructure`
  components only; it does not package a Twenty app/front component/logic
  function producer.
- The manifest's comments keep UI/native app surfaces out of scope for the
  current package contract.
- The approved native operating-surface plan says rich embedded panels and
  native app extension packaging require deployed self-hosted capability
  verification before they can be treated as product proof.
- The current implementation therefore records CRM status handle state in
  ThinkWork and exposes the launch/resume route, but leaves actual Twenty-side
  writeback as blocked pending deployed runtime evidence.

## Verification Log

Local verification on 2026-06-18:

- `pnpm schema:build`
- `pnpm --filter @thinkwork/web codegen`
- `pnpm --filter @thinkwork/mobile codegen`
- `pnpm --filter thinkwork-cli codegen`
- `pnpm --filter @thinkwork/database-pg test -- __tests__/crm-work-links-schema.test.ts`
- `pnpm --filter @thinkwork/api test -- src/graphql/resolvers/crm/startCustomerOnboardingFromCrmRecord.mutation.test.ts`
- `pnpm --filter @thinkwork/web test -- src/components/crm/CrmCustomerOnboardingLaunch.test.tsx`
- `pnpm --filter @thinkwork/database-pg typecheck`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/web typecheck`
- `pnpm --filter thinkwork-cli typecheck`
- `pnpm lint`
- `pnpm --filter @thinkwork/web build`
- `git diff --check`
- Targeted Prettier check via
  `pnpm dlx prettier@3.8.2 --check --ignore-unknown <touched files>`

Notes:

- `pnpm --filter @thinkwork/api codegen` reports no matching package script on
  current `main`.
- `pnpm --filter @thinkwork/mobile typecheck` reports no matching package
  script on current `main`.
- Root `pnpm format:check` cannot run in this fresh worktree because `prettier`
  is not installed as a root dependency; the targeted `pnpm dlx prettier`
  check passed for touched files.

## Next Autopilot Steps

- Run format/codegen and focused verification.
- Commit and open the implementation PR.
- Wait for CI, fix real failures, and merge when allowed.
- Move THNK-33 to `Verification/Review` with Eric assigned because the issue
  has the `Human` label.
