/**
 * In-process cache + fetch helper for `workflow.skill` lookups on the
 * agent-invocation hot path.
 *
 * Used by `chat-agent-invoke` to pack the workflow's intake skill into
 * the AgentCore payload so the agent sees the workflow-specific form +
 * instructions in its system prompt (see
 * `.claude/proposals/lastmile-workflow-skill-proposal.md`).
 *
 * Why cache: every chat message on a task thread would otherwise
 * re-resolve the user's OAuth connection, mint a LastMile PAT, and hit
 * `GET /workflows/{id}` — wasteful when `skill` only changes when
 * LastMile publishes a new workflow revision. 5-min TTL in Lambda
 * memory gets us a hit on every subsequent message of a conversation
 * without a stale-read horizon longer than humans notice.
 *
 * Returns `null` for any reason the dynamic path can't be taken
 * (connector unconfigured, no active connection, no PAT, validation
 * failure, network error). Callers fall back to the legacy flow; the
 * reason is logged via `console.warn("[lastmile.skill.fallback]", ...)`
 * so we can tell "no skill shipped yet" apart from infra regressions.
 */

import { and, eq } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../../../../lib/db.js";
import {
	resolveOAuthToken,
	forceRefreshLastmileUserToken,
} from "../../../../lib/oauth-token.js";
import {
	getOrMintLastmilePat,
	forceRefreshLastmilePat,
} from "../../../../lib/lastmile-pat.js";
import { getConnectorBaseUrl } from "../../../../handlers/task-connectors.js";
import {
	getWorkflow as restGetWorkflow,
	isLastmileRestConfigured,
	validateWorkflowSkill,
	type LastmileWorkflowSkill,
} from "./restClient.js";

const { connections, connectProviders } = schema;

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
	value: LastmileWorkflowSkill | null;
	expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(tenantId: string, workflowId: string): string {
	return `${tenantId}:${workflowId}`;
}

async function resolveLastmilePatForUser(args: {
	tenantId: string;
	userId: string;
}): Promise<{ authToken: string; connectionId: string; baseUrl: string } | null> {
	const baseUrl = await getConnectorBaseUrl(args.tenantId, "lastmile");
	if (!isLastmileRestConfigured({ baseUrl })) return null;

	const [conn] = await db
		.select({
			id: connections.id,
			provider_id: connections.provider_id,
			provider_name: connectProviders.name,
		})
		.from(connections)
		.innerJoin(connectProviders, eq(connections.provider_id, connectProviders.id))
		.where(
			and(
				eq(connections.tenant_id, args.tenantId),
				eq(connections.user_id, args.userId),
				eq(connections.status, "active"),
				eq(connectProviders.provider_type, "task"),
			),
		)
		.limit(1);
	if (!conn) return null;

	const authToken = await getOrMintLastmilePat({
		userId: args.userId,
		getFreshWorkosJwt: () =>
			resolveOAuthToken(conn.id, args.tenantId, conn.provider_id),
	});
	if (!authToken) return null;

	return { authToken, connectionId: conn.id, baseUrl: baseUrl ?? "" };
}

/** Fetch the workflow's `skill` block, validated. Hits the in-memory
 *  cache on repeat calls within 5 minutes. Returns `null` on any
 *  failure (unconfigured connector, missing connection, expired PAT,
 *  network error, schemaVersion mismatch) — the caller should treat
 *  that as "use the legacy form". */
export async function fetchWorkflowSkillForAgent(args: {
	tenantId: string;
	userId: string;
	workflowId: string;
}): Promise<LastmileWorkflowSkill | null> {
	const key = cacheKey(args.tenantId, args.workflowId);
	const cached = cache.get(key);
	if (cached && cached.expiresAt > Date.now()) return cached.value;

	let value: LastmileWorkflowSkill | null = null;
	try {
		const creds = await resolveLastmilePatForUser({
			tenantId: args.tenantId,
			userId: args.userId,
		});
		if (creds) {
			const workflow = await restGetWorkflow({
				workflowId: args.workflowId,
				ctx: {
					authToken: creds.authToken,
					baseUrl: creds.baseUrl,
					refreshToken: () =>
						forceRefreshLastmilePat({
							userId: args.userId,
							getFreshWorkosJwt: () =>
								forceRefreshLastmileUserToken(creds.connectionId, args.tenantId),
						}),
				},
			});
			const check = validateWorkflowSkill(workflow.skill);
			if (check.ok) {
				value = check.skill;
			} else {
				console.warn("[lastmile.skill.fallback]", {
					reason: check.reason,
					workflowId: args.workflowId,
					tenantId: args.tenantId,
					source: "chat-agent-invoke",
				});
			}
		}
	} catch (err) {
		console.warn("[lastmile.skill.fallback]", {
			reason: "fetch_error",
			workflowId: args.workflowId,
			tenantId: args.tenantId,
			source: "chat-agent-invoke",
			message: (err as Error)?.message,
		});
		value = null;
	}

	cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
	return value;
}

/** Test-only: drop a single cache entry so a subsequent fetch re-
 *  resolves from the REST client. Exposed so integration tests don't
 *  need to wait 5 minutes between assertions. */
export function __invalidateWorkflowSkillCacheEntry(
	tenantId: string,
	workflowId: string,
): void {
	cache.delete(cacheKey(tenantId, workflowId));
}
