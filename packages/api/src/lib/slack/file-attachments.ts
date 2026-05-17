import { randomUUID } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { messages, threadAttachments } from "@thinkwork/database-pg/schema";

import {
	validateOoxmlSafety,
	verifyMagicBytes,
} from "../attachments/content-validation.js";
import { sanitizeAttachmentFilename } from "../attachments/filename-sanitization.js";
import { emitAuditEvent } from "../compliance/emit.js";
import { db } from "../db.js";
import type { SlackFileRef } from "./envelope.js";

const s3 = new S3Client({});
const MAX_SLACK_ATTACHMENT_BYTES = 50 * 1024 * 1024;

type DbClient = typeof db;

export interface MaterializedSlackAttachment {
	attachmentId: string;
	name: string;
	s3Key: string;
	mimeType: string;
	sizeBytes: number;
}

export interface MaterializeSlackFilesInput {
	tenantId: string;
	threadId: string;
	messageId: string;
	uploadedBy: string;
	botToken: string;
	fileRefs: SlackFileRef[];
}

interface SlackFileDownload {
	buffer: Buffer;
	contentType: string | null;
	sizeBytes: number;
}

interface MaterializeSlackFilesDeps {
	bucket?: string;
	dbClient?: DbClient;
	s3Client?: Pick<S3Client, "send">;
	fetchFile?: (input: {
		botToken: string;
		fileRef: SlackFileRef;
	}) => Promise<SlackFileDownload>;
	createAttachmentId?: () => string;
	emitAudit?: typeof emitAuditEvent;
}

export async function materializeSlackFilesAsThreadAttachments(
	input: MaterializeSlackFilesInput,
	deps: MaterializeSlackFilesDeps = {},
): Promise<MaterializedSlackAttachment[]> {
	if (input.fileRefs.length === 0) return [];

	const bucket = deps.bucket ?? process.env.WORKSPACE_BUCKET ?? "";
	if (!bucket) {
		console.warn("[slack:files] WORKSPACE_BUCKET missing; skipping files", {
			fileCount: input.fileRefs.length,
		});
		return [];
	}

	const dbClient = deps.dbClient ?? db;
	const s3Client = deps.s3Client ?? s3;
	const fetchFile = deps.fetchFile ?? downloadSlackFile;
	const createAttachmentId = deps.createAttachmentId ?? randomUUID;
	const emitAudit = deps.emitAudit ?? emitAuditEvent;

	const materialized: MaterializedSlackAttachment[] = [];
	for (const fileRef of input.fileRefs) {
		const row = await prepareSlackAttachment({
			...input,
			bucket,
			fileRef,
			s3Client,
			fetchFile,
			createAttachmentId,
		});
		if (row) materialized.push(row);
	}

	if (materialized.length === 0) return [];

	await dbClient.transaction(async (tx: any) => {
		await tx.insert(threadAttachments).values(
			materialized.map((attachment) => ({
				id: attachment.attachmentId,
				thread_id: input.threadId,
				tenant_id: input.tenantId,
				name: attachment.name,
				s3_key: attachment.s3Key,
				mime_type: attachment.mimeType,
				size_bytes: attachment.sizeBytes,
				uploaded_by: input.uploadedBy,
			})),
		);

		const [message] = await tx
			.select({ metadata: messages.metadata })
			.from(messages)
			.where(
				and(
					eq(messages.id, input.messageId),
					eq(messages.thread_id, input.threadId),
					eq(messages.tenant_id, input.tenantId),
				),
			)
			.limit(1);
		if (!message)
			throw new Error("Slack message not found for attachment link");

		await tx
			.update(messages)
			.set({
				metadata: mergeAttachmentMetadata(
					message.metadata,
					materialized.map((attachment) => attachment.attachmentId),
				),
			})
			.where(
				and(
					eq(messages.id, input.messageId),
					eq(messages.thread_id, input.threadId),
					eq(messages.tenant_id, input.tenantId),
				),
			);

		for (const attachment of materialized) {
			await emitAudit(tx, {
				tenantId: input.tenantId,
				actorId: input.uploadedBy,
				actorType: "user",
				eventType: "attachment.received",
				source: "lambda",
				payload: {
					attachmentId: attachment.attachmentId,
					thread_id: input.threadId,
					message_id: input.messageId,
					mime_type: attachment.mimeType,
					size_bytes: attachment.sizeBytes,
					source: "slack",
				},
				resourceType: "thread_attachment",
				resourceId: attachment.attachmentId,
				action: "create",
				outcome: "success",
				threadId: input.threadId,
			});
		}
	});

	return materialized;
}

async function prepareSlackAttachment(input: {
	tenantId: string;
	threadId: string;
	uploadedBy: string;
	botToken: string;
	bucket: string;
	fileRef: SlackFileRef;
	s3Client: Pick<S3Client, "send">;
	fetchFile: (input: {
		botToken: string;
		fileRef: SlackFileRef;
	}) => Promise<SlackFileDownload>;
	createAttachmentId: () => string;
}): Promise<MaterializedSlackAttachment | null> {
	const rawFilename =
		input.fileRef.name ??
		`${input.fileRef.id}${extensionForMime(input.fileRef.mimetype)}`;
	const filename = sanitizeAttachmentFilename(rawFilename);
	if (!filename.ok) {
		console.warn("[slack:files] skipping unsupported filename", {
			fileId: input.fileRef.id,
			reason: filename.reason,
		});
		return null;
	}

	if (
		input.fileRef.sizeBytes !== null &&
		input.fileRef.sizeBytes > MAX_SLACK_ATTACHMENT_BYTES
	) {
		console.warn("[slack:files] skipping oversized file", {
			fileId: input.fileRef.id,
			sizeBytes: input.fileRef.sizeBytes,
		});
		return null;
	}

	try {
		const download = await input.fetchFile({
			botToken: input.botToken,
			fileRef: input.fileRef,
		});
		if (
			download.sizeBytes <= 0 ||
			download.sizeBytes > MAX_SLACK_ATTACHMENT_BYTES
		) {
			console.warn("[slack:files] skipping downloaded file with invalid size", {
				fileId: input.fileRef.id,
				sizeBytes: download.sizeBytes,
			});
			return null;
		}

		const ext = pickExtension(filename.sanitized);
		const magic = verifyMagicBytes(download.buffer, ext);
		if (!magic.ok) {
			console.warn("[slack:files] content sniff failed", {
				fileId: input.fileRef.id,
				reason: magic.reason,
			});
			return null;
		}
		if (ext === ".xlsx") {
			const ooxml = await validateOoxmlSafety(download.buffer);
			if (!ooxml.ok) {
				console.warn("[slack:files] OOXML rejection", {
					fileId: input.fileRef.id,
					reason: ooxml.reason,
				});
				return null;
			}
		}

		const attachmentId = input.createAttachmentId();
		const s3Key = attachmentStorageKey(
			input.tenantId,
			input.threadId,
			attachmentId,
			filename.sanitized,
		);
		const mimeType =
			download.contentType ||
			input.fileRef.mimetype ||
			"application/octet-stream";
		await input.s3Client.send(
			new PutObjectCommand({
				Bucket: input.bucket,
				Key: s3Key,
				Body: download.buffer,
				ContentType: mimeType,
			}),
		);
		return {
			attachmentId,
			name: filename.sanitized,
			s3Key,
			mimeType,
			sizeBytes: download.sizeBytes,
		};
	} catch (err) {
		console.warn("[slack:files] failed to materialize Slack file", {
			fileId: input.fileRef.id,
			err: err instanceof Error ? err.message : String(err),
		});
		return null;
	}
}

async function downloadSlackFile(input: {
	botToken: string;
	fileRef: SlackFileRef;
}): Promise<SlackFileDownload> {
	const url = input.fileRef.urlPrivateDownload ?? input.fileRef.urlPrivate;
	if (!url) throw new Error("Slack file is missing url_private");

	const response = await fetch(url, {
		headers: { authorization: `Bearer ${input.botToken}` },
	});
	if (!response.ok) {
		throw new Error(`Slack file download failed: ${response.status}`);
	}

	const declaredLength = Number(response.headers.get("content-length") ?? 0);
	if (declaredLength > MAX_SLACK_ATTACHMENT_BYTES) {
		throw new Error("Slack file exceeds size cap");
	}

	const buffer = Buffer.from(await response.arrayBuffer());
	if (buffer.length > MAX_SLACK_ATTACHMENT_BYTES) {
		throw new Error("Slack file exceeds size cap");
	}
	return {
		buffer,
		contentType: response.headers.get("content-type"),
		sizeBytes: buffer.length,
	};
}

function mergeAttachmentMetadata(
	metadata: unknown,
	attachmentIds: string[],
): Record<string, unknown> {
	const next =
		metadata && typeof metadata === "object" && !Array.isArray(metadata)
			? { ...(metadata as Record<string, unknown>) }
			: {};
	const attachments = Array.isArray(next.attachments)
		? next.attachments.filter((entry) => entry && typeof entry === "object")
		: [];
	const seen = new Set(
		attachments
			.map((entry) => (entry as Record<string, unknown>).attachmentId)
			.filter((id): id is string => typeof id === "string")
			.map((id) => id.toLowerCase()),
	);
	for (const attachmentId of attachmentIds) {
		const normalized = attachmentId.toLowerCase();
		if (seen.has(normalized)) continue;
		attachments.push({ attachmentId: normalized });
		seen.add(normalized);
	}
	return { ...next, attachments };
}

function attachmentStorageKey(
	tenantId: string,
	threadId: string,
	attachmentId: string,
	safeFilename: string,
): string {
	return `tenants/${tenantId}/attachments/${threadId}/${attachmentId}/${safeFilename}`;
}

function pickExtension(filename: string): string {
	const lower = filename.toLowerCase();
	const idx = lower.lastIndexOf(".");
	return idx >= 0 ? lower.slice(idx) : "";
}

function extensionForMime(mimeType: string | null): string {
	switch (mimeType) {
		case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
			return ".xlsx";
		case "application/vnd.ms-excel":
			return ".xls";
		case "text/csv":
		case "application/csv":
			return ".csv";
		case "text/markdown":
			return ".md";
		case "text/plain":
			return ".txt";
		case "application/pdf":
			return ".pdf";
		default:
			return ".txt";
	}
}
