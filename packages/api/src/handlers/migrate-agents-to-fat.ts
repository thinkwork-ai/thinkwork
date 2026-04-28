/**
 * Migrate agents to the Fat-folder native workspace shape.
 *
 * Dry-run by default. Destructive mode is intentionally tenant-scoped:
 *
 *   npx tsx packages/api/src/handlers/migrate-agents-to-fat.ts --stage=dev
 *   npx tsx packages/api/src/handlers/migrate-agents-to-fat.ts --stage=dev --tenants=acme --batch-size=20 --destructive
 *
 * The report is written to:
 *   tenants/_ops/migrations/fat-folder/{run-id}.json
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  agentTemplates,
  tenants,
  userProfiles,
  users,
} from "@thinkwork/database-pg/schema";
import {
  classifyAgentFile,
  type ClassificationKind,
} from "../lib/placeholder-aware-comparator.js";
import type {
  HumanPlaceholderValues,
  PlaceholderValues,
} from "../lib/placeholder-substitution.js";

const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });

type Action =
  | "revert-to-inherited"
  | "keep-as-override"
  | "materialize-sub-agent";

export interface FatMigrationFileReport {
  path: string;
  action: Action;
  reason: string;
  byteDelta?: number;
  deleted?: boolean;
}

export interface FatMigrationAgentReport {
  tenant: string;
  agent: string;
  agentId: string;
  template: string | null;
  files: FatMigrationFileReport[];
  error?: string;
}

export interface FatMigrationSummary {
  agents: number;
  agentsWithErrors: number;
  actions: Record<Action, number>;
  deleted: number;
}

export interface FatMigrationOptions {
  stage?: string;
  tenants?: string[];
  batchSize?: number;
  destructive?: boolean;
  runId?: string;
}

export interface FatMigrationResult {
  runId: string;
  reportKey: string;
  summary: FatMigrationSummary;
}

function bucket(): string {
  return process.env.WORKSPACE_BUCKET || "";
}

function db() {
  return getDb();
}

function reportKey(runId: string): string {
  return `tenants/_ops/migrations/fat-folder/${runId}.json`;
}

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

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
    ?.$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
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
      if (!rel || rel === "manifest.json" || rel === "_defaults_version")
        continue;
      out.push(rel);
    }
    continuationToken = resp.IsTruncated
      ? resp.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return out;
}

async function readTemplateLayer(
  bkt: string,
  tenantSlug: string,
  templateSlug: string,
  path: string,
): Promise<string | null> {
  return (
    (await readS3Utf8(bkt, templateKey(tenantSlug, templateSlug, path))) ??
    (await readS3Utf8(bkt, defaultsKey(tenantSlug, path)))
  );
}

async function resolveAgentValues(agent: {
  name: string;
  human_pair_id: string | null;
}): Promise<{
  values: PlaceholderValues;
  humanValues: HumanPlaceholderValues;
}> {
  const values: PlaceholderValues = {
    AGENT_NAME: agent.name,
    TENANT_NAME: null,
  };
  const humanValues: HumanPlaceholderValues = {
    HUMAN_NAME: null,
    HUMAN_EMAIL: null,
    HUMAN_TITLE: null,
    HUMAN_TIMEZONE: null,
    HUMAN_PRONOUNS: null,
  };
  if (!agent.human_pair_id) return { values, humanValues };
  const [user] = await db()
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, agent.human_pair_id));
  if (!user) return { values, humanValues };
  humanValues.HUMAN_NAME = user.name;
  humanValues.HUMAN_EMAIL = user.email;
  const [profile] = await db()
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
  return { values, humanValues };
}

export function classifyFatMigrationAction(
  kind: ClassificationKind,
  path: string,
): Action {
  if (kind === "fork") return "revert-to-inherited";
  if (kind === "no-template" && path.includes("/"))
    return "materialize-sub-agent";
  return "keep-as-override";
}

export function summarizeFatMigration(
  agentsOut: FatMigrationAgentReport[],
): FatMigrationSummary {
  const summary: FatMigrationSummary = {
    agents: agentsOut.length,
    agentsWithErrors: 0,
    actions: {
      "revert-to-inherited": 0,
      "keep-as-override": 0,
      "materialize-sub-agent": 0,
    },
    deleted: 0,
  };
  for (const agent of agentsOut) {
    if (agent.error) summary.agentsWithErrors++;
    for (const file of agent.files) {
      summary.actions[file.action]++;
      if (file.deleted) summary.deleted++;
    }
  }
  return summary;
}

export function validateFatMigrationOptions(
  options: FatMigrationOptions,
): void {
  if (
    options.destructive &&
    (!options.tenants || options.tenants.length === 0)
  ) {
    throw new Error("destructive migration requires explicit tenant scope");
  }
  if (options.batchSize !== undefined && options.batchSize < 1) {
    throw new Error("batch-size must be at least 1");
  }
}

export function missingTenantSlugs(
  requestedSlugs: string[],
  foundSlugs: string[],
): string[] {
  const found = new Set(foundSlugs);
  return [...new Set(requestedSlugs)].filter((slug) => !found.has(slug));
}

async function migrateOneAgent(
  bkt: string,
  options: FatMigrationOptions,
  row: {
    id: string;
    name: string;
    slug: string | null;
    tenant_id: string;
    template_id: string | null;
    human_pair_id: string | null;
  },
): Promise<FatMigrationAgentReport> {
  const [tenant] = await db()
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, row.tenant_id));
  const [template] = row.template_id
    ? await db()
        .select({ slug: agentTemplates.slug })
        .from(agentTemplates)
        .where(eq(agentTemplates.id, row.template_id))
    : [];
  if (!tenant?.slug || !template?.slug || !row.slug) {
    return {
      tenant: tenant?.slug ?? "",
      agent: row.slug ?? "",
      agentId: row.id,
      template: template?.slug ?? null,
      files: [],
      error: "Missing agent slug, tenant slug, or template slug",
    };
  }

  const prefix = agentPrefix(tenant.slug, row.slug);
  const { values, humanValues } = await resolveAgentValues(row);
  const files = await listAgentFiles(bkt, prefix);
  const out: FatMigrationFileReport[] = [];

  for (const path of files) {
    const agentContent = await readS3Utf8(bkt, `${prefix}${path}`);
    const templateContent = await readTemplateLayer(
      bkt,
      tenant.slug,
      template.slug,
      path,
    );
    const classification = classifyAgentFile({
      agentContent,
      templateContent,
      values,
      humanValues,
      agentName: row.name,
    });
    const action = classifyFatMigrationAction(classification.kind, path);
    let deleted = false;
    if (options.destructive && action === "revert-to-inherited") {
      await s3.send(
        new DeleteObjectCommand({ Bucket: bkt, Key: `${prefix}${path}` }),
      );
      deleted = true;
    }
    out.push({
      path,
      action,
      reason: classification.reason,
      byteDelta: classification.byteDelta,
      deleted,
    });
  }

  return {
    tenant: tenant.slug,
    agent: row.slug,
    agentId: row.id,
    template: template.slug,
    files: out,
  };
}

async function agentRowsFor(options: FatMigrationOptions) {
  let tenantIds: string[] | undefined;
  if (options.tenants && options.tenants.length > 0) {
    const requested = [...new Set(options.tenants)];
    const rows = await db()
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(inArray(tenants.slug, requested));
    const missing = missingTenantSlugs(
      requested,
      rows.map((row) => row.slug),
    );
    if (missing.length > 0) {
      throw new Error(`Unknown tenant slug(s): ${missing.join(", ")}`);
    }
    tenantIds = rows.map((row) => row.id);
  }
  return db()
    .select({
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      tenant_id: agents.tenant_id,
      template_id: agents.template_id,
      human_pair_id: agents.human_pair_id,
    })
    .from(agents)
    .where(
      tenantIds && tenantIds.length > 0
        ? and(inArray(agents.tenant_id, tenantIds))
        : undefined,
    );
}

async function writeReport(
  bkt: string,
  runId: string,
  options: FatMigrationOptions,
  agentsOut: FatMigrationAgentReport[],
): Promise<string> {
  const key = reportKey(runId);
  await s3.send(
    new PutObjectCommand({
      Bucket: bkt,
      Key: key,
      Body: JSON.stringify(
        {
          runId,
          mode: options.destructive ? "destructive" : "dry-run",
          stage: options.stage ?? null,
          summary: summarizeFatMigration(agentsOut),
          agents: agentsOut,
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

export async function runFatMigration(
  options: FatMigrationOptions = {},
): Promise<FatMigrationResult> {
  validateFatMigrationOptions(options);
  const bkt = bucket();
  if (!bkt) throw new Error("WORKSPACE_BUCKET not configured");
  const batchSize = options.batchSize ?? 20;
  const runId = options.runId ?? new Date().toISOString().replace(/[:.]/g, "-");
  const rows = await agentRowsFor(options);
  const out: FatMigrationAgentReport[] = [];

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (row) => {
        try {
          return await migrateOneAgent(bkt, options, row);
        } catch (err) {
          return {
            tenant: "",
            agent: row.slug ?? "",
            agentId: row.id,
            template: null,
            files: [],
            error: (err as { message?: string } | null)?.message || String(err),
          };
        }
      }),
    );
    out.push(...results);
  }

  const key = await writeReport(bkt, runId, options, out);
  return { runId, reportKey: key, summary: summarizeFatMigration(out) };
}

export function parseFatMigrationArgs(
  argv = process.argv.slice(2),
): FatMigrationOptions {
  const options: FatMigrationOptions = {};
  for (const arg of argv) {
    if (arg === "--destructive") options.destructive = true;
    else if (arg.startsWith("--stage="))
      options.stage = arg.slice("--stage=".length);
    else if (arg.startsWith("--tenants=")) {
      options.tenants = arg
        .slice("--tenants=".length)
        .split(",")
        .map((tenant) => tenant.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--batch-size=")) {
      options.batchSize = Number(arg.slice("--batch-size=".length));
    } else if (arg.startsWith("--run-id=")) {
      options.runId = arg.slice("--run-id=".length);
    }
  }
  return options;
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("migrate-agents-to-fat.ts")
) {
  (async () => {
    const result = await runFatMigration(parseFatMigrationArgs());
    console.log(JSON.stringify(result, null, 2));
    if (result.summary.agentsWithErrors > 0) process.exitCode = 1;
  })();
}
