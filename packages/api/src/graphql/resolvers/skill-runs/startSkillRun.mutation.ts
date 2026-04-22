/**
 * startSkillRun — single entry point for every composition invocation path.
 *
 * Chat intent (skill-dispatcher), scheduled (job-trigger), admin catalog
 * ("Run now"), and webhook (Unit 8) all call this mutation. The resolver
 * owes its caller:
 *
 *   1. A server-resolved actor (tenant + user from Cognito; never trust the
 *      client's tenantId).
 *   2. A durable audit row in `skill_runs` — inserted in `running` status
 *      before the AgentCore kickoff, transitioned out of `running` on
 *      failure, and left for the composition runner to update on success.
 *   3. Dedup via the partial unique index on (tenant, invoker, skill,
 *      resolved_inputs_hash) WHERE status='running' — a second call with
 *      identical inputs while the first is still running returns the first
 *      run's id.
 *   4. RequestResponse invocation of the agentcore-invoke Lambda per
 *      auto-memory feedback_avoid_fire_and_forget_lambda_invokes — errors
 *      surface to the client and the row flips to `failed`.
 *
 * Validation of inputs against the skill's Pydantic schema and the
 * `tenant_overridable` allowlist lives inside the AgentCore container —
 * this resolver trusts the skill catalog to reject bad inputs rather than
 * duplicating the schema here. Unit 7's admin surface will surface
 * rejection errors alongside the run row.
 */

import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, sql,
	skillRuns,
	snakeToCamel,
	invokeComposition,
	hashResolvedInputs,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

export class StartSkillRunError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StartSkillRunError";
	}
}

const VALID_INVOCATION_SOURCES = new Set([
	"chat",
	"scheduled",
	"catalog",
	"webhook",
]);

export async function startSkillRun(
	_parent: unknown,
	args: { input: {
		tenantId?: string | null;
		agentId?: string | null;
		skillId: string;
		skillVersion?: number | null;
		invocationSource: string;
		inputs?: string | Record<string, unknown> | null;
		deliveryChannels?: string | unknown[] | null;
	} },
	ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
	const i = args.input;
	if (!i?.skillId || !i.invocationSource) {
		throw new StartSkillRunError("skillId and invocationSource are required");
	}
	if (!VALID_INVOCATION_SOURCES.has(i.invocationSource)) {
		throw new StartSkillRunError(
			`invocationSource must be one of chat|scheduled|catalog|webhook (got ${i.invocationSource})`,
		);
	}

	const { userId, tenantId: callerTenantId } = await resolveCaller(ctx);
	if (!userId || !callerTenantId) {
		throw new StartSkillRunError("unauthorized: caller has no tenant context");
	}

	// Tenant comes from the caller, not the input. The `tenantId` field in
	// StartSkillRunInput exists only for tenant-admin impersonation via the
	// admin catalog path (Unit 7) — and even then the admin's tenant must
	// match. The simple rule here: if caller provides tenantId, it must
	// equal the caller's tenantId. Otherwise we derive it.
	const tenantId = i.tenantId ?? callerTenantId;
	if (tenantId !== callerTenantId) {
		throw new StartSkillRunError("forbidden: tenantId does not match caller");
	}

	const rawInputsRaw = normalizeJson(i.inputs);
	const rawInputs: Record<string, unknown> =
		rawInputsRaw && !Array.isArray(rawInputsRaw) ? rawInputsRaw : {};
	const deliveryChannelsRaw = normalizeJson(i.deliveryChannels);
	const deliveryChannels: unknown[] = Array.isArray(deliveryChannelsRaw)
		? deliveryChannelsRaw
		: [];

	// v1: resolved_inputs == raw inputs. Future units add resolver-tool
	// expansion (e.g., customer slug → customer id) before this hash.
	const resolvedInputs: Record<string, unknown> = rawInputs;
	const resolvedInputsHash = hashResolvedInputs(resolvedInputs);

	const inserted = await db
		.insert(skillRuns)
		.values({
			tenant_id: tenantId,
			agent_id: i.agentId ?? null,
			invoker_user_id: userId,
			skill_id: i.skillId,
			skill_version: i.skillVersion ?? 1,
			invocation_source: i.invocationSource,
			inputs: rawInputs,
			resolved_inputs: resolvedInputs,
			resolved_inputs_hash: resolvedInputsHash,
			delivery_channels: deliveryChannels,
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
			// cannot resolve the ON CONFLICT target against a partial index
			// and raises error 42P10.
			where: sql`status = 'running'`,
		})
		.returning();

	let runRow = inserted[0];
	if (!runRow) {
		// Dedup hit — the partial unique index already has an active run
		// with the same fingerprint. Return it rather than starting a duplicate.
		const [existing] = await db
			.select()
			.from(skillRuns)
			.where(
				and(
					eq(skillRuns.tenant_id, tenantId),
					eq(skillRuns.invoker_user_id, userId),
					eq(skillRuns.skill_id, i.skillId),
					eq(skillRuns.resolved_inputs_hash, resolvedInputsHash),
					eq(skillRuns.status, "running"),
				),
			);
		if (!existing) {
			throw new StartSkillRunError(
				"concurrent startSkillRun race: no row inserted and no matching active run found",
			);
		}
		return snakeToCamel(existing as Record<string, unknown>);
	}

	// Fire the synthetic envelope at agentcore-invoke. RequestResponse per
	// auto-memory feedback_avoid_fire_and_forget_lambda_invokes so enqueue
	// errors surface to the client.
	const invokeResult = await invokeComposition({
		kind: "run_skill",
		runId: runRow.id,
		tenantId,
		invokerUserId: userId,
		skillId: i.skillId,
		skillVersion: runRow.skill_version,
		invocationSource: i.invocationSource,
		resolvedInputs,
		scope: {
			tenantId,
			userId,
			skillId: i.skillId,
		},
	});

	if (!invokeResult.ok) {
		// Transition the row out of `running` so the dedup slot is freed
		// and the client can retry.
		const [failed] = await db
			.update(skillRuns)
			.set({
				status: "failed",
				finished_at: new Date(),
				failure_reason: invokeResult.error.slice(0, 500),
				updated_at: new Date(),
			})
			.where(eq(skillRuns.id, runRow.id))
			.returning();
		runRow = failed ?? runRow;
		throw new StartSkillRunError(
			`composition invoke failed: ${invokeResult.error}`,
		);
	}

	return snakeToCamel(runRow as Record<string, unknown>);
}

function normalizeJson(
	value: string | Record<string, unknown> | unknown[] | null | undefined,
): Record<string, unknown> | unknown[] | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "string") {
		if (!value.trim()) return null;
		try {
			const parsed = JSON.parse(value);
			return parsed ?? null;
		} catch {
			throw new StartSkillRunError("inputs must be valid JSON");
		}
	}
	return value;
}
