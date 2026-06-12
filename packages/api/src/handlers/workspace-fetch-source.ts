/**
 * workspace-fetch-source — POST /api/workspaces/fetch-source
 *
 * Authorizes a mid-turn workspace-source fetch (a Space source folder or a
 * participant's User folder), enforces per-fetch caps, records the fetch
 * event on the turn's projection snapshot, and returns S3 keys + etags +
 * relative paths. No file content streams through this endpoint — the
 * runtime downloads the keys itself (plan 2026-06-12-002 U4; R6/R8/AE3).
 *
 * Auth: Bearer `API_AUTH_SECRET` (the task-status extension pattern) +
 * `x-tenant-id` header. Tenant scoping is the security boundary: every DB
 * lookup and every returned key is scoped to the tenant asserted by the
 * authenticated service caller.
 *
 * Request body:
 *   {
 *     kind: "space" | "user",
 *     slug: string,              // workspace folder name (Spaces/<slug> | User/<slug>)
 *     threadId: string,
 *     threadTurnId: string,
 *     listedInRouting?: boolean  // caller hint: turn's rendered routing listed
 *                                // this target → denial reads as "revoked"
 *   }
 *
 * Responses:
 *   200 { outcome: "success", files: [{ key, etag, relPath, size }] }
 *   200 { outcome: "partial", partial: true, files: [...] }   // caps hit
 *   403 { outcome: "denied", deniedReason: "not_authorized" | "revoked", files: [] }
 *   400/401/403/404 { error }                                  // shape errors
 *
 * Every authorization decision (success / partial / denied) appends a fetch
 * event to `thread_turns.context_snapshot.workspace_projection.fetches` via
 * the atomic appender in lib/workspace-projection-snapshot.ts. Append
 * failures never fail the fetch response — the event is additive telemetry.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq, or } from "drizzle-orm";
import { S3Client } from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import {
  spaceMembers,
  spaces,
  tenants,
  threads,
  users,
} from "@thinkwork/database-pg/schema";
import { db } from "../lib/db.js";
import { validateApiSecret } from "../lib/auth.js";
import {
  error,
  forbidden,
  handleCors,
  json,
  notFound,
  unauthorized,
} from "../lib/response.js";
import {
  assertSpaceAccessAllowed,
  SpaceAccessDeniedError,
} from "../lib/workspace-renderer/space-membership-check.js";
import {
  spaceSourcePrefix,
  userWorkspacePrefix,
} from "../lib/workspace-renderer/prefixes.js";
import {
  shouldRenderSpaceSourcePath,
  shouldRenderUserSourcePath,
} from "../lib/workspace-renderer/compose-tuple.js";
import { shouldRenderWorkspaceSourcePath } from "../lib/workspace-renderer.js";
import { S3WorkspaceRendererObjectStore } from "../lib/workspace-renderer/s3-store.js";
import {
  appendWorkspaceProjectionFetchEvent,
  type WorkspaceProjectionFetchDeniedReason,
  type WorkspaceProjectionFetchEvent,
  type WorkspaceProjectionFetchKind,
} from "../lib/workspace-projection-snapshot.js";

// ---------------------------------------------------------------------------
// Server-side per-fetch caps (plan pins: partial is first-class — over-cap
// returns the sorted-by-key prefix of the folder, never an opaque error).
// ---------------------------------------------------------------------------

export const FETCH_MAX_FILES = 200;
export const FETCH_MAX_TOTAL_BYTES = 5_000_000;

export interface WorkspaceFetchSourceFile {
  key: string;
  etag: string;
  relPath: string;
  size: number;
}

interface FetchSourceBody {
  kind?: string;
  slug?: string;
  threadId?: string;
  threadTurnId?: string;
  listedInRouting?: boolean;
}

let objectStore: S3WorkspaceRendererObjectStore | null = null;

function getObjectStore(): S3WorkspaceRendererObjectStore {
  if (!objectStore) {
    objectStore = new S3WorkspaceRendererObjectStore(
      new S3Client({
        region:
          process.env.AWS_REGION ||
          process.env.AWS_DEFAULT_REGION ||
          "us-east-1",
      }),
    );
  }
  return objectStore;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  // --- Auth: platform bearer secret, then tenant assertion ----------------
  const bearer = bearerToken(event.headers);
  if (!bearer || !validateApiSecret(bearer)) {
    return unauthorized("Authentication required");
  }
  const tenantId = headerValue(event.headers, "x-tenant-id");
  if (!tenantId) {
    return forbidden("x-tenant-id header required");
  }

  // --- Body validation -----------------------------------------------------
  let body: FetchSourceBody;
  try {
    body = JSON.parse(event.body ?? "{}") as FetchSourceBody;
  } catch {
    return error("Invalid JSON body", 400);
  }
  const kind = stringValue(body.kind);
  const slug = stringValue(body.slug);
  const threadId = stringValue(body.threadId);
  const threadTurnId = stringValue(body.threadTurnId);
  if (kind !== "space" && kind !== "user") {
    return error("kind must be 'space' or 'user'", 400);
  }
  if (!slug) return error("slug is required", 400);
  if (!threadId) return error("threadId is required", 400);
  if (!threadTurnId) return error("threadTurnId is required", 400);
  const listedInRouting = body.listedInRouting === true;

  // --- Tenant + thread resolution (tenant is the security boundary) -------
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant?.slug) return forbidden("Unknown tenant");
  const tenantSlug = tenant.slug;

  const [thread] = await db
    .select({
      id: threads.id,
      spaceId: threads.space_id,
      userId: threads.user_id,
    })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.tenant_id, tenantId)))
    .limit(1);
  if (!thread) return notFound("Thread not found");

  const target = { kind: kind as WorkspaceProjectionFetchKind, slug };
  const deny = async (): Promise<APIGatewayProxyStructuredResultV2> => {
    const deniedReason: WorkspaceProjectionFetchDeniedReason = listedInRouting
      ? "revoked"
      : "not_authorized";
    await recordFetchEvent(threadTurnId, tenantId, {
      target,
      outcome: "denied",
      fileCount: 0,
      totalBytes: 0,
      deniedReason,
      at: new Date().toISOString(),
    });
    return json({ outcome: "denied", deniedReason, files: [] }, 403);
  };

  // --- Authorize + resolve the source prefix ------------------------------
  let prefix: string;
  let includePath: (relPath: string) => boolean;

  if (kind === "space") {
    const [space] = await db
      .select({
        id: spaces.id,
        slug: spaces.slug,
        workspaceFolderName: spaces.workspace_folder_name,
        accessMode: spaces.access_mode,
      })
      .from(spaces)
      .where(
        and(
          eq(spaces.tenant_id, tenantId),
          or(eq(spaces.workspace_folder_name, slug), eq(spaces.slug, slug)),
        ),
      )
      .limit(1);
    if (!space) return notFound("Space not found");

    const spaceFolderName = space.workspaceFolderName ?? space.slug;
    try {
      await assertSpaceAccessAllowed({
        tenantId,
        spaceId: space.id,
        spaceSlug: spaceFolderName,
        accessMode: space.accessMode,
        invokingUserId: thread.userId,
      });
    } catch (err) {
      if (err instanceof SpaceAccessDeniedError) return await deny();
      throw err;
    }

    prefix = spaceSourcePrefix({ tenantSlug, spaceSlug: spaceFolderName });
    includePath = shouldRenderSpaceSourcePath;
  } else {
    // User folder: the target user must be a participant (space_members) of
    // the thread's ACTIVE space. Non-participants (and unknown slugs) are
    // denied identically so the endpoint doesn't leak user existence.
    const participants = await db
      .select({
        id: users.id,
        workspaceFolderName: users.workspace_folder_name,
        email: users.email,
        name: users.name,
      })
      .from(spaceMembers)
      .innerJoin(users, eq(spaceMembers.user_id, users.id))
      .where(
        and(
          eq(spaceMembers.tenant_id, tenantId),
          eq(spaceMembers.space_id, thread.spaceId),
        ),
      );
    const participant = participants.find(
      (row) => userWorkspaceSlug(row) === slug,
    );
    if (!participant) return await deny();

    prefix = userWorkspacePrefix({ tenantSlug, userSlug: slug });
    includePath = shouldRenderUserSourcePath;
  }

  // --- List the source, reusing composition's renderable-set filters ------
  const bucket = getConfig("WORKSPACE_BUCKET") || "";
  if (!bucket) return error("WORKSPACE_BUCKET is not configured", 500);

  const listed = await getObjectStore().listObjects({ bucket, prefix });
  const renderable = listed
    .map((object) => ({
      key: object.key,
      etag: (object.etag ?? "").replace(/^"|"$/g, ""),
      relPath: object.key.slice(prefix.length),
      size: object.size ?? 0,
    }))
    .filter(
      (object) =>
        shouldRenderWorkspaceSourcePath(object.relPath) &&
        includePath(object.relPath),
    )
    .sort((left, right) => (left.key < right.key ? -1 : 1));

  // --- Caps: deterministic sorted-by-key truncation ------------------------
  const files: WorkspaceFetchSourceFile[] = [];
  let totalBytes = 0;
  let truncated = false;
  for (const object of renderable) {
    if (
      files.length >= FETCH_MAX_FILES ||
      totalBytes + object.size > FETCH_MAX_TOTAL_BYTES
    ) {
      truncated = true;
      break;
    }
    files.push(object);
    totalBytes += object.size;
  }

  const outcome = truncated ? "partial" : "success";
  await recordFetchEvent(threadTurnId, tenantId, {
    target,
    outcome,
    fileCount: files.length,
    totalBytes,
    at: new Date().toISOString(),
  });

  return json({
    outcome,
    files,
    ...(truncated ? { partial: true } : {}),
  });
}

/**
 * Snapshot appends are additive telemetry — a failure is logged, never
 * surfaced: the authorization decision (including denials) stands on its own.
 */
async function recordFetchEvent(
  threadTurnId: string,
  tenantId: string,
  event: WorkspaceProjectionFetchEvent,
): Promise<void> {
  try {
    await appendWorkspaceProjectionFetchEvent(threadTurnId, event, {
      tenantId,
    });
  } catch (err) {
    console.error(
      `[workspace-fetch-source] fetch event append failed (turn=${threadTurnId}, target=${event.target.kind}/${event.target.slug}, outcome=${event.outcome})`,
      err,
    );
  }
}

/**
 * Mirror of workspace-files.ts resolveUserContextTarget's slug derivation so
 * a routing entry like `User/<slug>/` resolves to the same user folder here.
 */
function userWorkspaceSlug(user: {
  workspaceFolderName: string | null;
  email: string | null;
  name: string | null;
}): string {
  return (
    user.workspaceFolderName ||
    (user.email?.split("@")[0] || user.name || "user")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) ||
    "user"
  );
}

function bearerToken(
  headers: APIGatewayProxyEventV2["headers"],
): string | null {
  const value = headers.authorization ?? headers.Authorization;
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function headerValue(
  headers: APIGatewayProxyEventV2["headers"],
  name: string,
): string {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (direct) return direct.trim();
  const found = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return found?.[1]?.trim() ?? "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
