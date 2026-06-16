# LastMile Plugin

LastMile is a first-party MCP and skill plugin package for the THNK-31
`plugins/<plugin-key>/` source boundary. It is skill/MCP-only in this migration
and does not declare managed application infrastructure.

## Package Contract

- `package.json` exposes `@thinkwork/plugin-lastmile`.
- `src/index.ts` exports `lastmilePluginPackage` with owned source descriptors
  and compatibility links.
- `src/manifest.ts` owns the LastMile catalog manifest.
- `src/discovery.fixture.ts` owns the recorded OAuth protected-resource
  metadata fixture used by drift tests.
- `smoke/lastmile-plugin-smoke.mjs` owns the LastMile live plugin smoke.
- `test/discovery.test.ts` keeps the manifest aligned with recorded protected
  resource discovery metadata.

## Temporary Compatibility Links

The package descriptor documents the legacy LastMile path that still contains
plugin-specific source:

- `packages/api/src/lib/lastmile/tasks-adapter.ts` until THNK-31 U6 moves
  plugin-specific API helpers behind package exports.

This link is migration debt, not shared platform ownership.

## Verification

```bash
pnpm --filter @thinkwork/plugin-lastmile test
pnpm --filter @thinkwork/plugin-lastmile typecheck
```
