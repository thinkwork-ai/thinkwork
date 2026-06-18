---
title: "Email provider plugins need separate setup, selection, and visibility contracts"
date: 2026-06-18
category: architecture-patterns
module: Email Channel plugin / invitation provider selection
problem_type: architecture_pattern
component: tooling
severity: high
applies_when:
  - "A tenant email provider is added behind the Email Channel plugin"
  - "Settings -> General exposes provider selection for tenant-visible email"
  - "A provider can be configured before it is ready for production sends"
  - "A first-party plugin request depends on Settings -> Plugins catalog visibility"
related_components:
  - apps/web/src/components/settings/SettingsGeneral.tsx
  - apps/web/src/components/settings/plugins/email-channel/EmailChannelSettings.tsx
  - packages/api/src/graphql/resolvers/core/member-invite-delivery.ts
  - packages/api/src/graphql/resolvers/email-channel/mutations.ts
  - plugins/email-channel
  - plugins/catalog
tags:
  - thnk-42
  - sendgrid
  - email-channel
  - provider-selection
  - plugin-catalog
  - ses-fallback
  - settings
---

# Email provider plugins need separate setup, selection, and visibility contracts

## Context

THNK-42 added SendGrid beside SES and Resend for tenant invitation email. The
first implementation made the provider functional, but it blurred three
different contracts:

- **Provider setup:** storing a provider API key, fetching authenticated domains,
  and turning provider readiness into install state.
- **Production selection:** choosing which already-available service sends
  tenant invitations.
- **Plugin visibility:** what an operator sees in Settings -> Plugins when the
  issue asks for a provider "as a plugin."

The merged fix pass moved SendGrid credential/domain setup out of General
Settings and into the Email Channel plugin settings surface, kept General
Settings as a compact `Email Provider` selector, and made explicit SES selection
persist as active so invitation delivery could distinguish "use SES/Cognito"
from "no provider selected."

Session history adds an important caution: after PR #2620 merged, Eric still
reported that SendGrid was not visible as a plugin in Settings -> Plugins
(session history). That means future provider work should verify the exact
catalog-visible product contract, not only the shared Email Channel provider
contract. A provider option inside a shared plugin may be technically correct
for reuse, but it may not satisfy a user-facing request for a visible provider
plugin entry.

## Guidance

Treat provider setup, production selection, and catalog visibility as separate
acceptance contracts.

### 1. Keep General Settings as selection, not provider setup

Settings -> General is the place to pick the active invitation email provider.
It should not collect provider-specific credentials or show provider-specific
readiness badges. Provider setup belongs in the provider/plugin detail surface
where the operator expects configuration depth.

The THNK-42 fix converted the old separate `Invitation email` section into a
single Deployment row:

```tsx
<EmailProviderRow
  summary={emailResult.data?.emailChannelSummary}
  onRefresh={() => refreshEmailProviders({ requestPolicy: "network-only" })}
/>
```

That row should offer only available choices: SES plus Email Channel provider
installs that are `READY`. Configured-but-not-ready providers stay visible in
plugin setup, but they should not appear as selectable production senders.

### 2. Put provider-specific setup in the plugin/provider surface

SendGrid setup needs API-key storage, authenticated-domain discovery, optional
domain selection, status text, and provider errors. That is setup work, not a
tenant deployment preference. In THNK-42, that moved to:

```text
apps/web/src/components/settings/plugins/email-channel/EmailChannelSettings.tsx
```

The provider-specific panel can still reuse shared Email Channel GraphQL
mutations and provider install rows. The boundary is user-facing ownership:
operators configure provider credentials in the plugin detail flow, then select
the ready provider from General Settings.

### 3. Represent SES as an explicit active selection

SES is not an Email Channel adapter in the same way Resend and SendGrid are, but
it still has to be a selectable production provider. Do not model "SES selected"
as "no active provider row."

The verification rebound proved why. The backend accepted `provider: SES` with
`activeForProduction: true`, then forced the SES row inactive. Invitation
delivery saw no active provider and used an older configured Resend row as a
legacy fallback. That violated the operator selection and sent through the wrong
path.

The durable rule is:

- active SES means "use Cognito/SES delivery" and should resolve to no
  email-channel delivery adapter;
- no active provider can still use legacy fallback rules only when there is no
  explicit provider selection;
- active Resend or SendGrid means suppress Cognito delivery and send through
  the selected Email Channel provider;
- configured-but-not-ready providers should fail visibly or remain unselectable,
  not silently fall back to a different provider.

Regression tests should cover both persistence and delivery:

```text
configureEmailProvider(SES, activeForProduction: true)
  -> persists explicit active SES selection

active SES plus stale inactive Resend install
  -> invite uses Cognito/SES delivery, not the email-channel adapter
```

### 4. Verify plugin catalog visibility when the issue says "plugin"

"Provider supported by Email Channel" and "SendGrid appears as a plugin" are not
the same product proof. Before closing a provider-plugin issue, inspect the
expected operator path:

- Does Settings -> Plugins need a distinct catalog card for the provider?
- Is the provider supposed to be a provider option inside a shared Email Channel
  plugin?
- Does the plugin detail route make it clear which provider is being configured?
- Does the General Settings selector list only currently available production
  providers?

If the issue or user feedback says "like Resend" or "as a plugin," verify the
actual Settings -> Plugins surface in a browser. Do not infer success from
schema enums, provider-contract tests, or General Settings alone.

## Why This Matters

Email provider work crosses product, plugin, auth, and delivery boundaries. A
provider can be technically send-capable while still wrong in the UI:
credentials might be in the wrong screen, not-ready providers might be
selectable, SES might be treated as absence of selection, or the provider might
not appear where the operator expects plugins to appear.

Separating the contracts keeps each failure visible:

- setup failures stay in the plugin/provider detail flow;
- readiness controls whether a provider can be selected for production;
- explicit SES selection protects the built-in Cognito/SES path from stale
  provider installs;
- catalog-visible plugin expectations are verified in the same surface the
  operator uses.

## When to Apply

- Adding another tenant email provider such as Postmark or Mailgun.
- Changing the Email Channel provider contract, plugin manifest, or plugin
  catalog shape.
- Moving credential setup between Settings -> General and Settings -> Plugins.
- Debugging an invitation send that used Cognito, SES, Resend, or SendGrid
  despite a different operator selection.
- Reviewing an issue that says a provider should be a "plugin" or should behave
  "like Resend."

## Examples

Poor shape:

```text
Settings -> General
  Invitation email
    Provider dropdown: SES, Resend, SendGrid
    SendGrid API key input
    SendGrid domain selector
    readiness badges
```

This mixes setup, readiness, and production selection. It also can make a
provider look available before the plugin/provider setup flow is complete.

Better shape:

```text
Settings -> Plugins -> Email Channel / provider detail
  Resend setup
  SendGrid setup
  credentials, domains, provider readiness, setup guidance

Settings -> General -> Deployment
  Email Provider: SES plus READY provider installs only
```

When a distinct provider plugin card is required, make that explicit and test
for it. The shared Email Channel backend can still own common delivery plumbing,
but the catalog surface must match the product contract.

## Related

- Linear THNK-42, "SendGrid email provider plugin"
- PR [#2617](https://github.com/thinkwork-ai/thinkwork/pull/2617) - initial
  SendGrid invitation provider implementation
- PR [#2620](https://github.com/thinkwork-ai/thinkwork/pull/2620) - move
  SendGrid setup into the Email Channel plugin and preserve SES selection
- [Configured Resend Channel must own member invite delivery](../integration-issues/configured-resend-channel-member-invite-delivery-2026-06-17.md)
- [Plugin source boundaries should be package-owned and deploy-verified](./plugin-source-boundaries-package-owned-deploy-verified-2026-06-17.md)
