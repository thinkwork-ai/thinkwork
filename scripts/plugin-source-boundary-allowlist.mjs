export const pluginSourceBoundaryAllowlist = [];

export const sharedPluginTermAllowlist = [
  {
    path: "apps/cli/__tests__/terraform-cognee-fixture.test.ts",
    reason:
      "CLI structural fixture coverage validates plugin-owned Terraform packaging from the platform bundle.",
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
    path: "apps/web/src/routes/_authed/settings.applications.cognee.tsx",
    reason:
      "legacy settings URL redirect only; Company Brain UI source is owned by plugin detail.",
  },
  {
    path: "apps/web/src/routes/_authed/settings.plugins.data-integrations.tsx",
    reason:
      "legacy settings URL redirect only; Company ETL UI source is owned by the canonical company-etl plugin detail.",
  },
  {
    path: "packages/database-pg/__tests__/migration-0166-company-brain-substrate.test.ts",
    reason: "historical database migration coverage",
  },
  {
    path: "packages/database-pg/__tests__/migration-0167-company-brain-artifact-manifests.test.ts",
    reason: "historical database migration coverage",
  },
  {
    path: "packages/api/src/lib/memory/adapters/cognee-adapter.ts",
    reason:
      "shared platform memory engine adapter selected by MEMORY_ENGINE; Cognee remains the Company Brain substrate implementation.",
  },
  {
    path: "packages/api/src/lib/memory/adapters/cognee-adapter.test.ts",
    reason:
      "shared platform memory engine adapter coverage for MEMORY_ENGINE=cognee.",
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
    path: "packages/api/src/graphql/resolvers/routines/importN8nRoutine.mutation.ts",
    reason:
      "legacy n8n workflow-to-Routine import mutation; THNK-50 application plugin source lives under plugins/n8n.",
  },
  {
    pathPrefix: "packages/api/src/lib/routines/n8n/",
    reason:
      "legacy n8n workflow-to-Routine migration/import substrate, not THNK-50 application plugin source.",
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
    pathPrefix:
      "packages/api/src/graphql/resolvers/plugin-apps/twenty-client-engagement",
    reason:
      "shared platform GraphQL app data API for the Twenty Client Engagement plugin app; plugin runtime and manifest source remain package-owned under plugins/twenty.",
  },
  {
    pathPrefix: "apps/web/src/components/plugin-apps/twenty-client-engagement/",
    reason:
      "shared platform React app surface for the Twenty Client Engagement plugin app; plugin runtime and manifest source remain package-owned under plugins/twenty.",
  },
  {
    pathPrefix: "apps/web/src/components/settings/plugins/n8n/",
    reason:
      "shared Plugin Detail UI shell for n8n package settings; package-specific validation is imported from plugins/n8n.",
  },
  {
    pathPrefix: "apps/web/src/routes/_authed/settings.plugins.n8n",
    reason:
      "shared route-backed Plugin Detail UI shell for the n8n plugin Workflows and Settings tabs; plugin runtime source remains package-owned under plugins/n8n.",
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
    pathPrefix: "packages/api/src/lib/n8n-agent-step/",
    reason:
      "shared platform bridge contract for n8n workflows invoking ThinkWork agent steps; managed app runtime source remains package-owned under plugins/n8n.",
  },
  {
    pathPrefix: "packages/api/src/graphql/resolvers/n8n-agent-step-runs/",
    reason:
      "shared platform GraphQL telemetry surface for n8n workflow-to-agent bridge runs; managed app runtime source remains package-owned under plugins/n8n.",
  },
  {
    path: "packages/api/src/handlers/n8n-agent-step-bridge.ts",
    reason:
      "shared platform HTTP bridge endpoint for n8n workflows invoking ThinkWork agent steps; managed app runtime source remains package-owned under plugins/n8n.",
  },
  {
    path: "packages/api/src/handlers/n8n-agent-step-bridge.test.ts",
    reason:
      "shared platform HTTP bridge endpoint coverage for n8n workflow-to-agent starts.",
  },
  {
    path: "packages/api/src/handlers/n8n-agent-step-expirer.ts",
    reason:
      "shared platform scheduled bridge expirer for n8n workflow-to-agent callbacks.",
  },
  {
    path: "packages/api/src/handlers/n8n-agent-step-expirer.test.ts",
    reason:
      "shared platform scheduled bridge expirer coverage for n8n workflow-to-agent callbacks.",
  },
  {
    path: "packages/database-pg/__tests__/migration-0176-n8n-agent-step-runs.test.ts",
    reason:
      "shared platform database contract coverage for n8n agent-step bridge run state.",
  },
  {
    path: "packages/database-pg/drizzle/0176_n8n_agent_step_runs.sql",
    reason:
      "shared platform database migration for n8n agent-step bridge run state.",
  },
  {
    path: "packages/database-pg/graphql/types/n8n-agent-step-runs.graphql",
    reason:
      "shared platform GraphQL contract for n8n agent-step bridge run state.",
  },
  {
    path: "packages/database-pg/src/schema/n8n-agent-step-runs.ts",
    reason:
      "shared platform Drizzle schema for n8n agent-step bridge run state.",
  },
];
