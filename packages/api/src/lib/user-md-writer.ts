/**
 * USER.md write-at-assignment (Unit 6).
 *
 * Called from updateAgent when `human_pair_id` is set, changed, or
 * cleared. Resolves the paired human's profile, reads the template USER.md
 * bytes (never the prior agent override — we want the canonical template
 * with placeholders, not whatever was rendered for the previous human),
 * substitutes with the new human's values, and writes the result in full
 * to `{agent}/workspace/USER.md`.
 *
 * Transactional contract:
 *   The caller wraps the DB update + this writer in `db.transaction`. If
 *   the S3 PUT throws, the transaction rolls back and `human_pair_id`
 *   stays at its previous value — so the DB never points at human B while
 *   USER.md still says human A (R11's atomicity requirement).
 *
 * Logging:
 *   Never log name/email/title/timezone/pronouns values — they're PII.
 *   Emit only `{agentId, success, errorCategory?}` from the caller.
 */

import {
	GetObjectCommand,
	NoSuchKey,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import {
	agents,
	agentTemplates,
	tenants,
	users,
	userProfiles,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../graphql/utils.js";
import {
	type PlaceholderValues,
	substitute,
	type SanitizationViolation,
} from "./placeholder-substitution.js";

const REGION =
	process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });

function bucket(): string {
	return process.env.WORKSPACE_BUCKET || "";
}

// Accept either the root `db` handle or a transaction tx — the structural
// subset matches both (Drizzle's PgDatabase and PgTransaction share the
// same query builder surface). Same trick authz.ts uses.
export type DbOrTx = { select: typeof defaultDb.select };

// ─── Key builders ────────────────────────────────────────────────────────────

function agentKey(tenantSlug: string, agentSlug: string, path: string): string {
	return `tenants/${tenantSlug}/agents/${agentSlug}/workspace/${path}`;
}

function templateKey(
	tenantSlug: string,
	templateSlug: string,
	path: string,
): string {
	return `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/${path}`;
}

function defaultsKey(tenantSlug: string, path: string): string {
	return `tenants/${tenantSlug}/agents/_catalog/defaults/workspace/${path}`;
}

// ─── S3 helpers ──────────────────────────────────────────────────────────────

function isNotFound(err: unknown): boolean {
	if (err instanceof NoSuchKey) return true;
	const name = (err as { name?: string } | null)?.name;
	if (name === "NoSuchKey" || name === "NotFound") return true;
	const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
		?.$metadata?.httpStatusCode;
	return status === 404;
}

async function readTemplateBase(
	bkt: string,
	tenantSlug: string,
	templateSlug: string,
	path: string,
): Promise<string | null> {
	try {
		const resp = await s3.send(
			new GetObjectCommand({
				Bucket: bkt,
				Key: templateKey(tenantSlug, templateSlug, path),
			}),
		);
		return (await resp.Body?.transformToString("utf-8")) ?? "";
	} catch (err) {
		if (!isNotFound(err)) throw err;
	}
	try {
		const resp = await s3.send(
			new GetObjectCommand({
				Bucket: bkt,
				Key: defaultsKey(tenantSlug, path),
			}),
		);
		return (await resp.Body?.transformToString("utf-8")) ?? "";
	} catch (err) {
		if (!isNotFound(err)) throw err;
	}
	return null;
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
	// Single retry on transient S3. If this also fails we let the caller
	// surface the error so the DB transaction rolls back.
	await s3.send(
		new PutObjectCommand({
			Bucket: bucket(),
			Key: key,
			Body: body,
			ContentType: "text/markdown",
		}),
	);
}

// ─── DB lookups ──────────────────────────────────────────────────────────────

interface ResolvedAssignment {
	tenantId: string;
	tenantSlug: string;
	tenantName: string;
	agentSlug: string;
	agentName: string;
	templateSlug: string;
	values: PlaceholderValues;
}

async function resolveAssignment(
	tx: DbOrTx,
	agentId: string,
	humanPairId: string | null,
): Promise<ResolvedAssignment | null> {
	const [agent] = await tx
		.select({
			id: agents.id,
			slug: agents.slug,
			name: agents.name,
			tenant_id: agents.tenant_id,
			template_id: agents.template_id,
		})
		.from(agents)
		.where(eq(agents.id, agentId));
	if (!agent || !agent.slug || !agent.template_id) return null;

	const [tenant] = await tx
		.select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
		.from(tenants)
		.where(eq(tenants.id, agent.tenant_id));
	if (!tenant?.slug) return null;

	const [template] = await tx
		.select({ slug: agentTemplates.slug })
		.from(agentTemplates)
		.where(eq(agentTemplates.id, agent.template_id));
	if (!template?.slug) return null;

	const values: PlaceholderValues = {
		AGENT_NAME: agent.name,
		TENANT_NAME: tenant.name,
		HUMAN_NAME: null,
		HUMAN_EMAIL: null,
		HUMAN_TITLE: null,
		HUMAN_TIMEZONE: null,
		HUMAN_PRONOUNS: null,
		HUMAN_CALL_BY: null,
		HUMAN_PHONE: null,
		HUMAN_NOTES: null,
		HUMAN_FAMILY: null,
		HUMAN_CONTEXT: null,
	};

	if (humanPairId) {
		const [user] = await tx
			.select({
				id: users.id,
				name: users.name,
				email: users.email,
				phone: users.phone,
			})
			.from(users)
			.where(eq(users.id, humanPairId));
		if (user) {
			values.HUMAN_NAME = user.name;
			values.HUMAN_EMAIL = user.email;
			// HUMAN_PHONE reads from users.phone (account-level contact info)
			// rather than user_profiles — we don't duplicate it across tables.
			values.HUMAN_PHONE = user.phone;
			const [profile] = await tx
				.select({
					title: userProfiles.title,
					timezone: userProfiles.timezone,
					pronouns: userProfiles.pronouns,
					call_by: userProfiles.call_by,
					notes: userProfiles.notes,
					family: userProfiles.family,
					context: userProfiles.context,
				})
				.from(userProfiles)
				.where(eq(userProfiles.user_id, user.id));
			if (profile) {
				values.HUMAN_TITLE = profile.title;
				values.HUMAN_TIMEZONE = profile.timezone;
				values.HUMAN_PRONOUNS = profile.pronouns;
				values.HUMAN_CALL_BY = profile.call_by;
				values.HUMAN_NOTES = profile.notes;
				values.HUMAN_FAMILY = profile.family;
				values.HUMAN_CONTEXT = profile.context;
			}
		}
	}

	return {
		tenantId: agent.tenant_id,
		tenantSlug: tenant.slug,
		tenantName: tenant.name,
		agentSlug: agent.slug,
		agentName: agent.name,
		templateSlug: template.slug,
		values,
	};
}

// ─── Public entry point ──────────────────────────────────────────────────────

export interface WriteUserMdOptions {
	onViolation?: (v: SanitizationViolation) => void;
}

export class UserMdWriterError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
		this.name = "UserMdWriterError";
	}
}

/**
 * Write USER.md in full for the current state of (agentId, humanPairId).
 *
 * Must be invoked inside `db.transaction` so a failure here rolls back the
 * agent update that triggered it. Callers pass the transaction handle
 * (`tx`) — DB reads run inside the same snapshot as the agent mutation, so
 * the caller can safely re-read fields they just wrote.
 *
 * The caller is responsible for invalidating the composer cache
 * (`invalidateComposerCache({ tenantId, agentId })`) AFTER the DB
 * transaction commits. Invalidating inside this writer would clear the
 * cache prematurely — a subsequent txn rollback would leave the cache
 * miss seeing fresh S3 state that contradicts the rolled-back DB row.
 */
export async function writeUserMdForAssignment(
	tx: DbOrTx,
	agentId: string,
	humanPairId: string | null,
	opts: WriteUserMdOptions = {},
): Promise<void> {
	const bkt = bucket();
	if (!bkt) {
		throw new UserMdWriterError(
			"BUCKET_UNCONFIGURED",
			"WORKSPACE_BUCKET not configured",
		);
	}

	const resolved = await resolveAssignment(tx, agentId, humanPairId);
	if (!resolved) {
		throw new UserMdWriterError(
			"ASSIGNMENT_UNRESOLVABLE",
			"Could not resolve agent, tenant, or template for USER.md write",
		);
	}

	const templateBytes = await readTemplateBase(
		bkt,
		resolved.tenantSlug,
		resolved.templateSlug,
		"USER.md",
	);
	if (templateBytes === null) {
		// No USER.md in template or defaults — nothing to substitute. Skip
		// the PUT rather than writing an empty file; the composer's managed
		// fallback will render em-dashes if any downstream reader needs
		// USER.md.
		return;
	}

	const rendered = substitute(resolved.values, templateBytes, {
		onViolation: opts.onViolation,
	});

	await putWithOneRetry(
		agentKey(resolved.tenantSlug, resolved.agentSlug, "USER.md"),
		rendered,
	);

	// NOTE: Composer cache invalidation is the caller's responsibility,
	// AFTER the DB transaction commits. Invalidating here would clear the
	// cache inside the txn — if a subsequent operation rolls back, the
	// composer would read stale S3 state that no longer matches the DB.
}
