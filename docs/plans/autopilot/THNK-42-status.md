# THNK-42 Autopilot Status

## Current State

- Linear status: In Progress
- Worker branch: `codex/thnk-42-sendgrid-provider`
- Base: `origin/main` at `11718bb662767d5802e33f921bd01243929b849a`
- Phase: implementation

## Discovery

- THNK-42 is an initial Ready-to-Work pass, not a failed
  Verification/Review rebound.
- No child issues were present.
- Linear plan document read: `Plan: SendGrid email provider for invitations`.
- Related THNK-35 context read, including the shipped Resend Channel member
  invite delivery learning.
- SendGrid docs checked for the Mail Send API and authenticated-domain list
  endpoint.

## Implementation Log

- 2026-06-17: Created implementation branch from fresh `origin/main`.
- 2026-06-17: Materialized repo plan
  `docs/plans/2026-06-17-005-feat-sendgrid-invitation-provider-plan.md`.
- 2026-06-17: Added `sendgrid` to the Email Channel provider enum, Drizzle
  constraint, and generated GraphQL consumer types.
- 2026-06-17: Implemented the SendGrid provider adapter for authenticated
  domain discovery, outbound Mail Send, safe provider errors, and
  outbound-only readiness.
- 2026-06-17: Wired SendGrid credential save to fetch usable authenticated
  domains, auto-select a single domain, preserve multiple-domain choices in
  metadata, and fail closed when no usable domain is available.
- 2026-06-17: Added Settings -> General controls for SES, Resend, and SendGrid
  invitation-provider selection plus SendGrid key/domain refresh.
- 2026-06-17: Updated invite delivery to honor an active SendGrid provider and
  prefer explicit active providers over the legacy configured-Resend fallback.

## PR Evidence

- Branch: `codex/thnk-42-sendgrid-provider`
- Local validation:
  - `pnpm --filter @thinkwork/api test -- src/lib/email-channel/__tests__/sendgrid-provider.test.ts src/lib/email-channel/__tests__/provider-contract.test.ts src/__tests__/graphql-contract.test.ts src/__tests__/inviteMember-computer-claim.test.ts src/__tests__/resendMemberInvite.test.ts` passed: 5 files, 159 tests.
  - `pnpm --filter @thinkwork/api typecheck` passed.
  - `pnpm --filter @thinkwork/web test -- src/components/settings/SettingsGeneral.test.tsx` passed: 1 file, 7 tests.
  - `pnpm --filter @thinkwork/web typecheck` passed.
  - `pnpm schema:build` passed.
  - `git diff --check` passed.
- CI remediation:
  - PR #2617 initially failed `Migration Drift Precheck (dev)` because the
    new hand-rolled migration had not yet been applied to dev.
  - Applied only
    `packages/database-pg/drizzle/0172_email_channel_sendgrid_provider.sql` to
    the dev database.
  - Corrected the migration marker from `creates:` to `creates-constraint:`
    so the drift reporter probes the table constraint rather than a relation.
  - `bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0172_email_channel_sendgrid_provider.sql`
    passed after the dev apply.
  - PR #2617 then failed `test` because
    `packages/database-pg/__tests__/migration-0170-email-channel-plugin.test.ts`
    still expected the pre-THNK-42 provider list `["resend", "ses"]`.
    Updated the characterization test to expect
    `["resend", "sendgrid", "ses"]`.
- Follow-up validation:
  - `pnpm --filter @thinkwork/database-pg test -- __tests__/migration-0170-email-channel-plugin.test.ts`
    passed: 1 file, 8 tests.
  - `pnpm --filter @thinkwork/api test -- src/lib/email-channel/__tests__/sendgrid-provider.test.ts src/lib/email-channel/__tests__/provider-contract.test.ts src/__tests__/graphql-contract.test.ts src/__tests__/inviteMember-computer-claim.test.ts src/__tests__/resendMemberInvite.test.ts`
    passed: 5 files, 159 tests.
  - `pnpm --filter @thinkwork/web test -- src/components/settings/SettingsGeneral.test.tsx`
    passed: 1 file, 7 tests.
- PR: Pending.
