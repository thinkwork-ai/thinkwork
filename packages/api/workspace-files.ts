/**
 * Workspace files Lambda — composer-backed, Cognito-authenticated.
 *
 * Route: POST /api/workspaces/files (via the /api/workspaces/{proxy+} API
 * Gateway route). Replaces the previous `API_AUTH_SECRET`-bearer handler;
 * the bearer path is gone — every caller sends a Cognito ID token.
 *
 * Request shape (Unit 5):
 *   { action: "get" | "list" | "put" | "delete" | "generate-folder-structure" | "regenerate-map" | "normalize-map" | "update-identity-field",
 *     agentId?: string, templateId?: string, spaceId?: string, threadId?: string, userId?: string, defaults?: true, catalog?: true,
 *     path?: string, content?: string, acceptTemplateUpdate?: boolean }
 *
 *   Exactly one of agentId / templateId / spaceId / threadId / userId / defaults:true / catalog:true
 *   identifies the target surface. Tenant identity is derived from the
 *   caller's JWT via `resolveCallerFromAuth` — the handler NEVER trusts a
 *   tenantSlug body field. Requests that still include one are rejected
 *   (400) so buggy clients surface loud instead of drifting silently across
 *   tenants.
 *
 * Responses:
 *   get  → { ok: true, content, source, sha256 }
 *   list → { ok: true, files: Array<{ path, source, sha256, overridden }> }
 *   put  → { ok: true }
 *   delete → { ok: true }
 *   install-skill / uninstall-skill / reinstall-skill → { ok: true, ... }
 *   generate-folder-structure → { ok: true }
 *   regenerate-map → { ok: true } (optional path scopes refresh to that AGENTS.md)
 *   normalize-map → { ok: true }
 *   errors → { ok: false, error }
 *
 * Auth model:
 *   - Cognito JWT required. Unauthenticated → 401.
 *   - Caller's tenant is resolved via resolveCallerFromAuth. Missing → 401.
 *   - agentId / templateId are validated against the caller's tenant.
 *     Mismatch → 404 (no "this exists in another tenant" leakage).
 *   - Put on a pinned file via agentId without `acceptTemplateUpdate: true`
 *     returns 403. The acceptTemplateUpdate GraphQL mutation (Unit 9) is
 *     the intended path; the flag here keeps the door open for admin-UI
 *     diff-preview flows that write a new override after accepting.
 */

import { getConfig } from "@thinkwork/runtime-config";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { authenticate, type AuthResult } from "./src/lib/cognito-auth.js";
import { resolveCallerFromAuth } from "./src/graphql/resolvers/core/resolve-auth-user.js";
import { isReservedFolderSegment } from "./src/lib/reserved-folder-names.js";
import {
  appendRoutingRowIfMissing,
  generateContextFolderStructure,
  generateContextFolderStructureForSpace,
  normalizeAgentsMd,
  regenerateAgentsMdDerivedSections,
} from "./src/lib/workspace-map-generator.js";
import { spaceSourcePrefix } from "./src/lib/spaces/template-migration.js";
import { PINNED_FILES } from "@thinkwork/workspace-defaults";
import {
  isPinnedWorkspacePath,
  normalizeWorkspacePath,
} from "./src/lib/pinned-versions.js";
import { regenerateManifest } from "./src/lib/workspace-manifest.js";
import { bootstrapAgentWorkspace } from "./src/lib/workspace-bootstrap.js";
import {
  deriveAgentSkills,
  type DeriveResult,
} from "./src/lib/derive-agent-skills.js";
import {
  isBuiltinToolSlug,
  isBuiltinToolWorkspacePath,
} from "./src/lib/builtin-tool-slugs.js";
import {
  agents,
  agentTemplates,
  and,
  db,
  eq,
  sql,
  spaces,
  tenantMembers,
  tenants,
  threads,
  users,
} from "./src/graphql/utils.js";
import { callerVisibleThreadPredicate } from "./src/graphql/resolvers/threads/access.js";
import { emitAuditEvent } from "./src/lib/compliance/emit.js";
import {
  CatalogInstallError,
  installCatalogSkill,
} from "./src/lib/catalog-install.js";
import {
  CatalogReinstallError,
  reinstallCatalogSkill,
} from "./src/lib/catalog-reinstall.js";
import {
  CatalogUninstallError,
  uninstallCatalogSkill,
} from "./src/lib/catalog-uninstall.js";
import { computeCatalogSkillShaBySlug } from "./src/lib/catalog-skill-sha.js";
import {
  reindexCatalogSkill,
  listIndexedSkills,
} from "./src/lib/catalog-index.js";
import {
  identityFieldLabel,
  isAgentIdentityField,
  replaceAgentsMdIdentityField,
} from "./src/lib/agents-md-persona-surgery.js";
import {
  deleteAgentProfileProjectionForFile,
  isAgentProfileWorkspacePath,
  upsertAgentProfileProjectionFromFile,
} from "./src/lib/agent-profile-workspace-files.js";
import {
  isProtectedOrchestrationWritePath,
  isSpaceCapabilityWritePath,
  isVisibleUserContextPath,
} from "./src/lib/workspace-lanes.js";
import { buildSpaceManifestProjection } from "./src/lib/workspace-renderer/space-md-parser.js";

// ---------------------------------------------------------------------------
// API Gateway shims
// ---------------------------------------------------------------------------

interface APIGatewayProxyEvent {
  headers?: Record<string, string | undefined>;
  body?: string | null;
  requestContext?: { http?: { method?: string } };
}

interface APIGatewayProxyResult {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

// CORS headers mirror packages/api/src/lib/response.ts so the admin SPA
// (localhost:5175 in dev, the static-site bucket in prod) and the mobile
// app can hit this endpoint from the browser / WebView. The API Gateway
// has tenant-scoped cors_configuration too, but HTTP API proxy
// integrations forward OPTIONS to the Lambda — so we must respond 2xx
// ourselves or the browser preflight fails.
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

// ---------------------------------------------------------------------------
// S3 client
// ---------------------------------------------------------------------------

const s3 = new S3Client({
  region:
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

function bucket(): string {
  return getConfig("WORKSPACE_BUCKET") || "";
}

async function refreshAgentAgentsMdSections(
  target: AgentTarget,
  operation: string,
): Promise<APIGatewayProxyResult | null> {
  try {
    await regenerateAgentsMdDerivedSections(target.agentId);
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[workspace-files] ${operation} AGENTS.md section refresh failed: ${message}`,
    );
    return json(500, {
      ok: false,
      error: `${operation} succeeded but AGENTS.md section refresh failed: ${message}`,
    });
  }
}

async function refreshSpaceManifestProjection(
  target: SpaceTarget,
  content: string,
): Promise<APIGatewayProxyResult | null> {
  const projection = buildSpaceManifestProjection(content);
  const updates: Record<string, unknown> = {
    config: sql`COALESCE(${spaces.config}, '{}'::jsonb) || ${JSON.stringify(
      projection.configPatch,
    )}::jsonb`,
    render_diagnostics: sql`COALESCE(${spaces.render_diagnostics}, '{}'::jsonb) || ${JSON.stringify(
      projection.renderDiagnostics,
    )}::jsonb`,
    updated_at: new Date(),
  };
  if (projection.autoApply.name) updates.name = projection.autoApply.name;
  if (projection.autoApply.description !== undefined) {
    updates.description = projection.autoApply.description;
  }

  try {
    await db.update(spaces).set(updates).where(eq(spaces.id, target.spaceId));
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[workspace-files] SPACE.md projection refresh failed: ${message}`,
    );
    return json(500, {
      ok: false,
      error: `SPACE.md saved but manifest projection refresh failed: ${message}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Key builders (must match workspace-overlay.ts / workspace-copy.ts)
// ---------------------------------------------------------------------------

function agentKey(tenantSlug: string, agentSlug: string, path: string): string {
  const clean = path.replace(/^\/+/, "");
  return `tenants/${tenantSlug}/agents/${agentSlug}/${clean}`;
}

function agentPrefix(tenantSlug: string, agentSlug: string): string {
  return `tenants/${tenantSlug}/agents/${agentSlug}/`;
}

function templateKey(
  tenantSlug: string,
  templateSlug: string,
  path: string,
): string {
  const clean = path.replace(/^\/+/, "");
  return `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/${clean}`;
}

function templatePrefix(tenantSlug: string, templateSlug: string): string {
  return `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/`;
}

function defaultsKey(tenantSlug: string, path: string): string {
  const clean = path.replace(/^\/+/, "");
  return `tenants/${tenantSlug}/agents/_catalog/defaults/workspace/${clean}`;
}

function defaultsPrefix(tenantSlug: string): string {
  return `tenants/${tenantSlug}/agents/_catalog/defaults/workspace/`;
}

function userContextKey(
  tenantSlug: string,
  userSlug: string,
  path: string,
): string {
  const clean = path.replace(/^\/+/, "");
  return `tenants/${tenantSlug}/users/${userSlug}/${clean}`;
}

function userContextPrefix(tenantSlug: string, userSlug: string): string {
  return `tenants/${tenantSlug}/users/${userSlug}/`;
}

function catalogKey(tenantSlug: string, path: string): string {
  const clean = path.replace(/^\/+/, "");
  return `tenants/${tenantSlug}/skill-catalog/${clean}`;
}

function catalogPrefix(tenantSlug: string): string {
  return `tenants/${tenantSlug}/skill-catalog/`;
}

function threadKey(tenantSlug: string, threadId: string, path: string): string {
  const clean = path.replace(/^\/+/, "");
  return `tenants/${tenantSlug}/threads/${threadId}/${clean}`;
}

function threadPrefix(tenantSlug: string, threadId: string): string {
  return `tenants/${tenantSlug}/threads/${threadId}/`;
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

interface AgentTarget {
  kind: "agent";
  tenantSlug: string;
  agentSlug: string;
  agentId: string;
  prefix: string;
  readPrefixes?: string[];
  key: (path: string) => string;
}

interface TemplateTarget {
  kind: "template";
  tenantSlug: string;
  templateSlug: string;
  prefix: string;
  readPrefixes?: string[];
  key: (path: string) => string;
}

interface SpaceTarget {
  kind: "space";
  tenantSlug: string;
  spaceSlug: string;
  spaceId: string;
  prefix: string;
  readPrefixes?: string[];
  key: (path: string) => string;
}

interface ThreadTarget {
  kind: "thread";
  tenantSlug: string;
  threadId: string;
  prefix: string;
  readPrefixes?: string[];
  key: (path: string) => string;
}

interface DefaultsTarget {
  kind: "defaults";
  tenantSlug: string;
  prefix: string;
  readPrefixes?: string[];
  key: (path: string) => string;
}

interface UserContextTarget {
  kind: "user";
  tenantSlug: string;
  userSlug: string;
  userId: string;
  prefix: string;
  readPrefixes?: string[];
  key: (path: string) => string;
}

interface CatalogTarget {
  kind: "catalog";
  tenantSlug: string;
  prefix: string;
  readPrefixes?: string[];
  key: (path: string) => string;
}

type Target =
  | AgentTarget
  | TemplateTarget
  | SpaceTarget
  | ThreadTarget
  | DefaultsTarget
  | UserContextTarget
  | CatalogTarget;

async function resolveAgentTarget(
  tenantId: string,
  agentId: string,
): Promise<AgentTarget | null> {
  const [agent] = await db
    .select({
      id: agents.id,
      slug: agents.slug,
      workspaceFolderName: agents.workspace_folder_name,
      tenant_id: agents.tenant_id,
    })
    .from(agents)
    .where(eq(agents.id, agentId));
  if (!agent || agent.tenant_id !== tenantId || !agent.slug) return null;

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, agent.tenant_id));
  if (!tenant?.slug) return null;

  const slug = agent.workspaceFolderName ?? agent.slug;
  const tSlug = tenant.slug;
  return {
    kind: "agent",
    tenantSlug: tSlug,
    agentSlug: slug,
    agentId: agent.id,
    prefix: agentPrefix(tSlug, slug),
    key: (path) => agentKey(tSlug, slug, path),
  };
}

async function resolveTemplateTarget(
  tenantId: string,
  templateId: string,
): Promise<TemplateTarget | null> {
  const [template] = await db
    .select({
      id: agentTemplates.id,
      slug: agentTemplates.slug,
      tenant_id: agentTemplates.tenant_id,
    })
    .from(agentTemplates)
    .where(eq(agentTemplates.id, templateId));
  if (!template || template.tenant_id !== tenantId || !template.slug)
    return null;

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant?.slug) return null;

  const tSlug = tenant.slug;
  const tmplSlug = template.slug;
  return {
    kind: "template",
    tenantSlug: tSlug,
    templateSlug: tmplSlug,
    prefix: templatePrefix(tSlug, tmplSlug),
    key: (path) => templateKey(tSlug, tmplSlug, path),
  };
}

async function resolveSpaceTarget(
  tenantId: string,
  spaceId: string,
): Promise<SpaceTarget | null> {
  const [space] = await db
    .select({
      id: spaces.id,
      slug: spaces.slug,
      workspaceFolderName: spaces.workspace_folder_name,
      tenant_id: spaces.tenant_id,
    })
    .from(spaces)
    .where(eq(spaces.id, spaceId));
  if (!space || space.tenant_id !== tenantId || !space.slug) return null;

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant?.slug) return null;

  const tSlug = tenant.slug;
  const spaceFolderName = space.workspaceFolderName ?? space.slug;
  const prefix = spaceSourcePrefix(tSlug, spaceFolderName);
  return {
    kind: "space",
    tenantSlug: tSlug,
    spaceSlug: spaceFolderName,
    spaceId: space.id,
    prefix,
    key: (path) => `${prefix}${path.replace(/^\/+/, "")}`,
  };
}

async function resolveThreadTarget(
  tenantId: string,
  threadId: string,
  userId: string | null,
): Promise<ThreadTarget | null> {
  const conditions = [
    eq(threads.id, threadId),
    eq(threads.tenant_id, tenantId),
  ];
  if (userId) {
    conditions.push(callerVisibleThreadPredicate(tenantId, userId));
  }
  const [thread] = await db
    .select({
      id: threads.id,
      workspaceFolderName: threads.workspace_folder_name,
      tenant_id: threads.tenant_id,
    })
    .from(threads)
    .where(and(...conditions))
    .limit(1);
  if (!thread || thread.tenant_id !== tenantId) return null;

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant?.slug) return null;

  return {
    kind: "thread",
    tenantSlug: tenant.slug,
    threadId: thread.workspaceFolderName ?? thread.id,
    prefix: threadPrefix(tenant.slug, thread.workspaceFolderName ?? thread.id),
    key: (path) =>
      threadKey(tenant.slug, thread.workspaceFolderName ?? thread.id, path),
  };
}

async function resolveDefaultsTarget(
  tenantId: string,
): Promise<DefaultsTarget | null> {
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant?.slug) return null;
  const tSlug = tenant.slug;
  return {
    kind: "defaults",
    tenantSlug: tSlug,
    prefix: defaultsPrefix(tSlug),
    key: (path) => defaultsKey(tSlug, path),
  };
}

async function resolveUserContextTarget(
  tenantId: string,
  userId: string,
): Promise<UserContextTarget | null> {
  const [member] = await db
    .select({
      principalId: tenantMembers.principal_id,
      principalType: tenantMembers.principal_type,
    })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenant_id, tenantId),
        eq(tenantMembers.principal_id, userId),
      ),
    )
    .limit(1);
  if (!member || member.principalType.toLowerCase() !== "user") return null;

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant?.slug) return null;

  const [user] = await db
    .select({
      workspaceFolderName: users.workspace_folder_name,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenant_id, tenantId)))
    .limit(1);
  if (!user) return null;

  const userSlug =
    user.workspaceFolderName ||
    (user.email?.split("@")[0] || user.name || "user")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) ||
    "user";

  return {
    kind: "user",
    tenantSlug: tenant.slug,
    userSlug,
    userId,
    prefix: userContextPrefix(tenant.slug, userSlug),
    key: (path) => userContextKey(tenant.slug, userSlug, path),
  };
}

async function resolveCatalogTarget(
  tenantId: string,
): Promise<CatalogTarget | null> {
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant?.slug) return null;
  return {
    kind: "catalog",
    tenantSlug: tenant.slug,
    prefix: catalogPrefix(tenant.slug),
    key: (path) => catalogKey(tenant.slug, path),
  };
}

// ---------------------------------------------------------------------------
// Authz — REST analogue of requireTenantAdmin
// ---------------------------------------------------------------------------

const WRITE_ACTIONS = new Set([
  "put",
  "delete",
  "move",
  "rename",
  "create-sub-agent",
  "install-skill",
  "reinstall-skill",
  "uninstall-skill",
  "generate-folder-structure",
  "regenerate-map",
  "normalize-map",
  "update-identity-field",
  "rematerialize",
]);

async function callerIsTenantAdmin(
  tenantId: string,
  principalId: string | null,
): Promise<boolean> {
  if (!principalId) return false;
  const rows = await db
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
// Action handlers
// ---------------------------------------------------------------------------

interface HandlerDeps {
  auth: AuthResult;
  tenantId: string;
  target: Target;
}

interface VisibleWorkspaceObject {
  path: string;
  readKey: string;
}

function targetReadPrefixes(target: Target): string[] {
  return [
    ...new Set([target.prefix, ...(target.readPrefixes ?? [])].filter(Boolean)),
  ];
}

function canonicalWorkspacePath(target: Target, path: string): string | null {
  if (path.startsWith("/")) return null;
  const clean = path.replace(/^\/+/, "");
  if (!clean) return null;
  if (isLegacyWorkspacePath(target, clean)) return null;
  return clean;
}

function isLegacyWorkspacePath(target: Target, path: string): boolean {
  const clean = path.replace(/^\/+/, "");
  if (
    clean === "workspace-archives" ||
    clean.startsWith("workspace-archives/")
  ) {
    return true;
  }
  if (
    target.kind === "space" &&
    (clean === "source" || clean.startsWith("source/"))
  ) {
    return true;
  }
  if (
    (target.kind === "agent" ||
      target.kind === "template" ||
      target.kind === "defaults" ||
      target.kind === "space") &&
    (clean === "workspace" || clean.startsWith("workspace/"))
  ) {
    return true;
  }
  return false;
}

function storagePathCandidatesForTarget(
  target: Target,
  path: string,
): string[] {
  const clean = path.replace(/^\/+/, "");
  return clean && !isLegacyWorkspacePath(target, clean) ? [clean] : [];
}

function isVisibleListedPath(target: Target, path: string): boolean {
  if (path === "manifest.json" || path === "_defaults_version") return false;
  if (target.kind === "user" && !isVisibleUserContextPath(path)) return false;
  if (target.kind === "catalog" && !isAllowedCatalogPath(path)) return false;
  if (isBuiltinToolWorkspacePath(path)) return false;
  return true;
}

async function listVisibleWorkspaceObjects(
  target: Target,
): Promise<VisibleWorkspaceObject[]> {
  const byPath = new Map<
    string,
    { object: VisibleWorkspaceObject; canonicalScore: number; index: number }
  >();
  const ordered: string[] = [];

  for (const prefix of targetReadPrefixes(target)) {
    const rawPaths = await listPrefix(prefix);
    for (const rawPath of rawPaths) {
      const logicalPath = canonicalWorkspacePath(target, rawPath);
      if (!logicalPath || !isVisibleListedPath(target, logicalPath)) continue;

      const canonicalScore =
        prefix === target.prefix && rawPath === logicalPath
          ? 2
          : prefix === target.prefix
            ? 1
            : 0;
      const existing = byPath.get(logicalPath);
      const object = { path: logicalPath, readKey: `${prefix}${rawPath}` };
      if (!existing) {
        ordered.push(logicalPath);
        byPath.set(logicalPath, {
          object,
          canonicalScore,
          index: ordered.length - 1,
        });
      } else if (canonicalScore > existing.canonicalScore) {
        byPath.set(logicalPath, {
          object,
          canonicalScore,
          index: existing.index,
        });
      }
    }
  }

  type VisibleEntry = {
    object: VisibleWorkspaceObject;
    canonicalScore: number;
    index: number;
  };

  return ordered
    .map((path) => byPath.get(path))
    .filter((entry): entry is VisibleEntry => Boolean(entry))
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.object);
}

async function readWorkspaceObject(
  target: Target,
  path: string,
): Promise<{ content: string | null; key: string | null }> {
  const prefixes = targetReadPrefixes(target);
  for (const prefix of prefixes) {
    for (const candidatePath of storagePathCandidatesForTarget(target, path)) {
      try {
        const key = `${prefix}${candidatePath}`;
        const resp = await s3.send(
          new GetObjectCommand({ Bucket: bucket(), Key: key }),
        );
        if (!resp) continue;
        return {
          content: (await resp.Body?.transformToString("utf-8")) ?? "",
          key,
        };
      } catch (err) {
        if (isNoSuchKey(err)) continue;
        throw err;
      }
    }
  }
  return { content: null, key: null };
}

async function handleGet(
  deps: HandlerDeps,
  path: string,
): Promise<APIGatewayProxyResult> {
  const { target } = deps;
  const logicalPath = canonicalWorkspacePath(target, path);
  if (!logicalPath) {
    return json(400, {
      ok: false,
      error:
        "Legacy workspace wrapper paths are no longer supported after Workspace Contract v1 migration.",
    });
  }
  if (target.kind === "user" && !isVisibleUserContextPath(logicalPath)) {
    return json(403, {
      ok: false,
      error: "User context path is not editable from this surface.",
    });
  }
  // Per docs/plans/2026-04-27-003: every S3 target tier (agent / template /
  // defaults / user context) reads its own prefix directly. No overlay walk, no
  // template/defaults fallback for agents — the agent prefix is the
  // source of truth.
  const { content } = await readWorkspaceObject(target, logicalPath);
  return json(200, {
    ok: true,
    content,
    source: target.kind,
    sha256: "",
  });
}

async function handleList(
  deps: HandlerDeps,
  includeContent: boolean,
): Promise<APIGatewayProxyResult> {
  const { target } = deps;
  // Per docs/plans/2026-04-27-003: every S3 tier reads its own prefix
  // directly. The agent prefix IS the agent's workspace — no overlay,
  // no fallback, no `agent-override` vs `template` source labels.
  // Operational artifacts (manifest.json, _defaults_version) are
  // filtered so callers don't accidentally treat them as workspace
  // files.
  const visibleObjects = await listVisibleWorkspaceObjects(target);
  const visiblePaths = visibleObjects.map((object) => object.path);

  if (target.kind === "catalog") {
    return await handleCatalogList(target, visiblePaths, includeContent);
  }

  if (!includeContent) {
    return json(200, {
      ok: true,
      files: visiblePaths.map((p) => ({
        path: p,
        source: target.kind,
        sha256: "",
        overridden: false,
      })),
    });
  }

  // includeContent: fetch each file. The Strands / Pi runtime cold-start
  // path sends includeContent=true and writes each file.content to its
  // local /tmp/workspace (per the runtime bootstrap helpers in U6 / U12
  // of the plan).
  const files = await Promise.all(
    visibleObjects.map(async (object) => {
      try {
        const resp = await s3.send(
          new GetObjectCommand({ Bucket: bucket(), Key: object.readKey }),
        );
        const content = (await resp.Body?.transformToString("utf-8")) ?? "";
        return {
          path: object.path,
          source: target.kind,
          sha256: "",
          overridden: false,
          content,
        };
      } catch (err) {
        // Object disappeared between list and get — return empty
        // rather than failing the whole batch.
        if (isNoSuchKey(err)) {
          return {
            path: object.path,
            source: target.kind,
            sha256: "",
            overridden: false,
            content: "",
          };
        }
        throw err;
      }
    }),
  );
  return json(200, { ok: true, files });
}

async function handleCatalogList(
  target: CatalogTarget,
  visiblePaths: string[],
  includeContent: boolean,
): Promise<APIGatewayProxyResult> {
  // TODO: replace per-list content reads with a catalog sha index file if
  // tenant catalogs grow large enough for this to become visible latency.
  const filesWithContent = await Promise.all(
    visiblePaths.map(async (path) => {
      try {
        const resp = await s3.send(
          new GetObjectCommand({ Bucket: bucket(), Key: target.key(path) }),
        );
        const content = (await resp.Body?.transformToString("utf-8")) ?? "";
        return { path, content };
      } catch (err) {
        if (isNoSuchKey(err)) return { path, content: "" };
        throw err;
      }
    }),
  );
  const shaBySlug = computeCatalogSkillShaBySlug(filesWithContent);

  return json(200, {
    ok: true,
    files: filesWithContent.map((file) => {
      const slug = catalogPathSlug(file.path);
      const base = {
        path: file.path,
        source: target.kind,
        sha256: shaBySlug.get(slug) ?? "",
        overridden: false,
      };
      return includeContent ? { ...base, content: file.content } : base;
    }),
  });
}

/**
 * Index-backed per-skill summary for the Skills settings list — one DB query,
 * no S3 scan or per-file reads (plan U4). Served through the same admin-gated
 * catalog dispatch as the file list. `tenantId` is caller-derived upstream.
 */
async function handleCatalogSummary(
  tenantId: string,
): Promise<APIGatewayProxyResult> {
  const skills = await listIndexedSkills(tenantId);
  return json(200, {
    ok: true,
    skills: skills.map((s) => ({
      slug: s.slug,
      displayName: s.display_name,
      description: s.description,
      category: s.category,
      icon: s.icon,
      tags: s.tags,
      sha: s.content_sha,
    })),
  });
}

function catalogPathSlug(path: string): string {
  return path.replace(/^\/+/, "").split("/")[0] ?? "";
}

function isBuiltinToolCatalogPath(path: string): boolean {
  const slug = catalogPathSlug(path);
  return Boolean(slug && isBuiltinToolSlug(slug));
}

function isAllowedCatalogPath(path: string): boolean {
  return !isBuiltinToolCatalogPath(path);
}

function isSkillMarkerPath(path: string): boolean {
  return /(?:^|\/)skills\/[^/]+\/SKILL\.md$/.test(path);
}

function summarizeDerivedAgentSkills(
  target: AgentTarget,
  result: DeriveResult,
): string {
  return (
    `agent=${target.agentId} skill_paths=${result.agentsMdPathsScanned.length} ` +
    `changed=${result.changed} added=${result.addedSlugs.join(",") || "-"} ` +
    `removed=${result.removedSlugs.join(",") || "-"}`
  );
}

async function syncDerivedAgentSkills(
  target: AgentTarget,
  tenantId: string,
  action: string,
  failureContext: string,
): Promise<
  | { ok: true; result: DeriveResult }
  | { ok: false; response: APIGatewayProxyResult }
> {
  try {
    const result = await deriveAgentSkills({ tenantId }, target.agentId);
    console.log(
      `[derive-agent-skills] ${action} ${summarizeDerivedAgentSkills(
        target,
        result,
      )}`,
    );
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[derive-agent-skills] ${action} failed: ${message}`);
    return {
      ok: false,
      response: json(500, {
        ok: false,
        error: `${failureContext}: ${message}`,
      }),
    };
  }
}

/**
 * Top-level governance / identity / capability files that, when
 * edited, materially change agent behavior. Edits to these files emit
 * `workspace.governance_file_edited` audit rows. SKILL.md is included
 * because SKILL.md edits change effective runtime capabilities. Auditing
 * the underlying file write captures the change at the filesystem source
 * of truth.
 *
 * Implementer note: this list mirrors the top-level files shipped in
 * `packages/system-workspace/`. Add new governance files here when
 * they're added to the workspace defaults bundle.
 */
const GOVERNANCE_FILE_BASENAMES: ReadonlySet<string> = new Set([
  "AGENTS.md",
  "GUARDRAILS.md",
  "MEMORY_GUIDE.md",
  "USER.md",
]);

function isGovernanceFilePath(cleanPath: string): boolean {
  // Top-level governance files: exact basename match (no nesting).
  if (GOVERNANCE_FILE_BASENAMES.has(cleanPath)) return true;
  if (isAgentProfileWorkspacePath(cleanPath)) return true;
  // SKILL.md markers anywhere under skills/<slug>/ are also
  // governance-tier — they change agent capability.
  if (isSkillMarkerPath(cleanPath)) return true;
  return false;
}

function rejectSpaceCapabilityWrite(
  path: string,
): APIGatewayProxyResult | null {
  if (!isSpaceCapabilityWritePath(path)) return null;
  return json(403, {
    ok: false,
    code: "space_capability_file_rejected",
    error:
      `Spaces cannot contain capability files such as ${path}. ` +
      "Put skills, TOOLS.md, and MCP.md under master/workspaces/ instead.",
  });
}

/**
 * Write-through to the skill_catalog index after a catalog S3 mutation.
 *
 * S3 is already committed by the time this runs, so a reindex failure must NOT
 * fail the response — that would falsely report the durable write as failed and
 * invite a retry. Instead we log and return a non-fatal warning string; the
 * `thinkwork skill catalog rebuild` command is the recovery valve for the rare
 * drift this leaves. Returns the warning, or undefined on success.
 */
async function reindexCatalogAfterMutation(
  target: CatalogTarget,
  tenantId: string,
  slug: string,
  operation: string,
): Promise<string | undefined> {
  if (!slug) return undefined;
  try {
    await reindexCatalogSkill({
      tenantId,
      tenantSlug: target.tenantSlug,
      slug,
      client: s3,
      bucket: bucket(),
    });
    return undefined;
  } catch (err) {
    console.error(
      `[workspace-files] skill_catalog reindex failed (op=${operation}, slug=${slug})`,
      err,
    );
    return `Skill catalog index not updated for '${slug}'; run 'thinkwork skill catalog rebuild' to reconcile.`;
  }
}

async function handlePut(
  deps: HandlerDeps,
  path: string,
  content: string,
  acceptTemplateUpdate: boolean,
): Promise<APIGatewayProxyResult> {
  const { target, tenantId, auth } = deps;
  let cleanPath: string;
  try {
    const canonicalPath = canonicalWorkspacePath(target, path);
    if (!canonicalPath) {
      return json(400, {
        ok: false,
        error:
          "Legacy workspace wrapper paths are no longer supported after Workspace Contract v1 migration.",
      });
    }
    cleanPath = normalizeWorkspacePath(canonicalPath);
  } catch (err) {
    return json(400, {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid workspace path",
    });
  }

  if (target.kind === "space") {
    const rejection = rejectSpaceCapabilityWrite(cleanPath);
    if (rejection) return rejection;
  }

  if (isBuiltinToolWorkspacePath(cleanPath)) {
    return json(403, {
      ok: false,
      error:
        "Built-in tools are configured through the Built-in Tools API, not workspace skill files.",
    });
  }

  if (target.kind === "user") {
    if (!isVisibleUserContextPath(cleanPath)) {
      return json(403, {
        ok: false,
        error: "User context path is not editable from this surface.",
      });
    }
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: target.key(cleanPath),
        Body: content,
        ContentType: "text/plain; charset=utf-8",
      }),
    );
    return json(200, { ok: true });
  }

  if (target.kind === "agent" && isProtectedOrchestrationWritePath(cleanPath)) {
    return json(403, {
      ok: false,
      error: "use orchestration writer",
    });
  }

  if (target.kind === "catalog" && isBuiltinToolCatalogPath(cleanPath)) {
    return json(400, {
      ok: false,
      error: `Catalog skill slug '${catalogPathSlug(cleanPath)}' conflicts with a built-in tool slug.`,
      code: "builtin_tool_slug",
    });
  }

  if (target.kind === "catalog") {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: target.key(cleanPath),
        Body: content,
        ContentType: "text/plain; charset=utf-8",
      }),
    );
    const indexWarning = await reindexCatalogAfterMutation(
      target,
      tenantId,
      catalogPathSlug(cleanPath),
      "put",
    );
    return json(200, { ok: true, ...(indexWarning ? { indexWarning } : {}) });
  }

  if (target.kind === "thread") {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: target.key(cleanPath),
        Body: content,
        ContentType: "text/plain; charset=utf-8",
      }),
    );
    return json(200, { ok: true });
  }

  if (target.kind === "space") {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: target.key(cleanPath),
        Body: content,
        ContentType: "text/plain; charset=utf-8",
      }),
    );
    if (cleanPath === "SPACE.md") {
      const refreshError = await refreshSpaceManifestProjection(
        target,
        content,
      );
      if (refreshError) return refreshError;
    }
    return json(200, { ok: true });
  }

  // Resolve audit actor once per request. apikey path → system,
  // cognito path → user with resolved users.id.
  const auditActor = await resolveAuditActor(auth);

  if (target.kind === "agent") {
    // Guardrail-class files require accept-update flag. Unit 9 will wire
    // this up through a GraphQL mutation that bumps the pinned hash
    // atomically; the flag here keeps the door open for admin-UI
    // diff-preview flows that write an override after the operator
    // accepts.
    if (isPinnedWorkspacePath(cleanPath) && !acceptTemplateUpdate) {
      return json(403, {
        ok: false,
        error: `Cannot write pinned file ${cleanPath} without acceptTemplateUpdate. Use the acceptTemplateUpdate mutation (Unit 9) or pass acceptTemplateUpdate: true if you have already reviewed the diff.`,
      });
    }

    if (isGovernanceFilePath(cleanPath)) {
      // Governance file edit: emit audit row inside a tx, then run the
      // S3 put inside the same tx callback so an S3 throw rolls back
      // the audit row. Emit FIRST, S3 second — emit failure prevents
      // the S3 write entirely. Cost: pool slot held across the S3
      // round-trip (acknowledged tradeoff per master plan U5 risks).
      try {
        await db.transaction(async (tx) => {
          await emitAuditEvent(tx, {
            tenantId,
            actorId: auditActor.actorId,
            actorType: auditActor.actorType,
            eventType: "workspace.governance_file_edited",
            source: "lambda",
            payload: {
              file: cleanPath,
              content,
              workspaceId: target.tenantSlug,
            },
            resourceType: "workspace_file",
            resourceId: `${target.tenantSlug}/${target.agentSlug}/${cleanPath}`,
            action: "edit",
            outcome: "success",
          });
          await s3.send(
            new PutObjectCommand({
              Bucket: bucket(),
              Key: target.key(cleanPath),
              Body: content,
              ContentType: "text/plain; charset=utf-8",
            }),
          );
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[workspace-files] governance PUT failed: ${message}`);
        return json(500, {
          ok: false,
          error: `Governance file edit could not be safely audited: ${message}`,
        });
      }
    } else {
      // Non-governance files (notes, free-form data): unaudited
      // unwrapped S3 put, preserving today's hot-path behavior.
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket(),
          Key: target.key(cleanPath),
          Body: content,
          ContentType: "text/plain; charset=utf-8",
        }),
      );
    }

    await regenerateManifest(bucket(), target.tenantSlug, target.agentSlug);

    if (isAgentProfileWorkspacePath(cleanPath)) {
      try {
        await upsertAgentProfileProjectionFromFile({
          tenantId,
          path: cleanPath,
          content,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json(400, {
          ok: false,
          error: `Agent Profile file saved but projection refresh failed: ${message}`,
        });
      }
    }

    if (isSkillMarkerPath(cleanPath)) {
      const derive = await syncDerivedAgentSkills(
        target,
        tenantId,
        "PUT",
        "Skill file persisted but agent_skills derive failed",
      );
      if (!derive.ok) return derive.response;
      const refreshError = await refreshAgentAgentsMdSections(target, "PUT");
      if (refreshError) return refreshError;
      if (derive.result.warnings.length > 0) {
        return json(200, {
          ok: true,
          deriveWarnings: derive.result.warnings,
        });
      }
      return json(200, { ok: true });
    }

    const refreshError = await refreshAgentAgentsMdSections(target, "PUT");
    if (refreshError) return refreshError;
    return json(200, { ok: true });
  }

  // Template / defaults: tenant already validated at target resolution.
  // Invalidate every agent in the tenant — the base layer moved.
  // Governance-file template edits (e.g., a tenant's default AGENTS.md)
  // also emit; non-governance template files take the unwrapped path.
  if (isGovernanceFilePath(cleanPath)) {
    try {
      await db.transaction(async (tx) => {
        await emitAuditEvent(tx, {
          tenantId,
          actorId: auditActor.actorId,
          actorType: auditActor.actorType,
          eventType: "workspace.governance_file_edited",
          source: "lambda",
          payload: {
            file: cleanPath,
            content,
            workspaceId: target.tenantSlug,
          },
          resourceType: "workspace_template",
          resourceId: `${target.tenantSlug}/${cleanPath}`,
          action: "edit",
          outcome: "success",
        });
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket(),
            Key: target.key(cleanPath),
            Body: content,
            ContentType: "text/plain; charset=utf-8",
          }),
        );
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[workspace-files] governance template PUT failed: ${message}`,
      );
      return json(500, {
        ok: false,
        error: `Governance template edit could not be safely audited: ${message}`,
      });
    }
  } else {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: target.key(cleanPath),
        Body: content,
        ContentType: "text/plain; charset=utf-8",
      }),
    );
  }
  return json(200, { ok: true });
}

/**
 * Resolve the audit actor for the request:
 *   apikey path → actorType: "system", actorId: "platform-credential"
 *     (do NOT trust event.headers["x-principal-id"] — it's an
 *     unverified self-assertion per tenant-membership.ts:112-114)
 *   cognito path → actorType: "user", actorId: resolved users.id
 *     (or principalId fallback when the users-lookup misses)
 */
async function resolveAuditActor(
  auth: AuthResult,
): Promise<{ actorId: string; actorType: "user" | "system" }> {
  if (auth.authType === "apikey") {
    return { actorId: "platform-credential", actorType: "system" };
  }
  const { userId } = await resolveCallerFromAuth(auth);
  return {
    actorId: userId ?? auth.principalId ?? "unknown",
    actorType: "user",
  };
}

const SUB_AGENT_SLUG_RE = /^[a-z][a-z0-9-]{0,31}$/;

async function handleCreateSubAgent(
  deps: HandlerDeps,
  slug: string,
  contextContent: string,
): Promise<APIGatewayProxyResult> {
  const { target, tenantId } = deps;
  if (target.kind !== "agent") {
    return json(400, { ok: false, error: "create-sub-agent requires agentId" });
  }

  const cleanSlug = slug.trim();
  if (!SUB_AGENT_SLUG_RE.test(cleanSlug)) {
    return json(400, {
      ok: false,
      error:
        "Slug must start with lowercase letter and contain only a-z, 0-9, and hyphens.",
    });
  }
  if (isReservedFolderSegment(cleanSlug)) {
    return json(400, {
      ok: false,
      error: `\`${cleanSlug}\` is a reserved folder name.`,
    });
  }
  // Read directly from the agent prefix — under the materialize-at-
  // write-time model, the agent prefix is the source of truth.
  const existingPaths = await listPrefix(target.prefix);
  const existingTopFolders = new Set(
    existingPaths
      .filter((path) => path.includes("/"))
      .map((path) => path.split("/")[0])
      .filter((segment): segment is string => Boolean(segment)),
  );
  const subAgentFolderExists = existingPaths.some(
    (path) =>
      path.startsWith(`${cleanSlug}/`) ||
      path.startsWith(`workspaces/${cleanSlug}/`),
  );
  if (existingTopFolders.has(cleanSlug) || subAgentFolderExists) {
    return json(409, {
      ok: false,
      error: `A folder named \`${cleanSlug}\` already exists at this agent's root.`,
    });
  }

  let agentsMd = defaultAgentsMd();
  try {
    const resp = await s3.send(
      new GetObjectCommand({
        Bucket: bucket(),
        Key: target.key("AGENTS.md"),
      }),
    );
    agentsMd = (await resp.Body?.transformToString("utf-8")) ?? agentsMd;
  } catch (err) {
    if (!isNoSuchKey(err)) throw err;
  }

  const nextAgentsMd = appendRoutingRowIfMissing(agentsMd, {
    task: `${cleanSlug} specialist`,
    goTo: `workspaces/${cleanSlug}/`,
    read: `workspaces/${cleanSlug}/CONTEXT.md`,
    skills: [],
  });

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: target.key(`workspaces/${cleanSlug}/CONTEXT.md`),
      Body: contextContent,
      ContentType: "text/plain; charset=utf-8",
    }),
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: target.key("AGENTS.md"),
      Body: nextAgentsMd,
      ContentType: "text/plain; charset=utf-8",
    }),
  );

  await regenerateManifest(bucket(), target.tenantSlug, target.agentSlug);

  const derive = await syncDerivedAgentSkills(
    target,
    tenantId,
    "create-sub-agent",
    "AGENTS.md persisted but agent_skills derive failed",
  );
  if (!derive.ok) return derive.response;

  const refreshError = await refreshAgentAgentsMdSections(
    target,
    "create-sub-agent",
  );
  if (refreshError) return refreshError;
  if (derive.result.warnings.length > 0) {
    return json(200, {
      ok: true,
      deriveWarnings: derive.result.warnings,
    });
  }
  return json(200, { ok: true });
}

async function handleDelete(
  deps: HandlerDeps,
  path: string,
): Promise<APIGatewayProxyResult> {
  const { target, tenantId } = deps;
  const cleanPath = canonicalWorkspacePath(target, path);
  if (!cleanPath) {
    return json(400, {
      ok: false,
      error:
        "Legacy workspace wrapper paths are no longer supported after Workspace Contract v1 migration.",
    });
  }
  if (target.kind === "user" && !isVisibleUserContextPath(cleanPath)) {
    return json(403, {
      ok: false,
      error: "User context path is not editable from this surface.",
    });
  }
  await s3.send(
    new DeleteObjectCommand({ Bucket: bucket(), Key: target.key(cleanPath) }),
  );
  let indexWarning: string | undefined;
  if (target.kind === "agent") {
    await regenerateManifest(bucket(), target.tenantSlug, target.agentSlug);
    if (isAgentProfileWorkspacePath(cleanPath)) {
      await deleteAgentProfileProjectionForFile({ tenantId, path: cleanPath });
    }
    if (isSkillMarkerPath(cleanPath)) {
      const derive = await syncDerivedAgentSkills(
        target,
        tenantId,
        "DELETE",
        "Skill file deleted but agent_skills derive failed",
      );
      if (!derive.ok) return derive.response;
    }
    const refreshError = await refreshAgentAgentsMdSections(target, "DELETE");
    if (refreshError) return refreshError;
  } else if (target.kind === "catalog") {
    // Re-index the affected slug: deleting one file of a multi-file skill
    // refreshes its sha; deleting the last file removes the row.
    indexWarning = await reindexCatalogAfterMutation(
      target,
      tenantId,
      catalogPathSlug(cleanPath),
      "delete",
    );
  }
  return json(200, { ok: true, ...(indexWarning ? { indexWarning } : {}) });
}

async function handleInstallSkill(
  deps: HandlerDeps,
  slug: string,
  wiringChoice: string,
): Promise<APIGatewayProxyResult> {
  const { target, tenantId } = deps;
  if (target.kind === "space") {
    return rejectSpaceCapabilityWrite(`skills/${slug}/SKILL.md`)!;
  }
  if (target.kind !== "agent") {
    return json(400, {
      ok: false,
      error: "install-skill requires an agent target",
      code: "unsupported_target",
    });
  }

  let result;
  try {
    result = await installCatalogSkill({
      s3,
      bucket: bucket(),
      tenantSlug: target.tenantSlug,
      targetPrefix: target.prefix,
      slug,
      wiringChoice,
    });
  } catch (err) {
    if (err instanceof CatalogInstallError) {
      return json(err.status, {
        ok: false,
        error: err.message,
        code: err.code,
      });
    }
    throw err;
  }

  if (target.kind !== "agent") {
    return json(200, result);
  }

  await regenerateManifest(bucket(), target.tenantSlug, target.agentSlug);
  const derive = await syncDerivedAgentSkills(
    target,
    tenantId,
    "install-skill",
    "Skill installed but agent_skills derive failed",
  );
  if (!derive.ok) return derive.response;
  const refreshError = await refreshAgentAgentsMdSections(
    target,
    "install-skill",
  );
  if (refreshError) return refreshError;
  return json(200, {
    ...result,
    ...(derive.result.warnings.length > 0
      ? { deriveWarnings: derive.result.warnings }
      : {}),
  });
}

async function handleUninstallSkill(
  deps: HandlerDeps,
  slug: string,
): Promise<APIGatewayProxyResult> {
  const { target, tenantId } = deps;
  if (target.kind !== "agent" && target.kind !== "space") {
    return json(400, {
      ok: false,
      error: "uninstall-skill requires an agent or space target",
      code: "unsupported_target",
    });
  }

  let result;
  try {
    result = await uninstallCatalogSkill({
      s3,
      bucket: bucket(),
      targetPrefix: target.prefix,
      slug,
    });
  } catch (err) {
    if (err instanceof CatalogUninstallError) {
      return json(err.status, {
        ok: false,
        error: err.message,
        code: err.code,
      });
    }
    throw err;
  }

  if (target.kind !== "agent") {
    return json(200, result);
  }

  await regenerateManifest(bucket(), target.tenantSlug, target.agentSlug);
  const derive = await syncDerivedAgentSkills(
    target,
    tenantId,
    "uninstall-skill",
    "Skill uninstalled but agent_skills derive failed",
  );
  if (!derive.ok) return derive.response;
  const refreshError = await refreshAgentAgentsMdSections(
    target,
    "uninstall-skill",
  );
  if (refreshError) return refreshError;
  return json(200, {
    ...result,
    ...(derive.result.warnings.length > 0
      ? { deriveWarnings: derive.result.warnings }
      : {}),
  });
}

async function handleReinstallSkill(
  deps: HandlerDeps,
  slug: string,
): Promise<APIGatewayProxyResult> {
  const { target, tenantId } = deps;
  if (target.kind === "space") {
    return rejectSpaceCapabilityWrite(`skills/${slug}/SKILL.md`)!;
  }
  if (target.kind !== "agent") {
    return json(400, {
      ok: false,
      error: "reinstall-skill requires an agent target",
      code: "unsupported_target",
    });
  }

  let result;
  try {
    result = await reinstallCatalogSkill({
      s3,
      bucket: bucket(),
      tenantSlug: target.tenantSlug,
      targetPrefix: target.prefix,
      slug,
    });
  } catch (err) {
    if (err instanceof CatalogReinstallError) {
      return json(err.status, {
        ok: false,
        error: err.message,
        code: err.code,
      });
    }
    throw err;
  }

  if (target.kind !== "agent") {
    return json(200, result);
  }

  await regenerateManifest(bucket(), target.tenantSlug, target.agentSlug);
  const derive = await syncDerivedAgentSkills(
    target,
    tenantId,
    "reinstall-skill",
    "Skill reinstalled but agent_skills derive failed",
  );
  if (!derive.ok) return derive.response;
  const refreshError = await refreshAgentAgentsMdSections(
    target,
    "reinstall-skill",
  );
  if (refreshError) return refreshError;
  return json(200, {
    ...result,
    ...(derive.result.warnings.length > 0
      ? { deriveWarnings: derive.result.warnings }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// `move` action — atomic copy + delete, single-file in this unit
// ---------------------------------------------------------------------------

/**
 * S3 `CopySource` header must be URL-encoded per AWS docs. Encode each
 * path segment and preserve `/` separators so keys with spaces or
 * parentheses (e.g. an auto-renamed `notes (2).md`) survive the copy.
 */
function s3CopySource(key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${bucket()}/${encoded}`;
}

function pathBasename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function joinFolderPath(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

function splitNameAndExtension(name: string): { stem: string; ext: string } {
  // Hidden files (`.gitkeep`, `.env`) are treated as having no extension —
  // the leading dot is part of the stem so collision resolution produces
  // `.gitkeep (2)` rather than ` (2).gitkeep`.
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/**
 * Resolve a name collision by appending ` (2)`, ` (3)`, … until unique.
 * For files, the suffix is inserted before the extension so
 * `notes.md` → `notes (2).md`. For folders, the suffix is appended.
 */
function resolveCollisionName(
  desired: string,
  occupied: Set<string>,
  isFolder: boolean,
): string {
  if (!occupied.has(desired)) return desired;
  const { stem, ext } = isFolder
    ? { stem: desired, ext: "" }
    : splitNameAndExtension(desired);
  for (let n = 2; n < 10000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error(`Unable to resolve collision for ${desired}`);
}

/**
 * Compute the immediate child names of the destination folder, used for
 * collision detection. `.gitkeep` sentinels are excluded — they're a
 * folder-identity marker, not a real conflict.
 *
 * Caller passes the resolved `prefix` and `key` builder so this helper
 * does not need to narrow the `Target` union (Computer targets are
 * already rejected upstream and do not carry these fields).
 */
async function listImmediateChildren(
  prefix: string,
  keyOf: (path: string) => string,
  folderPath: string,
): Promise<Set<string>> {
  const listKey = folderPath === "" ? prefix : keyOf(folderPath) + "/";
  const paths = await listPrefix(listKey);
  const children = new Set<string>();
  for (const p of paths) {
    const seg = p.split("/")[0];
    if (!seg) continue;
    if (seg === ".gitkeep") continue;
    children.add(seg);
  }
  return children;
}

interface MoveSuccessPayload {
  ok: true;
  destPath: string;
  movedCount: number;
  detachedPinnedCount: number;
}

// Move helpers operate on non-Computer targets (rejected upstream by
// `handleMove`). This narrowed alias removes the need to repeatedly
// pass `.prefix` and `.key` separately to the helpers.
type WritableMoveTarget = Target;
interface MoveHandlerDeps extends HandlerDeps {
  target: WritableMoveTarget;
}

async function handleMove(
  deps: HandlerDeps,
  fromPath: string,
  toFolder: string,
): Promise<APIGatewayProxyResult> {
  const { target } = deps;

  let cleanFrom: string;
  let cleanToFolder: string;
  try {
    const canonicalFrom = canonicalWorkspacePath(target, fromPath);
    const canonicalToFolder =
      toFolder === "" ? "" : canonicalWorkspacePath(target, toFolder);
    if (!canonicalFrom || canonicalToFolder === null) {
      return json(400, {
        ok: false,
        error:
          "Legacy workspace wrapper paths are no longer supported after Workspace Contract v1 migration.",
      });
    }
    cleanFrom = normalizeWorkspacePath(canonicalFrom);
    cleanToFolder =
      canonicalToFolder === "" ? "" : normalizeWorkspacePath(canonicalToFolder);
  } catch (err) {
    return json(400, {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid workspace path",
    });
  }

  if (target.kind === "user" && !isVisibleUserContextPath(cleanFrom)) {
    return json(403, {
      ok: false,
      error: "User context path is not editable from this surface.",
    });
  }
  if (target.kind === "space") {
    const desiredDest = joinFolderPath(cleanToFolder, pathBasename(cleanFrom));
    const rejection = rejectSpaceCapabilityWrite(desiredDest);
    if (rejection) return rejection;
  }
  if (isBuiltinToolWorkspacePath(cleanFrom)) {
    return json(403, {
      ok: false,
      error:
        "Built-in tools are configured through the Built-in Tools API, not workspace skill files.",
    });
  }

  // Folder detection: a source path is a folder if listing its prefix
  // (with trailing slash) returns at least one object. Use the
  // unfiltered listing — a folder whose only contents are operational
  // artifacts (manifest.json etc.) is still a folder and must be moved
  // as one.
  // `target` is narrowed to `WritableMoveTarget` here — Computer was
  // rejected above — but TypeScript can't propagate the narrowing across
  // the function boundary, so we forward a cast.
  const moveDeps: MoveHandlerDeps = {
    ...deps,
    target: target as WritableMoveTarget,
  };
  const folderListing = await listAllObjectsUnfiltered(
    target.key(cleanFrom) + "/",
  );
  if (folderListing.length > 0) {
    return await handleFolderMove(
      moveDeps,
      cleanFrom,
      cleanToFolder,
      folderListing,
    );
  }
  return await handleSingleFileMove(moveDeps, cleanFrom, cleanToFolder);
}

async function handleSingleFileMove(
  deps: MoveHandlerDeps,
  cleanFrom: string,
  cleanToFolder: string,
): Promise<APIGatewayProxyResult> {
  const { target } = deps;

  // Compute destination with collision-resolved name.
  const fromBase = pathBasename(cleanFrom);
  const desiredDest = joinFolderPath(cleanToFolder, fromBase);
  if (desiredDest === cleanFrom) {
    return json(400, {
      ok: false,
      error: "Source and destination are identical",
    });
  }
  if (target.kind === "space") {
    const rejection = rejectSpaceCapabilityWrite(desiredDest);
    if (rejection) return rejection;
  }

  const occupiedSiblings = await listImmediateChildren(
    target.prefix,
    target.key,
    cleanToFolder,
  );
  const finalBase = resolveCollisionName(fromBase, occupiedSiblings, false);
  const finalDest = joinFolderPath(cleanToFolder, finalBase);

  if (isBuiltinToolWorkspacePath(finalDest)) {
    return json(403, {
      ok: false,
      error:
        "Built-in tools are configured through the Built-in Tools API, not workspace skill files.",
    });
  }
  if (target.kind === "user" && !isVisibleUserContextPath(finalDest)) {
    return json(403, {
      ok: false,
      error: "Destination is not editable from this surface.",
    });
  }
  if (target.kind === "agent" && isProtectedOrchestrationWritePath(finalDest)) {
    return json(403, {
      ok: false,
      error: "use orchestration writer",
    });
  }

  const sourceKey = target.key(cleanFrom);
  const destKey = target.key(finalDest);

  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket(),
        CopySource: s3CopySource(sourceKey),
        Key: destKey,
      }),
    );
  } catch (err) {
    if (isNoSuchKey(err)) {
      return json(404, { ok: false, error: "Source file not found" });
    }
    throw err;
  }

  await s3.send(new DeleteObjectCommand({ Bucket: bucket(), Key: sourceKey }));

  const detachedPinnedCount =
    target.kind === "agent" && isPinnedWorkspacePath(cleanFrom) ? 1 : 0;

  if (target.kind === "agent") {
    await regenerateManifest(bucket(), target.tenantSlug, target.agentSlug);

    const fromIsAgentsMd = pathBasename(cleanFrom) === "AGENTS.md";
    const destIsAgentsMd = pathBasename(finalDest) === "AGENTS.md";
    const fromIsSkillMd = isSkillMarkerPath(cleanFrom);
    const destIsSkillMd = isSkillMarkerPath(finalDest);
    if (fromIsAgentsMd || destIsAgentsMd || fromIsSkillMd || destIsSkillMd) {
      const derive = await syncDerivedAgentSkills(
        target,
        deps.tenantId,
        "move",
        "Move succeeded but agent_skills derive failed",
      );
      if (!derive.ok) return derive.response;
    }

    const refreshError = await refreshAgentAgentsMdSections(target, "move");
    if (refreshError) return refreshError;
  }
  // No catalog branch: the dispatcher rejects move/rename for catalog targets
  // (only get/list/put/delete are allowed), so skill_catalog write-through lives
  // only in handlePut/handleDelete.

  const payload: MoveSuccessPayload = {
    ok: true,
    destPath: finalDest,
    movedCount: 1,
    detachedPinnedCount,
  };
  return json(200, payload);
}

async function handleFolderMove(
  deps: MoveHandlerDeps,
  cleanFrom: string,
  cleanToFolder: string,
  folderListing: string[],
): Promise<APIGatewayProxyResult> {
  const { target } = deps;

  // Compute the destination folder name with collision resolution
  // against folder siblings at the destination level.
  const folderName = pathBasename(cleanFrom);
  const desiredDest = joinFolderPath(cleanToFolder, folderName);
  if (desiredDest === cleanFrom) {
    return json(400, {
      ok: false,
      error: "Source and destination are identical",
    });
  }
  if (target.kind === "space") {
    const rejection = rejectSpaceCapabilityWrite(desiredDest);
    if (rejection) return rejection;
  }

  const occupied = await listImmediateChildren(
    target.prefix,
    target.key,
    cleanToFolder,
  );
  const finalFolderName = resolveCollisionName(folderName, occupied, true);
  const finalDestPath = joinFolderPath(cleanToFolder, finalFolderName);

  const sourcePrefix = target.key(cleanFrom) + "/";
  const destPrefix = target.key(finalDestPath) + "/";

  // Reject moving a folder into itself (or into a subfolder of itself).
  // Without this guard, the copy phase would create cycles when the
  // destination prefix is contained within the source prefix.
  if (destPrefix.startsWith(sourcePrefix)) {
    return json(400, {
      ok: false,
      error: "Cannot move a folder into itself or a subfolder of itself",
    });
  }

  // Destination-side path validation (same checks the file path runs).
  if (
    target.kind === "agent" &&
    isProtectedOrchestrationWritePath(finalDestPath)
  ) {
    return json(403, {
      ok: false,
      error: "use orchestration writer",
    });
  }
  if (target.kind === "user" && !isVisibleUserContextPath(finalDestPath)) {
    return json(403, {
      ok: false,
      error: "Destination is not editable from this surface.",
    });
  }

  // Phase 1: copy every object under the source prefix to the destination
  // prefix, preserving relative paths. We copy all-before-any-delete so
  // that a copy failure mid-walk leaves the source intact and the user
  // can retry without partial data loss.
  //
  // Pinned-file accounting note: `isPinnedWorkspacePath` only matches
  // root-level PINNED_FILES (currently GUARDRAILS.md). Folder moves therefore always report
  // `detachedPinnedCount: 0` in practice — those root files cannot be
  // inside any subfolder being moved. The field stays in the response
  // for shape parity with single-file moves; a richer
  // template-inheritance-aware detach metric is a follow-up.
  let detachedPinnedCount = 0;
  let touchesAgentsMd = false;
  let touchesSkillMd = false;

  for (const rel of folderListing) {
    const sourceKey = sourcePrefix + rel;
    const destKey = destPrefix + rel;
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket(),
        CopySource: s3CopySource(sourceKey),
        Key: destKey,
      }),
    );
    const sourceRelPath = cleanFrom + "/" + rel;
    if (target.kind === "agent" && isPinnedWorkspacePath(sourceRelPath)) {
      detachedPinnedCount++;
    }
    if (pathBasename(sourceRelPath) === "AGENTS.md") touchesAgentsMd = true;
    if (isSkillMarkerPath(sourceRelPath)) touchesSkillMd = true;
  }

  // Phase 2: delete every source object. We accumulate per-object delete
  // failures so the user gets a meaningful error rather than a generic
  // 500 — the destination is already populated, so the operator's
  // recovery path is "refresh the file list and clean up the source".
  const deleteFailures: string[] = [];
  for (const rel of folderListing) {
    const sourceKey = sourcePrefix + rel;
    try {
      await s3.send(
        new DeleteObjectCommand({ Bucket: bucket(), Key: sourceKey }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deleteFailures.push(`${rel}: ${message}`);
    }
  }

  if (deleteFailures.length > 0) {
    // Partial-delete: surface to the client without trusting that
    // manifest regen / derive will run on a coherent tree.
    return json(500, {
      ok: false,
      error:
        `Move partially completed: ${deleteFailures.length} source object(s) could not be deleted. ` +
        `Refresh and clean up the source folder.`,
      partiallyDeleted: true,
      destPath: finalDestPath,
      movedCount: folderListing.length,
      detachedPinnedCount,
    });
  }

  // Source folder is now fully empty (every object copied and deleted,
  // including any operational artifacts and existing `.gitkeep` that
  // travelled with the move). We do NOT re-emit a sentinel at the
  // source — Finder-style semantics: a moved folder disappears from
  // the source location. Future operator-driven creates can recreate
  // the folder at that path explicitly.

  if (target.kind === "agent") {
    await regenerateManifest(bucket(), target.tenantSlug, target.agentSlug);

    if (touchesAgentsMd || touchesSkillMd) {
      const derive = await syncDerivedAgentSkills(
        target,
        deps.tenantId,
        "folder-move",
        "Move succeeded but agent_skills derive failed",
      );
      if (!derive.ok) return derive.response;
    }

    const refreshError = await refreshAgentAgentsMdSections(target, "move");
    if (refreshError) return refreshError;
  }
  // No catalog branch: move/rename are rejected for catalog targets upstream
  // (see dispatcher allowlist), so write-through is put/delete only.

  const payload: MoveSuccessPayload = {
    ok: true,
    destPath: finalDestPath,
    movedCount: folderListing.length,
    detachedPinnedCount,
  };
  return json(200, payload);
}

async function handleRename(
  deps: HandlerDeps,
  fromPath: string,
  toPath: string,
): Promise<APIGatewayProxyResult> {
  const { target } = deps;

  let cleanFrom: string;
  let cleanTo: string;
  try {
    const canonicalFrom = canonicalWorkspacePath(target, fromPath);
    const canonicalTo = canonicalWorkspacePath(target, toPath);
    if (!canonicalFrom || !canonicalTo) {
      return json(400, {
        ok: false,
        error:
          "Legacy workspace wrapper paths are no longer supported after Workspace Contract v1 migration.",
      });
    }
    cleanFrom = normalizeWorkspacePath(canonicalFrom);
    cleanTo = normalizeWorkspacePath(canonicalTo);
  } catch (err) {
    return json(400, {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid workspace path",
    });
  }

  if (cleanFrom === cleanTo) {
    return json(400, {
      ok: false,
      error: "Source and destination are identical",
    });
  }

  const renameDeps: MoveHandlerDeps = {
    ...deps,
    target: target as WritableMoveTarget,
  };
  const validationError = validateRenamePaths(renameDeps, cleanFrom, cleanTo);
  if (validationError) return validationError;

  const folderListing = await listAllObjectsUnfiltered(
    renameDeps.target.key(cleanFrom) + "/",
  );
  if (folderListing.length > 0) {
    const sourcePrefix = renameDeps.target.key(cleanFrom) + "/";
    const destPrefix = renameDeps.target.key(cleanTo) + "/";
    if (destPrefix.startsWith(sourcePrefix)) {
      return json(400, {
        ok: false,
        error: "Cannot rename a folder into itself or a subfolder of itself",
      });
    }
  }

  if (await workspacePathExists(renameDeps.target, cleanTo)) {
    return json(409, {
      ok: false,
      error: `Destination already exists: ${cleanTo}`,
    });
  }

  if (folderListing.length > 0) {
    return await handleFolderRename(
      renameDeps,
      cleanFrom,
      cleanTo,
      folderListing,
    );
  }
  return await handleSingleFileRename(renameDeps, cleanFrom, cleanTo);
}

function validateRenamePaths(
  deps: MoveHandlerDeps,
  cleanFrom: string,
  cleanTo: string,
): APIGatewayProxyResult | null {
  const { target } = deps;
  if (target.kind === "user" && !isVisibleUserContextPath(cleanFrom)) {
    return json(403, {
      ok: false,
      error: "User context path is not editable from this surface.",
    });
  }
  if (target.kind === "user" && !isVisibleUserContextPath(cleanTo)) {
    return json(403, {
      ok: false,
      error: "Destination is not editable from this surface.",
    });
  }
  if (
    isBuiltinToolWorkspacePath(cleanFrom) ||
    isBuiltinToolWorkspacePath(cleanTo)
  ) {
    return json(403, {
      ok: false,
      error:
        "Built-in tools are configured through the Built-in Tools API, not workspace skill files.",
    });
  }
  if (target.kind === "agent" && isProtectedOrchestrationWritePath(cleanTo)) {
    return json(403, {
      ok: false,
      error: "use orchestration writer",
    });
  }
  if (target.kind === "space") {
    const rejection = rejectSpaceCapabilityWrite(cleanTo);
    if (rejection) return rejection;
  }
  return null;
}

async function workspacePathExists(
  target: WritableMoveTarget,
  cleanPath: string,
): Promise<boolean> {
  try {
    await s3.send(
      new HeadObjectCommand({
        Bucket: bucket(),
        Key: target.key(cleanPath),
      }),
    );
    return true;
  } catch (err) {
    if (!isNoSuchKey(err)) throw err;
  }
  const folderListing = await listAllObjectsUnfiltered(
    target.key(cleanPath) + "/",
  );
  return folderListing.length > 0;
}

async function handleSingleFileRename(
  deps: MoveHandlerDeps,
  cleanFrom: string,
  cleanTo: string,
): Promise<APIGatewayProxyResult> {
  const { target } = deps;
  const sourceKey = target.key(cleanFrom);
  const destKey = target.key(cleanTo);

  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket(),
        CopySource: s3CopySource(sourceKey),
        Key: destKey,
      }),
    );
  } catch (err) {
    if (isNoSuchKey(err)) {
      return json(404, { ok: false, error: "Source file not found" });
    }
    throw err;
  }

  await s3.send(new DeleteObjectCommand({ Bucket: bucket(), Key: sourceKey }));

  const detachedPinnedCount =
    target.kind === "agent" && isPinnedWorkspacePath(cleanFrom) ? 1 : 0;
  const finalized = await finalizeRenameSideEffects(deps, {
    cleanFrom,
    cleanTo,
    movedCount: 1,
    detachedPinnedCount,
    touchesAgentsMd:
      pathBasename(cleanFrom) === "AGENTS.md" ||
      pathBasename(cleanTo) === "AGENTS.md",
    touchesSkillMd: isSkillMarkerPath(cleanFrom) || isSkillMarkerPath(cleanTo),
  });
  if (finalized) return finalized;

  return json(200, {
    ok: true,
    destPath: cleanTo,
    movedCount: 1,
    detachedPinnedCount,
  } satisfies MoveSuccessPayload);
}

async function handleFolderRename(
  deps: MoveHandlerDeps,
  cleanFrom: string,
  cleanTo: string,
  folderListing: string[],
): Promise<APIGatewayProxyResult> {
  const { target } = deps;
  const sourcePrefix = target.key(cleanFrom) + "/";
  const destPrefix = target.key(cleanTo) + "/";

  if (destPrefix.startsWith(sourcePrefix)) {
    return json(400, {
      ok: false,
      error: "Cannot rename a folder into itself or a subfolder of itself",
    });
  }

  let detachedPinnedCount = 0;
  let touchesAgentsMd = false;
  let touchesSkillMd = false;

  for (const rel of folderListing) {
    const sourceKey = sourcePrefix + rel;
    const destKey = destPrefix + rel;
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket(),
        CopySource: s3CopySource(sourceKey),
        Key: destKey,
      }),
    );
    const sourceRelPath = cleanFrom + "/" + rel;
    const destRelPath = cleanTo + "/" + rel;
    if (target.kind === "agent" && isPinnedWorkspacePath(sourceRelPath)) {
      detachedPinnedCount++;
    }
    if (
      pathBasename(sourceRelPath) === "AGENTS.md" ||
      pathBasename(destRelPath) === "AGENTS.md"
    ) {
      touchesAgentsMd = true;
    }
    if (isSkillMarkerPath(sourceRelPath) || isSkillMarkerPath(destRelPath)) {
      touchesSkillMd = true;
    }
  }

  const deleteFailures: string[] = [];
  for (const rel of folderListing) {
    const sourceKey = sourcePrefix + rel;
    try {
      await s3.send(
        new DeleteObjectCommand({ Bucket: bucket(), Key: sourceKey }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deleteFailures.push(`${rel}: ${message}`);
    }
  }

  if (deleteFailures.length > 0) {
    return json(500, {
      ok: false,
      error:
        `Rename partially completed: ${deleteFailures.length} source object(s) could not be deleted. ` +
        `Refresh and clean up the source folder.`,
      partiallyDeleted: true,
      destPath: cleanTo,
      movedCount: folderListing.length,
      detachedPinnedCount,
    });
  }

  const finalized = await finalizeRenameSideEffects(deps, {
    cleanFrom,
    cleanTo,
    movedCount: folderListing.length,
    detachedPinnedCount,
    touchesAgentsMd,
    touchesSkillMd,
  });
  if (finalized) return finalized;

  return json(200, {
    ok: true,
    destPath: cleanTo,
    movedCount: folderListing.length,
    detachedPinnedCount,
  } satisfies MoveSuccessPayload);
}

async function finalizeRenameSideEffects(
  deps: MoveHandlerDeps,
  input: {
    cleanFrom: string;
    cleanTo: string;
    movedCount: number;
    detachedPinnedCount: number;
    touchesAgentsMd: boolean;
    touchesSkillMd: boolean;
  },
): Promise<APIGatewayProxyResult | null> {
  const { target } = deps;
  if (target.kind !== "agent") return null;

  await regenerateManifest(bucket(), target.tenantSlug, target.agentSlug);

  if (input.touchesAgentsMd || input.touchesSkillMd) {
    const derive = await syncDerivedAgentSkills(
      target,
      deps.tenantId,
      "rename",
      "Rename succeeded but agent_skills derive failed",
    );
    if (!derive.ok) return derive.response;
  }

  return await refreshAgentAgentsMdSections(target, "rename");
}

// Line-surgery anchors for AGENTS.md identity personality fields. Only these 4
// lines are editable via `update-identity-field`; the Name line is
// reserved for `update_agent_name` (which goes through the updateAgent
// mutation + writeIdentityMdForAgent). Never exposing Name here is a
// narrow-scope guarantee — the tool's Literal type is backed by this
// server-side whitelist.
async function handleUpdateIdentityField(
  deps: HandlerDeps,
  field: string,
  value: unknown,
): Promise<APIGatewayProxyResult> {
  const { target, tenantId } = deps;
  if (target.kind !== "agent") {
    return json(400, {
      ok: false,
      error: "update-identity-field requires agentId",
    });
  }
  // Service-auth (apikey) callers must present x-agent-id matching the
  // target agent. Mirrors the updateAgent mutation's authz guard —
  // without this, any apikey holder in the tenant can edit another
  // agent's AGENTS.md identity personality fields.
  if (deps.auth.authType === "apikey") {
    if (!deps.auth.agentId || deps.auth.agentId !== target.agentId) {
      return json(403, {
        ok: false,
        error:
          "Service-auth callers must present x-agent-id matching the target agent",
      });
    }
  }
  if (!isAgentIdentityField(field)) {
    return json(400, {
      ok: false,
      error: `Unknown identity field '${field}'. Allowed: creature, vibe, emoji, avatar.`,
    });
  }
  if (typeof value !== "string") {
    return json(400, { ok: false, error: "value must be a string" });
  }
  const label = identityFieldLabel(field);

  const agentsMdKey = target.key("AGENTS.md");
  let existing: string | null = null;
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket(), Key: agentsMdKey }),
    );
    existing = (await resp.Body?.transformToString("utf-8")) ?? "";
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
      ?.$metadata?.httpStatusCode;
    const isNotFound =
      err instanceof NoSuchKey ||
      name === "NoSuchKey" ||
      name === "NotFound" ||
      status === 404;
    if (!isNotFound) throw err;
  }

  if (!existing) {
    return json(422, {
      ok: false,
      error: `AGENTS.md is missing the ${label} line anchor; have your human rerun the folder-canon migration.`,
    });
  }

  const rendered = replaceAgentsMdIdentityField(existing, field, value);
  if (rendered === null) {
    return json(422, {
      ok: false,
      error: `AGENTS.md is missing the ${label} line anchor; have your human rerun the folder-canon migration.`,
    });
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: agentsMdKey,
      Body: rendered,
      ContentType: "text/plain; charset=utf-8",
    }),
  );
  return json(200, { ok: true });
}

async function handleRegenerateMap(
  deps: HandlerDeps,
  path?: string,
): Promise<APIGatewayProxyResult> {
  const { target } = deps;
  if (target.kind !== "agent") {
    return json(400, { ok: false, error: "regenerate-map requires agentId" });
  }
  let agentsMdPath: string | undefined;
  if (path !== undefined) {
    try {
      agentsMdPath = normalizeWorkspacePath(path);
    } catch (err) {
      return json(400, {
        ok: false,
        error: err instanceof Error ? err.message : "Invalid AGENTS.md path",
      });
    }
    if (!agentsMdPath.endsWith("/AGENTS.md") && agentsMdPath !== "AGENTS.md") {
      return json(400, {
        ok: false,
        error: "regenerate-map path must point to an AGENTS.md file",
      });
    }
  }
  if (agentsMdPath === undefined) {
    await regenerateAgentsMdDerivedSections(target.agentId);
  } else {
    await regenerateAgentsMdDerivedSections(target.agentId, agentsMdPath);
  }
  return json(200, { ok: true });
}

async function handleGenerateFolderStructure(
  deps: HandlerDeps,
  path: string,
): Promise<APIGatewayProxyResult> {
  const { target } = deps;
  if (target.kind !== "agent" && target.kind !== "space") {
    return json(400, {
      ok: false,
      error: "generate-folder-structure requires agentId or spaceId",
    });
  }
  if (target.kind === "agent" && deps.auth.authType === "apikey") {
    if (!deps.auth.agentId || deps.auth.agentId !== target.agentId) {
      return json(403, {
        ok: false,
        error:
          "Service-auth callers must present x-agent-id matching the target agent",
      });
    }
  }
  if (target.kind === "space" && deps.auth.authType === "apikey") {
    return json(403, {
      ok: false,
      error:
        "generate-folder-structure on a Space requires admin authentication",
    });
  }

  let cleanPath: string;
  try {
    cleanPath = normalizeWorkspacePath(path);
  } catch (err) {
    return json(400, {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid workspace path",
    });
  }
  if (cleanPath.split("/").filter(Boolean).at(-1) !== "CONTEXT.md") {
    return json(400, {
      ok: false,
      error: "generate-folder-structure requires a CONTEXT.md path",
    });
  }

  if (target.kind === "agent") {
    await generateContextFolderStructure(target.agentId, cleanPath);
  } else {
    await generateContextFolderStructureForSpace(target.spaceId, cleanPath);
  }
  return json(200, { ok: true });
}

async function handleNormalizeMap(
  deps: HandlerDeps,
): Promise<APIGatewayProxyResult> {
  const { target } = deps;
  if (target.kind !== "agent") {
    return json(400, { ok: false, error: "normalize-map requires agentId" });
  }
  await normalizeAgentsMd(target.agentId);
  return json(200, { ok: true });
}

/**
 * Re-copy the agent's template + defaults into its S3 prefix in
 * `overwrite` mode. Operator-triggered: used to refresh an agent after
 * a template edit, or to recover an agent whose prefix drifted.
 *
 * Per docs/plans/2026-04-27-003: this replaces the old "accept template
 * update" pin-bump dance. Operator chooses per-agent; auto-propagation
 * is intentionally not a thing.
 */
async function handleRematerialize(
  deps: HandlerDeps,
): Promise<APIGatewayProxyResult> {
  const { target } = deps;
  if (target.kind !== "agent") {
    return json(400, { ok: false, error: "rematerialize requires agentId" });
  }
  const result = await bootstrapAgentWorkspace(target.agentId, {
    mode: "overwrite",
    refreshAgentsMdSections: true,
  });
  return json(200, { ok: true, ...result });
}

// ---------------------------------------------------------------------------
// Handler entry point
// ---------------------------------------------------------------------------

interface RequestBody {
  action?: string;
  agentId?: string;
  templateId?: string;
  spaceId?: string;
  threadId?: string;
  userId?: string;
  defaults?: boolean;
  catalog?: boolean;
  path?: string;
  content?: string;
  acceptTemplateUpdate?: boolean;
  /**
   * Unit 7 (Strands container cold-start) needs composed content inline
   * with the list to avoid N round-trips. The composer returns it when
   * this flag is true.
   */
  includeContent?: boolean;
  /**
   * Catalog list only: return the index-backed per-skill summary
   * (`{ skills: [...] }`) instead of the flat per-file list (plan U4).
   */
  summary?: boolean;
  /** For `update-identity-field`: creature | vibe | emoji | avatar. */
  field?: string;
  /** For `update-identity-field`: the new line content. */
  value?: string;
  /** For `create-sub-agent`: top-level sub-agent folder slug. */
  slug?: string;
  /** For `create-sub-agent`: seeded {slug}/CONTEXT.md content. */
  contextContent?: string;
  /** For `install-skill`: selected WIRING.md suggestion id. */
  wiring_choice?: string;
  /** For `move`: source file or folder path (relative to workspace). */
  fromPath?: string;
  /**
   * For `move`: destination folder path (relative to workspace).
   * Empty string `""` means the workspace root.
   */
  toFolder?: string;
  /** For `rename`: exact destination file or folder path. */
  toPath?: string;
  // Legacy shape — rejected loudly so buggy clients surface.
  tenantSlug?: string;
  instanceId?: string;
}

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  // Short-circuit CORS preflight BEFORE auth. The API Gateway forwards
  // OPTIONS to the Lambda on proxy integrations, so we have to answer
  // with a 2xx + CORS headers ourselves or browser preflight fails.
  const method = event.requestContext?.http?.method;
  if (method === "OPTIONS") {
    return corsPreflight();
  }

  if (!bucket()) {
    return json(500, { ok: false, error: "WORKSPACE_BUCKET not configured" });
  }

  const headers = normalizeHeaders(event.headers);
  const auth = await authenticate(headers);
  if (!auth) {
    return json(401, { ok: false, error: "Unauthorized" });
  }

  let body: RequestBody;
  try {
    body = event.body ? (JSON.parse(event.body) as RequestBody) : {};
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  if (body.tenantSlug !== undefined || body.instanceId !== undefined) {
    return json(400, {
      ok: false,
      error:
        "tenantSlug / instanceId are no longer accepted — send agentId, templateId, spaceId, userId, defaults: true, or catalog: true. Tenant is derived from the caller's token.",
    });
  }

  const { userId, tenantId } = await resolveCallerFromAuth(auth);
  if (!tenantId) {
    return json(401, { ok: false, error: "Could not resolve caller tenant" });
  }

  const action = body.action;
  if (!action) {
    return json(400, { ok: false, error: "action is required" });
  }

  const targetCount =
    (body.agentId ? 1 : 0) +
    (body.templateId ? 1 : 0) +
    (body.spaceId ? 1 : 0) +
    (body.threadId ? 1 : 0) +
    (body.userId ? 1 : 0) +
    (body.defaults ? 1 : 0) +
    (body.catalog ? 1 : 0);
  if (targetCount !== 1) {
    return json(400, {
      ok: false,
      error:
        "Exactly one of agentId, templateId, spaceId, threadId, userId, defaults, catalog is required",
    });
  }

  let target: Target | null = null;
  if (body.agentId) {
    target = await resolveAgentTarget(tenantId, body.agentId);
  } else if (body.templateId) {
    target = await resolveTemplateTarget(tenantId, body.templateId);
  } else if (body.spaceId) {
    target = await resolveSpaceTarget(tenantId, body.spaceId);
  } else if (body.threadId) {
    target = await resolveThreadTarget(tenantId, body.threadId, userId);
  } else if (body.userId) {
    target = await resolveUserContextTarget(tenantId, body.userId);
  } else if (body.defaults) {
    target = await resolveDefaultsTarget(tenantId);
  } else if (body.catalog) {
    target = await resolveCatalogTarget(tenantId);
  }
  if (!target) {
    // 404 rather than 403 so the response doesn't leak whether a row
    // exists in another tenant.
    return json(404, { ok: false, error: "Target not found in your tenant" });
  }

  // Write actions require admin/owner role (U31). Reads stay open to any
  // tenant member. The apikey path bypasses the role check — it's the
  // platform-credential trust boundary used by the Strands container and
  // CI/ops bootstrap; per-tenant role doesn't apply.
  //
  // Use the resolved users.id, NOT auth.principalId. tenantMembers.principal_id
  // holds users.id, and Google-federated users have users.id ≠ Cognito sub.
  if (
    (WRITE_ACTIONS.has(action) || target.kind === "catalog") &&
    auth.authType !== "apikey"
  ) {
    const isAdmin = await callerIsTenantAdmin(tenantId, userId);
    if (!isAdmin) {
      return json(403, {
        ok: false,
        error: "Caller is not a tenant admin or owner",
      });
    }
  }

  const deps: HandlerDeps = { auth, tenantId, target };

  if (
    target.kind === "catalog" &&
    !["get", "list", "put", "delete"].includes(action)
  ) {
    return json(400, {
      ok: false,
      error: `Action ${action} is not supported for the skill catalog target`,
    });
  }

  try {
    switch (action) {
      case "get": {
        if (!body.path)
          return json(400, { ok: false, error: "path is required for get" });
        return await handleGet(deps, body.path);
      }
      case "list":
        if (deps.target.kind === "catalog" && body.summary === true) {
          return await handleCatalogSummary(deps.tenantId);
        }
        return await handleList(deps, body.includeContent === true);
      case "put": {
        if (!body.path || body.content === undefined) {
          return json(400, {
            ok: false,
            error: "path and content are required for put",
          });
        }
        return await handlePut(
          deps,
          body.path,
          body.content,
          body.acceptTemplateUpdate === true,
        );
      }
      case "create-sub-agent": {
        if (!body.slug || body.contextContent === undefined) {
          return json(400, {
            ok: false,
            error: "slug and contextContent are required for create-sub-agent",
          });
        }
        return await handleCreateSubAgent(deps, body.slug, body.contextContent);
      }
      case "install-skill": {
        if (!body.slug || !body.wiring_choice) {
          return json(400, {
            ok: false,
            error: "slug and wiring_choice are required for install-skill",
          });
        }
        return await handleInstallSkill(deps, body.slug, body.wiring_choice);
      }
      case "uninstall-skill": {
        if (!body.slug) {
          return json(400, {
            ok: false,
            error: "slug is required for uninstall-skill",
          });
        }
        return await handleUninstallSkill(deps, body.slug);
      }
      case "reinstall-skill": {
        if (!body.slug) {
          return json(400, {
            ok: false,
            error: "slug is required for reinstall-skill",
          });
        }
        return await handleReinstallSkill(deps, body.slug);
      }
      case "delete": {
        if (!body.path)
          return json(400, { ok: false, error: "path is required for delete" });
        return await handleDelete(deps, body.path);
      }
      case "move": {
        if (typeof body.fromPath !== "string" || body.fromPath === "") {
          return json(400, {
            ok: false,
            error: "fromPath is required for move",
          });
        }
        if (typeof body.toFolder !== "string") {
          return json(400, {
            ok: false,
            error: 'toFolder is required for move (use "" for the root)',
          });
        }
        return await handleMove(deps, body.fromPath, body.toFolder);
      }
      case "rename": {
        if (typeof body.fromPath !== "string" || body.fromPath === "") {
          return json(400, {
            ok: false,
            error: "fromPath is required for rename",
          });
        }
        if (typeof body.toPath !== "string" || body.toPath === "") {
          return json(400, {
            ok: false,
            error: "toPath is required for rename",
          });
        }
        return await handleRename(deps, body.fromPath, body.toPath);
      }
      case "regenerate-map":
        if (body.path !== undefined && typeof body.path !== "string") {
          return json(400, {
            ok: false,
            error: "path must be a string for regenerate-map",
          });
        }
        return await handleRegenerateMap(deps, body.path);
      case "generate-folder-structure": {
        if (!body.path) {
          return json(400, {
            ok: false,
            error: "path is required for generate-folder-structure",
          });
        }
        return await handleGenerateFolderStructure(deps, body.path);
      }
      case "normalize-map":
        return await handleNormalizeMap(deps);
      case "rematerialize":
        return await handleRematerialize(deps);
      case "update-identity-field": {
        if (!body.field || body.value === undefined) {
          return json(400, {
            ok: false,
            error: "field and value are required for update-identity-field",
          });
        }
        return await handleUpdateIdentityField(
          deps,
          String(body.field),
          body.value,
        );
      }
      default:
        return json(400, { ok: false, error: `Unknown action: ${action}` });
    }
  } catch (err) {
    return json(500, {
      ok: false,
      error: `Workspace operation failed: ${errorMessage(err)}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeHeaders(
  raw: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> {
  if (!raw) return {};
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key.toLowerCase()] = value;
    out[key] = value;
  }
  return out;
}

function isNoSuchKey(err: unknown): boolean {
  if (err instanceof NoSuchKey) return true;
  const name = (err as { name?: string } | null)?.name;
  const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
    ?.$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

async function listPrefix(prefix: string): Promise<string[]> {
  const paths: string[] = [];
  let continuationToken: string | undefined;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue;
      if (!obj.Key.startsWith(prefix)) continue;
      const rel = obj.Key.slice(prefix.length);
      if (!rel) continue;
      if (rel === "manifest.json") continue;
      if (rel === "_defaults_version") continue;
      paths.push(rel);
    }
    continuationToken = resp.IsTruncated
      ? resp.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return paths;
}

/**
 * List every S3 object under the prefix without filtering operational
 * artifacts (manifest.json, _defaults_version). Used by folder-aware
 * mutations (`handleFolderMove`, folder-existence probes) that need to
 * see — and act on — every byte in the prefix, including nested
 * manifest files that ended up there by historical drift or by user
 * placement.
 *
 * `listPrefix` filters those artifacts because the file-tree UI uses
 * the listing as its data source and shouldn't show system files; the
 * filter is wrong for any operation that has to faithfully relocate or
 * remove every object.
 */
async function listAllObjectsUnfiltered(prefix: string): Promise<string[]> {
  const paths: string[] = [];
  let continuationToken: string | undefined;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue;
      if (!obj.Key.startsWith(prefix)) continue;
      const rel = obj.Key.slice(prefix.length);
      if (!rel) continue;
      paths.push(rel);
    }
    continuationToken = resp.IsTruncated
      ? resp.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return paths;
}

function errorMessage(err: unknown): string {
  if (!err || typeof err !== "object") return "unknown error";
  const name = (err as { name?: string }).name || "Error";
  const message = (err as { message?: string }).message || "";
  return message ? `${name}: ${message}` : name;
}

function defaultAgentsMd(): string {
  return `# AGENTS.md

## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
`;
}

// PINNED_FILES is re-exported for callers/tests that want to assert on
// the guardrail-class set without pulling in workspace-defaults directly.
export { PINNED_FILES };
