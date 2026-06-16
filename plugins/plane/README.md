# Plane Plugin

Plane is the first THNK-31 proof plugin for the root-level
`plugins/<plugin-key>/` package contract. It is the full-shape review target for
manifest, managed-app infrastructure, MCP activation, package-local smokes,
tests, and operations material.

## Package Contract

- `package.json` exposes `@thinkwork/plugin-plane`.
- `src/index.ts` exports `planePluginPackage`, a validated
  `FirstPartyPluginPackage` with owned source descriptors and compatibility
  links.
- `src/manifest.ts` owns the Plane catalog manifest.
- `src/deployment/managed-app.ts` owns the Plane managed-app deployment
  adapter.
- `smoke/plane-managed-app-smoke.mjs` checks deployed Plane runtime health.
- `smoke/plane-mcp-smoke.mjs` checks the Plane MCP seed/read/write loop.
- `test/manifest.test.ts` keeps Plane manifest, infrastructure input, MCP auth,
  and bundled skill contracts aligned.

## Temporary Compatibility Links

The package descriptor documents the legacy Plane paths that still contain
plugin-specific source:

- `terraform/modules/app/plane` until THNK-31 U4 moves Terraform source into
  `plugins/plane/terraform/plane/`.

These links are migration debt, not shared platform ownership.

## Verification

```bash
pnpm --filter @thinkwork/plugin-plane test
pnpm --filter @thinkwork/plugin-plane typecheck
```
