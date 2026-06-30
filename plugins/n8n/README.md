# n8n Application Plugin

This package owns the ThinkWork first-party `n8n` application plugin: catalog
manifest, managed-app adapter, Terraform module, custom package image contract,
runtime wrapper files, smoke scripts, docs, and agent instructions.

## V1 Scope

- Install self-hosted n8n from Settings -> Plugins through the ThinkWork
  application-plugin flow.
- Deploy n8n queue mode with a main service plus worker service(s).
- Store n8n data in `thinkwork_n8n` on the existing ThinkWork database
  instance by default.
- Use a dedicated private managed Valkey/Redis queue.
- Build a thin wrapper image from the official n8n image when operators add
  pinned public npm packages for Code nodes in Plugin Detail settings.
- Register native instance-level n8n MCP with a tenant service credential.
- Let n8n workflows call ThinkWork agent steps through the stock HTTP Request
  and Wait nodes, using a separate inbound bridge credential.
- Use one shared native n8n operator account for v1 production activation and
  recovery.

## Explicit Non-Goals

- No n8n Cloud or n8n Enterprise deployment.
- No per-user n8n activation, SSO, or user-scoped n8n MCP credential in v1.
- No private registries, unpinned packages, semver ranges, tarballs, git
  dependencies, or arbitrary Dockerfile editing.
- No LastMile custom nodes, credentials, workflow exports, or vendor-specific
  package layer.
- No agent-driven production publish, unpublish, activation, or deactivation.
  The bundled skill instructs agents to hand those actions to the shared
  native n8n operator.

## Catalog Publication

The plugin is now catalog-published by `plugins/catalog`:

- `plugins/n8n/src/manifest.ts` exports `n8nManifest`.
- `plugins/n8n/src/index.ts` exports `n8nPluginPackage`.
- `plugins/catalog/scripts/generate-plugin-registry.ts` imports the package
  because `plugins/n8n/package.json` no longer has
  `thinkworkPlugin.catalogPublication = "deferred"`.

The catalog display name is `n8n`, so the alpha-sorted Settings -> Plugins
catalog places it with the other first-party application plugins.

## Package Boundary

- `src/manifest.ts` owns the catalog manifest and component contract.
- `src/deployment/` owns the managed-app adapter and image build contract.
- `terraform/n8n/` owns the queue-mode AWS module.
- `runtime/` owns the thin n8n wrapper image and task-runner allow-list
  template.
- `src/web/` owns package-specific web contracts for Plugin Detail settings.
- `n8n-app/` owns the native ThinkWork installed app surface for workflow and
  execution operations.
- `src/skills/` owns the `n8n-workflow-operator` skill source.
- `smoke/` owns deployed validation for the managed-app, native MCP, and bridge
  paths.
- `test/` owns package-local manifest, image, settings, and source-boundary
  checks.

## Native ThinkWork app

The n8n installed app is hosted by ThinkWork at `/apps/n8n/workflows`, using
the same trusted bundled React app launch contract as other first-party plugin
apps. n8n itself does not currently provide a Twenty-style application SDK for
adding a full native app inside the n8n editor, so the app is package-owned
source under `plugins/n8n/n8n-app` and launches from ThinkWork's main shell.

The app must use the signed-in ThinkWork session and server-mediated ThinkWork
APIs for workflow and execution data. Browser code must not collect an n8n API
key, call an unauthenticated n8n proxy, or expose write-control actions such as
activate, publish, delete, retry, or stop.

## Operator Flow

1. Install `n8n` from Settings -> Plugins.
2. Configure the required managed-app inputs for the runtime image, database
   URL/admin secrets, encryption key, operator credential, tenant MCP service
   credential, public URL, certificate, and storage bucket.
3. Optionally open the n8n Plugin Detail settings and add pinned public package
   specs, such as `lodash@4.17.21`, for Code nodes. Saving creates a reviewable
   managed-app `UPGRADE` plan; it does not mutate infrastructure directly.
4. Approve and run the managed-app deploy job through the normal ThinkWork
   controller.
5. In native n8n, enable instance-level MCP and enable MCP access on the
   workflow, project, or folder that agents may inspect.
6. Assign the `n8n--workflow-management` MCP server to the appropriate
   ThinkWork agent.
7. For n8n-to-ThinkWork agent steps, configure the separate
   `agentStepBridgeCredentialSecretArn` managed-app input. Do not reuse the
   native n8n MCP service credential; MCP auth lets ThinkWork agents call n8n,
   while the bridge credential lets n8n workflows call ThinkWork.

## Agent-Step Bridge Recipe

The v1 bridge is webhook-first and node-later. Workflow authors should build
with stock n8n nodes:

1. A Webhook or other trigger starts the n8n execution.
2. An HTTP Request node posts to ThinkWork
   `/api/integrations/n8n/agent-steps` with the bridge bearer credential,
   target `spaceId`, `agentId`, instructions, structured `input`,
   `workflowId`, `executionId`, `stepId`, `correlationId`, and the current
   n8n Wait resume URL.
3. A Wait node pauses the execution with the On webhook call resume mode. n8n
   exposes the per-execution resume URL as `$execution.resumeUrl`; pass that
   value to ThinkWork as `resumeUrl`.
4. ThinkWork creates or reuses the visible Space thread, dispatches the agent,
   holds for human input inside ThinkWork when needed, and later calls the n8n
   waiting-webhook URL with structured JSON.
5. Downstream n8n nodes branch on `status` and read `output`, `error`,
   `summary`, and `links`. They should not scrape the ThinkWork thread page.

The idempotency key is derived from tenant, workflow id, execution id,
correlation id, and step id. Retrying the same HTTP Request for the same n8n
execution and bridge step should recover or replay the existing bridge run
rather than creating duplicate ThinkWork threads. If a run expires, n8n resumes
with a structured `expired` result so the workflow can branch explicitly.

Operator runbook details live in the docs site:

- `docs/src/content/docs/applications/n8n.mdx`
- `docs/src/content/docs/applications/n8n-agent-step-bridge.mdx`

## Verification

Dry-run checks are safe in CI:

```bash
pnpm --filter @thinkwork/plugin-n8n test
pnpm --filter @thinkwork/plugin-n8n typecheck
pnpm --filter @thinkwork/plugin-catalog check:plugins
node plugins/n8n/smoke/n8n-managed-app-smoke.mjs
node plugins/n8n/smoke/n8n-mcp-smoke.mjs
node plugins/n8n/smoke/n8n-agent-step-bridge-smoke.mjs
```

Live verification must prove the ThinkWork install path after the plugin is
installed and deployed:

```bash
SMOKE_ENABLE_N8N_MANAGED_APP=1 \
  SMOKE_TENANT_ID=<tenant-id> \
  SMOKE_EVIDENCE_FILE=deploy-artifacts/n8n-managed-app-smoke.json \
  node plugins/n8n/smoke/n8n-managed-app-smoke.mjs

SMOKE_ENABLE_N8N_MCP=1 \
  SMOKE_N8N_THINKWORK_PROXY=1 \
  SMOKE_API_BASE_URL=<api-url> \
  SMOKE_COGNITO_ID_TOKEN=<operator-or-agent-user-token> \
  SMOKE_AGENT_ID=<agent-id> \
  SMOKE_N8N_INSTALL_ID=<plugin-install-id> \
  SMOKE_TENANT_ID=<tenant-id> \
  SMOKE_EVIDENCE_FILE=deploy-artifacts/n8n-mcp-smoke.json \
  node plugins/n8n/smoke/n8n-mcp-smoke.mjs

SMOKE_ENABLE_N8N_AGENT_STEP_BRIDGE=1 \
  SMOKE_N8N_MCP_URL=<n8n-mcp-url> \
  SMOKE_N8N_MCP_SERVICE_TOKEN=<n8n-service-token> \
  SMOKE_N8N_BRIDGE_TRIGGER_URL=<disposable-workflow-webhook-url> \
  SMOKE_N8N_BRIDGE_CORRELATION_ID=<unique-correlation-id> \
  SMOKE_GRAPHQL_HTTP_URL=<graphql-url> \
  SMOKE_TENANT_ID=<tenant-id> \
  SMOKE_EVIDENCE_FILE=deploy-artifacts/n8n-agent-step-bridge-smoke.json \
  node plugins/n8n/smoke/n8n-agent-step-bridge-smoke.mjs
```

The managed-app smoke verifies public endpoint health plus main/worker service,
database, Valkey, storage, image digest, package digest, and service credential
evidence when those Terraform outputs are available. The MCP smoke lists native
n8n tools through ThinkWork's `/api/mcp` proxy and can read a configured
disposable workflow with `SMOKE_N8N_WORKFLOW_ID`. The bridge smoke verifies a
disposable n8n workflow can call ThinkWork, produce bridge telemetry, create a
visible ThinkWork thread, and resume n8n with structured terminal payload
evidence.

## Teardown

Teardown must use the ThinkWork managed-application flow. Destroy is
destructive: it removes the n8n runtime substrate, dedicated database state,
queue/cache resources, storage prefix or bucket contents, runtime secrets,
service credential material, and managed MCP rows. Verification is not complete
until teardown evidence is observed through the same managed-app path.
