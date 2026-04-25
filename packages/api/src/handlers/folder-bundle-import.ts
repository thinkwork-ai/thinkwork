import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@thinkwork/database-pg";
import { agents, tenantMembers, tenants } from "@thinkwork/database-pg/schema";

import { authenticate } from "../lib/cognito-auth.js";
import { resolveCallerFromAuth } from "../graphql/resolvers/core/resolve-auth-user.js";
import {
  error,
  forbidden,
  handleCors,
  json,
  notFound,
  unauthorized,
} from "../lib/response.js";
import {
  type ImportBundleRequest,
  type ImportBundleStorage,
  importFolderBundle,
} from "../lib/folder-bundle-importer.js";
import { invalidateComposerCache } from "../lib/workspace-overlay.js";

const s3 = new S3Client({});

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
  if (!workspaceBucket())
    return error("WORKSPACE_BUCKET env is not configured", 500);

  const agentId = event.pathParameters?.agentId ?? pathAgentId(event.rawPath);
  if (!agentId) return notFound("agent not found");

  const auth = await authenticate(
    event.headers as Record<string, string | undefined>,
  );
  if (!auth) return unauthorized();

  const { userId, tenantId } = await resolveCallerFromAuth(auth);
  if (!tenantId) return error("authentication carried no tenant_id", 401);

  const target = await resolveAgentImportTarget(agentId, tenantId);
  if (!target) return notFound("agent not found");

  const isAdmin = await callerIsTenantAdmin(target.tenantId, userId);
  if (!isAdmin) return forbidden("caller is not a tenant admin or owner");

  const body = parseBody(event.body);
  const request = parseImportRequest(body);
  if (!request.ok) return error(request.message, 400);

  const rateLimit = await checkImportRateLimit(target.tenantId);
  if (!rateLimit.ok) {
    return json(
      {
        ok: false,
        code: "ImportRateLimited",
        error: "Import rate limit exceeded",
        retryAfter: rateLimit.retryAfter,
      },
      429,
    );
  }

  const storage = makeStorage(target);
  let result;
  try {
    result = await importFolderBundle(request.request, {
      agentId: target.agentId,
      storage,
    });
  } catch (err) {
    console.error("folder-bundle-import failed:", err);
    return error("internal server error", 500);
  }
  if (!result.ok) {
    return json(
      {
        ok: false,
        code: result.code,
        error: result.message,
        details: result.details,
      },
      result.statusCode,
    );
  }

  invalidateComposerCache({
    tenantId: target.tenantId,
    agentId: target.agentId,
  });
  return json({
    ok: true,
    importedPaths: result.importedPaths,
    routingRowAdded: result.routingRowAdded,
  });
}

async function checkImportRateLimit(
  tenantId: string,
): Promise<{ ok: true } | { ok: false; retryAfter: string }> {
  const result = await getDb().execute(sql`
		INSERT INTO folder_bundle_import_rate_limits
			(tenant_id, utc_hour, import_count, updated_at)
		VALUES
			(${tenantId}::uuid, date_trunc('hour', now()), 1, now())
		ON CONFLICT (tenant_id, utc_hour) DO UPDATE
			SET import_count = folder_bundle_import_rate_limits.import_count + 1,
			    updated_at = now()
			WHERE folder_bundle_import_rate_limits.import_count < 10
		RETURNING import_count
	`);
  const rows = (result as { rows?: unknown[] }).rows ?? [];
  if (rows.length > 0) return { ok: true };
  const retry = await getDb().execute(sql`
		SELECT date_trunc('hour', now()) + interval '1 hour' AS retry_after
	`);
  const retryAfter =
    (retry as { rows?: Array<{ retry_after?: Date | string }> }).rows?.[0]
      ?.retry_after ?? new Date(Date.now() + 60 * 60 * 1000);
  return {
    ok: false,
    retryAfter:
      retryAfter instanceof Date
        ? retryAfter.toISOString()
        : String(retryAfter),
  };
}

interface ImportTarget {
  agentId: string;
  tenantId: string;
  tenantSlug: string;
  agentSlug: string;
}

async function resolveAgentImportTarget(
  agentId: string,
  callerTenantId: string,
): Promise<ImportTarget | null> {
  const [agent] = await getDb()
    .select({
      id: agents.id,
      slug: agents.slug,
      tenant_id: agents.tenant_id,
    })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent || agent.tenant_id !== callerTenantId || !agent.slug) return null;

  const [tenant] = await getDb()
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, agent.tenant_id))
    .limit(1);
  if (!tenant?.slug) return null;

  return {
    agentId: agent.id,
    tenantId: agent.tenant_id,
    tenantSlug: tenant.slug,
    agentSlug: agent.slug,
  };
}

async function callerIsTenantAdmin(
  tenantId: string,
  principalId: string | null,
): Promise<boolean> {
  if (!principalId) return false;
  const rows = await getDb()
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenant_id, tenantId),
        eq(tenantMembers.principal_id, principalId),
      ),
    )
    .limit(1);
  const role = rows[0]?.role;
  return role === "owner" || role === "admin";
}

function makeStorage(target: ImportTarget): ImportBundleStorage {
  const prefix = `tenants/${target.tenantSlug}/agents/${target.agentSlug}/workspace/`;
  return {
    async getText(path) {
      try {
        const resp = await s3.send(
          new GetObjectCommand({
            Bucket: workspaceBucket(),
            Key: `${prefix}${path}`,
          }),
        );
        return (await resp.Body?.transformToString("utf-8")) ?? "";
      } catch (err) {
        const name = (err as { name?: string } | null)?.name;
        if (name === "NoSuchKey" || name === "NotFound") return null;
        throw err;
      }
    },
    async putText(path, content) {
      await s3.send(
        new PutObjectCommand({
          Bucket: workspaceBucket(),
          Key: `${prefix}${path}`,
          Body: content,
          ContentType: "text/plain; charset=utf-8",
        }),
      );
    },
    async deleteText(path) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: workspaceBucket(),
          Key: `${prefix}${path}`,
        }),
      );
    },
    async listPaths() {
      const paths: string[] = [];
      let continuationToken: string | undefined;
      do {
        const resp = await s3.send(
          new ListObjectsV2Command({
            Bucket: workspaceBucket(),
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
        for (const obj of resp.Contents ?? []) {
          if (!obj.Key) continue;
          const rel = obj.Key.slice(prefix.length);
          if (rel && rel !== "manifest.json") paths.push(rel);
        }
        continuationToken = resp.IsTruncated
          ? resp.NextContinuationToken
          : undefined;
      } while (continuationToken);
      return paths;
    },
  };
}

function parseImportRequest(
  body: Record<string, unknown>,
): { ok: true; request: ImportBundleRequest } | { ok: false; message: string } {
  if (body.source === "zip") {
    if (typeof body.body !== "string") {
      return { ok: false, message: "zip import requires base64 body" };
    }
    return {
      ok: true,
      request: {
        source: "zip",
        body: body.body,
        allowRootOverrides: stringArray(body.allowRootOverrides),
      },
    };
  }
  if (body.source === "git") {
    if (typeof body.url !== "string") {
      return { ok: false, message: "git import requires url" };
    }
    return {
      ok: true,
      request: {
        source: "git",
        url: body.url,
        ref: typeof body.ref === "string" ? body.ref : undefined,
        pat: typeof body.pat === "string" ? body.pat : undefined,
        allowRootOverrides: stringArray(body.allowRootOverrides),
      },
    };
  }
  return { ok: false, message: "source must be 'zip' or 'git'" };
}

function parseBody(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function pathAgentId(path: string): string | null {
  return (
    path.match(
      /^\/api\/agents\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/import-bundle$/i,
    )?.[1] ?? null
  );
}
