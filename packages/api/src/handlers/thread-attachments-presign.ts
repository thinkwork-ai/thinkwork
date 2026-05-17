/**
 * Thread-attachment presign Lambda — U2 of the finance analysis pilot.
 *
 * POST /api/threads/:threadId/attachments/presign
 *
 * Returns a 5-minute presigned PUT URL the end-user client (Computer
 * composer in U1, admin Thread Detail in U9-remainder) uses to upload an
 * Excel/CSV directly to S3. The route is end-user-facing — auth is
 * Cognito JWT with email-fallback tenant resolution (no admin role
 * gate). Tenant pinning happens via `threads.tenant_id` lookup; cross-
 * tenant probes get an identical 404 to "thread does not exist" so no
 * UUID enumeration oracle exists.
 *
 * What presign does:
 *  1. Resolve caller tenant via the email-fallback helper.
 *  2. Look up the thread; assert it belongs to the caller's tenant.
 *  3. Sanitize the requested filename (path traversal + prompt-injection).
 *  4. Validate the declared MIME extension is in the pilot allowlist.
 *  5. Validate the declared size is ≤ the pilot cap (25 MB initially).
 *  6. Mint a UUID `attachmentId` (the durable identifier across S3, DB,
 *     GraphQL, audit).
 *  7. Compose the staging S3 key using DB-resolved (tenant_id,
 *     computer_id, thread_id) — caller-supplied values are NEVER
 *     allowed in the key except the sanitized filename.
 *  8. Issue a presigned PUT URL (5 min TTL); return
 *     `{signedPutUrl, stagingKey, attachmentId, name, expiresAt}`.
 *
 * What presign does NOT do (deferred to finalize):
 *  - Insert a `thread_attachments` row.
 *  - Emit an audit event.
 *  - Inspect file content (the bytes don't exist yet at presign time).
 *
 * Bucket: reuses `WORKSPACE_BUCKET` with a new prefix
 * `tenants/{tenantId}/attachments/{threadId}/{attachmentId}/{filename}`.
 * Lifecycle policy for that prefix ages staging objects after the
 * configured retention (handled at the bucket level, not in this
 * handler).
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { randomUUID } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, eq } from "drizzle-orm";

import { db } from "../lib/db.js";
import { authenticate } from "../lib/cognito-auth.js";
import { resolveCallerFromAuth } from "../graphql/resolvers/core/resolve-auth-user.js";
import {
	error,
	handleCors,
	json,
	notFound,
	unauthorized,
} from "../lib/response.js";
import { threads } from "@thinkwork/database-pg/schema";
import { sanitizeAttachmentFilename } from "../lib/attachments/filename-sanitization.js";

const s3 = new S3Client({});

const PRESIGN_EXPIRES_SECONDS = 300;
const MAX_DECLARED_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB initial pilot cap

const ALLOWED_DECLARED_MIME_TYPES = new Set([
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
	"application/vnd.ms-excel", // .xls
	"text/csv",
	"text/markdown",
	"text/plain",
	"application/pdf",
	"application/csv", // some browsers
	"application/octet-stream", // tolerated — magic-byte sniff at finalize is the real gate
]);

function workspaceBucket(): string {
	return process.env.WORKSPACE_BUCKET || "";
}

export function attachmentStagingKey(
	tenantId: string,
	threadId: string,
	attachmentId: string,
	safeFilename: string,
): string {
	return `tenants/${tenantId}/attachments/${threadId}/${attachmentId}/${safeFilename}`;
}

export function attachmentStagingPrefix(
	tenantId: string,
	threadId: string,
): string {
	return `tenants/${tenantId}/attachments/${threadId}/`;
}

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const cors = handleCors(event);
	if (cors) return cors;

	if (event.requestContext.http.method !== "POST") {
		return error(`Method ${event.requestContext.http.method} not allowed`, 405);
	}

	if (!workspaceBucket()) {
		return error("WORKSPACE_BUCKET env is not configured", 500);
	}

	// Path: /api/threads/{threadId}/attachments/presign
	const match = event.rawPath.match(
		/^\/api\/threads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/attachments\/presign$/i,
	);
	if (!match) {
		return notFound(`Route POST ${event.rawPath} not found`);
	}
	const threadId = match[1]!.toLowerCase();

	const auth = await authenticate(
		event.headers as Record<string, string | undefined>,
	);
	if (!auth) return unauthorized();

	const { tenantId } = await resolveCallerFromAuth(auth);
	if (!tenantId) {
		return error("authentication carried no tenant_id", 401);
	}

	const body = parseBody(event.body);
	const filenameResult = sanitizeAttachmentFilename(body.name);
	if (!filenameResult.ok) {
		return error(`filename: ${filenameResult.reason}`, 400);
	}
	const safeFilename = filenameResult.sanitized;

	const declaredMimeType = typeof body.mimeType === "string" ? body.mimeType : "";
	if (!ALLOWED_DECLARED_MIME_TYPES.has(declaredMimeType)) {
		return error(`mimeType not in allowlist: ${declaredMimeType}`, 415);
	}

	const declaredSizeBytes =
		typeof body.sizeBytes === "number" ? body.sizeBytes : -1;
	if (
		!Number.isFinite(declaredSizeBytes) ||
		declaredSizeBytes <= 0 ||
		declaredSizeBytes > MAX_DECLARED_SIZE_BYTES
	) {
		return error(
			`sizeBytes out of range (1..${MAX_DECLARED_SIZE_BYTES}): ${declaredSizeBytes}`,
			413,
		);
	}

	// Tenant-pin the thread lookup. Return 404 for both "thread does not
	// exist" and "thread exists in another tenant" to eliminate the
	// UUID-enumeration oracle (mirrors the U9-resolver-patch posture).
	const [thread] = await db
		.select({ id: threads.id, tenant_id: threads.tenant_id })
		.from(threads)
		.where(and(eq(threads.id, threadId), eq(threads.tenant_id, tenantId)));
	if (!thread) {
		return notFound("thread not found");
	}

	const attachmentId = randomUUID();
	const stagingKey = attachmentStagingKey(
		tenantId,
		threadId,
		attachmentId,
		safeFilename,
	);

	const command = new PutObjectCommand({
		Bucket: workspaceBucket(),
		Key: stagingKey,
		ContentType: declaredMimeType,
	});
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const signedPutUrl = await getSignedUrl(s3 as any, command as any, {
		expiresIn: PRESIGN_EXPIRES_SECONDS,
	});

	const expiresAt = new Date(
		Date.now() + PRESIGN_EXPIRES_SECONDS * 1000,
	).toISOString();

	return json({
		signedPutUrl,
		stagingKey,
		attachmentId,
		name: safeFilename,
		expiresAt,
	});
}

function parseBody(raw: string | undefined): Record<string, unknown> {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}
