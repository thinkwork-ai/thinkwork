---
title: "Model Catalog import end-to-end verification"
date: 2026-06-09
status: active
---

# Model Catalog Import End-to-End Verification

This runbook proves the tenant Model Catalog path from AWS Bedrock import
through tenant availability, user approvals, display names, cost/trace labels,
and runtime rejection of disabled models.

Use the normal merge/deploy pipeline before live verification. Do not manually
mutate production resources outside approved tenant setup.

## Preconditions

1. The target stage is deployed from a commit containing the tenant model catalog
   schema, GraphQL resolvers, Settings UI, downstream tenant gating, and Lambda
   IAM permissions.
2. The `graphql-http` Lambda role has:
   - `bedrock:ListFoundationModels`
   - `pricing:DescribeServices`
   - `pricing:GetAttributeValues`
   - `pricing:GetProducts`
3. The AWS account has Bedrock model access for at least one model you will
   import and run.
4. You can sign in as a tenant admin and as a tenant user.

## Local automated proof

Run these checks from the repository root for a code-level regression pass:

```bash
pnpm --filter @thinkwork/api exec vitest run \
  src/graphql/resolvers/tenant-agent/tenantModelCatalog.resolver.test.ts \
  src/graphql/resolvers/agent-profiles/agentProfiles.resolver.test.ts \
  src/lib/__tests__/resolve-agent-runtime-config.test.ts \
  src/graphql/resolvers/evaluations/index.test.ts

pnpm --filter @thinkwork/web test -- \
  src/components/settings/SettingsModelCatalog.test.tsx \
  src/components/settings/UserModelsSection.test.tsx \
  src/components/settings/SettingsActivityThreadDetail.test.tsx \
  src/components/settings/SettingsAnalytics.test.tsx \
  src/components/settings/SettingsAgents.test.tsx
```

## Live verification

### 1. Load AWS import candidates

1. Open Settings -> Model Catalog.
2. Click **Import**.
3. Confirm the candidate list loads from AWS Bedrock.
4. Confirm each candidate shows provider, name, model ID, capability context,
   lifecycle/import state, and pricing status.

Expected result: AWS permission failures surface as a clear import-candidate
error instead of an empty list.

### 2. Import a priced model enabled

1. Choose a candidate with `pricingStatus = resolved`.
2. Set a short display name, for example `Haiku verification`.
3. Keep the enable control on.
4. Import the candidate.
5. Return to the configured-model table.

Expected result: the row appears with provider `Bedrock`, the tenant display
name, the immutable Bedrock model ID, input/output token prices, and enabled
state.

### 3. Import an unresolved model disabled

1. Choose a candidate with `pricingStatus = missing`, `ambiguous`, or `error`.
2. Import it.
3. Open the row details dialog.

Expected result: the tenant row exists but is disabled. The details dialog shows
the pricing state and diagnostics. The row cannot be enabled until pricing is
resolved.

If the live AWS catalog currently has no unresolved candidate, verify this path
with the resolver fixture tests and record that the live account did not expose
an unresolved row on this date.

### 4. Edit display name without changing runtime identity

1. Click the priced model row.
2. Change the display name.
3. Save.
4. Reopen the row details.

Expected result: the display name changes. Provider, model ID, canonical name,
pricing source, and token prices remain unchanged.

### 5. Verify user approval constraints

1. Open Settings -> Humans or the model approval surface for a tenant user.
2. Confirm the enabled priced model is approvable.
3. Confirm the disabled unresolved model is absent or cannot be approved.
4. Approve the enabled priced model for the tenant user.

Expected result: user approvals are downstream of tenant model availability.

### 6. Verify model selectors use tenant display names

1. Open Settings -> Agents.
2. Open the platform agent/default model selector.
3. Confirm enabled tenant catalog rows appear using tenant display names.
4. Confirm disabled tenant catalog rows are absent.

Expected result: model selectors do not expose globally seeded models unless the
tenant catalog enables them.

### 7. Verify runtime accepts enabled model

1. Start a thread as the approved user using the enabled imported model or a
   profile that references it.
2. Wait for the turn to complete.
3. Open Settings -> Activity -> the new thread.
4. Inspect trace/cost displays.

Expected result: runtime payloads use the Bedrock model ID, while Settings
labels use the tenant display name where friendly labels are shown. Token and
cost evidence are present for the turn.

### 8. Verify runtime rejects disabled model

1. Disable the priced model in Settings -> Model Catalog.
2. Attempt to create or update an agent profile that references that model, or
   start an eval run with that model override.

Expected result: the API rejects the model with a tenant-catalog availability
message. It does not silently fall back to a globally available model.

### 9. Cleanup

1. Re-enable any model needed for normal tenant operation.
2. Remove temporary user approvals or restore them to their pre-test state.
3. Restore display names if the tenant uses production-facing labels.
4. Record the stage, commit SHA, imported model IDs, and any AWS pricing
   ambiguity in the verification notes.

## Evidence to capture

- Screenshot of the configured table with the imported priced model.
- Screenshot of an unresolved-pricing details dialog or a note that no live
  unresolved candidate was exposed.
- Screenshot of user approval constraints.
- Trace/activity screenshot showing tenant display name plus raw model ID
  evidence.
- API error text for the disabled-model rejection path.
