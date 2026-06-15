---
title: "THNK-28: TEI resend invite reports success without sending email"
date: 2026-06-15
last_updated: 2026-06-15
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
root_cause: logic_error
resolution_type: code_fix
related_components:
  - packages/api/src/graphql/resolvers/core/resendMemberInvite.mutation.ts
  - apps/web/src/components/settings/SettingsUserDetail.tsx
  - apps/cli/src/commands/member.ts
  - packages/lambda/admin-ops-mcp.ts
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

The initial debug artifact diagnosed the application idempotency replay without
changing product code. A follow-up implementation then shipped the durable fix:
a dedicated `resendMemberInvite` mutation, typed resend outcomes, web/CLI/admin
ops parity, and regression coverage proving the old `inviteMember` namespace
cannot suppress a human resend attempt.

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

## Fix Plan That Shipped

The preferred product fix from the debug pass shipped in PR
[#2509](https://github.com/thinkwork-ai/thinkwork/pull/2509), merged at
`4dcfccf4fc6be980ff8b398d5d2e87c438833068`.

### API contract

GraphQL now exposes a dedicated resend operation instead of overloading
`inviteMember`:

```graphql
input ResendMemberInviteInput {
  memberId: ID!
  idempotencyKey: String!
}

enum ResendMemberInviteStatus {
  RESENT
  NOT_PENDING
  DELIVERY_FAILED
}

type ResendMemberInviteResult {
  status: ResendMemberInviteStatus!
  message: String!
}
```

`resendMemberInvite` performs tenant-admin authorization first, resolves the
tenant member and user server-side by `memberId`, checks Cognito status with
`AdminGetUser`, and only attempts `AdminCreateUser` with `MessageAction=RESEND`
for `FORCE_CHANGE_PASSWORD` or `UNCONFIRMED` users.

### Idempotency boundary

The mutation uses `mutationName: "resendMemberInvite"` and
`clientKey: input.idempotencyKey`, with `inputs: { memberId }`. That separates
the resend namespace from `inviteMember`, so a prior create/invite result cannot
replay over a later resend click.

The Cognito status lookup intentionally happens before `runWithIdempotency`.
That keeps a transient `AdminGetUser` failure from poisoning the human click key
before any delivery side effect occurs (session history).

### Honest delivery results

Known Cognito/SES delivery failures such as `CodeDeliveryFailureException` and
`InvalidEmailRoleAccessPolicyException` return:

```json
{ "status": "DELIVERY_FAILED" }
```

The public message is normalized so the UI does not leak raw provider text,
while the server logs the provider error name/message for operators (session
history). Confirmed or otherwise non-pending Cognito users return
`NOT_PENDING` without sending.

### Web, CLI, and admin-ops parity

`SettingsUserDetail` now renders the resend action only for resendable Cognito
statuses, calls `SettingsResendMemberInviteMutation`, and creates a per-click key
with the shape:

```ts
`resend-member-invite:${memberId}:${crypto.randomUUID()}`;
```

The UI treats only `RESENT` as success, suppresses duplicate in-flight clicks,
and surfaces `NOT_PENDING` / `DELIVERY_FAILED` as non-success messages.

The same capability is available to agent-native operator workflows:

- `thinkwork member resend <memberId>`
- `tenant_members_resend_invite` in admin-ops MCP

This matters because tenant member administration should not have a web-only
escape hatch; if a human operator can retry delivery, an authorized agent
workflow needs the same typed operation.

Ops prerequisite:

1. Finish or confirm SES production access for the TEI account.
2. Until production access is enabled, test sends only to verified recipient
   identities or expect sandbox failures.
3. After production access, rerun a controlled invite smoke and record:
   CloudTrail `AdminCreateUser` with `MessageAction=RESEND`, Cognito user status,
   SES `SentLast24Hours` movement or delivery telemetry, and inbox receipt.

## Verification Plan For The Product Fix

The product fix was verified after PRs
[#2504](https://github.com/thinkwork-ai/thinkwork/pull/2504),
[#2509](https://github.com/thinkwork-ai/thinkwork/pull/2509), and
[#2510](https://github.com/thinkwork-ai/thinkwork/pull/2510) merged.

Focused verification covered:

- API resolver tests for `resendMemberInvite`, tenant-admin auth before Cognito
  work, server-side member/user resolution, pending status checks,
  `MessageAction=RESEND`, `NOT_PENDING`, and typed `DELIVERY_FAILED`.
- Idempotency regression tests proving the `inviteMember` namespace cannot
  replay or suppress the dedicated resend path.
- Web Settings tests proving the button calls the resend mutation with per-click
  keys, does not call the old `inviteMember` mutation, suppresses duplicate
  in-flight clicks, and only shows **Invite resent** on `RESENT`.
- CLI registration/generator checks for `thinkwork member resend <memberId>`,
  plus admin-ops tests proving `tenant_members_resend_invite` uses the dedicated
  GraphQL resend mutation with resend-scoped idempotency keys.
- Focused typechecks for API, web, CLI, lambda, and admin-ops, plus the web
  production build.

## Current Status

THNK-28 is complete in product code. The durable engineering lesson is to model
operator actions as distinct operations when their side effects differ. A
"resend delivery" action is not a replay of "create or invite member"; it needs
its own API contract, idempotency namespace, typed result surface, UI copy, and
agent-native tool/CLI path.

The remaining caveat is operational, not an application false-success bug: TEI
SES sandbox or identity state can still block real delivery after Cognito is
reached. Those known failures now surface as `DELIVERY_FAILED` instead of
**Invite resent**.
