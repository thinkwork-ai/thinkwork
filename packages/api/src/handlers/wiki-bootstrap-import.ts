/**
 * wiki-bootstrap-import Lambda.
 *
 * Async worker for `bootstrapJournalImport`. The GraphQL mutation fires this
 * Lambda with InvocationType='Event' and returns immediately — we can't hold
 * the 30-second API Gateway connection for a 2,800-record Hindsight ingest.
 *
 * Progress shows up in CloudWatch logs; final outcome is the compile job the
 * import enqueues on completion (admin polls wiki_compile_jobs for that).
 */

import { runJournalImport } from "../lib/wiki/journal-import.js";

type WikiBootstrapEvent = {
	accountId?: string;
	tenantId?: string;
	userId?: string;
	limit?: number | null;
};

type WikiBootstrapResult = {
	ok: boolean;
	recordsIngested?: number;
	recordsSkipped?: number;
	errors?: number;
	compileJobId?: string | null;
	error?: string;
};

export async function handler(
	event: WikiBootstrapEvent = {},
): Promise<WikiBootstrapResult> {
	if (!event.accountId || !event.tenantId || !event.userId) {
		const msg = "wiki-bootstrap-import: missing accountId/tenantId/userId";
		console.error(`[wiki-bootstrap-import] ${msg}`);
		return { ok: false, error: msg };
	}

	const started = Date.now();
	console.log(
		`[wiki-bootstrap-import] starting account=${event.accountId} tenant=${event.tenantId} user=${event.userId} limit=${event.limit ?? "none"}`,
	);

	try {
		const result = await runJournalImport({
			accountId: event.accountId,
			tenantId: event.tenantId,
			userId: event.userId,
			limit: event.limit ?? undefined,
		});
		const seconds = ((Date.now() - started) / 1000).toFixed(1);
		console.log(
			`[wiki-bootstrap-import] done in ${seconds}s ingested=${result.recordsIngested} skipped=${result.recordsSkipped} errors=${result.errors} compileJobId=${result.compileJobId ?? "null"}`,
		);
		return {
			ok: result.errors === 0,
			recordsIngested: result.recordsIngested,
			recordsSkipped: result.recordsSkipped,
			errors: result.errors,
			compileJobId: result.compileJobId,
		};
	} catch (err) {
		const msg = (err as Error)?.message || String(err);
		console.error(`[wiki-bootstrap-import] failed: ${msg}`);
		return { ok: false, error: msg };
	}
}
