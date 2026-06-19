export const pluginSourceBoundaryAllowlist = [];

export const sharedPluginTermAllowlist = [
  {
    path: "apps/cli/__tests__/terraform-cognee-fixture.test.ts",
    reason:
      "CLI structural fixture coverage validates plugin-owned Terraform packaging from the platform bundle.",
  },
  {
    path: "apps/cli/__tests__/terraform-plane-fixture.test.ts",
    reason:
      "CLI structural fixture coverage validates plugin-owned Terraform packaging from the platform bundle.",
  },
  {
    path: "apps/cli/__tests__/terraform-twenty-fixture.test.ts",
    reason:
      "CLI structural fixture coverage validates plugin-owned Terraform packaging from the platform bundle.",
  },
  {
    path: "apps/cli/__tests__/terraform-deployment-control-plane-fixture.test.ts",
    reason:
      "deployment control plane is shared infrastructure, not the Plane plugin",
  },
  {
    pathPrefix: "terraform/modules/app/deployment-control-plane/",
    reason:
      "deployment control plane is shared infrastructure, not the Plane plugin",
  },
  {
    path: "apps/web/src/routes/_authed/settings.applications.cognee.tsx",
    reason:
      "legacy settings URL redirect only; Company Brain UI source is owned by plugin detail.",
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
    path: "packages/database-pg/graphql/types/email-channel.graphql",
    reason:
      "shared platform GraphQL contract for the Email Channel plugin control plane.",
  },
];
