export const pluginSourceBoundaryAllowlist = [];

export const sharedPluginTermAllowlist = [
  {
    path: "plugins/twenty/scripts/migrate-lastmile.ts",
    reason:
      "one-off TEI data migration owned by the Twenty plugin; LastMile is the data SOURCE it reads, not the owning plugin.",
  },
  {
    path: "plugins/twenty/scripts/lib/lastmile-reader.ts",
    reason:
      "read-only LastMile Postgres reader used by the Twenty plugin's TEI migration script.",
  },
  {
    path: "plugins/twenty/scripts/purge-lastmile-import.ts",
    reason:
      "reset helper for the Twenty plugin's TEI migration; LastMile is the data SOURCE it clears, not the owning plugin.",
  },
  {
    path: "apps/cli/__tests__/terraform-n8n-fixture.test.ts",
    reason:
      "CLI structural fixture coverage validates plugin-owned Terraform packaging from the platform bundle.",
  },
  {
    path: "scripts/release/__tests__/n8n-runtime-base-image.test.ts",
    reason:
      "release infrastructure invariant keeps the n8n runtime Dockerfile and release workflow on an MCP-capable base image.",
  },
  {
    path: "apps/cli/__tests__/terraform-twenty-fixture.test.ts",
    reason:
      "CLI structural fixture coverage validates plugin-owned Terraform packaging from the platform bundle.",
  },
  {
    path: "apps/web/src/routes/_authed/settings.plugins.data-integrations.tsx",
    reason:
      "legacy settings URL redirect only; Company ETL UI source is owned by the canonical company-etl plugin detail.",
  },
  {
    path: "packages/database-pg/src/schema/email-channel.ts",
    reason:
      "shared platform schema for existing email reply tokens; THNK-35 U2 expands it generically for channel state.",
  },
  {
    pathPrefix: "packages/api/src/graphql/resolvers/email-channel/",
    reason:
      "shared platform GraphQL API for the Email Channel plugin control plane.",
  },
  {
    pathPrefix: "packages/api/src/lib/email-channel/",
    reason:
      "shared platform provider adapter service for the Email Channel plugin runtime path.",
  },
  {
    pathPrefix: "apps/web/src/components/settings/plugins/email-channel/",
    reason:
      "shared plugin settings shell renders the Email Channel plugin control plane.",
  },
  {
    path: "packages/database-pg/__tests__/migration-0170-email-channel-plugin.test.ts",
    reason: "Email Channel plugin database contract coverage.",
  },
  {
    path: "packages/database-pg/__tests__/migration-0188-company-etl-plugin-rename.test.ts",
    reason:
      "Company ETL plugin-key rename database migration contract coverage.",
  },
  {
    path: "packages/database-pg/graphql/types/n8n-app-data.graphql",
    reason:
      "shared platform GraphQL contract for the n8n plugin App UI (workflows/executions viewing); native app runtime and manifest source remain package-owned under plugins/n8n.",
  },
  {
    path: "packages/database-pg/graphql/types/email-channel.graphql",
    reason:
      "shared platform GraphQL contract for the Email Channel plugin control plane.",
  },
  {
    path: "packages/api/src/graphql/resolvers/plugins/n8n-settings.ts",
    reason:
      "shared platform GraphQL control surface for n8n package settings; validation and runtime policy are package-owned under plugins/n8n.",
  },
  {
    path: "packages/api/src/graphql/resolvers/plugins/n8n-settings.test.ts",
    reason:
      "shared platform GraphQL control-surface coverage for n8n package settings; package-specific validation is imported from plugins/n8n.",
  },
  {
    path: "packages/api/src/graphql/resolvers/plugins/n8n-app-data.ts",
    reason:
      "shared platform GraphQL read API for the n8n plugin app; native app runtime and manifest source remain package-owned under plugins/n8n.",
  },
  {
    path: "packages/api/src/graphql/resolvers/plugins/n8n-app-data.test.ts",
    reason:
      "shared platform GraphQL read API coverage for the n8n plugin app; native app runtime and manifest source remain package-owned under plugins/n8n.",
  },
  {
    path: "packages/api/src/lib/memory-sources/adapters/twenty.ts",
    reason:
      "platform memory-source adapter (THINK-193): normalizes Twenty CRM records into the source-agnostic evidence/dossier contract consumed by the memory-stage worker; the adapter seam is platform-owned like the other source families, while plugin runtime and manifest source remain under plugins/twenty.",
  },
  {
    path: "terraform/modules/app/agentcore-identity/scripts/bootstrap_twenty_oauth_client.sh",
    reason:
      "shared AgentCore Identity Terraform module must ship its apply-time Twenty confidential-client bootstrap inside the registry module; the Twenty application runtime remains plugin-owned.",
  },
  {
    path: "terraform/modules/app/agentcore-identity/scripts/delete_twenty_identity.sh",
    reason:
      "shared AgentCore Identity Terraform module owns teardown of the provider it provisions; keeping the destroy helper module-local preserves registry-module lifecycle integrity.",
  },
  {
    path: "terraform/modules/app/agentcore-identity/scripts/reconcile_twenty_identity.sh",
    reason:
      "shared AgentCore Identity Terraform module owns its provider reconciliation lifecycle and must package the local-exec helper with the registry module.",
  },
  {
    path: "terraform/modules/app/agentcore-identity/scripts/reconcile_twenty_provider.mjs",
    reason:
      "shared AgentCore Identity Terraform module owns the AWS provider adapter invoked by its module-local reconciler; Twenty application runtime source remains under plugins/twenty.",
  },
  {
    path: "packages/api/src/lib/memory-sources/adapters/twenty.test.ts",
    reason: "unit tests for the platform Twenty memory-source adapter above.",
  },
  {
    path: "packages/api/src/lib/memory-sources/adapters/twenty-adapter.ts",
    reason:
      "platform MemorySourceAdapter registration for Twenty (THINK-193 U5): the family-dispatch seam wrapper over the platform-owned twenty.ts adapter; plugin runtime and manifest source remain under plugins/twenty.",
  },
  {
    path: "packages/api/scripts/memory-sources/seed-twenty-processor.ts",
    reason:
      "operator/dev seeding script for the THINK-193 U1 Twenty proving-slice processor; thin seam over the platform memory-sources substrate pending the U3 product surfaces.",
  },
  {
    path: "packages/api/src/lib/twenty/rest-client.ts",
    reason:
      "shared platform Twenty REST client (context/token resolution + paginated listing) consumed by both the Client Engagement handler and the external memory-source adapter; plugin runtime and manifest source remain package-owned under plugins/twenty.",
  },
  {
    path: "packages/api/src/lib/twenty/rest-client.test.ts",
    reason: "unit tests for the shared platform Twenty REST client above.",
  },
  {
    path: "packages/api/src/handlers/twenty-client-engagement.ts",
    reason:
      "shared platform REST app data API for the Twenty Client Engagement plugin app; plugin runtime and manifest source remain package-owned under plugins/twenty.",
  },
  {
    pathPrefix: "apps/web/src/components/plugin-apps/twenty-client-engagement/",
    reason:
      "shared platform React app surface for the Twenty Client Engagement plugin app; plugin runtime and manifest source remain package-owned under plugins/twenty.",
  },
  {
    pathPrefix: "apps/web/src/components/plugin-apps/n8n-workflows/",
    reason:
      "shared platform React host adapter for the n8n plugin app; reusable app runtime and manifest source remain package-owned under plugins/n8n.",
  },
  {
    pathPrefix: "apps/web/src/components/settings/plugins/n8n/",
    reason:
      "shared Plugin Detail UI shell for n8n package settings; package-specific validation is imported from plugins/n8n.",
  },
  {
    pathPrefix: "apps/web/src/routes/_authed/settings.plugins.n8n",
    reason:
      "shared route-backed Plugin Detail UI shell for the n8n plugin settings route and legacy redirects; plugin runtime source remains package-owned under plugins/n8n.",
  },
  {
    pathPrefix: "packages/api/src/graphql/resolvers/workflows/",
    reason:
      "shared Workflow control-plane GraphQL API can expose typed n8n workflow discovery, connection, and bridge operations without moving platform workflow ownership into the n8n plugin.",
  },
  {
    pathPrefix: "packages/api/src/lib/workflows/n8n-",
    reason:
      "shared Workflow control-plane n8n discovery and bridge contract adapters; managed app runtime source remains package-owned under plugins/n8n.",
  },
  {
    path: "packages/database-pg/drizzle/0176_n8n_agent_step_runs.sql",
    reason:
      "shared platform database migration for n8n agent-step bridge run state.",
  },
  {
    path: "packages/database-pg/drizzle/0226_drop_n8n_agent_step_runs.sql",
    reason:
      "shared platform database migration dropping the retired n8n agent-step bridge run table (THINK-217/218).",
  },
];
