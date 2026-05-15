/**
 * Thread-attachment download Lambda — U9 of the finance analysis pilot.
 *
 * GET /api/threads/:threadId/attachments/:attachmentId/download
 *
 * Returns a 302 redirect to a short-lived (5-minute) presigned S3 GET URL.
 * Tenant-pinned end-to-end: the caller's authoritative tenant must match
 * the thread's tenant AND the attachment's tenant. Cross-tenant probes
 * get an identical 404 to "attachment not found" — no enumeration
 * oracle.
 *
 * Why a server-mediated download rather than exposing s3Key directly:
 *  - The GraphQL `ThreadAttachment` type no longer carries `s3Key`
 *    (removed in U9-resolver-patch). The audit log payload references
 *    only the `attachmentId` UUID. The download endpoint is the
 *    single tenant-pinned access point for the underlying S3 object.
 *  - Cross-thread defense: the URL embeds `threadId` and the handler
 *    verifies the `attachmentId` actually belongs to that thread. An
 *    attachment id alone doesn't unlock the bytes.
 *  - The presigned URL itself sets
 *    `ResponseContentDisposition: attachment; filename="<safeName>"`
 *    so the browser downloads rather than rendering inline — important
 *    for `.xlsx` MIME types that some browsers preview natively and
 *    could leak through prompt-injection in cell content.
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, eq } from "drizzle-orm";

import { db } from "../lib/db.js";
import { authenticate } from "../lib/cognito-auth.js";
import { resolveCallerFromAuth } from "../graphql/resolvers/core/resolve-auth-user.js";
import {
	error,
	handleCors,
	notFound,
	unauthorized,
} from "../lib/response.js";
import { threadAttachments, threads } from "@thinkwork/database-pg/schema";

const s3 = new S3Client({});

const DOWNLOAD_URL_TTL_SECONDS = 300;

function workspaceBucket(): string {
	return process.env.WORKSPACE_BUCKET || "";
}

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const cors = handleCors(event);
	if (cors) return cors;

	if (event.requestContext.http.method !== "GET") {
		return error(`Method ${event.requestContext.http.method} not allowed`, 405);
	}

	if (!workspaceBucket()) {
		return error("WORKSPACE_BUCKET env is not configured", 500);
	}

	const match = event.rawPath.match(
		/^\/api\/threads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/download$/i,
	);
	if (!match) {
		return notFound(`Route GET ${event.rawPath} not found`);
	}
	const threadId = match[1]!.toLowerCase();
	const attachmentId = match[2]!.toLowerCase();

	const auth = await authenticate(
		event.headers as Record<string, string | undefined>,
	);
	if (!auth) return unauthorized();

	const { tenantId } = await resolveCallerFromAuth(auth);
	if (!tenantId) {
		return error("authentication carried no tenant_id", 401);
	}

	// Verify the thread belongs to the caller's tenant. Cross-tenant
	// probe → identical 404 to "thread not found".
	const [thread] = await db
		.select({ id: threads.id })
		.from(threads)
		.where(and(eq(threads.id, threadId), eq(threads.tenant_id, tenantId)));
	if (!thread) {
		return notFound("attachment not found");
	}

	// Verify the attachment belongs to BOTH this thread AND this tenant
	// (defense-in-depth — an attacker who learns an attachmentId from a
	// different thread can't reuse it under a thread they DO have access
	// to).
	const [attachment] = await db
		.select({
			s3_key: threadAttachments.s3_key,
			name: threadAttachments.name,
			mime_type: threadAttachments.mime_type,
		})
		.from(threadAttachments)
		.where(
			and(
				eq(threadAttachments.id, attachmentId),
				eq(threadAttachments.thread_id, threadId),
				eq(threadAttachments.tenant_id, tenantId),
			),
		);
	if (!attachment || !attachment.s3_key) {
		return notFound("attachment not found");
	}

	const safeName = sanitizeContentDispositionFilename(
		attachment.name ?? "attachment",
	);

	const command = new GetObjectCommand({
		Bucket: workspaceBucket(),
		Key: attachment.s3_key,
		ResponseContentDisposition: `attachment; filename="${safeName}"`,
		ResponseContentType: attachment.mime_type ?? "application/octet-stream",
	});
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const signedUrl = await getSignedUrl(s3 as any, command as any, {
		expiresIn: DOWNLOAD_URL_TTL_SECONDS,
	});

	// Response shape: 302 by default (matches the direct-navigation flow
	// where a browser opens the URL in the address bar — followed
	// natively). When the caller sends `Accept: application/json`, return
	// `{url}` instead. The XHR/fetch path can't follow a cross-origin
	// 302 with credentials — `fetch(..., {redirect: 'manual'})` returns
	// an opaque-redirect response (status 0, no readable Location), and
	// `redirect: 'follow'` strips the Authorization header on the
	// follow-up request to S3 (which then 400s on the dropped header).
	// Returning JSON sidesteps both. The presigned URL itself already
	// carries `ResponseContentDisposition: attachment` so the eventual
	// window.open behaves as a download.
	const accept = (event.headers?.accept || event.headers?.Accept || "").toLowerCase();
	if (accept.includes("application/json")) {
		return {
			statusCode: 200,
			headers: {
				"content-type": "application/json",
				"cache-control": "no-store",
			},
			body: JSON.stringify({
				url: signedUrl,
				expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
				name: attachment.name ?? null,
				mimeType: attachment.mime_type ?? null,
			}),
		};
	}

	return {
		statusCode: 302,
		headers: { location: signedUrl },
		body: "",
	};
}

/**
 * Strip filename characters that would break the
 * `Content-Disposition: attachment; filename="..."` header. The
 * presign + finalize layer already sanitized the filename for
 * path-traversal and prompt-injection (`sanitizeAttachmentFilename`),
 * but `Content-Disposition` has its own quoting rules — backslashes
 * and double-quotes must be escaped.
 */
function sanitizeContentDispositionFilename(name: string): string {
	return name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
