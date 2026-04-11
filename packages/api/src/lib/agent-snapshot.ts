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
	GetObjectCommand,
	PutObjectCommand,
	DeleteObjectsCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { db, eq, sql, agents, agentSkills, agentKnowledgeBases, agentVersions, tenants } from "../graphql/utils.js";
import { regenerateManifest } from "./workspace-manifest.js";

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

async function streamToString(stream: any): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Read every file under a workspace prefix into a { path: content } map.
 * Excludes manifest.json (regenerated on restore).
 */
export async function readWorkspaceFiles(
	tenantSlug: string,
	agentSlug: string,
): Promise<Record<string, string>> {
	if (!BUCKET) return {};
	const prefix = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;
	const out: Record<string, string> = {};
	let continuationToken: string | undefined;

	do {
		const list = await s3.send(
			new ListObjectsV2Command({
				Bucket: BUCKET,
				Prefix: prefix,
				ContinuationToken: continuationToken,
			}),
		);
		for (const obj of list.Contents || []) {
			if (!obj.Key) continue;
			const relPath = obj.Key.slice(prefix.length);
			if (!relPath || relPath === "manifest.json") continue;
			const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
			out[relPath] = await streamToString(res.Body as any);
		}
		continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
	} while (continuationToken);

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

	// 3. Read workspace files
	let workspaceFiles: Record<string, string> = {};
	if (agent.slug && agent.tenant_id) {
		try {
			const tenantSlug = await resolveTenantSlug(agent.tenant_id);
			workspaceFiles = await readWorkspaceFiles(tenantSlug, agent.slug);
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
