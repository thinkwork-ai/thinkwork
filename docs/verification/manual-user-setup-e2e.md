---
title: "Manual user setup end-to-end verification"
date: 2026-06-15
status: active
---

# Manual User Setup End-to-End Verification

This checklist proves THNK-29 against a deployed AWS stage. Local tests are not
enough for final signoff because Cognito, SES, CloudTrail, and deployed runtime
configuration determine whether manual setup, invite delivery, resend delivery,
and password reset work honestly.

Use the normal merge and deploy pipeline before live verification. Do not run
production mutations from a local checkout, and do not record reset codes,
passwords, tokens, or unredacted inbox content in this repository.

## Test Envelope

Fill these before running live verification:

| Field                | Value                           |
| -------------------- | ------------------------------- |
| Stage                |                                 |
| Region               |                                 |
| Deployed commit      |                                 |
| Web app URL          |                                 |
| Operator account     | Redacted owner/admin            |
| Manual user address  | Synthetic or controlled address |
| Invite user address  | Synthetic or controlled address |
| SES sandbox status   | Sandbox / production            |
| SES sender identity  | Verified / not verified         |
| Cognito user pool id | Redacted if customer-sensitive  |

## Preconditions

1. The target stage is deployed from a commit containing:
   - `addManualUser`
   - `resendMemberInvite`
   - Settings -> Users Add user / Send invite split
   - login Reset password
   - API Lambda IAM for `cognito-idp:AdminSetUserPassword`
2. The operator can sign in as a tenant owner/admin.
3. A non-operator tenant member exists or can be created for access-control
   checks.
4. Cognito account recovery is configured for verified email.
5. SES/Cognito email posture is known:
   - from identity verified
   - SES account sandbox or production status known
   - controlled recipient verified if the account is sandboxed
   - configuration set or CloudWatch/SES event destination known, if available

## Evidence Rules

- Prefer synthetic addresses such as `thnk29-<timestamp>@<controlled-domain>`.
- Redact unnecessary PII in screenshots and logs.
- Do not store reset codes, passwords, session tokens, JWTs, refresh tokens, or
  raw inbox screenshots in durable docs.
- Store raw CloudTrail, SES, and inbox evidence only in restricted temporary
  storage; this document should contain summaries and redacted pointers.
- Record CloudTrail event names, timestamps, and request side-effect shape, not
  secret payloads.
- If delivery is blocked by SES sandbox or sender configuration, record the
  visible product error and the AWS posture that explains it.

## Automated Regression Proof

These commands should have passed on the implementation PRs:

```bash
pnpm --filter @thinkwork/api exec vitest run \
  src/__tests__/manual-user-setup.test.ts \
  src/__tests__/graphql-contract.test.ts \
  src/__tests__/resendMemberInvite.test.ts

pnpm --filter @thinkwork/web exec vitest run \
  src/components/settings/SettingsUsers.test.tsx \
  src/components/settings/SettingsUserDetail.test.tsx \
  src/components/auth/EmailPasswordForm.test.tsx \
  src/routes/-sign-in.test.tsx
```

## Live Verification

### 1. Manual Add Without Email

1. Sign in as owner/admin.
2. Open Settings -> Users.
3. Click **Add user**.
4. Enter the manual synthetic address, optional display name, and `member` role.
5. Submit.

Expected:

- UI reports access creation without invite-success or email-delivery copy.
- Users table shows the new row with the requested role/status.
- Cognito contains the user with verified email and reset-password eligibility.
- CloudTrail shows the manual Cognito create/set-password sequence and no
  invitation delivery for that Add user action.
- The operator never sees a password or temporary password.

Evidence:

| Item                                    | Result |
| --------------------------------------- | ------ |
| UI result text                          |        |
| GraphQL operation/result summary        |        |
| Cognito status                          |        |
| CloudTrail events observed              |        |
| Password/reset-code redaction confirmed |        |

### 2. Duplicate Manual Add

1. Repeat **Add user** for the same active tenant member.

Expected:

- UI shows already-member/duplicate copy.
- No duplicate row appears.
- No unnecessary second Cognito create/send side effect is recorded.

Evidence:

| Item                         | Result |
| ---------------------------- | ------ |
| UI duplicate text            |        |
| Row count check              |        |
| CloudTrail side-effect check |        |

### 3. Send Invite Delivery Truthfulness

1. Click **Send invite**.
2. Enter the invite synthetic address, optional name, and role.
3. Submit.

Expected when email is configured:

- UI success corresponds to a new Cognito create/send attempt.
- CloudTrail shows `AdminCreateUser`.
- Cognito user state is pending or setup-required as expected.
- SES telemetry or controlled inbox evidence is recorded when available.

Expected when email is blocked:

- UI shows a delivery/configuration failure.
- UI does not show "Invite sent" or "Invite resent".

Evidence:

| Item                                   | Result |
| -------------------------------------- | ------ |
| UI result text                         |        |
| CloudTrail `AdminCreateUser` timestamp |        |
| Cognito status                         |        |
| SES/inbox summary or blocker           |        |

### 4. Resend Invite Delivery Truthfulness

1. Open a pending/resendable member detail page.
2. Click **Resend invite**.
3. Repeat once with a separate human click if allowed by the test plan.
4. Open a confirmed/non-pending member detail page and confirm resend success is
   unavailable or rejected.

Expected:

- Pending resend success corresponds to a fresh Cognito
  `AdminCreateUser(MessageAction=RESEND)` attempt.
- Separate human clicks use distinct operation attempts and produce distinct
  Cognito attempts.
- Existing `inviteMember` idempotency rows do not suppress resend.
- Confirmed/non-pending users do not show resend success and do not trigger a
  Cognito resend.

Evidence:

| Item                                 | Result |
| ------------------------------------ | ------ |
| Pending resend UI text               |        |
| Distinct operation attempts observed |        |
| CloudTrail resend timestamps         |        |
| Non-pending behavior                 |        |

### 5. Login Reset For Manual User

1. Sign out or open the login page in a clean browser session.
2. Click **Reset password**.
3. Enter the manual user's email.
4. Retrieve the reset code from the controlled inbox without recording the code.
5. Enter the code plus a new test password.
6. Return to sign-in and sign in with the new password.

Expected:

- Request-code copy does not confirm whether arbitrary accounts exist.
- The manual user can establish credentials without operator-visible password
  handling.
- Invalid/expired code, password-policy, rate-limit, and configuration failures
  are visible when exercised.
- Evidence does not include the reset code, password, or tokens.

Evidence:

| Item                       | Result |
| -------------------------- | ------ |
| Request-code UI copy       |        |
| Confirm-reset UI result    |        |
| Sign-in result             |        |
| Negative path exercised    |        |
| Secret redaction confirmed |        |

### 6. Access Control

1. Sign in as a non-operator member.
2. Attempt to access Settings -> Users actions or invoke the relevant API calls
   through approved test tooling.

Expected:

- Non-operator cannot access Add user, Send invite, Resend invite, role
  assignment, or removal.
- API denial happens before Cognito or SES side effects.

Evidence:

| Item                            | Result |
| ------------------------------- | ------ |
| UI availability                 |        |
| API denial result               |        |
| CloudTrail no-side-effect check |        |

## CLI and Legacy REST Audit

THNK-29's changed product surface is web GraphQL Settings plus web login:

- `thinkwork user invite` remains an email-delivery path through
  `/api/tenants/:slug/invites`.
- `thinkwork user reset-password` remains an operator helper around Cognito
  `admin-reset-user-password`.
- `/api/tenants/:slug/invites` remains CLI-facing invite behavior and does not
  provide the no-email manual setup semantics.

During verification, do not treat CLI invite as proof of web Add user behavior.
Use web Settings -> Users and the GraphQL operations for THNK-29 acceptance.

## Completion Record

| Scenario                    | Pass/Fail | Evidence pointer |
| --------------------------- | --------- | ---------------- |
| Manual add without email    |           |                  |
| Duplicate manual add        |           |                  |
| Send invite truthfulness    |           |                  |
| Resend invite truthfulness  |           |                  |
| Login reset for manual user |           |                  |
| Access control              |           |                  |

## Cleanup

1. Remove or disable synthetic tenant members through normal Settings/API paths
   if the stage should not retain them.
2. Restore any temporary SES sandbox recipient identity changes.
3. Remove temporary inbox artifacts from restricted storage after the evidence
   retention window.
4. Do not delete CloudTrail or SES telemetry.
