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
catalog places it between `LastMile` and `Plane`.

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

## Verification

Dry-run checks are safe in CI:

```bash
pnpm --filter @thinkwork/plugin-n8n test
pnpm --filter @thinkwork/plugin-n8n typecheck
pnpm --filter @thinkwork/plugin-catalog check:plugins
node plugins/n8n/smoke/n8n-managed-app-smoke.mjs
node plugins/n8n/smoke/n8n-mcp-smoke.mjs
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
```

The managed-app smoke verifies public endpoint health plus main/worker service,
database, Valkey, storage, image digest, package digest, and service credential
evidence when those Terraform outputs are available. The MCP smoke lists native
n8n tools through ThinkWork's `/api/mcp` proxy and can read a configured
disposable workflow with `SMOKE_N8N_WORKFLOW_ID`.

## Teardown

Teardown must use the ThinkWork managed-application flow. Destroy is
destructive: it removes the n8n runtime substrate, dedicated database state,
queue/cache resources, storage prefix or bucket contents, runtime secrets,
service credential material, and managed MCP rows. Verification is not complete
until teardown evidence is observed through the same managed-app path.
