/**
 * Admin-side client helpers for the U2 presign/finalize upload dance
 * and the U9 download endpoint. Used by the Thread Detail panel
 * (`apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx`) to
 * wire the operator's "Upload attachment" affordance and the click-to-
 * download row action.
 *
 * Mirrors `apps/computer/src/lib/upload-thread-attachments.ts` — kept
 * separate so the two surfaces can evolve independently (admin's
 * primary use case is mid-pilot operator seeding; computer's is
 * end-user uploads inside a turn).
 *
 * Plan: docs/plans/2026-05-14-002-feat-finance-analysis-pilot-plan.md (U9 remainder)
 */

import { getIdToken } from "@/lib/auth";

const API_URL = import.meta.env.VITE_API_URL || "";

export interface AdminUploadResult {
	attachmentId: string;
	name: string;
	mimeType: string;
	sizeBytes: number;
}

export interface AdminUploadFailure {
	file: File;
	stage: "presign" | "put" | "finalize";
	message: string;
}

export interface AdminUploadBatch {
	uploaded: AdminUploadResult[];
	failures: AdminUploadFailure[];
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
 * Sequential presign → S3 PUT → finalize per file. Returns the list
 * of successful uploads and a parallel failure list (stage + message
 * per failed file).
 */
export async function uploadThreadAttachmentsFromAdmin(input: {
	threadId: string;
	files: File[];
}): Promise<AdminUploadBatch> {
	if (input.files.length === 0) {
		return { uploaded: [], failures: [] };
	}
	const token = await getIdToken();
	if (!token) {
		throw new Error("Not signed in");
	}

	const uploaded: AdminUploadResult[] = [];
	const failures: AdminUploadFailure[] = [];

	for (const file of input.files) {
		try {
			const presign = await presign(input.threadId, file, token);
			try {
				await putToS3(presign.signedPutUrl, file);
			} catch (err) {
				failures.push({
					file,
					stage: "put",
					message: errorMessage(err),
				});
				continue;
			}
			try {
				const fin = await finalize(input.threadId, presign, file, token);
				uploaded.push({
					attachmentId: fin.attachmentId,
					name: fin.name,
					mimeType: fin.mimeType,
					sizeBytes: fin.sizeBytes,
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

/**
 * Trigger a browser download of the attachment. The endpoint returns a
 * 302 redirect to a 5-minute presigned S3 GET URL with
 * `Content-Disposition: attachment` baked into the signature, so the
 * browser will download rather than render inline.
 */
export function buildAttachmentDownloadUrl(input: {
	threadId: string;
	attachmentId: string;
}): string {
	return `${API_URL}/api/threads/${input.threadId}/attachments/${input.attachmentId}/download`;
}

/**
 * Open the download URL in a new tab. The endpoint, when called with
 * `Accept: application/json`, returns `{url}` (the presigned S3 GET
 * URL) instead of a 302. We can't follow a cross-origin 302 from
 * fetch:
 *
 *   - `redirect: 'manual'` → opaque-redirect response (status 0, no
 *      readable Location header)
 *   - `redirect: 'follow'` → fetch strips the Authorization header on
 *     the follow-up GET to S3, which then fails the signature check
 *
 * The presigned URL itself carries
 * `ResponseContentDisposition: attachment` so the eventual
 * `window.open` behaves as a download (no inline render).
 */
export async function downloadThreadAttachment(input: {
	threadId: string;
	attachmentId: string;
}): Promise<void> {
	const token = await getIdToken();
	if (!token) {
		throw new Error("Not signed in");
	}
	const res = await fetch(buildAttachmentDownloadUrl(input), {
		method: "GET",
		headers: {
			authorization: `Bearer ${token}`,
			accept: "application/json",
		},
	});
	if (!res.ok) {
		throw new Error(`download endpoint returned ${res.status}`);
	}
	const body = (await res.json()) as { url?: string };
	if (!body.url) {
		throw new Error("download endpoint returned no url");
	}
	window.open(body.url, "_blank", "noopener,noreferrer");
}

async function presign(
	threadId: string,
	file: File,
	token: string,
): Promise<PresignResponse> {
	const res = await fetch(
		`${API_URL}/api/threads/${threadId}/attachments/presign`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				name: file.name,
				mimeType:
					file.type ||
					"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				sizeBytes: file.size,
			}),
		},
	);
	if (!res.ok) {
		throw new Error(`presign ${res.status}: ${await res.text()}`);
	}
	return (await res.json()) as PresignResponse;
}

async function putToS3(signedUrl: string, file: File): Promise<void> {
	const res = await fetch(signedUrl, {
		method: "PUT",
		body: file,
	});
	if (!res.ok) {
		throw new Error(`S3 PUT ${res.status}: ${await res.text()}`);
	}
}

async function finalize(
	threadId: string,
	presign: PresignResponse,
	file: File,
	token: string,
): Promise<FinalizeResponse> {
	const res = await fetch(
		`${API_URL}/api/threads/${threadId}/attachments/finalize`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				attachmentId: presign.attachmentId,
				stagingKey: presign.stagingKey,
				name: presign.name,
				declaredMimeType:
					file.type ||
					"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				declaredSizeBytes: file.size,
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
