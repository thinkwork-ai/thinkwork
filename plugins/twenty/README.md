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
- `src/api/cutover.ts` owns the Twenty MCP cutover orchestration contract.
- `twenty-app/` owns the native Twenty app source package. It installs as an
  application named `ThinkWork` and exposes a logic function named
  `ThinkWork Webhook` as a workflow action.
- `terraform/twenty/` owns the Twenty managed-app Terraform module.
- `smoke/` owns Twenty managed-app and MCP OAuth smoke scripts.
- `test/manifest.test.ts` keeps Twenty endpoint, OAuth, infrastructure, and
  managed-app input contracts aligned, including the presence of the native
  Twenty app package.

## Verification

```bash
pnpm --filter @thinkwork/plugin-twenty test
pnpm --filter @thinkwork/plugin-twenty typecheck
```

The native Twenty app is intentionally a nested Twenty/Yarn project, not a
pnpm workspace package. See `twenty-app/README.md` for dry-run and sync
instructions, or use `plugins/twenty/scripts/sync-thinkwork-app.mjs` from the
guarded deploy workflow path.

The workflow wiring is also explicit and guarded. The target Twenty workflow
must call the native `ThinkWork -> ThinkWork Webhook` action instead of the
built-in `HTTP_REQUEST` action, with the webhook URL and trigger stage coming
from the installed ThinkWork app settings.
