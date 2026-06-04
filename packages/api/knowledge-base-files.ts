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
import { authenticate } from "./src/lib/cognito-auth.js";
import { resolveCallerFromAuth } from "./src/graphql/resolvers/core/resolve-auth-user.js";

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
  ".txt",
  ".md",
  ".html",
  ".doc",
  ".docx",
  ".csv",
  ".xls",
  ".xlsx",
  ".pdf",
]);
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// HTTP API proxy integrations forward OPTIONS to the Lambda, so we answer the
// CORS preflight ourselves (2xx + headers) or the browser blocks the request.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-api-key, x-tenant-id, x-principal-id",
  "Access-Control-Max-Age": "3600",
};

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    body: JSON.stringify(body),
  };
}

function corsPreflight(): APIGatewayProxyResult {
  return { statusCode: 204, headers: CORS_HEADERS, body: "" };
}

function s3Prefix(tenantSlug: string, kbSlug: string): string {
  return `tenants/${tenantSlug}/knowledge-bases/${kbSlug}/documents/`;
}

async function resolveKb(
  kbId: string,
): Promise<{ tenantId: string; tenantSlug: string; kbSlug: string } | null> {
  const [kb] = await db
    .select({
      tenant_id: knowledgeBases.tenant_id,
      slug: knowledgeBases.slug,
    })
    .from(knowledgeBases)
    .where(eq(knowledgeBases.id, kbId));
  if (!kb) return null;

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, kb.tenant_id));
  if (!tenant?.slug) return null;

  return { tenantId: kb.tenant_id, tenantSlug: tenant.slug, kbSlug: kb.slug };
}

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  // Answer the CORS preflight before auth — the HTTP API forwards OPTIONS here.
  if (event.requestContext?.http?.method === "OPTIONS") {
    return corsPreflight();
  }

  // Accept either a Cognito id-token (the Spaces console) or the shared service
  // secret (internal callers); authenticate() handles both. The previous
  // secret-only check 401'd every browser request from the console.
  const auth = await authenticate(event.headers ?? {});
  if (!auth) {
    return json(401, { ok: false, error: "Unauthorized" });
  }
  const { tenantId: callerTenantId } = await resolveCallerFromAuth(auth);
  if (!callerTenantId) {
    return json(401, { ok: false, error: "Could not resolve caller tenant" });
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
  // Tenant isolation: the caller may only touch documents for a KB in their own
  // tenant (service-secret callers carry no tenant and are trusted).
  if (auth.authType === "cognito" && resolved.tenantId !== callerTenantId) {
    return json(403, { ok: false, error: "Forbidden" });
  }

  const prefix = s3Prefix(resolved.tenantSlug, resolved.kbSlug);

  try {
    if (action === "getUploadUrl") {
      if (!filename) {
        return json(400, {
          ok: false,
          error: "filename is required for getUploadUrl",
        });
      }
      const ext = filename.includes(".")
        ? `.${filename.split(".").pop()!.toLowerCase()}`
        : "";
      if (!ACCEPTED_EXTENSIONS.has(ext)) {
        return json(400, {
          ok: false,
          error: `Unsupported file type: ${ext}. Accepted: ${[...ACCEPTED_EXTENSIONS].join(", ")}`,
        });
      }
      const contentType = body.contentType || "application/octet-stream";
      const key = `${prefix}${filename}`;
      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: contentType as string,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const uploadUrl = await getSignedUrl(s3 as any, command as any, {
        expiresIn: 300,
      });
      return json(200, { ok: true, uploadUrl, key });
    }

    if (action === "upload") {
      if (!filename || !content) {
        return json(400, {
          ok: false,
          error: "filename and content are required for upload",
        });
      }
      const ext = filename.includes(".")
        ? `.${filename.split(".").pop()!.toLowerCase()}`
        : "";
      if (!ACCEPTED_EXTENSIONS.has(ext)) {
        return json(400, {
          ok: false,
          error: `Unsupported file type: ${ext}. Accepted: ${[...ACCEPTED_EXTENSIONS].join(", ")}`,
        });
      }
      // content is base64-encoded for binary files
      const buf = Buffer.from(content, "base64");
      if (buf.length > MAX_FILE_SIZE) {
        return json(400, {
          ok: false,
          error: `File exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        });
      }
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: `${prefix}${filename}`,
          Body: buf,
        }),
      );
      return json(200, { ok: true, key: `${prefix}${filename}` });
    }

    if (action === "list") {
      const files: { name: string; size: number; lastModified: string }[] = [];
      let continuationToken: string | undefined;
      do {
        const result = await s3.send(
          new ListObjectsV2Command({
            Bucket: BUCKET,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
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
        continuationToken = result.IsTruncated
          ? result.NextContinuationToken
          : undefined;
      } while (continuationToken);
      return json(200, { ok: true, files });
    }

    if (action === "delete") {
      if (!filename) {
        return json(400, {
          ok: false,
          error: "filename is required for delete",
        });
      }
      await s3.send(
        new DeleteObjectCommand({
          Bucket: BUCKET,
          Key: `${prefix}${filename}`,
        }),
      );
      return json(200, { ok: true });
    }

    return json(400, { ok: false, error: "Unsupported action" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return json(500, {
      ok: false,
      error: `KB files operation failed: ${message}`,
    });
  }
}
