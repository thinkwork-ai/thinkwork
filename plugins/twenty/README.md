# Twenty Plugin

Twenty CRM is a first-party application plugin package for the THNK-31
`plugins/<plugin-key>/` source boundary.

## Package Contract

- `package.json` exposes `@thinkwork/plugin-twenty`.
- `src/index.ts` exports `twentyPluginPackage`.
- `src/manifest.ts` owns the Twenty catalog manifest.
- `smoke/` owns Twenty managed-app and MCP OAuth smoke scripts.

This package currently owns the catalog manifest and smoke scripts while the
existing Twenty deployment adapter, Terraform, and parity test source remains in
legacy shared locations until later migration units move them behind the same
plugin boundary.
