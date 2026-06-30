---
date: 2026-06-30
linear: THINK-113
status: active
---

# n8n ThinkWork Native App Install Runbook

This runbook verifies the ThinkWork-hosted n8n native app at
`/apps/n8n/workflows`. The app is bundled with ThinkWork Web; there is no
separate n8n-side publish/install step like the Twenty private app flow.

## Surface Split

- Settings -> Plugins -> n8n installs and configures the managed runtime.
- Settings -> Plugins -> n8n also owns custom Code node package settings.
- `/apps/n8n/workflows` is the installed app for read-only workflow and
  execution inspection.
- Native n8n remains the owner for production activation, publish, retry, stop,
  delete, credential, operator-account, and package-runtime actions.

## Prerequisites

1. Install `n8n` from Settings -> Plugins.
2. Deploy the managed n8n app through the ThinkWork managed-application flow.
3. Configure the server-side tenant `n8n-api` credential for read-only workflow
   and execution discovery.
4. Sign in as an operator who can read `installedPluginApps` and `n8nAppData`.
5. For bridge evidence, run or identify a disposable n8n workflow execution that
   called ThinkWork through the agent-step bridge.

## Dry-Run Preflight

Run the sync preflight locally or in CI. It validates the bundled app package
and prints required live inputs without mutating ThinkWork or n8n:

```bash
node plugins/n8n/scripts/sync-thinkwork-app.mjs
```

Expected result:

- `ok: true`
- `mode: "dry-run"`
- `route: "/apps/n8n/workflows"`
- required package files under `plugins/n8n/n8n-app` are present

## Deployed App Verification

After deploy, run apply mode with ThinkWork GraphQL credentials. Apply mode
does not publish, install, activate, or modify workflows; it verifies that the
deployed ThinkWork app returns the n8n application and app data.

```bash
THINKWORK_PUBLIC_URL=https://app.example.com \
SMOKE_N8N_INSTALL_ID=<plugin-install-id> \
SMOKE_COGNITO_ID_TOKEN=<operator-id-token> \
node plugins/n8n/scripts/sync-thinkwork-app.mjs --apply
```

Acceptable auth alternatives are `API_AUTH_SECRET`, `THINKWORK_API_SECRET`, or
`GRAPHQL_API_KEY`, depending on the target environment.

## Integrated App Smoke

Run dry-run first:

```bash
node plugins/n8n/smoke/n8n-integrated-app-smoke.mjs
```

Run live mode only after the managed n8n app is deployed:

```bash
SMOKE_ENABLE_N8N_INTEGRATED_APP=1 \
SMOKE_THINKWORK_URL=https://app.example.com \
SMOKE_N8N_INSTALL_ID=<plugin-install-id> \
SMOKE_COGNITO_ID_TOKEN=<operator-id-token> \
SMOKE_EVIDENCE_FILE=deploy-artifacts/n8n-integrated-app-smoke.json \
node plugins/n8n/smoke/n8n-integrated-app-smoke.mjs
```

To require bridge-linked evidence from a disposable bridge run, add:

```bash
SMOKE_N8N_BRIDGE_THREAD_ID=<thinkwork-thread-id>
```

## Evidence Required

Record these in Linear before marking verification complete:

- app route screenshot or browser proof for `/apps/n8n/workflows`;
- integrated app smoke output or evidence URI;
- workflow count and execution count from `n8nAppData`;
- bridge-linked execution count, or the reason bridge evidence was not supplied;
- managed-app smoke evidence for runtime readiness;
- confirmation that teardown, when required, used the ThinkWork managed-app flow.

Do not paste n8n API keys, bearer tokens, bridge credentials, callback URLs, raw
execution payloads, or resolved IP addresses into Linear, GitHub comments, or
repo files.
