/**
 * Knowledge Base Document Management Lambda
 *
 * REST handler for uploading, listing, and deleting documents in a KB's S3 prefix.
 * Follows the workspace-files.ts pattern.
 */

import { getConfig } from "@thinkwork/runtime-config";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, asc, count, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  knowledgeBases,
  knowledgeBaseDocuments,
  knowledgeBaseSources,
  tenants,
} from "@thinkwork/database-pg/schema";
import { authenticate } from "./src/lib/cognito-auth.js";
import { resolveCallerFromAuth } from "./src/graphql/resolvers/core/resolve-auth-user.js";
import {
  stampDocumentDeleteIntent,
  stampDocumentUploadIntent,
} from "./src/lib/knowledge/kb-document-manifest.js";

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
function workspaceBucket(): string {
  return getConfig("WORKSPACE_BUCKET", "");
}
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

/** Content types the browser can render inline in a new tab. Everything else
 * presigns as a download (attachment disposition). */
const INLINE_CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/plain",
  ".html": "text/html",
  ".csv": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function extensionOf(key: string): string {
  const base = key.slice(key.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}

/**
 * Customer buckets (s3-connect sources) are granted ONLY to the KB service
 * role — presigning a GET with this Lambda's own credentials would produce a
 * URL that 403s. Assume the KB role (same trust path the manager's preflight
 * and sync listing use) and presign with the assumed credentials.
 */
async function assumeKbRoleS3Client(): Promise<S3Client> {
  const roleArn = getConfig("KB_SERVICE_ROLE_ARN", "");
  if (!roleArn) {
    throw new Error("KB_SERVICE_ROLE_ARN not configured");
  }
  const { STSClient, AssumeRoleCommand } = await import("@aws-sdk/client-sts");
  const sts = new STSClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
  const assumed = await sts.send(
    new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: "kb-document-view",
      DurationSeconds: 900,
    }),
  );
  const credentials = assumed.Credentials;
  if (!credentials?.AccessKeyId) {
    throw new Error(`No credentials returned assuming ${roleArn}`);
  }
  return new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: credentials.AccessKeyId,
      secretAccessKey: credentials.SecretAccessKey!,
      sessionToken: credentials.SessionToken!,
    },
  });
}

interface ManifestDocRow {
  id: string;
  document_key: string;
  ingest_status: string;
  updated_at: Date;
  source_id: string | null;
  source_kind: string | null;
  source_bucket: string | null;
}

async function manifestDocById(
  kbId: string,
  documentId: string,
): Promise<ManifestDocRow | null> {
  const [row] = await db
    .select({
      id: knowledgeBaseDocuments.id,
      document_key: knowledgeBaseDocuments.document_key,
      ingest_status: knowledgeBaseDocuments.ingest_status,
      updated_at: knowledgeBaseDocuments.updated_at,
      source_id: knowledgeBaseDocuments.source_id,
      source_kind: knowledgeBaseSources.kind,
      source_bucket: knowledgeBaseSources.bucket,
    })
    .from(knowledgeBaseDocuments)
    .leftJoin(
      knowledgeBaseSources,
      eq(knowledgeBaseDocuments.source_id, knowledgeBaseSources.id),
    )
    .where(
      and(
        eq(knowledgeBaseDocuments.knowledge_base_id, kbId),
        eq(knowledgeBaseDocuments.id, documentId),
      ),
    );
  return row ?? null;
}

/** Presign a GET for a manifest document. s3-connect documents live in the
 * customer's bucket (read AS the KB service role); managed uploads live in
 * the workspace bucket under the KB prefix. */
async function presignDocumentView(row: ManifestDocRow): Promise<string> {
  const isExternal = row.source_kind === "s3-connect" && row.source_bucket;
  const bucket = isExternal ? row.source_bucket! : workspaceBucket();
  const client = isExternal ? await assumeKbRoleS3Client() : s3;
  const ext = extensionOf(row.document_key);
  const inlineType = INLINE_CONTENT_TYPES[ext];
  const filename = row.document_key.slice(
    row.document_key.lastIndexOf("/") + 1,
  );
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: row.document_key,
    ResponseContentDisposition: inlineType
      ? `inline; filename="${filename.replace(/"/g, "")}"`
      : `attachment; filename="${filename.replace(/"/g, "")}"`,
    ...(inlineType ? { ResponseContentType: inlineType } : {}),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getSignedUrl(client as any, command as any, { expiresIn: 300 });
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

  if (!workspaceBucket()) {
    return json(500, { ok: false, error: "WORKSPACE_BUCKET not configured" });
  }

  let body: Record<string, any>;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const { action, kbId, filename, content } = body;
  if (!action || (!kbId && action !== "getViewUrlByKey")) {
    return json(400, { ok: false, error: "action and kbId are required" });
  }

  // Cross-KB lookup used by the thread Sources block: the client only knows
  // the cited document key, not which KB it lives in. Tenant-scoped by the
  // caller's tenant, so citations can never presign another tenant's files.
  if (action === "getViewUrlByKey") {
    const documentKey = String(body.documentKey ?? "");
    if (!documentKey) {
      return json(400, {
        ok: false,
        error: "documentKey is required for getViewUrlByKey",
      });
    }
    try {
      const [row] = await db
        .select({
          id: knowledgeBaseDocuments.id,
          document_key: knowledgeBaseDocuments.document_key,
          ingest_status: knowledgeBaseDocuments.ingest_status,
          updated_at: knowledgeBaseDocuments.updated_at,
          source_id: knowledgeBaseDocuments.source_id,
          source_kind: knowledgeBaseSources.kind,
          source_bucket: knowledgeBaseSources.bucket,
        })
        .from(knowledgeBaseDocuments)
        .leftJoin(
          knowledgeBaseSources,
          eq(knowledgeBaseDocuments.source_id, knowledgeBaseSources.id),
        )
        .where(
          and(
            eq(knowledgeBaseDocuments.tenant_id, callerTenantId),
            eq(knowledgeBaseDocuments.document_key, documentKey),
          ),
        )
        .limit(1);
      if (!row) {
        return json(404, { ok: false, error: "Document not found" });
      }
      const viewUrl = await presignDocumentView(row);
      return json(200, { ok: true, viewUrl });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return json(500, { ok: false, error: `View URL failed: ${message}` });
    }
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
        Bucket: workspaceBucket(),
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
          Bucket: workspaceBucket(),
          Key: `${prefix}${filename}`,
          Body: buf,
        }),
      );
      // THINK-193 U7: stamp pending-edition intent on the manifest row (if
      // one exists — the first reconcile after the next sync inserts new
      // documents). Presigned uploads (getUploadUrl) are reconcile-only:
      // this handler never observes their completion.
      await stampDocumentUploadIntent(db, {
        knowledgeBaseId: kbId,
        documentKey: `${prefix}${filename}`,
      });
      return json(200, { ok: true, key: `${prefix}${filename}` });
    }

    if (action === "list") {
      const files: { name: string; size: number; lastModified: string }[] = [];
      let continuationToken: string | undefined;
      do {
        const result = await s3.send(
          new ListObjectsV2Command({
            Bucket: workspaceBucket(),
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
          Bucket: workspaceBucket(),
          Key: `${prefix}${filename}`,
        }),
      );
      // THINK-193 U7: stamp pending-delete intent immediately; the next
      // sync's reconciliation chains the Hindsight retraction and the
      // settlement pass verifies Bedrock absence (absent_verified).
      await stampDocumentDeleteIntent(db, {
        knowledgeBaseId: kbId,
        documentKey: `${prefix}${filename}`,
      });
      return json(200, { ok: true });
    }

    if (action === "listManifest") {
      // Paginated manifest view: every indexed document across ALL of the
      // KB's sources (managed uploads AND s3-connect), which the plain S3
      // `list` (workspace prefix only) cannot see.
      const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 1000);
      const offset = Math.max(Number(body.offset) || 0, 0);
      const [{ value: total }] = await db
        .select({ value: count() })
        .from(knowledgeBaseDocuments)
        .where(eq(knowledgeBaseDocuments.knowledge_base_id, kbId));
      const rows = await db
        .select({
          id: knowledgeBaseDocuments.id,
          document_key: knowledgeBaseDocuments.document_key,
          ingest_status: knowledgeBaseDocuments.ingest_status,
          updated_at: knowledgeBaseDocuments.updated_at,
          source_kind: knowledgeBaseSources.kind,
          // THINK-345 U1: the detail rail renders one document's indexing
          // state, so the list query carries those fields rather than adding
          // a per-row round trip.
          projection_status: knowledgeBaseDocuments.projection_status,
          edition: knowledgeBaseDocuments.edition,
          page_count: knowledgeBaseDocuments.page_count,
          last_error: knowledgeBaseDocuments.last_error,
          effective_from: knowledgeBaseDocuments.effective_from,
        })
        .from(knowledgeBaseDocuments)
        .leftJoin(
          knowledgeBaseSources,
          eq(knowledgeBaseDocuments.source_id, knowledgeBaseSources.id),
        )
        .where(eq(knowledgeBaseDocuments.knowledge_base_id, kbId))
        .orderBy(asc(knowledgeBaseDocuments.document_key))
        .limit(limit)
        .offset(offset);
      return json(200, {
        ok: true,
        total,
        documents: rows.map((row) => ({
          id: row.id,
          documentKey: row.document_key,
          name: row.document_key.slice(row.document_key.lastIndexOf("/") + 1),
          status: row.ingest_status,
          sourceKind: row.source_kind ?? "managed-upload",
          updatedAt: row.updated_at?.toISOString() ?? null,
          projectionStatus: row.projection_status ?? null,
          edition: row.edition ?? null,
          pageCount: row.page_count ?? null,
          lastError: row.last_error ?? null,
          effectiveFrom: row.effective_from?.toISOString() ?? null,
        })),
      });
    }

    if (action === "getViewUrl") {
      const documentId = String(body.documentId ?? "");
      if (!documentId) {
        return json(400, {
          ok: false,
          error: "documentId is required for getViewUrl",
        });
      }
      const row = await manifestDocById(kbId, documentId);
      if (!row) {
        return json(404, { ok: false, error: "Document not found" });
      }
      const viewUrl = await presignDocumentView(row);
      return json(200, { ok: true, viewUrl });
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
