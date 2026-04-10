/**
 * Knowledge Base Document Management Lambda
 *
 * REST handler for uploading, listing, and deleting documents in a KB's S3 prefix.
 * Follows the workspace-files.ts pattern.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { knowledgeBases, tenants } from "@thinkwork/database-pg/schema";

interface APIGatewayProxyEvent {
  headers?: Record<string, string | undefined>;
  body?: string | null;
  pathParameters?: Record<string, string | undefined>;
  requestContext?: { http?: { method?: string; path?: string } };
  rawPath?: string;
}

interface APIGatewayProxyResult {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
});
const BUCKET = process.env.WORKSPACE_BUCKET || "";
const db = getDb();

const ACCEPTED_EXTENSIONS = new Set([
  ".txt", ".md", ".html", ".doc", ".docx",
  ".csv", ".xls", ".xlsx", ".pdf",
]);
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}

function authToken(headers?: Record<string, string | undefined>) {
  const auth = headers?.authorization || headers?.Authorization;
  if (!auth) return null;
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
}

function s3Prefix(tenantSlug: string, kbSlug: string): string {
  return `tenants/${tenantSlug}/knowledge-bases/${kbSlug}/documents/`;
}

async function resolveKb(kbId: string): Promise<{ tenantSlug: string; kbSlug: string } | null> {
  const [kb] = await db.select({
    tenant_id: knowledgeBases.tenant_id,
    slug: knowledgeBases.slug,
  }).from(knowledgeBases).where(eq(knowledgeBases.id, kbId));
  if (!kb) return null;

  const [tenant] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, kb.tenant_id));
  if (!tenant?.slug) return null;

  return { tenantSlug: tenant.slug, kbSlug: kb.slug };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const expectedSecret = process.env.API_AUTH_SECRET;
  const token = authToken(event.headers);
  if (!expectedSecret || !token || token !== expectedSecret) {
    return json(401, { ok: false, error: "Unauthorized" });
  }

  if (!BUCKET) {
    return json(500, { ok: false, error: "WORKSPACE_BUCKET not configured" });
  }

  let body: Record<string, any>;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const { action, kbId, filename, content } = body;
  if (!action || !kbId) {
    return json(400, { ok: false, error: "action and kbId are required" });
  }

  const resolved = await resolveKb(kbId);
  if (!resolved) {
    return json(404, { ok: false, error: "Knowledge base not found" });
  }

  const prefix = s3Prefix(resolved.tenantSlug, resolved.kbSlug);

  try {
    if (action === "getUploadUrl") {
      if (!filename) {
        return json(400, { ok: false, error: "filename is required for getUploadUrl" });
      }
      const ext = filename.includes(".") ? `.${filename.split(".").pop()!.toLowerCase()}` : "";
      if (!ACCEPTED_EXTENSIONS.has(ext)) {
        return json(400, { ok: false, error: `Unsupported file type: ${ext}. Accepted: ${[...ACCEPTED_EXTENSIONS].join(", ")}` });
      }
      const contentType = body.contentType || "application/octet-stream";
      const key = `${prefix}${filename}`;
      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: contentType as string,
      });
      const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
      return json(200, { ok: true, uploadUrl, key });
    }

    if (action === "upload") {
      if (!filename || !content) {
        return json(400, { ok: false, error: "filename and content are required for upload" });
      }
      const ext = filename.includes(".") ? `.${filename.split(".").pop()!.toLowerCase()}` : "";
      if (!ACCEPTED_EXTENSIONS.has(ext)) {
        return json(400, { ok: false, error: `Unsupported file type: ${ext}. Accepted: ${[...ACCEPTED_EXTENSIONS].join(", ")}` });
      }
      // content is base64-encoded for binary files
      const buf = Buffer.from(content, "base64");
      if (buf.length > MAX_FILE_SIZE) {
        return json(400, { ok: false, error: `File exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB` });
      }
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${prefix}${filename}`,
        Body: buf,
      }));
      return json(200, { ok: true, key: `${prefix}${filename}` });
    }

    if (action === "list") {
      const files: { name: string; size: number; lastModified: string }[] = [];
      let continuationToken: string | undefined;
      do {
        const result = await s3.send(new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }));
        for (const obj of result.Contents ?? []) {
          if (obj.Key) {
            const name = obj.Key.slice(prefix.length);
            if (name) {
              files.push({
                name,
                size: obj.Size ?? 0,
                lastModified: obj.LastModified?.toISOString() ?? "",
              });
            }
          }
        }
        continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
      } while (continuationToken);
      return json(200, { ok: true, files });
    }

    if (action === "delete") {
      if (!filename) {
        return json(400, { ok: false, error: "filename is required for delete" });
      }
      await s3.send(new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: `${prefix}${filename}`,
      }));
      return json(200, { ok: true });
    }

    return json(400, { ok: false, error: "Unsupported action" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return json(500, { ok: false, error: `KB files operation failed: ${message}` });
  }
}
