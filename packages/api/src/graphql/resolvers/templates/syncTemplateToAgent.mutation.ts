/**
 * Sync a single linked agent to its template.
 *
 * Overwrites: skills, knowledge_bases, workspace files, and role.
 * Snapshots the agent's current state first so the change can be rolled back.
 *
 * Does NOT touch: model, guardrail_id, blocked_tools — those are resolved live
 * from the template FK at invocation time (see chat-agent-invoke.ts).
 */

import type { GraphQLContext } from "../../context.js";
import {
	db,
	eq,
	agents,
	agentTemplates,
	agentSkills,
	agentKnowledgeBases,
	agentToCamel,
	sql,
} from "../../utils.js";
import { agentMcpServers } from "@thinkwork/database-pg/schema";
import { snapshotAgent } from "../../../lib/agent-snapshot.js";
import { overlayTemplateWorkspace } from "../../../lib/workspace-copy.js";

export async function syncTemplateToAgent(_parent: any, args: any, ctx: GraphQLContext) {
	const { templateId, agentId } = args;

	// 1. Fetch template + agent, validate linkage
	const [agentTemplate] = await db.select().from(agentTemplates).where(eq(agentTemplates.id, templateId));
	if (!agentTemplate) throw new Error("Agent template not found");

	const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
	if (!agent) throw new Error("Agent not found");
	if (agent.template_id !== templateId) {
		throw new Error("Agent is not linked to this template");
	}

	// 2. Snapshot current state FIRST (enables rollback)
	await snapshotAgent(agentId, "Pre-sync from template", ctx.auth.principalId);

	// 3. Read template config
	const config = (agentTemplate.config as any) || {};
	const templateSkills = (agentTemplate.skills as any[]) || [];
	const templateKbIds = (agentTemplate.knowledge_base_ids as string[]) || [];

	// 4. Update agent.role from template.config.role
	await db
		.update(agents)
		.set({
			role: config.role ?? agent.role,
			updated_at: sql`now()`,
		})
		.where(eq(agents.id, agentId));

	// 5. Replace agent_skills
	await db.delete(agentSkills).where(eq(agentSkills.agent_id, agentId));
	if (templateSkills.length > 0) {
		await db.insert(agentSkills).values(
			templateSkills.map((s: any) => ({
				agent_id: agentId,
				tenant_id: agent.tenant_id!,
				skill_id: s.skill_id,
				config: s.config,
				permissions: s.permissions,
				rate_limit_rpm: s.rate_limit_rpm,
				model_override: s.model_override ?? null,
				enabled: s.enabled ?? true,
			})),
		);
	}

	// 6. Replace agent_knowledge_bases
	await db.delete(agentKnowledgeBases).where(eq(agentKnowledgeBases.agent_id, agentId));
	if (templateKbIds.length > 0) {
		await db.insert(agentKnowledgeBases).values(
			templateKbIds.map((kbId: string) => ({
				agent_id: agentId,
				tenant_id: agent.tenant_id!,
				knowledge_base_id: kbId,
				enabled: true,
			})),
		);
	}

	// 6b. Replace agent_mcp_servers from template.mcp_servers JSONB
	const templateMcpServers = (agentTemplate.mcp_servers as Array<{ mcp_server_id: string; enabled: boolean }>) || [];
	await db.delete(agentMcpServers).where(eq(agentMcpServers.agent_id, agentId));
	if (templateMcpServers.length > 0) {
		await db.insert(agentMcpServers).values(
			templateMcpServers.map((m) => ({
				agent_id: agentId,
				tenant_id: agent.tenant_id!,
				mcp_server_id: m.mcp_server_id,
				enabled: m.enabled ?? true,
			})),
		);
	}

	// 7. Overlay workspace files (template files overwrite matching paths; agent-only files preserved)
	try {
		await overlayTemplateWorkspace(agent.tenant_id!, agentTemplate.slug, agent.slug!);
	} catch (err) {
		console.warn(`[syncTemplateToAgent] Workspace overlay failed:`, err);
	}

	// 8. Regenerate workspace map
	try {
		const { regenerateWorkspaceMap } = await import("../../../lib/workspace-map-generator.js");
		regenerateWorkspaceMap(agentId).catch((err: unknown) => {
			console.error("[syncTemplateToAgent] regenerateWorkspaceMap failed:", err);
		});
	} catch (err) {
		console.warn("[syncTemplateToAgent] workspace-map-generator not available:", err);
	}

	// 9. Return updated agent
	const [updated] = await db.select().from(agents).where(eq(agents.id, agentId));
	return agentToCamel(updated);
}
