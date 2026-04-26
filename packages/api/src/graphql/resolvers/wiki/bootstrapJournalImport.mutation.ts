/**
 * bootstrapJournalImport — admin-only fire-and-forget trigger that kicks off
 * a journal-schema bulk ingest on a dedicated worker Lambda and returns
 * immediately.
 *
 * Why async: the ingest calls Hindsight once per record, and Hindsight runs
 * LLM extraction per call. 10 records ≈ 30–90 s; 2,800 records ≈ hours.
 * Neither fits under API Gateway's 30-second HTTP ceiling (synchronous
 * GraphQL mutations can't return later than that).
 *
 * Result shape is just a dispatch acknowledgement. Operator watches:
 *   - CloudWatch logs for the `wiki-bootstrap-import` Lambda (live progress)
 *   - `wiki_compile_jobs` table for the terminal compile job the import
 *     enqueues on completion (this is the one that actually produces pages)
 */

import type { GraphQLContext } from "../../context.js";
import { assertCanAdminWikiScope } from "./auth.js";

interface BootstrapJournalImportArgs {
	accountId: string;
	tenantId: string;
	userId: string;
	limit?: number | null;
}

export const bootstrapJournalImport = async (
	_parent: unknown,
	args: BootstrapJournalImportArgs,
	ctx: GraphQLContext,
) => {
	await assertCanAdminWikiScope(ctx, {
		tenantId: args.tenantId,
		userId: args.userId,
	});

	const fnName = resolveBootstrapFunctionName();
	if (!fnName) {
		return {
			accountId: args.accountId,
			tenantId: args.tenantId,
			userId: args.userId,
			dispatched: false,
			error:
				"wiki-bootstrap-import function name unresolved (STAGE/WIKI_BOOTSTRAP_IMPORT_FN env)",
			dispatchedAt: new Date().toISOString(),
		};
	}

	try {
		const { LambdaClient, InvokeCommand } = await import(
			"@aws-sdk/client-lambda"
		);
		const lambda = new LambdaClient({});
		await lambda.send(
			new InvokeCommand({
				FunctionName: fnName,
				InvocationType: "Event",
				Payload: new TextEncoder().encode(
					JSON.stringify({
						accountId: args.accountId,
						tenantId: args.tenantId,
						userId: args.userId,
						limit: args.limit ?? null,
					}),
				),
			}),
		);
		return {
			accountId: args.accountId,
			tenantId: args.tenantId,
			userId: args.userId,
			dispatched: true,
			error: null,
			dispatchedAt: new Date().toISOString(),
		};
	} catch (err) {
		return {
			accountId: args.accountId,
			tenantId: args.tenantId,
			userId: args.userId,
			dispatched: false,
			error: (err as Error)?.message ?? String(err),
			dispatchedAt: new Date().toISOString(),
		};
	}
};

function resolveBootstrapFunctionName(): string | null {
	if (process.env.WIKI_BOOTSTRAP_IMPORT_FN)
		return process.env.WIKI_BOOTSTRAP_IMPORT_FN;
	const stage = process.env.STAGE;
	if (!stage) return null;
	return `thinkwork-${stage}-api-wiki-bootstrap-import`;
}
