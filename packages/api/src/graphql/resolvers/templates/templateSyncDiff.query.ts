/**
 * Compute the diff between a template and a linked agent.
 *
 * Used by the sync review UI. Shows what would change if sync were applied.
 * Scope matches syncTemplateToAgent: skills, KBs, workspace files, role.
 *
 * For MVP, workspace diff is path-only (added/modified/same). Content diff
 * viewer can be layered on later.
 */

import type { GraphQLContext } from "../../context.js";
import {
	db,
	eq,
	agents,
	agentTemplates,
	agentSkills,
	agentKnowledgeBases,
} from "../../utils.js";
import { listTemplateFiles, listAgentFiles } from "../../../lib/workspace-copy.js";

export async function templateSyncDiff(_parent: any, args: any, _ctx: GraphQLContext) {
	const { templateId, agentId } = args;

	// 1. Fetch template + agent
	const [agentTemplate] = await db.select().from(agentTemplates).where(eq(agentTemplates.id, templateId));
	if (!agentTemplate) throw new Error("Agent template not found");

	const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
	if (!agent) throw new Error("Agent not found");
	if (agent.template_id !== templateId) {
		throw new Error("Agent is not linked to this template");
	}

	// 2. Role change
	const templateConfig = (agentTemplate.config as any) || {};
	const templateRole = templateConfig.role ?? null;
	const agentRole = agent.role ?? null;
	const roleChange =
		templateRole !== agentRole
			? { current: agentRole, target: templateRole }
			: null;

	// 3. Skills diff
	const templateSkills = ((agentTemplate.skills as any[]) || []).map((s: any) => ({
		id: s.skill_id as string,
		sig: JSON.stringify({ config: s.config, model_override: s.model_override, enabled: s.enabled }),
	}));
	const agentSkillRows = await db
		.select()
		.from(agentSkills)
		.where(eq(agentSkills.agent_id, agentId));
	const agentSkillsMap = new Map<string, string>(
		agentSkillRows.map((s: any) => [
			s.skill_id as string,
			JSON.stringify({ config: s.config, model_override: s.model_override, enabled: s.enabled }),
		]),
	);
	const templateSkillsMap = new Map<string, string>(templateSkills.map((s: any) => [s.id, s.sig]));

	const skillsAdded: string[] = [];
	const skillsChanged: string[] = [];
	for (const [id, sig] of templateSkillsMap) {
		if (!agentSkillsMap.has(id)) skillsAdded.push(id);
		else if (agentSkillsMap.get(id) !== sig) skillsChanged.push(id);
	}
	const skillsRemoved: string[] = [];
	for (const id of agentSkillsMap.keys()) {
		if (!templateSkillsMap.has(id)) skillsRemoved.push(id);
	}

	// 4. KBs diff
	const templateKbIds = new Set<string>(
		((agentTemplate.knowledge_base_ids as string[]) || []).filter(Boolean),
	);
	const agentKbRows = await db
		.select({ knowledge_base_id: agentKnowledgeBases.knowledge_base_id })
		.from(agentKnowledgeBases)
		.where(eq(agentKnowledgeBases.agent_id, agentId));
	const agentKbIds = new Set<string>(agentKbRows.map((k: any) => k.knowledge_base_id as string));

	const kbsAdded = [...templateKbIds].filter((id) => !agentKbIds.has(id));
	const kbsRemoved = [...agentKbIds].filter((id) => !templateKbIds.has(id));

	// 5. Workspace files diff (path-only; caller can do content diff on demand)
	const filesAdded: string[] = [];
	const filesModified: string[] = [];
	const filesSame: string[] = [];
	try {
		const templateFiles = new Set(
			await listTemplateFiles(agentTemplate.tenant_id!, agentTemplate.slug),
		);
		const agentFiles = new Set(await listAgentFiles(agent.tenant_id!, agent.slug!));
		for (const p of templateFiles) {
			if (!agentFiles.has(p)) filesAdded.push(p);
			else filesSame.push(p); // MVP: can't tell same vs modified without content compare
		}
		// Note: filesModified is empty for MVP. Future enhancement: compare ETags or content.
	} catch (err) {
		console.warn(`[templateSyncDiff] Workspace listing failed:`, err);
	}

	return {
		roleChange,
		skillsAdded,
		skillsRemoved,
		skillsChanged,
		kbsAdded,
		kbsRemoved,
		filesAdded,
		filesModified,
		filesSame,
	};
}
