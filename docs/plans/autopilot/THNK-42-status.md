# THNK-42 Autopilot Status

## Current State

- Linear status: In Progress
- Worker branch: `codex/thnk-42-ses-selection-fix`
- Base: `origin/main` at `8305b3dc63f2342f4f35772a48dce934210e02c3`
- Phase: Verification rebound fix pass

## Discovery

- THNK-42 is an initial Ready-to-Work pass, not a failed
  Verification/Review rebound.
- No child issues were present.
- Linear plan document read: `Plan: SendGrid email provider for invitations`.
- Related THNK-35 context read, including the shipped Resend Channel member
  invite delivery learning.
- SendGrid docs checked for the Mail Send API and authenticated-domain list
  endpoint.

## Verification Rebound

- 2026-06-17: PR #2617 was merged, but verification moved THNK-42 back from
  Verification to In Progress.
- Verification evidence showed two issues:
  - SES could be selected in the UI, but `configureEmailProvider` forced SES
    `active_for_production` to `false`, allowing an older configured Resend row
    to silently send invitations.
  - Local UI review found the SendGrid credential flow was hard-coded into
    Settings -> General instead of being exposed through the Email Channel
    plugin like Resend.
- Fix-pass direction: keep General Settings focused on email-provider
  selection, move SendGrid credential/domain setup into the Email Channel
  plugin settings surface, declare SendGrid in the plugin/provider capability
  contract, and persist explicit SES selection so invite delivery uses
  Cognito/SES when SES is active.

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
- 2026-06-17 fix pass: Renamed the provider package surface from Resend
  Channel to Email Channel and declared provider options for Resend, SendGrid,
  and SES in the plugin catalog contract.
- 2026-06-17 fix pass: Removed provider-specific SendGrid credential/domain UI
  from Settings -> General. General now only selects SES plus configured
  Email Channel providers.
- 2026-06-17 fix pass: Moved the General Settings selector into the Deployment
  section as a single Email Provider row, removed the separate Invitation email
  section and readiness badges, and filtered the dropdown to available
  providers only.
- 2026-06-17 fix pass: Added SendGrid API key and authenticated-domain setup to
  the Email Channel plugin settings alongside Resend.
- 2026-06-17 fix pass: Changed `configureEmailProvider` to persist
  `active_for_production = true` for explicit SES selection and changed invite
  resolution to return Cognito/SES delivery when SES is the active provider.
- 2026-06-17 fix pass: Added regression coverage for active SES with stale
  configured Resend, and for SendGrid credential setup living under the plugin
  settings page rather than General.

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
- PR #2617:
  - URL: `https://github.com/thinkwork-ai/thinkwork/pull/2617`
  - Final checks passed: `cla`, `lint`, `Migration Drift Precheck (dev)`,
    `verify`, `test`, `typecheck`.
  - Squash-merged to `main` as
    `8f77539ad194ed40e6825015fba9204993affabe`.
  - Remote branch `codex/thnk-42-sendgrid-provider` is deleted.
- Final artifact:
  - This status update is the remaining automation-created artifact to merge
    before moving THNK-42 to Verification.

## Fix-Pass Local Evidence

- Branch: `codex/thnk-42-ses-selection-fix`
- PR: `https://github.com/thinkwork-ai/thinkwork/pull/2620`
- Local validation:
  - `pnpm --filter @thinkwork/plugin-email-channel test` passed: 1 file, 7
    tests.
  - `pnpm --filter @thinkwork/plugin-catalog test -- src/__tests__/contracts.test.ts`
    passed: 1 file, 29 tests.
  - `pnpm --filter @thinkwork/api test -- src/graphql/resolvers/email-channel/__tests__/configure-provider.test.ts src/__tests__/inviteMember-computer-claim.test.ts`
    passed: 2 files, 8 tests.
  - `pnpm --filter @thinkwork/web test -- src/components/settings/SettingsGeneral.test.tsx src/components/settings/plugins/PluginDetail.test.tsx`
    passed: 2 files, 26 tests.
  - `pnpm --filter @thinkwork/web typecheck` passed.
  - `pnpm --filter @thinkwork/api typecheck` passed.
  - `pnpm --filter @thinkwork/plugin-email-channel typecheck` passed.
  - `pnpm --filter @thinkwork/plugin-catalog typecheck` passed.
