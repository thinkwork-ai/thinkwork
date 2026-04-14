/**
 * executeExternalTaskAction — structured action executor for external task
 * providers (LastMile first). Direct-path: no agent round-trip.
 *
 * Returns `{ envelope, threadId, auditMessageId }` so the mobile client can
 * replace optimistic state with the server-confirmed envelope.
 */

import type { GraphQLContext } from "../../context.js";
import { executeExternalTaskAction as executor } from "../../../integrations/external-work-items/executeAction.js";
import type { TaskActionType } from "../../../integrations/external-work-items/types.js";

const VALID_ACTION_TYPES: readonly TaskActionType[] = [
	"external_task.update_status",
	"external_task.assign",
	"external_task.comment",
	"external_task.edit_fields",
	"external_task.refresh",
];

function isActionType(v: unknown): v is TaskActionType {
	return typeof v === "string" && (VALID_ACTION_TYPES as readonly string[]).includes(v);
}

export const executeExternalTaskAction = async (
	_parent: unknown,
	args: { threadId: string; actionType: string; params?: Record<string, unknown> },
	ctx: GraphQLContext,
) => {
	if (!ctx.auth.tenantId) throw new Error("Unauthorized: tenant not resolved");
	if (!ctx.auth.principalId) throw new Error("Unauthorized: principal not resolved");
	if (!isActionType(args.actionType)) {
		throw new Error(`Invalid actionType: ${args.actionType}`);
	}

	const result = await executor({
		threadId: args.threadId,
		actionType: args.actionType,
		params: args.params ?? {},
		tenantId: ctx.auth.tenantId,
		principalId: ctx.auth.principalId,
	});

	return {
		threadId: result.threadId,
		envelope: result.envelope,
		auditMessageId: result.auditMessageId,
	};
};
