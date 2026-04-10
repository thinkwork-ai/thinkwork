/**
 * deleteMemoryRecord — Delete a memory from Hindsight.
 *
 * PRD-41B Phase 5: Replaces AgentCore Memory delete with direct Postgres delete.
 */

import type { GraphQLContext } from "../../context.js";
import { db, sql } from "../../utils.js";

export const deleteMemoryRecord = async (_parent: any, args: any, _ctx: GraphQLContext) => {
	const { memoryRecordId } = args as { memoryRecordId: string };

	await db.execute(sql`
		DELETE FROM hindsight.memory_units
		WHERE id = ${memoryRecordId}::uuid
	`);

	return true;
};
