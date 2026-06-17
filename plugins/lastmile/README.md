# LastMile Plugin

LastMile is a first-party MCP and skill plugin package for the THNK-31
`plugins/<plugin-key>/` source boundary. It is skill/MCP-only in this migration
and does not declare managed application infrastructure.

## Package Contract

- `package.json` exposes `@thinkwork/plugin-lastmile`.
- `src/index.ts` exports `lastmilePluginPackage` with owned source descriptors
  and the LastMile package contract.
- `src/manifest.ts` owns the LastMile catalog manifest.
- `src/api/tasks-adapter.ts` owns the LastMile task adapter for MCP task
  create/read/comment calls.
- `src/discovery.fixture.ts` owns the recorded OAuth protected-resource
  metadata fixture used by drift tests.
- `smoke/lastmile-plugin-smoke.mjs` owns the LastMile live plugin smoke.
- `test/discovery.test.ts` keeps the manifest aligned with recorded protected
  resource discovery metadata.

## Verification

```bash
pnpm --filter @thinkwork/plugin-lastmile test
pnpm --filter @thinkwork/plugin-lastmile typecheck
```

For deployed plugin-catalog verification, LastMile is the final practical gate:

1. Confirm the signed catalog artifact published from `plugins/lastmile` source
   contains the expected LastMile version and source commit.
2. Refresh the GitHub-backed catalog through Settings -> Plugins or wait for the
   API cache TTL, then confirm the latest verified version appears next to the
   tenant's installed pinned version.
3. Install or upgrade LastMile through ThinkWork, not by editing Terraform,
   local Docker, or vendor-side resources directly.
4. Run the package-owned smoke:

```bash
SMOKE_ENABLE_LASTMILE_PLUGIN=1 \
  node plugins/lastmile/smoke/lastmile-plugin-smoke.mjs

# After the manual OAuth consent step:
SMOKE_ENABLE_LASTMILE_PLUGIN=1 \
  node plugins/lastmile/smoke/lastmile-plugin-smoke.mjs --post-activation
```

Passing phase 2 means ThinkWork exposes `lastmile--crm`, `lastmile--tasks`, and
`lastmile--routing` for the activated user through `/api/mcp/tools/list`, while
the non-activated user remains excluded.
