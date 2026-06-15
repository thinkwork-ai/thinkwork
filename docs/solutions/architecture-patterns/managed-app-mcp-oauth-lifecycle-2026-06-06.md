---
title: "Managed applications should reconcile MCP connectors and keep user OAuth separate"
date: 2026-06-06
category: architecture-patterns
module: twenty-managed-app
problem_type: architecture_pattern
component: authentication
severity: high
applies_when:
  - "A ThinkWork-managed application exposes tools through an MCP endpoint"
  - "Operators need deploy, park, and destroy controls for app infrastructure"
  - "End users need their own OAuth credentials for the managed app's MCP tools"
  - "Agent runtime must use the current user's app authorization without a tenant-wide fallback"
related_components:
  - terraform
  - graphql
  - spaces-settings
  - mcp-runtime
  - secrets-manager
tags:
  - managed-apps
  - twenty-crm
  - mcp
  - oauth
  - desktop
  - terraform
  - settings
  - agents
---

# Managed applications should reconcile MCP connectors and keep user OAuth separate

## Context

Twenty CRM started as an optional AWS-managed application, similar to Cognee, but it quickly became clear that a CRM is not just an infrastructure toggle. Operators need to deploy, park, redeploy, and destroy the runtime and data resources, while end users need to connect their own Twenty account before ThinkWork agents can call CRM tools on their behalf.

The important product split is:

- **Managed Applications** owns infrastructure lifecycle: deploy, park, destroy, status, evidence, health, and data-impact warnings.
- **CRM settings** owns runtime inspection and repair for the managed app, including an operator recovery action when the managed MCP registration is missing.
- **MCP Servers** owns user connection state: authenticate, reconnect, clear authentication, imported runtime tools, and visibility into whether the connector is usable by the current user.

Session history reinforced this split. Early UI iterations put deploy/configure/park/destroy actions together in compact rows, which made state changes feel invisible and put destructive operations in the wrong place. The final shape moved lifecycle into the dedicated managed-app operator page, left General Settings as a status summary with a Manage link, and kept per-user OAuth on the MCP server detail page.

## Guidance

Treat a managed app and its MCP connector as two coupled but separate state machines.

### 1. Model app lifecycle with retained state and runtime state

Do not represent a managed app with one boolean. Twenty needed at least these states:

| Provisioned | Runtime enabled | Meaning |
| ----------- | --------------- | ------- |
| false | false | Never enabled; no app resources exist |
| true | true | Runtime is running and app settings are visible |
| true | false | Runtime is parked; retained data and secrets stay in place |

The deployment runner adapter makes that explicit by mapping operations to Terraform variables:

```ts
export const twentyAdapter: ManagedAppAdapter = {
  appKey: "twenty",
  displayName: "Twenty CRM",
  buildTerraformVariables({ operation, desiredConfig }) {
    if (operation === "DESTROY") {
      return {
        twenty_provisioned: false,
        twenty_runtime_enabled: false,
      };
    }

    const runtimeEnabled = operation !== "PARK";
    return compactObject({
      twenty_provisioned: true,
      twenty_runtime_enabled: runtimeEnabled,
      twenty_image_uri: requireDigestImage(
        desiredConfig,
        "imageUri",
        "Twenty imageUri",
      ),
      twenty_db_url_secret_arn: requireStringInput(
        desiredConfig,
        "dbUrlSecretArn",
        "Twenty dbUrlSecretArn",
      ),
      twenty_encryption_key_secret_arn: requireStringInput(
        desiredConfig,
        "encryptionKeySecretArn",
        "Twenty encryptionKeySecretArn",
      ),
      twenty_public_url: requireStringInput(
        desiredConfig,
        "publicUrl",
        "Twenty publicUrl",
      ),
      twenty_certificate_arn: requireStringInput(
        desiredConfig,
        "certificateArn",
        "Twenty certificateArn",
      ),
    });
  },
};
```

That shape keeps "park but retain data" distinct from "destroy everything."

### 2. Reconcile the MCP row from the app's ready state

The managed MCP connector should be a real `tenant_mcp_servers` row, not a hidden managed-app-only config. That preserves the existing MCP runtime path, operator visibility, user auth status, and tool import behavior.

Use explicit ownership columns so the row can be protected and repaired:

```ts
management_source: text("management_source").notNull().default("manual"),
managed_application_key: text("managed_application_key"),
```

The schema also needs a uniqueness guard so a tenant can only have one managed row for a given app:

```ts
uniqueIndex("uq_tenant_mcp_servers_managed_application")
  .on(table.tenant_id, table.managed_application_key)
  .where(sql`${table.managed_application_key} IS NOT NULL`);
```

For Twenty, the canonical MCP endpoint is derived from the deployed app URL:

```ts
export function twentyMcpUrlFromApplicationUrl(applicationUrl: string): string {
  const url = new URL(applicationUrl);
  url.pathname = "/mcp";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}
```

Install and repair should go through one idempotent reconciliation path:

```ts
await reconcileTwentyManagedMcp({
  tenantId,
  application,
  mode: "running",
});
```

That path should:

- Require the app to be running and have a URL.
- Verify MCP OAuth protected-resource metadata before writing the row.
- Insert or repair a `tenant_mcp_servers` row with `auth_type="oauth"`.
- Store `auth_config: { oauth_resource: mcpUrl }`.
- Mark the row `management_source="managed_application"` and `managed_application_key="twenty-crm"`.
- Assign the row to platform default agents.
- Hash approved URL/auth config so drift is detectable.

### 3. Keep parked and destroyed behavior different

Parking should disable runtime availability without deleting user continuity:

```ts
if (mode === "parked") {
  await setManagedMcpEnabled(db, existing.id, false);
  await setManagedMcpAssignmentsEnabled(db, existing.id, false);
}
```

Destroy should remove the connector and any stored user token material:

```ts
await db.delete(userMcpTokens).where(eq(userMcpTokens.mcp_server_id, existing.id));
await db.delete(agentMcpServers).where(eq(agentMcpServers.mcp_server_id, existing.id));
await db.delete(spaceMcpServers).where(eq(spaceMcpServers.mcp_server_id, existing.id));
await db.delete(tenantMcpServers).where(eq(tenantMcpServers.id, existing.id));
```

If token secrets live in Secrets Manager, delete those secrets as part of the destroy path. Parking keeps them; destroy removes them.

### 4. Put user OAuth in MCP Servers, not Managed Applications

Managed Applications should not grow a "Configure" button for user auth. That overloaded the operator lifecycle surface and caused the desktop app to navigate into the CRM web app incorrectly during earlier iterations (session history).

The MCP server detail page should show:

- Managed ownership badge and disabled lifecycle controls for system-managed rows.
- Current user's `Connected`, `Expired`, or `Not connected` status.
- `Authenticate`, `Reconnect`, and `Clear` actions.
- Imported runtime tools with search and paging.

The browser/desktop OAuth URL should include the server id, ThinkWork user id, tenant id, and return URL:

```ts
export function buildMcpOAuthAuthorizeUrl({
  mcpServerId,
  userId,
  tenantId,
  returnTo,
}: {
  mcpServerId: string;
  userId: string;
  tenantId: string;
  returnTo: string;
}): string {
  const url = new URL("/api/skills/mcp-oauth/authorize", API_URL);
  url.searchParams.set("mcpServerId", mcpServerId);
  url.searchParams.set("userId", userId);
  url.searchParams.set("tenantId", tenantId);
  url.searchParams.set("returnTo", returnTo);
  url.searchParams.set("force", "true");
  return url.toString();
}
```

Do not store the user's Twenty token in desktop or browser durable state. The API stores it in the ThinkWork vault through `user_mcp_tokens` plus a Secrets Manager secret reference, matching the existing per-user MCP token pattern.

### 5. Never fall back to tenant-wide credentials for user-scoped MCP

For OAuth MCP servers, runtime assembly should include the connector only when the current user has an active token. If the token is missing or expired and cannot be refreshed, skip the server or show a connection-needed state. Do not introduce a shared credential just to make agent calls pass.

This is especially important for CRM. An agent fetching "my opportunities" must use the requester's Twenty authorization, not the tenant admin's authorization.

### 6. Verify with an agent-level tool call, not just health or tools/list

Health checks and `tools/list` are useful preflights, but they do not prove user credential injection. The release proof for Twenty MCP is:

1. Twenty is running at the managed URL.
2. The managed Twenty MCP row is visible in Settings -> MCP Servers.
3. The current user authenticates from desktop/web Spaces.
4. `user-mcp-servers` reports Twenty auth status as active for that user.
5. ThinkWork runtime lists Twenty tools for the assigned agent.
6. An agent/runtime MCP call fetches opportunities assigned to the authenticated user.

The smoke script encodes that progression:

```sh
SMOKE_ENABLE_TWENTY_MCP_OAUTH=1 \
  SMOKE_TWENTY_MCP_CALL=1 \
  SMOKE_TWENTY_USER_EMAIL=<twenty-user-email> \
  SMOKE_API_BASE_URL=<api-url> \
  SMOKE_COGNITO_ID_TOKEN=<current-user-id-token> \
  SMOKE_TENANT_ID=<tenant-id> \
  SMOKE_USER_ID=<user-id> \
  SMOKE_AGENT_ID=<agent-id> \
  node plugins/twenty/smoke/twenty-mcp-oauth-smoke.mjs
```

## Why This Matters

Managed apps sit at the intersection of infrastructure, product settings, runtime tools, and user identity. If those responsibilities blur, several bad failure modes appear:

- Operators see app runtime as "running" but agents cannot call tools because no MCP row exists.
- Users can see a connector but cannot tell whether their own credential is connected.
- Parking or destroying an app leaves stale tools in the runtime.
- Destroying a CRM leaves token secrets behind.
- A tenant-wide credential accidentally impersonates the wrong CRM user.
- UI status appears static after an operation, making deploy feel like it did nothing.

The Twenty implementation avoids those by making ownership explicit and making each layer responsible for one thing:

- Terraform/deployment runner owns app resources and retained data.
- GraphQL managed-app APIs own lifecycle jobs and status.
- The managed MCP reconciler owns connector creation, repair, park, and destroy behavior.
- MCP Servers owns per-user OAuth and tool visibility.
- Runtime owns current-user token injection.

## When to Apply

Apply this pattern when:

- The app is first-party or ThinkWork-managed infrastructure.
- The app has a durable runtime lifecycle that users should not manage manually.
- The app exposes an MCP endpoint that ThinkWork agents should call.
- The app requires per-user authorization for correct downstream access.
- Park/redeploy should preserve user connection continuity.
- Destroy should remove app data and associated credential material.

Do not apply it when:

- The MCP server is a normal third-party/manual connector.
- The downstream service is tenant-wide and does not need user-specific authorization.
- The app is not managed by ThinkWork infrastructure.
- You only need an operator-registered MCP row with a tenant API key.

## Examples

### Correct surface split

| Surface | Correct actions |
| ------- | --------------- |
| Settings -> General -> Managed Applications | Show Cognee/Twenty status summary and a single Manage link |
| Settings -> Managed Applications | Plan, approve, deploy, park, destroy, inspect job evidence |
| Settings -> CRM | Show app URL, health, infrastructure details, and Install MCP Server repair |
| Settings -> MCP Servers -> Twenty CRM | Authenticate current user, clear auth, inspect/import tools |

### Managed MCP row lifecycle

| App action | MCP row behavior | User token behavior |
| ---------- | ---------------- | ------------------- |
| Deploy/redeploy | Insert or repair managed row, enable assignments | Existing user tokens continue if valid |
| Park | Disable row and assignments | Keep tokens for reconnect continuity |
| Destroy | Delete row and assignments | Delete `user_mcp_tokens` rows and Secrets Manager token secrets |

### Tool import behavior

Twenty exposes a broad catalog behind wrapper tools, so the settings UI should try runtime import and expand `get_tool_catalog` when present. Cached tool lists alone can make the detail page look empty even when the runtime has usable tools.

```ts
const catalogTool = matching.find((tool) => tool.tool === "get_tool_catalog");
if (catalogTool) {
  const catalogResult = await callRuntimeMcpTool(
    runtimeAgentId,
    catalogTool.server || serverKey,
    catalogTool.tool,
  );
  const catalogTools = extractCatalogTools(catalogResult);
  if (catalogTools.length > 0) displayTools = catalogTools;
}
```

## Related

- PR #2120: `feat: add Twenty CRM Terraform module`
- PR #2126: `feat: add managed application GraphQL API`
- PR #2133: `feat: add Twenty CRM lifecycle actions`
- PR #2152: `fix(spaces): deploy Twenty CRM from General settings`
- PR #2162: `feat: add managed MCP ownership schema`
- PR #2164: `feat: reconcile Twenty managed MCP server`
- PR #2167: `feat: support desktop MCP OAuth`
- PR #2168: `feat: protect managed MCP server rows`
- PR #2170: `feat: expose managed MCP auth status`
- PR #2172: `feat: add managed app deployment adapters`
- PR #2174: `feat: add managed application deployment UX`
- PR #2176: `feat: prove Twenty MCP OAuth runtime path`
- [Twenty CRM invitations need SES SMTP configuration at deployment time](../integration-issues/twenty-crm-email-ses-config-2026-06-06.md) — follow-up integration issue discovered after the main app/MCP path worked.
- [OAuth client credentials in AWS Secrets Manager](../best-practices/oauth-client-credentials-in-secrets-manager-2026-04-21.md) — shared OAuth client secrets belong in Secrets Manager, but per-user MCP tokens use the `user_mcp_tokens` pattern instead.
- [oauth-authorize bound OAuth connections to the wrong user in multi-user tenants](../logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md) — relevant caution for any per-user OAuth flow: never resolve by tenant alone.
- [MCP custom domain setup](../patterns/mcp-custom-domain-setup-2026-04-23.md) — related custom-domain/DNS lesson for MCP endpoints.
