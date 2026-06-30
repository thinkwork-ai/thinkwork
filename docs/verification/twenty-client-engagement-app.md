---
date: 2026-06-29
linear: THINK-109
feature: twenty-client-engagement-app
status: verified-local-authenticated
---

# Twenty Client Engagement App Verification

This document records the final integration posture for the ThinkWork Apps
surface and Twenty Client Engagement projection.

## Scope Verified

- Twenty manifest version `0.3.0` declares a launchable `client-engagement`
  `ui-surface` component with app key `twenty-client-engagement`.
- Installing or updating the Twenty plugin records the UI surface as a
  provisioned no-op plugin component. Infrastructure and MCP setup continue to
  use the existing plugin install/update flow.
- Settings remains the configuration surface. It can show the UI surface in the
  component inventory, but it does not launch the Client Engagement app.
- Apps remains the usage surface. Installed launchable app surfaces drive the
  main-shell Apps launcher and `/apps/twenty/client-engagement` route.
- CRM-owned data uses ThinkWork GraphQL operations backed by the authenticated
  Twenty plugin path. Browser variables are app inputs and record IDs, not MCP
  credentials.
- Engagement overlay fields persist through `plugin_app_overlays`, replacing
  the prototype's `localStorage` buckets.

## Local Checks

Run from the repository root:

```bash
pnpm --filter @thinkwork/api test -- src/graphql/resolvers/plugins/plugins-resolvers.test.ts src/graphql/resolvers/plugin-apps/installedPluginApps.query.test.ts src/graphql/resolvers/plugin-apps/twenty-client-engagement.test.ts src/graphql/resolvers/plugin-apps/pluginAppOverlays.test.ts
pnpm --filter @thinkwork/web test -- src/components/settings/plugins/PluginDetail.test.tsx src/components/settings/plugins/PluginsPage.test.tsx src/components/shell/ChatSidebar.test.tsx src/components/apps/PluginAppRoute.test.tsx src/components/plugin-apps/twenty-client-engagement/TwentyClientEngagementApp.test.tsx src/components/plugin-apps/twenty-client-engagement/ToolWorkspace.test.tsx src/components/plugin-apps/twenty-client-engagement/OpportunityPipeline.test.tsx src/components/plugin-apps/twenty-client-engagement/prototype-behavior.test.ts
pnpm --filter @thinkwork/api typecheck
pnpm --filter @thinkwork/web typecheck
pnpm lint:plugin-source
pnpm --filter @thinkwork/web build
```

## Browser Smoke

For worktree verification, copy the web env file before starting Vite:

```bash
cp /Users/ericodom/Projects/thinkwork/apps/web/.env apps/web/.env
pnpm --filter @thinkwork/web dev -- --host 127.0.0.1 --port 5174
```

Manual checks:

- Sidebar hides `Apps` when `installedPluginApps` returns an empty list.
- Sidebar shows `Apps` when the Twenty Client Engagement app is installed and
  launchable.
- Selecting Client Engagement opens `/apps/twenty/client-engagement` in the
  shell main content area without duplicating global chrome.
- Missing plugin activation shows the reconnect/plugin settings readiness
  action.
- The dashboard, account detail, opportunity detail, discovery tools, and
  pipeline views render without text/control overlap at desktop and narrow
  widths.
- Overlay edits remain visible after route remount.

## Deployment Note

Existing tenants with Twenty installed must update the Twenty plugin to the
latest catalog version so the `client-engagement` component row exists. Once
the update is provisioned and the user has an active Twenty plugin activation,
the Apps launcher can expose Client Engagement.

## U9 Evidence

- `pnpm --filter @thinkwork/api test -- src/graphql/resolvers/plugins/plugins-resolvers.test.ts src/graphql/resolvers/plugin-apps/installedPluginApps.query.test.ts src/graphql/resolvers/plugin-apps/twenty-client-engagement.test.ts src/graphql/resolvers/plugin-apps/pluginAppOverlays.test.ts`
  passed 49 tests.
- `pnpm --filter @thinkwork/web test -- src/components/settings/plugins/PluginDetail.test.tsx src/components/settings/plugins/PluginsPage.test.tsx src/components/shell/ChatSidebar.test.tsx src/components/apps/PluginAppRoute.test.tsx src/components/plugin-apps/twenty-client-engagement/TwentyClientEngagementApp.test.tsx src/components/plugin-apps/twenty-client-engagement/ToolWorkspace.test.tsx src/components/plugin-apps/twenty-client-engagement/OpportunityPipeline.test.tsx src/components/plugin-apps/twenty-client-engagement/prototype-behavior.test.ts`
  passed 89 tests.
- `pnpm --filter @thinkwork/api typecheck` passed.
- `pnpm --filter @thinkwork/web typecheck` passed.
- `pnpm lint:plugin-source` passed.
- `pnpm --filter @thinkwork/web build` passed with existing route test-file,
  sourcemap, and large-chunk warnings.
- Local Vite server started on `http://127.0.0.1:5174/` after copying
  `apps/web/.env`.
- In-app browser reached
  `http://localhost:5174/apps/twenty/client-engagement` in an authenticated
  shell session.
- The sidebar showed the `Apps` launcher and the main content area mounted the
  Client Engagement app with the `Client Engagement` heading.
- The authenticated local smoke reported `Client engagement data unavailable`
  with `[GraphQL] Could not load Twenty engagement data`; route discovery,
  shell mounting, and app selection were verified, while CRM data availability
  remains dependent on the local Twenty plugin/backend activation state.
