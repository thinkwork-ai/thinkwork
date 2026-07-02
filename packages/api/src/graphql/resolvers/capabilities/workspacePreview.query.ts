/**
 * workspacePreview / workspacePreviewFile — the rendered workspace for an
 * agent × Space × perspective-user selection (Composer plan U1).
 *
 * Both queries compose through `renderWorkspaceTuple` with `persist: false`
 * (KTD-2/KTD-3): the view is byte-identical to what a real turn renders,
 * with zero S3 writes. The tuple carries no Agent Profile dimension — the
 * rendered workspace is profile-invariant; the Profile chip scopes the
 * Composer's controls pane only (R4).
 *
 * `workspacePreview` returns the hydrate-manifest file tree (path / owner /
 * generated / size). `workspacePreviewFile` returns one file's content for a
 * RELATIVE tree path:
 *
 *   - the S3 key is re-derived server-side from the resolved tuple's own
 *     manifest — a client-supplied sourceKey is never accepted, and a key
 *     resolving outside the tuple's source prefixes is rejected;
 *   - generated files (AGENTS.md, gated CONTEXT.md) are served from the
 *     in-memory compose result (`includeGeneratedContents`), never from
 *     mutable `renderedPrefix` keys — under `persist: false` nothing exists
 *     there.
 *
 * Perspective semantics mirror the capability inspector (KTD-4): no
 * `perspectiveUserId` = exactly what a scheduled/wakeup turn renders —
 * private-Space access via the space-trigger service identity, plugin
 * folders excluded fail-closed.
 */

import { S3Client } from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import type { GraphQLContext } from "../../context.js";
import { db, eq, and, agents, spaces, users } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { renderWorkspaceTuple } from "../../../lib/workspace-renderer/compose-tuple.js";
import { spaceTriggerServiceIdentity } from "../../../lib/workspace-renderer/space-membership-check.js";
import { S3WorkspaceRendererObjectStore } from "../../../lib/workspace-renderer/s3-store.js";
import { WorkspaceRenderError } from "../../../lib/workspace-renderer/types.js";
import type {
  RenderedWorkspaceTuple,
  WorkspaceHydrateFile,
} from "../../../lib/workspace-renderer/types.js";

const LOG_PREFIX = "[workspace-preview]";
const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });
const sourceObjectStore = new S3WorkspaceRendererObjectStore(s3);

export interface WorkspacePreviewArgs {
  tenantId: string;
  agentId?: string | null;
  spaceId?: string | null;
  perspectiveUserId?: string | null;
}

export interface WorkspacePreviewFileArgs extends WorkspacePreviewArgs {
  path: string;
}

interface PreviewEntryOut {
  path: string;
  owner: string;
  generated: boolean;
  size?: number | null;
}

interface WorkspacePreviewOut {
  state: "ok" | "invalid_selection" | "resolution_fault";
  stateDetail?: string | null;
  agentId?: string | null;
  spaceId?: string | null;
  perspectiveUserId?: string | null;
  noUserBaseline: boolean;
  files?: PreviewEntryOut[] | null;
}

interface WorkspacePreviewFileOut {
  state: "ok" | "invalid_selection" | "resolution_fault" | "not_found";
  stateDetail?: string | null;
  file?: PreviewEntryOut | null;
  content?: string | null;
}

function previewEntry(file: WorkspaceHydrateFile): PreviewEntryOut {
  return {
    path: file.path,
    owner: file.owner,
    generated: Boolean(file.generated),
    size: file.size ?? null,
  };
}

type ResolvedSelection =
  | {
      ok: true;
      agentId: string;
      spaceId: string;
      perspectiveUserId: string | null;
      noUserBaseline: boolean;
    }
  | { ok: false; detail: string };

function defaultSpaceIdFromRuntimeConfig(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const defaultSpaceId = (value as { defaultSpaceId?: unknown }).defaultSpaceId;
  return typeof defaultSpaceId === "string" && defaultSpaceId.trim()
    ? defaultSpaceId
    : null;
}

/**
 * Selection resolution — mirrors `capabilityInspector.query.ts`: every id
 * must belong to the caller's tenant; cross-tenant ids fail closed as
 * invalid_selection without confirming whether the foreign row exists.
 * `agentId` defaults to the tenant's platform agent; `spaceId` defaults to
 * the agent's default Space (runtime_config.defaultSpaceId) — the Space a
 * spaceless turn renders in.
 */
async function resolvePreviewSelection(
  args: WorkspacePreviewArgs,
): Promise<ResolvedSelection> {
  const invalid = (detail: string): ResolvedSelection => ({
    ok: false,
    detail,
  });

  let agentId = args.agentId ?? null;
  let agentRuntimeConfig: unknown = null;
  if (agentId) {
    const [agent] = await db
      .select({ id: agents.id, runtimeConfig: agents.runtime_config })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.tenant_id, args.tenantId)))
      .limit(1);
    if (!agent) return invalid("agent not found in tenant");
    agentRuntimeConfig = agent.runtimeConfig;
  } else {
    const [platformAgent] = await db
      .select({ id: agents.id, runtimeConfig: agents.runtime_config })
      .from(agents)
      .where(
        and(
          eq(agents.tenant_id, args.tenantId),
          eq(agents.is_platform_default, true),
        ),
      )
      .limit(1);
    if (!platformAgent) {
      return invalid("tenant has no platform default agent");
    }
    agentId = platformAgent.id;
    agentRuntimeConfig = platformAgent.runtimeConfig;
  }

  const spaceId =
    args.spaceId ?? defaultSpaceIdFromRuntimeConfig(agentRuntimeConfig);
  if (!spaceId) {
    return invalid(
      "no Space selected and the agent has no default Space configured",
    );
  }
  const [space] = await db
    .select({ id: spaces.id, status: spaces.status })
    .from(spaces)
    .where(and(eq(spaces.id, spaceId), eq(spaces.tenant_id, args.tenantId)))
    .limit(1);
  if (!space) return invalid("space not found in tenant");
  if (space.status !== "active") return invalid("space is not active");

  const perspectiveUserId = args.perspectiveUserId ?? null;
  if (perspectiveUserId) {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, perspectiveUserId),
          eq(users.tenant_id, args.tenantId),
        ),
      )
      .limit(1);
    if (!user) return invalid("perspective user not found in tenant");
  }

  return {
    ok: true,
    agentId,
    spaceId,
    perspectiveUserId,
    noUserBaseline: !perspectiveUserId,
  };
}

async function renderPreview(
  tenantId: string,
  selection: Extract<ResolvedSelection, { ok: true }>,
  options: { includeGeneratedContents: boolean },
): Promise<RenderedWorkspaceTuple> {
  return renderWorkspaceTuple(
    {
      tenantId,
      agentId: selection.agentId,
      spaceId: selection.spaceId,
      userId: selection.perspectiveUserId,
      invokingServiceIdentity: selection.noUserBaseline
        ? spaceTriggerServiceIdentity({
            tenantId,
            spaceId: selection.spaceId,
          })
        : null,
    },
    {
      persist: false,
      includeGeneratedContents: options.includeGeneratedContents,
    },
  );
}

function renderFaultDetail(err: unknown): string {
  if (err instanceof WorkspaceRenderError) {
    return `${err.code}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export async function workspacePreview(
  _parent: unknown,
  args: WorkspacePreviewArgs,
  ctx: GraphQLContext,
): Promise<WorkspacePreviewOut> {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "capabilities:read");

  const perspectiveUserId = args.perspectiveUserId ?? null;
  const selection = await resolvePreviewSelection(args);
  if (!selection.ok) {
    return {
      state: "invalid_selection",
      stateDetail: selection.detail,
      agentId: args.agentId ?? null,
      spaceId: args.spaceId ?? null,
      perspectiveUserId,
      noUserBaseline: !perspectiveUserId,
      files: null,
    };
  }

  let rendered: RenderedWorkspaceTuple;
  try {
    rendered = await renderPreview(args.tenantId, selection, {
      includeGeneratedContents: false,
    });
  } catch (err) {
    console.warn(`${LOG_PREFIX} read-only render failed:`, err);
    return {
      state: "resolution_fault",
      stateDetail: renderFaultDetail(err),
      agentId: selection.agentId,
      spaceId: selection.spaceId,
      perspectiveUserId: selection.perspectiveUserId,
      noUserBaseline: selection.noUserBaseline,
      files: null,
    };
  }

  return {
    state: "ok",
    stateDetail: null,
    agentId: selection.agentId,
    spaceId: selection.spaceId,
    perspectiveUserId: selection.perspectiveUserId,
    noUserBaseline: selection.noUserBaseline,
    files: rendered.hydrateManifest.files.map(previewEntry),
  };
}

/**
 * Relative-path normalization: forward slashes only, no traversal, no
 * absolute paths, no empty segments. Returns null when the path is not a
 * plain relative rendered-workspace path.
 */
function normalizeRelativePath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("\\")) {
    return null;
  }
  const segments = trimmed.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  return segments.join("/");
}

export async function workspacePreviewFile(
  _parent: unknown,
  args: WorkspacePreviewFileArgs,
  ctx: GraphQLContext,
): Promise<WorkspacePreviewFileOut> {
  // Re-run auth — this query is reachable independently of workspacePreview.
  await requireAdminOrServiceCaller(ctx, args.tenantId, "capabilities:read");

  const normalizedPath = normalizeRelativePath(args.path);
  if (!normalizedPath) {
    return {
      state: "invalid_selection",
      stateDetail: "path must be a plain relative rendered-workspace path",
    };
  }

  const selection = await resolvePreviewSelection(args);
  if (!selection.ok) {
    return { state: "invalid_selection", stateDetail: selection.detail };
  }

  // Generated files exist only in the compose result (persist:false writes
  // nothing at the manifest's rendered keys), so the render itself is the
  // content source; it also supplies the server-derived source keys.
  let rendered: RenderedWorkspaceTuple;
  try {
    rendered = await renderPreview(args.tenantId, selection, {
      includeGeneratedContents: true,
    });
  } catch (err) {
    console.warn(`${LOG_PREFIX} read-only render failed:`, err);
    return { state: "resolution_fault", stateDetail: renderFaultDetail(err) };
  }

  const file = rendered.hydrateManifest.files.find(
    (candidate) => candidate.path === normalizedPath,
  );
  if (!file) {
    return {
      state: "not_found",
      stateDetail: "no rendered file at this path for the selection",
    };
  }

  if (file.generated) {
    const generated = rendered.generatedFiles?.find(
      (candidate) => candidate.path === normalizedPath,
    );
    if (!generated) {
      return {
        state: "resolution_fault",
        stateDetail: "generated content missing from the compose result",
      };
    }
    return {
      state: "ok",
      stateDetail: null,
      file: previewEntry(file),
      content: generated.content,
    };
  }

  // The key is the render's own server-side derivation from the resolved
  // tuple; still, reject anything that escapes the tuple's source prefixes
  // (defense in depth — never serve bytes outside the selection's tenant
  // prefixes).
  const withinTuplePrefixes = rendered.sourcePrefixes.some((prefix) =>
    file.sourceKey.startsWith(prefix),
  );
  if (!withinTuplePrefixes) {
    return {
      state: "invalid_selection",
      stateDetail: "path resolves outside the selection's workspace prefixes",
    };
  }

  const bucket = getConfig("WORKSPACE_BUCKET") ?? "";
  if (!bucket) {
    return {
      state: "resolution_fault",
      stateDetail: "WORKSPACE_BUCKET is not configured",
    };
  }
  const content = await sourceObjectStore.getText({
    bucket,
    key: file.sourceKey,
  });
  if (content === null) {
    return {
      state: "not_found",
      stateDetail: "source object no longer exists",
    };
  }

  return {
    state: "ok",
    stateDetail: null,
    file: previewEntry(file),
    content,
  };
}
