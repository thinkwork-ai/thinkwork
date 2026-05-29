import { graphql } from "@/gql";

// Typed graphql() operations for the Settings surface. These live separately
// from the legacy untyped `graphql-queries.ts` (which codegen excludes) so the
// settings work gets full type-safety from the generated documents.

// ─── General ────────────────────────────────────────────────────────────

export const SettingsTenantDetailQuery = graphql(`
  query SettingsTenantDetail($id: ID!) {
    tenant(id: $id) {
      id
      name
      slug
      plan
      issuePrefix
      issueCounter
      settings {
        id
        defaultModel
      }
      createdAt
    }
  }
`);

export const SettingsDeploymentStatusQuery = graphql(`
  query SettingsDeploymentStatus {
    deploymentStatus {
      stage
      source
      region
      accountId
      bucketName
      databaseEndpoint
      ecrUrl
      adminUrl
      docsUrl
      apiEndpoint
      appsyncUrl
      appsyncRealtimeUrl
      hindsightEndpoint
      agentcoreStatus
      hindsightEnabled
      managedMemoryEnabled
    }
  }
`);

export const SettingsRenameTenantSlugMutation = graphql(`
  mutation SettingsRenameTenantSlug($tenantId: ID!, $newSlug: String!) {
    renameTenantSlug(tenantId: $tenantId, newSlug: $newSlug) {
      id
      slug
      updatedAt
    }
  }
`);

// ─── Spaces (operator-only section) ──────────────────────────────────────

export const SettingsSpacesListQuery = graphql(`
  query SettingsSpacesList($tenantId: ID!) {
    spaces(tenantId: $tenantId, status: ACTIVE, includeAllForAdmin: true) {
      id
      tenantId
      name
      description
      status
      accessMode
      updatedAt
    }
  }
`);

export const SettingsCreateSpaceMutation = graphql(`
  mutation SettingsCreateSpace($input: CreateSpaceInput!) {
    createSpace(input: $input) {
      id
      tenantId
      name
      description
      status
      accessMode
      updatedAt
    }
  }
`);

// ─── Agent config (operator-only section) ────────────────────────────────

export const SettingsTenantAgentQuery = graphql(`
  query SettingsTenantAgent($tenantId: ID!) {
    agent: tenantAgent(tenantId: $tenantId) {
      id
      tenantId
      runtime
      model
    }
  }
`);

export const SettingsModelCatalogQuery = graphql(`
  query SettingsModelCatalog {
    modelCatalog {
      id
      modelId
      displayName
      provider
    }
  }
`);

export const SettingsUpdateTenantAgentMutation = graphql(`
  mutation SettingsUpdateTenantAgent(
    $tenantId: ID!
    $input: UpdateTenantAgentInput!
  ) {
    updateTenantAgent(tenantId: $tenantId, input: $input) {
      id
      runtime
      model
      updatedAt
    }
  }
`);
