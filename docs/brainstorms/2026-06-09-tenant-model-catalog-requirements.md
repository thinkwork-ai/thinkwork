---
date: 2026-06-09
topic: tenant-model-catalog
---

# Tenant Model Catalog

## Problem Frame

Tenant admins need a Settings surface for governing which Bedrock LLM models are
available in their tenant. Today ThinkWork has a model catalog that powers model
selection, approvals, validation, and cost attribution, but the catalog is not a
tenant-admin-managed product surface. Admins need to see configured models,
understand provider/model IDs/costs, enable or disable models, and import new
models from AWS Bedrock without hand-entering pricing.

The first version should make the tenant catalog trustworthy: AWS remains the
source of model metadata and token pricing, while tenant admins control the
display name and whether a model is enabled for their tenant.

---

## Actors

- A1. Tenant admin: reviews, imports, names, enables, and disables models for
  their tenant.
- A2. Tenant user: indirectly receives model choices constrained by the tenant
  catalog and any user-level model approvals.
- A3. ThinkWork runtime and cost recorder: validates model availability and uses
  stored token prices for cost attribution.
- A4. AWS Bedrock and AWS Price List APIs: provide model metadata and official
  price data for import.

---

## Key Flows

- F1. Admin reviews configured tenant models
  - **Trigger:** A tenant admin opens Settings -> Model Catalog.
  - **Actors:** A1, A3
  - **Steps:** The page loads configured tenant models in a DataTable. Each row
    shows provider, display name, Bedrock model ID, input/output token cost,
    capability hints when available, enabled status, and pricing/import health.
    The admin can search or scan the table and toggle model availability when
    the model is eligible.
  - **Outcome:** The admin understands which models are configured and which are
    usable by the tenant.
  - **Covered by:** R1, R2, R3, R4

- F2. Admin imports models from AWS Bedrock
  - **Trigger:** A tenant admin clicks the import action from the Model Catalog
    page.
  - **Actors:** A1, A4
  - **Steps:** ThinkWork lists Bedrock foundation models visible to the deployed
    AWS account and region. The import list shows model name, provider, model
    ID, modalities/capabilities when available, lifecycle status when available,
    and pricing resolution status from AWS Price List. The admin selects one or
    more models, sets or confirms display names, and imports them.
  - **Outcome:** Selected models are added to the tenant catalog. Models with
    resolved pricing may be enabled; models with missing or ambiguous pricing
    are imported disabled.
  - **Covered by:** R5, R6, R7, R8, R9, R10, R11, R12

- F3. Admin edits a model display name
  - **Trigger:** A tenant admin wants a friendlier or tenant-specific model
    name.
  - **Actors:** A1, A2
  - **Steps:** The admin edits a configured model's display name from the table
    or detail/edit affordance. ThinkWork saves the tenant-specific display name
    without changing the Bedrock model ID or provider.
  - **Outcome:** Tenant users and admins see the updated display name wherever
    the tenant catalog entry is shown.
  - **Covered by:** R13, R14

---

## Requirements

**Configured model table**

- R1. Settings must include a tenant-admin Model Catalog page that uses the
  existing settings DataTable pattern for configured models.
- R2. Each configured model row must show provider, display name, Bedrock model
  ID, input token cost, output token cost, enabled status, and pricing/import
  health.
- R3. Provider must display as Bedrock in v1, and the table should show
  capability context when available, such as context window, max output tokens,
  tool support, vision support, modalities, streaming support, or lifecycle
  status.
- R4. Tenant admins must be able to enable or disable an eligible configured
  model, except that models without resolved pricing must remain disabled.

**Bedrock import**

- R5. The page must provide an import action that opens a list of AWS Bedrock
  models available to the deployment, sourced from AWS Bedrock model metadata
  rather than a hard-coded UI list.
- R6. The import list must include enough context for informed selection:
  provider, model name, model ID, available metadata/capabilities, lifecycle
  status when available, and pricing resolution status.
- R7. Tenant admins must be able to select one or more Bedrock models to import
  and set or confirm each display name before import.
- R8. Import must deduplicate against the tenant's existing configured models and
  avoid creating duplicate catalog entries for the same Bedrock model ID in the
  same tenant.

**Pricing integrity**

- R9. Token prices for imported Bedrock text models must be populated from AWS
  Price List APIs when possible.
- R10. Imported models with resolved token pricing may be enabled during import
  or immediately after import.
- R11. Imported models with missing or ambiguous AWS pricing must be created in a
  disabled state and must not be enableable until pricing is resolved.
- R12. The UI must make pricing resolution visible so admins can distinguish
  priced, unpriced, and ambiguous pricing states.

**Display names and tenant governance**

- R13. Tenant admins must be able to edit a model's display name after import.
- R14. Editing the display name must not alter the provider, Bedrock model ID, or
  pricing source, and tenant-specific display names must be used wherever a
  friendly model name is shown.
- R15. Model availability must be tenant-scoped: enabling a model for one tenant
  must not make it available for every tenant.

**Runtime and downstream behavior**

- R16. Runtime model validation must respect tenant catalog availability before
  allowing a model to run.
- R17. Existing user-level model approvals must be constrained by the tenant
  catalog; users cannot be approved for a model that is disabled or absent for
  the tenant.
- R18. Cost attribution must use the tenant catalog's resolved token prices for
  imported models.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R4.** Given a tenant has three configured models,
  when an admin opens Settings -> Model Catalog, then the DataTable shows each
  model's provider, display name, model ID, input/output token costs, and
  enabled state.
- AE2. **Covers R5, R6, R7, R8.** Given Bedrock returns Claude, Nova, and
  Llama model metadata, when an admin clicks import, then they can select
  models from that AWS-sourced list and confirm tenant-facing display names
  before importing.
- AE3. **Covers R9, R10, R11, R12.** Given AWS Price List cannot resolve a
  selected model's token price, when the admin imports it, then the model is
  created disabled, the enabled toggle is unavailable, and the row explains that
  pricing must be resolved first.
- AE4. **Covers R13, R14.** Given an imported model is named
  `anthropic.claude-sonnet-4-20250514-v1:0`, when an admin changes its display
  name to `Claude Sonnet 4`, then tenant model selectors and settings show
  `Claude Sonnet 4` while runtime calls still use the original Bedrock model ID.
- AE5. **Covers R15, R16, R17.** Given Tenant A enables a Bedrock model and
  Tenant B has not imported it, when a Tenant B user attempts to select that
  model, then the model is unavailable and runtime validation rejects it.

---

## Success Criteria

- Tenant admins can manage their own Bedrock model catalog without asking an
  operator to edit seed data.
- Imported models carry trustworthy token prices from AWS rather than
  hand-entered guesses.
- Models with unresolved pricing are visible but safely disabled, preventing
  misleading cost reporting.
- Tenant-specific display names make model selection understandable without
  sacrificing stable Bedrock model IDs.
- Planning can proceed without inventing the tenant scope, import behavior,
  pricing failure behavior, or display-name behavior.

---

## Scope Boundaries

- This does not add non-Bedrock providers in v1.
- This does not require tenant admins to manually enter token costs when AWS
  pricing cannot be resolved.
- This does not require imported custom models, provisioned throughput pricing,
  batch pricing, fine-tuning pricing, image pricing, embedding pricing, or
  Marketplace subscription management in the first version unless planning finds
  they are necessary for the target Bedrock model class.
- This does not replace user-level model approvals; tenant catalog availability
  becomes the upstream constraint for those approvals.
- This does not define external customer billing or invoices.
- This does not require automatic periodic price refresh in v1, though the
  import path should preserve enough source metadata to support a later refresh.

---

## Key Decisions

- **Tenant-admin scope:** Model Catalog is a tenant setting, not only a global
  operator setting.
- **Provider scope:** Bedrock is the only provider in v1.
- **Pricing source:** Import should pull token pricing from AWS Price List APIs
  where possible.
- **Pricing failure behavior:** Models with missing or ambiguous pricing are
  imported disabled instead of blocked or manually priced.
- **Display-name control:** Tenant admins can set display names during import
  and edit them later.
- **No silent pricing assumptions:** Unknown prices remain unknown until
  resolved.

---

## Dependencies / Assumptions

- The repo already has a `model_catalog` table and GraphQL model catalog types
  with provider, display name, model ID, token cost, capability, and availability
  fields.
- The current catalog behavior is effectively global; tenant-scoped governance
  will require planning to decide how to adapt the data model and API surface.
- AWS Bedrock `ListFoundationModels` provides model metadata such as model ID,
  provider, name, modalities, lifecycle, and streaming support, but not token
  pricing.
- AWS Price List APIs are the intended source for programmatic pricing, but AWS
  documents that price list data is informational and public service pricing
  pages are authoritative if they differ.
- Pricing lookup may be region-sensitive and model-family-specific; planning
  should validate the exact Price List filters and matching rules against real
  Bedrock products.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R5-R12][Needs research] Which AWS Price List service codes and
  attributes reliably map Bedrock model IDs to input/output token prices for the
  target text-model set?
- [Affects R3, R6][Technical] Which Bedrock metadata fields should be shown in
  the import table versus stored only for diagnostics?
- [Affects R9-R12][Technical] What exact state model represents priced,
  unpriced, ambiguous, stale, or failed pricing resolution?
- [Affects R15-R18][Technical] What is the smallest safe migration path from the
  existing global `model_catalog` behavior to tenant-scoped governance?
- [Affects R14, R17][Technical] Which existing model selectors, approval
  sections, analytics, and trace views need to read tenant-specific display names
  and tenant catalog availability?

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
