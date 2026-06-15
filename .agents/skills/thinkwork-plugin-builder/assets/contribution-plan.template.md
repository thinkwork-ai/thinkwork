# ThinkWork Plugin Contribution Plan

## Source Inventory

- Terraform roots:
- Providers:
- Backend/state:
- Resource categories:
- Required inputs:
- Secret references:
- Outputs/endpoints:
- Lifecycle risks:

## Plugin Shape

- Plugin key:
- Display name:
- Premium entitlement product key:
- Install-key prompt:
- Components:
- Customer-facing copy:
- Internal implementation names:

## Planned Repo Changes

- `plugins/<plugin-key>/package.json`
- `plugins/<plugin-key>/tsconfig.json`
- `plugins/<plugin-key>/README.md`
- `plugins/<plugin-key>/src/index.ts`
- `plugins/<plugin-key>/src/manifest.ts`
- `packages/plugin-catalog/src/plugins/index.ts`
- `packages/plugin-catalog/src/__tests__/<plugin-key>-manifest.test.ts`
- Adapter follow-up paths if required:

## Before Changing Files

- [ ] Terraform inventory is complete.
- [ ] Human-only decisions are resolved or explicit assumptions are recorded.
- [ ] Adapter fit or adapter gap is documented.
- [ ] Raw tfvars, state, credentials, and customer environment values are
      excluded.
- [ ] Maintainer can see why each planned file is needed.

## Validation Plan

- Manifest validation:
- Manifest-specific tests:
- Catalog build/sign:
- Premium entitlement review:
- Install/provision smoke:

## Maintainer Decision

- [ ] Ready for catalog implementation.
- [ ] Blocked on adapter work.
- [ ] Smaller first slice recommended.
