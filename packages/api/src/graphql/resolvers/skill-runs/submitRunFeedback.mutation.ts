/**
 * submitRunFeedback — invoker signals whether the deliverable was useful.
 *
 * Powers R13 adoption metric (≥60% positive signals on the sales-prep
 * anchor). Restricted to the invoker — nobody else's opinion counts for
 * "did THIS run help THIS user."
 */

import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	skillRuns,
	snakeToCamel,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

export class SubmitRunFeedbackError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SubmitRunFeedbackError";
	}
}

const VALID_SIGNALS = new Set(["positive", "negative"]);

export async function submitRunFeedback(
	_parent: unknown,
	args: { input: { runId: string; signal: string; note?: string | null } },
	ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
	const { userId, tenantId } = await resolveCaller(ctx);
	if (!userId || !tenantId) {
		throw new SubmitRunFeedbackError("unauthorized");
	}
	const i = args.input;
	if (!i?.runId || !i.signal) {
		throw new SubmitRunFeedbackError("runId and signal are required");
	}
	if (!VALID_SIGNALS.has(i.signal)) {
		throw new SubmitRunFeedbackError(
			"signal must be 'positive' or 'negative'",
		);
	}

	const [row] = await db
		.select()
		.from(skillRuns)
		.where(and(eq(skillRuns.id, i.runId), eq(skillRuns.tenant_id, tenantId)));
	if (!row) throw new SubmitRunFeedbackError("run not found");
	if (row.invoker_user_id !== userId) {
		throw new SubmitRunFeedbackError("run not found");
	}

	const [updated] = await db
		.update(skillRuns)
		.set({
			feedback_signal: i.signal,
			feedback_note: i.note?.slice(0, 2000) ?? null,
			updated_at: new Date(),
		})
		.where(eq(skillRuns.id, i.runId))
		.returning();

	return snakeToCamel((updated ?? row) as Record<string, unknown>);
}
