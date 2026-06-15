# Publication Checklist

Complete this checklist before handing a generated plugin contribution to a
ThinkWork maintainer.

## Required Checks

- Plugin source lives under `plugins/<plugin-key>/`.
- `plugins/<plugin-key>/package.json` exposes
  `@thinkwork/plugin-<plugin-key>`.
- `plugins/<plugin-key>/src/index.ts` exports a package descriptor with
  matching `packageKey` and `sourceRoot`.
- Manifest validates with `validatePluginManifest`.
- Package descriptor is registered in
  `packages/plugin-catalog/src/plugins/index.ts`.
- Manifest-specific tests cover:
  - registration,
  - premium metadata when present,
  - component shape,
  - customer-facing copy versus internal implementation names,
  - adapter key and required Terraform inputs for infrastructure components.
- Catalog build/sign step is identified and run when available.
- Premium entitlement review is complete:
  - `entitlementProductKey`,
  - `installKeyRequired: true`,
  - customer-facing install-key prompt,
  - no separate licensing mechanism.
- Infrastructure adapter fit is documented:
  - existing adapter fit,
  - new adapter required,
  - or smaller first slice recommended.
- Install/provision smoke expectations are named.
- Operator review notes identify assumptions, secrets, lifecycle risks, and
  deferred follow-up work.
- Raw tfvars, state, credentials, account IDs, and customer environment values
  are excluded from committed artifacts.

## Handoff Outcome

End with one:

- Ready for catalog implementation.
- Blocked on adapter work.
- Smaller first slice recommended.

Include enough evidence for the maintainer to agree or redirect without
re-running the whole intake.
