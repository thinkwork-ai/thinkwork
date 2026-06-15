---
issue: THNK-29
title: Manual Setup
updated: 2026-06-15
dispatcher: dispatcher:THNK-29:InProgress:Codex
---

# THNK-29 Autopilot Status

## Verification Rebound Fix Pass

- Started from fresh `origin/main` at
  `edc12b6bb22a2a6652a12b6ce88efce7ca8b6ea7` in branch
  `codex/thnk-29-deploy-lambda-recovery`.
- Confirmed the sanctioned `dev` GraphQL Lambda is still stale:
  `thinkwork-dev-api-graphql-http` reports `LastModified=2026-06-15T14:20:24Z`,
  release `0.1.0-canary.189`, and manifest SHA
  `5933a29e35f80de68a1c1447790f4d2231153f5442e7f695ce53b6294d465ea4`.
- Confirmed the implementation deploy for `8cfac030a2c1361a3558245cb00e4f5db8f86496`
  failed in Terraform Apply due to DynamoDB Terraform state-lock contention.
- Confirmed later main Deploy runs for `10fc66cdb148`, `965f976a98b4`, and
  `edc12b6bb22a` completed with Terraform Apply skipped because their changed
  files were docs/status-only, so the Lambda never picked up the already-built
  THNK-29 GraphQL artifacts.
- Fix pass scope:
  - Make source Deploy runs execute Terraform Apply after Lambda zips build, even
    on docs/status-only pushes, so a later merge can recover a stale Lambda after
    a transient lock-failed deploy.
  - Add `-lock-timeout=10m` to Terraform Apply so lock contention waits instead
    of failing immediately.
  - Skip writing a successful deployment status pointer unless Terraform Apply
    actually succeeded, avoiding false success evidence when apply is skipped or
    failed.
- No manual deployment commands, production mutation commands, or live
  THNK-29 side-effect probes were run during this rebound fix pass.

## Current Pass

- Started from fresh `origin/main` at `e0c0d7fe8` in branch
  `codex/thnk-29-manual-user-api`.
- Confirmed this is the initial Ready-to-Work implementation pass after
  Planning, not a failed Verification/Review rebound.
- Moved Linear THNK-29 from `Ready to Work` to `In Progress` when code work
  began.

## Implementation Progress

- U1/U2 backend slice merged:
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
  - PR #2511 merged into `main` as
    `8cfac030a2c1361a3558245cb00e4f5db8f86496`.
- U3 discovery:
  - `origin/main` already includes a dedicated `resendMemberInvite` contract,
    resolver, generated client types, and regression tests from
    `4dcfccf4f fix: add dedicated member invite resend flow`.
  - U3 targeted tests passed during PR #2511 verification.
- U4 Settings Users UI slice merged:
  - Branch: `codex/thnk-29-settings-users-ui` from fresh `origin/main` at
    `8cfac030a2c1361a3558245cb00e4f5db8f86496`.
  - Split the Users action area into distinct Add user and Send invite buttons.
  - Added separate no-email manual-add and email-delivery invite dialog copy.
  - Wired Add user to `SettingsAddManualUserMutation` and Send invite to
    `SettingsInviteMemberMutation`, with fresh per-submit operation attempt IDs.
  - Added focused Settings Users component tests for action split, search,
    manual add semantics, invite semantics, duplicate errors, and owner role
    filtering.
  - Browser verification started the real web app at `127.0.0.1:5180`; direct
    navigation to `/settings/users` redirected to sign-in, so authenticated
    Users-surface screenshot verification remains blocked until a local browser
    session has valid Cognito tokens.
  - PR #2513 merged into `main` as
    `c65071265aa674d374d904b139a4bcd5394968ca`.
- U5 login reset UI slice merged:
  - Branch: `codex/thnk-29-login-password-reset` from fresh `origin/main` at
    `c65071265aa674d374d904b139a4bcd5394968ca`.
  - Added a Reset password path inside the web email/password sign-in form when
    password sign-in is configured.
  - Reset request calls Cognito `forgotPassword` with neutral account-existence
    copy for unknown or ineligible users while surfacing configuration,
    delivery, and rate-limit failures.
  - Reset confirmation calls Cognito `confirmForgotPassword`, validates matching
    passwords locally, maps invalid/expired code and password-policy failures,
    and returns to sign-in with success guidance.
  - Expired temporary-password sign-in copy now directs users to Reset password
    instead of asking an operator to handle credentials.
  - PR #2514 merged into `main` as
    `efa454edaf239d99d4352ba8aa24ce5dcc69657e`.
- U6 docs, rollout, and verification slice merged:
  - Branch: `codex/thnk-29-docs-verification` from fresh `origin/main` at
    `efa454edaf239d99d4352ba8aa24ce5dcc69657e`.
  - Updated Admin Humans documentation to describe Add user, Send invite,
    Resend invite, and user-driven Reset password semantics.
  - Updated Admin Authentication & Tenancy documentation with login reset
    behavior and account-enumeration/error-copy expectations.
  - Added `docs/verification/manual-user-setup-e2e.md` with deployed-stage
    verification checklist, Cognito/SES prerequisites, evidence slots, and
    redaction rules.
  - Audited `apps/cli/src/commands/user.ts` and
    `packages/api/src/handlers/tenants.ts`; CLI invite/reset-password and
    legacy REST invite remain operator/CLI surfaces, while THNK-29 no-email
    manual setup is the web GraphQL Settings surface.
  - PR #2516 merged into `main` as
    `10fc66cdb14877492bd9cd453d94896ad2eba988`.
- Final autopilot status artifact:
  - Branch: `codex/thnk-29-final-status` from fresh `origin/main` at
    `10fc66cdb14877492bd9cd453d94896ad2eba988`.
  - All planned implementation units are merged. THNK-29 is ready for deployed
    Verification using `docs/verification/manual-user-setup-e2e.md`.

## Verification Notes

- No production mutation or manual deployment commands have been run.
- Deployed AWS/Cognito validation remains required after implementation PRs
  merge and deploy.
- Required implementation and automation artifact PRs merged:
  - #2511 `feat(auth): add manual user setup API`
  - #2513 `feat(web): split manual user setup actions`
  - #2514 `feat(web): add login password reset flow`
  - #2516 `docs: add manual user setup verification`
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
- Local checks for the U4 Settings Users UI slice:
  - `pnpm --filter @thinkwork/web exec vitest run src/components/settings/SettingsUsers.test.tsx src/components/settings/SettingsUserDetail.test.tsx`
  - `pnpm --filter @thinkwork/web typecheck`
  - Direct Prettier check for touched files
  - `git diff --check`
- Local checks for the U5 login reset UI slice:
  - `pnpm --filter @thinkwork/web exec vitest run src/components/auth/EmailPasswordForm.test.tsx src/routes/-sign-in.test.tsx`
  - `pnpm --filter @thinkwork/web typecheck`
  - Direct Prettier check for touched files
  - `git diff --check`
  - Browser smoke: started Vite at `http://127.0.0.1:5180/sign-in`, confirmed
    the login heading, Reset password action, reset request step, and enabled
    Send reset code state after entering an email.
- Local checks for the U6 docs, rollout, and verification slice:
  - `pnpm --filter @thinkwork/docs build`
  - Direct Prettier check for touched files
  - `git diff --check`
