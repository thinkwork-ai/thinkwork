/**
 * Agent-template operations — mutations + reads. Mirrors
 * packages/skill-catalog/thinkwork-admin/scripts/operations/templates.py
 * and the template reads from reads.py.
 *
 * `syncTemplateToAllAgents` has tenant-wide blast radius — the Python
 * skill marked it opt-in. The MCP surface exposes it via a tool but
 * downstream authz (admin role, server-side rate limits) still applies.
 */

import type { AdminOpsClient } from "./client.js";
import {
	TEMPLATE_FIELDS,
	AGENT_FIELDS,
	SYNC_SUMMARY_FIELDS,
} from "./_fields.js";
import type { Agent } from "./agents.js";

export interface AgentTemplate {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	category: string | null;
	icon: string | null;
	model: string | null;
	isPublished: boolean;
	createdAt: string;
}

export interface SyncSummary {
	agentsSynced: number;
	agentsFailed: number;
	errors: string[];
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listTemplates(
	client: AdminOpsClient,
	tenantId: string,
): Promise<AgentTemplate[]> {
	const data = await client.graphql<{ agentTemplates: AgentTemplate[] }>(
		`query($tenantId: ID!) { agentTemplates(tenantId: $tenantId) { ${TEMPLATE_FIELDS} } }`,
		{ tenantId },
	);
	return data.agentTemplates ?? [];
}

export async function getTemplate(
	client: AdminOpsClient,
	id: string,
): Promise<AgentTemplate | null> {
	const data = await client.graphql<{ agentTemplate: AgentTemplate | null }>(
		`query($id: ID!) { agentTemplate(id: $id) { ${TEMPLATE_FIELDS} } }`,
		{ id },
	);
	return data.agentTemplate;
}

export async function listLinkedAgentsForTemplate(
	client: AdminOpsClient,
	templateId: string,
): Promise<Agent[]> {
	const data = await client.graphql<{ linkedAgentsForTemplate: Agent[] }>(
		`query($templateId: ID!) {
			linkedAgentsForTemplate(templateId: $templateId) { ${AGENT_FIELDS} }
		}`,
		{ templateId },
	);
	return data.linkedAgentsForTemplate ?? [];
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface CreateAgentTemplateInput {
	tenantId: string;
	name: string;
	slug: string;
	description?: string;
	category?: string;
	model?: string;
	isPublished?: boolean;
	idempotencyKey?: string;
}

export async function createAgentTemplate(
	client: AdminOpsClient,
	input: CreateAgentTemplateInput,
): Promise<AgentTemplate> {
	const data = await client.graphql<{ createAgentTemplate: AgentTemplate }>(
		`mutation($input: CreateAgentTemplateInput!) {
			createAgentTemplate(input: $input) { ${TEMPLATE_FIELDS} }
		}`,
		{ input: { isPublished: true, ...input } },
	);
	return data.createAgentTemplate;
}

export interface CreateAgentFromTemplateInput {
	templateId: string;
	tenantId: string;
	name: string;
	role?: string;
	humanPairId?: string;
	parentAgentId?: string;
	budgetMonthlyCents?: number;
	idempotencyKey?: string;
}

export async function createAgentFromTemplate(
	client: AdminOpsClient,
	input: CreateAgentFromTemplateInput,
): Promise<Agent> {
	const data = await client.graphql<{ createAgentFromTemplate: Agent }>(
		`mutation($input: CreateAgentFromTemplateInput!) {
			createAgentFromTemplate(input: $input) { ${AGENT_FIELDS} }
		}`,
		{ input },
	);
	return data.createAgentFromTemplate;
}

export async function syncTemplateToAgent(
	client: AdminOpsClient,
	templateId: string,
	agentId: string,
	idempotencyKey?: string,
): Promise<Agent> {
	const data = await client.graphql<{ syncTemplateToAgent: Agent }>(
		`mutation($templateId: ID!, $agentId: ID!, $idempotencyKey: String) {
			syncTemplateToAgent(templateId: $templateId, agentId: $agentId, idempotencyKey: $idempotencyKey) { ${AGENT_FIELDS} }
		}`,
		{ templateId, agentId, idempotencyKey },
	);
	return data.syncTemplateToAgent;
}

export async function syncTemplateToAllAgents(
	client: AdminOpsClient,
	templateId: string,
	idempotencyKey?: string,
): Promise<SyncSummary> {
	const data = await client.graphql<{ syncTemplateToAllAgents: SyncSummary }>(
		`mutation($templateId: ID!, $idempotencyKey: String) {
			syncTemplateToAllAgents(templateId: $templateId, idempotencyKey: $idempotencyKey) { ${SYNC_SUMMARY_FIELDS} }
		}`,
		{ templateId, idempotencyKey },
	);
	return data.syncTemplateToAllAgents;
}

export async function acceptTemplateUpdate(
	client: AdminOpsClient,
	agentId: string,
	idempotencyKey?: string,
): Promise<Agent> {
	const data = await client.graphql<{ acceptTemplateUpdate: Agent }>(
		`mutation($agentId: ID!, $idempotencyKey: String) {
			acceptTemplateUpdate(agentId: $agentId, idempotencyKey: $idempotencyKey) { ${AGENT_FIELDS} }
		}`,
		{ agentId, idempotencyKey },
	);
	return data.acceptTemplateUpdate;
}
