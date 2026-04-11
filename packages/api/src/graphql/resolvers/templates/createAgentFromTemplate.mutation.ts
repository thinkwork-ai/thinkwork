import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	agents, agentTemplates, agentSkills, agentKnowledgeBases,
	agentCapabilities,
	agentToCamel, generateSlug,
} from "../../utils.js";
import { agentMcpServers, agentTemplateMcpServers } from "@thinkwork/database-pg/schema";

export async function createAgentFromTemplate(_parent: any, args: any, _ctx: GraphQLContext) {
	const i = args.input;

	// 1. Fetch template
	const [agentTemplate] = await db
		.select()
		.from(agentTemplates)
		.where(eq(agentTemplates.id, i.templateId));
	if (!agentTemplate) throw new Error("Agent template not found");

	const config = (agentTemplate.config as any) || {};
	const templateSkills = (agentTemplate.skills as any[]) || [];
	const templateKbIds = (agentTemplate.knowledge_base_ids as string[]) || [];

	// 2. Create agent record (model, guardrail, tools come from template)
	const [agent] = await db
		.insert(agents)
		.values({
			tenant_id: agentTemplate.tenant_id!,
			name: i.name,
			slug: i.slug || generateSlug(),
			role: config.role,
			adapter_type: "strands",
			template_id: agentTemplate.id,
		})
		.returning();

	// 3. Assign skills (with model_override from template)
	if (templateSkills.length > 0) {
		await db.insert(agentSkills).values(
			templateSkills.map((s: any) => ({
				agent_id: agent.id,
				tenant_id: agentTemplate.tenant_id!,
				skill_id: s.skill_id,
				config: s.config,
				permissions: s.permissions,
				rate_limit_rpm: s.rate_limit_rpm,
				model_override: s.model_override ?? null,
				enabled: s.enabled ?? true,
			})),
		);
	}

	// 4. Assign knowledge bases
	if (templateKbIds.length > 0) {
		await db.insert(agentKnowledgeBases).values(
			templateKbIds.map((kbId: string) => ({
				agent_id: agent.id,
				tenant_id: agentTemplate.tenant_id!,
				knowledge_base_id: kbId,
				enabled: true,
			})),
		);
	}

	// 4b. Assign MCP servers from template join table
	const templateMcpRows = await db
		.select({ mcp_server_id: agentTemplateMcpServers.mcp_server_id, enabled: agentTemplateMcpServers.enabled })
		.from(agentTemplateMcpServers)
		.where(eq(agentTemplateMcpServers.template_id, agentTemplate.id));
	if (templateMcpRows.length > 0) {
		await db.insert(agentMcpServers).values(
			templateMcpRows.map((m) => ({
				agent_id: agent.id,
				tenant_id: agentTemplate.tenant_id!,
				mcp_server_id: m.mcp_server_id,
				enabled: m.enabled ?? true,
			})),
		);
	}

	// 5. Auto-provision email capability
	try {
		await db.insert(agentCapabilities).values({
			agent_id: agent.id,
			tenant_id: agentTemplate.tenant_id!,
			capability: "email_channel",
			config: {
				emailAddress: `${agent.slug}@agents.thinkwork.ai`,
				allowedSenders: [],
				replyTokensEnabled: true,
				maxReplyTokenAgeDays: 7,
				maxReplyTokenUses: 3,
				rateLimitPerHour: 50,
			},
			enabled: true,
		});
	} catch (err) {
		console.warn(`[createAgentFromTemplate] Failed to provision email capability:`, err);
	}

	// 6. Copy workspace files from template S3 prefix to agent S3 prefix
	try {
		const { copyTemplateWorkspace } = await import("../../../lib/workspace-copy.js");
		await copyTemplateWorkspace(agentTemplate.tenant_id!, agentTemplate.slug, agent.slug!);
	} catch (err) {
		console.warn(`[createAgentFromTemplate] Failed to copy workspace files:`, err);
	}

	// 7. Regenerate workspace map
	try {
		const { regenerateWorkspaceMap } = await import("../../../lib/workspace-map-generator.js");
		regenerateWorkspaceMap(agent.id).catch((err: unknown) => {
			console.error("[createAgentFromTemplate] Failed to regenerate workspace map:", err);
		});
	} catch (err) {
		console.warn("[createAgentFromTemplate] workspace-map-generator not available:", err);
	}

	// 8. Add to team if specified
	if (i.teamId) {
		try {
			const { teamAgents: teamAgentsTable } = await import("../../utils.js");
			await db.insert(teamAgentsTable).values({
				team_id: i.teamId,
				agent_id: agent.id,
				tenant_id: agentTemplate.tenant_id!,
			});
		} catch (err) {
			console.warn(`[createAgentFromTemplate] Failed to add agent to team:`, err);
		}
	}

	return agentToCamel(agent);
}
