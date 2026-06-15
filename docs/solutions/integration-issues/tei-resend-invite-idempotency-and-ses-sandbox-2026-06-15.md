---
title: "THNK-28: TEI resend invite reports success without sending email"
date: 2026-06-15
category: integration-issues
module: packages/api/src/graphql/resolvers/core/inviteMember.mutation.ts
problem_type: integration_issue
component: authentication
severity: high
symptoms:
  - "TEI Settings -> Users shows 'Invite resent' for eric@thinkwork.ai, but no email arrives."
  - "CloudTrail has no Cognito AdminCreateUser or AdminGetUser event during the reported resend window."
  - "The target Cognito user remains FORCE_CHANGE_PASSWORD with UserLastModifiedDate from 2026-06-10."
  - "TEI Cognito is now SES-backed, but the TEI SES account is still sandboxed."
root_cause: application_idempotency_replay
resolution_type: diagnosis_only
related_components:
  - apps/web/src/components/settings/SettingsUserDetail.tsx
  - packages/api/src/lib/idempotency.ts
  - terraform/modules/foundation/cognito
tags:
  - THNK-28
  - tei
  - cognito
  - ses
  - email-invites
  - idempotency
  - resend-invite
---

# THNK-28: TEI resend invite reports success without sending email

## Problem Statement

On 2026-06-15, Eric clicked **Resend invite** on
`https://tei.thinkwork.ai/settings/users/...` for `eric@thinkwork.ai`. The UI
reported **Invite resent**, but no email arrived.

This was intentionally diagnosed without implementing the product fix.

## Smallest Meaningful Signal

CloudTrail is the decisive signal for this report: during the issue window
(`2026-06-15T12:40:00Z` to `2026-06-15T13:00:00Z`), the TEI account had:

- no `AdminCreateUser` events for user pool `us-east-1_YlRAfXsE9`;
- no `AdminGetUser` events for the same pool;
- no GraphQL Lambda log lines containing `inviteMember` errors;
- no Cognito delivery error log lines such as `CodeDeliveryFailureException`.

If the resend path had reached the current resolver, Cognito should have at
least seen `AdminGetUser`, and pending users should then see `AdminCreateUser`
with `MessageAction=RESEND`. The absence of both events means the click returned
before the resolver reached Cognito.

## Evidence

Linear issue:

- `THNK-28`, "Send Email from TEI", created `2026-06-15T12:47:39Z`.
- Screenshot shows the user detail page for `Eric Odom <eric@thinkwork.ai>` with
  **Resend invite** and the success text **Invite resent**.
- Issue status at investigation time: `Debug`; priority `High`; project
  `Enterprise Agent OS`; assigned to Eric Odom.

Live TEI deployment:

- `https://tei.thinkwork.ai/thinkwork-runtime-config.json` reports
  `releaseVersion=v0.1.0-canary.187` and stage `tei-e2e`.
- SSM selected-release parameters agree:
  `/thinkwork/tei-e2e/deployment/selected-release-version =
v0.1.0-canary.187`.
- Public site headers show `last-modified: Sun, 14 Jun 2026 18:47:35 GMT`.

Cognito and SES posture:

- Cognito user pool `us-east-1_YlRAfXsE9` reports:
  - `EmailSendingAccount=DEVELOPER`;
  - `SourceArn=arn:aws:ses:us-east-1:637423202447:identity/tei.thinkwork.ai`;
  - `From=ThinkWork <no-reply@tei.thinkwork.ai>`.
- SES `get-account` reports:
  - `ProductionAccessEnabled=false`;
  - `SendingEnabled=true`;
  - `SentLast24Hours=0.0`.
- SES identities include verified domains `tei.thinkwork.ai` and
  `lastmile-tei.com`, plus verified address `eric@homecareintel.com`.
- The target Cognito user for `eric@thinkwork.ai` is still
  `FORCE_CHANGE_PASSWORD`; its `UserLastModifiedDate` is
  `2026-06-10T14:57:55.301-05:00`, not the 2026-06-15 resend attempt.

Recent PR/deployment evidence:

- PR #2308, `fix(auth): resend pending Cognito invites`, merged
  `2026-06-10T00:20:50Z` as `e5e9af37`. It added the pending-user
  `MessageAction=RESEND` path and all checks passed.
- PR #2341, `fix(deploy): thread Cognito SES email and app domain vars through
runner`, merged `2026-06-10T19:28:40Z` as `52e5065e`; all checks passed.
- PR #2357, `fix(deploy): declare controller email/domain vars in generated
root module`, merged `2026-06-11T00:43:28Z` as `d2f25fc0`; all checks passed.
- Current TEI `v0.1.0-canary.187` contains those commits, so the old
  "existing Cognito user no-ops without RESEND" bug is not the active primary
  cause.

## Causal Chain

1. The user-detail resend button calls the existing `inviteMember` mutation with
   only `{ email, name, role }`. It does not pass `idempotencyKey`
   (`apps/web/src/components/settings/SettingsUserDetail.tsx`, lines 217-233).
2. The resolver wraps `inviteMemberCore` in `runWithIdempotency` using
   `mutationName: "inviteMember"`, `inputs: args.input`, and
   `clientKey: args.input?.idempotencyKey ?? null`
   (`packages/api/src/graphql/resolvers/core/inviteMember.mutation.ts`, lines
   54-60).
3. When no client key is supplied, `runWithIdempotency` derives the
   `idempotency_key` from the canonicalized input hash
   (`packages/api/src/lib/idempotency.ts`, lines 74-100).
4. A later resend for the same user uses the same `{ email, name, role }`, so it
   collides with the prior successful invite-member idempotency row.
5. On `isNew=false` and `status=succeeded`, `runWithIdempotency` returns the
   stored `result_json` and never calls `fn`
   (`packages/api/src/lib/idempotency.ts`, lines 267-270).
6. Because `fn` is not called, `inviteMemberCore` never executes its existing
   pending-user Cognito branch:
   `AdminGetUser` followed by `AdminCreateUser` with `MessageAction=RESEND`
   (`packages/api/src/graphql/resolvers/core/inviteMember.mutation.ts`, lines
   95-125).
7. The GraphQL mutation still returns success, so the web component displays
   **Invite resent** even though no Cognito delivery attempt happened.
8. CloudTrail validates this chain: no `AdminGetUser` or `AdminCreateUser`
   events occurred during the reported click window.

## Assumption Audit

- Verified: the live TEI web app is on `v0.1.0-canary.187`, so it includes the
  June 10 pending-user `RESEND` code.
- Verified: live Cognito is now configured for SES-backed `DEVELOPER` email.
- Verified: live SES is still sandboxed (`ProductionAccessEnabled=false`).
- Verified: no Cognito admin event occurred during the issue window.
- Verified: the target Cognito user remains pending and was not modified today.
- Inferred: a succeeded `mutation_idempotency` row for the earlier invite exists
  with the same derived key. This follows from the code and the absence of
  Cognito events, but this investigation did not query Aurora directly.

## Ruled Out

- **Old no-RESEND bug only.** Current `origin/main` and TEI `v0.1.0-canary.187`
  include PR #2308, where pending `UsernameExistsException` users call
  `AdminCreateUser` with `MessageAction=RESEND`.
- **Cognito/SES send attempt failed during the click.** No CloudTrail Cognito
  admin event and no Lambda error appeared in the reported window.
- **Stale TEI release.** Runtime config and SSM both report canary `.187`, after
  the relevant June 10/11 fixes.

## Secondary Live Blocker

Even after the application resend path is fixed, TEI is not fully deliverable to
arbitrary recipient addresses while SES remains sandboxed:

- Cognito is already using `EmailSendingAccount=DEVELOPER`.
- SES `ProductionAccessEnabled=false` means SES-backed sends are restricted to
  verified recipients.
- `eric@thinkwork.ai` is not shown as a verified SES identity in the TEI account.

Expected behavior after bypassing the idempotency replay, before SES production
approval, is a real Cognito/SES delivery attempt that may fail for unverified
recipients. That failure should be surfaced to the operator instead of being
reported as **Invite resent**.

## Fix Plan

Preferred product fix:

1. Add a dedicated `resendMemberInvite` mutation rather than reusing
   `inviteMember` for both "create member" and "attempt another delivery".
2. Require tenant-admin authorization and resolve the member/user by member ID or
   user ID, not by free-form email alone.
3. Server-side, call `AdminGetUser`; allow resend only for
   `FORCE_CHANGE_PASSWORD` or `UNCONFIRMED`; return a typed result for
   `RESENT`, `NOT_PENDING`, and delivery failure.
4. Use a separate mutation name and idempotency namespace from `inviteMember`.
   If the UI supplies a key, it should be unique per human resend action but
   stable across network retry of that same click.
5. Update the Settings user detail button to call the dedicated resend mutation
   and show success only when the server reports a delivery attempt.
6. Add lightweight rate limiting or an operator confirmation if repeated resend
   attempts become possible from the UI.

Smallest acceptable code fix if a new mutation is too large:

1. In `SettingsUserDetail`, pass a resend-specific `idempotencyKey` such as
   `resend-invite:<memberId>:<crypto.randomUUID()>`.
2. Update the button's test to assert `idempotencyKey` is present.
3. Add an API test that seeds an idempotency row for the original invite and then
   proves a resend-specific key still reaches `AdminCreateUser` with
   `MessageAction=RESEND`.
4. Add another API test that Cognito delivery errors are returned to the client,
   not converted into a success message.

Ops prerequisite:

1. Finish or confirm SES production access for the TEI account.
2. Until production access is enabled, test sends only to verified recipient
   identities or expect sandbox failures.
3. After production access, rerun a controlled invite smoke and record:
   CloudTrail `AdminCreateUser` with `MessageAction=RESEND`, Cognito user status,
   SES `SentLast24Hours` movement or delivery telemetry, and inbox receipt.

## Verification Plan For The Product Fix

- API unit/integration test: existing pending user plus prior successful
  `inviteMember` idempotency row still triggers a resend attempt through the
  resend path.
- API unit/integration test: confirmed Cognito users do not resend and return a
  non-success typed result.
- UI test: Settings user detail passes a resend-specific idempotency key or calls
  the new mutation and does not show **Invite resent** on GraphQL/Cognito error.
- Live TEI smoke, after SES production access: click resend for a controlled
  pending user and verify CloudTrail, SES, and inbox evidence.

## Current Recommended Next Action

Implement the product fix in a follow-up PR after this debug artifact lands.
Treat idempotency replay as the immediate application bug, and SES sandbox as
the next environment blocker that will surface once the resend call reaches
Cognito.
