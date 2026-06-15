# Plane Plugin

Plane is the first THNK-31 proof plugin for the root-level `plugins/<plugin-key>/`
package contract.

## Package Contract

- `package.json` exposes `@thinkwork/plugin-plane`.
- `src/index.ts` exports `planePluginPackage`, a validated
  `FirstPartyPluginPackage`.
- `src/manifest.ts` owns the Plane catalog manifest.
- `smoke/plane-managed-app-smoke.mjs` checks deployed Plane runtime health.
- `smoke/plane-mcp-smoke.mjs` checks the Plane MCP seed/read/write loop.

This package currently owns the catalog manifest and smoke scripts while
existing Plane deployment adapter, Terraform, and parity test source remains in
legacy shared locations until the next migration units move them behind the same
plugin boundary.
