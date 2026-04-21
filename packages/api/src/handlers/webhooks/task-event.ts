/**
 * Task-event webhook — the reconciler re-invoke path (D7a, Unit 8).
 *
 * When a task that was spawned by a composition gets completed, the task
 * system fires this webhook. We read `triggeredByRunId` from the event's
 * task metadata, look up the original run, and invoke the same skill with
 * the same inputs — letting the composition re-evaluate state and create
 * any remaining tasks without blocking the prior session.
 *
 * Route:
 *   POST /webhooks/task-event/{tenantId}
 *
 * Expected payload shape:
 *   {
 *     "event":  "task.completed",
 *     "taskId": "<task id>",
 *     "metadata": {
 *       "triggeredByRunId": "<run uuid>",
 *       "skillIdHint":      "<skill id>"    // optional fallback
 *     }
 *   }
 *
 * Dedup: the standard partial unique index on (tenant, invoker, skill,
 * resolved_inputs_hash) WHERE status='running' freezes out a second fire
 * that arrives while the first re-tick is still running. Once the first
 * tick completes, a subsequent fire slots cleanly as a new reconciler tick
 * — exactly the behavior required by the reconciler model.
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and } from "drizzle-orm";
import { skillRuns } from "@thinkwork/database-pg/schema";
import { db } from "../../lib/db.js";
import { createWebhookHandler, type WebhookResolveResult } from "./_shared.js";

interface TaskEventPayload {
	event?: string;
	taskId?: string;
	metadata?: {
		triggeredByRunId?: string;
		skillIdHint?: string;
	};
}

const RELEVANT_EVENTS = new Set(["task.completed"]);

export async function resolveTaskEvent(args: {
	tenantId: string;
	rawBody: string;
}): Promise<WebhookResolveResult> {
	let payload: TaskEventPayload;
	try {
		payload = JSON.parse(args.rawBody) as TaskEventPayload;
	} catch {
		return { ok: false, status: 400, message: "invalid JSON body" };
	}

	if (!payload.event || !RELEVANT_EVENTS.has(payload.event)) {
		return {
			ok: true,
			skip: true,
			reason: `event ${payload.event ?? "<missing>"} is not a completion event`,
		};
	}

	const triggeredByRunId = payload.metadata?.triggeredByRunId;
	if (!triggeredByRunId) {
		// No link back to a prior run — can't safely re-tick without
		// impersonating the wrong composition. Log + skip; returning a
		// non-2xx here would make the vendor retry forever.
		return {
			ok: true,
			skip: true,
			reason: "task metadata missing triggeredByRunId; not a composition-spawned task",
		};
	}

	const [prior] = await db
		.select({
			id: skillRuns.id,
			tenant_id: skillRuns.tenant_id,
			skill_id: skillRuns.skill_id,
			skill_version: skillRuns.skill_version,
			resolved_inputs: skillRuns.resolved_inputs,
			agent_id: skillRuns.agent_id,
		})
		.from(skillRuns)
		.where(
			and(
				eq(skillRuns.id, triggeredByRunId),
				eq(skillRuns.tenant_id, args.tenantId),
			),
		);

	if (!prior) {
		// The triggering run is either from another tenant (signature
		// verified for URL's tenant, but the resolved entity doesn't match)
		// or it's been retention-swept. Either way, don't re-tick.
		return {
			ok: false,
			status: 403,
			message: "triggeredByRunId does not belong to this tenant",
		};
	}

	const skillId = prior.skill_id || payload.metadata?.skillIdHint;
	if (!skillId) {
		return {
			ok: true,
			skip: true,
			reason: "prior run has no skill_id and no skillIdHint provided",
		};
	}

	const resolvedInputs =
		(prior.resolved_inputs as Record<string, unknown> | null) ?? {};

	return {
		ok: true,
		skillId,
		skillVersion: prior.skill_version ?? 1,
		inputs: resolvedInputs,
		triggeredByRunId,
		agentId: prior.agent_id ?? null,
	};
}

export const handler = createWebhookHandler({
	integration: "task-event",
	resolve: async (args) => resolveTaskEvent(args),
});

export type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 };
