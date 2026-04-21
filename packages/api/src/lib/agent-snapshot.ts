/**
 * Agent snapshot helper — captures the full state of an agent to agent_versions.
 *
 * Used by the template→agent sync flow and by rollback. We snapshot BEFORE applying
 * a destructive change so the admin can recover if the sync or rollback goes wrong.
 *
 * Snapshot scope:
 *   - agent row (role, system_prompt, etc. via config_snapshot)
 *   - agent_skills rows
 *   - agent_knowledge_bases rows
 *   - workspace file contents (full text; these are markdown/config and small)
 *
 * Out of scope:
 *   - model / guardrail_id / blocked_tools — these live on agent_templates and are
 *     resolved at invocation time, so they don't need snapshotting per agent.
 */

import {
	ListObjectsV2Command,
	PutObjectCommand,
	DeleteObjectsCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { db, eq, sql, agents, agentSkills, agentKnowledgeBases, agentVersions, tenants } from "../graphql/utils.js";
import { regenerateManifest } from "./workspace-manifest.js";
import { composeList, type ComposeResult } from "./workspace-overlay.js";

const s3 = new S3Client({
	region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});
const BUCKET = process.env.WORKSPACE_BUCKET || "";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveTenantSlug(tenantId: string): Promise<string> {
	const [tenant] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
	if (!tenant?.slug) throw new Error(`Tenant ${tenantId} not found or has no slug`);
	return tenant.slug;
}

/**
 * Read every composed workspace file into a { path: content } map.
 *
 * Under the overlay model (PRD workspace-overlay, Unit 5), the snapshot
 * captures the *composed* view — agent overrides + template base +
 * defaults — so `restoreAgentFromSnapshot` restores the full state the
 * operator saw, not just the sparse set of agent-scoped overrides. This is
 * what lets a rollback actually work: a fresh-off-template agent has no
 * files in `{agent}/workspace/` at all, but its snapshot still needs to
 * preserve the 11 canonical files so a later template edit doesn't
 * silently leak into a "restored" agent.
 *
 * Placeholder values are server-computed from current DB state by the
 * composer; a snapshot taken while human A is paired and restored after
 * reassignment to human B will bake human A's values. That matches
 * expected rollback semantics — the version *is* the point-in-time state.
 */
export async function readWorkspaceFiles(
	tenantId: string,
	agentId: string,
): Promise<Record<string, string>> {
	// Read lazily — at cold start the env is present, but tests inject it
	// after module load.
	if (!process.env.WORKSPACE_BUCKET) return {};
	const files = (await composeList(
		{ tenantId },
		agentId,
		{ includeContent: true },
	)) as ComposeResult[];
	const out: Record<string, string> = {};
	for (const f of files) {
		out[f.path] = f.content;
	}
	return out;
}

/**
 * Delete every file under a workspace prefix (except manifest.json, regenerated).
 */
async function clearWorkspaceFiles(tenantSlug: string, agentSlug: string): Promise<void> {
	if (!BUCKET) return;
	const prefix = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;
	let continuationToken: string | undefined;

	do {
		const list = await s3.send(
			new ListObjectsV2Command({
				Bucket: BUCKET,
				Prefix: prefix,
				ContinuationToken: continuationToken,
			}),
		);
		const keys = (list.Contents || [])
			.map((o) => ({ Key: o.Key! }))
			.filter((k) => k.Key && !k.Key.endsWith("manifest.json"));
		if (keys.length > 0) {
			await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys } }));
		}
		continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
	} while (continuationToken);
}

/**
 * Write a { path: content } map into an agent's workspace.
 */
async function writeWorkspaceFiles(
	tenantSlug: string,
	agentSlug: string,
	files: Record<string, string>,
): Promise<void> {
	if (!BUCKET) return;
	const prefix = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;
	for (const [relPath, content] of Object.entries(files)) {
		await s3.send(
			new PutObjectCommand({
				Bucket: BUCKET,
				Key: `${prefix}${relPath}`,
				Body: content,
				ContentType: relPath.endsWith(".md") ? "text/markdown" : "text/plain",
			}),
		);
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SnapshotResult {
	versionId: string;
	versionNumber: number;
}

/**
 * Capture current agent state to agent_versions. Returns the new version row.
 * Idempotent in practice because version_number auto-increments per agent.
 */
export async function snapshotAgent(
	agentId: string,
	label: string,
	createdBy: string | null,
): Promise<SnapshotResult> {
	// 1. Fetch agent
	const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
	if (!agent) throw new Error(`Agent ${agentId} not found`);

	// 2. Fetch skills + KBs
	const skills = await db.select().from(agentSkills).where(eq(agentSkills.agent_id, agentId));
	const kbs = await db.select().from(agentKnowledgeBases).where(eq(agentKnowledgeBases.agent_id, agentId));

	// 3. Read workspace files — composed view, not just agent overrides.
	let workspaceFiles: Record<string, string> = {};
	if (agent.slug && agent.tenant_id) {
		try {
			workspaceFiles = await readWorkspaceFiles(agent.tenant_id, agent.id);
		} catch (err) {
			console.warn(`[snapshotAgent] Failed to read workspace for ${agentId}:`, err);
		}
	}

	// 4. Compute next version number
	const [maxRow] = await db
		.select({ max: sql<number>`COALESCE(MAX(${agentVersions.version_number}), 0)` })
		.from(agentVersions)
		.where(eq(agentVersions.agent_id, agentId));
	const nextVersion = (Number(maxRow?.max) || 0) + 1;

	// 5. Insert snapshot
	const [version] = await db
		.insert(agentVersions)
		.values({
			tenant_id: agent.tenant_id!,
			agent_id: agentId,
			version_number: nextVersion,
			label,
			config_snapshot: {
				role: agent.role,
				system_prompt: agent.system_prompt,
				adapter_type: agent.adapter_type,
				adapter_config: agent.adapter_config,
				runtime_config: agent.runtime_config,
				template_id: agent.template_id,
			},
			workspace_snapshot: workspaceFiles,
			skills_snapshot: skills.map((s: any) => ({
				skill_id: s.skill_id,
				config: s.config,
				permissions: s.permissions,
				rate_limit_rpm: s.rate_limit_rpm,
				model_override: s.model_override,
				enabled: s.enabled,
			})),
			knowledge_bases_snapshot: kbs.map((k: any) => ({
				knowledge_base_id: k.knowledge_base_id,
				search_config: k.search_config,
				enabled: k.enabled,
			})),
			guardrail_snapshot: null, // guardrail is template-owned, not agent-owned
			created_by: null, // Cognito sub may not match users.id FK — store null for now
		})
		.returning({ id: agentVersions.id, version_number: agentVersions.version_number });

	return { versionId: version.id, versionNumber: version.version_number };
}

/**
 * Restore an agent from a snapshot. Used by rollbackAgentVersion.
 * Caller should snapshot current state BEFORE calling this so the rollback itself is reversible.
 */
export async function restoreAgentFromSnapshot(
	agentId: string,
	versionId: string,
): Promise<void> {
	const [version] = await db.select().from(agentVersions).where(eq(agentVersions.id, versionId));
	if (!version) throw new Error(`Version ${versionId} not found`);
	if (version.agent_id !== agentId) throw new Error("Version does not belong to this agent");

	const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
	if (!agent) throw new Error(`Agent ${agentId} not found`);

	const configSnap = (version.config_snapshot as any) || {};
	const skillsSnap = (version.skills_snapshot as any[]) || [];
	const kbsSnap = (version.knowledge_bases_snapshot as any[]) || [];
	const workspaceSnap = (version.workspace_snapshot as Record<string, string>) || {};

	// 1. Restore agent fields
	await db
		.update(agents)
		.set({
			role: configSnap.role ?? null,
			system_prompt: configSnap.system_prompt ?? null,
			updated_at: sql`now()`,
		})
		.where(eq(agents.id, agentId));

	// 2. Replace skills
	await db.delete(agentSkills).where(eq(agentSkills.agent_id, agentId));
	if (skillsSnap.length > 0) {
		await db.insert(agentSkills).values(
			skillsSnap.map((s: any) => ({
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

	// 3. Replace KBs
	await db.delete(agentKnowledgeBases).where(eq(agentKnowledgeBases.agent_id, agentId));
	if (kbsSnap.length > 0) {
		await db.insert(agentKnowledgeBases).values(
			kbsSnap.map((k: any) => ({
				agent_id: agentId,
				tenant_id: agent.tenant_id!,
				knowledge_base_id: k.knowledge_base_id,
				search_config: k.search_config,
				enabled: k.enabled ?? true,
			})),
		);
	}

	// 4. Restore workspace
	if (agent.slug && agent.tenant_id) {
		const tenantSlug = await resolveTenantSlug(agent.tenant_id);
		await clearWorkspaceFiles(tenantSlug, agent.slug);
		await writeWorkspaceFiles(tenantSlug, agent.slug, workspaceSnap);
		if (BUCKET) await regenerateManifest(BUCKET, tenantSlug, agent.slug);
	}
}
