# ThinkWork n8n app

This package owns the native ThinkWork app surface for the first-party n8n
plugin. It follows the installed plugin app route contract that Twenty uses in
the ThinkWork main shell, but it does not use `twenty-sdk`; n8n does not expose
a comparable first-party application SDK for adding a full native app inside
the n8n editor.

## Host decision

- ThinkWork hosts the app at `/apps/n8n/workflows` as a trusted bundled React
  route declared by the n8n plugin manifest.
- The app is available only after the n8n plugin is installed and the launch
  surface is returned by `installedPluginApps`.
- n8n runtime links open the managed n8n UI for native workflow inspection when
  a row has a workflow or execution URL.

## Auth and data boundary

- Browser code uses the existing ThinkWork session only.
- Workflow and execution data must be fetched through server-mediated
  ThinkWork APIs that resolve the tenant n8n credential server-side.
- The app must not ask users to paste an n8n API key, expose a direct
  unauthenticated n8n proxy, or send write-control actions such as activate,
  publish, delete, retry, or stop.
- API responses must stay redacted: no raw credentials, idempotency keys,
  callback URLs, or arbitrary execution payloads.

## Implementation sequence

1. U1 declares this host/auth contract and the manifest launch metadata.
2. U2 adds the read-only ThinkWork data API for workflows and executions.
3. U3 adds the React tables that consume that API.
