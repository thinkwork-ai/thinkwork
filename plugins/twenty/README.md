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
- The latest manifest version also declares the `client-engagement`
  `ui-surface` component. Updating an installed Twenty plugin to that version
  records a provisioned no-op UI component; the day-to-day app launches from the
  main ThinkWork `Apps` surface, not from Settings.
- `twenty-app/` owns the native Twenty app source package. It installs as an
  application named `ThinkWork` and exposes a logic function named
  `ThinkWork Webhook` as a workflow action. Its native Settings tab includes
  a `ThinkWork Webhook` configuration form that saves the app's webhook URL and
  trigger-stage application variables.
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

## Client Engagement App Surface

Twenty contributes the first ThinkWork plugin app: **Client Engagement**. The
surface is declared in the plugin manifest as a trusted bundled React app with
route segment `client-engagement` and app key `twenty-client-engagement`.

Operational split:

- Settings remains the install, update, infrastructure, MCP, and reconnect
  surface. Operators install or update Twenty from Settings, and users reconnect
  OAuth there when readiness requires it.
- Apps is the usage surface. When the installed Twenty plugin includes the
  provisioned `client-engagement` `ui-surface` component, the main shell shows
  `Apps`, and selecting Client Engagement opens `/apps/client-engagement`.
- CRM-owned records load through ThinkWork GraphQL resolvers that call the
  authenticated Twenty plugin path on the server. Browser code must not receive
  MCP bearer tokens, tenant-wide CRM credentials, or raw MCP endpoint secrets.
- ThinkWork-owned engagement fields persist through plugin app overlay state,
  not browser `localStorage`.

Readiness expectations:

- If the app surface is not installed, it does not appear in Apps.
- If Twenty is installed but the runtime/MCP component is unavailable, the app
  route renders a readiness message with an operator settings action.
- If the current user has not connected or needs to reconnect Twenty, the app
  route renders a plugin settings action.
- Updating an older Twenty install to the latest manifest version is the
  supported path for enabling the Client Engagement app on existing tenants.
