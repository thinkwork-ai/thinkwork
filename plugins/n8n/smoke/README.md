# n8n Smoke Scripts

These scripts verify the ThinkWork-managed n8n application path. They default
to dry-run mode so CI and deploy workflows can record the expected live inputs
without requiring tenant secrets.

## Managed App Runtime

```bash
node plugins/n8n/smoke/n8n-managed-app-smoke.mjs
```

Set `SMOKE_ENABLE_N8N_MANAGED_APP=1` after the plugin is installed and deployed
to verify runtime evidence, service outputs, and the public n8n health path.

## Native n8n MCP

```bash
node plugins/n8n/smoke/n8n-mcp-smoke.mjs
```

Set `SMOKE_ENABLE_N8N_MCP=1` to verify native n8n MCP tool discovery and safe
workflow read operations through either the ThinkWork proxy path or direct n8n
MCP diagnostics.

## Agent-Step Bridge

```bash
node plugins/n8n/smoke/n8n-agent-step-bridge-smoke.mjs
```

Set `SMOKE_ENABLE_N8N_AGENT_STEP_BRIDGE=1` to prove the deployed n8n ->
ThinkWork -> n8n bridge path. The preferred live setup is a disposable n8n
workflow using stock nodes:

1. A Webhook or other trigger starts the smoke workflow.
2. An HTTP Request node calls ThinkWork's
   `/api/integrations/n8n/agent-steps` endpoint with the tenant bridge
   credential.
3. A Wait node uses On webhook call and passes `$execution.resumeUrl` to
   ThinkWork.
4. Downstream nodes branch on the resumed `status`, `output`, `error`,
   `summary`, and `links` payload.

Typical live env:

```bash
SMOKE_ENABLE_N8N_AGENT_STEP_BRIDGE=1 \
SMOKE_N8N_MCP_URL=https://n8n.example.com/mcp-server/http \
SMOKE_N8N_MCP_SERVICE_TOKEN="$N8N_MCP_SERVICE_TOKEN" \
SMOKE_N8N_BRIDGE_TRIGGER_URL="https://n8n.example.com/webhook/..." \
SMOKE_N8N_BRIDGE_CORRELATION_ID="bridge-smoke-$(date +%s)" \
SMOKE_GRAPHQL_HTTP_URL="$GRAPHQL_HTTP_URL" \
SMOKE_TENANT_ID="$TENANT_ID" \
API_AUTH_SECRET="$API_AUTH_SECRET" \
SMOKE_EVIDENCE_FILE=deploy-artifacts/n8n-agent-step-bridge-smoke.json \
node plugins/n8n/smoke/n8n-agent-step-bridge-smoke.mjs
```

The smoke records the n8n workflow/execution, ThinkWork bridge run, ThinkWork
thread, resume status, compact result fields, and evidence URI when configured.
It never prints or persists bridge bearer tokens, n8n MCP tokens, raw resume
URLs, or resolved IP addresses.

## Integrated ThinkWork App

```bash
node plugins/n8n/smoke/n8n-integrated-app-smoke.mjs
```

Set `SMOKE_ENABLE_N8N_INTEGRATED_APP=1` after the plugin is installed and the
managed n8n runtime is deployed. The live smoke verifies the ThinkWork-hosted
app path:

1. `installedPluginApps` returns `n8n-workflow-operations` at
   `/apps/n8n/workflows`.
2. `n8nAppData` returns workflow readiness and workflow table rows.
3. `n8nAppData` returns execution readiness and bounded execution table rows.
4. Bridge-linked execution evidence is present when
   `SMOKE_N8N_BRIDGE_THREAD_ID` is supplied.

Typical live env:

```bash
SMOKE_ENABLE_N8N_INTEGRATED_APP=1 \
SMOKE_THINKWORK_URL=https://app.example.com \
SMOKE_N8N_INSTALL_ID=<plugin-install-id> \
SMOKE_COGNITO_ID_TOKEN=<operator-id-token> \
SMOKE_EVIDENCE_FILE=deploy-artifacts/n8n-integrated-app-smoke.json \
node plugins/n8n/smoke/n8n-integrated-app-smoke.mjs
```

The smoke records readiness states, row counts, sample workflow/execution ids,
and bridge-linked counts. It does not print n8n API keys, bearer tokens, raw
execution payloads, bridge credentials, or callback URLs.
