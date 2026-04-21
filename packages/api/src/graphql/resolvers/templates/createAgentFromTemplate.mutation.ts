import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	agents, agentTemplates, agentSkills, agentKnowledgeBases,
	agentCapabilities, tenants,
	agentToCamel, generateSlug,
} from "../../utils.js";
import { agentMcpServers, agentTemplateMcpServers } from "@thinkwork/database-pg/schema";
import { initializePinnedVersions } from "../../../lib/pinned-versions.js";

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

	// 1b. Initialize pinned versions BEFORE the agent row exists so the row
	// captures the pin map on insert. Looking up tenant slug requires an
	// extra query but it's a one-off at agent-creation time. Guardrail-
	// class files (GUARDRAILS / PLATFORM / CAPABILITIES) get their bytes
	// hashed and stored in the content-addressable version store so the
	// composer can serve that exact content forever, even after template
	// edits (Unit 4's pinned-resolution path reads from there).
	//
	// A failure here must not silently drop the pins — if the version store
	// can't be written, the agent would be created without pins and Unit 9's
	// "template update available" detection would never fire. We let the
	// error surface and the mutation fails.
	let pinnedVersions: Record<string, string> = {};
	{
		const [tenant] = await db
			.select({ slug: tenants.slug })
			.from(tenants)
			.where(eq(tenants.id, agentTemplate.tenant_id!));
		if (tenant?.slug && agentTemplate.slug) {
			pinnedVersions = await initializePinnedVersions({
				tenantSlug: tenant.slug,
				templateSlug: agentTemplate.slug,
			});
		}
	}

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
			agent_pinned_versions:
				Object.keys(pinnedVersions).length > 0 ? pinnedVersions : null,
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

	// 6. (Unit 8) No copy-on-create. The new agent starts with an empty S3
	// prefix and reads the composed view through the overlay composer
	// (Unit 4) — template / defaults bytes flow through at read time.
	// Pinned-class files (GUARDRAILS / PLATFORM / CAPABILITIES) are
	// resolved via the sha256 recorded in agent_pinned_versions above.

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
