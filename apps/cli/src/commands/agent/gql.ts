import { graphql } from "../../gql/index.js";

export const AgentsDoc = graphql(`
  query CliAgents(
    $tenantId: ID!
    $status: AgentStatus
    $type: AgentType
    $includeSystem: Boolean
  ) {
    agents(
      tenantId: $tenantId
      status: $status
      type: $type
      includeSystem: $includeSystem
    ) {
      id
      name
      slug
      role
      type
      status
      runtime
      lastHeartbeatAt
    }
  }
`);

export const AllTenantAgentsDoc = graphql(`
  query CliAllTenantAgents(
    $tenantId: ID!
    $includeSystem: Boolean
    $includeSubAgents: Boolean
  ) {
    allTenantAgents(
      tenantId: $tenantId
      includeSystem: $includeSystem
      includeSubAgents: $includeSubAgents
    ) {
      id
      name
      slug
      role
      type
      status
      runtime
      lastHeartbeatAt
    }
  }
`);

export const AgentDoc = graphql(`
  query CliAgent($id: ID!) {
    agent(id: $id) {
      id
      name
      slug
      role
      type
      source
      status
      systemPrompt
      runtime
      adapterType
      version
      humanPairId
      parentAgentId
      reportsToId
      lastHeartbeatAt
      createdAt
      updatedAt
      capabilities {
        capability
        enabled
        config
      }
      skills {
        skillId
        enabled
        rateLimitRpm
      }
      budgetPolicy {
        period
        limitUsd
        actionOnExceed
      }
    }
  }
`);

export const CreateAgentDoc = graphql(`
  mutation CliCreateAgent($input: CreateAgentInput!) {
    createAgent(input: $input) {
      id
      name
      type
      status
    }
  }
`);

export const UpdateAgentDoc = graphql(`
  mutation CliUpdateAgent($id: ID!, $input: UpdateAgentInput!) {
    updateAgent(id: $id, input: $input) {
      id
      name
      role
      type
      status
    }
  }
`);

export const DeleteAgentDoc = graphql(`
  mutation CliDeleteAgent($id: ID!) {
    deleteAgent(id: $id)
  }
`);

export const UpdateAgentStatusDoc = graphql(`
  mutation CliUpdateAgentStatus($id: ID!, $status: AgentStatus!) {
    updateAgentStatus(id: $id, status: $status) {
      id
      status
    }
  }
`);

export const SetAgentCapabilitiesDoc = graphql(`
  mutation CliSetAgentCapabilities(
    $agentId: ID!
    $capabilities: [AgentCapabilityInput!]!
  ) {
    setAgentCapabilities(agentId: $agentId, capabilities: $capabilities) {
      capability
      enabled
    }
  }
`);

export const SetAgentSkillsDoc = graphql(`
  mutation CliSetAgentSkills($agentId: ID!, $skills: [AgentSkillInput!]!) {
    setAgentSkills(agentId: $agentId, skills: $skills) {
      skillId
      enabled
      rateLimitRpm
    }
  }
`);

export const SetAgentBudgetPolicyDoc = graphql(`
  mutation CliSetAgentBudgetPolicy(
    $agentId: ID!
    $input: AgentBudgetPolicyInput!
  ) {
    setAgentBudgetPolicy(agentId: $agentId, input: $input) {
      period
      limitUsd
      actionOnExceed
    }
  }
`);

export const DeleteAgentBudgetPolicyDoc = graphql(`
  mutation CliDeleteAgentBudgetPolicy($agentId: ID!) {
    deleteAgentBudgetPolicy(agentId: $agentId)
  }
`);

export const AgentApiKeysDoc = graphql(`
  query CliAgentApiKeys($agentId: ID!) {
    agentApiKeys(agentId: $agentId) {
      id
      name
      keyPrefix
      lastUsedAt
      revokedAt
      createdAt
    }
  }
`);

export const CreateAgentApiKeyDoc = graphql(`
  mutation CliCreateAgentApiKey($input: CreateAgentApiKeyInput!) {
    createAgentApiKey(input: $input) {
      apiKey {
        id
        name
        keyPrefix
        createdAt
      }
      plainTextKey
    }
  }
`);

export const RevokeAgentApiKeyDoc = graphql(`
  mutation CliRevokeAgentApiKey($id: ID!) {
    revokeAgentApiKey(id: $id) {
      id
      revokedAt
    }
  }
`);

export const ToggleEmailDoc = graphql(`
  mutation CliToggleAgentEmail($agentId: ID!, $enabled: Boolean!) {
    toggleAgentEmailChannel(agentId: $agentId, enabled: $enabled) {
      capability
      enabled
    }
  }
`);

export const ClaimVanityEmailDoc = graphql(`
  mutation CliClaimVanityEmail($agentId: ID!, $localPart: String!) {
    claimVanityEmailAddress(agentId: $agentId, localPart: $localPart) {
      capability
      enabled
      config
    }
  }
`);

export const ReleaseVanityEmailDoc = graphql(`
  mutation CliReleaseVanityEmail($agentId: ID!) {
    releaseVanityEmailAddress(agentId: $agentId) {
      capability
      enabled
    }
  }
`);

export const UpdateAgentEmailAllowlistDoc = graphql(`
  mutation CliUpdateAgentEmailAllowlist(
    $agentId: ID!
    $allowedSenders: [String!]!
  ) {
    updateAgentEmailAllowlist(
      agentId: $agentId
      allowedSenders: $allowedSenders
    ) {
      capability
      config
    }
  }
`);

export const AgentTenantBySlugDoc = graphql(`
  query CliAgentTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
    }
  }
`);
