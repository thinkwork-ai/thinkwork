# n8n Application Plugin

This package is the source boundary for the THNK-50 n8n Application Plugin.
The U1 scaffold is intentionally not catalog-published yet: the final manifest
will be published after the real n8n managed-app adapter and tenant service
credential MCP auth mode exist.

## V1 Scope

- Deploy self-hosted n8n through ThinkWork's Application Plugin installer and
  managed-app deployment runner.
- Default the public runtime URL to `n8n.[thinkwork domain]`.
- Use queue mode with one main service plus worker service(s).
- Store n8n data in `thinkwork_n8n` on the existing ThinkWork database
  instance.
- Use a dedicated private managed Valkey/Redis queue.
- Own a thin wrapper image based on the official n8n image for pinned public
  Code node npm packages.
- Register native instance-level n8n MCP through a tenant service credential.
- Preserve human production activation through the native shared n8n operator
  account.

## Explicit Non-Goals

- No LastMile custom nodes, credentials, workflow exports, or vendor-specific
  package layer.
- No n8n Cloud or n8n Enterprise deployment.
- No per-user n8n activation, SSO, or user-scoped n8n MCP credential in v1.
- No private registries, unpinned packages, semver ranges, tarballs, git
  dependencies, or arbitrary Dockerfile editing.
- No hard publish/unpublish MCP tool filtering in v1. Agent instructions will
  tell agents to leave production activation to the shared n8n operator.

## Publication Gates

The package has `thinkworkPlugin.catalogPublication = "deferred"` in
`package.json` so the generated first-party plugin registry skips it until the
catalog contract is truthful.

U7 removes that deferral and publishes the final manifest after:

- U2 registers the real `n8n` managed-app adapter.
- U5 adds the tenant service credential MCP auth contract.
- U6 adds the Plugin Detail package settings path.

## Verification

For the scaffold slice:

```bash
pnpm --filter @thinkwork/plugin-n8n test
pnpm --filter @thinkwork/plugin-n8n typecheck
node --test scripts/__tests__/verify-plugin-source-boundary.test.mjs
node scripts/verify-plugin-source-boundary.mjs
```
