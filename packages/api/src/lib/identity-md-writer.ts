/**
 * IDENTITY.md write-at-rename (name-line surgery).
 *
 * Called from `updateAgent` when `name` changes. Reads the agent's
 * current IDENTITY.md override (if any) and rewrites ONLY the Name line —
 * the rest of the file (Creature, Vibe, Emoji, Avatar, any agent-owned
 * backstory below) survives intact.
 *
 * If no override exists yet, the writer seeds the agent prefix with the
 * template IDENTITY.md and `{{AGENT_NAME}}` substituted to the current
 * agent name.
 *
 * Two anchor shapes are recognized:
 *   - New bullet: `- **Name:** <value>`
 *   - Legacy prose: `Your name is **<value>**.`
 *
 * If neither anchor matches (agent has fully rewritten the file into
 * free prose), the writer logs a warning and performs a full rewrite
 * using the template — personality prose the agent authored is lost in
 * that narrow case, but that's the only correct thing to do if the Name
 * anchor is gone.
 *
 * Transactional contract: the caller wraps the DB update + this writer
 * in `db.transaction`. If the S3 PUT throws, the transaction rolls back
 * and `name` stays at its previous value — DB and S3 never drift.
 */

import {
	GetObjectCommand,
	NoSuchKey,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { agents, tenants } from "@thinkwork/database-pg/schema";
import { loadDefaults } from "@thinkwork/workspace-defaults";
import { db as defaultDb } from "../graphql/utils.js";
import { substitute } from "./placeholder-substitution.js";
import { invalidateComposerCache } from "./workspace-overlay.js";

const REGION =
	process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });

function bucket(): string {
	return process.env.WORKSPACE_BUCKET || "";
}

// Structural subset matching both the root db handle and a tx (same
// trick user-md-writer.ts uses). Callers pass whichever is in scope.
export type DbOrTx = { select: typeof defaultDb.select };

function agentKey(tenantSlug: string, agentSlug: string): string {
	return `tenants/${tenantSlug}/agents/${agentSlug}/workspace/IDENTITY.md`;
}

function isNotFound(err: unknown): boolean {
	if (err instanceof NoSuchKey) return true;
	const name = (err as { name?: string } | null)?.name;
	if (name === "NoSuchKey" || name === "NotFound") return true;
	const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
		?.$metadata?.httpStatusCode;
	return status === 404;
}

function isTransientS3(err: unknown): boolean {
	const code = (err as { $metadata?: { httpStatusCode?: number } } | null)
		?.$metadata?.httpStatusCode;
	if (code && code >= 500 && code < 600) return true;
	const name = (err as { name?: string } | null)?.name;
	return (
		name === "RequestTimeout" ||
		name === "SlowDown" ||
		name === "ServiceUnavailable" ||
		name === "InternalError"
	);
}

async function putWithOneRetry(key: string, body: string): Promise<void> {
	try {
		await s3.send(
			new PutObjectCommand({
				Bucket: bucket(),
				Key: key,
				Body: body,
				ContentType: "text/markdown",
			}),
		);
		return;
	} catch (err) {
		if (!isTransientS3(err)) throw err;
	}
	await s3.send(
		new PutObjectCommand({
			Bucket: bucket(),
			Key: key,
			Body: body,
			ContentType: "text/markdown",
		}),
	);
}

async function readAgentOverride(
	tenantSlug: string,
	agentSlug: string,
): Promise<string | null> {
	try {
		const resp = await s3.send(
			new GetObjectCommand({
				Bucket: bucket(),
				Key: agentKey(tenantSlug, agentSlug),
			}),
		);
		return (await resp.Body?.transformToString("utf-8")) ?? "";
	} catch (err) {
		if (isNotFound(err)) return null;
		throw err;
	}
}

interface ResolvedAgent {
	tenantId: string;
	tenantSlug: string;
	agentSlug: string;
	agentName: string;
}

async function resolveAgent(
	tx: DbOrTx,
	agentId: string,
): Promise<ResolvedAgent | null> {
	const [agent] = await tx
		.select({
			id: agents.id,
			slug: agents.slug,
			name: agents.name,
			tenant_id: agents.tenant_id,
		})
		.from(agents)
		.where(eq(agents.id, agentId));
	if (!agent || !agent.slug) return null;

	const [tenant] = await tx
		.select({ id: tenants.id, slug: tenants.slug })
		.from(tenants)
		.where(eq(tenants.id, agent.tenant_id));
	if (!tenant?.slug) return null;

	return {
		tenantId: agent.tenant_id,
		tenantSlug: tenant.slug,
		agentSlug: agent.slug,
		agentName: agent.name,
	};
}

export class IdentityMdWriterError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
		this.name = "IdentityMdWriterError";
	}
}

// ---------------------------------------------------------------------------
// Name-line surgery
// ---------------------------------------------------------------------------

// New bullet shape: `- **Name:** <anything to end of line>` (multiline match).
const NEW_ANCHOR_RE = /^- \*\*Name:\*\*.*$/m;

// Legacy prose shape: `Your name is **<value>**.`
// Non-greedy inner capture; anchor to the `. ` sentence terminator.
const LEGACY_ANCHOR_RE = /Your name is \*\*[^*]+\*\*\./;

function surgery(existing: string, newName: string): string | null {
	if (NEW_ANCHOR_RE.test(existing)) {
		return existing.replace(NEW_ANCHOR_RE, `- **Name:** ${newName}`);
	}
	if (LEGACY_ANCHOR_RE.test(existing)) {
		return existing.replace(
			LEGACY_ANCHOR_RE,
			`Your name is **${newName}**.`,
		);
	}
	return null;
}

function renderTemplate(agentName: string): string {
	const templates = loadDefaults();
	const template = templates["IDENTITY.md"];
	return substitute({ AGENT_NAME: agentName }, template);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Rewrite the agent's IDENTITY.md with the current agent name.
 *
 * - If an override exists and has a recognized Name anchor, replace only
 *   that line. Everything else in the file is preserved.
 * - If an override exists but neither anchor matches, log a warning and
 *   fall through to a full template rewrite.
 * - If no override exists, seed the agent prefix with the template
 *   IDENTITY.md with `{{AGENT_NAME}}` substituted.
 */
export async function writeIdentityMdForAgent(
	tx: DbOrTx,
	agentId: string,
): Promise<void> {
	const bkt = bucket();
	if (!bkt) {
		throw new IdentityMdWriterError(
			"BUCKET_UNCONFIGURED",
			"WORKSPACE_BUCKET not configured",
		);
	}

	const resolved = await resolveAgent(tx, agentId);
	if (!resolved) {
		throw new IdentityMdWriterError(
			"AGENT_UNRESOLVABLE",
			"Could not resolve agent or tenant for IDENTITY.md write",
		);
	}

	const existing = await readAgentOverride(
		resolved.tenantSlug,
		resolved.agentSlug,
	);

	let rendered: string;
	if (existing === null) {
		rendered = renderTemplate(resolved.agentName);
	} else {
		const mutated = surgery(existing, resolved.agentName);
		if (mutated !== null) {
			rendered = mutated;
		} else {
			console.warn(
				`[identity-md-writer] no Name anchor matched for agentId=${agentId}; performing full template rewrite`,
			);
			rendered = renderTemplate(resolved.agentName);
		}
	}

	await putWithOneRetry(
		agentKey(resolved.tenantSlug, resolved.agentSlug),
		rendered,
	);

	invalidateComposerCache({
		tenantId: resolved.tenantId,
		agentId,
	});
}
