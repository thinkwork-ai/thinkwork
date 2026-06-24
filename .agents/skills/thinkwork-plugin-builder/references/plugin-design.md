# Plugin Design

Use the current ThinkWork Application Plugin model. Do not design a new
marketplace, sideload path, or licensing mechanism.

## Contract Sources

- Requirements: `docs/brainstorms/2026-06-12-application-plugins-requirements.md`
- Manifest contract: `packages/plugin-catalog/src/contracts.ts`
- Premium precedent:
  `docs/brainstorms/2026-06-13-company-brain-premium-plugin-requirements.md`
- Premium manifest example:
  `plugins/company-brain/src/manifest.ts`
- Infrastructure plugin example:
  `plugins/twenty/src/manifest.ts`
- Plugin package descriptor examples:
  `plugins/twenty/src/index.ts`, `plugins/lastmile/src/index.ts`

## Identity

- `pluginKey`: lowercase slug matching the catalog `SLUG_RE`.
- `displayName`: customer-facing product name.
- `description`: customer-facing value, not internal substrate details.
- Internal implementation names may appear in maintainer evidence, adapter
  review, and operator-only notes, but keep catalog copy product-centered.

For McPherson Lakehouse, "McPherson Lakehouse" is the customer-facing product.
Dagster, Glue, Iceberg, Athena, and adapter names are implementation details
unless the customer-facing product copy explicitly needs them.

## Components

Current v1 component types are closed:

- `infrastructure`: managed-app Terraform deployment through a supported adapter.
- `skills`: bundled skill folders seeded into the tenant skill catalog.
- `mcp-server`: hosted MCP endpoint, static or resolved from a managed app.
- `ui-surface`: declared-only in v1; do not imply rendering behavior.

Stop if the project needs a different component type. Record the gap instead of
extending the taxonomy in generated output.

## Premium Plugins

Use existing ThinkWork install-key semantics:

```ts
premium: {
  entitlementProductKey: "plugin-key",
  installKeyRequired: true,
  installKeyPrompt:
    "Enter the <Product> install key provided by ThinkWork to unlock this premium plugin for your tenant.",
}
```

Do not create a separate license-key system, checkout flow, billing workflow, or
customer-hosted entitlement file.

## Human Decisions

Ask only when the source cannot answer safely:

- customer-facing product name and description,
- premium install-key prompt copy,
- intended publication target,
- destructive lifecycle stance,
- whether to narrow a broad Terraform project into a first plugin slice,
- whether missing adapter work should become a follow-up issue.

When operating in autopilot or no-preference mode, use conservative defaults and
record assumptions in the contribution plan.
