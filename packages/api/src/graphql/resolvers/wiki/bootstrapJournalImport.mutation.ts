/**
 * bootstrapJournalImport — admin-only bulk ingest of a `journal` schema
 * account's ideas into the Compounding Memory pipeline.
 *
 * Validates the (tenant, agent) scope is legitimate, then delegates to
 * `runJournalImport` which talks to the memory adapter directly. A single
 * terminal compile job is enqueued at the end so the full cursor drains in
 * one pass.
 */

import type { GraphQLContext } from "../../context.js";
import { runJournalImport } from "../../../lib/wiki/journal-import.js";
import { assertCanAdminWikiScope } from "./auth.js";

interface BootstrapJournalImportArgs {
	accountId: string;
	tenantId: string;
	agentId: string;
	limit?: number | null;
}

export const bootstrapJournalImport = async (
	_parent: unknown,
	args: BootstrapJournalImportArgs,
	ctx: GraphQLContext,
) => {
	await assertCanAdminWikiScope(ctx, {
		tenantId: args.tenantId,
		ownerId: args.agentId,
	});

	const result = await runJournalImport({
		accountId: args.accountId,
		tenantId: args.tenantId,
		agentId: args.agentId,
		limit: args.limit ?? undefined,
	});

	return result;
};
