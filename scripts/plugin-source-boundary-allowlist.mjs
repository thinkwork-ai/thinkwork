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
];
