# Twenty Plugin

Twenty CRM is a first-party application plugin package for the THNK-31
`plugins/<plugin-key>/` source boundary. It owns the Twenty catalog manifest,
managed-app/MCP smoke contracts, package tests, and migration notes for the
remaining infrastructure and activation source.

## Package Contract

- `package.json` exposes `@thinkwork/plugin-twenty`.
- `src/index.ts` exports `twentyPluginPackage` with owned source descriptors
  and compatibility links.
- `src/manifest.ts` owns the Twenty catalog manifest.
- `src/deployment/managed-app.ts` owns the Twenty managed-app deployment
  adapter.
- `terraform/twenty/` owns the Twenty managed-app Terraform module.
- `smoke/` owns Twenty managed-app and MCP OAuth smoke scripts.
- `test/manifest.test.ts` keeps Twenty endpoint, OAuth, infrastructure, and
  managed-app input contracts aligned.

## Temporary Compatibility Links

The package descriptor documents the legacy Twenty paths that still contain
plugin-specific source:

- `packages/api/src/lib/plugins/twenty-cutover.ts` until THNK-31 U6 moves
  plugin-specific API helpers behind package exports.

These links are migration debt, not shared platform ownership.

## Verification

```bash
pnpm --filter @thinkwork/plugin-twenty test
pnpm --filter @thinkwork/plugin-twenty typecheck
```
