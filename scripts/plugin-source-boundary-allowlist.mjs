export const pluginSourceBoundaryAllowlist = [
  {
    path: "apps/cli/__tests__/terraform-cognee-fixture.test.ts",
    reason: "legacy Terraform fixture coverage until Cognee source moves",
  },
  {
    path: "apps/cli/__tests__/terraform-plane-fixture.test.ts",
    reason: "legacy Terraform fixture coverage until Plane source moves",
  },
  {
    path: "apps/cli/__tests__/terraform-twenty-fixture.test.ts",
    reason: "legacy Terraform fixture coverage until Twenty source moves",
  },
  {
    path: "apps/web/src/routes/_authed/settings.applications.cognee.tsx",
    reason:
      "legacy Cognee settings route until web plugin extension points move",
  },
  {
    path: "apps/web/src/components/settings/SettingsCogneeApplication.test.tsx",
    reason: "legacy Cognee settings UI until web plugin extension points move",
  },
  {
    path: "apps/web/src/components/settings/SettingsCogneeApplication.tsx",
    reason: "legacy Cognee settings UI until web plugin extension points move",
  },
  {
    path: "packages/api/src/graphql/resolvers/core/cogneeClusterIdentity.ts",
    reason:
      "legacy Cognee identity resolver until Company Brain substrate moves",
  },
  {
    path: "packages/api/src/lib/company-brain/migration.test.ts",
    reason:
      "legacy Company Brain migration helper until API extension points move",
  },
  {
    path: "packages/api/src/lib/company-brain/migration.ts",
    reason:
      "legacy Company Brain migration helper until API extension points move",
  },
  {
    path: "packages/api/src/lib/context-engine/providers/company-brain.test.ts",
    reason:
      "legacy Company Brain context provider until API extension points move",
  },
  {
    path: "packages/api/src/lib/context-engine/providers/company-brain.ts",
    reason:
      "legacy Company Brain context provider until API extension points move",
  },
  {
    path: "packages/api/src/lib/knowledge-graph/cognee-client.test.ts",
    reason: "legacy Cognee client until Company Brain substrate moves",
  },
  {
    path: "packages/api/src/lib/knowledge-graph/cognee-client.ts",
    reason: "legacy Cognee client until Company Brain substrate moves",
  },
  {
    path: "packages/api/src/lib/plugins/twenty-cutover.test.ts",
    reason: "legacy Twenty cutover helper until API extension points move",
  },
  {
    path: "packages/api/src/lib/plugins/twenty-cutover.ts",
    reason: "legacy Twenty cutover helper until API extension points move",
  },
  {
    path: "packages/api/test/integration/context-engine/company-brain-context.e2e.test.ts",
    reason:
      "legacy Company Brain integration coverage until API extension points move",
  },
  {
    path: "packages/database-pg/__tests__/migration-0166-company-brain-substrate.test.ts",
    reason: "historical database migration coverage",
  },
  {
    path: "packages/database-pg/__tests__/migration-0167-company-brain-artifact-manifests.test.ts",
    reason: "historical database migration coverage",
  },
];

export const sharedPluginTermAllowlist = [
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
];
