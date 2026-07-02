/**
 * Agent operations — mutations + reads. Mirrors
 * legacy thinkwork-admin skill agent helpers
 * and the agent reads from reads.py.
 */

import type { AdminOpsClient } from "./client.js";
import { AGENT_FIELDS, CAPABILITY_FIELDS } from "./_fields.js";

export interface Agent {
  id: string;
  name: string;
  slug: string;
  role: string | null;
  type: string | null;
  adapterType: string | null;
  status: string;
  humanPairId: string | null;
  parentAgentId: string | null;
  createdAt: string;
}

export interface AgentCapability {
  agentId: string;
  capability: string;
  config: Record<string, unknown> | null;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListAgentsInput {
  tenantId: string;
  status?: string;
  type?: string;
  includeSystem?: boolean;
}

export async function listAgents(
  client: AdminOpsClient,
  input: ListAgentsInput,
): Promise<Agent[]> {
  const data = await client.graphql<{ agents: Agent[] }>(
    `query($tenantId: ID!, $status: AgentStatus, $type: AgentType, $includeSystem: Boolean) {
			agents(tenantId: $tenantId, status: $status, type: $type, includeSystem: $includeSystem) { ${AGENT_FIELDS} }
		}`,
    {
      tenantId: input.tenantId,
      status: input.status,
      type: input.type,
      includeSystem: input.includeSystem ?? false,
    },
  );
  return data.agents ?? [];
}

export async function getAgent(
  client: AdminOpsClient,
  id: string,
): Promise<Agent | null> {
  const data = await client.graphql<{ agent: Agent | null }>(
    `query($id: ID!) { agent(id: $id) { ${AGENT_FIELDS} } }`,
    { id },
  );
  return data.agent;
}

export interface ListAllTenantAgentsInput {
  tenantId: string;
  includeSystem?: boolean;
  includeSubAgents?: boolean;
}

export async function listAllTenantAgents(
  client: AdminOpsClient,
  input: ListAllTenantAgentsInput,
): Promise<Agent[]> {
  const data = await client.graphql<{ allTenantAgents: Agent[] }>(
    `query($tenantId: ID!, $includeSystem: Boolean, $includeSubAgents: Boolean) {
			allTenantAgents(tenantId: $tenantId, includeSystem: $includeSystem, includeSubAgents: $includeSubAgents) { ${AGENT_FIELDS} }
		}`,
    {
      tenantId: input.tenantId,
      includeSystem: input.includeSystem ?? false,
      includeSubAgents: input.includeSubAgents ?? false,
    },
  );
  return data.allTenantAgents ?? [];
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface CreateAgentInput {
  tenantId: string;
  name: string;
  role?: string;
  type?: string;
  systemPrompt?: string;
  reportsTo?: string;
  humanPairId?: string;
  parentAgentId?: string;
  adapterType?: string;
  avatarUrl?: string;
  idempotencyKey?: string;
}

export async function createAgent(
  client: AdminOpsClient,
  input: CreateAgentInput,
): Promise<Agent> {
  const data = await client.graphql<{ createAgent: Agent }>(
    `mutation($input: CreateAgentInput!) { createAgent(input: $input) { ${AGENT_FIELDS} } }`,
    { input },
  );
  return data.createAgent;
}

export interface AgentCapabilityInput {
  capability: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export async function setAgentCapabilities(
  client: AdminOpsClient,
  agentId: string,
  capabilities: AgentCapabilityInput[],
  idempotencyKey?: string,
): Promise<AgentCapability[]> {
  const data = await client.graphql<{
    setAgentCapabilities: AgentCapability[];
  }>(
    `mutation($agentId: ID!, $capabilities: [AgentCapabilityInput!]!, $idempotencyKey: String) {
			setAgentCapabilities(agentId: $agentId, capabilities: $capabilities, idempotencyKey: $idempotencyKey) { ${CAPABILITY_FIELDS} }
		}`,
    { agentId, capabilities, idempotencyKey },
  );
  return data.setAgentCapabilities ?? [];
}
