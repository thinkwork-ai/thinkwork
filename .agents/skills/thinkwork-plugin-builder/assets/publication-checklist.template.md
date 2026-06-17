# Plugin Publication Checklist

## Manifest and Catalog

- [ ] Plugin source lives under `plugins/<plugin-key>/`.
- [ ] `package.json` exposes `@thinkwork/plugin-<plugin-key>`.
- [ ] `src/index.ts` exports a package descriptor with matching `packageKey`,
      `sourceRoot`, and manifest.
- [ ] Manifest validates with `validatePluginManifest`.
- [ ] Package descriptor is discoverable by
      `packages/plugin-catalog/scripts/generate-plugin-registry.ts`; any needed
      plugin-catalog workspace dependency change is called out separately.
- [ ] Manifest-specific tests pass.
- [ ] Catalog build/sign verification is run or documented for maintainer handoff.

## Premium Review

- [ ] `premium.entitlementProductKey` is slug-safe and product-scoped.
- [ ] `premium.installKeyRequired` is `true`.
- [ ] `premium.installKeyPrompt` is customer-facing ThinkWork install-key copy.
- [ ] No separate licensing, billing, or checkout mechanism is introduced.

## Infrastructure Review

- [ ] Infrastructure component uses a supported managed-app adapter key.
- [ ] Or an adapter-gap review is attached instead of an invalid manifest.
- [ ] Terraform input contracts exclude raw tfvars and credentials.
- [ ] Lifecycle/data-impact risks are named.
- [ ] Install/provision smoke expectations are named.

## Handoff

- [ ] Assumptions are explicit.
- [ ] Follow-up platform work is named.
- [ ] Customer-specific values are excluded or sanitized.
- [ ] Outcome is one of: ready for catalog implementation, blocked on adapter
      work, smaller first slice recommended.
