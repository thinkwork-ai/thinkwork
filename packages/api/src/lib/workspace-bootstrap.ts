/**
 * Workspace bootstrap — copy the template's files into an agent's S3
 * prefix at create time / re-bootstrap time.
 *
 * Per docs/plans/2026-04-27-003 (materialize-at-write-time): the agent's
 * S3 prefix is the single source of truth for what the runtime sees.
 * This module is the only thing that puts files there at create-time;
 * after that, mutating tools (`update_identity`, `update_user_profile`,
 * `write_memory`, the workspace-files Lambda) write directly to the
 * prefix.
 *
 * What this is NOT: an overlay composer. There is no read-time fallback,
 * no ancestor walk, no pin-version SHA store, no `agent-override /
 * template / defaults` classification. The runtime never calls into
 * here; it does a flat S3 sync of the agent prefix.
 *
 * Substitution scope: `{{AGENT_NAME}}` / `{{TENANT_NAME}}` only — both
 * stable for the agent's lifetime, baked in at bootstrap. `{{HUMAN_*}}`
 * is USER.md's concern (see user-md-writer.ts) and is filled in at
 * assignment-time, not here.
 *
 * Callers:
 *   - `createAgentFromTemplate` mutation — at agent create
 *   - `workspace-files` Lambda — operator-triggered "rematerialize"
 *   - one-time backfill script — populate every existing agent's prefix
 */

import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import {
  agents,
  agentTemplates,
  db as defaultDb,
  tenants,
} from "../graphql/utils.js";
import { regenerateManifest } from "./workspace-manifest.js";
import {
  type PlaceholderValues,
  type SanitizationViolation,
  substitute,
} from "./placeholder-substitution.js";

const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });

// Same shape as user-md-writer.ts's DbOrTx — accepts root db handle or txn.
export type DbOrTx = { select: typeof defaultDb.select };

export interface BootstrapResult {
  agentId: string;
  written: number;
  skipped: number;
  total: number;
}

export interface BootstrapOptions {
  /**
   * `'overwrite'` — write every template/defaults file, replacing whatever
   * is at the agent prefix today. Used by the operator-triggered
   * rematerialize action.
   *
   * `'preserve-existing'` — for any path that already exists at the
   * agent prefix, leave it alone. Used by the one-time backfill so
   * we don't clobber operator edits made before backfill ran. Default.
   */
  mode?: "overwrite" | "preserve-existing";
  /**
   * Optional injection point for sanitization-violation logging during
   * substitution. Keeps PII out of generic logs.
   */
  onViolation?: (violation: SanitizationViolation) => void;
  /**
   * Optional DB handle / transaction. Defaults to the module-level db.
   * Pass a `tx` so this runs inside the same transaction as agent creation.
   */
  tx?: DbOrTx;
}

export class BootstrapError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "BootstrapError";
  }
}

function bucket(): string {
  return process.env.WORKSPACE_BUCKET || "";
}

function agentKey(tenantSlug: string, agentSlug: string, path: string): string {
  return `tenants/${tenantSlug}/agents/${agentSlug}/workspace/${path}`;
}

function templatePrefix(tenantSlug: string, templateSlug: string): string {
  return `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/`;
}

function defaultsPrefix(tenantSlug: string): string {
  return `tenants/${tenantSlug}/agents/_catalog/defaults/workspace/`;
}

function isNotFound(err: unknown): boolean {
  if (err instanceof NoSuchKey) return true;
  const name = (err as { name?: string } | null)?.name;
  if (name === "NoSuchKey" || name === "NotFound") return true;
  const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
    ?.$metadata?.httpStatusCode;
  return status === 404;
}

interface ResolvedAgent {
  agentId: string;
  agentName: string;
  agentSlug: string;
  tenantSlug: string;
  tenantName: string;
  templateSlug: string;
}

async function resolveAgent(
  tx: DbOrTx,
  agentId: string,
): Promise<ResolvedAgent | null> {
  const [agent] = await tx
    .select({
      id: agents.id,
      slug: agents.slug,
      name: agents.name,
      tenant_id: agents.tenant_id,
      template_id: agents.template_id,
    })
    .from(agents)
    .where(eq(agents.id, agentId));
  if (!agent || !agent.slug || !agent.template_id) return null;

  const [tenant] = await tx
    .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, agent.tenant_id));
  if (!tenant?.slug) return null;

  const [template] = await tx
    .select({ slug: agentTemplates.slug })
    .from(agentTemplates)
    .where(eq(agentTemplates.id, agent.template_id));
  if (!template?.slug) return null;

  return {
    agentId: agent.id,
    agentName: agent.name,
    agentSlug: agent.slug,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    templateSlug: template.slug,
  };
}

interface SourceFile {
  path: string;
  content: string;
}

async function listSourceFiles(
  bkt: string,
  prefix: string,
): Promise<Map<string, string>> {
  // Returns relPath → S3 key, so callers can GET only what they need.
  const out = new Map<string, string>();
  let continuationToken: string | undefined;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: bkt,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue;
      const rel = obj.Key.slice(prefix.length);
      // Skip operational artifacts that shouldn't propagate to agents.
      if (!rel || rel === "manifest.json" || rel === "_defaults_version") {
        continue;
      }
      out.set(rel, obj.Key);
    }
    continuationToken = resp.IsTruncated
      ? resp.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return out;
}

async function readUtf8(bkt: string, key: string): Promise<string> {
  const resp = await s3.send(new GetObjectCommand({ Bucket: bkt, Key: key }));
  return (await resp.Body?.transformToString("utf-8")) ?? "";
}

function contentTypeFor(path: string): string {
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".json")) return "application/json";
  return "text/plain";
}

async function agentPathExists(bkt: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bkt, Key: key }));
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

/**
 * Copy the template's workspace files (with defaults filling gaps) to
 * the agent's S3 prefix. Substitutes `{{AGENT_NAME}}` / `{{TENANT_NAME}}`
 * at write time. Idempotent in `preserve-existing` mode.
 */
export async function bootstrapAgentWorkspace(
  agentId: string,
  opts: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const bkt = bucket();
  if (!bkt) {
    throw new BootstrapError(
      "BUCKET_UNCONFIGURED",
      "WORKSPACE_BUCKET not configured",
    );
  }

  const tx = opts.tx ?? defaultDb;
  const mode = opts.mode ?? "preserve-existing";

  const resolved = await resolveAgent(tx, agentId);
  if (!resolved) {
    throw new BootstrapError(
      "AGENT_UNRESOLVABLE",
      `Could not resolve agent / tenant / template for ${agentId}`,
    );
  }

  // Source paths: template wins, defaults fills gaps.
  const tPrefix = templatePrefix(resolved.tenantSlug, resolved.templateSlug);
  const dPrefix = defaultsPrefix(resolved.tenantSlug);
  const [templateKeys, defaultsKeys] = await Promise.all([
    listSourceFiles(bkt, tPrefix),
    listSourceFiles(bkt, dPrefix),
  ]);

  const sourceByPath = new Map<string, string>();
  for (const [rel, key] of defaultsKeys) sourceByPath.set(rel, key);
  for (const [rel, key] of templateKeys) sourceByPath.set(rel, key); // template overrides defaults

  const placeholderValues: PlaceholderValues = {
    AGENT_NAME: resolved.agentName,
    TENANT_NAME: resolved.tenantName,
  };

  let written = 0;
  let skipped = 0;

  for (const [relPath, sourceKey] of sourceByPath) {
    const targetKey = agentKey(
      resolved.tenantSlug,
      resolved.agentSlug,
      relPath,
    );

    if (mode === "preserve-existing") {
      if (await agentPathExists(bkt, targetKey)) {
        skipped++;
        continue;
      }
    }

    const sourceContent = await readUtf8(bkt, sourceKey);
    const rendered = substitute(placeholderValues, sourceContent, {
      onViolation: opts.onViolation,
    });
    await s3.send(
      new PutObjectCommand({
        Bucket: bkt,
        Key: targetKey,
        Body: rendered,
        ContentType: contentTypeFor(relPath),
      }),
    );
    written++;
  }

  if (written > 0) {
    await regenerateManifest(bkt, resolved.tenantSlug, resolved.agentSlug);
  }

  return {
    agentId: resolved.agentId,
    written,
    skipped,
    total: sourceByPath.size,
  };
}

// ---------------------------------------------------------------------------
// Test-only seam — content fingerprint of the substituted output.
// Used by tests that want to assert exact bytes were written without
// re-rendering the substitution by hand. Not part of the production API.
// ---------------------------------------------------------------------------
export function _renderForTest(
  placeholderValues: PlaceholderValues,
  source: string,
): string {
  return substitute(placeholderValues, source);
}

export function _sha256ForTest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
