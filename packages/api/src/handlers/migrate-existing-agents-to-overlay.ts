/**
 * Migrate existing agents to the overlay model (Unit 10).
 *
 * One-shot handler that:
 *   1. Paginates every agent in batches of 50 (optional --tenant filter).
 *   2. For each agent, lists its {agent}/workspace/ S3 prefix.
 *   3. Classifies each file as `fork` / `override` / `review-required` /
 *      `no-template` via the placeholder-aware comparator (Unit 10 lib).
 *   4. In `--commit` mode: deletes `fork` files from S3. Preserves
 *      overrides and review-required files.
 *   5. Populates agent_pinned_versions via initializePinnedVersions
 *      (Unit 8) so the accept-update flow works for migrated agents.
 *   6. Writes a per-agent report to the workspace bucket at
 *      migration-reports/overlay-migration/{runId}-{mode}.json.
 *   7. Writes a resume-checkpoint after each batch so mid-run failures
 *      pick up where they left off.
 *
 * Safety:
 *   - `--dry-run` is the default. `--commit` is explicit.
 *   - `--commit` preflight: GetBucketVersioning must be Enabled — the
 *     dry-run report plus S3 object versions is the recovery artifact.
 *   - Common-noun agent names surface as review-required; commit mode
 *     does NOT auto-delete those.
 *
 * Run locally:
 *   npx tsx packages/api/src/handlers/migrate-existing-agents-to-overlay.ts \
 *     --dry-run [--tenant <slug>] [--run-id <id>]
 *   npx tsx packages/api/src/handlers/migrate-existing-agents-to-overlay.ts \
 *     --commit [--tenant <slug>] [--run-id <id>]
 *
 * Lambda: invoke with payload { mode: "dry-run" | "commit", tenantSlug?, runId? }
 */

import {
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  agentTemplates,
  tenants,
  userProfiles,
  users,
} from "@thinkwork/database-pg/schema";
import { PINNED_FILES } from "@thinkwork/workspace-defaults";
import {
  classifyAgentFile,
  type ClassificationResult,
} from "../lib/placeholder-aware-comparator.js";
import { initializePinnedVersions } from "../lib/pinned-versions.js";
import type {
  HumanPlaceholderValues,
  PlaceholderValues,
} from "../lib/placeholder-substitution.js";

const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });
const db = getDb();

function bucket(): string {
  return process.env.WORKSPACE_BUCKET || "";
}

// ---------------------------------------------------------------------------
// S3 key helpers
// ---------------------------------------------------------------------------

function agentPrefix(tenantSlug: string, agentSlug: string): string {
  return `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;
}

function templateKey(
  tenantSlug: string,
  templateSlug: string,
  path: string,
): string {
  return `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/${path}`;
}

function defaultsKey(tenantSlug: string, path: string): string {
  return `tenants/${tenantSlug}/agents/_catalog/defaults/workspace/${path}`;
}

function reportKey(runId: string, mode: Mode): string {
  return `migration-reports/overlay-migration/${runId}-${mode}.json`;
}

function checkpointKey(runId: string): string {
  return `migration-checkpoints/overlay-migration/${runId}.json`;
}

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

function isNotFound(err: unknown): boolean {
  if (err instanceof NoSuchKey) return true;
  const name = (err as { name?: string } | null)?.name;
  if (name === "NoSuchKey" || name === "NotFound") return true;
  const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
    ?.$metadata?.httpStatusCode;
  return status === 404;
}

async function readS3Utf8(bkt: string, key: string): Promise<string | null> {
  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: bkt, Key: key }));
    return (await resp.Body?.transformToString("utf-8")) ?? "";
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function readTemplateLayer(
  bkt: string,
  tenantSlug: string,
  templateSlug: string,
  path: string,
): Promise<string | null> {
  const t = await readS3Utf8(bkt, templateKey(tenantSlug, templateSlug, path));
  if (t !== null) return t;
  return readS3Utf8(bkt, defaultsKey(tenantSlug, path));
}

async function listAgentFiles(bkt: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
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
      if (!rel) continue;
      if (rel === "manifest.json") continue;
      if (rel === "_defaults_version") continue;
      out.push(rel);
    }
    continuationToken = resp.IsTruncated
      ? resp.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return out;
}

async function preflightVersioning(bkt: string): Promise<void> {
  const resp = await s3.send(new GetBucketVersioningCommand({ Bucket: bkt }));
  if (resp.Status !== "Enabled") {
    throw new Error(
      `--commit refuses to run: bucket versioning is '${resp.Status ?? "Suspended/Disabled"}'. ` +
        `Enable versioning before proceeding so the dry-run report + S3 object versions act as a recovery artifact.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Placeholder value resolution
// ---------------------------------------------------------------------------

async function resolveAgentValues(
  agent: {
    id: string;
    name: string;
    tenant_id: string;
    human_pair_id: string | null;
  },
  tenantName: string,
): Promise<{ values: PlaceholderValues; humanValues: HumanPlaceholderValues }> {
  const values: PlaceholderValues = {
    AGENT_NAME: agent.name,
    TENANT_NAME: tenantName,
  };
  const humanValues: HumanPlaceholderValues = {
    HUMAN_NAME: null,
    HUMAN_EMAIL: null,
    HUMAN_TITLE: null,
    HUMAN_TIMEZONE: null,
    HUMAN_PRONOUNS: null,
  };
  if (agent.human_pair_id) {
    const [user] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, agent.human_pair_id));
    if (user) {
      humanValues.HUMAN_NAME = user.name;
      humanValues.HUMAN_EMAIL = user.email;
      const [profile] = await db
        .select({
          title: userProfiles.title,
          timezone: userProfiles.timezone,
          pronouns: userProfiles.pronouns,
        })
        .from(userProfiles)
        .where(eq(userProfiles.user_id, user.id));
      if (profile) {
        humanValues.HUMAN_TITLE = profile.title;
        humanValues.HUMAN_TIMEZONE = profile.timezone;
        humanValues.HUMAN_PRONOUNS = profile.pronouns;
      }
    }
  }
  return { values, humanValues };
}

// ---------------------------------------------------------------------------
// Per-agent migration step
// ---------------------------------------------------------------------------

type Mode = "dry-run" | "commit";

interface PerFileResult {
  path: string;
  kind: ClassificationResult["kind"];
  reason: string;
  byteDelta?: number;
  deleted?: boolean;
}

interface PerAgentResult {
  agentId: string;
  agentSlug: string | null;
  agentName: string;
  tenantSlug: string;
  templateSlug: string | null;
  files: PerFileResult[];
  pinsInitialized: Record<string, string>;
  error?: string;
}

async function migrateOneAgent(
  bkt: string,
  mode: Mode,
  agent: {
    id: string;
    slug: string | null;
    name: string;
    tenant_id: string;
    template_id: string;
    human_pair_id: string | null;
  },
): Promise<PerAgentResult> {
  // Resolve tenant + template slugs.
  const [tenant] = await db
    .select({ slug: tenants.slug, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, agent.tenant_id));
  const [template] = await db
    .select({ slug: agentTemplates.slug })
    .from(agentTemplates)
    .where(eq(agentTemplates.id, agent.template_id));

  if (!tenant?.slug || !template?.slug || !agent.slug) {
    return {
      agentId: agent.id,
      agentSlug: agent.slug,
      agentName: agent.name,
      tenantSlug: tenant?.slug ?? "",
      templateSlug: template?.slug ?? null,
      files: [],
      pinsInitialized: {},
      error: "Missing agent slug / tenant slug / template slug",
    };
  }

  const { values, humanValues } = await resolveAgentValues(agent, tenant.name);

  const prefix = agentPrefix(tenant.slug, agent.slug);
  const files = await listAgentFiles(bkt, prefix);

  const fileResults: PerFileResult[] = [];
  for (const relPath of files) {
    const agentContent = await readS3Utf8(bkt, prefix + relPath);
    const templateContent = await readTemplateLayer(
      bkt,
      tenant.slug,
      template.slug,
      relPath,
    );
    const classification = classifyAgentFile({
      agentContent,
      templateContent,
      values,
      humanValues,
      agentName: agent.name,
    });

    let deleted = false;
    if (mode === "commit" && classification.kind === "fork") {
      try {
        await s3.send(
          new DeleteObjectCommand({ Bucket: bkt, Key: prefix + relPath }),
        );
        deleted = true;
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    }

    fileResults.push({
      path: relPath,
      kind: classification.kind,
      reason: classification.reason,
      byteDelta: classification.byteDelta,
      deleted,
    });
  }

  // Populate pinned versions (idempotent — no-op for agents Unit 8
  // already handled). Runs in both dry-run and commit modes: this is a
  // pure read of template state + an idempotent write to the version
  // store + a single agents row update. Safe either way.
  let pinsInitialized: Record<string, string> = {};
  try {
    pinsInitialized = await initializePinnedVersions({
      tenantSlug: tenant.slug,
      templateSlug: template.slug,
    });
    if (mode === "commit") {
      // Only persist the pin map on the agent row in commit mode —
      // dry-run stays truly read-only for DB state (the version store
      // writes above are idempotent content-addressable, fine to
      // perform in dry-run).
      await db
        .update(agents)
        .set({
          agent_pinned_versions:
            Object.keys(pinsInitialized).length > 0 ? pinsInitialized : null,
          updated_at: new Date(),
        })
        .where(eq(agents.id, agent.id));
    }
  } catch (err) {
    const msg = (err as { message?: string } | null)?.message || String(err);
    return {
      agentId: agent.id,
      agentSlug: agent.slug,
      agentName: agent.name,
      tenantSlug: tenant.slug,
      templateSlug: template.slug,
      files: fileResults,
      pinsInitialized: {},
      error: `initializePinnedVersions failed: ${msg}`,
    };
  }

  return {
    agentId: agent.id,
    agentSlug: agent.slug,
    agentName: agent.name,
    tenantSlug: tenant.slug,
    templateSlug: template.slug,
    files: fileResults,
    pinsInitialized,
  };
}

// ---------------------------------------------------------------------------
// Pagination + checkpoint
// ---------------------------------------------------------------------------

interface Checkpoint {
  runId: string;
  mode: Mode;
  cursor: number;
  processedAgentIds: string[];
  started: string;
  lastUpdated: string;
}

async function loadCheckpoint(
  bkt: string,
  runId: string,
): Promise<Checkpoint | null> {
  const raw = await readS3Utf8(bkt, checkpointKey(runId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Checkpoint;
  } catch {
    return null;
  }
}

async function writeCheckpoint(
  bkt: string,
  checkpoint: Checkpoint,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bkt,
      Key: checkpointKey(checkpoint.runId),
      Body: JSON.stringify(checkpoint, null, 2),
      ContentType: "application/json",
    }),
  );
}

async function writeReport(
  bkt: string,
  runId: string,
  mode: Mode,
  results: PerAgentResult[],
): Promise<string> {
  const key = reportKey(runId, mode);
  const summary = summarize(results);
  await s3.send(
    new PutObjectCommand({
      Bucket: bkt,
      Key: key,
      Body: JSON.stringify(
        {
          runId,
          mode,
          summary,
          perAgent: results,
          writtenAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      ContentType: "application/json",
    }),
  );
  return key;
}

function summarize(results: PerAgentResult[]) {
  const s = {
    agents: results.length,
    agentsWithErrors: 0,
    files: {
      fork: 0,
      override: 0,
      "review-required": 0,
      "no-template": 0,
    } as Record<ClassificationResult["kind"], number>,
    filesDeleted: 0,
    pinsInitialized: 0,
  };
  for (const a of results) {
    if (a.error) s.agentsWithErrors++;
    for (const f of a.files) {
      s.files[f.kind]++;
      if (f.deleted) s.filesDeleted++;
    }
    s.pinsInitialized += Object.keys(a.pinsInitialized).length;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export interface MigrateOptions {
  mode: Mode;
  tenantSlug?: string;
  runId?: string;
  batchSize?: number;
}

export interface MigrateResult {
  runId: string;
  reportKey: string;
  summary: ReturnType<typeof summarize>;
}

export async function runMigration(
  opts: MigrateOptions,
): Promise<MigrateResult> {
  const bkt = bucket();
  if (!bkt) throw new Error("WORKSPACE_BUCKET not configured");

  if (opts.mode === "commit") {
    await preflightVersioning(bkt);
  }

  const runId = opts.runId ?? new Date().toISOString().replace(/[:.]/g, "-");
  const batchSize = opts.batchSize ?? 50;

  const existing = await loadCheckpoint(bkt, runId);
  const checkpoint: Checkpoint = existing ?? {
    runId,
    mode: opts.mode,
    cursor: 0,
    processedAgentIds: [],
    started: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
  if (existing && existing.mode !== opts.mode) {
    throw new Error(
      `Checkpoint for runId ${runId} was created in mode '${existing.mode}' but you're now invoking with '${opts.mode}'. Use a fresh --run-id.`,
    );
  }

  const allResults: PerAgentResult[] = [];

  // Paginate agents. Filter by tenant slug if provided.
  let filterTenantId: string | null = null;
  if (opts.tenantSlug) {
    const [t] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, opts.tenantSlug));
    if (!t) throw new Error(`Tenant '${opts.tenantSlug}' not found`);
    filterTenantId = t.id;
  }

  // Keep fetching batches until we see fewer than batchSize rows (end).
  let cursor = checkpoint.cursor;
  while (true) {
    const rows = await db
      .select({
        id: agents.id,
        slug: agents.slug,
        name: agents.name,
        tenant_id: agents.tenant_id,
        template_id: agents.template_id,
        human_pair_id: agents.human_pair_id,
      })
      .from(agents)
      .where(
        filterTenantId ? and(eq(agents.tenant_id, filterTenantId)) : undefined,
      )
      .limit(batchSize)
      .offset(cursor);
    if (rows.length === 0) break;

    for (const row of rows) {
      if (checkpoint.processedAgentIds.includes(row.id)) continue;
      try {
        const result = await migrateOneAgent(bkt, opts.mode, {
          id: row.id,
          slug: row.slug,
          name: row.name,
          tenant_id: row.tenant_id,
          template_id: row.template_id!,
          human_pair_id: row.human_pair_id,
        });
        allResults.push(result);
      } catch (err) {
        const msg =
          (err as { message?: string } | null)?.message || String(err);
        allResults.push({
          agentId: row.id,
          agentSlug: row.slug,
          agentName: row.name,
          tenantSlug: "",
          templateSlug: null,
          files: [],
          pinsInitialized: {},
          error: msg,
        });
      }
      checkpoint.processedAgentIds.push(row.id);
    }

    cursor += rows.length;
    checkpoint.cursor = cursor;
    checkpoint.lastUpdated = new Date().toISOString();
    await writeCheckpoint(bkt, checkpoint);

    if (rows.length < batchSize) break;
  }

  const rKey = await writeReport(bkt, runId, opts.mode, allResults);
  const summary = summarize(allResults);
  return { runId, reportKey: rKey, summary };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function parseArgs(): MigrateOptions {
  const args = process.argv.slice(2);
  let mode: Mode = "dry-run";
  let tenantSlug: string | undefined;
  let runId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") mode = "dry-run";
    else if (a === "--commit") mode = "commit";
    else if (a === "--tenant") tenantSlug = args[++i];
    else if (a === "--run-id") runId = args[++i];
  }
  return { mode, tenantSlug, runId };
}

// ---------------------------------------------------------------------------
// Lambda handler shape (for invoke via the API Lambda set)
// ---------------------------------------------------------------------------

export async function handler(event: {
  mode?: Mode;
  tenantSlug?: string;
  runId?: string;
  batchSize?: number;
}): Promise<MigrateResult> {
  return runMigration({
    mode: event.mode ?? "dry-run",
    tenantSlug: event.tenantSlug,
    runId: event.runId,
    batchSize: event.batchSize,
  });
}

// Self-exec when invoked directly via `npx tsx`.
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("migrate-existing-agents-to-overlay.ts")
) {
  (async () => {
    const opts = parseArgs();
    console.log(
      `[migrate-overlay] starting mode=${opts.mode} tenant=${opts.tenantSlug ?? "(all)"} runId=${opts.runId ?? "(fresh)"}`,
    );
    try {
      const out = await runMigration(opts);
      console.log(
        `[migrate-overlay] done — report: s3://${bucket()}/${out.reportKey}`,
      );
      console.log(
        `[migrate-overlay] summary:`,
        JSON.stringify(out.summary, null, 2),
      );
    } catch (err) {
      console.error(`[migrate-overlay] failed:`, err);
      process.exitCode = 1;
    }
  })();
}
