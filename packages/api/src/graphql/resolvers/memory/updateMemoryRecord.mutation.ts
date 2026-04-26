/**
 * updateMemoryRecord — Update a memory record's text through the active
 * engine adapter. Engines without an `update` capability throw a clear
 * error.
 */

import type { GraphQLContext } from "../../context.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";

export const updateMemoryRecord = async (
	_parent: any,
	args: any,
	ctx: GraphQLContext,
) => {
	const { memoryRecordId, content } = args as { memoryRecordId: string; content: string };
	await requireMemoryUserScope(ctx, args);

	const { adapter, config } = getMemoryServices();
	if (!adapter.update) {
		throw new Error(`Memory update is not supported on engine "${config.engine}"`);
	}
	await adapter.update(memoryRecordId, content);
	return true;
};
