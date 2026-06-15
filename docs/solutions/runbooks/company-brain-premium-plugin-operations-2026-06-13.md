---
title: Company Brain premium plugin operations
date: 2026-06-13
category: docs/solutions/runbooks
module: application-plugins
problem_type: runbook
component: company-brain
severity: medium
applies_when:
  - Issuing a Company Brain install key
  - Running the Company Brain premium plugin smoke
  - Supporting a tenant through existing Cognee adoption
  - Configuring or removing the temporary dev/test backdoor key
tags: [company-brain, premium-plugins, install-keys, cognee, smoke]
---

# Company Brain premium plugin operations

## What owns what

Company Brain is the customer-facing premium plugin. Cognee is the internal
Brain substrate adapter behind the infrastructure component. Customer-facing
surfaces should point to:

- `/settings/plugins/company-brain` for premium entitlement, install, approval,
  and component status.
- `/settings/memory/knowledge-graph` for the working Memory / Ontology graph
  explorer.

Mention Cognee only when interpreting deployment evidence, Terraform outputs,
logs, or implementation notes.

## Issue a one-time key

Use the GraphQL mutation as a ThinkWork platform operator. The raw key is
returned once; only its digest is stored.

```graphql
mutation IssueCompanyBrainKey($input: IssuePremiumPluginInstallKeyInput!) {
  issuePremiumPluginInstallKey(input: $input) {
    keyId
    pluginKey
    tenantId
    installKey
    issuedAt
    expiresAt
  }
}
```

Variables:

```json
{
  "input": {
    "pluginKey": "company-brain",
    "tenantId": "<tenant-id>",
    "expiresAt": null
  }
}
```

Give the raw `installKey` to the tenant administrator out of band. Do not paste
it into Linear, docs, PRs, tfvars, or runtime config.

## Redeem or install

Tenant admins normally paste the key into the Company Brain plugin detail page.
Programmatically, use the normal plugin install mutation:

```graphql
mutation InstallCompanyBrain($input: InstallPluginInput!) {
  installPlugin(input: $input) {
    id
    pluginKey
    state
    components {
      componentKey
      componentType
      state
      handlerRef
      lastError
    }
  }
}
```

Variables:

```json
{
  "input": {
    "pluginKey": "company-brain",
    "installKey": "<raw-key>",
    "idempotencyKey": "company-brain-install-<unique-id>"
  }
}
```

Successful redemption creates a persistent `PluginEntitlement`. Future install,
reinstall, or update paths should not ask the same tenant for another key while
that entitlement is active.

## Revoke an unused key

Use the revoke mutation before the key is redeemed:

```graphql
mutation RevokeCompanyBrainKey($input: RevokePremiumPluginInstallKeyInput!) {
  revokePremiumPluginInstallKey(input: $input) {
    keyId
    pluginKey
    status
    revokedAt
  }
}
```

Variables:

```json
{
  "input": {
    "keyId": "<key-id>",
    "tenantId": "<tenant-id>"
  }
}
```

Revocation does not remove an entitlement already granted by a redeemed key.

## Temporary backdoor key

The dev/test backdoor key is controlled by runtime config, not committed
plaintext:

- `COMPANY_BRAIN_BACKDOOR_INSTALL_KEY_SECRET_ARN`: Secrets Manager ARN
  containing the temporary raw key.
- `COMPANY_BRAIN_BACKDOOR_INSTALL_KEY_STAGES`: comma-separated stage allowlist.
- `COMPANY_BRAIN_BACKDOOR_INSTALL_KEY`: local/runtime direct value path used
  only when config resolution supplies it.

Keep production stages out of the allowlist. Remove the secret ARN and stage
allowlist when the backdoor is no longer needed. The backdoor follows the same
entitlement path as a normal key and shows `source: "backdoor_key"`.

## Interpret adoption evidence

Company Brain's infrastructure component key is `brain-substrate`. Its
`handlerRef` links the plugin component to the managed-app deployment path.
Useful fields:

- `managedAppKey: "cognee"` means the internal adapter is Cognee.
- `managedApplicationId` points at the existing or newly created managed app row.
- `deploymentJobId` points at the plan/apply evidence.
- `adoptionRequiresNoChange: true` means the tenant had an existing Cognee
  deployment and the plugin install created a no-change adoption plan first.

If install is `awaiting_approval`, review and approve/reject the deployment plan
through the existing managed application plan dialog. If the component is
`failed`, read `lastError` and the deployment job evidence before retrying.

## Smoke validation

Dry-run:

```sh
node plugins/company-brain/smoke/company-brain-plugin-smoke.mjs
```

Live with an existing issued or dev/test backdoor key:

```sh
SMOKE_ENABLE_COMPANY_BRAIN_PLUGIN=1 \
  SMOKE_TENANT_ID=<tenant-id> \
  SMOKE_ADMIN_USER_ID=<tenant-admin-user-id> \
  SMOKE_COMPANY_BRAIN_INSTALL_KEY=<issued-or-backdoor-key> \
  node plugins/company-brain/smoke/company-brain-plugin-smoke.mjs
```

Live with key issuance inside the smoke:

```sh
SMOKE_ENABLE_COMPANY_BRAIN_PLUGIN=1 \
  SMOKE_TENANT_ID=<tenant-id> \
  SMOKE_ADMIN_USER_ID=<tenant-admin-user-id> \
  SMOKE_COMPANY_BRAIN_ISSUE_KEY=1 \
  SMOKE_PLATFORM_OPERATOR_USER_ID=<platform-operator-user-id> \
  node plugins/company-brain/smoke/company-brain-plugin-smoke.mjs
```

The smoke proves catalog visibility, missing/invalid key failures, persistent
entitlement creation, substrate evidence, and the two routes users rely on:
Company Brain plugin detail and Memory / Ontology.
