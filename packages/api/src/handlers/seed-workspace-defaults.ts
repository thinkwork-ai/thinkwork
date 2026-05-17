/**
 * Seed Workspace Defaults
 *
 * Iterates every tenant and ensures its
 * `tenants/{tenantSlug}/agents/_catalog/defaults/workspace/` prefix holds
 * the current canonical default content (DEFAULTS_VERSION from
 * @thinkwork/workspace-defaults). Per-tenant behavior:
 *
 *   • Stored `_defaults_version` === DEFAULTS_VERSION → no-op.
 *   • Stored version < DEFAULTS_VERSION (or missing) → rewrite all canonical
 *     files + bump the version key.
 *
 * The seeding logic itself lives in `ensureDefaultsExist()` in
 * packages/api/src/lib/workspace-copy.ts — this handler just iterates tenants
 * and delegates per-tenant work.
 *
 * Run via:
 *   • `npx tsx packages/api/src/handlers/seed-workspace-defaults.ts` — the
 *     deploy pipeline runs this from the bootstrap job (plan §008 U4 wired
 *     it into .github/workflows/deploy.yml after `bash bootstrap-workspace.sh`).
 *   • Lambda invoke (manual / scheduled).
 *
 * Unit 3 of docs/plans/2026-04-21-006-feat-agent-workspace-overlay-and-seeding-plan.md;
 * deploy-pipeline wiring lands in plan §008 U4.
 */

import { and, eq, isNotNull } from "drizzle-orm";
import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getDb } from "@thinkwork/database-pg";
import { agentTemplates, tenants } from "@thinkwork/database-pg/schema";
import { DEFAULTS_VERSION, loadDefaults } from "@thinkwork/workspace-defaults";
import { ensureDefaultsExist } from "../lib/workspace-copy.js";

const db = getDb();
const s3 = new S3Client({
  region:
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});
const DEPLOYMENT_SECTION_HEADING = "## Deployment and Release Safety";

type PerTenantResult = {
  tenantId: string;
  tenantSlug: string;
  outcome: "seeded" | "already-current" | "error";
  previousVersion?: number;
  currentVersion?: number;
  error?: string;
};

type SeedSummary = {
  targetVersion: number;
  totalTenants: number;
  seeded: number;
  alreadyCurrent: number;
  errors: number;
  defaultTemplatesPatched: number;
  results: PerTenantResult[];
};

function workspaceBucket(): string {
  const bucket = process.env.WORKSPACE_BUCKET || "";
  if (!bucket)
    throw new Error("WORKSPACE_BUCKET environment variable is required");
  return bucket;
}

function isNotFound(err: unknown): boolean {
  if (err instanceof NoSuchKey) return true;
  const name = (err as { name?: string } | null)?.name;
  if (name === "NoSuchKey" || name === "NotFound") return true;
  const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
    ?.$metadata?.httpStatusCode;
  return status === 404;
}

async function readS3Text(bucket: string, key: string): Promise<string | null> {
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return (await resp.Body?.transformToString("utf-8")) ?? "";
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

function deploymentSafetySection(): string {
  const guardrails = loadDefaults()["GUARDRAILS.md"];
  const start = guardrails.indexOf(DEPLOYMENT_SECTION_HEADING);
  if (start === -1) {
    throw new Error(
      "Canonical GUARDRAILS.md is missing deployment safety section",
    );
  }
  const nextHeading = guardrails.indexOf("\n## ", start + 1);
  return guardrails
    .slice(start, nextHeading === -1 ? undefined : nextHeading)
    .trim();
}

async function patchDefaultAgentTemplateGuardrails(
  tenantId: string,
  tenantSlug: string,
): Promise<boolean> {
  const [defaultTemplateForTenant] = await db
    .select({ slug: agentTemplates.slug })
    .from(agentTemplates)
    .where(
      and(
        eq(agentTemplates.tenant_id, tenantId),
        eq(agentTemplates.slug, "default"),
        eq(agentTemplates.template_kind, "agent"),
        isNotNull(agentTemplates.slug),
      ),
    )
    .limit(1);

  if (!defaultTemplateForTenant?.slug) return false;

  const bucket = workspaceBucket();
  const key = `tenants/${tenantSlug}/agents/_catalog/${defaultTemplateForTenant.slug}/workspace/GUARDRAILS.md`;
  const current =
    (await readS3Text(bucket, key)) ?? loadDefaults()["GUARDRAILS.md"];
  if (current.includes(DEPLOYMENT_SECTION_HEADING)) return false;

  const section = deploymentSafetySection();
  const next = `${current.trimEnd()}\n\n${section}\n`;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: next,
      ContentType: "text/markdown",
    }),
  );

  console.log(
    `[seed-defaults] ${tenantSlug}: patched default template GUARDRAILS.md with deployment safety policy`,
  );
  return true;
}

export async function handler(): Promise<SeedSummary> {
  if (!process.env.WORKSPACE_BUCKET) {
    throw new Error("WORKSPACE_BUCKET environment variable is required");
  }

  console.log(
    `[seed-defaults] Starting; target DEFAULTS_VERSION=${DEFAULTS_VERSION}`,
  );

  const rows = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(isNotNull(tenants.slug));

  console.log(`[seed-defaults] Found ${rows.length} tenant(s) with a slug`);

  const results: PerTenantResult[] = [];
  let seeded = 0;
  let alreadyCurrent = 0;
  let errors = 0;
  let defaultTemplatesPatched = 0;

  for (const row of rows) {
    const tenantSlug = row.slug!;
    try {
      const outcome = await ensureDefaultsExist(tenantSlug);
      const result: PerTenantResult = {
        tenantId: row.id,
        tenantSlug,
        outcome: outcome.seeded ? "seeded" : "already-current",
        previousVersion: outcome.previousVersion,
        currentVersion: outcome.currentVersion,
      };
      results.push(result);
      if (outcome.seeded) {
        seeded++;
        console.log(
          `[seed-defaults] ${tenantSlug}: seeded (v${outcome.previousVersion} → v${outcome.currentVersion})`,
        );
      } else {
        alreadyCurrent++;
        console.log(
          `[seed-defaults] ${tenantSlug}: already current (v${outcome.currentVersion})`,
        );
      }
      if (await patchDefaultAgentTemplateGuardrails(row.id, tenantSlug)) {
        defaultTemplatesPatched++;
      }
    } catch (err) {
      errors++;
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        tenantId: row.id,
        tenantSlug,
        outcome: "error",
        error: message,
      });
      console.error(`[seed-defaults] ${tenantSlug}: failed — ${message}`);
    }
  }

  const summary: SeedSummary = {
    targetVersion: DEFAULTS_VERSION,
    totalTenants: rows.length,
    seeded,
    alreadyCurrent,
    errors,
    defaultTemplatesPatched,
    results,
  };

  console.log(
    `[seed-defaults] Done: ${seeded} seeded, ${alreadyCurrent} already current, ${defaultTemplatesPatched} default template(s) patched, ${errors} error(s)`,
  );

  return summary;
}

// Allow direct execution: npx tsx packages/api/src/handlers/seed-workspace-defaults.ts
if (
  process.argv[1]?.endsWith("seed-workspace-defaults.ts") ||
  process.argv[1]?.endsWith("seed-workspace-defaults.js")
) {
  handler()
    .then((result) => {
      console.log("[seed-defaults] Summary:", JSON.stringify(result, null, 2));
      process.exit(result.errors > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error("[seed-defaults] Fatal error:", err);
      process.exit(1);
    });
}
