# LastMile Plugin

LastMile is a first-party MCP and skill plugin package for the THNK-31
`plugins/<plugin-key>/` source boundary.

## Package Contract

- `package.json` exposes `@thinkwork/plugin-lastmile`.
- `src/index.ts` exports `lastmilePluginPackage`.
- `src/manifest.ts` owns the LastMile catalog manifest.
- `src/discovery.fixture.ts` owns the recorded OAuth protected-resource
  metadata fixture used by drift tests.
- `smoke/lastmile-plugin-smoke.mjs` owns the LastMile live plugin smoke.

This package owns the catalog manifest, discovery fixture, and live plugin
smoke.
