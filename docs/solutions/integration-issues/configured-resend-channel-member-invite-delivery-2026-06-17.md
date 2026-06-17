---
title: "Configured Resend Channel must own member invite delivery"
date: 2026-06-17
category: integration-issues
module: packages/api/src/graphql/resolvers/core/member-invite-delivery.ts
problem_type: integration_issue
component: authentication
symptoms:
  - "Settings -> Users invite returned a GraphQL error while the tenant was trying to use Resend."
  - "After a partial fix, the invite arrived from no-reply@verificationemail.com instead of the configured Resend sender."
  - "Resend provider logs had no matching sent email even though the user received a Cognito invite."
  - "Provider events and loop-test evidence were still shown as blocking readiness after the one-key Resend setup was configured."
root_cause: scope_issue
resolution_type: code_fix
severity: high
related_components:
  - packages/api/src/graphql/resolvers/core/inviteMember.mutation.ts
  - packages/api/src/graphql/resolvers/core/resendMemberInvite.mutation.ts
  - packages/api/src/graphql/resolvers/email-channel/mutations.ts
  - packages/api/src/lib/email-channel/readiness.ts
  - apps/web/src/components/settings/plugins/email-channel/EmailReadinessPanel.tsx
tags:
  - thnk-35
  - resend
  - cognito
  - member-invites
  - email-channel
  - ses-fallback
  - readiness
---

# Configured Resend Channel must own member invite delivery

## Problem

THNK-35 originally scoped the Email Channel plugin to agent, Space, and routine
email while leaving Cognito invitations outside v1. During implementation and
verification, that boundary failed the product goal: if a tenant has configured
Resend Channel as its email provider, Settings -> Users invitations must use
that provider instead of Cognito's default sender.

The visible failure was confusing. The UI first surfaced a generic GraphQL
error. After an initial delivery fix, Eric received an invite, but it came from
`no-reply@verificationemail.com`, went to junk, and did not appear in Resend
logs. That meant the code had fallen back to Cognito delivery even though
Resend was configured.

## Symptoms

- Settings -> Users **Send invite** or **Resend invite** showed
  `[GraphQL] Unexpected error` while testing a Resend-configured tenant.
- A received invite had Cognito's `no-reply@verificationemail.com` sender, not
  ThinkWork's configured `noreply@thinkwork.ai` sender.
- Resend did not show a matching sent-email record, proving the successful UI
  path had not used the configured provider.
- Readiness could stay stale: setup checks had passed, but
  `active_for_production` was false and old provider-events / loop-test rows
  still appeared blocked.

## What Didn't Work

- **Treating platform transactional mail as permanently out of scope.** The
  requirements and plan intentionally excluded Cognito invitations. That was
  correct for not rebuilding every transactional email path on day one, but it
  became wrong once the Resend Channel was the tenant's configured email
  authority. User invites are the first email a new tenant user sees, so they
  are also the most important proof that provider setup works.
- **Selecting only active, ready providers.** The deployed tenant had a Resend
  row with credential and sender configured, but stale readiness state left
  `active_for_production` false. A resolver that required only the active flag
  silently fell back to Cognito. The follow-up fix prefers configured Resend and
  fails visibly if credential or sender is missing.
- **Trusting "email received" as proof of the provider.** Cognito can still
  deliver via its default `verificationemail.com` path. Provider verification
  has to check the sender and Resend's sent-email log, not just inbox arrival.
- **Keeping provider-events and loop-test as production blockers after setup
  simplification.** Once the product moved to one-key Resend setup, live
  provider events and send/reply loop evidence became post-traffic evidence,
  not requirements for sending the first invite.

Session history captured this pivot: the implementation thread first preserved
the original "Cognito invites are excluded" boundary, then Eric's browser tests
showed that successful Cognito fallback was still the wrong product outcome
when Resend was configured (session history).

## Solution

Separate Cognito account creation from invite email delivery.

`inviteMember` still creates or resolves the Cognito user, because Cognito owns
authentication. But when an email-channel provider is configured, the mutation
suppresses Cognito email delivery, generates or rotates the temporary password,
and sends the invitation through the configured provider:

```ts
const tempPassword = emailChannelDelivery ? generateTemporaryPassword() : null;
const result = await cognito.send(
  new AdminCreateUserCommand({
    UserPoolId: userPoolId(),
    Username: email,
    ...(tempPassword
      ? {
          TemporaryPassword: tempPassword,
          MessageAction: "SUPPRESS" as const,
        }
      : {
          DesiredDeliveryMediums: ["EMAIL"],
        }),
    UserAttributes: [
      { Name: "email", Value: email },
      { Name: "email_verified", Value: "true" },
      { Name: "custom:tenant_id", Value: tenantId },
    ],
  }),
);
```

For existing pending users, rotate the temporary password with
`AdminSetUserPassword`, then send the new password through the channel. Keep
Cognito `MessageAction=RESEND` only as fallback when no channel is configured.

The provider resolver should prefer Resend in this order:

```ts
const activeResendProvider = providers.find(
  (provider) =>
    provider.provider === "resend" && provider.active_for_production,
);
const configuredResendProvider = providers.find(
  (provider) =>
    provider.provider === "resend" &&
    provider.credential_secret_ref &&
    provider.default_from_email,
);
const activeProvider = providers.find(
  (provider) => provider.active_for_production,
);
const provider =
  activeResendProvider ?? configuredResendProvider ?? activeProvider ?? null;
```

If a provider row exists but lacks the credential or sender, fail with a typed
`DELIVERY_FAILED` GraphQL error instead of falling back to Cognito. Silent
fallback hides provider misconfiguration and sends mail from the wrong system.

Resend delivery uses the same email-channel service as agent email, with a
tenant-invite tag and a provider idempotency key. Resend-member-invite uses a
resend-specific namespace so human resend clicks do not collapse into the
original invite:

```ts
idempotencyKey: `tenant-invite-resend:${tenantId}:${memberId}:${input.idempotencyKey}`,
```

The one-key setup path also activates the provider and runs readiness checks
after saving the key and webhook secret. Production readiness now depends on
setup checks only:

```ts
export const PRODUCTION_READINESS_CHECKS = [
  "credentials",
  "sending_domain",
  "inbound_receiving",
  "webhook_signature",
];
```

`provider_events` and `loop_test` remain visible, but they are waiting evidence
until live traffic exists.

## Why This Works

Cognito and Resend have different jobs:

- Cognito owns identity state, temporary password validity, and first-login
  password-change behavior.
- Resend Channel owns tenant-visible email delivery once the tenant configured
  it as the active provider.

Suppressing Cognito email when Resend is configured avoids duplicate invites
and avoids Cognito's default sender. Rotating the temporary password before a
resend keeps the invite useful. Preferring configured Resend over a stale
`active_for_production` flag makes the "drop in the key and it works" setup
survive stale readiness rows, while explicit `DELIVERY_FAILED` errors keep
broken channel configuration from being masked by Cognito fallback.

The verification proof for THNK-35 used this exact distinction. The final
browser resend produced a Resend message
`7d249cc0-0bc4-4722-99a8-d751986056c7`, from `noreply@thinkwork.ai`, to
`ericodom37+resend-1781729752780@gmail.com`, with Resend status `delivered`.
That provider-side log, not just inbox arrival, proved the correct delivery
path.

## Prevention

- For any tenant-visible email path, decide whether configured Email Channel is
  the delivery authority. If yes, Cognito/SES/product mail is fallback only
  when no channel is configured.
- Do not silently fall back from a configured provider to Cognito. Missing
  credential, sender, or secret state should return a typed delivery error.
- Test both the UI response and provider-side record. A received email from
  `verificationemail.com` means Cognito delivery, not Resend delivery.
- Keep account creation and email delivery tests separate. Invite tests should
  assert `MessageAction: "SUPPRESS"` when channel delivery is active, password
  rotation for resends, and Cognito resend only when no channel exists.
- After simplifying setup, keep readiness labels honest: setup checks can gate
  production, while delivery events and loop evidence are post-traffic evidence.

## Related Issues

- Linear THNK-35, "Email Functionality"
- PR [#2607](https://github.com/thinkwork-ai/thinkwork/pull/2607) - initial
  user invite delivery through Resend Channel
- PR [#2610](https://github.com/thinkwork-ai/thinkwork/pull/2610) - enforce
  configured Resend instead of silent Cognito fallback
- PR [#2611](https://github.com/thinkwork-ai/thinkwork/pull/2611) - branded
  Resend member invite email
- PR [#2613](https://github.com/thinkwork-ai/thinkwork/pull/2613) - resend
  member invites through Resend Channel
- PR [#2615](https://github.com/thinkwork-ai/thinkwork/pull/2615) - final
  provider validation/status evidence
- [THNK-28 resend invite reports success without sending email](./tei-resend-invite-idempotency-and-ses-sandbox-2026-06-15.md)
- [Cognito invite emails never sent: controller runner drops SES wiring vars](./controller-vars-allowlist-blocks-cognito-ses-invite-emails.md)
