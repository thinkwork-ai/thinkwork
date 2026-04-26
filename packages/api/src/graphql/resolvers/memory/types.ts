/**
 * Memory field resolvers — cross-cutting lookups that enrich MemoryRecord
 * results with data from other subsystems.
 *
 * `wikiPages` joins each recalled/searched/inspected memory record back to
 * the Compounding Memory pipeline's `wiki_section_sources` table so the UI
 * can show "this memory is also distilled into page X." One query per
 * Batched through a request-scoped DataLoader because the mobile memory list
 * asks for wiki chips across hundreds of Hindsight records at once.
 */

import type { GraphQLContext } from "../../context.js";

/**
 * Given a MemoryRecord parent (already resolved from Hindsight / AgentCore
 * into the normalized shape), return the set of active wiki pages that cite
 * it as a source. Empty when the record hasn't been compiled, when the
 * tenant doesn't have the wiki enabled, or when the compile pipeline hasn't
 * run since the record was stored.
 *
 * v1 is strictly owner-scoped — by construction every cited page's owner
 * matches the memory's owner, so no extra visibility check is needed here.
 * The caller's access to the MemoryRecord itself was already validated
 * upstream by memoryRecords/memorySearch/etc.
 */
async function resolveWikiPagesForMemory(
	parent: any,
	_args: unknown,
	ctx: GraphQLContext,
): Promise<unknown[]> {
	const memoryRecordId =
		parent?.memoryRecordId ?? parent?.id ?? parent?.memory_unit_id;
	if (!memoryRecordId || typeof memoryRecordId !== "string") return [];
	return ctx.loaders.wikiPagesByMemoryRecord.load(memoryRecordId);
}

export const memoryRecordTypeResolvers = {
	wikiPages: resolveWikiPagesForMemory,
};
