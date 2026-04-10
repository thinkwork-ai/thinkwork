import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { regenerateManifest } from "./src/lib/workspace-manifest.js";

interface APIGatewayProxyEvent {
  headers?: Record<string, string | undefined>;
  body?: string | null;
}

interface APIGatewayProxyResult {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

type WorkspaceAction = "put" | "get" | "delete" | "list";

type WorkspaceRequest = {
  action?: WorkspaceAction;
  tenantSlug?: string;
  instanceId?: string;
  path?: string;
  content?: string;
};

const client = new S3Client({
  region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

const BUCKET = process.env.WORKSPACE_BUCKET || "";

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function authToken(headers?: Record<string, string | undefined>) {
  const auth = headers?.authorization || headers?.Authorization;
  if (!auth) return null;
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
}

function s3Key(tenantSlug: string, instanceId: string, path: string): string {
  // Strip leading slashes from path
  const cleanPath = path.replace(/^\/+/, "");
  return `tenants/${tenantSlug}/agents/${instanceId}/workspace/${cleanPath}`;
}

function s3Prefix(tenantSlug: string, instanceId: string): string {
  return `tenants/${tenantSlug}/agents/${instanceId}/workspace/`;
}


function errorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown error";
  const name = (error as { name?: string }).name || "Error";
  const message = (error as { message?: string }).message || "";
  return message ? `${name}: ${message}` : name;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const expectedSecret = process.env.API_AUTH_SECRET;
  const token = authToken(event.headers);
  if (!expectedSecret || !token || token !== expectedSecret) {
    return json(401, { ok: false, error: "Unauthorized" });
  }

  let body: WorkspaceRequest;
  try {
    body = event.body ? (JSON.parse(event.body) as WorkspaceRequest) : {};
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const { action, tenantSlug, instanceId } = body;
  if (!action || !tenantSlug || !instanceId) {
    return json(400, { ok: false, error: "action, tenantSlug, and instanceId are required" });
  }

  if (!BUCKET) {
    return json(500, { ok: false, error: "WORKSPACE_BUCKET not configured" });
  }

  try {
    if (action === "put") {
      if (!body.path || body.content === undefined) {
        return json(400, { ok: false, error: "path and content are required for put" });
      }
      await client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: s3Key(tenantSlug, instanceId, body.path),
          Body: body.content,
          ContentType: "text/plain; charset=utf-8",
        }),
      );
      // Regenerate manifest after write
      await regenerateManifest(BUCKET, tenantSlug, instanceId);
      return json(200, { ok: true });
    }

    if (action === "get") {
      if (!body.path) {
        return json(400, { ok: false, error: "path is required for get" });
      }
      try {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: BUCKET,
            Key: s3Key(tenantSlug, instanceId, body.path),
          }),
        );
        const content = await result.Body?.transformToString("utf-8");
        return json(200, { ok: true, content: content ?? "" });
      } catch (err: unknown) {
        if ((err as { name?: string }).name === "NoSuchKey") {
          return json(200, { ok: true, content: null });
        }
        throw err;
      }
    }

    if (action === "delete") {
      if (!body.path) {
        return json(400, { ok: false, error: "path is required for delete" });
      }
      await client.send(
        new DeleteObjectCommand({
          Bucket: BUCKET,
          Key: s3Key(tenantSlug, instanceId, body.path),
        }),
      );
      // Regenerate manifest after delete
      await regenerateManifest(BUCKET, tenantSlug, instanceId);
      return json(200, { ok: true });
    }

    if (action === "list") {
      const prefix = s3Prefix(tenantSlug, instanceId);
      const files: string[] = [];
      let continuationToken: string | undefined;

      do {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: BUCKET,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
        for (const obj of result.Contents ?? []) {
          if (obj.Key) {
            const relPath = obj.Key.slice(prefix.length);
            if (relPath) files.push(relPath);
          }
        }
        continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
      } while (continuationToken);

      return json(200, { ok: true, files });
    }

    if (action === "regenerate-map") {
      // Trigger AGENTS.md + CONTEXT.md regeneration from workspace structure
      const agentId = (body as Record<string, unknown>).agentId as string;
      if (!agentId) {
        return json(400, { ok: false, error: "agentId is required for regenerate-map" });
      }
      try {
        const { regenerateWorkspaceMap } = await import("./src/lib/workspace-map-generator.js");
        await regenerateWorkspaceMap(agentId);
        return json(200, { ok: true });
      } catch (err: unknown) {
        return json(500, { ok: false, error: `Map regeneration failed: ${errorMessage(err)}` });
      }
    }

    return json(400, { ok: false, error: "Unsupported action" });
  } catch (error: unknown) {
    return json(500, { ok: false, error: `Workspace operation failed: ${errorMessage(error)}` });
  }
}
