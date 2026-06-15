---
issue: THNK-29
title: Manual Setup
updated: 2026-06-15
dispatcher: dispatcher:THNK-29:ReadyToWork:Codex
---

# THNK-29 Autopilot Status

## Current Pass

- Started from fresh `origin/main` at `e0c0d7fe8` in branch
  `codex/thnk-29-manual-user-api`.
- Confirmed this is the initial Ready-to-Work implementation pass after
  Planning, not a failed Verification/Review rebound.
- Moved Linear THNK-29 from `Ready to Work` to `In Progress` when code work
  began.

## Implementation Progress

- U1/U2 backend slice in progress:
  - Added `addManualUser` GraphQL contract with required per-submit
    `idempotencyKey`.
  - Added manual-user resolver that gates tenant admin first, rejects duplicate
    active members before idempotency replay, creates or repairs a Cognito user
    with `MessageAction=SUPPRESS`, sets a generated permanent hidden password,
    and links the tenant member only after Cognito finalization succeeds.
  - Added minimum API Lambda IAM action for `cognito-idp:AdminSetUserPassword`.
  - Added contract and resolver tests for no-invite creation, duplicate
    handling, role authorization, Cognito repair, and no DB insert on password
    finalization failure.
- U3 discovery:
  - `origin/main` already includes a dedicated `resendMemberInvite` contract,
    resolver, generated client types, and regression tests from
    `4dcfccf4f fix: add dedicated member invite resend flow`.
  - Remaining U3 work is to run/verify the targeted tests and patch only if a
    gap appears.

## Verification Notes

- No production mutation or manual deployment commands have been run.
- Deployed AWS/Cognito validation remains required after implementation PRs
  merge and deploy.
- Local checks for the U1/U2 backend slice:
  - `pnpm --filter @thinkwork/web codegen`
  - `pnpm --filter thinkwork-cli codegen`
  - `pnpm --filter @thinkwork/mobile codegen`
  - `pnpm schema:build`
  - `pnpm --filter @thinkwork/api exec vitest run src/__tests__/manual-user-setup.test.ts src/__tests__/graphql-contract.test.ts src/__tests__/resendMemberInvite.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/web typecheck`
  - `pnpm --filter thinkwork-cli typecheck`
  - `pnpm --filter thinkwork-cli lint` (repo-defined no-op)
  - Direct Prettier check for touched non-generated files because the root
    `format` script references `prettier` without declaring it as a root
    dependency in this worktree install.
  - `terraform fmt -check terraform/modules/app/lambda-api/iam-grouped.tf`
