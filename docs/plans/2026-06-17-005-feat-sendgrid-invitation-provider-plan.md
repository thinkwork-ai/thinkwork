---
title: "feat: SendGrid invitation email provider"
type: feat
status: active
date: 2026-06-17
linear: THNK-42
origin: Linear document "Plan: SendGrid email provider for invitations"
---

# feat: SendGrid invitation email provider

## Overview

Add SendGrid as a tenant-configurable invitation email provider beside the
existing SES default and the Resend Channel path from THNK-35. The work builds
on the provider-neutral Email Channel substrate that is already on main:
provider installs live in `email_provider_installs`, credentials are stored in
Secrets Manager, readiness rows explain setup state, and member invites already
separate Cognito identity provisioning from configured provider delivery.

## Requirements Trace

- R1. Operators can save a SendGrid API key without exposing the raw secret
  after save.
- R2. ThinkWork fetches authenticated SendGrid domains instead of requiring
  primary manual domain entry.
- R3. One usable authenticated domain can be preselected; multiple usable
  domains remain selectable.
- R4. No usable domain leaves SendGrid not ready with safe setup guidance.
- R5. Settings -> General exposes SES, Resend, and SendGrid as invitation
  provider options.
- R6. Once SendGrid is selected, invite sends fail visibly if SendGrid is not
  configured or ready; they do not silently fall back to another provider.
- R7. SendGrid invitation sends preserve the existing member-invite contract:
  Cognito user provisioning, temporary password delivery, subject, text/html
  bodies, sender policy, and surfaced provider errors.
- R8. Provider selection and readiness are visible for support without
  returning secret material.

## Scope Boundaries

- This is invitation-email provider work, not a new inbound SendGrid channel.
- Do not add SendGrid webhooks, bounce/complaint ingestion, inbound parse,
  thread reply routing, or routine email parity in this issue.
- Preserve SES as the default for tenants without a configured provider.
- Preserve the THNK-35 Resend behavior for configured Resend tenants.
- Do not run manual deploys or production mutation commands during the
  implementation phase.

## Implementation Units

### U1. Provider Contract And Schema

**Goal:** Widen the Email Channel provider contract from `ses | resend` to
include `sendgrid`.

**Files:**

- Modify: `packages/database-pg/src/schema/email-channel.ts`
- Modify: `packages/database-pg/graphql/types/email-channel.graphql`
- Create: `packages/database-pg/drizzle/0172_email_channel_sendgrid_provider.sql`
- Modify: `packages/api/src/lib/email-channel/channel-service.ts`
- Modify: `packages/api/src/lib/email-channel/provider-contract.ts`

**Test scenarios:**

- Service routes `sendgrid` sends through the SendGrid adapter.
- Database check constraints accept `sendgrid` while preserving existing
  provider values.

### U2. SendGrid Adapter And Readiness

**Goal:** Implement the SendGrid REST adapter for authenticated-domain
discovery, readiness metadata, and Mail Send.

**Files:**

- Create: `packages/api/src/lib/email-channel/providers/sendgrid.ts`
- Create: `packages/api/src/lib/email-channel/__tests__/sendgrid-provider.test.ts`
- Modify: `packages/api/src/graphql/resolvers/email-channel/mutations.ts`
- Modify: `packages/api/src/lib/email-channel/readiness-probes.ts`

**Test scenarios:**

- A valid key with one authenticated domain returns ready metadata and an
  auto-selected domain.
- Multiple valid domains are normalized and preserved for operator selection.
- Invalid keys and no-domain responses produce safe not-ready status without
  leaking the key.
- Mail Send uses SendGrid's JSON payload and returns the provider message id
  from response headers when available.

### U3. Invitation Delivery Selection

**Goal:** Allow configured SendGrid to own member invite sends exactly as
configured Resend does today.

**Files:**

- Modify: `packages/api/src/graphql/resolvers/core/member-invite-delivery.ts`
- Modify: `packages/api/src/__tests__/inviteMember-computer-claim.test.ts`
- Modify: `packages/api/src/__tests__/resendMemberInvite.test.ts`

**Test scenarios:**

- Selected/configured SendGrid suppresses Cognito email and calls the channel
  service with provider `sendgrid`.
- Missing SendGrid credential or sender fails with `DELIVERY_FAILED`.
- SES remains the default when no channel provider is configured.

### U4. Settings General UX

**Goal:** Add the operator-facing Settings -> General control to configure
SendGrid and select the invitation provider.

**Files:**

- Modify: `apps/web/src/components/settings/SettingsGeneral.tsx`
- Modify: `apps/web/src/lib/settings-queries.ts`
- Modify: generated GraphQL files for affected consumers
- Test: `apps/web/src/components/settings/SettingsGeneral.test.tsx`

**Test scenarios:**

- Operators see SES, Resend, and SendGrid options.
- Non-operators do not query or render provider controls.
- Saving a SendGrid API key never echoes the key and displays fetched domain
  status.
- Changing provider selection calls the typed GraphQL mutation and refreshes
  state.

## Verification

- `pnpm --filter @thinkwork/api test -- src/lib/email-channel/__tests__/sendgrid-provider.test.ts src/lib/email-channel/__tests__/provider-contract.test.ts src/__tests__/inviteMember-computer-claim.test.ts src/__tests__/resendMemberInvite.test.ts`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/web test -- src/components/settings/SettingsGeneral.test.tsx`
- `pnpm --filter @thinkwork/web typecheck`
- `pnpm schema:build`
- Codegen for API, web, mobile, and CLI after GraphQL type changes.
