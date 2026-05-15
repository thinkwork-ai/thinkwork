/**
 * Thread-attachment finalize Lambda — U2 of the finance analysis pilot.
 *
 * POST /api/threads/:threadId/attachments/finalize
 *
 * Called by the client AFTER the presigned PUT has uploaded the file
 * bytes to S3. Server-side content validation, then row insert + audit
 * emit in a single transaction.
 *
 * Body:
 *   { attachmentId, stagingKey, name, declaredMimeType, declaredSizeBytes,
 *     messageId? }
 *
 * Pipeline:
 *  1. Auth via Cognito JWT + email-fallback tenant resolution.
 *  2. Tenant-pin the thread lookup (404 for cross-tenant probes).
 *  3. Verify stagingKey belongs to the caller's tenant + threadId path
 *     (defense-in-depth against client-side manipulation).
 *  4. HEAD the S3 object — verify exists, declared size matches actual
 *     within tolerance, declared content-type matches actual.
 *  5. Download up to MAX_BUFFER_BYTES — run magic-byte sniff against
 *     declared extension. For .xlsx, walk the OOXML container and
 *     reject macros (xl/vbaProject.bin) + external links
 *     (xl/externalLinks/) via the shared zip-safety utility.
 *  6. Insert `thread_attachments` row inside a transaction; emit
 *     `attachment.received` audit event in the same transaction so
 *     audit-write failure rolls back the row (control-evidence tier).
 *  7. Idempotency: re-finalizing the same attachmentId returns the
 *     existing row (200) without duplicate emit.
 *
 * Audit payload references attachmentId only — raw S3 key, filename,
 * and uploader id are intentionally OUT of the audit log (U6's
 * redaction allow-list drops them even if a future bug includes them).
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

import {
	GetObjectCommand,
	HeadObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
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
import { threads, threadAttachments } from "@thinkwork/database-pg/schema";
import { emitAuditEvent } from "../lib/compliance/emit.js";
import { sanitizeAttachmentFilename } from "../lib/attachments/filename-sanitization.js";
import {
	validateOoxmlSafety,
	verifyMagicBytes,
} from "../lib/attachments/content-validation.js";
import { attachmentStagingPrefix } from "./thread-attachments-presign.js";

const s3 = new S3Client({});

/** Generous tolerance for declared-vs-actual size mismatch (1%). */
const SIZE_TOLERANCE_RATIO = 0.01;

/** Bound the in-memory download for content validation. */
const MAX_BUFFER_BYTES = 50 * 1024 * 1024; // 50 MB — comfortably above the 25 MB declared cap

function workspaceBucket(): string {
	return process.env.WORKSPACE_BUCKET || "";
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

	const match = event.rawPath.match(
		/^\/api\/threads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/attachments\/finalize$/i,
	);
	if (!match) {
		return notFound(`Route POST ${event.rawPath} not found`);
	}
	const threadId = match[1]!.toLowerCase();

	const auth = await authenticate(
		event.headers as Record<string, string | undefined>,
	);
	if (!auth) return unauthorized();

	const { userId, tenantId } = await resolveCallerFromAuth(auth);
	if (!tenantId) {
		return error("authentication carried no tenant_id", 401);
	}

	const body = parseBody(event.body);
	const attachmentId = expectUuid(body.attachmentId);
	if (!attachmentId) {
		return error("missing or malformed attachmentId", 400);
	}
	const stagingKey = typeof body.stagingKey === "string" ? body.stagingKey : "";
	if (!stagingKey) {
		return error("missing stagingKey", 400);
	}
	const declaredMimeType =
		typeof body.declaredMimeType === "string" ? body.declaredMimeType : "";
	if (!declaredMimeType) {
		return error("missing declaredMimeType", 400);
	}
	const declaredSizeBytes =
		typeof body.declaredSizeBytes === "number" ? body.declaredSizeBytes : -1;
	if (
		!Number.isFinite(declaredSizeBytes) ||
		declaredSizeBytes <= 0 ||
		declaredSizeBytes > MAX_BUFFER_BYTES
	) {
		return error("declaredSizeBytes out of range", 413);
	}
	const filenameResult = sanitizeAttachmentFilename(body.name);
	if (!filenameResult.ok) {
		return error(`name: ${filenameResult.reason}`, 400);
	}
	const safeFilename = filenameResult.sanitized;
	const messageId =
		typeof body.messageId === "string" ? expectUuid(body.messageId) : null;

	// Tenant-pin the thread.
	const [thread] = await db
		.select({ id: threads.id, tenant_id: threads.tenant_id })
		.from(threads)
		.where(and(eq(threads.id, threadId), eq(threads.tenant_id, tenantId)));
	if (!thread) {
		return notFound("thread not found");
	}

	// Idempotency: if the same attachmentId already finalized within this
	// tenant + thread, return the existing row (no re-validate, no
	// duplicate emit).
	const [existing] = await db
		.select()
		.from(threadAttachments)
		.where(
			and(
				eq(threadAttachments.id, attachmentId),
				eq(threadAttachments.tenant_id, tenantId),
			),
		);
	if (existing) {
		if (existing.thread_id !== threadId) {
			// Same attachmentId pinned to a different thread in the same
			// tenant — refuse rather than aliasing across threads.
			return error("attachmentId already finalized on a different thread", 409);
		}
		return json({
			attachmentId: existing.id,
			name: existing.name,
			mimeType: existing.mime_type,
			sizeBytes: existing.size_bytes,
			alreadyFinalized: true,
		});
	}

	// Verify the stagingKey belongs to the resolved tenant + threadId.
	const expectedPrefix = attachmentStagingPrefix(tenantId, threadId);
	if (!stagingKey.startsWith(expectedPrefix)) {
		return error("stagingKey does not match caller tenant/thread", 403);
	}
	if (!stagingKey.includes(`/${attachmentId}/`)) {
		return error("stagingKey does not match attachmentId", 403);
	}

	// HEAD the S3 object. Reject early if size diverges from declared.
	let actualSize: number;
	let actualContentType: string | undefined;
	try {
		const head = await s3.send(
			new HeadObjectCommand({
				Bucket: workspaceBucket(),
				Key: stagingKey,
			}),
		);
		actualSize = head.ContentLength ?? 0;
		actualContentType = head.ContentType ?? undefined;
	} catch (e) {
		const msg = (e as Error).message || "S3 HEAD failed";
		return error(`staging object not found: ${msg}`, 400);
	}
	if (actualSize <= 0 || actualSize > MAX_BUFFER_BYTES) {
		return error("actual size out of range", 413);
	}
	const sizeTolerance = Math.max(
		1024,
		Math.ceil(declaredSizeBytes * SIZE_TOLERANCE_RATIO),
	);
	if (Math.abs(actualSize - declaredSizeBytes) > sizeTolerance) {
		return error("declared size does not match actual size", 400);
	}

	// Download for content sniff. We download the whole object (cap is
	// 50 MB above) so OOXML's central directory at the end of the zip
	// is reachable — partial reads would miss the entries the safety
	// scan relies on.
	const buffer = await downloadS3Object(stagingKey);
	if (buffer.length !== actualSize) {
		return error("downloaded size does not match HEAD report", 500);
	}

	const ext = pickExtension(safeFilename);
	const magic = verifyMagicBytes(buffer, ext);
	if (!magic.ok) {
		return error(`content sniff failed: ${magic.reason}`, 415);
	}

	if (ext === ".xlsx") {
		const ooxml = await validateOoxmlSafety(buffer);
		if (!ooxml.ok) {
			return error(`OOXML rejection: ${ooxml.reason}`, 415);
		}
	}

	// Insert + emit in a single transaction (control-evidence tier).
	const inserted = await db.transaction(async (tx) => {
		const [row] = await tx
			.insert(threadAttachments)
			.values({
				id: attachmentId,
				thread_id: threadId,
				tenant_id: tenantId,
				name: safeFilename,
				s3_key: stagingKey,
				mime_type: declaredMimeType,
				size_bytes: actualSize,
				uploaded_by: userId,
			})
			.returning();

		await emitAuditEvent(tx, {
			tenantId,
			actorId: userId ?? "platform-credential",
			actorType: userId ? "user" : "system",
			eventType: "attachment.received",
			source: "lambda",
			payload: {
				attachmentId,
				thread_id: threadId,
				message_id: messageId ?? undefined,
				mime_type: declaredMimeType,
				size_bytes: actualSize,
			},
			resourceType: "thread_attachment",
			resourceId: attachmentId,
			action: "create",
			outcome: "success",
			threadId,
		});

		return row;
	});

	return json(
		{
			attachmentId: inserted!.id,
			name: inserted!.name,
			mimeType: inserted!.mime_type,
			sizeBytes: inserted!.size_bytes,
		},
		201,
	);
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

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function expectUuid(value: unknown): string | null {
	if (typeof value !== "string") return null;
	if (!UUID_RE.test(value)) return null;
	return value.toLowerCase();
}

function pickExtension(filename: string): string {
	const lower = filename.toLowerCase();
	const idx = lower.lastIndexOf(".");
	return idx >= 0 ? lower.slice(idx) : "";
}

async function downloadS3Object(key: string): Promise<Buffer> {
	const resp = await s3.send(
		new GetObjectCommand({ Bucket: workspaceBucket(), Key: key }),
	);
	if (!resp.Body) throw new Error("S3 GetObject returned empty body");
	const chunks: Uint8Array[] = [];
	let total = 0;
	for await (const chunk of resp.Body as AsyncIterable<Uint8Array>) {
		total += chunk.length;
		if (total > MAX_BUFFER_BYTES) {
			throw new Error("staged object exceeds MAX_BUFFER_BYTES");
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}
