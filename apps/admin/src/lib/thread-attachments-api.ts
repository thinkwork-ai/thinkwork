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
 * Open the download URL in a new tab. Browsers honor the
 * `Content-Disposition: attachment` header on the presigned S3 redirect,
 * so the tab closes immediately after the download starts.
 *
 * The 302 carries the Authorization-required endpoint to the presigned
 * S3 URL which does not require auth — so the user-mediated click flow
 * works without bearer-header rewriting.
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
		},
		redirect: "manual",
	});
	// 302 redirects don't auto-follow with `redirect: 'manual'`.
	// The Location header is the presigned S3 URL — open it in a new
	// tab to trigger the browser's native download.
	const location =
		res.status === 302 ? res.headers.get("location") : null;
	if (!location) {
		throw new Error(`download endpoint returned ${res.status}`);
	}
	window.open(location, "_blank", "noopener,noreferrer");
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
