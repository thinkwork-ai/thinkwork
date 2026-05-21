/**
 * Client-side helper for the U2 presign → PUT → finalize upload dance.
 *
 * Used by the Computer composers (U1 of finance pilot) to upload Excel/CSV
 * attachments before the `sendMessage` GraphQL mutation. Returns the list
 * of `attachmentId` references the caller embeds in
 * `metadata.attachments` on the message.
 *
 * Tenant + thread pinning is enforced server-side (U2's presign + finalize
 * both 404 cross-tenant probes). This client helper does NOT verify the
 * thread belongs to the caller — the server does that for us.
 *
 * Sequential uploads. Pilot scale (≤5 files per message) doesn't justify
 * the complexity of parallel uploads + abort coordination; if a future
 * use-case wants 50+ attachments per message we can revisit.
 *
 * Plan: docs/plans/2026-05-14-002-feat-finance-analysis-pilot-plan.md (U1)
 */

export interface UploadEndpoints {
	/** Base URL of the Thinkwork API (CloudFront / API GW). */
	apiUrl: string;
	/** Bearer token (Cognito JWT) for the authenticated user. */
	token: string;
}

export interface UploadedAttachment {
	attachmentId: string;
	name: string;
	mimeType: string;
	sizeBytes: number;
}

export interface UploadFailure {
	file: File;
	stage: "presign" | "put" | "finalize";
	message: string;
}

export interface UploadResult {
	uploaded: UploadedAttachment[];
	failures: UploadFailure[];
}

interface PresignResponse {
	signedPutUrl: string;
	stagingKey: string;
	attachmentId: string;
	name: string;
	expiresAt: string;
}

interface FinalizeResponse {
	attachmentId: string;
	name: string;
	mimeType: string;
	sizeBytes: number;
	alreadyFinalized?: boolean;
}

/**
 * Upload a batch of files to a thread, sequentially. Returns the
 * successfully uploaded attachment ids and a failure list for any files
 * that didn't make it past presign / PUT / finalize.
 *
 * The caller decides whether a partial-success result is acceptable
 * (some workflows want all-or-nothing; the pilot accepts partial and
 * surfaces failures inline).
 */
export async function uploadThreadAttachments(input: {
	endpoints: UploadEndpoints;
	threadId: string;
	files: File[];
	/** Optional fetch override for tests; defaults to global fetch. */
	fetchImpl?: typeof fetch;
}): Promise<UploadResult> {
	const fetchImpl = input.fetchImpl ?? fetch;
	const uploaded: UploadedAttachment[] = [];
	const failures: UploadFailure[] = [];

	for (const file of input.files) {
		try {
			const presign = await presignAttachment({
				endpoints: input.endpoints,
				threadId: input.threadId,
				file,
				fetchImpl,
			});
			try {
				await putToS3(presign.signedPutUrl, file, fetchImpl);
			} catch (err) {
				failures.push({
					file,
					stage: "put",
					message: errorMessage(err),
				});
				continue;
			}
			try {
				const finalize = await finalizeAttachment({
					endpoints: input.endpoints,
					threadId: input.threadId,
					presign,
					file,
					fetchImpl,
				});
				uploaded.push({
					attachmentId: finalize.attachmentId,
					name: finalize.name,
					mimeType: finalize.mimeType,
					sizeBytes: finalize.sizeBytes,
				});
			} catch (err) {
				failures.push({
					file,
					stage: "finalize",
					message: errorMessage(err),
				});
			}
		} catch (err) {
			failures.push({
				file,
				stage: "presign",
				message: errorMessage(err),
			});
		}
	}

	return { uploaded, failures };
}

async function presignAttachment(input: {
	endpoints: UploadEndpoints;
	threadId: string;
	file: File;
	fetchImpl: typeof fetch;
}): Promise<PresignResponse> {
	const res = await input.fetchImpl(
		`${input.endpoints.apiUrl}/api/threads/${input.threadId}/attachments/presign`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${input.endpoints.token}`,
			},
			body: JSON.stringify({
				name: input.file.name,
				mimeType:
					input.file.type ||
					"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				sizeBytes: input.file.size,
			}),
		},
	);
	if (!res.ok) {
		throw new Error(`presign ${res.status}: ${await res.text()}`);
	}
	return (await res.json()) as PresignResponse;
}

async function putToS3(
	signedUrl: string,
	file: File,
	fetchImpl: typeof fetch,
): Promise<void> {
	const res = await fetchImpl(signedUrl, {
		method: "PUT",
		body: file,
		// Don't set Content-Type to the file.type here unless the
		// presigned URL was issued with the same — S3 signature mismatch
		// is a common pitfall. The presign call sends the declared MIME
		// to the server which encodes it into the signature; the PUT
		// body's content-type is set to that value by the SignatureV4
		// machinery. Passing `file` as Body lets browsers infer; matches
		// the existing plugin-upload client pattern.
	});
	if (!res.ok) {
		throw new Error(`S3 PUT ${res.status}: ${await res.text()}`);
	}
}

async function finalizeAttachment(input: {
	endpoints: UploadEndpoints;
	threadId: string;
	presign: PresignResponse;
	file: File;
	fetchImpl: typeof fetch;
}): Promise<FinalizeResponse> {
	const res = await input.fetchImpl(
		`${input.endpoints.apiUrl}/api/threads/${input.threadId}/attachments/finalize`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${input.endpoints.token}`,
			},
			body: JSON.stringify({
				attachmentId: input.presign.attachmentId,
				stagingKey: input.presign.stagingKey,
				name: input.presign.name,
				declaredMimeType:
					input.file.type ||
					"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				declaredSizeBytes: input.file.size,
			}),
		},
	);
	if (!res.ok) {
		throw new Error(`finalize ${res.status}: ${await res.text()}`);
	}
	return (await res.json()) as FinalizeResponse;
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
