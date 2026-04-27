/**
 * Server-side overlay composer for agent workspace files.
 *
 * Single source of truth used by:
 *   - /internal/workspace-files handler (Unit 5)
 *   - agent-snapshot.ts (Unit 5, for agentVersions.workspace_snapshot)
 *
 * Key invariants:
 *   - Tenant identity is supplied by the caller (resolved from the auth
 *     context — see resolveCallerTenantId). The composer never reads
 *     tenant from a request body. If the caller's tenant does not match
 *     agents.tenant_id for the requested agent, the lookup returns no row
 *     and composer throws — this is the cross-tenant isolation enforcement
 *     point.
 *   - Placeholder values are always server-computed from DB joins (agent +
 *     tenant + users + user_profiles). Callers cannot override them.
 *   - Live files are resolved first-hit-wins across {agent}/ ->
 *     _catalog/{template}/ -> _catalog/defaults/. Read-time substitution
 *     runs on the chosen base content.
 *   - Pinned files (GUARDRAILS / PLATFORM / CAPABILITIES) resolve by
 *     content hash stored on agents.agent_pinned_versions. An agent-scoped
 *     override still wins; otherwise content is looked up via the template's
 *     content-addressable store at _catalog/{template}/workspace-versions/
 *     {path}@{sha256}. See createAgentFromTemplate (Unit 8) for how those
 *     version objects get written.
 *   - Managed files (USER.md) are written in full at assignment time
 *     (Unit 6). The composer returns the agent-scoped object verbatim; if
 *     none exists, it falls through to template / defaults WITHOUT
 *     read-time substitution — pre-assignment USER.md renders {{HUMAN_*}}
 *     as `—` by virtue of its placeholders being passed to `substitute`
 *     the same way live files are.
 */

import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  S3Client,
  type _Object,
} from "@aws-sdk/client-s3";
import {
  CANONICAL_FILE_NAMES,
  type CanonicalFileName,
  classifyFile,
  MANAGED_FILES,
  PINNED_FILES,
} from "@thinkwork/workspace-defaults";
import {
  agents,
  agentTemplates,
  db,
  eq,
  and,
  tenants,
} from "../graphql/utils.js";
import {
  type PlaceholderValues,
  substitute,
  type SanitizationViolation,
} from "./placeholder-substitution.js";
import { isReservedFolderSegment } from "./reserved-folder-names.js";
import {
  normalizeWorkspacePath,
  parseWorkspacePinPath,
} from "./pinned-versions.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComposeSource =
  | "agent-override"
  | "agent-override-pinned"
  | "template"
  | "template-pinned"
  | "defaults";

export interface ComposeResultBase {
  path: string;
  source: ComposeSource;
  sha256: string;
}

export interface ComposeResult extends ComposeResultBase {
  content: string;
}

/**
 * Caller supplies tenantId resolved from ctx.auth — never from request body.
 * The composer verifies agents.tenant_id === tenantId before returning any
 * content; a mismatch surfaces as AgentNotFound.
 */
export interface ComposeContext {
  tenantId: string;
  onViolation?: (v: SanitizationViolation) => void;
}

export interface ComposeListOptions {
  includeContent?: boolean;
}

export class AgentNotFoundError extends Error {
  readonly code = "AGENT_NOT_FOUND";
  constructor(agentId: string) {
    super(`Agent ${agentId} not found in the caller's tenant`);
    this.name = "AgentNotFoundError";
  }
}

export class FileNotFoundError extends Error {
  readonly code = "FILE_NOT_FOUND";
  constructor(path: string) {
    super(`Workspace file not found: ${path}`);
    this.name = "FileNotFoundError";
  }
}

export class PinnedVersionNotFoundError extends Error {
  readonly code = "PINNED_VERSION_NOT_FOUND";
  constructor(path: string, hash: string) {
    super(`Pinned content ${hash} for ${path} not found in the version store`);
    this.name = "PinnedVersionNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Config + S3 client
// ---------------------------------------------------------------------------

const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";

// Kept module-level so a single warm Lambda reuses the connection pool.
// Tests replace sends via aws-sdk-client-mock which patches the
// transport — no need for dependency injection.
const s3 = new S3Client({ region: REGION });

function assertBucket(): string {
  // Read lazily: tests set WORKSPACE_BUCKET after module load.
  const bucket = process.env.WORKSPACE_BUCKET || "";
  if (!bucket) {
    throw new Error("WORKSPACE_BUCKET not configured");
  }
  return bucket;
}

// ---------------------------------------------------------------------------
// Key builders
// ---------------------------------------------------------------------------

function agentPrefix(tenantSlug: string, agentSlug: string): string {
  return `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;
}

function templatePrefix(tenantSlug: string, templateSlug: string): string {
  return `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/`;
}

function defaultsPrefix(tenantSlug: string): string {
  return `tenants/${tenantSlug}/agents/_catalog/defaults/workspace/`;
}

function templateVersionKey(
  tenantSlug: string,
  templateSlug: string,
  path: string,
  sha256: string,
): string {
  return `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace-versions/${path}@${sha256}`;
}

// ---------------------------------------------------------------------------
// DB: load agent + template + tenant + (optional) human
// ---------------------------------------------------------------------------

interface AgentContext {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  agentId: string;
  agentSlug: string;
  agentName: string;
  templateId: string;
  templateSlug: string;
  humanPairId: string | null;
  pinnedVersions: Record<string, string>;
  placeholderValues: PlaceholderValues;
}

type AgentRow = {
  id: string;
  slug: string | null;
  name: string;
  tenant_id: string;
  template_id: string;
  human_pair_id: string | null;
  agent_pinned_versions: unknown;
};

type TenantRow = { id: string; slug: string; name: string };
type TemplateRow = { id: string; slug: string };

async function loadAgentContext(
  tenantId: string,
  agentId: string,
): Promise<AgentContext> {
  // 1) Agent, bound to the caller's tenant — this is the cross-tenant
  //    isolation enforcement point.
  const agentRows = (await db
    .select({
      id: agents.id,
      slug: agents.slug,
      name: agents.name,
      tenant_id: agents.tenant_id,
      template_id: agents.template_id,
      human_pair_id: agents.human_pair_id,
      agent_pinned_versions: agents.agent_pinned_versions,
    })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)))
    .limit(1)) as AgentRow[];

  const agent = agentRows[0];
  if (!agent || !agent.slug) {
    throw new AgentNotFoundError(agentId);
  }

  // 2) Tenant (for slug + placeholder value).
  const tenantRows = (await db
    .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, agent.tenant_id))
    .limit(1)) as TenantRow[];
  const tenant = tenantRows[0];
  if (!tenant || !tenant.slug) {
    throw new Error(`Tenant ${agent.tenant_id} has no slug`);
  }

  // 3) Template.
  const templateRows = (await db
    .select({ id: agentTemplates.id, slug: agentTemplates.slug })
    .from(agentTemplates)
    .where(eq(agentTemplates.id, agent.template_id))
    .limit(1)) as TemplateRow[];
  const template = templateRows[0];
  if (!template || !template.slug) {
    throw new Error(`Template ${agent.template_id} has no slug`);
  }

  // 4) Pinned versions for the safety files (GUARDRAILS / PLATFORM /
  //    CAPABILITIES). The HUMAN_* placeholder values are NOT fetched here —
  //    they live exclusively on the USER.md write-at-assignment path
  //    (see user-md-writer.ts). The materializer never substitutes
  //    {{HUMAN_*}}, so loading user / userProfiles rows would be dead work.
  const pinnedVersions = normalizePinnedVersions(agent.agent_pinned_versions);

  const placeholderValues: PlaceholderValues = {
    AGENT_NAME: agent.name,
    TENANT_NAME: tenant.name,
  };

  return {
    tenantId: agent.tenant_id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    agentId: agent.id,
    agentSlug: agent.slug,
    agentName: agent.name,
    templateId: template.id,
    templateSlug: template.slug,
    humanPairId: agent.human_pair_id,
    pinnedVersions,
    placeholderValues,
  };
}

function normalizePinnedVersions(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

interface S3Object {
  content: string;
  etag: string | null;
}

async function s3Get(bucket: string, key: string): Promise<S3Object | null> {
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const content = (await resp.Body?.transformToString("utf-8")) ?? "";
    return { content, etag: resp.ETag ?? null };
  } catch (err) {
    if (isNoSuchKey(err)) return null;
    throw err;
  }
}

async function s3Head(
  bucket: string,
  key: string,
): Promise<{ etag: string | null } | null> {
  try {
    const resp = await s3.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return { etag: resp.ETag ?? null };
  } catch (err) {
    if (isNoSuchKey(err) || isNotFoundStatus(err)) return null;
    throw err;
  }
}

async function s3List(bucket: string, prefix: string): Promise<_Object[]> {
  const out: _Object[] = [];
  let continuationToken: string | undefined;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of resp.Contents ?? []) {
      if (obj.Key) out.push(obj);
    }
    continuationToken = resp.IsTruncated
      ? resp.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return out;
}

function isNoSuchKey(err: unknown): boolean {
  if (err instanceof NoSuchKey) return true;
  const name = (err as { name?: string } | null)?.name;
  return name === "NoSuchKey";
}

function isNotFoundStatus(err: unknown): boolean {
  const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
    ?.$metadata?.httpStatusCode;
  return status === 404;
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function shaTag(hex: string): string {
  return `sha256:${hex}`;
}

// ---------------------------------------------------------------------------
// Path helpers (Plan §008 U5 — recursive overlay)
// ---------------------------------------------------------------------------

/**
 * Return the ancestor-walk paths for a given workspace path, deepest first.
 *
 *   "GUARDRAILS.md"                          → ["GUARDRAILS.md"]
 *   "expenses/GUARDRAILS.md"                 → ["expenses/GUARDRAILS.md", "GUARDRAILS.md"]
 *   "expenses/escalation/GUARDRAILS.md"      → 3 entries, deepest → root
 *   "memory/lessons.md"                      → ["memory/lessons.md"]   (reserved scope)
 *   "expenses/memory/lessons.md"             → ["expenses/memory/lessons.md"] (reserved scope)
 *   "expenses/skills/approve-receipt/SKILL.md" → ["expenses/skills/approve-receipt/SKILL.md"]
 *
 * Files that contain a reserved folder segment do not produce ancestors —
 * memory/skills are bounded so they never collapse to a different file at
 * an outer scope. The reserved set lives in `./reserved-folder-names.ts`.
 */
export function buildWorkspaceAncestorPaths(path: string): string[] {
  const cleanPath = normalizeWorkspacePath(path);
  const segments = cleanPath.split("/");
  if (segments.some(isReservedFolderSegment)) {
    return [cleanPath];
  }
  if (segments.length === 1) return [cleanPath];
  const basename = segments[segments.length - 1];
  let folders = segments.slice(0, -1);
  const out = [cleanPath];
  while (folders.length > 0) {
    folders = folders.slice(0, -1);
    const ancestor =
      folders.length > 0 ? `${folders.join("/")}/${basename}` : basename;
    out.push(ancestor);
  }
  return out;
}

export function pinLookupPaths(path: string): string[] {
  if (!parseWorkspacePinPath(path)) return [];
  return buildWorkspaceAncestorPaths(path).filter((candidate) =>
    Boolean(parseWorkspacePinPath(candidate)),
  );
}

/**
 * classifyFile from @thinkwork/workspace-defaults uses exact-path matching
 * (root-level filenames only). For sub-agent paths we classify by basename
 * so e.g. `expenses/GUARDRAILS.md` is treated as the pinned guardrail class.
 *
 * Path-qualified pinned-version key shape (`expenses/GUARDRAILS.md` →
 * pinnedVersions key) is U24's job; U5 only extends classify-by-basename
 * for source labeling and override-write gates.
 */
function classifyFileByBasename(path: string) {
  if (!path.includes("/")) return classifyFile(path);
  const basename = path.split("/").pop() ?? path;
  return classifyFile(basename);
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

/**
 * Compose one workspace file for an agent. The returned `content` is the
 * post-substitution bytes for live files, or raw base bytes for managed /
 * pinned files (which either already have baked-in values or belong to a
 * guardrail class that is not substituted).
 *
 * Sub-agent paths (e.g. `expenses/IDENTITY.md`) walk ancestor folders within
 * each layer (deepest first) before stepping to the next layer — see
 * Plan §008 U5 illustration. Reserved folder segments terminate the walk.
 */
/**
 * @deprecated U15 of docs/plans/2026-04-27-003 deletes this. Read-time
 * composition is being replaced by write-time materialization
 * (workspace-materializer.ts). New call sites should not use this; the
 * remaining read-time consumers (`agentPinStatus`, `agent-snapshot`,
 * `derive-agent-skills`, `workspace-files` GET/LIST handlers) migrate
 * during U14 of that plan.
 */
export async function composeFile(
  ctx: ComposeContext,
  agentId: string,
  path: string,
): Promise<ComposeResult> {
  const cleanPath = normalizeWorkspacePath(path);
  const bucket = assertBucket();
  const agentCtx = await loadAgentContext(ctx.tenantId, agentId);
  return composeFileForAgent(ctx, agentCtx, bucket, cleanPath);
}

async function composeFileForAgent(
  ctx: ComposeContext,
  agentCtx: AgentContext,
  bucket: string,
  path: string,
): Promise<ComposeResult> {
  const cleanPath = normalizeWorkspacePath(path);
  const fileClass = classifyFileByBasename(cleanPath);
  const ancestorPaths = buildWorkspaceAncestorPaths(cleanPath);

  const agentP = agentPrefix(agentCtx.tenantSlug, agentCtx.agentSlug);
  const templateP = templatePrefix(agentCtx.tenantSlug, agentCtx.templateSlug);
  const defaultsP = defaultsPrefix(agentCtx.tenantSlug);

  // Step 1: Agent overrides — walk ancestor paths (deepest → root).
  // An override at any ancestor depth wins over template / defaults at
  // the originally-requested depth.
  for (const ancestor of ancestorPaths) {
    const agentObj = await s3Get(bucket, agentP + ancestor);
    if (!agentObj) continue;

    if (fileClass === "pinned") {
      return {
        path: cleanPath,
        source: "agent-override-pinned",
        content: agentObj.content,
        sha256: sha256Hex(agentObj.content),
      };
    }
    if (fileClass === "managed") {
      // USER.md: served verbatim (already substituted at write time
      // in Unit 6). At sub-agent depth, operator-authored override
      // is allowed.
      return {
        path: cleanPath,
        source: "agent-override",
        content: agentObj.content,
        sha256: sha256Hex(agentObj.content),
      };
    }
    // live
    const rendered = substitute(agentCtx.placeholderValues, agentObj.content, {
      onViolation: ctx.onViolation,
    });
    return {
      path: cleanPath,
      source: "agent-override",
      content: rendered,
      sha256: sha256Hex(agentObj.content),
    };
  }

  // Step 2: Pinned-version-store resolution at the requested path.
  // Pin keys are path-qualified per Plan §008 U24. Until U24 ships, only
  // root-level pin keys exist; sub-agent paths fall through to the live
  // ancestor walk below. When a pin is set at the requested path, fail
  // closed if it can't be resolved (safety-critical guardrails must not
  // silently drift).
  if (fileClass === "pinned") {
    for (const pinPath of pinLookupPaths(cleanPath)) {
      const pinned = agentCtx.pinnedVersions[pinPath];
      if (!pinned) continue;
      if (pinPath !== cleanPath) {
        console.warn(
          `[workspace-overlay] using inherited pinned-version key ${pinPath} for ${cleanPath}`,
        );
      }
      const pinnedHash = extractHash(pinned);
      const versionKey = templateVersionKey(
        agentCtx.tenantSlug,
        agentCtx.templateSlug,
        pinPath,
        pinnedHash,
      );
      const versionObj = await s3Get(bucket, versionKey);
      if (versionObj) {
        return {
          path: cleanPath,
          source: "template-pinned",
          content: versionObj.content,
          sha256: pinnedHash,
        };
      }
      // Fallback: current template/defaults at the requested path may
      // still hash to the pin (no edits since the pin was recorded).
      const templateObj = await s3Get(bucket, templateP + pinPath);
      if (templateObj && sha256Hex(templateObj.content) === pinnedHash) {
        return {
          path: cleanPath,
          source: "template-pinned",
          content: templateObj.content,
          sha256: pinnedHash,
        };
      }
      const defaultsObj = await s3Get(bucket, defaultsP + pinPath);
      if (defaultsObj && sha256Hex(defaultsObj.content) === pinnedHash) {
        return {
          path: cleanPath,
          source: "template-pinned",
          content: defaultsObj.content,
          sha256: pinnedHash,
        };
      }
      throw new PinnedVersionNotFoundError(pinPath, pinnedHash);
    }
    // No pin at this path — fall through to live ancestor walk
    // (transition-period semantics; matches Unit 4 fallback).
  }

  // Step 3: Template ancestor walk.
  for (const ancestor of ancestorPaths) {
    const obj = await s3Get(bucket, templateP + ancestor);
    if (!obj) continue;
    const rendered = substitute(agentCtx.placeholderValues, obj.content, {
      onViolation: ctx.onViolation,
    });
    return {
      path: cleanPath,
      source: "template",
      content: rendered,
      sha256: sha256Hex(obj.content),
    };
  }

  // Step 4: Defaults ancestor walk.
  for (const ancestor of ancestorPaths) {
    const obj = await s3Get(bucket, defaultsP + ancestor);
    if (!obj) continue;
    const rendered = substitute(agentCtx.placeholderValues, obj.content, {
      onViolation: ctx.onViolation,
    });
    return {
      path: cleanPath,
      source: "defaults",
      content: rendered,
      sha256: sha256Hex(obj.content),
    };
  }

  throw new FileNotFoundError(cleanPath);
}

/**
 * @deprecated U15 of docs/plans/2026-04-27-003 deletes this. The
 * workspace-materializer's write-time pipeline produces the same
 * concrete bytes at the agent prefix; new readers should sync from
 * there. Remaining call sites (`agentPinStatus`, `agent-snapshot`,
 * `derive-agent-skills`, `workspace-files` LIST handler) migrate
 * during U14.
 */
export async function composeList(
  ctx: ComposeContext,
  agentId: string,
  opts: ComposeListOptions = {},
): Promise<ComposeResult[] | ComposeResultBase[]> {
  const bucket = assertBucket();
  const agentCtx = await loadAgentContext(ctx.tenantId, agentId);

  // Union of paths across agent-override / template / defaults plus the
  // canonical 11 (so a brand-new agent still returns the full expected
  // set even if only defaults exists in S3).
  const paths = await collectUnionPaths(bucket, agentCtx);

  const results: Array<ComposeResult | ComposeResultBase> = [];
  for (const path of paths) {
    const fileClass = classifyFileByBasename(path);
    try {
      if (opts.includeContent) {
        const composed = await composeFileForAgent(ctx, agentCtx, bucket, path);
        results.push(composed);
      } else {
        // Peek at source labeling without reading / substituting
        // the whole object. For pinned / managed we still return
        // the full path + a best-effort source label. For the
        // metadata-only path we HEAD the layers in order.
        const label = await peekSource(agentCtx, bucket, path, fileClass);
        results.push(label);
      }
    } catch (err) {
      if (err instanceof FileNotFoundError) {
        // Shouldn't happen — `paths` was sourced from S3 list —
        // but if it does we skip rather than erroring the list.
        continue;
      }
      throw err;
    }
  }
  return results;
}

async function collectUnionPaths(
  bucket: string,
  agentCtx: AgentContext,
): Promise<string[]> {
  const prefixes: Array<{ prefix: string }> = [
    { prefix: agentPrefix(agentCtx.tenantSlug, agentCtx.agentSlug) },
    { prefix: templatePrefix(agentCtx.tenantSlug, agentCtx.templateSlug) },
    { prefix: defaultsPrefix(agentCtx.tenantSlug) },
  ];

  const seen = new Set<string>();
  for (const { prefix } of prefixes) {
    const listed = await s3List(bucket, prefix);
    for (const obj of listed) {
      if (!obj.Key) continue;
      const rel = obj.Key.slice(prefix.length);
      if (!rel) continue;
      if (rel === "manifest.json") continue;
      if (rel === "_defaults_version") continue;
      seen.add(rel);
    }
  }
  // Always surface the canonical 11 even if a particular layer lost
  // one (defensive: the composer's contract is "every known workspace
  // path resolves").
  for (const canonical of CANONICAL_FILE_NAMES) {
    seen.add(canonical);
  }
  return Array.from(seen).sort();
}

async function peekSource(
  agentCtx: AgentContext,
  bucket: string,
  path: string,
  fileClass: ReturnType<typeof classifyFile>,
): Promise<ComposeResultBase> {
  const agentKey = agentPrefix(agentCtx.tenantSlug, agentCtx.agentSlug) + path;
  const templateKey =
    templatePrefix(agentCtx.tenantSlug, agentCtx.templateSlug) + path;
  const defaultsKey = defaultsPrefix(agentCtx.tenantSlug) + path;

  if (fileClass === "pinned") {
    const agentHead = await s3Head(bucket, agentKey);
    if (agentHead) {
      return {
        path,
        source: "agent-override-pinned",
        sha256: etagToSha(agentHead.etag),
      };
    }
    for (const pinPath of pinLookupPaths(path)) {
      const pinned = agentCtx.pinnedVersions[pinPath];
      if (pinned) {
        return { path, source: "template-pinned", sha256: extractHash(pinned) };
      }
    }
  }

  // live + managed (pre-assignment managed) + pinned-without-pin
  // share a HEAD-chain for source labeling.
  for (const [key, source] of [
    [
      agentKey,
      fileClass === "pinned" ? "agent-override-pinned" : "agent-override",
    ] as const,
    [templateKey, "template"] as const,
    [defaultsKey, "defaults"] as const,
  ]) {
    const head = await s3Head(bucket, key);
    if (head) {
      return {
        path,
        source: source as ComposeSource,
        sha256: etagToSha(head.etag),
      };
    }
  }
  return { path, source: "defaults", sha256: "" };
}

function etagToSha(etag: string | null): string {
  // ETag isn't a SHA-256 but keeps the field non-empty for admin UI
  // integrity hints. The authoritative sha256 comes back on
  // includeContent: true.
  if (!etag) return "";
  return etag.replace(/^"|"$/g, "");
}

function extractHash(pinned: string): string {
  if (pinned.startsWith("sha256:")) return pinned.slice("sha256:".length);
  return pinned;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
//
// In-memory composer cache. Keyed by {tenantId, agentId, path}; invalidated
// by the handler (Unit 5) on any S3 write that lands in one of the three
// composed prefixes. At mass-wakeup scale (400+ agents x 11 files in the
// same minute) the cache saves the per-file GET + substitute cost —
// critical for keeping Lambda concurrency bounded per the plan's
// Risks & Dependencies table.
//
// This is a best-effort warm-Lambda cache; two concurrent Lambda replicas
// each have their own map. TTL provides a floor for cross-replica
// consistency; invalidation provides a ceiling within a replica.

interface CacheEntry {
  cachedAt: number;
  result: ComposeResult;
  // etagChain is captured so a handler running on stale-after-write
  // state can force a recompute by bumping any layer's ETag.
  etagChain: string;
}

const TTL_MS = 60_000;
const MAX_ENTRIES = 500;

const composerCache = new Map<string, CacheEntry>();

function cacheKey(tenantId: string, agentId: string, path: string): string {
  return `${tenantId}|${agentId}|${path}`;
}

/**
 * Invalidate cache entries for an agent (dropping everything under
 * {tenantId, agentId}) or a whole tenant. Called by the workspace-files
 * handler after any S3 write.
 */
export function invalidateComposerCache(scope: {
  tenantId: string;
  agentId?: string;
  templateScope?: boolean;
}): void {
  const prefix = scope.agentId
    ? `${scope.tenantId}|${scope.agentId}|`
    : `${scope.tenantId}|`;
  for (const key of composerCache.keys()) {
    if (key.startsWith(prefix)) composerCache.delete(key);
    else if (scope.templateScope && key.startsWith(`${scope.tenantId}|`))
      composerCache.delete(key);
  }
}

export function clearComposerCacheForTests(): void {
  composerCache.clear();
}

function pruneCache(): void {
  if (composerCache.size <= MAX_ENTRIES) return;
  // Cheap LRU-ish eviction: drop the oldest half.
  const entries = Array.from(composerCache.entries()).sort(
    (a, b) => a[1].cachedAt - b[1].cachedAt,
  );
  const drop = Math.ceil(entries.length / 2);
  for (let i = 0; i < drop; i++) composerCache.delete(entries[i][0]);
}

/**
 * @deprecated U15 of docs/plans/2026-04-27-003 deletes this. The
 * read-time cache + invalidation choreography goes away once
 * materialization moves to write time — runtimes ETag-sync against the
 * agent prefix directly.
 */
export async function composeFileCached(
  ctx: ComposeContext,
  agentId: string,
  path: string,
): Promise<ComposeResult> {
  const key = cacheKey(ctx.tenantId, agentId, path);
  const now = Date.now();
  const existing = composerCache.get(key);
  if (existing && now - existing.cachedAt < TTL_MS) {
    return existing.result;
  }
  const result = await composeFile(ctx, agentId, path);
  composerCache.set(key, {
    cachedAt: now,
    result,
    etagChain: "", // reserved for future ETag-based validation
  });
  pruneCache();
  return result;
}

// ---------------------------------------------------------------------------
// Re-exports for consumers in Units 5 / 6 / 7 / 8
// ---------------------------------------------------------------------------

export { classifyFile, PINNED_FILES, MANAGED_FILES, CANONICAL_FILE_NAMES };
export type { CanonicalFileName };
