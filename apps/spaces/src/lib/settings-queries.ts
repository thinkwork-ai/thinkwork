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

export const SettingsSpaceQuery = graphql(`
  query SettingsSpace($id: ID!) {
    space(id: $id) {
      id
      tenantId
      name
      description
      status
      accessMode
      slug
    }
  }
`);

export const SettingsUpdateSpaceMutation = graphql(`
  mutation SettingsUpdateSpace($input: UpdateSpaceInput!) {
    updateSpace(input: $input) {
      id
      name
      description
      accessMode
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

// ─── Users (operator-only section) ───────────────────────────────────────

export const SettingsTenantMembersQuery = graphql(`
  query SettingsTenantMembers($tenantId: ID!) {
    tenantMembers(tenantId: $tenantId) {
      id
      principalType
      principalId
      role
      status
      createdAt
      user {
        id
        name
        email
        profile {
          id
          title
          timezone
          pronouns
          callBy
          notes
        }
      }
    }
  }
`);

export const SettingsUpdateUserMutation = graphql(`
  mutation SettingsUpdateUser($id: ID!, $input: UpdateUserInput!) {
    updateUser(id: $id, input: $input) {
      id
      name
      updatedAt
    }
  }
`);

export const SettingsUpdateUserProfileMutation = graphql(`
  mutation SettingsUpdateUserProfile(
    $userId: ID!
    $input: UpdateUserProfileInput!
  ) {
    updateUserProfile(userId: $userId, input: $input) {
      id
      title
      timezone
      pronouns
      callBy
      notes
      updatedAt
    }
  }
`);

export const SettingsUpdateTenantMemberMutation = graphql(`
  mutation SettingsUpdateTenantMember(
    $id: ID!
    $input: UpdateTenantMemberInput!
  ) {
    updateTenantMember(id: $id, input: $input) {
      id
      role
      status
      updatedAt
    }
  }
`);

export const SettingsInviteMemberMutation = graphql(`
  mutation SettingsInviteMember($tenantId: ID!, $input: InviteMemberInput!) {
    inviteMember(tenantId: $tenantId, input: $input) {
      id
      principalType
      principalId
      role
      status
      createdAt
      user {
        id
        name
        email
      }
    }
  }
`);

// ─── Analytics (usage cost, operator-only) ───────────────────────────────

export const SettingsCostSummaryQuery = graphql(`
  query SettingsCostSummary($tenantId: ID!) {
    costSummary(tenantId: $tenantId) {
      totalUsd
      llmUsd
      computeUsd
      toolsUsd
      totalInputTokens
      totalOutputTokens
      eventCount
    }
  }
`);

export const SettingsCostByAgentQuery = graphql(`
  query SettingsCostByAgent($tenantId: ID!) {
    costByAgent(tenantId: $tenantId) {
      agentId
      agentName
      totalUsd
      eventCount
    }
  }
`);

export const SettingsCostByModelQuery = graphql(`
  query SettingsCostByModel($tenantId: ID!) {
    costByModel(tenantId: $tenantId) {
      model
      totalUsd
      inputTokens
      outputTokens
    }
  }
`);

export const SettingsCostTimeSeriesQuery = graphql(`
  query SettingsCostTimeSeries($tenantId: ID!, $days: Int) {
    costTimeSeries(tenantId: $tenantId, days: $days) {
      day
      totalUsd
      llmUsd
      computeUsd
      toolsUsd
      eventCount
    }
  }
`);

// ─── Routines + Webhooks (operator-only) ─────────────────────────────────

export const SettingsRoutinesQuery = graphql(`
  query SettingsRoutines($tenantId: ID!) {
    routines(tenantId: $tenantId) {
      id
      name
      description
      status
      lastRunAt
      engine
      createdAt
    }
  }
`);

export const SettingsWebhooksQuery = graphql(`
  query SettingsWebhooks($tenantId: ID!) {
    webhooks(tenantId: $tenantId) {
      id
      name
      description
      targetType
      enabled
      invocationCount
      lastInvokedAt
      createdAt
    }
  }
`);
