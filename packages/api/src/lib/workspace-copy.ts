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
	GetObjectCommand,
	PutObjectCommand,
} from "@aws-sdk/client-s3";
import { DEFAULTS_VERSION, loadDefaults } from "@thinkwork/workspace-defaults";

const s3 = new S3Client({
	region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

const BUCKET = process.env.WORKSPACE_BUCKET || "";

// ---------------------------------------------------------------------------
// Default workspace file content
// ---------------------------------------------------------------------------
//
// Canonical content lives in `@thinkwork/workspace-defaults`. The 11 files are:
//   SOUL.md, IDENTITY.md, USER.md, GUARDRAILS.md, MEMORY_GUIDE.md,
//   CAPABILITIES.md, PLATFORM.md, ROUTER.md,
//   memory/lessons.md, memory/preferences.md, memory/contacts.md
//
// Note: `TOOLS.md` — which earlier inline DEFAULT_FILES included — is
// superseded by CAPABILITIES.md per the agent-workspace-files plan and is
// no longer seeded. Existing agent/template S3 prefixes that already have
// TOOLS.md forked from prior bootstrap copies are unaffected until Unit 10
// migration runs.

const DEFAULT_FILES: Record<string, string> = loadDefaults();

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

const VERSION_KEY_SUFFIX = "_defaults_version";

/**
 * Read the stored `_defaults_version` for a tenant's defaults prefix.
 * Returns `0` if the key is missing, corrupt, or the prefix is empty —
 * signaling "needs seeding". Never throws on missing key.
 */
async function readStoredDefaultsVersion(tenantSlug: string): Promise<number> {
	const key = `tenants/${tenantSlug}/agents/_catalog/defaults/workspace/${VERSION_KEY_SUFFIX}`;
	try {
		const resp = await s3.send(
			new GetObjectCommand({ Bucket: BUCKET, Key: key }),
		);
		const body = await resp.Body?.transformToString();
		if (!body) return 0;
		const parsed = Number.parseInt(body.trim(), 10);
		return Number.isFinite(parsed) ? parsed : 0;
	} catch {
		// NoSuchKey or any read error → treat as unseeded.
		return 0;
	}
}

/**
 * Ensure `_catalog/defaults/workspace/` for this tenant is seeded with the
 * current canonical content. Idempotent: callers may invoke on every
 * createAgentTemplate without worry.
 *
 * Semantics:
 *   • Stored version === DEFAULTS_VERSION → no-op (common case).
 *   • Stored version < DEFAULTS_VERSION (or missing) → rewrite ALL 11 files
 *     and bump the stored version. Existing objects are overwritten.
 *   • Never deletes extra files the prefix may hold (e.g., a legacy TOOLS.md)
 *     — that cleanup is left to explicit migration (Unit 10).
 */
export async function ensureDefaultsExist(tenantSlug: string): Promise<{
	seeded: boolean;
	previousVersion: number;
	currentVersion: number;
}> {
	const prefix = `tenants/${tenantSlug}/agents/_catalog/defaults/workspace/`;
	const previousVersion = await readStoredDefaultsVersion(tenantSlug);
	if (previousVersion === DEFAULTS_VERSION) {
		return { seeded: false, previousVersion, currentVersion: DEFAULTS_VERSION };
	}

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
	await s3.send(
		new PutObjectCommand({
			Bucket: BUCKET,
			Key: `${prefix}${VERSION_KEY_SUFFIX}`,
			Body: String(DEFAULTS_VERSION),
			ContentType: "text/plain",
		}),
	);
	return { seeded: true, previousVersion, currentVersion: DEFAULTS_VERSION };
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
