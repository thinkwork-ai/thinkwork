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
