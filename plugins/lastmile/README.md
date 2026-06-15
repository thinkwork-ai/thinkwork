# LastMile Plugin

LastMile is a first-party MCP and skill plugin package for the THNK-31
`plugins/<plugin-key>/` source boundary.

## Package Contract

- `package.json` exposes `@thinkwork/plugin-lastmile`.
- `src/index.ts` exports `lastmilePluginPackage`.
- `src/manifest.ts` owns the LastMile catalog manifest.
- `src/discovery.fixture.ts` owns the recorded OAuth protected-resource
  metadata fixture used by drift tests.

This package currently owns the catalog manifest and discovery fixture while
LastMile smoke coverage remains in the shared smoke kit until the smoke
extension-point migration moves plugin-specific smokes behind plugin packages.
