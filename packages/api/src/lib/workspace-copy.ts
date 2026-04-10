/**
 * Copy workspace files between S3 prefixes.
 * Used by PRD-30C: Agent Catalog.
 *
 * Copy chain:
 *   defaults → template (on template creation)
 *   template → agent   (on "Use Template")
 */

import {
	S3Client,
	ListObjectsV2Command,
	CopyObjectCommand,
	PutObjectCommand,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({
	region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

const BUCKET = process.env.WORKSPACE_BUCKET || "";

// ---------------------------------------------------------------------------
// Default workspace file content (same as frontend bootstrap)
// ---------------------------------------------------------------------------

const DEFAULT_ROUTER = `# Workspace Router

## default
- load: SOUL.md, IDENTITY.md, USER.md
- skills: all

## chat
- load: docs/tone.md, memory/preferences.md
- skills: all

## email
- load: docs/procedures/
- skills: agent-email-send

## heartbeat
- load: docs/procedures/
- skip: IDENTITY.md, USER.md
- skills: ticket-management
`;

const DEFAULT_FILES: Record<string, string> = {
	"SOUL.md": "# Soul\n\nEdit this file to define your agent's personality and values.\n",
	"IDENTITY.md": "# Identity\n\nEdit this file to define your agent's name and role.\n",
	"USER.md": "# User Context\n\nEdit this file to describe the users this agent works with.\n",
	"ROUTER.md": DEFAULT_ROUTER,
	"memory/lessons.md": "# Lessons Learned\n\nThings this agent has learned across conversations.\n",
	"memory/preferences.md": "# Preferences\n\nDiscovered user and team preferences.\n",
	"memory/contacts.md": "# Contacts\n\nKey people and their roles.\n",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveTenantSlug(tenantId: string): Promise<string> {
	const { db, eq, tenants } = await import("../graphql/utils.js");
	const [tenant] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
	if (!tenant?.slug) throw new Error(`Tenant ${tenantId} not found or has no slug`);
	return tenant.slug;
}

async function copyS3Prefix(srcPrefix: string, dstPrefix: string): Promise<number> {
	let copied = 0;
	let continuationToken: string | undefined;

	do {
		const list = await s3.send(
			new ListObjectsV2Command({
				Bucket: BUCKET,
				Prefix: srcPrefix,
				ContinuationToken: continuationToken,
			}),
		);

		for (const obj of list.Contents || []) {
			if (!obj.Key) continue;
			const relativePath = obj.Key.slice(srcPrefix.length);
			if (!relativePath) continue;

			await s3.send(
				new CopyObjectCommand({
					Bucket: BUCKET,
					CopySource: `${BUCKET}/${obj.Key}`,
					Key: `${dstPrefix}${relativePath}`,
				}),
			);
			copied++;
		}

		continuationToken = list.NextContinuationToken;
	} while (continuationToken);

	return copied;
}

async function ensureDefaultsExist(tenantSlug: string): Promise<void> {
	const prefix = `tenants/${tenantSlug}/agents/_catalog/defaults/workspace/`;
	const list = await s3.send(
		new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: 1 }),
	);
	if ((list.Contents?.length ?? 0) > 0) return; // already seeded

	// Seed default files
	for (const [path, content] of Object.entries(DEFAULT_FILES)) {
		await s3.send(
			new PutObjectCommand({
				Bucket: BUCKET,
				Key: `${prefix}${path}`,
				Body: content,
				ContentType: "text/markdown",
			}),
		);
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Copy default workspace files to a new template.
 * Auto-seeds defaults if they don't exist yet.
 * Source: tenants/{tenantSlug}/agent-catalog/defaults/workspace/
 * Dest:   tenants/{tenantSlug}/agent-catalog/{templateSlug}/workspace/
 */
export async function copyDefaultsToTemplate(
	tenantId: string,
	templateSlug: string,
): Promise<number> {
	const tenantSlug = await resolveTenantSlug(tenantId);
	await ensureDefaultsExist(tenantSlug);
	const srcPrefix = `tenants/${tenantSlug}/agents/_catalog/defaults/workspace/`;
	const dstPrefix = `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/`;
	return copyS3Prefix(srcPrefix, dstPrefix);
}

/**
 * Copy template workspace files to a new agent.
 * Source: tenants/{tenantSlug}/agent-catalog/{templateSlug}/workspace/
 * Dest:   tenants/{tenantSlug}/agents/{agentSlug}/workspace/
 */
export async function copyTemplateWorkspace(
	tenantId: string,
	templateSlug: string,
	agentSlug: string,
): Promise<number> {
	const tenantSlug = await resolveTenantSlug(tenantId);
	const srcPrefix = `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/`;
	const dstPrefix = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;

	const copied = await copyS3Prefix(srcPrefix, dstPrefix);

	if (copied > 0) {
		const { regenerateManifest } = await import("./workspace-manifest.js");
		await regenerateManifest(BUCKET, tenantSlug, agentSlug);
	}

	return copied;
}

/**
 * Overlay class workspace files onto an existing agent workspace.
 *
 * Unlike copyTemplateWorkspace (which assumes a fresh target), this is meant
 * for sync scenarios where the agent already has files:
 *   - Files in the class are copied to the agent, overwriting matching paths.
 *   - Files present on the agent but not on the class are LEFT ALONE (preserves
 *     per-agent additions).
 *
 * Returns the number of files overlaid.
 */
export async function overlayTemplateWorkspace(
	tenantId: string,
	templateSlug: string,
	agentSlug: string,
): Promise<number> {
	const tenantSlug = await resolveTenantSlug(tenantId);
	const srcPrefix = `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/`;
	const dstPrefix = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;

	const copied = await copyS3Prefix(srcPrefix, dstPrefix);

	if (copied > 0) {
		const { regenerateManifest } = await import("./workspace-manifest.js");
		await regenerateManifest(BUCKET, tenantSlug, agentSlug);
	}

	return copied;
}

/**
 * List file paths under a template workspace (relative to workspace root).
 * Used by templateSyncDiff to compare against agent workspace.
 */
export async function listTemplateFiles(
	tenantId: string,
	templateSlug: string,
): Promise<string[]> {
	const tenantSlug = await resolveTenantSlug(tenantId);
	const prefix = `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/`;
	return listWorkspaceFilePaths(prefix);
}

/**
 * List file paths under an agent workspace (relative to workspace root).
 */
export async function listAgentFiles(
	tenantId: string,
	agentSlug: string,
): Promise<string[]> {
	const tenantSlug = await resolveTenantSlug(tenantId);
	const prefix = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;
	return listWorkspaceFilePaths(prefix);
}

async function listWorkspaceFilePaths(prefix: string): Promise<string[]> {
	const paths: string[] = [];
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
			const rel = obj.Key.slice(prefix.length);
			if (!rel || rel === "manifest.json") continue;
			paths.push(rel);
		}
		continuationToken = list.NextContinuationToken;
	} while (continuationToken);
	return paths;
}
