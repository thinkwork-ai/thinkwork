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
	inArray,
	agents,
	agentTemplates,
	agentSkills,
	agentKnowledgeBases,
} from "../../utils.js";
import { listTemplateFiles, listAgentFiles } from "../../../lib/workspace-copy.js";
import {
	mergeTemplateSkillsIntoAgent,
	readExplicitOperations,
} from "../../../lib/skills/sync-merge.js";

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
	//
	// The signature now includes `permissions` (sorted operations array,
	// if present) so a permissions-only template change surfaces as a
	// "changed" skill rather than silently getting Push'd. Before this
	// change, `templateSyncDiff` only hashed config/model_override/enabled
	// and operators saw "no changes" for permissions-only edits, which
	// let a sync silently narrow live agents (R7 pre-fix hazard).
	const rawTemplateSkills = (agentTemplate.skills as any[]) || [];
	const templateSkillsMap = new Map<string, string>(
		rawTemplateSkills.map((s: any) => [
			s.skill_id as string,
			skillSignature(s),
		]),
	);
	const agentSkillRows = await db
		.select()
		.from(agentSkills)
		.where(eq(agentSkills.agent_id, agentId));
	const agentSkillsMap = new Map<string, string>(
		agentSkillRows.map((s: any) => [
			s.skill_id as string,
			skillSignature(s),
		]),
	);

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

	// 3a. Permissions delta per permissions_model: operations skill.
	//
	// Runs the same pure merger the sync uses, then diffs the agent's
	// current effective ops vs the post-sync effective ops. Operators
	// see the exact ops an agent will lose if they click Push, rather
	// than just "something changed."
	const permissionsChanges = await computePermissionsChanges({
		templateSkills: rawTemplateSkills,
		currentAgentSkills: agentSkillRows,
	});

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
		permissionsChanges,
		kbsAdded,
		kbsRemoved,
		filesAdded,
		filesModified,
		filesSame,
	};
}

/**
 * Stable signature for skill-diff comparison. Includes `permissions`
 * (via readExplicitOperations → sorted array) so a permissions-only
 * change is detectable.
 */
function skillSignature(s: Record<string, any>): string {
	const ops = readExplicitOperations(s.permissions);
	return JSON.stringify({
		config: s.config ?? null,
		model_override: s.model_override ?? null,
		enabled: s.enabled ?? true,
		// Sort ops so signature is order-independent — a template
		// reorder shouldn't look like a change.
		permissions: ops === null ? null : [...ops].sort(),
	});
}

type PermissionsChangeRow = {
	skillId: string;
	added: string[];
	removed: string[];
};

/**
 * Compute per-skill ops the agent will lose/gain after sync for skills
 * that opt into `permissions_model: operations`. Uses the pure merger
 * to produce the post-sync state and diffs against the agent's current
 * effective ops.
 *
 * Empty array means "no permission change pending" — UI hides the
 * section.
 */
async function computePermissionsChanges({
	templateSkills,
	currentAgentSkills,
}: {
	templateSkills: readonly Record<string, any>[];
	currentAgentSkills: readonly Record<string, any>[];
}): Promise<PermissionsChangeRow[]> {
	if (!templateSkills.length) return [];

	const skillIds = templateSkills
		.map((s) => s?.skill_id)
		.filter((id): id is string => typeof id === "string");
	if (!skillIds.length) return [];

	const optInSet = await loadPermissionsModelOptIns(skillIds);
	if (!optInSet.size) return [];

	const currentBySkillId = new Map<string, { permissions?: unknown }>();
	for (const r of currentAgentSkills)
		currentBySkillId.set(r.skill_id, r as any);

	const merged = mergeTemplateSkillsIntoAgent({
		templateSkills: templateSkills.map((s) => ({
			skill_id: s.skill_id,
			config: s.config,
			permissions: s.permissions,
			rate_limit_rpm: s.rate_limit_rpm,
			model_override: s.model_override,
			enabled: s.enabled,
		})),
		currentBySkillId,
		permissionsModelOptIns: optInSet,
	});

	const mergedBySkillId = new Map<string, (typeof merged)[number]>();
	for (const m of merged) mergedBySkillId.set(m.skill_id, m);

	const out: PermissionsChangeRow[] = [];
	for (const skillId of optInSet) {
		const cur = currentBySkillId.get(skillId);
		const tpl = templateSkills.find((s) => s.skill_id === skillId);
		const post = mergedBySkillId.get(skillId);
		if (!tpl || !post) continue;

		// "Current effective ops" = what the agent has right now. For
		// inheriting agents that's the CURRENT saved template's ops
		// (we only have the post-save version, which in the sync flow
		// is also what they're "inheriting from"); for explicit agents
		// it's their own array.
		const curExplicit = readExplicitOperations(cur?.permissions);
		const tplOps = readExplicitOperations(tpl.permissions);
		const currentEffective = new Set(
			curExplicit === null ? (tplOps ?? []) : curExplicit,
		);

		// "Post-sync effective ops" = what the merger will write.
		const postExplicit = readExplicitOperations(post.permissions);
		const postEffective = new Set(
			postExplicit === null ? (tplOps ?? []) : postExplicit,
		);

		const removed: string[] = [];
		const added: string[] = [];
		for (const op of currentEffective)
			if (!postEffective.has(op)) removed.push(op);
		for (const op of postEffective)
			if (!currentEffective.has(op)) added.push(op);

		if (removed.length || added.length) {
			out.push({ skillId, added: added.sort(), removed: removed.sort() });
		}
	}
	return out;
}

async function loadPermissionsModelOptIns(
	skillIds: string[],
): Promise<Set<string>> {
	if (skillIds.length === 0) return new Set();
	const { skillCatalog } = await import("@thinkwork/database-pg/schema");
	const rows = await db
		.select({
			slug: skillCatalog.slug,
			tier1_metadata: skillCatalog.tier1_metadata,
		})
		.from(skillCatalog)
		.where(inArray(skillCatalog.slug, skillIds));
	const out = new Set<string>();
	for (const row of rows) {
		const meta = parseTier1Metadata(row.tier1_metadata);
		if (meta?.permissions_model === "operations") out.add(row.slug);
	}
	return out;
}

function parseTier1Metadata(raw: unknown): Record<string, unknown> | null {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === "string") {
		try {
			const parsed = JSON.parse(raw);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: null;
		} catch {
			return null;
		}
	}
	if (typeof raw === "object" && !Array.isArray(raw))
		return raw as Record<string, unknown>;
	return null;
}
