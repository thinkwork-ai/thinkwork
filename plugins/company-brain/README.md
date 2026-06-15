# Company Brain Plugin

Company Brain is a first-party premium application plugin package for the
THNK-31 `plugins/<plugin-key>/` source boundary.

## Package Contract

- `package.json` exposes `@thinkwork/plugin-company-brain`.
- `src/index.ts` exports `companyBrainPluginPackage`.
- `src/manifest.ts` owns the Company Brain catalog manifest.
- `smoke/` owns Company Brain and internal Cognee substrate smoke scripts.

This package currently owns the catalog manifest and smoke scripts while the
internal Cognee deployment adapter, Terraform, and parity test source remains in
legacy shared locations until later migration units move them behind the same
plugin boundary.
