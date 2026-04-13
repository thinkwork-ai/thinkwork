/**
 * deleteMemoryRecord — Delete a memory record through the active engine
 * adapter. Engines without a `forget` capability throw a clear error.
 */

import type { GraphQLContext } from "../../context.js";
import { getMemoryServices } from "../../../lib/memory/index.js";

export const deleteMemoryRecord = async (
	_parent: any,
	args: any,
	_ctx: GraphQLContext,
) => {
	const { memoryRecordId } = args as { memoryRecordId: string };

	const { adapter, config } = getMemoryServices();
	if (!adapter.forget) {
		throw new Error(`Memory delete is not supported on engine "${config.engine}"`);
	}
	await adapter.forget(memoryRecordId);
	return true;
};
