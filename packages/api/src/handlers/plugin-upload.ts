/**
 * Plugin upload REST Lambda — the admin-facing entry point for the V1
 * plan's self-serve plugin install flow (plan §U10).
 *
 * ## Two routes
 *
 *   POST /api/plugins/presign
 *     Admin client asks for a presigned PUT URL + a staging key. Client
 *     then PUTs the plugin zip directly to S3 (Lambda request bodies
 *     are capped; presigned URLs are the only practical way to stream
 *     up to the 50 MB cap the validator allows).
 *     Request: { fileName: string }           (optional — just for logs)
 *     Response: { uploadUrl, s3Key, expiresIn }
 *
 *   POST /api/plugins/upload
 *     Given the s3Key the client received from /presign and PUT the zip
 *     to, the handler: downloads the zip, runs the U9 validator, runs
 *     the three-phase install saga, and returns the uploadId + summary.
 *     Request: { s3Key: string }
 *     Response: { uploadId, status, plugin? , errors? , warnings? }
 *
 * ## OPTIONS
 *
 * OPTIONS short-circuits at the top via handleCors() — no auth call, no
 * DB hit — so the browser preflight cache warms cleanly. Plan §Security
 * Invariants calls this out for every new REST route.
 *
 * ## Auth
 *
 * Every non-OPTIONS route runs through `authenticate()` (shared helper,
 * Cognito JWT or x-api-key + x-tenant-id). After that the handler
 * resolves the caller's role on the tenant via the tenantMembers table
 * and rejects if the role isn't owner or admin. This is the narrow
 * REST analogue of the GraphQL `requireTenantAdmin` helper.
 *
 * ## What this handler does NOT do
 *
 *   - Does not run a background sweeper to reap orphan staging objects;
 *     that ships as its own Lambda + EventBridge in a follow-up PR.
 *   - Does not write the admin UI — the drag-drop page and detail view
 *     ship with the Terraform route wiring in a follow-up PR.
 *   - Does not wire Terraform. The route `POST /api/plugins/{presign,
 *     upload}` + `OPTIONS` exist in code; api-gateway.tf updates land
 *     with the admin UI PR so the two pieces land together.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, eq } from "drizzle-orm";

import { getDb } from "@thinkwork/database-pg";
import {
  pluginUploads,
  tenantMcpServers,
  tenantMembers,
  tenantSkills,
} from "@thinkwork/database-pg/schema";

import { authenticate } from "../lib/cognito-auth.js";
import {
  error,
  forbidden,
  handleCors,
  json,
  notFound,
  unauthorized,
} from "../lib/response.js";
import {
  type PluginInstallerDb,
  type PluginInstallerS3,
  runPluginInstallSaga,
  sha256Hex,
} from "../lib/plugin-installer.js";
import { validatePluginZip } from "../lib/plugin-validator.js";

const s3 = new S3Client({});
// Resolved at invocation time so tests can set process.env in
// beforeEach and the module's cached copy doesn't stick at "".
function workspaceBucket(): string {
  return process.env.WORKSPACE_BUCKET || "";
}
const PRESIGN_EXPIRES_SECONDS = 300;
const MAX_ZIP_BYTES = 50 * 1024 * 1024;

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  // OPTIONS first — no auth, no DB hit. Plan §Security Invariants #SI-4
  // companion discipline: every REST route that gets a CORS preflight
  // must short-circuit here so a browser PUT + POST loop doesn't stall
  // on auth for the empty preflight.
  const cors = handleCors(event);
  if (cors) return cors;

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  if (method !== "POST") {
    return error(`Method ${method} not allowed`, 405);
  }

  if (!workspaceBucket()) {
    return error("WORKSPACE_BUCKET env is not configured", 500);
  }

  const auth = await authenticate(
    event.headers as Record<string, string | undefined>,
  );
  if (!auth) return unauthorized();

  const tenantId = auth.tenantId;
  if (!tenantId) {
    // Cognito-federated users whose pre-token trigger hasn't fired
    // yet fall through with a null tenantId. Admin-role operations
    // MUST carry a resolved tenant — force the client to reauth
    // rather than guess.
    return error("authentication carried no tenant_id", 401);
  }

  // Admin-role check. The tenantMembers query also answers the
  // membership question, so a caller who isn't a member at all still
  // gets 403 (not 404) — not leaking membership shape to a stranger.
  const isAdmin = await callerIsTenantAdmin(tenantId, auth.principalId);
  if (!isAdmin) {
    return forbidden("caller is not a tenant admin or owner");
  }

  try {
    if (path === "/api/plugins/presign" && method === "POST") {
      return await handlePresign(tenantId, auth.principalId, event);
    }
    if (path === "/api/plugins/upload" && method === "POST") {
      return await handleUpload(tenantId, auth.principalId, event);
    }
    return notFound(`Route ${method} ${path} not found`);
  } catch (e) {
    // Unexpected errors go to CloudWatch for triage; don't leak the
    // stack to the client.
    console.error("plugin-upload handler crashed:", e);
    return error("internal server error", 500);
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * POST /api/plugins/presign — returns a 5-minute presigned PUT URL the
 * admin client uses to upload the zip directly to S3. The zip lands at
 * a per-upload staging key the client then echoes back to /upload.
 */
async function handlePresign(
  tenantId: string,
  principalId: string | null,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  // fileName is purely cosmetic — it lets operator logs tie a staging
  // key back to the upload attempt. Not trusted for anything.
  const body = parseBody(event.body);
  const fileName =
    typeof body.fileName === "string" ? body.fileName : "plugin.zip";

  const uploadId = cryptoRandomId();
  const stagingKey = stagingKeyFor(tenantId, uploadId);

  const command = new PutObjectCommand({
    Bucket: workspaceBucket(),
    Key: stagingKey,
    ContentType: "application/zip",
  });
  const uploadUrl = await getSignedUrl(s3, command, {
    expiresIn: PRESIGN_EXPIRES_SECONDS,
  });

  console.info(
    `plugin-upload presign tenantId=${tenantId} principal=${principalId ?? "unknown"} ` +
      `stagingKey=${stagingKey} fileName=${fileName}`,
  );
  return json({
    uploadUrl,
    s3Key: stagingKey,
    expiresIn: PRESIGN_EXPIRES_SECONDS,
  });
}

/**
 * POST /api/plugins/upload — given a staging key the client PUT the zip
 * to, validate + install + return the structured result.
 */
async function handleUpload(
  tenantId: string,
  principalId: string | null,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const body = parseBody(event.body);
  const s3Key = typeof body.s3Key === "string" ? body.s3Key : "";
  if (!s3Key) {
    return error("missing required field 's3Key'", 400);
  }
  if (!s3Key.startsWith(stagingKeyPrefix(tenantId))) {
    // Defense-in-depth: the presign route issued keys under this
    // tenant's staging prefix. If the request's s3Key doesn't match,
    // treat it as a cross-tenant probe and refuse.
    return forbidden("s3Key does not belong to this tenant's staging prefix");
  }

  // 1. Pull the zip back from S3.
  let zipBuffer: Buffer;
  try {
    zipBuffer = await downloadS3Object(s3Key);
  } catch (e) {
    const msg = (e as Error).message || "failed to fetch staged zip";
    console.warn(`plugin-upload fetch failed: ${msg}`);
    return error(`staged upload not found: ${msg}`, 400);
  }
  if (zipBuffer.length > MAX_ZIP_BYTES) {
    return error(
      `uploaded zip is ${zipBuffer.length} bytes, max is ${MAX_ZIP_BYTES}`,
      413,
    );
  }

  // 2. U9 validation — structured reject if anything fails.
  const validation = await validatePluginZip(zipBuffer);
  if (!validation.valid) {
    return json(
      {
        valid: false,
        errors: validation.errors,
        warnings: validation.warnings,
      },
      400,
    );
  }

  // 3. Run the install saga.
  const bundleSha256 = sha256Hex(zipBuffer);
  const bundleFiles = extractBundleFilesForInstall(
    validation.plugin,
    zipBuffer,
  );
  const db: PluginInstallerDb = makeDbImpl();
  const s3Adapter: PluginInstallerS3 = makeS3Impl(s3);
  const result = await runPluginInstallSaga(
    {
      tenantId,
      uploadedBy: principalId,
      stagingPrefix: s3Key,
      bundleSha256,
      plugin: validation.plugin,
      bundleFiles,
      canonicalPrefix: (tid, pluginName) =>
        `tenants/${tid}/skills/${pluginName}`,
    },
    {
      db,
      s3: s3Adapter,
      logger: {
        info: (m, f) => console.info(m, f),
        warn: (m, f) => console.warn(m, f),
      },
    },
  );

  if (result.status === "failed") {
    return json(
      {
        uploadId: result.uploadId,
        status: "failed",
        phase: result.phase,
        errorMessage: result.errorMessage,
      },
      500,
    );
  }

  return json({
    uploadId: result.uploadId,
    status: "installed",
    plugin: {
      name: result.pluginName,
      skills: result.skills,
      mcpServers: result.mcpServers,
    },
    warnings: validation.warnings,
  });
}

// ---------------------------------------------------------------------------
// Authz — REST analogue of requireTenantAdmin
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

function stagingKeyPrefix(tenantId: string): string {
  return `tenants/${tenantId}/_plugin-uploads/`;
}

function stagingKeyFor(tenantId: string, uploadId: string): string {
  return `${stagingKeyPrefix(tenantId)}${uploadId}/bundle.zip`;
}

async function downloadS3Object(key: string): Promise<Buffer> {
  const resp = await s3.send(
    new GetObjectCommand({ Bucket: workspaceBucket(), Key: key }),
  );
  if (!resp.Body) throw new Error("S3 GetObject returned empty body");
  const chunks: Uint8Array[] = [];
  for await (const chunk of resp.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Bundle extraction for phase-2 writes
// ---------------------------------------------------------------------------

/**
 * Phase 2 writes the bundle's structured files (one SKILL.md per skill,
 * plus any scripts/ / references/ files shipped alongside) into the
 * canonical prefix. V9's validator already parsed the zip; we re-read
 * the buffer here so we can hand the saga pre-shaped `{relPath, body}`
 * records without re-running validation.
 *
 * Today the saga ships SKILL.md files only — scripts/ and references/
 * land in U8's per-skill migration PRs when the bundle format for each
 * slug is finalised. The shape of this function is forward-compatible:
 * add more entry types (scripts, references) by walking the zip's
 * entry list and filtering by relPath prefix.
 */
function extractBundleFilesForInstall(
  plugin: {
    name: string;
    skills: Array<{ path: string; name: string; body: string }>;
  },
  _zipBuffer: Buffer,
): Array<{ relPath: string; body: string }> {
  return plugin.skills.map((skill) => ({
    // Canonical layout: each skill lives under its slug dir.
    relPath: `skills/${skill.name}/SKILL.md`,
    body: reassembleSkillMd(skill),
  }));
}

function reassembleSkillMd(skill: { name: string; body: string }): string {
  // U9 parsed the skill, captured the body, and threw away the
  // frontmatter. For the canonical write we reconstitute a minimal
  // frontmatter from the validated fields + append the body. This
  // keeps the source of truth on-disk symmetric with every other
  // SKILL.md the runtime sees.
  return `---\nname: ${skill.name}\n---\n${skill.body}`;
}

// ---------------------------------------------------------------------------
// DB + S3 adapters (production wiring — tests inject fakes directly)
// ---------------------------------------------------------------------------

function makeDbImpl(): PluginInstallerDb {
  const db = getDb();
  return {
    async insertPluginUploadStaging(input) {
      const [row] = await db
        .insert(pluginUploads)
        .values({
          tenant_id: input.tenantId,
          uploaded_by: input.uploadedBy ?? null,
          bundle_sha256: input.bundleSha256,
          plugin_name: input.pluginName,
          plugin_version: input.pluginVersion ?? null,
          status: "staging",
          s3_staging_prefix: input.s3StagingPrefix,
        })
        .returning({ id: pluginUploads.id });
      if (!row) throw new Error("plugin_uploads insert returned no row");
      return { uploadId: row.id };
    },

    async completeInstall(input) {
      await db.transaction(async (tx) => {
        if (input.skills.length > 0) {
          await tx
            .insert(tenantSkills)
            .values(
              input.skills.map((s) => ({
                tenant_id: input.tenantId,
                skill_id: s.slug,
                source: "tenant" as const,
                version: s.version ?? undefined,
                enabled: true,
              })),
            )
            .onConflictDoNothing();
        }
        if (input.mcpServers.length > 0) {
          await tx
            .insert(tenantMcpServers)
            .values(
              input.mcpServers.map((m) => ({
                tenant_id: input.tenantId,
                name: m.name,
                slug: slugify(m.name),
                url: m.url,
                auth_type: "none",
                auth_config: m.auth ?? null,
                // U3 landed the `status` column; plugin-installed
                // MCP servers default to 'pending' per plan R8.
                status: "pending" as const,
                enabled: true,
              })),
            )
            .onConflictDoNothing();
        }
        await tx
          .update(pluginUploads)
          .set({ status: "installed", error_message: null })
          .where(eq(pluginUploads.id, input.uploadId));
      });
    },

    async markFailed(input) {
      await getDb()
        .update(pluginUploads)
        .set({ status: "failed", error_message: input.errorMessage })
        .where(eq(pluginUploads.id, input.uploadId));
    },
  };
}

function makeS3Impl(client: S3Client): PluginInstallerS3 {
  return {
    async writeBundle({ canonicalPrefix, files }) {
      for (const file of files) {
        await client.send(
          new PutObjectCommand({
            Bucket: workspaceBucket(),
            Key: `${canonicalPrefix}/${file.relPath}`,
            Body: file.body,
            ContentType: "text/markdown",
          }),
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function parseBody(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function cryptoRandomId(): string {
  // 16-byte random; hex-encoded to 32 chars. Avoids needing uuid dep.
  // The space is more than enough for a staging-key segment that
  // only lives for the window between presign and upload.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
