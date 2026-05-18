#!/usr/bin/env tsx
/**
 * Bootstrap per-user context USER.md files.
 *
 * Writes `tenants/{tenantId}/users/{userId}/USER.md` for active tenant
 * members whose principal is a user. Existing files are preserved unless
 * `--overwrite` is passed.
 *
 * Usage:
 *   DATABASE_URL=... WORKSPACE_BUCKET=... \
 *     pnpm -C packages/api exec tsx scripts/bootstrap-user-context.ts --dry-run
 *
 *   DATABASE_URL=... WORKSPACE_BUCKET=... \
 *     pnpm -C packages/api exec tsx scripts/bootstrap-user-context.ts --tenant <tenant-id>
 */

import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getDb } from "@thinkwork/database-pg";
import { tenantMembers } from "@thinkwork/database-pg/schema";
import { eq } from "drizzle-orm";
import { writeUserContextMdForUser } from "../src/lib/user-context-md-writer.js";

interface CliOptions {
  dryRun: boolean;
  overwrite: boolean;
  tenantId: string | null;
  userId: string | null;
}

type Target = {
  tenantId: string;
  userId: string;
};

type TargetResult = Target & {
  outcome: "written" | "skipped-existing" | "dry-run" | "error";
  key: string;
  error?: string;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    overwrite: false,
    tenantId: null,
    userId: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--overwrite") {
      opts.overwrite = true;
    } else if (arg === "--tenant") {
      const next = argv[++i];
      if (!next) throw new Error("--tenant requires a tenant id");
      opts.tenantId = next;
    } else if (arg === "--user") {
      const next = argv[++i];
      if (!next) throw new Error("--user requires a user id");
      opts.userId = next;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: bootstrap-user-context [--dry-run] [--overwrite] [--tenant id] [--user id]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function workspaceBucket(): string {
  const bucket = process.env.WORKSPACE_BUCKET || "";
  if (!bucket) throw new Error("WORKSPACE_BUCKET must be set");
  return bucket;
}

function userContextKey(target: Target): string {
  return `tenants/${target.tenantId}/users/${target.userId}/USER.md`;
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  if (name === "NotFound" || name === "NoSuchKey") return true;
  const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
    ?.$metadata?.httpStatusCode;
  return status === 404;
}

async function objectExists(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

async function loadTargets(opts: CliOptions): Promise<Target[]> {
  const db = getDb();
  const rows = opts.tenantId
    ? await db
        .select({
          tenantId: tenantMembers.tenant_id,
          principalType: tenantMembers.principal_type,
          principalId: tenantMembers.principal_id,
          status: tenantMembers.status,
        })
        .from(tenantMembers)
        .where(eq(tenantMembers.tenant_id, opts.tenantId))
    : await db
        .select({
          tenantId: tenantMembers.tenant_id,
          principalType: tenantMembers.principal_type,
          principalId: tenantMembers.principal_id,
          status: tenantMembers.status,
        })
        .from(tenantMembers);

  const seen = new Set<string>();
  const targets: Target[] = [];
  for (const row of rows) {
    if (row.principalType.toLowerCase() !== "user") continue;
    if (row.status !== "active") continue;
    if (opts.userId && row.principalId !== opts.userId) continue;
    const key = `${row.tenantId}:${row.principalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ tenantId: row.tenantId, userId: row.principalId });
  }
  return targets;
}

async function processTarget(
  target: Target,
  opts: CliOptions,
  s3: S3Client,
  bucket: string,
): Promise<TargetResult> {
  const key = userContextKey(target);
  try {
    if (!opts.overwrite && (await objectExists(s3, bucket, key))) {
      return { ...target, key, outcome: "skipped-existing" };
    }
    if (opts.dryRun) {
      return { ...target, key, outcome: "dry-run" };
    }
    const db = getDb();
    await writeUserContextMdForUser(db, target.tenantId, target.userId);
    return { ...target, key, outcome: "written" };
  } catch (err) {
    return {
      ...target,
      key,
      outcome: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const bucket = workspaceBucket();
  const s3 = new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  const targets = await loadTargets(opts);

  console.log(
    `User context bootstrap: ${targets.length} target(s), dryRun=${opts.dryRun}, overwrite=${opts.overwrite}`,
  );

  const results: TargetResult[] = [];
  for (const target of targets) {
    results.push(await processTarget(target, opts, s3, bucket));
  }

  const counts = results.reduce<Record<string, number>>((acc, result) => {
    acc[result.outcome] = (acc[result.outcome] ?? 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({ counts, results }, null, 2));

  if ((counts.error ?? 0) > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
