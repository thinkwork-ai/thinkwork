# Catalog Contribution

Use this reference when preparing files for the ThinkWork monorepo.

## Required Repo Targets

- Add a root plugin package under `plugins/<plugin-key>/`.
- Include `package.json`, `tsconfig.json`, `README.md`, `src/index.ts`, and
  `src/manifest.ts`.
- Export `<camelPluginKey>PluginPackage` from `src/index.ts` with
  `packageKey`, `sourceRoot: "plugins/<plugin-key>"`, and `manifest`.
- Add the plugin package dependency and registration in
  `packages/plugin-catalog/src/plugins/index.ts`.
- Add manifest-specific tests under `packages/plugin-catalog/src/__tests__/`
  or plugin-package-local tests when they do not need catalog aggregation.
- Use `validatePluginManifest` in tests.
- Run package tests and catalog build/sign verification when available.

Do not add a general scaffold generator unless the task explicitly asks for
one. V1 plugin packages are hand-authored TypeScript with tests.

## Manifest Rules

- Keep `pluginKey`, component keys, skill slugs, and entitlement keys slug-safe.
- Use semver for versions.
- Use only supported component types:
  `mcp-server`, `skills`, `infrastructure`, `ui-surface`.
- For static OAuth MCP servers, declare non-empty `requiredOauthScopes`.
- For per-instance OAuth, use `endpointFrom` and `auth: { mode:
"oauth-per-instance" }` only when an infrastructure component creates the
  tenant-specific endpoint source.
- Supporting file paths for bundled skills must be relative to the skill folder,
  never absolute and never `..`.
- UI surfaces are declared-only in v1.

## Tests to Imitate

- `packages/plugin-catalog/src/__tests__/contracts.test.ts`
- `packages/plugin-catalog/src/__tests__/company-brain-manifest.test.ts`
- `packages/plugin-catalog/src/__tests__/twenty-manifest.test.ts`
- `packages/plugin-catalog/src/__tests__/build-catalog.test.ts`
- `packages/plugin-catalog/src/__tests__/plugin-package.test.ts`
- `plugins/plane/src/index.ts`

Test customer-facing copy separately from internal implementation details when
the plugin wraps an internal substrate.

## Validation Commands

Prefer the commands already used by the repo or package:

- `pnpm --filter @thinkwork/plugin-catalog test`
- `pnpm --filter @thinkwork/plugin-catalog typecheck`
- `pnpm --filter @thinkwork/plugin-catalog build:catalog`

If a customer repo does not have these commands, record validation as maintainer
handoff rather than inventing local scripts.
