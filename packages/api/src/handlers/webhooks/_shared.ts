/**
 * Shared webhook ingress pattern — Unit 8 (D7b).
 *
 * Each integration-specific Lambda (CRM opportunity, task-event, future Slack /
 * GitHub / inbound email) reduces to three tenant-facing facts:
 *
 *   1. A per-(tenant, integration) signing secret stored at
 *      /thinkwork/tenants/{tenantId}/webhooks/{integration}/signing-secret.
 *   2. A resolver that turns the vendor envelope into
 *      { tenantId, skillId, inputs } — the stable shape startSkillRun expects.
 *   3. A tenant system-user actor that owns the resulting skill_run. No
 *      Cognito identity, no chat permissions, compiled-in scope =
 *      invoke-composition-only (see schema/tenant-system-users.ts).
 *
 * Everything else — HMAC verification, dedup, invoke shape, error envelope —
 * is the same across integrations. This helper owns it once so new
 * integrations can land in under 100 lines.
 *
 * Security notes:
 *   * The HMAC signature covers the raw request body. Signature header is
 *     `x-thinkwork-signature: sha256=<hex>` (matches GitHub's shape).
 *   * Tenant isolation is layered: URL path carries `{tenantId}`, signing
 *     secret is scoped to that tenant, AND the resolver may cross-check the
 *     resolved entity's tenantId against the URL's tenantId. A leaked secret
 *     on its own doesn't let a caller pivot tenants.
 *   * The webhook actor identity is derived server-side — the vendor
 *     payload CAN'T specify which user to invoke on behalf of. This is the
 *     inversion of resolveCaller (the defense-in-depth point of D7b).
 *
 * This module imports `canonicalizeForHash`, `hashResolvedInputs`, and
 * `invokeComposition` from graphql/utils.js so there's no 4th inlined copy
 * of those helpers — see
 * docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md
 * for why three inline copies was acceptable and why a 4th would have been
 * the signal to extract. We stay at three by importing here rather than
 * copying.
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
	SecretsManagerClient,
	GetSecretValueCommand,
	ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import { eq, and, sql } from "drizzle-orm";
import {
	skillRuns,
	tenantSystemUsers,
} from "@thinkwork/database-pg/schema";
import { db } from "../../lib/db.js";
import { error, json } from "../../lib/response.js";
import {
	hashResolvedInputs,
	invokeComposition,
} from "../../graphql/utils.js";

const sm = new SecretsManagerClient({});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebhookResolveResult =
	| {
			ok: true;
			skillId: string;
			inputs: Record<string, unknown>;
			/**
			 * Optional: set for task-completion events so the resulting run
			 * record links back to the run that spawned the task (R8a / D7a
			 * reconciler re-invoke path).
			 */
			triggeredByRunId?: string;
			/**
			 * Optional: skill version to pin (defaults to 1 to match the
			 * existing startSkillRun / job-trigger default).
			 */
			skillVersion?: number;
			/**
			 * Optional: for reconciler deliverables that need to reach the
			 * owning agent, the resolver can hint an agentId. If null, the
			 * delivery layer falls back to the tenant-admin channel and emits
			 * a notification_pending metric (per plan).
			 */
			agentId?: string | null;
	  }
	| {
			/**
			 * Payload was syntactically valid + authenticated, but the event
			 * doesn't warrant a composition run. Example: a task-completion
			 * event for a task that wasn't spawned by a composition.
			 */
			ok: true;
			skip: true;
			reason: string;
	  }
	| {
			/** Resolver-level failure — e.g. cross-tenant entity, missing fields. */
			ok: false;
			status: number;
			message: string;
	  };

export type WebhookResolver = (args: {
	tenantId: string;
	rawBody: string;
	headers: Record<string, string>;
}) => Promise<WebhookResolveResult>;

export interface WebhookHandlerConfig {
	/** Stable identifier used in the signing-secret path and audit logs. */
	integration: string;
	/** Turns the vendor envelope into a startSkillRun request (or skip/fail). */
	resolve: WebhookResolver;
}

// ---------------------------------------------------------------------------
// Per-(tenant, integration) in-memory rate limit — 60/min sliding window.
// Resets on cold start, which is intentional: the DB dedup index is the
// authoritative guard, this just sheds obvious storms without touching DB.
// ---------------------------------------------------------------------------

const RATE_LIMIT_PER_MINUTE = 60;
const rateWindow = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): boolean {
	const now = Date.now();
	const entry = rateWindow.get(key);
	if (!entry || now >= entry.resetAt) {
		rateWindow.set(key, { count: 1, resetAt: now + 60_000 });
		return true;
	}
	if (entry.count >= RATE_LIMIT_PER_MINUTE) return false;
	entry.count++;
	return true;
}

// Exposed for tests that need to force a fresh window.
export function __resetRateLimitForTests() {
	rateWindow.clear();
}

// ---------------------------------------------------------------------------
// Path + auth extraction
// ---------------------------------------------------------------------------

export function extractTenantIdFromPath(
	path: string,
	integration: string,
): string | null {
	// Shape: /webhooks/{integration}/{tenantId}
	const prefix = `/webhooks/${integration}/`;
	if (!path.startsWith(prefix)) return null;
	const rest = path.slice(prefix.length);
	if (!rest || rest.includes("/")) return null;
	// Minimal UUID shape check — rejects obvious garbage without spending a
	// DB call. Real validation happens via the FK + tenant lookup.
	return /^[0-9a-fA-F-]{20,}$/.test(rest) ? rest : null;
}

function extractSignature(headers: Record<string, string>): string | null {
	const raw = headers["x-thinkwork-signature"];
	if (!raw || typeof raw !== "string") return null;
	// Accept both `sha256=<hex>` and bare `<hex>` — vendors vary.
	const match = raw.match(/^sha256=([0-9a-fA-F]+)$/);
	if (match) return match[1].toLowerCase();
	if (/^[0-9a-fA-F]+$/.test(raw)) return raw.toLowerCase();
	return null;
}

export function computeSignature(secret: string, rawBody: string): string {
	return createHmac("sha256", secret).update(rawBody).digest("hex");
}

function constantTimeEqualHex(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	try {
		return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Signing-secret fetch
// ---------------------------------------------------------------------------

export interface SigningSecretFetcher {
	(args: { tenantId: string; integration: string }): Promise<string | null>;
}

export function signingSecretName(tenantId: string, integration: string): string {
	// No leading slash — matches the existing Lambda role's IAM Resource
	// pattern `arn:aws:secretsmanager:…:secret:thinkwork/*` in
	// `terraform/modules/app/lambda-api/main.tf`. AWS Secrets Manager
	// accepts slashes in names, so this path structure is preserved
	// through the resource ARN.
	return `thinkwork/tenants/${tenantId}/webhooks/${integration}/signing-secret`;
}

const defaultFetchSigningSecret: SigningSecretFetcher = async ({
	tenantId,
	integration,
}) => {
	const name = signingSecretName(tenantId, integration);
	try {
		const res = await sm.send(new GetSecretValueCommand({ SecretId: name }));
		return res.SecretString ?? null;
	} catch (err) {
		if (err instanceof ResourceNotFoundException) return null;
		throw err;
	}
};

// ---------------------------------------------------------------------------
// Tenant system-user bootstrap
// ---------------------------------------------------------------------------

/**
 * Returns the tenant's stable system-user uuid, inserting on first use.
 * Never throws on concurrent insertions — `ON CONFLICT DO NOTHING` + a
 * follow-up SELECT handles the race.
 */
export async function ensureTenantSystemUser(
	tenantId: string,
): Promise<string> {
	const [existing] = await db
		.select({ id: tenantSystemUsers.id })
		.from(tenantSystemUsers)
		.where(eq(tenantSystemUsers.tenant_id, tenantId));
	if (existing) return existing.id;

	const inserted = await db
		.insert(tenantSystemUsers)
		.values({ tenant_id: tenantId })
		.onConflictDoNothing({ target: tenantSystemUsers.tenant_id })
		.returning({ id: tenantSystemUsers.id });
	if (inserted[0]) return inserted[0].id;

	// Concurrent writer beat us to it — reselect.
	const [again] = await db
		.select({ id: tenantSystemUsers.id })
		.from(tenantSystemUsers)
		.where(eq(tenantSystemUsers.tenant_id, tenantId));
	if (!again) {
		throw new Error(
			`tenant_system_users bootstrap failed for tenant ${tenantId}`,
		);
	}
	return again.id;
}

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------

interface InternalDeps {
	fetchSigningSecret?: SigningSecretFetcher;
}

export function createWebhookHandler(
	config: WebhookHandlerConfig,
	deps: InternalDeps = {},
) {
	const fetchSigningSecret =
		deps.fetchSigningSecret ?? defaultFetchSigningSecret;

	return async function handleWebhook(
		event: APIGatewayProxyEventV2,
	): Promise<APIGatewayProxyStructuredResultV2> {
		if (event.requestContext.http.method !== "POST") {
			return error("Method not allowed", 405);
		}

		const tenantId = extractTenantIdFromPath(
			event.rawPath,
			config.integration,
		);
		if (!tenantId) {
			// Don't enumerate: the public ingress MUST NOT distinguish
			// "unknown tenant" from "bad signature". Both → 401.
			return error("Unauthorized", 401);
		}

		const rateKey = `${tenantId}:${config.integration}`;
		if (!checkRateLimit(rateKey)) {
			return error("Rate limit exceeded", 429);
		}

		const headers = normalizeHeaders(event.headers);
		const signature = extractSignature(headers);
		if (!signature) return error("Unauthorized", 401);

		const rawBody = event.isBase64Encoded
			? Buffer.from(event.body || "", "base64").toString("utf8")
			: event.body || "";

		const secret = await fetchSigningSecret({
			tenantId,
			integration: config.integration,
		});
		if (!secret) return error("Unauthorized", 401);

		const expected = computeSignature(secret, rawBody);
		if (!constantTimeEqualHex(signature, expected)) {
			return error("Unauthorized", 401);
		}

		// Resolver runs AFTER auth — a bad payload can't surface DB-probing
		// errors to an unauthenticated caller.
		let resolved: WebhookResolveResult;
		try {
			resolved = await config.resolve({ tenantId, rawBody, headers });
		} catch (err) {
			console.error(
				`[webhook:${config.integration}] resolver threw for tenant ${tenantId}:`,
				err,
			);
			return error("Resolver failed", 500);
		}

		if (!resolved.ok) {
			return error(resolved.message, resolved.status);
		}
		if ("skip" in resolved && resolved.skip) {
			// Still 200 — the vendor sent a valid event, we just chose not to
			// act. Returning 4xx would make the vendor retry indefinitely.
			return json({ skipped: true, reason: resolved.reason });
		}

		// TypeScript narrows resolved to the dispatch branch once we've
		// excluded ok:false and skip:true above.
		const dispatch = resolved as Extract<
			WebhookResolveResult,
			{ ok: true; skillId: string }
		>;
		const invokerUserId = await ensureTenantSystemUser(tenantId);
		const resolvedInputs = dispatch.inputs;
		const resolvedInputsHash = hashResolvedInputs(resolvedInputs);

		const inserted = await db
			.insert(skillRuns)
			.values({
				tenant_id: tenantId,
				agent_id: dispatch.agentId ?? null,
				invoker_user_id: invokerUserId,
				skill_id: dispatch.skillId,
				skill_version: dispatch.skillVersion ?? 1,
				invocation_source: "webhook",
				inputs: resolvedInputs,
				resolved_inputs: resolvedInputs,
				resolved_inputs_hash: resolvedInputsHash,
				triggered_by_run_id: dispatch.triggeredByRunId ?? null,
				status: "running",
			})
			.onConflictDoNothing({
				target: [
					skillRuns.tenant_id,
					skillRuns.invoker_user_id,
					skillRuns.skill_id,
					skillRuns.resolved_inputs_hash,
				],
				// Match the partial unique index `uq_skill_runs_dedup_active`
				// (WHERE status='running'). Without this predicate Postgres
				// cannot resolve the ON CONFLICT target against a partial
				// index and raises error 42P10.
				where: sql`status = 'running'`,
			})
			.returning();

		if (inserted.length === 0) {
			// Dedup hit. A replay or an overlapping fire arrived while the
			// first invocation is still running. Return the existing run so
			// the vendor gets a 200 — retrying more won't help them.
			const [existing] = await db
				.select()
				.from(skillRuns)
				.where(
					and(
						eq(skillRuns.tenant_id, tenantId),
						eq(skillRuns.invoker_user_id, invokerUserId),
						eq(skillRuns.skill_id, dispatch.skillId),
						eq(skillRuns.resolved_inputs_hash, resolvedInputsHash),
						eq(skillRuns.status, "running"),
					),
				);
			if (!existing) {
				return error(
					"concurrent webhook race: no row inserted and no matching active run",
					500,
				);
			}
			return json({ runId: existing.id, deduped: true });
		}

		const runRow = inserted[0];
		const invokeResult = await invokeComposition({
			kind: "run_skill",
			runId: runRow.id,
			tenantId,
			invokerUserId,
			skillId: dispatch.skillId,
			skillVersion: runRow.skill_version,
			invocationSource: "webhook",
			resolvedInputs,
			scope: {
				tenantId,
				userId: invokerUserId,
				skillId: dispatch.skillId,
			},
		});

		if (!invokeResult.ok) {
			await db
				.update(skillRuns)
				.set({
					status: "failed",
					failure_reason: invokeResult.error.slice(0, 500),
					finished_at: new Date(),
					updated_at: new Date(),
				})
				.where(eq(skillRuns.id, runRow.id));
			return error(`composition invoke failed: ${invokeResult.error}`, 502);
		}

		return json({ runId: runRow.id, deduped: false });
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeHeaders(
	headers: APIGatewayProxyEventV2["headers"],
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers ?? {})) {
		if (typeof v === "string") out[k.toLowerCase()] = v;
	}
	return out;
}
