/**
 * updateMemoryRecord — Update a memory's text in Hindsight.
 *
 * PRD-41B Phase 5: Replaces AgentCore Memory update with direct Postgres update.
 */

import type { GraphQLContext } from "../../context.js";
import { db, sql } from "../../utils.js";

export const updateMemoryRecord = async (_parent: any, args: any, _ctx: GraphQLContext) => {
	const { memoryRecordId, content } = args as { memoryRecordId: string; content: string };

	await db.execute(sql`
		UPDATE hindsight.memory_units
		SET text = ${content}, updated_at = NOW()
		WHERE id = ${memoryRecordId}::uuid
	`);

	return true;
};
