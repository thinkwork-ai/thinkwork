/**
 * Thread-attachment registration for runtime-generated files.
 *
 * Route: POST /api/threads/{threadId}/attachments/register
 *
 * Auth: THINKWORK_API_SECRET bearer (agent runtime → API), mirroring
 * /api/email/send — this is NOT a user-facing endpoint. The Pi runtime
 * uploads a sandbox-generated file (execute_code `output_files`) to the
 * workspace bucket under the standard attachment staging prefix, then
 * registers it here so it becomes a downloadable `thread_attachments`
 * row and an email-attachable ref.
 *
 * Content validation matches the user-upload finalize path: size check,
 * magic-byte sniff, and OOXML safety for xlsx.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";

import { getApiAuthSecret, getConfig } from "@thinkwork/runtime-config";
import { db } from "../lib/db.js";
import { error, json, notFound } from "../lib/response.js";
import { threads, threadAttachments } from "@thinkwork/database-pg/schema";
import { emitAuditEvent } from "../lib/compliance/emit.js";
import { sanitizeAttachmentFilename } from "../lib/attachments/filename-sanitization.js";
import {
  validateOoxmlSafety,
  verifyMagicBytes,
} from "../lib/attachments/content-validation.js";
import { attachmentStagingPrefix } from "./thread-attachments-presign.js";

const s3 = new S3Client({});

const MAX_REGISTER_BYTES = 25 * 1024 * 1024;

const MIME_TYPE_SHAPE = /^[\w!#$&^.+-]{1,127}\/[\w!#$&^.+-]{1,127}$/;

function workspaceBucket(): string {
  return getConfig("WORKSPACE_BUCKET") || "";
}

function pickExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function parseBody(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method !== "POST") {
    return error(`Method ${event.requestContext.http.method} not allowed`, 405);
  }
  if (!workspaceBucket()) {
    return error("WORKSPACE_BUCKET env is not configured", 500);
  }

  const authHeader = event.headers?.authorization || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!bearer || bearer !== getApiAuthSecret()) {
    return error("Unauthorized", 401);
  }
  const tenantId = (event.headers?.["x-tenant-id"] || "").toLowerCase();
  if (!tenantId) {
    return error("x-tenant-id header is required", 400);
  }

  const match = event.rawPath.match(
    /^\/api\/threads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/attachments\/register$/i,
  );
  if (!match) {
    return notFound(`Route POST ${event.rawPath} not found`);
  }
  const threadId = match[1]!.toLowerCase();

  // Tenant-pin the thread — the runtime's tenant header must own it.
  const [thread] = await db
    .select({ id: threads.id, tenant_id: threads.tenant_id })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.tenant_id, tenantId)));
  if (!thread) {
    return notFound("Thread not found for tenant");
  }

  const body = parseBody(event.body);
  const filenameResult = sanitizeAttachmentFilename(body.name);
  if (!filenameResult.ok) {
    return error(`name: ${filenameResult.reason}`, 400);
  }
  const safeFilename = filenameResult.sanitized;
  const s3Key = typeof body.s3Key === "string" ? body.s3Key : "";
  const expectedPrefix = attachmentStagingPrefix(tenantId, threadId);
  if (!s3Key.startsWith(expectedPrefix)) {
    return error(
      `s3Key must start with the thread attachment prefix ${expectedPrefix}`,
      400,
    );
  }
  const declaredMimeType =
    typeof body.mimeType === "string" && MIME_TYPE_SHAPE.test(body.mimeType)
      ? body.mimeType
      : "application/octet-stream";

  const object = await s3
    .send(new GetObjectCommand({ Bucket: workspaceBucket(), Key: s3Key }))
    .catch(() => null);
  if (!object?.Body) {
    return error("uploaded object not found at s3Key", 404);
  }
  const actualSize = object.ContentLength ?? 0;
  if (actualSize <= 0 || actualSize > MAX_REGISTER_BYTES) {
    return error(
      `object size ${actualSize} outside bounds (max ${MAX_REGISTER_BYTES})`,
      413,
    );
  }
  const buffer = Buffer.from(
    await (
      object.Body as { transformToByteArray(): Promise<Uint8Array> }
    ).transformToByteArray(),
  );

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

  const inserted = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(threadAttachments)
      .values({
        thread_id: threadId,
        tenant_id: tenantId,
        name: safeFilename,
        s3_key: s3Key,
        mime_type: declaredMimeType,
        size_bytes: buffer.length,
        uploaded_by: null,
      })
      .returning();

    await emitAuditEvent(tx, {
      tenantId,
      actorId: "agent-runtime",
      actorType: "system",
      eventType: "attachment.received",
      source: "lambda",
      payload: {
        attachmentId: row!.id,
        thread_id: threadId,
        mime_type: declaredMimeType,
        size_bytes: buffer.length,
        origin: "execute_code_output",
      },
      resourceType: "thread_attachment",
      resourceId: row!.id,
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
      s3Key,
    },
    201,
  );
}
